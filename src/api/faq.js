const express = require('express');
const { authenticateToken } = require('./auth');

function createFaqRoutes(db, botManager) {
    const router = express.Router();
    router.use(authenticateToken);

    // Get all FAQ articles
    router.get('/', (req, res) => {
        const userId = req.user.userId;
        const bot = botManager.bots.get(userId);
        if (!bot) return res.status(400).json({ error: 'Bot is not running' });

        try {
            const articles = bot.db.prepare('SELECT id, title, content, created_at FROM faq_articles ORDER BY created_at DESC').all();
            res.json(articles);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Generate FAQ from past tickets using Gemini
    router.post('/generate', async (req, res) => {
        const userId = req.user.userId;
        const bot = botManager.bots.get(userId);
        if (!bot) return res.status(400).json({ error: 'Bot is not running' });

        const { topic, limit = 10 } = req.body;
        if (!topic) return res.status(400).json({ error: 'Topic is required' });

        try {
            // Strategy 1: Search message content in ticket_messages for the topic keyword
            // Get channel_ids that have messages containing the topic
            let closedRows;

            const matchingChannels = bot.db.prepare(`
                SELECT DISTINCT tm.channel_id 
                FROM ticket_messages tm
                INNER JOIN closed_tickets ct ON ct.channel_id = tm.channel_id
                WHERE tm.content LIKE ?
                ORDER BY ct.closed_at DESC
                LIMIT ?
            `).all(`%${topic}%`, limit);

            if (matchingChannels.length > 0) {
                closedRows = matchingChannels;
            } else {
                // Strategy 2: Also try channel_name and opener_username
                closedRows = bot.db.prepare(`
                    SELECT channel_id FROM closed_tickets
                    WHERE channel_name LIKE ? OR opener_username LIKE ?
                    ORDER BY closed_at DESC LIMIT ?
                `).all(`%${topic}%`, `%${topic}%`, limit);
            }

            // Strategy 3: If still nothing, just take the most recent closed tickets
            if (closedRows.length === 0) {
                closedRows = bot.db.prepare(`
                    SELECT channel_id FROM closed_tickets
                    ORDER BY closed_at DESC LIMIT ?
                `).all(limit);
            }

            if (closedRows.length === 0) {
                return res.status(404).json({ error: 'No closed tickets found in the archive.' });
            }

            let combinedContext = '';
            for (const row of closedRows) {
                const messages = bot.dbGetTicketMessages(row.channel_id);
                if (messages.length > 0) {
                    const threadText = messages.map(m => `${m.author.username}: ${m.content}`).join('\n');
                    combinedContext += `--- Ticket ---\n${threadText}\n\n`;
                }
            }

            if (!combinedContext.trim()) {
                return res.status(404).json({ error: 'Found closed tickets, but they have no messages archived.' });
            }

            // In gateway.js we have a requestAiAnswer function
            const { requestAiAnswer } = require('../bot/gateway');
            
            const prompt = `Ты — автор базы знаний для техподдержки. На основе приведённых ниже расшифровок закрытых тикетов на тему "${topic}", напиши подробную, понятную и профессиональную статью для FAQ.
Статья должна иметь заголовок и тело в формате Markdown. Объясни проблему и как её решить, основываясь ТОЛЬКО на предоставленных тикетах.
Пиши на русском языке.

Прошлые тикеты:
${combinedContext.substring(0, 15000)}

Верни только markdown. Первая строка должна быть заголовком, начинающимся с "# ".`;

            bot.log(`🧠 Generating FAQ article for topic: "${topic}" using ${closedRows.length} tickets...`);
            
            // Format messages for requestAiAnswer
            const aiMessages = [{ role: 'user', content: prompt }];
            const aiResult = await requestAiAnswer(bot, bot.config, aiMessages, { logPrefix: 'FAQ: ' });
            
            if (!aiResult.ok) {
                return res.status(500).json({ error: aiResult.error || 'Failed to generate FAQ from AI' });
            }

            let content = aiResult.answerText;
            
            // Clean up backticks if any
            if (content.startsWith('\`\`\`markdown')) {
                content = content.replace(/^\`\`\`markdown\n/i, '').replace(/\n\`\`\`$/i, '');
            } else if (content.startsWith('\`\`\`')) {
                content = content.replace(/^\`\`\`\n/i, '').replace(/\n\`\`\`$/i, '');
            }

            const lines = content.split('\n');
            let title = `FAQ: ${topic}`;
            if (lines[0].startsWith('# ')) {
                title = lines[0].replace(/^#\s*/, '').trim();
                content = lines.slice(1).join('\n').trim();
            }

            const info = bot.db.prepare('INSERT INTO faq_articles (title, content, created_at) VALUES (?, ?, ?)').run(title, content, Date.now());
            
            bot.log(`✅ FAQ article "${title}" generated and saved (ID: ${info.lastInsertRowid}).`);
            res.json({ id: info.lastInsertRowid, title, content, created_at: Date.now() });

        } catch (err) {
            bot.log(`❌ AI FAQ Error: ${err.message}`);
            res.status(500).json({ error: err.message });
        }
    });

    // Create a new manual FAQ article
    router.post('/', (req, res) => {
        const userId = req.user.userId;
        const bot = botManager.bots.get(userId);
        if (!bot) return res.status(400).json({ error: 'Bot is not running' });

        const { title, content } = req.body;
        if (!title || !content) return res.status(400).json({ error: 'Title and content are required' });

        try {
            const info = bot.db.prepare('INSERT INTO faq_articles (title, content, created_at) VALUES (?, ?, ?)').run(title, content, Date.now());
            res.json({ id: info.lastInsertRowid, title, content, created_at: Date.now() });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Update an FAQ article
    router.patch('/:id', (req, res) => {
        const userId = req.user.userId;
        const bot = botManager.bots.get(userId);
        if (!bot) return res.status(400).json({ error: 'Bot is not running' });

        const articleId = req.params.id;
        const { title, content } = req.body;
        if (!title || !content) return res.status(400).json({ error: 'Title and content are required' });

        try {
            bot.db.prepare('UPDATE faq_articles SET title = ?, content = ? WHERE id = ?').run(title, content, articleId);
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Delete an FAQ article
    router.delete('/:id', (req, res) => {
        const userId = req.user.userId;
        const bot = botManager.bots.get(userId);
        if (!bot) return res.status(400).json({ error: 'Bot is not running' });

        const articleId = req.params.id;
        try {
            bot.db.prepare('DELETE FROM faq_articles WHERE id = ?').run(articleId);
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
}

module.exports = { createFaqRoutes };
