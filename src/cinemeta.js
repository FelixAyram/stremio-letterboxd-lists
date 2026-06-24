const CINEMETA = 'https://v3-cinemeta.strem.io';
const { fetchFilmPage, sleep } = require('./letterboxd');

const searchCache = new Map();
const posterByImdb = new Map();
const posterBySlug = new Map();
const backgroundByImdb = new Map();
const slugToImdb = new Map();

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

async function fetchMeta(imdbId) {
  const url = `${CINEMETA}/meta/movie/${imdbId}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.meta || null;
  } catch {
    return null;
  }
}

function storeFilmMaps(film, imdbId) {
  slugToImdb.set(film.slug, imdbId);
  if (film.poster) {
    posterByImdb.set(imdbId, film.poster);
    posterBySlug.set(film.slug, film.poster);
  }
  if (film.background) backgroundByImdb.set(imdbId, film.background);
}

function metaFromImdb(imdbId, film, cinemetaHit) {
  const poster = film.poster || posterBySlug.get(film.slug) || posterByImdb.get(imdbId) || EMPTY_POSTER;
  const background = film.background || backgroundByImdb.get(imdbId) || cinemetaHit?.background;

  return {
    id: catalogId(film.slug),
    type: 'movie',
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

  const hit = await searchMovie(film.name, film.year);
  const imdbId = hit?.id || lbx.imdbId;
  if (!imdbId) return null;

  storeFilmMaps(film, imdbId);

  const fullMeta = hit ? await fetchMeta(hit.id) : await fetchMeta(imdbId);
  return metaFromImdb(imdbId, film, fullMeta || hit);
}

async function resolveFilms(films, onProgress) {
  const out = [];
  const concurrency = 3;

  for (let i = 0; i < films.length; i += concurrency) {
    const batch = films.slice(i, i + concurrency);
    const resolved = await Promise.all(batch.map((f) => resolveFilm(f)));
    for (const m of resolved) {
      if (m) out.push(m);
    }
    if (onProgress) onProgress(Math.min(i + concurrency, films.length), films.length);
    await sleep(200);
  }

  return out;
}

function getImdbForSlug(slug) {
  return slugToImdb.get(slug);
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
  }
}

module.exports = {
  searchMovie,
  fetchMeta,
  resolveFilm,
  resolveFilms,
  catalogId,
  getImdbForSlug,
  getLetterboxdPoster,
  getLetterboxdPosterBySlug,
  getLetterboxdBackground,
  loadPosterMapFromCache
};
