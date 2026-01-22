// Script to ensure admin user exists
// Run this if admin login doesn't work: node ensure-admin.js

const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const dbPath = path.join(__dirname, 'quotes.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
});

// Get Everyone group ID
db.get('SELECT id FROM groups WHERE name = ?', ['Everyone'], (err, group) => {
  if (err) {
    console.error('Error finding Everyone group:', err);
    db.close();
    process.exit(1);
  }
  
  if (!group) {
    console.error('Everyone group not found. Please run the server first to initialize the database.');
    db.close();
    process.exit(1);
  }
  
  const everyoneGroupId = group.id;
  
  // Check if admin exists
  db.get('SELECT id FROM users WHERE username = ?', ['admin'], (err, admin) => {
    if (err) {
      console.error('Error checking admin:', err);
      db.close();
      process.exit(1);
    }
    
    if (admin) {
      console.log('Admin user already exists.');
      // Ensure admin is in Everyone group
      db.run('INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES (?,?)', [admin.id, everyoneGroupId], (err) => {
        if (err) {
          console.error('Error adding admin to Everyone group:', err);
        } else {
          console.log('Admin is in Everyone group.');
        }
        db.close();
      });
    } else {
      // Create admin
      const hash = bcrypt.hashSync('admin123', 10);
      db.run(
        'INSERT INTO users (username, password, display_name, is_admin) VALUES (?,?,?,?)',
        ['admin', hash, 'Admin', 1],
        function(err) {
          if (err) {
            console.error('Error creating admin:', err);
            db.close();
            process.exit(1);
          }
          
          const adminId = this.lastID;
          db.run('INSERT INTO user_groups (user_id, group_id) VALUES (?,?)', [adminId, everyoneGroupId], (err) => {
            if (err) {
              console.error('Error adding admin to Everyone group:', err);
            } else {
              console.log('✓ Admin user created successfully!');
              console.log('  Username: admin');
              console.log('  Password: admin123');
              console.log('  IMPORTANT: Change this password after logging in!');
            }
            db.close();
          });
        }
      );
    }
  });
});
