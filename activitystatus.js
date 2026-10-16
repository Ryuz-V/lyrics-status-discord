const net = require('net');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

const APP_START_TIME = Math.floor(Date.now() / 1000);

class DiscordRPC extends EventEmitter {
    constructor() {
        super();
        this.socket = null;
        this.connected = false;
        this.currentUser = null;
        this.appId = null;
        this.connectedAt = null;
        this.buffer = Buffer.alloc(0);
        this.pendingActivity = null;
    }

    getPipePath(id = 0) {
        if (process.platform === 'win32') {
            return `\\\\.\\pipe\\discord-ipc-${id}`;
        }
        const env = process.env;
        const prefix = env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || '/tmp';
        return path.join(prefix, `discord-ipc-${id}`);
    }

    async findAndConnect(appId) {
        if (appId && typeof appId === 'string' && appId.includes('.')) {
            try {
                const firstPart = appId.split('.')[0];
                const decoded = Buffer.from(firstPart, 'base64').toString('utf8');
                if (/^\d+$/.test(decoded)) {
                    appId = decoded;
                }
            } catch (e) {}
        }
        this.appId = appId;
        if (this.socket) {
            this.disconnect();
        }

        return new Promise((resolve, reject) => {
            let attempt = 0;
            const maxAttempts = 10;

            const tryPipe = () => {
                if (attempt >= maxAttempts) {
                    return reject(new Error('Could not find running Discord client IPC pipe. Make sure Discord Desktop is open.'));
                }

                const pipePath = this.getPipePath(attempt);
                const socket = net.connect(pipePath);

                const onConnect = () => {
                    cleanupListeners();
                    this.socket = socket;
                    this.setupSocket(resolve, reject);
                };

                const onError = (err) => {
                    cleanupListeners();
                    socket.destroy();
                    attempt++;
                    tryPipe();
                };

                const cleanupListeners = () => {
                    socket.removeListener('connect', onConnect);
                    socket.removeListener('error', onError);
                };

                socket.once('connect', onConnect);
                socket.once('error', onError);
            };

            tryPipe();
        });
    }

