const { ensureLetterboxdPosters, fallbackMeta } = require('../src/cinemeta');
const { attachPosterToFilm } = require('../src/posters');

const films = [
  { slug: '5-centimeters-per-second', name: '5 Centimeters per Second', year: '2007', lbxFilmId: '26400' },
  { slug: 'the-lovely-bones', name: 'The Lovely Bones', year: '2009', lbxFilmId: '47942' },
  { slug: 'your-name', name: 'Your Name.', year: '2016' }
];

(async () => {
  await ensureLetterboxdPosters(films);
  for (const f of films) {
    const meta = fallbackMeta(f);
    console.log(f.slug, meta.poster?.includes('ltrbxd.com'), meta.poster?.slice(0, 85));
  }
})().catch(console.error);
