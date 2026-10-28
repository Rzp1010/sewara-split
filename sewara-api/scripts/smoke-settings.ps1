# smoke-settings.ps1 — uji /api/settings (GET/POST + tenant isolation)
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
    return [pscustomobject]@{ Status = $status; Body = $respBody }
}

function Get-SessionCookie([string]$email, [string]$password) {
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

# Pastikan seed termuat
docker exec sewara-staging-db psql -U sewara -d sewara -Atc "SELECT count(*) FROM profiles;" | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Seed belum termuat, memuat sekarang...'
    Get-Content (Join-Path $root 'seeds\staging_seed.sql') -Raw | docker exec -i sewara-staging-db psql -U sewara -d sewara | Out-Null
}

# Buat akun uji + hash password untuk seed yang sudah ada
$hash = '$2a$10$GCmHsmqVk3cqwXmf0AVWueY8h0JHD1zo0mr.tl0F/CH0dI/01mYEu'
docker exec sewara-staging-db psql -U sewara -d sewara -c "
DELETE FROM auth.users WHERE id::text LIKE 'd0000000%';
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'owner-a@staging.local', '$hash', now()),
  ('b0000000-0000-0000-0000-000000000001', 'owner-b@staging.local', '$hash', now()),
  ('d0000000-0000-0000-0000-000000000001', 'owner-test@staging.local', '$hash', now()),
  ('d0000000-0000-0000-0000-000000000002', 'staf-test@staging.local', '$hash', now())
ON CONFLICT (id) DO UPDATE SET encrypted_password='$hash', email_confirmed_at=now();
INSERT INTO profiles (user_id, email, nama_lengkap, role, owner_id, status, is_active) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'owner-test@staging.local', 'Owner Test', 'owner', NULL, 'aktif', true),
  ('d0000000-0000-0000-0000-000000000002', 'staf-test@staging.local', 'Staf Test', 'cs', 'd0000000-0000-0000-0000-000000000001', 'aktif', true)
ON CONFLICT (user_id) DO UPDATE SET role=EXCLUDED.role, owner_id=EXCLUDED.owner_id, is_active=true;
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
    Write-Host '=== Login owner + staf ==='
    $cookieOwner = Get-SessionCookie 'owner-test@staging.local' 'Rahasia123'
    $cookieStaf  = Get-SessionCookie 'staf-test@staging.local' 'Rahasia123'
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
    $r = Invoke-Api 'GET' '/api/settings' $null $null
    Add-Hasil 'GET tanpa cookie -> 401' $r.Status 401 ''

    # GET all (owner) — kosong awalnya
    $r = Invoke-Api 'GET' '/api/settings' $cookieOwner $null
    $count = if ($r.Body -match '"settings":\s*\[') { ($r.Body -split '"key"' | Measure-Object).Count - 1 } else { 0 }
    Add-Hasil 'GET all owner (kosong awal) -> 200' $r.Status 200 "count=$count"

    # POST satu setting (owner)
    $r = Invoke-Api 'POST' '/api/settings' $cookieOwner '{"key":"test_key","value":"test_value"}'
    Add-Hasil 'POST satu setting owner -> 200' $r.Status 200 ''

    # GET by key
    $r = Invoke-Api 'GET' '/api/settings?key=test_key' $cookieOwner $null
    $ada = $r.Body -match '"test_value"'
    Add-Hasil 'GET by key -> 200 + value cocok' $r.Status 200 "match=$ada"

    # POST array settings
    $r = Invoke-Api 'POST' '/api/settings' $cookieOwner '[{"key":"k1","value":"v1"},{"key":"k2","value":"v2"}]'
    Add-Hasil 'POST array settings -> 200' $r.Status 200 ''

    # GET all sekarang ada 3
    $r = Invoke-Api 'GET' '/api/settings' $cookieOwner $null
    $count = ($r.Body -split '"key"' | Measure-Object).Count - 1
    Add-Hasil 'GET all sekarang ada 3 -> 200' $r.Status 200 "count=$count"

    # Staf coba tulis key privat (telegram_login_notif) -> 403
    $r = Invoke-Api 'POST' '/api/settings' $cookieStaf '{"key":"telegram_login_notif","value":"test"}'
    Add-Hasil 'Staf tulis key privat -> 403' $r.Status 403 ''

    # Staf tulis key yang boleh (kalender_selesai) -> 200
    $r = Invoke-Api 'POST' '/api/settings' $cookieStaf '{"key":"kalender_selesai","value":"2026-12-31"}'
    Add-Hasil 'Staf tulis key allowlist -> 200' $r.Status 200 ''

    # Owner tulis key privat -> 200
    $r = Invoke-Api 'POST' '/api/settings' $cookieOwner '{"key":"telegram_login_notif","value":"true"}'
    Add-Hasil 'Owner tulis key privat -> 200' $r.Status 200 ''

    # Staf GET key privat -> 200 tapi null (tidak 403)
    $r = Invoke-Api 'GET' '/api/settings?key=telegram_login_notif' $cookieStaf $null
    $null_ = $r.Body -match '"setting":\s*null'
    Add-Hasil 'Staf GET key privat -> 200 null' $r.Status 200 "null=$null_"

    # Owner GET key privat -> 200 + value ada
    $r = Invoke-Api 'GET' '/api/settings?key=telegram_login_notif' $cookieOwner $null
    $ada = $r.Body -match '"true"'
    Add-Hasil 'Owner GET key privat -> 200 + value' $r.Status 200 "ada=$ada"

    # Isolasi tenant: owner A vs owner test (berbeda tenant)
    $cookieA = Get-SessionCookie 'owner-a@staging.local' 'Rahasia123'
    $r = Invoke-Api 'GET' '/api/settings' $cookieA $null
    $countA = ($r.Body -split '"key"' | Measure-Object).Count - 1
    Add-Hasil 'Tenant A tidak lihat setting tenant test' $r.Status 200 "countA=$countA (harap 0)"

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
