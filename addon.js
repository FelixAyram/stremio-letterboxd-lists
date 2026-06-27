const { addonBuilder } = require('stremio-addon-sdk');
const { fetchFullList, listIdFromUrl } = require('./src/letterboxd');
const { listPrefersSeries, listHasSeries, listHasMovies } = require('./src/title-match');
const { resolveFilms, fetchMeta, getImdbForSlug, getMediaTypeForSlug, getLetterboxdPoster, getLetterboxdPosterBySlug, getLetterboxdBackground, loadPosterMapFromCache, fallbackMeta, ensureLetterboxdPosters } = require('./src/cinemeta');
const { isAllowedPoster, isRpdbMode } = require('./src/posters');
const tmdb = require('./src/tmdb');
const rpdb = require('./src/rpdb');
const tvdb = require('./src/tvdb');
const { VERSION } = require('./src/version');
const { readLists, readListCache, writeListCache, readFilmListCache, writeFilmListCache } = require('./src/store');

const listCache = new Map();
const filmListCache = new Map();
const loading = new Map();
const interfaceCache = new Map();

const PAGE_SIZE = 30;
const RESOLVE_CONCURRENCY = parseInt(
  process.env.RESOLVE_CONCURRENCY || (process.env.POSTER_MODE === 'rpdb' || !process.env.POSTER_MODE ? '10' : '3'),
  10
);

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
    cached.preferSeries =
      cached.preferSeries || listPrefersSeries(cached.title, cached.films, listConfig.url);
    if (cached.preferSeries) {
      cached.films.forEach((f) => {
        if (f.mediaType !== 'series') f.listPrefersSeries = true;
      });
    }
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
      films: list.films,
      preferSeries: list.preferSeries
    };
    filmListCache.set(memKey, data);
    writeFilmListCache(userId, list.id, data);
    clearInterfaceCacheForList(userId, listId);
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
    if (isRpdbMode()) {
      const resolved = await resolveFilms(toResolve, null, RESOLVE_CONCURRENCY);
      for (let j = 0; j < indices.length; j++) {
        metaByIndex[indices[j]] = resolved[j];
      }
      writeListCache(userId, listId, { title, url, metaByIndex, filmsCount: films.length, cacheSchema: 6 });
      loadPosterMapFromCache(resolved);
      listCache.set(cacheKey(userId, listId), metaByIndex);
      return metasForRange(metaByIndex, films, skip, end);
    }

    const pageFilms = films.slice(skip, end);
    await ensureLetterboxdPosters(pageFilms);
    const quick = metasForRange(metaByIndex, films, skip, end);
    (async () => {
      const resolved = await resolveFilms(toResolve, null, RESOLVE_CONCURRENCY);
      for (let j = 0; j < indices.length; j++) {
        metaByIndex[indices[j]] = resolved[j];
      }
      writeListCache(userId, listId, { title, url, metaByIndex, filmsCount: films.length, cacheSchema: 6 });
      loadPosterMapFromCache(resolved);
      listCache.set(cacheKey(userId, listId), metaByIndex);
    })().catch((e) => console.error(`[catalog:bg]`, e.message));
    return quick;
  }
}

