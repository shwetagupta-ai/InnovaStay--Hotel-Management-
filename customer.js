'use strict';
/** Customer portal API: profile, bookings, bills, room service, extra services, feedback, offers. */
const db = require('../config/db');
const { router, HttpError } = require('../utils/http');
const S = require('../utils/security');
const B = require('../utils/business');
const BK = require('../utils/booking');
const { requireAuth } = require('../middleware/auth');
const QR = require('../utils/qr');

const C = requireAuth('customer');
const myGuest = (ctx) => db.get('SELECT * FROM guests WHERE id=?', ctx.user.guest_id);
function ownBooking(ctx, id) {
  const r = db.get('SELECT * FROM reservations WHERE id=? AND guest_id=?', parseInt(id, 10), ctx.user.guest_id);
  if (!r) throw new HttpError(404, 'Booking not found.');
  return r;
}

router.get('/api/customer/overview', C, (ctx) => {
  const g = myGuest(ctx), gid = g.id;
  const next = db.get(`SELECT r.id, r.booking_ref, r.check_in, r.check_out, r.status, h.name hotel, h.city, rm.room_no FROM reservations r JOIN hotels h ON h.id=r.hotel_id
    JOIN rooms rm ON rm.id=r.room_id WHERE r.guest_id=? AND r.status IN ('Confirmed','Checked-in') AND r.check_out >= date('now') ORDER BY r.check_in LIMIT 1`, gid);
  const tiers = { Bronze: { next: 'Silver', at: 1000 }, Silver: { next: 'Gold', at: 5000 }, Gold: { next: null, at: null } };
  ctx.json({
    guest: g, next_booking: next, tier: tiers[g.membership],
    counts: { upcoming: db.get("SELECT COUNT(*) c FROM reservations WHERE guest_id=? AND status='Confirmed' AND check_in>=date('now')", gid).c,
      completed: db.get("SELECT COUNT(*) c FROM reservations WHERE guest_id=? AND status='Checked-out'", gid).c,
      unread: db.get('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0', ctx.user.id).c,
      spent: db.get("SELECT COALESCE(SUM(CASE WHEN type='Refund' THEN -amount ELSE amount END),0) s FROM payments p JOIN reservations r ON r.id=p.reservation_id WHERE r.guest_id=?", gid).s },
  });
});

// ---------- Profile & documents ----------
router.get('/api/customer/profile', C, (ctx) => ctx.json({ guest: myGuest(ctx), email: ctx.user.email, username: ctx.user.username,
  documents: db.all('SELECT id,doc_type,doc_number,verified,notes FROM guest_documents WHERE guest_id=?', ctx.user.guest_id) }));
router.put('/api/customer/profile', C, (ctx) => {
  const b = ctx.body, cl = (k, n) => S.clean(b[k], n) || null;
  if (b.dob && !S.isDate(b.dob)) throw new HttpError(400, 'Invalid date of birth.');
  if (b.emergency_phone && !S.isMobile(String(b.emergency_phone).replace(/[\s-]/g, ''))) throw new HttpError(400, 'Invalid emergency phone number.');
  db.run('UPDATE guests SET full_name=?, gender=?, dob=?, address=?, emergency_name=?, emergency_phone=?, preferences=? WHERE id=?',
    cl('full_name', 80) || ctx.user.full_name, cl('gender', 20), b.dob || null, cl('address', 250), cl('emergency_name', 80), cl('emergency_phone', 16), cl('preferences', 300), ctx.user.guest_id);
  db.run('UPDATE users SET full_name=? WHERE id=?', cl('full_name', 80) || ctx.user.full_name, ctx.user.id);
  ctx.json({ ok: true });
});
router.post('/api/customer/documents', C, (ctx) => {
  const type = ['Aadhaar', 'Passport', 'Driving License', 'Voter ID', 'Other'].includes(ctx.body.doc_type) ? ctx.body.doc_type : null;
  const num = S.clean(ctx.body.doc_number, 30).toUpperCase();
  if (!type || num.length < 5) throw new HttpError(400, 'Choose a document type and enter a valid number.');
  db.run('INSERT INTO guest_documents (guest_id,doc_type,doc_number) VALUES (?,?,?)', ctx.user.guest_id, type, num);
  ctx.json({ ok: true }, 201);
});
router.delete('/api/customer/documents/:id', C, (ctx) => {
  db.run('DELETE FROM guest_documents WHERE id=? AND guest_id=?', parseInt(ctx.params.id, 10), ctx.user.guest_id); ctx.json({ ok: true });
});

