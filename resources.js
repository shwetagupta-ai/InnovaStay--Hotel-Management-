'use strict';
/**
 * Generic, permission-checked CRUD engine driven by definitions.js
 * + /api/meta (navigation + UI metadata) + /api/lookup (dropdown data) + notifications.
 */
const db = require('../config/db');
const { router, HttpError } = require('../utils/http');
const S = require('../utils/security');
const B = require('../utils/business');
const defs = require('./definitions');
const { requireAuth, can } = require('../middleware/auth');

const REF_TABLE = { rooms: 'rooms', employees: 'employees', reservations: 'reservations', services: 'services', food_menu: 'food_menu' };
const isManagerish = (u) => u.role === 'admin' || u.role === 'platform_admin' || (u.role === 'staff' && u.department === 'Manager');
const ownActive = (def, u) => !!(def.own && u.role === 'staff' && u.department !== 'Manager' && (!def.own.depts || def.own.depts.includes(u.department)));

function getDef(name, u, op) {
  const def = defs[name];
  if (!def) throw new HttpError(404, 'Unknown module.');
  if (!can(u, def.read)) throw new HttpError(403, 'You do not have access to this module.');
  if (op === 'read') return def;
  const hasWrite = can(u, def.write), own = ownActive(def, u);
  if (op === 'create') {
    if (def.noCreate) throw new HttpError(405, 'Records cannot be created here.');
    if (!hasWrite && !(def.createOnly && can(u, def.createOnly)) && !(own && def.own.create)) throw new HttpError(403, 'You cannot add records here.');
  } else if (op === 'update') {
    if (def.noUpdate) throw new HttpError(405, 'Records here cannot be edited.');
    if (!hasWrite && !(own && def.own.update)) throw new HttpError(403, 'You cannot edit records here.');
  } else if (op === 'delete') {
    if (def.noDelete || !hasWrite || (own && def.own.update && !can(u, ['admin']))) throw new HttpError(403, 'You cannot delete records here.');
  }
  return def;
}

function scopeParts(def, u, forWrite = false) {
  const w = [], p = [];
  if (def.baseWhere) w.push(def.baseWhere);
  if (def.hotel && u.role !== 'platform_admin') { w.push('t.hotel_id = ?'); p.push(u.hotel_id); }
  if (def.scopeSql) { const s = def.scopeSql(u); if (s) { w.push(s[0]); p.push(...s[1]); } }
  if (forWrite && def.writeScope) { const s = def.writeScope(u); if (s) { w.push(s[0]); p.push(...s[1]); } }
  if (ownActive(def, u)) { w.push(`t.${def.own.col} = ?`); p.push(u.employee_id); }
  return { w, p };
}

function coerce(def, body, u, op) {
  const out = {};
  for (const [name, spec0] of Object.entries(def.fields || {})) {
    if (!(name in body)) { if (op === 'create' && def.required && def.required.includes(name)) throw new HttpError(400, `${name.replace(/_/g, ' ')} is required.`); continue; }
    const spec = spec0.t || spec0; let v = body[name];
    const empty = v === '' || v === null || v === undefined;
    if (empty) {
      if (def.required && def.required.includes(name)) throw new HttpError(400, `${name.replace(/_/g, ' ')} is required.`);
      out[name] = spec === 'bool' ? 0 : null; continue;
    }
    if (Array.isArray(spec)) { if (!spec.includes(v)) throw new HttpError(400, `Invalid value for ${name.replace(/_/g, ' ')}.`); }
    else if (spec === 'int') { v = parseInt(v, 10); if (!Number.isFinite(v) || v < 0 || v > 1e9) throw new HttpError(400, `${name.replace(/_/g, ' ')} must be a whole number.`); }
    else if (spec === 'num') { v = Number(v); if (!Number.isFinite(v) || v < 0 || v > 1e9) throw new HttpError(400, `${name.replace(/_/g, ' ')} must be a valid amount.`); }
    else if (spec === 'bool') v = v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? 1 : 0;
    else if (spec === 'date') { if (!S.isDate(String(v))) throw new HttpError(400, `${name.replace(/_/g, ' ')} must be a valid date.`); }
    else if (spec === 'email') { v = S.clean(v, 120).toLowerCase(); if (!S.isEmail(v)) throw new HttpError(400, 'Enter a valid email address.'); }
    else if (spec === 'mobile') { v = S.clean(v, 16).replace(/[\s-]/g, ''); if (!S.isMobile(v)) throw new HttpError(400, 'Enter a valid mobile number (10-13 digits).'); }
    else v = S.clean(v, 500);
    if (spec0.ref) {
      const hotelId = u.role === 'platform_admin' ? null : u.hotel_id;
      const tbl = REF_TABLE[spec0.ref];
      const ok = tbl && hotelId ? db.get(`SELECT 1 x FROM ${tbl} WHERE id=? AND hotel_id=?`, v, hotelId) : db.get(`SELECT 1 x FROM ${tbl || spec0.ref} WHERE id=?`, v);
      if (!ok) throw new HttpError(400, `Selected ${name.replace(/_id$/, '').replace(/_/g, ' ')} was not found.`);
    }
    out[name] = v;
  }
  return out;
}
const maskRow = (def, row) => { if (def.mask) for (const [k, fn] of Object.entries(def.mask)) if (row[k] != null) row[k] = fn(row[k]); return row; };

