// ═══════════════════════════════════════════════════════════════
//  Embedding Provider — Semantic vectors for FunAI
//  Supports: Gemini Text Embedding API + TF-IDF offline fallback
// ═══════════════════════════════════════════════════════════════
const https = require('https');

const LOG = '[EmbeddingProvider]';

// ── Gemini Embedding defaults ──────────────────────────────
const GEMINI_EMBEDDING_MODEL = 'text-embedding-004';
const GEMINI_EMBEDDING_DIMENSION = 768;
const GEMINI_API_VERSIONS = ['v1beta', 'v1'];

// ── TF-IDF Fallback ────────────────────────────────────────
const TFIDF_DIMENSION = 256; // smaller but workable
const RUSSIAN_STOP_WORDS = new Set([
    'я', 'ты', 'он', 'она', 'оно', 'мы', 'вы', 'они', 'что', 'кто', 'как',
    'где', 'когда', 'зачем', 'почему', 'для', 'на', 'в', 'с', 'к', 'от',
    'до', 'из', 'у', 'о', 'об', 'и', 'а', 'но', 'да', 'нет', 'это', 'тот',
    'эта', 'те', 'то', 'не', 'ни', 'бы', 'же', 'ли', 'вот', 'ещё', 'уже',
    'при', 'по', 'за', 'под', 'над', 'между', 'через', 'без', 'про',
    'the', 'and', 'for', 'with', 'that', 'this', 'you', 'your', 'are', 'not',
    'is', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do',
]);

// ═══════════════════════════════════════════════════════════════
//  Cosine Similarity
// ═══════════════════════════════════════════════════════════════

/**
 * Cosine similarity between two vectors.
 * Returns value between -1 and 1 (1 = identical direction).
 */
function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length || a.length === 0) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

// ═══════════════════════════════════════════════════════════════
//  Embedding Provider Class
// ═══════════════════════════════════════════════════════════════

class EmbeddingProvider {
    /**
     * @param {object} opts
     * @param {string[]} opts.geminiApiKeys — Gemini API keys (will try each)
     * @param {Function} [opts.httpPost]     — Optional custom HTTP POST fn
     * @param {Function} [opts.log]          — Logger function
     */
    constructor(opts = {}) {
        this._geminiKeys = Array.isArray(opts.geminiApiKeys) ? opts.geminiApiKeys.filter(Boolean) : [];
        this._httpPost = opts.httpPost || null;
        this._log = opts.log || ((...args) => console.log(LOG, ...args));

        // TF-IDF corpus state
        this._idfMap = new Map();      // token -> IDF value
        this._corpusSize = 0;
        this._tokenIndex = new Map();  // token -> stable index (0..TFIDF_DIMENSION-1)
        this._nextTokenIdx = 0;

        // Stats
        this._stats = { geminiCalls: 0, geminiErrors: 0, tfidfFallbacks: 0 };
    }

    /** Check if Gemini embedding API is available */
    get hasGemini() {
        return this._geminiKeys.length > 0;
    }

    /** Get dimension of embeddings */
    get dimension() {
        return this.hasGemini ? GEMINI_EMBEDDING_DIMENSION : TFIDF_DIMENSION;
    }

    /** Get usage stats */
    get stats() {
        return { ...this._stats };
    }

    // ═══ Main API ════════════════════════════════════════════

    /**
     * Generate embedding for a single text.
     * Tries Gemini first, falls back to TF-IDF.
     * @param {string} text
     * @returns {Promise<{vector: Float32Array, model: string, dimension: number}>}
     */
    async embed(text) {
        const cleanText = String(text || '').trim();
        if (!cleanText) {
            return { vector: new Float32Array(this.dimension), model: 'empty', dimension: this.dimension };
        }

        // Try Gemini
        if (this.hasGemini) {
            try {
                const vector = await this._geminiEmbed(cleanText);
                if (vector) {
                    return { vector, model: `gemini:${GEMINI_EMBEDDING_MODEL}`, dimension: vector.length };
                }
            } catch (e) {
                this._log(`⚠️ Gemini embedding failed: ${e.message}`);
            }
        }

        // Fallback: TF-IDF
        this._stats.tfidfFallbacks++;
        const vector = this._tfidfEmbed(cleanText);
        return { vector, model: 'tfidf', dimension: vector.length };
    }

