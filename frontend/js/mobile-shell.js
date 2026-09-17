/* Shared presentation only: routing and authorization remain with the host. */
(function () {
    const logo = '<span class="motion-logo"><img src="/assets/branding/tshow-isotipo.png" width="40" height="40" alt="T-Show"></span>';
  window.MobileShell = { mount(options) {
    const header = document.createElement('header');
    header.className = 'mobile-shell-header';
    header.innerHTML = `<a href="/projects" aria-label="T-Show, cambiar evento">${logo}</a><button type="button" class="mobile-event"></button><button type="button" class="mobile-account">Cuenta</button>`;
    const bar = document.createElement('nav');
    bar.className = 'mobile-shell-bar'; bar.setAttribute('aria-label', 'Herramientas del evento');
    const items = [['summary','Resumen'],['schedule','Escaleta'],['live','En vivo'],['notes','Guion'],['more','Más']];
    items.forEach(([route,label]) => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.mobileRoute = route;
      const paths={summary:'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',schedule:'M5 5h14M5 12h14M5 19h14M8 3v4M13 10v4M17 17v4',live:'m8 4 12 8-12 8z',notes:'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',more:'M4 12h2M11 12h2M18 12h2'};
      button.innerHTML = `${options.icons?.[route] || `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[route]}"/></svg>`}<span>${label}</span>`;
      bar.append(button);
    });
    const sheet = document.createElement('dialog'); sheet.className = 'mobile-shell-sheet';
    sheet.setAttribute('aria-labelledby','mobileSheetTitle');
    sheet.innerHTML = '<div class="mobile-sheet-heading"><h2 id="mobileSheetTitle">Más opciones</h2><button type="button" data-close aria-label="Cerrar menú">Cerrar</button></div><div class="mobile-sheet-items"></div>';
    document.body.append(header,bar,sheet);
    document.body.classList.add('has-mobile-shell');
    let opener;
    function open(source) {
      opener = source;
      const container = sheet.querySelector('.mobile-sheet-items'); container.replaceChildren();
      options.menu().forEach(item => {
        const node = document.createElement(item.href ? 'a' : 'button');
        node.textContent = item.label;
        if (item.href) node.href = item.href; else node.type = 'button';
        node.addEventListener('click', () => { sheet.close(); item.action?.(); });
        container.append(node);
      });
      bar.querySelector('[data-mobile-route="more"]').setAttribute('aria-expanded','true');
      sheet.showModal(); sheet.querySelector('[data-close]').focus();
    }
    sheet.querySelector('[data-close]').onclick = () => sheet.close();
    sheet.addEventListener('close', () => { bar.querySelector('[data-mobile-route="more"]').setAttribute('aria-expanded','false'); opener?.focus(); });
    sheet.addEventListener('click', event => { if(event.target===sheet) { const r=sheet.getBoundingClientRect(); if(event.clientY<r.top || event.clientX<r.left || event.clientX>r.right)sheet.close(); } });
    header.querySelector('.mobile-account').onclick = event => open(event.currentTarget);
    header.querySelector('.mobile-event').onclick = () => options.navigate('projects');
    header.querySelector('a').onclick = event => { event.preventDefault(); options.navigate('projects'); };
    bar.addEventListener('click', event => {
      const button=event.target.closest('[data-mobile-route]'); if(!button)return;
      if(button.dataset.mobileRoute==='more')open(button); else options.navigate(button.dataset.mobileRoute);
    });
    function sync() {
      const context=options.context();
      header.querySelector('.mobile-event').textContent=context.name || 'Elige tu evento';
      bar.hidden=!context.project || context.route==='projects';
      bar.querySelectorAll('[data-mobile-route]').forEach(button => {
        const route=button.dataset.mobileRoute;
        const active=route===context.route || (route==='more' && ['team','files','metrics','settings'].includes(context.route));
        if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
      });
    }
    const media=matchMedia('(max-width:767px)');
    media.addEventListener('change',()=>{if(!media.matches&&sheet.open)sheet.close();});
    const viewport=window.visualViewport;
    const keyboard=()=>document.body.classList.toggle('mobile-keyboard',!!viewport && innerHeight-viewport.height>150 && /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName));
    viewport?.addEventListener('resize',keyboard);document.addEventListener('focusout',()=>requestAnimationFrame(keyboard));
    sync(); return {sync};
  }};
  document.addEventListener('visibilitychange',()=>document.documentElement.classList.toggle('motion-paused',document.hidden));
  document.addEventListener('click',event=>{
    if(!matchMedia('(max-width:767px)').matches || !event.target.closest('.block-row-main'))return;
    requestAnimationFrame(()=>{
      const detail=document.querySelector('.block-detail');if(!detail)return;
      detail.tabIndex=-1;detail.focus({preventScroll:true});
      detail.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});
    });
  });
  if(document.body.classList.contains('live-body')) {
    const project=new URLSearchParams(location.search).get('project');
    const href=route=>route==='projects'?'/projects':`/${route}?project=${encodeURIComponent(project||'')}`;
    const shell=MobileShell.mount({
      context:()=>({project,route:'live',name:document.getElementById('eventName')?.textContent}),
      navigate:route=>location.assign(href(route)),
      menu:()=>[['team','Equipo'],['files','Archivos'],['metrics','Métricas'],['settings','Configuración'],['projects','Proyectos y cuenta']].map(([route,label])=>({label,href:href(route)}))
    });
    const name=document.getElementById('eventName');if(name)new MutationObserver(()=>shell.sync()).observe(name,{childList:true,subtree:true,characterData:true});
  }
})();
