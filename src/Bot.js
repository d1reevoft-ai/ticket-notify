// ═══════════════════════════════════════════════════════════════
//  Bot Class — Full-featured ticket notifier bot
//  Ported from bot.js (4158 lines) into multi-tenant class
// ═══════════════════════════════════════════════════════════════

const https = require('https');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { escapeHtml, truncate, formatDuration, sleep, isStaffFromMember, isClosingPhrase,
    getKyivDate, formatKyivDate, msUntilKyivHour, getKyivHour, getKyivMinute, getMemberDisplayName,
} = require('./bot/helpers');
const { evaluateAutoReplyDecision } = require('./bot/autoReplyEngine');
const { buildActivityMessage } = require('./bot/builders');
const { connectGateway, cleanupGateway } = require('./bot/gateway');
const { startPolling, stopPolling } = require('./bot/telegram');

class Bot {
    constructor(userId, config, dataDir, io) {
        const extractDiscordIds = (value) => {
            const matches = String(value || '').match(/\d{16,22}/g);
            return Array.isArray(matches) ? matches : [];
        };

        const normalizeGuildList = (raw) => {
            const uniq = new Set();
            const pushIds = (value) => {
                for (const id of extractDiscordIds(value)) uniq.add(String(id).trim());
            };

            if (Array.isArray(raw)) {
                for (const item of raw) pushIds(item);
                return [...uniq];
            }

            const txt = String(raw || '').trim();
            if (!txt) return [];

            try {
                const parsed = JSON.parse(txt);
                if (Array.isArray(parsed)) {
                    for (const item of parsed) pushIds(item);
                    if (uniq.size > 0) return [...uniq];
                }
            } catch { }

            pushIds(txt);
            if (uniq.size > 0) return [...uniq];
            return txt
                .split(',')
                .map(v => String(v || '').trim().replace(/^['"]+|['"]+$/g, ''))
                .filter(Boolean);
        };

        this.userId = userId;
        this.config = {
            tgToken: config.tgToken || '',
            tgChatId: config.tgChatId || '',
            discordToken: config.discordToken || '',
            discordBotToken: config.discordBotToken || '',
            guildId: config.guildId || '',
            ticketsCategoryId: config.ticketsCategoryId || '',
            ticketPrefix: config.ticketPrefix || 'тикет-от',
            staffRoleIds: config.staffRoleIds || [],
            maxMessageLength: config.maxMessageLength || 300,
            rateLimitMs: config.rateLimitMs || 200,
            activityCheckMin: config.activityCheckMin || 10,
            closingCheckMin: config.closingCheckMin || 15,
            closingPhrase: config.closingPhrase || 'остались вопросы',
            autoGreetEnabled: config.autoGreetEnabled ?? false,
            autoGreetText: config.autoGreetText || '',
            autoGreetDelay: config.autoGreetDelay || 3,
            autoGreetRoleIds: config.autoGreetRoleIds || [],
            shiftChannelId: config.shiftChannelId || '',
            priorityKeywords: config.priorityKeywords || [],
            binds: config.binds || {},
            autoReplies: config.autoReplies || [],
            botReplyGuildIds: normalizeGuildList(config.botReplyGuildIds || process.env.BOT_REPLY_GUILD_IDS || ''),
            forumMode: config.forumMode || false,
            ...config,
        };
        this.dataDir = dataDir;
        this.io = io;

        // ── Runtime State ───────────────────────────
        this.destroyed = false;
        this.botPaused = false;
        this.ws = null;
        this.sessionId = null;
        this.resumeUrl = null;
        this.seq = null;
        // Prefer user gateway when both tokens exist; bot token is used per-guild for sends.
        this._gatewayAuthMode = this.config.discordToken
            ? 'user'
            : (this.config.discordBotToken ? 'bot' : 'user');
        this._gatewayAltModeTried = false;
        this.heartbeatTimer = null;
        this.receivedAck = true;
        this.guildCreateHandled = false;
        this.pollingOffset = 0;
        this.pollingTimer = null;

        // ── Telegram Queue ──────────────────────────
        this.sendQueue = [];
        this.queueRunning = false;
        this.lastSendTime = 0;

        // ── Ticket State ────────────────────────────
        this.activeTickets = new Map();
        this.notifiedFirstMessage = new Set();
        this.sentByBot = new Set();
        this.tgMsgToChannel = new Map();
        this.noReplyTimers = new Map();

        // ── Caches ──────────────────────────────────
        this.channelCache = new Map();
        this.guildCache = new Map();
        this.guildRolesCache = new Map();
        this.guildMembersCache = new Map();
        this.guildPresenceCache = new Map();

        // ── Persistent State ────────────────────────
        this.ps = { totalCreated: 0, totalClosed: 0, totalMessagesSent: 0, hourlyBuckets: {} };
        this.stateDirty = false;
        this.autosaveTimer = null;

        // ── Per-user TG state ───────────────────────
        this.userStates = {}; // { chatId: { activeTicketId, activeTicketName, listPage, shift: {...} } }

        // ── Shift timers ────────────────────────────
        this.shiftReminderTimer = null;
        this.shiftCloseReminderTimer = null;

        // ── Dashboard Logs ──────────────────────────
        this.dashboardLogs = [];

        // ── Telegram API URL ────────────────────────
        this.telegramApi = `https://api.telegram.org/bot${this.config.tgToken}`;

        // ── SQLite DB ───────────────────────────────
        this.db = null;
        this.stmtInsertClosed = null;
        this.stmtInsertMessage = null;
    }

    getDiscordGatewayToken() {
        const mode = this._gatewayAuthMode === 'bot' ? 'bot' : 'user';
        if (mode === 'bot') return this.config.discordBotToken || this.config.discordToken || '';
        return this.config.discordToken || this.config.discordBotToken || '';
    }

    isDiscordBotAuthMode() {
        return this._gatewayAuthMode === 'bot';
    }

    getDiscordAuthorizationHeader() {
        const token = this.getDiscordGatewayToken();
        if (!token) return '';
        return this.isDiscordBotAuthMode() ? `Bot ${token}` : token;
    }

    shouldUseBotForGuild(guildId, channelId) {
        if (!this.config.discordBotToken) return false;
        const gid = String(guildId || '').trim();
        const cid = String(channelId || '').trim();
        const allowed = Array.isArray(this.config.botReplyGuildIds) ? this.config.botReplyGuildIds.map(String) : [];
        if (!allowed.length) return false;
        if (gid && allowed.includes(gid)) return true;
        if (cid && allowed.includes(cid)) return true;
        return false;
    }

    getDiscordAuthorizationHeaderForGuild(guildId, channelId) {
        if (this.shouldUseBotForGuild(guildId, channelId)) {
            return `Bot ${this.config.discordBotToken}`;
        }
        return this.getDiscordAuthorizationHeader();
    }

    // ═══════════════════════════════════════════════════════
    //  LIFECYCLE
    // ═══════════════════════════════════════════════════════

    async start() {
        const token = this.getDiscordGatewayToken();
        if (!token) { this.log('❌ No Discord token configured'); return; }
        if (!this.config.tgToken) { this.log('❌ No Telegram token configured'); return; }

        this.log('═══════════════════════════════════════');
        this.log(' Telegram Ticket Notifier — Starting');
        this.log('═══════════════════════════════════════');

        this.initDb();
        this.loadState();
        this.startAutosave();
        connectGateway(this);
        startPolling(this);
        this.scheduleShiftReminder();
    }

    stop() {
        this.log('🛑 Stopping bot...');
        this.destroyed = true;
        stopPolling(this);
        this.stopAutosave();
        if (this.shiftReminderTimer) { clearTimeout(this.shiftReminderTimer); this.shiftReminderTimer = null; }
        if (this.shiftCloseReminderTimer) { clearTimeout(this.shiftCloseReminderTimer); this.shiftCloseReminderTimer = null; }
        this.noReplyTimers.forEach(t => clearTimeout(t));
        this.noReplyTimers.clear();
        this.saveState();
        if (this.ws) try { this.ws.close(1000); } catch { }
        if (this.db) try { this.db.close(); } catch { }
    }

    inferLogType(message) {
        const m = String(message || '').toLowerCase();
        if (m.includes('❌') || m.includes(' error') || m.includes('ошиб') || m.includes('failed')) return 'error';
        if (m.includes('gateway') || m.includes('dispatch') || m.includes('heartbeat') || m.includes('ready') || m.includes('resumed') || m.includes('guild event')) return 'gateway';
        if (m.includes('auto-reply') || m.includes('ar debug') || m.includes('autoreply')) return 'autoreply';
        if (m.includes('neuro') || m.includes(' ai') || m.includes('gemini') || m.includes('stepfun')) return 'ai';
        if (m.includes('greet') || m.includes('привет')) return 'greet';
        if (m.includes('shift') || m.includes('смен')) return 'shift';
        if (m.includes('timer') || m.includes('reminder') || m.includes('timeout') || m.includes('restored')) return 'timer';
        if (m.includes('ticket') || m.includes('тикет')) return 'ticket';
        if (m.includes('bind') || m.includes('бинд')) return 'bind';
        if (m.includes('command') || m.includes('команда') || m.includes(' callback')) return 'command';
        if (m.includes('message') || m.includes('сообщ')) return 'message';
        return 'system';
    }

    log(msg, type, details = undefined) {
        const message = String(msg || '');
        console.log(`[Bot:${this.userId}] ${message}`);
        this.addLog(type || this.inferLogType(message), message, details);
    }

    // ═══════════════════════════════════════════════════════
    //  DATABASE
    // ═══════════════════════════════════════════════════════

    initDb() {
        const dbFile = path.join(this.dataDir, `tickets_${this.userId}.db`);
        this.db = new Database(dbFile);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('busy_timeout = 5000');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS closed_tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id TEXT NOT NULL,
                channel_name TEXT DEFAULT '', opener_id TEXT DEFAULT '', opener_username TEXT DEFAULT '',
                created_at INTEGER DEFAULT 0, closed_at INTEGER DEFAULT 0, first_staff_reply_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_ct_closed ON closed_tickets(closed_at);
            CREATE TABLE IF NOT EXISTS ticket_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id TEXT NOT NULL,
                message_id TEXT DEFAULT '', content TEXT DEFAULT '',
                author_id TEXT DEFAULT '', author_username TEXT DEFAULT '',
                author_global_name TEXT, author_avatar TEXT, author_bot INTEGER DEFAULT 0,
                timestamp TEXT DEFAULT '', embeds TEXT, attachments TEXT, member_roles TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_tm_ch ON ticket_messages(channel_id);
        `);
        this.stmtInsertClosed = this.db.prepare(
            `INSERT INTO closed_tickets (channel_id, channel_name, opener_id, opener_username, created_at, closed_at, first_staff_reply_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        this.stmtInsertMessage = this.db.prepare(
            `INSERT INTO ticket_messages (channel_id, message_id, content, author_id, author_username, author_global_name, author_avatar, author_bot, timestamp, embeds, attachments, member_roles) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        this.log(`💾 DB ready: ${dbFile}`);
    }

    dbInsertClosedTicket(ticket) {
        try {
            this.stmtInsertClosed.run(ticket.channelId, ticket.channelName || '', ticket.openerId || '', ticket.openerUsername || '', ticket.createdAt || 0, ticket.closedAt || Date.now(), ticket.firstStaffReplyAt || null);
        } catch (e) { this.log(`DB insert error: ${e.message}`); }
    }

    dbInsertMessages(channelId, messages) {
        const tx = this.db.transaction((msgs) => {
            this.db.prepare('DELETE FROM ticket_messages WHERE channel_id = ?').run(channelId);
            for (const m of msgs) {
                this.stmtInsertMessage.run(channelId, m.id || '', m.content || '', m.author?.id || '', m.author?.username || '', m.author?.global_name || null, m.author?.avatar || null, m.author?.bot ? 1 : 0, m.timestamp || '', m.embeds ? JSON.stringify(m.embeds) : null, m.attachments ? JSON.stringify(m.attachments) : null, m.member?.roles ? JSON.stringify(m.member.roles) : null);
            }
        });
        tx(messages);
    }

    dbGetClosedTickets({ page = 1, limit = 50, search = '' } = {}) {
        let where = ''; const params = [];
        if (search) { where = 'WHERE channel_name LIKE ? OR opener_username LIKE ?'; params.push(`%${search}%`, `%${search}%`); }
        const total = this.db.prepare(`SELECT COUNT(*) as cnt FROM closed_tickets ${where}`).get(...params).cnt;
        params.push(limit, (page - 1) * limit);
        const rows = this.db.prepare(`SELECT * FROM closed_tickets ${where} ORDER BY closed_at DESC LIMIT ? OFFSET ?`).all(...params);
        return {
            tickets: rows.map(r => ({ channelId: r.channel_id, channelName: r.channel_name, openerId: r.opener_id, openerUsername: r.opener_username, createdAt: r.created_at, closedAt: r.closed_at, firstStaffReplyAt: r.first_staff_reply_at })),
            total, page, totalPages: Math.ceil(total / limit),
        };
    }

    dbGetTicketMessages(channelId) {
        return this.db.prepare('SELECT * FROM ticket_messages WHERE channel_id = ? ORDER BY id ASC').all(channelId).map(r => ({
            id: r.message_id, content: r.content,
            author: { id: r.author_id, username: r.author_username, global_name: r.author_global_name, avatar: r.author_avatar, bot: !!r.author_bot },
            timestamp: r.timestamp, embeds: r.embeds ? JSON.parse(r.embeds) : [], attachments: r.attachments ? JSON.parse(r.attachments) : [],
        }));
    }

    dbGetClosedCount() { return this.db.prepare('SELECT COUNT(*) as cnt FROM closed_tickets').get().cnt; }

    dbGetAllClosedTickets() {
        return this.db.prepare('SELECT * FROM closed_tickets ORDER BY closed_at DESC').all().map(r => ({
            channelId: r.channel_id, channelName: r.channel_name, openerId: r.opener_id,
            openerUsername: r.opener_username, createdAt: r.created_at, closedAt: r.closed_at,
            firstStaffReplyAt: r.first_staff_reply_at,
        }));
    }

    // Save config changes back to DB (called by dashboard API)
    saveConfigToDb() {
        // If we have a reference to the shared DB, update the users row
        if (this._sharedDb) {
            try {
                this._sharedDb.prepare(`UPDATE users SET
                    auto_greet_enabled = ?, auto_greet_text = ?,
                    auto_greet_role_ids = ?, auto_greet_all_channels = ?,
                    activity_check_min = ?, closing_check_min = ?,
                    closing_phrase = ?, ticket_prefix = ?,
                    rate_limit_ms = ?, max_message_length = ?,
                    forum_mode = ?, binds = ?, auto_replies = ?,
                    priority_keywords = ?, staff_role_ids = ?,
                    tickets_category_id = ?, shift_channel_id = ?,
                    gemini_api_keys = ?
                    WHERE id = ?`).run(
                    this.config.autoGreetEnabled ? 1 : 0, this.config.autoGreetText || '',
                    JSON.stringify(this.config.autoGreetRoleIds || []),
                    this.config.autoGreetAllChannels ? 1 : 0,
                    this.config.activityCheckMin || 10, this.config.closingCheckMin || 15,
                    this.config.closingPhrase || '', this.config.ticketPrefix || '',
                    this.config.rateLimitMs || 200, this.config.maxMessageLength || 300,
                    this.config.forumMode ? 1 : 0,
                    JSON.stringify(this.config.binds || {}),
                    JSON.stringify(this.config.autoReplies || []),
                    JSON.stringify(this.config.priorityKeywords || []),
                    JSON.stringify(this.config.staffRoleIds || []),
                    this.config.ticketsCategoryId || '',
                    this.config.shiftChannelId || '',
                    JSON.stringify(this.config.geminiApiKeys || []),
                    this.userId
                );
            } catch (e) { console.error(`[Bot:${this.userId}] ❌ saveConfigToDb FAILED:`, e.message); this.log(`❌ saveConfigToDb FAILED: ${e.message}`); }
        }
    }

    updateConfig(newConfig) {
        const prevToken = this.getDiscordGatewayToken();
        Object.assign(this.config, newConfig);
        const preferredMode = this.config.discordToken
            ? 'user'
            : (this.config.discordBotToken ? 'bot' : 'user');
        this._gatewayAuthMode = preferredMode;
        const nextToken = this.getDiscordGatewayToken();
        if (prevToken !== nextToken) {
            this._gatewayAltModeTried = false;
        }
    }

    // ═══════════════════════════════════════════════════════
    //  STATE PERSISTENCE
    // ═══════════════════════════════════════════════════════

    get stateFile() { return path.join(this.dataDir, `state_${this.userId}.json`); }

    markDirty() { this.stateDirty = true; }

    loadState() {
        try {
            if (!fs.existsSync(this.stateFile)) return;
            const data = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
            this.ps = { ...this.ps, ...data.ps };
            this.pollingOffset = data.pollingOffset || 0;
            this.userStates = data.userStates || {};
            if (data.activeTickets) {
                for (const [k, v] of Object.entries(data.activeTickets)) this.activeTickets.set(k, v);
            }
            if (data.notifiedFirstMessage) {
                for (const id of data.notifiedFirstMessage) this.notifiedFirstMessage.add(id);
            }
            this.log(`📂 State loaded (${this.activeTickets.size} active tickets)`);
        } catch (e) { this.log(`State load error: ${e.message}`); }
    }

    saveState() {
        try {
            const data = {
                ps: this.ps, pollingOffset: this.pollingOffset,
                userStates: this.userStates,
                activeTickets: Object.fromEntries(this.activeTickets.entries()),
                notifiedFirstMessage: [...this.notifiedFirstMessage],
            };
            fs.writeFileSync(this.stateFile, JSON.stringify(data, null, 2), 'utf8');
            this.stateDirty = false;
        } catch (e) { this.log(`State save error: ${e.message}`); }
    }

    startAutosave() {
        this.autosaveTimer = setInterval(() => { if (this.stateDirty) this.saveState(); }, 30000);
        // Snapshot active ticket messages periodically
        setInterval(() => { this.snapshotAllActiveTickets().catch(() => { }); }, 2 * 60 * 1000);
    }

    stopAutosave() { if (this.autosaveTimer) { clearInterval(this.autosaveTimer); this.autosaveTimer = null; } }

    addLog(type, message, details = undefined) {
        const ts = new Date().toISOString();
        const entry = {
            type: type || this.inferLogType(message),
            message: String(message || ''),
            ts,
            timestamp: Date.now(),
        };
        if (details && typeof details === 'object') entry.details = details;
        this.dashboardLogs.unshift(entry);
        if (this.dashboardLogs.length > 5000) this.dashboardLogs.length = 5000;
        this.emitToDashboard('log:new', entry);
    }

    emitToDashboard(event, payload = {}) {
        if (!this.io) return;
        try {
            const room = `user:${this.userId}`;
            this.io.to(room).emit(event, payload);
        } catch { }
    }

    // ═══════════════════════════════════════════════════════
    //  HTTP HELPERS
    // ═══════════════════════════════════════════════════════

    httpPost(url, body) {
        return new Promise((resolve, reject) => {
            const u = new URL(url); const data = JSON.stringify(body);
            const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
                let chunks = ''; res.on('data', c => chunks += c);
                res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: chunks }));
            });
            req.on('error', reject); req.write(data); req.end();
        });
    }

    httpPostWithHeaders(url, body, extraHeaders = {}) {
        return new Promise((resolve, reject) => {
            const u = new URL(url); const data = JSON.stringify(body);
            const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...extraHeaders };
            const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers }, res => {
                let chunks = ''; res.on('data', c => chunks += c);
                res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: chunks, headers: res.headers }));
            });
            req.on('error', reject); req.write(data); req.end();
        });
    }

    httpGet(url, headers = {}) {
        return new Promise((resolve, reject) => {
            const u = new URL(url);
            const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers }, res => {
                let chunks = ''; res.on('data', c => chunks += c);
                res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: chunks, headers: res.headers }));
            });
            req.on('error', reject); req.end();
        });
    }

    // ═══════════════════════════════════════════════════════
    //  TELEGRAM API
    // ═══════════════════════════════════════════════════════

    async tgSendMessage(chatId, text, replyMarkup, threadId) {
        const payload = { chat_id: chatId || this.config.tgChatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
        if (replyMarkup) payload.reply_markup = replyMarkup;
        if (threadId) payload.message_thread_id = threadId;
        try {
            const res = await this.httpPost(`${this.telegramApi}/sendMessage`, payload);
            if (!res.ok) {
                this.log(`TG API ${res.status}: ${res.body?.slice(0, 100)}`);
                if (res.status === 429) try { const j = JSON.parse(res.body); await sleep((j?.parameters?.retry_after ?? 5) * 1000); } catch { }
                return { ok: false, messageId: null };
            }
            let messageId = null;
            try { const j = JSON.parse(res.body); if (j.ok && j.result) messageId = j.result.message_id; } catch { }
            return { ok: true, messageId };
        } catch (e) { this.log(`TG error: ${e.message}`); return { ok: false, messageId: null }; }
    }

    async tgGetUpdates() {
        try {
            const res = await this.httpGet(`${this.telegramApi}/getUpdates?offset=${this.pollingOffset}&timeout=1&allowed_updates=["message","callback_query"]`);
            if (!res.ok) return [];
            const data = JSON.parse(res.body);
            return data.ok ? (data.result || []) : [];
        } catch { return []; }
    }

    async tgAnswerCallbackQuery(cbqId, text) {
        try { await this.httpPost(`${this.telegramApi}/answerCallbackQuery`, { callback_query_id: cbqId, text: text || '' }); } catch { }
    }

    async tgEditMessageText(chatId, messageId, text, replyMarkup) {
        const payload = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', disable_web_page_preview: true };
        if (replyMarkup) payload.reply_markup = replyMarkup;
        try { await this.httpPost(`${this.telegramApi}/editMessageText`, payload); } catch { }
    }

    // ═══════════════════════════════════════════════════════
    //  DISCORD REST
    // ═══════════════════════════════════════════════════════

    async sendDiscordMessage(channelId, content, replyToMessageId, guildId) {
        const cachedGuildId = this.channelCache.get(String(channelId || ''))?.guild_id || '';
        const effectiveGuildId = String(guildId || cachedGuildId || '').trim();
        const forcedBotRoute = this.shouldUseBotForGuild(effectiveGuildId, channelId);
        if (forcedBotRoute) {
            this.log(`🧭 Bot-only route selected for guild ${effectiveGuildId || '?'} channel ${channelId}`);
        }
        const primaryAuthHeader = this.getDiscordAuthorizationHeaderForGuild(effectiveGuildId, channelId);
        const fallbackAuthHeader = this.getDiscordAuthorizationHeader();
        const url = `https://discord.com/api/v9/channels/${channelId}/messages`;
        const payload = { content };
        if (replyToMessageId) payload.message_reference = { message_id: replyToMessageId };
        const body = JSON.stringify(payload);

        const sendOnce = (authHeader) => new Promise((resolve, reject) => {
            const u = new URL(url);
            const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: authHeader, 'User-Agent': 'Mozilla/5.0' } }, res => {
                let chunks = ''; res.on('data', c => chunks += c);
                res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: chunks, usedAuth: authHeader.startsWith('Bot ') ? 'bot' : 'user' }));
            });
            req.on('error', reject); req.write(body); req.end();
        });

