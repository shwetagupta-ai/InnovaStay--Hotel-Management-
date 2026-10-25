'use strict';
/**
 * Business rules shared by routes: dates, dynamic pricing, availability,
 * billing/GST, loyalty tiers and notifications.
 */
const db = require('../config/db');
const config = require('../config');
const { randomCode } = require('./security');

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => fmt(new Date());
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return fmt(d); };
const nightsBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
const nightList = (a, b) => { const out = []; for (let d = a; d < b; d = addDays(d, 1)) out.push(d); return out; };
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ---------- Dynamic pricing ----------
function hotelOccupancy(hotelId, ci, co) {
  const total = db.get('SELECT COUNT(*) c FROM rooms WHERE hotel_id=? AND status NOT IN (\'Out of Service\')', hotelId).c || 1;
  const busy = db.get(`SELECT COUNT(DISTINCT room_id) c FROM reservations WHERE hotel_id=? AND status IN ('Confirmed','Checked-in','Pending')
                       AND check_in < ? AND check_out > ?`, hotelId, co, ci).c;
  return busy / total;
}
/** Price for a stay: base price + weekend (Fri/Sat) + peak-season + high-occupancy surcharge. */
function priceStay(basePrice, ci, co, occupancy = 0) {
  const P = config.PRICING;
  const nights = nightList(ci, co).map((d) => {
    const dt = new Date(d + 'T00:00:00'), dow = dt.getDay(), month = dt.getMonth() + 1;
    let mult = 1; const tags = [];
    if (dow === 5 || dow === 6) { mult += P.weekend; tags.push('weekend'); }
    if (P.peakMonths.includes(month)) { mult += P.peakSeason; tags.push('peak season'); }
    if (occupancy >= 0.8) { mult += P.highOccupancy; tags.push('high demand'); }
    return { date: d, price: round2(basePrice * mult), tags };
  });
  const total = round2(nights.reduce((s, n) => s + n.price, 0));
  return { nights, total, avg: nights.length ? round2(total / nights.length) : basePrice };
}

// ---------- Availability ----------
function roomIsFree(roomId, ci, co, excludeResId = 0) {
  return !db.get(`SELECT 1 x FROM reservations WHERE room_id=? AND id<>? AND status IN ('Pending','Confirmed','Checked-in')
                  AND check_in < ? AND (CASE WHEN status='Checked-in' AND check_out < date('now','localtime') THEN date('now','localtime','+1 day') ELSE check_out END) > ? LIMIT 1`, roomId, excludeResId, co, ci);
}
const BLOCKED = ['Maintenance', 'Out of Service'];

// ---------- Loyalty ----------
function tierFor(points) { return points >= 5000 ? 'Gold' : points >= 1000 ? 'Silver' : 'Bronze'; }
const tierDiscount = { Bronze: 0, Silver: 0.05, Gold: 0.10 };
function addPoints(guestId, points) {
  if (!guestId || !points) return;
  db.run('UPDATE guests SET loyalty_points = loyalty_points + ? WHERE id=?', points, guestId);
  const g = db.get('SELECT loyalty_points p FROM guests WHERE id=?', guestId);
  db.run('UPDATE guests SET membership=? WHERE id=?', tierFor(g.p), guestId);
}

