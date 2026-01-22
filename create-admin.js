const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const db = new sqlite3.Database('./quotes.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
});

// Check if admin exists
db.get('SELECT * FROM users WHERE username = ?', ['admin'], (err, user) => {
  if (err) {
    console.error('Error checking admin:', err);
    db.close();
    process.exit(1);
  }
  
  if (user) {
    console.log('Admin user already exists');
    db.close();
    process.exit(0);
  }
  
  // Create admin user
  const password = bcrypt.hashSync('admin123', 10);
  db.run('INSERT INTO users (username, password, display_name, is_admin) VALUES (?, ?, ?, ?)',
    ['admin', password, 'Admin', 1], (err) => {
      if (err) {
        console.error('Error creating admin:', err);
      } else {
        console.log('Admin user created successfully!');
        console.log('Username: admin');
        console.log('Password: admin123');
      }
      db.close();
    });
});
