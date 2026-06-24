const path = require('path');
const express = require('express');
const cors = require('cors');
const opn = require('opn');
const { getRouter } = require('stremio-addon-sdk');
const { getInterface, buildManifest, preloadLists, clearRuntimeCache } = require('./addon');
const { fetchFullList, normalizeListUrl, listIdFromUrl } = require('./src/letterboxd');
const { readLists, writeLists } = require('./src/store');

const PORT = process.env.PORT || 7731;
const HOST = process.env.HOST || '0.0.0.0';

function getLanIp() {
  const { networkInterfaces } = require('os');
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

let addonInterface = getInterface();

const app = express();

// CORS obligatorio — Stremio Web exige este header en TODAS las rutas
app.use(cors({ origin: '*', methods: ['GET', 'HEAD', 'OPTIONS'] }));
app.options('*', cors());

const sendCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
};
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Manifest dinamico (actualiza al agregar listas sin reiniciar)
app.get('/manifest.json', (req, res) => {
  sendCors(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(buildManifest()));
});

app.use(getRouter(addonInterface));

app.get('/configure.html', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});

function manifestUrl(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}/manifest.json`;
}

app.get('/api/info', (req, res) => {
  const url = manifestUrl(req);
  res.json({ manifestUrl: url, configureUrl: url.replace('/manifest.json', '/configure.html') });
});

app.get('/api/lists', (_, res) => res.json(readLists()));

app.post('/api/lists', (req, res) => {
  const lists = (req.body.lists || [])
    .filter((l) => l.url && l.url.includes('letterboxd.com'))
    .map((l) => {
      const url = normalizeListUrl(l.url);
      return { url, name: (l.name || '').trim() || undefined, id: listIdFromUrl(url) };
    });

  if (!lists.length) return res.status(400).json({ error: 'Agrega al menos una URL de Letterboxd' });

  writeLists({ lists });
  clearRuntimeCache();
  addonInterface = getInterface();

  res.json({ ok: true, lists, manifest: manifestUrl(req) });
});

app.get('/api/preview', async (req, res) => {
  if (!req.query.url) return res.status(400).json({ error: 'url requerida' });
  try {
    const list = await fetchFullList(req.query.url);
    res.json({ title: list.title, count: list.films.length, id: list.id, sample: list.films.slice(0, 8) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (_, res) => {
  res.redirect('/configure.html');
});

const server = app.listen(PORT, HOST, () => {
  console.log('');
  console.log('  Letterboxd Lists — Addon Stremio v1.3');
  console.log('  =====================================');
  if (process.env.RENDER_EXTERNAL_URL) {
    console.log(`  Configurar:  ${process.env.RENDER_EXTERNAL_URL}/configure.html`);
    console.log(`  Manifest:    ${process.env.RENDER_EXTERNAL_URL}/manifest.json`);
  } else {
    console.log(`  Configurar:  http://127.0.0.1:${PORT}/configure.html`);
    console.log(`  Manifest:    http://127.0.0.1:${PORT}/manifest.json`);
  }
  console.log('');

  preloadLists();

  const localUrl = `http://127.0.0.1:${PORT}/manifest.json`;
  if (process.argv.includes('--install')) {
    opn(localUrl.replace('http://', 'stremio://'));
  }
  if (process.argv.includes('--launch')) {
    opn(`https://staging.strem.io#?addonOpen=${encodeURIComponent(localUrl)}`);
  }
});

module.exports = { server };
