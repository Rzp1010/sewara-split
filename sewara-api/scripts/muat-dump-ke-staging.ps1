# muat-dump-ke-staging.ps1 - muat hasil dump-produksi.ps1 ke DB staging.
#
#   .\scripts\muat-dump-ke-staging.ps1                     # ke Docker staging laptop
#   .\scripts\muat-dump-ke-staging.ps1 -Target homelab     # ke Postgres homelab
#
# DESTRUKTIF terhadap staging saja: seluruh isi tabel diganti data dari dump.
# Tabel ledger `schema_migrations` TIDAK diganti (status migrasi staging tetap milik
# staging). Sumber dump tidak disentuh oleh skrip ini.
#
# Berkas dikirim ke container lalu dibaca `psql -f` / `\copy FROM '<berkas>'`.
# Sengaja tidak lewat pipa teks: PowerShell menambahkan carriage return (CRLF) yang
# membuat COPY menolak data.
param(
    [string]$DumpDir = (Join-Path (Split-Path -Parent $PSScriptRoot) '.dump'),
    [ValidateSet('lokal', 'homelab')][string]$Target = 'lokal',
    [string]$HomelabHost = 'rizki@10.1.1.121',
    [string]$HomelabHostKey = 'SHA256:Q3U7IaIST+Kgy0PyxArSMzgZM6TYwxNJMcyIqQ1HE2s',
    [switch]$SkipBackup,
    [switch]$ForceLanjut
)

$ErrorActionPreference = 'Stop'

# --- target -----------------------------------------------------------------
if ($Target -eq 'lokal') {
    $container = 'sewara-staging-db'
    $ssh = $null
} else {
    $container = 'sewara-db-1'
    $envFile = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'env.homelab'
    if (-not (Test-Path $envFile)) { throw "Berkas kredensial homelab tidak ada: $envFile" }
    $sshPass = ((Get-Content $envFile | Where-Object { $_ -match '^\s*HOMELAB_PASS\s*=' }) -replace '^\s*HOMELAB_PASS\s*=\s*', '').Trim().Trim('"').Trim("'")
    if (-not $sshPass) { throw "HOMELAB_PASS tidak ditemukan di $envFile" }
    $ssh = @('-ssh', $HomelabHost, '-pw', $sshPass, '-hostkey', $HomelabHostKey, '-batch')
}

function Quote-Arg([string]$a) {
    if ($a -match '[\s"]') { return '"' + ($a -replace '"', '\"') + '"' }
    return $a
}

# Jalankan psql di container target. $psqlArgs diteruskan apa adanya ke psql.
function Invoke-PsqlArgs([string[]]$psqlArgs) {
    $dasar = @('psql', '-U', 'sewara', '-d', 'sewara', '-v', 'ON_ERROR_STOP=1', '-At') + $psqlArgs
    if ($ssh) {
        $remote = "docker exec -i $container " + (($dasar | ForEach-Object { Quote-Arg $_ }) -join ' ')
        $out = & plink @ssh $remote 2>&1
    } else {
        $out = docker exec -i $container @dasar 2>&1
    }
    if ($LASTEXITCODE -ne 0) { throw "psql gagal: $($psqlArgs -join ' ')`n$out" }
    return $out
}

# SQL kecil dikirim lewat stdin (bukan data COPY) - CRLF di ujung tidak masalah.
function Invoke-Sql([string]$sql) {
    $dasar = @('psql', '-U', 'sewara', '-d', 'sewara', '-v', 'ON_ERROR_STOP=1', '-At')
    if ($ssh) {
        $out = $sql | & plink @ssh ("docker exec -i $container " + (($dasar | ForEach-Object { Quote-Arg $_ }) -join ' ')) 2>&1
    } else {
        $out = $sql | docker exec -i $container @dasar 2>&1
    }
    if ($LASTEXITCODE -ne 0) { throw "SQL gagal:`n$sql`n$out" }
    return $out
}

function Send-File([string]$lokal, [string]$nama) {
    if ($ssh) {
        & pscp -pw $sshPass -hostkey $HomelabHostKey $lokal "$HomelabHost`:/tmp/$nama" 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "gagal mengunggah $lokal ke homelab (pscp)" }
        $out = & plink @ssh "docker cp /tmp/$nama ${container}:/tmp/$nama" 2>&1
        if ($LASTEXITCODE -ne 0) { throw "gagal menyalin /tmp/$nama ke container`n$out" }
    } else {
        docker cp $lokal "${container}:/tmp/$nama" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "gagal menyalin $lokal ke container" }
    }
}

