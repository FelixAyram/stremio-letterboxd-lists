const path = require('path');
const express = require('express');
const cors = require('cors');
const opn = require('opn');
const { getRouter } = require('stremio-addon-sdk');
const { getInterfaceForList, preloadLists, clearRuntimeCache, findListConfig, getFilmList } = require('./addon');
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

async function resolveIncomingLists(raw) {
  const existing = new Map(readLists().lists.map((l) => [l.id, l]));
  const items = (raw || []).filter((x) => x.url && x.url.includes('letterboxd.com'));

  return Promise.all(items.map(async (l) => {
    const url = normalizeListUrl(l.url);
    const id = listIdFromUrl(url);
    const prev = existing.get(id);
    let name = (l.name || '').trim() || prev?.name || '';

    if (!name) {
      try {
        name = await fetchListTitle(url);
      } catch {
        name = prev?.name || id.replace(/^list-/, '').replace(/-/g, ' ');
      }
    }

    return { url, name, id };
  }));
}

function activateLists(lists) {
  lists.forEach((l) => {
    getInterfaceForList(l.id);
    getFilmList(l).catch((e) => console.error('[preload]', l.id, e.message));
  });
}

// Un addon Stremio por lista: /list/{id}/manifest.json
app.use('/list/:listId', (req, res, next) => {
  sendCors(res);
  const listId = req.params.listId;
  if (!findListConfig(listId)) {
    return res.status(404).json({ err: 'lista no encontrada' });
  }
  const iface = getInterfaceForList(listId);
  if (!iface) {
    return res.status(404).json({ err: 'lista no encontrada' });
  }
  getRouter(iface)(req, res, (err) => {
    sendCors(res);
    if (err && !res.headersSent) {
      res.status(500).json({ err: 'error del addon' });
    } else if (!res.headersSent) {
      next(err);
    }
  });
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
  const incoming = await resolveIncomingLists(req.body.lists);
  if (!incoming.length) return res.status(400).json({ error: 'Agrega al menos una URL de Letterboxd' });

  let finalLists;
  if (req.body.replace) {
    finalLists = incoming;
  } else {
    const byId = new Map(readLists().lists.map((l) => [l.id, l]));
    for (const list of incoming) byId.set(list.id, list);
    finalLists = [...byId.values()];
  }

  writeLists({ lists: finalLists });
  clearRuntimeCache();
  activateLists(finalLists);

  res.json({ ok: true, version: VERSION, lists: listsWithManifests(req) });
});

app.delete('/api/lists/:id', (req, res) => {
  const id = req.params.id;
  const finalLists = readLists().lists.filter((l) => l.id !== id);
  writeLists({ lists: finalLists });
  clearRuntimeCache();
  activateLists(finalLists);
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
  readLists().lists.forEach((l) => getInterfaceForList(l.id));

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
