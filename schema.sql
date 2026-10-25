CREATE TABLE IF NOT EXISTS roles (
  name        TEXT PRIMARY KEY,               -- platform_admin | admin | staff | customer
  description TEXT
);

CREATE TABLE IF NOT EXISTS hotels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  city        TEXT NOT NULL,
  state       TEXT,
  address     TEXT,
  stars       INTEGER DEFAULT 4,
  description TEXT,
  phone       TEXT,
  email       TEXT,
  rating      REAL DEFAULT 4.5,
  status      TEXT DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT UNIQUE COLLATE NOCASE,
  mobile        TEXT UNIQUE,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL REFERENCES roles(name),
  hotel_id      INTEGER REFERENCES hotels(id),    -- admin / staff belong to a hotel
  status        TEXT DEFAULT 'Active' CHECK (status IN ('Active','Suspended')),
  failed_logins INTEGER DEFAULT 0,
  token_version INTEGER DEFAULT 0,
  locked_until  TEXT,
  last_login    TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS login_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  identifier TEXT,
  portal     TEXT,
  ip         TEXT,
  user_agent TEXT,
  success    INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_resets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_hash   TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts   INTEGER DEFAULT 0,
  used       INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guests (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  created_hotel_id INTEGER REFERENCES hotels(id),
  full_name        TEXT NOT NULL,
  mobile           TEXT,
  email            TEXT,
  gender           TEXT,
  dob              TEXT,
  address          TEXT,
  emergency_name   TEXT,
  emergency_phone  TEXT,
  preferences      TEXT,
  loyalty_points   INTEGER DEFAULT 0,
  membership       TEXT DEFAULT 'Bronze' CHECK (membership IN ('Bronze','Silver','Gold')),
  referral_code    TEXT,
  is_blacklisted   INTEGER DEFAULT 0,
  blacklist_reason TEXT,
  created_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guest_documents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id   INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  doc_type   TEXT NOT NULL CHECK (doc_type IN ('Aadhaar','Passport','Driving License','Voter ID','Other')),
  doc_number TEXT NOT NULL,
  verified   INTEGER DEFAULT 0,
  notes      TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS room_types (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,           -- Single, Double, Deluxe, Suite, Family
  description TEXT,
  base_price  REAL NOT NULL,
  max_guests  INTEGER DEFAULT 2
);

CREATE TABLE IF NOT EXISTS rooms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id    INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  room_no     TEXT NOT NULL,
  floor       INTEGER DEFAULT 1,
  type_id     INTEGER NOT NULL REFERENCES room_types(id),
  price       REAL NOT NULL,
  capacity    INTEGER DEFAULT 2,
  status      TEXT DEFAULT 'Available' CHECK (status IN ('Available','Reserved','Occupied','Cleaning','Maintenance','Out of Service')),
  description TEXT,
  photo       TEXT,
  UNIQUE (hotel_id, room_no)
);

CREATE TABLE IF NOT EXISTS room_amenities (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id  INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  amenity  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reservations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_ref   TEXT NOT NULL UNIQUE,
  hotel_id      INTEGER NOT NULL REFERENCES hotels(id),
  guest_id      INTEGER NOT NULL REFERENCES guests(id),
  room_id       INTEGER NOT NULL REFERENCES rooms(id),
  check_in      TEXT NOT NULL,
  check_out     TEXT NOT NULL,
  adults        INTEGER DEFAULT 1,
  children      INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'Confirmed' CHECK (status IN ('Pending','Confirmed','Checked-in','Checked-out','Cancelled','No-show','Waiting')),
  booking_type  TEXT DEFAULT 'Online' CHECK (booking_type IN ('Online','Walk-in','Group','Offline')),
  room_pref     TEXT,
  early_checkin INTEGER DEFAULT 0,
  late_checkout INTEGER DEFAULT 0,
  room_total    REAL DEFAULT 0,
  discount      REAL DEFAULT 0,
  coupon        TEXT,
  qr_token      TEXT UNIQUE,
  notes         TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reservation_guests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  age            INTEGER,
  id_proof       TEXT
);

