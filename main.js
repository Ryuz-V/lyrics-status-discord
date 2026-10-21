require('dotenv').config();
const { app, BrowserWindow, ipcMain, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { fetchLyrics, getCurrentLyric, clearLyricsCache } = require('./lyrics');
const { updateCustomStatus, clearCustomStatus, resetStatusState } = require('./discord');
const { startWebSocketServer, getCurrentlyPlaying } = require('./spotify');
const { startSMTCListener, stopSMTCListener, getSMTCState } = require('./smtc');
const { getDiscordRPC } = require('./activitystatus');

// Helper function untuk enkripsi token Discord menggunakan OS Keychain bawaan Electron
function saveSecureToken(token) {
    if (!token) {
        store.set('encryptedDiscordToken', '');
        store.set('discordToken', '');
        return;
    }
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
        try {
            const encrypted = safeStorage.encryptString(token).toString('base64');
            store.set('encryptedDiscordToken', encrypted);
            store.set('discordToken', ''); // Hapus plaintext untuk keamanan
            return;
        } catch (e) {}
    }
    store.set('discordToken', token);
}

function getSecureToken() {
    try {
        const enc = store.get('encryptedDiscordToken', '');
        if (enc && safeStorage && safeStorage.isEncryptionAvailable()) {
            const buf = Buffer.from(enc, 'base64');
            return safeStorage.decryptString(buf);
        }
        const plain = store.get('discordToken', '');
        if (plain && safeStorage && safeStorage.isEncryptionAvailable()) {
            saveSecureToken(plain);
            return plain;
        }
        return plain || process.env.DISCORD_TOKEN || '';
    } catch (e) {
        return store.get('discordToken', '') || process.env.DISCORD_TOKEN || '';
    }
}

// Helper function untuk mendeteksi apakah track yang diputar adalah iklan Spotify Free
function isSpotifyAd(trackInfo) {
    if (!trackInfo) return false;
    const name = (trackInfo.name || '').trim().toLowerCase();
    const artist = (trackInfo.artist || '').trim().toLowerCase();
    const durationSec = trackInfo.durationMs ? (trackInfo.durationMs / 1000) : 0;

    if (artist === 'spotify' || artist === 'advertisement') return true;
    if (name.includes('advertisement') || name === 'spotify') return true;
    if (durationSec > 0 && durationSec < 35 && (artist.includes('spotify') || name.includes('spotify'))) {
        return true;
    }
    return false;
}

// Helper untuk membaca info lagu aktif sesuai pilihan sumber media
function getActiveTrackInfo() {
    const source = store.get('mediaSource', 'os_media');
    if (source === 'spicetify') {
        return getCurrentlyPlaying();
    }
    return getSMTCState();
}


// Helper function untuk update Discord RPC (Rich Presence) saat lagu diputar
function updateDiscordRPCMusic(trackInfo, lyricOrTitle, progressMs = 0) {
    const rpc = getDiscordRPC();
    if (!rpc || !rpc.connected) return;

    const startTimestamp = Math.floor((Date.now() - progressMs) / 1000);
    const endTimestamp = trackInfo.durationMs 
        ? Math.floor((Date.now() - progressMs + trackInfo.durationMs) / 1000) 
        : null;

    rpc.setActivity({
        type: 'listening',
        name: 'Spotify',
        details: (lyricOrTitle || trackInfo.name).substring(0, 128),
        state: `${trackInfo.artist}${trackInfo.album ? ' - ' + trackInfo.album : ''}`.substring(0, 128),
        timestampType: 'custom',
        customStart: startTimestamp * 1000,
        customEnd: endTimestamp ? (endTimestamp * 1000) : null,
        largeImageKey: 'spotify',
        largeImageText: (trackInfo.album || trackInfo.name).substring(0, 128),
        smallImageKey: 'play',
        smallImageText: 'Playing'
    });
}

// Helper function untuk update Discord RPC saat teks custom berotasi
function updateDiscordRPCCustom(text) {
    const rpc = getDiscordRPC();
    if (!rpc || !rpc.connected) return;

    rpc.setActivity({
        type: 'playing',
        name: text.substring(0, 128),
        details: text.substring(0, 128),
        state: 'Presync',
        timestampType: 'since_connection',
        largeImageKey: 'spotify',
        largeImageText: 'Presync'
    });
}

