const WebSocket = require('ws');

let currentPlaybackState = null;
let wss = null;

function startWebSocketServer() {
    wss = new WebSocket.Server({ port: 8974 });
    
    wss.on('connection', (ws) => {
        console.log("[WebSocket] Spicetify connected!");
        
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                currentPlaybackState = data;
                currentPlaybackState.lastUpdate = Date.now();
            } catch (err) {
                console.error("Invalid message from Spicetify", err);
            }
        });

        ws.on('close', () => {
            console.log("[WebSocket] Spicetify disconnected");
            currentPlaybackState = null;
        });
        
        ws.on('error', (err) => {
            console.error("[WebSocket] Connection error:", err);
        });
    });
    
    console.log("[WebSocket] Listening for Spicetify on ws://127.0.0.1:8974");
}

function getCurrentlyPlaying() {
    return currentPlaybackState;
}

module.exports = { startWebSocketServer, getCurrentlyPlaying };
