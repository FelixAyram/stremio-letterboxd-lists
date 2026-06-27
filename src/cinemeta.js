const CINEMETA = 'https://v3-cinemeta.strem.io';
const { fetchMediaPage, sleep } = require('./letterboxd');
const { LruCache } = require('./lru-cache');
const {
  EMPTY_POSTER,
  isLetterboxdPoster,
  isAllowedPoster,
  pickLetterboxdPoster,
  attachPosterToFilm,
  pickDisplayPoster,
  posterMode,
  isRpdbMode,
  normalizePosterUrl
} = require('./posters');
const tmdb = require('./tmdb');
const tvdb = require('./tvdb');
const {
  scoreCandidate,
  minAcceptScore,
  searchTitleVariants,
  titleSimilarity,
  yearMatches
} = require('./title-match');

const searchCache = new LruCache(parseInt(process.env.SEARCH_CACHE_SIZE || '400', 10));
const posterByImdb = new Map();
const posterBySlug = new Map();
const backgroundByImdb = new Map();
const slugToImdb = new Map();
const slugToMedia = new Map();

function lbxPosterFor(film, imdbId, extras = {}) {
  return pickDisplayPoster(film, imdbId, extras);
}

function catalogId(slug) {
  return `lbx:${slug}`;
}

async function searchCatalog(type, title, year, retries = 3) {
  const key = `${type}|${title}|${year || ''}`;
  if (searchCache.has(key)) return searchCache.get(key);

  const query = year ? `${title} ${year}` : title;
  const url = `${CINEMETA}/catalog/${type}/top/search=${encodeURIComponent(query)}.json`;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        await sleep(300 * (attempt + 1));
        continue;
      }
      const data = await res.json();
      const metas = (data.metas || []).filter((m) => m.id?.startsWith('tt')).slice(0, 10);
      searchCache.set(key, metas);
      return metas;
    } catch {
      await sleep(300 * (attempt + 1));
    }
  }

  searchCache.set(key, []);
  return [];
}

async function searchCinemetaByType(title, year, mediaType, preferType) {
  const metas = await searchCatalog(mediaType, title, year);
  let best = null;
  let bestScore = 0;

  for (const meta of metas) {
    const score = scoreCandidate(meta, title, year, mediaType, preferType);
    if (score > bestScore) {
      bestScore = score;
      best = meta;
    }
  }

  const minScore = minAcceptScore(preferType);
  if (!best || bestScore < minScore) {
    return { hit: null, mediaType, score: bestScore };
  }

  return { hit: best, mediaType, score: bestScore };
}

async function searchCinemeta(title, year, preferType = 'movie') {
  const [movieResult, seriesResult] = await Promise.all([
    searchCinemetaByType(title, year, 'movie', preferType),
    searchCinemetaByType(title, year, 'series', preferType)
  ]);

  if (movieResult.hit && seriesResult.hit) {
    return movieResult.score >= seriesResult.score ? movieResult : seriesResult;
  }
  return movieResult.hit ? movieResult : seriesResult;
}

async function searchCinemetaForFilm(film, preferType = 'movie') {
  const titles = searchTitleVariants(film);
  const wantsSeries = preferType === 'series' || film.listPrefersSeries;

  async function bestForType(type, scorePrefer) {
    const scoreType = scorePrefer || type;
    let best = { hit: null, mediaType: type, score: 0 };
    for (const title of titles) {
      const result = await searchCinemetaByType(title, film.year, type, scoreType);
      if (result.hit && result.score > best.score) best = result;
      if (best.score >= 0.92) break;
    }
    return best;
  }

  if (wantsSeries) {
    const seriesBest = await bestForType('series', 'series');
    if (seriesBest.hit && seriesBest.score >= minAcceptScore('series')) return seriesBest;

    const movieBest = await bestForType('movie', 'movie');
    if (movieBest.hit && movieBest.score >= 0.78) return movieBest;
    return seriesBest.hit ? seriesBest : movieBest;
  }

  return bestForType(preferType, preferType);
}

