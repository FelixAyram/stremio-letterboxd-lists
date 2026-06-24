const { addonBuilder } = require('stremio-addon-sdk');
const { fetchFullList } = require('./src/letterboxd');
const { resolveFilms, fetchMeta, getImdbForSlug, getLetterboxdPoster, getLetterboxdPosterBySlug, getLetterboxdBackground, loadPosterMapFromCache } = require('./src/cinemeta');
const { VERSION } = require('./src/version');
const { readLists, readListCache, writeListCache } = require('./src/store');

const listCache = new Map();
const loading = new Map();
const interfaceCache = new Map();

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

    console.log(`[ok] ${metas.length} peliculas — "${list.title}"`);

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
    const metas = await getListMetas(config);
    const valid = metas.filter((m) => m.id && m.id.startsWith('lbx:'));
    return { metas: valid.slice(skip, skip + 100) };
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

  const cached = interfaceCache.get(listId);
  if (cached) return cached;

  const iface = createBuilderForList(listId).getInterface();
  interfaceCache.set(listId, iface);
  return iface;
}

function buildManifest(listId) {
  const config = findListConfig(listId);
  if (!config) return null;
  return buildManifestForList(config);
}

function preloadLists() {
  readLists().lists.forEach((list) => {
    getListMetas(list).catch((e) => console.error('[preload]', e.message));
  });
}

function clearRuntimeCache() {
  listCache.clear();
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
  findListConfig
};
