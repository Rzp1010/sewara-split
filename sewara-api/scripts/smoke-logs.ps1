# smoke-logs.ps1 — uji GET/POST/DELETE /api/logs + GET /api/logs/login
#
# Cakupan: CRUD log aktivitas (stamp user_id tenant, isolasi RLS, hapus ids /
# olderThanDays / semua) dan log login (owner = tenant sendiri, superadmin =
# semua, staf lain 403).
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

function LogsOf($r) { return ,@(($r.Body | ConvertFrom-Json).data.logs) }

$api = $null
try {
    Write-Host 'Menyiapkan binari...'
    Push-Location $root
    go build -o $apiExe ./cmd/api
    Pop-Location
    if ($LASTEXITCODE -ne 0) { throw 'go build gagal' }

    Write-Host 'Reset + mulai Docker staging...'
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') reset
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') start

    # Auth users untuk smoke (hash bcrypt untuk Rahasia123).
    $hash = '$2a$10$GCmHsmqVk3cqwXmf0AVWueY8h0JHD1zo0mr.tl0F/CH0dI/01mYEu'
    Sql "
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'owner-a@staging.local', '$hash', now()),
  ('a0000000-0000-0000-0000-000000000002', 'cs-a@staging.local',    '$hash', now()),
  ('a0000000-0000-0000-0000-000000000003', 'superadmin@staging.local', '$hash', now()),
  ('b0000000-0000-0000-0000-000000000001', 'owner-b@staging.local', '$hash', now())
ON CONFLICT (id) DO UPDATE SET encrypted_password='$hash', email_confirmed_at=now();"

    # Seed log login: satu milik tenant A, satu milik tenant B.
    Sql "