# --- preflight --------------------------------------------------------------
$dumpSql = Join-Path $DumpDir 'prod_public.sql'
$csvAkun = Join-Path $DumpDir 'auth_users.csv'
$counts  = Join-Path $DumpDir 'counts.txt'
foreach ($f in @($dumpSql, $csvAkun)) {
    if (-not (Test-Path $f)) { throw "Berkas dump tidak ada: $f (jalankan dump-produksi.ps1 dulu)" }
}

$tabelDump = Select-String -Path $dumpSql -Pattern '^COPY public\.([a-z0-9_]+)' -AllMatches |
    ForEach-Object { $_.Matches } | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
$tabelTarget = (Invoke-Sql "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1") |
    Where-Object { $_ -match '^[a-z0-9_]+$' } | Sort-Object -Unique

$hilang = $tabelTarget | Where-Object { $tabelDump -notcontains $_ }
$asing  = $tabelDump   | Where-Object { $tabelTarget -notcontains $_ }

Write-Host "Dump memuat $($tabelDump.Count) tabel; target punya $($tabelTarget.Count) tabel."
if ($asing) {
    Write-Host "Tabel ada di dump tapi TIDAK ADA di staging:" -ForegroundColor Red
    $asing | ForEach-Object { Write-Host "  + $_" }
    if (-not $ForceLanjut) {
        throw "Skema staging tertinggal dari sumber. Samakan dulu (lihat scripts\audit-cermin-skema.ps1), atau pakai -ForceLanjut kalau memang mau melewati tabel itu."
    }
} else {
    Write-Host "Semua tabel dump ada di staging." -ForegroundColor Green
}
if ($hilang) { Write-Host "Tabel staging tanpa data di dump (tetap dikosongkan): $($hilang -join ', ')" }

$kolomAkun = (Invoke-Sql "SELECT column_name FROM information_schema.columns WHERE table_schema='auth' AND table_name='users'") |
    Where-Object { $_ -match '^[a-z_]+$' }
foreach ($k in @('id', 'email', 'encrypted_password', 'email_confirmed_at')) {
    if ($kolomAkun -notcontains $k) { throw "auth.users tidak punya kolom $k - shim auth berbeda dari yang diharapkan" }
}

# --- backup staging ---------------------------------------------------------
if (-not $SkipBackup) {
    Write-Host "Backup staging dulu..."
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $lokal = Join-Path $DumpDir "staging-sebelum-muat-$stamp.sql"
    if ($ssh) {
        Invoke-Sql "SELECT 1" | Out-Null
        $out = & plink @ssh "docker exec $container sh -c 'pg_dump -U sewara -d sewara -f /tmp/preload.sql' && docker cp ${container}:/tmp/preload.sql /tmp/preload.sql" 2>&1
        if ($LASTEXITCODE -ne 0) { throw "pg_dump staging gagal`n$out" }
        & pscp -pw $sshPass -hostkey $HomelabHostKey "$HomelabHost`:/tmp/preload.sql" $lokal 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "gagal menyalin backup dari homelab" }
        $out = & plink @ssh "rm -f /tmp/preload.sql" 2>&1
    } else {
        docker exec $container sh -c "pg_dump -U sewara -d sewara -f /tmp/preload.sql" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "pg_dump staging gagal" }
        docker cp "${container}:/tmp/preload.sql" $lokal | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "gagal menyalin backup ke laptop" }
        docker exec $container rm -f /tmp/preload.sql | Out-Null
    }
    Write-Host "Backup: $lokal"
} else {
    Write-Host "Backup dilewati (-SkipBackup)." -ForegroundColor Yellow
}

# --- kirim berkas ke container ----------------------------------------------
Write-Host "Mengirim berkas dump ke container..."
Send-File $dumpSql 'prod_public.sql'
Send-File $csvAkun 'auth_users.csv'

# --- kosongkan staging (semua tabel public kecuali ledger, plus skema auth) ---
Write-Host "Mengosongkan tabel staging (ledger dipertahankan)..."
Invoke-Sql @"
DO `$`$
DECLARE daftar text;
BEGIN
    SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
      INTO daftar
      FROM pg_tables
     WHERE (schemaname = 'public' AND tablename <> 'schema_migrations')
        OR schemaname = 'auth';
    IF daftar IS NOT NULL THEN
        EXECUTE 'TRUNCATE TABLE ' || daftar;
    END IF;
