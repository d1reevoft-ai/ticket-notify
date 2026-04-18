#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  Ubuntu Setup Script — Ticket Notifier Backend
#  Run on your Ubuntu laptop (HP 245 G9)
#  
#  Usage: chmod +x ubuntu-setup.sh && ./ubuntu-setup.sh
# ═══════════════════════════════════════════════════════════════

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}  Ticket Notifier — Ubuntu Setup${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"

# ── 1. System Updates ──
echo -e "${YELLOW}📦 Updating system packages...${NC}"
sudo apt update && sudo apt upgrade -y

# ── 2. Install Node.js 20 (if not present) ──
if command -v node &> /dev/null; then
    NODE_VER=$(node -v)
    echo -e "${GREEN}✅ Node.js already installed: ${NODE_VER}${NC}"
else
    echo -e "${YELLOW}📦 Installing Node.js 20 LTS...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
    echo -e "${GREEN}✅ Node.js installed: $(node -v)${NC}"
fi

# ── 3. Install build tools for better-sqlite3 ──
echo -e "${YELLOW}🔧 Installing build dependencies...${NC}"
sudo apt install -y build-essential python3 git

# ── 4. Install PM2 (process manager) ──
if command -v pm2 &> /dev/null; then
    echo -e "${GREEN}✅ PM2 already installed${NC}"
else
    echo -e "${YELLOW}📦 Installing PM2...${NC}"
    sudo npm install -g pm2
    echo -e "${GREEN}✅ PM2 installed${NC}"
fi

# ── 5. Install project dependencies ──
echo -e "${YELLOW}📦 Installing project dependencies...${NC}"
npm ci

# ── 6. Build Dashboard ──
echo -e "${YELLOW}🏗️ Building Dashboard...${NC}"
cd dashboard
npm ci --legacy-peer-deps
npm run build
cd ..

# ── 7. Create data and logs directories ──
mkdir -p data logs

# ── 8. Create .env file if not exists ──
if [ ! -f .env.ubuntu ]; then
    cat > .env.ubuntu << 'EOF'
# ══════════════════════════════════════════════════
#  Ubuntu Backend Configuration
# ══════════════════════════════════════════════════

# Port for the web server
PORT=3000

# Plugin mode — NO direct Discord Gateway connection
PLUGIN_MODE=1

# Secret for Vencord plugin authentication
# MUST match the secret in Vencord plugin settings
PLUGIN_SECRET=ticket-notifier-plugin-2026

# Data directory
DATA_DIR=./data

# JWT Secret for dashboard auth (generate your own!)
JWT_SECRET=your-secret-here-change-me

# Telegram Bot (works 24/7 on Ubuntu)
# TG_TOKEN=your-telegram-bot-token
# TG_CHAT_ID=your-telegram-chat-id

# AI Providers
# GEMINI_API_KEYS=key1,key2
EOF
    echo -e "${YELLOW}⚠️  Created .env.ubuntu — edit it with your settings!${NC}"
else
    echo -e "${GREEN}✅ .env.ubuntu already exists${NC}"
fi

# ── 9. Start with PM2 ──
echo -e "${YELLOW}🚀 Starting server with PM2...${NC}"
pm2 start ecosystem.config.js
pm2 save

# ── 10. Set up PM2 startup (auto-start on boot) ──
echo -e "${YELLOW}🔄 Setting up auto-start on boot...${NC}"
pm2 startup systemd -u $USER --hp $HOME || true
pm2 save

# ── 11. Prevent laptop from sleeping ──
echo -e "${YELLOW}💤 Disabling sleep/suspend for server mode...${NC}"
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target 2>/dev/null || true

# ── 12. Install Cloudflare Tunnel ──
echo -e "${YELLOW}🌐 Installing Cloudflare Tunnel (cloudflared)...${NC}"
if command -v cloudflared &> /dev/null; then
    echo -e "${GREEN}✅ cloudflared already installed${NC}"
else
    # Detect architecture
    ARCH=$(uname -m)
    if [ "$ARCH" = "x86_64" ]; then
        CF_ARCH="amd64"
    elif [ "$ARCH" = "aarch64" ]; then
        CF_ARCH="arm64"
    else
        CF_ARCH="amd64"
    fi
    
    curl -L "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" -o /tmp/cloudflared
    chmod +x /tmp/cloudflared
    sudo mv /tmp/cloudflared /usr/local/bin/cloudflared
    echo -e "${GREEN}✅ cloudflared installed${NC}"
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Setup Complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}📋 Next Steps:${NC}"
echo ""
echo "  1. Edit .env.ubuntu with your Telegram token and other settings"
echo "  2. Restart PM2:  pm2 restart ticket-notifier"
echo "  3. Start Cloudflare Tunnel:"
echo "     cloudflared tunnel --url http://localhost:3000"
echo "     → This gives you a public URL for the dashboard"
echo ""
echo "  4. Copy the Vencord plugin to your main PC:"
echo '     Copy vencord-plugin/ticketNotifier/ → %APPDATA%/Vencord/dist/userplugins/'
echo "     Then restart Discord"
echo ""
echo "  5. In Vencord settings, configure TicketNotifier plugin:"
echo "     Server URL: ws://$(hostname -I | awk '{print $1}'):3000"
echo "     Secret: (match what's in .env.ubuntu)"
echo ""
echo -e "${GREEN}🔍 Useful commands:${NC}"
echo "  pm2 status          — Check if server is running"
echo "  pm2 logs            — View live logs"
echo "  pm2 restart all     — Restart server"
echo "  pm2 monit           — Monitor CPU/RAM"
echo ""
echo -e "${GREEN}🌐 Your local IP: $(hostname -I | awk '{print $1}')${NC}"
