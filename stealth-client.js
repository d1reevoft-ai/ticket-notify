#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  Stealth Gateway Client — Puppeteer Edition
//  Runs on home Ubuntu server with residential IP
//  Launches real Chrome → Discord Web → intercepts Gateway events
//  Forwards everything to Railway server
// ═══════════════════════════════════════════════════════════════

const puppeteer = require('puppeteer-core');
const WebSocket = require('ws');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { getDiscordRestHeaders } = require('./src/bot/stealthProfile');

// ── Config ───────────────────────────────────────────────────
const CONFIG_FILE = path.join(__dirname, 'relay-config.json');
let config = {};
try {
    if (fs.existsSync(CONFIG_FILE)) {
        config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
} catch (e) {
    console.error('❌ Failed to load relay-config.json:', e.message);
}

const DISCORD_TOKEN = config.discordToken || process.env.DISCORD_TOKEN || '';
const RAILWAY_URL = config.railwayUrl || process.env.RAILWAY_URL || '';
const RELAY_SECRET = config.relaySecret || process.env.RELAY_SECRET || 'stealth-relay-secret-2026';
const CHROME_PATH = config.chromePath || process.env.CHROME_PATH || '/usr/bin/chromium-browser';
const USE_PUPPETEER = config.usePuppeteer !== false; // Default true

if (!DISCORD_TOKEN) { console.error('❌ DISCORD_TOKEN не задан'); process.exit(1); }
if (!RAILWAY_URL) { console.error('❌ RAILWAY_URL не задан'); process.exit(1); }

const LOG = '[Stealth]';

// ── State ────────────────────────────────────────────────────
let railwayWs = null;
let railwayReconnectTimer = null;
let browser = null;
let page = null;
let gatewayIntercepted = false;

function log(msg, type = 'INFO') {
    const ts = new Date().toLocaleTimeString('ru-RU', { timeZone: 'Europe/Kiev' });
    console.log(`[${ts}] [${type}] ${msg}`);
}

// ═══════════════════════════════════════════════════════════════
//  RAILWAY CONNECTION
// ═══════════════════════════════════════════════════════════════

function connectToRailway() {
    if (railwayReconnectTimer) { clearTimeout(railwayReconnectTimer); railwayReconnectTimer = null; }
    const wsUrl = RAILWAY_URL.replace(/^http/, 'ws') + '/relay?secret=' + encodeURIComponent(RELAY_SECRET);
    log(`🔗 Connecting to Railway: ${RAILWAY_URL}...`);

    try { railwayWs = new WebSocket(wsUrl); } catch (e) {
        log(`❌ Railway connect error: ${e.message}`);
        scheduleRailwayReconnect();
        return;
    }

    railwayWs.on('open', () => {
        log('✅ Connected to Railway');
        sendToRailway({ type: 'auth', secret: RELAY_SECRET, mode: USE_PUPPETEER ? 'puppeteer' : 'node', ts: Date.now() });
    });

    railwayWs.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        handleRailwayCommand(msg);
    });

    railwayWs.on('close', (code) => {
        log(`🔌 Railway disconnected (${code})`);
        railwayWs = null;
        scheduleRailwayReconnect();
    });

    railwayWs.on('error', (e) => log(`❌ Railway error: ${e.message}`));
}

function scheduleRailwayReconnect() {
    if (railwayReconnectTimer) return;
    railwayReconnectTimer = setTimeout(() => { railwayReconnectTimer = null; connectToRailway(); }, 5000);
}

function sendToRailway(data) {
    if (!railwayWs || railwayWs.readyState !== WebSocket.OPEN) return false;
    try { railwayWs.send(JSON.stringify(data)); return true; } catch { return false; }
}

// ═══════════════════════════════════════════════════════════════
//  RAILWAY COMMANDS → Discord REST (via laptop's IP)
// ═══════════════════════════════════════════════════════════════

