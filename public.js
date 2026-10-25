'use strict';
/** Public (no login) endpoints used by the landing page: search filter, hotel details, recommendations, offers. */
const db = require('../config/db');
const { router, HttpError } = require('../utils/http');
const S = require('../utils/security');
const B = require('../utils/business');

// tiny TTL cache so thousands of identical searches do not hammer SQLite
const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  const val = fn();
  cache.set(key, { val, exp: Date.now() + ttlMs });
  if (cache.size > 500) for (const [k, v] of cache) if (v.exp < Date.now()) cache.delete(k);
  return val;
}
function dates(q) {
  let ci = q.checkin, co = q.checkout;
  if (!ci || !S.isDate(ci) || ci < B.today()) ci = B.today();
  if (!co || !S.isDate(co) || co <= ci) co = B.addDays(ci, 1);
  if (B.nightsBetween(ci, co) > 30) throw new HttpError(400, 'Maximum stay is 30 nights.');
  return { ci, co };
}
const busyRooms = (ci, co) => new Set(db.all(`SELECT DISTINCT room_id FROM reservations WHERE status IN ('Pending','Confirmed','Checked-in')
  AND check_in < ? AND (CASE WHEN status='Checked-in' AND check_out < date('now','localtime') THEN date('now','localtime','+1 day') ELSE check_out END) > ?`, co, ci).map((r) => r.room_id));

function availableRooms(q, { hotelId } = {}) {
  const { ci, co } = dates(q);
  const guests = Math.max(1, parseInt(q.guests, 10) || 1);
  const params = [guests]; let where = `h.status='Active' AND r.status NOT IN ('Maintenance','Out of Service') AND r.capacity >= ?`;
  if (hotelId) { where += ' AND h.id=?'; params.push(hotelId); }
  if (q.city) { where += ' AND h.city = ? COLLATE NOCASE'; params.push(S.clean(q.city, 60)); }
  if (q.type) { where += ' AND rt.name = ? COLLATE NOCASE'; params.push(S.clean(q.type, 30)); }
  const rooms = db.all(`SELECT r.id, r.hotel_id, r.room_no, r.floor, r.price, r.capacity, r.description, rt.name AS type, h.name AS hotel, h.city, h.stars, h.rating,
     (SELECT group_concat(amenity, '|') FROM room_amenities WHERE room_id=r.id) AS amenities
     FROM rooms r JOIN hotels h ON h.id=r.hotel_id JOIN room_types rt ON rt.id=r.type_id WHERE ${where}`, ...params);
  const busy = busyRooms(ci, co), occ = {};
  const min = parseFloat(q.min) || 0, max = parseFloat(q.max) || Infinity, out = [];
  for (const r of rooms) {
    if (busy.has(r.id)) continue;
    if (occ[r.hotel_id] === undefined) occ[r.hotel_id] = B.hotelOccupancy(r.hotel_id, ci, co);
    const p = B.priceStay(r.price, ci, co, occ[r.hotel_id]);
    if (p.avg < min || p.avg > max) continue;
    out.push({ ...r, amenities: r.amenities ? r.amenities.split('|') : [], avg_price: p.avg, total_price: p.total, nights: p.nights.length, tags: [...new Set(p.nights.flatMap((n) => n.tags))] });
  }
  return { ci, co, guests, rooms: out };
}

router.get('/api/public/meta', (ctx) => ctx.json(cached('meta', 30000, () => ({
  cities: db.all("SELECT DISTINCT city FROM hotels WHERE status='Active' ORDER BY city").map((c) => c.city),
  room_types: db.all('SELECT name, max_guests FROM room_types ORDER BY base_price'),
  stats: { hotels: db.get("SELECT COUNT(*) c FROM hotels WHERE status='Active'").c, rooms: db.get('SELECT COUNT(*) c FROM rooms').c,
    cities: db.get("SELECT COUNT(DISTINCT city) c FROM hotels WHERE status='Active'").c, guests: db.get('SELECT COUNT(*) c FROM guests').c },
  price_range: db.get('SELECT MIN(price) min, MAX(price) max FROM rooms'),
}))));

