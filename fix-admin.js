const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const db = new sqlite3.Database('./quotes.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
});

// Delete existing admin
db.run('DELETE FROM users WHERE username = ?', ['admin'], (err) => {
  if (err) {
    console.error('Error deleting admin:', err);
    db.close();
    process.exit(1);
  }
  
  console.log('Old admin deleted, creating new one...');
  
  // Create new admin user with correct password
  const password = bcrypt.hashSync('admin123', 10);
  db.run('INSERT INTO users (username, password, display_name, is_admin) VALUES (?, ?, ?, ?)',
    ['admin', password, 'Admin', 1], (err) => {
      if (err) {
        console.error('Error creating admin:', err);
        db.close();
        process.exit(1);
      }
      
      console.log('✓ Admin user created successfully!');
      console.log('Username: admin');
      console.log('Password: admin123');
      
      // Verify it works
      db.get('SELECT username, is_admin FROM users WHERE username = ?', ['admin'], (err, user) => {
        if (err) {
          console.error('Error verifying:', err);
        } else {
          console.log('✓ Verification: Admin user exists in database');
        }
        db.close();
      });
    });
});
