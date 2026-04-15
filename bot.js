#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  Telegram Ticket Notifier — Discord Gateway Bot (24/7)
// ═══════════════════════════════════════════════════════════════

const WebSocket = require('ws');
const https = require('https');
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { buildIdentifyPayload, getDiscordRestHeaders, humanizeAutoReply } = require('./src/bot/stealthProfile');

let io; // Dashboard Socket.io instance

// ── Config ────────────────────────────────────────────────────

const CONFIG_FILE = path.join(__dirname, 'config.json');
let config;
try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
} catch {
    config = {};
}

if (process.env.GROQ_API_KEY) config.groqApiKey = process.env.GROQ_API_KEY;
if (process.env.DISCORD_TOKEN) config.discordToken = process.env.DISCORD_TOKEN;
if (process.env.DISCORD_BOT_TOKEN) config.discordBotToken = process.env.DISCORD_BOT_TOKEN;
if (process.env.TG_TOKEN) config.tgToken = process.env.TG_TOKEN;
if (process.env.TG_CHAT_ID) config.tgChatId = process.env.TG_CHAT_ID;
if (process.env.GUILD_ID) config.guildId = process.env.GUILD_ID;
if (process.env.TICKETS_CATEGORY_ID) config.ticketsCategoryId = process.env.TICKETS_CATEGORY_ID;
if (process.env.STAFF_ROLE_IDS) config.staffRoleIds = process.env.STAFF_ROLE_IDS.split(',');
if (process.env.TICKET_PREFIX) config.ticketPrefix = process.env.TICKET_PREFIX;
if (process.env.USERS) {
    try { config.users = JSON.parse(process.env.USERS); } catch (e) { console.error('[TicketBot] USERS env parse error:', e.message); }
}
if (process.env.DASHBOARD_PASSWORD) config.dashboardPassword = process.env.DASHBOARD_PASSWORD;
if (process.env.GEMINI_API_KEY) config.geminiApiKey = process.env.GEMINI_API_KEY;

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

config.autoGreetRoleIds = config.autoGreetRoleIds || ['1334466933273395242'];
config.autoGreetText = config.autoGreetText || 'Здравствуйте, чем могу помочь?';
config.autoGreetEnabled = config.autoGreetEnabled ?? true;

config.autoReplies = config.autoReplies || [
    // ══════════ Сервер 1266100282551570522 ══════════
    {
        name: 'когда вайп',
        guildId: '1266100282551570522',
        channelId: '1475424153057366036',
        includeAny: [
            'когда вайп', 'когда будет вайп', 'когда следующий вайп',
            'когда ожидать вайп', 'когда планируется вайп', 'когда намечается вайп',
            'вайп скоро', 'скоро вайп', 'будет ли вайп',
            'дата вайпа', 'число вайпа', 'когда дата вайпа',
            'когда объявят вайп', 'анонс вайпа', 'когда анонс вайпа',
            'вайп планируется', 'вайп ожидается',
            'когда был вайп', 'когда последний вайп', 'последний вайп когда',
            'когда прошлый вайп', 'прошлый вайп когда', 'когда предыдущий вайп',
            'что такое вайп', 'что значит вайп', 'вайп это',
            'расскажите про вайп', 'информация о вайпе', 'инфо о вайпе',
            'вайп сервера', 'сервер вайпнут', 'сервер вайпнется',
            'когда вайпнут', 'когда вайпнется', 'вайпнут ли сервер',
        ],
        excludeAny: [
            'форум', 'на форум', 'сайт', 'на сайт',
            'вин топ', 'топ кончается', 'закончится будет вайп',
            'после вайпа', 'до вайпа', 'перед вайпом',
            'из-за вайпа', 'после того как вайп',
            'если будет вайп', 'может быть вайп',
            'возможно вайп', 'наверное вайп',
            'когда закончится', 'когда кончится',
            'купить до вайпа', 'успеть до вайпа',
            'стоит ли до вайпа', 'смысл до вайпа',
        ],
        response: 'Здравствуйте, вайп был 30.01.2026, когда будет - неизвестно',
        enabled: true,
    },
    {
        name: 'проблемы с подключением',
        guildId: '1266100282551570522',
        channelId: '1475424153057366036',
        includeAny: [
            'не могу зайти на сервер', 'не могу войти на сервер',
            'не заходит на сервер', 'не входит на сервер',
            'не могу подключиться к серверу', 'не подключается к серверу',
            'вылетает при входе на сервер', 'вылетает при заходе на сервер',
            'не пускает на сервер', 'сервер не пускает',
            'не работает сервер', 'сервер не работает',
            'сервер лежит', 'сервер упал', 'сервер недоступен',
            'сервер не доступен', 'сервер оффлайн', 'сервер офлайн',
            'когда заработает сервер', 'почему не работает сервер',
            'большой пинг на сервере', 'высокий пинг на сервере',
            'лагает сервер', 'сервер лагает', 'лаги на сервере',
            'пинг 999', 'таймаут',
            'connection refused', 'connection timed out',
            'проблемы с подключением к серверу', 'ошибка подключения к серверу',
            'не могу попасть на сервер',
            'не отвечает сервер', 'сервер не отвечает',
            'почему не могу зайти на сервер',
        ],
        excludeAny: [
            'забанили', 'заблокировали', 'бан', 'блокировка',
            'форум', 'на форум', 'сайт', 'на сайт',
            'вк', 'вконтакте', 'дискорд', 'телеграм',
            'личный кабинет', 'аккаунт на сайте',
        ],
        response: 'Здравствуйте! Попробуйте использовать альтернативные IP-адреса:\ntest-tcp.funtime.sh\ntest-neo.funtime.sh\ntcpshield.funtime.me\nneoprotect.funtime.me\nneoprotect.funtime.su\ntcpshield.funtime.su\ntcpshield.funtime.su (не работает из Украины)\nneoprotect.funtime.su (не работает из Украины)\ntcpshield-ovh.funtime.su (не работает из Украины)\n\nЕсли проблема сохраняется — обратитесь к интернет-провайдеру. Сервер работает стабильно, однако возможны локальные сетевые ограничения.',
        enabled: true,
    },
    {
        name: 'ошибочный бан (с вопросом)',
        guildId: '1266100282551570522',
        channelId: '1475424153057366036',
        includeAll: [
            ['что делать', 'что мне делать', 'подскажите что делать', 'как быть', 'помогите', 'куда обращаться', 'что можно сделать'],
            ['бан', 'забан', 'забанили', 'забанен', 'баннули', 'блок', 'блокировка', 'заблокировали', 'заблокирован'],
        ],
        excludeAny: [
            'уже подал апелляц', 'уже подала апелляц', 'уже отправил апелляц',
            'уже написал апелляц', 'уже апелляцию подал', 'апелляция уже подана',
        ],
        response: 'Если Вы считаете блокировку ошибочной, подайте апелляцию:\nhttps://forum.funtime.su/index.php?forums/appeals/\n\nПеред подачей обязательно ознакомьтесь с FAQ:\nhttps://forum.funtime.su/faq_appeals',
        enabled: true,
    },
    {
        name: 'ошибочный бан (простое упоминание)',
        guildId: '1266100282551570522',
        channelId: '1475424153057366036',
        includeAny: [
            'меня забанили', 'меня заблокировали', 'меня баннули', 'меня кикнули',
            'забанили меня', 'заблокировали меня', 'баннули меня',
            'я получил бан', 'я получила бан', 'я получил блок', 'я получила блок',
            'мне дали бан', 'мне выдали бан', 'мне дали блок', 'мне выдали блок',
            'дали бан', 'выдали бан', 'получил бан', 'получила бан',
            'дали блок', 'выдали блок', 'получил блок', 'получила блок',
            'поймал бан', 'поймала бан', 'словил бан', 'словила бан',
            'влетел в бан', 'влетела в бан', 'попал под бан', 'попала под бан',
            'забанен', 'забанена', 'заблокирован', 'заблокирована',
            'бан просто так', 'забанили просто так', 'заблокировали просто так',
            'бан ни за что', 'забанили ни за что', 'заблокировали ни за что',
            'бан без причины', 'забанили без причины', 'заблокировали без причины',
            'бан по приколу', 'забанили по приколу', 'заблокировали по приколу',
            'бан ни за что ни про что', 'бан непонятно за что',
            'незаслуженный бан', 'незаслуженно забанили', 'незаслуженная блокировка',
            'несправедливый бан', 'несправедливо забанили', 'несправедливо заблокировали',
            'необоснованный бан', 'необоснованная блокировка',
            'ошибочный бан', 'ошибочная блокировка', 'бан ошибка',
            'бан ошибочно', 'забанили ошибочно', 'ошибочно заблокировали',
            'бан ложно', 'забанили ложно', 'ложная блокировка', 'ложный бан',
            'бан по ошибке', 'заблокировали по ошибке', 'забанили по ошибке',
            'почему меня забанили', 'почему меня заблокировали', 'почему я забанен',
            'за что меня забанили', 'за что меня заблокировали', 'за что бан',
            'почему бан', 'за что блок', 'почему блок',
            'что я сделал чтобы получить бан', 'за что дали бан',
            'не понимаю за что бан', 'не понял за что забанили',
            'я не читер', 'я не читерил', 'я не читерила',
            'я ничего не нарушал', 'я ничего не нарушала',
            'я не нарушал', 'я не нарушала', 'я не нарушал правила',
            'я играл честно', 'я играла честно',
            'я не использовал читы', 'я не использовала читы',
            'я не использовал хаки', 'у меня нет читов',
            'я чистый', 'я ничего не делал', 'я ничего не делала',
            'что делать если забанили', 'что делать если заблокировали',
            'как снять бан', 'как убрать бан', 'как разбанят',
            'когда разбанят', 'когда снимут бан', 'можно ли оспорить бан',
            'как обжаловать бан', 'как подать на бан',
            'куда писать если забанили', 'куда обратиться если забанили',
        ],
        excludeAny: [
            'уже подал апелляц', 'уже подала апелляц', 'уже отправил апелляц',
            'уже написал апелляц', 'уже апелляцию подал', 'апелляция уже подана',
            'апелляция отклонена', 'апелляцию отклонили',
        ],
        response: 'Если Вы считаете блокировку ошибочной, подайте апелляцию:\nhttps://forum.funtime.su/index.php?forums/appeals/\n\nПеред подачей обязательно ознакомьтесь с FAQ:\nhttps://forum.funtime.su/faq_appeals',
        enabled: true,
    },
    {
        name: 'взлом аккаунта',
        guildId: '1266100282551570522',
        channelId: '1475424153057366036',
        includeAny: [
            'взломали аккаунт', 'взломали мой аккаунт', 'аккаунт взломали',
            'взломан аккаунт', 'аккаунт взломан', 'меня взломали',
            'украли аккаунт', 'украли мой аккаунт', 'аккаунт украли',
            'угнали аккаунт', 'угнали мой аккаунт', 'аккаунт угнали',
            'забрали доступ', 'забрали аккаунт', 'потерял доступ к аккаунту',
            'потеряла доступ к аккаунту', 'нет доступа к аккаунту',
            'забыл пароль', 'забыла пароль', 'потерял пароль', 'потеряла пароль',
            'не помню пароль', 'не могу вспомнить пароль',
            'сменили пароль', 'изменили пароль', 'поменяли пароль',
            'не могу войти в аккаунт', 'не могу зайти в аккаунт',
            'чужой зашел в аккаунт', 'кто то зашел в мой аккаунт',
            'восстановить аккаунт', 'восстановление аккаунта',
            'как восстановить аккаунт', 'верните аккаунт',
            'помогите восстановить аккаунт', 'потерял аккаунт',
        ],
        response: 'Здравствуйте! Если Вы забыли пароль или аккаунт был взломан — обратитесь в поддержку: https://vk.com/funtime',
        enabled: true,
    },
    // ══════════ Сервер 690362306395111444 ══════════
    {
        name: 'когда вайп [2]',
        guildId: '690362306395111444',
        channelId: '717734206586880060',
        includeAny: [
            'когда вайп', 'когда будет вайп', 'когда следующий вайп',
            'когда ожидать вайп', 'когда планируется вайп', 'когда намечается вайп',
            'вайп скоро', 'скоро вайп', 'будет ли вайп',
            'дата вайпа', 'число вайпа', 'когда дата вайпа',
            'когда объявят вайп', 'анонс вайпа', 'когда анонс вайпа',
            'вайп планируется', 'вайп ожидается',
            'когда был вайп', 'когда последний вайп', 'последний вайп когда',
            'когда прошлый вайп', 'прошлый вайп когда', 'когда предыдущий вайп',
            'что такое вайп', 'что значит вайп', 'вайп это',
            'расскажите про вайп', 'информация о вайпе', 'инфо о вайпе',
            'вайп сервера', 'сервер вайпнут', 'сервер вайпнется',
            'когда вайпнут', 'когда вайпнется', 'вайпнут ли сервер',
        ],
        excludeAny: [
            'форум', 'на форум', 'сайт', 'на сайт',
            'вин топ', 'топ кончается', 'закончится будет вайп',
            'после вайпа', 'до вайпа', 'перед вайпом',
            'из-за вайпа', 'после того как вайп',
            'если будет вайп', 'может быть вайп',
            'возможно вайп', 'наверное вайп',
            'когда закончится', 'когда кончится',
            'купить до вайпа', 'успеть до вайпа',
            'стоит ли до вайпа', 'смысл до вайпа',
        ],
        response: 'Здравствуйте, вайп был 30.01.2026, когда будет - неизвестно',
        enabled: true,
    },
    {
        name: 'проблемы с подключением [2]',
        guildId: '690362306395111444',
        channelId: '717734206586880060',
        includeAny: [
            'не могу зайти на сервер', 'не могу войти на сервер',
            'не заходит на сервер', 'не входит на сервер',
            'не могу подключиться к серверу', 'не подключается к серверу',
            'вылетает при входе на сервер', 'вылетает при заходе на сервер',
            'не пускает на сервер', 'сервер не пускает',
            'не работает сервер', 'сервер не работает',
            'сервер лежит', 'сервер упал', 'сервер недоступен',
            'сервер не доступен', 'сервер оффлайн', 'сервер офлайн',
            'когда заработает сервер', 'почему не работает сервер',
            'большой пинг на сервере', 'высокий пинг на сервере',
            'лагает сервер', 'сервер лагает', 'лаги на сервере',
            'пинг 999', 'таймаут',
            'connection refused', 'connection timed out',
            'проблемы с подключением к серверу', 'ошибка подключения к серверу',
            'не могу попасть на сервер',
            'не отвечает сервер', 'сервер не отвечает',
            'почему не могу зайти на сервер',
        ],
        excludeAny: [
            'забанили', 'заблокировали', 'бан', 'блокировка',
            'форум', 'на форум', 'сайт', 'на сайт',
            'вк', 'вконтакте', 'дискорд', 'телеграм',
            'личный кабинет', 'аккаунт на сайте',
        ],
        response: 'Здравствуйте! Попробуйте использовать альтернативные IP-адреса:\ntest-tcp.funtime.sh\ntest-neo.funtime.sh\ntcpshield.funtime.me\nneoprotect.funtime.me\nneoprotect.funtime.su\ntcpshield.funtime.su\ntcpshield.funtime.su (не работает из Украины)\nneoprotect.funtime.su (не работает из Украины)\ntcpshield-ovh.funtime.su (не работает из Украины)\n\nЕсли проблема сохраняется — обратитесь к интернет-провайдеру. Сервер работает стабильно, однако возможны локальные сетевые ограничения.',
        enabled: true,
    },
    {
        name: 'ошибочный бан (с вопросом) [2]',
        guildId: '690362306395111444',
        channelId: '717734206586880060',
        includeAll: [
            ['что делать', 'что мне делать', 'подскажите что делать', 'как быть', 'помогите', 'куда обращаться', 'что можно сделать'],
            ['бан', 'забан', 'забанили', 'забанен', 'баннули', 'блок', 'блокировка', 'заблокировали', 'заблокирован'],
        ],
        excludeAny: [
            'уже подал апелляц', 'уже подала апелляц', 'уже отправил апелляц',
            'уже написал апелляц', 'уже апелляцию подал', 'апелляция уже подана',
        ],
        response: 'Если Вы считаете блокировку ошибочной, подайте апелляцию:\nhttps://forum.funtime.su/index.php?forums/appeals/\n\nПеред подачей обязательно ознакомьтесь с FAQ:\nhttps://forum.funtime.su/faq_appeals',
        enabled: true,
    },
    {
        name: 'ошибочный бан (простое упоминание) [2]',
        guildId: '690362306395111444',
        channelId: '717734206586880060',
        includeAny: [
            'меня забанили', 'меня заблокировали', 'меня баннули', 'меня кикнули',
            'забанили меня', 'заблокировали меня', 'баннули меня',
            'я получил бан', 'я получила бан', 'я получил блок', 'я получила блок',
            'мне дали бан', 'мне выдали бан', 'мне дали блок', 'мне выдали блок',
            'дали бан', 'выдали бан', 'получил бан', 'получила бан',
            'дали блок', 'выдали блок', 'получил блок', 'получила блок',
            'поймал бан', 'поймала бан', 'словил бан', 'словила бан',
            'влетел в бан', 'влетела в бан', 'попал под бан', 'попала под бан',
            'забанен', 'забанена', 'заблокирован', 'заблокирована',
            'бан просто так', 'забанили просто так', 'заблокировали просто так',
            'бан ни за что', 'забанили ни за что', 'заблокировали ни за что',
            'бан без причины', 'забанили без причины', 'заблокировали без причины',
            'бан по приколу', 'забанили по приколу', 'заблокировали по приколу',
            'незаслуженный бан', 'незаслуженно забанили', 'несправедливый бан',
            'несправедливо забанили', 'необоснованный бан',
            'ошибочный бан', 'ошибочная блокировка', 'бан по ошибке',
            'бан ложно', 'забанили ложно', 'ложная блокировка', 'ложный бан',
            'почему меня забанили', 'почему меня заблокировали', 'почему я забанен',
            'за что меня забанили', 'за что меня заблокировали', 'за что бан',
            'я не читер', 'я не читерил', 'я не читерила',
            'я ничего не нарушал', 'я ничего не нарушала',
            'я не нарушал', 'я не нарушала', 'я играл честно',
            'я не использовал читы', 'у меня нет читов', 'я чистый',
            'что делать если забанили', 'как снять бан', 'когда разбанят',
            'куда писать если забанили', 'куда обратиться если забанили',
        ],
        excludeAny: [
            'уже подал апелляц', 'уже подала апелляц', 'уже отправил апелляц',
            'уже написал апелляц', 'апелляция уже подана',
            'апелляция отклонена', 'апелляцию отклонили',
        ],
        response: 'Если Вы считаете блокировку ошибочной, подайте апелляцию:\nhttps://forum.funtime.su/index.php?forums/appeals/\n\nПеред подачей обязательно ознакомьтесь с FAQ:\nhttps://forum.funtime.su/faq_appeals',
        enabled: true,
    },
    {
        name: 'взлом аккаунта [2]',
        guildId: '690362306395111444',
        channelId: '717734206586880060',
        includeAny: [
            'взломали аккаунт', 'взломали мой аккаунт', 'аккаунт взломали',
            'взломан аккаунт', 'аккаунт взломан', 'меня взломали',
            'украли аккаунт', 'украли мой аккаунт', 'аккаунт украли',
            'угнали аккаунт', 'угнали мой аккаунт', 'аккаунт угнали',
            'забрали доступ', 'забрали аккаунт', 'потерял доступ к аккаунту',
            'потеряла доступ к аккаунту', 'нет доступа к аккаунту',
            'забыл пароль', 'забыла пароль', 'потерял пароль', 'потеряла пароль',
            'не помню пароль', 'не могу вспомнить пароль',
            'сменили пароль', 'изменили пароль', 'поменяли пароль',
            'не могу войти в аккаунт', 'не могу зайти в аккаунт',
            'чужой зашел в аккаунт', 'кто то зашел в мой аккаунт',
            'восстановить аккаунт', 'восстановление аккаунта',
            'как восстановить аккаунт', 'верните аккаунт',
            'помогите восстановить аккаунт', 'потерял аккаунт',
        ],
        response: 'Здравствуйте! Если Вы забыли пароль или аккаунт был взломан — обратитесь в поддержку: https://vk.com/funtime',
        enabled: true,
    },
];

