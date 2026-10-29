# smoke-member-types.ps1 — uji /api/member-types (GET/POST + tenant isolation)

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
    return [pscustomobject]@{ Status = $status; Body = $respBody }
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

Write-Host 'Menyiapkan binari...'
$goExe = @("$env:ProgramFiles\Go\bin\go.exe", "$env:LOCALAPPDATA\Programs\Go\bin\go.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $goExe) { throw 'go tidak ditemukan' }

Push-Location $root
try {
    $env:CGO_ENABLED = '0'
    & $goExe build -o $apiExe ./cmd/api
    if ($LASTEXITCODE -ne 0) { throw 'go build gagal' }
}
finally { Pop-Location }

Write-Host 'Memulai Docker staging...'
& (Join-Path $PSScriptRoot 'docker-staging.ps1') start | Out-Null

# Pastikan seed + password hash untuk owner A & B
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

$api = Start-Process -FilePath $apiExe -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $root '.data\api.out.log') `
    -RedirectStandardError (Join-Path $root '.data\api.err.log')

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 300
    if ((curl.exe -s -o NUL -w '%{http_code}' --max-time 2 "$apiURL/api/health") -eq '200') { $ready = $true; break }
}
if (-not $ready) {
    if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
    Get-Content (Join-Path $root '.data\api.err.log') -Tail 20 -ErrorAction SilentlyContinue
    throw 'API tidak siap'
}

try {
    Write-Host ''
    Write-Host '=== Login owner A + B ==='
    $cookieA = Get-SessionCookie 'owner-a@staging.local'
    $cookieB = Get-SessionCookie 'owner-b@staging.local'
    Write-Host 'Login berhasil'
    Write-Host ''

    $hasil = @()
    function Add-Hasil([string]$nama, [int]$dapat, [int]$harap, [string]$info) {
        $script:hasil += [pscustomobject]@{
            Skenario = $nama; Status = $dapat; Harap = $harap
            Hasil = $(if ($dapat -eq $harap) { 'LOLOS' } else { 'GAGAL' }); Info = $info
        }
    }

    # GET tanpa auth
    $r = Invoke-Api 'GET' '/api/member-types' $null $null
    Add-Hasil 'GET tanpa cookie -> 401' $r.Status 401 ''

    # GET tenant A hanya menampilkan dua seed miliknya.
    $r = Invoke-Api 'GET' '/api/member-types' $cookieA $null
    $dataA = ($r.Body | ConvertFrom-Json).data.memberTypes
    $idsA = @($dataA | ForEach-Object { $_.id })
    $getAOK = $r.Status -eq 200 -and $idsA.Count -eq 2
    Add-Hasil 'GET tenant A -> dua seed member type' ([int]$getAOK) 1 "HTTP=$($r.Status) ids=$($idsA -join ',')"

    # POST tenant A
    $r = Invoke-Api 'POST' '/api/member-types' $cookieA '{"nama":"VIP Plus","diskon_persen":15,"status":"aktif","diskon_durasi_aturan":[]}'
    $createdA = ($r.Body | ConvertFrom-Json).data.memberType
    $idBaru = if ($createdA.id) { $createdA.id } else { 0 }
    $postAOK = $r.Status -eq 200 -and $createdA.nama -eq 'VIP Plus' -and $createdA.user_id -eq 'a0000000-0000-0000-0000-000000000001'
    Add-Hasil 'POST tenant A -> tersimpan di tenant A' ([int]$postAOK) 1 "HTTP=$($r.Status) id=$idBaru"

    # GET all tenant A sekarang 3
    $r = Invoke-Api 'GET' '/api/member-types' $cookieA $null
    $dataA = ($r.Body | ConvertFrom-Json).data.memberTypes
    $count = @($dataA).Count
    $getAAfterPostOK = $r.Status -eq 200 -and $count -eq 3 -and @($dataA | Where-Object { $_.id -eq $idBaru }).Count -eq 1
    Add-Hasil 'GET tenant A setelah POST -> tiga termasuk baru' ([int]$getAAfterPostOK) 1 "HTTP=$($r.Status) count=$count"

    # POST nama kosong -> 400
    $r = Invoke-Api 'POST' '/api/member-types' $cookieA '{"nama":"","diskon_persen":0}'
    Add-Hasil 'POST nama kosong -> 400' $r.Status 400 ''

    # GET tenant B tidak lihat data tenant A; B hanya punya dua seed sendiri.
    $r = Invoke-Api 'GET' '/api/member-types' $cookieB $null
    $dataB = ($r.Body | ConvertFrom-Json).data.memberTypes
    $countB = @($dataB).Count
    $idsB = @($dataB | ForEach-Object { $_.id })
    $tenantBIsolated = $r.Status -eq 200 -and $countB -eq 2 -and $idBaru -notin $idsB
    Add-Hasil 'Tenant B tidak lihat data tenant A' ([int]$tenantBIsolated) 1 "HTTP=$($r.Status) countB=$countB ids=$($idsB -join ',')"

    # POST tenant B harus menyimpan di tenant B.
    $r = Invoke-Api 'POST' '/api/member-types' $cookieB '{"nama":"Premium","diskon_persen":20}'
    $createdB = ($r.Body | ConvertFrom-Json).data.memberType
    $postBOK = $r.Status -eq 200 -and $createdB.nama -eq 'Premium' -and $createdB.user_id -eq 'b0000000-0000-0000-0000-000000000001'
    Add-Hasil 'POST tenant B -> tersimpan di tenant B' ([int]$postBOK) 1 "HTTP=$($r.Status) id=$($createdB.id)"

    # GET tenant B sekarang tiga, termasuk record tenant B baru.
    $r = Invoke-Api 'GET' '/api/member-types' $cookieB $null
    $dataB = ($r.Body | ConvertFrom-Json).data.memberTypes
    $countB = @($dataB).Count
    $tenantBAfterPost = $r.Status -eq 200 -and $countB -eq 3 -and @($dataB | Where-Object { $_.id -eq $createdB.id }).Count -eq 1
    Add-Hasil 'GET tenant B setelah POST -> tiga termasuk baru' ([int]$tenantBAfterPost) 1 "HTTP=$($r.Status) countB=$countB"

    Write-Host ''
    $hasil | Format-Table -AutoSize | Out-String | Write-Host

    $gagal = @($hasil | Where-Object { $_.Hasil -ne 'LOLOS' }).Count
    if ($gagal -gt 0) { Write-Host "$gagal skenario GAGAL"; exit 1 }
    Write-Host 'Semua skenario lolos.'
}
finally {
    if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') stop | Out-Null
}
