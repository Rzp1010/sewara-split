# staging-db.ps1 — Postgres portable untuk staging lokal (tanpa Docker, tanpa admin).
#
#   .\scripts\staging-db.ps1 init     # initdb + muat skema (sekali)
#   .\scripts\staging-db.ps1 start    # nyalakan di port 5433
#   .\scripts\staging-db.ps1 stop
#   .\scripts\staging-db.ps1 reset    # hapus data + init ulang
#   .\scripts\staging-db.ps1 psql     # shell interaktif
param([Parameter(Mandatory = $true)][ValidateSet('init', 'start', 'stop', 'reset', 'psql')][string]$Action)

$ErrorActionPreference = 'Stop'

$root    = Split-Path -Parent $PSScriptRoot
$pgBin   = Join-Path $root '.data\pgsql\bin'
$dataDir = Join-Path $root '.data\pg'
$logFile = Join-Path $root '.data\pg.log'
$migDir  = Join-Path $root 'migrations'
$bootDir = Join-Path $root 'bootstrap'
$port    = 5433
$dbUser  = 'sewara'
$dbName  = 'sewara'
$dump    = Join-Path $root '..\sewara-backend\supabase\schema_prod_20260930.sql'

if (-not (Test-Path (Join-Path $pgBin 'pg_ctl.exe'))) {
    throw "Binari Postgres tidak ada di $pgBin. Ekstrak postgresql-16.x-windows-x64-binaries.zip ke .data\pgsql"
}

function Invoke-Psql([string]$db, [string[]]$psqlArgs) {
    & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $port -U $dbUser -d $db -v ON_ERROR_STOP=1 -q @psqlArgs
    if ($LASTEXITCODE -ne 0) { throw "psql gagal (exit $LASTEXITCODE)" }
}

function Read-Scalar([string]$sql) {
    (& (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $port -U $dbUser -d $dbName -tAc $sql).Trim()
}

function Start-Pg {
    # Catatan: proses yang dijalankan dari shell otomatis ikut mati saat shell itu
    # selesai. Karena itu start/stop dibungkus dalam satu invokasi skrip (lihat init),
    # bukan meninggalkan server hidup antar perintah.
    & (Join-Path $pgBin 'pg_ctl.exe') -D $dataDir -l $logFile -w start
    if ($LASTEXITCODE -ne 0) { throw "pg_ctl start gagal (exit $LASTEXITCODE), lihat $logFile" }
}

function Stop-Pg {
    if (-not (Test-Path (Join-Path $dataDir 'postmaster.pid'))) { return }
    & (Join-Path $pgBin 'pg_ctl.exe') -D $dataDir -m fast -w stop
    # pg_ctl kadang meninggalkan lock di Windows.
    if (Test-Path (Join-Path $dataDir 'postmaster.pid')) {
        Remove-Item (Join-Path $dataDir 'postmaster.pid') -Force -ErrorAction SilentlyContinue
    }
}

function Initialize-Db {
    if (Test-Path $dataDir) { throw "$dataDir sudah ada. Pakai 'reset' kalau ingin mulai ulang." }

    & (Join-Path $pgBin 'initdb.exe') -D $dataDir -U $dbUser -E UTF8 --locale=C --auth=trust
    if ($LASTEXITCODE -ne 0) { throw "initdb gagal" }

    # Port dan interface ditulis di config, bukan lewat argumen -o (kutip argumen
    # bersarang di path ber-spasi rawan salah).
    Add-Content -Path (Join-Path $dataDir 'postgresql.conf') -Value @(
        ''
        '# --- staging lokal Sewara ---'
        "port = $port"
        "listen_addresses = '127.0.0.1'"
    ) -Encoding ascii

    Start-Pg
    try {
        & (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p $port -U $dbUser $dbName
        if ($LASTEXITCODE -ne 0) { throw "createdb gagal" }

        # Urutan memuat penting dan tidak boleh ditukar:
        # 1. bootstrap/ — objek yang harus ADA sebelum baseline, karena dump
        #    merujuknya (schema auth, auth.users, auth.uid(), role authenticated).
        # 2. baseline  — dump skema produksi. Dump inilah yang membuat tabel
        #    schema_migrations, jadi ledger tidak dibuat lebih dulu.
        # 3. migrations/ — perubahan di atas baseline (grant, hapus trigger pg_net, dst).
        # 4. Catat semua file yang diterapkan ke ledger.
        $bootFiles = @()
        foreach ($mf in (Get-ChildItem $bootDir -Filter *.sql | Sort-Object Name)) {
            Invoke-Psql $dbName @('-f', $mf.FullName)
            $bootFiles += $mf.Name
        }

        # Buang baris pg_net: ekstensi khusus Supabase, tidak ada di Postgres biasa.
        $filtered = Join-Path $root '.data\schema_staging.sql'
        $lines = Get-Content $dump | Where-Object { $_ -notmatch 'CREATE EXTENSION IF NOT EXISTS pg_net' }
        # UTF8 tanpa BOM: psql menganggap BOM sebagai karakter ilegal di awal file.
        [System.IO.File]::WriteAllLines($filtered, $lines, (New-Object System.Text.UTF8Encoding($false)))
        Invoke-Psql $dbName @('-f', $filtered)

        $migFiles = @()
        foreach ($mf in (Get-ChildItem $migDir -Filter *.sql | Sort-Object Name)) {
            Invoke-Psql $dbName @('-f', $mf.FullName)
            $migFiles += $mf.Name
        }

        foreach ($name in ($bootFiles + $migFiles)) {
            Invoke-Psql $dbName @('-c', "INSERT INTO public.schema_migrations (filename) VALUES ('$name') ON CONFLICT DO NOTHING")
        }

        $tables   = Read-Scalar "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
        $policies = Read-Scalar "SELECT count(*) FROM pg_policies WHERE schemaname='public'"
        $ledger   = Read-Scalar "SELECT count(*) FROM public.schema_migrations"

        Write-Host ""
        Write-Host "Tabel public : $tables (produksi: 28)"
        Write-Host "Policy RLS   : $policies (produksi: 26)"
        Write-Host "Ledger       : $ledger entri"
        Read-Scalar "SELECT string_agg(filename, ', ' ORDER BY filename) FROM public.schema_migrations" | ForEach-Object { Write-Host "  -> $_" }
    }
    finally {
        Stop-Pg
    }
}

switch ($Action) {
    'init'  { Initialize-Db }
    'start' { Start-Pg; Write-Host "Postgres jalan di 127.0.0.1:$port" }
    'stop'  { Stop-Pg; Write-Host "Postgres berhenti" }
    'reset' { Stop-Pg; if (Test-Path $dataDir) { Remove-Item $dataDir -Recurse -Force }; Initialize-Db }
    'psql'  { Invoke-Psql $dbName @() }
}
