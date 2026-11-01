// Explicit generation and asynchronous draft fences through real host controls.
import {expect} from '@playwright/test';
export async function generationCases(page,adapter,api,base){
 for(const change of ['profile',...(adapter==='desktop'?['connection']:[]),'dispose']){
  await page.goto(base+'/qa/'+adapter);await expect(page.getByRole('tab')).toHaveCount(2);
  await page.getByRole('tab',{name:'Bookmarks',exact:true}).click();
  await page.getByRole('button',{name:'Save bookmark',exact:true}).click();
  for(const [label,name] of [['Choose a conversation','Native source conversation'],['Response (optional)','Native assistant preview']]){
   await page.getByRole('dialog').getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name,exact:label==='Context'}).click();
  }
  let release,seen;const held=new Promise(r=>release=r),entered=new Promise(r=>seen=r);
  const pattern='**/api/plugins/conversation-bookmarks/generation/draft*';
  await page.route(pattern,async route=>{seen();await held;await route.fulfill({json:{draft:{title:'Retired generation',note:'Retired private draft',tags:[]},context:{previous_exchanges:0,truncated:false}}});});
  await page.getByRole('dialog').getByRole('button',{name:'Generate details',exact:true}).click();await entered;
  await page.evaluate(({adapter,change})=>{if(adapter==='desktop'){if(change==='dispose')for(const id of ['conversation-bookmarks','delivery-shelf'])window.__QA_UNLOAD__(id);else window.__QA_SDK__.host.state[change==='profile'?'profile':'connectionId'].set(change==='profile'?'foreign':'changed');}else if(change==='profile')window.__QA_PROFILE__('foreign');else window.__QA_UNMOUNT__();},{adapter,change});
  await expect(page.getByRole('dialog')).toHaveCount(0);release();await page.unroute(pattern,{behavior:'wait'});
  await expect(page.getByText('Retired private draft',{exact:false})).toHaveCount(0);
  console.log('PASS pending generation fence',adapter,change);
 }
 await page.goto(base+'/qa/'+adapter);await expect(page.getByRole('tab')).toHaveCount(2);
 const prefix='/api/plugins/conversation-bookmarks';let calls=0,mode='ok',release,entered;
 const choose=async(label,name)=>{await page.getByRole('dialog').getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name,exact:label==='Context'}).click();};
 const editor=()=>page.getByRole('dialog');
 await page.route('**'+prefix+'/generation/draft*',async route=>{
  calls++;entered?.();if(mode==='held')await new Promise(r=>release=r);
  if(mode==='error')return route.fulfill({status:502,json:{detail:'Could not generate valid details. Retry when ready.'}});
  await route.fulfill({json:{draft:{title:'AI fictional title',note:'AI fictional note',tags:['fiction','review']},context:{previous_exchanges:0,requested_exchanges:0,truncated:false}}});
 });
 await page.getByRole('tab',{name:'Bookmarks',exact:true}).click();
 await page.getByRole('button',{name:'Save bookmark',exact:true}).click();
 await expect(editor().getByRole('button',{name:'Generate details',exact:true})).toBeDisabled();
 await expect(editor().getByRole('combobox',{name:'Context',exact:true})).toContainText('10');
 await choose('Choose a conversation','Native source conversation');await choose('Response (optional)','Native assistant preview');
 expect(calls).toBe(0);
 await choose('Context','5');
 await expect.poll(async()=>(await api('conversation-bookmarks','/generation/settings')).previous_exchanges).toBe(5);
 await editor().getByRole('button',{name:'Generate details',exact:true}).click();
 await expect(editor().getByLabel('Title',{exact:true})).toHaveValue('AI fictional title');
 await expect(editor().getByLabel('Note',{exact:true})).toHaveValue('AI fictional note');
 await expect(editor().getByLabel('Tags',{exact:true})).toHaveValue('fiction\nreview');
 expect((await api('conversation-bookmarks','/entries')).items.some(x=>x.title==='AI fictional title')).toBe(false);
 mode='held';let seen=new Promise(r=>entered=r);
 await editor().getByRole('button',{name:'Generate details',exact:true}).click();await seen;
 await editor().getByLabel('Note',{exact:true}).fill('My newer note');release();
 await expect(editor().getByText(/Draft changed during generation/)).toBeVisible();
 await expect(editor().getByLabel('Note',{exact:true})).toHaveValue('My newer note');
 seen=new Promise(r=>entered=r);await editor().getByRole('button',{name:'Generate details',exact:true}).click();await seen;
 await choose('Response (optional)','Entire conversation');release();await expect(editor().getByRole('button',{name:'Generate details',exact:true})).toBeDisabled();
 await choose('Response (optional)','Native assistant preview');mode='error';
 await editor().getByRole('button',{name:'Generate details',exact:true}).click();await expect(editor().getByText('Could not generate details',{exact:true})).toBeVisible();
 mode='ok';await editor().getByRole('button',{name:'Generate details',exact:true}).click();await expect(editor().getByLabel('Note',{exact:true})).toHaveValue('AI fictional note');
 mode='held';seen=new Promise(r=>entered=r);await editor().getByRole('button',{name:'Generate details',exact:true}).click();await seen;
 await editor().getByRole('button',{name:'Cancel',exact:true}).click();release();await expect(editor()).toHaveCount(0);
 await page.getByRole('button',{name:'Save bookmark',exact:true}).click();await expect(editor().getByRole('combobox',{name:'Context',exact:true})).toContainText('5');await expect(editor().getByLabel('Note',{exact:true})).toHaveValue('');
 await editor().getByRole('button',{name:'Cancel',exact:true}).click();
 await api('conversation-bookmarks','/generation/settings',{method:'PUT',body:JSON.stringify({previous_exchanges:10})});
 await page.unroute('**'+prefix+'/generation/draft*');
 console.log('PASS generation',adapter,'explicit click, persisted setting, AI draft only, edit/selection/unmount fences, error/retry');
}
