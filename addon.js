const { addonBuilder } = require('stremio-addon-sdk');
const { fetchFullList, listIdFromUrl } = require('./src/letterboxd');
const { resolveFilms, fetchMeta, getImdbForSlug, getLetterboxdPoster, getLetterboxdPosterBySlug, getLetterboxdBackground, loadPosterMapFromCache, fallbackMeta } = require('./src/cinemeta');
const { VERSION } = require('./src/version');
const { readLists, readListCache, writeListCache, readFilmListCache, writeFilmListCache } = require('./src/store');

const listCache = new Map();
const filmListCache = new Map();
const loading = new Map();
const interfaceCache = new Map();

const PAGE_SIZE = 30;
const RESOLVE_CONCURRENCY = 8;

function parseSkip(extra) {
  const raw = extra?.skip ?? extra?.Skip ?? '0';
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function getMetaArrayFromCache(cache, filmsLength) {
  if (cache?.metaByIndex?.length) return cache.metaByIndex;
  if (cache?.metas?.length === filmsLength) return cache.metas;
  return null;
}

function cacheKey(userId, suffix) {
  return `${userId}:${suffix}`;
}

async function getFilmList(userId, listConfig) {
  const listId = listConfig.id || listIdFromUrl(listConfig.url);
  const memKey = cacheKey(userId, listId);
  if (filmListCache.has(memKey)) return filmListCache.get(memKey);

  const cached = readFilmListCache(userId, listId);
  if (cached?.films?.length) {
    filmListCache.set(memKey, cached);
    return cached;
  }

  const loadKey = cacheKey(userId, `films:${listConfig.url}`);
  if (loading.has(loadKey)) return loading.get(loadKey);

  const promise = (async () => {
    console.log(`[${userId}] Leyendo lista: ${listConfig.url}`);
    const list = await fetchFullList(listConfig.url);
    const data = {
      id: list.id,
      title: list.title,
      url: list.url,
      films: list.films
    };
    filmListCache.set(memKey, data);
    writeFilmListCache(userId, list.id, data);
    console.log(`[${userId}] ${list.films.length} peliculas en "${list.title}"`);
    return data;
  })();

  loading.set(loadKey, promise);
  try {
    return await promise;
  } finally {
    loading.delete(loadKey);
  }
}

function metasForRange(metaByIndex, films, skip, end) {
  const out = [];
  for (let i = skip; i < end; i++) {
    out.push(metaByIndex[i] || fallbackMeta(films[i]));
  }
  return out;
}

async function getCatalogMetas(userId, listConfig, skip = 0, limit = PAGE_SIZE) {
  const listId = listConfig.id;
  const { films, title, url } = await getFilmList(userId, listConfig);

  if (skip >= films.length) return [];

  const end = Math.min(skip + limit, films.length);
  const cache = readListCache(userId, listId);
  let metaByIndex = getMetaArrayFromCache(cache, films.length);

  if (metaByIndex) {
    loadPosterMapFromCache(metaByIndex.filter(Boolean));
    listCache.set(cacheKey(userId, listId), metaByIndex);
    const allCached = metaByIndex.slice(skip, end).every(Boolean);
    if (allCached) return metasForRange(metaByIndex, films, skip, end);
  }

  if (!metaByIndex) metaByIndex = new Array(films.length).fill(null);

  const toResolve = [];
  const indices = [];
  for (let i = skip; i < end; i++) {
    if (!metaByIndex[i]) {
      toResolve.push(films[i]);
      indices.push(i);
    }
  }

  if (toResolve.length) {
    const quick = metasForRange(metaByIndex, films, skip, end);
    (async () => {
      const resolved = await resolveFilms(toResolve, null, RESOLVE_CONCURRENCY);
      for (let j = 0; j < indices.length; j++) {
        metaByIndex[indices[j]] = resolved[j];
      }
      writeListCache(userId, listId, { title, url, metaByIndex, filmsCount: films.length });
      loadPosterMapFromCache(resolved);
      listCache.set(cacheKey(userId, listId), metaByIndex);
    })().catch((e) => console.error(`[catalog:bg]`, e.message));
    return quick;
  }
}

function preloadNextCatalogPage(userId, listConfig, skip) {
  getFilmList(userId, listConfig).then(({ films }) => {
    const next = skip + PAGE_SIZE;
    if (next < films.length) {
      getCatalogMetas(userId, listConfig, next, PAGE_SIZE).catch(() => {});
    }
  }).catch(() => {});
}

async function getListMetas(userId, listConfig) {
  const listId = listConfig.id;
  const memKey = cacheKey(userId, listId);

  if (listId) {
    const cached = readListCache(userId, listId);
    if (cached?.metas) {
      loadPosterMapFromCache(cached.metas);
      listCache.set(memKey, cached.metas);
      return cached.metas;
    }
    if (listCache.has(memKey)) return listCache.get(memKey);
  }

  const loadKey = cacheKey(userId, `full:${listConfig.url}`);
  if (loading.has(loadKey)) return loading.get(loadKey);

  const promise = (async () => {
    const { films, title, url, id } = await getFilmList(userId, listConfig);
    console.log(`[${userId}] Resolviendo todas (${films.length}) — "${title}"`);
    const metas = await resolveFilms(films, (n, t) => {
      if (n % 50 === 0 || n === t) console.log(`  ${n}/${t}`);
    });
    console.log(`[ok] ${metas.length} peliculas — "${title}"`);
    listCache.set(memKey, metas);
    writeListCache(userId, id, { title, url, metas });
    return metas;
  })();

  loading.set(loadKey, promise);
  try {
    return await promise;
  } finally {
    loading.delete(loadKey);
  }
}

function findListConfig(userId, listId) {
  return readLists(userId).lists.find((l) => l.id === listId);
}

function buildManifestForList(listConfig) {
  const name = listConfig.name || listConfig.title || 'Letterboxd List';
  return {
    id: `community.letterboxd.${listConfig.id}`,
    version: VERSION,
    name,
    description: `Lista de Letterboxd: ${name}`,
    logo: 'https://s.ltrbxd.com/static/img/letterboxd-decal-dots-neg-rgb-100px.png',
    background: 'https://s.ltrbxd.com/static/img/letterboxd-decal-dots-neg-rgb-100px.png',
    resources: ['catalog', 'meta'],
    types: ['movie'],
    idPrefixes: ['lbx'],
    catalogs: [{
      type: 'movie',
      id: listConfig.id,
      name,
      extra: [{ name: 'skip', isRequired: false }]
    }],
    behaviorHints: { configurable: false, configurationRequired: false }
  };
}

function createBuilderForList(userId, listId) {
  const listConfig = findListConfig(userId, listId);
  if (!listConfig) throw new Error(`Lista no encontrada: ${listId}`);

  const builder = new addonBuilder(buildManifestForList(listConfig));

  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    if (type !== 'movie' || id !== listId) return { metas: [] };

    const config = findListConfig(userId, listId);
    if (!config) return { metas: [] };

    const skip = parseSkip(extra);
    const metas = await getCatalogMetas(userId, config, skip, PAGE_SIZE);
    preloadNextCatalogPage(userId, config, skip);
    return { metas, cacheMaxAge: 3600, staleRevalidate: 86400 };
  });

  builder.defineMetaHandler(async ({ type, id }) => {
    if (type !== 'movie') return { meta: null };

    let imdbId = null;
    let slug = null;

    if (id.startsWith('lbx:')) {
      slug = id.slice(4);
      imdbId = getImdbForSlug(slug);
    } else if (id.startsWith('tt')) {
      imdbId = id;
    }

    if (!imdbId) return { meta: null };

    const meta = await fetchMeta(imdbId);
    if (!meta) return { meta: null };

    meta.id = imdbId;
    const lbxPoster = (slug && getLetterboxdPosterBySlug(slug)) || getLetterboxdPoster(imdbId);
    if (lbxPoster) meta.poster = lbxPoster;
    const lbxBg = getLetterboxdBackground(imdbId);
    if (lbxBg) meta.background = lbxBg;
    return { meta };
  });

  return builder;
}

function getInterfaceForList(userId, listId) {
  const config = findListConfig(userId, listId);
  if (!config) return null;

  const key = `${userId}|${listId}|${config.url}|${config.name || ''}`;
  const cached = interfaceCache.get(key);
  if (cached) return cached;

  const iface = createBuilderForList(userId, listId).getInterface();
  interfaceCache.set(key, iface);
  return iface;
}

function buildManifest(userId, listId) {
  const config = findListConfig(userId, listId);
  if (!config) return null;
  return buildManifestForList(config);
}

function preloadLists(userId) {
  readLists(userId).lists.forEach((list) => {
    getFilmList(userId, list).catch((e) => console.error(`[preload:${userId}]`, e.message));
  });
}

function clearRuntimeCache() {
  listCache.clear();
  filmListCache.clear();
  loading.clear();
  interfaceCache.clear();
}

module.exports = {
  getInterfaceForList,
  buildManifest,
  buildManifestForList,
  preloadLists,
  clearRuntimeCache,
  getListMetas,
  getFilmList,
  getCatalogMetas,
  findListConfig
};
