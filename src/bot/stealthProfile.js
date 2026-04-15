// ═══════════════════════════════════════════════════════════════
//  Stealth Profile — Discord Desktop client emulation
//  Makes selfbot connections indistinguishable from real clients
// ═══════════════════════════════════════════════════════════════

const os = require('os');
const crypto = require('crypto');

// ── Discord Desktop Client Constants ────────────────────────────
// These values match a real Discord Desktop (Electron) client.
// Update periodically to stay in sync with official releases.

const CLIENT_BUILD_NUMBER = 366934;
const ELECTRON_VERSION = '32.2.7';
const CHROME_VERSION = '128.0.6613.186';
const RELEASE_CHANNEL = 'stable';
const DESIGN_ID = 0;

// ── Detect OS for realistic properties ──────────────────────────

function getOsName() {
    const platform = os.platform();
    if (platform === 'win32') return 'Windows';
    if (platform === 'darwin') return 'Mac OS X';
    return 'Linux';
}

function getOsVersion() {
    const platform = os.platform();
    if (platform === 'win32') return '10.0.22631'; // Windows 11
    if (platform === 'darwin') return '24.0.0';
    return os.release() || '6.8.0-51-generic';
}

function getSystemLocale() {
    const env = process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || '';
    if (env.startsWith('ru')) return 'ru';
    if (env.startsWith('uk')) return 'uk';
    if (env.startsWith('en')) return 'en-US';
    return 'ru'; // Default for this project's users
}

// ── Super Properties (sent in identify + X-Super-Properties header) ──

function getSuperProperties() {
    const osName = getOsName();
    const osVersion = getOsVersion();
    const locale = getSystemLocale();

    return {
        os: osName,
        browser: 'Discord Client',
        device: '',
        system_locale: locale,
        browser_user_agent: `Mozilla/5.0 (${osName === 'Windows' ? 'Windows NT 10.0; Win64; x64' : osName === 'Linux' ? 'X11; Linux x86_64' : 'Macintosh; Intel Mac OS X 10_15_7'}) AppleWebKit/537.36 (KHTML, like Gecko) discord/${osName === 'Linux' ? '0.0.71' : '1.0.9176'} Chrome/${CHROME_VERSION} Electron/${ELECTRON_VERSION} Safari/537.36`,
        browser_version: ELECTRON_VERSION,
        os_version: osVersion,
        referrer: '',
        referring_domain: '',
        referrer_current: '',
        referring_domain_current: '',
        release_channel: RELEASE_CHANNEL,
        client_build_number: CLIENT_BUILD_NUMBER,
        client_event_source: null,
        design_id: DESIGN_ID,
    };
}

// ── Identify Payload Builder ────────────────────────────────────

function buildIdentifyPayload(token, { status = 'online' } = {}) {
    return {
        token,
        capabilities: 16381,
        properties: getSuperProperties(),
        presence: {
            status,
            since: 0,
            activities: [],
            afk: false,
        },
        compress: false,
        client_state: {
            guild_versions: {},
            highest_last_message_id: '0',
            read_state_version: 0,
            user_guild_settings_version: -1,
            user_settings_version: -1,
            private_channels_version: '0',
            api_code_version: 0,
        },
    };
}

// ── X-Super-Properties Header (Base64 encoded) ──────────────────

function getXSuperPropertiesHeader() {
    const props = getSuperProperties();
    return Buffer.from(JSON.stringify(props)).toString('base64');
}

// ── REST API Headers (match real Discord client) ────────────────

function getDiscordRestHeaders(token, { isBotToken = false } = {}) {
    const superProps = getSuperProperties();
    const headers = {
        'Authorization': isBotToken ? `Bot ${token}` : token,
        'Content-Type': 'application/json',
        'User-Agent': superProps.browser_user_agent,
        'X-Super-Properties': getXSuperPropertiesHeader(),
        'X-Discord-Locale': superProps.system_locale,
        'X-Discord-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Kiev',
        'X-Debug-Options': 'bugReporterEnabled',
        'Accept': '*/*',
        'Accept-Language': `${superProps.system_locale},en-US;q=0.9,en;q=0.8`,
        'Sec-Ch-Ua': `"Chromium";v="${CHROME_VERSION.split('.')[0]}", "Not=A?Brand";v="8"`,
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': `"${superProps.os}"`,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
    };

    // Bot tokens don't need stealth headers
    if (isBotToken) {
        return {
            'Authorization': `Bot ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'DiscordBot (ticket-notifier, 1.0)',
        };
    }

    return headers;
}

// ── Typing Delay (humanize auto-replies) ────────────────────────

/**
 * Simulates human typing delay before sending an auto-reply.
 * @param {Function} triggerTypingFn - async function that triggers typing indicator
 * @param {string} messageContent - the message to be sent (used to calculate delay)
 * @returns {Promise<void>}
 */
async function humanizeAutoReply(triggerTypingFn, messageContent = '') {
    const contentLength = (messageContent || '').length;
    // Base delay 1.5-3s + typing time based on message length
    const baseDelay = 1500 + Math.random() * 1500;
    const typingDelay = Math.min(contentLength * 15, 4000); // ~15ms per char, max 4s
    const totalDelay = baseDelay + typingDelay;

    // Trigger typing indicator
    if (typeof triggerTypingFn === 'function') {
        try { await triggerTypingFn(); } catch { }
    }

    // Wait for the "typing" duration
    await new Promise(resolve => setTimeout(resolve, totalDelay));
}

// ── Cookie Header (optional realism) ────────────────────────────

function generateSessionCookie() {
    const uid = crypto.randomBytes(16).toString('hex');
    return `__dcfduid=${uid}; __sdcfduid=${crypto.randomBytes(48).toString('hex')}; __cfruid=${crypto.randomBytes(20).toString('hex')}-${Date.now()}`;
}

module.exports = {
    getSuperProperties,
    buildIdentifyPayload,
    getXSuperPropertiesHeader,
    getDiscordRestHeaders,
    humanizeAutoReply,
    generateSessionCookie,
    CLIENT_BUILD_NUMBER,
    CHROME_VERSION,
    ELECTRON_VERSION,
};