// ---------- Bookings ----------
router.post('/api/customer/quote', C, (ctx) => {
  const b = ctx.body, room = db.get('SELECT * FROM rooms WHERE id=?', parseInt(b.room_id, 10));
  if (!room) throw new HttpError(404, 'Room not found.');
  if (!S.isDate(b.check_in) || !S.isDate(b.check_out) || b.check_out <= b.check_in) throw new HttpError(400, 'Choose valid dates.');
  ctx.json({ quote: BK.quote({ room, guest: myGuest(ctx), ci: b.check_in, co: b.check_out, coupon: b.coupon, early: b.early_checkin, late: b.late_checkout }) });
});
router.post('/api/customer/bookings', C, (ctx) => {
  const b = ctx.body;
  const lim = S.rateLimit(`book:${ctx.user.id}`, 20, 60 * 60 * 1000);
  if (!lim.allowed) throw new HttpError(429, 'Too many booking attempts. Please try later.');
  const res = BK.createReservation({ ...b, room_id: parseInt(b.room_id, 10), guest_id: ctx.user.guest_id, booking_type: b.extra_guests && b.extra_guests.length > 2 ? 'Group' : 'Online' });
  ctx.json(res, 201);
});
router.get('/api/customer/bookings', C, (ctx) => {
  const rows = db.all(`SELECT r.id,r.booking_ref,r.check_in,r.check_out,r.adults,r.children,r.status,r.booking_type,r.room_total,r.discount,r.coupon,r.early_checkin,r.late_checkout,
    h.name hotel,h.city,rm.room_no,rt.name room_type, r.hotel_id,
    (SELECT COALESCE(SUM(CASE WHEN type='Refund' THEN -amount ELSE amount END),0) FROM payments WHERE reservation_id=r.id) paid,
    EXISTS(SELECT 1 FROM feedback f WHERE f.reservation_id=r.id AND f.kind='Feedback') AS reviewed
    FROM reservations r JOIN hotels h ON h.id=r.hotel_id JOIN rooms rm ON rm.id=r.room_id JOIN room_types rt ON rt.id=rm.type_id
    WHERE r.guest_id=? ORDER BY r.check_in DESC LIMIT 200`, ctx.user.guest_id);
  ctx.json({ bookings: rows });
});
router.put('/api/customer/bookings/:id', C, (ctx) => { const r = ownBooking(ctx, ctx.params.id); ctx.json(BK.modifyReservation(r.id, ctx.body, 'guest')); });
router.post('/api/customer/bookings/:id/cancel', C, (ctx) => { const r = ownBooking(ctx, ctx.params.id); ctx.json(BK.cancelReservation(r.id, ctx.body.reason, 'guest')); });
router.post('/api/customer/bookings/:id/pay', C, (ctx) => {
  const r = ownBooking(ctx, ctx.params.id), amount = parseFloat(ctx.body.amount);
  if (!(amount > 0)) throw new HttpError(400, 'Enter a valid amount.');
  const bill = B.computeBill(r.id);
  if (amount > bill.balance + 0.01) throw new HttpError(400, `Amount exceeds the pending balance of ₹${bill.balance}.`);
  const method = ['Card', 'UPI'].includes(ctx.body.method) ? ctx.body.method : 'UPI';
  db.run("INSERT INTO payments (hotel_id,reservation_id,amount,method,type,reference) VALUES (?,?,?,?,'Partial',?)", r.hotel_id, r.id, amount, method, 'PAY' + S.randomCode(6));
  B.syncInvoice(r.id);
  B.notify(ctx.user.id, r.hotel_id, 'Payment received', `₹${amount} received for ${r.booking_ref}.`, 'Payment');
  ctx.json({ ok: true });
});
router.get('/api/customer/bookings/:id/bill', C, (ctx) => ctx.json({ bill: B.computeBill(ownBooking(ctx, ctx.params.id).id) }));
router.get('/api/customer/bookings/:id/pass', C, (ctx) => {
  const r = ownBooking(ctx, ctx.params.id);
  ctx.json({ booking_ref: r.booking_ref, token: r.qr_token, qr: QR.toSvg(`INNOVASTAY:${r.qr_token}`) });
});

