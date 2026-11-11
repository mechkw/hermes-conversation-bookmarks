import React,{useEffect,useRef,useState} from 'react';
import {Switch,ErrorState,Button,Loader} from '@saved/presentation';
export function BookmarkSettings({api}){
 const [value,setValue]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
 const life=useRef(0),working=useRef(false);
 useEffect(()=>{const token=++life.current;api('/settings').then(data=>{if(token===life.current){setValue(data);setError('');}}).catch(e=>{if(token===life.current)setError(e.message);});return()=>{life.current++;};},[api,retry]);
 async function change(key,checked){
  if(working.current)return;working.current=true;setBusy(true);setError('');const token=life.current;
  try{const saved=await api('/settings',{method:'PUT',body:{...value,[key]:checked}});if(token===life.current)setValue(saved);}
  catch(e){if(token===life.current)setError(e.message);}
  finally{working.current=false;if(token===life.current)setBusy(false);}
 }
 return <section className="cb-settings" aria-label="Bookmark display preferences"><p>Defaults for this profile. Bookmarks store references and annotations, never a transcript backup.</p>{!value&&!error&&<Loader label="Loading settings"/>}{value&&[['show_notes','Show notes in list'],['show_source_status','Show source status in list']].map(([key,label])=><label className="cb-setting" key={key}><span>{label}</span><Switch aria-label={label} checked={value[key]} disabled={busy} onCheckedChange={checked=>change(key,checked)}/></label>)}{error&&<ErrorState title="Could not save settings" description={error}><Button onClick={()=>setRetry(n=>n+1)}>Retry settings</Button></ErrorState>}</section>;
}