        const first = await sendOnce(primaryAuthHeader);
        const usedBotFirst = primaryAuthHeader.startsWith('Bot ');
        const allowForcedBotFallback = process.env.BOT_REPLY_FALLBACK_TO_USER === '1';
        const canFallback = usedBotFirst
            && !first.ok
            && (first.status === 401 || first.status === 403)
            && fallbackAuthHeader !== primaryAuthHeader
            && (!forcedBotRoute || allowForcedBotFallback);
        if (canFallback) {
            this.log(`⚠️ Bot auth send failed (${first.status}) in guild ${effectiveGuildId || '?'}, retrying with user auth...`);
            return sendOnce(fallbackAuthHeader);
        }
        if (forcedBotRoute && usedBotFirst && !first.ok && (first.status === 401 || first.status === 403)) {
            this.log(`❌ Bot-only route blocked (${first.status}) in guild ${effectiveGuildId || '?'}, channel ${channelId}. User fallback disabled.`);
        }
        return first;
    }

    async editDiscordMessage(channelId, messageId, content) {
        const authHeader = this.getDiscordAuthorizationHeader();
        const url = `https://discord.com/api/v9/channels/${channelId}/messages/${messageId}`;
        const body = JSON.stringify({ content });
        return new Promise((resolve, reject) => {
            const u = new URL(url);
            const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: authHeader, 'User-Agent': 'Mozilla/5.0' } }, res => {
                let chunks = ''; res.on('data', c => chunks += c);
                res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: chunks }));
            });
            req.on('error', reject); req.write(body); req.end();
        });
    }

    async fetchChannelMessages(channelId, limit = 100) {
        const authHeader = this.getDiscordAuthorizationHeader();
        try {
            const res = await this.httpGet(`https://discord.com/api/v9/channels/${channelId}/messages?limit=${limit}`, { Authorization: authHeader });
            return res.ok ? JSON.parse(res.body) : [];
        } catch { return []; }
    }

    async closeTicketViaButton(channelId) {
        this.log(`🔒 Attempting to close ticket ${channelId} via button click...`);
        const messages = await this.fetchChannelMessages(channelId, 50);
        if (!messages || messages.length === 0) {
            return { ok: false, error: 'Не удалось загрузить сообщения канала' };
        }

        // Find a message with a "Закрыть" button component
        let closeButton = null;
        let targetMessage = null;
        for (const msg of messages) {
            if (!msg.components || !Array.isArray(msg.components)) continue;
            for (const row of msg.components) {
                if (!row.components || !Array.isArray(row.components)) continue;
                for (const comp of row.components) {
                    if (comp.type === 2 && comp.label && /закрыть/i.test(comp.label) && comp.custom_id) {
                        closeButton = comp;
                        targetMessage = msg;
                        break;
                    }
                }
                if (closeButton) break;
            }
            if (closeButton) break;
        }

        if (!closeButton || !targetMessage) {
            return { ok: false, error: 'Кнопка "Закрыть тикет" не найдена в канале' };
        }

        const applicationId = targetMessage.author?.id || targetMessage.application_id || '';
        if (!applicationId) {
            return { ok: false, error: 'Не удалось определить application_id бота' };
        }

        this.log(`🔒 Found close button: custom_id="${closeButton.custom_id}" on message ${targetMessage.id} by app ${applicationId}`);

        // Send interaction (type 3 = MESSAGE_COMPONENT)
        const authHeader = this.getDiscordAuthorizationHeader();
        const guildId = this.channelCache.get(channelId)?.guild_id || this.config.guildId || '';
        const nonce = String(BigInt(Date.now()) * 1000000n + BigInt(Math.floor(Math.random() * 1000000)));
        const payload = {
            type: 3,
            nonce,
            guild_id: guildId,
            channel_id: channelId,
            message_flags: 0,
            message_id: targetMessage.id,
            application_id: applicationId,
            session_id: require('crypto').randomUUID(),
            data: {
                component_type: 2,
                custom_id: closeButton.custom_id,
            },
        };

        try {
            const url = 'https://discord.com/api/v9/interactions';
            const body = JSON.stringify(payload);
            const result = await new Promise((resolve, reject) => {
                const u = new URL(url);
                const req = https.request({
                    hostname: u.hostname, path: u.pathname, method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: authHeader, 'User-Agent': 'Mozilla/5.0' }
                }, res => {
                    let chunks = ''; res.on('data', c => chunks += c);
                    res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: chunks }));
                });
                req.on('error', reject); req.write(body); req.end();
            });

            if (result.ok) {
                this.log(`✅ Close button clicked successfully for ${channelId}`);
                this.addLog('ticket', `Тикет ${channelId} закрыт через кнопку`);
                return { ok: true };
            } else {
                this.log(`❌ Close button click failed: ${result.status} ${result.body?.slice(0, 200)}`);
                return { ok: false, error: `Discord API ошибка: ${result.status}` };
            }
        } catch (e) {
            this.log(`❌ Close button click error: ${e.message}`);
            return { ok: false, error: e.message };
        }
    }

    // ═══════════════════════════════════════════════════════
    //  TELEGRAM QUEUE
    // ═══════════════════════════════════════════════════════

    enqueue(item) {
        if (this.config.telegramEnabled === false) return;
        this.sendQueue.push({ retries: 0, ...item });
        if (!this.queueRunning) this.runQueue();
    }

    async runQueue() {
        if (this.queueRunning) return;
        this.queueRunning = true;
        while (this.sendQueue.length > 0) {
            const item = this.sendQueue[0];
            const wait = this.config.rateLimitMs - (Date.now() - this.lastSendTime);
            if (wait > 0) await sleep(wait);
            this.lastSendTime = Date.now();
            const result = await this.tgSendMessage(item.chatId || this.config.tgChatId, item.text, item.replyMarkup, item.threadId);
            if (result.ok) {
                this.sendQueue.shift();
                this.ps.totalMessagesSent++;
                this.markDirty();
                if (result.messageId && item.channelId) {
                    this.tgMsgToChannel.set(result.messageId, { channelId: item.channelId, chatId: item.chatId });
                    if (this.tgMsgToChannel.size > 400) { const keys = [...this.tgMsgToChannel.keys()]; for (let i = 0; i < keys.length - 200; i++) this.tgMsgToChannel.delete(keys[i]); }
                }
            } else {
                item.retries = (item.retries || 0) + 1;
                if (item.retries >= 3) { this.sendQueue.shift(); this.addLog('error', 'Сообщение потеряно после 3 попыток'); }
                else await sleep(2000 * item.retries);
            }
        }
        this.queueRunning = false;
    }

    // ═══════════════════════════════════════════════════════
    //  USER STATE (per TG chat)
    // ═══════════════════════════════════════════════════════

    getUserState(chatId) {
        if (!this.userStates[chatId]) {
            this.userStates[chatId] = { activeTicketId: null, activeTicketName: null, listPage: 0, shift: { lastShiftDate: null, lastShiftMessageId: null, lastShiftClosed: false, lastShiftContent: null, reminderSentDate: null, lateReminderSentDate: null, closeReminderSentDate: null } };
        }
        return this.userStates[chatId];
    }

    getTicketList() {
        return [...this.activeTickets.values()].sort((a, b) => (b.lastMessageAt || b.createdAt) - (a.lastMessageAt || a.createdAt));
    }

    // ═══════════════════════════════════════════════════════
    //  COMMAND HANDLERS
    // ═══════════════════════════════════════════════════════

    async handleMsgCommand(argsStr) {
        const match = argsStr.trim().match(/^(\d+)\s+(.+)$/s);
        if (!match) return '❌ Формат: /msg <номер> <текст>\n\nНомер тикета из /list';
        const num = parseInt(match[1], 10);
        const text = match[2].trim();
        const tickets = [...this.activeTickets.values()];
        if (num < 1 || num > tickets.length) return `❌ Тикет #${num} не найден. Открытых: ${tickets.length}`;
        const record = tickets[num - 1];
        try {
            const res = await this.sendDiscordMessage(record.channelId, text);
            if (res.ok) return `✅ Отправлено в <code>#${escapeHtml(record.channelName)}</code>:\n\n<blockquote>${escapeHtml(truncate(text, 200))}</blockquote>`;
            return `❌ Ошибка Discord (${res.status})`;
        } catch (e) { return `❌ Ошибка: ${e.message}`; }
    }

    async handleReplyToTicket(replyToMsgId, text) {
        const mapping = this.tgMsgToChannel.get(replyToMsgId);
        const channelId = mapping?.channelId || mapping;
        if (!channelId) return '❌ Не удалось определить тикет. Используй /msg <номер> <текст>';
        try {
            const res = await this.sendDiscordMessage(channelId, text);
            const record = this.activeTickets.get(channelId);
            if (res.ok) return `✅ Отправлено в <code>#${escapeHtml(record?.channelName || channelId)}</code>:\n\n<blockquote>${escapeHtml(truncate(text, 200))}</blockquote>`;
            return `❌ Ошибка Discord (${res.status})`;
        } catch (e) { return `❌ Ошибка: ${e.message}`; }
    }

    async handleSendToTicket(text, chatId) {
        const uState = this.getUserState(chatId);
        if (!uState.activeTicketId) return { text: '📭 Тикет не выбран. Нажми /list.', markup: { inline_keyboard: [[{ text: '📋 Список', callback_data: 'tpage_0' }]] } };
        if (!text.trim()) return { text: '❌ Пустое сообщение.', markup: null };
        const channelId = uState.activeTicketId;
        const record = this.activeTickets.get(channelId);
        const channelName = record?.channelName || channelId;
        // Split long messages
        const parts = []; let remaining = text;
        while (remaining.length > 0) {
            if (remaining.length <= 1900) { parts.push(remaining); break; }
            let cut = remaining.lastIndexOf('\n', 1900);
            if (cut < 950) cut = remaining.lastIndexOf(' ', 1900);
            if (cut < 950) cut = 1900;
            parts.push(remaining.slice(0, cut)); remaining = remaining.slice(cut).trimStart();
        }
        try {
            for (const part of parts) {
                const res = await this.sendDiscordMessage(channelId, part);
                if (!res.ok) return { text: `❌ Ошибка Discord (${res.status})`, markup: null };
                try { const j = JSON.parse(res.body); if (j.id) this.sentByBot.add(j.id); } catch { }
            }
            this.addLog('message', `Сообщение → #${channelName}`);
            return { text: `✅ <b>Отправлено в</b> <code>#${escapeHtml(channelName)}</code>\n\n<blockquote>${escapeHtml(truncate(text, 200))}</blockquote>`, markup: null };
        } catch (e) { return { text: `❌ Ошибка: ${e.message}`, markup: null }; }
    }

    async handleHistory(chatId) {
        const uState = this.getUserState(chatId);
        if (!uState.activeTicketId) return [{ text: '❌ Сначала выбери тикет через /list', markup: null }];
        const messages = await this.fetchChannelMessages(uState.activeTicketId, 100);
        if (!messages?.length) return [{ text: '📭 Нет сообщений.', markup: null }];
        messages.reverse();
        const lines = [`📜 <b>История #${escapeHtml(uState.activeTicketName || '?')}</b> (${messages.length})\n`];
        for (const msg of messages) {
            if (!msg.author || msg.author.bot) continue;
            const time = new Date(msg.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            const nick = msg.member?.nick || msg.author.global_name || msg.author.username || '?';
            const isStaff = isStaffFromMember(msg.member, this.config.staffRoleIds);
            lines.push(`${isStaff ? '👮' : '👤'} ${escapeHtml(nick)} (${time}): ${escapeHtml(truncate(msg.content || '(вложение)', 200))}`);
        }
        const full = lines.join('\n');
        if (full.length <= 4096) return [{ text: full, markup: null }];
        const chunks = []; let rem = full;
        while (rem.length > 0) { if (rem.length <= 4096) { chunks.push({ text: rem, markup: null }); break; } let c = rem.lastIndexOf('\n', 4096); if (c < 2000) c = 4096; chunks.push({ text: rem.slice(0, c), markup: null }); rem = rem.slice(c).trimStart(); }
        return chunks;
    }

    // ── Binds ────────────────────────────────────────────

    handleBindsList() {
        const binds = this.config.binds || {};
        if (Object.keys(binds).length === 0) return '📭 Нет биндов.';
        const lines = ['╔══════════════════════════╗', '║  📋  <b>БИНДЫ</b>', '╚══════════════════════════╝', ''];
        for (const [key, bind] of Object.entries(binds)) lines.push(`  <b>/${escapeHtml(key)}</b> — <i>${escapeHtml(truncate(bind.message || '', 60))}</i>`);
        lines.push('', `Всего: ${Object.keys(binds).length}`);
        return lines.join('\n');
    }

    handleAddBind(argsStr) {
        const idx = argsStr.indexOf(' ');
        if (idx === -1 || !argsStr.trim()) return '❌ Формат: /addbind <имя> <текст>';
        const name = argsStr.slice(0, idx).trim(), message = argsStr.slice(idx + 1).trim();
        if (!name || !message) return '❌ Формат: /addbind <имя> <текст>';
        if (!this.config.binds) this.config.binds = {};
        this.config.binds[name] = { name, message };
        this.addLog('bind', `Бинд «${name}» добавлен`);
        return `✅ Бинд "<b>${escapeHtml(name)}</b>" добавлен.`;
    }

    handleDelBind(name) {
        if (!name.trim()) return '❌ Формат: /delbind <имя>';
        if (!this.config.binds?.[name]) return `❌ Бинд "${escapeHtml(name)}" не найден.`;
        delete this.config.binds[name];
        this.addLog('bind', `Бинд «${name}» удалён`);
        return `✅ Бинд "<b>${escapeHtml(name)}</b>" удалён.`;
    }

    async handleBindSearch(query, chatId) {
        const uState = this.getUserState(chatId);
        if (!uState.activeTicketId) return null;
        const binds = this.config.binds || {};
        if (Object.keys(binds).length === 0) return null;
        const q = query.toLowerCase().trim();
        if (q.length < 2) return null;
        const matches = Object.entries(binds).filter(([k]) => k.toLowerCase().startsWith(q) || q.startsWith(k.toLowerCase())).map(([, v]) => v);
        if (matches.length === 0) return null;
        if (matches.length === 1) {
            const bind = matches[0];
            try {
                const res = await this.sendDiscordMessage(uState.activeTicketId, bind.message);
                if (res.ok) { try { const j = JSON.parse(res.body); if (j.id) this.sentByBot.add(j.id); } catch { } this.addLog('bind', `Бинд «${bind.name}»`); return { text: `✅ Отправлено: "${escapeHtml(bind.name)}"`, markup: null }; }
                return { text: `❌ Ошибка Discord (${res.status})`, markup: null };
            } catch (e) { return { text: `❌ ${e.message}`, markup: null }; }
        }
        const buttons = [];
        for (let i = 0; i < matches.length; i += 2) {
            const row = [{ text: matches[i].name, callback_data: `bind_${matches[i].name}` }];
            if (i + 1 < matches.length) row.push({ text: matches[i + 1].name, callback_data: `bind_${matches[i + 1].name}` });
            buttons.push(row);
        }
        return { text: `🔍 Найдено ${matches.length} биндов:`, markup: { inline_keyboard: buttons } };
    }

    // ── Greet ────────────────────────────────────────────

    handleGreet(args) {
        if (!args?.trim()) {
            const status = this.config.autoGreetEnabled ? '✅ Включено' : '❌ Выключено';
            return ['╔══════════════════════════╗', '║  👋  <b>АВТО-ПРИВЕТСТВИЕ</b>', '╚══════════════════════════╝', '', `Статус: <b>${status}</b>`, `Текст: <i>${escapeHtml(this.config.autoGreetText || '')}</i>`, '', '/greet on — включить', '/greet off — выключить', '/setgreet <текст> — изменить'].join('\n');
        }
        const arg = args.trim().toLowerCase();
        if (arg === 'on') { this.config.autoGreetEnabled = true; this.addLog('greet', 'Включено'); return '✅ Авто-приветствие <b>включено</b>.'; }
        if (arg === 'off') { this.config.autoGreetEnabled = false; this.addLog('greet', 'Выключено'); return '❌ Авто-приветствие <b>выключено</b>.'; }
        return '❌ /greet on или /greet off';
    }

    handleSetGreet(text) {
        if (!text.trim()) return '❌ Формат: /setgreet <текст>';
        this.config.autoGreetText = text.trim();
        this.addLog('greet', 'Текст обновлён');
        return `✅ Текст обновлён:\n\n<blockquote>${escapeHtml(this.config.autoGreetText)}</blockquote>`;
    }

    // ── Settings ─────────────────────────────────────────

    handleSet(argsStr) {
        const match = argsStr.match(/^(\S+)\s+(.+)$/s);
        if (!match) return '❌ Формат: /set <key> <value>';
        const [, key, value] = match;
        const numKeys = ['activityCheckMin', 'closingCheckMin', 'maxMessageLength', 'rateLimitMs', 'autoGreetDelay'];
        const boolKeys = ['autoGreetEnabled', 'forumMode'];
        if (numKeys.includes(key)) { this.config[key] = parseInt(value, 10); }
        else if (boolKeys.includes(key)) { this.config[key] = value === 'true' || value === '1' || value === 'on'; }
        else if (['ticketPrefix', 'closingPhrase', 'autoGreetText', 'shiftChannelId', 'ticketsCategoryId'].includes(key)) { this.config[key] = value.trim(); }
        else return `❌ Неизвестный ключ: ${key}`;
        this.addLog('settings', `${key} = ${value}`);
        return `✅ <b>${escapeHtml(key)}</b> = <code>${escapeHtml(value)}</code>`;
    }

    // ═══════════════════════════════════════════════════════
    //  SHIFTS
    // ═══════════════════════════════════════════════════════

    getShiftMeta(chatId) {
        const today = getKyivDate();
        const shiftState = this.getUserState(chatId).shift;
        const shiftMarkedToday = shiftState.lastShiftDate === today;
        const shiftClosedToday = shiftMarkedToday && !!shiftState.lastShiftClosed;
        const shiftStatus = shiftMarkedToday
            ? (shiftClosedToday ? 'closed_today' : 'active')
            : 'idle';
        const canStartShift = shiftStatus !== 'active';
        const canEndShift = shiftStatus === 'active';

        return {
            today,
            shiftState,
            shiftStatus,
            shiftMarkedToday,
            shiftClosedToday,
            canStartShift,
            canEndShift,
        };
    }

    async handleSmena(chatId) {
        const meta = this.getShiftMeta(chatId);
        const { today, shiftState, shiftStatus } = meta;
        if (shiftStatus === 'active') return '⚠️ Смена уже активна.';
        const dateStr = formatKyivDate();
        const content = `Начал\n1. ${dateStr}\n2. 12-0`;
        const chId = this.config.shiftChannelId;
        if (!chId) return '❌ Канал смены не настроен (shiftChannelId)';
        try {
            const res = await this.sendDiscordMessage(chId, content);
            if (!res.ok) return `❌ Ошибка Discord (${res.status})`;
            let msgId = null; try { msgId = JSON.parse(res.body).id; } catch { }
            shiftState.lastShiftMessageId = msgId;
            shiftState.lastShiftDate = today;
            shiftState.lastShiftClosed = false;
            shiftState.lastShiftContent = content;
            shiftState.closeReminderSentDate = null;
            this.markDirty();
            this.addLog('shift', `Смена начата (${dateStr})`);
            this.scheduleShiftReminder(); // arm close reminder
            return `✅ <b>Смена начата!</b>\n\n📅 ${escapeHtml(dateStr)}\n🕐 12-0`;
        } catch (e) { return `❌ ${e.message}`; }
    }

    async handleSmenoff(chatId) {
        const meta = this.getShiftMeta(chatId);
        const { shiftState, shiftStatus } = meta;
        if (shiftStatus !== 'active') return '❌ Нет активной смены сегодня.';
        const chId = this.config.shiftChannelId;
        if (!chId) return '❌ Канал смены не настроен';
        try {
            if (shiftState.lastShiftMessageId) {
                let oldContent = shiftState.lastShiftContent || `Начал\n1. ${formatKyivDate()}\n2. 12-0`;
                const newContent = oldContent.replace(/^Начал/, 'Начал/ Закрыл');
                const res = await this.editDiscordMessage(chId, shiftState.lastShiftMessageId, newContent);
                if (!res.ok) {
                    // Message was deleted or inaccessible — close shift anyway
                    this.log(`⚠️ Shift message edit failed (${res.status}), closing shift anyway`);
                }
            } else {
                this.log('⚠️ Shift close without message id, closing locally');
            }
        } catch (e) {
            this.log(`⚠️ Shift close edit error: ${e.message}, closing anyway`);
        }
        shiftState.lastShiftClosed = true;
        this.markDirty();
        this.addLog('shift', 'Смена закрыта');
        return `✅ <b>Смена закрыта!</b>`;
    }

    scheduleShiftReminder() {
        if (this.shiftReminderTimer) clearTimeout(this.shiftReminderTimer);
        const hour = getKyivHour();
        const today = getKyivDate();
        const chatId = String(this.config.tgChatId);
        const shiftState = this.getUserState(chatId).shift;

        if (shiftState.lastShiftDate === today) {
            // Already checked in → schedule close reminder + next day start
            this.scheduleShiftCloseReminder();
            const ms = msUntilKyivHour(11, 0);
            this.shiftReminderTimer = setTimeout(() => this.scheduleShiftReminder(), ms);
            return;
        }

        if (hour < 11) {
            const ms = msUntilKyivHour(11, 0);
            this.log(`📋 Shift start reminder in ${Math.round(ms / 60000)} min (11:00 Kyiv)`);
            this.shiftReminderTimer = setTimeout(async () => {
                const ss = this.getUserState(chatId).shift;
                if (ss.lastShiftDate !== getKyivDate() && ss.reminderSentDate !== getKyivDate()) {
                    ss.reminderSentDate = getKyivDate();
                    this.markDirty();
                    const keyboard = { inline_keyboard: [[{ text: '✅ Отметиться', callback_data: 'shift_checkin' }, { text: '⏭ Пропустить', callback_data: 'shift_skip' }]] };
                    await this.tgSendMessage(chatId, '🕚 <b>Пора отмечаться на смену!</b>\n\nВремя 11:00.', keyboard);
                }
                this.scheduleShiftReminder();
            }, ms);
        } else if (hour < 12) {
            const ms = msUntilKyivHour(12, 0);
            this.log(`📋 Shift late reminder in ${Math.round(ms / 60000)} min (12:00 Kyiv)`);
            this.shiftReminderTimer = setTimeout(async () => {
                const ss = this.getUserState(chatId).shift;
                if (ss.lastShiftDate !== getKyivDate() && ss.lateReminderSentDate !== getKyivDate()) {
                    ss.lateReminderSentDate = getKyivDate();
                    this.markDirty();
                    const keyboard = { inline_keyboard: [[{ text: '✅ Отметиться', callback_data: 'shift_checkin' }]] };
                    await this.tgSendMessage(chatId, '🚨 <b>Вы опаздываете на смену!</b>\n\nУже 12:00.', keyboard);
                }
                this.scheduleShiftReminder();
            }, ms);
        } else if (hour >= 23) {
            // At 23:00+ send close reminder if shift is open
            if (shiftState.lastShiftDate === today && !shiftState.lastShiftClosed && shiftState.closeReminderSentDate !== today) {
                shiftState.closeReminderSentDate = today;
                this.markDirty();
                const keyboard = { inline_keyboard: [[{ text: '🔒 Закрыть', callback_data: 'shift_close' }]] };
                this.tgSendMessage(chatId, '🕐 <b>Не забудьте закрыть смену!</b>\n\n/smenoff', keyboard);
            }
            const ms = msUntilKyivHour(11, 0);
            this.shiftReminderTimer = setTimeout(() => this.scheduleShiftReminder(), ms);
        } else {
            // Between 12:00-23:00 — user hasn't checked in, schedule next day start
            const ms = msUntilKyivHour(23, 0);
            this.shiftReminderTimer = setTimeout(() => this.scheduleShiftReminder(), ms);
        }
    }

    scheduleShiftCloseReminder() {
        if (this.shiftCloseReminderTimer) clearTimeout(this.shiftCloseReminderTimer);
        const hour = getKyivHour();
        const today = getKyivDate();
        const chatId = String(this.config.tgChatId);
        const shiftState = this.getUserState(chatId).shift;

        // Only schedule if shift is open and not yet reminded
        if (!shiftState.lastShiftDate || shiftState.lastShiftDate !== today) return;
        if (shiftState.lastShiftClosed) return;
        if (shiftState.closeReminderSentDate === today) return;

        if (hour >= 23) {
            // Send immediately
            shiftState.closeReminderSentDate = today;
            this.markDirty();
            const keyboard = { inline_keyboard: [[{ text: '🔒 Закрыть смену', callback_data: 'shift_close' }]] };
            this.tgSendMessage(chatId, '🕐 <b>Не забудьте закрыть смену!</b>\n\nУже 23:00. Закройте смену командой /smenoff.', keyboard);
            return;
        }

        const ms = msUntilKyivHour(23, 0);
        this.log(`📋 Shift close reminder in ${Math.round(ms / 60000)} min (23:00 Kyiv)`);
        this.shiftCloseReminderTimer = setTimeout(() => {
            const ss = this.getUserState(chatId).shift;
            const todayNow = getKyivDate();
            if (ss.lastShiftDate === todayNow && !ss.lastShiftClosed && ss.closeReminderSentDate !== todayNow) {
                ss.closeReminderSentDate = todayNow;
                this.markDirty();
                const keyboard = { inline_keyboard: [[{ text: '🔒 Закрыть смену', callback_data: 'shift_close' }]] };
                this.tgSendMessage(chatId, '🕐 <b>Не забудьте закрыть смену!</b>\n\nУже 23:00. Закройте смену командой /smenoff.', keyboard);
            }
        }, ms);
    }

    // ═══════════════════════════════════════════════════════
    //  ACTIVITY TIMERS
    // ═══════════════════════════════════════════════════════

    clearNoReplyTimer(channelId) {
        const t = this.noReplyTimers.get(channelId);
        if (t) { clearTimeout(t); this.noReplyTimers.delete(channelId); }
        const record = this.activeTickets.get(channelId);
        if (record?.waitingForReply) { record.waitingForReply = false; record.activityTimerType = null; this.markDirty(); }
    }

    startActivityTimer(channelId, type) {
        const timeoutMin = type === 'closing' ? (this.config.closingCheckMin || 15) : (this.config.activityCheckMin || 10);
        if (timeoutMin <= 0) return;
        this.clearNoReplyTimer(channelId);
        const record = this.activeTickets.get(channelId);
        if (!record) return;
        record.lastStaffMessageAt = Date.now();
        record.waitingForReply = true;
        record.activityTimerType = type;
        this.markDirty();
        const timer = setTimeout(() => {
            this.noReplyTimers.delete(channelId);
            record.waitingForReply = false;
            record.activityTimerType = null;
            this.markDirty();
            if (!this.botPaused) this.enqueue({ ...buildActivityMessage(record, type, timeoutMin), channelId });
        }, timeoutMin * 60 * 1000);
        this.noReplyTimers.set(channelId, timer);
    }

    restoreActivityTimers() {
        let restored = 0;
        for (const [channelId, record] of this.activeTickets) {
            if (!record.waitingForReply || !record.lastStaffMessageAt) continue;
            const type = record.activityTimerType || 'regular';
            const timeoutMin = type === 'closing' ? (this.config.closingCheckMin || 15) : (this.config.activityCheckMin || 10);
            const elapsed = Date.now() - record.lastStaffMessageAt;
            const totalMs = timeoutMin * 60 * 1000;
            if (elapsed >= totalMs) {
                record.waitingForReply = false; record.activityTimerType = null; this.markDirty();
                this.enqueue({ ...buildActivityMessage(record, type, timeoutMin), channelId });
            } else {
                const timer = setTimeout(() => { this.noReplyTimers.delete(channelId); record.waitingForReply = false; record.activityTimerType = null; this.markDirty(); this.enqueue({ ...buildActivityMessage(record, type, timeoutMin), channelId }); }, totalMs - elapsed);
                this.noReplyTimers.set(channelId, timer);
            }
            restored++;
        }
        if (restored > 0) this.log(`⏰ Restored ${restored} activity timers`);
    }

    // ═══════════════════════════════════════════════════════
    //  ARCHIVES
    // ═══════════════════════════════════════════════════════

    async archiveTicketMessages(channelId, record) {
        try {
            const messages = await this.fetchChannelMessages(channelId, 100);
            if (!messages?.length) return;
            const mapped = messages.reverse().map(m => ({ id: m.id, content: m.content || '', author: { id: m.author?.id, username: m.author?.username, global_name: m.author?.global_name, avatar: m.author?.avatar, bot: m.author?.bot || false }, timestamp: m.timestamp, embeds: m.embeds || [], attachments: m.attachments || [], member: m.member }));
            try { this.dbInsertMessages(channelId, mapped); } catch (e) { this.log(`Archive DB error: ${e.message}`); }
        } catch (e) { this.log(`Archive error: ${e.message}`); }
    }

    async snapshotAllActiveTickets() {
        for (const [chId, record] of this.activeTickets) {
            try { await this.archiveTicketMessages(chId, record); await sleep(500); } catch { }
        }
    }

    // ═══════════════════════════════════════════════════════
    //  DASHBOARD DATA (exposed for server.js API routes)
    // ═══════════════════════════════════════════════════════

    getActiveTicketsArray() {
        return Array.from(this.activeTickets.values()).map(r => ({ ...r, priority: r.channelName?.toLowerCase().includes('urgent') ? 'high' : 'normal' }));
    }

    getStats() {
        return { totalCreated: this.ps.totalCreated, totalClosed: this.ps.totalClosed, hourlyBuckets: this.ps.hourlyBuckets, activeTicketsCount: this.activeTickets.size, uptime: process.uptime(), closedTickets: this.dbGetClosedTickets({ page: 1, limit: 50 }).tickets };
    }

    getBinds() { return Object.values(this.config.binds || {}); }

    getUsers() {
        const chatId = String(this.config.tgChatId);
        const meta = this.getShiftMeta(chatId);
        const st = meta.shiftState;
        return [{
            id: chatId,
            name: this.config.userName || 'User',
            shiftActive: meta.shiftStatus === 'active',
            shiftStatus: meta.shiftStatus,
            canStartShift: meta.canStartShift,
            canEndShift: meta.canEndShift,
            shiftMarkedToday: meta.shiftMarkedToday,
            shiftClosedToday: meta.shiftClosedToday,
            lastShiftDate: st.lastShiftDate || null,
            lastShiftClosed: !!st.lastShiftClosed,
        }];
    }

    getLogs(limit = 50) {
        return this.dashboardLogs.slice(0, limit).map(l => {
            const ts = l.ts || (l.timestamp ? new Date(l.timestamp).toISOString() : new Date().toISOString());
            return { ...l, ts };
        });
    }

    getSettings() {
        return {
            telegramEnabled: this.config.telegramEnabled !== false,
            autoGreetEnabled: this.config.autoGreetEnabled,
            autoGreetText: this.config.autoGreetText || '',
            activityCheckMin: this.config.activityCheckMin || 10,
            closingCheckMin: this.config.closingCheckMin || 15,
            maxMessageLength: this.config.maxMessageLength || 300,
            ticketPrefix: this.config.ticketPrefix || '',
            closingPhrase: this.config.closingPhrase || '',
            forumMode: this.config.forumMode || false,
            includeFirstUserMessage: this.config.includeFirstUserMessage || false,
            notifyOnClose: this.config.notifyOnClose || false,
            mentionOnHighPriority: this.config.mentionOnHighPriority || false,
            pollingIntervalSec: this.config.pollingIntervalSec || 3,
            rateLimitMs: this.config.rateLimitMs || 200,
            priorityKeywords: this.config.priorityKeywords || [],
            ticketsCategoryId: this.config.ticketsCategoryId || '',
            shiftChannelId: this.config.shiftChannelId || '',
            autoGreetAllChannels: this.config.autoGreetAllChannels || false,
            staffRoleIds: this.config.staffRoleIds || [],
            autoGreetRoleIds: this.config.autoGreetRoleIds || [],
            geminiApiKeys: this.config.geminiApiKeys || [],
            neuroCustomInstructions: this.config.neuroCustomInstructions || [],
            neuroCustomInstructions: this.config.neuroCustomInstructions || [],
        };
    }

    updateSettings(settings) {
        const allowedKeys = [
            'telegramEnabled', 'autoGreetEnabled', 'autoGreetText', 'activityCheckMin', 'closingCheckMin',
            'maxMessageLength', 'ticketPrefix', 'closingPhrase', 'forumMode',
            'includeFirstUserMessage', 'notifyOnClose', 'mentionOnHighPriority',
            'pollingIntervalSec', 'rateLimitMs', 'priorityKeywords', 'ticketsCategoryId',
            'shiftChannelId', 'autoGreetAllChannels', 'staffRoleIds', 'autoGreetRoleIds', 'geminiApiKeys',
            'neuroCustomInstructions',
            'neuroCustomInstructions'
        ];
        const arrayKeysComma = ['priorityKeywords', 'staffRoleIds', 'autoGreetRoleIds'];
        const arrayKeysNewline = ['geminiApiKeys'];

        for (const [k, v] of Object.entries(settings)) {
            if (allowedKeys.includes(k)) {
                if (arrayKeysComma.includes(k) && typeof v === 'string') {
                    this.config[k] = v.split(',').map(x => x.trim()).filter(Boolean);
                } else if (k === 'neuroCustomInstructions' && Array.isArray(v)) {
                    this.config[k] = v.map(x => String(x).trim()).filter(Boolean);
                } else if (k === 'neuroCustomInstructions' && Array.isArray(v)) {
                    this.config[k] = v.map(x => String(x).trim()).filter(Boolean);
                } else if (arrayKeysNewline.includes(k) && typeof v === 'string') {
                    this.config[k] = v.split('\n').map(x => x.trim()).filter(Boolean);
                } else {
                    this.config[k] = v;
                }
            }
        }
        this.addLog('settings', 'Настройки обновлены');
    }

    getAutoReplies() { return this.config.autoReplies || []; }
    updateAutoReplies(rules) { this.config.autoReplies = rules; this.addLog('autoreplies', `Обновлено ${rules.length} правил`); }

    simulateAutoReply({ content = '', channelId = '', guildId = '' }) {
        return evaluateAutoReplyDecision({
            rules: this.config.autoReplies || [],
            content,
            channelId: String(channelId || ''),
            guildId: String(guildId || this.config.guildId || ''),
            source: 'simulator',
        });
    }

    getMembers() {
        const now = Date.now();
        if (this._membersCache && (now - (this._membersCacheAt || 0)) < 2000) {
            return this._membersCache;
        }

        const roleMap = {};
        for (const [id, r] of this.guildRolesCache) roleMap[id] = { id: r.id, name: r.name, color: r.color, position: r.position, hoist: r.hoist };
        const groups = {};
        const fallbackGroupId = '__ungrouped__';

        const toColor = (decimal) => {
            if (!decimal) return '#99aab5';
            return `#${Number(decimal).toString(16).padStart(6, '0')}`;
        };

        const getFallbackAvatar = (userId) => {
            let idx = 0;
            try { idx = Number(BigInt(userId) % 6n); } catch { }
            return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
        };

        const normalizePresence = (presence) => {
            if (!presence) return { status: 'offline', customStatus: null, activityText: null, activityObj: null };
            if (typeof presence === 'string') return { status: presence || 'offline', customStatus: null, activityText: null, activityObj: null };
            return {
                status: presence.status || 'offline',
                customStatus: presence.customStatus || null,
                activityText: presence.activityText || null,
                activityObj: presence.activityObj || null,
            };
        };

        for (const [uid, member] of this.guildMembersCache) {
            if (member.user?.bot) continue;
            let bestRole = null;
            for (const rid of (member.roles || [])) {
                const role = roleMap[rid];
                if (role?.hoist && (!bestRole || role.position > bestRole.position)) bestRole = role;
            }
            const groupRole = bestRole || { id: fallbackGroupId, name: 'Участники', color: 0, position: -99999 };
            if (!groups[groupRole.id]) {
                groups[groupRole.id] = {
                    roleId: groupRole.id,
                    roleName: groupRole.name,
                    roleColor: toColor(groupRole.color),
                    position: groupRole.position,
                    members: []
                };
            }
            const avatarHash = member.avatar || member.user?.avatar;
            const id = member.user?.id || uid;
            const presence = normalizePresence(this.guildPresenceCache.get(id));
            groups[groupRole.id].members.push({
                id,
                username: member.user?.username || '',
                displayName: member.nick || member.user?.global_name || member.user?.username || id,
                avatar: avatarHash ? `https://cdn.discordapp.com/avatars/${id}/${avatarHash}.png?size=64` : getFallbackAvatar(id),
                status: presence.status,
                customStatus: presence.customStatus,
                activityText: presence.activityText,
                activityObj: presence.activityObj, // Added complex rich presence
                nameColor: bestRole?.color ? toColor(bestRole.color) : null,
            });
        }
        const result = Object.values(groups)
            .sort((a, b) => b.position - a.position)
            .map(g => ({
                ...g,
                members: g.members.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '', 'ru'))
            }));
        this._membersCache = result;
        this._membersCacheAt = now;
        return result;
    }
}

module.exports = Bot;
