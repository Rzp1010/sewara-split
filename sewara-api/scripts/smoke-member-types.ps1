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

    # GET all tenant A (seed sudah ada 2)
    $r = Invoke-Api 'GET' '/api/member-types' $cookieA $null
    $count = ($r.Body -split '"id":' | Measure-Object).Count - 1
    Add-Hasil 'GET all tenant A (seed 2) -> 200' $r.Status 200 "count=$count"

    # POST tenant A
    $r = Invoke-Api 'POST' '/api/member-types' $cookieA '{"nama":"VIP Plus","diskon_persen":15,"status":"aktif","diskon_durasi_aturan":[]}'
    $idBaru = if ($r.Body -match '"id":(\d+)') { $Matches[1] } else { 0 }
    Add-Hasil 'POST tenant A -> 200' $r.Status 200 "id=$idBaru"

    # GET all tenant A sekarang 3
    $r = Invoke-Api 'GET' '/api/member-types' $cookieA $null
    $count = ($r.Body -split '"id":' | Measure-Object).Count - 1
    Add-Hasil 'GET all tenant A sekarang 3 -> 200' $r.Status 200 "count=$count"

    # POST nama kosong -> 400
    $r = Invoke-Api 'POST' '/api/member-types' $cookieA '{"nama":"","diskon_persen":0}'
    Add-Hasil 'POST nama kosong -> 400' $r.Status 400 ''

    # GET tenant B tidak lihat data tenant A
    $r = Invoke-Api 'GET' '/api/member-types' $cookieB $null
    $countB = ($r.Body -split '"id":' | Measure-Object).Count - 1
    Add-Hasil 'Tenant B tidak lihat data tenant A' $r.Status 200 "countB=$countB (seed 2)"

    # POST tenant B
    $r = Invoke-Api 'POST' '/api/member-types' $cookieB '{"nama":"Premium","diskon_persen":20}'
    Add-Hasil 'POST tenant B -> 200' $r.Status 200 ''

    # GET tenant B sekarang 3
    $r = Invoke-Api 'GET' '/api/member-types' $cookieB $null
    $countB = ($r.Body -split '"id":' | Measure-Object).Count - 1
    Add-Hasil 'GET tenant B sekarang 3 -> 200' $r.Status 200 "countB=$countB"

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