    setupSocket(onReadyResolve, onReadyReject) {
        this.buffer = Buffer.alloc(0);
        let resolved = false;

        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                this.disconnect();
                if (onReadyReject) onReadyReject(new Error('Discord IPC Handshake timeout.'));
            }
        }, 8000);

        this.socket.on('data', (chunk) => {
            this.buffer = Buffer.concat([this.buffer, chunk]);
            while (this.buffer.length >= 8) {
                const op = this.buffer.readUInt32LE(0);
                const len = this.buffer.readUInt32LE(4);

                if (this.buffer.length < 8 + len) {
                    break; // wait for complete frame
                }

                const rawPayload = this.buffer.slice(8, 8 + len).toString('utf8');
                this.buffer = this.buffer.slice(8 + len);

                try {
                    const parsed = JSON.parse(rawPayload);
                    this.handleMessage(op, parsed, () => {
                        if (!resolved) {
                            resolved = true;
                            clearTimeout(timeout);
                            if (onReadyResolve) onReadyResolve(this.currentUser);
                        }
                    });
                } catch (e) {
                    this.emit('error', e);
                }
            }
        });

        this.socket.on('close', () => {
            this.connected = false;
            this.currentUser = null;
            this.emit('disconnected');
        });

        this.socket.on('error', (err) => {
            this.emit('error', err);
        });

        // Send handshake
        this.sendPacket(OP_HANDSHAKE, {
            v: 1,
            client_id: this.appId
        });
    }

    sendPacket(op, payload) {
        if (!this.socket || this.socket.destroyed) return;
        const jsonStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
        const payloadBuf = Buffer.from(jsonStr, 'utf8');
        const packet = Buffer.alloc(8 + payloadBuf.length);
        packet.writeUInt32LE(op, 0);
        packet.writeUInt32LE(payloadBuf.length, 4);
        payloadBuf.copy(packet, 8);
        this.socket.write(packet);
    }

    handleMessage(op, data, onReadyCallback) {
        if (op === OP_PING) {
            this.sendPacket(OP_PONG, data);
            return;
        }

        if (op === OP_FRAME) {
            if (data.evt === 'READY') {
                this.connected = true;
                this.connectedAt = Math.floor(Date.now() / 1000);
                this.currentUser = data.data.user;
                this.emit('ready', this.currentUser);
                if (onReadyCallback) onReadyCallback();

                if (this.pendingActivity) {
                    this.setActivity(this.pendingActivity);
                }
            } else if (data.evt === 'ERROR') {
                this.emit('error', new Error(data.data.message || 'Discord RPC Error'));
            } else if (data.cmd === 'SET_ACTIVITY') {
                this.emit('activity_updated', data.data);
            }
        }
    }

    buildActivity(options) {
        const activity = {};

        // Activity Type: 0 = Playing, 1 = Streaming, 2 = Listening, 3 = Watching, 5 = Competing
        const typeMap = {
            'playing': 0,
            'streaming': 1,
            'listening': 2,
            'watching': 3,
            'competing': 5
        };
        const rawType = (options.type || 'listening').toString().toLowerCase();
        activity.type = typeMap[rawType] !== undefined ? typeMap[rawType] : 2;

        if (options.name && options.name.trim()) {
            activity.name = options.name.trim();
        }

        if (options.details && options.details.trim()) {
            activity.details = options.details.trim().substring(0, 128);
        }

        if (options.state && options.state.trim()) {
            activity.state = options.state.trim().substring(0, 128);
        }

        // Timestamps
        const tsMode = options.timestampType || 'local_time';
        if (tsMode === 'local_time') {
            const now = new Date();
            const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
            activity.timestamps = {
                start: Math.floor(midnight.getTime() / 1000)
            };
        } else if (tsMode === 'since_connection') {
            activity.timestamps = {
                start: this.connectedAt || Math.floor(Date.now() / 1000)
            };
        } else if (tsMode === 'since_update') {
            activity.timestamps = {
                start: Math.floor(Date.now() / 1000)
            };
        } else if (tsMode === 'since_started') {
            activity.timestamps = {
                start: APP_START_TIME
            };
        } else if (tsMode === 'custom') {
            const ts = {};
            if (options.customStart) {
                const s = new Date(options.customStart).getTime();
                if (!isNaN(s)) ts.start = Math.floor(s / 1000);
            }
            if (options.customEnd) {
                const e = new Date(options.customEnd).getTime();
                if (!isNaN(e)) ts.end = Math.floor(e / 1000);
            }
            if (ts.start || ts.end) {
                activity.timestamps = ts;
            }
        }
        // If tsMode === 'none', no timestamps

        // Assets
        const assets = {};
        if (options.largeImageKey && options.largeImageKey.trim()) {
            assets.large_image = options.largeImageKey.trim();
        }
        if (options.largeImageText && options.largeImageText.trim()) {
            assets.large_text = options.largeImageText.trim().substring(0, 128);
        }
        if (options.smallImageKey && options.smallImageKey.trim()) {
            assets.small_image = options.smallImageKey.trim();
        }
        if (options.smallImageText && options.smallImageText.trim()) {
            assets.small_text = options.smallImageText.trim().substring(0, 128);
        }
        if (Object.keys(assets).length > 0) {
            activity.assets = assets;
        }

        // Party
        const partyCur = parseInt(options.partyCurrent, 10);
        const partyMax = parseInt(options.partyMax, 10);
        if (!isNaN(partyCur) && !isNaN(partyMax) && partyMax > 0) {
            activity.party = {
                id: 'presync_' + (this.appId || 'party'),
                size: [partyCur, partyMax]
            };
        }

        // Buttons (up to 2 buttons, label & valid URL)
        const buttons = [];
        if (options.button1Text && options.button1Text.trim() && options.button1Url && options.button1Url.trim()) {
            buttons.push({
                label: options.button1Text.trim().substring(0, 32),
                url: options.button1Url.trim()
            });
        }
        if (options.button2Text && options.button2Text.trim() && options.button2Url && options.button2Url.trim()) {
            buttons.push({
                label: options.button2Text.trim().substring(0, 32),
                url: options.button2Url.trim()
            });
        }
        if (buttons.length > 0) {
            activity.buttons = buttons;
        }

        return activity;
    }

    setActivity(options) {
        this.pendingActivity = options;
        if (!this.connected || !this.socket) {
            return;
        }

        const activity = this.buildActivity(options);
        const packet = {
            cmd: 'SET_ACTIVITY',
            args: {
                pid: process.pid,
                activity: activity
            },
            nonce: crypto.randomUUID()
        };

        this.sendPacket(OP_FRAME, packet);
    }

    clearActivity() {
        this.pendingActivity = null;
        if (!this.connected || !this.socket) {
            return;
        }

        const packet = {
            cmd: 'SET_ACTIVITY',
            args: {
                pid: process.pid,
                activity: null
            },
            nonce: crypto.randomUUID()
        };

        this.sendPacket(OP_FRAME, packet);
    }

    disconnect() {
        this.clearActivity();
        if (this.socket && !this.socket.destroyed) {
            try {
                this.socket.destroy();
            } catch (e) {}
        }
        this.socket = null;
        this.connected = false;
        this.currentUser = null;
        this.buffer = Buffer.alloc(0);
        this.emit('disconnected');
    }
}

let instance = null;
function getDiscordRPC() {
    if (!instance) {
        instance = new DiscordRPC();
    }
    return instance;
}

module.exports = { DiscordRPC, getDiscordRPC };
