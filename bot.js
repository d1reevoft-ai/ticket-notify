#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  Telegram Ticket Notifier — Discord Gateway Bot (24/7)
// ═══════════════════════════════════════════════════════════════
//
//  Запуск:  npm install && node bot.js
//
//  Поддерживает два режима:
//
//  ─── Режим 1: Discord Bot (рекомендуется) ───
//    1. Создайте бота на https://discord.com/developers/applications
//    2. Скопируйте Bot Token → "discordBotToken" в config.json
//    3. Включите Intents: SERVER MEMBERS + MESSAGE CONTENT
//    4. Пригласите бота на сервер (scope=bot, permissions=66560)
//    5. Убедитесь что бот видит категорию тикетов
//
//  ─── Режим 2: User Token (selfbot) ───
//    1. Вставьте пользовательский токен в "discordToken" в config.json
//    ⚠️ Нарушает ToS Discord — риск бана аккаунта
//
//  24/7 через PM2:
//    npm install -g pm2
//    pm2 start bot.js --name ticket-bot
//    pm2 startup && pm2 save
//
// ═══════════════════════════════════════════════════════════════

const WebSocket = require('ws');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────

const CONFIG_FILE = path.join(__dirname, 'config.json');
let config;
try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
} catch {
    config = {};
}

// Environment variables override config.json (for REMOVED_PLATFORM_REFERENCE / Docker / VPS)
if (process.env.DISCORD_TOKEN) config.discordToken = process.env.DISCORD_TOKEN;
if (process.env.DISCORD_BOT_TOKEN) config.discordBotToken = process.env.DISCORD_BOT_TOKEN;
if (process.env.TG_TOKEN) config.tgToken = process.env.TG_TOKEN;
if (process.env.TG_CHAT_ID) config.tgChatId = process.env.TG_CHAT_ID;
if (process.env.GUILD_ID) config.guildId = process.env.GUILD_ID;
if (process.env.TICKETS_CATEGORY_ID) config.ticketsCategoryId = process.env.TICKETS_CATEGORY_ID;
if (process.env.STAFF_ROLE_IDS) config.staffRoleIds = process.env.STAFF_ROLE_IDS.split(',');
if (process.env.TICKET_PREFIX) config.ticketPrefix = process.env.TICKET_PREFIX;

// Defaults
config.priorityKeywords = config.priorityKeywords || ["срочно", "urgent", "баг", "bug", "оплата", "payment", "помогите", "help"];
config.includeFirstUserMessage = config.includeFirstUserMessage ?? true;
config.notifyOnClose = config.notifyOnClose ?? true;
config.mentionOnHighPriority = config.mentionOnHighPriority ?? true;
config.maxMessageLength = config.maxMessageLength || 300;
config.rateLimitMs = config.rateLimitMs || 1500;
config.activityCheckMin = config.activityCheckMin || 10;
config.closingCheckMin = config.closingCheckMin || 15;
config.closingPhrase = config.closingPhrase || "остались вопросы";
config.forumMode = config.forumMode ?? false;
config.pollingIntervalSec = config.pollingIntervalSec || 3;

// ── Users (multi-user support) ────────────────────────────────

if (!config.users || !Array.isArray(config.users) || config.users.length === 0) {
    config.users = [{
        name: 'Default',
        discordToken: config.discordToken || '',
        tgChatId: String(config.tgChatId || ''),
    }];
}
const users = config.users.map(u => ({ ...u, tgChatId: String(u.tgChatId) }));
const allTgChatIds = new Set(users.map(u => u.tgChatId));

// ── Constants ─────────────────────────────────────────────────

const LOG = '[TicketBot]';
const GATEWAY_URL = 'wss://gateway.discord.gg/?v=9&encoding=json';
const GATEWAY_TOKEN = config.discordBotToken || users[0]?.discordToken || '';
const IS_BOT_TOKEN = !!config.discordBotToken;
const TELEGRAM_API = `https://api.telegram.org/bot${config.tgToken}`;
const DATA_DIR = fs.existsSync('/data') ? '/data' : __dirname;
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const AUTOSAVE_INTERVAL_MS = 30_000;
const SAFE_MESSAGE_TYPES = new Set([0, 19, 20]);
const TICKET_CHANNEL_TYPES = new Set([0, 11, 12]);
const MAX_CLOSED_HISTORY = 10000;
const SHIFT_STATE_FILE = path.join(DATA_DIR, 'shift_state.json');
const SHIFT_CHANNEL_ID = '1451246122755559555';
const SHIFT_GUILD_ID = '690362306395111444';
const SHIFT_TZ = 'Europe/Kyiv';

// ── Runtime State ─────────────────────────────────────────────

const activeTickets = new Map();
const notifiedFirstMessage = new Set();
const noReplyTimers = new Map();
const channelCache = new Map();
const guildCache = new Map();

let ps = emptyState();
let stateDirty = false;
let autosaveTimer = null;

const sendQueue = [];
let queueRunning = false;
let lastSendTime = 0;

let pollingOffset = 0;
let pollingTimer = null;
let pollingRunning = false;
const processedUpdateIds = new Set();

const sessionStats = { messagesFailed: 0 };

// Gateway state
let ws = null;
let sessionId = null;
let resumeGatewayUrl = null;
let seq = null;
let heartbeatTimer = null;
let receivedAck = true;
let gatewayReady = false;
let channelsFetched = false;
let guildCreateHandled = false;  // prevent double onGuildCreate
const notifiedTicketIds = new Set();  // dedup ticket notifications
let botPaused = false;  // pause notifications
const tgMsgToChannel = new Map();  // tg_message_id → { channelId, chatId }
let selfUserId = null;              // Discord user ID (set on READY)

// ── Per-User State ────────────────────────────────────────────
const PER_USER_STATE_FILE = path.join(DATA_DIR, 'per_user_state.json');
const perUserState = new Map(); // tgChatId → { ticketChat: {...}, shift: {...} }
const sentByBot = new Set();  // Discord message IDs sent by us (loop protection)
const TICKETS_PER_PAGE = 6;
let shiftReminderTimer = null;

function getUserByChatId(chatId) {
    return users.find(u => u.tgChatId === String(chatId));
}

function getDiscordToken(chatId) {
    const user = getUserByChatId(chatId);
    return user?.discordToken || GATEWAY_TOKEN;
}

function getUserState(chatId) {
    const key = String(chatId);
    if (!perUserState.has(key)) {
        perUserState.set(key, {
            ticketChat: { activeTicketId: null, activeTicketName: null, listPage: 0 },
            shift: { lastShiftMessageId: null, lastShiftDate: null, lastShiftClosed: false, reminderSentDate: null, lastShiftContent: null },
        });
    }
    return perUserState.get(key);
}

function getUserName(chatId) {
    const user = getUserByChatId(chatId);
    return user?.name || 'Unknown';
}

function loadPerUserState() {
    try {
        if (!fs.existsSync(PER_USER_STATE_FILE)) {
            // Migrate from old single-user files
            migrateOldState();
            return;
        }
        const parsed = JSON.parse(fs.readFileSync(PER_USER_STATE_FILE, 'utf8'));
        for (const [chatId, state] of Object.entries(parsed)) {
            perUserState.set(String(chatId), {
                ticketChat: state.ticketChat || { activeTicketId: null, activeTicketName: null, listPage: 0 },
                shift: state.shift || { lastShiftMessageId: null, lastShiftDate: null, lastShiftClosed: false, reminderSentDate: null, lastShiftContent: null },
            });
        }
        console.log(`${LOG} 👥 Per-user state loaded for ${perUserState.size} users.`);
    } catch (e) {
        console.error(`${LOG} Ошибка загрузки per_user_state:`, e.message);
    }
}

function migrateOldState() {
    // Migrate from old single-user ticket_chat_state.json and shift_state.json
    const oldTcFile = path.join(DATA_DIR, 'ticket_chat_state.json');
    const oldShiftFile = path.join(DATA_DIR, 'shift_state.json');
    const firstChatId = users[0]?.tgChatId;
    if (!firstChatId) return;
    const state = getUserState(firstChatId);
    try {
        if (fs.existsSync(oldTcFile)) {
            const parsed = JSON.parse(fs.readFileSync(oldTcFile, 'utf8'));
            state.ticketChat.activeTicketId = parsed.activeTicketId || null;
            state.ticketChat.activeTicketName = parsed.activeTicketName || null;
            state.ticketChat.listPage = parsed.listPage || 0;
            console.log(`${LOG} 📦 Migrated old ticket_chat_state for ${firstChatId}`);
        }
    } catch {}
    try {
        if (fs.existsSync(oldShiftFile)) {
            const parsed = JSON.parse(fs.readFileSync(oldShiftFile, 'utf8'));
            state.shift = {
                lastShiftMessageId: parsed.lastShiftMessageId || null,
                lastShiftDate: parsed.lastShiftDate || null,
                lastShiftClosed: parsed.lastShiftClosed || false,
                reminderSentDate: parsed.reminderSentDate || null,
                lastShiftContent: parsed.lastShiftContent || null,
            };
            console.log(`${LOG} 📦 Migrated old shift_state for ${firstChatId}`);
        }
    } catch {}
    savePerUserState();
}