config.binds = config.binds || {
    '25': { name: '25', message: 'Здравствуйте!** **Вайп состоится: 25.10.2025 **Время: 17:00 по МСК.' },
    '27': { name: '27', message: '**Здравствуйте!** **Вайп состоится: 27.09.2025 **Время:** 14:00 по МСК.' },
    'фарм': { name: 'фарм', message: '**Основные способы заработка:** 1. Лаваход + шалкеровый ящик. 2. Зачарование алмазного сета (З5) с перепродажей. 3. Зачарование и объединение эффектов на незеритовом мече. 4. Создание прибыльных кирок (бульдозер, автоплавка, магнит). 5. Автошахта. 6. Перепродажа обсидиана и алмазов при наличии стартового капитала. 7. PvP-зона для получения лута. 8. Участие в ивентах. 9. Перепродажа сфер и талисманов. Нарушение правил сервера может привести к блокировке.' },
    'запрет': { name: 'запрет', message: 'С перечнем разрешённых и запрещённых модификаций можно ознакомиться здесь: https://forum.funtime.su/modifications Визуальные модификации, не указанные как разрешённые, считаются запрещёнными. Разработчикам модификаций для согласования необходимо обратиться в группу проекта: @staff_funtime' },
    'отклонили': { name: 'отклонили', message: '*Если отклонили апелляцию* — повторные апелляции рассматриваться не будут. Решение окончательное.\n\n• Если бан *не навсегда* — разбан можно купить на сайте.\n\n• Если бан *навсегда* и он *не* по пунктам **4.2**, **4.3.1 (AutoBuy)**, **9.1**, **3.1**, **1.3** — можно обратиться в поддержку для покупки разбана за **5000₽**:\nhttps://vk.com/funtime' },
    'апелляция': { name: 'апелляция', message: 'Если Вы считаете блокировку ошибочной, подайте апелляцию: https://forum.funtime.su/index.php?forums/appeals/ Перед подачей обязательно ознакомьтесь с FAQ: https://forum.funtime.su/faq_appeals' },
    'уточните': { name: 'уточните', message: 'Уточните данный вопрос в поддержке: https://vk.com/funtime' },
    'айпи': { name: 'айпи', message: '**Здравствуйте!** Попробуйте использовать альтернативные IP-адреса: test-tcp.funtime.sh test-neo.funtime.sh tcpshield.funtime.me neoprotect.funtime.me neoprotect.funtime.su tcpshield.funtime.su tcpshield.funtime.su (не работает из Украины) neoprotect.funtime.su (не работает из Украины) tcpshield-ovh.funtime.su (не работает из Украины) Если проблема сохраняется — обратитесь к интернет-провайдеру. Сервер работает стабильно, однако возможны локальные сетевые ограничения.' },
    'разраб': { name: 'разраб', message: '**Здравствуйте!** Для получения одобрения модификаций обратитесь в группу проекта: http://vk.com/staff_funtime' },
    'читер': { name: 'читер', message: 'Если пользователь нарушает правила и использует стороннее ПО, отправьте жалобу: /report ник чит/тим или через форум: https://forum.funtime.su/complaint' },
    'пишите': { name: 'пишите', message: 'Обратитесь в поддержку: https://vk.com/funtime' },
    'вайп': { name: 'вайп', message: '**Здравствуйте!** Предыдущий вайп состоялся 30.01. Информация о следующем вайпе будет опубликована дополнительно.' },
    'взломали': { name: 'взломали', message: '**Здравствуйте!** Если Вы забыли пароль или аккаунт был взломан — обратитесь в поддержку: https://vk.com/funtime' },
    'автокликкер': { name: 'автокликкер', message: '**Здравствуйте!** При обнаружении автокликера во время проверки блокировка выдана не будет. Однако если система зафиксирует его использование (аукцион, мистический сундук и т.д.) и выдаст автоматическую блокировку — помощь оказана не будет. Использование автокликера может быть расценено как отсутствие режима АФК, что может повлечь вызов на проверку. Ответственность за последствия несёт пользователь.' },
    'вопрос': { name: 'вопрос', message: '**Здравствуйте!** Чем можем Вам помочь?' },
    'запрещен': { name: 'запрещен', message: 'С перечнем разрешённых и запрещённых модификаций можно ознакомиться здесь: https://forum.funtime.su/modifications Визуальные модификации, не указанные как разрешённые, считаются запрещёнными. Разработчикам модификаций для согласования необходимо обратиться в группу проекта: @staff_funtime' },
    'модер': { name: 'модер', message: '**Здравствуйте!** Хотите стать сотрудником проекта? Ознакомьтесь с информацией: https://forum.funtime.su/categories12' },
    'остались': { name: 'остались', message: 'У Вас остались дополнительные вопросы по данному тикету? Если вопросов нет — просим закрыть тикет.' },
    'шалкер': { name: 'шалкер', message: '**Здравствуйте!** Если предметы не куплены в течение 9 часов — они перемещаются в хранилище. Если в течение следующих 24 часов они не будут забраны — предметы удаляются. (Для шалкера срок хранения — 3 часа.) Система введена для оптимизации аукциона. Возврат и компенсация невозможны.' },
    'хранение': { name: 'хранение', message: 'Мы не блокируем за хранение читов, если они не использовались на сервере. Запрещено хранение: .exe-инжектов прокси-читов DoomsDay AutoBuy AutoMyst За наличие данных программ возможна блокировка.' },
    'скам': { name: 'скам', message: 'Здравствуйте! На нашем проекте скам разрешён. Исключение: скам на аккаунты (передача/попытки завладеть аккаунтом) запрещён.' },
    'двигаться': { name: 'двигаться', message: 'Здравствуйте! При возникновении подобной проблемы стоит сделать следующее:\n1) Отключите все модификации и войдите на сервер с ванильной версии Майнкрафт\n2) Если это не поможет, то привяжите ваш игровой аккаунт к профилю ВК или Телеграм: https://vk.com/funtime https://t.me/FunAuthBot После этого повторите попытку входа.\n3) Если ни один из вариантов не помог, то обратитесь в техническую поддержку сервера в ВК или Телеграм: https://vk.com/funtime https://t.me/funtime' },
    'рп': { name: 'рп', message: 'Для этого зайдите в меню серверов, выберите наш сервер, нажмите "Настроить" и включите наборы ресурсов.' },
};

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
const autoRepliedBinds = new Set();  // "channelId:bindKey" — prevent duplicate auto-replies
const noReplyTimers = new Map();
const channelCache = new Map();
const guildCache = new Map();
const guildRolesCache = new Map();   // roleId -> role object
const guildMembersCache = new Map(); // userId -> member object
const guildPresenceCache = new Map(); // userId -> status string
const dashboardLogs = [];            // { ts, type, message }
const MAX_LOGS = 200;

