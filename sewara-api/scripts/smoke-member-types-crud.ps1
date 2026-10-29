# smoke-member-types-crud.ps1 — uji PATCH/DELETE /api/member-types/{id}
#
# Prasyarat: Docker staging jalan + seed termuat

$ErrorActionPreference = 'Stop'

$root   = Split-Path -Parent $PSScriptRoot
$apiExe = Join-Path $root '.data\bin\sewara-api.exe'
$apiURL = 'http://127.0.0.1:8099'
$tmpDir = Join-Path $env:TEMP 'opencode'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

$dockerBin = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin"
$env:PATH = "$dockerBin;$env:PATH"

function Invoke-Api([string]$method, [string]$path, [string]$cookie, [string]$body) {
    $outFile = Join-Path $tmpDir 'api-out.bin'
    $curlArgs = @('-s', '--max-time', '15', '-o', $outFile, '-w', '%{http_code}', '-X', $method)
    if ($cookie) { $curlArgs += @('-H', "Cookie: sewara_session=$cookie") }
    if ($body) {
        $bodyFile = Join-Path $tmpDir 'api-body.json'
        [System.IO.File]::WriteAllText($bodyFile, $body, (New-Object System.Text.UTF8Encoding($false)))
        $curlArgs += @('-H', 'Content-Type: application/json', '--data-binary', "@$bodyFile")
    }
    $curlArgs += "$apiURL$path"
    $status = [int](curl.exe @curlArgs)
    $respBody = Get-Content $outFile -Raw -ErrorAction SilentlyContinue
    return @{ Status = $status; Body = $respBody }
}

