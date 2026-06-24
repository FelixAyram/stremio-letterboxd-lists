# Letterboxd Lists — Addon para Stremio

Convierte **cualquier lista publica de Letterboxd** en un catalogo de Stremio con metadatos IMDb y **portadas identicas a Letterboxd** (`a.ltrbxd.com`).

## Requisitos

- Node.js 18+
- Stremio (desktop, Android o TV)
- Listas publicas de Letterboxd

## Uso local (PC encendida)

1. `npm install`
2. Copia `data/lists.json.example` → `data/lists.json` y edita tus listas
3. `Iniciar-Addon.bat`
4. **PC:** `http://127.0.0.1:7731/manifest.json` en Stremio → Addons → +
5. **Android/TV:** `http://TU-IP-LOCAL:7731/manifest.json` (misma WiFi)
6. Si no conecta: `Abrir-Firewall.bat` como admin

Tras actualizar portadas: `Refrescar-Cache.bat` + reiniciar servidor.

## Servidor en la nube (sin PC encendida)

GitHub solo guarda el codigo; el servidor corre en **Render.com** (gratis).

### Paso 1 — Subir a GitHub

```powershell
cd C:\Users\Administrator\Projects\stremio-letterboxd-lists
gh auth login
gh repo create stremio-letterboxd-lists --public --source=. --push
```

### Paso 2 — Desplegar en Render

1. Entra en [render.com](https://render.com) y crea cuenta (puedes usar “Sign in with GitHub”)
2. **New → Blueprint** (o **Web Service**)
3. Conecta el repo `stremio-letterboxd-lists`
4. Render detecta `render.yaml` automaticamente
5. En **Environment**, edita `LISTS_JSON` con tus listas:

```json
{"lists":[{"url":"https://letterboxd.com/USUARIO/list/NOMBRE-LISTA/","name":"Mi lista","id":"list-nombre-lista"}]}
```

6. Deploy. Tu URL sera algo como:

```
https://stremio-letterboxd-lists.onrender.com/manifest.json
```

7. En Stremio (cualquier dispositivo): Addons → + → pega esa URL HTTPS

**Nota:** el plan gratis de Render “duerme” tras ~15 min sin uso; la primera peticion tarda ~30 s en despertar.

### Alternativa: BeamUp (comunidad Stremio)

```powershell
npm install -g beamup-cli
beamup
```

Sigue las instrucciones; obtienes una URL `https://xxx.baby-beamup.club/manifest.json`.

## Como funciona

1. Scraping de la lista en Letterboxd (todas las paginas)
2. Por cada pelicula: portada real desde `a.ltrbxd.com/resized/film-poster/...`
3. Resolucion IMDb via Cinemeta + fallback pagina de Letterboxd
4. Catalogo con IDs `tt...` para metadatos y streams (Torrentio, etc.)

## Limitaciones

- Solo listas **publicas**
- Primera carga de una lista grande puede tardar varios minutos
- `web.stremio.com` no acepta addons HTTP locales (usa HTTPS en la nube o Stremio desktop)

## Licencia

MIT
