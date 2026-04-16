@echo off
setlocal

cd /d "%~dp0"

if not exist "node_modules" (
    echo Instalando dependencias...
    call npm install --legacy-peer-deps
    if errorlevel 1 (
        echo Error en npm install
        pause
        exit /b 1
    )
)

echo Lanzando dev server en background...
start "FixPerspective dev" /min cmd /c "npm run dev"

echo Esperando a que el server responda en http://localhost:3000 ...
:wait
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri http://localhost:3000 -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }"
if errorlevel 1 goto wait

echo Server listo. Abriendo navegador...
start "" "http://localhost:3000"

endlocal
