/* Shared browser harness: native loaders, real React, the real Hermes UI kit and the
 * native authenticated Python API over a fictional profile. SDK host state/IPC
 * boundaries are doubles; this is NOT Electron QA. Used by the regression
 * matrix (saved-browser.mjs) and by the preview renderer (scripts/preview.mjs).
 */
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {realUI} from './native-components.mjs';
import {mkdtemp, readFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {chromium} from '@playwright/test';

export const root=resolve('.');
export const source=process.env.HERMES_SOURCE||join(process.env.HOME,'.hermes/hermes-agent');
export const peer=process.env.SAVED_PEER_REPO||resolve(root,'..',root.endsWith('bookmarks')?'hermes-delivery-shelf':'hermes-conversation-bookmarks');
export const auth={'X-Hermes-Session-Token':'fictional-test-session','Content-Type':'application/json'};
// Names every plugin bundle may import from 'react' through the harness import map.
const REACT_NAMES='useState,useEffect,useLayoutEffect,useRef,useId,useMemo,useCallback,Fragment';
// Host doors the Desktop SDK double provides beyond the real UI kit.
const SDK_NAMES='host,useValue,atom,COMPOSER_AREAS,TITLEBAR_AREAS,PALETTE_AREA,ROUTES_AREA,SIDEBAR_NAV_AREA,KEYBINDS_AREA,SESSION_ROW_AREAS';

/** Build both host pages once, then start/stop one fictional backend per scenario. */
export async function createHarness(){
 // Fail before starting a browser/server, rather than silently testing old or absent UI.
 for(const repo of [root,peer]){
  try{for(const file of ['ui/Saved.jsx','desktop/plugin.js','dashboard/dist/index.js','tests/saved-browser.mjs'])await readFile(join(repo,file));}
  catch{throw new Error('Paired Saved verification requires both built local repositories. Set SAVED_PEER_REPO; see docs/SAVED_UI.md. Missing inputs in '+repo);}
 }
const scratch=await mkdtemp(join(process.env.TMPDIR||tmpdir(),'q-'));
const port=await new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const ui=await realUI(source);
const requireHost=createRequire(join(source,'package.json'));
const common=`import React from 'react';import {createRoot} from 'react-dom/client';
window.__QA_REACT__=React;
const root=createRoot(document.getElementById('root'));
window.__QA_REQUESTS__=[];
async function fetchJSON(path,opts={}) {
 window.__QA_REQUESTS__.push({path,method:opts.method||'GET'});
 const response=await fetch(path,{...opts,headers:{...opts.headers,'X-Hermes-Session-Token':'fictional-test-session'}});
 const data=await response.json();if(!response.ok){
  if(location.pathname.startsWith('/qa/desktop'))throw new Error("Error invoking remote method 'hermes:api': Error: "+response.status+': '+JSON.stringify(data));
  throw Object.assign(new Error(typeof data.detail==='string'?data.detail:'Request refused'),{status:response.status});
 }return data;
}
window.__QA_FETCH__=fetchJSON;
`;
const apiStub=`export const HERMES_BASE_PATH='';export const fetchJSON=(...a)=>window.__QA_FETCH__(...a);export const authedFetch=fetchJSON;export const buildWsUrl=()=>'';export const buildWsAuthParam=()=>'';export const api={getPlugins:async(profile)=>(await fetchJSON('/api/dashboard/plugins?profile='+profile))};`;
const dashEntry=common+`
import {exposePluginSDK,getPluginComponent,onPluginRegistered} from '${source}/web/src/plugins/registry.ts';
import {PluginSlot} from '${source}/web/src/plugins/slots.ts';
import {usePlugins} from '${source}/web/src/plugins/usePlugins.ts';
${ui.dashboardBootstrap}
exposePluginSDK();
function App(){
 const [profile,setProfile]=React.useState('default');window.__QA_PROFILE__=setProfile;
 const [collapsed,setCollapsed]=React.useState(false);window.__QA_COLLAPSE__=setCollapsed;
 const {manifests,loading}=usePlugins(profile);window.__QA_MANIFESTS__=manifests;window.__QA_READY__=!loading;
 const name=manifests.find(m=>m.tab.path===location.pathname)?.name||manifests[0]?.name;
 const Component=React.useSyncExternalStore(onPluginRegistered,()=>getPluginComponent(name)||null);
 // Official App.tsx:577 banner is outside sidebar; :612-618 hides header-left.
 return <><nav aria-label="Native banner slot"><PluginSlot name="header-banner"/></nav><aside><div style={{display:collapsed?'none':'flex'}}><PluginSlot name="header-left"/></div></aside>{Component?<Component/>:<p>Native Dashboard loader…</p>}</>;
}
root.render(<App/>);
window.__QA_UNMOUNT__=()=>root.unmount();
`;
const sdkStub=`${ui.imports}
import React from 'react';import {atom} from 'nanostores';
export const host={state:{profile:atom('default'),connectionId:atom('fixture'),focusedSessionOwner:atom({connectionId:'fixture',profile:'default'}),focusedStoredSessionId:atom('fictional-session-01')},navigate:path=>{window.__QA_NAVIGATED__=path;},openSession:async(id,options)=>{window.__QA_OPENED__={id,options};},notify:input=>{(window.__QA_NOTICES__||=[]).push(input);},composer:{insertText:async(session,text,opts)=>{if(window.__QA_NO_COMPOSER__)return false;(window.__QA_INSERTED__||=[]).push({session,text,opts});return true;}}};
export const useValue=a=>React.useSyncExternalStore(a.subscribe,a.get,a.get);
export {atom};export const COMPOSER_AREAS={attachments:'composer.attachments'},TITLEBAR_AREAS={center:'titleBar.center'},PALETTE_AREA='palette';
export const ROUTES_AREA='routes',SIDEBAR_NAV_AREA='sidebar.nav',KEYBINDS_AREA='keybinds',SESSION_ROW_AREAS={leading:'sessionRow.leading',trailing:'sessionRow.trailing'};
window.__QA_SDK__={${SDK_NAMES},${ui.names.join(',')}};
export function installPluginSdk(){}
const blob=s=>URL.createObjectURL(new Blob([s],{type:'text/javascript'}));
export const sdkImportMap=()=>({
 'react':blob('export default window.__QA_REACT__;export const {${REACT_NAMES}}=window.__QA_REACT__;'),
 '@hermes/plugin-sdk':blob('export const {${SDK_NAMES},${ui.names.join(',')}}=window.__QA_SDK__;')
});`;
const contextStub=`export const declaredCapabilities=()=>[];
import {registry} from '${source}/apps/desktop/src/contrib/registry.ts';
import {settingsPageContribution} from '${source}/apps/desktop/src/contrib/settings-pages.ts';
export function createPluginContext(id,track){const registerMany=items=>{const dispose=registry.registerMany(items.map(c=>({...c,id:id+':'+c.id,source:'plugin:'+id})));track(dispose);return dispose;};return {registerMany,registerSettingsPage:page=>registerMany([settingsPageContribution(page)]),onDispose:track,os:{writeClipboard:async(text)=>{window.__QA_CLIPBOARD__=text;return true;}},rest:(path,opts={})=>window.__QA_FETCH__('/api/plugins/'+id+path,{method:opts.method||'GET',headers:opts.body?{'Content-Type':'application/json'}:undefined,body:opts.body?JSON.stringify(opts.body):undefined})};}`;
const desktopEntry=common+`
${ui.nativeBootstrap}
import {loadRuntimePlugin,unloadRuntimePlugin} from '${source}/apps/desktop/src/contrib/runtime-loader.ts';
import {registry,$registryVersion} from '${source}/apps/desktop/src/contrib/registry.ts';
import {setPluginEnabled,$pluginRecords} from '${source}/apps/desktop/src/contrib/plugins-store.ts';
window.__QA_REGISTRY__=registry;
// Preview fidelity: paint a built-in skin the way the app's theme provider does.
import {BUILTIN_THEMES} from '${source}/apps/desktop/src/themes/presets.ts';
window.__QA_THEME__=(skin='nous',mode='light')=>{
 const theme=BUILTIN_THEMES[skin]||BUILTIN_THEMES.nous,dark=mode==='dark',c=dark?(theme.darkColors??theme.colors):theme.colors,mid=c.midground??c.ring,root=document.documentElement;
 const vars={'--theme-foreground':c.foreground,'--theme-primary':c.primary,'--theme-secondary':c.secondary,'--theme-accent-soft':c.accent,'--theme-midground':mid,'--theme-warm':c.primary,'--theme-background-seed':c.background,'--theme-sidebar-seed':c.sidebarBackground??c.background,'--theme-card-seed':c.card,'--theme-elevated-seed':c.popover,'--theme-bubble-seed':c.userBubble??c.popover,
  '--theme-mix-chrome':dark?'74%':'92%','--theme-mix-sidebar':'100%','--theme-mix-card':dark?'38%':'22%','--theme-mix-elevated':dark?'46%':'28%','--theme-mix-bubble':dark?'46%':'0%',
  '--dt-primary-foreground':c.primaryForeground,'--dt-secondary-foreground':c.secondaryForeground,'--dt-accent-foreground':c.accentForeground,'--dt-border':c.border,'--dt-input':c.input,'--dt-ring':c.ring,'--dt-muted':c.muted,'--dt-composer-ring':c.composerRing??mid,'--dt-destructive':c.destructive,'--dt-destructive-foreground':c.destructiveForeground};
 for(const [k,v] of Object.entries(vars))if(v)root.style.setProperty(k,v);
 root.style.setProperty('color-scheme',mode);root.dataset.hermesMode=mode;root.classList.toggle('dark',dark);
};
window.__QA_HISTORY__=[];
registry.subscribe(()=>{window.__QA_HISTORY__.push({routes:registry.getArea('routes').length,nav:registry.getArea('sidebar.nav').length});});
const fixture=await fetchJSON('/api/qa/fixture');
const ids=new URLSearchParams(location.search).get('order')==='reverse'?[...fixture.installed].reverse():fixture.installed;
const codes={};
window.__QA_LOAD__=async(id)=>loadRuntimePlugin(codes[id],id,{file:'fixture/'+id+'/plugin.js',defaultEnabled:fixture.frontend.includes(id)});
window.__QA_UNLOAD__=unloadRuntimePlugin;
window.__QA_TOGGLE__=setPluginEnabled;
window.__QA_RECORDS__=$pluginRecords;
function App(){
 React.useSyncExternalStore($registryVersion.subscribe,$registryVersion.get,$registryVersion.get);
 const routes=registry.getArea('routes'),nav=registry.getArea('sidebar.nav');
 return <>{registry.getArea('titleBar.center').map(c=>React.createElement(c.render,{key:c.id}))}<nav aria-label="Native contributions">{nav.map(c=><a key={c.id} href={c.data.path}>{c.data.label}</a>)}</nav><aside aria-label="Native session rows">{registry.getArea('sessionRow.trailing').map(c=>React.createElement(c.data.render,{key:c.id,sessionId:window.__QA_SESSION_ROW__||'fictional-session-01'}))}</aside>{routes[0]?React.createElement(routes[0].render):<p>No active Saved plugins.</p>}</>;
}
root.render(<App/>);
for(const id of ids){codes[id]=await (await fetch('/api/qa/desktop/'+id,{headers:{'X-Hermes-Session-Token':'fictional-test-session'}})).text();await window.__QA_LOAD__(id);}
window.__QA_READY__=true;
`;
const stubPlugin={name:'host-boundary-doubles',setup(b){
 b.onResolve({filter:/^(react|react-dom|nanostores)(\/.*)?$/},args=>({path:requireHost.resolve(args.path)}));
 b.onResolve({filter:/^@\//},args=>{
  if(args.path==='@/lib/keybinds/use-keybind-hint')return {path:'keybind',namespace:'qa'};
  if(args.path==='@/hermes')return {path:'hermes',namespace:'qa'};
  if(args.path==='@/sdk/runtime')return {path:'sdk',namespace:'qa'};
  if(args.path==='@/lib/desktop-fs')return {path:'fs',namespace:'qa'};
  if(args.path==='@/store/notifications')return {path:'notifications',namespace:'qa'};
  if(args.importer.includes('/web/')){
   if(args.path==='@/lib/api')return {path:'api',namespace:'qa'};
   if(args.path==='@/lib/profile-bootstrap')return {path:'profile',namespace:'qa'};
   if(args.path==='@/lib/utils')return {path:'utils',namespace:'qa'};
   if(args.path==='@/i18n')return {path:'i18n',namespace:'qa'};
  }
  return b.resolve(join(source,'apps/desktop/src',args.path.slice(2)),{kind:args.kind,resolveDir:source});
 });
 b.onResolve({filter:/^\.\/(events|plugin)$/},args=>{
  if(args.importer.endsWith('/contrib/runtime-loader.ts'))return {path:args.path.slice(2),namespace:'qa'};
 });
 b.onLoad({filter:/.*/,namespace:'qa'},args=>({contents:({keybind:'export const useKeybindHint=()=>null;',hermes:'export const getHermesConfigRecord=async()=>({}),retainConfigReadOrigin=x=>x,saveHermesConfig=async()=>({ok:true});',api:apiStub,profile:'export const dashboardServingProfile=()=>"default";',utils:'export const cn=(...a)=>a.join(" "),timeAgo=()=>"",isoTimeAgo=()=>"";',i18n:'export const useI18n=()=>({t:{}});',sdk:sdkStub,fs:'export const isReadFileErrorResult=()=>false;',notifications:'export const notifyError=(e)=>{throw e;};',events:'export const trackGatewayEventDisposers=(track,fn)=>fn();',plugin:contextStub})[args.path],loader:'js',resolveDir:root}));
}};
 await mkdir(scratch,{recursive:true});
 for(const [name,contents] of [['dashboard',dashEntry],['desktop',desktopEntry]])await build({stdin:{contents,resolveDir:root,loader:'jsx'},outfile:join(scratch,name+'.js'),bundle:true,format:'esm',target:'es2022',nodePaths:[join(source,'node_modules'),join(root,'node_modules')],jsx:'automatic',loader:{'.css':'text','.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl','.svg':'dataurl'},define:{'import.meta.env.DEV':'false','process.env.NODE_ENV':'"production"'},plugins:[stubPlugin]});
 const base=`http://127.0.0.1:${port}`;
 let server=null,browser=null;
 const harness={
  scratch,port,base,auth,logs:'',
  async browser(){browser??=await chromium.launch({headless:true});return browser;},
  /** Start the fictional backend for one scenario and wait until it serves. */
  async start(scenario){
   await harness.stop();harness.logs='';
   server=spawn(process.env.PYTHON||'python',['tests/saved_browser_server.py',String(port),scratch,scenario],{cwd:root,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',HERMES_SOURCE:source},stdio:['ignore','pipe','pipe']});
   server.stderr.on('data',b=>harness.logs+=b);
   for(let n=0;n<150;n++){try{if((await fetch(base+'/qa/dashboard')).ok)break;}catch{}if(server.exitCode!==null)throw new Error(harness.logs);await new Promise(r=>setTimeout(r,100));if(n===149)throw new Error('Server failed: '+harness.logs);}
  },
  async stop(){if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}server=null;},
  /** Authenticated JSON call straight to a plugin backend, bypassing the UI. */
  async api(id,path,opts={}){const response=await fetch(base+'/api/plugins/'+id+path,{...opts,headers:auth});if(!response.ok)throw new Error(await response.text());return response.json();},
  async close(){await browser?.close();browser=null;await harness.stop();await rm(scratch,{recursive:true,force:true});}
 };
 return harness;
}
