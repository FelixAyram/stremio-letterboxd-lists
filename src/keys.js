const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const github = require('./github-sync');
const { readLists, writeLists } = require('./store');
const { listUserIds } = require('./auth');

const DATA_DIR = path.join(__dirname, '..', 'data');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const KEY_RE = /^[A-Za-z0-9_-]{20,24}$/;

function generateKey() {
  return crypto.randomBytes(16).toString('base64url');
}

function isValidKey(key) {
  return KEY_RE.test(key || '');
}

function readIndex() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(INDEX_FILE)) return { keys: {} };
  try {
    const data = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    return { keys: data.keys || {} };
  } catch {
    return { keys: {} };
  }
}

function writeIndex(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(data, null, 2));
  github.schedulePush();
}

function writeIndexLocal(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(data, null, 2));
}

function lookupKey(key) {
  if (!isValidKey(key)) return null;
  return readIndex().keys[key] || null;
}

function registerKey(key, userId, listId) {
  const index = readIndex();
  index.keys[key] = { userId, listId };
  writeIndex(index);
}

function unregisterKey(key) {
  const index = readIndex();
  delete index.keys[key];
  writeIndex(index);
}

function ensureListKey(list, existing) {
  if (list.key && isValidKey(list.key)) return list.key;
  if (existing?.key && isValidKey(existing.key)) return existing.key;
  return generateKey();
}

function attachKeysToLists(userId, lists) {
  const existing = new Map(readLists(userId).lists.map((l) => [l.id, l]));
  const usedKeys = new Set(Object.keys(readIndex().keys));

  return lists.map((list) => {
    const prev = existing.get(list.id);
    let key = ensureListKey(list, prev);
    while (usedKeys.has(key) && prev?.key !== key) {
      key = generateKey();
    }
    usedKeys.add(key);
    return { ...list, key };
  });
}

function rebuildIndex() {
  const keys = {};
  for (const userId of listUserIds()) {
    const data = readLists(userId);
    let changed = false;
    const lists = data.lists.map((list) => {
      const key = ensureListKey(list, list);
      if (key !== list.key) changed = true;
      keys[key] = { userId, listId: list.id };
      return { ...list, key };
    });
    if (changed) writeLists(userId, { lists });
  }
  writeIndex({ keys });
  return keys;
}

function manifestUrl(req, list) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}/${list.key}/manifest.json`;
}

module.exports = {
  generateKey,
  isValidKey,
  lookupKey,
  registerKey,
  unregisterKey,
  ensureListKey,
  attachKeysToLists,
  rebuildIndex,
  readIndex,
  manifestUrl,
  KEY_RE,
  writeIndexLocal
};
