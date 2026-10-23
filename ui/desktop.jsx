import React, {useMemo} from 'react';
import {host, useValue, ROUTES_AREA, SIDEBAR_NAV_AREA} from '@hermes/plugin-sdk';
import {Bookmarks} from './Bookmarks.jsx';

export default {
  id:'conversation-bookmarks', name:'Conversation Bookmarks',
  register(ctx) {
    let disposed=false;
    ctx.onDispose(()=>{disposed=true;});
    function Page() {
      const profile=useValue(host.state.profile);
      const connection=useValue(host.state.connectionId);
      const api=useMemo(()=>{const request=async(path,opts={})=>{
        const valid=()=>!disposed && host.state.profile.get()===profile && host.state.connectionId.get()===connection;
        if(!valid())throw new Error('Connection changed. Reopen Conversation Bookmarks.');
        const result=await ctx.rest(path+(path.includes('?')?'&':'?')+'profile='+encodeURIComponent(profile||'default'),opts);
        if(!valid())throw new Error('Connection changed. Reopen Conversation Bookmarks.');
        return result;
      };
      request.copyText=async(text)=>{if(disposed || host.state.profile.get()!==profile || host.state.connectionId.get()!==connection || !await ctx.os.writeClipboard(text))throw new Error("Copy unavailable");};
      request.openSession=async(id)=>{if(disposed || host.state.profile.get()!==profile || host.state.connectionId.get()!==connection)throw new Error('Connection changed. Reopen Bookmarks.');await host.openSession(id,{profile:profile||'default',expectHistory:true});};
      return request;},[profile,connection]);
      return <Bookmarks key={JSON.stringify([profile,connection])} api={api}/>;
    }
    ctx.registerMany([
      {id:'page',area:ROUTES_AREA,data:{path:'/conversation-bookmarks'},render:()=> <Page/>},
      {id:'nav',area:SIDEBAR_NAV_AREA,data:{path:'/conversation-bookmarks',label:'Conversation Bookmarks',codicon:'archive'}}
    ]);
  }
};
