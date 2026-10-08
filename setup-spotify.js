const SpotifyWebApi = require('spotify-web-api-node');
const readline = require('readline');
require('dotenv').config();

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: 'http://127.0.0.1:8888/callback'
});

const scopes = ['user-read-playback-state', 'user-read-currently-playing'];

const authorizeURL = spotifyApi.createAuthorizeURL(scopes, 'state');

console.log('--- SPOTIFY SETUP ---');
console.log('1. Go to this URL in your browser:');
console.log('\n' + authorizeURL + '\n');
console.log('2. Log in and authorize the app.');
console.log('3. You will be redirected to 127.0.0.1:8888/callback?code=YOUR_CODE_HERE...');
console.log('4. Look at the URL in your browser address bar.');
console.log('5. Copy the YOUR_CODE_HERE part (everything after ?code= and before &state=).');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('\nPaste the code here: ', async (code) => {
    try {
        const data = await spotifyApi.authorizationCodeGrant(code);
        console.log('\n✅ SUCCESS! Add this line to your .env file:');
        console.log(`SPOTIFY_REFRESH_TOKEN=${data.body['refresh_token']}`);
        console.log('\nThen you can run: node index.js');
    } catch (error) {
        console.error('\n❌ Error getting tokens:', error.body ? error.body : error);
    }
    rl.close();
});