function addLog(type, message) {
    const entry = { ts: new Date().toISOString(), type, message };
    dashboardLogs.unshift(entry);
    if (dashboardLogs.length > MAX_LOGS) dashboardLogs.length = MAX_LOGS;
    if (io) io.emit('log:new', entry);
}

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
const autoGreetedChannels = new Set();

let ws = null;
let sessionId = null;
let resumeGatewayUrl = null;
let seq = null;
let heartbeatTimer = null;
let receivedAck = true;
let gatewayReady = false;
let channelsFetched = false;
let guildCreateHandled = false;
const notifiedTicketIds = new Set();
let botPaused = false;
const tgMsgToChannel = new Map();
let selfUserId = null;

// ── Per-User State ────────────────────────────────────────────
const PER_USER_STATE_FILE = path.join(DATA_DIR, 'per_user_state.json');
const perUserState = new Map();
const sentByBot = new Set();
const TICKETS_PER_PAGE = 6;
let shiftReminderTimer = null;
let shiftCloseReminderTimer = null;

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
            shift: { lastShiftMessageId: null, lastShiftDate: null, lastShiftClosed: false, reminderSentDate: null, lateReminderSentDate: null, closeReminderSentDate: null, lastShiftContent: null },
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
            migrateOldState();
            return;
        }
        const parsed = JSON.parse(fs.readFileSync(PER_USER_STATE_FILE, 'utf8'));
        for (const [chatId, state] of Object.entries(parsed)) {
            perUserState.set(String(chatId), {
                ticketChat: state.ticketChat || { activeTicketId: null, activeTicketName: null, listPage: 0 },
                shift: {
                    lastShiftMessageId: (state.shift || {}).lastShiftMessageId || null,
                    lastShiftDate: (state.shift || {}).lastShiftDate || null,
                    lastShiftClosed: (state.shift || {}).lastShiftClosed || false,
                    reminderSentDate: (state.shift || {}).reminderSentDate || null,
                    lateReminderSentDate: (state.shift || {}).lateReminderSentDate || null,
                    closeReminderSentDate: (state.shift || {}).closeReminderSentDate || null,
                    lastShiftContent: (state.shift || {}).lastShiftContent || null,
                },
            });
        }
        console.log(`${LOG} 👥 Per-user state loaded for ${perUserState.size} users.`);
    } catch (e) {
        console.error(`${LOG} Ошибка загрузки per_user_state:`, e.message);
    }
}

function migrateOldState() {
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
    } catch { }
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
    } catch { }
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

// ── Groq AI Auto-Reply Check ──────────────────────────────────

const geminiCache = new Map();
let lastGeminiCallTime = 0;
const GEMINI_MIN_INTERVAL_MS = 2000;

async function checkWithGemini(message, ruleName, prompt) {
    if (!config.groqApiKey) return false;

    const cacheKey = `${ruleName}:${message.slice(0, 100)}`;
    if (geminiCache.has(cacheKey)) return geminiCache.get(cacheKey);

    const now = Date.now();
    const timeSinceLast = now - lastGeminiCallTime;
    if (timeSinceLast < GEMINI_MIN_INTERVAL_MS) {
        console.log(`${LOG} ⏳ Groq rate limit, пропускаем (${Math.round((GEMINI_MIN_INTERVAL_MS - timeSinceLast) / 1000)}с)`);
        return false;
    }
    lastGeminiCallTime = Date.now();

    try {
        const body = JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: `Сообщение: "${message}"\n\nОтветь только: ДА или НЕТ` },
            ],
            max_tokens: 5,
            temperature: 0,
        });

        const result = await new Promise((resolve, reject) => {
            const req = https.request({
                hostname: 'api.groq.com',
                path: '/openai/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.groqApiKey}`,
                    'Content-Length': Buffer.byteLength(body),
                },
            }, res => {
                let chunks = '';
                res.on('data', c => chunks += c);
                res.on('end', () => {
                    console.log(`${LOG} 🔍 Groq HTTP статус: ${res.statusCode}`);
                    resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: chunks });
                });
            });
            req.on('error', e => {
                console.error(`${LOG} Groq request error:`, e.message);
                reject(e);
            });
            req.write(body);
            req.end();
        });

        if (!result.ok) {
            console.error(`${LOG} Groq API ${result.status}:`, result.body.slice(0, 200));
            return false;
        }

        const data = JSON.parse(result.body);
        const answer = data?.choices?.[0]?.message?.content?.trim().toUpperCase() || '';
        console.log(`${LOG} 🔍 Groq ответ: "${answer}"`);
        const matched = answer.startsWith('ДА');

        geminiCache.set(cacheKey, matched);
        setTimeout(() => geminiCache.delete(cacheKey), 5 * 60 * 1000);

        console.log(`${LOG} 🤖 Groq [${ruleName}]: "${message.slice(0, 50)}" → ${matched ? 'ДА' : 'НЕТ'}`);
        return matched;
    } catch (e) {
        console.error(`${LOG} Groq ошибка:`, e.message);
        return false;
    }
}

function getAutoReplyGuildIds() {
    const ids = new Set();
    for (const rule of (config.autoReplies || [])) {
        if (rule.guildId) ids.add(rule.guildId);
    }
    return ids;
}

function getAutoReplyGuildChannels() {
    const map = new Map();
    for (const rule of (config.autoReplies || [])) {
        if (rule.guildId && rule.channelId) {
            if (!map.has(rule.guildId)) map.set(rule.guildId, new Set());
            map.get(rule.guildId).add(rule.channelId);
        }
    }
    return map;
}

function subscribeToAutoReplyChannels(guildId) {
    const chIds = [];
    for (const rule of (config.autoReplies || [])) {
        if (rule.guildId === guildId && rule.channelId) chIds.push(rule.channelId);
    }
    if (chIds.length > 0) sendLazyRequest(guildId, chIds);
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
        console.log(`${LOG} 💾 Состояние загружено: ${activeTickets.size} активных, ${dbGetClosedCount()} в истории (SQLite).`);
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

// ── Ticket Message Archives ────────────────────────────────
const ARCHIVES_DIR = path.join(__dirname, 'ticket_archives');
try { if (!fs.existsSync(ARCHIVES_DIR)) fs.mkdirSync(ARCHIVES_DIR, { recursive: true }); } catch (e) { }

// ── SQLite Database ────────────────────────────────────────
const Database = require('better-sqlite3');
const DB_FILE = path.join(DATA_DIR, 'tickets.db');
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
    CREATE TABLE IF NOT EXISTS closed_tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        channel_name TEXT NOT NULL DEFAULT '',
        opener_id TEXT NOT NULL DEFAULT '',
        opener_username TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT 0,
        closed_at INTEGER NOT NULL DEFAULT 0,
        first_staff_reply_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ct_closed_at ON closed_tickets(closed_at);
    CREATE INDEX IF NOT EXISTS idx_ct_channel_id ON closed_tickets(channel_id);

    CREATE TABLE IF NOT EXISTS ticket_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        author_id TEXT NOT NULL DEFAULT '',
        author_username TEXT NOT NULL DEFAULT '',
        author_global_name TEXT,
        author_avatar TEXT,
        author_bot INTEGER NOT NULL DEFAULT 0,
        timestamp TEXT NOT NULL DEFAULT '',
        embeds TEXT,
        attachments TEXT,
        member_roles TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tm_channel_id ON ticket_messages(channel_id);
`);
console.log(`${LOG} 💾 SQLite база данных готова: ${DB_FILE}`);

// ── SQLite Helpers ─────────────────────────────────────────
const stmtInsertClosed = db.prepare(`
    INSERT INTO closed_tickets (channel_id, channel_name, opener_id, opener_username, created_at, closed_at, first_staff_reply_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const stmtInsertMessage = db.prepare(`
    INSERT INTO ticket_messages (channel_id, message_id, content, author_id, author_username, author_global_name, author_avatar, author_bot, timestamp, embeds, attachments, member_roles)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function dbInsertClosedTicket(ticket) {
    stmtInsertClosed.run(
        ticket.channelId, ticket.channelName || '',
        ticket.openerId || '', ticket.openerUsername || '',
        ticket.createdAt || 0, ticket.closedAt || Date.now(),
        ticket.firstStaffReplyAt || null
    );
}

const dbInsertMessages = db.transaction((channelId, messages) => {
    // Clear old messages for this channel first (re-archive support)
    db.prepare('DELETE FROM ticket_messages WHERE channel_id = ?').run(channelId);
    for (const m of messages) {
        stmtInsertMessage.run(
            channelId,
            m.id || '',
            m.content || '',
            m.author?.id || '',
            m.author?.username || '',
            m.author?.global_name || null,
            m.author?.avatar || null,
            m.author?.bot ? 1 : 0,
            m.timestamp || '',
            m.embeds ? JSON.stringify(m.embeds) : null,
            m.attachments ? JSON.stringify(m.attachments) : null,
            m.member?.roles ? JSON.stringify(m.member.roles) : null
        );
    }
});

function dbGetClosedTickets({ page = 1, limit = 50, search = '' } = {}) {
    let where = '';
    const params = [];
    if (search) {
        where = 'WHERE channel_name LIKE ? OR opener_username LIKE ?';
        params.push(`%${search}%`, `%${search}%`);
    }
    const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM closed_tickets ${where}`).get(...params);
    const total = countRow.cnt;
    const offset = (page - 1) * limit;
    params.push(limit, offset);
    const rows = db.prepare(`SELECT * FROM closed_tickets ${where} ORDER BY closed_at DESC LIMIT ? OFFSET ?`).all(...params);
    return {
        tickets: rows.map(r => ({
            channelId: r.channel_id,
            channelName: r.channel_name,
            openerId: r.opener_id,
            openerUsername: r.opener_username,
            createdAt: r.created_at,
            closedAt: r.closed_at,
            firstStaffReplyAt: r.first_staff_reply_at,
        })),
        total,
        page,
        totalPages: Math.ceil(total / limit),
    };
}

function dbGetAllClosedTickets() {
    const rows = db.prepare('SELECT * FROM closed_tickets ORDER BY closed_at DESC').all();
    return rows.map(r => ({
        channelId: r.channel_id,
        channelName: r.channel_name,
        openerId: r.opener_id,
        openerUsername: r.opener_username,
        createdAt: r.created_at,
        closedAt: r.closed_at,
        firstStaffReplyAt: r.first_staff_reply_at,
    }));
}

function dbGetTicketMessages(channelId) {
    const rows = db.prepare('SELECT * FROM ticket_messages WHERE channel_id = ? ORDER BY id ASC').all(channelId);
    return rows.map(r => ({
        id: r.message_id,
        content: r.content,
        author: {
            id: r.author_id,
            username: r.author_username,
            global_name: r.author_global_name,
            avatar: r.author_avatar,
            bot: !!r.author_bot,
        },
        timestamp: r.timestamp,
        embeds: r.embeds ? JSON.parse(r.embeds) : [],
        attachments: r.attachments ? JSON.parse(r.attachments) : [],
        member: r.member_roles ? { roles: JSON.parse(r.member_roles) } : undefined,
    }));
}

function dbGetClosedCount() {
    return db.prepare('SELECT COUNT(*) as cnt FROM closed_tickets').get().cnt;
}

// ── Migrate existing JSON data to SQLite (one-time) ────────
function migrateJsonToSqlite() {
    const existing = db.prepare('SELECT COUNT(*) as cnt FROM closed_tickets').get().cnt;
    if (existing > 0) return; // Already migrated

    // Migrate closed tickets from persistent_state
    try {
        const stateData = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        const closed = stateData.closedTickets || [];
        if (closed.length > 0) {
            const insertMany = db.transaction((tickets) => {
                for (const t of tickets) {
                    if (!t.channelId) continue; // skip invalid entries
                    try { dbInsertClosedTicket(t); } catch { }
                }
            });
            insertMany(closed);
            console.log(`${LOG} 📦 Мигрировано ${closed.length} закрытых тикетов в SQLite.`);
        }
    } catch (e) {
        console.log(`${LOG} ℹ️ Нет данных для миграции closedTickets: ${e.message}`);
    }

    // Migrate JSON archives to SQLite
    try {
        const files = fs.readdirSync(ARCHIVES_DIR).filter(f => f.endsWith('.json'));
        let count = 0;
        for (const file of files) {
            try {
                const archive = JSON.parse(fs.readFileSync(path.join(ARCHIVES_DIR, file), 'utf8'));
                if (archive.messages && archive.messages.length > 0) {
                    dbInsertMessages(archive.channelId || file.replace('.json', ''), archive.messages);
                    count++;
                }
            } catch { }
        }
        if (count > 0) console.log(`${LOG} 📦 Мигрировано ${count} архивов сообщений в SQLite.`);
    } catch (e) {
        console.log(`${LOG} ℹ️ Нет архивов для миграции: ${e.message}`);
    }
}
migrateJsonToSqlite();

async function archiveTicketMessages(channelId, record) {
    try {
        const messages = await fetchChannelMessages(channelId, 100, GATEWAY_TOKEN);
        if (!messages || messages.length === 0) return;
        const archive = {
            channelId,
            channelName: record?.channelName || channelId,
            openerId: record?.openerId || '',
            openerUsername: record?.openerUsername || '',
            createdAt: record?.createdAt || Date.now(),
            archivedAt: Date.now(),
            messages: messages.reverse().map(m => ({
                id: m.id,
                content: m.content || '',
                author: {
                    id: m.author?.id,
                    username: m.author?.username,
                    global_name: m.author?.global_name,
                    avatar: m.author?.avatar,
                    bot: m.author?.bot || false,
                },
                timestamp: m.timestamp,
                embeds: (m.embeds || []).map(e => ({
                    title: e.title, description: e.description, color: e.color,
                    fields: e.fields, footer: e.footer, author: e.author, url: e.url,
                    thumbnail: e.thumbnail, image: e.image,
                })),
                attachments: (m.attachments || []).map(a => ({
                    id: a.id, filename: a.filename, url: a.url, content_type: a.content_type,
                })),
            })),
        };
        fs.writeFileSync(path.join(ARCHIVES_DIR, `${channelId}.json`), JSON.stringify(archive, null, 2), 'utf8');
        // Also save to SQLite
        try { dbInsertMessages(channelId, archive.messages); } catch (e) { console.error(`${LOG} SQLite archive error:`, e.message); }
    } catch (e) {
        console.error(`${LOG} Ошибка архивации тикета ${channelId}:`, e.message);
    }
}

// Periodically snapshot all active tickets' messages
async function snapshotAllActiveTickets() {
    for (const [chId, record] of activeTickets) {
        try {
            await archiveTicketMessages(chId, record);
            await sleep(500);
        } catch { }
    }
}

function startAutosave() {
    autosaveTimer = setInterval(() => { if (stateDirty) saveState(); }, AUTOSAVE_INTERVAL_MS);
    // Snapshot active tickets' messages every 2 minutes
    setInterval(() => { snapshotAllActiveTickets().catch(() => { }); }, 2 * 60 * 1000);
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
                try { const j = JSON.parse(res.body); await sleep((j?.parameters?.retry_after ?? 5) * 1000); } catch { }
            }
            return { ok: false, messageId: null };
        }
        let messageId = null;
        try { const j = JSON.parse(res.body); if (j.ok && j.result) messageId = j.result.message_id; } catch { }
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
    } catch { }
    return null;
}

