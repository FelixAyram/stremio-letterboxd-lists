const cheerio = require('cheerio');
const { posterUrlFromLbxId, normalizePosterUrl } = require('./posters');
const { LruCache } = require('./lru-cache');
const { runHeavy } = require('./resource-guard');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const filmPageCache = new LruCache(parseInt(process.env.FILM_PAGE_CACHE_SIZE || '250', 10));

function normalizeListUrl(url) {
  let u = url.trim();
  if (!u.startsWith('http')) u = 'https://' + u;
  u = u.replace(/\?.*$/, '').replace(/#.*$/, '');
  if (!u.endsWith('/')) u += '/';
  if (!u.includes('letterboxd.com')) throw new Error('URL invalida: debe ser de letterboxd.com');
  return u;
}

function listIdFromUrl(url) {
  const m = url.match(/\/list\/([^/]+)/);
  return m ? `list-${m[1]}` : `list-${Buffer.from(url).toString('base64url').slice(0, 16)}`;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`Letterboxd HTTP ${res.status} para ${url}`);
  return res.text();
}

function parsePostedIdentifier(raw) {
  if (!raw) return null;
  try {
    const info = JSON.parse(raw.replace(/&quot;/g, '"'));
    let mediaType = 'movie';
    const uid = String(info.uid || info.id || '');
    const type = String(info.type || info.typeName || info.mediaType || '').toLowerCase();

    if (
      uid.startsWith('tv:') ||
      type === 'tv' ||
      type === 'series' ||
      type === 'tvseries' ||
      info.isTv === true
    ) {
      mediaType = 'series';
    }

    const idMatch = uid.match(/^(?:film|tv):(\d+)$/);
    const filmId = idMatch ? idMatch[1] : null;

    return { mediaType, uid, filmId };
  } catch {
    return null;
  }
}

