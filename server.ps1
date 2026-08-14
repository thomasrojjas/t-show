$port = 3000
$prefix = "http://localhost:$port/"
$baseDir = $PSScriptRoot

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
} catch {
    $port = 8080
    $prefix = "http://localhost:$port/"
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add($prefix)
    $listener.Start()
}

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "   EventTime Pro v4.0 - Servidor Local Activo" -ForegroundColor Yellow
Write-Host "   Acceso Web: $prefix" -ForegroundColor Green
Write-Host "   API REST:   $($prefix)api/projects" -ForegroundColor Green
Write-Host "   Live API:   $($prefix)api/live" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Cyan

$dataFilePath = Join-Path $baseDir "backend\data\projects.json"
$liveFilePath = Join-Path $baseDir "backend\data\live_sessions.json"
$frontendDir = Join-Path $baseDir "frontend"
$utf8 = [System.Text.Encoding]::UTF8

$mimeTypes = @{
    html = 'text/html; charset=utf-8'
    css  = 'text/css; charset=utf-8'
    js   = 'application/javascript; charset=utf-8'
    json = 'application/json; charset=utf-8'
    png  = 'image/png'
    jpg  = 'image/jpeg'
    svg  = 'image/svg+xml'
    ico  = 'image/x-icon'
}

function Send-JsonResponse($resp, $obj, $code) {
    if (-not $code) { $code = 200 }
    $resp.StatusCode = $code
    $resp.ContentType = "application/json; charset=utf-8"
    $json = $obj | ConvertTo-Json -Depth 10 -Compress
    $bytes = $utf8.GetBytes($json)
    $resp.OutputStream.Write($bytes, 0, $bytes.Length)
    $resp.Close()
}

function Read-ProjectsObj {
    if (Test-Path $dataFilePath) {
        $raw = [System.IO.File]::ReadAllText($dataFilePath, $utf8)
        if ($raw -and $raw.Trim() -ne "{}") {
            return ($raw | ConvertFrom-Json)
        }
    }
    return ([PSCustomObject]@{})
}

function Read-LiveObj {
    if (Test-Path $liveFilePath) {
        $raw = [System.IO.File]::ReadAllText($liveFilePath, $utf8)
        if ($raw -and $raw.Trim() -ne "{}") {
            return ($raw | ConvertFrom-Json)
        }
    }
    return ([PSCustomObject]@{})
}

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $response.AddHeader("Access-Control-Allow-Origin", "*")
        $response.AddHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        $response.AddHeader("Access-Control-Allow-Headers", "Content-Type")

        if ($request.HttpMethod -eq "OPTIONS") {
            $response.StatusCode = 204
            $response.Close()
            continue
        }

        $urlPath = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath)

        # Health
        if ($urlPath -eq "/api/health") {
            Send-JsonResponse $response @{ status = "ok"; server = "PowerShell REST Server" }
            continue
        }

        # Projects GET
        if ($urlPath -eq "/api/projects" -and $request.HttpMethod -eq "GET") {
            $data = Read-ProjectsObj
            Send-JsonResponse $response @{ success = $true; data = $data }
            continue
        }

        # Projects POST
        if ($urlPath -eq "/api/projects" -and $request.HttpMethod -eq "POST") {
            $reader = New-Object System.IO.StreamReader($request.InputStream, $utf8)
            $body = $reader.ReadToEnd()
            $reader.Close()

            $newProj = $body | ConvertFrom-Json
            $existing = Read-ProjectsObj
            $name = $newProj.eventName
            $existing | Add-Member -MemberType NoteProperty -Name $name -Value $newProj -Force
            
            $jsonToSave = $existing | ConvertTo-Json -Depth 10
            [System.IO.File]::WriteAllText($dataFilePath, $jsonToSave, $utf8)

            Send-JsonResponse $response @{ success = $true; message = "Proyecto guardado exitosamente" }
            continue
        }

        # Projects DELETE
        if ($urlPath.StartsWith("/api/projects/") -and $request.HttpMethod -eq "DELETE") {
            $projName = $urlPath.Substring(14)
            $existing = Read-ProjectsObj
            if ($existing.PSObject.Properties[$projName]) {
                $existing.PSObject.Properties.Remove($projName)
                $jsonToSave = $existing | ConvertTo-Json -Depth 10
                [System.IO.File]::WriteAllText($dataFilePath, $jsonToSave, $utf8)
                Send-JsonResponse $response @{ success = $true; message = "Proyecto eliminado" }
            } else {
                Send-JsonResponse $response @{ success = $false; message = "No encontrado" } 404
            }
            continue
        }

        # Live GET
        if ($urlPath -eq "/api/live" -and $request.HttpMethod -eq "GET") {
            $queryProj = $request.QueryString["project"]
            $allLive = Read-LiveObj
            if ($queryProj) {
                $projData = $null
                if ($allLive.PSObject.Properties[$queryProj]) {
                    $projData = $allLive.$queryProj
                }
                Send-JsonResponse $response @{ success = $true; data = $projData }
            } else {
                Send-JsonResponse $response @{ success = $true; data = $allLive }
            }
            continue
        }

        # Live POST
        if ($urlPath -eq "/api/live" -and $request.HttpMethod -eq "POST") {
            $reader = New-Object System.IO.StreamReader($request.InputStream, $utf8)
            $body = $reader.ReadToEnd()
            $reader.Close()

            $livePayload = $body | ConvertFrom-Json
            $projectName = $livePayload.projectName

            if ($projectName) {
                $existingLive = Read-LiveObj
                $existingLive | Add-Member -MemberType NoteProperty -Name $projectName -Value $livePayload -Force
                $jsonToSave = $existingLive | ConvertTo-Json -Depth 10
                [System.IO.File]::WriteAllText($liveFilePath, $jsonToSave, $utf8)
                Send-JsonResponse $response @{ success = $true; message = "Estado en vivo actualizado" }
            } else {
                Send-JsonResponse $response @{ success = $false; message = "Falta projectName" } 400
            }
            continue
        }

        # Static Files
        $cleanPath = $urlPath.TrimStart("/")
        if (-not $cleanPath) {
            $cleanPath = "index.html"
        }
        $filePath = Join-Path $frontendDir $cleanPath

        if (!(Test-Path $filePath) -or (Get-Item $filePath).PSIsContainer) {
            $filePath = Join-Path $frontendDir "index.html"
        }

        if (Test-Path $filePath) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower().TrimStart(".")
            $mime = "application/octet-stream"
            if ($mimeTypes.ContainsKey($ext)) {
                $mime = $mimeTypes[$ext]
            }
            $response.ContentType = $mime
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
        }
        $response.Close()
    } catch {
        # Loop safety
    }
}