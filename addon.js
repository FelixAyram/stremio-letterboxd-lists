const { addonBuilder } = require('stremio-addon-sdk');
const { fetchFullList, listIdFromUrl } = require('./src/letterboxd');
const { resolveFilms, fetchMeta, getImdbForSlug, getLetterboxdPoster, getLetterboxdPosterBySlug, getLetterboxdBackground, loadPosterMapFromCache } = require('./src/cinemeta');
const { VERSION } = require('./src/version');
const { readLists, readListCache, writeListCache, readFilmListCache, writeFilmListCache } = require('./src/store');

const listCache = new Map();
const filmListCache = new Map();
const loading = new Map();
const interfaceCache = new Map();

const PAGE_SIZE = 50;

async function getFilmList(listConfig) {
  const listId = listConfig.id || listIdFromUrl(listConfig.url);
  if (filmListCache.has(listId)) return filmListCache.get(listId);

  const cached = readFilmListCache(listId);
  if (cached?.films?.length) {
    filmListCache.set(listId, cached);
    return cached;
  }

  const loadKey = `films:${listConfig.url}`;
  if (loading.has(loadKey)) return loading.get(loadKey);

  const promise = (async () => {
    console.log(`[letterboxd] Leyendo lista: ${listConfig.url}`);
    const list = await fetchFullList(listConfig.url);
    const data = {
      id: list.id,
      title: list.title,
      url: list.url,
      films: list.films
    };
    filmListCache.set(list.id, data);
    writeFilmListCache(list.id, data);
    console.log(`[letterboxd] ${list.films.length} peliculas en "${list.title}"`);
    return data;
  })();

  loading.set(loadKey, promise);
  try {
    return await promise;
  } finally {
    loading.delete(loadKey);
  }
}

async function getCatalogMetas(listConfig, skip = 0, limit = PAGE_SIZE) {
  const listId = listConfig.id;

  const disk = readListCache(listId);
  if (disk?.metas?.length) {
    loadPosterMapFromCache(disk.metas);
    listCache.set(listId, disk.metas);
    const valid = disk.metas.filter((m) => m.id?.startsWith('lbx:'));
    if (valid.length > skip) return valid.slice(skip, skip + limit);
  }

  const { films, title } = await getFilmList(listConfig);
  const batch = films.slice(skip, skip + limit);
  if (!batch.length) return [];

  console.log(`[catalog] "${title}" — resolviendo ${skip + 1}-${skip + batch.length} de ${films.length}`);
  const metas = await resolveFilms(batch, null, 6);
  return metas.filter((m) => m.id?.startsWith('lbx:'));
}

async function getListMetas(listConfig) {
  if (listConfig.id) {
    const cached = readListCache(listConfig.id);
    if (cached?.metas) {
      loadPosterMapFromCache(cached.metas);
      listCache.set(listConfig.id, cached.metas);
      return cached.metas;
    }
    if (listCache.has(listConfig.id)) return listCache.get(listConfig.id);
  }

  const loadKey = `full:${listConfig.url}`;
  if (loading.has(loadKey)) return loading.get(loadKey);

  const promise = (async () => {
    const { films, title, url, id } = await getFilmList(listConfig);
    console.log(`[letterboxd] Resolviendo todas (${films.length}) — "${title}"`);
    const metas = await resolveFilms(films, (n, t) => {
      if (n % 50 === 0 || n === t) console.log(`  ${n}/${t}`);
    });
    console.log(`[ok] ${metas.length} peliculas — "${title}"`);
    listCache.set(id, metas);
    writeListCache(id, { title, url, metas });
    return metas;
  })();

  loading.set(loadKey, promise);
  try {
    return await promise;
  } finally {
    loading.delete(loadKey);
  }
}

function findListConfig(listId) {
  return readLists().lists.find((l) => l.id === listId);
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

function createBuilderForList(listId) {
  const listConfig = findListConfig(listId);
  if (!listConfig) throw new Error(`Lista no encontrada: ${listId}`);

  const builder = new addonBuilder(buildManifestForList(listConfig));

  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    if (type !== 'movie' || id !== listId) return { metas: [] };

    const config = findListConfig(listId);
    if (!config) return { metas: [] };

    const skip = parseInt(extra?.skip || '0', 10) || 0;
    const metas = await getCatalogMetas(config, skip, PAGE_SIZE);
    return { metas, cacheMaxAge: 3600 };
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

function getInterfaceForList(listId) {
  const config = findListConfig(listId);
  if (!config) return null;

  const cacheKey = `${listId}|${config.url}|${config.name || ''}`;
  const cached = interfaceCache.get(cacheKey);
  if (cached) return cached;

  const iface = createBuilderForList(listId).getInterface();
  interfaceCache.set(cacheKey, iface);
  return iface;
}

function buildManifest(listId) {
  const config = findListConfig(listId);
  if (!config) return null;
  return buildManifestForList(config);
}

function preloadLists() {
  readLists().lists.forEach((list) => {
    getFilmList(list).catch((e) => console.error('[preload]', e.message));
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
  findListConfig
};