async function fetchMeta(imdbId, mediaType = 'movie') {
  const kind = mediaType === 'series' ? 'series' : 'movie';
  const url = `${CINEMETA}/meta/${kind}/${imdbId}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.meta || null;
  } catch {
    return null;
  }
}

async function resolveMetaType(imdbId, preferType, title, year) {
  const primary = preferType === 'series' ? 'series' : 'movie';
  const secondary = primary === 'series' ? 'movie' : 'series';

  let meta = await fetchMeta(imdbId, primary);
  if (meta) {
    const sim = titleSimilarity(meta.name, title);
    if (sim >= 0.35 || !title) return { meta, mediaType: primary };
  }

  meta = await fetchMeta(imdbId, secondary);
  if (meta) {
    const sim = titleSimilarity(meta.name, title);
    if (sim >= 0.35 || !title) return { meta, mediaType: secondary };
  }

  if (primary === 'series') {
    meta = await fetchMeta(imdbId, 'series');
    if (meta) return { meta, mediaType: 'series' };
  }

  meta = await fetchMeta(imdbId, primary);
  if (meta) return { meta, mediaType: primary };
  meta = await fetchMeta(imdbId, secondary);
  if (meta) return { meta, mediaType: secondary };

  return { meta: null, mediaType: preferType };
}

function storeFilmMaps(film, imdbId, mediaType = 'movie', extras = {}) {
  slugToImdb.set(film.slug, imdbId);
  slugToMedia.set(film.slug, mediaType);
  const poster = lbxPosterFor(film, imdbId, { ...extras, mediaType });
  if (poster && poster !== EMPTY_POSTER) {
    posterByImdb.set(imdbId, poster);
    posterBySlug.set(film.slug, poster);
    film.poster = poster;
  }
  if (film.background) backgroundByImdb.set(imdbId, film.background);
  if (extras.tmdbId) film.tmdbId = extras.tmdbId;
}

function metaFromImdb(imdbId, film, metaHit, mediaType = 'movie', extras = {}) {
  const poster = lbxPosterFor(film, imdbId, { ...extras, mediaType });
  const background =
    film.background ||
    backgroundByImdb.get(imdbId) ||
    extras.tmdbBackground ||
    metaHit?.background;
  const type = mediaType === 'series' ? 'series' : 'movie';

  return {
    id: catalogId(film.slug),
    type,
    name: metaHit?.name || film.name,
    poster,
    background,
    posterShape: 'poster',
    releaseInfo: metaHit?.releaseInfo || film.year || '',
    imdbRating: metaHit?.imdbRating,
    description: metaHit?.description
  };
}

function inferPreferType(film) {
  if (film.mediaType === 'series' || film.listPrefersSeries) return 'series';
  return 'movie';
}

async function buildMetaFromResolution(film, imdbId, mediaType, metaHit, extras = {}) {
  if (extras.tmdbBackground && !film.background) film.background = extras.tmdbBackground;
  storeFilmMaps(film, imdbId, mediaType, extras);
  return metaFromImdb(imdbId, film, metaHit, mediaType, extras);
}

async function resolveFilm(film) {
  const lbx = await fetchMediaPage(film.slug, {
    link: film.link,
    mediaType: film.mediaType,
    year: film.year
  });
  if (lbx.poster) film.poster = normalizePosterUrl(lbx.poster) || lbx.poster;
  if (lbx.lbxFilmId) film.lbxFilmId = lbx.lbxFilmId;
  if (lbx.background) film.background = lbx.background;
  if (lbx.pageTitle) film.pageTitle = lbx.pageTitle;
  if (lbx.pageYear && !film.year) film.year = lbx.pageYear;

  const pageType = lbx.mediaType === 'series' ? 'series' : null;
  const listType = film.mediaType === 'series' || film.listPrefersSeries ? 'series' : null;
  const preferType = pageType || listType || 'movie';

  if (lbx.imdbId) {
    const { meta, mediaType } = await resolveMetaType(lbx.imdbId, preferType, film.name, film.year);
    if (meta) {
      const sim = titleSimilarity(meta.name, film.name);
      const yearOk = !film.year || yearMatches(meta.releaseInfo, film.year) > 0;
      const typeOk = preferType !== 'series' || mediaType === 'series' || sim >= 0.85;
      if (sim >= 0.35 && yearOk && typeOk) {
        const tmdbInfo = tmdb.isEnabled() ? await tmdb.lookupImdbOnTmdb(lbx.imdbId, mediaType) : null;
        return buildMetaFromResolution(film, lbx.imdbId, mediaType, meta, {
          tmdbId: tmdbInfo?.tmdbId,
          tmdbPoster: tmdbInfo?.poster,
          tmdbBackground: tmdbInfo?.background
        });
      }
    }
  }

  if (tmdb.isEnabled()) {
    const tmdbHit = await tmdb.searchTmdbForFilm(film, preferType);
    if (tmdbHit?.imdbId) {
      const meta = await fetchMeta(tmdbHit.imdbId, tmdbHit.mediaType);
      return buildMetaFromResolution(film, tmdbHit.imdbId, tmdbHit.mediaType, meta || tmdbHit.meta, {
        tmdbId: tmdbHit.tmdbId,
        tmdbPoster: tmdbHit.poster,
        tmdbBackground: tmdbHit.background
      });
    }
  }

  const { hit, mediaType, score } = await searchCinemetaForFilm(film, preferType);
  if (!hit && preferType === 'series' && tvdb.isEnabled()) {
    const tvHit = await tvdb.searchSeries(film.pageTitle || film.name, film.year);
    if (tvHit?.imdbId) {
      const meta = await fetchMeta(tvHit.imdbId, 'series');
      return buildMetaFromResolution(film, tvHit.imdbId, 'series', meta || { name: tvHit.name, releaseInfo: tvHit.releaseInfo }, {});
    }
  }

  if (!hit) return null;

  let imdbId = hit.id;
  let fullMeta = await fetchMeta(imdbId, mediaType);
  if (!fullMeta) {
    const alt = mediaType === 'movie' ? 'series' : 'movie';
    fullMeta = await fetchMeta(imdbId, alt);
    if (fullMeta && titleSimilarity(fullMeta.name, film.name) >= 0.35) {
      return buildMetaFromResolution(film, imdbId, alt, fullMeta, {});
    }
  }

  if (fullMeta && titleSimilarity(fullMeta.name, film.name) < 0.3 && score < 0.7) {
    return null;
  }

  const tmdbInfo = tmdb.isEnabled() ? await tmdb.lookupImdbOnTmdb(imdbId, mediaType) : null;
  return buildMetaFromResolution(film, imdbId, mediaType, fullMeta || hit, {
    tmdbId: tmdbInfo?.tmdbId,
    tmdbPoster: tmdbInfo?.poster,
    tmdbBackground: tmdbInfo?.background
  });
}

function fallbackMeta(film) {
  attachPosterToFilm(film);
  const poster = lbxPosterFor(film) || EMPTY_POSTER;
  const type =
    film.mediaType === 'series' || film.listPrefersSeries ? 'series' : 'movie';
  return {
    id: catalogId(film.slug),
    type,
    name: film.name,
    poster,
    posterShape: 'poster',
    releaseInfo: film.year || ''
  };
}

async function resolveFilmFast(film) {
  const preferType = inferPreferType(film);
  const cachedImdb = getImdbForSlug(film.slug);

  if (cachedImdb) {
    const mediaType = getMediaTypeForSlug(film.slug);
    const meta = await fetchMeta(cachedImdb, mediaType);
    return buildMetaFromResolution(film, cachedImdb, mediaType, meta, {});
  }

  if (tmdb.isEnabled()) {
    const tmdbHit = await tmdb.searchTmdbForFilm(film, preferType);
    if (tmdbHit?.imdbId) {
      return buildMetaFromResolution(film, tmdbHit.imdbId, tmdbHit.mediaType, {
        name: tmdbHit.meta?.name || film.name,
        releaseInfo: tmdbHit.meta?.releaseInfo || film.year || '',
        description: tmdbHit.meta?.overview,
        imdbRating: tmdbHit.meta?.vote_average ? String(tmdbHit.meta.vote_average) : undefined
      }, { tmdbId: tmdbHit.tmdbId });
    }
  }

  const { hit, mediaType } = await searchCinemetaForFilm(film, preferType);
  if (hit) {
    return buildMetaFromResolution(film, hit.id, mediaType, hit, {});
  }

  if (preferType === 'series' && tvdb.isEnabled()) {
    const tvHit = await tvdb.searchSeries(film.pageTitle || film.name, film.year);
    if (tvHit?.imdbId) {
      return buildMetaFromResolution(film, tvHit.imdbId, 'series', {
        name: tvHit.name,
        releaseInfo: tvHit.releaseInfo
      }, {});
    }
  }

  const lbx = await fetchMediaPage(film.slug, {
    link: film.link,
    mediaType: film.mediaType,
    year: film.year
  });
  if (lbx.imdbId) {
    const { meta, mediaType: mt } = await resolveMetaType(lbx.imdbId, preferType, film.name, film.year);
    if (meta) return buildMetaFromResolution(film, lbx.imdbId, mt, meta, {});
  }

  return fallbackMeta(film);
}

async function resolveFilmOrFallbackFast(film) {
  try {
    return await resolveFilmFast(film);
  } catch {
    return fallbackMeta(film);
  }
}

async function resolveFilmOrFallback(film) {
  if (isRpdbMode()) return resolveFilmOrFallbackFast(film);
  try {
    return (await resolveFilm(film)) || fallbackMeta(film);
  } catch {
    return fallbackMeta(film);
  }
}

async function ensureLetterboxdPosters(films, concurrency = parseInt(process.env.POSTER_CONCURRENCY || '3', 10)) {
  if (isRpdbMode()) return films;
  const needsPage = [];

  for (const film of films) {
    attachPosterToFilm(film);
    if (!isLetterboxdPoster(film.poster)) needsPage.push(film);
  }

  for (let i = 0; i < needsPage.length; i += concurrency) {
    const batch = needsPage.slice(i, i + concurrency);
    await Promise.all(batch.map(async (film) => {
      try {
        const lbx = await fetchMediaPage(film.slug, {
          link: film.link,
          mediaType: film.mediaType,
          year: film.year
        });
        if (lbx.lbxFilmId) film.lbxFilmId = lbx.lbxFilmId;
        if (lbx.poster) film.poster = normalizePosterUrl(lbx.poster) || lbx.poster;
        attachPosterToFilm(film);
      } catch {}
    }));
    if (i + concurrency < needsPage.length) await sleep(40);
  }

  return films;
}

async function resolveFilms(films, onProgress, concurrency = 3) {
  if (!isRpdbMode()) {
    await ensureLetterboxdPosters(films, concurrency);
  }
  const batchDelay = isRpdbMode() ? 25 : 80;
  const out = [];

  for (let i = 0; i < films.length; i += concurrency) {
    const batch = films.slice(i, i + concurrency);
    const resolver = isRpdbMode() ? resolveFilmOrFallbackFast : resolveFilmOrFallback;
    const resolved = await Promise.all(batch.map((f) => resolver(f)));
    out.push(...resolved);
    if (onProgress) onProgress(Math.min(i + concurrency, films.length), films.length);
    if (i + concurrency < films.length) await sleep(batchDelay);
  }

  return out;
}

function getImdbForSlug(slug) {
  return slugToImdb.get(slug);
}

function getMediaTypeForSlug(slug) {
  return slugToMedia.get(slug) || 'movie';
}

function getLetterboxdPoster(imdbId) {
  return posterByImdb.get(imdbId);
}

function getLetterboxdPosterBySlug(slug) {
  return posterBySlug.get(slug);
}

function getLetterboxdBackground(imdbId) {
  return backgroundByImdb.get(imdbId);
}

function loadPosterMapFromCache(metas) {
  for (const m of metas || []) {
    if (m.id?.startsWith('lbx:')) {
      const slug = m.id.slice(4);
      if (isAllowedPoster(m.poster)) posterBySlug.set(slug, m.poster);
    }
    if (m.imdbId && isAllowedPoster(m.poster)) posterByImdb.set(m.imdbId, m.poster);
    if (m.imdbId && m.background?.includes('ltrbxd.com')) backgroundByImdb.set(m.imdbId, m.background);
    if (m.slug && m.imdbId) slugToImdb.set(m.slug, m.imdbId);
    if (m.id?.startsWith('lbx:') && m.type) slugToMedia.set(m.id.slice(4), m.type);
  }
}

function clearSearchCache() {
  searchCache.clear();
  tmdb.clearTmdbCache();
  tvdb.clearTvdbCache();
}

module.exports = {
  searchCinemeta,
  searchCinemetaForFilm,
  fetchMeta,
  resolveFilm,
  resolveFilmOrFallback,
  resolveFilmFast,
  resolveFilmOrFallbackFast,
  resolveFilms,
  ensureLetterboxdPosters,
  fallbackMeta,
  catalogId,
  getImdbForSlug,
  getMediaTypeForSlug,
  getLetterboxdPoster,
  getLetterboxdPosterBySlug,
  getLetterboxdBackground,
  loadPosterMapFromCache,
  clearSearchCache
};
