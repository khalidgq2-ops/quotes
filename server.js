const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Database setup
const db = new sqlite3.Database('./quotes.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

function initializeDatabase() {
  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    display_name TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating users table:', err);
      return;
    }
    
    // Quotes table
    db.run(`CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_text TEXT NOT NULL,
      person_id INTEGER NOT NULL,
      added_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (person_id) REFERENCES users(id),
      FOREIGN KEY (added_by) REFERENCES users(id)
    )`, (err) => {
      if (err) {
        console.error('Error creating quotes table:', err);
        return;
      }
      
      // Create default admin user if no users exist
      db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
        if (err) {
          console.error('Error checking users:', err);
          return;
        }
        if (row.count === 0) {
          const defaultPassword = bcrypt.hashSync('admin123', 10);
          db.run(`INSERT INTO users (username, password, display_name, is_admin) 
                  VALUES (?, ?, ?, ?)`, 
                  ['admin', defaultPassword, 'Admin', 1], (err) => {
            if (err) {
              console.error('Error creating default admin:', err);
            } else {
              console.log('Default admin created: username=admin, password=admin123');
            }
          });
        }
      });
    });
  });
}

// Authentication middleware
function requireAuth(req, res, next) {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

function requireAdmin(req, res, next) {
  if (req.session.userId && req.session.isAdmin) {
    next();
  } else {
    res.status(403).json({ error: 'Admin access required' });
  }
}

// API Routes

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    bcrypt.compare(password, user.password, (err, match) => {
      if (err || !match) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
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
          isAdmin: user.is_admin === 1
        }
      });
    });
  });
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Get current user
app.get('/api/me', requireAuth, (req, res) => {
  res.json({
    id: req.session.userId,
    username: req.session.username,
    displayName: req.session.displayName,
    isAdmin: req.session.isAdmin
  });
});

// Get all users (for quote assignment)
app.get('/api/users', requireAuth, (req, res) => {
  db.all('SELECT id, username, display_name FROM users ORDER BY display_name', (err, users) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(users);
  });
});

// Create new user (admin only)
app.post('/api/users', requireAdmin, (req, res) => {
  const { username, password, displayName } = req.body;
  
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  bcrypt.hash(password, 10, (err, hash) => {
    if (err) {
      return res.status(500).json({ error: 'Error hashing password' });
    }
    
    db.run('INSERT INTO users (username, password, display_name) VALUES (?, ?, ?)',
      [username, hash, displayName], function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Username already exists' });
          }
          return res.status(500).json({ error: 'Database error' });
        }
        
        res.json({
          success: true,
          userId: this.lastID
        });
      });
  });
});

// Get quotes with sorting
app.get('/api/quotes', requireAuth, (req, res) => {
  const { sort = 'date_desc' } = req.query;
  
  let orderBy = 'q.created_at DESC';
  if (sort === 'date_asc') {
    orderBy = 'q.created_at ASC';
  } else if (sort === 'person') {
    orderBy = 'p.display_name ASC, q.created_at DESC';
  }
  
  db.all(`SELECT q.id, q.quote_text, q.created_at,
          p.id as person_id, p.display_name as person_name,
          a.id as added_by_id, a.display_name as added_by_name
          FROM quotes q
          JOIN users p ON q.person_id = p.id
          JOIN users a ON q.added_by = a.id
          ORDER BY ${orderBy}`, (err, quotes) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(quotes);
  });
});

// Get random quote
app.get('/api/quotes/random', requireAuth, (req, res) => {
  db.get(`SELECT q.id, q.quote_text, q.created_at,
          p.id as person_id, p.display_name as person_name,
          a.id as added_by_id, a.display_name as added_by_name
          FROM quotes q
          JOIN users p ON q.person_id = p.id
          JOIN users a ON q.added_by = a.id
          ORDER BY RANDOM()
          LIMIT 1`, (err, quote) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!quote) {
      return res.status(404).json({ error: 'No quotes found' });
    }
    res.json(quote);
  });
});

// Create quote
app.post('/api/quotes', requireAuth, (req, res) => {
  const { quoteText, personId } = req.body;
  
  if (!quoteText || !personId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  db.run('INSERT INTO quotes (quote_text, person_id, added_by) VALUES (?, ?, ?)',
    [quoteText, personId, req.session.userId], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      res.json({
        success: true,
        quoteId: this.lastID
      });
    });
});

// Get leaderboard
app.get('/api/leaderboard', requireAuth, (req, res) => {
  db.all(`SELECT u.id, u.display_name, COUNT(q.id) as quote_count
          FROM users u
          LEFT JOIN quotes q ON u.id = q.person_id
          GROUP BY u.id, u.display_name
          ORDER BY quote_count DESC, u.display_name ASC`, (err, leaderboard) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(leaderboard);
  });
});

// Get user stats
app.get('/api/users/:id/stats', requireAuth, (req, res) => {
  const userId = parseInt(req.params.id);
  
  db.get(`SELECT 
          u.id, u.display_name, u.username,
          COUNT(DISTINCT q.id) as total_quotes,
          COUNT(DISTINCT q2.id) as quotes_added
          FROM users u
          LEFT JOIN quotes q ON u.id = q.person_id
          LEFT JOIN quotes q2 ON u.id = q2.added_by
          WHERE u.id = ?
          GROUP BY u.id, u.display_name, u.username`, [userId], (err, stats) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!stats) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(stats);
  });
});

// Serve main pages
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/random', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'random.html'));
});

app.get('/leaderboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'leaderboard.html'));
});

app.get('/profiles', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profiles.html'));
});

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
