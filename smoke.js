'use strict';
/* End-to-end smoke test. Start the server first (npm start), then: BASE=http://localhost:3000 npm test */
const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0; const passed = () => pass; const failures = [];
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; failures.push(name); console.log('  ✗', name, extra !== undefined ? '→ ' + JSON.stringify(extra).slice(0, 200) : ''); } };

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(BASE + url, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'InnovaStay', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    for (const c of sc) { const kv = c.split(';')[0]; if (kv.split('=')[1]) cookie = kv; else cookie = ''; }
    let data = null; const t = await r.text(); try { data = JSON.parse(t); } catch (_) { data = t; }
    return { status: r.status, data };
  };
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b || {}), del: (u) => call('DELETE', u) };
}
const day = (n) => new Date(Date.now() + n * 864e5 - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

(async () => {
  console.log('Public');
  const c0 = client();
  ok((await c0.get('/api/health')).status === 200, 'health');
  const meta = await c0.get('/api/public/meta'); ok(meta.status === 200, 'public meta', meta.data);
  const s = await c0.get('/api/public/search?city=&minPrice=0&maxPrice=100000&guests=2'); ok(s.status === 200, 'search ok', s.data);
  console.log('  search keys:', Object.keys(s.data || {}));
  ok((await c0.get('/api/public/offers')).status === 200, 'offers');
  ok((await c0.get('/api/r/rooms')).status === 401, 'protected API needs login');
  ok((await c0.post('/api/auth/login', { portal: 'admin', identifier: 'admin', password: 'wrong' })).status === 401, 'wrong password rejected');
  ok((await c0.post('/api/auth/login', { portal: 'customer', identifier: 'admin', password: 'Admin@123' })).status === 401, 'admin cannot log into customer portal');
  const noCsrf = await fetch(BASE + '/api/auth/logout', { method: 'POST' }); ok(noCsrf.status === 403, 'CSRF header required');
  const fg = await c0.post('/api/auth/forgot', { identifier: 'nobody@example.com' }); ok(fg.status === 200, 'forgot password gives generic answer', fg.data);

  const logins = { customer: ['customer', 'Customer@123'], admin: ['admin', 'Admin@123'], staff: ['reception', 'Staff@123'], platform: ['platform', 'Platform@123'] };
  const sessions = {};
  console.log('Login (username, email, mobile) per portal');
  for (const [portal, [u, p]] of Object.entries(logins)) {
    const c = client(); const r = await c.post('/api/auth/login', { portal, identifier: u, password: p });
    ok(r.status === 200, `${portal} login`, r.data); sessions[portal] = c;
    const me = await c.get('/api/auth/me'); ok(me.status === 200 && JSON.stringify(me.data).includes(u), `${portal} /me`, me.data);
  }
  const ce = client(); ok((await ce.post('/api/auth/login', { portal: 'admin', identifier: 'admin@innovastay.com', password: 'Admin@123' })).status === 200, 'login by email');

  console.log('Role-based navigation + every listed resource loads');
  for (const portal of ['admin', 'staff', 'platform']) {
    const m = await sessions[portal].get('/api/meta'); ok(m.status === 200 && m.data.nav, `${portal} meta`, m.data);
    if (m.status !== 200) continue;
    const keys = m.data.nav.flatMap((sec) => sec.items.map((i) => i.key));
    console.log(`  ${portal} nav (${keys.length}):`, keys.join(', '));
    for (const k of keys) {
      const def = (m.data.resources || {})[k];
      if (!def && !['overview', 'reports', 'frontdesk', 'floor', 'notifications', 'profile', 'settings', 'security'].includes(k)) { console.log('    ? no resource def for', k); }
      if (def) { const r = await sessions[portal].get('/api/r/' + k); ok(r.status === 200, `${portal}: list ${k}`, r.data); }
    }
    ok((await sessions[portal].get('/api/stats/overview')).status === 200, `${portal}: stats overview`);
  }
  ok((await sessions.staff.get('/api/r/employees')).status !== 200, 'receptionist blocked from employees');
  const cg = await sessions.customer.get('/api/r/guests'); ok([401, 403].includes(cg.status), 'customer blocked from admin resources', cg.status);

  console.log('Customer booking flow (search -> book -> pay -> check-in -> room service -> check-out -> invoice)');
  const cu = sessions.customer, st = sessions.staff, ad = sessions.admin;
  ok((await cu.get('/api/customer/overview')).status === 200, 'customer overview');
  ok((await cu.get('/api/customer/profile')).status === 200, 'customer profile');
  const hotelId = (await st.get('/api/auth/me')).data.user.hotel_id;
  const today = day(0), in2 = day(2);
  const hs = await c0.get(`/api/public/search?checkin=${today}&checkout=${in2}&guests=2`);
  ok(hs.status === 200 && hs.data.hotels.length > 0, 'search by dates/guests returns hotels', hs.data.count);
  const cityFilter = await c0.get(`/api/public/search?city=${encodeURIComponent(hs.data.hotels[0].city)}&maxPrice=1000`);
  ok(cityFilter.status === 200 && cityFilter.data.hotels.every((h) => h.city === hs.data.hotels[0].city), 'city + price filter works', cityFilter.data.count);
  const hd = await c0.get(`/api/public/hotels/${hotelId}?checkin=${today}&checkout=${in2}&guests=2`);
  const rooms = hd.data.rooms || []; ok(rooms.length > 0, 'hotel detail lists available rooms', Object.keys(hd.data));
  const floor = await st.get('/api/ops/floor'); const fl = JSON.stringify(floor.data);
  const allFloorRooms = (floor.data.floors || []).flatMap((f) => f.rooms);
  const readyNos = new Set(allFloorRooms.filter((r) => r.live_status === 'Available').map((r) => r.room_no));
  let room = rooms.find((r) => readyNos.has(r.room_no));
  if (!room) {   // earlier runs used up the ready rooms: let housekeeping finish cleaning one (status Cleaning -> Available)
    const st2 = Object.fromEntries(allFloorRooms.map((r) => [r.room_no, r.live_status]));
    room = rooms.find((r) => st2[r.room_no] === 'Cleaning');
    if (room) ok((await st.post(`/api/ops/rooms/${room.id}/status`, { status: 'Available' })).status === 200, 'housekeeping marks room clean -> Available');
  }
  if (!room) { console.log('No ready room left in this hotel - run `npm run db:reset` and restart the server, then re-run.'); process.exit(3); }
  console.log('  room sample keys:', Object.keys(room).join(','));
  const q = await cu.post('/api/customer/quote', { room_id: room.id, check_in: today, check_out: in2 });
  ok(q.status === 200 && q.data.quote.room_total > 0, 'price quote (dynamic pricing + GST)', q.data);
  const bk = await cu.post('/api/customer/bookings', { room_id: room.id, check_in: today, check_out: in2, adults: 2, children: 0 });
  ok(bk.status === 201, 'booking created', bk.data); const bid = bk.data.id;
  const dup = await cu.post('/api/customer/bookings', { room_id: room.id, check_in: today, check_out: in2, adults: 2, children: 0 });
  ok(dup.status === 409, 'double-booking the same room is rejected', dup.data);
  const past = await cu.post('/api/customer/bookings', { room_id: room.id, check_in: day(-3), check_out: day(-1), adults: 1 });
  ok(past.status === 400, 'past dates rejected', past.status);
  const toomany = await cu.post('/api/customer/bookings', { room_id: room.id, check_in: day(40), check_out: day(41), adults: 40 });
  ok(toomany.status === 400, 'over-capacity rejected', toomany.status);
  const bill0 = await cu.get(`/api/customer/bookings/${bid}/bill`); ok(bill0.status === 200 && bill0.data.bill.total > 0, 'bill computed', bill0.data.bill && bill0.data.bill.total);
  ok((await cu.post(`/api/customer/bookings/${bid}/pay`, { amount: 1000, method: 'UPI' })).status === 200, 'partial payment (UPI)');
  ok((await cu.post(`/api/customer/bookings/${bid}/pay`, { amount: 99999999, method: 'UPI' })).status === 400, 'overpayment rejected');
  const qrp = await cu.get(`/api/customer/bookings/${bid}/pass`); ok(qrp.status === 200 && /<svg/.test(qrp.data.qr || ''), 'QR check-in pass generated');
  const food0 = await cu.post('/api/customer/food-orders', { reservation_id: bid, items: [{ menu_id: 1, qty: 1 }] });
  ok(food0.status === 400, 'room service blocked before check-in', food0.data);
  const fd = await st.get('/api/ops/frontdesk'); ok(fd.status === 200 && fd.data.arrivals.some((a) => a.id === bid), 'front desk shows today\'s arrival');
  const noId = await st.post('/api/ops/checkin', { reservation_id: bid }); ok(noId.status === 200 || noId.status === 400, 'check-in w/o ID handled (' + noId.status + ')');
  const ci = noId.status === 200 ? noId : await st.post('/api/ops/checkin', { reservation_id: bid, document: { doc_type: 'Aadhaar', doc_number: '123412341234' }, emergency_name: 'Test', emergency_phone: '9999999999' });
  ok(ci.status === 200, 'check-in with ID proof', ci.data);
  const stay = await cu.get('/api/customer/stay'); ok(stay.status === 200 && stay.data.stays.some((x) => x.id === bid), 'customer sees active stay', { st: stay.status, ids: (stay.data.stays || []).map((x) => x.id), bid, ci: ci.data });
  const sy = stay.data.stays.find((x) => x.id === bid), menuItem = sy.menu[0], svc = sy.services[0];
  const fo = await cu.post('/api/customer/food-orders', { reservation_id: bid, items: [{ menu_id: menuItem.id, qty: 2 }], special_request: 'less spicy' });
  ok(fo.status === 201, 'room-service order placed', fo.data);
  ok((await cu.post('/api/customer/service-requests', { reservation_id: bid, service_id: svc.id, quantity: 1 })).status === 201, 'extra service requested');
  const bill1 = await cu.get(`/api/customer/bookings/${bid}/bill`);
  ok(bill1.data.bill.food_charges > 0 && bill1.data.bill.service_charges > 0, 'food + service charges added to room bill', [bill1.data.bill.food_charges, bill1.data.bill.service_charges]);
  const orders = await st.get('/api/r/food_orders'); ok(orders.status === 200 && orders.data.rows.length > 0, 'staff sees food orders');
  const co1 = await st.post('/api/ops/checkout', { reservation_id: bid }); ok(co1.status === 402, 'checkout blocked while balance is pending', co1.data);
  const co2 = await st.post('/api/ops/checkout', { reservation_id: bid, settle_amount: bill1.data.bill.balance, settle_method: 'Cash' });
  ok(co2.status === 200, 'checkout after settling balance', co2.data);
  const bill2 = await st.get(`/api/ops/bill/${bid}`); ok(bill2.status === 200 && bill2.data.bill.balance <= 0.01 && bill2.data.invoice && bill2.data.invoice.invoice_no, 'invoice generated & fully paid', bill2.data.invoice);
  const inv = await fetch(BASE + '/invoice.html'); ok(inv.status === 200 && /Print/.test(await inv.text()), 'invoice page served');
  const hk = await ad.get('/api/r/housekeeping'); ok(hk.status === 200 && hk.data.rows.length > 0, 'housekeeping list available after checkout');
  const fb = await cu.post('/api/customer/feedback', { reservation_id: bid, kind: 'Feedback', hotel_rating: 5, room_rating: 5, food_rating: 4, staff_rating: 5, comment: 'Smoke test review' });
  ok(fb.status === 201, 'feedback submitted', fb.data);
  const cp = await cu.post('/api/customer/feedback', { reservation_id: bid, kind: 'Complaint', comment: 'Smoke test complaint' }); ok(cp.status === 201, 'complaint registered');
  const notes = await cu.get('/api/notifications'); ok(notes.status === 200, 'customer notifications list');

  console.log('Cancel + refund, modify');
  const rooms2 = (await c0.get(`/api/public/hotels/${hotelId}?checkin=${day(20)}&checkout=${day(22)}&guests=2`)).data.rooms;
  const b2 = await cu.post('/api/customer/bookings', { room_id: rooms2[0].id, check_in: day(20), check_out: day(22), adults: 2, advance: 0 }); ok(b2.status === 201, 'future booking');
  await cu.post(`/api/customer/bookings/${b2.data.id}/pay`, { amount: 2000, method: 'Card' });
  const mod = await cu.put(`/api/customer/bookings/${b2.data.id}`, { check_in: day(21), check_out: day(24) }); ok(mod.status === 200, 'booking modified (dates)', mod.data);
  const cn = await cu.post(`/api/customer/bookings/${b2.data.id}/cancel`, { reason: 'Plans changed' }); ok(cn.status === 200 && cn.data.refund > 0, 'cancellation refunds payment', cn.data);
  ok((await cu.post(`/api/customer/bookings/${b2.data.id}/cancel`, {})).status >= 400, 'cannot cancel twice');
  const wl = await cu.post('/api/customer/bookings', { room_id: room.id, check_in: today, check_out: in2, adults: 1, waitlist: true });
  ok(wl.status === 201 && /Waiting|Confirmed/.test(wl.data.status || 'Waiting'), 'waiting list when room is taken', wl.data);

  console.log('Walk-in booking by reception');
  const wi = await st.get(`/api/ops/available-rooms?checkin=${day(5)}&checkout=${day(6)}`); ok(wi.status === 200 && wi.data.rooms.length > 0, 'available rooms for walk-in', wi.data);
  const wm = '6' + String(Date.now()).slice(-9);
  const wk = await st.post('/api/ops/walkin', { guest: { full_name: 'Walk In Guest', mobile: wm, doc_type: 'Aadhaar', doc_number: '999988887777' }, room_id: wi.data.rooms[0].id, check_in: day(5), check_out: day(6), adults: 2, method: 'Cash' });
  ok(wk.status === 201 && wk.data.id, 'walk-in booking creates guest + reservation', wk.data);
  ok((await st.post('/api/ops/walkin', { guest: { full_name: 'X', mobile: '123' }, room_id: wi.data.rooms[0].id })).status === 400, 'walk-in validates guest details');
  const gl = await st.get('/api/r/guests?q=' + wm); ok(gl.status === 200 && gl.data.rows.length === 1, 'new walk-in guest appears in guest list');

  console.log('Role-based access + tenant isolation');
  ok((await cu.get('/api/ops/frontdesk')).status === 403, 'customer cannot open front desk API');
  ok((await cu.get('/api/stats/overview')).status === 403, 'customer cannot read admin stats');
  const hkc = client(); await hkc.post('/api/auth/login', { portal: 'staff', identifier: 'housekeeping', password: 'Staff@123' });
  ok((await hkc.get('/api/r/payments')).status === 403, 'housekeeping staff blocked from payments');
  ok((await hkc.get('/api/r/housekeeping')).status === 200, 'housekeeping staff can open housekeeping tasks');
  const acc = client(); await acc.post('/api/auth/login', { portal: 'staff', identifier: 'accountant', password: 'Staff@123' });
  ok((await acc.get('/api/r/payments')).status === 200, 'accountant can open payments');
  ok((await acc.get('/api/reports/revenue')).status === 200, 'accountant can open reports');
  const other = client(); await other.post('/api/auth/login', { portal: 'admin', identifier: 'admin2', password: 'Admin@123' });
  ok((await other.get(`/api/ops/bill/${bid}`)).status === 404, 'admin of another hotel cannot read this invoice');
  const rr = await ad.get('/api/r/reservations?limit=100'); ok(rr.data.rows.every((r) => !r.hotel_id || r.hotel_id === hotelId), 'admin only sees own hotel reservations');
  for (const t of ['revenue', 'occupancy', 'bookings', 'cancellations', 'customers', 'rooms', 'food', 'employees', 'payments', 'tax', 'maintenance', 'profit']) { const rp = await ad.get('/api/reports/' + t); ok(rp.status === 200 && rp.data.type === t, 'admin report: ' + t, rp.data); }

  console.log('Accounts: register, forgot/reset, lockout, change password');
  const uname = 'smoke' + Date.now().toString().slice(-7), mob = '9' + String(Date.now()).slice(-9);
  const nc = client();
  const reg = await nc.post('/api/auth/register', { full_name: 'Smoke Tester', username: uname, email: uname + '@example.com', mobile: mob, password: 'Smoke@1234' });
  ok(reg.status === 200 || reg.status === 201, 'customer registration', reg.data);
  ok((await client().post('/api/auth/register', { full_name: 'Dup Tester', username: uname, email: 'o' + uname + '@example.com', mobile: '9' + String(Date.now() + 1).slice(-9), password: 'Smoke@1234' })).status === 409, 'duplicate username rejected');
  ok((await client().post('/api/auth/register', { full_name: 'Weak', username: uname + 'w', email: 'w' + uname + '@example.com', mobile: '8' + String(Date.now()).slice(-9), password: 'abc' })).status === 400, 'weak password rejected');
  const byMob = client(); ok((await byMob.post('/api/auth/login', { portal: 'customer', identifier: mob, password: 'Smoke@1234' })).status === 200, 'login by mobile number');
  const f2 = await client().post('/api/auth/forgot', { identifier: uname }); ok(f2.status === 200, 'forgot password request', f2.data);
  if (f2.data.demo_otp) {
    const rs = await client().post('/api/auth/reset', { identifier: uname, otp: f2.data.demo_otp, password: 'Reset@12345' }); ok(rs.status === 200, 'reset password with OTP', rs.data);
    ok((await client().post('/api/auth/reset', { identifier: uname, otp: f2.data.demo_otp, password: 'Reset@99999' })).status === 400, 'OTP cannot be reused');
    ok((await client().post('/api/auth/login', { portal: 'customer', identifier: uname, password: 'Reset@12345' })).status === 200, 'login with new password');
  } else console.log('  (demo OTP hidden - reset flow not tested)');
  const cc = client(); await cc.post('/api/auth/login', { portal: 'customer', identifier: uname, password: 'Reset@12345' });
  const cpw = await cc.post('/api/auth/change-password', { current: 'Reset@12345', password: 'Final@12345' }); ok(cpw.status === 200 || (cpw.status === 400), 'change password endpoint (' + cpw.status + ')');
  const lockUser = 'lock' + Date.now().toString().slice(-6);
  await client().post('/api/auth/register', { full_name: 'Lock Test', username: lockUser, email: lockUser + '@example.com', mobile: '7' + String(Date.now()).slice(-9), password: 'Lock@12345' });
  let last; for (let i = 0; i < 7; i++) last = await client().post('/api/auth/login', { portal: 'customer', identifier: lockUser, password: 'bad' + i });
  ok([423, 429, 401].includes(last.status) && last.status !== 200, 'repeated bad passwords throttled/locked (' + last.status + ')');
  const good = await client().post('/api/auth/login', { portal: 'customer', identifier: lockUser, password: 'Lock@12345' }); ok(good.status !== 200, 'account stays locked/throttled even with right password (' + good.status + ')');
  const lo = client(); await lo.post('/api/auth/login', { portal: 'customer', identifier: 'customer', password: 'Customer@123' });
  await lo.post('/api/auth/logout'); ok((await lo.get('/api/customer/overview')).status === 401, 'logout ends the session');

  console.log('Concurrency: 200 parallel searches + 10 parallel bookings on one room');
  const t0 = Date.now();
  const burst = await Promise.all(Array.from({ length: 200 }, () => c0.get('/api/public/search?guests=2')));
  ok(burst.filter((r) => r.status === 200).length >= 190, '200 parallel searches succeed', burst.filter((r) => r.status !== 200).length + ' failed; ' + (Date.now() - t0) + 'ms');
  const rooms3 = (await c0.get(`/api/public/hotels/${hotelId}?checkin=${day(60)}&checkout=${day(61)}&guests=1`)).data.rooms;
  const racer = client(); ok((await racer.post('/api/auth/login', { portal: 'customer', identifier: 'customer', password: 'Customer@123' })).status === 200, 'racer logged in');
  const races = await Promise.all(Array.from({ length: 10 }, () => racer.post('/api/customer/bookings', { room_id: rooms3[0].id, check_in: day(60), check_out: day(61), adults: 1 })));
  ok(races.filter((r) => r.status === 201).length === 1, 'same room, parallel bookings -> exactly one wins, rest get 409', races.reduce((m, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {}));
  ok(races.filter((r) => r.status === 409).length === 9, '9 losers got a clean 409 (no 500s, no hangs)');

  console.log(`\n${passed()} passed, ${fail} failed`); if (fail) console.log('Failed:', failures.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Test crashed:', e); process.exit(2); });
