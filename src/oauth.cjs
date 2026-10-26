const http = require('node:http');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const CALLBACK_PORT = 47823;
const REDIRECT = `http://localhost:${CALLBACK_PORT}/callback`;
const TWITCH_SCOPES = ['user:read:chat', 'user:write:chat', 'moderator:manage:chat_messages', 'moderator:manage:banned_users', 'moderator:manage:chat_settings'];
class OAuth extends EventEmitter {
  constructor(openExternal) { super(); this.openExternal = openExternal; this.pending = null; }
  cancel() { this.pending?.reject(new Error('Sign-in cancelled.')); }
  async signIn(provider, clientId, clientSecret = '') {
    if (this.pending) throw new Error('Finish or cancel the current sign-in first.');
    if (!clientId) throw new Error('Add this platform’s OAuth client ID in Settings first.');
    const state = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    let server, timer;
    const result = new Promise((resolve, reject) => {
      const finish = (error, value) => {
        clearTimeout(timer); this.pending = null;
        server?.close();
        error ? reject(error) : resolve(value);
      };
      this.pending = { reject: error => finish(error) };
      server = http.createServer(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Connection', 'close');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (![`localhost:${CALLBACK_PORT}`, `127.0.0.1:${CALLBACK_PORT}`].includes(req.headers.host)) { res.writeHead(400).end(); return; }
        const url = new URL(req.url, REDIRECT);
        // Twitch returns a fragment; a one-use page transfers it to the loopback POST endpoint.
        if (req.method === 'GET' && url.pathname === '/callback' && provider === 'twitch' && !url.searchParams.has('error')) {
          res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; style-src 'unsafe-inline'");
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end('<title>ChatHub sign-in</title><body style="background:#11131a;color:#e8eaf0;font:18px system-ui;padding:60px"><h1>Returning to ChatHub…</h1><p id="status">Finishing your secure sign-in.</p><script>const data=location.hash.slice(1);history.replaceState(null,"","/callback");fetch("/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:data}).then(r=>{document.getElementById("status").textContent=r.ok?"Sign-in complete. You can close this tab.":"Sign-in failed. Return to ChatHub and try again."})</script>');
          return;
        }
        let params = url.searchParams;
        if (req.method === 'POST' && url.pathname === '/token' && provider === 'twitch') {
          if (req.headers.origin && req.headers.origin !== new URL(REDIRECT).origin) { res.writeHead(403).end(); return; }
          let body = '';
          for await (const chunk of req) { body += chunk; if (body.length > 16000) { res.writeHead(413).end(); return; } }
          params = new URLSearchParams(body);
        } else if (!(req.method === 'GET' && url.pathname === '/callback')) { res.writeHead(404).end(); return; }
        if (params.get('state') !== state) { res.writeHead(403).end('Invalid sign-in state.'); return; }
        if (params.has('error')) { res.writeHead(400).end('Sign-in was declined. Return to ChatHub.'); finish(new Error('Authorization was declined.')); return; }
        try {
          let token;
          if (provider === 'twitch') {
            const access_token = params.get('access_token');
            if (!access_token) throw new Error('No access token received.');
            const check = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${access_token}` }, signal: AbortSignal.timeout(15000) });
            if (!check.ok) throw new Error('Twitch could not validate this login.');
            const data = await check.json();
            if (data.client_id !== clientId || !TWITCH_SCOPES.slice(0, 2).every(s => data.scopes?.includes(s))) throw new Error('Twitch did not grant the required chat permissions.');
            token = { access_token, expires_at: Date.now() + data.expires_in * 1000, user_id: data.user_id, login: data.login, scopes: data.scopes };
          } else {
            const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code: params.get('code') || '', code_verifier: verifier, redirect_uri: REDIRECT, grant_type: 'authorization_code' }), signal: AbortSignal.timeout(15000) });
            token = await response.json();
            if (!response.ok || !token.access_token) throw new Error('Google token exchange failed. Check your Desktop OAuth client settings.');
            if (!token.scope?.split(' ').includes('https://www.googleapis.com/auth/youtube.force-ssl')) throw new Error('YouTube chat permission was not granted.');
            token.expires_at = Date.now() + token.expires_in * 1000;
          }
          if (!this.pending) { res.writeHead(410).end('This sign-in has expired.'); return; }
          res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end('Connected to ChatHub. You can close this tab.'); finish(null, token);
        } catch (error) { res.writeHead(400).end('Sign-in failed. Return to ChatHub.'); finish(error); }
      });
      server.requestTimeout = 20000;
      server.on('error', () => finish(new Error(`ChatHub could not listen on port ${CALLBACK_PORT}. Close another ChatHub instance or free this port.`)));
      server.listen(CALLBACK_PORT, '127.0.0.1', () => {
        const url = new URL(provider === 'twitch' ? 'https://id.twitch.tv/oauth2/authorize' : 'https://accounts.google.com/o/oauth2/v2/auth');
        url.search = new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT, response_type: provider === 'twitch' ? 'token' : 'code', state,
          scope: provider === 'twitch' ? TWITCH_SCOPES.join(' ') : 'https://www.googleapis.com/auth/youtube.force-ssl',
          ...(provider === 'youtube' ? { code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent' } : { force_verify: 'true' }) }).toString();
        Promise.resolve(this.openExternal(url.href)).catch(() => finish(new Error('Could not open the browser.')));
      });
      timer = setTimeout(() => finish(new Error('Sign-in timed out. Please try again.')), 180000);
    });
    return result;
  }
}
module.exports = { OAuth, REDIRECT, CALLBACK_PORT, TWITCH_SCOPES };
