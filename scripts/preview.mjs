/* Render the plugin with the real Hermes UI kit and a fictional profile, then
 * save screenshots of its main states in light and dark.
 *
 *   npm run build && node scripts/preview.mjs [output-dir]
 *
 * Needs the same local setup as the browser regressions (docs/SAVED_UI.md):
 * HERMES_SOURCE, PYTHON, and the companion repository next to this one.
 * PREVIEW_ONLY=name,name limits the shots; PREVIEW_SKIN picks a built-in skin;
 * PREVIEW_MODES=light,dark picks appearances; PREVIEW_CROP=1 crops dialogs;
 * PREVIEW_WIDTHS=760,420 repeats every shot at those window widths. Every
 * shot is checked for sideways overflow, and any found fails the run.
 */
import {execFileSync} from 'node:child_process';
import {mkdir, readdir, realpath} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {createHarness} from '../tests/harness.mjs';

const out = resolve(process.argv[2] || 'preview');
const only = process.env.PREVIEW_ONLY?.split(',');
const skin = process.env.PREVIEW_SKIN || 'nous';
const id = 'conversation-bookmarks';
await mkdir(out, {recursive: true});

const harness = await createHarness();
const NOW = Math.floor(Date.now() / 1000);

/** Fictional native history: titled conversations with visible assistant replies. */
async function seedSource() {
  const dir = (await readdir(harness.scratch, {withFileTypes: true})).find(d => d.isDirectory() && d.name.startsWith('sv-'));
  const db = join(await realpath(join(harness.scratch, dir.name, 'home')), 'state.db');
  const sessions = [
    ['northstar-launch', 'Northstar launch plan', 'desktop', 2, ['Friday stays. We cut the onboarding tour and ship the import flow first; the tour moves to the following sprint so QA gets two full days.', 'Three checks remain: billing copy, the empty-state illustration, and a final pass on the migration script.', 'Here is the revised timeline with owners for each remaining item.']],
    ['queue-explainer', 'How the job queue retries', 'cli', 26, ['A scheduled run and a one-time run share the same worker pool, but only scheduled runs re-enqueue themselves. Retries back off 2s, 8s, then 30s before the job is parked.', 'In short: idempotent handlers make retries safe; everything else needs a dedupe key.']],
    ['pricing-review', 'Pricing page review', 'desktop', 75, ['Fewer controls and a calmer first-run experience tested better. Keep the annual toggle; remove the calculator.', 'The comparison table should lead with outcomes, not feature counts.']],
    ['telegram-notes', 'Trip notes from Lisbon', 'telegram', 200, ['Day two: the tile museum in the morning, then the long lunch you asked me to remember near Campo de Ourique.']],
    ['untitled-research', '', 'desktop', 420, ['The two papers disagree on sample size, not on the direction of the effect.']],
    ['api-design', 'Designing the export API', 'cli', 900, ['Cursor pagination with an opaque token keeps the contract stable when rows are inserted mid-export.', 'Return 202 with a status URL for anything expected to take longer than a few seconds.']]
  ];
  const script = `import sqlite3,sys,json
sessions=json.loads(sys.argv[2]);now=int(sys.argv[3])
with sqlite3.connect(sys.argv[1]) as db:
 for table,cols in {'sessions':{'title':'TEXT','source':'TEXT','started_at':'REAL','ended_at':'REAL','last_activity_at':'REAL','hidden':'INTEGER'},'messages':{'role':'TEXT','content':'TEXT','timestamp':'REAL','display_kind':'TEXT','observed':'INTEGER','_compressed_summary':'INTEGER'}}.items():
  existing={r[1] for r in db.execute('PRAGMA table_info('+table+')')}
  for col,kind in cols.items():
   if col not in existing: db.execute('ALTER TABLE '+table+' ADD COLUMN '+col+' '+kind)
 db.execute("UPDATE sessions SET title='Scratch conversation',source='desktop',last_activity_at=? WHERE id='fictional-session-01'",(now-86400*40,))
 db.execute("UPDATE messages SET role='assistant',content='A short fictional reply.',timestamp=? WHERE id=1",(now-86400*40,))
 mid=100
 for sid,title,source,hours,replies in sessions:
  at=now-hours*3600
  db.execute('INSERT OR REPLACE INTO sessions(id,profile_name,title,source,last_activity_at) VALUES(?,?,?,?,?)',(sid,'default',title or None,source,at))
  for n,text in enumerate(replies):
   mid+=1
   db.execute('INSERT OR REPLACE INTO messages(id,session_id,role,content,timestamp) VALUES(?,?,?,?,?)',(mid,sid,'assistant',text,at-(len(replies)-n)*90))
 db.execute("INSERT OR REPLACE INTO sessions(id,profile_name,title,source,last_activity_at) VALUES('pruned-thread','default','A thread that will be pruned','cli',?)",(now-86400*90,))
 db.execute("INSERT OR REPLACE INTO messages(id,session_id,role,content,timestamp) VALUES(990,'pruned-thread','assistant','Old fictional reply',?)",(now-86400*90,))
`;
  const run = (code, ...args) => execFileSync(process.env.PYTHON || 'python', ['-c', code, db, ...args], {env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}});
  run(script, JSON.stringify(sessions), String(NOW));
  return {prune: () => run(`import sqlite3,sys
with sqlite3.connect(sys.argv[1]) as db:
 db.execute("DELETE FROM messages WHERE session_id='pruned-thread'");db.execute("DELETE FROM sessions WHERE id='pruned-thread'")`)};
}

