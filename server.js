// server.js - Riverwood Ecclesia members portal API + static site
const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { db, seed, ROLES, ROLE_PRESETS, COUPLE_ROLES, PREFERENCE_ROLES, roleToPreferenceKey, TALKS_DIR } = require('./db');

seed(); // no-op if data already exists

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Auth helpers ----------
function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  next();
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone };
}

// ---------- Talks upload storage ----------
const talksStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TALKS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});
const uploadTalk = multer({
  storage: talksStorage,
  limits: { fileSize: 150 * 1024 * 1024 }, // 150MB per recording
  fileFilter: (req, file, cb) => {
    const okByMime = /^audio\//.test(file.mimetype) || /^video\//.test(file.mimetype);
    const okByExt = /\.(mp3|m4a|wav|aac|ogg|opus|mp4|mov|m4v)$/i.test(file.originalname);
    if (okByMime || okByExt) return cb(null, true);
    cb(new Error('Only audio or video recordings can be uploaded'));
  }
});

// ---------- Auth routes ----------
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(user) });
});

// ---------- News feed ----------
app.get('/api/news', requireAuth, (req, res) => {
  const posts = db.prepare(`
    SELECT news_posts.*, users.name AS author_name
    FROM news_posts JOIN users ON users.id = news_posts.author_id
    ORDER BY news_posts.created_at DESC
  `).all();
  res.json({ posts });
});

app.post('/api/news', requireAuth, requireAdmin, (req, res) => {
  const { title, body } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'Title and body required' });
  const result = db.prepare('INSERT INTO news_posts (title, body, author_id) VALUES (?, ?, ?)')
    .run(title.trim(), body.trim(), req.user.id);
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/news/:id', requireAuth, requireAdmin, (req, res) => {
  const { title, body } = req.body || {};
  db.prepare('UPDATE news_posts SET title = ?, body = ? WHERE id = ?')
    .run(title.trim(), body.trim(), req.params.id);
  res.json({ ok: true });
});

