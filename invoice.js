/* Printable invoice. /invoice.html?id=<reservation id>  (data: GET /api/ops/bill/:id) */
(function () {
  'use strict';
  var IS = window.IS, el = IS.el, root = document.getElementById('invoice');
  IS.$('#themeSlot').appendChild(IS.theme.button());
  document.getElementById('backLink').addEventListener('click', function (e) { if (history.length > 1) { e.preventDefault(); history.back(); } });
  document.getElementById('printBtn').addEventListener('click', function () { window.print(); });
  var id = parseInt(new URLSearchParams(location.search).get('id'), 10);
  if (!id) { root.textContent = 'No invoice selected.'; return; }

  IS.get('/api/ops/bill/' + id, null, { noRedirect: true }).then(function (d) {
    var b = d.bill, r = b.reservation, inv = d.invoice || {};
    var status = b.paid <= 0 ? 'Unpaid' : b.paid + 0.005 >= b.total ? 'Paid' : 'Partial';
    var rows = [];
    rows.push(['Room ' + r.room_no + ' · ' + r.room_type + ' (' + b.nights + ' night' + (b.nights > 1 ? 's' : '') + ', ' + IS.date(r.check_in) + ' → ' + IS.date(r.check_out) + ')', b.room_charges]);
    if (b.discount) rows.push(['Discount' + (r.coupon ? ' (' + r.coupon + ')' : ''), -b.discount]);
    b.food_orders.forEach(function (f) { rows.push(['Food order #' + f.id + ' · ' + IS.date(String(f.created_at).slice(0, 10)), f.total]); });
    b.services.forEach(function (s) { rows.push([s.name + ' × ' + s.quantity, s.amount]); });
    var tb = b.tax_breakdown;
    var table = el('table', { class: 'inv-t' }, el('thead', null, el('tr', null, el('th', null, 'Description'), el('th', null, 'Amount'))),
      el('tbody', null, rows.map(function (x) { return el('tr', null, el('td', null, x[0]), el('td', null, IS.money(x[1], true))); })));
    var pays = b.payments.length ? el('table', { class: 'inv-t' }, el('thead', null, el('tr', null, el('th', null, 'Payments received'), el('th', null, 'Amount'))),
      el('tbody', null, b.payments.map(function (p) { return el('tr', null, el('td', null, IS.date(String(p.created_at).slice(0, 10)) + ' · ' + p.method + ' · ' + (p.reference || '') + (p.type === 'Refund' ? ' (refund)' : '')), el('td', null, (p.type === 'Refund' ? '-' : '') + IS.money(p.amount, true))); }))) : null;
    IS.clear(root);
    root.appendChild(el('div', { class: 'inv-head' },
      el('div', null, el('div', { class: 'inv-brand' }, el('img', { src: '/assets/img/logo.svg', alt: '' }), 'InnovaStay'), el('div', { class: 'inv-muted' }, r.hotel_name + ' · ' + r.city), el('div', { class: 'inv-muted' }, r.hotel_address || ''), el('div', { class: 'inv-muted' }, r.hotel_phone || '')),
      el('div', { class: 'inv-meta' }, el('b', null, 'TAX INVOICE'), el('div', null, inv.invoice_no || 'Pending'), el('div', { class: 'inv-muted' }, 'Booking ' + r.booking_ref), el('div', null, el('span', { class: 'inv-badge ' + status }, status)))));
    root.appendChild(el('div', { class: 'inv-grid' },
      el('div', null, el('h4', null, 'Billed to'), el('div', null, el('b', null, r.guest_name)), el('div', null, r.guest_email || ''), el('div', null, r.guest_mobile || '')),
      el('div', null, el('h4', null, 'Stay'), el('div', null, 'Check-in: ' + IS.date(r.check_in, true)), el('div', null, 'Check-out: ' + IS.date(r.check_out, true)), el('div', null, 'Status: ' + r.status))));
    root.appendChild(table);
    root.appendChild(el('div', { class: 'inv-totals' },
      el('div', null, el('span', null, 'Subtotal'), el('span', null, IS.money(b.room_charges - b.discount + b.food_charges + b.service_charges, true))),
      el('div', null, el('span', null, 'GST on room (' + Math.round(tb.room_rate * 100) + '%)'), el('span', null, IS.money(tb.room, true))),
      b.food_charges ? el('div', null, el('span', null, 'GST on food'), el('span', null, IS.money(tb.food, true))) : null,
      b.service_charges ? el('div', null, el('span', null, 'GST on services'), el('span', null, IS.money(tb.service, true))) : null,
      el('div', { class: 'grand' }, el('span', null, 'Total'), el('span', null, IS.money(b.total, true))),
      el('div', null, el('span', null, 'Paid'), el('span', null, IS.money(b.paid, true))),
      el('div', null, el('b', null, 'Balance due'), el('b', null, IS.money(b.balance, true)))));
    if (pays) root.appendChild(el('div', { style: { marginTop: '22px' } }, pays));
    root.appendChild(el('p', { class: 'inv-foot inv-muted' }, 'Thank you for choosing InnovaStay. This is a computer-generated invoice.'));
  }, function (e) {
    if (e.status === 401) { location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search)); return; }
    IS.clear(root); root.appendChild(IS.errorBox(e));
  });
})();
