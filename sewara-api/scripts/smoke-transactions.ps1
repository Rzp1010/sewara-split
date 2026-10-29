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
    $r = Invoke-Api 'POST' '/api/transactions' $null '{"transaction":{"id":1}}'
    Add-Hasil 'POST tanpa cookie -> 401' $r.Status 401 ''

    # POST tanpa id -> 400
    $r = Invoke-Api 'POST' '/api/transactions' $cookieA '{"transaction":{"penyewa":"Test"}}'
    Add-Hasil 'POST tanpa id -> 400' $r.Status 400 ''

    # POST tanpa penyewa -> 400
    $r = Invoke-Api 'POST' '/api/transactions' $cookieA '{"transaction":{"id":1001}}'
    Add-Hasil 'POST tanpa penyewa -> 400' $r.Status 400 ''

    # POST status invalid -> 400
    $r = Invoke-Api 'POST' '/api/transactions' $cookieA '{"transaction":{"id":1002,"penyewa":"Test","status":"Invalid"}}'
    Add-Hasil 'POST status invalid -> 400' $r.Status 400 ''

    # POST valid minimal (id + penyewa) -> 200
    $txID = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $bodyMinimal = @{
        transaction = @{
            id = $txID
            penyewa = 'Budi Santoso'
            status = 'Booking'
            biaya = 100000
            total_akhir = 100000
        }
        items = @()
        payments = @()
    } | ConvertTo-Json -Depth 5 -Compress
    $r = Invoke-Api 'POST' '/api/transactions' $cookieA $bodyMinimal
    $created = ($r.Body | ConvertFrom-Json).data.transaction
    $postOK = $r.Status -eq 200 -and $created.id -eq $txID -and $created.penyewa -eq 'Budi Santoso'
    if (-not $postOK) { Write-Host "POST minimal body: $($r.Body)" }
    Add-Hasil 'POST valid minimal -> tersimpan' ([int]$postOK) 1 "HTTP=$($r.Status) id=$($created.id)"

    # GET owner A sekarang 1 transaksi
    $r = Invoke-Api 'GET' '/api/transactions' $cookieA $null
    $dataA = ($r.Body | ConvertFrom-Json).data.transactions
    $countA = @($dataA).Count
    Add-Hasil 'GET owner A setelah POST -> 1 transaksi' ([int]($r.Status -eq 200 -and $countA -eq 1)) 1 "HTTP=$($r.Status) count=$countA"

    # POST dengan items + payments
    $txID2 = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 1
    $bodyFull = @{
        transaction = @{
            id = $txID2
            penyewa = 'Siti Aminah'
            hp_penyewa = '0812345678'
            status = 'Booking'
            biaya = 150000
            denda = 0
            total_akhir = 150000
        }
        items = @(
            @{
                item_name = 'Tenda 4x4'
                qty = 2
                unit_price = 50000
                subtotal = 100000
            },
            @{
                item_name = 'Sleeping Bag'
                qty = 4
                unit_price = 12500
                subtotal = 50000
            }
        )
        payments = @(
            @{
                amount = 50000
                payment_method = 'Transfer'
                payment_date = (Get-Date).ToUniversalTime().ToString('o')
            }
        )
    } | ConvertTo-Json -Depth 5 -Compress
    $r = Invoke-Api 'POST' '/api/transactions' $cookieA $bodyFull
    $createdFull = ($r.Body | ConvertFrom-Json).data.transaction
    $postFullOK = $r.Status -eq 200 -and $createdFull.id -eq $txID2 -and $createdFull.penyewa -eq 'Siti Aminah'
    Add-Hasil 'POST dengan items + payments -> tersimpan' ([int]$postFullOK) 1 "HTTP=$($r.Status) id=$($createdFull.id)"

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
