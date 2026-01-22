# Backups: How They Work, Where They’re Stored, and Risks

## Schedule and retention

- **When**: 2× per week by default — **3am Sunday** and **3am Wednesday** (server local time).
- **Config**: Env vars  
  - `BACKUP_CRON` — cron expression (default `0 3 * * 0,3`)  
  - `MAX_BACKUPS` — how many files to keep (default `8` ≈ 4 weeks of 2×/week).

## Where backups are stored

- **Path**: `backups/` inside the app directory (same folder as `server.js`).
- **Files**: `quotes-<timestamp>.sql`, e.g. `quotes-1737542400000.sql`.
- **What**: SQL dump files created with `pg_dump` from PostgreSQL. These are plain text SQL files that can be restored with `psql` or `pg_restore`.

So backups live **on the same machine** that runs the app, in `./backups/`.

## How it works

1. A cron job runs at the scheduled times.
2. The app runs `pg_dump` to create a SQL dump → `backups/quotes-<timestamp>.sql`.
3. It lists all `.sql` files in `backups/`, sorts by modification time (newest first).
4. If there are more than `MAX_BACKUPS` files, it deletes the oldest until only `MAX_BACKUPS` remain.

**Restore**: Use `psql` to restore a backup:
```bash
psql $DATABASE_URL < backups/quotes-<timestamp>.sql
```

Or use `pg_restore` for custom format dumps (if you modify the backup script).

---

## Risks you still face

### 1. **Same disk as the app (no off‑site copy)**

- Backups are **only** on the server’s disk.
- If the server dies, disk is corrupted, or the instance is deleted (e.g. Render redeploy, account closure), **both** `quotes.db` and `backups/` can be lost.
- **Mitigation**: Periodically copy backups to another place (e.g. S3, another server, your laptop). That’s not built in today.

### 2. **Ephemeral disk on Render / similar PaaS**

- On Render (and many PaaS), the filesystem is **ephemeral**: it’s wiped on redeploy or when the service restarts.
- So `backups/` is **not** durable across deploys. You can lose all backups when you deploy or the platform restarts the app.
- **Mitigation**: Use a separate, persistent store (e.g. S3) and a script/cron that copies `backups/*.db` there. The app itself doesn’t do that yet.

### 3. **No encryption**

- Backups are plain SQLite files. Anyone with access to the backup files can read all data (quotes, users, etc.).
- **Mitigation**: If you copy backups elsewhere, store them in an encrypted bucket or encrypt the files before upload.

### 4. **No backup verification**

- The app only **writes** backup files. It doesn’t check that they’re readable or uncorrupted.
- **Mitigation**: Occasionally restore a backup to a test DB and run a few queries to confirm it’s valid.

### 5. **Single point of failure**

- Everything (app + DB + backups) depends on one SQLite file and one server. No replication.
- **Mitigation**: For higher durability, you’d move to a managed DB (e.g. PostgreSQL) and/or multiple replicas — beyond the current design.

### 6. **Restore is manual**

- Restore = you replace `quotes.db` with a backup and restart. No automatic failover or one‑click restore in the app.
- **Mitigation**: Document your restore steps and test them once.

---

## Summary

| What | Details |
|------|---------|
| **Where** | `backups/` next to `server.js`, on the same machine as the app |
| **Format** | Raw copy of `quotes.db` |
| **Schedule** | 2×/week (Sun & Wed 3am), keep last 8 |
| **Main risks** | Same disk as app; ephemeral disk on Render; no off‑site copy; no encryption or verification |
| **Improvements** | Copy backups to S3 (or similar), encrypt if sensitive, occasionally verify by restoring |
