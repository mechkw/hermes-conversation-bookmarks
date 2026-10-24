/* Native loaders, real React, native authenticated Python API, fictional bank.
 * SDK host state/IPC/UI-kit boundaries are doubles; this is NOT Electron QA.
 */
import {build} from 'esbuild';
import {mkdtemp, readFile, copyFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {chromium,expect} from '@playwright/test';

const root=resolve('.');
const source=process.env.HERMES_SOURCE||join(process.env.HOME,'.hermes/hermes-agent');
const scratch=await mkdtemp(join(process.env.TMPDIR||tmpdir(),'q-'));
const port=await new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const common=`import React from 'react';import {createRoot} from 'react-dom/client';
window.__QA_REACT__=React;
const root=createRoot(document.getElementById('root'));
window.__QA_REQUESTS__=[];
async function fetchJSON(path,opts={}) {
 window.__QA_REQUESTS__.push({path,method:opts.method||'GET'});
 const response=await fetch(path,{...opts,headers:{...opts.headers,'X-Hermes-Session-Token':'fictional-test-session'}});
 const data=await response.json();if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'Request refused');return data;
}
window.__QA_FETCH__=fetchJSON;
`;
const apiStub=`export const HERMES_BASE_PATH='';export const fetchJSON=(...a)=>window.__QA_FETCH__(...a);export const authedFetch=fetchJSON;export const buildWsUrl=()=>'';export const buildWsAuthParam=()=>'';export const api={getPlugins:async(profile)=>(await fetchJSON('/api/dashboard/plugins?profile='+profile))};`;
const uiStub=`export const Badge=()=>null,Button=()=>null,Checkbox=()=>null,ConfirmDialog=()=>null,Dialog=()=>null,DialogClose=()=>null,DialogContent=()=>null,DialogDescription=()=>null,DialogFooter=()=>null,DialogHeader=()=>null,DialogTitle=()=>null,Toast=()=>null,useConfirmDelete=()=>null,useToast=()=>null,Select=()=>null,SelectOption=()=>null,Card=()=>null,CardHeader=()=>null,CardTitle=()=>null,CardContent=()=>null,Input=()=>null,Label=()=>null,Separator=()=>null,Tabs=()=>null,TabsList=()=>null,TabsTrigger=()=>null;`;
const dashEntry=common+`
import {exposePluginSDK,getPluginComponent,onPluginRegistered,selectPluginProfile} from '${source}/web/src/plugins/registry.ts';
import {usePlugins} from '${source}/web/src/plugins/usePlugins.ts';
exposePluginSDK();
function App(){usePlugins('default');const Component=React.useSyncExternalStore(onPluginRegistered,()=>getPluginComponent('conversation-bookmarks')||null);return Component?React.createElement(Component):React.createElement('p',null,'Native Dashboard loader…');}
root.render(React.createElement(App));
window.__QA_UNMOUNT__=()=>root.unmount();
`;
const sdkStub=`import React from 'react';import {atom} from 'nanostores';
export const host={state:{profile:atom('default'),connectionId:atom('fixture')},openSession:async(id,options)=>{window.__QA_OPENED__={id,options};}};
export const useValue=a=>React.useSyncExternalStore(a.subscribe,a.get,a.get);
export const ROUTES_AREA='routes',SIDEBAR_NAV_AREA='sidebar.nav';
window.__QA_SDK__={host,useValue,ROUTES_AREA,SIDEBAR_NAV_AREA};
export function installPluginSdk(){}
const blob=s=>URL.createObjectURL(new Blob([s],{type:'text/javascript'}));
export const sdkImportMap=()=>({
 'react':blob('export default window.__QA_REACT__;export const {useState,useEffect,useRef,useId,useMemo}=window.__QA_REACT__;'),
 '@hermes/plugin-sdk':blob('export const {host,useValue,ROUTES_AREA,SIDEBAR_NAV_AREA}=window.__QA_SDK__;')
});`;
const contextStub=`export function createPluginContext(id,track){return {registerMany(items){for(const c of items){window.__QA_CONTRIBUTIONS__.push(c);}const dispose=()=>{window.__QA_CONTRIBUTIONS__=window.__QA_CONTRIBUTIONS__.filter(x=>!items.includes(x));};track(dispose);return dispose;},onDispose:track,os:{writeClipboard:async(text)=>{window.__QA_CLIPBOARD__=text;return true;}},rest:(path,opts={})=>window.__QA_FETCH__('/api/plugins/'+id+path,{method:opts.method||'GET',headers:opts.body?{'Content-Type':'application/json'}:undefined,body:opts.body?JSON.stringify(opts.body):undefined})};}`;
const recordsStub=`import {atom} from 'nanostores';export const $pluginRecords=atom({});export function publishPlugin(r){$pluginRecords.set({...$pluginRecords.get(),[r.id]:r});}export function dropPlugin(){}export function pluginActive(id,fallback){return fallback;}`;
const desktopEntry=common+`
import {loadRuntimePlugin,unloadRuntimePlugin} from '${source}/apps/desktop/src/contrib/runtime-loader.ts';
window.__QA_CONTRIBUTIONS__=[];
const code=await (await fetch('/qa-assets/plugin.js')).text();
const id=await loadRuntimePlugin(code,'conversation-bookmarks',{file:'fixture/plugin.js',defaultEnabled:true});
if(id!=='conversation-bookmarks')throw new Error('Native Desktop loader rejected plugin');
const page=window.__QA_CONTRIBUTIONS__.find(c=>c.area==='routes');
if(!page||!window.__QA_CONTRIBUTIONS__.some(c=>c.area==='sidebar.nav'))throw new Error('Missing native contributions');
root.render(React.createElement(page.render));
window.__QA_UNMOUNT__=()=>{unloadRuntimePlugin('conversation-bookmarks');root.unmount();};
`;
const stubPlugin={name:'host-boundary-doubles',setup(b){
 b.onResolve({filter:/^(react|react-dom|nanostores)(\/.*)?$/},args=>({path:resolve(root,'node_modules',args.path==='react'?'react/index.js':args.path==='react-dom'?'react-dom/index.js':args.path==='react-dom/client'?'react-dom/client.js':args.path==='nanostores'?'nanostores/index.js':args.path)}));
 b.onResolve({filter:/^(@\/|@nous-research\/)/},args=>{
  if(args.path==='@/lib/api')return {path:'api',namespace:'qa'};
  if(args.path==='@/lib/profile-bootstrap')return {path:'profile',namespace:'qa'};
  if(args.path==='@/lib/utils')return {path:'utils',namespace:'qa'};
  if(args.path==='@/i18n')return {path:'i18n',namespace:'qa'};
  if(args.path.startsWith('@nous-research/'))return {path:'ui',namespace:'qa'};
  if(args.path==='@/sdk/runtime')return {path:'sdk',namespace:'qa'};
  if(args.path==='@/lib/desktop-fs')return {path:'fs',namespace:'qa'};
  if(args.path==='@/store/notifications')return {path:'notifications',namespace:'qa'};
  throw new Error('Unexpected host import '+args.path);
 });
 b.onResolve({filter:/^\.\/(events|plugin|plugins-store)$/},args=>{
  if(args.importer.endsWith('/contrib/runtime-loader.ts'))return {path:args.path.slice(2),namespace:'qa'};
 });
 b.onLoad({filter:/.*/,namespace:'qa'},args=>({contents:({api:apiStub,profile:'export const dashboardServingProfile=()=>"default";',utils:'export const cn=(...a)=>a.join(" "),timeAgo=()=>"",isoTimeAgo=()=>"";',i18n:'export const useI18n=()=>({t:{}});',ui:uiStub,sdk:sdkStub,fs:'export const isReadFileErrorResult=()=>false;',notifications:'export const notifyError=(e)=>{throw e;};',events:'export const trackGatewayEventDisposers=(track,fn)=>fn();',plugin:contextStub,'plugins-store':recordsStub})[args.path],loader:'js',resolveDir:root}));
}};
let server,browser;
try{
 for(const [name,contents] of [['dashboard',dashEntry],['desktop',desktopEntry]])await build({stdin:{contents,resolveDir:root,loader:'jsx'},outfile:join(scratch,name+'.js'),bundle:true,format:'esm',target:'es2022',nodePaths:[join(root,'node_modules')],define:{'import.meta.env.DEV':'false','process.env.NODE_ENV':'"production"'},plugins:[stubPlugin]});
 await copyFile('desktop/plugin.js',join(scratch,'plugin.js'));
 server=spawn(process.env.PYTHON||'python',['tests/browser_server.py',String(port),scratch],{cwd:root,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',HERMES_SOURCE:source},stdio:['ignore','pipe','pipe']});
 let logs='';server.stderr.on('data',b=>logs+=b);
 const base=`http://127.0.0.1:${port}`;
 for(let n=0;n<100;n++){try{if((await fetch(base+'/qa/dashboard')).ok)break;}catch{}if(server.exitCode!==null)throw new Error(logs);await new Promise(r=>setTimeout(r,100));if(n===99)throw new Error('Server failed: '+logs);}
 browser=await chromium.launch({headless:true});
 const auth={'X-Hermes-Session-Token':'fictional-test-session','Content-Type':'application/json'};
 const api=async(path,opts={})=>{const r=await fetch(base+'/api/plugins/conversation-bookmarks'+path,{...opts,headers:auth});if(!r.ok)throw new Error(await r.text());return r.json();};
 const screenshots=process.env.BOOKMARKS_SCREENSHOT_DIR||join(scratch,'screenshots');await mkdir(screenshots,{recursive:true});

 for(const adapter of ['dashboard','desktop']){
  const context=await browser.newContext({viewport:{width:1440,height:1100}});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/qa/'+adapter);
  try{await expect(page.getByRole('heading',{name:'Saved',exact:true})).toBeVisible();}catch(e){console.error(errors,await page.locator('body').innerText(),logs);throw e;}
  await expect(page.getByRole('heading',{name:'Keep your place'})).toBeVisible();
  await page.getByRole('button',{name:'＋ Save bookmark',exact:true}).focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog.getByLabel('Title',{exact:true})).toBeFocused();
  await dialog.getByLabel('Title',{exact:true}).fill('The decision behind the design');
  await dialog.getByLabel('Note',{exact:false}).fill('We chose fewer controls and a calmer first-run experience. Return here before the next design review.');
  await dialog.getByLabel('Session ID',{exact:true}).fill('fictional-session-01');
  await dialog.getByLabel('Message ID',{exact:false}).fill('1');
  await dialog.getByLabel('Tags',{exact:false}).fill('design\ndecision');
  await dialog.getByRole('button',{name:'Save bookmark',exact:true}).click();await expect(dialog).not.toBeVisible();
  let list=await api('/entries');expect(list.total).toBe(1);expect(list.items[0].message_id).toBe(1);
  await page.getByRole('button',{name:'The decision behind the design',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Edit bookmark'})).toBeEnabled();
  if(adapter==='desktop'){
   await dialog.getByRole('button',{name:'Copy session ID'}).click();expect(await page.evaluate(()=>window.__QA_CLIPBOARD__)).toBe('fictional-session-01');
   await dialog.getByRole('button',{name:'Open conversation'}).click();await expect.poll(()=>page.evaluate(()=>window.__QA_OPENED__?.id)).toBe('fictional-session-01');expect(await page.evaluate(()=>window.__QA_OPENED__.options.profile)).toBe('default');
  }else await expect(dialog.getByRole('button',{name:'Open conversation'})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Edit bookmark'}).click();await dialog.getByLabel('Title',{exact:true}).fill('The decision worth revisiting');await dialog.getByRole('button',{name:'Save changes'}).click();await expect(dialog).not.toBeVisible();
  expect((await api('/entries')).items[0].title).toBe('The decision worth revisiting');
  // API-seeded tags must survive note-only saves, then intentional edit/removal.
  const literalTags=['design, decisions','"quoted", tag','日本語 café'];
  const tagged=await api('/entries',{method:'POST',body:JSON.stringify({title:'Lossless tag regression',note:'Original',tags:literalTags,session_id:'fictional-session-01'})});
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByRole('button',{name:tagged.title,exact:true}).click();
  await dialog.getByRole('button',{name:'Edit bookmark'}).click();
  await dialog.getByLabel('Note',{exact:false}).fill('Only the note changed');
  await dialog.getByRole('button',{name:'Save changes'}).click();await expect(dialog).not.toBeVisible();
  expect((await api('/entries/'+tagged.id)).tags).toEqual(literalTags);
  for(const tag of literalTags)expect((await api('/entries?'+new URLSearchParams({tag}))).items.map(e=>e.id)).toEqual([tagged.id]);
  await page.getByRole('button',{name:tagged.title,exact:true}).click();await dialog.getByRole('button',{name:'Edit bookmark'}).click();
  await dialog.getByLabel('Tags',{exact:false}).fill(['changed, still one',literalTags[2]].join('\n'));
  await dialog.getByRole('button',{name:'Save changes'}).click();await expect(dialog).not.toBeVisible();
  const editedTags=await api('/entries/'+tagged.id);expect(editedTags.tags).toEqual(['changed, still one',literalTags[2]]);
  expect((await api('/entries?'+new URLSearchParams({tag:literalTags[0]}))).total).toBe(0);
  await api(`/entries/${tagged.id}?revision=${editedTags.revision}`,{method:'DELETE'});
  console.log(`${adapter}: API-seeded comma/quote/Unicode tags, note-only roundtrip, exact search, intentional edit/removal PASS`);
  await page.getByRole('searchbox',{name:'Search'}).fill('no-match');await expect(page.getByRole('heading',{name:'No matching bookmarks'})).toBeVisible();await page.getByRole('button',{name:'Clear filters'}).click();
  await api('/entries',{method:'POST',body:JSON.stringify({title:'A useful explanation of the queue',note:'The distinction between scheduled work and a one-time run, explained with a small example.',tags:['learning'],session_id:'fictional-session-01'})});
  await api('/entries',{method:'POST',body:JSON.stringify({title:'Where we left the launch plan',note:'Three remaining checks, an owner for each, and a clear next step.',tags:['handoff','planning'],session_id:'fictional-session-01'})});
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.locator('.cb-card')).toHaveCount(3);
  await page.getByRole('combobox',{name:/Sort/}).selectOption('title');await expect(page.locator('.cb-card').first()).toContainText('A useful explanation');
  await page.getByRole('button',{name:'Filter tag design',exact:true}).click();await expect(page.locator('.cb-card')).toHaveCount(1);await page.getByRole('button',{name:'Clear filters'}).click();await expect(page.locator('.cb-card')).toHaveCount(3);
  await page.screenshot({path:join(screenshots,adapter+'.png'),fullPage:true});
  for(const width of [360,768,1440]){
   await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   expect(await page.locator('.cb button,.cb input,.cb select').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().height>0).every(n=>n.getBoundingClientRect().height>=44))).toBe(true);
   if(adapter==='dashboard'&&width===360)await page.screenshot({path:join(screenshots,'mobile.png'),fullPage:true});
   await page.getByRole('button',{name:'The decision worth revisiting',exact:true}).click();await expect(dialog.getByRole('button',{name:'Edit bookmark'})).toBeEnabled();expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
  }
  async function contrast(){return page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3);};const lum=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);const a=lum(rgb(getComputedStyle(document.querySelector('.cb-card .cb-muted')).color)),b=lum(rgb(getComputedStyle(document.querySelector('.cb-card')).backgroundColor));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);});}
  const lightContrast=await contrast();expect(lightContrast).toBeGreaterThanOrEqual(4.5);
  const light=await page.locator('.cb-bookmarks').evaluate(el=>getComputedStyle(el).backgroundColor);
  await page.evaluate(()=>{document.body.style.setProperty('--ui-bg-editor','#211d31');document.body.style.setProperty('--ui-text-primary','#eeeafa');document.body.style.setProperty('--ui-stroke-secondary','#5b526e');});
  expect(await page.locator('.cb-bookmarks').evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe(light);
  const darkContrast=await contrast();expect(darkContrast).toBeGreaterThanOrEqual(4.5);
  await page.evaluate(()=>{document.body.style.setProperty('--ui-bg-editor','#edf2f7');document.body.style.setProperty('--ui-text-primary','#23384c');document.body.style.setProperty('--ui-stroke-secondary','#b7c7d3');});expect(await page.locator('.cb-bookmarks').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(light);
  console.log(`${adapter}: contrast ${lightContrast.toFixed(2)} light / ${darkContrast.toFixed(2)} dark; all visible controls >=44px`);
  const escaped=await api('/entries',{method:'POST',body:JSON.stringify({title:'<script>window.evil=true</script>',note:'<img src=x onerror=alert(1)>',session_id:'fictional-session-01'})});
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.getByRole('button',{name:escaped.title,exact:true})).toBeVisible();expect(await page.evaluate(()=>window.evil)).toBeUndefined();expect(await page.locator('.cb-card img').count()).toBe(0);
  await api(`/entries/${escaped.id}?revision=1`,{method:'DELETE'});
  await page.route('**/api/plugins/conversation-bookmarks/entries?**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"detail":"Fictional outage"}'}));
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.getByRole('heading',{name:'Could not load bookmarks'})).toBeVisible();await page.unroute('**/api/plugins/conversation-bookmarks/entries?**');await page.getByRole('button',{name:'Try again'}).click();await expect(page.locator('.cb-card')).toHaveCount(3);
  // UI revision conflict keeps the draft, never silently overwrites.
  await page.getByRole('button',{name:'The decision worth revisiting',exact:true}).click();await dialog.getByRole('button',{name:'Edit bookmark'}).click();
  const current=(await api('/entries')).items.find(e=>e.title==='The decision worth revisiting');
  const payload=Object.fromEntries(['title','note','tags','session_id','message_id','revision'].map(k=>[k,current[k]]));
  await api('/entries/'+current.id,{method:'PUT',body:JSON.stringify({...payload,note:'Changed from another view'})});
  await dialog.getByLabel('Note',{exact:false}).fill('Unsaved draft');await dialog.getByRole('button',{name:'Save changes'}).click();await expect(dialog.getByRole('alert')).toContainText('changed elsewhere');await expect(dialog.getByLabel('Note',{exact:false})).toHaveValue('Unsaved draft');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.locator('.cb-card')).toHaveCount(3);
  await page.getByRole('button',{name:'The decision worth revisiting',exact:true}).click();await dialog.getByRole('button',{name:'Remove bookmark'}).click();await dialog.getByRole('button',{name:'Keep bookmark'}).click();
  await page.getByRole('button',{name:'The decision worth revisiting',exact:true}).click();await dialog.getByRole('button',{name:'Remove bookmark'}).click();await dialog.getByRole('button',{name:'Remove metadata'}).click();await expect(page.locator('.cb-card')).toHaveCount(2);
  // Prune only the fictional native source and retain visible saved metadata.
  expect((await fetch(base+'/api/qa/source/prune',{method:'POST',headers:auth})).ok).toBe(true);
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.locator('.cb-card .cb-muted').first()).toHaveText('Session unavailable');
  await page.getByRole('button',{name:'A useful explanation of the queue',exact:true}).click();await expect(dialog).toContainText('Your title, note and tags are still here.');
  if(adapter==='desktop')await expect(dialog.getByRole('button',{name:'Open conversation'})).toBeDisabled();
  await expect(dialog.getByRole('button',{name:'Edit bookmark'})).toBeEnabled();await page.keyboard.press('Escape');
  expect((await fetch(base+'/api/qa/source/restore',{method:'POST',headers:auth})).ok).toBe(true);
  // Held POST followed by disposal/profile/connection change must never issue
  // a readback through newly rebound transport. The in-flight original write
  // may finish in its original profile (cannot be undone by client disposal).
  for(const change of adapter==='desktop'?['profile','connection','dispose']:['dispose']){
   if(change!==(adapter==='desktop'?'profile':'dispose')){await page.goto(base+'/qa/'+adapter);await expect(page.getByRole('button',{name:'＋ Save bookmark',exact:true})).toBeEnabled();}
   await page.getByRole('button',{name:'＋ Save bookmark',exact:true}).click();await dialog.getByLabel('Title',{exact:true}).fill('In-flight fictional mutation');await dialog.getByLabel('Session ID',{exact:true}).fill('fictional-session-01');
   let release,started;const gate=new Promise(r=>release=r),arrived=new Promise(r=>started=r);
   const pattern='**/api/plugins/conversation-bookmarks/entries?**';
   await page.route(pattern,async route=>{if(route.request().method()==='POST'){started();await gate;}await route.continue();});
   await dialog.getByRole('button',{name:'Save bookmark',exact:true}).click();await arrived;
   await page.evaluate(change=>{if(change==='dispose')window.__QA_UNMOUNT__();else if(change==='profile')window.__QA_SDK__.host.state.profile.set('foreign');else window.__QA_SDK__.host.state.connectionId.set('new-connection');},change);
   await page.waitForTimeout(300);const before=await page.evaluate(()=>window.__QA_REQUESTS__.length);release();await page.waitForTimeout(400);expect(await page.evaluate(()=>window.__QA_REQUESTS__.length)).toBe(before);await page.unroute(pattern);
  }
  expect(errors).toEqual([]);await context.close();
  list=await api('/entries');for(const item of list.items)await api(`/entries/${item.id}?revision=${item.revision}`,{method:'DELETE'});
  console.log(`${adapter}: native loader, CRUD/readback, search/tag/sort, escaped text, 360/768/1440, light-dark-light, keyboard/dialog, conflicts, outage/retry, delete confirmation, stale callback fences PASS`);
 }
 console.log('Fictional screenshots: '+screenshots+' (temporary by default; native loader DOM tests, NOT Electron).');
}finally{
 await browser?.close();
 if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}
 await rm(scratch,{recursive:true,force:true});
}
