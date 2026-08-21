const axios = require('axios');

let musixmatchToken = null;

async function getMusixmatchToken() {
    if (musixmatchToken) return musixmatchToken;
    try {
        const tokenRes = await axios.get('https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0', {
            headers: { 'User-Agent': 'Musixmatch/3.14.7570 (Windows 10.0; x64) WebView2/115.0.1901.183' }
        });
        if (tokenRes.data && tokenRes.data.message && tokenRes.data.message.body) {
            musixmatchToken = tokenRes.data.message.body.user_token;
            return musixmatchToken;
        }
    } catch (e) {
        console.error("[Lyrics] Error getting Musixmatch token:", e.message);
    }
    return null;
}

async function fetchMusixmatchLyrics(trackName, artistName, isRetry = false) {
    const token = await getMusixmatchToken();
    if (!token) return null;

    try {
        const response = await axios.get('https://apic-desktop.musixmatch.com/ws/1.1/macro.subtitles.get', {
            params: {
                format: 'json',
                q_track: trackName,
                q_artist: artistName,
                user_language: 'en',
                namespace: 'lyrics_synched',
                f_subtitle_length_max_deviation: 1,
                subtitle_format: 'lrc',
                app_id: 'web-desktop-app-v1.0',
                usertoken: token
            },
            headers: {
                'User-Agent': 'Musixmatch/3.14.7570 (Windows 10.0; x64) WebView2/115.0.1901.183'
            }
        });
        
        const data = response.data;
        if (data.message && data.message.header && data.message.header.status_code === 401 && !isRetry) {
            // Token expired or invalid, reset and retry
            musixmatchToken = null;
            return await fetchMusixmatchLyrics(trackName, artistName, true);
        }

        if (data.message && data.message.body && data.message.body.macro_calls) {
            const macro = data.message.body.macro_calls;
            const subtitlesReq = macro['track.subtitles.get'];
            
            if (subtitlesReq && subtitlesReq.message && subtitlesReq.message.body && subtitlesReq.message.body.subtitle_list) {
                const subtitles = subtitlesReq.message.body.subtitle_list;
                if (subtitles.length > 0) {
                    const lrcString = subtitles[0].subtitle.subtitle_body;
                    return parseLrc(lrcString);
                }
            }
        }
    } catch (e) {
        console.error("[Lyrics] API Error:", e.message);
    }
    return null;
}

async function fetchLyrics(trackName, artistName, albumName, durationMs) {
    let lyrics = await fetchMusixmatchLyrics(trackName, artistName);
    
    // If not found, try cleaning up the track name (remove " (with ...)", " (feat. ...)")
    if (!lyrics) {
        const cleanedName = trackName.replace(/\s*\(.*?\)\s*/g, '').replace(/\s*\[.*?\]\s*/g, '').trim();
        if (cleanedName !== trackName) {
            lyrics = await fetchMusixmatchLyrics(cleanedName, artistName);
        }
    }
    
    return lyrics;
}

function parseLrc(lrcString) {
    const lines = lrcString.split('\n');
    const lyrics = [];
    
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
    
    for (const line of lines) {
        const match = timeRegex.exec(line);
        if (match) {
            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            const milliseconds = parseInt(match[3]) * (match[3].length === 2 ? 10 : 1);
            
            const timeMs = (minutes * 60 * 1000) + (seconds * 1000) + milliseconds;
            const text = line.replace(timeRegex, '').trim();
            
            if (text) {
                lyrics.push({ timeMs, text });
            }
        }
    }
    
    return lyrics;
}

function getCurrentLyric(lyrics, progressMs) {
    if (!lyrics || lyrics.length === 0) return null;
    
    let currentLine = null;
    for (let i = 0; i < lyrics.length; i++) {
        if (progressMs >= lyrics[i].timeMs) {
            currentLine = lyrics[i].text;
        } else {
            break;
        }
    }
    return currentLine;
}

module.exports = { fetchLyrics, getCurrentLyric };
