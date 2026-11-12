// Conversation Bookmarks UI regressions, run through both real host loaders
// with the real Hermes UI kit and the native authenticated backend over a
// fictional profile. Each exported group leaves the catalog as it found it.
import {expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const id = 'conversation-bookmarks';
const prefix = '/api/plugins/' + id;
const SESSION = 'fictional-session-01';

const dialog = page => page.getByRole('dialog');
const details = page => page.getByRole('complementary', {name: 'Bookmark details'});
const row = (page, title) => page.getByRole('button', {name: title, exact: true});
const refresh = page => page.getByRole('button', {name: 'Refresh', exact: true}).click();
const openTab = page => page.getByRole('tab', {name: 'Bookmarks', exact: true}).click();
const save = (api, body) => api(id, '/entries', {method: 'POST', body: JSON.stringify({session_id: SESSION, ...body})});
const drop = (api, entry) => api(id, `/entries/${entry.id}?revision=${entry.revision}`, {method: 'DELETE'});
const dropAll = async (api, owned) => {
  for (const entry of (await api(id, '/entries?limit=100')).items.filter(item => owned.some(mine => mine.id === item.id))) await drop(api, entry);
};
/** Messages the plugin showed the person: host toasts on Desktop, an inline status on the Dashboard. */
const said = async (page, adapter, text) => adapter === 'desktop'
  ? expect.poll(() => page.evaluate(() => (window.__QA_NOTICES__ || []).map(notice => notice.message))).toContainEqual(expect.stringContaining(text))
  : expect(page.getByRole('status').filter({hasText: text})).toBeVisible();
const moreActions = async (page, name) => {
  await details(page).getByRole('button', {name: 'More actions', exact: true}).click();
  await page.getByRole('menuitem', {name, exact: true}).click();
};
/** Switch scope under a held request the way each host actually does it. */
const changeScope = (page, adapter, change) => page.evaluate(({adapter, change}) => {
  if (adapter === 'desktop') {
    if (change === 'dispose') for (const plugin of ['conversation-bookmarks', 'delivery-shelf']) window.__QA_UNLOAD__(plugin);
    else window.__QA_SDK__.host.state[change === 'profile' ? 'profile' : 'connectionId'].set(change === 'profile' ? 'foreign' : 'changed');
  } else if (change === 'profile') window.__QA_PROFILE__('foreign');
  else window.__QA_UNMOUNT__();
}, {adapter, change});
const scopeChanges = adapter => ['profile', ...(adapter === 'desktop' ? ['connection'] : []), 'dispose'];
const fresh = async (page, base, adapter) => {
  await page.goto(base + '/qa/' + adapter);
  await expect(page.getByRole('tab')).toHaveCount(2);
  await openTab(page);
};

/** Browse, inspect, select, filter, sort, bulk-remove, settings and keyboard. */
export async function collectionCases(page, adapter, api, proof, sourceBank) {
  await openTab(page);
  const before = sourceBank?.snapshot();
  const entries = [];
  for (let n = 0; n < 32; n++) entries.push(await save(api, {title: `Contest reference ${String(n).padStart(2, '0')}`, note: 'Fictional annotation', ...(n % 4 === 0 ? {message_id: 1, tags: ['fourth']} : {})}));
  try {
    await refresh(page);
    const newest = entries[31], next = entries[30];
    // Inspecting and checking are independent: neither changes the other.
    await row(page, newest.title).click();
    await expect(details(page)).toContainText(newest.title);
    await expect(details(page)).toContainText('Conversation bookmark');
    await expect(row(page, newest.title)).toHaveAttribute('aria-current', 'true');
    await page.screenshot({path: join(proof, `bookmarks-${adapter}-inspector.png`)});
    const check = page.getByRole('checkbox', {name: 'Select bookmark ' + newest.title, exact: true});
    await expect(check).not.toBeChecked();
    await check.click();
    await expect(check).toBeChecked();
    if (adapter === 'desktop') {
      // The native checkbox really paints its glyph; a hidden mark would read as unchecked.
      await expect(check).toHaveAttribute('data-state', 'checked');
      const glyph = check.locator('.codicon-check');
      expect(await page.evaluate(async () => (await document.fonts.load('14px codicon')).some(face => face.family.replaceAll('"', '') === 'codicon' && face.status === 'loaded'))).toBe(true);
      await expect(glyph).toBeVisible();
      expect(await glyph.evaluate(node => getComputedStyle(node, '::before').content)).not.toMatch(/^(none|normal|"")$/);
    }
    await expect(details(page)).toContainText(newest.title);
    await row(page, next.title).click();
    await expect(check).toBeChecked();
    await expect(details(page)).toContainText(next.title);
    await expect(page.getByText('1 bookmark selected', {exact: true})).toBeVisible();

    // Selection spans loaded pages; "Show more" appends instead of replacing.
    await page.getByRole('checkbox', {name: 'Select all bookmarks on this page'}).click();
    await expect(page.getByText('30 bookmarks selected', {exact: true})).toBeVisible();
    await expect(row(page, entries[0].title)).toHaveCount(0);
    await page.getByRole('button', {name: /^Show \d+ more$/}).click();
    await expect(row(page, entries[0].title)).toBeVisible();
    await expect(check).toBeChecked();
    await page.getByRole('checkbox', {name: 'Select bookmark ' + entries[0].title, exact: true}).click();
    await expect(page.getByText('31 bookmarks selected', {exact: true})).toBeVisible();

    // Bulk removal is confirmed, cancellable, all-or-nothing, and never touches sources.
    await page.getByRole('button', {name: 'Remove selected bookmarks', exact: true}).click();
    await expect(dialog(page)).toContainText('31 selected bookmarks will be removed');
    await expect(dialog(page)).toContainText('not changed');
    await dialog(page).getByRole('button', {name: 'Keep bookmarks', exact: true}).click();
    await expect(dialog(page)).toHaveCount(0);
    expect((await api(id, '/entries?limit=100')).items.filter(item => entries.some(entry => entry.id === item.id))).toHaveLength(32);
    await page.getByRole('button', {name: 'Remove selected bookmarks', exact: true}).click();
    await dialog(page).getByRole('button', {name: 'Remove bookmarks', exact: true}).click();
    await expect(dialog(page)).toHaveCount(0);
    const kept = (await api(id, '/entries?limit=100')).items.filter(item => entries.some(entry => entry.id === item.id));
    expect(kept).toHaveLength(1);
    await said(page, adapter, '31 bookmarks removed');
    await expect(page.getByText(/bookmarks? selected/)).toHaveCount(0);
    if (sourceBank) expect(sourceBank.snapshot(), 'Removing bookmarks must leave native sessions and messages untouched').toBe(before);

    // Display preferences persist per profile and apply to the list.
    await page.getByRole('button', {name: 'Bookmark settings', exact: true}).click();
    const notes = dialog(page).getByRole('switch', {name: 'Show notes in list'});
    await expect(notes).toBeChecked();
    await notes.click();
    await expect(notes).not.toBeChecked();
    await expect.poll(async () => (await api(id, '/settings')).show_notes).toBe(false);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('.cb-row-note')).toHaveCount(0);
    await page.getByRole('button', {name: 'Bookmark settings', exact: true}).click();
    await expect(notes).not.toBeChecked();
    await notes.click();
    await expect(notes).toBeChecked();
    if (adapter === 'desktop') await expect(notes).toHaveAttribute('data-state', 'checked');
    await page.keyboard.press('Escape');
    await expect(page.locator('.cb-row-note').first()).toBeVisible();
  } finally {
    await dropAll(api, entries);
    await api(id, '/settings', {method: 'PUT', body: JSON.stringify({show_notes: true, show_source_status: true})});
    await refresh(page);
  }

  // Filters: type, tag rail, search and sort compose; clearing restores the list.
  const set = [
    await save(api, {title: 'Zeta whole thread', tags: ['design, decisions', 'café 日本語']}),
    await save(api, {title: 'Alpha single reply', message_id: 1, tags: ['say "hello"', 'café 日本語'], note: 'Needle in a fictional note'}),
    await save(api, {title: '<script>window.evil=true</script>', note: '<img src=x onerror=alert(1)>'})
  ];
  try {
    await refresh(page);
    const type = page.getByRole('group', {name: 'Bookmark type'});
    await type.getByRole('button', {name: 'Responses', exact: true}).click();
    await expect(row(page, set[1].title)).toBeVisible();
    await expect(row(page, set[0].title)).toHaveCount(0);
    await type.getByRole('button', {name: 'Conversations', exact: true}).click();
    await expect(row(page, set[0].title)).toBeVisible();
    await expect(row(page, set[1].title)).toHaveCount(0);
    await type.getByRole('button', {name: 'All', exact: true}).click();
    // Tags keep commas, quotes and non-ASCII text exactly.
    const rail = page.getByRole('group', {name: 'Filter by tag'});
    await rail.getByRole('button', {name: 'Filter tag design, decisions', exact: true}).click();
    await expect(row(page, set[0].title)).toBeVisible();
    await expect(row(page, set[1].title)).toHaveCount(0);
    await expect(rail.getByRole('button', {name: 'Filter tag design, decisions', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', {name: 'Clear filters', exact: true}).click();
    await page.locator('article').filter({hasText: set[1].title}).getByRole('button', {name: 'Filter tag café 日本語', exact: true}).click();
    await expect(page.getByText('2 results', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: 'Clear filters', exact: true}).click();
    await page.getByLabel('Search bookmarks', {exact: true}).fill('needle in a');
    await expect(page.getByText('1 result', {exact: true})).toBeVisible();
    await expect(row(page, set[1].title)).toBeVisible();
    await page.getByLabel('Search bookmarks', {exact: true}).fill('no-such-metadata');
    await expect(page.getByText('No matching bookmarks', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: 'Clear filters', exact: true}).first().click();
    await expect(row(page, set[0].title)).toBeVisible();
    await page.getByRole('button', {name: /^Sort:/}).click();
    await page.getByRole('menuitem', {name: 'Title A–Z', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Sort: Title A–Z'})).toBeVisible();
    await expect.poll(() => page.locator('.cb-row-title').allTextContents()).toEqual(expect.arrayContaining([set[0].title]));
    const order = await page.locator('.cb-row-title').allTextContents();
    expect(order.indexOf(set[1].title)).toBeLessThan(order.indexOf(set[0].title));
    await page.getByRole('button', {name: /^Sort:/}).click();
    await page.getByRole('menuitem', {name: 'Newest first', exact: true}).click();
    await expect.poll(async () => (await page.locator('.cb-row-title').allTextContents())[0]).toBe(set[2].title);
    // Stored text is always rendered as text.
    await expect(row(page, set[2].title)).toBeVisible();
    expect(await page.evaluate(() => window.evil)).toBeUndefined();
    await expect(page.locator('.cb img')).toHaveCount(0);

    // Keyboard: arrows browse, x selects, e edits, / searches, Escape closes.
    await row(page, set[2].title).focus();
    await page.keyboard.press('Enter');
    await expect(details(page)).toContainText('<script>');
    await page.keyboard.press('ArrowDown');
    await expect(details(page)).toContainText(set[1].title);
    await expect(row(page, set[1].title)).toBeFocused();
    await page.keyboard.press('x');
    await expect(page.getByRole('checkbox', {name: 'Select bookmark ' + set[1].title, exact: true})).toBeChecked();
    await page.keyboard.press('x');
    await page.keyboard.press('e');
    await expect(dialog(page).getByLabel('Title', {exact: true})).toHaveValue(set[1].title);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(row(page, set[1].title)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(details(page)).toContainText('Select a bookmark');
    await expect(row(page, set[1].title)).toBeFocused();
    await page.keyboard.press('/');
    await expect(page.getByLabel('Search bookmarks', {exact: true})).toBeFocused();
    await page.keyboard.type('n/e');
    await expect(page.getByLabel('Search bookmarks', {exact: true})).toHaveValue('n/e');
    await expect(dialog(page)).toHaveCount(0);
    await page.getByLabel('Search bookmarks', {exact: true}).fill('');

    if (adapter === 'desktop') {
      // Right-click offers the same actions as the row's menu button.
      await row(page, set[0].title).click({button: 'right'});
      await expect(page.getByRole('menuitem')).toHaveText(['Open conversation', 'Edit bookmark', 'Mention in chat', 'Copy resume command', 'Copy conversation ID', 'Remove bookmark']);
      await page.getByRole('menuitem', {name: 'Mention in chat', exact: true}).click();
      expect(await page.evaluate(() => window.__QA_INSERTED__.at(-1))).toEqual({session: null, text: expect.stringContaining('Bookmark “Zeta whole thread” (conversation ' + SESSION + ')'), opts: {mode: 'block'}});
      await said(page, adapter, 'Added to your message.');
      await row(page, set[0].title).dblclick();
      await expect.poll(() => page.evaluate(() => window.__QA_OPENED__?.id)).toBe(SESSION);
    }
    await page.locator('article').filter({hasText: set[0].title}).getByRole('button', {name: 'Actions for ' + set[0].title, exact: true}).click();
    await page.getByRole('menuitem', {name: 'Copy conversation ID', exact: true}).click();
    await said(page, adapter, adapter === 'desktop' ? 'Conversation ID copied.' : 'Cop');

    // An outage keeps what is on screen and offers a retry.
    const listing = '**' + prefix + '/entries?**';
    await page.route(listing, route => route.fulfill({status: 503, json: {detail: 'Fictional outage'}}));
    await refresh(page);
    await expect(page.getByRole('alert').filter({hasText: 'Fictional outage'})).toBeVisible();
    await expect(row(page, set[0].title)).toBeVisible();
    await page.unroute(listing);
    await page.getByRole('button', {name: 'Try again'}).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    await dropAll(api, set);
    await refresh(page);
  }
  console.log('PASS bookmarks collection', adapter, 'independent inspect/select, cross-page selection, cancel/bulk remove/readback, source untouched, settings, type/tag/search/sort filters, escaped text, keyboard, menus, outage/retry');
}

/** Inspector: source context, references, resume command, pruned sources, open/copy. */
export async function inspectorCases(page, adapter, api, sourceBank) {
  const status = '**' + prefix + '/status*';
  // Transport-only double: the resume command must use the profile the backend reports.
  await page.route(status, async route => { const response = await route.fetch(); await route.fulfill({response, json: {...await response.json(), profile: "review's-profile"}}); });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const clipboard = () => page.evaluate(adapter => (adapter === 'desktop' ? window.__QA_CLIPBOARD__ : navigator.clipboard.readText()), adapter);
  await openTab(page);
  const reply = await save(api, {title: 'Inspectable reply', note: 'First line\nSecond line', tags: ['kept'], message_id: 1});
  const pruned = await save(api, {title: 'Inspectable source', session_id: 'pruned-session', message_id: 44});
  try {
    await refresh(page);
    await row(page, reply.title).click();
    const pane = details(page);
    await expect(pane).toContainText('Response bookmark');
    await expect(pane.getByRole('region', {name: 'Note'})).toContainText('First line');
    // Context is read on request and shown, never stored with the bookmark.
    await expect(pane.locator('.cb-excerpt')).toHaveText('Native assistant preview from the real source API.');
    await expect(pane).toContainText('Native source conversation');
    expect((await api(id, '/entries/' + reply.id)).note).toBe('First line\nSecond line');
    expect(Object.keys(await api(id, '/entries/' + reply.id))).not.toContain('excerpt');
    await expect(pane.getByText(SESSION, {exact: true})).toHaveCount(0);
    await pane.getByRole('button', {name: 'Reference', exact: true}).click();
    await expect(pane.getByText(SESSION, {exact: true})).toBeVisible();
    await expect(pane.getByText("hermes --profile 'review'\\''s-profile' --resume '" + SESSION + "'", {exact: true})).toBeVisible();
    await pane.getByRole('button', {name: 'Copy conversation id', exact: true}).click();
    await expect.poll(clipboard).toBe(SESSION);
    await moreActions(page, 'Copy resume command');
    await expect.poll(clipboard).toBe("hermes --profile 'review'\\''s-profile' --resume '" + SESSION + "'");
    await pane.getByRole('button', {name: 'Show bookmarks tagged kept', exact: true}).click();
    await expect(page.getByText('1 result', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: 'Clear filters', exact: true}).click();
    if (adapter === 'desktop') {
      await row(page, reply.title).click();
      await pane.getByRole('button', {name: 'Open conversation', exact: true}).click();
      await expect.poll(() => page.evaluate(() => window.__QA_OPENED__)).toEqual({id: SESSION, options: {profile: 'default', expectHistory: true}});
    } else {
      await expect(pane.getByRole('button', {name: 'Open conversation'})).toHaveCount(0);
    }

    // A pruned source keeps the bookmark, flags it, and can no longer be opened.
    await row(page, pruned.title).click();
    await expect(pane).toContainText('Prunable source');
    sourceBank.prune();
    await refresh(page);
    await expect(page.locator('article').filter({hasText: pruned.title})).toContainText('Conversation unavailable');
    await row(page, pruned.title).click();
    await expect(pane.getByRole('status')).toContainText('Conversation unavailable');
    await expect(pane.getByText('pruned-session', {exact: true})).toBeVisible();
    await expect(pane.getByText('44', {exact: true})).toBeVisible();
    if (adapter === 'desktop') await expect(pane.getByRole('button', {name: 'Open conversation', exact: true})).toBeDisabled();
    // Its annotations stay editable, and the editor never asks for raw IDs.
    await pane.getByRole('button', {name: 'Edit bookmark', exact: true}).click();
    await expect(dialog(page)).toContainText('No longer available');
    await expect(dialog(page).getByText('pruned-session')).toHaveCount(0);
    await dialog(page).getByLabel('Note', {exact: true}).fill('Still editable');
    await dialog(page).getByRole('button', {name: 'Save changes', exact: true}).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(await api(id, '/entries/' + pruned.id)).toMatchObject({note: 'Still editable', session_id: 'pruned-session', message_id: 44, source_status: 'session_missing'});
    // The list can hide the flag; the inspector always tells the truth.
    await api(id, '/settings', {method: 'PUT', body: JSON.stringify({show_notes: true, show_source_status: false})});
    await refresh(page);
    await expect(page.locator('article').filter({hasText: pruned.title})).not.toContainText('Conversation unavailable');
  } finally {
    await api(id, '/settings', {method: 'PUT', body: JSON.stringify({show_notes: true, show_source_status: true})});
    await dropAll(api, [reply, pruned]);
    sourceBank.restore();
    await page.unroute(status);
    await refresh(page);
  }
  console.log('PASS bookmarks inspector', adapter, 'on-request context, quoted named-profile resume, copy, tag jump, open/recheck, pruned source flag + editable annotations, no raw IDs in editor');
}

const choices = [{id: SESSION, title: 'Release planning', updated_at: 1793400000, source: 'desktop'}, {id: 'other-session', title: 'Other conversation', updated_at: null, source: 'cli'}];
const reply = {id: 1, preview: 'Ship the reviewed build after verification.', created_at: 1793400100};

/** Editor: source picker, response scope, tags, validation, conflicts, focus and small screens. */
export async function editorCases(page, adapter, api, proof) {
  let mode = 'normal';
  const requests = [], writes = [];
  await page.route('**' + prefix + '/sources/**', async route => {
    const url = new URL(route.request().url());
    requests.push(url);
    const q = url.searchParams.get('q'), responses = url.pathname.endsWith('/responses'), offset = Number(url.searchParams.get('offset'));
    if (mode === 'error') return route.fulfill({status: 503, json: {detail: 'Choices temporarily unavailable'}});
    if (q === 'slow') await new Promise(resolve => setTimeout(resolve, 700));
    const items = q === 'none' ? []
      : responses ? (url.pathname.includes('other-session') ? [{...reply, id: 2, preview: 'Other assistant reply'}] : q === 'slow' ? [{...reply, id: 3, preview: 'STALE RESPONSE'}] : offset > 0 ? [{...reply, id: 4, preview: 'Older assistant reply'}] : [reply])
      : q === 'slow' ? [{...choices[0], id: 'stale', title: 'STALE CONVERSATION'}] : offset > 0 ? [{id: 'older-session', title: 'older-source · older-session', source: 'older-source', updated_at: null}] : choices;
    await route.fulfill({json: {items, has_more: !q && offset === 0, window: {limit: responses ? 500 : 1000, truncated: q !== 'complete'}}});
  });
  const record = request => { if (request.url().includes(prefix + '/entries') && ['POST', 'PUT', 'DELETE'].includes(request.method())) writes.push({method: request.method(), body: request.postDataJSON()}); };
  page.on('request', record);
  const editor = () => dialog(page);
  const option = name => editor().getByRole('option', {name});
  const title = () => editor().getByLabel('Title', {exact: true});
  const submit = () => editor().getByRole('button', {name: 'Save bookmark', exact: true});
  const created = [];
  try {
    await openTab(page);
    await page.getByRole('button', {name: 'New bookmark', exact: true}).click();
    // Step one is only a choice: nothing can be saved, and no ID is ever shown.
    await expect(editor().getByLabel('Search conversations', {exact: true})).toBeFocused();
    await expect(submit()).toBeDisabled();
    await expect(title()).toHaveCount(0);
    await expect(editor().getByText(SESSION)).toHaveCount(0);
    await expect(editor()).toContainText('Showing your 1,000 most recent conversations');
    await expect(option(/Other conversation/)).toContainText('CLI');
    // "Show more" appends older choices; untitled sessions get a human label.
    await editor().getByRole('button', {name: 'Show more conversations'}).click();
    await expect(option(/Untitled conversation/)).toBeVisible();
    await expect(option(/Release planning/)).toBeVisible();
    await expect(editor().getByText('older-session')).toHaveCount(0);
    // A slow, superseded search can never replace newer results.
    await editor().getByLabel('Search conversations', {exact: true}).fill('slow');
    await editor().getByLabel('Search conversations', {exact: true}).fill('complete');
    await expect(option(/Release planning/)).toBeVisible();
    await page.waitForTimeout(900);
    await expect(editor().getByText('STALE CONVERSATION')).toHaveCount(0);
    await expect(editor()).not.toContainText('most recent conversations');
    await editor().getByLabel('Search conversations', {exact: true}).fill('none');
    await expect(editor().getByText('No matches', {exact: true})).toBeVisible();
    mode = 'error';
    await editor().getByLabel('Search conversations', {exact: true}).fill('fail');
    await expect(editor().getByRole('alert')).toContainText('Choices temporarily unavailable');
    mode = 'normal';
    await editor().getByRole('button', {name: 'Retry conversations'}).click();
    await editor().getByLabel('Search conversations', {exact: true}).fill('');
    // Enter in the search box never submits the form.
    await editor().getByLabel('Search conversations', {exact: true}).press('Enter');
    await expect(editor()).toBeVisible();
    expect(writes).toHaveLength(0);

    // Choosing moves on: title prefilled, whole conversation by default.
    await option(/Release planning/).click();
    await expect(title()).toBeFocused();
    await expect(title()).toHaveValue('Release planning');
    await expect(editor().getByRole('button', {name: 'Whole conversation', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await expect(submit()).toBeEnabled();
    // The prefilled title follows a changed conversation until the person edits it.
    await editor().getByRole('button', {name: 'Change conversation', exact: true}).click();
    await option(/Other conversation/).click();
    await expect(title()).toHaveValue('Other conversation');
    await title().fill('My own title');
    await editor().getByRole('button', {name: 'Change conversation', exact: true}).click();
    await editor().getByRole('button', {name: 'Keep current', exact: true}).click();
    await expect(editor()).toContainText('Other conversation');
    await editor().getByRole('button', {name: 'Change conversation', exact: true}).click();
    await option(/Release planning/).click();
    await expect(title()).toHaveValue('My own title');

    // One response: required once chosen as the scope, reset with the conversation.
    await editor().getByRole('button', {name: 'One response', exact: true}).click();
    await expect(submit()).toBeDisabled();
    await option(/Ship the reviewed build/).click();
    await expect(option(/Ship the reviewed build/)).toHaveAttribute('aria-selected', 'true');
    await expect(submit()).toBeEnabled();
    await editor().getByRole('button', {name: 'Show more responses'}).click();
    await expect(option(/Older assistant reply/)).toBeVisible();
    await editor().getByLabel('Search responses', {exact: true}).fill('slow');
    await editor().getByLabel('Search responses', {exact: true}).fill('');
    await page.waitForTimeout(900);
    await expect(editor().getByText('STALE RESPONSE')).toHaveCount(0);
    mode = 'error';
    await editor().getByLabel('Search responses', {exact: true}).fill('fail');
    await expect(editor().getByRole('button', {name: 'Retry responses'})).toBeVisible();
    mode = 'normal';
    await editor().getByRole('button', {name: 'Retry responses'}).click();
    await editor().getByLabel('Search responses', {exact: true}).fill('');
    await expect(option(/Ship the reviewed build/)).toHaveAttribute('aria-selected', 'true');
    await editor().getByRole('button', {name: 'Whole conversation', exact: true}).click();
    await editor().getByRole('button', {name: 'One response', exact: true}).click();
    await expect(option(/Ship the reviewed build/)).toHaveAttribute('aria-selected', 'false');
    await option(/Ship the reviewed build/).click();

    // Tags are chips; commas and non-ASCII text stay inside one tag; duplicates fold.
    const tags = editor().getByRole('textbox', {name: 'Tags'});
    for (const tag of ['design, decisions', 'say "hello"', 'café 日本語', 'CAFÉ 日本語']) { await tags.fill(tag); await tags.press('Enter'); }
    await expect(editor().locator('.cb-chip-text')).toHaveText(['#design, decisions', '#say "hello"', '#café 日本語']);
    await expect(editor()).toBeVisible();
    await tags.press('Backspace');
    await expect(editor().locator('.cb-chip')).toHaveCount(2);
    await tags.fill('pending');
    await editor().getByRole('button', {name: 'Remove tag design, decisions', exact: true}).click();
    await editor().getByLabel('Note', {exact: true}).fill('Chosen in the picker');
    // The primary modifier + Enter saves from anywhere in the form.
    await editor().getByLabel('Note', {exact: true}).press('Control+Enter');
    await expect(editor()).toHaveCount(0);
    expect(writes.at(-1)).toEqual({method: 'POST', body: {title: 'My own title', note: 'Chosen in the picker', tags: ['say "hello"', 'pending'], session_id: SESSION, message_id: 1}});
    const saved = (await api(id, '/entries')).items.find(item => item.title === 'My own title');
    created.push(saved);
    await said(page, adapter, 'Bookmark saved.');
    // The new bookmark is listed and open in the inspector without a manual refresh.
    await expect(row(page, 'My own title')).toHaveAttribute('aria-current', 'true');
    await expect(details(page)).toContainText('Chosen in the picker');

    // Editing keeps a reference that is not in the current choices until it is replaced.
    await details(page).getByRole('button', {name: 'Edit bookmark', exact: true}).click();
    await expect(title()).toBeFocused();
    await expect(editor().getByRole('button', {name: 'One response', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await title().fill('Renamed only');
    await editor().getByRole('button', {name: 'Save changes', exact: true}).click();
    await expect(editor()).toHaveCount(0);
    expect(await api(id, '/entries/' + saved.id)).toMatchObject({title: 'Renamed only', session_id: SESSION, message_id: 1, tags: ['say "hello"', 'pending']});

    // A real revision conflict keeps the dialog and the draft.
    await details(page).getByRole('button', {name: 'Edit bookmark', exact: true}).click();
    const current = await api(id, '/entries/' + saved.id);
    await api(id, '/entries/' + saved.id, {method: 'PUT', body: JSON.stringify({title: current.title, note: 'Concurrent edit', tags: current.tags, session_id: current.session_id, message_id: current.message_id, revision: current.revision})});
    await editor().getByLabel('Note', {exact: true}).fill('Unsaved draft');
    await editor().getByRole('button', {name: 'Save changes', exact: true}).click();
    await expect(editor().getByRole('alert')).toContainText('changed elsewhere');
    await expect(editor().getByLabel('Note', {exact: true})).toHaveValue('Unsaved draft');
    await editor().getByRole('button', {name: 'Cancel', exact: true}).click();
    expect((await api(id, '/entries/' + saved.id)).note).toBe('Concurrent edit');

    // Removal: cancel keeps it, a failed delete says so and stays open, success reads back.
    await refresh(page);
    await row(page, 'Renamed only').click();
    await moreActions(page, 'Remove bookmark');
    await expect(dialog(page)).toContainText('“Renamed only” will be removed');
    await dialog(page).getByRole('button', {name: 'Keep bookmark', exact: true}).click();
    await expect(dialog(page)).toHaveCount(0);
    expect((await api(id, '/entries/' + saved.id)).id).toBe(saved.id);
    const deleting = '**' + prefix + '/entries/' + saved.id + '*';
    await page.route(deleting, route => (route.request().method() === 'DELETE' ? route.fulfill({status: 503, json: {detail: 'Delete unavailable'}}) : route.continue()));
    await moreActions(page, 'Remove bookmark');
    await dialog(page).getByRole('button', {name: 'Remove bookmark', exact: true}).click();
    await expect(dialog(page)).toContainText('Delete unavailable');
    await page.unroute(deleting);
    await dialog(page).getByRole('button', {name: 'Remove bookmark', exact: true}).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(row(page, 'Renamed only')).toHaveCount(0);
    expect((await api(id, '/entries')).items.some(item => item.id === saved.id)).toBe(false);
    created.length = 0;
    // The removed row is gone, so focus lands on a control that still exists.
    await expect(page.getByRole('button', {name: 'New bookmark', exact: true})).toBeFocused();
  } finally {
    page.off('request', record);
    await page.unroute('**' + prefix + '/sources/**');
    await dropAll(api, created);
  }

  // Small screens: the form scrolls, its footer stays reachable, and focus stays inside.
  const entry = await save(api, {title: 'Keyboard focus regression'});
  const long = [await save(api, {title: 'UnbrokenTitle'.repeat(12)}), await save(api, {title: 'A long title with words that must wrap instead of overflowing the list at a narrow viewport '.repeat(2).slice(0, 160)})];
  try {
    await page.setViewportSize({width: 360, height: 640});
    await refresh(page);
    const evidence = [];
    for (const item of long) {
      const button = row(page, item.title);
      await button.scrollIntoViewIfNeeded();
      const bounds = await button.evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); return {card: node.closest('article').getBoundingClientRect().toJSON(), text: [...range.getClientRects()].map(rect => rect.toJSON())}; });
      evidence.push({title: item.title, ...bounds});
      for (const rect of bounds.text) { expect(rect.left).toBeGreaterThanOrEqual(bounds.card.left - 1); expect(rect.right).toBeLessThanOrEqual(Math.min(360, bounds.card.right + 1)); }
      expect(bounds.text.length).toBeGreaterThan(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await writeFile(join(proof, `bookmarks-title-bounds-${adapter}.json`), JSON.stringify(evidence, null, 2));
    await page.screenshot({path: join(proof, `bookmarks-${adapter}-360.png`), fullPage: true});
    const activate = async control => { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); };
    const trigger = row(page, entry.title);
    // On a narrow screen the inspector takes the list's place and hands focus back on return.
    await activate(trigger);
    await expect(details(page)).toContainText(entry.title);
    await expect(trigger).toBeHidden();
    await details(page).getByRole('button', {name: 'Back to bookmarks', exact: true}).click();
    await expect(trigger).toBeFocused();
    await activate(trigger);
    const edit = details(page).getByRole('button', {name: 'Edit bookmark', exact: true});
    await activate(edit);
    for (let n = 0; n < 16; n++) { await page.keyboard.press('Tab'); expect(await dialog(page).evaluate(node => node.contains(document.activeElement))).toBe(true); }
    await dialog(page).getByLabel('Note', {exact: true}).fill('Short viewport saved by keyboard');
    for (const name of ['Cancel', 'Save changes']) {
      const control = dialog(page).getByRole('button', {name, exact: true});
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport({ratio: 1});
    }
    await page.screenshot({path: join(proof, `bookmarks-editor-${adapter}-360.png`)});
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(edit).toBeFocused();
    await activate(edit);
    await dialog(page).getByLabel('Note', {exact: true}).fill('Short viewport saved by keyboard');
    await activate(dialog(page).getByRole('button', {name: 'Save changes', exact: true}));
    await expect(dialog(page)).toHaveCount(0);
    expect((await api(id, '/entries/' + entry.id)).note).toBe('Short viewport saved by keyboard');
  } finally {
    await page.setViewportSize({width: 1440, height: 1100});
    await dropAll(api, [entry, ...long]);
    await refresh(page);
  }
  console.log('PASS bookmarks editor', adapter, 'picker default/choose/change/keep, show more, search races, errors/retry/empty, response scope reset, tag chips, modifier save, readback, old refs, conflict/draft, remove cancel/error/readback/focus fallback, 360px bounds/footer/focus trap');
}

/** Draft with AI: explicit, reviewable, fenced against edits, and never a save. */
export async function generationCases(page, adapter, api, base) {
  const editor = () => dialog(page), route = '**' + prefix + '/generation/draft*';
  const draft = () => editor().getByRole('button', {name: 'Draft with AI', exact: true});
  const context = () => editor().getByRole('button', {name: /^Context: \d+ previous exchanges$/});
  const settings = async () => (await api(id, '/generation/settings')).previous_exchanges;
  const pick = async value => { await context().click(); await page.getByRole('menuitem', {name: value + ' previous exchanges', exact: true}).click(); };
  const start = async () => {
    await page.getByRole('button', {name: 'New bookmark', exact: true}).click();
    await editor().getByRole('option', {name: /Native source conversation/}).click();
  };
  const chooseReply = async () => {
    await editor().getByRole('button', {name: 'One response', exact: true}).click();
    await editor().getByRole('option', {name: /Native assistant preview/}).click();
  };
  const cancel = async () => { await editor().getByRole('button', {name: 'Cancel', exact: true}).click(); await expect(editor()).toHaveCount(0); };
  const original = await settings();
  const count = (await api(id, '/entries')).total;
  let calls = 0, release, pending = false, fail = false;
  const settingWrites = [];
  const record = request => { if (request.method() === 'PUT' && request.url().includes('/generation/settings')) settingWrites.push(request.postDataJSON()); };
  page.on('request', record);
  await page.route(route, async intercepted => {
    calls++;
    expect(intercepted.request().postDataJSON()).toEqual({session_id: SESSION, message_id: 1});
    if (pending) await new Promise(resolve => { release = resolve; });
    if (fail) return intercepted.fulfill({status: 502, json: {detail: 'Fictional model unavailable'}});
    await intercepted.fulfill({json: {draft: {title: 'Fictional reviewed draft', note: 'Fictional review note', tags: ['drafted', 'Drafted', 'review']}, context: {previous_exchanges: 10, truncated: true}}});
  });
  try {
    await openTab(page);
    await api(id, '/generation/settings', {method: 'PUT', body: JSON.stringify({previous_exchanges: 10})});
    // Opening, choosing and changing scope never call the model or write a setting.
    await start();
    await expect(draft()).toBeDisabled();
    await expect(context()).toHaveAccessibleName('Context: 10 previous exchanges');
    await chooseReply();
    await expect(draft()).toBeEnabled();
    expect(calls).toBe(0);
    expect(settingWrites).toHaveLength(0);
    // The context preset is saved when chosen and survives reopening.
    await context().click();
    await expect(page.getByRole('menuitem')).toHaveText([/^5 previous exchanges/, /^10 previous exchanges/, /^20 previous exchanges/, /^50 previous exchanges/]);
    await page.keyboard.press('Escape');
    await pick(5);
    await expect.poll(settings).toBe(5);
    await cancel();
    await start();
    await expect(context()).toHaveAccessibleName('Context: 5 previous exchanges');
    expect(settingWrites).toEqual([{previous_exchanges: 5}]);
    await chooseReply();
    // A draft fills the form for review. It replaces fields; it does not save.
    await editor().getByLabel('Note', {exact: true}).fill('Written by hand');
    await draft().click();
    await expect(editor().getByLabel('Title', {exact: true})).toHaveValue('Fictional reviewed draft');
    await expect(editor().getByLabel('Note', {exact: true})).toHaveValue('Fictional review note');
    await expect(editor().locator('.cb-chip-text')).toHaveText(['#drafted', '#review']);
    await expect(editor().getByRole('status')).toContainText('Draft ready to review. Earlier context was shortened.');
    expect(calls).toBe(1);
    expect((await api(id, '/entries')).total).toBe(count);
    // Editing while a draft is being written keeps the edit and discards the draft.
    pending = true;
    await editor().getByLabel('Title', {exact: true}).fill('Before');
    await draft().click();
    await expect.poll(() => calls).toBe(2);
    await expect(editor().getByRole('status')).toContainText('You can keep editing');
    await editor().getByLabel('Title', {exact: true}).fill('My newer title');
    release();
    await expect(editor().getByRole('status')).toContainText('the draft was not applied');
    await expect(editor().getByLabel('Title', {exact: true})).toHaveValue('My newer title');
    // So does choosing a different scope mid-draft.
    await draft().click();
    await expect.poll(() => calls).toBe(3);
    await editor().getByRole('button', {name: 'Whole conversation', exact: true}).click();
    release();
    await page.waitForTimeout(200);
    await expect(editor().getByLabel('Title', {exact: true})).toHaveValue('My newer title');
    await expect(draft()).toBeDisabled();
    pending = false;
    // A model failure is reported inline and can be retried.
    await chooseReply();
    fail = true;
    await draft().click();
    await expect(editor().getByRole('alert')).toContainText('Fictional model unavailable');
    fail = false;
    await editor().getByRole('button', {name: 'Try again', exact: true}).click();
    await expect(editor().getByLabel('Title', {exact: true})).toHaveValue('Fictional reviewed draft');
    await cancel();
    expect((await api(id, '/entries')).total).toBe(count);

    // A failed setting save keeps the shown choice, blocks drafting, and retries.
    await start();
    let refuse = true;
    const settingRoute = '**' + prefix + '/generation/settings*';
    await page.route(settingRoute, async intercepted => (refuse && intercepted.request().method() === 'PUT' ? intercepted.fulfill({status: 503, json: {detail: 'Fictional setting unavailable'}}) : intercepted.continue()));
    await pick(20);
    await expect(editor().getByRole('alert')).toContainText('Fictional setting unavailable');
    await expect(context()).toHaveAccessibleName('Context: 20 previous exchanges');
    await chooseReply();
    await expect(draft()).toBeDisabled();
    refuse = false;
    await editor().getByRole('button', {name: 'Retry context setting'}).click();
    await expect.poll(settings).toBe(20);
    await expect(draft()).toBeEnabled();
    await page.unroute(settingRoute);
    await cancel();
    // Older stored values outside the presets show as 10 and are only rewritten by an explicit draft.
    for (const legacy of [0, 7, 100]) {
      await api(id, '/generation/settings', {method: 'PUT', body: JSON.stringify({previous_exchanges: legacy})});
      const writes = settingWrites.length, before = calls;
      await start();
      await expect(context()).toHaveAccessibleName('Context: 10 previous exchanges');
      expect(settingWrites).toHaveLength(writes);
      expect(await settings()).toBe(legacy);
      await chooseReply();
      await draft().click();
      await expect.poll(() => calls).toBe(before + 1);
      expect(await settings()).toBe(10);
      await cancel();
    }
  } finally {
    page.off('request', record);
    await page.unroute(route);
    await api(id, '/generation/settings', {method: 'PUT', body: JSON.stringify({previous_exchanges: original})});
  }

  // A draft still in flight when the profile, connection or plugin goes away is dropped silently.
  for (const change of scopeChanges(adapter)) {
    await fresh(page, base, adapter);
    await start();
    await chooseReply();
    let free, seen;
    const held = new Promise(resolve => { free = resolve; }), entered = new Promise(resolve => { seen = resolve; });
    await page.route(route, async intercepted => { seen(); await held; await intercepted.fulfill({json: {draft: {title: 'RETIRED DRAFT', note: '', tags: []}, context: {previous_exchanges: 10, truncated: false}}}); });
    await draft().click();
    await entered;
    await changeScope(page, adapter, change);
    await expect(editor()).toHaveCount(0);
    // Let the new scope finish its own loading before counting what the old one may still send.
    await page.waitForTimeout(500);
    const requests = await page.evaluate(() => window.__QA_REQUESTS__.length);
    free();
    await page.unroute(route, {behavior: 'wait'});
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.__QA_REQUESTS__.length)).toBe(requests);
    await expect(page.getByText('RETIRED DRAFT')).toHaveCount(0);
    console.log('PASS bookmarks pending draft fence', adapter, change);
  }
  await fresh(page, base, adapter);
  expect((await api(id, '/entries')).total).toBe(count);
  console.log('PASS bookmarks AI draft', adapter, 'explicit click only, persisted presets, review-only draft, edit/scope fences, error/retry, setting failure, legacy normalization');
}

/** Requests already sent when the scope changes may finish, but nothing follows them. */
export async function fenceCases(page, adapter, api, base) {
  for (const change of scopeChanges(adapter)) {
    // A held save: the form locks, Escape cannot abandon it, and no readback follows a scope change.
    await fresh(page, base, adapter);
    const old = (await api(id, '/entries')).items[0];
    await row(page, old.title).click();
    await details(page).getByRole('button', {name: 'Edit bookmark', exact: true}).click();
    let free, seen;
    const held = new Promise(resolve => { free = resolve; }), entered = new Promise(resolve => { seen = resolve; });
    const pattern = '**' + prefix + '/entries/' + old.id + '*';
    await page.route(pattern, async route => { if (route.request().method() === 'PUT') { seen(); await held; } await route.continue(); });
    await dialog(page).getByRole('button', {name: 'Save changes', exact: true}).click();
    await entered;
    await expect(dialog(page).getByLabel('Title', {exact: true})).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeVisible();
    await changeScope(page, adapter, change);
    await page.waitForTimeout(350);
    const requests = await page.evaluate(() => window.__QA_REQUESTS__.length);
    free();
    await page.unroute(pattern, {behavior: 'wait'});
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => window.__QA_REQUESTS__.length)).toBe(requests);
    console.log('PASS bookmarks pending save fence', adapter, change);

    // A held source search: its late answer never reaches a later scope's screen.
    await fresh(page, base, adapter);
    await page.getByRole('button', {name: 'New bookmark', exact: true}).click();
    let release, started;
    const blocked = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { started = resolve; });
    const sources = '**' + prefix + '/sources/sessions?**';
    await page.route(sources, async route => {
      if (new URL(route.request().url()).searchParams.get('q') !== 'fence') return route.continue();
      started(); await blocked;
      await route.fulfill({json: {items: [{id: 'stale-secret', title: 'Retired source result', updated_at: null}], has_more: false}});
    });
    await dialog(page).getByLabel('Search conversations', {exact: true}).fill('fence');
    await began;
    await changeScope(page, adapter, change);
    await expect(dialog(page)).toHaveCount(0);
    release();
    await page.unroute(sources, {behavior: 'wait'});
    await page.waitForTimeout(250);
    await expect(page.getByText('Retired source result')).toHaveCount(0);
    console.log('PASS bookmarks pending source fence', adapter, change);
  }
  await fresh(page, base, adapter);
}

/** Desktop-only integrations: quick find, commands, shortcut, composer and sidebar marks. */
export async function desktopCases(page, api) {
  const area = name => page.evaluate(name => window.__QA_REGISTRY__.getArea(name).filter(c => c.source === 'plugin:conversation-bookmarks').map(c => ({id: c.id, ...Object.fromEntries(Object.entries(c.data || {}).filter(([, value]) => typeof value !== 'function'))})), name);
  const run = (name, key, value) => page.evaluate(([name, key, value]) => window.__QA_REGISTRY__.getArea(name).find(c => c.source === 'plugin:conversation-bookmarks' && c.data?.[key] === value).data.run(), [name, key, value]);
  await openTab(page);
  const entries = [await save(api, {title: 'Quick alpha', note: 'First fictional note', tags: ['quick']}), await save(api, {title: 'Quick beta', message_id: 1})];
  try {
    await refresh(page);
    // One command pattern: palette rows, a rebindable shortcut that shares the save action, and the composer's + menu.
    expect((await area('palette')).map(item => item.label)).toEqual(['Find a bookmark', 'Browse bookmarks', 'Bookmark this conversation']);
    expect(await area('keybinds')).toEqual([expect.objectContaining({id: 'conversation-bookmarks.save', defaults: ['mod+alt+b'], label: 'Bookmark this conversation'})]);
    expect((await area('palette')).find(item => item.label === 'Bookmark this conversation').action).toBe('conversation-bookmarks.save');
    expect((await area('composer.attachments')).map(item => item.label)).toEqual(['Bookmarks']);

    // Quick find: type, arrow, Enter returns to the conversation.
    await run('composer.attachments', 'label', 'Bookmarks');
    const quick = page.getByRole('dialog', {name: 'Find a bookmark'});
    const search = quick.getByRole('textbox');
    await expect(search).toBeFocused();
    await expect(quick.getByRole('option')).toHaveCount(3);
    await search.fill('quick');
    await expect(quick.getByRole('option')).toHaveCount(2);
    await expect(quick.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(quick.getByRole('option', {name: /Quick alpha/})).toHaveAttribute('aria-selected', 'true');
    // The modifier mentions the bookmark in the message being written instead.
    await page.keyboard.press('Control+Enter');
    await expect(quick).toHaveCount(0);
    expect(await page.evaluate(() => window.__QA_INSERTED__.at(-1).text)).toBe('Bookmark “Quick alpha” (conversation ' + SESSION + ')\nNote: First fictional note');
    await run('palette', 'label', 'Find a bookmark');
    await search.fill('quick beta');
    await expect(quick.getByRole('option')).toHaveCount(1);
    await page.evaluate(() => { window.__QA_OPENED__ = null; });
    await page.keyboard.press('Enter');
    await expect(quick).toHaveCount(0);
    expect(await page.evaluate(() => window.__QA_OPENED__)).toEqual({id: SESSION, options: {profile: 'default', expectHistory: true}});
    // With no chat to write into, the dialog says so and stays.
    await run('palette', 'label', 'Find a bookmark');
    await page.evaluate(() => { window.__QA_NO_COMPOSER__ = true; });
    await search.fill('quick alpha');
    await expect(quick.getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Control+Enter');
    await expect(quick.getByRole('alert')).toContainText('Open a chat to mention this bookmark.');
    await page.evaluate(() => { window.__QA_NO_COMPOSER__ = false; });
    await quick.getByRole('button', {name: 'All bookmarks', exact: true}).click();
    await expect(quick).toHaveCount(0);
    expect(await page.evaluate(() => window.__QA_NAVIGATED__)).toBe('/saved');

    // "Bookmark this conversation" opens the editor on the focused chat, from any route.
    await run('keybinds', 'id', 'conversation-bookmarks.save');
    const editor = page.getByRole('dialog', {name: 'New bookmark'});
    await expect(editor).toContainText('Native source conversation');
    await expect(editor.getByLabel('Title', {exact: true})).toHaveValue('Native source conversation');
    await expect(editor.getByLabel('Title', {exact: true})).toBeFocused();
    await editor.getByLabel('Title', {exact: true}).fill('Saved from the shortcut');
    await editor.getByRole('button', {name: 'Save bookmark', exact: true}).click();
    await expect(editor).toHaveCount(0);
    const stored = (await api(id, '/entries')).items.find(item => item.title === 'Saved from the shortcut');
    expect(stored).toMatchObject({session_id: SESSION, message_id: null});
    entries.push(stored);
    // The open collection hears about it, and the toast offers the way there.
    await expect(row(page, 'Saved from the shortcut')).toBeVisible();
    const notice = await page.evaluate(() => { const last = window.__QA_NOTICES__.at(-1); return {message: last.message, action: last.action?.label}; });
    expect(notice).toEqual({message: 'Bookmark saved.', action: 'View'});
    // With no focused chat the same command starts at the conversation picker.
    await page.evaluate(() => window.__QA_SDK__.host.state.focusedStoredSessionId.set(null));
    await run('palette', 'label', 'Bookmark this conversation');
    await expect(editor.getByLabel('Search conversations', {exact: true})).toBeFocused();
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__QA_SDK__.host.state.focusedStoredSessionId.set('fictional-session-01'));

    // Sidebar mark: counts for this profile's conversations, and a jump to just those bookmarks.
    const mark = page.getByRole('complementary', {name: 'Native session rows'}).getByRole('button');
    await expect(mark).toHaveAccessibleName(/^\d+ bookmarks in this conversation$/);
    const total = (await api(id, '/marks')).sessions[SESSION];
    await expect(mark).toHaveAccessibleName(`${total} bookmarks in this conversation`);
    await mark.click();
    await expect(page.getByRole('button', {name: /This conversation/})).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(`${total} results`, {exact: true})).toBeVisible();
    await page.getByRole('button', {name: /This conversation/}).click();
    await expect(page.getByRole('button', {name: /This conversation/})).toHaveCount(0);
    // Marks never leak across profiles.
    await page.evaluate(() => window.__QA_SDK__.host.state.profile.set('foreign'));
    await expect(mark).toHaveCount(0);
    await page.evaluate(() => window.__QA_SDK__.host.state.profile.set('default'));
    await expect(mark).toHaveCount(1);
    await openTab(page);
  } finally {
    await dropAll(api, entries);
    await refresh(page);
  }
  await expect(page.getByRole('complementary', {name: 'Native session rows'}).getByRole('button')).toHaveAccessibleName(/^\d+ bookmarks? in this conversation$/);
  console.log('PASS bookmarks desktop integrations', 'palette + shared-action shortcut, composer quick find, open/mention/no-chat, save from focused chat, live collection refresh, sidebar marks + conversation filter, profile isolation');
}
