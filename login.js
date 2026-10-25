/* Login page: 4 portals, show/hide password, forgot-password (OTP), customer sign-up. */
(function () {
  'use strict';
  var IS = window.IS, el = IS.el;
  var view = IS.$('#view'), q = new URLSearchParams(location.search);
  var PORTALS = [
    { id: 'customer', label: 'Customer', icon: 'user', hint: 'Book rooms, order food, collect rewards' },
    { id: 'staff', label: 'Staff', icon: 'users', hint: 'Front desk, housekeeping, restaurant, accounts, maintenance' },
    { id: 'admin', label: 'Hotel Admin', icon: 'shield', hint: 'Manage your hotel, staff and reports' },
    { id: 'platform', label: 'Platform', icon: 'globe', hint: 'Manage hotels, admins and the system' }
  ];
  var DEMO = {
    customer: ['customer', 'Customer@123'], staff: ['reception', 'Staff@123'], admin: ['admin', 'Admin@123'], platform: ['platform', 'Platform@123']
  };
  var portal = PORTALS.some(function (p) { return p.id === q.get('portal'); }) ? q.get('portal') : 'customer';
  IS.$('#themeSlot').appendChild(IS.theme.button());

  // already signed in? go straight to the dashboard
  IS.get('/api/auth/me', null, { noRedirect: true }).then(function (r) { if (r.user) location.replace('/dashboard/' + r.user.portal); }, function () { });

  function safeNext(p) {
    var n = q.get('next') || '';
    return n.indexOf('/dashboard/' + p) === 0 && n.indexOf('//') < 0 ? n : null;
  }
  function pw(name, label, ac) {
    var input = el('input', { class: 'input', type: 'password', name: name, id: 'f_' + name, autocomplete: ac || 'current-password', required: true, placeholder: '••••••••' });
    var btn = el('button', { class: 'btn btn-ghost btn-icon toggle', type: 'button', 'aria-label': 'Show password', onclick: function () {
      var show = input.type === 'password'; input.type = show ? 'text' : 'password'; IS.clear(btn); btn.appendChild(IS.icon(show ? 'eyeoff' : 'eye', 18)); btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); } }, IS.icon('eye', 18));
    return el('div', { class: 'field' }, el('label', { for: 'f_' + name }, label), el('div', { class: 'input-wrap' }, input, btn));
  }
  function txt(name, label, o) {
    o = o || {}; return el('div', { class: 'field' }, el('label', { for: 'f_' + name }, label), el('input', { class: 'input', type: o.type || 'text', name: name, id: 'f_' + name, autocomplete: o.ac || 'off', required: o.required !== false, placeholder: o.ph || '', inputmode: o.mode, maxlength: o.max }));
  }
  function errBox() { return el('div', { class: 'form-error hidden', role: 'alert' }); }
  function showErr(box, msg, card) { box.textContent = msg; box.classList.remove('hidden'); var c = IS.$('#card'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); }
  function vals(form) { var o = {}; new FormData(form).forEach(function (v, k) { o[k] = typeof v === 'string' ? v.trim() : v; }); return o; }
  function submitBtn(label) { return el('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, label); }

  /* ---------- sign in ---------- */
  function signIn() {
    IS.clear(view); document.title = 'Log in | InnovaStay';
    var idx = PORTALS.map(function (p) { return p.id; }).indexOf(portal);
    var pill = el('span', { class: 'pill', style: { transform: 'translateX(' + (idx * 100) + '%)' } });
    var tabs = el('div', { class: 'portal-tabs', role: 'tablist' }, pill, PORTALS.map(function (p, i) {
      return el('button', { type: 'button', role: 'tab', class: p.id === portal ? 'active' : '', 'aria-selected': p.id === portal, onclick: function () { portal = p.id; history.replaceState(null, '', '?portal=' + p.id + (q.get('next') ? '&next=' + encodeURIComponent(q.get('next')) : '')); signIn(); } }, IS.icon(p.icon, 20), p.label);
    }));
    var p = PORTALS[idx], err = errBox();
    var form = el('form', { novalidate: true, autocomplete: 'on' }, err,
      txt('identifier', 'Username, mobile number or email', { ac: 'username', ph: 'e.g. rahul_k, 98xxxxxx10 or you@mail.com' }), pw('password', 'Password'),
      el('div', { class: 'auth-links' }, el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: true, disabled: true }), 'Secure session'), el('button', { type: 'button', class: 'linkbtn', onclick: function () { forgot(); } }, 'Forgot password?')));
    var btn = submitBtn('Log in to ' + p.label + ' portal'); form.appendChild(btn);
    form.addEventListener('submit', function (e) {
      e.preventDefault(); err.classList.add('hidden'); var v = vals(form);
      if (!v.identifier || !v.password) return showErr(err, 'Enter your username / mobile / email and password.');
      IS.busy(btn, function () { return IS.post('/api/auth/login', { portal: portal, identifier: v.identifier, password: v.password }, { noRedirect: true }); }).then(function (r) {
        location.href = safeNext(portal) || r.redirect;
      }, function (e2) { showErr(err, e2.message); });
    });
    view.appendChild(el('h2', null, p.label + ' login')); view.appendChild(el('p', { class: 'sub' }, p.hint)); view.appendChild(tabs); view.appendChild(form);
    if (portal === 'customer') view.appendChild(el('div', { class: 'auth-foot' }, 'New to InnovaStay? ', el('button', { class: 'linkbtn', type: 'button', onclick: register }, 'Create a free account')));
    var d = DEMO[portal];
    view.appendChild(el('details', { class: 'demo' }, el('summary', null, 'Demo account for this portal'),
      el('div', { style: { marginTop: '8px' } }, 'Username ', el('code', null, d[0]), ' · Password ', el('code', null, d[1])),
      el('button', { class: 'btn btn-soft btn-sm', type: 'button', onclick: function () { form.identifier.value = d[0]; form.password.value = d[1]; form.password.focus(); } }, 'Fill these in'),
      portal === 'staff' ? el('div', { class: 'help mt-1' }, 'Other staff users: manager, housekeeping, restaurant, accountant, maintenance (same password).') : null));
    if (q.get('mode') === 'register' && portal === 'customer') { q.delete('mode'); register(); }
  }

  /* ---------- customer sign-up ---------- */
  function register() {
    IS.clear(view); document.title = 'Create account | InnovaStay';
    var err = errBox();
    var form = el('form', { novalidate: true }, err,
      el('div', { class: 'form-grid' }, txt('full_name', 'Full name', { ac: 'name' }), txt('username', 'Username', { ac: 'username', ph: 'letters, numbers, . _' }),
        txt('email', 'Email', { type: 'email', ac: 'email' }), txt('mobile', 'Mobile number', { type: 'tel', ac: 'tel', mode: 'numeric', ph: '10 digits' })),
      pw('password', 'Password', 'new-password'), el('div', { class: 'help', style: { marginTop: '-8px', marginBottom: '12px' } }, IS.passwordHint),
      txt('referral_code', 'Referral code (optional)', { required: false, max: 12 }));
    var btn = submitBtn('Create account'); form.appendChild(btn);
    form.addEventListener('submit', function (e) {
      e.preventDefault(); err.classList.add('hidden'); var v = vals(form);
      var bad = IS.checkPassword(v.password); if (bad) return showErr(err, bad);
      IS.busy(btn, function () { return IS.post('/api/auth/register', v, { noRedirect: true }); }).then(function (r) { location.href = safeNext('customer') || r.redirect; }, function (e2) { showErr(err, e2.message); });
    });
    view.appendChild(el('h2', null, 'Create your account')); view.appendChild(el('p', { class: 'sub' }, 'Get 100 welcome points and book in seconds.')); view.appendChild(form);
    view.appendChild(el('div', { class: 'auth-foot' }, 'Already registered? ', el('button', { class: 'linkbtn', type: 'button', onclick: signIn }, 'Log in')));
  }

  /* ---------- forgot / reset password ---------- */
  function forgot() {
    IS.clear(view); document.title = 'Reset password | InnovaStay';
    var err = errBox();
    var form = el('form', { novalidate: true }, err, txt('identifier', 'Username, mobile number or email', { ac: 'username' }));
    var btn = submitBtn('Send verification code'); form.appendChild(btn);
    form.addEventListener('submit', function (e) {
      e.preventDefault(); err.classList.add('hidden'); var v = vals(form);
      if (!v.identifier) return showErr(err, 'Enter your username, mobile number or email.');
      IS.busy(btn, function () { return IS.post('/api/auth/forgot', { identifier: v.identifier }, { noRedirect: true }); }).then(function (r) { reset(v.identifier, r); }, function (e2) { showErr(err, e2.message); });
    });
    view.appendChild(el('h2', null, 'Forgot password?')); view.appendChild(el('p', { class: 'sub' }, 'We will send a 6-digit code to your registered mobile number or email.')); view.appendChild(form);
    view.appendChild(el('div', { class: 'auth-foot' }, el('button', { class: 'linkbtn', type: 'button', onclick: signIn }, '← Back to log in')));
  }
  function reset(identifier, info) {
    IS.clear(view);
    var err = errBox();
    var form = el('form', { novalidate: true }, err, txt('otp', '6-digit code', { mode: 'numeric', max: 6, ac: 'one-time-code' }), pw('password', 'New password', 'new-password'),
      el('div', { class: 'help', style: { marginTop: '-8px', marginBottom: '12px' } }, IS.passwordHint));
    var btn = submitBtn('Reset password'); form.appendChild(btn);
    form.addEventListener('submit', function (e) {
      e.preventDefault(); err.classList.add('hidden'); var v = vals(form);
      var bad = IS.checkPassword(v.password); if (bad) return showErr(err, bad);
      IS.busy(btn, function () { return IS.post('/api/auth/reset', { identifier: identifier, otp: v.otp, password: v.password }, { noRedirect: true }); }).then(function () {
        IS.toast('Password updated. Please log in.', 'success'); signIn();
      }, function (e2) { showErr(err, e2.message); });
    });
    view.appendChild(el('h2', null, 'Enter the code')); view.appendChild(el('p', { class: 'sub' }, info.message));
    if (info.demo_otp) view.appendChild(el('div', { class: 'alert otp-note' }, IS.icon('info', 18), el('div', null, 'Demo mode: no SMS/email gateway is connected, so your code is ', el('b', null, info.demo_otp), '. (Set SHOW_RESET_OTP=false in production.)')));
    view.appendChild(form);
    view.appendChild(el('div', { class: 'auth-foot' }, el('button', { class: 'linkbtn', type: 'button', onclick: signIn }, '← Back to log in')));
  }

  signIn();
})();
