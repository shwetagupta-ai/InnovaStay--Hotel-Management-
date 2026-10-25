/* Pages and helpers used by every portal: notifications, account security, bill view, cell formatting. */
(function () {
  'use strict';
  var IS = window.IS, el = IS.el;
  IS.pages = IS.pages || {};

  /* format a table cell from the column metadata coming from /api/meta */
  IS.cell = function (col, row) {
    var v = row[col.k];
    if (col.type === 'badge') return v == null || v === '' ? '-' : IS.badge(v);
    if (v === null || v === undefined || v === '') return '-';
    switch (col.type) {
      case 'money': return IS.money(v);
      case 'stars': return IS.stars(v);
      case 'bool': return Number(v) ? el('span', { class: 'badge b-green' }, 'Yes') : el('span', { class: 'badge b-gray' }, 'No');
      case 'date': return IS.date(v, true);
      case 'percent': return v + '%';
      default: return /_at$|_time$/.test(col.k) && /^\d{4}-\d\d-\d\d/.test(String(v)) ? IS.dateTime(v) : String(v);
    }
  };

  /* cached dropdown data: name may be 'employees:Housekeeping' */
  var lookups = {};
  IS.lookup = function (name, params, fresh) {
    var key = name + JSON.stringify(params || {});
    if (!lookups[key] || fresh) lookups[key] = IS.get('/api/lookup/' + name, params).then(function (d) { return d.items; });
    return lookups[key];
  };

  /* itemised bill (used by staff front desk, customer portal and the invoice page) */
  IS.billTable = function (b) {
    var r = b.reservation, rows = [
      ['Room (' + b.nights + ' night' + (b.nights > 1 ? 's' : '') + ')', b.room_charges], b.discount ? ['Discount', -b.discount] : null,
      b.food_charges ? ['Food & beverages', b.food_charges] : null, b.service_charges ? ['Extra services', b.service_charges] : null,
      ['GST', b.tax]].filter(Boolean);
    return el('div', { class: 'stack' },
      el('div', { class: 'kv' }, el('span', { class: 'muted' }, 'Booking'), el('b', null, r.booking_ref), el('span', { class: 'muted' }, 'Guest'), el('span', null, r.guest_name),
        el('span', { class: 'muted' }, 'Room'), el('span', null, (r.room_no || '') + ' · ' + (r.room_type || '')), el('span', { class: 'muted' }, 'Stay'), el('span', null, IS.date(r.check_in) + ' → ' + IS.date(r.check_out))),
      IS.table({ columns: [{ key: 'a', label: 'Charge' }, { key: 'b', label: 'Amount', align: 'right' }], rows: rows.map(function (x) { return { a: x[0], b: IS.money(x[1], true) }; }),
        footer: { a: 'Total', b: IS.money(b.total, true) } }),
      el('div', { class: 'row between' }, el('span', null, 'Paid'), el('b', null, IS.money(b.paid, true))),
      el('div', { class: 'row between' }, el('span', null, 'Balance due'), el('b', { style: { color: b.balance > 0.01 ? 'var(--danger, #d93a3a)' : 'inherit' } }, IS.money(b.balance, true))),
      b.payments.length ? IS.table({ columns: [{ key: 'paid_at', label: 'Date', render: function (p) { return IS.dateTime(p.paid_at); } }, { key: 'method', label: 'Method' }, { key: 'type', label: 'Type', render: function (p) { return IS.badge(p.type); } },
        { key: 'amount', label: 'Amount', align: 'right', render: function (p) { return IS.money(p.amount, true); } }], rows: b.payments }) : null);
  };

  /* ---------- notifications ---------- */
  IS.pages.notifications = {
    title: 'Notifications',
    render: function (root, ctx) {
      function paint(d) {
        IS.clear(root);
        root.appendChild(IS.pageHeader('Notifications', d.unread + ' unread', [el('button', { class: 'btn btn-outline btn-sm', onclick: function () { IS.post('/api/notifications/read', {}).then(load).then(ctx.refreshNotifications); } }, 'Mark all as read')]));
        if (!d.items.length) { root.appendChild(IS.empty('No notifications yet', 'bell')); return; }
        root.appendChild(el('div', { class: 'card stack', style: { gap: '0' } }, d.items.map(function (n) {
          return el('div', { class: 'notif-row' + (n.is_read ? '' : ' unread'), onclick: function () { if (!n.is_read) IS.post('/api/notifications/read', { id: n.id }).then(load).then(ctx.refreshNotifications); } },
            el('div', { class: 'dot' }), el('div', { class: 'grow' }, el('b', null, n.title), el('div', { class: 'muted small' }, n.message || '')), el('small', { class: 'muted nowrap' }, IS.ago(n.created_at)));
        })));
      }
      function load() { return IS.get('/api/notifications').then(paint); }
      return load();
    }
  };

  /* ---------- account & security ---------- */
  IS.pages.security = {
    title: 'Account & Security',
    render: function (root) {
      return IS.get('/api/auth/sessions').then(function (d) {
        root.appendChild(IS.pageHeader('Account & security', 'Keep your account protected'));
        root.appendChild(el('div', { class: 'grid grid-2' },
          el('div', { class: 'card stack' }, el('h3', { class: 'card-title' }, 'Password'), el('p', { class: 'muted' }, 'Use a strong, unique password. Changing it signs out your other devices.'),
            el('div', null, el('button', { class: 'btn btn-primary', onclick: function () { IS.changePasswordModal(false); } }, IS.icon('lock', 16), 'Change password'))),
          el('div', { class: 'card stack' }, el('h3', { class: 'card-title' }, 'Devices'), el('p', { class: 'muted' }, 'Recent successful sign-ins to your account.'),
            IS.table({ rows: d.sessions, columns: [{ key: 'created_at', label: 'When', render: function (s) { return IS.dateTime(s.created_at) + (s.current ? ' (this device)' : ''); } }, { key: 'ip', label: 'IP' }] }),
            el('div', null, el('button', { class: 'btn btn-outline btn-sm', onclick: function () { IS.confirm('Sign out every other device?').then(function (ok) { if (ok) IS.post('/api/auth/sessions/revoke-others', {}).then(function (r) { IS.toast(r.message); }, IS.err); }); } }, 'Sign out other devices')))));
        root.appendChild(el('div', { class: 'card mt-1' }, el('h3', { class: 'card-title' }, 'Login history'),
          IS.table({ rows: d.history, columns: [{ key: 'created_at', label: 'When', render: function (h) { return IS.dateTime(h.created_at); } }, { key: 'portal', label: 'Portal' }, { key: 'ip', label: 'IP' },
            { key: 'success', label: 'Result', render: function (h) { return h.success ? IS.badge('success', 'Success') : IS.badge('failed', 'Failed'); } }] })));
      });
    }
  };
})();