// ---------- Room service & extra services (only during an active stay) ----------
const activeStays = (ctx) => db.all(`SELECT r.id, r.hotel_id, r.booking_ref, rm.room_no, h.name hotel FROM reservations r JOIN rooms rm ON rm.id=r.room_id JOIN hotels h ON h.id=r.hotel_id
  WHERE r.guest_id=? AND r.status='Checked-in'`, ctx.user.guest_id);
router.get('/api/customer/stay', C, (ctx) => {
  const stays = activeStays(ctx).map((s) => ({ ...s,
    menu: db.all('SELECT id,name,category,price,description FROM food_menu WHERE hotel_id=? AND available=1 ORDER BY category,name', s.hotel_id),
    services: db.all('SELECT id,name,category,price FROM services WHERE hotel_id=? AND available=1 ORDER BY category,name', s.hotel_id),
    orders: db.all('SELECT id,status,total,created_at FROM food_orders WHERE reservation_id=? ORDER BY id DESC LIMIT 10', s.id),
    requests: db.all('SELECT sr.id,s.name,sr.status,sr.amount,sr.created_at FROM service_requests sr JOIN services s ON s.id=sr.service_id WHERE sr.reservation_id=? ORDER BY sr.id DESC LIMIT 10', s.id) }));
  ctx.json({ stays });
});
router.post('/api/customer/food-orders', C, (ctx) => {
  const stay = activeStays(ctx).find((s) => s.id === parseInt(ctx.body.reservation_id, 10));
  if (!stay) throw new HttpError(400, 'Room service is available only during your stay (after check-in).');
  const items = (Array.isArray(ctx.body.items) ? ctx.body.items : []).slice(0, 30);
  if (!items.length) throw new HttpError(400, 'Add at least one dish.');
  const out = db.tx(() => {
    let total = 0; const lines = [];
    for (const it of items) {
      const m = db.get('SELECT * FROM food_menu WHERE id=? AND hotel_id=? AND available=1', parseInt(it.menu_id, 10), stay.hotel_id);
      const qty = Math.min(20, Math.max(1, parseInt(it.qty, 10) || 1));
      if (!m) throw new HttpError(400, 'One of the dishes is no longer available.');
      total += m.price * qty; lines.push({ m, qty });
    }
    const room = db.get('SELECT room_id FROM reservations WHERE id=?', stay.id);
    const r = db.run(`INSERT INTO food_orders (hotel_id,reservation_id,room_id,order_type,special_request,total) VALUES (?,?,?,'Room Service',?,?)`,
      stay.hotel_id, stay.id, room.room_id, S.clean(ctx.body.special_request, 200) || null, B.round2(total));
    const id = Number(r.lastInsertRowid);
    lines.forEach((l) => db.run('INSERT INTO food_order_items (order_id,menu_id,qty,price) VALUES (?,?,?,?)', id, l.m.id, l.qty, l.m.price));
    B.notifyHotel(stay.hotel_id, ['Restaurant'], 'New room-service order', `Room ${stay.room_no}: ${lines.length} item(s), ₹${B.round2(total)}`, 'Food');
    return { id, total: B.round2(total) };
  });
  ctx.json(out, 201);
});
router.post('/api/customer/service-requests', C, (ctx) => {
  const stay = activeStays(ctx).find((s) => s.id === parseInt(ctx.body.reservation_id, 10));
  if (!stay) throw new HttpError(400, 'Services can be requested during your stay (after check-in).');
  const svc = db.get('SELECT * FROM services WHERE id=? AND hotel_id=? AND available=1', parseInt(ctx.body.service_id, 10), stay.hotel_id);
  if (!svc) throw new HttpError(404, 'Service not available.');
  const qty = Math.min(10, Math.max(1, parseInt(ctx.body.quantity, 10) || 1));
  db.run('INSERT INTO service_requests (hotel_id,service_id,reservation_id,guest_id,quantity,amount,requested_for,notes) VALUES (?,?,?,?,?,?,?,?)',
    stay.hotel_id, svc.id, stay.id, ctx.user.guest_id, qty, B.round2(svc.price * qty), S.clean(ctx.body.requested_for, 40) || null, S.clean(ctx.body.notes, 200) || null);
  B.notifyHotel(stay.hotel_id, ['Receptionist'], 'Service request', `Room ${stay.room_no}: ${svc.name} ×${qty}`, 'Service');
  ctx.json({ ok: true }, 201);
});