async function handleRailwayCommand(msg) {
    log(`Received command from Railway: ${msg.type}${msg.channelId ? ` (chan: ${msg.channelId})` : ''}`, 'RELAY');
    switch (msg.type) {
        case 'sendMessage': {
            const body = { content: msg.content };
            if (msg.replyTo) body.message_reference = { message_id: msg.replyTo };
            const res = await discordRest('POST', `/channels/${msg.channelId}/messages`, body);
            sendToRailway({ type: 'sendMessageResult', reqId: msg.reqId, ...res });
            break;
        }
        case 'editMessage': {
            const res = await discordRest('PATCH', `/channels/${msg.channelId}/messages/${msg.messageId}`, { content: msg.content });
            sendToRailway({ type: 'editMessageResult', reqId: msg.reqId, ...res });
            break;
        }
        case 'deleteMessage': {
            const res = await discordRest('DELETE', `/channels/${msg.channelId}/messages/${msg.messageId}`);
            sendToRailway({ type: 'deleteMessageResult', reqId: msg.reqId, ...res });
            break;
        }
        case 'triggerTyping':
            discordRest('POST', `/channels/${msg.channelId}/typing`);
            break;
        case 'addReaction':
            discordRest('PUT', `/channels/${msg.channelId}/messages/${msg.messageId}/reactions/${encodeURIComponent(msg.emoji)}/@me`);
            break;
        case 'fetchMessages': {
            let ep = `/channels/${msg.channelId}/messages?limit=${msg.limit || 100}`;
            if (msg.before) ep += `&before=${msg.before}`;
            const res = await discordRest('GET', ep);
            sendToRailway({ type: 'fetchMessagesResult', reqId: msg.reqId, ...res });
            break;
        }
        case 'fetchChannels': {
            const res = await discordRest('GET', `/guilds/${msg.guildId}/channels`);
            sendToRailway({ type: 'fetchChannelsResult', reqId: msg.reqId, ...res });
            break;
        }
        case 'sendInteraction': {
            const res = await discordRest('POST', '/interactions', msg.payload);
            sendToRailway({ type: 'sendInteractionResult', reqId: msg.reqId, ...res });
            break;
        }
        case 'ping':
            sendToRailway({ type: 'pong', ts: Date.now() });
            break;
    }
}

function discordRest(method, endpoint, body = null) {
    log(`Discord REST: ${method} ${endpoint}`, 'HTTP');
    const headers = getDiscordRestHeaders(DISCORD_TOKEN, { isBotToken: false });
    const url = `https://discord.com/api/v9${endpoint}`;
    return new Promise((resolve) => {
        const u = new URL(url);
        const opts = { hostname: u.hostname, path: u.pathname + u.search, method, headers: { ...headers } };
        if (body && ['POST', 'PATCH', 'PUT'].includes(method)) {
            const data = JSON.stringify(body);
            opts.headers['Content-Length'] = Buffer.byteLength(data);
            const req = https.request(opts, (res) => {
                let chunks = '';
                res.on('data', c => chunks += c);
                res.on('end', () => {
                    log(`REST Response: ${method} ${endpoint} -> ${res.statusCode}`, 'HTTP');
                    resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: chunks });
                });
            });
            req.on('error', (e) => {
                log(`REST Error: ${method} ${endpoint} -> ${e.message}`, 'ERROR');
                resolve({ ok: false, status: 0, body: e.message });
            });
            req.write(data);
            req.end();
        } else {
            delete opts.headers['Content-Type'];
            const req = https.request(opts, (res) => {
                let chunks = '';
                res.on('data', c => chunks += c);
                res.on('end', () => {
                    log(`REST Response: ${method} ${endpoint} -> ${res.statusCode}`, 'HTTP');
                    resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: chunks });
                });
            });
            req.on('error', (e) => {
                log(`REST Error: ${method} ${endpoint} -> ${e.message}`, 'ERROR');
                resolve({ ok: false, status: 0, body: e.message });
            });
            req.end();
        }
    });
}

// ═══════════════════════════════════════════════════════════════
//  PUPPETEER — Real Chrome Browser
// ═══════════════════════════════════════════════════════════════

