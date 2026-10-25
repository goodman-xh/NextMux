#!/usr/bin/env node

import fs from 'node:fs/promises';

const [, , command = 'audit', value] = process.argv;
const cdpPort = process.env.NEXTMUX_CDP_PORT
  || '9222';
const targets = await fetch(`http://127.0.0.1:${cdpPort}/json`).then(response => response.json());
const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
if (!page) {
  throw new Error(`No Electron page is available on CDP port ${cdpPort}. Start the desktop app with --remote-debugging-port=${cdpPort} first.`);
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const events = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(message.error.message));
    } else {
      resolve(message.result);
    }
  } else if (message.method) {
    events.push(message);
  }
});

function call(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const response = await call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  }
  return response.result?.value;
}

if (command === 'bounds') {
  const match = /^(\d{3,5})x(\d{3,5})$/.exec(value || '');
  if (!match) throw new Error('Bounds must use WIDTHxHEIGHT.');
  const width = Number(match[1]);
  const height = Number(match[2]);
  await evaluate(`window.resizeTo(${width}, ${height})`);
  console.log(JSON.stringify({ width, height }, undefined, 2));
} else if (command === 'activate') {
  await call('Page.enable');
  await call('Page.bringToFront');
  await call('Emulation.setFocusEmulationEnabled', { enabled: true });
  await call('Page.setWebLifecycleState', { state: 'active' });
  console.log(JSON.stringify(await evaluate(`({ visibility: document.visibilityState, focused: document.hasFocus() })`), undefined, 2));
} else if (command === 'diagnose') {
  await Promise.all([
    call('Runtime.enable'),
    call('Log.enable'),
    call('Network.enable'),
    call('Page.enable')
  ]);
  await call('Page.reload', { ignoreCache: true });
  await new Promise(resolve => setTimeout(resolve, Number(value || 10000)));
  const report = events
    .filter(event => {
      if (event.method === 'Runtime.exceptionThrown') return true;
      if (event.method === 'Runtime.consoleAPICalled') {
        return ['error', 'assert', 'warning'].includes(event.params.type);
      }
      if (event.method === 'Log.entryAdded') {
        return ['error', 'warning'].includes(event.params.entry?.level);
      }
      if (event.method === 'Network.loadingFailed') {
        return !event.params.canceled;
      }
      return false;
    })
    .map(event => {
      if (event.method === 'Runtime.consoleAPICalled') {
        return {
          method: event.method,
          level: event.params.type,
          text: event.params.args.map(argument => argument.value ?? argument.description ?? '').join(' ')
        };
      }
      if (event.method === 'Runtime.exceptionThrown') {
        return {
          method: event.method,
          text: event.params.exceptionDetails?.exception?.description ?? event.params.exceptionDetails?.text
        };
      }
      if (event.method === 'Log.entryAdded') {
        return {
          method: event.method,
          level: event.params.entry?.level,
          text: event.params.entry?.text,
          url: event.params.entry?.url
        };
      }
      return {
        method: event.method,
        type: event.params.type,
        errorText: event.params.errorText,
        blockedReason: event.params.blockedReason
      };
    });
  console.log(JSON.stringify(report, undefined, 2));
} else if (command === 'eval') {
  console.log(JSON.stringify(await evaluate(value || 'document.title'), undefined, 2));
} else if (command === 'click') {
  const label = JSON.stringify(value || '');
  const result = await evaluate(`(() => {
    const label = ${label};
    const candidates = [...document.querySelectorAll('button, [role="button"]')]
      .filter(node => {
        const text = node.textContent.trim().replace(/\\s+/g, ' ');
        return node.getAttribute('aria-label') === label
          || node.getAttribute('title') === label
          || text === label;
      });
    if (candidates.length !== 1) {
      return {
        clicked: false,
        label,
        reason: candidates.length ? 'ambiguous exact label' : 'exact label not found',
        matches: candidates.map(node => ({
          ariaLabel: node.getAttribute('aria-label'),
          title: node.getAttribute('title'),
          text: node.textContent.trim().replace(/\\s+/g, ' ').slice(0, 120)
        }))
      };
    }
    const [element] = candidates;
    element.click();
    return { clicked: true, label, className: element.className };
  })()`);
  console.log(JSON.stringify(result, undefined, 2));
} else if (command === 'hover') {
  const selector = JSON.stringify(value || '');
  const target = await evaluate(`(() => {
    const element = document.querySelector(${selector});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + Math.min(rect.height / 2, 24) };
  })()`);
  if (!target) throw new Error(`Unable to hover ${value || ''}`);
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
  await new Promise(resolve => setTimeout(resolve, 180));
  console.log(JSON.stringify({ hovered: true, selector: value, ...target }, undefined, 2));
} else if (command === 'type') {
  await call('Page.bringToFront');
  const target = await evaluate(`(() => {
    const element = document.querySelector('.nmx-composer textarea:not(:disabled), textarea:focus, input:focus');
    if (!element) return { focused: false };
    element.focus();
    element.select?.();
    return { focused: true, tagName: element.tagName };
  })()`);
  if (!target.focused) {
    throw new Error('No editable desktop composer is available.');
  }
  await call('Input.insertText', { text: value || '' });
  console.log(JSON.stringify({ ...target, typed: true }, undefined, 2));
} else if (command === 'terminal-type') {
  await call('Page.bringToFront');
  const target = await evaluate(`(() => {
    const element = document.querySelector('.nmx-terminal-host .xterm-helper-textarea');
    if (!element) return { focused: false };
    element.focus();
    return { focused: document.activeElement === element };
  })()`);
  if (!target.focused) {
    throw new Error('No active conversation terminal is available.');
  }
  await call('Input.insertText', { text: value || '' });
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  console.log(JSON.stringify({ ...target, submitted: true }, undefined, 2));
} else if (command === 'shortcut') {
  const parts = String(value || '').toLowerCase().split('+').filter(Boolean);
  const key = parts.at(-1) || '';
  const modifiers = (parts.includes('alt') ? 1 : 0)
    | (parts.includes('ctrl') || parts.includes('control') ? 2 : 0)
    | (parts.includes('meta') || parts.includes('cmd') ? 4 : 0)
    | (parts.includes('shift') ? 8 : 0);
  const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
  const virtualKeyCode = key.length === 1 ? key.toUpperCase().charCodeAt(0) : key === 'enter' ? 13 : 0;
  await call('Page.bringToFront');
  if (modifiers & 2) {
    await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Control', code: 'ControlLeft', modifiers: 2, windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 });
  }
  if (modifiers & 8) {
    await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', modifiers, windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16 });
  }
  await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, modifiers, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode });
  if (modifiers & 8) {
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', modifiers: modifiers & ~8, windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16 });
  }
  if (modifiers & 2) {
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', modifiers: 0, windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 });
  }
  console.log(JSON.stringify({ shortcut: value, modifiers }, undefined, 2));
} else if (command === 'screenshot') {
  const output = value || 'artifacts/desktop-cdp.png';
  await call('Page.enable');
  const { data } = await call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true
  });
  await fs.writeFile(output, Buffer.from(data, 'base64'));
  console.log(output);
} else {
  const audit = await evaluate(`(() => ({
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    projectWidget: Boolean(document.querySelector('.nmx-desktop-widget')),
    railLabels: [...document.querySelectorAll('.nmx-rail-button')].map(node => node.textContent.trim().replace(/\\s+/g, ' ')),
    activeRail: document.querySelector('.nmx-rail-button.is-active')?.textContent.trim().replace(/\\s+/g, ' '),
    heading: document.querySelector('.nmx-workspace h2')?.textContent.trim(),
    theiaSidebars: [...document.querySelectorAll('.theia-app-sidebar-container')].map(node => ({
      width: getComputedStyle(node).width,
      background: getComputedStyle(node).backgroundColor
    })),
    topPanel: (() => {
      const node = document.querySelector('#theia-top-panel');
      return node ? { background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color } : null;
    })()
  }))()`);
  console.log(JSON.stringify(audit, undefined, 2));
}

socket.close();
