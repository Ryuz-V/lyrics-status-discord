const axios = require('axios');

// Rate limit & state tracking
let lastRequestTime = 0;
let rateLimitedUntil = 0;
let lastSentText = null;

// Batas minimum waktu antar-request ke Discord (2.5 detik) untuk mencegah flag rate-limit
const MIN_COOLDOWN_MS = 2500;

/**
 * Update Discord Custom Status via HTTP PATCH /users/@me/settings
 * @returns {Promise<{success: boolean, skipped?: boolean, rateLimited?: boolean, throttled?: boolean, unauthorized?: boolean, retryAfter?: number, message?: string}>}
 */
async function updateCustomStatus(text, token, customEmoji = null) {
    if (!token || !text) {
        return { success: false, message: 'Missing token or text' };
    }

    // Batasi teks maksimal 128 karakter sesuai limit Discord
    const truncatedText = text.length > 128 ? text.substring(0, 125) + '...' : text;

    // Deduplikasi: jika teks sama persis dengan yang terakhir berhasil dikirim, lewati
    if (truncatedText === lastSentText) {
        return { success: true, skipped: true };
    }

    const now = Date.now();

    // 1. Cek apakah masih dalam masa penalti HTTP 429 (Rate Limit dari server Discord)
    if (now < rateLimitedUntil) {
        const remainingSec = Math.ceil((rateLimitedUntil - now) / 1000);
        return {
            success: false,
            rateLimited: true,
            retryAfter: remainingSec,
            message: `Discord rate-limited. Retry in ${remainingSec}s`
        };
    }

    // 2. Throttle Guard lokal: pastikan ada jeda minimal antar request
    if (now - lastRequestTime < MIN_COOLDOWN_MS) {
        return {
            success: false,
            throttled: true,
            message: 'Throttled to avoid Discord rate limit'
        };
    }

    const payload = {
        custom_status: {
            text: truncatedText,
            emoji_name: customEmoji || null,
            emoji_id: null
        }
    };

    try {
        lastRequestTime = Date.now();
        await axios.patch(
            'https://discord.com/api/v9/users/@me/settings',
            payload,
            {
                headers: {
                    'Authorization': token,
                    'Content-Type': 'application/json'
                },
                timeout: 5000
            }
        );

        lastSentText = truncatedText;
        return { success: true, text: truncatedText };
    } catch (error) {
        if (error.response) {
            const status = error.response.status;
            if (status === 429) {
                const retryAfter = (error.response.data && error.response.data.retry_after) || 5;
                rateLimitedUntil = Date.now() + Math.ceil(retryAfter * 1000) + 500;
                return {
                    success: false,
                    rateLimited: true,
                    retryAfter: Math.ceil(retryAfter),
                    message: `HTTP 429: Terkena rate limit Discord. Menunggu ${Math.ceil(retryAfter)} detik.`
                };
            }
            if (status === 401) {
                return {
                    success: false,
                    unauthorized: true,
                    message: 'HTTP 401: Discord token tidak valid atau telah kedaluwarsa.'
                };
            }
            return {
                success: false,
                statusCode: status,
                message: `HTTP ${status}: ${error.response.statusText || 'Error'}`
            };
        }
        return {
            success: false,
            message: error.message || 'Network error'
        };
    }
}

/**
 * Menghapus Custom Status di profil Discord
 */
async function clearCustomStatus(token) {
    if (!token) return { success: false, message: 'Missing token' };

    // Jika sudah bersih/kosong, tidak perlu kirim request PATCH lagi
    if (lastSentText === null) {
        return { success: true, skipped: true };
    }

    const now = Date.now();
    if (now < rateLimitedUntil) {
        return { success: false, rateLimited: true };
    }

    try {
        lastRequestTime = Date.now();
        await axios.patch(
            'https://discord.com/api/v9/users/@me/settings',
            {
                custom_status: null
            },
            {
                headers: {
                    'Authorization': token,
                    'Content-Type': 'application/json'
                },
                timeout: 5000
            }
        );
        lastSentText = null;
        return { success: true };
    } catch (error) {
        if (error.response && error.response.status === 429) {
            const retryAfter = (error.response.data && error.response.data.retry_after) || 5;
            rateLimitedUntil = Date.now() + Math.ceil(retryAfter * 1000);
            return { success: false, rateLimited: true, retryAfter };
        }
        return { success: false, message: error.message };
    }
}

/**
 * Reset state pelacak status lokal saat disconnect
 */
function resetStatusState() {
    lastSentText = null;
}

/**
 * Cek apakah status saat ini sedang terkena rate limit
 */
function isRateLimited() {
    const now = Date.now();
    if (now < rateLimitedUntil) {
        return Math.ceil((rateLimitedUntil - now) / 1000);
    }
    return 0;
}

module.exports = {
    updateCustomStatus,
    clearCustomStatus,
    resetStatusState,
    isRateLimited
};
