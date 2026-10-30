# smoke-pembayaran.ps1 — uji endpoint pembayaran pada Docker staging saja.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$apiExe = Join-Path $root '.data\bin\sewara-api.exe'
$apiURL = 'http://127.0.0.1:8099'
$tmpDir = Join-Path $env:TEMP 'opencode'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$env:PATH = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:PATH"
# Nama variabel UUID sengaja TIDAK satu huruf: PowerShell tidak membedakan
# besar-kecil huruf, jadi `$A` akan tertimpa oleh cookie `$a` (token sesi) dan
# SQL berikutnya gagal dengan "invalid input syntax for type uuid".
$OWNER_A='a0000000-0000-0000-0000-000000000001'; $OWNER_B='b0000000-0000-0000-0000-000000000001'; $OWNER_STAFF='a0000000-0000-0000-0000-000000000002'
function Sql([string]$q) { $o=docker exec sewara-staging-db psql -U sewara -d sewara -At -c $q; if($LASTEXITCODE -ne 0){throw "psql gagal: $q"}; return ($o -join "`n").Trim() }
function Invoke-Api([string]$method,[string]$path,[string]$cookie,[string]$body) { $f=Join-Path $tmpDir 'pembayaran-resp.txt'; $a=@('-s','--max-time','20','-o',$f,'-w','%{http_code}','-X',$method); if($cookie){$a+=@('-H',"Cookie: sewara_session=$cookie")}; if($body){$bf=Join-Path $tmpDir 'pembayaran-body.json'; [IO.File]::WriteAllText($bf,$body,[Text.UTF8Encoding]::new($false)); $a+=@('-H','Content-Type: application/json','--data-binary',"@$bf")}; $a+="$apiURL$path"; $s=[int](curl.exe @a); return @{Status=$s;Body=(Get-Content $f -Raw -ErrorAction SilentlyContinue)} }
function Get-SessionCookie([string]$email) { $jar=Join-Path $tmpDir 'pembayaran-cookie.txt'; $body=Join-Path $tmpDir 'pembayaran-login.json'; [IO.File]::WriteAllText($body,"{`"email`":`"$email`",`"password`":`"Rahasia123`"}",[Text.UTF8Encoding]::new($false)); $s=[int](curl.exe -s -o NUL -w '%{http_code}' -c $jar -H 'Content-Type: application/json' --data-binary "@$body" "$apiURL/api/auth/login"); if($s-ne 200){throw "Login $email gagal HTTP $s"}; if((Get-Content $jar -Raw)-match 'sewara_session\s+([^\s]+)'){return $Matches[1]}; throw 'Cookie hilang' }
function Add([string]$n,[bool]$ok,[string]$info) { $script:hasil+= [pscustomobject]@{Skenario=$n;Hasil=$(if($ok){'LOLOS'}else{'GAGAL'});Info=$info} }
function Msg($r){($r.Body|ConvertFrom-Json).error.message}; function Code($r){($r.Body|ConvertFrom-Json).error.code}
$hasil=@();$api=$null;$baseline=''
try {
 Push-Location $root; go build -o $apiExe ./cmd/api; Pop-Location; if($LASTEXITCODE-ne 0){throw 'go build gagal'}
 & (Join-Path $PSScriptRoot 'docker-staging.ps1') reset | Out-Null; & (Join-Path $PSScriptRoot 'docker-staging.ps1') start | Out-Null
 $hash='$2a$10$GCmHsmqVk3cqwXmf0AVWueY8h0JHD1zo0mr.tl0F/CH0dI/01mYEu'
 Sql "INSERT INTO auth.users(id,email,encrypted_password,email_confirmed_at) VALUES ('$OWNER_A','owner-a@staging.local','$hash',now()),('$OWNER_STAFF','cs-a@staging.local','$hash',now()),('$OWNER_B','owner-b@staging.local','$hash',now()) ON CONFLICT(id) DO UPDATE SET encrypted_password='$hash',email_confirmed_at=now();" | Out-Null
 $baseline=Sql "SELECT coalesce(string_agg(key||'='||coalesce(value,'NULL'),',' ORDER BY key),'') FROM settings WHERE user_id='$OWNER_A';"
 $env:DATABASE_URL='postgres://sewara:sewara123@127.0.0.1:5433/sewara?sslmode=disable';$env:ADDR='127.0.0.1:8099';$env:APP_ENV='development';$env:R2_ENDPOINT='';$env:R2_ACCESS_KEY_ID='';$env:R2_SECRET_ACCESS_KEY='';$env:R2_BUCKET=''; $env:R2_BUCKET_NAME='';$env:PURGE_SECRET='smoke-purge-secret'
 $ls=@(Get-NetTCPConnection -LocalPort 8099 -State Listen -ErrorAction SilentlyContinue); foreach($l in $ls){Stop-Process -Id $l.OwningProcess -Force -ErrorAction SilentlyContinue}; $api=Start-Process $apiExe -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $tmpDir 'pembayaran-api.out') -RedirectStandardError (Join-Path $tmpDir 'pembayaran-api.err')
 $ready=$false;for($i=0;$i -lt 40;$i++){Start-Sleep -Milliseconds 300;if((curl.exe -s -o NUL -w '%{http_code}' "$apiURL/api/health")-eq '200'){$ready=$true;break}};if(!$ready){throw 'API tidak siap'}
 $a=Get-SessionCookie 'owner-a@staging.local';$b=Get-SessionCookie 'owner-b@staging.local';$cs=Get-SessionCookie 'cs-a@staging.local'
 # purge tidak dibungkus requireAuth (hanya secret), jadi tidak diuji di sini —
 # cabang 401-nya diuji lewat skenario "purge tanpa secret".
 foreach($x in @(@('GET','/api/pembayaran/export'),@('GET','/api/pembayaran/photo'),@('GET','/api/pembayaran/reminder'),@('POST','/api/pembayaran/reminder-ack'),@('POST','/api/pembayaran/upload'))){$r=Invoke-Api $x[0] $x[1] '' $null;Add "tanpa cookie $($x[1])" ($r.Status-eq 401 -and (Code $r)-eq 'UNAUTHORIZED') $r.Body}
 $r=Invoke-Api POST '/api/pembayaran/purge' '' $null;Add 'purge tanpa secret' ($r.Status-eq 401 -and $r.Body -match '"ok":false' -and $r.Body -match '"message":"Unauthorized"') $r.Body
 foreach($q in @('','?bulan=2026-13','?bulan=oktober')){$r=Invoke-Api GET "/api/pembayaran/export$q" $a $null;Add "export invalid $q" ($r.Status-eq 400 -and (Code $r)-eq 'VALIDATION_ERROR' -and (Msg $r)-eq 'Parameter bulan tidak valid. Format: YYYY-MM.') $r.Body}
 $r=Invoke-Api GET '/api/pembayaran/export?bulan=2026-10' $a $null;$j=$r.Body|ConvertFrom-Json;Add 'export kosong' ($r.Status-eq 200 -and $j.ok-eq $false -and $j.message-eq 'Tidak ada bukti bayar untuk bulan tersebut.') $r.Body
 $r=Invoke-Api GET '/api/pembayaran/photo' $a $null;Add 'photo tanpa path' ($r.Status-eq 400 -and (Msg $r)-eq 'Parameter path wajib diisi.') $r.Body
 $r=Invoke-Api GET "/api/pembayaran/photo?path=bukti-bayar/$OWNER_B/x.jpg" $a $null;Add 'photo tenant lain' ($r.Status-eq 400 -and (Msg $r)-eq 'Path tidak valid.') $r.Body
 $r=Invoke-Api GET "/api/pembayaran/photo?path=bukti-bayar/$OWNER_A/x.jpg" $a $null;Add 'photo storage off' ($r.Status-eq 503 -and (Msg $r)-eq 'Penyimpanan berkas belum dikonfigurasi di server ini.') $r.Body
 $f=Join-Path $tmpDir 'purge-response.txt';$st=[int](curl.exe -s -o $f -w '%{http_code}' -X POST -H 'x-purge-secret: wrong' "$apiURL/api/pembayaran/purge");$body=Get-Content $f -Raw;Add 'purge secret salah' ($st-eq 401 -and $body -match 'Unauthorized') $body
 $st=[int](curl.exe -s -o $f -w '%{http_code}' -X POST -H 'x-purge-secret: smoke-purge-secret' "$apiURL/api/pembayaran/purge");$body=Get-Content $f -Raw;Add 'purge storage off' ($st-eq 503 -and $body -match 'Penyimpanan berkas belum dikonfigurasi') $body
 $nowWib=[DateTimeOffset]::UtcNow.ToOffset([TimeSpan]::FromHours(7));$r=Invoke-Api GET '/api/pembayaran/reminder' $a $null;if($nowWib.Day-lt 8 -or $nowWib.Day-gt 15){$j=$r.Body|ConvertFrom-Json;Add 'reminder di luar window' ($r.Status-eq 200 -and $j.data.show-eq $false -and $j.data.PSObject.Properties.Count-eq 1) $r.Body}else{Add 'reminder window (dilewati)' $true 'Hari WIB 8–15; respons bergantung transaksi seed.'}
 foreach($body in @('{}','{"bulan":"oktober"}')){$r=Invoke-Api POST '/api/pembayaran/reminder-ack' $a $body;Add 'ack invalid' ($r.Status-eq 400 -and (Msg $r)-eq 'Parameter bulan tidak valid. Format: YYYY-MM.') $r.Body}
 $r=Invoke-Api POST '/api/pembayaran/reminder-ack' $cs '{"bulan":"2026-10"}';$aa=Sql "SELECT user_id::text||':'||value FROM settings WHERE user_id='$OWNER_A' AND key='bukti_backup_ack'";$bb=Sql "SELECT count(*) FROM settings WHERE user_id='$OWNER_B' AND key='bukti_backup_ack'";Add 'ack staf owner tenant + isolasi B' ($r.Status-eq 200 -and $r.Body -match '"data":\{"ok":true\}' -and $aa-eq "$OWNER_A`:2026-10" -and $bb-eq '0') "$($r.Body) DB=$aa B=$bb"
 $r=Invoke-Api POST '/api/pembayaran/upload' $a $null;Add 'upload tanpa file' ($r.Status-eq 400 -and (Msg $r)-eq 'File atau transaksi ID tidak valid.') $r.Body
 # Transaksi seed milik tenant A supaya cabang "transaksi ada + storage off" bisa diuji.
 # id 9001 (bigint) — frontend mengirim transactions.id, bukan id_transaksi.
 Sql "INSERT INTO transactions (id,penyewa,hp_penyewa,status,items,user_id,total_akhir,member_id,created_at,updated_at) VALUES (9001,'Penyewa Smoke','081100000099','Booking','[]','$OWNER_A',10000,1,now(),now());" | Out-Null
 # multipart memakai CRLF nyata, bukan string kutip-tunggal berisi escape literal.
 $crlf="`r`n";$mp=Join-Path $tmpDir 'pay-multipart.bin';$out=Join-Path $tmpDir 'pay-upload.out'
 function Upload([string]$tid){ $pl=@('--bound','Content-Disposition: form-data; name="file"; filename="a.png"','Content-Type: image/png','','abc','--bound','Content-Disposition: form-data; name="transaksiId"','',$tid,'--bound--','') -join $crlf; [IO.File]::WriteAllBytes($mp,[Text.Encoding]::ASCII.GetBytes($pl)); return [int](curl.exe -s -o $out -w '%{http_code}' -H "Cookie: sewara_session=$a" -H 'Content-Type: multipart/form-data; boundary=bound' --data-binary "@$mp" "$apiURL/api/pembayaran/upload") }
 $st=Upload 'bukan-angka';$body=Get-Content $out -Raw;Add 'upload id bukan angka' ($st-eq 400 -and $body -match 'File atau transaksi ID tidak valid.') $body
 $st=Upload '999999';$body=Get-Content $out -Raw;Add 'upload transaksi tidak ada' ($st-eq 404 -and $body -match 'Transaksi tidak ditemukan.') $body
 $st=Upload '9001';$body=Get-Content $out -Raw;Add 'upload transaksi ada + storage off' ($st-eq 503 -and $body -match 'Penyimpanan berkas belum dikonfigurasi di server ini.') $body
}
catch { Write-Error $_; Add 'persiapan/eksekusi' $false $_.ToString() }
finally {
 try { if($api -and -not $api.HasExited){Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue}; if($baseline -ne ''){Sql "DELETE FROM settings WHERE user_id='$OWNER_A' AND key='bukti_backup_ack';" | Out-Null; $after=Sql "SELECT coalesce(string_agg(key||'='||coalesce(value,'NULL'),',' ORDER BY key),'') FROM settings WHERE user_id='$OWNER_A';"; Add 'settings tenant A kembali seed' ($after-eq $baseline) "baseline=$baseline after=$after" } } catch { Add 'cleanup settings' $false $_.ToString() }
 & (Join-Path $PSScriptRoot 'docker-staging.ps1') stop | Out-Null
 $hasil | Format-Table -AutoSize | Out-String -Width 240 | Write-Host; $g=@($hasil|Where-Object Hasil -eq 'GAGAL'); if($g.Count-eq 0 -and $hasil.Count-ge 20){Write-Host "Semua $($hasil.Count) skenario lolos";exit 0};Write-Host "Gagal: $($g.Count) dari $($hasil.Count) skenario";exit 1
}
