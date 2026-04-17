const fs = require('fs');
const path = require('path');
// Используем нативный fetch из Node 20
const FunAIMemory = require('./src/bot/funaiMemory');

// Путь к базе данных (берём первую базу, так как у нас 1 юзер)
const dbPath = path.join(__dirname, 'data', 'tickets_1.db');
const Database = require('better-sqlite3');
const db = new Database(dbPath);
const memory = new FunAIMemory(db);

console.log('🚀 Начинаем парсинг базы знаний FunTime...');

// Список известных статей из Sitemap
const ARTICLES = [
    'talismans', 'cases', 'buyer', 'potions', 'damager', 
    'auction', 'design', 'mysterious-beacon', 'auc', 'warps', 
    'syncronization', 'custom-crafts', 'privates'
];

async function stripHtml(html) {
    // Очень простая очистка HTML (в идеале нужно использовать cheerio, но мы обойдёмся регулярками)
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    // Извлекаем только текст из <main> или <article>, если есть
    const mainMatch = text.match(/<main[^>]*>([\s\S]*?)<\/main>/i) || text.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (mainMatch) text = mainMatch[1];
    
    text = text.replace(/<[^>]+>/g, ' '); // удаляем теги
    text = text.replace(/\s+/g, ' ').trim(); // чистим пробелы
    return text;
}

async function start() {
    let successCount = 0;

    for (const slug of ARTICLES) {
        const url = `https://funtime.wiki/article/${slug}`;
        console.log(`⏳ Парсим: ${url}...`);
        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            if (!res.ok) {
                console.log(`❌ Ошибка ${res.status}: ${url}`);
                continue;
            }
            const html = await res.text();
            
            // Пытаемся вытащить заголовок и текст статьи
            const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<title>([\s\S]*?)<\/title>/i);
            const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').replace('FunTime Wiki', '').replace('|', '').trim() : slug;
            const textContent = await stripHtml(html);

            // Оставляем первые 1500 символов, чтобы не раздувать токены
            const snippet = textContent.slice(0, 1500);

            // Заливаем в базу
            memory.add({
                type: 'fact',
                category: 'wiki',
                question: title,
                content: snippet,
                source: url,
                confidence: 1.0
            });

            console.log(`✅ Добавлена статья: ${title} (${snippet.length} символов)`);
            successCount++;

            // Задержка чтобы не заДДОСить вики
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
            console.error(`❌ Ошибка загрузки ${url}: ${e.message}`);
        }
    }

    // Попытка спарсить главную страницу
    console.log('⏳ Парсим главную страницу...');
    try {
        const res = await fetch('https://funtime.wiki/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (res.ok) {
            const content = await stripHtml(await res.text());
            memory.add({
                type: 'fact',
                category: 'wiki',
                content: `Общая информация с FunTime Wiki: ${content.slice(0, 1000)}`,
                source: 'https://funtime.wiki/',
                confidence: 0.9
            });
            successCount++;
        }
    } catch {}

    // Если funtime.su заблокирован Cloudflare (403), мы просто оставим заглушку
    try {
        const res = await fetch('https://funtime.su/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (res.ok) {
            const content = await stripHtml(await res.text());
            memory.add({
                type: 'fact',
                category: 'main_site',
                content: `Информация с сайта FunTime.su: ${content.slice(0, 1000)}`,
                source: 'https://funtime.su/',
                confidence: 1.0
            });
            successCount++;
        } else {
            console.log('⚠️ funtime.su вернул 403 (защита Cloudflare). Парсер не может туда попасть.');
        }
    } catch {}

    console.log('═══════════════════════════════════════════════════');
    console.log(`🎉 Завершено! Успешно спарсено и добавлено ${successCount} статей.`);
    console.log('🤖 Теперь FunAI знает базу с Вики проекта!');
    console.log('💡 Запусти бота, и он автоматически создаст векторы для новых статей.');
    process.exit(0);
}

start();
