const { ipcRenderer } = require('electron');

// DOM Elements - Discord Settings
const discordTokenInput = document.getElementById('discordToken');
const bgToggleBtn = document.getElementById('bgToggleBtn');
const bgToggleText = document.getElementById('bgToggleText');

// DOM Elements - Custom Status Fields
const customText1 = document.getElementById('customText1');
const customText2 = document.getElementById('customText2');
const customText3 = document.getElementById('customText3');
const customTime = document.getElementById('customTime');

// DOM Elements - Lyric Status & Media Source
const lyricToggleBtn = document.getElementById('lyricToggleBtn');
const lyricToggleText = document.getElementById('lyricToggleText');
const lyricSyncContainer = document.getElementById('lyricSyncContainer');
const mediaSourceSelect = document.getElementById('mediaSourceSelect');
const lyricsOffsetInput = document.getElementById('lyricsOffset');
const offsetValueText = document.getElementById('offsetValueText');

// DOM Elements - Actions & Status
const btnConnect = document.getElementById('btnConnect');
const btnDisconnect = document.getElementById('btnDisconnect');
const btnRestart = document.getElementById('btnRestart');

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const logsContainer = document.getElementById('logsContainer');

let isConnected = false;
let isLyricStatusOn = false;
let isRunInBackgroundOn = false;

function collectSettings() {
    return {
        discordToken: discordTokenInput ? discordTokenInput.value.trim() : '',
        runInBackground: isRunInBackgroundOn,
        mediaSource: mediaSourceSelect ? mediaSourceSelect.value : 'os_media',
        lyricsOffset: lyricsOffsetInput ? parseFloat(lyricsOffsetInput.value) : 0.4,
        customText1: customText1 ? customText1.value : '',
        customText2: customText2 ? customText2.value : '',
        customText3: customText3 ? customText3.value : '',
        customTime: customTime ? customTime.value : '0',
        lyricStatusEnabled: isLyricStatusOn
    };
}

function saveAllSettings() {
    const settings = collectSettings();
    ipcRenderer.send('save-settings', settings);
}

function setBackgroundStatus(enabled) {
    isRunInBackgroundOn = !!enabled;
    if (bgToggleBtn && bgToggleText) {
        if (isRunInBackgroundOn) {
            bgToggleBtn.className = 'saklar-container on';
            bgToggleText.innerText = 'ON';
        } else {
            bgToggleBtn.className = 'saklar-container off';
            bgToggleText.innerText = 'OFF';
        }
    }
}

function setLyricStatus(enabled) {
    isLyricStatusOn = enabled;
    if (lyricToggleBtn && lyricToggleText && lyricSyncContainer) {
        if (enabled) {
            lyricToggleBtn.className = 'saklar-container on';
            lyricToggleText.innerText = 'ON';
            lyricSyncContainer.classList.remove('hidden');
        } else {
            lyricToggleBtn.className = 'saklar-container off';
            lyricToggleText.innerText = 'OFF';
            lyricSyncContainer.classList.add('hidden');
        }
    }
    saveAllSettings();
    checkInputs();
}

function checkInputs() {
    const token = discordTokenInput ? discordTokenInput.value.trim() : '';
    const hasToken = token.length > 0;
    const t1 = customText1 ? customText1.value.trim() : '';
    const t2 = customText2 ? customText2.value.trim() : '';
    const t3 = customText3 ? customText3.value.trim() : '';
    const hasCustomText = (t1.length > 0 || t2.length > 0 || t3.length > 0);

    const canConnect = hasToken && (hasCustomText || isLyricStatusOn);

    if (isConnected) {
        btnConnect.disabled = true;
        btnDisconnect.disabled = false;
        btnRestart.disabled = false;
        if (discordTokenInput) discordTokenInput.disabled = true;
    } else {
        btnConnect.disabled = !canConnect;
        btnDisconnect.disabled = true;
        btnRestart.disabled = true;
        if (discordTokenInput) discordTokenInput.disabled = false;
    }
}

