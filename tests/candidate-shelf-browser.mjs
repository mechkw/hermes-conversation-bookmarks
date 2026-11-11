// Current Shelf's native full-page contract. Legacy companion scenarios remain
// in metadata/review-browser; these exercise the real candidate, not a UI shim.
import {expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const id='delivery-shelf';
let runNumber=0;
const detail=page=>page.getByRole('region',{name:'Delivery details',exact:true});
const form=page=>page.getByRole('form',{name:'Edit delivery',exact:true});
const choose=async(page,label,value)=>{await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:value,exact:true}).click();};
async function refresh(page){await page.getByRole('tab',{name:'Bookmarks',exact:true}).click();await page.getByRole('tab',{name:'Deliverables',exact:true}).click();await expect(page.getByRole('region',{name:'Delivery catalog'})).toBeVisible();}
async function open(page,title){await page.getByRole('button',{name:'Open delivery '+title,exact:true}).click();await expect(detail(page)).toBeVisible();}
async function back(page){await page.getByRole('button',{name:'Back to shelf',exact:true}).click();}
export async function editCandidateSeed(page,api,value){
 await open(page,'Saved delivery-shelf');await detail(page).getByRole('button',{name:'Edit metadata'}).click();
 await form(page).getByLabel('Description',{exact:true}).fill(value);await form(page).getByRole('button',{name:'Save changes'}).click();
 await expect(form(page)).toHaveCount(0);const list=await api(id,'/entries');expect(list.total).toBe(1);expect(list.items[0].description).toBe(value);await back(page);
}
async function painted(page,check,evidence,label){
 await expect(check).toBeChecked();await expect(check).toHaveAttribute('data-state','checked');
 const glyph=check.locator('[data-slot="checkbox-indicator"] .codicon-check');
 await expect(glyph).toBeVisible();await expect(glyph).toHaveCSS('display','block');await expect(glyph).toHaveCSS('visibility','visible');
 const pixels=await check.evaluate(el=>{const glyph=el.querySelector('.codicon-check'),s=getComputedStyle(el),g=getComputedStyle(glyph),p=getComputedStyle(glyph,'::before');return {state:el.dataset.state,background:s.backgroundColor,display:g.display,visibility:g.visibility,content:p.content,width:glyph.getBoundingClientRect().width};});
 expect(pixels.background).not.toBe('rgba(0, 0, 0, 0)');expect(pixels.width).toBeGreaterThan(0);expect(pixels.content).not.toMatch(/^(none|normal|"")$/);evidence.push({label,...pixels});
 await check.hover();await paintedState(check);await check.focus();await paintedState(check);
}
async function paintedState(check){await expect(check).toHaveAttribute('data-state','checked');await expect(check.locator('.codicon-check')).toHaveCSS('display','block');}
export async function candidateShelfCases(page,api,proof){
 const owned=[];const tags=['design, decisions','say "hello"','café 日本語'];
 const entry=await api(id,'/entries',{method:'POST',body:JSON.stringify({title:'Candidate metadata regression '+(++runNumber),tags,description:'Original metadata',file:{root:'workspaces',path:'example.md'},session_id:'fictional-session-01'})});owned.push(entry.id);
 const baseEntry=(await api(id,'/entries')).items.find(e=>e.title==='Saved delivery-shelf');
 const preserved=await api(id,`/entries/${entry.id}/versions/${entry.current_version}/files/${entry.versions[0].files[0].id}`);
 try{
  await refresh(page);await open(page,entry.title);
  await detail(page).getByRole('button',{name:'Preview text'}).click();await expect(detail(page).locator('pre')).toHaveText('Fictional Saved delivery.\n');
  const downloading=page.waitForEvent('download');await detail(page).getByRole('button',{name:'Download example.md, version 1',exact:true}).click();const download=await downloading;expect(download.suggestedFilename()).toBe('example.md');expect(await readFile(await download.path(),'utf8')).toBe('Fictional Saved delivery.\n');
  await detail(page).getByRole('button',{name:'Edit metadata'}).click();await form(page).getByLabel('Description',{exact:true}).fill('Only metadata changed.');await form(page).getByRole('button',{name:'Save changes'}).click();await expect(form(page)).toHaveCount(0);
  let current=await api(id,'/entries/'+entry.id);expect(current.tags).toEqual(tags);expect(current.description).toBe('Only metadata changed.');
  await detail(page).getByRole('button',{name:'Edit metadata'}).click();await form(page).getByLabel('Tag 1',{exact:true}).fill('changed, intact');await choose(page,'Kind','report');await form(page).getByRole('button',{name:'Save changes'}).click();await expect(form(page)).toHaveCount(0);
  current=await api(id,'/entries/'+entry.id);expect(current.tags).toEqual(['changed, intact',...tags.slice(1)]);expect(current.kind).toBe('report');expect((await api(id,'/entries?tag=changed%2C%20intact')).items.map(e=>e.id)).toEqual([entry.id]);
  await detail(page).getByRole('button',{name:'Edit metadata'}).click();await api(id,'/entries/'+entry.id,{method:'PUT',body:JSON.stringify({...Object.fromEntries(['title','description','kind','project','tags','file','files','session_id','revision'].map(key=>[key,current[key]])),description:'Concurrent edit'})});await form(page).getByLabel('Description',{exact:true}).fill('Unsaved draft');await form(page).getByRole('button',{name:'Save changes'}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(form(page).getByLabel('Description',{exact:true})).toHaveValue('Unsaved draft');await form(page).getByRole('button',{name:'Cancel',exact:true}).click();await back(page);
  await page.getByLabel('Search deliveries',{exact:true}).fill('no-such-candidate');await expect(page.getByText('No matching deliveries',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Clear filters'}).click();await choose(page,'Delivery type','report');await expect(page.getByRole('button',{name:'Collapse '+entry.title,exact:true})).toBeVisible();await page.getByRole('button',{name:'Clear filters'}).click();
  const escaped=await api(id,'/entries',{method:'POST',body:JSON.stringify({title:'<script>window.evil=true</script>',description:'<img src=x onerror=alert(1)>'})});owned.push(escaped.id);await refresh(page);await expect(page.getByRole('button',{name:'Collapse '+escaped.title,exact:true})).toBeVisible();expect(await page.evaluate(()=>window.evil)).toBeUndefined();await expect(page.locator('.ds-native-group script,.ds-native-group p img')).toHaveCount(0);
  // A real failed catalog request remains actionable through the current Retry.
  const listing='**/api/plugins/delivery-shelf/entries?**';await page.route(listing,route=>route.fulfill({status:503,json:{detail:'Fictional candidate outage'}}));await refresh(page);await expect(page.getByRole('alert')).toContainText('Fictional candidate outage');await page.unroute(listing);await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.getByRole('button',{name:'Collapse '+entry.title,exact:true})).toBeVisible();
  // Real native controls must paint selection in all three current views.
  const evidence=[];expect(await page.evaluate(async()=>{const faces=await document.fonts.load('14px codicon');return faces.some(f=>f.status==='loaded');})).toBe(true);
  for(const view of ['Together','Library','Gallery']){
   await page.getByRole('button',{name:view,exact:true}).click();
   const check=page.getByRole('checkbox',{name:view==='Together'?'Select delivery '+entry.title:'Select delivery '+entry.title+' via example.md',exact:true});await expect(check).not.toBeChecked();
   if(view==='Library'){
    const inspector=page.getByRole('complementary',{name:'File preview'});await page.getByRole('button',{name:'Inspect example.md',exact:true}).first().click();await expect(inspector).toBeVisible();
    const before=await inspector.innerText();await check.focus();await page.keyboard.press('Space');expect(await inspector.innerText()).toBe(before);
   }else{await check.focus();await page.keyboard.press('Space');}
   await painted(page,check,evidence,view);await page.screenshot({path:join(proof,'candidate-shelf-'+view.toLowerCase()+'-checked.png')});
   await page.getByRole('button',{name:'Clear delivery selection',exact:true}).click();await expect(check).not.toBeChecked();await expect(check).toHaveAttribute('data-state','unchecked');await expect(check.locator('.codicon-check')).not.toBeVisible();
  }
  await writeFile(join(proof,'candidate-shelf-painted-selection.json'),JSON.stringify(evidence,null,2));
  await page.getByRole('button',{name:'Together',exact:true}).click();await page.getByRole('checkbox',{name:'Select delivery '+entry.title,exact:true}).click();await page.getByRole('button',{name:'Archive selected',exact:true}).click();await expect.poll(async()=>(await api(id,'/entries/'+entry.id)).state).toBe('archived');await page.getByRole('button',{name:'Undo archive',exact:true}).click();await expect.poll(async()=>(await api(id,'/entries/'+entry.id)).state).toBe('active');
  await expect(page.getByRole('checkbox',{name:'Select delivery '+entry.title,exact:true})).toBeVisible();await page.getByRole('checkbox',{name:'Select delivery '+entry.title,exact:true}).click();await page.getByRole('button',{name:'Trash selected',exact:true}).click();await expect.poll(async()=>(await api(id,'/entries/'+entry.id)).state).toBe('trash');await choose(page,'Delivery state','Trash');await expect(page.getByRole('button',{name:'Collapse '+entry.title,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Empty Trash',exact:true}).click();const modal=page.getByRole('dialog');await expect(modal).toContainText('60 minutes');await modal.getByRole('button',{name:'Cancel',exact:true}).click();expect((await api(id,'/entries/'+entry.id)).state).toBe('trash');
  await page.getByRole('button',{name:'Empty Trash',exact:true}).click();const bulk='**/api/plugins/delivery-shelf/entries/bulk-action*';await page.route(bulk,route=>route.fulfill({status:503,json:{detail:'Fictional lifecycle failure'}}));await modal.getByRole('button',{name:'Empty Trash · start 60-minute recovery'}).click();await expect(page.getByRole('alert')).toContainText('Fictional lifecycle failure');await expect(modal).toBeVisible();expect((await api(id,'/entries/'+entry.id)).state).toBe('trash');await page.unroute(bulk);await modal.getByRole('button',{name:'Empty Trash · start 60-minute recovery'}).click();await expect(modal).toHaveCount(0);await expect.poll(async()=>(await api(id,'/entries/'+entry.id)).state).toBe('pending_delete');await choose(page,'Delivery state','Pending deletion');await expect(page.getByRole('checkbox',{name:'Select delivery '+entry.title,exact:true})).toBeVisible();await page.getByRole('checkbox',{name:'Select delivery '+entry.title,exact:true}).click();await page.getByRole('button',{name:'Restore selected',exact:true}).click();await expect.poll(async()=>(await api(id,'/entries/'+entry.id)).state).toBe('active');await choose(page,'Delivery state','Active');
  // Current details editor is inline, not a legacy modal. Verify its actual
  // keyboard and short-viewport save/cancel surface without inventing a trap.
  await page.setViewportSize({width:360,height:640});await open(page,entry.title);await detail(page).getByRole('button',{name:'Edit metadata'}).click();await form(page).getByLabel('Description',{exact:true}).fill('Mobile keyboard saved');const save=form(page).getByRole('button',{name:'Save changes'});await save.scrollIntoViewIfNeeded();await expect(save).toBeInViewport({ratio:1});await save.focus();await page.keyboard.press('Enter');await expect(form(page)).toHaveCount(0);expect((await api(id,'/entries/'+entry.id)).description).toBe('Mobile keyboard saved');await back(page);
  for(const title of ['UnbrokenTitle'.repeat(12),'A long native group title that must wrap at a narrow viewport '.repeat(2)]){
   const long=await api(id,'/entries',{method:'POST',body:JSON.stringify({title})});owned.push(long.id);await refresh(page);const button=page.getByRole('button',{name:'Collapse '+title,exact:true});await expect(button).toBeVisible();const bounds=await button.evaluate(el=>({button:el.getBoundingClientRect().toJSON(),group:el.closest('.ds-native-group').getBoundingClientRect().toJSON(),text:el.querySelector('.ds-native-group-copy').getBoundingClientRect().toJSON()}));expect(bounds.button.right).toBeLessThanOrEqual(360);expect(bounds.text.right).toBeLessThanOrEqual(bounds.button.right+1);expect(bounds.button.left).toBeGreaterThanOrEqual(bounds.group.left-1);
  }
  await page.screenshot({path:join(proof,'candidate-shelf-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1100});
  await page.getByRole('button',{name:'Add delivery',exact:true}).click();await expect(page.getByRole('dialog',{name:'Add delivery',exact:true})).toBeVisible();await page.getByRole('dialog').getByLabel('Title',{exact:true}).fill('Retained candidate draft');await page.keyboard.press('Escape');await page.getByRole('button',{name:'Add delivery',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('Title',{exact:true})).toHaveValue('Retained candidate draft');await page.keyboard.press('Escape');
  expect(await api(id,`/entries/${entry.id}/versions/${entry.current_version}/files/${entry.versions[0].files[0].id}`)).toEqual(preserved);expect((await api(id,'/entries/'+baseEntry.id)).title).toBe(baseEntry.title);
  console.log('PASS candidate Shelf desktop metadata/tags/kind, real conflict/draft, escaped text, outage/retry, preview/download bytes, all-view painted selection, adjacent inspector, archive/undo/trash/failed-cancelled-empty/recovery readback, mobile editor/title bounds, Add draft retention, preserved bytes');
 }finally{
  for(const entryId of owned){const current=await api(id,'/entries/'+entryId);await api(id,`/entries/${entryId}?revision=${current.revision}`,{method:'DELETE'});expect((await api(id,'/entries?limit=100')).items.some(e=>e.id===entryId)).toBe(false);}
  await page.setViewportSize({width:1440,height:1100});await refresh(page);
 }
}
export async function candidateShelfFences(page,api,base){
 for(const change of ['profile','connection','dispose']){
  await page.goto(base+'/qa/desktop');await expect(page.getByRole('tab')).toHaveCount(2);await page.getByRole('tab',{name:'Deliverables',exact:true}).click();const old=(await api(id,'/entries')).items[0];await open(page,old.title);await detail(page).getByRole('button',{name:'Edit metadata'}).click();
  let release,seen;const held=new Promise(r=>release=r),entered=new Promise(r=>seen=r),pattern='**/api/plugins/delivery-shelf/entries/'+old.id+'*';
  await page.route(pattern,async route=>{if(route.request().method()==='PUT'){seen();await held;}await route.continue();});await form(page).getByRole('button',{name:'Save changes'}).click();await entered;await expect(form(page).getByLabel('Title',{exact:true})).toBeDisabled();
  await page.evaluate(change=>{if(change==='dispose')for(const id of ['conversation-bookmarks','delivery-shelf'])window.__QA_UNLOAD__(id);else window.__QA_SDK__.host.state[change==='profile'?'profile':'connectionId'].set(change==='profile'?'foreign':'changed');},change);await expect(detail(page)).toHaveCount(0);await page.waitForTimeout(350);const count=await page.evaluate(()=>window.__QA_REQUESTS__.length);release();await page.unroute(pattern,{behavior:'wait'});await page.waitForTimeout(350);expect(await page.evaluate(()=>window.__QA_REQUESTS__.length)).toBe(count);console.log('PASS pending candidate Shelf mutation fence',change);
 }
 await page.goto(base+'/qa/desktop');await expect(page.getByRole('tab')).toHaveCount(2);
}
