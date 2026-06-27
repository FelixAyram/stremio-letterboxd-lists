const { LruCache } = require('./lru-cache');
const { titleSimilarity, yearMatches } = require('./title-match');
const { sleep } = require('./letterboxd');

const cache = new LruCache(200);
let token = null;
let tokenExpires = 0;

function isEnabled() {
  return Boolean(process.env.TVDB_API_KEY);
}

async function ensureToken() {
  if (!isEnabled()) return null;
  if (token && Date.now() < tokenExpires) return token;

  const res = await fetch('https://api4.thetvdb.com/v4/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ apikey: process.env.TVDB_API_KEY })
  });
  if (!res.ok) return null;
  const data = await res.json();
  token = data?.data?.token;
  tokenExpires = Date.now() + 23 * 60 * 60 * 1000;
  return token;
}

async function tvdbGet(path) {
  const auth = await ensureToken();
  if (!auth) return null;
  if (cache.has(path)) return cache.get(path);

  const res = await fetch(`https://api4.thetvdb.com/v4${path}`, {
    headers: { Authorization: `Bearer ${auth}`, Accept: 'application/json' }
  });
  if (!res.ok) return null;
  const data = await res.json();
  cache.set(path, data);
  return data;
}

async function searchSeries(title, year) {
  if (!isEnabled()) return null;
  const q = encodeURIComponent(title);
  const data = await tvdbGet(`/search?query=${q}&type=series`);
  const results = data?.data || [];

  let best = null;
  let bestScore = 0;
  for (const item of results.slice(0, 10)) {
    const name = item.name || item.title || '';
    const releaseInfo = item.year || item.first_air_time?.slice(0, 4) || '';
    const nameScore = titleSimilarity(name, title);
    const yearScore = yearMatches(releaseInfo, year);
    const score = nameScore * 0.68 + yearScore * 0.32;
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  if (!best || bestScore < 0.45) return null;

  const imdbId = best.remote_ids?.imdb_id || best.imdbId;
  if (!imdbId?.startsWith('tt')) return null;

  return {
    imdbId,
    mediaType: 'series',
    tvdbId: best.tvdb_id || best.id,
    name: best.name || title,
    releaseInfo: best.year || year || '',
    score: bestScore
  };
}

function clearTvdbCache() {
  cache.clear();
  token = null;
  tokenExpires = 0;
}

module.exports = {
  isEnabled,
  searchSeries,
  clearTvdbCache
};
