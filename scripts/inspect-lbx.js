const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function attrsFromTag(tag) {
  const get = (name) => {
    const m = tag.match(new RegExp(`${name}="([^"]*)"`));
    return m ? m[1] : null;
  };
  return {
    slug: get('data-item-slug'),
    link: get('data-item-link') || get('data-target-link'),
    name: get('data-item-name') || get('data-item-full-display-name'),
    posted: get('data-postered-identifier')
  };
}

async function main() {
  const listUrl = 'https://letterboxd.com/asfriansyah/list/150-highest-rated-kdramas-on-letterboxd/1/';
  const html = await fetch(listUrl, { headers: { 'User-Agent': UA } }).then((r) => r.text());
  console.log('html len', html.length);

  const tags = [...html.matchAll(/<div[^>]*data-item-slug="[^"]+"[^>]*>/g)].map((m) => m[0]);
  console.log('tags found', tags.length);
  const items = tags.slice(0, 10).map(attrsFromTag);
  console.log('LIST ITEMS:', JSON.stringify(items, null, 2));

  for (const item of items.slice(0, 5)) {
    if (!item.link) continue;
    const pageUrl = item.link.startsWith('http') ? item.link : `https://letterboxd.com${item.link}`;
    const page = await fetch(pageUrl, { headers: { 'User-Agent': UA } }).then((r) => r.text());
    const imdb = page.match(/imdb\.com\/title\/(tt\d+)/i)?.[1];
    const tv = page.includes('TVSeries') || page.includes('tv-series-badge');
    const tmdb = page.match(/themoviedb\.org\/(tv|movie)\/(\d+)/);
    let postedType = null;
    if (item.posted) {
      try { postedType = JSON.parse(item.posted.replace(/&quot;/g, '"')); } catch {}
    }
    console.log('\nPAGE', item.slug, pageUrl);
    console.log('  list posted:', postedType);
    console.log('  imdb:', imdb, 'tv:', tv, 'tmdb:', tmdb?.[0]);
  }
}

main().catch(console.error);
