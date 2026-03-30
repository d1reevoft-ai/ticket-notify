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
        if (!bot || !bot.funai) { res.status(400).json({ error: 'FunAI not initialized' }); return null; }
        return bot.funai;
    }

    // ── Chat ──────────────────────────────────────────────────
    router.post('/chat', authenticateToken, async (req, res) => {
        const funai = getFunAI(req, res);
        if (!funai) return;
        const { message, currentPage } = req.body;
        if (!message) return res.status(400).json({ error: 'message required' });

        try {
            const result = await funai.ask(message, {
                mode: 'widget',
                currentPage: currentPage || '',
                userId: req.user.userId,
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
        const conversations = funai.memory.getConversations(req.user.userId, limit);
        res.json({ conversations });
    });

    router.delete('/conversations', authenticateToken, (req, res) => {
        const funai = getFunAI(req, res);
        if (!funai) return;
        funai.memory.clearConversations(req.user.userId);
        res.json({ ok: true });
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

    return router;
}

module.exports = { createFunAiRoutes };