    /**
     * Batch-embed multiple texts.
     * @param {string[]} texts
     * @returns {Promise<Array<{vector: Float32Array, model: string, dimension: number}>>}
     */
    async embedBatch(texts) {
        if (!Array.isArray(texts) || texts.length === 0) return [];

        // Try Gemini batch (up to 100 per request)
        if (this.hasGemini) {
            try {
                const vectors = await this._geminiBatchEmbed(texts);
                if (vectors && vectors.length === texts.length) {
                    return vectors.map(v => ({
                        vector: v,
                        model: `gemini:${GEMINI_EMBEDDING_MODEL}`,
                        dimension: v.length,
                    }));
                }
            } catch (e) {
                this._log(`⚠️ Gemini batch embedding failed: ${e.message}`);
            }
        }

        // Fallback: TF-IDF for each
        this._stats.tfidfFallbacks += texts.length;
        return texts.map(text => {
            const vector = this._tfidfEmbed(String(text || '').trim());
            return { vector, model: 'tfidf', dimension: vector.length };
        });
    }

    /**
     * Find top-K most similar items from a set of candidates.
     * @param {Float32Array} queryVector
     * @param {Array<{id: any, vector: Float32Array}>} candidates
     * @param {number} topK
     * @param {number} [minScore=0.3]
     * @returns {Array<{id: any, score: number}>}
     */
    findSimilar(queryVector, candidates, topK = 10, minScore = 0.3) {
        if (!queryVector || !candidates || candidates.length === 0) return [];

        const scored = [];
        for (const candidate of candidates) {
            if (!candidate.vector) continue;
            const score = cosineSimilarity(queryVector, candidate.vector);
            if (score >= minScore) {
                scored.push({ id: candidate.id, score });
            }
        }

        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topK);
    }

    // ═══ Gemini Embedding API ════════════════════════════════

    async _geminiEmbed(text) {
        for (const key of this._geminiKeys) {
            for (const version of GEMINI_API_VERSIONS) {
                try {
                    const url = `https://generativelanguage.googleapis.com/${version}/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${encodeURIComponent(key)}`;
                    const payload = {
                        model: `models/${GEMINI_EMBEDDING_MODEL}`,
                        content: { parts: [{ text }] },
                    };

                    const res = await this._httpPostJson(url, payload);
                    this._stats.geminiCalls++;

                    if (res.ok) {
                        const data = JSON.parse(res.body || '{}');
                        const values = data?.embedding?.values;
                        if (Array.isArray(values) && values.length > 0) {
                            return new Float32Array(values);
                        }
                    }

                    // 404 = wrong API version, try next
                    if (res.status === 404) continue;
                    // 401/403 = bad key, try next key
                    if (res.status === 401 || res.status === 403) break;
                    // 429 = rate limit
                    if (res.status === 429) {
                        this._stats.geminiErrors++;
                        await _sleep(500);
                        continue;
                    }

                    this._stats.geminiErrors++;
                } catch (e) {
                    this._stats.geminiErrors++;
                    this._log(`⚠️ Gemini embed error [${version}]: ${e.message}`);
                }
            }
        }
        return null;
    }

    async _geminiBatchEmbed(texts) {
        const cleanTexts = texts.map(t => String(t || '').trim()).filter(Boolean);
        if (cleanTexts.length === 0) return [];

        for (const key of this._geminiKeys) {
            for (const version of GEMINI_API_VERSIONS) {
                try {
                    const url = `https://generativelanguage.googleapis.com/${version}/models/${GEMINI_EMBEDDING_MODEL}:batchEmbedContents?key=${encodeURIComponent(key)}`;
                    const payload = {
                        requests: cleanTexts.map(text => ({
                            model: `models/${GEMINI_EMBEDDING_MODEL}`,
                            content: { parts: [{ text }] },
                        })),
                    };

                    const res = await this._httpPostJson(url, payload);
                    this._stats.geminiCalls++;

                    if (res.ok) {
                        const data = JSON.parse(res.body || '{}');
                        const embeddings = data?.embeddings;
                        if (Array.isArray(embeddings) && embeddings.length === cleanTexts.length) {
                            return embeddings.map(e => new Float32Array(e.values || []));
                        }
                    }

                    if (res.status === 404) continue;
                    if (res.status === 401 || res.status === 403) break;

                    this._stats.geminiErrors++;
                } catch (e) {
                    this._stats.geminiErrors++;
                }
            }
        }

        // Fallback: one-by-one
        const results = [];
        for (const text of cleanTexts) {
            const v = await this._geminiEmbed(text);
            results.push(v || this._tfidfEmbed(text));
            await _sleep(50); // gentle rate limiting
        }
        return results.length === texts.length ? results : null;
    }

    // ═══ TF-IDF Fallback ═════════════════════════════════════

    /**
     * Build/update IDF from a corpus of texts.
     * Call this when memory changes to keep TF-IDF accurate.
     */
    buildCorpus(texts) {
        const docFreq = new Map();
        const allTokens = new Set();

        for (const text of texts) {
            const tokens = _tokenize(text);
            const unique = new Set(tokens);
            for (const token of unique) {
                docFreq.set(token, (docFreq.get(token) || 0) + 1);
                allTokens.add(token);
            }
        }

        this._corpusSize = texts.length;
        this._idfMap.clear();

        // Sort tokens by frequency (most common first) for stable indexing
        const sorted = [...allTokens].sort((a, b) => (docFreq.get(b) || 0) - (docFreq.get(a) || 0));

        this._tokenIndex.clear();
        this._nextTokenIdx = 0;

        for (const token of sorted) {
            const df = docFreq.get(token) || 1;
            const idf = Math.log((this._corpusSize + 1) / (df + 1)) + 1;
            this._idfMap.set(token, idf);

            if (this._nextTokenIdx < TFIDF_DIMENSION) {
                this._tokenIndex.set(token, this._nextTokenIdx++);
            }
        }

        this._log(`📊 TF-IDF corpus built: ${texts.length} docs, ${allTokens.size} unique tokens, ${this._tokenIndex.size} indexed`);
    }

    _tfidfEmbed(text) {
        const tokens = _tokenize(text);
        if (tokens.length === 0) return new Float32Array(TFIDF_DIMENSION);

        // Count term frequencies
        const tf = new Map();
        for (const token of tokens) {
            tf.set(token, (tf.get(token) || 0) + 1);
        }

        // Build sparse vector
        const vector = new Float32Array(TFIDF_DIMENSION);
        for (const [token, count] of tf) {
            let idx = this._tokenIndex.get(token);
            if (idx === undefined) {
                // New token — assign next available slot or hash
                if (this._nextTokenIdx < TFIDF_DIMENSION) {
                    idx = this._nextTokenIdx++;
                    this._tokenIndex.set(token, idx);
                } else {
                    // Hash collision bucket
                    idx = Math.abs(_simpleHash(token)) % TFIDF_DIMENSION;
                }
            }

            const idf = this._idfMap.get(token) || 1.0;
            const tfNorm = count / tokens.length;
            vector[idx] += tfNorm * idf;
        }

        // L2 normalize
        let norm = 0;
        for (let i = 0; i < vector.length; i++) norm += vector[i] * vector[i];
        norm = Math.sqrt(norm);
        if (norm > 0) {
            for (let i = 0; i < vector.length; i++) vector[i] /= norm;
        }

        return vector;
    }

    // ═══ HTTP Helper ═════════════════════════════════════════

    async _httpPostJson(url, body) {
        if (this._httpPost) {
            return this._httpPost(url, body);
        }

        return new Promise((resolve, reject) => {
            const u = new URL(url);
            const data = JSON.stringify(body);
            const req = https.request({
                hostname: u.hostname,
                path: u.pathname + u.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                },
            }, res => {
                let chunks = '';
                res.on('data', c => chunks += c);
                res.on('end', () => resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    status: res.statusCode,
                    body: chunks,
                }));
            });
            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }
}

