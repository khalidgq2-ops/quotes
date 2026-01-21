# Quotes Site

A fun quotes site for you and your friends to collect and share memorable quotes.

## Features

- **Customized Login**: Each person has their own login credentials
- **Add Quotes**: Add quotes and specify which person said them (not just yourself)
- **Sort Quotes**: Sort by date (newest/oldest) or by person
- **Random Quote**: Get a random quote with a click of a button
- **Leaderboard**: See who has the most quotes (points)
- **User Profiles**: View stats for each user
- **Admin Panel**: Create new accounts (admin only)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Open your browser and go to `http://localhost:3000`

## Default Admin Account

- **Username**: `admin`
- **Password**: `admin123`

**Important**: Change the default admin password after first login through the admin panel!

## Creating New Users

1. Login as admin
2. Go to the Admin panel
3. Fill in the form to create a new user:
   - Username (for login)
   - Password
   - Display Name (shown on quotes and leaderboard)

## Usage

- **Login**: Use your username and password
- **Add Quote**: Click "Add Quote" button, enter the quote text and select who said it
- **View Quotes**: Browse all quotes on the main page, sort by date or person
- **Random Quote**: Visit the Random page and click the button to get a random quote
- **Leaderboard**: See everyone's quote count (points)
- **Profiles**: View detailed stats for each user

## Points System

Each quote associated with a person gives them +1 point. Points are displayed on the leaderboard and profiles.

## Hosting

This app uses SQLite for the database, making it easy to host. The database file (`quotes.db`) will be created automatically on first run.

For production:
- Change the session secret in `server.js`
- Use environment variables for sensitive data
- Consider using a process manager like PM2
- Set up HTTPS
