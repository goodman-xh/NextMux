'use strict';

const browserError = (code, message, params = {}) => Object.assign(new Error(message), { code, params });
const { randomUUID } = require('node:crypto');
const { realpath, stat } = require('node:fs/promises');
const { relative, isAbsolute, sep } = require('node:path');

/** Puppeteer's public transport, scoped to one Electron guest. No debug socket,
 * new browser, browser-global discovery, or model-supplied JavaScript. */
class GuestTransport {
  constructor(contents, info) {
    this.contents = contents;
    this.info = { ...info, type: 'page', browserContextId: undefined };
    this.sessions = new Set(); this.closed = false; this.attached = false;
    this.listener = (_event, method, params, sessionId) => {
      if (sessionId && !this.sessions.has(sessionId)) return;
      if (method === 'Target.attachedToTarget') this.sessions.add(params.sessionId);
      this.emit({ method, params, sessionId: sessionId || 'nextmux-guest' });
      if (method === 'Target.detachedFromTarget') this.sessions.delete(params.sessionId);
    };
    this.detached = () => this.close();
    contents.debugger.on('message', this.listener);
    contents.debugger.on('detach', this.detached);
  }
  emit(message) { if (!this.closed) this.onmessage?.(JSON.stringify(message)); }
  send(raw) {
    const message = JSON.parse(raw);
    void this.dispatch(message).then(result => this.emit({ id: message.id, result, sessionId: message.sessionId }),
      error => this.emit({ id: message.id, error: { code: -32000, message: error.message }, sessionId: message.sessionId }));
  }
  async dispatch({ method, params = {}, sessionId }) {
    if (this.closed || this.contents.isDestroyed()) throw Error('Browser tab closed');
    if (!sessionId) {
      if (method === 'Target.getBrowserContexts') return { browserContextIds: [] };
      if (method === 'Target.getTargets') return { targetInfos: [this.info] };
      if (method === 'Target.setDiscoverTargets') {
        this.emit({ method: 'Target.targetCreated', params: { targetInfo: this.info } }); return {};
      }
      if (method === 'Target.setAutoAttach') {
        if (!this.attached) {
          this.attached = true;
          this.emit({ method: 'Target.attachedToTarget', params: { sessionId: 'nextmux-guest', targetInfo: this.info, waitingForDebugger: false } });
        }
        return {};
      }
      if (method === 'Browser.getVersion') return this.contents.debugger.sendCommand(method, params);
      // Public page.createCDPSession may only reattach this same guest.
      if (method === 'Target.attachToTarget' && params.targetId === this.info.targetId) return { sessionId: 'nextmux-guest' };
      throw Error('Browser-global operation is not allowed');
    }
    if (sessionId !== 'nextmux-guest' && !this.sessions.has(sessionId)) throw Error('Foreign browser session');
    if (method.startsWith('Browser.') || ['Target.createTarget', 'Target.closeTarget', 'Target.getTargets', 'Target.setDiscoverTargets', 'Target.attachToBrowserTarget'].includes(method)) throw Error('Browser-global operation is not allowed');
    if (method === 'Target.attachToTarget') throw Error('Cross-tab attach is not allowed');
    return this.contents.debugger.sendCommand(method, params, sessionId === 'nextmux-guest' ? undefined : sessionId);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.contents.debugger.off('message', this.listener); this.contents.debugger.off('detach', this.detached);
    if (!this.contents.isDestroyed() && this.contents.debugger.isAttached()) this.contents.debugger.detach();
    this.onclose?.();
  }
}

