# smoke-eksternal.ps1 — uji domain eksternal pada Docker staging saja:
#   POST /api/telegram/test
#   POST /api/telegram/webhook
#   POST /api/webhooks/payment
#
# Telegram Bot API diarahkan ke stub lokal (System.Net.HttpListener, port 8190)
# lewat TELEGRAM_API_BASE. Tidak ada jaringan luar. Assertion memeriksa isi body
# dan efek ke stub, bukan hanya status. Jalan berurutan, jangan paralel.

$ErrorActionPreference = 'Stop'

$root    = Split-Path -Parent $PSScriptRoot
$apiExe  = Join-Path $root '.data\bin\sewara-api.exe'
$apiURL  = 'http://127.0.0.1:8099'
$stubURL = 'http://127.0.0.1:8190'
$tmpDir  = Join-Path $env:TEMP 'opencode'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

$env:PATH = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:PATH"

# Nama variabel UUID tidak boleh satu huruf: PowerShell tak bedakan besar-kecil.
$OWNER_A = 'a0000000-0000-0000-0000-000000000001'
$CS_A    = 'a0000000-0000-0000-0000-000000000002'
$SA      = 'a0000000-0000-0000-0000-000000000003'
$SECRET  = 'smoke-telegram-secret'
$TG_TOKEN = 'smokebot'
$TG_CHAT  = '-1009999'

function Sql([string]$q) {
    $o = docker exec sewara-staging-db psql -U sewara -d sewara -At -c $q
    if ($LASTEXITCODE -ne 0) { throw "psql gagal: $q" }
    return ($o -join "`n").Trim()
}

function Invoke-Api([string]$method, [string]$path, [string]$cookie, [string]$body, [string]$webhookSecret) {
    $f = Join-Path $tmpDir 'eksternal-resp.txt'
    $a = @('-s', '--max-time', '20', '-o', $f, '-w', '%{http_code}', '-X', $method)
    if ($cookie) { $a += @('-H', "Cookie: sewara_session=$cookie") }
    if ($webhookSecret -ne '') { $a += @('-H', "x-webhook-secret: $webhookSecret") }
    if ($body) {
        $bf = Join-Path $tmpDir 'eksternal-body.json'
        [IO.File]::WriteAllText($bf, $body, [Text.UTF8Encoding]::new($false))
        $a += @('-H', 'Content-Type: application/json', '--data-binary', "@$bf")
    }
    $a += "$apiURL$path"
    $s = [int](curl.exe @a)
    return @{ Status = $s; Body = (Get-Content $f -Raw -ErrorAction SilentlyContinue) }
}

