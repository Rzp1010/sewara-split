# smoke-members.ps1 — uji CRUD members Go
#
# Cakupan: GET/POST/PATCH/DELETE, validasi, isolasi tenant, join tipe (tipeNama,
# diskon_persen dari member_types aktif).

$ErrorActionPreference = 'Stop'
$root   = Split-Path -Parent $PSScriptRoot
$apiExe = Join-Path $root '.data\bin\sewara-api.exe'
$apiURL = 'http://127.0.0.1:8099'
$tmpDir = Join-Path $env:TEMP 'opencode'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$env:PATH = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:PATH"

function Invoke-Api([string]$method, [string]$path, [string]$cookie, [string]$body) {
    $outFile = Join-Path $tmpDir 'api-out.bin'
    $curlArgs = @('-s', '--max-time', '20', '-o', $outFile, '-w', '%{http_code}', '-X', $method)
    if ($cookie) { $curlArgs += @('-H', "Cookie: sewara_session=$cookie") }
    if ($body) {
        $bodyFile = Join-Path $tmpDir 'req-body.json'
        [System.IO.File]::WriteAllText($bodyFile, $body, (New-Object System.Text.UTF8Encoding($false)))
        $curlArgs += @('-H', 'Content-Type: application/json', '--data-binary', "@$bodyFile")
    }
    $curlArgs += "$apiURL$path"
    $status = [int](curl.exe @curlArgs)
    return [pscustomobject]@{ Status = $status; Body = (Get-Content $outFile -Raw -ErrorAction SilentlyContinue) }
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

$goExe = @("$env:ProgramFiles\Go\bin\go.exe", "$env:LOCALAPPDATA\Programs\Go\bin\go.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $goExe) { throw 'go tidak ditemukan' }

Push-Location $root
try {
    $env:CGO_ENABLED = '0'
    & $goExe build -o $apiExe ./cmd/api
    if ($LASTEXITCODE -ne 0) { throw 'go build gagal' }
}
finally { Pop-Location }

Write-Host 'Reset + mulai Docker staging...'
& (Join-Path $PSScriptRoot 'docker-staging.ps1') reset | Out-Null
& (Join-Path $PSScriptRoot 'docker-staging.ps1') start  | Out-Null

$hash = '$2a$10$GCmHsmqVk3cqwXmf0AVWueY8h0JHD1zo0mr.tl0F/CH0dI/01mYEu'
docker exec sewara-staging-db psql -U sewara -d sewara -c "
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'owner-a@staging.local', '$hash', now()),
  ('b0000000-0000-0000-0000-000000000001', 'owner-b@staging.local', '$hash', now())
ON CONFLICT (id) DO UPDATE SET encrypted_password='$hash', email_confirmed_at=now();
" | Out-Null

$env:DATABASE_URL = 'postgres://sewara:sewara123@127.0.0.1:5433/sewara?sslmode=disable'
$env:ADDR         = '127.0.0.1:8099'
$env:APP_ENV      = 'development'
$env:R2_ENDPOINT          = ''
$env:R2_ACCESS_KEY_ID     = ''
$env:R2_SECRET_ACCESS_KEY = ''
$env:R2_BUCKET            = ''; $env:R2_BUCKET_NAME            = ''

$api = Start-Process -FilePath $apiExe -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $root '.data\api.out.log') `
    -RedirectStandardError  (Join-Path $root '.data\api.err.log')

$ready = $false
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 300
    if ((curl.exe -s -o NUL -w '%{http_code}' --max-time 2 "$apiURL/api/health") -eq '200') { $ready = $true; break }
}
if (-not $ready) {
    if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
    Get-Content (Join-Path $root '.data\api.err.log') -Tail 20 -ErrorAction SilentlyContinue
    throw 'API tidak siap'
}

try {
    $ownerA = Get-SessionCookie 'owner-a@staging.local'
    $ownerB = Get-SessionCookie 'owner-b@staging.local'

    $hasil = @()
    function Add-Hasil([string]$nama, [bool]$lolos, [string]$info) {
        $script:hasil += [pscustomobject]@{
            Skenario = $nama
            Hasil    = $(if ($lolos) { 'LOLOS' } else { 'GAGAL' })
            Info     = $info
        }
    }

    # Seed punya 2 member_types A (aktif), 2 member_types B (aktif), dan 3 members A, 3 members B.
    # =========================================================================
    # GET /api/members — list awal (seed 3 member tenant A)
    # =========================================================================
    $r = Invoke-Api 'GET' '/api/members' $null ''
    Add-Hasil 'GET tanpa cookie -> 401' ($r.Status -eq 401) "status=$($r.Status)"

    $r = Invoke-Api 'GET' '/api/members' $ownerA ''
    $n = ([regex]::Matches($r.Body, '"id":')).Count
    Add-Hasil 'GET owner A -> 200 + seed 3 member' `
        ($r.Status -eq 200 -and $n -eq 3) `
        "status=$($r.Status) count=$n"

    # Cek join tipe: seed member id 1 punya tipe_id 1 (Reguler A 0%).
    Add-Hasil 'GET -> join tipeNama' ($r.Body -match '"tipeNama":"Reguler A"') "body=$($r.Body)"
    # Member id 2 punya tipe 2 (VIP A 10%).
    Add-Hasil 'GET -> join diskon_persen dari tipe VIP' ($r.Body -match '"tipeNama":"VIP A"' -and $r.Body -match '"diskon_persen":10') "body=$($r.Body)"

    # =========================================================================
    # POST /api/members
    # =========================================================================
    $r = Invoke-Api 'POST' '/api/members' $null '{"nama":"Test"}'
    Add-Hasil 'POST tanpa cookie -> 401' ($r.Status -eq 401) "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/members' $ownerA '{}'
    Add-Hasil 'POST tanpa nama -> 400' ($r.Status -eq 400 -and $r.Body -match 'Nama') `
        "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/members' $ownerA '{"nama":"Test","diskon_persen":150}'
    Add-Hasil 'POST diskon >100 -> 400' ($r.Status -eq 400 -and $r.Body -match '0-100') `
        "status=$($r.Status)"

    $body1 = '{"nama":"Budi","hp":"0812345","alamat":"Jl. A","email":"budi@test.com","foto_jaminan":[]}'
    $r = Invoke-Api 'POST' '/api/members' $ownerA $body1
    $id1 = $null
    if ($r.Body -match '"id":(\d+)') { $id1 = $Matches[1] }
    Add-Hasil 'POST valid -> 201 + id' ($r.Status -eq 201 -and $null -ne $id1) "status=$($r.Status) id=$id1"
    Add-Hasil 'POST -> status default aktif' ($r.Body -match '"status":"aktif"') "body=$($r.Body)"

    $r = Invoke-Api 'POST' '/api/members' $ownerB '{"nama":"Candra","hp":"0813111"}'
    $idB = $null
    if ($r.Body -match '"id":(\d+)') { $idB = $Matches[1] }
    Add-Hasil 'POST tenant B -> 201 (isolasi)' ($r.Status -eq 201 -and $null -ne $idB) "status=$($r.Status) id=$idB"

    # =========================================================================
    # GET /api/members — setelah tambah
    # =========================================================================
    $r = Invoke-Api 'GET' '/api/members' $ownerA ''
    $n = ([regex]::Matches($r.Body, '"id":')).Count
    Add-Hasil 'GET owner A -> 4 member (seed 3 + baru 1)' ($n -eq 4) "count=$n"

    $r = Invoke-Api 'GET' '/api/members' $ownerB ''
    $n = ([regex]::Matches($r.Body, '"id":')).Count
    Add-Hasil 'GET owner B -> 4 member (seed 3 + baru 1, isolasi)' ($n -eq 4) "count=$n"

    # =========================================================================
    # PATCH /api/members/{id}
    # =========================================================================
    $r = Invoke-Api 'PATCH' "/api/members/$id1" $null '{"nama":"X"}'
    Add-Hasil 'PATCH tanpa cookie -> 401' ($r.Status -eq 401) "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' "/api/members/$id1" $ownerA '{"nama":""}'
    Add-Hasil 'PATCH nama kosong -> 400' ($r.Status -eq 400 -and $r.Body -match 'kosong') `
        "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' "/api/members/$id1" $ownerA '{"diskon_persen":200}'
    Add-Hasil 'PATCH diskon >100 -> 400' ($r.Status -eq 400) "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' "/api/members/$id1" $ownerA '{"hp":"0888-NEW","alamat":"Jl. B No.2"}'
    Add-Hasil 'PATCH valid -> 200' ($r.Status -eq 200) "status=$($r.Status)"
    Add-Hasil 'PATCH -> field berubah' ($r.Body -match '0888-NEW') "body=$($r.Body)"

    $r = Invoke-Api 'PATCH' "/api/members/$id1" $ownerB '{"nama":"Hack"}'
    Add-Hasil 'PATCH id tenant lain -> 404' ($r.Status -eq 404) "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' '/api/members/999999' $ownerA '{"nama":"X"}'
    Add-Hasil 'PATCH id tidak ada -> 404' ($r.Status -eq 404) "status=$($r.Status)"

    # =========================================================================
    # DELETE /api/members/{id}
    # =========================================================================
    $r = Invoke-Api 'DELETE' "/api/members/$id1" $null ''
    Add-Hasil 'DELETE tanpa cookie -> 401' ($r.Status -eq 401) "status=$($r.Status)"

    $r = Invoke-Api 'DELETE' "/api/members/$id1" $ownerB ''
    Add-Hasil 'DELETE id tenant lain -> 404' ($r.Status -eq 404) "status=$($r.Status)"

    $r = Invoke-Api 'DELETE' "/api/members/$id1" $ownerA ''
    Add-Hasil 'DELETE valid -> 200' ($r.Status -eq 200) "status=$($r.Status)"

    $r = Invoke-Api 'DELETE' "/api/members/$id1" $ownerA ''
    Add-Hasil 'DELETE id sudah dihapus -> 404' ($r.Status -eq 404) "status=$($r.Status)"

    $r = Invoke-Api 'GET' '/api/members' $ownerA ''
    $n = ([regex]::Matches($r.Body, '"id":')).Count
    Add-Hasil 'GET setelah delete -> 3 member (kembali ke seed)' ($n -eq 3) "count=$n"

    # =========================================================================
    # Laporan
    # =========================================================================
    Write-Host ''
    $hasil | Format-Table -AutoSize | Out-String -Width 200 | Write-Host

    $gagal = @($hasil | Where-Object { $_.Hasil -ne 'LOLOS' }).Count
    if ($gagal -gt 0) {
        Write-Host "$gagal skenario GAGAL"
        Get-Content (Join-Path $root '.data\api.err.log') -Tail 20 -ErrorAction SilentlyContinue
        exit 1
    }
    Write-Host "Semua $($hasil.Count) skenario lolos."
}
finally {
    if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') stop | Out-Null
}
