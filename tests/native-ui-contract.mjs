import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
const base=resolve(import.meta.dirname,'../..');
for(const name of ['hermes-conversation-bookmarks','hermes-delivery-shelf']){
 const read=p=>readFile(resolve(base,name,p),'utf8');
 const native=await read('ui/presentation.desktop.jsx');
 for(const part of ['Button','Input','SearchField','SelectTrigger','DialogContent','TabsTrigger','ListRow','EmptyState','ErrorState','Loader'])assert.ok(native.includes(part),part);
 assert.ok(native.includes("from '@hermes/plugin-sdk'"));
 const dash=await read('ui/presentation.dashboard.jsx');assert.ok(dash.includes('SDK.components'));assert.ok(!dash.includes('@hermes/plugin-sdk'));
 for(const file of ['ui/style.css','ui/saved.css']){
  const css=await read(file);
  assert.doesNotMatch(css,/#(?:8271c4|65519c|207f85|236f76)|font-family|::after|\.(?:cb|ds|hs-saved)\s+(?:button|input|select|textarea)/i);
 }
 const bundle=await read('desktop/plugin.js');assert.ok(bundle.includes('@hermes/plugin-sdk'));
 console.log('PASS public component boundary + scoped layout',name);
}
const editor=await readFile(resolve(base,'hermes-conversation-bookmarks/ui/BookmarkEditor.jsx'),'utf8');
assert.doesNotMatch(editor,/Session ID|Message ID|Exact stored/);
console.log('PASS approachable editor labels');
