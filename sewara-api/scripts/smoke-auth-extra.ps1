# smoke-auth-extra.ps1 — uji domain auth tambahan pada Docker staging saja:
#   POST /api/auth/register
#   POST /api/auth/logout
#   GET  /api/auth/callback
#   POST /api/auth/resend-verification
#
# Tanpa SMTP dan tanpa jaringan luar: MAIL_DRIVER=log menulis tautan verifikasi
# ke stdout API, yang dialihkan ke berkas agar token bisa dibaca dan diuji.
# Assertion memeriksa isi body + efek DB/log, bukan hanya status. Berurutan.

$ErrorActionPreference = 'Stop'

$root   = Split-Path -Parent $PSScriptRoot
$apiExe = Join-Path $root '.data\bin\sewara-api.exe'
$apiURL = 'http://127.0.0.1:8099'
$tmpDir = Join-Path $env:TEMP 'opencode'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$apiOut = Join-Path $tmpDir 'auth-extra-api.out'

$env:PATH = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:PATH"

# Nama variabel UUID tidak boleh satu huruf: PowerShell tak bedakan besar-kecil.
$OWNER_A    = 'a0000000-0000-0000-0000-000000000001'
$TEST_EMAIL = 'smoke-auth-extra@staging.local'
$TEST_PASS  = 'Rahasia123'
$UNKNOWN    = 'belum-terdaftar@staging.local'
$SECRET     = 'smoke-email-token-secret'
$FRONTEND   = 'http://localhost:3000'
# Hash bcrypt untuk 'Rahasia123' (dipakai juga oleh smoke lain).
$HASH_BENAR = '$2a$10$GCmHsmqVk3cqwXmf0AVWueY8h0JHD1zo0mr.tl0F/CH0dI/01mYEu'
$MSG_DAFTAR = '{"error":"Format email tidak valid."}'

function Sql([string]$q) {
    $o = docker exec sewara-staging-db psql -U sewara -d sewara -At -c $q
    if ($LASTEXITCODE -ne 0) { throw "psql gagal: $q" }
    return ($o -join "`n").Trim()
}

function Invoke-Api([string]$method, [string]$path, [string]$cookie, [string]$body) {
    $hdr = Join-Path $tmpDir 'auth-extra-hdr.txt'
    $out = Join-Path $tmpDir 'auth-extra-resp.txt'
    $a = @('-s', '--max-time', '20', '-o', $out, '-D', $hdr, '-w', '%{http_code}', '-X', $method)
    if ($cookie) { $a += @('-H', "Cookie: sewara_session=$cookie") }
    if ($body -ne $null) {
        $bf = Join-Path $tmpDir 'auth-extra-body.json'
        [IO.File]::WriteAllText($bf, $body, [Text.UTF8Encoding]::new($false))
        $a += @('-H', 'Content-Type: application/json', '--data-binary', "@$bf")
    }
    $a += "$apiURL$path"
    $s = [int](curl.exe @a)
    return @{ Status = $s; Body = (Get-Content $out -Raw -ErrorAction SilentlyContinue); Headers = (Get-Content $hdr -Raw -ErrorAction SilentlyContinue) }
}

