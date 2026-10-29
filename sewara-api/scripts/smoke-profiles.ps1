# smoke-profiles.ps1 — uji GET /api/profiles (list + filter email + RLS)

$ErrorActionPreference = 'Stop'

$root   = Split-Path -Parent $PSScriptRoot
$apiExe = Join-Path $root '.data\bin\sewara-api.exe'
$apiURL = 'http://127.0.0.1:8099'
$tmpDir = Join-Path $env:TEMP 'opencode'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

$dockerBin = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin"
$env:PATH = "$dockerBin;$env:PATH"

function Invoke-Api([string]$method, [string]$path, [string]$cookie) {
    $outFile = Join-Path $tmpDir 'api-out.bin'
    $curlArgs = @('-s', '--max-time', '15', '-o', $outFile, '-w', '%{http_code}', '-X', $method)
    if ($cookie) { $curlArgs += @('-H', "Cookie: sewara_session=$cookie") }
    $curlArgs += "$apiURL$path"
    $status = [int](curl.exe @curlArgs)
    $respBody = Get-Content $outFile -Raw -ErrorAction SilentlyContinue
    return [pscustomobject]@{ Status = $status; Body = $respBody }
}

function Get-SessionCookie([string]$email) {
    $jar = Join-Path $tmpDir 'session.txt'
    Remove-Item $jar -ErrorAction SilentlyContinue
    $body = "{`"email`":`"$email`",`"password`":`"Rahasia123`"}"
    $bodyFile = Join-Path $tmpDir 'login-body.json'
    [System.IO.File]::WriteAllText($bodyFile, $body, (New-Object System.Text.UTF8Encoding($false)))
    $status = [int](curl.exe -s --max-time 15 -o NUL -w '%{http_code}' -c $jar -H 'Content-Type: application/json' --data-binary "@$bodyFile" "$apiURL/api/auth/login")
    if ($status -ne 200) { throw "Login $email gagal (HTTP $status)" }
    $isian = Get-Content $jar -Raw
    if ($isian -match 'sewara_session\s+([^\s]+)') { return $Matches[1] }
    throw "Cookie tidak ditemukan setelah login $email"
}

Write-Host 'Menyiapkan binari...'
$goExe = @("$env:ProgramFiles\Go\bin\go.exe", "$env:LOCALAPPDATA\Programs\Go\bin\go.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $goExe) { throw 'go tidak ditemukan' }

Push-Location $root
try {
    $env:CGO_ENABLED = '0'
    & $goExe build -o $apiExe ./cmd/api
    if ($LASTEXITCODE -ne 0) { throw 'go build gagal' }
}
finally { Pop-Location }

Write-Host 'Memulai Docker staging...'
& (Join-Path $PSScriptRoot 'docker-staging.ps1') start | Out-Null

$hash = '$2a$10$GCmHsmqVk3cqwXmf0AVWueY8h0JHD1zo0mr.tl0F/CH0dI/01mYEu'
docker exec sewara-staging-db psql -U sewara -d sewara -c "
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'owner-a@staging.local', '$hash', now()),
  ('a0000000-0000-0000-0000-000000000002', 'cs-a@staging.local', '$hash', now()),
  ('a0000000-0000-0000-0000-000000000003', 'superadmin@staging.local', '$hash', now()),
  ('b0000000-0000-0000-0000-000000000001', 'owner-b@staging.local', '$hash', now())
ON CONFLICT (id) DO UPDATE SET encrypted_password='$hash', email_confirmed_at=now();
" | Out-Null

$env:DATABASE_URL = 'postgres://sewara:sewara123@127.0.0.1:5433/sewara?sslmode=disable'
$env:ADDR = '127.0.0.1:8099'
$env:APP_ENV = 'development'

$api = Start-Process -FilePath $apiExe -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $root '.data\api.out.log') `
    -RedirectStandardError (Join-Path $root '.data\api.err.log')

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 300
    if ((curl.exe -s -o NUL -w '%{http_code}' --max-time 2 "$apiURL/api/health") -eq '200') { $ready = $true; break }
}
if (-not $ready) {
    if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
    Get-Content (Join-Path $root '.data\api.err.log') -Tail 20 -ErrorAction SilentlyContinue
    throw 'API tidak siap'
}

