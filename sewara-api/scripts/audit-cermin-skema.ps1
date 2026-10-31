# Audit cermin skema: setiap migrasi Supabase yang lebih baru dari baseline Go
# WAJIB punya padanan di sewara-api/migrations/ (lihat docs/cutover-plan.md §4).
#
# Cara pakai (dari akar repo sewara-split):
#   pwsh sewara-api/scripts/audit-cermin-skema.ps1
# Keluar dengan kode 1 kalau ada migrasi tanpa padanan (bisa dipakai di CI/pre-commit).
param(
    [string]$Baseline = "20260930"   # dari schema_prod_20260930.sql
)

$ErrorActionPreference = "Stop"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent   # akar repo
$sbDir = Join-Path $root "sewara-backend/supabase/migrations"
$goDir = Join-Path $root "sewara-api/migrations"
$goBoot = Join-Path $root "sewara-api/bootstrap"

$goFiles = @()
$goFiles += Get-ChildItem $goDir -Filter *.sql -ErrorAction SilentlyContinue
$goFiles += Get-ChildItem $goBoot -Filter *.sql -ErrorAction SilentlyContinue
$goText = ($goFiles | ForEach-Object { Get-Content $_.FullName -Raw }) -join "`n"

$sbFiles = Get-ChildItem $sbDir -Filter *.sql | Sort-Object Name
$baru = $sbFiles | Where-Object { $_.Name -match '^(\d{8})' -and $Matches[1] -gt $Baseline }

Write-Host "Baseline Go : schema_prod_$Baseline.sql"
Write-Host "Supabase    : $($sbFiles.Count) berkas migrasi; $($baru.Count) sesudah baseline"
Write-Host ""

$kurang = @()
foreach ($f in $baru) {
    if ($goText -match [regex]::Escape($f.Name)) {
        $padanan = ($goFiles | Where-Object { (Get-Content $_.FullName -Raw) -match [regex]::Escape($f.Name) } |
                    Select-Object -First 1).Name
        Write-Host "  OK      $($f.Name)  ->  sewara-api/migrations/$padanan"
    } else {
        $kurang += $f.Name
        Write-Host "  HILANG  $($f.Name)  ->  belum ada padanan di Go"
    }
}

$tanpaRujukan = $goFiles | Where-Object {
    $t = Get-Content $_.FullName -Raw
    -not ($sbFiles | Where-Object { $t -match [regex]::Escape($_.Name) })
} | ForEach-Object { $_.Name }

Write-Host ""
Write-Host "Migrasi Go tanpa rujukan Supabase (khusus runtime Go, wajar):"
$tanpaRujukan | ForEach-Object { Write-Host "  $_" }

Write-Host ""
if ($kurang.Count -gt 0) {
    Write-Host "HASIL: $($kurang.Count) migrasi Supabase belum dicerminkan ke Go."
    Write-Host "Tambahkan berkas baru di sewara-api/migrations/ (TANPA INSERT ke ledger) yang"
    Write-Host "mengandung komentar: -- cermin dari sewara-backend/supabase/migrations/<nama>"
    exit 1
}
Write-Host "HASIL: cermin lengkap - semua migrasi Supabase sesudah baseline ada padanannya."
exit 0
