const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSION_DAYS = 30;
const SECRET = process.env.SESSION_SECRET || 'cambiar-en-render-session-secret';

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
  if (!password || password.length < 4) throw new Error('Contrasena: minimo 4 caracteres');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
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

function findUser(username) {
  const id = normalizeUsername(username);
  return readUsersDb().users.find((u) => u.id === id) || null;
}

function register(username, password) {
  const id = validateUsername(username);
  validatePassword(password);
  const db = readUsersDb();
  if (db.users.some((u) => u.id === id)) {
    throw new Error('Ese usuario ya existe');
  }
  const user = {
    id,
    username: id,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  writeUsersDb(db);
  return user;
}

function login(username, password) {
  const id = validateUsername(username);
  validatePassword(password);
  const user = findUser(id);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new Error('Usuario o contrasena incorrectos');
  }
  return user;
}

function signToken(userId) {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${userId}:${exp}`;
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
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
    const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
    if (sig !== expected || Date.now() > Number(exp)) return null;
    if (!findUser(userId)) return null;
    return userId;
  } catch {
    return null;
  }
}

function authFromRequest(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  return verifyToken(token);
}

function listUserIds() {
  const usersDir = path.join(DATA_DIR, 'users');
  if (!fs.existsSync(usersDir)) return [];
  return fs.readdirSync(usersDir).filter((name) => {
    if (!/^[a-z0-9_-]+$/.test(name)) return false;
    return fs.existsSync(path.join(usersDir, name, 'lists.json'));
  });
}

module.exports = {
  normalizeUsername,
  validateUsername,
  register,
  login,
  signToken,
  verifyToken,
  authFromRequest,
  findUser,
  listUserIds
};
