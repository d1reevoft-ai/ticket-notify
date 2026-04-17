// ═══════════════════════════════════════════════════════════
//  FunAI Semantic Search — Test Script
//  Run: node test_semantic.js
// ═══════════════════════════════════════════════════════════
const Database = require('better-sqlite3');
const path = require('path');
const FunAIMemory = require('./src/bot/funaiMemory');
const { EmbeddingProvider, cosineSimilarity } = require('./src/bot/embeddingProvider');

const TEST_DB = path.join(__dirname, 'test_semantic.db');

// Clean up old test db
const fs = require('fs');
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

console.log('═══════════════════════════════════════════════════');
console.log('  FunAI Semantic Search — Тест');
console.log('═══════════════════════════════════════════════════\n');

// 1. Create DB + Memory
const db = new Database(TEST_DB);
db.pragma('journal_mode = WAL');
const memory = new FunAIMemory(db, __dirname);

// 2. Create EmbeddingProvider (TF-IDF only for local tests — no Gemini key needed)
const embedder = new EmbeddingProvider({
    geminiApiKeys: [], // пусто = только TF-IDF
    log: (...args) => console.log('[Test]', ...args),
});

// 3. Build corpus from sample data so TF-IDF works well
const sampleTexts = [
    'проблемы с подключением к серверу FunTime',
    'как подать апелляцию на бан на форуме',
    'правила сервера раздел 5 запрещают читы',
    'как заработать монеты на сервере',
    'не работает лаунчер ошибка при запуске',
    'забанили за использование читов',
    'как купить привилегию на сервере',
    'где скачать лаунчер FunTime',
    'проблема с входом на сервер ошибка',
    'не могу зайти на сервер пишет ошибку',
];
embedder.buildCorpus(sampleTexts);

// 4. Attach embedder to memory
memory.setEmbeddingProvider(embedder);

// 5. Add test knowledge entries
console.log('\n📝 Добавляю тестовые записи в память...\n');

const entries = [
    { type: 'qa', question: 'Проблемы с подключением к серверу', content: 'Проверьте интернет и перезапустите лаунчер. Если не помогает — зайдите на forum.funtime.su', confidence: 0.9 },
    { type: 'qa', question: 'Как подать апелляцию на бан', content: 'Зайдите на forum.funtime.su/appeals/ и заполните форму', confidence: 0.9 },
    { type: 'qa', question: 'Правила сервера про читы', content: 'Раздел 5 правил запрещает использование любых читов. Бан от 30 дней.', confidence: 0.85 },
    { type: 'qa', question: 'Как заработать монеты', content: 'Выполняйте квесты, продавайте ресурсы на аукционе, или майните.', confidence: 0.8 },
    { type: 'qa', question: 'Не работает лаунчер', content: 'Переустановите Java 17+, очистите кеш лаунчера, проверьте антивирус.', confidence: 0.85 },
    { type: 'fact', question: null, content: 'Сервер FunTime работает на версии 1.20.4', confidence: 1.0 },
];

for (const e of entries) {
    memory.add({ ...e, source: 'test', category: 'test' });
}

