const { searchCinemeta, fetchMeta, resolveFilmOrFallback } = require('../src/cinemeta');
const { parseFilmsFromHtml, parseFilmPage, fetchFilmPage } = require('../src/letterboxd');

const samples = [
  { slug: 'goblin', name: 'Goblin', year: '2016', mediaType: 'series' },
  { slug: 'crash-landing-on-you', name: 'Crash Landing on You', year: '2019', mediaType: 'series' },
  { slug: 'descendants-of-the-sun', name: 'Descendants of the Sun', year: '2016', mediaType: 'series' },
  { slug: 'itaewon-class', name: 'Itaewon Class', year: '2020', mediaType: 'series' },
  { slug: 'squid-game', name: 'Squid Game', year: '2021', mediaType: 'series' },
  { slug: 'my-love-from-the-star', name: 'My Love from the Star', year: '2013', mediaType: 'series' },
  { slug: 'reply-1988', name: 'Reply 1988', year: '2015', mediaType: 'series' },
  { slug: 'kingdom', name: 'Kingdom', year: '2019', mediaType: 'series' },
];

async function testSearch() {
  for (const s of samples) {
    const movie = await searchCinemeta(s.name, s.year, 'series');
    const resolved = await resolveFilmOrFallback(s);
    console.log(s.name, '->', resolved?.type, resolved?.name, resolved?.id, movie.hit?.id, movie.hit?.name);
  }
}

testSearch().catch(console.error);
