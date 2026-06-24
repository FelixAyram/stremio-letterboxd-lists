@echo off
title Letterboxd Lists - Stremio Addon
cd /d "%~dp0"
set PATH=C:\Program Files\nodejs;%PATH%
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)
echo.
echo ============================================
echo  Addon Letterboxd para Stremio
echo ============================================
echo.
echo  1. Este script inicia el servidor local
echo  2. Para INSTALAR en Stremio ESCRITORIO:
echo     - Deja esta ventana abierta
echo     - En otra ventana ejecuta: npm run install-stremio
echo     - O pega en Stremio ^> Addons ^> + :
echo       http://127.0.0.1:7731/manifest.json
echo.
echo  IMPORTANTE: NO uses web.stremio.com con localhost.
echo  Usa la app de escritorio de Stremio.
echo.
node server.js
pause
