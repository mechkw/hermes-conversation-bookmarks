import React from 'react';
import {Bookmarks} from './Bookmarks.jsx';
import {Saved,SavedLink} from './Saved.jsx';
import {dashboardHub,attachDashboard} from './saved-coordinator.js';
const sdk=window.__HERMES_PLUGIN_SDK__;
const script=document.currentScript;
const profile=script?.getAttribute('data-hermes-profile')||'';
const hub=dashboardHub(profile);
const basePath=new URL(script.src).pathname.split('/dashboard-plugins/')[0];
async function api(path,opts={}) {
  if(!script?.isConnected)throw new Error('Profile changed. Reopen Saved.');
  const suffix=profile ? (path.includes('?')?'&':'?')+'profile='+encodeURIComponent(profile) : '';
  const result=await sdk.fetchJSON('/api/plugins/conversation-bookmarks'+path+suffix,{
    method:opts.method||'GET',headers:opts.body?{'Content-Type':'application/json'}:undefined,
    body:opts.body?JSON.stringify(opts.body):undefined
  });
  if(!script?.isConnected)throw new Error('Profile changed. Reopen Saved.');
  return result;
}
api.copyText=text=>{if(!script?.isConnected)throw new Error('Profile changed. Reopen Saved.');return navigator.clipboard.writeText(text);};
const provider={id:'conversation-bookmarks',probe:()=>api('/status'),path:basePath+'/conversation-bookmarks',Page:()=> <Bookmarks api={api} embedded/>};
attachDashboard(hub,provider,script,profile);
window.__HERMES_PLUGINS__.register('conversation-bookmarks',()=> <Saved hub={hub} scope={profile} manage={()=>{window.location.href=basePath+'/plugins';}}/>);
window.__HERMES_PLUGINS__.registerSlot('conversation-bookmarks','header-banner',()=> <SavedLink hub={hub} id="conversation-bookmarks"/>);
