const {BrowserWindow,WebContentsView,session}=require('electron');
const path=require('node:path');
const {isNativeURL,nativeURL}=require('./core.cjs');
// Platform sessions are independent. A loaded public page never proves account authorization.
class NativeHost {
  constructor(win,{status,shortcut,menu,external}){
    this.win=win;this.status=status;this.shortcut=shortcut;this.menu=menu;this.external=external;
    this.views=new Map();this.rects={};this.windows=new Map();this.modal=false;
    for(const p of ['twitch','kick']){
      const s=session.fromPartition(`persist:chathub-${p}`);
      s.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));s.setPermissionCheckHandler(()=>false);
      s.on('will-download',event=>event.preventDefault());
    }
  }
  preferences(p){return{partition:`persist:chathub-${p}`,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,navigateOnDragDrop:false,backgroundThrottling:true};}
  secure(contents,p){
    contents.on('before-input-event',(e,i)=>this.shortcut(e,i));
    contents.on('context-menu',(_e,params)=>this.menu(p,null,params));
    contents.on('will-navigate',(e,url)=>{if(!isNativeURL(p,url)){e.preventDefault();this.external(url);}});
    contents.on('will-redirect',(e,url)=>{if(!isNativeURL(p,url))e.preventDefault();});
    contents.setWindowOpenHandler(({url})=>{
      if(isNativeURL(p,url))return{action:'allow',overrideBrowserWindowOptions:{title:`${p==='twitch'?'Twitch':'Kick'} · ChatHub`,width:1050,height:800,autoHideMenuBar:true,webPreferences:this.preferences(p)}};
      this.external(url);return{action:'deny'};
    });
    contents.on('did-create-window',child=>{this.secure(child.webContents,p);this.track(child,p);});
    contents.on('will-prevent-unload',e=>e.preventDefault());
  }
  track(child,p){
    this.windows.set(child,p);child.setMenuBarVisibility(false);
    child.on('closed',()=>{this.windows.delete(child);const view=this.views.get(p);if(view&&!view.webContents.isDestroyed())view.webContents.reload();});
  }
  open(p,url,title){
    const child=new BrowserWindow({parent:this.win,title,width:1050,height:800,autoHideMenuBar:true,icon:path.join(__dirname,'../assets/chathub.ico'),webPreferences:this.preferences(p)});
    this.secure(child.webContents,p);this.track(child,p);child.loadURL(url).catch(()=>{});return child;
  }
  login(p){return this.open(p,p==='twitch'?'https://www.twitch.tv/login':'https://kick.com/',`Sign in to ${p==='twitch'?'Twitch':'Kick'} · ChatHub`);}
  dashboard(p,name){return this.open(p,p==='twitch'?`https://www.twitch.tv/moderator/${name}`:'https://dashboard.kick.com/',`${p==='twitch'?'Twitch':'Kick'} moderation · ChatHub`);}
  async start(p,name){
    this.destroy(p);
    const view=new WebContentsView({webPreferences:this.preferences(p)});this.views.set(p,view);
    view.setBackgroundColor('#101216');view.webContents.setAudioMuted(true);this.secure(view.webContents,p);
    this.win.contentView.addChildView(view);view.setVisible(false);
    this.status(p,'connecting',`Opening official ${p==='twitch'?'Twitch':'Kick'} chat…`);
    view.webContents.on('did-finish-load',()=>{if(this.views.get(p)===view)this.status(p,'native','Channel chat page loaded. This does not verify an account login; the official chat shows whether you are signed in.');});
    view.webContents.on('did-fail-load',(_e,code,description,_url,main)=>{if(main&&code!==-3&&this.views.get(p)===view){view.setVisible(false);this.status(p,'error',`${p==='twitch'?'Twitch':'Kick'} could not load (${description}). Right-click to reconnect or open your channel in the browser.`);}});
    view.webContents.on('render-process-gone',()=>{if(this.views.get(p)===view){this.destroy(p);this.status(p,'error','The platform chat process stopped. Right-click to reconnect.');}});
    this.apply(p);await view.webContents.loadURL(nativeURL(p,name)).catch(()=>{});
  }
  apply(p){
    const view=this.views.get(p),r=this.rects[p];if(!view)return;
    if(this.modal||!r||r.width<10||r.height<10){view.setVisible(false);return;}
    const[w,h]=this.win.getContentSize(),x=Math.max(0,Math.round(r.x)),y=Math.max(0,Math.round(r.y));
    const width=Math.max(0,Math.min(w-x,Math.round(r.width))),height=Math.max(0,Math.min(h-y,Math.round(r.height)));
    view.setBounds({x,y,width,height});view.setVisible(width>0&&height>0);
  }
  setBounds(rects){this.rects=rects;for(const p of this.views.keys())this.apply(p);}
  setModal(open){this.modal=open;for(const p of this.views.keys())this.apply(p);}
  destroy(p){const view=this.views.get(p);if(!view)return;this.views.delete(p);if(!this.win.isDestroyed())this.win.contentView.removeChildView(view);if(!view.webContents.isDestroyed())view.webContents.close();}
  async logout(p){
    this.destroy(p);for(const[child,provider]of[...this.windows])if(p===provider)child.destroy();
    const s=session.fromPartition(`persist:chathub-${p}`);await s.clearStorageData();await s.clearCache();
  }
  destroyAll(){for(const p of [...this.views.keys()])this.destroy(p);for(const child of this.windows.keys())if(!child.isDestroyed())child.destroy();}
}
module.exports={NativeHost};
