/* Paired Saved regression matrix: native loaders, real React, the real Hermes UI kit,
 * the native authenticated Python API, and a fictional profile. The shared harness
 * (harness.mjs) owns the host doubles; this is NOT Electron QA.
 */
import {collectionCases,inspectorCases,editorCases,generationCases,fenceCases,desktopCases} from './bookmarks-browser.mjs';
import {metadataCases,pendingMutationCases} from './metadata-browser.mjs';
import {candidateShelfCases,editCandidateSeed,candidateShelfFences} from './candidate-shelf-browser.mjs';
import {titleBoundsCases,focusEditorCases} from './review-browser.mjs';
import {sourceFixture} from './native-source-fixture.mjs';
import {createHarness,root,peer,source,auth} from './harness.mjs';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {expect} from '@playwright/test';

const proof=process.env.SAVED_PROOF_DIR||join(process.env.TMPDIR||tmpdir(),'saved-ui-proof');
await mkdir(proof,{recursive:true});
const shelfRepo=root.endsWith('bookmarks')?peer:root;
const nativeShelfSource=(await readFile(join(shelfRepo,'ui/desktop.jsx'),'utf8')).includes("from './NativeShelf.jsx'");
const entryButton=(page,id,title,adapter)=>page.getByRole('button',{name:adapter==='desktop'&&nativeShelfSource&&id==='delivery-shelf'?'Collapse '+title:title,exact:true});
const savedButtons=page=>page.getByRole('button',{name:/^(Collapse )?Saved (conversation-bookmarks|delivery-shelf)$/});
// The shared Saved protocol must match; each product owns its own page and scenarios.
for(const file of ['ui/Saved.jsx','ui/saved-coordinator.js']){
 if(!(await readFile(join(root,file))).equals(await readFile(join(peer,file))))throw new Error('Paired Saved revisions differ: '+file+'. Build matching local changes; CI does not fetch an unpublished companion. See docs/SAVED_UI.md.');
}
const harness=await createHarness();
const {scratch,base}=harness;
const BOOKMARK_FILES=['ui/Bookmarks.jsx','ui/BookmarkRow.jsx','ui/BookmarkInspector.jsx','ui/BookmarkEditor.jsx','ui/BookmarkSettings.jsx','ui/SourcePicker.jsx','ui/TagInput.jsx','ui/QuickBookmarks.jsx','ui/lib.js','telegram_bookmarks.py','dashboard/plugin_api.py','tests/bookmarks-browser.mjs','tests/harness.mjs'];
const pins={};
for(const repo of [root,peer])for(const file of ['desktop/plugin.js','dashboard/dist/index.js','dashboard/manifest.json','ui/Saved.jsx','ui/saved-coordinator.js','ui/saved.css','ui/desktop.jsx','ui/dashboard.jsx','ui/presentation.desktop.jsx','ui/presentation.dashboard.jsx','ui/style.css','tests/saved-browser.mjs','tests/saved_browser_server.py','tests/native-components.mjs',...(repo.endsWith('bookmarks')?BOOKMARK_FILES:['ui/Shelf.jsx']),...(repo===root?['tests/candidate-shelf-browser.mjs','tests/review-browser.mjs','tests/metadata-browser.mjs']:[])])pins[join(repo,file)]=createHash('sha256').update(await readFile(join(repo,file))).digest('hex');
async function independentState(page,fixture,api,base,auth,scenario,order){
 await page.waitForFunction(()=>window.__QA_READY__);
 await expect(page.getByRole('link',{name:'Saved',exact:true})).toHaveCount(1);
 const available=fixture.frontend.filter(id=>fixture.enabled.includes(id));
 await expect(page.getByRole('tab')).toHaveCount(available.length);
 if(available.length)await expect(entryButton(page,available[0],'Saved '+available[0],'desktop')).toBeVisible();
 await expect(page.getByRole('button',{name:/Install or enable/})).toHaveCount(2-available.length);
 await expect(page.getByText(/Could not open your shelf|Could not load bookmarks|Plugin not found/)).toHaveCount(0);
 expect(await page.evaluate(()=>window.__QA_REQUESTS__.every(r=>r.method==='GET'))).toBe(true);
 for(const width of [360,768,1440]){
  await page.setViewportSize({width,height:1000});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.locator('.hs-saved-tabs button,.hs-saved-missing button,.hs-saved-link').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().height>0).every(n=>n.getBoundingClientRect().height>0))).toBe(true);
  await page.screenshot({path:join(proof,`${scenario}-desktop-${order}-${width}.png`),fullPage:true});
 }
 const changed=[];
 try{
  for(const id of fixture.frontend.filter(id=>!fixture.enabled.includes(id))){
   const label=id==='delivery-shelf'?'deliverables':'bookmarks';
   await page.getByRole('button',{name:'Install or enable '+label}).click();
   expect(await page.evaluate(()=>window.__QA_NAVIGATED__)).toBe('/capabilities?tab=plugins');
   const result=await fetch(base+'/api/qa/backend/'+id+'/true',{method:'POST',headers:auth});expect(result.ok).toBe(true);changed.push(id);
   expect((await api(id,'/status')).profile).toBe('default');
   await page.getByRole('button',{name:'Retry '+label,exact:true}).click();
   await expect(page.getByRole('tab')).toHaveCount(available.length+changed.length);
   await expect(page.getByRole('button',{name:'Install or enable '+label})).toHaveCount(0);
  }
  expect(await page.evaluate(()=>window.__QA_HISTORY__.every(x=>x.routes<=1&&x.nav<=1))).toBe(true);
 }finally{
  for(const id of changed){
   expect((await fetch(base+'/api/qa/backend/'+id+'/false',{method:'POST',headers:auth})).ok).toBe(true);
   expect((await fetch(base+'/api/plugins/'+id+'/status',{headers:auth})).status).toBe(404);
  }
 }
}
async function availabilityFailures(page,adapter){
 const pattern='**/api/plugins/delivery-shelf/status*';
 for(const failure of [401,403,503,'network']){
  await page.route(pattern,route=>failure==='network'?route.abort('failed'):route.fulfill({status:failure,contentType:'application/json',body:JSON.stringify({detail:'Fictional status failure'})}));
  await page.reload();
  const availability=page.locator('[aria-label="Deliverables availability"]');
  await expect(availability).toContainText(failure===401||failure===403?'Access could not be verified':'Could not check availability');
  await expect(page.getByRole('button',{name:/Install or enable/})).toHaveCount(0);
  await expect(page.getByRole('tab',{name:'Deliverables',exact:true})).toHaveCount(0);
  await page.unroute(pattern);
  await availability.getByRole('button',{name:'Retry deliverables',exact:true}).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await page.getByRole('tab',{name:'Deliverables',exact:true}).click();
  await expect(entryButton(page,'delivery-shelf','Saved delivery-shelf',adapter)).toBeVisible();
 }
 if(adapter==='desktop'){
  let release,seen;
  const entered=new Promise(r=>seen=r),blocked=new Promise(r=>release=r);
  let first=true;
  await page.route(pattern,async route=>{if(!first){await route.continue();return;}first=false;seen();await blocked;await route.fulfill({status:404,contentType:'application/json',body:'{"detail":"Plugin not found"}'});});
  await page.evaluate(()=>window.__QA_SDK__.host.state.connectionId.set('held-connection'));
  await entered;
  await expect(page.getByRole('tab',{name:'Deliverables',exact:true})).toHaveCount(0);
  await expect(entryButton(page,'delivery-shelf','Saved delivery-shelf',adapter)).toHaveCount(0);
  await page.evaluate(()=>window.__QA_SDK__.host.state.connectionId.set('recovered-connection'));
  await expect(page.getByRole('tab')).toHaveCount(2);
  release();await page.unroute(pattern,{behavior:'wait'});
  await expect(page.getByRole('button',{name:/Install or enable/})).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(2);
 }
}
const rows=[];
let logs='';
try{
 const browser=await harness.browser();
 for(const scenario of (process.env.SAVED_SCENARIOS?.split(',')||['both','conversation-bookmarks-only','delivery-shelf-only','conversation-bookmarks-disabled','delivery-shelf-disabled','both-disabled','ui-both--conversation-bookmarks-disabled','ui-both--delivery-shelf-disabled','ui-both--both-disabled','ui-bookmarks--both','ui-shelf--both'])){
  await harness.start(scenario);logs=harness.logs;
  const sourceBank=scenario==='both'?await sourceFixture(scratch):null;
  const fixture=await (await fetch(base+'/api/qa/fixture',{headers:auth})).json();
  const api=harness.api;
  for(const id of ['conversation-bookmarks','delivery-shelf']){
   expect((await fetch(base+'/api/plugins/'+id+'/status')).status).toBe(401);
   if(!fixture.enabled.includes(id)){expect((await fetch(base+'/api/plugins/'+id+'/status',{headers:auth})).status).toBe(404);continue;}
   const fields=id==='conversation-bookmarks'?{session_id:'fictional-session-01',note:'Fictional bookmark, independently stored.'}:{description:'Fictional deliverable, independently stored.',file:{root:'workspaces',path:'example.md'}};
   const entry=await api(id,'/entries',{method:'POST',body:JSON.stringify({title:'Saved '+id,...fields})});
   expect((await api(id,'/entries/'+entry.id)).title).toBe('Saved '+id);
  }
  for(const adapter of (process.env.SAVED_ADAPTERS?.split(',')||(scenario.startsWith('ui-')?['desktop']:['dashboard','desktop'])))for(const order of ['forward','reverse']){
   const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   // Delay one real script response, not data substitution, to force both load orders.
   if(adapter==='dashboard'&&fixture.enabled.length===2){const delayed=order==='forward'?'delivery-shelf':'conversation-bookmarks';await page.route('**/dashboard-plugins/**/'+delayed+'/dist/index.js',async route=>{await new Promise(r=>setTimeout(r,350));await route.continue();});}
   await page.goto(base+'/qa/'+adapter+'?order='+order);
   const candidateShelf=adapter==='desktop'&&nativeShelfSource;
   const legacyProducts=candidateShelf?['conversation-bookmarks']:['conversation-bookmarks','delivery-shelf'];
   try{
    if(scenario.startsWith('ui-')){
     await independentState(page,fixture,api,base,auth,scenario,order);
     expect(errors).toEqual([]);rows.push({scenario,adapter,order,passed:true});console.log('PASS',scenario,adapter,order);continue;
    }
    if(!fixture.enabled.length){
     await page.waitForFunction(()=>window.__QA_READY__);
     await expect(page.getByRole('link',{name:'Saved',exact:true})).toHaveCount(0);
     await expect(page.getByRole('heading',{name:'Saved',exact:true})).toHaveCount(0);
     expect(errors).toEqual([]);rows.push({scenario,adapter,order,passed:true});console.log('PASS',scenario,adapter,order);continue;
    }
    await expect(page.getByRole('heading',{name:'Saved',exact:true})).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(fixture.enabled.length);
    if(adapter==='desktop')await page.waitForFunction(()=>window.__QA_READY__);
    await expect(page.getByRole('link',{name:'Saved',exact:true})).toHaveCount(1);
    if(adapter==='dashboard'){
     await page.evaluate(()=>window.__QA_COLLAPSE__(true));
     await expect(page.getByRole('link',{name:'Saved',exact:true})).toBeVisible();
     await page.evaluate(()=>window.__QA_COLLAPSE__(false));
     await expect(page.getByRole('link',{name:'Saved',exact:true})).toBeVisible();
     expect(await page.evaluate(()=>window.__QA_MANIFESTS__.filter(m=>['delivery-shelf','conversation-bookmarks'].includes(m.name)).every(m=>m.tab.hidden))).toBe(true);
     const href=await page.getByRole('link',{name:'Saved',exact:true}).getAttribute('href');
     expect(fixture.enabled.map(id=>'/'+id)).toContain(href);
     await page.getByRole('link',{name:'Saved',exact:true}).click();await expect(page).toHaveURL(base+href);
     await expect(page.getByRole('heading',{name:'Saved',exact:true})).toBeVisible();await expect(page.getByRole('tab')).toHaveCount(fixture.enabled.length);await expect(page.getByRole('link',{name:'Saved',exact:true})).toHaveCount(1);
    }else{
     expect(await page.getByRole('link',{name:'Saved',exact:true}).getAttribute('href')).toBe('/saved');
     expect(await page.evaluate(()=>window.__QA_HISTORY__.every(x=>x.routes<=1&&x.nav<=1))).toBe(true);
    }
    for(const id of fixture.enabled){
     const label=id==='conversation-bookmarks'?'Bookmarks':'Deliverables';
     await page.getByRole('tab',{name:label,exact:true}).click();
     await expect(entryButton(page,id,'Saved '+id,adapter)).toBeVisible();
     if(candidateShelf&&id==='delivery-shelf'){await editCandidateSeed(page,api,adapter+' '+order+' verified');continue;}
     // Edit through each independently scoped UI transport; verify actual backend.
     await page.getByRole('button',{name:'Saved '+id,exact:true}).click();
     const dialog=page.getByRole('dialog');
     await page.getByRole('button',{name:id==='conversation-bookmarks'?'Edit bookmark':'Edit metadata'}).click();
     const field=id==='conversation-bookmarks'?dialog.getByLabel('Note',{exact:false}):dialog.getByLabel('Description',{exact:false});
     const value=adapter+' '+order+' verified';await field.fill(value);
     await dialog.getByRole('button',{name:'Save changes'}).click();await expect(dialog).not.toBeVisible();
     const list=await api(id,'/entries');expect(list.total).toBe(1);expect(list.items[0][id==='conversation-bookmarks'?'note':'description']).toBe(value);
    }
    await expect(entryButton(page,fixture.enabled[fixture.enabled.length-1],'Saved '+fixture.enabled[fixture.enabled.length-1],adapter)).toBeVisible();
    await expect(page.getByText(/Loading (your shelf|registered deliveries|bookmarks)/)).toHaveCount(0);
    for(const width of [360,768,1440]){
     await page.setViewportSize({width,height:1000});
     expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
     expect(await page.locator('.hs-saved-tabs button,.hs-saved-missing button,.hs-saved-link').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().height>0).every(n=>n.getBoundingClientRect().height>0))).toBe(true);
     await page.screenshot({path:join(proof,`${scenario}-${adapter}-${order}-${width}.png`),fullPage:true});
    }
    const shelfOnly=legacyProducts.filter(id=>id!=='conversation-bookmarks');
    if(fixture.enabled.includes('conversation-bookmarks'))await collectionCases(page,adapter,api,proof,sourceBank);
    if(scenario==='both'){
     await inspectorCases(page,adapter,api,sourceBank);await editorCases(page,adapter,api,proof);
     if(adapter==='desktop')await desktopCases(page,api);
     if(shelfOnly.length){await focusEditorCases(page,adapter,api,proof,shelfOnly);await titleBoundsCases(page,adapter,api,proof,shelfOnly);}
     await availabilityFailures(page,adapter);
     await generationCases(page,adapter,api,base);
     if(shelfOnly.length)await metadataCases(page,adapter,api,shelfOnly);
     if(candidateShelf)await candidateShelfCases(page,api,proof);
     await fenceCases(page,adapter,api,base);
     if(shelfOnly.length)await pendingMutationCases(page,adapter,api,base,shelfOnly);
     if(candidateShelf)await candidateShelfFences(page,api,base);
    }
    if(fixture.enabled.length===2){
     await page.getByRole('tab',{name:'Bookmarks',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('tab',{name:'Deliverables',exact:true})).toBeFocused();await expect(page.getByRole('tab',{name:'Deliverables',exact:true})).toHaveAttribute('aria-selected','true');
     if(adapter==='desktop'){
      for(const id of ['conversation-bookmarks','delivery-shelf']){
       await page.evaluate(id=>window.__QA_TOGGLE__(id,false),id);
       await expect(page.getByRole('tab')).toHaveCount(1);await expect(page.getByRole('link',{name:'Saved',exact:true})).toHaveCount(1);
       await expect(page.getByRole('button',{name:/Install or enable/})).toHaveCount(1);
       await page.evaluate(id=>window.__QA_TOGGLE__(id,true),id);
       await expect(page.getByRole('tab')).toHaveCount(2);await expect(page.getByRole('link',{name:'Saved',exact:true})).toHaveCount(1);
       // Native file reload and permanent unload, not only the toggle double.
       await page.evaluate(id=>window.__QA_LOAD__(id),id);await expect(page.getByRole('tab')).toHaveCount(2);
      }
      expect(await page.evaluate(()=>window.__QA_HISTORY__.every(x=>x.routes<=1&&x.nav<=1))).toBe(true);
     }
    }else{
     const missing=fixture.enabled[0]==='conversation-bookmarks'?'deliverables':'bookmarks';
     await expect(page.getByRole('button',{name:'Install or enable '+missing})).toBeVisible();
     const writesBefore=await page.evaluate(()=>window.__QA_REQUESTS__.filter(x=>x.method!=='GET').length);
     if(adapter==='desktop'){
      await page.getByRole('button',{name:'Install or enable '+missing}).click();expect(await page.evaluate(()=>window.__QA_NAVIGATED__)).toBe('/capabilities?tab=plugins');
      expect(await page.evaluate(()=>window.__QA_REQUESTS__.filter(x=>x.method!=='GET').length)).toBe(writesBefore);
     }else{
      // Host management navigation only; never call install/enable APIs.
      await page.route('**/plugins',route=>route.fulfill({contentType:'text/html',body:'<h1>Host plugins management navigation reached</h1>'}));
      await page.getByRole('button',{name:'Install or enable '+missing}).click();await expect(page).toHaveURL(base+'/plugins');
      await page.goto(base+'/qa/dashboard');await expect(page.getByRole('heading',{name:'Saved',exact:true})).toBeVisible();
     }
    }
    // Profile switches clear old records immediately, never reuse a previous view.
    if(adapter==='desktop'){
     await page.evaluate(()=>window.__QA_SDK__.host.state.profile.set('foreign'));
     await expect(page.getByRole('tab')).toHaveCount(0);
     await expect(savedButtons(page)).toHaveCount(0);
     await page.evaluate(()=>window.__QA_SDK__.host.state.profile.set('default'));
     await expect(savedButtons(page)).toBeVisible();
     await page.evaluate(()=>{for(const id of ['conversation-bookmarks','delivery-shelf'])window.__QA_UNLOAD__(id);});
     await expect(page.getByRole('link',{name:'Saved',exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Saved',exact:true})).toHaveCount(0);
    }else{
     await page.evaluate(()=>window.__QA_PROFILE__('foreign'));
     await expect(savedButtons(page)).toHaveCount(0);
     await expect(page.getByRole('link',{name:'Saved',exact:true})).toHaveCount(0);
     await page.evaluate(()=>window.__QA_PROFILE__('default'));
     await expect(page.getByRole('link',{name:'Saved',exact:true})).toHaveCount(1);
     await expect(savedButtons(page)).toBeVisible();
    }
    expect(errors).toEqual([]);
    rows.push({scenario,adapter,order,passed:true});console.log('PASS',scenario,adapter,order);
   }catch(error){await page.screenshot({path:join(proof,'failure.png'),fullPage:true});await writeFile(join(proof,'failure-dom.json'),JSON.stringify(await page.evaluate(()=>({active:document.activeElement?.outerHTML,choices:[...document.querySelectorAll('[role=combobox]')].map(n=>({html:n.outerHTML,rect:n.getBoundingClientRect().toJSON(),ancestors:[...function*(x){while(x){yield x;x=x.parentElement;}}(n)].map(x=>({tag:x.tagName,hidden:x.getAttribute('aria-hidden'),cls:x.className,style:x.getAttribute('style'),display:getComputedStyle(x).display,visibility:getComputedStyle(x).visibility,contentVisibility:getComputedStyle(x).contentVisibility,rect:x.getBoundingClientRect().toJSON(),connected:x.isConnected}))}))})),null,2));console.error({scenario,adapter,order,errors,body:(await page.locator('body').innerText()).slice(0,3000),logs:harness.logs.slice(-3000)});throw error;}
   finally{await context.close();}
  }
  await harness.stop();
 }
 if(!process.env.SAVED_SCENARIOS&&!process.env.SAVED_ADAPTERS)expect(rows).toHaveLength(34);
 for(const [file,hash] of Object.entries(pins))expect(createHash('sha256').update(await readFile(file)).digest('hex'),`Pinned source changed during verification: ${file}`).toBe(hash);
 await writeFile(join(proof,'results.json'),JSON.stringify({hostSource:source,hostCommit:execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),browser:browser.version(),completedAt:new Date().toISOString(),pins,cases:rows,scope:'Native loaders, Dashboard slots, Desktop registry and lifecycle; real authenticated backend. SDK host state/IPC boundaries are doubles; not full Electron or secondary-profile transport QA.'},null,2));
 console.log(`Saved matrix: ${rows.length} cases passed${process.env.SAVED_SCENARIOS||process.env.SAVED_ADAPTERS?' (filtered run)':' / 34 expected'}. Proof: ${proof}`);
}finally{await harness.close();}
