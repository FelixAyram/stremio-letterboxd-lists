const { addonBuilder } = require('stremio-addon-sdk');
const { fetchFullList } = require('./src/letterboxd');
const { resolveFilms, fetchMeta, getLetterboxdPoster, getLetterboxdBackground, loadPosterMapFromCache } = require('./src/cinemeta');
const { readLists, readListCache, writeListCache } = require('./src/store');

const listCache = new Map();
const loading = new Map();

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

  const loadKey = listConfig.url;
  if (loading.has(loadKey)) return loading.get(loadKey);

  const promise = (async () => {
    console.log(`[letterboxd] Cargando: ${listConfig.url}`);
    const list = await fetchFullList(listConfig.url);
    listConfig.id = list.id;
    listConfig.title = list.title;
    listConfig.name = listConfig.name || list.title;

    console.log(`[letterboxd] ${list.films.length} peliculas — resolviendo IMDb...`);
    const metas = await resolveFilms(list.films, (n, t) => {
      if (n % 25 === 0 || n === t) console.log(`  ${n}/${t}`);
    });

    const imdbCount = metas.length;
    console.log(`[ok] ${imdbCount} peliculas — "${list.title}"`);

    listCache.set(list.id, metas);
    writeListCache(list.id, { title: list.title, url: list.url, metas });
    return metas;
  })();

  loading.set(loadKey, promise);
  try {
    return await promise;
  } finally {
    loading.delete(loadKey);
  }
}

function buildManifest() {
  const { lists } = readLists();
  return {
    id: 'community.letterboxd.lists',
    version: '1.3.0',
    name: 'Letterboxd Lists',
    description: 'Listas publicas de Letterboxd como catalogos en Stremio (IDs IMDb para metadatos y streams)',
    logo: 'https://s.ltrbxd.com/static/img/letterboxd-decal-dots-neg-rgb-100px.png',
    background: 'https://s.ltrbxd.com/static/img/letterboxd-decal-dots-neg-rgb-100px.png',
    resources: ['catalog', 'meta'],
    types: ['movie'],
    idPrefixes: ['tt'],
    catalogs: lists.map((l, i) => ({
      type: 'movie',
      id: l.id || `list-pending-${i}`,
      name: l.name || l.title || 'Letterboxd List',
      extra: [{ name: 'skip', isRequired: false }]
    })),
    behaviorHints: { configurable: false, configurationRequired: false }
  };
}

function createBuilder() {
  const builder = new addonBuilder(buildManifest());

  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    if (type !== 'movie') return { metas: [] };

    const listConfig = readLists().lists.find((l) => l.id === id);
    if (!listConfig) return { metas: [] };

    const skip = parseInt(extra?.skip || '0', 10) || 0;
    const metas = await getListMetas(listConfig);
    const valid = metas.filter((m) => m.id && m.id.startsWith('tt'));
    return { metas: valid.slice(skip, skip + 100) };
  });

  builder.defineMetaHandler(async ({ type, id }) => {
    if (type !== 'movie' || !id.startsWith('tt')) return { meta: null };
    const meta = await fetchMeta(id);
    if (!meta) return { meta: null };
    const lbxPoster = getLetterboxdPoster(id);
    if (lbxPoster) meta.poster = lbxPoster;
    const lbxBg = getLetterboxdBackground(id);
    if (lbxBg) meta.background = lbxBg;
    return { meta };
  });

  return builder;
}

function getInterface() {
  return createBuilder().getInterface();
}

function preloadLists() {
  readLists().lists.forEach((list) => {
    getListMetas(list).catch((e) => console.error('[preload]', e.message));
  });
}

function clearRuntimeCache() {
  listCache.clear();
  loading.clear();
}

module.exports = { getInterface, buildManifest, preloadLists, clearRuntimeCache, getListMetas };
