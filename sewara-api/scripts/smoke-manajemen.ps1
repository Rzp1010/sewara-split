# smoke-manajemen.ps1 — uji domain manajemen Go:
#   GET  /api/dashboard/manajemen
#   GET/POST/PATCH/DELETE /api/admin/users
#   GET  /api/admin/logs
#   POST /api/admin/data
#
# Cakupan: agregat global, isolasi list owner vs superadmin, gerbang role per aksi
# (superadmin vs owner vs staf), validasi body, audit admin_logs, cascade hapus,
# dan wipe data tenant. Assertion memeriksa isi body + kondisi DB via psql.
#
# Prasyarat: Docker staging jalan + seed termuat. Jalankan berurutan, jangan paralel.

$ErrorActionPreference = 'Stop'

$root   = Split-Path -Parent $PSScriptRoot
$apiExe = Join-Path $root '.data\bin\sewara-api.exe'
$apiURL = 'http://127.0.0.1:8099'
$tmpDir = Join-Path $env:TEMP 'opencode'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

$dockerBin = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin"
$env:PATH = "$dockerBin;$env:PATH"

$OWNER_A = 'a0000000-0000-0000-0000-000000000001'
$OWNER_B = 'b0000000-0000-0000-0000-000000000001'

function Invoke-Api([string]$method, [string]$path, [string]$cookie, [string]$body) {
    $outFile = Join-Path $tmpDir 'api-out.bin'
    $cargs = @('-s', '--max-time', '15', '-o', $outFile, '-w', '%{http_code}', '-X', $method)
    if ($cookie) { $cargs += @('-H', "Cookie: sewara_session=$cookie") }
    if ($body) {
        $bodyFile = Join-Path $tmpDir 'api-body.json'
        [System.IO.File]::WriteAllText($bodyFile, $body, (New-Object System.Text.UTF8Encoding($false)))
        $cargs += @('-H', 'Content-Type: application/json', '--data-binary', "@$bodyFile")
    }
    $cargs += "$apiURL$path"
    $status = [int](curl.exe @cargs)
    $respBody = Get-Content $outFile -Raw -ErrorAction SilentlyContinue
    return @{ Status = $status; Body = $respBody }
}

function Get-SessionCookie([string]$email, [string]$password = 'Rahasia123') {
    $jar = Join-Path $tmpDir 'session.txt'
    Remove-Item $jar -ErrorAction SilentlyContinue
    $body = "{`"email`":`"$email`",`"password`":`"$password`"}"
    $bodyFile = Join-Path $tmpDir 'login-body.json'
    [System.IO.File]::WriteAllText($bodyFile, $body, (New-Object System.Text.UTF8Encoding($false)))
    $status = [int](curl.exe -s --max-time 15 -o NUL -w '%{http_code}' -c $jar -H 'Content-Type: application/json' --data-binary "@$bodyFile" "$apiURL/api/auth/login")
    if ($status -ne 200) { throw "Login $email gagal (HTTP $status)" }
    $isian = Get-Content $jar -Raw
    if ($isian -match 'sewara_session\s+([^\s]+)') { return $Matches[1] }
    throw "Cookie tidak ditemukan setelah login $email"
}

function Sql([string]$sql) {
    $out = docker exec sewara-staging-db psql -U sewara -d sewara -At -c $sql
    if ($LASTEXITCODE -ne 0) { throw "psql gagal: $sql" }
    return ($out -join "`n").Trim()
}

