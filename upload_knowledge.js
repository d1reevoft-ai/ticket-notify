// Этот скрипт выкачивает спарсенные данные из локальной БД
// и заливает их на REMOVED_PLATFORM_REFERENCE через API-эндпоинт /api/funai/memory/import
//
// Использование: node upload_knowledge.js
//
// Перед запуском убедись что:
// 1. Бот запущен на REMOVED_PLATFORM_REFERENCE с новым кодом (git push)
// 2. У тебя есть JWT-токен (логинишься в дашборд)

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// ── Конфигурация ──
const REMOVED_PLATFORM_REFERENCE = REMOVED_PLATFORM_REFERENCE || 'https://REMOVED_PLATFORM_REFERENCE';
const DASHBOARD_LOGIN = process.env.DASH_USER || 'admin';
const DASHBOARD_PASS = process.env.DASH_PASS || 'REMOVED_SECRET';

async function main() {
    // 1. Читаем спарсенные данные из локальной базы
    const dbPath = path.join(__dirname, 'data', 'tickets_1.db');
    if (!fs.existsSync(dbPath)) {
        console.error('❌ Локальная БД не найдена:', dbPath);
        process.exit(1);
    }
    const db = new Database(dbPath);
    const entries = db.prepare('SELECT type, category, question, content, source, confidence FROM funai_memory WHERE category = \'parsed_discord\'').all();

    if (entries.length === 0) {
        console.log('⚠️ Нет спарсенных данных для загрузки. Сначала запусти scrape_discord.js');
        process.exit(0);
    }
    console.log(`📦 Найдено ${entries.length} записей для загрузки на REMOVED_PLATFORM_REFERENCE`);

    // 2. Логинимся в дашборд, получаем JWT-токен
    console.log(`🔐 Логинимся в ${REMOVED_PLATFORM_REFERENCE}...`);
    const loginRes = await fetch(`${REMOVED_PLATFORM_REFERENCE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: DASHBOARD_LOGIN, password: DASHBOARD_PASS })
    });

    if (!loginRes.ok) {
        console.error('❌ Не удалось залогиниться! Проверь логин/пароль.');
        console.error('Статус:', loginRes.status, await loginRes.text());
        process.exit(1);
    }

    const { token } = await loginRes.json();
    console.log('✅ Авторизация успешна!');

    // 3. Загружаем данные батчами по 50 штук (чтобы не перегружать сервер)
    const BATCH_SIZE = 50;
    let totalImported = 0;
    let totalSkipped = 0;

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, i + BATCH_SIZE);
        console.log(`⏳ Загружаю батч ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(entries.length / BATCH_SIZE)} (${batch.length} записей)...`);

        const importRes = await fetch(`${REMOVED_PLATFORM_REFERENCE}/api/funai/memory/import`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ entries: batch })
        });

        if (!importRes.ok) {
            console.error(`❌ Ошибка загрузки батча: ${importRes.status}`);
            console.error(await importRes.text());
            continue;
        }

        const result = await importRes.json();
        totalImported += result.imported;
        totalSkipped += result.skipped;
        console.log(`   ✅ Импортировано: ${result.imported}, пропущено (дубли): ${result.skipped}`);

        // Маленькая пауза между батчами
        await new Promise(r => setTimeout(r, 500));
    }

    console.log('═══════════════════════════════════════════════════');
    console.log(`🎉 Загрузка завершена!`);
    console.log(`🧠 Импортировано на REMOVED_PLATFORM_REFERENCE: ${totalImported}`);
    console.log(`⏭️  Пропущено дублей: ${totalSkipped}`);
    console.log('💡 Бот на REMOVED_PLATFORM_REFERENCE автоматически создаст векторы для новых записей.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
