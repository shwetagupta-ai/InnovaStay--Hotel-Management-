/* Customer portal pages: overview, book a stay (search + smart picks), my bookings, my stay (room service), feedback, offers, profile. */
(function () {
  'use strict';
  var IS = window.IS, el = IS.el;
  IS.pages = IS.pages || {};

  IS.customerNav = [
    { id: 'overview', label: 'Overview', icon: 'home', group: 'Stay' }, { id: 'book', label: 'Book a Stay', icon: 'search' }, { id: 'bookings', label: 'My Bookings', icon: 'calendar' }, { id: 'stay', label: 'My Stay · Room Service', icon: 'food' },
    { id: 'feedback', label: 'Feedback & Complaints', icon: 'chat', group: 'More' }, { id: 'offers', label: 'Offers & Rewards', icon: 'gift' }, { id: 'profile', label: 'My Profile', icon: 'user' },
    { id: 'notifications', label: 'Notifications', icon: 'bell', group: 'Account' }, { id: 'security', label: 'Account & Security', icon: 'lock' }];

  function copy(text) { if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { IS.toast('Copied ' + text); }, function () { IS.toast(text, 'info'); }); else IS.toast(text, 'info'); }
  function starInput(label) {
    var val = 0, btns = [], box = el('div', { class: 'rate-row' }, el('span', { class: 'muted small', style: { width: '64px' } }, label));
    var wrap = el('div', { class: 'star-input' });
    for (var i = 1; i <= 5; i++) (function (n) { var b = el('button', { type: 'button', 'aria-label': n + ' star' + (n > 1 ? 's' : ''), onclick: function () { val = val === n ? 0 : n; paint(); } }, '★'); btns.push(b); wrap.appendChild(b); })(i);
    function paint() { btns.forEach(function (b, i) { b.classList.toggle('on', i < val); }); }
    box.appendChild(wrap); return { el: box, value: function () { return val || null; } };
  }

  /* ============================================================ overview */
  IS.pages.overview = {
    title: 'Overview',
    render: function (root, ctx) {
      return IS.get('/api/customer/overview').then(function (d) {
        var g = d.guest, t = d.tier, pct = t && t.at ? Math.min(100, Math.round(g.loyalty_points / t.at * 100)) : 100;
        root.appendChild(el('div', { class: 'hero-card' }, el('p', null, 'Welcome back'), el('h2', null, g.full_name), el('p', null, IS.badge(g.membership, g.membership + ' member', 'sky'), '  ' + IS.num(g.loyalty_points) + ' reward points'),
          el('div', { class: 'progress' }, el('span', { style: { width: pct + '%' } })), el('p', { class: 'small', style: { marginTop: '8px' } }, t && t.next ? IS.num(Math.max(0, t.at - g.loyalty_points)) + ' more points to reach ' + t.next : 'You are at our highest tier – enjoy 10% off every stay!'),
          el('div', { class: 'row mt-2', style: { flexWrap: 'wrap' } }, el('button', { class: 'btn btn-lg', style: { background: '#fff', color: '#0a2463' }, onclick: function () { ctx.go('book'); } }, IS.icon('search', 18), 'Find a room'),
            el('button', { class: 'btn btn-lg btn-outline', style: { color: '#fff', borderColor: 'rgba(255,255,255,.6)' }, onclick: function () { ctx.go('bookings'); } }, 'My bookings'))));
        root.appendChild(el('div', { class: 'grid grid-4 stagger mt-2' }, IS.kpi('Upcoming stays', d.counts.upcoming, null, 'calendar'), IS.kpi('Completed stays', d.counts.completed, null, 'check'),
          IS.kpi('Unread alerts', d.counts.unread, null, 'bell'), IS.kpi('Total spent', IS.money(d.counts.spent), null, 'wallet')));
        var nb = d.next_booking;
        root.appendChild(el('div', { class: 'card mt-2' }, el('h3', { class: 'card-title' }, 'Next stay'), nb ? el('div', { class: 'row between', style: { flexWrap: 'wrap', gap: '12px' } },
          el('div', null, el('b', null, nb.hotel + ' · ' + nb.city), el('div', { class: 'muted' }, 'Room ' + nb.room_no + ' · ' + IS.date(nb.check_in) + ' → ' + IS.date(nb.check_out) + ' · ' + nb.booking_ref)), el('div', null, IS.badge(nb.status), ' ', el('button', { class: 'btn btn-outline btn-sm', onclick: function () { ctx.go('bookings'); } }, 'Manage')))
          : IS.empty('No upcoming stay. Time to plan one?', 'bed')));
      });
    }
  };

  /* ============================================================ book a stay */
  function priceLines(q) {
    var rows = [['Room · ' + q.stay.nights.length + ' night' + (q.stay.nights.length > 1 ? 's' : '') + ' (avg ' + IS.money(q.stay.avg) + ')', IS.money(q.stay.total)]];
    (q.extras || []).forEach(function (x) { rows.push([x.label, IS.money(x.amount)]); });
    (q.discounts || []).forEach(function (x) { rows.push([x.label, '− ' + IS.money(x.amount)]); });
    if (q.coupon && q.coupon.amount) rows.push(['Coupon ' + q.coupon.code, '− ' + IS.money(q.coupon.amount)]);
    return el('div', { class: 'price-lines' }, rows.map(function (r) { return el('div', { class: 'row between' }, el('span', null, r[0]), el('span', null, r[1])); }),
      el('div', { class: 'row between', style: { paddingTop: '8px' } }, el('b', null, 'Room total'), el('b', null, IS.money(q.payable_before_tax))), el('div', { class: 'small muted' }, 'GST is added to your final bill (12% / 18% on rooms).'));
  }
  function bookingModal(room, pre, ctx) {
    var today = IS.today(), ci = pre.checkin || IS.addDays(today, 1), co = pre.checkout || IS.addDays(ci, 1);
    var f = [{ name: 'check_in', label: 'Check-in', type: 'date', value: ci, min: today }, { name: 'check_out', label: 'Check-out', type: 'date', value: co, min: IS.addDays(today, 1) },
      { name: 'adults', label: 'Adults', type: 'number', value: Math.min(room.capacity, +pre.guests || 1), min: 1, max: room.capacity }, { name: 'children', label: 'Children', type: 'number', value: 0, min: 0 },
      { name: 'coupon', label: 'Coupon code', placeholder: 'optional' }, { name: 'notes', label: 'Special request', placeholder: 'e.g. high floor, late arrival' },
      { name: 'early_checkin', type: 'checkbox', label: 'Early check-in (+25% of one night)' }, { name: 'late_checkout', type: 'checkbox', label: 'Late check-out (+25% of one night)' },
      { name: 'advance', label: 'Pay advance now (₹, optional)', type: 'number', value: 0, min: 0 }, { name: 'method', label: 'Pay using', type: 'select', options: ['UPI', 'Card'] }];
    var form = el('form', { novalidate: true }, el('div', { class: 'form-error hidden' }), IS.formFields(f));
    var guests = el('div', { class: 'stack mt-1' }), extra = [];
    var addG = el('button', { class: 'btn btn-soft btn-sm', type: 'button', onclick: function () {
      var n = el('input', { class: 'input', placeholder: 'Guest name' }), a = el('input', { class: 'input', type: 'number', placeholder: 'Age', style: { maxWidth: '90px' } });
      var row = el('div', { class: 'row' }, n, a, el('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', 'aria-label': 'Remove guest', onclick: function () { row.remove(); extra.splice(extra.indexOf(rec), 1); } }, IS.icon('close', 16)));
      var rec = { n: n, a: a }; extra.push(rec); guests.appendChild(row); } }, IS.icon('plus', 15), 'Add co-guest');
    var quoteBox = el('div', { class: 'card mt-1' }, IS.loading(2));
    var info = el('div', { class: 'stack' }, el('div', null, el('b', { style: { fontSize: '18px' } }, room.hotel + ' · Room ' + room.room_no), el('div', { class: 'muted' }, room.type + ' · sleeps ' + room.capacity + ' · ' + room.city + (room.amenities && room.amenities.length ? ' · ' + room.amenities.slice(0, 5).join(', ') : ''))));
    var body = el('div', null, info, form, el('div', null, addG), guests, quoteBox);
    var confirmBtn = el('button', { class: 'btn btn-primary', type: 'button' }, 'Confirm booking'), cancelBtn = el('button', { class: 'btn btn-outline', type: 'button' }, 'Close');
    var m = IS.modal({ title: 'Complete your booking', body: body, footer: [cancelBtn, confirmBtn], size: 'lg' });
    cancelBtn.addEventListener('click', function () { m.close(); });
    function values() { return IS.readForm(form, f); }
    function payload(v) { return { room_id: room.id, check_in: v.check_in, check_out: v.check_out, adults: v.adults, children: v.children, coupon: v.coupon || undefined, notes: v.notes, early_checkin: !!v.early_checkin, late_checkout: !!v.late_checkout,
      advance: v.advance || 0, method: v.method, extra_guests: extra.map(function (r) { return { name: r.n.value, age: r.a.value }; }).filter(function (g) { return g.name; }) }; }
    var quote = IS.debounce(function () {
      var v = values(); if (!v.check_in || !v.check_out || v.check_out <= v.check_in) { IS.clear(quoteBox); quoteBox.appendChild(el('div', { class: 'muted' }, 'Choose valid dates to see the price.')); return; }
      form.check_out.min = IS.addDays(v.check_in, 1);
      IS.post('/api/customer/quote', payload(v)).then(function (r) { IS.clear(quoteBox); quoteBox.appendChild(priceLines(r.quote)); }, function (e) { IS.clear(quoteBox); quoteBox.appendChild(IS.errorBox(e)); });
    }, 350);
    form.addEventListener('input', quote); form.addEventListener('change', function () { var v = values(); if (v.check_out <= v.check_in) form.check_out.value = IS.addDays(v.check_in, 1); quote(); }); quote();
    function send(waitlist) {
      var v = values(), p = payload(v); if (waitlist) p.waitlist = true;
      return IS.post('/api/customer/bookings', p).then(function (r) {
        m.close(); IS.toast(r.status === 'Waiting' ? 'Added to the waiting list (' + r.booking_ref + ')' : 'Booking confirmed! Reference ' + r.booking_ref); ctx.go('bookings');
      }, function (e) {
        var err = form.querySelector('.form-error');
        if (e.status === 409) { IS.confirm(e.message + ' Join the waiting list for these dates?', { confirmLabel: 'Join waiting list' }).then(function (ok) { if (ok) IS.busy(confirmBtn, function () { return send(true); }); }); }
        else { err.textContent = e.message; err.classList.remove('hidden'); err.scrollIntoView({ block: 'nearest' }); }
      });
    }
    confirmBtn.addEventListener('click', function () { IS.busy(confirmBtn, function () { return send(false); }); });
  }

  function roomRows(rooms, pre, ctx, withHotel) {
    return IS.table({ rows: rooms.slice(0, 40), empty: 'No rooms are free for these dates', columns: [
      { key: 'room_no', label: 'Room', render: function (r) { return el('div', null, el('b', null, 'Room ' + r.room_no), withHotel ? el('div', { class: 'small muted' }, r.hotel + ' · ' + r.city) : null); } },
      { key: 'type', label: 'Type', render: function (r) { return IS.badge(r.type, r.type, 'blue'); } }, { key: 'capacity', label: 'Sleeps' },
      { key: 'amenities', label: 'Amenities', render: function (r) { return r.amenities.slice(0, 4).join(', '); } },
      { key: 'avg_price', label: 'Per night', align: 'right', render: function (r) { return IS.money(r.avg_price); } }, { key: 'total_price', label: 'Total', align: 'right', render: function (r) { return el('b', null, IS.money(r.total_price)); } },
      { key: 'id', label: '', render: function (r) { return el('button', { class: 'btn btn-primary btn-sm', onclick: function () { bookingModal(r, pre, ctx); } }, 'Book'); } }] });
  }

  IS.pages.book = {
    title: 'Book a Stay',
    render: function (root, ctx) {
      root.appendChild(IS.pageHeader('Book a stay', 'Search live availability, or let us recommend the best room for you'));
      var q = ctx.query || {};
      var host = el('div'); root.appendChild(host);
      var today = IS.today();
      var tabs = IS.tabs(host, [
        { id: 'search', label: 'Search hotels', render: searchTab }, { id: 'smart', label: '✨ Smart picks', render: smartTab }], { initial: 'search' });
      function metaOptions() { return IS.get('/api/public/meta'); }
      function searchTab(p) {
        return metaOptions().then(function (meta) {
          var f = [{ name: 'city', label: 'City', type: 'select', options: [{ value: '', label: 'Any city' }].concat(meta.cities.map(function (c) { return { value: c, label: c }; })) },
            { name: 'type', label: 'Room type', type: 'select', options: [{ value: '', label: 'Any type' }].concat(meta.room_types.map(function (t) { return { value: t.name, label: t.name }; })) },
            { name: 'guests', label: 'Guests', type: 'number', value: +q.guests || 2, min: 1 }, { name: 'max', label: 'Max price / night (₹)', type: 'number', min: 0 },
            { name: 'checkin', label: 'Check-in', type: 'date', value: q.in || IS.addDays(today, 1), min: today }, { name: 'checkout', label: 'Check-out', type: 'date', value: q.out || IS.addDays(today, 2), min: IS.addDays(today, 1) }];
          var form = el('form', { class: 'card', novalidate: true }, IS.formFields(f), el('div', { class: 'mt-1' }, el('button', { class: 'btn btn-primary', type: 'submit' }, IS.icon('search', 16), 'Search')));
          var out = el('div', { class: 'mt-2' }); p.appendChild(form); p.appendChild(out);
          form.addEventListener('submit', function (e) {
            e.preventDefault(); var v = IS.readForm(form, f); if (v.checkout <= v.checkin) { IS.toast('Check-out must be after check-in', 'error'); return; }
            IS.clear(out); out.appendChild(IS.loading(3));
            IS.get('/api/public/search', v).then(function (d) {
              IS.clear(out); if (!d.hotels.length) { out.appendChild(IS.empty('No hotels match. Try different dates or filters.', 'search')); return; }
              out.appendChild(el('p', { class: 'muted' }, d.count + ' hotel' + (d.count > 1 ? 's' : '') + ' · ' + IS.date(d.checkin) + ' → ' + IS.date(d.checkout)));
              out.appendChild(el('div', { class: 'grid grid-auto' }, d.hotels.map(function (h) {
                return el('div', { class: 'room-card' }, el('div', { class: 'row between' }, el('b', null, h.name), el('span', null, IS.stars(Math.round(h.rating)))), el('div', { class: 'muted small' }, h.city + ' · ' + h.rooms_available + ' rooms free'),
                  el('div', null, h.types.map(function (t) { return IS.badge(t, t, 'blue'); })), el('div', { class: 'small muted' }, (h.amenities || []).join(' · ')),
                  el('div', { class: 'row between mt-1' }, el('div', null, el('b', { style: { fontSize: '19px', color: 'var(--primary)' } }, IS.money(h.from_price)), el('small', { class: 'muted' }, ' /night')),
                    el('button', { class: 'btn btn-primary btn-sm', onclick: function () { hotelRooms(h, d, v, out); } }, 'View rooms')));
              })));
            }, function (er) { IS.clear(out); out.appendChild(IS.errorBox(er)); });
          });
          if (q.in) form.requestSubmit ? form.requestSubmit() : null;
        });
      }
      function hotelRooms(h, d, v) {
        var body = el('div', null, IS.loading(3)), m = IS.modal({ title: h.name, body: body, size: 'xl' });
        IS.get('/api/public/hotels/' + h.id, { guests: v.guests, checkin: d.checkin, checkout: d.checkout, type: v.type }).then(function (r) {
          var pre = { checkin: d.checkin, checkout: d.checkout, guests: v.guests };
          body.replaceWith(el('div', { class: 'stack' }, el('div', { class: 'muted' }, r.hotel.address || ''), roomRows(r.rooms.map(function (x) { return Object.assign({ hotel: h.name, city: h.city }, x); }), pre, { go: function (p) { m.close(); ctx.go(p); } })));
        }, function (e) { IS.clear(body); body.appendChild(IS.errorBox(e)); });
      }
      function smartTab(p) {
        var f = [{ name: 'budget', label: 'Budget per night (₹)', type: 'number', value: 5000, min: 0 }, { name: 'guests', label: 'Guests', type: 'number', value: 2, min: 1 }, { name: 'amenities', label: 'Must-have amenities', placeholder: 'wifi, pool, breakfast' },
          { name: 'checkin', label: 'Check-in', type: 'date', value: IS.addDays(today, 1), min: today }, { name: 'checkout', label: 'Check-out', type: 'date', value: IS.addDays(today, 2), min: IS.addDays(today, 1) }];
        var form = el('form', { class: 'card', novalidate: true }, IS.formFields(f), el('div', { class: 'mt-1' }, el('button', { class: 'btn btn-primary', type: 'submit' }, IS.icon('sparkle', 16), 'Recommend rooms')));
        var out = el('div', { class: 'mt-2' }); p.appendChild(form); p.appendChild(out);
        form.addEventListener('submit', function (e) {
          e.preventDefault(); var v = IS.readForm(form, f); IS.clear(out); out.appendChild(IS.loading(3));
          IS.get('/api/public/recommend', v).then(function (d) {
            IS.clear(out); if (!d.recommendations.length) { out.appendChild(IS.empty('No matches – try a higher budget or fewer amenities.', 'sparkle')); return; }
            out.appendChild(el('div', { class: 'grid grid-auto' }, d.recommendations.map(function (r) {
              return el('div', { class: 'room-card' }, el('div', { class: 'row between' }, el('b', null, r.hotel), IS.badge(r.score + '% match', r.score + '% match', r.score >= 75 ? 'green' : 'amber')),
                el('div', { class: 'muted small' }, 'Room ' + r.room_no + ' · ' + r.type + ' · ' + r.city), el('div', { class: 'small' }, r.amenities.slice(0, 5).join(' · ')), r.matched.length ? el('div', { class: 'small' }, '✓ ' + r.matched.join(', ')) : null,
                el('div', { class: 'row between mt-1' }, el('b', { style: { color: 'var(--primary)', fontSize: '18px' } }, IS.money(r.avg_price) + '/night'), el('button', { class: 'btn btn-primary btn-sm', onclick: function () { bookingModal(r, { checkin: v.checkin, checkout: v.checkout, guests: v.guests }, ctx); } }, 'Book')));
            })));
          }, function (er) { IS.clear(out); out.appendChild(IS.errorBox(er)); });
        });
      }
      // arriving from the landing page with ?room=ID
      if (q.room) {
        IS.get('/api/public/rooms/' + encodeURIComponent(q.room)).then(function (d) { bookingModal(d.room, { checkin: q.in, checkout: q.out, guests: q.guests }, ctx); }, IS.err);
      }
    }
  };

  /* ============================================================ my bookings */
  function billModal(b, reload) {
    var body = el('div', null, IS.loading(4)), m = IS.modal({ title: 'Bill · ' + b.booking_ref, body: body, size: 'lg' });
    IS.get('/api/customer/bookings/' + b.id + '/bill').then(function (d) {
      var bill = d.bill, root = el('div', { class: 'stack' }, IS.billTable(bill));
      if (bill.balance > 0.01 && !['Cancelled', 'No-show'].includes(b.status)) {
        var f = [{ name: 'amount', label: 'Amount (₹)', type: 'number', value: bill.balance, step: '0.01', min: 1 }, { name: 'method', label: 'Pay using', type: 'select', options: ['UPI', 'Card'] }];
        var form = el('form', { class: 'card', novalidate: true }, el('b', null, 'Pay now (demo gateway)'), IS.formFields(f), el('div', { class: 'mt-1' }, el('button', { class: 'btn btn-primary', type: 'submit' }, 'Pay')));
        form.addEventListener('submit', function (e) { e.preventDefault(); var v = IS.readForm(form, f); IS.busy(form.querySelector('button'), function () { return IS.post('/api/customer/bookings/' + b.id + '/pay', v); }).then(function () { IS.toast('Payment received. Thank you!'); m.close(); reload(); }, IS.err); });
        root.appendChild(form);
      }
      root.appendChild(el('div', null, el('a', { class: 'btn btn-outline', href: '/invoice.html?id=' + b.id, target: '_blank', rel: 'noopener' }, IS.icon('print', 16), 'Printable invoice')));
      body.replaceWith(root);
    }, function (e) { IS.clear(body); body.appendChild(IS.errorBox(e)); });
  }
  function passModal(b) {
    var body = el('div', { style: { textAlign: 'center' } }, IS.loading(2)), m = IS.modal({ title: 'Check-in pass · ' + b.booking_ref, body: body, size: 'sm' });
    IS.get('/api/customer/bookings/' + b.id + '/pass').then(function (d) {
      IS.clear(body); body.appendChild(el('div', { class: 'pass-qr', html: d.qr })); body.appendChild(el('p', { class: 'muted' }, 'Show this QR at the front desk for quick check-in.')); body.appendChild(el('code', null, d.token));
    }, function (e) { IS.clear(body); body.appendChild(IS.errorBox(e)); });
  }
  function feedbackModal(b, done) {
    var hotel = starInput('Hotel'), room = starInput('Room'), food = starInput('Food'), staff = starInput('Staff');
    var f = [{ name: 'kind', label: 'Type', type: 'select', options: ['Feedback', 'Complaint'] }, { name: 'comment', label: 'Your comments', type: 'textarea', span: 2 }];
    var pr = IS.formModal({ title: 'Rate your stay · ' + b.hotel, fields: f, submitLabel: 'Submit',
      onSubmit: function (v) { return IS.post('/api/customer/feedback', { reservation_id: b.id, kind: v.kind, comment: v.comment, hotel_rating: hotel.value(), room_rating: room.value(), food_rating: food.value(), staff_rating: staff.value() }); } });
    var backs = document.querySelectorAll('.modal-backdrop'), fm = backs[backs.length - 1].querySelector('form');   // the modal formModal just opened
    fm.insertBefore(el('div', { class: 'stack', style: { marginBottom: '12px' } }, hotel.el, room.el, food.el, staff.el), fm.children[1]);
    pr.then(function (ok) { if (ok) { IS.toast('Thank you for your feedback!'); if (done) done(); } });
  }
  IS.pages.bookings = {
    title: 'My Bookings',
    render: function (root, ctx) {
      root.appendChild(IS.pageHeader('My bookings', 'View bills, change dates, cancel or review your stays', [el('button', { class: 'btn btn-primary', onclick: function () { ctx.go('book'); } }, IS.icon('plus', 16), 'New booking')]));
      var host = el('div', { class: 'card', style: { padding: 0 } }); root.appendChild(host);
      function load() {
        return IS.get('/api/customer/bookings').then(function (d) {
          IS.clear(host);
          host.appendChild(IS.table({ rows: d.bookings, empty: 'You have no bookings yet', emptyIcon: 'calendar', columns: [
            { key: 'booking_ref', label: 'Booking', render: function (r) { return el('div', null, el('b', null, r.booking_ref), el('div', { class: 'small muted' }, IS.title(r.booking_type))); } },
            { key: 'hotel', label: 'Hotel', render: function (r) { return el('div', null, el('b', null, r.hotel), el('div', { class: 'small muted' }, r.city + ' · Room ' + r.room_no + ' · ' + r.room_type)); } },
            { key: 'check_in', label: 'Stay', render: function (r) { return IS.date(r.check_in) + ' → ' + IS.date(r.check_out); } },
            { key: 'status', label: 'Status', render: function (r) { return IS.badge(r.status); } },
            { key: 'paid', label: 'Paid', align: 'right', render: function (r) { return IS.money(r.paid); } },
            { key: 'id', label: '', render: function (r) {
              var live = ['Pending', 'Confirmed', 'Waiting'].indexOf(r.status) >= 0, a = el('div', { class: 'actions' });
              a.appendChild(el('button', { class: 'btn btn-outline btn-sm', onclick: function () { billModal(r, load); } }, 'Bill'));
              if (r.status === 'Confirmed' || r.status === 'Checked-in') a.appendChild(el('button', { class: 'btn btn-soft btn-sm', onclick: function () { passModal(r); } }, IS.icon('qr', 14), 'QR pass'));
              if (['Pending', 'Confirmed'].indexOf(r.status) >= 0) a.appendChild(el('button', { class: 'btn btn-soft btn-sm', onclick: function () {
                IS.formModal({ title: 'Modify ' + r.booking_ref, fields: [{ name: 'check_in', label: 'Check-in', type: 'date', value: r.check_in, min: IS.today() }, { name: 'check_out', label: 'Check-out', type: 'date', value: r.check_out }, { name: 'adults', label: 'Adults', type: 'number', value: r.adults, min: 1 }, { name: 'children', label: 'Children', type: 'number', value: r.children, min: 0 }], submitLabel: 'Update',
                  onSubmit: function (v) { return IS.put('/api/customer/bookings/' + r.id, v); } }).then(function (ok) { if (ok) { IS.toast('Booking updated'); load(); } }); } }, 'Modify'));
              if (live) a.appendChild(el('button', { class: 'btn btn-ghost btn-sm', onclick: function () {
                IS.formModal({ title: 'Cancel ' + r.booking_ref + '?', fields: [{ name: 'reason', label: 'Reason (optional)', type: 'textarea', span: 2 }], submitLabel: 'Cancel booking', danger: true, note: 'Free cancellation up to the hotel’s cancellation window; refunds go back to your payment method.',
                  onSubmit: function (v) { return IS.post('/api/customer/bookings/' + r.id + '/cancel', { reason: v.reason }); } }).then(function (res) { if (res) { IS.toast(res && res.refund ? 'Cancelled. Refund of ' + IS.money(res.refund) + ' initiated.' : 'Booking cancelled'); load(); } }); } }, 'Cancel'));
              if ((r.status === 'Checked-out' || r.status === 'Checked-in') && !r.reviewed) a.appendChild(el('button', { class: 'btn btn-soft btn-sm', onclick: function () { feedbackModal(r, load); } }, IS.icon('star', 14), 'Review'));
              return a; } }] }));
        });
      }
      return load();
    }
  };

  /* ============================================================ my stay: room service + services */
  IS.pages.stay = {
    title: 'My Stay',
    render: function (root, ctx) {
      root.appendChild(IS.pageHeader('My stay', 'Order food to your room and request services'));
      return IS.get('/api/customer/stay').then(function (d) {
        if (!d.stays.length) { root.appendChild(el('div', { class: 'card' }, IS.empty('Room service and services open once you are checked in.', 'food'), el('div', { class: 'center mt-1' }, el('button', { class: 'btn btn-outline', onclick: function () { ctx.go('bookings'); } }, 'View my bookings')))); return; }
        d.stays.forEach(function (s) {
          var card = el('div', { class: 'card mb-1' }, el('div', { class: 'row between' }, el('h3', { class: 'card-title', style: { margin: 0 } }, s.hotel + ' · Room ' + s.room_no), IS.badge('Checked-in')));
          var host = el('div', { class: 'mt-1' }); card.appendChild(host); root.appendChild(card);
          IS.tabs(host, [
            { id: 'food', label: 'Order food', render: function (p) { foodTab(p, s); } }, { id: 'svc', label: 'Request a service', render: function (p) { svcTab(p, s); } }, { id: 'hist', label: 'My orders', render: function (p) { histTab(p, s); } }]);
        });
      });
      function foodTab(p, s) {
        var cart = {}, cats = {}; s.menu.forEach(function (m) { (cats[m.category] = cats[m.category] || []).push(m); });
        var total = el('b', null, '₹0'), btn = el('button', { class: 'btn btn-primary', disabled: true }, 'Place order'), note = el('input', { class: 'input grow', placeholder: 'Special request (optional)' });
        function upd() { var t = 0, n = 0; s.menu.forEach(function (m) { var q = cart[m.id] || 0; t += q * m.price; n += q; }); total.textContent = IS.money(t); btn.disabled = !n; }
        Object.keys(cats).forEach(function (c) {
          p.appendChild(el('h4', { style: { margin: '14px 0 8px' } }, c));
          p.appendChild(el('div', { class: 'menu-grid' }, cats[c].map(function (m) {
            var q = el('span', null, '0'), card;
            function set(n) { cart[m.id] = Math.max(0, n); q.textContent = cart[m.id]; card.classList.toggle('on', cart[m.id] > 0); upd(); }
            card = el('div', { class: 'dish' }, el('b', null, m.name), m.description ? el('span', { class: 'small muted' }, m.description) : null, el('span', { class: 'p' }, IS.money(m.price)),
              el('div', { class: 'qty' }, el('button', { type: 'button', 'aria-label': 'Less', onclick: function () { set((cart[m.id] || 0) - 1); } }, '−'), q, el('button', { type: 'button', 'aria-label': 'More', onclick: function () { set((cart[m.id] || 0) + 1); } }, '+')));
            return card;
          })));
        });
        btn.addEventListener('click', function () {
          var items = Object.keys(cart).filter(function (k) { return cart[k] > 0; }).map(function (k) { return { menu_id: +k, qty: cart[k] }; });
          IS.busy(btn, function () { return IS.post('/api/customer/food-orders', { reservation_id: s.id, items: items, special_request: note.value }); }).then(function (r) { IS.toast('Order placed (' + IS.money(r.total) + '). Added to your room bill.'); ctx.reload(); }, IS.err);
        });
        p.appendChild(el('div', { class: 'cart-bar' }, el('div', null, 'Total ', total), note, btn));
      }
      function svcTab(p, s) {
        p.appendChild(IS.table({ rows: s.services, empty: 'No services available', columns: [{ key: 'name', label: 'Service' }, { key: 'category', label: 'Category' }, { key: 'price', label: 'Price', align: 'right', render: function (r) { return IS.money(r.price); } },
          { key: 'id', label: '', render: function (r) { return el('button', { class: 'btn btn-primary btn-sm', onclick: function () {
            IS.formModal({ title: 'Request · ' + r.name, fields: [{ name: 'quantity', label: 'Quantity', type: 'number', value: 1, min: 1, max: 10 }, { name: 'requested_for', label: 'When (optional)', placeholder: 'e.g. today 6 PM' }, { name: 'notes', label: 'Notes', type: 'textarea', span: 2 }], submitLabel: 'Request',
              onSubmit: function (v) { return IS.post('/api/customer/service-requests', { reservation_id: s.id, service_id: r.id, quantity: v.quantity, requested_for: v.requested_for, notes: v.notes }); } }).then(function (ok) { if (ok) { IS.toast('Request sent to the front desk'); ctx.reload(); } }); } }, 'Request'); } }] }));
      }
      function histTab(p, s) {
        p.appendChild(el('h4', null, 'Food orders')); p.appendChild(IS.table({ rows: s.orders, empty: 'No orders yet', columns: [{ key: 'id', label: '#' }, { key: 'created_at', label: 'Time', render: function (r) { return IS.dateTime(r.created_at); } }, { key: 'status', label: 'Status', render: function (r) { return IS.badge(r.status); } }, { key: 'total', label: 'Total', align: 'right', render: function (r) { return IS.money(r.total); } }] }));
        p.appendChild(el('h4', { class: 'mt-2' }, 'Service requests')); p.appendChild(IS.table({ rows: s.requests, empty: 'No requests yet', columns: [{ key: 'name', label: 'Service' }, { key: 'created_at', label: 'Time', render: function (r) { return IS.dateTime(r.created_at); } }, { key: 'status', label: 'Status', render: function (r) { return IS.badge(r.status); } }, { key: 'amount', label: 'Amount', align: 'right', render: function (r) { return IS.money(r.amount); } }] }));
      }
    }
  };

  /* ============================================================ feedback & complaints */
  IS.pages.feedback = {
    title: 'Feedback & Complaints',
    render: function (root, ctx) {
      return Promise.all([IS.get('/api/customer/feedback'), IS.get('/api/customer/bookings')]).then(function (res) {
        var items = res[0].items, bookings = res[1].bookings.filter(function (b) { return ['Checked-in', 'Checked-out'].indexOf(b.status) >= 0; });
        var add = el('button', { class: 'btn btn-primary', onclick: function () {
          if (!bookings.length) { IS.toast('You can give feedback after checking in to a stay.', 'info'); return; }
          var sel = el('select', { class: 'select' }, bookings.map(function (b) { return el('option', { value: b.id }, b.booking_ref + ' · ' + b.hotel + ' · ' + IS.date(b.check_in)); }));
          var go = el('button', { class: 'btn btn-primary' }, 'Continue'), m = IS.modal({ title: 'Which stay?', size: 'sm', body: sel, footer: [go] });
          go.addEventListener('click', function () { var b = bookings.filter(function (x) { return String(x.id) === sel.value; })[0]; m.close(); setTimeout(function () { feedbackModal(b, function () { ctx.reload(); }); }, 200); });
        } }, IS.icon('plus', 16), 'New feedback');
        root.appendChild(IS.pageHeader('Feedback & complaints', 'Tell us how we did – hotels respond to every complaint', [add]));
        if (!items.length) { root.appendChild(el('div', { class: 'card' }, IS.empty('No feedback yet', 'chat'))); return; }
        root.appendChild(el('div', { class: 'stack' }, items.map(function (f) {
          return el('div', { class: 'card' }, el('div', { class: 'row between' }, el('b', null, f.hotel + ' · ' + f.kind), IS.badge(f.status)), f.hotel_rating ? IS.stars(f.hotel_rating) : null, el('p', null, f.comment || '—'), el('small', { class: 'muted' }, IS.dateTime(f.created_at)),
            f.admin_response ? el('div', { class: 'alert mt-1' }, IS.icon('chat', 18), el('div', null, el('b', null, 'Hotel response'), el('div', null, f.admin_response))) : null);
        })));
      });
    }
  };

  /* ============================================================ offers & rewards */
  IS.pages.offers = {
    title: 'Offers & Rewards',
    render: function (root) {
      return IS.get('/api/customer/offers').then(function (d) {
        root.appendChild(IS.pageHeader('Offers & rewards', 'Coupons, membership perks and referral rewards'));
        root.appendChild(el('div', { class: 'grid grid-3 stagger' },
          el('div', { class: 'card kpi' }, el('div', { class: 'kpi-label' }, 'Membership'), el('div', { class: 'kpi-value tier-' + d.membership.toLowerCase() }, d.membership), el('div', { class: 'kpi-sub' }, d.benefits[d.membership])),
          IS.kpi('Reward points', d.points, '1 point per ₹100 spent', 'gift'),
          el('div', { class: 'card kpi' }, el('div', { class: 'kpi-label' }, 'Your referral code'), el('div', { class: 'kpi-value' }, d.referral_code || '-'), el('div', { class: 'kpi-sub' }, 'Friends get 200 points; so do you'), d.referral_code ? el('button', { class: 'btn btn-soft btn-sm', style: { alignSelf: 'flex-start', marginTop: '6px' }, onclick: function () { copy(d.referral_code); } }, 'Copy code') : null)));
        root.appendChild(el('h3', { style: { margin: '24px 0 12px' } }, 'Available coupons'));
        root.appendChild(el('div', { class: 'grid grid-auto' }, d.offers.map(function (o) {
          var off = /percent|%/i.test(o.discount_type || '') ? o.value + '% off' : '₹' + IS.num(o.value) + ' off';
          return el('div', { class: 'room-card' }, el('b', null, o.title), el('div', { class: 'muted small' }, off + (o.min_amount ? ' · min ' + IS.money(o.min_amount) : '') + (o.hotel ? ' · ' + o.hotel : ' · all hotels')), IS.badge(o.kind || 'General', o.kind || 'General', 'sky'),
            el('div', { class: 'row between mt-1' }, el('code', null, o.code), el('button', { class: 'btn btn-soft btn-sm', onclick: function () { copy(o.code); } }, 'Copy')), el('small', { class: 'muted' }, o.valid_to ? 'Valid till ' + IS.date(o.valid_to, true) : ''));
        })));
      });
    }
  };

  /* ============================================================ profile & documents */
  IS.pages.profile = {
    title: 'My Profile',
    render: function (root, ctx) {
      return IS.get('/api/customer/profile').then(function (d) {
        var g = d.guest;
        root.appendChild(IS.pageHeader('My profile', 'Your details, emergency contact and ID proofs'));
        var f = [{ name: 'full_name', label: 'Full name', value: g.full_name }, { name: 'gender', label: 'Gender', type: 'select', options: ['', 'Male', 'Female', 'Other'], value: g.gender || '' }, { name: 'dob', label: 'Date of birth', type: 'date', value: g.dob || '' },
          { name: 'emergency_name', label: 'Emergency contact', value: g.emergency_name || '' }, { name: 'emergency_phone', label: 'Emergency phone', type: 'tel', value: g.emergency_phone || '' }, { name: 'address', label: 'Address', value: g.address || '' },
          { name: 'preferences', label: 'Stay preferences', type: 'textarea', span: 2, value: g.preferences || '', placeholder: 'e.g. high floor, vegetarian, extra pillows' }];
        var form = el('form', { class: 'card', novalidate: true }, el('h3', { class: 'card-title' }, 'Personal details'), el('div', { class: 'form-error hidden' }), IS.formFields(f),
          el('div', { class: 'muted small mt-1' }, 'Mobile ' + (g.mobile || '-') + ' · Email ' + (g.email || '-') + ' · Member since ' + IS.date(g.created_at, true)), el('div', { class: 'mt-1' }, el('button', { class: 'btn btn-primary', type: 'submit' }, 'Save profile')));
        form.addEventListener('submit', function (e) {
          e.preventDefault(); var err = form.querySelector('.form-error'); err.classList.add('hidden');
          IS.busy(form.querySelector('button'), function () { return IS.put('/api/customer/profile', IS.readForm(form, f)); }).then(function () { IS.toast('Profile saved'); }, function (er) { err.textContent = er.message; err.classList.remove('hidden'); });
        });
        root.appendChild(form);
        var docs = el('div', { class: 'card mt-2' });
        function paintDocs(list) {
          IS.clear(docs); docs.appendChild(el('div', { class: 'row between' }, el('h3', { class: 'card-title' }, 'ID proofs'), el('button', { class: 'btn btn-outline btn-sm', onclick: function () {
            IS.formModal({ title: 'Add ID proof', fields: [{ name: 'doc_type', label: 'Type', type: 'select', options: ['Aadhaar', 'Passport', 'Driving License', 'Voter ID', 'Other'] }, { name: 'doc_number', label: 'Document number' }], submitLabel: 'Add',
              onSubmit: function (v) { return IS.post('/api/customer/documents', v); } }).then(function (ok) { if (ok) { IS.toast('Document added'); ctx.reload(); } }); } }, IS.icon('plus', 15), 'Add')));
          docs.appendChild(IS.table({ rows: list, empty: 'No documents yet – add one to speed up check-in', columns: [{ key: 'doc_type', label: 'Type' }, { key: 'doc_number', label: 'Number', render: function (r) { return '•••• ' + String(r.doc_number).slice(-4); } },
            { key: 'verified', label: 'Status', render: function (r) { return r.verified ? IS.badge('verified', 'Verified') : IS.badge('pending', 'Pending'); } },
            { key: 'id', label: '', render: function (r) { return el('button', { class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Remove', onclick: function () { IS.confirm('Remove this document?', { danger: true }).then(function (ok) { if (ok) IS.del('/api/customer/documents/' + r.id).then(function () { ctx.reload(); }, IS.err); }); } }, IS.icon('trash', 16)); } }] }));
        }
        paintDocs(d.documents); root.appendChild(docs);
      });
    }
  };
})();
