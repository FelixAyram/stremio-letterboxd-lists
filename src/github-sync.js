const fs = require('fs');
const path = require('path');

const REPO = process.env.GITHUB_REPO || 'FelixAyram/stremio-letterboxd-lists';
const TOKEN = process.env.GITHUB_TOKEN || '';
const BRANCH = process.env.GITHUB_BRANCH || 'master';
const STATE_FILE = 'data/repo-state.json';
const ROOT = path.join(__dirname, '..');

const shaCache = new Map();
let pushTimer = null;
let pulling = false;
let lastPushError = null;
let lastPushAt = null;

function isEnabled() {
  return Boolean(TOKEN && REPO);
}

function apiUrl(repoPath) {
  const encoded = repoPath.split('/').map(encodeURIComponent).join('/');
  return `https://api.github.com/repos/${REPO}/contents/${encoded}`;
}

async function ghRequest(repoPath, options = {}) {
  return fetch(apiUrl(repoPath), {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'stremio-letterboxd-lists-sync',
      ...options.headers
    }
  });
}

function writeLocal(repoPath, content) {
  const local = path.join(ROOT, repoPath);
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.writeFileSync(local, content, 'utf8');
}

function stateHasData(state) {
  if (!state) return false;
  if (state.users?.users?.length) return true;
  if (state.listsByUser && Object.values(state.listsByUser).some((d) => d?.lists?.length)) return true;
  return false;
}

function exportState() {
  const { readUsersDb } = require('./auth');
  const { readLists } = require('./store');
  const { readIndex } = require('./keys');

  const listsByUser = {};
  for (const user of readUsersDb().users) {
    listsByUser[user.id] = readLists(user.id);
  }

  return {
    version: 1,
    savedAt: new Date().toISOString(),
    users: readUsersDb(),
    index: readIndex(),
    listsByUser
  };
}

function importState(state) {
  if (!state?.version) return false;

  const { writeUsersDbLocal } = require('./auth');
  const { writeListsLocal } = require('./store');
  const { writeIndexLocal } = require('./keys');

  if (state.users) writeUsersDbLocal(state.users);
  if (state.index) writeIndexLocal(state.index);

  for (const [uid, data] of Object.entries(state.listsByUser || {})) {
    if (data?.lists) writeListsLocal(uid, data);
  }

  return true;
}

function applyStateToRuntimeFiles(state) {
  if (!importState(state)) return;
  writeLocal(STATE_FILE, JSON.stringify(state, null, 2));
}

function pullFromLocalBundle() {
  const local = path.join(ROOT, STATE_FILE);
  if (!fs.existsSync(local)) return false;
  try {
    const state = JSON.parse(fs.readFileSync(local, 'utf8'));
    if (!state.listsByUser || !Object.keys(state.listsByUser).length) return false;
    applyStateToRuntimeFiles(state);
    console.log('[github] datos cargados desde repo-state.json local');
    return true;
  } catch {
    return false;
  }
}

async function pullOnStartup() {
  if (!isEnabled()) return pullFromLocalBundle();
  pulling = true;
  try {
    const local = exportState();
    const res = await ghRequest(STATE_FILE);
    if (res.status === 404) {
      if (stateHasData(local)) {
        console.log('[github] repo sin archivo — subiendo datos locales');
        await pushState();
        return true;
      }
      console.log('[github] sin datos previos en el repo');
      return false;
    }
    if (!res.ok) {
      console.error('[github] pull error:', res.status);
      return false;
    }
    const meta = await res.json();
    shaCache.set(STATE_FILE, meta.sha);
    const content = Buffer.from(meta.content.replace(/\n/g, ''), 'base64').toString('utf8');
    const remote = JSON.parse(content);

    if (!stateHasData(remote) && stateHasData(local)) {
      console.log('[github] remoto vacio — subiendo datos locales');
      await pushState();
      return true;
    }
    if (!stateHasData(remote)) {
      console.log('[github] sin datos en el repo');
      return false;
    }

    const remoteTime = remote.savedAt ? Date.parse(remote.savedAt) : 0;
    const localTime = local.savedAt ? Date.parse(local.savedAt) : 0;
    if (stateHasData(local) && localTime > remoteTime) {
      console.log('[github] datos locales mas recientes — subiendo');
      await pushState();
      return true;
    }

    applyStateToRuntimeFiles(remote);
    console.log('[github] datos restaurados desde GitHub');
    return true;
  } catch (e) {
    console.error('[github] pull:', e.message);
    return false;
  } finally {
    pulling = false;
  }
}

async function pushState() {
  const state = exportState();
  const content = JSON.stringify(state, null, 2);
  writeLocal(STATE_FILE, content);

  let sha = shaCache.get(STATE_FILE);
  if (!sha) {
    const check = await ghRequest(STATE_FILE);
    if (check.ok) {
      const data = await check.json();
      sha = data.sha;
      shaCache.set(STATE_FILE, sha);
    }
  }

  const body = {
    message: `sync: actualizar listas (${state.savedAt})`,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: BRANCH
  };
  if (sha) body.sha = sha;

  const res = await ghRequest(STATE_FILE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    lastPushError = `GitHub push: ${res.status} ${err.slice(0, 200)}`;
    throw new Error(lastPushError);
  }

  const data = await res.json();
  if (data.content?.sha) shaCache.set(STATE_FILE, data.content.sha);
  lastPushError = null;
  lastPushAt = state.savedAt;
  console.log('[github] datos guardados en GitHub');
}

function schedulePush() {
  if (!isEnabled() || pulling) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushState().catch((e) => {
      lastPushError = e.message;
      console.error('[github]', e.message);
    });
  }, 2000);
}

async function pushNow() {
  if (!isEnabled() || pulling) return false;
  clearTimeout(pushTimer);
  try {
    await pushState();
    return true;
  } catch (e) {
    lastPushError = e.message;
    console.error('[github]', e.message);
    return false;
  }
}

function syncStatus() {
  return {
    enabled: isEnabled(),
    lastPushAt,
    lastPushError
  };
}

module.exports = {
  isEnabled,
  pullOnStartup,
  pullFromLocalBundle,
  schedulePush,
  pushNow,
  syncStatus,
  STATE_FILE
};
