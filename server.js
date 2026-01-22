const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const BACKUP_DIR = path.join(__dirname, 'backups');
const MAX_BACKUPS = process.env.MAX_BACKUPS ? parseInt(process.env.MAX_BACKUPS, 10) : 8;
const BACKUP_CRON = process.env.BACKUP_CRON || '0 3 * * 0,3'; // 3am Sunday & Wednesday (2x/week)

// Ensure backup dir exists
try {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
} catch (e) {
  console.warn('Could not create backup dir:', e.message);
}

// Rate limiting
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  message: { error: 'Too many requests. Slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({ limit: '64kb' }));
app.use(express.static('public'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  },
  name: 'quotes.sid',
}));

// Database
const dbPath = path.join(__dirname, 'quotes.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// --- Backups ---
function runBackup() {
  const dest = path.join(BACKUP_DIR, `quotes-${Date.now()}.db`);
  try {
    fs.copyFileSync(dbPath, dest);
    const files = fs.readdirSync(BACKUP_DIR)
      .map(f => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime() }))
      .sort((a, b) => b.mtime - a.mtime);
    while (files.length > MAX_BACKUPS) {
      const victim = files.pop();
      fs.unlinkSync(path.join(BACKUP_DIR, victim.name));
    }
    console.log('Backup completed:', path.basename(dest));
  } catch (e) {
    console.error('Backup failed:', e.message);
  }
}

cron.schedule(BACKUP_CRON, runBackup);
console.log('Backups scheduled:', BACKUP_CRON, '| keep last', MAX_BACKUPS);

