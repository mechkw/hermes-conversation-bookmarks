import React,{useEffect,useState,useId} from 'react';
import {Button,Input,Textarea,SearchField,Choice,Field,Dialog,DialogFooter,EmptyState,ErrorState,Loader} from '@saved/presentation';
const conversationTitle=item=>!item.title||item.title===`${item.source||'Conversation'} · ${item.id}`?'Untitled conversation':item.title;
const date=value=>value==null?'Date unavailable':new Date(value*1000).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
function useSources(api,path){
 const [query,setQuery]=useState(''),[offset,setOffset]=useState(0),[retry,setRetry]=useState(0),[result,setResult]=useState(null);
 const key=JSON.stringify([path,query,offset,retry]);
 useEffect(()=>{
  let active=true;
  if(!path)return;
  const timer=setTimeout(async()=>{
   try{const data=await api(path+'?'+new URLSearchParams({limit:'30',offset:String(offset),q:query}));if(active)setResult({key,data});}
   catch(error){if(active)setResult({key,error:error?.message||'Could not load choices.'});}
  },180);
  return()=>{active=false;clearTimeout(timer);};
 },[api,key,path,query,offset]);
 const current=result?.key===key?result:null;
 return {query,search:value=>{setQuery(value.slice(0,200));setOffset(0);},offset,previous:()=>setOffset(n=>Math.max(0,n-30)),next:()=>setOffset(n=>n+30),retry:()=>setRetry(n=>n+1),loading:Boolean(path&&!current),error:current?.error,data:current?.data};
}
function SourcePicker({api,path,label,value,onChange,selected,optional=false,disabled=false}){
 const id=useId(),list=useSources(api,path),items=list.data?.items||[];
 const options=items.map(item=>({value:String(item.id),label:optional?`${item.preview||'Assistant response'} · ${date(item.created_at)}`:`${conversationTitle(item)} · ${date(item.updated_at)}`}));
 // A missing result is not a deleted reference: it may simply be outside this
 // page or search. Keep the saved value until the user explicitly replaces it.
 if(value&&!options.some(o=>o.value===String(value)))options.unshift({value:String(value),label:selected||`Saved ${optional?'response':'conversation'} (not in these results)`});
 options.unshift({value:'',label:optional?'Entire conversation':'Choose a conversation',disabled:!optional});
 return <section className="hs-source-picker" aria-label={label+' choices'}>
  <label htmlFor={id}>{label}</label><Choice id={id} aria-label={label} disabled={disabled||!path} value={value==null?'':String(value)} options={options} onValueChange={v=>{const item=items.find(i=>String(i.id)===v);onChange(v,item,options.find(o=>o.value===v)?.label);}}/>
  {path&&<>
   <SearchField aria-label={'Search '+(optional?'responses':'conversations')} placeholder={optional?'Find an assistant response…':'Find a conversation…'} value={list.query} onChange={list.search} onKeyDown={event=>{if(event.key==='Enter')event.preventDefault();}}/>
   {list.loading?<Loader label={'Loading '+(optional?'responses':'conversations')}/>:list.error?<ErrorState title="Could not load choices" description={list.error}><Button onClick={list.retry}>Retry {optional?'responses':'conversations'}</Button></ErrorState>:!items.length?<EmptyState title={list.query?'No matches':optional?'No assistant responses':'No conversations'} description={optional?'You can keep the entire conversation, or keep an existing saved response.':'Try another search. Existing saved references are kept.'}/>:null}
   {!list.loading&&!list.error&&list.data?.window&&<p className="hs-muted" role="status">{list.data.window.truncated?`Search covers the most recent ${list.data.window.limit} ${optional?'assistant responses':'conversations'}. Older ${optional?'assistant responses':'conversations'} are not included.`:`Search covers up to ${list.data.window.limit} recent ${optional?'assistant responses':'conversations'}. All available ${optional?'assistant responses':'conversations'} are included.`}</p>}
   <nav className="hs-source-pages" aria-label={label+' pages'}><Button disabled={disabled||list.loading||!list.offset} onClick={list.previous}>Previous {optional?'responses':'conversations'}</Button><Button disabled={disabled||list.loading||!list.data?.has_more} onClick={list.next}>Next {optional?'responses':'conversations'}</Button></nav>
  </>}
 </section>;
}
export function BookmarkEditor({api,entry,busy,error,save,close,restoreFocus}){
 const [draft,setDraft]=useState(()=>entry?{...entry}:{title:'',note:'',tags:[],session_id:'',message_id:null});
 const [tags,setTags]=useState((entry?.tags||[]).join('\n'));
 const [conversationLabel,setConversationLabel]=useState(''),[responseLabel,setResponseLabel]=useState('');
 const change=(k,v)=>setDraft(d=>({...d,[k]:v}));
 return <Dialog restoreFocus={restoreFocus} title={entry?'Edit bookmark':'Save a bookmark'} description="Choose a conversation and, optionally, one assistant response. Notes are yours; no transcript is copied." busy={busy} close={close}>
  <form onSubmit={e=>{e.preventDefault();if(!busy&&draft.session_id&&draft.title.trim())save({...draft,tags:tags.split('\n').map(t=>t.trim()).filter(Boolean)});}}>
   <fieldset disabled={busy} className="hs-form-fields">
    <SourcePicker api={api} path="/sources/sessions" label="Conversation" value={draft.session_id} selected={conversationLabel} disabled={busy} onChange={(value,item,label)=>{if(value===draft.session_id)return;setDraft(d=>({...d,session_id:value,message_id:null,title:d.title.trim()?d.title:(item?conversationTitle(item):'')}));setConversationLabel(label||'');setResponseLabel('');}}/>
    <SourcePicker key={draft.session_id} api={api} path={draft.session_id?`/sources/sessions/${encodeURIComponent(draft.session_id)}/responses`:null} label="Response (optional)" value={draft.message_id} selected={responseLabel} optional disabled={busy} onChange={(value,item,label)=>{change('message_id',value===''?null:Number(value));setResponseLabel(label||'');}}/>
    <Field title="Title"><Input required maxLength={160} value={draft.title} onChange={e=>change('title',e.target.value)}/></Field>
    <Field title="Note" description="Optional · written by you"><Textarea rows={4} maxLength={4000} value={draft.note} onChange={e=>change('note',e.target.value)}/></Field>
    <Field title="Tags" description="One per line · commas stay within a tag"><Textarea rows={3} maxLength={820} value={tags} onChange={e=>setTags(e.target.value)}/></Field>
   </fieldset>
   {entry&&entry.source_status!=='available'&&<p className="hs-muted">The saved source may be unavailable. Keeping these choices preserves its reference when you edit the title, note or tags.</p>}
   {error&&<ErrorState title="Could not save bookmark" description={error}/>}
   <DialogFooter><Button disabled={busy} onClick={close}>Cancel</Button><Button variant="default" type="submit" loading={busy} disabled={busy||!draft.session_id||!draft.title.trim()}>{entry?'Save changes':'Save bookmark'}</Button></DialogFooter>
  </form>
 </Dialog>;
}