async function tgCloseForumTopic(threadId) {
    try {
        await httpPost(`${TELEGRAM_API}/closeForumTopic`, { chat_id: users[0]?.tgChatId, message_thread_id: threadId });
    } catch { }
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
            if (result.messageId && item.channelId) {
                tgMsgToChannel.set(result.messageId, { channelId: item.channelId, chatId: item.chatId });
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
                addLog('error', `Сообщение потеряно после ${MAX_RETRIES} попыток отправки`);
            } else {
                await sleep(RETRY_DELAY_MS * item.retries);
            }
        }
    }
    queueRunning = false;
}

// ── Discord REST: Send Message ────────────────────────────────

async function sendDiscordMessage(channelId, content, token, replyToMessageId) {
    const url = `https://discord.com/api/v9/channels/${channelId}/messages`;
    const payload = { content };
    if (replyToMessageId) payload.message_reference = { message_id: replyToMessageId };
    const body = JSON.stringify(payload);
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
    const channelId = mapping?.channelId || mapping;
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

    const buttons = [];
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

    const navRow = [];
    if (page > 0) navRow.push({ text: '⬅️ Назад', callback_data: `tpage_${page - 1}` });
    navRow.push({ text: '🔄 Обновить', callback_data: `tpage_${page}` });
    if (page < totalPages - 1) navRow.push({ text: 'Вперёд ➡️', callback_data: `tpage_${page + 1}` });
    buttons.push(navRow);

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
                [{ text: '📜 История чата', callback_data: 'thistory' }],
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
            const res = await sendDiscordMessage(channelId, part, token);
            if (!res.ok) {
                return { text: `❌ Ошибка Discord (${res.status})`, markup: null };
            }
            try {
                const j = JSON.parse(res.body);
                if (j.id) {
                    sentByBot.add(j.id);
                    if (sentByBot.size > 500) {
                        const arr = [...sentByBot];
                        for (let i = 0; i < arr.length - 250; i++) sentByBot.delete(arr[i]);
                    }
                }
            } catch { }
        }
        console.log(`${LOG} ✉️ /s → #${channelName}: ${text.slice(0, 60)}`);
        addLog('message', `Сообщение отправлено в #${channelName}`);
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

// ── History, Binds, Greet ─────────────────────────────────────

async function fetchChannelMessages(channelId, limit = 100, token) {
    try {
        const res = await httpGet(
            `https://discord.com/api/v9/channels/${channelId}/messages?limit=${limit}`,
            { Authorization: token || GATEWAY_TOKEN }
        );
        if (!res.ok) return [];
        return JSON.parse(res.body);
    } catch { return []; }
}

async function handleHistory(chatId) {
    const uState = getUserState(chatId).ticketChat;
    if (!uState.activeTicketId) {
        return [{ text: '❌ Сначала выбери тикет через /list', markup: null }];
    }
    const token = getDiscordToken(chatId);
    const channelId = uState.activeTicketId;
    const channelName = uState.activeTicketName || channelId;
    const messages = await fetchChannelMessages(channelId, 100, token);
    if (!messages || messages.length === 0) {
        return [{ text: '📭 Нет сообщений в тикете.', markup: null }];
    }
    messages.reverse();
    const lines = [`📜 <b>История #${escapeHtml(channelName)}</b> (${messages.length} сообщ.)\n`];
    for (const msg of messages) {
        if (!msg.author) continue;
        if (msg.author.bot) continue;
        const ts = new Date(msg.timestamp);
        const time = ts.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        const nick = msg.member?.nick || msg.author.global_name || msg.author.username || 'Неизвестно';
        const isStaff = msg.member?.roles?.some(r => config.staffRoleIds.includes(r)) || false;
        const icon = isStaff ? '👮' : '👤';
        const content = msg.content ? escapeHtml(truncate(msg.content, 200)) : '(вложение)';
        lines.push(`${icon} ${escapeHtml(nick)} (${time}): ${content}`);
    }
    const fullText = lines.join('\n');
    if (fullText.length <= 4096) {
        return [{ text: fullText, markup: null }];
    }
    const chunks = [];
    let remaining = fullText;
    while (remaining.length > 0) {
        if (remaining.length <= 4096) {
            chunks.push({ text: remaining, markup: null });
            break;
        }
        let cut = remaining.lastIndexOf('\n', 4096);
        if (cut < 2000) cut = 4096;
        chunks.push({ text: remaining.slice(0, cut), markup: null });
        remaining = remaining.slice(cut).trimStart();
    }
    return chunks;
}

function handleBindsList() {
    if (!config.binds || Object.keys(config.binds).length === 0) {
        return '📭 Нет сохранённых биндов.';
    }
    const lines = [
        '╔══════════════════════════╗',
        '║  📋  <b>БИНДЫ (ШАБЛОНЫ)</b>',
        '╚══════════════════════════╝',
        '',
    ];
    for (const [key, bind] of Object.entries(config.binds)) {
        const preview = escapeHtml(truncate(bind.message || '', 60));
        lines.push(`  <b>/${escapeHtml(key)}</b> — <i>${preview}</i>`);
    }
    lines.push('', `Всего: ${Object.keys(config.binds).length}`);
    lines.push('', '<code>/addbind</code> &lt;имя&gt; &lt;текст&gt; — добавить');
    lines.push('<code>/delbind</code> &lt;имя&gt; — удалить');
    lines.push('<code>/имя_бинда</code> — отправить в тикет');
    return lines.join('\n');
}

async function handleBindSearch(query, chatId) {
    const uState = getUserState(chatId).ticketChat;
    if (!uState.activeTicketId) {
        return { text: '❌ Сначала выбери тикет через /list', markup: null };
    }
    if (!config.binds || Object.keys(config.binds).length === 0) return null;
    const q = query.toLowerCase().trim();
    if (q.length < 2) return null;
    const matches = [];
    for (const [key, bind] of Object.entries(config.binds)) {
        const k = key.toLowerCase();
        if (k.startsWith(q) || q.startsWith(k)) {
            matches.push(bind);
        }
    }
    if (matches.length === 0) return null;
    if (matches.length === 1) {
        const bind = matches[0];
        const token = getDiscordToken(chatId);
        const channelId = uState.activeTicketId;
        try {
            const res = await sendDiscordMessage(channelId, bind.message, token);
            if (res.ok) {
                try { const j = JSON.parse(res.body); if (j.id) sentByBot.add(j.id); } catch { }
                console.log(`${LOG} 📎 Бинд "${bind.name}" → #${uState.activeTicketName || channelId}`);
                addLog('bind', `Бинд «${bind.name}» отправлен в #${uState.activeTicketName || channelId}`);
                return { text: `✅ Отправлено: "<b>${escapeHtml(bind.name)}</b>"`, markup: null };
            }
            return { text: `❌ Ошибка Discord (${res.status})`, markup: null };
        } catch (e) {
            return { text: `❌ Ошибка: ${e.message}`, markup: null };
        }
    }
    const buttons = [];
    for (let i = 0; i < matches.length; i += 2) {
        const row = [];
        row.push({ text: matches[i].name, callback_data: `bind_${matches[i].name}` });
        if (i + 1 < matches.length) {
            row.push({ text: matches[i + 1].name, callback_data: `bind_${matches[i + 1].name}` });
        }
        buttons.push(row);
    }
    return {
        text: `🔍 Найдено ${matches.length} биндов. Выбери:`,
        markup: { inline_keyboard: buttons },
    };
}

function handleAddBind(argsStr) {
    const spaceIdx = argsStr.indexOf(' ');
    if (spaceIdx === -1 || !argsStr.trim()) {
        return '❌ Формат: /addbind &lt;название&gt; &lt;текст&gt;';
    }
    const name = argsStr.slice(0, spaceIdx).trim();
    const message = argsStr.slice(spaceIdx + 1).trim();
    if (!name || !message) {
        return '❌ Формат: /addbind &lt;название&gt; &lt;текст&gt;';
    }
    if (!config.binds) config.binds = {};
    config.binds[name] = { name, message };
    saveConfig();
    console.log(`${LOG} ➕ Бинд "${name}" добавлен.`);
    addLog('bind', `Бинд «${name}» добавлен`);
    return `✅ Бинд "<b>${escapeHtml(name)}</b>" добавлен.\n\n<i>${escapeHtml(truncate(message, 100))}</i>`;
}

function handleDelBind(name) {
    if (!name.trim()) return '❌ Формат: /delbind &lt;название&gt;';
    if (!config.binds || !config.binds[name]) {
        return `❌ Бинд "${escapeHtml(name)}" не найден.`;
    }
    delete config.binds[name];
    saveConfig();
    console.log(`${LOG} ➖ Бинд "${name}" удалён.`);
    addLog('bind', `Бинд «${name}» удалён`);
    return `✅ Бинд "<b>${escapeHtml(name)}</b>" удалён.`;
}

