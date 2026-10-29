# smoke-inventory-crud.ps1 — uji PATCH/DELETE /api/inventory/{id} + bulk-delete
#
# Kontainer di-reset dulu supaya jumlah baris eksak dan hasil bisa diulang.

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

function Count-Json([string]$body, [string]$key) {
    return ([regex]::Matches($body, [regex]::Escape("`"$key`":")).Count)
}

function Sql([string]$query) {
    return ($query | docker exec -i sewara-staging-db psql -U sewara -d sewara -Atq)
}

$goExe = @("$env:ProgramFiles\Go\bin\go.exe", "$env:LOCALAPPDATA\Programs\Go\bin\go.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
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
& (Join-Path $PSScriptRoot 'docker-staging.ps1') start | Out-Null

$hash = '$2a$10$GCmHsmqVk3cqwXmf0AVWueY8h0JHD1zo0mr.tl0F/CH0dI/01mYEu'
docker exec sewara-staging-db psql -U sewara -d sewara -c "
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'owner-a@staging.local', '$hash', now()),
  ('a0000000-0000-0000-0000-000000000002', 'cs-a@staging.local', '$hash', now()),
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
            Skenario = $nama; Hasil = $(if ($lolos) { 'LOLOS' } else { 'GAGAL' }); Info = $info
        }
    }

    # Siapkan satu paket baru milik tenant A yang nanti dipakai transaksi aktif.
    $r = Invoke-Api 'POST' '/api/inventory' $ownerA '{"jenis":"bundling","nama":"Paket Uji","h24":100000,"komponen":[{"idBarang":"101","qty":1}]}'
    $paketId = $null
    if ($r.Body -match '"inventory":\{"id":(\d+)') { $paketId = $Matches[1] }
    if (-not $paketId) { throw "gagal membuat paket uji: $($r.Body)" }

    Sql @"
INSERT INTO transactions (id,id_transaksi,penyewa,hp_penyewa,status,items,user_id,total_akhir,member_id,created_at,updated_at) VALUES
(3001,'TEST-3001','Pelanggan Uji','081100000009','Booking','[]','$ownerAId',100000,1,now(),now()),
(3002,'TEST-3002','Pelanggan Uji 2','081100000010','Disewa','[]','$ownerAId',100000,1,now(),now());
INSERT INTO transaction_items (id,transaction_id,inventory_id,item_name,item_type,qty,unit_price,subtotal,user_id,created_at,updated_at) VALUES
(9001,3001,$paketId,'Paket Uji','bundling',1,100000,100000,'$ownerAId',now(),now()),
(9002,3001,101,'Barang 101','satuan',1,10000,10000,'$ownerAId',now(),now()),
(9003,3002,102,'Barang 102','satuan',1,10000,10000,'$ownerAId',now(),now());
"@ | Out-Null

    # ---------------- PATCH ----------------
    $r = Invoke-Api 'PATCH' '/api/inventory/102' $null '{"nama":"X"}'
    Add-Hasil 'PATCH tanpa cookie -> 401' ($r.Status -eq 401) "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' '/api/inventory/abc' $ownerA '{"nama":"X"}'
    Add-Hasil 'PATCH id bukan angka -> 400' ($r.Status -eq 400) "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' '/api/inventory/102' $ownerA '{"nama":"Lensa A Baru","h24":55000}'
    $ok = ($r.Status -eq 200) -and ($r.Body -cmatch '"nama":"Lensa A Baru"') -and
          ($r.Body -cmatch '"h24":55000') -and ($r.Body -cmatch '"id":102')
    Add-Hasil 'PATCH ubah nama + tarif -> 200' $ok "status=$($r.Status)"

    # user_id tidak boleh bisa diubah klien
    $r = Invoke-Api 'PATCH' '/api/inventory/102' $ownerA ('{"nama":"Lensa A Baru","user_id":"b0000000-0000-0000-0000-000000000001"}')
    $ok = ($r.Status -eq 200) -and ($r.Body -cmatch "`"user_id`":`"$ownerAId`"")
    Add-Hasil 'PATCH user_id diabaikan (tetap tenant A)' $ok "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' '/api/inventory/101' $ownerB '{"nama":"Diambil B"}'
    Add-Hasil 'PATCH id tenant lain -> 404' ($r.Status -eq 404) "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' '/api/inventory/999999' $ownerA '{"nama":"Hantu"}'
    Add-Hasil 'PATCH id tidak ada -> 404' ($r.Status -eq 404) "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' '/api/inventory/102' $ownerA '{"foo":1}'
    Add-Hasil 'PATCH kolom tak dikenal -> 400' ($r.Status -eq 400) "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' '/api/inventory/102' $ownerA '{}'
    Add-Hasil 'PATCH body kosong -> 400' ($r.Status -eq 400) "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' '/api/inventory/102' $ownerA '{"jenis":"hantu"}'
    Add-Hasil 'PATCH jenis tidak dikenal -> 400' ($r.Status -eq 400) "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' '/api/inventory/102' $ownerA '{"kondisi":"Sangat Rusak"}'
    Add-Hasil 'PATCH kondisi tidak dikenal -> 400' ($r.Status -eq 400) "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' '/api/inventory/102' $ownerA '{"nama":"   "}'
    Add-Hasil 'PATCH nama kosong -> 400' ($r.Status -eq 400) "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' '/api/inventory/102' $ownerA '{"denda":null}'
    $ok = ($r.Status -eq 200) -and ($r.Body -cmatch '"denda":null')
    Add-Hasil 'PATCH denda null -> kolom dikosongkan' $ok "status=$($r.Status)"

    $r = Invoke-Api 'PATCH' "/api/inventory/$paketId" $ownerA '{"komponen":[{"idBarang":"102","qty":3}]}'
    $ok = ($r.Status -eq 409) -and ($r.Body -cmatch '"code":"PAKET_IN_USE"')
    Add-Hasil 'PATCH komponen paket dipakai booking -> 409 PAKET_IN_USE' $ok "status=$($r.Status)"

    # Simpan ulang dengan isi yang sama persis harus boleh
    $r = Invoke-Api 'PATCH' "/api/inventory/$paketId" $ownerA '{"komponen":[{"idBarang":"101","qty":1,"nama":"Kamera A"}]}'
    Add-Hasil 'PATCH komponen sama persis -> 200 (boleh)' ($r.Status -eq 200) "status=$($r.Status)"

    # Guard hanya jalan kalau `komponen` ikut dikirim
    $r = Invoke-Api 'PATCH' "/api/inventory/$paketId" $ownerA '{"nama":"Paket Uji Ganti"}'
    $ok = ($r.Status -eq 200) -and ($r.Body -cmatch '"nama":"Paket Uji Ganti"')
    Add-Hasil 'PATCH nama paket tanpa komponen -> 200' $ok "status=$($r.Status)"

    # Paket 103 dipakai transaksi 'Selesai' -> bukan booking aktif, boleh diubah
    $r = Invoke-Api 'PATCH' '/api/inventory/103' $ownerA '{"komponen":[{"idBarang":"101","qty":2}]}'
    $ok = ($r.Status -eq 200) -and ($r.Body -cmatch '"idBarang":"101"')
    Add-Hasil 'PATCH komponen paket transaksi Selesai -> 200' $ok "status=$($r.Status)"

    # ---------------- DELETE ----------------
    $r = Invoke-Api 'DELETE' '/api/inventory/101' $null
    Add-Hasil 'DELETE tanpa cookie -> 401' ($r.Status -eq 401) "status=$($r.Status)"

    $r = Invoke-Api 'DELETE' '/api/inventory/101' $ownerA
    $ok = ($r.Status -eq 409) -and ($r.Body -cmatch '"code":"INVENTORY_IN_USE"')
    Add-Hasil 'DELETE barang dipakai transaksi -> 409 INVENTORY_IN_USE' $ok "status=$($r.Status)"

    $r = Invoke-Api 'DELETE' '/api/inventory/101' $ownerB
    Add-Hasil 'DELETE id tenant lain -> 200 (RLS, tanpa efek)' ($r.Status -eq 200) "status=$($r.Status)"

    $r = Invoke-Api 'GET' '/api/inventory?ids=101' $ownerA
    Add-Hasil 'Barang 101 tenant A masih ada setelah dihapus B' ($r.Body -cmatch '"id":101') 'cek ulang'

    $r = Invoke-Api 'DELETE' '/api/inventory/999999' $ownerA
    Add-Hasil 'DELETE id tidak ada -> 200 (idempoten)' ($r.Status -eq 200) "status=$($r.Status)"

    # ---------------- bulk-delete ----------------
    $r = Invoke-Api 'POST' '/api/inventory/bulk-delete' $null '{"ids":[102]}'
    Add-Hasil 'bulk-delete tanpa cookie -> 401' ($r.Status -eq 401) "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/inventory/bulk-delete' $ownerA '{"ids":[]}'
    Add-Hasil 'bulk-delete ids kosong -> 200' ($r.Status -eq 200) "status=$($r.Status)"

    # 102 belum dipakai transaksi, 101 dipakai -> harus gagal semua (atomik)
    $r = Invoke-Api 'POST' '/api/inventory/bulk-delete' $ownerA '{"ids":[102,101]}'
    $ok = ($r.Status -eq 409) -and ($r.Body -cmatch '"code":"INVENTORY_IN_USE"')
    Add-Hasil 'bulk-delete campur dipakai -> 409' $ok "status=$($r.Status)"

    $r = Invoke-Api 'GET' '/api/inventory?ids=102' $ownerA
    Add-Hasil 'Atomik: 102 tidak terhapus saat batch gagal' ($r.Body -cmatch '"id":102') 'cek ulang'

    $r = Invoke-Api 'GET' '/api/inventory' $ownerA
    $n = Count-Json $r.Body 'id'
    Add-Hasil 'Owner A masih 4 barang (101,102,103,paket)' ($n -eq 4) "count=$n"

    # Seed: 102 dipakai transaksi berstatus Disewa, 103 dipakai transaksi Selesai.
    # Keduanya tetap ditolak karena preflight memeriksa pemakaian, bukan status.
    $r = Invoke-Api 'POST' '/api/inventory/bulk-delete' $ownerA '{"ids":[102]}'
    $ok = ($r.Status -eq 409) -and ($r.Body -cmatch '"code":"INVENTORY_IN_USE"')
    Add-Hasil 'bulk-delete barang dipakai transaksi Disewa -> 409' $ok "status=$($r.Status)"

    # Barang yang belum pernah masuk transaksi harus bisa dihapus.
    $r = Invoke-Api 'POST' '/api/inventory' $ownerA '{"jenis":"satuan","nama":"Barang Hapus","h24":1000,"sns":["HAPUS-1"]}'
    $hapusId = $null
    if ($r.Body -match '"inventory":\{"id":(\d+)') { $hapusId = $Matches[1] }
    Add-Hasil 'Barang uji hapus berhasil dibuat' ($null -ne $hapusId) "id=$hapusId"

    $r = Invoke-Api 'POST' '/api/inventory/bulk-delete' $ownerA ("{`"ids`":[$hapusId]}")
    Add-Hasil 'bulk-delete barang tak terpakai -> 200' ($r.Status -eq 200) "status=$($r.Status)"

    $r = Invoke-Api 'GET' '/api/inventory' $ownerA
    $n = Count-Json $r.Body 'id'
    Add-Hasil 'Owner A kembali 4 barang setelah hapus barang uji' ($n -eq 4) "count=$n"

    $r = Invoke-Api 'POST' '/api/inventory/bulk-delete' $ownerA '{"ids":[201,202]}'
    Add-Hasil 'bulk-delete id tenant B -> 200 tanpa efek' ($r.Status -eq 200) "status=$($r.Status)"

    $r = Invoke-Api 'GET' '/api/inventory' $ownerB
    $n = Count-Json $r.Body 'id'
    Add-Hasil 'Data tenant B utuh (3 barang)' ($n -eq 3) "count=$n"

    Write-Host ''
    $hasil | Format-Table -AutoSize | Out-String -Width 200 | Write-Host

    $gagal = @($hasil | Where-Object { $_.Hasil -ne 'LOLOS' }).Count
    if ($gagal -gt 0) { Write-Host "$gagal skenario GAGAL"; exit 1 }
    Write-Host "Semua $($hasil.Count) skenario lolos."
}
finally {
    if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') stop | Out-Null
}
