const crypto = require('crypto');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const scryptAsync = promisify(crypto.scrypt);

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSION_DAYS = 30;
const COOKIE_NAME = 'lbx_session';
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

const SECRET = process.env.SESSION_SECRET;
if (!SECRET && process.env.RENDER) {
  console.warn('[auth] SESSION_SECRET no definido — las sesiones se invalidan en cada reinicio');
}
const SESSION_SECRET = SECRET || crypto.randomBytes(32).toString('hex');

const loginAttempts = new Map();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 12;

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function normalizeUsername(username) {
  return (username || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}

function validateUsername(username) {
  const n = normalizeUsername(username);
  if (n.length < 3) throw new Error('Usuario: minimo 3 letras o numeros');
  return n;
}

function validatePassword(password) {
  if (!password || password.length < 8) {
    throw new Error('Contrasena: minimo 8 caracteres');
  }
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  })).toString('hex');
  return `${salt}:${hash}`;
}

async function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const test = (await scryptAsync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  })).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
  } catch {
    return false;
  }
}

function readUsersDb() {
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) return { users: [] };
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return { users: [] };
  }
}

function writeUsersDb(data) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

function findUserById(userId) {
  return readUsersDb().users.find((u) => u.id === userId) || null;
}

function findUser(username) {
  const id = normalizeUsername(username);
  return findUserById(id);
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return;
  }
  entry.count += 1;
  if (entry.count > RATE_MAX) {
    throw new Error('Demasiados intentos. Espera 15 minutos.');
  }
}

function resetRateLimit(ip) {
  loginAttempts.delete(ip);
}

async function register(username, password) {
  const id = validateUsername(username);
  validatePassword(password);
  const db = readUsersDb();
  if (db.users.some((u) => u.id === id)) {
    throw new Error('Ese usuario ya existe');
  }
  const user = {
    id,
    username: id,
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  writeUsersDb(db);
  return user;
}

async function login(username, password, ip) {
  checkRateLimit(ip);
  const id = validateUsername(username);
  if (!password) throw new Error('Usuario o contrasena incorrectos');
  const user = findUser(id);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new Error('Usuario o contrasena incorrectos');
  }
  resetRateLimit(ip);
  return user;
}

function signToken(userId) {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${userId}:${exp}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

function verifyToken(token) {
  if (!token) return null;
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length < 3) return null;
    const sig = parts.pop();
    const exp = parts.pop();
    const userId = parts.join(':');
    const payload = `${userId}:${exp}`;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
    if (sig !== expected || Date.now() > Number(exp)) return null;
    if (!findUserById(userId)) return null;
    return userId;
  } catch {
    return null;
  }
}

function parseCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function authFromRequest(req) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  return verifyToken(bearer || parseCookie(req, COOKIE_NAME));
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    secure ? 'Secure' : ''
  ].filter(Boolean).join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function listUserIds() {
  const usersDir = path.join(DATA_DIR, 'users');
  if (!fs.existsSync(usersDir)) return [];
  return fs.readdirSync(usersDir).filter((name) => {
    if (!/^[a-z0-9_-]+$/.test(name)) return false;
    return fs.existsSync(path.join(usersDir, name, 'lists.json'));
  });
}

function publicUser(user) {
  return { username: user.username };
}

module.exports = {
  COOKIE_NAME,
  normalizeUsername,
  validateUsername,
  register,
  login,
  signToken,
  verifyToken,
  authFromRequest,
  setSessionCookie,
  clearSessionCookie,
  findUser,
  findUserById,
  listUserIds,
  publicUser,
  clientIp
};
