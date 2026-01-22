const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const BACKUP_DIR = path.join(__dirname, 'backups');
const MAX_BACKUPS = process.env.MAX_BACKUPS ? parseInt(process.env.MAX_BACKUPS, 10) : 8;
const BACKUP_CRON = process.env.BACKUP_CRON || '0 3 * * 0,3'; // 3am Sunday & Wednesday (2x/week)

// Trust proxy (required for Railway/reverse proxies) - MUST be set before rate limiters
app.set('trust proxy', true);

// PostgreSQL connection pool
// Railway provides DATABASE_URL automatically when PostgreSQL is linked
// If not set, try constructing from individual PG* variables
let databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl && process.env.PGHOST) {
  // Construct from individual variables (Railway fallback)
  databaseUrl = `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE}`;
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl && (databaseUrl.includes('sslmode=require') || databaseUrl.includes('railway') || databaseUrl.includes('rlwy.net')) 
    ? { rejectUnauthorized: false } 
    : false,
});

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

// Test database connection and initialize
let dbInitialized = false;

async function connectAndInitialize() {
  if (!databaseUrl) {
    console.error('========================================');
    console.error('ERROR: Database connection string not found!');
    console.error('========================================');
    console.error('DATABASE_URL:', process.env.DATABASE_URL ? 'Set' : 'NOT SET');
    console.error('PGHOST:', process.env.PGHOST ? 'Set' : 'NOT SET');
    console.error('');
    console.error('To fix this in Railway:');
    console.error('1. Go to your Railway project');
    console.error('2. Click "New" → "Database" → "Add PostgreSQL"');
    console.error('3. In your app service, go to "Variables" tab');
    console.error('4. Make sure DATABASE_URL is listed (Railway sets it automatically)');
    console.error('5. If not, add: DATABASE_URL = ${{Postgres.DATABASE_URL}}');
    console.error('   (Replace "Postgres" with your PostgreSQL service name)');
    console.error('========================================');
    return;
  }
  
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('Connected to PostgreSQL database');
    await initializeDatabase();
    dbInitialized = true;
    console.log('Database initialization complete');
  } catch (err) {
    console.error('Error connecting to PostgreSQL:', err.message);
    console.error('Connection string:', databaseUrl ? databaseUrl.replace(/:[^:@]+@/, ':****@') : 'none');
    // Don't exit - let the server start but log the error
    // The server will show errors on API calls
  }
}

connectAndInitialize();

// --- Backups ---
function runBackup() {
  const dest = path.join(BACKUP_DIR, `quotes-${Date.now()}.sql`);
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL not set, cannot backup');
    return;
  }
  
  // Use pg_dump to create SQL backup
  // Note: pg_dump must be available in PATH (Railway should have it)
  const cmd = `pg_dump "${dbUrl}" -F p > "${dest}" 2>&1`;
  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error('Backup failed:', error.message);
      if (stderr) console.error('Backup stderr:', stderr);
      return;
    }
    
    // Check if file was created
    if (!fs.existsSync(dest)) {
      console.error('Backup file was not created');
      return;
    }
    
    // Rotate backups
    try {
      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith('.sql'))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime() }))
        .sort((a, b) => b.mtime - a.mtime);
      while (files.length > MAX_BACKUPS) {
        const victim = files.pop();
        fs.unlinkSync(path.join(BACKUP_DIR, victim.name));
      }
      console.log('Backup completed:', path.basename(dest));
    } catch (e) {
      console.error('Backup rotation failed:', e.message);
    }
  });
}

cron.schedule(BACKUP_CRON, runBackup);
console.log('Backups scheduled:', BACKUP_CRON, '| keep last', MAX_BACKUPS);

