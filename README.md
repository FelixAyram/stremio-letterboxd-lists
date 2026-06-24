# Letterboxd Lists — Addon para Stremio

Convierte **cualquier lista publica de Letterboxd** en un catalogo de Stremio con metadatos completos y compatibilidad con Torrentio via IMDb.

**Portadas:** usa las de Letterboxd (`letterboxd.com/film/.../image-230/`), no metahub.space.

## Requisitos

- Node.js 18+
- Stremio desktop (PC) o app Android en la misma WiFi
- Listas publicas de Letterboxd

## Inicio rapido

1. `npm install`
2. Copia `data/lists.json.example` → `data/lists.json` y edita tus listas
3. `Iniciar-Addon.bat` (deja abierto)
4. **PC:** `http://127.0.0.1:7731/manifest.json` en Stremio → Addons → +
5. **Android:** `http://TU-IP-LOCAL:7731/manifest.json` (ej. `192.168.1.12`)
6. Si Android no conecta: `Abrir-Firewall.bat` como admin

Tras actualizar portadas: `Refrescar-Cache.bat` + reiniciar servidor.

## Subir a GitHub

```powershell
cd C:\Users\Administrator\Projects\stremio-letterboxd-lists
gh auth login
gh repo create stremio-letterboxd-lists --public --source=. --push
```

## Como funciona

1. Scraping de la lista en Letterboxd (todas las paginas)
2. Resolucion IMDb via Cinemeta + fallback Letterboxd
3. Portadas desde Letterboxd (mismas que ves en la lista)
4. Catalogo con IDs `tt...` para metadatos y streams

## Limitaciones

- Solo listas **publicas**
- Servidor local debe estar corriendo (o deploy en VPS / BeamUp)
- `web.stremio.com` no funciona con HTTP local (usa desktop o tunnel HTTPS)

## Licencia

MIT
