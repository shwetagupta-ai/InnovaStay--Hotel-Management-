'use strict';
/** Creates the SQLite file + tables on first start and loads demo data when the database is empty. */
const fs = require('fs');
const path = require('path');

function ensureDatabase() {
  const db = require('../backend/config/db');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const empty = db.get('SELECT COUNT(*) c FROM users').c === 0;
  if (empty) {
    console.log('Empty database detected – loading demo data (this takes a few seconds)...');
    require('./seed').seed(db);
    console.log('Demo data loaded. See README.md for demo logins.');
  }
}
module.exports = { ensureDatabase };
