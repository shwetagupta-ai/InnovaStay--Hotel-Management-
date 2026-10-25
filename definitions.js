'use strict';
/**
 * Declarative description of every manageable module (table).
 * The generic engine in resources.js turns each entry into a secured CRUD API, and the same
 * metadata drives the dashboard tables/forms in the browser, so permissions live in ONE place.
 *
 * Access tokens: 'platform_admin' | 'admin' | 'staff:<Department>' ('Manager' is implicitly allowed everywhere staff are).
 * Field types: str int num date bool email mobile | ['enum','values'] | { t:'int', ref:'rooms' } (ref must belong to the same hotel)
 */
const db = require('../config/db');
const { HttpError } = require('../utils/http');
const S = require('../utils/security');
const B = require('../utils/business');
const BK = require('../utils/booking');

const H = ['admin', 'platform_admin'];                      // hotel owner + platform
const REC = 'staff:Receptionist', HK = 'staff:Housekeeping', RES = 'staff:Restaurant', ACC = 'staff:Accountant', MNT = 'staff:Maintenance';
const roomOpt = { lookup: 'rooms' };
const badge = (k, label) => ({ k, label, type: 'badge' });

const defs = {
  // ---------- Platform ----------
  hotels: {
    table: 'hotels', title: 'Hotels', icon: 'hotel', hotel: false, read: ['platform_admin'], write: ['platform_admin'],
    search: ['t.name', 't.city'], filters: { status: 't.status', city: 't.city' },
    select: `t.*, (SELECT COUNT(*) FROM rooms WHERE hotel_id=t.id) AS rooms`,
    fields: { name: 'str', city: 'str', state: 'str', address: 'str', stars: 'int', description: 'str', phone: 'mobile', email: 'email', status: ['Active', 'Inactive'] },
    required: ['name', 'city'],
    columns: [{ k: 'name', label: 'Hotel' }, { k: 'city', label: 'City' }, { k: 'stars', label: 'Stars', type: 'stars' }, { k: 'rooms', label: 'Rooms' }, { k: 'rating', label: 'Rating' }, badge('status', 'Status')],
    form: [{ name: 'name', label: 'Hotel name' }, { name: 'city', label: 'City' }, { name: 'state', label: 'State' }, { name: 'address', label: 'Address' },
      { name: 'stars', label: 'Stars (1-5)', type: 'number' }, { name: 'phone', label: 'Phone' }, { name: 'email', label: 'Email' },
      { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'] }, { name: 'description', label: 'Description', type: 'textarea' }],
  },
  my_hotel: {
    table: 'hotels', title: 'Hotel Profile', icon: 'hotel', hotel: false, scopeSql: (u) => ['t.id = ?', [u.hotel_id]], read: ['admin'], write: ['admin'], noCreate: true, noDelete: true,
    fields: { address: 'str', description: 'str', phone: 'mobile', email: 'email' },
    columns: [{ k: 'name', label: 'Hotel' }, { k: 'city', label: 'City' }, { k: 'phone', label: 'Phone' }, { k: 'email', label: 'Email' }, { k: 'rating', label: 'Rating' }],
    form: [{ name: 'address', label: 'Address' }, { name: 'phone', label: 'Phone' }, { name: 'email', label: 'Email' }, { name: 'description', label: 'Description', type: 'textarea' }],
  },
  hotel_admins: {
    table: 'users', title: 'Hotel Admins', icon: 'shield', hotel: false, read: ['platform_admin'], write: ['platform_admin'], noDelete: true,
    baseWhere: "t.role='admin'", select: 't.id,t.username,t.full_name,t.email,t.mobile,t.status,t.last_login,t.hotel_id,h.name AS hotel_name', joins: 'LEFT JOIN hotels h ON h.id=t.hotel_id',
    search: ['t.username', 't.full_name', 't.email'], filters: { status: 't.status' },
    fields: { status: ['Active', 'Suspended'] }, virtual: ['username', 'full_name', 'email', 'mobile', 'password', 'hotel_id'],
    columns: [{ k: 'full_name', label: 'Name' }, { k: 'username', label: 'Username' }, { k: 'hotel_name', label: 'Hotel' }, { k: 'email', label: 'Email' }, { k: 'mobile', label: 'Mobile' }, badge('status', 'Status'), { k: 'last_login', label: 'Last login' }],
    form: [{ name: 'full_name', label: 'Full name', onlyCreate: true }, { name: 'username', label: 'Username', onlyCreate: true }, { name: 'email', label: 'Email', onlyCreate: true },
      { name: 'mobile', label: 'Mobile', onlyCreate: true }, { name: 'hotel_id', label: 'Hotel', type: 'select', lookup: 'hotels', onlyCreate: true }, { name: 'password', label: 'Temporary password', type: 'password', onlyCreate: true },
      { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Suspended'], onlyEdit: true }],
    async customCreate(b) {
      const err = S.passwordPolicy(b.password); if (err) throw new HttpError(400, err);
      if (!db.get('SELECT 1 x FROM hotels WHERE id=?', parseInt(b.hotel_id, 10))) throw new HttpError(400, 'Select a hotel.');
      return newUser(b, 'admin', parseInt(b.hotel_id, 10));
    },
    after(op, id, u, data) { if (op === 'update' && data.status === 'Suspended') db.run('UPDATE users SET token_version=token_version+1 WHERE id=?', id); },
  },
  users: {
    table: 'users', title: 'All Users', icon: 'users', hotel: false, read: ['platform_admin'], write: ['platform_admin'], noCreate: true, noDelete: true,
    select: 't.id,t.username,t.full_name,t.email,t.mobile,t.role,t.status,t.last_login,h.name AS hotel_name', joins: 'LEFT JOIN hotels h ON h.id=t.hotel_id',
    search: ['t.username', 't.full_name', 't.email', 't.mobile'], filters: { role: 't.role', status: 't.status' },
    fields: { status: ['Active', 'Suspended'] },
    columns: [{ k: 'full_name', label: 'Name' }, { k: 'username', label: 'Username' }, badge('role', 'Role'), { k: 'hotel_name', label: 'Hotel' }, { k: 'email', label: 'Email' }, badge('status', 'Status'), { k: 'last_login', label: 'Last login' }],
    form: [{ name: 'status', label: 'Status', type: 'select', options: ['Active', 'Suspended'] }],
    filtersUi: [{ name: 'role', label: 'Role', options: ['customer', 'staff', 'admin', 'platform_admin'] }],
    rowActions: [{ label: 'Reset password', post: '/api/ops/users/{id}/reset-password', confirm: 'Generate a new temporary password for this user?' }],
    after(op, id, u, data) { if (data.status === 'Suspended') db.run('UPDATE users SET token_version=token_version+1 WHERE id=?', id); },
  },
  room_types: {
    table: 'room_types', title: 'Room Types', icon: 'bed', hotel: false, read: ['platform_admin', 'admin', 'staff:*'], write: ['platform_admin'],
    fields: { name: 'str', description: 'str', base_price: 'num', max_guests: 'int' }, required: ['name', 'base_price'],
    columns: [{ k: 'name', label: 'Type' }, { k: 'description', label: 'Description' }, { k: 'base_price', label: 'Base price', type: 'money' }, { k: 'max_guests', label: 'Max guests' }],
    form: [{ name: 'name', label: 'Name' }, { name: 'base_price', label: 'Base price (₹)', type: 'number' }, { name: 'max_guests', label: 'Max guests', type: 'number' }, { name: 'description', label: 'Description', type: 'textarea' }],
  },
  login_history: {
    table: 'login_history', title: 'Login History', icon: 'clock', hotel: false, read: ['platform_admin', 'admin'], noCreate: true, noUpdate: true, noDelete: true,
    scopeSql: (u) => u.role === 'admin' ? ['t.user_id IN (SELECT id FROM users WHERE hotel_id=?)', [u.hotel_id]] : null,
    select: 't.*, u.full_name', joins: 'LEFT JOIN users u ON u.id=t.user_id', search: ['t.identifier', 'u.full_name', 't.ip'], filters: { success: 't.success', portal: 't.portal' },
    columns: [{ k: 'created_at', label: 'When' }, { k: 'identifier', label: 'Login' }, { k: 'full_name', label: 'User' }, { k: 'portal', label: 'Portal' }, { k: 'ip', label: 'IP' }, { k: 'success', label: 'Success', type: 'bool' }],
  },

  // ---------- Rooms ----------
  rooms: {
    table: 'rooms', title: 'Rooms', icon: 'bed', hotel: true, read: [...H, REC, HK, MNT], write: ['admin'],
    select: `t.*, rt.name AS type_name, CASE WHEN t.status='Available' AND EXISTS(SELECT 1 FROM reservations r WHERE r.room_id=t.id AND r.status='Confirmed'
             AND date('now')>=r.check_in AND date('now')<r.check_out) THEN 'Reserved' ELSE t.status END AS live_status`,
    joins: 'LEFT JOIN room_types rt ON rt.id=t.type_id', search: ['t.room_no', 'rt.name'], filters: { status: 't.status', type: 't.type_id', floor: 't.floor' }, order: 'CAST(t.floor AS INT), t.room_no',
    fields: { room_no: 'str', floor: 'int', type_id: { t: 'int', ref: 'room_types' }, price: 'num', capacity: 'int', status: ['Available', 'Reserved', 'Occupied', 'Cleaning', 'Maintenance', 'Out of Service'], description: 'str' },
    required: ['room_no', 'type_id', 'price'],
    columns: [{ k: 'room_no', label: 'Room' }, { k: 'floor', label: 'Floor' }, { k: 'type_name', label: 'Type' }, { k: 'price', label: 'Price / night', type: 'money' }, { k: 'capacity', label: 'Sleeps' }, badge('live_status', 'Status')],
    form: [{ name: 'room_no', label: 'Room number' }, { name: 'floor', label: 'Floor', type: 'number' }, { name: 'type_id', label: 'Room type', type: 'select', lookup: 'room_types' },
      { name: 'price', label: 'Price per night (₹)', type: 'number' }, { name: 'capacity', label: 'Capacity', type: 'number' },
      { name: 'status', label: 'Status', type: 'select', options: ['Available', 'Cleaning', 'Maintenance', 'Out of Service', 'Occupied'] }, { name: 'description', label: 'Description', type: 'textarea' }],
    filtersUi: [{ name: 'status', label: 'Status', options: ['Available', 'Occupied', 'Cleaning', 'Maintenance', 'Out of Service'] }],
  },
  room_amenities: {
    table: 'room_amenities', title: 'Room Amenities', icon: 'star', hotel: false, read: [...H, REC, HK], write: ['admin'],
    scopeSql: (u) => u.role === 'platform_admin' ? null : ['t.room_id IN (SELECT id FROM rooms WHERE hotel_id=?)', [u.hotel_id]],
    select: 't.*, r.room_no', joins: 'LEFT JOIN rooms r ON r.id=t.room_id', search: ['t.amenity', 'r.room_no'],
    fields: { room_id: { t: 'int', ref: 'rooms' }, amenity: 'str' }, required: ['room_id', 'amenity'],
    columns: [{ k: 'room_no', label: 'Room' }, { k: 'amenity', label: 'Amenity' }],
    form: [{ name: 'room_id', label: 'Room', type: 'select', lookup: 'rooms' }, { name: 'amenity', label: 'Amenity (e.g. WiFi, AC, Pool view)' }],
  },

  // ---------- Guests ----------
  guests: {
    table: 'guests', title: 'Guests', icon: 'users', hotel: false, read: [...H, REC], write: ['admin', REC],
    scopeSql: (u) => u.role === 'platform_admin' ? null : ['(t.created_hotel_id = ? OR t.id IN (SELECT guest_id FROM reservations WHERE hotel_id = ?))', [u.hotel_id, u.hotel_id]],
    select: `t.*, (SELECT COUNT(*) FROM reservations r WHERE r.guest_id=t.id AND r.status='Checked-out') AS stays`,
    search: ['t.full_name', 't.mobile', 't.email'], filters: { membership: 't.membership', blocked: 't.is_blacklisted' },
    fields: { full_name: 'str', mobile: 'mobile', email: 'email', gender: ['Male', 'Female', 'Other'], dob: 'date', address: 'str', emergency_name: 'str', emergency_phone: 'mobile',
      preferences: 'str', is_blacklisted: 'bool', blacklist_reason: 'str' }, required: ['full_name', 'mobile'],
    columns: [{ k: 'full_name', label: 'Guest' }, { k: 'mobile', label: 'Mobile' }, { k: 'email', label: 'Email' }, badge('membership', 'Tier'), { k: 'loyalty_points', label: 'Points' },
      { k: 'stays', label: 'Stays' }, { k: 'is_blacklisted', label: 'Blocked', type: 'bool' }],
    form: [{ name: 'full_name', label: 'Full name' }, { name: 'mobile', label: 'Mobile' }, { name: 'email', label: 'Email' }, { name: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female', 'Other'] },
      { name: 'dob', label: 'Date of birth', type: 'date' }, { name: 'address', label: 'Address' }, { name: 'emergency_name', label: 'Emergency contact' }, { name: 'emergency_phone', label: 'Emergency phone' },
      { name: 'preferences', label: 'Preferences (pillow, floor, diet…)' }, { name: 'is_blacklisted', label: 'Blocked / blacklisted', type: 'checkbox' }, { name: 'blacklist_reason', label: 'Reason' }],
    filtersUi: [{ name: 'membership', label: 'Tier', options: ['Bronze', 'Silver', 'Gold'] }],
    before(op, d, u) {
      if (op === 'create') d.created_hotel_id = u.hotel_id;
      if (u.role === 'staff' && u.department !== 'Manager') { delete d.is_blacklisted; delete d.blacklist_reason; }
    },
  },
  guest_documents: {
    table: 'guest_documents', title: 'ID Proof Verification', icon: 'id', hotel: false, read: [...H, REC], write: ['admin', REC],
    scopeSql: (u) => u.role === 'platform_admin' ? null : ['t.guest_id IN (SELECT id FROM guests WHERE created_hotel_id=? OR id IN (SELECT guest_id FROM reservations WHERE hotel_id=?))', [u.hotel_id, u.hotel_id]],
    select: 't.*, g.full_name', joins: 'LEFT JOIN guests g ON g.id=t.guest_id', search: ['g.full_name', 't.doc_number'], filters: { verified: 't.verified', type: 't.doc_type' },
    fields: { guest_id: { t: 'int', ref: 'guests' }, doc_type: ['Aadhaar', 'Passport', 'Driving License', 'Voter ID', 'Other'], doc_number: 'str', verified: 'bool', notes: 'str' }, required: ['guest_id', 'doc_type', 'doc_number'],
    columns: [{ k: 'full_name', label: 'Guest' }, { k: 'doc_type', label: 'Document' }, { k: 'doc_number', label: 'Number' }, { k: 'verified', label: 'Verified', type: 'bool' }, { k: 'notes', label: 'Notes' }],
    form: [{ name: 'guest_id', label: 'Guest', type: 'select', lookup: 'guests' }, { name: 'doc_type', label: 'Document type', type: 'select', options: ['Aadhaar', 'Passport', 'Driving License', 'Voter ID', 'Other'] },
      { name: 'doc_number', label: 'Document number' }, { name: 'verified', label: 'Verified at desk', type: 'checkbox' }, { name: 'notes', label: 'Notes' }],
    mask: { doc_number: (v) => (v && v.length > 4 ? '•'.repeat(v.length - 4) + v.slice(-4) : v) },     // ID numbers are masked in lists
  },

  // ---------- Reservations ----------
  reservations: {
    table: 'reservations', title: 'Reservations', icon: 'calendar', hotel: true, read: [...H, REC, ACC], write: ['admin', REC], noCreate: true, noDelete: true,
    select: 't.*, g.full_name AS guest, g.mobile AS guest_mobile, rm.room_no, rt.name AS room_type', joins: 'JOIN guests g ON g.id=t.guest_id JOIN rooms rm ON rm.id=t.room_id JOIN room_types rt ON rt.id=rm.type_id',
    search: ['t.booking_ref', 'g.full_name', 'g.mobile', 'rm.room_no'], filters: { status: 't.status', type: 't.booking_type', date: 't.check_in' }, order: 't.id DESC',
    fields: { status: ['Pending', 'Confirmed', 'No-show'], notes: 'str', room_pref: 'str' },
    columns: [{ k: 'booking_ref', label: 'Booking' }, { k: 'guest', label: 'Guest' }, { k: 'room_no', label: 'Room' }, { k: 'check_in', label: 'Check-in', type: 'date' }, { k: 'check_out', label: 'Check-out', type: 'date' },
      { k: 'room_total', label: 'Room total', type: 'money' }, badge('booking_type', 'Type'), badge('status', 'Status')],
    form: [{ name: 'status', label: 'Status', type: 'select', options: ['Pending', 'Confirmed', 'No-show'] }, { name: 'room_pref', label: 'Room preference' }, { name: 'notes', label: 'Notes', type: 'textarea' }],
    filtersUi: [{ name: 'status', label: 'Status', options: ['Confirmed', 'Pending', 'Checked-in', 'Checked-out', 'Cancelled', 'No-show', 'Waiting'] }],
    after(op, id, u, d) { if (d.status === 'No-show') { const r = db.get('SELECT * FROM reservations WHERE id=?', id); BK.promoteWaitlist(r.room_id); } },
  },
  check_in_out: {
    table: 'check_in_out', title: 'Check-in / Check-out Log', icon: 'clock', hotel: true, read: [...H, REC], noCreate: true, noUpdate: true, noDelete: true,
    select: 't.*, r.booking_ref, g.full_name AS guest, rm.room_no, u.full_name AS handled', joins: 'JOIN reservations r ON r.id=t.reservation_id JOIN guests g ON g.id=r.guest_id JOIN rooms rm ON rm.id=t.room_id LEFT JOIN users u ON u.id=t.handled_by',
    search: ['r.booking_ref', 'g.full_name', 'rm.room_no'],
    columns: [{ k: 'booking_ref', label: 'Booking' }, { k: 'guest', label: 'Guest' }, { k: 'room_no', label: 'Room' }, { k: 'checkin_time', label: 'Checked in' }, { k: 'checkout_time', label: 'Checked out' }, { k: 'handled', label: 'Handled by' }],
  },

  // ---------- Billing ----------
  payments: {
    table: 'payments', title: 'Payments', icon: 'card', hotel: true, read: [...H, REC, ACC], write: ['admin', REC, ACC], noUpdate: true, noDelete: true,
    select: 't.*, r.booking_ref, g.full_name AS guest', joins: 'JOIN reservations r ON r.id=t.reservation_id JOIN guests g ON g.id=r.guest_id',
    search: ['r.booking_ref', 'g.full_name', 't.reference'], filters: { method: 't.method', type: 't.type' },
    fields: { reservation_id: { t: 'int', ref: 'reservations' }, amount: 'num', method: ['Cash', 'Card', 'UPI'], type: ['Advance', 'Partial', 'Final', 'Refund'], reference: 'str' }, required: ['reservation_id', 'amount'],
    columns: [{ k: 'paid_at', label: 'Date' }, { k: 'booking_ref', label: 'Booking' }, { k: 'guest', label: 'Guest' }, { k: 'amount', label: 'Amount', type: 'money' }, badge('method', 'Method'), badge('type', 'Type'), { k: 'reference', label: 'Reference' }],
    form: [{ name: 'reservation_id', label: 'Booking', type: 'select', lookup: 'reservations' }, { name: 'amount', label: 'Amount (₹)', type: 'number' }, { name: 'method', label: 'Method', type: 'select', options: ['Cash', 'Card', 'UPI'] },
      { name: 'type', label: 'Type', type: 'select', options: ['Advance', 'Partial', 'Final', 'Refund'] }, { name: 'reference', label: 'Reference / txn id' }],
    before(op, d, u) {
      if (d.type === 'Refund') { const paid = B.computeBill(d.reservation_id).paid; if (d.amount > paid + 0.01) throw new HttpError(400, `Refund cannot exceed the amount paid (₹${paid}).`); }
      if (d.amount <= 0) throw new HttpError(400, 'Amount must be greater than zero.');
      d.method = d.method || 'Cash'; d.type = d.type || 'Partial';
    },
    after(op, id, u, d) {
      const r = db.get('SELECT r.*, g.user_id FROM reservations r JOIN guests g ON g.id=r.guest_id WHERE r.id=?', d.reservation_id);
      B.syncInvoice(r.id);
      B.notify(r.user_id, r.hotel_id, d.type === 'Refund' ? 'Refund processed' : 'Payment received', `₹${d.amount} ${d.type === 'Refund' ? 'refunded' : 'received'} for ${r.booking_ref}.`, 'Payment');
    },
  },
  invoices: {
    table: 'invoices', title: 'Invoices', icon: 'file', hotel: true, read: [...H, REC, ACC], noCreate: true, noUpdate: true, noDelete: true,
    select: 't.*, r.booking_ref, g.full_name AS guest', joins: 'JOIN reservations r ON r.id=t.reservation_id JOIN guests g ON g.id=r.guest_id',
    search: ['t.invoice_no', 'r.booking_ref', 'g.full_name'], filters: { status: 't.status' },
    columns: [{ k: 'invoice_no', label: 'Invoice' }, { k: 'booking_ref', label: 'Booking' }, { k: 'guest', label: 'Guest' }, { k: 'total', label: 'Total', type: 'money' }, { k: 'paid', label: 'Paid', type: 'money' }, badge('status', 'Status'), { k: 'created_at', label: 'Date', type: 'date' }],
    filtersUi: [{ name: 'status', label: 'Status', options: ['Unpaid', 'Partial', 'Paid', 'Refunded'] }],
    rowActions: [{ label: 'Print / PDF', href: '/invoice.html?id={reservation_id}' }],
  },

  // ---------- Restaurant ----------
  food_menu: {
    table: 'food_menu', title: 'Restaurant Menu', icon: 'food', hotel: true, read: [...H, RES, REC], write: ['admin', RES],
    search: ['t.name', 't.category'], filters: { category: 't.category', available: 't.available' }, order: 't.category, t.name',
    fields: { name: 'str', category: ['Starters', 'Main Course', 'Breads', 'Rice', 'Desserts', 'Beverages', 'Breakfast'], price: 'num', available: 'bool', description: 'str' }, required: ['name', 'price'],
    columns: [{ k: 'name', label: 'Dish' }, badge('category', 'Category'), { k: 'price', label: 'Price', type: 'money' }, { k: 'available', label: 'Available', type: 'bool' }, { k: 'description', label: 'Description' }],
    form: [{ name: 'name', label: 'Dish name' }, { name: 'category', label: 'Category', type: 'select', options: ['Starters', 'Main Course', 'Breads', 'Rice', 'Desserts', 'Beverages', 'Breakfast'] },
      { name: 'price', label: 'Price (₹)', type: 'number' }, { name: 'available', label: 'Available today', type: 'checkbox' }, { name: 'description', label: 'Description' }],
    defaults: { available: 1 },
  },
  food_orders: {
    table: 'food_orders', title: 'Food Orders', icon: 'food', hotel: true, read: [...H, RES, REC], write: ['admin', RES, REC], noCreate: true,
    select: `t.*, rm.room_no, (SELECT group_concat(m.name || ' ×' || i.qty, ', ') FROM food_order_items i JOIN food_menu m ON m.id=i.menu_id WHERE i.order_id=t.id) AS items`,
    joins: 'LEFT JOIN rooms rm ON rm.id=t.room_id', search: ['rm.room_no', 't.table_no', 't.special_request'], filters: { status: 't.status', type: 't.order_type' },
    fields: { status: ['Placed', 'Preparing', 'Ready', 'Delivered', 'Cancelled'], special_request: 'str' },
    columns: [{ k: 'id', label: '#' }, { k: 'created_at', label: 'Time' }, { k: 'order_type', label: 'Type' }, { k: 'room_no', label: 'Room' }, { k: 'table_no', label: 'Table' }, { k: 'items', label: 'Items' }, { k: 'total', label: 'Total', type: 'money' }, badge('status', 'Status')],
    form: [{ name: 'status', label: 'Status', type: 'select', options: ['Placed', 'Preparing', 'Ready', 'Delivered', 'Cancelled'] }, { name: 'special_request', label: 'Special request' }],
    flow: { field: 'status', next: { Placed: 'Preparing', Preparing: 'Ready', Ready: 'Delivered' } },
    filtersUi: [{ name: 'status', label: 'Status', options: ['Placed', 'Preparing', 'Ready', 'Delivered', 'Cancelled'] }],
    after(op, id, u, d) {
      if (!d.status) return;
      const o = db.get('SELECT o.*, g.user_id FROM food_orders o LEFT JOIN reservations r ON r.id=o.reservation_id LEFT JOIN guests g ON g.id=r.guest_id WHERE o.id=?', id);
      if (o && o.user_id && ['Preparing', 'Ready', 'Delivered'].includes(d.status)) B.notify(o.user_id, o.hotel_id, 'Food order update', `Your order #${id} is ${d.status.toLowerCase()}.`, 'Food');
    },
  },

  // ---------- Staff ----------
  employees: {
    table: 'employees', title: 'Employees', icon: 'users', hotel: true, read: ['admin', 'platform_admin', 'staff:Manager'], write: ['admin', 'staff:Manager'],
    select: 't.*, u.username', joins: 'LEFT JOIN users u ON u.id=t.user_id', search: ['t.name', 't.staff_code', 't.department'], filters: { department: 't.department', status: 't.status' },
    fields: { name: 'str', department: ['Receptionist', 'Manager', 'Housekeeping', 'Restaurant', 'Accountant', 'Maintenance'], designation: 'str', mobile: 'mobile', email: 'email', salary: 'num', shift: ['Morning', 'Evening', 'Night'], performance: 'int', joined_on: 'date', status: ['Active', 'Inactive'] },
    required: ['name', 'department'], virtual: ['username', 'password'],
    columns: [{ k: 'staff_code', label: 'ID' }, { k: 'name', label: 'Name' }, badge('department', 'Department'), { k: 'designation', label: 'Role' }, { k: 'shift', label: 'Shift' }, { k: 'salary', label: 'Salary', type: 'money' }, { k: 'performance', label: 'Rating', type: 'stars' }, badge('status', 'Status')],
    form: [{ name: 'name', label: 'Full name' }, { name: 'department', label: 'Department', type: 'select', options: ['Receptionist', 'Manager', 'Housekeeping', 'Restaurant', 'Accountant', 'Maintenance'] },
      { name: 'designation', label: 'Designation' }, { name: 'mobile', label: 'Mobile' }, { name: 'email', label: 'Email' }, { name: 'salary', label: 'Monthly salary (₹)', type: 'number' },
      { name: 'shift', label: 'Shift', type: 'select', options: ['Morning', 'Evening', 'Night'] }, { name: 'performance', label: 'Performance (1-5)', type: 'number' }, { name: 'joined_on', label: 'Joining date', type: 'date' },
      { name: 'username', label: 'Login username', onlyCreate: true }, { name: 'password', label: 'Temporary password', type: 'password', onlyCreate: true }, { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], onlyEdit: true }],
    filtersUi: [{ name: 'department', label: 'Department', options: ['Receptionist', 'Manager', 'Housekeeping', 'Restaurant', 'Accountant', 'Maintenance'] }],
    async customCreate(b, u) {
      const err = S.passwordPolicy(b.password); if (err) throw new HttpError(400, err);
      if (!b.email || !b.mobile) throw new HttpError(400, 'Email and mobile are required to create a login.');
      const uid = await newUser({ ...b, full_name: b.name }, 'staff', u.hotel_id);
      const code = 'EMP' + String(uid).padStart(4, '0');
      const r = db.run('INSERT INTO employees (hotel_id,user_id,staff_code,name,department,designation,mobile,email,salary,shift,performance,joined_on) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        u.hotel_id, uid, code, b.name, b.department, b.designation || null, b.mobile, b.email, b.salary || 0, b.shift || 'Morning', b.performance || 3, b.joined_on || B.today());
      return Number(r.lastInsertRowid);
    },
    after(op, id, u, d) {
      if (op !== 'update') return;
      const e = db.get('SELECT * FROM employees WHERE id=?', id);
      if (e.user_id) { db.run('UPDATE users SET full_name=?, status=? WHERE id=?', e.name, e.status === 'Active' ? 'Active' : 'Suspended', e.user_id);
        if (e.status !== 'Active') db.run('UPDATE users SET token_version=token_version+1 WHERE id=?', e.user_id); }
    },
  },
  attendance: {
    table: 'attendance', title: 'Attendance', icon: 'clock', hotel: true, read: ['admin', 'staff:*'], write: ['admin', 'staff:Manager'], own: { col: 'employee_id' },
    select: 't.*, e.name, e.department', joins: 'JOIN employees e ON e.id=t.employee_id', search: ['e.name'], filters: { status: 't.status', date: 't.work_date' }, order: 't.work_date DESC, e.name',
    fields: { employee_id: { t: 'int', ref: 'employees' }, work_date: 'date', status: ['Present', 'Absent', 'Half-day', 'Leave'], check_in: 'str', check_out: 'str' }, required: ['employee_id', 'work_date'],
    columns: [{ k: 'work_date', label: 'Date', type: 'date' }, { k: 'name', label: 'Employee' }, { k: 'department', label: 'Dept' }, badge('status', 'Status'), { k: 'check_in', label: 'In' }, { k: 'check_out', label: 'Out' }],
    form: [{ name: 'employee_id', label: 'Employee', type: 'select', lookup: 'employees' }, { name: 'work_date', label: 'Date', type: 'date' }, { name: 'status', label: 'Status', type: 'select', options: ['Present', 'Absent', 'Half-day', 'Leave'] }, { name: 'check_in', label: 'Check-in time (HH:MM)' }, { name: 'check_out', label: 'Check-out time (HH:MM)' }],
    punch: true,
  },
  leave_requests: {
    table: 'leave_requests', title: 'Leave Requests', icon: 'calendar', hotel: true, read: ['admin', 'staff:*'], write: ['admin', 'staff:Manager'], own: { col: 'employee_id', create: true },
    select: 't.*, e.name, e.department', joins: 'JOIN employees e ON e.id=t.employee_id', search: ['e.name', 't.reason'], filters: { status: 't.status' },
    fields: { employee_id: { t: 'int', ref: 'employees' }, from_date: 'date', to_date: 'date', reason: 'str', status: ['Pending', 'Approved', 'Rejected'] }, required: ['from_date', 'to_date'],
    columns: [{ k: 'name', label: 'Employee' }, { k: 'from_date', label: 'From', type: 'date' }, { k: 'to_date', label: 'To', type: 'date' }, { k: 'reason', label: 'Reason' }, badge('status', 'Status')],
    form: [{ name: 'employee_id', label: 'Employee', type: 'select', lookup: 'employees', managerOnly: true }, { name: 'from_date', label: 'From', type: 'date' }, { name: 'to_date', label: 'To', type: 'date' }, { name: 'reason', label: 'Reason', type: 'textarea' },
      { name: 'status', label: 'Decision', type: 'select', options: ['Pending', 'Approved', 'Rejected'], managerOnly: true, onlyEdit: true }],
    flow: { field: 'status', approve: { Pending: ['Approved', 'Rejected'] } },
    before(op, d) { if (d.from_date && d.to_date && d.to_date < d.from_date) throw new HttpError(400, 'End date is before the start date.'); },
  },
  staff_tasks: {
    table: 'staff_tasks', title: 'Staff Tasks', icon: 'check', hotel: true, read: ['admin', 'staff:*'], write: ['admin', 'staff:Manager'], own: { col: 'employee_id', update: ['status'] },
    select: 't.*, e.name', joins: 'JOIN employees e ON e.id=t.employee_id', search: ['t.title', 'e.name'], filters: { status: 't.status' },
    fields: { employee_id: { t: 'int', ref: 'employees' }, title: 'str', details: 'str', due_date: 'date', status: ['Pending', 'In Progress', 'Done'] }, required: ['employee_id', 'title'],
    columns: [{ k: 'title', label: 'Task' }, { k: 'name', label: 'Assigned to' }, { k: 'due_date', label: 'Due', type: 'date' }, badge('status', 'Status'), { k: 'details', label: 'Details' }],
    form: [{ name: 'employee_id', label: 'Assign to', type: 'select', lookup: 'employees' }, { name: 'title', label: 'Task' }, { name: 'details', label: 'Details', type: 'textarea' }, { name: 'due_date', label: 'Due date', type: 'date' }, { name: 'status', label: 'Status', type: 'select', options: ['Pending', 'In Progress', 'Done'] }],
    flow: { field: 'status', next: { Pending: 'In Progress', 'In Progress': 'Done' } },
    after(op, id, u, d) { if (op === 'create') { const t = db.get('SELECT t.*, e.user_id FROM staff_tasks t JOIN employees e ON e.id=t.employee_id WHERE t.id=?', id); B.notify(t.user_id, t.hotel_id, 'New task assigned', t.title, 'Task'); } },
  },

  // ---------- Housekeeping / maintenance ----------
  housekeeping: {
    table: 'housekeeping', title: 'Housekeeping', icon: 'broom', hotel: true, read: [...H, HK, REC], write: ['admin', HK, REC], own: { col: 'assigned_to', depts: ['Housekeeping'], update: ['status', 'notes', 'inspection_ok'] },
    select: 't.*, rm.room_no, e.name AS assignee', joins: 'JOIN rooms rm ON rm.id=t.room_id LEFT JOIN employees e ON e.id=t.assigned_to', search: ['rm.room_no', 'e.name', 't.notes'], filters: { status: 't.status', task: 't.task' }, order: "CASE t.status WHEN 'Done' THEN 1 ELSE 0 END, t.id DESC",
    fields: { room_id: { t: 'int', ref: 'rooms' }, assigned_to: { t: 'int', ref: 'employees' }, task: ['Cleaning', 'Inspection', 'Linen', 'Towels', 'Supplies', 'Lost & Found', 'Request'], status: ['Pending', 'In Progress', 'Done'], scheduled_at: 'str', notes: 'str', inspection_ok: 'bool' }, required: ['room_id'],
    columns: [{ k: 'room_no', label: 'Room' }, badge('task', 'Task'), { k: 'assignee', label: 'Assigned to' }, { k: 'scheduled_at', label: 'Scheduled' }, badge('status', 'Status'), { k: 'inspection_ok', label: 'Inspected', type: 'bool' }, { k: 'notes', label: 'Notes' }],
    form: [{ name: 'room_id', label: 'Room', type: 'select', lookup: 'rooms' }, { name: 'task', label: 'Task', type: 'select', options: ['Cleaning', 'Inspection', 'Linen', 'Towels', 'Supplies', 'Lost & Found', 'Request'] },
      { name: 'assigned_to', label: 'Assign to', type: 'select', lookup: 'employees:Housekeeping', allowEmpty: true }, { name: 'scheduled_at', label: 'Scheduled (date/time)' }, { name: 'status', label: 'Status', type: 'select', options: ['Pending', 'In Progress', 'Done'] },
      { name: 'inspection_ok', label: 'Inspection passed', type: 'checkbox' }, { name: 'notes', label: 'Notes', type: 'textarea' }],
    flow: { field: 'status', next: { Pending: 'In Progress', 'In Progress': 'Done' } },
    filtersUi: [{ name: 'status', label: 'Status', options: ['Pending', 'In Progress', 'Done'] }],
    after(op, id, u, d) {
      const t = db.get('SELECT * FROM housekeeping WHERE id=?', id);
      if (d.status === 'Done' && t.task === 'Cleaning') {
        db.run("UPDATE rooms SET status='Available' WHERE id=? AND status='Cleaning'", t.room_id);
        const rm = db.get('SELECT room_no FROM rooms WHERE id=?', t.room_id);
        B.notifyHotel(t.hotel_id, ['Receptionist'], 'Room ready', `Room ${rm.room_no} is cleaned and ready.`, 'Room');
      }
      if (op === 'create' && t.assigned_to) { const e = db.get('SELECT user_id FROM employees WHERE id=?', t.assigned_to); B.notify(e.user_id, t.hotel_id, 'Housekeeping task', `${t.task} – Room ${db.get('SELECT room_no FROM rooms WHERE id=?', t.room_id).room_no}`, 'Task'); }
    },
  },
  maintenance: {
    table: 'maintenance', title: 'Maintenance Tickets', icon: 'wrench', hotel: true, read: [...H, MNT, HK, REC], write: ['admin', MNT], createOnly: [HK, REC],
    select: 't.*, rm.room_no, e.name AS technician', joins: 'LEFT JOIN rooms rm ON rm.id=t.room_id LEFT JOIN employees e ON e.id=t.assigned_to', search: ['rm.room_no', 't.description', 'e.name'], filters: { status: 't.status', priority: 't.priority', category: 't.category' },
    order: "CASE t.status WHEN 'Resolved' THEN 1 ELSE 0 END, CASE t.priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, t.id DESC",
    fields: { room_id: { t: 'int', ref: 'rooms' }, category: ['Electrical', 'Plumbing', 'AC', 'Furniture', 'Other'], description: 'str', priority: ['Low', 'Medium', 'High', 'Urgent'], status: ['Open', 'Assigned', 'In Progress', 'Resolved'],
      assigned_to: { t: 'int', ref: 'employees' }, cost: 'num', blocks_room: 'bool', preventive: 'bool', scheduled_date: 'date' }, required: ['description'],
    columns: [{ k: 'id', label: '#' }, { k: 'room_no', label: 'Room' }, badge('category', 'Category'), { k: 'description', label: 'Issue' }, badge('priority', 'Priority'), badge('status', 'Status'), { k: 'technician', label: 'Technician' }, { k: 'cost', label: 'Cost', type: 'money' }],
    form: [{ name: 'room_id', label: 'Room', type: 'select', lookup: 'rooms', allowEmpty: true }, { name: 'category', label: 'Category', type: 'select', options: ['Electrical', 'Plumbing', 'AC', 'Furniture', 'Other'] }, { name: 'description', label: 'Describe the problem', type: 'textarea' },
      { name: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Medium', 'High', 'Urgent'] }, { name: 'blocks_room', label: 'Block the room until fixed', type: 'checkbox' }, { name: 'preventive', label: 'Preventive maintenance', type: 'checkbox' },
      { name: 'scheduled_date', label: 'Scheduled date', type: 'date' }, { name: 'assigned_to', label: 'Technician', type: 'select', lookup: 'employees:Maintenance', allowEmpty: true, onlyEdit: true },
      { name: 'status', label: 'Status', type: 'select', options: ['Open', 'Assigned', 'In Progress', 'Resolved'], onlyEdit: true }, { name: 'cost', label: 'Repair cost (₹)', type: 'number', onlyEdit: true }],
    flow: { field: 'status', next: { Open: 'In Progress', Assigned: 'In Progress', 'In Progress': 'Resolved' } },
    filtersUi: [{ name: 'status', label: 'Status', options: ['Open', 'Assigned', 'In Progress', 'Resolved'] }, { name: 'priority', label: 'Priority', options: ['Urgent', 'High', 'Medium', 'Low'] }],
    before(op, d, u, ex) { if (d.status === 'Resolved') d.resolved_at = new Date().toISOString().slice(0, 19).replace('T', ' '); if (d.assigned_to && !d.status && (!ex || ex.status === 'Open')) d.status = 'Assigned'; },
    after(op, id, u, d) {
      const m = db.get('SELECT * FROM maintenance WHERE id=?', id);
      if (op === 'create' && m.blocks_room && m.room_id) db.run("UPDATE rooms SET status='Maintenance' WHERE id=? AND status<>'Occupied'", m.room_id);
      if (m.status === 'Resolved' && m.blocks_room && m.room_id) { db.run("UPDATE rooms SET status='Available' WHERE id=? AND status='Maintenance'", m.room_id); B.notifyHotel(m.hotel_id, ['Receptionist'], 'Room back in service', 'Maintenance resolved – room available again.', 'Room'); }
      if (op === 'create' && m.priority === 'Urgent') B.notifyHotel(m.hotel_id, ['Maintenance', 'admin'], 'Urgent maintenance', m.description.slice(0, 100), 'Maintenance');
      if (d.assigned_to) { const e = db.get('SELECT user_id FROM employees WHERE id=?', d.assigned_to); if (e) B.notify(e.user_id, m.hotel_id, 'Ticket assigned', m.description.slice(0, 100), 'Task'); }
    },
  },

  // ---------- Services, feedback, offers ----------
  services: {
    table: 'services', title: 'Hotel Services', icon: 'spa', hotel: true, read: [...H, REC], write: ['admin'],
    search: ['t.name', 't.category'], filters: { category: 't.category' },
    fields: { name: 'str', category: ['Airport Pickup/Drop', 'Taxi/Cab', 'Laundry', 'Spa', 'Gym', 'Swimming Pool', 'Room Decoration', 'Extra Bed', 'Baby Cot', 'Wake-up Call', 'Tourist Guide', 'Event/Banquet', 'Other'], price: 'num', available: 'bool' }, required: ['name', 'price'],
    columns: [{ k: 'name', label: 'Service' }, badge('category', 'Category'), { k: 'price', label: 'Price', type: 'money' }, { k: 'available', label: 'Available', type: 'bool' }],
    form: [{ name: 'name', label: 'Service name' }, { name: 'category', label: 'Category', type: 'select', options: ['Airport Pickup/Drop', 'Taxi/Cab', 'Laundry', 'Spa', 'Gym', 'Swimming Pool', 'Room Decoration', 'Extra Bed', 'Baby Cot', 'Wake-up Call', 'Tourist Guide', 'Event/Banquet', 'Other'] },
      { name: 'price', label: 'Price (₹)', type: 'number' }, { name: 'available', label: 'Available', type: 'checkbox' }], defaults: { available: 1 },
  },
  service_requests: {
    table: 'service_requests', title: 'Service Requests', icon: 'spa', hotel: true, read: [...H, REC], write: ['admin', REC],
    select: 't.*, s.name AS service, g.full_name AS guest, r.booking_ref', joins: 'JOIN services s ON s.id=t.service_id LEFT JOIN guests g ON g.id=t.guest_id LEFT JOIN reservations r ON r.id=t.reservation_id', search: ['s.name', 'g.full_name', 'r.booking_ref'], filters: { status: 't.status' },
    fields: { service_id: { t: 'int', ref: 'services' }, reservation_id: { t: 'int', ref: 'reservations' }, quantity: 'int', status: ['Requested', 'Confirmed', 'Completed', 'Cancelled'], requested_for: 'str', notes: 'str' }, required: ['service_id', 'reservation_id'],
    columns: [{ k: 'created_at', label: 'Requested' }, { k: 'guest', label: 'Guest' }, { k: 'booking_ref', label: 'Booking' }, { k: 'service', label: 'Service' }, { k: 'quantity', label: 'Qty' }, { k: 'amount', label: 'Amount', type: 'money' }, badge('status', 'Status')],
    form: [{ name: 'reservation_id', label: 'Booking', type: 'select', lookup: 'reservations', onlyCreate: true }, { name: 'service_id', label: 'Service', type: 'select', lookup: 'services', onlyCreate: true }, { name: 'quantity', label: 'Quantity', type: 'number' },
      { name: 'requested_for', label: 'When (date/time)' }, { name: 'status', label: 'Status', type: 'select', options: ['Requested', 'Confirmed', 'Completed', 'Cancelled'], onlyEdit: true }, { name: 'notes', label: 'Notes' }],
    flow: { field: 'status', next: { Requested: 'Confirmed', Confirmed: 'Completed' } },
    before(op, d) {
      if (op === 'create') {
        const r = db.get('SELECT guest_id FROM reservations WHERE id=?', d.reservation_id), s = db.get('SELECT price FROM services WHERE id=?', d.service_id);
        d.guest_id = r.guest_id; d.quantity = Math.max(1, d.quantity || 1); d.amount = B.round2(s.price * d.quantity);
      }
    },
  },
  feedback: {
    table: 'feedback', title: 'Feedback & Complaints', icon: 'chat', hotel: true, read: [...H, REC], write: ['admin', 'staff:Manager'], noCreate: true, noDelete: true,
    select: 't.*, g.full_name AS guest', joins: 'LEFT JOIN guests g ON g.id=t.guest_id', search: ['g.full_name', 't.comment'], filters: { kind: 't.kind', status: 't.status' },
    fields: { status: ['Open', 'In Progress', 'Resolved'], admin_response: 'str' },
    columns: [{ k: 'created_at', label: 'Date', type: 'date' }, { k: 'guest', label: 'Guest' }, badge('kind', 'Type'), { k: 'hotel_rating', label: 'Hotel', type: 'stars' }, { k: 'room_rating', label: 'Room', type: 'stars' }, { k: 'food_rating', label: 'Food', type: 'stars' }, { k: 'staff_rating', label: 'Staff', type: 'stars' }, { k: 'comment', label: 'Comment' }, badge('status', 'Status')],
    form: [{ name: 'status', label: 'Status', type: 'select', options: ['Open', 'In Progress', 'Resolved'] }, { name: 'admin_response', label: 'Response to guest', type: 'textarea' }],
    filtersUi: [{ name: 'kind', label: 'Type', options: ['Feedback', 'Complaint'] }, { name: 'status', label: 'Status', options: ['Open', 'In Progress', 'Resolved'] }],
    after(op, id, u, d) { const f = db.get('SELECT f.*, g.user_id FROM feedback f LEFT JOIN guests g ON g.id=f.guest_id WHERE f.id=?', id); if (f && f.user_id && (d.admin_response || d.status)) B.notify(f.user_id, f.hotel_id, 'Update on your feedback', d.admin_response || `Status: ${d.status}`, 'Complaint'); },
  },
  offers: {
    table: 'offers', title: 'Offers & Coupons', icon: 'tag', hotel: true, hotelNullable: true, read: [...H, REC], write: ['admin', 'platform_admin'],
    scopeSql: (u) => u.role === 'platform_admin' ? null : ['(t.hotel_id = ? OR t.hotel_id IS NULL)', [u.hotel_id]], writeScope: (u) => u.role === 'platform_admin' ? null : ['t.hotel_id = ?', [u.hotel_id]],
    select: 't.*, h.name AS hotel_name', joins: 'LEFT JOIN hotels h ON h.id=t.hotel_id', search: ['t.title', 't.code'], filters: { kind: 't.kind', active: 't.active' },
    fields: { title: 'str', code: 'str', kind: ['Coupon', 'Seasonal', 'Birthday', 'Referral', 'Loyalty'], discount_type: ['percent', 'flat'], value: 'num', min_amount: 'num', valid_from: 'date', valid_to: 'date', active: 'bool' }, required: ['title', 'code', 'value'],
    columns: [{ k: 'title', label: 'Offer' }, { k: 'code', label: 'Code' }, badge('kind', 'Kind'), { k: 'value', label: 'Value' }, { k: 'discount_type', label: 'Type' }, { k: 'valid_to', label: 'Valid till', type: 'date' }, { k: 'hotel_name', label: 'Scope' }, { k: 'active', label: 'Active', type: 'bool' }],
    form: [{ name: 'title', label: 'Title' }, { name: 'code', label: 'Coupon code' }, { name: 'kind', label: 'Kind', type: 'select', options: ['Coupon', 'Seasonal', 'Birthday', 'Referral', 'Loyalty'] }, { name: 'discount_type', label: 'Discount type', type: 'select', options: ['percent', 'flat'] },
      { name: 'value', label: 'Value (% or ₹)', type: 'number' }, { name: 'min_amount', label: 'Minimum booking (₹)', type: 'number' }, { name: 'valid_from', label: 'Valid from', type: 'date' }, { name: 'valid_to', label: 'Valid to', type: 'date' }, { name: 'active', label: 'Active', type: 'checkbox' },
      { name: 'hotel_id', label: 'Applies to', type: 'select', lookup: 'hotels', allowEmpty: true, emptyLabel: 'All hotels (platform-wide)', platformOnly: true }],
    defaults: { active: 1, discount_type: 'percent' },
    before(op, d) { if (d.code) d.code = d.code.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (d.discount_type === 'percent' && d.value > 90) throw new HttpError(400, 'Percentage discount cannot exceed 90%.'); },
  },
};

/** Create a user row (used for staff and hotel admins). Hashing happens before the DB write so the event loop stays free. */
async function newUser(b, role, hotelId) {
  const username = S.clean(b.username, 30).toLowerCase(), email = S.clean(b.email, 120).toLowerCase(), mobile = S.clean(b.mobile, 16).replace(/[\s-]/g, '');
  if (!/^[a-z0-9_.]{3,30}$/.test(username)) throw new HttpError(400, 'Username: 3-30 letters, numbers, dot or underscore.');
  if (!S.isEmail(email)) throw new HttpError(400, 'Enter a valid email.');
  if (!S.isMobile(mobile)) throw new HttpError(400, 'Enter a valid mobile number.');
  if (db.get('SELECT 1 x FROM users WHERE username=? OR email=? OR mobile=?', username, email, mobile)) throw new HttpError(409, 'Username, email or mobile is already used by another account.');
  const hash = await S.hashPassword(b.password);
  const r = db.run('INSERT INTO users (username,email,mobile,full_name,password_hash,role,hotel_id) VALUES (?,?,?,?,?,?,?)', username, email, mobile, S.clean(b.full_name, 80), hash, role, hotelId);
  return Number(r.lastInsertRowid);
}

module.exports = defs;
