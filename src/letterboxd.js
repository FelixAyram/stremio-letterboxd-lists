const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const filmPageCache = new Map();

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

function parseFilmsFromHtml(html) {
  const $ = cheerio.load(html);
  const films = [];
  const seen = new Set();

  $('li.posteritem, li.listitem').each((_, el) => {
    const node = $(el).find('[data-item-slug]').first();
    if (!node.length) return;

    const slug = node.attr('data-item-slug');
    const name = node.attr('data-item-name') || node.attr('data-item-full-display-name') || slug;
    if (!slug || seen.has(slug)) return;
    seen.add(slug);

    const parsed = parseTitleYear(name);
    films.push({
      slug,
      name: parsed.title,
      year: parsed.year,
      displayName: name
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

  const posters = [...html.matchAll(/https:\/\/a\.ltrbxd\.com\/resized\/film-poster\/[^"'\s<>]+/g)];
  let poster = posters.length ? posters[0][0] : null;

  if (!poster) {
    const og = html.match(/property="og:image" content="([^"]+)"/);
    poster = og ? og[1] : null;
  }

  const backdrop = html.match(/data-backdrop="([^"]+)"/);
  const background = backdrop ? backdrop[1] : null;

  return { imdbId, poster, background };
}

async function fetchFilmPage(slug) {
  if (filmPageCache.has(slug)) return filmPageCache.get(slug);
  try {
    const html = await fetchHtml(`https://letterboxd.com/film/${slug}/`);
    const data = parseFilmPage(html);
    filmPageCache.set(slug, data);
    return data;
  } catch {
    const empty = { imdbId: null, poster: null, background: null };
    filmPageCache.set(slug, empty);
    return empty;
  }
}

async function fetchListPage(url) {
  const html = await fetchHtml(url);
  return {
    html,
    title: getListTitle(html),
    films: parseFilmsFromHtml(html),
    nextPage: getNextPageUrl(html, url)
  };
}

async function fetchFullList(listUrl) {
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

  return { id: listIdFromUrl(base), title, url: base, films: allFilms };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchImdbId(slug) {
  const { imdbId } = await fetchFilmPage(slug);
  return imdbId;
}

module.exports = {
  normalizeListUrl,
  listIdFromUrl,
  fetchFullList,
  parseTitleYear,
  fetchImdbId,
  fetchFilmPage,
  sleep
};
