(function () {
  const themes = new Set(['light', 'nocturne', 'violet', 'cobalt', 'ember', 'emerald', 'monochrome']);
  const key = 'tshow_visual_theme_v2';
  const projectId = new URLSearchParams(location.search).get('project') || '';
  const read = (name) => {
    try { return localStorage.getItem(name); } catch (_) { return null; }
  };
  const write = (name, value) => {
    try { localStorage.setItem(name, value); } catch (_) { /* Storage is optional. */ }
  };
  const valid = value => themes.has(value) ? value : 'light';
  const cached = projectId ? read(`${key}:project:${projectId}`) : read(key);
  const initial = valid(cached);
  const root = document.documentElement;

  root.dataset.tshowTheme = initial;
  root.dataset.visualTheme = initial;

  window.TShowTheme = {
    current: initial,
    valid,
    apply(theme, options = {}) {
      const next = valid(theme);
      this.current = next;
      root.dataset.tshowTheme = next;
      root.dataset.visualTheme = next;
      if (document.body) {
        document.body.dataset.visualTheme = next;
        document.body.classList.add('theme-ready');
      }
      if (options.projectId) write(`${key}:project:${options.projectId}`, next);
      else if (options.persist !== false) write(key, next);
      return next;
    },
    remember(theme, id = projectId) {
      const next = valid(theme);
      write(id ? `${key}:project:${id}` : key, next);
      return next;
    },
    forget(id = projectId) {
      try { localStorage.removeItem(id ? `${key}:project:${id}` : key); } catch (_) { /* optional */ }
    }
  };

  if (document.body) window.TShowTheme.apply(initial, { persist: false });
  else document.addEventListener('DOMContentLoaded', () => window.TShowTheme.apply(initial, { persist: false }), { once: true });
})();
