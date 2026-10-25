'use strict';

// Explicit dependencies make loading before app.ready safe.
const error = (code, message) => Object.assign(new Error(message), { code });
const fail = (request, cause) => ({ requestId: request?.id || '', ok: false,
  code: String(cause?.code || '').startsWith('BROWSER_') ? cause.code : 'BROWSER_TOOL_FAILED',
  message: String(cause?.message || 'The browser operation failed.').slice(0, 400) });
const deny = () => error('BROWSER_REQUEST_DENIED', 'This browser does not belong to the current window, document, conversation and project.');
// Preserve the existing browser-view phone UA contract when switching modes.
const MOBILE_BROWSER_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
// This main-process module is cached by Node. Theia imports only this predicate;
// it cannot register a contents by supplying an ID or partition string.
const registeredOwnedContents = new WeakSet();
const isRegisteredOwnedBrowserContents = contents => registeredOwnedContents.has(contents) && !contents.isDestroyed();
const url = value => {
  if (typeof value !== 'string' || value.length > 4096) throw error('BROWSER_URL_INVALID', 'Only HTTP or HTTPS pages are supported.');
  let parsed; try { parsed = new URL(value); } catch { throw error('BROWSER_URL_INVALID', 'The browser URL is invalid.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw error('BROWSER_URL_INVALID', 'Only HTTP or HTTPS URLs without embedded credentials are supported.');
  return parsed.href;
};
const boundedWait = (promise, milliseconds, code) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(error(code, 'The browser operation has not settled. Its state must be checked before retrying.')), milliseconds); })]).finally(() => clearTimeout(timer));
};
const scalarOwner = owner => {
  if (!owner || typeof owner !== 'object') throw deny();
  for (const field of ['conversationId', 'browserId', 'workspaceRoot']) {
    if (typeof owner[field] !== 'string' || !owner[field].trim() || owner[field].includes('\0') || owner[field].length > (field === 'workspaceRoot' ? 4096 : 160)) throw deny();
  }
  return Object.freeze({ conversationId: owner.conversationId, browserId: owner.browserId, workspaceRoot: owner.workspaceRoot });
};

