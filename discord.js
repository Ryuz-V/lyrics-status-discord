const axios = require('axios');

const EMOJIS = ['💫', '✨', '🩵', '🐦‍⬛', '🎶', '🎤'];

async function updateCustomStatus(text, token) {
    const randomEmoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
    if (!token) return;
    
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