INSERT INTO login_logs (email, owner_id, event, detail, ip, user_agent) VALUES
  ('logs-ownerA@staging.local', 'a0000000-0000-0000-0000-000000000001', 'login_sukses', 'seed A', '10.0.0.1', 'seedUA'),
  ('logs-ownerB@staging.local', 'b0000000-0000-0000-0000-000000000001', 'login_sukses', 'seed B', '10.0.0.2', 'seedUB');"

    $env:DATABASE_URL = 'postgres://sewara:sewara123@127.0.0.1:5433/sewara?sslmode=disable'
    $env:ADDR = '127.0.0.1:8099'
    $env:APP_ENV = 'development'

    # Bunuh sisa proses API yang masih memegang port 8099 (sisa run sebelumnya).
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
    $cookieSA = Get-SessionCookie 'superadmin@staging.local'
    Write-Host 'Login berhasil'

    # ---------- LOG AKTIVITAS ----------
    $r = Invoke-Api 'GET' '/api/logs' $null $null
    Add-Hasil 'GET /api/logs tanpa cookie -> 401' $r.Status 401 ''

    $r = Invoke-Api 'POST' '/api/logs' $null '{"aktivitas":"x"}'
    Add-Hasil 'POST /api/logs tanpa cookie -> 401' $r.Status 401 ''

    $r = Invoke-Api 'DELETE' '/api/logs' $null '{}'
    Add-Hasil 'DELETE /api/logs tanpa cookie -> 401' $r.Status 401 ''

    $r = Invoke-Api 'GET' '/api/logs' $cookieA $null
    $awalA = (LogsOf $r).Count
    Add-Hasil 'GET owner A awal -> 0 log' $awalA 0 "count=$awalA"

    # ---------- POST single ----------
    $body1 = '{"waktu":"2026-10-30T10:00:00Z","aktivitas":"Masuk (Booking)","detail":"SN1","catatan":"-","pelayan":"Owner A","trx_info":"A • INV-1"}'
    $r = Invoke-Api 'POST' '/api/logs' $cookieA $body1
    $stamped = (LogsOf $r)[0].user_id
    Add-Hasil 'POST single -> user_id distempel tenant A' ([int]($r.Status -eq 200 -and $stamped -eq 'a0000000-0000-0000-0000-000000000001')) 1 "status=$($r.Status) user_id=$stamped"

    $r = Invoke-Api 'GET' '/api/logs' $cookieA $null
    $c = (LogsOf $r).Count
    Add-Hasil 'GET owner A setelah POST single -> 1 log' $c 1 "count=$c"

    # ---------- POST array ----------
    $body2 = '[{"aktivitas":"Keluar (Disewa)","detail":"d","catatan":"c","pelayan":"p","trx_info":"t1"},{"aktivitas":"Masuk (Selesai)","detail":"d2","catatan":"c2","pelayan":"p2","trx_info":"t2"}]'
    $r = Invoke-Api 'POST' '/api/logs' $cookieA $body2
    $n = (LogsOf $r).Count
    Add-Hasil 'POST array 2 log -> 200 + 2 baris' ([int]($r.Status -eq 200 -and $n -eq 2)) 1 "status=$($r.Status) count=$n"

    $r = Invoke-Api 'GET' '/api/logs' $cookieA $null
    $c = (LogsOf $r).Count
    Add-Hasil 'GET owner A -> 3 log' $c 3 "count=$c"

    # ---------- Isolasi tenant ----------
    $r = Invoke-Api 'GET' '/api/logs' $cookieB $null
    $cB = (LogsOf $r).Count
    Add-Hasil 'RLS: owner B tidak lihat log tenant A' $cB 0 "count=$cB"

    $r = Invoke-Api 'POST' '/api/logs' $cookieB '{"aktivitas":"Log B","detail":"d","catatan":"c","pelayan":"p","trx_info":"tb"}'
    Add-Hasil 'POST owner B -> 200' $r.Status 200 ''

    $r = Invoke-Api 'GET' '/api/logs' $cookieB $null
    $cB = (LogsOf $r).Count
    Add-Hasil 'GET owner B -> 1 log' $cB 1 "count=$cB"

    $r = Invoke-Api 'GET' '/api/logs' $cookieA $null
    $cA = (LogsOf $r).Count
    Add-Hasil 'GET owner A tetap 3 (tak terpengaruh B)' $cA 3 "count=$cA"

    # ---------- user_id + id kiriman klien diabaikan ----------
    $r = Invoke-Api 'POST' '/api/logs' $cookieA '{"id":99999,"aktivitas":"Uji stamp","user_id":"b0000000-0000-0000-0000-000000000001"}'
    $stamped = (LogsOf $r)[0].user_id
    Add-Hasil 'POST user_id/id klien diabaikan -> tetap tenant A' ([int]($stamped -eq 'a0000000-0000-0000-0000-000000000001')) 1 "user_id=$stamped"

    $r = Invoke-Api 'GET' '/api/logs' $cookieA $null
    $logsA = LogsOf $r
    Add-Hasil 'GET owner A -> 4 log' $logsA.Count 4 "count=$($logsA.Count)"

    # ---------- DELETE by ids ----------
    $idA = $logsA[0].id
    $r = Invoke-Api 'DELETE' '/api/logs' $cookieA ('{"ids":[' + $idA + ']}')
    $del = ($r.Body | ConvertFrom-Json).data.deleted
    Add-Hasil 'DELETE id milik A -> deleted 1' ([int]($r.Status -eq 200 -and $del -eq 1)) 1 "status=$($r.Status) deleted=$del"

    $r = Invoke-Api 'GET' '/api/logs' $cookieA $null
    $c = (LogsOf $r).Count
    Add-Hasil 'GET owner A -> 3 log setelah hapus' $c 3 "count=$c"

    # id milik tenant B, dihapus oleh cookie A -> RLS membuat tak terlihat (0)
    $r = Invoke-Api 'GET' '/api/logs' $cookieB $null
    $idB = (LogsOf $r)[0].id
    $r = Invoke-Api 'DELETE' '/api/logs' $cookieA ('{"ids":[' + $idB + ']}')
    $del = ($r.Body | ConvertFrom-Json).data.deleted
    Add-Hasil 'DELETE id tenant B oleh A -> deleted 0 (RLS)' ([int]($del -eq 0)) 1 "deleted=$del"

    # ---------- DELETE olderThanDays ----------
    Sql "INSERT INTO activity_logs (waktu, aktivitas, detail, catatan, pelayan, trx_info, user_id, created_at) VALUES ('2026-01-01T00:00:00Z','Lama','d','c','p','t','a0000000-0000-0000-0000-000000000001', now() - interval '100 days');"
    $r = Invoke-Api 'DELETE' '/api/logs' $cookieA '{"olderThanDays":90}'
    $del = ($r.Body | ConvertFrom-Json).data.deleted
    Add-Hasil 'DELETE olderThanDays 90 -> deleted 1' ([int]($del -eq 1)) 1 "deleted=$del"

    # ---------- DELETE semua ----------
    $r = Invoke-Api 'DELETE' '/api/logs' $cookieA '{}'
    $del = ($r.Body | ConvertFrom-Json).data.deleted
    Add-Hasil 'DELETE kosong -> hapus semua tenant A (3)' ([int]($del -eq 3)) 1 "deleted=$del"

    $r = Invoke-Api 'GET' '/api/logs' $cookieA $null
    $c = (LogsOf $r).Count
    Add-Hasil 'GET owner A -> 0 log' $c 0 "count=$c"

    $r = Invoke-Api 'GET' '/api/logs' $cookieB $null
    $cB = (LogsOf $r).Count
    Add-Hasil 'GET owner B tetap 1 (delete-all tidak bocor)' $cB 1 "count=$cB"

    # ---------- LOG LOGIN ----------
    $r = Invoke-Api 'GET' '/api/logs/login' $null $null
    Add-Hasil 'GET /api/logs/login tanpa cookie -> 401' $r.Status 401 ''

    $r = Invoke-Api 'GET' '/api/logs/login' $cookieCS $null
    Add-Hasil 'GET /api/logs/login oleh staf -> 403' $r.Status 403 ''

    $r = Invoke-Api 'GET' '/api/logs/login' $cookieA $null
    $emailA = @(LogsOf $r | ForEach-Object { $_.email })
    $adaA = $emailA -contains 'logs-ownerA@staging.local'
    $adaB = $emailA -contains 'logs-ownerB@staging.local'
    Add-Hasil 'login owner A -> seed A ada, seed B tidak' ([int]($adaA -and -not $adaB)) 1 "adaA=$adaA adaB=$adaB"

    $r = Invoke-Api 'GET' '/api/logs/login' $cookieSA $null
    $emailSA = @(LogsOf $r | ForEach-Object { $_.email })
    $saA = $emailSA -contains 'logs-ownerA@staging.local'
    $saB = $emailSA -contains 'logs-ownerB@staging.local'
    Add-Hasil 'login superadmin -> lihat seed A dan B' ([int]($saA -and $saB)) 1 "A=$saA B=$saB"

    $r = Invoke-Api 'GET' '/api/logs/login?limit=1' $cookieA $null
    $c = (LogsOf $r).Count
    Add-Hasil 'login limit=1 -> 1 baris' $c 1 "count=$c"

    Write-Host "`n"
    $hasil | Format-Table -AutoSize | Out-String | Write-Host
    $gagal = @($hasil | Where-Object { $_.Hasil -eq 'GAGAL' }).Count
    if ($gagal -gt 0) {
        Write-Host "`n$gagal skenario GAGAL." -ForegroundColor Red
        exit 1
    }
    Write-Host "`nSemua $($hasil.Count) skenario lolos." -ForegroundColor Green
}
finally {
    if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') stop
}
