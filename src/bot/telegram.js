// ═══════════════════════════════════════════════════════════════
//  Telegram Polling — Commands and Callback Query handlers
// ═══════════════════════════════════════════════════════════════
const { escapeHtml, truncate, formatDuration, getKyivDate, formatKyivDate, sleep } = require('./helpers');
const { buildStartMessage, buildStatsMessage, buildListMessage, buildTicketListButtons, buildActiveTicketMessage } = require('./builders');
const { getAiUsageStats, resetAiUsageStats } = require('./gateway');

function startPolling(bot) {
    if (bot.pollingTimer) return;
    if (bot.config.telegramEnabled === false) {
        bot.log('📡 Telegram polling skipped (disabled in settings)');
        return;
    }
    bot.log('📡 Telegram polling started');
    async function poll() {
        if (bot.destroyed) return;
        if (bot.config.telegramEnabled === false) {
            bot.log('📡 Telegram polling stopped (disabled in settings)');
            bot.pollingTimer = null;
            return;
        }
        try {
            const updates = await bot.tgGetUpdates();
            for (const u of updates) {
                bot.pollingOffset = u.update_id + 1;
                if (u.message) await handleMessage(bot, u.message);
                if (u.callback_query) await handleCallbackQuery(bot, u.callback_query);
            }
        } catch (e) { bot.log(`Polling error: ${e.message}`); }
        if (!bot.destroyed) bot.pollingTimer = setTimeout(poll, 1500);
    }
    poll();
}

function stopPolling(bot) {
    if (bot.pollingTimer) { clearTimeout(bot.pollingTimer); bot.pollingTimer = null; }
}

