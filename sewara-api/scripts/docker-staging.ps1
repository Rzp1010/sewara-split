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

        # Tunggu server FINAL, bukan server sementara milik entrypoint. Server
        # sementara hanya mendengarkan socket unix (listen_addresses=''), jadi
        # pg_isready lewat TCP di dalam container baru berhasil setelah
        # inisialisasi selesai. Cek dari host tidak bisa dipakai: proxy Docker
        # Desktop menerima koneksi TCP sebelum Postgres benar-benar siap.
        $siap = $false
        for ($i = 0; $i -lt 240; $i++) {
            docker exec $containerName pg_isready -h 127.0.0.1 -p 5432 -U $dbUser -d $dbName *> $null
            if ($LASTEXITCODE -eq 0) {
                $siap = $true
                break
            }
            Start-Sleep -Milliseconds 500
        }
        if (-not $siap) { throw "Postgres tidak siap di dalam container" }
        
        # Load skema
        Write-Host "Memuat skema..."
        
        # Suppress PowerShell error dari NOTICE/WARNING psql
        $oldErrorAction = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'

        function Invoke-SqlFile([string]$path, [string]$label) {
            $out = Get-Content $path -Raw | docker exec -i $containerName psql -U $dbUser -d $dbName -v ON_ERROR_STOP=1 2>&1
            if ($LASTEXITCODE -ne 0) { throw "$label gagal: $out" }
        }
        
        # Bootstrap files
        Get-ChildItem $bootDir -Filter *.sql | Sort-Object Name | ForEach-Object {
            Invoke-SqlFile $_.FullName "bootstrap $($_.Name)"
        }
        
        # Baseline dump (filter pg_net)
        $filtered = Join-Path $env:TEMP 'schema_staging_docker.sql'
        Get-Content $dump | Where-Object { $_ -notmatch 'CREATE EXTENSION IF NOT EXISTS pg_net' } | 
            Set-Content -Path $filtered -Encoding UTF8
        Invoke-SqlFile $filtered 'dump baseline'
        Remove-Item $filtered -Force
        
        # Migrations (suppress NOTICE/WARNING agar tidak stop execution)
        Get-ChildItem $migDir -Filter *.sql | Sort-Object Name | ForEach-Object {
            Invoke-SqlFile $_.FullName "migration $($_.Name)"
        }
        
        # Seed (optional, load jika ada)
        $seedFile = Join-Path $root 'seeds\staging_seed.sql'
        if (Test-Path $seedFile) {
            Write-Host "Memuat seed..."
            Invoke-SqlFile $seedFile 'seed'
        }
        
        # Restore error action
        $ErrorActionPreference = $oldErrorAction
        
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
        docker exec $containerName psql -U $dbUser -d $dbName -c "SELECT setval('members_id_seq', COALESCE((SELECT max(id) FROM members), 0) + 1, false);" | Out-Null
        
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
    # -v wajib: image postgres mendeklarasikan VOLUME /var/lib/postgresql/data,
    # jadi setiap container meninggalkan satu volume anonim. Tanpa -v volume itu
    # menjadi dangling dan menumpuk (pernah 292 volume / 14,7 GB sampai disk C:
    # penuh dan Docker melempar 'readdirent _data: input/output error').
    docker rm -fv $containerName 2>$null | Out-Null
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