async function seedBookmarks(source) {
  const save = body => harness.api(id, '/entries', {method: 'POST', body: JSON.stringify(body)});
  await save({title: 'Old staging credentials thread', note: 'Kept for the audit trail.', tags: ['ops'], session_id: 'pruned-thread', message_id: 990});
  await save({title: 'Export API: pagination contract', note: 'Opaque cursor tokens; 202 + status URL for long exports.', tags: ['api', 'decision'], session_id: 'api-design', message_id: 110});
  await save({title: 'Sample-size disagreement', session_id: 'untitled-research'});
  await save({title: 'Lisbon: the lunch place', note: 'Near Campo de Ourique. Ask for the terrace.', tags: ['travel'], session_id: 'telegram-notes', message_id: 108});
  await save({title: 'Pricing page: what tested better', note: 'Fewer controls, calmer first run. Keep the annual toggle, remove the calculator.\nRevisit before the next design review.', tags: ['design', 'decision'], session_id: 'pricing-review', message_id: 106});
  await save({title: 'How queue retries actually work', note: 'The explanation that finally clicked: only scheduled runs re-enqueue themselves.', tags: ['learning', 'ops'], session_id: 'queue-explainer', message_id: 104});
  await save({title: 'Where we left the launch plan', note: 'Three remaining checks, an owner for each, and a clear next step.', tags: ['launch', 'planning'], session_id: 'northstar-launch'});
  await save({title: 'Friday launch decision', note: 'Friday stays; scope is reduced. Tour moves to the next sprint so QA gets two full days.', tags: ['launch', 'decision'], session_id: 'northstar-launch', message_id: 101});
  source.prune();
  // Spread the fictional bookmarks over a few weeks so ages read like a real collection.
  const dir = (await readdir(harness.scratch, {withFileTypes: true})).find(d => d.isDirectory() && d.name.startsWith('sv-'));
  const store = join(await realpath(join(harness.scratch, dir.name, 'home')), 'plugin-data', 'conversation-bookmarks', 'bookmarks.sqlite3');
  execFileSync(process.env.PYTHON || 'python', ['-c', `import sqlite3,sys
ages=[0.4,3,27,52,170,330,700,2100]
with sqlite3.connect(sys.argv[1]) as db:
 rows=[r[0] for r in db.execute('SELECT id FROM entries ORDER BY created DESC,rowid DESC')]
 for entry,hours in zip(rows,ages):
  at=int(sys.argv[2])-int(hours*3600)
  db.execute('UPDATE entries SET created=?,updated=? WHERE id=?',(at,at,entry))`, store, String(NOW)]);
}

