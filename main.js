require('dotenv').config();
const { app, BrowserWindow, ipcMain, shell, safeStorage, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { fetchLyrics, getCurrentLyric, clearLyricsCache } = require('./lyrics');
const { updateCustomStatus, clearCustomStatus, resetStatusState } = require('./discord');
const { startWebSocketServer, getCurrentlyPlaying } = require('./spotify');
const { startSMTCListener, stopSMTCListener, getSMTCState } = require('./smtc');

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
            store.set('discordToken', '');
            return;
        } catch (e) { }
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
        } catch (e) { }
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
        } catch (e) { }
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

let tray = null;
let isQuitting = false;

function getTrayIcon() {
    const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="7" fill="#5865F2" />
        <path d="M6 4.5v5.2a1.8 1.8 0 1 0 1.2 1.7V6.5l3.5-.8v2.5a1.8 1.8 0 1 0 1.2 1.7V4l-5.9 1.2z" fill="#FFFFFF" />
    </svg>`;
    return nativeImage.createFromBuffer(Buffer.from(iconSvg));
}

function updateTrayMenu() {
    if (!tray) return;
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Open Presync',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);
    tray.setContextMenu(contextMenu);
}

function setupTray() {
    if (tray) return;
    try {
        const icon = getTrayIcon();
        tray = new Tray(icon);
        tray.setToolTip('Presync - Discord Lyrics Sync');
        updateTrayMenu();

        tray.on('click', () => {
            if (mainWindow) {
                if (mainWindow.isVisible()) {
                    if (!mainWindow.isFocused()) {
                        mainWindow.focus();
                    } else {
                        mainWindow.hide();
                    }
                } else {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        });

        tray.on('double-click', () => {
            if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
            }
        });
    } catch (e) {
        console.error("Tray error:", e);
    }
}

function destroyTray() {
    if (tray) {
        tray.destroy();
        tray = null;
    }
}

function updateAutoLaunch(enabled) {
    try {
        app.setLoginItemSettings({
            openAtLogin: !!enabled,
            openAsHidden: false
        });
    } catch (e) { }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 520,
        height: 750,
        minWidth: 460,
        minHeight: 500,
        title: "Presync 1.0.0",
        backgroundColor: '#2b2d31',
        resizable: true,
        minimizable: true,
        maximizable: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.setMenuBarVisibility(false);
    mainWindow.removeMenu();
    mainWindow.loadFile('index.html');

    mainWindow.on('close', (event) => {
        const runBg = store.get('runInBackground', false);
        if (!isQuitting && runBg) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
}

function logToUI(message, type = 'default') {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('log', { message, type });
    }
}

app.whenReady().then(() => {
    createWindow();

    const runBg = store.get('runInBackground', false);
    if (runBg) {
        setupTray();
        updateAutoLaunch(true);
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        } else if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
});

app.on('before-quit', () => {
    isQuitting = true;
});

app.on('window-all-closed', () => {
    const runBg = store.get('runInBackground', false);
    if (!runBg && process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC Handlers
ipcMain.on('request-settings', (event) => {
    const token = getSecureToken();
    const settings = {
        discordToken: token,
        runInBackground: store.get('runInBackground', false),
        mediaSource: store.get('mediaSource', 'os_media'),
        lyricsOffset: store.get('lyricsOffset', 0.4),
        customText1: store.get('customText1', ''),
        customText2: store.get('customText2', ''),
        customText3: store.get('customText3', ''),
        customTime: store.get('customTime', '0'),
        lyricStatusEnabled: store.get('lyricStatusEnabled', true)
    };
    event.sender.send('load-settings', settings);
});

ipcMain.on('save-settings', (event, settings) => {
    if (!settings || typeof settings !== 'object') return;
    const oldSource = store.get('mediaSource', 'os_media');
    for (const [key, val] of Object.entries(settings)) {
        if (key === 'discordToken') {
            saveSecureToken(val);
        } else if (val !== undefined) {
            store.set(key, val);
        }
    }

    if (syncInterval && settings.mediaSource && settings.mediaSource !== oldSource) {
        if (settings.mediaSource === 'spicetify') {
            stopSMTCListener();
            if (!isWebSocketStarted) {
                startWebSocketServer();
                isWebSocketStarted = true;
            }
            logToUI("Beralih ke Spicetify WebSocket.", "info");
        } else {
            startSMTCListener((state) => {
                if (state && syncInterval) {
                    syncLoop();
                }
            }, (msg, type) => {
                logToUI(msg, type);
            });
            logToUI("Beralih ke OS Media Listener (SMTC).", "info");
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

    activeDiscordToken = (settings && settings.discordToken) || getSecureToken();
    if (!activeDiscordToken) {
        logToUI("Discord Token dibutuhkan! Silakan masukkan token di Settings.", "error");
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
        }, (msg, type) => {
            logToUI(msg, type);
        });
        logToUI("OS Media Listener (Windows SMTC) aktif.", "info");
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

    logToUI(`Connected! Status monitoring started [Source: ${mediaSource.toUpperCase()}].`, "success");
    syncInterval = setInterval(syncLoop, 1000);

    // Run first tick immediately
    syncLoop();

    event.sender.send('state-update', {
        connected: true,
        user: null
    });
});

ipcMain.on('toggle-lyric-status', async (event, { enabled }) => {
    store.set('lyricStatusEnabled', enabled);

    if (enabled) {
        logToUI("Lyric Status enabled: Spotify music will be prioritized when playing.", "info");
        const mediaSource = store.get('mediaSource', 'os_media');
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
            }, (msg, type) => {
                logToUI(msg, type);
            });
            logToUI("OS Media Listener (Windows SMTC) aktif.", "info");
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

ipcMain.on('toggle-background-mode', (event, { enabled }) => {
    store.set('runInBackground', !!enabled);
    updateAutoLaunch(!!enabled);
    if (enabled) {
        setupTray();
        logToUI("Run in background aktif. Aplikasi akan bersembunyi di System Tray saat ditutup.", "info");
    } else {
        destroyTray();
        logToUI("Run in background nonaktif. Aplikasi akan keluar saat jendela ditutup.", "info");
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

    logToUI("Disconnected.", "error");
    event.sender.send('state-update', { connected: false });
});

// Helper function untuk rotasi teks Custom Status (Text 1, 2, 3)
async function applyCustomStatusRotation(forceImmediate = false) {
    // Kumpulkan teks non-kosong dari Text 1, 2, 3
    const t1 = (store.get('customText1', '') || '').trim();
    const t2 = (store.get('customText2', '') || '').trim();
    const t3 = (store.get('customText3', '') || '').trim();
    const customTexts = [t1, t2, t3].filter(t => t.length > 0);

    if (customTexts.length === 0) {
        // Semua teks custom kosong -> pastikan status di Discord dibersihkan
        const res = await clearCustomStatus(activeDiscordToken);
        if (res && res.success && !res.skipped) {
            logToUI("No custom text provided, status cleared.", "info");
        }
        lastCustomTextApplied = null;
        return;
    }

    // Hitung interval rotasi berdasarkan Time Changed (1 = 10 detik)
    const rawTime = parseInt(store.get('customTime', '0'), 10);
    const timeMultiplier = (!isNaN(rawTime) && rawTime > 0) ? rawTime : 1;
    const rotationIntervalMs = timeMultiplier * 10 * 1000;

    const now = Date.now();
    let shouldUpdate = false;

    if (forceImmediate || lastRotationTime === 0 || lastCustomTextApplied === null) {
        // Pertama kali aktif atau baru beralih dari musik / pergantian lagu
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

        const res = await updateCustomStatus(targetText, activeDiscordToken);
        if (res && res.rateLimited) {
            logToUI(`[Rate Limit] Menunggu ${res.retryAfter}s untuk Custom Status`, "error");
        } else if (res && res.success && !res.skipped) {
            logToUI(`[Custom Status (${(currentCustomIndex % customTexts.length) + 1}/${customTexts.length})]: ${targetText}`, "success");
        }
    }
}

// Helper untuk segera membersihkan lirik lagu sebelumnya dan beralih ke Custom Text (jika ada) atau Kosongkan status
async function clearLyricAndApplyFallback(reason = '') {
    lastLyricLine = null;
    lastCustomTextApplied = null;

    const t1 = (store.get('customText1', '') || '').trim();
    const t2 = (store.get('customText2', '') || '').trim();
    const t3 = (store.get('customText3', '') || '').trim();
    const customTexts = [t1, t2, t3].filter(t => t.length > 0);

    if (customTexts.length > 0) {
        await applyCustomStatusRotation(true);
    } else {
        const res = await clearCustomStatus(activeDiscordToken);
        if (res && res.success && !res.skipped) {
            logToUI("Status lirik dibersihkan dari Discord.", "info");
        }
    }
}

async function syncLoop() {
    try {
        if (!activeDiscordToken) {
            return;
        }

        const isLyricEnabled = store.get('lyricStatusEnabled', true);
        const trackInfo = getActiveTrackInfo();
        const isMusicPlaying = isLyricEnabled && trackInfo && trackInfo.isPlaying;

        if (isMusicPlaying) {
            // ========================================================
            // Penanganan Iklan Spotify Free (Ad Detection)
            // ========================================================
            if (isSpotifyAd(trackInfo)) {
                const adText = "Spotify Advertisement";
                if (lastLyricLine !== adText) {
                    lastLyricLine = adText;
                    console.log("[Iklan] Iklan Spotify terdeteksi, sinkronisasi lirik dijeda.");
                    logToUI("[Iklan] Iklan Spotify terdeteksi, sinkronisasi lirik dijeda.", "info");
                    await updateCustomStatus(adText, activeDiscordToken);
                }
                return;
            }

            // Cek apakah lagu berubah
            const trackId = trackInfo.id || `${trackInfo.artist || ''}___${trackInfo.name || ''}`;
            if (trackId !== currentTrackId) {
                currentTrackId = trackId;
                lastLyricLine = null;
                currentLyrics = null;
                console.log(`[Music] Now playing: ${trackInfo.name} by ${trackInfo.artist}`);
                logToUI(`Now playing: ${trackInfo.name} by ${trackInfo.artist}`, "info");

                // LANGSUNG hapus lirik lagu sebelumnya dan terapkan Custom Text (jika ada) atau kosongkan status
                await clearLyricAndApplyFallback("Track changed");

                try {
                    currentLyrics = await fetchLyrics(trackInfo.name, trackInfo.artist, trackInfo.album, trackInfo.durationMs);
                } catch (err) {
                    currentLyrics = null;
                    console.error(`[Lyrics Error] Gagal mengambil lirik: ${err.message}`);
                    logToUI(`[Lyrics Error] Gagal mengambil lirik: ${err.message}`, "error");
                }

                if (!currentLyrics) {
                    console.log(`[Lyrics] Lirik tidak ditemukan untuk "${trackInfo.name}" (${trackInfo.artist}). Status beralih ke Custom Text / Kosong.`);
                    logToUI(`[Lyrics] Lirik tidak ditemukan untuk "${trackInfo.name}".`, "info");
                    await clearLyricAndApplyFallback("Lyrics not found");
                } else {
                    console.log(`[Lyrics] Ditemukan lirik sinkronisasi untuk "${trackInfo.name}"`);
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

                if (currentLine) {
                    activeStatusMode = 'music';
                    lastCustomTextApplied = null;

                    if (currentLine !== lastLyricLine) {
                        const res = await updateCustomStatus(currentLine, activeDiscordToken);
                        if (res && res.rateLimited) {
                            console.warn(`[Rate Limit] Dibatasi sementara (${res.retryAfter}s)`);
                            logToUI(`[Rate Limit] Dibatasi sementara (${res.retryAfter}s)`, "error");
                        } else if (res && res.unauthorized) {
                            console.error(`[Discord Error] ${res.message}`);
                            logToUI(res.message, "error");
                        } else if (res && res.success) {
                            lastLyricLine = currentLine;
                            if (!res.skipped) {
                                logToUI(`Custom Status: ${currentLine}`);
                            }
                        }
                    }
                } else {
                    // Intro atau jeda instrumental (belum/tidak ada lirik di detik saat ini)
                    // Hapus lirik lama dan tampilkan Custom Text (jika ada) atau kosongkan status
                    if (lastLyricLine !== null || activeStatusMode === 'music') {
                        activeStatusMode = 'intro_or_custom';
                        await clearLyricAndApplyFallback("Intro / Instrumental break");
                    } else if (activeStatusMode === 'intro_or_custom') {
                        await applyCustomStatusRotation();
                    }
                }
            } else {
                // Musik berputar tetapi lirik tidak ada / tidak ditemukan
                if (lastLyricLine !== null || activeStatusMode === 'music') {
                    activeStatusMode = 'no_lyrics';
                    await clearLyricAndApplyFallback("No lyrics");
                } else {
                    await applyCustomStatusRotation();
                }
            }
        } else {
            // ========================================================
            // PRIORITAS 2: Musik Berhenti / Dijeda (Custom Status Text)
            // ========================================================
            if (currentTrackId !== null) {
                currentTrackId = null;
                currentLyrics = null;
                lastLyricLine = null;
                if (activeStatusMode === 'music') {
                    console.log("[Music] Musik berhenti/dijeda. Beralih ke rotasi Custom Status Text.");
                    logToUI("Music paused/stopped. Switching to Custom Status texts...", "info");
                }
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

            await applyCustomStatusRotation();
        }
    } catch (error) {
        console.error("[Loop Error]:", error);
        logToUI("Loop Error: " + error.message, "error");
    }
}
