# smoke-auth.ps1 â€” uji ujung-ke-ujung sesi auth tanpa lewat Supabase.
#
#   .\scripts\smoke-auth.ps1
#
# Prasyarat: skema sudah dimuat (scripts\staging-db.ps1 reset) dan data uji sudah
# dimasukkan (scripts\seed-staging.ps1).
#
# Yang diuji:
#   1. tanpa cookie         -> 401 UNAUTHORIZED
#   2. cookie palsu         -> 401 UNAUTHORIZED
#   3. sesi sah             -> 200, role ikut terbaca lewat RLS
#   4. sesi kedaluwarsa     -> 401 UNAUTHORIZED

$ErrorActionPreference = 'Stop'

$root   = Split-Path -Parent $PSScriptRoot
$container = 'sewara-staging-db'
$conn   = @('exec', $container, 'psql', '-U', 'sewara', '-d', 'sewara', '-q', '-tA')
$apiExe = Join-Path $root '.data\bin\sewara-api.exe'
$apiURL = 'http://127.0.0.1:8099'
$ownerA = 'a0000000-0000-0000-0000-000000000001'
$ownerEmail = 'owner-a@staging.local'

function Invoke-Sql([string]$sql) {
    $out = & docker @conn -c $sql 2>&1
    if ($LASTEXITCODE -ne 0) { throw "psql gagal: $($out -join ' ')" }
    return $out
}

# Token acak 32 byte -> base64url, lalu SHA-256 heksadesimal untuk disimpan.
function New-SessionToken {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $token = [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=')
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($token))
    $hex = ($hash | ForEach-Object { $_.ToString('x2') }) -join ''
    return [pscustomobject]@{ Token = $token; Hex = $hex }
}

function New-InsertedSession([int]$daysValid) {
    $t = New-SessionToken
    Invoke-Sql "INSERT INTO auth.sessions (token_hash, user_id, expires_at) VALUES (decode('$($t.Hex)','hex'), '$ownerA'::uuid, now() + interval '$daysValid days')" | Out-Null
    return $t.Token
}

Write-Host 'Menyiapkan binari...'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $apiExe) | Out-Null
New-Item -ItemType Directory -Force -Path "$env:TEMP\opencode" | Out-Null

# Toolchain Go tidak selalu ada di PATH proses ini; cari di lokasi pemasangan standar.
$goExe = $null
$kandidat = @("$env:ProgramFiles\Go\bin\go.exe", "$env:LOCALAPPDATA\Programs\Go\bin\go.exe")
foreach ($k in $kandidat) { if (Test-Path $k) { $goExe = $k; break } }
if (-not $goExe) { throw "go tidak ditemukan. Dicek: $($kandidat -join ', ')" }

Push-Location $root
try {
    $env:CGO_ENABLED = '0'
    & $goExe build -o $apiExe ./cmd/api
    if ($LASTEXITCODE -ne 0) { throw 'go build gagal' }
}
finally { Pop-Location }

$env:PATH = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:PATH"
& (Join-Path $PSScriptRoot 'docker-staging.ps1') start