// ---------- Feedback & complaints ----------
router.get('/api/customer/feedback', C, (ctx) => ctx.json({ items: db.all(`SELECT f.*, h.name hotel FROM feedback f JOIN hotels h ON h.id=f.hotel_id WHERE f.guest_id=? ORDER BY f.id DESC`, ctx.user.guest_id) }));
router.post('/api/customer/feedback', C, (ctx) => {
  const b = ctx.body, r = ownBooking(ctx, b.reservation_id);
  const rate = (v) => { const n = parseInt(v, 10); return n >= 1 && n <= 5 ? n : null; };
  const kind = b.kind === 'Complaint' ? 'Complaint' : 'Feedback';
  if (kind === 'Feedback' && r.status !== 'Checked-out' && r.status !== 'Checked-in') throw new HttpError(400, 'You can review a stay once you have checked in.');
  if (!S.clean(b.comment, 600) && !rate(b.hotel_rating)) throw new HttpError(400, 'Please add a rating or a comment.');
  db.run('INSERT INTO feedback (hotel_id,guest_id,reservation_id,kind,room_rating,food_rating,staff_rating,hotel_rating,comment) VALUES (?,?,?,?,?,?,?,?,?)',
    r.hotel_id, ctx.user.guest_id, r.id, kind, rate(b.room_rating), rate(b.food_rating), rate(b.staff_rating), rate(b.hotel_rating), S.clean(b.comment, 600));
  if (kind === 'Complaint') B.notifyHotel(r.hotel_id, ['admin', 'Receptionist'], 'New complaint', S.clean(b.comment, 100), 'Complaint');
  const avg = db.get("SELECT AVG(hotel_rating) a FROM feedback WHERE hotel_id=? AND hotel_rating IS NOT NULL", r.hotel_id).a;
  if (avg) db.run('UPDATE hotels SET rating=? WHERE id=?', Math.round(avg * 10) / 10, r.hotel_id);
  ctx.json({ ok: true }, 201);
});

// ---------- Offers ----------
router.get('/api/customer/offers', C, (ctx) => {
  const g = myGuest(ctx);
  ctx.json({ membership: g.membership, points: g.loyalty_points, referral_code: g.referral_code,
    benefits: { Bronze: 'Earn 1 point per ₹100 spent', Silver: '5% discount on every booking', Gold: '10% discount + priority upgrades' },
    offers: db.all(`SELECT o.*, h.name hotel FROM offers o LEFT JOIN hotels h ON h.id=o.hotel_id WHERE o.active=1 AND (o.valid_to IS NULL OR o.valid_to>=date('now')) ORDER BY o.id DESC`) });
});