router.get('/api/public/search', (ctx) => {
  const key = 'search:' + ctx.req.url;
  ctx.json(cached(key, 5000, () => {
    const { ci, co, guests, rooms } = availableRooms(ctx.query);
    const hotels = new Map();
    for (const r of rooms) {
      let h = hotels.get(r.hotel_id);
      if (!h) { h = { id: r.hotel_id, name: r.hotel, city: r.city, stars: r.stars, rating: r.rating, rooms_available: 0, from_price: r.avg_price, types: new Set(), amenities: new Set(), tags: new Set() }; hotels.set(r.hotel_id, h); }
      h.rooms_available++; h.from_price = Math.min(h.from_price, r.avg_price); h.types.add(r.type);
      r.amenities.slice(0, 6).forEach((a) => h.amenities.add(a)); r.tags.forEach((t) => h.tags.add(t));
    }
    let list = [...hotels.values()].map((h) => ({ ...h, types: [...h.types], amenities: [...h.amenities].slice(0, 6), tags: [...h.tags] }));
    const sort = ctx.query.sort;
    list.sort(sort === 'rating' ? (a, b) => b.rating - a.rating : (a, b) => a.from_price - b.from_price);
    return { checkin: ci, checkout: co, guests, count: list.length, hotels: list.slice(0, 40) };
  }));
});

router.get('/api/public/hotels/:id', (ctx) => {
  const id = parseInt(ctx.params.id, 10);
  const hotel = db.get("SELECT id,name,city,state,address,stars,description,phone,email,rating FROM hotels WHERE id=? AND status='Active'", id);
  if (!hotel) throw new HttpError(404, 'Hotel not found');
  const { ci, co, guests, rooms } = availableRooms(ctx.query, { hotelId: id });
  const reviews = db.all(`SELECT g.full_name name, f.hotel_rating rating, f.comment, substr(f.created_at,1,10) date FROM feedback f JOIN guests g ON g.id=f.guest_id
                          WHERE f.hotel_id=? AND f.kind='Feedback' AND f.comment<>'' ORDER BY f.id DESC LIMIT 5`, id);
  ctx.json({ hotel, checkin: ci, checkout: co, guests, rooms: rooms.sort((a, b) => a.avg_price - b.avg_price), reviews,
    offers: db.all("SELECT title, code, discount_type, value, min_amount, valid_to FROM offers WHERE active=1 AND (hotel_id=? OR hotel_id IS NULL)", id) });
});


// Single room card (used by the customer booking page when arriving from a landing-page link).
router.get('/api/public/rooms/:id', (ctx) => {
  const r = db.get(`SELECT r.id, r.hotel_id, r.room_no, r.floor, r.price, r.capacity, r.description, rt.name AS type, h.name AS hotel, h.city, h.rating,
     (SELECT group_concat(amenity, '|') FROM room_amenities WHERE room_id=r.id) AS amenities
     FROM rooms r JOIN hotels h ON h.id=r.hotel_id JOIN room_types rt ON rt.id=r.type_id WHERE r.id=? AND h.status='Active'`, parseInt(ctx.params.id, 10));
  if (!r) throw new HttpError(404, 'Room not found');
  ctx.json({ room: { ...r, amenities: r.amenities ? r.amenities.split('|') : [] } });
});

/** Smart room recommendation: scores rooms by budget fit, capacity fit and wanted amenities. */
router.get('/api/public/recommend', (ctx) => {
  const q = ctx.query, budget = parseFloat(q.budget) || 0;
  const want = String(q.amenities || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const { rooms } = availableRooms({ ...q, max: budget ? budget * 1.15 : undefined });
  const scored = rooms.map((r) => {
    let score = 50;
    if (budget) score += Math.max(0, 25 - Math.abs(budget - r.avg_price) / budget * 50);          // closer to budget = better
    score += Math.max(0, 10 - (r.capacity - Math.max(1, parseInt(q.guests, 10) || 1)) * 4);        // do not oversize
    const have = r.amenities.map((a) => a.toLowerCase());
    const hit = want.filter((w) => have.some((a) => a.includes(w)));
    score += want.length ? (hit.length / want.length) * 25 : 0;
    score += (r.rating - 4) * 5;
    return { ...r, score: Math.round(score), matched: hit };
  }).sort((a, b) => b.score - a.score).slice(0, 6);
  ctx.json({ recommendations: scored });
});

router.get('/api/public/offers', (ctx) => ctx.json({ offers: cached('offers', 30000, () => db.all(
  `SELECT o.title, o.code, o.kind, o.discount_type, o.value, o.min_amount, o.valid_to, h.name AS hotel FROM offers o LEFT JOIN hotels h ON h.id=o.hotel_id
   WHERE o.active=1 AND (o.valid_to IS NULL OR o.valid_to >= date('now')) ORDER BY o.id DESC LIMIT 12`)) }));

router.get('/api/public/testimonials', (ctx) => ctx.json({ items: cached('testi', 60000, () => db.all(
  `SELECT g.full_name name, f.hotel_rating rating, f.comment, h.name hotel FROM feedback f JOIN guests g ON g.id=f.guest_id JOIN hotels h ON h.id=f.hotel_id
   WHERE f.kind='Feedback' AND f.hotel_rating>=4 AND f.comment<>'' ORDER BY f.id DESC LIMIT 6`)) }));

module.exports = { availableRooms, busyRooms };