async function launchBrowser() {
    log('🌐 Launching headless Chrome...');

    browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-extensions',
            '--window-size=1280,720',
        ],
    });

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // Inject Gateway WebSocket interceptor BEFORE any page scripts run
    await page.evaluateOnNewDocument((token) => {
        // Store token for login
        window.__DISCORD_TOKEN = token;

        // Intercept WebSocket creation to capture Gateway events
        const OrigWebSocket = window.WebSocket;
        window.WebSocket = function (url, protocols) {
            const ws = protocols
                ? new OrigWebSocket(url, protocols)
                : new OrigWebSocket(url);

            if (url && url.includes('gateway.discord.gg')) {
                console.log('[Stealth] Gateway WebSocket intercepted!');
                window.__discordGatewayWs = ws;

                ws.addEventListener('message', (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.op === 0 && data.t) {
                            // Forward dispatch events to Node.js
                            window.__onGatewayDispatch(data.t, JSON.stringify(data.d), data.s || 0);
                        }
                    } catch { }
                });

                ws.addEventListener('open', () => {
                    window.__onGatewayStatus('connected');
                });

                ws.addEventListener('close', (e) => {
                    window.__onGatewayStatus('closed:' + e.code);
                });
            }

            return ws;
        };

        // Copy prototype & static properties
        window.WebSocket.prototype = OrigWebSocket.prototype;
        window.WebSocket.CONNECTING = OrigWebSocket.CONNECTING;
        window.WebSocket.OPEN = OrigWebSocket.OPEN;
        window.WebSocket.CLOSING = OrigWebSocket.CLOSING;
        window.WebSocket.CLOSED = OrigWebSocket.CLOSED;

    }, DISCORD_TOKEN);

    // Expose functions from Node.js to browser
    await page.exposeFunction('__onGatewayDispatch', (event, dataJson, seq) => {
        try {
            const data = JSON.parse(dataJson);
            log(`Discord Event: ${event}`, 'GATEWAY');
            sendToRailway({ type: 'dispatch', event, data, seq });

            if (event === 'READY') {
                gatewayIntercepted = true;
                log(`✅ READY — user: ${data.user?.username} (${data.user?.id})`, 'AUTH');
            }
        } catch (e) {
            log(`⚠️ Dispatch parse error: ${e.message}`, 'ERROR');
        }
    });

    await page.exposeFunction('__onGatewayStatus', (status) => {
        log(`📡 Gateway WebSocket: ${status}`);
        if (status.startsWith('closed')) {
            gatewayIntercepted = false;
        }
    });

    // Navigate to Discord and inject token
    log('🔐 Logging into Discord Web...');
    await page.goto('https://discord.com/login', { waitUntil: 'domcontentloaded' });

    // Set token in localStorage
    await page.evaluate((token) => {
        localStorage.setItem('token', JSON.stringify(token));
    }, DISCORD_TOKEN);

    // Reload to trigger login with token
    await page.reload({ waitUntil: 'domcontentloaded' });

    log('⏳ Waiting for Discord to load...');

    // Wait for Discord app to fully load
    try {
        await page.waitForSelector('[class*="guilds"]', { timeout: 30000 });
        log('✅ Discord Web loaded successfully');
    } catch {
        log('⚠️ Discord Web load timeout — may still work');
    }

    // Keep-alive: prevent browser from sleeping
    setInterval(async () => {
        try {
            if (page && !page.isClosed()) {
                await page.evaluate(() => document.title);
            }
        } catch { }
    }, 30_000);

    log('🎯 Puppeteer stealth client is running');
}

// ═══════════════════════════════════════════════════════════════
//  NODE.JS FALLBACK — stealth identify (no Chrome)
// ═══════════════════════════════════════════════════════════════

const { buildIdentifyPayload } = require('./src/bot/stealthProfile');
const GATEWAY_URL = 'wss://gateway.discord.gg/?v=9&encoding=json';
const RESUMABLE_CODES = [4000, 4001, 4002, 4003, 4005, 4007, 4009];

let discordWs = null;
let sessionId = null;
let seq = null;
let heartbeatTimer = null;
let receivedAck = true;

