# Development & Deployment Guide

## 1. Environment Variables Setup

The most critical part of this application is getting the correct credentials for Gmail.

### Step 1: Gmail App Password

1. Log in to the Gmail account you want to use
2. Go to [Google Account Security](https://myaccount.google.com/security)
3. Enable **2-Step Verification** if it's not already on
4. Search for "App passwords" in the top search bar (or look under 2-Step Verification)
5. Create a new App Password:
   - **App**: Select "Mail" or "Other (Custom name)"
   - **Device**: Select your device or "Other"
   - Click **Generate**
6. Copy the 16-character password (e.g., `abcd efgh ijkl mnop`). This is your `IMAP_PASSWORD`

### Step 2: Configure .env

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Fill in the values:

   ```bash
   # IMAP Configuration
   IMAP_USER=your-email@gmail.com
   IMAP_PASSWORD=your-16-char-app-password
   IMAP_HOST=imap.gmail.com
   IMAP_PORT=993
   IMAP_ENCRYPTION=ssl
   IMAP_MAILBOX=[Gmail]/All Mail
   
   # Search Settings
   LOOKBACK_MINUTES=5
   AUTHORIZED_INBOX=your-email@gmail.com
   
   # Domain Restrictions (leave empty to allow all domains)
   ALLOWED_DOMAINS=gmail.com,example.com
   
   # Admin Panel
   ADMIN_PASSWORDS=your_secure_password_here
   ADMIN_SESSION_HOURS=24
   
   # Database
   DATABASE_URL=file:./dev.db
   ```

**Important**: 
- `IMAP_USER` and `AUTHORIZED_INBOX` should usually be the same
- `ALLOWED_DOMAINS` controls which email domains users can search for (leave empty to allow all)
- `ADMIN_PASSWORDS` is a comma-separated list of passwords for the admin panel

---

## 2. Local Development

### Install Dependencies
```bash
npm install
```

### Initialize Database
This creates the `dev.db` file and sets up the schema:
```bash
npx prisma db push
```

### Run Development Server
```bash
npm run dev
```

The app will be at http://localhost:3000

### How It Works

The new architecture uses a **singleton background sync**:
- Background sync runs every 10 seconds (starts automatically when first API request is made)
- **One persistent IMAP connection** shared across all users
- API routes are **DB-only reads** (no IMAP connections per request)
- This supports **unlimited concurrent users** without hitting Gmail's rate limits

---

## 3. Deployment Options

### Option A: Render.com (Easiest + Free Tier) ⭐ Recommended

[Render](https://render.com) offers a generous free tier with automatic deployments from GitHub.

**Steps**:

1. **Push your code to GitHub** (if not already)
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/your-username/your-repo.git
   git push -u origin main
   ```

2. **Sign up at [Render.com](https://render.com)** (free account)

3. **Create a new Web Service**:
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - **Name**: `code-receive` (or any name)
   - **Environment**: `Node`
   - **Build Command**: `npm install && npx prisma generate && npm run build`
   - **Start Command**: `npm start`

4. **Add Environment Variables** (click "Environment" tab):
   - Add all variables from your `.env` file
   - **Important**: Change `DATABASE_URL` to `file:./data/dev.db` for persistence

5. **Add a Persistent Disk** (for SQLite database):
   - Click "Volumes" → "Add Disk"
   - **Name**: `data`
   - **Mount Path**: `/opt/render/project/src/data`
   - **Size**: 1GB (free tier)

6. **Deploy**: Click "Create Web Service"

**Cost**: **FREE** on Render's free tier (includes 750 hours/month)

**Pros**:
- ✅ Zero config deployment
- ✅ Automatic HTTPS
- ✅ Auto-deploy on git push
- ✅ Free tier available
- ✅ Logs & monitoring built-in

**Cons**:
- ⚠️ Free tier sleeps after 15 minutes of inactivity (first request may be slow)

---

### Option B: Railway.app (Free $5 Credit/Month)

[Railway](https://railway.app) is a modern platform with a generous free tier.

**Steps**:

1. **Sign up at [Railway.app](https://railway.app)** (GitHub login)
2. **Click "New Project"** → "Deploy from GitHub repo"
3. **Select your repository**
4. **Add Environment Variables**:
   - Click your service → "Variables" tab
   - Add all env vars from `.env`
5. **Add a Volume** (for database persistence):
   - Click "Settings" → "Volumes"
   - **Mount Path**: `/app/data`
   - Update `DATABASE_URL=file:./data/dev.db`
6. **Deploy**: Railway auto-deploys

**Cost**: **$5 free credit/month** (usually enough for small apps)

**Pros**:
- Never sleeps (unlike Render free tier)
- Very fast deployments
- Great DX (developer experience)
- Automatic HTTPS

**Cons**:
- Free tier is $5 credit/month (pay-as-you-go after that)

---

### Option C: Docker + Any VPS (Full Control) ⭐ Recommended for Production

This is the most robust way to deploy. Works on any Ubuntu/Debian-based VPS (DigitalOcean, Hetzner, Vultr, Linode, etc.).

#### Step 1: Server Preparation
SSH into your VPS and update the system:
```bash
ssh root@your-vps-ip
apt update && apt upgrade -y
# Optional: Setup firewall
ufw allow 22
ufw allow 80
ufw allow 443
ufw enable
```

#### Step 2: Install Docker & Docker Compose
Quick install script for Ubuntu:
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
apt install docker-compose-plugin -y
```

#### Step 3: Deployment
1. **Upload project** (use Git or SCP):
   ```bash
   # From your local machine
   scp -r ./Code_Receive root@your-vps-ip:/opt/code-receive
   ```
2. **Move to project folder**:
   ```bash
   cd /opt/code-receive
   mkdir -p data # Create volume folder for SQLite
   ```
3. **Configure Environment**:
   ```bash
   cp .env.example .env
   nano .env
   # Ensure DATABASE_URL=file:/app/data/dev.db
   ```
4. **Launch**:
   ```bash
   docker compose up -d
   ```

#### Step 4: Reverse Proxy (Nginx) & SSL
Running on port 3000 is good, but you need HTTPS for production.

1. **Install Nginx**: `apt install nginx -y`
2. **Create config**: `nano /etc/nginx/sites-available/code-receive`
```nginx
server {
    server_name your-domain.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
3. **Enable & Link**:
```bash
ln -s /etc/nginx/sites-available/code-receive /etc/nginx/sites-enabled/
nginx -t && systemctl restart nginx
```
4. **Get Free SSL (Certbot)**:
```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d your-domain.com
```

---

### Option D: PM2 (Non-Docker Deployment)

If you don't want to use Docker, you can run the app directly using PM2.

1. **Install Node.js & PM2**:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
   apt install -y nodejs
   npm install pm2 -g
   ```
2. **Clone & Install**:
   ```bash
   cd /opt/code-receive
   npm install
   npx prisma db push
   npm run build
   ```
3. **Start with PM2**:
   ```bash
   pm2 start npm --name "code-receive" -- start
   pm2 save
   pm2 startup
   ```

---


## 4. Troubleshooting

### Issue: "IMAP Login Failed"

**Solution**:
1. Double-check your App Password (regenerate if needed)
2. Ensure IMAP is enabled in Gmail: Settings → Forwarding and POP/IMAP → Enable IMAP
3. Try the test script:
   ```bash
   node -e "import('./lib/imap.js').then(m => m.testImapConnection()).then(console.log)"
   ```

### Issue: "Email domain is not allowed"

**Solution**: Update `ALLOWED_DOMAINS` in `.env`:
```bash
ALLOWED_DOMAINS=gmail.com,example.com
# Or leave empty to allow all:
ALLOWED_DOMAINS=
```

### Issue: Database Permission Errors

**Solution**: Ensure the app has write permissions:
```bash
chmod 755 .
chmod 644 dev.db 
```

### Issue: Background Sync Not Starting

**Solution**: Make at least one API request to trigger it:
```bash
curl http://localhost:3000/api/codes?email=test@example.com
```

Check logs for `[SYNC] Starting background sync loop`

---

## 5. Production Checklist

Before deploying to production:

- [ ] Change `ADMIN_PASSWORDS` to strong, unique passwords
- [ ] Generate a new `ADMIN_SESSION_SECRET`:
  ```bash
  openssl rand -hex 32
  ```
- [ ] Set `ALLOWED_DOMAINS` to restrict email searches (or leave empty to allow all)
- [ ] Update `LOOKBACK_MINUTES` to a reasonable value (5-10 minutes)
- [ ] Test IMAP connection with production credentials
- [ ] Set up database backups (important for SQLite deployments)
- [ ] Configure HTTPS (Render/Railway do this automatically)

---

## 6. Monitoring & Logs

### Check Background Sync Status

Watch the logs for sync activity:
```bash
# Local
npm run dev

# Docker
docker-compose logs -f

# Render/Railway
Check the "Logs" tab in your dashboard
```

Look for these log patterns:
```
[SYNC] Starting background sync loop
[SYNC]  Connected to imap.gmail.com
[SYNC]  Found 5 emails to process
[SYNC]  Saved 9 new code(s)
[SYNC]  No new codes (all duplicates)
```

### Check IMAP Auth Status

Visit: `http://your-domain/api/auth/status`

Should return:
```json
{
  "authenticated": true,
  "message": "IMAP connected. Ready to search."
}
```

---

## 7. Architecture Overview

```
┌─────────────────────────────────────────┐
│     Background Sync (every 10s)         │
│  ┌───────────────────────────────────┐  │
│  │ Persistent IMAP Connection        │  │
│  │ ├─ Connect once                   │  │
│  │ ├─ Reuse connection               │  │
│  │ └─ Reconnect on failure           │  │
│  └───────────────────────────────────┘  │
│              ↓                           │
│         Extract codes                    │
│              ↓                           │
│      ┌──────────────┐                    │
│      │   SQLite DB  │                    │
│      └──────────────┘                    │
└─────────────────────────────────────────┘
                ↑
                │ (read-only)
                │
    ┌───────────┴────────────┐
    │                        │
┌───────┐              ┌──────────┐
│ /api/ │              │ /api/    │
│ codes │              │ admin/   │
│       │              │ codes    │
└───────┘              └──────────┘
    ↑                       ↑
    │                       │
  Users                   Admin
```

**Key Points**:
- **One IMAP connection** for all users (no rate limits)
- **Database-only reads** for API routes (fast & scalable)
- **Mutex lock** prevents sync race conditions
- **Batch deduplication** prevents duplicate codes

---
