# smoke-chat.ps1 — uji chat internal tenant (/api/chat)
#
# Cakupan: kirim pesan room + pesan ber-trxId, daftar ruang gabungan vs thread
# per invoice, validasi pesan, isolasi tenant (RLS), unread per user + scope,
# tandai dibaca, dan hak hapus (penulis / owner / staf lain).
#
# Prasyarat: Docker staging jalan + seed termuat (lifecycle diurus skrip ini:
# reset lalu start, dan migration chat dimuat runner docker-staging.ps1).

$ErrorActionPreference = 'Stop'

$root   = Split-Path -Parent $PSScriptRoot
$apiExe = Join-Path $root '.data\bin\sewara-api.exe'
$apiURL = 'http://127.0.0.1:8099'
$tmpDir = Join-Path $env:TEMP 'opencode'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

$dockerBin = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin"
$env:PATH = "$dockerBin;$env:PATH"

function Invoke-Api([string]$method, [string]$path, [string]$cookie, [string]$body) {
    $outFile = Join-Path $tmpDir 'chat-out.bin'
    $curlArgs = @('-s', '--max-time', '15', '-o', $outFile, '-w', '%{http_code}', '-X', $method)
    if ($cookie) { $curlArgs += @('-H', "Cookie: sewara_session=$cookie") }
    if ($body) {
        $bodyFile = Join-Path $tmpDir 'chat-body.json'
        [System.IO.File]::WriteAllText($bodyFile, $body, (New-Object System.Text.UTF8Encoding($false)))
        $curlArgs += @('-H', 'Content-Type: application/json', '--data-binary', "@$bodyFile")
    }
    $curlArgs += "$apiURL$path"
    $status = [int](curl.exe @curlArgs)
    $respBody = Get-Content $outFile -Raw -ErrorAction SilentlyContinue
    return @{ Status = $status; Body = $respBody }
}

