# ARIA Fleet — Setup Guide

Manage 25 AI-powered phones from one admin device.

## Architecture

```
Your Main Phone (Admin)  →  Backend Server  →  25 Customer Phones
     /admin                  (VPS $5/mo)         /phone?id=PHONE_ID
```

---

## 1. Get a Server (5 minutes)

Sign up at [DigitalOcean](https://digitalocean.com) or [Hetzner](https://hetzner.com).
Create the cheapest Linux droplet (Ubuntu 22.04, $4-6/mo).

---

## 2. Install on the Server

```bash
# SSH into your server
ssh root@YOUR_SERVER_IP

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Upload/clone this fleet/ folder to the server
# (use git, scp, or any file transfer)
cd /opt
git clone YOUR_REPO_URL aria-fleet
cd aria-fleet/fleet

# Install dependencies
npm install

# Start the server
npm start
```

The server runs on port **3000**.

---

## 3. (Recommended) Keep It Running with PM2

```bash
npm install -g pm2
pm2 start server.js --name aria-fleet
pm2 save
pm2 startup    # auto-start on reboot
```

---

## 4. (Optional) Point a Domain + HTTPS

With a domain (e.g. `fleet.yourbusiness.com`):

```bash
# Install nginx + certbot
sudo apt install -y nginx certbot python3-certbot-nginx

# Create nginx config at /etc/nginx/sites-available/fleet
server {
    server_name fleet.yourbusiness.com;
    location / { proxy_pass http://localhost:3000; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; proxy_set_header Host $host; }
}

# Enable + get SSL cert
sudo ln -s /etc/nginx/sites-available/fleet /etc/nginx/sites-enabled/
sudo certbot --nginx -d fleet.yourbusiness.com
```

---

## 5. First-Time Config

Open the admin dashboard on YOUR phone:
```
http://YOUR_SERVER_IP:3000/admin
```

Default PIN: **1234**
(Change via the `ADMIN_PIN` env variable: `ADMIN_PIN=9999 npm start`)

1. Go to **Settings** → paste your Anthropic API key
2. Go to **AI Agents** → create your first agent
3. Go to **Knowledge** → add product info, FAQs, etc.
4. Go to **Phones** → add all 25 phones (set name + passcode per phone)
5. Go to **Push to Phones** → assign agents + knowledge to phones → Push Now

---

## 6. Set Up Customer Phones

Each customer phone gets a unique URL:
```
http://YOUR_SERVER_IP:3000/phone?id=PHONE_ID
```

Find each phone's ID in the admin **Phones** tab.

**On each customer phone:**
1. Open Chrome → go to the phone's URL
2. Tap the menu → **"Add to Home Screen"**
3. It now works like an app with no browser bar
4. Customer enters their passcode to unlock

---

## Environment Variables

| Variable    | Default | Description              |
|-------------|---------|--------------------------|
| `PORT`      | 3000    | Server port              |
| `ADMIN_PIN` | 1234    | Admin dashboard PIN      |
| `DB_PATH`   | ./fleet.db | SQLite database path  |

Example:
```bash
PORT=3000 ADMIN_PIN=7749 node server.js
```

---

## What the Admin Can Do (Your Main Phone)

| Action | Where |
|--------|-------|
| See all phones + online status | Overview tab |
| Add/remove phones | Phones tab |
| Create/edit AI agents | AI Agents tab |
| Add/update knowledge bases | Knowledge tab |
| Push agents + knowledge to phones | Push to Phones tab |
| View conversation history per phone | Phones → View |
| Set Anthropic API key | Settings tab |

**When you update an agent or knowledge base, phones receive the update instantly** via WebSocket — no refresh needed.

---

## Scaling Beyond 25 Phones

The SQLite + Node.js stack handles 25-100 phones easily on a $5 VPS. For larger fleets, swap SQLite for PostgreSQL and add a load balancer.
