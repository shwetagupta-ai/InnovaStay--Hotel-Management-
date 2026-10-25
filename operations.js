'use strict';
/** Front-desk and operational actions: check-in/out, walk-ins, room transfer, bills, floor view, attendance punch, QR pass lookup. */
const db = require('../config/db');
const { router, HttpError } = require('../utils/http');
const S = require('../utils/security');
const B = require('../utils/business');
const BK = require('../utils/booking');
const { requireAuth, can } = require('../middleware/auth');

const FRONT = requireAuth('admin', 'staff:Receptionist');
const hid = (ctx) => ctx.user.hotel_id;
function hotelRes(ctx, id) {
  const r = db.get('SELECT * FROM reservations WHERE id=? AND hotel_id=?', parseInt(id, 10), hid(ctx));
  if (!r) throw new HttpError(404, 'Booking not found.');
  return r;
}

// ---------- Front desk lists ----------
router.get('/api/ops/frontdesk', FRONT, (ctx) => {
  const h = hid(ctx), t = B.today();
  const base = `SELECT r.id,r.booking_ref,r.check_in,r.check_out,r.status,r.adults,r.children,r.booking_type,r.early_checkin,r.late_checkout,r.room_total,r.qr_token,g.id AS guest_id,g.full_name guest,g.mobile,g.membership,g.is_blacklisted,
    rm.room_no,rm.status AS room_status,rt.name room_type,
    (SELECT COALESCE(SUM(CASE WHEN type='Refund' THEN -amount ELSE amount END),0) FROM payments WHERE reservation_id=r.id) paid,
    (SELECT COUNT(*) FROM guest_documents WHERE guest_id=g.id) docs
    FROM reservations r JOIN guests g ON g.id=r.guest_id JOIN rooms rm ON rm.id=r.room_id JOIN room_types rt ON rt.id=rm.type_id WHERE r.hotel_id=? `;
  ctx.json({
    today: t,
    arrivals: db.all(base + "AND r.status='Confirmed' AND r.check_in<=? AND r.check_out>? ORDER BY r.check_in, r.id", h, t, t),
    inhouse: db.all(base + "AND r.status='Checked-in' ORDER BY r.check_out, rm.room_no", h),
    upcoming: db.all(base + "AND r.status IN ('Confirmed','Pending') AND r.check_in>? ORDER BY r.check_in LIMIT 50", h, t),
    waiting: db.all(base + "AND r.status='Waiting' ORDER BY r.id LIMIT 30", h),
    overdue: db.all(base + "AND r.status='Confirmed' AND r.check_in<? ORDER BY r.check_in LIMIT 30", h, t),
  });
});
router.get('/api/ops/reservation/:id', FRONT, (ctx) => {
  const r = hotelRes(ctx, ctx.params.id);
  ctx.json({ bill: B.computeBill(r.id), guests: db.all('SELECT name,age,id_proof FROM reservation_guests WHERE reservation_id=?', r.id),
    documents: db.all('SELECT id,doc_type,doc_number,verified FROM guest_documents WHERE guest_id=?', r.guest_id).map((d) => ({ ...d, doc_number: '•'.repeat(Math.max(0, d.doc_number.length - 4)) + d.doc_number.slice(-4) })),
    guest: db.get('SELECT id,full_name,mobile,email,emergency_name,emergency_phone,preferences,membership,loyalty_points,is_blacklisted FROM guests WHERE id=?', r.guest_id) });
});
router.get('/api/ops/lookup-token/:token', FRONT, (ctx) => {          // QR scan -> booking
  const r = db.get('SELECT id,booking_ref FROM reservations WHERE qr_token=? AND hotel_id=?', S.clean(ctx.params.token, 20).toUpperCase(), hid(ctx));
  if (!r) throw new HttpError(404, 'No booking found for this code at your hotel.');
  ctx.json(r);
});