function savePerUserState() {
    try {
        const obj = Object.fromEntries(perUserState.entries());
        fs.writeFileSync(PER_USER_STATE_FILE, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
        console.error(`${LOG} Ошибка сохранения per_user_state:`, e.message);
    }
}

// ── Helpers ───────────────────────────────────────────────────

function emptyState() {
    return {
        activeTickets: {},
        closedTickets: [],
        hourlyBuckets: new Array(24).fill(0),
        totalCreated: 0,
        totalClosed: 0,
        totalMessagesSent: 0,
    };
}

function escapeHtml(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function truncate(t, max) { return t.length <= max ? t : t.slice(0, max).trimEnd() + '…'; }

function formatDuration(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}с`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}м ${s % 60}с`;
    const h = Math.floor(m / 60);
    return `${h}ч ${m % 60}м`;
}

function nowTime() {
    return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(ts) {
    return new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function channelLink(guildId, channelId) {
    return `https://discord.com/channels/${guildId}/${channelId}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function markDirty() { stateDirty = true; }

function getPriority(name, content = '') {
    const haystack = (name + ' ' + content).toLowerCase();
    if (config.priorityKeywords.some(k => haystack.includes(k.toLowerCase()))) {
        return { emoji: '🔴', badge: 'ВЫСОКИЙ ⚡', high: true };
    }
    return { emoji: '🟢', badge: 'обычный', high: false };
}

function getTicketPrefixes() {
    return (config.ticketPrefix || 'тикет-от').split(',').map(p => p.trim()).filter(Boolean);
}

function isStaffFromMember(member) {
    if (!member?.roles) return false;
    return member.roles.some(r => config.staffRoleIds.includes(r));
}

function isClosingPhrase(content) {
    const phrases = (config.closingPhrase || 'остались вопросы').split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
    const text = content.toLowerCase();
    return phrases.some(p => text.includes(p));
}

function isTicketChannel(channel) {
    if (!channel?.id) return false;
    if (!TICKET_CHANNEL_TYPES.has(channel.type)) return false;
    const catId = config.ticketsCategoryId;
    if (!catId) return false;

    let matchesCategory = false;
    if (channel.parent_id === catId) {
        matchesCategory = true;
    } else if (channel.parent_id) {
        const parent = channelCache.get(channel.parent_id);
        if (parent && parent.parent_id === catId) matchesCategory = true;
    }
    if (!matchesCategory) return false;

    const name = (channel.name || '').toLowerCase();
    return getTicketPrefixes().some(p => name.includes(p.toLowerCase()));
}

function getMemberDisplayName(member, author) {
    if (member?.nick) return member.nick;
    if (author?.global_name) return author.global_name;
    return author?.username || 'Неизвестно';
}

function snowflakeToTimestamp(id) {
    return Number(BigInt(id) >> 22n) + 1420070400000;
}

// ── State Management ──────────────────────────────────────────

function loadState() {
    try {
        if (!fs.existsSync(STATE_FILE)) {
            console.log(`${LOG} 💾 Нет сохранённого состояния, стартуем с нуля.`);
            return;
        }
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        ps = {
            activeTickets: parsed.activeTickets || {},
            closedTickets: parsed.closedTickets || [],
            hourlyBuckets: parsed.hourlyBuckets || new Array(24).fill(0),
            totalCreated: parsed.totalCreated || 0,
            totalClosed: parsed.totalClosed || 0,
            totalMessagesSent: parsed.totalMessagesSent || 0,
        };
        for (const [id, rec] of Object.entries(ps.activeTickets)) {
            rec.lastStaffMessageAt = rec.lastStaffMessageAt ?? null;
            rec.waitingForReply = rec.waitingForReply ?? false;
            rec.activityTimerType = rec.activityTimerType ?? null;
            activeTickets.set(id, rec);
        }
        console.log(`${LOG} 💾 Состояние загружено: ${activeTickets.size} активных, ${ps.closedTickets.length} в истории.`);
    } catch (e) {
        console.error(`${LOG} Ошибка загрузки состояния:`, e.message);
        ps = emptyState();
    }
}

function saveState() {
    try {
        ps.activeTickets = Object.fromEntries(activeTickets.entries());
        fs.writeFileSync(STATE_FILE, JSON.stringify(ps, null, 2), 'utf8');
        stateDirty = false;
    } catch (e) {
        console.error(`${LOG} Ошибка сохранения:`, e.message);
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
        console.log(`${LOG} ⚙️ Конфиг сохранён.`);
    } catch (e) {
        console.error(`${LOG} Ошибка сохранения конфига:`, e.message);
    }
}

function startAutosave() {
    autosaveTimer = setInterval(() => { if (stateDirty) saveState(); }, AUTOSAVE_INTERVAL_MS);
}

function stopAutosave() {
    if (autosaveTimer) { clearInterval(autosaveTimer); autosaveTimer = null; }
}

// ── HTTP Helpers ──────────────────────────────────────────────

function httpPost(url, body) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const data = JSON.stringify(body);
        const req = https.request({
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        }, res => {
            let chunks = '';
            res.on('data', c => chunks += c);
            res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: chunks }));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

function httpGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = https.request({
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: 'GET',
            headers,
        }, res => {
            let chunks = '';
            res.on('data', c => chunks += c);
            res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: chunks }));
        });
        req.on('error', reject);
        req.end();
    });
}

// ── Telegram API ──────────────────────────────────────────────

async function tgSendMessage(chatId, text, replyMarkup, threadId) {
    const payload = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    if (threadId) payload.message_thread_id = threadId;
    try {
        const res = await httpPost(`${TELEGRAM_API}/sendMessage`, payload);
        if (!res.ok) {
            console.error(`${LOG} Telegram API ${res.status}:`, res.body);
            if (res.status === 429) {
                try { const j = JSON.parse(res.body); await sleep((j?.parameters?.retry_after ?? 5) * 1000); } catch {}
            }
            return { ok: false, messageId: null };
        }
        let messageId = null;
        try { const j = JSON.parse(res.body); if (j.ok && j.result) messageId = j.result.message_id; } catch {}
        return { ok: true, messageId };
    } catch (e) {
        console.error(`${LOG} Telegram ошибка:`, e.message);
        return { ok: false, messageId: null };
    }
}

async function tgCreateForumTopic(name) {
    try {
        const res = await httpPost(`${TELEGRAM_API}/createForumTopic`, { chat_id: users[0]?.tgChatId, name });
        if (res.ok) {
            const data = JSON.parse(res.body);
            if (data.ok && data.result) return data.result.message_thread_id;
        }
    } catch {}
    return null;
}

async function tgCloseForumTopic(threadId) {
    try {
        await httpPost(`${TELEGRAM_API}/closeForumTopic`, { chat_id: users[0]?.tgChatId, message_thread_id: threadId });
    } catch {}
}

async function tgGetUpdates() {
    try {
        const res = await httpGet(`${TELEGRAM_API}/getUpdates?offset=${pollingOffset}&timeout=1&allowed_updates=["message","callback_query"]`);
        if (!res.ok) return [];
        const data = JSON.parse(res.body);
        if (!data.ok) return [];
        return data.result || [];
    } catch { return []; }
}

// ── Queue & Send ──────────────────────────────────────────────

function enqueue(item) {
    sendQueue.push({ retries: 0, ...item });
    if (!queueRunning) runQueue();
}

function enqueueToAll(item) {
    for (const user of users) {
        sendQueue.push({ retries: 0, ...item, chatId: user.tgChatId });
    }
    if (!queueRunning) runQueue();
}

function enqueueToUser(chatId, item) {
    sendQueue.push({ retries: 0, ...item, chatId: String(chatId) });
    if (!queueRunning) runQueue();
}

async function runQueue() {
    if (queueRunning) return;
    queueRunning = true;
    while (sendQueue.length > 0) {
        const item = sendQueue[0];
        const wait = config.rateLimitMs - (Date.now() - lastSendTime);
        if (wait > 0) await sleep(wait);
        lastSendTime = Date.now();
        const result = await tgSendMessage(item.chatId || users[0]?.tgChatId, item.text, item.replyMarkup, item.threadId);
        if (result.ok) {
            sendQueue.shift();
            ps.totalMessagesSent++;
            markDirty();
            // Track tg message → discord channel for reply feature
            if (result.messageId && item.channelId) {
                tgMsgToChannel.set(result.messageId, { channelId: item.channelId, chatId: item.chatId });
                // Keep map small
                if (tgMsgToChannel.size > 400) {
                    const keys = [...tgMsgToChannel.keys()];
                    for (let i = 0; i < keys.length - 200; i++) tgMsgToChannel.delete(keys[i]);
                }
            }
        } else {
            item.retries = (item.retries || 0) + 1;
            if (item.retries >= MAX_RETRIES) {
                console.error(`${LOG} Сообщение потеряно после ${MAX_RETRIES} попыток.`);
                sendQueue.shift();
                sessionStats.messagesFailed++;
            } else {
                await sleep(RETRY_DELAY_MS * item.retries);
            }
        }
    }
    queueRunning = false;
}

// ── Discord REST: Send Message ────────────────────────────────

async function sendDiscordMessage(channelId, content, token) {
    const url = `https://discord.com/api/v9/channels/${channelId}/messages`;
    const body = JSON.stringify({ content });
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = https.request({
            hostname: u.hostname,
            path: u.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'Authorization': token || GATEWAY_TOKEN,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        }, res => {
            let chunks = '';
            res.on('data', c => chunks += c);
            res.on('end', () => {
                resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: chunks });
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function editDiscordMessage(channelId, messageId, content, token) {
    const url = `https://discord.com/api/v9/channels/${channelId}/messages/${messageId}`;
    const body = JSON.stringify({ content });
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = https.request({
            hostname: u.hostname,
            path: u.pathname,
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'Authorization': token || GATEWAY_TOKEN,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        }, res => {
            let chunks = '';
            res.on('data', c => chunks += c);
            res.on('end', () => {
                resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: chunks });
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function handleMsgCommand(argsStr, token) {
    const match = argsStr.trim().match(/^(\d+)\s+(.+)$/s);
    if (!match) {
        return '❌ Формат: /msg <номер> <текст>\n\nНомер тикета из /list';
    }
    const num = parseInt(match[1], 10);
    const text = match[2].trim();
    const tickets = [...activeTickets.values()];
    if (num < 1 || num > tickets.length) {
        return `❌ Тикет #${num} не найден. Открытых тикетов: ${tickets.length}\nИспользуй /list`;
    }
    const record = tickets[num - 1];
    try {
        const res = await sendDiscordMessage(record.channelId, text, token);
        if (res.ok) {
            console.log(`${LOG} ✉️ Отправлено в #${record.channelName}: ${text.slice(0, 60)}`);
            return `✅ Отправлено в <code>#${escapeHtml(record.channelName)}</code>:\n\n<blockquote>${escapeHtml(truncate(text, 200))}</blockquote>`;
        } else {
            console.error(`${LOG} ❌ Discord API ${res.status}:`, res.body);
            return `❌ Ошибка Discord (${res.status}). Возможно, нет доступа к каналу.`;
        }
    } catch (e) {
        console.error(`${LOG} ❌ Ошибка отправки:`, e.message);
        return `❌ Ошибка: ${e.message}`;
    }
}

async function handleReplyToTicket(replyToMsgId, text, token) {
    const mapping = tgMsgToChannel.get(replyToMsgId);
    const channelId = mapping?.channelId || mapping; // backward compat
    if (!channelId) {
        return '❌ Не удалось определить тикет. Используй /msg <номер> <текст>';
    }
    const record = activeTickets.get(channelId);
    const channelName = record?.channelName || channelId;
    try {
        const res = await sendDiscordMessage(channelId, text, token);
        if (res.ok) {
            console.log(`${LOG} ✉️ Reply → #${channelName}: ${text.slice(0, 60)}`);
            return `✅ Отправлено в <code>#${escapeHtml(channelName)}</code>:\n\n<blockquote>${escapeHtml(truncate(text, 200))}</blockquote>`;
        } else {
            return `❌ Ошибка Discord (${res.status})`;
        }
    } catch (e) {
        return `❌ Ошибка: ${e.message}`;
    }
}

// ── Ticket Chat System ────────────────────────────────────────

function getTicketList() {
    return [...activeTickets.values()].sort((a, b) => (b.lastMessageAt || b.createdAt) - (a.lastMessageAt || a.createdAt));
}

function buildTicketListMessage(page, chatId) {
    const tickets = getTicketList();
    const uState = getUserState(chatId).ticketChat;
    if (tickets.length === 0) {
        return {
            text: [
                `╔══════════════════════════╗`,
                `║  📭  <b>НЕТ ОТКРЫТЫХ ТИКЕТОВ</b>`,
                `╚══════════════════════════╝`,
                ``,
                `<i>Тикетов пока нет. Жди новых обращений!</i>`,
            ].join('\n'),
            markup: null,
        };
    }
    const totalPages = Math.ceil(tickets.length / TICKETS_PER_PAGE);
    if (page >= totalPages) page = totalPages - 1;
    if (page < 0) page = 0;
    uState.listPage = page;

    const start = page * TICKETS_PER_PAGE;
    const pageTickets = tickets.slice(start, start + TICKETS_PER_PAGE);

    const lines = [
        `╔══════════════════════════╗`,
        `║  🎫  <b>ВЫБЕРИ ТИКЕТ</b>  (${tickets.length})`,
        `╚══════════════════════════╝`,
        ``,
    ];

    if (uState.activeTicketId) {
        lines.push(`✅ Активный: <code>#${escapeHtml(uState.activeTicketName || '?')}</code>`);
        lines.push(``);
    }

    for (let i = 0; i < pageTickets.length; i++) {
        const t = pageTickets[i];
        const num = start + i + 1;
        const age = formatDuration(Date.now() - t.createdAt);
        const lastMsg = t.lastMessage ? truncate(t.lastMessage, 40) : 'нет сообщений';
        const isActive = t.channelId === uState.activeTicketId;
        lines.push(`${isActive ? '▶️' : '📩'} <b>${num}.</b> <code>#${escapeHtml(t.channelName)}</code>`);
        lines.push(`    ⏱ ${age} │ 💬 <i>${escapeHtml(lastMsg)}</i>`);
    }

    lines.push(``);
    lines.push(`📄 Стр. ${page + 1}/${totalPages} │ 🕐 ${nowTime()}`);

    // Build inline keyboard
    const buttons = [];
    // Ticket buttons (2 per row)
    for (let i = 0; i < pageTickets.length; i += 2) {
        const row = [];
        for (let j = i; j < Math.min(i + 2, pageTickets.length); j++) {
            const t = pageTickets[j];
            const num = start + j + 1;
            const shortName = t.channelName.length > 20 ? t.channelName.slice(0, 18) + '..' : t.channelName;
            const isActive = t.channelId === uState.activeTicketId;
            row.push({
                text: `${isActive ? '✅' : '📩'} ${num}. ${shortName}`,
                callback_data: `tsel_${t.channelId}`,
            });
        }
        buttons.push(row);
    }

    // Navigation row
    const navRow = [];
    if (page > 0) navRow.push({ text: '⬅️ Назад', callback_data: `tpage_${page - 1}` });
    navRow.push({ text: '🔄 Обновить', callback_data: `tpage_${page}` });
    if (page < totalPages - 1) navRow.push({ text: 'Вперёд ➡️', callback_data: `tpage_${page + 1}` });
    buttons.push(navRow);

    // Unselect button
    if (uState.activeTicketId) {
        buttons.push([{ text: '❌ Снять выбор', callback_data: 'tunselect' }]);
    }

    return {
        text: lines.join('\n'),
        markup: { inline_keyboard: buttons },
    };
}

function buildActiveTicketMessage(chatId) {
    const uState = getUserState(chatId).ticketChat;
    if (!uState.activeTicketId) {
        return {
            text: '📭 Тикет не выбран. Нажми /list и выбери тикет.',
            markup: { inline_keyboard: [[{ text: '📋 Открыть список', callback_data: 'tpage_0' }]] },
        };
    }
    const record = activeTickets.get(uState.activeTicketId);
    const name = uState.activeTicketName || '?';
    const age = record ? formatDuration(Date.now() - record.createdAt) : '?';
    const lastMsg = record?.lastMessage ? escapeHtml(truncate(record.lastMessage, 80)) : '<i>нет сообщений</i>';
    const link = channelLink(config.guildId, uState.activeTicketId);

    return {
        text: [
            `╔══════════════════════════╗`,
            `║  ✅  <b>АКТИВНЫЙ ТИКЕТ</b>`,
            `╚══════════════════════════╝`,
            ``,
            `📌 <code>#${escapeHtml(name)}</code>`,
            `⏱ Возраст: ${age}`,
            `💬 Последнее: <i>${lastMsg}</i>`,
            `🔗 <a href="${link}">Открыть в Discord</a>`,
            ``,
            `<b>Пиши:</b> <code>/s текст сообщения</code>`,
            `Или просто напиши текст — он уйдёт в тикет.`,
        ].join('\n'),
        markup: {
            inline_keyboard: [
                [{ text: '📋 Открыть список', callback_data: 'tpage_0' }, { text: '❌ Снять выбор', callback_data: 'tunselect' }],
            ],
        },
    };
}

async function handleSelectTicket(channelId, cbqId, messageId, chatId) {
    const record = activeTickets.get(channelId);
    if (!record) {
        await tgAnswerCallbackQuery(cbqId, '❌ Тикет не найден');
        return;
    }
    const uState = getUserState(chatId).ticketChat;
    uState.activeTicketId = channelId;
    uState.activeTicketName = record.channelName;
    savePerUserState();

    await tgAnswerCallbackQuery(cbqId, `✅ ${record.channelName}`);

    const msg = buildActiveTicketMessage(chatId);
    await tgEditMessageText(chatId, messageId, msg.text, msg.markup);
}

async function handleUnselectTicket(cbqId, messageId, chatId) {
    const uState = getUserState(chatId).ticketChat;
    uState.activeTicketId = null;
    uState.activeTicketName = null;
    savePerUserState();

    await tgAnswerCallbackQuery(cbqId, '❌ Тикет сброшен');

    if (messageId) {
        const msg = buildTicketListMessage(uState.listPage, chatId);
        await tgEditMessageText(chatId, messageId, msg.text, msg.markup);
    }
}

async function handleSendToTicket(text, chatId) {
    const uState = getUserState(chatId).ticketChat;
    const token = getDiscordToken(chatId);
    if (!uState.activeTicketId) {
        return {
            text: '📭 Тикет не выбран. Нажми /list и выбери тикет.',
            markup: { inline_keyboard: [[{ text: '📋 Открыть список', callback_data: 'tpage_0' }]] },
        };
    }
    const channelId = uState.activeTicketId;
    const record = activeTickets.get(channelId);
    const channelName = record?.channelName || uState.activeTicketName || channelId;

    if (!text.trim()) {
        return { text: '❌ Нельзя отправить пустое сообщение.\n\n<code>/s текст</code>', markup: null };
    }

    // Split long messages
    const MAX_DISCORD_LEN = 1900;
    const parts = [];
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= MAX_DISCORD_LEN) {
            parts.push(remaining);
            break;
        }
        let cut = remaining.lastIndexOf('\n', MAX_DISCORD_LEN);
        if (cut < MAX_DISCORD_LEN / 2) cut = remaining.lastIndexOf(' ', MAX_DISCORD_LEN);
        if (cut < MAX_DISCORD_LEN / 2) cut = MAX_DISCORD_LEN;
        parts.push(remaining.slice(0, cut));
        remaining = remaining.slice(cut).trimStart();
    }

    try {
        for (const part of parts) {
            const content = part;
            const res = await sendDiscordMessage(channelId, content, token);
            if (!res.ok) {
                return { text: `❌ Ошибка Discord (${res.status})`, markup: null };
            }
            // Track sent message ID for loop protection
            try {
                const j = JSON.parse(res.body);
                if (j.id) {
                    sentByBot.add(j.id);
                    if (sentByBot.size > 500) {
                        const arr = [...sentByBot];
                        for (let i = 0; i < arr.length - 250; i++) sentByBot.delete(arr[i]);
                    }
                }
            } catch {}
        }
        console.log(`${LOG} ✉️ /s → #${channelName}: ${text.slice(0, 60)}`);
        const partsNote = parts.length > 1 ? `\n(${parts.length} сообщений)` : '';
        return {
            text: `✅ <b>Отправлено в</b> <code>#${escapeHtml(channelName)}</code>${partsNote}\n\n<blockquote>${escapeHtml(truncate(text, 200))}</blockquote>`,
            markup: null,
        };
    } catch (e) {
        return { text: `❌ Ошибка: ${e.message}`, markup: null };
    }
}

function buildForwardedMessage(channelName, author, member, content, attachments) {
    const displayName = getMemberDisplayName(member, author);
    const username = author?.username || 'Неизвестно';
    const lines = [
        `┌─── 💬 <b>#${escapeHtml(channelName)}</b> ───`,
        `│ 👤 <b>${escapeHtml(displayName)}</b> <i>(@${escapeHtml(username)})</i>`,
        `│ 🕐 ${nowTime()}`,
        `├───────────────`,
    ];
    if (content) {
        const maxLen = config.maxMessageLength || 300;
        lines.push(`│ ${escapeHtml(truncate(content, maxLen))}`);
    }
    if (attachments && attachments.length > 0) {
        lines.push(`│`);
        for (const att of attachments) {
            const name = att.filename || 'файл';
            const url = att.url || att.proxy_url || '';
            if (url) {
                lines.push(`│ 📎 <a href="${url}">${escapeHtml(name)}</a>`);
            } else {
                lines.push(`│ 📎 ${escapeHtml(name)}`);
            }
        }
    }
    lines.push(`└───────────────`);
    return lines.join('\n');
}

async function handleTestSend(text, token) {
    const testChannelId = '1395858921939406929';
    const content = text || 'Тестовое сообщение от бота 🤖';
    try {
        const res = await sendDiscordMessage(testChannelId, content, token);
        if (res.ok) {
            console.log(`${LOG} ✉️ Тест отправлен: ${content.slice(0, 60)}`);
            return `✅ Тестовое сообщение отправлено!\n\n<blockquote>${escapeHtml(truncate(content, 200))}</blockquote>`;
        } else {
            console.error(`${LOG} ❌ Тест Discord API ${res.status}:`, res.body);
            return `❌ Ошибка Discord (${res.status}): ${res.body.slice(0, 100)}`;
        }
    } catch (e) {
        return `❌ Ошибка: ${e.message}`;
    }
}

// ── Shift (Смена) System ──────────────────────────────────────

function getKyivDate() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: SHIFT_TZ }); // 'YYYY-MM-DD'
}

function getKyivHour() {
    return parseInt(new Date().toLocaleString('en-US', { timeZone: SHIFT_TZ, hour: 'numeric', hour12: false }), 10);
}

function getKyivMinute() {
    return parseInt(new Date().toLocaleString('en-US', { timeZone: SHIFT_TZ, minute: 'numeric' }), 10);
}

function formatKyivDate() {
    return new Date().toLocaleDateString('ru-RU', { timeZone: SHIFT_TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
}

function loadShiftState() {
    // Shift state is now per-user inside perUserState — loaded via loadPerUserState()
    console.log(`${LOG} 📋 Shift state: per-user (loaded via per_user_state.json)`);
}

function saveShiftState() {
    // Shift state is now per-user — saved via savePerUserState()
    savePerUserState();
}

async function handleSmena(chatId) {
    const today = getKyivDate();
    const shiftState = getUserState(chatId).shift;
    const token = getDiscordToken(chatId);
    if (shiftState.lastShiftDate === today) {
        return '⚠️ Сегодня уже отмечено на смену.';
    }
    const dateStr = formatKyivDate();
    const userName = getUserName(chatId);
    const content = `Начал\n1. ${dateStr}\n2. 12-0`;
    try {
        const res = await sendDiscordMessage(SHIFT_CHANNEL_ID, content, token);
        if (!res.ok) {
            console.error(`${LOG} ❌ Shift Discord API ${res.status}:`, res.body);
            return `❌ Ошибка Discord (${res.status})`;
        }
        let msgId = null;
        try { const j = JSON.parse(res.body); msgId = j.id; } catch {}
        shiftState.lastShiftMessageId = msgId;
        shiftState.lastShiftDate = today;
        shiftState.lastShiftClosed = false;
        shiftState.lastShiftContent = content;
        savePerUserState();
        console.log(`${LOG} ✅ Смена начата (${userName}): ${dateStr}, msgId=${msgId}`);
        return `✅ <b>Смена начата!</b>\n\n📅 ${escapeHtml(dateStr)}\n🕐 12-0\n\nDiscord сообщение отправлено.`;
    } catch (e) {
        return `❌ Ошибка: ${e.message}`;
    }
}

async function handleSmenoff(chatId) {
    const shiftState = getUserState(chatId).shift;
    const token = getDiscordToken(chatId);
    if (!shiftState.lastShiftMessageId) {
        return '❌ Нет активной смены для закрытия.';
    }
    if (shiftState.lastShiftClosed) {
        return '⚠️ Смена уже закрыта.';
    }
    try {
        // Reconstruct content from saved state (no need to GET)
        let oldContent = shiftState.lastShiftContent;
        if (!oldContent && shiftState.lastShiftDate) {
            // Legacy: reconstruct from date
            const d = shiftState.lastShiftDate; // 'YYYY-MM-DD'
            const [y, m, dd] = d.split('-');
            const dateStr = `${dd}.${m}.${y}`;
            oldContent = `Начал\n1. ${dateStr}\n2. 12-0`;
        }
        if (!oldContent) {
            return '❌ Нет сохранённого текста смены. Попробуйте /smena заново.';
        }
        const newContent = oldContent.replace(/^Начал/, 'Начал/ Закрыл');
        const editRes = await editDiscordMessage(SHIFT_CHANNEL_ID, shiftState.lastShiftMessageId, newContent, token);
        if (!editRes.ok) {
            console.error(`${LOG} ❌ Shift edit Discord API ${editRes.status}:`, editRes.body);
            return `❌ Ошибка редактирования (${editRes.status})`;
        }
        shiftState.lastShiftClosed = true;
        savePerUserState();
        console.log(`${LOG} ✅ Смена закрыта, сообщение отредактировано.`);
        return `✅ <b>Смена закрыта!</b>\n\nDiscord сообщение отредактировано: "Начал/ Закрыл"`;
    } catch (e) {
        return `❌ Ошибка: ${e.message}`;
    }
}

// ── Shift Reminder ────────────────────────────────────────────

function scheduleShiftReminder() {
    if (shiftReminderTimer) { clearTimeout(shiftReminderTimer); shiftReminderTimer = null; }
    const today = getKyivDate();
    const hour = getKyivHour();
    const minute = getKyivMinute();

    // Check if ALL users are done for today
    const allDone = users.every(u => {
        const ss = getUserState(u.tgChatId).shift;
        return ss.reminderSentDate === today || ss.lastShiftDate === today;
    });
    if (allDone) {
        scheduleNextDayReminder();
        return;
    }

    if (hour >= 13) {
        sendShiftReminder();
    } else if (hour >= 12) {
        const msUntil13 = ((60 - minute) * 60 * 1000);
        console.log(`${LOG} 📋 Shift reminder scheduled in ${Math.round(msUntil13 / 60000)} min`);
        shiftReminderTimer = setTimeout(() => {
            const allDoneNow = users.every(u => {
                const ss = getUserState(u.tgChatId).shift;
                return ss.lastShiftDate === getKyivDate() || ss.reminderSentDate === getKyivDate();
            });
            if (allDoneNow) { scheduleNextDayReminder(); return; }
            sendShiftReminder();
        }, msUntil13);
    } else {
        const now = new Date();
        const kyivNow = new Date(now.toLocaleString('en-US', { timeZone: SHIFT_TZ }));
        const target = new Date(kyivNow);
        target.setHours(13, 0, 0, 0);
        const msUntil = target.getTime() - kyivNow.getTime();
        console.log(`${LOG} 📋 Shift reminder scheduled in ${Math.round(msUntil / 60000)} min (before noon)`);
        shiftReminderTimer = setTimeout(() => {
            const allDoneNow = users.every(u => {
                const ss = getUserState(u.tgChatId).shift;
                return ss.lastShiftDate === getKyivDate() || ss.reminderSentDate === getKyivDate();
            });
            if (allDoneNow) { scheduleNextDayReminder(); return; }
            sendShiftReminder();
        }, Math.max(0, msUntil));
    }
}

function scheduleNextDayReminder() {
    // Schedule check for next day at ~12:05 Kyiv
    const now = new Date();
    const kyivNow = new Date(now.toLocaleString('en-US', { timeZone: SHIFT_TZ }));
    const tomorrow = new Date(kyivNow);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(12, 5, 0, 0);
    const ms = tomorrow.getTime() - kyivNow.getTime();
    console.log(`${LOG} 📋 Next shift reminder check in ${Math.round(ms / 3600000)}h`);
    shiftReminderTimer = setTimeout(() => scheduleShiftReminder(), Math.max(0, ms));
}

async function sendShiftReminder() {
    const today = getKyivDate();
    console.log(`${LOG} ⏰ Sending shift reminders for ${today}`);
    const text = '⏰ <b>Вы забыли отметиться на смену!</b>\n\nХотите отметиться?';
    const keyboard = {
        inline_keyboard: [
            [
                { text: '✅ Отметиться', callback_data: 'shift_checkin' },
                { text: '⏭ Пропустить', callback_data: 'shift_skip' },
            ]
        ]
    };
    for (const user of users) {
        const ss = getUserState(user.tgChatId).shift;
        if (ss.lastShiftDate === today || ss.reminderSentDate === today) continue;
        ss.reminderSentDate = today;
        await tgSendMessage(user.tgChatId, text, keyboard);
    }
    savePerUserState();
    scheduleNextDayReminder();
}

async function tgAnswerCallbackQuery(callbackQueryId, text) {
    try {
        await httpPost(`${TELEGRAM_API}/answerCallbackQuery`, {
            callback_query_id: callbackQueryId,
            text: text || '',
        });
    } catch {}
}

async function tgEditMessageText(chatId, messageId, text, replyMarkup) {
    const payload = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    try {
        await httpPost(`${TELEGRAM_API}/editMessageText`, payload);
    } catch {}
}

// ── Forum Thread ──────────────────────────────────────────────

async function ensureThread(record) {
    if (!config.forumMode) return null;
    if (record.tgThreadId !== null) return record.tgThreadId;
    const threadId = await tgCreateForumTopic(truncate(`🎫 ${record.channelName}`, 128));
    if (threadId !== null) {
        record.tgThreadId = threadId;
        markDirty();
    }
    return threadId;
}

// ── Activity Timers ───────────────────────────────────────────

function getActivityTimeout(type) {
    return type === 'closing'
        ? (config.closingCheckMin || 15)
        : (config.activityCheckMin || 10);
}

function clearNoReplyTimer(channelId) {
    const t = noReplyTimers.get(channelId);
    if (t !== undefined) { clearTimeout(t); noReplyTimers.delete(channelId); }
    const record = activeTickets.get(channelId);
    if (record && record.waitingForReply) {
        record.waitingForReply = false;
        record.lastStaffMessageAt = null;
        record.activityTimerType = null;
        markDirty();
    }
}

function startActivityTimer(channelId, type) {
    const timeoutMin = getActivityTimeout(type);
    if (timeoutMin <= 0) return;
    clearNoReplyTimer(channelId);
    const record = activeTickets.get(channelId);
    if (!record) return;
    // Always set fresh timestamp when starting a new timer
    record.lastStaffMessageAt = Date.now();
    record.waitingForReply = true;
    record.activityTimerType = type;
    markDirty();
    const elapsed = Date.now() - record.lastStaffMessageAt;
    const remaining = Math.max(0, timeoutMin * 60 * 1000 - elapsed);
    const timer = setTimeout(() => {
        noReplyTimers.delete(channelId);
        record.waitingForReply = false;
        record.activityTimerType = null;
        markDirty();
        console.log(`${LOG} ⏰ Таймер сработал: #${record.channelName} (${type}, ${timeoutMin} мин.)`);
        if (!botPaused) {
            enqueueToAll({ ...buildActivityMessage(record, type, timeoutMin), channelId });
        } else {
            console.log(`${LOG} ⏸ Пауза — уведомление таймера пропущено.`);
        }
    }, remaining);
    noReplyTimers.set(channelId, timer);
    console.log(`${LOG} ⏰ Таймер запущен: #${record.channelName} (${type}, ${timeoutMin} мин., осталось ${Math.round(remaining / 1000)}с)`);
}

function restoreActivityTimers() {
    let restored = 0;
    for (const [channelId, record] of activeTickets) {
        if (!record.waitingForReply && record.lastMessage?.startsWith('[Саппорт]') && record.lastMessageAt) {
            record.waitingForReply = true;
            record.lastStaffMessageAt = record.lastStaffMessageAt ?? record.lastMessageAt;
            const msgContent = record.lastMessage.replace(/^\[Саппорт\]\s*/, '');
            record.activityTimerType = isClosingPhrase(msgContent) ? 'closing' : 'regular';
            markDirty();
            console.log(`${LOG} ⏰ Восстановлен из lastMessage: #${record.channelName} (${record.activityTimerType})`);
        }
        if (!record.waitingForReply || !record.lastStaffMessageAt) continue;
        const type = record.activityTimerType || 'regular';
        const timeoutMin = getActivityTimeout(type);
        if (timeoutMin <= 0) continue;
        const elapsed = Date.now() - record.lastStaffMessageAt;
        const totalMs = timeoutMin * 60 * 1000;
        if (elapsed >= totalMs) {
            record.waitingForReply = false;
            record.activityTimerType = null;
            markDirty();
            enqueueToAll({ ...buildActivityMessage(record, type, timeoutMin), channelId });
            console.log(`${LOG} ⏰ Истёк пока оффлайн: #${record.channelName} (${Math.round(elapsed / 1000)}с назад)`);
        } else {
            const remaining = totalMs - elapsed;
            const timer = setTimeout(() => {
                noReplyTimers.delete(channelId);
                record.waitingForReply = false;
                record.activityTimerType = null;
                markDirty();
                enqueueToAll({ ...buildActivityMessage(record, type, timeoutMin), channelId });
            }, remaining);
            noReplyTimers.set(channelId, timer);
            console.log(`${LOG} ⏰ Таймер #${record.channelName}: ${type}, ${Math.round(remaining / 1000)}с осталось`);
        }
        restored++;
    }
    if (restored > 0) console.log(`${LOG} ⏰ Восстановлено таймеров: ${restored}`);
}

// ── Message Builders ──────────────────────────────────────────

function buildTicketCreatedMessage(channel, guild) {
    const name = escapeHtml(channel.name || channel.id);
    const link = channelLink(config.guildId, channel.id);
    const priority = getPriority(channel.name || '');
    const text = [
        `╔══════════════════════╗`,
        `║  🎫  <b>НОВЫЙ ТИКЕТ</b>`,
        `╚══════════════════════╝`,
        ``,
        `📋  <b>Канал:</b>   <code>#${name}</code>`,
        `🏠  <b>Сервер:</b>  ${escapeHtml(guild?.name || 'Unknown')}`,
        `${priority.emoji}  <b>Приоритет:</b>  ${priority.badge}`,
        `🕐  <b>Время:</b>   ${nowTime()}`,
        ``,
        `<i>💡 Тикет ожидает ответа</i>`,
    ].join('\n');
    return { text, replyMarkup: { inline_keyboard: [[{ text: '🔗 Открыть тикет', url: link }]] } };
}

function buildFirstMessageNotification(channel, message) {
    const chName = escapeHtml(channel?.name || message.channel_id);
    const link = channelLink(config.guildId, message.channel_id);
    const author = message.author;
    const displayName = getMemberDisplayName(message.member, author);
    const rawUsername = author?.username || 'Неизвестно';
    const maxLen = config.maxMessageLength || 300;
    const content = escapeHtml(truncate(message.content || '(вложение без текста)', maxLen));
    const priority = getPriority(channel?.name || '', message.content || '');
    const text = [
        `╔══════════════════════╗`,
        `║  💬  <b>НОВОЕ СООБЩЕНИЕ</b>`,
        `╚══════════════════════╝`,
        ``,
        `📋  <b>Тикет:</b>   <code>#${chName}</code>`,
        `👤  <b>Игрок:</b>   ${escapeHtml(displayName)}  <i>(@${escapeHtml(rawUsername)})</i>`,
        `${priority.emoji}  <b>Приоритет:</b>  ${priority.badge}`,
        `🕐  <b>Время:</b>   ${nowTime()}`,
        ``,
        `💌  <b>Сообщение:</b>`,
        `<blockquote>${content}</blockquote>`,
    ].join('\n');
    return { text, replyMarkup: { inline_keyboard: [[{ text: '🔗 Перейти в тикет', url: link }]] } };
}

function buildTicketClosedMessage(record) {
    const text = [
        `╔══════════════════════╗`,
        `║  🔒  <b>ТИКЕТ ЗАКРЫТ</b>`,
        `╚══════════════════════╝`,
        ``,
        `📋  <b>Канал:</b>   <code>#${escapeHtml(record.channelName)}</code>`,
        `🏠  <b>Сервер:</b>  ${escapeHtml(record.guildName)}`,
        `⏱  <b>Жил:</b>     ${formatDuration(Date.now() - record.createdAt)}`,
        `🕐  <b>Закрыт:</b>  ${nowTime()}`,
        ``,
        `📊  <b>Всего:</b>  🎫 ${ps.totalCreated}  ·  🔒 ${ps.totalClosed}`,
    ].join('\n');
    return { text };
}

function buildHighPriorityAlert(channelName) {
    return {
        text: `🚨🚨  <b>ВЫСОКИЙ ПРИОРИТЕТ</b>  🚨🚨\n\nТикет <code>#${escapeHtml(channelName)}</code> требует <b>срочного</b> ответа!`,
    };
}

function buildActivityMessage(record, type, minutes) {
    const link = channelLink(record.guildId, record.channelId);
    if (type === 'closing') {
        const text = [
            `╔══════════════════════╗`,
            `║  ⏰  <b>МОЖНО ЗАКРЫВАТЬ</b>`,
            `╚══════════════════════╝`,
            ``,
            `📋  <b>Тикет:</b>   <code>#${escapeHtml(record.channelName)}</code>`,
            `⏱  <b>Прошло:</b>  ${minutes} мин. без ответа игрока`,
            `🕐  <b>Время:</b>   ${nowTime()}`,
            ``,
            `<i>Игрок не отвечает ${minutes} минут. Вы можете закрывать тикет.</i>`,
        ].join('\n');
        return { text, replyMarkup: { inline_keyboard: [[{ text: '🔗 Открыть тикет', url: link }]] } };
    } else {
        const text = [
            `╔══════════════════════╗`,
            `║  ⏰  <b>НЕТ ОТВЕТА</b>`,
            `╚══════════════════════╝`,
            ``,
            `📋  <b>Тикет:</b>   <code>#${escapeHtml(record.channelName)}</code>`,
            `⏱  <b>Прошло:</b>  ${minutes} мин. без ответа игрока`,
            `🕐  <b>Время:</b>   ${nowTime()}`,
            ``,
            `<i>Игрок не отвечает ${minutes} минут. Возможно, стоит уточнить, остались ли у него вопросы?</i>`,
        ].join('\n');
        return { text, replyMarkup: { inline_keyboard: [[{ text: '🔗 Открыть тикет', url: link }]] } };
    }
}

function slaEmoji(record) {
    if (record.firstStaffReplyAt !== null) return '✅';
    const age = Date.now() - record.createdAt;
    if (age < 30 * 60 * 1000) return '🟢';
    if (age < 2 * 60 * 60 * 1000) return '🟡';
    return '🔴';
}

function buildListMessage() {
    if (activeTickets.size === 0) {
        return [
            `╔══════════════════════╗`,
            `║  📋  <b>ОТКРЫТЫЕ ТИКЕТЫ</b>`,
            `╚══════════════════════╝`,
            ``,
            `<i>Нет открытых тикетов 🎉</i>`,
        ].join('\n');
    }
    const lines = [
        `╔══════════════════════╗`,
        `║  📋  <b>ОТКРЫТЫЕ ТИКЕТЫ</b>  (${activeTickets.size})`,
        `╚══════════════════════╝`,
        ``,
    ];
    let i = 1;
    for (const record of activeTickets.values()) {
        const name = escapeHtml(record.channelName);
        const age = formatDuration(Date.now() - record.createdAt);
        const lastMsg = record.lastMessage ? escapeHtml(truncate(record.lastMessage, 60)) : '<i>сообщений нет</i>';
        const lastTime = record.lastMessageAt ? formatDateTime(record.lastMessageAt) : '—';
        const link = channelLink(record.guildId, record.channelId);
        lines.push(
            `${slaEmoji(record)} <b>${i}.</b> <code>#${name}</code>`,
            `   ⏱ Висит: ${age}`,
            `   💬 Последнее: ${lastTime}`,
            `   <i>${lastMsg}</i>`,
            `   🔗 <a href="${link}">Открыть</a>`,
            ``,
        );
        i++;
    }
    lines.push(`🕐 ${nowTime()}`);
    return lines.join('\n');
}

function buildStartMessage() {
    return [
        `╔══════════════════════╗`,
        `║  🤖  <b>TICKET NOTIFIER</b>`,
        `╚══════════════════════╝`,
        ``,
        `Привет! Я бот для мониторинга тикетов.`,
        `Отслеживаю тикеты на сервере и отправляю уведомления сюда.`,
        ``,
        `✉️  <b>Чат с тикетами:</b>`,
        `  /list — выбрать тикет (кнопки)`,
        `  /s &lt;текст&gt; — отправить в выбранный тикет`,
        `  /ticket — показать текущий тикет`,
        `  /unselect — сбросить выбор`,
        `  💬 Ответы игроков приходят автоматически!`,
        ``,
        `📋  <b>Мониторинг:</b>`,
        `  /oldlist — открытые тикеты (SLA)`,
        `  /stats — статистика · /analytics — аналитика`,
        `  /settings — настройки · /set — изменить`,
        `  /pause · /resume — пауза/возобновление`,
        ``,
        `✉️  <b>Быстрая отправка:</b>`,
        `  /msg &lt;номер&gt; &lt;текст&gt; — отправить в тикет`,
        `  Или <b>reply</b> на уведомление`,
        ``,
        `📅  <b>Смена:</b>`,
        `  /smena — начать смену (отметка в Discord)`,
        `  /smenoff — закрыть смену`,
        `  ⏰ Авто-напоминание в 13:00 если не отмечено`,
        ``,
        `⚙️  <b>Автоматические уведомления:</b>`,
        `  🎫 Новый тикет`,
        `  💬 Первое сообщение игрока`,
        `  🔒 Закрытие тикета`,
        `  ⏰ Нет ответа от игрока (${config.activityCheckMin} мин.)`,
        `  ⏰ Можно закрывать (${config.closingCheckMin} мин.)`,
        `  🚨 Высокий приоритет`,
        ``,
        `🟢 Сейчас открыто: ${activeTickets.size} тикетов`,
        `🕐 ${nowTime()}`,
    ].join('\n');
}

function buildStatsMessage() {
    return [
        `╔══════════════════════╗`,
        `║  🧪  <b>СТАТИСТИКА</b>`,
        `╚══════════════════════╝`,
        ``,
        `${botPaused ? '⏸ Бот на паузе' : '✅ Бот работает корректно!'}`,
        `🕐  ${nowTime()}`,
        ``,
        `📊  <b>Данные:</b>`,
        `    🎫 Всего создано:  ${ps.totalCreated}`,
        `    🔒 Закрыто:        ${ps.totalClosed}`,
        `    🟢 Открыто:        ${activeTickets.size}`,
        `    ✉️ Сообщений:      ${ps.totalMessagesSent}`,
        `    ❌ Ошибок:         ${sessionStats.messagesFailed}`,
        `    📬 В очереди:      ${sendQueue.length}`,
        ``,
        `⚙️  <b>Настройки:</b>`,
        `    ⏱ Таймауты: ${config.activityCheckMin} мин. / ${config.closingCheckMin} мин.`,
        `    🗂 Форум: ${config.forumMode ? 'вкл.' : 'выкл.'}`,
        ``,
        `<i>Команды: /list · /stats · /analytics · /settings</i>`,
    ].join('\n');
}

// ── Settings Commands ─────────────────────────────────────────

const EDITABLE_SETTINGS = {
    activityCheckMin: { type: 'number', min: 1, max: 120, desc: 'Таймер нет ответа (мин.)' },
    closingCheckMin:  { type: 'number', min: 1, max: 120, desc: 'Таймер закрытия (мин.)' },
    maxMessageLength: { type: 'number', min: 50, max: 2000, desc: 'Макс. длина сообщения' },
    pollingIntervalSec: { type: 'number', min: 1, max: 30, desc: 'Интервал опроса TG (сек.)' },
    notifyOnClose:    { type: 'bool', desc: 'Уведомление о закрытии' },
    includeFirstUserMessage: { type: 'bool', desc: 'Первое сообщение игрока' },
    mentionOnHighPriority: { type: 'bool', desc: 'Упоминание при приоритете' },
    forumMode:        { type: 'bool', desc: 'Режим форума' },
    closingPhrase:    { type: 'string', desc: 'Фразы закрытия (через запятую)' },
    ticketPrefix:     { type: 'string', desc: 'Префикс тикет-канала' },
};

function buildSettingsMessage() {
    const lines = [
        `╔══════════════════════╗`,
        `║  ⚙️  <b>НАСТРОЙКИ</b>`,
        `╚══════════════════════╝`,
        ``,
        `${botPaused ? '⏸ <b>Бот на паузе</b>' : '▶️ <b>Бот активен</b>'}`,
        ``,
    ];
    for (const [key, meta] of Object.entries(EDITABLE_SETTINGS)) {
        const val = config[key];
        let display;
        if (meta.type === 'bool') display = val ? '✅ вкл.' : '❌ выкл.';
        else if (meta.type === 'number') display = `${val}`;
        else display = `"${val}"`;
        lines.push(`  <b>${meta.desc}</b>`);
        lines.push(`    <code>${key}</code> = ${display}`);
        lines.push(``);
    }
    lines.push(`<b>Изменить:</b> /set &lt;ключ&gt; &lt;значение&gt;`);
    lines.push(`<b>Пауза/Возобновление:</b> /pause · /resume`);
    lines.push(`<b>Сброс статистики:</b> /reset`);
    lines.push(``);
    lines.push(`🕐 ${nowTime()}`);
    return lines.join('\n');
}

function handleSetCommand(argsStr) {
    const parts = argsStr.trim().split(/\s+/);
    const key = parts[0];
    const valueStr = parts.slice(1).join(' ');

    if (!key || !valueStr) {
        return `❌ Формат: /set &lt;ключ&gt; &lt;значение&gt;\n\nДоступные ключи:\n` +
            Object.entries(EDITABLE_SETTINGS).map(([k, m]) => `  <code>${k}</code> — ${m.desc}`).join('\n');
    }

    const meta = EDITABLE_SETTINGS[key];
    if (!meta) {
        return `❌ Неизвестный ключ: <code>${escapeHtml(key)}</code>\n\nДоступные:\n` +
            Object.keys(EDITABLE_SETTINGS).map(k => `  <code>${k}</code>`).join('\n');
    }

    let newValue;
    if (meta.type === 'number') {
        newValue = Number(valueStr);
        if (isNaN(newValue) || !isFinite(newValue)) return `❌ <code>${key}</code> — нужно число.`;
        if (meta.min !== undefined && newValue < meta.min) return `❌ Минимум: ${meta.min}`;
        if (meta.max !== undefined && newValue > meta.max) return `❌ Максимум: ${meta.max}`;
    } else if (meta.type === 'bool') {
        const lower = valueStr.toLowerCase();
        if (['true', '1', 'вкл', 'on', 'да'].includes(lower)) newValue = true;
        else if (['false', '0', 'выкл', 'off', 'нет'].includes(lower)) newValue = false;
        else return `❌ <code>${key}</code> — нужно: on/off, да/нет, true/false`;
    } else {
        newValue = valueStr;
    }

    const oldValue = config[key];
    config[key] = newValue;
    saveConfig();

    let display = meta.type === 'bool' ? (newValue ? '✅ вкл.' : '❌ выкл.') : `${newValue}`;
    let oldDisplay = meta.type === 'bool' ? (oldValue ? '✅ вкл.' : '❌ выкл.') : `${oldValue}`;
    return `✅ <b>${meta.desc}</b>\n\n<code>${key}</code>: ${oldDisplay} → <b>${display}</b>`;
}

function handlePause() {
    if (botPaused) return '⏸ Бот уже на паузе.';
    botPaused = true;
    console.log(`${LOG} ⏸ Бот поставлен на паузу.`);
    return '⏸ <b>Бот поставлен на паузу.</b>\nУведомления приостановлены. Команды работают.\n/resume — возобновить.';
}

function handleResume() {
    if (!botPaused) return '▶️ Бот уже работает.';
    botPaused = false;
    console.log(`${LOG} ▶️ Бот возобновлён.`);
    return '▶️ <b>Бот возобновлён!</b>\nУведомления снова активны.';
}

function handleReset() {
    const oldCreated = ps.totalCreated;
    const oldClosed = ps.totalClosed;
    const oldMessages = ps.totalMessagesSent;
    ps.totalCreated = 0;
    ps.totalClosed = 0;
    ps.totalMessagesSent = 0;
    ps.closedTickets = [];
    ps.hourlyBuckets = new Array(24).fill(0);
    sessionStats.messagesFailed = 0;
    markDirty();
    console.log(`${LOG} 🔄 Статистика сброшена.`);
    return [
        `🔄 <b>Статистика сброшена!</b>`,
        ``,
        `Было:`,
        `  🎫 Создано: ${oldCreated}`,
        `  🔒 Закрыто: ${oldClosed}`,
        `  ✉️ Сообщений: ${oldMessages}`,
        ``,
        `Все счётчики обнулены. Активные тикеты сохранены.`,
    ].join('\n');
}

function buildAnalyticsMessage() {
    const closed = ps.closedTickets;
    const avgDuration = closed.length > 0
        ? closed.reduce((a, t) => a + (t.closedAt - t.createdAt), 0) / closed.length
        : null;
    const replied = closed.filter(t => t.firstStaffReplyAt !== null);
    const avgResponse = replied.length > 0
        ? replied.reduce((a, t) => a + (t.firstStaffReplyAt - t.createdAt), 0) / replied.length
        : null;

    const counts = new Map();
    for (const t of [...closed, ...activeTickets.values()]) {
        const id = t.openerId;
        const uname = t.openerUsername || '';
        if (!id) continue;
        const ex = counts.get(id);
        if (ex) ex.count++; else counts.set(id, { username: uname, count: 1 });
    }
    const topPlayers = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 5);

    const peakHours = ps.hourlyBuckets
        .map((count, hour) => ({ hour, count }))
        .filter(x => x.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    const lines = [
        `╔══════════════════════╗`,
        `║  📊  <b>АНАЛИТИКА</b>`,
        `╚══════════════════════╝`,
        ``,
        `📈  <b>Общая статистика:</b>`,
        `    🎫 Всего создано:    ${ps.totalCreated}`,
        `    🔒 Закрыто:         ${closed.length}`,
        `    🟢 Сейчас открыто:  ${activeTickets.size}`,
        `    ✉️ Сообщений:       ${ps.totalMessagesSent}`,
        ``,
        `⏱  <b>Среднее время жизни:</b>  ${avgDuration !== null ? formatDuration(avgDuration) : 'нет данных'}`,
        `⚡  <b>Среднее до ответа:</b>    ${avgResponse !== null ? formatDuration(avgResponse) : 'нет данных'}`,
        ``,
        `🏆  <b>Топ игроков:</b>`,
    ];

    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
    if (topPlayers.length === 0) {
        lines.push(`    <i>нет данных</i>`);
    } else {
        topPlayers.forEach((p, i) => lines.push(`    ${medals[i] || '▪️'}  ${escapeHtml(p.username)}  —  ${p.count} тик.`));
    }

    lines.push(``, `🕐  <b>Пиковые часы:</b>`);
    if (peakHours.length === 0) {
        lines.push(`    <i>нет данных</i>`);
    } else {
        const maxC = peakHours[0].count;
        for (const { hour, count } of peakHours) {
            const bar = '█'.repeat(Math.max(1, Math.round(count / maxC * 10)));
            lines.push(`    ${String(hour).padStart(2, '0')}:00  ${bar}  ${count}`);
        }
    }
    lines.push(``, `🕐 ${nowTime()}`);
    return lines.join('\n');
}

// ── Ticket Registration ───────────────────────────────────────

function registerTicket(channel, silent = false) {
    if (activeTickets.has(channel.id)) return activeTickets.get(channel.id);
    if (!isTicketChannel(channel)) return null;
    const guild = guildCache.get(channel.guild_id || config.guildId);
    const record = {
        channelId: channel.id,
        channelName: channel.name || channel.id,
        guildId: channel.guild_id || config.guildId,
        guildName: guild?.name || 'Unknown',
        createdAt: snowflakeToTimestamp(channel.id),
        tgThreadId: null,
        lastMessage: '',
        lastMessageAt: 0,
        firstStaffReplyAt: null,
        openerId: '',
        openerUsername: '',
        lastStaffMessageAt: null,
        waitingForReply: false,
        activityTimerType: null,
    };
    activeTickets.set(channel.id, record);
    if (!silent) {
        ps.totalCreated++;
        ps.hourlyBuckets[new Date().getHours()]++;
    }
    markDirty();
    return record;
}

function scanExistingTickets() {
    let found = 0;
    for (const [id, ch] of channelCache) {
        if (activeTickets.has(id)) continue;
        if (!isTicketChannel(ch)) continue;
        registerTicket(ch, true);
        found++;
        console.log(`${LOG} 🎫 Найден: #${ch.name}`);
    }
    if (found > 0) {
        console.log(`${LOG} ✅ Просканировано ${found} тикетов.`);
        markDirty();
    } else {
        console.log(`${LOG} 🔍 Сканирование завершено, новых тикетов не найдено.`);
    }
}

// ── Discord REST API (selfbot fallback for lazy guilds) ───────

function requestLazyGuild(guildId) {
    // Fetch channels via REST API when GUILD_CREATE has no channels
    fetchGuildChannelsREST(guildId);
}

// Send op 14 Lazy Request to subscribe to guild channels
// This is required in selfbot mode to receive MESSAGE_CREATE events
function sendLazyRequest(guildId, channelIds) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!channelIds || channelIds.length === 0) return;

    // Build channels object: { "channel_id": [[0, 99]] }
    const channels = {};
    for (const chId of channelIds) {
        channels[chId] = [[0, 99]];
    }

    const payload = {
        op: 14,
        d: {
            guild_id: guildId,
            typing: true,
            threads: true,
            activities: true,
            members: [],
            channels: channels,
        },
    };

    try {
        ws.send(JSON.stringify(payload));
        console.log(`${LOG} \u{1F4E1} Lazy Request: \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 \u043D\u0430 ${channelIds.length} \u043A\u0430\u043D\u0430\u043B\u043E\u0432.`);
    } catch (e) {
        console.error(`${LOG} Lazy Request \u043E\u0448\u0438\u0431\u043A\u0430:`, e.message);
    }
}

async function fetchGuildChannelsREST(guildId) {
    if (channelsFetched) return;
    try {
        console.log(`${LOG} 🌐 Загружаем каналы через REST API...`);
        const res = await httpGet(
            `https://discord.com/api/v9/guilds/${guildId}/channels`,
            { Authorization: GATEWAY_TOKEN }
        );
        if (!res.ok) {
            console.error(`${LOG} REST /channels ошибка: ${res.status}`);
            return;
        }
        const channels = JSON.parse(res.body);
        let count = 0;
        for (const ch of channels) {
            channelCache.set(ch.id, { ...ch, guild_id: guildId });
            count++;
        }
        channelsFetched = true;
        console.log(`${LOG} 🌐 REST: ${count} каналов загружено.`);
        scanExistingTickets();
    } catch (e) {
        console.error(`${LOG} REST ошибка:`, e.message);
    }
}

function subscribeToTicketChannels(guildId) {
    // In selfbot mode, send op 14 + fetch last messages via REST
    const catId = config.ticketsCategoryId;
    if (!catId) return;

    const ticketChannelIds = [];
    for (const [chId, ch] of channelCache) {
        if (ch.parent_id === catId || isTicketChannel(ch)) {
            ticketChannelIds.push(chId);
        }
    }
    for (const [chId] of activeTickets) {
        if (!ticketChannelIds.includes(chId)) ticketChannelIds.push(chId);
    }

    if (ticketChannelIds.length === 0) return;

    // Send op 14 Lazy Request to subscribe (receive MESSAGE_CREATE events)
    sendLazyRequest(guildId, ticketChannelIds);

    console.log(`${LOG} 📡 Загружаем сообщения из ${ticketChannelIds.length} тикет-каналов...`);

    (async () => {
        for (const chId of ticketChannelIds) {
            try {
                const res = await httpGet(
                    `https://discord.com/api/v9/channels/${chId}/messages?limit=1`,
                    { Authorization: GATEWAY_TOKEN }
                );
                if (res.ok) {
                    const msgs = JSON.parse(res.body);
                    if (msgs.length > 0) {
                        const record = activeTickets.get(chId);
                        if (record) {
                            const msg = msgs[0];
                            const author = msg.author;
                            const staffSent = msg.member && isStaffFromMember(msg.member);
                            const msgTime = new Date(msg.timestamp).getTime();
                            // Always update if REST message is newer
                            if (msg.content && (!record.lastMessage || msgTime > record.lastMessageAt)) {
                                record.lastMessage = (staffSent ? '[Саппорт] ' : '') + msg.content;
                                record.lastMessageAt = msgTime;
                            }
                            if (!staffSent && !record.openerId && author && !author.bot) {
                                record.openerId = author.id || '';
                                record.openerUsername = author.username || '';
                            }
                            markDirty();
                        }
                    }
                } else if (res.status === 404) {
                    // Channel no longer exists — remove stale ticket
                    console.log(`${LOG} 🗑️ Канал ${chId} не найден (404), удаляем из activeTickets.`);
                    const stale = activeTickets.get(chId);
                    if (stale) {
                        ps.closedTickets.push({
                            channelName: stale.channelName,
                            openerId: stale.openerId,
                            openerUsername: stale.openerUsername,
                            createdAt: stale.createdAt,
                            closedAt: Date.now(),
                            firstStaffReplyAt: stale.firstStaffReplyAt,
                        });
                        activeTickets.delete(chId);
                        ps.totalClosed++;
                        markDirty();
                    }
                }
                await sleep(500);
            } catch (e) { /* ignore */ }
        }
        console.log(`${LOG} 📡 Сообщения тикетов загружены.`);
    })();
}

function subscribeToSingleChannel(guildId, channelId) {
    // Send op 14 for the new channel + fetch last message via REST
    sendLazyRequest(guildId, [channelId]);
    (async () => {
        try {
            await httpGet(
                `https://discord.com/api/v9/channels/${channelId}/messages?limit=1`,
                { Authorization: GATEWAY_TOKEN }
            );
        } catch (e) { /* ignore */ }
    })();
}

// ── Discord Event Handlers ────────────────────────────────────

function onGuildCreate(guild) {
    if (guild.id !== config.guildId) return;

    guildCache.set(guild.id, { id: guild.id, name: guild.name || 'Unknown' });

    // Cache all channels
    let chCount = 0;
    for (const ch of guild.channels || []) {
        channelCache.set(ch.id, { ...ch, guild_id: guild.id });
        chCount++;
    }
    for (const th of guild.threads || []) {
        channelCache.set(th.id, { ...th, guild_id: guild.id });
        chCount++;
    }

    if (chCount > 0) {
        console.log(`${LOG} 🏠 Сервер ${guild.name || guild.id}: ${chCount} каналов закэшировано.`);
    } else {
        console.log(`${LOG} 🏠 Сервер ${guild.name || guild.id}: получен (каналы придут отдельно).`);
        // In selfbot mode with lazy guilds, request guild subscription
        if (!IS_BOT_TOKEN) requestLazyGuild(guild.id);
    }

    // In selfbot mode, subscribe to ticket category so we receive MESSAGE_CREATE events
    if (!IS_BOT_TOKEN) subscribeToTicketChannels(guild.id);

    scanExistingTickets();
    restoreActivityTimers();

    if (!pollingTimer) schedulePolling();
}

function onChannelCreate(data) {
    const guildId = data.guild_id || config.guildId;
    if (guildId !== config.guildId) return;
    data.guild_id = guildId;
    channelCache.set(data.id, data);
    console.log(`${LOG} \u{1F4E2} CHANNEL_CREATE: #${data.name || data.id} (parent: ${data.parent_id || 'none'})`);

    if (activeTickets.has(data.id)) return;
    const record = registerTicket(data);
    if (!record) return;
    if (botPaused) { console.log(`${LOG} ⏸ Пауза — пропускаем уведомление о новом тикете.`); return; }

    // Dedup: prevent sending notification twice for same ticket
    if (notifiedTicketIds.has(data.id)) {
        console.log(`${LOG} ⚠️ Дубль CHANNEL_CREATE для #${data.name}, пропускаем.`);
        return;
    }
    notifiedTicketIds.add(data.id);
    // Clean up dedup set after 60s
    setTimeout(() => notifiedTicketIds.delete(data.id), 60_000);

    console.log(`${LOG} ✅ Новый тикет (CHANNEL_CREATE): #${data.name}`);
    // Subscribe to new ticket channel in selfbot mode
    if (!IS_BOT_TOKEN) {
        subscribeToSingleChannel(config.guildId, data.id);
    }
    const guild = guildCache.get(config.guildId);
    (async () => {
        const threadId = await ensureThread(record);
        const msg = buildTicketCreatedMessage(data, guild);
        enqueueToAll(threadId !== null ? { ...msg, threadId, replyMarkup: undefined, channelId: data.id } : { ...msg, channelId: data.id });
        if (getPriority(data.name || '').high && config.mentionOnHighPriority) {
            enqueueToAll({ ...buildHighPriorityAlert(data.name || data.id), channelId: data.id });
        }
    })();
}

function onChannelUpdate(data) {
    const guildId = data.guild_id || channelCache.get(data.id)?.guild_id;
    if (guildId !== config.guildId) return;
    data.guild_id = guildId;
    channelCache.set(data.id, data);
}

function onChannelDelete(data) {
    const guildId = data.guild_id || channelCache.get(data.id)?.guild_id;
    if (guildId !== config.guildId) return;
    channelCache.delete(data.id);

    if (!config.notifyOnClose) return;
    clearNoReplyTimer(data.id);

    const record = activeTickets.get(data.id);
    if (!record && !isTicketChannel(data)) return;

    const fallback = record || {
        channelId: data.id,
        channelName: data.name || data.id,
        guildId: data.guild_id || config.guildId,
        guildName: guildCache.get(config.guildId)?.name || 'Unknown',
        createdAt: Date.now() - 60_000,
        tgThreadId: null, lastMessage: '', lastMessageAt: 0,
        firstStaffReplyAt: null, openerId: '', openerUsername: '',
        lastStaffMessageAt: null, waitingForReply: false, activityTimerType: null,
    };

    ps.closedTickets.push({
        channelName: fallback.channelName,
        openerId: fallback.openerId,
        openerUsername: fallback.openerUsername,
        createdAt: fallback.createdAt,
        closedAt: Date.now(),
        firstStaffReplyAt: fallback.firstStaffReplyAt,
    });
    if (ps.closedTickets.length > MAX_CLOSED_HISTORY) {
        ps.closedTickets = ps.closedTickets.slice(-MAX_CLOSED_HISTORY);
    }

    activeTickets.delete(data.id);
    notifiedFirstMessage.delete(data.id);
    ps.totalClosed++;
    markDirty();

    if (botPaused) { console.log(`${LOG} ⏸ Пауза — пропускаем уведомление о закрытии.`); return; }

    const closedMsg = buildTicketClosedMessage(fallback);
    if (fallback.tgThreadId !== null && config.forumMode) {
        enqueueToAll({ ...closedMsg, threadId: fallback.tgThreadId, channelId: data.id });
        setTimeout(() => tgCloseForumTopic(fallback.tgThreadId), 3000);
    } else {
        enqueueToAll({ ...closedMsg, channelId: data.id });
    }
}

function onThreadCreate(data) {
    const guildId = data.guild_id || config.guildId;
    if (guildId !== config.guildId) return;
    data.guild_id = guildId;
    channelCache.set(data.id, data);

    if (activeTickets.has(data.id)) return;
    const record = registerTicket(data, !data.newly_created);
    if (!record) return;

    if (data.newly_created) {
        if (botPaused) { console.log(`${LOG} ⏸ Пауза — пропускаем уведомление о новом треде.`); return; }
        // Dedup: prevent sending notification twice for same ticket
        if (notifiedTicketIds.has(data.id)) {
            console.log(`${LOG} ⚠️ Дубль THREAD_CREATE для #${data.name}, пропускаем.`);
            return;
        }
        notifiedTicketIds.add(data.id);
        setTimeout(() => notifiedTicketIds.delete(data.id), 60_000);

        console.log(`${LOG} ✅ Новый тред-тикет (THREAD_CREATE): #${data.name}`);
        const guild = guildCache.get(config.guildId);
        (async () => {
            const threadId = await ensureThread(record);
            const msg = buildTicketCreatedMessage(data, guild);
            enqueueToAll(threadId !== null ? { ...msg, threadId, replyMarkup: undefined, channelId: data.id } : { ...msg, channelId: data.id });
            if (getPriority(data.name || '').high && config.mentionOnHighPriority) {
                enqueueToAll({ ...buildHighPriorityAlert(data.name || data.id), channelId: data.id });
            }
        })();
    }
}

function onThreadListSync(data) {
    const guildId = data.guild_id || config.guildId;
    if (guildId !== config.guildId) return;
    for (const th of data.threads || []) {
        channelCache.set(th.id, { ...th, guild_id: guildId });
        if (!activeTickets.has(th.id) && isTicketChannel(th)) {
            registerTicket(th, true);
        }
    }
}

function onMessageCreate(data) {
    // Resolve guild_id: may be missing in selfbot mode
    const guildId = data.guild_id || channelCache.get(data.channel_id)?.guild_id;

    if (guildId !== config.guildId) return;

    const channelId = data.channel_id;
    let channel = channelCache.get(channelId);

    // If channel not in cache, try to construct minimal info
    if (!channel) {
        // In selfbot mode channels may not be in cache yet
        // We can only process if this is a known active ticket
        if (activeTickets.has(channelId)) {
            channel = { id: channelId, name: activeTickets.get(channelId).channelName, guild_id: guildId, parent_id: config.ticketsCategoryId, type: 0 };
            channelCache.set(channelId, channel);
        } else {
            return;
        }
    }

    if (!activeTickets.has(channelId)) {
        if (!isTicketChannel(channel)) return;
        registerTicket(channel);
    }

    const author = data.author;
    if (!author || author.bot || data.webhook_id) return;

    const record = activeTickets.get(channelId);
    if (!record) return;

    // Log ticket messages only
    const who = author?.username || 'unknown';
    console.log(`${LOG} 💬 #${record.channelName} от ${who}: ${(data.content || '').slice(0, 60)}`);

    const staffSent = isStaffFromMember(data.member);

    // Track opener
    if (!staffSent && !record.openerId) {
        record.openerId = author.id || '';
        record.openerUsername = author.username || '';
        markDirty();
    }

    // Track first staff reply
    if (staffSent && record.firstStaffReplyAt === null) {
        record.firstStaffReplyAt = Date.now();
        markDirty();
    }

    // Track last message
    if (data.content) {
        record.lastMessage = (staffSent ? '[Саппорт] ' : '') + data.content;
        record.lastMessageAt = Date.now();
        markDirty();
    }

    // Forum mode: relay all messages
    if (config.forumMode) {
        const displayName = getMemberDisplayName(data.member, author);
        const rawUsername = author?.username || 'Неизвестно';
        const maxLen = config.maxMessageLength || 300;
        const role = staffSent ? '👮 Саппорт' : '👤 Игрок';
        const threadText = [
            `${role}  <b>${escapeHtml(displayName)}</b>  <i>(@${escapeHtml(rawUsername)})</i>`,
            `🕐 ${nowTime()}`,
            ``,
            `<blockquote>${escapeHtml(truncate(data.content || '', maxLen))}</blockquote>`,
        ].join('\n');
        (async () => {
            const threadId = await ensureThread(record);
            if (threadId !== null) enqueueToAll({ text: threadText, threadId });
        })();
    }

    // Staff message → start activity timer
    if (staffSent) {
        record.lastStaffMessageAt = Date.now();
        record.waitingForReply = true;
        const timerType = isClosingPhrase(data.content || '') ? 'closing' : 'regular';
        record.activityTimerType = timerType;
        markDirty();
        startActivityTimer(channelId, timerType);
        return;
    }

    // Player message → clear timer
    if (noReplyTimers.has(channelId)) clearNoReplyTimer(channelId);

    // First user message notification
    if (botPaused) return;
    if (!config.includeFirstUserMessage) return;
    if (notifiedFirstMessage.has(channelId)) return;
    if (!SAFE_MESSAGE_TYPES.has(data.type ?? 0)) return;

    notifiedFirstMessage.add(channelId);
    if (!config.forumMode) enqueueToAll({ ...buildFirstMessageNotification(channel, data), channelId });
    if (getPriority(channel?.name || '', data.content || '').high && config.mentionOnHighPriority) {
        enqueueToAll({ ...buildHighPriorityAlert(channel?.name || channelId), channelId });
    }

    // ── Ticket Chat: forward player messages to ALL users who have this ticket selected ──
    // Loop protection: ignore our own messages
    if (sentByBot.has(data.id)) return;
    if (selfUserId && author.id === selfUserId) return;
    for (const user of users) {
        const uState = getUserState(user.tgChatId).ticketChat;
        if (uState.activeTicketId === channelId) {
            const fwd = buildForwardedMessage(
                record.channelName, author, data.member, data.content || '',
                data.attachments || []
            );
            enqueueToUser(user.tgChatId, { text: fwd, channelId });
        }
    }
}

// ── Telegram Polling ──────────────────────────────────────────

function schedulePolling() {
    const intervalSec = config.pollingIntervalSec || 3;
    if (intervalSec <= 0) return;
    pollingTimer = setTimeout(async () => {
        pollingTimer = null;
        if (!pollingRunning) {
            pollingRunning = true;
            try { await pollTelegram(); } finally { pollingRunning = false; }
        }
        schedulePolling();
    }, intervalSec * 1000);
}

function stopPolling() {
    if (pollingTimer) { clearTimeout(pollingTimer); pollingTimer = null; }
}

async function pollTelegram() {
    try {
        const updates = await tgGetUpdates();
        if (updates.length > 0) console.log(`${LOG} 📨 Получено ${updates.length} обновлений из Telegram.`);
        for (const update of updates) {
            const uid = update.update_id;
            pollingOffset = uid + 1;
            // Dedup: skip already processed updates
            if (processedUpdateIds.has(uid)) continue;
            processedUpdateIds.add(uid);
            // Keep set small — remove old entries
            if (processedUpdateIds.size > 100) {
                const arr = [...processedUpdateIds];
                for (let i = 0; i < arr.length - 50; i++) processedUpdateIds.delete(arr[i]);
            }
            // Handle callback_query (inline buttons)
            if (update.callback_query) {
                const cbq = update.callback_query;
                const cbChatId = String(cbq?.message?.chat?.id || '');
                if (!allTgChatIds.has(cbChatId)) continue;
                const cbToken = getDiscordToken(cbChatId);
                const cbData = cbq.data || '';
                if (cbData === 'shift_checkin') {
                    const result = await handleSmena(cbChatId);
                    await tgAnswerCallbackQuery(cbq.id, result.startsWith('✅') ? 'Отмечено!' : 'Ошибка');
                    await tgEditMessageText(cbChatId, cbq.message.message_id, result);
                } else if (cbData === 'shift_skip') {
                    await tgAnswerCallbackQuery(cbq.id, 'Пропущено');
                    await tgEditMessageText(cbChatId, cbq.message.message_id, '⏭ Смена пропущена на сегодня.');
                }
                // ── Ticket Chat callbacks ──
                else if (cbData.startsWith('tsel_')) {
                    const chId = cbData.slice(5);
                    await handleSelectTicket(chId, cbq.id, cbq.message.message_id, cbChatId);
                } else if (cbData.startsWith('tpage_')) {
                    const pg = parseInt(cbData.slice(6), 10) || 0;
                    await tgAnswerCallbackQuery(cbq.id, `Стр. ${pg + 1}`);
                    const msg = buildTicketListMessage(pg, cbChatId);
                    await tgEditMessageText(cbChatId, cbq.message.message_id, msg.text, msg.markup);
                } else if (cbData === 'tunselect') {
                    await handleUnselectTicket(cbq.id, cbq.message.message_id, cbChatId);
                }
                continue;
            }

            const text = update?.message?.text || '';
            const chatId = String(update?.message?.chat?.id || '');
            if (!allTgChatIds.has(chatId)) continue;
            const token = getDiscordToken(chatId);

            // Handle reply to bot message → send to Discord ticket
            const replyTo = update?.message?.reply_to_message?.message_id;
            if (replyTo && text && !text.startsWith('/')) {
                enqueueToUser(chatId, { text: await handleReplyToTicket(replyTo, text, token) });
                continue;
            }

            if (text === '/start' || text.startsWith('/start ')) enqueueToUser(chatId, { text: buildStartMessage() });
            else if (text === '/list' || text.startsWith('/list ')) {
                const msg = buildTicketListMessage(0, chatId);
                enqueueToUser(chatId, { text: msg.text, replyMarkup: msg.markup });
            }
            else if (text === '/ticket' || text === '/active') {
                const msg = buildActiveTicketMessage(chatId);
                enqueueToUser(chatId, { text: msg.text, replyMarkup: msg.markup });
            }
            else if (text === '/unselect') {
                const uState = getUserState(chatId).ticketChat;
                uState.activeTicketId = null;
                uState.activeTicketName = null;
                savePerUserState();
                enqueueToUser(chatId, { text: '❌ Тикет сброшен. Нажми /list чтобы выбрать новый.', replyMarkup: { inline_keyboard: [[{ text: '📋 Открыть список', callback_data: 'tpage_0' }]] } });
            }
            else if (text.startsWith('/s ') || text === '/reply' || text.startsWith('/reply ')) {
                const msgText = text.startsWith('/s ') ? text.slice(3) : text.startsWith('/reply ') ? text.slice(7) : '';
                const result = await handleSendToTicket(msgText, chatId);
                enqueueToUser(chatId, { text: result.text, replyMarkup: result.markup });
            }
            else if (text === '/s') {
                enqueueToUser(chatId, { text: '❌ Формат: <code>/s текст сообщения</code>' });
            }
            else if (text === '/oldlist' || text.startsWith('/oldlist ')) enqueueToUser(chatId, { text: buildListMessage() });
            else if (text === '/stats' || text.startsWith('/stats ')) enqueueToUser(chatId, { text: buildStatsMessage() });
            else if (text === '/analytics' || text.startsWith('/analytics ')) enqueueToUser(chatId, { text: buildAnalyticsMessage() });
            else if (text === '/settings' || text.startsWith('/settings ')) enqueueToUser(chatId, { text: buildSettingsMessage() });
            else if (text.startsWith('/set ')) enqueueToUser(chatId, { text: handleSetCommand(text.slice(5)) });
            else if (text === '/set') enqueueToUser(chatId, { text: handleSetCommand('') });
            else if (text === '/pause' || text.startsWith('/pause ')) enqueueToUser(chatId, { text: handlePause() });
            else if (text === '/resume' || text.startsWith('/resume ')) enqueueToUser(chatId, { text: handleResume() });
            else if (text === '/reset' || text.startsWith('/reset ')) enqueueToUser(chatId, { text: handleReset() });
            else if (text.startsWith('/msg ')) enqueueToUser(chatId, { text: await handleMsgCommand(text.slice(5), token) });
            else if (text === '/msg') enqueueToUser(chatId, { text: await handleMsgCommand('', token) });
            else if (text === '/test' || text.startsWith('/test ')) enqueueToUser(chatId, { text: await handleTestSend(text.slice(5).trim() || '', token) });
            else if (text === '/smena' || text.startsWith('/smena ')) enqueueToUser(chatId, { text: await handleSmena(chatId) });
            else if (text === '/smenoff' || text.startsWith('/smenoff ')) enqueueToUser(chatId, { text: await handleSmenoff(chatId) });
            else if (text === '/resetsmen') {
                const shiftSt = getUserState(chatId).shift;
                shiftSt.lastShiftMessageId = null;
                shiftSt.lastShiftDate = null;
                shiftSt.lastShiftClosed = false;
                shiftSt.reminderSentDate = null;
                shiftSt.lastShiftContent = null;
                savePerUserState();
                enqueueToUser(chatId, { text: '🔄 Состояние смены сброшено. Можно делать /smena заново.' });
            }
            // Free-text relay to active ticket (no command, no reply)
            else if (!text.startsWith('/') && getUserState(chatId).ticketChat.activeTicketId && text.trim()) {
                const result = await handleSendToTicket(text, chatId);
                enqueueToUser(chatId, { text: result.text, replyMarkup: result.markup });
            }
        }
    } catch (e) {
        console.error(`${LOG} Ошибка полинга:`, e.message);
    }
}

// ── Discord Gateway ───────────────────────────────────────────

function connectGateway() {
    const url = resumeGatewayUrl
        ? `${resumeGatewayUrl}/?v=9&encoding=json`
        : GATEWAY_URL;

    console.log(`${LOG} 🔌 Подключение к Gateway...`);
    ws = new WebSocket(url);

    ws.on('open', () => {
        console.log(`${LOG} 🔌 WebSocket подключён.`);
    });

    ws.on('message', raw => {
        try {
            const msg = JSON.parse(raw);
            handleGatewayMessage(msg);
        } catch (e) {
            console.error(`${LOG} Ошибка парсинга Gateway:`, e.message);
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`${LOG} 🔌 WebSocket закрыт: ${code} ${reason || ''}`);
        cleanupGateway();
        if (code === 4004) {
            console.error(`${LOG} ❌ Невалидный токен! Проверьте config.json.`);
            process.exit(1);
        }
        if (code === 4013 || code === 4014) {
            console.error(`${LOG} ❌ Ошибка intents (${code}). Переподключение...`);
        }
        console.log(`${LOG} 🔄 Переподключение через 5 секунд...`);
        setTimeout(connectGateway, 5000);
    });

    ws.on('error', err => {
        console.error(`${LOG} ⚠️ WebSocket ошибка:`, err.message);
    });
}

function handleGatewayMessage(msg) {
    const { op, d, s, t } = msg;
    if (s !== null && s !== undefined) seq = s;

    switch (op) {
        case 10: // Hello
            startHeartbeat(d.heartbeat_interval);
            if (sessionId) {
                sendResume();
            } else {
                sendIdentify();
            }
            break;
        case 11: // Heartbeat ACK
            receivedAck = true;
            break;
        case 0: // Dispatch
            handleDispatch(t, d);
            break;
        case 7: // Reconnect
            console.log(`${LOG} 🔄 Сервер запросил переподключение.`);
            ws.close(4000);
            break;
        case 9: // Invalid Session
            console.log(`${LOG} ⚠️ Невалидная сессия, переидентификация...`);
            sessionId = null;
            resumeGatewayUrl = null;
            setTimeout(() => sendIdentify(), Math.random() * 4000 + 1000);
            break;
    }
}

function handleDispatch(event, data) {
    switch (event) {
        case 'READY': {
            sessionId = data.session_id;
            resumeGatewayUrl = data.resume_gateway_url;
            gatewayReady = true;
            selfUserId = data.user.id;
            console.log(`${LOG} ✅ Авторизован как ${data.user.username} (${data.user.id})`);
            // Start Telegram polling — ensure only one chain
            if (!pollingTimer && !pollingRunning) {
                schedulePolling();
                console.log(`${LOG} 📡 Telegram-поллинг запущен.`);
            }
            // In selfbot mode, READY includes guilds (often as unavailable stubs)
            let foundTarget = false;
            if (data.guilds && Array.isArray(data.guilds)) {
                for (const g of data.guilds) {
                    if (g.id === config.guildId) {
                        if (g.channels || g.name) {
                            console.log(`${LOG} 🏠 Сервер найден в READY payload.`);
                            onGuildCreate(g);
                            guildCreateHandled = true;
                        } else {
                            console.log(`${LOG} 🏠 Сервер ${config.guildId} в READY (unavailable), ждём GUILD_CREATE...`);
                        }
                        foundTarget = true;
                        break;
                    }
                }
                if (!foundTarget) {
                    console.log(`${LOG} ⚠️ Сервер ${config.guildId} не найден среди ${data.guilds.length} гильдий. Проверьте guildId в config.json!`);
                }
            }
            break;
        }
        case 'RESUMED':
            console.log(`${LOG} ✅ Сессия восстановлена.`);
            // Re-subscribe to ticket channels after resume (op 14 state is lost)
            if (!IS_BOT_TOKEN) {
                const catId = config.ticketsCategoryId;
                if (catId) {
                    const chIds = [];
                    for (const [chId, ch] of channelCache) {
                        if (ch.parent_id === catId || isTicketChannel(ch)) chIds.push(chId);
                    }
                    for (const [chId] of activeTickets) {
                        if (!chIds.includes(chId)) chIds.push(chId);
                    }
                    if (chIds.length > 0) sendLazyRequest(config.guildId, chIds);
                }
            }
            break;
        case 'GUILD_CREATE':
            if (data.id === config.guildId && guildCreateHandled) {
                console.log(`${LOG} 🏠 GUILD_CREATE для целевого сервера уже обработан, пропускаем.`);
            } else {
                onGuildCreate(data);
            }
            break;
        case 'READY_SUPPLEMENTAL':
            // Selfbot receives this with merged_members, etc. — ignore but log
            console.log(`${LOG} 📦 READY_SUPPLEMENTAL получен.`);
            break;
        case 'MESSAGE_CREATE':
            onMessageCreate(data);
            break;
        case 'CHANNEL_CREATE':
            onChannelCreate(data);
            break;
        case 'CHANNEL_UPDATE':
            onChannelUpdate(data);
            break;
        case 'CHANNEL_DELETE':
            onChannelDelete(data);
            break;
        case 'THREAD_CREATE':
            onThreadCreate(data);
            break;
        case 'THREAD_LIST_SYNC':
            onThreadListSync(data);
            break;
    }
}

function sendIdentify() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const payload = IS_BOT_TOKEN
        ? {
            // Bot mode — requires intents
            token: GATEWAY_TOKEN,
            intents: 33283, // GUILDS(1) | GUILD_MEMBERS(2) | GUILD_MESSAGES(512) | MESSAGE_CONTENT(32768)
            properties: { os: 'linux', browser: 'ticket-notifier', device: 'ticket-notifier' },
            compress: false,
            large_threshold: 250,
        }
        : {
            // User token (selfbot) mode — no intents field
            token: GATEWAY_TOKEN,
            properties: { os: 'Windows', browser: 'Chrome', device: '' },
            presence: { status: 'online', activities: [], since: 0, afk: false },
            compress: false,
            large_threshold: 250,
        };
    ws.send(JSON.stringify({ op: 2, d: payload }));
}

function sendResume() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
        op: 6,
        d: {
            token: GATEWAY_TOKEN,
            session_id: sessionId,
            seq,
        },
    }));
}

