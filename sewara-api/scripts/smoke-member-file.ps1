# smoke-member-file.ps1 — endpoint berkas member (POST /api/member/upload, GET /api/member/photo)
#
# Fase 1 (selalu): Docker staging, R2 kosong. Kontrak validasi + urutan galat.
# Fase 2 (opsional): hanya bila kredensial R2 lengkap di sewara-backend/.env.local
#                    dan bucket = sewara-dev. Bukti unggah nyata, ganti dokumen,
#                    batas ukuran, lalu bersihkan objek uji + member uji.
#
# Nilai kredensial TIDAK pernah dicetak; hanya nama kunci.

$ErrorActionPreference = 'Stop'
$root   = Split-Path -Parent $PSScriptRoot
$apiExe = Join-Path $root '.data\bin\sewara-api.exe'
$apiURL = 'http://127.0.0.1:8099'
$tmpDir = Join-Path $env:TEMP 'opencode'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$env:PATH = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:PATH"

$OWNER_A     = 'a0000000-0000-0000-0000-000000000001'
$OWNER_B     = 'b0000000-0000-0000-0000-000000000001'
$MEMBER_A1   = '1'   # seed: milik owner A
$MEMBER_B1   = '4'   # seed: milik owner B
$hash = '$2a$10$GCmHsmqVk3cqwXmf0AVWueY8h0JHD1zo0mr.tl0F/CH0dI/01mYEu'

function Sql([string]$q) { $o = docker exec sewara-staging-db psql -U sewara -d sewara -Atq -c $q; if ($LASTEXITCODE -ne 0) { throw "psql gagal: $q" }; return ($o -join "`n").Trim() }

function Invoke-Api([string]$method, [string]$path, [string]$cookie) {
    $out = Join-Path $tmpDir 'mf-api.bin'
    $a = @('-s', '--max-time', '20', '-o', $out, '-w', '%{http_code}', '-X', $method)
    if ($cookie) { $a += @('-H', "Cookie: sewara_session=$cookie") }
    $a += "$apiURL$path"
    $st = [int](curl.exe @a)
    return [pscustomobject]@{ Status = $st; Body = (Get-Content $out -Raw -ErrorAction SilentlyContinue) }
}

function Invoke-Upload([string]$cookie, [hashtable]$fields, [string]$filePath, [string]$mimeType) {
    $out = Join-Path $tmpDir 'mf-upload.bin'
    $a = @('-s', '--max-time', '40', '-o', $out, '-w', '%{http_code}', '-X', 'POST')
    if ($cookie) { $a += @('-H', "Cookie: sewara_session=$cookie") }
    if ($fields) { foreach ($k in $fields.Keys) { $a += @('-F', "$k=$($fields[$k])") } }
    if ($filePath) { $a += @('-F', "file=@$filePath;type=$mimeType") }
    $a += "$apiURL/api/member/upload"
    $st = [int](curl.exe @a)
    return [pscustomobject]@{ Status = $st; Body = (Get-Content $out -Raw -ErrorAction SilentlyContinue) }
}

