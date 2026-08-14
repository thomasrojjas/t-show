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
Write-Host "   ⏱  EventTime Pro v4.0 - Servidor Local Activo" -ForegroundColor Yellow
Write-Host "   📡 Acceso Web: $prefix" -ForegroundColor Green
Write-Host "   🔌 API REST:   ${prefix}api/projects" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Cyan

$dataFilePath = Join-Path $baseDir "backend\data\projects.json"
$frontendDir = Join-Path $baseDir "frontend"
$utf8 = [System.Text.Encoding]::UTF8

$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
}

function Read-ProjectsRaw {
    if (Test-Path $dataFilePath) {
        return [System.IO.File]::ReadAllText($dataFilePath, $utf8)
    }
    return "{}"
}

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        # CORS Headers
        $response.AddHeader("Access-Control-Allow-Origin", "*")
        $response.AddHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        $response.AddHeader("Access-Control-Allow-Headers", "Content-Type")

        if ($request.HttpMethod -eq "OPTIONS") {
            $response.StatusCode = 204
            $response.Close()
            continue
        }

        $urlPath = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath)

        # API Endpoints
        if ($urlPath -eq "/api/health") {
            $response.ContentType = "application/json; charset=utf-8"
            $jsonResp = "{ `"status`": `"ok`", `"server`": `"PowerShell REST Server (UTF-8)`", `"time`": `"$((Get-Date).ToString("o"))`" }"
            $buffer = $utf8.GetBytes($jsonResp)
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.Close()
            continue
        }

        if ($urlPath -eq "/api/projects" -and $request.HttpMethod -eq "GET") {
            $response.ContentType = "application/json; charset=utf-8"
            $rawContent = Read-ProjectsRaw
            $respData = "{ `"success`": true, `"data`": $rawContent }"
            $buffer = $utf8.GetBytes($respData)
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.Close()
            continue
        }

        if ($urlPath -eq "/api/projects" -and $request.HttpMethod -eq "POST") {
            $reader = New-Object System.IO.StreamReader($request.InputStream, $utf8)
            $body = $reader.ReadToEnd()
            $reader.Close()

            $newProj = $body | ConvertFrom-Json
            $rawContent = Read-ProjectsRaw
            $existing = if ($rawContent -and $rawContent -ne "{}") { $rawContent | ConvertFrom-Json } else { [PSCustomObject]@{} }

            $name = $newProj.eventName
            $existing | Add-Member -MemberType NoteProperty -Name $name -Value $newProj -Force
            
            $jsonToSave = $existing | ConvertTo-Json -Depth 10
            [System.IO.File]::WriteAllText($dataFilePath, $jsonToSave, $utf8)

            $response.ContentType = "application/json; charset=utf-8"
            $respData = "{ `"success`": true, `"message`": `"Proyecto guardado exitosamente`" }"
            $buffer = $utf8.GetBytes($respData)
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.Close()
            continue
        }

        if ($urlPath.StartsWith("/api/projects/") -and $request.HttpMethod -eq "DELETE") {
            $projName = $urlPath.Substring(14)
            $rawContent = Read-ProjectsRaw
            $existing = if ($rawContent -and $rawContent -ne "{}") { $rawContent | ConvertFrom-Json } else { [PSCustomObject]@{} }
            
            if ($existing.PSObject.Properties[$projName]) {
                $existing.PSObject.Properties.Remove($projName)
                $jsonToSave = $existing | ConvertTo-Json -Depth 10
                [System.IO.File]::WriteAllText($dataFilePath, $jsonToSave, $utf8)
                $response.ContentType = "application/json; charset=utf-8"
                $respData = "{ `"success`": true, `"message`": `"Proyecto '$projName' eliminado`" }"
                $buffer = $utf8.GetBytes($respData)
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
            } else {
                $response.StatusCode = 404
            }
            $response.Close()
            continue
        }

        # Static File Serving
        $relPath = if ($urlPath -eq "/") { "index.html" } else { $urlPath.TrimStart("/") }
        $filePath = Join-Path $frontendDir $relPath

        if (!(Test-Path $filePath) -or (Get-Item $filePath).PSIsContainer) {
            $filePath = Join-Path $frontendDir "index.html"
        }

        if (Test-Path $filePath) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $mime = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
            $response.ContentType = $mime
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
        }
        $response.Close()
    } catch {
        # Continue loop on error
    }
}
