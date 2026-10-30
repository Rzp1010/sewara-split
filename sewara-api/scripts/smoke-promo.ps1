# smoke-promo.ps1 — uji CRUD promo Go
#
# Cakupan: GET/POST/PATCH/DELETE, validasi, isolasi tenant, duplikat kode,
# tandai expired otomatis.

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
  ('a0000000-0000-0000-0000-000000000002', 'cs-a@staging.local',    '$hash', now()),
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

    # =========================================================================
    # GET /api/promo — list awal (seed punya 2 promo tenant A)
    # =========================================================================
    $r = Invoke-Api 'GET' '/api/promo' $null ''
    Add-Hasil 'GET tanpa cookie -> 401' ($r.Status -eq 401) "status=$($r.Status)"

    $r = Invoke-Api 'GET' '/api/promo' $ownerA ''
    $n = ([regex]::Matches($r.Body, '"id":')).Count
    Add-Hasil 'GET owner A -> 200 + seed 2 promo' `
        ($r.Status -eq 200 -and $n -eq 2) `
        "status=$($r.Status) count=$n"

    # =========================================================================
    # POST /api/promo — buat promo
    # =========================================================================
    $r = Invoke-Api 'POST' '/api/promo' $null '{"kode":"TEST10"}'
    Add-Hasil 'POST tanpa cookie -> 401' ($r.Status -eq 401) "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/promo' $ownerA '{}'
    Add-Hasil 'POST tanpa kode -> 400' ($r.Status -eq 400) "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/promo' $ownerA '{"kode":"TEST","diskon_persen":150}'
    Add-Hasil 'POST diskon >100 -> 400' ($r.Status -eq 400 -and $r.Body -match '0-100') `
        "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/promo' $ownerA '{"kode":"TEST","diskon_persen":10,"kuota":-5}'
    Add-Hasil 'POST kuota negatif -> 400' ($r.Status -eq 400 -and $r.Body -match 'negatif') `
        "status=$($r.Status)"

    $body1 = '{"kode":"  promo10  ","diskon_persen":10,"kuota":50}'
    $r = Invoke-Api 'POST' '/api/promo' $ownerA $body1
    $id1 = $null
    if ($r.Body -match '"id":(\d+)') { $id1 = $Matches[1] }
    Add-Hasil 'POST valid -> 201 + id' ($r.Status -eq 201 -and $null -ne $id1) "status=$($r.Status) id=$id1"
    Add-Hasil 'POST -> kode uppercase + trim' ($r.Body -cmatch '"kode":"PROMO10"') "body=$($r.Body)"
    Add-Hasil 'POST -> status default aktif' ($r.Body -match '"status":"aktif"') "body=$($r.Body)"
    Add-Hasil 'POST -> terpakai default 0' ($r.Body -match '"terpakai":0') "body=$($r.Body)"

    # Duplikat kode per tenant
    $r = Invoke-Api 'POST' '/api/promo' $ownerA $body1
    Add-Hasil 'POST duplikat kode -> 409 PROMO_DUPLIKAT' `
        ($r.Status -eq 409 -and $r.Body -match 'PROMO_DUPLIKAT') `
        "status=$($r.Status)"

    # Tenant B bisa pakai kode sama
    $r = Invoke-Api 'POST' '/api/promo' $ownerB $body1
    Add-Hasil 'POST tenant B kode sama -> 201 (isolasi)' ($r.Status -eq 201) "status=$($r.Status)"

    $body2 = '{"kode":"DISKON20","diskon_persen":20,"status":"nonaktif"}'
    $r = Invoke-Api 'POST' '/api/promo' $ownerA $body2
    $id2 = $null
    if ($r.Body -match '"id":(\d+)') { $id2 = $Matches[1] }
    Add-Hasil 'POST status nonaktif -> 201' ($r.Status -eq 201 -and $null -ne $id2) "id=$id2"

    # =========================================================================
    # GET /api/promo — setelah tambah 2 baru
    # =========================================================================
    $r = Invoke-Api 'GET' '/api/promo' $ownerA ''
    $n = ([regex]::Matches($r.Body, '"id":')).Count
    Add-Hasil 'GET owner A -> 4 promo (seed 2 + baru 2)' ($n -eq 4) "count=$n"

    $r = Invoke-Api 'GET' '/api/promo' $ownerB ''
    $n = ([regex]::Matches($r.Body, '"id":')).Count
    Add-Hasil 'GET owner B -> 3 promo (seed 2 + baru 1, isolasi)' ($n -eq 3) "count=$n"

    # =========================================================================
    # PATCH /api/promo/{id}
    # =========================================================================
    $r = Invoke-Api 'PATCH' "/api/promo/$id1" $null '{"diskon_persen":15}'
    Add-Hasil 'PATCH tanpa cookie -> 401' ($r.Status -eq 401) "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' "/api/promo/$id1" $ownerA '{"kode":""}'
    Add-Hasil 'PATCH kode kosong -> 400' ($r.Status -eq 400 -and $r.Body -match 'kosong') `
        "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' "/api/promo/$id1" $ownerA '{"diskon_persen":200}'
    Add-Hasil 'PATCH diskon >100 -> 400' ($r.Status -eq 400) "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' "/api/promo/$id1" $ownerA '{"diskon_persen":15,"kuota":100}'
    Add-Hasil 'PATCH valid -> 200' ($r.Status -eq 200) "status=$($r.Status)"
    Add-Hasil 'PATCH -> diskon berubah' ($r.Body -match '"diskon_persen":15') "body=$($r.Body)"

    $r = Invoke-Api 'PATCH' "/api/promo/$id1" $ownerA '{"kode":"DISKON20"}'
    Add-Hasil 'PATCH kode jadi duplikat -> 409' ($r.Status -eq 409 -and $r.Body -match 'PROMO_DUPLIKAT') `
        "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' "/api/promo/$id1" $ownerB '{"diskon_persen":50}'
    Add-Hasil 'PATCH id tenant lain -> 404' ($r.Status -eq 404) "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' '/api/promo/999999' $ownerA '{"diskon_persen":10}'
    Add-Hasil 'PATCH id tidak ada -> 404' ($r.Status -eq 404) "status=$($r.Status)"

    # =========================================================================
    # Tandai expired otomatis
    # =========================================================================
    docker exec sewara-staging-db psql -U sewara -d sewara -c "
    INSERT INTO promo_codes (user_id, kode, diskon_persen, berlaku_sampai, status)
    VALUES ('a0000000-0000-0000-0000-000000000001', 'EXPIRED1', 10, now() - interval '1 day', 'aktif');
    " | Out-Null

    $r = Invoke-Api 'GET' '/api/promo' $ownerA ''
    Add-Hasil 'GET auto-tandai expired tanggal lewat' ($r.Body -match '"kode":"EXPIRED1".*"status":"expired"') `
        "body=$($r.Body)"

    docker exec sewara-staging-db psql -U sewara -d sewara -c "
    INSERT INTO promo_codes (user_id, kode, diskon_persen, kuota, terpakai, status)
    VALUES ('a0000000-0000-0000-0000-000000000001', 'HABIS', 10, 5, 5, 'aktif');
    " | Out-Null

    $r = Invoke-Api 'GET' '/api/promo' $ownerA ''
    Add-Hasil 'GET auto-tandai expired kuota habis' ($r.Body -match '"kode":"HABIS".*"status":"expired"') `
        "body=$($r.Body)"

    # =========================================================================
    # DELETE /api/promo/{id}
    # =========================================================================
    $r = Invoke-Api 'DELETE' "/api/promo/$id1" $null ''
    Add-Hasil 'DELETE tanpa cookie -> 401' ($r.Status -eq 401) "status=$($r.Status)"

    $r = Invoke-Api 'DELETE' "/api/promo/$id1" $ownerB ''
    Add-Hasil 'DELETE id tenant lain -> 404' ($r.Status -eq 404) "status=$($r.Status)"

    $r = Invoke-Api 'DELETE' "/api/promo/$id1" $ownerA ''
    Add-Hasil 'DELETE valid -> 200' ($r.Status -eq 200) "status=$($r.Status)"

    $r = Invoke-Api 'DELETE' "/api/promo/$id1" $ownerA ''
    Add-Hasil 'DELETE id sudah dihapus -> 404' ($r.Status -eq 404) "status=$($r.Status)"

    $r = Invoke-Api 'GET' '/api/promo' $ownerA ''
    $n = ([regex]::Matches($r.Body, '"id":')).Count
    Add-Hasil 'GET setelah delete -> 5 promo (4+2 expired -1 delete)' ($n -eq 5) "count=$n"

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
