# Deployment Guide — Code Receive

This guide covers deploying on a VPS with Docker, setting up Nginx as a reverse proxy, obtaining a free SSL certificate, and connecting your domain.

---

## Prerequisites

- A VPS (Ubuntu/Debian) — e.g. DigitalOcean, Hetzner, Vultr, Linode
- A domain name pointed to your VPS IP (A record)
- SSH access to the server

---

## 1. Point Your Domain to the VPS

Log into your domain registrar (Namecheap, Cloudflare, GoDaddy, etc.) and create an **A record**:

| Type | Name            | Value           | TTL  |
|------|-----------------|-----------------|------|
| A    | `@`             | `YOUR_VPS_IP`   | Auto |
| A    | `www` (optional)| `YOUR_VPS_IP`   | Auto |

> [!NOTE]
> DNS propagation can take up to 24 hours, but usually completes within minutes.

---

## 2. Server Setup

SSH into your VPS:
```bash
ssh root@YOUR_VPS_IP
```

Update the system and open required ports:
```bash
apt update && apt upgrade -y

ufw allow 22    # SSH
ufw allow 80    # HTTP
ufw allow 443   # HTTPS
ufw enable
```

---

## 3. Install Docker

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
apt install docker-compose-plugin -y
```

Verify:
```bash
docker --version
docker compose version
```

---

## 4. Deploy the Application

### Upload the project
```bash
# Option A: Git clone
git clone https://github.com/YOUR_USERNAME/Code_Receive.git /opt/code-receive

# Option B: SCP from local machine
scp -r ./Code_Receive root@YOUR_VPS_IP:/opt/code-receive
```

### Configure environment
```bash
cd /opt/code-receive
mkdir -p data    # SQLite volume
cp .env.example .env
nano .env
```

Fill in your `.env` — the critical values:
```bash
IMAP_USER=your-email@gmail.com
IMAP_PASSWORD=your-16-char-app-password    # Gmail App Password
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_ENCRYPTION=ssl
IMAP_MAILBOX=INBOX
LOOKBACK_MINUTES=8
LOCK_PASSWORDS=your-group-password
AUTHORIZED_INBOX=your-email@gmail.com
ALLOWED_DOMAINS=gmail.com,example.com
ADMIN_PASSWORDS=strong_admin_password
ADMIN_SESSION_SECRET=change-this-to-random-string
ADMIN_SESSION_HOURS=24
DATABASE_URL=file:/app/data/dev.db
```

> [!IMPORTANT]
> Set `DATABASE_URL=file:/app/data/dev.db` so the database is stored in the Docker volume and persists across container restarts.

### Launch
```bash
docker compose up -d --build
```

Check it's running:
```bash
docker compose logs -f
# Look for: [SYNC] 🔄 Starting background sync loop
```

The app is now running on `http://YOUR_VPS_IP:3000`.

---

## 5. Nginx Reverse Proxy

Install Nginx:
```bash
apt install nginx -y
```

Create the site config:
```bash
nano /etc/nginx/sites-available/code-receive
```

Paste this config (replace `your-domain.com`):
```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable and test:
```bash
ln -s /etc/nginx/sites-available/code-receive /etc/nginx/sites-enabled/
nginx -t && systemctl restart nginx
```

Your site is now accessible at `http://your-domain.com`.

---

## 6. Free SSL with Certbot (HTTPS)

Install Certbot:
```bash
apt install certbot python3-certbot-nginx -y
```

Obtain and install the certificate:
```bash
certbot --nginx -d your-domain.com -d www.your-domain.com
```

Certbot will:
- Automatically modify your Nginx config to serve HTTPS
- Set up auto-renewal via a systemd timer

Test auto-renewal:
```bash
certbot renew --dry-run
```

Your site is now live at `https://your-domain.com` 🎉

---

## 7. Managing the App

### Restart
```bash
cd /opt/code-receive
docker compose restart
```

### Update (pull new code and rebuild)
```bash
cd /opt/code-receive
git pull origin main
docker compose up -d --build
```

### View logs
```bash
docker compose logs -f
```

### Stop
```bash
docker compose stop
```

---

## 8. Alternative: PM2 (No Docker)

If you prefer running without Docker:

```bash
# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Install PM2
npm install pm2 -g

# Setup the app
cd /opt/code-receive
npm install
npx prisma db push
npm run build

# Start with PM2
pm2 start npm --name "code-receive" -- start
pm2 save
pm2 startup    # Auto-start on reboot
```

Then set up Nginx + Certbot the same way (steps 5 and 6 above).

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| IMAP login failed | Regenerate Gmail App Password, ensure IMAP is enabled in Gmail settings |
| Database errors | Check permissions: `chmod 755 data && chmod 644 data/dev.db` |
| 502 Bad Gateway | App isn't running — check `docker compose logs` or `pm2 logs` |
| SSL cert expired | Run `certbot renew` |
| DNS not resolving | Wait for propagation, verify A record points to correct IP |
