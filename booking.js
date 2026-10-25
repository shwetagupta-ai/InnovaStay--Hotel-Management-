'use strict';
/** Reservation engine: quote, create, modify, cancel, waiting-list promotion. Used by customer and staff routes. */
const db = require('../config/db');
const { HttpError } = require('./http');
const S = require('./security');
const B = require('./business');

/** Price a stay incl. surcharges, coupon and loyalty discounts. Pure calculation – no writes. */
function quote({ room, guest, ci, co, coupon, early, late, excludeResId = 0 }) {
  const occ = B.hotelOccupancy(room.hotel_id, ci, co);
  const stay = B.priceStay(room.price, ci, co, occ);
  let total = stay.total;
  const extras = [];
  if (early) { const x = B.round2(stay.avg * 0.25); total += x; extras.push({ label: 'Early check-in', amount: x }); }
  if (late) { const x = B.round2(stay.avg * 0.25); total += x; extras.push({ label: 'Late check-out', amount: x }); }
  total = B.round2(total);
  const discounts = [];
  if (guest) {
    const td = B.tierDiscount[guest.membership] || 0;
    if (td) discounts.push({ label: `${guest.membership} member (${td * 100}%)`, amount: B.round2(total * td) });
    const stays = db.get("SELECT COUNT(*) c FROM reservations WHERE guest_id=? AND status='Checked-out'", guest.id).c;
    if (stays >= 3) discounts.push({ label: 'Repeat guest (3%)', amount: B.round2(total * 0.03) });
  }
  let couponInfo = null;
  if (coupon) {
    const code = S.clean(coupon, 20).toUpperCase();
    const o = db.get(`SELECT * FROM offers WHERE active=1 AND UPPER(code)=? AND (hotel_id=? OR hotel_id IS NULL)
                      AND (valid_from IS NULL OR valid_from <= date('now')) AND (valid_to IS NULL OR valid_to >= date('now')) ORDER BY hotel_id DESC LIMIT 1`, code, room.hotel_id);
    if (!o) throw new HttpError(400, 'Coupon code is invalid or expired.');
    if (total < o.min_amount) throw new HttpError(400, `Coupon needs a minimum booking of ₹${o.min_amount}.`);
    if (o.kind === 'Birthday') {
      const dob = guest && guest.dob; if (!dob || dob.slice(5, 7) !== ci.slice(5, 7)) throw new HttpError(400, 'Birthday offer is valid only in your birthday month.');
    }
    const amt = B.round2(o.discount_type === 'percent' ? total * o.value / 100 : o.value);
    discounts.push({ label: `Coupon ${o.code}`, amount: Math.min(amt, total) });
    couponInfo = o.code;
  }
  const discount = B.round2(Math.min(discounts.reduce((s, d) => s + d.amount, 0), total * 0.4));   // never more than 40% off
  return { stay, extras, room_total: total, discounts, discount, coupon: couponInfo, payable_before_tax: B.round2(total - discount) };
}

function validateStay(ci, co, adults, children, room) {
  if (!S.isDate(ci) || !S.isDate(co)) throw new HttpError(400, 'Please choose valid check-in and check-out dates.');
  if (co <= ci) throw new HttpError(400, 'Check-out must be after check-in.');
  if (B.nightsBetween(ci, co) > 30) throw new HttpError(400, 'Maximum stay is 30 nights.');
  if (adults < 1 || adults > 20 || children < 0 || children > 10) throw new HttpError(400, 'Invalid guest count.');
  if (room && adults + children > room.capacity + 1) throw new HttpError(400, `This room sleeps ${room.capacity} guests (one extra bed possible).`);
}

