# smoke-blacklist.ps1 — uji domain blacklist Go
#
# Cakupan: GET/POST/PATCH/DELETE + check + kontrak storage-off + guard header.
# R2 sengaja dikosongkan; unggah/proxy bucket nyata perlu smoke terpisah dengan
# bucket dev terisolasi.
#
# Pola reset: Docker staging di-reset sebelum tes supaya jumlah baris eksak
# dan hasil bisa diulang.

$ErrorActionPreference = 'Stop'
$root   = Split-Path -Parent $PSScriptRoot
$apiExe = Join-Path $root '.data\bin\sewara-api.exe'
$apiURL = 'http://127.0.0.1:8099'
$tmpDir = Join-Path $env:TEMP 'opencode'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$env:PATH = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:PATH"

$ownerAId = 'a0000000-0000-0000-0000-000000000001'

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

function Invoke-MultipartApi([string]$path, [string]$cookie, [hashtable]$fields, [string]$filePath, [string]$mimeType) {
    $outFile = Join-Path $tmpDir 'api-out.bin'
    $curlArgs = @('-s', '--max-time', '30', '-o', $outFile, '-w', '%{http_code}', '-X', 'POST')
    if ($cookie) { $curlArgs += @('-H', "Cookie: sewara_session=$cookie") }
    foreach ($k in $fields.Keys) { $curlArgs += @('-F', "$k=$($fields[$k])") }
    if ($filePath) { $curlArgs += @('-F', "file=@$filePath;type=$mimeType") }
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

function Sql([string]$query) {
    return ($query | docker exec -i sewara-staging-db psql -U sewara -d sewara -Atq)
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
# Storage dikosongkan supaya smoke bisa jalan tanpa R2 sungguhan.
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
    $ownerB = Get-SessionCookie 'owner-b@staging.local'
    $csA    = Get-SessionCookie 'cs-a@staging.local'

    $hasil = @()
    function Add-Hasil([string]$nama, [bool]$lolos, [string]$info) {
        $script:hasil += [pscustomobject]@{
            Skenario = $nama
            Hasil    = $(if ($lolos) { 'LOLOS' } else { 'GAGAL' })
            Info     = $info
        }
    }

    # =========================================================================
    # GET /api/blacklist — daftar kosong awal
    # =========================================================================
    $r = Invoke-Api 'GET' '/api/blacklist' $null ''
    Add-Hasil 'GET tanpa cookie -> 401' ($r.Status -eq 401) "status=$($r.Status)"

    $r = Invoke-Api 'GET' '/api/blacklist' $ownerA ''
    Add-Hasil 'GET owner A -> 200 + array kosong' `
        ($r.Status -eq 200 -and $r.Body -match '"blacklist":\[\]') `
        "status=$($r.Status) body=$($r.Body)"

    # =========================================================================
    # POST /api/blacklist — buat entri
    # =========================================================================
    $r = Invoke-Api 'POST' '/api/blacklist' $null '{"nama":"Budi","hp":"08123","alasan":"Kabur"}'
    Add-Hasil 'POST tanpa cookie -> 401' ($r.Status -eq 401) "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/blacklist' $csA '{"nama":"Budi","hp":"08123","alasan":"Kabur"}'
    Add-Hasil 'POST oleh staf -> 403' ($r.Status -eq 403) "status=$($r.Status) body=$($r.Body)"

    $r = Invoke-Api 'POST' '/api/blacklist' $ownerA '{"alasan":"X","hp":"081"}'
    Add-Hasil 'POST tanpa nama -> 400' ($r.Status -eq 400 -and $r.Body -match 'Nama wajib') `
        "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/blacklist' $ownerA '{"nama":"Budi","alasan":"Kabur"}'
    Add-Hasil 'POST tanpa HP -> 400' ($r.Status -eq 400 -and $r.Body -match 'HP wajib') `
        "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/blacklist' $ownerA '{"nama":"Budi","hp":"081","alasan":""}'
    Add-Hasil 'POST alasan kosong -> 400' ($r.Status -eq 400 -and $r.Body -match 'Alasan wajib') `
        "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/blacklist' $ownerA '{"nama":"Budi","hp":"081","alasan":"X","transaksiId":"bukan-uuid"}'
    Add-Hasil 'POST transaksiId bukan UUID -> 400' ($r.Status -eq 400 -and $r.Body -match 'UUID') `
        "status=$($r.Status)"

    $body1 = '{"nama":"Budi Santoso","hp":"0812-345-6789","alasan":"Kabur tidak bayar","alamat":"Jl. A No.1"}'
    $r = Invoke-Api 'POST' '/api/blacklist' $ownerA $body1
    $id1 = $null
    if ($r.Body -match '"id":"([0-9a-f-]{36})"') { $id1 = $Matches[1] }
    Add-Hasil 'POST valid -> 201 + id' `
        ($r.Status -eq 201 -and $null -ne $id1) `
        "status=$($r.Status) id=$id1"

    Add-Hasil 'POST -> nama tersimpan' ($r.Body -cmatch '"nama":"Budi Santoso"') "body=$($r.Body)"
    Add-Hasil 'POST -> fotoJaminan array kosong' ($r.Body -cmatch '"fotoJaminan":\[\]') "body=$($r.Body)"
    Add-Hasil 'POST -> addedBy terisi (user yang login)' `
        ($r.Body -cmatch "`"addedBy`":`"$ownerAId`"") `
        "body=$($r.Body)"

    # Duplikat: nama+HP sama
    $r = Invoke-Api 'POST' '/api/blacklist' $ownerA $body1
    Add-Hasil 'POST duplikat nama+HP -> 409 BLACKLIST_DUPLIKAT' `
        ($r.Status -eq 409 -and $r.Body -match 'BLACKLIST_DUPLIKAT') `
        "status=$($r.Status)"

    # HP berbeda -> bukan duplikat
    $r = Invoke-Api 'POST' '/api/blacklist' $ownerA '{"nama":"Budi Santoso","hp":"0888-000-0001","alasan":"HP beda"}'
    $id2 = $null
    if ($r.Body -match '"id":"([0-9a-f-]{36})"') { $id2 = $Matches[1] }
    Add-Hasil 'POST nama sama HP beda -> 201 (bukan duplikat)' `
        ($r.Status -eq 201 -and $null -ne $id2) `
        "status=$($r.Status) id=$id2"

    # Tenant B tidak melihat data tenant A
    $r = Invoke-Api 'GET' '/api/blacklist' $ownerB ''
    Add-Hasil 'GET tenant B -> daftar kosong (isolasi)' `
        ($r.Status -eq 200 -and $r.Body -match '"blacklist":\[\]') `
        "body=$($r.Body)"

    # POST tenant B bisa buat entrinya sendiri
    $r = Invoke-Api 'POST' '/api/blacklist' $ownerB '{"nama":"Candra","hp":"0813111","alasan":"Rusak"}'
    Add-Hasil 'POST tenant B -> 201 terpisah' ($r.Status -eq 201) "status=$($r.Status)"

    # =========================================================================
    # GET /api/blacklist — setelah data masuk
    # =========================================================================
    $r = Invoke-Api 'GET' '/api/blacklist' $ownerA ''
    $n = ([regex]::Matches($r.Body, '"id":"')).Count
    Add-Hasil "GET owner A -> 2 entri ($n)" ($n -eq 2) "count=$n"

    # =========================================================================
    # GET /api/blacklist/check
    # =========================================================================
    $r = Invoke-Api 'GET' '/api/blacklist/check' $null ''
    Add-Hasil 'check tanpa cookie -> 401' ($r.Status -eq 401) "status=$($r.Status)"

    # Tidak cocok: nama tidak ada
    $r = Invoke-Api 'GET' '/api/blacklist/check?nama=Siapa&hp=0812-345-6789' $ownerA ''
    Add-Hasil 'check nama tidak ada -> hit:false' `
        ($r.Status -eq 200 -and $r.Body -match '"hit":false') `
        "body=$($r.Body)"

    # Tidak cocok: nama ada tapi HP beda
    $r = Invoke-Api 'GET' '/api/blacklist/check?nama=Budi+Santoso&hp=0999999' $ownerA ''
    Add-Hasil 'check HP beda -> hit:false' `
        ($r.Status -eq 200 -and $r.Body -match '"hit":false') `
        "body=$($r.Body)"

    # Cocok: normalisasi HP (0812-345-6789 -> 6812345678 -> match)
    $r = Invoke-Api 'GET' '/api/blacklist/check?nama=Budi+Santoso&hp=0812-345-6789' $ownerA ''
    Add-Hasil 'check pasangan cocok -> hit:true + alasan' `
        ($r.Status -eq 200 -and $r.Body -match '"hit":true' -and $r.Body -match '"alasan"') `
        "body=$($r.Body)"

    # Tenant B tidak bisa mencocokkan data tenant A
    $r = Invoke-Api 'GET' '/api/blacklist/check?nama=Budi+Santoso&hp=0812-345-6789' $ownerB ''
    Add-Hasil 'check tenant B tidak temukan data A -> hit:false' `
        ($r.Status -eq 200 -and $r.Body -match '"hit":false') `
        "body=$($r.Body)"

    # =========================================================================
    # PATCH /api/blacklist/{id}
    # =========================================================================
    $r = Invoke-Api 'PATCH' "/api/blacklist/$id1" $null '{"nama":"X"}'
    Add-Hasil 'PATCH tanpa cookie -> 401' ($r.Status -eq 401) "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' "/api/blacklist/$id1" $csA '{"nama":"X"}'
    Add-Hasil 'PATCH oleh staf -> 403' ($r.Status -eq 403) "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' "/api/blacklist/$id1" $ownerA '{}'
    Add-Hasil 'PATCH body kosong -> 400 Tidak ada perubahan' `
        ($r.Status -eq 400 -and $r.Body -match 'Tidak ada perubahan') `
        "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' "/api/blacklist/$id1" $ownerA '{"nama":""}'
    Add-Hasil 'PATCH nama kosong -> 400' ($r.Status -eq 400 -and $r.Body -match 'Nama') `
        "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' "/api/blacklist/$id1" $ownerA '{"alasan":""}'
    Add-Hasil 'PATCH alasan kosong -> 400' ($r.Status -eq 400 -and $r.Body -match 'Alasan') `
        "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' "/api/blacklist/$id1" $ownerA '{"hp":""}'
    Add-Hasil 'PATCH HP kosong -> 400' ($r.Status -eq 400 -and $r.Body -match 'HP') `
        "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' "/api/blacklist/$id1" $ownerA '{"alasan":"Sudah terbukti jelas"}'
    Add-Hasil 'PATCH alasan valid -> 200 + field baru' `
        ($r.Status -eq 200 -and $r.Body -match 'Sudah terbukti jelas') `
        "status=$($r.Status)"

    # PATCH dari tenant B ke id milik A -> 404 (RLS menyaring)
    $r = Invoke-Api 'PATCH' "/api/blacklist/$id1" $ownerB '{"alasan":"X"}'
    Add-Hasil 'PATCH id tenant lain -> 404' ($r.Status -eq 404) "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' '/api/blacklist/00000000-0000-0000-0000-000000000000' $ownerA '{"alasan":"X"}'
    Add-Hasil 'PATCH id tidak ada -> 404' ($r.Status -eq 404) "status=$($r.Status)"

    # =========================================================================
    # DELETE /api/blacklist/{id}
    # =========================================================================
    $r = Invoke-Api 'DELETE' "/api/blacklist/$id1" $null ''
    Add-Hasil 'DELETE tanpa cookie -> 401' ($r.Status -eq 401) "status=$($r.Status)"

    $r = Invoke-Api 'DELETE' "/api/blacklist/$id1" $csA ''
    Add-Hasil 'DELETE oleh staf -> 403' ($r.Status -eq 403) "status=$($r.Status)"

    $r = Invoke-Api 'DELETE' "/api/blacklist/$id1" $ownerB ''
    Add-Hasil 'DELETE id tenant lain -> 404' ($r.Status -eq 404) "status=$($r.Status)"

    $r = Invoke-Api 'DELETE' "/api/blacklist/$id1" $ownerA ''
    Add-Hasil 'DELETE valid -> 200' ($r.Status -eq 200) "status=$($r.Status)"

    $r = Invoke-Api 'DELETE' "/api/blacklist/$id1" $ownerA ''
    Add-Hasil 'DELETE id sudah dihapus -> 404' ($r.Status -eq 404) "status=$($r.Status)"

    $r = Invoke-Api 'GET' '/api/blacklist' $ownerA ''
    $n = ([regex]::Matches($r.Body, '"id":"')).Count
    Add-Hasil 'GET setelah delete -> tinggal 1 entri' ($n -eq 1) "count=$n"

    # =========================================================================
    # upload + header: dilewati tanpa storage
    # =========================================================================
    $r = Invoke-Api 'POST' '/api/blacklist/upload' $ownerA ''
    Add-Hasil 'upload tanpa storage -> 503' ($r.Status -eq 503) "status=$($r.Status)"

    $r = Invoke-Api 'GET' "/api/blacklist/header?path=blacklist/$ownerAId/test.jpg" $ownerA ''
    Add-Hasil 'header tanpa storage -> 503' ($r.Status -eq 503) "status=$($r.Status)"

    # =========================================================================
    # /api/blacklist/header — guard path
    # =========================================================================
    # Uji guard prefix tanpa storage: path blacklist tenant lain -> 403 (guard
    # diperiksa SEBELUM membaca bucket)
    $ownerBId = 'b0000000-0000-0000-0000-000000000001'
    $r = Invoke-Api 'GET' "/api/blacklist/header?path=blacklist/$ownerBId/foto.jpg" $ownerA ''
    Add-Hasil 'header path tenant lain -> 403' ($r.Status -eq 403) "status=$($r.Status)"

    $r = Invoke-Api 'GET' '/api/blacklist/header' $ownerA ''
    Add-Hasil 'header tanpa path param -> 400' ($r.Status -eq 400) "status=$($r.Status)"

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