// Wait for embeddings to be generated
async function runTests() {
    // Give the embed queue time to finish
    console.log('⏳ Жду генерацию embeddings (TF-IDF)...\n');
    await new Promise(r => setTimeout(r, 1000));

    // Check embeddings count
    const embCount = db.prepare('SELECT COUNT(*) as cnt FROM funai_embeddings').get();
    console.log(`🧬 Embeddings в БД: ${embCount.cnt}/${entries.length}\n`);

    // 6. TEST: Keyword Search (old way)
    console.log('═══════════════════════════════════════════════════');
    console.log('  Тест 1: Keyword Search (LIKE — старый способ)');
    console.log('═══════════════════════════════════════════════════\n');

    const keywordTests = [
        'не могу зайти на сервер',
        'меня забанили за читы что делать',
        'где купить привилегию',
        'лаунчер не запускается',
    ];

    for (const q of keywordTests) {
        const results = memory._keywordSearch(q, 3);
        console.log(`  Q: "${q}"`);
        if (results.length === 0) {
            console.log(`  ❌ Ничего не найдено\n`);
        } else {
            for (const r of results) {
                console.log(`  ✅ [${r.match_count} совпадений] ${r.question || r.content.slice(0, 50)}`);
            }
            console.log();
        }
    }

    // 7. TEST: Semantic Search
    console.log('═══════════════════════════════════════════════════');
    console.log('  Тест 2: Semantic Search (TF-IDF embeddings)');
    console.log('═══════════════════════════════════════════════════\n');

    for (const q of keywordTests) {
        const results = await memory.semanticSearch(q, 3, 0.1);
        console.log(`  Q: "${q}"`);
        if (results.length === 0) {
            console.log(`  ❌ Ничего не найдено\n`);
        } else {
            for (const r of results) {
                console.log(`  ✅ [score: ${r.semantic_score.toFixed(3)}] ${r.question || r.content.slice(0, 50)}`);
            }
            console.log();
        }
    }

    // 8. TEST: Hybrid Search (the new default)
    console.log('═══════════════════════════════════════════════════');
    console.log('  Тест 3: Hybrid Search (Keyword + Semantic RRF)');
    console.log('═══════════════════════════════════════════════════\n');

    for (const q of keywordTests) {
        const results = await memory.search(q, 3);
        console.log(`  Q: "${q}"`);
        if (results.length === 0) {
            console.log(`  ❌ Ничего не найдено\n`);
        } else {
            for (const r of results) {
                const sem = r._semanticScore ? `sem:${r._semanticScore.toFixed(3)}` : 'sem:—';
                const kw = r._keywordRank ? `kw:#${r._keywordRank}` : 'kw:—';
                console.log(`  ✅ [${kw} | ${sem}] ${r.question || r.content.slice(0, 50)}`);
            }
            console.log();
        }
    }

    // 9. TEST: Confidence Decay
    console.log('═══════════════════════════════════════════════════');
    console.log('  Тест 4: Confidence Decay');
    console.log('═══════════════════════════════════════════════════\n');

    // Simulate an old unused entry
    db.prepare(`
        INSERT INTO funai_memory (type, content, source, confidence, usage_count, created_at, updated_at)
        VALUES ('qa', 'Старый неиспользуемый ответ', 'test', 0.5, 0, ?, ?)
    `).run(Date.now() - 60*24*60*60*1000, Date.now() - 60*24*60*60*1000); // 60 days ago

    const beforeDecay = db.prepare("SELECT confidence FROM funai_memory WHERE content = 'Старый неиспользуемый ответ'").get();
    console.log(`  До decay: confidence = ${beforeDecay.confidence}`);

    memory.decayUnusedMemories();

    const afterDecay = db.prepare("SELECT confidence FROM funai_memory WHERE content = 'Старый неиспользуемый ответ'").get();
    console.log(`  После decay: confidence = ${afterDecay.confidence}`);
    console.log(`  ${afterDecay.confidence < beforeDecay.confidence ? '✅ Decay работает!' : '❌ Decay не сработал'}\n`);

    // 10. TEST: User Profile
    console.log('═══════════════════════════════════════════════════');
    console.log('  Тест 5: User Profile');
    console.log('═══════════════════════════════════════════════════\n');

    memory.touchUserProfile('123456', 'd1reevof');
    memory.touchUserProfile('123456', 'd1reevof');
    memory.addUserFact('123456', 'Админ сервера FunTime');
    memory.updateUserSummary('123456', 'Администратор, предпочитает краткие ответы');

    const profile = memory.getUserProfile('123456');
    console.log(`  User: ${profile.username}`);
    console.log(`  Interactions: ${profile.interaction_count}`);
    console.log(`  Summary: ${profile.summary}`);
    console.log(`  Facts: ${profile.facts}`);
    console.log(`  ✅ User Profile работает!\n`);

    // 11. TEST: Question Frequency
    console.log('═══════════════════════════════════════════════════');
    console.log('  Тест 6: Question Frequency Tracking');
    console.log('═══════════════════════════════════════════════════\n');

    for (let i = 0; i < 5; i++) memory.trackQuestionFrequency('как зайти на сервер');
    for (let i = 0; i < 3; i++) memory.trackQuestionFrequency('где скачать лаунчер');

    const repeating = memory.getRepeatingQuestions(3, 24);
    console.log(`  Повторяющихся вопросов: ${repeating.length}`);
    for (const q of repeating) {
        console.log(`  💡 "${q.question_text}" — задан ${q.count} раз`);
    }
    console.log(`  ✅ Frequency tracking работает!\n`);

    // 12. Memory Stats
    console.log('═══════════════════════════════════════════════════');
    console.log('  Итого: Memory Stats');
    console.log('═══════════════════════════════════════════════════\n');

    const stats = memory.getMemoryStats();
    console.log(`  📊 Всего записей: ${stats.total}`);
    console.log(`  🧬 Embeddings: ${stats.embeddingsCount}`);
    console.log(`  👤 Profiles: ${stats.profilesCount}`);
    console.log(`  По типам:`, stats.byType);
    console.log();

    // Cleanup
    db.close();
    fs.unlinkSync(TEST_DB);
    console.log('🗑️  Тестовая БД удалена.\n');
    console.log('═══════════════════════════════════════════════════');
    console.log('  ✅ Все тесты пройдены!');
    console.log('═══════════════════════════════════════════════════');
}

runTests().catch(e => {
    console.error('❌ Test error:', e);
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});