function preloadNextCatalogPage(userId, listConfig, skip) {
  if (process.env.PRELOAD_NEXT_PAGE === 'false') return;
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
    writeListCache(userId, id, { title, url, metas, cacheSchema: 6 });
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

function buildManifestForList(listConfig, filmData = null) {
  const name = listConfig.name || listConfig.title || filmData?.title || 'Letterboxd List';
  const films = filmData?.films || [];
  const title = filmData?.title || name;
  const url = listConfig.url || filmData?.url || '';
  const preferSeries = filmData?.preferSeries || listPrefersSeries(title, films, url);
  const hasSeries = listHasSeries(films, title, url, preferSeries);
  const hasMovies = listHasMovies(films, title, url, preferSeries);

  const catalogs = [];
  const types = [];

  if (hasMovies) {
    catalogs.push({
      type: 'movie',
      id: listConfig.id,
      name,
      extra: [{ name: 'skip', isRequired: false }]
    });
    types.push('movie');
  }
  if (hasSeries) {
    catalogs.push({
      type: 'series',
      id: listConfig.id,
      name,
      extra: [{ name: 'skip', isRequired: false }]
    });
    types.push('series');
  }
  if (!catalogs.length) {
    const fallbackType = preferSeries || listPrefersSeries(title, films, url) ? 'series' : 'movie';
    catalogs.push({
      type: fallbackType,
      id: listConfig.id,
      name,
      extra: [{ name: 'skip', isRequired: false }]
    });
    types.push(fallbackType);
  }

  return {
    id: `community.letterboxd.${listConfig.id}`,
    version: VERSION,
    name,
    description: `Lista de Letterboxd: ${name}`,
    logo: 'https://s.ltrbxd.com/static/img/letterboxd-decal-dots-neg-rgb-100px.png',
    background: 'https://s.ltrbxd.com/static/img/letterboxd-decal-dots-neg-rgb-100px.png',
    resources: ['catalog', 'meta'],
    types,
    idPrefixes: ['lbx'],
    catalogs,
    behaviorHints: { configurable: false, configurationRequired: false }
  };
}

function createBuilderForList(userId, listId, filmData = null) {
  const listConfig = findListConfig(userId, listId);
  if (!listConfig) throw new Error(`Lista no encontrada: ${listId}`);

  if (!filmData) {
    const listKey = listConfig.id;
    filmData = filmListCache.get(cacheKey(userId, listKey)) || readFilmListCache(userId, listKey);
  }

  const builder = new addonBuilder(buildManifestForList(listConfig, filmData));

  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    if (id !== listId) return { metas: [] };
    if (type !== 'movie' && type !== 'series') return { metas: [] };

    const config = findListConfig(userId, listId);
    if (!config) return { metas: [] };

    const skip = parseSkip(extra);
    const metas = await getCatalogMetas(userId, config, skip, PAGE_SIZE);
    const filtered = metas.filter((m) => m.type === type);
    preloadNextCatalogPage(userId, config, skip);
    return { metas: filtered, cacheMaxAge: 3600, staleRevalidate: 86400 };
  });

  builder.defineMetaHandler(async ({ type, id }) => {
    if (type !== 'movie' && type !== 'series') return { meta: null };

    let imdbId = null;
    let slug = null;
    let mediaType = type;

    if (id.startsWith('lbx:')) {
      slug = id.slice(4);
      imdbId = getImdbForSlug(slug);
      mediaType = getMediaTypeForSlug(slug) || type;
    } else if (id.startsWith('tt')) {
      imdbId = id;
    }

    if (!imdbId) return { meta: null };

    let meta = await fetchMeta(imdbId, mediaType);
    if (!meta && mediaType === 'movie') {
      meta = await fetchMeta(imdbId, 'series');
      if (meta) mediaType = 'series';
    } else if (!meta && mediaType === 'series') {
      meta = await fetchMeta(imdbId, 'movie');
      if (meta) mediaType = 'movie';
    }
    if (!meta) return { meta: null };

    meta.id = imdbId;
    meta.type = mediaType;
    const lbxPoster = (slug && getLetterboxdPosterBySlug(slug)) || getLetterboxdPoster(imdbId);
    if (lbxPoster && isAllowedPoster(lbxPoster)) {
      meta.poster = lbxPoster;
    } else if (rpdb.isEnabled()) {
      const rp = rpdb.posterUrl(imdbId);
      if (rp) meta.poster = rp;
    } else if (!isAllowedPoster(meta.poster)) {
      delete meta.poster;
    }
    const lbxBg = getLetterboxdBackground(imdbId);
    if (lbxBg) meta.background = lbxBg;
    return { meta };
  });

  return builder;
}

function clearInterfaceCacheForList(userId, listId) {
  const prefix = `${userId}|${listId}|`;
  for (const key of interfaceCache.keys()) {
    if (key.startsWith(prefix)) interfaceCache.delete(key);
  }
}

function getInterfaceForList(userId, listId) {
  const config = findListConfig(userId, listId);
  if (!config) return null;

  const filmData = filmListCache.get(cacheKey(userId, listId)) || readFilmListCache(userId, listId);
  const films = filmData?.films || [];
  const title = filmData?.title || config.name || '';
  const url = config.url || filmData?.url || '';
  const preferSeries = filmData?.preferSeries || listPrefersSeries(title, films, url);
  const seriesFlag = listHasSeries(films, title, url, preferSeries) ? 's' : '';
  const movieFlag = listHasMovies(films, title, url, preferSeries) ? 'm' : '';
  const key = `${userId}|${listId}|${config.url}|${config.name || ''}|${films.length}|${preferSeries ? 'p' : ''}${seriesFlag}${movieFlag}`;

  const cached = interfaceCache.get(key);
  if (cached) return cached;

  const iface = createBuilderForList(userId, listId, filmData).getInterface();
  interfaceCache.set(key, iface);
  return iface;
}

function buildManifest(userId, listId) {
  const config = findListConfig(userId, listId);
  if (!config) return null;
  const filmData = filmListCache.get(cacheKey(userId, listId)) || readFilmListCache(userId, listId);
  return buildManifestForList(config, filmData);
}

function preloadLists(userId) {
  if (process.env.PRELOAD_ON_START === 'false') return;
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