const shots = [];
const widths = (process.env.PREVIEW_WIDTHS || '').split(',').filter(Boolean).map(Number);
const spills = [];

/** Anything that scrolls sideways or pokes out of its dialog or the window. */
async function audit(page, label) {
  const found = await page.evaluate(() => {
    const out = [], view = document.documentElement.clientWidth;
    const describe = el => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''}`;
    if (document.documentElement.scrollWidth > view + 1) out.push(`window scrolls sideways (${document.documentElement.scrollWidth} > ${view})`);
    const seen = new Set();
    for (const root of document.querySelectorAll('.cb,.cb-dialog,.cb-menu,.hs-saved')) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (seen.has(el)) continue;
        seen.add(el);
        const box = el.getBoundingClientRect();
        if (box.width < 2 || box.height < 2) continue;
        if (/(auto|scroll)/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1) out.push(`${describe(el)} scrolls sideways (${el.scrollWidth} > ${el.clientWidth})`);
        const frame = el.closest('[role="dialog"]')?.getBoundingClientRect();
        const left = frame ? frame.left : 0, right = Math.min(view, frame ? frame.right : view);
        if (box.right > right + 1 || box.left < left - 1) out.push(`${describe(el)} spills out (${Math.round(box.left)}..${Math.round(box.right)} outside ${Math.round(left)}..${Math.round(right)})`);
      }
    }
    return [...new Set(out)];
  });
  for (const line of found) spills.push(`${label}: ${line}`);
}

async function shoot(page, name, mode, dialog = false) {
  if (only && !only.includes(name)) return;
  const file = join(out, `${name}-${mode}.png`);
  await audit(page, `${name} ${mode}`);
  // PREVIEW_CROP=1 saves dialogs on their own, for documentation.
  if (dialog && process.env.PREVIEW_CROP) await page.getByRole('dialog').screenshot({path: file});
  else await page.screenshot({path: file});
  shots.push(file);
  // PREVIEW_WIDTHS=760,420 repeats the same state at other window widths.
  if (!widths.length) return;
  const size = page.viewportSize();
  for (const width of widths) {
    await page.setViewportSize({width, height: size.height});
    await page.waitForTimeout(200);
    await audit(page, `${name} ${mode} at ${width}px`);
    await page.screenshot({path: join(out, `${name}-${mode}-w${width}.png`)});
  }
  await page.setViewportSize(size);
  await page.waitForTimeout(200);
}

try {
  await harness.start('both');
  const source = await seedSource();
  await seedBookmarks(source);
  const browser = await harness.browser();
  for (const mode of (process.env.PREVIEW_MODES || 'light,dark').split(',')) {
    const context = await browser.newContext({viewport: {width: 1320, height: 860}, deviceScaleFactor: 2});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(harness.base + '/qa/desktop');
    await page.waitForFunction(() => window.__QA_READY__, null, {timeout: 15000}).catch(async error => { console.log('NOT READY', errors, (await page.locator('body').innerText()).slice(0, 600)); throw error; });
    await page.evaluate(([skin, mode]) => {
      window.__QA_THEME__(skin, mode);
      // Stand in for the app frame: page surface, type scale and no QA scaffolding.
      const style = document.createElement('style');
      style.textContent = 'body{margin:0;background:var(--ui-editor-surface-background,var(--ui-bg-editor));color:var(--ui-text-primary);font-family:var(--dt-font-sans);font-size:var(--conversation-text-font-size)}nav[aria-label="Native contributions"],aside[aria-label="Native session rows"]{display:none}';
      document.head.append(style);
    }, [skin, mode]);
    const row = title => page.getByRole('button', {name: title, exact: true});
    await page.getByRole('tab', {name: 'Bookmarks', exact: true}).click();
    await row('Friday launch decision').waitFor();
    await shoot(page, '01-collection', mode);

    await row('Friday launch decision').click();
    await page.getByRole('complementary', {name: 'Bookmark details'}).getByText('Northstar launch plan').waitFor();
    await shoot(page, '02-inspector', mode);

    await page.getByRole('button', {name: 'Reference', exact: true}).click();
    await row('Old staging credentials thread').click();
    await page.getByText('Conversation unavailable').first().waitFor();
    await shoot(page, '03-unavailable', mode);

    await page.getByRole('button', {name: 'Filter tag decision'}).first().click();
    await page.getByRole('checkbox', {name: 'Select all bookmarks on this page'}).click();
    await shoot(page, '04-filtered-selection', mode);
    await page.getByRole('button', {name: 'Clear selection'}).click();
    await page.getByRole('button', {name: 'Clear filters'}).click();

    await row('How queue retries actually work').click({button: 'right'});
    await page.getByRole('menuitem', {name: 'Edit bookmark'}).waitFor();
    await shoot(page, '05-context-menu', mode);
    await page.keyboard.press('Escape');

    await page.getByRole('button', {name: 'New bookmark', exact: true}).click();
    await page.getByRole('option', {name: /Northstar launch plan/}).waitFor();
    await shoot(page, '06-editor-choose', mode, true);
    await page.getByRole('option', {name: /Northstar launch plan/}).click();
    await page.getByRole('button', {name: 'One response', exact: true}).click();
    await page.getByRole('option', {name: /Friday stays/}).click();
    await page.getByLabel('Note').fill('Scope is reduced, the date is not.');
    await page.getByLabel('Tags').fill('launch');
    await page.keyboard.press('Enter');
    await shoot(page, '07-editor-details', mode, true);
    await page.getByRole('button', {name: 'Cancel', exact: true}).click();

    await page.getByRole('button', {name: 'Bookmark settings', exact: true}).click();
    await page.getByRole('switch', {name: 'Show notes in list'}).waitFor();
    await shoot(page, '08-settings', mode, true);
    await page.keyboard.press('Escape');

    await page.evaluate(() => window.__QA_REGISTRY__.getArea('composer.attachments').find(x => x.data.label === 'Bookmarks').data.run());
    await page.getByRole('dialog').getByRole('option').first().waitFor();
    await page.getByRole('dialog').getByRole('textbox').fill('launch');
    await page.waitForTimeout(400);
    await shoot(page, '09-quick-find', mode, true);
    await page.keyboard.press('Escape');

    await page.getByLabel('Search bookmarks').fill('zzzz');
    await page.getByText('No matching bookmarks').waitFor();
    await shoot(page, '10-no-results', mode);
    await page.getByLabel('Search bookmarks').fill('');

    await page.setViewportSize({width: 420, height: 800});
    await row('Friday launch decision').waitFor();
    await shoot(page, '11-narrow-list', mode);
    await row('Friday launch decision').click();
    await page.getByRole('button', {name: 'Back to bookmarks'}).waitFor();
    await shoot(page, '12-narrow-detail', mode);
    if (errors.length) console.log('PAGE ERRORS', mode, [...new Set(errors)].slice(0, 6));
    await context.close();
  }
  if (!only || only.includes('13-dashboard')) {
    const context = await browser.newContext({viewport: {width: 1320, height: 860}, deviceScaleFactor: 2});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(harness.base + '/qa/dashboard');
    await page.getByRole('tab', {name: 'Bookmarks', exact: true}).click();
    await page.getByRole('button', {name: 'Friday launch decision', exact: true}).click();
    await page.waitForTimeout(400);
    await page.screenshot({path: join(out, '13-dashboard.png')});
    await page.getByRole('button', {name: 'New bookmark', exact: true}).click();
    await page.getByRole('option', {name: /Northstar launch plan/}).click();
    await page.waitForTimeout(300);
    await page.screenshot({path: join(out, '14-dashboard-editor.png')});
    if (errors.length) console.log('PAGE ERRORS dashboard', [...new Set(errors)].slice(0, 6));
    await context.close();
  }
  console.log(`Preview: ${shots.length} desktop shots (+ dashboard) in ${out}`);
  if (spills.length) { console.log(`Sideways overflow (${spills.length}):\n` + spills.join('\n')); process.exitCode = 1; }
  else console.log('No sideways overflow.');
} catch (error) {
  console.error(error, harness.logs.slice(-2000));
  process.exitCode = 1;
} finally {
  await harness.close();
}
