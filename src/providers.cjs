const { EventEmitter } = require('node:events');
const { setTimeout: sleep } = require('node:timers/promises');
const { youtubeChannelTarget } = require('./core.cjs');
class APIError extends Error { constructor(message, status) { super(message); this.status = status; } }
async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(20000) });
  const text = await response.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { throw new APIError('The platform returned an unreadable response.', response.status); }
  if (!response.ok) {
    const detail = typeof data.message === 'string' ? data.message : typeof data.error?.message === 'string' ? data.error.message : '';
    throw new APIError(response.status === 401 ? 'Your login expired. Sign in again in Connections.' : response.status === 403 ? `Permission or quota denied. ${detail}` : response.status === 429 ? 'Platform rate limit reached. Wait before trying again.' : detail || `Platform request failed (${response.status}).`, response.status);
  }
  return data;
}
class BaseChat extends EventEmitter {
  constructor(token, clientId) { super(); this.token = token; this.clientId = clientId; this.controller = new AbortController(); this.seen = new Set(); this.stopped = false; this.lastSend = 0; }
  status(status, detail = '') { if (!this.stopped) this.emit('status', { status, detail }); }
  message(message) {
    if (this.stopped || this.seen.has(message.id)) return;
    this.seen.add(message.id); if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value);
    this.emit('message', message);
  }
  checkSend(text, max) {
    if (this.stopped) throw new Error('Reconnect this chat first.');
    if (typeof text !== 'string' || !text.trim() || [...text].length > max) throw new Error(`Messages must contain 1–${max} characters.`);
    if (Date.now() - this.lastSend < 1500) throw new Error('Wait a moment before sending another message.');
    this.lastSend = Date.now();
  }
  stop() { this.stopped = true; this.controller.abort(); }
}
class TwitchChat extends BaseChat {
  async api(endpoint, method = 'GET', body) {
    return jsonRequest(`https://api.twitch.tv/helix/${endpoint}`, { method, headers: { Authorization: `Bearer ${this.token.access_token}`, 'Client-Id': this.clientId, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(20000)]) });
  }
  async validate() {
    const data = await jsonRequest('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${this.token.access_token}` }, signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(15000)]) });
    if (data.client_id !== this.clientId || data.user_id !== this.token.user_id) throw new Error('Saved Twitch login does not match this application. Sign in again.');
  }
  async start(name) {
    this.name = name; this.status('connecting', 'Opening Twitch EventSub…');
    await this.validate();
    if (this.stopped) return;
    const user = (await this.api(`users?login=${encodeURIComponent(name)}`)).data?.[0];
    if (!user) throw new Error('That Twitch channel was not found.');
    if (this.stopped) return;
    this.broadcaster = user.id;
    this.validation = setInterval(() => this.validate().catch(e => { this.status('error', e.message); this.stop(); }), 55 * 60 * 1000);
    this.connect('wss://eventsub.wss.twitch.tv/ws', false);
  }
  connect(url, migration) {
    if (this.stopped) return;
    this.retryTimer && clearTimeout(this.retryTimer);
    const old = this.ws;
    const ws = new WebSocket(url);
    this.ws = ws;
    let welcomed = false;
    let lastActivity = Date.now(), keepalive = 30000;
    const watchdog = setInterval(() => { if (Date.now() - lastActivity > keepalive + 10000) ws.close(); }, 5000);
    ws.addEventListener('message', async event => {
      lastActivity = Date.now();
      let packet; try { packet = JSON.parse(String(event.data)); } catch { return; }
      try {
        const type = packet.metadata?.message_type;
        if (type === 'session_welcome') {
          welcomed = true; keepalive = (packet.payload.session.keepalive_timeout_seconds || 30) * 1000;
          if (!migration) {
            for (const [type, condition] of [
              ['channel.chat.message', { broadcaster_user_id: this.broadcaster, user_id: this.token.user_id }],
              ['channel.chat.message_delete', { broadcaster_user_id: this.broadcaster, user_id: this.token.user_id }],
              ['channel.chat.clear', { broadcaster_user_id: this.broadcaster, user_id: this.token.user_id }],
              ['channel.chat.clear_user_messages', { broadcaster_user_id: this.broadcaster, user_id: this.token.user_id }]
            ]) await this.api('eventsub/subscriptions', 'POST', { type, version: '1', condition, transport: { method: 'websocket', session_id: packet.payload.session.id } });
          }
          if (this.stopped || this.ws !== ws) { ws.close(); return; }
          old?.close(); this.retries = 0; this.status('live', `Connected to #${this.name}`);
        } else if (type === 'session_reconnect') {
          const next = packet.payload.session.reconnect_url;
          const parsed = new URL(next);
          if (parsed.protocol !== 'wss:' || parsed.hostname !== 'eventsub.wss.twitch.tv') throw new Error('Unexpected Twitch reconnect address.');
          this.connect(next, true);
        } else if (type === 'revocation') { throw new Error('Twitch revoked chat access. Sign in again.'); }
        else if (type === 'notification') {
          const e = packet.payload.event, subscription = packet.payload.subscription.type;
          if (subscription === 'channel.chat.message') {
            this.message({ id: e.message_id, userId: e.chatter_user_id, author: e.chatter_user_name, text: e.message.text, color: /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : null, badge: e.badges?.some(b => b.set_id === 'broadcaster') ? 'HOST' : e.badges?.some(b => b.set_id === 'moderator') ? 'MOD' : '', time: packet.metadata.message_timestamp });
          } else if (subscription === 'channel.chat.message_delete') this.emit('remove', { id: e.message_id });
          else if (subscription === 'channel.chat.clear_user_messages') this.emit('remove', { userId: e.target_user_id });
          else if (subscription === 'channel.chat.clear') this.emit('clear');
        }
      } catch (error) { if (!this.stopped) { this.status('error', error.message); this.stop(); } }
    });
    ws.addEventListener('error', () => {});
    ws.addEventListener('close', () => {
      clearInterval(watchdog);
      if (this.stopped || this.ws !== ws) return;
      // A migration may fail after the old session expires; rebuild subscriptions on a fresh session.
      this.status('reconnecting', 'Twitch connection interrupted. Reconnecting…');
      const delay = Math.min(30000, 1000 * 2 ** Math.min(this.retries || 0, 5)); this.retries = (this.retries || 0) + 1;
      this.retryTimer = setTimeout(() => this.connect('wss://eventsub.wss.twitch.tv/ws', false), delay);
    });
  }
  async send(text) {
    this.checkSend(text, 500);
    const data = await this.api('chat/messages', 'POST', { broadcaster_id: this.broadcaster, sender_id: this.token.user_id, message: text.trim() });
    if (!data.data?.[0]?.is_sent) throw new Error(data.data?.[0]?.drop_reason?.message || 'Twitch did not send this message.');
  }
  async moderate(action, message) {
    const query = new URLSearchParams({ broadcaster_id: this.broadcaster, moderator_id: this.token.user_id });
    if (action === 'delete') { query.set('message_id', message.id); await this.api(`moderation/chat?${query}`, 'DELETE'); }
    else if (action === 'timeout') await this.api(`moderation/bans?${query}`, 'POST', { data: { user_id: message.userId, duration: 600, reason: 'Timed out by a ChatHub moderator' } });
    else if (action === 'slow') await this.api(`chat/settings?${query}`, 'PATCH', { slow_mode: true, slow_mode_wait_time: 10 });
    else if (action === 'slow-off') await this.api(`chat/settings?${query}`, 'PATCH', { slow_mode: false });
    else throw new Error('Unsupported moderation action.');
  }
  stop() { super.stop(); clearInterval(this.validation); clearTimeout(this.retryTimer); this.ws?.close(); }
}
class YouTubeChat extends BaseChat {
  constructor(token, clientId, secret, onRefresh) { super(token, clientId); this.secret = secret; this.onRefresh = onRefresh; }
  async refresh() {
    if (this.token.expires_at > Date.now() + 60000) return;
    if (!this.token.refresh_token) throw new APIError('YouTube login expired. Sign in again.', 401);
    if (!this.refreshing) this.refreshing = (async () => {
      const data = await jsonRequest('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: this.clientId, client_secret: this.secret, refresh_token: this.token.refresh_token, grant_type: 'refresh_token' }), signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(15000)]) });
      this.token = { ...this.token, ...data, expires_at: Date.now() + data.expires_in * 1000 }; await this.onRefresh(this.token);
    })().finally(() => { this.refreshing = null; });
    await this.refreshing;
  }
  async api(endpoint, method = 'GET', body) {
    await this.refresh();
    return jsonRequest(`https://www.googleapis.com/youtube/v3/${endpoint}`, { method, headers: { Authorization: `Bearer ${this.token.access_token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(20000)]) });
  }
  async start(target) {
    this.target=target;this.channelMode=youtubeChannelTarget(target);
    this.status('connecting','Verifying your YouTube account…');
    const mine=await this.api('channels?part=id,snippet&mine=true');
    const owned=mine.items||[];
    if(!owned.length)throw new APIError('This Google account has no YouTube channel. Sign in again and choose the YouTube or Brand Account that owns your channel.',409);
    if(this.channelMode){
      const result=await this.api(`channels?part=id,snippet&${target.startsWith('@')?'forHandle':'id'}=${encodeURIComponent(target)}`);
      const selected=result.items?.[0];
      if(!selected)throw new APIError(`YouTube channel ${target} was not found. Check its channel URL.`,404);
      this.channelId=selected.id;
      this.identity=owned.find(c=>c.id===this.channelId);
      if(!this.identity)throw new APIError(`Signed in as ${owned.map(c=>c.snippet?.title||c.id).join(', ')}, but this connection is for ${selected.snippet?.title||target}. Sign in again and select that channel or its Brand Account.`,409);
    }else this.identity=owned[0];
    if(this.stopped)return;
    this.emit('identity',{id:this.identity.id,name:this.identity.snippet?.title||this.target,verified:true});
    this.monitorPromise=this.monitor().catch(error=>{if(!this.stopped){this.fatal=true;this.status('error',error.message);}});
  }
  async discover(){
    if(!this.channelMode){
      const data=await this.api(`videos?part=liveStreamingDetails,snippet&id=${encodeURIComponent(this.target)}`);
      if(!data.items?.length)throw new APIError('This YouTube video was not found.',404);
      const video=data.items[0],chatId=video.liveStreamingDetails?.activeLiveChatId;
      return chatId?{chatId,videoId:video.id||this.target,title:video.snippet?.title||'YouTube live chat'}:null;
    }
    // broadcastStatus and mine are mutually exclusive filters. An authenticated active query
    // enumerates this account's active broadcasts, and we additionally match the selected channel.
    let pageToken;
    for(let page=0;page<20;page++){
      const q=new URLSearchParams({part:'id,snippet,status',broadcastStatus:'active',broadcastType:'all',maxResults:'50'});
      if(pageToken)q.set('pageToken',pageToken);
      const data=await this.api(`liveBroadcasts?${q}`);
      const candidates=(data.items||[]).filter(b=>b.snippet?.channelId===this.channelId&&b.id!==this.endedVideoId);
      candidates.sort((a,b)=>String(b.snippet?.actualStartTime||b.snippet?.scheduledStartTime||'').localeCompare(String(a.snippet?.actualStartTime||a.snippet?.scheduledStartTime||'')));
      for(const broadcast of candidates){
        let chatId=broadcast.snippet.liveChatId;
        if(!chatId){const video=await this.api(`videos?part=liveStreamingDetails&id=${encodeURIComponent(broadcast.id)}`);chatId=video.items?.[0]?.liveStreamingDetails?.activeLiveChatId;}
        if(chatId)return{chatId,videoId:broadcast.id,title:broadcast.snippet.title||'YouTube live chat'};
      }
      pageToken=data.nextPageToken;if(!pageToken)break;
    }
    return null;
  }
  async monitor(){
    let failures=0;
    while(!this.stopped&&!this.fatal){
      let delay=60000;
      try{
        const broadcast=await this.discover();
        if(this.stopped)return;
        if(broadcast){
          this.chatId=broadcast.chatId;this.chatEnded=false;this.pageToken=undefined;this.refreshedAfterAuthError=false;this.seen.clear();
          this.emit('clear');this.emit('broadcast',broadcast);this.status('connecting',`Opening ${broadcast.title}`);
          await this.stream();if(this.stopped||this.fatal)return;
          if(this.chatEnded)this.endedVideoId=broadcast.videoId;
        }
        failures=0;
        this.status('waiting',`Signed in as ${this.identity.snippet?.title||this.target}. No active live chat. Waiting for your next stream; checking every minute.`);
      }catch(error){
        if(this.stopped)return;
        if([400,401,403,404,409].includes(error.status)){this.fatal=true;this.status('error',error.message);return;}
        failures++;delay=Math.min(60000,2000*2**Math.min(failures,5));this.status('reconnecting',`${error.message} Retrying in ${delay/1000}s…`);
      }
      try{await sleep(delay,undefined,{signal:this.controller.signal});}catch{return;}
    }
  }
  ingest(data) {
    if (this.stopped) return;
    this.pageToken = data.nextPageToken || this.pageToken;
    for (const m of data.items || []) {
      if (['messageDeletedEvent', 'TOMBSTONE'].includes(m.snippet?.type)) { this.emit('remove', { id: m.snippet.messageDeletedDetails?.deletedMessageId || m.id }); continue; }
      if (['userBannedEvent', 'USER_BANNED_EVENT'].includes(m.snippet?.type)) { this.emit('remove', { userId: m.snippet.userBannedDetails?.bannedUserDetails?.channelId }); continue; }
      if (['chatEndedEvent', 'CHAT_ENDED_EVENT'].includes(m.snippet?.type)) { this.chatEnded = true; continue; }
      if (!m.authorDetails || !m.snippet?.displayMessage) continue;
      this.message({ id:m.id,userId:m.authorDetails.channelId,author:m.authorDetails.displayName,text:m.snippet.displayMessage,badge:m.authorDetails.isChatOwner?'HOST':m.authorDetails.isChatModerator?'MOD':m.authorDetails.isChatSponsor?'MEMBER':'',time:m.snippet.publishedAt,highlight:m.snippet.superChatDetails?.amountDisplayString||'' });
    }
    if (data.offlineAt) this.chatEnded = true;
  }
  async stream() {
    const transport = require('./youtube-stream.cjs');
    this.grpcClient = transport.createClient();
    let failures = 0;
    while (!this.stopped && !this.chatEnded) {
      let delay = 1000;
      try {
        await this.refresh();
        if (this.stopped) break;
        await new Promise((resolve,reject) => {
          const call = transport.openStream(this.grpcClient,this.token.access_token,{liveChatId:this.chatId,part:['id','snippet','authorDetails'],...(this.pageToken?{pageToken:this.pageToken}:{})});
          this.grpcCall=call;
          call.on('data',data=>{
            if (this.stopped) return;
            this.ingest(data); failures=0;
            if (this.chatEnded) { this.status('ended','The YouTube live stream has ended.');call.cancel();resolve(); }
            else this.status('live','Connected through YouTube’s live chat stream');
          });
          call.on('error',reject);call.on('end',resolve);
        });
        if (!this.stopped && !this.chatEnded) this.status('reconnecting','Resuming YouTube live chat…');
      } catch(error) {
        if (this.stopped || this.chatEnded) break;
        if(error.code===9){this.chatEnded=true;this.status('ended','The YouTube live chat ended or was disabled. Watching for your next stream.');break;}
        if (error.status || [3,5,7,8].includes(error.code)) { this.fatal=true;this.status('error',`YouTube chat unavailable: ${error.details||error.message}`);break; }
        if (error.code===16) {
          if (this.refreshedAfterAuthError) {this.fatal=true; this.status('error','YouTube authorization failed. Sign in again.');break; }
          this.refreshedAfterAuthError=true;this.token.expires_at=0;
        }
        if (error.code===12) {
          this.grpcClient.close();this.grpcClient=null;
          this.status('reconnecting','Streaming unavailable. Using YouTube’s polling interval.');
          return this.poll();
        }
        failures++;delay=Math.min(60000,1000*2**Math.min(failures,6));
        this.status('reconnecting',`YouTube connection interrupted. Retrying in ${delay/1000}s…`);
      }
      if (this.stopped||this.chatEnded) break;
      try { await sleep(delay,undefined,{signal:this.controller.signal}); } catch { break; }
    }
    this.grpcClient?.close();this.grpcClient=null;
  }
  async poll() {
    let failures = 0;
    while (!this.stopped) {
      let delay = 5000;
      try {
        const q = new URLSearchParams({ liveChatId: this.chatId, part: 'snippet,authorDetails', maxResults: '200' });
        if (this.pageToken) q.set('pageToken', this.pageToken);
        const data = await this.api(`liveChat/messages?${q}`);
        if (this.stopped) return;
        this.ingest(data);
        failures = 0;
        if (this.chatEnded) { this.status('ended', 'The YouTube live stream has ended.'); return; }
        this.status('live', 'YouTube chat connected');
        delay = Math.max(5000, Number(data.pollingIntervalMillis) || 5000);
      } catch (error) {
        if (this.stopped) return;
        if ([400, 401, 403, 404].includes(error.status)) {this.fatal=true; this.status('error', error.message); return; }
        failures++; delay = Math.min(60000, 5000 * 2 ** Math.min(failures, 4));
        this.status('reconnecting', `${error.message} Retrying…`);
      }
      try { await sleep(delay, undefined, { signal: this.controller.signal }); } catch { return; }
    }
  }
  async send(text) {
    this.checkSend(text, 200);
    await this.api('liveChat/messages?part=snippet', 'POST', { snippet: { liveChatId: this.chatId, type: 'textMessageEvent', textMessageDetails: { messageText: text.trim() } } });
  }
  async moderate(action, message) {
    if (action === 'delete') await this.api(`liveChat/messages?id=${encodeURIComponent(message.id)}`, 'DELETE');
    else if (action === 'timeout') await this.api('liveChat/bans?part=snippet', 'POST', { snippet: { liveChatId: this.chatId, type: 'temporary', banDurationSeconds: 600, bannedUserDetails: { channelId: message.userId } } });
    else throw new Error('This control is available in YouTube Studio.');
  }
  stop() { super.stop();this.grpcCall?.cancel();this.grpcClient?.close();this.grpcClient=null; }
}
module.exports = { TwitchChat, YouTubeChat, jsonRequest, BaseChat, APIError };
