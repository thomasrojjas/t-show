(function () {
  const sentOnce = new Set();
  const version = document.documentElement.dataset.landingVersion || 'suite-v1';
  const dispatch = (name, properties = {}) => {
    const payload = { ...properties, landing_version: version };
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: name, ...payload });
    try { window.gtag?.('event', name, payload); } catch (_) {}
    try { window.posthog?.capture(name, payload); } catch (_) {}
  };
  window.TShowAnalytics = {
    capture(name, properties) { dispatch(name, properties); },
    captureOnce(name, key = name) { if (sentOnce.has(key)) return; sentOnce.add(key); dispatch(name); }
  };
  window.TShowAnalytics.captureOnce('landing_view', `landing_view:${location.pathname}`);
  const pricing = document.getElementById('planes');
  if ('IntersectionObserver' in window && pricing) {
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      window.TShowAnalytics.captureOnce('pricing_view');
      observer.disconnect();
    }, { threshold: 0.5 });
    observer.observe(pricing);
  }
  document.querySelectorAll('[data-intent]').forEach(link => link.addEventListener('click', () => {
    const target = document.querySelector('#contactForm [name="intent"]');
    if (target) target.value = link.dataset.intent;
  }));
  document.querySelectorAll('[data-package]').forEach(link => link.addEventListener('click', () => {
    window.TShowAnalytics.capture('package_select', { package: link.dataset.package });
  }));
  document.querySelectorAll('#taquilla, #operacion').forEach(section => {
    let timer;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      timer = window.setTimeout(() => window.TShowAnalytics.captureOnce('technical_engaged', `technical_engaged:${section.id}`), 30000);
      observer.disconnect();
    }, { threshold: 0.5 });
    observer.observe(section);
    window.addEventListener('pagehide', () => window.clearTimeout(timer), { once: true });
  });
}());
