(function(){
  let channel;
  let subscribedProject='';
  let retryTimer;
  let retryDelay=1000;
  const emit=(kind)=>window.dispatchEvent(new CustomEvent('tshow:operational-change',{detail:{kind}}));
  async function start(){
    if(!window.Auth?.client||!document.body.dataset.projectId)return;
    try{
      const client=await window.Auth.client();
      const projectId=document.body.dataset.projectId;
      if(channel&&subscribedProject===projectId)return;
      if(channel){await client.removeChannel(channel).catch(()=>{});channel=null;subscribedProject='';}
      const token=await window.Auth.token();
      if(token)client.realtime.setAuth(token);
      subscribedProject=projectId;
      clearTimeout(retryTimer);
      channel=client.channel(`tshow-operational-${projectId}`)
        .on('postgres_changes',{event:'*',schema:'public',table:'tshow_block_area_readiness',filter:`project_id=eq.${projectId}`},()=>emit('readiness'))
        .on('postgres_changes',{event:'*',schema:'public',table:'tshow_operational_notices',filter:`project_id=eq.${projectId}`},()=>emit('notice'))
        .on('postgres_changes',{event:'*',schema:'public',table:'tshow_operational_notice_recipients',filter:`user_id=eq.${token ? (await client.auth.getUser()).data?.user?.id : ''}`},()=>emit('notice-recipient'))
        .on('postgres_changes',{event:'*',schema:'public',table:'tshow_tasks',filter:`project_id=eq.${projectId}`},()=>emit('task'))
        .on('postgres_changes',{event:'*',schema:'public',table:'tshow_technical_cues',filter:`project_id=eq.${projectId}`},()=>emit('cue'))
        .on('postgres_changes',{event:'*',schema:'public',table:'tshow_project_areas',filter:`project_id=eq.${projectId}`},()=>emit('area'))
        .on('postgres_changes',{event:'*',schema:'public',table:'tshow_project_area_members'},()=>emit('area'))
        .on('postgres_changes',{event:'*',schema:'public',table:'tshow_artist_appearances',filter:`project_id=eq.${projectId}`},()=>emit('artist'))
        .on('postgres_changes',{event:'*',schema:'public',table:'tshow_artist_appearance_events',filter:`project_id=eq.${projectId}`},()=>emit('artist-history'))
        .on('postgres_changes',{event:'*',schema:'public',table:'tshow_rehearsals',filter:`project_id=eq.${projectId}`},()=>emit('rehearsal'))
        .subscribe(status=>{
          if(status==='SUBSCRIBED'){retryDelay=1000;emit('realtime-ready');return;}
          if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){
            clearTimeout(retryTimer);
            retryTimer=setTimeout(start,retryDelay);
            retryDelay=Math.min(retryDelay*2,30000);
          }
        });
    }catch(_){
      channel=null;subscribedProject='';
      clearTimeout(retryTimer);
      retryTimer=setTimeout(start,retryDelay);
      retryDelay=Math.min(retryDelay*2,30000);
    }
  }
  window.addEventListener('tshow:project-context',start);
  window.addEventListener('focus',start);
})();