// ---------- Check-in ----------
function doCheckIn(ctx, r, b) {
  const t = B.today();
  if (r.status !== 'Confirmed') throw new HttpError(400, `Only confirmed bookings can be checked in (this one is ${r.status}).`);
  if (r.check_in > t && !b.force) throw new HttpError(400, `Check-in date is ${r.check_in}. Arrival is early – tick "early check-in override" to proceed.`);
  const g = db.get('SELECT * FROM guests WHERE id=?', r.guest_id);
  if (g.is_blacklisted) throw new HttpError(403, `Guest is blocked: ${g.blacklist_reason || 'blacklisted'}.`);
  const room = db.get('SELECT * FROM rooms WHERE id=?', r.room_id);
  if (['Occupied', 'Maintenance', 'Out of Service'].includes(room.status)) throw new HttpError(409, `Room ${room.room_no} is ${room.status.toLowerCase()}. Transfer the guest to another room first.`);
  if (room.status === 'Cleaning' && !b.force) throw new HttpError(409, `Room ${room.room_no} is still being cleaned.`);
  const hasDoc = db.get('SELECT 1 x FROM guest_documents WHERE guest_id=?', g.id);
  const d = b.document;
  if (!hasDoc && !(d && d.doc_type && d.doc_number)) throw new HttpError(400, 'ID proof (Aadhaar / Passport / Driving License) is required for the digital registration form.');
  db.tx(() => {
    if (d && d.doc_type && d.doc_number) {
      if (!['Aadhaar', 'Passport', 'Driving License', 'Voter ID', 'Other'].includes(d.doc_type)) throw new HttpError(400, 'Invalid document type.');
      db.run('INSERT INTO guest_documents (guest_id,doc_type,doc_number,verified) VALUES (?,?,?,1)', g.id, d.doc_type, S.clean(d.doc_number, 30).toUpperCase());
    } else db.run('UPDATE guest_documents SET verified=1 WHERE guest_id=?', g.id);
    if (b.emergency_name || b.emergency_phone) db.run('UPDATE guests SET emergency_name=COALESCE(?,emergency_name), emergency_phone=COALESCE(?,emergency_phone) WHERE id=?', S.clean(b.emergency_name, 80) || null, S.clean(b.emergency_phone, 16) || null, g.id);
    db.run("UPDATE reservations SET status='Checked-in' WHERE id=?", r.id);
    db.run("UPDATE rooms SET status='Occupied' WHERE id=?", r.room_id);
    db.run("INSERT INTO check_in_out (hotel_id,reservation_id,room_id,checkin_time,handled_by) VALUES (?,?,?,datetime('now'),?)", r.hotel_id, r.id, r.room_id, ctx.user.id);
    B.notify(g.user_id, r.hotel_id, 'Welcome!', `You are checked in to Room ${room.room_no}. Enjoy your stay – room service is now available.`, 'Booking');
  });
  return { ok: true, room_no: room.room_no };
}
router.post('/api/ops/checkin', FRONT, (ctx) => {
  const b = ctx.body, r = b.token ? db.get('SELECT * FROM reservations WHERE qr_token=? AND hotel_id=?', S.clean(b.token, 20).toUpperCase(), hid(ctx)) : hotelRes(ctx, b.reservation_id);
  if (!r) throw new HttpError(404, 'Booking not found.');
  ctx.json(doCheckIn(ctx, r, b));
});

