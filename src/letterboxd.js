const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

    let poster = node.attr('data-poster-url') || '';
    if (poster && poster.startsWith('/')) poster = `https://letterboxd.com${poster}`;

    const parsed = parseTitleYear(name);
    films.push({
      slug,
      name: parsed.title,
      year: parsed.year,
      displayName: name,
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

function getNextPageUrl(html, currentUrl) {
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
  let pageUrl = base.includes('/page/') ? base : base;
  if (!pageUrl.match(/\/page\/\d+\/$/)) {
    pageUrl = base + (base.endsWith('/') ? '' : '/') ;
    if (!pageUrl.includes('/page/')) pageUrl = base; // page 1 is base url
  }

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

function letterboxdPoster(slug, size = 230) {
  return `https://letterboxd.com/film/${slug}/image-${size}/`;
}

async function fetchImdbId(slug) {
  try {
    const html = await fetchHtml(`https://letterboxd.com/film/${slug}/`);
    const m = html.match(/imdb\.com\/title\/(tt\d+)/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

module.exports = {
  normalizeListUrl,
  listIdFromUrl,
  fetchFullList,
  parseTitleYear,
  fetchImdbId,
  letterboxdPoster,
  sleep
};