// ═══ Utility Functions ═══════════════════════════════════════

function _tokenize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-zа-яё0-9\s]/gi, ' ')
        .split(/\s+/)
        .map(_stemRussian)
        .filter(t => t.length > 1 && !RUSSIAN_STOP_WORDS.has(t));
}

/** Basic Russian stemmer — strips common suffixes for better TF-IDF matching */
function _stemRussian(word) {
    if (!word || word.length < 4) return word;
    // Only stem Cyrillic words
    if (!/[а-яё]/.test(word)) return word;
    // Strip common suffixes (longest first)
    const suffixes = [
        'ами', 'ями', 'ого', 'ему', 'ать', 'ить', 'ять', 'ешь', 'ует', 'ает',
        'ом', 'ам', 'ов', 'ев', 'ей', 'ах', 'ях', 'ую', 'ий', 'ый', 'ой',
        'ая', 'яя', 'ое', 'ее', 'ие', 'ые', 'ём', 'ем', 'им', 'ым',
        'ет', 'ит', 'ут', 'ят', 'ал', 'ил', 'ел', 'ёт',
        'а', 'о', 'у', 'е', 'и', 'ы', 'я', 'ь', 'й',
    ];
    for (const suffix of suffixes) {
        if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
            return word.slice(0, -suffix.length);
        }
    }
    return word;
}

function _simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return hash;
}

function _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ═══ Serialization helpers for SQLite BLOB storage ═════════

/** Float32Array → Buffer for SQLite BLOB */
function vectorToBlob(vector) {
    if (!vector || vector.length === 0) return null;
    const fa = vector instanceof Float32Array ? vector : new Float32Array(vector);
    return Buffer.from(fa.buffer, fa.byteOffset, fa.byteLength);
}

/** SQLite BLOB → Float32Array */
function blobToVector(blob) {
    if (!blob || blob.length === 0) return null;
    const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

module.exports = {
    EmbeddingProvider,
    cosineSimilarity,
    vectorToBlob,
    blobToVector,
};