function clearDiscordRPC() {
    const rpc = getDiscordRPC();
    if (rpc && rpc.connected) {
        rpc.clearActivity();
    }
}


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
    mainWindow.removeMenu();
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
    const token = getSecureToken();
    const defaultAppId = extractDiscordId(token) || '1444178398372036789';
    const settings = {
        statusDisplayMode: store.get('statusDisplayMode', 'both'),
        discordToken: token,
        rpcAppId: store.get('rpcAppId', defaultAppId),
        mediaSource: store.get('mediaSource', 'os_media'),
        lyricsOffset: store.get('lyricsOffset', 0.4),
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
        if (key === 'discordToken') {
            saveSecureToken(val);
        } else if (val !== undefined) {
            store.set(key, val);
        }
    }
});

ipcMain.on('start-sync', async (event, settings) => {
    // Save settings if provided
    if (settings && typeof settings === 'object') {
        for (const [key, val] of Object.entries(settings)) {
            if (key === 'discordToken') {
                saveSecureToken(val);
            } else if (val !== undefined) {
                store.set(key, val);
            }
        }
    }

    const mode = (settings && settings.statusDisplayMode) || store.get('statusDisplayMode', 'both');
    const enableCustomStatus = mode === 'both' || mode === 'custom_status';
    const enableRPC = mode === 'both' || mode === 'rpc';

    activeDiscordToken = (settings && settings.discordToken) || getSecureToken();
    if (enableCustomStatus && !activeDiscordToken) {
        logToUI("Discord Token dibutuhkan untuk mode " + (mode === 'both' ? 'Both' : 'Custom Status') + "! Silakan masukkan token di Settings.", "error");
        event.sender.send('state-update', { connected: false });
        return;
    }

    const mediaSource = (settings && settings.mediaSource) || store.get('mediaSource', 'os_media');
    if (mediaSource === 'spicetify') {
        if (!isWebSocketStarted) {
            startWebSocketServer();
            isWebSocketStarted = true;
            logToUI("Started Spicetify WebSocket Server on port 8974", "info");
        }
    } else {
        startSMTCListener((state) => {
            if (state && syncInterval) {
                syncLoop();
            }
        });
        logToUI("OS Media Listener (Windows SMTC) aktif.", "info");
    }

    // Hubungkan Discord RPC jika mode mengaktifkan RPC
    let rpcUser = null;
    if (enableRPC) {
        const rawAppId = (settings && settings.rpcAppId) || store.get('rpcAppId');
        const appId = extractDiscordId(rawAppId) || extractDiscordId(activeDiscordToken) || '1444178398372036789';
        try {
            const rpc = getDiscordRPC();
            if (!rpc.connected && appId) {
                rpcUser = await rpc.findAndConnect(appId);
                if (rpcUser) {
                    logToUI(`Discord RPC Connected as ${rpcUser.username}`, "success");
                }
            }
        } catch (e) {
            logToUI(`Discord RPC: ${e.message}`, "info");
        }
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

    logToUI(`Connected! Status monitoring started [Mode: ${mode.toUpperCase()} | Source: ${mediaSource.toUpperCase()}].`, "success");
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
            clearDiscordRPC();
            if (syncInterval) {
                syncLoop();
            }
        }
    }
});


ipcMain.on('stop-sync', async (event) => {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
    }

    stopSMTCListener();

    if (activeDiscordToken) {
        await clearCustomStatus(activeDiscordToken);
        logToUI("Custom status cleared from Discord.", "info");
    }
    resetStatusState();

    currentTrackId = null;
    currentLyrics = null;
    lastLyricLine = null;
    activeStatusMode = null;
    currentCustomIndex = 0;
    lastRotationTime = 0;
    lastCustomTextApplied = null;

    clearDiscordRPC();
    const rpc = getDiscordRPC();
    if (rpc && rpc.connected) {
        rpc.disconnect();
    }

    logToUI("Disconnected.", "error");
    event.sender.send('state-update', { connected: false });
});

