// ═══════════════════════════════════════════════════════════════
//  FunAI API Routes — /api/funai/*
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const { authenticateToken } = require('./auth');

function createFunAiRoutes(db, botManager) {
    const router = express.Router();

    // Helper: get FunAI instance for authenticated user
    function getFunAI(req, res) {
        const userId = req.user?.userId;
        if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return null; }
        const bot = botManager.bots.get(userId);
        if (!bot) { 
            console.log(`[API] getFunAI: bot is undefined for user ${userId}`); 
            res.status(400).json({ error: 'FunAI not initialized — Bot is offline' }); 
            return null; 
        }
        if (!bot.funai) {
            console.log(`[API] getFunAI: bot.funai is undefined for user ${userId}`); 
            res.status(400).json({ error: 'FunAI not initialized' }); 
            return null;
        }
        return bot.funai;
    }

    // ── Chat ──────────────────────────────────────────────────
    router.post('/chat', authenticateToken, async (req, res) => {
        const funai = getFunAI(req, res);
        if (!funai) return;
        const { message, currentPage, sessionId } = req.body;
        if (!message) return res.status(400).json({ error: 'message required' });

        try {
            const result = await funai.ask(message, {
                mode: 'widget',
                currentPage: currentPage || '',
                userId: req.user.userId,
                sessionId: sessionId || 'default'
            });
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Conversations ─────────────────────────────────────────
    router.get('/conversations', authenticateToken, (req, res) => {
        const funai = getFunAI(req, res);
        if (!funai) return;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const sessionId = req.query.sessionId || 'default';
        const conversations = funai.memory.getConversations(req.user.userId, limit, sessionId);
        res.json({ conversations });
    });

    router.delete('/conversations', authenticateToken, (req, res) => {
        const funai = getFunAI(req, res);
        if (!funai) return;
        const sessionId = req.query.sessionId;
        funai.memory.clearConversations(req.user.userId, sessionId);
        res.json({ ok: true });
    });

    // ── Sessions ──────────────────────────────────────────────
    router.get('/sessions', authenticateToken, (req, res) => {
        const funai = getFunAI(req, res);
        if (!funai) return;
        try {
            const sessions = funai.memory.getChatSessions(req.user.userId);
            res.json({ sessions });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Memory ────────────────────────────────────────────────
    router.get('/memory', authenticateToken, (req, res) => {
        const funai = getFunAI(req, res);
        if (!funai) return;
        const { type, category, search, limit, offset } = req.query;
        const entries = funai.memory.getAll({
            type: type || undefined,
            category: category || undefined,
            search: search || undefined,
            limit: Math.min(parseInt(limit) || 100, 500),
            offset: parseInt(offset) || 0,
        });
        const stats = funai.memory.getMemoryStats();
        res.json({ entries, stats });
    });

    router.post('/memory', authenticateToken, (req, res) => {
        const funai = getFunAI(req, res);
        if (!funai) return;
        const { type, category, question, content, source, confidence } = req.body;
        if (!content) return res.status(400).json({ error: 'content required' });
        const id = funai.memory.add({
            type: type || 'fact',
            category: category || '',
            question: question || null,
            content,
            source: source || 'admin',
            confidence: confidence || 1.0,
        });
        res.json({ ok: true, id });
    });

    router.put('/memory/:id', authenticateToken, (req, res) => {
        const funai = getFunAI(req, res);
        if (!funai) return;
        const { content, question, category, confidence } = req.body;
        funai.memory.update(parseInt(req.params.id), { content, question, category, confidence });
        res.json({ ok: true });
    });

    router.delete('/memory/:id', authenticateToken, (req, res) => {
        const funai = getFunAI(req, res);
        if (!funai) return;
        funai.memory.delete(parseInt(req.params.id));
        res.json({ ok: true });
    });

    // ── Stats ─────────────────────────────────────────────────
    router.get('/stats', authenticateToken, (req, res) => {
        const funai = getFunAI(req, res);
        if (!funai) return;
        res.json(funai.getStats());
    });

    router.post('/stats/reset', authenticateToken, (req, res) => {
        const funai = getFunAI(req, res);
        if (!funai) return;
        try {
            db.prepare('DELETE FROM funai_stats').run();
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Insights & Suggestions ────────────────────────────────
    router.get('/insights', authenticateToken, async (req, res) => {
        const funai = getFunAI(req, res);
        if (!funai) return;
        try {
            const insights = await funai.getInsights();
            res.json({ insights });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get('/suggestions', authenticateToken, (req, res) => {
        const funai = getFunAI(req, res);
        if (!funai) return;
        const page = req.query.page || '/';
        res.json({ suggestions: funai.getSuggestions(page) });
    });

    // ── Providers ─────────────────────────────────────────────
    router.get('/providers', authenticateToken, (req, res) => {
        const funai = getFunAI(req, res);
        if (!funai) return;
        res.json({ providers: funai.getProviderStatus() });
    });

    // ── Learn ─────────────────────────────────────────────────
    router.post('/learn', authenticateToken, async (req, res) => {
        const funai = getFunAI(req, res);
        if (!funai) return;
        try {
            // Import FAQ articles into memory
            const articles = db.prepare('SELECT title, content, keywords FROM faq_articles').all();
            let imported = 0;
            for (const article of articles) {
                const existing = db.prepare(
                    'SELECT id FROM funai_memory WHERE type = ? AND content = ? AND source = ?'
                ).get('qa', article.content, 'faq');
                if (!existing) {
                    funai.memory.add({
                        type: 'qa',
                        category: 'faq',
                        question: article.title,
                        content: article.content,
                        source: 'faq',
                        confidence: 0.9,
                    });
                    imported++;
                }
            }
            res.json({ ok: true, imported });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Execute Action ────────────────────────────────────────
    router.post('/execute', authenticateToken, async (req, res) => {
        const funai = getFunAI(req, res);
        if (!funai) return;
        const { action, params } = req.body;
        if (!action) return res.status(400).json({ error: 'action required' });

        try {
            funai.memory.logAction(action, params, null, 'widget');
            // Actions are dispatched client-side (navigation, etc.)
            res.json({ ok: true, action, params });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── API Keys ──────────────────────────────────────────────
    router.get('/keys', authenticateToken, (req, res) => {
        try {
            const keys = db.prepare('SELECT id, name, api_key, created_at FROM funai_api_keys WHERE user_id = ? ORDER BY created_at DESC').all(req.user.userId);
            res.json({ keys });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.post('/keys', authenticateToken, (req, res) => {
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'Name required' });
        const crypto = require('crypto');
        const apiKey = 'sk-funai-' + crypto.randomBytes(24).toString('hex');
        try {
            const info = db.prepare('INSERT INTO funai_api_keys (user_id, name, api_key) VALUES (?, ?, ?)').run(req.user.userId, name, apiKey);
            res.json({ ok: true, id: info.lastInsertRowid, apiKey });
        } catch(err) { res.status(500).json({ error: err.message }); }
    });

    router.delete('/keys/:id', authenticateToken, (req, res) => {
        try {
            db.prepare('DELETE FROM funai_api_keys WHERE id = ? AND user_id = ?').run(req.params.id, req.user.userId);
            res.json({ ok: true });
        } catch(err) { res.status(500).json({ error: err.message }); }
    });

    // ── Public Chat Endpoint ──────────────────────────────────
    router.post('/public/chat', async (req, res) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or invalid Authorization header' });
        }
        const apiKey = authHeader.split(' ')[1];
        
        try {
            const tokenRecord = db.prepare('SELECT user_id FROM funai_api_keys WHERE api_key = ?').get(apiKey);
            if (!tokenRecord) return res.status(403).json({ error: 'Invalid API Key' });
            
            const bot = botManager.bots.get(tokenRecord.user_id);
            if (!bot || !bot.funai) return res.status(500).json({ error: 'FunAI not initialized for this user' });
            
            const { message, context } = req.body;
            if (!message) return res.status(400).json({ error: 'message required in request body' });
            
            const result = await bot.funai.ask(message, {
                mode: 'api',
                currentPage: context || 'api_request',
                userId: tokenRecord.user_id,
            });
            
            res.json({
                answer: result.answer,
                level: result.level,
                tokensUsed: result.tokensUsed,
                actions: result.actions || [] // Expose if any actions triggered
            });
        } catch(err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Bulk Memory Import ─────────────────────────────────────
    router.post('/memory/import', authenticateToken, (req, res) => {
        const funai = getFunAI(req, res);
        if (!funai) return;

        const { entries } = req.body;
        if (!Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({ error: 'entries array required' });
        }

        let imported = 0;
        let skipped = 0;
        for (const entry of entries) {
            if (!entry.content) { skipped++; continue; }
            try {
                // Check for duplicates
                const existing = funai.memory.db.prepare(
                    'SELECT id FROM funai_memory WHERE content = ? AND type = ? LIMIT 1'
                ).get(entry.content, entry.type || 'fact');
                if (existing) { skipped++; continue; }

                funai.memory.add({
                    type: entry.type || 'fact',
                    category: entry.category || 'parsed_discord',
                    question: entry.question || null,
                    content: entry.content,
                    source: entry.source || 'import',
                    confidence: entry.confidence || 1.0,
                });
                imported++;
            } catch (e) {
                skipped++;
            }
        }

        res.json({ imported, skipped, total: entries.length });
    });

    return router;
}

module.exports = { createFunAiRoutes };
