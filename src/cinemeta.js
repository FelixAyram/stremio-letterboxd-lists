const CINEMETA = 'https://v3-cinemeta.strem.io';
const { fetchFilmPage, sleep } = require('./letterboxd');

const searchCache = new Map();
const posterByImdb = new Map();
const posterBySlug = new Map();
const backgroundByImdb = new Map();
const slugToImdb = new Map();
const slugToMedia = new Map();

const EMPTY_POSTER = 'https://s.ltrbxd.com/static/img/empty-poster-230.png';

function normalizeName(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function catalogId(slug) {
  return `lbx:${slug}`;
}

async function searchMovie(title, year, retries = 3) {
  const key = `${title}|${year || ''}`;
  if (searchCache.has(key)) return searchCache.get(key);

  const query = year ? `${title} ${year}` : title;
  const url = `${CINEMETA}/catalog/movie/top/search=${encodeURIComponent(query)}.json`;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        await sleep(300 * (attempt + 1));
        continue;
      }
      const data = await res.json();
      const metas = data.metas || [];
      if (!metas.length) break;

      const target = normalizeName(title);
      let best = metas.find((m) => normalizeName(m.name) === target);
      if (!best && year) {
        best = metas.find((m) => normalizeName(m.name) === target && (m.releaseInfo || '').startsWith(year));
      }
      if (!best) best = metas[0];

      const result = best?.id?.startsWith('tt') ? best : null;
      searchCache.set(key, result);
      return result;
    } catch {
      await sleep(300 * (attempt + 1));
    }
  }

  searchCache.set(key, null);
  return null;
}

async function searchSeries(title, year, retries = 3) {
  const key = `s|${title}|${year || ''}`;
  if (searchCache.has(key)) return searchCache.get(key);

  const query = year ? `${title} ${year}` : title;
  const url = `${CINEMETA}/catalog/series/top/search=${encodeURIComponent(query)}.json`;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        await sleep(300 * (attempt + 1));
        continue;
      }
      const data = await res.json();
      const metas = data.metas || [];
      if (!metas.length) break;

      const target = normalizeName(title);
      let best = metas.find((m) => normalizeName(m.name) === target);
      if (!best && year) {
        best = metas.find((m) => normalizeName(m.name) === target && (m.releaseInfo || '').startsWith(year));
      }
      if (!best) best = metas[0];

      const result = best?.id?.startsWith('tt') ? best : null;
      searchCache.set(key, result);
      return result;
    } catch {
      await sleep(300 * (attempt + 1));
    }
  }

  searchCache.set(key, null);
  return null;
}

async function searchCinemeta(title, year, preferType = 'movie') {
  const tryMovieFirst = preferType !== 'series';
  const first = tryMovieFirst ? searchMovie : searchSeries;
  const second = tryMovieFirst ? searchSeries : searchMovie;
  const firstType = tryMovieFirst ? 'movie' : 'series';
  const secondType = tryMovieFirst ? 'series' : 'movie';

  let hit = await first(title, year);
  if (hit) return { hit, mediaType: firstType };
  hit = await second(title, year);
  if (hit) return { hit, mediaType: secondType };
  return { hit: null, mediaType: preferType };
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

function storeFilmMaps(film, imdbId, mediaType = 'movie') {
  slugToImdb.set(film.slug, imdbId);
  slugToMedia.set(film.slug, mediaType);
  if (film.poster) {
    posterByImdb.set(imdbId, film.poster);
    posterBySlug.set(film.slug, film.poster);
  }
  if (film.background) backgroundByImdb.set(imdbId, film.background);
}

function metaFromImdb(imdbId, film, cinemetaHit, mediaType = 'movie') {
  const poster = film.poster || posterBySlug.get(film.slug) || posterByImdb.get(imdbId) || EMPTY_POSTER;
  const background = film.background || backgroundByImdb.get(imdbId) || cinemetaHit?.background;
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

async function resolveFilm(film) {
  const lbx = await fetchFilmPage(film.slug);
  if (lbx.poster) film.poster = lbx.poster;
  if (lbx.background) film.background = lbx.background;

  const preferType = film.mediaType === 'series' || lbx.mediaType === 'series' ? 'series' : 'movie';
  const { hit, mediaType } = await searchCinemeta(film.name, film.year, preferType);

  let imdbId = hit?.id || lbx.imdbId;
  if (!imdbId) return null;

  let fullMeta = hit ? await fetchMeta(hit.id, mediaType) : null;
  if (!fullMeta && lbx.imdbId) {
    fullMeta = await fetchMeta(lbx.imdbId, mediaType);
    if (!fullMeta) {
      const alt = mediaType === 'movie' ? 'series' : 'movie';
      fullMeta = await fetchMeta(lbx.imdbId, alt);
      if (fullMeta) {
        storeFilmMaps(film, lbx.imdbId, alt);
        return metaFromImdb(lbx.imdbId, film, fullMeta || hit, alt);
      }
    }
  }

  storeFilmMaps(film, imdbId, mediaType);
  return metaFromImdb(imdbId, film, fullMeta || hit, mediaType);
}

function fallbackMeta(film) {
  const poster = film.poster || posterBySlug.get(film.slug) || EMPTY_POSTER;
  const type = film.mediaType === 'series' ? 'series' : 'movie';
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

async function resolveFilms(films, onProgress, concurrency = 3) {
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
      if (m.poster?.includes('ltrbxd.com')) posterBySlug.set(slug, m.poster);
    }
    if (m.imdbId && m.poster?.includes('ltrbxd.com')) posterByImdb.set(m.imdbId, m.poster);
    if (m.imdbId && m.background?.includes('ltrbxd.com')) backgroundByImdb.set(m.imdbId, m.background);
    if (m.slug && m.imdbId) slugToImdb.set(m.slug, m.imdbId);
    if (m.id?.startsWith('lbx:') && m.type) slugToMedia.set(m.id.slice(4), m.type);
  }
}

module.exports = {
  searchMovie,
  searchSeries,
  searchCinemeta,
  fetchMeta,
  resolveFilm,
  resolveFilmOrFallback,
  resolveFilms,
  fallbackMeta,
  catalogId,
  getImdbForSlug,
  getMediaTypeForSlug,
  getLetterboxdPoster,
  getLetterboxdPosterBySlug,
  getLetterboxdBackground,
  loadPosterMapFromCache
};
