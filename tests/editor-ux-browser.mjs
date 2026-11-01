// Fictional editor acceptance through both real host loaders and native controls.
import {expect} from '@playwright/test';
import {join} from 'node:path';
export async function editorUXCases(page,adapter,api,proof){
 const editor=()=>page.getByRole('dialog'),prefix='**/api/plugins/conversation-bookmarks';
 const context=()=>editor().getByRole('combobox',{name:'Context',exact:true});
 const choose=async(label,value)=>{await editor().getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:value,exact:label==='Context'}).click();};
 const open=async()=>{await page.getByRole('button',{name:'Save bookmark',exact:true}).click();await expect(context()).toBeEnabled();};
 const close=async()=>{await editor().getByRole('button',{name:'Cancel',exact:true}).click();await expect(editor()).toHaveCount(0);};
 await page.getByRole('tab',{name:'Bookmarks',exact:true}).click();
 const writes=[];const record=request=>{if(request.method()==='PUT'&&request.url().includes('/generation/settings'))writes.push(request.postDataJSON());};
 page.on('request',record);
 await open();await expect(context()).toContainText('10');expect(writes).toHaveLength(0);
 await context().click();await expect(page.getByRole('option')).toHaveText(['5','10','20','50']);await page.keyboard.press('Escape');
 for(const text of ['Only your reviewed metadata is saved.','Select an assistant response. On click','Previous exchanges','0–100','Search covers'])await expect(editor()).not.toContainText(text);
 await expect(editor().getByText('Optional • review or write your own',{exact:true})).toBeVisible();
 await expect(editor().getByText('One per line • commas stay within a tag',{exact:true})).toBeVisible();
 await choose('Choose a conversation','Native source conversation');await choose('Response (optional)','Native assistant preview');
 for(const width of [1440,360]){
  await page.setViewportSize({width,height:width===360?640:1100});
  // Only the action row is two-column; source and metadata remain one column.
  const rects=await editor().evaluate(el=>{const box=s=>{const r=el.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width};};return {source:box('.hs-source-picker'),title:box('input[aria-label="Title"]'),row:box('.hs-generation-row'),generate:box('.hs-generation-row button'),context:box('.hs-generation-context'),overflow:el.scrollWidth>el.clientWidth};});
  expect(rects.title.y).toBeGreaterThan(rects.source.bottom);expect(rects.title.width).toBeGreaterThan(rects.source.width*.75);expect(rects.generate.right).toBeLessThanOrEqual(rects.context.x);expect(rects.overflow).toBe(false);
  await editor().getByRole('button',{name:'Generate details',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:join(proof,`editor-${adapter}-${width}.png`),fullPage:true});
  await editor().getByRole('button',{name:'Save bookmark',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:join(proof,`editor-footer-${adapter}-${width}.png`),fullPage:true});
  for(const name of ['Save bookmark','Cancel']){const b=await editor().getByRole('button',{name,exact:true}).boundingBox();expect(b.y).toBeGreaterThanOrEqual(0);expect(b.y+b.height).toBeLessThanOrEqual(width===360?640:1100);}
 }
 await page.setViewportSize({width:1440,height:1100});
 await choose('Context','5');await expect.poll(async()=>(await api('conversation-bookmarks','/generation/settings')).previous_exchanges).toBe(5);
 await close();await open();await expect(context()).toContainText('5');expect(writes).toHaveLength(1);await close();
 for(const preset of ['20','50','10']){
  await open();await choose('Context',preset);await expect.poll(async()=>(await api('conversation-bookmarks','/generation/settings')).previous_exchanges).toBe(Number(preset));await close();await open();await expect(context()).toHaveText(preset);await close();
 }
 // A failed explicit selection keeps the shown choice, blocks inference and retries.
 await open();let fail=true;
 await page.route(prefix+'/generation/settings*',async route=>{if(fail&&route.request().method()==='PUT')return route.fulfill({status:503,json:{detail:'Fictional setting unavailable'}});await route.continue();});
 await choose('Context','20');await expect(editor().getByRole('button',{name:'Retry context setting'})).toBeVisible();await expect(context()).toHaveText('20');
 await choose('Choose a conversation','Native source conversation');await choose('Response (optional)','Native assistant preview');await expect(editor().getByRole('button',{name:'Generate details',exact:true})).toBeDisabled();
 fail=false;await editor().getByRole('button',{name:'Retry context setting'}).click();await expect.poll(async()=>(await api('conversation-bookmarks','/generation/settings')).previous_exchanges).toBe(20);await expect(editor().getByRole('button',{name:'Generate details',exact:true})).toBeEnabled();await close();await page.unroute(prefix+'/generation/settings*');
 // Legacy API counts remain supported; opening the editor is strictly read-only.
 for(const legacy of [0,7,100]){
  await api('conversation-bookmarks','/generation/settings',{method:'PUT',body:JSON.stringify({previous_exchanges:legacy})});
  const count=writes.length;await open();await expect(context()).toContainText('10');expect(writes).toHaveLength(count);
  expect((await api('conversation-bookmarks','/generation/settings')).previous_exchanges).toBe(legacy);
  await choose('Choose a conversation','Native source conversation');await choose('Response (optional)','Native assistant preview');
  let generated=0;
  await page.route(prefix+'/generation/draft*',async route=>{expect((await api('conversation-bookmarks','/generation/settings')).previous_exchanges).toBe(10);generated++;await route.fulfill({json:{draft:{title:'Fictional reviewed draft',note:'Fictional review note',tags:[]},context:{previous_exchanges:10,truncated:false}}});});
  await editor().getByRole('button',{name:'Generate details',exact:true}).click();await expect(editor().getByLabel('Title',{exact:true})).toHaveValue('Fictional reviewed draft');expect(generated).toBe(1);expect(writes.length).toBe(count+1);
  await close();await page.unroute(prefix+'/generation/draft*');
 }
 page.off('request',record);
 console.log('PASS editor UX',adapter,'single-column, action row, 360x640 footer, exact presets, new10/existing5/reopen, legacy0/7/100 read-only normalization and generate persistence');
}
