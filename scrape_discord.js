const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const FunAIMemory = require('./src/bot/funaiMemory');

async function scrapeDiscordChannel() {
    const channelId = process.argv[2];
    const maxMessages = parseInt(process.argv[3]) || 500; // По умолчанию 500, если не указано

    if (!channelId) {
        console.error('❌ Ошибка: Укажи ID канала!');
        console.error('👉 Использование: node scrape_discord.js <ID_КАНАЛА> [ЛИМИТ_СООБЩЕНИЙ]');
        console.error('Пример: node scrape_discord.js 717734206586880060 2000');
        process.exit(1);
    }

    // 1. Пытаемся взять токен из конфига
    let config;
    try {
        config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    } catch (e) {
        console.error('❌ Не удалось прочитать config.json');
        process.exit(1);
    }
    const token = config.discordToken; // Теперь берем из конфига (который в гитигноре)

    // 2. Инициализируем базу FunAI Memory
    const dbPath = path.join(__dirname, 'data', 'tickets_1.db');
    const db = new Database(dbPath);
    const memory = new FunAIMemory(db);

    // 3. Устанавливаем ID целевого аккаунта, ответы которого нужно превратить в базу знаний
    const targetUserId = "1241794453694316677";
    console.log(`✅ Парсим сообщения ТОЛЬКО от аккаунта с ID: ${targetUserId}`);
    console.log(`🚀 Связь с Дискордом установлена... Начинаем парсинг канала ${channelId}...`);

    let lastMessageId = null;
    let totalScraped = 0;
    let savedFacts = 0;
    let savedQA = 0;
    let hasMore = true;

    while (hasMore) {
        let url = `https://discord.com/api/v9/channels/${channelId}/messages?limit=100`;
        if (lastMessageId) url += `&before=${lastMessageId}`;

        console.log(`⏳ Скачиваю страницу истории...`);
        const res = await fetch(url, {
            headers: {
                'Authorization': token, // Используем Bot токен
                'Content-Type': 'application/json'
            }
        });

        if (!res.ok) {
            console.error(`❌ Ошибка Discord API: ${res.status} ${res.statusText}`);
            const text = await res.text();
            console.error(text);
            break;
        }

        const messages = await res.json();

        if (messages.length === 0) {
            hasMore = false;
            break;
        }

        lastMessageId = messages[messages.length - 1].id;
        totalScraped += messages.length;

        if (totalScraped >= maxMessages) {
            console.log(`🛑 Достигнут лимит в ${maxMessages} сообщений. Остановка парсинга.`);
            hasMore = false;
        }

        // Обрабатываем сообщения
        for (const msg of messages) {
            // СТРОГАЯ ПРОВЕРКА: Парсим ТОЛЬКО то, что написал целевой аккаунт (targetUserId)
            if (msg.author.id === targetUserId && msg.content && msg.content.length > 10) {

                // Вариант А: Если ты отвечаешь на чьё-то сообщение (реплай)
                if (msg.message_reference && msg.referenced_message && msg.referenced_message.content) {
                    const question = msg.referenced_message.content.slice(0, 500);
                    const answer = msg.content.slice(0, 1000);

                    // Сохраняем как Вопрос-Ответ
                    memory.add({
                        type: 'qa',
                        category: 'parsed_discord',
                        question: question,
                        content: answer,
                        source: `discord:${channelId}:${msg.id}`,
                        confidence: 1.0
                    });
                    savedQA++;
                    console.log(`   [✅ Q/A] В: "${question.substring(0, 30)}..." -> О: "${answer.substring(0, 30)}..."`);
                }
                // Вариант Б: Это просто твое самостоятельное длинное сообщение (гайд, правило)
                else if (msg.content.length > 40 && !msg.content.includes('http')) {
                    memory.add({
                        type: 'fact',
                        category: 'parsed_discord',
                        content: msg.content.slice(0, 1500),
                        source: `discord:${channelId}:${msg.id}`,
                        confidence: 0.9
                    });
                    savedFacts++;
                    console.log(`   [✅ ФАКТ] "${msg.content.substring(0, 60)}..."`);
                }
            }
        }

        // =========================================================
        // МАКСИМАЛЬНАЯ ЗАЩИТА ОТ БАНА (STEALTH MODE)
        // Дискорд банит, если запросы идут роботоподобно (с одинаковой задержкой).
        // Поэтому мы делаем случайную задержку от 3 до 8 секунд!
        const waitMs = Math.floor(Math.random() * 5000) + 3000;
        console.log(`[Stealth] 🛡️ Имитирую чтение человеком... Сплю ${(waitMs / 1000).toFixed(1)} сек.`);
        await new Promise(r => setTimeout(r, waitMs));
        // =========================================================
    }

    console.log('═══════════════════════════════════════════════════');
    console.log(`🎉 Завершено! Проверено сообщений: ${totalScraped}`);
    console.log(`🧠 Сохранено пар (Вопрос-Ответ): ${savedQA}`);
    console.log(`🧠 Сохранено фактов и правил: ${savedFacts}`);
    console.log('💡 При следующем запуске бота для них будут сгенерированы векторы.');
    process.exit(0);
}

scrapeDiscordChannel().catch(console.error);
