// ═══════════════════════════════════════════════════════════════
//  FunAI — Unified AI Brain for Telegram Ticket Notifier
//  Inspired by JARVIS: One brain — works everywhere.
// ═══════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const FunAIMemory = require('./funaiMemory');
const { buildRagContextMessage, sanitizeResponseLinks } = require('./ragEngine');
const { evaluateAutoReplyDecision } = require('./autoReplyEngine');
const funtimeServerRules = require('./funtimeServerRules');
const defaultBinds = require('./defaultBinds');

const LOG = '[FunAI]';

// Resolve persistent data dir
const _dataDir = process.env.DATA_DIR || (fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', '..', 'data'));

// ── AI Provider Constants ──────────────────────────────────
const DEFAULT_OPENROUTER_MODELS = [
    'google/gemini-2.0-flash-lite-preview-02-05:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'deepseek/deepseek-r1-distill-llama-70b:free',
];
const DEFAULT_GROQ_MODELS = [
    'llama-3.1-8b-instant',
    'llama-3.3-70b-versatile',
];
const DEFAULT_GEMINI_MODELS = [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
];
const DEFAULT_GEMINI_API_VERSIONS = ['v1beta', 'v1'];

// ── System Prompts ──────────────────────────────────────────

const WIDGET_SYSTEM_PROMPT = `Ты — FunAI, интеллектуальный AI-ассистент системы Telegram Ticket Notifier.

═══ КТО ТЫ ═══
Ты — FunAI. Умный помощник администратора. Ты управляешь системой 
тикетов Minecraft-сервера FunTime. Ты гордишься своим именем и 
возможностями. Ты — напарник администратора, а не просто инструмент.

═══ ТВОЙ ХАРАКТЕР ═══
- Уверенный и экспертный, но дружелюбный
- Говоришь кратко и по делу
- Используешь эмодзи уместно, но не чрезмерно
- Когда не знаешь ответ — честно говоришь и предлагаешь альтернативу
- Проактивный: сам замечаешь проблемы и предлагаешь решения

═══ ТВОИ ВОЗМОЖНОСТИ ═══
У тебя есть "руки" — ты можешь выполнять действия в системе.
Когда пользователь просит что-то сделать, ты вызываешь соответствующее 
действие через специальный формат:

[ACTION:ticket:list] — показать тикеты
[ACTION:navigate:PAGE] — перейти на страницу
[ACTION:memory:add:ТЕКСТ] — запомнить информацию
[ACTION:ticket:close] — закрыть текущий тикет (только если пользователь просит закрыть тикет и ты находишься на его странице)
[ACTION:ticket:reply:ТЕКСТ] — отправить сообщение в текущий тикет от лица бота (где ТЕКСТ - само сообщение)

═══ ПРАВИЛА ═══
1. Отвечай ТОЛЬКО на русском языке
2. Если тебя спрашивают о настройке — покажи текущее значение и предложи решение
3. Если просят что-то сделать — скажи что делаешь и покажи результат
4. Если заметил проблему — сразу расскажи
5. Не придумывай данных — используй только реальную информацию из системы
6. Ты работаешь в контексте дашборда — помогай администратору управлять системой
7. НИКОГДА не показывай пользователю сырые числовые ID каналов/тикетов (вроде 1488095184569897091). Вместо этого используй человеческое название тикета (например "тикет-от-natashapivo") или просто "текущий тикет"
8. Если в контексте есть имя тикета — используй его. Если нет — пиши "текущий тикет"`;

const TICKET_SYSTEM_PROMPT = `Ты — помощник поддержки Minecraft-сервера FunTime.

═══ ГЛАВНОЕ ПРАВИЛО ═══
НИКОГДА не говори что ты нейросеть, AI, бот или программа.
Отвечай как живой модератор сервера.

═══ СТИЛЬ ОТВЕТА ═══
- Дружелюбный, спокойный, уважительный
- Без токсичности и грубости
- Отвечай конкретно и по делу
- Если не знаешь точный ответ — попроси подождать модератора

═══ ПРАВИЛА ═══
1. Отвечай ТОЛЬКО на русском
2. Не упоминай AI, нейросеть, ChatGPT, Gemini и подобное
3. Если вопрос про правила — цитируй точный текст правила
4. Если вопрос сложный или неоднозначный — НЕ ОТВЕЧАЙ, скажи "Секунду, уточню у коллеги"`;

// ── Rules Lookup ───────────────────────────────────────────
const _ruleById = new Map(
    (Array.isArray(funtimeServerRules) ? funtimeServerRules : [])
        .map(r => [String(r?.id || '').trim(), String(r?.text || '').trim()])
        .filter(([id, text]) => id && text)
);

function extractRuleIdFromQuestion(question) {
    const raw = String(question || '').toLowerCase();
    if (!raw) return '';
    if (!/(правил|пункт)/i.test(raw)) return '';
    const triple = raw.match(/\b(\d{1,2})\s*[.,]\s*(\d{1,2})\s*[.,]\s*(\d{1,2})\b/);
    if (triple) return `${triple[1]}.${triple[2]}.${triple[3]}`;
    const single = raw.match(/\b(\d{1,2})\s*[.,]\s*(\d{1,2})\b/);
    if (single) return `${single[1]}.${single[2]}`;
    return '';
}

// ── Provider helpers (ported from gateway.js) ──────────────
function splitKeyList(raw) {
    return String(raw || '').split(/[\n,]/g).map(v => v.trim()).filter(Boolean);
}

function normalizeAiProviderName(provider) {
    const p = String(provider || '').trim().toLowerCase();
    if (p === 'or' || p === 'openrouter') return 'openrouter';
    if (p === 'groq' || p === 'qroq') return 'groq';
    if (p === 'gemini' || p === 'google' || p === 'googleai') return 'gemini';
    return '';
}

function detectAiProviderByKey(key) {
    const k = String(key || '').trim();
    if (k.startsWith('sk-or-')) return 'openrouter';
    if (k.startsWith('gsk_')) return 'groq';
    if (/^AIza[0-9A-Za-z\-_]{20,}/.test(k)) return 'gemini';
    return 'openrouter';
}

function parseAiCredential(input, forcedProvider = '') {
    const raw = String(input || '').trim();
    if (!raw) return null;
    if (raw.startsWith('{') && raw.endsWith('}')) {
        try {
            const obj = JSON.parse(raw);
            const provider = normalizeAiProviderName(obj.provider || forcedProvider || '');
            const key = String(obj.key || obj.apiKey || obj.token || '').trim();
            if (!provider || !key) return null;
            return { provider, key };
        } catch { return null; }
    }
    const prefixed = raw.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.+)$/);
    if (prefixed) {
        const provider = normalizeAiProviderName(prefixed[1]);
        const key = String(prefixed[2] || '').trim();
        if (provider && key) return { provider, key };
    }
    const provider = normalizeAiProviderName(forcedProvider) || detectAiProviderByKey(raw);
    if (!provider) return null;
    return { provider, key: raw };
}

