const { test }=require('node:test');
const assert=require('node:assert/strict');
const { BaseChat, TwitchChat, YouTubeChat, jsonRequest }=require('../src/providers.cjs');
test('message deduplication is bounded and sending validates before transport',()=>{
  const a=new BaseChat({},'id'); let count=0; a.on('message',()=>count++);
  a.message({id:'one'});a.message({id:'one'});assert.equal(count,1);
  for(let i=0;i<2100;i++) a.message({id:String(i)}); assert.equal(a.seen.size,2000);
  assert.throws(()=>a.checkSend(' ',200));assert.throws(()=>a.checkSend('x'.repeat(201),200));
  a.checkSend('hello',200);assert.throws(()=>a.checkSend('too soon',200),/Wait/);
  a.stop();a.message({id:'stopped'});assert.equal(count,2101);
});
test('Twitch send failures stay failures; moderation targets authenticated user and selected message',async()=>{
  const a=new TwitchChat({user_id:'mod'},'client'); a.broadcaster='owner';let call;
  a.api=async(...args)=>{call=args;return{data:[{is_sent:false,drop_reason:{message:'Held by AutoMod'}}]};};
  await assert.rejects(a.send('hello'),/AutoMod/);
  await a.moderate('delete',{id:'message-1'});assert.match(call[0],/moderator_id=mod/);assert.match(call[0],/message_id=message-1/);assert.equal(call[1],'DELETE');
  await a.moderate('timeout',{userId:'viewer'});assert.equal(call[2].data.duration,600);assert.equal(call[2].data.user_id,'viewer'); a.stop();
});
test('YouTube discovers active chat, honors terminal errors, and refreshes once for concurrent requests',async()=>{
  const original=global.fetch;let refreshCount=0,saved;
  global.fetch=async(url)=>{
    if(String(url).includes('oauth2.googleapis.com')){refreshCount++;await new Promise(r=>setTimeout(r,10));return new Response(JSON.stringify({access_token:'fresh',expires_in:3600}),{status:200});}
    if(String(url).includes('/videos?'))return new Response(JSON.stringify({items:[{snippet:{title:'A live stream'},liveStreamingDetails:{activeLiveChatId:'chat-1'}}]}));
    if(String(url).includes('/channels?'))return new Response(JSON.stringify({items:[{id:'mine',snippet:{title:'Ty0x7'}}]}));
    return new Response(JSON.stringify({error:{message:'Quota exhausted'}}),{status:403});
  };
  try{
    const a=new YouTubeChat({refresh_token:'test-only',expires_at:0},'client','secret',t=>{saved=t;});
    a.stream=()=>a.poll(); // Explicitly exercise the documented UNIMPLEMENTED fallback here.
    await Promise.all([a.refresh(),a.refresh()]);assert.equal(refreshCount,1);assert.equal(saved.access_token,'fresh');
    const statuses=[];a.on('status',s=>statuses.push(s));await a.start('abcdefghijk');
    await new Promise(r=>setTimeout(r,30));assert.equal(a.chatId,'chat-1');assert.equal(statuses.at(-1).status,'error');assert.match(statuses.at(-1).detail,/quota/i);a.stop();
  }finally{global.fetch=original;}
});
test('transport errors do not expose raw token responses',async()=>{
  const original=global.fetch;global.fetch=async()=>new Response('<html>bad</html>',{status:502});
  try{await assert.rejects(jsonRequest('https://test.example'),/unreadable/);}finally{global.fetch=original;}
});
