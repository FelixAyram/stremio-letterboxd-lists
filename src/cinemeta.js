const CINEMETA = 'https://v3-cinemeta.strem.io';
const { fetchMediaPage, sleep } = require('./letterboxd');
const {
  EMPTY_POSTER,
  isLetterboxdPoster,
  pickLetterboxdPoster,
  attachPosterToFilm,
  posterUrlFromLbxId,
  normalizePosterUrl
} = require('./posters');
const {
  scoreCandidate,
  minAcceptScore,
  searchTitleVariants,
  titleSimilarity,
  yearMatches
} = require('./title-match');

const searchCache = new Map();
const posterByImdb = new Map();
const posterBySlug = new Map();
const backgroundByImdb = new Map();
const slugToImdb = new Map();
const slugToMedia = new Map();

function lbxPosterFor(film, imdbId) {
  return pickLetterboxdPoster(film) || posterBySlug.get(film.slug) || (imdbId && posterByImdb.get(imdbId)) || null;
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

function storeFilmMaps(film, imdbId, mediaType = 'movie') {
  slugToImdb.set(film.slug, imdbId);
  slugToMedia.set(film.slug, mediaType);
  const poster = lbxPosterFor(film, imdbId);
  if (poster) {
    posterByImdb.set(imdbId, poster);
    posterBySlug.set(film.slug, poster);
    film.poster = poster;
  }
  if (film.background) backgroundByImdb.set(imdbId, film.background);
}

function metaFromImdb(imdbId, film, cinemetaHit, mediaType = 'movie') {
  const poster = lbxPosterFor(film, imdbId) || EMPTY_POSTER;
  const background = film.background || backgroundByImdb.get(imdbId) || undefined;
  const type = mediaType === 'series' ? 'series' : 'movie';

  return {
    id: catalogId(film.slug),
    type,
    name: cinemetaHit?.name || film.name,
    poster,
    background,
    posterShape: 'poster',
    releaseInfo: cinemetaHit?.releaseInfo || film.year || '',
    imdbRating: cinemetaHit?.imdbRating,
    description: cinemetaHit?.description
  };
}

function inferPreferType(film) {
  if (film.mediaType === 'series' || film.listPrefersSeries) return 'series';
  return 'movie';
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
        storeFilmMaps(film, lbx.imdbId, mediaType);
        return metaFromImdb(lbx.imdbId, film, meta, mediaType);
      }
    }
  }

  const { hit, mediaType, score } = await searchCinemetaForFilm(film, preferType);
  if (!hit) return null;

  let imdbId = hit.id;
  let fullMeta = await fetchMeta(imdbId, mediaType);
  if (!fullMeta) {
    const alt = mediaType === 'movie' ? 'series' : 'movie';
    fullMeta = await fetchMeta(imdbId, alt);
    if (fullMeta && titleSimilarity(fullMeta.name, film.name) >= 0.35) {
      storeFilmMaps(film, imdbId, alt);
      return metaFromImdb(imdbId, film, fullMeta, alt);
    }
  }

  if (fullMeta && titleSimilarity(fullMeta.name, film.name) < 0.3 && score < 0.7) {
    return null;
  }

  storeFilmMaps(film, imdbId, mediaType);
  return metaFromImdb(imdbId, film, fullMeta || hit, mediaType);
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

async function resolveFilmOrFallback(film) {
  try {
    return (await resolveFilm(film)) || fallbackMeta(film);
  } catch {
    return fallbackMeta(film);
  }
}

async function ensureLetterboxdPosters(films, concurrency = 6) {
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
  await ensureLetterboxdPosters(films, concurrency);
  const out = [];

  for (let i = 0; i < films.length; i += concurrency) {
    const batch = films.slice(i, i + concurrency);
    const resolved = await Promise.all(batch.map((f) => resolveFilmOrFallback(f)));
    out.push(...resolved);
    if (onProgress) onProgress(Math.min(i + concurrency, films.length), films.length);
    if (i + concurrency < films.length) await sleep(80);
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
      if (isLetterboxdPoster(m.poster)) posterBySlug.set(slug, m.poster);
    }
    if (m.imdbId && isLetterboxdPoster(m.poster)) posterByImdb.set(m.imdbId, m.poster);
    if (m.imdbId && m.background?.includes('ltrbxd.com')) backgroundByImdb.set(m.imdbId, m.background);
    if (m.slug && m.imdbId) slugToImdb.set(m.slug, m.imdbId);
    if (m.id?.startsWith('lbx:') && m.type) slugToMedia.set(m.id.slice(4), m.type);
  }
}

module.exports = {
  searchCinemeta,
  searchCinemetaForFilm,
  fetchMeta,
  resolveFilm,
  resolveFilmOrFallback,
  resolveFilms,
  ensureLetterboxdPosters,
  fallbackMeta,
  catalogId,
  getImdbForSlug,
  getMediaTypeForSlug,
  getLetterboxdPoster,
  getLetterboxdPosterBySlug,
  getLetterboxdBackground,
  loadPosterMapFromCache
};
