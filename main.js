const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { fetchLyrics, getCurrentLyric } = require('./lyrics');
const { updateCustomStatus, clearCustomStatus } = require('./discord');
const { startWebSocketServer, getCurrentlyPlaying } = require('./spotify');

// Simple JSON config manager
let storePath = '';
const store = {
    get: (key, def = null) => {
        try {
            if (!storePath) storePath = path.join(app.getPath('userData'), 'config.json');
            if (fs.existsSync(storePath)) {
                const data = JSON.parse(fs.readFileSync(storePath, 'utf8'));
                return data[key] !== undefined ? data[key] : def;
            }
        } catch(e) {}
        return def;
    },
    set: (key, value) => {
        try {
            if (!storePath) storePath = path.join(app.getPath('userData'), 'config.json');
            let data = {};
            if (fs.existsSync(storePath)) {
                data = JSON.parse(fs.readFileSync(storePath, 'utf8'));
            }
            data[key] = value;
            fs.writeFileSync(storePath, JSON.stringify(data, null, 2));
        } catch(e) {}
    }
};

let mainWindow;
let syncInterval = null;
let isWebSocketStarted = false;

// State variables for loop
let currentTrackId = null;
let currentLyrics = null;
let lastLyricLine = null;
let activeDiscordToken = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 450,
        height: 500, // Reduced height since we removed Spotify inputs
        title: "Presync",
        backgroundColor: '#2b2d31',
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadFile('index.html');
}

function logToUI(message, type = 'default') {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('log', { message, type });
    }
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC Handlers
ipcMain.on('request-settings', (event) => {
    const settings = {
        discordToken: store.get('discordToken', '')
    };
    event.sender.send('load-settings', settings);
});

ipcMain.on('save-settings', (event, settings) => {
    if (settings.discordToken) store.set('discordToken', settings.discordToken);
});

ipcMain.on('start-sync', async (event) => {
    activeDiscordToken = store.get('discordToken');

    if (!activeDiscordToken) {
        logToUI("Missing Discord Token!", "error");
        return;
    }

    if (!isWebSocketStarted) {
        startWebSocketServer();
        isWebSocketStarted = true;
        logToUI("Started Spicetify WebSocket Server on port 8974", "info");
    }

    if (syncInterval) clearInterval(syncInterval);
    
    logToUI("Starting Spotify-Discord Lyrics Sync...", "info");
    event.sender.send('state-update', { connected: true });
    
    syncInterval = setInterval(syncLoop, 1000);
});

ipcMain.on('stop-sync', async (event) => {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
    }
    
    if (lastLyricLine !== null) {
        await clearCustomStatus(activeDiscordToken);
        lastLyricLine = null;
    }
    
    currentTrackId = null;
    currentLyrics = null;
    
    logToUI("Sync stopped.", "error");
    event.sender.send('state-update', { connected: false });
});

async function syncLoop() {
    try {
        const trackInfo = getCurrentlyPlaying(); // synchronous for spicetify

        if (!trackInfo || !trackInfo.isPlaying) {
            if (lastLyricLine !== null) {
                await clearCustomStatus(activeDiscordToken);
                lastLyricLine = null;
                currentTrackId = null;
                currentLyrics = null;
                logToUI("Music paused, cleared status.", "info");
            }
            return;
        }

        if (trackInfo.id !== currentTrackId) {
            currentTrackId = trackInfo.id;
            logToUI(`Now playing: ${trackInfo.name} by ${trackInfo.artist}`, "info");
            
            currentLyrics = await fetchLyrics(trackInfo.name, trackInfo.artist, trackInfo.album, trackInfo.durationMs);
            if (!currentLyrics) {
                logToUI(`No synced lyrics found for ${trackInfo.name}`, "error");
                await clearCustomStatus(activeDiscordToken);
                lastLyricLine = null;
            } else {
                logToUI(`Found synced lyrics for ${trackInfo.name}`, "success");
            }
        }

        if (currentLyrics) {
            const timeSinceUpdate = trackInfo.lastUpdate ? (Date.now() - trackInfo.lastUpdate) : 0;
            const interpolatedProgressMs = trackInfo.progressMs + timeSinceUpdate;
            const currentLine = getCurrentLyric(currentLyrics, interpolatedProgressMs + 500);
            
            if (currentLine && currentLine !== lastLyricLine) {
                lastLyricLine = currentLine;
                await updateCustomStatus(currentLine, activeDiscordToken);
                logToUI(`Status: ${currentLine}`);
            }
        }
    } catch (error) {
        logToUI("Loop Error: " + error.message, "error");
    }
}