function createReservation(o) {
  const ci = o.check_in, co = o.check_out, adults = parseInt(o.adults, 10) || 1, children = parseInt(o.children, 10) || 0;
  const today = B.today();
  if (ci < today) throw new HttpError(400, 'Check-in date cannot be in the past.');
  return db.tx(() => {
    const room = db.get('SELECT r.*, h.status AS hotel_status FROM rooms r JOIN hotels h ON h.id=r.hotel_id WHERE r.id=?', o.room_id);
    if (!room || room.hotel_status !== 'Active') throw new HttpError(404, 'Room not found.');
    if (o.hotel_id && room.hotel_id !== o.hotel_id) throw new HttpError(403, 'Room belongs to a different hotel.');
    validateStay(ci, co, adults, children, room);
    const guest = db.get('SELECT * FROM guests WHERE id=?', o.guest_id);
    if (!guest) throw new HttpError(404, 'Guest not found.');
    if (guest.is_blacklisted) throw new HttpError(403, 'This guest profile is blocked. Please contact the hotel.');
    if (B.BLOCKED.includes(room.status) && ci <= B.addDays(today, 3)) throw new HttpError(409, 'This room is currently unavailable.');
    let status = o.status || 'Confirmed';
    if (!B.roomIsFree(room.id, ci, co)) {
      if (!o.waitlist) throw new HttpError(409, 'Sorry, this room was just booked for those dates. Please pick another room or join the waiting list.');
      status = 'Waiting';
    }
    const q = quote({ room, guest, ci, co, coupon: o.coupon, early: o.early_checkin, late: o.late_checkout });
    const ref = B.bookingRef();
    const r = db.run(`INSERT INTO reservations (booking_ref,hotel_id,guest_id,room_id,check_in,check_out,adults,children,status,booking_type,room_pref,early_checkin,late_checkout,
                      room_total,discount,coupon,qr_token,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ref, room.hotel_id, guest.id, room.id, ci, co, adults, children, status, o.booking_type || 'Online', S.clean(o.room_pref, 100) || null,
      o.early_checkin ? 1 : 0, o.late_checkout ? 1 : 0, q.room_total, q.discount, q.coupon, S.randomCode(12), S.clean(o.notes, 300) || null);
    const id = Number(r.lastInsertRowid);
    for (const g of (Array.isArray(o.extra_guests) ? o.extra_guests : []).slice(0, 10)) {
      const name = S.clean(g.name, 80); if (name) db.run('INSERT INTO reservation_guests (reservation_id,name,age,id_proof) VALUES (?,?,?,?)', id, name, parseInt(g.age, 10) || null, S.clean(g.id_proof, 40) || null);
    }
    const adv = parseFloat(o.advance) || 0;
    if (adv > 0 && status !== 'Waiting') db.run('INSERT INTO payments (hotel_id,reservation_id,amount,method,type,reference) VALUES (?,?,?,?,?,?)',
      room.hotel_id, id, adv, ['Cash', 'Card', 'UPI'].includes(o.method) ? o.method : 'UPI', 'Advance', 'ADV' + S.randomCode(6));
    B.syncInvoice(id);
    const gu = guest.user_id;
    if (status === 'Waiting') B.notify(gu, room.hotel_id, 'Added to waiting list', `Booking ${ref} is on the waiting list. We will confirm if the room frees up.`, 'Booking');
    else B.notify(gu, room.hotel_id, 'Booking confirmed', `Booking ${ref} confirmed for ${ci} → ${co}. Room ${room.room_no}.`, 'Booking');
    B.notifyHotel(room.hotel_id, ['Receptionist'], status === 'Waiting' ? 'Waiting-list request' : 'New reservation', `${guest.full_name} • Room ${room.room_no} • ${ci} → ${co} (${ref})`, 'Booking');
    return { id, booking_ref: ref, status, quote: q };
  });
}

function modifyReservation(id, o, actor) {
  return db.tx(() => {
    const r = db.get('SELECT * FROM reservations WHERE id=?', id);
    if (!r) throw new HttpError(404, 'Booking not found.');
    if (!['Confirmed', 'Pending'].includes(r.status)) throw new HttpError(400, `A ${r.status} booking cannot be modified.`);
    const ci = o.check_in || r.check_in, co = o.check_out || r.check_out;
    const adults = parseInt(o.adults ?? r.adults, 10), children = parseInt(o.children ?? r.children, 10);
    if (ci < B.today()) throw new HttpError(400, 'Check-in date cannot be in the past.');
    const room = db.get('SELECT * FROM rooms WHERE id=?', r.room_id);
    validateStay(ci, co, adults, children, room);
    if (!B.roomIsFree(room.id, ci, co, id)) throw new HttpError(409, 'The room is not available for the new dates.');
    const guest = db.get('SELECT * FROM guests WHERE id=?', r.guest_id);
    const early = o.early_checkin ?? r.early_checkin, late = o.late_checkout ?? r.late_checkout;
    const q = quote({ room, guest, ci, co, coupon: r.coupon, early, late });
    db.run('UPDATE reservations SET check_in=?,check_out=?,adults=?,children=?,early_checkin=?,late_checkout=?,room_total=?,discount=? WHERE id=?',
      ci, co, adults, children, early ? 1 : 0, late ? 1 : 0, q.room_total, q.discount, id);
    B.syncInvoice(id);
    B.notify(guest.user_id, r.hotel_id, 'Booking updated', `Booking ${r.booking_ref} now ${ci} → ${co}.`, 'Booking');
    B.notifyHotel(r.hotel_id, ['Receptionist'], 'Booking modified', `${guest.full_name} changed ${r.booking_ref} to ${ci} → ${co}.`, 'Booking');
    return { ok: true, quote: q };
  });
}

function cancelReservation(id, reason, by = 'guest') {
  return db.tx(() => {
    const r = db.get('SELECT * FROM reservations WHERE id=?', id);
    if (!r) throw new HttpError(404, 'Booking not found.');
    if (!['Confirmed', 'Pending', 'Waiting'].includes(r.status)) throw new HttpError(400, `A ${r.status} booking cannot be cancelled.`);
    db.run("UPDATE reservations SET status='Cancelled', notes=COALESCE(notes,'') || ? WHERE id=?", ` [Cancelled by ${by}: ${S.clean(reason, 120) || 'no reason'}]`, id);
    // Refund policy: 100% of advance if cancelled 2+ days before check-in, otherwise 50%
    const paid = B.computeBill(id).paid;
    let refund = 0;
    if (paid > 0) {
      refund = B.round2(paid * (B.nightsBetween(B.today(), r.check_in) >= 2 ? 1 : 0.5));
      db.run("INSERT INTO payments (hotel_id,reservation_id,amount,method,type,reference) VALUES (?,?,?,?,'Refund',?)", r.hotel_id, id, refund, 'UPI', 'RFD' + S.randomCode(6));
    }
    db.run("UPDATE invoices SET status=CASE WHEN ? > 0 THEN 'Refunded' ELSE status END WHERE reservation_id=?", refund, id);
    const g = db.get('SELECT * FROM guests WHERE id=?', r.guest_id);
    B.notify(g.user_id, r.hotel_id, 'Booking cancelled', `Booking ${r.booking_ref} cancelled.${refund ? ` Refund of ₹${refund} initiated.` : ''}`, 'Booking');
    B.notifyHotel(r.hotel_id, ['Receptionist'], 'Booking cancelled', `${g.full_name} – ${r.booking_ref} (${by}).`, 'Booking');
    promoteWaitlist(r.room_id);
    return { ok: true, refund };
  });
}

/** When a room frees up, confirm the oldest waiting reservation that now fits. */
function promoteWaitlist(roomId) {
  const waiting = db.all("SELECT * FROM reservations WHERE room_id=? AND status='Waiting' AND check_in >= date('now') ORDER BY id", roomId);
  for (const w of waiting) {
    if (B.roomIsFree(roomId, w.check_in, w.check_out, w.id)) {
      db.run("UPDATE reservations SET status='Confirmed' WHERE id=?", w.id);
      const g = db.get('SELECT user_id FROM guests WHERE id=?', w.guest_id);
      B.notify(g.user_id, w.hotel_id, 'Good news – room available!', `Your waiting-list booking ${w.booking_ref} is now confirmed.`, 'Booking');
    }
  }
}
module.exports = { quote, createReservation, modifyReservation, cancelReservation, promoteWaitlist };