app.delete('/api/news/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM news_posts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Roles ----------
app.get('/api/roles', requireAuth, (req, res) => {
  res.json({ roles: ROLES, presets: ROLE_PRESETS, coupleRoles: COUPLE_ROLES, preferenceRoles: PREFERENCE_ROLES });
});

// ---------- Events + roster ----------
app.get('/api/events', requireAuth, (req, res) => {
  const upcomingOnly = req.query.upcoming === 'true';
  const today = new Date().toISOString().slice(0, 10);
  const events = upcomingOnly
    ? db.prepare('SELECT * FROM events WHERE event_date >= ? ORDER BY event_date ASC, event_time ASC').all(today)
    : db.prepare('SELECT * FROM events ORDER BY event_date ASC, event_time ASC').all();

  const assignmentStmt = db.prepare(`
    SELECT assignments.id, assignments.role, assignments.user_id, assignments.assigned_name, users.name AS user_name
    FROM assignments LEFT JOIN users ON users.id = assignments.user_id
    WHERE assignments.event_id = ?
  `);
  const eventsWithAssignments = events.map(ev => ({
    ...ev,
    assignments: assignmentStmt.all(ev.id)
  }));
  res.json({ events: eventsWithAssignments });
});

app.post('/api/events', requireAuth, requireAdmin, (req, res) => {
  const { event_date, event_time, title, notes, roles } = req.body || {};
  if (!event_date || !title) return res.status(400).json({ error: 'Date and title required' });
  const result = db.prepare('INSERT INTO events (event_date, event_time, title, notes) VALUES (?, ?, ?, ?)')
    .run(event_date, event_time || null, title.trim(), notes || null);
  const eventId = result.lastInsertRowid;
  const rolesToAdd = Array.isArray(roles) && roles.length ? roles : (ROLE_PRESETS[title.trim()] || ROLES);
  const insertAssignment = db.prepare('INSERT INTO assignments (event_id, role, user_id, assigned_name) VALUES (?, ?, NULL, NULL)');
  rolesToAdd.forEach(role => insertAssignment.run(eventId, role));
  res.json({ id: eventId });
});

app.delete('/api/events/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Assign or unassign a member (or free-text name, e.g. a couple's hosting duty
// or a visiting speaker) to a role on an event. Setting one clears the other.
app.put('/api/events/:id/assignments', requireAuth, requireAdmin, (req, res) => {
  const { role, user_id, assigned_name } = req.body || {};
  if (!role) return res.status(400).json({ error: 'Role required' });
  const userId = user_id || null;
  const assignedName = userId ? null : (assigned_name ? String(assigned_name).trim() || null : null);
  const existing = db.prepare('SELECT * FROM assignments WHERE event_id = ? AND role = ?')
    .get(req.params.id, role);
  if (existing) {
    db.prepare('UPDATE assignments SET user_id = ?, assigned_name = ? WHERE id = ?')
      .run(userId, assignedName, existing.id);
  } else {
    db.prepare('INSERT INTO assignments (event_id, role, user_id, assigned_name) VALUES (?, ?, ?, ?)')
      .run(req.params.id, role, userId, assignedName);
  }
  res.json({ ok: true });
});

// ---------- My schedule ----------
app.get('/api/my-schedule', requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT events.id AS event_id, events.event_date, events.event_time, events.title AS event_title,
           assignments.role
    FROM assignments
    JOIN events ON events.id = assignments.event_id
    WHERE assignments.user_id = ? AND events.event_date >= ?
    ORDER BY events.event_date ASC, events.event_time ASC
  `).all(req.user.id, today);
  res.json({ schedule: rows });
});

// ---------- Member management (admin) ----------
app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, name, email, role, phone, created_at FROM users ORDER BY name ASC').all();
  res.json({ users });
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { name, email, password, role, phone } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, password required' });
  try {
    const result = db.prepare(
      'INSERT INTO users (name, email, password_hash, role, phone) VALUES (?, ?, ?, ?, ?)'
    ).run(name.trim(), email.toLowerCase().trim(), bcrypt.hashSync(password, 10), role === 'admin' ? 'admin' : 'member', phone || null);
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'That email is already registered' });
  }
});

app.put('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const { name, role, phone } = req.body || {};
  db.prepare('UPDATE users SET name = ?, role = ?, phone = ? WHERE id = ?')
    .run(name, role === 'admin' ? 'admin' : 'member', phone || null, req.params.id);
  res.json({ ok: true });
});

app.post('/api/users/:id/reset-password', requireAuth, requireAdmin, (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const result = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(password, 10), req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Member not found' });
  res.json({ ok: true });
});

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: "You can't remove your own account" });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- My availability (date ranges I'm NOT available) ----------
app.get('/api/my-availability', requireAuth, (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM availability WHERE user_id = ? ORDER BY start_date ASC'
  ).all(req.user.id);
  res.json({ availability: rows });
});

app.post('/api/my-availability', requireAuth, (req, res) => {
  const { start_date, end_date, reason } = req.body || {};
  if (!start_date || !end_date) return res.status(400).json({ error: 'Start and end date required' });
  if (end_date < start_date) return res.status(400).json({ error: 'End date must be on or after the start date' });
  const result = db.prepare(
    'INSERT INTO availability (user_id, start_date, end_date, reason) VALUES (?, ?, ?, ?)'
  ).run(req.user.id, start_date, end_date, (reason || '').trim() || null);
  res.json({ id: result.lastInsertRowid });
});

app.delete('/api/my-availability/:id', requireAuth, (req, res) => {
  // Members can only delete their own; admins can clear anyone's (useful when
  // tidying up on someone's behalf).
  const row = db.prepare('SELECT * FROM availability WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not yours to delete' });
  }
  db.prepare('DELETE FROM availability WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- My duty preferences (which roles I'm willing/able to do) ----------
app.get('/api/my-preferences', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT role FROM role_preferences WHERE user_id = ?').all(req.user.id);
  res.json({ roles: rows.map(r => r.role) });
});

app.put('/api/my-preferences', requireAuth, (req, res) => {
  const { roles } = req.body || {};
  if (!Array.isArray(roles)) return res.status(400).json({ error: 'roles must be an array' });
  const valid = roles.filter(r => PREFERENCE_ROLES.includes(r));
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM role_preferences WHERE user_id = ?').run(req.user.id);
    const insert = db.prepare('INSERT INTO role_preferences (user_id, role) VALUES (?, ?)');
    valid.forEach(role => insert.run(req.user.id, role));
  });
  tx();
  res.json({ ok: true, roles: valid });
});

// ---------- Admin: auto-assign unfilled duties ----------
// Fills only currently-empty individual-linked roles (never couple roles like
// Hosting/Supper, and never overwrites an existing assignment). For each
// empty slot, eligible candidates are members who (a) have opted into that
// role's preference, and (b) aren't marked unavailable on that event's date.
// Among eligible candidates, whoever currently has the fewest duties in this
// run gets it, and nobody is double-booked on the same event. Slots with no
// eligible candidate are left empty and reported back.
app.post('/api/admin/auto-assign', requireAuth, requireAdmin, (req, res) => {
  const { from_date, to_date } = req.body || {};
  const today = new Date().toISOString().slice(0, 10);
  const startDate = from_date || today;
  const endDate = to_date || '2999-12-31';

  const events = db.prepare(
    'SELECT * FROM events WHERE event_date >= ? AND event_date <= ? ORDER BY event_date ASC, event_time ASC'
  ).all(startDate, endDate);

  const allMembers = db.prepare('SELECT id, name FROM users').all();

  const preferencesByUser = {};
  db.prepare('SELECT user_id, role FROM role_preferences').all().forEach(row => {
    (preferencesByUser[row.user_id] = preferencesByUser[row.user_id] || []).push(row.role);
  });

  const availabilityByUser = {};
  db.prepare('SELECT user_id, start_date, end_date FROM availability').all().forEach(row => {
    (availabilityByUser[row.user_id] = availabilityByUser[row.user_id] || []).push(row);
  });
  function isUnavailable(userId, date) {
    return (availabilityByUser[userId] || []).some(r => date >= r.start_date && date <= r.end_date);
  }

  // Track how many duties each member already has (existing assignments in
  // the whole system, not just this window) so "fewest duties" reflects real
  // fairness, then add to it as we hand out new ones in this run.
  const dutyCount = {};
  allMembers.forEach(m => { dutyCount[m.id] = 0; });
  db.prepare('SELECT user_id, COUNT(*) AS c FROM assignments WHERE user_id IS NOT NULL GROUP BY user_id').all()
    .forEach(row => { dutyCount[row.user_id] = row.c; });

  const assignmentStmt = db.prepare('SELECT * FROM assignments WHERE event_id = ?');
  const updateStmt = db.prepare('UPDATE assignments SET user_id = ? WHERE id = ?');

  const filled = [];
  const skipped = [];

  events.forEach(ev => {
    const assignmentsForEvent = assignmentStmt.all(ev.id);
    const alreadyUsedToday = new Set(
      assignmentsForEvent.filter(a => a.user_id).map(a => a.user_id)
    );

    assignmentsForEvent.forEach(a => {
      if (a.user_id || a.assigned_name) return; // already filled, leave it
      if (COUPLE_ROLES.includes(a.role)) return; // never auto-assign couple duties
      const prefKey = roleToPreferenceKey(a.role);

      const candidates = allMembers.filter(m =>
        (preferencesByUser[m.id] || []).includes(prefKey) &&
        !isUnavailable(m.id, ev.event_date) &&
        !alreadyUsedToday.has(m.id)
      );

      if (!candidates.length) {
        skipped.push({ event: ev.title, date: ev.event_date, role: a.role, reason: 'No one available and willing' });
        return;
      }

      candidates.sort((x, y) => dutyCount[x.id] - dutyCount[y.id]);
      const chosen = candidates[0];
      updateStmt.run(chosen.id, a.id);
      dutyCount[chosen.id] += 1;
      alreadyUsedToday.add(chosen.id);
      filled.push({ event: ev.title, date: ev.event_date, role: a.role, member: chosen.name });
    });
  });

  res.json({ filled, skipped });
});

// ---------- Talks (uploaded recordings) ----------
app.get('/api/talks', requireAuth, (req, res) => {
  const talks = db.prepare(`
    SELECT talks.*, users.name AS uploaded_by_name
    FROM talks JOIN users ON users.id = talks.uploaded_by
    ORDER BY COALESCE(talks.talk_date, talks.created_at) DESC, talks.created_at DESC
  `).all();
  res.json({ talks });
});

app.post('/api/talks', requireAuth, requireAdmin, uploadTalk.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Please choose an audio or video file' });
  const { title, speaker, talk_date, description } = req.body || {};
  if (!title || !title.trim()) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Title required' });
  }
  const result = db.prepare(
    'INSERT INTO talks (title, speaker, talk_date, description, filename, original_name, mime_type, size_bytes, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    title.trim(),
    (speaker || '').trim() || null,
    talk_date || null,
    (description || '').trim() || null,
    req.file.filename,
    req.file.originalname,
    req.file.mimetype,
    req.file.size,
    req.user.id
  );
  res.json({ id: result.lastInsertRowid });
});

app.delete('/api/talks/:id', requireAuth, requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM talks WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM talks WHERE id = ?').run(req.params.id);
  fs.unlink(path.join(TALKS_DIR, row.filename), () => {});
  res.json({ ok: true });
});

// Stream/download an uploaded talk - gated behind login like everything else here.
app.get('/uploads/talks/:filename', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM talks WHERE filename = ?').get(req.params.filename);
  if (!row) return res.status(404).end();
  res.sendFile(path.join(TALKS_DIR, row.filename));
});

// Friendlier error messages for upload problems (wrong file type, too large).
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large (150MB limit).' : err.message;
    return res.status(400).json({ error: msg });
  }
  if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
  next();
});

app.listen(PORT, () => {
  console.log(`Riverwood Ecclesia portal running on http://localhost:${PORT}`);
});
