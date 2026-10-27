$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dbScript = Join-Path $PSScriptRoot 'staging-db.ps1'
$seedFile = Join-Path $root 'seeds\staging_seed.sql'
$psql = Join-Path $root '.data\pgsql\bin\psql.exe'
$started = $false
try {
    & $dbScript start
    if ($LASTEXITCODE -ne 0) { throw "staging-db.ps1 start gagal (exit $LASTEXITCODE)" }
    $started = $true
    & $psql -h 127.0.0.1 -p 5433 -U sewara -d sewara -v ON_ERROR_STOP=1 -f $seedFile
    if ($LASTEXITCODE -ne 0) { throw "Penerapan seed gagal (exit $LASTEXITCODE)" }
    $tables = @('profiles','member_types','members','inventory','inventory_units','transactions','transaction_items','transaction_payments','promo_codes','settings')
    foreach ($table in $tables) {
        $count = & $psql -h 127.0.0.1 -p 5433 -U sewara -d sewara -tAc "SELECT count(*) FROM public.$table"
        if ($LASTEXITCODE -ne 0) { throw "Hitung $table gagal (exit $LASTEXITCODE)" }
        Write-Host ("{0}: {1}" -f $table, $count.Trim())
    }
}
finally {
    if ($started) {
        & $dbScript stop
        if ($LASTEXITCODE -ne 0) { throw "staging-db.ps1 stop gagal (exit $LASTEXITCODE)" }
    }
}