try {
    Write-Host ''
    Write-Host '=== Login ==='
    $cookieOwnerA    = Get-SessionCookie 'owner-a@staging.local'
    $cookieOwnerB    = Get-SessionCookie 'owner-b@staging.local'
    $cookieCS        = Get-SessionCookie 'cs-a@staging.local'
    $cookieSuperadmin = Get-SessionCookie 'superadmin@staging.local'
    Write-Host 'Login berhasil'
    Write-Host ''

    $hasil = @()
    function Add-Hasil([string]$nama, [int]$dapat, [int]$harap, [string]$info) {
        $script:hasil += [pscustomobject]@{
            Skenario = $nama; Status = $dapat; Harap = $harap
            Hasil = $(if ($dapat -eq $harap) { 'LOLOS' } else { 'GAGAL' }); Info = $info
        }
    }

    # GET tanpa auth
    $r = Invoke-Api 'GET' '/api/profiles' $null
    Add-Hasil 'GET tanpa cookie -> 401' $r.Status 401 ''

    # Owner A: lihat dirinya + CS A, bukan tenant B.
    $r = Invoke-Api 'GET' '/api/profiles' $cookieOwnerA
    $profiles = ($r.Body | ConvertFrom-Json).data.profiles
    $count = @($profiles).Count
    $adaB = @($profiles | Where-Object { $_.email -eq 'owner-b@staging.local' }).Count -gt 0
    $adaOwnerA = @($profiles | Where-Object { $_.email -eq 'owner-a@staging.local' }).Count -gt 0
    $ownerAOK = $r.Status -eq 200 -and $count -eq 2 -and $adaOwnerA -and -not $adaB
    Add-Hasil 'Owner A lihat profil tenant sendiri' ([int]$ownerAOK) 1 "HTTP=$($r.Status) count=$count adaB=$adaB"

    # CS A hanya melihat profil dirinya.
    $r = Invoke-Api 'GET' '/api/profiles' $cookieCS
    $profiles = ($r.Body | ConvertFrom-Json).data.profiles
    $count = @($profiles).Count
    $csOnly = $count -eq 1 -and $profiles[0].email -eq 'cs-a@staging.local'
    Add-Hasil 'CS A lihat profil dirinya saja' ([int]($r.Status -eq 200 -and $csOnly)) 1 "HTTP=$($r.Status) count=$count"

    # Superadmin: lihat semua profil.
    $r = Invoke-Api 'GET' '/api/profiles' $cookieSuperadmin
    $profiles = ($r.Body | ConvertFrom-Json).data.profiles
    $count = @($profiles).Count
    $adaA = @($profiles | Where-Object { $_.email -eq 'owner-a@staging.local' }).Count -gt 0
    $adaB = @($profiles | Where-Object { $_.email -eq 'owner-b@staging.local' }).Count -gt 0
    $superadminOK = $r.Status -eq 200 -and $count -ge 3 -and $adaA -and $adaB
    Add-Hasil 'Superadmin lihat semua profil' ([int]$superadminOK) 1 "HTTP=$($r.Status) count=$count adaA=$adaA adaB=$adaB"

    # Owner B: lihat dirinya + CS B, bukan tenant A.
    $r = Invoke-Api 'GET' '/api/profiles' $cookieOwnerB
    $profiles = ($r.Body | ConvertFrom-Json).data.profiles
    $count = @($profiles).Count
    $adaA = @($profiles | Where-Object { $_.email -eq 'owner-a@staging.local' }).Count -gt 0
    $adaOwnerB = @($profiles | Where-Object { $_.email -eq 'owner-b@staging.local' }).Count -gt 0
    $ownerBOK = $r.Status -eq 200 -and $count -eq 2 -and $adaOwnerB -and -not $adaA
    Add-Hasil 'Owner B lihat profil tenant sendiri' ([int]$ownerBOK) 1 "HTTP=$($r.Status) count=$count adaA=$adaA"

    # Filter by email (owner A cari CS A) -> ketemu.
    $r = Invoke-Api 'GET' '/api/profiles?email=cs-a@staging.local' $cookieOwnerA
    $profile = ($r.Body | ConvertFrom-Json).data.profile
    $ada = $null -ne $profile -and $profile.email -eq 'cs-a@staging.local'
    Add-Hasil 'Filter CS A -> profil cocok' ([int]($r.Status -eq 200 -and $ada)) 1 "HTTP=$($r.Status) ada=$ada"

    # Filter by email tenant lain -> null (RLS).
    $r = Invoke-Api 'GET' '/api/profiles?email=owner-b@staging.local' $cookieOwnerA
    $null_ = $null -eq ($r.Body | ConvertFrom-Json).data.profile
    Add-Hasil 'Filter tenant lain -> null (RLS)' ([int]($r.Status -eq 200 -and $null_)) 1 "HTTP=$($r.Status) null=$null_"

    # Filter email tidak ada -> null.
    $r = Invoke-Api 'GET' '/api/profiles?email=tidak-ada@staging.local' $cookieOwnerA
    $null_ = $null -eq ($r.Body | ConvertFrom-Json).data.profile
    Add-Hasil 'Filter email tidak ada -> null' ([int]($r.Status -eq 200 -and $null_)) 1 "HTTP=$($r.Status) null=$null_"

    Write-Host ''
    $hasil | Format-Table -AutoSize | Out-String | Write-Host

    $gagal = @($hasil | Where-Object { $_.Hasil -ne 'LOLOS' }).Count
    if ($gagal -gt 0) { Write-Host "$gagal skenario GAGAL"; exit 1 }
    Write-Host 'Semua skenario lolos.'
}
finally {
    if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') stop | Out-Null
}
