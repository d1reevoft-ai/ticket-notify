const nodemailer = require('nodemailer');

/**
 * Send an OTP code via email
 * @param {string} toEmail 
 * @param {string} code 
 * @returns {Promise<boolean>}
 */
async function sendOtpEmail(toEmail, code) {
    const user = (process.env.SMTP_USER || '').trim();
    const pass = (process.env.SMTP_PASS || '').trim();

    if (!user || !pass) {
        console.warn('⚠️ SMTP credentials missing (SMTP_USER, SMTP_PASS). Cannot send email.');
        throw new Error('SMTP_USER or SMTP_PASS is missing in environment variables');
    }

    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail', // Assuming gmail based on App Password instructions
            auth: {
                user: user,
                pass: pass
            }
        });

        const mailOptions = {
            from: `"Ticket Notifier" <${user}>`,
            to: toEmail,
            subject: 'Ваш код авторизации — Ticket Notifier',
            text: `Ваш проверочный код: ${code}\n\nКод действителен в течение 10 минут.`,
            html: `
                <div style="font-family: sans-serif; padding: 20px; color: #333;">
                    <h2>Вход в панель управления</h2>
                    <p>Вы (или кто-то другой) запросили вход по Email.</p>
                    <p>Ваш проверочный код:</p>
                    <h1 style="background: #f4f4f4; padding: 10px; display: inline-block; border-radius: 5px; letter-spacing: 5px;">${code}</h1>
                    <p>Код действителен в течение 10 минут.</p>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`[Email] OTP sent to ${toEmail}: ${info.messageId}`);
        return true;
    } catch (err) {
        console.error(`[Email] Error sending OTP to ${toEmail}:`, err.message);
        throw err;
    }
}

module.exports = { sendOtpEmail };
