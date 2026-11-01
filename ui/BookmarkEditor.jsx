import React,{useEffect,useState,useId,useRef} from 'react';
import {Button,Input,Textarea,SearchField,Choice,Field,Dialog,DialogFooter,EmptyState,ErrorState,Loader,Hint} from '@saved/presentation';
const CONTEXT_PRESETS=['5','10','20','50'];
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
 const noun=optional?'assistant responses':'conversations',window=list.data?.window;
 const hint=window?window.truncated?`Search filter covers the most recent ${window.limit} ${noun}. Older ${noun} are not included.`:`Search filter covers up to ${window.limit} recent ${noun}. All available ${noun} are included.`:`Search filter covers up to ${optional?500:1000} recent ${noun}. ${list.error?'The search window could not be loaded.':'Loading the search window…'}`;
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
   <nav className="hs-source-pages" aria-label={label+' pages'}>{[['Previous',list.previous,disabled||list.loading||!list.offset],['Next',list.next,disabled||list.loading||!list.data?.has_more]].map(([text,action,inactive])=><Hint key={text} label={hint} disabled={inactive} name={`${text} ${optional?'responses':'conversations'}`}><Button aria-label={`${text} ${optional?'responses':'conversations'}`} disabled={inactive} onClick={action}>{text}</Button></Hint>)}</nav>
  </>}
 </section>;
}
export function BookmarkEditor({api,entry,busy,error,save,close,restoreFocus}){
 const contextId=useId();
 const [draft,setDraft]=useState(()=>entry?{...entry}:{title:'',note:'',tags:[],session_id:'',message_id:null});
 const [tags,setTags]=useState((entry?.tags||[]).join('\n'));
 const [conversationLabel,setConversationLabel]=useState(''),[responseLabel,setResponseLabel]=useState('');
 const [previous,setPrevious]=useState('10'),[settingsReady,setSettingsReady]=useState(false),[settingsBusy,setSettingsBusy]=useState(false),[settingsError,setSettingsError]=useState(''),[settingsRetry,setSettingsRetry]=useState(0);
 const [generating,setGenerating]=useState(false),[generationError,setGenerationError]=useState(''),[generationNotice,setGenerationNotice]=useState('');
 const life=useRef(0),edits=useRef(0),working=useRef(false),settingVersion=useRef(0),savedPrevious=useRef(null);
 useEffect(()=>{
  const token=++life.current;setSettingsReady(false);
  if(!entry)api('/generation/settings').then(data=>{if(token===life.current){setPrevious(CONTEXT_PRESETS.includes(String(data.previous_exchanges))?String(data.previous_exchanges):'10');savedPrevious.current=data.previous_exchanges;setSettingsReady(true);setSettingsError('');}}).catch(e=>{if(token===life.current)setSettingsError(e?.message||'Could not load generation settings.');});
  return()=>{life.current++;edits.current++;};
 },[api,entry,settingsRetry]);
 const invalidate=()=>{edits.current++;setGenerationNotice('');setGenerationError('');};
 const change=(k,v)=>{invalidate();setDraft(d=>({...d,[k]:v}));};
 const validPrevious=CONTEXT_PRESETS.includes(previous);
 async function persistPrevious(selected=previous){
  if(!settingsReady||!CONTEXT_PRESETS.includes(selected))return false;
  if(Number(selected)===savedPrevious.current){setSettingsError('');return true;}
  const token=life.current,version=++settingVersion.current,value=Number(selected);setSettingsBusy(true);setSettingsError('');
  try{const data=await api('/generation/settings',{method:'PUT',body:{previous_exchanges:value}});if(token===life.current&&version===settingVersion.current)savedPrevious.current=data.previous_exchanges;return token===life.current&&version===settingVersion.current;}
  catch(e){if(token===life.current&&version===settingVersion.current)setSettingsError(e?.message||'Could not save generation settings.');}
  finally{if(token===life.current&&version===settingVersion.current)setSettingsBusy(false);}
 }
 async function generate(){
  if(working.current||busy||!draft.message_id||!settingsReady||settingsBusy||!validPrevious||settingsError)return;
  working.current=true;setGenerating(true);setGenerationError('');setGenerationNotice('');
  const token=life.current,version=edits.current;
  const current=()=>token===life.current;
  try{
   if(!await persistPrevious()||!current()||version!==edits.current)return;
   const data=await api('/generation/draft',{method:'POST',body:{session_id:draft.session_id,message_id:draft.message_id}});
   if(!current())return;
   if(version!==edits.current){setGenerationNotice('Draft changed during generation. Your edits were kept.');return;}
   setDraft(d=>({...d,...data.draft}));setTags(data.draft.tags.join('\n'));
   setGenerationNotice(`Draft ready to review.${data.context.truncated?' Context shortened.':''}`);
  }catch(e){if(current())setGenerationError(e?.message||'Could not generate details. Retry when ready.');}
  finally{working.current=false;if(current())setGenerating(false);}
 }
 return <Dialog restoreFocus={restoreFocus} title={entry?'Edit bookmark':'Save a bookmark'} description={null} busy={busy} close={close}>
  <form onSubmit={e=>{e.preventDefault();if(!busy&&draft.session_id&&draft.title.trim()){invalidate();save({...draft,tags:tags.split('\n').map(t=>t.trim()).filter(Boolean)});}}}>
   <fieldset disabled={busy} className="hs-form-fields">
    <SourcePicker api={api} path="/sources/sessions" label="Choose a conversation" value={draft.session_id} selected={conversationLabel} disabled={busy} onChange={(value,item,label)=>{if(value===draft.session_id)return;invalidate();setDraft(d=>({...d,session_id:value,message_id:null,title:d.title.trim()?d.title:(item?conversationTitle(item):'')}));setConversationLabel(label||'');setResponseLabel('');}}/>
    <SourcePicker key={draft.session_id} api={api} path={draft.session_id?`/sources/sessions/${encodeURIComponent(draft.session_id)}/responses`:null} label="Response (optional)" value={draft.message_id} selected={responseLabel} optional disabled={busy} onChange={(value,item,label)=>{change('message_id',value===''?null:Number(value));setResponseLabel(label||'');}}/>
    {!entry&&<section aria-label="Generate bookmark details" className="hs-generation">
     <div className="hs-generation-row">
      <Button variant="default" loading={generating} disabled={busy||generating||!draft.message_id||!settingsReady||settingsBusy||!validPrevious||Boolean(settingsError)} onClick={generate}>Generate details</Button>
      <div className="hs-generation-context"><label htmlFor={contextId}>Context</label><Choice id={contextId} aria-label="Context" disabled={!settingsReady||settingsBusy||generating} value={previous} options={CONTEXT_PRESETS.map(value=>({value,label:value}))} onValueChange={value=>{invalidate();setPrevious(value);void persistPrevious(value);}}/></div>
     </div>
     {settingsBusy&&<p role="status">Saving context setting…</p>}
     {settingsError&&<ErrorState title="Could not load or save context setting" description={settingsError}><Button onClick={()=>settingsReady?persistPrevious():setSettingsRetry(n=>n+1)}>Retry context setting</Button></ErrorState>}
     {generating&&<p role="status">Generating details… You can keep editing.</p>}
     {generationError&&<ErrorState title="Could not generate details" description={generationError}/>}
     {generationNotice&&<p role="status">{generationNotice}</p>}
    </section>}
    <Field title="Title"><Input required maxLength={160} value={draft.title} onChange={e=>change('title',e.target.value)}/></Field>
    <Field title="Note" description="Optional • review or write your own"><Textarea rows={4} maxLength={4000} value={draft.note} onChange={e=>change('note',e.target.value)}/></Field>
    <Field title="Tags" description="One per line • commas stay within a tag"><Textarea rows={3} maxLength={820} value={tags} onChange={e=>{invalidate();setTags(e.target.value);}}/></Field>
   </fieldset>
   {entry&&entry.source_status!=='available'&&<p className="hs-muted">Source unavailable. Saved reference retained.</p>}
   {error&&<ErrorState title="Could not save bookmark" description={error}/>}
   <DialogFooter><Button disabled={busy} onClick={close}>Cancel</Button><Button variant="default" type="submit" loading={busy} disabled={busy||!draft.session_id||!draft.title.trim()}>{entry?'Save changes':'Save bookmark'}</Button></DialogFooter>
  </form>
 </Dialog>;
}