function handleSetGreet(text) {
    if (!text.trim()) return '❌ Формат: /setgreet &lt;текст приветствия&gt;';
    config.autoGreetText = text.trim();
    saveConfig();
    console.log(`${LOG} 👋 Текст приветствия обновлён.`);
    addLog('greet', `Текст приветствия обновлён`);
    return `✅ Текст приветствия обновлён:\n\n<blockquote>${escapeHtml(config.autoGreetText)}</blockquote>`;
}

function handleGreet(args) {
    if (!args || !args.trim()) {
        const status = config.autoGreetEnabled ? '✅ Включено' : '❌ Выключено';
        return [
            '╔══════════════════════════╗',
            '║  👋  <b>АВТО-ПРИВЕТСТВИЕ</b>',
            '╚══════════════════════════╝',
            '',
            `Статус: <b>${status}</b>`,
            `Текст: <i>${escapeHtml(config.autoGreetText || '')}</i>`,
            `Роли: <code>${(config.autoGreetRoleIds || []).join(', ') || 'нет'}</code>`,
            '',
            '/greet on — включить',
            '/greet off — выключить',
            '/setgreet &lt;текст&gt; — изменить текст',
        ].join('\n');
    }
    const arg = args.trim().toLowerCase();
    if (arg === 'on') {
        config.autoGreetEnabled = true;
        saveConfig();
        console.log(`${LOG} 👋 Авто-приветствие включено.`);
        addLog('greet', `Авто-приветствие включено`);
        return '✅ Авто-приветствие <b>включено</b>.';
    } else if (arg === 'off') {
        config.autoGreetEnabled = false;
        saveConfig();
        console.log(`${LOG} 👋 Авто-приветствие выключено.`);
        addLog('greet', `Авто-приветствие выключено`);
        return '❌ Авто-приветствие <b>выключено</b>.';
    }
    return '❌ Используй: /greet on или /greet off';
}

// ── Shift (Смена) System ──────────────────────────────────────

function getKyivDate() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: SHIFT_TZ });
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
    console.log(`${LOG} 📋 Shift state: per-user (loaded via per_user_state.json)`);
}

function saveShiftState() {
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
        try { const j = JSON.parse(res.body); msgId = j.id; } catch { }
        shiftState.lastShiftMessageId = msgId;
        shiftState.lastShiftDate = today;
        shiftState.lastShiftClosed = false;
        shiftState.lastShiftContent = content;
        savePerUserState();
        console.log(`${LOG} ✅ Смена начата (${userName}): ${dateStr}, msgId=${msgId}`);
        addLog('shift', `${userName}: смена начата (${dateStr})`);
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
        let oldContent = shiftState.lastShiftContent;
        if (!oldContent && shiftState.lastShiftDate) {
            const d = shiftState.lastShiftDate;
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
        addLog('shift', `${getUserName(chatId)}: смена закрыта`);
        return `✅ <b>Смена закрыта!</b>\n\nDiscord сообщение отредактировано: "Начал/ Закрыл"`;
    } catch (e) {
        return `❌ Ошибка: ${e.message}`;
    }
}

// ── Shift Reminder ────────────────────────────────────────────

function getKyivNow() {
    const now = new Date();
    return new Date(now.toLocaleString('en-US', { timeZone: SHIFT_TZ }));
}

function msUntilKyivHour(targetHour, targetMinute = 0) {
    const kyivNow = getKyivNow();
    const target = new Date(kyivNow);
    target.setHours(targetHour, targetMinute, 0, 0);
    let ms = target.getTime() - kyivNow.getTime();
    if (ms < 0) ms += 24 * 60 * 60 * 1000;
    return ms;
}

function scheduleShiftReminder() {
    if (shiftReminderTimer) { clearTimeout(shiftReminderTimer); shiftReminderTimer = null; }
    const today = getKyivDate();
    const hour = getKyivHour();
    const minute = getKyivMinute();
    console.log(`${LOG} 📋 scheduleShiftReminder: Kyiv time = ${hour}:${String(minute).padStart(2, '0')}, date = ${today}`);

    const allCheckedIn = users.every(u => {
        const ss = getUserState(u.tgChatId).shift;
        return ss.lastShiftDate === today;
    });

    if (allCheckedIn) {
        const ms = msUntilKyivHour(11, 0);
        console.log(`${LOG} 📋 Все отмечены. Следующее напоминание через ${Math.round(ms / 3600000)}ч`);
        shiftReminderTimer = setTimeout(() => scheduleShiftReminder(), ms);
        return;
    }

    if (hour < 11) {
        const ms = msUntilKyivHour(11, 0);
        console.log(`${LOG} 📋 Напоминание о смене через ${Math.round(ms / 60000)} мин (11:00)`);
        shiftReminderTimer = setTimeout(() => {
            sendShiftStartReminder();
            scheduleShiftLateReminder();
        }, ms);
    } else if (hour === 11) {
        const needsStart = users.some(u => {
            const ss = getUserState(u.tgChatId).shift;
            return ss.lastShiftDate !== today && ss.reminderSentDate !== today;
        });
        console.log(`${LOG} 📋 11:xx, needsStart=${needsStart}`);
        if (needsStart) sendShiftStartReminder();
        scheduleShiftLateReminder();
    } else if (hour < 23) {
        const needsLate = users.some(u => {
            const ss = getUserState(u.tgChatId).shift;
            return ss.lastShiftDate !== today && ss.lateReminderSentDate !== today;
        });
        console.log(`${LOG} 📋 ${hour}:xx, needsLate=${needsLate}`);
        if (needsLate) {
            sendShiftLateReminder();
        } else {
            const ms = msUntilKyivHour(11, 0);
            console.log(`${LOG} 📋 Все напоминания отправлены. Следующее через ${Math.round(ms / 3600000)}ч`);
            shiftReminderTimer = setTimeout(() => scheduleShiftReminder(), ms);
        }
    } else {
        const ms = msUntilKyivHour(11, 0);
        shiftReminderTimer = setTimeout(() => scheduleShiftReminder(), ms);
    }

    scheduleShiftCloseReminder();
}

function scheduleShiftLateReminder() {
    if (shiftReminderTimer) { clearTimeout(shiftReminderTimer); shiftReminderTimer = null; }
    const ms = msUntilKyivHour(12, 0);
    const hour = getKyivHour();
    if (hour >= 12) {
        sendShiftLateReminder();
        return;
    }
    console.log(`${LOG} 📋 Напоминание "опаздываете" через ${Math.round(ms / 60000)} мин (12:00)`);
    shiftReminderTimer = setTimeout(() => {
        const today = getKyivDate();
        const allDone = users.every(u => {
            const ss = getUserState(u.tgChatId).shift;
            return ss.lastShiftDate === today;
        });
        if (allDone) {
            const msNext = msUntilKyivHour(11, 0);
            shiftReminderTimer = setTimeout(() => scheduleShiftReminder(), msNext);
            return;
        }
        sendShiftLateReminder();
    }, ms);
}

function scheduleShiftCloseReminder() {
    if (shiftCloseReminderTimer) { clearTimeout(shiftCloseReminderTimer); shiftCloseReminderTimer = null; }
    const today = getKyivDate();
    const hour = getKyivHour();

    const needsCloseReminder = users.some(u => {
        const ss = getUserState(u.tgChatId).shift;
        return ss.lastShiftDate === today && !ss.lastShiftClosed && ss.closeReminderSentDate !== today;
    });

    if (hour >= 23) {
        if (needsCloseReminder) sendShiftCloseReminder();
        return;
    }

    const ms = msUntilKyivHour(23, 0);
    console.log(`${LOG} 📋 Напоминание о закрытии смены через ${Math.round(ms / 60000)} мин (23:00)`);
    shiftCloseReminderTimer = setTimeout(() => {
        const todayNow = getKyivDate();
        const needsClose = users.some(u => {
            const ss = getUserState(u.tgChatId).shift;
            return ss.lastShiftDate === todayNow && !ss.lastShiftClosed && ss.closeReminderSentDate !== todayNow;
        });
        if (needsClose) sendShiftCloseReminder();
    }, ms);
}

async function sendShiftStartReminder() {
    const today = getKyivDate();
    console.log(`${LOG} ⏰ 11:00 — напоминание о начале смены`);
    const text = '🕚 <b>Пора отмечаться на смену!</b>\n\nНачинай смену, время 11:00.';
    const keyboard = {
        inline_keyboard: [[
            { text: '✅ Отметиться', callback_data: 'shift_checkin' },
            { text: '⏭ Пропустить', callback_data: 'shift_skip' },
        ]]
    };
    for (const user of users) {
        const ss = getUserState(user.tgChatId).shift;
        if (ss.lastShiftDate === today || ss.reminderSentDate === today) continue;
        ss.reminderSentDate = today;
        await tgSendMessage(user.tgChatId, text, keyboard);
    }
    savePerUserState();
}

async function sendShiftLateReminder() {
    const today = getKyivDate();
    console.log(`${LOG} ⏰ 12:00 — опоздание на смену`);
    const text = '🚨 <b>Вы опаздываете на смену!</b>\n\nУже 12:00, а вы ещё не отметились. Хотите отметиться сейчас?';
    const keyboard = {
        inline_keyboard: [[
            { text: '✅ Отметиться', callback_data: 'shift_checkin' },
            { text: '⏭ Пропустить', callback_data: 'shift_skip' },
        ]]
    };
    for (const user of users) {
        const ss = getUserState(user.tgChatId).shift;
        if (ss.lastShiftDate === today || ss.lateReminderSentDate === today) continue;
        ss.lateReminderSentDate = today;
        await tgSendMessage(user.tgChatId, text, keyboard);
    }
    savePerUserState();
    const msNext = msUntilKyivHour(11, 0);
    shiftReminderTimer = setTimeout(() => scheduleShiftReminder(), msNext);
}

async function sendShiftCloseReminder() {
    const today = getKyivDate();
    console.log(`${LOG} ⏰ 23:00 — напоминание о закрытии смены`);
    const text = '🕐 <b>Не забудьте закрыть смену!</b>\n\nУже 23:00. Закройте смену командой /smenoff.';
    const keyboard = {
        inline_keyboard: [[
            { text: '🔒 Закрыть смену', callback_data: 'shift_close' },
        ]]
    };
    for (const user of users) {
        const ss = getUserState(user.tgChatId).shift;
        if (ss.lastShiftDate !== today) continue;
        if (ss.lastShiftClosed) continue;
        if (ss.closeReminderSentDate === today) continue;
        ss.closeReminderSentDate = today;
        await tgSendMessage(user.tgChatId, text, keyboard);
    }
    savePerUserState();
}

async function tgAnswerCallbackQuery(callbackQueryId, text) {
    try {
        await httpPost(`${TELEGRAM_API}/answerCallbackQuery`, {
            callback_query_id: callbackQueryId,
            text: text || '',
        });
    } catch { }
}

async function tgEditMessageText(chatId, messageId, text, replyMarkup) {
    const payload = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', disable_web_page_preview: true };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    try {
        await httpPost(`${TELEGRAM_API}/editMessageText`, payload);
    } catch { }
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
        addLog('timer', `Таймер «${type === 'closing' ? 'можно закрывать' : 'нет ответа'}» — #${record.channelName} (${timeoutMin} мин.)`);
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
    return {
        text, channelId: channel.id, replyMarkup: {
            inline_keyboard: [
                [{ text: '✅ Взять тикет', callback_data: `tsel_${channel.id}` }, { text: '🔗 Открыть в Discord', url: link }]
            ]
        }
    };
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
    return {
        text, channelId: message.channel_id, replyMarkup: {
            inline_keyboard: [
                [{ text: '✅ Взять тикет', callback_data: `tsel_${message.channel_id}` }, { text: '🔗 Перейти в Discord', url: link }]
            ]
        }
    };
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
        `📜  <b>История и бинды:</b>`,
        `  /history — история сообщений тикета`,
        `  /binds — все шаблоны ответов`,
        `  /addbind &lt;имя&gt; &lt;текст&gt; — добавить шаблон`,
        `  /delbind &lt;имя&gt; — удалить шаблон`,
        `  /&lt;имя&gt; — быстрый поиск и отправка бинда`,
        ``,
        `👋  <b>Авто-приветствие:</b>`,
        `  /greet — статус авто-приветствия`,
        `  /greet on|off — вкл/выкл`,
        `  /setgreet &lt;текст&gt; — изменить текст`,
        ``,
        `📅  <b>Смена:</b>`,
        `  /smena — начать смену (отметка в Discord)`,
        `  /smenoff — закрыть смену`,
        `  ⏰ Авто-напоминание в 11:00 если не отмечено`,
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
    closingCheckMin: { type: 'number', min: 1, max: 120, desc: 'Таймер закрытия (мин.)' },
    maxMessageLength: { type: 'number', min: 50, max: 2000, desc: 'Макс. длина сообщения' },
    pollingIntervalSec: { type: 'number', min: 1, max: 30, desc: 'Интервал опроса TG (сек.)' },
    notifyOnClose: { type: 'bool', desc: 'Уведомление о закрытии' },
    includeFirstUserMessage: { type: 'bool', desc: 'Первое сообщение игрока' },
    mentionOnHighPriority: { type: 'bool', desc: 'Упоминание при приоритете' },
    forumMode: { type: 'bool', desc: 'Режим форума' },
    closingPhrase: { type: 'string', desc: 'Фразы закрытия (через запятую)' },
    ticketPrefix: { type: 'string', desc: 'Префикс тикет-канала' },
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
    addLog('system', `Настройка изменена: ${key} = ${newValue}`);

    let display = meta.type === 'bool' ? (newValue ? '✅ вкл.' : '❌ выкл.') : `${newValue}`;
    let oldDisplay = meta.type === 'bool' ? (oldValue ? '✅ вкл.' : '❌ выкл.') : `${oldValue}`;
    return `✅ <b>${meta.desc}</b>\n\n<code>${key}</code>: ${oldDisplay} → <b>${display}</b>`;
}