function getAiCredentials(cfg) {
    const configuredRaw = Array.isArray(cfg?.geminiApiKeys)
        ? cfg.geminiApiKeys
        : (typeof cfg?.geminiApiKeys === 'string' ? splitKeyList(cfg.geminiApiKeys) : []);

    const entries = [];
    const pushCred = (cred) => { if (cred?.provider && cred?.key) entries.push(cred); };
    for (const item of configuredRaw) pushCred(parseAiCredential(item));
    for (const k of splitKeyList(process.env.OPENROUTER_API_KEYS || process.env.OPENROUTER_API_KEY || '')) pushCred(parseAiCredential(k, 'openrouter'));
    for (const k of splitKeyList(process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || '')) pushCred(parseAiCredential(k, 'groq'));
    for (const k of splitKeyList(process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')) pushCred(parseAiCredential(k, 'gemini'));

    const uniq = [], seen = new Set();
    for (const cred of entries) {
        const sig = `${cred.provider}:${cred.key}`;
        if (!seen.has(sig)) { seen.add(sig); uniq.push(cred); }
    }
    return uniq;
}

function getProviderModels(envName, fallback) {
    const fromEnv = splitKeyList(process.env[envName] || '');
    return fromEnv.length > 0 ? fromEnv : fallback;
}

function parseProviderBody(body) {
    try { return JSON.parse(body || '{}'); } catch { return {}; }
}

function getOpenAiStyleAnswer(data) {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) return content.map(part => (typeof part === 'string' ? part : part?.text || '')).join('\n').trim();
    return '';
}

function getGeminiAnswer(data) {
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts.map(p => String(p?.text || '')).join('\n').trim();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════
//  FunAI Core Class
// ═══════════════════════════════════════════════════════════════
class FunAI {
    constructor(bot, db) {
        this.bot = bot;
        this.db = db;
        this.dataDir = bot?.dataDir || _dataDir;
        this.memory = new FunAIMemory(db, this.dataDir);
        this._initialized = true;
        console.log(`${LOG} ✅ FunAI Core initialized.`);
    }

    // ═══ Main Entry Point ════════════════════════════════════

    /**
     * Universal question handler — routes to the best strategy.
     * @param {string} question — User's question
     * @param {object} context — { mode: 'widget'|'ticket', channelId, currentPage, userId }
     */
    async ask(question, context = {}) {
        const mode = context.mode || 'widget';
        const startTime = Date.now();

        try {
            // Intent Router: L0 → L1 → L2
            const result = await this._routeIntent(question, context);

            // Execute Server-Side Actions
            if (result.actions && result.actions.length > 0) {
                const actionResults = await this._executeServerActions(result.actions, context);
                if (actionResults.length > 0) {
                    result.answer += '\n\n' + actionResults.join('\n');
                }
            }

            // Track stats
            this.memory.trackRequest(result.level, result.tokensUsed || 0);

            // Save to conversation (widget mode)
            if (mode === 'widget' && context.userId) {
                this.memory.saveConversation(context.userId, 'user', question, null, context.currentPage || '');
                this.memory.saveConversation(context.userId, 'assistant', result.answer, result.actions || null, context.currentPage || '');
            }

            return {
                answer: result.answer,
                level: result.level,
                source: result.source,
                actions: result.actions || [],
                tokensUsed: result.tokensUsed || 0,
                durationMs: Date.now() - startTime,
            };
        } catch (err) {
            console.error(`${LOG} ❌ ask() error:`, err.message);
            return {
                answer: '⚠️ Произошла ошибка при обработке запроса. Попробуйте ещё раз.',
                level: 'error',
                source: 'error',
                actions: [],
                tokensUsed: 0,
                durationMs: Date.now() - startTime,
            };
        }
    }

    async _executeServerActions(actions, context) {
        const results = [];
        for (const action of actions) {
            if (action.type === 'ticket:close') {
                const ticketId = action.params || (context.currentPage?.startsWith('/tickets/') ? context.currentPage.split('/')[2] : null);
                if (ticketId) {
                    try {
                        const res = await this.bot.closeTicketViaButton(ticketId);
                        if (res.ok) {
                            results.push(`✅ Тикет закрыт.`);
                            action.type = 'noop'; // transform so frontend ignores it
                        } else {
                            results.push(`⚠️ Не удалось закрыть тикет: ${res.error}`);
                        }
                    } catch (e) {
                        results.push(`⚠️ Ошибка закрытия: ${e.message}`);
                    }
                } else {
                    results.push(`⚠️ Не указан ID тикета для закрытия.`);
                }
            } else if (action.type === 'ticket:reply') {
                const ticketId = context.currentPage?.startsWith('/tickets/') ? context.currentPage.split('/')[2] : null;
                const text = action.params;
                if (ticketId && text) {
                    try {
                        const res = await this.bot.sendDiscordMessage(ticketId, text);
                        if (res.ok) {
                            results.push(`✅ Сообщение отправлено.`);
                            action.type = 'noop';
                        } else {
                            results.push(`⚠️ Ошибка отправки: ${res.status}`);
                        }
                    } catch (e) {
                        results.push(`⚠️ Ошибка отправки: ${e.message}`);
                    }
                }
            }
        }
        return results;
    }

    // ═══ Intent Router ═══════════════════════════════════════

    async _routeIntent(question, context) {
        const normalized = String(question || '').toLowerCase().trim();
        const mode = context.mode || 'widget';
        if (!normalized) return { answer: 'Пожалуйста, задайте вопрос 😊', level: 'l0', source: 'empty' };

        // Check for "remember" commands
        const rememberMatch = normalized.match(/^(запомни|запомни:|remember:?)\s+(.+)/i);
        if (rememberMatch) {
            const fact = rememberMatch[2].trim();
            this.memory.remember(fact, 'admin');
            return { answer: `✅ Запомнил: "${fact}"`, level: 'l0', source: 'command', actions: [{ type: 'memory:add', text: fact }] };
        }

        // Check for "forget" commands
        const forgetMatch = normalized.match(/^(забудь|забудь про|forget:?)\s+(.+)/i);
        if (forgetMatch) {
            const query = forgetMatch[2].trim();
            const found = this.memory.search(query, 5);
            if (found.length > 0) {
                for (const item of found) this.memory.delete(item.id);
                return { answer: `🗑️ Удалил ${found.length} записей, связанных с "${query}"`, level: 'l0', source: 'command' };
            }
            return { answer: `Не нашёл записей про "${query}" 🤷`, level: 'l0', source: 'command' };
        }

        // ── Widget-only built-in commands (L0) ──
        if (mode === 'widget') {
            const widgetResult = this._handleWidgetCommand(normalized, context);
            if (widgetResult) return widgetResult;
        }

        // L0: Exact match from memory (instant, 0 tokens)
        const memoryHits = this.memory.search(normalized, 3);
        if (memoryHits.length > 0) {
            const bestHit = memoryHits[0];
            if (bestHit.type === 'qa' && bestHit.question && bestHit.confidence >= 0.8) {
                const qNorm = String(bestHit.question).toLowerCase().trim();
                if (qNorm === normalized || normalized.includes(qNorm) || qNorm.includes(normalized)) {
                    return { answer: bestHit.content, level: 'l0', source: `memory:${bestHit.id}` };
                }
            }
            if (bestHit.type === 'correction') {
                return { answer: bestHit.content, level: 'l0', source: `correction:${bestHit.id}` };
            }
        }

        // L1: Rules by ID (both modes)
        const l1Result = this._checkL1(question, context);
        if (l1Result) return l1Result;

        // L2: LLM generation (AI provider)
        return await this._generateL2(question, context, memoryHits);
    }

    /** Handle built-in widget commands locally without AI */
    _handleWidgetCommand(normalized, context) {
        // ── Greetings ──
        const greetings = ['привет', 'здравствуй', 'здравствуйте', 'хай', 'ку', 'добрый день', 'добрый вечер', 'приветствую', 'здарова', 'салам', 'hello', 'hi'];
        if (greetings.some(g => normalized === g || normalized.startsWith(g + ' ') || normalized.startsWith(g + '!'))) {
            const activeCount = this.bot?.activeTickets?.size || 0;
            const stats = this.memory.getStats(1);
            let greeting = '👋 **Привет!** Я FunAI — твой умный помощник.\n\n';
            greeting += `📊 Сейчас:\n`;
            greeting += `• Активных тикетов: **${activeCount}**\n`;
            greeting += `• Запросов сегодня: **${stats.today.totalRequests}**\n`;
            greeting += `• Записей в памяти: **${stats.totals.memoryEntries}**\n\n`;
            greeting += 'Спроси меня о чём угодно — тикеты, правила, настройки 🧠';
            return { answer: greeting, level: 'l0', source: 'builtin:greeting' };
        }

        // ── Statistics ──
        if (/(статистик|стат(ы|с)|покажи стат|покажи данн|сколько тикет|обзор|дашборд)/i.test(normalized)) {
            const activeCount = this.bot?.activeTickets?.size || 0;
            const stats = this.memory.getStats(7);
            const today = stats.today;
            const memStats = this.memory.getMemoryStats();
            const providers = this.getProviderStatus();
            const providerNames = Object.keys(providers);

            let answer = '📊 **Статистика FunAI**\n\n';
            answer += `🎫 Активных тикетов: **${activeCount}**\n`;
            answer += `💬 Запросов сегодня: **${today.totalRequests}**\n`;
            answer += `• L0 (память): ${today.l0Hits} | L1 (правила): ${today.l1Hits} | L2 (AI): ${today.l2Hits}\n`;
            answer += `🎯 Точность: **${today.accuracy}%**\n`;
            answer += `🧠 Записей в памяти: **${memStats.total}**\n`;
            answer += `🔤 Токенов потрачено: **${today.tokensUsed.toLocaleString()}**\n`;
            if (providerNames.length > 0) {
                answer += `⚡ Провайдеры: ${providerNames.map(p => `${p} (${providers[p].keyCount} ключей)`).join(', ')}\n`;
            }
            return { answer, level: 'l0', source: 'builtin:stats' };
        }

        // ── Help ──
        if (/(помощь|help|что (ты )?умеешь|команды|возможности|функции)/i.test(normalized)) {
            let answer = '🧠 **Что я умею:**\n\n';
            answer += '📊 **Статистика** — «покажи статистику», «сколько тикетов»\n';
            answer += '📚 **Правила** — «правило 5.7», «что за правило 9.1»\n';
            answer += '🧠 **Память** — «запомни ...», «забудь ...»\n';
            answer += '💡 **Советы** — спроси о настройках, автоответах, FAQ\n';
            answer += '✏️ **AI-ответы** — любые вопросы через AI провайдеры\n';
            return { answer, level: 'l0', source: 'builtin:help' };
        }

        // ── Memory info ──
        if (/(что (ты )?помнишь|память|что (в )?памяти|memory|знания|база знаний)/i.test(normalized)) {
            const memStats = this.memory.getMemoryStats();
            let answer = '🧠 **Моя память:**\n\n';
            answer += `📦 Всего записей: **${memStats.total}**\n`;
            for (const [type, count] of Object.entries(memStats.byType)) {
                const icons = { qa: '❓', fact: '📌', correction: '✏️', rule: '📋' };
                answer += `${icons[type] || '📄'} ${type}: **${count}**\n`;
            }
            return { answer, level: 'l0', source: 'builtin:memory' };
        }

        // ── Provider status ──
        if (/(провайдер|provider|api|ключ|gemini|groq|openrouter)/i.test(normalized)) {
            const providers = this.getProviderStatus();
            const entries = Object.values(providers);
            if (entries.length === 0) {
                return { answer: '⚠️ Нет настроенных AI провайдеров. Добавьте API ключи в настройках.', level: 'l0', source: 'builtin:providers' };
            }
            let answer = '⚡ **AI Провайдеры:**\n\n';
            for (const p of entries) {
                const icon = p.name === 'gemini' ? '✨' : p.name === 'groq' ? '⚡' : '🌐';
                answer += `${icon} **${p.name}** — ${p.status === 'active' ? '✅ активен' : '⚠️ ошибка'}, ключей: ${p.keyCount}\n`;
            }
            return { answer, level: 'l0', source: 'builtin:providers' };
        }

        return null;
    }

    _checkL1(question, context) {
        const mode = context.mode || 'widget';

        // Check rules by ID (works in both widget and ticket modes)
        const ruleId = extractRuleIdFromQuestion(question);
        if (ruleId && _ruleById.has(ruleId)) {
            return { answer: _ruleById.get(ruleId), level: 'l1', source: `rule:${ruleId}` };
        }
        if (ruleId && !_ruleById.has(ruleId)) {
            return { answer: `Пункта ${ruleId} в базе не найдено.`, level: 'l1', source: 'rule:not_found' };
        }

        // ── Ticket mode only: auto-replies and binds for Discord channels ──
        if (mode === 'ticket') {
            const normalized = String(question || '').toLowerCase().trim();

            // Check binds
            const bindMatch = normalized.match(/^\/?([a-zа-яё0-9_-]+)$/i);
            if (bindMatch) {
                const bindName = bindMatch[1];
                const bind = this.bot?.config?.binds?.[bindName] || defaultBinds?.[bindName];
                if (bind?.message) {
                    return { answer: bind.message, level: 'l1', source: `bind:${bindName}` };
                }
            }

            // Check auto-replies (only in ticket context, NOT widget!)
            const decision = evaluateAutoReplyDecision({
                rules: this.bot?.config?.autoReplies || [],
                content: question,
                channelId: context.channelId || '',
                guildId: this.bot?.config?.guildId || '',
                source: 'funai',
            });
            if (decision.action === 'send' && decision.response) {
                return { answer: decision.response, level: 'l1', source: `rule:${decision.ruleName || 'auto'}` };
            }

            // Built-in ban/farm answers for tickets
            const asksFarm = /(заработ|заробот|фарм|как заработать)/i.test(question);
            if (asksFarm) {
                const farmBind = defaultBinds?.['заработок'] || defaultBinds?.['фарм'];
                if (farmBind?.message) return { answer: farmBind.message, level: 'l1', source: 'bind:farm' };
            }

            const asksBan = /(забан|бан|апелляц|разбан)/i.test(question);
            if (asksBan) {
                const banBind = defaultBinds?.['апелляция'];
                if (banBind?.message) return { answer: banBind.message, level: 'l1', source: 'bind:ban' };
            }
        }

        return null;
    }

    async _generateL2(question, context, memoryHits = []) {
        const cfg = this.bot?.config || {};
        const mode = context.mode || 'widget';

        // Build system prompt
        const systemPrompt = mode === 'ticket' ? await this._buildTicketPrompt(context) : await this._buildWidgetPrompt(context);

        // Build RAG context
        const ragResult = buildRagContextMessage({
            query: question,
            dataDir: this.dataDir,
            config: cfg,
            topK: 6,
        });

        // Build memory context
        let memoryContext = '';
        if (memoryHits.length > 0) {
            memoryContext = '\n\nИЗ ПАМЯТИ FUNAI:\n' + memoryHits.map((h, i) =>
                `${i + 1}. [${h.type}] ${h.question ? `Q: ${h.question} A: ` : ''}${h.content}`
            ).join('\n');
        }

        // FAQ context
        let faqContext = '';
        try {
            const articles = this.db.prepare('SELECT title, content FROM faq_articles ORDER BY created_at DESC LIMIT 10').all();
            if (articles.length > 0) {
                faqContext = '\n\nБАЗА ЗНАНИЙ:\n' + articles.map(a => `### ${a.title}\n${a.content}`).join('\n\n').substring(0, 4000);
            }
        } catch (_) { }

        // Build messages array
        const messages = [
            { role: 'system', content: systemPrompt + (ragResult.message ? '\n\n' + ragResult.message : '') + memoryContext + faqContext }
        ];

        // Add conversation history for widget mode
        if (mode === 'widget' && context.userId) {
            const history = this.memory.getConversations(context.userId, 20);
            for (const msg of history) {
                messages.push({ role: msg.role, content: msg.content });
            }
        }

        messages.push({ role: 'user', content: question });

        // Call AI provider
        const result = await this._requestAI(messages);
        if (!result.ok) {
            // Fallback: provide useful local data instead of just an error
            const fallback = this._buildFallbackAnswer(question, context, result.error);
            return { answer: fallback, level: 'l2', source: 'fallback', tokensUsed: 0 };
        }

        // Sanitize links
        const sanitized = sanitizeResponseLinks(result.answerText);

        // Parse actions from response
        const actions = this._parseActions(sanitized.text);

        return {
            answer: sanitized.text,
            level: 'l2',
            source: `${result.provider}:${result.model}`,
            tokensUsed: result.usage?.totalTokens || 0,
            actions,
        };
    }

    /** Build a useful fallback answer when AI providers fail */
    _buildFallbackAnswer(question, context, errorMessage = '') {
        const activeCount = this.bot?.activeTickets?.size || 0;
        const stats = this.memory.getStats(1);
        const providers = this.getProviderStatus();
        const providerNames = Object.keys(providers);

        let answer = '🤔 AI провайдеры сейчас недоступны, но вот что я могу показать:\n\n';
        answer += `📊 Активных тикетов: **${activeCount}**\n`;
        answer += `💬 Запросов сегодня: **${stats.today.totalRequests}**\n`;
        answer += `🧠 Записей в памяти: **${stats.totals.memoryEntries}**\n\n`;

        if (providerNames.length === 0) {
            answer += '⚠️ **Не настроены AI провайдеры.** Добавьте API ключи в Настройках → Gemini/Groq/OpenRouter ключи.';
        } else {
            answer += `⚡ Настроенные провайдеры: ${providerNames.join(', ')}\n`;
            if (errorMessage) {
                answer += `\n**Ошибка от провайдера:** \`${errorMessage}\`\nВозможно, истёк лимит запросов или ключ недействителен.`;
            } else {
                answer += '— возможно, истёк лимит запросов. Попробуйте позже.';
            }
        }

        return answer;
    }

    // ═══ AI Provider Logic ═══════════════════════════════════

    async _requestAI(messages, opts = {}) {
        const cfg = this.bot?.config || {};
        const creds = getAiCredentials(cfg);
        if (creds.length === 0) {
            return { ok: false, answerText: '', model: '', provider: '', error: 'no AI keys configured' };
        }

        let lastError = 'no response';
        for (let keyIndex = 0; keyIndex < creds.length; keyIndex++) {
            const cred = creds[keyIndex];
            let result = null;

            try {
                if (cred.provider === 'openrouter') {
                    result = await this._requestOpenAI('openrouter', 'https://openrouter.ai/api/v1/chat/completions', cred.key,
                        getProviderModels('OPENROUTER_MODELS', DEFAULT_OPENROUTER_MODELS), messages, opts);
                } else if (cred.provider === 'groq') {
                    result = await this._requestOpenAI('groq', 'https://api.groq.com/openai/v1/chat/completions', cred.key,
                        getProviderModels('GROQ_MODELS', DEFAULT_GROQ_MODELS), messages, opts);
                } else if (cred.provider === 'gemini') {
                    result = await this._requestGemini(cred.key,
                        getProviderModels('GEMINI_MODELS', DEFAULT_GEMINI_MODELS), messages, opts);
                } else {
                    continue;
                }
            } catch (err) {
                lastError = err.message;
                continue;
            }

            if (result?.ok) return result;
            if (result?.error) lastError = `${cred.provider}: ${result.error}`;
        }

        return { ok: false, answerText: '', model: '', provider: '', error: lastError };
    }

    async _requestOpenAI(provider, endpoint, apiKey, models, messages, opts = {}) {
        for (const model of models) {
            const payload = { model, messages, temperature: 0.7, max_tokens: opts.maxTokens || 800 };
            let res;
            try {
                res = await this.bot.httpPostWithHeaders(endpoint, payload, { Authorization: `Bearer ${apiKey}` });
            } catch (e) {
                this.bot.log(`⚠️ FunAI ${provider} network error [${model}]: ${e.message}`);
                await sleep(350);
                continue;
            }
            const data = parseProviderBody(res.body);
            const answerText = getOpenAiStyleAnswer(data);
            if (res.ok && answerText) {
                const usage = data?.usage || {};
                return { ok: true, answerText, model, provider, error: '', usage: { promptTokens: usage.prompt_tokens || 0, completionTokens: usage.completion_tokens || 0, totalTokens: usage.total_tokens || 0 } };
            }
            this.bot.log(`⚠️ FunAI ${provider} API error [${model}] ${res.status}: ${res.body?.slice(0, 200)}`);
            if (res.status === 401 || res.status === 403) break;
            if (res.status >= 500 || res.status === 429) await sleep(350);
        }
        return { ok: false, answerText: '', model: '', provider, error: 'all models failed' };
    }

    async _requestGemini(apiKey, models, messages, opts = {}) {
        const prompt = messages.map(m => `${String(m.role || 'user').toUpperCase()}:\n${String(m.content || '').trim()}`).filter(Boolean).join('\n\n');
        if (!prompt) return { ok: false, answerText: '', model: '', provider: 'gemini', error: 'empty prompt' };

        const versions = DEFAULT_GEMINI_API_VERSIONS;
        for (const model of models) {
            for (const version of versions) {
                const url = `https://generativelanguage.googleapis.com/${version}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
                const payload = {
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.7, maxOutputTokens: opts.maxTokens || 800 },
                };
                let res;
                try {
                    res = await this.bot.httpPost(url, payload);
                } catch (e) {
                    this.bot.log(`⚠️ FunAI gemini network error [${model}@${version}]: ${e.message}`);
                    await sleep(350);
                    continue;
                }
                const data = parseProviderBody(res.body);
                const answerText = getGeminiAnswer(data);
                if (res.ok && answerText) {
                    const um = data?.usageMetadata || {};
                    return { ok: true, answerText, model: `${model}@${version}`, provider: 'gemini', error: '', usage: { promptTokens: um.promptTokenCount || 0, completionTokens: um.candidatesTokenCount || 0, totalTokens: um.totalTokenCount || 0 } };
                }
                this.bot.log(`⚠️ FunAI gemini API error [${model}@${version}] ${res.status}: ${res.body?.slice(0, 200)}`);
                if (res.status === 401 || res.status === 403) break;
                if (res.status === 404) continue; // Try next version
                if (res.status >= 500 || res.status === 429) await sleep(350);
            }
        }
        return { ok: false, answerText: '', model: '', provider: 'gemini', error: 'all models failed' };
    }

    // ═══ Prompt Builders ═════════════════════════════════════

    async _buildWidgetPrompt(context) {
        const activeCount = this.bot?.activeTickets?.size || 0;
        const stats = this.memory.getStats(1);
        const today = stats.today;

        let contextInfo = `\n\n═══ КОНТЕКСТ ═══\n`;
        contextInfo += `- Текущая страница: ${context.currentPage || 'неизвестно'}\n`;
        contextInfo += `- Активные тикеты: ${activeCount}\n`;
        contextInfo += `- Запросов сегодня: ${today.totalRequests}\n`;
        contextInfo += `- Записей в памяти: ${stats.totals.memoryEntries}\n`;

        // 🧠 Live Ticket Injection
        if (context.currentPage && context.currentPage.startsWith('/tickets/')) {
            const ticketId = context.currentPage.split('/')[2];
            if (ticketId && this.bot?.activeTickets?.has(ticketId)) {
                const ticket = this.bot.activeTickets.get(ticketId);
                const msToMin = (ms) => Math.floor(ms / 60000);
                const minsAgo = msToMin(Date.now() - ticket.createdAt);

                const ticketName = ticket.channelName || 'текущий тикет';

                contextInfo += `\n[ОТКРЫТЫЙ ТИКЕТ: ${ticketName}]\n`;
                contextInfo += `Автор: ${ticket.openerUsername || ticket.openerId || 'неизвестно'}\n`;
                contextInfo += `Создан: ${minsAgo} минут назад\n`;

                try {
                    const rawMsgs = await this.bot.fetchChannelMessages(ticketId, 15);
                    if (rawMsgs && rawMsgs.length > 0) {
                        contextInfo += `\n[ПОСЛЕДНИЕ СООБЩЕНИЯ ТИКЕТА]\n`;
                        const recent = rawMsgs.reverse();
                        for (const msg of recent) {
                            const author = msg.author?.username || 'Участник';
                            let text = msg.content || '';
                            if (msg.embeds && msg.embeds.length > 0) {
                                text += ' ' + msg.embeds.map(e => e.description || e.title).join(' ');
                            }
                            if (text.trim()) {
                                contextInfo += `${author}: ${text.trim()}\n`;
                            }
                        }
                    } else {
                        contextInfo += `\n[ПОСЛЕДНИЕ СООБЩЕНИЯ ТИКЕТА]\n(Сообщений нет или ошибка доступа)\n`;
                    }
                } catch (e) {
                    contextInfo += `\n(Ошибка загрузки сообщений: ${e.message})\n`;
                }
            } else if (ticketId) {
                contextInfo += `\n[ВНИМАНИЕ: Тикет не найден в списке активных или уже закрыт.]\n`;
            }
        }

        let providerInfo = '';
        const creds = getAiCredentials(this.bot?.config || {});
        if (creds.length > 0) {
            const providers = [...new Set(creds.map(c => c.provider))];
            providerInfo = `- AI Провайдеры: ${providers.join(', ')}\n`;
        }

        return WIDGET_SYSTEM_PROMPT + contextInfo + providerInfo;
    }

    async _buildTicketPrompt(context) {
        return TICKET_SYSTEM_PROMPT;
    }

    // ═══ Action Parser ═══════════════════════════════════════

    _parseActions(text) {
        const actions = [];
        const regex = /\[ACTION:([^\]]+)\]/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            const parts = match[1].split(':');
            actions.push({
                type: parts.slice(0, 2).join(':'),
                params: parts.slice(2).join(':') || null,
                raw: match[0],
            });
        }
        return actions;
    }

    // ═══ Ticket Integration ══════════════════════════════════

    /** Generate a draft reply for a ticket */
    async draftReply(channelId, messages = []) {
        const cfg = this.bot?.config || {};
        let faqContext = '';
        try {
            const articles = this.db.prepare('SELECT title, content FROM faq_articles ORDER BY created_at DESC LIMIT 10').all();
            if (articles.length > 0) {
                faqContext = '\n\n[БАЗА ЗНАНИЙ]\n' + articles.map(a => `### ${a.title}\n${a.content}`).join('\n\n').substring(0, 6000);
            }
        } catch (_) { }

        const systemPrompt = `Ты — AI-помощник (саппорт) для приватного сервера. Твоя задача — составить грамотный, вежливый и полезный ответ на последний вопрос пользователя в тикете. Отвечай кратко, от 1 до 3 предложений. Не используй приветствия.${faqContext}`;

        const formatted = [{ role: 'system', content: systemPrompt }];
        const recentMsgs = messages.slice(-20);
        for (const msg of recentMsgs) {
            let text = msg.content || (msg.embeds ? msg.embeds.map(e => e.description || e.title).join(' ') : '');
            if (!text) continue;
            formatted.push({ role: !!msg.author?.bot ? 'assistant' : 'user', content: `${msg.author?.username || 'User'}: ${text}` });
        }

        const result = await this._requestAI(formatted);
        if (!result.ok) throw new Error(result.error || 'Failed to generate reply');

        const sanitized = sanitizeResponseLinks(result.answerText);
        return sanitized.text;
    }

    /** Analyze a ticket conversation */
    async analyzeTicket(channelId, messages = []) {
        const systemPrompt = `Ты — AI-аналитик тикетов. Проанализируй диалог и дай краткую сводку: суть проблемы, настроение пользователя, рекомендуемый ответ. Отвечай структурированно.`;
        const formatted = [{ role: 'system', content: systemPrompt }];
        for (const msg of messages.slice(-30)) {
            let text = msg.content || (msg.embeds ? msg.embeds.map(e => e.description || e.title).join(' ') : '');
            if (!text) continue;
            formatted.push({ role: !!msg.author?.bot ? 'assistant' : 'user', content: `${msg.author?.username || 'User'}: ${text}` });
        }
        const result = await this._requestAI(formatted);
        if (!result.ok) throw new Error(result.error || 'Failed to analyze');
        return result.answerText;
    }

    /** Auto-learn from a closed ticket */
    async learnFromClosedTicket(channelId, messages = [], ticketName = 'тикет', authorName = 'пользователь') {
        const systemPrompt = `Ты — AI-аналитик базы знаний. Проанализируй диалог из закрытого тикета поддержки. Твоя задача: найти главную проблему пользователя и найденное решение.
Если проблема была решена, верни ответ строго в формате JSON:
{"question": "краткая суть проблемы", "answer": "кратко как её решили (вывод)"}
Если проблема не ясна, это спам, болтовня или тикет закрыт без конкретного ответа/решения, верни ровно слово: null
Отвечай ТОЛЬКО чистым JSON без форматирования Markdown и без дополнительных слов.`;
        
        const formatted = [{ role: 'system', content: systemPrompt }];
        let msgCount = 0;
        for (const msg of messages.slice(-30)) {
            let text = msg.content || (msg.embeds ? msg.embeds.map(e => e.description || e.title).join(' ') : '');
            if (!text || text.trim().length < 2) continue;
            const role = !!msg.author?.bot ? 'assistant' : 'user';
            const name = msg.author?.bot ? 'Модератор' : authorName;
            formatted.push({ role, content: `${name}: ${text}` });
            msgCount++;
        }

        if (msgCount < 3) return; // Too short to extract deep knowledge

        try {
            // maxTokens 400 is plenty for a short JSON response
            const result = await this._requestAI(formatted, { maxTokens: 400 });
            if (!result.ok) return;

            const answer = result.answerText.trim();
            if (answer && answer !== 'null' && answer !== 'None' && answer !== 'null.') {
                try {
                    // Try to parse JSON robustly
                    const jsonMatch = answer.match(/\{[\s\S]*?\}/);
                    const jsonStr = jsonMatch ? jsonMatch[0] : answer;
                    const data = JSON.parse(jsonStr);

                    if (data.question && data.answer && data.question.length > 5 && data.answer.length > 5) {
                        this.memory.add({
                            type: 'qa',
                            category: 'auto-learn',
                            question: data.question,
                            content: data.answer,
                            source: `ticket:${ticketName}`,
                            confidence: 0.8
                        });
                        console.log(`${LOG} 🧠 Инсайт добавлен в память из закрытого тикета ${ticketName}`);
                    }
                } catch (e) {
                    console.log(`${LOG} ⚠️ Ошибка парсинга JSON для автообучения (${ticketName}): ${answer.slice(0, 50)}`);
                }
            }
        } catch (e) {
            console.error(`${LOG} ❌ Ошибка автообучения из тикета: ${e.message}`);
        }
    }

    // ═══ Memory ══════════════════════════════════════════════

    remember(fact, source = 'widget') { return this.memory.remember(fact, source); }
    forget(factId) { return this.memory.delete(factId); }
    searchMemory(query) { return this.memory.search(query); }
    getMemoryStats() { return this.memory.getMemoryStats(); }

    learnFromCorrection(original, corrected) {
        this.memory.learnCorrection(original, corrected);
        this.memory.trackCorrection();
    }

    learnFromConversation(question, answer) {
        this.memory.learnQA(question, answer, 'conversation');
    }

    // ═══ Insights & Suggestions ══════════════════════════════

    async getInsights() {
        const insights = [];
        const activeCount = this.bot?.activeTickets?.size || 0;

        if (activeCount > 5) {
            insights.push({ type: 'warning', title: 'Много открытых тикетов', text: `Сейчас открыто ${activeCount} тикетов. Рекомендую обработать наиболее старые.`, icon: '⚠️' });
        }

        const stats = this.memory.getStats(7);
        if (stats.today.corrections > 3) {
            insights.push({ type: 'info', title: 'Много исправлений', text: `Сегодня было ${stats.today.corrections} исправлений. Возможно, стоит обновить базу знаний.`, icon: '📝' });
        }

        // Check for unanswered tickets
        if (this.bot?.activeTickets) {
            const now = Date.now();
            for (const [id, ticket] of this.bot.activeTickets) {
                const age = now - (ticket.createdAt || now);
                if (age > 30 * 60 * 1000 && !ticket.lastStaffMessageAt) {
                    insights.push({ type: 'alert', title: 'Тикет без ответа', text: `Тикет ${ticket.channelName || id} ждёт ответа уже ${Math.round(age / 60000)} мин.`, icon: '🔴' });
                }
            }
        }

        return insights;
    }

    getSuggestions(page) {
        const suggestions = [];
        switch (page) {
            case '/tickets':
                suggestions.push({ text: 'Покажи статистику тикетов за сегодня', icon: '📊' });
                suggestions.push({ text: 'Какие тикеты самые старые?', icon: '⏰' });
                break;
            case '/settings':
                suggestions.push({ text: 'Объясни настройку авто-приветствия', icon: '⚙️' });
                suggestions.push({ text: 'Какие настройки рекомендуешь?', icon: '💡' });
                break;
            case '/analytics':
                suggestions.push({ text: 'Когда пик тикетов?', icon: '📈' });
                suggestions.push({ text: 'Средняя скорость ответа?', icon: '⚡' });
                break;
            default:
                suggestions.push({ text: 'Привет! Чем можешь помочь?', icon: '👋' });
                suggestions.push({ text: 'Покажи статистику', icon: '📊' });
                break;
        }
        return suggestions;
    }

    // ═══ Stats ════════════════════════════════════════════════

    getStats() {
        return this.memory.getStats(30);
    }

    getProviderStatus() {
        const cfg = this.bot?.config || {};
        const creds = getAiCredentials(cfg);
        const providers = {};
        for (const cred of creds) {
            if (!providers[cred.provider]) {
                providers[cred.provider] = { name: cred.provider, status: 'active', keyCount: 0 };
            }
            providers[cred.provider].keyCount++;
        }
        return providers;
    }
}

module.exports = FunAI;
