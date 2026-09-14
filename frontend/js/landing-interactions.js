(function () {
  const billingButtons=[...document.querySelectorAll('[data-billing]')];
  const planSection=document.getElementById('planes');
  const contactMessage=document.querySelector('#contactForm textarea[name="message"]');
  const billingPeriod=()=>document.querySelector('[data-billing].is-selected')?.dataset.billing||'monthly';
  const subscriptionButtons=[...document.querySelectorAll('[data-subscribe-plan]')];
  const updateSubscriptionLinks=period=>subscriptionButtons.forEach(button=>{button.href=`billing.html?plan=${encodeURIComponent(button.dataset.subscribePlan)}&interval=${period==='annual'?'year':'month'}`;});
  const updatePrices=period=>{
    planSection?.querySelectorAll('[data-monthly][data-annual]').forEach(node=>{node.textContent=node.dataset[period];});
    planSection?.querySelectorAll('.plan-price small[data-monthly]').forEach(node=>{node.textContent=node.dataset[period];});
    planSection?.querySelectorAll('.plan-price span[data-annual]').forEach(node=>{node.hidden=period!=='annual';});
  };
  billingButtons.forEach(button=>button.addEventListener('click',()=>{
    const period=button.dataset.billing;
    billingButtons.forEach(item=>{const selected=item===button;item.classList.toggle('is-selected',selected);item.setAttribute('aria-pressed',String(selected));});
    updatePrices(period);
    updateSubscriptionLinks(period);
  }));
  updatePrices('monthly');
  updateSubscriptionLinks('monthly');
  document.querySelectorAll('[data-plan]').forEach(button=>button.addEventListener('click',()=>{
    if(!contactMessage||contactMessage.value.trim())return;
    contactMessage.value=`Me interesa el plan ${button.dataset.plan} (${billingPeriod()==='annual'?'modalidad anual':'modalidad mensual'}).`;
  }));
  const dialog=document.getElementById('screenshotDialog');
  let opener=null;
  document.querySelectorAll('.screenshot-open').forEach(button=>button.addEventListener('click',()=>{
    opener=button;
    const source=button.querySelector('img'),target=document.getElementById('expandedScreenshot');
    target.src=source.src;target.alt=source.alt;
    dialog.showModal();document.getElementById('closeScreenshot').focus();
  }));
  document.getElementById('closeScreenshot')?.addEventListener('click',()=>dialog.close());
  dialog?.addEventListener('close',()=>opener?.focus());
  const body = document.body;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const revealTargets = document.querySelectorAll(
    '.hero-copy > *, .hero-image, .hero-scroll-cue, main > section:not(.hero)'
  );

  body.classList.add('landing-enhanced');
  revealTargets.forEach((element, index) => {
    element.dataset.reveal = '';
    element.style.setProperty('--reveal-order', String(index % 5));
  });

  if (reduceMotion.matches || !('IntersectionObserver' in window)) {
    revealTargets.forEach(element => element.classList.add('is-visible'));
  } else {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });
    revealTargets.forEach(element => observer.observe(element));
  }

  const sections = [...document.querySelectorAll('main section[id]')];
  const navLinks = [...document.querySelectorAll('.nav-sections a[href^="#"]')];
  if ('IntersectionObserver' in window && sections.length) {
    const sectionObserver = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      navLinks.forEach(link => {
        const active = link.getAttribute('href') === `#${visible.target.id}`;
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      });
    }, { rootMargin: '-25% 0px -60% 0px', threshold: [0.05, 0.25, 0.5] });
    sections.forEach(section => sectionObserver.observe(section));
  }

  if (!reduceMotion.matches && window.matchMedia('(pointer: fine)').matches) {
    let frame = 0;
    window.addEventListener('pointermove', event => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const x = (event.clientX / window.innerWidth - 0.5) * 2;
        const y = (event.clientY / window.innerHeight - 0.5) * 2;
        body.style.setProperty('--pointer-x', x.toFixed(3));
        body.style.setProperty('--pointer-y', y.toFixed(3));
      });
    }, { passive: true });
  }
})();
