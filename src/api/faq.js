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
            // Fetch some recent closed tickets that match the topic roughly
            const closedRows = bot.db.prepare(`
                SELECT channel_id FROM closed_tickets
                WHERE channel_name LIKE ? OR opener_username LIKE ?
                ORDER BY closed_at DESC LIMIT ?
            `).all(`%${topic}%`, `%${topic}%`, limit);

            if (closedRows.length === 0) {
                return res.status(404).json({ error: 'No relevant closed tickets found for this topic to analyze.' });
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
                return res.status(404).json({ error: 'Found relevant tickets, but they have no messages archived.' });
            }

            // In gateway.js we have a requestAiAnswer function
            const { requestAiAnswer } = require('../bot/gateway');
            
            const prompt = `You are a helpful IT support knowledge base author. 
Based on the following past support ticket transcripts about the topic "${topic}", write a comprehensive, clear, and professional FAQ article. 
The article should have a title and a markdown-formatted body explaining the problem and how to solve it based ONLY on the provided tickets.

Past Tickets:
${combinedContext.substring(0, 15000)}

Please return only the markdown content. The first line should be the title starting with "# ".`;

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