function Get-SessionCookie([string]$email) {
    $jar = Join-Path $tmpDir 'chat-session.txt'
    Remove-Item $jar -ErrorAction SilentlyContinue
    $body = "{`"email`":`"$email`",`"password`":`"Rahasia123`"}"
    $bodyFile = Join-Path $tmpDir 'chat-login.json'
    [System.IO.File]::WriteAllText($bodyFile, $body, (New-Object System.Text.UTF8Encoding($false)))
    $status = [int](curl.exe -s --max-time 15 -o NUL -w '%{http_code}' -c $jar -H 'Content-Type: application/json' --data-binary "@$bodyFile" "$apiURL/api/auth/login")
    if ($status -ne 200) { throw "Login $email gagal (HTTP $status)" }
    $isian = Get-Content $jar -Raw
    if ($isian -match 'sewara_session\s+([^\s]+)') { return $Matches[1] }
    throw "Cookie tidak ditemukan setelah login $email"
}

function Sql([string]$sql) {
    docker exec sewara-staging-db psql -U sewara -d sewara -c $sql | Out-Null
}

$hasil = @()
function Add-Hasil([string]$nama, [int]$dapat, [int]$harap, [string]$info) {
    $script:hasil += [pscustomobject]@{
        Skenario = $nama; Status = $dapat; Harap = $harap
        Hasil = $(if ($dapat -eq $harap) { 'LOLOS' } else { 'GAGAL' }); Info = $info
    }
}

function PesanOf($r) { return ,@(($r.Body | ConvertFrom-Json).data.messages) }

$api = $null
$trxA = '1793799472301'
$trxHantu = '1793799472999'
try {
    Write-Host 'Menyiapkan binari...'
    Push-Location $root
    go build -o $apiExe ./cmd/api
    Pop-Location
    if ($LASTEXITCODE -ne 0) { throw 'go build gagal' }

    Write-Host 'Reset + mulai Docker staging...'
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') reset
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') start

    $hash = '$2a$10$GCmHsmqVk3cqwXmf0AVWueY8h0JHD1zo0mr.tl0F/CH0dI/01mYEu'
    Sql "
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'owner-a@staging.local', '$hash', now()),
  ('a0000000-0000-0000-0000-000000000002', 'cs-a@staging.local',    '$hash', now()),
  ('b0000000-0000-0000-0000-000000000001', 'owner-b@staging.local', '$hash', now())
ON CONFLICT (id) DO UPDATE SET encrypted_password='$hash', email_confirmed_at=now();"

    $env:DATABASE_URL = 'postgres://sewara:sewara123@127.0.0.1:5433/sewara?sslmode=disable'
    $env:ADDR = '127.0.0.1:8099'
    $env:APP_ENV = 'development'

    $pemakaiPort = @(Get-NetTCPConnection -LocalPort 8099 -State Listen -ErrorAction SilentlyContinue)
    foreach ($c in $pemakaiPort) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
    if ($pemakaiPort.Count -gt 0) { Start-Sleep -Milliseconds 500 }

    $api = Start-Process -FilePath $apiExe -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $tmpDir 'api-stdout.log') -RedirectStandardError (Join-Path $tmpDir 'api-stderr.log')

    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 300
        if ((curl.exe -s -o NUL -w '%{http_code}' --max-time 2 "$apiURL/api/health") -eq '200') { $ready = $true; break }
    }
    if (-not $ready) { throw 'API tidak siap' }

    Write-Host "`n=== Login ==="
    $cookieA = Get-SessionCookie 'owner-a@staging.local'
    $cookieB = Get-SessionCookie 'owner-b@staging.local'
    $cookieCS = Get-SessionCookie 'cs-a@staging.local'
    Write-Host 'Login berhasil'

    # ---------- Tanpa cookie ----------
    $r = Invoke-Api 'GET' '/api/chat' $null $null
    Add-Hasil 'GET /api/chat tanpa cookie' $r.Status 401 ''
    $r = Invoke-Api 'POST' '/api/chat' $null '{"pesan":"x"}'
    Add-Hasil 'POST /api/chat tanpa cookie' $r.Status 401 ''
    $r = Invoke-Api 'GET' '/api/chat/unread' $null $null
    Add-Hasil 'GET /api/chat/unread tanpa cookie' $r.Status 401 ''

    # ---------- Kirim pesan ----------
    $r = Invoke-Api 'POST' '/api/chat' $cookieA '{"pesan":"catatan shift pagi"}'
    $msgRoom = ($r.Body | ConvertFrom-Json).data.message
    Add-Hasil 'kirim pesan room (owner A)' ([int]($r.Status -eq 200)) 1 "status=$($r.Status)"
    Add-Hasil 'pesan room tanpa trxId + author owner A' ([int]($null -eq $msgRoom.trxId -and $msgRoom.authorId -eq 'a0000000-0000-0000-0000-000000000001')) 1 "trxId=$($msgRoom.trxId) author=$($msgRoom.authorId)"
    Add-Hasil 'authorNama tersimpan dari server' ([int]($msgRoom.authorNama -eq 'Owner A')) 1 "nama=$($msgRoom.authorNama)"

    $r = Invoke-Api 'POST' '/api/chat' $cookieA ('{"trxId":"' + $trxA + '","pesan":"barang sudah diambil"}')
    $msgTrx = ($r.Body | ConvertFrom-Json).data.message
    Add-Hasil 'kirim pesan menempel invoice' ([int]($r.Status -eq 200 -and $msgTrx.trxId -eq $trxA)) 1 "status=$($r.Status) trxId=$($msgTrx.trxId)"

    # Klien boleh mengirim trxId sebagai angka JSON (bukan string).
    $r = Invoke-Api 'POST' '/api/chat' $cookieA ('{"trxId":' + $trxA + ',"pesan":"angka mentah"}')
    $msgNum = ($r.Body | ConvertFrom-Json).data.message
    Add-Hasil 'kirim pesan dengan trxId angka JSON' ([int]($r.Status -eq 200 -and $msgNum.trxId -eq $trxA)) 1 "status=$($r.Status) trxId=$($msgNum.trxId)"

    # ---------- Daftar ----------
    $r = Invoke-Api 'GET' '/api/chat' $cookieA $null
    $semua = PesanOf $r
    Add-Hasil 'ruang gabungan memuat pesan bebas + invoice' $semua.Count 3 "count=$($semua.Count)"

    $r = Invoke-Api 'GET' "/api/chat?trxId=$trxA" $cookieA $null
    $thread = PesanOf $r
    Add-Hasil 'thread invoice hanya pesannya' ([int]($thread.Count -eq 2 -and @($thread | Where-Object { $_.id -eq $msgTrx.id }).Count -eq 1)) 1 "count=$($thread.Count)"
    Add-Hasil 'thread urut lama -> baru' ([int]($thread[0].id -eq $msgTrx.id -and $thread[1].id -eq $msgNum.id)) 1 "pertama=$($thread[0].pesan) terakhir=$($thread[1].pesan)"
    Add-Hasil 'createdAt ISO bersih' ([int]($thread[0].createdAt -match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$')) 1 "createdAt=$($thread[0].createdAt)"
    Add-Hasil 'thread invoice tidak memuat pesan bebas' ([int](@($thread | Where-Object { $null -eq $_.trxId }).Count -eq 0)) 1 ''

    $r = Invoke-Api 'GET' "/api/chat?trxId=$trxHantu" $cookieA $null
    Add-Hasil 'thread invoice lain kosong' (PesanOf $r).Count 0 ''

    $r = Invoke-Api 'GET' '/api/chat?trxId=bukan-angka' $cookieA $null
    Add-Hasil 'trxId bukan angka -> 400' $r.Status 400 ''

    # ---------- Validasi ----------
    $r = Invoke-Api 'POST' '/api/chat' $cookieA '{"pesan":"   "}'
    Add-Hasil 'pesan kosong -> 400' $r.Status 400 ''

    $panjang = 'a' * 2001
    $r = Invoke-Api 'POST' '/api/chat' $cookieA ('{"pesan":"' + $panjang + '"}')
    Add-Hasil 'pesan 2001 karakter -> 400' $r.Status 400 ''

    $r = Invoke-Api 'POST' '/api/chat' $cookieA '{"pesan":"ok","trxId":"bukan-angka"}'
    Add-Hasil 'trxId bukan angka saat kirim -> 400' $r.Status 400 ''

    # ---------- Isolasi tenant ----------
    $r = Invoke-Api 'GET' '/api/chat' $cookieB $null
    Add-Hasil 'RLS: owner B tidak lihat chat tenant A' (PesanOf $r).Count 0 ''
    $r = Invoke-Api 'GET' '/api/chat/unread' $cookieB $null
    $uB = ($r.Body | ConvertFrom-Json).data
    Add-Hasil 'unread owner B nol (isolasi tenant)' ([int]($uB.total -eq 0)) 1 "total=$($uB.total)"

    # ---------- Staf sekamar (cs-a se-tenant owner A) ----------
    $r = Invoke-Api 'POST' '/api/chat' $cookieCS '{"pesan":"handover: 2 unit keluar"}'
    Add-Hasil 'staf se-tenant boleh kirim pesan' $r.Status 200 ''
    $r = Invoke-Api 'GET' '/api/chat' $cookieCS $null
    Add-Hasil 'staf lihat pesan ruang tenant yang sama' (PesanOf $r).Count 4 ''

    # ---------- Unread ----------
    $r = Invoke-Api 'GET' '/api/chat/unread' $cookieA $null
    $uA = ($r.Body | ConvertFrom-Json).data
    Add-Hasil 'unread owner A: pesan staf ruang = 1' ([int]($uA.room -eq 1)) 1 "room=$($uA.room)"
    Add-Hasil 'unread owner A: total 1 (pesan sendiri tak dihitung)' ([int]($uA.total -eq 1)) 1 "total=$($uA.total)"

    $r = Invoke-Api 'GET' '/api/chat/unread' $cookieCS $null
    $uCS = ($r.Body | ConvertFrom-Json).data
    Add-Hasil 'unread staf: 3 pesan owner A (ruang + invoice)' ([int]($uCS.total -eq 3 -and $uCS.room -eq 1)) 1 "total=$($uCS.total) room=$($uCS.room)"
    Add-Hasil 'unread staf per invoice terisi' ([int]($uCS.perTrx.$trxA -eq 2)) 1 "perTrx=$($uCS.perTrx.$trxA)"

    # ---------- Tandai dibaca ----------
    $r = Invoke-Api 'POST' '/api/chat/read' $cookieA '{}'
    $r = Invoke-Api 'GET' '/api/chat/unread' $cookieA $null
    $uA = ($r.Body | ConvertFrom-Json).data
    Add-Hasil 'read room -> unread owner A nol' ([int]($uA.total -eq 0 -and $uA.room -eq 0)) 1 "total=$($uA.total)"

    $r = Invoke-Api 'POST' '/api/chat' $cookieCS ('{"trxId":"' + $trxA + '","pesan":"catatan invoice baru"}')
    $r = Invoke-Api 'GET' '/api/chat/unread' $cookieA $null
    $uA = ($r.Body | ConvertFrom-Json).data
    Add-Hasil 'unread invoice muncul setelah read' ([int]($uA.perTrx.$trxA -eq 1 -and $uA.room -eq 0)) 1 "perTrx=$($uA.perTrx.$trxA) room=$($uA.room)"

    $r = Invoke-Api 'POST' '/api/chat/read' $cookieA ('{"trxId":"' + $trxA + '"}')
    $r = Invoke-Api 'GET' '/api/chat/unread' $cookieA $null
    $uA = ($r.Body | ConvertFrom-Json).data
    Add-Hasil 'read invoice -> unread nol' ([int]($uA.total -eq 0)) 1 "total=$($uA.total)"

    $r = Invoke-Api 'POST' '/api/chat/read' $cookieA '{"trxId":"bukan-angka"}'
    Add-Hasil 'read trxId bukan angka -> 400' $r.Status 400 ''

    # ---------- Hapus ----------
    $r = Invoke-Api 'POST' '/api/chat' $cookieCS '{"pesan":"pesan staf untuk diuji hapus"}'
    $msgCS = ($r.Body | ConvertFrom-Json).data.message

    $r = Invoke-Api 'DELETE' "/api/chat/$($msgCS.id)" $cookieB $null
    Add-Hasil 'hapus pesan tenant lain -> 404 (RLS)' $r.Status 404 ''

    $r = Invoke-Api 'DELETE' "/api/chat/$($msgRoom.id)" $cookieCS $null
    Add-Hasil 'staf hapus pesan owner -> 403' $r.Status 403 ''

    $r = Invoke-Api 'DELETE' "/api/chat/$($msgCS.id)" $cookieA $null
    Add-Hasil 'owner hapus pesan staf -> 200' $r.Status 200 ''

    $r = Invoke-Api 'POST' '/api/chat' $cookieCS '{"pesan":"hapus oleh penulis"}'
    $msgCS2 = ($r.Body | ConvertFrom-Json).data.message
    $r = Invoke-Api 'DELETE' "/api/chat/$($msgCS2.id)" $cookieCS $null
    Add-Hasil 'penulis hapus pesannya sendiri -> 200' $r.Status 200 ''

    $r = Invoke-Api 'DELETE' "/api/chat/$trxHantu" $cookieA $null
    Add-Hasil 'hapus id tidak dikenal -> 404' $r.Status 404 ''

    $r = Invoke-Api 'DELETE' '/api/chat/bukan-uuid' $cookieA $null
    Add-Hasil 'hapus id bukan uuid -> 404' $r.Status 404 ''

    $r = Invoke-Api 'GET' "/api/chat?trxId=$trxA" $cookieA $null
    Add-Hasil 'thread invoice berkurang setelah hapus' (PesanOf $r).Count 3 "count=$((PesanOf $r).Count)"

    Write-Host "`n"
    $hasil | Format-Table -AutoSize | Out-String | Write-Host
    $gagal = @($hasil | Where-Object { $_.Hasil -eq 'GAGAL' }).Count
    Write-Host "LOLOS=$($hasil.Count - $gagal) GAGAL=$gagal"
    if ($gagal -gt 0) { exit 1 }
}
finally {
    if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') stop
}
