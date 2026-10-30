# smoke-transactions.ps1 — uji GET/POST /api/transactions (atomic parent + items + payments)

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

# Get-Count menjalankan SELECT count(*) langsung ke DB staging (assert isi tabel).
function Get-Count([string]$sql) {
    $out = docker exec sewara-staging-db psql -U sewara -d sewara -t -A -c $sql
    return [int](($out | Out-String).Trim())
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

$api = Start-Process -FilePath $apiExe -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $root '.data\api.out.log') `
    -RedirectStandardError (Join-Path $root '.data\api.err.log')

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 300
    $code = curl.exe -s -o NUL -w '%{http_code}' --max-time 2 "$apiURL/api/health"
    if ($code -eq '200') { $ready = $true; break }
}
if (-not $ready) {
    if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
    Get-Content (Join-Path $root '.data\api.err.log') -Tail 20 -ErrorAction SilentlyContinue
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') stop | Out-Null
    throw 'API tidak siap'
}

try {
    Write-Host ''
    Write-Host '=== Login ==='
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

    # GET tanpa cookie -> 401
    $r = Invoke-Api 'GET' '/api/transactions' $null $null
    Add-Hasil 'GET tanpa cookie -> 401' $r.Status 401 ''

    # GET owner A -> array kosong (seed tidak punya transaksi)
    $r = Invoke-Api 'GET' '/api/transactions' $cookieA $null
    $dataA = ($r.Body | ConvertFrom-Json).data.transactions
    $countA = if ($null -eq $dataA) { 0 } else { @($dataA).Count }
    Add-Hasil 'GET owner A -> array (seed 0)' ([int]($r.Status -eq 200 -and $countA -eq 0)) 1 "HTTP=$($r.Status) count=$countA"

    # POST tanpa cookie -> 401
    $r = Invoke-Api 'POST' '/api/transactions' $null '{"id":1}'
    Add-Hasil 'POST tanpa cookie -> 401' $r.Status 401 ''

    # POST flat tanpa id -> 400 (bentuk frontend: transaksi di root)
    $r = Invoke-Api 'POST' '/api/transactions' $cookieA '{"penyewa":"Test"}'
    Add-Hasil 'POST flat tanpa id -> 400' $r.Status 400 ''

    # POST flat tanpa penyewa -> 400
    $r = Invoke-Api 'POST' '/api/transactions' $cookieA '{"id":1001}'
    Add-Hasil 'POST flat tanpa penyewa -> 400' $r.Status 400 ''

    # POST flat status invalid -> 400
    $r = Invoke-Api 'POST' '/api/transactions' $cookieA '{"id":1002,"penyewa":"Test","status":"Invalid"}'
    Add-Hasil 'POST flat status invalid -> 400' $r.Status 400 ''

    # POST flat payment jumlah <= 0 -> 400 (validasi sama RPC)
    $r = Invoke-Api 'POST' '/api/transactions' $cookieA '{"id":1003,"penyewa":"Test","status":"Booking","biaya":0,"total_akhir":0,"payments":[{"jumlah":0,"metode":"Tunai"}]}'
    Add-Hasil 'POST flat payment jumlah<=0 -> 400' $r.Status 400 ''

    # POST flat valid minimal (bentuk frontend, bukan wrapper) -> 200
    $txID = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $bodyMinimal = @{
        id = $txID
        penyewa = 'Budi Santoso'
        status = 'Booking'
        biaya = 100000
        total_akhir = 100000
    } | ConvertTo-Json -Depth 6 -Compress
    $r = Invoke-Api 'POST' '/api/transactions' $cookieA $bodyMinimal
    $created = ($r.Body | ConvertFrom-Json).data.transaction
    $postOK = $r.Status -eq 200 -and $created.id -eq $txID -and $created.penyewa -eq 'Budi Santoso'
    if (-not $postOK) { Write-Host "POST minimal body: $($r.Body)" }
    Add-Hasil 'POST flat minimal -> tersimpan' ([int]$postOK) 1 "HTTP=$($r.Status) id=$($created.id)"

    # GET owner A sekarang 1 transaksi
    $r = Invoke-Api 'GET' '/api/transactions' $cookieA $null
    $dataA = ($r.Body | ConvertFrom-Json).data.transactions
    $countA = @($dataA).Count
    Add-Hasil 'GET owner A setelah POST -> 1 transaksi' ([int]($r.Status -eq 200 -and $countA -eq 1)) 1 "HTTP=$($r.Status) count=$countA"

    # Inventory owner A untuk uji mapping item flat `ref.id` -> inventory_id.
    $invFlatNama = 'Tenda-Flat-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $r = Invoke-Api 'POST' '/api/inventory' $cookieA (@{ nama = $invFlatNama; jenis = 'satuan' } | ConvertTo-Json -Compress)
    $invFlatID = ($r.Body | ConvertFrom-Json).data.inventory.id
    Add-Hasil 'POST flat~setup: inventory owner A' ([int]($r.Status -eq 200 -and $invFlatID -gt 0)) 1 "HTTP=$($r.Status) id=$invFlatID"

    # POST flat penuh bentuk frontend: items (nama/harga/sn/assignedSNs/ref.id) +
    # payments bentuk frontend (jumlah/tanggal/metode/catatan) + pembayaran legacy.
    $txID2 = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 1
    $bodyFull = @{
        id = $txID2
        no_invoice = 'INV-FLAT-' + $txID2
        penyewa = 'Siti Aminah'
        hp_penyewa = '0812345678'
        status = 'Booking'
        biaya = 150000
        denda = 0
        total_akhir = 150000
        durasi_teks = '1 hari'
        items = @(
            @{
                nama = 'Tenda 4x4'
                jenis = 'satuan'
                qty = 2
                harga = 50000
                sn = 'SN-FLAT-1, SN-FLAT-2'
                assignedSNs = @()
                ref = @{ id = $invFlatID; nama = 'Tenda 4x4'; jenis = 'satuan'; harga = 50000 }
            },
            @{
                qty = 4
                harga = 12500
                assignedSNs = @(@{ idKomp = $invFlatID; nama = 'Komponen'; sns = @('K-1') })
                ref = @{ nama = 'Sleeping Bag'; jenis = 'satuan'; harga = 12500 }
            }
        )
        pembayaran = @{
            dp = 50000
            metodeDp = 'Transfer'
            tglDp = (Get-Date).ToUniversalTime().ToString('o')
            riwayatBayar = @(@{ jumlah = 50000; metode = 'Transfer'; tgl = (Get-Date).ToUniversalTime().ToString('o'); catatan = 'DP Booking' })
        }
        payments = @(@{ jumlah = 50000; metode = 'Transfer'; tanggal = (Get-Date).ToUniversalTime().ToString('o'); catatan = 'DP Booking' })
    } | ConvertTo-Json -Depth 8 -Compress
    $r = Invoke-Api 'POST' '/api/transactions' $cookieA $bodyFull
    $createdFull = ($r.Body | ConvertFrom-Json).data.transaction
    $postFullOK = $r.Status -eq 200 -and $createdFull.id -eq $txID2 -and $createdFull.penyewa -eq 'Siti Aminah'
    if (-not $postFullOK) { Write-Host "POST flat body: $($r.Body)" }
    Add-Hasil 'POST flat items + payments -> tersimpan' ([int]$postFullOK) 1 "HTTP=$($r.Status) id=$($createdFull.id)"

    # Assert DB: normalisasi item flat tersimpan di transaction_items.
    $nItems = Get-Count "SELECT count(*) FROM transaction_items WHERE transaction_id=$txID2"
    Add-Hasil 'DB: transaction_items terisi 2 baris' ([int]($nItems -eq 2)) 1 "count=$nItems"

    $nTenda = Get-Count "SELECT count(*) FROM transaction_items WHERE transaction_id=$txID2 AND item_name='Tenda 4x4' AND serial_number='SN-FLAT-1, SN-FLAT-2' AND inventory_id=$invFlatID AND unit_price=50000 AND subtotal=100000 AND jsonb_array_length(assigned_components)=0"
    Add-Hasil 'DB: item flat nama/sn/ref.id/subtotal benar' ([int]($nTenda -eq 1)) 1 "count=$nTenda"

    $nSb = Get-Count "SELECT count(*) FROM transaction_items WHERE transaction_id=$txID2 AND item_name='Sleeping Bag' AND unit_price=12500 AND subtotal=50000 AND jsonb_array_length(assigned_components)=1"
    Add-Hasil 'DB: item ref.nama + assignedSNs benar' ([int]($nSb -eq 1)) 1 "count=$nSb"

    $nPay = Get-Count "SELECT count(*) FROM transaction_payments WHERE transaction_id=$txID2 AND amount=50000 AND payment_method='Transfer' AND notes='DP Booking'"
    Add-Hasil 'DB: payment bentuk frontend tersimpan' ([int]($nPay -eq 1)) 1 "count=$nPay"

    $nParent = Get-Count "SELECT count(*) FROM transactions WHERE id=$txID2 AND (pembayaran->>'dp')::numeric=50000"
    Add-Hasil 'DB: parent pembayaran legacy tersimpan' ([int]($nParent -eq 1)) 1 "count=$nParent"

    # GET owner A sekarang 2 transaksi
    $r = Invoke-Api 'GET' '/api/transactions' $cookieA $null
    $dataA = ($r.Body | ConvertFrom-Json).data.transactions
    $countA = @($dataA).Count
    Add-Hasil 'GET owner A setelah POST kedua -> 2 transaksi' ([int]($r.Status -eq 200 -and $countA -eq 2)) 1 "HTTP=$($r.Status) count=$countA"

    # GET owner B -> array kosong (isolasi tenant)
    $r = Invoke-Api 'GET' '/api/transactions' $cookieB $null
    $dataB = ($r.Body | ConvertFrom-Json).data.transactions
    $countB = if ($null -eq $dataB) { 0 } else { @($dataB).Count }
    $isolasiOK = $r.Status -eq 200 -and $countB -eq 0
    Add-Hasil 'Tenant B tidak lihat transaksi A' ([int]$isolasiOK) 1 "HTTP=$($r.Status) countB=$countB"

    # POST tenant B
    $txIDB = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 2
    $bodyB = @{
        transaction = @{
            id = $txIDB
            penyewa = 'Andi Wijaya'
            status = 'Booking'
            biaya = 200000
            total_akhir = 200000
        }
        items = @()
        payments = @()
    } | ConvertTo-Json -Depth 5 -Compress
    $r = Invoke-Api 'POST' '/api/transactions' $cookieB $bodyB
    $postBOK = $r.Status -eq 200
    Add-Hasil 'POST tenant B -> tersimpan terpisah' ([int]$postBOK) 1 "HTTP=$($r.Status)"

    # GET tenant B sekarang 1
    $r = Invoke-Api 'GET' '/api/transactions' $cookieB $null
    $dataB = ($r.Body | ConvertFrom-Json).data.transactions
    $countB = @($dataB).Count
    Add-Hasil 'GET tenant B setelah POST -> 1 transaksi' ([int]($r.Status -eq 200 -and $countB -eq 1)) 1 "HTTP=$($r.Status) countB=$countB"

    # GET tenant A tetap 2 (tidak bocor)
    $r = Invoke-Api 'GET' '/api/transactions' $cookieA $null
    $dataA = ($r.Body | ConvertFrom-Json).data.transactions
    $countA = @($dataA).Count
    Add-Hasil 'Tenant A tetap 2 transaksi (tidak bocor)' ([int]($r.Status -eq 200 -and $countA -eq 2)) 1 "HTTP=$($r.Status) count=$countA"

    # POST flat item tanpa nama -> tidak ditolak, item_name fallback "Unknown".
    $txNoName = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 100
    $bodyNoName = @{
        id = $txNoName
        penyewa = 'Tanpa Nama'
        status = 'Booking'
        biaya = 1000
        total_akhir = 1000
        items = @(@{ qty = 1; harga = 1000 })
    } | ConvertTo-Json -Depth 6 -Compress
    $r = Invoke-Api 'POST' '/api/transactions' $cookieA $bodyNoName
    Add-Hasil 'POST flat item tanpa nama -> 200' ([int]($r.Status -eq 200)) 1 "HTTP=$($r.Status)"
    $nUnknown = Get-Count "SELECT count(*) FROM transaction_items WHERE transaction_id=$txNoName AND item_name='Unknown'"
    Add-Hasil 'DB: item tanpa nama -> Unknown' ([int]($nUnknown -eq 1)) 1 "count=$nUnknown"

    # ===== GET /api/transactions/{id} =====

    # GET by ID tanpa cookie -> 401
    $r = Invoke-Api 'GET' "/api/transactions/$txID2" $null $null
    Add-Hasil 'GET by ID tanpa cookie -> 401' $r.Status 401 ''

    # GET by ID tidak ada -> 404
    $r = Invoke-Api 'GET' '/api/transactions/9999999' $cookieA $null
    Add-Hasil 'GET by ID tidak ada -> 404' $r.Status 404 ''

    # GET by ID valid -> 200, items + payments nested
    $r = Invoke-Api 'GET' "/api/transactions/$txID2" $cookieA $null
    $det = ($r.Body | ConvertFrom-Json).data.transaction
    $detailOK = $r.Status -eq 200 -and $det.id -eq $txID2 -and @($det.transaction_items).Count -eq 2 -and @($det.transaction_payments).Count -eq 1
    Add-Hasil 'GET by ID valid -> detail lengkap' ([int]$detailOK) 1 "HTTP=$($r.Status) items=$(@($det.transaction_items).Count) payments=$(@($det.transaction_payments).Count)"

    # GET by ID tenant B -> 404 (isolasi)
    $r = Invoke-Api 'GET' "/api/transactions/$txID2" $cookieB $null
    Add-Hasil 'GET by ID tenant lain -> 404' $r.Status 404 ''

    # GET by ID id non-angka -> 400
    $r = Invoke-Api 'GET' '/api/transactions/abc' $cookieA $null
    Add-Hasil 'GET by ID id non-angka -> 400' $r.Status 400 ''

    # ===== PATCH /api/transactions/{id} =====

    # PATCH tanpa cookie -> 401
    $r = Invoke-Api 'PATCH' "/api/transactions/$txID" $null '{"status":"Selesai"}'
    Add-Hasil 'PATCH tanpa cookie -> 401' $r.Status 401 ''

    # PATCH body kosong -> 400
    $r = Invoke-Api 'PATCH' "/api/transactions/$txID" $cookieA '{}'
    Add-Hasil 'PATCH body kosong -> 400' $r.Status 400 ''

    # PATCH status invalid -> 400
    $r = Invoke-Api 'PATCH' "/api/transactions/$txID" $cookieA '{"status":"Cacat"}'
    Add-Hasil 'PATCH status invalid -> 400' $r.Status 400 ''

    # PATCH id tidak ada -> 404
    $r = Invoke-Api 'PATCH' '/api/transactions/9999999' $cookieA '{"status":"Selesai"}'
    Add-Hasil 'PATCH id tidak ada -> 404' $r.Status 404 ''

    # PATCH valid -> 200, status berubah
    $r = Invoke-Api 'PATCH' "/api/transactions/$txID" $cookieA '{"status":"Selesai","biaya":110000}'
    $patched = ($r.Body | ConvertFrom-Json).data.transaction
    $patchOK = $r.Status -eq 200 -and $patched.status -eq 'Selesai' -and $patched.biaya -eq 110000
    Add-Hasil 'PATCH valid -> status+biaya berubah' ([int]$patchOK) 1 "HTTP=$($r.Status) status=$($patched.status) biaya=$($patched.biaya)"

    # PATCH id tenant B -> 404 (isolasi)
    $r = Invoke-Api 'PATCH' "/api/transactions/$txID" $cookieB '{"status":"Disewa"}'
    Add-Hasil 'PATCH id tenant lain -> 404' $r.Status 404 ''

    # PATCH id non-angka -> 400
    $r = Invoke-Api 'PATCH' '/api/transactions/abc' $cookieA '{"status":"Selesai"}'
    Add-Hasil 'PATCH id non-angka -> 400' $r.Status 400 ''

    # ===== G1: filter/preset query GET /api/transactions =====
    # (acuan: sewara-backend/app/api/transactions/route.ts)

    # kolom=ringkas -> hanya kolom preset
    $r = Invoke-Api 'GET' '/api/transactions?kolom=ringkas' $cookieA $null
    $rows = @(($r.Body | ConvertFrom-Json).data.transactions)
    $props = @($rows[0].PSObject.Properties.Name)
    $ringkasOK = $r.Status -eq 200 -and ($props -contains 'id') -and ($props -contains 'no_invoice') `
        -and -not ($props -contains 'hp_penyewa') -and -not ($props -contains 'printilan')
    Add-Hasil 'G1: GET kolom=ringkas -> hanya kolom preset' ([int]$ringkasOK) 1 "HTTP=$($r.Status) keys=$($props -join ',')"

    # kolom=statistik -> id,status,total_akhir
    $r = Invoke-Api 'GET' '/api/transactions?kolom=statistik' $cookieA $null
    $rows = @(($r.Body | ConvertFrom-Json).data.transactions)
    $props = @($rows[0].PSObject.Properties.Name)
    $statOK = $r.Status -eq 200 -and $props.Count -eq 3 -and ($props -contains 'status') -and ($props -contains 'total_akhir')
    Add-Hasil 'G1: GET kolom=statistik -> 3 kolom' ([int]$statOK) 1 "HTTP=$($r.Status) keys=$($props -join ',')"

    # ids -> hanya id yang diminta
    $r = Invoke-Api 'GET' "/api/transactions?ids=$txID2" $cookieA $null
    $rows = @(($r.Body | ConvertFrom-Json).data.transactions)
    Add-Hasil 'G1: GET ids -> tepat 1 baris' ([int]($r.Status -eq 200 -and $rows.Count -eq 1 -and $rows[0].id -eq $txID2)) 1 "HTTP=$($r.Status) count=$($rows.Count)"

    # nested=1 -> transaction_items + transaction_payments disertakan
    $r = Invoke-Api 'GET' "/api/transactions?ids=$txID2&nested=1" $cookieA $null
    $rows = @(($r.Body | ConvertFrom-Json).data.transactions)
    $props = @($rows[0].PSObject.Properties.Name)
    $nestedOK = $r.Status -eq 200 -and $rows.Count -eq 1 -and ($props -contains 'transaction_items') `
        -and ($props -contains 'transaction_payments') -and @($rows[0].transaction_items).Count -eq 2
    Add-Hasil 'G1: GET nested=1 -> items+payments' ([int]$nestedOK) 1 "HTTP=$($r.Status) items=$(@($rows[0].transaction_items).Count)"

    # cari -> penyewa cocok saja
    $r = Invoke-Api 'GET' '/api/transactions?cari=Budi' $cookieA $null
    $rows = @(($r.Body | ConvertFrom-Json).data.transactions)
    $cariOK = $r.Status -eq 200 -and $rows.Count -ge 1 -and @($rows | Where-Object { $_.penyewa -notlike '*Budi*' }).Count -eq 0
    Add-Hasil 'G1: GET cari=Budi -> penyewa cocok saja' ([int]$cariOK) 1 "HTTP=$($r.Status) count=$($rows.Count)"

    # status -> semua baris berstatus diminta
    $r = Invoke-Api 'GET' '/api/transactions?status=Booking' $cookieA $null
    $rows = @(($r.Body | ConvertFrom-Json).data.transactions)
    $statusOK = $r.Status -eq 200 -and $rows.Count -ge 1 -and @($rows | Where-Object { $_.status -ne 'Booking' }).Count -eq 0
    Add-Hasil 'G1: GET status=Booking -> semua Booking' ([int]$statusOK) 1 "HTTP=$($r.Status) count=$($rows.Count)"

    # hideRiwayat=1 -> tanpa Selesai/Dibatalkan
    $r = Invoke-Api 'GET' '/api/transactions?hideRiwayat=1' $cookieA $null
    $rows = @(($r.Body | ConvertFrom-Json).data.transactions)
    $hideOK = $r.Status -eq 200 -and @($rows | Where-Object { $_.status -in @('Selesai', 'Dibatalkan') }).Count -eq 0
    Add-Hasil 'G1: GET hideRiwayat=1 -> tanpa riwayat' ([int]$hideOK) 1 "HTTP=$($r.Status) count=$($rows.Count)"

    # limit=1 -> tepat 1 baris
    $r = Invoke-Api 'GET' '/api/transactions?limit=1' $cookieA $null
    $rows = @(($r.Body | ConvertFrom-Json).data.transactions)
    Add-Hasil 'G1: GET limit=1 -> tepat 1 baris' ([int]($r.Status -eq 200 -and $rows.Count -eq 1)) 1 "HTTP=$($r.Status) count=$($rows.Count)"

    # ===== G3: guard SN maintenance =====
    # (acuan: lib/api/kondisi-sn.ts guardMaintenance)

    # Buat barang owner A lalu set SN maintenance.
    $invNama = 'Tenda-Guard-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $bodyInv = @{ nama = $invNama; jenis = 'satuan' } | ConvertTo-Json -Compress
    $r = Invoke-Api 'POST' '/api/inventory' $cookieA $bodyInv
    $invID = ($r.Body | ConvertFrom-Json).data.inventory.id
    Add-Hasil 'G3~setup: POST inventory owner A' ([int]($r.Status -eq 200 -and $invID -gt 0)) 1 "HTTP=$($r.Status) id=$invID"

    $bodyKondisi = @{ kondisi_sn = @{ 'SN-MTC-1' = @{ kondisi = 'maintenance' } } } | ConvertTo-Json -Depth 5 -Compress
    $r = Invoke-Api 'PATCH' "/api/inventory/$invID" $cookieA $bodyKondisi
    Add-Hasil 'G3~setup: PATCH kondisi_sn maintenance' ([int]($r.Status -eq 200)) 1 "HTTP=$($r.Status)"

    # POST transaksi Disewa dengan SN maintenance -> 400 pesan persis.
    $txG = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 10
    $bodyMtc = @{
        transaction = @{ id = $txG; penyewa = 'Guard Test'; status = 'Disewa'; biaya = 1000; total_akhir = 1000 }
        items       = @(@{ inventory_id = $invID; item_name = $invNama; qty = 1; unit_price = 1000; subtotal = 1000; serial_number = 'SN-MTC-1' })
        payments    = @()
    } | ConvertTo-Json -Depth 5 -Compress
    $r = Invoke-Api 'POST' '/api/transactions' $cookieA $bodyMtc
    $pesanMtc = ($r.Body | ConvertFrom-Json).error.message
    $harapMtc = 'Unit S/N "SN-MTC-1" sedang maintenance dan tidak bisa disewa.'
    Add-Hasil 'G3: SN maintenance -> 400 pesan persis' ([int]($r.Status -eq 400 -and $pesanMtc -eq $harapMtc)) 1 "HTTP=$($r.Status) msg=$pesanMtc"

    # SN tidak ada di kondisi_sn (fail-open) -> tersimpan.
    $txOK = $txG + 1
    $bodyBaik = @{
        transaction = @{ id = $txOK; penyewa = 'Guard OK'; status = 'Disewa'; biaya = 1000; total_akhir = 1000 }
        items       = @(@{ inventory_id = $invID; item_name = $invNama; qty = 1; unit_price = 1000; subtotal = 1000; serial_number = 'SN-OK' })
        payments    = @()
    } | ConvertTo-Json -Depth 5 -Compress
    $r = Invoke-Api 'POST' '/api/transactions' $cookieA $bodyBaik
    Add-Hasil 'G3: SN baik -> tersimpan' ([int]($r.Status -eq 200)) 1 "HTTP=$($r.Status)"

    # ===== G2: referensi lintas tenant =====
    # (acuan: rpc_save_transaction schema_prod_20260930.sql, SQLSTATE 42501)

    # Member milik tenant B.
    $bodyMemberB = @{ nama = 'Member B'; hp = '081200000001' } | ConvertTo-Json -Compress
    $r = Invoke-Api 'POST' '/api/members' $cookieB $bodyMemberB
    $memberB = ($r.Body | ConvertFrom-Json).data.member.id
    Add-Hasil 'G2~setup: POST member tenant B' ([int]($r.Status -eq 201 -and $memberB -gt 0)) 1 "HTTP=$($r.Status) id=$memberB"

    # Transaksi owner A menunjuk member tenant B -> 403.
    $txM = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 20
    $bodyMemberSalah = @{
        transaction = @{ id = $txM; penyewa = 'XTenant Member'; status = 'Booking'; biaya = 1000; total_akhir = 1000; member_id = $memberB }
        items       = @()
        payments    = @()
    } | ConvertTo-Json -Depth 5 -Compress
    $r = Invoke-Api 'POST' '/api/transactions' $cookieA $bodyMemberSalah
    $pesanMember = ($r.Body | ConvertFrom-Json).error.message
    Add-Hasil 'G2: member tenant lain -> 403' ([int]($r.Status -eq 403 -and $pesanMember -eq 'Member does not belong to tenant')) 1 "HTTP=$($r.Status) msg=$pesanMember"

    # Inventory milik tenant B.
    $bodyInvB = @{ nama = 'Barang B'; jenis = 'satuan' } | ConvertTo-Json -Compress
    $r = Invoke-Api 'POST' '/api/inventory' $cookieB $bodyInvB
    $invB = ($r.Body | ConvertFrom-Json).data.inventory.id
    Add-Hasil 'G2~setup: POST inventory tenant B' ([int]($r.Status -eq 200 -and $invB -gt 0)) 1 "HTTP=$($r.Status) id=$invB"

    # Transaksi owner A menunjuk inventory tenant B -> 403.
    $txI = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 21
    $bodyInvSalah = @{
        transaction = @{ id = $txI; penyewa = 'XTenant Inv'; status = 'Booking'; biaya = 1000; total_akhir = 1000 }
        items       = @(@{ inventory_id = $invB; item_name = 'Barang B'; qty = 1; unit_price = 1000; subtotal = 1000 })
        payments    = @()
    } | ConvertTo-Json -Depth 5 -Compress
    $r = Invoke-Api 'POST' '/api/transactions' $cookieA $bodyInvSalah
    $pesanInv = ($r.Body | ConvertFrom-Json).error.message
    Add-Hasil 'G2: inventory tenant lain -> 403' ([int]($r.Status -eq 403 -and $pesanInv -eq 'Inventory does not belong to tenant')) 1 "HTTP=$($r.Status) msg=$pesanInv"

    # Kegagalan tidak menyisakan parent separuh tersimpan.
    $r = Invoke-Api 'GET' "/api/transactions?ids=$txI" $cookieA $null
    $rows = @(($r.Body | ConvertFrom-Json).data.transactions)
    Add-Hasil 'G2: gagal -> tidak ada parent tersisa' ([int]($r.Status -eq 200 -and $rows.Count -eq 0)) 1 "HTTP=$($r.Status) count=$($rows.Count)"

    # ===== G7: id milik tenant lain -> 403 =====
    # (acuan: rpc_save_transaction, `IF EXISTS (...) THEN RAISE ... ERRCODE 42501`)
    $txLintas = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 30
    $bodyLintas = @{
        id = $txLintas; penyewa = 'Milik B'; status = 'Booking'; biaya = 1000; total_akhir = 1000
    } | ConvertTo-Json -Compress
    $r = Invoke-Api 'POST' '/api/transactions' $cookieB $bodyLintas
    Add-Hasil 'G7~setup: POST transaksi tenant B' ([int]($r.Status -eq 200)) 1 "HTTP=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/transactions' $cookieA $bodyLintas
    $pesanLintas = ($r.Body | ConvertFrom-Json).error.message
    Add-Hasil 'G7: POST id tenant lain -> 403' ([int]($r.Status -eq 403 -and $pesanLintas -eq 'Transaction belongs to another tenant')) 1 "HTTP=$($r.Status) msg=$pesanLintas"

    $nLintas = Get-Count "SELECT count(*) FROM transactions WHERE id=$txLintas AND penyewa='Milik B'"
    Add-Hasil 'G7: baris tenant B tidak berubah' ([int]($nLintas -eq 1)) 1 "count=$nLintas"

    # ===== G8: POST id sendiri dengan body parsial -> nilai lama bertahan =====
    # (acuan: `p_transaction ? 'kunci'` + jsonb_typeof; tanpa ini denda/biaya/
    #  status tertimpa jadi nol/kosong saat client kirim sebagian field)
    $r = Invoke-Api 'GET' "/api/transactions?ids=$txID" $cookieA $null
    $sebelum = @(($r.Body | ConvertFrom-Json).data.transactions)[0]
    $r = Invoke-Api 'POST' '/api/transactions' $cookieA (@{ id = $txID; penyewa = 'Budi Santoso' } | ConvertTo-Json -Compress)
    $nLama = Get-Count "SELECT count(*) FROM transactions WHERE id=$txID AND status='$($sebelum.status)' AND biaya=$([int]$sebelum.biaya) AND total_akhir=$([int]$sebelum.total_akhir)"
    Add-Hasil 'G8: POST parsial -> status/biaya/total lama bertahan' ([int]($r.Status -eq 200 -and $nLama -eq 1)) 1 "HTTP=$($r.Status) status=$($sebelum.status) biaya=$($sebelum.biaya)"

    # ===== G9: PATCH kolom di luar daftar putih -> 400 =====
    $r = Invoke-Api 'PATCH' "/api/transactions/$txID" $cookieA '{"kolom_ngawur":1}'
    $pesanKolom = ($r.Body | ConvertFrom-Json).error.message
    Add-Hasil 'G9: PATCH kolom asing -> 400' ([int]($r.Status -eq 400 -and $pesanKolom -eq "Kolom 'kolom_ngawur' tidak dikenal.")) 1 "HTTP=$($r.Status) msg=$pesanKolom"

    # ===== G10: no_invoice mengikuti v_invoice RPC (NULLIF + fallback) =====
    $txInv = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 31
    $bodyInvKosong = @{
        id = $txInv; id_transaksi = 'TRX-INV-1'; no_invoice = ''; penyewa = 'Inv Null'; status = 'Booking'
    } | ConvertTo-Json -Compress
    $r = Invoke-Api 'POST' '/api/transactions' $cookieA $bodyInvKosong
    $nInvKosong = Get-Count "SELECT count(*) FROM transactions WHERE id=$txInv AND no_invoice IS NULL"
    Add-Hasil 'G10: no_invoice "" -> NULL (menang atas id_transaksi)' ([int]($r.Status -eq 200 -and $nInvKosong -eq 1)) 1 "HTTP=$($r.Status) count=$nInvKosong"

    $txInv2 = $txInv + 1
    $bodyInvFallback = @{
        id = $txInv2; id_transaksi = 'TRX-INV-2'; penyewa = 'Inv Fallback'; status = 'Booking'
    } | ConvertTo-Json -Compress
    $r = Invoke-Api 'POST' '/api/transactions' $cookieA $bodyInvFallback
    $nInvFallback = Get-Count "SELECT count(*) FROM transactions WHERE id=$txInv2 AND no_invoice='TRX-INV-2'"
    Add-Hasil 'G10: tanpa no_invoice -> fallback id_transaksi' ([int]($r.Status -eq 200 -and $nInvFallback -eq 1)) 1 "HTTP=$($r.Status) count=$nInvFallback"

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
