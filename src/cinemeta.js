const CINEMETA = 'https://v3-cinemeta.strem.io';
const { fetchImdbId, sleep } = require('./letterboxd');

const cache = new Map();

function normalizeName(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function searchMovie(title, year, retries = 3) {
  const key = `${title}|${year || ''}`;
  if (cache.has(key)) return cache.get(key);

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
      cache.set(key, result);
      return result;
    } catch {
      await sleep(300 * (attempt + 1));
    }
  }

  cache.set(key, null);
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

function letterboxdPoster(slug, size = 230) {
  return `https://letterboxd.com/film/${slug}/image-${size}/`;
}

function resolvePoster(film, cinemetaHit) {
  if (film.poster) return film.poster.replace('/image-150/', '/image-230/');
  if (film.slug) return letterboxdPoster(film.slug);
  if (cinemetaHit?.poster) return cinemetaHit.poster;
  return 'https://s.ltrbxd.com/static/img/empty-poster-230.png';
}

function metaFromImdb(imdbId, film, cinemetaHit) {
  const name = cinemetaHit?.name || film.name;
  const year = cinemetaHit?.releaseInfo || film.year || '';
  return {
    id: imdbId,
    type: 'movie',
    name,
    poster: resolvePoster(film, cinemetaHit),
    background: cinemetaHit?.background || undefined,
    posterShape: 'poster',
    releaseInfo: year,
    imdbRating: cinemetaHit?.imdbRating,
    description: cinemetaHit?.description
  };
}

async function resolveFilm(film) {
  let hit = await searchMovie(film.name, film.year);

  if (!hit) {
    const imdbId = await fetchImdbId(film.slug);
    if (imdbId) {
      const meta = await fetchMeta(imdbId);
      return metaFromImdb(imdbId, film, meta);
    }
    return null;
  }

  const fullMeta = await fetchMeta(hit.id);
  return metaFromImdb(hit.id, film, fullMeta || hit);
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
    await sleep(150);
  }

  return out;
}

module.exports = { searchMovie, fetchMeta, resolveFilm, resolveFilms, letterboxdPoster };