function createOwnedBrowserRegistry({ app, BrowserWindow, BaseWindow, WebContentsView, session, GuestAutomation, trustedMainFrame }) {
  const records = new Map(), registered = new WeakMap(), hosts = new Map();
  let creation, disposed = false, captureCount = 0;
  const keyFor = (host, owner) => `${host.id}:${owner.browserId}`;
  const bump = record => { record.revision += 1; };
  const setError = (record, cause) => { record.error = { code: cause.code || 'BROWSER_TOOL_FAILED', message: String(cause.message || cause).slice(0, 400) }; bump(record); };
  const current = record => !record.closed && !record.host.isDestroyed() && !record.contents.isDestroyed()
    && record.host.mainFrame === record.frame && !record.frame.detached;
  const eventHost = event => {
    if (disposed || !event?.sender || event.sender.isDestroyed() || !trustedMainFrame(event)
      || !event.senderFrame || event.senderFrame !== event.sender.mainFrame || event.senderFrame.detached) throw deny();
    return event.sender;
  };
  const owned = (event, input) => {
    const owner = scalarOwner(input), host = eventHost(event), record = records.get(keyFor(host, owner));
    if (!record || !current(record) || record.host !== host || record.frame !== event.senderFrame
      || record.owner.conversationId !== owner.conversationId || record.owner.workspaceRoot !== owner.workspaceRoot) throw deny();
    return record;
  };
  const stateOf = record => {
    if (!current(record)) throw error('BROWSER_CLOSED', 'This browser or its owning document has been closed.');
    const c = record.contents;
    return { id: c.id, url: c.getURL().slice(0, 4096), title: c.getTitle().slice(0, 512), loading: c.isLoading(),
      canGoBack: c.navigationHistory.canGoBack(), canGoForward: c.navigationHistory.canGoForward(),
      mode: record.mode, revision: record.revision, mobile: record.mobile, ...(record.error ? { error: { ...record.error } } : {}) };
  };
  const boundsFor = (record, bounds, visible = true) => {
    if (!bounds || !['x', 'y', 'width', 'height'].every(field => Number.isFinite(bounds[field]))
      || bounds.x < 0 || bounds.y < 0 || bounds.width < 1 || bounds.height < 1) throw error('BROWSER_BOUNDS_INVALID', 'The browser bounds are outside the supported viewport.');
    // Renderer getBoundingClientRect() is CSS px; native View bounds are DIP.
    // devicePixelRatio includes display scaling and MUST NOT be used here.
    const zoom = record.host.getZoomFactor();
    if (!Number.isFinite(zoom) || zoom <= 0 || zoom > 5) throw error('BROWSER_BOUNDS_INVALID', 'The owning window zoom is invalid.');
    const converted = { x: visible ? Math.round(bounds.x * zoom) : 0, y: visible ? Math.round(bounds.y * zoom) : 0,
      width: Math.round(bounds.width * zoom), height: Math.round(bounds.height * zoom) };
    if (converted.width < 1 || converted.height < 1 || converted.width > 4096 || converted.height > 4096
      || converted.width * converted.height > 8_388_608) throw error('BROWSER_BOUNDS_INVALID', 'The browser bounds exceed the native viewport budget.');
    const content = record.hostWindow.getContentBounds();
    if (visible && (converted.x + converted.width > content.width || converted.y + converted.height > content.height)) throw error('BROWSER_BOUNDS_INVALID', 'The browser bounds must fit inside its owning window.');
    return converted;
  };
  const detachEngine = record => {
    if (record.disposing) return record.disposing;
    const pending = record.engine; record.engine = undefined;
    if (!pending) return Promise.resolve();
    const disposing = (async () => { const engine = await pending.catch(() => undefined); if (engine) await engine.dispose(); })();
    record.disposing = disposing;
    void disposing.finally(() => { if (record.disposing === disposing) record.disposing = undefined; }).catch(() => undefined);
    return disposing;
  };
  const cancelAll = record => {
    record.epoch += 1;
    for (const operation of record.active.values()) operation.controller.abort();
    // A pending attachment may complete later; its action rechecks the epoch
    // before running and never gets to issue a stale input.
    void record.engine?.then(engine => { for (const id of record.active.keys()) engine.cancel(id); }).catch(() => undefined);
    // A manual form/link navigation is page state, not a model request. Moving
    // that same view to the background must not silently cancel the user's load.
    if (record.active.size && !record.contents.isDestroyed()) record.contents.stop();
  };
  const closeRecord = record => {
    if (record.closing) return record.closing;
    record.closed = true; cancelAll(record); clearTimeout(record.idleTimer);
    records.delete(record.key); registered.delete(record.contents); registeredOwnedContents.delete(record.contents);
    if (record.onResize) record.hostWindow.off('resize', record.onResize);
    if (record.onHidden) { record.hostWindow.off('hide', record.onHidden); record.hostWindow.off('minimize', record.onHidden); }
    // BaseWindow does NOT own WebContents lifetime. Closing the view explicitly
    // also ends a stalled CDP operation; beforeunload is intentionally bypassed.
    try { record.parent?.contentView.removeChildView(record.view); } catch { /* parent may already be destroyed */ }
    if (!record.contents.isDestroyed()) record.contents.close({ waitForBeforeUnload: false });
    if (!record.holder.isDestroyed()) record.holder.destroy();
    record.closing = Promise.allSettled([record.tail, detachEngine(record)]).then(() => true);
    return record.closing;
  };
  const installGuards = (record, contents) => {
    const guard = (event, destination) => {
      try { url(destination); } catch (cause) { event.preventDefault(); setError(record, cause); }
    };
    contents.on('will-navigate', guard); contents.on('will-redirect', guard);
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('before-input-event', (event, input) => {
      // The application menu belongs to the Theia host. A manually attached
      // WebContentsView must send editing shortcuts to its own focused page,
      // rather than letting a host menu command consume them. This is strictly
      // a human-input path: background model actions never gain clipboard or
      // foreground control through this handler.
      if (input.type !== 'keyDown' || input.isComposing || !current(record)
        || record.mode !== 'manual' || record.parent !== record.hostWindow
        || !record.hostWindow.isFocused() || !contents.isFocused()) return;
      const mac = process.platform === 'darwin';
      if (mac ? !input.meta || input.control : !input.control || input.meta) return;
      const key = String(input.key || '').toLowerCase();
      let operation;
      if (key === 'v' && input.shift && (!input.alt || mac)) operation = 'pasteAndMatchStyle';
      else if (!input.alt && !input.shift) operation = { a: 'selectAll', c: 'copy', x: 'cut', v: 'paste', z: 'undo', ...(!mac ? { y: 'redo' } : {}) }[key];
      else if (!input.alt && input.shift && key === 'z') operation = 'redo';
      if (!operation) return;
      event.preventDefault();
      contents[operation]();
    });
    for (const name of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) contents.on(name, () => { if (!record.closed) bump(record); });
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3 && !record.closed) setError(record, error('BROWSER_NAVIGATION_FAILED', `Page load failed (${code}): ${String(description).slice(0, 120)}`));
    });
    contents.on('render-process-gone', () => { if (!record.closed) setError(record, error('BROWSER_RENDERER_GONE', 'The page process exited. Reload or close this browser.')); });
  };
  // This event is synchronous inside new WebContentsView(). The exact one
  // contents is marked BEFORE later Theia listeners run, not by partition alone.
  // Factory installation uses prependListener even when Theia is already loaded.
  const onCreated = (_event, contents) => {
    if (!creation || creation.contents || contents.session !== creation.expectedSession) return;
    const preferences = contents.getLastWebPreferences();
    if (!preferences.sandbox || preferences.nodeIntegration || !preferences.contextIsolation) return;
    creation.contents = contents; registered.set(contents, creation.record); registeredOwnedContents.add(contents);
    installGuards(creation.record, contents);
  };
  app.prependListener('web-contents-created', onCreated);
  const watchHost = host => {
    if (hosts.has(host)) return;
    const closeAll = () => { for (const record of [...records.values()]) if (record.host === host) void closeRecord(record); };
    const destroyed = () => { closeAll(); hosts.delete(host); };
    const navigating = (_event, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) closeAll(); };
    host.once('destroyed', destroyed); host.on('did-start-navigation', navigating);
    hosts.set(host, () => { if (!host.isDestroyed()) { host.off('destroyed', destroyed); host.off('did-start-navigation', navigating); } });
  };
  const validateRequest = request => {
    if (!request || typeof request.id !== 'string' || !request.id || request.id.length > 80 || request.id.includes('\0')
      || !Number.isFinite(request.expiresAt) || request.expiresAt > Date.now() + 60_000 || JSON.stringify(request).length > 20_000
      || !['snapshot', 'click', 'fill', 'select', 'upload', 'drag', 'navigate', 'back', 'forward', 'reload', 'close'].includes(request.action)) throw error('BROWSER_REQUEST_INVALID', 'The browser request is invalid.');
    for (const field of ['ref', 'targetRef', 'frameId', 'targetFrameId', 'selector', 'targetSelector']) if (request[field] !== undefined
      && (typeof request[field] !== 'string' || request[field].length > 500)) throw error('BROWSER_TARGET_INVALID', 'The browser target is invalid.');
    if (request.text !== undefined && (typeof request.text !== 'string' || request.text.length > 8000)) throw error('BROWSER_TEXT_TOO_LONG', 'The input text is too long.');
    if (request.timeoutMs !== undefined && (!Number.isFinite(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 15000)) throw error('BROWSER_REQUEST_INVALID', 'The action timeout is invalid.');
    if (request.action === 'select' && (!Array.isArray(request.values) || !request.values.length || request.values.length > 30 || request.values.some(value => typeof value !== 'string' || value.length > 500))) throw error('BROWSER_OPTIONS_INVALID', 'The selected options are invalid.');
    if (request.action === 'upload' && (!Array.isArray(request.paths) || !request.paths.length || request.paths.length > 8 || request.paths.some(path => typeof path !== 'string' || path.length > 4096))) throw error('BROWSER_UPLOAD_INVALID', 'The upload files are invalid.');
    if (request.action === 'navigate') url(request.url);
  };
  const checkOperation = (record, operation) => {
    if (!current(record)) throw error('BROWSER_CLOSED', 'The browser has been closed.');
    if (operation.controller.signal.aborted || operation.epoch !== record.epoch || Date.now() >= operation.request.expiresAt) throw error('BROWSER_ACTION_EXPIRED', 'The browser action was cancelled or expired. Check the page before retrying.');
    if (record.mode !== 'background') throw error('BROWSER_MANUAL_CONTROL', 'The user has control of this browser. Release it before continuing model actions.');
  };
  const getEngine = async record => {
    if (record.disposing) await record.disposing;
    const pending = record.engine ||= GuestAutomation.create(record.contents);
    try { return await pending; } catch (cause) { if (record.engine === pending) record.engine = undefined; throw cause; }
  };
  const scheduleIdle = record => {
    clearTimeout(record.idleTimer);
    if (!record.closed && !record.active.size && record.engine) {
      record.idleTimer = setTimeout(() => {
        if (!record.active.size && record.mode === 'background') {
          const pending = detachEngine(record); record.tail = record.tail.then(() => pending).catch(cause => setError(record, cause));
        }
      }, 15 * 60_000);
      record.idleTimer.unref?.();
    }
  };
  const releaseLease = record => {
    clearTimeout(record.idleTimer);
    if (record.active.size) { record.releaseRequested = true; return true; }
    if (!record.engine && !record.disposing) return false;
    // Queue behind the last result but before any newly admitted request.
    record.tail = record.tail.catch(() => undefined).then(() => detachEngine(record)).catch(cause => setError(record, cause));
    return true;
  };
  const navigateContents = async (record, command, signal, expiresAt) => {
    const contents = record.contents;
    if (command.action === 'mobile') {
      if (typeof command.mobile !== 'boolean') throw error('BROWSER_REQUEST_INVALID', 'The mobile view setting is invalid.');
      if (record.mobile === command.mobile) return;
      if (command.mobile) contents.enableDeviceEmulation({ screenPosition: 'mobile', screenSize: { width: 390, height: 844 },
        deviceScaleFactor: 1, viewPosition: { x: 0, y: 0 }, viewSize: { width: 390, height: 844 }, scale: 1 });
      else contents.disableDeviceEmulation();
      contents.setUserAgent(command.mobile ? MOBILE_BROWSER_USER_AGENT : record.desktopUserAgent);
      record.mobile = command.mobile; bump(record);
      await navigateContents(record, { action: 'reload' }, signal, expiresAt); return;
    }
    if (!['navigate', 'back', 'forward', 'reload'].includes(command.action)) throw error('BROWSER_ACTION_UNSUPPORTED', 'This navigation is not supported.');
    if (command.action === 'navigate') command = { ...command, url: url(command.url) };
    if (command.action === 'back' && !contents.navigationHistory.canGoBack() || command.action === 'forward' && !contents.navigationHistory.canGoForward()) throw error('BROWSER_HISTORY_UNAVAILABLE', 'There is no page in that history direction.');
    const stop = () => { if (!contents.isDestroyed()) contents.stop(); };
    signal?.addEventListener('abort', stop, { once: true });
    try {
      if (signal?.aborted || Date.now() >= expiresAt) throw error('BROWSER_ACTION_EXPIRED', 'The navigation expired.');
      record.error = undefined;
      if (command.action === 'navigate') {
        // Keep the real promise in the serialized queue until it settles. A
        // timeout can stop the load but must not hand control to the user early.
        let timer = setTimeout(stop, Math.max(1, expiresAt - Date.now()));
        try { await contents.loadURL(command.url); } finally { clearTimeout(timer); }
      } else {
        await new Promise((resolve, reject) => {
          let timer;
          const cleanup = () => { clearTimeout(timer); contents.off('did-stop-loading', done); contents.off('destroyed', closed); };
          const done = () => { cleanup(); resolve(); }, closed = () => { cleanup(); reject(error('BROWSER_CLOSED', 'The page was closed.')); };
          contents.once('did-stop-loading', done); contents.once('destroyed', closed);
          timer = setTimeout(() => { stop(); cleanup(); reject(error('BROWSER_NAVIGATION_TIMEOUT', 'The navigation did not finish before its deadline.')); }, Math.max(1, expiresAt - Date.now()));
          try { if (command.action === 'back') contents.navigationHistory.goBack(); else if (command.action === 'forward') contents.navigationHistory.goForward(); else contents.reload(); }
          catch (cause) { cleanup(); reject(cause); }
        });
      }
      if (record.error) throw error(record.error.code, record.error.message);
      if (signal?.aborted || Date.now() >= expiresAt) throw error('BROWSER_ACTION_EXPIRED', 'The navigation was cancelled or expired. Check its current URL.');
    } finally { signal?.removeEventListener('abort', stop); }
  };
  const hideView = record => {
    if (record.parent !== record.holder) {
      record.parent.contentView.removeChildView(record.view);
      record.holder.contentView.addChildView(record.view); record.parent = record.holder;
    }
    record.view.setBounds(record.viewport);
  };
  const transition = (record, target, bounds) => {
    if (record.transition) {
      if (target !== 'background') return Promise.reject(error('BROWSER_TRANSITION_BUSY', 'A browser control transition is already in progress.'));
      record.desiredMode = 'background'; cancelAll(record); hideView(record); bump(record);
      return record.transition;
    }
    const nextBounds = target === 'manual' ? boundsFor(record, bounds) : undefined;
    if (target === 'manual' && (!record.hostWindow.isVisible() || record.hostWindow.isMinimized())) return Promise.reject(error('BROWSER_HOST_HIDDEN', 'A hidden or minimized window cannot take over a browser.'));
    if (record.mode === target) { if (nextBounds) { record.view.setBounds(nextBounds); bump(record); } return Promise.resolve(stateOf(record)); }
    record.mode = 'transitioning'; record.desiredMode = target; bump(record); cancelAll(record); clearTimeout(record.idleTimer);
    // Release must stop painting above host DOM immediately, including when a
    // slow toolbar navigation is still settling. It still blocks model actions
    // until cleanup completes; this is not an automatic focus restoration.
    if (target === 'background') hideView(record);
    const pending = (async () => {
      try {
        // Freeze queued input first. All old work must settle and transport must
        // disconnect before the SAME view becomes part of the host focus tree.
        await boundedWait(record.tail, 5_000, 'BROWSER_TRANSITION_UNSETTLED');
        await boundedWait(detachEngine(record), 5_000, 'BROWSER_TRANSITION_UNSETTLED');
        if (!current(record)) throw error('BROWSER_CLOSED', 'The browser was closed during its control transition.');
        const destination = record.desiredMode === 'manual' && record.hostWindow.isVisible() && !record.hostWindow.isMinimized() && record.hostWindow.isFocused() ? 'manual' : 'background';
        // The host may have resized while cancelled input was draining. Reject
        // invalid bounds before exposing a native view above the renderer DOM.
        const destinationBounds = destination === 'manual' ? boundsFor(record, bounds) : record.viewport;
        const parent = destination === 'manual' ? record.hostWindow : record.holder;
        if (record.parent !== parent) {
          record.parent.contentView.removeChildView(record.view);
          try { parent.contentView.addChildView(record.view); record.parent = parent; }
          catch (cause) { record.holder.contentView.addChildView(record.view); record.parent = record.holder; throw cause; }
        }
        record.view.setBounds(destinationBounds);
        record.mode = destination; record.error = undefined; bump(record);
        // Deliberately no focus(), show(), raise(), or focus restoration.
        return stateOf(record);
      } catch (cause) {
        if (current(record)) {
          record.desiredMode = 'background';
          try { hideView(record); record.mode = record.active.size || record.disposing ? 'transitioning' : 'background'; }
          catch { void closeRecord(record); }
        }
        setError(record, cause); throw cause;
      }
    })();
    record.transition = pending;
    void pending.finally(() => { if (record.transition === pending) record.transition = undefined; }).catch(() => undefined);
    return pending;
  };
  return {
    isRegisteredOwnedContents(contents) { return registered.has(contents) && !contents.isDestroyed(); },
    async create(event, input, destination) {
      const host = eventHost(event), owner = scalarOwner(input), initialUrl = url(destination);
      if (!app.isReady()) throw error('BROWSER_NOT_READY', 'The desktop is not ready to create a browser.');
      const key = keyFor(host, owner), existing = records.get(key);
      if (existing) { owned(event, owner); await existing.ready; return stateOf(existing); }
      if ([...records.values()].filter(record => record.host === host).length >= 24 || records.size >= 64) throw error('BROWSER_TAB_LIMIT', 'Close unused browser tabs before opening another.');
      const hostWindow = BrowserWindow.fromWebContents(host);
      if (!hostWindow || hostWindow.isDestroyed()) throw deny();
      const record = { key, owner, host, frame: event.senderFrame, hostWindow, mode: 'background', mobile: false, revision: 0,
        viewport: { x: 0, y: 0, width: 1280, height: 800 }, userPending: 0,
        epoch: 0, closed: false, requests: new Map(), active: new Map(), tail: Promise.resolve() };
      const expectedSession = session.fromPartition('persist:nextmux-browser');
      let marker;
      try {
        record.holder = new BaseWindow({ show: false, focusable: false, skipTaskbar: true, width: 1280, height: 800 });
        if (creation) throw error('BROWSER_CREATE_REENTRANT', 'A browser is already being created.');
        marker = { record, expectedSession }; creation = marker;
        try { record.view = new WebContentsView({ webPreferences: { session: expectedSession, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: true } }); }
        finally { creation = undefined; }
        record.contents = record.view.webContents;
        record.desktopUserAgent = record.contents.getUserAgent();
        if (marker.contents !== record.contents || registered.get(record.contents) !== record) throw error('BROWSER_CREATION_UNREGISTERED', 'The owned browser could not be registered synchronously.');
        record.parent = record.holder; record.holder.contentView.addChildView(record.view); record.view.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
        record.onResize = () => {
          if (record.mode === 'manual' && !record.closed) {
            const native = record.view.getBounds(), content = hostWindow.getContentBounds();
            if (native.x + native.width > content.width || native.y + native.height > content.height) void transition(record, 'background').catch(() => undefined);
          }
        };
        record.onHidden = () => {
          record.desiredMode = 'background';
          if (record.mode === 'manual') void transition(record, 'background').catch(() => undefined);
        };
        hostWindow.on('resize', record.onResize); hostWindow.on('hide', record.onHidden); hostWindow.on('minimize', record.onHidden);
        watchHost(host); records.set(key, record);
        record.contents.once('destroyed', () => { if (!record.closed) void closeRecord(record); });
        record.ready = navigateContents(record, { action: 'navigate', url: initialUrl }, undefined, Date.now() + 15_000).catch(cause => { if (!record.closed) setError(record, cause); });
        record.tail = record.ready; await record.ready; return stateOf(record);
      } catch (cause) {
        // Native creation can emit web-contents-created and then throw. The
        // provisional exact marker must not leave an exempt orphan contents.
        record.contents ||= marker?.contents;
        if (record.contents) await closeRecord(record); else { if (record.view && !record.view.webContents.isDestroyed()) record.view.webContents.close({ waitForBeforeUnload: false }); if (record.holder && !record.holder.isDestroyed()) record.holder.destroy(); }
        throw cause;
      }
    },
    state(event, owner) { return stateOf(owned(event, owner)); },
    async preview(event, owner) {
      const record = owned(event, owner);
      if (record.capture) return record.capture;
      if (captureCount >= 2) throw error('BROWSER_PREVIEW_BUSY', 'The preview capture budget is busy.');
      if (record.lastCaptureAt && Date.now() - record.lastCaptureAt < 200) throw error('BROWSER_PREVIEW_RATE_LIMIT', 'The preview was requested too soon.');
      const revision = record.revision, captureStartedAt = Date.now(); captureCount += 1; record.lastCaptureAt = captureStartedAt;
      const pending = (async () => {
        try {
          let image = await record.contents.capturePage();
          if (!current(record) || record.revision !== revision) throw error('BROWSER_PREVIEW_STALE', 'The page changed while its preview was being captured.');
          if (image.isEmpty()) throw error('BROWSER_PREVIEW_EMPTY', 'The page has not produced a preview yet.');
          const size = image.getSize(), scale = Math.min(1, 1920 / size.width, 2160 / size.height);
          if (scale < 1) image = image.resize({ width: Math.max(1, Math.floor(size.width * scale)), height: Math.max(1, Math.floor(size.height * scale)), quality: 'best' });
          const encoded = image.toPNG();
          if (encoded.byteLength > 6 * 1024 * 1024) throw error('BROWSER_PREVIEW_TOO_LARGE', 'The page preview exceeds its image budget.');
          return { dataURL: `data:image/png;base64,${encoded.toString('base64')}`, ...image.getSize(), revision, captureStartedAt, capturedAt: Date.now() };
        } finally { captureCount -= 1; }
      })();
      // A timeout never frees the budget while native capture is still running.
      record.capture = boundedWait(pending, 3_000, 'BROWSER_PREVIEW_TIMEOUT');
      void pending.finally(() => { record.capture = undefined; }).catch(() => undefined);
      return record.capture;
    },
    action(event, owner, input) {
      let record, request;
      try {
        record = owned(event, owner); validateRequest(input);
        for (const field of ['conversationId', 'browserId', 'workspaceRoot']) if (input[field] !== undefined && input[field] !== record.owner[field]) throw deny();
        // Copy IPC input now. In-process callers cannot mutate queued payloads.
        request = JSON.parse(JSON.stringify(input)); const fingerprint = JSON.stringify(request);
        const existing = record.requests.get(request.id);
        if (existing) { if (existing.fingerprint !== fingerprint) throw error('BROWSER_REQUEST_CONFLICT', 'This request ID has already been used for a different action.'); return existing.promise; }
        if (record.mode !== 'background') throw error('BROWSER_MANUAL_CONTROL', 'The user has control of this browser. Release it before continuing model actions.');
        if (Date.now() >= request.expiresAt) throw error('BROWSER_ACTION_EXPIRED', 'The browser action has expired.');
        for (const [id, entry] of record.requests) if (!record.active.has(id) && entry.expiresAt < Date.now()) record.requests.delete(id);
        if (record.active.size >= 16 || record.requests.size >= 128) throw error('BROWSER_QUEUE_FULL', 'This browser has reached its bounded request budget.');
        const operation = { request, epoch: record.epoch, controller: new AbortController() };
        record.active.set(request.id, operation); record.releaseRequested = false; clearTimeout(record.idleTimer);
        const pending = record.tail.catch(() => undefined).then(async () => {
          checkOperation(record, operation);
          if (request.action === 'close') {
            // Closing is a model mutation too. Check the authoritative mode in
            // the same queue as other actions; no takeover can interleave here.
            // closeRecord synchronously removes/closes the view, then drains
            // this tail. Awaiting that drain here would await this very action.
            void closeRecord(record);
            return { requestId: request.id, ok: true };
          }
          if (['navigate', 'back', 'forward', 'reload'].includes(request.action)) {
            await navigateContents(record, request, operation.controller.signal, request.expiresAt); checkOperation(record, operation);
          }
          const engine = await getEngine(record); checkOperation(record, operation);
          const cancel = () => engine.cancel(request.id); operation.controller.signal.addEventListener('abort', cancel, { once: true });
          try {
            const navigation = ['navigate', 'back', 'forward', 'reload'].includes(request.action);
            const result = await engine.run({ ...request, ...record.owner, ...(navigation ? { action: 'snapshot' } : {}) });
            checkOperation(record, operation); bump(record); return result;
          } finally { operation.controller.signal.removeEventListener('abort', cancel); }
        }).catch(cause => fail(request, cause)).finally(() => {
          record.active.delete(request.id);
          if (record.releaseRequested && !record.active.size) { record.releaseRequested = false; releaseLease(record); }
          else scheduleIdle(record);
        });
        record.requests.set(request.id, { fingerprint, expiresAt: request.expiresAt, promise: pending }); record.tail = pending;
        return pending;
      } catch (cause) { return Promise.resolve(fail(input, cause)); }
    },
    cancel(event, owner, requestId) {
      const record = owned(event, owner), operation = record.active.get(requestId);
      if (!operation) return false; operation.controller.abort(); return true;
    },
    navigate(event, owner, command) {
      const record = owned(event, owner);
      if (!command || !['navigate', 'back', 'forward', 'reload', 'mobile'].includes(command.action)) return Promise.reject(error('BROWSER_REQUEST_INVALID', 'The user navigation command is invalid.'));
      if (record.mode === 'transitioning' || record.active.size) return Promise.reject(error('BROWSER_CONTROL_BUSY', 'Take over this browser before changing an active model task.'));
      if (record.userPending >= 4) return Promise.reject(error('BROWSER_QUEUE_FULL', 'The user navigation queue is busy.'));
      record.userPending += 1;
      const epoch = record.epoch, copied = JSON.parse(JSON.stringify(command));
      const pending = record.tail.catch(() => undefined).then(async () => {
        if (!current(record) || epoch !== record.epoch || record.mode === 'transitioning') throw error('BROWSER_ACTION_EXPIRED', 'The navigation was cancelled by a control transition.');
        await navigateContents(record, copied, undefined, Date.now() + 15_000); bump(record); return stateOf(record);
      }).catch(cause => { setError(record, cause); throw cause; }).finally(() => { record.userPending -= 1; });
      record.tail = pending.catch(() => undefined); return pending;
    },
    takeover(event, owner, bounds) { return transition(owned(event, owner), 'manual', bounds); },
    release(event, owner) { return transition(owned(event, owner), 'background'); },
    resize(event, owner, bounds) {
      const record = owned(event, owner);
      if (record.mode === 'transitioning') throw error('BROWSER_TRANSITION_BUSY', 'The browser control transition has not finished.');
      if (record.mode === 'background') { record.viewport = boundsFor(record, bounds, false); record.holder.setContentSize(record.viewport.width, record.viewport.height); record.view.setBounds(record.viewport); }
      else record.view.setBounds(boundsFor(record, bounds));
      bump(record); return stateOf(record);
    },
    async close(event, owner) { return closeRecord(owned(event, owner)); },
    // Main-only hooks for the EXISTING nextmux:browser release/keepalive
    // handlers. These release automation transports, never manual ownership.
    releaseAutomation(event, conversationId) {
      const host = eventHost(event);
      if (typeof conversationId !== 'string' || !conversationId || conversationId.length > 160) throw deny();
      let released = false;
      for (const record of records.values()) if (record.host === host && record.frame === event.senderFrame && record.owner.conversationId === conversationId) released = releaseLease(record) || released;
      return released;
    },
    keepaliveAutomation(event, conversationIds) {
      const host = eventHost(event);
      if (!Array.isArray(conversationIds) || conversationIds.length > 64 || conversationIds.some(id => typeof id !== 'string' || !id || id.length > 160)) throw deny();
      const ids = new Set(conversationIds); let renewed = 0;
      for (const record of records.values()) if (record.host === host && record.frame === event.senderFrame && ids.has(record.owner.conversationId) && record.engine) { scheduleIdle(record); renewed++; }
      return renewed;
    },
    async dispose() {
      if (disposed) return; disposed = true; app.off('web-contents-created', onCreated);
      for (const off of hosts.values()) off(); hosts.clear();
      await Promise.allSettled([...records.values()].map(closeRecord));
    }
  };
}

module.exports = { createOwnedBrowserRegistry, isRegisteredOwnedBrowserContents };