$hasil = @()
function Add-Hasil([string]$nama, [bool]$lolos, [string]$info) {
    $script:hasil += [pscustomobject]@{
        Skenario = $nama; Hasil = $(if ($lolos) { 'LOLOS' } else { 'GAGAL' }); Info = $info
    }
}
function DataOf($r) { return ($r.Body | ConvertFrom-Json).data }
function MsgOf($r) { return ($r.Body | ConvertFrom-Json).error.message }
function ErrCodeOf($r) { return ($r.Body | ConvertFrom-Json).error.code }

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

    $hash = '$2a$10$GCmHsmqVk3cqwXmf0AVWueY8h0JHD1zo0mr.tl0F/CH0dI/01mYEu'
    Sql "INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at) VALUES
      ('$OWNER_A', 'owner-a@staging.local', '$hash', now()),
      ('a0000000-0000-0000-0000-000000000002', 'cs-a@staging.local', '$hash', now()),
      ('a0000000-0000-0000-0000-000000000003', 'superadmin@staging.local', '$hash', now()),
      ('$OWNER_B', 'owner-b@staging.local', '$hash', now())
    ON CONFLICT (id) DO UPDATE SET encrypted_password='$hash', email_confirmed_at=now();" | Out-Null

    $env:DATABASE_URL = 'postgres://sewara:sewara123@127.0.0.1:5433/sewara?sslmode=disable'
    $env:ADDR = '127.0.0.1:8099'
    $env:APP_ENV = 'development'

    $pemakaiPort = @(Get-NetTCPConnection -LocalPort 8099 -State Listen -ErrorAction SilentlyContinue)
    foreach ($c in $pemakaiPort) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
    if ($pemakaiPort.Count -gt 0) { Start-Sleep -Milliseconds 500 }

    $api = Start-Process -FilePath $apiExe -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $tmpDir 'api-stdout.log') -RedirectStandardError (Join-Path $tmpDir 'api-stderr.log')

    $siap = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 300
        if ((curl.exe -s -o NUL -w '%{http_code}' "$apiURL/api/health") -eq '200') { $siap = $true; break }
    }
    if (-not $siap) { throw 'API tidak siap' }

    $a  = Get-SessionCookie 'owner-a@staging.local'
    $b  = Get-SessionCookie 'owner-b@staging.local'
    $cs = Get-SessionCookie 'cs-a@staging.local'
    $sa = Get-SessionCookie 'superadmin@staging.local'

    # ---------------- 1. Baca: agregat + list + logs ----------------
    $r = Invoke-Api GET '/api/dashboard/manajemen' $a $null
    $m = (DataOf $r).manajemen
    Add-Hasil 'GET manajemen: agregat global (owner 2, staf 2, total 5)' `
        ($r.Status -eq 200 -and $m.totalOwner -eq 2 -and $m.ownerAktif -eq 2 -and $m.ownerNonaktif -eq 0 -and $m.totalStaf -eq 2 -and $m.stafAktif -eq 2 -and $m.totalAkun -eq 5) $r.Body

    $r = Invoke-Api GET '/api/dashboard/manajemen' $cs $null
    Add-Hasil 'GET manajemen: staf juga boleh (tanpa gate role)' ($r.Status -eq 200) $r.Status

    $r = Invoke-Api GET '/api/admin/users' $a $null
    $users = @((DataOf $r).users)
    Add-Hasil 'GET users owner: hanya staf sendiri (cs-a), tanpa owner-b' `
        ($r.Status -eq 200 -and $users.Count -eq 1 -and $users[0].owner_id -eq $OWNER_A -and $users[0].email -eq 'cs-a@staging.local' -and -not ($users.email -contains 'owner-b@staging.local')) $r.Body

    $r = Invoke-Api GET '/api/admin/users' $sa $null
    $users = @((DataOf $r).users)
    $ownA  = @($users | Where-Object { $_.user_id -eq $OWNER_A })[0]
    $ownB  = @($users | Where-Object { $_.user_id -eq $OWNER_B })[0]
    $csRow = @($users | Where-Object { $_.email -eq 'cs-a@staging.local' })[0]
    Add-Hasil 'GET users superadmin: semua baris + jumlah_staff hanya di baris owner' `
        ($r.Status -eq 200 -and $users.Count -eq 5 -and $ownA.jumlah_staff -eq 1 -and $ownB.jumlah_staff -eq 1 -and ($csRow.PSObject.Properties.Name -notcontains 'jumlah_staff')) $r.Body

    $r = Invoke-Api GET '/api/admin/users' $cs $null
    Add-Hasil 'GET users staf: 403' ($r.Status -eq 403 -and (ErrCodeOf $r) -eq 'FORBIDDEN') $r.Body

    $r = Invoke-Api GET '/api/admin/logs' $sa $null
    Add-Hasil 'GET admin/logs superadmin: 200 + array' ($r.Status -eq 200 -and $null -ne (DataOf $r).logs) $r.Body

    $r = Invoke-Api GET '/api/admin/logs' $a $null
    Add-Hasil 'GET admin/logs owner: 403' ($r.Status -eq 403) $r.Body

    # ---------------- 2. POST create user ----------------
    $r = Invoke-Api POST '/api/admin/users' $a '{"email":"staff-new@staging.local","password":"Rahasia123","nama_lengkap":"Staff Baru","username":"staffbaru","nama_invoice":"Staff Baru Inv","role":"cs"}'
    $p = Sql "SELECT role||':'||owner_id::text FROM profiles WHERE email='staff-new@staging.local'"
    $cf = Sql "SELECT (email_confirmed_at IS NOT NULL)::text FROM auth.users WHERE email='staff-new@staging.local'"
    $al = Sql "SELECT count(*)::text FROM admin_logs WHERE aksi='tambah_user' AND target_email='staff-new@staging.local'"
    Add-Hasil 'POST owner buat staf (6 field): 200 + profil + auth.users terkonfirmasi + audit' `
        ($r.Status -eq 200 -and $p -eq "cs:$OWNER_A" -and $cf -eq 'true' -and $al -eq '1') "$($r.Status) $p $cf $al"

    $r = Invoke-Api POST '/api/admin/users' $cs '{"email":"x@staging.local","password":"Rahasia123","nama_lengkap":"X","role":"cs"}'
    Add-Hasil 'POST staf: 403' ($r.Status -eq 403) $r.Body

    $r = Invoke-Api POST '/api/admin/users' $a '{"email":"x@staging.local","password":"Rahasia123","nama_lengkap":"X","role":"owner"}'
    Add-Hasil 'POST owner buat owner: 403' ($r.Status -eq 403 -and (MsgOf $r) -like 'Owner tidak bisa*') $r.Body

    $r = Invoke-Api POST '/api/admin/users' $sa '{"email":"x@staging.local","password":"Rahasia123","nama_lengkap":"X","role":"cs"}'
    Add-Hasil 'POST superadmin buat staf: 403' ($r.Status -eq 403 -and (MsgOf $r) -like 'Superadmin hanya bisa*') $r.Body

    $r = Invoke-Api POST '/api/admin/users' $sa '{"email":"owner-c@staging.local","password":"Rahasia123","nama_lengkap":"Owner C","role":"owner"}'
    $p = Sql "SELECT role||':'||coalesce(owner_id::text,'NULL') FROM profiles WHERE email='owner-c@staging.local'"
    Add-Hasil 'POST superadmin buat owner: 200 + profile owner tanpa owner_id' ($r.Status -eq 200 -and $p -eq 'owner:NULL') "$($r.Status) $p"

    $r = Invoke-Api POST '/api/admin/users' $a '{"email":"staff-new@staging.local","password":"Rahasia123","nama_lengkap":"Dobel","role":"cs"}'
    Add-Hasil 'POST email duplikat: 500' ($r.Status -eq 500) $r.Body

    $r = Invoke-Api POST '/api/admin/users' $a '{"email":"tanpa-pass@staging.local","nama_lengkap":"Tanpa","role":"cs"}'
    Add-Hasil 'POST tanpa password: 400 VALIDATION_ERROR' ($r.Status -eq 400 -and (ErrCodeOf $r) -eq 'VALIDATION_ERROR') $r.Body

    $r = Invoke-Api POST '/api/admin/users' $a '{"email":"asing@staging.local","password":"Rahasia123","nama_lengkap":"A","role":"cs","foo":"bar"}'
    Add-Hasil 'POST field asing: 400' ($r.Status -eq 400) $r.Body

    # ---------------- 3. PATCH set_role / toggle_active / unlock ----------------
    $r = Invoke-Api PATCH '/api/admin/users' $a '{"email":"staff-new@staging.local","action":"set_role","role":"gudang"}'
    Add-Hasil 'PATCH set_role cs->gudang: 200 + DB' ($r.Status -eq 200 -and (Sql "SELECT role FROM profiles WHERE email='staff-new@staging.local'") -eq 'gudang') $r.Body

    $r = Invoke-Api PATCH '/api/admin/users' $a '{"email":"staff-new@staging.local","action":"set_role","role":"owner"}'
    Add-Hasil 'PATCH set_role ->owner oleh owner: 403' ($r.Status -eq 403) $r.Body

    $r = Invoke-Api PATCH '/api/admin/users' $a '{"email":"owner-a@staging.local","action":"set_role","role":"cs"}'
    Add-Hasil 'PATCH set_role akun sendiri: 403' ($r.Status -eq 403) $r.Body

    $r = Invoke-Api PATCH '/api/admin/users' $a '{"email":"staff-new@staging.local","action":"set_role"}'
    Add-Hasil 'PATCH set_role tanpa role: 400' ($r.Status -eq 400) $r.Body

    # Role di luar daftar (owner/cs/gudang) harus ditolak sebelum menyentuh DB —
    # tanpa ini superadmin bisa diberikan lewat API langsung.
    $r = Invoke-Api PATCH '/api/admin/users' $a '{"email":"staff-new@staging.local","action":"set_role","role":"superadmin"}'
    Add-Hasil 'PATCH set_role superadmin: 400 + role DB tetap gudang' `
        ($r.Status -eq 400 -and (Sql "SELECT role FROM profiles WHERE email='staff-new@staging.local'") -eq 'gudang') $r.Body

    $r = Invoke-Api PATCH '/api/admin/users' $a '{"email":"owner-b@staging.local","action":"set_role","role":"cs"}'
    Add-Hasil 'PATCH target bukan bawahan: 404 (cegah enumerasi)' ($r.Status -eq 404) $r.Body

    $r = Invoke-Api PATCH '/api/admin/users' $a '{"email":"staff-new@staging.local","action":"toggle_active"}'
    Add-Hasil 'PATCH toggle_active: 200 is_active=false + DB' `
        ($r.Status -eq 200 -and (DataOf $r).is_active -eq $false -and (Sql "SELECT is_active::text FROM profiles WHERE email='staff-new@staging.local'") -eq 'false') $r.Body

    $r = Invoke-Api PATCH '/api/admin/users' $a '{"email":"staff-new@staging.local","action":"toggle_active"}'
    Add-Hasil 'PATCH toggle_active balik: 200 is_active=true + DB' `
        ($r.Status -eq 200 -and (DataOf $r).is_active -eq $true -and (Sql "SELECT is_active::text FROM profiles WHERE email='staff-new@staging.local'") -eq 'true') $r.Body

    $r = Invoke-Api PATCH '/api/admin/users' $a '{"email":"owner-a@staging.local","action":"toggle_active"}'
    Add-Hasil 'PATCH toggle_active akun sendiri: 403' ($r.Status -eq 403) $r.Body

    $r = Invoke-Api PATCH '/api/admin/users' $a '{"email":"owner-b@staging.local","action":"toggle_active"}'
    Add-Hasil 'PATCH toggle_active owner lain oleh owner: 404' ($r.Status -eq 404) $r.Body

    Sql "UPDATE profiles SET locked_until=now()+interval '1 hour', failed_login=3, cooldown_until=now(), last_failed_at=now() WHERE email='staff-new@staging.local';" | Out-Null
    $r = Invoke-Api PATCH '/api/admin/users' $a '{"email":"staff-new@staging.local","action":"unlock_akun"}'
    $uk = Sql "SELECT (locked_until IS NULL AND failed_login=0 AND cooldown_until IS NULL AND last_failed_at IS NULL)::text FROM profiles WHERE email='staff-new@staging.local'"
    Add-Hasil 'PATCH unlock_akun: 200 + lockout DB bersih' ($r.Status -eq 200 -and $uk -eq 'true') "$($r.Status) $uk"

    $r = Invoke-Api PATCH '/api/admin/users' $a '{"email":"owner-a@staging.local","action":"unlock_akun"}'
    Add-Hasil 'PATCH unlock_akun akun sendiri: 403' ($r.Status -eq 403) $r.Body

    # ---------------- 4. PATCH ubah_password / edit_profil ----------------
    $r = Invoke-Api PATCH '/api/admin/users' $a '{"email":"staff-new@staging.local","action":"ubah_password","new_password":"CustomPass123"}'
    $r2 = Invoke-Api POST '/api/auth/login' $null '{"email":"staff-new@staging.local","password":"CustomPass123"}'
    Add-Hasil 'PATCH ubah_password: 200 + login password baru 200' ($r.Status -eq 200 -and $r2.Status -eq 200) "$($r.Status) $($r2.Status)"

    $r3 = Invoke-Api POST '/api/auth/login' $null '{"email":"staff-new@staging.local","password":"Rahasia123"}'
    Add-Hasil 'Password lama ditolak (401)' ($r3.Status -eq 401) $r3.Status

    $r = Invoke-Api PATCH '/api/admin/users' $a '{"email":"staff-new@staging.local","action":"edit_profil","nama_lengkap":"Nama Baru","username":"baru","nama_invoice":"Inv Baru"}'
    $np = Sql "SELECT nama_lengkap||':'||username||':'||nama_invoice FROM profiles WHERE email='staff-new@staging.local'"
    Add-Hasil 'PATCH edit_profil: 200 + 3 field DB' ($r.Status -eq 200 -and $np -eq 'Nama Baru:baru:Inv Baru') "$($r.Status) $np"

    $r = Invoke-Api PATCH '/api/admin/users' $a '{"email":"staff-new@staging.local","action":"edit_profil"}'
    Add-Hasil 'PATCH edit_profil tanpa field: 200 (tidak ada perubahan)' ($r.Status -eq 200) $r.Body

    # ---------------- 5. PATCH registrasi / langganan (superadmin) ----------------
    $r = Invoke-Api PATCH '/api/admin/users' $sa '{"email":"owner-b@staging.local","action":"setujui_registrasi","durasi":3}'
    $st = Sql "SELECT status||':'||is_active::text||':'||(owner_id=user_id)::text FROM profiles WHERE email='owner-b@staging.local'"
    $dl = Sql "SELECT ((subscribed_until - now()) BETWEEN interval '88 days' AND interval '92 days')::text FROM profiles WHERE email='owner-b@staging.local'"
    Add-Hasil 'PATCH setujui_registrasi 3 bulan: 200 + status/owner_id/subscribed_until' ($r.Status -eq 200 -and $st -eq 'aktif:true:true' -and $dl -eq 'true') "$st $dl"

    $r = Invoke-Api PATCH '/api/admin/users' $sa '{"email":"owner-b@staging.local","action":"setujui_registrasi","durasi":5}'
    Add-Hasil 'PATCH setujui_registrasi durasi 5: 400' ($r.Status -eq 400) $r.Body

    $r = Invoke-Api PATCH '/api/admin/users' $a '{"email":"cs-a@staging.local","action":"setujui_registrasi","durasi":3}'
    Add-Hasil 'PATCH setujui_registrasi oleh owner: 403' ($r.Status -eq 403 -and (MsgOf $r) -like 'Hanya Superadmin*') $r.Body

    $r = Invoke-Api PATCH '/api/admin/users' $sa '{"email":"cs-a@staging.local","action":"setujui_registrasi","durasi":3}'
    Add-Hasil 'PATCH setujui_registrasi target bukan owner: 403' ($r.Status -eq 403 -and (MsgOf $r) -like 'Aksi ini hanya untuk akun Owner*') $r.Body

    $r = Invoke-Api PATCH '/api/admin/users' $sa '{"email":"owner-b@staging.local","action":"perpanjang_langganan","durasi":6}'
    $dl = Sql "SELECT ((subscribed_until - now()) BETWEEN interval '268 days' AND interval '276 days')::text FROM profiles WHERE email='owner-b@staging.local'"
    Add-Hasil 'PATCH perpanjang_langganan +6 bulan dari basis 3 bulan: 200 + DB' ($r.Status -eq 200 -and $dl -eq 'true') "$($r.Status) $dl"

    $r = Invoke-Api PATCH '/api/admin/users' $sa '{"email":"owner-b@staging.local","action":"aksi_ngawur"}'
    Add-Hasil 'PATCH action tak dikenal: 400' ($r.Status -eq 400) $r.Body

    $r = Invoke-Api PATCH '/api/admin/users' $sa '{"email":"hantu@staging.local","action":"unlock_akun"}'
    Add-Hasil 'PATCH email tak ada: 404' ($r.Status -eq 404) $r.Body

    $r = Invoke-Api PATCH '/api/admin/users' $sa '{"email":"superadmin@staging.local","action":"unlock_akun"}'
    Add-Hasil 'PATCH target superadmin: 403' ($r.Status -eq 403) $r.Body

    # ---------------- 6. Wipe data tenant B ----------------
    $r = Invoke-Api POST '/api/admin/data' $b '{}'
    $tot = (DataOf $r).total
    $sisa = Sql "SELECT (SELECT count(*) FROM inventory WHERE user_id='$OWNER_B')||','||(SELECT count(*) FROM transactions WHERE user_id='$OWNER_B')||','||(SELECT count(*) FROM members WHERE user_id='$OWNER_B')||','||(SELECT count(*) FROM member_types WHERE user_id='$OWNER_B')||','||(SELECT count(*) FROM promo_codes WHERE user_id='$OWNER_B')||','||(SELECT count(*) FROM activity_logs WHERE user_id='$OWNER_B')"
    $ctr = Sql "SELECT value FROM settings WHERE user_id='$OWNER_B' AND key='invoice_counter'"
    Add-Hasil 'POST admin/data owner: 200 total seed B (3/0/0) + semua tabel B kosong + counter 0' `
        ($r.Status -eq 200 -and $tot.inventaris -eq 3 -and $tot.transaksi -eq 0 -and $tot.log -eq 0 -and $sisa -eq '0,0,0,0,0,0' -and $ctr -eq '0') "$($r.Body) | $sisa | $ctr"

    $r = Invoke-Api POST '/api/admin/data' $sa '{}'
    Add-Hasil 'POST admin/data superadmin: 400' ($r.Status -eq 400) $r.Body

    $r = Invoke-Api POST '/api/admin/data' $cs '{}'
    Add-Hasil 'POST admin/data staf: 403' ($r.Status -eq 403) $r.Body

    # ---------------- 7. DELETE user (destruktif, terakhir) ----------------
    Sql "INSERT INTO inventory (nama, jenis, user_id) VALUES ('Sisa Staf', 'satuan', (SELECT user_id FROM profiles WHERE email='staff-new@staging.local'));" | Out-Null
    Sql "INSERT INTO members (user_id, nama, hp, alamat, foto_jaminan) VALUES ((SELECT user_id FROM profiles WHERE email='staff-new@staging.local'), 'Member Staf', '089900000001', 'X', '[]');" | Out-Null
    Sql "INSERT INTO settings (user_id, key, value) VALUES ((SELECT user_id FROM profiles WHERE email='staff-new@staging.local'), 'staf_key', '1');" | Out-Null
    Sql "INSERT INTO login_logs (email, event, detail) VALUES ('staff-new@staging.local', 'login_sukses', 'seed staf');" | Out-Null

    $r = Invoke-Api DELETE '/api/admin/users' $a '{"email":"staff-new@staging.local"}'
    $dihapus = (DataOf $r).dihapus
    $cekl = Sql "SELECT (SELECT count(*) FROM profiles WHERE email='staff-new@staging.local')||','||(SELECT count(*) FROM auth.users WHERE email='staff-new@staging.local')||','||(SELECT count(*) FROM inventory WHERE nama='Sisa Staf')||','||(SELECT count(*) FROM members WHERE nama='Member Staf')||','||(SELECT count(*) FROM settings WHERE key='staf_key')||','||(SELECT count(*) FROM login_logs WHERE email='staff-new@staging.local')"
    Add-Hasil 'DELETE staf: 200 dihapus>=1 + profil/auth/inventory/member/settings/login_logs ikut terhapus' `
        ($r.Status -eq 200 -and $dihapus -ge 1 -and $cekl -eq '0,0,0,0,0,0') "$($r.Status) dihapus=$dihapus | $cekl"

    $r = Invoke-Api DELETE '/api/admin/users' $a '{"email":"owner-b@staging.local"}'
    Add-Hasil 'DELETE owner lain oleh owner: 404' ($r.Status -eq 404) $r.Body

    Sql "UPDATE profiles SET owner_id=user_id WHERE email='owner-a@staging.local';" | Out-Null
    $r = Invoke-Api DELETE '/api/admin/users' $a '{"email":"owner-a@staging.local"}'
    Add-Hasil 'DELETE akun sendiri: 403' ($r.Status -eq 403) $r.Body

    $r = Invoke-Api DELETE '/api/admin/users' $sa '{"email":"superadmin@staging.local"}'
    Add-Hasil 'DELETE target superadmin: 403' ($r.Status -eq 403) $r.Body

    $r = Invoke-Api DELETE '/api/admin/users' $a '{"email":"hantu@staging.local"}'
    Add-Hasil 'DELETE email tak ada: 404' ($r.Status -eq 404) $r.Body

    $r = Invoke-Api DELETE '/api/admin/users' $cs '{"email":"cs-a@staging.local"}'
    Add-Hasil 'DELETE oleh staf: 403' ($r.Status -eq 403) $r.Body

    $r = Invoke-Api DELETE '/api/admin/users' $a '{}'
    Add-Hasil 'DELETE body tanpa email: 400' ($r.Status -eq 400) $r.Body

    # ---------------- 8. PATCH tolak_registrasi (paling akhir, memblokir owner-b) ----------------
    $r = Invoke-Api PATCH '/api/admin/users' $sa '{"email":"owner-b@staging.local","action":"tolak_registrasi"}'
    $st = Sql "SELECT status||':'||is_active::text FROM profiles WHERE email='owner-b@staging.local'"
    Add-Hasil 'PATCH tolak_registrasi: 200 + status diblokir/nonaktif' ($r.Status -eq 200 -and $st -eq 'diblokir:false') "$($r.Status) $st"

    $hasil | Format-Table -AutoSize | Out-String | Write-Host
    $gagal = @($hasil | Where-Object { $_.Hasil -eq 'GAGAL' })
    if ($gagal.Count -gt 0) {
        Write-Host "$($gagal.Count) skenario GAGAL"
        exit 1
    }
    Write-Host "Semua $($hasil.Count) skenario lolos"
}
finally {
    if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') stop
}