async function syncLoop() {
    try {
        const mode = store.get('statusDisplayMode', 'both');
        const enableCustomStatus = mode === 'both' || mode === 'custom_status';
        const enableRPC = mode === 'both' || mode === 'rpc';

        // Validasi kebutuhan token untuk mode custom status
        if (enableCustomStatus && !activeDiscordToken && !enableRPC) {
            return;
        }

        const isLyricEnabled = store.get('lyricStatusEnabled', false);
        const trackInfo = getActiveTrackInfo();
        const isMusicPlaying = isLyricEnabled && trackInfo && trackInfo.isPlaying;

        if (isMusicPlaying) {
            // ========================================================
            // Penanganan Iklan Spotify Free (Ad Detection)
            // ========================================================
            if (isSpotifyAd(trackInfo)) {
                const adText = "🎵 Spotify Advertisement";
                if (lastLyricLine !== adText) {
                    lastLyricLine = adText;
                    logToUI("[Iklan] Iklan Spotify terdeteksi, sinkronisasi lirik dijeda.", "info");
                    if (enableCustomStatus && activeDiscordToken) {
                        await updateCustomStatus(adText, activeDiscordToken, "📢");
                    }
                    if (enableRPC) {
                        const rpc = getDiscordRPC();
                        if (rpc && rpc.connected) {
                            rpc.setActivity({
                                type: 'listening',
                                name: 'Spotify',
                                details: 'Spotify Advertisement',
                                state: 'Ad Break',
                                largeImageKey: 'spotify',
                                largeImageText: 'Spotify'
                            });
                        }
                    }
                }
                return;
            }

            // ========================================================
            // PRIORITAS 1: Musik Sedang Berputar
            // ========================================================
            if (activeStatusMode !== 'music') {
                activeStatusMode = 'music';
                lastCustomTextApplied = null;
                logToUI(`[Priority] Music detected, prioritizing music status.`, "info");
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
                        
                        if (enableCustomStatus && activeDiscordToken) {
                            const res = await updateCustomStatus(trackDisplay, activeDiscordToken);
                            if (res && res.rateLimited) {
                                logToUI(`[Rate Limit] Menunggu ${res.retryAfter}s untuk Custom Status`, "error");
                            } else if (res && res.unauthorized) {
                                logToUI(res.message, "error");
                            }
                        }

                        if (enableRPC) {
                            updateDiscordRPCMusic(trackInfo, trackDisplay, trackInfo.progressMs || 0);
                        }

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
                
                // Terapkan lyrics offset (timing compensation) yang dapat disetel di UI
                const offsetSec = parseFloat(store.get('lyricsOffset', 0.4)) || 0.4;
                const offsetMs = Math.round(offsetSec * 1000);
                const currentLine = getCurrentLyric(currentLyrics, interpolatedProgressMs + offsetMs);

                if (currentLine && currentLine !== lastLyricLine) {
                    lastLyricLine = currentLine;

                    if (enableCustomStatus && activeDiscordToken) {
                        const res = await updateCustomStatus(currentLine, activeDiscordToken);
                        if (res && res.rateLimited) {
                            logToUI(`[Rate Limit] Dibatasi sementara (${res.retryAfter}s)`, "error");
                        } else if (res && res.unauthorized) {
                            logToUI(res.message, "error");
                        } else if (res && res.success && !res.skipped) {
                            logToUI(`Custom Status: ${currentLine}`);
                        }
                    }

                    if (enableRPC) {
                        updateDiscordRPCMusic(trackInfo, currentLine, interpolatedProgressMs);
                        if (!enableCustomStatus) {
                            logToUI(`Discord RPC: ${currentLine}`);
                        }
                    }
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
                clearDiscordRPC();
            } else if (activeStatusMode === null) {
                activeStatusMode = 'custom';
                lastRotationTime = 0;
                currentCustomIndex = 0;
                lastCustomTextApplied = null;
                clearDiscordRPC();
            }

            // Kumpulkan teks non-kosong dari Text 1, 2, 3
            const t1 = (store.get('customText1', '') || '').trim();
            const t2 = (store.get('customText2', '') || '').trim();
            const t3 = (store.get('customText3', '') || '').trim();
            const customTexts = [t1, t2, t3].filter(t => t.length > 0);

            if (customTexts.length === 0) {
                // Semua teks custom kosong
                if (lastCustomTextApplied !== null) {
                    if (enableCustomStatus && activeDiscordToken) {
                        await clearCustomStatus(activeDiscordToken);
                    }
                    if (enableRPC) {
                        clearDiscordRPC();
                    }
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

                if (enableCustomStatus && activeDiscordToken) {
                    const res = await updateCustomStatus(targetText, activeDiscordToken);
                    if (res && res.rateLimited) {
                        logToUI(`[Rate Limit] Menunggu ${res.retryAfter}s untuk Custom Status`, "error");
                    }
                }

                if (enableRPC) {
                    updateDiscordRPCCustom(targetText);
                }

                logToUI(`[Custom Status (${(currentCustomIndex % customTexts.length) + 1}/${customTexts.length})]: ${targetText}`, "success");
            }
        }
    } catch (error) {
        logToUI("Loop Error: " + error.message, "error");
    }
}