function connectNodeGateway() {
    log('🔌 Connecting to Discord Gateway (Node.js mode)...');
    try { if (discordWs) discordWs.close(1000); } catch { }

    discordWs = new WebSocket(GATEWAY_URL);
    discordWs.on('open', () => log('🔗 Gateway connected'));
    discordWs.on('error', (e) => log(`❌ Gateway error: ${e.message}`));

    discordWs.on('close', (code) => {
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
        if (code === 4004) { log('❌ Token invalid'); process.exit(1); }
        const delay = RESUMABLE_CODES.includes(code) ? 2000 : 5000;
        if (!RESUMABLE_CODES.includes(code)) { sessionId = null; seq = null; }
        log(`🔌 Gateway closed (${code}), reconnecting in ${delay / 1000}s...`);
        setTimeout(connectNodeGateway, delay);
    });

    discordWs.on('message', (raw) => {
        let data;
        try { data = JSON.parse(raw); } catch { return; }
        if (data.s) seq = data.s;

        switch (data.op) {
            case 10:
                receivedAck = true;
                log(`Gateway Hello. Interval: ${data.d.heartbeat_interval}ms`, 'GATEWAY');
                const jitter = Math.random() * data.d.heartbeat_interval;
                setTimeout(() => {
                    log(`Sending first heartbeat`, 'GATEWAY');
                    if (discordWs?.readyState === WebSocket.OPEN) discordWs.send(JSON.stringify({ op: 1, d: seq }));
                    heartbeatTimer = setInterval(() => {
                        if (!receivedAck) { log('No heartbeat ACK received, reconnecting...', 'WARNING'); discordWs?.close(4000); return; }
                        receivedAck = false;
                        log(`Sending heartbeat`, 'GATEWAY');
                        if (discordWs?.readyState === WebSocket.OPEN) discordWs.send(JSON.stringify({ op: 1, d: seq }));
                    }, data.d.heartbeat_interval);
                }, jitter);

                if (sessionId && seq) {
                    log(`Sending Resume request`, 'AUTH');
                    discordWs.send(JSON.stringify({ op: 6, d: { token: DISCORD_TOKEN, session_id: sessionId, seq } }));
                } else {
                    log(`Sending Identify request`, 'AUTH');
                    discordWs.send(JSON.stringify({ op: 2, d: buildIdentifyPayload(DISCORD_TOKEN) }));
                }
                break;
            case 11: 
                receivedAck = true; 
                log(`Heartbeat ACK received`, 'GATEWAY');
                break;
            case 7: 
                log(`Reconnect request received`, 'GATEWAY');
                discordWs.close(4000); 
                break;
            case 9: 
                log(`Invalid Session`, 'WARNING');
                sessionId = null; 
                seq = null; 
                setTimeout(() => discordWs.close(4000), 2000); 
                break;
            case 0:
                log(`Discord Event (Node): ${data.t}`, 'GATEWAY');
                if (data.t === 'READY') { 
                    sessionId = data.d.session_id; 
                    log(`✅ READY — ${data.d.user?.username}`, 'AUTH'); 
                }
                if (data.t === 'RESUMED') log('✅ RESUMED', 'AUTH');
                sendToRailway({ type: 'dispatch', event: data.t, data: data.d, seq });
                break;
        }
    });
}

// ═══════════════════════════════════════════════════════════════
//  HEALTH MONITOR
// ═══════════════════════════════════════════════════════════════

setInterval(() => {
    const rwStatus = railwayWs?.readyState === WebSocket.OPEN ? '🟢' : '🔴';
    const mode = USE_PUPPETEER ? (gatewayIntercepted ? '🟢 Puppeteer' : '🟡 Puppeteer (loading)') : (discordWs?.readyState === WebSocket.OPEN ? '🟢 Node.js' : '🔴 Node.js');
    log(`💓 Railway=${rwStatus} Discord=${mode}`);
}, 60_000);

// ═══════════════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════════════

log('═══════════════════════════════════════');
log(' Stealth Gateway Client');
log(` Mode: ${USE_PUPPETEER ? 'Puppeteer (real Chrome)' : 'Node.js (stealth identify)'}`);
log(` Token: ...${DISCORD_TOKEN.slice(-8)}`);
log(` Railway: ${RAILWAY_URL}`);
log('═══════════════════════════════════════');

connectToRailway();

if (USE_PUPPETEER) {
    launchBrowser().catch((e) => {
        log(`❌ Puppeteer failed: ${e.message}`);
        log('⚠️ Falling back to Node.js mode...');
        connectNodeGateway();
    });
} else {
    connectNodeGateway();
}

// Graceful shutdown
process.on('SIGINT', async () => {
    log('🛑 Shutting down...');
    if (browser) try { await browser.close(); } catch { }
    if (discordWs) try { discordWs.close(1000); } catch { }
    if (railwayWs) try { railwayWs.close(1000); } catch { }
    process.exit(0);
});
