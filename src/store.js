const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LISTS_FILE = path.join(DATA_DIR, 'lists.json');
const CACHE_DIR = path.join(DATA_DIR, 'cache');

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function readLists() {
  ensureDirs();
  if (!fs.existsSync(LISTS_FILE)) {
    const defaultLists = {
      lists: [
        {
          url: 'https://letterboxd.com/ellefnning/list/for-when-you-want-to-feel-something/',
          name: 'for when you want to feel something',
          id: 'list-for-when-you-want-to-feel-something'
        }
      ]
    };
    fs.writeFileSync(LISTS_FILE, JSON.stringify(defaultLists, null, 2));
    return defaultLists;
  }
  return JSON.parse(fs.readFileSync(LISTS_FILE, 'utf8'));
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
    if (Date.now() - data.cachedAt < 6 * 60 * 60 * 1000) return data;
  } catch {}
  return null;
}

function writeListCache(listId, payload) {
  ensureDirs();
  fs.writeFileSync(cachePath(listId), JSON.stringify({ ...payload, cachedAt: Date.now() }, null, 2));
}

module.exports = { readLists, writeLists, readListCache, writeListCache, LISTS_FILE };