$api = $null
try {
    # Profil owner A sudah dibuat oleh seed; auth.users harus ada karena sesi
    # mereferensikannya lewat foreign key.
    Invoke-Sql "INSERT INTO auth.users (id, email) VALUES ('$ownerA'::uuid, '$ownerEmail') ON CONFLICT (id) DO NOTHING" | Out-Null

    $env:DATABASE_URL = 'postgres://sewara:sewara123@127.0.0.1:5433/sewara?sslmode=disable'
    $env:ADDR = '127.0.0.1:8099'
    $env:APP_ENV = 'development'
    # Kosongkan storage: nama bucket juga dikosongkan karena config Go menerima
    # R2_BUCKET_NAME sebagai fallback (kalau tidak, shell yang mengekspornya bisa
    # menyalakan storage tanpa sengaja).
    $env:R2_ENDPOINT = ''; $env:R2_ACCESS_KEY_ID = ''; $env:R2_SECRET_ACCESS_KEY = ''; $env:R2_BUCKET = ''; $env:R2_BUCKET_NAME = ''; $env:R2_REGION = ''

    $api = Start-Process -FilePath $apiExe -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $root '.data\api.out.log') `
        -RedirectStandardError (Join-Path $root '.data\api.err.log')

    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 300
        $code = (curl.exe -s -o NUL -w '%{http_code}' --max-time 2 "$apiURL/api/health")
        if ($code -eq '200') { $ready = $true; break }
    }
    if (-not $ready) {
        Get-Content (Join-Path $root '.data\api.err.log') -Tail 20 -ErrorAction SilentlyContinue
        throw 'API tidak siap'
    }

    $validToken = New-InsertedSession 30
    $expiredToken = New-InsertedSession -1

    $hasil = @()
    # $Kode: potongan body yang wajib cocok — status HTTP saja tidak cukup.
    # 401 wajib membawa error.code UNAUTHORIZED; sesi sah wajib membawa role owner
    # (bukti identitas terbaca lewat RLS, bukan hanya sesi ditemukan).
    $uji = @(
        @{ Nama = 'tanpa cookie'; Cookie = $null; Harap = 401; Kode = 'UNAUTHORIZED' },
        @{ Nama = 'cookie palsu'; Cookie = 'token-palsu-tidak-ada'; Harap = 401; Kode = 'UNAUTHORIZED' },
        @{ Nama = 'sesi kedaluwarsa'; Cookie = $expiredToken; Harap = 401; Kode = 'UNAUTHORIZED' },
        @{ Nama = 'sesi sah'; Cookie = $validToken; Harap = 200; Kode = 'owner' }
    )

    foreach ($u in $uji) {
        $curlArgs = @('-s', '--max-time', '10', '-o', "$env:TEMP\opencode\auth.bin", '-w', '%{http_code}', "$apiURL/api/auth/me")
        if ($u.Cookie) { $curlArgs += @('-H', "Cookie: sewara_session=$($u.Cookie)") }
        $status = [int](curl.exe @curlArgs)
        $body = Get-Content "$env:TEMP\opencode\auth.bin" -Raw -ErrorAction SilentlyContinue

        $kode = ''
        if ($body -and $body -match '"code"\s*:\s*"([A-Z_]+)"') { $kode = $Matches[1] }
        if ($body -and $body -match '"role"\s*:\s*"([a-z]+)"') { $kode = $Matches[1] }

        $ok = $status -eq $u.Harap -and $kode -eq $u.Kode
        $hasil += [pscustomobject]@{ Skenario = $u.Nama; Status = $status; Harap = $u.Harap; Hasil = $(if ($ok) { 'LOLOS' } else { 'GAGAL' }); Info = $kode }
    }

    # Bersihkan sesi uji lalu buktikan tidak ada sisa (harness tidak boleh
    # meninggalkan baris yang bisa membuat skrip lain lolos palsu).
    Invoke-Sql "DELETE FROM auth.sessions WHERE user_id = '$ownerA'::uuid" | Out-Null
    $sisaSesi = (Invoke-Sql "SELECT count(*) FROM auth.sessions WHERE user_id = '$ownerA'::uuid") -join ''
    $hasil += [pscustomobject]@{
        Skenario = 'bersih: sesi uji terhapus'; Status = $sisaSesi; Harap = '0'
        Hasil = $(if ($sisaSesi.Trim() -eq '0') { 'LOLOS' } else { 'GAGAL' }); Info = ''
    }

    Write-Host ''
    $hasil | Format-Table -AutoSize | Out-String | Write-Host

    $gagal = ($hasil | Where-Object { $_.Hasil -eq 'GAGAL' }).Count
    if ($gagal -gt 0) { Write-Host "$gagal skenario GAGAL" ; exit 1 }
    Write-Host 'Semua skenario lolos.'
}
finally {
    if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') stop
}

