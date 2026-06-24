@echo off
title Letterboxd Addon + Tunnel HTTPS (para Stremio Web)
cd /d "%~dp0"
set PATH=C:\Program Files\nodejs;%PATH%

echo.
echo  Para usar Stremio WEB necesitas URL HTTPS (no localhost).
echo  Este script crea un tunel publico hacia tu addon local.
echo.

start "Addon Server" cmd /k "node server.js"
timeout /t 4 /nobreak >nul

echo Iniciando tunel HTTPS...
echo Cuando aparezca la URL, copia:  https://XXXX.loca.lt/manifest.json
echo e instalala en web.stremio.com ^> Addons ^> +
echo.
npx --yes localtunnel --port 7731
