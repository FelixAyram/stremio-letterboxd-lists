const path = require('path');
const express = require('express');
const cors = require('cors');
const opn = require('opn');
const { getRouter } = require('stremio-addon-sdk');
const { getInterfaceForList, preloadLists, clearRuntimeCache, findListConfig, getFilmList } = require('./addon');
const { fetchFullList, fetchListTitle, normalizeListUrl, listIdFromUrl } = require('./src/letterboxd');
const { VERSION } = require('./src/version');
const { readLists, writeLists, migrateLegacyLists } = require('./src/store');
const {
  register, login, signToken, authFromRequest, setSessionCookie, clearSessionCookie,
  listUserIds, findUserById, publicUser, clientIp
} = require('./src/auth');
const { lookupKey, attachKeysToLists, rebuildIndex, manifestUrl, isValidKey } = require('./src/keys');

const PORT = process.env.PORT || 7731;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());

const sendCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS, POST, DELETE');
};
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function baseUrl(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

function listsWithManifests(req, userId) {
  return readLists(userId).lists.map((l) => ({
    name: l.name,
    url: l.url,
    id: l.id,
    key: l.key,
    manifest: manifestUrl(req, l)
  }));
}

function requireAuth(req, res, next) {
  const userId = authFromRequest(req);
  if (!userId) return res.status(401).json({ error: 'Inicia sesion para continuar' });
  req.userId = userId;
  next();
}

async function resolveIncomingLists(userId, raw) {
  const existing = new Map(readLists(userId).lists.map((l) => [l.id, l]));
  const items = (raw || []).filter((x) => x.url && x.url.includes('letterboxd.com'));

  const resolved = await Promise.all(items.map(async (l) => {
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

    return { url, name, id, key: prev?.key };
  }));

  return attachKeysToLists(userId, resolved);
}

function persistLists(userId, lists) {
  writeLists(userId, { lists });
  rebuildIndex();
}

function activateLists(userId, lists) {
  lists.forEach((l) => {
    getInterfaceForList(userId, l.id);
    getFilmList(userId, l).catch((e) => console.error(`[preload:${userId}]`, l.id, e.message));
  });
}

function mountAddonRouter(userId, listId) {
  return (req, res, next) => {
    sendCors(res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!findListConfig(userId, listId)) {
      return res.status(404).json({ err: 'lista no encontrada' });
    }
    const iface = getInterfaceForList(userId, listId);
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
  };
}

const registerAttempts = new Map();
function checkRateLimitRegister(ip) {
  const now = Date.now();
  const entry = registerAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    registerAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return;
  }
  entry.count += 1;
  if (entry.count > 6) throw new Error('Demasiados registros. Espera 15 minutos.');
}

app.get('/manifest.json', (req, res) => {
  sendCors(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    info: 'Inicia sesion en /configure.html para obtener tus URLs privadas.',
    configure: `${baseUrl(req)}/configure.html`,
    version: VERSION
  }));
});

app.get('/configure.html', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});

app.post('/api/auth/register', (req, res) => {
  try {
    checkRateLimitRegister(clientIp(req));
    const user = register(req.body.username, req.body.password);
    migrateLegacyLists(user.id);
    rebuildIndex();
    setSessionCookie(res, signToken(user.id));
    res.json({ ok: true, user: publicUser(user) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const user = login(req.body.username, req.body.password, clientIp(req));
    migrateLegacyLists(user.id);
    rebuildIndex();
    setSessionCookie(res, signToken(user.id));
    res.json({ ok: true, user: publicUser(user) });
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(findUserById(req.userId)) });
});

app.get('/api/info', (req, res) => {
  const userId = authFromRequest(req);
  const user = userId ? findUserById(userId) : null;
  res.json({
    version: VERSION,
    configureUrl: `${baseUrl(req)}/configure.html`,
    user: user ? publicUser(user) : null,
    lists: userId ? listsWithManifests(req, userId) : []
  });
});

app.get('/api/lists', requireAuth, (req, res) => {
  res.json({ lists: listsWithManifests(req, req.userId) });
});

app.post('/api/lists', requireAuth, async (req, res) => {
  const incoming = await resolveIncomingLists(req.userId, req.body.lists);
  if (!incoming.length) return res.status(400).json({ error: 'Agrega al menos una URL de Letterboxd' });

  let finalLists;
  if (req.body.replace) {
    finalLists = incoming;
  } else {
    const byId = new Map(readLists(req.userId).lists.map((l) => [l.id, l]));
    for (const list of incoming) byId.set(list.id, list);
    finalLists = attachKeysToLists(req.userId, [...byId.values()]);
  }

  persistLists(req.userId, finalLists);
  clearRuntimeCache();
  activateLists(req.userId, finalLists);

  res.json({ ok: true, version: VERSION, lists: listsWithManifests(req, req.userId) });
});

app.delete('/api/lists/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  const finalLists = readLists(req.userId).lists.filter((l) => l.id !== id);
  persistLists(req.userId, finalLists);
  clearRuntimeCache();
  activateLists(req.userId, finalLists);
  res.json({ ok: true, version: VERSION, lists: listsWithManifests(req, req.userId) });
});

app.get('/api/preview', requireAuth, async (req, res) => {
  if (!req.query.url) return res.status(400).json({ error: 'url requerida' });
  try {
    const list = await fetchFullList(req.query.url);
    const existing = readLists(req.userId).lists.find((l) => l.id === list.id);
    res.json({
      title: list.title,
      count: list.films.length,
      id: list.id,
      manifest: existing?.key ? `${baseUrl(req)}/${existing.key}/manifest.json` : null,
      sample: list.films.slice(0, 8)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use('/u/:userId/list/:listId', (req, res, next) => {
  const { userId, listId } = req.params;
  if (!findUserById(userId)) return res.status(404).json({ err: 'no encontrado' });
  mountAddonRouter(userId, listId)(req, res, next);
});

app.use('/list/:listId', (req, res, next) => {
  const owner = listUserIds().find((uid) => findListConfig(uid, req.params.listId));
  if (!owner) {
    sendCors(res);
    return res.status(404).json({ err: 'no encontrado' });
  }
  mountAddonRouter(owner, req.params.listId)(req, res, next);
});

app.get('/', (_, res) => {
  res.redirect('/configure.html');
});

// URL privada Stremio — al final para no capturar otras rutas
app.use('/:key', (req, res, next) => {
  const key = req.params.key;
  if (!isValidKey(key)) return next();

  const ref = lookupKey(key);
  if (!ref) {
    sendCors(res);
    return res.status(404).json({ err: 'no encontrado' });
  }

  mountAddonRouter(ref.userId, ref.listId)(req, res, next);
});

const server = app.listen(PORT, HOST, () => {
  rebuildIndex();

  console.log('');
  console.log('  Letterboxd Lists — Addon Stremio v' + VERSION);
  console.log('  =====================================');
  const base = process.env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${PORT}`;
  console.log(`  Configurar:  ${base}/configure.html`);
  listUserIds().forEach((uid) => {
    readLists(uid).lists.forEach((l) => {
      if (l.key) console.log(`  ${l.name || l.id}:  ${base}/${l.key}/manifest.json`);
    });
  });
  console.log('');

  listUserIds().forEach((uid) => preloadUser(uid));
});

function preloadUser(userId) {
  readLists(userId).lists.forEach((l) => getInterfaceForList(userId, l.id));
  preloadLists(userId);
}

module.exports = { server };
