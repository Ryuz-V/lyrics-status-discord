const axios = require('axios');

// In-Memory Lyrics Cache
const lyricsCache = new Map();

function getCacheKey(trackName, artistName) {
    const t = (trackName || '').trim().toLowerCase();
    const a = (artistName || '').trim().toLowerCase();
    return `${a}___${t}`;
}

async function fetchLrclibLyrics(trackName, artistName, albumName, durationMs) {
    try {
        // First try the exact match endpoint if we have duration
        if (durationMs) {
            const response = await axios.get('https://lrclib.net/api/get', {
                params: {
                    track_name: trackName,
                    artist_name: artistName,
                    album_name: albumName,
                    duration: Math.round(durationMs / 1000)
                },
                headers: {
                    'User-Agent': 'Spotify-Discord-Lyrics-Sync'
                },
                timeout: 5000
            });
            
            if (response.data && response.data.syncedLyrics) {
                return parseLrc(response.data.syncedLyrics);
            }
        }
    } catch (e) {
        // Ignored, fallback to search
    }

    // Fallback to search endpoint
    try {
        const response = await axios.get('https://lrclib.net/api/search', {
            params: {
                q: `${trackName} ${artistName}`
            },
            headers: {
                'User-Agent': 'Spotify-Discord-Lyrics-Sync'
            },
            timeout: 5000
        });

        if (response.data && response.data.length > 0) {
            // Find the first one with syncedLyrics
            const match = response.data.find(track => track.syncedLyrics);
            if (match) {
                return parseLrc(match.syncedLyrics);
            }
        }
    } catch (e) {
        console.error("[Lyrics] LRCLIB API Error:", e.message);
    }
    
    return null;
}

async function fetchLyrics(trackName, artistName, albumName, durationMs) {
    if (!trackName) return null;

    const cacheKey = getCacheKey(trackName, artistName);
    if (lyricsCache.has(cacheKey)) {
        return lyricsCache.get(cacheKey);
    }

    let lyrics = await fetchLrclibLyrics(trackName, artistName, albumName, durationMs);
    
    // If not found, try sanitizing track name (remove "feat", "remastered", "official video", etc.)
    if (!lyrics) {
        const cleanedName = trackName
            .replace(/\s*\(.*?(feat|with|remaster|deluxe|version|live|explicit|official).*?\)/gi, '')
            .replace(/\s*\[.*?(feat|with|remaster|deluxe|version|live|explicit|official).*?\]/gi, '')
            .replace(/\s*-\s*(remastered|deluxe|live|radio edit|single version).*$/gi, '')
            .replace(/\s*\(.*?\)\s*/g, '')
            .replace(/\s*\[.*?\]\s*/g, '')
            .trim();

        if (cleanedName && cleanedName.toLowerCase() !== trackName.toLowerCase()) {
            lyrics = await fetchLrclibLyrics(cleanedName, artistName, albumName, durationMs);
        }
    }

    // Cache the result in memory (including null to avoid hammering LRCLIB for instrumental/unfound tracks)
    lyricsCache.set(cacheKey, lyrics);
    return lyrics;
}

function clearLyricsCache() {
    lyricsCache.clear();
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

module.exports = { fetchLyrics, getCurrentLyric, clearLyricsCache };
