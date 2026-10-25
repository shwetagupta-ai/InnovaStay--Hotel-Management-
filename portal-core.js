/* Portal shell: sidebar, top bar, notifications, user menu, hash router.
 *
 * Pages register themselves:   IS.pages.rooms = { title: 'Rooms', render: function (root, ctx) { ... return promise|undefined } }
 * A portal starts the shell:   IS.portal.start({ portal:'admin', subtitle:'Hotel Admin', nav:[...], home:'dashboard', search:true })
 *
 * ctx passed to render():  { user, params:['12'], query:{tab:'x'}, go(path), setBadge(pageId,n), reload() }
 * Routes look like  #/reservations/12?tab=bills  -> page 'reservations', params ['12'], query {tab:'bills'}.
 */
(function () {
  'use strict';
  var IS = window.IS, el = IS.el;
  IS.pages = IS.pages || {};

  IS.portal = {
    start: function (cfg) {
      IS.get('/api/auth/me', null, { noRedirect: true }).then(function (r) { boot(cfg, r.user); }, function (e) {
        location.replace('/login.html?portal=' + cfg.portal + '&next=' + encodeURIComponent(location.pathname));
      });
    }
  };

  function boot(cfg, user) {
    var HOME = { customer: 'customer', admin: 'admin', staff: 'staff', platform_admin: 'platform' };
    var myPortal = user.portal === 'platform_admin' ? 'platform' : user.portal;
    if (myPortal !== cfg.portal) { location.replace('/dashboard/' + myPortal); return; }
    document.title = (cfg.title || 'Dashboard') + ' | InnovaStay';

    var app = document.getElementById('app'); IS.clear(app);
    var navEl = el('nav', { 'aria-label': 'Main navigation' });
    var items = cfg.nav.filter(function (n) { return !n.roles || n.roles.indexOf(user.role) >= 0; });
    var lastGroup = null, navButtons = {};
    items.forEach(function (n) {
      if (n.group && n.group !== lastGroup) { navEl.appendChild(el('div', { class: 'nav-group' }, n.group)); lastGroup = n.group; }
      var b = el('a', { class: 'nav-item', href: '#/' + n.id, 'data-page': n.id }, IS.icon(n.icon || 'dashboard', 19), el('span', null, n.label));
      navButtons[n.id] = b; navEl.appendChild(b);
    });

    var sidebar = el('aside', { class: 'sidebar' },
      el('a', { class: 'brand', href: '/' }, el('img', { src: '/assets/img/logo.svg', alt: '' }), el('div', null, el('b', null, 'InnovaStay'), el('small', null, cfg.subtitle || 'Dashboard'))),
      navEl,
      el('div', { class: 'sidebar-foot' }, el('div', { class: 'side-user' }, el('div', { class: 'avatar' }, IS.initials(user.full_name)), el('div', { class: 'grow' }, el('b', { style: { fontSize: '14px' } }, user.full_name), el('small', null, user.role === 'platform_admin' ? 'Platform admin' : user.role + (user.hotel_name ? ' · ' + user.hotel_name : ''))))));

    var title = el('div', { class: 'crumb' }, cfg.title || '');
    var content = el('main', { class: 'content', id: 'content' });
    var bell = bellWidget(), menu = userMenu(user, cfg), search = cfg.search ? searchBox(user) : null;
    var top = el('header', { class: 'topbar' },
      el('button', { class: 'btn btn-ghost btn-icon menu-btn', 'aria-label': 'Open menu', onclick: function () { appEl.classList.toggle('nav-open'); } }, IS.icon('menu', 22)),
      title, el('div', { class: 'spacer' }), search, IS.theme.button(), bell.el, menu.el);
    var appEl = el('div', { class: 'app' }, sidebar, el('div', { class: 'main' }, top, content), el('div', { class: 'scrim', onclick: function () { appEl.classList.remove('nav-open'); } }));
    app.appendChild(appEl);
    navEl.addEventListener('click', function (e) { if (e.target.closest('.nav-item')) appEl.classList.remove('nav-open'); });

    if (user.must_change_password) { IS.changePasswordModal(true); return; }

    var token = 0, current = null;
    function parse() {
      var h = location.hash.replace(/^#\/?/, ''), q = {}, qi = h.indexOf('?');
      if (qi >= 0) { h.slice(qi + 1).split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); }); h = h.slice(0, qi); }
      var parts = h.split('/').filter(Boolean).map(decodeURIComponent);
      return { id: parts[0] || cfg.home, params: parts.slice(1), query: q };
    }
    var ctx = {
      user: user,
      go: function (path) { location.hash = '#/' + path; },
      reload: function () { route(true); },
      setBadge: function (id, n) { var b = navButtons[id]; if (!b) return; var c = b.querySelector('.count'); if (c) c.remove(); if (n > 0) b.appendChild(el('span', { class: 'count' }, n > 99 ? '99+' : n)); },
      refreshNotifications: function () { bell.load(); }
    };
    function route(force) {
      var r = parse(), page = IS.pages[r.id];
      var allowed = items.some(function (n) { return n.id === r.id; });
      if (!page || !allowed) { if (r.id !== cfg.home) { location.replace('#/' + cfg.home); return; } }
      var sig = location.hash;
      if (!force && current === sig) return; current = sig;
      Object.keys(navButtons).forEach(function (k) { navButtons[k].classList.toggle('active', k === r.id); });
      var meta = items.filter(function (n) { return n.id === r.id; })[0] || {};
      title.textContent = (page && page.title) || meta.label || ''; document.title = title.textContent + ' | InnovaStay';
      var my = ++token, root = el('div', { class: 'page' }, IS.loading(5));
      IS.clear(content); content.appendChild(root); window.scrollTo({ top: 0 });
      var c = Object.assign({}, ctx, { params: r.params, query: r.query });
      Promise.resolve().then(function () { IS.clear(root); return page.render(root, c); }).then(function () { if (my === token) IS.countUp(root); }).catch(function (e) {
        if (my !== token) return; IS.clear(root);
        root.appendChild(el('div', { class: 'card' }, IS.errorBox(e), el('div', { class: 'mt-2' }, el('button', { class: 'btn btn-outline btn-sm', onclick: function () { route(true); } }, 'Try again'))));
        if (!(e instanceof IS.ApiError)) console.error(e);
      });
    }
    window.addEventListener('hashchange', function () { route(false); });
    route(true);
    bell.load(); setInterval(function () { if (!document.hidden) bell.load(); }, 45000);
    if (cfg.onReady) cfg.onReady(ctx);
  }

  /* ---------- notifications bell ---------- */
  function bellWidget() {
    var badge = el('span', { class: 'dot-count hidden' }), dd = el('div', { class: 'dropdown notif hidden' });
    var btn = el('button', { class: 'btn btn-ghost btn-icon', 'aria-label': 'Notifications', type: 'button' }, IS.icon('bell', 20), badge);
    var wrap = el('div', { class: 'bell', style: { position: 'relative' } }, btn, dd);
    var items = [];
    function paint() {
      IS.clear(dd);
      dd.appendChild(el('div', { class: 'row between', style: { padding: '12px 16px', borderBottom: '1px solid var(--border)' } }, el('b', null, 'Notifications'),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: function () { IS.post('/api/notifications/read', {}).then(load); } }, 'Mark all read')));
      if (!items.length) dd.appendChild(IS.empty('You are all caught up', 'bell'));
      items.forEach(function (n) {
        dd.appendChild(el('div', { class: 'notif-item' + (n.is_read ? '' : ' unread'), onclick: function () { if (!n.is_read) IS.post('/api/notifications/read', { id: n.id }).then(load); } },
          el('div', { class: 'grow' }, el('b', null, n.title), n.message ? el('span', null, n.message) : null, el('time', null, IS.ago(n.created_at)))));
      });
    }
    function load() {
      return IS.get('/api/notifications', null, { noRedirect: true }).then(function (d) {
        items = d.items || []; badge.textContent = d.unread > 9 ? '9+' : d.unread; badge.classList.toggle('hidden', !d.unread); paint();
      }, function () { /* silent */ });
    }
    btn.addEventListener('click', function (e) { e.stopPropagation(); dd.classList.toggle('hidden'); });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) dd.classList.add('hidden'); });
    return { el: wrap, load: load };
  }

  /* ---------- user menu ---------- */
  function userMenu(user, cfg) {
    var dd = el('div', { class: 'dropdown menu hidden' });
    function item(icon, label, fn) { return el('button', { class: 'dd-item', type: 'button', onclick: function () { dd.classList.add('hidden'); fn(); } }, IS.icon(icon, 18), label); }
    dd.appendChild(el('div', { style: { padding: '10px 12px' } }, el('b', null, user.full_name), el('div', { class: 'small muted' }, user.email || user.mobile || user.username)));
    dd.appendChild(el('hr'));
    if (cfg.profilePage) dd.appendChild(item('user', 'My profile', function () { location.hash = '#/' + cfg.profilePage; }));
    dd.appendChild(item('lock', 'Change password', function () { IS.changePasswordModal(false); }));
    dd.appendChild(item('shield', 'Account security', IS.securityModal));
    dd.appendChild(el('hr'));
    dd.appendChild(item('logout', 'Log out', IS.logout));
    var btn = el('button', { class: 'user-btn', type: 'button', 'aria-label': 'Account menu' }, el('div', { class: 'avatar' }, IS.initials(user.full_name)), el('span', { class: 'nm' }, user.full_name.split(' ')[0]), IS.icon('chevdown', 16));
    var wrap = el('div', { class: 'user-menu' }, btn, dd);
    btn.addEventListener('click', function (e) { e.stopPropagation(); dd.classList.toggle('hidden'); });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) dd.classList.add('hidden'); });
    return { el: wrap };
  }

  /* ---------- global search (hotel portals) ---------- */
  function searchBox() {
    var input = el('input', { class: 'input', type: 'search', placeholder: 'Search booking, guest, room...', 'aria-label': 'Search', autocomplete: 'off' });
    var dd = el('div', { class: 'dropdown hidden' }), wrap = el('div', { class: 'gsearch' }, el('span', { class: 'ico' }, IS.icon('search', 18)), input, dd);
    function row(icon, main, sub, path) { return el('button', { class: 'dd-item', type: 'button', onclick: function () { dd.classList.add('hidden'); input.value = ''; location.hash = '#/' + path; } }, IS.icon(icon, 17), el('div', null, main, sub ? el('small', null, sub) : null)); }
    var run = IS.debounce(function () {
      var q = input.value.trim(); if (q.length < 2) { dd.classList.add('hidden'); return; }
      IS.get('/api/hotel/search', { q: q }).then(function (d) {
        IS.clear(dd); var any = false;
        if (d.reservations.length) { any = true; dd.appendChild(el('div', { class: 'dd-head' }, 'Reservations')); d.reservations.forEach(function (x) { dd.appendChild(row('calendar', x.booking_ref + ' · ' + x.guest_name, IS.date(x.check_in) + ' → ' + IS.date(x.check_out) + ' · ' + IS.title(x.status), 'reservations/' + x.id)); }); }
        if (d.guests.length) { any = true; dd.appendChild(el('div', { class: 'dd-head' }, 'Guests')); d.guests.forEach(function (x) { dd.appendChild(row('user', x.full_name, (x.mobile || '') + ' · ' + IS.title(x.membership), 'guests/' + x.id)); }); }
        if (d.rooms.length) { any = true; dd.appendChild(el('div', { class: 'dd-head' }, 'Rooms')); d.rooms.forEach(function (x) { dd.appendChild(row('bed', 'Room ' + x.room_number, x.type_name + ' · floor ' + x.floor + ' · ' + IS.title(x.status), 'rooms/' + x.id)); }); }
        if (!any) dd.appendChild(IS.empty('No results for "' + q + '"', 'search'));
        dd.classList.remove('hidden');
      }, function () { /* ignore */ });
    }, 280);
    input.addEventListener('input', run);
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) dd.classList.add('hidden'); });
    return wrap;
  }
})();