function handlePause() {
    if (botPaused) return '⏸ Бот уже на паузе.';
    botPaused = true;
    console.log(`${LOG} ⏸ Бот поставлен на паузу.`);
    addLog('system', `Бот поставлен на паузу`);
    return '⏸ <b>Бот поставлен на паузу.</b>\nУведомления приостановлены. Команды работают.\n/resume — возобновить.';
}

function handleResume() {
    if (!botPaused) return '▶️ Бот уже работает.';
    botPaused = false;
    console.log(`${LOG} ▶️ Бот возобновлён.`);
    addLog('system', `Бот возобновлён`);
    return '▶️ <b>Бот возобновлён!</b>\nУведомления снова активны.';
}

function handleReset() {
    const oldCreated = ps.totalCreated;
    const oldClosed = ps.totalClosed;
    const oldMessages = ps.totalMessagesSent;
    ps.totalCreated = 0;
    ps.totalClosed = 0;
    ps.totalMessagesSent = 0;
    try { db.prepare('DELETE FROM closed_tickets').run(); db.prepare('DELETE FROM ticket_messages').run(); } catch (e) { console.error(e); }
    ps.hourlyBuckets = new Array(24).fill(0);
    sessionStats.messagesFailed = 0;
    markDirty();
    console.log(`${LOG} 🔄 Статистика сброшена.`);
    addLog('system', `Статистика сброшена`);
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
    const closed = dbGetAllClosedTickets();
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

// ── Discord REST API ──────────────────────────────────────────

function requestLazyGuild(guildId) {
    fetchGuildChannelsREST(guildId);
}

function sendLazyRequest(guildId, channelIds) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!channelIds || channelIds.length === 0) return;

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
        console.log(`${LOG} 📡 Lazy Request: подписка на ${channelIds.length} каналов.`);
    } catch (e) {
        console.error(`${LOG} Lazy Request ошибка:`, e.message);
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
                    console.log(`${LOG} 🗑️ Канал ${chId} не найден (404), удаляем из activeTickets.`);
                    const stale = activeTickets.get(chId);
                    if (stale) {
                        archiveTicketMessages(chId, stale).catch(() => { });
                        dbInsertClosedTicket({
                            channelId: chId,
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
        // Save initial archive snapshot for all active tickets
        snapshotAllActiveTickets().catch(() => { });
    })();
}

function subscribeToSingleChannel(guildId, channelId) {
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
    if (guild.id !== config.guildId) {
        let chCount = 0;
        for (const ch of guild.channels || []) {
            channelCache.set(ch.id, { ...ch, guild_id: guild.id });
            chCount++;
        }
        if (chCount > 0 && !IS_BOT_TOKEN) {
            subscribeToAutoReplyChannels(guild.id);
        }
        return;
    }

    guildCache.set(guild.id, { id: guild.id, name: guild.name || 'Unknown' });

    // Cache roles and members from gateway
    if (guild.roles) {
        for (const r of guild.roles) guildRolesCache.set(r.id, r);
    }
    if (guild.members) {
        for (const m of guild.members) {
            if (m.user) guildMembersCache.set(m.user.id, m);
        }
    }
    if (guild.presences) {
        for (const p of guild.presences) {
            if (p.user?.id) guildPresenceCache.set(p.user.id, p.status || 'offline');
        }
    }
    console.log(`${LOG} 👥 Закэшировано: ${guildRolesCache.size} ролей, ${guildMembersCache.size} участников, ${guildPresenceCache.size} статусов`);

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
        if (!IS_BOT_TOKEN) requestLazyGuild(guild.id);
    }

    if (!IS_BOT_TOKEN) subscribeToTicketChannels(guild.id);

    // Request member sidebar to populate member cache for the dashboard
    if (!IS_BOT_TOKEN && guild.id === config.guildId) {
        setTimeout(() => {
            // Find a suitable channel to request the member sidebar from
            // Preferring channels that aren't ticket channels (e.g., general or rules)
            let sidebarChannelId = null;
            for (const [chId, ch] of channelCache) {
                if (ch.guild_id === config.guildId && ch.type === 0 && ch.parent_id !== config.ticketsCategoryId) {
                    sidebarChannelId = chId;
                    break;
                }
            }
            if (sidebarChannelId) {
                // Request member sidebar with wider range to get more members
                if (ws && ws.readyState === WebSocket.OPEN) {
                    const channels = {};
                    channels[sidebarChannelId] = [[0, 99], [100, 199], [200, 299]];
                    ws.send(JSON.stringify({
                        op: 14,
                        d: {
                            guild_id: config.guildId,
                            typing: true,
                            threads: true,
                            activities: true,
                            members: [],
                            channels,
                        }
                    }));
                    console.log(`${LOG} 👥 Запрос списка участников для дашборда (канал: ${sidebarChannelId})`);
                }
            }
        }, 3000); // Delay to let channels cache populate first
    }

    scanExistingTickets();
    restoreActivityTimers();

    if (!pollingTimer) schedulePolling();
}