// ---------- Check-out ----------
router.post('/api/ops/checkout', FRONT, (ctx) => {
  const r = hotelRes(ctx, ctx.body.reservation_id), b = ctx.body;
  if (r.status !== 'Checked-in') throw new HttpError(400, 'Only checked-in guests can be checked out.');
  let bill = B.computeBill(r.id);
  if (bill.balance > 0.01) {
    const amt = parseFloat(b.settle_amount);
    if (!(amt > 0)) throw new HttpError(402, `Pending balance ₹${bill.balance}. Collect payment to check out.`, { balance: bill.balance });
    if (amt + 0.01 < bill.balance) throw new HttpError(400, `Final payment must clear the balance of ₹${bill.balance}.`);
  }
  const out = db.tx(() => {
    const amt = parseFloat(b.settle_amount);
    if (bill.balance > 0.01) db.run("INSERT INTO payments (hotel_id,reservation_id,amount,method,type,reference) VALUES (?,?,?,?,'Final',?)", r.hotel_id, r.id, bill.balance, ['Cash', 'Card', 'UPI'].includes(b.method) ? b.method : 'Cash', 'FIN' + S.randomCode(6));
    db.run("UPDATE reservations SET status='Checked-out' WHERE id=?", r.id);
    db.run("UPDATE check_in_out SET checkout_time=datetime('now') WHERE reservation_id=? AND checkout_time IS NULL", r.id);
    db.run("UPDATE rooms SET status='Cleaning' WHERE id=?", r.room_id);
    bill = B.syncInvoice(r.id);
    const g = db.get('SELECT * FROM guests WHERE id=?', r.guest_id);
    const pts = Math.floor(bill.total / 100);
    B.addPoints(g.id, pts);
    // automatic housekeeping assignment: active housekeeper with the fewest open tasks
    const hk = db.get(`SELECT e.id, e.user_id, (SELECT COUNT(*) FROM housekeeping h WHERE h.assigned_to=e.id AND h.status<>'Done') AS load FROM employees e
                       WHERE e.hotel_id=? AND e.department='Housekeeping' AND e.status='Active' ORDER BY load, e.id LIMIT 1`, r.hotel_id);
    const room = db.get('SELECT room_no FROM rooms WHERE id=?', r.room_id);
    db.run("INSERT INTO housekeeping (hotel_id,room_id,assigned_to,task,notes,scheduled_at) VALUES (?,?,?,'Cleaning',?,datetime('now'))", r.hotel_id, r.room_id, hk ? hk.id : null, `Post check-out cleaning (${r.booking_ref})`);
    if (hk) B.notify(hk.user_id, r.hotel_id, 'Room vacated', `Room ${room.room_no} needs cleaning.`, 'Task');
    else B.notifyHotel(r.hotel_id, ['Housekeeping'], 'Room vacated', `Room ${room.room_no} needs cleaning.`, 'Task');
    B.notify(g.user_id, r.hotel_id, 'Thank you for staying with us', `Invoice ${bill ? 'is ready' : ''}. You earned ${pts} loyalty points. Please share your feedback!`, 'Feedback');
    BK.promoteWaitlist(r.room_id);
    return { ok: true, points: pts, total: bill.total };
  });
  ctx.json(out);
});

router.post('/api/ops/cancel', FRONT, (ctx) => { const r = hotelRes(ctx, ctx.body.reservation_id); ctx.json(BK.cancelReservation(r.id, ctx.body.reason, 'hotel')); });
router.post('/api/ops/modify', FRONT, (ctx) => { const r = hotelRes(ctx, ctx.body.reservation_id); ctx.json(BK.modifyReservation(r.id, ctx.body, 'hotel')); });

