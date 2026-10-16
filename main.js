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
let currentTrackId = null;
let currentLyrics = null;
let lastLyricLine = null;
let activeDiscordToken = null;

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
    if (rpc.connected) {
        rpc.disconnect();
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

function getSavedRpcOptions() {
    const token = store.get('discordToken', '') || process.env.DISCORD_TOKEN || '';
    const tokenExtractedId = extractDiscordId(token);
    const defaultAppId = tokenExtractedId || '1444178398372036789';
    const rawAppId = store.get('rpcAppId');
    const finalAppId = rawAppId ? extractDiscordId(rawAppId) : defaultAppId;

    return {
        appId: finalAppId || defaultAppId,
        type: store.get('rpcType', 'listening'),
        display: store.get('rpcDisplay', 'name'),
        name: store.get('rpcName', 'Print("Hello World")'),
        details: store.get('rpcDetails', ''),
        detailsUrl: store.get('rpcDetailsUrl', ''),
        state: store.get('rpcState', ''),
        stateUrl: store.get('rpcStateUrl', ''),
        partyCurrent: store.get('rpcPartyCur', '0'),
        partyMax: store.get('rpcPartyMax', '0'),
        timestampType: store.get('rpcTimestampType', 'local_time'),
        customStart: store.get('rpcCustomStart', ''),
        customEnd: store.get('rpcCustomEnd', ''),
        largeImageKey: store.get('rpcLargeImageKey', 'https://media.tenor.com/f3bU7-6jBvYAAAAC/anime-girl-typing.gif'),
        largeImageText: store.get('rpcLargeImageText', ''),
        largeImageUrl: store.get('rpcLargeImageUrl', ''),
        smallImageKey: store.get('rpcSmallImageKey', ''),
        smallImageText: store.get('rpcSmallImageText', ''),
        smallImageUrl: store.get('rpcSmallImageUrl', ''),
        button1Text: store.get('rpcButton1Text', 'Github'),
        button1Url: store.get('rpcButton1Url', 'https://github.com/Ryuz-V'),
        button2Text: store.get('rpcButton2Text', 'Store'),
        button2Url: store.get('rpcButton2Url', '')
    };
}

// IPC Handlers
ipcMain.on('request-settings', (event) => {
    const token = store.get('discordToken', '') || process.env.DISCORD_TOKEN || '';
    const defaultAppId = extractDiscordId(token) || '1444178398372036789';
    const rpcOpts = getSavedRpcOptions();
    if (!rpcOpts.appId || rpcOpts.appId === '1444178398372036789') {
        rpcOpts.appId = defaultAppId;
    }
    const settings = {
        discordToken: token,
        lyricStatusEnabled: store.get('lyricStatusEnabled', false),
        customRpEnabled: store.get('customRpEnabled', true),
        ...rpcOpts
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

ipcMain.on('start-sync', async (event, rpcOptions) => {
    const customRpEnabled = store.get('customRpEnabled', true);
    const lyricStatusEnabled = store.get('lyricStatusEnabled', false);

    let hasStartedAny = false;
    let rpcUser = null;

    // 1. Handle Custom RP
    if (customRpEnabled) {
        const rawAppId = (rpcOptions && rpcOptions.appId) ? rpcOptions.appId : store.get('rpcAppId');
        const token = store.get('discordToken', '') || process.env.DISCORD_TOKEN || '';
        const appId = extractDiscordId(rawAppId) || extractDiscordId(token) || '1444178398372036789';
        
        if (!appId) {
            logToUI("Custom RP: Missing Application / Discord ID!", "error");
        } else {
            try {
                logToUI("Connecting to Discord RPC...", "info");
                const rpc = getDiscordRPC();
                rpcUser = await rpc.findAndConnect(appId);
                const username = rpcUser ? rpcUser.username : 'Discord User';
                logToUI(`Discord RPC Connected as ${username}`, "success");

                const activityOptions = rpcOptions || getSavedRpcOptions();
                rpc.setActivity(activityOptions);
                logToUI(`Custom RP Activity set: ${activityOptions.type || 'Listening'} ${activityOptions.name || ''}`, "info");
                hasStartedAny = true;
            } catch (err) {
                logToUI(`Custom RP Error: ${err.message}`, "error");
            }
        }
    }

    // 2. Handle Lyric Status
    if (lyricStatusEnabled) {
        activeDiscordToken = store.get('discordToken') || process.env.DISCORD_TOKEN;
        if (!activeDiscordToken) {
            logToUI("Lyric Status: Missing Discord Token!", "error");
        } else {
            if (!isWebSocketStarted) {
                startWebSocketServer();
                isWebSocketStarted = true;
                logToUI("Started Spicetify WebSocket Server on port 8974", "info");
            }

            if (syncInterval) clearInterval(syncInterval);
            logToUI("Starting Spotify-Discord Lyrics Sync...", "info");
            syncInterval = setInterval(syncLoop, 1000);
            hasStartedAny = true;
        }
    }

    if (hasStartedAny) {
        event.sender.send('state-update', {
            connected: true,
            user: rpcUser ? rpcUser.username : null
        });
    } else {
        event.sender.send('state-update', { connected: false });
    }
});

ipcMain.on('toggle-custom-rp', async (event, { enabled, rpcOptions }) => {
    store.set('customRpEnabled', enabled);
    const rpc = getDiscordRPC();

    if (enabled) {
        logToUI("Turning ON Custom RP...", "info");
        const rawAppId = (rpcOptions && rpcOptions.appId) ? rpcOptions.appId : store.get('rpcAppId');
        const token = store.get('discordToken', '') || process.env.DISCORD_TOKEN || '';
        const appId = extractDiscordId(rawAppId) || extractDiscordId(token) || '1444178398372036789';

        try {
            if (!rpc.connected) {
                const rpcUser = await rpc.findAndConnect(appId);
                const username = rpcUser ? rpcUser.username : 'Discord User';
                logToUI(`Discord RPC Connected as ${username}`, "success");
            }
            const activityOptions = rpcOptions || getSavedRpcOptions();
            rpc.setActivity(activityOptions);
            logToUI(`Custom RP Activity set: ${activityOptions.type || 'Listening'} ${activityOptions.name || ''}`, "success");

            event.sender.send('state-update', {
                connected: true,
                user: rpc.currentUser ? rpc.currentUser.username : null
            });
        } catch (err) {
            logToUI(`Custom RP Error: ${err.message}`, "error");
        }
    } else {
        logToUI("Turning OFF Custom RP...", "info");
        if (rpc.connected) {
            rpc.clearActivity();
            rpc.disconnect();
            logToUI("Custom RP disabled and activity cleared.", "info");
        }
        const lyricEnabled = store.get('lyricStatusEnabled', false);
        if (!lyricEnabled || !syncInterval) {
            event.sender.send('state-update', { connected: false });
        }
    }
});

ipcMain.on('toggle-lyric-status', async (event, { enabled }) => {
    store.set('lyricStatusEnabled', enabled);

    if (enabled) {
        logToUI("Turning ON Lyric Status...", "info");
        activeDiscordToken = store.get('discordToken') || process.env.DISCORD_TOKEN;
        if (!activeDiscordToken) {
            logToUI("Lyric Status: Missing Discord Token!", "error");
            return;
        }

        if (!isWebSocketStarted) {
            startWebSocketServer();
            isWebSocketStarted = true;
            logToUI("Started Spicetify WebSocket Server on port 8974", "info");
        }

        if (syncInterval) clearInterval(syncInterval);
        logToUI("Starting Spotify-Discord Lyrics Sync...", "info");
        syncInterval = setInterval(syncLoop, 1000);

        event.sender.send('state-update', { connected: true });
    } else {
        logToUI("Turning OFF Lyric Status...", "info");
        if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = null;
        }
        activeDiscordToken = store.get('discordToken') || process.env.DISCORD_TOKEN;
        if (activeDiscordToken && lastLyricLine !== null) {
            await clearCustomStatus(activeDiscordToken);
            lastLyricLine = null;
            logToUI("Cleared Discord custom status.", "info");
        }
        const rpc = getDiscordRPC();
        const rpcEnabled = store.get('customRpEnabled', false);
        if (!rpcEnabled || !rpc.connected) {
            event.sender.send('state-update', { connected: false });
        }
    }
});

ipcMain.on('update-presence', async (event, rpcOptions) => {
    const rpc = getDiscordRPC();
    const rawAppId = (rpcOptions && rpcOptions.appId) ? rpcOptions.appId : store.get('rpcAppId');
    const token = store.get('discordToken', '') || process.env.DISCORD_TOKEN || '';
    const appId = extractDiscordId(rawAppId) || extractDiscordId(token) || '1444178398372036789';

    if (!rpc.connected) {
        try {
            await rpc.findAndConnect(appId);
        } catch (e) {}
    }

    if (rpc.connected) {
        const activityOptions = rpcOptions || getSavedRpcOptions();
        rpc.setActivity(activityOptions);
        logToUI("Custom RP Presence updated!", "success");
    } else {
        logToUI("Custom RP is not connected.", "error");
    }
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

    const rpc = getDiscordRPC();
    if (rpc.connected) {
        rpc.disconnect();
    }

    logToUI("Disconnected.", "error");
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
