const {test}=require('node:test');
const assert=require('node:assert/strict');
const {YouTubeChat,TwitchChat}=require('../src/providers.cjs');
test('YouTube gRPC protocol streams messages, resumes with cursor, propagates removals and ends cleanly',async()=>{
  const transport=require('../src/youtube-stream.cjs'),{grpc,service}=transport;
  const original=transport.createClient,server=new grpc.Server();let calls=0;
  server.addService(service.service,{
    streamList(call){
      calls++;assert.equal(call.metadata.get('authorization')[0],'Bearer fixture-token');
      assert.equal(call.request.liveChatId,'fixture-chat');assert.deepEqual(call.request.part,['id','snippet','authorDetails']);
      if(calls===1){
        assert.equal(call.request.pageToken,undefined);
        call.write({nextPageToken:'resume-1',items:[{id:'m1',authorDetails:{channelId:'viewer',displayName:'Viewer',isChatModerator:true},snippet:{type:'TEXT_MESSAGE_EVENT',displayMessage:'Test stream',publishedAt:'2026-10-26T20:00:00Z'}}]});call.end();
      }else{
        assert.equal(call.request.pageToken,'resume-1');
        call.write({nextPageToken:'resume-2',offlineAt:'2026-10-26T21:00:00Z',items:[{id:'m1',snippet:{type:'TOMBSTONE'}}]});call.end();
      }
    }
  });
  const port=await new Promise((resolve,reject)=>server.bindAsync('127.0.0.1:0',grpc.ServerCredentials.createInsecure(),(e,p)=>e?reject(e):resolve(p)));
  transport.createClient=()=>new service(`127.0.0.1:${port}`,grpc.credentials.createInsecure());
  const a=new YouTubeChat({access_token:'fixture-token',expires_at:Date.now()+3600000},'fixture-client','',()=>{});a.chatId='fixture-chat';
  const messages=[],removals=[],statuses=[];a.on('message',m=>messages.push(m));a.on('remove',r=>removals.push(r));a.on('status',s=>statuses.push(s));
  try{
    await a.stream();assert.equal(calls,2);assert.equal(messages[0].text,'Test stream');assert.equal(messages[0].badge,'MOD');assert.equal(removals[0].id,'m1');assert.equal(statuses.at(-1).status,'ended');
  }finally{a.stop();transport.createClient=original;await new Promise(r=>server.tryShutdown(r));}
});
test('Twitch EventSub subscribes once, deduplicates messages, migrates session and applies deletes',async()=>{
  const original=global.WebSocket,sockets=[];
  class Socket{
    constructor(url){this.url=url;this.handlers={};sockets.push(this);}
    addEventListener(name,fn){(this.handlers[name]||=[]).push(fn);}
    async emit(name,event){for(const fn of this.handlers[name]||[])await fn(event);}
    close(){this.closed=true;this.emit('close',{});}
    packet(type,payload){return this.emit('message',{data:JSON.stringify({metadata:{message_type:type,message_timestamp:'2026-10-26T20:00:00Z'},payload})});}
  }
  global.WebSocket=Socket;
  const a=new TwitchChat({user_id:'owner'},'client');a.validate=async()=>{};const requests=[];
  a.api=async(endpoint,method,body)=>{requests.push({endpoint,method,body});return endpoint.startsWith('users?')?{data:[{id:'owner'}]}:{};};
  const messages=[],removals=[];a.on('message',m=>messages.push(m));a.on('remove',r=>removals.push(r));
  try{
    await a.start('creator');const first=sockets[0];await first.packet('session_welcome',{session:{id:'session-1',keepalive_timeout_seconds:20}});
    assert.equal(requests.filter(r=>r.endpoint==='eventsub/subscriptions').length,4);
    const e={message_id:'one',chatter_user_id:'viewer',chatter_user_name:'Viewer',message:{text:'Hello'},badges:[]};
    await first.packet('notification',{subscription:{type:'channel.chat.message'},event:e});await first.packet('notification',{subscription:{type:'channel.chat.message'},event:e});assert.equal(messages.length,1);
    await first.packet('session_reconnect',{session:{reconnect_url:'wss://eventsub.wss.twitch.tv/ws?session=next'}});
    const next=sockets[1];await next.packet('session_welcome',{session:{id:'session-2'}});
    assert.equal(first.closed,true);assert.equal(requests.filter(r=>r.endpoint==='eventsub/subscriptions').length,4);
    await next.packet('notification',{subscription:{type:'channel.chat.message_delete'},event:{message_id:'one'}});assert.equal(removals[0].id,'one');
  }finally{a.stop();global.WebSocket=original;}
});
