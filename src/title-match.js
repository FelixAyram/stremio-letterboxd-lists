function normalizeName(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenSet(s) {
  return new Set(
    normalizeName(s)
      .split(' ')
      .filter((w) => w.length > 1)
  );
}

function titleSimilarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (!ta.size || !tb.size) return 0;

  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = new Set([...ta, ...tb]).size;
  const jaccard = inter / union;

  if (na.includes(nb) || nb.includes(na)) return Math.max(jaccard, 0.88);
  return jaccard;
}

function yearsFromReleaseInfo(releaseInfo) {
  return [...String(releaseInfo || '').matchAll(/\d{4}/g)].map((m) => parseInt(m[0], 10));
}

function yearMatches(releaseInfo, year) {
  if (!year) return 0.45;
  const target = parseInt(year, 10);
  if (!Number.isFinite(target)) return 0.45;
  const found = yearsFromReleaseInfo(releaseInfo);
  if (!found.length) return 0.35;
  return found.some((y) => Math.abs(y - target) <= 1) ? 1 : 0;
}

function scoreCandidate(meta, title, year, mediaType, preferType) {
  const nameScore = titleSimilarity(meta.name, title);
  const yearScore = yearMatches(meta.releaseInfo, year);
  let score = nameScore * 0.68 + yearScore * 0.32;
  if (mediaType === preferType) score += 0.06;
  if (preferType === 'series' && mediaType === 'series') score += 0.04;
  if (preferType === 'series' && mediaType === 'series' && year && yearScore === 1) score += 0.1;
  if (preferType === 'series' && mediaType === 'movie' && year && yearScore === 0) score *= 0.3;
  if (preferType === 'series' && mediaType === 'movie' && nameScore >= 0.95 && year && yearScore === 0) {
    score *= 0.2;
  }
  if (preferType === 'series' && year && nameScore < 0.35 && yearScore === 1) {
    score = Math.max(score, 0.55 + (mediaType === 'series' ? 0.12 : 0));
  }
  return score;
}

function minAcceptScore(preferType) {
  return preferType === 'series' ? 0.48 : 0.55;
}

function searchTitleVariants(film) {
  const out = new Set();
  const add = (t) => {
    const v = (t || '').trim();
    if (v) out.add(v);
  };

  add(film.name);
  add(film.displayName);
  add(film.pageTitle);
  if (film.slug) add(film.slug.replace(/-/g, ' '));

  const variants = [...out];
  for (const v of variants) {
    const parsed = v.match(/^(.+?)\s+\((\d{4})\)$/);
    if (parsed) add(parsed[1].trim());
    const beforeColon = v.split(':')[0].trim();
    if (beforeColon.length >= 4) add(beforeColon);
  }

  return [...out];
}

const SERIES_LIST_HINTS = /kdrama|k-drama|tv\s*show|television|mini-?series|series\b|dramas?\b|anime\s*series/i;

function listPrefersSeries(title, films = []) {
  if (SERIES_LIST_HINTS.test(title || '')) return true;
  if (!films.length) return false;
  const seriesCount = films.filter((f) => f.mediaType === 'series').length;
  return seriesCount / films.length >= 0.3;
}

module.exports = {
  normalizeName,
  titleSimilarity,
  yearMatches,
  scoreCandidate,
  minAcceptScore,
  searchTitleVariants,
  listPrefersSeries
};
