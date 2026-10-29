# smoke-dashboard.ps1 — uji GET /api/dashboard (RPC agregasi + guard tenant)

$ErrorActionPreference = 'Stop'
$root   = Split-Path -Parent $PSScriptRoot
$apiExe = Join-Path $root '.data\bin\sewara-api.exe'
$apiURL = 'http://127.0.0.1:8099'
$tmpDir = Join-Path $env:TEMP 'opencode'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$env:PATH = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:PATH"

function Invoke-Api([string]$path, [string]$cookie) {
    $outFile = Join-Path $tmpDir 'api-out.bin'
    $curlArgs = @('-s', '--max-time', '20', '-o', $outFile, '-w', '%{http_code}')
    if ($cookie) { $curlArgs += @('-H', "Cookie: sewara_session=$cookie") }
    $curlArgs += "$apiURL$path"
    $status = [int](curl.exe @curlArgs)
    return [pscustomobject]@{ Status = $status; Body = (Get-Content $outFile -Raw -ErrorAction SilentlyContinue) }
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
    throw "Cookie tidak ditemukan"
}

$goExe = @("$env:ProgramFiles\Go\bin\go.exe", "$env:LOCALAPPDATA\Programs\Go\bin\go.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
Push-Location $root
try {
    $env:CGO_ENABLED = '0'
    & $goExe build -o $apiExe ./cmd/api
    if ($LASTEXITCODE -ne 0) { throw 'go build gagal' }
}
finally { Pop-Location }

& (Join-Path $PSScriptRoot 'docker-staging.ps1') start | Out-Null

$hash = '$2a$10$GCmHsmqVk3cqwXmf0AVWueY8h0JHD1zo0mr.tl0F/CH0dI/01mYEu'
docker exec sewara-staging-db psql -U sewara -d sewara -c "
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'owner-a@staging.local', '$hash', now()),
  ('a0000000-0000-0000-0000-000000000002', 'cs-a@staging.local', '$hash', now()),
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
    $cookieOwnerA = Get-SessionCookie 'owner-a@staging.local'
    $cookieCS     = Get-SessionCookie 'cs-a@staging.local'
    $cookieOwnerB = Get-SessionCookie 'owner-b@staging.local'

    $hasil = @()
    function Add-Hasil([string]$nama, [int]$dapat, [int]$harap, [string]$info) {
        $script:hasil += [pscustomobject]@{ Skenario = $nama; Status = $dapat; Harap = $harap
            Hasil = $(if ($dapat -eq $harap) { 'LOLOS' } else { 'GAGAL' }); Info = $info }
    }

    $r = Invoke-Api '/api/dashboard' $null
    Add-Hasil 'GET tanpa cookie -> 401' $r.Status 401 ''

    $r = Invoke-Api '/api/dashboard' $cookieOwnerA
    $bodyA = $r.Body | ConvertFrom-Json
    $adaRekap = $null -ne $bodyA.data.rekapStatus
    $adaBayar = $null -ne $bodyA.data.pembayaran
    $ownerAOK = $r.Status -eq 200 -and $bodyA.ok -and $adaRekap -and $adaBayar
    Add-Hasil 'Owner A -> rekap status + pembayaran' ([int]$ownerAOK) 1 "HTTP=$($r.Status) rekap=$adaRekap bayar=$adaBayar"

    # Staf pakai tenant owner (RPC guard lolos).
    $r = Invoke-Api '/api/dashboard' $cookieCS
    $bodyCS = $r.Body | ConvertFrom-Json
    $csOK = $r.Status -eq 200 -and $bodyCS.ok -and $null -ne $bodyCS.data.rekapStatus -and $null -ne $bodyCS.data.pembayaran
    Add-Hasil 'CS A (tenant owner) -> body dashboard valid' ([int]$csOK) 1 "HTTP=$($r.Status)"

    # Owner B menerima body dashboard valid.
    $r = Invoke-Api '/api/dashboard' $cookieOwnerB
    $bodyB = $r.Body | ConvertFrom-Json
    $ownerBOK = $r.Status -eq 200 -and $bodyB.ok -and $null -ne $bodyB.data.rekapStatus -and $null -ne $bodyB.data.pembayaran
    Add-Hasil 'Owner B -> body dashboard valid' ([int]$ownerBOK) 1 "HTTP=$($r.Status)"

    # Rentang tanggal valid.
    $r = Invoke-Api '/api/dashboard?mulai=2026-01-01T00:00:00Z&akhir=2026-12-31T23:59:59Z' $cookieOwnerA
    $bodyFilter = $r.Body | ConvertFrom-Json
    $filterOK = $r.Status -eq 200 -and $bodyFilter.ok -and @($bodyFilter.data.PSObject.Properties.Name) -contains 'rekapStatus' -and @($bodyFilter.data.PSObject.Properties.Name) -contains 'pembayaran'
    Add-Hasil 'Filter tanggal -> body dashboard valid' ([int]$filterOK) 1 "HTTP=$($r.Status)"

    # Tanggal tidak valid -> 400 (validasi di handler, bukan 500 dari RPC).
    # Backend Next membalas 500 di sini; 400 lebih jujur karena masukannya yang salah.
    $r = Invoke-Api '/api/dashboard?mulai=bukan-tanggal' $cookieOwnerA
    Add-Hasil 'Tanggal tidak valid -> 400' $r.Status 400 ''

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
