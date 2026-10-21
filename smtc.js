const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

let smtcProcess = null;
let currentPlaybackState = null;
let updateCallback = null;
let shouldKeepRunning = false;

function startSMTCListener(onUpdate) {
    if (smtcProcess) return;

    updateCallback = onUpdate || null;
    shouldKeepRunning = true;

    const exePath = path.join(__dirname, 'bin', 'smtc-reader.exe');

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

                currentPlaybackState = {
                    id: `${data.artist || ''}_${data.title || ''}`,
                    name: data.title || '',
                    artist: data.artist || '',
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

        smtcProcess.stderr.on('data', () => {});

        smtcProcess.on('exit', () => {
            smtcProcess = null;
            if (shouldKeepRunning) {
                setTimeout(() => {
                    if (shouldKeepRunning && !smtcProcess) {
                        startSMTCListener(updateCallback);
                    }
                }, 1000);
            }
        });

        smtcProcess.on('error', (err) => {
            console.error('[SMTC] Process error:', err);
            smtcProcess = null;
        });
    } catch (e) {
        console.error('[SMTC] Failed to spawn smtc-reader:', e);
    }
}

function stopSMTCListener() {
    shouldKeepRunning = false;
    currentPlaybackState = null;
    if (smtcProcess) {
        try {
            smtcProcess.kill();
        } catch (e) {}
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
