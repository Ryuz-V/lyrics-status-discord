const { ipcRenderer } = require('electron');

// DOM Elements - Discord Settings
const discordTokenInput = document.getElementById('discordToken');
const rpcAppId = document.getElementById('rpcAppId');

// DOM Elements - Custom Status Fields
const customText1 = document.getElementById('customText1');
const customText2 = document.getElementById('customText2');
const customText3 = document.getElementById('customText3');
const customTime = document.getElementById('customTime');

// DOM Elements - Lyric Status Toggle
const lyricToggleBtn = document.getElementById('lyricToggleBtn');
const lyricToggleText = document.getElementById('lyricToggleText');
const lyricSyncContainer = document.getElementById('lyricSyncContainer');

// DOM Elements - Actions & Status
const btnConnect = document.getElementById('btnConnect');
const btnDisconnect = document.getElementById('btnDisconnect');
const btnUpdatePresence = document.getElementById('btnUpdatePresence');
const btnRestart = document.getElementById('btnRestart');

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const logsContainer = document.getElementById('logsContainer');

let isConnected = false;
let isLyricStatusOn = false;

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
        } catch(e) {}
    }
    return tokenOrId;
}

function collectSettings() {
    let rawAppId = rpcAppId ? rpcAppId.value.trim() : '';
    let effectiveAppId = extractDiscordId(rawAppId);
    if (!effectiveAppId && discordTokenInput) {
        effectiveAppId = extractDiscordId(discordTokenInput.value.trim());
    }

    return {
        discordToken: discordTokenInput ? discordTokenInput.value.trim() : '',
        rpcAppId: effectiveAppId || rawAppId,
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
        btnUpdatePresence.disabled = false;
        btnRestart.disabled = false;
        if (discordTokenInput) discordTokenInput.disabled = true;
    } else {
        btnConnect.disabled = !canConnect;
        btnDisconnect.disabled = true;
        btnUpdatePresence.disabled = true;
        btnRestart.disabled = true;
        if (discordTokenInput) discordTokenInput.disabled = false;
    }
}

// Load saved settings
ipcRenderer.on('load-settings', (event, s) => {
    if (s.discordToken && discordTokenInput) discordTokenInput.value = s.discordToken;

    if (s.rpcAppId !== undefined && rpcAppId) rpcAppId.value = s.rpcAppId;
    
    // Auto-sync ID with Discord Token if ID is empty or default placeholder
    const tokenExtractId = extractDiscordId(discordTokenInput ? discordTokenInput.value : '');
    if (rpcAppId && (!rpcAppId.value || rpcAppId.value === '1444178398372036789') && tokenExtractId) {
        rpcAppId.value = tokenExtractId;
        rpcAppId.dataset.autoSynced = 'true';
    }

    if (s.customText1 !== undefined && customText1) customText1.value = s.customText1;
    if (s.customText2 !== undefined && customText2) customText2.value = s.customText2;
    if (s.customText3 !== undefined && customText3) customText3.value = s.customText3;
    if (s.customTime !== undefined && customTime) customTime.value = s.customTime;

    setLyricStatus(!!s.lyricStatusEnabled);
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

// Synchronize ID with Discord Token
if (discordTokenInput) {
    discordTokenInput.addEventListener('input', () => {
        const idFromToken = extractDiscordId(discordTokenInput.value);
        if (rpcAppId && idFromToken && (!rpcAppId.value || rpcAppId.value === '1444178398372036789' || rpcAppId.dataset.autoSynced === 'true')) {
            rpcAppId.value = idFromToken;
            rpcAppId.dataset.autoSynced = 'true';
        }
    });
}

if (rpcAppId) {
    rpcAppId.addEventListener('input', () => {
        if (rpcAppId.value.includes('.')) {
            const extracted = extractDiscordId(rpcAppId.value);
            if (extracted && extracted !== rpcAppId.value) {
                rpcAppId.value = extracted;
            }
        }
        rpcAppId.dataset.autoSynced = 'false';
    });
}

// Input change listeners for auto-save
const autoSaveInputs = [
    discordTokenInput, rpcAppId,
    customText1, customText2, customText3, customTime
].filter(Boolean);

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

if (btnUpdatePresence) {
    btnUpdatePresence.addEventListener('click', () => {
        saveAllSettings();
        ipcRenderer.send('update-presence', collectSettings());
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
