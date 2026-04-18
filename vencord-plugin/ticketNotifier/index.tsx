/*
 * Vencord Plugin: Ticket Notifier
 * Monitors Discord ticket channels and communicates with Ubuntu backend.
 * All Discord interaction happens through the REAL client — zero ban risk.
 *
 * Install: Copy this folder to:
 *   %APPDATA%/Vencord/dist/userplugins/ticketNotifier/
 *   Then restart Discord.
 */

import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, RestAPI, ChannelStore, GuildStore, UserStore } from "@webpack/common";
import { showNotification } from "@api/Notifications";
import { Settings } from "@api/Settings";

// ── Bridge state ─────────────────────────────────────────────
let bridge: WebSocket | null = null;
let bridgeReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let bridgeConnected = false;
let config: PluginConfig | null = null;
let selfUserId: string = "";

interface PluginConfig {
    guildId: string;
    ticketsCategoryId: string;
    ticketPrefix: string;
    staffRoleIds: string[];
    priorityKeywords: string[];
    autoRepliesEnabled: boolean;
    autoGreetEnabled: boolean;
    autoGreetText: string;
    autoGreetDelay: number;
    binds: Record<string, any>;
    autoReplies: any[];
    botReplyGuildIds?: string[];
    closingPhrase?: string;
    forumMode?: boolean;
}

interface BridgeAction {
    type: string;
    reqId?: string;
    name?: string;
    channelId?: string;
    messageId?: string;
    content?: string;
    replyTo?: string;
    emoji?: string;
    delay?: number;
}

// ── WebSocket Bridge ─────────────────────────────────────────

function connectBridge() {
    const settings = Settings.plugins?.TicketNotifier;
    const serverUrl = settings?.serverUrl || "ws://192.168.1.100:3000";
    const secret = settings?.pluginSecret || "ticket-notifier-plugin-2026";

    if (bridgeReconnectTimer) {
        clearTimeout(bridgeReconnectTimer);
        bridgeReconnectTimer = null;
    }

    const wsUrl = `${serverUrl.replace(/^http/, "ws")}/plugin-bridge?secret=${encodeURIComponent(secret)}`;

    try {
        bridge = new WebSocket(wsUrl);
    } catch (e) {
        console.log("[TicketNotifier] ❌ Bridge connect error:", e);
        scheduleBridgeReconnect();
        return;
    }

    bridge.onopen = () => {
        console.log("[TicketNotifier] ✅ Connected to Ubuntu backend");
        bridgeConnected = true;
        bridge!.send(JSON.stringify({ type: "auth", secret, mode: "vencord" }));
    };

    bridge.onmessage = (event) => {
        let msg: any;
        try { msg = JSON.parse(event.data as string); } catch { return; }
        handleBridgeMessage(msg);
    };

    bridge.onclose = (event) => {
        console.log(`[TicketNotifier] 🔌 Bridge disconnected (${event.code})`);
        bridgeConnected = false;
        bridge = null;
        scheduleBridgeReconnect();
    };

    bridge.onerror = (e) => {
        console.log("[TicketNotifier] ❌ Bridge error:", e);
    };
}

function scheduleBridgeReconnect() {
    if (bridgeReconnectTimer) return;
    bridgeReconnectTimer = setTimeout(() => {
        bridgeReconnectTimer = null;
        connectBridge();
    }, 5000);
}

function sendToBridge(data: any) {
    if (!bridge || bridge.readyState !== WebSocket.OPEN) return false;
    try { bridge.send(JSON.stringify(data)); return true; } catch { return false; }
}

// ── Handle messages from Ubuntu backend ──────────────────────

async function handleBridgeMessage(msg: any) {
    switch (msg.type) {
        case "auth_ok":
            console.log("[TicketNotifier] 🔑 Authenticated with backend");
            break;

        case "config":
            config = msg.data as PluginConfig;
            console.log(`[TicketNotifier] 📋 Config received (guild: ${config.guildId}, prefix: ${config.ticketPrefix})`);
            break;

        case "action":
            await executeAction(msg as BridgeAction);
            break;

        case "ping":
            sendToBridge({ type: "pong", ts: Date.now() });
            break;
    }
}

// ── Execute actions from backend (send message, typing, etc) ─

