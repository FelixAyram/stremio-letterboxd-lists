const { searchCinemetaForFilm, resolveFilmOrFallback } = require('../src/cinemeta');

const samples = [
  { slug: 'goblin', name: 'Goblin', year: '2016', mediaType: 'movie', listPrefersSeries: true },
  { slug: 'hello-my-twenties', name: 'Hello, My Twenties!', year: '2016', mediaType: 'movie', listPrefersSeries: true },
  { slug: 'vincenzo', name: 'Vincenzo', year: '2021', mediaType: 'movie', listPrefersSeries: true },
  { slug: 'hometown-cha-cha-cha', name: 'Hometown Cha-Cha-Cha', year: '2021', mediaType: 'movie', listPrefersSeries: true },
  { slug: 'extraordinary-attorney-woo', name: 'Extraordinary Attorney Woo', year: '2022', mediaType: 'movie', listPrefersSeries: true },
  { slug: 'business-proposal', name: 'Business Proposal', year: '2022', mediaType: 'movie', listPrefersSeries: true },
  { slug: 'strong-woman-do-bong-soon', name: 'Strong Woman Do Bong-soon', year: '2017', mediaType: 'movie', listPrefersSeries: true },
  { slug: 'the-glory', name: 'The Glory', year: '2022', mediaType: 'movie', listPrefersSeries: true },
];

async function test() {
  let ok = 0;
  for (const s of samples) {
    const resolved = await resolveFilmOrFallback(s);
    const pass = resolved.type === 'series' && resolved.id?.startsWith('lbx:');
    if (pass) ok++;
    console.log(pass ? 'OK  ' : 'FAIL', s.name, '->', resolved.type, resolved.name);
  }
  console.log(`\n${ok}/${samples.length} series detected`);
}

test().catch(console.error);