const elementName = element => {
  const labelled = (element.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => element.ownerDocument.getElementById(id)?.textContent || '').join(' ');
  const labels = Array.from(element.labels || []).map(label => label.textContent).join(' ');
  return (element.getAttribute('aria-label') || labelled || labels || element.getAttribute('alt') || element.getAttribute('title')
    || element.getAttribute('placeholder') || element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160);
};
// Serialized into the page by Puppeteer. Form state is bounded and password /
// verification-code values are never read into the model-visible snapshot.
const snapshotElementState = (el, maxValue = 2000) => {
  const state = { role: el.getAttribute('role') || el.tagName.toLowerCase(),
    disabled: el.matches(':disabled,[aria-disabled="true"]'), readonly: el.matches('[readonly],[aria-readonly="true"]') };
  if (el.matches('[ondrop],[ondragover],[data-dropzone],[dropzone]') || typeof el.ondrop === 'function' || typeof el.ondragover === 'function') state.dropTarget = true;
  const input = el.tagName === 'INPUT';
  if (input) state.inputType = el.type;
  const protectedValue = input && (['password', 'hidden'].includes(el.type)
    || /\b(?:current-password|new-password|one-time-code)\b/i.test(el.autocomplete || ''));
  if (protectedValue) state.valueRedacted = true;
  else if (input && el.type === 'file') state.files = Array.from(el.files || []).slice(0, 8).map(file => ({ name: file.name.slice(0, 256), size: file.size }));
  else if (input || ['TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) {
    const value = String(el.isContentEditable ? el.textContent || '' : el.value ?? '');
    state.value = value.slice(0, maxValue);
    if (value.length > maxValue) state.valueTruncated = true;
    if (input && ['checkbox', 'radio'].includes(el.type)) state.checked = el.checked;
  }
  if (el.tagName === 'SELECT') {
    state.options = Array.from(el.options).slice(0, 30).map(option => ({ value: option.value, label: option.label, selected: option.selected }));
    state.selectedValues = Array.from(el.selectedOptions).slice(0, 30).map(option => option.value);
  }
  return state;
};
// This predicate runs in Puppeteer's isolated world. Real pointer events are
// dispatched by Puppeteer; an overlay is not bypassed with element.click().
const actionable = element => {
  if (!element.isConnected || element.matches(':disabled,[aria-disabled="true"],[inert]') || element.closest('[inert]')) return false;
  const bounds = element.getBoundingClientRect(), style = getComputedStyle(element);
  if (!bounds.width || !bounds.height || style.visibility === 'hidden' || style.display === 'none') return false;
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const rect = element.getBoundingClientRect();
  let root = element.getRootNode();
  let hit = root.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
  while (hit && hit.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return !!hit && (hit === element || element.contains(hit) || Boolean(element.shadowRoot && element.shadowRoot.contains(hit)));
};

// A successful pointer dispatch is not a successful navigation. Observe the
// owned guest only, including Electron policy vetoes that CDP click accepts.
// Buttons without navigation return immediately; only an already-started
// main-frame navigation receives a bounded wait. Never retry the input.
class ClickNavigationObservation {
  constructor(contents) {
    this.contents = contents; this.listeners = []; this.state = { status: 'not-observed', scope: 'main-frame' };
    this.closed = false;
    const listen = (name, listener) => { contents.on?.(name, listener); this.listeners.push([name, listener]); };
    const set = value => { if (!this.closed) { this.state = { scope: 'main-frame', ...value }; this.changed?.(); } };
    listen('did-start-navigation', (event, url, _inPlace, main) => {
      if ((event?.isMainFrame ?? main) === false) return;
      set({ status: 'pending', url: event?.url ?? url });
    });
    const policy = (event, url, _inPlace, main) => {
      if ((event?.isMainFrame ?? main) === false) return;
      const destination = event?.url ?? url;
      if (this.state.status === 'pending') set({ status: 'pending', url: destination });
      // Later listeners can still veto the event. Read it after all synchronous
      // handlers have run, without adding or removing any security handler.
      queueMicrotask(() => { if (event?.defaultPrevented) set({ status: 'blocked', url: destination, reason: 'navigation-policy' }); });
    };
    listen('will-navigate', policy); listen('will-redirect', policy);
    const committed = (event, url, _code, _status) => set({ status: 'committed', url: event?.url ?? url });
    listen('did-navigate', committed);
    listen('did-navigate-in-page', (event, url, main) => { if ((event?.isMainFrame ?? main) !== false) committed(event, url); });
    const failed = (event, code, description, url, main) => {
      if ((event?.isMainFrame ?? main) === false || this.state.status !== 'pending') return;
      const destination = event?.validatedURL ?? url;
      if (destination !== this.state.url) return;
      const errorCode = event?.errorCode ?? code;
      set({ status: errorCode === -3 ? 'cancelled' : 'failed', url: destination, errorCode,
        description: String(event?.errorDescription ?? description ?? '').slice(0, 160) });
    };
    listen('did-fail-load', failed); listen('did-fail-provisional-load', failed);
  }
  async settle({ signal, expiresAt = Infinity, timeoutMs = 5000 } = {}) {
    if (this.state.status !== 'pending' || signal?.aborted) return { ...this.state };
    await new Promise(resolve => {
      let timer;
      const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); this.changed = undefined; resolve(); };
      this.changed = () => { if (this.closed || this.state.status !== 'pending') done(); };
      signal?.addEventListener('abort', done, { once: true });
      timer = setTimeout(done, Math.max(0, Math.min(timeoutMs, expiresAt - Date.now())));
      if (signal?.aborted || this.state.status !== 'pending') done();
    });
    return { ...this.state };
  }
  dispose() {
    this.closed = true;
    for (const [name, listener] of this.listeners) this.contents.off?.(name, listener);
    this.listeners.length = 0; this.changed?.();
  }
}

