const{test}=require('node:test');const assert=require('node:assert/strict');
const{YouTubeChat}=require('../src/providers.cjs');const{isNativeURL,nativeURL,sanitizeState}=require('../src/core.cjs');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function adapter(){return new YouTubeChat({access_token:'fixture',expires_at:Date.now()+3600000},'fixture-client','',()=>{});}
test('existing Twitch rooms migrate to native chat; explicit API opt-in survives',()=>{
  assert.equal(sanitizeState({rooms:[{provider:'twitch',channel:'ty0x7'}]}).rooms[0].mode,'native');
  assert.equal(sanitizeState({rooms:[{provider:'twitch',channel:'ty0x7',mode:'api'}]}).rooms[0].mode,'api');
  assert.equal(nativeURL('twitch','ty0x7'),'https://www.twitch.tv/popout/ty0x7/chat?popout=');
  assert.equal(isNativeURL('twitch','https://passport.twitch.tv/login'),true);
  for(const url of['https://twitch.tv.evil.test/login','file:///tmp/test','http://www.twitch.tv/login','https://kick.com/login'])assert.equal(isNativeURL('twitch',url),false);
});
test('YouTube channel verifies the owning account and reports offline as waiting, not an auth failure',async()=>{
  const a=adapter(),calls=[],statuses=[],identities=[];
  a.api=async endpoint=>{calls.push(endpoint);if(endpoint.startsWith('channels?'))return{items:[{id:'UCowner',snippet:{title:'Ty0x7'}}]};return{items:[]};};
  a.on('status',s=>statuses.push(s));a.on('identity',i=>identities.push(i));
  try{await a.start('@Ty0x7');await pause(10);assert.equal(identities[0].name,'Ty0x7');assert.equal(identities[0].verified,true);assert.equal(statuses.at(-1).status,'waiting');assert.match(statuses.at(-1).detail,/Signed in as Ty0x7/);assert.ok(calls.some(c=>c.includes('forHandle=%40Ty0x7')));const query=calls.find(c=>c.startsWith('liveBroadcasts?'));assert.match(query,/broadcastStatus=active/);assert.equal(query.includes('mine='),false);assert.equal(calls.some(c=>c.startsWith('search?')),false);}finally{a.stop();await a.monitorPromise;}
});
test('YouTube channel auto-selects its active chat and checks later pages without a video URL',async()=>{
  const a=adapter(),calls=[];let selected;
  a.api=async endpoint=>{
    calls.push(endpoint);
    if(endpoint.startsWith('channels?'))return{items:[{id:'owner',snippet:{title:'Ty0x7'}}]};
    if(endpoint.includes('pageToken=next'))return{items:[{id:'live-video-id',snippet:{channelId:'owner',liveChatId:'live-chat-id',title:'Today’s stream'}}]};
    return{items:[{id:'another-account',snippet:{channelId:'other',liveChatId:'wrong-chat'}}],nextPageToken:'next'};
  };
  a.stream=async()=>{selected=a.chatId;a.stop();};
  try{await a.start('@Ty0x7');await a.monitorPromise;assert.equal(selected,'live-chat-id');assert.ok(calls.some(c=>c.includes('pageToken=next')));}finally{a.stop();}
});
test('YouTube rejects a mismatched Google or Brand Account instead of connecting someone else',async()=>{
  const a=adapter();a.api=async endpoint=>({items:[{id:endpoint.includes('mine=true')?'wrong-account':'target-account',snippet:{title:endpoint.includes('mine=true')?'Other channel':'Ty0x7'}}]});
  try{await assert.rejects(a.start('@Ty0x7'),/Signed in as Other channel.*Brand Account/);}finally{a.stop();}
});
test('YouTube revocation/quota failures stop discovery and remain actionable',async()=>{
  const a=adapter(),statuses=[];a.on('status',s=>statuses.push(s));
  a.api=async endpoint=>{if(endpoint.startsWith('channels?'))return{items:[{id:'owner',snippet:{title:'Ty0x7'}}]};const e=new Error('Google quota exhausted');e.status=403;throw e;};
  try{await a.start('@Ty0x7');await a.monitorPromise;assert.equal(statuses.at(-1).status,'error');assert.match(statuses.at(-1).detail,/quota/);assert.equal(a.fatal,true);}finally{a.stop();}
});
