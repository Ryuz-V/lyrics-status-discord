const { ipcRenderer } = require('electron');

const discordTokenInput = document.getElementById('discordToken');

const btnConnect = document.getElementById('btnConnect');
const btnDisconnect = document.getElementById('btnDisconnect');
const btnRestart = document.getElementById('btnRestart');

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const logsContainer = document.getElementById('logsContainer');

const lyricToggleBtn = document.getElementById('lyricToggleBtn');
const lyricToggleText = document.getElementById('lyricToggleText');
const lyricSyncContainer = document.getElementById('lyricSyncContainer');

let isConnected = false;
let isLyricStatusOn = false;

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
        if (isConnected) {
            ipcRenderer.send('stop-sync');
        }
    }
    ipcRenderer.send('resize-window', { expanded: enabled });
    ipcRenderer.send('save-settings', { lyricStatusEnabled: enabled });
    checkInputs();
}

// Load saved settings
ipcRenderer.on('load-settings', (event, settings) => {
    if (settings.discordToken) discordTokenInput.value = settings.discordToken;
    setLyricStatus(!!settings.lyricStatusEnabled);
    checkInputs();
});

// Real-time logging
ipcRenderer.on('log', (event, { message, type }) => {
    const el = document.createElement('div');
    el.className = `log-entry log-${type || 'default'}`;
    const time = new Date().toLocaleTimeString();
    el.innerText = `[${time}] ${message}`;
    logsContainer.appendChild(el);
    logsContainer.scrollTop = logsContainer.scrollHeight;
});

// Connection state updates
ipcRenderer.on('state-update', (event, { connected, error }) => {
    isConnected = connected;
    if (connected) {
        statusDot.className = 'status-indicator connected';
        statusText.innerText = 'Connected';
        btnConnect.disabled = true;
        btnDisconnect.disabled = false;
        btnRestart.disabled = false;
        discordTokenInput.disabled = true;
    } else {
        statusDot.className = 'status-indicator disconnected';
        statusText.innerText = 'Disconnected';
        btnDisconnect.disabled = true;
        btnRestart.disabled = true;
        discordTokenInput.disabled = false;
        checkInputs();
    }
});

function checkInputs() {
    if (discordTokenInput.value && isLyricStatusOn) {
        if (!isConnected) btnConnect.disabled = false;
    } else {
        btnConnect.disabled = true;
    }
}

// Event Listeners
lyricToggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    setLyricStatus(!isLyricStatusOn);
});

discordTokenInput.addEventListener('input', () => {
    ipcRenderer.send('save-settings', {
        discordToken: discordTokenInput.value
    });
    checkInputs();
});

btnConnect.addEventListener('click', (e) => {
    e.preventDefault();
    ipcRenderer.send('start-sync');
});

btnDisconnect.addEventListener('click', () => {
    ipcRenderer.send('stop-sync');
});

btnRestart.addEventListener('click', () => {
    ipcRenderer.send('stop-sync');
    setTimeout(() => {
        if (isLyricStatusOn) {
            ipcRenderer.send('start-sync');
        }
    }, 1000);
});

// Request initial settings on load
ipcRenderer.send('request-settings');