// ---------- Room transfer ----------
router.post('/api/ops/transfer', FRONT, (ctx) => {
  const r = hotelRes(ctx, ctx.body.reservation_id), t = B.today();
  if (!['Confirmed', 'Checked-in'].includes(r.status)) throw new HttpError(400, 'Only confirmed or in-house bookings can change rooms.');
  const nr = db.get('SELECT * FROM rooms WHERE id=? AND hotel_id=?', parseInt(ctx.body.new_room_id, 10), r.hotel_id);
  if (!nr) throw new HttpError(404, 'New room not found.');
  if (nr.id === r.room_id) throw new HttpError(400, 'Guest is already in this room.');
  if (B.BLOCKED.includes(nr.status) || (r.status === 'Checked-in' && nr.status !== 'Available')) throw new HttpError(409, `Room ${nr.room_no} is not ready (${nr.status}).`);
  const from = r.status === 'Checked-in' ? t : r.check_in;
  if (!B.roomIsFree(nr.id, from, r.check_out, r.id)) throw new HttpError(409, `Room ${nr.room_no} is booked during these dates.`);
  db.tx(() => {
    let total = r.room_total;
    if (r.status === 'Checked-in') {
      const nights = Math.max(1, B.nightsBetween(r.check_in, r.check_out)), elapsed = Math.max(0, B.nightsBetween(r.check_in, t));
      const rest = B.priceStay(nr.price, t, r.check_out, B.hotelOccupancy(r.hotel_id, t, r.check_out));
      total = B.round2((r.room_total / nights) * elapsed + rest.total);
    } else total = B.round2(B.priceStay(nr.price, r.check_in, r.check_out, B.hotelOccupancy(r.hotel_id, r.check_in, r.check_out)).total);
    const old = db.get('SELECT room_no FROM rooms WHERE id=?', r.room_id);
    db.run('UPDATE reservations SET room_id=?, room_total=? WHERE id=?', nr.id, total, r.id);
    db.run('UPDATE check_in_out SET room_id=? WHERE reservation_id=? AND checkout_time IS NULL', nr.id, r.id);
    if (r.status === 'Checked-in') {
      db.run("UPDATE rooms SET status='Cleaning' WHERE id=?", r.room_id); db.run("UPDATE rooms SET status='Occupied' WHERE id=?", nr.id);
      db.run("INSERT INTO housekeeping (hotel_id,room_id,task,notes) VALUES (?,?, 'Cleaning', ?)", r.hotel_id, r.room_id, 'Room vacated after transfer');
    }
    B.syncInvoice(r.id);
    const g = db.get('SELECT user_id FROM guests WHERE id=?', r.guest_id);
    B.notify(g.user_id, r.hotel_id, 'Room changed', `Booking ${r.booking_ref} moved from Room ${old.room_no} to Room ${nr.room_no}.`, 'Booking');
  });
  ctx.json({ ok: true });
});

// ---------- Walk-in booking ----------
router.post('/api/ops/walkin', FRONT, (ctx) => {
  const b = ctx.body, gb = b.guest || {};
  const name = S.clean(gb.full_name, 80), mobile = S.clean(gb.mobile, 16).replace(/[\s-]/g, '');
  if (name.length < 2) throw new HttpError(400, 'Enter the guest name.');
  if (!S.isMobile(mobile)) throw new HttpError(400, 'Enter a valid mobile number.');
  const out = db.tx(() => {
    let g = db.get('SELECT * FROM guests WHERE mobile=?', mobile);
    if (!g) { const r = db.run('INSERT INTO guests (created_hotel_id,full_name,mobile,email,address) VALUES (?,?,?,?,?)', hid(ctx), name, mobile, S.clean(gb.email, 120) || null, S.clean(gb.address, 200) || null); g = db.get('SELECT * FROM guests WHERE id=?', Number(r.lastInsertRowid)); }
    if (gb.doc_type && gb.doc_number && ['Aadhaar', 'Passport', 'Driving License', 'Voter ID', 'Other'].includes(gb.doc_type))
      db.run('INSERT INTO guest_documents (guest_id,doc_type,doc_number,verified) VALUES (?,?,?,1)', g.id, gb.doc_type, S.clean(gb.doc_number, 30).toUpperCase());
    const ci = b.check_in || B.today();
    const res = BK.createReservation({ ...b, check_in: ci, room_id: parseInt(b.room_id, 10), hotel_id: hid(ctx), guest_id: g.id, booking_type: (b.extra_guests || []).length > 2 ? 'Group' : 'Walk-in', method: b.method || 'Cash' });
    return { ...res, guest_id: g.id };
  });
  if (b.instant_checkin && out.status === 'Confirmed') {
    const r = db.get('SELECT * FROM reservations WHERE id=?', out.id);
    try { doCheckIn(ctx, r, { force: true }); out.checked_in = true; } catch (e) { out.checkin_error = e.message; }
  }
  ctx.json(out, 201);
});
router.get('/api/ops/available-rooms', FRONT, (ctx) => {
  const ci = S.isDate(ctx.query.checkin) ? ctx.query.checkin : B.today();
  const co = S.isDate(ctx.query.checkout) && ctx.query.checkout > ci ? ctx.query.checkout : B.addDays(ci, 1);
  const rooms = db.all(`SELECT r.id, r.room_no, r.floor, r.price, r.capacity, r.status, rt.name type FROM rooms r JOIN room_types rt ON rt.id=r.type_id WHERE r.hotel_id=? AND r.status NOT IN ('Maintenance','Out of Service') ORDER BY r.room_no`, hid(ctx))
    .filter((r) => B.roomIsFree(r.id, ci, co) && (ci !== B.today() || r.status !== 'Occupied'));
  const occ = B.hotelOccupancy(hid(ctx), ci, co);
  ctx.json({ rooms: rooms.map((r) => ({ ...r, avg_price: B.priceStay(r.price, ci, co, occ).avg })) });
});

