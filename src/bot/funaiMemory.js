// ═══════════════════════════════════════════════════════════════
//  FunAI Memory Manager — SQLite-based persistent memory
//  With Semantic Search (Embeddings) + Confidence Decay
// ═══════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { cosineSimilarity, vectorToBlob, blobToVector } = require('./embeddingProvider');

const LOG = '[FunAI Memory]';

class FunAIMemory {
    constructor(db, dataDir) {
        this.db = db;
        this.dataDir = dataDir || '';
        /** @type {import('./embeddingProvider').EmbeddingProvider|null} */
        this._embedder = null;
        this._embedQueue = [];     // async embed queue
        this._embedRunning = false;
        this._initTables();
        this._migrateFromJson();
    }

    /**
     * Attach an EmbeddingProvider instance.
     * Call this after constructing FunAIMemory once the provider is ready.
     * @param {import('./embeddingProvider').EmbeddingProvider} provider
     */
    setEmbeddingProvider(provider) {
        this._embedder = provider;
        console.log(`${LOG} ✅ Embedding provider attached (dimension: ${provider.dimension})`);
        // Backfill embeddings for entries that don't have one yet
        this._backfillEmbeddings();
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

        // ── Embeddings table for semantic search ─────────────
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS funai_embeddings (
                memory_id INTEGER PRIMARY KEY,
                embedding BLOB NOT NULL,
                model TEXT DEFAULT 'unknown',
                dimension INTEGER DEFAULT 768,
                created_at INTEGER NOT NULL
            );
        `);

        // ── User profiles for personalization ────────────────
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS funai_user_profiles (
                user_id TEXT PRIMARY KEY,
                username TEXT,
                summary TEXT DEFAULT '',
                preferences TEXT DEFAULT '{}',
                facts TEXT DEFAULT '[]',
                last_interaction INTEGER,
                interaction_count INTEGER DEFAULT 0,
                updated_at INTEGER
            );
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS funai_conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                actions TEXT,
                context_page TEXT,
                session_id TEXT DEFAULT 'default',
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_funai_conv_user ON funai_conversations(user_id);
        `);

        try {
            this.db.exec("ALTER TABLE funai_conversations ADD COLUMN session_id TEXT DEFAULT 'default'");
        } catch (e) {
            // column already exists
        }

        // Add summary column for conversation summarization
        try {
            this.db.exec("ALTER TABLE funai_conversations ADD COLUMN summary TEXT DEFAULT ''");
        } catch (e) {
            // column already exists
        }

        // Now safely create index because we are sure session_id exists
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_funai_conv_session ON funai_conversations(session_id)");