function Get-SessionCookie([string]$email, [string]$pass) {
    $jar  = Join-Path $tmpDir 'auth-extra-cookie.txt'
    $body = Join-Path $tmpDir 'auth-extra-login.json'
    [IO.File]::WriteAllText($body, "{`"email`":`"$email`",`"password`":`"$pass`"}", [Text.UTF8Encoding]::new($false))
    $s = [int](curl.exe -s -o NUL -w '%{http_code}' -c $jar -H 'Content-Type: application/json' --data-binary "@$body" "$apiURL/api/auth/login")
    if ($s -ne 200) { throw "Login $email gagal HTTP $s" }
    if ((Get-Content $jar -Raw) -match 'sewara_session\s+([^\s]+)') { return $Matches[1] }
    throw 'Cookie hilang'
}

$hasil = @()
function Add([string]$n, [bool]$ok, [string]$info) {
    $script:hasil += [pscustomobject]@{ Skenario = $n; Hasil = $(if ($ok) { 'LOLOS' } else { 'GAGAL' }); Info = $info }
}
function Code($r) { ($r.Body | ConvertFrom-Json).error.code }
function Loc($r) {
    if ($r.Headers -match '(?im)^Location:\s*(\S+)') { return $Matches[1] }
    return ''
}
function LogText { return (Get-Content $apiOut -Raw -ErrorAction SilentlyContinue) }
function LogCount { return ([regex]::Matches((LogText), 'MAIL_DRIVER=log')).Count }
function LastVerifyURL {
    $ms = [regex]::Matches((LogText), 'url=(http\S+/api/auth/callback\?token=[A-Za-z0-9_\-\.]+)')
    if ($ms.Count -eq 0) { return $null }
    return $ms[$ms.Count - 1].Groups[1].Value
}
function TokenOf([string]$url) {
    if ($url -match 'token=([A-Za-z0-9_\-\.]+)') { return $Matches[1] }
    return $null
}
function B64Url([byte[]]$b) { return ([Convert]::ToBase64String($b)).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
function Sign-Token([string]$uid, [long]$exp) {
    $payload = "$uid|$exp"
    $pb = [Text.Encoding]::UTF8.GetBytes($payload)
    $h = New-Object System.Security.Cryptography.HMACSHA256
    $h.Key = [Text.Encoding]::UTF8.GetBytes($SECRET)
    return (B64Url $pb) + '.' + (B64Url $h.ComputeHash($pb))
}

$api = $null
try {
    Push-Location $root
    go build -o $apiExe ./cmd/api
    Pop-Location
    if ($LASTEXITCODE -ne 0) { throw 'go build gagal' }

    & (Join-Path $PSScriptRoot 'docker-staging.ps1') reset | Out-Null
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') start | Out-Null

    # Akun aktif untuk uji logout (profilnya sudah ada dari seed).
    Sql "INSERT INTO auth.users(id,email,encrypted_password,email_confirmed_at) VALUES ('$OWNER_A','owner-a@staging.local','$HASH_BENAR',now()) ON CONFLICT(id) DO UPDATE SET encrypted_password='$HASH_BENAR',email_confirmed_at=now();" | Out-Null

    $env:DATABASE_URL = 'postgres://sewara:sewara123@127.0.0.1:5433/sewara?sslmode=disable'
    $env:ADDR = '127.0.0.1:8099'
    $env:APP_ENV = 'development'
    $env:R2_ENDPOINT = ''; $env:R2_ACCESS_KEY_ID = ''; $env:R2_SECRET_ACCESS_KEY = ''; $env:R2_BUCKET = ''
    $env:MAIL_DRIVER = 'log'
    $env:EMAIL_TOKEN_SECRET = $SECRET
    $env:FRONTEND_URL = $FRONTEND
    $env:PUBLIC_API_URL = ''

    if (Test-Path $apiOut) { Remove-Item $apiOut -Force }
    $ls = @(Get-NetTCPConnection -LocalPort 8099 -State Listen -ErrorAction SilentlyContinue)
    foreach ($l in $ls) { Stop-Process -Id $l.OwningProcess -Force -ErrorAction SilentlyContinue }
    $api = Start-Process $apiExe -PassThru -WindowStyle Hidden -RedirectStandardOutput $apiOut -RedirectStandardError (Join-Path $tmpDir 'auth-extra-api.err')
    $ready = $false
    for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 300; if ((curl.exe -s -o NUL -w '%{http_code}' "$apiURL/api/health") -eq '200') { $ready = $true; break } }
    if (-not $ready) { throw 'API tidak siap' }

    # ================= register =================
    $r = Invoke-Api POST '/api/auth/register' '' '{"email":"bukan-email","password":"x","nama_lengkap":"y"}'
    Add 'register email salah → 400 pesan mentah' ($r.Status -eq 400 -and $r.Body.Trim() -eq $MSG_DAFTAR) "$($r.Status) $($r.Body)"

    $r = Invoke-Api POST '/api/auth/register' '' '{"email":"a@b.co","password":"pendek","nama_lengkap":"y"}'
    Add 'register password < 8 → 400' ($r.Status -eq 400 -and $r.Body.Trim() -eq '{"error":"Password minimal 8 karakter."}') $r.Body

    $r = Invoke-Api POST '/api/auth/register' '' '{"email":"a@b.co","password":"12345678","nama_lengkap":"  "}'
    Add 'register nama kosong → 400' ($r.Status -eq 400 -and $r.Body.Trim() -eq '{"error":"Nama lengkap wajib diisi."}') $r.Body

    $r = Invoke-Api POST '/api/auth/register' '' '{rusak'
    Add 'register JSON rusak → 400 email' ($r.Status -eq 400 -and $r.Body.Trim() -eq $MSG_DAFTAR) $r.Body

    $regBody = '{"email":"SMOKE-AUTH-EXTRA@staging.local","password":"Rahasia123","nama_lengkap":"Pendaftar Smoke","nama_bisnis":"Bisnis Smoke"}'
    $r = Invoke-Api POST '/api/auth/register' '' $regBody
    Add 'register sukses → 200 amplop ok' ($r.Status -eq 200 -and $r.Body.Trim() -eq '{"ok":true,"data":{"ok":true}}') "$($r.Status) $($r.Body)"

    $u = Sql "SELECT (lower(email)=email)::text||'|'||(email_confirmed_at IS NULL)::text||'|'||(encrypted_password IS NOT NULL)::text FROM auth.users WHERE email='$TEST_EMAIL';"
    Add 'auth.users: lowercase + belum konfirmasi + ada hash' ($u -eq 'true|true|true') $u

    $p = Sql "SELECT role||'|'||status||'|'||is_active::text||'|'||(owner_id IS NULL)::text||'|'||username||'|'||nama_invoice FROM profiles WHERE email='$TEST_EMAIL';"
    Add 'profiles: owner/menunggu/nonaktif/owner_id NULL/invoice' ($p -eq "owner|menunggu|false|true|$TEST_EMAIL|Bisnis Smoke") $p

    $al = Sql "SELECT count(*) FROM admin_logs WHERE actor_email='$TEST_EMAIL' AND aksi='daftar' AND target_email='$TEST_EMAIL' AND detail='menunggu persetujuan';"
    Add 'admin_logs aksi=daftar tercatat' ($al -eq '1') $al

    $vurl = LastVerifyURL
    Add 'log berisi URL /api/auth/callback?token=' ($null -ne $vurl) "$vurl"

    # register ulang email sama → tetap 200 & tidak menambah baris apa pun.
    $cUsers = Sql "SELECT count(*) FROM auth.users WHERE email='$TEST_EMAIL';"
    $cProf  = Sql "SELECT count(*) FROM profiles WHERE email='$TEST_EMAIL';"
    $cLog   = Sql "SELECT count(*) FROM admin_logs WHERE target_email='$TEST_EMAIL';"
    $cMail  = LogCount
    $r = Invoke-Api POST '/api/auth/register' '' $regBody
    $c2Users = Sql "SELECT count(*) FROM auth.users WHERE email='$TEST_EMAIL';"
    $c2Prof  = Sql "SELECT count(*) FROM profiles WHERE email='$TEST_EMAIL';"
    $c2Log   = Sql "SELECT count(*) FROM admin_logs WHERE target_email='$TEST_EMAIL';"
    $c2Mail  = LogCount
    Add 'register ulang → 200 & baris tidak bertambah' `
        ($r.Status -eq 200 -and $r.Body.Trim() -eq '{"ok":true,"data":{"ok":true}}' -and $cUsers -eq $c2Users -and $cProf -eq $c2Prof -and $cLog -eq $c2Log -and $cMail -eq $c2Mail) `
        "users=$c2Users prof=$c2Prof log=$c2Log mail=$c2Mail"

    # ================= callback =================
    $uid = Sql "SELECT id::text FROM auth.users WHERE email='$TEST_EMAIL';"
    $validTok = TokenOf $vurl

    $r = Invoke-Api GET "/api/auth/callback?token=$validTok" '' $null
    $cf = Sql "SELECT (email_confirmed_at IS NOT NULL)::text FROM auth.users WHERE email='$TEST_EMAIL';"
    Add 'callback token sah → 307 success + email_confirmed_at terisi' `
        ($r.Status -eq 307 -and (Loc $r) -eq "$FRONTEND/auth/callback/success" -and $cf -eq 'true') "$($r.Status) loc=$(Loc $r) cf=$cf"

    $tampered = $validTok.Substring(0, $validTok.Length - 1) + $(if ($validTok.EndsWith('A')) { 'B' } else { 'A' })
    $r = Invoke-Api GET "/api/auth/callback?token=$tampered" '' $null
    Add 'callback token diubah → redirect error' ($r.Status -eq 307 -and (Loc $r) -eq "$FRONTEND/?error=verification") "$($r.Status) loc=$(Loc $r)"

    $expTok = Sign-Token $uid ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - 100)
    $r = Invoke-Api GET "/api/auth/callback?token=$expTok" '' $null
    Add 'callback token kedaluwarsa → redirect error' ($r.Status -eq 307 -and (Loc $r) -eq "$FRONTEND/?error=verification") "$($r.Status) loc=$(Loc $r)"

    $r = Invoke-Api GET '/api/auth/callback?error=access_denied' '' $null
    Add 'callback ?error=access_denied  tanpa error_code' ($r.Status -eq 307 -and (Loc $r) -eq "$FRONTEND/?error=verification") "$($r.Status) loc=$(Loc $r)"

    $r = Invoke-Api GET '/api/auth/callback?error_code=access_denied' '' $null
    Add 'callback error_code sah  diteruskan' ($r.Status -eq 307 -and (Loc $r) -eq "$FRONTEND/?error=verification&error_code=access_denied") "$($r.Status) loc=$(Loc $r)"

    $longCode = 'a' * 65
    $r = Invoke-Api GET "/api/auth/callback?error_code=$longCode" '' $null
    Add 'callback error_code 65 char  tanpa error_code' ($r.Status -eq 307 -and (Loc $r) -eq "$FRONTEND/?error=verification") "$($r.Status) loc=$(Loc $r)"

    $r = Invoke-Api GET '/api/auth/callback' '' $null
    Add 'callback tanpa query → success' ($r.Status -eq 307 -and (Loc $r) -eq "$FRONTEND/auth/callback/success") "$($r.Status) loc=$(Loc $r)"

    # bcrypt diverifikasi lewat jalur login asli: aktifkan akun sementara, lalu
    # login. Password benar → sesi; password salah → 401.
    Sql "UPDATE profiles SET status='aktif', is_active=true WHERE email='$TEST_EMAIL';" | Out-Null
    $r = Invoke-Api POST '/api/auth/login' '' "{`"email`":`"$TEST_EMAIL`",`"password`":`"$TEST_PASS`"}"
    Add 'password hasil register cocok bcrypt (login 200)' ($r.Status -eq 200 -and $r.Body -match '"ok":true') "$($r.Status) $($r.Body)"

    $r = Invoke-Api POST '/api/auth/login' '' "{`"email`":`"$TEST_EMAIL`",`"password`":`"salah-sekali`"}"
    Add 'password salah → 401 (bukti hash terbaca)' ($r.Status -eq 401 -and (Code $r) -eq 'UNAUTHORIZED') "$($r.Status) $($r.Body)"

    # ================= logout =================
    $r = Invoke-Api POST '/api/auth/logout' '' $null
    Add 'logout tanpa cookie → 401' ($r.Status -eq 401 -and (Code $r) -eq 'UNAUTHORIZED') "$($r.Status) $($r.Body)"

    $cookie = Get-SessionCookie 'owner-a@staging.local' $TEST_PASS
    $sesBefore = Sql "SELECT count(*) FROM auth.sessions WHERE user_id='$OWNER_A';"
    $logBefore = Sql "SELECT count(*) FROM login_logs WHERE email='owner-a@staging.local' AND event='logout';"
    $r = Invoke-Api POST '/api/auth/logout' $cookie $null
    $sesAfter = Sql "SELECT count(*) FROM auth.sessions WHERE user_id='$OWNER_A';"
    $logAfter = Sql "SELECT count(*) FROM login_logs WHERE email='owner-a@staging.local' AND event='logout';"
    $clearOk = ($r.Headers -match '(?im)^Set-Cookie:\s*sewara_session=;') -and ($r.Headers -match 'Max-Age=0')
    Add 'logout dgn cookie → 200 {ok:true} + sesi hilang + cookie kosong + log logout' `
        ($r.Status -eq 200 -and $r.Body.Trim() -eq '{"ok":true}' -and [int]$sesAfter -eq ([int]$sesBefore - 1) -and [int]$logAfter -eq ([int]$logBefore + 1) -and $clearOk) `
        "$($r.Status) ses=$sesBefore→$sesAfter log=$logBefore→$logAfter clear=$clearOk"

    $r = Invoke-Api POST '/api/auth/logout' $cookie $null
    Add 'cookie lama dipakai lagi → 401' ($r.Status -eq 401 -and (Code $r) -eq 'UNAUTHORIZED') "$($r.Status) $($r.Body)"

    # ================= resend-verification =================
    $generic = '{"ok":true,"data":{"message":"Jika email terdaftar, email verifikasi akan dikirim.","ok":true}}'
    $r = Invoke-Api POST '/api/auth/resend-verification' '' '{}'
    Add 'resend {} → 200 generik' ($r.Status -eq 200 -and $r.Body.Trim() -eq $generic) "$($r.Status) $($r.Body)"

    $r = Invoke-Api POST '/api/auth/resend-verification' '' '{"email":"bukan-email"}'
    Add 'resend email invalid → 200 generik' ($r.Status -eq 200 -and $r.Body.Trim() -eq $generic) "$($r.Status) $($r.Body)"

    $r = Invoke-Api POST '/api/auth/resend-verification' '' "{`"email`":`"$UNKNOWN`"}"
    Add 'resend email tak terdaftar → 200 generik (anti-enumerasi)' ($r.Status -eq 200 -and $r.Body.Trim() -eq $generic) "$($r.Status) $($r.Body)"

    $mailBefore = LogCount
    $r = Invoke-Api POST '/api/auth/resend-verification' '' "{`"email`":`"$TEST_EMAIL`"}"
    $mailAfter = LogCount
    $newURL = LastVerifyURL
    Add 'resend email terdaftar → 200 + log tautan baru' ($r.Status -eq 200 -and $r.Body.Trim() -eq $generic -and $mailAfter -eq ($mailBefore + 1) -and (TokenOf $newURL)) "$($r.Status) mail=$mailBefore→$mailAfter url=$newURL"

    $r = Invoke-Api POST '/api/auth/resend-verification' '' "{`"email`":`"$TEST_EMAIL`"}"
    Add 'resend cepat lagi → 429 RATE_LIMIT_EXCEEDED' ($r.Status -eq 429 -and (Code $r) -eq 'RATE_LIMIT_EXCEEDED' -and ($r.Body -match 'Terlalu banyak permintaan. Coba lagi nanti.')) "$($r.Status) $($r.Body)"

    $rv = Sql "SELECT count(*) FROM auth_verification_resends WHERE email IN ('$TEST_EMAIL','$UNKNOWN');"
    Add 'auth_verification_resends bertambah' ([int]$rv -ge 2) "rows=$rv"
}
catch {
    Write-Error $_
    Add 'persiapan/eksekusi' $false $_.ToString()
}
finally {
    try { if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue } } catch {}

    # Bersihkan semua jejak skrip.
    try {
        Sql "DELETE FROM admin_logs WHERE actor_email IN ('$TEST_EMAIL','$UNKNOWN') OR target_email IN ('$TEST_EMAIL','$UNKNOWN');" | Out-Null
        Sql "DELETE FROM login_logs WHERE email IN ('$TEST_EMAIL','owner-a@staging.local');" | Out-Null
        Sql "DELETE FROM auth_verification_resends WHERE email IN ('$TEST_EMAIL','$UNKNOWN');" | Out-Null
        Sql "DELETE FROM profiles WHERE email IN ('$TEST_EMAIL','$UNKNOWN');" | Out-Null
        Sql "DELETE FROM auth.users WHERE email IN ('$TEST_EMAIL','$UNKNOWN');" | Out-Null
        Sql "DELETE FROM auth.sessions WHERE user_id='$OWNER_A';" | Out-Null

        $sisaUser = Sql "SELECT count(*) FROM auth.users WHERE email IN ('$TEST_EMAIL','$UNKNOWN');"
        $sisaProf = Sql "SELECT count(*) FROM profiles WHERE email IN ('$TEST_EMAIL','$UNKNOWN');"
        $sisaLog  = Sql "SELECT count(*) FROM admin_logs WHERE actor_email IN ('$TEST_EMAIL','$UNKNOWN') OR target_email IN ('$TEST_EMAIL','$UNKNOWN');"
        $sisaRv   = Sql "SELECT count(*) FROM auth_verification_resends WHERE email IN ('$TEST_EMAIL','$UNKNOWN');"
        Add 'bersih: jejak skrip hilang' ($sisaUser -eq '0' -and $sisaProf -eq '0' -and $sisaLog -eq '0' -and $sisaRv -eq '0') "user=$sisaUser prof=$sisaProf log=$sisaLog rv=$sisaRv"
    } catch { Add 'bersih: jejak skrip' $false $_.ToString() }

    & (Join-Path $PSScriptRoot 'docker-staging.ps1') stop | Out-Null

    $hasil | Format-Table -AutoSize | Out-String -Width 260 | Write-Host
    $g = @($hasil | Where-Object Hasil -eq 'GAGAL')
    if ($g.Count -eq 0 -and $hasil.Count -ge 22) { Write-Host "Semua $($hasil.Count) skenario lolos"; exit 0 }
    Write-Host "Gagal: $($g.Count) dari $($hasil.Count) skenario"; exit 1
}
