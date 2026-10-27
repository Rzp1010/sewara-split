# smoke-login.ps1 — uji ujung-ke-ujung POST /api/auth/login.
#
#   .\scripts\smoke-login.ps1
#
# Prasyarat: skema termuat (scripts\staging-db.ps1 reset) dan seed ada
# (scripts\seed-staging.ps1). Skrip ini membuat akun uji sendiri dengan id
# berprefiks c0000000 dan menghapusnya lebih dulu tiap kali dijalankan, jadi
# hasilnya tidak bergantung pada sisa percobaan sebelumnya.
#
# Yang diuji: validasi masukan, akun tidak dikenal, password salah, email belum
# diverifikasi, status menunggu, akun nonaktif, langganan berakhir, login berhasil
# + cookie yang benar-benar bisa dipakai, tangga penalti, dan pembatasan laju.
#
# Catatan shell: proses Postgres/API yang dijalankan dari shell ini ikut mati saat
# shell selesai. Karena itu start, uji, dan stop harus dalam satu invokasi.

$ErrorActionPreference = 'Stop'

$root   = Split-Path -Parent $PSScriptRoot
$psql   = Join-Path $root '.data\pgsql\bin\psql.exe'
$conn   = @('-h', '127.0.0.1', '-p', '5433', '-U', 'sewara', '-d', 'sewara', '-q', '-tA')
$apiExe = Join-Path $root '.data\bin\sewara-api.exe'
$apiURL = 'http://127.0.0.1:8099'
$tmpDir = Join-Path $env:TEMP 'opencode'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

# Password uji & hash bcrypt-nya (cost 10, format $2a$ seperti Supabase).
# Hash sengaja ditulis tetap supaya skrip tidak perlu pustaka bcrypt sendiri.
$password = 'Rahasia123'
$hash     = '$2a$10$GCmHsmqVk3cqwXmf0AVWueY8h0JHD1zo0mr.tl0F/CH0dI/01mYEu'

function Invoke-Sql([string]$sql) {
    $out = & $psql @conn -c $sql 2>&1
    if ($LASTEXITCODE -ne 0) { throw "psql gagal: $($out -join ' ')" }
    return $out
}

function Invoke-Login([string]$json, [string]$ip) {
    $bodyFile = Join-Path $tmpDir 'login-body.json'
    $outFile  = Join-Path $tmpDir 'login-out.bin'
    [System.IO.File]::WriteAllText($bodyFile, $json, (New-Object System.Text.UTF8Encoding($false)))

    $curlArgs = @('-s', '--max-time', '15', '-o', $outFile, '-w', '%{http_code}',
        '-H', 'Content-Type: application/json')
    if ($ip) { $curlArgs += @('-H', "X-Forwarded-For: $ip") }
    $curlArgs += @('--data-binary', "@$bodyFile", "$apiURL/api/auth/login")

    $status = [int](curl.exe @curlArgs)
    $body = Get-Content $outFile -Raw -ErrorAction SilentlyContinue
    return [pscustomobject]@{ Status = $status; Body = $body }
}

function Get-Code([string]$body) {
    if ($body -and $body -match '"code"\s*:\s*"([A-Z_]+)"') { return $Matches[1] }
    return ''
}

Write-Host 'Menyiapkan binari...'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $apiExe) | Out-Null

$goExe = $null
foreach ($k in @("$env:ProgramFiles\Go\bin\go.exe", "$env:LOCALAPPDATA\Programs\Go\bin\go.exe")) {
    if (Test-Path $k) { $goExe = $k; break }
}
if (-not $goExe) { throw 'go tidak ditemukan' }

Push-Location $root
try {
    $env:CGO_ENABLED = '0'
    & $goExe build -o $apiExe ./cmd/api
    if ($LASTEXITCODE -ne 0) { throw 'go build gagal' }
}
finally { Pop-Location }

& (Join-Path $PSScriptRoot 'staging-db.ps1') start

