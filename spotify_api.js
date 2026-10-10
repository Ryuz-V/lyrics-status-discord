const SpotifyWebApi = require('spotify-web-api-node');
const express = require('express');

let spotifyApi = null;
let server = null;

function initSpotify(clientId, clientSecret, redirectUri) {
    spotifyApi = new SpotifyWebApi({
        clientId: clientId,
        clientSecret: clientSecret,
        redirectUri: redirectUri
    });
}

function getAuthUrl() {
    const scopes = ['user-read-playback-state', 'user-read-currently-playing'];
    return spotifyApi.createAuthorizeURL(scopes, 'state');
}

function startAuthServer(onSuccess, onError) {
    if (server) return;
    const app = express();
    app.get('/callback', async (req, res) => {
        const error = req.query.error;
        const code = req.query.code;
        if (error) {
            res.send('Callback Error: ' + error);
            if (onError) onError(error);
            return;
        }
        try {
            const data = await spotifyApi.authorizationCodeGrant(code);
            const access_token = data.body['access_token'];
            const refresh_token = data.body['refresh_token'];
            const expires_in = data.body['expires_in'];

            spotifyApi.setAccessToken(access_token);
            spotifyApi.setRefreshToken(refresh_token);

            res.send('Success! You can close this window and return to the app.');
            
            // Auto refresh token setup
            setInterval(async () => {
                const data = await spotifyApi.refreshAccessToken();
                spotifyApi.setAccessToken(data.body['access_token']);
            }, expires_in / 2 * 1000);

            if (onSuccess) onSuccess({ access_token, refresh_token });
        } catch (error) {
            res.send('Error getting tokens: ' + error);
            if (onError) onError(error);
        }
    });

    server = app.listen(8888, () => {
        console.log('Listening on 8888 for Spotify callback...');
    });
}

function setTokens(access_token, refresh_token) {
    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);
}

async function getCurrentlyPlaying() {
    if (!spotifyApi || !spotifyApi.getAccessToken()) return null;
    try {
        const data = await spotifyApi.getMyCurrentPlayingTrack();
        if (data.body && data.body.item) {
            return {
                id: data.body.item.id,
                name: data.body.item.name,
                artist: data.body.item.artists[0].name,
                album: data.body.item.album.name,
                durationMs: data.body.item.duration_ms,
                progressMs: data.body.progress_ms,
                isPlaying: data.body.is_playing,
                lastUpdate: Date.now()
            };
        }
    } catch (e) {
        // Maybe token expired, refresh will handle it next time
    }
    return null;
}

module.exports = { initSpotify, getAuthUrl, startAuthServer, setTokens, getCurrentlyPlaying };
