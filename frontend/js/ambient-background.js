(function () {
  const BREAKPOINT = '(min-width: 768px)';
  const ROOT = 'assets/backgrounds/';
  const ASSETS = {
    workspace: {
      desktop: {
        video: `${ROOT}workspace-desktop-v1.mp4`,
        poster: `${ROOT}workspace-desktop-poster-v1.webp`
      },
      mobile: {
        video: `${ROOT}workspace-mobile-v1.mp4`,
        poster: `${ROOT}workspace-mobile-poster-v1.webp`
      }
    },
    live: {
      desktop: {
        video: `${ROOT}live-desktop-v1.mp4`,
        poster: `${ROOT}live-desktop-poster-v1.webp`
      },
      mobile: {
        video: `${ROOT}workspace-mobile-v1.mp4`,
        poster: `${ROOT}workspace-mobile-poster-v1.webp`
      }
    }
  };

  function staticOnly() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const slowConnection = ['slow-2g', '2g'].includes(connection?.effectiveType);
    return reducedMotion || Boolean(connection?.saveData) || slowConnection;
  }

  function mount(options = {}) {
    const mode = options.mode === 'live' ? 'live' : 'workspace';
    const media = window.matchMedia(BREAKPOINT);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    let stage = document.querySelector('.ambient-stage');
    let video = null;
    let currentKind = '';
    let resumeAt = 0;

    if (!stage) {
      stage = document.createElement('div');
      stage.className = 'ambient-stage';
      document.body.prepend(stage);
    }

    stage.setAttribute('aria-hidden', 'true');
    stage.dataset.mode = mode;
    stage.replaceChildren();

    const poster = document.createElement('div');
    poster.className = 'ambient-poster';
    const shade = document.createElement('div');
    shade.className = 'ambient-shade';
    stage.append(poster, shade);

    function selection() {
      const kind = media.matches ? 'desktop' : 'mobile';
      return { kind, ...ASSETS[mode][kind] };
    }

    function setPoster(asset) {
      poster.style.backgroundImage = `url("${asset.poster}")`;
    }

    function discardVideo() {
      if (!video) return;
      resumeAt = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
      video = null;
      stage.classList.remove('is-video-ready');
    }

    function loadVideo(force = false) {
      const asset = selection();
      setPoster(asset);
      if (staticOnly()) {
        discardVideo();
        currentKind = asset.kind;
        return;
      }
      if (!force && video && currentKind === asset.kind) return;

      discardVideo();
      currentKind = asset.kind;
      stage.classList.remove('is-video-failed');
      const nextVideo = document.createElement('video');
      video = nextVideo;
      nextVideo.className = 'ambient-video';
      nextVideo.muted = true;
      nextVideo.loop = true;
      nextVideo.autoplay = true;
      nextVideo.playsInline = true;
      nextVideo.preload = 'metadata';
      nextVideo.poster = asset.poster;
      nextVideo.setAttribute('aria-hidden', 'true');
      nextVideo.setAttribute('tabindex', '-1');
      nextVideo.src = asset.video;
      stage.insertBefore(nextVideo, shade);

      nextVideo.addEventListener('loadedmetadata', () => {
        if (video !== nextVideo) return;
        if (resumeAt > 0 && Number.isFinite(nextVideo.duration) && nextVideo.duration > 0) {
          nextVideo.currentTime = resumeAt % nextVideo.duration;
        }
      }, { once: true });
      nextVideo.addEventListener('canplay', () => {
        if (video !== nextVideo) return;
        stage.classList.add('is-video-ready');
        nextVideo.play().catch(() => {
          stage.classList.remove('is-video-ready');
        });
      }, { once: true });
      nextVideo.addEventListener('error', () => {
        if (video !== nextVideo) return;
        stage.classList.add('is-video-failed');
        discardVideo();
      }, { once: true });
      nextVideo.load();
    }

    function handleVisibility() {
      if (!video) return;
      if (document.hidden) video.pause();
      else video.play().catch(() => stage.classList.remove('is-video-ready'));
    }

    function handleMediaChange() {
      loadVideo(true);
    }

    loadVideo();
    document.addEventListener('visibilitychange', handleVisibility);
    media.addEventListener?.('change', handleMediaChange);
    motion.addEventListener?.('change', handleMediaChange);
    connection?.addEventListener?.('change', handleMediaChange);

    return {
      refresh: () => loadVideo(true),
      destroy() {
        document.removeEventListener('visibilitychange', handleVisibility);
        media.removeEventListener?.('change', handleMediaChange);
        motion.removeEventListener?.('change', handleMediaChange);
        connection?.removeEventListener?.('change', handleMediaChange);
        discardVideo();
      }
    };
  }

  window.AmbientBackground = { mount };
})();