// --- Schema & init ---
function initializeDatabase() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS user_groups (
      user_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, group_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (group_id) REFERENCES groups(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_text TEXT NOT NULL,
      person_id INTEGER NOT NULL,
      added_by INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (person_id) REFERENCES users(id),
      FOREIGN KEY (added_by) REFERENCES users(id),
      FOREIGN KEY (group_id) REFERENCES groups(id)
    )`, () => {
      db.all('PRAGMA table_info(quotes)', (err, rows) => {
        if (err) return void ensureDefaultGroupAndAdmin();
        const cols = (rows || []).map(r => r.name);
        if (cols.includes('group_id')) {
          return void ensureDefaultGroupAndAdmin();
        }
        db.run('ALTER TABLE quotes ADD COLUMN group_id INTEGER REFERENCES groups(id)', (e) => {
          if (e) console.warn('Migration group_id:', e.message);
          ensureDefaultGroupAndAdmin();
        });
      });
    });
  });
}

function ensureDefaultGroupAndAdmin() {
  db.get('SELECT COUNT(*) as c FROM users', (err, r) => {
    if (err || !r) return;
    const noUsers = r.c === 0;
    db.get('SELECT id FROM groups WHERE name = ?', ['Everyone'], (e, g) => {
      let defaultGroupId = g && g.id;
      const createGroup = (cb) => {
        db.run('INSERT INTO groups (name) VALUES (?)', ['Everyone'], function(er) {
          if (er) return cb(er);
          defaultGroupId = this.lastID;
          cb();
        });
      };
      const createAdmin = () => {
        const hash = bcrypt.hashSync('admin123', 10);
        db.run(
          'INSERT INTO users (username, password, display_name, is_admin) VALUES (?,?,?,?)',
          ['admin', hash, 'Admin', 1],
          function(er) {
            if (er) {
              console.error('Create admin:', er.message);
              return;
            }
            const uid = this.lastID;
            db.run('INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES (?,?)', [uid, defaultGroupId], () => {
              console.log('Default admin created: admin / admin123');
            });
          }
        );
      };
      const migrateQuotes = () => {
        db.run('UPDATE quotes SET group_id = ? WHERE group_id IS NULL', [defaultGroupId], (er) => {
          if (er) console.warn('Migrate quotes:', er.message);
        });
      };
      const addAllToEveryone = () => {
        db.all('SELECT id FROM users', (e, users) => {
          if (e || !users) return;
          const stmt = db.prepare('INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES (?,?)');
          users.forEach(u => stmt.run(u.id, defaultGroupId));
          stmt.finalize();
        });
      };

      if (!defaultGroupId) {
        createGroup((er) => {
          if (er) {
            console.error('Create Everyone group:', er.message);
            return;
          }
          if (noUsers) createAdmin();
          migrateQuotes();
          addAllToEveryone();
        });
      } else {
        if (noUsers) createAdmin();
        migrateQuotes();
        addAllToEveryone();
      }
    });
  });
}

// --- Auth helpers ---
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.userId && req.session.isAdmin) return next();
  res.status(403).json({ error: 'Admin access required' });
}

function getUserGroupIds(userId, cb) {
  db.all('SELECT group_id FROM user_groups WHERE user_id = ?', [userId], (err, rows) => {
    if (err) return cb(err);
    cb(null, (rows || []).map(r => r.group_id));
  });
}

const SORT_WHITELIST = { date_desc: true, date_asc: true, person: true };

// --- Validation ---
function sanitizeQuote(s) {
  if (typeof s !== 'string') return '';
  return s.trim().slice(0, 4096);
}

function sanitizeUsername(s) {
  if (typeof s !== 'string') return '';
  return s.trim().slice(0, 64).replace(/[^\w.-]/g, '');
}

function sanitizeDisplayName(s) {
  if (typeof s !== 'string') return '';
  return s.trim().slice(0, 128);
}

// --- Routes ---

app.post('/api/login', loginLimiter, (req, res) => {
  const username = sanitizeUsername(req.body.username);
  const password = req.body.password;
  if (!username || !password) {
    return res.status(400).json({ error: 'Invalid credentials' });
  }

  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    bcrypt.compare(password, user.password, (e, ok) => {
      if (e || !ok) return res.status(401).json({ error: 'Invalid credentials' });
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.displayName = user.display_name;
      req.session.isAdmin = user.is_admin === 1;
      res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          isAdmin: user.is_admin === 1,
        },
      });
    });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {});
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // Check if user is only in "Everyone" group (hide group UI for them)
  db.get(
    `SELECT COUNT(*) as group_count,
     SUM(CASE WHEN g.name = 'Everyone' THEN 1 ELSE 0 END) as everyone_count
     FROM user_groups ug
     JOIN groups g ON g.id = ug.group_id
     WHERE ug.user_id = ?`,
    [req.session.userId],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      // showGroupUI = false if user is only in "Everyone" (and not admin)
      // Admins always see group UI
      const showGroupUI = req.session.isAdmin || (row.group_count > 1 || row.everyone_count === 0);
      
      res.json({
        id: req.session.userId,
        username: req.session.username,
        displayName: req.session.displayName,
        isAdmin: req.session.isAdmin,
        showGroupUI: showGroupUI,
      });
    }
  );
});

app.use('/api', apiLimiter);

app.get('/api/groups', requireAuth, (req, res) => {
  db.all(
    `SELECT g.id, g.name FROM groups g
     INNER JOIN user_groups ug ON ug.group_id = g.id
     WHERE ug.user_id = ?
     ORDER BY g.name`,
    [req.session.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows || []);
    }
  );
});

app.get('/api/users', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const isAdmin = req.session.isAdmin;

  if (isAdmin) {
    db.all('SELECT id, username, display_name FROM users ORDER BY display_name', (err, users) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      return res.json(users || []);
    });
    return;
  }

  db.all(
    `SELECT DISTINCT u.id, u.username, u.display_name
     FROM users u
     INNER JOIN user_groups ug ON ug.user_id = u.id
     WHERE ug.group_id IN (SELECT group_id FROM user_groups WHERE user_id = ?)
     ORDER BY u.display_name`,
    [uid],
    (err, users) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(users || []);
    }
  );
});

app.post('/api/users', requireAdmin, (req, res) => {
  const username = sanitizeUsername(req.body.username);
  const password = req.body.password;
  const displayName = sanitizeDisplayName(req.body.displayName);
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  bcrypt.hash(password, 10, (err, hash) => {
    if (err) return res.status(500).json({ error: 'Error hashing password' });
    db.run(
      'INSERT INTO users (username, password, display_name) VALUES (?,?,?)',
      [username, hash, displayName],
      function(er) {
        if (er) {
          if (er.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username already exists' });
          return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true, userId: this.lastID });
      }
    );
  });
});

app.get('/api/quotes', requireAuth, (req, res) => {
  const sort = SORT_WHITELIST[req.query.sort] ? req.query.sort : 'date_desc';
  let orderBy = 'q.created_at DESC';
  if (sort === 'date_asc') orderBy = 'q.created_at ASC';
  else if (sort === 'person') orderBy = 'p.display_name ASC, q.created_at DESC';

  getUserGroupIds(req.session.userId, (err, gids) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!gids.length) return res.json([]);

    const placeholders = gids.map(() => '?').join(',');
    const sql = `SELECT q.id, q.quote_text, q.created_at, q.group_id,
          p.id as person_id, p.display_name as person_name,
          a.id as added_by_id, a.display_name as added_by_name,
          g.name as group_name
          FROM quotes q
          JOIN users p ON q.person_id = p.id
          JOIN users a ON q.added_by = a.id
          JOIN groups g ON q.group_id = g.id
          WHERE q.group_id IN (${placeholders})
          ORDER BY ${orderBy}`;
    db.all(sql, gids, (e, rows) => {
      if (e) return res.status(500).json({ error: 'Database error' });
      res.json(rows || []);
    });
  });
});

app.get('/api/quotes/random', requireAuth, (req, res) => {
  getUserGroupIds(req.session.userId, (err, gids) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!gids.length) return res.status(404).json({ error: 'No quotes found' });

    const placeholders = gids.map(() => '?').join(',');
    db.get(
      `SELECT q.id, q.quote_text, q.created_at, q.group_id,
        p.id as person_id, p.display_name as person_name,
        a.id as added_by_id, a.display_name as added_by_name,
        g.name as group_name
        FROM quotes q
        JOIN users p ON q.person_id = p.id
        JOIN users a ON q.added_by = a.id
        JOIN groups g ON q.group_id = g.id
        WHERE q.group_id IN (${placeholders})
        ORDER BY RANDOM() LIMIT 1`,
      gids,
      (e, quote) => {
        if (e) return res.status(500).json({ error: 'Database error' });
        if (!quote) return res.status(404).json({ error: 'No quotes found' });
        res.json(quote);
      }
    );
  });
});

app.post('/api/quotes', requireAuth, (req, res) => {
  const quoteText = sanitizeQuote(req.body.quoteText);
  const personId = parseInt(req.body.personId, 10);
  const groupId = parseInt(req.body.groupId, 10);
  if (!quoteText || !personId || !groupId || !Number.isInteger(personId) || !Number.isInteger(groupId)) {
    return res.status(400).json({ error: 'Missing or invalid required fields' });
  }

  getUserGroupIds(req.session.userId, (err, gids) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!gids.includes(groupId)) return res.status(403).json({ error: 'You do not have access to this group' });

    db.run(
      'INSERT INTO quotes (quote_text, person_id, added_by, group_id) VALUES (?,?,?,?)',
      [quoteText, personId, req.session.userId, groupId],
      function(er) {
        if (er) return res.status(500).json({ error: 'Database error' });
        res.json({ success: true, quoteId: this.lastID });
      }
    );
  });
});

app.get('/api/leaderboard', requireAuth, (req, res) => {
  getUserGroupIds(req.session.userId, (err, gids) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!gids.length) return res.json([]);

    const placeholders = gids.map(() => '?').join(',');
    const sql = `SELECT u.id, u.display_name,
          COUNT(q.id) as quote_count
          FROM users u
          LEFT JOIN quotes q ON u.id = q.person_id AND q.group_id IN (${placeholders})
          GROUP BY u.id, u.display_name
          HAVING quote_count > 0
          ORDER BY quote_count DESC, u.display_name ASC`;
    db.all(sql, gids, (e, rows) => {
      if (e) return res.status(500).json({ error: 'Database error' });
      res.json(rows || []);
    });
  });
});

app.get('/api/users/:id/stats', requireAuth, (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Invalid user' });
  const isAdmin = !!req.session.isAdmin;

  if (isAdmin) {
    db.get(
      `SELECT u.id, u.display_name, u.username,
        (SELECT COUNT(*) FROM quotes q WHERE q.person_id = u.id) as total_quotes,
        (SELECT COUNT(*) FROM quotes q WHERE q.added_by = u.id) as quotes_added
        FROM users u WHERE u.id = ?`,
      [targetId],
      (e, stats) => {
        if (e) return res.status(500).json({ error: 'Database error' });
        if (!stats) return res.status(404).json({ error: 'User not found' });
        res.json(stats);
      }
    );
    return;
  }

  getUserGroupIds(req.session.userId, (err, gids) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!gids.length) return res.status(404).json({ error: 'User not found' });

    const placeholders = gids.map(() => '?').join(',');
    db.get(
      `SELECT u.id, u.display_name, u.username,
        (SELECT COUNT(*) FROM quotes q WHERE q.person_id = u.id AND q.group_id IN (${placeholders})) as total_quotes,
        (SELECT COUNT(*) FROM quotes q WHERE q.added_by = u.id AND q.group_id IN (${placeholders})) as quotes_added
        FROM users u
        INNER JOIN user_groups ug ON ug.user_id = u.id AND ug.group_id IN (${placeholders})
        WHERE u.id = ?`,
      [...gids, ...gids, ...gids, targetId],
      (e, stats) => {
        if (e) return res.status(500).json({ error: 'Database error' });
        if (!stats) return res.status(404).json({ error: 'User not found' });
        res.json(stats);
      }
    );
  });
});

// Admin: groups
app.get('/api/admin/groups', requireAdmin, (req, res) => {
  db.all('SELECT id, name FROM groups ORDER BY name', (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows || []);
  });
});

app.post('/api/admin/groups', requireAdmin, (req, res) => {
  const name = sanitizeDisplayName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Group name required' });
  db.run('INSERT INTO groups (name) VALUES (?)', [name], function(er) {
    if (er) {
      if (er.message.includes('UNIQUE')) return res.status(400).json({ error: 'Group name already exists' });
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ success: true, groupId: this.lastID });
  });
});

app.get('/api/admin/user-groups', requireAdmin, (req, res) => {
  db.all(
    `SELECT ug.user_id, ug.group_id, u.display_name, g.name as group_name
     FROM user_groups ug
     JOIN users u ON u.id = ug.user_id
     JOIN groups g ON g.id = ug.group_id
     ORDER BY u.display_name, g.name`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows || []);
    }
  );
});

app.post('/api/admin/user-groups', requireAdmin, (req, res) => {
  const userId = parseInt(req.body.userId, 10);
  const groupId = parseInt(req.body.groupId, 10);
  if (!Number.isInteger(userId) || !Number.isInteger(groupId)) {
    return res.status(400).json({ error: 'Invalid userId or groupId' });
  }
  db.run('INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES (?,?)', [userId, groupId], function(er) {
    if (er) return res.status(500).json({ error: 'Database error' });
    res.json({ success: true });
  });
});

app.delete('/api/admin/user-groups', requireAdmin, (req, res) => {
  const userId = parseInt(req.body.userId, 10);
  const groupId = parseInt(req.body.groupId, 10);
  if (!Number.isInteger(userId) || !Number.isInteger(groupId)) {
    return res.status(400).json({ error: 'Invalid userId or groupId' });
  }
  db.run('DELETE FROM user_groups WHERE user_id = ? AND group_id = ?', [userId, groupId], function(er) {
    if (er) return res.status(500).json({ error: 'Database error' });
    res.json({ success: true });
  });
});

// Pages
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/random', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'random.html')));
app.get('/leaderboard', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'leaderboard.html')));
app.get('/profiles', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'profiles.html')));
app.get('/admin', requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
