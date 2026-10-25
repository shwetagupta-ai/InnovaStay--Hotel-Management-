'use strict';
/**
 * InnovaStay server entry point.
 *   npm start                -> single process
 *   npm run start:cluster    -> one worker per CPU core (shared port) for heavy traffic
 * Zero npm dependencies: only Node built-ins (http, node:sqlite, crypto, zlib, cluster).
 */
const http = require('http');
const os = require('os');
const cluster = require('cluster');
const path = require('path');
const config = require('./config');

const useCluster = process.argv.includes('--cluster') || process.env.CLUSTER === 'true';

if (useCluster && cluster.isPrimary) {
  require('../database/init').ensureDatabase();           // create + seed once, before workers start
  const n = Math.min(8, parseInt(process.env.WORKERS, 10) || os.availableParallelism());
  console.log(`InnovaStay cluster: starting ${n} workers on http://localhost:${config.PORT}`);
  for (let i = 0; i < n; i++) cluster.fork();
  cluster.on('exit', (w, code) => { console.log(`worker ${w.process.pid} exited (${code}) – restarting`); setTimeout(() => cluster.fork(), 500); });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { for (const id in cluster.workers) cluster.workers[id].process.kill(sig); process.exit(0); });
} else {
  if (!useCluster) require('../database/init').ensureDatabase();
  startWorker();
}

function startWorker() {
  const { router, matchRoute, sendJson, readBody, serveStatic, serveFile, HttpError, SECURITY_HEADERS } = require('./utils/http');
  const S = require('./utils/security');
  const { loadUser } = require('./middleware/auth');
  // register routes
  ['auth', 'account', 'public', 'customer', 'resources', 'operations', 'analytics'].forEach((m) => require(`./routes/${m}`));

  const ROLE_PORTAL = { customer: 'customer', staff: 'staff', admin: 'admin', platform_admin: 'platform' };
  const PAGES = { '/': 'index.html', '/login': 'login.html' };

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const ip = (process.env.TRUST_PROXY === 'true' && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
    const ctx = { req, res, ip, query: Object.fromEntries(url.searchParams), params: {}, body: {}, user: undefined, _cookies: [],
      json: (data, status = 200) => { if (ctx._cookies.length) res.setHeader('Set-Cookie', ctx._cookies); sendJson(res, status, data); },
      setCookie: (c) => ctx._cookies.push(c) };

    if (pathname.startsWith('/api/')) {
      try {
        if (pathname === '/api/health') return sendJson(res, 200, { ok: true, pid: process.pid, uptime: Math.round(process.uptime()) });
        const lim = S.rateLimit(`api:${ip}`, parseInt(process.env.API_RATE_LIMIT, 10) || 900, 60 * 1000);   // requests/min per IP (override with API_RATE_LIMIT)
        if (!lim.allowed) { res.setHeader('Retry-After', lim.retryAfter); throw new HttpError(429, 'Too many requests. Please slow down.'); }
        const m = matchRoute(req.method, pathname);
        if (!m) throw new HttpError(404, 'Not found');
        if (req.method !== 'GET') {                                                  // CSRF defence: custom header + JSON only
          if (req.headers['x-requested-with'] !== 'InnovaStay') throw new HttpError(403, 'Blocked request.');
        }
        ctx.params = m.params;
        ctx.body = await readBody(req);
        if (ctx.body === null || typeof ctx.body !== 'object' || Array.isArray(ctx.body)) ctx.body = {};
        const handlers = m.r.handlers;
        for (let i = 0; i < handlers.length; i++) await handlers[i](ctx);
      } catch (e) { return fail(res, e, ctx); }
      return;
    }

    // ---- pages ----
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    const dash = pathname.match(/^\/dashboard\/(customer|staff|admin|platform)\/?$/);
    if (dash) {
      const u = loadUser(ctx);
      if (!u || ROLE_PORTAL[u.role] !== dash[1]) { res.writeHead(302, { Location: `/login?portal=${dash[1]}`, 'Cache-Control': 'no-store' }); return res.end(); }
      return serveFile(req, res, path.join(config.FRONTEND_DIR, 'dashboard.html'));
    }
    if (PAGES[pathname]) return serveFile(req, res, path.join(config.FRONTEND_DIR, PAGES[pathname]));
    if (serveStatic(req, res, pathname)) return;
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS });
    res.end('<!doctype html><meta charset="utf-8"><title>Not found</title><body style="font-family:sans-serif;text-align:center;padding:12vh 1rem;color:#0b2a5b"><h1>404</h1><p>That page does not exist.</p><a href="/">Back to InnovaStay</a>');
  }

  function fail(res, e, ctx) {
    if (res.headersSent) return res.end();
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message, ...(e.extra || {}) });
    const msg = String(e && e.message || '');
    if (/UNIQUE constraint/i.test(msg)) return sendJson(res, 409, { error: 'That record already exists (duplicate value).' });
    if (/FOREIGN KEY/i.test(msg)) return sendJson(res, 409, { error: 'This record is linked to other data and cannot be changed or deleted.' });
    if (/CHECK constraint|NOT NULL/i.test(msg)) return sendJson(res, 400, { error: 'Some values are missing or invalid.' });
    console.error(`[error] ${ctx.req.method} ${ctx.req.url}:`, e);
    sendJson(res, 500, { error: 'Something went wrong on our side. Please try again.' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => { try { fail(res, e, { req }); } catch (_) { res.destroy(); } });
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 20000;
  server.requestTimeout = 30000;
  server.maxConnections = 5000;
  server.listen(config.PORT, () => console.log(`InnovaStay running on http://localhost:${config.PORT}  (pid ${process.pid})`));
  server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `Port ${config.PORT} is already in use. Set PORT in .env.` : e); process.exit(1); });

  // never let one bad request take the whole site down
  process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
  process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); });
}
