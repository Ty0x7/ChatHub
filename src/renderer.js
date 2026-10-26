const $ = selector => document.querySelector(selector);
const hub = window.chatHub;
const providers = {
  youtube: { name: 'YouTube', logo: '▶', description: 'Live chat, with your community.', placeholder: 'https://www.youtube.com/@Ty0x7', label: 'YouTube channel URL or @handle', channel: 'Studio sessions', color: '#ff727d' },
  twitch: { name: 'Twitch', logo: '◩', description: 'Every emote. Every conversation.', placeholder: 'Your Twitch channel username', label: 'Channel username', channel: 'Late night, good company', color: '#c49afa' },
  kick: { name: 'Kick', logo: 'K', description: 'Your chat. Its own space.', placeholder: 'Your Kick channel username', label: 'Channel username', channel: 'Just hanging out', color: '#a2ec72' }
};
let state, messageStore = { youtube: [], twitch: [], kick: [] }, preview = false, previewPlatforms = ['youtube','twitch','kick'], toastTimer, loginPending = false;
const drafts = {}, sending = new Set();
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const logo = p => `<span class="provider-logo ${p}" aria-hidden="true">${providers[p].logo}</span>`;
const currentRooms = () => preview ? previewPlatforms.map(p => ({ provider: p, channel: p === 'youtube' ? 'Sample live stream' : 'sample_creator', visible: true })) : state.rooms.filter(r => r.visible);
async function request(action, payload) {
  const result = await hub.request(action, payload);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
function toast(message, error = false) {
  $('#toast').textContent = message; $('#toast').classList.toggle('error', error); $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, error ? 9000 : 4500);
}
function run(action) { return action().catch(error => toast(error.message, true)); }
function openDialog(id) {
  for (const other of document.querySelectorAll('dialog[open]')) other.close();
  const d = $(id); d.showModal(); request('modal', true).catch(() => {}); bounds();
}
function connections() { renderConnections(); openDialog('#connections-dialog'); }
function settings() {
  $('#setting-name').value = state.name; $('#setting-font').value = String(state.settings.fontSize);
  $('#setting-compact').checked = state.settings.compact; $('#setting-topmost').checked = state.settings.topmost;
  $('#setting-twitch').value = state.clients.twitch; $('#setting-youtube').value = state.clients.youtube;
  $('#setting-secret').value = ''; $('#setting-secret').placeholder = state.hasGoogleSecret ? 'Saved securely · leave blank to keep' : 'Paste the secret from your Desktop OAuth client';
  $('#settings-result').textContent = ''; openDialog('#settings-dialog');
}
function renderShell() {
  const rooms = currentRooms();
  $('#workspace-name').textContent = state.name;
  $('#room-count').textContent = rooms.length;
  $('#topmost').classList.toggle('selected', state.settings.topmost);
  $('#topmost').setAttribute('aria-pressed', String(state.settings.topmost));
  document.body.classList.toggle('compact', state.settings.compact);
  document.body.style.setProperty('--chat-size', `${state.settings.fontSize}px`);
  $('#preview-badge').hidden = !preview; $('#preview-toggle').textContent = preview ? 'Exit preview' : 'Preview layout';
  $('#subtitle').textContent = preview ? 'A look at your next stream. These conversations are fictional samples.' : 'Bring your chats together. Keep every community’s personality.';
  $('#layout-label').textContent = preview ? 'Layout preview' : 'Your workspace';
  $('#layout-note').textContent = rooms.length ? `${rooms.length === 1 ? 'Full width' : rooms.length === 2 ? 'Equal split' : 'Three columns'} · ${rooms.length} ${rooms.length === 1 ? 'platform' : 'platforms'}` : 'Ready when you are';
  $('#workspace-status').classList.toggle('ready', rooms.length > 0);
  $('#footer-count').textContent = preview ? 'Sample conversations · no live connections' : `${state.rooms.length} ${state.rooms.length === 1 ? 'platform' : 'platforms'} configured · ${state.rooms.filter(r => r.visible).length} visible`;
  $('#footer-status').textContent = state.offline ? 'Offline · reconnect when online' : 'Saved on this PC';
  $('#footer-right').textContent = preview ? 'Sample preview · sending disabled' : 'One workspace. Your communities. ↗';
  $('#platform-list').innerHTML = Object.entries(providers).map(([p, data]) => {
    const configured = preview ? previewPlatforms.includes(p) : state.rooms.some(r => r.provider === p);
    const visible = preview ? configured : state.rooms.some(r => r.provider === p && r.visible);
    return `<button class="platform-row ${configured ? 'configured' : ''} ${configured && !visible ? 'is-hidden' : ''}" data-platform="${p}" title="${configured ? 'Show or hide this chat' : 'Configure this platform'}" aria-pressed="${visible}">${logo(p)}<span>${data.name}</span><span class="side-state">${configured ? visible ? '◉' : '○' : '+'}</span></button>`;
  }).join('');
  $('#platform-list').querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
    const p = button.dataset.platform;
    if (preview) {
      if (previewPlatforms.includes(p)) previewPlatforms = previewPlatforms.filter(x => x !== p); else previewPlatforms.push(p);
      render();
    } else if (state.rooms.some(r => r.provider === p)) run(async () => { state = await request('toggle', p); render(); }); else connections();
  }));
}
function nativeRoom(room){return room.provider==='kick'||(room.provider==='twitch'&&room.mode!=='api');}
function render() {
  if(!state)return;renderShell();
  const rooms=currentRooms();$('#empty-state').hidden=rooms.length>0;$('#columns').hidden=rooms.length===0;
  if(!rooms.length){$('#columns').replaceChildren();bounds();return;}
  $('#columns').innerHTML=rooms.map(room=>{
    const p=room.provider,provider=providers[p],status=preview?{status:'sample',detail:'Fictional sample conversation'}:state.statuses[p]||{status:'connecting',detail:'Preparing chat…'};
    const native=!preview&&nativeRoom(room),canSend=!preview&&status.status==='live';
    const label=preview?provider.channel:p==='youtube'?room.channel:`#${room.channel}`;
    const badge=({sample:'SAMPLE',live:'LIVE CHAT',native:'CHAT VIEW',connecting:'LOADING',reconnecting:'RETRYING',setup:'SETUP NEEDED',signin:'SIGN IN',waiting:'WAITING',error:'ERROR',ended:'ENDED',idle:'DISCONNECTED'})[status.status]||'WAITING';
    const heading=status.status==='setup'?'Account setup needed':status.status==='signin'?'Sign in to YouTube':status.status==='waiting'?'Waiting for your next stream':status.status==='error'?'Connection needs attention':'Connecting chat…';
    const feed=preview||status.status==='live'||((messageStore[p]?.length||0)>0&&!['setup','signin'].includes(status.status));
    return `<section class="chat-column ${p}" data-provider="${p}" aria-label="${provider.name} chat"><div class="column-head"><div class="column-title"><h2>${provider.name}</h2><p>${escape(label)}</p></div><span class="column-status ${escape(status.status)}" title="${escape(status.detail)}"><i></i>${badge}</span></div>${native?`<div class="native-panel ${status.status==='error'?'error':''}" id="native-${p}" data-native="${p}"><p>${escape(status.status==='error'?status.detail:`Loading official ${provider.name} chat…`)}</p></div>`:feed?`${!preview&&status.status!=='live'?`<div class="connection-notice">${escape(status.detail)}</div>`:''}<div class="chat-feed" id="feed-${p}" role="log" aria-label="${provider.name} messages" aria-relevant="additions"></div><form class="composer" data-composer="${p}"><div class="composer-box"><input name="message" aria-label="Message ${provider.name}" placeholder="${preview?'Sample preview · sending disabled':canSend?`Message ${provider.name}…`:'Waiting for live chat…'}" maxlength="${p==='youtube'?200:500}" ${canSend&&!sending.has(p)?'':'disabled'} autocomplete="off"></div></form>`:`<div class="panel-empty"><h3>${heading}</h3><p>${escape(status.detail)}</p></div>`}</section>`;
  }).join('');
  for(const room of rooms){
    const p=room.provider,feed=$(`#feed-${p}`);
    if(feed){for(const message of preview?sampleMessages(p):messageStore[p]||[])feed.append(messageElement(p,message));feed.scrollTop=feed.scrollHeight;}
    const composer=$(`.chat-column[data-provider="${p}"] [data-composer]`);
    if(composer){
      const input=composer.elements.message;input.value=preview?'':drafts[p]||'';input.addEventListener('input',()=>drafts[p]=input.value);
      composer.addEventListener('submit',event=>{
        event.preventDefault();if(sending.has(p)||!input.value.trim()||preview)return;
        const text=input.value;sending.add(p);input.disabled=true;
        run(async()=>{try{await request('send',{provider:p,text});drafts[p]='';input.value='';}finally{sending.delete(p);if(input.isConnected){input.disabled=state.statuses[p]?.status!=='live';input.focus();}}});
      });
    }
  }
  requestAnimationFrame(bounds);
}
function messageElement(p, message) {
  const row = document.createElement('div'); row.className = `chat-message${message.highlight ? ' highlight' : ''}`; row.dataset.id = message.id; row.dataset.user = message.userId || '';
  if (message.highlight) { const badge = document.createElement('span'); badge.className = 'highlight-amount'; badge.textContent = `✦ ${message.highlight} · Super Chat`; row.append(badge); }
  const time = document.createElement('span'); time.className = 'message-time';
  const date = new Date(message.time); time.textContent = Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:false});
  row.append(time);
  if (message.badge) { const badge = document.createElement('span'); badge.className = 'message-badge'; badge.textContent = message.badge; row.append(badge); }
  const name = document.createElement('span'); name.className = 'author'; name.textContent = message.author;
  if (/^#[0-9a-f]{6}$/i.test(message.color || '')) name.style.color = message.color;
  row.append(name, document.createTextNode(message.text));
  if (!preview) {
    const actions = document.createElement('div'); actions.className = 'message-actions';
    for (const [actionName, label] of [['delete','Delete'],['timeout','Timeout 10m']]) {
      const button = document.createElement('button'); button.textContent = label; button.title = `${label}: ${message.author}`;
      button.addEventListener('click', () => run(async () => { const result = await request('moderate', { provider: p, action: actionName, id: message.id }); if (!result.cancelled) toast('Moderation action completed.'); })); actions.append(button);
    }
    row.append(actions);
  }
  return row;
}
function action(p, actionName) {
  if (actionName === 'configure') return connections();
  if (preview) return;
  if (actionName === 'signin') return login(p);
  if (['slow', 'slow-off'].includes(actionName)) return run(async () => { const result = await request('moderate', { provider: p, action: actionName }); if (!result.cancelled) toast(actionName === 'slow' ? 'Twitch slow mode enabled.' : 'Twitch slow mode disabled.'); });
  run(() => request(actionName, p));
}
function renderConnections() {
  $('#connection-cards').innerHTML=Object.entries(providers).map(([p,provider])=>{
    const room=state.rooms.find(r=>r.provider===p),index=state.rooms.findIndex(r=>r.provider===p),native=p==='kick'||(p==='twitch'&&room?.mode!=='api');
    const identity=state.identities?.[p];
    const account=native?'Login status is shown by the official chat':identity?.verified?`Verified account: ${identity.name}`:state.accounts[p]?'Saved authorization · awaiting verification':p==='youtube'&&!state.clients.youtube?'Google setup required':'Not authorized';
    const info=p==='youtube'?'Connect this channel once; ChatHub follows its active live broadcasts. YouTube only has live chat while a broadcast has chat enabled.':native?'Viewing a public channel does not log you into its account. Sign in here to send or moderate; no developer app is needed.':'Advanced API connection; requires a registered Twitch app and browser authorization.';
    return `<section class="connection-card" data-connection="${p}"><div class="connection-head">${logo(p)}<div><h3>${provider.name}</h3><small>${p==='youtube'?'Channel account · browser OAuth':native?'Official platform chat · isolated saved session':'Twitch EventSub · advanced API mode'}</small></div><span class="account-state">${escape(account)}</span><div class="order-controls">${room?`<button data-move="-1" title="Move ${provider.name} column left" ${index===0?'disabled':''}>←</button><button data-move="1" title="Move ${provider.name} column right" ${index===state.rooms.length-1?'disabled':''}>→</button>`:''}</div></div><p class="connection-explanation">${info}</p><form class="connection-form"><label class="field">${provider.label}<input name="channel" required autocomplete="off" placeholder="${provider.placeholder}" value="${escape(room?.channel||'')}"></label>${p==='twitch'?`<label class="field mode-field">Connection method<select name="mode"><option value="native" ${native?'selected':''}>Official chat · no app setup</option><option value="api" ${native?'':'selected'}>API · developer setup</option></select></label>`:''}<button class="button ${room?'subtle':'primary'}" type="submit">${room?'Save connection':'Add channel'}</button></form><div class="connection-actions"><button class="text-button" data-login ${loginPending?'disabled':''}>${p==='youtube'?'Sign in to Google ↗':`Open ${provider.name} login ↗`}</button>${!native&&(!state.clients[p]||(p==='youtube'&&!state.hasGoogleSecret))?`<button class="text-button" data-setup>Set up ${p==='youtube'?'YouTube':'API app'}</button>`:''}<span class="spacer"></span>${room?`<button class="text-button" data-visible>${room.visible?'Hide column':'Show column'}</button><button class="text-button" data-remove>Remove</button>`:''}${native||state.accounts[p]?'<button class="text-button" data-logout>Sign out / clear session</button>':''}</div><div class="connection-result" role="status">${escape(state.statuses[p]?.detail||'')}</div></section>`;
  }).join('');
  for (const card of $('#connection-cards').children) {
    const p = card.dataset.connection;
    const result = card.querySelector('.connection-result');
    card.querySelector('form').addEventListener('submit', event => {
      event.preventDefault(); const input = event.target.elements.channel;
      const button = event.target.querySelector('button'); button.disabled = true;
      request('room', { provider: p, channel: input.value,mode:event.target.elements.mode?.value }).then(s => {
        preview = false; state = s; render(); renderConnections(); toast(`${providers[p].name} added to your workspace.`);
      }).catch(error => { result.textContent = error.message; button.disabled = false; });
    });
    card.querySelector('[data-login]').addEventListener('click', () => login(p, result));
    card.querySelector('[data-setup]')?.addEventListener('click', settings);
    card.querySelector('[data-visible]')?.addEventListener('click', () => run(async () => { state = await request('toggle', p); render(); renderConnections(); }));
    card.querySelector('[data-remove]')?.addEventListener('click', () => run(async () => { state = await request('remove-room', p); render(); renderConnections(); }));
    card.querySelector('[data-logout]')?.addEventListener('click', () => run(async () => { state = await request('logout', p); render(); renderConnections(); toast(`${providers[p].name} local sign-in removed.`); }));
    card.querySelectorAll('[data-move]').forEach(button => button.addEventListener('click', () => run(async () => {
      const order = state.rooms.map(r => r.provider), i = order.indexOf(p), j = i + Number(button.dataset.move);
      if (j < 0 || j >= order.length) return;
      [order[i],order[j]] = [order[j],order[i]]; state = await request('order', order); render(); renderConnections();
    })));
  }
  if (loginPending) {
    const div = document.createElement('div'); div.className = 'inline-note'; div.textContent = 'Complete sign-in in your browser. ';
    const cancel = document.createElement('button'); cancel.className = 'text-button'; cancel.textContent = 'Cancel sign-in'; cancel.addEventListener('click', () => run(() => request('cancel-login'))); div.append(cancel); $('#connection-cards').prepend(div);
  }
}
async function login(p, result) {
  if (loginPending) return;
  const native=p==='kick'||(p==='twitch'&&state.rooms.find(r=>r.provider===p)?.mode!=='api');
  if (!native && (!state.clients[p]||(p==='youtube'&&!state.hasGoogleSecret))) { settings(); toast(`Add your ${providers[p].name} OAuth app ID, then sign in.`, true); return; }
  if (native) {run(()=>request('login',p));return;}
  loginPending = true; renderConnections();
  if (!$('#connections-dialog').open) openDialog('#connections-dialog');
  toast(`Continue ${providers[p].name} sign-in in your browser.`);
  try { const data = await request('login', p); if (data) state = data; toast(`${providers[p].name} account authorized.`); }
  catch (error) { toast(error.message, true); }
  finally { loginPending = false; render(); renderConnections(); }
}
function bounds(){
  const rects={};
  if(!preview&&!document.querySelector('dialog[open]'))for(const panel of document.querySelectorAll('[data-native]')){
    const p=panel.dataset.native;if(state?.statuses[p]?.status==='error')continue;const r=panel.getBoundingClientRect();rects[p]={x:r.x,y:r.y,width:r.width,height:r.height};
  }
  request('native-bounds',rects).catch(()=>{});
}
function togglePreview() { preview = !preview; previewPlatforms = ['youtube','twitch','kick']; render(); }
function sampleMessages(p) {
  const lines = {
    youtube: [ ['LunaMakes','The setup looks so good today ✨'], ['Arlo','First time catching a live. Hey everyone!'], ['ChatHub','Welcome in, Arlo. Make yourself at home.','MOD'], ['Mika','This is exactly the kind of stream I needed.'], ['pixelgarden','Three communities, one big conversation.'], ['Rae','Thanks for making this little corner of the internet.','','$5.00'], ['Theo','The background music is a vibe 🎵'], ['LunaMakes','Okay, what are we working on next?'], ['ChatHub','Grab something to drink. We’re just getting started.','HOST'], ['Arlo','Already feeling at home here.'] ],
    twitch: [ ['cozybyte','we are so back'], ['jules.exe','chat how are we feeling today?'], ['orbitals','excellent vibes in here'], ['nightowl','The desk tour when? 👀'], ['ChatHub','Welcome back, everyone!','MOD'], ['citruswave','this community is undefeated'], ['pixelpilot','Can confirm, the snacks are ready.'], ['mossy','Lurking while I finish this drawing 💜'], ['jules.exe','Show us when it’s done!'], ['nightowl','Multichat without the tab juggling. Love it.'], ['orbitals','Let’s gooooo'], ['cozybyte','settled in for the evening'] ],
    kick: [ ['westside','good evening everyone'], ['neon','KICK CHAT CHECKING IN 💚'], ['sunday','This layout is clean.'], ['ChatHub','Glad you’re here. Keep it kind.','MOD'], ['fern','What’s the plan for tonight?'], ['jay','Just got here, what did I miss?'], ['neon','Perfect timing, we’re about to start.'], ['sunday','Love having our own corner.'], ['westside','A little space for a big community.'], ['fern','Ready when you are ✌'] ]
  };
  return lines[p].map(([author,text,badge,highlight], i) => ({ id:`sample-${p}-${i}`, author, text, badge, highlight, time:`2026-10-26T20:${String(30 + Math.floor(i / 2)).padStart(2,'0')}:00`, color: i % 3 === 1 ? ['#b4c8e6','#ddc58c','#a9caaa'][i % 3] : null }));
}
hub.subscribe(event => {
  if(!state&&event.type!=='state')return;
  if (event.type === 'command') {
    if(event.command==='connections') connections();
    else if(event.command==='settings') settings();
    else if(event.command==='help') openDialog('#help-dialog');
    else if(event.command==='preview') togglePreview();
    else if(event.command==='preview-count') {preview=true;previewPlatforms=['youtube','twitch','kick'].slice(0,Math.max(1,Math.min(3,event.count)));render();}
    else if(event.command==='preview-exit') {preview=false;render();}
    else if(event.command==='login') login(event.provider);
    else if(event.command==='reconnect-one') run(()=>request('reconnect',event.provider));
    else if(event.command==='hide') run(async()=>{state=await request('toggle',event.provider);render();});
    else if(event.command==='reconnect') { for(const r of state.rooms.filter(r=>r.visible)) run(()=>request('reconnect',r.provider)); }
    else if(event.command==='moderate') run(async()=>{const result=await request('moderate',{provider:event.provider,id:event.id,action:event.action});if(!result.cancelled)toast('Moderation action completed.');});
  }
  else if (event.type === 'state') { state = event.state; render(); }
  else if (event.type === 'status') {
    if (!state) return;
    const old = state.statuses[event.provider]; state.statuses[event.provider] = {status:event.status,detail:event.detail};
    if (old?.status !== event.status || old?.detail!==event.detail) render();
  } else if(event.type==='identity'){state.identities||={};state.identities[event.provider]=event.identity;render();if($('#connections-dialog').open)renderConnections();}
  else if(event.type==='broadcast'){state.broadcasts||={};state.broadcasts[event.provider]=event.broadcast;}
  else if (event.type === 'message') {
    const list = messageStore[event.provider] ||= []; list.push(event.message); if (list.length > 500) list.shift();
    if (preview) return;
    const feed = $(`#feed-${event.provider}`); if (!feed) { render(); return; }
    const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 100;
    feed.append(messageElement(event.provider,event.message));
    while (feed.querySelectorAll('.chat-message').length > 500) feed.querySelector('.chat-message').remove();
    if (nearBottom) feed.scrollTop = feed.scrollHeight;
  } else if (event.type === 'clear') { messageStore[event.provider] = []; if (!preview) render(); }
  else if (event.type === 'remove') {
    const r = event.removal; messageStore[event.provider] = (messageStore[event.provider] || []).filter(m => r.id ? m.id !== r.id : m.userId !== r.userId);
    if (!preview) document.querySelectorAll(`#feed-${event.provider} .chat-message`).forEach(row => { if (r.id ? row.dataset.id === r.id : row.dataset.user === r.userId) row.remove(); });
  } else if (event.type === 'notice') toast(event.message, true);
});
for (const button of document.querySelectorAll('[data-window]')) button.addEventListener('click', () => run(() => request('window', button.dataset.window)));
for (const button of document.querySelectorAll('[data-doc]')) button.addEventListener('click', () => run(() => request('docs', button.dataset.doc)));
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('close', () => { const open = !!document.querySelector('dialog[open]'); request('modal', open).catch(() => {}); bounds(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
}
$('#nav-workspace').addEventListener('click', () => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); });
for (const id of ['nav-connections','add-platform','sidebar-add','help-connect']) $(`#${id}`).addEventListener('click', connections);
$('#nav-settings').addEventListener('click', settings); $('#nav-help').addEventListener('click', () => openDialog('#help-dialog'));
$('#preview-toggle').addEventListener('click', togglePreview); $('#preview-empty').addEventListener('click', togglePreview);
$('#reload-all').addEventListener('click', () => {
  if (preview) { render(); toast('Sample layout refreshed.'); return; }
  for (const r of state.rooms.filter(r => r.visible)) run(() => request('reconnect', r.provider));
});
$('#topmost').addEventListener('click', () => run(async () => { state = await request('settings', {settings:{...state.settings,topmost:!state.settings.topmost}}); renderShell(); }));
$('#settings-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const button = event.target.querySelector('[type="submit"]'); button.disabled = true;
    try {
      state = await request('settings', { name:$('#setting-name').value, settings:{fontSize:Number($('#setting-font').value),compact:$('#setting-compact').checked,topmost:$('#setting-topmost').checked}, clients:{twitch:$('#setting-twitch').value,youtube:$('#setting-youtube').value},googleSecret:$('#setting-secret').value });
      $('#setting-secret').value = ''; $('#settings-result').textContent = 'Saved on this PC'; render(); toast('Workspace settings saved.');
    } finally { button.disabled = false; }
  });
});
$('#onboarding-cards').innerHTML = Object.entries(providers).map(([p, data]) => `<button class="onboarding-card" data-onboarding="${p}">${logo(p)}<strong>${data.name}</strong><p>${data.description}</p><span class="card-action">Connect ${data.name}<span>↗</span></span></button>`).join('');
document.querySelectorAll('[data-onboarding]').forEach(button => button.addEventListener('click', () => { connections(); const card = $(`[data-connection="${button.dataset.onboarding}"]`); card.scrollIntoView({block:'nearest'}); card.querySelector('input').focus(); }));
window.addEventListener('resize', bounds);
window.addEventListener('contextmenu',event=>{
  event.preventDefault();
  if(document.querySelector('dialog[open]')) return;
  const column=event.target.closest('.chat-column'),message=event.target.closest('.chat-message');
  request('context',{provider:column?.dataset.provider,id:preview?null:message?.dataset.id}).catch(()=>{});
});
new ResizeObserver(bounds).observe($('#columns'));
window.addEventListener('online', () => { if (state) { state.offline = false; renderShell(); } });
window.addEventListener('offline', () => { if (state) { state.offline = true; renderShell(); } });
window.addEventListener('keydown', event => {
  if(!event.ctrlKey)return;
  const key=event.key.toLowerCase();
  if(key===','){event.preventDefault();settings();}
  else if(event.shiftKey&&key==='c'){event.preventDefault();connections();}
  else if(event.shiftKey&&key==='p'){event.preventDefault();togglePreview();}
  else if(event.shiftKey&&key==='r'){event.preventDefault();for(const r of state.rooms.filter(r=>r.visible))run(()=>request('reconnect',r.provider));}
});
run(async () => { const data = await request('state'); state = data.state; messageStore = {...messageStore,...data.messages}; render(); });