// Load saved settings
ipcRenderer.on('load-settings', (event, s) => {
    if (s.discordToken && discordTokenInput) discordTokenInput.value = s.discordToken;

    if (s.customText1 !== undefined && customText1) customText1.value = s.customText1;
    if (s.customText2 !== undefined && customText2) customText2.value = s.customText2;
    if (s.customText3 !== undefined && customText3) customText3.value = s.customText3;
    if (s.customTime !== undefined && customTime) customTime.value = s.customTime;

    if (s.mediaSource !== undefined && mediaSourceSelect) {
        mediaSourceSelect.value = s.mediaSource;
    }

    if (s.lyricsOffset !== undefined && lyricsOffsetInput) {
        lyricsOffsetInput.value = s.lyricsOffset;
        const val = parseFloat(s.lyricsOffset);
        if (offsetValueText) {
            offsetValueText.innerText = (val >= 0 ? '+' : '') + val.toFixed(1) + 's';
        }
    }

    setLyricStatus(!!s.lyricStatusEnabled);
    setBackgroundStatus(!!s.runInBackground);
    checkInputs();
});

// Real-time logging
ipcRenderer.on('log', (event, { message, type }) => {
    if (!logsContainer) return;
    const el = document.createElement('div');
    el.className = `log-entry log-${type || 'default'}`;
    const time = new Date().toLocaleTimeString();
    el.innerText = `[${time}] ${message}`;
    logsContainer.appendChild(el);
    logsContainer.scrollTop = logsContainer.scrollHeight;
});

// Connection state updates
ipcRenderer.on('state-update', (event, { connected, user, error }) => {
    isConnected = connected;
    if (connected) {
        statusDot.className = 'status-indicator connected';
        statusText.innerText = user ? `Connected as ${user}` : 'Connected';
    } else {
        statusDot.className = 'status-indicator disconnected';
        statusText.innerText = 'Disconnected';
    }
    checkInputs();
});

// Lyric Status toggle listener
if (lyricToggleBtn) {
    lyricToggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const nextState = !isLyricStatusOn;
        setLyricStatus(nextState);
        ipcRenderer.send('toggle-lyric-status', {
            enabled: nextState
        });
    });
}

// Run in Background toggle listener
if (bgToggleBtn) {
    bgToggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const nextState = !isRunInBackgroundOn;
        setBackgroundStatus(nextState);
        saveAllSettings();
        ipcRenderer.send('toggle-background-mode', {
            enabled: nextState
        });
    });
}

// Input change listeners for auto-save
const autoSaveInputs = [
    discordTokenInput,
    mediaSourceSelect, lyricsOffsetInput,
    customText1, customText2, customText3, customTime
].filter(Boolean);

if (lyricsOffsetInput) {
    lyricsOffsetInput.addEventListener('input', () => {
        const val = parseFloat(lyricsOffsetInput.value);
        if (offsetValueText) {
            offsetValueText.innerText = (val >= 0 ? '+' : '') + val.toFixed(1) + 's';
        }
    });
}

autoSaveInputs.forEach((input) => {
    input.addEventListener('input', () => {
        saveAllSettings();
        checkInputs();
    });
    input.addEventListener('change', () => {
        saveAllSettings();
        checkInputs();
    });
});

// Prevent form submission reload
const settingsForm = document.getElementById('settingsForm');
if (settingsForm) {
    settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
    });
}

// Action Buttons
if (btnConnect) {
    btnConnect.addEventListener('click', (e) => {
        e.preventDefault();
        saveAllSettings();
        ipcRenderer.send('start-sync', collectSettings());
    });
}

if (btnDisconnect) {
    btnDisconnect.addEventListener('click', () => {
        ipcRenderer.send('stop-sync');
    });
}

if (btnRestart) {
    btnRestart.addEventListener('click', () => {
        ipcRenderer.send('stop-sync');
        setTimeout(() => {
            ipcRenderer.send('start-sync', collectSettings());
        }, 1000);
    });
}

// Request initial settings on load
ipcRenderer.send('request-settings');
