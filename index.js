const { startWebSocketServer, getCurrentlyPlaying } = require('./spotify');
const { fetchLyrics, getCurrentLyric } = require('./lyrics');
const { updateCustomStatus, clearCustomStatus } = require('./discord');

const POLL_INTERVAL = 1000; // Check state every 1 second

let currentTrackId = null;
let currentLyrics = null;
let lastLyricLine = null;

async function loop() {
    try {
        const trackInfo = getCurrentlyPlaying();

        if (!trackInfo || !trackInfo.isPlaying) {
            // Music is stopped or paused
            if (lastLyricLine !== null) {
                await clearCustomStatus();
                lastLyricLine = null;
                currentTrackId = null;
                currentLyrics = null;
            }
            return;
        }

        // Did the track change?
        if (trackInfo.id !== currentTrackId) {
            currentTrackId = trackInfo.id;
            console.log(`[Spotify] Now playing: ${trackInfo.name} by ${trackInfo.artist}`);
            
            // Fetch lyrics for new track
            currentLyrics = await fetchLyrics(trackInfo.name, trackInfo.artist, trackInfo.album, trackInfo.durationMs);
            if (!currentLyrics) {
                console.log(`[Lyrics] No synced lyrics found for ${trackInfo.name}`);
                await clearCustomStatus();
                lastLyricLine = null;
            } else {
                console.log(`[Lyrics] Found synced lyrics for ${trackInfo.name}`);
            }
        }

        // Update Discord status if we have lyrics
        if (currentLyrics) {
            const timeSinceUpdate = trackInfo.lastUpdate ? (Date.now() - trackInfo.lastUpdate) : 0;
            const interpolatedProgressMs = trackInfo.progressMs + timeSinceUpdate;
            
            // Adding a 500ms offset to account for Discord API delay
            const currentLine = getCurrentLyric(currentLyrics, interpolatedProgressMs + 500);
            
            if (currentLine && currentLine !== lastLyricLine) {
                lastLyricLine = currentLine;
                await updateCustomStatus(currentLine);
            }
        }

    } catch (error) {
        console.error("Error in main loop:", error);
    }
}

console.log("Starting Spotify-Discord Lyrics Sync...");
startWebSocketServer();
setInterval(loop, POLL_INTERVAL);
