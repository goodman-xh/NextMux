'use strict';
// The torn-off tab (computer-tab-window.cjs): the same live window, mouse and sound switches as the tab itself.
(() => {
  const query = new URLSearchParams(location.search);
  let labels = {};
  try { labels = JSON.parse(query.get('labels') || '{}'); } catch { labels = {}; }
  const t = key => typeof labels[key] === 'string' ? labels[key] : key;
  document.documentElement.dataset.theme = query.get('theme') === 'light' ? 'light' : 'dark';
  document.documentElement.dir = query.get('dir') === 'rtl' ? 'rtl' : 'ltr';
  document.title = query.get('title') || 'NextMux';
  const $ = id => document.getElementById(id);
  const video = $('video');
  document.documentElement.dataset.platform = query.get('platform') || '';
  $('name').textContent = document.title;
  $('tab').title = document.title;
  $('closeTab').title = t('closeTab');
  $('closeTab').setAttribute('aria-label', `${t('closeTab')} · ${document.title}`);
  $('mouseText').textContent = t('mouse');
  $('soundText').textContent = t('sound');
  $('empty').textContent = t('waiting');
  const buttons = [...document.querySelectorAll('[data-place]')];
  buttons.forEach(button => { button.textContent = t(button.dataset.place === 'tab' ? 'onlyInTab' : 'alsoOnDesktop'); });
  let errorTimer;
  const fail = key => { $('error').textContent = t(key); clearTimeout(errorTimer); errorTimer = setTimeout(() => { $('error').textContent = ''; }, 4000); };
  let stream, captureGeneration = 0, cancelFrame;
  let placement = 'desktop';
  const setLive = on => {
    video.hidden = !on; $('empty').hidden = on;
    video.classList.toggle('ready', on);
    $('status').className = on ? 'status live' : 'status';
    $('status').textContent = on ? t('live') : t('waiting');
  };
  // A captured macOS / Windows 11 window has rounded corners that arrive black: measure the radius on the top-left
  // diagonal (first non-black pixel d = r·(1 − 1/√2)) and clip the picture to it.
  const cornerRadius = () => {
    const size = Math.min(96, video.videoWidth, video.videoHeight);
    if (size < 16) return 0;
    try {
      const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(video, 0, 0, size, size, 0, 0, size, size);
      const pixels = context.getImageData(0, 0, size, size).data;
      const dark = (x, y) => { const i = (y * size + x) * 4; return pixels[i + 3] < 16 || pixels[i] + pixels[i + 1] + pixels[i + 2] < 24; };
      if (!dark(0, 0)) return 0;
      let edge = 0;
      while (edge < size && dark(edge, edge)) edge++;
      return edge >= size ? 0 : Math.round(edge / (1 - Math.SQRT1_2));
    } catch { return 0; }
  };
  // The window's own size (points): a Retina capture of a window on the desktop has twice the pixels of the parked one.
  // The box is fitted exactly (scaled down, never up) so the clip follows the picture's corners.
  let natural, radius = 0;
  const layout = () => {
    if (!natural) return;
    const box = video.parentElement.getBoundingClientRect();
    const fit = Math.min(1, box.width / natural.width, box.height / natural.height);
    video.style.width = `${natural.width * fit}px`;
    video.style.height = `${natural.height * fit}px`;
    video.style.borderRadius = radius ? `${radius * fit}px` : '';
  };
  const measure = () => {
    if (!video.videoWidth || !video.videoHeight) return;
    const scale = placement === 'tab' ? 1 : Math.max(1, window.devicePixelRatio || 1);
    natural = { width: video.videoWidth / scale, height: video.videoHeight / scale };
    radius = Math.min(32, cornerRadius() / scale);
    layout();
  };
  video.addEventListener('resize', measure);
  new ResizeObserver(layout).observe(video.parentElement);
  const stopCapture = () => {
    captureGeneration++;
    cancelFrame?.();
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined; video.srcObject = null; setLive(false);
  };
  const start = async () => {
    stopCapture();
    const generation = captureGeneration;
    const current = () => generation === captureGeneration && document.visibilityState !== 'hidden';
    if (!current()) return;
    try {
    const armed = await window.nextmuxTab.start();
    if (!current() || !armed?.ok) return;
    if (armed.placement) { placement = armed.placement; buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.place === armed.placement))); }
    $('placement').hidden = query.get('canPark') !== '1' || !armed.placement;
    if (query.get('canMute') === '1' && armed.sound !== undefined) { $('soundSwitch').hidden = false; $('sound').checked = armed.sound; }
    const captured = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 24, max: 30 } }, audio: false });
    if (!current()) { captured.getTracks().forEach(track => track.stop()); return; }
    stream = captured;
    captured.getVideoTracks()[0]?.addEventListener('ended', () => { if (stream === captured) stopCapture(); });
    video.srcObject = captured;
    video.hidden = false;
    // Shown once its first frame is decoded, so nothing jumps or flashes empty.
    const decoded = await new Promise(resolve => {
      const done = ok => { video.removeEventListener('loadeddata', loaded); if (cancelFrame === cancel) cancelFrame = undefined; resolve(ok); };
      const loaded = () => done(true), cancel = () => done(false);
      cancelFrame = cancel;
      if (video.readyState >= 2) done(true); else video.addEventListener('loadeddata', loaded, { once: true });
      void video.play().catch(() => done(false));
    });
    if (!current()) return;
    if (!decoded) { stopCapture(); return; }
    measure();
    setLive(true);
    } catch { if (generation === captureGeneration) stopCapture(); }
  };
  $('mouseSwitch').hidden = query.get('canPoint') !== '1';
  // The 键鼠 switch is the tab's own (shared with it through the app side): off, the window also ignores the user on the desktop.
  const applyMouse = on => {
    $('mouse').checked = on;
    document.body.classList.toggle('pointer', on);
    $('keys').hidden = !on;
    if (!on) { cancelInput(); $('keys').blur(); }
  };
  let mouseRevision = 0;
  $('mouse').addEventListener('change', () => {
    mouseRevision++;
    const on = $('mouse').checked;
    applyMouse(on);
    void window.nextmuxTab.userInput(on).catch(() => undefined);
  });
  void window.nextmuxTab.userInput().then(state => { if (mouseRevision === 0) applyMouse(state?.on === true); }, () => undefined);
  // Typing: a hidden text field keeps input methods working; text goes in short batches, special keys and shortcuts one by one.
  const special = { Enter: 'enter', Backspace: 'backspace', Tab: 'tab', Escape: 'escape', Delete: 'delete', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown',
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  for (let index = 1; index <= 12; index++) special[`F${index}`] = `f${index}`;
  const punctuation = { Space: 'space', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`' };
  let pending = '', pendingTimer, inputGeneration = 0, inputQueue = Promise.resolve();
  let wheel = { delta: 0, at: undefined, timer: undefined };
  const cancelInput = () => {
    inputGeneration++;
    clearTimeout(pendingTimer); pendingTimer = undefined; pending = ''; $('keys').value = '';
    clearTimeout(wheel.timer); wheel = { delta: 0, at: undefined, timer: undefined };
  };
  const sendInput = (kind, input) => {
    const generation = inputGeneration;
    inputQueue = inputQueue.then(() => generation === inputGeneration && $('mouse').checked && document.visibilityState !== 'hidden'
      ? window.nextmuxTab[kind](input) : undefined).catch(() => undefined);
  };
  const flushText = () => {
    clearTimeout(pendingTimer); pendingTimer = undefined;
    const batch = pending; pending = '';
    // The native bridge accepts 2000 UTF-16 units per call. Preserve the rest
    // and keep surrogate pairs together at each boundary.
    for (let offset = 0; offset < batch.length;) {
      let end = Math.min(batch.length, offset + 2000);
      if (end < batch.length && /[\uD800-\uDBFF]/.test(batch[end - 1]) && /[\uDC00-\uDFFF]/.test(batch[end])) end--;
      sendInput('keys', { text: batch.slice(offset, end) }); offset = end;
    }
  };
  const sendText = text => {
    if (!text || !$('mouse').checked) return;
    pending += text;
    if (pendingTimer) return;
    pendingTimer = setTimeout(flushText, 8);
  };
  const keys = $('keys');
  keys.addEventListener('keydown', event => {
    if (!$('mouse').checked) return;
    if (event.isComposing || event.keyCode === 229) return;
    const modifiers = [event.metaKey && 'cmd', event.ctrlKey && 'ctrl', event.altKey && 'alt'].filter(Boolean);
    const named = special[event.key];
    // AltGr produces printable text on many Windows layouts; its synthetic
    // Ctrl+Alt flags must not turn that text into an extra application shortcut.
    if (!named && event.getModifierState?.('AltGraph')) return;
    if (!named && !modifiers.length) return;
    const key = named || (/^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : /^Digit\d$/.test(event.code) ? event.code.slice(5) : punctuation[event.code]);
    if (!key) return;
    event.preventDefault();
    flushText();
    sendInput('keys', { key, ...(modifiers.length || event.shiftKey && named ? { modifiers: event.shiftKey ? [...modifiers, 'shift'] : modifiers } : {}) });
  });
  keys.addEventListener('input', event => { if (event.isComposing) return; sendText(keys.value); keys.value = ''; });
  keys.addEventListener('compositionend', event => { sendText(keys.value || event.data); keys.value = ''; });
  $('sound').addEventListener('change', async () => {
    const result = await window.nextmuxTab.setSound($('sound').checked).catch(() => undefined);
    if (!result?.ok) { $('sound').checked = !$('sound').checked; fail('soundFailed'); }
  });
  buttons.forEach(button => button.addEventListener('click', async () => {
    if (button.getAttribute('aria-pressed') === 'true') return;
    const result = await window.nextmuxTab.place(button.dataset.place).catch(() => undefined);
    if (!result?.ok) { fail('moveFailed'); return; }
    placement = result.placement;
    buttons.forEach(item => item.setAttribute('aria-pressed', String(item.dataset.place === result.placement)));
    void start();
  }));
  $('closeTab').addEventListener('click', event => { event.stopPropagation(); void window.nextmuxTab.closeTab(); });
  $('closeTab').addEventListener('mousedown', event => event.stopPropagation());
  const fraction = event => {
    const rect = video.getBoundingClientRect();
    if (!video.videoWidth || !rect.width) return undefined;
    const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
    const width = video.videoWidth * scale, height = video.videoHeight * scale;
    const x = (event.clientX - rect.left - (rect.width - width) / 2) / width, y = (event.clientY - rect.top - (rect.height - height) / 2) / height;
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : undefined;
  };
  video.addEventListener('click', event => {
    if (!$('mouse').checked) { fail('mouseOff'); return; }
    keys.focus({ preventScroll: true });
    const at = fraction(event);
    if (at) { flushText(); sendInput('pointer', { kind: event.detail === 2 ? 'doubleClick' : 'click', ...at }); }
  });
  video.addEventListener('wheel', event => {
    if (!$('mouse').checked) return;
    const at = fraction(event);
    if (!at) return;
    wheel.delta += event.deltaY; wheel.at = at;
    if (wheel.timer) return;
    wheel.timer = setTimeout(() => {
      const { delta, at: point } = wheel;
      wheel = { delta: 0, at: undefined, timer: undefined };
      if (Math.abs(delta) >= 4) { flushText(); sendInput('pointer', { kind: 'scroll', ...point, direction: delta > 0 ? 'down' : 'up', amount: Math.min(10, Math.max(1, Math.round(Math.abs(delta) / 40))) }); }
    }, 24);
  }, { passive: true });
  // Dragging the tab onto the conversation's tab strip merges it back, as with browser tabs (that strip takes the drop
  // and closes this window). Drag data must be set synchronously, so the tab's identity is fetched up front.
  let identity;
  void window.nextmuxTab.identity().then(value => { identity = value; }, () => undefined);
  $('tab').addEventListener('dragstart', event => {
    if (identity) event.dataTransfer.setData('application/x-nextmux-tab', JSON.stringify(identity));
    event.dataTransfer.setData('text/plain', document.title);
    event.dataTransfer.effectAllowed = 'move';
  });
  // Minimised or fully covered: stop capturing until the window shows again.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { cancelInput(); stopCapture(); }
    else if (!stream) void start();
  });
  window.addEventListener('pagehide', () => { cancelInput(); stopCapture(); });
  setLive(false);
  void start();
})();
