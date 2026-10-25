'use strict';
/** Central configuration. Reads an optional .env file (no packages needed); every value has a safe default. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (_) { /* no .env - defaults apply */ }

function loadSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) return process.env.JWT_SECRET;
  const file = path.join(ROOT, 'database', '.jwt_secret');
  try { const s = fs.readFileSync(file, 'utf8').trim(); if (s.length >= 32) return s; } catch (_) { /* create below */ }
  const secret = crypto.randomBytes(48).toString('hex');
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, secret, { mode: 0o600 }); } catch (_) { /* read-only disk */ }
  return secret;
}
const PROD = process.env.NODE_ENV === 'production';

module.exports = {
  ROOT,
  PORT: parseInt(process.env.PORT, 10) || 3000,
  PROD,
  FRONTEND_DIR: path.join(ROOT, 'frontend'),
  DB_PATH: process.env.DB_PATH || process.env.DB_FILE || path.join(ROOT, 'database', 'innovastay.db'),
  SECRET: loadSecret(),
  SESSION_HOURS: 12,
  MAX_FAILED_LOGINS: 5,
  LOCK_MINUTES: 15,
  MAX_BODY: 1024 * 1024,
  COOKIE_SECURE: PROD && process.env.COOKIE_SECURE !== 'false',
  // password-reset code is returned in the API response ONLY for demos; set SHOW_RESET_OTP=false in production
  SHOW_RESET_OTP: process.env.SHOW_RESET_OTP ? process.env.SHOW_RESET_OTP === 'true' : !PROD,
  TRUST_PROXY: process.env.TRUST_PROXY === 'true',
  // dynamic pricing multipliers (added to 1.0 per night)
  PRICING: { weekend: 0.15, peakSeason: 0.2, peakMonths: [10, 11, 12, 1], highOccupancy: 0.1 },
  // GST rules
  GST: { roomLow: 0.12, roomThreshold: 7500, roomHigh: 0.18, food: 0.05, service: 0.18 },
};
