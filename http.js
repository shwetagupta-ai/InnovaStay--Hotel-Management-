'use strict';
/**
 * Tiny HTTP toolkit: router, JSON body parser, security headers, static file server
 * with gzip + ETag caching. Replaces Express/Helmet/compression with zero dependencies.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const config = require('../config');

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

// ---------- Router ----------
const routes = [];
function route(method, pattern, ...handlers) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handlers });
}
const router = {
  get: (p, ...h) => route('GET', p, ...h), post: (p, ...h) => route('POST', p, ...h),
  put: (p, ...h) => route('PUT', p, ...h), delete: (p, ...h) => route('DELETE', p, ...h),
};
function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(pathname);
    if (m) { const params = {}; r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]))); return { r, params }; }
  }
  return null;
}

// ---------- Security headers ----------
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
if (config.COOKIE_SECURE) SECURITY_HEADERS['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';

// ---------- Response helpers ----------
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body), ...SECURITY_HEADERS });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    if (['GET', 'HEAD', 'DELETE'].includes(req.method)) return resolve({});
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > config.MAX_BODY) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (_) { reject(new HttpError(400, 'Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// ---------- Static files ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp', '.txt': 'text/plain' };
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt']);
const fileCache = new Map();  // path -> {mtime, raw, gz, etag}

function serveFile(req, res, abs) {
  let st;
  try { st = fs.statSync(abs); } catch (_) { return false; }
  if (!st.isFile()) return false;
  const ext = path.extname(abs).toLowerCase();
  let entry = fileCache.get(abs);
  if (!entry || entry.mtime !== st.mtimeMs) {
    const raw = fs.readFileSync(abs);
    entry = { mtime: st.mtimeMs, raw, gz: COMPRESSIBLE.has(ext) ? zlib.gzipSync(raw, { level: 6 }) : null,
      etag: `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"` };
    fileCache.set(abs, entry);
  }
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', ETag: entry.etag, Vary: 'Accept-Encoding',
    'Cache-Control': ext === '.svg' || ext === '.png' || ext === '.jpg' ? 'public, max-age=604800' : 'no-cache', ...SECURITY_HEADERS };
  if (req.headers['if-none-match'] === entry.etag) { res.writeHead(304, headers); res.end(); return true; }
  const useGzip = entry.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = useGzip ? entry.gz : entry.raw;
  if (useGzip) headers['Content-Encoding'] = 'gzip';
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
function serveStatic(req, res, pathname) {
  const clean = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const abs = path.join(config.FRONTEND_DIR, clean);
  if (!abs.startsWith(config.FRONTEND_DIR)) return false;          // path-traversal guard
  return serveFile(req, res, abs);
}

module.exports = { HttpError, router, matchRoute, sendJson, readBody, serveStatic, serveFile, SECURITY_HEADERS };