// ---------- Food order for a room/table (staff side) ----------
router.post('/api/ops/food-order', requireAuth('admin', 'staff:Restaurant', 'staff:Receptionist'), (ctx) => {
  const b = ctx.body, h = hid(ctx), items = (Array.isArray(b.items) ? b.items : []).slice(0, 40);
  if (!items.length) throw new HttpError(400, 'Add at least one dish.');
  const id = db.tx(() => {
    let resId = null, roomId = null, type = b.order_type === 'Dine-in' ? 'Dine-in' : 'Room Service';
    if (type === 'Room Service') {
      const r = db.get("SELECT * FROM reservations WHERE id=? AND hotel_id=? AND status='Checked-in'", parseInt(b.reservation_id, 10), h);
      if (!r) throw new HttpError(400, 'Choose an in-house guest (checked-in booking) for room service.');
      resId = r.id; roomId = r.room_id;
    } else if (b.reservation_id) { const r = db.get("SELECT * FROM reservations WHERE id=? AND hotel_id=? AND status='Checked-in'", parseInt(b.reservation_id, 10), h); if (r) { resId = r.id; roomId = r.room_id; } }
    if (type === 'Dine-in' && !S.clean(b.table_no, 10)) throw new HttpError(400, 'Enter the table number.');
    let total = 0; const lines = [];
    for (const it of items) {
      const m = db.get('SELECT * FROM food_menu WHERE id=? AND hotel_id=? AND available=1', parseInt(it.menu_id, 10), h), qty = Math.min(20, Math.max(1, parseInt(it.qty, 10) || 1));
      if (!m) throw new HttpError(400, 'A selected dish is unavailable.'); total += m.price * qty; lines.push([m, qty]);
    }
    const r = db.run('INSERT INTO food_orders (hotel_id,reservation_id,room_id,table_no,order_type,special_request,total) VALUES (?,?,?,?,?,?,?)', h, resId, roomId, S.clean(b.table_no, 10) || null, type, S.clean(b.special_request, 200) || null, B.round2(total));
    const oid = Number(r.lastInsertRowid); lines.forEach(([m, q]) => db.run('INSERT INTO food_order_items (order_id,menu_id,qty,price) VALUES (?,?,?,?)', oid, m.id, q, m.price));
    return oid;
  });
  ctx.json({ id }, 201);
});

// ---------- Bills (shared by customer / staff / platform) ----------
router.get('/api/ops/bill/:id', requireAuth(), (ctx) => {
  const r = db.get('SELECT * FROM reservations WHERE id=?', parseInt(ctx.params.id, 10)), u = ctx.user;
  const ok = r && ((u.role === 'customer' && r.guest_id === u.guest_id) || (['admin', 'staff'].includes(u.role) && r.hotel_id === u.hotel_id && can(u, ['admin', 'staff:Receptionist', 'staff:Accountant'])) || u.role === 'platform_admin');
  if (!ok) throw new HttpError(404, 'Invoice not found.');
  const b = B.computeBill(r.id), inv = db.get('SELECT invoice_no, created_at FROM invoices WHERE reservation_id=?', r.id);
  ctx.json({ bill: b, invoice: inv });
});

