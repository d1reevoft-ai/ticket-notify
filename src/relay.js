// ═══════════════════════════════════════════════════════════════
//  Relay Bridge — accepts stealth client connections
//  Handles failover: relay connected → use relay, disconnected → direct Gateway
// ═══════════════════════════════════════════════════════════════

const WebSocket = require('ws');
const { connectGateway, cleanupGateway } = require('./bot/gateway');

const LOG = '[Relay]';
const RELAY_SECRET = process.env.RELAY_SECRET || 'stealth-relay-secret-2026';
const FAILOVER_DELAY_MS = 30_000; // Wait 30s before falling back to direct Gateway

/**
 * Sets up the relay WebSocket server on the existing HTTP server.
 * @param {http.Server} httpServer 
 * @param {BotManager} botManager 
 */
function setupRelay(httpServer, botManager) {
    const wss = new WebSocket.Server({ noServer: true });

    // Handle HTTP upgrade for /relay path
    httpServer.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        if (url.pathname !== '/relay') return; // Let Socket.io handle other upgrades

        const secret = url.searchParams.get('secret') || '';
        if (secret !== RELAY_SECRET) {
            console.log(`${LOG} ❌ Relay auth failed (bad secret)`);
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
        });
    });

    wss.on('connection', (ws) => {
        console.log(`${LOG} ✅ Stealth client connected`);

        // Find the bot to attach relay to (first bot for now)
        const bot = getFirstBot(botManager);
        if (!bot) {
            console.log(`${LOG} ❌ No bot instance found`);
            ws.close(1008, 'No bot instance');
            return;
        }

        // Cancel any pending failover timer
        if (bot._relayFailoverTimer) {
            clearTimeout(bot._relayFailoverTimer);
            bot._relayFailoverTimer = null;
        }

        // Disconnect Railway's own Gateway connection
        if (bot.ws) {
            console.log(`${LOG} 🔄 Disconnecting Railway Gateway — relay takes over`);
            bot._relayMode = true;
            try { bot.ws.close(1000); } catch { }
            cleanupGateway(bot);
        }

        bot._relayWs = ws;
        bot._relayMode = true;
        bot._relayConnectedAt = Date.now();
        bot.log('🔗 Relay: stealth client connected — using residential IP');

        // Pending REST request callbacks
        if (!bot._relayPendingRequests) bot._relayPendingRequests = new Map();
        let _reqCounter = 0;

        // ── Receive events from stealth client ──
        ws.on('message', (raw) => {
            let msg;
            try { msg = JSON.parse(raw); } catch { return; }

            switch (msg.type) {
                case 'auth':
                    console.log(`${LOG} 🔑 Relay authenticated`);
                    break;

                case 'dispatch': {
                    // Forward Gateway dispatch events to bot's handler
                    const { handleDispatchRelay } = require('./bot/gateway');
                    if (typeof handleDispatchRelay === 'function') {
                        handleDispatchRelay(bot, msg.event, msg.data);
                    }
                    break;
                }

                case 'sendMessageResult':
                case 'editMessageResult':
                case 'deleteMessageResult':
                case 'fetchMessagesResult':
                case 'fetchChannelsResult':
                case 'sendInteractionResult': {
                    // Resolve pending REST request
                    const pending = bot._relayPendingRequests.get(msg.reqId);
                    if (pending) {
                        bot._relayPendingRequests.delete(msg.reqId);
                        pending.resolve({ ok: msg.ok, status: msg.status, body: msg.body });
                    }
                    break;
                }

                case 'pong':
                    bot._relayLastPong = msg.ts;
                    break;
            }
        });

        // ── Health check ping ──
        const pingTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30_000);

        // ── Relay disconnected — failover to direct Gateway ──
        ws.on('close', (code) => {
            console.log(`${LOG} 🔌 Stealth client disconnected (${code})`);
            bot.log(`⚠️ Relay: stealth client disconnected (${code}) — failover in ${FAILOVER_DELAY_MS / 1000}s`);
            clearInterval(pingTimer);
            bot._relayWs = null;

            // Reject any pending requests
            for (const [id, pending] of bot._relayPendingRequests) {
                pending.resolve({ ok: false, status: 0, body: 'relay_disconnected' });
            }
            bot._relayPendingRequests.clear();

            // Schedule failover to direct Gateway
            bot._relayFailoverTimer = setTimeout(() => {
                bot._relayFailoverTimer = null;
                if (!bot._relayWs && !bot.destroyed) {
                    bot._relayMode = false;
                    bot.log('🔄 Relay: failover — connecting Railway Gateway directly');
                    connectGateway(bot);
                }
            }, FAILOVER_DELAY_MS);
        });

        ws.on('error', (e) => {
            console.log(`${LOG} ❌ Relay error: ${e.message}`);
        });

        // ── Expose relay command sender ──
        bot._relaySendCommand = function (command) {
            return new Promise((resolve) => {
                if (!bot._relayWs || bot._relayWs.readyState !== WebSocket.OPEN) {
                    return resolve({ ok: false, status: 0, body: 'relay_not_connected' });
                }
                const reqId = `r_${++_reqCounter}_${Date.now()}`;
                command.reqId = reqId;

                // Set timeout for command response
                const timeout = setTimeout(() => {
                    bot._relayPendingRequests.delete(reqId);
                    resolve({ ok: false, status: 0, body: 'relay_timeout' });
                }, 15_000);

                bot._relayPendingRequests.set(reqId, {
                    resolve: (result) => {
                        clearTimeout(timeout);
                        resolve(result);
                    }
                });

                bot._relayWs.send(JSON.stringify(command));
            });
        };
    });

    console.log(`${LOG} ✅ Relay WebSocket server ready on /relay`);
}

function getFirstBot(botManager) {
    if (!botManager?.bots?.size) return null;
    return botManager.bots.values().next().value;
}

module.exports = { setupRelay };
