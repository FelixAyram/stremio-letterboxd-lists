const rpdb = require('./rpdb');
const tmdb = require('./tmdb');

const EMPTY_POSTER = 'https://s.ltrbxd.com/static/img/empty-poster-230.png';

function posterMode() {
  return (process.env.POSTER_MODE || 'letterboxd+rpdb').toLowerCase();
}

function isLetterboxdPoster(url) {
  return Boolean(url && url.includes('ltrbxd.com') && !url.includes('empty-poster'));
}

function isRpdbPoster(url) {
  return Boolean(url && url.includes('ratingposterdb.com'));
}

function isAllowedPoster(url) {
  if (!url || url.includes('empty-poster')) return false;
  if (isLetterboxdPoster(url)) return true;
  if (isRpdbPoster(url) && rpdb.isEnabled()) return true;
  if (url.includes('image.tmdb.org') && tmdb.isEnabled()) return true;
  return false;
}

function posterUrlFromLbxId(filmId, slug) {
  if (!filmId || !slug) return null;
  const id = String(filmId);
  const path = id.split('').join('/');
  return `https://a.ltrbxd.com/resized/film-poster/${path}/${id}-${slug}-0-230-0-345-crop.jpg`;
}

function normalizePosterUrl(url) {
  if (!url || !isLetterboxdPoster(url)) return null;
  if (url.includes('/resized/sm/upload/')) return url;
  if (url.includes('-0-230-0-345-crop')) return url.split('?')[0];
  return url
    .replace(/-0-\d+-0-\d+-crop/g, '-0-230-0-345-crop')
    .replace(/-0-460-0-690-crop/g, '-0-230-0-345-crop')
    .replace(/-0-600-0-900-crop/g, '-0-230-0-345-crop')
    .split('?')[0];
}

function pickLetterboxdPoster(film) {
  const candidates = [
    film?.poster,
    film?.listPoster,
    film?.lbxFilmId ? posterUrlFromLbxId(film.lbxFilmId, film.slug) : null
  ];
  for (const c of candidates) {
    const normalized = normalizePosterUrl(c);
    if (normalized) return normalized;
  }
  return null;
}

function pickRpdbPoster(imdbId, tmdbId, mediaType) {
  if (!rpdb.isEnabled() || !imdbId) return null;
  return rpdb.posterUrl(imdbId) || (tmdbId ? rpdb.posterUrlTmdb(tmdbId, mediaType) : null);
}

function pickDisplayPoster(film, imdbId, extras = {}) {
  const mode = posterMode();
  const lbx = pickLetterboxdPoster(film);
  const rpdbPoster = pickRpdbPoster(imdbId, extras.tmdbId, extras.mediaType || film.mediaType);
  const tmdbPoster = extras.tmdbPoster || null;

  if (mode === 'rpdb') {
    return rpdbPoster || lbx || tmdbPoster || EMPTY_POSTER;
  }
  if (mode === 'letterboxd') {
    return lbx || rpdbPoster || tmdbPoster || EMPTY_POSTER;
  }
  // letterboxd+rpdb (default)
  return lbx || rpdbPoster || tmdbPoster || EMPTY_POSTER;
}

function attachPosterToFilm(film) {
  const poster = pickLetterboxdPoster(film);
  if (poster) film.poster = poster;
  return film;
}

module.exports = {
  EMPTY_POSTER,
  isLetterboxdPoster,
  isRpdbPoster,
  isAllowedPoster,
  posterUrlFromLbxId,
  normalizePosterUrl,
  pickLetterboxdPoster,
  pickRpdbPoster,
  pickDisplayPoster,
  attachPosterToFilm
};