END
`$`$;
"@ | Out-Null

# --- muat data --------------------------------------------------------------
Write-Host "Memuat data public (satu transaksi)..."
Invoke-PsqlArgs @('-1', '-f', '/tmp/prod_public.sql') | Out-Null

Write-Host "Memuat kredensial akun (auth.users)..."
Invoke-PsqlArgs @('-q', '-c', "\copy auth.users (id, email, encrypted_password, email_confirmed_at) FROM '/tmp/auth_users.csv' WITH CSV HEADER") | Out-Null

# --- setel sequence (serial dan identity) -----------------------------------
Write-Host "Menyetel ulang sequence..."
Invoke-Sql @"
DO `$`$
DECLARE r record; m bigint;
BEGIN
    FOR r IN
        SELECT s.relname AS seq, t.relname AS tbl, a.attname AS col
          FROM pg_class s
          JOIN pg_depend d ON d.objid = s.oid AND d.deptype IN ('a', 'i')
          JOIN pg_class t ON t.oid = d.refobjid
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
         WHERE s.relkind = 'S' AND t.relnamespace = 'public'::regnamespace
    LOOP
        EXECUTE format('SELECT max(%I) FROM %I', r.col, r.tbl) INTO m;
        -- Tabel kosong (m NULL): is_called=false supaya id berikutnya mulai dari 1,
        -- bukan 2. Tabel terisi: last_value = max, jadi nextval = max + 1.
        -- Tanda `$` di-escape supaya PowerShell tidak mengosongkannya.
        EXECUTE format('SELECT setval(%L, GREATEST(COALESCE(`$1, 1), 1), `$2)', 'public.' || r.seq)
            USING m, (m IS NOT NULL);
    END LOOP;
END
`$`$;
"@ | Out-Null

# --- verifikasi -------------------------------------------------------------
Write-Host "ANALYZE + bandingkan jumlah baris..."
Invoke-Sql "ANALYZE;" | Out-Null
$hasil = Invoke-Sql "SELECT relname || ' ' || n_live_tup FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY relname" |
    Where-Object { $_ -match '^[a-z0-9_]+ \d+$' }

$beda = @()
if (Test-Path $counts) {
    $harap = @{}
    Get-Content $counts | Where-Object { $_ -match '^([a-z0-9_]+) (\d+)$' } | ForEach-Object {
        $p = $_ -split ' '
        $harap[$p[0]] = [int]$p[1]
    }
    foreach ($baris in $hasil) {
        $p = $baris -split ' '
        if ($harap.ContainsKey($p[0]) -and $harap[$p[0]] -ne [int]$p[1]) {
            $beda += ("{0}: staging {1} vs sumber {2}" -f $p[0], $p[1], $harap[$p[0]])
        }
    }
}

Invoke-Sql "SELECT 'members=' || (SELECT count(*) FROM members) || ' inventory=' || (SELECT count(*) FROM inventory) || ' transaksi=' || (SELECT count(*) FROM transactions) || ' akun=' || (SELECT count(*) FROM auth.users) || ' ledger=' || (SELECT count(*) FROM schema_migrations)" |
    Where-Object { $_ -match '=' } | ForEach-Object { Write-Host $_ }

if ($beda.Count -gt 0) {
    Write-Host "Selisih jumlah baris (n_live_tup itu perkiraan; yang penting tidak nol):" -ForegroundColor Yellow
    $beda | ForEach-Object { Write-Host "  $_" }
}

# --- bersihkan berkas di container -----------------------------------------
Invoke-PsqlArgs @('-q', '-c', 'SELECT 1') | Out-Null
if ($ssh) {
    $out = & plink @ssh "docker exec $container rm -f /tmp/prod_public.sql /tmp/auth_users.csv; rm -f /tmp/prod_public.sql /tmp/auth_users.csv" 2>&1
} else {
    docker exec $container rm -f /tmp/prod_public.sql /tmp/auth_users.csv | Out-Null
}

Write-Host ""
Write-Host "Selesai. Langkah berikutnya:" -ForegroundColor Green
Write-Host "  1. jalankan ulang container api supaya pool koneksi baru"
Write-Host "  2. login dengan akun dari sumber dump (hash bcrypt ikut termuat)"
Write-Host "  3. hapus berkas di $DumpDir setelah selesai menguji"