function onChannelCreate(data) {
    const guildId = data.guild_id || config.guildId;
    if (guildId !== config.guildId) return;
    data.guild_id = guildId;
    channelCache.set(data.id, data);
    console.log(`${LOG} 📢 CHANNEL_CREATE: #${data.name || data.id} (parent: ${data.parent_id || 'none'})`);

    if (activeTickets.has(data.id)) return;
    const record = registerTicket(data);
    if (!record) return;
    if (botPaused) { console.log(`${LOG} ⏸ Пауза — пропускаем уведомление о новом тикете.`); return; }

    if (notifiedTicketIds.has(data.id)) {
        console.log(`${LOG} ⚠️ Дубль CHANNEL_CREATE для #${data.name}, пропускаем.`);
        return;
    }
    notifiedTicketIds.add(data.id);
    setTimeout(() => notifiedTicketIds.delete(data.id), 60_000);

    console.log(`${LOG} ✅ Новый тикет (CHANNEL_CREATE): #${data.name}`);
    addLog('ticket', `Новый тикет: #${data.name || data.id}`);
    if (io) io.emit('ticket:new', record);
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

    archiveTicketMessages(data.id, fallback).catch(() => { });

    dbInsertClosedTicket({
        channelId: data.id,
        channelName: fallback.channelName,
        openerId: fallback.openerId,
        openerUsername: fallback.openerUsername,
        createdAt: fallback.createdAt,
        closedAt: Date.now(),
        firstStaffReplyAt: fallback.firstStaffReplyAt,
    });

    activeTickets.delete(data.id);
    notifiedFirstMessage.delete(data.id);
    autoGreetedChannels.delete(data.id);
    ps.totalClosed++;
    markDirty();
    addLog('ticket', `Тикет закрыт: #${fallback.channelName}`);
    if (io) io.emit('ticket:closed', data.id);

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
        if (notifiedTicketIds.has(data.id)) {
            console.log(`${LOG} ⚠️ Дубль THREAD_CREATE для #${data.name}, пропускаем.`);
            return;
        }
        notifiedTicketIds.add(data.id);
        setTimeout(() => notifiedTicketIds.delete(data.id), 60_000);

        console.log(`${LOG} ✅ Новый тред-тикет (THREAD_CREATE): #${data.name}`);
        addLog('ticket', `Новый тред-тикет: #${data.name || data.id}`);
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

// ── onMessageCreate ───────────────────────────────────────────
function onMessageCreate(data) {
    const guildId = data.guild_id || channelCache.get(data.channel_id)?.guild_id;
    const channelId = data.channel_id;

    if (config.autoReplies && data.content && data.author && !data.author.bot) {
        const normalized = data.content.toLowerCase().replace(/[?!.,;:()]/g, ' ').replace(/\s+/g, ' ').trim();
        for (const rule of config.autoReplies) {
            if (!rule.enabled) continue;
            if (rule.channelId !== channelId) continue;

            if (rule.excludeAny && rule.excludeAny.some(ex => normalized.includes(ex.toLowerCase()))) {
                continue;
            }

            let matched = false;

            if (rule.includeAll && Array.isArray(rule.includeAll)) {
                matched = rule.includeAll.every(group => {
                    if (Array.isArray(group)) return group.some(p => normalized.includes(p.toLowerCase()));
                    return normalized.includes(String(group).toLowerCase());
                });
            } else if (rule.includeAny && Array.isArray(rule.includeAny)) {
                matched = rule.includeAny.some(p => normalized.includes(p.toLowerCase()));
            } else if (rule.patterns && Array.isArray(rule.patterns)) {
                matched = rule.patterns.some(p => normalized.includes(p.toLowerCase()));
            } else if (rule.geminiPrompt) {
                const geminiTriggers = rule.geminiTriggers || [];
                const hasTrigger = geminiTriggers.length === 0 || geminiTriggers.some(t => {
                    if (t.length <= 2) return false;
                    return normalized.includes(t.toLowerCase());
                });
                if (!hasTrigger) continue;

                const ruleCopy = rule;
                const msgCopy = data.content;
                const chIdCopy = channelId;
                const msgIdCopy = data.id;
                (async () => {
                    try {
                        const aiMatched = await checkWithGemini(msgCopy, ruleCopy.name || 'gemini', ruleCopy.geminiPrompt);
                        if (aiMatched) {
                            await sleep(1000);
                            await sendDiscordMessage(chIdCopy, ruleCopy.response, GATEWAY_TOKEN, msgIdCopy);
                            console.log(`${LOG} 🤖 Gemini авто-ответ [${ruleCopy.name}] в #${chIdCopy}`);
                            addLog('ai', `AI авто-ответ «${ruleCopy.name}» в #${chIdCopy}`);
                        }
                    } catch (e) {
                        console.error(`${LOG} ❌ Gemini авто-ответ ошибка:`, e.message);
                    }
                })();
                continue;
            }

            if (matched) {
                const ruleName = rule.name || 'unnamed';
                const authorName = data.author?.username || 'Неизвестно';
                const msgContent = data.content || '';
                setTimeout(async () => {
                    try {
                        await sendDiscordMessage(channelId, rule.response, GATEWAY_TOKEN, data.id);
                        console.log(`${LOG} 🤖 Авто-ответ [${ruleName}] в #${channelId}: ${rule.response.slice(0, 50)}`);
                        addLog('autoreply', `Авто-ответ «${ruleName}» → ${authorName}: ${msgContent.slice(0, 80)}`);
                        const tgText = [
                            `🤖 <b>Авто-ответ отправлен</b>`,
                            ``,
                            `📋 <b>Правило:</b> ${escapeHtml(ruleName)}`,
                            `👤 <b>Игрок:</b> ${escapeHtml(authorName)}`,
                            `💬 <b>Сообщение:</b> <i>${escapeHtml(truncate(msgContent, 150))}</i>`,
                        ].join('\n');
                        enqueueToAll({ text: tgText });
                    } catch (e) {
                        console.error(`${LOG} ❌ Ошибка авто-ответа [${ruleName}]:`, e.message);
                    }
                }, 4000);
                break;
            }
        }
    }

    if (guildId !== config.guildId) return;

    let channel = channelCache.get(channelId);

    if (!channel) {
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

    if (config.autoGreetEnabled && data.mention_roles && data.mention_roles.length > 0) {
        const shouldGreet = data.mention_roles.some(r => (config.autoGreetRoleIds || []).includes(r));
        if (shouldGreet && !autoGreetedChannels.has(channelId) && isTicketChannel(channel)) {
            autoGreetedChannels.add(channelId);
            setTimeout(async () => {
                try {
                    await sendDiscordMessage(channelId, config.autoGreetText, GATEWAY_TOKEN);
                    console.log(`${LOG} 👋 Авто-приветствие отправлено в #${channel.name || channelId}`);
                    addLog('greet', `Авто-приветствие отправлено в #${channel.name || channelId}`);
                } catch (e) {
                    console.error(`${LOG} ❌ Ошибка авто-приветствия:`, e.message);
                }
            }, 1500);
        }
    }

    const author = data.author;
    if (!author || author.bot || data.webhook_id) return;

    const record = activeTickets.get(channelId);
    if (!record) return;

    const who = author?.username || 'unknown';
    console.log(`${LOG} 💬 #${record.channelName} от ${who}: ${(data.content || '').slice(0, 60)}`);

    const staffSent = isStaffFromMember(data.member);

    if (!staffSent && !record.openerId) {
        record.openerId = author.id || '';
        record.openerUsername = author.username || '';
        markDirty();
    }

    if (staffSent && record.firstStaffReplyAt === null) {
        record.firstStaffReplyAt = Date.now();
        markDirty();
    }

    if (data.content) {
        record.lastMessage = (staffSent ? '[Саппорт] ' : '') + data.content;
        record.lastMessageAt = Date.now();
        markDirty();
        if (io) {
            io.emit('ticket:message', { channelId, message: data });
            io.emit('ticket:updated', record);
        }
    }

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

    if (staffSent) {
        record.lastStaffMessageAt = Date.now();
        record.waitingForReply = true;
        const timerType = isClosingPhrase(data.content || '') ? 'closing' : 'regular';
        record.activityTimerType = timerType;
        markDirty();
        startActivityTimer(channelId, timerType);
        return;
    }

    if (noReplyTimers.has(channelId)) clearNoReplyTimer(channelId);

    // ── Auto-reply: match user message against binds ──────────
    if (config.autoReplyInTickets !== false && data.content && !botPaused && data.content.length <= (config.autoReplyMaxLength || 50)) {
        const userText = data.content.toLowerCase();
        for (const [key, bind] of Object.entries(config.binds || {})) {
            if (userText.includes(key.toLowerCase())) {
                const arKey = `${channelId}:${key}`;
                if (!autoRepliedBinds.has(arKey)) {
                    autoRepliedBinds.add(arKey);
                    setTimeout(async () => {
                        try {
                            await sendDiscordMessage(channelId, bind.message, GATEWAY_TOKEN);
                            console.log(`${LOG} 🤖 Авто-ответ «${key}» отправлен в #${record.channelName}`);
                            addLog('autoreply', `Авто-ответ «${key}» → #${record.channelName}`);
                        } catch (e) {
                            console.error(`${LOG} ❌ Ошибка авто-ответа:`, e.message);
                        }
                    }, 2000);
                }
                break; // only one auto-reply per message
            }
        }
    }

    if (!sentByBot.has(data.id) && !(selfUserId && author.id === selfUserId)) {
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

    if (botPaused) return;
    if (!config.includeFirstUserMessage) return;
    if (notifiedFirstMessage.has(channelId)) return;
    if (!SAFE_MESSAGE_TYPES.has(data.type ?? 0)) return;

    notifiedFirstMessage.add(channelId);
    addLog('ticket', `Первое сообщение в #${channel?.name || channelId} от ${data.author?.username || 'Неизвестно'}`);
    if (!config.forumMode) enqueueToAll({ ...buildFirstMessageNotification(channel, data), channelId });
    if (getPriority(channel?.name || '', data.content || '').high && config.mentionOnHighPriority) {
        enqueueToAll({ ...buildHighPriorityAlert(channel?.name || channelId), channelId });
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
            if (processedUpdateIds.has(uid)) continue;
            processedUpdateIds.add(uid);
            if (processedUpdateIds.size > 100) {
                const arr = [...processedUpdateIds];
                for (let i = 0; i < arr.length - 50; i++) processedUpdateIds.delete(arr[i]);
            }

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
                } else if (cbData === 'shift_close') {
                    const result = await handleSmenoff(cbChatId);
                    await tgAnswerCallbackQuery(cbq.id, result.startsWith('✅') ? 'Закрыто!' : 'Ошибка');
                    await tgEditMessageText(cbChatId, cbq.message.message_id, result);
                } else if (cbData.startsWith('tsel_')) {
                    const chId = cbData.slice(5);
                    await handleSelectTicket(chId, cbq.id, cbq.message.message_id, cbChatId);
                } else if (cbData.startsWith('tpage_')) {
                    const pg = parseInt(cbData.slice(6), 10) || 0;
                    await tgAnswerCallbackQuery(cbq.id, `Стр. ${pg + 1}`);
                    const msg = buildTicketListMessage(pg, cbChatId);
                    await tgEditMessageText(cbChatId, cbq.message.message_id, msg.text, msg.markup);
                } else if (cbData === 'tunselect') {
                    await handleUnselectTicket(cbq.id, cbq.message.message_id, cbChatId);
                } else if (cbData === 'thistory') {
                    await tgAnswerCallbackQuery(cbq.id, '📜 Загружаю историю...');
                    const histMsgs = await handleHistory(cbChatId);
                    for (const m of histMsgs) enqueueToUser(cbChatId, { text: m.text, replyMarkup: m.markup });
                } else if (cbData.startsWith('bind_')) {
                    const bindName = cbData.slice(5);
                    const uState = getUserState(cbChatId).ticketChat;
                    if (!uState.activeTicketId) {
                        await tgAnswerCallbackQuery(cbq.id, '❌ Тикет не выбран');
                    } else if (config.binds && config.binds[bindName]) {
                        const bind = config.binds[bindName];
                        try {
                            const res = await sendDiscordMessage(uState.activeTicketId, bind.message, cbToken);
                            if (res.ok) {
                                try { const j = JSON.parse(res.body); if (j.id) sentByBot.add(j.id); } catch { }
                                await tgAnswerCallbackQuery(cbq.id, `✅ ${bindName}`);
                                await tgEditMessageText(cbChatId, cbq.message.message_id, `✅ Отправлено: "<b>${escapeHtml(bindName)}</b>"`);
                            } else {
                                await tgAnswerCallbackQuery(cbq.id, `❌ Ошибка ${res.status}`);
                            }
                        } catch (e) {
                            await tgAnswerCallbackQuery(cbq.id, '❌ Ошибка отправки');
                        }
                    } else {
                        await tgAnswerCallbackQuery(cbq.id, '❌ Бинд не найден');
                    }
                }
                continue;
            }

            const text = update?.message?.text || '';
            const chatId = String(update?.message?.chat?.id || '');
            if (!allTgChatIds.has(chatId)) continue;
            const token = getDiscordToken(chatId);

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
                shiftSt.lateReminderSentDate = null;
                shiftSt.closeReminderSentDate = null;
                shiftSt.lastShiftContent = null;
                savePerUserState();
                enqueueToUser(chatId, { text: '🔄 Состояние смены сброшено. Можно делать /smena заново.' });
            }
            else if (text === '/history' || text.startsWith('/history ')) {
                const histMsgs = await handleHistory(chatId);
                for (const m of histMsgs) enqueueToUser(chatId, { text: m.text, replyMarkup: m.markup });
            }
            else if (text === '/binds' || text.startsWith('/binds ')) {
                enqueueToUser(chatId, { text: handleBindsList() });
            }
            else if (text.startsWith('/addbind ')) {
                enqueueToUser(chatId, { text: handleAddBind(text.slice(9)) });
            }
            else if (text === '/addbind') {
                enqueueToUser(chatId, { text: '❌ Формат: /addbind &lt;название&gt; &lt;текст&gt;' });
            }
            else if (text.startsWith('/delbind ')) {
                enqueueToUser(chatId, { text: handleDelBind(text.slice(9).trim()) });
            }
            else if (text === '/delbind') {
                enqueueToUser(chatId, { text: '❌ Формат: /delbind &lt;название&gt;' });
            }
            else if (text.startsWith('/setgreet ')) {
                enqueueToUser(chatId, { text: handleSetGreet(text.slice(10)) });
            }
            else if (text === '/setgreet') {
                enqueueToUser(chatId, { text: '❌ Формат: /setgreet &lt;текст&gt;' });
            }
            else if (text === '/greet' || text.startsWith('/greet ')) {
                const greetArgs = text.startsWith('/greet ') ? text.slice(7) : '';
                enqueueToUser(chatId, { text: handleGreet(greetArgs) });
            }
            else if (text.startsWith('/') && !text.startsWith('//')) {
                const bindQuery = text.slice(1).split(/\s+/)[0].toLowerCase().trim();
                if (bindQuery.length >= 2 && config.binds) {
                    const bindResult = await handleBindSearch(bindQuery, chatId);
                    if (bindResult) {
                        enqueueToUser(chatId, { text: bindResult.text, replyMarkup: bindResult.markup });
                    }
                }
            }
            else if (!text.startsWith('/') && getUserState(chatId).ticketChat.activeTicketId && text.trim()) {
                const result = await handleSendToTicket(text, chatId);
                enqueueToUser(chatId, { text: result.text, replyMarkup: result.markup });
            }
        }
    } catch (e) {
        console.error(`${LOG} Ошибка полинга:`, e.message);
        addLog('error', `Ошибка Telegram-поллинга: ${e.message}`);
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
        addLog('gateway', `WebSocket подключён к Discord Gateway`);
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
        addLog('gateway', `WebSocket отключён (код: ${code})`);
        cleanupGateway();
        if (code === 4004) {
            console.error(`${LOG} ❌ Невалидный токен! Проверьте config.json.`);
            process.exit(1);
        }
        if (code === 4002) {
            console.error(`${LOG} ❌ 4002 Decode error — сбрасываем сессию, делаем чистый Identify.`);
            sessionId = null;
            resumeGatewayUrl = null;
            seq = null;
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
        case 10:
            startHeartbeat(d.heartbeat_interval);
            if (sessionId) {
                sendResume();
            } else {
                sendIdentify();
            }
            break;
        case 11:
            receivedAck = true;
            break;
        case 0:
            handleDispatch(t, d);
            break;
        case 7:
            console.log(`${LOG} 🔄 Сервер запросил переподключение.`);
            ws.close(4000);
            break;
        case 9:
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
            addLog('gateway', `Авторизован как ${data.user.username}`);
            if (!pollingTimer && !pollingRunning) {
                schedulePolling();
                console.log(`${LOG} 📡 Telegram-поллинг запущен.`);
            }
            let foundTarget = false;
            const autoReplyGuildIds = getAutoReplyGuildIds();
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
                    }
                    if (autoReplyGuildIds.has(g.id)) {
                        console.log(`${LOG} 🤖 AutoReply сервер ${g.name || g.id} найден в READY.`);
                        onGuildCreate(g);
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
                for (const [arGuildId, arChIds] of getAutoReplyGuildChannels()) {
                    if (arGuildId !== config.guildId && arChIds.size > 0) {
                        sendLazyRequest(arGuildId, [...arChIds]);
                    }
                }
            }
            break;
        case 'GUILD_CREATE':
            if (data.id === config.guildId && guildCreateHandled) {
                console.log(`${LOG} 🏠 GUILD_CREATE для целевого сервера уже обработан, пропускаем.`);
            } else {
                onGuildCreate(data);
            }
            if (!IS_BOT_TOKEN && getAutoReplyGuildIds().has(data.id)) {
                subscribeToAutoReplyChannels(data.id);
            }
            break;
        case 'READY_SUPPLEMENTAL':
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
        case 'GUILD_MEMBER_LIST_UPDATE': {
            // Cache members from lazy guild member list updates
            if (data.guild_id !== config.guildId) break;
            if (data.ops) {
                for (const op of data.ops) {
                    if (op.items) {
                        for (const item of op.items) {
                            if (item.member && item.member.user) {
                                guildMembersCache.set(item.member.user.id, item.member);
                                if (item.member.presence) {
                                    guildPresenceCache.set(item.member.user.id, item.member.presence.status || 'offline');
                                }
                            }
                        }
                    }
                    if (op.item && op.item.member && op.item.member.user) {
                        guildMembersCache.set(op.item.member.user.id, op.item.member);
                        if (op.item.member.presence) {
                            guildPresenceCache.set(op.item.member.user.id, op.item.member.presence.status || 'offline');
                        }
                    }
                }
            }
            // Cache groups (roles) if provided
            if (data.groups) {
                // groups are just counts, roles already cached from GUILD_CREATE
            }
            break;
        }
        case 'GUILD_MEMBERS_CHUNK': {
            if (data.guild_id !== config.guildId) break;
            if (data.members) {
                for (const m of data.members) {
                    if (m.user) guildMembersCache.set(m.user.id, m);
                }
            }
            if (data.presences) {
                for (const p of data.presences) {
                    if (p.user?.id) guildPresenceCache.set(p.user.id, p.status || 'offline');
                }
            }
            break;
        }
        case 'PRESENCE_UPDATE': {
            if (data.guild_id !== config.guildId) break;
            if (data.user?.id) {
                guildPresenceCache.set(data.user.id, data.status || 'offline');
            }
            break;
        }
    }
}

function sendIdentify() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const payload = IS_BOT_TOKEN
        ? {
            token: GATEWAY_TOKEN,
            intents: 33283,
            properties: { os: 'linux', browser: 'ticket-notifier', device: 'ticket-notifier' },
            compress: false,
            large_threshold: 250,
        }
        : buildIdentifyPayload(GATEWAY_TOKEN);
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
    receivedAck = true;
    guildCreateHandled = false;
}

