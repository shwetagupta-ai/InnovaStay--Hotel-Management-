'use strict';
/** Account security (devices / sign-in history) and the hotel-portal global search box. */
const db = require('../config/db');
const config = require('../config');
const { router } = require('../utils/http');
const S = require('../utils/security');
const { requireAuth } = require('../middleware/auth');

// "Devices signed in" = recent successful logins (sessions are stateless signed cookies).
router.get('/api/auth/sessions', requireAuth(), (ctx) => {
  const ua = String(ctx.req.headers['user-agent'] || '').slice(0, 200);
  const rows = db.all('SELECT ip, user_agent, created_at FROM login_history WHERE user_id=? AND success=1 ORDER BY id DESC LIMIT 6', ctx.user.id);
  const sessions = rows.map((r, i) => ({ ...r, current: i === 0 && r.user_agent === ua }));
  if (sessions.length && !sessions.some((s) => s.current)) sessions[0].current = true;
  ctx.json({ sessions, history: db.all('SELECT portal, success, ip, created_at FROM login_history WHERE user_id=? ORDER BY id DESC LIMIT 12', ctx.user.id) });
});

// Bump token_version: every other device is signed out, this one gets a fresh cookie.
router.post('/api/auth/sessions/revoke-others', requireAuth(), (ctx) => {
  db.run('UPDATE users SET token_version = token_version + 1 WHERE id=?', ctx.user.id);
  const v = db.get('SELECT token_version tv FROM users WHERE id=?', ctx.user.id).tv;
  ctx.setCookie(S.sessionCookie(S.signToken({ sub: ctx.user.id, role: ctx.user.role, tv: v }), config.SESSION_HOURS * 3600));
  ctx.json({ ok: true, message: 'All other devices have been signed out.' });
});

// Global search for hotel admins / staff: bookings, guests, rooms of their own hotel.
router.get('/api/hotel/search', requireAuth('admin', 'staff:*'), (ctx) => {
  const q = S.clean(ctx.query.q, 40).replace(/[%_]/g, ''), like = `%${q}%`, h = ctx.user.hotel_id;
  if (q.length < 2) return ctx.json({ reservations: [], guests: [], rooms: [] });
  ctx.json({
    reservations: db.all(`SELECT r.id, r.booking_ref, r.check_in, r.check_out, r.status, g.full_name AS guest_name FROM reservations r JOIN guests g ON g.id=r.guest_id
                           WHERE r.hotel_id=? AND (r.booking_ref LIKE ? OR g.full_name LIKE ? OR g.mobile LIKE ?) ORDER BY r.id DESC LIMIT 5`, h, like, like, like),
    guests: db.all(`SELECT DISTINCT g.id, g.full_name, g.mobile, g.membership FROM guests g LEFT JOIN reservations r ON r.guest_id=g.id
                     WHERE (g.created_hotel_id=? OR r.hotel_id=?) AND (g.full_name LIKE ? OR g.mobile LIKE ? OR g.email LIKE ?) LIMIT 5`, h, h, like, like, like),
    rooms: db.all(`SELECT r.id, r.room_no AS room_number, r.floor, r.status, rt.name AS type_name FROM rooms r JOIN room_types rt ON rt.id=r.type_id
                    WHERE r.hotel_id=? AND r.room_no LIKE ? ORDER BY r.room_no LIMIT 5`, h, like),
  });
});
