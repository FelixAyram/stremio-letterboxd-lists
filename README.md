# Letterboxd Lists — Addon para Stremio

Convierte **cualquier lista publica de Letterboxd** en un catalogo de Stremio con metadatos completos (portada, fondo, descripcion, rating) y compatibilidad con otros addons (Torrentio, etc.) via IDs de IMDb.

## Requisitos

- [Node.js](https://nodejs.org/) 18+ (ya instalado en esta PC)
- Stremio **de escritorio** (recomendado) — la version web no carga addons localhost
- Listas **publicas** de Letterboxd (URL tipo `letterboxd.com/usuario/list/nombre/`)

## Inicio rapido

1. **`Iniciar-Addon.bat`** — deja la ventana abierta (servidor local)
2. **`Instalar-en-Stremio.bat`** — instala automatico en Stremio desktop

O manual en Stremio **escritorio**: Addons → **+** → `http://127.0.0.1:7731/manifest.json`

Configurar listas: **http://127.0.0.1:7731/configure.html**

## Por que falla en web.stremio.com?

`web.stremio.com` (HTTPS) no puede leer `http://127.0.0.1` — error "Failed to fetch". Usa la **app de escritorio** o `npm run launch-web` (staging.strem.io).

## Ejemplo de lista

```
https://letterboxd.com/ellefnning/list/for-when-you-want-to-feel-something/
```

## Como funciona

1. **Scraping** de la lista en Letterboxd (todas las paginas)
2. **Resolucion IMDb** via Cinemeta (API publica de Stremio)
3. **Catalogo** con IDs `tt...` → Stremio muestra ficha completa y otros addons encuentran streams

La primera carga de una lista grande (~180 pelis) puede tardar **2-5 minutos**. Despues queda en cache 6 horas (`data/cache/`).

## Comandos (SDK oficial Stremio)

```powershell
cd C:\Users\Administrator\Projects\stremio-letterboxd-lists
npm start                  # servidor
npm run install-stremio    # instala en Stremio desktop
npm run launch-web         # abre staging.strem.io
```

## Agregar mas listas

En `configure.html` podes agregar todas las URLs que quieras. Cada una = un catalogo en Stremio.

## Limitaciones

- Solo listas **publicas** (sin login Letterboxd)
- Letterboxd puede bloquear muchas requests; hay pausa entre paginas
- Si una peli no matchea en Cinemeta, no tendra streams (raro)
- El servidor debe estar **corriendo** en tu PC mientras uses Stremio

## Alternativas ya hosteadas

Si no queres self-hostear:
- [stremboxd.com](https://stremboxd.com/configure) — watchlist, diary, listas
- [letterboxd.almosteffective.com](https://letterboxd.almosteffective.com/) — listas (archivado)

Este addon es tuyo, local y configurable libremente.
