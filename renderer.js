const { ipcRenderer } = require('electron');

// DOM Elements - Discord Token
const discordTokenInput = document.getElementById('discordToken');

// DOM Elements - Custom RP
const customRpContainer = document.getElementById('customRpContainer');

// DOM Elements - Custom RP Fields
const rpcAppId = document.getElementById('rpcAppId');
const rpcType = document.getElementById('rpcType');
const rpcDisplay = document.getElementById('rpcDisplay');
const rpcName = document.getElementById('rpcName');
const rpcDetails = document.getElementById('rpcDetails');
const rpcDetailsUrl = document.getElementById('rpcDetailsUrl');
const rpcState = document.getElementById('rpcState');
const rpcStateUrl = document.getElementById('rpcStateUrl');
const rpcPartyCur = document.getElementById('rpcPartyCur');
const rpcPartyMax = document.getElementById('rpcPartyMax');
const customTimestampRow = document.getElementById('customTimestampRow');
const rpcCustomStart = document.getElementById('rpcCustomStart');
const rpcCustomEnd = document.getElementById('rpcCustomEnd');

const rpcLargeImageKey = document.getElementById('rpcLargeImageKey');
const rpcLargeImageText = document.getElementById('rpcLargeImageText');
const rpcLargeImageUrl = document.getElementById('rpcLargeImageUrl');

const rpcSmallImageKey = document.getElementById('rpcSmallImageKey');
const rpcSmallImageText = document.getElementById('rpcSmallImageText');
const rpcSmallImageUrl = document.getElementById('rpcSmallImageUrl');

const rpcButton1Text = document.getElementById('rpcButton1Text');
const rpcButton1Url = document.getElementById('rpcButton1Url');
const rpcButton2Text = document.getElementById('rpcButton2Text');
const rpcButton2Url = document.getElementById('rpcButton2Url');

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
let isCustomRpOn = true;

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

function getSelectedTimestampType() {
    const checked = document.querySelector('input[name="rpcTimestamp"]:checked');
    return checked ? checked.value : 'local_time';
}

function setSelectedTimestampType(val) {
    const radio = document.querySelector(`input[name="rpcTimestamp"][value="${val}"]`);
    if (radio) {
        radio.checked = true;
    }
    if (customTimestampRow) {
        if (val === 'custom') {
            customTimestampRow.classList.remove('hidden');
        } else {
            customTimestampRow.classList.add('hidden');
        }
    }
}

function collectRpcSettings() {
    let rawAppId = rpcAppId.value.trim();
    let effectiveAppId = extractDiscordId(rawAppId);
    if (!effectiveAppId) {
        effectiveAppId = extractDiscordId(discordTokenInput.value.trim());
    }

    return {
        appId: effectiveAppId,
        type: (rpcType && rpcType.value) || 'listening',
        display: (rpcDisplay && rpcDisplay.value) || 'name',
        name: rpcName ? rpcName.value.trim() : '',
        details: rpcDetails ? rpcDetails.value.trim() : '',
        detailsUrl: rpcDetailsUrl ? rpcDetailsUrl.value.trim() : '',
        state: rpcState ? rpcState.value.trim() : '',
        stateUrl: rpcStateUrl ? rpcStateUrl.value.trim() : '',
        partyCurrent: rpcPartyCur ? rpcPartyCur.value : '0',
        partyMax: rpcPartyMax ? rpcPartyMax.value : '0',
        timestampType: getSelectedTimestampType(),
        customStart: rpcCustomStart ? rpcCustomStart.value : '',
        customEnd: rpcCustomEnd ? rpcCustomEnd.value : '',
        largeImageKey: rpcLargeImageKey ? rpcLargeImageKey.value.trim() : '',
        largeImageText: rpcLargeImageText ? rpcLargeImageText.value.trim() : '',
        largeImageUrl: rpcLargeImageUrl ? rpcLargeImageUrl.value.trim() : '',
        smallImageKey: rpcSmallImageKey ? rpcSmallImageKey.value.trim() : '',
        smallImageText: rpcSmallImageText ? rpcSmallImageText.value.trim() : '',
        smallImageUrl: rpcSmallImageUrl ? rpcSmallImageUrl.value.trim() : '',
        button1Text: rpcButton1Text ? rpcButton1Text.value.trim() : '',
        button1Url: rpcButton1Url ? rpcButton1Url.value.trim() : '',
        button2Text: rpcButton2Text ? rpcButton2Text.value.trim() : '',
        button2Url: rpcButton2Url ? rpcButton2Url.value.trim() : ''
    };
}

