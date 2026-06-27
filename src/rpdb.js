function isEnabled() {
  return Boolean(process.env.RPDB_API_KEY);
}

function apiKey() {
  return (process.env.RPDB_API_KEY || '').trim();
}

function posterType() {
  return process.env.RPDB_POSTER_TYPE || 'poster-default';
}

function posterUrl(imdbId, type = posterType()) {
  const key = apiKey();
  if (!key || !imdbId?.startsWith('tt')) return null;
  return `https://api.ratingposterdb.com/${key}/imdb/${type}/${imdbId}.jpg?fallback=true`;
}

function posterUrlTmdb(tmdbId, mediaType = 'movie', type = posterType()) {
  const key = apiKey();
  if (!key || !tmdbId) return null;
  const prefix = mediaType === 'series' ? 'series' : 'movie';
  return `https://api.ratingposterdb.com/${key}/tmdb/${type}/${prefix}-${tmdbId}.jpg?fallback=true`;
}

module.exports = {
  isEnabled,
  posterUrl,
  posterUrlTmdb
};
