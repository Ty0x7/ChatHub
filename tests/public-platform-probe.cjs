const{_electron:electron}=require('playwright');const path=require('node:path'),fs=require('node:fs');
(async()=>{
  const env={...process.env,CHATHUB_SMOKE_PROFILE:path.resolve(__dirname,'../artifacts/test-profiles/public-'+process.pid)};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({executablePath:process.env.CHATHUB_TEST_EXECUTABLE||require('electron'),args:[...(process.env.CHATHUB_TEST_EXECUTABLE?[]:[path.resolve(__dirname,'..')]),'--smoke-test'],env});
  const out=process.env.CHATHUB_TEST_OUTPUT||path.resolve(__dirname,'../artifacts/validation');fs.mkdirSync(out,{recursive:true});
  try{
    const page=await app.firstWindow();await page.waitForFunction(()=>window.chatHub);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    for(const[provider,channel]of[['twitch','ty0x7'],['kick','ty0x7'],['youtube','https://www.youtube.com/@Ty0x7']]){
      const r=await page.evaluate(data=>window.chatHub.request('room',data),{provider,channel});if(!r.ok)throw Error(r.error);
    }
    await page.waitForFunction(()=>['native','error'].includes(document.querySelector('.twitch .column-status')?.classList[1])&&['native','error'].includes(document.querySelector('.kick .column-status')?.classList[1]),{},{timeout:45000});
    await page.waitForTimeout(7000);
    const pages=await app.evaluate(async({webContents})=>{
      const results=[];
      for(const wc of webContents.getAllWebContents()){
        const url=wc.getURL();if(!/^https:\/\/(?:www\.)?(?:twitch\.tv|kick\.com)/.test(url))continue;
        let text='';try{text=await wc.executeJavaScript('document.body.innerText.slice(0,1800)');}catch{}
        results.push({url,title:wc.getTitle(),text});
      }return results;
    });
    const state=await page.evaluate(()=>window.chatHub.request('state'));
    // Native panels are inspected separately with Windows capture; CDP screenshots omit them.
    const loginPages=[];
    for(const provider of['twitch','kick']){
      await page.evaluate(p=>window.chatHub.request('login',p),provider);
      await page.waitForTimeout(5000);
      const details=await app.evaluate(async({BrowserWindow})=>{
        const child=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('https://'));
        if(!child)return{loaded:false};
        let text='';try{text=await child.webContents.executeJavaScript('document.body.innerText.slice(0,1200)');}catch{}
        const data={loaded:true,url:child.webContents.getURL(),title:child.webContents.getTitle(),text};child.destroy();return data;
      });loginPages.push({provider,...details});
    }
    const result={date:new Date().toISOString(),anonymousProfile:true,channelPages:pages,loginPages,statuses:state.data.state.statuses,accounts:state.data.state.accounts,rendererErrors:errors,signedInAccountVerified:false,limitations:'Read-only public-page and login-page checks; no credentials submitted, chat messages sent, or moderation performed.'};
    fs.writeFileSync(path.join(out,'public-platform-validation.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