function saveAllSettings() {
    const rpc = collectRpcSettings();
    ipcRenderer.send('save-settings', {
        discordToken: discordTokenInput.value,
        lyricStatusEnabled: isLyricStatusOn,
        customRpEnabled: isCustomRpOn,
        rpcAppId: rpc.appId,
        rpcType: rpc.type,
        rpcDisplay: rpc.display,
        rpcName: rpc.name,
        rpcDetails: rpc.details,
        rpcDetailsUrl: rpc.detailsUrl,
        rpcState: rpc.state,
        rpcStateUrl: rpc.stateUrl,
        rpcPartyCur: rpc.partyCurrent,
        rpcPartyMax: rpc.partyMax,
        rpcTimestampType: rpc.timestampType,
        rpcCustomStart: rpc.customStart,
        rpcCustomEnd: rpc.customEnd,
        rpcLargeImageKey: rpc.largeImageKey,
        rpcLargeImageText: rpc.largeImageText,
        rpcLargeImageUrl: rpc.largeImageUrl,
        rpcSmallImageKey: rpc.smallImageKey,
        rpcSmallImageText: rpc.smallImageText,
        rpcSmallImageUrl: rpc.smallImageUrl,
        rpcButton1Text: rpc.button1Text,
        rpcButton1Url: rpc.button1Url,
        rpcButton2Text: rpc.button2Text,
        rpcButton2Url: rpc.button2Url
    });
}

function setCustomRp() {
    isCustomRpOn = true;
    if (customRpContainer) {
        customRpContainer.classList.remove('hidden');
    }
    checkInputs();
}

function setLyricStatus(enabled) {
    isLyricStatusOn = enabled;
    if (enabled) {
        lyricToggleBtn.className = 'saklar-container on';
        lyricToggleText.innerText = 'ON';
        lyricSyncContainer.classList.remove('hidden');
    } else {
        lyricToggleBtn.className = 'saklar-container off';
        lyricToggleText.innerText = 'OFF';
        lyricSyncContainer.classList.add('hidden');
    }
    saveAllSettings();
    checkInputs();
}

function checkInputs() {
    const rawAppId = rpcAppId.value.trim();
    const effectiveAppId = extractDiscordId(rawAppId) || extractDiscordId(discordTokenInput.value.trim());
    const canConnectCustomRp = isCustomRpOn && effectiveAppId.length > 0;
    const canConnectLyric = isLyricStatusOn && discordTokenInput.value.trim().length > 0;

    if (isConnected) {
        btnConnect.disabled = true;
        btnDisconnect.disabled = false;
        btnUpdatePresence.disabled = !isCustomRpOn;
        btnRestart.disabled = false;
        discordTokenInput.disabled = true;
    } else {
        btnConnect.disabled = !(canConnectCustomRp || canConnectLyric);
        btnDisconnect.disabled = true;
        btnUpdatePresence.disabled = true;
        btnRestart.disabled = true;
        discordTokenInput.disabled = false;
    }
}

