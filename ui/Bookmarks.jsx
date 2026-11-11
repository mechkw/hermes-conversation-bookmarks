import React,{useEffect,useRef,useState} from 'react';
import styles from './style.css';
import {useCollectionFocus} from './collection-focus.js';
import {Button,Input,SearchField,Choice,Field,Dialog,EmptyState,ErrorState,Loader,Checkbox,IconButton} from '@saved/presentation';
import {BookmarkEditor as Editor} from './BookmarkEditor.jsx';
import {BookmarkSettings} from './BookmarkSettings.jsx';
const initialFilters=()=>({q:'',tag:'',sort:'newest'});
const message=e=>e?.message||'The request failed. Refresh and try again.';
const sourceLabel=s=>({available:'Source available',session_missing:'Session unavailable',message_missing:'Message unavailable',store_missing:'Session store unavailable',unavailable:'Source check unavailable'}[s]||'Source unavailable');
export function Bookmarks({api,embedded=false,initialAdd=false}){
 const [status,setStatus]=useState(null),[data,setData]=useState({items:[],total:0}),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [filters,setFilters]=useState(initialFilters),[offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0);
 const [editor,setEditor]=useState(initialAdd?null:undefined),[selected,setSelected]=useState(null),[removing,setRemoving]=useState(null),[busy,setBusy]=useState(false),[actionError,setActionError]=useState(''),[notice,setNotice]=useState('');
 const [checked,setChecked]=useState({}),[settings,setSettings]=useState({show_notes:true,show_source_status:true}),[showSettings,setShowSettings]=useState(false);
 const focus=useCollectionFocus(editor!==undefined||Boolean(removing)||showSettings);
 const alive=useRef(false),serial=useRef(0),actions=useRef(0),working=useRef(false),inspector=useRef(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;serial.current++;actions.current++;};},[]);
 useEffect(()=>{let active=true;api('/settings').then(value=>{if(active)setSettings(value);}).catch(()=>{});return()=>{active=false;};},[api,showSettings]);
 useEffect(()=>{
  const ticket=++serial.current;setLoading(true);setError('');
  const timer=setTimeout(async()=>{try{const [s,d]=await Promise.all([api('/status'),api('/entries?'+new URLSearchParams({...filters,offset:String(offset),limit:'30'}))]);if(alive.current&&ticket===serial.current){setStatus(s);setData(d);}}catch(e){if(alive.current&&ticket===serial.current){setError(message(e));setData({items:[],total:0});}}finally{if(alive.current&&ticket===serial.current)setLoading(false);}},160);
  return()=>clearTimeout(timer);
 },[api,filters,offset,refresh]);
 const close=()=>{actions.current++;setEditor(undefined);setSelected(null);setRemoving(null);setShowSettings(false);setActionError('');};
 const filter=(key,value)=>{close();setChecked({});setFilters(f=>({...f,[key]:value}));setOffset(0);};
 const reload=()=>{close();setChecked({});setRefresh(n=>n+1);};
 async function mutate(kind,draft){
  if(working.current)return;working.current=true;setBusy(true);setActionError('');const ticket=actions.current;
  const valid=()=>alive.current&&ticket===actions.current;
  try{
   if(kind==='remove'){
    if(removing.length===1)await api(`/entries/${removing[0].id}?revision=${removing[0].revision}`,{method:'DELETE'});
    else await api('/entries/remove',{method:'POST',body:{entries:removing.map(({id,revision})=>({id,revision}))}});
   }else{
    const payload=Object.fromEntries(['title','note','tags','session_id','message_id'].map(k=>[k,draft[k]]));if(editor)payload.revision=editor.revision;
    const saved=await api(editor?`/entries/${editor.id}`:'/entries',{method:editor?'PUT':'POST',body:payload});
    if(!valid())return;await api(`/entries/${saved.id}`);
   }
   if(!valid())return;const count=removing?.length;close();setChecked({});setNotice(kind==='remove'?`${count===1?'Bookmark':count+' bookmarks'} removed. The conversations were not changed.`:'Bookmark saved.');setRefresh(n=>n+1);setOffset(0);
  }catch(e){if(valid())setActionError(message(e));}finally{working.current=false;if(alive.current)setBusy(false);}
 }
 async function detail(item){
  if(working.current)return;close();const ticket=actions.current;setSelected(item);setBusy(true);working.current=true;
  try{const value=await api(`/entries/${item.id}`);if(alive.current&&ticket===actions.current){setSelected(value);inspector.current?.focus();}}catch(e){if(alive.current&&ticket===actions.current)setActionError(message(e));}finally{working.current=false;if(alive.current)setBusy(false);}
 }
 async function copy(text){const ticket=actions.current;try{await api.copyText(text);if(alive.current&&ticket===actions.current)setNotice('Session ID copied.');}catch{if(alive.current&&ticket===actions.current)setActionError('Copy unavailable. Select the session ID and copy it manually.');}}
 async function open(){
  if(working.current)return;working.current=true;setBusy(true);setActionError('');const ticket=actions.current;
  try{const value=await api(`/entries/${selected.id}`);if(!alive.current||ticket!==actions.current)return;setSelected(value);if(value.source_status!=='available')throw new Error('Source is unavailable. Your bookmark is still saved.');await api.openSession(value.session_id);}catch(e){if(alive.current&&ticket===actions.current)setActionError(message(e));}finally{working.current=false;if(alive.current)setBusy(false);}
 }
 const hasFilters=Boolean(filters.q||filters.tag),chosen=Object.values(checked);
 const toggle=(item,value)=>setChecked(old=>{const next={...old};if(value)next[item.id]=item;else delete next[item.id];return next;});
 const closePreview=()=>{close();focus.restore({preventDefault(){}});};
 return <section ref={focus.ref} onClickCapture={focus.capture} className="cb cb-bookmarks">
 <style>{styles}</style>
 <header className="cb-header"><div><p className="cb-muted">{status?.profile||'Your profile'}</p><h2>Bookmarks</h2><p className="cb-subtitle">Saved conversations and responses.</p></div><div className="cb-actions"><IconButton icon="settings-gear" label="Bookmark settings" disabled={busy} onClick={()=>setShowSettings(true)}/><Button data-dialog-trigger data-collection-fallback variant="default" disabled={!status||busy} onClick={()=>{close();setEditor(null);}}>Save bookmark</Button></div></header>
 <section aria-label="Filter bookmarks" className="cb-filters"><Field className="cb-search">Search<SearchField aria-label="Search bookmarks" placeholder="Find a title, note or tag…" value={filters.q} onChange={value=>filter('q',value.slice(0,200))}/></Field><Field>Tag<Input maxLength={40} placeholder="Exact tag" value={filters.tag} onChange={e=>filter('tag',e.target.value)}/></Field><Field>Sort<Choice value={filters.sort} onChange={e=>filter('sort',e.target.value)}><option value="newest">Newest saved</option><option value="oldest">Oldest saved</option><option value="title">Title A–Z</option></Choice></Field></section>
 <div className="cb-toolbar"><span aria-live="polite">{loading?'Loading bookmarks…':`${data.total} ${data.total===1?'bookmark':'bookmarks'}`}</span><div><IconButton icon="clear-all" label="Clear filters" disabled={busy} onClick={()=>{close();setChecked({});setFilters(initialFilters());setOffset(0);}}/><IconButton icon="refresh" label="Refresh" disabled={busy} onClick={reload}/></div></div>
 {notice&&<p className="cb-notice" role="status">{notice}</p>}
 {!loading&&data.items.length>0&&<div className="cb-toolbar" aria-label="Bookmark selection"><label className="cb-selection"><Checkbox aria-label="Select all bookmarks on this page" disabled={busy||data.items.some(item=>!checked[item.id])&&new Set([...Object.keys(checked),...data.items.map(item=>item.id)]).size>100} checked={data.items.every(item=>Boolean(checked[item.id]))} onCheckedChange={value=>setChecked(old=>{const next={...old};for(const item of data.items){if(value)next[item.id]=item;else delete next[item.id];}return next;})}/>Select page ({data.items.length} bookmarks)</label><div><span role="status">{chosen.length} bookmarks selected across pages</span><small>Up to 100 at a time</small><Button disabled={busy||!chosen.length} onClick={()=>setChecked({})}>Clear selection</Button><Button variant="destructive" disabled={busy||!chosen.length} onClick={()=>{setActionError('');setRemoving(chosen);}}>Remove selected bookmarks</Button></div></div>}
 <div className="cb-browser">
 <div className="cb-results">
 {error?<ErrorState title="Could not load bookmarks" description={error}><Button onClick={reload}>Try again</Button></ErrorState>:loading?<Loader label="Loading bookmarks"/>:!data.items.length?<section className="cb-empty"><EmptyState title={hasFilters?'No matching bookmarks':'Keep your place'} description={hasFilters?'Try another search or clear your filters.':'Save a conversation or assistant response. Nothing is captured automatically.'}/>{!hasFilters&&<Button data-dialog-trigger variant="default" onClick={()=>setEditor(null)}>Save your first bookmark</Button>}</section>:<section className="cb-list" aria-label="Bookmarks">{data.items.map(item=><article className="cb-card cb-row" data-inspected={selected?.id===item.id||undefined} key={item.id}>
 <Checkbox aria-label={`Select bookmark ${item.title}`} checked={Boolean(checked[item.id])} disabled={busy||chosen.length>=100&&!checked[item.id]} onCheckedChange={value=>toggle(item,value===true)}/>
 <div className="cb-row-body"><div className="cb-card-top"><span className="cb-kind">{item.message_id?'Response':'Conversation'}</span>{settings.show_source_status&&<span className="cb-muted">{sourceLabel(item.source_status)}</span>}</div><h2><Button data-dialog-trigger className="cb-card-title" variant="text" disabled={busy} aria-pressed={selected?.id===item.id} onClick={()=>detail(item)}><span>{item.title}</span></Button></h2>{settings.show_notes&&item.note&&<p className="cb-description">{item.note}</p>}<div className="cb-tags">{item.tags.map(t=><Button variant="chip" key={t} onClick={()=>filter('tag',t)} aria-label={`Filter tag ${t}`}>#{t}</Button>)}</div><footer><time dateTime={new Date(item.created*1000).toISOString()}>{new Date(item.created*1000).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</time></footer></div>
 </article>)}</section>}
 {!loading&&data.total>30&&<nav className="cb-pagination" aria-label="Bookmark pages"><Button disabled={busy||!offset} onClick={()=>setOffset(n=>Math.max(0,n-30))}>Previous</Button><span>{offset+1}–{Math.min(offset+30,data.total)} of {data.total}</span><Button disabled={busy||offset+30>=data.total} onClick={()=>setOffset(n=>n+30)}>Next</Button></nav>}
 </div>
 <aside ref={inspector} tabIndex={-1} className="cb-inspector" aria-label="Bookmark details" onKeyDown={e=>{if(e.key==='Escape'&&!busy){e.preventDefault();closePreview();}}}>
 {selected?<><header className="cb-header"><h3>{selected.title}</h3><IconButton icon="close" label="Close preview" disabled={busy} onClick={closePreview}/></header><p className="cb-kind">{sourceLabel(selected.source_status)}</p><p className="cb-detail-description">{selected.note||'No note added.'}</p><p>{selected.tags.map(t=>'#'+t).join(' · ')}</p><div className="cb-file"><Field title="Session ID"><Input readOnly value={selected.session_id} onFocus={e=>e.target.select()}/></Field>{selected.message_id!=null&&<p>Message ID: <code>{selected.message_id}</code> · Opening resumes the conversation, not an exact response.</p>}<div className="cb-actions"><IconButton icon="copy" label="Copy session ID" disabled={busy} onClick={()=>copy(selected.session_id)}/>{api.openSession&&<Button disabled={busy||selected.source_status!=='available'} onClick={open}>Open conversation</Button>}</div><Field title="Resume in this profile"><Input readOnly value={`hermes${status?.profile&&status.profile!=='default'?` --profile '${status.profile.replaceAll("'","'\\''")}'`:''} --resume '${selected.session_id}'`} onFocus={e=>e.target.select()}/></Field><small>Run on the same Hermes host. Missing sources cannot be reopened.</small></div>{selected.source_status!=='available'&&<p className="cb-muted">The source may have been pruned or removed. Your title, note and tags are still here.</p>}{busy&&<p role="status">Working…</p>}{actionError&&<ErrorState title="Action failed" description={actionError}/>}<div className="cb-actions"><Button disabled={busy} onClick={()=>{const item=selected;close();setEditor(item);}}>Edit bookmark</Button><Button variant="destructive" disabled={busy} onClick={()=>{setActionError('');setRemoving([selected]);}}>Remove bookmark</Button></div></>:<EmptyState title="Preview a bookmark" description="Choose a title to inspect its note and source reference. Checkboxes select bookmarks for removal, not preview."/>}
 </aside></div>
 <p className="cb-footnote">Only what you save. Local to this profile. A reference, not a transcript backup.</p>
 {editor!==undefined&&<Editor restoreFocus={focus.restore} api={api} entry={editor} busy={busy} error={actionError} save={draft=>mutate('save',draft)} close={close}/>}
 {showSettings&&<Dialog title="Bookmark settings" close={()=>setShowSettings(false)} restoreFocus={focus.restore}><BookmarkSettings api={api}/></Dialog>}
 {removing&&<Dialog restoreFocus={focus.restore} busy={busy} title={removing.length===1?'Remove this bookmark?':`Remove ${removing.length} selected bookmarks?`} close={()=>{if(!busy){setRemoving(null);setActionError('');}}}><p>{removing.length===1?<strong>{removing[0].title}</strong>:`${removing.length} explicitly selected bookmarks across pages`} will be removed from your bookmarks.</p><p>Only bookmark metadata is removed. The original conversations and messages are not changed.</p>{actionError&&<ErrorState title="Action failed" description={actionError}/>}<div className="cb-actions"><Button data-initial-focus disabled={busy} onClick={()=>{setRemoving(null);setActionError('');}}>Keep bookmark{removing.length===1?'':'s'}</Button><Button variant="destructive" disabled={busy} onClick={()=>mutate('remove')}>{busy?'Removing…':'Remove metadata'}</Button></div></Dialog>}
 </section>;
}
