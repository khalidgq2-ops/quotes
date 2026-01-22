# Security

## Overview

- **Authentication**: Session-based. No JWT; all protected routes require a valid session.
- **Authorization**: Multi-layer groups. Users see only quotes (and thus leaderboard/profile stats) for groups they belong to.
- **Account creation**: Admin-only. No self-registration.

## Protections

### API & Auth

- **Rate limiting**:
  - Login: 20 attempts per 15 minutes.
  - General API: 120 requests per minute.
- **Session cookies**: `httpOnly`, `sameSite: 'lax'`, `secure` in production. Custom name `quotes.sid` to avoid fingerprinting.
- **Session secret**: Must be set via `SESSION_SECRET` in production. No default in prod.

### Input & DB

- **Sort parameter**: Strict whitelist (`date_desc`, `date_asc`, `person`). No raw user input in `ORDER BY`.
- **Sanitization**: Username (alphanumeric + `.` `-`), display/group names trimmed and length-limited. Quote text trimmed, max 4KB.
- **Passwords**: Min 8 chars for new users; stored with bcrypt (cost 10).
- **Queries**: Parameterized. No string interpolation for user-controlled values.

### Permissions

- **Quotes**: Filtered by `group_id`; user must be in the group. Add-quote requires `groupId` and membership.
- **Leaderboard**: Only quotes from the viewer’s groups. Only users with at least one such quote appear.
- **Profiles**: Non-admins see only users who share a group. Stats counts are restricted to shared-group quotes. Admins can view any user’s global stats.

### Backups

- PostgreSQL SQL dumps 2×/week under `backups/`, rotation keeps last 8 (configurable via `MAX_BACKUPS`).
- Schedule configurable with `BACKUP_CRON` (default: `0 3 * * 0,3` — 3am Sun & Wed).

## Deployment Checklist

- [ ] Set `SESSION_SECRET` (e.g. `openssl rand -hex 32`).
- [ ] Set `NODE_ENV=production`.
- [ ] Use HTTPS (Render/Railway etc. provide this).
- [ ] Change default admin password after first login.
- [ ] Ensure `backups/` is writable. For durable backups, copy to external storage (e.g. S3). See `BACKUPS.md`.
