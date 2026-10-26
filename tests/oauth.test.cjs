const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { OAuth, REDIRECT } = require('../src/oauth.cjs');
test('OAuth rejects forged callbacks, denies cross-origin token posting, supports cancellation', async () => {
  let opened; const oauth = new OAuth(url => { opened = new URL(url); });
  const pending = oauth.signIn('twitch','public-client');
  await new Promise(resolve => { const timer = setInterval(() => { if(opened){clearInterval(timer);resolve();} },5); });
  assert.equal(opened.origin,'https://id.twitch.tv'); assert.equal(opened.searchParams.get('redirect_uri'),REDIRECT);
  try {
    const bad = await fetch(`${REDIRECT.replace('localhost','127.0.0.1')}?state=forged&error=access_denied`); assert.equal(bad.status,403);
    const cross = await fetch(REDIRECT.replace('localhost','127.0.0.1').replace('/callback','/token'),{method:'POST',headers:{Origin:'https://evil.example'},body:'state=no'}); assert.equal(cross.status,403);
    await assert.rejects(oauth.signIn('youtube','id'),/current sign-in/);
  } finally { oauth.cancel(); await assert.rejects(pending,/cancelled/); }
  assert.equal(oauth.pending,null);
});
test('Google login uses PKCE and state, sends verifier only to the token endpoint', async () => {
  let opened, exchange; const originalFetch=global.fetch;
  const oauth = new OAuth(url => {opened = new URL(url);});
  const pending = oauth.signIn('youtube','google-client','desktop-secret');
  await new Promise(resolve=>{const timer=setInterval(()=>{if(opened){clearInterval(timer);resolve();}},5);});
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      exchange = options.body;
      return new Response(JSON.stringify({access_token:'test-only',refresh_token:'refresh-test',expires_in:3600,scope:'https://www.googleapis.com/auth/youtube.force-ssl'}),{status:200});
    }
    return originalFetch(url,options);
  };
  try {
    const response = await originalFetch(`${REDIRECT.replace('localhost','127.0.0.1')}?code=sample-code&state=${opened.searchParams.get('state')}`);
    assert.equal(response.status,200); const token=await pending;
    assert.equal(token.access_token,'test-only'); assert.equal(opened.searchParams.get('code_challenge_method'),'S256');
    assert.equal(crypto.createHash('sha256').update(exchange.get('code_verifier')).digest('base64url'),opened.searchParams.get('code_challenge'));
    assert.equal(exchange.get('code'),'sample-code'); assert.equal(opened.searchParams.has('client_secret'),false);
  } finally { global.fetch=originalFetch; oauth.cancel(); }
});
