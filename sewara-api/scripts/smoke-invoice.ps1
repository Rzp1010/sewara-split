# smoke-invoice.ps1 — uji counter dan header invoice pada Docker staging.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$apiExe = Join-Path $root '.data\bin\sewara-api.exe'
$apiURL = 'http://127.0.0.1:8099'
$tmpDir = Join-Path $env:TEMP 'opencode'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$dockerBin = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin"
$env:PATH = "$dockerBin;$env:PATH"
$OWNER_A = 'a0000000-0000-0000-0000-000000000001'
$OWNER_B = 'b0000000-0000-0000-0000-000000000001'

function Invoke-Api([string]$method, [string]$path, [string]$cookie, [string]$body) {
    $outFile = Join-Path $tmpDir 'invoice-out.bin'
    $args = @('-s', '--max-time', '15', '-o', $outFile, '-w', '%{http_code}', '-X', $method)
    if ($cookie) { $args += @('-H', "Cookie: sewara_session=$cookie") }
    if ($body) {
        $bodyFile = Join-Path $tmpDir 'invoice-body.json'
        [System.IO.File]::WriteAllText($bodyFile, $body, (New-Object System.Text.UTF8Encoding($false)))
        $args += @('-H', 'Content-Type: application/json', '--data-binary', "@$bodyFile")
    }
    $args += "$apiURL$path"
    $status = [int](curl.exe @args)
    return @{ Status = $status; Body = (Get-Content $outFile -Raw -ErrorAction SilentlyContinue) }
}
function Get-SessionCookie([string]$email) {
    $jar = Join-Path $tmpDir 'invoice-session.txt'
    Remove-Item $jar -ErrorAction SilentlyContinue
    $bodyFile = Join-Path $tmpDir 'invoice-login.json'
    [System.IO.File]::WriteAllText($bodyFile, "{`"email`":`"$email`",`"password`":`"Rahasia123`"}", (New-Object System.Text.UTF8Encoding($false)))
    $status = [int](curl.exe -s --max-time 15 -o NUL -w '%{http_code}' -c $jar -H 'Content-Type: application/json' --data-binary "@$bodyFile" "$apiURL/api/auth/login")
    if ($status -ne 200) { throw "Login $email gagal (HTTP $status)" }
    if ((Get-Content $jar -Raw) -match 'sewara_session\s+([^\s]+)') { return $Matches[1] }
    throw "Cookie tidak ditemukan setelah login $email"
}
function Sql([string]$sql) {
    $out = docker exec sewara-staging-db psql -U sewara -d sewara -At -c $sql
    if ($LASTEXITCODE -ne 0) { throw "psql gagal: $sql" }
    return ($out -join "`n").Trim()
}
$hasil = @()
function Add-Hasil([string]$nama, [bool]$lolos, [string]$info) {
    $script:hasil += [pscustomobject]@{ Skenario=$nama; Hasil=$(if ($lolos) {'LOLOS'} else {'GAGAL'}); Info=$info }
}
function DataOf($r) { return ($r.Body | ConvertFrom-Json).data }
function MsgOf($r) { return ($r.Body | ConvertFrom-Json).error.message }
function ErrCodeOf($r) { return ($r.Body | ConvertFrom-Json).error.code }
$api = $null
try {
    Push-Location $root
    go build -o $apiExe ./cmd/api
    Pop-Location
    if ($LASTEXITCODE -ne 0) { throw 'go build gagal' }
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') reset
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') start

    $hash = '$2a$10$GCmHsmqVk3cqwXmf0AVWueY8h0JHD1zo0mr.tl0F/CH0dI/01mYEu'
    Sql "INSERT INTO auth.users (id,email,encrypted_password,email_confirmed_at) VALUES ('$OWNER_A','owner-a@staging.local','$hash',now()),('a0000000-0000-0000-0000-000000000002','cs-a@staging.local','$hash',now()),('$OWNER_B','owner-b@staging.local','$hash',now()) ON CONFLICT (id) DO UPDATE SET encrypted_password='$hash',email_confirmed_at=now();" | Out-Null
    $env:DATABASE_URL = 'postgres://sewara:sewara123@127.0.0.1:5433/sewara?sslmode=disable'
    $env:ADDR = '127.0.0.1:8099'
    $env:APP_ENV = 'development'
    $listeners = @(Get-NetTCPConnection -LocalPort 8099 -State Listen -ErrorAction SilentlyContinue)
    foreach ($c in $listeners) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
    if ($listeners.Count) { Start-Sleep -Milliseconds 500 }
    $api = Start-Process -FilePath $apiExe -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $tmpDir 'invoice-api-out.log') -RedirectStandardError (Join-Path $tmpDir 'invoice-api-err.log')
    $ready = $false
    for ($i=0; $i -lt 30; $i++) { Start-Sleep -Milliseconds 300; if ((curl.exe -s -o NUL -w '%{http_code}' "$apiURL/api/health") -eq '200') { $ready=$true; break } }
    if (-not $ready) { throw 'API tidak siap' }
    $a = Get-SessionCookie 'owner-a@staging.local'; $b = Get-SessionCookie 'owner-b@staging.local'; $cs = Get-SessionCookie 'cs-a@staging.local'

    $r=Invoke-Api POST '/api/invoice-counter' '' $null
    Add-Hasil 'counter tanpa cookie 401' ($r.Status -eq 401 -and (ErrCodeOf $r) -eq 'UNAUTHORIZED') $r.Body
    $r=Invoke-Api POST '/api/invoice-counter' $a $null; $n=(DataOf $r).no_invoice
    Add-Hasil 'owner A counter pertama INV-000001' ($r.Status -eq 200 -and $n -eq 'INV-000001') $r.Body
    $r=Invoke-Api POST '/api/invoice-counter' $a $null; $n=(DataOf $r).no_invoice
    Add-Hasil 'counter kedua INV-000002' ($r.Status -eq 200 -and $n -eq 'INV-000002') $r.Body
    $ctr=Sql "SELECT value FROM settings WHERE user_id='$OWNER_A' AND key='invoice_counter'"
    Add-Hasil 'counter DB tenant A = 2' ($ctr -eq '2') $ctr
    $r=Invoke-Api POST '/api/invoice-counter' $cs $null
    Add-Hasil 'staf memakai counter tenant A = 3' ($r.Status -eq 200 -and (DataOf $r).no_invoice -eq 'INV-000003') $r.Body
    $r=Invoke-Api POST '/api/invoice-counter' $b $null; $n=(DataOf $r).no_invoice
    $ctrA=Sql "SELECT value FROM settings WHERE user_id='$OWNER_A' AND key='invoice_counter'"; $ctrB=Sql "SELECT value FROM settings WHERE user_id='$OWNER_B' AND key='invoice_counter'"
    Add-Hasil 'owner B terisolasi counter awal' ($r.Status -eq 200 -and $n -eq 'INV-000001' -and $ctrA -eq '3' -and $ctrB -eq '1') "$n A=$ctrA B=$ctrB"
    $r=Invoke-Api POST '/api/settings' $a '[{"key":"invoice_prefix","value":"ABC"},{"key":"invoice_digit","value":"4"}]'
    $r=Invoke-Api POST '/api/invoice-counter' $a $null; $n=(DataOf $r).no_invoice
    $settings=Sql "SELECT key||'='||value FROM settings WHERE user_id='$OWNER_A' AND key IN ('invoice_prefix','invoice_digit') ORDER BY key"
    Add-Hasil 'prefix/digit tersimpan dan diformat' ($r.Status -eq 200 -and $n -eq 'ABC-0004' -and $settings -match 'invoice_digit=4' -and $settings -match 'invoice_prefix=ABC') "$n $settings"

    $r=Invoke-Api GET '/api/invoice/header' $a $null
    Add-Hasil 'GET header kosong 404' ($r.Status -eq 404 -and (MsgOf $r) -eq 'Header invoice belum diatur.') $r.Body
    Sql "INSERT INTO settings(user_id,key,value,updated_at) VALUES ('$OWNER_A','invoice_header','headers/$OWNER_B.png',now()) ON CONFLICT(user_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now();" | Out-Null
    $r=Invoke-Api GET '/api/invoice/header' $a $null
    Add-Hasil 'GET header lintas tenant 403' ($r.Status -eq 403 -and (MsgOf $r) -eq 'Anda tidak memiliki akses ke file ini.') $r.Body
    $ownKey="headers/$OWNER_A.png"
    Sql "UPDATE settings SET value='$ownKey' WHERE user_id='$OWNER_A' AND key='invoice_header';" | Out-Null
    $r=Invoke-Api GET '/api/invoice/header' $a $null
    Add-Hasil 'GET header sendiri storage off 503' ($r.Status -eq 503 -and (MsgOf $r) -eq 'Penyimpanan berkas belum dikonfigurasi di server ini.' -and (ErrCodeOf $r) -eq 'EXTERNAL_SERVICE_ERROR') $r.Body
    $quotedKey = '"' + $ownKey + '"'
    Sql "UPDATE settings SET value='$quotedKey' WHERE user_id='$OWNER_A' AND key='invoice_header';" | Out-Null
    $r=Invoke-Api GET '/api/invoice/header' $a $null
    Add-Hasil 'GET nilai JSON quoted tetap storage off 503' ($r.Status -eq 503 -and (MsgOf $r) -eq 'Penyimpanan berkas belum dikonfigurasi di server ini.') $r.Body

    $r=Invoke-Api POST '/api/invoice/header' $a $null
    Add-Hasil 'POST tanpa file storage off 503' ($r.Status -eq 503 -and (MsgOf $r) -eq 'Penyimpanan berkas belum dikonfigurasi di server ini.') $r.Body
    # String kutip-tunggal TIDAK mengartikan `r`n, jadi CRLF dibangun terpisah.
    $mp=Join-Path $tmpDir 'invoice-multipart.bin'; $crlf="`r`n"
    $payload=@('--bound','Content-Disposition: form-data; name="file"; filename="a.png"','Content-Type: image/png','','abc','--bound--','') -join $crlf
    [System.IO.File]::WriteAllBytes($mp,[System.Text.Encoding]::ASCII.GetBytes($payload))
    $status=[int](curl.exe -s --max-time 15 -o (Join-Path $tmpDir 'invoice-upload.out') -w '%{http_code}' -H "Cookie: sewara_session=$a" -H 'Content-Type: multipart/form-data; boundary=bound' --data-binary "@$mp" "$apiURL/api/invoice/header")
    $body=Get-Content (Join-Path $tmpDir 'invoice-upload.out') -Raw
    Add-Hasil 'POST multipart valid storage off 503' ($status -eq 503 -and (MsgOf @{Body=$body}) -eq 'Penyimpanan berkas belum dikonfigurasi di server ini.') $body
    $r=Invoke-Api DELETE '/api/invoice/header' $a $null
    Add-Hasil 'DELETE tanpa path 400' ($r.Status -eq 400 -and (MsgOf $r) -eq 'Parameter path wajib diisi.') $r.Body
    $r=Invoke-Api DELETE "/api/invoice/header?path=headers/$OWNER_B.png" $a $null
    Add-Hasil 'DELETE path tenant lain 403' ($r.Status -eq 403 -and (MsgOf $r) -eq 'Anda tidak memiliki akses ke file ini.') $r.Body
    $r=Invoke-Api DELETE "/api/invoice/header?path=$ownKey" $a $null
    Add-Hasil 'DELETE path sendiri storage off 503' ($r.Status -eq 503 -and (MsgOf $r) -eq 'Penyimpanan berkas belum dikonfigurasi di server ini.') $r.Body
    $r=Invoke-Api DELETE "/api/invoice/header?path=$ownKey" '' $null
    Add-Hasil 'DELETE tanpa cookie 401' ($r.Status -eq 401 -and (ErrCodeOf $r) -eq 'UNAUTHORIZED') $r.Body

    # Bersihkan jejak di settings owner A: skrip lain dalam batch yang sama
    # (smoke-settings) menuntut settings seed apa adanya.
    Sql "DELETE FROM settings WHERE user_id='$OWNER_A' AND key IN ('invoice_prefix','invoice_digit','invoice_header'); UPDATE settings SET value='0' WHERE user_id='$OWNER_A' AND key='invoice_counter';" | Out-Null
}
catch { Write-Error $_; Add-Hasil 'Persiapan/eksekusi smoke' $false $_.ToString() }
finally {
    if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') stop
    $hasil | Format-Table -AutoSize
    $gagal=@($hasil | Where-Object Hasil -eq 'GAGAL')
    if ($gagal.Count -eq 0 -and $hasil.Count -eq 17) { Write-Host "Semua $($hasil.Count) skenario lolos"; exit 0 }
    Write-Host "Gagal: $($gagal.Count) dari $($hasil.Count) skenario" -ForegroundColor Red
    exit 1
}
