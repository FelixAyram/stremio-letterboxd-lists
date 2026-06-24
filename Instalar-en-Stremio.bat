@echo off
cd /d "%~dp0"
set PATH=C:\Program Files\nodejs;%PATH%
echo Abriendo Stremio Desktop para instalar addon...
start "" "C:\Users\Administrator\Projects\stremio-letterboxd-lists\Iniciar-Addon.bat"
timeout /t 5 /nobreak >nul
call npm run install-stremio
echo.
echo Si Stremio no abrio, instala la app desde https://www.stremio.com/downloads
echo Luego pega en Addons ^> + : http://127.0.0.1:7731/manifest.json
pause