class GuestAutomation {
  static async create(contents) {
    if (contents.debugger.isAttached()) throw browserError('BROWSER_TAB_DEBUGGING', 'This tab is being debugged. Close DevTools and retry.');
    contents.debugger.attach('1.3');
    let transport;
    try {
      const { targetInfo } = await contents.debugger.sendCommand('Target.getTargetInfo');
      transport = new GuestTransport(contents, targetInfo);
      const { connect } = await import('puppeteer-core');
      const browser = await connect({ transport, defaultViewport: null, protocolTimeout: 10_000 });
      const pages = await browser.pages();
      if (pages.length !== 1) throw browserError('BROWSER_ATTACH_FAILED', 'Could not attach to the specified browser tab.');
      return new GuestAutomation(contents, browser, pages[0], transport);
    } catch (error) { if (transport) transport.close(); else contents.debugger.detach(); throw error; }
  }
  constructor(contents, browser, page, transport) {
    this.contents = contents; this.browser = browser; this.page = page; this.transport = transport;
    this.refs = new Map(); this.frames = new Map(); this.refsGeneration = 0; this.operations = new Map(); this.requests = new Map(); this.tail = Promise.resolve();
    this.invalidate = () => void this.clearRefs();
    page.on('framenavigated', this.invalidate); page.on('framedetached', this.invalidate);
  }
  async clearRefs() {
    this.refsGeneration += 1;
    const refs = [...this.refs.values()]; this.refs.clear(); this.frames.clear();
    await Promise.all(refs.map(item => item.handle.dispose().catch(() => undefined)));
  }
  async dispose() {
    for (const controller of this.operations.values()) controller.abort();
    await this.clearRefs(); await this.browser.disconnect().catch(() => undefined); this.transport.close();
  }
  cancel(id) { this.operations.get(id)?.abort(); }
  async snapshot({ signal, expiresAt = Infinity, timeoutMs = 8000, frameTimeoutMs = 2000 } = {}) {
    // Invalidating refs is synchronous. CDP disposal may itself be blocked by
    // the page, so do not wait for old handles before observing the new page.
    void this.clearRefs();
    const generation = this.refsGeneration, deadline = Math.min(expiresAt, Date.now() + timeoutMs);
    const snapshotId = randomUUID(), frames = [], elements = [], refs = new Map(), frameTargets = new Map();
    let committed = false;
    const dispose = handle => { if (handle) void Promise.resolve().then(() => handle.dispose()).catch(() => undefined); };
    const check = () => {
      if (signal?.aborted || Date.now() >= expiresAt) throw browserError('BROWSER_ACTION_EXPIRED', 'The browser action was cancelled or expired. Read the page to verify which actions completed.');
      if (generation !== this.refsGeneration) throw browserError('BROWSER_FRAME_CHANGED', 'The page frame changed. Read a new browser.snapshot.');
    };
    const observe = (operation, frameDeadline, abandoned) => new Promise((resolve, reject) => {
      let settled = false, timer;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); callback(value);
      };
      const abort = () => finish(reject, browserError('BROWSER_ACTION_EXPIRED', 'The browser action was cancelled or expired. Read the page to verify which actions completed.'));
      const stopAt = Math.min(deadline, frameDeadline);
      try { check(); if (Date.now() >= stopAt) throw browserError('BROWSER_SNAPSHOT_TIMEOUT', 'The page observation budget was exhausted.'); }
      catch (error) { finish(reject, error); return; }
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => finish(reject, browserError('BROWSER_SNAPSHOT_TIMEOUT', 'The page observation budget was exhausted.')), Math.max(1, stopAt - Date.now()));
      // Racing a CDP call does not cancel it. Dispose any handles that arrive
      // after the budget/cancellation, and never let that call publish refs.
      Promise.resolve().then(() => { check(); return operation(); }).then(value => {
        if (!settled) {
          try { check(); if (Date.now() >= stopAt) throw browserError('BROWSER_SNAPSHOT_TIMEOUT', 'The page observation budget was exhausted.'); }
          catch (error) { finish(reject, error); }
        }
        if (settled) { if (abandoned) void Promise.resolve().then(() => abandoned(value)).catch(() => undefined); }
        else finish(resolve, value);
      }, error => finish(reject, error));
    });
    let remainingText = 12_000, remainingValues = 8_000, truncated = false;
    const mainFrame = this.page.mainFrame(), allFrames = this.page.frames();
    const orderedFrames = [mainFrame, ...allFrames.filter(frame => frame !== mainFrame)].filter(Boolean);
    try {
      for (const [index, frame] of orderedFrames.slice(0, 24).entries()) {
        check();
        if (Date.now() >= deadline) { truncated = true; break; }
        if (frame.detached) continue;
        const frameId = `${snapshotId}f${index + 1}`, frameDeadline = Math.min(deadline, Date.now() + frameTimeoutMs);
        let list, handles;
        try {
          const info = await observe(() => frame.evaluate(max => ({ title: document.title, text: (document.body?.innerText || '').slice(0, max) }), Math.min(remainingText, 4000)), frameDeadline);
          remainingText -= info.text.length;
          frames.push({ frameId, url: frame.url(), ...info, main: frame === mainFrame });
          frameTargets.set(frameId, frame);
          if (elements.length >= 100) { truncated = true; continue; }
          list = await observe(() => frame.evaluateHandle(max => {
            const matches = [], visit = root => {
              for (const element of root.querySelectorAll('*')) {
                if (matches.length >= max) return;
                const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
                if ((element.matches('input[type="file"]') || rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none')
                  && (element.matches('a[href],button,input,textarea,select,summary,[role="button"],[role="link"],[role="checkbox"],[role="textbox"],[contenteditable="true"],[tabindex],[draggable="true"],[ondrop],[ondragover],[data-dropzone],[dropzone]')
                    || typeof element.ondrop === 'function' || typeof element.ondragover === 'function')) matches.push(element);
                if (element.shadowRoot) visit(element.shadowRoot);
              }
            }; visit(document); return matches;
          }, 101 - elements.length), frameDeadline, dispose);
          const properties = await observe(() => list.getProperties(), frameDeadline, late => { for (const handle of late.values()) dispose(handle); });
          handles = new Set(properties.values());
          for (const handle of properties.values()) {
            const element = handle.asElement();
            if (!element || elements.length >= 100) { truncated = true; dispose(handle); handles.delete(handle); continue; }
            const name = await observe(() => element.evaluate(elementName), frameDeadline);
            const meta = await observe(() => element.evaluate(snapshotElementState, Math.min(remainingValues, 2000)), frameDeadline);
            remainingValues -= meta.value?.length || 0;
            if (meta.valueTruncated) truncated = true;
            const ref = `${snapshotId}e${elements.length + 1}`;
            refs.set(ref, { handle: element, frame, name }); elements.push({ ref, frameId, name, ...meta }); handles.delete(handle);
          }
        } catch (error) {
          if (['BROWSER_ACTION_EXPIRED', 'BROWSER_FRAME_CHANGED'].includes(error.code)) throw error;
          if (frame.detached) continue;
          const existing = frames.find(item => item.frameId === frameId);
          if (existing) existing.unavailable = true; else frames.push({ frameId, url: frame.url(), unavailable: true });
          frameTargets.set(frameId, frame);
          truncated = true;
        } finally {
          dispose(list); if (handles) for (const handle of handles) dispose(handle);
        }
      }
      check();
      for (const [ref, value] of refs) this.refs.set(ref, value);
      for (const [frameId, frame] of frameTargets) this.frames.set(frameId, frame);
      committed = true;
      return { engine: 'puppeteer', snapshotId, url: this.page.url(), title: frames.find(frame => frame.main)?.title || this.contents.getTitle?.() || '', frames, elements,
        truncated: truncated || allFrames.length > frames.length, scope: 'owned-tab-and-child-frames' };
    } finally { if (!committed) for (const item of refs.values()) dispose(item.handle); }
  }
  async frameAncestors(frame, timeout, signal) {
    // A child document cannot see an overlay in its parent's document. Check
    // each owning frame with the same mature locator wait before acting inside.
    for (let child = frame; child?.parentFrame(); child = child.parentFrame()) {
      const owner = await child.frameElement();
      if (!owner) throw browserError('BROWSER_FRAME_CHANGED', 'The page frame changed. Read a new browser.snapshot.');
      let ready;
      try { ready = await owner.asLocator().setTimeout(timeout).filter(actionable).waitHandle({ signal }); }
      finally { await ready?.dispose(); await owner.dispose(); }
    }
  }
  async target(request, prefix = '', signal) {
    const ref = request[prefix ? 'targetRef' : 'ref'], selector = request[prefix ? 'targetSelector' : 'selector'];
    if (!!ref === !!selector) throw browserError('BROWSER_TARGET_REQUIRED', 'Provide a ref from the latest snapshot or a unique selector.');
    const timeout = Math.max(100, Math.min(8000, request.timeoutMs || 5000));
    // Custom upload controls commonly use an invisible input. uploadFile sets
    // the file chooser directly; it must not pretend to click that input.
    const upload = request.action === 'upload';
    const ready = upload ? el => el.isConnected && el.matches('input[type="file"]') && !el.matches(':disabled,[aria-disabled="true"]') : actionable;
    if (ref) {
      const item = this.refs.get(ref);
      if (!item || item.frame.detached || !await item.handle.evaluate(el => el.isConnected) || await item.handle.evaluate(elementName) !== item.name) throw browserError('BROWSER_STALE_REFERENCE', 'The element reference is stale. Read a new browser.snapshot.');
      if (!upload) await this.frameAncestors(item.frame, timeout, signal);
      return item.handle.asLocator().setTimeout(timeout).filter(ready);
    }
    const frameId = request[prefix ? 'targetFrameId' : 'frameId'];
    const frame = frameId ? this.frames.get(frameId) : this.page.mainFrame();
    if (!frame || frame.detached) throw browserError('BROWSER_FRAME_CHANGED', 'The page frame changed. Read a new browser.snapshot.');
    if (!upload) await this.frameAncestors(frame, timeout, signal);
    const matches = await frame.$$(selector);
    await Promise.all(matches.map(handle => handle.dispose()));
    if (matches.length > 1) throw browserError('BROWSER_AMBIGUOUS_SELECTOR', 'The selector matches multiple elements. Use a unique ref.');
    return frame.locator(selector).setTimeout(timeout).filter(ready);
  }
  run(request) {
    // Renderer retries with one backend request ID must never click twice.
    const existing = this.requests.get(request.id);
    if (existing) return existing;
    const controller = new AbortController(); this.operations.set(request.id, controller);
    const pending = this.tail.catch(() => undefined).then(() => this.execute(request, controller));
    const settled = pending.finally(() => this.operations.delete(request.id));
    this.requests.set(request.id, settled);
    while (this.requests.size > 128) {
      const completed = [...this.requests.keys()].find(id => !this.operations.has(id));
      if (!completed) break;
      this.requests.delete(completed);
    }
    this.tail = settled; return settled;
  }
  async execute(request, controller) {
    const signal = controller.signal;
    let navigation;
    // Electron's default is throttled. Without the getter, restore that default
    // rather than leaving a hidden guest rendering at full frame rate.
    const throttling = this.contents.getBackgroundThrottling?.() ?? true;
    // Only an active tool operation needs animation frames for locator stability.
    // Restore the guest's normal background throttling as soon as it settles.
    this.contents.setBackgroundThrottling?.(false);
    const check = () => { if (signal.aborted || Date.now() >= request.expiresAt) throw browserError('BROWSER_ACTION_EXPIRED', 'The browser action was cancelled or expired. Read the page to verify which actions completed.'); };
    const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(15_000, request.expiresAt - Date.now())));
    try {
      check();
      if (request.action === 'snapshot') {
        const data = await this.snapshot({ signal, expiresAt: request.expiresAt }); check();
        return { requestId: request.id, ok: true, data };
      }
      const locator = await this.target(request, '', signal); check();
      if (request.action === 'click') {
        navigation = new ClickNavigationObservation(this.contents);
        await locator.click({ signal }); check();
        await navigation.settle({ signal, expiresAt: request.expiresAt }); check();
      }
      else if (request.action === 'fill') {
        const fillable = locator.filter(el => !el.matches('[readonly],[aria-readonly="true"]'));
        const text = request.text || '';
        const needsKeyboard = text.length > 0 && text.length < 100 && await fillable.map(el => el.isContentEditable || el.tagName === 'TEXTAREA'
          || (el.tagName === 'INPUT' && ['text', 'url', 'tel', 'search', 'password', 'number', 'email'].includes(el.type))).wait({ signal });
        check();
        if (needsKeyboard) { await fillable.click({ signal }); check(); }
        // Short text uses Puppeteer's keyboard path, so first activate the
        // actual guest input with its normal actionable, stable click. In a
        // background webview a second rAF stability wait can stall after that
        // click. Filling uses no pointer coordinates; retain all other locator
        // checks (including a new overlay or readonly state after the click).
        await (needsKeyboard ? fillable.setWaitForStableBoundingBox(false) : fillable).fill(text, { signal });
        const handle = await locator.waitHandle({ signal });
        try {
          let retained = await handle.evaluate(el => 'value' in el ? el.value : el.textContent);
          if (retained !== text) {
            await handle.evaluate((el, val) => {
              if ('value' in el) {
                const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                if (setter) setter.call(el, val);
                else el.value = val;
              } else if (el.isContentEditable) {
                el.textContent = val;
              }
              el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: val, inputType: 'insertText' }));
              el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            }, text);
            retained = await handle.evaluate(el => 'value' in el ? el.value : el.textContent);
          }
          if (retained !== text) throw browserError('BROWSER_VALUE_NOT_RETAINED', 'The page did not retain the entered value. Check the form state.');
        } finally { await handle.dispose(); }
      } else if (request.action === 'select') {
        const handle = await locator.waitHandle({ signal });
        try { check(); const selected = await handle.select(...request.values); if (selected.length !== request.values.length) throw browserError('BROWSER_OPTIONS_UNAVAILABLE', 'Some options are unavailable. Read the page again.'); }
        finally { await handle.dispose(); }
      } else if (request.action === 'upload') {
        const root = await realpath(request.workspaceRoot); const files = [];
        let bytes = 0;
        for (const path of request.paths) {
          const canonical = await realpath(path), delta = relative(root, canonical), info = await stat(canonical);
          if (!delta || isAbsolute(delta) || delta === '..' || delta.startsWith(`..${sep}`) || !info.isFile()) throw browserError('BROWSER_UPLOAD_OUTSIDE_PROJECT', 'Only regular files within this project may be uploaded.');
          bytes += info.size; if (bytes > 32 * 1024 * 1024) throw browserError('BROWSER_UPLOAD_TOO_LARGE', 'The total upload size exceeds 32 MiB.'); files.push(canonical);
        }
        const handle = await locator.waitHandle({ signal });
        try { check(); await handle.uploadFile(...files); } finally { await handle.dispose(); }
      } else if (request.action === 'drag') {
        const target = await this.target(request, 'target', signal);
        const from = await locator.waitHandle({ signal }), to = await target.waitHandle({ signal });
        try { check(); await this.page.setDragInterception(true); await from.dragAndDrop(to, { delay: 100 }); }
        finally { await this.page.setDragInterception(false).catch(() => undefined); await from.dispose(); await to.dispose(); }
      } else throw browserError('BROWSER_ACTION_UNSUPPORTED', 'This page action is not supported.');
      check();
      let snapshot;
      try { snapshot = await this.snapshot({ signal, expiresAt: request.expiresAt }); }
      catch (error) {
        // Electron may report a committed navigation before Puppeteer's frame
        // event arrives. Re-observe once using fresh refs; never reissue click.
        if (!navigation || error.code !== 'BROWSER_FRAME_CHANGED') throw error;
        check(); snapshot = await this.snapshot({ signal, expiresAt: request.expiresAt });
      }
      check();
      return { requestId: request.id, ok: true, data: { action: request.action,
        verification: navigation ? 'browser-input-dispatched-and-page-observed' : 'browser-action-completed-and-page-observed',
        ...(navigation ? { navigation: { ...navigation.state } } : {}), snapshot } };
    } catch (error) {
      if (error.code === 'BROWSER_ACTION_EXPIRED') void this.clearRefs();
      return { requestId: request.id, ok: false, code: typeof error.code === 'string' && error.code.startsWith('BROWSER_') ? error.code : 'BROWSER_TOOL_FAILED', params: error.params || {}, message: `${error.message || 'The browser action failed.'} Read the page to verify its state before repeating the action.`.slice(0, 400) };
    }
    finally {
      navigation?.dispose();
      clearTimeout(timer);
      if (this.contents.setBackgroundThrottling && !this.contents.isDestroyed?.()) this.contents.setBackgroundThrottling(throttling);
    }
  }
}

