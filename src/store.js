const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LISTS_FILE = path.join(DATA_DIR, 'lists.json');
const CACHE_DIR = path.join(DATA_DIR, 'cache');

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function defaultLists() {
  return {
    lists: [
      {
        url: 'https://letterboxd.com/ellefnning/list/for-when-you-want-to-feel-something/',
        name: 'for when you want to feel something',
        id: 'list-for-when-you-want-to-feel-something'
      }
    ]
  };
}

function readLists() {
  ensureDirs();

  if (fs.existsSync(LISTS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(LISTS_FILE, 'utf8'));
      if (data.lists?.length) return data;
    } catch {}
  }

  if (process.env.LISTS_JSON) {
    try {
      const data = JSON.parse(process.env.LISTS_JSON);
      if (data.lists?.length) {
        writeLists(data);
        return data;
      }
    } catch {}
  }

  const data = defaultLists();
  writeLists(data);
  return data;
}

function writeLists(data) {
  ensureDirs();
  fs.writeFileSync(LISTS_FILE, JSON.stringify(data, null, 2));
}

function cachePath(listId) {
  return path.join(CACHE_DIR, `${listId}.json`);
}

function readListCache(listId) {
  const p = cachePath(listId);
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (Date.now() - data.cachedAt > 6 * 60 * 60 * 1000) return null;
    const badPoster = data.metas?.some(
      (m) => m.poster && !m.poster.includes('ltrbxd.com') && !m.poster.includes('empty-poster')
    );
    const oldIds = data.metas?.some((m) => m.id?.startsWith('tt'));
    const landscapePoster = data.metas?.some(
      (m) => m.poster && (m.poster.includes('675-675-crop') || m.poster.includes('1200-1200-675'))
    );
    if (badPoster || oldIds || landscapePoster) return null;
    return data;
  } catch {}
  return null;
}

function writeListCache(listId, payload) {
  ensureDirs();
  fs.writeFileSync(cachePath(listId), JSON.stringify({ ...payload, cachedAt: Date.now() }, null, 2));
}

function filmListCachePath(listId) {
  return path.join(CACHE_DIR, `${listId}-films.json`);
}

function readFilmListCache(listId) {
  const p = filmListCachePath(listId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {}
  return null;
}

function writeFilmListCache(listId, payload) {
  ensureDirs();
  fs.writeFileSync(filmListCachePath(listId), JSON.stringify({ ...payload, cachedAt: Date.now() }, null, 2));
}

module.exports = {
  readLists,
  writeLists,
  readListCache,
  writeListCache,
  readFilmListCache,
  writeFilmListCache,
  LISTS_FILE
};