router.get('/api/r/:res', requireAuth(), (ctx) => {
  const u = ctx.user, def = getDef(ctx.params.res, u, 'read'), q = ctx.query;
  const { w, p } = scopeParts(def, u);
  if (def.hotel && u.role === 'platform_admin' && parseInt(q.hotel_id, 10)) { w.push('t.hotel_id = ?'); p.push(parseInt(q.hotel_id, 10)); }
  const term = S.clean(q.q, 60).replace(/[%_]/g, '');
  if (term && def.search) { w.push('(' + def.search.map((c) => `${c} LIKE ?`).join(' OR ') + ')'); def.search.forEach(() => p.push(`%${term}%`)); }
  for (const [param, col] of Object.entries(def.filters || {})) {
    const val = q['f_' + param]; if (val === undefined || val === '') continue;
    if (param === 'date') { w.push(`${col} = ?`); p.push(val); } else { w.push(`${col} = ?`); p.push(val); }
  }
  if (q.from && def.filters && def.filters.date && S.isDate(q.from)) { w.push(`${def.filters.date} >= ?`); p.push(q.from); }
  const from = `${def.table} t ${def.joins || ''} ${def.hotel ? 'LEFT JOIN hotels hh ON hh.id=t.hotel_id' : ''} ${w.length ? 'WHERE ' + w.join(' AND ') : ''}`;
  const limit = Math.min(100, Math.max(5, parseInt(q.limit, 10) || 25)), page = Math.max(1, parseInt(q.page, 10) || 1);
  const total = db.get(`SELECT COUNT(*) c FROM ${from}`, ...p).c;
  const rows = db.all(`SELECT ${def.select || 't.*'}${def.hotel ? ', hh.name AS _hotel' : ''} FROM ${from} ORDER BY ${def.order || 't.id DESC'} LIMIT ? OFFSET ?`, ...p, limit, (page - 1) * limit);
  ctx.json({ rows: rows.map((r) => maskRow(def, r)), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

router.get('/api/r/:res/:id', requireAuth(), (ctx) => {
  const u = ctx.user, def = getDef(ctx.params.res, u, 'read'), { w, p } = scopeParts(def, u);
  w.push('t.id = ?'); p.push(parseInt(ctx.params.id, 10));
  const row = db.get(`SELECT t.* FROM ${def.table} t ${def.joins || ''} WHERE ${w.join(' AND ')}`, ...p);
  if (!row) throw new HttpError(404, 'Record not found.');
  delete row.password_hash; ctx.json({ row });
});

router.post('/api/r/:res', requireAuth(), async (ctx) => {
  const u = ctx.user, def = getDef(ctx.params.res, u, 'create'), body = ctx.body || {};
  let data = { ...(def.defaults || {}), ...coerce(def, body, u, 'create') };
  const own = ownActive(def, u);
  if (own && def.own.create) { data[def.own.col] = u.employee_id; if ('status' in (def.fields || {})) data.status = 'Pending'; }
  if (def.hotel) {
    if (u.role === 'platform_admin') { const h = parseInt(body.hotel_id, 10) || null; if (!h && !def.hotelNullable) throw new HttpError(400, 'Select a hotel.'); data.hotel_id = h; }
    else data.hotel_id = u.hotel_id;
  }
  if (def.before) await def.before('create', data, u, null, body);
  let id;
  if (def.customCreate) id = await def.customCreate({ ...body, ...data }, u);
  else {
    const keys = Object.keys(data);
    if (!keys.length) throw new HttpError(400, 'Nothing to save.');
    id = Number(db.tx(() => db.run(`INSERT INTO ${def.table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => data[k]))).lastInsertRowid);
  }
  if (def.after) await def.after('create', id, u, data);
  ctx.json({ id }, 201);
});

router.put('/api/r/:res/:id', requireAuth(), async (ctx) => {
  const u = ctx.user, def = getDef(ctx.params.res, u, 'update'), id = parseInt(ctx.params.id, 10);
  const { w, p } = scopeParts(def, u, true);
  const existing = db.get(`SELECT t.* FROM ${def.table} t WHERE ${[...w, 't.id = ?'].join(' AND ')}`, ...p, id);
  if (!existing) throw new HttpError(404, 'Record not found.');
  let body = ctx.body || {};
  if (ownActive(def, u) && def.own.update && !can(u, ['admin'])) body = Object.fromEntries(Object.entries(body).filter(([k]) => def.own.update.includes(k)));
  if (def.hotel === false && def.table === 'users' && !('status' in body)) throw new HttpError(400, 'Nothing to update.');
  let data = coerce(def, body, u, 'update');
  if (def.table === 'leave_requests' && !isManagerish(u)) delete data.status;
  if (def.before) await def.before('update', data, u, existing, body);
  const keys = Object.keys(data);
  if (!keys.length) throw new HttpError(400, 'Nothing to update.');
  db.tx(() => db.run(`UPDATE ${def.table} AS t SET ${keys.map((k) => `${k}=?`).join(',')} WHERE ${[...w, 't.id = ?'].join(' AND ')}`, ...keys.map((k) => data[k]), ...p, id));
  if (def.after) await def.after('update', id, u, data, existing);
  ctx.json({ ok: true });
});

router.delete('/api/r/:res/:id', requireAuth(), (ctx) => {
  const u = ctx.user, def = getDef(ctx.params.res, u, 'delete'), { w, p } = scopeParts(def, u, true);
  const r = db.run(`DELETE FROM ${def.table} AS t WHERE ${[...w, 't.id = ?'].join(' AND ')}`, ...p, parseInt(ctx.params.id, 10));
  if (!r.changes) throw new HttpError(404, 'Record not found.');
  ctx.json({ ok: true });
});

// ---------- Dropdown lookups ----------
router.get('/api/lookup/:name', requireAuth('admin', 'platform_admin', 'staff:*'), (ctx) => {
  const u = ctx.user, h = u.hotel_id, [name, dept] = ctx.params.name.split(':'), q = S.clean(ctx.query.q, 40).replace(/[%_]/g, '');
  const L = {
    rooms: () => db.all(`SELECT r.id, r.room_no || ' • ' || rt.name || ' (floor ' || r.floor || ')' AS label FROM rooms r JOIN room_types rt ON rt.id=r.type_id WHERE r.hotel_id=? ORDER BY r.room_no`, h),
    room_types: () => db.all('SELECT id, name AS label FROM room_types ORDER BY base_price'),
    hotels: () => db.all("SELECT id, name || ' – ' || city AS label FROM hotels ORDER BY name"),
    employees: () => db.all(`SELECT id, name || ' (' || department || ')' AS label FROM employees WHERE hotel_id=? AND status='Active' ${dept ? 'AND department=?' : ''} ORDER BY name`, ...(dept ? [h, dept] : [h])),
    services: () => db.all('SELECT id, name || \' – ₹\' || price AS label FROM services WHERE hotel_id=? AND available=1 ORDER BY name', h),
    menu: () => db.all('SELECT id, name, category, price FROM food_menu WHERE hotel_id=? AND available=1 ORDER BY category,name', h),
    reservations: () => db.all(`SELECT r.id, r.booking_ref || ' • ' || g.full_name || ' • Rm ' || rm.room_no || ' (' || r.status || ')' AS label FROM reservations r JOIN guests g ON g.id=r.guest_id JOIN rooms rm ON rm.id=r.room_id
      WHERE r.hotel_id=? AND r.status IN ('Confirmed','Checked-in','Pending') ${ctx.query.stay ? "AND r.status='Checked-in'" : ''} ORDER BY r.check_in DESC LIMIT 200`, h),
    guests: () => db.all(`SELECT id, full_name || ' • ' || COALESCE(mobile,'') AS label FROM guests WHERE (created_hotel_id=? OR id IN (SELECT guest_id FROM reservations WHERE hotel_id=?)) ${q ? 'AND (full_name LIKE ? OR mobile LIKE ?)' : ''} ORDER BY id DESC LIMIT 100`, ...(q ? [h, h, `%${q}%`, `%${q}%`] : [h, h])),
  };
  if (!L[name]) throw new HttpError(404, 'Unknown lookup.');
  ctx.json({ items: L[name]() });
});

// ---------- Navigation + UI metadata ----------
const PAGES = {   // custom (non-table) pages and who may open them
  overview: { label: 'Overview', icon: 'home', roles: [] },
  frontdesk: { label: 'Front Desk', icon: 'desk', roles: ['admin', 'staff:Receptionist'] },
  walkin: { label: 'Walk-in Booking', icon: 'plus', roles: ['admin', 'staff:Receptionist'] },
  floor: { label: 'Floor View', icon: 'grid', roles: ['admin', 'staff:Receptionist', 'staff:Housekeeping', 'staff:Maintenance'] },
  neworder: { label: 'New Food Order', icon: 'food', roles: ['admin', 'staff:Restaurant', 'staff:Receptionist'] },
  reports: { label: 'Reports', icon: 'chart', roles: ['admin', 'staff:Accountant'] },
  notifications: { label: 'Notifications', icon: 'bell', roles: [] },
  security: { label: 'Account & Security', icon: 'lock', roles: [] },
};
const NAV = {
  platform_admin: [['Platform', ['@overview', 'hotels', 'hotel_admins', 'users']], ['Catalogue', ['room_types', 'offers']], ['Monitoring', ['reservations', 'feedback', 'login_history']], ['Account', ['@notifications', '@security']]],
  admin: [['Hotel', ['@overview', 'my_hotel', '@floor']], ['Front Office', ['@frontdesk', '@walkin', 'reservations', 'guests', 'guest_documents', 'check_in_out']],
    ['Rooms', ['rooms', 'room_amenities', 'housekeeping', 'maintenance']], ['Billing', ['payments', 'invoices', 'offers']], ['Restaurant & Services', ['@neworder', 'food_menu', 'food_orders', 'services', 'service_requests']],
    ['People', ['employees', 'attendance', 'leave_requests', 'staff_tasks']], ['Insights', ['feedback', '@reports', 'login_history']], ['Account', ['@notifications', '@security']]],
  staff: [['Main', ['@overview', '@floor']], ['Front Office', ['@frontdesk', '@walkin', 'reservations', 'guests', 'guest_documents', 'check_in_out']], ['Rooms', ['rooms', 'room_amenities', 'housekeeping', 'maintenance']],
    ['Billing', ['payments', 'invoices', 'offers']], ['Restaurant & Services', ['@neworder', 'food_menu', 'food_orders', 'services', 'service_requests']], ['Insights', ['feedback', '@reports']],
    ['My Work', ['staff_tasks', 'attendance', 'leave_requests']], ['Management', ['employees']], ['Account', ['@notifications', '@security']]],
};
function navFor(u) {
  const out = [];
  for (const [section, keys] of NAV[u.role] || []) {
    const items = [];
    for (const k of keys) {
      if (k[0] === '@') { const pg = PAGES[k.slice(1)]; if (pg && can(u, pg.roles)) items.push({ key: k.slice(1), label: pg.label, icon: pg.icon, page: true }); }
      else { const d = defs[k]; if (d && can(u, d.read)) items.push({ key: k, label: (u.role === 'staff' && ['attendance', 'leave_requests', 'staff_tasks'].includes(k) && u.department !== 'Manager' ? 'My ' : '') + d.title, icon: d.icon || 'list' }); }
    }
    if (items.length) out.push({ section, items });
  }
  return out;
}
router.get('/api/meta', requireAuth('admin', 'platform_admin', 'staff:*'), (ctx) => {
  const u = ctx.user, resources = {};
  for (const [k, d] of Object.entries(defs)) {
    if (!can(u, d.read)) continue;
    const own = ownActive(d, u);
    resources[k] = { title: d.title, columns: d.columns, form: d.form || [], filtersUi: d.filtersUi || [], rowActions: d.rowActions || [], flow: d.flow || null, punch: !!d.punch,
      platformCols: d.hotel ? true : false,
      can: { create: !d.noCreate && (can(u, d.write) || !!(d.createOnly && can(u, d.createOnly)) || !!(own && d.own.create)),
        update: !d.noUpdate && (can(u, d.write) || !!(own && d.own.update)), delete: !d.noDelete && can(u, d.write) && !(own && d.own.update && u.role !== 'admin'), manager: isManagerish(u), own } };
  }
  ctx.json({ user: { id: u.id, name: u.full_name, role: u.role, department: u.department || null, hotel: u.hotel_name || 'InnovaStay Platform', hotel_id: u.hotel_id, employee_id: u.employee_id || null },
    nav: navFor(u), resources });
});

// ---------- Notifications (all roles) ----------
router.get('/api/notifications', requireAuth(), (ctx) => {
  const rows = db.all('SELECT id,title,message,type,is_read,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100', ctx.user.id);
  ctx.json({ items: rows, unread: db.get('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0', ctx.user.id).c });
});
router.get('/api/notifications/count', requireAuth(), (ctx) => ctx.json({ unread: db.get('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0', ctx.user.id).c }));
router.post('/api/notifications/read', requireAuth(), (ctx) => {
  if (ctx.body.id) db.run('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?', parseInt(ctx.body.id, 10), ctx.user.id);
  else db.run('UPDATE notifications SET is_read=1 WHERE user_id=?', ctx.user.id);
  ctx.json({ ok: true });
});
module.exports = { defs, isManagerish };
