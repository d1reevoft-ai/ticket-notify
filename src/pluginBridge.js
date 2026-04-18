// ═══════════════════════════════════════════════════════════════
//  Plugin Bridge — WebSocket server for Vencord plugin
//  Replaces relay.js: NO direct Discord connection
//  Ubuntu backend ←→ Vencord plugin (real Discord client)
// ═══════════════════════════════════════════════════════════════

const WebSocket = require('ws');

const LOG = '[PluginBridge]';
const PLUGIN_SECRET = process.env.PLUGIN_SECRET || 'ticket-notifier-plugin-2026';

/**
 * Sets up the Plugin Bridge WebSocket server.
 * @param {http.Server} httpServer
 * @param {BotManager} botManager
 */
function setupPluginBridge(httpServer, botManager) {
    const wss = new WebSocket.Server({ noServer: true });

    // Handle HTTP upgrade for /plugin-bridge path
    httpServer.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        if (url.pathname !== '/plugin-bridge') return;

        const secret = url.searchParams.get('secret') || '';
        if (secret !== PLUGIN_SECRET) {
            console.log(`${LOG} ❌ Plugin auth failed (bad secret)`);
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
        });
    });

    wss.on('connection', (ws) => {
        console.log(`${LOG} ✅ Vencord plugin connected`);

        const bot = getFirstBot(botManager);
        if (!bot) {
            console.log(`${LOG} ❌ No bot instance found`);
            ws.close(1008, 'No bot instance');
            return;
        }

        // ── Set plugin mode on bot ──
        bot._pluginWs = ws;
        bot._pluginConnected = true;
        bot._pluginConnectedAt = Date.now();

        // Cancel any old relay failover
        if (bot._relayFailoverTimer) {
            clearTimeout(bot._relayFailoverTimer);
            bot._relayFailoverTimer = null;
        }

        // Disconnect any direct Gateway connection (not needed with plugin)
        if (bot.ws) {
            console.log(`${LOG} 🔄 Disconnecting direct Gateway — plugin takes over`);
            bot._relayMode = true; // Prevents Gateway auto-reconnect
            try { bot.ws.close(1000); } catch { }
            const { cleanupGateway } = require('./bot/gateway');
            cleanupGateway(bot);
        }

        bot.log('🔗 PluginBridge: Vencord plugin connected — using real client');

        // Send config to plugin
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

        // Pending action callbacks
        if (!bot._pluginPendingActions) bot._pluginPendingActions = new Map();
        let _reqCounter = 0;

        // ── Receive events from Vencord plugin ──
        ws.on('message', (raw) => {
            let msg;
            try { msg = JSON.parse(raw); } catch { return; }
            handlePluginMessage(bot, ws, msg);
        });

        // ── Health check ping ──
        const pingTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
            }
        }, 30_000);

        // ── Plugin disconnected ──
        ws.on('close', (code) => {
            console.log(`${LOG} 🔌 Vencord plugin disconnected (${code})`);
            bot.log(`⚠️ PluginBridge: plugin disconnected (${code})`);
            clearInterval(pingTimer);
            bot._pluginWs = null;
            bot._pluginConnected = false;

            // Reject pending actions
            if (bot._pluginPendingActions) {
                for (const [id, pending] of bot._pluginPendingActions) {
                    pending.resolve({ ok: false, status: 0, body: 'plugin_disconnected' });
                }
                bot._pluginPendingActions.clear();
            }

            // NOTE: We do NOT fall back to direct Gateway anymore — that's the whole point!
            // Bot stays in passive mode until plugin reconnects.
            bot.emitToDashboard('plugin:status', { connected: false });
        });

        ws.on('error', (e) => {
            console.log(`${LOG} ❌ Plugin error: ${e.message}`);
        });

        // ── Expose command sender to bot ──
        bot._pluginSendCommand = function (command) {
            return new Promise((resolve) => {
                if (!bot._pluginWs || bot._pluginWs.readyState !== WebSocket.OPEN) {
                    return resolve({ ok: false, status: 0, body: 'plugin_not_connected' });
                }
                const reqId = `p_${++_reqCounter}_${Date.now()}`;
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

        // Also set as relay sender so existing Bot.js sendDiscordMessage works
        bot._relaySendCommand = bot._pluginSendCommand;
        bot._relayMode = true;
        bot._relayPendingRequests = bot._pluginPendingActions;

        // Notify dashboard
        bot.emitToDashboard('plugin:status', { connected: true });
    });

    console.log(`${LOG} ✅ Plugin Bridge WebSocket server ready on /plugin-bridge`);
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
