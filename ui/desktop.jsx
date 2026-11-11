import React, {useMemo} from 'react';
import {host, useValue, atom, COMPOSER_AREAS, TITLEBAR_AREAS, PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA} from '@hermes/plugin-sdk';
import {Bookmarks} from './Bookmarks.jsx';
import {Saved} from './Saved.jsx';
import {Dialog} from '@saved/presentation';
import {BookmarkSettings} from './BookmarkSettings.jsx';
import {desktopHub} from './saved-coordinator.js';

export default {
  id:'conversation-bookmarks', name:'Conversation Bookmarks',
  register(ctx) {
    let disposed=false;
    const hub=desktopHub(host);
    function useProfileApi() {
      const profile=useValue(host.state.profile);
      const connection=useValue(host.state.connectionId);
      const api=useMemo(()=>{const valid=()=>!disposed && host.state.profile.get()===profile && host.state.connectionId.get()===connection;
        const request=async(path,opts={})=>{
          if(!valid())throw new Error('Connection changed. Reopen Saved.');
          const result=await ctx.rest(path+(path.includes('?')?'&':'?')+'profile='+encodeURIComponent(profile||'default'),opts);
          if(!valid())throw new Error('Connection changed. Reopen Saved.');
          return result;
        };
        request.copyText=async(text)=>{if(!valid() || !await ctx.os.writeClipboard(text))throw new Error('Copy unavailable');};
        request.openSession=async(id)=>{if(!valid())throw new Error("Connection changed. Reopen Saved.");await host.openSession(id,{profile:profile||"default",expectHistory:true});};
        return request;
      },[profile,connection]);
      return {api,key:JSON.stringify([profile,connection])};
    }
    function Page(){const {api,key}=useProfileApi();return <Bookmarks key={key} api={api} embedded/>;}
    function Settings(){const {api,key}=useProfileApi();return <BookmarkSettings key={key} api={api}/>;}
    const modal=atom(null);
    const open=()=>modal.set({profile:host.state.profile.get(),connection:host.state.connectionId.get(),key:Date.now()});
    function ChatModal(){
      const request=useValue(modal),profile=useValue(host.state.profile),connection=useValue(host.state.connectionId);
      const {api,key}=useProfileApi();
      if(!request||request.profile!==profile||request.connection!==connection)return null;
      return <Dialog title="Bookmarks" description="Browse saved references or choose a conversation to bookmark." close={()=>modal.set(null)}><Bookmarks key={key+request.key} api={api}/></Dialog>;
    }
    ctx.registerSettingsPage?.({id:'conversation-bookmarks',title:'Bookmarks',icon:'bookmark',render:()=> <Settings/>});
    ctx.registerMany([
      {id:'attach-bookmarks',area:COMPOSER_AREAS.attachments,data:{label:'Bookmarks',icon:'bookmark',run:open}},
      {id:'browse-bookmarks',area:PALETTE_AREA,data:{id:'browse-bookmarks',label:'Browse bookmarks',keywords:['saved','conversation','/bookmarks'],run:open}},
      {id:'bookmarks-dialog',area:TITLEBAR_AREAS.center,render:()=> <ChatModal/>}
    ]);
    function Panel() {
      const profile=useValue(host.state.profile),connection=useValue(host.state.connectionId);
      const scope=JSON.stringify([profile,connection]);
      return <Saved key={scope} hub={hub} scope={scope} manage={()=>host.navigate('/capabilities?tab=plugins')}/>;
    }
    const probe=async(scope)=>{
      const [profile,connection]=JSON.parse(scope);
      const valid=()=>!disposed&&host.state.profile.get()===profile&&host.state.connectionId.get()===connection;
      if(!valid())throw new Error('Connection changed. Reopen Saved.');
      const status=await ctx.rest('/status?profile='+encodeURIComponent(profile||'default'));
      if(!valid())throw new Error('Connection changed. Reopen Saved.');
      return status;
    };
    const provider={id:'conversation-bookmarks',Page,probe,claim:()=>ctx.registerMany([
      {id:'saved-page',area:ROUTES_AREA,title:'Saved',data:{path:'/saved'},render:()=> <Panel/>},
      {id:'saved-nav',area:SIDEBAR_NAV_AREA,data:{path:'/saved',label:'Saved',codicon:'bookmark'}}
    ])};
    // Fence requests first, then retire provider and transfer route ownership.
    let detach=()=>{};
    ctx.onDispose(()=>{disposed=true;detach();});
    detach=hub.add(provider);
  }
};
