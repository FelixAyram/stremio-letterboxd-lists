const fs = require('fs');
const path = require('path');
const github = require('./github-sync');
const { normalizeListUrl } = require('./letterboxd');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LEGACY_LISTS_FILE = path.join(DATA_DIR, 'lists.json');
const LEGACY_CACHE_DIR = path.join(DATA_DIR, 'cache');

function sanitizeUserId(userId) {
  const id = (userId || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!id) throw new Error('Usuario invalido');
  return id;
}

function userDir(userId) {
  return path.join(DATA_DIR, 'users', sanitizeUserId(userId));
}

function listsFile(userId) {
  return path.join(userDir(userId), 'lists.json');
}

function cacheDir(userId) {
  return path.join(userDir(userId), 'cache');
}

function ensureUserDirs(userId) {
  fs.mkdirSync(userDir(userId), { recursive: true });
  fs.mkdirSync(cacheDir(userId), { recursive: true });
}

function readLegacyLists() {
  if (!fs.existsSync(LEGACY_LISTS_FILE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(LEGACY_LISTS_FILE, 'utf8'));
    if (data.lists?.length) return data;
  } catch {}
  return null;
}

function migrateLegacyLists(userId) {
  const flagFile = path.join(DATA_DIR, '.legacy-migrated');
  if (fs.existsSync(flagFile)) return false;

  const file = listsFile(userId);
  if (fs.existsSync(file)) {
    try {
      const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (existing.lists?.length) return false;
    } catch {}
  }

  let data = readLegacyLists();
  if (!data?.lists?.length && process.env.LISTS_JSON) {
    try {
      data = JSON.parse(process.env.LISTS_JSON);
    } catch {}
  }
  if (!data?.lists?.length) return false;

  writeLists(userId, data);
  fs.writeFileSync(flagFile, userId);
  return true;
}

function readLists(userId) {
  ensureUserDirs(userId);

  const file = listsFile(userId);
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.lists) return data;
    } catch {}
  }

  return { lists: [] };
}

function writeLists(userId, data) {
  ensureUserDirs(userId);
  const file = listsFile(userId);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  github.schedulePush();
}

function writeListsLocal(userId, data) {
  ensureUserDirs(userId);
  fs.writeFileSync(listsFile(userId), JSON.stringify(data, null, 2));
}

function cachePath(userId, listId) {
  return path.join(cacheDir(userId), `${listId}.json`);
}

function isBadMeta(m) {
  if (!m?.id?.startsWith('lbx:')) return true;
  if (!m.poster || m.poster.includes('empty-poster')) return true;
  if (m.poster.includes('metahub.space') || m.poster.includes('media-amazon.com')) return true;
  if (m.poster.includes('675-675-crop') || m.poster.includes('1200-1200-675')) return true;
  const ok =
    m.poster.includes('ltrbxd.com') ||
    m.poster.includes('ratingposterdb.com') ||
    m.poster.includes('image.tmdb.org');
  if (!ok) return true;
  return false;
}

const CACHE_SCHEMA = 7;

function cacheTtlMs(data) {
  if (data?.persisted) return 0;
  const envTtl = parseInt(process.env.CACHE_TTL_MS || '', 10);
  if (Number.isFinite(envTtl)) return envTtl;
  return 6 * 60 * 60 * 1000;
}

function isCacheExpired(data) {
  const ttl = cacheTtlMs(data);
  if (!ttl) return false;
  return Date.now() - (data.cachedAt || 0) > ttl;
}

function readListCache(userId, listId, opts = {}) {
  const p = cachePath(userId, listId);
  if (!fs.existsSync(p)) return readLegacyListCache(listId);
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (isCacheExpired(data)) return null;
    if ((data.cacheSchema || 0) < CACHE_SCHEMA) return null;

    if (opts.listUrl && data.listUrl) {
      if (normalizeListUrl(opts.listUrl) !== normalizeListUrl(data.listUrl)) return null;
    }
    if (opts.filmsCount && data.filmsCount && data.filmsCount !== opts.filmsCount) return null;

    if (data.metaByIndex?.length) {
      const bad = data.metaByIndex.some((m) => m && isBadMeta(m));
      if (bad) return null;
      return data;
    }

    const badPoster = data.metas?.some(
      (m) => m.poster && !m.poster.includes('ltrbxd.com') && !m.poster.includes('empty-poster')
    );
    const oldIds = data.metas?.some((m) => m.id?.startsWith('tt'));
    const landscapePoster = data.metas?.some(
      (m) => m.poster && (m.poster.includes('675-675-crop') || m.poster.includes('1200-1200-675'))
    );
    if (badPoster || oldIds || landscapePoster) return null;
    return data;
  } catch {}
  return null;
}

