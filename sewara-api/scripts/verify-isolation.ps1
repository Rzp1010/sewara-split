# verify-isolation.ps1 — bukti isolasi tenant di level database.
#
#   .\scripts\verify-isolation.ps1
#
# Menyalakan Postgres, lalu untuk setiap tabel bisnis menghitung baris yang terlihat
# oleh: owner A, owner B, tanpa konteks, dan superuser (bypass RLS).
#
# Invarian yang diuji:
#   - tanpa konteks  = 0        (lupa set konteks tidak boleh membocorkan data)
#   - A > 0 dan B > 0           (kedua tenant benar-benar punya data)
#   - A + B = superuser         (tidak ada baris yang lolos dari penanda tenant)
#
# Prasyarat: data uji sudah dimuat (scripts\seed-staging.ps1).

$ErrorActionPreference = 'Stop'

$root  = Split-Path -Parent $PSScriptRoot
$pgBin = Join-Path $root '.data\pgsql\bin'
$psql  = Join-Path $pgBin 'psql.exe'
$conn  = @('-h', '127.0.0.1', '-p', '5433', '-U', 'sewara', '-d', 'sewara', '-q', '-tA')

$ownerA = 'a0000000-0000-0000-0000-000000000001'
$ownerB = 'b0000000-0000-0000-0000-000000000001'

# Tabel bisnis yang punya penanda tenant berupa kolom user_id.
$tables = @(
    'member_types', 'members', 'inventory', 'inventory_units',
    'transactions', 'transaction_items', 'transaction_payments',
    'promo_codes', 'settings'
)

$sql = New-Object System.Text.StringBuilder
[void]$sql.AppendLine('SET ROLE authenticated;')
foreach ($t in $tables) {
    [void]$sql.AppendLine("SELECT '$t|none|' || count(*) FROM $t;")
}
[void]$sql.AppendLine("SELECT set_config('app.user_id', '$ownerA', false);")
foreach ($t in $tables) {
    [void]$sql.AppendLine("SELECT '$t|A|' || count(*) FROM $t;")
}
[void]$sql.AppendLine("SELECT set_config('app.user_id', '$ownerB', false);")
foreach ($t in $tables) {
    [void]$sql.AppendLine("SELECT '$t|B|' || count(*) FROM $t;")
}
[void]$sql.AppendLine('RESET ROLE;')
foreach ($t in $tables) {
    [void]$sql.AppendLine("SELECT '$t|super|' || count(*) FROM $t;")
}

$sqlFile = Join-Path $env:TEMP 'opencode\isolation.sql'
[System.IO.File]::WriteAllText($sqlFile, $sql.ToString(), (New-Object System.Text.UTF8Encoding($false)))

& (Join-Path $PSScriptRoot 'staging-db.ps1') start
try {
    $rows = @{}
    $out = & $psql @conn -f $sqlFile
    if ($LASTEXITCODE -ne 0) { throw "psql gagal (exit $LASTEXITCODE)" }

    foreach ($line in $out) {
        if ($line -match '^(\w+)\|(\w+)\|(\d+)$') {
            if (-not $rows.ContainsKey($Matches[1])) { $rows[$Matches[1]] = @{} }
            $rows[$Matches[1]][$Matches[2]] = [int]$Matches[3]
        }
    }

    Write-Host ''
    Write-Host ('{0,-22} {1,5} {2,5} {3,5} {4,6}  {5}' -f 'tabel', 'A', 'B', 'none', 'super', 'hasil')
    Write-Host ('-' * 60)

    $gagal = 0
    foreach ($t in $tables) {
        $r = $rows[$t]
        $a = $r['A']; $b = $r['B']; $n = $r['none']; $s = $r['super']
        $ok = ($n -eq 0) -and ($a -gt 0) -and ($b -gt 0) -and (($a + $b) -eq $s)
        $verdict = if ($ok) { 'LOLOS' } else { 'GAGAL' }
        if (-not $ok) { $gagal++ }
        Write-Host ('{0,-22} {1,5} {2,5} {3,5} {4,6}  {5}' -f $t, $a, $b, $n, $s, $verdict)
    }

    Write-Host ''
    if ($gagal -eq 0) { Write-Host "$($tables.Count) tabel lolos." }
    else { Write-Host "$gagal tabel GAGAL."; exit 1 }
}
finally {
    Remove-Item $sqlFile -Force -ErrorAction SilentlyContinue
    & (Join-Path $PSScriptRoot 'staging-db.ps1') stop
}
