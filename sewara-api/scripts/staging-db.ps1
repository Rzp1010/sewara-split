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
$port    = 5433
$dbUser  = 'sewara'
$dbName  = 'sewara'
$dump    = Join-Path $root '..\sewara-backend\supabase\schema_prod_20260930.sql'

if (-not (Test-Path (Join-Path $pgBin 'pg_ctl.exe'))) {
    throw "Binari Postgres tidak ada di $pgBin. Ekstrak postgresql-16.x-windows-x64-binaries.zip ke .data\pgsql"
}

function Invoke-Psql([string]$db, [string[]]$args2) {
    & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $port -U $dbUser -d $db -v ON_ERROR_STOP=1 @args2
    if ($LASTEXITCODE -ne 0) { throw "psql gagal (exit $LASTEXITCODE)" }
}

function Start-Pg {
    & (Join-Path $pgBin 'pg_ctl.exe') -D $dataDir -o "-p $port" -l $logFile -w start
    if ($LASTEXITCODE -ne 0) { throw "pg_ctl start gagal" }
}

function Stop-Pg {
    & (Join-Path $pgBin 'pg_ctl.exe') -D $dataDir -m fast -w stop
}

function Initialize-Db {
    if (Test-Path $dataDir) { throw "$dataDir sudah ada. Pakai 'reset' kalau ingin mulai ulang." }

    & (Join-Path $pgBin 'initdb.exe') -D $dataDir -U $dbUser -E UTF8 --locale=C --auth=trust
    if ($LASTEXITCODE -ne 0) { throw "initdb gagal" }

    Start-Pg
    try {
        & (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p $port -U $dbUser $dbName
        if ($LASTEXITCODE -ne 0) { throw "createdb gagal" }

        # 1. Ledger + shim auth HARUS lebih dulu: dump merujuk auth.users,
        #    auth.uid(), dan role `authenticated`.
        Invoke-Psql $dbName @('-f', (Join-Path $root 'migrations\0000_ledger.sql'))
        Invoke-Psql $dbName @('-f', (Join-Path $root 'migrations\0001_auth_shim.sql'))

        # 2. Skema produksi, tanpa baris CREATE EXTENSION pg_net (ekstensi khusus Supabase).
        $filtered = Join-Path $root '.data\schema_staging.sql'
        Get-Content $dump |
            Where-Object { $_ -notmatch 'CREATE EXTENSION IF NOT EXISTS pg_net' } |
            Set-Content $filtered -Encoding UTF8

        Invoke-Psql $dbName @('-f', $filtered)

        $tables = (& (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $port -U $dbUser -d $dbName -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'").Trim()
        Write-Host "Selesai. Tabel di schema public: $tables"
    }
    finally {
        Stop-Pg
    }
}

switch ($Action) {
    'init'  { Initialize-Db }
    'start' { Start-Pg; Write-Host "Postgres jalan di 127.0.0.1:$port" }
    'stop'  { Stop-Pg }
    'reset' { if (Test-Path $dataDir) { Stop-Pg; Remove-Item $dataDir -Recurse -Force }; Initialize-Db }
    'psql'  { Invoke-Psql $dbName @() }
}