function Get-SessionCookie([string]$email) {
    $jar  = Join-Path $tmpDir 'eksternal-cookie.txt'
    $body = Join-Path $tmpDir 'eksternal-login.json'
    [IO.File]::WriteAllText($body, "{`"email`":`"$email`",`"password`":`"Rahasia123`"}", [Text.UTF8Encoding]::new($false))
    $s = [int](curl.exe -s -o NUL -w '%{http_code}' -c $jar -H 'Content-Type: application/json' --data-binary "@$body" "$apiURL/api/auth/login")
    if ($s -ne 200) { throw "Login $email gagal HTTP $s" }
    if ((Get-Content $jar -Raw) -match 'sewara_session\s+([^\s]+)') { return $Matches[1] }
    throw 'Cookie hilang'
}

$hasil = @()
function Add([string]$n, [bool]$ok, [string]$info) {
    $script:hasil += [pscustomobject]@{ Skenario = $n; Hasil = $(if ($ok) { 'LOLOS' } else { 'GAGAL' }); Info = $info }
}
function Msg($r) { ($r.Body | ConvertFrom-Json).error.message }
function Code($r) { ($r.Body | ConvertFrom-Json).error.code }

# ---- Stub Telegram (runspace terpisah, state via synchronized hashtable) ----
$state = [hashtable]::Synchronized(@{
    Status   = 200
    Stop     = $false
    Requests = [System.Collections.ArrayList]::Synchronized((New-Object System.Collections.ArrayList))
})
function Stub-Count { return $state.Requests.Count }
function Stub-Last {
    $n = $state.Requests.Count
    if ($n -eq 0) { return $null }
    return $state.Requests[$n - 1]
}
function Stub-Body($req) { if ($req) { return ($req.Body | ConvertFrom-Json) } return $null }

# tulis/bersihkan setting telegram superadmin.
# Lewat stdin docker (bukan -c) supaya tanda kutip JSON tidak dimakan PowerShell
# saat menyerahkan argumen ke exe native.
function Invoke-SqlStdin([string]$sql) {
    $out = $sql | docker exec -i sewara-staging-db psql -U sewara -d sewara -At
    if ($LASTEXITCODE -ne 0) { throw "psql gagal: $sql" }
    return ($out -join "`n").Trim()
}
function Set-Tg([string]$json) {
    $esc = $json.Replace("'", "''")
    Invoke-SqlStdin "INSERT INTO settings(user_id,key,value,updated_at) VALUES ('$SA','telegram_login_notif','$esc',now()) ON CONFLICT(user_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now();" | Out-Null
}
function Clear-Tg { Invoke-SqlStdin "DELETE FROM settings WHERE user_id='$SA' AND key='telegram_login_notif';" | Out-Null }

$api = $null
$rs = $null; $psStub = $null
try {
    Push-Location $root
    go build -o $apiExe ./cmd/api
    Pop-Location
    if ($LASTEXITCODE -ne 0) { throw 'go build gagal' }

    & (Join-Path $PSScriptRoot 'docker-staging.ps1') reset | Out-Null
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') start | Out-Null

    $hash = '$2a$10$GCmHsmqVk3cqwXmf0AVWueY8h0JHD1zo0mr.tl0F/CH0dI/01mYEu'
    Sql "INSERT INTO auth.users(id,email,encrypted_password,email_confirmed_at) VALUES ('$OWNER_A','owner-a@staging.local','$hash',now()),('$CS_A','cs-a@staging.local','$hash',now()),('$SA','superadmin@staging.local','$hash',now()) ON CONFLICT(id) DO UPDATE SET encrypted_password='$hash',email_confirmed_at=now();" | Out-Null

    # pastikan awal tanpa setting telegram superadmin
    Clear-Tg
    $tgBaseline = Sql "SELECT count(*) FROM settings WHERE user_id='$SA' AND key='telegram_login_notif';"

    # ---- start stub ----
    $rs = [runspacefactory]::CreateRunspace()
    $rs.Open()
    $rs.SessionStateProxy.SetVariable('state', $state)
    $psStub = [powershell]::Create()
    $psStub.Runspace = $rs
    [void]$psStub.AddScript({
        $listener = New-Object System.Net.HttpListener
        $listener.Prefixes.Add('http://127.0.0.1:8190/')
        $listener.Start()
        while (-not $state.Stop) {
            try { $ctx = $listener.GetContext() } catch { break }
            $reader = New-Object System.IO.StreamReader($ctx.Request.InputStream)
            $body = $reader.ReadToEnd()
            $reader.Close()
            [void]$state.Requests.Add([pscustomobject]@{ Method = $ctx.Request.HttpMethod; Path = $ctx.Request.Url.AbsolutePath; Body = $body })
            $ctx.Response.StatusCode = [int]$state.Status
            $ctx.Response.ContentType = 'application/json'
            $ctx.Response.Close()
        }
        try { $listener.Stop(); $listener.Close() } catch {}
    })
    [void]$psStub.BeginInvoke()
    Start-Sleep -Milliseconds 400

    # ---- start API ----
    $env:DATABASE_URL = 'postgres://sewara:sewara123@127.0.0.1:5433/sewara?sslmode=disable'
    $env:ADDR = '127.0.0.1:8099'
    $env:APP_ENV = 'development'
    $env:R2_ENDPOINT = ''; $env:R2_ACCESS_KEY_ID = ''; $env:R2_SECRET_ACCESS_KEY = ''; $env:R2_BUCKET = ''; $env:R2_BUCKET_NAME = ''
    $env:WEBHOOK_TELEGRAM_SECRET = $SECRET
    $env:TELEGRAM_API_BASE = $stubURL
    $env:TELEGRAM_CHAT_ID = '-1003838354394'

    $ls = @(Get-NetTCPConnection -LocalPort 8099 -State Listen -ErrorAction SilentlyContinue)
    foreach ($l in $ls) { Stop-Process -Id $l.OwningProcess -Force -ErrorAction SilentlyContinue }
    $api = Start-Process $apiExe -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $tmpDir 'eksternal-api.out') -RedirectStandardError (Join-Path $tmpDir 'eksternal-api.err')
    $ready = $false
    for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 300; if ((curl.exe -s -o NUL -w '%{http_code}' "$apiURL/api/health") -eq '200') { $ready = $true; break } }
    if (-not $ready) { throw 'API tidak siap' }

    $a  = Get-SessionCookie 'owner-a@staging.local'
    $cs = Get-SessionCookie 'cs-a@staging.local'
    $sesSuper = Get-SessionCookie 'superadmin@staging.local'

    # ================= telegram/test =================
    $r = Invoke-Api POST '/api/telegram/test' '' $null ''
    Add 'test tanpa cookie → 401' ($r.Status -eq 401 -and (Code $r) -eq 'UNAUTHORIZED') $r.Body

    $r = Invoke-Api POST '/api/telegram/test' $a $null ''
    Add 'test owner → 403 FORBIDDEN' ($r.Status -eq 403 -and (Code $r) -eq 'FORBIDDEN' -and (Msg $r) -eq 'Anda tidak memiliki akses untuk operasi ini.') $r.Body

    $r = Invoke-Api POST '/api/telegram/test' $cs $null ''
    Add 'test staf → 403 FORBIDDEN' ($r.Status -eq 403 -and (Code $r) -eq 'FORBIDDEN') $r.Body

    Clear-Tg
    $r = Invoke-Api POST '/api/telegram/test' $sesSuper $null ''
    Add 'test superadmin tanpa setting → 400 belum diaktifkan' ($r.Status -eq 400 -and (Code $r) -eq 'VALIDATION_ERROR' -and (Msg $r) -eq 'Notifikasi Telegram belum diaktifkan.') $r.Body

    Set-Tg '{"aktif":false,"botToken":null,"chatId":null}'
    $r = Invoke-Api POST '/api/telegram/test' $sesSuper $null ''
    Add 'test aktif=false → 400 belum diaktifkan' ($r.Status -eq 400 -and (Msg $r) -eq 'Notifikasi Telegram belum diaktifkan.') $r.Body

    Set-Tg '{"aktif":true}'
    $r = Invoke-Api POST '/api/telegram/test' $sesSuper $null ''
    Add 'test aktif=true tanpa bot/chat → 400 wajib diisi' ($r.Status -eq 400 -and (Msg $r) -eq 'Bot token dan Chat ID wajib diisi.') $r.Body

    Set-Tg "{`"aktif`":true,`"botToken`":`"$TG_TOKEN`",`"chatId`":`"$TG_CHAT`",`"topicLogin`":4}"
    $state.Status = 200
    $before = Stub-Count
    $r = Invoke-Api POST '/api/telegram/test' $sesSuper $null ''
    $req = Stub-Last
    $sb = Stub-Body $req
    Add 'test lengkap + stub 200 → ok + stub terima path/chat/thread/text' `
        ($r.Status -eq 200 -and $r.Body.Trim() -eq '{"ok":true}' -and (Stub-Count) -eq ($before + 1) -and $req.Path -eq "/bot$TG_TOKEN/sendMessage" -and $sb.chat_id -eq $TG_CHAT -and $sb.message_thread_id -eq 4 -and $sb.text -match '✅ Notifikasi Telegram aktif!' -and $sb.text -match 'Ini pesan uji dari Log Login.') "$($r.Status) $($req.Path) $($sb.message_thread_id) $($sb.chat_id)"

    $state.Status = 500
    $r = Invoke-Api POST '/api/telegram/test' $sesSuper $null ''
    $state.Status = 200
    Add 'test stub 500 → 502 EXTERNAL_SERVICE_ERROR' ($r.Status -eq 502 -and (Code $r) -eq 'EXTERNAL_SERVICE_ERROR' -and (Msg $r) -eq 'Gagal mengirim pesan ke Telegram. Periksa konfigurasi.') $r.Body

    # ================= telegram/webhook =================
    $whBody = '{"table":"transactions","type":"INSERT","record":{"id":1}}'
    $r = Invoke-Api POST '/api/telegram/webhook' '' $whBody ''
    Add 'webhook tanpa header → 401' ($r.Status -eq 401 -and (Code $r) -eq 'UNAUTHORIZED' -and (Msg $r) -eq 'Secret webhook tidak valid.') $r.Body

    $r = Invoke-Api POST '/api/telegram/webhook' '' $whBody ($SECRET + 'x')
    Add 'webhook secret salah panjang beda → 401' ($r.Status -eq 401 -and (Msg $r) -eq 'Secret webhook tidak valid.') $r.Body

    $r = Invoke-Api POST '/api/telegram/webhook' '' $whBody ($SECRET.Substring(0, $SECRET.Length - 1) + 'X')
    Add 'webhook secret salah panjang sama → 401' ($r.Status -eq 401 -and (Msg $r) -eq 'Secret webhook tidak valid.') $r.Body

    $r = Invoke-Api POST '/api/telegram/webhook' '' '{"table":"x","type":"BOGUS"}' $SECRET
    Add 'webhook body invalid → 400 payload tidak valid' ($r.Status -eq 400 -and (Code $r) -eq 'VALIDATION_ERROR' -and (Msg $r) -eq 'Webhook payload tidak valid.') $r.Body

    $r = Invoke-Api POST '/api/telegram/webhook' '' '{"table":"other","type":"INSERT"}' $SECRET
    Add 'webhook table other → 200 skip other/INSERT' ($r.Status -eq 200 -and $r.Body.Trim() -eq '{"ok":true,"skip":"other/INSERT"}') $r.Body

    $before = Stub-Count
    $r = Invoke-Api POST '/api/telegram/webhook' '' '{"table":"transactions","type":"INSERT","record":{"id":1,"no_invoice":"INV-9","total_akhir":10000,"created_at":"2026-01-10T08:00:00Z"}}' $SECRET
    $req = Stub-Last
    $sb = Stub-Body $req
    Add 'webhook transactions INSERT → backup thread 6' `
        ($r.Status -eq 200 -and $r.Body.Trim() -eq '{"ok":true,"data":{"ok":true,"to":"backup"}}' -and (Stub-Count) -eq ($before + 1) -and $sb.message_thread_id -eq 6 -and $sb.chat_id -eq '-1003838354394') "$($r.Status) thread=$($sb.message_thread_id)"

    $before = Stub-Count
    $r = Invoke-Api POST '/api/telegram/webhook' '' '{"table":"transactions","type":"DELETE"}' $SECRET
    Add 'webhook transactions DELETE tanpa record → 200 skip' ($r.Status -eq 200 -and $r.Body.Trim() -eq '{"ok":true,"skip":"DELETE tanpa record"}' -and (Stub-Count) -eq $before) $r.Body

    $before = Stub-Count
    $r = Invoke-Api POST '/api/telegram/webhook' '' '{"table":"profiles","type":"INSERT","record":{"status":"menunggu","role":"owner"}}' $SECRET
    $req = Stub-Last
    $sb = Stub-Body $req
    Add 'webhook profiles menunggu+owner → daftar thread 25' `
        ($r.Status -eq 200 -and $r.Body.Trim() -eq '{"ok":true,"data":{"ok":true,"to":"daftar"}}' -and (Stub-Count) -eq ($before + 1) -and $sb.message_thread_id -eq 25) "$($r.Status) thread=$($sb.message_thread_id)"

    $state.Status = 500
    $r = Invoke-Api POST '/api/telegram/webhook' '' '{"table":"transactions","type":"INSERT","record":{"id":2}}' $SECRET
    $state.Status = 200
    Add 'webhook stub 500 → 502 EXTERNAL_SERVICE_ERROR' ($r.Status -eq 502 -and (Code $r) -eq 'EXTERNAL_SERVICE_ERROR' -and (Msg $r) -eq 'Terjadi kesalahan. Coba lagi.') $r.Body

    # ================= webhooks/payment =================
    $r = Invoke-Api POST '/api/webhooks/payment' '' '{}' ''
    $payOk = ($r.Status -eq 503 -and $r.Body.Trim() -eq '{"error":"payment_webhook_not_configured","message":"Payment webhook is not configured."}' -and $r.Body -notmatch '"ok"' -and $r.Body -notmatch '"code"')
    Add 'payment POST → 503 body persis (tanpa ok/code)' $payOk $r.Body

    $r = Invoke-Api GET '/api/webhooks/payment' '' $null ''
    Add 'payment GET → 405' ($r.Status -eq 405) $r.Status

    # ---- cleanup + verifikasi settings pulih ----
    Clear-Tg
    $tgAfter = Sql "SELECT count(*) FROM settings WHERE user_id='$SA' AND key='telegram_login_notif';"
    Add 'settings telegram superadmin pulih ke awal' ($tgBaseline -eq $tgAfter) "baseline=$tgBaseline after=$tgAfter"
}
catch {
    Write-Error $_
    Add 'persiapan/eksekusi' $false $_.ToString()
}
finally {
    try { if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue } } catch {}
    try {
        $state.Stop = $true
        try { curl.exe -s -o NUL --max-time 2 "$stubURL/" | Out-Null } catch {}
        Start-Sleep -Milliseconds 250
        if ($psStub) { $psStub.Stop() }
        if ($rs) { $rs.Dispose() }
    } catch {}
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') stop | Out-Null

    $hasil | Format-Table -AutoSize | Out-String -Width 260 | Write-Host
    $g = @($hasil | Where-Object Hasil -eq 'GAGAL')
    if ($g.Count -eq 0 -and $hasil.Count -ge 20) { Write-Host "Semua $($hasil.Count) skenario lolos"; exit 0 }
    Write-Host "Gagal: $($g.Count) dari $($hasil.Count) skenario"; exit 1
}
