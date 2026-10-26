const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const executable=process.env.CHATHUB_TEST_PORTABLE||path.resolve(__dirname,'../dist/ChatHub-'+require('../package.json').version+'-Windows-x64.exe');
  const profile=path.resolve(__dirname,'../artifacts/test-profiles/portable-'+process.pid);
  const env={...process.env,CHATHUB_SMOKE_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
  const started=Date.now(),port=49357;
  const child=spawn(executable,['--smoke-test',`--remote-debugging-port=${port}`],{env,windowsHide:true,stdio:'ignore'});
  let browser,page;
  try{
    for(let i=0;i<60;i++){
      try{const response=await fetch(`http://127.0.0.1:${port}/json/version`);if(response.ok)break;}catch{}
      if(i===59)throw new Error('Portable ChatHub did not start within 30 seconds.');await wait(500);
    }
    browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    page=browser.contexts()[0].pages()[0];await page.waitForFunction(()=>window.chatHub&&document.querySelector('#empty-state'));
    assert.equal(await page.locator('.sidebar').isVisible(),false);assert.equal(await page.locator('.titlebar').isVisible(),false);
    const runtime=await page.evaluate(()=>window.chatHub.request('test-runtime'));assert.equal(runtime.data.streaming,true);assert.equal(runtime.data.encrypted,true);
    const result={date:new Date().toISOString(),portableExecutableLaunched:true,chatOnly:true,protocolLoaded:true,encryptionAvailable:true,launchAndExtractionMs:Date.now()-started,liveProviderVerification:false};
    const out=process.env.CHATHUB_TEST_OUTPUT||path.resolve(__dirname,'../artifacts/validation');fs.mkdirSync(out,{recursive:true});
    fs.writeFileSync(path.join(out,'portable-validation.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  }finally{
    if(page)await page.evaluate(()=>window.chatHub.request('window','close')).catch(()=>{});
    if(browser)await browser.close().catch(()=>{});
    await wait(500);
    if(child.exitCode===null)child.kill();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
