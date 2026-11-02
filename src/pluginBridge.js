// ═══════════════════════════════════════════════════════════════
//  Plugin Bridge — WebSocket server for Vencord plugin
//  Replaces relay.js: NO direct Discord connection
//  Ubuntu backend ←→ Vencord plugin (real Discord client)
// ═══════════════════════════════════════════════════════════════

const WebSocket = require('ws');
const crypto = require('crypto');

const LOG = '[PluginBridge]';
const PLUGIN_SECRET = process.env.PLUGIN_SECRET || '';

/**
 * Sets up the Plugin Bridge WebSocket server.
 * @param {http.Server} httpServer
 * @param {BotManager} botManager
 */
function setupPluginBridge(httpServer, botManager) {
    if (Buffer.byteLength(PLUGIN_SECRET, 'utf8') < 32) {
        throw new Error('PLUGIN_SECRET must be configured with at least 32 bytes before starting the plugin bridge');
    }

    const wss = new WebSocket.Server({ noServer: true });

    // Handle HTTP upgrade for /plugin-bridge path
    httpServer.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        if (url.pathname !== '/plugin-bridge') return;

        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
        });
    });

    wss.on('connection', (ws) => {
        const authTimeout = setTimeout(() => ws.close(1008, 'Authentication required'), 5000);
        ws.once('close', () => clearTimeout(authTimeout));
        ws.once('message', (raw) => {
            let msg;
            try { msg = JSON.parse(raw); } catch {
                clearTimeout(authTimeout);
                ws.close(1008, 'Invalid authentication');
                return;
            }
            if (msg?.type !== 'auth' || !isSecretMatch(msg.secret, PLUGIN_SECRET)) {
                clearTimeout(authTimeout);
                console.log(`${LOG} ❌ Plugin auth failed`);
                ws.close(1008, 'Authentication failed');
                return;
            }

            clearTimeout(authTimeout);
            sendToPlugin(ws, { type: 'auth_ok' });
            activatePluginConnection(ws, botManager);
        });
        ws.on('error', (e) => console.log(`${LOG} ❌ Plugin error: ${e.message}`));
    });

    console.log(`${LOG} ✅ Plugin Bridge WebSocket server ready on /plugin-bridge`);
}

