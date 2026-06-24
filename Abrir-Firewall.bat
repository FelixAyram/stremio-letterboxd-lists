@echo off
title Abrir puerto 7731 en Firewall
netsh advfirewall firewall add rule name="Stremio Letterboxd Addon" dir=in action=allow protocol=TCP localport=7731 2>nul
if %errorlevel%==0 (
  echo Regla de firewall agregada para puerto 7731.
) else (
  echo No se pudo agregar regla. Ejecuta como Administrador.
)
pause
