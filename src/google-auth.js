const crypto = require('crypto');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const STATE_TTL_MS = 10 * 60 * 1000;

const pendingStates = new Map();

function isEnabled() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

function pruneStates() {
  const now = Date.now();
  for (const [key, createdAt] of pendingStates) {
    if (now - createdAt > STATE_TTL_MS) pendingStates.delete(key);
  }
}

function createState() {
  pruneStates();
  const state = crypto.randomBytes(24).toString('base64url');
  pendingStates.set(state, Date.now());
  return state;
}

function verifyState(state) {
  if (!state || !pendingStates.has(state)) return false;
  const createdAt = pendingStates.get(state);
  pendingStates.delete(state);
  return Date.now() - createdAt <= STATE_TTL_MS;
}

function authUrl(redirectUri, state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account'
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function exchangeCode(code, redirectUri) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google token: ${res.status} ${err.slice(0, 120)}`);
  }
  return res.json();
}

async function fetchProfile(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error('No se pudo leer el perfil de Google');
  return res.json();
}

module.exports = {
  isEnabled,
  createState,
  verifyState,
  authUrl,
  exchangeCode,
  fetchProfile
};
