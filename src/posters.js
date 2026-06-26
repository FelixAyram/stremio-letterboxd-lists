const EMPTY_POSTER = 'https://s.ltrbxd.com/static/img/empty-poster-230.png';

function isLetterboxdPoster(url) {
  return Boolean(url && url.includes('ltrbxd.com') && !url.includes('empty-poster'));
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

function attachPosterToFilm(film) {
  const poster = pickLetterboxdPoster(film);
  if (poster) film.poster = poster;
  return film;
}

module.exports = {
  EMPTY_POSTER,
  isLetterboxdPoster,
  posterUrlFromLbxId,
  normalizePosterUrl,
  pickLetterboxdPoster,
  attachPosterToFilm
};
