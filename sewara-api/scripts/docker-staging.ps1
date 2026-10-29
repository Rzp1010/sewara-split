# docker-staging.ps1 — Postgres staging via Docker (alternatif WSL)
#
#   .\scripts\docker-staging.ps1 start
#   .\scripts\docker-staging.ps1 stop
#   .\scripts\docker-staging.ps1 reset
#   .\scripts\docker-staging.ps1 psql
param([Parameter(Mandatory=$true)][ValidateSet('start','stop','reset','psql')][string]$Action)

$ErrorActionPreference = 'Stop'

$containerName = 'sewara-staging-db'
$port = 5433
$dbUser = 'sewara'
$dbName = 'sewara'
$dbPassword = 'sewara123'
$root = Split-Path -Parent $PSScriptRoot
$migDir = Join-Path $root 'migrations'
$bootDir = Join-Path $root 'bootstrap'
$dump = Join-Path $root '..\sewara-backend\supabase\schema_prod_20260930.sql'

function Start-Container {
    $exists = docker ps -a --filter "name=^${containerName}$" --format "{{.Names}}" 2>$null
    if ($exists) {
        $running = docker ps --filter "name=^${containerName}$" --format "{{.Names}}" 2>$null
        if ($running) {
            Write-Host "Container sudah jalan"
            return
        }
        docker start $containerName | Out-Null
        Start-Sleep -Seconds 2
        Write-Host "Container dimulai ulang"
    } else {
        Write-Host "Membuat container baru..."
        docker run -d --name $containerName `
            -e POSTGRES_USER=$dbUser `
            -e POSTGRES_PASSWORD=$dbPassword `
            -e POSTGRES_DB=$dbName `
            -p "${port}:5432" `
            postgres:16-alpine | Out-Null
        
        Start-Sleep -Seconds 5
        
        # Load skema
        Write-Host "Memuat skema..."
        
        # Bootstrap files
        Get-ChildItem $bootDir -Filter *.sql | Sort-Object Name | ForEach-Object {
            Get-Content $_.FullName -Raw | docker exec -i $containerName psql -U $dbUser -d $dbName -v ON_ERROR_STOP=1
        }
        
        # Baseline dump (filter pg_net)
        $filtered = Join-Path $env:TEMP 'schema_staging_docker.sql'
        Get-Content $dump | Where-Object { $_ -notmatch 'CREATE EXTENSION IF NOT EXISTS pg_net' } | 
            Set-Content -Path $filtered -Encoding UTF8
        Get-Content $filtered -Raw | docker exec -i $containerName psql -U $dbUser -d $dbName -v ON_ERROR_STOP=1
        Remove-Item $filtered -Force
        
        # Migrations
        Get-ChildItem $migDir -Filter *.sql | Sort-Object Name | ForEach-Object {
            Get-Content $_.FullName -Raw | docker exec -i $containerName psql -U $dbUser -d $dbName -v ON_ERROR_STOP=1
        }
        
        # Seed (optional, load jika ada)
        $seedFile = Join-Path $root 'seeds\staging_seed.sql'
        if (Test-Path $seedFile) {
            Write-Host "Memuat seed..."
            Get-Content $seedFile -Raw | docker exec -i $containerName psql -U $dbUser -d $dbName | Out-Null
        }
        
        # Record ledger
        $allFiles = @()
        $allFiles += (Get-ChildItem $bootDir -Filter *.sql | Sort-Object Name | ForEach-Object { $_.Name })
        $allFiles += (Get-ChildItem $migDir -Filter *.sql | Sort-Object Name | ForEach-Object { $_.Name })
        
        foreach ($f in $allFiles) {
            docker exec $containerName psql -U $dbUser -d $dbName -c "INSERT INTO public.schema_migrations (filename) VALUES ('$f') ON CONFLICT DO NOTHING" | Out-Null
        }
        
        # Reset sequences setelah seed (agar INSERT berikutnya tidak bentrok)
        Write-Host "Reset sequences..."
        docker exec $containerName psql -U $dbUser -d $dbName -c "SELECT setval('member_types_id_seq', COALESCE((SELECT max(id) FROM member_types), 0) + 1, false);" | Out-Null
        docker exec $containerName psql -U $dbUser -d $dbName -c "SELECT setval('promo_codes_id_seq', COALESCE((SELECT max(id) FROM promo_codes), 0) + 1, false);" | Out-Null
        
        Write-Host ""
        Write-Host "Tabel   : $(docker exec $containerName psql -U $dbUser -d $dbName -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")"
        Write-Host "Policy  : $(docker exec $containerName psql -U $dbUser -d $dbName -Atc "SELECT count(*) FROM pg_policies WHERE schemaname='public'")"
        Write-Host "Ledger  : $(docker exec $containerName psql -U $dbUser -d $dbName -Atc "SELECT count(*) FROM public.schema_migrations")"
        Write-Host ""
        Write-Host "Postgres jalan di localhost:$port"
    }
}

function Stop-Container {
    docker stop $containerName 2>$null | Out-Null
    Write-Host "Container berhenti"
}

function Reset-Container {
    docker rm -f $containerName 2>$null | Out-Null
    Write-Host "Container dihapus, jalankan 'start' untuk membuat ulang"
}

function Invoke-Psql {
    docker exec -it $containerName psql -U $dbUser -d $dbName
}

switch ($Action) {
    'start' { Start-Container }
    'stop'  { Stop-Container }
    'reset' { Reset-Container }
    'psql'  { Invoke-Psql }
}
