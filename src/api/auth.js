const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const https = require('https');
const { OAuth2Client } = require('google-auth-library');
const { sendOtpEmail } = require('../email');

const JWT_SECRET = process.env.JWT_SECRET || 'ticket-dashboard-secret-key-2026';

// Send a Telegram message to a specific chat
function sendTelegramMessage(tgToken, chatId, text, replyMarkup) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            reply_markup: replyMarkup || undefined
        });
        const url = new URL(`https://api.telegram.org/bot${tgToken}/sendMessage`);
        const req = https.request({
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function createAuthRoutes(db, tgToken, adminChatId) {
    const router = express.Router();

    const ADMIN_ALIASES = new Set(['d1reevo', 'd1reevof']);
    const normalizeUsername = (v) => String(v || '').trim().toLowerCase();
    const isFallbackAdminUser = (user) =>
        user?.id === 1 || ADMIN_ALIASES.has(normalizeUsername(user?.username));

    const getEffectiveRole = (user) => {
        // Keep explicit bans intact, but force known owner accounts to admin.
        if (user?.role === 'banned') return 'banned';
        if (isFallbackAdminUser(user)) return 'admin';
        if (user?.role) return user.role;
        return 'user';
    };

    router.post('/register', async (req, res) => {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        try {
            const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
            if (existingUser) {
                return res.status(400).json({ error: 'Username already exists' });
            }

            const saltRounds = 10;
            const password_hash = await bcrypt.hash(password, saltRounds);

            const result = db.prepare(`
                INSERT INTO users (username, password_hash, role)
                VALUES (?, ?, 'pending')
            `).run(username, password_hash);

            const newUserId = result.lastInsertRowid;

            // Notify admin via Telegram
            if (tgToken && adminChatId) {
                try {
                    const timeStr = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
                    await sendTelegramMessage(
                        tgToken,
                        adminChatId,
                        `🆕 <b>Новый пользователь хочет зарегистрироваться</b>\n\n👤 Логин: <code>${username}</code>\n🕐 Время: ${timeStr}`,
                        {
                            inline_keyboard: [[
                                { text: '✅ Одобрить', callback_data: `approve_user:${newUserId}` },
                                { text: '❌ Отклонить', callback_data: `reject_user:${newUserId}` }
                            ]]
                        }
                    );
                } catch (tgErr) {
                    console.error('[Auth API] Failed to send Telegram notification:', tgErr.message);
                }
            }

            res.json({ pending: true, message: 'Ожидайте подтверждения администратора' });
        } catch (error) {
            console.error('[Auth API] Register error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.post('/login', async (req, res) => {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        try {
            const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
            if (!user) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const match = await bcrypt.compare(password, user.password_hash);
            if (!match) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const role = getEffectiveRole(user);

            if (role === 'pending') {
                return res.status(403).json({ error: 'Аккаунт ожидает подтверждения администратора' });
            }
            if (role === 'banned') {
                return res.status(403).json({ error: 'Аккаунт заблокирован' });
            }

            const token = jwt.sign({ userId: user.id, username: user.username, role }, JWT_SECRET, { expiresIn: '7d' });

            res.json({ token, user: { id: user.id, username: user.username, role } });
        } catch (error) {
            console.error('[Auth API] Login error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    
    // -- OTP Routes --
    router.post('/otp/send', async (req, res) => {
        const { email } = req.body;
        if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });

        const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
        const expiresAt = Date.now() + 10 * 60 * 1000; // 10 mins

        try {
            db.prepare('INSERT INTO otp_codes (email, code, expires_at) VALUES (?, ?, ?)').run(email, code, expiresAt);
            await sendOtpEmail(email, code);
            res.json({ ok: true });
        } catch (err) {
            console.error('[Auth API] OTP Send Error:', err.message);
            res.status(500).json({ error: 'Mail error: ' + (err.message || 'Could not send OTP') });
        }
    });

    router.post('/otp/verify', async (req, res) => {
        const { email, code } = req.body;
        if (!email || !code) return res.status(400).json({ error: 'Email and code required' });

        try {
            // Check code
            const record = db.prepare('SELECT id, expires_at FROM otp_codes WHERE email = ? AND code = ? ORDER BY id DESC LIMIT 1').get(email, code);
            if (!record) return res.status(401).json({ error: 'Неверный код' });
            if (Date.now() > record.expires_at) return res.status(401).json({ error: 'Код истек' });

            // Mark code as used (delete)
            db.prepare('DELETE FROM otp_codes WHERE id = ?').run(record.id);

            // Find or create user
            let user = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?').get(email, email);
            if (!user) {
                const result = db.prepare(`
                    INSERT INTO users (username, email, password_hash, role) 
                    VALUES (?, ?, ?, 'pending')
                `).run(email, email, 'otp-login');
                user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
                sendTelegramMessage(tgToken, adminChatId, `🔔 <b>Новая регистрация (Email OTP)</b>\nПользователь: <code>${email}</code>\nОжидает подтверждения.`);
            }

            const role = getEffectiveRole(user);
            if (role === 'pending') return res.status(403).json({ error: 'Аккаунт ожидает подтверждения администратора' });
            if (role === 'banned') return res.status(403).json({ error: 'Аккаунт заблокирован' });

            const token = jwt.sign({ userId: user.id, username: user.username, role }, JWT_SECRET, { expiresIn: '7d' });
            res.json({ token, user: { id: user.id, username: user.username, role } });
        } catch (err) {
            console.error('[Auth API] OTP Verify Error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // -- Direct Reset Routes (Insecure, by User Request) --
    router.post('/reset-password', async (req, res) => {
        const { username, newPassword } = req.body;
        if (!username || !newPassword) return res.status(400).json({ error: 'Логин и новый пароль обязательны' });
        try {
            const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
            if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
            
            const saltRounds = 10;
            const password_hash = await bcrypt.hash(newPassword, saltRounds);
            
            db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(password_hash, username);
            
            res.json({ ok: true, message: 'Пароль успешно изменен' });
        } catch (err) {
            console.error('[Auth API] Reset Password Error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // -- Google OAuth Route --
    router.post('/google', async (req, res) => {
        const { credential } = req.body;
        if (!credential) return res.status(400).json({ error: 'No credential provided' });

        try {
            const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
            const client = new OAuth2Client(clientId);
            const ticket = await client.verifyIdToken({
                idToken: credential,
                audience: clientId
            });
            const payload = ticket.getPayload();
            const { email, sub: google_id, name } = payload;

            // Find or create user
            let user = db.prepare('SELECT * FROM users WHERE google_id = ? OR email = ?').get(google_id, email);
            if (!user) {
                const generatedUsername = name ? name.replace(/\s+/g, '_').toLowerCase() + '_' + Math.floor(Math.random()*1000) : email;
                const result = db.prepare(`
                    INSERT INTO users (username, email, google_id, password_hash, role) 
                    VALUES (?, ?, ?, ?, 'pending')
                `).run(generatedUsername, email, google_id, 'google-login');
                user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
                sendTelegramMessage(tgToken, adminChatId, `🔔 <b>Новая регистрация (Google)</b>\nПользователь: <code>${email}</code>\nОжидает подтверждения.`);
            } else if (!user.google_id) {
                // Link google account
                db.prepare('UPDATE users SET google_id = ? WHERE id = ?').run(google_id, user.id);
            }

            const role = getEffectiveRole(user);
            if (role === 'pending') return res.status(403).json({ error: 'Аккаунт ожидает подтверждения администратора' });
            if (role === 'banned') return res.status(403).json({ error: 'Аккаунт заблокирован' });

            const token = jwt.sign({ userId: user.id, username: user.username, role }, JWT_SECRET, { expiresIn: '7d' });
            res.json({ token, user: { id: user.id, username: user.username, role } });
        } catch (err) {
            console.error('[Auth API] Google Auth Error:', err);
            res.status(401).json({ error: 'Google Error: ' + (err.message || 'Invalid token') });
        }
    });

    router.get('/me', authenticateToken, (req, res) => {
        try {
            const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
            if (!user) return res.status(404).json({ error: 'User not found' });
            const role = getEffectiveRole(user);
            // Check banned again on /me
            if (role === 'banned') return res.status(403).json({ error: 'Аккаунт заблокирован' });
            res.json({
                user: {
                    id: user.id,
                    username: user.username,
                    discord_token: user.discord_token,
                    tg_token: user.tg_token,
                    tg_chat_id: user.tg_chat_id,
                    role,
                }
            });
        } catch (error) {
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.put('/password', authenticateToken, async (req, res) => {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Укажите текущий и новый пароль' });
        try {
            const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(req.user.userId);
            if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
            
            const match = await bcrypt.compare(currentPassword, user.password_hash);
            if (!match) return res.status(401).json({ error: 'Неверный текущий пароль' });
            
            const saltRounds = 10;
            const password_hash = await bcrypt.hash(newPassword, saltRounds);
            
            db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(password_hash, req.user.userId);
            res.json({ ok: true });
        } catch (err) {
            console.error('[Auth API] Change Password Error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.status(401).json({ error: 'No token provided' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired token' });
        req.user = user;
        next();
    });
}

module.exports = { createAuthRoutes, authenticateToken, JWT_SECRET, sendTelegramMessage };
