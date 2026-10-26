const fs = require('node:fs');
const path = require('node:path');
const PROVIDERS = ['youtube', 'twitch', 'kick'];
function channel(provider, input) {
  if (!PROVIDERS.includes(provider)) throw new Error('Unknown platform.');
  const value = String(input || '').trim();
  if (provider === 'youtube') {
    let id = value;
    if (/^https:\/\//i.test(value)) {
      const u = new URL(value);
      if (u.hostname === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
      else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(u.hostname)) id = u.searchParams.get('v') || u.pathname.match(/^\/(?:live|shorts)\/([^/]+)/)?.[1] || decodeURIComponent(u.pathname).match(/^\/(@[^/]+)(?:\/(?:live|streams|featured|videos))?\/?$/)?.[1] || u.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})(?:\/live)?\/?$/)?.[1] || '';
      else throw new Error('Use your youtube.com channel URL, @handle, or a YouTube live video link.');
    }
    if (/^@[\p{L}\p{N}_.·-]{3,30}$/u.test(id) || /^UC[A-Za-z0-9_-]{22}$/.test(id)) return id;
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('Paste your YouTube channel URL (for example youtube.com/@Ty0x7), @handle, or a live video link.');
    return id;
  }
  let name = value.replace(/^[@#]/, '');
  if (/^https:\/\//i.test(value)) {
    const u = new URL(value);
    const hosts = provider === 'twitch' ? ['twitch.tv', 'www.twitch.tv'] : ['kick.com', 'www.kick.com'];
    if (!hosts.includes(u.hostname)) throw new Error(`Use a ${provider} channel URL or username.`);
    name = u.pathname.split('/').filter(Boolean)[0] || '';
  }
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_-]{1,39}$/.test(name)) throw new Error('Enter a valid channel username (2–40 letters, digits, underscores or hyphens).');
  return name.toLowerCase();
}
function defaultState() {
  return { version: 1, name: 'My workspace', rooms: [], settings: { topmost: false, compact: false, fontSize: 14 }, clients: { twitch: '', youtube: '' } };
}
function sanitizeState(raw) {
  const s = defaultState();
  if (!raw || typeof raw !== 'object') return s;
  s.name = typeof raw.name === 'string' ? raw.name.slice(0, 60) : s.name;
  s.clients = { twitch: String(raw.clients?.twitch || '').slice(0, 300), youtube: String(raw.clients?.youtube || '').slice(0, 300) };
  for (const r of Array.isArray(raw.rooms) ? raw.rooms : []) {
    if (!PROVIDERS.includes(r?.provider) || s.rooms.some(x => x.provider === r.provider)) continue;
    try { s.rooms.push({ provider: r.provider, channel: channel(r.provider, r.channel), visible: r.visible !== false, ...(r.provider === 'twitch' ? { mode: r.mode === 'api' ? 'api' : 'native' } : {}) }); } catch {}
  }
  s.settings = { topmost: raw.settings?.topmost === true, compact: raw.settings?.compact === true, fontSize: Math.min(20, Math.max(12, Number(raw.settings?.fontSize) || 14)) };
  return s;
}
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}
function readState(file) {
  try { return sanitizeState(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Your saved workspace could not be read. It has been preserved; close ChatHub and restore workspace.json from a backup.');
    return defaultState();
  }
}
function isKickURL(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && (u.hostname === 'kick.com' || u.hostname.endsWith('.kick.com')); } catch { return false; }
}
function kickURL(name) { return `https://kick.com/popout/${channel('kick', name)}/chat`; }
function isNativeURL(provider, value) {
  if(provider==='kick')return isKickURL(value);
  try {const u=new URL(value);return provider==='twitch'&&u.protocol==='https:'&&(u.hostname==='twitch.tv'||u.hostname.endsWith('.twitch.tv'));}catch{return false;}
}
function nativeURL(provider, name) {return provider==='kick'?kickURL(name):`https://www.twitch.tv/popout/${channel('twitch',name)}/chat?popout=`;}
function youtubeChannelTarget(value){return /^@/.test(value)||/^UC[A-Za-z0-9_-]{22}$/.test(value);}
function visibleRooms(state) { return state.rooms.filter(r => r.visible); }
module.exports = { PROVIDERS, channel, defaultState, sanitizeState, atomicWrite, readState, isKickURL, kickURL, isNativeURL, nativeURL, youtubeChannelTarget, visibleRooms };