// ── Dashboard API ─────────────────────────────────────────────

function startDashboard() {
    const app = express();
    const server = http.createServer(app);
    io = new Server(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST', 'DELETE']
        }
    });

    app.use(cors());
    app.use(express.json());

    // Auth Middleware
    const authenticate = (req, res, next) => {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'Unauthorized: No token provided' });
        try {
            const secret = config.jwtSecret || 'ticket-dashboard-secret-key-2026';
            const decoded = jwt.verify(token, secret);
            req.user = decoded;
            next();
        } catch (err) {
            return res.status(401).json({ error: 'Unauthorized: Invalid token' });
        }
    };

    // Public API
    app.post('/api/auth', (req, res) => {
        const { password } = req.body;
        if (password === config.dashboardPassword) {
            const secret = config.jwtSecret || 'ticket-dashboard-secret-key-2026';
            const token = jwt.sign({ role: 'admin' }, secret, { expiresIn: '7d' });
            return res.json({ token });
        }
        return res.status(401).json({ error: 'Invalid password' });
    });

    app.get('/api/auth', authenticate, (req, res) => {
        res.json({ ok: true, user: req.user });
    });

    // Protected API
    app.use('/api', authenticate);

    app.get('/api/tickets', (req, res) => {
        const tickets = Array.from(activeTickets.values()).map(r => ({
            ...r,
            priority: getPriority(r.channelName, '').high ? 'high' : 'normal'
        }));
        res.json(tickets);
    });

    app.get('/api/tickets/:id/messages', async (req, res) => {
        const channelId = req.params.id;
        const record = activeTickets.get(channelId);
        if (!record) return res.status(404).json({ error: 'Ticket not found' });

        try {
            const messages = await fetchChannelMessages(channelId, 100, getDiscordToken(users[0]?.tgChatId));
            // Build mention lookup map
            const mentionMap = {};
            for (const [id, r] of guildRolesCache) {
                mentionMap[`role:${id}`] = r.name || id;
            }
            for (const [id, m] of guildMembersCache) {
                mentionMap[`user:${id}`] = m.user?.global_name || m.user?.username || m.nick || id;
            }
            res.json({ messages: messages.reverse(), mentionMap });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/tickets/:id/send', async (req, res) => {
        const channelId = req.params.id;
        const { content, replyTo } = req.body;
        const record = activeTickets.get(channelId);
        if (!record) return res.status(404).json({ error: 'Ticket not found' });

        try {
            const result = await sendDiscordMessage(channelId, content, getDiscordToken(users[0]?.tgChatId), replyTo || undefined);
            if (!result.ok) throw new Error(`Discord API ${result.status}`);

            // Mark as sent by bot so we don't reflect it back via telegram
            try {
                const j = JSON.parse(result.body);
                if (j.id) sentByBot.add(j.id);
            } catch (e) { }

            addLog('message', `Сообщение отправлено в тикет ${channelId}`);
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.patch('/api/tickets/:id/messages/:msgId', async (req, res) => {
        const { id: channelId, msgId } = req.params;
        const { content } = req.body;
        const record = activeTickets.get(channelId);
        if (!record) return res.status(404).json({ error: 'Ticket not found' });

        try {
            const result = await editDiscordMessage(channelId, msgId, content, getDiscordToken(users[0]?.tgChatId));
            if (!result.ok) throw new Error(`Discord API ${result.status}`);
            addLog('message', `Сообщение отредактировано в тикете ${channelId}`);
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/stats', (req, res) => {
        res.json({
            totalCreated: ps.totalCreated,
            totalClosed: ps.totalClosed,
            hourlyBuckets: ps.hourlyBuckets,
            closedTickets: dbGetClosedTickets({ page: 1, limit: 50 }).tickets,
            activeTicketsCount: activeTickets.size,
            uptime: process.uptime()
        });
    });

    app.get('/api/binds', (req, res) => {
        res.json(Object.values(config.binds || {}));
    });

    app.post('/api/binds', (req, res) => {
        const { name, message } = req.body;
        if (!name || !message) return res.status(400).json({ error: 'name and message required' });
        if (!config.binds) config.binds = {};
        config.binds[name] = { name, message };
        saveConfig();
        addLog('bind', `Бинд добавлен: ${name}`);
        res.json({ ok: true, bind: config.binds[name] });
    });

    app.delete('/api/binds/:name', (req, res) => {
        const { name } = req.params;
        if (config.binds && config.binds[name]) {
            delete config.binds[name];
            saveConfig();
            addLog('bind', `Бинд удалён: ${name}`);
        }
        res.json({ ok: true });
    });

    app.get('/api/users', (req, res) => {
        const result = users.map(u => {
            const st = getUserState(u.tgChatId).shift;
            return {
                id: u.tgChatId,
                name: u.name,
                shiftActive: st.lastShiftDate === getKyivDate() && !st.lastShiftClosed,
                shiftCheckinTime: st.lastShiftDate === getKyivDate() ? new Date().toISOString() : null // Approx
            };
        });
        res.json(result);
    });

    app.post('/api/smena', async (req, res) => {
        const { userId } = req.body;
        const targetUser = users.find(u => u.tgChatId === userId) || users[0];
        const result = await handleSmena(targetUser.tgChatId);
        addLog('shift', `${targetUser.name}: смена начата`);
        res.json({ ok: result.startsWith('✅'), message: result });
    });

    app.post('/api/smenoff', async (req, res) => {
        const { userId } = req.body;
        const targetUser = users.find(u => u.tgChatId === userId) || users[0];
        const result = await handleSmenoff(targetUser.tgChatId);
        addLog('shift', `${targetUser.name}: смена завершена`);
        res.json({ ok: result.startsWith('✅'), message: result });
    });

    // ── Logs ────────────────────────────────────────────────
    app.get('/api/logs', (req, res) => {
        const limit = Math.min(parseInt(req.query.limit) || 50, MAX_LOGS);
        res.json(dashboardLogs.slice(0, limit));
    });

    // ── Profiles (users from config) ────────────────────────
    app.get('/api/profiles', (req, res) => {
        const profiles = users.map(u => ({
            id: u.tgChatId,
            name: u.name,
        }));
        res.json(profiles);
    });

    // ── Guild Members (from Gateway cache) ─────────────────
    app.get('/api/members', (req, res) => {
        try {
            // Build role map from cached roles
            const roleMap = {};
            for (const [id, r] of guildRolesCache) {
                roleMap[id] = { id: r.id, name: r.name, color: r.color, position: r.position, hoist: r.hoist };
            }

            // Group members by their highest hoisted role
            const groups = {};
            for (const [userId, member] of guildMembersCache) {
                if (!member.roles || member.roles.length === 0) continue;
                if (member.user?.bot) continue;

                let bestRole = null;
                for (const rid of member.roles) {
                    const role = roleMap[rid];
                    if (!role) continue;
                    if (!role.hoist) continue;
                    if (!bestRole || role.position > bestRole.position) bestRole = role;
                }
                if (!bestRole) continue;

                if (!groups[bestRole.id]) {
                    groups[bestRole.id] = {
                        roleId: bestRole.id,
                        roleName: bestRole.name,
                        roleColor: bestRole.color ? `#${bestRole.color.toString(16).padStart(6, '0')}` : '#99aab5',
                        position: bestRole.position,
                        members: []
                    };
                }

                const avatarHash = member.avatar || member.user?.avatar;
                const uid = member.user?.id || userId;
                const avatarUrl = avatarHash
                    ? `https://cdn.discordapp.com/avatars/${uid}/${avatarHash}.png?size=64`
                    : `https://cdn.discordapp.com/embed/avatars/0.png`;
                const status = guildPresenceCache.get(uid) || 'offline';

                groups[bestRole.id].members.push({
                    id: uid,
                    username: member.user?.username,
                    displayName: member.nick || member.user?.global_name || member.user?.username,
                    avatar: avatarUrl,
                    status
                });
            }

            const result = Object.values(groups)
                .sort((a, b) => b.position - a.position)
                .map(g => ({
                    ...g,
                    members: g.members.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
                }));

            res.json(result);
        } catch (err) {
            console.error(`${LOG} Members API error:`, err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ── Settings API ─────────────────────────────────────────
    app.get('/api/settings', (req, res) => {
        res.json({
            autoGreetEnabled: config.autoGreetEnabled ?? true,
            autoGreetText: config.autoGreetText || '',
            autoGreetRoleIds: config.autoGreetRoleIds || [],
            includeFirstUserMessage: config.includeFirstUserMessage ?? true,
            notifyOnClose: config.notifyOnClose ?? true,
            mentionOnHighPriority: config.mentionOnHighPriority ?? true,
            activityCheckMin: config.activityCheckMin || 10,
            closingCheckMin: config.closingCheckMin || 15,
            closingPhrase: config.closingPhrase || '',
            ticketPrefix: config.ticketPrefix || 'ticket-',
            pollingIntervalSec: config.pollingIntervalSec || 3,
            rateLimitMs: config.rateLimitMs || 1500,
            maxMessageLength: config.maxMessageLength || 300,
            forumMode: config.forumMode ?? false,
            priorityKeywords: config.priorityKeywords || [],
        });
    });

    app.post('/api/settings', (req, res) => {
        const allowed = [
            'autoGreetEnabled', 'autoGreetText', 'autoGreetRoleIds',
            'includeFirstUserMessage', 'notifyOnClose', 'mentionOnHighPriority',
            'activityCheckMin', 'closingCheckMin', 'closingPhrase',
            'ticketPrefix', 'pollingIntervalSec', 'rateLimitMs',
            'maxMessageLength', 'forumMode', 'priorityKeywords',
        ];
        const body = req.body;
        let changed = 0;
        for (const key of allowed) {
            if (body[key] !== undefined) {
                config[key] = body[key];
                changed++;
            }
        }
        if (changed > 0) {
            saveConfig();
            addLog('system', `Настройки обновлены (${changed} полей)`);
        }
        res.json({ ok: true, changed });
    });

    // ── Auto-Replies API ──────────────────────────────────────
    app.get('/api/autoreplies', (req, res) => {
        res.json(config.autoReplies || []);
    });

    app.post('/api/autoreplies', (req, res) => {
        const { autoReplies } = req.body;
        if (!Array.isArray(autoReplies)) return res.status(400).json({ error: 'autoReplies must be an array' });
        config.autoReplies = autoReplies;
        saveConfig();
        addLog('system', `Авто-ответы обновлены (${autoReplies.length} правил)`);
        res.json({ ok: true, count: autoReplies.length });
    });

    // ── Closed Tickets History ─────────────────────────────────
    app.get('/api/closed-tickets', (req, res) => {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const search = (req.query.search || '').toLowerCase();
        res.json(dbGetClosedTickets({ page, limit, search }));
    });

    // ── Archived Ticket Messages ────────────────────────────
    app.get('/api/closed-tickets/:id/messages', (req, res) => {
        const channelId = req.params.id;
        const messages = dbGetTicketMessages(channelId);
        if (messages.length === 0) {
            // Fallback to JSON archive if not in DB
            const archivePath = path.join(ARCHIVES_DIR, `${channelId}.json`);
            try {
                if (fs.existsSync(archivePath)) {
                    const archive = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
                    return res.json(archive);
                }
            } catch { }
            return res.status(404).json({ error: 'Архив не найден' });
        }
        res.json({ channelId, messages });
    });

    // Serve Dashboard static files
    const dashboardDist = path.join(__dirname, 'dashboard', 'dist');
    app.use(express.static(dashboardDist));
    // SPA fallback — all non-API routes serve index.html
    app.get('*', (req, res) => {
        res.sendFile(path.join(dashboardDist, 'index.html'));
    });

    // Socket.io Middleware
    io.use((socket, next) => {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
        if (!token) return next(new Error('Authentication error'));
        try {
            const secret = config.jwtSecret || 'ticket-dashboard-secret-key-2026';
            jwt.verify(token, secret);
            next();
        } catch (err) {
            next(new Error('Authentication error'));
        }
    });

    io.on('connection', (socket) => {
        console.log(`${LOG} 🌐 Dashboard client connected: ${socket.id}`);
        socket.on('disconnect', () => {
            console.log(`${LOG} 🌐 Dashboard client disconnected: ${socket.id}`);
        });
    });

    const port = process.env.PORT || config.dashboardPort || 3001;
    server.listen(port, () => {
        console.log(`${LOG} 🚀 Dashboard API is running on port ${port}`);
    });
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
    startDashboard();

    const shutdown = () => {
        console.log(`${LOG} 🛑 Остановка...`);
        stopPolling();
        stopAutosave();
        if (shiftReminderTimer) { clearTimeout(shiftReminderTimer); shiftReminderTimer = null; }
        if (shiftCloseReminderTimer) { clearTimeout(shiftCloseReminderTimer); shiftCloseReminderTimer = null; }
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