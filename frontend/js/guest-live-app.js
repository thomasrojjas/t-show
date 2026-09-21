(() => {
  const root = document.querySelector('.guest-live');
  const storedSession = () => { try { return sessionStorage.getItem('tshow_guest_live_session'); } catch (_) { return null; } };
  const rememberSession = value => { try { sessionStorage.setItem('tshow_guest_live_session', value); } catch (_) { /* Session storage is optional. */ } };
  const sessionFromUrl = () => new URLSearchParams(location.hash.slice(1)).get('session') || storedSession();
  const session = sessionFromUrl();
  const $ = id => document.getElementById(id);
  let sample = null, sampleAt = 0, stopped = false;
  const format = seconds => { const n = Math.max(0, Math.floor(Math.abs(Number(seconds) || 0))); return `${Math.floor(n / 60).toString().padStart(2,'0')}:${(n % 60).toString().padStart(2,'0')}`; };
  const set = (id, value) => { const node = $(id); if (node) node.textContent = value ?? ''; };
  const message = (value, error = false) => { set('guestStatus', value); $('guestStatus').className = error ? 'status-error' : 'state'; };
  const render = () => {
    if (!sample) return;
    const data = sample;
    set('eventName', data.eventName || 'Evento'); set('currentTitle', data.current?.title || (data.status === 'finished' ? 'Evento finalizado' : 'Sin bloque actual'));
    set('currentMeta', data.current ? `${data.current.type || 'Bloque'} · ${data.current.duration || 0} min` : 'Solo lectura');
    set('nextTitle', data.next?.title || (data.status === 'finished' ? 'Después finaliza el evento' : 'Último bloque · después finaliza el evento'));
    set('nextMeta', data.next ? `${data.next.type || 'Bloque'} · ${data.next.duration || 0} min · ${data.next.start || 'Hora por definir'}` : 'No hay un bloque posterior disponible.');
    const active = data.status === 'live' && data.connection === 'connected'; $('liveState').dataset.active = String(active); set('liveLabel', data.status === 'live' ? 'En vivo' : ({idle:'En espera',scheduled:'Programado','schedule-invalidated':'Programación desactualizada',paused:'Pausado',finished:'Finalizado'}[data.status] || 'Estado del evento'));
    const remaining = Number(data.remainingSeconds || 0) + (active && sampleAt ? (Date.now() - sampleAt) / 1000 : 0);
    set('timerLabel', data.status === 'finished' ? 'Evento finalizado' : data.status === 'scheduled' ? 'Comienza en' : data.status === 'paused' ? 'Pausado' : data.current ? (remaining < 0 ? 'Tiempo de atraso' : 'Tiempo restante') : 'Sin bloques');
    set('timer', (remaining < 0 ? '+' : '') + format(remaining)); $('timer').dataset.alert = data.alertLevel || 'normal';
    set('elapsed', format(data.elapsedSeconds)); set('connection', data.connection === 'connected' ? 'Conectado' : 'Sin conexión · reloj estimado');
  };
  const renew = async () => {
    if (!session || stopped || document.hidden) return;
    try { await fetch(`/api/guest-passes/live/${encodeURIComponent(session)}/renew`, { method:'POST', headers:{'Content-Type':'application/json'}, cache:'no-store' }); }
    catch (_) { /* The next state poll will surface an expired or revoked pass. */ }
  };
  const fetchState = async () => {
    if (!session || stopped) return;
    try {
      const response = await fetch(`/api/guest-passes/live/${encodeURIComponent(session)}`, { cache:'no-store' }); const body = await response.json().catch(() => ({}));
      if (!response.ok) { if (response.status === 410) stopped = true; throw new Error(body.message || 'El acceso de observador no está disponible.'); }
      sample = body.data; sampleAt = Date.now(); rememberSession(session); window.TShowTheme?.apply(sample.visualTheme || 'light', { persist:false }); document.querySelector('meta[name="theme-color"]')?.setAttribute('content', sample.visualTheme === 'light' ? '#f3f4f4' : '#101216');
      $('guestStatus').hidden = true; render();
    } catch (error) { $('guestStatus').hidden = false; message(error.message, true); }
  };
  if (!session) { message('Este enlace no contiene una sesión de observador válida.', true); } else {
    $('stageToggle').onclick = () => { const isStage = root.dataset.stage === 'true'; root.dataset.stage = String(!isStage); $('stageToggle').textContent = isStage ? 'Vista de escenario' : 'Volver a lectura'; };
    addEventListener('online', fetchState); addEventListener('offline', () => message('Sin conexión · reloj estimado.', true)); document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchState(); });
    fetchState(); setInterval(() => { if (!document.hidden) render(); }, 1000); setInterval(() => { if (!document.hidden) fetchState(); }, 5000); setInterval(renew, 20 * 60 * 1000);
  }
})();
