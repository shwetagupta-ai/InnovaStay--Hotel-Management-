'use strict';
/**
 * Demo data for InnovaStay: 6 hotels, ~84 rooms, staff, customers, six months of bookings, payments, invoices,
 * food orders, feedback, maintenance and housekeeping records so every dashboard has something to show.
 *
 *   node database/seed.js --reset     -> wipe the database file and reload demo data
 */
const fs = require('fs');
const path = require('path');

if (require.main === module) {
  if (process.argv.includes('--reset')) {
    const config = require('../backend/config');
    for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(config.DB_PATH + ext); } catch (_) {} }
  }
  const db = require('../backend/config/db');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  if (db.get('SELECT COUNT(*) c FROM users').c) console.log('Database already has data. Use --reset to start fresh.');
  else { seed(db); console.log('Demo data loaded.'); }
}

function seed(db) {
  const S = require('../backend/utils/security');
  const B = require('../backend/utils/business');

  // deterministic pseudo-random numbers so every fresh install looks the same
  let a = 20261022;
  const rnd = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const today = B.today();
  const hashes = {};
  const hash = (pw) => (hashes[pw] = hashes[pw] || S.hashPasswordSync(pw));   // one hash per demo password keeps seeding fast

  db.tx(() => {
    ['platform_admin', 'admin', 'staff', 'customer'].forEach((r) => db.run('INSERT INTO roles (name, description) VALUES (?,?)', r, r.replace('_', ' ')));

    // ---------- catalogue ----------
    const types = [['Single', 'Cosy room for one traveller', 1800, 1], ['Double', 'Comfortable room with a queen bed', 3200, 2], ['Deluxe', 'Spacious room with premium furnishing', 5200, 3],
      ['Suite', 'Luxury suite with living area', 9500, 4], ['Family', 'Large room for families with extra beds', 6800, 5]];
    types.forEach((t) => db.run('INSERT INTO room_types (name,description,base_price,max_guests) VALUES (?,?,?,?)', ...t));
    const typeId = Object.fromEntries(db.all('SELECT id,name FROM room_types').map((t) => [t.name, t.id]));

    const hotelDefs = [
      ['InnovaStay Grand Mumbai', 'Mumbai', 'Maharashtra', 'Marine Drive, Churchgate', 5, 1.35, 'Iconic harbour-view hotel with a rooftop lounge, spa and fine dining.'],
      ['InnovaStay Capital Delhi', 'Delhi', 'Delhi', 'Connaught Place', 5, 1.25, 'Business-class stay in the heart of the capital with a conference centre.'],
      ['InnovaStay Garden Bengaluru', 'Bengaluru', 'Karnataka', 'MG Road', 4, 1.1, 'Green courtyard hotel close to tech parks, cafés and shopping.'],
      ['InnovaStay Heritage Jaipur', 'Jaipur', 'Rajasthan', 'C-Scheme, Ashok Marg', 4, 0.95, 'Royal Rajasthani hospitality with a heritage courtyard and cultural evenings.'],
      ['InnovaStay Beach Resort Goa', 'Goa', 'Goa', 'Calangute Beach Road', 5, 1.2, 'Beachfront resort with an infinity pool, water sports and sunset deck.'],
      ['InnovaStay Lakeview Hyderabad', 'Hyderabad', 'Telangana', 'Banjara Hills Road No. 12', 4, 1.0, 'Modern hotel with lake views, biryani kitchen and a skyline bar.'],
    ];
    hotelDefs.forEach((h) => db.run('INSERT INTO hotels (name,city,state,address,stars,description,phone,email,rating) VALUES (?,?,?,?,?,?,?,?,?)',
      h[0], h[1], h[2], h[3], h[4], h[6], '+91 80' + int(10000000, 99999999), h[1].toLowerCase() + '@innovastay.com', 4.2 + Math.round(rnd() * 6) / 10));
    const hotels = db.all('SELECT * FROM hotels ORDER BY id');

    // rooms: 3 floors per hotel
    const layout = [[1, 'Single', 2], [1, 'Double', 3], [2, 'Deluxe', 3], [2, 'Family', 2], [3, 'Suite', 2], [3, 'Deluxe', 2]];
    const baseAm = ['WiFi', 'AC', 'Smart TV'], amByType = { Single: ['Work Desk'], Double: ['Mini Bar', 'Work Desk'], Deluxe: ['Mini Bar', 'Breakfast Included', 'Bathtub', 'Balcony'],
      Suite: ['Mini Bar', 'Breakfast Included', 'Bathtub', 'Balcony', 'Spa Access', 'Lounge Access'], Family: ['Extra Bed', 'Kitchenette', 'Breakfast Included', 'Balcony'] };
    const hotelAm = { Mumbai: 'Sea View', Delhi: 'Gym Access', Bengaluru: 'Garden View', Jaipur: 'Courtyard View', Goa: 'Pool', Hyderabad: 'Lake View' };
    hotels.forEach((h, hi) => {
      const factor = hotelDefs[hi][5]; let n = { 1: 100, 2: 200, 3: 300 };
      layout.forEach(([floor, type, count]) => {
        for (let i = 0; i < count; i++) {
          n[floor]++;
          const base = types.find((t) => t[0] === type)[2], price = Math.round((base * factor * (1 + floor * 0.02)) / 50) * 50, cap = types.find((t) => t[0] === type)[3];
          const r = db.run('INSERT INTO rooms (hotel_id,room_no,floor,type_id,price,capacity,description) VALUES (?,?,?,?,?,?,?)', h.id, String(n[floor]), floor, typeId[type], price, cap, `${type} room on floor ${floor}`);
          const rid = Number(r.lastInsertRowid);
          [...baseAm, ...(amByType[type] || []), ...(type === 'Suite' || type === 'Deluxe' ? [hotelAm[h.city]] : [])].forEach((am) => db.run('INSERT INTO room_amenities (room_id,amenity) VALUES (?,?)', rid, am));
        }
      });
    });

    // menu + services + offers
    const menu = [['Paneer Tikka', 'Starters', 380], ['Chicken 65', 'Starters', 420], ['Tomato Soup', 'Starters', 220], ['Butter Chicken', 'Main Course', 520], ['Dal Makhani', 'Main Course', 360], ['Veg Biryani', 'Rice', 390],
      ['Chicken Biryani', 'Rice', 480], ['Butter Naan', 'Breads', 80], ['Garlic Naan', 'Breads', 95], ['Gulab Jamun', 'Desserts', 160], ['Chocolate Brownie', 'Desserts', 220], ['Masala Chai', 'Beverages', 90],
      ['Fresh Lime Soda', 'Beverages', 130], ['Cold Coffee', 'Beverages', 170], ['Masala Omelette', 'Breakfast', 200], ['Aloo Paratha', 'Breakfast', 180]];
    const svcs = [['Airport Pickup/Drop', 'Airport Pickup/Drop', 1400], ['City Taxi (8 hrs)', 'Taxi/Cab', 2600], ['Laundry (per bag)', 'Laundry', 450], ['Signature Spa (60 min)', 'Spa', 2800], ['Gym Day Pass', 'Gym', 400],
      ['Swimming Pool Access', 'Swimming Pool', 300], ['Room Decoration', 'Room Decoration', 1800], ['Extra Bed', 'Extra Bed', 900], ['Baby Cot', 'Baby Cot', 400], ['Wake-up Call', 'Wake-up Call', 0],
      ['Local Tourist Guide', 'Tourist Guide', 1500], ['Banquet Hall (per event)', 'Event/Banquet', 25000]];
    hotels.forEach((h) => { menu.forEach((m) => db.run('INSERT INTO food_menu (hotel_id,name,category,price) VALUES (?,?,?,?)', h.id, ...m)); svcs.forEach((s) => db.run('INSERT INTO services (hotel_id,name,category,price) VALUES (?,?,?,?)', h.id, ...s)); });
    const nextYear = B.addDays(today, 365);
    [[null, 'Welcome offer – 10% off', 'WELCOME10', 'Coupon', 'percent', 10, 3000], [null, 'Festive season – 15% off', 'FESTIVE15', 'Seasonal', 'percent', 15, 8000], [null, 'Flat ₹500 off', 'FLAT500', 'Coupon', 'flat', 500, 6000],
      [null, 'Happy birthday – 20% off', 'BDAY20', 'Birthday', 'percent', 20, 2000], [null, 'Refer a friend – 5% off', 'FRIEND5', 'Referral', 'percent', 5, 2500], [null, 'Gold member perk – 8% off', 'GOLD8', 'Loyalty', 'percent', 8, 4000],
      [hotels[4].id, 'Goa beach weekend – 12% off', 'GOABEACH', 'Seasonal', 'percent', 12, 5000], [hotels[0].id, 'Mumbai monsoon – ₹1000 off', 'MUMBAI1000', 'Coupon', 'flat', 1000, 9000]]
      .forEach((o) => db.run('INSERT INTO offers (hotel_id,title,code,kind,discount_type,value,min_amount,valid_from,valid_to) VALUES (?,?,?,?,?,?,?,?,?)', o[0], o[1], o[2], o[3], o[4], o[5], o[6], B.addDays(today, -30), nextYear));

    // ---------- users ----------
    const mkUser = (username, name, email, mobile, role, hotelId, pw) => Number(db.run('INSERT INTO users (username,email,mobile,full_name,password_hash,role,hotel_id) VALUES (?,?,?,?,?,?,?)', username, email, mobile, name, hash(pw), role, hotelId).lastInsertRowid);
    mkUser('platform', 'Platform Administrator', 'platform@innovastay.com', '9000000001', 'platform_admin', null, 'Platform@123');
    const adminNames = ['Rohan Mehta', 'Anita Verma', 'Karan Nair', 'Meera Shekhawat', 'Joseph Fernandes', 'Imran Qureshi'];
    hotels.forEach((h, i) => mkUser(i === 0 ? 'admin' : 'admin' + (i + 1), adminNames[i], i === 0 ? 'admin@innovastay.com' : `admin${i + 1}@innovastay.com`, '90000001' + String(i).padStart(2, '0'), 'admin', h.id, 'Admin@123'));

    const staffPlan = [['Receptionist', 'reception', 'Front Desk Executive', 'Morning', 28000], ['Manager', 'manager', 'General Manager', 'Morning', 85000], ['Housekeeping', 'housekeeping', 'Housekeeping Supervisor', 'Morning', 22000],
      ['Restaurant', 'restaurant', 'Restaurant Captain', 'Evening', 26000], ['Accountant', 'accountant', 'Accounts Officer', 'Morning', 42000], ['Maintenance', 'maintenance', 'Maintenance Engineer', 'Evening', 30000]];
    const staffNames = ['Priya Sharma', 'Vikram Singh', 'Sunita Devi', 'Arjun Reddy', 'Neha Kapoor', 'Ramesh Patil', 'Farhan Ali', 'Divya Iyer', 'Manoj Kumar', 'Pooja Desai', 'Sanjay Gupta', 'Lakshmi Rao'];
    let emp = 0, mobileSeq = 9100000000;
    const employeesByHotel = {};
    hotels.forEach((h, hi) => {
      employeesByHotel[h.id] = [];
      staffPlan.forEach(([dept, uname, title, shift, salary], si) => {
        if (hi > 0 && ['Manager', 'Accountant'].includes(dept) && hi > 2) return;          // smaller teams in some hotels
        const un = hi === 0 ? uname : `${uname}${hi + 1}`, name = staffNames[(hi * 3 + si) % staffNames.length] + (hi > 0 ? '' : '');
        const uid = mkUser(un, name, `${un}@innovastay.com`, String(++mobileSeq), 'staff', h.id, 'Staff@123');
        const r = db.run('INSERT INTO employees (hotel_id,user_id,staff_code,name,department,designation,mobile,email,salary,shift,performance,joined_on) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          h.id, uid, 'EMP' + String(++emp).padStart(4, '0'), name, dept, title, String(mobileSeq), `${un}@innovastay.com`, salary, shift, int(3, 5), B.addDays(today, -int(120, 900)));
        employeesByHotel[h.id].push({ id: Number(r.lastInsertRowid), user_id: uid, department: dept });
      });
      // a few more employees without logins
      [['Housekeeping', 'Room Attendant'], ['Housekeeping', 'Room Attendant'], ['Receptionist', 'Night Receptionist'], ['Restaurant', 'Chef'], ['Maintenance', 'Electrician']].forEach(([dept, title]) => {
        const name = pick(['Ajay', 'Rekha', 'Salim', 'Geeta', 'Tarun', 'Kavita', 'Naveen', 'Seema']) + ' ' + pick(['Yadav', 'Joshi', 'Thomas', 'Mishra', 'Khan', 'Pillai']);
        const r = db.run('INSERT INTO employees (hotel_id,staff_code,name,department,designation,mobile,salary,shift,performance,joined_on) VALUES (?,?,?,?,?,?,?,?,?,?)',
          h.id, 'EMP' + String(++emp).padStart(4, '0'), name, dept, title, String(++mobileSeq), int(15000, 24000), pick(['Morning', 'Evening', 'Night']), int(3, 5), B.addDays(today, -int(60, 700)));
        employeesByHotel[h.id].push({ id: Number(r.lastInsertRowid), user_id: null, department: dept });
      });
    });

    // customers + guest profiles
    const first = ['Aarav', 'Vivaan', 'Aditya', 'Ishaan', 'Diya', 'Ananya', 'Saanvi', 'Riya', 'Kabir', 'Myra', 'Arnav', 'Navya', 'Rahul', 'Sneha', 'Amit', 'Kriti', 'Siddharth', 'Tanvi', 'Harsh', 'Pallavi', 'Yash', 'Ishita', 'Nikhil', 'Shreya'];
    const last = ['Sharma', 'Verma', 'Gupta', 'Iyer', 'Nair', 'Reddy', 'Patel', 'Mehta', 'Singh', 'Khan', 'Das', 'Joshi', 'Kulkarni', 'Banerjee'];
    const guests = []; const tierPts = [0, 0, 150, 400, 1200, 2400, 5200];
    const makeGuest = (username, name, email, mobile) => {
      const uid = mkUser(username, name, email, mobile, 'customer', null, 'Customer@123');
      const pts = pick(tierPts), g = db.run(`INSERT INTO guests (user_id,full_name,mobile,email,gender,dob,address,emergency_name,emergency_phone,loyalty_points,membership,referral_code) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        uid, name, mobile, email, pick(['Male', 'Female']), `${int(1970, 2002)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`, `${int(1, 99)}, ${pick(['MG Road', 'Park Street', 'Lake Road', 'Station Road'])}`,
        pick(first) + ' ' + pick(last), String(9200000000 + int(1, 99999999)), pts, B.tierFor(pts), 'INV' + S.randomCode(5));
      const gid = Number(g.lastInsertRowid);
      if (rnd() < 0.7) db.run('INSERT INTO guest_documents (guest_id,doc_type,doc_number,verified) VALUES (?,?,?,?)', gid, pick(['Aadhaar', 'Passport', 'Driving License']), String(int(100000000000, 999999999999)), 1);
      guests.push({ id: gid, user_id: uid, name });
      return gid;
    };
    const demoGuest = makeGuest('customer', 'Shweta Gupta', 'customer@innovastay.com', '9000000003');
    db.run("UPDATE guests SET loyalty_points=1350, membership='Silver', dob=? WHERE id=?", `1998-${today.slice(5, 7)}-15`, demoGuest);   // birthday month = this month so BDAY20 works
    for (let i = 1; i <= 28; i++) { const nm = first[(i - 1) % first.length] + ' ' + last[(i * 3) % last.length]; makeGuest('cust' + i, nm, `cust${i}@mail.com`, String(9300000000 + i * 7919)); }
    db.run('UPDATE guests SET is_blacklisted=1, blacklist_reason=? WHERE id=?', 'Damaged hotel property', guests[guests.length - 1].id);

    // ---------- bookings with full lifecycle ----------
    const hotelRooms = {}; hotels.forEach((h) => (hotelRooms[h.id] = db.all('SELECT * FROM rooms WHERE hotel_id=?', h.id)));
    const menuByHotel = {}; hotels.forEach((h) => (menuByHotel[h.id] = db.all('SELECT * FROM food_menu WHERE hotel_id=?', h.id)));
    const svcByHotel = {}; hotels.forEach((h) => (svcByHotel[h.id] = db.all('SELECT * FROM services WHERE hotel_id=? AND price>0', h.id)));
    const comments = ['Spotless room and very friendly staff.', 'Great location and excellent breakfast.', 'Loved the stay – will come back!', 'Room service was quick. Comfortable beds.', 'Good value for money.',
      'Check-in was smooth and the view was fantastic.', 'Pool and spa were wonderful.', 'Clean, quiet and well managed.', 'Average food but the staff made up for it.'];
    const complaints = ['AC was not cooling properly in the first night.', 'Hot water supply was irregular.', 'Room service order was delayed by 40 minutes.', 'Noise from the corridor late at night.'];
    const receptionUser = {}; hotels.forEach((h) => (receptionUser[h.id] = employeesByHotel[h.id].find((e) => e.department === 'Receptionist').user_id));

    function makeRes(h, room, gid, ci, co, status, o = {}) {
      const nights = B.nightsBetween(ci, co), p = B.priceStay(room.price, ci, co, 0.5);
      const discount = o.discount || 0;
      let ref; do { ref = B.bookingRef(); } while (db.get('SELECT 1 x FROM reservations WHERE booking_ref=?', ref));
      const created = B.addDays(ci, -int(1, 20)) + ' ' + pick(['09:15:00', '11:40:00', '16:25:00', '20:05:00']);
      const adults = Math.min(room.capacity, int(1, 3));
      const rid = Number(db.run(`INSERT INTO reservations (booking_ref,hotel_id,guest_id,room_id,check_in,check_out,adults,children,status,booking_type,room_total,discount,coupon,qr_token,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ref, h.id, gid, room.id, ci, co, adults, adults < room.capacity && rnd() < 0.3 ? 1 : 0, status, o.type || (rnd() < 0.2 ? 'Walk-in' : 'Online'), p.total, discount, o.coupon || null, S.randomCode(12), created).lastInsertRowid);
      if (rnd() < 0.15 && adults > 1) db.run('INSERT INTO reservation_guests (reservation_id,name,age) VALUES (?,?,?)', rid, pick(first) + ' ' + pick(last), int(5, 60));
      if (!['Checked-out', 'Checked-in'].includes(status)) {
        if (status === 'Confirmed' && rnd() < 0.7) db.run('INSERT INTO payments (hotel_id,reservation_id,amount,method,type,reference,paid_at) VALUES (?,?,?,?,?,?,?)', h.id, rid, B.round2(p.total * 0.3), pick(['UPI', 'Card']), 'Advance', 'ADV' + S.randomCode(6), created);
        if (status === 'Confirmed') B.syncInvoice(rid);
        return rid;
      }
      db.run('INSERT INTO check_in_out (hotel_id,reservation_id,room_id,checkin_time,checkout_time,handled_by) VALUES (?,?,?,?,?,?)', h.id, rid, room.id, ci + ' 14:' + String(int(0, 59)).padStart(2, '0') + ':00', status === 'Checked-out' ? co + ' 11:' + String(int(0, 59)).padStart(2, '0') + ':00' : null, receptionUser[h.id]);
      // food + services during the stay
      const orders = o.orders ?? int(0, 3);
      for (let k = 0; k < orders; k++) {
        const items = Array.from({ length: int(1, 3) }, () => pick(menuByHotel[h.id])), total = items.reduce((s, m) => s + m.price, 0);
        const day = B.addDays(ci, int(0, Math.max(0, nights - 1))), fo = Number(db.run('INSERT INTO food_orders (hotel_id,reservation_id,room_id,order_type,status,total,created_at) VALUES (?,?,?,?,?,?,?)', h.id, rid, room.id, 'Room Service', status === 'Checked-in' && k === orders - 1 && o.pendingOrder ? 'Preparing' : 'Delivered', total, day + ' ' + pick(['08:30:00', '13:15:00', '20:40:00'])).lastInsertRowid);
        items.forEach((m) => db.run('INSERT INTO food_order_items (order_id,menu_id,qty,price) VALUES (?,?,1,?)', fo, m.id, m.price));
      }
      for (let k = 0; k < int(0, 2); k++) { const s = pick(svcByHotel[h.id]); db.run('INSERT INTO service_requests (hotel_id,service_id,reservation_id,guest_id,quantity,amount,status,created_at) VALUES (?,?,?,?,1,?,?,?)', h.id, s.id, rid, gid, s.price, 'Completed', ci + ' 17:00:00'); }
      const bill = B.computeBill(rid);
      if (status === 'Checked-out') {
        const adv = B.round2(bill.total * 0.3);
        db.run('INSERT INTO payments (hotel_id,reservation_id,amount,method,type,reference,paid_at) VALUES (?,?,?,?,?,?,?)', h.id, rid, adv, pick(['UPI', 'Card']), 'Advance', 'ADV' + S.randomCode(6), created);
        db.run('INSERT INTO payments (hotel_id,reservation_id,amount,method,type,reference,paid_at) VALUES (?,?,?,?,?,?,?)', h.id, rid, B.round2(bill.total - adv), pick(['Cash', 'Card', 'UPI']), 'Final', 'FIN' + S.randomCode(6), co + ' 11:30:00');
        B.syncInvoice(rid); db.run('UPDATE invoices SET created_at=? WHERE reservation_id=?', co + ' 11:30:00', rid);
        if (rnd() < 0.5 || o.review) {
          const bad = rnd() < 0.12 && !o.review;
          db.run('INSERT INTO feedback (hotel_id,guest_id,reservation_id,kind,room_rating,food_rating,staff_rating,hotel_rating,comment,status,admin_response,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            h.id, gid, rid, bad ? 'Complaint' : 'Feedback', bad ? int(2, 3) : int(4, 5), int(3, 5), bad ? 3 : int(4, 5), bad ? 3 : int(4, 5), bad ? pick(complaints) : pick(comments), bad ? pick(['Open', 'In Progress', 'Resolved']) : 'Resolved',
            bad && rnd() < 0.5 ? 'Thank you for letting us know. We have taken corrective action.' : null, co + ' 18:00:00');
        }
      } else {
        db.run('INSERT INTO payments (hotel_id,reservation_id,amount,method,type,reference,paid_at) VALUES (?,?,?,?,?,?,?)', h.id, rid, B.round2(bill.total * 0.3), pick(['UPI', 'Card', 'Cash']), 'Advance', 'ADV' + S.randomCode(6), created);
        B.syncInvoice(rid); db.run("UPDATE rooms SET status='Occupied' WHERE id=?", room.id);
      }
      return rid;
    }

    hotels.forEach((h) => {
      const rooms = hotelRooms[h.id], target = h.id === 1 ? 60 : 46;
      for (let tries = 0, made = 0; made < target && tries < 600; tries++) {
        const room = pick(rooms), ci = B.addDays(today, int(-175, 16)), co = B.addDays(ci, int(1, 5));
        if (!B.roomIsFree(room.id, ci, co)) continue;
        const gid = pick(guests.slice(1, -1)).id;     // never the demo guest / blacklisted guest
        let status;
        if (co <= today) status = rnd() < 0.08 ? 'Cancelled' : rnd() < 0.04 ? 'No-show' : 'Checked-out';
        else if (ci <= today) status = 'Checked-in';
        else status = rnd() < 0.07 ? 'Cancelled' : 'Confirmed';
        if (status === 'Checked-in' && db.get("SELECT COUNT(*) c FROM reservations WHERE hotel_id=? AND status='Checked-in'", h.id).c >= 6) continue;
        makeRes(h, room, gid, ci, co, status, { pendingOrder: rnd() < 0.5 });
        made++;
      }
    });

    // --- scripted data for the demo customer (Hotel 1) so every screen has content ---
    const h1 = hotels[0], r1 = hotelRooms[h1.id];
    const freeRoom = (hotel, type, ci, co) => hotelRooms[hotel.id].find((r) => r.type_id === typeId[type] && B.roomIsFree(r.id, ci, co));
    const demoStays = [[h1, 'Deluxe', -80, -77, 'Checked-out', { review: true, orders: 2 }], [hotels[4], 'Suite', -35, -32, 'Checked-out', { review: false, orders: 1 }],
      [h1, 'Double', -1, 2, 'Checked-in', { orders: 1, pendingOrder: true }], [hotels[2], 'Deluxe', 12, 15, 'Confirmed', {}], [hotels[3], 'Family', 30, 33, 'Confirmed', {}]];
    demoStays.forEach(([h, type, o1, o2, status, opt]) => { const ci = B.addDays(today, o1), co = B.addDays(today, o2), room = freeRoom(h, type, ci, co); if (room) makeRes(h, room, demoGuest, ci, co, status, { ...opt, type: 'Online' }); });
    db.run("INSERT INTO guest_documents (guest_id,doc_type,doc_number,verified) VALUES (?, 'Aadhaar', '482910553726', 1)", demoGuest);
    // a waiting-list request and a today-arrival for the front desk
    const w = hotelRooms[h1.id].find((r) => r.type_id === typeId.Suite && !B.roomIsFree(r.id, B.addDays(today, 1), B.addDays(today, 2)));
    const arrivalRoom = freeRoom(h1, 'Single', today, B.addDays(today, 2));
    if (arrivalRoom) makeRes(h1, arrivalRoom, guests[3].id, today, B.addDays(today, 2), 'Confirmed', { type: 'Online' });
    if (w) { const busy = db.get("SELECT * FROM reservations WHERE room_id=? AND status IN ('Confirmed','Checked-in') AND check_out>? ORDER BY check_in LIMIT 1", w.id, today); if (busy) makeRes(h1, w, guests[5].id, busy.check_in, busy.check_out, 'Waiting', {}); }
    // refresh hotel ratings from reviews
    hotels.forEach((h) => { const r = db.get('SELECT AVG(hotel_rating) a FROM feedback WHERE hotel_id=? AND hotel_rating IS NOT NULL', h.id).a; if (r) db.run('UPDATE hotels SET rating=? WHERE id=?', Math.round(r * 10) / 10, h.id); });

    // ---------- operations data: housekeeping, maintenance, attendance, leave, tasks ----------
    hotels.forEach((h) => {
      const emps = employeesByHotel[h.id], hk = emps.filter((e) => e.department === 'Housekeeping'), mt = emps.filter((e) => e.department === 'Maintenance'), rooms = hotelRooms[h.id];
      for (let i = 0; i < 8; i++) { const done = i > 3; db.run('INSERT INTO housekeeping (hotel_id,room_id,assigned_to,task,status,scheduled_at,notes,inspection_ok,created_at) VALUES (?,?,?,?,?,?,?,?,?)', h.id, pick(rooms).id, pick(hk).id, pick(['Cleaning', 'Cleaning', 'Linen', 'Towels', 'Inspection', 'Supplies']),
        done ? 'Done' : pick(['Pending', 'In Progress']), B.addDays(today, -int(0, 3)) + ' 10:00', pick(['Standard turnover', 'Guest request', 'Deep clean', 'Replace linen']), done ? 1 : 0, B.addDays(today, -int(0, 4)) + ' 09:00:00'); }
      const issues = [['Electrical', 'Bedside lamp not working'], ['Plumbing', 'Slow drain in bathroom'], ['AC', 'AC not cooling'], ['Furniture', 'Wardrobe door hinge broken'], ['Electrical', 'TV remote and HDMI port faulty'], ['AC', 'Quarterly AC servicing (preventive)']];
      issues.forEach(([cat, desc], i) => { const st = ['Open', 'Assigned', 'In Progress', 'Resolved', 'Resolved', 'Open'][i]; db.run('INSERT INTO maintenance (hotel_id,room_id,category,description,priority,status,assigned_to,cost,preventive,scheduled_date,created_at,resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        h.id, pick(rooms).id, cat, desc, pick(['Low', 'Medium', 'High', 'Urgent']), st, st === 'Open' ? null : pick(mt).id, st === 'Resolved' ? int(300, 4500) : 0, i === 5 ? 1 : 0, i === 5 ? B.addDays(today, 7) : null, B.addDays(today, -int(1, 40)) + ' 12:00:00', st === 'Resolved' ? B.addDays(today, -int(0, 5)) + ' 16:00:00' : null); });
      emps.forEach((e) => {
        for (let d = 13; d >= 0; d--) { const date = B.addDays(today, -d); const st = rnd() < 0.9 ? 'Present' : pick(['Absent', 'Leave', 'Half-day']); db.run('INSERT OR IGNORE INTO attendance (hotel_id,employee_id,work_date,status,check_in,check_out) VALUES (?,?,?,?,?,?)', h.id, e.id, date, st, st === 'Absent' || st === 'Leave' ? null : '09:0' + int(0, 9), st === 'Absent' || st === 'Leave' || d === 0 ? null : '18:' + String(int(0, 40)).padStart(2, '0')); }
        if (rnd() < 0.3) db.run('INSERT INTO leave_requests (hotel_id,employee_id,from_date,to_date,reason,status) VALUES (?,?,?,?,?,?)', h.id, e.id, B.addDays(today, int(3, 20)), B.addDays(today, int(21, 24)), pick(['Family function', 'Medical appointment', 'Personal work', 'Vacation']), pick(['Pending', 'Approved', 'Rejected']));
        if (e.user_id && rnd() < 0.8) db.run('INSERT INTO staff_tasks (hotel_id,employee_id,title,details,due_date,status) VALUES (?,?,?,?,?,?)', h.id, e.id, pick(['Update daily checklist', 'Inventory count', 'Guest feedback follow-up', 'Safety drill preparation', 'Training session']), 'Assigned by manager', B.addDays(today, int(0, 6)), pick(['Pending', 'In Progress', 'Done']));
      });
      // one room being cleaned and one under maintenance (visible on the floor view)
      db.run("UPDATE rooms SET status='Cleaning' WHERE id=? AND status='Available'", rooms[2].id); db.run("UPDATE rooms SET status='Maintenance' WHERE id=? AND status='Available'", rooms[rooms.length - 1].id);
    });

    // ---------- notifications ----------
    const notes = [['Booking confirmed', 'Your upcoming stay is confirmed. We look forward to hosting you!', 'Booking'], ['Special offer', 'Use code FESTIVE15 for 15% off on bookings above ₹8,000.', 'Offer'], ['Complete your profile', 'Add your ID proof to speed up check-in.', 'Info']];
    db.all("SELECT id, hotel_id, role FROM users WHERE role IN ('customer','admin','staff')").forEach((u) => {
      if (u.role === 'customer') notes.forEach((n) => db.run('INSERT INTO notifications (user_id,title,message,type,is_read) VALUES (?,?,?,?,?)', u.id, n[0], n[1], n[2], rnd() < 0.4 ? 1 : 0));
      else db.run('INSERT INTO notifications (user_id,hotel_id,title,message,type,is_read) VALUES (?,?,?,?,?,0)', u.id, u.hotel_id, 'Welcome to InnovaStay', 'Your workspace is ready. Check your dashboard for today\'s activity.', 'Info');
    });
  });
}
module.exports = { seed };
