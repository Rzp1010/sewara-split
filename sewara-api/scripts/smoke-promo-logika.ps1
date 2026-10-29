# smoke-promo-logika.ps1 — uji validate + use promo Go
#
# Cakupan: validate (valid/expired/nonaktif/not found), use (increment terpakai,
# concurrency guard, auto-expired kuota habis).

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
  ('a0000000-0000-0000-0000-000000000001', 'owner-a@staging.local', '$hash', now())
ON CONFLICT (id) DO UPDATE SET encrypted_password='$hash', email_confirmed_at=now();
" | Out-Null

$env:DATABASE_URL = 'postgres://sewara:sewara123@127.0.0.1:5433/sewara?sslmode=disable'
$env:ADDR         = '127.0.0.1:8099'
$env:APP_ENV      = 'development'
$env:R2_ENDPOINT          = ''
$env:R2_ACCESS_KEY_ID     = ''
$env:R2_SECRET_ACCESS_KEY = ''
$env:R2_BUCKET            = ''

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

    $hasil = @()
    function Add-Hasil([string]$nama, [bool]$lolos, [string]$info) {
        $script:hasil += [pscustomobject]@{
            Skenario = $nama
            Hasil    = $(if ($lolos) { 'LOLOS' } else { 'GAGAL' })
            Info     = $info
        }
    }

    # Buat promo untuk uji.
    docker exec sewara-staging-db psql -U sewara -d sewara -c "
    TRUNCATE promo_codes CASCADE;
    INSERT INTO promo_codes (id, user_id, kode, diskon_persen, berlaku_sampai, kuota, terpakai, status)
    OVERRIDING SYSTEM VALUE VALUES
    (10, 'a0000000-0000-0000-0000-000000000001', 'VALID10', 10, now() + interval '1 year', 100, 0, 'aktif'),
    (11, 'a0000000-0000-0000-0000-000000000001', 'EXPIRED-DATE', 10, now() - interval '1 day', 100, 0, 'aktif'),
    (12, 'a0000000-0000-0000-0000-000000000001', 'NONAKTIF', 10, now() + interval '1 year', 100, 0, 'nonaktif'),
    (13, 'a0000000-0000-0000-0000-000000000001', 'KUOTA2', 10, now() + interval '1 year', 2, 0, 'aktif'),
    (14, 'a0000000-0000-0000-0000-000000000001', 'EXPIRED-KUOTA', 10, now() + interval '1 year', 5, 5, 'aktif');
    " | Out-Null

    # =========================================================================
    # POST /api/promo/validate
    # =========================================================================
    $r = Invoke-Api 'POST' '/api/promo/validate' $null '{"id":10}'
    Add-Hasil 'validate tanpa cookie -> 401' ($r.Status -eq 401) "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/promo/validate' $ownerA '{"id":99999}'
    Add-Hasil 'validate id tidak ada -> 200 valid:false' `
        ($r.Status -eq 200 -and $r.Body -match '"valid":false' -and $r.Body -match 'tidak ditemukan') `
        "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/promo/validate' $ownerA '{"id":10}'
    Add-Hasil 'validate promo valid -> 200 valid:true' `
        ($r.Status -eq 200 -and $r.Body -match '"valid":true') `
        "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/promo/validate' $ownerA '{"id":11}'
    Add-Hasil 'validate expired tanggal -> 200 valid:false + error' `
        ($r.Status -eq 200 -and $r.Body -match '"valid":false' -and $r.Body -match 'kedaluwarsa') `
        "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/promo/validate' $ownerA '{"id":14}'
    Add-Hasil 'validate expired kuota -> 200 valid:false + error' `
        ($r.Status -eq 200 -and $r.Body -match '"valid":false' -and $r.Body -match 'kedaluwarsa') `
        "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/promo/validate' $ownerA '{"id":12}'
    Add-Hasil 'validate nonaktif -> 200 valid:false + error' `
        ($r.Status -eq 200 -and $r.Body -match '"valid":false' -and $r.Body -match 'nonaktif') `
        "status=$($r.Status)"

    # =========================================================================
    # POST /api/promo/use
    # =========================================================================
    $r = Invoke-Api 'POST' '/api/promo/use' $null '{"id":10}'
    Add-Hasil 'use tanpa cookie -> 401' ($r.Status -eq 401) "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/promo/use' $ownerA '{"id":99999}'
    Add-Hasil 'use id tidak ada -> 404' ($r.Status -eq 404 -and $r.Body -match 'NOT_FOUND') `
        "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/promo/use' $ownerA '{"id":11}'
    Add-Hasil 'use expired tanggal -> 409 PROMO_EXPIRED' `
        ($r.Status -eq 409 -and $r.Body -match 'PROMO_EXPIRED') `
        "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/promo/use' $ownerA '{"id":12}'
    Add-Hasil 'use nonaktif -> 409 PROMO_INACTIVE' `
        ($r.Status -eq 409 -and $r.Body -match 'PROMO_INACTIVE') `
        "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/promo/use' $ownerA '{"id":10}'
    Add-Hasil 'use valid pertama -> 200' ($r.Status -eq 200) "status=$($r.Status)"

    $terpakai = docker exec sewara-staging-db psql -U sewara -d sewara -Atc "SELECT terpakai FROM promo_codes WHERE id=10"
    Add-Hasil 'use -> terpakai naik 0->1' ($terpakai -eq '1') "terpakai=$terpakai"

    $r = Invoke-Api 'POST' '/api/promo/use' $ownerA '{"id":10}'
    Add-Hasil 'use valid kedua -> 200' ($r.Status -eq 200) "status=$($r.Status)"

    $terpakai = docker exec sewara-staging-db psql -U sewara -d sewara -Atc "SELECT terpakai FROM promo_codes WHERE id=10"
    Add-Hasil 'use -> terpakai naik 1->2' ($terpakai -eq '2') "terpakai=$terpakai"

    # Kuota 2, terpakai 0. Use 2x, habis.
    $r = Invoke-Api 'POST' '/api/promo/use' $ownerA '{"id":13}'
    Add-Hasil 'use kuota2 pertama -> 200' ($r.Status -eq 200) "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/promo/use' $ownerA '{"id":13}'
    Add-Hasil 'use kuota2 kedua (habis) -> 200' ($r.Status -eq 200) "status=$($r.Status)"

    $status = docker exec sewara-staging-db psql -U sewara -d sewara -Atc "SELECT status FROM promo_codes WHERE id=13"
    Add-Hasil 'use kuota habis -> status expired' ($status -eq 'expired') "status=$status"

    $r = Invoke-Api 'POST' '/api/promo/use' $ownerA '{"id":13}'
    Add-Hasil 'use kuota habis ketiga -> 409 (EXPIRED atau QUOTA_EXCEEDED)' `
        ($r.Status -eq 409 -and ($r.Body -match 'PROMO_EXPIRED' -or $r.Body -match 'PROMO_QUOTA_EXCEEDED')) `
        "status=$($r.Status) body=$($r.Body)"

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
