const { app, BrowserWindow, WebContentsView, ipcMain, shell, session, safeStorage, dialog, nativeTheme, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { channel, readState, atomicWrite, nativeURL, youtubeChannelTarget } = require('./core.cjs');
const { NativeHost } = require('./native-host.cjs');
const { OAuth } = require('./oauth.cjs');
const { TwitchChat, YouTubeChat, jsonRequest } = require('./providers.cjs');
const smoke = process.argv.includes('--smoke-test');
if (smoke) app.setPath('userData', process.env.CHATHUB_SMOKE_PROFILE || path.join(app.getPath('temp'), `chathub-smoke-${process.pid}`));
app.setName('ChatHub');
app.setAppUserModelId('com.chathub.desktop');
let win, state, secrets = {}, nativeHost, configFile, vaultFile;
const identities={},broadcasts={};
const adapters = new Map(), statuses = {}, messages = {};
const oauth = new OAuth(url => shell.openExternal(url));
const uiURL = pathToFileURL(path.join(__dirname, 'index.html')).href;
function publish(type, data) { if (win && !win.isDestroyed()) win.webContents.send('hub:event', { type, ...data }); }
function publicState() {
  return { ...state, accounts: { youtube: !!secrets.youtube?.access_token, twitch: !!secrets.twitch?.access_token }, hasGoogleSecret: !!secrets.googleSecret, statuses, identities, broadcasts, version: app.getVersion(), offline: !require('electron').net.isOnline() };
}
function save() { atomicWrite(configFile, state); publish('state', { state: publicState() }); }
function saveSecrets() {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable. Sign-in cannot be saved safely.');
  const encoded = safeStorage.encryptString(JSON.stringify(secrets)).toString('base64');
  atomicWrite(vaultFile, { version: 1, encrypted: encoded });
}
function setStatus(provider, status, detail = '') { statuses[provider] = { status, detail }; publish('status', { provider, status, detail }); }
function stopProvider(provider) {
  adapters.get(provider)?.stop(); adapters.delete(provider);
  nativeHost?.destroy(provider);
  delete identities[provider];delete broadcasts[provider];publish('identity',{provider,identity:null});publish('broadcast',{provider,broadcast:null});
  messages[provider] = []; publish('clear', { provider });
  setStatus(provider, 'idle', 'Not connected');
}
function openExternalSafe(value) {
  try { const u=new URL(value);if(['https:','http:'].includes(u.protocol)&&!['localhost','127.0.0.1'].includes(u.hostname))shell.openExternal(u.href).catch(()=>{}); }catch{}
}
function isNativeRoom(p){return p==='kick'||(p==='twitch'&&state.rooms.find(r=>r.provider===p)?.mode!=='api');}
async function startProvider(provider) {
  stopProvider(provider);
  const room = state.rooms.find(r => r.provider === provider);
  if (!room || !room.visible) return;
  messages[provider] = []; publish('clear', { provider });
  if (isNativeRoom(provider)) { await nativeHost.start(provider,room.channel); return; }
  if (!secrets[provider]?.access_token) {
    const missingClient=!state.clients[provider];
    setStatus(provider,missingClient?'setup':'signin',missingClient?(provider==='youtube'?'YouTube needs one-time Google app setup. Right-click → Connections → Set up YouTube. Add a Google Desktop OAuth client, then sign in as your channel.': 'Twitch API mode needs an app ID. Choose Official chat in Connections to view and sign in without developer setup.'):'Your channel is configured. Sign in through Connections to authorize this account.');return;
  }
  const adapter = provider === 'twitch' ? new TwitchChat({ ...secrets.twitch }, state.clients.twitch) : new YouTubeChat({ ...secrets.youtube }, state.clients.youtube, secrets.googleSecret || '', token => {
    if (adapters.get('youtube') === adapter) { secrets.youtube = token; saveSecrets(); }
  });
  adapters.set(provider, adapter);
  const active = () => adapters.get(provider) === adapter && !adapter.stopped;
  adapter.on('identity',identity=>{if(active()){identities[provider]=identity;publish('identity',{provider,identity});}});
  adapter.on('broadcast',broadcast=>{if(active()){broadcasts[provider]=broadcast;publish('broadcast',{provider,broadcast});}});
  adapter.on('status', data => { if (active()) setStatus(provider, data.status, data.detail); });
  adapter.on('message', message => {
    if (!active()) return;
    messages[provider].push(message); if (messages[provider].length > 500) messages[provider].shift();
    publish('message', { provider, message });
  });
  adapter.on('remove', removal => {
    if (!active()) return;
    messages[provider] = messages[provider].filter(m => removal.id ? m.id !== removal.id : m.userId !== removal.userId);
    publish('remove', { provider, removal });
  });
  adapter.on('clear', () => { if (active()) { messages[provider] = []; publish('clear', { provider }); } });
  try { await adapter.start(room.channel); } catch (error) { if (active()) { setStatus(provider, 'error', error.message); adapter.stop(); } }
}
function trusted(event) { return event.sender === win?.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === uiURL; }
function shortcut(event,input) {
  if (input.type !== 'keyDown' || !input.control) return;
  const key=input.key.toLowerCase();
  const command=key===','?'settings':input.shift&&key==='c'?'connections':input.shift&&key==='p'?'preview':input.shift&&key==='r'?'reconnect':null;
  if(command){event.preventDefault();publish('command',{command});}
}
function showMenu(provider, id, params) {
  const command=(command,extra={})=>()=>publish('command',{command,...extra});
  const selected=messages[provider]?.find(m=>m.id===id);
  const template=[];
  if(selected){template.push({label:`Delete message from ${selected.author}`,click:command('moderate',{provider,id,action:'delete'})},{label:`Timeout ${selected.author} · 10 minutes`,click:command('moderate',{provider,id,action:'timeout'})},{type:'separator'});}
  if(provider&&state.rooms.some(r=>r.provider===provider)) {
    template.push({label:`${provider==='youtube'?'YouTube':provider==='twitch'?'Twitch':'Kick'} controls`,submenu:[
      {label:'Sign in',click:command('login',{provider})},
      {label:'Reconnect chat',click:command('reconnect-one',{provider})},
      ...(provider==='twitch'&&!isNativeRoom(provider)?[{label:'Enable 10-second slow mode',click:command('moderate',{provider,action:'slow'})},{label:'Disable slow mode',click:command('moderate',{provider,action:'slow-off'})}]:[]),
      {label:'Open moderation dashboard',click:()=>{const r=state.rooms.find(r=>r.provider===provider);if(isNativeRoom(provider))nativeHost.dashboard(provider,r.channel);else openExternalSafe(provider==='youtube'?'https://studio.youtube.com/':`https://www.twitch.tv/moderator/${r.channel}`);}},
      {label:'Hide this chat',click:command('hide',{provider})}
    ]},{type:'separator'});
  }
  if(params?.isEditable){template.push({role:'cut'},{role:'copy'},{role:'paste'},{type:'separator'});}else if(params?.selectionText){template.push({role:'copy'},{type:'separator'});}
  template.push({label:'Connections…',accelerator:'Ctrl+Shift+C',click:command('connections')},{label:'Settings…',accelerator:'Ctrl+,',click:command('settings')},{type:'separator'},
    {label:'Always on top',type:'checkbox',checked:state.settings.topmost,click:()=>{state.settings.topmost=!state.settings.topmost;win.setAlwaysOnTop(state.settings.topmost);save();}},
    {label:'Reload visible chats',accelerator:'Ctrl+Shift+R',click:command('reconnect')},
    {label:'Sample chat preview',submenu:[{label:'One chat',click:command('preview-count',{count:1})},{label:'Two chats',click:command('preview-count',{count:2})},{label:'Three chats',click:command('preview-count',{count:3})},{label:'Exit preview',click:command('preview-exit')}]},
    {label:'Getting started',click:command('help')},{type:'separator'},
    {label:win.isMaximized()?'Restore window':'Maximize',click:()=>win.isMaximized()?win.unmaximize():win.maximize()},
    {label:'Minimize',click:()=>win.minimize()},{label:'Close ChatHub',accelerator:'Alt+F4',click:()=>win.close()});
  Menu.buildFromTemplate(template).popup({window:win});
}
function handle(name, callback) {
  ipcMain.handle(`hub:${name}`, async (event, payload) => {
    if (!trusted(event)) throw new Error('Untrusted request.');
    try { return { ok: true, data: await callback(payload) }; } catch (error) { return { ok: false, error: error.message || 'The action could not be completed.' }; }
  });
}
function setupIPC() {
  handle('state', () => ({ state: publicState(), messages }));
  handle('context', payload => showMenu(['youtube','twitch','kick'].includes(payload?.provider)?payload.provider:null,typeof payload?.id==='string'?payload.id:null));
  if(smoke) handle('test-runtime', () => ({ streaming:typeof require('./youtube-stream.cjs').service==='function',encrypted:safeStorage.isEncryptionAvailable() }));
  handle('settings', async payload => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid settings.');
    if (payload.clients && oauth.pending) throw new Error('Finish or cancel your current sign-in before changing platform app settings.');
    if (typeof payload.name === 'string') state.name = payload.name.trim().slice(0, 60) || 'My workspace';
    if (payload.settings) {
      state.settings.topmost = payload.settings.topmost === true; state.settings.compact = payload.settings.compact === true;
      state.settings.fontSize = Math.min(20, Math.max(12, Number(payload.settings.fontSize) || 14));
      win.setAlwaysOnTop(state.settings.topmost);
    }
    if (payload.clients) {
      for (const p of ['twitch', 'youtube']) {
        const value = String(payload.clients[p] || '').trim().slice(0, 300);
        if (state.clients[p] !== value) {
          stopProvider(p);
          const token = secrets[p]; if (token) await revoke(p, token, state.clients[p]);
          delete secrets[p]; state.clients[p] = value;
        }
      }
      if (typeof payload.googleSecret === 'string' && payload.googleSecret.trim()) secrets.googleSecret = payload.googleSecret.trim().slice(0, 500);
      saveSecrets();
    }
    save(); return publicState();
  });
  handle('room', async payload => {
    const p = payload?.provider, name = channel(p, payload?.channel);
    const existing = state.rooms.find(r => r.provider === p);
    if (existing) { existing.channel = name; existing.visible = true;if(p==='twitch')existing.mode=payload.mode==='api'?'api':'native'; } else state.rooms.push({ provider: p, channel: name, visible: true,...(p==='twitch'?{mode:payload.mode==='api'?'api':'native'}:{}) });
    save(); startProvider(p).catch(e => setStatus(p, 'error', e.message)); return publicState();
  });
  handle('toggle', async p => {
    const room = state.rooms.find(r => r.provider === p); if (!room) throw new Error('Configure this chat first.');
    room.visible = !room.visible;
    if (room.visible) startProvider(p).catch(e => setStatus(p, 'error', e.message)); else stopProvider(p);
    save(); return publicState();
  });
  handle('remove-room', p => { stopProvider(p); state.rooms = state.rooms.filter(r => r.provider !== p); save(); return publicState(); });
  handle('order', order => {
    if (!Array.isArray(order) || order.length !== state.rooms.length || new Set(order).size !== order.length || order.some(p => !state.rooms.some(r => r.provider === p))) throw new Error('Invalid column order.');
    state.rooms = order.map(p => state.rooms.find(r => r.provider === p)); save(); return publicState();
  });
  handle('login', async p => {
    if (['twitch','kick'].includes(p)&&isNativeRoom(p)) {nativeHost.login(p);return;}
    if(p==='youtube'&&!secrets.googleSecret)throw new Error('Add the Google Desktop OAuth client ID and client secret in Settings first. Then sign in through your browser.');
    if (!['youtube', 'twitch'].includes(p)) throw new Error('Unknown platform.');
    const client = state.clients[p];
    const token = await oauth.signIn(p, client, secrets.googleSecret || '');
    if (state.clients[p] !== client) throw new Error('Client settings changed during sign-in. Try again.');
    secrets[p] = token; saveSecrets(); save();
    await startProvider(p); return publicState();
  });
  handle('cancel-login', () => oauth.cancel());
  handle('logout', async p => {
    if (!['youtube','twitch','kick'].includes(p)) throw new Error('Unknown platform.');
    oauth.cancel(); stopProvider(p);
    if(['twitch','kick'].includes(p))await nativeHost.logout(p);
    const token=secrets[p];delete secrets[p];delete identities[p];delete broadcasts[p];saveSecrets();
    if(token)await revoke(p,token,state.clients[p]);
    if(isNativeRoom(p))startProvider(p).catch(e=>setStatus(p,'error',e.message));
    save(); return publicState();
  });
  handle('reconnect', async p => { if (!state.rooms.some(r => r.provider === p && r.visible)) throw new Error('Show this chat first.'); await startProvider(p); });
  handle('send', async payload => {
    const p = payload?.provider, adapter = adapters.get(p);
    if (!adapter || statuses[p]?.status !== 'live') throw new Error('Wait until this chat is connected.');
    await adapter.send(payload.text);
  });
  handle('moderate', async payload => {
    const p = payload?.provider, adapter = adapters.get(p);
    if (!adapter || statuses[p]?.status !== 'live') throw new Error('This chat is not connected.');
    const action = payload?.action;
    if (!['delete','timeout','slow','slow-off'].includes(action)) throw new Error('Unsupported control.');
    const message = messages[p]?.find(m => m.id === payload.id);
    if (['delete','timeout'].includes(action) && !message) throw new Error('This message is no longer in the local chat history.');
    const result = await dialog.showMessageBox(win, { type: 'question', buttons: ['Cancel', 'Confirm'], defaultId: 0, cancelId: 0, title: 'Confirm moderation', message: action === 'delete' ? `Delete this message from ${message.author}?` : action === 'timeout' ? `Time out ${message.author} for 10 minutes?` : action === 'slow' ? 'Enable 10-second slow mode on Twitch?' : 'Disable slow mode on Twitch?', detail: 'This changes the live platform chat and requires moderator permissions.' });
    if (result.response !== 1) return { cancelled: true };
    await adapter.moderate(action, message);
    if (action === 'delete') {
      messages[p] = messages[p].filter(m => m.id !== message.id); publish('remove', { provider: p, removal: { id: message.id } });
    }
    return { cancelled: false };
  });
  handle('dashboard',p=>{
    const r=state.rooms.find(r=>r.provider===p);if(!r)throw new Error('Configure this channel first.');
    if(isNativeRoom(p))nativeHost.dashboard(p,r.channel);
    else openExternalSafe(p==='youtube'?'https://studio.youtube.com/':`https://www.twitch.tv/moderator/${r.channel}`);
  });
  handle('external',p=>{
    const r=state.rooms.find(r=>r.provider===p);if(!r)throw new Error('Configure a chat first.');
    if(p==='youtube'){
      const video=broadcasts.youtube?.videoId;
      openExternalSafe(video?`https://www.youtube.com/live_chat?v=${video}`:youtubeChannelTarget(r.channel)?`https://www.youtube.com/${r.channel.startsWith('@')?encodeURI(r.channel):'channel/'+r.channel}/live`:`https://www.youtube.com/live_chat?v=${r.channel}`);
    }else openExternalSafe(nativeURL(p,r.channel));
  });
  handle('docs', key => {
    const urls = { twitch: 'https://dev.twitch.tv/console/apps', youtube: 'https://console.cloud.google.com/apis/credentials', guide: 'https://developers.google.com/youtube/data/live/guides/auth/installed-apps' };
    if (urls[key]) openExternalSafe(urls[key]);
  });
  handle('modal',open=>nativeHost.setModal(open===true));
  handle('native-bounds',rects=>{
    const clean={};for(const p of ['twitch','kick']){const r=rects?.[p];if(!r)continue;
      if(!['x','y','width','height'].every(k=>typeof r[k]==='number'&&Number.isFinite(r[k])))throw new Error('Invalid chat bounds.');clean[p]=r;
    }nativeHost.setBounds(clean);
  });
  handle('window', command => { if (command === 'minimize') win.minimize(); else if (command === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize(); else if (command === 'close') win.close(); });
}
async function revoke(p, token, clientId) {
  try {
    const url = p === 'twitch' ? 'https://id.twitch.tv/oauth2/revoke' : 'https://oauth2.googleapis.com/revoke';
    const response = await fetch(url, { method: 'POST', body: new URLSearchParams(p === 'twitch' ? { client_id: clientId, token: token.access_token } : { token: token.refresh_token || token.access_token }), signal: AbortSignal.timeout(10000) });
    if (!response.ok && response.status !== 400) throw new Error('Revocation failed');
  } catch { publish('notice', { message: 'Local sign-in removed. The platform could not confirm revocation; remove ChatHub in the platform’s connected-app settings if needed.' }); }
}
async function boot() {
  configFile = path.join(app.getPath('userData'), 'workspace.json'); vaultFile = path.join(app.getPath('userData'), 'credentials.json');
  state = readState(configFile);
  if (fs.existsSync(vaultFile)) {
    try { secrets = JSON.parse(safeStorage.decryptString(Buffer.from(JSON.parse(fs.readFileSync(vaultFile, 'utf8')).encrypted, 'base64'))); }
    catch { dialog.showErrorBox('ChatHub credentials', 'Saved credentials could not be unlocked. The original file is preserved. Close ChatHub and restore credentials.json from backup, or move it aside to sign in again.'); app.quit(); return; }
  }
  nativeTheme.themeSource = 'dark';
  win = new BrowserWindow({ title: 'ChatHub', width: 1150, height: 800, minWidth: 360, minHeight: 300, frame: false, backgroundColor: '#0c0e12', show: false, icon: path.join(__dirname, '../assets/chathub.ico'), autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true, navigateOnDragDrop: false, spellcheck: true } });
  nativeHost=new NativeHost(win,{status:setStatus,shortcut,menu:showMenu,external:openExternalSafe});
  win.setAlwaysOnTop(state.settings.topmost); win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('before-input-event', (event,input) => shortcut(event,input));
  win.on('system-context-menu', event=>{event.preventDefault();showMenu();});
  win.webContents.session.setPermissionRequestHandler((_wc, _p, callback) => callback(false));
  win.on('closed', () => { oauth.cancel(); for (const adapter of adapters.values()) adapter.stop(); adapters.clear(); nativeHost?.destroyAll(); });
  setupIPC();
  await win.loadFile(path.join(__dirname, 'index.html'));
  win.show();
  if (!smoke) for (const room of state.rooms) if (room.visible) startProvider(room.provider).catch(e => setStatus(room.provider, 'error', e.message));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(boot).catch(error => { dialog.showErrorBox('ChatHub could not start', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { oauth.cancel(); for (const a of adapters.values()) a.stop(); });
}
