const { LruCache } = require('./lru-cache');
const { scoreCandidate, minAcceptScore, searchTitleVariants } = require('./title-match');
const { sleep } = require('./letterboxd');

const BASE = 'https://api.themoviedb.org/3';
const cache = new LruCache(500);

function isEnabled() {
  return Boolean(process.env.TMDB_API_KEY);
}

function apiKey() {
  return process.env.TMDB_API_KEY || '';
}

async function tmdbGet(path, retries = 2) {
  if (!isEnabled()) return null;
  const key = `${path}`;
  if (cache.has(key)) return cache.get(key);

  const sep = path.includes('?') ? '&' : '?';
  const url = `${BASE}${path}${sep}api_key=${apiKey()}`;

  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' }
      });
      if (res.status === 429) {
        await sleep(800 * (i + 1));
        continue;
      }
      if (!res.ok) return null;
      const data = await res.json();
      cache.set(key, data);
      return data;
    } catch {
      await sleep(300);
    }
  }
  return null;
}

function tmdbMetaFromItem(item, mediaType) {
  const name = item.title || item.name || '';
  const date = item.release_date || item.first_air_date || '';
  const year = date ? date.slice(0, 4) : '';
  return {
    name,
    releaseInfo: year,
    release_date: date,
    poster_path: item.poster_path,
    backdrop_path: item.backdrop_path,
    overview: item.overview,
    vote_average: item.vote_average,
    id: item.id,
    mediaType
  };
}

async function searchTmdbType(title, year, mediaType, preferType) {
  const kind = mediaType === 'series' ? 'tv' : 'movie';
  const path =
    kind === 'tv'
      ? `/search/tv?query=${encodeURIComponent(title)}${year ? `&first_air_date_year=${year}` : ''}`
      : `/search/movie?query=${encodeURIComponent(title)}${year ? `&year=${year}` : ''}`;

  const data = await tmdbGet(path);
  const results = data?.results || [];
  let best = null;
  let bestScore = 0;

  for (const item of results.slice(0, 12)) {
    const meta = tmdbMetaFromItem(item, mediaType);
    const score = scoreCandidate(meta, title, year, mediaType, preferType);
    if (score > bestScore) {
      bestScore = score;
      best = { item, meta, score, mediaType };
    }
  }

  const minScore = minAcceptScore(preferType);
  if (!best || bestScore < minScore) {
    return { hit: null, mediaType, score: bestScore };
  }
  return { hit: best.meta, raw: best.item, mediaType: best.mediaType, score: bestScore, tmdbId: best.item.id };
}

async function externalIds(tmdbId, mediaType) {
  const kind = mediaType === 'series' ? 'tv' : 'movie';
  const data = await tmdbGet(`/${kind}/${tmdbId}/external_ids`);
  return data || {};
}

async function findByImdb(imdbId) {
  return tmdbGet(`/find/${imdbId}?external_source=imdb_id`);
}

async function details(tmdbId, mediaType) {
  const kind = mediaType === 'series' ? 'tv' : 'movie';
  return tmdbGet(`/${kind}/${tmdbId}`);
}

function posterUrl(posterPath, size = 'w500') {
  if (!posterPath) return null;
  return `https://image.tmdb.org/t/p/${size}${posterPath}`;
}

function backdropUrl(path, size = 'w1280') {
  if (!path) return null;
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

async function resolveTmdbHit(hit, mediaType) {
  if (!hit?.tmdbId && !hit?.id) return null;
  const tmdbId = hit.tmdbId || hit.id;
  const ext = await externalIds(tmdbId, mediaType);
  const imdbId = ext.imdb_id;
  if (!imdbId?.startsWith('tt')) return null;

  const detail = await details(tmdbId, mediaType);
  const meta = detail ? tmdbMetaFromItem(
    { ...detail, id: tmdbId },
    mediaType
  ) : hit;

  return {
    imdbId,
    mediaType,
    tmdbId,
    tvdbId: ext.tvdb_id || null,
    meta,
    poster: posterUrl(meta.poster_path || detail?.poster_path),
    background: backdropUrl(meta.backdrop_path || detail?.backdrop_path)
  };
}

async function searchTmdbForFilm(film, preferType = 'movie') {
  if (!isEnabled()) return null;

  const titles = searchTitleVariants(film);
  const wantsSeries = preferType === 'series' || film.listPrefersSeries;

  async function bestForType(type, scorePrefer) {
    let best = { hit: null, mediaType: type, score: 0, tmdbId: null, raw: null };
    for (const title of titles) {
      const result = await searchTmdbType(title, film.year, type, scorePrefer || preferType);
      if (result.hit && result.score > best.score) best = result;
      if (best.score >= 0.92) break;
    }
    return best;
  }

  let pick;
  if (wantsSeries) {
    const seriesBest = await bestForType('series', 'series');
    if (seriesBest.hit && seriesBest.score >= minAcceptScore('series')) pick = seriesBest;
    else {
      const movieBest = await bestForType('movie', 'movie');
      pick = seriesBest.score >= movieBest.score ? seriesBest : movieBest;
    }
  } else {
    pick = await bestForType('movie', 'movie');
  }

  if (!pick?.hit || !pick.tmdbId) return null;
  return resolveTmdbHit({ ...pick.hit, tmdbId: pick.tmdbId }, pick.mediaType);
}

async function lookupImdbOnTmdb(imdbId, preferType = 'movie') {
  if (!isEnabled() || !imdbId) return null;
  const found = await findByImdb(imdbId);
  if (!found) return null;

  const tryTypes =
    preferType === 'series'
      ? [{ list: found.tv_results, type: 'series' }, { list: found.movie_results, type: 'movie' }]
      : [{ list: found.movie_results, type: 'movie' }, { list: found.tv_results, type: 'series' }];

  for (const { list, type } of tryTypes) {
    const item = list?.[0];
    if (!item) continue;
    const resolved = await resolveTmdbHit({ ...tmdbMetaFromItem(item, type), tmdbId: item.id }, type);
    if (resolved) return resolved;
  }
  return null;
}

function clearTmdbCache() {
  cache.clear();
}

module.exports = {
  isEnabled,
  searchTmdbForFilm,
  lookupImdbOnTmdb,
  posterUrl,
  backdropUrl,
  clearTmdbCache
};
