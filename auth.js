'use strict';
/** Login, registration, logout, forgot/reset password, change password. */
const crypto = require('crypto');
const db = require('../config/db');
const config = require('../config');
const { router, HttpError } = require('../utils/http');
const S = require('../utils/security');
const { requireAuth, loadUser } = require('../middleware/auth');
const { notify } = require('../utils/business');

const PORTAL_ROLE = { customer: 'customer', staff: 'staff', admin: 'admin', platform: 'platform_admin' };
const ROLE_PORTAL = { customer: 'customer', staff: 'staff', admin: 'admin', platform_admin: 'platform' };
const normMobile = (v) => v.replace(/[\s-]/g, '').replace(/^\+?91(?=\d{10}$)/, '');
let DUMMY_HASH = null;  // used to keep timing equal when the account does not exist
S.hashPassword('dummy-Password-1').then((h) => (DUMMY_HASH = h));

function findUser(identifier) {
  const id = S.clean(identifier, 120);
  if (!id) return null;
  if (/^\+?[\d\s-]{10,16}$/.test(id)) return db.get('SELECT * FROM users WHERE mobile=?', normMobile(id));
  return db.get('SELECT * FROM users WHERE email=? OR username=?', id, id);
}
function startSession(ctx, user) {
  const token = S.signToken({ sub: user.id, role: user.role, tv: user.token_version });
  ctx.setCookie(S.sessionCookie(token, config.SESSION_HOURS * 3600));
}
const publicUser = (u) => ({ id: u.id, name: u.full_name, full_name: u.full_name, username: u.username, role: u.role, portal: ROLE_PORTAL[u.role], hotel_id: u.hotel_id });

router.post('/api/auth/login', async (ctx) => {
  const { portal, identifier, password } = ctx.body;
  if (!PORTAL_ROLE[portal] || !identifier || !password) throw new HttpError(400, 'Choose a portal and enter your login details.');
  const ipLimit = S.rateLimit(`login:ip:${ctx.ip}`, 30, 15 * 60 * 1000);
  const idLimit = S.rateLimit(`login:id:${String(identifier).toLowerCase()}`, 10, 15 * 60 * 1000);
  if (!ipLimit.allowed || !idLimit.allowed) throw new HttpError(429, `Too many attempts. Try again in ${Math.max(ipLimit.retryAfter, idLimit.retryAfter)} seconds.`);

  const user = findUser(identifier);
  const log = (ok) => db.run('INSERT INTO login_history (user_id,identifier,portal,ip,user_agent,success) VALUES (?,?,?,?,?,?)',
    user ? user.id : null, S.clean(identifier, 80), portal, ctx.ip, S.clean(ctx.req.headers['user-agent'], 200), ok ? 1 : 0);
  const fail = (msg = 'Invalid credentials. Please check your details and selected portal.') => { log(false); throw new HttpError(401, msg); };

  if (!user) { await S.verifyPassword(String(password), DUMMY_HASH); fail(); }
  if (user.locked_until && new Date(user.locked_until.replace(' ', 'T') + 'Z') > new Date())
    fail('Account temporarily locked after repeated failed attempts. Try again later or reset your password.');
  const ok = await S.verifyPassword(String(password), user.password_hash);
  if (!ok) {
    const n = user.failed_logins + 1;
    if (n >= config.MAX_FAILED_LOGINS) db.run("UPDATE users SET failed_logins=0, locked_until=datetime('now', ?) WHERE id=?", `+${config.LOCK_MINUTES} minutes`, user.id);
    else db.run('UPDATE users SET failed_logins=? WHERE id=?', n, user.id);
    fail();
  }
  if (user.role !== PORTAL_ROLE[portal]) fail();                      // right password, wrong portal
  if (user.status !== 'Active') fail('This account is suspended. Please contact support.');
  db.run("UPDATE users SET failed_logins=0, locked_until=NULL, last_login=datetime('now') WHERE id=?", user.id);
  log(true);
  startSession(ctx, user);
  ctx.json({ user: publicUser(user), redirect: `/dashboard/${ROLE_PORTAL[user.role]}` });
});