function Get-SessionCookie([string]$email) {
    $jar = Join-Path $tmpDir 'session.txt'
    Remove-Item $jar -ErrorAction SilentlyContinue
    $body = "{`"email`":`"$email`",`"password`":`"Rahasia123`"}"
    $bodyFile = Join-Path $tmpDir 'login-body.json'
    [System.IO.File]::WriteAllText($bodyFile, $body, (New-Object System.Text.UTF8Encoding($false)))
    $status = [int](curl.exe -s --max-time 15 -o NUL -w '%{http_code}' -c $jar -H 'Content-Type: application/json' --data-binary "@$bodyFile" "$apiURL/api/auth/login")
    if ($status -ne 200) { throw "Login $email gagal (HTTP $status)" }
    $isian = Get-Content $jar -Raw
    if ($isian -match 'sewara_session\s+([^\s]+)') { return $Matches[1] }
    throw "Cookie tidak ditemukan setelah login $email"
}

try {
    Write-Host 'Menyiapkan binari...'
    Push-Location $root
    go build -o $apiExe ./cmd/api
    Pop-Location
    if ($LASTEXITCODE -ne 0) { throw 'go build gagal' }
    if (-not (Test-Path $apiExe)) { throw "Binari tidak ditemukan di $apiExe" }

    Write-Host 'Reset + mulai Docker staging...'
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') reset
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') start

    # Insert auth users untuk smoke (hash bcrypt untuk Rahasia123).
    $hash = '$2a$10$GCmHsmqVk3cqwXmf0AVWueY8h0JHD1zo0mr.tl0F/CH0dI/01mYEu'
    docker exec sewara-staging-db psql -U sewara -d sewara -c "
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'owner-a@staging.local', '$hash', now()),
  ('b0000000-0000-0000-0000-000000000001', 'owner-b@staging.local', '$hash', now())
ON CONFLICT (id) DO UPDATE SET encrypted_password='$hash', email_confirmed_at=now();
" | Out-Null

    $env:DATABASE_URL = 'postgres://sewara:sewara123@127.0.0.1:5433/sewara?sslmode=disable'
    $env:ADDR = '127.0.0.1:8099'
    $env:APP_ENV = 'development'

    $api = Start-Process -FilePath $apiExe -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $tmpDir 'api-stdout.log') -RedirectStandardError (Join-Path $tmpDir 'api-stderr.log')

    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 300
        $code = curl.exe -s -o NUL -w '%{http_code}' --max-time 2 "$apiURL/api/health"
        if ($code -eq '200') { $ready = $true; break }
    }
    if (-not $ready) { throw 'API tidak siap' }

    Write-Host "`n=== Login ==="
    $cookieA = Get-SessionCookie 'owner-a@staging.local'
    $cookieB = Get-SessionCookie 'owner-b@staging.local'
    Write-Host 'Login berhasil'

    $hasil = @()
    function Add-Hasil([string]$nama, [int]$dapat, [int]$harap, [string]$info) {
        $script:hasil += [pscustomobject]@{
            Skenario = $nama; Status = $dapat; Harap = $harap
            Hasil = $(if ($dapat -eq $harap) { 'LOLOS' } else { 'GAGAL' }); Info = $info
        }
    }

    # PATCH tanpa cookie
    $r = Invoke-Api 'PATCH' '/api/member-types/1' $null '{"nama":"Updated"}'
    Add-Hasil 'PATCH tanpa cookie -> 401' $r.Status 401 ''

    # PATCH nama kosong
    $r = Invoke-Api 'PATCH' '/api/member-types/1' $cookieA '{"nama":""}'
    Add-Hasil 'PATCH nama kosong -> 400' $r.Status 400 ''

    # PATCH body kosong
    $r = Invoke-Api 'PATCH' '/api/member-types/1' $cookieA '{}'
    Add-Hasil 'PATCH body kosong -> 400' $r.Status 400 ''

    # PATCH valid tenant A (id=1 adalah seed tenant A)
    $r = Invoke-Api 'PATCH' '/api/member-types/1' $cookieA '{"nama":"Reguler Updated","diskon_persen":12}'
    Add-Hasil 'PATCH valid -> 200' $r.Status 200 ''

    # PATCH -> field berubah
    $updated = ($r.Body | ConvertFrom-Json).data.memberType
    $namaOK = $updated.nama -eq 'Reguler Updated'
    $diskonOK = $updated.diskon_persen -eq 12
    Add-Hasil 'PATCH -> field berubah' ([int]($namaOK -and $diskonOK)) 1 "nama=$namaOK diskon=$diskonOK"

    # PATCH user_id diabaikan (tetap tenant A)
    $r = Invoke-Api 'PATCH' '/api/member-types/1' $cookieA '{"user_id":"b0000000-0000-0000-0000-000000000001","nama":"Hack"}'
    $patched = ($r.Body | ConvertFrom-Json).data.memberType
    $userIdIntact = $patched.user_id -eq 'a0000000-0000-0000-0000-000000000001'
    Add-Hasil 'PATCH user_id diabaikan' ([int]$userIdIntact) 1 "user_id=$($patched.user_id)"

    # PATCH id tenant lain -> 404
    $r = Invoke-Api 'PATCH' '/api/member-types/3' $cookieA '{"nama":"Hack B"}'
    Add-Hasil 'PATCH id tenant lain -> 404' $r.Status 404 ''

    # PATCH id tidak ada -> 404
    $r = Invoke-Api 'PATCH' '/api/member-types/9999' $cookieA '{"nama":"Ghost"}'
    Add-Hasil 'PATCH id tidak ada -> 404' $r.Status 404 ''

    # DELETE tanpa cookie
    $r = Invoke-Api 'DELETE' '/api/member-types/2' $null $null
    Add-Hasil 'DELETE tanpa cookie -> 401' $r.Status 401 ''

    # DELETE id tenant lain -> 200 idempoten (RLS filter, tidak dihapus)
    $r = Invoke-Api 'DELETE' '/api/member-types/4' $cookieA $null
    Add-Hasil 'DELETE id tenant lain -> 200' $r.Status 200 ''

    # Cek tenant B masih punya id=4
    $r = Invoke-Api 'GET' '/api/member-types' $cookieB $null
    $dataB = ($r.Body | ConvertFrom-Json).data.memberTypes
    $id4Intact = @($dataB | Where-Object { $_.id -eq 4 }).Count -eq 1
    Add-Hasil 'Tenant B id=4 masih ada' ([int]$id4Intact) 1 "ada=$id4Intact"

    # DELETE valid tenant A (id=2)
    $r = Invoke-Api 'DELETE' '/api/member-types/2' $cookieA $null
    Add-Hasil 'DELETE valid -> 200' $r.Status 200 ''

    # GET tenant A setelah delete -> tinggal 1 (id=1; id=2 terhapus)
    $r = Invoke-Api 'GET' '/api/member-types' $cookieA $null
    $dataA = ($r.Body | ConvertFrom-Json).data.memberTypes
    $countA = @($dataA).Count
    Add-Hasil 'GET tenant A setelah DELETE -> 1 member type' ([int]($countA -eq 1)) 1 "count=$countA"

    # DELETE id sudah dihapus -> 200 idempoten
    $r = Invoke-Api 'DELETE' '/api/member-types/2' $cookieA $null
    Add-Hasil 'DELETE id sudah dihapus -> 200' $r.Status 200 ''

    Write-Host "`n"
    $hasil | Format-Table -AutoSize | Out-String | Write-Host
    $gagal = @($hasil | Where-Object { $_.Hasil -eq 'GAGAL' }).Count
    if ($gagal -gt 0) {
        Write-Host "`n$gagal skenario GAGAL." -ForegroundColor Red
        exit 1
    }
    Write-Host "`nSemua skenario lolos." -ForegroundColor Green
}
finally {
    if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') stop
}
