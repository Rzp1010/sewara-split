# smoke-transaction-items.ps1 — uji GET/POST /api/transaction-items
#
# Cakupan: GET single (?transaction_id), bulk (?transaction_ids), all,
# POST replace items (DELETE old + INSERT baru), isolasi tenant via RLS.
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
    return @{ Status = $status; Body = $respBody }
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

$hasil = @()
function Add-Hasil([string]$nama, [int]$dapat, [int]$harap, [string]$info) {
    $script:hasil += [pscustomobject]@{
        Skenario = $nama; Status = $dapat; Harap = $harap
        Hasil = $(if ($dapat -eq $harap) { 'LOLOS' } else { 'GAGAL' }); Info = $info
    }
}

try {
    Write-Host 'Menyiapkan binari...'
    Push-Location $root
    go build -o $apiExe ./cmd/api
    Pop-Location
    if ($LASTEXITCODE -ne 0) { throw 'go build gagal' }
    if (-not (Test-Path $apiExe)) { throw "Binari tidak ditemukan di $apiExe" }

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

    # Transaksi uji + item. Member 1-3 milik owner A, 4-6 milik owner B;
    # inventory 101/102/103 milik A, 201/202/203 milik B.
    docker exec sewara-staging-db psql -U sewara -d sewara -c "
INSERT INTO transactions (id,id_transaksi,penyewa,hp_penyewa,status,items,user_id,total_akhir,member_id,created_at,updated_at) VALUES
(4001,'TEST-4001','Pelanggan A1','081100000010','Booking','[]','a0000000-0000-0000-0000-000000000001',50000,1,now(),now()),
(4002,'TEST-4002','Pelanggan A2','081100000011','Disewa','[]','a0000000-0000-0000-0000-000000000001',60000,1,now(),now()),
(5001,'TEST-5001','Pelanggan B1','081100000012','Booking','[]','b0000000-0000-0000-0000-000000000001',70000,4,now(),now());
INSERT INTO transaction_items (id,transaction_id,inventory_id,item_name,item_type,qty,unit_price,subtotal,user_id,created_at,updated_at) VALUES
(10001,4001,103,'Paket A','bundling',1,50000,50000,'a0000000-0000-0000-0000-000000000001',now(),now()),
(10002,4002,103,'Paket A','bundling',2,30000,60000,'a0000000-0000-0000-0000-000000000001',now(),now()),
(10003,5001,202,'Lensa B','satuan',1,70000,70000,'b0000000-0000-0000-0000-000000000001',now(),now());
" | Out-Null

    $env:DATABASE_URL = 'postgres://sewara:sewara123@127.0.0.1:5433/sewara?sslmode=disable'
    $env:ADDR = '127.0.0.1:8099'
    $env:APP_ENV = 'development'

    # Bunuh sisa proses API yang masih memegang port 8099 (sisa run sebelumnya).
    # Tanpa ini, Start-Process gagal bind dan permintaan dilayani binary lama.
    $pemakaiPort = @(Get-NetTCPConnection -LocalPort 8099 -State Listen -ErrorAction SilentlyContinue)
    foreach ($c in $pemakaiPort) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
    if ($pemakaiPort.Count -gt 0) { Start-Sleep -Milliseconds 500 }

    $api = Start-Process -FilePath $apiExe -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $tmpDir 'api-stdout.log') -RedirectStandardError (Join-Path $tmpDir 'api-stderr.log')

    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 300
        $code = curl.exe -s -o NUL -w '%{http_code}' --max-time 2 "$apiURL/api/health"
        if ($code -eq '200') { $ready = $true; break }
    }
    if (-not $ready) { throw 'API tidak siap' }

    Write-Host "`n=== Login ==="
    $cookieA = Get-SessionCookie 'owner-a@staging.local'
    $cookieB = Get-SessionCookie 'owner-b@staging.local'
    Write-Host 'Login berhasil'

    # ---------- GET single ----------
    $r = Invoke-Api 'GET' '/api/transaction-items?transaction_id=4001' $null $null
    Add-Hasil 'GET single tanpa cookie -> 401' $r.Status 401 ''

    $r = Invoke-Api 'GET' '/api/transaction-items?transaction_id=abc' $cookieA $null
    Add-Hasil 'GET single id bukan angka -> 400' $r.Status 400 ''

    $r = Invoke-Api 'GET' '/api/transaction-items?transaction_id=4001' $cookieA $null
    Add-Hasil 'GET single owner A tx 4001 -> 200' $r.Status 200 ''

    $r = Invoke-Api 'GET' '/api/transaction-items?transaction_id=5001' $cookieA $null
    $itemsB = @(($r.Body | ConvertFrom-Json).data.items)
    Add-Hasil 'RLS: owner A tidak lihat item tenant B' @($itemsB).Count 0 "count=$($itemsB.Count)"

    $r = Invoke-Api 'GET' '/api/transaction-items?transaction_id=4002' $cookieA $null
    $items4002 = @(($r.Body | ConvertFrom-Json).data.items)
    Add-Hasil 'GET single tx 4002 -> 1 item' $items4002.Count 1 "count=$($items4002.Count)"

    # ---------- GET bulk ----------
    $r = Invoke-Api 'GET' '/api/transaction-items?transaction_ids=4001,4002' $null $null
    Add-Hasil 'GET bulk tanpa cookie -> 401' $r.Status 401 ''

    $r = Invoke-Api 'GET' '/api/transaction-items?transaction_ids=4001,4002' $cookieA $null
    $grouped = ($r.Body | ConvertFrom-Json).data.itemsByTransaction
    $kunciG = @($grouped.PSObject.Properties.Name)
    $g4001 = @($grouped.'4001').Count
    $g4002 = @($grouped.'4002').Count
    Add-Hasil 'GET bulk -> grouped benar (4001=1, 4002=1)' ([int]($kunciG.Count -eq 2 -and $g4001 -eq 1 -and $g4002 -eq 1)) 1 "kunci=$($kunciG -join ',') 4001=$g4001 4002=$g4002"

    $r = Invoke-Api 'GET' '/api/transaction-items?transaction_ids=4001,5001' $cookieA $null
    $grouped2 = ($r.Body | ConvertFrom-Json).data.itemsByTransaction
    $kunciG2 = @($grouped2.PSObject.Properties.Name)
    $g4001b = @($grouped2.'4001').Count
    # RLS: kunci "5001" (tenant B) harus tidak muncul sama sekali untuk owner A.
    $ada5001 = $kunciG2 -contains '5001'
    Add-Hasil 'RLS bulk: kunci 5001 tenant B tidak ada' ([int](-not $ada5001 -and $g4001b -eq 1)) 1 "kunci=$($kunciG2 -join ',') 4001=$g4001b"

    # ---------- GET all ----------
    $r = Invoke-Api 'GET' '/api/transaction-items?all=1' $null $null
    Add-Hasil 'GET all tanpa cookie -> 401' $r.Status 401 ''

    $r = Invoke-Api 'GET' '/api/transaction-items?all=1' $cookieA $null
    $allA = @(($r.Body | ConvertFrom-Json).data.items)
    Add-Hasil 'GET all owner A -> 2 item' $allA.Count 2 "count=$($allA.Count)"

    $r = Invoke-Api 'GET' '/api/transaction-items?all=1' $cookieB $null
    $allB = @(($r.Body | ConvertFrom-Json).data.items)
    Add-Hasil 'GET all owner B -> 1 item' $allB.Count 1 "count=$($allB.Count)"

    # ---------- POST replace ----------
    $r = Invoke-Api 'POST' '/api/transaction-items' $null '{"transaction_id":4001,"items":[]}'
    Add-Hasil 'POST tanpa cookie -> 401' $r.Status 401 ''

    $r = Invoke-Api 'POST' '/api/transaction-items' $cookieA '{"items":[]}'
    Add-Hasil 'POST tanpa transaction_id -> 400' $r.Status 400 ''

    $r = Invoke-Api 'POST' '/api/transaction-items' $cookieA '{"transaction_id":9999,"items":[]}'
    Add-Hasil 'POST transaction tidak ada -> 404' $r.Status 404 ''

    $r = Invoke-Api 'POST' '/api/transaction-items' $cookieA '{"transaction_id":5001,"items":[]}'
    Add-Hasil 'POST transaction tenant lain -> 404' $r.Status 404 ''

    $bodyReplace = '{"transaction_id":4001,"items":[{"inventory_id":103,"nama":"Kamera A","jenis":"satuan","qty":1,"harga":25000},{"ref":{"id":103,"nama":"Paket A","jenis":"bundling","harga":30000},"qty":2}]}'
    $r = Invoke-Api 'POST' '/api/transaction-items' $cookieA $bodyReplace
    Add-Hasil 'POST replace items tx 4001 -> 200' $r.Status 200 ''

    $r = Invoke-Api 'GET' '/api/transaction-items?transaction_id=4001' $cookieA $null
    $itemsNew = @(($r.Body | ConvertFrom-Json).data.items)
    Add-Hasil 'POST replace -> 2 item baru' $itemsNew.Count 2 "count=$($itemsNew.Count)"

    $i1 = $itemsNew | Where-Object { $_.item_name -eq 'Kamera A' }
    $i2 = $itemsNew | Where-Object { $_.item_name -eq 'Paket A' }
    $mappingOK = $i1 -and $i2 -and $i1.qty -eq 1 -and $i1.unit_price -eq 25000 -and $i2.qty -eq 2 -and $i2.unit_price -eq 30000
    Add-Hasil 'POST replace -> field mapping benar (nama/qty/harga)' ([int]$mappingOK) 1 ''

    $r = Invoke-Api 'POST' '/api/transaction-items' $cookieA '{"transaction_id":4002,"items":[]}'
    Add-Hasil 'POST replace kosong -> 200 (DELETE all)' $r.Status 200 ''

    $r = Invoke-Api 'GET' '/api/transaction-items?transaction_id=4002' $cookieA $null
    $items4002b = @(($r.Body | ConvertFrom-Json).data.items)
    Add-Hasil 'POST replace kosong -> tx 4002 0 item' $items4002b.Count 0 "count=$($items4002b.Count)"

    Write-Host "`n"
    $hasil | Format-Table -AutoSize | Out-String | Write-Host
    $gagal = @($hasil | Where-Object { $_.Hasil -eq 'GAGAL' }).Count
    if ($gagal -gt 0) {
        Write-Host "`n$gagal skenario GAGAL." -ForegroundColor Red
        exit 1
    }
    Write-Host "`nSemua skenario lolos." -ForegroundColor Green
}
finally {
    if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') stop
}