// ---------- Billing ----------
function computeBill(resId) {
  const r = db.get(`SELECT r.*, rm.room_no, rt.name AS room_type, h.name AS hotel_name, h.city, h.address AS hotel_address, h.phone AS hotel_phone,
                    g.full_name AS guest_name, g.mobile AS guest_mobile, g.email AS guest_email
                    FROM reservations r JOIN rooms rm ON rm.id=r.room_id JOIN room_types rt ON rt.id=rm.type_id
                    JOIN hotels h ON h.id=r.hotel_id JOIN guests g ON g.id=r.guest_id WHERE r.id=?`, resId);
  if (!r) return null;
  const G = config.GST;
  const nights = Math.max(1, nightsBetween(r.check_in, r.check_out));
  const room = r.room_total;
  const foodItems = db.all(`SELECT fo.id, fo.created_at, fo.status, fo.total FROM food_orders fo WHERE fo.reservation_id=? AND fo.status<>'Cancelled'`, resId);
  const svcItems = db.all(`SELECT sr.id, s.name, sr.quantity, sr.amount, sr.created_at FROM service_requests sr JOIN services s ON s.id=sr.service_id
                           WHERE sr.reservation_id=? AND sr.status<>'Cancelled'`, resId);
  const food = round2(foodItems.reduce((s, i) => s + i.total, 0));
  const service = round2(svcItems.reduce((s, i) => s + i.amount, 0));
  const discount = Math.min(r.discount || 0, room);
  const roomRate = G.roomLow && room / nights <= G.roomThreshold ? G.roomLow : G.roomHigh;
  const roomTax = round2((room - discount) * roomRate), foodTax = round2(food * G.food), svcTax = round2(service * G.service);
  const tax = round2(roomTax + foodTax + svcTax);
  const total = round2(room - discount + food + service + tax);
  const pays = db.all('SELECT * FROM payments WHERE reservation_id=? ORDER BY id', resId);
  const paid = round2(pays.reduce((s, p) => s + (p.type === 'Refund' ? -p.amount : p.amount), 0));
  return { reservation: r, nights, room_charges: room, food_charges: food, service_charges: service, discount, tax,
    tax_breakdown: { room: roomTax, room_rate: roomRate, food: foodTax, service: svcTax }, total, paid, balance: round2(total - paid),
    payments: pays, food_orders: foodItems, services: svcItems };
}
function syncInvoice(resId) {
  const b = computeBill(resId); if (!b) return null;
  const status = b.paid <= 0 ? 'Unpaid' : b.paid + 0.005 >= b.total ? 'Paid' : 'Partial';
  const ex = db.get('SELECT id FROM invoices WHERE reservation_id=?', resId);
  if (ex) db.run('UPDATE invoices SET room_charges=?,food_charges=?,service_charges=?,discount=?,tax=?,total=?,paid=?,status=? WHERE id=?',
    b.room_charges, b.food_charges, b.service_charges, b.discount, b.tax, b.total, b.paid, status, ex.id);
  else {
    // invoice number comes from the unique row id, so it can never collide (even with many bookings per millisecond)
    const ins = db.run(`INSERT INTO invoices (hotel_id,invoice_no,reservation_id,room_charges,food_charges,service_charges,discount,tax,total,paid,status)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)`, b.reservation.hotel_id, 'TMP' + randomCode(12), resId,
      b.room_charges, b.food_charges, b.service_charges, b.discount, b.tax, b.total, b.paid, status);
    db.run('UPDATE invoices SET invoice_no=? WHERE id=?', 'INV-' + new Date().getFullYear() + '-' + String(Number(ins.lastInsertRowid)).padStart(6, '0'), Number(ins.lastInsertRowid));
  }
  return b;
}

// ---------- Notifications ----------
function notify(userId, hotelId, title, message, type = 'Info') {
  if (!userId) return;
  db.run('INSERT INTO notifications (user_id,hotel_id,title,message,type) VALUES (?,?,?,?,?)', userId, hotelId || null, title, message || '', type);
}
/** Notify every active user of a hotel whose role/department matches. depts: array of departments or ['admin'] */
function notifyHotel(hotelId, depts, title, message, type = 'Info') {
  const rows = db.all(`SELECT u.id FROM users u LEFT JOIN employees e ON e.user_id=u.id
     WHERE u.hotel_id=? AND u.status='Active' AND ((u.role='admin' AND ?) OR (u.role='staff' AND (e.department IN (${depts.map(() => '?').join(',') || "''"}) OR e.department='Manager')))`,
    hotelId, depts.includes('admin') ? 1 : 0, ...depts.filter((d) => d !== 'admin'));
  rows.forEach((u) => notify(u.id, hotelId, title, message, type));
}
const bookingRef = () => 'IS' + today().replace(/-/g, '').slice(2) + randomCode(4);

module.exports = { today, addDays, nightsBetween, nightList, round2, hotelOccupancy, priceStay, roomIsFree, BLOCKED,
  tierFor, tierDiscount, addPoints, computeBill, syncInvoice, notify, notifyHotel, bookingRef };
