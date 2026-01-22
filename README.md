# Quotes Site

A fun quotes site for you and your friends to collect and share memorable quotes.

## Features

- **Customized Login**: Each person has their own login credentials
- **Add Quotes**: Add quotes, choose who said them, and which **group** can see them
- **Sort Quotes**: Sort by date (newest/oldest) or by person
- **Random Quote**: Get a random quote (from your groups) with a click
- **Leaderboard**: Points from quotes you’re allowed to see; no leaking across groups
- **User Profiles**: Stats only for users you share a group with (admins see all)
- **Admin Panel**: Create accounts, create groups, assign users to groups
- **Backups**: SQLite backups 2×/week (configurable); keep last 8
- **Security**: Rate limiting, hardened cookies, input validation, group-based access

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

## Creating New Users & Groups

1. Log in as admin.
2. **Admin → Create New User**: username, password (min 8 chars), display name.
3. **Admin → Groups**: Create groups (e.g. "Friends", "Work").
4. **Admin → Assign User to Group**: Add users to groups. Users only see quotes (and leaderboard/profile stats) for groups they’re in.
5. **Admin → Remove User from Group**: Unassign when needed.

## Usage

- **Login**: Your username and password.
- **Add Quote**: Click "Add Quote", enter text, choose **group** (who can see it) and **who said it**.
- **View Quotes**: Main page shows quotes from your groups only; sort by date or person.
- **Random Quote**: Random quote from your groups.
- **Leaderboard**: Points only from quotes in your groups; no cross-group leakage.
- **Profiles**: Stats for users you share a group with.

## Points System

+1 point per quote attributed to a user. Leaderboard and profile counts only include quotes from groups the viewer can access.

## Backups

- **Schedule**: 2× per week (default: 3am Sunday & Wednesday). Env: `BACKUP_CRON`, `MAX_BACKUPS` (default 8).
- **Where**: Stored on the server under `backups/` as `quotes-<timestamp>.db`. See `BACKUPS.md` for details and risks.

## Hosting

SQLite; `quotes.db` is created on first run. Set `SESSION_SECRET` and `NODE_ENV=production`. 

**Important for Railway/Cloud Hosting**: The database file is stored on ephemeral disk by default, which means it gets **wiped on every redeployment**. You MUST use a **Volume** (persistent storage) to keep your data. See `RAILWAY.md` for details.

See `DEPLOY.md` and `SECURITY.md` for more info.
