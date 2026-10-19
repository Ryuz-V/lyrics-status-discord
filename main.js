require('dotenv').config();
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { fetchLyrics, getCurrentLyric } = require('./lyrics');
const { updateCustomStatus, clearCustomStatus } = require('./discord');
const { startWebSocketServer, getCurrentlyPlaying } = require('./spotify');
const { getDiscordRPC } = require('./activitystatus');

function extractDiscordId(tokenOrId) {
    if (!tokenOrId) return '';
    tokenOrId = tokenOrId.toString().trim();
    if (tokenOrId.includes('.')) {
        try {
            const first = tokenOrId.split('.')[0];
            const decoded = Buffer.from(first, 'base64').toString('utf8');
            if (/^\d+$/.test(decoded)) {
                return decoded;
            }
        } catch (e) {}
    }
    return tokenOrId;
}

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
let activeDiscordToken = null;
let currentTrackId = null;
let currentLyrics = null;
let lastLyricLine = null;

// Custom status rotation state
let activeStatusMode = null; // 'music' | 'custom' | null
let currentCustomIndex = 0;
let lastRotationTime = 0;
let lastCustomTextApplied = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 520,
        height: 700,
        minWidth: 460,
        minHeight: 450,
        title: "Presync 1.0.0",
        backgroundColor: '#2b2d31',
        resizable: false,
        minimizable: false,
        maximizable: false,
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
    const rpc = getDiscordRPC();
    if (rpc && rpc.connected) {
        rpc.disconnect();
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC Handlers
ipcMain.on('request-settings', (event) => {
    const token = store.get('discordToken', '') || process.env.DISCORD_TOKEN || '';
    const defaultAppId = extractDiscordId(token) || '1444178398372036789';
    const settings = {
        discordToken: token,
        rpcAppId: store.get('rpcAppId', defaultAppId),
        customText1: store.get('customText1', ''),
        customText2: store.get('customText2', ''),
        customText3: store.get('customText3', ''),
        customTime: store.get('customTime', '0'),
        lyricStatusEnabled: store.get('lyricStatusEnabled', false)
    };
    event.sender.send('load-settings', settings);
});

ipcMain.on('save-settings', (event, settings) => {
    if (!settings || typeof settings !== 'object') return;
    for (const [key, val] of Object.entries(settings)) {
        if (val !== undefined) {
            store.set(key, val);
        }
    }
});

ipcMain.on('start-sync', async (event, settings) => {
    // Save settings if provided
    if (settings && typeof settings === 'object') {
        for (const [key, val] of Object.entries(settings)) {
            if (val !== undefined) {
                store.set(key, val);
            }
        }
    }

    activeDiscordToken = (settings && settings.discordToken) || store.get('discordToken') || process.env.DISCORD_TOKEN;
    if (!activeDiscordToken) {
        logToUI("Missing Discord Token! Please enter your token in Settings.", "error");
        event.sender.send('state-update', { connected: false });
        return;
    }

    // Start WebSocket server for Spicetify if not already running
    if (!isWebSocketStarted) {
        startWebSocketServer();
        isWebSocketStarted = true;
        logToUI("Started Spicetify WebSocket Server on port 8974", "info");
    }

    // Try optional Discord RPC Desktop connection
    const rawAppId = (settings && settings.rpcAppId) || store.get('rpcAppId');
    const appId = extractDiscordId(rawAppId) || extractDiscordId(activeDiscordToken) || '1444178398372036789';
    let rpcUser = null;
    try {
        const rpc = getDiscordRPC();
        if (!rpc.connected && appId) {
            rpcUser = await rpc.findAndConnect(appId);
            if (rpcUser) {
                logToUI(`Discord RPC Connected as ${rpcUser.username}`, "success");
            }
        }
    } catch (e) {
        // Desktop RPC is optional, ignore failure
    }

    // Reset loop variables
    if (syncInterval) clearInterval(syncInterval);
    currentTrackId = null;
    currentLyrics = null;
    lastLyricLine = null;
    activeStatusMode = null;
    currentCustomIndex = 0;
    lastRotationTime = 0;
    lastCustomTextApplied = null;

    logToUI("Connected! Status monitoring started.", "success");
    syncInterval = setInterval(syncLoop, 1000);

    // Run first tick immediately
    syncLoop();

    event.sender.send('state-update', {
        connected: true,
        user: rpcUser ? rpcUser.username : null
    });
});

ipcMain.on('toggle-lyric-status', async (event, { enabled }) => {
    store.set('lyricStatusEnabled', enabled);

    if (enabled) {
        logToUI("Lyric Status enabled: Spotify music will be prioritized when playing.", "info");
        if (!isWebSocketStarted) {
            startWebSocketServer();
            isWebSocketStarted = true;
            logToUI("Started Spicetify WebSocket Server on port 8974", "info");
        }
    } else {
        logToUI("Lyric Status disabled: Using Custom Status texts.", "info");
        if (activeStatusMode === 'music') {
            activeStatusMode = null;
            lastLyricLine = null;
            currentTrackId = null;
            currentLyrics = null;
            lastRotationTime = 0;
            lastCustomTextApplied = null;
            if (syncInterval) {
                syncLoop();
            }
        }
    }
});

ipcMain.on('update-presence', async (event, settings) => {
    if (settings && typeof settings === 'object') {
        for (const [key, val] of Object.entries(settings)) {
            if (val !== undefined) {
                store.set(key, val);
            }
        }
    }

    if (!syncInterval) {
        logToUI("Settings saved. (Click Connect to activate status)", "info");
        return;
    }

    // If currently on custom status, immediately trigger update
    const isLyricEnabled = store.get('lyricStatusEnabled', false);
    const trackInfo = getCurrentlyPlaying();
    const isMusicPlaying = isLyricEnabled && trackInfo && trackInfo.isPlaying;

    if (!isMusicPlaying) {
        lastRotationTime = 0;
        lastCustomTextApplied = null;
        logToUI("Custom Status refreshed!", "success");
        syncLoop();
    } else {
        logToUI("Settings saved. Currently playing Spotify music.", "info");
    }
});

ipcMain.on('stop-sync', async (event) => {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
    }

    if (activeDiscordToken) {
        await clearCustomStatus(activeDiscordToken);
        logToUI("Custom status cleared from Discord.", "info");
    }

    currentTrackId = null;
    currentLyrics = null;
    lastLyricLine = null;
    activeStatusMode = null;
    currentCustomIndex = 0;
    lastRotationTime = 0;
    lastCustomTextApplied = null;

    const rpc = getDiscordRPC();
    if (rpc && rpc.connected) {
        rpc.disconnect();
    }

    logToUI("Disconnected.", "error");
    event.sender.send('state-update', { connected: false });
});

