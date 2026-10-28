# smoke-inventory.ps1 — uji GET/POST /api/inventory
#
# Kontainer di-reset dulu supaya jumlah baris eksak dan hasil bisa diulang.
# Tanpa reset, POST dari run sebelumnya ikut terhitung.

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

function Count-Json([string]$body, [string]$key) {
    return ([regex]::Matches($body, [regex]::Escape("`"$key`":")).Count)
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

Write-Host 'Reset + mulai Docker staging (skema + seed bersih)...'
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
    $csA    = Get-SessionCookie 'cs-a@staging.local'

    $hasil = @()
    function Add-Hasil([string]$nama, [bool]$lolos, [string]$info) {
        $script:hasil += [pscustomobject]@{
            Skenario = $nama; Hasil = $(if ($lolos) { 'LOLOS' } else { 'GAGAL' }); Info = $info
        }
    }

    # ---------- GET ----------
    $r = Invoke-Api 'GET' '/api/inventory' $null
    Add-Hasil 'GET tanpa cookie -> 401' ($r.Status -eq 401) "status=$($r.Status)"

    $r = Invoke-Api 'GET' '/api/inventory' $ownerA
    $n = Count-Json $r.Body 'id'
    $ok = ($r.Status -eq 200) -and ($n -eq 3) -and ($r.Body -match 'Kamera A') -and ($r.Body -notmatch 'Kamera B')
    Add-Hasil 'Owner A lihat 3 barang sendiri' $ok "status=$($r.Status) count=$n"

    # Nama field JSON harus sama dengan backend Next (snake_case + tipeSewa camelCase).
    # -cmatch / -cnotmatch: operator -match PowerShell case-insensitive, sehingga
    # `-notmatch '"TipeSewa"'` selalu gagal karena cocok dengan "tipeSewa".
    $fieldOk = ($r.Body -cmatch '"tipeSewa"') -and ($r.Body -cnotmatch '"TipeSewa"') -and
               ($r.Body -cmatch '"kondisi_sn"') -and ($r.Body -cmatch '"user_id"') -and ($r.Body -cmatch '"nama"')
    Add-Hasil 'Nama field JSON sesuai kontrak' $fieldOk 'tipeSewa/kondisi_sn/user_id/nama'

    $r = Invoke-Api 'GET' '/api/inventory?ids=101,102' $ownerA
    $n = Count-Json $r.Body 'id'
    $ok = ($r.Status -eq 200) -and ($n -eq 2) -and ($r.Body -match '"id":101') -and ($r.Body -notmatch '"id":103')
    Add-Hasil 'Filter ids=101,102 -> 2 baris' $ok "count=$n"

    $r = Invoke-Api 'GET' '/api/inventory?ids=101' $ownerB
    $n = Count-Json $r.Body 'id'
    Add-Hasil 'Owner B minta id tenant A -> 0 (RLS)' ($r.Status -eq 200 -and $n -eq 0) "count=$n"

    $r = Invoke-Api 'GET' '/api/inventory?ringkas=1' $ownerA
    $n = Count-Json $r.Body 'id'
    $ok = ($r.Status -eq 200) -and ($n -eq 3) -and ($r.Body -match '"id":101') -and ($r.Body -notmatch '"nama"')
    Add-Hasil 'ringkas=1 -> hanya id' $ok "count=$n"

    $r = Invoke-Api 'GET' '/api/inventory?ids=' $ownerA
    $n = Count-Json $r.Body 'id'
    Add-Hasil 'ids= kosong -> 0 baris (bukan semua)' ($r.Status -eq 200 -and $n -eq 0) "count=$n"

    $r = Invoke-Api 'GET' '/api/inventory?kolom=id' $ownerA
    Add-Hasil 'kolom= ditolak -> 400' ($r.Status -eq 400) "status=$($r.Status)"

    $r = Invoke-Api 'GET' '/api/inventory?ids=abc' $ownerA
    Add-Hasil 'ids bukan angka -> 400' ($r.Status -eq 400) "status=$($r.Status)"

    # ---------- POST validasi ----------
    $r = Invoke-Api 'POST' '/api/inventory' $ownerA '{"jenis":"satuan","h24":1000}'
    Add-Hasil 'POST tanpa nama -> 400' ($r.Status -eq 400) "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/inventory' $ownerA '{"jenis":"hantu","nama":"X","h24":1000}'
    Add-Hasil 'POST jenis tidak dikenal -> 400' ($r.Status -eq 400) "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/inventory' $ownerA '{"jenis":"satuan","nama":"X","h24":1000,"kondisi":"Sangat Rusak"}'
    Add-Hasil 'POST kondisi tidak dikenal -> 400' ($r.Status -eq 400) "status=$($r.Status)"

    $r = Invoke-Api 'POST' '/api/inventory' $ownerA '{"jenis":"satuan","nama":"   ","h24":1000}'
    Add-Hasil 'POST nama spasi saja -> 400' ($r.Status -eq 400) "status=$($r.Status)"

    # ---------- POST sukses ----------
    $body = '{"jenis":"satuan","nama":"Barang Uji A","tipeSewa":"fleksibel","h6":10000,"h12":20000,"h24":30000,' +
            '"denda":5000,"tag":"uji","kondisi":"Baik","keterangan":"barang uji","sns":["UJI-001","UJI-002"]}'
    $r = Invoke-Api 'POST' '/api/inventory' $ownerA $body
    $ok = ($r.Status -eq 200) -and ($r.Body -match '"nama":"Barang Uji A"') -and
          ($r.Body -match '"denda":"5000"') -and ($r.Body -match '"tipeSewa":"fleksibel"') -and
          ($r.Body -match '"kondisi":"Baik"') -and ($r.Body -match '"UJI-001"') -and
          ($r.Body -match '"user_id":"a0000000-0000-0000-0000-000000000001"')
    Add-Hasil 'POST valid -> tersimpan + denda angka jadi teks' $ok "status=$($r.Status)"

    $idBaru = $null
    if ($r.Body -match '"id":(\d+)') { $idBaru = $Matches[1] }
    Add-Hasil 'POST memakai id dari sequence (bukan kiriman client)' ($null -ne $idBaru -and [int64]$idBaru -gt 100) "id=$idBaru"

    $body = '{"jenis":"bundling","nama":"Paket Uji","h24":100000,"komponen":[{"idBarang":"101","qty":2}]}'
    $r = Invoke-Api 'POST' '/api/inventory' $ownerA $body
    # jsonb menormalkan urutan kunci (qty bisa muncul sebelum idBarang), jadi isi
    # diperiksa per nilai, bukan sebagai potongan string utuh.
    $ok = ($r.Status -eq 200) -and ($r.Body -cmatch '"idBarang":"101"') -and ($r.Body -cmatch '"qty":2') -and
          ($r.Body -cmatch '"sns":\[\]') -and ($r.Body -cmatch '"kondisi_sn":\{\}') -and
          ($r.Body -cmatch '"kondisi":"Baik"') -and ($r.Body -cmatch '"h6":0')
    Add-Hasil 'POST bundling -> default sns/kondisi_sn/kondisi terisi' $ok "status=$($r.Status)"

    # Staf menulis atas nama owner
    $body = '{"jenis":"satuan","nama":"Barang CS","h24":5000,"sns":["CS-001"],"kondisi":"Sangat Baik"}'
    $r = Invoke-Api 'POST' '/api/inventory' $csA $body
    $ok = ($r.Status -eq 200) -and ($r.Body -match '"user_id":"a0000000-0000-0000-0000-000000000001"') -and
          ($r.Body -match '"kondisi":"Sangat Baik"')
    Add-Hasil 'POST oleh CS A -> user_id tenant owner A' $ok "status=$($r.Status)"

    # ---------- Konsistensi setelah tulis ----------
    $r = Invoke-Api 'GET' '/api/inventory' $ownerA
    $n = Count-Json $r.Body 'id'
    Add-Hasil 'Owner A lihat 6 barang setelah 3 POST' ($n -eq 6) "count=$n"

    $r = Invoke-Api 'GET' '/api/inventory' $ownerB
    $n = Count-Json $r.Body 'id'
    Add-Hasil 'Owner B tetap 3 barang (tidak bocor)' ($n -eq 3) "count=$n"

    if ($idBaru) {
        $r = Invoke-Api 'GET' "/api/inventory?ids=$idBaru" $ownerA
        $ok = ($r.Status -eq 200) -and ($r.Body -match '"denda":"5000"') -and ($r.Body -match '"UJI-002"')
        Add-Hasil 'Baca ulang barang baru: denda & sns utuh' $ok "status=$($r.Status)"
    }

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