function mediaTypeFromLink(link) {
  if (!link) return null;
  if (/\/tv\//.test(link)) return 'series';
  if (/\/film\//.test(link)) return 'movie';
  return null;
}

function parseFilmsFromHtml(html) {
  const $ = cheerio.load(html);
  const films = [];
  const seen = new Set();

  $('[data-item-slug]').each((_, el) => {
    const node = $(el);
    const slug = node.attr('data-item-slug');
    if (!slug || seen.has(slug)) return;
    seen.add(slug);

    const link = node.attr('data-item-link') || node.attr('data-target-link') || '';
    const name = node.attr('data-item-name') || node.attr('data-item-full-display-name') || slug;
    const posted = parsePostedIdentifier(node.attr('data-postered-identifier'));

    let mediaType = posted?.mediaType || mediaTypeFromLink(link) || 'movie';

    const imgSrc = node.find('img[src*="ltrbxd.com"]').first().attr('src')
      || node.attr('data-poster-url')
      || node.attr('data-image');
    let poster = normalizePosterUrl(imgSrc);
    const lbxFilmId = posted?.filmId || null;
    if (!poster && lbxFilmId) poster = posterUrlFromLbxId(lbxFilmId, slug);

    const parsed = parseTitleYear(name);
    films.push({
      slug,
      link,
      name: parsed.title,
      year: parsed.year,
      displayName: name,
      mediaType,
      lbxFilmId,
      poster
    });
  });

  if (films.length) return films;

  $('li.posteritem, li.listitem').each((_, el) => {
    const node = $(el).find('[data-item-slug]').first();
    if (!node.length) return;

    const slug = node.attr('data-item-slug');
    const link = node.attr('data-item-link') || node.attr('data-target-link') || '';
    const name = node.attr('data-item-name') || node.attr('data-item-full-display-name') || slug;
    if (!slug || seen.has(slug)) return;
    seen.add(slug);

    const posted = parsePostedIdentifier(node.attr('data-postered-identifier'));
    let mediaType = posted?.mediaType || mediaTypeFromLink(link) || 'movie';

    const imgSrc = node.find('img[src*="ltrbxd.com"]').first().attr('src');
    let poster = normalizePosterUrl(imgSrc);
    const lbxFilmId = posted?.filmId || null;
    if (!poster && lbxFilmId) poster = posterUrlFromLbxId(lbxFilmId, slug);

    const parsed = parseTitleYear(name);
    films.push({
      slug,
      link,
      name: parsed.title,
      year: parsed.year,
      displayName: name,
      mediaType,
      lbxFilmId,
      poster
    });
  });

  return films;
}

function parseTitleYear(text) {
  const m = (text || '').match(/^(.+?)\s+\((\d{4})\)$/);
  if (m) return { title: m[1].trim(), year: m[2] };
  return { title: (text || '').trim(), year: null };
}

function getNextPageUrl(html) {
  const $ = cheerio.load(html);
  const next = $('.paginate-nextprev a.next').attr('href');
  if (!next) return null;
  if (next.startsWith('http')) return next;
  return `https://letterboxd.com${next}`;
}

function getListTitle(html) {
  const $ = cheerio.load(html);
  const og = $('meta[property="og:title"]').attr('content');
  if (og) return og.trim();
  const h1 = $('.list-title h1, .content-title').first().text();
  return h1.trim() || 'Letterboxd List';
}

function parseFilmPage(html) {
  const imdb = html.match(/imdb\.com\/title\/(tt\d+)/i);
  const imdbId = imdb ? imdb[1] : null;

  let mediaType = 'movie';
  if (
    html.includes('"@type":"TVSeries"') ||
    html.includes('"@type": "TVSeries"') ||
    html.includes('tv-series-badge') ||
    /href="\/tv\//.test(html) ||
    /themoviedb\.org\/tv\//.test(html)
  ) {
    mediaType = 'series';
  }

  const tmdb = html.match(/themoviedb\.org\/(tv|movie)\/(\d+)/i);
  const tmdbType = tmdb ? (tmdb[1].toLowerCase() === 'tv' ? 'series' : 'movie') : null;
  const tmdbId = tmdb ? tmdb[2] : null;
  if (tmdbType === 'series') mediaType = 'series';

  let pageTitle = null;
  let pageYear = null;
  const og = html.match(/property="og:title"\s+content="([^"]+)"/i);
  if (og) {
    const cleaned = og[1].replace(/\s*[-–—]\s*Letterboxd.*$/i, '').trim();
    const parsed = parseTitleYear(cleaned);
    pageTitle = parsed.title;
    pageYear = parsed.year;
  }
  if (!pageTitle) {
    const jsonName = html.match(/"@type":"(?:Movie|TVSeries)"[^}]*"name":"([^"]+)"/);
    if (jsonName) {
      const parsed = parseTitleYear(jsonName[1]);
      pageTitle = parsed.title;
      pageYear = pageYear || parsed.year;
    }
  }

  let lbxFilmId = null;
  const uidMatch = html.match(/"uid"\s*:\s*"(?:film|tv):(\d+)"/);
  if (uidMatch) lbxFilmId = uidMatch[1];
  if (!lbxFilmId) {
    const pathMatch = html.match(/film-poster\/(?:\d\/)+\d+\/(\d+)-/);
    if (pathMatch) lbxFilmId = pathMatch[1];
  }

  let poster = null;

  const filmPosters = [...html.matchAll(/https:\/\/a\.ltrbxd\.com\/resized\/film-poster\/[^"'\s<>]+/g)];
  if (filmPosters.length) {
    const vertical = filmPosters.find((m) => m[0].includes('230-0-345'));
    poster = vertical ? vertical[0] : filmPosters[0][0];
  }

  if (!poster) {
    const schemaImage = html.match(/\{"image":"(https:\/\/a\.ltrbxd\.com\/[^"]+)"[^}]*"@type":"Movie"/);
    if (schemaImage) poster = schemaImage[1];
  }

  if (!poster) {
    const vertical = html.match(/https:\/\/a\.ltrbxd\.com\/resized\/[^"'\s<>]*-0-230-0-345-crop[^"'\s<>]*/);
    if (vertical) poster = vertical[0];
  }

  if (!poster && lbxFilmId) {
    const slugMatch = html.match(/letterboxd\.com\/film\/([^/"']+)/);
    const pageSlug = slugMatch ? slugMatch[1] : null;
    if (pageSlug) poster = posterUrlFromLbxId(lbxFilmId, pageSlug);
  }

  poster = normalizePosterUrl(poster) || poster;

  const backdrop = html.match(/data-backdrop="([^"]+)"/);
  const background = backdrop ? backdrop[1] : null;

  return { imdbId, poster, background, mediaType, tmdbId, tmdbType, pageTitle, pageYear, lbxFilmId };
}

function pageUrlsForSlug(slug, opts = {}) {
  const urls = [];
  const add = (path) => {
    if (!path) return;
    const full = path.startsWith('http') ? path : `https://letterboxd.com${path}`;
    if (!urls.includes(full)) urls.push(full);
  };

  if (opts.link) add(opts.link);
  if (opts.year) {
    add(`/film/${slug}-${opts.year}/`);
    add(`/tv/${slug}-${opts.year}/`);
  }
  if (opts.mediaType === 'series') {
    add(`/tv/${slug}/`);
    add(`/film/${slug}/`);
  } else {
    add(`/film/${slug}/`);
    add(`/tv/${slug}/`);
  }

  return urls;
}

async function fetchMediaPage(slug, opts = {}) {
  const cacheKey = `${slug}|${opts.link || ''}|${opts.mediaType || ''}|${opts.year || ''}`;
  if (filmPageCache.has(cacheKey)) return filmPageCache.get(cacheKey);

  const urls = pageUrlsForSlug(slug, opts);
  let best = null;

  for (const url of urls) {
    try {
      const html = await fetchHtml(url);
      const data = parseFilmPage(html);
      const yearOk = !opts.year || !data.pageYear || data.pageYear === opts.year;
      if (data.imdbId && yearOk) {
        filmPageCache.set(cacheKey, data);
        return data;
      }
      if (!best || (data.mediaType === 'series' && best.mediaType !== 'series')) {
        best = data;
      }
    } catch {
      // try next URL shape
    }
  }

  const result = best || { imdbId: null, poster: null, background: null, mediaType: opts.mediaType || 'movie' };
  filmPageCache.set(cacheKey, result);
  return result;
}

async function fetchFilmPage(slug) {
  return fetchMediaPage(slug, {});
}

async function fetchListPage(url) {
  const html = await fetchHtml(url);
  return {
    html,
    title: getListTitle(html),
    films: parseFilmsFromHtml(html),
    nextPage: getNextPageUrl(html)
  };
}

async function fetchListTitle(listUrl) {
  const base = normalizeListUrl(listUrl);
  const page = await fetchListPage(base);
  return page.title;
}

async function fetchFullList(listUrl) {
  return runHeavy(() => fetchFullListInner(listUrl), 'fetchFullList');
}

async function fetchFullListInner(listUrl) {
  const base = normalizeListUrl(listUrl);
  const allFilms = [];
  const seen = new Set();
  let title = 'Letterboxd List';
  let url = base;
  let pages = 0;
  const maxPages = 50;

  while (url && pages < maxPages) {
    const page = await fetchListPage(url);
    if (pages === 0) title = page.title;
    for (const f of page.films) {
      if (!seen.has(f.slug)) {
        seen.add(f.slug);
        allFilms.push(f);
      }
    }
    url = page.nextPage;
    pages++;
    if (url) await sleep(400);
  }

  const { listPrefersSeries } = require('./title-match');
  const preferSeries = listPrefersSeries(title, allFilms);
  if (preferSeries) {
    for (const f of allFilms) {
      if (f.mediaType !== 'series') f.listPrefersSeries = true;
    }
  }

  return { id: listIdFromUrl(base), title, url: base, films: allFilms, preferSeries };
}

function clearFilmPageCache() {
  filmPageCache.clear();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchImdbId(slug) {
  const { imdbId } = await fetchMediaPage(slug, {});
  return imdbId;
}

module.exports = {
  normalizeListUrl,
  listIdFromUrl,
  fetchFullList,
  fetchListTitle,
  parseTitleYear,
  parseFilmsFromHtml,
  fetchImdbId,
  fetchFilmPage,
  fetchMediaPage,
  clearFilmPageCache,
  sleep
};