async function syncLoop() {
    try {
        if (!activeDiscordToken) return;

        const isLyricEnabled = store.get('lyricStatusEnabled', false);
        const trackInfo = getCurrentlyPlaying();
        const isMusicPlaying = isLyricEnabled && trackInfo && trackInfo.isPlaying;

        if (isMusicPlaying) {
            // ========================================================
            // PRIORITAS 1: Musik Spotify Sedang Berputar
            // ========================================================
            if (activeStatusMode !== 'music') {
                activeStatusMode = 'music';
                lastCustomTextApplied = null;
                logToUI(`[Priority] Spotify music detected, prioritizing music status.`, "info");
            }

            // Cek apakah lagu berubah
            if (trackInfo.id !== currentTrackId) {
                currentTrackId = trackInfo.id;
                lastLyricLine = null;
                logToUI(`Now playing: ${trackInfo.name} by ${trackInfo.artist}`, "info");

                currentLyrics = await fetchLyrics(trackInfo.name, trackInfo.artist, trackInfo.album, trackInfo.durationMs);
                if (!currentLyrics) {
                    logToUI(`No synced lyrics found for "${trackInfo.name}". Showing track name.`, "info");
                    const trackDisplay = `🎵 ${trackInfo.name} - ${trackInfo.artist}`;
                    if (trackDisplay !== lastLyricLine) {
                        lastLyricLine = trackDisplay;
                        await updateCustomStatus(trackDisplay, activeDiscordToken);
                        logToUI(`Status: ${trackDisplay}`);
                    }
                } else {
                    logToUI(`Found synced lyrics for "${trackInfo.name}"`, "success");
                }
            }

            // Update lirik jika lirik tersedia
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
        } else {
            // ========================================================
            // PRIORITAS 2: Musik Berhenti / Dijeda (Custom Status Text)
            // ========================================================
            if (activeStatusMode === 'music') {
                logToUI("Music paused/stopped. Switching to Custom Status texts...", "info");
                currentTrackId = null;
                currentLyrics = null;
                lastLyricLine = null;
                activeStatusMode = 'custom';
                lastRotationTime = 0; // Langsung tampilkan teks tanpa tunggu rotasi
                currentCustomIndex = 0;
                lastCustomTextApplied = null;
            } else if (activeStatusMode === null) {
                activeStatusMode = 'custom';
                lastRotationTime = 0;
                currentCustomIndex = 0;
                lastCustomTextApplied = null;
            }

            // Kumpulkan teks non-kosong dari Text 1, 2, 3
            const t1 = (store.get('customText1', '') || '').trim();
            const t2 = (store.get('customText2', '') || '').trim();
            const t3 = (store.get('customText3', '') || '').trim();
            const customTexts = [t1, t2, t3].filter(t => t.length > 0);

            if (customTexts.length === 0) {
                // Semua teks custom kosong
                if (lastCustomTextApplied !== null) {
                    await clearCustomStatus(activeDiscordToken);
                    lastCustomTextApplied = null;
                    logToUI("No custom text provided, status cleared.", "info");
                }
                return;
            }

            // Hitung interval rotasi berdasarkan Time Changed (1 = 10 detik)
            const rawTime = parseInt(store.get('customTime', '0'), 10);
            const timeMultiplier = (!isNaN(rawTime) && rawTime > 0) ? rawTime : 1;
            const rotationIntervalMs = timeMultiplier * 10 * 1000;

            const now = Date.now();
            let shouldUpdate = false;

            if (lastRotationTime === 0 || lastCustomTextApplied === null) {
                // Pertama kali aktif atau baru beralih dari musik
                currentCustomIndex = 0;
                lastRotationTime = now;
                shouldUpdate = true;
            } else if (customTexts.length > 1 && (now - lastRotationTime) >= rotationIntervalMs) {
                // Waktunya rotasi ke teks berikutnya
                currentCustomIndex = (currentCustomIndex + 1) % customTexts.length;
                lastRotationTime = now;
                shouldUpdate = true;
            }

            const targetText = customTexts[currentCustomIndex % customTexts.length];

            // Kirim ke Discord jika rotasi terjadi atau teks berbeda dari yang sedang aktif
            if (shouldUpdate || targetText !== lastCustomTextApplied) {
                lastCustomTextApplied = targetText;
                await updateCustomStatus(targetText, activeDiscordToken);
                logToUI(`[Custom Status (${(currentCustomIndex % customTexts.length) + 1}/${customTexts.length})]: ${targetText}`, "success");
            }
        }
    } catch (error) {
        logToUI("Loop Error: " + error.message, "error");
    }
}
