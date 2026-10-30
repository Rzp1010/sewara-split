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

function Invoke-Sql([string]$sql) {
    $out = docker exec sewara-staging-db psql -U sewara -d sewara -At -c $sql
    if ($LASTEXITCODE -ne 0) { throw "psql gagal: $sql" }
    return ($out -join "`n").Trim()
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
DELETE FROM settings WHERE user_id::text LIKE 'd0000000%';
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

    # Seed punya tiga settings owner A; akun test diuji terpisah.
    $cookieA = Get-SessionCookie 'owner-a@staging.local' 'Rahasia123'
    $r = Invoke-Api 'GET' '/api/settings' $cookieA $null
    $seedData = $null
    try { $seedData = ($r.Body | ConvertFrom-Json).data.settings } catch {}
    $seedCount = if ($null -eq $seedData) { 0 } else { @($seedData).Count }
    $seedOK = $r.Status -eq 200 -and $seedCount -eq 3
    Add-Hasil 'Seed owner A -> 3 setting' ([int]$seedOK) 1 "HTTP=$($r.Status) count=$seedCount"
    if (-not $seedOK) { throw 'Seed settings owner A tidak sesuai; isolasi tenant tidak dapat diverifikasi.' }
    $ownerBaseline = Invoke-Api 'GET' '/api/settings' $cookieOwner $null
    $ownerBaselineData = $null
    try { $ownerBaselineData = ($ownerBaseline.Body | ConvertFrom-Json).data.settings } catch {}
    $ownerBaselineCount = if ($null -eq $ownerBaselineData) { 0 } else { @($ownerBaselineData).Count }
    $ownerBaselineOK = $ownerBaseline.Status -eq 200 -and $ownerBaselineCount -eq 0
    Add-Hasil 'Owner test mulai tanpa settings' ([int]$ownerBaselineOK) 1 "HTTP=$($ownerBaseline.Status) count=$ownerBaselineCount"
    if (-not $ownerBaselineOK) { throw 'Owner test tidak bersih; isolasi tenant tidak dapat diverifikasi.' }

    # POST satu setting (owner)
    $r = Invoke-Api 'POST' '/api/settings' $cookieOwner '{"key":"test_key","value":"test_value"}'
    $postOneOK = $r.Status -eq 200 -and ($r.Body | ConvertFrom-Json).ok
    Add-Hasil 'POST satu setting owner -> tersimpan' ([int]$postOneOK) 1 "HTTP=$($r.Status)"

    # GET by key
    $r = Invoke-Api 'GET' '/api/settings?key=test_key' $cookieOwner $null
    $ada = $r.Body -match '"test_value"'
    Add-Hasil 'GET by key -> 200 + value cocok' ([int]($r.Status -eq 200 -and $ada)) 1 "HTTP=$($r.Status) match=$ada"

    # POST array settings
    $r = Invoke-Api 'POST' '/api/settings' $cookieOwner '[{"key":"k1","value":"v1"},{"key":"k2","value":"v2"}]'
    $postArrayOK = $r.Status -eq 200 -and ($r.Body | ConvertFrom-Json).ok
    Add-Hasil 'POST array settings -> diterima' ([int]$postArrayOK) 1 "HTTP=$($r.Status)"

    # Tiga key milik owner test setelah array upsert; validasi konten.
    $r = Invoke-Api 'GET' '/api/settings' $cookieOwner $null
    $ownerData = ($r.Body | ConvertFrom-Json).data.settings
    $ownerKeys = @($ownerData | ForEach-Object { $_.key } | Sort-Object)
    $ownerCount = if ($null -eq $ownerData) { 0 } else { @($ownerData).Count }
    $ownerKeysOK = $r.Status -eq 200 -and $ownerCount -eq 3 -and ($ownerKeys -join ',') -eq 'k1,k2,test_key'
    Add-Hasil 'Owner test memiliki tiga key sendiri' ([int]$ownerKeysOK) 1 "HTTP=$($r.Status) count=$ownerCount keys=$($ownerKeys -join ',')"

    # Staf coba tulis key privat (telegram_login_notif) -> 403
    $r = Invoke-Api 'POST' '/api/settings' $cookieStaf '{"key":"telegram_login_notif","value":"test"}'
    Add-Hasil 'Staf tulis key privat -> 403' $r.Status 403 ''

    # Staf tulis key yang boleh (kalender_selesai) -> 200
    $r = Invoke-Api 'POST' '/api/settings' $cookieStaf '{"key":"kalender_selesai","value":"2026-12-31"}'
    $staffWriteOK = $r.Status -eq 200 -and ($r.Body | ConvertFrom-Json).ok
    Add-Hasil 'Staf tulis key allowlist -> tersimpan' ([int]$staffWriteOK) 1 "HTTP=$($r.Status)"

    # G4: baris kalender_selesai staf harus memakai user_id OWNER tenant, bukan id staf.
    $kalOwner  = Invoke-Sql "SELECT value FROM settings WHERE key='kalender_selesai' AND user_id='d0000000-0000-0000-0000-000000000001';"
    $kalStafRow = Invoke-Sql "SELECT count(*) FROM settings WHERE key='kalender_selesai' AND user_id='d0000000-0000-0000-0000-000000000002';"
    $kalTenantOK = $kalOwner -eq '2026-12-31' -and $kalStafRow -eq '0'
    Add-Hasil 'Staf tulis kalender_selesai -> baris di OWNER tenant' ([int]$kalTenantOK) 1 "ownerValue=$kalOwner stafRow=$kalStafRow"

    # Owner tenant membaca kalender_selesai yang ditulis staf.
    $r = Invoke-Api 'GET' '/api/settings?key=kalender_selesai' $cookieOwner $null
    $ownerKalOK = $r.Status -eq 200 -and $r.Body -match '2026-12-31'
    Add-Hasil 'Owner baca kalender_selesai dari staf' ([int]$ownerKalOK) 1 "HTTP=$($r.Status)"

    # T3: baca satu key selalu scope tenant (user_id), bukan baris pribadi pemanggil.
    # Disemai baris kembar milik staf untuk key yang sama: tanpa scope eksplisit,
    # urutan baris hasil RLS tidak dijamin. Baris tenant belum ada → harus null.
    Invoke-Sql "INSERT INTO settings (user_id, key, value) VALUES ('d0000000-0000-0000-0000-000000000002','kalender_selesai','""bukan-tenant""') ON CONFLICT (user_id, key) DO UPDATE SET value=EXCLUDED.value;" | Out-Null
    Invoke-Sql "DELETE FROM settings WHERE key='kalender_selesai' AND user_id='d0000000-0000-0000-0000-000000000001';" | Out-Null
    $r = Invoke-Api 'GET' '/api/settings?key=kalender_selesai' $cookieStaf $null
    $scopeNullOK = $r.Status -eq 200 -and $r.Body -match '"setting":\s*null'
    Add-Hasil 'Staf GET key tanpa baris tenant -> null (bukan baris staf)' ([int]$scopeNullOK) 1 "HTTP=$($r.Status) body=$($r.Body)"
    Invoke-Sql "INSERT INTO settings (user_id, key, value) VALUES ('d0000000-0000-0000-0000-000000000001','kalender_selesai','""2026-12-31""') ON CONFLICT (user_id, key) DO UPDATE SET value=EXCLUDED.value;" | Out-Null

    # Owner tulis key privat -> 200
    $r = Invoke-Api 'POST' '/api/settings' $cookieOwner '{"key":"telegram_login_notif","value":"true"}'
    $ownerPrivateWriteOK = $r.Status -eq 200 -and ($r.Body | ConvertFrom-Json).ok
    Add-Hasil 'Owner tulis key privat -> tersimpan' ([int]$ownerPrivateWriteOK) 1 "HTTP=$($r.Status)"

    # Staf GET key privat -> 200 tapi null (tidak 403)
    $r = Invoke-Api 'GET' '/api/settings?key=telegram_login_notif' $cookieStaf $null
    $null_ = $r.Body -match '"setting":\s*null'
    Add-Hasil 'Staf GET key privat -> null' ([int]($r.Status -eq 200 -and $null_)) 1 "HTTP=$($r.Status) null=$null_"

    # Owner GET key privat -> 200 + value ada
    $r = Invoke-Api 'GET' '/api/settings?key=telegram_login_notif' $cookieOwner $null
    $ada = $r.Body -match '"true"'
    Add-Hasil 'Owner GET key privat -> value ada' ([int]($r.Status -eq 200 -and $ada)) 1 "HTTP=$($r.Status) ada=$ada"

    # Owner A tetap hanya melihat tiga seed settings miliknya.
    $r = Invoke-Api 'GET' '/api/settings' $cookieA $null
    $tenantAData = $null
    try { $tenantAData = ($r.Body | ConvertFrom-Json).data.settings } catch {}
    $tenantAKeys = @($tenantAData | ForEach-Object { $_.key } | Sort-Object)
    $tenantACount = if ($null -eq $tenantAData) { 0 } else { @($tenantAData).Count }
    $terisolasi = $r.Status -eq 200 -and $tenantACount -eq 3 -and ($tenantAKeys -join ',') -eq 'daftar_jaminan,invoice_counter,notif_jam'
    Add-Hasil 'Owner A hanya lihat tiga key seed sendiri' ([int]$terisolasi) 1 "HTTP=$($r.Status) count=$tenantACount keys=$($tenantAKeys -join ',')"

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