async function executeAction(action: BridgeAction) {
    const reqId = action.reqId;

    try {
        switch (action.name) {
            case "send_message": {
                // Humanized typing delay
                if (action.delay && action.delay > 0) {
                    // Trigger typing indicator
                    try {
                        await RestAPI.post({ url: `/channels/${action.channelId}/typing` });
                    } catch { }
                    await sleep(action.delay);
                }

                const body: any = { content: action.content };
                if (action.replyTo) {
                    body.message_reference = { message_id: action.replyTo };
                }

                const res = await RestAPI.post({
                    url: `/channels/${action.channelId}/messages`,
                    body
                });

                sendToBridge({
                    type: "action_result",
                    reqId,
                    ok: true,
                    status: 200,
                    body: JSON.stringify(res.body)
                });
                break;
            }

            case "edit_message": {
                const res = await RestAPI.patch({
                    url: `/channels/${action.channelId}/messages/${action.messageId}`,
                    body: { content: action.content }
                });
                sendToBridge({ type: "action_result", reqId, ok: true, status: 200, body: JSON.stringify(res.body) });
                break;
            }

            case "delete_message": {
                await RestAPI.del({
                    url: `/channels/${action.channelId}/messages/${action.messageId}`
                });
                sendToBridge({ type: "action_result", reqId, ok: true, status: 200, body: "" });
                break;
            }

            case "trigger_typing": {
                await RestAPI.post({ url: `/channels/${action.channelId}/typing` });
                break;
            }

            case "add_reaction": {
                await RestAPI.put({
                    url: `/channels/${action.channelId}/messages/${action.messageId}/reactions/${encodeURIComponent(action.emoji!)}/@me`,
                    body: {}
                });
                break;
            }

            case "fetch_messages": {
                const res = await RestAPI.get({
                    url: `/channels/${action.channelId}/messages?limit=100`
                });
                sendToBridge({
                    type: "action_result",
                    reqId,
                    ok: true,
                    status: 200,
                    body: JSON.stringify(res.body)
                });
                break;
            }
        }
    } catch (err: any) {
        console.log(`[TicketNotifier] ❌ Action "${action.name}" failed:`, err?.message || err);
        if (reqId) {
            sendToBridge({
                type: "action_result",
                reqId,
                ok: false,
                status: err?.status || 500,
                body: err?.message || "action_failed"
            });
        }
    }
}

// ── Discord Event Monitoring ─────────────────────────────────

function isTicketChannel(channel: any): boolean {
    if (!config) return false;
    const name = (channel?.name || "").toLowerCase();
    const prefix = (config.ticketPrefix || "тикет-от").toLowerCase();

    // Check by prefix
    if (name.startsWith(prefix)) return true;

    // Check by category
    if (config.ticketsCategoryId && channel?.parent_id === config.ticketsCategoryId) return true;

    return false;
}

function isTargetGuild(guildId: string): boolean {
    if (!config || !config.guildId) return false;
    return guildId === config.guildId;
}

function onMessageCreate(event: any) {
    if (!bridgeConnected || !config) return;
    const { message, channelId } = event;
    if (!message || !channelId) return;

    // Ignore own messages
    if (message.author?.id === selfUserId) return;

    // Get channel info
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return;

    // Check if it's in our target guild
    if (!isTargetGuild(channel.guild_id)) return;

    // Forward to backend — it will decide what to do
    // For ticket channels, send full data
    if (isTicketChannel(channel)) {
        sendToBridge({
            type: "event",
            name: "MESSAGE_CREATE",
            data: {
                id: message.id,
                channel_id: channelId,
                guild_id: channel.guild_id,
                content: message.content || "",
                author: {
                    id: message.author?.id,
                    username: message.author?.username,
                    global_name: message.author?.globalName,
                    avatar: message.author?.avatar,
                    bot: message.author?.bot || false,
                },
                timestamp: message.timestamp,
                embeds: message.embeds || [],
                attachments: message.attachments || [],
                message_reference: message.message_reference || null,
                referenced_message: message.referenced_message ? {
                    id: message.referenced_message.id,
                    content: message.referenced_message.content,
                    author: {
                        id: message.referenced_message.author?.id,
                        username: message.referenced_message.author?.username,
                        bot: message.referenced_message.author?.bot || false,
                    }
                } : null,
                member: message.member ? {
                    roles: message.member.roles || [],
                    nick: message.member.nick,
                } : null,
            }
        });

        // Show toast for new messages in tickets (if from non-staff)
        const isStaff = message.member?.roles?.some((r: string) =>
            config!.staffRoleIds.includes(r)
        );

        if (!isStaff && !message.author?.bot) {
            showNotification({
                title: `🎫 ${channel.name}`,
                body: `${message.author?.username}: ${(message.content || "").slice(0, 100)}`,
                icon: message.author?.avatar
                    ? `https://cdn.discordapp.com/avatars/${message.author.id}/${message.author.avatar}.png?size=64`
                    : undefined,
            });
        }
        return;
    }

    // For auto-reply guild channels (non-ticket), also forward
    const botReplyGuilds = config.botReplyGuildIds || [];
    if (botReplyGuilds.includes(channel.guild_id)) {
        sendToBridge({
            type: "event",
            name: "MESSAGE_CREATE",
            data: {
                id: message.id,
                channel_id: channelId,
                guild_id: channel.guild_id,
                content: message.content || "",
                author: {
                    id: message.author?.id,
                    username: message.author?.username,
                    bot: message.author?.bot || false,
                },
                member: message.member ? { roles: message.member.roles || [] } : null,
            }
        });
    }
}