function startHeartbeat(intervalMs) {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    receivedAck = true;
    // First heartbeat with jitter
    const jitter = Math.floor(intervalMs * Math.random());
    setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 1, d: seq }));
        }
        heartbeatTimer = setInterval(() => {
            if (!receivedAck) {
                console.log(`${LOG} ⚠️ Нет Heartbeat ACK, переподключение...`);
                if (ws) ws.close(4000);
                return;
            }
            receivedAck = false;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ op: 1, d: seq }));
            }
        }, intervalMs);
    }, jitter);
}

function cleanupGateway() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    guildCreateHandled = false;
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
    console.log(`${LOG} ═══════════════════════════════════════`);
    console.log(`${LOG}  Telegram Ticket Notifier — 24/7`);
    console.log(`${LOG} ═══════════════════════════════════════`);

    if (!GATEWAY_TOKEN || GATEWAY_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
        console.error(`${LOG} ❌ Discord токен не указан!`);
        console.error(`${LOG}    Укажите "discordBotToken" (бот) или "discordToken" (юзер) в config.json`);
        process.exit(1);
    }
    console.log(`${LOG} 🔑 Режим: ${IS_BOT_TOKEN ? 'Discord Bot' : 'User Token (selfbot)'}`);
    if (!IS_BOT_TOKEN) console.log(`${LOG} ⚠️  Selfbot нарушает ToS Discord. Рекомендуется использовать Bot Token.`);
    if (!config.tgToken) {
        console.error(`${LOG} ❌ Telegram не настроен! Отредактируйте config.json.`);
        process.exit(1);
    }
    console.log(`${LOG} 👥 Пользователей: ${users.length} (${users.map(u => u.name || u.tgChatId).join(', ')})`);

    loadState();
    loadPerUserState();
    startAutosave();
    connectGateway();
    scheduleShiftReminder();

    // Graceful shutdown
    const shutdown = () => {
        console.log(`${LOG} 🛑 Остановка...`);
        stopPolling();
        stopAutosave();
        if (shiftReminderTimer) { clearTimeout(shiftReminderTimer); shiftReminderTimer = null; }
        noReplyTimers.forEach(t => clearTimeout(t));
        noReplyTimers.clear();
        saveState();
        savePerUserState();
        if (ws) ws.close(1000);
        setTimeout(() => process.exit(0), 1000);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main();
