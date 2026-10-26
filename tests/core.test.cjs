const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { channel, sanitizeState, atomicWrite, readState, isKickURL, kickURL, visibleRooms } = require('../src/core.cjs');
test('provider URLs normalize only trusted input, including actual Kick popout URL', () => {
  assert.equal(channel('youtube', 'https://www.youtube.com/watch?v=abcdefghijk&x=1'), 'abcdefghijk');
  assert.equal(channel('youtube', 'https://youtu.be/abcdefghijk'), 'abcdefghijk');
  assert.equal(channel('youtube', 'https://youtube.com/live/abcdefghijk'), 'abcdefghijk');
  assert.equal(channel('twitch', 'https://www.twitch.tv/Some_Creator'), 'some_creator');
  assert.equal(kickURL('Creator'), 'https://kick.com/popout/creator/chat');
  assert.equal(channel('youtube','https://www.youtube.com/@Ty0x7'),'@Ty0x7');
  assert.equal(channel('youtube','https://youtube.com/@Ty0x7/live'),'@Ty0x7');
  assert.equal(channel('youtube','@Ty0x7'),'@Ty0x7');
  for (const value of ['https://youtube.com.evil.test/watch?v=abcdefghijk','javascript:alert(1)','https://evil.example/@Ty0x7','@ab','https://youtube.com/@Ty0x7/evil']) assert.throws(() => channel('youtube', value));
  for (const value of ['https://evil.test/foo','../foo','http://kick.com/foo','foo?script=1','<img>']) assert.throws(() => channel('kick', value));
  assert.equal(isKickURL('https://id.kick.com/oauth/authorize'), true);
  for (const value of ['https://kick.com.evil.test','file:///etc/passwd','https://evilkick.com','javascript:alert(1)']) assert.equal(isKickURL(value), false);
});
test('untrusted saved state cannot add providers, duplicate columns or unbounded settings', () => {
  const state = sanitizeState({rooms:[{provider:'twitch',channel:'mychannel'},{provider:'twitch',channel:'duplicate'},{provider:'kick',channel:'second',visible:false},{provider:'evil',channel:'foo'},{provider:'youtube',channel:'bad'}],settings:{fontSize:900,topmost:'true'},clients:{twitch:'id'}});
  assert.equal(state.rooms.length,2); assert.equal(visibleRooms(state).length,1); assert.equal(state.settings.fontSize,20); assert.equal(state.settings.topmost,false);
  assert.equal(state.rooms[0].mode,'native');
});
test('workspace round trips atomically and preserves a corrupted file for recovery', () => {
  const dir = fs.mkdtempSync(path.join(__dirname,'chathub-state-'));
  try {
    const file = path.join(dir,'workspace.json'); assert.equal(readState(file).rooms.length,0);
    atomicWrite(file,{name:'Night shift',rooms:[{provider:'twitch',channel:'creator',visible:true}]});
    assert.equal(readState(file).name,'Night shift'); assert.equal(fs.existsSync(file+'.tmp'),false);
    fs.writeFileSync(file,'broken'); assert.throws(() => readState(file),/preserved/); assert.equal(fs.readFileSync(file,'utf8'),'broken');
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
