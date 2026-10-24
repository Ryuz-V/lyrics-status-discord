const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');
const fs = require('fs');

let smtcProcess = null;
let currentPlaybackState = null;
let updateCallback = null;
let logCallback = null;
let shouldKeepRunning = false;

function findSmtcExe() {
    const candidates = [
        path.join(__dirname, 'bin', 'smtc-reader.exe'),
        __dirname.includes('app.asar') ? path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'bin', 'smtc-reader.exe') : null,
        process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'bin', 'smtc-reader.exe') : null,
        process.resourcesPath ? path.join(process.resourcesPath, 'bin', 'smtc-reader.exe') : null,
        path.join(process.cwd(), 'bin', 'smtc-reader.exe'),
        path.join(process.cwd(), 'resources', 'app.asar.unpacked', 'bin', 'smtc-reader.exe')
    ].filter(Boolean);

    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) {
                return p;
            }
        } catch (e) { }
    }
    return candidates[0];
}

function startSMTCListener(onUpdate, onLog) {
    if (smtcProcess) return;

    updateCallback = onUpdate || null;
    logCallback = onLog || null;
    shouldKeepRunning = true;

    const exePath = findSmtcExe();

    if (!fs.existsSync(exePath)) {
        console.error('[SMTC] smtc-reader.exe tidak ditemukan di:', exePath);
        if (logCallback) {
            logCallback(`[SMTC Error] smtc-reader.exe tidak ditemukan di: ${exePath}`, 'error');
        }
        return;
    }

    try {
        smtcProcess = spawn(exePath, [], {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        const rl = readline.createInterface({
            input: smtcProcess.stdout,
            terminal: false
        });

        rl.on('line', (line) => {
            if (!line || !line.trim()) return;
            try {
                const data = JSON.parse(line.trim());
                if (data.status === 'Closed' || !data.title) {
                    currentPlaybackState = null;
                    if (updateCallback) updateCallback(null);
                    return;
                }

                let title = (data.title || '').trim();
                let artist = (data.artist || '').trim();

                // Fallback jika artist kosong atau berlabel browser dan title memiliki format "Artis - Judul" atau "Judul - Artis"
                if ((!artist || artist.toLowerCase().includes('chrome') || artist.toLowerCase().includes('edge') || artist.toLowerCase().includes('browser')) && title.includes(' - ')) {
                    const parts = title.split(' - ');
                    if (parts.length >= 2) {
                        title = parts[0].trim();
                        artist = parts[1].trim();
                    }
                }

                currentPlaybackState = {
                    id: `${artist}___${title}`,
                    name: title,
                    artist: artist,
                    album: data.album || '',
                    durationMs: Math.round((data.durationSec || 0) * 1000),
                    progressMs: Math.round((data.positionSec || 0) * 1000),
                    isPlaying: data.status === 'Playing',
                    appId: data.appId || '',
                    lastUpdate: Date.now()
                };

                if (updateCallback) {
                    updateCallback(currentPlaybackState);
                }
            } catch (err) {
                // Ignore parse errors on partial output
            }
        });

        smtcProcess.stderr.on('data', (data) => {
            const errStr = data.toString().trim();
            if (errStr) {
                console.error('[SMTC Stderr]:', errStr);
                if (logCallback) {
                    logCallback(`[SMTC] ${errStr}`, 'error');
                }
            }
        });

        smtcProcess.on('exit', (code) => {
            smtcProcess = null;
            if (code !== 0 && code !== null) {
                console.error(`[SMTC] smtc-reader.exe berhenti dengan kode keluar ${code}`);
                if (logCallback) {
                    logCallback(`[SMTC] smtc-reader.exe berhenti dengan kode keluar ${code}`, 'error');
                }
            }
            if (shouldKeepRunning) {
                setTimeout(() => {
                    if (shouldKeepRunning && !smtcProcess) {
                        startSMTCListener(updateCallback, logCallback);
                    }
                }, 2000);
            }
        });

        smtcProcess.on('error', (err) => {
            console.error('[SMTC] Process error:', err);
            if (logCallback) {
                logCallback(`[SMTC Error] Gagal menjalankan smtc-reader: ${err.message}`, 'error');
            }
            smtcProcess = null;
        });
    } catch (e) {
        console.error('[SMTC] Failed to spawn smtc-reader:', e);
        if (logCallback) {
            logCallback(`[SMTC Exception] ${e.message}`, 'error');
        }
    }
}

function stopSMTCListener() {
    shouldKeepRunning = false;
    currentPlaybackState = null;
    if (smtcProcess) {
        try {
            smtcProcess.kill();
        } catch (e) { }
        smtcProcess = null;
    }
}

function getSMTCState() {
    return currentPlaybackState;
}

module.exports = {
    startSMTCListener,
    stopSMTCListener,
    getSMTCState
};
