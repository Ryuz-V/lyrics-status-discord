const axios = require('axios');

const EMOJIS = ['💫', '✨', '🩵', '🐦‍⬛', '🎶', '🎤'];

async function updateCustomStatus(text, token, customEmoji = null) {
    if (!token || !text) return;
    
    const emoji = customEmoji !== null ? customEmoji : EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
    
    // limit text to 128 characters which is Discord's limit
    const truncatedText = text.length > 128 ? text.substring(0, 125) + '...' : text;

    const payload = {
        custom_status: {
            text: truncatedText
        }
    };
    if (emoji) {
        payload.custom_status.emoji_name = emoji;
    }

    try {
        await axios.patch(
            'https://discord.com/api/v9/users/@me/settings',
            payload,
            {
                headers: {
                    'Authorization': token,
                    'Content-Type': 'application/json'
                }
            }
        );
    } catch (error) {}
}

async function clearCustomStatus(token) {
    if (!token) return;
    try {
        await axios.patch(
            'https://discord.com/api/v9/users/@me/settings',
            {
                custom_status: null
            },
            {
                headers: {
                    'Authorization': token,
                    'Content-Type': 'application/json'
                }
            }
        );
    } catch (error) {}
}

module.exports = { updateCustomStatus, clearCustomStatus };
