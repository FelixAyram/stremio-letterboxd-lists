const path = require('path');
const express = require('express');
const cors = require('cors');
const opn = require('opn');
const { getRouter } = require('stremio-addon-sdk');
const { getInterfaceForList, preloadLists, clearRuntimeCache, findListConfig, getListMetas } = require('./addon');
const { fetchFullList, fetchListTitle, normalizeListUrl, listIdFromUrl } = require('./src/letterboxd');
const { VERSION } = require('./src/version');
const { readLists, writeLists } = require('./src/store');

const PORT = process.env.PORT || 7731;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'HEAD', 'OPTIONS', 'POST'] }));
app.options('*', cors());

const sendCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS, POST');
};
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function baseUrl(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

function manifestUrlForList(req, listId) {
  return `${baseUrl(req)}/list/${listId}/manifest.json`;
}

function listsWithManifests(req) {
  return readLists().lists.map((l) => ({
    ...l,
    manifest: manifestUrlForList(req, l.id)
  }));
}

// Un addon Stremio por lista: /list/{id}/manifest.json
app.use('/list/:listId', (req, res, next) => {
  const listId = req.params.listId;
  if (!findListConfig(listId)) {
    sendCors(res);
    return res.status(404).json({ err: 'lista no encontrada' });
  }
  const iface = getInterfaceForList(listId);
  if (!iface) {
    sendCors(res);
    return res.status(404).json({ err: 'lista no encontrada' });
  }
  getRouter(iface)(req, res, next);
});

app.get('/manifest.json', (req, res) => {
  sendCors(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    info: 'Cada lista tiene su propio manifest. Abre /configure.html para ver las URLs.',
    configure: `${baseUrl(req)}/configure.html`,
    lists: listsWithManifests(req)
  }));
});

app.get('/configure.html', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});

app.get('/api/info', (req, res) => {
  res.json({
    version: VERSION,
    configureUrl: `${baseUrl(req)}/configure.html`,
    lists: listsWithManifests(req)
  });
});

app.get('/api/lists', (req, res) => {
  res.json({ lists: listsWithManifests(req) });
});

app.post('/api/lists', async (req, res) => {
  const raw = (req.body.lists || []).filter((l) => l.url && l.url.includes('letterboxd.com'));

  const lists = [];
  for (const l of raw) {
    const url = normalizeListUrl(l.url);
    let name = (l.name || '').trim();
    try {
      name = await fetchListTitle(url);
    } catch {
      if (!name) name = undefined;
    }
    lists.push({ url, name, id: listIdFromUrl(url) });
  }

  if (!lists.length) return res.status(400).json({ error: 'Agrega al menos una URL de Letterboxd' });

  writeLists({ lists });
  clearRuntimeCache();
  lists.forEach((l) => {
    getInterfaceForList(l.id);
    getListMetas(l).catch((e) => console.error('[preload]', l.id, e.message));
  });

  res.json({ ok: true, version: VERSION, lists: listsWithManifests(req) });
});

app.get('/api/preview', async (req, res) => {
  if (!req.query.url) return res.status(400).json({ error: 'url requerida' });
  try {
    const list = await fetchFullList(req.query.url);
    const manifest = manifestUrlForList(req, list.id);
    res.json({ title: list.title, count: list.films.length, id: list.id, manifest, sample: list.films.slice(0, 8) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (_, res) => {
  res.redirect('/configure.html');
});

const server = app.listen(PORT, HOST, () => {
  console.log('');
  console.log('  Letterboxd Lists — Addon Stremio v' + VERSION);
  console.log('  =====================================');
  const base = process.env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${PORT}`;
  console.log(`  Configurar:  ${base}/configure.html`);
  readLists().lists.forEach((l) => {
    console.log(`  ${l.name || l.id}:  ${base}/list/${l.id}/manifest.json`);
  });
  console.log('');

  preloadLists();

  const localUrl = `http://127.0.0.1:${PORT}/configure.html`;
  if (process.argv.includes('--install')) {
    const first = readLists().lists[0];
    if (first) opn(`${base.replace(/\/$/, '')}/list/${first.id}/manifest.json`.replace('http://', 'stremio://'));
  }
  if (process.argv.includes('--launch')) {
    const first = readLists().lists[0];
    if (first) {
      const m = `${base}/list/${first.id}/manifest.json`;
      opn(`https://web.stremio.com#?addonOpen=${encodeURIComponent(m)}`);
    }
  }
});

module.exports = { server };
