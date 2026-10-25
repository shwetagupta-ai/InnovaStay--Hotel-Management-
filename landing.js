/* Landing page behaviour: navbar, search filter, results, destinations, offers, reviews, scroll animations. */
(function () {
  'use strict';
  var IS = window.IS, el = IS.el, $ = IS.$;
  document.documentElement.classList.remove('no-js'); document.body.classList.remove('no-js');

  /* ---- icons in static markup ---- */
  IS.$$('i[data-i]').forEach(function (n) { n.replaceWith(IS.icon(n.getAttribute('data-i'), 18)); });
  IS.$$('.dropdown-panel a i, .dropdown-panel a .icon').forEach(function (n) { n.style.flex = 'none'; });
  $('#themeSlot').appendChild(IS.theme.button('btn btn-ghost btn-icon theme-btn'));

  /* ---- navbar ---- */
  var nav = $('#nav');
  function onScroll() { nav.classList.toggle('scrolled', window.scrollY > 24); }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  var burger = $('#burger'), links = $('#navLinks');
  burger.addEventListener('click', function () { var o = links.classList.toggle('open'); burger.setAttribute('aria-expanded', o); });
  links.addEventListener('click', function (e) { if (e.target.tagName === 'A') links.classList.remove('open'); });
  var loginMenu = $('#loginMenu'), loginBtn = $('#loginBtn');
  loginBtn.addEventListener('click', function (e) { e.stopPropagation(); var o = loginMenu.classList.toggle('open'); loginBtn.setAttribute('aria-expanded', o); });
  document.addEventListener('click', function (e) { if (!loginMenu.contains(e.target)) { loginMenu.classList.remove('open'); loginBtn.setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') loginMenu.classList.remove('open'); });

  /* ---- scroll reveal ---- */
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.12 }) : null;
  function watch(root) { IS.$$('.reveal:not(.in)', root).forEach(function (n) { if (io) io.observe(n); else n.classList.add('in'); }); }
  watch(document);

  /* ---- price range slider ---- */
  var fMin = $('#fMin'), fMax = $('#fMax'), fill = $('#rangeFill'), label = $('#priceLabel');
  function paintRange() {
    var a = +fMin.value, b = +fMax.value, top = +fMax.max;
    if (a > b) { if (this === fMin) { fMin.value = b; a = b; } else { fMax.value = a; b = a; } }
    fill.style.left = (a / top * 100) + '%'; fill.style.right = (100 - b / top * 100) + '%';
    label.textContent = '₹' + IS.num(a) + ' – ' + (b >= top ? '₹' + IS.num(top) + '+' : '₹' + IS.num(b));
  }
  fMin.addEventListener('input', paintRange); fMax.addEventListener('input', paintRange); paintRange();

  /* ---- guests stepper ---- */
  var fGuests = $('#fGuests');
  $('#gMinus').addEventListener('click', function () { fGuests.value = Math.max(1, (+fGuests.value || 1) - 1); });
  $('#gPlus').addEventListener('click', function () { fGuests.value = Math.min(12, (+fGuests.value || 1) + 1); });

  /* ---- optional dates ---- */
  var moreBtn = $('#moreBtn'), dates = $('#dates'), fIn = $('#fIn'), fOut = $('#fOut');
  fIn.min = IS.today(); fOut.min = IS.addDays(IS.today(), 1);
  moreBtn.addEventListener('click', function () {
    var open = dates.classList.toggle('hidden') === false; moreBtn.setAttribute('aria-expanded', open);
    moreBtn.textContent = open ? '− Hide dates' : '+ Add dates for live availability & exact prices';
    if (open && !fIn.value) { fIn.value = IS.addDays(IS.today(), 1); fOut.value = IS.addDays(IS.today(), 2); }
  });
  fIn.addEventListener('change', function () { if (fIn.value) { fOut.min = IS.addDays(fIn.value, 1); if (!fOut.value || fOut.value <= fIn.value) fOut.value = IS.addDays(fIn.value, 1); } });

  /* ---- meta (cities, types, stats) ---- */
  var cities = [];
  IS.get('/api/public/meta').then(function (m) {
    cities = m.cities;
    m.cities.forEach(function (c) { $('#fCity').appendChild(el('option', { value: c }, c)); });
    m.room_types.forEach(function (t) { $('#fType').appendChild(el('option', { value: t.name }, t.name)); });
    setCount('#stHotels', m.stats.hotels); setCount('#stRooms', m.stats.rooms); setCount('#stGuests', m.stats.guests);
    var g = $('#destGrid'); IS.clear(g);
    m.cities.forEach(function (c, i) {
      g.appendChild(el('button', { class: 'dest reveal', type: 'button', style: { '--img': 'url(/assets/img/hotel-' + ((i % 5) + 1) + '.svg)', textAlign: 'left' }, onclick: function () { $('#fCity').value = c; run(true); } },
        el('b', null, c), el('small', null, 'Explore stays →')));
    });
    watch(g);
  }).catch(function () { /* page still works without meta */ });
  function setCount(sel, n) { var b = $(sel); b.setAttribute('data-count', n); b.textContent = IS.num(n); IS.countUp(b.parentNode); }

  /* ---- search + results ---- */
  var results = $('#results'), lastHotels = [], lastQuery = {};
  function skeleton() { IS.clear(results); for (var i = 0; i < 3; i++) results.appendChild(el('div', { class: 'sk skeleton' })); }
  function params() {
    var p = { city: $('#fCity').value, type: $('#fType').value, guests: fGuests.value, sort: $('#fSort').value };
    if (+fMin.value > 0) p.min = fMin.value;
    if (+fMax.value < +fMax.max) p.max = fMax.value;
    if (!dates.classList.contains('hidden') && fIn.value && fOut.value) { p.checkin = fIn.value; p.checkout = fOut.value; }
    return p;
  }
  function run(scroll) {
    var p = params(); lastQuery = p; skeleton();
    var filtered = p.city || p.type || p.min || p.max || p.checkin;
    $('#resultsTitle').textContent = filtered ? 'Search results' : 'Featured stays';
    IS.get('/api/public/search', p).then(function (d) {
      lastHotels = d.hotels;
      $('#resultsTitle').textContent = (filtered ? 'Search results' : 'Featured stays') + ' · ' + d.count + ' hotel' + (d.count === 1 ? '' : 's');
      render();
      if (scroll) $('#search').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, function (e) { IS.clear(results); results.appendChild(el('div', { class: 'none' }, el('h3', null, 'Search unavailable'), e.message)); });
  }
  function render() {
    IS.clear(results);
    var list = lastHotels.slice(), s = $('#fSort').value;
    list.sort(s === 'rating' ? function (a, b) { return b.rating - a.rating; } : s === 'price_desc' ? function (a, b) { return b.from_price - a.from_price; } : function (a, b) { return a.from_price - b.from_price; });
    if (!list.length) { results.appendChild(el('div', { class: 'none' }, el('h3', null, 'No rooms match these filters'), el('p', null, 'Try a wider price range, another city or different dates.'))); return; }
    list.forEach(function (h, i) {
      var tags = h.tags && h.tags.length ? h.tags[0] : (h.rooms_available + ' rooms left');
      results.appendChild(el('article', { class: 'hcard reveal' },
        el('div', { class: 'pic' }, el('img', { src: '/assets/img/hotel-' + ((h.id % 5) + 1) + '.svg', alt: h.name, loading: 'lazy' }), el('span', { class: 'tag' }, tags),
          el('span', { class: 'rate' }, IS.icon('star', 14), String(h.rating))),
        el('div', { class: 'body' },
          el('h3', null, h.name), el('div', { class: 'loc' }, IS.icon('mappin', 15), h.city + ' · ' + '★'.repeat(h.stars || 4)),
          el('div', { class: 'types' }, h.types.map(function (t) { return IS.badge(t, t, 'blue'); })),
          el('p', { class: 'desc' }, (h.amenities || []).join(' · ') || 'Comfortable rooms with modern amenities'),
          el('div', { class: 'foot' }, el('div', { class: 'price' }, el('b', null, IS.money(h.from_price)), el('small', null, 'per night · from')),
            el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: function () { openHotel(h); } }, 'View rooms')))));
    });
    watch(results);
  }

  /* ---- hotel details modal with bookable rooms ---- */
  function openHotel(h) {
    var p = { guests: lastQuery.guests, checkin: lastQuery.checkin, checkout: lastQuery.checkout, type: lastQuery.type };
    var body = el('div', null, IS.loading(3));
    var m = IS.modal({ title: h.name + ' · ' + h.city, body: body, size: 'xl' });
    IS.get('/api/public/hotels/' + h.id, p).then(function (d) {
      var ci = d.checkin, co = d.checkout, n = IS.nights(ci, co);
      var root = el('div', { class: 'stack' });
      root.appendChild(el('p', { class: 'muted', style: { margin: 0 } }, (d.hotel.description || '') + ' ' + (d.hotel.address || '')));
      root.appendChild(el('div', { class: 'alert' }, IS.icon('info', 18), el('div', null, 'Prices for ' + IS.date(ci) + ' → ' + IS.date(co) + ' (' + n + ' night' + (n > 1 ? 's' : '') + ', ' + d.guests + ' guest' + (d.guests > 1 ? 's' : '') + '). Add dates in the search bar for exact availability.')));
      if (!d.rooms.length) root.appendChild(IS.empty('No rooms free for these dates', 'bed'));
      else root.appendChild(IS.table({ rows: d.rooms.slice(0, 30), columns: [
        { key: 'room_no', label: 'Room', render: function (r) { return el('b', null, r.room_no); } },
        { key: 'type', label: 'Type', render: function (r) { return IS.badge(r.type, r.type, 'blue'); } },
        { key: 'capacity', label: 'Sleeps' },
        { key: 'amenities', label: 'Amenities', render: function (r) { return r.amenities.slice(0, 4).join(', '); } },
        { key: 'avg_price', label: 'Per night', align: 'right', render: function (r) { return IS.money(r.avg_price); } },
        { key: 'total_price', label: 'Total', align: 'right', render: function (r) { return el('b', null, IS.money(r.total_price)); } },
        { key: 'id', label: '', render: function (r) { return el('a', { class: 'btn btn-primary btn-sm', href: '/login.html?portal=customer&next=' + encodeURIComponent('/dashboard/customer#/book?room=' + r.id + '&in=' + ci + '&out=' + co + '&guests=' + d.guests) }, 'Book'); } }] }));
      if (d.reviews.length) {
        root.appendChild(el('h3', { style: { margin: '8px 0 0' } }, 'Guest reviews'));
        d.reviews.forEach(function (r) { root.appendChild(el('div', { class: 'card' }, IS.stars(r.rating), el('p', { style: { margin: '6px 0' } }, r.comment), el('small', { class: 'muted' }, r.name + ' · ' + IS.date(r.date)))); });
      }
      root.appendChild(el('p', { class: 'small muted' }, 'You need a free customer account to book. ', el('a', { href: '/login.html?portal=customer&mode=register' }, 'Create one in 30 seconds →')));
      body.replaceWith(root);
    }, function (e) { IS.clear(body); body.appendChild(IS.errorBox(e)); });
    return m;
  }

  $('#searchForm').addEventListener('submit', function (e) { e.preventDefault(); run(true); });
  $('#fSort').addEventListener('change', render);

  /* ---- offers ---- */
  IS.get('/api/public/offers').then(function (d) {
    var g = $('#offerGrid'); IS.clear(g);
    if (!d.offers.length) { g.appendChild(IS.empty('New offers are coming soon', 'gift')); return; }
    d.offers.forEach(function (o) {
      var off = /percent|%/i.test(o.discount_type || '') ? o.value + '% off' : '₹' + IS.num(o.value) + ' off';
      var code = el('button', { class: 'code', type: 'button', title: 'Copy code', onclick: function () {
        if (navigator.clipboard) navigator.clipboard.writeText(o.code).then(function () { IS.toast('Code ' + o.code + ' copied', 'success'); }, function () { IS.toast('Code: ' + o.code, 'info'); }); else IS.toast('Code: ' + o.code, 'info'); } }, IS.icon('tag', 16), o.code);
      g.appendChild(el('article', { class: 'offer reveal' }, el('h3', null, o.title), el('p', null, off + (o.min_amount ? ' on bookings above ' + IS.money(o.min_amount) : '') + (o.hotel ? ' at ' + o.hotel : ' at all hotels')), code,
        el('small', null, o.valid_to ? 'Valid till ' + IS.date(o.valid_to, true) : 'No expiry')));
    });
    watch(g);
  }, function () { IS.clear($('#offerGrid')); });

  /* ---- reviews + stats rating ---- */
  IS.get('/api/public/testimonials').then(function (d) {
    var g = $('#revGrid'); IS.clear(g);
    if (!d.items.length) { g.appendChild(IS.empty('Be the first to review your stay', 'heart')); return; }
    var sum = 0; d.items.forEach(function (r) { sum += r.rating; });
    $('#stRating').textContent = (sum / d.items.length).toFixed(1) + ' ★';
    d.items.forEach(function (r) {
      g.appendChild(el('article', { class: 'rev reveal' }, IS.stars(r.rating), el('p', null, '“' + r.comment + '”'),
        el('div', { class: 'who' }, el('div', { class: 'avatar' }, IS.initials(r.name)), el('div', null, el('b', null, r.name), el('small', null, r.hotel)))));
    });
    watch(g);
  }, function () { IS.clear($('#revGrid')); });

  run(false);
})();
