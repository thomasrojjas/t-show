@echo off
title EventTime Pro v4.0 - Gestor de Timing
echo ====================================================
echo    EventTime Pro v4.0 - Plataforma de Timing
echo ====================================================
echo.

where node >nul 2>nul
if %errorlevel% equ 0 (
    echo [OK] Iniciando Backend con Node.js en http://localhost:3000
    cd backend
    start /B node server.js
    timeout /t 2 /nobreak >nul
    start http://localhost:3000
) else (
    echo [INFO] Node.js no detectado. Abriendo interfaz directa en navegador...
    start "" "frontend\index.html"
)

echo.
echo Presione cualquier tecla para salir...
pause >nul
