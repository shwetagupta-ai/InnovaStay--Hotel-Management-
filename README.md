# InnovaStay – Hotel Management System

A complete hotel booking and management website with four role-based portals, a blue/white theme with light and dark mode, animations, and a fully working backend and database.

* **Backend:** Node.js (built-in `http`, no framework)
* **Database:** SQLite (Node's built-in `node:sqlite`)
* **Frontend:** plain HTML, CSS and JavaScript (no build step)
* **Dependencies:** **none.** There is nothing to `npm install`.

## 1. Requirements

* **Node.js 22.13 or newer** (`node -v`). Download from https://nodejs.org if needed.

That is all. No database server, no packages, no internet connection needed (fonts load from Google Fonts when online and fall back to system fonts offline).

## 2. Quick start

```bash
unzip InnovaStay.zip
cd InnovaStay
npm start
```

Open **http://localhost:3000**

On the first start the app creates the database (`database/innovastay.db`) from `database/schema.sql` and loads demo data (6 hotels, ~84 rooms, staff, customers, six months of bookings, payments, invoices, food orders and feedback). This takes a few seconds. The demo dates are generated relative to the day of the first start, so the demo always looks current.

No `npm` available? Run `node backend/server.js` directly.

### Demo logins (click **Login** on the landing page and pick a portal)

| Portal | Username | Password |
|---|---|---|
| Customer | `customer` | `Customer@123` |
| Hotel Admin | `admin` (hotel 1), `admin2` … `admin6` | `Admin@123` |
| Staff | `reception`, `manager`, `housekeeping`, `restaurant`, `accountant`, `maintenance` | `Staff@123` |
| Platform Admin | `platform` | `Platform@123` |

You can log in with **username, e-mail or mobile number** plus password. **Change these passwords before any real use.**

## 3. Commands

| Command | What it does |
|---|---|
| `npm start` | Start the server (port 3000, or `PORT=8080 npm start`) |
| `npm run start:cluster` | One worker process per CPU core on the same port, for heavy traffic |
| `npm run dev` | Start with auto-restart on file changes |
| `npm run db:init` | Create tables and load demo data if the database is empty |
| `npm run db:reset` | **Delete** the database and reload fresh demo data |
| `npm test` | Run the end-to-end test suite against a running server (see section 8) |

## 4. Configuration (`.env`, optional)

Copy `.env.example` to `.env` and edit. Every setting has a safe default. For a real deployment set at least `NODE_ENV=production`, and `TRUST_PROXY=true` if you are behind nginx or a load balancer.

## 5. Database setup

* Schema: `database/schema.sql` (29 tables: users, roles, hotels, rooms, room_types, room_amenities, guests, guest_documents, reservations, reservation_guests, check_in_out, payments, invoices, food_menu, food_orders, food_order_items, employees, attendance, leave_requests, staff_tasks, housekeeping, maintenance, services, service_requests, feedback, offers, notifications, login_history, password_resets).
* It is applied automatically on start. To apply it by hand: `npm run db:init`.
* To start over with fresh demo data: `npm run db:reset`.
* To start with an **empty** system (no demo data), create the tables with `sqlite3 database/innovastay.db < database/schema.sql` and add your own hotels and admin users.
* Back up by copying `database/innovastay.db` while the server is stopped.

## 6. What is in each portal

* **Landing page:** hero image with search filter (city, price range, room type, number of people, optional dates), hotel results, destinations, offers, reviews, portal login menu, light/dark mode, responsive layout.
* **Customer:** book a stay (live availability, dynamic pricing, coupons), my bookings (modify, cancel with refund, pay, QR check-in pass, printable invoice), room service and extra services during a stay, feedback and complaints, offers and loyalty tier (Bronze/Silver/Gold), profile with ID proofs, notifications, account security.
* **Staff (receptionist, manager, housekeeping, restaurant, accountant, maintenance):** each department sees only its own menu. Front desk (arrivals, in-house, check-in with ID proof, check-out with bill settlement, room transfer, cancel), walk-in booking, floor view, reservations, guests, rooms, housekeeping tasks, maintenance tickets, payments, invoices, food orders, tasks, attendance punch, leave requests.
* **Hotel Admin:** everything above for one hotel, plus employees, attendance, leave approval, offers, services, feedback responses, reports, login history, dashboard KPIs and charts.
* **Platform Admin:** all hotels, hotel-admin accounts, users, room types, offers, cross-hotel reservations/feedback and login history, platform overview.
* **Invoices:** `/invoice.html?id=<booking id>` – printable / save as PDF from the browser.

## 7. Security

* Passwords hashed with scrypt (salted); strong-password rules.
* Login by username / e-mail / mobile; each portal accepts only its own role.
* Signed, HTTP-only, SameSite=Strict session cookies (Secure in production); sessions are invalidated on password change/reset.
* Account lock-out and rate limits on login, registration, password reset, booking and the whole API.
* Forgot password with a 6-digit one-time code (hashed, expires in 10 minutes, single use, 5 attempts).
* CSRF protection (custom header required on all state-changing calls), strict Content-Security-Policy and other security headers, parameterised SQL everywhere, role checks on every API route, hotel-level data isolation for hotel admins and staff.

## 8. Performance and testing

**Built for many simultaneous users:** SQLite in WAL mode (readers never block), compact indexes, in-memory caching of the public search, gzip, static files cached in memory, scrypt hashing off the main thread, write transactions that prevent double bookings, and `npm run start:cluster` for multi-core.

**What was actually tested (Node 22, Linux sandbox, final verification run):**

* `npm test` – **151 automated checks, 0 failures** in one run against the running server: public search and filters; login by username/e-mail for all four portals; wrong-portal and wrong-password rejection; CSRF header; navigation and every listed table for each role; role restrictions; the customer booking flow (quote, book, pay, check-in, room service and services on the bill, check-out, invoice); cancel + refund, modify, walk-in booking; registration, forgot/reset password, lock-out, change password; 200 parallel searches and 10 simultaneous bookings for one room.
* Browser test (headless Chromium): logged in through the real login page for all four portals and opened every sidebar page (customer 9, staff 17, hotel admin 27, platform admin 10) – no JavaScript errors and no failed HTTP requests. Landing page and customer dashboard checked at 390 px width in light mode – no horizontal overflow.
* **Not tested in the final verification:** cluster mode under load (`npm run start:cluster`), tablet width, dark-mode layout at small sizes, and behaviour with many thousands of concurrent users. The design choices below are intended for heavy traffic, but no load figure is claimed.

To run the tests yourself: start the server (`npm start`), and in a second terminal run `npm test` (or `BASE=http://localhost:3000 node tests/smoke.js`). The suite creates real bookings and accounts in the database, so run it on demo data, and run `npm run db:reset` and restart the server if it reports that no ready room is left. The login rate limit (10 attempts per account per 15 minutes) will also stop repeated runs, so restart the server between runs.

## 9. Known limitations (not done / not verified)

* **No e-mail / SMS sending.** Password-reset codes are printed in the server console (and returned in the API response only when `SHOW_RESET_OTP` is on). Connect your gateway at the marked line in `backend/routes/auth.js`. In-app notifications work; message delivery to phones/e-mail does not exist yet.
* **Payments are simulated** (Cash/Card/UPI are recorded, no real payment gateway).
* **No scheduled jobs:** automatic check-in/check-out reminders, pending-payment alerts and birthday offers are not automated. Notifications for bookings, payments, check-in/out, room-ready, orders and complaints are created when those events happen.
* **Reports:** all 12 (revenue, occupancy, bookings, cancellations, customers, rooms, food sales, employees, payments, tax, maintenance expense, profit/loss) load for hotel admins and are covered by the test suite, which checks that they respond, not that every figure was audited by hand. Accountants can open the financial ones. Payroll is shown through employee salary records, with no separate payslip generator.
* Some features from the wish-list (event/banquet booking, spa/gym/pool scheduling) are available only as bookable "extra services", without calendars.
* Several sidebar items share a generic information icon.
* Rate limits are held per worker process in memory, so in cluster mode the effective limit is up to N times the configured value.
* Uploaded photos are not supported; hotels and rooms use bundled illustrations.
* The browser test script was run from outside the project and is not included; only `tests/smoke.js` is shipped.

## 10. Project structure

```
InnovaStay/
├── README.md
├── package.json            scripts (no dependencies)
├── .env.example            optional settings
├── backend/
│   ├── server.js           HTTP server, security headers, routing, cluster mode
│   ├── config/             settings (index.js) and SQLite connection (db.js)
│   ├── middleware/auth.js  login session + role checks
│   ├── routes/             auth, account, public, customer, resources (generic tables),
│   │                       operations (front desk), analytics (stats, reports), definitions (table metadata)
│   └── utils/              http helpers, security, booking/pricing/billing logic, QR code generator
├── database/
│   ├── schema.sql          all tables and indexes
│   ├── seed.js, init.js    demo data and first-start setup
├── frontend/
│   ├── index.html          landing page
│   ├── login.html          login (4 portals), forgot password, sign-up
│   ├── dashboard.html      all portals' dashboard shell
│   ├── invoice.html        printable invoice
│   ├── css/  js/  assets/  styles, scripts, illustrations
├── tests/smoke.js          end-to-end test suite
└── uploads/                reserved
```
