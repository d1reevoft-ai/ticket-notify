// ═══════════════════════════════════════════════════════════════
//  FunAI Memory Manager — SQLite-based persistent memory
// ═══════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const LOG = '[FunAI Memory]';

class FunAIMemory {
    constructor(db, dataDir) {
        this.db = db;
        this.dataDir = dataDir || '';
        this._initTables();
        this._migrateFromJson();
    }

    // ── Table Creation ──────────────────────────────────────
    _initTables() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS funai_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL DEFAULT 'fact',
                category TEXT DEFAULT '',
                question TEXT,
                content TEXT NOT NULL,
                source TEXT DEFAULT '',
                confidence REAL DEFAULT 1.0,
                usage_count INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                expires_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_funai_memory_type ON funai_memory(type);
            CREATE INDEX IF NOT EXISTS idx_funai_memory_category ON funai_memory(category);
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS funai_conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                actions TEXT,
                context_page TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_funai_conv_user ON funai_conversations(user_id);
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS funai_actions_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action_type TEXT NOT NULL,
                params TEXT,
                result TEXT,
                source TEXT DEFAULT '',
                created_at INTEGER NOT NULL
            );
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS funai_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL UNIQUE,
                total_requests INTEGER DEFAULT 0,
                l0_hits INTEGER DEFAULT 0,
                l1_hits INTEGER DEFAULT 0,
                l2_hits INTEGER DEFAULT 0,
                corrections INTEGER DEFAULT 0,
                tokens_used INTEGER DEFAULT 0,
                accuracy REAL DEFAULT 0
            );
        `);

        console.log(`${LOG} ✅ SQLite tables initialized.`);
    }

    // ── Migration from learned_knowledge.json ───────────────
    _migrateFromJson() {
        try {
            const knowledgePath = path.join(this.dataDir, 'learned_knowledge.json');
            if (!fs.existsSync(knowledgePath)) return;

            // Check if we already migrated
            const count = this.db.prepare('SELECT COUNT(*) as cnt FROM funai_memory WHERE source = ?').get('migration');
            if (count && count.cnt > 0) return;

            const knowledge = JSON.parse(fs.readFileSync(knowledgePath, 'utf8'));
            if (!Array.isArray(knowledge) || knowledge.length === 0) return;

            const now = Date.now();
            const insert = this.db.prepare(`
                INSERT INTO funai_memory (type, category, question, content, source, confidence, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const txn = this.db.transaction((items) => {
                let migrated = 0;
                for (const item of items) {
                    if (!item || typeof item !== 'object') continue;
                    if (item.type === 'qa' && item.question && item.answer) {
                        insert.run('qa', 'tickets', item.question, item.answer, 'migration', 0.8, now, now);
                        migrated++;
                    } else if (item.type === 'fact' && item.content) {
                        insert.run('fact', 'general', null, item.content, 'migration', 0.7, now, now);
                        migrated++;
                    }
                }
                return migrated;
            });

            const migrated = txn(knowledge);
            if (migrated > 0) {
                console.log(`${LOG} ✅ Migrated ${migrated} entries from learned_knowledge.json`);
            }
        } catch (e) {
            console.error(`${LOG} ⚠️ Migration error: ${e.message}`);
        }
    }

    // ── CRUD Operations ─────────────────────────────────────

    /** Add a memory entry */
    add({ type = 'fact', category = '', question = null, content, source = 'admin', confidence = 1.0, expiresAt = null }) {
        if (!content) return null;
        const now = Date.now();
        const result = this.db.prepare(`
            INSERT INTO funai_memory (type, category, question, content, source, confidence, created_at, updated_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(type, category, question, content, source, confidence, now, now, expiresAt);
        return result.lastInsertRowid;
    }

    /** Update a memory entry */
    update(id, { content, question, category, confidence }) {
        const now = Date.now();
        const fields = [];
        const values = [];
        if (content !== undefined) { fields.push('content = ?'); values.push(content); }
        if (question !== undefined) { fields.push('question = ?'); values.push(question); }
        if (category !== undefined) { fields.push('category = ?'); values.push(category); }
        if (confidence !== undefined) { fields.push('confidence = ?'); values.push(confidence); }
        fields.push('updated_at = ?');
        values.push(now);
        values.push(id);
        if (fields.length <= 1) return false;
        this.db.prepare(`UPDATE funai_memory SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return true;
    }

    /** Delete a memory entry */
    delete(id) {
        this.db.prepare('DELETE FROM funai_memory WHERE id = ?').run(id);
        return true;
    }

    /** Get a memory entry by ID */
    get(id) {
        return this.db.prepare('SELECT * FROM funai_memory WHERE id = ?').get(id);
    }

    /** Get all memory entries with optional filtering */
    getAll({ type, category, search, limit = 100, offset = 0 } = {}) {
        let sql = 'SELECT * FROM funai_memory WHERE 1=1';
        const params = [];

        // Clean expired entries
        this.db.prepare('DELETE FROM funai_memory WHERE expires_at IS NOT NULL AND expires_at < ?').run(Date.now());

        if (type) {
            sql += ' AND type = ?';
            params.push(type);
        }
        if (category) {
            sql += ' AND category = ?';
            params.push(category);
        }
        if (search) {
            sql += ' AND (content LIKE ? OR question LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        return this.db.prepare(sql).all(...params);
    }

    /** Full-text search in memory */
    search(query, limit = 10) {
        if (!query) return [];
        
        // Russian stop words
        const stopWords = new Set(['я','ты','он','она','оно','мы','вы','они','что','кто','как','какие','какая','какой','где','когда','зачем','почему','для','на','в','с','к','от','до','из','у','о','об','и','а','но','да','нет','это','тот','эта','те','то']);
        
        const rawTokens = String(query).toLowerCase().replace(/[^\w\sа-яё]/gi, '').split(/\s+/);
        // Deduplicate tokens and filter noise
        const tokens = [...new Set(rawTokens)].filter(t => t.length > 2 && !stopWords.has(t));
        
        if (tokens.length === 0) return [];

        // Advanced SQL Query for Match Count Scoring
        const conditions = tokens.map(() => '(LOWER(content) LIKE ? OR LOWER(question) LIKE ?)');
        const matchCalculations = tokens.map((_, i) => `(CASE WHEN LOWER(content) LIKE ? OR LOWER(question) LIKE ? THEN 1 ELSE 0 END)`);
        
        const params = [];
        for (const token of tokens) {
            params.push(`%${token}%`, `%${token}%`);
        }

        // Params for the WHERE OR clause
        const matchParams = [];
        for (const token of tokens) {
            matchParams.push(`%${token}%`, `%${token}%`); 
        }

        const sql = `
            SELECT *, 
                   (${matchCalculations.join(' + ')}) as match_count,
                   (CASE WHEN type = 'correction' THEN 3 
                         WHEN source = 'admin' THEN 2 
                         WHEN type = 'qa' THEN 1.5 
                         ELSE 1 END) * confidence AS score
            FROM funai_memory 
            WHERE (expires_at IS NULL OR expires_at > ?) AND (${conditions.join(' OR ')})
            ORDER BY match_count DESC, score DESC, usage_count DESC
            LIMIT ?
        `;

        // We pass the params twice: first for the calculation CASE block, second for the WHERE OR block
        const results = this.db.prepare(sql).all(...params, Date.now(), ...matchParams, limit);

        // Filter out very weak matches (optional, but good for reducing hallucinations)
        const relevantResults = results; // results.filter(r => r.match_count >= Math.min(tokens.length, 2));

        if (relevantResults.length > 0) {
            const ids = relevantResults.map(r => r.id);
            this.db.prepare(`UPDATE funai_memory SET usage_count = usage_count + 1 WHERE id IN (${ids.join(',')})`).run();
        }

        return relevantResults;
    }

    /** Remember a fact from a conversation */
    remember(fact, source = 'widget') {
        return this.add({ type: 'fact', category: 'general', content: fact, source });
    }

    /** Learn from a correction */
    learnCorrection(original, corrected) {
        return this.add({
            type: 'correction',
            category: 'corrections',
            question: original,
            content: corrected,
            source: 'correction',
            confidence: 1.5
        });
    }

    /** Learn a Q&A pair */
    learnQA(question, answer, source = 'ticket') {
        // Deduplicate
        const existing = this.db.prepare(
            'SELECT id FROM funai_memory WHERE type = ? AND question = ? AND content = ?'
        ).get('qa', question, answer);
        if (existing) return existing.id;

        return this.add({ type: 'qa', category: 'tickets', question, content: answer, source });
    }

    // ── Conversation History ────────────────────────────────

    /** Save a conversation message */
    saveConversation(userId, role, content, actions = null, contextPage = '') {
        this.db.prepare(`
            INSERT INTO funai_conversations (user_id, role, content, actions, context_page, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId, role, content, actions ? JSON.stringify(actions) : null, contextPage, Date.now());
    }

    /** Get conversation history */
    getConversations(userId = null, limit = 50) {
        if (userId) {
            const rows = this.db.prepare(
                'SELECT * FROM funai_conversations WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
            ).all(userId, limit);
            return rows.reverse();
        }
        return this.db.prepare(
            'SELECT * FROM funai_conversations ORDER BY created_at DESC LIMIT ?'
        ).all(limit);
    }

    /** Clear conversation history */
    clearConversations(userId = null) {
        if (userId) {
            this.db.prepare('DELETE FROM funai_conversations WHERE user_id = ?').run(userId);
        } else {
            this.db.prepare('DELETE FROM funai_conversations').run();
        }
    }

    // ── Actions Log ─────────────────────────────────────────

    /** Log an action */
    logAction(actionType, params = null, result = null, source = 'widget') {
        this.db.prepare(`
            INSERT INTO funai_actions_log (action_type, params, result, source, created_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            actionType,
            params ? JSON.stringify(params) : null,
            result ? JSON.stringify(result) : null,
            source,
            Date.now()
        );
    }

    /** Get recent actions */
    getRecentActions(limit = 50) {
        return this.db.prepare(
            'SELECT * FROM funai_actions_log ORDER BY created_at DESC LIMIT ?'
        ).all(limit);
    }

    // ── Statistics ───────────────────────────────────────────

    /** Track a request */
    trackRequest(level = 'l2', tokensUsed = 0) {
        const today = new Date().toISOString().slice(0, 10);
        const existing = this.db.prepare('SELECT * FROM funai_stats WHERE date = ?').get(today);
        if (existing) {
            const field = level === 'l0' ? 'l0_hits' : level === 'l1' ? 'l1_hits' : 'l2_hits';
            this.db.prepare(`
                UPDATE funai_stats SET total_requests = total_requests + 1, ${field} = ${field} + 1, 
                tokens_used = tokens_used + ? WHERE date = ?
            `).run(tokensUsed, today);
        } else {
            const l0 = level === 'l0' ? 1 : 0;
            const l1 = level === 'l1' ? 1 : 0;
            const l2 = level === 'l2' ? 1 : 0;
            this.db.prepare(`
                INSERT INTO funai_stats (date, total_requests, l0_hits, l1_hits, l2_hits, tokens_used)
                VALUES (?, 1, ?, ?, ?, ?)
            `).run(today, l0, l1, l2, tokensUsed);
        }
    }

    /** Track a correction */
    trackCorrection() {
        const today = new Date().toISOString().slice(0, 10);
        this.db.prepare(`
            UPDATE funai_stats SET corrections = corrections + 1 WHERE date = ?
        `).run(today);
    }

    /** Get statistics */
    getStats(days = 30) {
        const stats = this.db.prepare(`
            SELECT * FROM funai_stats ORDER BY date DESC LIMIT ?
        `).all(days);

        const memoryCount = this.db.prepare('SELECT COUNT(*) as cnt FROM funai_memory').get()?.cnt || 0;
        const conversationCount = this.db.prepare('SELECT COUNT(*) as cnt FROM funai_conversations').get()?.cnt || 0;

        const today = stats[0] || { total_requests: 0, l0_hits: 0, l1_hits: 0, l2_hits: 0, corrections: 0, tokens_used: 0 };

        return {
            today: {
                totalRequests: today.total_requests || 0,
                l0Hits: today.l0_hits || 0,
                l1Hits: today.l1_hits || 0,
                l2Hits: today.l2_hits || 0,
                corrections: today.corrections || 0,
                tokensUsed: today.tokens_used || 0,
                accuracy: today.total_requests > 0 
                    ? Math.round(((today.total_requests - today.corrections) / today.total_requests) * 100) 
                    : 100,
            },
            totals: {
                memoryEntries: memoryCount,
                conversations: conversationCount,
            },
            history: stats.map(s => ({
                date: s.date,
                totalRequests: s.total_requests,
                l0Hits: s.l0_hits,
                l1Hits: s.l1_hits,
                l2Hits: s.l2_hits,
                corrections: s.corrections,
                tokensUsed: s.tokens_used,
            })),
        };
    }

    /** Get memory statistics by type and category */
    getMemoryStats() {
        const byType = this.db.prepare(
            'SELECT type, COUNT(*) as cnt FROM funai_memory GROUP BY type'
        ).all();
        const byCategory = this.db.prepare(
            'SELECT category, COUNT(*) as cnt FROM funai_memory GROUP BY category'
        ).all();
        const bySource = this.db.prepare(
            'SELECT source, COUNT(*) as cnt FROM funai_memory GROUP BY source'
        ).all();
        const total = this.db.prepare('SELECT COUNT(*) as cnt FROM funai_memory').get()?.cnt || 0;

        return {
            total,
            byType: Object.fromEntries(byType.map(r => [r.type, r.cnt])),
            byCategory: Object.fromEntries(byCategory.map(r => [r.category || 'uncategorized', r.cnt])),
            bySource: Object.fromEntries(bySource.map(r => [r.source || 'unknown', r.cnt])),
        };
    }
}

module.exports = FunAIMemory;
