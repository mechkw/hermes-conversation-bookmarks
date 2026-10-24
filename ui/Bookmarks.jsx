import React, {useEffect,useRef,useState,useId} from 'react';
import styles from './style.css';
const initialFilters=()=>({q:'',tag:'',sort:'newest'});
const fresh=()=>({title:'',note:'',tags:[],session_id:'',message_id:null});
const message=e=>e?.message||'The request failed. Refresh and try again.';
const sourceLabel=s=>({available:'Source available',session_missing:'Session unavailable',message_missing:'Message unavailable',store_missing:'Session store unavailable',unavailable:'Source check unavailable'}[s]||'Source unavailable');
function Dialog({title,children,close}){
 const ref=useRef(),id=useId();
 useEffect(()=>{const node=ref.current;node.showModal();node.querySelector('[data-initial-focus]')?.focus();return()=>node.close();},[]);
 return <dialog ref={ref} className="cb cb-dialog" aria-labelledby={id} onCancel={e=>{e.preventDefault();close();}}><div className="cb-dialog-head"><h2 id={id}>{title}</h2><button aria-label="Close dialog" onClick={close}>×</button></div>{children}</dialog>;
}
function Editor({entry,busy,error,save,close}){
 const [draft,setDraft]=useState(entry||fresh()),[tags,setTags]=useState((entry?.tags||[]).join('\n')),[mid,setMid]=useState(entry?.message_id==null?'':String(entry.message_id));
 const change=(k,v)=>setDraft(d=>({...d,[k]:v}));
 return <Dialog title={entry?'Edit bookmark':'Save a bookmark'} close={()=>{if(!busy)close();}}><form onSubmit={e=>{e.preventDefault();save({...draft,tags:tags.split('\n').map(t=>t.trim()).filter(Boolean),message_id:mid===''?null:Number(mid)});}}>
 <p className="cb-muted">Keep a reference and your own note. No transcript is copied.</p>
 <label>Title<input data-initial-focus required maxLength={160} value={draft.title} onChange={e=>change('title',e.target.value)}/></label>
 <label>Note <span className="cb-muted">optional · written by you</span><textarea rows={4} maxLength={4000} value={draft.note} onChange={e=>change('note',e.target.value)}/></label>
 <label>Session ID<input required maxLength={160} pattern="[A-Za-z0-9_.:\-]+" value={draft.session_id} onChange={e=>change('session_id',e.target.value)} placeholder="Exact stored session ID"/></label>
 <label>Message ID <span className="cb-muted">optional · native numeric ID, not a platform message ID</span><input inputMode="numeric" pattern="[1-9][0-9]*" maxLength={15} value={mid} onChange={e=>setMid(e.target.value)}/></label>
 <label>Tags <span className="cb-muted">one per line · commas stay within a tag</span><textarea rows={3} maxLength={820} value={tags} onChange={e=>setTags(e.target.value)}/></label>
 {entry?.source_status!=='available'&&entry&&<p className="cb-muted">This source is unavailable. You can still edit its note or remove the bookmark.</p>}
 {error&&<p className="cb-error" role="alert">{error}</p>}<div className="cb-actions"><button type="button" disabled={busy} onClick={close}>Cancel</button><button type="submit" disabled={busy} className="cb-primary">{busy?'Saving…':entry?'Save changes':'Save bookmark'}</button></div>
 </form></Dialog>;
}
export function Bookmarks({api,embedded=false}){
 const [status,setStatus]=useState(null),[data,setData]=useState({items:[],total:0}),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [filters,setFilters]=useState(initialFilters),[offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0);
 const [editor,setEditor]=useState(undefined),[selected,setSelected]=useState(null),[removing,setRemoving]=useState(null),[busy,setBusy]=useState(false),[actionError,setActionError]=useState(''),[notice,setNotice]=useState('');
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
 return <section className="cb cb-bookmarks"><style>{styles}</style>
 <header className="cb-header"><div><p className="cb-eyebrow">SAVED MOMENTS <span>/ {status?.profile||'your profile'}</span></p>{embedded?<h2>Bookmarks</h2>:<h1>Conversation<br className="cb-title-break"/> Bookmarks<span aria-hidden="true">.</span></h1>}<p className="cb-subtitle">A way back to the part that mattered.</p></div><button className="cb-primary" disabled={!status||busy} onClick={()=>{close();setEditor(null);}}>＋ Save bookmark</button></header>
 <section aria-label="Filter bookmarks" className="cb-filters"><label className="cb-search">Search<input type="search" maxLength={200} placeholder="Find a title, note or tag…" value={filters.q} onChange={e=>filter('q',e.target.value)}/></label><label>Tag<input maxLength={40} placeholder="Exact tag" value={filters.tag} onChange={e=>filter('tag',e.target.value)}/></label><label>Sort<select value={filters.sort} onChange={e=>filter('sort',e.target.value)}><option value="newest">Newest saved</option><option value="oldest">Oldest saved</option><option value="title">Title A–Z</option></select></label></section>
 <div className="cb-toolbar"><span aria-live="polite">{loading?'Loading bookmarks…':`${data.total} ${data.total===1?'bookmark':'bookmarks'}`}</span><div><button onClick={()=>{setFilters(initialFilters());setOffset(0);}}>Clear filters</button><button onClick={()=>setRefresh(n=>n+1)}>Refresh</button></div></div>
 {notice&&<p className="cb-notice" role="status">{notice}</p>}
 {error?<section className="cb-empty" role="alert"><h2>Could not load bookmarks</h2><p>{error}</p><button onClick={()=>setRefresh(n=>n+1)}>Try again</button></section>:loading?<section className="cb-empty" role="status"><div className="cb-loader" aria-hidden="true"/><p>Finding your saved moments…</p></section>:!data.items.length?<section className="cb-empty"><span className="cb-mark" aria-hidden="true">▱</span><h2>{hasFilters?'No matching bookmarks':'Keep your place'}</h2><p>{hasFilters?'Try another search or clear your filters.':'Save a useful decision, a good explanation, or a thread to return to. Nothing is captured automatically.'}</p>{!hasFilters&&<button className="cb-primary" onClick={()=>setEditor(null)}>Save your first bookmark</button>}</section>:<section className="cb-grid" aria-label="Bookmarks">{data.items.map(item=><article className="cb-card" key={item.id}><div className="cb-card-top"><span className="cb-kind">{item.message_id?'MESSAGE':'CONVERSATION'}</span><span className="cb-muted">{sourceLabel(item.source_status)}</span></div><h2><button disabled={busy} onClick={()=>detail(item)}>{item.title}</button></h2><p className="cb-description">{item.note||'No note added. A place to return to.'}</p><div className="cb-tags">{item.tags.map(t=><button key={t} onClick={()=>filter('tag',t)} aria-label={`Filter tag ${t}`}>#{t}</button>)}</div><footer><span className="cb-session" title={item.session_id}>{item.session_id}</span><time dateTime={new Date(item.created*1000).toISOString()}>{new Date(item.created*1000).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</time></footer></article>)}</section>}
 {!loading&&data.total>30&&<nav className="cb-pagination" aria-label="Bookmark pages"><button disabled={!offset} onClick={()=>setOffset(n=>Math.max(0,n-30))}>Previous</button><span>{offset+1}–{Math.min(offset+30,data.total)} of {data.total}</span><button disabled={offset+30>=data.total} onClick={()=>setOffset(n=>n+30)}>Next</button></nav>}
 <p className="cb-footnote">Only what you save. Local to this profile. A reference, not a transcript backup.</p>
 {editor!==undefined&&<Editor entry={editor} busy={busy} error={actionError} save={draft=>mutate('save',draft)} close={close}/>}
 {selected&&<Dialog title={selected.title} close={()=>{if(!busy)close();}}><p className="cb-kind">{sourceLabel(selected.source_status)}</p><p className="cb-detail-description">{selected.note||'No note added.'}</p><p>{selected.tags.map(t=>'#'+t).join(' · ')}</p><div className="cb-file"><label>Session ID<input readOnly value={selected.session_id} onFocus={e=>e.target.select()}/></label>{selected.message_id&&<p>Message ID: <code>{selected.message_id}</code> · Opening resumes the session, not an exact message.</p>}<div className="cb-actions"><button disabled={busy} onClick={()=>copy(selected.session_id)}>Copy session ID</button>{api.openSession&&<button disabled={busy||selected.source_status!=='available'} onClick={open}>Open conversation</button>}</div><label>Resume in this profile<input readOnly value={`hermes${status?.profile&&status.profile!=='default'?` --profile '${status.profile.replaceAll("'","'\\''")}'`:''} --resume '${selected.session_id}'`} onFocus={e=>e.target.select()}/></label><small>Run on the same Hermes host. Missing sources cannot be reopened.</small></div>{selected.source_status!=='available'&&<p className="cb-muted">The source may have been pruned or removed. Your title, note and tags are still here.</p>}{busy&&<p role="status">Working…</p>}{actionError&&<p role="alert" className="cb-error">{actionError}</p>}<div className="cb-actions"><button disabled={busy} onClick={()=>{const item=selected;close();setEditor(item);}}>Edit bookmark</button><button className="cb-danger" disabled={busy} onClick={()=>{const item=selected;close();setRemoving(item);}}>Remove bookmark</button></div></Dialog>}
 {removing&&<Dialog title="Remove this bookmark?" close={()=>{if(!busy)close();}}><p><strong>{removing.title}</strong> will be removed from your bookmarks.</p><p>Only the bookmark is removed. The original conversation and messages are not changed.</p>{actionError&&<p role="alert" className="cb-error">{actionError}</p>}<div className="cb-actions"><button data-initial-focus disabled={busy} onClick={close}>Keep bookmark</button><button className="cb-danger" disabled={busy} onClick={()=>mutate('remove')}>{busy?'Removing…':'Remove metadata'}</button></div></Dialog>}
 </section>;
}
