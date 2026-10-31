import React, {useEffect,useRef,useState,useId} from 'react';
import styles from './style.css';
import {useCollectionFocus} from './collection-focus.js';
import {Button,Input,Textarea,SearchField,Choice,Field,Dialog,DialogFooter,EmptyState,ErrorState,Loader} from '@saved/presentation';
const initialFilters=()=>({q:'',tag:'',sort:'newest'});
const fresh=()=>({title:'',note:'',tags:[],session_id:'',message_id:null});
const message=e=>e?.message||'The request failed. Refresh and try again.';
const sourceLabel=s=>({available:'Source available',session_missing:'Session unavailable',message_missing:'Message unavailable',store_missing:'Session store unavailable',unavailable:'Source check unavailable'}[s]||'Source unavailable');
import {BookmarkEditor as Editor} from './BookmarkEditor.jsx';
export function Bookmarks({api,embedded=false}){
 const [status,setStatus]=useState(null),[data,setData]=useState({items:[],total:0}),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [filters,setFilters]=useState(initialFilters),[offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0);
 const [editor,setEditor]=useState(undefined),[selected,setSelected]=useState(null),[removing,setRemoving]=useState(null),[busy,setBusy]=useState(false),[actionError,setActionError]=useState(''),[notice,setNotice]=useState('');
 const focus=useCollectionFocus(editor!==undefined||Boolean(selected||removing));
 const alive=useRef(false),serial=useRef(0),actions=useRef(0),working=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;serial.current++;actions.current++;};},[]);
 useEffect(()=>{
  const ticket=++serial.current;setLoading(true);setError('');
  const timer=setTimeout(async()=>{try{const [s,d]=await Promise.all([api('/status'),api('/entries?'+new URLSearchParams({...filters,offset:String(offset),limit:'30'}))]);if(alive.current&&ticket===serial.current){setStatus(s);setData(d);}}catch(e){if(alive.current&&ticket===serial.current){setError(message(e));setData({items:[],total:0});}}finally{if(alive.current&&ticket===serial.current)setLoading(false);}},160);
  return()=>clearTimeout(timer);
 },[api,filters,offset,refresh]);
 const close=()=>{actions.current++;setEditor(undefined);setSelected(null);setRemoving(null);setActionError('');};
 const filter=(key,value)=>{setFilters(f=>({...f,[key]:value}));setOffset(0);};
 async function mutate(kind,draft){
  if(working.current)return;working.current=true;setBusy(true);setActionError('');const ticket=actions.current;
  const valid=()=>alive.current&&ticket===actions.current;
  try{
   if(kind==='remove')await api(`/entries/${removing.id}?revision=${removing.revision}`,{method:'DELETE'});
   else {const payload=Object.fromEntries(['title','note','tags','session_id','message_id'].map(k=>[k,draft[k]]));if(editor)payload.revision=editor.revision;
    const saved=await api(editor?`/entries/${editor.id}`:'/entries',{method:editor?'PUT':'POST',body:payload});
    if(!valid())return;await api(`/entries/${saved.id}`);
   }
   if(!valid())return;close();setNotice(kind==='remove'?'Bookmark removed. The conversation was not changed.':'Bookmark saved.');setRefresh(n=>n+1);setOffset(0);
  }catch(e){if(valid())setActionError(message(e));}finally{working.current=false;if(alive.current)setBusy(false);}
 }
 async function detail(item){
  if(working.current)return;close();const ticket=actions.current;setSelected(item);setBusy(true);working.current=true;
  try{const value=await api(`/entries/${item.id}`);if(alive.current&&ticket===actions.current)setSelected(value);}catch(e){if(alive.current&&ticket===actions.current)setActionError(message(e));}finally{working.current=false;if(alive.current)setBusy(false);}
 }
 async function copy(text){const ticket=actions.current;try{await api.copyText(text);if(alive.current&&ticket===actions.current)setNotice('Session ID copied.');}catch{if(alive.current&&ticket===actions.current)setActionError('Copy unavailable. Select the session ID and copy it manually.');}}
 async function open(){
  if(working.current)return;working.current=true;setBusy(true);setActionError('');const ticket=actions.current;
  try{const value=await api(`/entries/${selected.id}`);if(!alive.current||ticket!==actions.current)return;setSelected(value);if(value.source_status!=='available')throw new Error('Source is unavailable. Your bookmark is still saved.');await api.openSession(value.session_id);}catch(e){if(alive.current&&ticket===actions.current)setActionError(message(e));}finally{working.current=false;if(alive.current)setBusy(false);}
 }
 const hasFilters=Boolean(filters.q||filters.tag);
 return <section ref={focus.ref} onClickCapture={focus.capture} className="cb cb-bookmarks"><style>{styles}</style>
 <header className="cb-header"><div><p className="cb-muted">{status?.profile||'Your profile'}</p><h2>Bookmarks</h2><p className="cb-subtitle">Saved conversations and responses.</p></div><Button data-dialog-trigger data-collection-fallback variant="default" disabled={!status||busy} onClick={()=>{close();setEditor(null);}}>Save bookmark</Button></header>
 <section aria-label="Filter bookmarks" className="cb-filters"><Field className="cb-search">Search<SearchField aria-label="Search bookmarks" placeholder="Find a title, note or tag…" value={filters.q} onChange={value=>filter('q',value.slice(0,200))}/></Field><Field>Tag<Input maxLength={40} placeholder="Exact tag" value={filters.tag} onChange={e=>filter('tag',e.target.value)}/></Field><Field>Sort<Choice value={filters.sort} onChange={e=>filter('sort',e.target.value)}><option value="newest">Newest saved</option><option value="oldest">Oldest saved</option><option value="title">Title A–Z</option></Choice></Field></section>
 <div className="cb-toolbar"><span aria-live="polite">{loading?'Loading bookmarks…':`${data.total} ${data.total===1?'bookmark':'bookmarks'}`}</span><div><Button onClick={()=>{setFilters(initialFilters());setOffset(0);}}>Clear filters</Button><Button onClick={()=>setRefresh(n=>n+1)}>Refresh</Button></div></div>
 {notice&&<p className="cb-notice" role="status">{notice}</p>}
 {error?<ErrorState title="Could not load bookmarks" description={error}><Button onClick={()=>setRefresh(n=>n+1)}>Try again</Button></ErrorState>:loading?<Loader label="Loading bookmarks"/>:!data.items.length?<section className="cb-empty"><EmptyState title={hasFilters?'No matching bookmarks':'Keep your place'} description={hasFilters?'Try another search or clear your filters.':'Save a conversation or assistant response. Nothing is captured automatically.'}/>{!hasFilters&&<Button data-dialog-trigger variant="default" onClick={()=>setEditor(null)}>Save your first bookmark</Button>}</section>:<section className="cb-grid" aria-label="Bookmarks">{data.items.map(item=><article className="cb-card" key={item.id}><div className="cb-card-top"><span className="cb-kind">{item.message_id?'Response':'Conversation'}</span><span className="cb-muted">{sourceLabel(item.source_status)}</span></div><h2><Button data-dialog-trigger className="cb-card-title" variant="text" disabled={busy} onClick={()=>detail(item)}><span>{item.title}</span></Button></h2><p className="cb-description">{item.note||'No note added. A place to return to.'}</p><div className="cb-tags">{item.tags.map(t=><Button variant="chip" key={t} onClick={()=>filter('tag',t)} aria-label={`Filter tag ${t}`}>#{t}</Button>)}</div><footer><time dateTime={new Date(item.created*1000).toISOString()}>{new Date(item.created*1000).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</time></footer></article>)}</section>}
 {!loading&&data.total>30&&<nav className="cb-pagination" aria-label="Bookmark pages"><Button disabled={!offset} onClick={()=>setOffset(n=>Math.max(0,n-30))}>Previous</Button><span>{offset+1}–{Math.min(offset+30,data.total)} of {data.total}</span><Button disabled={offset+30>=data.total} onClick={()=>setOffset(n=>n+30)}>Next</Button></nav>}
 <p className="cb-footnote">Only what you save. Local to this profile. A reference, not a transcript backup.</p>
 {editor!==undefined&&<Editor restoreFocus={focus.restore} api={api} entry={editor} busy={busy} error={actionError} save={draft=>mutate('save',draft)} close={close}/>}
 {selected&&<Dialog restoreFocus={focus.restore} busy={busy} title={selected.title} close={()=>{if(!busy)close();}}><p className="cb-kind">{sourceLabel(selected.source_status)}</p><p className="cb-detail-description">{selected.note||'No note added.'}</p><p>{selected.tags.map(t=>'#'+t).join(' · ')}</p><div className="cb-file"><Field title="Session ID"><Input readOnly value={selected.session_id} onFocus={e=>e.target.select()}/></Field>{selected.message_id!=null&&<p>Message ID: <code>{selected.message_id}</code> · Opening resumes the conversation, not an exact response.</p>}<div className="cb-actions"><Button disabled={busy} onClick={()=>copy(selected.session_id)}>Copy session ID</Button>{api.openSession&&<Button disabled={busy||selected.source_status!=='available'} onClick={open}>Open conversation</Button>}</div><Field title="Resume in this profile"><Input readOnly value={`hermes${status?.profile&&status.profile!=='default'?` --profile '${status.profile.replaceAll("'","'\\''")}'`:''} --resume '${selected.session_id}'`} onFocus={e=>e.target.select()}/></Field><small>Run on the same Hermes host. Missing sources cannot be reopened.</small></div>{selected.source_status!=='available'&&<p className="cb-muted">The source may have been pruned or removed. Your title, note and tags are still here.</p>}{busy&&<p role="status">Working…</p>}{actionError&&<ErrorState title="Action failed" description={actionError}/>}<div className="cb-actions"><Button disabled={busy} onClick={()=>{const item=selected;close();setEditor(item);}}>Edit bookmark</Button><Button variant="destructive" disabled={busy} onClick={()=>{const item=selected;close();setRemoving(item);}}>Remove bookmark</Button></div></Dialog>}
 {removing&&<Dialog restoreFocus={focus.restore} busy={busy} title="Remove this bookmark?" close={()=>{if(!busy)close();}}><p><strong>{removing.title}</strong> will be removed from your bookmarks.</p><p>Only the bookmark is removed. The original conversation and messages are not changed.</p>{actionError&&<ErrorState title="Action failed" description={actionError}/>}<div className="cb-actions"><Button data-initial-focus disabled={busy} onClick={close}>Keep bookmark</Button><Button variant="destructive" disabled={busy} onClick={()=>mutate('remove')}>{busy?'Removing…':'Remove metadata'}</Button></div></Dialog>}
 </section>;
}