function Get-SessionCookie([string]$email) {
    $jar = Join-Path $tmpDir 'mf-cookie.txt'
    Remove-Item $jar -ErrorAction SilentlyContinue
    $bodyFile = Join-Path $tmpDir 'mf-login.json'
    [IO.File]::WriteAllText($bodyFile, "{`"email`":`"$email`",`"password`":`"Rahasia123`"}", (New-Object Text.UTF8Encoding($false)))
    $st = [int](curl.exe -s --max-time 15 -o NUL -w '%{http_code}' -c $jar -H 'Content-Type: application/json' --data-binary "@$bodyFile" "$apiURL/api/auth/login")
    if ($st -ne 200) { throw "Login $email gagal (HTTP $st)" }
    if ((Get-Content $jar -Raw) -match 'sewara_session\s+([^\s]+)') { return $Matches[1] }
    throw "Cookie tidak ditemukan setelah login $email"
}

function Msg($r) { try { ($r.Body | ConvertFrom-Json).error.message } catch { '' } }
function Code($r) { try { ($r.Body | ConvertFrom-Json).error.code } catch { '' } }

$script:hasil = @()
function Add([string]$n, [bool]$ok, [string]$info) {
    $script:hasil += [pscustomobject]@{ Skenario = $n; Hasil = $(if ($ok) { 'LOLOS' } else { 'GAGAL' }); Info = $info }
}

function Start-Api {
    $script:api = Start-Process $apiExe -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $tmpDir 'mf-api.out') `
        -RedirectStandardError  (Join-Path $tmpDir 'mf-api.err')
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 300
        if ((curl.exe -s -o NUL -w '%{http_code}' --max-time 2 "$apiURL/api/health") -eq '200') { return }
    }
    throw 'API tidak siap'
}
function Stop-Api {
    if ($script:api -and -not $script:api.HasExited) { Stop-Process -Id $script:api.Id -Force -ErrorAction SilentlyContinue }
    $script:api = $null
}

# ---- file uji kecil ----
$pngB64  = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
$pngFile = Join-Path $tmpDir 'mf-1x1.png'
[IO.File]::WriteAllBytes($pngFile, [Convert]::FromBase64String($pngB64))
$pdfFile = Join-Path $tmpDir 'mf-kecil.pdf'
[IO.File]::WriteAllBytes($pdfFile, [Text.Encoding]::ASCII.GetBytes("%PDF-1.4`n%smoke-uji`n"))
$bigFile = Join-Path $tmpDir 'mf-11mb.bin'
[IO.File]::WriteAllBytes($bigFile, [byte[]]::new(11 * 1024 * 1024))

# Objek R2 uji yang dibuat skrip ini (dihapus di finally). Jangan pernah menambah
# key di luar prefix tenant+member uji.
$script:ujiKeys = New-Object System.Collections.ArrayList
$script:mid     = $null

# Kredensial R2 dari sewara-backend/.env.local (dibaca, tidak dicetak).
$script:r2Endpoint = ''; $script:r2Bucket = ''; $script:r2Ak = ''; $script:r2Sk = ''; $script:r2Region = 'auto'
$envFile = Join-Path $root '..\sewara-backend\.env.local'
if (Test-Path $envFile) {
    $r2 = @{}
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$') {
            $k = $Matches[1]; $v = $Matches[2].Trim()
            if ($v.Length -ge 2 -and (($v[0] -eq '"' -and $v[-1] -eq '"') -or ($v[0] -eq "'" -and $v[-1] -eq "'"))) { $v = $v.Substring(1, $v.Length - 2) }
            $r2[$k] = $v
        }
    }
    $script:r2Endpoint = ($r2['R2_ENDPOINT'] | ForEach-Object { $_.TrimEnd('/') })
    $script:r2Ak       = $r2['R2_ACCESS_KEY_ID']
    $script:r2Sk       = $r2['R2_SECRET_ACCESS_KEY']
    $script:r2Bucket   = if ($r2['R2_BUCKET']) { $r2['R2_BUCKET'] } else { $r2['R2_BUCKET_NAME'] }
    if ($r2['R2_REGION']) { $script:r2Region = $r2['R2_REGION'] }
}
$r2Lengkap = [bool]($script:r2Endpoint -and $script:r2Ak -and $script:r2Sk -and $script:r2Bucket)

function Remove-R2Key([string]$key) {
    if (-not $script:r2Endpoint) { return }
    $url = "$($script:r2Endpoint)/$($script:r2Bucket)/$key"
    $st = [int](curl.exe -s -o NUL -w '%{http_code}' --max-time 30 --aws-sigv4 "aws:amz:$($script:r2Region):s3" --user "$($script:r2Ak):$($script:r2Sk)" -X DELETE $url)
    return $st
}
function Test-R2Key([string]$key) {
    if (-not $script:r2Endpoint) { return 0 }
    $url = "$($script:r2Endpoint)/$($script:r2Bucket)/$key"
    return [int](curl.exe -s -o NUL -w '%{http_code}' --max-time 30 --aws-sigv4 "aws:amz:$($script:r2Region):s3" --user "$($script:r2Ak):$($script:r2Sk)" -I $url)
}

