# Deployment Guide - Free Hosting Options

## Option 1: Render (Recommended - Easiest)

**Render** offers a free tier that's perfect for this app.

### Steps:

1. **Sign up** at [render.com](https://render.com) (free account)

2. **Push your code to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```

3. **Deploy on Render**:
   - Go to [dashboard.render.com](https://dashboard.render.com)
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Configure:
     - **Name**: quotes-site (or whatever you want)
     - **Environment**: Node
     - **Build Command**: `npm install`
     - **Start Command**: `npm start`
     - **Plan**: Free
   
4. **Add Environment Variable**:
   - In the Render dashboard, go to "Environment"
   - Add: `SESSION_SECRET` = (generate a random string, or use: `openssl rand -hex 32`)
   - Add: `NODE_ENV` = `production`

5. **Deploy!** Click "Create Web Service"

Your site will be live at: `https://your-app-name.onrender.com`

**Note**: Free tier spins down after 15 minutes of inactivity, so first load might be slow.

---

## Option 2: Railway (Alternative)

**Railway** also has a good free tier with $5 credit.

### Steps:

1. **Sign up** at [railway.app](https://railway.app)

2. **Push to GitHub** (same as above)

3. **Deploy**:
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your repository
   - Railway auto-detects Node.js

4. **Add Environment Variables**:
   - Go to "Variables" tab
   - Add: `SESSION_SECRET` = (random string)
   - Add: `NODE_ENV` = `production`

5. **Generate Domain**:
   - Go to "Settings" → "Generate Domain"

Your site will be live at: `https://your-app-name.up.railway.app`

---

## Option 3: Fly.io (Alternative)

**Fly.io** has a generous free tier.

### Steps:

1. **Install Fly CLI**: 
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Sign up**: `fly auth signup`

3. **Deploy**:
   ```bash
   fly launch
   ```
   Follow the prompts.

4. **Set secrets**:
   ```bash
   fly secrets set SESSION_SECRET=your-random-secret
   fly secrets set NODE_ENV=production
   ```

---

## Important Notes:

- **Database**: PostgreSQL database required. Railway provides this automatically when you add PostgreSQL service.
- **Session Secret**: Make sure to set a strong random `SESSION_SECRET` in production
- **HTTPS**: All these platforms provide HTTPS automatically
- **Free Tier Limits**: 
  - Render: Spins down after inactivity (15 min)
  - Railway: $5 free credit/month
  - Fly.io: 3 shared VMs free

## Quick Start (Render - Recommended):

1. Push code to GitHub
2. Sign up at render.com
3. Connect GitHub repo
4. Set environment variables
5. Deploy!

Done! 🚀
