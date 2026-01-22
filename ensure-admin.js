// Script to ensure admin user exists (PostgreSQL version)
// Run this if admin login doesn't work: node ensure-admin.js
// Requires DATABASE_URL environment variable

const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
});

async function ensureAdmin() {
  try {
    // Get or create Everyone group
    let groupResult = await pool.query('SELECT id FROM groups WHERE name = $1', ['Everyone']);
    let defaultGroupId;
    
    if (groupResult.rows.length === 0) {
      const insertResult = await pool.query('INSERT INTO groups (name) VALUES ($1) RETURNING id', ['Everyone']);
      defaultGroupId = insertResult.rows[0].id;
      console.log('Created Everyone group');
    } else {
      defaultGroupId = groupResult.rows[0].id;
    }
    
    // Check if admin exists
    const adminResult = await pool.query('SELECT id FROM users WHERE username = $1', ['admin']);
    
    if (adminResult.rows.length === 0) {
      // Create admin
      const hash = await bcrypt.hash('admin123', 10);
      const userResult = await pool.query(
        'INSERT INTO users (username, password, display_name, is_admin) VALUES ($1, $2, $3, $4) RETURNING id',
        ['admin', hash, 'Admin', 1]
      );
      const adminId = userResult.rows[0].id;
      await pool.query(
        'INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [adminId, defaultGroupId]
      );
      console.log('✓ Admin user created successfully!');
      console.log('  Username: admin');
      console.log('  Password: admin123');
      console.log('  IMPORTANT: Change this password after logging in!');
    } else {
      console.log('Admin user already exists.');
      // Ensure admin is in Everyone group
      await pool.query(
        'INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [adminResult.rows[0].id, defaultGroupId]
      );
      console.log('Admin is in Everyone group.');
    }
    
    await pool.end();
  } catch (err) {
    console.error('Error:', err);
    await pool.end();
    process.exit(1);
  }
}

ensureAdmin();