$api = $null
try {
    # --- data uji ---------------------------------------------------------
    # Akun uji dibuat ulang dari nol supaya penghitung gagal login tidak mewarisi
    # sisa percobaan sebelumnya.
    Invoke-Sql @"
DELETE FROM public.login_logs WHERE email LIKE 'login-test-%@staging.local';
DELETE FROM public.profiles WHERE user_id::text LIKE 'c0000000%';
DELETE FROM auth.users WHERE id::text LIKE 'c0000000%';
"@ | Out-Null

    $akun = @(
        @{ id = 'c0000000-0000-0000-0000-000000000001'; email = 'login-test-ok@staging.local';         status = 'aktif';   aktif = 'true';  confirmed = 'true';  sub = 'NULL' },
        @{ id = 'c0000000-0000-0000-0000-000000000002'; email = 'login-test-unverified@staging.local'; status = 'aktif';   aktif = 'true';  confirmed = 'false'; sub = 'NULL' },
        @{ id = 'c0000000-0000-0000-0000-000000000003'; email = 'login-test-wait@staging.local';       status = 'menunggu'; aktif = 'true'; confirmed = 'true';  sub = 'NULL' },
        @{ id = 'c0000000-0000-0000-0000-000000000004'; email = 'login-test-inactive@staging.local';   status = 'aktif';   aktif = 'false'; confirmed = 'true';  sub = 'NULL' },
        @{ id = 'c0000000-0000-0000-0000-000000000005'; email = 'login-test-expired@staging.local';    status = 'aktif';   aktif = 'true';  confirmed = 'true';  sub = "now() - interval '1 day'" },
        @{ id = 'c0000000-0000-0000-0000-000000000006'; email = 'login-test-lock@staging.local';       status = 'aktif';   aktif = 'true';  confirmed = 'true';  sub = 'NULL' },
        @{ id = 'c0000000-0000-0000-0000-000000000007'; email = 'login-test-emailcap@staging.local';   status = 'aktif';   aktif = 'true';  confirmed = 'true';  sub = 'NULL' }
    )

    foreach ($a in $akun) {
        Invoke-Sql @"
INSERT INTO auth.users (id, email) VALUES ('$($a.id)'::uuid, '$($a.email)') ON CONFLICT (id) DO NOTHING;
UPDATE auth.users SET email = '$($a.email)',
    encrypted_password = '$hash',
    email_confirmed_at = $(if ($a.confirmed -eq 'true') { 'now()' } else { 'NULL' })
WHERE id = '$($a.id)'::uuid;
INSERT INTO public.profiles (user_id, email, nama_lengkap, role, owner_id, status, is_active, subscribed_until)
VALUES ('$($a.id)'::uuid, '$($a.email)', 'Akun Uji', 'owner', NULL, '$($a.status)', $($a.aktif), $($a.sub))
ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, status = EXCLUDED.status,
    is_active = EXCLUDED.is_active, subscribed_until = EXCLUDED.subscribed_until,
    failed_login = 0, last_failed_at = NULL, cooldown_until = NULL, locked_until = NULL;
"@ | Out-Null
    }

    $env:DATABASE_URL = 'postgres://sewara@127.0.0.1:5433/sewara?sslmode=disable'
    $env:ADDR = '127.0.0.1:8099'
    $env:APP_ENV = 'development'

    $api = Start-Process -FilePath $apiExe -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $root '.data\api.out.log') `
        -RedirectStandardError (Join-Path $root '.data\api.err.log')

    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 300
        if ((curl.exe -s -o NUL -w '%{http_code}' --max-time 2 "$apiURL/api/health") -eq '200') { $ready = $true; break }
    }
    if (-not $ready) {
        Get-Content (Join-Path $root '.data\api.err.log') -Tail 20 -ErrorAction SilentlyContinue
        throw 'API tidak siap'
    }

    # --- skenario ---------------------------------------------------------
    $hasil = @()
    function Add-Hasil([string]$nama, [int]$dapat, [int]$harap, [string]$info) {
        $script:hasil += [pscustomobject]@{
            Skenario = $nama
            Status   = $dapat
            Harap    = $harap
            Hasil    = $(if ($dapat -eq $harap) { 'LOLOS' } else { 'GAGAL' })
            Info     = $info
        }
    }

    $r = Invoke-Login '{}' '10.9.0.1'
    Add-Hasil 'body kosong -> 400' $r.Status 400 (Get-Code $r.Body)

    $r = Invoke-Login '{"email":"bukan-email","password":"x"}' '10.9.0.1'
    Add-Hasil 'email tanpa @ -> 400' $r.Status 400 (Get-Code $r.Body)

    $r = Invoke-Login '{"email":"login-test-ok@staging.local"}' '10.9.0.1'
    Add-Hasil 'password tidak dikirim -> 400' $r.Status 400 (Get-Code $r.Body)

    $r = Invoke-Login '{"email":"login-test-tidak-ada@staging.local","password":"apa saja"}' '10.9.0.2'
    Add-Hasil 'email tidak dikenal -> 401' $r.Status 401 (Get-Code $r.Body)

    $r = Invoke-Login '{"email":"login-test-ok@staging.local","password":"salah"}' '10.9.0.3'
    Add-Hasil 'password salah -> 401' $r.Status 401 (Get-Code $r.Body)
    $fl = [int](Invoke-Sql "SELECT failed_login FROM public.profiles WHERE user_id='c0000000-0000-0000-0000-000000000001'")
    Add-Hasil 'kegagalan tercatat di profil' $fl 1 "failed_login=$fl"

    $r = Invoke-Login '{"email":"login-test-unverified@staging.local","password":"Rahasia123"}' '10.9.0.4'
    Add-Hasil 'email belum verifikasi -> 403' $r.Status 403 (Get-Code $r.Body)

    $r = Invoke-Login '{"email":"login-test-wait@staging.local","password":"Rahasia123"}' '10.9.0.5'
    Add-Hasil 'status menunggu -> 403' $r.Status 403 (Get-Code $r.Body)

    $r = Invoke-Login '{"email":"login-test-inactive@staging.local","password":"Rahasia123"}' '10.9.0.6'
    Add-Hasil 'akun nonaktif -> 401' $r.Status 401 (Get-Code $r.Body)

    $r = Invoke-Login '{"email":"login-test-expired@staging.local","password":"Rahasia123"}' '10.9.0.7'
    Add-Hasil 'langganan berakhir -> 401' $r.Status 401 (Get-Code $r.Body)

    # Huruf besar di email harus tetap cocok (backend menormalkan ke huruf kecil).
    $jar = Join-Path $tmpDir 'login-cookie.txt'
    Remove-Item $jar -ErrorAction SilentlyContinue
    $bodyFile = Join-Path $tmpDir 'login-body.json'
    [System.IO.File]::WriteAllText($bodyFile, '{"email":"LOGIN-TEST-OK@staging.local","password":"Rahasia123"}', (New-Object System.Text.UTF8Encoding($false)))
    $status = [int](curl.exe -s --max-time 15 -o (Join-Path $tmpDir 'login-out.bin') -w '%{http_code}' `
            -c $jar -H 'Content-Type: application/json' -H 'X-Forwarded-For: 10.9.0.8' `
            --data-binary "@$bodyFile" "$apiURL/api/auth/login")
    $body = Get-Content (Join-Path $tmpDir 'login-out.bin') -Raw -ErrorAction SilentlyContinue
    Add-Hasil 'login benar -> 200' $status 200 (Get-Code $body)

    if (Test-Path $jar) {
        # curl menandai cookie HttpOnly dengan awalan "#HttpOnly_" pada kolom domain.
        $isian = Get-Content $jar -Raw
        $httponly = $isian -match '#HttpOnly_\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+sewara_session'
        Add-Hasil 'cookie HttpOnly terpasang' $(if ($httponly) { 1 } else { 0 }) 1 "jar=$($isian.Length) byte"
    }

    $meStatus = [int](curl.exe -s --max-time 15 -o (Join-Path $tmpDir 'login-me.bin') -w '%{http_code}' -b $jar "$apiURL/api/auth/me")
    $meBody = Get-Content (Join-Path $tmpDir 'login-me.bin') -Raw -ErrorAction SilentlyContinue
    $role = ''
    if ($meBody -and $meBody -match '"role"\s*:\s*"([a-z]+)"') { $role = $Matches[1] }
    Add-Hasil 'cookie hasil login dipakai /me -> 200' $meStatus 200 "role=$role"

    $fl = [int](Invoke-Sql "SELECT failed_login FROM public.profiles WHERE user_id='c0000000-0000-0000-0000-000000000001'")
    Add-Hasil 'penalti direset setelah sukses' $fl 0 "failed_login=$fl"

    # Tangga penalti: gagal ke-3 memicu cooldown 1 menit, percobaan berikutnya ditolak.
    for ($i = 1; $i -le 3; $i++) {
        $r = Invoke-Login '{"email":"login-test-lock@staging.local","password":"salah"}' '10.9.1.1'
    }
    $state = Invoke-Sql "SELECT failed_login || '|' || COALESCE((cooldown_until > now())::text,'false') FROM public.profiles WHERE user_id='c0000000-0000-0000-0000-000000000006'"
    $r = Invoke-Login '{"email":"login-test-lock@staging.local","password":"Rahasia123"}' '10.9.1.1'
    Add-Hasil 'cooldown setelah 3 gagal -> 429' $r.Status 429 "$(Get-Code $r.Body) state=$state"

    # Pembatasan laju per IP: 10 kegagalan dalam 10 menit, percobaan ke-11 ditolak.
    for ($i = 1; $i -le 10; $i++) {
        Invoke-Login "{`"email`":`"login-test-ip$i@staging.local`",`"password`":`"x`"}" '10.9.9.9' | Out-Null
    }
    $r = Invoke-Login '{"email":"login-test-ip11@staging.local","password":"x"}' '10.9.9.9'
    Add-Hasil 'rate limit per IP -> 429' $r.Status 429 (Get-Code $r.Body)

    # Pembatasan laju per email: 5 kegagalan, percobaan ke-6 ditolak.
    # Sengaja memakai email tanpa profil: kalau profilnya ada, tangga penalti akun
    # sudah lebih dulu memicu cooldown dan yang teruji malah bukan batas per email.
    for ($i = 1; $i -le 5; $i++) {
        Invoke-Login '{"email":"login-test-ghost@staging.local","password":"salah"}' "10.8.1.$i" | Out-Null
    }
    $r = Invoke-Login '{"email":"login-test-ghost@staging.local","password":"salah"}' '10.8.1.6'
    Add-Hasil 'rate limit per email -> 429' $r.Status 429 (Get-Code $r.Body)

    $logCount = [int](Invoke-Sql "SELECT count(*) FROM public.login_logs WHERE email LIKE 'login-test-%'")
    Add-Hasil 'percobaan tercatat di login_logs' $(if ($logCount -gt 20) { 1 } else { 0 }) 1 "baris=$logCount"

    Write-Host ''
    $hasil | Format-Table -AutoSize | Out-String | Write-Host

    $jmlGagal = @($hasil | Where-Object { $_.Hasil -ne 'LOLOS' }).Count
    if ($jmlGagal -gt 0) { Write-Host "$jmlGagal skenario GAGAL"; exit 1 }
    Write-Host 'Semua skenario lolos.'
}
finally {
    if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
    & (Join-Path $PSScriptRoot 'staging-db.ps1') stop
}
