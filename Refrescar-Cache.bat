@echo off
title Refrescar cache de listas
cd /d "%~dp0"
set PATH=C:\Program Files\nodejs;%PATH%
if exist data\cache rmdir /s /q data\cache
echo Cache borrada. Reinicia Iniciar-Addon.bat para recargar listas.
pause
