'use strict';
/** Password hashing (scrypt), signed session tokens (HMAC-SHA256), validators and an in-memory rate limiter. */
const crypto = require('crypto');
const { promisify } = require('util');
const config = require('../config');

const scrypt = promisify(crypto.scrypt);
const P = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(pw), salt, KEYLEN, P);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function hashPasswordSync(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(String(pw), salt, KEYLEN, P).toString('hex')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const key = await scrypt(String(pw), Buffer.from(saltHex, 'hex'), expected.length, P);
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}
/** Returns an error message, or null when the password is acceptable. */
function passwordPolicy(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 100) return 'Password is too long (max 100 characters).';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return 'Password needs an uppercase letter, a lowercase letter and a number.';
  return null;
}

// ---- signed tokens ----
const sign = (body) => crypto.createHmac('sha256', config.SECRET).update(body).digest('base64url');
function signToken(payload, hours = config.SESSION_HOURS) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + hours * 3600 })).toString('base64url');
  return `${body}.${sign(body)}`;
}
function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() / 1000 ? p : null;
  } catch (_) { return null; }
}
const COOKIE_NAME = 'is_session';
function sessionCookie(token, maxAgeSeconds) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${config.COOKIE_SECURE ? '; Secure' : ''}`;
}
const hashOtp = (otp) => crypto.createHmac('sha256', config.SECRET).update('otp:' + otp).digest('hex');

// ---- helpers ----
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(n = 6) { let s = ''; for (let i = 0; i < n; i++) s += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]; return s; }
function clean(v, max = 255) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}
const isEmail = (s) => typeof s === 'string' && s.length <= 120 && /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(s);
const isMobile = (s) => typeof s === 'string' && /^\+?\d{10,13}$/.test(s);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// ---- rate limiting: fixed window, in memory (per worker process) ----
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.count++;
  return { allowed: b.count <= max, retryAfter: Math.max(1, Math.ceil((b.reset - now) / 1000)), remaining: Math.max(0, max - b.count) };
}
setInterval(() => { const n = Date.now(); for (const [k, b] of buckets) if (b.reset <= n) buckets.delete(k); }, 60000).unref();

module.exports = { hashPassword, hashPasswordSync, verifyPassword, passwordPolicy, signToken, verifyToken, sessionCookie, COOKIE_NAME,
  hashOtp, randomCode, clean, isEmail, isMobile, isDate, rateLimit };