$api = $null
$phase2Ran = $false
try {
    Push-Location $root
    try { $env:CGO_ENABLED = '0'; go build -o $apiExe ./cmd/api; if ($LASTEXITCODE -ne 0) { throw 'go build gagal' } }
    finally { Pop-Location }

    & (Join-Path $PSScriptRoot 'docker-staging.ps1') reset | Out-Null
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') start | Out-Null

    Sql "INSERT INTO auth.users(id,email,encrypted_password,email_confirmed_at) VALUES ('$OWNER_A','owner-a@staging.local','$hash',now()),('$OWNER_B','owner-b@staging.local','$hash',now()) ON CONFLICT(id) DO UPDATE SET encrypted_password='$hash',email_confirmed_at=now();" | Out-Null

    # ---- FASE 1: R2 kosong ----
    $env:DATABASE_URL = 'postgres://sewara:sewara123@127.0.0.1:5433/sewara?sslmode=disable'
    $env:ADDR = '127.0.0.1:8099'
    $env:APP_ENV = 'development'
    $env:R2_ENDPOINT = ''; $env:R2_ACCESS_KEY_ID = ''; $env:R2_SECRET_ACCESS_KEY = ''; $env:R2_BUCKET = ''; $env:R2_BUCKET_NAME = ''; $env:R2_REGION = ''
    foreach ($l in @(Get-NetTCPConnection -LocalPort 8099 -State Listen -ErrorAction SilentlyContinue)) { Stop-Process -Id $l.OwningProcess -Force -ErrorAction SilentlyContinue }
    Start-Api
    $a = Get-SessionCookie 'owner-a@staging.local'
    $b = Get-SessionCookie 'owner-b@staging.local'

    $r = Invoke-Api 'POST' '/api/member/upload' $null
    Add 'upload tanpa cookie -> 401' ($r.Status -eq 401 -and (Code $r) -eq 'UNAUTHORIZED') "status=$($r.Status)"
    $r = Invoke-Api 'GET' '/api/member/photo' $null
    Add 'photo tanpa cookie -> 401' ($r.Status -eq 401 -and (Code $r) -eq 'UNAUTHORIZED') "status=$($r.Status)"

    $r = Invoke-Upload $a $null $null $null
    Add 'upload kosong -> 400 file/id/label' ($r.Status -eq 400 -and (Msg $r) -eq 'File, member ID, atau label tidak valid.') "status=$($r.Status) msg=$(Msg $r)"
    $r = Invoke-Upload $a @{ label = 'KTP'; index = '0' } $pngFile 'image/png'
    Add 'upload tanpa memberId -> 400' ($r.Status -eq 400 -and (Msg $r) -eq 'File, member ID, atau label tidak valid.') "status=$($r.Status)"
    $r = Invoke-Upload $a @{ memberId = $MEMBER_A1; index = '0' } $pngFile 'image/png'
    Add 'upload tanpa label -> 400' ($r.Status -eq 400 -and (Msg $r) -eq 'File, member ID, atau label tidak valid.') "status=$($r.Status)"
    $r = Invoke-Upload $a @{ memberId = $MEMBER_A1; label = 'Salah'; index = '0' } $pngFile 'image/png'
    Add 'upload label asing -> 400' ($r.Status -eq 400 -and (Msg $r) -eq 'File, member ID, atau label tidak valid.') "status=$($r.Status)"

    $r = Invoke-Upload $a @{ memberId = $MEMBER_A1; label = 'KTP' } $pngFile 'image/png'
    Add 'index hilang -> 400' ($r.Status -eq 400 -and (Msg $r) -eq 'Index dokumen tidak valid (harus 0-4).') "status=$($r.Status) msg=$(Msg $r)"
    $r = Invoke-Upload $a @{ memberId = $MEMBER_A1; label = 'KTP'; index = '5' } $pngFile 'image/png'
    Add 'index 5 -> 400' ($r.Status -eq 400 -and (Msg $r) -eq 'Index dokumen tidak valid (harus 0-4).') "status=$($r.Status)"
    $r = Invoke-Upload $a @{ memberId = $MEMBER_A1; label = 'KTP'; index = 'abc' } $pngFile 'image/png'
    Add 'index abc -> 400' ($r.Status -eq 400 -and (Msg $r) -eq 'Index dokumen tidak valid (harus 0-4).') "status=$($r.Status)"

    $r = Invoke-Upload $a @{ memberId = $MEMBER_A1; label = 'KTP'; index = '0' } $pngFile 'image/gif'
    Add 'MIME gif -> 400' ($r.Status -eq 400 -and (Msg $r) -eq 'Jenis file tidak didukung. Gunakan JPG, PNG, atau PDF.') "status=$($r.Status) msg=$(Msg $r)"

    $r = Invoke-Upload $a @{ memberId = $MEMBER_A1; label = 'KTP'; index = '0' } $bigFile 'image/png'
    Add 'file 11 MiB -> 400 ukuran' ($r.Status -eq 400 -and (Msg $r) -eq 'Ukuran file maksimal 10 MB.') "status=$($r.Status) msg=$(Msg $r)"

    $r = Invoke-Upload $a @{ memberId = '999999'; label = 'KTP'; index = '0' } $pngFile 'image/png'
    Add 'member tidak ada -> 404' ($r.Status -eq 404 -and (Msg $r) -eq 'Member tidak ditemukan.') "status=$($r.Status)"
    $r = Invoke-Upload $a @{ memberId = $MEMBER_B1; label = 'KTP'; index = '0' } $pngFile 'image/png'
    Add 'member tenant lain -> 404' ($r.Status -eq 404 -and (Msg $r) -eq 'Member tidak ditemukan.') "status=$($r.Status)"
    $r = Invoke-Upload $a @{ memberId = $MEMBER_A1; label = 'KTP'; index = '0' } $pngFile 'image/png'
    Add 'member ada + storage off -> 503' ($r.Status -eq 503 -and (Msg $r) -eq 'Penyimpanan berkas belum dikonfigurasi di server ini.') "status=$($r.Status) msg=$(Msg $r)"

    $r = Invoke-Api 'GET' '/api/member/photo' $a
    Add 'photo tanpa key -> 400' ($r.Status -eq 400 -and (Msg $r) -eq 'Parameter key wajib diisi.') "status=$($r.Status)"
    $r = Invoke-Api 'GET' "/api/member/photo?key=$([uri]::EscapeDataString("$OWNER_B/x.png"))" $a
    Add 'photo tenant lain -> 403' ($r.Status -eq 403 -and (Msg $r) -eq 'Anda tidak memiliki akses ke file ini.') "status=$($r.Status)"
    $r = Invoke-Api 'GET' "/api/member/photo?key=$([uri]::EscapeDataString("$OWNER_A/x.png"))" $a
    Add 'photo tenant sendiri + storage off -> 503' ($r.Status -eq 503 -and (Msg $r) -eq 'Penyimpanan berkas belum dikonfigurasi di server ini.') "status=$($r.Status)"

    # ---- FASE 2 ----
    if (-not $r2Lengkap) {
        Write-Host 'R2: DILEWATI (kredensial .env.local tidak lengkap)'
        Add 'R2 fase 2' $true 'DILEWATI (kredensial .env.local tidak lengkap)'
    }
    elseif ($script:r2Bucket -ne 'sewara-dev') {
        Write-Host "R2: DILEWATI (bucket bukan sewara-dev: $($script:r2Bucket))"
        Add 'R2 fase 2' $true "DILEWATI (bucket bukan sewara-dev: $($script:r2Bucket))"
    }
    else {
        $phase2Ran = $true
        Stop-Api
        $env:R2_ENDPOINT = $script:r2Endpoint; $env:R2_ACCESS_KEY_ID = $script:r2Ak; $env:R2_SECRET_ACCESS_KEY = $script:r2Sk
        $env:R2_BUCKET = $script:r2Bucket; $env:R2_REGION = $script:r2Region
        Start-Api
        $a = Get-SessionCookie 'owner-a@staging.local'

        $script:mid = Sql "INSERT INTO members (user_id,nama,hp,alamat,status,foto_jaminan) VALUES ('$OWNER_A','Smoke Member File','081100000777','Test','aktif','[]') RETURNING id;"
        $mid = $script:mid
        $prefix = "$OWNER_A/$mid"

        # 1) unggah PNG dokumen 0
        $r = Invoke-Upload $a @{ memberId = $mid; label = 'KTP'; index = '0' } $pngFile 'image/png'
        $j = $null; try { $j = $r.Body | ConvertFrom-Json } catch {}
        $pathPng = if ($j) { $j.path } else { '' }
        if ($pathPng) { [void]$script:ujiKeys.Add($pathPng) }
        Add 'fase2 unggah png -> 200 + path + label' `
            ($r.Status -eq 200 -and $j.ok -eq $true -and $pathPng -eq "$prefix/doc-0.png" -and $j.label -eq 'KTP') `
            "status=$($r.Status) path=$pathPng"
        $db = Sql "SELECT foto_jaminan->0->>'label'||'|'||(foto_jaminan->0->>'path') FROM members WHERE id=$mid;"
        Add 'fase2 DB foto_jaminan label+path' ($db -eq "KTP|$pathPng") "db=$db"

        # 2) GET photo byte identik + header
        $hdr = Join-Path $tmpDir 'mf-headers.txt'; $bodyF = Join-Path $tmpDir 'mf-body.bin'
        $st = [int](curl.exe -s -D $hdr -o $bodyF -w '%{http_code}' -H "Cookie: sewara_session=$a" "$apiURL/api/member/photo?key=$([uri]::EscapeDataString($pathPng))")
        $h = Get-Content $hdr -Raw
        $identik = ([Convert]::ToBase64String([IO.File]::ReadAllBytes($bodyF)) -eq $pngB64)
        Add 'fase2 GET photo byte identik' ($st -eq 200 -and $identik) "status=$st identik=$identik"
        Add 'fase2 GET photo header' `
            ($h -match '(?im)^Content-Type:\s*image/png' -and $h -match '(?im)^Cache-Control:\s*private, max-age=3600' -and $h -match '(?im)^Content-Disposition:\s*inline') `
            'Content-Type/Cache-Control/Content-Disposition'

        # 3) ganti index yang sama dengan PDF -> objek lama (png) HILANG, key baru (pdf) terisi
        $r = Invoke-Upload $a @{ memberId = $mid; label = 'KTP'; index = '0' } $pdfFile 'application/pdf'
        $j = $null; try { $j = $r.Body | ConvertFrom-Json } catch {}
        $pathPdf = if ($j) { $j.path } else { '' }
        if ($pathPdf) { [void]$script:ujiKeys.Add($pathPdf) }
        Add 'fase2 ganti index -> key pdf' ($r.Status -eq 200 -and $pathPdf -eq "$prefix/doc-0.pdf") "status=$($r.Status) path=$pathPdf"
        $rOld = Invoke-Api 'GET' "/api/member/photo?key=$([uri]::EscapeDataString($pathPng))" $a
        Add 'fase2 objek lama png hilang -> 404' ($rOld.Status -eq 404) "status=$($rOld.Status)"
        $hdr = Join-Path $tmpDir 'mf-headers.txt'; $bodyF = Join-Path $tmpDir 'mf-body.bin'
        $st = [int](curl.exe -s -D $hdr -o $bodyF -w '%{http_code}' -H "Cookie: sewara_session=$a" "$apiURL/api/member/photo?key=$([uri]::EscapeDataString($pathPdf))")
        $h = Get-Content $hdr -Raw
        Add 'fase2 GET pdf -> application/pdf' ($st -eq 200 -and $h -match '(?im)^Content-Type:\s*application/pdf') "status=$st"

        # 4) isi sampai 5 dokumen
        $semua = $true
        foreach ($i in 1..4) {
            $r = Invoke-Upload $a @{ memberId = $mid; label = 'Lainnya'; index = "$i" } $pngFile 'image/png'
            $j = $null; try { $j = $r.Body | ConvertFrom-Json } catch {}
            if ($j -and $j.path) { [void]$script:ujiKeys.Add($j.path) }
            if ($r.Status -ne 200) { $semua = $false }
        }
        Add 'fase2 isi sampai 5 dokumen' $semua "total=$(Sql "SELECT jsonb_array_length(foto_jaminan) FROM members WHERE id=$mid;")"

        # 5) dokumen ke-6 ditolak. Catatan: Next & Go sama-sama membatasi index ke
        # 0-4 lebih dulu, jadi permintaan "tambah dokumen ke-6" (index=5) ditolak
        # sebelum cabang "Maksimal 5" tercapai. Yang dibuktikan: 400 + DB tetap 5.
        $sebelum = Sql "SELECT jsonb_array_length(foto_jaminan) FROM members WHERE id=$mid;"
        $r = Invoke-Upload $a @{ memberId = $mid; label = 'Lainnya'; index = '5' } $pngFile 'image/png'
        $sesudah = Sql "SELECT jsonb_array_length(foto_jaminan) FROM members WHERE id=$mid;"
        Add 'fase2 dokumen ke-6 ditolak, DB tetap 5' ($r.Status -eq 400 -and $sebelum -eq '5' -and $sesudah -eq '5') "status=$($r.Status) msg=$(Msg $r) sebelum=$sebelum sesudah=$sesudah"

        # 6) file 11 MiB ditolak
        $r = Invoke-Upload $a @{ memberId = $mid; label = 'Lainnya'; index = '4' } $bigFile 'image/png'
        Add 'fase2 11 MiB -> 400 ukuran' ($r.Status -eq 400 -and (Msg $r) -eq 'Ukuran file maksimal 10 MB.') "status=$($r.Status) msg=$(Msg $r)"
    }
}
catch { Add 'persiapan/eksekusi' $false $_.ToString() }
finally {
    try {
        Stop-Api
        if ($phase2Ran) {
            if ($script:mid) {
                # Hapus objek di prefix tenant/member uji saja (didaftar saat dibuat).
                foreach ($k in $script:ujiKeys) { [void](Remove-R2Key $k) }
                $sisa = 0
                foreach ($k in $script:ujiKeys) { if ((Test-R2Key $k) -ne 404) { $sisa++ } }
                Sql "DELETE FROM members WHERE id=$($script:mid);" | Out-Null
                Write-Host "Sisa objek uji: $sisa"
                Add 'fase2 bersihkan objek + member' ($sisa -eq 0 -and (Sql "SELECT count(*) FROM members WHERE id=$($script:mid);") -eq '0') "sisa=$sisa"
            }
        }
    }
    catch { Add 'cleanup' $false $_.ToString() }
    & (Join-Path $PSScriptRoot 'docker-staging.ps1') stop | Out-Null

    $hasil | Format-Table -AutoSize | Out-String -Width 220 | Write-Host
    $gagal = @($hasil | Where-Object Hasil -eq 'GAGAL')
    if ($gagal.Count -eq 0 -and $hasil.Count -ge 14) { Write-Host "Semua $($hasil.Count) skenario lolos"; exit 0 }
    Write-Host "Gagal: $($gagal.Count) dari $($hasil.Count) skenario"
    exit 1
}