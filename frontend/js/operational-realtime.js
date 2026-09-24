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
        .subscribe();
    }catch(_){channel=null;}
  }
  window.addEventListener('tshow:project-context',start);
  window.addEventListener('focus',start);
})();