async function handleMessage(bot, msg) {
    const chatId = String(msg.chat?.id);
    if (chatId !== String(bot.config.tgChatId)) return;
    const text = (msg.text || '').trim();
    if (!text) return;

    // Reply to ticket message
    if (msg.reply_to_message && !text.startsWith('/')) {
        bot.log(`⌨️ TG reply from ${chatId}: "${truncate(text, 120)}"`, 'command');
        const reply = await bot.handleReplyToTicket(msg.reply_to_message.message_id, text);
        await bot.tgSendMessage(chatId, reply);
        return;
    }

    // Direct text to active ticket (not a command)
    if (!text.startsWith('/')) {
        const uState = bot.getUserState(chatId);
        if (uState.activeTicketId) {
            bot.log(`⌨️ TG message to active ticket ${uState.activeTicketId}: "${truncate(text, 120)}"`, 'command');
            const result = await bot.handleSendToTicket(text, chatId);
            await bot.tgSendMessage(chatId, result.text, result.markup);
        }
        return;
    }

    const [rawCmd, ...argParts] = text.split(/\s+/);
    const cmd = rawCmd.toLowerCase().replace(/@\w+$/, '');
    const argsStr = text.slice(rawCmd.length).trim();
    bot.log(`⌨️ TG command ${cmd} from ${chatId}${argsStr ? `: "${truncate(argsStr, 120)}"` : ''}`, 'command');

    try {
        switch (cmd) {
            case '/start': case '/help':
                await bot.tgSendMessage(chatId, buildStartMessage(bot.activeTickets.size, bot.config));
                break;

            case '/web': case '/dashboard': case '/app': {
                const domain = process.env.DASHBOARD_URL
                    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')
                    || (process.env.RAILWAY_STATIC_URL ? `https://${process.env.RAILWAY_STATIC_URL}` : '');
                if (!domain) {
                    await bot.tgSendMessage(chatId, '❌ Dashboard URL не настроен.\n\nУстанови переменную <code>DASHBOARD_URL</code> в Railway (например <code>https://your-app.up.railway.app</code>).');
                    break;
                }
                const url = domain.replace(/\/+$/, '');
                await bot.tgSendMessage(chatId,
                    ['╔══════════════════════════╗', '║  🌐  <b>DASHBOARD</b>', '╚══════════════════════════╝', '',
                        'Нажми кнопку ниже — откроется панель управления прямо в Telegram! 🚀'].join('\n'),
                    {
                        inline_keyboard: [
                            [{ text: '🖥 Открыть Dashboard', web_app: { url } }],
                            [{ text: '🔗 Открыть в браузере', url }],
                        ]
                    }
                );
                break;
            }

            case '/list': {
                const tickets = bot.getTicketList();
                if (tickets.length === 0) {
                    await bot.tgSendMessage(chatId, '📭 Нет открытых тикетов.');
                    break;
                }
                const uState = bot.getUserState(chatId);
                const msg2 = buildTicketListButtons(tickets, uState.listPage || 0, 6, uState.activeTicketId);
                uState.listPage = msg2.page;
                await bot.tgSendMessage(chatId, msg2.text, msg2.markup);
                break;
            }

            case '/oldlist':
                await bot.tgSendMessage(chatId, buildListMessage(bot.activeTickets, bot.config));
                break;

            case '/ticket': {
                const uState = bot.getUserState(chatId);
                const record = uState.activeTicketId ? bot.activeTickets.get(uState.activeTicketId) : null;
                const m = buildActiveTicketMessage(uState.activeTicketId, uState.activeTicketName, record, bot.config);
                await bot.tgSendMessage(chatId, m.text, m.markup);
                break;
            }

            case '/unselect': {
                const uState = bot.getUserState(chatId);
                uState.activeTicketId = null;
                uState.activeTicketName = null;
                await bot.tgSendMessage(chatId, '❌ Тикет сброшен.');
                break;
            }

            case '/s': {
                const result = await bot.handleSendToTicket(argsStr, chatId);
                await bot.tgSendMessage(chatId, result.text, result.markup);
                break;
            }

            case '/msg': {
                const reply = await bot.handleMsgCommand(argsStr);
                await bot.tgSendMessage(chatId, reply);
                break;
            }

            case '/stats': {
                const closedCount = bot.dbGetClosedCount();
                await bot.tgSendMessage(chatId, buildStatsMessage(bot.ps, bot.botPaused, bot.activeTickets.size, closedCount));
                break;
            }

            case '/ai': case '/tokens': case '/analytics': {
                if (argsStr.toLowerCase() === 'reset') {
                    resetAiUsageStats(bot);
                    await bot.tgSendMessage(chatId, '🔄 Статистика AI сброшена.');
                    break;
                }
                const stats = getAiUsageStats(bot);
                const lines = ['╔══════════════════════════╗', '║  🧠  <b>AI СТАТИСТИКА</b>', '╚══════════════════════════╝', ''];
                lines.push(`📊 <b>Всего запросов:</b> ${stats.totalRequests}`);
                lines.push(`❌ <b>Ошибок:</b> ${stats.totalErrors}`);
                lines.push(`🪙 <b>Токенов:</b> ${stats.totalTokens.toLocaleString('ru-RU')}`);
                if (stats.startedAt) lines.push(`📅 <b>Отсчёт с:</b> ${new Date(stats.startedAt).toLocaleDateString('ru-RU')}`);
                if (stats.lastRequestAt) lines.push(`🕐 <b>Последний:</b> ${new Date(stats.lastRequestAt).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}`);
                lines.push('');
                for (const [prov, p] of Object.entries(stats.providers || {})) {
                    const icon = prov === 'gemini' ? '💎' : prov === 'groq' ? '⚡' : '🌐';
                    lines.push(`${icon} <b>${escapeHtml(prov.toUpperCase())}</b>`);
                    lines.push(`   📨 ${p.requests} запросов · ❌ ${p.errors} ошибок`);
                    lines.push(`   🪙 ${p.totalTokens.toLocaleString('ru-RU')} токенов (⬆️${p.promptTokens.toLocaleString('ru-RU')} ⬇️${p.completionTokens.toLocaleString('ru-RU')})`);
                    const models = Object.entries(p.models || {}).sort((a, b) => b[1].requests - a[1].requests);
                    for (const [m, ms] of models.slice(0, 5)) {
                        lines.push(`   └ <code>${escapeHtml(m)}</code>: ${ms.requests}× · ${ms.tokens.toLocaleString('ru-RU')} tok`);
                    }
                    lines.push('');
                }
                lines.push('<i>/ai reset — сбросить статистику</i>');
                await bot.tgSendMessage(chatId, lines.join('\n'));
                break;
            }

            case '/pause':
                bot.botPaused = true;
                await bot.tgSendMessage(chatId, '⏸ Бот на паузе. Уведомления не будут отправляться.');
                break;
            case '/resume':
                bot.botPaused = false;
                await bot.tgSendMessage(chatId, '▶️ Бот возобновил работу!');
                break;

            case '/history': {
                const chunks = await bot.handleHistory(chatId);
                for (const c of chunks) await bot.tgSendMessage(chatId, c.text, c.markup);
                break;
            }

            case '/binds':
                await bot.tgSendMessage(chatId, bot.handleBindsList());
                break;

            case '/addbind':
                await bot.tgSendMessage(chatId, bot.handleAddBind(argsStr));
                break;

            case '/delbind':
                await bot.tgSendMessage(chatId, bot.handleDelBind(argsStr));
                break;

            case '/greet':
                await bot.tgSendMessage(chatId, bot.handleGreet(argsStr));
                break;

            case '/setgreet':
                await bot.tgSendMessage(chatId, bot.handleSetGreet(argsStr));
                break;

            case '/smena': {
                const result = await bot.handleSmena(chatId);
                await bot.tgSendMessage(chatId, result);
                break;
            }

            case '/smenoff': {
                const result = await bot.handleSmenoff(chatId);
                await bot.tgSendMessage(chatId, result);
                break;
            }

            case '/settings': {
                const cfg = bot.config;
                await bot.tgSendMessage(chatId, [
                    `╔══════════════════════╗`, `║  ⚙️  <b>НАСТРОЙКИ</b>`, `╚══════════════════════╝`, ``,
                    `📋 Prefix: <code>${escapeHtml(cfg.ticketPrefix || '')}</code>`,
                    `🏠 Guild: <code>${cfg.guildId || ''}</code>`,
                    `📁 Category: <code>${cfg.ticketsCategoryId || ''}</code>`,
                    `⏰ Activity: ${cfg.activityCheckMin || 10} мин`,
                    `⏰ Closing: ${cfg.closingCheckMin || 15} мин`,
                    `👋 Auto-greet: ${cfg.autoGreetEnabled ? '✅' : '❌'}`,
                    `📏 Max msg: ${cfg.maxMessageLength || 300}`,
                    ``, `/set &lt;key&gt; &lt;value&gt; — изменить`,
                ].join('\n'));
                break;
            }

            case '/set': {
                const reply = bot.handleSet(argsStr);
                await bot.tgSendMessage(chatId, reply);
                break;
            }

            default: {
                // Try bind search
                const bindName = cmd.slice(1);
                const result = await bot.handleBindSearch(bindName, chatId);
                if (result) {
                    await bot.tgSendMessage(chatId, result.text, result.markup);
                } else {
                    await bot.tgSendMessage(chatId, `❓ Неизвестная команда: ${escapeHtml(cmd)}\n\n/help — список команд`);
                }
            }
        }
    } catch (cmdErr) {
        bot.log(`❌ Command handler error for ${cmd}: ${cmdErr.stack || cmdErr.message}`);
        try { await bot.tgSendMessage(chatId, `❌ Ошибка обработки команды ${escapeHtml(cmd)}: ${escapeHtml(String(cmdErr.message).slice(0, 200))}`); } catch (_) { }
    }
}

