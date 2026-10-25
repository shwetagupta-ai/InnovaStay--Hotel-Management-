'use strict';
/** Dashboard statistics and reports (admin / manager / accountant / platform). */
const db = require('../config/db');
const { router, HttpError } = require('../utils/http');
const S = require('../utils/security');
const B = require('../utils/business');
const { requireAuth, can } = require('../middleware/auth');

const cache = new Map();
const cached = (key, ms, fn) => { const h = cache.get(key); if (h && h.exp > Date.now()) return h.val; const val = fn(); cache.set(key, { val, exp: Date.now() + ms }); return val; };
const NET = "CASE WHEN type='Refund' THEN -amount ELSE amount END";
const months = (n) => { const out = [], d = new Date(); d.setDate(1); for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`); } return out; };
const fill = (rows, keys, field = 'v') => { const m = Object.fromEntries(rows.map((r) => [r.k, r[field]])); return keys.map((k) => ({ label: k, value: m[k] || 0 })); };

function hotelStats(h, finance) {
  const t = B.today(), m12 = months(12), start = m12[0] + '-01';
  const rooms = db.all('SELECT status, COUNT(*) c FROM rooms WHERE hotel_id=? GROUP BY status', h), total = rooms.reduce((s, r) => s + r.c, 0);
  const st = Object.fromEntries(rooms.map((r) => [r.status, r.c]));
  const reservedToday = db.get(`SELECT COUNT(DISTINCT r.room_id) c FROM reservations r JOIN rooms rm ON rm.id=r.room_id WHERE r.hotel_id=? AND r.status='Confirmed' AND ?>=r.check_in AND ?<r.check_out AND rm.status='Available'`, h, t, t).c;
  const cards = {
    total_rooms: total, occupied: st.Occupied || 0, reserved: reservedToday, available: Math.max(0, (st.Available || 0) - reservedToday), cleaning: st.Cleaning || 0, maintenance_rooms: (st.Maintenance || 0) + (st['Out of Service'] || 0),
    checkins_today: db.get("SELECT COUNT(*) c FROM check_in_out WHERE hotel_id=? AND date(checkin_time)=?", h, t).c, checkouts_today: db.get("SELECT COUNT(*) c FROM check_in_out WHERE hotel_id=? AND date(checkout_time)=?", h, t).c,
    arrivals_expected: db.get("SELECT COUNT(*) c FROM reservations WHERE hotel_id=? AND status='Confirmed' AND check_in=?", h, t).c,
    departures_expected: db.get("SELECT COUNT(*) c FROM reservations WHERE hotel_id=? AND status='Checked-in' AND check_out<=?", h, t).c,
    food_orders_today: db.get('SELECT COUNT(*) c FROM food_orders WHERE hotel_id=? AND date(created_at)=?', h, t).c,
    food_orders_pending: db.get("SELECT COUNT(*) c FROM food_orders WHERE hotel_id=? AND status IN ('Placed','Preparing','Ready')", h).c,
    maintenance_open: db.get("SELECT COUNT(*) c FROM maintenance WHERE hotel_id=? AND status<>'Resolved'", h).c,
    housekeeping_pending: db.get("SELECT COUNT(*) c FROM housekeeping WHERE hotel_id=? AND status<>'Done'", h).c,
    open_complaints: db.get("SELECT COUNT(*) c FROM feedback WHERE hotel_id=? AND kind='Complaint' AND status<>'Resolved'", h).c,
    waiting_list: db.get("SELECT COUNT(*) c FROM reservations WHERE hotel_id=? AND status='Waiting'", h).c,
  };
  const days = Array.from({ length: 14 }, (_, i) => B.addDays(t, i - 13));
  const occupancy = days.map((d) => ({ label: d.slice(5), value: Math.round(100 * db.get(`SELECT COUNT(DISTINCT room_id) c FROM reservations WHERE hotel_id=? AND status IN ('Checked-in','Checked-out','Confirmed') AND check_in<=? AND check_out>?`, h, d, d).c / Math.max(1, total)) }));
  const charts = {
    occupancy,
    booking_trends: fill(db.all("SELECT strftime('%Y-%m', created_at) k, COUNT(*) v FROM reservations WHERE hotel_id=? AND created_at>=? GROUP BY k", h, start), m12),
    popular_rooms: db.all(`SELECT rt.name label, COUNT(*) value FROM reservations r JOIN rooms rm ON rm.id=r.room_id JOIN room_types rt ON rt.id=rm.type_id WHERE r.hotel_id=? AND r.status<>'Cancelled' GROUP BY rt.name ORDER BY value DESC`, h),
    customers: { tiers: db.all('SELECT g.membership label, COUNT(*) value FROM guests g WHERE g.created_hotel_id=? OR g.id IN (SELECT guest_id FROM reservations WHERE hotel_id=?) GROUP BY g.membership', h, h),
      new_per_month: fill(db.all("SELECT strftime('%Y-%m', created_at) k, COUNT(*) v FROM guests WHERE (created_hotel_id=? OR id IN (SELECT guest_id FROM reservations WHERE hotel_id=?)) AND created_at>=? GROUP BY k", h, h, start), m12),
      repeat: db.get('SELECT COUNT(*) c FROM (SELECT guest_id FROM reservations WHERE hotel_id=? AND status IN (\'Checked-out\',\'Checked-in\') GROUP BY guest_id HAVING COUNT(*)>1)', h).c },
  };
  if (finance) {
    cards.revenue_today = db.get(`SELECT COALESCE(SUM(${NET}),0) s FROM payments WHERE hotel_id=? AND date(paid_at)=?`, h, t).s;
    cards.revenue_month = db.get(`SELECT COALESCE(SUM(${NET}),0) s FROM payments WHERE hotel_id=? AND strftime('%Y-%m', paid_at)=?`, h, t.slice(0, 7)).s;
    cards.pending_payments = db.get(`SELECT COALESCE(SUM(MAX(0, i.total - i.paid)),0) s FROM invoices i JOIN reservations r ON r.id=i.reservation_id WHERE i.hotel_id=? AND r.status IN ('Checked-in','Checked-out','Confirmed')`, h).s;
    charts.monthly_revenue = fill(db.all(`SELECT strftime('%Y-%m', paid_at) k, SUM(${NET}) v FROM payments WHERE hotel_id=? AND paid_at>=? GROUP BY k`, h, start), m12);
    charts.food_sales = days.map((d) => ({ label: d.slice(5), value: db.get("SELECT COALESCE(SUM(total),0) s FROM food_orders WHERE hotel_id=? AND status<>'Cancelled' AND date(created_at)=?", h, d).s }));
  }
  return { cards, charts, rating: db.get('SELECT rating FROM hotels WHERE id=?', h).rating };
}

router.get('/api/stats/overview', requireAuth('admin', 'platform_admin', 'staff:*'), (ctx) => {
  const u = ctx.user;
  if (u.role === 'platform_admin') {
    return ctx.json({ platform: true, ...cached('platform', 15000, () => {
      const m12 = months(12), start = m12[0] + '-01';
      return {
        cards: { hotels: db.get("SELECT COUNT(*) c FROM hotels WHERE status='Active'").c, rooms: db.get('SELECT COUNT(*) c FROM rooms').c, customers: db.get("SELECT COUNT(*) c FROM users WHERE role='customer'").c,
          staff: db.get("SELECT COUNT(*) c FROM users WHERE role='staff'").c, admins: db.get("SELECT COUNT(*) c FROM users WHERE role='admin'").c, bookings_month: db.get("SELECT COUNT(*) c FROM reservations WHERE strftime('%Y-%m', created_at)=?", B.today().slice(0, 7)).c,
          revenue_month: db.get(`SELECT COALESCE(SUM(${NET}),0) s FROM payments WHERE strftime('%Y-%m', paid_at)=?`, B.today().slice(0, 7)).s, failed_logins_24h: db.get("SELECT COUNT(*) c FROM login_history WHERE success=0 AND created_at>=datetime('now','-1 day')").c },
        charts: { monthly_revenue: fill(db.all(`SELECT strftime('%Y-%m', paid_at) k, SUM(${NET}) v FROM payments WHERE paid_at>=? GROUP BY k`, start), m12),
          booking_trends: fill(db.all("SELECT strftime('%Y-%m', created_at) k, COUNT(*) v FROM reservations WHERE created_at>=? GROUP BY k", start), m12),
          revenue_by_hotel: db.all(`SELECT h.name label, COALESCE(SUM(${NET}),0) value FROM hotels h LEFT JOIN payments p ON p.hotel_id=h.id GROUP BY h.id ORDER BY value DESC`),
          bookings_by_city: db.all("SELECT h.city label, COUNT(*) value FROM reservations r JOIN hotels h ON h.id=r.hotel_id WHERE r.status<>'Cancelled' GROUP BY h.city ORDER BY value DESC"),
          users_by_role: db.all('SELECT role label, COUNT(*) value FROM users GROUP BY role') },
      };
    }) });
  }
  const finance = u.role === 'admin' || can(u, ['staff:Manager', 'staff:Accountant']);
  ctx.json({ platform: false, finance, ...cached(`hotel:${u.hotel_id}:${finance}`, 10000, () => hotelStats(u.hotel_id, finance)) });
});

// ---------- Reports ----------
const REPORTS = {
  revenue: (h, f, t, q) => {
    const fmt = q.group === 'year' ? '%Y' : q.group === 'month' ? '%Y-%m' : '%Y-%m-%d';
    const rows = db.all(`SELECT strftime('${fmt}', paid_at) AS period, SUM(CASE WHEN type<>'Refund' THEN amount ELSE 0 END) collected, SUM(CASE WHEN type='Refund' THEN amount ELSE 0 END) refunds, SUM(${NET}) net, COUNT(*) payments
      FROM payments WHERE hotel_id=? AND date(paid_at) BETWEEN ? AND ? GROUP BY period ORDER BY period`, h, f, t);
    return { columns: [['period', 'Period'], ['collected', 'Collected', 'money'], ['refunds', 'Refunds', 'money'], ['net', 'Net revenue', 'money'], ['payments', 'Payments']], rows, total: { net: rows.reduce((s, r) => s + r.net, 0) } };
  },
  occupancy: (h, f, t) => {
    const total = db.get('SELECT COUNT(*) c FROM rooms WHERE hotel_id=?', h).c || 1, rows = [];
    for (let d = f, n = 0; d <= t && n < 92; d = B.addDays(d, 1), n++) {
      const occ = db.get("SELECT COUNT(DISTINCT room_id) c FROM reservations WHERE hotel_id=? AND status IN ('Checked-in','Checked-out','Confirmed') AND check_in<=? AND check_out>?", h, d, d).c;
      rows.push({ date: d, occupied: occ, total, percent: Math.round(occ * 1000 / total) / 10 });
    }
    return { columns: [['date', 'Date'], ['occupied', 'Rooms occupied'], ['total', 'Total rooms'], ['percent', 'Occupancy %']], rows };
  },
  bookings: (h, f, t) => ({ columns: [['booking_ref', 'Booking'], ['guest', 'Guest'], ['room_no', 'Room'], ['check_in', 'Check-in'], ['check_out', 'Check-out'], ['booking_type', 'Type'], ['status', 'Status'], ['room_total', 'Room total', 'money']],
    rows: db.all(`SELECT r.booking_ref, g.full_name guest, rm.room_no, r.check_in, r.check_out, r.booking_type, r.status, r.room_total FROM reservations r JOIN guests g ON g.id=r.guest_id JOIN rooms rm ON rm.id=r.room_id
      WHERE r.hotel_id=? AND date(r.created_at) BETWEEN ? AND ? ORDER BY r.id DESC`, h, f, t) }),
  cancellations: (h, f, t) => ({ columns: [['booking_ref', 'Booking'], ['guest', 'Guest'], ['check_in', 'Check-in'], ['room_total', 'Booking value', 'money'], ['refunded', 'Refunded', 'money'], ['notes', 'Reason']],
    rows: db.all(`SELECT r.booking_ref, g.full_name guest, r.check_in, r.room_total, r.notes, COALESCE((SELECT SUM(amount) FROM payments WHERE reservation_id=r.id AND type='Refund'),0) refunded
      FROM reservations r JOIN guests g ON g.id=r.guest_id WHERE r.hotel_id=? AND r.status IN ('Cancelled','No-show') AND date(r.created_at) BETWEEN ? AND ? ORDER BY r.id DESC`, h, f, t) }),
  customers: (h) => ({ columns: [['full_name', 'Guest'], ['mobile', 'Mobile'], ['membership', 'Tier'], ['loyalty_points', 'Points'], ['stays', 'Stays'], ['spent', 'Total spent', 'money']],
    rows: db.all(`SELECT g.full_name, g.mobile, g.membership, g.loyalty_points, COUNT(r.id) stays, COALESCE(SUM((SELECT SUM(${NET}) FROM payments WHERE reservation_id=r.id)),0) spent
      FROM guests g JOIN reservations r ON r.guest_id=g.id AND r.hotel_id=? AND r.status<>'Cancelled' GROUP BY g.id ORDER BY spent DESC LIMIT 300`, h) }),
  rooms: (h, f, t) => ({ columns: [['room_no', 'Room'], ['type', 'Type'], ['price', 'Rate', 'money'], ['status', 'Status'], ['nights', 'Nights sold'], ['revenue', 'Room revenue', 'money']],
    rows: db.all(`SELECT rm.room_no, rt.name type, rm.price, rm.status, COALESCE(SUM(MAX(0, julianday(MIN(r.check_out, date(?,'+1 day'))) - julianday(MAX(r.check_in, ?)))),0) nights, COALESCE(SUM(r.room_total - r.discount),0) revenue
      FROM rooms rm JOIN room_types rt ON rt.id=rm.type_id LEFT JOIN reservations r ON r.room_id=rm.id AND r.status IN ('Checked-in','Checked-out') AND r.check_in<=? AND r.check_out>?
      WHERE rm.hotel_id=? GROUP BY rm.id ORDER BY revenue DESC`, t, f, t, f, h) }),
  food: (h, f, t) => ({ columns: [['dish', 'Dish'], ['category', 'Category'], ['qty', 'Qty sold'], ['sales', 'Sales', 'money']],
    rows: db.all(`SELECT m.name dish, m.category, SUM(i.qty) qty, SUM(i.qty*i.price) sales FROM food_order_items i JOIN food_orders o ON o.id=i.order_id JOIN food_menu m ON m.id=i.menu_id
      WHERE o.hotel_id=? AND o.status<>'Cancelled' AND date(o.created_at) BETWEEN ? AND ? GROUP BY m.id ORDER BY sales DESC`, h, f, t) }),
  employees: (h, f, t) => ({ columns: [['staff_code', 'ID'], ['name', 'Name'], ['department', 'Department'], ['shift', 'Shift'], ['salary', 'Salary', 'money'], ['present', 'Days present'], ['performance', 'Rating']],
    rows: db.all(`SELECT e.staff_code, e.name, e.department, e.shift, e.salary, e.performance, (SELECT COUNT(*) FROM attendance a WHERE a.employee_id=e.id AND a.status IN ('Present','Half-day') AND a.work_date BETWEEN ? AND ?) present
      FROM employees e WHERE e.hotel_id=? ORDER BY e.department, e.name`, f, t, h) }),
  payments: (h, f, t) => ({ columns: [['paid_at', 'Date'], ['booking_ref', 'Booking'], ['method', 'Method'], ['type', 'Type'], ['amount', 'Amount', 'money'], ['reference', 'Reference']],
    rows: db.all(`SELECT p.paid_at, r.booking_ref, p.method, p.type, p.amount, p.reference FROM payments p JOIN reservations r ON r.id=p.reservation_id WHERE p.hotel_id=? AND date(p.paid_at) BETWEEN ? AND ? ORDER BY p.id DESC`, h, f, t) }),
  tax: (h, f, t) => ({ columns: [['invoice_no', 'Invoice'], ['created_at', 'Date'], ['taxable', 'Taxable value', 'money'], ['tax', 'GST', 'money'], ['total', 'Invoice total', 'money']],
    rows: db.all(`SELECT invoice_no, date(created_at) created_at, (room_charges + food_charges + service_charges - discount) taxable, tax, total FROM invoices WHERE hotel_id=? AND date(created_at) BETWEEN ? AND ? ORDER BY id DESC`, h, f, t) }),
  maintenance: (h, f, t) => ({ columns: [['created_at', 'Date'], ['room_no', 'Room'], ['category', 'Category'], ['description', 'Issue'], ['status', 'Status'], ['cost', 'Cost', 'money']],
    rows: db.all(`SELECT date(m.created_at) created_at, rm.room_no, m.category, m.description, m.status, m.cost FROM maintenance m LEFT JOIN rooms rm ON rm.id=m.room_id WHERE m.hotel_id=? AND date(m.created_at) BETWEEN ? AND ? ORDER BY m.id DESC`, h, f, t) }),
  profit: (h, f, t) => {
    const ms = []; for (let d = f.slice(0, 7); d <= t.slice(0, 7); ) { ms.push(d); const [y, m] = d.split('-').map(Number); d = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; if (ms.length > 24) break; }
    const payroll = db.get("SELECT COALESCE(SUM(salary),0) s FROM employees WHERE hotel_id=? AND status='Active'", h).s;
    const rows = ms.map((m) => {
      const rev = db.get(`SELECT COALESCE(SUM(${NET}),0) s FROM payments WHERE hotel_id=? AND strftime('%Y-%m', paid_at)=?`, h, m).s;
      const maint = db.get("SELECT COALESCE(SUM(cost),0) s FROM maintenance WHERE hotel_id=? AND strftime('%Y-%m', created_at)=?", h, m).s;
      return { month: m, revenue: rev, maintenance: maint, payroll, profit: B.round2(rev - maint - payroll) };
    });
    return { columns: [['month', 'Month'], ['revenue', 'Net revenue', 'money'], ['maintenance', 'Maintenance cost', 'money'], ['payroll', 'Payroll (monthly)', 'money'], ['profit', 'Profit / loss', 'money']], rows, note: 'Profit = net payments received − maintenance cost − monthly payroll of active staff.' };
  },
};
router.get('/api/reports/:type', requireAuth('admin', 'staff:Accountant'), (ctx) => {
  const fn = REPORTS[ctx.params.type]; if (!fn) throw new HttpError(404, 'Unknown report.');
  const t = S.isDate(ctx.query.to) ? ctx.query.to : B.today(), f = S.isDate(ctx.query.from) ? ctx.query.from : B.addDays(t, -29);
  if (f > t) throw new HttpError(400, 'Start date is after end date.');
  if (ctx.user.department === 'Accountant' && !['revenue', 'payments', 'tax', 'profit', 'cancellations', 'maintenance'].includes(ctx.params.type)) throw new HttpError(403, 'Not available for your role.');
  ctx.json({ type: ctx.params.type, from: f, to: t, ...fn(ctx.user.hotel_id, f, t, ctx.query) });
});
