/* InnovaStay shared front-end toolkit (plain JavaScript, no build step).
 * Everything lives on the global `IS` object:
 *   IS.el, IS.icon, IS.api/get/post/put/del, IS.toast, IS.modal, IS.confirm, IS.formModal, IS.table, IS.tabs,
 *   IS.pager, IS.badge, IS.money, IS.date, IS.dateTime, IS.stars, IS.chart.*, IS.theme, IS.pageHeader, IS.empty, IS.loading
 */
(function () {
  'use strict';
  var IS = window.IS = window.IS || {};

  /* ------------------------------------------------------------ DOM helper */
  // IS.el('div', {class:'card', onclick: fn, dataset:{id:1}}, 'text', childNode, [more children])
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k === 'html') node.innerHTML = v;          // only ever used with trusted, escaped markup
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'value') node.value = v;
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }
  function append(node, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(node, k); }); return; }
    node.appendChild(kid && kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  IS.el = el;
  IS.$ = function (sel, root) { return (root || document).querySelector(sel); };
  IS.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  IS.clear = function (node) { while (node.firstChild) node.removeChild(node.firstChild); return node; };
  IS.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  IS.debounce = function (fn, ms) { var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms || 300); }; };

  /* ------------------------------------------------------------ icons (24x24 stroke icons) */
  var P = {
    home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
    dashboard: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
    calendar: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
    users: 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 20v-2a4 4 0 0 0-3-3.9M16 2.1a4 4 0 0 1 0 7.8',
    user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
    bed: 'M3 20V6M3 14h18v6M21 14v-3a3 3 0 0 0-3-3h-8v6M7 11h.01',
    key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
    card: 'M2 5h20v14H2zM2 10h20M6 15h4',
    receipt: 'M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2zM9 7h6M9 11h6M9 15h3',
    utensils: 'M4 3v8a2 2 0 0 0 2 2h1v8M7 3v6M10 3v8a2 2 0 0 1-2 2M18 21V3c-2.5 1.5-4 4.5-4 8h4',
    broom: 'M19 3l-6 6M13 9l-8.5 8.5a2.1 2.1 0 0 0 3 3L16 12M9 12l3 3M6 15l3 3',
    wrench: 'M14.7 6.3a4 4 0 0 0 5 5L22 9l-3-3-2.3 2.3M14.7 6.3L2 19l3 3 12.7-12.7M14.7 6.3l-3-3L9.5 5.5',
    briefcase: 'M3 7h18v13H3zM8 7V4h8v3M3 13h18',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
    wallet: 'M3 7h16a2 2 0 0 1 2 2v10H5a2 2 0 0 1-2-2zM3 7l2-3h12v3M16 14h2',
    tag: 'M20 12l-8 8-9-9V3h8zM7.5 7.5h.01',
    star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
    chat: 'M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-5.5A8 8 0 1 1 21 12z',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M10 21a2 2 0 0 0 4 0',
    chart: 'M3 3v18h18M7 15l4-5 3 3 5-7',
    pie: 'M21 12A9 9 0 1 1 12 3v9zM15 3.5A9 9 0 0 1 20.5 9H15z',
    file: 'M14 2H6a2 2 0 0 0-2 2v16h16V8zM14 2v6h6M8 13h8M8 17h5',
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
    logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
    menu: 'M3 6h18M3 12h18M3 18h18',
    close: 'M18 6L6 18M6 6l12 12',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
    edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
    trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5',
    check: 'M20 6L9 17l-5-5',
    eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
    eyeoff: 'M17.9 17.9A10.9 10.9 0 0 1 12 20C5 20 1 12 1 12a18 18 0 0 1 5.1-5.9M9.9 4.2A10.7 10.7 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.2 3.2M1 1l22 22',
    sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
    mappin: 'M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
    wifi: 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01M1.5 9a15 15 0 0 1 21 0',
    qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v3M14 20h3M20 20h1',
    gift: 'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z',
    percent: 'M19 5L5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    building: 'M4 21V3h12v18M16 9h4v12M8 7h4M8 11h4M8 15h4M2 21h20',
    globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z',
    server: 'M3 4h18v6H3zM3 14h18v6H3zM7 7h.01M7 17h.01',
    activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
    refresh: 'M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8M21 4v5h-5M3 20v-5h5',
    download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
    print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
    phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z',
    mail: 'M3 5h18v14H3zM3 7l9 6 9-6',
    arrowright: 'M5 12h14M13 6l6 6-6 6',
    arrowleft: 'M19 12H5M11 6l-6 6 6 6',
    chevdown: 'M6 9l6 6 6-6',
    chevright: 'M9 6l6 6-6 6',
    alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
    car: 'M5 17h14M3 13l2-6h14l2 6v4H3zM7 17v2M17 17v2M7 13h.01M17 13h.01',
    spa: 'M12 21c-5 0-8-3-8-8 4 0 7 2 8 5 1-3 4-5 8-5 0 5-3 8-8 8zM12 18c-2-3-2-9 0-14 2 5 2 11 0 14z',
    dumbbell: 'M6.5 6.5l11 11M21 21l-1-1M3 3l1 1M18 22l4-4M2 6l4-4M3.5 8.5l5-5M15.5 20.5l5-5',
    layers: 'M12 2l10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5',
    sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
    heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z',
    inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z',
    filter: 'M22 3H2l8 9.5V19l4 2v-8.5z'
  };
  IS.icon = function (name, size, cls) {
    var s = size || 20;
    return el('span', { class: 'icon ' + (cls || ''), style: { display: 'inline-flex', width: s + 'px', height: s + 'px', flex: 'none' },
      html: '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (P[name] || P.info) + '"/></svg>' });
  };
  IS.iconHtml = function (name, size) { return IS.icon(name, size).outerHTML; };

  /* ------------------------------------------------------------ formatting */
  var inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  var inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  IS.money = function (n, forceDecimals) {
    n = Number(n); if (!isFinite(n)) n = 0;
    return (forceDecimals || Math.abs(n - Math.round(n)) > 0.004) ? inr2.format(n) : inr0.format(n);
  };
  IS.num = function (n) { return new Intl.NumberFormat('en-IN').format(Number(n) || 0); };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  IS.date = function (d, withYear) {                      // '2026-10-18' -> '18 Oct 2026'
    if (!d) return '-';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d); if (!m) return d;
    return Number(m[3]) + ' ' + MON[Number(m[2]) - 1] + (withYear === false ? '' : ' ' + m[1]);
  };
  IS.dateTime = function (ts) {                           // '2026-10-18 10:37:00' -> '18 Oct 2026, 10:37'
    if (!ts) return '-';
    var m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(ts); if (!m) return IS.date(ts);
    return IS.date(m[1]) + ', ' + m[2];
  };
  IS.ago = function (ts) {
    if (!ts) return '';
    var t = new Date(String(ts).replace(' ', 'T')).getTime(); if (isNaN(t)) return ts;
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago'; if (s < 2592000) return Math.floor(s / 86400) + ' d ago';
    return IS.date(String(ts).slice(0, 10));
  };
  IS.today = function () { var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  IS.addDays = function (iso, n) { var p = iso.split('-'); var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n); var z = function (x) { return String(x).padStart(2, '0'); }; return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); };
  IS.nights = function (a, b) { var f = function (s) { var p = s.split('-'); return Date.UTC(p[0], p[1] - 1, p[2]); }; return Math.round((f(b) - f(a)) / 86400000); };
  IS.title = function (s) { return String(s == null ? '' : s).replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); };
  IS.stars = function (n) { n = Math.round(Number(n) || 0); return el('span', { class: 'stars', title: n + ' / 5' }, '★'.repeat(n) + '☆'.repeat(5 - n)); };
  IS.initials = function (name) { return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); };

  var BADGE = {
    green: ['available', 'active', 'confirmed', 'paid', 'done', 'completed', 'resolved', 'inspected', 'approved', 'served', 'present', 'final', 'success', 'free', 'verified', 'checked_out', 'ready', 'claimed', 'in_house', 'open_ok'],
    amber: ['pending', 'draft', 'placed', 'preparing', 'waiting', 'requested', 'in_progress', 'assigned', 'todo', 'cleaning', 'half_day', 'medium', 'unpaid', 'reserved', 'normal', 'notified', 'new', 'partial', 'found', 'busy'],
    red: ['cancelled', 'no_show', 'rejected', 'absent', 'failed', 'urgent', 'high', 'suspended', 'disabled', 'out_of_service', 'blacklisted', 'void', 'locked', 'inactive', 'disposed', 'open'],
    blue: ['checked_in', 'occupied', 'online', 'walk_in', 'phone', 'qr', 'staff', 'refund', 'payment', 'booked'],
    sky: ['room_service', 'dine_in', 'takeaway', 'group', 'leave', 'low', 'evening'],
    purple: ['maintenance', 'gold', 'platinum', 'night', 'silver', 'morning', 'bronze']
  };
  var BADGE_MAP = {}; Object.keys(BADGE).forEach(function (c) { BADGE[c].forEach(function (s) { BADGE_MAP[s] = c; }); });
  IS.badge = function (status, label, forceColor) {
    var key = String(status == null ? '' : status).toLowerCase().replace(/[\s-]+/g, '_');
    var c = forceColor || BADGE_MAP[key] || 'gray';
    return el('span', { class: 'badge b-' + c }, label || IS.title(status));
  };
  IS.qs = function (obj) {
    var p = []; Object.keys(obj || {}).forEach(function (k) { var v = obj[k]; if (v !== undefined && v !== null && v !== '') p.push(encodeURIComponent(k) + '=' + encodeURIComponent(v)); });
    return p.length ? '?' + p.join('&') : '';
  };

  /* ------------------------------------------------------------ API */
  function ApiError(message, status, data) { this.name = 'ApiError'; this.message = message; this.status = status; this.data = data || {}; }
  ApiError.prototype = Object.create(Error.prototype);
  IS.ApiError = ApiError;

  IS.api = function (method, url, body, opts) {
    var init = { method: method, credentials: 'same-origin', headers: { 'X-Requested-With': 'InnovaStay', 'Accept': 'application/json' } };
    if (body !== undefined && method !== 'GET') { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch(url, init).then(function (res) {
      return res.text().then(function (t) {
        var data = {}; try { data = t ? JSON.parse(t) : {}; } catch (e) { data = { error: 'Unexpected server response' }; }
        if (!res.ok) {
          if (res.status === 401 && !(opts && opts.noRedirect) && !/\/login\.html/.test(location.pathname)) {
            IS.toast('Your session has ended. Please log in again.', 'info');
            setTimeout(function () { location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.hash); }, 900);
          }
          throw new ApiError(data.error || ('Request failed (' + res.status + ')'), res.status, data);
        }
        return data;
      });
    }, function () { throw new ApiError('Cannot reach the server. Check your connection and try again.', 0); });
  };
  IS.get = function (url, params, opts) { return IS.api('GET', url + IS.qs(params), undefined, opts); };
  IS.post = function (url, body, opts) { return IS.api('POST', url, body || {}, opts); };
  IS.put = function (url, body, opts) { return IS.api('PUT', url, body || {}, opts); };
  IS.del = function (url, opts) { return IS.api('DELETE', url, {}, opts); };

  /* ------------------------------------------------------------ toast */
  var toastStack;
  IS.toast = function (msg, type, ms) {
    if (!toastStack) { toastStack = el('div', { class: 'toast-stack', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastStack); }
    var t = el('div', { class: 'toast ' + (type || 'success') }, IS.icon(type === 'error' ? 'alert' : type === 'info' ? 'info' : 'check', 18), el('div', null, msg));
    toastStack.appendChild(t);
    var kill = function () { t.classList.add('leaving'); setTimeout(function () { t.remove(); }, 260); };
    setTimeout(kill, ms || (type === 'error' ? 6000 : 3800));
    t.addEventListener('click', kill);
  };
  IS.err = function (e) { IS.toast(e && e.message ? e.message : 'Something went wrong', 'error'); };

  /* ------------------------------------------------------------ modal */
  // IS.modal({title, body, footer:[buttons], size:'sm|lg|xl', persistent:true}) -> {el, body, close}
  IS.modal = function (o) {
    var prevFocus = document.activeElement;
    var closeBtn = o.persistent ? null : el('button', { class: 'btn btn-ghost btn-icon', 'aria-label': 'Close', onclick: function () { api.close(); } }, IS.icon('close', 18));
    var bodyEl = el('div', { class: 'modal-body' }, o.body);
    var footEl = o.footer && o.footer.length ? el('div', { class: 'modal-foot' }, o.footer) : null;
    var box = el('div', { class: 'modal ' + (o.size || ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title || 'Dialog' },
      el('div', { class: 'modal-head' }, el('h3', null, o.title || ''), closeBtn), bodyEl, footEl);
    var backdrop = el('div', { class: 'modal-backdrop' }, box);
    var api = {
      el: box, body: bodyEl, foot: footEl,
      close: function () {
        if (api.closed) return; api.closed = true;
        document.removeEventListener('keydown', onKey);
        backdrop.classList.add('closing');
        setTimeout(function () { backdrop.remove(); if (!document.querySelector('.modal-backdrop')) document.body.style.overflow = ''; }, 150);
        if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* ignore */ }
        if (o.onClose) o.onClose();
      },
      setBody: function (n) { IS.clear(bodyEl); append(bodyEl, n); }
    };
    function onKey(e) { if (e.key === 'Escape' && !o.persistent && backdrop === lastBackdrop()) api.close(); }
    function lastBackdrop() { var all = document.querySelectorAll('.modal-backdrop'); return all[all.length - 1]; }
    backdrop.addEventListener('mousedown', function (e) { if (e.target === backdrop && !o.persistent) api.close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop); document.body.style.overflow = 'hidden';
    var first = box.querySelector('input:not([type=hidden]),select,textarea'); if (first && !o.noFocus) setTimeout(function () { try { first.focus(); } catch (e) { /* ignore */ } }, 60);
    return api;
  };
  IS.confirm = function (message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var m;
      var yes = el('button', { class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary'), onclick: function () { resolve(true); m.close(); } }, opts.confirmLabel || 'Confirm');
      var no = el('button', { class: 'btn btn-outline', onclick: function () { m.close(); } }, opts.cancelLabel || 'Cancel');
      m = IS.modal({ title: opts.title || 'Please confirm', size: 'sm', body: el('p', { style: { margin: 0 } }, message), footer: [no, yes], onClose: function () { resolve(false); } });
    });
  };
  // Button that shows a spinner while an async handler runs.
  IS.busy = function (btn, promiseFn) {
    if (btn.classList.contains('is-loading')) return Promise.resolve();
    btn.classList.add('is-loading');
    return Promise.resolve().then(promiseFn).then(function (v) { btn.classList.remove('is-loading'); return v; }, function (e) { btn.classList.remove('is-loading'); throw e; });
  };

  /* ------------------------------------------------------------ forms */
  // field: {name,label,type:'text|email|number|date|time|tel|password|select|textarea|checkbox|hidden', options:[{value,label}]|['a','b'],
  //         required, placeholder, value, help, span:2, min, max, step, maxlength, rows, readonly}
  IS.field = function (f, values) {
    var v = values && values[f.name] !== undefined && values[f.name] !== null ? values[f.name] : (f.value !== undefined ? f.value : '');
    var ctl, id = 'f_' + f.name + '_' + Math.random().toString(36).slice(2, 6);
    if (f.type === 'select') {
      ctl = el('select', { class: 'select', name: f.name, id: id }, (f.options || []).map(function (o) {
        o = typeof o === 'object' ? o : { value: o, label: IS.title(o) };
        return el('option', { value: o.value, selected: String(o.value) === String(v) }, o.label);
      }));
    } else if (f.type === 'textarea') {
      ctl = el('textarea', { class: 'textarea', name: f.name, id: id, rows: f.rows || 3, maxlength: f.maxlength, placeholder: f.placeholder, readonly: f.readonly }); ctl.value = v;
    } else if (f.type === 'checkbox') {
      ctl = el('label', { class: 'check' }, el('input', { type: 'checkbox', name: f.name, checked: !!Number(v) || v === true }), f.label);
      return el('div', { class: 'field' + (f.span === 2 ? ' span-2' : '') }, ctl, f.help ? el('div', { class: 'help' }, f.help) : null);
    } else if (f.type === 'hidden') {
      return el('input', { type: 'hidden', name: f.name, value: v });
    } else {
      ctl = el('input', { class: 'input', type: f.type || 'text', name: f.name, id: id, placeholder: f.placeholder, min: f.min, max: f.max, step: f.step, maxlength: f.maxlength, readonly: f.readonly, autocomplete: f.autocomplete || 'off', inputmode: f.inputmode });
      ctl.value = v;
    }
    if (f.required) ctl.setAttribute('required', '');
    return el('div', { class: 'field' + (f.span === 2 ? ' span-2' : '') }, el('label', { for: id }, f.label + (f.required ? ' *' : '')), ctl, f.help ? el('div', { class: 'help' }, f.help) : null);
  };
  IS.formFields = function (fields, values) { return el('div', { class: 'form-grid' }, fields.map(function (f) { return IS.field(f, values); })); };
  IS.readForm = function (root, fields) {
    var out = {};
    fields.forEach(function (f) {
      var c = root.querySelector('[name="' + f.name + '"]'); if (!c) return;
      if (f.type === 'checkbox') out[f.name] = c.checked ? 1 : 0;
      else if (f.type === 'number') out[f.name] = c.value === '' ? null : Number(c.value);
      else out[f.name] = typeof c.value === 'string' ? c.value.trim() : c.value;
    });
    return out;
  };
  // Opens a modal with a form. onSubmit(data) may return a promise; on success the modal closes and the promise resolves with its result.
  IS.formModal = function (o) {
    return new Promise(function (resolve) {
      var form = el('form', { novalidate: true });
      var errBox = el('div', { class: 'form-error hidden' });
      form.appendChild(errBox); form.appendChild(IS.formFields(o.fields, o.values));
      if (o.note) form.appendChild(el('div', { class: 'help mt-1' }, o.note));
      var submit = el('button', { class: 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary'), type: 'submit' }, o.submitLabel || 'Save');
      var cancel = el('button', { class: 'btn btn-outline', type: 'button' }, 'Cancel');
      var m = IS.modal({ title: o.title, size: o.size, body: form, footer: [cancel, submit], onClose: function () { resolve(null); } });
      cancel.addEventListener('click', function () { m.close(); });
      submit.addEventListener('click', function () { form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })); });
      form.addEventListener('submit', function (e) {
        e.preventDefault(); errBox.classList.add('hidden');
        var data = IS.readForm(form, o.fields), bad = null;
        o.fields.forEach(function (f) {
          var c = form.querySelector('[name="' + f.name + '"]'); if (c && c.classList) c.classList.remove('invalid');
          if (f.required && f.type !== 'checkbox' && (data[f.name] === '' || data[f.name] === null)) { if (!bad) bad = f.label + ' is required'; if (c) c.classList.add('invalid'); }
        });
        if (bad) { errBox.textContent = bad; errBox.classList.remove('hidden'); return; }
        IS.busy(submit, function () { return o.onSubmit(data, m); }).then(function (res) { resolve(res === undefined ? true : res); m.onClose = null; var keep = o.keepOpen; if (!keep) { m.closed = false; m.close(); } }, function (er) { errBox.textContent = er.message || 'Could not save'; errBox.classList.remove('hidden'); form.scrollIntoView({ block: 'nearest' }); });
      });
    });
  };

  /* ------------------------------------------------------------ table, pager, tabs, header, empty, loading */
  // IS.table({columns:[{key,label,render:(row)=>node|string, class, align:'right'}], rows, empty:'No records', onRowClick, footer:{key:value}})
  IS.table = function (o) {
    var cols = o.columns, rows = o.rows || [];
    if (!rows.length) return IS.empty(o.empty || 'Nothing to show yet', o.emptyIcon);
    var thead = el('thead', null, el('tr', null, cols.map(function (c) { return el('th', { class: c.align === 'right' ? 'right' : '' }, c.label); })));
    var tbody = el('tbody', null, rows.map(function (r, i) {
      return el('tr', { class: o.onRowClick ? 'clickable' : '', onclick: o.onRowClick ? function (e) { if (!e.target.closest('button,a,input,select')) o.onRowClick(r, i); } : null },
        cols.map(function (c) { var v = c.render ? c.render(r, i) : (r[c.key] == null ? '-' : r[c.key]); return el('td', { class: (c.align === 'right' ? 'num ' : '') + (c.class || '') }, v); }));
    }));
    var tfoot = null;
    if (o.footer) tfoot = el('tfoot', null, el('tr', null, cols.map(function (c, i) { return el('td', { class: c.align === 'right' ? 'num' : '' }, o.footer[c.key] !== undefined ? o.footer[c.key] : (i === 0 ? 'Total' : '')); })));
    return el('div', { class: 'table-wrap' }, el('table', { class: 'tbl' }, thead, tbody, tfoot));
  };
  IS.pager = function (o) {                       // {total, limit, offset, onChange(newOffset)}
    var from = o.total ? o.offset + 1 : 0, to = Math.min(o.total, o.offset + o.limit);
    var prev = el('button', { class: 'btn btn-outline btn-sm', disabled: o.offset <= 0, onclick: function () { o.onChange(Math.max(0, o.offset - o.limit)); } }, IS.icon('arrowleft', 15), 'Prev');
    var next = el('button', { class: 'btn btn-outline btn-sm', disabled: to >= o.total, onclick: function () { o.onChange(o.offset + o.limit); } }, 'Next', IS.icon('arrowright', 15));
    return el('div', { class: 'pager' }, el('span', null, from + '-' + to + ' of ' + IS.num(o.total)), el('div', { class: 'row' }, prev, next));
  };
  // Tabs with lazy rendering: IS.tabs(host, [{id,label,render(panel)}], {initial, onChange}) -> {select(id)}
  IS.tabs = function (host, tabs, opts) {
    opts = opts || {};
    var bar = el('div', { class: 'tabs', role: 'tablist' }), panel = el('div', { class: 'tab-panel fade-up' });
    var cur = null, buttons = {};
    function select(id) {
      cur = id; Object.keys(buttons).forEach(function (k) { buttons[k].classList.toggle('active', k === id); buttons[k].setAttribute('aria-selected', k === id); });
      IS.clear(panel); panel.classList.remove('fade-up'); void panel.offsetWidth; panel.classList.add('fade-up');
      var t = tabs.filter(function (x) { return x.id === id; })[0];
      if (t) { var r = t.render(panel); if (r && r.catch) r.catch(function (e) { panel.appendChild(IS.errorBox(e)); }); }
      if (opts.onChange) opts.onChange(id);
    }
    tabs.forEach(function (t) { buttons[t.id] = el('button', { class: 'tab', role: 'tab', type: 'button', onclick: function () { select(t.id); } }, t.label); bar.appendChild(buttons[t.id]); });
    host.appendChild(bar); host.appendChild(panel);
    select(opts.initial || tabs[0].id);
    return { select: select, current: function () { return cur; }, panel: panel };
  };
  IS.pageHeader = function (title, subtitle, actions) {
    return el('div', { class: 'page-head' }, el('div', null, el('h1', null, title), subtitle ? el('p', { class: 'muted', style: { margin: 0 } }, subtitle) : null), el('div', { class: 'row' }, actions || []));
  };
  IS.empty = function (msg, icon) { return el('div', { class: 'empty' }, IS.icon(icon || 'inbox', 46), el('div', null, msg)); };
  IS.errorBox = function (e) { return el('div', { class: 'alert danger' }, (e && e.message) || 'Could not load this section'); };
  IS.loading = function (rows) { var w = el('div', { class: 'stack' }); for (var i = 0; i < (rows || 4); i++) w.appendChild(el('div', { class: 'skeleton', style: { height: i === 0 ? '28px' : '56px', width: i === 0 ? '40%' : '100%' } })); return w; };
  IS.kpi = function (label, value, sub, icon) { return el('div', { class: 'card kpi' }, icon ? el('div', { class: 'kpi-icon' }, IS.icon(icon, 20)) : null, el('div', { class: 'kpi-label' }, label), el('div', { class: 'kpi-value', 'data-count': typeof value === 'number' ? value : null }, typeof value === 'number' ? IS.num(value) : value), sub ? el('div', { class: 'kpi-sub' }, sub) : null); };
  IS.countUp = function (root) {                   // animates every [data-count] number inside root
    IS.$$('[data-count]', root).forEach(function (n) {
      var to = Number(n.getAttribute('data-count')); if (!isFinite(to) || to === 0) return;
      var t0 = performance.now(), dur = 900, money = n.hasAttribute('data-money');
      (function tick(t) { var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); var v = to * e; n.textContent = money ? IS.money(v) : IS.num(Math.round(v)); if (p < 1) requestAnimationFrame(tick); })(t0);
    });
  };
  IS.downloadCsv = function (filename, columns, rows) {
    var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var csv = [columns.map(function (c) { return q(c.label); }).join(',')].concat(rows.map(function (r) { return columns.map(function (c) { return q(r[c.key]); }).join(','); })).join('\n');
    var a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: filename }); document.body.appendChild(a); a.click(); a.remove();
  };

  /* ------------------------------------------------------------ charts (pure SVG, colours follow the theme) */
  var NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, text) { var n = document.createElementNS(NS, tag); Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); }); if (text !== undefined) n.textContent = text; return n; }
  function niceMax(v) { if (v <= 0) return 10; var p = Math.pow(10, Math.floor(Math.log10(v))); var f = v / p; var n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10; return n * p; }
  function short(v) { v = Number(v); if (Math.abs(v) >= 1e7) return (v / 1e7).toFixed(1).replace(/\.0$/, '') + 'Cr'; if (Math.abs(v) >= 1e5) return (v / 1e5).toFixed(1).replace(/\.0$/, '') + 'L'; if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'; return String(Math.round(v * 10) / 10); }
  IS.short = short;
  var W = 640, H = 260, M = { l: 46, r: 14, t: 14, b: 30 };
  function frame(max, fmt) {
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', preserveAspectRatio: 'xMidYMid meet' });
    for (var i = 0; i <= 4; i++) {
      var y = M.t + (H - M.t - M.b) * (1 - i / 4);
      s.appendChild(svg('line', { x1: M.l, x2: W - M.r, y1: y, y2: y, class: 'grid-line' }));
      s.appendChild(svg('text', { x: M.l - 8, y: y + 4, 'text-anchor': 'end' }, (fmt || short)(max * i / 4)));
    }
    return s;
  }
  function xLabels(s, labels, step) {
    var n = labels.length, iw = W - M.l - M.r;
    labels.forEach(function (l, i) { if (i % (step || Math.ceil(n / 8)) !== 0 && i !== n - 1) return; s.appendChild(svg('text', { x: M.l + iw * (n === 1 ? .5 : i / (n - 1)), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, l)); });
  }
  // data: [{label, value}] ; opts: {color:'var(--c1)', format:fn, area:true}
  IS.chart = {
    line: function (host, data, opts) {
      opts = opts || {}; IS.clear(host); host.classList.add('chart');
      if (!data.length) { host.appendChild(IS.empty('No data for this period', 'chart')); return; }
      var max = niceMax(Math.max.apply(null, data.map(function (d) { return d.value; })) * 1.05), iw = W - M.l - M.r, ih = H - M.t - M.b, col = opts.color || 'var(--c1)';
      var s = frame(max, opts.axisFormat), n = data.length;
      var pts = data.map(function (d, i) { return [M.l + iw * (n === 1 ? .5 : i / (n - 1)), M.t + ih * (1 - d.value / max)]; });
      var path = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
      var gid = 'g' + Math.random().toString(36).slice(2, 7);
      var defs = svg('defs'); var lg = svg('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
      lg.appendChild(svg('stop', { offset: '0%', 'stop-color': col, 'stop-opacity': .28 })); lg.appendChild(svg('stop', { offset: '100%', 'stop-color': col, 'stop-opacity': 0 })); defs.appendChild(lg); s.appendChild(defs);
      s.appendChild(svg('path', { d: path + ' L' + pts[n - 1][0] + ' ' + (M.t + ih) + ' L' + pts[0][0] + ' ' + (M.t + ih) + ' Z', fill: 'url(#' + gid + ')', class: 'area-path' }));
      s.appendChild(svg('path', { d: path, fill: 'none', stroke: col, 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'line-path' }));
      pts.forEach(function (p, i) { var c = svg('circle', { cx: p[0], cy: p[1], r: n > 30 ? 2 : 4, fill: 'var(--surface)', stroke: col, 'stroke-width': 2, class: 'dot' }); c.appendChild(svg('title', {}, data[i].label + ': ' + (opts.format || short)(data[i].value))); s.appendChild(c); });
      xLabels(s, data.map(function (d) { return d.label; })); host.appendChild(s);
    },
    bar: function (host, data, opts) {
      opts = opts || {}; IS.clear(host); host.classList.add('chart');
      if (!data.length) { host.appendChild(IS.empty('No data for this period', 'chart')); return; }
      var vals = data.map(function (d) { return d.value; }), min = Math.min(0, Math.min.apply(null, vals)), max = niceMax(Math.max(0, Math.max.apply(null, vals)) * 1.05 || 10);
      var iw = W - M.l - M.r, ih = H - M.t - M.b, n = data.length, bw = Math.min(46, iw / n * .62), col = opts.color || 'var(--c1)';
      var s = frame(max, opts.axisFormat), zeroY = M.t + ih * (max / (max - min));
      if (min < 0) s = frame(max - min, function (v) { return short(v + min); });
      data.forEach(function (d, i) {
        var cx = M.l + iw * (i + .5) / n, h = Math.abs(d.value) / (max - min) * ih, y = d.value >= 0 ? zeroY - h : zeroY;
        var r = svg('rect', { x: cx - bw / 2, y: y, width: bw, height: Math.max(1, h), rx: 5, fill: d.value < 0 ? 'var(--c6)' : (d.color || col), class: 'bar', style: 'animation-delay:' + (i * 40) + 'ms' });
        r.appendChild(svg('title', {}, d.label + ': ' + (opts.format || short)(d.value))); s.appendChild(r);
        if (i % Math.ceil(n / 10) === 0) s.appendChild(svg('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }, d.label.length > 9 ? d.label.slice(0, 8) + '..' : d.label));
      });
      host.appendChild(s);
    },
    // horizontal bars: good for names (hotels, room types)
    hbar: function (host, data, opts) {
      opts = opts || {}; IS.clear(host); host.classList.add('chart');
      if (!data.length) { host.appendChild(IS.empty('No data yet', 'chart')); return; }
      var max = Math.max.apply(null, data.map(function (d) { return d.value; })) || 1, wrap = el('div', { class: 'stack', style: { gap: '10px' } });
      data.forEach(function (d, i) {
        wrap.appendChild(el('div', null, el('div', { class: 'row between small', style: { marginBottom: '4px' } }, el('span', null, d.label), el('b', null, (opts.format || short)(d.value))),
          el('div', { class: 'progress' }, el('span', { style: { width: (d.value / max * 100) + '%', background: 'linear-gradient(90deg,var(--c' + ((i % 6) + 1) + '),var(--accent))', transitionDelay: (i * 70) + 'ms' } }))));
      });
      host.appendChild(wrap);
    },
    donut: function (host, data, opts) {
      opts = opts || {}; IS.clear(host); host.classList.add('chart');
      var total = data.reduce(function (a, d) { return a + d.value; }, 0);
      if (!total) { host.appendChild(IS.empty('No data yet', 'pie')); return; }
      var size = 180, r = 66, sw = 26, c = 2 * Math.PI * r, off = 0, s = svg('svg', { viewBox: '0 0 ' + size + ' ' + size, style: 'max-width:190px;margin:0 auto' });
      s.appendChild(svg('circle', { cx: 90, cy: 90, r: r, fill: 'none', stroke: 'var(--surface-3)', 'stroke-width': sw }));
      data.forEach(function (d, i) {
        var len = d.value / total * c, seg = svg('circle', { cx: 90, cy: 90, r: r, fill: 'none', stroke: d.color || 'var(--c' + ((i % 6) + 1) + ')', 'stroke-width': sw, 'stroke-dasharray': len + ' ' + (c - len), 'stroke-dashoffset': -off, transform: 'rotate(-90 90 90)', class: 'donut-seg', style: 'animation-delay:' + (i * 120) + 'ms' });
        seg.appendChild(svg('title', {}, d.label + ': ' + d.value)); s.appendChild(seg); off += len;
      });
      s.appendChild(svg('text', { x: 90, y: 88, 'text-anchor': 'middle', style: 'font-size:22px;font-weight:700;fill:var(--text)' }, opts.center !== undefined ? opts.center : IS.num(total)));
      s.appendChild(svg('text', { x: 90, y: 106, 'text-anchor': 'middle' }, opts.centerLabel || 'total'));
      var legend = el('div', { class: 'legend', style: { justifyContent: 'center', marginTop: '10px' } }, data.map(function (d, i) { return el('span', null, el('i', { style: { background: d.color || 'var(--c' + ((i % 6) + 1) + ')' } }), d.label + ' (' + d.value + ')'); }));
      host.appendChild(s); host.appendChild(legend);
    }
  };

  /* ------------------------------------------------------------ theme (light / dark) */
  IS.theme = {
    get: function () { return document.documentElement.getAttribute('data-theme') || 'light'; },
    set: function (m) { document.documentElement.setAttribute('data-theme', m); try { localStorage.setItem('innovastay-theme', m); } catch (e) { /* ignore */ } IS.$$('[data-theme-toggle]').forEach(IS.theme._paint); },
    toggle: function () { IS.theme.set(IS.theme.get() === 'dark' ? 'light' : 'dark'); },
    _paint: function (b) { IS.clear(b); b.appendChild(IS.icon(IS.theme.get() === 'dark' ? 'sun' : 'moon', 19)); b.setAttribute('aria-label', IS.theme.get() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'); b.title = IS.theme.get() === 'dark' ? 'Light mode' : 'Dark mode'; },
    button: function (cls) { var b = el('button', { class: cls || 'btn btn-ghost btn-icon', type: 'button', 'data-theme-toggle': '', onclick: IS.theme.toggle }); IS.theme._paint(b); return b; }
  };

  IS.logout = function () { return IS.post('/api/auth/logout', {}, { noRedirect: true }).catch(function () { }).then(function () { location.href = '/login.html'; }); };

  // Password strength helper used by sign-up / reset / change-password forms
  IS.passwordHint = 'At least 8 characters with a letter and a number.';
  IS.checkPassword = function (p) { if (!p || p.length < 8) return 'Password must be at least 8 characters'; if (!/[a-z]/i.test(p) || !/\d/.test(p)) return 'Password needs at least one letter and one number'; return null; };
  IS.passwordField = function (name, label, placeholder, autocomplete) {
    var input = el('input', { class: 'input', type: 'password', name: name, placeholder: placeholder || '', autocomplete: autocomplete || 'current-password', required: true });
    var eye = el('button', { class: 'btn btn-ghost btn-icon eye', type: 'button', 'aria-label': 'Show password', onclick: function () { var show = input.type === 'password'; input.type = show ? 'text' : 'password'; IS.clear(eye); eye.appendChild(IS.icon(show ? 'eyeoff' : 'eye', 18)); } }, IS.icon('eye', 18));
    return el('div', { class: 'field' }, el('label', null, label), el('div', { class: 'input-wrap' }, input, eye));
  };
  // Modal to change the signed-in user's password
  IS.changePasswordModal = function (forced) {
    var form = el('form', null, el('div', { class: 'form-error hidden' }),
      forced ? el('div', { class: 'alert warn mb-2' }, 'For your security, please replace the temporary password before continuing.') : null,
      el('div', { class: 'stack' }, IS.passwordField('current', 'Current password'), IS.passwordField('password', 'New password', IS.passwordHint, 'new-password'), IS.passwordField('confirm', 'Confirm new password', '', 'new-password')));
    var save = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Update password');
    var m = IS.modal({ title: forced ? 'Set a new password' : 'Change password', size: 'sm', persistent: !!forced, body: form, footer: forced ? [save] : [el('button', { class: 'btn btn-outline', type: 'button', onclick: function () { m.close(); } }, 'Cancel'), save] });
    save.addEventListener('click', function () { form.requestSubmit(); });
    form.addEventListener('submit', function (e) {
      e.preventDefault(); var err = form.querySelector('.form-error'); err.classList.add('hidden');
      var d = IS.readForm(form, [{ name: 'current' }, { name: 'password' }, { name: 'confirm' }]);
      var bad = IS.checkPassword(d.password) || (d.password !== d.confirm ? 'The two new passwords do not match' : null);
      if (bad) { err.textContent = bad; err.classList.remove('hidden'); return; }
      IS.busy(save, function () { return IS.post('/api/auth/change-password', { current: d.current, password: d.password }); }).then(function (r) { IS.toast(r.message || 'Password updated'); m.persistent = false; m.close(); if (forced) setTimeout(function () { location.reload(); }, 500); }, function (er) { err.textContent = er.message; err.classList.remove('hidden'); });
    });
    return m;
  };
  // Security panel: active sessions and recent sign-ins of the current user
  IS.securityModal = function () {
    var body = el('div', null, IS.loading(3)), m = IS.modal({ title: 'Account security', size: 'lg', body: body });
    function load() {
      IS.get('/api/auth/sessions').then(function (d) {
        IS.clear(body);
        body.appendChild(el('div', { class: 'row between mb-1' }, el('h4', { style: { margin: 0 } }, 'Devices signed in'), el('button', { class: 'btn btn-outline btn-sm', onclick: function () { IS.confirm('Sign out of every other device?').then(function (ok) { if (ok) IS.post('/api/auth/sessions/revoke-others').then(function (r) { IS.toast(r.message); load(); }, IS.err); }); } }, 'Sign out other devices')));
        body.appendChild(IS.table({ columns: [{ label: 'Device', render: function (s) { return String(s.user_agent || 'Unknown').slice(0, 60); } }, { label: 'IP', key: 'ip' }, { label: 'Signed in', render: function (s) { return IS.dateTime(s.created_at); } }, { label: '', render: function (s) { return s.current ? IS.badge('this device', 'This device', 'green') : ''; } }], rows: d.sessions }));
        body.appendChild(el('h4', { class: 'mt-3 mb-1' }, 'Recent sign-in attempts'));
        body.appendChild(IS.table({ columns: [{ label: 'When', render: function (h) { return IS.dateTime(h.created_at); } }, { label: 'Portal', render: function (h) { return IS.title(h.portal); } }, { label: 'Result', render: function (h) { return h.success ? IS.badge('success', 'Success', 'green') : IS.badge('failed', 'Failed: ' + (h.reason || ''), 'red'); } }, { label: 'IP', key: 'ip' }], rows: d.history }));
      }, function (e) { IS.clear(body); body.appendChild(IS.errorBox(e)); });
    }
    load(); return m;
  };

  document.addEventListener('DOMContentLoaded', function () { IS.$$('[data-theme-toggle]').forEach(IS.theme._paint); });
})();