        // ── Question frequency tracking for pattern detection ─
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS funai_question_freq (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                question_hash TEXT NOT NULL,
                question_text TEXT NOT NULL,
                count INTEGER DEFAULT 1,
                first_seen INTEGER NOT NULL,
                last_seen INTEGER NOT NULL,
                faq_suggested INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_funai_qf_hash ON funai_question_freq(question_hash);
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

        console.log(`${LOG} ✅ SQLite tables initialized (with embeddings, profiles, freq tracking).`);
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

    /** Add a memory entry — auto-generates embedding asynchronously */
    add({ type = 'fact', category = '', question = null, content, source = 'admin', confidence = 1.0, expiresAt = null }) {
        if (!content) return null;
        const now = Date.now();
        const result = this.db.prepare(`
            INSERT INTO funai_memory (type, category, question, content, source, confidence, created_at, updated_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(type, category, question, content, source, confidence, now, now, expiresAt);

        const id = result.lastInsertRowid;

        // Queue async embedding generation
        const textForEmbed = question ? `${question} ${content}` : content;
        this._queueEmbed(Number(id), textForEmbed);

        return id;
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

    /** Full-text search in memory (keyword LIKE) */
    _keywordSearch(query, limit = 10) {
        if (!query) return [];

        // Russian stop words
        const stopWords = new Set(['я', 'ты', 'он', 'она', 'оно', 'мы', 'вы', 'они', 'что', 'кто', 'как', 'какие', 'какая', 'какой', 'где', 'когда', 'зачем', 'почему', 'для', 'на', 'в', 'с', 'к', 'от', 'до', 'из', 'у', 'о', 'об', 'и', 'а', 'но', 'да', 'нет', 'это', 'тот', 'эта', 'те', 'то']);

        const rawTokens = String(query).toLowerCase().replace(/[^\w\sа-яё]/gi, '').split(/\s+/);
        const tokens = [...new Set(rawTokens)].filter(t => t.length > 2 && !stopWords.has(t));

        if (tokens.length === 0) return [];

        const conditions = tokens.map(() => '(LOWER(content) LIKE ? OR LOWER(question) LIKE ?)');
        const matchCalculations = tokens.map(() => `(CASE WHEN LOWER(content) LIKE ? OR LOWER(question) LIKE ? THEN 1 ELSE 0 END)`);

        const params = [];
        for (const token of tokens) {
            params.push(`%${token}%`, `%${token}%`);
        }

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

        return this.db.prepare(sql).all(...params, Date.now(), ...matchParams, limit);
    }

    /** Semantic search using embeddings (cosine similarity) */
    async semanticSearch(query, limit = 10, minScore = 0.35) {
        if (!query || !this._embedder) return [];

        try {
            // Get query embedding
            const { vector: queryVec } = await this._embedder.embed(query);
            if (!queryVec || queryVec.length === 0) return [];

            // Load all embeddings from DB
            const rows = this.db.prepare(`
                SELECT e.memory_id, e.embedding, m.*
                FROM funai_embeddings e
                JOIN funai_memory m ON m.id = e.memory_id
                WHERE m.expires_at IS NULL OR m.expires_at > ?
            `).all(Date.now());

            if (rows.length === 0) return [];

            // Score each by cosine similarity
            const scored = [];
            for (const row of rows) {
                const vec = blobToVector(row.embedding);
                if (!vec) continue;
                const similarity = cosineSimilarity(queryVec, vec);
                if (similarity >= minScore) {
                    scored.push({ ...row, semantic_score: similarity, embedding: undefined });
                }
            }

            scored.sort((a, b) => b.semantic_score - a.semantic_score);
            return scored.slice(0, limit);
        } catch (e) {
            console.error(`${LOG} ❌ Semantic search error: ${e.message}`);
            return [];
        }
    }

    /**
     * Hybrid search — combines keyword (LIKE) + semantic (embeddings).
     * Uses Reciprocal Rank Fusion (RRF) to merge both result lists.
     * Falls back to keyword-only if embeddings aren't available.
     */
    async search(query, limit = 10) {
        if (!query) return [];

        // Get keyword results (always available)
        const keywordResults = this._keywordSearch(query, limit * 2);

        // Try semantic search if embedder is attached
        let semanticResults = [];
        if (this._embedder) {
            try {
                semanticResults = await this.semanticSearch(query, limit * 2, 0.30);
            } catch (e) {
                console.error(`${LOG} ⚠️ Semantic search fallback to keyword-only: ${e.message}`);
            }
        }

        // If no semantic results — return keyword results as before
        if (semanticResults.length === 0) {
            if (keywordResults.length > 0) {
                const ids = keywordResults.map(r => r.id);
                this.db.prepare(`UPDATE funai_memory SET usage_count = usage_count + 1 WHERE id IN (${ids.join(',')})`).run();
            }
            return keywordResults.slice(0, limit);
        }

        // ── Reciprocal Rank Fusion (RRF) ──
        const k = 60; // RRF constant
        const fusedScores = new Map(); // id -> { score, entry }
        const alpha = 0.4; // keyword weight (semantic gets 0.6)

        for (let i = 0; i < keywordResults.length; i++) {
            const entry = keywordResults[i];
            const rrfScore = alpha / (k + i + 1);
            fusedScores.set(entry.id, {
                score: rrfScore,
                entry,
                keywordRank: i + 1,
                semanticRank: null,
                semanticScore: 0,
            });
        }

        for (let i = 0; i < semanticResults.length; i++) {
            const entry = semanticResults[i];
            const rrfScore = (1 - alpha) / (k + i + 1);
            if (fusedScores.has(entry.id)) {
                const existing = fusedScores.get(entry.id);
                existing.score += rrfScore;
                existing.semanticRank = i + 1;
                existing.semanticScore = entry.semantic_score || 0;
            } else {
                fusedScores.set(entry.id, {
                    score: rrfScore,
                    entry,
                    keywordRank: null,
                    semanticRank: i + 1,
                    semanticScore: entry.semantic_score || 0,
                });
            }
        }

        // Sort by fused score
        const fused = [...fusedScores.values()]
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        // Update usage counts
        const resultIds = fused.map(f => f.entry.id);
        if (resultIds.length > 0) {
            this.db.prepare(`UPDATE funai_memory SET usage_count = usage_count + 1 WHERE id IN (${resultIds.join(',')})`).run();
        }

        // Return entries with fused metadata
        return fused.map(f => ({
            ...f.entry,
            _fusedScore: f.score,
            _keywordRank: f.keywordRank,
            _semanticRank: f.semanticRank,
            _semanticScore: f.semanticScore,
        }));
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
    saveConversation(userId, role, content, actions = null, contextPage = '', sessionId = 'default') {
        this.db.prepare(`
            INSERT INTO funai_conversations (user_id, role, content, actions, context_page, session_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(userId, role, content, actions ? JSON.stringify(actions) : null, contextPage, sessionId, Date.now());
    }

    /** Get conversation history */
    getConversations(userId = null, limit = 50, sessionId = 'default') {
        if (userId) {
            const rows = this.db.prepare(
                'SELECT * FROM funai_conversations WHERE user_id = ? AND session_id = ? ORDER BY created_at DESC LIMIT ?'
            ).all(userId, sessionId, limit);
            return rows.reverse();
        }
        return this.db.prepare(
            'SELECT * FROM funai_conversations WHERE session_id = ? ORDER BY created_at DESC LIMIT ?'
        ).all(sessionId, limit);
    }

    /** Clear conversation history */
    clearConversations(userId = null, sessionId = null) {
        if (userId && sessionId) {
            this.db.prepare('DELETE FROM funai_conversations WHERE user_id = ? AND session_id = ?').run(userId, sessionId);
        } else if (userId) {
            this.db.prepare('DELETE FROM funai_conversations WHERE user_id = ?').run(userId);
        } else {
            this.db.prepare('DELETE FROM funai_conversations').run();
        }
    }

    /** Get user chat sessions */
    getChatSessions(userId) {
        // Find distinct sessions with their latest message
        const sessions = this.db.prepare(`
            SELECT session_id as id, 
                   MAX(created_at) as updated_at,
                   (SELECT content FROM funai_conversations f2 
                    WHERE f2.session_id = f1.session_id AND f2.user_id = ? AND f2.role = 'user' 
                    ORDER BY created_at ASC LIMIT 1) as title
            FROM funai_conversations f1
            WHERE user_id = ?
            GROUP BY session_id
            ORDER BY updated_at DESC
            LIMIT 30
        `).all(userId, userId);

        return sessions.map(s => {
            let title = s.title || 'Новый чат';
            // Trim title
            if (title.length > 40) title = title.substring(0, 40) + '...';
            return {
                id: s.id,
                title,
                updatedAt: s.updated_at
            };
        });
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
        const embeddingsCount = this.db.prepare('SELECT COUNT(*) as cnt FROM funai_embeddings').get()?.cnt || 0;
        const profilesCount = this.db.prepare('SELECT COUNT(*) as cnt FROM funai_user_profiles').get()?.cnt || 0;

        return {
            total,
            embeddingsCount,
            profilesCount,
            byType: Object.fromEntries(byType.map(r => [r.type, r.cnt])),
            byCategory: Object.fromEntries(byCategory.map(r => [r.category || 'uncategorized', r.cnt])),
            bySource: Object.fromEntries(bySource.map(r => [r.source || 'unknown', r.cnt])),
        };
    }

    // ═══ Embedding Queue (async, non-blocking) ═══════════════

    /** Queue an embedding generation — runs async in background */
    _queueEmbed(memoryId, text) {
        if (!this._embedder) return;
        this._embedQueue.push({ memoryId, text });
        this._processEmbedQueue();
    }

    async _processEmbedQueue() {
        if (this._embedRunning || this._embedQueue.length === 0) return;
        this._embedRunning = true;

        try {
            while (this._embedQueue.length > 0) {
                const batch = this._embedQueue.splice(0, 10); // process up to 10 at a time
                const texts = batch.map(b => b.text);

                try {
                    const results = await this._embedder.embedBatch(texts);
                    const now = Date.now();
                    const stmt = this.db.prepare(`
                        INSERT OR REPLACE INTO funai_embeddings (memory_id, embedding, model, dimension, created_at)
                        VALUES (?, ?, ?, ?, ?)
                    `);

                    for (let i = 0; i < batch.length; i++) {
                        const blob = vectorToBlob(results[i].vector);
                        if (blob) {
                            stmt.run(batch[i].memoryId, blob, results[i].model, results[i].dimension, now);
                        }
                    }
                    console.log(`${LOG} 🧬 Embedded ${batch.length} entries (model: ${results[0]?.model || 'unknown'})`);
                } catch (e) {
                    console.error(`${LOG} ⚠️ Embed batch error: ${e.message}`);
                }

                // Gentle delay between batches
                if (this._embedQueue.length > 0) {
                    await new Promise(r => setTimeout(r, 100));
                }
            }
        } finally {
            this._embedRunning = false;
        }
    }

    /** Backfill embeddings for memory entries that don't have one */
    async _backfillEmbeddings() {
        if (!this._embedder) return;

        const missing = this.db.prepare(`
            SELECT m.id, m.question, m.content 
            FROM funai_memory m
            LEFT JOIN funai_embeddings e ON e.memory_id = m.id
            WHERE e.memory_id IS NULL
            ORDER BY m.created_at DESC
            LIMIT 500
        `).all();

        if (missing.length === 0) {
            console.log(`${LOG} ✅ All memory entries have embeddings.`);
            return;
        }

        console.log(`${LOG} 🔄 Backfilling ${missing.length} missing embeddings...`);

        for (const entry of missing) {
            const text = entry.question ? `${entry.question} ${entry.content}` : entry.content;
            this._queueEmbed(entry.id, text);
        }
    }

    // ═══ Confidence Decay System ═════════════════════════════

    /**
     * Run daily confidence decay.
     * - Unused entries (30+ days): confidence -= 0.1
     * - Archive entries with confidence < 0.3
     * Call this once on bot startup.
     */
    decayUnusedMemories() {
        const now = Date.now();
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

        // Decay unused entries
        const decayed = this.db.prepare(`
            UPDATE funai_memory 
            SET confidence = MAX(0.1, confidence - 0.1),
                updated_at = ?
            WHERE updated_at < ? 
              AND usage_count = 0
              AND source != 'admin'
              AND confidence > 0.3
        `).run(now, thirtyDaysAgo);

        // Archive very low confidence entries
        const archived = this.db.prepare(`
            UPDATE funai_memory 
            SET category = 'archived',
                updated_at = ?
            WHERE confidence < 0.3 
              AND category != 'archived'
              AND source != 'admin'
        `).run(now);

        if (decayed.changes > 0 || archived.changes > 0) {
            console.log(`${LOG} 🔄 Decay: ${decayed.changes} entries decayed, ${archived.changes} archived`);
        }
    }

    /** Boost confidence after successful usage (user didn't correct) */
    boostConfidence(id, amount = 0.05) {
        this.db.prepare(`
            UPDATE funai_memory 
            SET confidence = MIN(2.0, confidence + ?),
                updated_at = ?
            WHERE id = ?
        `).run(amount, Date.now(), id);
    }

    // ═══ User Profiles ══════════════════════════════════════

    /** Get or create a user profile */
    getUserProfile(userId) {
        if (!userId) return null;
        let profile = this.db.prepare('SELECT * FROM funai_user_profiles WHERE user_id = ?').get(String(userId));
        if (!profile) {
            const now = Date.now();
            this.db.prepare(`
                INSERT INTO funai_user_profiles (user_id, last_interaction, updated_at)
                VALUES (?, ?, ?)
            `).run(String(userId), now, now);
            profile = this.db.prepare('SELECT * FROM funai_user_profiles WHERE user_id = ?').get(String(userId));
        }
        return profile;
    }

    /** Update user profile after an interaction */
    touchUserProfile(userId, username = null) {
        if (!userId) return;
        const now = Date.now();
        const existing = this.db.prepare('SELECT * FROM funai_user_profiles WHERE user_id = ?').get(String(userId));
        if (existing) {
            this.db.prepare(`
                UPDATE funai_user_profiles 
                SET interaction_count = interaction_count + 1,
                    last_interaction = ?,
                    username = COALESCE(?, username),
                    updated_at = ?
                WHERE user_id = ?
            `).run(now, username, now, String(userId));
        } else {
            this.db.prepare(`
                INSERT INTO funai_user_profiles (user_id, username, last_interaction, interaction_count, updated_at)
                VALUES (?, ?, ?, 1, ?)
            `).run(String(userId), username, now, now);
        }
    }

    /** Update user profile summary */
    updateUserSummary(userId, summary) {
        this.db.prepare(`
            UPDATE funai_user_profiles SET summary = ?, updated_at = ? WHERE user_id = ?
        `).run(summary, Date.now(), String(userId));
    }

    /** Add a fact to a user profile */
    addUserFact(userId, fact) {
        const profile = this.getUserProfile(userId);
        if (!profile) return;
        try {
            const facts = JSON.parse(profile.facts || '[]');
            if (!facts.includes(fact)) {
                facts.push(fact);
                if (facts.length > 20) facts.shift(); // keep max 20 facts
                this.db.prepare('UPDATE funai_user_profiles SET facts = ?, updated_at = ? WHERE user_id = ?')
                    .run(JSON.stringify(facts), Date.now(), String(userId));
            }
        } catch { /* ignore parse errors */ }
    }

    // ═══ Question Frequency Tracking ════════════════════════

    /** Track a question for pattern detection */
    trackQuestionFrequency(question) {
        if (!question || question.length < 5) return;
        const hash = _simpleHash(question.toLowerCase().trim());
        const now = Date.now();

        const existing = this.db.prepare('SELECT * FROM funai_question_freq WHERE question_hash = ?').get(hash);
        if (existing) {
            this.db.prepare(`
                UPDATE funai_question_freq SET count = count + 1, last_seen = ? WHERE id = ?
            `).run(now, existing.id);
        } else {
            this.db.prepare(`
                INSERT INTO funai_question_freq (question_hash, question_text, first_seen, last_seen)
                VALUES (?, ?, ?, ?)
            `).run(hash, question.trim().slice(0, 200), now, now);
        }
    }

    /** Get frequently asked questions (asked 3+ times in last 24h) */
    getRepeatingQuestions(minCount = 3, hoursWindow = 24) {
        const since = Date.now() - (hoursWindow * 60 * 60 * 1000);
        return this.db.prepare(`
            SELECT * FROM funai_question_freq 
            WHERE count >= ? AND last_seen > ? AND faq_suggested = 0
            ORDER BY count DESC
            LIMIT 10
        `).all(minCount, since);
    }

    /** Mark a repeating question as "FAQ suggested" */
    markFaqSuggested(id) {
        this.db.prepare('UPDATE funai_question_freq SET faq_suggested = 1 WHERE id = ?').run(id);
    }
}

function _simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return String(hash >>> 0);
}

module.exports = FunAIMemory;
