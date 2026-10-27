# verify-schema.ps1 — cek bahwa skema staging benar-benar siap dipakai Go.
#
#   .\scripts\verify-schema.ps1
#
# Menyalakan Postgres, menjalankan sekumpulan pemeriksaan, lalu mematikannya lagi.
# Semua dalam satu proses supaya server tidak ikut mati saat shell selesai.

$ErrorActionPreference = 'Stop'

$root   = Split-Path -Parent $PSScriptRoot
$pgBin  = Join-Path $root '.data\pgsql\bin'
$psql   = Join-Path $pgBin 'psql.exe'
$conn   = @('-h', '127.0.0.1', '-p', '5433', '-U', 'sewara', '-d', 'sewara')

function Ask([string]$label, [string]$sql) {
    $out = (& $psql @conn -tAc $sql 2>&1) -join ' '
    Write-Host ("{0,-42} {1}" -f $label, $out.Trim())
}

# Jalankan psql yang memang diharapkan gagal (uji negatif).
function Expect-Fail([string]$label, [string]$sql) {
    # ErrorActionPreference Stop akan mengubah stderr psql menjadi terminating error;
    # untuk uji negatif justru itu yang diharapkan, jadi diturunkan sementara.
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $psql @conn -c $sql 2>&1 | ForEach-Object { $null = $_ }
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    if ($code -ne 0) { Write-Host ("{0,-42} {1}" -f $label, 'DITOLAK (benar)') }
    else { Write-Host ("{0,-42} {1}" -f $label, 'LOLOS (masalah!)') }
}

# Jalankan skrip multi-statement dan ambil angka terakhir (hasil COUNT).
function Ask-Count([string]$label, [string]$sql) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $lines = & $psql @conn -q -tA -c $sql 2>&1
    $ErrorActionPreference = $prev
    $val = ($lines | Where-Object { $_ -match '^\s*\d+\s*$' } | Select-Object -Last 1)
    Write-Host ("{0,-42} {1}" -f $label, ($val -replace '\s', ''))
}

& (Join-Path $PSScriptRoot 'staging-db.ps1') start
try {
    Write-Host ''
    Write-Host '--- objek dasar ---'
    Ask 'role anon/authenticated/service_role' "SELECT string_agg(rolname, ', ' ORDER BY rolname) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')"
    Ask 'tabel public' "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
    Ask 'policy RLS' "SELECT count(*) FROM pg_policies WHERE schemaname='public'"
    Ask 'tabel dengan RLS aktif' "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity"
    Ask 'fungsi auth.uid/auth.jwt' "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='auth'"
    Ask 'ledger' "SELECT string_agg(filename, ', ' ORDER BY filename) FROM public.schema_migrations"
    Ask 'baris auth.users (harus 0)' "SELECT count(*) FROM auth.users"

    Write-Host ''
    Write-Host '--- konteks request lewat GUC ---'
    Ask 'auth.uid() tanpa konteks' "SELECT coalesce(auth.uid()::text, 'NULL')"
    # Satu koneksi, satu transaksi: persis pola yang akan dipakai Go (SET LOCAL).
    Ask 'auth.uid() di dalam transaksi' "BEGIN; SELECT set_config('app.user_id','11111111-1111-1111-1111-111111111111', true); SELECT coalesce(auth.uid()::text, 'NULL'); ROLLBACK;"
    Ask 'auth.jwt() default' "SELECT auth.jwt()::text"

    Write-Host ''
    Write-Host '--- uji RLS: role authenticated punya izin tabel, tapi tanpa konteks harus 0 baris ---'
    $grants = (& $psql @conn -tAc "SELECT count(*) FROM information_schema.role_table_grants WHERE grantee='authenticated' AND table_schema='public'").Trim()
    Write-Host ("{0,-42} {1} baris grant" -f 'grant ke authenticated', $grants)
    Ask 'tanpa konteks -> transactions' "SET ROLE authenticated; SELECT count(*) FROM transactions;"
    Ask 'tanpa konteks -> profiles' "SET ROLE authenticated; SELECT count(*) FROM profiles;"
    Ask 'konteks user acak -> transactions' "BEGIN; SELECT set_config('app.user_id','11111111-1111-1111-1111-111111111111', true); SELECT count(*) FROM transactions; ROLLBACK;"
    Ask 'superuser (tanpa RLS) -> transactions' "SELECT count(*) FROM transactions;"

    Write-Host ''
    Write-Host '--- uji negatif: role anon tidak boleh menyentuh tabel ---'
    Expect-Fail 'anon baca transactions' "SET ROLE anon; SELECT count(*) FROM transactions;"

    Write-Host ''
    Write-Host '--- bukti RLS dengan data: 2 tenant, tabel profiles ---'
    $ua = 'aaaaaaaa-0000-0000-0000-000000000001'
    $ub = 'bbbbbbbb-0000-0000-0000-000000000002'
    $uc = 'cccccccc-0000-0000-0000-000000000003'
    $seed = "INSERT INTO public.profiles (user_id, email, role) VALUES ('$ua','a@staging.local','cs'),('$ub','b@staging.local','cs');"
    Ask-Count 'superuser lihat semua (tanpa RLS)' "BEGIN; $seed SELECT count(*) FROM public.profiles; ROLLBACK;"
    Ask-Count 'user A lihat miliknya sendiri' "BEGIN; $seed SET LOCAL ROLE authenticated; SELECT set_config('app.user_id','$ua',true); SELECT count(*) FROM public.profiles; ROLLBACK;"
    Ask-Count 'user C asing lihat 0 baris' "BEGIN; $seed SET LOCAL ROLE authenticated; SELECT set_config('app.user_id','$uc',true); SELECT count(*) FROM public.profiles; ROLLBACK;"
    Ask-Count 'tanpa konteks lihat 0 baris' "BEGIN; $seed SET LOCAL ROLE authenticated; SELECT count(*) FROM public.profiles; ROLLBACK;"
}
finally {
    & (Join-Path $PSScriptRoot 'staging-db.ps1') stop
}