router.post('/api/auth/register', async (ctx) => {
  const b = ctx.body;
  const lim = S.rateLimit(`register:${ctx.ip}`, 10, 60 * 60 * 1000);
  if (!lim.allowed) throw new HttpError(429, 'Too many sign-ups from this network. Try later.');
  const name = S.clean(b.full_name, 80), username = S.clean(b.username, 30).toLowerCase(), email = S.clean(b.email, 120).toLowerCase(), mobile = normMobile(S.clean(b.mobile, 16));
  if (name.length < 2) throw new HttpError(400, 'Please enter your full name.');
  if (!/^[a-z0-9_.]{3,30}$/.test(username)) throw new HttpError(400, 'Username: 3-30 letters, numbers, dot or underscore.');
  if (!S.isEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (!S.isMobile(mobile)) throw new HttpError(400, 'Enter a valid 10-digit mobile number.');
  const pe = S.passwordPolicy(b.password); if (pe) throw new HttpError(400, pe);
  if (db.get('SELECT 1 x FROM users WHERE username=? OR email=? OR mobile=?', username, email, mobile))
    throw new HttpError(409, 'An account with this username, email or mobile already exists.');
  const hash = await S.hashPassword(b.password);
  const user = db.tx(() => {
    const r = db.run("INSERT INTO users (username,email,mobile,full_name,password_hash,role) VALUES (?,?,?,?,?,'customer')", username, email, mobile, name, hash);
    const uid = Number(r.lastInsertRowid);
    const code = 'INV' + S.randomCode(5);
    const g = db.run('INSERT INTO guests (user_id,full_name,mobile,email,referral_code,loyalty_points) VALUES (?,?,?,?,?,100)', uid, name, mobile, email, code);
    const ref = S.clean(b.referral_code, 12).toUpperCase();
    if (ref) { const rg = db.get('SELECT id,user_id FROM guests WHERE referral_code=?', ref);
      if (rg) { db.run('UPDATE guests SET loyalty_points=loyalty_points+200 WHERE id IN (?,?)', rg.id, Number(g.lastInsertRowid));
        notify(rg.user_id, null, 'Referral reward', `${name} joined with your code. You earned 200 points!`, 'Offer'); } }
    notify(uid, null, 'Welcome to InnovaStay', 'Your account is ready. You received 100 welcome points.', 'Info');
    return db.get('SELECT * FROM users WHERE id=?', uid);
  });
  startSession(ctx, user);
  ctx.json({ user: publicUser(user), redirect: '/dashboard/customer' }, 201);
});

router.post('/api/auth/logout', (ctx) => { ctx.setCookie(S.sessionCookie('', 0)); ctx.json({ ok: true }); });

router.get('/api/auth/me', (ctx) => {
  const u = loadUser(ctx);
  ctx.json({ user: u ? { ...publicUser(u), hotel_name: u.hotel_name, department: u.department, staff_code: u.staff_code, email: u.email, mobile: u.mobile } : null });
});

// ---- Forgot / reset password (OTP, 10 min validity, 5 tries) ----
router.post('/api/auth/forgot', (ctx) => {
  const lim = S.rateLimit(`forgot:${ctx.ip}`, 6, 60 * 60 * 1000);
  if (!lim.allowed) throw new HttpError(429, 'Too many reset requests. Try again later.');
  const user = findUser(ctx.body.identifier);
  const out = { message: 'If an account exists, a 6-digit verification code has been sent to the registered mobile/email.' };
  if (user && user.status === 'Active') {
    const otp = String(crypto.randomInt(100000, 1000000));
    db.run('UPDATE password_resets SET used=1 WHERE user_id=? AND used=0', user.id);
    db.run("INSERT INTO password_resets (user_id,otp_hash,expires_at) VALUES (?,?,datetime('now','+10 minutes'))", user.id, S.hashOtp(otp));
    // Integration point: send `otp` through your SMS / email gateway here.
    console.log(`[InnovaStay] Password reset OTP for ${user.username}: ${otp}`);
    if (config.SHOW_RESET_OTP) out.demo_otp = otp;
  }
  ctx.json(out);
});

router.post('/api/auth/reset', async (ctx) => {
  const { identifier, otp, password } = ctx.body;
  const lim = S.rateLimit(`reset:${ctx.ip}`, 15, 60 * 60 * 1000);
  if (!lim.allowed) throw new HttpError(429, 'Too many attempts. Try again later.');
  const bad = () => { throw new HttpError(400, 'Invalid or expired code.'); };
  const user = findUser(identifier); if (!user) bad();
  const pe = S.passwordPolicy(password); if (pe) throw new HttpError(400, pe);
  const pr = db.get("SELECT * FROM password_resets WHERE user_id=? AND used=0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1", user.id);
  if (!pr || pr.attempts >= 5) bad();
  db.run('UPDATE password_resets SET attempts=attempts+1 WHERE id=?', pr.id);
  const a = Buffer.from(S.hashOtp(String(otp))), b = Buffer.from(pr.otp_hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) bad();
  const hash = await S.hashPassword(password);
  db.run('UPDATE users SET password_hash=?, token_version=token_version+1, failed_logins=0, locked_until=NULL WHERE id=?', hash, user.id);
  db.run('UPDATE password_resets SET used=1 WHERE id=?', pr.id);
  notify(user.id, user.hotel_id, 'Password changed', 'Your password was reset. If this was not you, contact support.', 'Security');
  ctx.json({ ok: true, message: 'Password updated. You can log in now.' });
});

router.post('/api/auth/change-password', requireAuth(), async (ctx) => {
  const { current, password } = ctx.body;
  const row = db.get('SELECT * FROM users WHERE id=?', ctx.user.id);
  if (!(await S.verifyPassword(String(current || ''), row.password_hash))) throw new HttpError(400, 'Current password is incorrect.');
  const pe = S.passwordPolicy(password); if (pe) throw new HttpError(400, pe);
  db.run('UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?', await S.hashPassword(password), ctx.user.id);
  const fresh = db.get('SELECT * FROM users WHERE id=?', ctx.user.id);
  startSession(ctx, fresh);                                           // keep this session alive, kill the others
  ctx.json({ ok: true });
});
