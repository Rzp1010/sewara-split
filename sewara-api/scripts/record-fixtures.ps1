# record-fixtures.ps1 â€” rekam kontrak respons backend Next (baseline) ke JSON.
#
#   .\scripts\record-fixtures.ps1
#
# Yang direkam adalah permukaan yang TIDAK bergantung data: status code dan bentuk
# amplop untuk request tanpa sesi, body kosong, dan validasi gagal. Ini yang paling
# sering melenceng saat port, dan bisa dibandingkan apa adanya dengan Go.
#
# Yang TIDAK direkam (dan tidak bisa): respons sukses berisi data. Go berjalan di
# database sendiri, jadi isi barisnya memang berbeda. Paritas jalur sukses diuji
# terpisah sebagai uji diferensial per route saat cutover.
#
# Skrip ini menyalakan server dev Next sendiri, merekam, lalu mematikannya, karena
# proses yang dijalankan dari shell akan ikut mati saat shell selesai.

param(
    [string]$OutFile = (Join-Path (Split-Path -Parent $PSScriptRoot) 'testdata\contracts\next-baseline.json')
)

$ErrorActionPreference = 'Stop'

$root      = Split-Path -Parent $PSScriptRoot
$backend   = (Resolve-Path (Join-Path $root '..\sewara-backend')).Path
$baseUrl   = 'http://127.0.0.1:4000'
$logOut    = Join-Path $env:TEMP 'opencode\record-next.out.log'
$logErr    = Join-Path $env:TEMP 'opencode\record-next.err.log'

# UUID tetap untuk path ber-parameter, supaya hasil rekaman bisa dibandingkan apa adanya.
$dummyId = '00000000-0000-0000-0000-000000000000'

function Get-Endpoints {
    $list = @()
    foreach ($f in (Get-ChildItem (Join-Path $backend 'app\api') -Recurse -Filter route.ts)) {
        $rel = $f.FullName.Substring((Join-Path $backend 'app\api').Length + 1)
        $p = '/api/' + ($rel -replace '[\\/]route\.ts$', '')
        $p = ($p -replace '\\', '/') -replace '\[([^\]]+)\]', $dummyId

        $txt = Get-Content -Raw -LiteralPath $f.FullName
        foreach ($m in [regex]::Matches($txt, 'export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b')) {
            $list += [pscustomobject]@{ Method = $m.Groups[1].Value; Path = $p }
        }
    }
    return $list
}

function Wait-Ready([int]$timeoutSeconds = 90) {
    for ($i = 0; $i -lt ($timeoutSeconds / 2); $i++) {
        Start-Sleep -Seconds 2
        $code = (curl.exe -s -o $null -w '%{http_code}' --max-time 3 "$baseUrl/api/auth/me")
        if ($code -ne '000') { return $i * 2 }
    }
    throw "Server dev tidak siap setelah $timeoutSeconds detik. Lihat $logOut"
}

$endpoints = Get-Endpoints | Sort-Object Path, Method -Unique
Write-Host "Endpoint ditemukan: $($endpoints.Count)"

Write-Host 'Menyalakan server dev Next...'
$server = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm run dev' -WorkingDirectory $backend `
    -PassThru -WindowStyle Hidden -RedirectStandardOutput $logOut -RedirectStandardError $logErr

try {
    $secs = Wait-Ready
    Write-Host "Server siap setelah $secs detik."

    $cases = @()
    foreach ($e in $endpoints) {
        $headers = @{}
        $body = $null
        if ($e.Method -ne 'GET') { $body = '{}' }

        $curlArgs = @('-s', '--max-time', '20', '-X', $e.Method, '-o', "$env:TEMP\opencode\resp.bin", '-w', '%{http_code}|%{content_type}')
        $curlArgs += @($baseUrl + $e.Path)
        if ($body) { $curlArgs += @('-H', 'Content-Type: application/json', '--data', $body) }

        $meta = (curl.exe @curlArgs)
        $status = ($meta -split '\|')[0]
        if ($status -match '^(\d+)') { $status = [int]$Matches[1] } else { $status = 0 }
        $ctype = if ($meta -match '\|(.+)$') { $Matches[1] } else { '' }

        $raw = Get-Content "$env:TEMP\opencode\resp.bin" -Raw -ErrorAction SilentlyContinue
        $json = $null
        if ($ctype -match 'application/json' -and $raw) {
            try { $json = $raw | ConvertFrom-Json } catch { $json = $null }
        }

        $cases += [pscustomobject]@{
            method      = $e.Method
            path        = $e.Path
            status      = $status
            contentType = $ctype
            body        = $json
            # Hanya diisi kalau responsnya bukan JSON (mis. halaman 404 Next).
            nonJson     = if (-not $json) { 'bukan JSON' } else { $null }
        }
    }

    $doc = [pscustomobject]@{
        description = 'Kontrak respons backend Next (baseline) untuk request tanpa sesi/body kosong.'
        recordedAt  = (Get-Date -Format 'yyyy-MM-dd')
        baseUrl     = $baseUrl
        cases       = $cases
    }

    $dir = Split-Path -Parent $OutFile
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $doc | ConvertTo-Json -Depth 12 | Set-Content -Path $OutFile -Encoding UTF8

    Write-Host ''
    $cases | Group-Object status | Sort-Object Name | ForEach-Object {
        Write-Host ("  HTTP {0}: {1} endpoint" -f $_.Name, $_.Count)
    }
    Write-Host ''
    Write-Host "Ditulis ke $OutFile"
}
finally {
    if ($server -and -not $server.HasExited) { taskkill /PID $server.Id /T /F 2>&1 | Out-Null }
    Write-Host 'Server dimatikan.'
}