// ---------- Floor view + quick room status ----------
router.get('/api/ops/floor', requireAuth('admin', 'staff:Receptionist', 'staff:Housekeeping', 'staff:Maintenance'), (ctx) => {
  const rooms = db.all(`SELECT r.id,r.room_no,r.floor,r.price,r.status,rt.name type,
     CASE WHEN r.status='Available' AND EXISTS(SELECT 1 FROM reservations x WHERE x.room_id=r.id AND x.status='Confirmed' AND date('now')>=x.check_in AND date('now')<x.check_out) THEN 'Reserved' ELSE r.status END AS live_status,
     (SELECT g.full_name FROM reservations x JOIN guests g ON g.id=x.guest_id WHERE x.room_id=r.id AND x.status='Checked-in' LIMIT 1) AS guest,
     (SELECT x.check_out FROM reservations x WHERE x.room_id=r.id AND x.status='Checked-in' LIMIT 1) AS check_out
     FROM rooms r JOIN room_types rt ON rt.id=r.type_id WHERE r.hotel_id=? ORDER BY r.floor, r.room_no`, hid(ctx));
  const floors = {}; rooms.forEach((r) => (floors[r.floor] = floors[r.floor] || []).push(r));
  ctx.json({ floors: Object.entries(floors).map(([floor, rooms]) => ({ floor: +floor, rooms })) });
});
router.post('/api/ops/rooms/:id/status', requireAuth('admin', 'staff:Receptionist', 'staff:Housekeeping', 'staff:Maintenance'), (ctx) => {
  const status = ctx.body.status, u = ctx.user;
  const room = db.get('SELECT * FROM rooms WHERE id=? AND hotel_id=?', parseInt(ctx.params.id, 10), hid(ctx));
  if (!room) throw new HttpError(404, 'Room not found.');
  const allowed = u.role === 'admin' || u.department === 'Manager' ? ['Available', 'Cleaning', 'Maintenance', 'Out of Service']
    : u.department === 'Housekeeping' ? ['Available', 'Cleaning'] : u.department === 'Maintenance' ? ['Available', 'Maintenance', 'Out of Service'] : ['Available', 'Cleaning'];
  if (!allowed.includes(status)) throw new HttpError(403, 'You cannot set this status.');
  if (room.status === 'Occupied') throw new HttpError(409, 'Room is occupied – check the guest out first.');
  db.run('UPDATE rooms SET status=? WHERE id=?', status, room.id);
  if (status === 'Available') B.notifyHotel(room.hotel_id, ['Receptionist'], 'Room ready', `Room ${room.room_no} is available.`, 'Room');
  ctx.json({ ok: true });
});

// ---------- Attendance punch ----------
router.post('/api/ops/attendance/punch', requireAuth('staff:*'), (ctx) => {
  const u = ctx.user, d = B.today(), now = new Date(), tm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const row = db.get('SELECT * FROM attendance WHERE employee_id=? AND work_date=?', u.employee_id, d);
  if (!row) { db.run("INSERT INTO attendance (hotel_id,employee_id,work_date,status,check_in) VALUES (?,?,?,'Present',?)", u.hotel_id, u.employee_id, d, tm); return ctx.json({ ok: true, action: 'in', time: tm }); }
  if (row.check_out) throw new HttpError(400, 'You have already punched out today.');
  db.run('UPDATE attendance SET check_out=? WHERE id=?', tm, row.id);
  ctx.json({ ok: true, action: 'out', time: tm });
});

// ---------- Platform: reset a user's password ----------
router.post('/api/ops/users/:id/reset-password', requireAuth('platform_admin'), async (ctx) => {
  const u = db.get('SELECT * FROM users WHERE id=?', parseInt(ctx.params.id, 10));
  if (!u) throw new HttpError(404, 'User not found.');
  if (u.role === 'platform_admin' && u.id !== ctx.user.id) throw new HttpError(403, 'Cannot reset another platform admin.');
  const temp = 'Tmp@' + S.randomCode(6) + '9a';
  db.run('UPDATE users SET password_hash=?, token_version=token_version+1, failed_logins=0, locked_until=NULL WHERE id=?', await S.hashPassword(temp), u.id);
  ctx.json({ ok: true, message: `Temporary password for ${u.username}: ${temp} (shown once – ask the user to change it after login).` });
});