// Load saved settings
ipcRenderer.on('load-settings', (event, s) => {
    if (s.discordToken) discordTokenInput.value = s.discordToken;

    // Custom RP Settings
    if (s.rpcAppId !== undefined) rpcAppId.value = s.rpcAppId;
    
    // Auto-sync ID with Discord Token if ID is empty or default placeholder
    const tokenExtractId = extractDiscordId(discordTokenInput.value);
    if ((!rpcAppId.value || rpcAppId.value === '1444178398372036789') && tokenExtractId) {
        rpcAppId.value = tokenExtractId;
        rpcAppId.dataset.autoSynced = 'true';
    }

    if (s.rpcType && rpcType) rpcType.value = s.rpcType;
    if (s.rpcDisplay && rpcDisplay) rpcDisplay.value = s.rpcDisplay;
    if (s.rpcName !== undefined && rpcName) rpcName.value = s.rpcName;
    if (s.rpcDetails !== undefined && rpcDetails) rpcDetails.value = s.rpcDetails;
    if (s.rpcDetailsUrl !== undefined && rpcDetailsUrl) rpcDetailsUrl.value = s.rpcDetailsUrl;
    if (s.rpcState !== undefined && rpcState) rpcState.value = s.rpcState;
    if (s.rpcStateUrl !== undefined && rpcStateUrl) rpcStateUrl.value = s.rpcStateUrl;
    if (s.rpcPartyCur !== undefined && rpcPartyCur) rpcPartyCur.value = s.rpcPartyCur;
    if (s.rpcPartyMax !== undefined && rpcPartyMax) rpcPartyMax.value = s.rpcPartyMax;

    if (s.rpcTimestampType) setSelectedTimestampType(s.rpcTimestampType);
    if (s.rpcCustomStart && rpcCustomStart) rpcCustomStart.value = s.rpcCustomStart;
    if (s.rpcCustomEnd && rpcCustomEnd) rpcCustomEnd.value = s.rpcCustomEnd;

    if (s.rpcLargeImageKey !== undefined && rpcLargeImageKey) rpcLargeImageKey.value = s.rpcLargeImageKey;
    if (s.rpcLargeImageText !== undefined && rpcLargeImageText) rpcLargeImageText.value = s.rpcLargeImageText;
    if (s.rpcLargeImageUrl !== undefined && rpcLargeImageUrl) rpcLargeImageUrl.value = s.rpcLargeImageUrl;

    if (s.rpcSmallImageKey !== undefined && rpcSmallImageKey) rpcSmallImageKey.value = s.rpcSmallImageKey;
    if (s.rpcSmallImageText !== undefined && rpcSmallImageText) rpcSmallImageText.value = s.rpcSmallImageText;
    if (s.rpcSmallImageUrl !== undefined && rpcSmallImageUrl) rpcSmallImageUrl.value = s.rpcSmallImageUrl;

    if (s.rpcButton1Text !== undefined && rpcButton1Text) rpcButton1Text.value = s.rpcButton1Text;
    if (s.rpcButton1Url !== undefined && rpcButton1Url) rpcButton1Url.value = s.rpcButton1Url;
    if (s.rpcButton2Text !== undefined && rpcButton2Text) rpcButton2Text.value = s.rpcButton2Text;
    if (s.rpcButton2Url !== undefined && rpcButton2Url) rpcButton2Url.value = s.rpcButton2Url;

    setCustomRp();
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

lyricToggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const nextState = !isLyricStatusOn;
    setLyricStatus(nextState);
    ipcRenderer.send('toggle-lyric-status', {
        enabled: nextState
    });
});

// Timestamp radio listeners
document.querySelectorAll('input[name="rpcTimestamp"]').forEach((radio) => {
    radio.addEventListener('change', () => {
        if (radio.checked && radio.value === 'custom') {
            customTimestampRow.classList.remove('hidden');
        } else {
            customTimestampRow.classList.add('hidden');
        }
        saveAllSettings();
    });
});

// Synchronize ID with Discord Token
discordTokenInput.addEventListener('input', () => {
    const idFromToken = extractDiscordId(discordTokenInput.value);
    if (idFromToken && (!rpcAppId.value || rpcAppId.value === '1444178398372036789' || rpcAppId.dataset.autoSynced === 'true')) {
        rpcAppId.value = idFromToken;
        rpcAppId.dataset.autoSynced = 'true';
    }
});

rpcAppId.addEventListener('input', () => {
    if (rpcAppId.value.includes('.')) {
        const extracted = extractDiscordId(rpcAppId.value);
        if (extracted && extracted !== rpcAppId.value) {
            rpcAppId.value = extracted;
        }
    }
    rpcAppId.dataset.autoSynced = 'false';
});

// Input change listeners
const autoSaveInputs = [
    discordTokenInput, rpcAppId, rpcType, rpcDisplay, rpcName,
    rpcDetails, rpcDetailsUrl, rpcState, rpcStateUrl,
    rpcPartyCur, rpcPartyMax, rpcCustomStart, rpcCustomEnd,
    rpcLargeImageKey, rpcLargeImageText, rpcLargeImageUrl,
    rpcSmallImageKey, rpcSmallImageText, rpcSmallImageUrl,
    rpcButton1Text, rpcButton1Url, rpcButton2Text, rpcButton2Url
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

// Action Buttons
btnConnect.addEventListener('click', (e) => {
    e.preventDefault();
    saveAllSettings();
    ipcRenderer.send('start-sync', collectRpcSettings());
});

btnDisconnect.addEventListener('click', () => {
    ipcRenderer.send('stop-sync');
});

btnUpdatePresence.addEventListener('click', () => {
    saveAllSettings();
    ipcRenderer.send('update-presence', collectRpcSettings());
});

btnRestart.addEventListener('click', () => {
    ipcRenderer.send('stop-sync');
    setTimeout(() => {
        ipcRenderer.send('start-sync', collectRpcSettings());
    }, 1000);
});

// Request initial settings on load
ipcRenderer.send('request-settings');
