(function(){
  let channel;
  async function start(){
    if(channel||!window.Auth?.client||!document.body.dataset.projectId)return;
    try{
      const client=await window.Auth.client();
      const token=await window.Auth.token();
      if(token)client.realtime.setAuth(token);
      const projectId=document.body.dataset.projectId;
      channel=client.channel(`tshow-operational-${projectId}`)
        .on('postgres_changes',{event:'*',schema:'public',table:'tshow_block_area_readiness',filter:`project_id=eq.${projectId}`},()=>window.dispatchEvent(new CustomEvent('tshow:operational-change',{detail:{kind:'readiness'}})))
        .on('postgres_changes',{event:'*',schema:'public',table:'tshow_operational_notices',filter:`project_id=eq.${projectId}`},()=>window.dispatchEvent(new CustomEvent('tshow:operational-change',{detail:{kind:'notice'}})))
        .on('postgres_changes',{event:'*',schema:'public',table:'tshow_tasks',filter:`project_id=eq.${projectId}`},()=>window.dispatchEvent(new CustomEvent('tshow:operational-change',{detail:{kind:'task'}})))
        .on('postgres_changes',{event:'*',schema:'public',table:'tshow_technical_cues',filter:`project_id=eq.${projectId}`},()=>window.dispatchEvent(new CustomEvent('tshow:operational-change',{detail:{kind:'cue'}})))
        .on('postgres_changes',{event:'*',schema:'public',table:'tshow_artists',filter:`project_id=eq.${projectId}`},()=>window.dispatchEvent(new CustomEvent('tshow:operational-change',{detail:{kind:'artist'}})))
        .on('postgres_changes',{event:'*',schema:'public',table:'tshow_rehearsals',filter:`project_id=eq.${projectId}`},()=>window.dispatchEvent(new CustomEvent('tshow:operational-change',{detail:{kind:'rehearsal'}})))
        .subscribe();
    }catch(_){channel=null;}
  }
  window.addEventListener('tshow:project-context',start);
  window.addEventListener('focus',start);
})();
