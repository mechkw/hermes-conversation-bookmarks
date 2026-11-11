import {expect} from '@playwright/test';
import {join} from 'node:path';
export async function contestCases(page,adapter,api,proof){
 const id='conversation-bookmarks';
 await page.getByRole('tab',{name:'Bookmarks',exact:true}).click();
 const entries=[];
 for(let n=0;n<32;n++)entries.push(await api(id,'/entries',{method:'POST',body:JSON.stringify({title:`Contest reference ${String(n).padStart(2,'0')}`,note:'Fictional annotation',session_id:'fictional-session-01'})}));
 try{
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  const preview=page.getByRole('complementary',{name:'Bookmark details'});
  const first=page.getByRole('button',{name:entries[31].title,exact:true});
  await first.click();await expect(preview).toContainText(entries[31].title);
  await page.screenshot({path:join(proof,`contest-bookmarks-${adapter}-inspector.png`)});
  const check=page.getByRole('checkbox',{name:'Select bookmark '+entries[31].title,exact:true});
  await expect(check).not.toBeChecked();await check.click();await expect(check).toBeChecked();
  if(adapter==='desktop'){
   await expect(check).toHaveAttribute('data-state','checked');
   const glyph=check.locator('[data-slot="checkbox-indicator"] .codicon-check');
   expect(await page.evaluate(async()=>{const faces=await document.fonts.load('14px codicon');return faces.some(face=>face.family.replaceAll('\"','')==='codicon'&&face.status==='loaded');})).toBe(true);
   await expect(glyph).toHaveCSS('display','block');await expect(glyph).toHaveCSS('visibility','visible');await expect(glyph).toBeVisible();
   expect(await glyph.evaluate(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node),p=getComputedStyle(node,'::before');return {visible:r.width>0&&r.height>0&&s.opacity!=='0',content:p.content};})).toEqual({visible:true,content:expect.not.stringMatching(/^(none|normal|"")$/)});
   await page.screenshot({path:join(proof,'contest-bookmarks-desktop-checked-glyph.png')});
  }
  await expect(preview).toContainText(entries[31].title);
  await page.getByRole('button',{name:entries[30].title,exact:true}).click();
  await expect(check).toBeChecked();await expect(preview).toContainText(entries[30].title);
  await page.getByRole('checkbox',{name:'Select all bookmarks on this page'}).click();
  await expect(page.getByText('30 bookmarks selected across pages',{exact:true})).toBeVisible();
  await page.getByRole('navigation',{name:'Bookmark pages'}).getByRole('button',{name:'Next',exact:true}).click();
  await page.getByRole('checkbox',{name:'Select bookmark '+entries[0].title,exact:true}).click();
  await expect(page.getByText('31 bookmarks selected across pages',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Remove selected bookmarks',exact:true}).click();
  const dialog=page.getByRole('dialog');await expect(dialog).toContainText('31 explicitly selected bookmarks across pages');
  await dialog.getByRole('button',{name:'Keep bookmarks',exact:true}).click();
  expect((await api(id,'/entries?limit=100')).items.filter(x=>entries.some(e=>e.id===x.id))).toHaveLength(32);
  await page.getByRole('button',{name:'Remove selected bookmarks',exact:true}).click();
  await dialog.getByRole('button',{name:'Remove metadata',exact:true}).click();await expect(dialog).toHaveCount(0);
  const remaining=(await api(id,'/entries?limit=100')).items.filter(x=>entries.some(e=>e.id===x.id));expect(remaining.map(x=>x.id)).toEqual([entries[1].id]);
  await page.getByRole('button',{name:'Bookmark settings',exact:true}).click();
  const notes=dialog.getByRole('switch',{name:'Show notes in list'});await expect(notes).toBeChecked();if(adapter==='desktop')await expect(notes).toHaveAttribute('data-state','checked');await notes.click();await expect(notes).not.toBeChecked();if(adapter==='desktop')await expect(notes).toHaveAttribute('data-state','unchecked');
  expect((await api(id,'/settings')).show_notes).toBe(false);
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.locator('.cb-row .cb-description')).toHaveCount(0);
  await page.getByRole('button',{name:'Bookmark settings',exact:true}).click();await expect(notes).not.toBeChecked();await notes.click();await expect(notes).toBeChecked();if(adapter==='desktop'){await expect(notes).toHaveAttribute('data-state','checked');await expect(notes.locator('[data-slot="switch-thumb"]')).toHaveAttribute('data-state','checked');await expect(notes.locator('[data-slot="switch-thumb"]')).toBeVisible();}await page.keyboard.press('Escape');
  await page.getByLabel('Search bookmarks',{exact:true}).fill('Contest');
  await expect(page.getByText('0 bookmarks selected across pages',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
 }finally{
  for(const entry of (await api(id,'/entries?limit=100')).items.filter(x=>entries.some(e=>e.id===x.id)))await api(id,`/entries/${entry.id}?revision=${entry.revision}`,{method:'DELETE'});
  await api(id,'/settings',{method:'PUT',body:JSON.stringify({show_notes:true,show_source_status:true})});
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
 }
 if(adapter==='desktop'){
  const plus=await page.evaluate(()=>window.__QA_REGISTRY__.getArea('composer.attachments').find(x=>x.data.label==='Bookmarks')?.data.label);expect(plus).toBe('Bookmarks');
  await page.evaluate(()=>window.__QA_REGISTRY__.getArea('composer.attachments').find(x=>x.data.label==='Bookmarks').data.run());
  const modal=page.getByRole('dialog',{name:'Bookmarks',exact:true});await expect(modal).toBeVisible();await expect(modal.getByRole('complementary',{name:'Bookmark details'})).toContainText('Preview a bookmark');
  await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);
 }
 console.log('PASS contest',adapter,'adjacent inspector, independent inline selection, page/cross-page scope, cancel/bulk remove/readback, native boolean defaults, contextual Plus, native checked-state and computed-visible glyph');
}