function isSecretMatch(candidate, expected) {
    if (typeof candidate !== 'string') return false;
    const candidateBuffer = Buffer.from(candidate, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    return candidateBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
}

function activatePluginConnection(ws, botManager) {
    console.log(`${LOG} ✅ Vencord plugin connected`);
    const bot = getFirstBot(botManager);
    if (!bot) {
        console.log(`${LOG} ❌ No bot instance found`);
        ws.close(1008, 'No bot instance');
        return;
    }

    bot._pluginWs = ws;
    bot._pluginConnected = true;
    bot._pluginConnectedAt = Date.now();

    if (bot._relayFailoverTimer) {
        clearTimeout(bot._relayFailoverTimer);
        bot._relayFailoverTimer = null;
    }

    if (bot.ws) {
        console.log(`${LOG} 🔄 Disconnecting direct Gateway — plugin takes over`);
        bot._relayMode = true;
        try { bot.ws.close(1000); } catch { }
        const { cleanupGateway } = require('./bot/gateway');
        cleanupGateway(bot);
    }

    bot.log('🔗 PluginBridge: Vencord plugin connected — using real client');
    sendToPlugin(ws, {
        type: 'config',
        data: {
            guildId: bot.config.guildId || '',
            ticketsCategoryId: bot.config.ticketsCategoryId || '',
            ticketPrefix: bot.config.ticketPrefix || 'тикет-от',
            staffRoleIds: bot.config.staffRoleIds || [],
            priorityKeywords: bot.config.priorityKeywords || [],
            autoRepliesEnabled: bot.config.autoRepliesEnabled !== false,
            autoGreetEnabled: bot.config.autoGreetEnabled || false,
            autoGreetText: bot.config.autoGreetText || '',
            autoGreetDelay: bot.config.autoGreetDelay || 3,
            binds: bot.config.binds || {},
            autoReplies: bot.config.autoReplies || [],
            botReplyGuildIds: bot.config.botReplyGuildIds || [],
            closingPhrase: bot.config.closingPhrase || '',
            forumMode: bot.config.forumMode || false,
        }
    });

    if (!bot._pluginPendingActions) bot._pluginPendingActions = new Map();
    let reqCounter = 0;
    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        handlePluginMessage(bot, ws, msg);
    });

    const pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
    }, 30_000);

    ws.on('close', (code) => {
        console.log(`${LOG} 🔌 Vencord plugin disconnected (${code})`);
        bot.log(`⚠️ PluginBridge: plugin disconnected (${code})`);
        clearInterval(pingTimer);
        if (bot._pluginWs === ws) {
            bot._pluginWs = null;
            bot._pluginConnected = false;
            if (bot._pluginPendingActions) {
                for (const pending of bot._pluginPendingActions.values()) {
                    pending.resolve({ ok: false, status: 0, body: 'plugin_disconnected' });
                }
                bot._pluginPendingActions.clear();
            }
            bot.emitToDashboard('plugin:status', { connected: false });
        }
    });

    bot._pluginSendCommand = function (command) {
        return new Promise((resolve) => {
            if (!bot._pluginWs || bot._pluginWs.readyState !== WebSocket.OPEN) {
                return resolve({ ok: false, status: 0, body: 'plugin_not_connected' });
            }
            const reqId = `p_${++reqCounter}_${Date.now()}`;
            command.reqId = reqId;
            const timeout = setTimeout(() => {
                bot._pluginPendingActions.delete(reqId);
                resolve({ ok: false, status: 0, body: 'plugin_timeout' });
            }, 15_000);
            bot._pluginPendingActions.set(reqId, {
                resolve: (result) => {
                    clearTimeout(timeout);
                    resolve(result);
                }
            });
            bot._pluginWs.send(JSON.stringify(command));
        });
    };

    bot._relaySendCommand = bot._pluginSendCommand;
    bot._relayMode = true;
    bot._relayPendingRequests = bot._pluginPendingActions;
    bot.emitToDashboard('plugin:status', { connected: true });
}

// ── Handle messages from plugin ──────────────────────────────

function handlePluginMessage(bot, ws, msg) {
    switch (msg.type) {
        case 'auth':
            console.log(`${LOG} 🔑 Plugin authenticated (mode: ${msg.mode || 'vencord'})`);
            sendToPlugin(ws, { type: 'auth_ok' });
            break;

        case 'event': {
            // Forward Discord dispatch events to bot's handler
            const { handleDispatchRelay } = require('./bot/gateway');
            if (typeof handleDispatchRelay === 'function' && msg.name && msg.data) {
                handleDispatchRelay(bot, msg.name, msg.data);
            }
            break;
        }

        case 'action_result': {
            // Resolve pending action
            const pending = bot._pluginPendingActions?.get(msg.reqId);
            if (pending) {
                bot._pluginPendingActions.delete(msg.reqId);
                pending.resolve({ ok: msg.ok, status: msg.status || 200, body: msg.body || '' });
            }
            break;
        }

        case 'pong':
            bot._pluginLastPong = msg.ts;
            break;

        case 'config_request':
            // Plugin is requesting fresh config
            sendToPlugin(ws, {
                type: 'config',
                data: {
                    guildId: bot.config.guildId || '',
                    ticketsCategoryId: bot.config.ticketsCategoryId || '',
                    ticketPrefix: bot.config.ticketPrefix || 'тикет-от',
                    staffRoleIds: bot.config.staffRoleIds || [],
                    priorityKeywords: bot.config.priorityKeywords || [],
                    autoRepliesEnabled: bot.config.autoRepliesEnabled !== false,
                    autoGreetEnabled: bot.config.autoGreetEnabled || false,
                    autoGreetText: bot.config.autoGreetText || '',
                    binds: bot.config.binds || {},
                    autoReplies: bot.config.autoReplies || [],
                }
            });
            break;
    }
}

function sendToPlugin(ws, data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try { ws.send(JSON.stringify(data)); return true; } catch { return false; }
}

function getFirstBot(botManager) {
    if (!botManager?.bots?.size) return null;
    return botManager.bots.values().next().value;
}

module.exports = { setupPluginBridge };
