/* Pages for the Staff, Hotel Admin and Platform Admin portals.
 * - Every table module (rooms, guests, payments ...) is rendered by ONE generic page driven by /api/meta
 * - Custom pages: overview, frontdesk, walkin, floor, neworder, reports */
(function () {
  'use strict';
  var IS = window.IS, el = IS.el;
  IS.pages = IS.pages || {};
  var H = IS.hotel = { meta: null };
  function done(fn) { return function () { var a = arguments; return fn.apply(null, a); }; }

  H.registerPages = function (meta) {
    H.meta = meta;
    Object.keys(meta.resources).forEach(function (k) { IS.pages[k] = resourcePage(k, meta.resources[k]); });
  };
  var isPlatform = function () { return H.meta.user.role === 'platform_admin'; };
  var isStaff = function () { return H.meta.user.role === 'staff'; };

  /* =================================================================== generic table page */
  function resourcePage(key, rm) {
    return {
      title: rm.title,
      render: function (root, ctx) {
        var st = { q: '', page: 1, filters: {}, hotel_id: '' };
        var actions = [];
        if (rm.punch && isStaff()) actions.push(el('button', { class: 'btn btn-outline', onclick: function (e) { IS.busy(e.currentTarget, function () { return IS.post('/api/ops/attendance/punch', {}); }).then(function (r) { IS.toast('Punched ' + r.action + ' at ' + r.time); load(); }, IS.err); } }, IS.icon('clock', 16), 'Punch in / out'));
        if (rm.can.create && rm.form.length) actions.push(el('button', { class: 'btn btn-primary', onclick: function () { openForm(null); } }, IS.icon('plus', 16), 'Add new'));
        root.appendChild(IS.pageHeader(rm.title, null, actions));

        var search = el('input', { class: 'input grow', type: 'search', placeholder: 'Search ' + rm.title.toLowerCase() + '…', 'aria-label': 'Search' });
        search.addEventListener('input', IS.debounce(function () { st.q = search.value.trim(); st.page = 1; load(); }, 300));
        var bar = el('div', { class: 'toolbar' }, search);
        (rm.filtersUi || []).forEach(function (f) {
          var s = el('select', { class: 'select', 'aria-label': f.label }, el('option', { value: '' }, 'All ' + f.label.toLowerCase()), f.options.map(function (o) { return el('option', { value: o }, IS.title(o)); }));
          s.addEventListener('change', function () { st.filters[f.name] = s.value; st.page = 1; load(); }); bar.appendChild(s);
        });
        if (isPlatform() && rm.platformCols) {
          var hs = el('select', { class: 'select', 'aria-label': 'Hotel' }, el('option', { value: '' }, 'All hotels'));
          IS.lookup('hotels').then(function (items) { items.forEach(function (h) { hs.appendChild(el('option', { value: h.id }, h.label)); }); });
          hs.addEventListener('change', function () { st.hotel_id = hs.value; st.page = 1; load(); }); bar.appendChild(hs);
        }
        var host = el('div', { class: 'card', style: { padding: '0' } });
        root.appendChild(bar); root.appendChild(host);

        function cols() {
          var c = rm.columns.map(function (col) { return { key: col.k, label: col.label, align: col.type === 'money' ? 'right' : '', render: function (r) { return IS.cell(col, r); } }; });
          if (isPlatform() && rm.platformCols) c.unshift({ key: '_hotel', label: 'Hotel', render: function (r) { return r._hotel || '-'; } });
          c.push({ key: '_a', label: '', render: rowActions });
          return c;
        }
        function load() {
          IS.clear(host); host.appendChild(el('div', { style: { padding: '18px' } }, IS.loading(5)));
          var p = { q: st.q, page: st.page, limit: 20, hotel_id: st.hotel_id };
          Object.keys(st.filters).forEach(function (k) { p['f_' + k] = st.filters[k]; });
          return IS.get('/api/r/' + key, p).then(function (d) {
            IS.clear(host);
            host.appendChild(IS.table({ columns: cols(), rows: d.rows, empty: 'No records found' }));
            if (d.total > 20) host.appendChild(el('div', { style: { padding: '8px 16px' } }, IS.pager({ total: d.total, limit: 20, offset: (d.page - 1) * 20, onChange: function (off) { st.page = off / 20 + 1; load(); } })));
          }, function (e) { IS.clear(host); host.appendChild(IS.errorBox(e)); });
        }
        function rowActions(r) {
          var box = el('div', { class: 'actions' });
          var fl = rm.flow;
          if (fl && fl.next && fl.next[r[fl.field]]) { var nx = fl.next[r[fl.field]]; box.appendChild(el('button', { class: 'btn btn-soft btn-sm', onclick: function (e) { setField(e, r, fl.field, nx); } }, '→ ' + IS.title(nx))); }
          if (fl && fl.approve && fl.approve[r[fl.field]] && rm.can.manager) fl.approve[r[fl.field]].forEach(function (o, i) { box.appendChild(el('button', { class: 'btn btn-sm ' + (i ? 'btn-outline' : 'btn-success'), onclick: function (e) { setField(e, r, fl.field, o); } }, o === 'Approved' ? 'Approve' : o === 'Rejected' ? 'Reject' : o)); });
          (rm.rowActions || []).forEach(function (a) {
            var fill = function (s) { return s.replace(/\{(\w+)\}/g, function (_, k) { return r[k]; }); };
            if (a.href) box.appendChild(el('a', { class: 'btn btn-outline btn-sm', href: fill(a.href), target: '_blank', rel: 'noopener' }, a.label));
            else box.appendChild(el('button', { class: 'btn btn-outline btn-sm', onclick: function () {
              (a.confirm ? IS.confirm(a.confirm) : Promise.resolve(true)).then(function (ok) { if (!ok) return; IS.post(fill(a.post), {}).then(function (res) { if (res.message) IS.modal({ title: a.label, body: el('p', null, res.message), footer: [] }); else IS.toast('Done'); load(); }, IS.err); }); } }, a.label));
          });
          if (rm.can.update && rm.form.length) box.appendChild(el('button', { class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Edit', title: 'Edit', onclick: function () { openForm(r); } }, IS.icon('edit', 16)));
          if (rm.can.delete) box.appendChild(el('button', { class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Delete', title: 'Delete', onclick: function () { del(r); } }, IS.icon('trash', 16)));
          return box;
        }
        function setField(e, r, field, val) { var b = {}; b[field] = val; IS.busy(e.currentTarget, function () { return IS.put('/api/r/' + key + '/' + r.id, b); }).then(function () { IS.toast('Updated'); load(); ctx.refreshNotifications(); }, IS.err); }
        function del(r) { IS.confirm('Delete this record? This cannot be undone.', { danger: true, confirmLabel: 'Delete' }).then(function (ok) { if (ok) IS.del('/api/r/' + key + '/' + r.id).then(function () { IS.toast('Deleted'); load(); }, IS.err); }); }

        function buildFields(editing) {
          var list = rm.form.filter(function (f) { return !(f.onlyCreate && editing) && !(f.onlyEdit && !editing) && !(f.managerOnly && !rm.can.manager); }).map(function (f) { return Object.assign({}, f); });
          if (!editing && isPlatform() && rm.platformCols) list.unshift({ name: 'hotel_id', label: 'Hotel', type: 'select', lookup: 'hotels', required: true });
          return Promise.all(list.map(function (f) {
            if (f.type === 'select' && f.lookup) {
              var parts = f.lookup.split(':');
              return IS.lookup(f.lookup).then(function (items) { f.options = [{ value: '', label: '— Select —' }].concat(items.map(function (i) { return { value: i.id, label: i.label }; })); });
            }
            if (f.type === 'select' && f.options && !f.required) { /* enum list: keep as is */ }
          })).then(function () { return list; });
        }
        function openForm(row) {
          var editing = !!row;
          Promise.all([buildFields(editing), editing ? IS.get('/api/r/' + key + '/' + row.id).then(function (d) { return d.row; }) : Promise.resolve({})]).then(function (res) {
            var fields = res[0], values = res[1];
            fields.forEach(function (f) { if (f.type === 'date' || f.type === 'number') f.span = f.span; if (f.type === 'textarea') f.span = 2; });
            IS.formModal({ title: (editing ? 'Edit ' : 'Add ') + rm.title.replace(/s$/, ''), fields: fields, values: values, submitLabel: editing ? 'Save changes' : 'Create',
              onSubmit: function (data) {
                if (editing) { fields.forEach(function (f) { if (f.type === 'password') delete data[f.name]; }); return IS.put('/api/r/' + key + '/' + row.id, data); }
                return IS.post('/api/r/' + key, data);
              } }).then(function (ok) { if (ok) { IS.toast(editing ? 'Saved' : 'Created'); load(); } });
          }, IS.err);
        }
        return load();
      }
    };
  }

  /* =================================================================== overview dashboards */
  function chartCard(title, build, span) {
    var host = el('div'), c = el('div', { class: 'card' + (span ? ' span-' + span : '') }, el('h3', { class: 'card-title' }, title), host);
    setTimeout(function () { build(host); }, 0); return c;
  }
  IS.pages.overview = {
    title: 'Overview',
    render: function (root, ctx) {
      return IS.get('/api/stats/overview').then(function (d) {
        var u = H.meta.user, c = d.cards, ch = d.charts;
        root.appendChild(IS.pageHeader('Welcome, ' + u.name.split(' ')[0] + ' 👋', (u.role === 'staff' ? u.department + ' · ' : '') + u.hotel + ' · ' + IS.date(IS.today(), true)));
        if (isStaff()) {
          var pb = el('button', { class: 'btn btn-outline btn-sm', onclick: function (e) { IS.busy(e.currentTarget, function () { return IS.post('/api/ops/attendance/punch', {}); }).then(function (r) { IS.toast('Punched ' + r.action + ' at ' + r.time); }, IS.err); } }, IS.icon('clock', 16), 'Punch in / out');
          root.appendChild(el('div', { class: 'card row between', style: { marginBottom: '16px' } }, el('div', null, el('b', null, 'My attendance'), el('div', { class: 'muted small' }, 'Mark your shift start and end for today.')), pb));
        }
        var cards = [];
        function K(label, key, icon, sub, money) { if (c[key] === undefined) return; cards.push(money ? IS.kpi(label, IS.money(c[key]), sub, icon) : IS.kpi(label, c[key], sub, icon)); }
        if (d.platform) {
          K('Hotels', 'hotels', 'hotel'); K('Rooms', 'rooms', 'bed'); K('Customers', 'customers', 'users'); K('Staff', 'staff', 'user'); K('Hotel admins', 'admins', 'shield');
          K('Bookings this month', 'bookings_month', 'calendar'); K('Revenue this month', 'revenue_month', 'wallet', null, true); K('Failed logins (24h)', 'failed_logins_24h', 'alert', 'Security watch');
        } else {
          K('Total rooms', 'total_rooms', 'bed'); K('Available', 'available', 'check'); K('Occupied', 'occupied', 'users'); K('Reserved today', 'reserved', 'calendar');
          K('Check-ins today', 'checkins_today', 'arrowright', c.arrivals_expected + ' expected'); K('Check-outs today', 'checkouts_today', 'arrowleft', c.departures_expected + ' due');
          K('Revenue today', 'revenue_today', 'wallet', null, true); K('Revenue this month', 'revenue_month', 'chart', null, true); K('Pending payments', 'pending_payments', 'receipt', null, true);
          K('Food orders today', 'food_orders_today', 'food', c.food_orders_pending + ' in progress'); K('Open maintenance', 'maintenance_open', 'tool'); K('Housekeeping pending', 'housekeeping_pending', 'sparkle');
          K('Open complaints', 'open_complaints', 'chat'); K('Waiting list', 'waiting_list', 'clock'); K('Cleaning', 'cleaning', 'refresh'); K('Rooms out of order', 'maintenance_rooms', 'alert');
        }
        root.appendChild(el('div', { class: 'grid grid-4 stagger' }, cards));
        var g = el('div', { class: 'grid grid-2 mt-2' });
        if (d.platform) {
          g.appendChild(chartCard('Monthly revenue', function (h) { IS.chart.bar(h, ch.monthly_revenue, { format: IS.money }); }));
          g.appendChild(chartCard('Booking trends', function (h) { IS.chart.line(h, ch.booking_trends); }));
          g.appendChild(chartCard('Revenue by hotel', function (h) { IS.chart.hbar(h, ch.revenue_by_hotel, { format: IS.short }); }));
          g.appendChild(chartCard('Bookings by city', function (h) { IS.chart.donut(h, ch.bookings_by_city, { centerLabel: 'bookings' }); }));
          g.appendChild(chartCard('Users by role', function (h) { IS.chart.donut(h, ch.users_by_role, { centerLabel: 'users' }); }));
        } else {
          g.appendChild(chartCard('Occupancy (last 14 days, %)', function (h) { IS.chart.line(h, ch.occupancy, { format: function (v) { return v + '%'; } }); }));
          if (ch.monthly_revenue) g.appendChild(chartCard('Monthly revenue', function (h) { IS.chart.bar(h, ch.monthly_revenue, { format: IS.money }); }));
          g.appendChild(chartCard('Booking trends', function (h) { IS.chart.bar(h, ch.booking_trends, { color: 'var(--c3)' }); }));
          g.appendChild(chartCard('Popular room types', function (h) { IS.chart.donut(h, ch.popular_rooms, { centerLabel: 'bookings' }); }));
          if (ch.food_sales) g.appendChild(chartCard('Food sales (14 days)', function (h) { IS.chart.line(h, ch.food_sales, { color: 'var(--c4)', format: IS.money }); }));
          g.appendChild(chartCard('Customers by tier', function (h) { IS.chart.donut(h, ch.customers.tiers, { centerLabel: 'guests' }); }));
        }
        root.appendChild(g);
      });
    }
  };

  /* =================================================================== front desk */
  var DOCS = ['Aadhaar', 'Passport', 'Driving License', 'Voter ID', 'Other'];
  function showDetails(id) {
    var body = el('div', null, IS.loading(4)), m = IS.modal({ title: 'Booking details', body: body, size: 'lg' });
    IS.get('/api/ops/reservation/' + id).then(function (d) {
      var g = d.guest, root = el('div', { class: 'stack' });
      root.appendChild(el('div', { class: 'grid grid-2' }, el('div', { class: 'card stack' }, el('h4', { class: 'card-title' }, 'Guest'), el('b', null, g.full_name + (g.is_blacklisted ? ' (BLOCKED)' : '')),
        el('div', { class: 'muted small' }, (g.mobile || '') + ' · ' + (g.email || '')), el('div', null, IS.badge(g.membership), ' ', g.loyalty_points + ' pts'),
        el('div', { class: 'small' }, 'Emergency: ' + (g.emergency_name || '-') + ' ' + (g.emergency_phone || '')), el('div', { class: 'small' }, 'Preferences: ' + (g.preferences || '-')),
        el('div', { class: 'small' }, 'ID proofs: ' + (d.documents.length ? d.documents.map(function (x) { return x.doc_type + ' ' + x.doc_number + (x.verified ? ' ✓' : ''); }).join(', ') : 'none on file')),
        d.guests.length ? el('div', { class: 'small' }, 'Other guests: ' + d.guests.map(function (x) { return x.name; }).join(', ')) : null), el('div', { class: 'card' }, IS.billTable(d.bill))));
      body.replaceWith(root);
    }, function (e) { IS.clear(body); body.appendChild(IS.errorBox(e)); });
  }
  function checkInModal(row, after) {
    var fields = [{ name: 'doc_type', label: 'ID proof type', type: 'select', options: [{ value: '', label: row.docs ? 'Use ID on file' : '— Select —' }].concat(DOCS.map(function (d) { return { value: d, label: d }; })) },
      { name: 'doc_number', label: 'ID number' }, { name: 'emergency_name', label: 'Emergency contact' }, { name: 'emergency_phone', label: 'Emergency phone', type: 'tel' }, { name: 'force', type: 'checkbox', label: 'Early check-in / override room-not-ready warning', span: 2 }];
    IS.formModal({ title: 'Check-in · ' + row.guest + ' · Room ' + row.room_no, fields: fields, submitLabel: 'Complete check-in', note: 'Digital registration form: ID proof is mandatory for first-time guests.',
      onSubmit: function (d) {
        var b = { reservation_id: row.id, force: !!d.force, emergency_name: d.emergency_name, emergency_phone: d.emergency_phone };
        if (d.doc_type && d.doc_number) b.document = { doc_type: d.doc_type, doc_number: d.doc_number };
        return IS.post('/api/ops/checkin', b);
      } }).then(function (ok) { if (ok) { IS.toast('Guest checked in'); after(); } });
  }
  function checkOutModal(row, after) {
    IS.get('/api/ops/reservation/' + row.id).then(function (d) {
      var bal = d.bill.balance, fields = bal > 0.01 ? [{ name: 'method', label: 'Payment method', type: 'select', options: ['Cash', 'Card', 'UPI'] }, { name: 'settle_amount', label: 'Amount received (₹)', type: 'number', value: bal, step: '0.01' }] : [];
      IS.formModal({ title: 'Check-out · ' + row.guest + ' · Room ' + row.room_no, fields: fields, submitLabel: bal > 0.01 ? 'Collect & check-out' : 'Check-out', size: 'lg',
        note: bal > 0.01 ? 'Pending balance ' + IS.money(bal, true) + ' must be cleared.' : 'Bill is fully paid.',
        onSubmit: function (v) { return IS.post('/api/ops/checkout', { reservation_id: row.id, method: v.method, settle_amount: v.settle_amount }); } }).then(function (r) { if (r) { IS.toast('Checked out. Room sent to housekeeping.'); after(); } });
    }, IS.err);
  }
  function transferModal(row, after) {
    var ci = row.status === 'Checked-in' ? IS.today() : row.check_in;
    IS.get('/api/ops/available-rooms', { checkin: ci, checkout: row.check_out }).then(function (d) {
      var opts = d.rooms.filter(function (r) { return r.room_no !== row.room_no; }).map(function (r) { return { value: r.id, label: 'Room ' + r.room_no + ' · ' + r.type + ' · ' + IS.money(r.avg_price) + '/night · ' + r.status }; });
      if (!opts.length) return IS.toast('No other rooms are free for these dates.', 'info');
      IS.formModal({ title: 'Change room · ' + row.guest, fields: [{ name: 'new_room_id', label: 'Move to', type: 'select', options: opts, required: true }], submitLabel: 'Transfer',
        onSubmit: function (v) { return IS.post('/api/ops/transfer', { reservation_id: row.id, new_room_id: v.new_room_id }); } }).then(function (ok) { if (ok) { IS.toast('Room changed'); after(); } });
    }, IS.err);
  }
  function cancelModal(row, after) {
    IS.formModal({ title: 'Cancel booking ' + row.booking_ref, fields: [{ name: 'reason', label: 'Reason', type: 'textarea', span: 2 }], submitLabel: 'Cancel booking', danger: true,
      onSubmit: function (v) { return IS.post('/api/ops/cancel', { reservation_id: row.id, reason: v.reason }); } }).then(function (r) { if (r) { IS.toast(r && r.refund ? 'Cancelled. Refund ₹' + r.refund + ' initiated.' : 'Booking cancelled'); after(); } });
  }
  function modifyModal(row, after) {
    IS.formModal({ title: 'Modify booking ' + row.booking_ref, fields: [{ name: 'check_in', label: 'Check-in', type: 'date', value: row.check_in }, { name: 'check_out', label: 'Check-out', type: 'date', value: row.check_out }], submitLabel: 'Update dates',
      onSubmit: function (v) { return IS.post('/api/ops/modify', { reservation_id: row.id, check_in: v.check_in, check_out: v.check_out, adults: row.adults, children: row.children }); } }).then(function (ok) { if (ok) { IS.toast('Booking updated'); after(); } });
  }

  IS.pages.frontdesk = {
    title: 'Front Desk',
    render: function (root, ctx) {
      root.appendChild(IS.pageHeader('Front desk', 'Arrivals, in-house guests and today’s movements'));
      var scan = el('input', { class: 'input grow', placeholder: 'Scan / type booking QR code to find a booking…', 'aria-label': 'QR code' });
      var go = el('button', { class: 'btn btn-primary', type: 'button' }, IS.icon('qr', 16), 'Find');
      function lookup() { var t = scan.value.trim().replace(/^INNOVASTAY:/i, ''); if (!t) return; IS.get('/api/ops/lookup-token/' + encodeURIComponent(t)).then(function (r) { scan.value = ''; showDetails(r.id); }, IS.err); }
      go.addEventListener('click', lookup); scan.addEventListener('keydown', function (e) { if (e.key === 'Enter') lookup(); });
      root.appendChild(el('div', { class: 'toolbar' }, scan, go));
      var host = el('div'); root.appendChild(host);
      function reload() { return load(); }
      function btn(label, cls, fn) { return el('button', { class: 'btn btn-sm ' + cls, type: 'button', onclick: fn }, label); }
      function table(rows, kind) {
        return IS.table({ rows: rows, empty: 'Nothing here right now', columns: [
          { key: 'booking_ref', label: 'Booking', render: function (r) { return el('div', null, el('b', null, r.booking_ref), el('div', { class: 'small muted' }, IS.title(r.booking_type))); } },
          { key: 'guest', label: 'Guest', render: function (r) { return el('div', null, el('b', null, r.guest), el('div', { class: 'small muted' }, (r.mobile || '') + ' ' + (r.is_blacklisted ? '· BLOCKED' : ''))); } },
          { key: 'room_no', label: 'Room', render: function (r) { return 'Rm ' + r.room_no + ' · ' + r.room_type; } },
          { key: 'check_in', label: 'Stay', render: function (r) { return IS.date(r.check_in) + ' → ' + IS.date(r.check_out); } },
          { key: 'room_status', label: 'Room status', render: function (r) { return IS.badge(r.room_status); } },
          { key: 'paid', label: 'Paid', align: 'right', render: function (r) { return IS.money(r.paid); } },
          { key: 'id', label: '', render: function (r) {
            var a = el('div', { class: 'actions' }, btn('Details', 'btn-outline', function () { showDetails(r.id); }));
            if (kind === 'arrivals' || kind === 'overdue') { a.appendChild(btn('Check-in', 'btn-primary', function () { checkInModal(r, reload); })); }
            if (kind === 'inhouse') { a.appendChild(btn('Check-out', 'btn-primary', function () { checkOutModal(r, reload); })); }
            if (kind !== 'waiting') a.appendChild(btn('Change room', 'btn-soft', function () { transferModal(r, reload); }));
            if (kind !== 'inhouse') a.appendChild(btn('Modify', 'btn-soft', function () { modifyModal(r, reload); }));
            if (kind !== 'inhouse') a.appendChild(btn('Cancel', 'btn-ghost', function () { cancelModal(r, reload); }));
            return a; } }] });
      }
      var tabsApi;
      function load() {
        return IS.get('/api/ops/frontdesk').then(function (d) {
          var cur = tabsApi ? tabsApi.current() : 'arrivals'; IS.clear(host);
          var defs = [['arrivals', 'Arrivals', d.arrivals], ['inhouse', 'In-house', d.inhouse], ['upcoming', 'Upcoming', d.upcoming], ['overdue', 'Overdue', d.overdue], ['waiting', 'Waiting list', d.waiting]];
          tabsApi = IS.tabs(host, defs.map(function (t) { return { id: t[0], label: t[1] + ' (' + t[2].length + ')', render: function (p) { p.appendChild(el('div', { class: 'card', style: { padding: 0 } }, table(t[2], t[0]))); } }; }), { initial: cur });
        });
      }
      return load();
    }
  };

  /* =================================================================== walk-in booking */
  IS.pages.walkin = {
    title: 'Walk-in Booking',
    render: function (root, ctx) {
      root.appendChild(IS.pageHeader('Walk-in booking', 'Book a guest standing at the desk'));
      var today = IS.today();
      var f = [{ name: 'full_name', label: 'Guest name', required: true }, { name: 'mobile', label: 'Mobile', type: 'tel', required: true }, { name: 'email', label: 'Email (optional)', type: 'email' },
        { name: 'doc_type', label: 'ID proof', type: 'select', options: DOCS }, { name: 'doc_number', label: 'ID number' }, { name: 'check_in', label: 'Check-in', type: 'date', value: today, min: today },
        { name: 'check_out', label: 'Check-out', type: 'date', value: IS.addDays(today, 1), min: IS.addDays(today, 1) }, { name: 'adults', label: 'Adults', type: 'number', value: 1, min: 1 }, { name: 'children', label: 'Children', type: 'number', value: 0, min: 0 }];
      var form = el('form', { class: 'card stack', novalidate: true }, el('div', { class: 'form-error hidden' }), IS.formFields(f));
      var roomSel = el('select', { class: 'select', name: 'room_id' }, el('option', { value: '' }, 'Pick dates to see rooms'));
      var extra = IS.formFields([{ name: 'advance', label: 'Advance received (₹)', type: 'number', value: 0, min: 0 }, { name: 'method', label: 'Payment method', type: 'select', options: ['Cash', 'Card', 'UPI'] }, { name: 'instant_checkin', type: 'checkbox', label: 'Check the guest in immediately', span: 2 }]);
      form.appendChild(el('div', { class: 'field' }, el('label', null, 'Available room *'), roomSel)); form.appendChild(extra);
      var submit = el('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, 'Create booking'); form.appendChild(submit);
      function rooms() {
        var ci = form.check_in.value, co = form.check_out.value; if (!ci || !co || co <= ci) return;
        IS.get('/api/ops/available-rooms', { checkin: ci, checkout: co }).then(function (d) {
          IS.clear(roomSel); roomSel.appendChild(el('option', { value: '' }, d.rooms.length ? '— Select a room —' : 'No rooms free'));
          d.rooms.forEach(function (r) { roomSel.appendChild(el('option', { value: r.id }, 'Room ' + r.room_no + ' · ' + r.type + ' · sleeps ' + r.capacity + ' · ' + IS.money(r.avg_price) + '/night')); });
        });
      }
      form.check_in.addEventListener('change', function () { form.check_out.min = IS.addDays(form.check_in.value, 1); if (form.check_out.value <= form.check_in.value) form.check_out.value = IS.addDays(form.check_in.value, 1); rooms(); });
      form.check_out.addEventListener('change', rooms); rooms();
      form.addEventListener('submit', function (e) {
        e.preventDefault(); var err = form.querySelector('.form-error'); err.classList.add('hidden');
        var v = IS.readForm(form, f.concat([{ name: 'advance', type: 'number' }, { name: 'method' }, { name: 'instant_checkin', type: 'checkbox' }, { name: 'room_id' }]));
        if (!v.room_id) { err.textContent = 'Select a room.'; err.classList.remove('hidden'); return; }
        var body = { guest: { full_name: v.full_name, mobile: v.mobile, email: v.email, doc_type: v.doc_number ? v.doc_type : '', doc_number: v.doc_number }, room_id: v.room_id, check_in: v.check_in, check_out: v.check_out,
          adults: v.adults, children: v.children, advance: v.advance || 0, method: v.method, instant_checkin: !!v.instant_checkin };
        IS.busy(submit, function () { return IS.post('/api/ops/walkin', body); }).then(function (r) {
          IS.toast('Booking ' + r.booking_ref + ' created' + (r.checked_in ? ' and guest checked in' : '') + (r.checkin_error ? ' (check-in: ' + r.checkin_error + ')' : '')); form.reset(); form.check_in.value = today; form.check_out.value = IS.addDays(today, 1); rooms();
        }, function (er) { err.textContent = er.message; err.classList.remove('hidden'); });
      });
      root.appendChild(form);
    }
  };

  /* =================================================================== floor view */
  var STATUS_LIST = ['Available', 'Cleaning', 'Maintenance', 'Out of Service'];
  IS.pages.floor = {
    title: 'Floor View',
    render: function (root, ctx) {
      root.appendChild(IS.pageHeader('Floor-wise room view', 'Live status of every room'));
      var legend = el('div', { class: 'legend mb-1' }, [['Available', 'available'], ['Occupied', 'occupied'], ['Reserved', 'reserved'], ['Cleaning', 'cleaning'], ['Maintenance', 'maintenance'], ['Out of service', 'out_of_service']].map(function (l) { return el('span', { class: 'st-' + l[1] }, el('i', { style: { background: 'var(--tile)' } }), l[0]); }));
      root.appendChild(legend);
      var host = el('div'); root.appendChild(host);
      function load() {
        return IS.get('/api/ops/floor').then(function (d) {
          IS.clear(host);
          d.floors.forEach(function (fl) {
            host.appendChild(el('div', { class: 'floor' }, el('h3', null, 'Floor ' + fl.floor), el('div', { class: 'room-grid' }, fl.rooms.map(function (r, i) {
              var cls = 'st-' + r.live_status.toLowerCase().replace(/ /g, '_');
              return el('button', { class: 'room-tile ' + cls, type: 'button', style: { animationDelay: (i * 25) + 'ms' }, onclick: function () { roomModal(r); } }, el('b', null, r.room_no), el('small', null, r.type), el('small', null, r.guest || r.live_status));
            }))));
          });
        });
      }
      function roomModal(r) {
        var body = el('div', { class: 'stack' }, el('div', { class: 'kv' }, el('span', { class: 'muted' }, 'Type'), el('span', null, r.type), el('span', { class: 'muted' }, 'Rate'), el('span', null, IS.money(r.price)),
          el('span', { class: 'muted' }, 'Status'), IS.badge(r.live_status), r.guest ? el('span', { class: 'muted' }, 'Guest') : null, r.guest ? el('span', null, r.guest + ' (till ' + IS.date(r.check_out) + ')') : null));
        var m;
        if (r.status !== 'Occupied') {
          body.appendChild(el('div', { class: 'muted small' }, 'Change room status'));
          body.appendChild(el('div', { class: 'row', style: { flexWrap: 'wrap' } }, STATUS_LIST.filter(function (s) { return s !== r.status; }).map(function (s) {
            return el('button', { class: 'btn btn-outline btn-sm', onclick: function () { IS.post('/api/ops/rooms/' + r.id + '/status', { status: s }).then(function () { IS.toast('Room ' + r.room_no + ' set to ' + s); m.close(); load(); }, IS.err); } }, s);
          })));
        }
        m = IS.modal({ title: 'Room ' + r.room_no, body: body, size: 'sm' });
      }
      return load();
    }
  };

  /* =================================================================== staff-side food order */
  IS.pages.neworder = {
    title: 'New Food Order',
    render: function (root, ctx) {
      root.appendChild(IS.pageHeader('New food order', 'Room service for in-house guests, or dine-in at a table'));
      return Promise.all([IS.lookup('menu'), IS.lookup('reservations', { stay: 1 }, true)]).then(function (res) {
        var menu = res[0], stays = res[1], cart = {};
        var type = el('select', { class: 'select' }, el('option', { value: 'Room Service' }, 'Room service'), el('option', { value: 'Dine-in' }, 'Dine-in (table)'));
        var stay = el('select', { class: 'select' }, el('option', { value: '' }, '— In-house guest —'), stays.map(function (s) { return el('option', { value: s.id }, s.label); }));
        var table = el('input', { class: 'input', placeholder: 'Table no.', maxlength: 10 });
        var note = el('input', { class: 'input grow', placeholder: 'Special request (optional)' });
        function sync() { var rs = type.value === 'Room Service'; stay.parentNode.classList.toggle('hidden', !rs); table.classList.toggle('hidden', rs); }
        type.addEventListener('change', sync);
        root.appendChild(el('div', { class: 'toolbar' }, type, el('span', null, stay), table, note)); stay.parentNode.className = ''; sync();
        var total = el('b', null, '₹0'), count = el('span', { class: 'muted' }, 'No items yet');
        var place = el('button', { class: 'btn btn-primary', disabled: true }, 'Place order');
        function upd() { var t = 0, n = 0; menu.forEach(function (m) { var q = cart[m.id] || 0; t += q * m.price; n += q; }); total.textContent = IS.money(t); count.textContent = n ? n + ' item' + (n > 1 ? 's' : '') : 'No items yet'; place.disabled = !n; }
        var cats = {}; menu.forEach(function (m) { (cats[m.category] = cats[m.category] || []).push(m); });
        Object.keys(cats).forEach(function (c) {
          root.appendChild(el('h3', { style: { margin: '18px 0 10px' } }, c));
          root.appendChild(el('div', { class: 'menu-grid' }, cats[c].map(function (m) {
            var q = el('span', null, '0'), card;
            function set(n) { cart[m.id] = Math.max(0, n); q.textContent = cart[m.id]; card.classList.toggle('on', cart[m.id] > 0); upd(); }
            card = el('div', { class: 'dish' }, el('b', null, m.name), el('span', { class: 'p' }, IS.money(m.price)),
              el('div', { class: 'qty' }, el('button', { type: 'button', 'aria-label': 'Less', onclick: function () { set((cart[m.id] || 0) - 1); } }, '−'), q, el('button', { type: 'button', 'aria-label': 'More', onclick: function () { set((cart[m.id] || 0) + 1); } }, '+')));
            return card;
          })));
        });
        place.addEventListener('click', function () {
          var items = Object.keys(cart).filter(function (k) { return cart[k] > 0; }).map(function (k) { return { menu_id: +k, qty: cart[k] }; });
          IS.busy(place, function () { return IS.post('/api/ops/food-order', { order_type: type.value, reservation_id: stay.value, table_no: table.value, special_request: note.value, items: items }); }).then(function () {
            IS.toast('Order placed – kitchen notified'); cart = {}; IS.$$('.dish.on', root).forEach(function (d) { d.classList.remove('on'); IS.$$('.qty span', d).forEach(function (s) { s.textContent = '0'; }); }); upd();
          }, IS.err);
        });
        root.appendChild(el('div', { class: 'cart-bar' }, el('div', null, count, ' · Total ', total), place)); upd();
      });
    }
  };

  /* =================================================================== reports */
  var REPORTS = [['revenue', 'Revenue (daily / monthly / yearly)'], ['occupancy', 'Occupancy'], ['bookings', 'Bookings'], ['cancellations', 'Cancellations & no-shows'], ['customers', 'Customers'], ['rooms', 'Rooms'],
    ['food', 'Food sales'], ['employees', 'Employees'], ['payments', 'Payments'], ['tax', 'Tax (GST)'], ['maintenance', 'Maintenance expenses'], ['profit', 'Profit / loss']];
  IS.pages.reports = {
    title: 'Reports',
    render: function (root) {
      root.appendChild(IS.pageHeader('Reports & analytics', 'Pick a report, set the dates and download CSV'));
      var acc = H.meta.user.department === 'Accountant', allowed = acc ? ['revenue', 'payments', 'tax', 'profit', 'cancellations', 'maintenance'] : null;
      var list = REPORTS.filter(function (r) { return !allowed || allowed.indexOf(r[0]) >= 0; });
      var type = el('select', { class: 'select' }, list.map(function (r) { return el('option', { value: r[0] }, r[1]); }));
      var from = el('input', { class: 'input', type: 'date', value: IS.addDays(IS.today(), -29), 'aria-label': 'From' }), to = el('input', { class: 'input', type: 'date', value: IS.today(), 'aria-label': 'To' });
      var group = el('select', { class: 'select' }, el('option', { value: 'day' }, 'Daily'), el('option', { value: 'month' }, 'Monthly'), el('option', { value: 'year' }, 'Yearly'));
      var run = el('button', { class: 'btn btn-primary' }, IS.icon('chart', 16), 'Run report'), csv = el('button', { class: 'btn btn-outline', disabled: true }, IS.icon('download', 16), 'CSV');
      var host = el('div'), last = null;
      root.appendChild(el('div', { class: 'toolbar' }, type, from, to, group, run, csv)); root.appendChild(host);
      type.addEventListener('change', function () { group.classList.toggle('hidden', type.value !== 'revenue'); });
      function go() {
        IS.clear(host); host.appendChild(IS.loading(5));
        IS.get('/api/reports/' + type.value, { from: from.value, to: to.value, group: group.value }).then(function (d) {
          last = d; csv.disabled = !d.rows.length; IS.clear(host);
          var cols = d.columns.map(function (c) { return { key: c[0], label: c[1], align: c[2] === 'money' ? 'right' : '', render: function (r) { var v = r[c[0]]; return v == null ? '-' : c[2] === 'money' ? IS.money(v, true) : (c[0] === 'status' ? IS.badge(v) : String(v)); } }; });
          if (d.rows.length > 1 && (type.value === 'revenue' || type.value === 'occupancy')) {
            var h = el('div', { class: 'card mb-1' }, el('h3', { class: 'card-title' }, type.value === 'revenue' ? 'Net revenue' : 'Occupancy %')); var box = el('div'); h.appendChild(box); host.appendChild(h);
            setTimeout(function () { IS.chart[type.value === 'revenue' ? 'bar' : 'line'](box, d.rows.map(function (r) { return { label: r.period || r.date, value: type.value === 'revenue' ? r.net : r.percent }; }), { format: type.value === 'revenue' ? IS.money : function (v) { return v + '%'; } }); }, 0);
          }
          var foot = null; if (d.total) { foot = {}; Object.keys(d.total).forEach(function (k) { foot[k] = typeof d.total[k] === 'number' && d.columns.some(function (c) { return c[0] === k && c[2] === 'money'; }) ? IS.money(d.total[k], true) : d.total[k]; }); }
          host.appendChild(el('div', { class: 'card', style: { padding: 0 } }, IS.table({ columns: cols, rows: d.rows, empty: 'No data for this period', footer: foot })));
          if (d.note) host.appendChild(el('p', { class: 'small muted mt-1' }, d.note));
        }, function (e) { IS.clear(host); host.appendChild(IS.errorBox(e)); });
      }
      run.addEventListener('click', go);
      csv.addEventListener('click', function () { if (last) IS.downloadCsv('innovastay-' + type.value + '-' + from.value + '_' + to.value + '.csv', last.columns.map(function (c) { return { key: c[0], label: c[1] }; }), last.rows); });
      group.classList.toggle('hidden', type.value !== 'revenue'); go();
    }
  };
  H.overviewPage = IS.pages.overview;   // pages-customer.js also defines 'overview' and loads later; dashboard.js restores this one for hotel portals
})();
