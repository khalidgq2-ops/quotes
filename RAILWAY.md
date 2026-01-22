# Railway Deployment Guide

## Quick Setup

1. **Sign up** at [railway.app](https://railway.app) (free account with $5 credit/month)

2. **Connect GitHub**:
   - In Railway dashboard, click "New Project"
   - Select "Deploy from GitHub repo"
   - Authorize Railway to access your GitHub
   - Choose the `quotes` repository

3. **Railway auto-detects Node.js** and starts deploying

4. **Add PostgreSQL Database**:
   - In Railway dashboard, click "New" → "Database" → "Add PostgreSQL"
   - Railway will create a PostgreSQL service
   - **IMPORTANT**: Make sure the database is linked to your app:
     - Go to your **app service** (not the database service)
     - Click "Variables" tab
     - You should see `DATABASE_URL` automatically listed
     - If `DATABASE_URL` is NOT there, add it manually:
       - Click "New Variable"
       - Name: `DATABASE_URL`
       - Value: `${{Postgres.DATABASE_URL}}` (replace "Postgres" with your PostgreSQL service name)
   - Your app will connect automatically once `DATABASE_URL` is set

5. **Add Environment Variables**:
   - Go to your service → "Variables" tab
   - Add:
     - `SESSION_SECRET` = (generate: `openssl rand -hex 32` or any random string)
     - `NODE_ENV` = `production`
     - `BACKUP_CRON` = `0 3 * * 0,3` (optional, default is 2×/week)
     - `MAX_BACKUPS` = `8` (optional, default is 8)
   - **Note**: `DATABASE_URL` is set automatically by Railway when you add PostgreSQL

6. **Custom Domain** (optional):
   - Go to your service → "Settings" → "Networking"
   - Click "Generate Domain" for a Railway subdomain (e.g. `your-app.up.railway.app`), OR
   - **Add your own domain:**
     - Click **"+ Custom Domain"** in the Public Networking section
     - Enter your domain (e.g. `quotes.yourdomain.com` or `www.yourdomain.com`)
     - Railway will show you a **CNAME value** (e.g. `g05ns7.up.railway.app`)
     - **Add this CNAME in your DNS provider:**
       - **Name/Host**: `quotes` (or `www`, or `@` for root domain)
       - **Type**: `CNAME`
       - **Value/Target**: The Railway CNAME value (e.g. `g05ns7.up.railway.app`)
       - **TTL**: `3600` (or default)
     - Wait for Railway to verify (green checkmark) - can take a few minutes to 72 hours
     - SSL certificate is automatically issued once verified

7. **Deploy**: Railway auto-deploys on every push to `main` branch

## Important Notes

- **Database**: 
  - The app uses **PostgreSQL** (Railway's built-in PostgreSQL service).
  - **Add PostgreSQL database**:
    1. In Railway dashboard, click "New" → "Database" → "Add PostgreSQL"
    2. Railway will create a PostgreSQL database and set `DATABASE_URL` automatically
    3. Your app will connect automatically via the `DATABASE_URL` environment variable
  - **Database persists** across redeployments (Railway manages it)
  - **Backups**: SQL dumps are created with `pg_dump` and stored in `backups/` folder (ephemeral). For durable backups, copy them to external storage (S3, etc.)
- **Backups**: Backups go to `backups/` folder (also ephemeral). For durability:
  - Store backups on the Volume (persistent)
  - Or copy backups to external storage (S3, etc.) via a script
- **24/7 Uptime**: Railway free tier has ~500 hours/month. For true 24/7, consider their paid plan ($5/month).
- **First Deploy**: Takes 2-3 minutes. Your site will be live at the generated Railway domain.
- **Admin Account**: Default `admin` / `admin123` is created automatically if it doesn't exist. **Change the password immediately after first login!**

## After Deployment

1. Visit your Railway URL
2. Login with default: `admin` / `admin123`
3. **Change the admin password** immediately via Admin panel
4. Create users and groups as needed

## Custom Domain DNS Setup (Detailed)

### Step-by-Step DNS Configuration

1. **In Railway:**
   - Settings → Networking → "+ Custom Domain"
   - Enter your domain (e.g. `quotes.yourdomain.com`)
   - Railway shows you a CNAME value like `g05ns7.up.railway.app`

2. **In Your DNS Provider** (varies by provider):

   **For subdomain** (e.g. `quotes.yourdomain.com`):
   - **Name/Host**: `quotes`
   - **Type**: `CNAME`
   - **Value/Target**: `g05ns7.up.railway.app` (Railway's value)
   - **TTL**: `3600` or default

   **For www** (e.g. `www.yourdomain.com`):
   - **Name/Host**: `www`
   - **Type**: `CNAME`
   - **Value/Target**: `g05ns7.up.railway.app`
   - **TTL**: `3600` or default

   **For root domain** (e.g. `yourdomain.com`):
   - **Problem**: Root domains can't use CNAME (DNS limitation)
   - **Solution**: Use Cloudflare nameservers (they support CNAME flattening)
     - OR use an A record (Railway will provide IP if available)
     - OR use a subdomain instead (e.g. `quotes.yourdomain.com`)

### Common DNS Providers

- **Cloudflare**: DNS → Records → Add record → CNAME
- **GoDaddy**: DNS Management → Add → CNAME
- **Namecheap**: Advanced DNS → Add New Record → CNAME
- **Google Domains**: DNS → Custom records → CNAME

### Verification

- Railway dashboard will show verification status
- Green checkmark = verified and ready
- Can take 5 minutes to 72 hours for DNS propagation
- SSL certificate auto-issues after verification

## Troubleshooting

- **Build fails**: Check "Deployments" → "View Logs" for errors
- **Database issues**: If DB seems reset, check if volume is attached and mounted correctly
- **Environment variables**: Make sure `SESSION_SECRET` is set (required for production)
- **Database connection**: Make sure PostgreSQL database is added and `DATABASE_URL` is set (Railway does this automatically)
- **pg_dump not found**: If backups fail, Railway may not have `pg_dump` in PATH. You may need to install PostgreSQL client tools or use Railway's database backup feature instead
- **Domain not verifying**: 
  - Check DNS records are correct (use `dig` or `nslookup` to verify)
  - Wait up to 72 hours for propagation
  - Make sure CNAME value matches exactly (no trailing dots)
  - For root domain, consider using Cloudflare or a subdomain instead

## Railway vs Render

| Feature | Railway | Render Free |
|---------|---------|-------------|
| Spin-down | No (within free tier limits) | Yes (15 min inactivity) |
| Custom domain | Yes (free) | Yes (free) |
| Auto-deploy | Yes (GitHub) | Yes (GitHub) |
| Persistent storage | Volumes available | Ephemeral only |
| Free tier | $5 credit/month | Always free (with spin-down) |
