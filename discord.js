const axios = require('axios');
require('dotenv').config();

const EMOJIS = ['💫', '✨', '🩵', '🐦‍⬛', '🎶', '🎤'];

async function updateCustomStatus(text) {
    const randomEmoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
    if (!process.env.DISCORD_TOKEN) {
        console.error("No Discord token provided.");
        return;
    }
    
    // limit text to 128 characters which is Discord's limit
    const truncatedText = text.length > 128 ? text.substring(0, 125) + '...' : text;

    try {
        await axios.patch(
            'https://discord.com/api/v9/users/@me/settings',
            {
                custom_status: {
                    text: truncatedText,
                    emoji_name: randomEmoji
                }
            },
            {
                headers: {
                    'Authorization': process.env.DISCORD_TOKEN,
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log(`[Discord] Updated status: ${truncatedText}`);
    } catch (error) {
        console.error('[Discord] Failed to update status:', error.response ? error.response.data : error.message);
    }
}

async function clearCustomStatus() {
    if (!process.env.DISCORD_TOKEN) return;
    try {
        await axios.patch(
            'https://discord.com/api/v9/users/@me/settings',
            {
                custom_status: null
            },
            {
                headers: {
                    'Authorization': process.env.DISCORD_TOKEN,
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log("[Discord] Cleared status");
    } catch (error) {
        console.error('[Discord] Failed to clear status:', error.response ? error.response.data : error.message);
    }
}

module.exports = { updateCustomStatus, clearCustomStatus };
