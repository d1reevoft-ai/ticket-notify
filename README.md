# 🎫 Telegram Ticket Notifier

> Мост между Discord-тикетами и Telegram — мониторинг, уведомления и управление тикетами прямо из Telegram.

---

## 📋 Что делает бот

- 🔔 Уведомляет о новых тикетах и первых сообщениях игроков
- 💬 Позволяет отвечать в Discord-тикеты прямо из Telegram
- ⏰ Таймеры активности — напоминает если игрок долго не отвечает
- 🔒 Уведомляет о закрытии тикетов
- 🚨 Определяет высокоприоритетные обращения по ключевым словам
- 📊 Статистика и аналитика по тикетам
- 📅 Система смен с авто-напоминанием в 13:00 (Europe/Kyiv)

---

## 🚀 Быстрый старт

### 1. Установка зависимостей

```bash
npm install
```

### 2. Настройка `config.json`

Создайте файл `config.json` в корне проекта:

```json
{
  "discordBotToken": "YOUR_BOT_TOKEN",
  "tgToken": "YOUR_TELEGRAM_BOT_TOKEN",
  "tgChatId": "YOUR_TELEGRAM_CHAT_ID",
  "guildId": "YOUR_DISCORD_SERVER_ID",
  "ticketsCategoryId": "YOUR_TICKETS_CATEGORY_ID",
  "staffRoleIds": ["ROLE_ID_1", "ROLE_ID_2"],
  "ticketPrefix": "тикет-от"
}
```

### 3. Запуск

```bash
node bot.js
```

---

## ⚙️ Конфигурация

### Обязательные параметры

| Параметр | Описание |
|---|---|
| `discordBotToken` | Токен Discord-бота |
| `tgToken` | Токен Telegram-бота |
| `tgChatId` | ID чата / группы в Telegram |
| `guildId` | ID Discord-сервера |
| `ticketsCategoryId` | ID категории с тикетами |
| `staffRoleIds` | Массив ID ролей саппорта |
| `ticketPrefix` | Префикс названий тикет-каналов |

### Переменные окружения (Docker / VPS)

Все параметры можно передать через env-переменные — они перезаписывают `config.json`:

```env
DISCORD_BOT_TOKEN=...
TG_TOKEN=...
TG_CHAT_ID=...
GUILD_ID=...
TICKETS_CATEGORY_ID=...
STAFF_ROLE_IDS=id1,id2
TICKET_PREFIX=тикет-от
JWT_SECRET=<random value, at least 32 characters>
PLUGIN_SECRET=<random value, at least 32 characters>
DASHBOARD_URL=https://your-domain.example
VITE_API_PROXY_TARGET=http://localhost:3001
```

Не добавляйте в Git `config.json`, `.env` или `.env.ubuntu`: в них хранятся приватные токены и пароли.
`PLUGIN_SECRET` должен совпадать с приватным значением в настройках Vencord-плагина.

### Необязательные параметры

| Параметр | По умолчанию | Описание |
|---|---|---|
| `activityCheckMin` | `10` | Таймер «нет ответа» (мин.) |
| `closingCheckMin` | `15` | Таймер «можно закрывать» (мин.) |
| `maxMessageLength` | `300` | Макс. длина сообщения в уведомлении |
| `notifyOnClose` | `true` | Уведомлять о закрытии тикета |
| `includeFirstUserMessage` | `true` | Пересылать первое сообщение игрока |
| `mentionOnHighPriority` | `true` | Доп. уведомление при высоком приоритете |
| `forumMode` | `false` | Режим форума в Telegram |
| `closingPhrase` | `"остались вопросы"` | Фразы для определения закрывающего сообщения |
| `priorityKeywords` | `["срочно", "urgent", ...]` | Ключевые слова высокого приоритета |
| `pollingIntervalSec` | `3` | Интервал опроса Telegram (сек.) |

---

## 📡 Режимы подключения к Discord

### Режим 1: Bot Token (рекомендуется)

1. Создайте бота на [discord.com/developers](https://discord.com/developers/applications)
2. Скопируйте **Bot Token** → `discordBotToken` в `config.json`
3. Включите Intents: **Server Members** + **Message Content**
4. Пригласите бота на сервер (scope: `bot`, permissions: `66560`)

### Режим 2: User Token (selfbot)

Укажите `discordToken` вместо `discordBotToken`.

> ⚠️ **Нарушает Terms of Service Discord — риск бана аккаунта. Используйте на свой страх и риск.**

---

## 🤖 Команды в Telegram

### Чат с тикетами

| Команда | Описание |
|---|---|
| `/list` | Список тикетов с кнопками выбора |
| `/s <текст>` | Отправить сообщение в выбранный тикет |
| `/ticket` | Показать текущий активный тикет |
| `/unselect` | Сбросить выбор тикета |
| `reply на уведомление` | Быстрый ответ в тикет через Telegram reply |

### Мониторинг

| Команда | Описание |
|---|---|
| `/oldlist` | Список открытых тикетов со статусом SLA |
| `/msg <номер> <текст>` | Отправить в тикет по номеру из `/oldlist` |
| `/stats` | Статистика бота |
| `/analytics` | Аналитика: среднее время ответа, топ игроков, пиковые часы |

### Управление

| Команда | Описание |
|---|---|
| `/settings` | Просмотр текущих настроек |
| `/set <ключ> <значение>` | Изменить настройку на лету |
| `/pause` / `/resume` | Приостановить / возобновить уведомления |
| `/reset` | Сбросить счётчики статистики |

### Система смен

| Команда | Описание |
|---|---|
| `/smena` | Отметить начало смены в Discord |
| `/smenoff` | Закрыть смену (редактирует сообщение в Discord) |
| `/resetsmen` | Сбросить состояние смены |

> ⏰ Если смена не отмечена до **13:00 по Киеву** — бот пришлёт напоминание с кнопками.

---

## 🔁 Работа 24/7 через PM2

```bash
npm install -g pm2
pm2 start bot.js --name ticket-bot
pm2 startup && pm2 save
```

---

## 📁 Структура файлов

```
├── bot.js              # Основной файл бота
├── config.json         # Конфигурация
├── state.json          # Состояние тикетов (авто)
├── shift_state.json    # Состояние смены (авто)
└── ticket_chat_state.json  # Активный тикет в чате (авто)
```

---

## 🛡️ SLA-индикаторы

В команде `/oldlist` каждый тикет помечается эмодзи:

| Эмодзи | Значение |
|---|---|
| ✅ | Саппорт уже ответил |
| 🟢 | Тикет висит < 30 минут |
| 🟡 | Тикет висит 30 мин — 2 часа |
| 🔴 | Тикет висит > 2 часов без ответа |

---

## 🧩 Зависимости

```
ws — WebSocket для Discord Gateway
```

Всё остальное — встроенные модули Node.js (`https`, `fs`, `path`).

---

## 📝 Лицензия

MIT
