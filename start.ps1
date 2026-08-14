# ==========================================================
# EventTime Pro v4.0 - Script de Inicio Rápido para Windows
# ==========================================================

$port = 3000
$frontendPath = Join-Path $PSScriptRoot "frontend"
$backendPath = Join-Path $PSScriptRoot "backend"
$indexPath = Join-Path $frontendPath "index.html"
$url = "http://localhost:$port"

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "   ⏱  EventTime Pro v4.0 - Plataforma de Timing     " -ForegroundColor Yellow
Write-Host "====================================================" -ForegroundColor Cyan

# Check if Node.js is installed
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue

if ($nodeCmd) {
    Write-Host "[✓] Node.js detectado. Iniciando Backend REST API..." -ForegroundColor Green
    Set-Location $backendPath
    Start-Process -FilePath "node" -ArgumentList "server.js" -NoNewWindow
    Start-Sleep -Seconds 1
    Write-Host "[✓] Abriendo la aplicación en tu navegador: $url" -ForegroundColor Green
    Start-Process $url
} else {
    Write-Host "[i] Node.js no está instalado aún en el PATH del sistema." -ForegroundColor Yellow
    Write-Host "[✓] Abriendo Frontend directamente en tu navegador (Modo LocalStorage)..." -ForegroundColor Green
    Start-Process $indexPath
}

Write-Host "`nPara iniciar el backend REST completo, asegúrate de tener instalado Node.js." -ForegroundColor Gray
Write-Host "Repositorio Git: https://github.com/grmedios/Timming.git`n" -ForegroundColor DarkCyan
