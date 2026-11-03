# dump-produksi.ps1 - tarik DATA (bukan skema) dari Supabase produksi ke berkas lokal.
#
#   $env:SEWARA_PROD_DB_URL = 'postgresql://postgres:<pw>@<host>:5432/postgres'
#   .\scripts\dump-produksi.ps1
#
# Sifat: READ-ONLY terhadap sumber. Tidak ada DDL, tidak ada tulis.
# Hasil di <repo>\.dump\ :
#   prod_public.sql  - COPY semua tabel public, kecuali tabel ledger
#   auth_users.csv   - 4 kolom yang dipakai shim auth Go (akhiran baris LF)
#   counts.txt       - jumlah baris per tabel (pembanding saat memuat)
#
# Bisa juga dipakai untuk latihan ke DB lokal (lihat -DbUrl dan -SslMode):
#   .\scripts\dump-produksi.ps1 -DbUrl 'postgres://sewara:sewara123@host.docker.internal:5433/sewara' -SslMode disable
#
# PENTING: hasil dump berisi data pelanggan asli + hash kredensial. Jangan commit,
# jangan dikirim ke mana-mana. Folder .dump dibuat git-ignored otomatis.
param(
    [string]$OutDir = (Join-Path (Split-Path -Parent $PSScriptRoot) '.dump'),
    [string]$DbUrl  = $env:SEWARA_PROD_DB_URL,
    [string]$Image  = 'postgres:16',
    [ValidateSet('require', 'disable', 'prefer')][string]$SslMode = 'require'
)

$ErrorActionPreference = 'Stop'

if (-not $DbUrl) {
    throw "SEWARA_PROD_DB_URL belum diisi. Contoh: `$env:SEWARA_PROD_DB_URL = 'postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres'"
}
if ($DbUrl -notmatch '^postgres(ql)?://(?<user>[^:/@]+):(?<pass>[^@]+)@(?<host>[^:/@]+):(?<port>\d+)/(?<db>[^?]+)') {
    throw "SEWARA_PROD_DB_URL tidak bisa diurai. Perlu format postgresql://user:pass@host:port/database"
}
$u = $Matches['user']; $p = $Matches['pass']; $h = $Matches['host']; $pt = $Matches['port']; $db = $Matches['db']

# Password dikirim lewat berkas env, bukan argv: daftar proses dan `docker inspect`
# tidak boleh memuatnya (pola sama dengan /etc/sewara/api.env di repo ini).
$tmpEnv = Join-Path $env:TEMP ("prod-dump-{0}.env" -f ([guid]::NewGuid().ToString('N')))
@(
    "PGHOST=$h"
    "PGPORT=$pt"
    "PGUSER=$u"
    "PGPASSWORD=$p"
    "PGDATABASE=$db"
    "PGSSLMODE=$SslMode"
) | Set-Content -Path $tmpEnv -Encoding ASCII

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Set-Content -Path (Join-Path $OutDir '.gitignore') -Value '*' -Encoding ASCII

$mount = (($OutDir -replace '\\', '/') + ':/out')

try {
    Write-Host "1/3  Dump tabel public (tanpa schema_migrations)..."
    docker run --rm --env-file $tmpEnv -v $mount $Image `
        pg_dump --schema=public --data-only --no-owner --no-privileges `
        --exclude-table=public.schema_migrations --file=/out/prod_public.sql
    if ($LASTEXITCODE -ne 0) { throw "pg_dump (public) gagal" }

    Write-Host "2/3  Jumlah baris per tabel (pembanding)..."
    $counts = docker run --rm --env-file $tmpEnv $Image `
        psql -At -c "SELECT relname || ' ' || n_live_tup FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY relname"
    if ($LASTEXITCODE -ne 0) { throw "query jumlah baris gagal" }
    Set-Content -Path (Join-Path $OutDir 'counts.txt') -Value $counts -Encoding ASCII

    Write-Host "3/3  Kredensial akun (auth.users, 4 kolom shim)..."
    $csv = docker run --rm --env-file $tmpEnv $Image `
        psql -Atc "\copy (SELECT id, email, encrypted_password, email_confirmed_at FROM auth.users) TO STDOUT WITH CSV HEADER"
    if ($LASTEXITCODE -ne 0) { throw "ekstraksi auth.users gagal" }
    # Akhiran baris WAJIB LF: COPY ... CSV menolak carriage return di dalam data.
    $csvTeks = (($csv | Where-Object { $_ -ne $null }) -join "`n") + "`n"
    [System.IO.File]::WriteAllText((Join-Path $OutDir 'auth_users.csv'), $csvTeks, (New-Object System.Text.UTF8Encoding($false)))
}
finally {
    Remove-Item -Path $tmpEnv -Force -ErrorAction SilentlyContinue
    if (Test-Path $tmpEnv) { Write-Warning "Berkas env sementara TIDAK terhapus: $tmpEnv - hapus manual." }
}

Write-Host ""
Write-Host "Selesai. Berkas di $OutDir :" -ForegroundColor Green
Get-ChildItem $OutDir -File | Where-Object { $_.Name -ne '.gitignore' } |
    ForEach-Object { Write-Host ("  {0,10}  {1}" -f $_.Length, $_.Name) }
Write-Host ""
Write-Host "Berkas ini berisi data pelanggan asli + hash kredensial:" -ForegroundColor Yellow
Write-Host "  - jangan commit, jangan kirim ke mana-mana"
Write-Host "  - hapus setelah dimuat ke staging (muat-dump-ke-staging.ps1)"