function readLegacyListCache(listId) {
  const p = path.join(LEGACY_CACHE_DIR, `${listId}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {}
  return null;
}

function writeListCache(userId, listId, payload, opts = {}) {
  ensureUserDirs(userId);
  const data = {
    ...payload,
    cachedAt: Date.now(),
    cacheSchema: payload.cacheSchema || CACHE_SCHEMA
  };
  fs.writeFileSync(cachePath(userId, listId), JSON.stringify(data, null, 2));
  if (opts.syncGithub !== false && github.isEnabled()) github.schedulePush();
}

function filmListCachePath(userId, listId) {
  return path.join(cacheDir(userId), `${listId}-films.json`);
}

function readFilmListCache(userId, listId) {
  const p = filmListCachePath(userId, listId);
  if (!fs.existsSync(p)) {
    const legacy = path.join(LEGACY_CACHE_DIR, `${listId}-films.json`);
    if (!fs.existsSync(legacy)) return null;
    try {
      return JSON.parse(fs.readFileSync(legacy, 'utf8'));
    } catch {}
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {}
  return null;
}

function writeFilmListCache(userId, listId, payload, opts = {}) {
  ensureUserDirs(userId);
  fs.writeFileSync(
    filmListCachePath(userId, listId),
    JSON.stringify({ ...payload, cachedAt: Date.now() }, null, 2)
  );
  if (opts.syncGithub !== false && github.isEnabled()) github.schedulePush();
}

function compactMeta(m) {
  if (!m?.id) return null;
  return {
    id: m.id,
    type: m.type,
    name: m.name,
    poster: m.poster,
    posterShape: m.posterShape || 'poster',
    releaseInfo: m.releaseInfo || ''
  };
}

function compactFilm(f) {
  if (!f?.slug) return null;
  const out = {
    slug: f.slug,
    name: f.name,
    year: f.year,
    mediaType: f.mediaType,
    link: f.link
  };
  if (f.listPrefersSeries) out.listPrefersSeries = true;
  if (f.poster) out.poster = f.poster;
  return out;
}

function exportUserCaches(userId) {
  const dir = cacheDir(userId);
  if (!fs.existsSync(dir)) return null;

  const filmLists = {};
  const metas = {};
  let hasAny = false;

  for (const file of fs.readdirSync(dir)) {
    try {
      if (file.endsWith('-films.json')) {
        const listId = file.slice(0, -'-films.json'.length);
        const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        if (!raw?.films?.length) continue;
        filmLists[listId] = {
          id: raw.id,
          title: raw.title,
          url: raw.url,
          preferSeries: raw.preferSeries,
          cachedAt: raw.cachedAt,
          films: raw.films.map(compactFilm).filter(Boolean)
        };
        hasAny = true;
      } else if (file.endsWith('.json')) {
        const listId = file.slice(0, -'.json'.length);
        const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        const arr = raw.metaByIndex || raw.metas;
        if (!arr?.length) continue;
        metas[listId] = {
          title: raw.title,
          url: raw.url,
          listUrl: raw.listUrl,
          filmsCount: raw.filmsCount || arr.length,
          cacheSchema: raw.cacheSchema || CACHE_SCHEMA,
          persisted: true,
          cachedAt: raw.cachedAt,
          metaByIndex: arr.map(compactMeta).filter(Boolean)
        };
        hasAny = true;
      }
    } catch {}
  }

  return hasAny ? { filmLists, metas } : null;
}

function importUserCaches(userId, caches) {
  if (!caches) return;
  ensureUserDirs(userId);

  for (const [listId, data] of Object.entries(caches.filmLists || {})) {
    if (!data?.films?.length) continue;
    writeFilmListCache(
      userId,
      listId,
      {
        id: data.id || listId,
        title: data.title,
        url: data.url,
        preferSeries: data.preferSeries,
        films: data.films,
        cachedAt: data.cachedAt || Date.now()
      },
      { syncGithub: false }
    );
  }

  for (const [listId, data] of Object.entries(caches.metas || {})) {
    if (!data?.metaByIndex?.length) continue;
    writeListCache(
      userId,
      listId,
      {
        title: data.title,
        url: data.url,
        listUrl: data.listUrl,
        filmsCount: data.filmsCount || data.metaByIndex.length,
        metaByIndex: data.metaByIndex,
        persisted: true,
        cacheSchema: CACHE_SCHEMA,
        cachedAt: data.cachedAt || Date.now()
      },
      { syncGithub: false }
    );
  }
}

function deleteListCache(userId, listId) {
  for (const p of [cachePath(userId, listId), filmListCachePath(userId, listId)]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

module.exports = {
  readLists,
  writeLists,
  writeListsLocal,
  readListCache,
  writeListCache,
  readFilmListCache,
  writeFilmListCache,
  exportUserCaches,
  importUserCaches,
  deleteListCache,
  migrateLegacyLists,
  readLegacyLists,
  sanitizeUserId,
  CACHE_SCHEMA
};
