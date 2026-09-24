(function(){
  let channel;
  let subscribedProject='';
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
      channel=client.channel(`tshow-operational-${projectId}`)
        .on('postgres_changes',{event:'*',schema:'public',table:'tshow_block_area_readiness',filter:`project_id=eq.${projectId}`},()=>window.dispatchEvent(new CustomEvent('tshow:operational-change',{detail:{kind:'readiness'}})))
        .on('postgres_changes',{event:'*',schema:'public',table:'tshow_operational_notices',filter:`project_id=eq.${projectId}`},()=>window.dispatchEvent(new CustomEvent('tshow:operational-change',{detail:{kind:'notice'}})))
        .on('postgres_changes',{event:'*',schema:'public',table:'tshow_tasks',filter:`project_id=eq.${projectId}`},()=>window.dispatchEvent(new CustomEvent('tshow:operational-change',{detail:{kind:'task'}})))
        .on('postgres_changes',{event:'*',schema:'public',table:'tshow_technical_cues',filter:`project_id=eq.${projectId}`},()=>window.dispatchEvent(new CustomEvent('tshow:operational-change',{detail:{kind:'cue'}})))
        .on('postgres_changes',{event:'*',schema:'public',table:'tshow_artists',filter:`project_id=eq.${projectId}`},()=>window.dispatchEvent(new CustomEvent('tshow:operational-change',{detail:{kind:'artist'}})))
        .on('postgres_changes',{event:'*',schema:'public',table:'tshow_rehearsals',filter:`project_id=eq.${projectId}`},()=>window.dispatchEvent(new CustomEvent('tshow:operational-change',{detail:{kind:'rehearsal'}})))
        .subscribe();
    }catch(_){channel=null;subscribedProject='';}
  }
  window.addEventListener('tshow:project-context',start);
  window.addEventListener('focus',start);
})();