// --- Schema & init ---
async function initializeDatabase() {
  try {
    // Create tables
    await pool.query(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(64) UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name VARCHAR(128) NOT NULL,
      is_admin INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    
    await pool.query(`CREATE TABLE IF NOT EXISTS groups (
      id SERIAL PRIMARY KEY,
      name VARCHAR(128) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    
    await pool.query(`CREATE TABLE IF NOT EXISTS user_groups (
      user_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, group_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    )`);
    
    // Check if quotes table exists
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'quotes'
      )
    `);
    
    if (!tableExists.rows[0].exists) {
      // Table doesn't exist, create it with group_id
      await pool.query(`CREATE TABLE quotes (
        id SERIAL PRIMARY KEY,
        quote_text TEXT NOT NULL,
        person_id INTEGER NOT NULL,
        added_by INTEGER NOT NULL,
        group_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (person_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
      )`);
    } else {
      // Table exists, check if it has group_id column
      const columnCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'quotes' AND column_name = 'group_id'
      `);
      
      if (columnCheck.rows.length === 0) {
        // Add group_id column if missing (migration)
        await pool.query(`
          ALTER TABLE quotes 
          ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE
        `).catch(e => console.warn('Migration group_id (may already exist):', e.message));
      }
    }
    
    await ensureDefaultGroupAndAdmin();
    console.log('Database tables created/verified');
  } catch (err) {
    console.error('Database initialization error:', err);
    console.error('Error details:', err.message);
    console.error('Error code:', err.code);
    throw err; // Re-throw so caller knows it failed
  }
}

async function ensureDefaultGroupAndAdmin() {
  try {
    // Get or create Everyone group
    let groupResult = await pool.query('SELECT id FROM groups WHERE name = $1', ['Everyone']);
    let defaultGroupId;
    
    if (groupResult.rows.length === 0) {
      const insertResult = await pool.query('INSERT INTO groups (name) VALUES ($1) RETURNING id', ['Everyone']);
      defaultGroupId = insertResult.rows[0].id;
    } else {
      defaultGroupId = groupResult.rows[0].id;
    }
    
    // Ensure admin exists
    const adminResult = await pool.query('SELECT id FROM users WHERE username = $1', ['admin']);
    
    if (adminResult.rows.length === 0) {
      // Create admin
      const hash = bcrypt.hashSync('admin123', 10);
      const userResult = await pool.query(
        'INSERT INTO users (username, password, display_name, is_admin) VALUES ($1, $2, $3, $4) RETURNING id',
        ['admin', hash, 'Admin', 1]
      );
      const adminId = userResult.rows[0].id;
      await pool.query(
        'INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [adminId, defaultGroupId]
      );
      console.log('Default admin created: admin / admin123');
    } else {
      // Admin exists, ensure in Everyone group
      await pool.query(
        'INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [adminResult.rows[0].id, defaultGroupId]
      );
    }
    
    // Migrate quotes without group_id
    await pool.query('UPDATE quotes SET group_id = $1 WHERE group_id IS NULL', [defaultGroupId]).catch(() => {});
    
    // Add all users to Everyone group
    const usersResult = await pool.query('SELECT id FROM users');
    for (const user of usersResult.rows) {
      await pool.query(
        'INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [user.id, defaultGroupId]
      );
    }
  } catch (err) {
    console.error('Error ensuring default group and admin:', err);
  }
}

// --- Auth helpers ---
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  // For HTML page requests, redirect to login; for API requests, return JSON
  const acceptsHtml = req.accepts('html');
  if (acceptsHtml) {
    return res.redirect('/login');
  }
  res.status(401).json({ error: 'Unauthorized' });
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.userId && req.session.isAdmin) return next();
  // For HTML page requests, redirect to login; for API requests, return JSON
  const acceptsHtml = req.accepts('html');
  if (acceptsHtml) {
    return res.redirect('/login');
  }
  res.status(403).json({ error: 'Admin access required' });
}

async function getUserGroupIds(userId) {
  try {
    const result = await pool.query('SELECT group_id FROM user_groups WHERE user_id = $1', [userId]);
    return result.rows.map(r => r.group_id);
  } catch (err) {
    throw err;
  }
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

app.post('/api/login', loginLimiter, async (req, res) => {
  const username = sanitizeUsername(req.body.username);
  const password = req.body.password;
  if (!username || !password) {
    return res.status(400).json({ error: 'Invalid credentials' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    
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
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Database error', details: process.env.NODE_ENV === 'development' ? err.message : undefined });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {});
  res.json({ success: true });
});

app.get('/api/me', async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    // Check if user is only in "Everyone" group (hide group UI for them)
    const result = await pool.query(
      `SELECT COUNT(*)::int as group_count,
       SUM(CASE WHEN g.name = 'Everyone' THEN 1 ELSE 0 END)::int as everyone_count
       FROM user_groups ug
       JOIN groups g ON g.id = ug.group_id
       WHERE ug.user_id = $1`,
      [req.session.userId]
    );
    
    const row = result.rows[0];
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
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.use('/api', apiLimiter);

app.get('/api/groups', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT g.id, g.name FROM groups g
       INNER JOIN user_groups ug ON ug.group_id = g.id
       WHERE ug.user_id = $1
       ORDER BY g.name`,
      [req.session.userId]
    );
    res.json(result.rows || []);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/users', requireAuth, async (req, res) => {
  try {
    const uid = req.session.userId;
    const isAdmin = req.session.isAdmin;

    if (isAdmin) {
      const result = await pool.query('SELECT id, username, display_name FROM users ORDER BY display_name');
      return res.json(result.rows || []);
    }

    const result = await pool.query(
      `SELECT DISTINCT u.id, u.username, u.display_name
       FROM users u
       INNER JOIN user_groups ug ON ug.user_id = u.id
       WHERE ug.group_id IN (SELECT group_id FROM user_groups WHERE user_id = $1)
       ORDER BY u.display_name`,
      [uid]
    );
    res.json(result.rows || []);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const username = sanitizeUsername(req.body.username);
  const password = req.body.password;
  const displayName = sanitizeDisplayName(req.body.displayName);
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password, display_name) VALUES ($1, $2, $3) RETURNING id',
      [username, hash, displayName]
    );
    res.json({ success: true, userId: result.rows[0].id });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Username already exists' });
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/quotes', requireAuth, async (req, res) => {
  try {
    const sort = SORT_WHITELIST[req.query.sort] ? req.query.sort : 'date_desc';
    let orderBy = 'q.created_at DESC';
    if (sort === 'date_asc') orderBy = 'q.created_at ASC';
    else if (sort === 'person') orderBy = 'p.display_name ASC, q.created_at DESC';

    const gids = await getUserGroupIds(req.session.userId);
    if (!gids.length) return res.json([]);

    const placeholders = gids.map((_, i) => `$${i + 1}`).join(',');
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
    const result = await pool.query(sql, gids);
    res.json(result.rows || []);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/quotes/random', requireAuth, async (req, res) => {
  try {
    const gids = await getUserGroupIds(req.session.userId);
    if (!gids.length) return res.status(404).json({ error: 'No quotes found' });

    const placeholders = gids.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
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
      gids
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'No quotes found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/quotes', requireAuth, async (req, res) => {
  const quoteText = sanitizeQuote(req.body.quoteText);
  const personId = parseInt(req.body.personId, 10);
  const groupId = parseInt(req.body.groupId, 10);
  if (!quoteText || !personId || !groupId || !Number.isInteger(personId) || !Number.isInteger(groupId)) {
    return res.status(400).json({ error: 'Missing or invalid required fields' });
  }

  try {
    const gids = await getUserGroupIds(req.session.userId);
    if (!gids.includes(groupId)) return res.status(403).json({ error: 'You do not have access to this group' });

    const result = await pool.query(
      'INSERT INTO quotes (quote_text, person_id, added_by, group_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [quoteText, personId, req.session.userId, groupId]
    );
    res.json({ success: true, quoteId: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/leaderboard', requireAuth, async (req, res) => {
  try {
    const gids = await getUserGroupIds(req.session.userId);
    if (!gids.length) return res.json([]);

    const placeholders = gids.map((_, i) => `$${i + 1}`).join(',');
    const sql = `SELECT u.id, u.display_name,
          COUNT(q.id)::int as quote_count
          FROM users u
          LEFT JOIN quotes q ON u.id = q.person_id AND q.group_id IN (${placeholders})
          GROUP BY u.id, u.display_name
          HAVING COUNT(q.id) > 0
          ORDER BY quote_count DESC, u.display_name ASC`;
    const result = await pool.query(sql, gids);
    res.json(result.rows || []);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/users/:id/stats', requireAuth, async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Invalid user' });
  const isAdmin = !!req.session.isAdmin;

  try {
    if (isAdmin) {
      const result = await pool.query(
        `SELECT u.id, u.display_name, u.username,
          (SELECT COUNT(*)::int FROM quotes q WHERE q.person_id = u.id) as total_quotes,
          (SELECT COUNT(*)::int FROM quotes q WHERE q.added_by = u.id) as quotes_added
          FROM users u WHERE u.id = $1`,
        [targetId]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
      return res.json(result.rows[0]);
    }

    const gids = await getUserGroupIds(req.session.userId);
    if (!gids.length) return res.status(404).json({ error: 'User not found' });

    const placeholders1 = gids.map((_, i) => `$${i + 1}`).join(',');
    const placeholders2 = gids.map((_, i) => `$${gids.length + i + 1}`).join(',');
    const placeholders3 = gids.map((_, i) => `$${gids.length * 2 + i + 1}`).join(',');
    const targetParam = `$${gids.length * 3 + 1}`;
    const result = await pool.query(
      `SELECT u.id, u.display_name, u.username,
        (SELECT COUNT(*)::int FROM quotes q WHERE q.person_id = u.id AND q.group_id IN (${placeholders1})) as total_quotes,
        (SELECT COUNT(*)::int FROM quotes q WHERE q.added_by = u.id AND q.group_id IN (${placeholders2})) as quotes_added
        FROM users u
        INNER JOIN user_groups ug ON ug.user_id = u.id AND ug.group_id IN (${placeholders3})
        WHERE u.id = ${targetParam}`,
      [...gids, ...gids, ...gids, targetId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Admin: groups
app.get('/api/admin/groups', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM groups ORDER BY name');
    res.json(result.rows || []);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/admin/groups', requireAdmin, async (req, res) => {
  const name = sanitizeDisplayName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Group name required' });
  try {
    const result = await pool.query('INSERT INTO groups (name) VALUES ($1) RETURNING id', [name]);
    res.json({ success: true, groupId: result.rows[0].id });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Group name already exists' });
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/admin/user-groups', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ug.user_id, ug.group_id, u.display_name, g.name as group_name
       FROM user_groups ug
       JOIN users u ON u.id = ug.user_id
       JOIN groups g ON g.id = ug.group_id
       ORDER BY u.display_name, g.name`
    );
    res.json(result.rows || []);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/admin/user-groups', requireAdmin, async (req, res) => {
  const userId = parseInt(req.body.userId, 10);
  const groupId = parseInt(req.body.groupId, 10);
  if (!Number.isInteger(userId) || !Number.isInteger(groupId)) {
    return res.status(400).json({ error: 'Invalid userId or groupId' });
  }
  try {
    await pool.query(
      'INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, groupId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/api/admin/user-groups', requireAdmin, async (req, res) => {
  const userId = parseInt(req.body.userId, 10);
  const groupId = parseInt(req.body.groupId, 10);
  if (!Number.isInteger(userId) || !Number.isInteger(groupId)) {
    return res.status(400).json({ error: 'Invalid userId or groupId' });
  }
  try {
    await pool.query('DELETE FROM user_groups WHERE user_id = $1 AND group_id = $2', [userId, groupId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Pages
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/login', (req, res) => {
  // If already logged in, redirect to home
  if (req.session && req.session.userId) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/random', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'random.html')));
app.get('/leaderboard', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'leaderboard.html')));
app.get('/profiles', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'profiles.html')));
app.get('/admin', requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// Health check endpoint (before auth middleware)
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ 
      status: 'ok', 
      database: 'connected',
      initialized: dbInitialized,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ 
      status: 'error', 
      database: 'disconnected',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  if (!process.env.DATABASE_URL) {
    console.warn('WARNING: DATABASE_URL not set! Database will not work.');
  }
});
