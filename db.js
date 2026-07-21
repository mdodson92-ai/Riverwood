// db.js - SQLite database setup, schema, and seed data for the Riverwood Ecclesia portal
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

// On a host with a persistent disk (e.g. Render), set DB_DIR to that disk's
// mount path so the database survives restarts/redeploys. Locally this just
// falls back to a plain file next to this script.
const DB_DIR = process.env.DB_DIR || __dirname;
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const DB_PATH = path.join(DB_DIR, 'data.sqlite');

// Uploaded talk recordings live alongside the database, so on a host with a
// persistent disk (DB_DIR set) they survive restarts the same way the DB does.
const TALKS_DIR = path.join(DB_DIR, 'uploads', 'talks');
if (!fs.existsSync(TALKS_DIR)) fs.mkdirSync(TALKS_DIR, { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', -- 'admin' or 'member'
  phone TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS news_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  author_id INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_date TEXT NOT NULL, -- ISO date
  event_time TEXT,
  title TEXT NOT NULL,      -- e.g. 'Sunday Memorial Service'
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_name TEXT, -- free-text fallback for couple/guest duties not tied to a single login (e.g. "J+R Stone" hosting, or a visiting speaker)
  UNIQUE(event_id, role)
);

-- Date ranges a member has told us they're NOT available (e.g. on holidays).
CREATE TABLE IF NOT EXISTS availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Which duty roles a member is willing/able to do, for the auto-assign tool.
-- role here uses the PREFERENCE_ROLES keys (Reader/Emblem 1 and 2 collapse
-- into a single "Reader/Emblem" preference since it's the same skill).
CREATE TABLE IF NOT EXISTS role_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  UNIQUE(user_id, role)
);

-- Uploaded talk recordings (audio/video) members can browse and play back.
CREATE TABLE IF NOT EXISTS talks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  speaker TEXT,
  talk_date TEXT,
  description TEXT,
  filename TEXT NOT NULL,
  original_name TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// Ensure assigned_name exists for databases created before this column was added.
try {
  db.prepare('SELECT assigned_name FROM assignments LIMIT 1').get();
} catch (e) {
  db.exec('ALTER TABLE assignments ADD COLUMN assigned_name TEXT');
}

// Master list of every duty role used across the three meeting types, plus
// presets so the "Add event" form can pre-select the right roles.
const ROLES = [
  'Exhorter',
  'Chairman',
  'Reader/Emblem 1',
  'Reader/Emblem 2',
  'AV/Music',
  'Pianist',
  'Doorman',
  'Hosting',
  'Hall Duties / Emblem Wash',
  'Speaker',
  'Supper'
];

const ROLE_PRESETS = {
  'Sunday Memorial Meeting': ['Exhorter', 'Chairman', 'Reader/Emblem 1', 'Reader/Emblem 2', 'AV/Music', 'Pianist', 'Doorman', 'Hosting', 'Hall Duties / Emblem Wash'],
  'Sunday Evening Lecture': ['Speaker'],
  'Wednesday Bible Class': ['Speaker', 'Chairman', 'AV/Music', 'Pianist', 'Doorman', 'Supper']
};

// Roles that are traditionally assigned to a couple/pair rather than one
// individual login - the roster UI shows these as free text by default, and
// they're excluded from preferences/auto-assign (no single person "owns" them).
const COUPLE_ROLES = ['Hosting', 'Hall Duties / Emblem Wash', 'Supper'];

// The roles a member can express a preference for. "Reader/Emblem 1" and
// "Reader/Emblem 2" are the same skill from a member's point of view, so they
// collapse into one "Reader/Emblem" preference here.
const PREFERENCE_ROLES = ['Exhorter', 'Chairman', 'Reader/Emblem', 'AV/Music', 'Pianist', 'Doorman', 'Speaker'];

function roleToPreferenceKey(role) {
  if (role === 'Reader/Emblem 1' || role === 'Reader/Emblem 2') return 'Reader/Emblem';
  return role;
}

function seed() {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount > 0) {
    console.log('Database already has data, skipping seed.');
    return;
  }

  const seedDataPath = path.join(__dirname, 'data', 'seed-data.json');
  if (!fs.existsSync(seedDataPath)) {
    console.log('No data/seed-data.json found - starting with an empty database.');
    return;
  }
  const seedData = JSON.parse(fs.readFileSync(seedDataPath, 'utf8'));

  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password_hash, role, phone) VALUES (?, ?, ?, ?, ?)'
  );

  // Always keep one generic fallback admin login in case real accounts need recovery.
  insertUser.run('Ecclesia Admin', 'admin@riverwoodce.org.au', bcrypt.hashSync('ChangeMe123!', 10), 'admin', null);

  // Load every real member from the Riverwood speaking list / contact directory.
  const userIdByIndex = seedData.individuals.map(person =>
    insertUser.run(
      person.name,
      person.email,
      bcrypt.hashSync(person.password || 'Riverwood2026!', 10),
      person.role || 'member',
      person.phone || null
    ).lastInsertRowid
  );

  const insertPost = db.prepare('INSERT INTO news_posts (title, body, author_id) VALUES (?, ?, ?)');
  const firstAdminId = db.prepare("SELECT id FROM users WHERE email = 'admin@riverwoodce.org.au'").get().id;
  insertPost.run(
    'Welcome to the new Members Portal',
    'Hi everyone! This is our new home for ecclesia news and the July-December 2026 speaking list. You can always see what you are rostered on for under "My Schedule", and the full roster (with everyone\'s duties) is under "Roster". If you can no longer make an appointment, please arrange a substitute and let the recorder know. - "For I am not ashamed of the gospel, for it is the power of God for salvation to everyone who believes." Romans 1:16',
    firstAdminId
  );
  insertPost.run(
    'First login? Read this',
    'Your account has been set up with the temporary password Riverwood2026! - please log in and consider it a placeholder only. An admin can reset your password any time from the Admin page if you get locked out.',
    firstAdminId
  );

  const insertEvent = db.prepare('INSERT INTO events (event_date, event_time, title, notes) VALUES (?, ?, ?, ?)');
  const insertAssignment = db.prepare('INSERT INTO assignments (event_id, role, user_id, assigned_name) VALUES (?, ?, ?, ?)');

  (seedData.events || []).forEach(ev => {
    const eventResult = insertEvent.run(ev.event_date, ev.event_time || null, ev.title, ev.notes || null);
    const eventId = eventResult.lastInsertRowid;
    (ev.assignments || []).forEach(a => {
      if (a.kind === 'user') {
        insertAssignment.run(eventId, a.role, userIdByIndex[a.value], null);
      } else {
        insertAssignment.run(eventId, a.role, null, a.value);
      }
    });
  });

  console.log('Seed complete: loaded', userIdByIndex.length, 'real members and', (seedData.events || []).length, 'events from data/seed-data.json.');
  console.log('Fallback admin login: admin@riverwoodce.org.au / ChangeMe123!');
  console.log('Every real member\'s temporary password: Riverwood2026!');
}

if (require.main === module && process.argv.includes('--seed')) {
  seed();
}

module.exports = { db, seed, ROLES, ROLE_PRESETS, COUPLE_ROLES, PREFERENCE_ROLES, roleToPreferenceKey, DB_DIR, TALKS_DIR };
