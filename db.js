'use strict';
/**
 * SQLite connection using Node's built-in node:sqlite (Node >= 22.13, no npm packages).
 * WAL mode + busy timeout let many workers read/write concurrently without "database is locked" errors.
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const config = require('./index');

fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });
const db = new DatabaseSync(config.DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA busy_timeout = 8000;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA cache_size = -32000;');
db.exec('PRAGMA temp_store = MEMORY;');

const cache = new Map();           // prepared statement cache
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}
let txDepth = 0;
const plain = (r) => (r ? { ...r } : r);

module.exports = {
  raw: db,
  get: (sql, ...p) => plain(stmt(sql).get(...p)),
  all: (sql, ...p) => stmt(sql).all(...p).map(plain),
  run: (sql, ...p) => stmt(sql).run(...p),
  exec: (sql) => db.exec(sql),
  /** Run fn inside an IMMEDIATE transaction (write lock taken up-front -> no double bookings). */
  tx(fn) {
    if (txDepth > 0) return fn();           // nested call: join the outer transaction
    db.exec('BEGIN IMMEDIATE');
    txDepth++;
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
    finally { txDepth--; }
  },
};