CREATE TABLE IF NOT EXISTS check_in_out (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id       INTEGER NOT NULL REFERENCES hotels(id),
  reservation_id INTEGER NOT NULL REFERENCES reservations(id),
  room_id        INTEGER NOT NULL REFERENCES rooms(id),
  checkin_time   TEXT,
  checkout_time  TEXT,
  handled_by     INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id       INTEGER NOT NULL REFERENCES hotels(id),
  reservation_id INTEGER NOT NULL REFERENCES reservations(id),
  amount         REAL NOT NULL,
  method         TEXT DEFAULT 'Cash' CHECK (method IN ('Cash','Card','UPI')),
  type           TEXT DEFAULT 'Partial' CHECK (type IN ('Advance','Partial','Final','Refund')),
  reference      TEXT,
  paid_at        TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id        INTEGER NOT NULL REFERENCES hotels(id),
  invoice_no      TEXT NOT NULL UNIQUE,
  reservation_id  INTEGER NOT NULL REFERENCES reservations(id),
  room_charges    REAL DEFAULT 0,
  food_charges    REAL DEFAULT 0,
  service_charges REAL DEFAULT 0,
  discount        REAL DEFAULT 0,
  tax             REAL DEFAULT 0,
  total           REAL DEFAULT 0,
  paid            REAL DEFAULT 0,
  status          TEXT DEFAULT 'Unpaid' CHECK (status IN ('Unpaid','Partial','Paid','Refunded')),
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS food_menu (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id    INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  category    TEXT DEFAULT 'Main Course',
  price       REAL NOT NULL,
  available   INTEGER DEFAULT 1,
  description TEXT
);

CREATE TABLE IF NOT EXISTS food_orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id        INTEGER NOT NULL REFERENCES hotels(id),
  reservation_id  INTEGER REFERENCES reservations(id),
  room_id         INTEGER REFERENCES rooms(id),
  table_no        TEXT,
  order_type      TEXT DEFAULT 'Room Service' CHECK (order_type IN ('Room Service','Dine-in')),
  status          TEXT DEFAULT 'Placed' CHECK (status IN ('Placed','Preparing','Ready','Delivered','Cancelled')),
  special_request TEXT,
  total           REAL DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS food_order_items (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES food_orders(id) ON DELETE CASCADE,
  menu_id  INTEGER NOT NULL REFERENCES food_menu(id),
  qty      INTEGER NOT NULL DEFAULT 1,
  price    REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id    INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  user_id     INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  staff_code  TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  department  TEXT NOT NULL CHECK (department IN ('Receptionist','Manager','Housekeeping','Restaurant','Accountant','Maintenance')),
  designation TEXT,
  mobile      TEXT,
  email       TEXT,
  salary      REAL DEFAULT 0,
  shift       TEXT DEFAULT 'Morning' CHECK (shift IN ('Morning','Evening','Night')),
  performance INTEGER DEFAULT 3,
  joined_on   TEXT,
  status      TEXT DEFAULT 'Active' CHECK (status IN ('Active','Inactive'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id    INTEGER NOT NULL REFERENCES hotels(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date   TEXT NOT NULL,
  status      TEXT DEFAULT 'Present' CHECK (status IN ('Present','Absent','Half-day','Leave')),
  check_in    TEXT,
  check_out   TEXT,
  UNIQUE (employee_id, work_date)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id    INTEGER NOT NULL REFERENCES hotels(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  from_date   TEXT NOT NULL,
  to_date     TEXT NOT NULL,
  reason      TEXT,
  status      TEXT DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected'))
);

CREATE TABLE IF NOT EXISTS staff_tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id    INTEGER NOT NULL REFERENCES hotels(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  details     TEXT,
  due_date    TEXT,
  status      TEXT DEFAULT 'Pending' CHECK (status IN ('Pending','In Progress','Done'))
);

CREATE TABLE IF NOT EXISTS housekeeping (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id      INTEGER NOT NULL REFERENCES hotels(id),
  room_id       INTEGER NOT NULL REFERENCES rooms(id),
  assigned_to   INTEGER REFERENCES employees(id),
  task          TEXT DEFAULT 'Cleaning' CHECK (task IN ('Cleaning','Inspection','Linen','Towels','Supplies','Lost & Found','Request')),
  status        TEXT DEFAULT 'Pending' CHECK (status IN ('Pending','In Progress','Done')),
  scheduled_at  TEXT,
  notes         TEXT,
  inspection_ok INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS maintenance (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id       INTEGER NOT NULL REFERENCES hotels(id),
  room_id        INTEGER REFERENCES rooms(id),
  category       TEXT DEFAULT 'Electrical' CHECK (category IN ('Electrical','Plumbing','AC','Furniture','Other')),
  description    TEXT NOT NULL,
  priority       TEXT DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High','Urgent')),
  status         TEXT DEFAULT 'Open' CHECK (status IN ('Open','Assigned','In Progress','Resolved')),
  assigned_to    INTEGER REFERENCES employees(id),
  cost           REAL DEFAULT 0,
  blocks_room    INTEGER DEFAULT 0,
  preventive     INTEGER DEFAULT 0,
  scheduled_date TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  resolved_at    TEXT
);

CREATE TABLE IF NOT EXISTS services (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id  INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  category  TEXT DEFAULT 'Other',
  price     REAL NOT NULL,
  available INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS service_requests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id       INTEGER NOT NULL REFERENCES hotels(id),
  service_id     INTEGER NOT NULL REFERENCES services(id),
  reservation_id INTEGER REFERENCES reservations(id),
  guest_id       INTEGER REFERENCES guests(id),
  quantity       INTEGER DEFAULT 1,
  amount         REAL DEFAULT 0,
  status         TEXT DEFAULT 'Requested' CHECK (status IN ('Requested','Confirmed','Completed','Cancelled')),
  requested_for  TEXT,
  notes          TEXT,
  created_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feedback (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id       INTEGER NOT NULL REFERENCES hotels(id),
  guest_id       INTEGER REFERENCES guests(id),
  reservation_id INTEGER REFERENCES reservations(id),
  kind           TEXT DEFAULT 'Feedback' CHECK (kind IN ('Feedback','Complaint')),
  room_rating    INTEGER,
  food_rating    INTEGER,
  staff_rating   INTEGER,
  hotel_rating   INTEGER,
  comment        TEXT,
  status         TEXT DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Resolved')),
  admin_response TEXT,
  created_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS offers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id      INTEGER REFERENCES hotels(id) ON DELETE CASCADE,  -- NULL = platform-wide
  title         TEXT NOT NULL,
  code          TEXT NOT NULL,
  kind          TEXT DEFAULT 'Coupon' CHECK (kind IN ('Coupon','Seasonal','Birthday','Referral','Loyalty')),
  discount_type TEXT DEFAULT 'percent' CHECK (discount_type IN ('percent','flat')),
  value         REAL NOT NULL,
  min_amount    REAL DEFAULT 0,
  valid_from    TEXT,
  valid_to      TEXT,
  active        INTEGER DEFAULT 1,
  UNIQUE (hotel_id, code)
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  hotel_id   INTEGER REFERENCES hotels(id),
  title      TEXT NOT NULL,
  message    TEXT,
  type       TEXT DEFAULT 'Info',
  is_read    INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_res_room_dates ON reservations(room_id, check_in, check_out);

CREATE INDEX IF NOT EXISTS idx_res_hotel ON reservations(hotel_id, status);

CREATE INDEX IF NOT EXISTS idx_res_guest ON reservations(guest_id);

CREATE INDEX IF NOT EXISTS idx_pay_res ON payments(reservation_id);

CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