async function handleCallbackQuery(bot, cbq) {
    const data = cbq.data || '';
    const chatId = String(cbq.message?.chat?.id);
    const messageId = cbq.message?.message_id;
    const cbqId = cbq.id;
    bot.log(`🖱️ TG callback ${data} from ${chatId}`, 'command');

    // Route admin approval callbacks through the bot's polling when tokens are shared
    if (bot._adminCallbackHandler && (data.startsWith('approve_user:') || data.startsWith('reject_user:'))) {
        try { await bot._adminCallbackHandler(cbq); } catch (e) { bot.log(`Admin callback error: ${e.message}`); }
        return;
    }

    if (data.startsWith('tsel_')) {
        const channelId = data.slice(5);
        const record = bot.activeTickets.get(channelId);
        if (!record) { await bot.tgAnswerCallbackQuery(cbqId, '❌ Тикет не найден'); return; }
        const uState = bot.getUserState(chatId);
        uState.activeTicketId = channelId;
        uState.activeTicketName = record.channelName;
        await bot.tgAnswerCallbackQuery(cbqId, `✅ ${record.channelName}`);
        const m = buildActiveTicketMessage(channelId, record.channelName, record, bot.config);
        await bot.tgEditMessageText(chatId, messageId, m.text, m.markup);
    } else if (data.startsWith('tpage_')) {
        const page = parseInt(data.slice(6), 10) || 0;
        const tickets = bot.getTicketList();
        const uState = bot.getUserState(chatId);
        const msg = buildTicketListButtons(tickets, page, 6, uState.activeTicketId);
        uState.listPage = msg.page;
        await bot.tgAnswerCallbackQuery(cbqId);
        await bot.tgEditMessageText(chatId, messageId, msg.text, msg.markup);
    } else if (data === 'tunselect') {
        const uState = bot.getUserState(chatId);
        uState.activeTicketId = null;
        uState.activeTicketName = null;
        await bot.tgAnswerCallbackQuery(cbqId, '❌ Тикет сброшен');
        const tickets = bot.getTicketList();
        const msg = buildTicketListButtons(tickets, uState.listPage || 0, 6, null);
        await bot.tgEditMessageText(chatId, messageId, msg.text, msg.markup);
    } else if (data === 'thistory') {
        await bot.tgAnswerCallbackQuery(cbqId);
        const chunks = await bot.handleHistory(chatId);
        for (const c of chunks) await bot.tgSendMessage(chatId, c.text, c.markup);
    } else if (data.startsWith('bind_')) {
        const bindName = data.slice(5);
        const bind = bot.config.binds?.[bindName];
        if (!bind) { await bot.tgAnswerCallbackQuery(cbqId, '❌ Бинд не найден'); return; }
        const uState = bot.getUserState(chatId);
        if (!uState.activeTicketId) { await bot.tgAnswerCallbackQuery(cbqId, '❌ Тикет не выбран'); return; }
        try {
            const res = await bot.sendDiscordMessage(uState.activeTicketId, bind.message);
            if (res.ok) {
                try { const j = JSON.parse(res.body); if (j.id) bot.sentByBot.add(j.id); } catch { }
                await bot.tgAnswerCallbackQuery(cbqId, `✅ ${bind.name}`);
                bot.addLog('bind', `Бинд «${bind.name}» отправлен`);
            } else { await bot.tgAnswerCallbackQuery(cbqId, `❌ Ошибка Discord`); }
        } catch (e) { await bot.tgAnswerCallbackQuery(cbqId, `❌ ${e.message}`); }
    } else if (data === 'shift_checkin') {
        await bot.tgAnswerCallbackQuery(cbqId, '⏳...');
        const result = await bot.handleSmena(chatId);
        await bot.tgSendMessage(chatId, result);
    } else if (data === 'shift_close') {
        await bot.tgAnswerCallbackQuery(cbqId, '⏳...');
        const result = await bot.handleSmenoff(chatId);
        await bot.tgSendMessage(chatId, result);
    } else if (data === 'shift_skip') {
        await bot.tgAnswerCallbackQuery(cbqId, '⏭ Пропущено');
    }
}

module.exports = { startPolling, stopPolling };