// A debugger-attached guest forwards every CDP event (frames, network, runtime)
// to the main process. The renderer detaches a conversation's tabs when its run
// ends (primary path). This lease is the fallback when that never arrives; it
// is long and renewed by the renderer's keepalive while the run is active, so
// snapshot refs survive a model thinking for minutes between steps.
const GUEST_IDLE_RELEASE_MS = 15 * 60_000;

function registerBrowserAutomation({ ipcMain, webContents, session, trustedMainFrame, ownedRegistry, idleReleaseMs = GUEST_IDLE_RELEASE_MS }) {
  // Ownership (conversation/tab/project) lives until the guest is destroyed;
  // only the CDP attachment is released when idle or when the run ends.
  const guests = new Map();
  const detach = record => {
    clearTimeout(record.idleTimer); record.idleTimer = undefined;
    const engine = record.engine; record.engine = undefined;
    if (!engine) return false;
    // Disposal (refs, puppeteer disconnect, debugger detach) is asynchronous.
    // A re-attach must wait for it, or it sees the old debugger still attached.
    const disposing = engine.then(value => value.dispose()).catch(() => undefined)
      .finally(() => { if (record.disposing === disposing) record.disposing = undefined; });
    record.disposing = disposing;
    return true;
  };
  const scheduleIdle = (id, record) => {
    clearTimeout(record.idleTimer); record.idleTimer = undefined;
    if (record.active || !record.engine || guests.get(id) !== record) return;
    record.idleTimer = setTimeout(() => { record.idleTimer = undefined; if (!record.active) detach(record); }, Math.max(1, idleReleaseMs));
    record.idleTimer.unref?.();
  };
  const owned = (event, id) => {
    if (!trustedMainFrame(event) || !Number.isSafeInteger(id)) throw browserError('BROWSER_REQUEST_DENIED', 'This browser request is not allowed.');
    const contents = webContents.fromId(id);
    if (!contents || contents.isDestroyed() || contents.getType() !== 'webview' || contents.hostWebContents !== event.sender
      || contents.session !== session.fromPartition('persist:nextmux-browser')) throw browserError('BROWSER_FOREIGN_WINDOW', 'This browser tab does not belong to the current window.');
    return contents;
  };
  ipcMain.handle('nextmux:browser:action', async (event, id, request) => {
    try {
      const contents = owned(event, id);
      if (!request || typeof request.id !== 'string' || request.id.length > 80 || typeof request.conversationId !== 'string'
        || !request.conversationId || typeof request.browserId !== 'string' || !request.browserId || typeof request.workspaceRoot !== 'string'
        || !Number.isFinite(request.expiresAt) || request.expiresAt <= Date.now() || request.expiresAt > Date.now() + 60_000
        || !['snapshot', 'click', 'fill', 'select', 'upload', 'drag'].includes(request.action) || JSON.stringify(request).length > 20_000) throw browserError('BROWSER_REQUEST_INVALID', 'The browser request is invalid or expired.');
      for (const key of ['ref', 'targetRef', 'frameId', 'targetFrameId', 'selector', 'targetSelector']) if (request[key] !== undefined && (typeof request[key] !== 'string' || request[key].length > 500)) throw browserError('BROWSER_TARGET_INVALID', 'The browser target is invalid.');
      if (request.text !== undefined && (typeof request.text !== 'string' || request.text.length > 8000)) throw browserError('BROWSER_TEXT_TOO_LONG', 'The input text is too long.');
      if (request.action === 'select' && (!Array.isArray(request.values) || !request.values.length || request.values.length > 30 || request.values.some(value => typeof value !== 'string' || value.length > 500))) throw browserError('BROWSER_OPTIONS_INVALID', 'The selected options are invalid.');
      if (request.action === 'upload' && (!Array.isArray(request.paths) || !request.paths.length || request.paths.length > 8 || request.paths.some(path => typeof path !== 'string' || path.length > 4096))) throw browserError('BROWSER_UPLOAD_INVALID', 'The upload files are invalid.');
      let record = guests.get(id);
      if (record && (record.owner !== request.conversationId || record.browserId !== request.browserId || record.workspaceRoot !== request.workspaceRoot)) throw browserError('BROWSER_FOREIGN_CONVERSATION', 'The browser tab belongs to another conversation or project.');
      if (!record) {
        record = { owner: request.conversationId, browserId: request.browserId, workspaceRoot: request.workspaceRoot, host: event.sender, active: 0 };
        guests.set(id, record);
        const created = record;
        contents.once('destroyed', () => { if (guests.get(id) === created) guests.delete(id); detach(created); });
      }
      record.active += 1; record.releaseRequested = false; clearTimeout(record.idleTimer); record.idleTimer = undefined;
      try {
        const disposing = record.disposing;
        const pending = record.engine ||= disposing ? disposing.then(() => GuestAutomation.create(contents)) : GuestAutomation.create(contents);
        let engine;
        try { engine = await pending; } catch (error) { if (record.engine === pending) record.engine = undefined; throw error; }
        return await engine.run(request);
      } finally {
        record.active -= 1;
        // The run ended while this action was still in flight: release now instead of after the idle lease (audit A21-08).
        if (record.releaseRequested && !record.active) { record.releaseRequested = false; detach(record); } else scheduleIdle(id, record);
      }
    } catch (error) { return { requestId: request?.id || '', ok: false, code: typeof error.code === 'string' && error.code.startsWith('BROWSER_') ? error.code : 'BROWSER_TOOL_FAILED', params: error.params || {}, message: error.message || 'The browser action failed.' }; }
  });
  ipcMain.handle('nextmux:browser:cancel', async (event, id, requestId) => {
    try { owned(event, id); const record = guests.get(id); if (record?.engine) (await record.engine).cancel(requestId); return true; } catch { return false; }
  });
  // Conversation end: detach every guest this renderer attached for it.
  ipcMain.handle('nextmux:browser:release', (event, conversationId) => {
    if (!trustedMainFrame(event) || typeof conversationId !== 'string' || !conversationId) return false;
    let released = false;
    for (const record of guests.values()) {
      if (record.owner !== conversationId || record.host !== event.sender) continue;
      if (record.active) record.releaseRequested = true;
      else released = detach(record) || released;
    }
    // The same existing lease event also covers new owned views. This does
    // not call ownedBrowser.release(), which transfers manual page ownership.
    try { released = ownedRegistry?.releaseAutomation(event, conversationId) || released; } catch { /* unchanged legacy result for rejected owned scope */ }
    return released;
  });
  ipcMain.handle('nextmux:browser:keepalive', (event, conversationIds) => {
    if (!trustedMainFrame(event) || !Array.isArray(conversationIds) || conversationIds.length > 64) return 0;
    const live = new Set(conversationIds.filter(value => typeof value === 'string' && value));
    let renewed = 0;
    for (const [id, record] of guests) if (live.has(record.owner) && record.host === event.sender && record.engine) { scheduleIdle(id, record); renewed += 1; }
    try { renewed += ownedRegistry?.keepaliveAutomation(event, [...live]) || 0; } catch { /* keep legacy leases independently valid */ }
    return renewed;
  });
  return { guests };
}
module.exports = { GuestTransport, GuestAutomation, ClickNavigationObservation, registerBrowserAutomation, snapshotElementState };