function onChannelCreate(event: any) {
    if (!bridgeConnected || !config) return;
    const { channel } = event;
    if (!channel) return;
    if (!isTargetGuild(channel.guild_id)) return;
    if (!isTicketChannel(channel)) return;

    console.log(`[TicketNotifier] 🎫 New ticket channel: ${channel.name}`);

    showNotification({
        title: "🎫 Новый тикет!",
        body: channel.name,
        icon: "https://cdn.discordapp.com/embed/avatars/0.png",
    });

    sendToBridge({
        type: "event",
        name: "CHANNEL_CREATE",
        data: {
            id: channel.id,
            name: channel.name,
            type: channel.type,
            guild_id: channel.guild_id,
            parent_id: channel.parent_id,
            position: channel.position,
        }
    });
}

function onChannelDelete(event: any) {
    if (!bridgeConnected || !config) return;
    const { channel } = event;
    if (!channel) return;
    if (!isTargetGuild(channel.guild_id)) return;
    if (!isTicketChannel(channel)) return;

    console.log(`[TicketNotifier] 🔒 Ticket closed: ${channel.name}`);

    sendToBridge({
        type: "event",
        name: "CHANNEL_DELETE",
        data: {
            id: channel.id,
            name: channel.name,
            guild_id: channel.guild_id,
            parent_id: channel.parent_id,
        }
    });
}

function onGuildMemberListUpdate(event: any) {
    // Forward presence/member updates for dashboard
    if (!bridgeConnected || !config) return;
    // Only forward for target guild to save bandwidth
    if (event.guildId && !isTargetGuild(event.guildId)) return;

    sendToBridge({
        type: "event",
        name: "GUILD_MEMBER_LIST_UPDATE",
        data: event
    });
}

// ── Utilities ────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Plugin Definition ────────────────────────────────────────

export default definePlugin({
    name: "TicketNotifier",
    description: "🎫 FunTime Ticket Monitoring — sends events to Ubuntu backend, receives auto-reply commands",
    authors: [{ name: "choko", id: 0n }],

    settings: {
        serverUrl: {
            type: OptionType.STRING,
            description: "Ubuntu server URL (ws://IP:PORT)",
            default: "ws://192.168.1.100:3000",
            restartNeeded: true,
        },
        pluginSecret: {
            type: OptionType.STRING,
            description: "Plugin authentication secret",
            default: "ticket-notifier-plugin-2026",
            restartNeeded: true,
        },
        showToasts: {
            type: OptionType.BOOLEAN,
            description: "Show toast notifications for new ticket messages",
            default: true,
        },
    },

    start() {
        console.log("[TicketNotifier] 🚀 Starting plugin...");

        // Get self user ID
        const currentUser = UserStore.getCurrentUser();
        selfUserId = currentUser?.id || "";
        console.log(`[TicketNotifier] 👤 Self user: ${currentUser?.username} (${selfUserId})`);

        // Connect to Ubuntu backend
        connectBridge();

        // Subscribe to Discord events
        FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);
        FluxDispatcher.subscribe("CHANNEL_CREATE", onChannelCreate);
        FluxDispatcher.subscribe("CHANNEL_DELETE", onChannelDelete);

        console.log("[TicketNotifier] ✅ Plugin started — listening for events");
    },

    stop() {
        console.log("[TicketNotifier] 🛑 Stopping plugin...");

        // Unsubscribe from events
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);
        FluxDispatcher.unsubscribe("CHANNEL_CREATE", onChannelCreate);
        FluxDispatcher.unsubscribe("CHANNEL_DELETE", onChannelDelete);

        // Disconnect bridge
        if (bridgeReconnectTimer) {
            clearTimeout(bridgeReconnectTimer);
            bridgeReconnectTimer = null;
        }
        if (bridge) {
            try { bridge.close(1000); } catch { }
            bridge = null;
        }
        bridgeConnected = false;
        config = null;

        console.log("[TicketNotifier] ✅ Plugin stopped");
    },
});
