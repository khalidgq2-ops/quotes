# Railway Deployment Guide

## Quick Setup

1. **Sign up** at [railway.app](https://railway.app) (free account with $5 credit/month)

2. **Connect GitHub**:
   - In Railway dashboard, click "New Project"
   - Select "Deploy from GitHub repo"
   - Authorize Railway to access your GitHub
   - Choose the `quotes` repository

3. **Railway auto-detects Node.js** and starts deploying

4. **Add Environment Variables**:
   - Go to your service → "Variables" tab
   - Add:
     - `SESSION_SECRET` = (generate: `openssl rand -hex 32` or any random string)
     - `NODE_ENV` = `production`
     - `BACKUP_CRON` = `0 3 * * 0,3` (optional, default is 2×/week)
     - `MAX_BACKUPS` = `8` (optional, default is 8)

5. **Custom Domain** (optional):
   - Go to "Settings" → "Networking"
   - Click "Generate Domain" for a Railway subdomain, OR
   - Add your own domain:
     - Click "Custom Domain"
     - Enter your domain (e.g. `quotes.yourdomain.com`)
     - Railway will show DNS records to add (usually CNAME pointing to Railway)

6. **Deploy**: Railway auto-deploys on every push to `main` branch

## Important Notes

- **Database**: SQLite file (`quotes.db`) is stored on Railway's ephemeral disk. It persists across restarts but **not across redeploys**.
- **Backups**: Backups go to `backups/` folder (also ephemeral). For durability, consider:
  - Using Railway's **Volume** (persistent storage) - add in "Settings" → "Volumes"
  - Or copying backups to external storage (S3, etc.) via a script
- **24/7 Uptime**: Railway free tier has ~500 hours/month. For true 24/7, consider their paid plan ($5/month).
- **First Deploy**: Takes 2-3 minutes. Your site will be live at the generated Railway domain.

## After Deployment

1. Visit your Railway URL
2. Login with default: `admin` / `admin123`
3. **Change the admin password** immediately via Admin panel
4. Create users and groups as needed

## Troubleshooting

- **Build fails**: Check "Deployments" → "View Logs" for errors
- **Database issues**: If DB seems reset, check if volume is attached and mounted correctly
- **Environment variables**: Make sure `SESSION_SECRET` is set (required for production)

## Railway vs Render

| Feature | Railway | Render Free |
|---------|---------|-------------|
| Spin-down | No (within free tier limits) | Yes (15 min inactivity) |
| Custom domain | Yes (free) | Yes (free) |
| Auto-deploy | Yes (GitHub) | Yes (GitHub) |
| Persistent storage | Volumes available | Ephemeral only |
| Free tier | $5 credit/month | Always free (with spin-down) |
