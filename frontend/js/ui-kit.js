/* T-Show UI kit: accessible dialogs, forms, help and non-blocking feedback. */
(function(){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>\'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const iconPaths={
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    alert:'<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v4M12 17h.01"/>',
    x:'<path d="m6 6 12 12M18 6 6 18"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'
  };
  const icon=name=>`<svg class="tshow-ui-icon" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name]||iconPaths.info}</svg>`;
  let lastTrigger=null;
  function ensureRoot(){
    let root=document.getElementById('tshowUiRoot');
    if(root)return root;
    root=document.createElement('div');root.id='tshowUiRoot';document.body.appendChild(root);return root;
  }
  function close(){document.getElementById('tshowUiDialog')?.querySelector('[data-ui-cancel]')?.click();}
  function fieldMarkup(field,index){
    const id=`tshowField${index}`;
    const help=field.help?`<small class="tshow-ui-help" id="${id}Help">${esc(field.help)}</small>`:'';
    const label=`<label class="tshow-ui-label" for="${id}">${esc(field.label)}${field.optional?' <span class="tshow-ui-optional">Opcional</span>':''}</label>`;
    if(field.type==='select')return `<div class="tshow-ui-field"><label class="tshow-ui-label" for="${id}">${esc(field.label)}</label><select class="tshow-ui-control" id="${id}" name="${esc(field.name||id)}" ${field.required?'required':''}><option value="">${esc(field.placeholder||'Selecciona una opción')}</option>${(field.options||[]).map(o=>`<option value="${esc(o.value)}" ${String(o.value)===String(field.value??'')?'selected':''}>${esc(o.label)}</option>`).join('')}</select>${help}</div>`;
    if(field.type==='textarea')return `<div class="tshow-ui-field">${label}<textarea class="tshow-ui-control" id="${id}" name="${esc(field.name||id)}" rows="${field.rows||4}" maxlength="${field.maxlength||''}" placeholder="${esc(field.placeholder||'')}" ${field.required?'required':''}>${esc(field.value||'')}</textarea>${help}</div>`;
    return `<div class="tshow-ui-field">${label}<input class="tshow-ui-control" id="${id}" name="${esc(field.name||id)}" type="${field.type||'text'}" value="${esc(field.value??'')}" maxlength="${field.maxlength||''}" placeholder="${esc(field.placeholder||'')}" ${field.required?'required':''} ${field.min!==undefined?`min="${esc(field.min)}"`:''} ${field.step!==undefined?`step="${esc(field.step)}"`:''}>${help}<small class="tshow-ui-error" data-ui-error-for="${id}" hidden></small></div>`;
  }
  function form(config){
    lastTrigger=document.activeElement;
    const root=ensureRoot();
    root.innerHTML=`<div class="tshow-ui-backdrop" data-ui-cancel></div><section class="tshow-ui-dialog" id="tshowUiDialog" role="dialog" aria-modal="true" aria-labelledby="tshowUiTitle"><button class="tshow-ui-close" type="button" data-ui-cancel aria-label="Cerrar">${icon('x')}</button><div class="tshow-ui-heading"><span class="tshow-ui-kicker">${esc(config.kicker||'T-Show')}</span><h2 id="tshowUiTitle">${esc(config.title||'Completa los datos')}</h2>${config.description?`<p>${esc(config.description)}</p>`:''}</div>${config.help?`<details class="tshow-ui-how"><summary>${icon('info')} Cómo funciona</summary><p>${esc(config.help)}</p></details>`:''}<form id="tshowUiForm" novalidate><div class="tshow-ui-fields">${(config.fields||[]).map(fieldMarkup).join('')}</div><p class="tshow-ui-form-error" data-ui-form-error hidden></p><div class="tshow-ui-actions"><button type="button" class="btn btn-secondary" data-ui-cancel>Cancelar</button><button type="submit" class="btn btn-primary" data-ui-submit>${esc(config.submitLabel||'Guardar')}</button></div></form></section>`;
    root.hidden=false;
    const dialog=root.querySelector('#tshowUiDialog'), formNode=root.querySelector('#tshowUiForm');
    let dirty=false,discarding=false;
    const finish=value=>{root.hidden=true;root.innerHTML='';if(lastTrigger&&document.contains(lastTrigger))lastTrigger.focus();return value;};
    const cancel=()=>{if(!dirty||discarding)return finish(null);if(dialog.querySelector('[data-ui-discard]'))return;dialog.insertAdjacentHTML('beforeend','<div class="tshow-ui-discard" data-ui-discard role="alert"><strong>¿Descartar lo escrito?</strong><span>Los datos que no guardes se perderán.</span><div><button type="button" class="btn btn-secondary" data-ui-keep>Seguir editando</button><button type="button" class="btn btn-danger" data-ui-discard-confirm>Descartar</button></div></div>');dialog.querySelector('[data-ui-keep]').focus();dialog.querySelector('[data-ui-keep]').addEventListener('click',()=>dialog.querySelector('[data-ui-discard]')?.remove());dialog.querySelector('[data-ui-discard-confirm]').addEventListener('click',()=>{discarding=true;finish(null);});};
    root.querySelectorAll('[data-ui-cancel]').forEach(node=>node.addEventListener('click',cancel));
    formNode.addEventListener('input',()=>{dirty=true;});
    const first=dialog.querySelector('input,select,textarea');first?.focus();
    const onKey=event=>{if(event.key==='Escape'){event.preventDefault();finish(null);document.removeEventListener('keydown',onKey);}};document.addEventListener('keydown',onKey);
    return new Promise(resolve=>{formNode.addEventListener('submit',async event=>{event.preventDefault();const submit=formNode.querySelector('[data-ui-submit]');const error=formNode.querySelector('[data-ui-form-error]');if(!formNode.reportValidity())return;submit.disabled=true;submit.dataset.original=submit.textContent;submit.textContent='Guardando…';try{const data=Object.fromEntries(new FormData(formNode).entries());const result=config.onSubmit?await config.onSubmit(data,formNode):data;document.removeEventListener('keydown',onKey);resolve(finish(result));}catch(err){submit.disabled=false;submit.textContent=submit.dataset.original||config.submitLabel||'Guardar';error.hidden=false;error.innerHTML=`${icon('alert')} ${esc(err?.message||'No se pudo guardar. Revisa los datos e inténtalo otra vez.')}`;}});});
  }
  function confirm(config){return form({kicker:config.kicker||'Confirmación',title:config.title,description:config.description,help:config.help,submitLabel:config.confirmLabel||'Confirmar',fields:[],onSubmit:()=>true}).then(value=>value?true:false);}
  function toast(message,type='success'){const host=ensureRoot();const node=document.createElement('div');node.className=`tshow-ui-toast tshow-ui-toast-${type}`;node.setAttribute('role',type==='error'?'alert':'status');node.innerHTML=`${icon(type==='error'?'alert':'check')}<span>${esc(message)}</span>`;host.appendChild(node);setTimeout(()=>node.remove(),4200);}
  function help(config){return form({kicker:'Ayuda rápida',title:config.title,description:config.description,help:config.body,submitLabel:'Entendido',fields:[],onSubmit:()=>true});}
  window.TShowUI={icon,form,confirm,toast,help,close};
})();
