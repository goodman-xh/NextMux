#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { connectToNextMuxWorkbench } from './desktop-attachment-file-e2e-harness.mjs';
import { reloadDesktopDocument } from './desktop-cdp-reload.mjs';

/**
 * Real-renderer regression for the light desktop theme.
 *
 * This uses CDP against the running Electron renderer rather than synthetic
 * DOM fixtures. It deliberately restores the previous theme and navigation
 * state so the check never leaves a developer's application reconfigured.
 */

const cdpPort = process.env.NEXTMUX_CDP_PORT || '9222';
const sourceStyleId = 'nextmux-visual-e2e-source-style';
const sourceStyle = await readFile(new URL('../packages/theia-nextmux-extension/src/browser/style/nextmux.css', import.meta.url), 'utf8');
const { socket, call, evaluate } = await connectToNextMuxWorkbench(cdpPort);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const waitFor = async (read, predicate, timeoutMs, label) => {
  const startedAt = Date.now();
  let value;
  while (Date.now() - startedAt < timeoutMs) {
    value = await read();
    if (predicate(value)) return value;
    await wait(120);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(value)}`);
};

const parseColor = value => {
  const source = String(value || '').trim();
  const srgb = source.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+)?\)$/i);
  if (srgb) return srgb.slice(1, 4).map(channel => Math.max(0, Math.min(255, Number(channel) * 255)));
  const channels = source.match(/[\d.]+/g)?.map(Number) || [];
  if (channels.length < 3) throw new Error(`Unsupported computed color: ${value}`);
  return channels.slice(0, 3).map(channel => Math.max(0, Math.min(255, channel)));
};
const luminance = value => {
  const linear = parseColor(value).map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};
const contrast = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

await Promise.all([call('Runtime.enable'), call('Page.enable')]);
await call('Page.bringToFront');

const previous = await evaluate(`({
  preference: localStorage.getItem('nextmux.desktop.theme.v1'),
  theiaTheme: localStorage.getItem('theme'),
  codingVisible: Boolean(document.querySelector('.nmx-task-view')),
  activeSection: document.querySelector('.nmx-titlebar-primary-nav [aria-current="page"]')?.getAttribute('data-desktop-section') || ''
})`);

let failure;
let evidence;
let metricsOverridden = false;
let sourceStyleInjected = false;
try {
  await evaluate(`(() => {
    localStorage.setItem('nextmux.desktop.theme.v1', 'light');
    localStorage.setItem('theme', 'light');
    return true;
  })()`);
  await reloadDesktopDocument({ call, evaluate, ignoreCache: true });
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('.nmx-shell.nmx-theme-light'))`),
    Boolean,
    30_000,
    'the light NextMux shell'
  );
  const sourceStyleEvidence = await evaluate(`(() => {
    document.getElementById(${JSON.stringify(sourceStyleId)})?.remove();
    const style = document.createElement('style');
    style.id = ${JSON.stringify(sourceStyleId)};
    style.textContent = ${JSON.stringify(sourceStyle)};
    document.head.append(style);
    return {
      connected: style.isConnected,
      ruleCount: style.sheet?.cssRules.length || 0,
      byteLength: style.textContent.length
    };
  })()`);
  sourceStyleInjected = true;
  if (!sourceStyleEvidence.connected || sourceStyleEvidence.ruleCount < 100 || sourceStyleEvidence.byteLength !== sourceStyle.length) {
    throw new Error(`The source visual stylesheet was not parsed by the isolated renderer: ${JSON.stringify(sourceStyleEvidence)}`);
  }

  const composerState = await waitFor(
    () => evaluate(`(() => {
    const coding = document.querySelector('[data-desktop-section="coding"]');
    const surface = document.querySelector('.nmx-composer');
    const textarea = surface?.querySelector('textarea:not(:disabled)');
    if (!surface || !textarea) {
      if (coding && coding.getAttribute('aria-current') !== 'page') {
        coding.click();
      } else {
        const session = document.querySelector('.nmx-session-row.is-current .nmx-session-open')
          || document.querySelector('.nmx-session-row .nmx-session-open');
        if (session) session.click();
        else {
          const thread = document.querySelector('.nmx-context-actions > button:first-child');
          if (thread && !thread.classList.contains('is-active')) thread.click();
        }
      }
      return {
        ready: false,
        activeSection: document.querySelector('.nmx-titlebar-primary-nav [aria-current="page"]')?.getAttribute('data-desktop-section') || '',
        threadSelected: Boolean(document.querySelector('.nmx-context-nav > button:first-child.is-active')),
        taskViewPresent: Boolean(document.querySelector('.nmx-task-view'))
      };
    }
    textarea.blur();
    const before = getComputedStyle(surface).borderColor;
    textarea.focus();
    const surfaceStyle = getComputedStyle(surface);
    const inputStyle = getComputedStyle(textarea);
    return {
      ready: true,
      measurement: {
        before,
        after: surfaceStyle.borderColor,
        surfaceOutline: surfaceStyle.outlineStyle,
        inputOutlineWidth: inputStyle.outlineWidth,
        inputBoxShadow: inputStyle.boxShadow
      }
    };
  })()`),
    value => value?.ready === true,
    15_000,
    'the stable coding conversation composer'
  );
  const composer = composerState.measurement;
  if (composer.before !== composer.after
      || composer.surfaceOutline !== 'none'
      || composer.inputOutlineWidth !== '0px'
      || composer.inputBoxShadow !== 'none') {
    throw new Error(`Composer focus introduced a visible frame: ${JSON.stringify(composer)}`);
  }

  const codingTextControls = await evaluate(`(() => {
    const selector = "input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='color']):not([type='file']):not([type='button']):not([type='submit']):not([type='reset']), textarea, select";
    const visible = node => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return !node.disabled && rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    return [...document.querySelectorAll('.nmx-shell ' + selector)].filter(visible).map((control, index) => {
      control.blur();
      const before = getComputedStyle(control);
      const resting = { border: before.borderColor, outline: before.outlineWidth, shadow: before.boxShadow };
      control.focus();
      const focused = getComputedStyle(control);
      return {
        index,
        tag: control.tagName.toLowerCase(),
        type: control.getAttribute('type') || '',
        className: control.className,
        resting,
        focused: { border: focused.borderColor, outline: focused.outlineWidth, shadow: focused.boxShadow }
      };
    });
  })()`);
  const unstableCodingControl = codingTextControls.find(control => control.resting.border !== control.focused.border
    || control.focused.outline !== '0px'
    || control.focused.shadow !== 'none');
  if (unstableCodingControl) {
    throw new Error(`A visible coding text control introduced a focus frame: ${JSON.stringify(unstableCodingControl)}`);
  }

  await evaluate(`(() => {
    const button = document.querySelector('.nmx-titlebar-primary-nav button:first-child');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('.nmx-model-center'))`),
    Boolean,
    15_000,
    'the model center'
  );
  try {
    await waitFor(
      () => evaluate(`(() => {
        const control = document.querySelector('[data-model-center-view="official"]');
        if (!control && !document.querySelector('.nmx-model-center')) {
          document.querySelector('[data-desktop-section="models"]')?.click();
        }
        if (!control && document.querySelector('.nmx-shell.is-context-collapsed')) {
          document.querySelector('[data-context-panel-toggle]')?.click();
        }
        return Boolean(control);
      })()`),
      Boolean,
      15_000,
      'the official-model navigation control'
    );
  } catch (error) {
    const diagnostics = await evaluate(`(() => ({
      shellClass: document.querySelector('.nmx-shell')?.className || '',
      activeSection: document.querySelector('.nmx-titlebar-primary-nav [aria-current="page"]')?.getAttribute('data-desktop-section') || '',
      togglePresent: Boolean(document.querySelector('[data-context-panel-toggle]')),
      contextPresent: Boolean(document.querySelector('#nmx-context-panel')),
      contextText: document.querySelector('#nmx-context-panel')?.textContent?.trim().slice(0, 500) || '',
      modelCenterPresent: Boolean(document.querySelector('.nmx-model-center'))
    }))()`);
    throw new Error(`${error.message} Diagnostics: ${JSON.stringify(diagnostics)}`);
  }
  try {
    await waitFor(
      () => evaluate(`(() => {
        const control = document.querySelector('[data-model-center-view="official"]');
        if (!control) return false;
        if (!control.classList.contains('is-active')) control.click();
        return control.classList.contains('is-active');
      })()`),
      Boolean,
      15_000,
      'the official-model view'
    );
  } catch (error) {
    const diagnostics = await evaluate(`(() => ({
      activeSection: document.querySelector('.nmx-titlebar-primary-nav [aria-current="page"]')?.getAttribute('data-desktop-section') || '',
      modelViews: [...document.querySelectorAll('[data-model-center-view]')].map(node => ({
        view: node.getAttribute('data-model-center-view'), className: node.className,
        connected: node.isConnected, rect: node.getBoundingClientRect().toJSON()
      })),
      shellClass: document.querySelector('.nmx-shell')?.className || '',
      contextPresent: Boolean(document.querySelector('#nmx-context-panel'))
    }))()`);
    throw new Error(`${error.message} Diagnostics: ${JSON.stringify(diagnostics)}`);
  }
  try {
    await waitFor(
      () => evaluate(`(() => {
        const provider = document.querySelector('.nmx-model-center [data-provider-id="custom_openai"]');
        if (provider) return true;
        document.querySelector('[data-model-center-view="official"]')?.click();
        return false;
      })()`),
      Boolean,
      15_000,
      'the compatible API entry point'
    );
  } catch (error) {
    const diagnostics = await evaluate(`(() => ({
      activeSection: document.querySelector('.nmx-titlebar-primary-nav [aria-current="page"]')?.getAttribute('data-desktop-section') || '',
      activeModelView: document.querySelector('[data-model-center-view].is-active')?.getAttribute('data-model-center-view') || '',
      providerIds: [...document.querySelectorAll('.nmx-model-center [data-provider-id]')].map(node => node.getAttribute('data-provider-id')),
      notice: document.querySelector('.nmx-model-center .nmx-catalog-notice')?.textContent?.trim() || '',
      loading: Boolean(document.querySelector('.nmx-model-center .nmx-official-loading')),
      modelCenterText: document.querySelector('.nmx-model-center')?.textContent?.trim().slice(0, 800) || ''
    }))()`);
    throw new Error(`${error.message} Diagnostics: ${JSON.stringify(diagnostics)}`);
  }
  const opened = await evaluate(`(() => {
    const button = document.querySelector('.nmx-model-center [data-provider-id="custom_openai"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!opened) throw new Error('The compatible API entry point is unavailable.');
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('.nmx-official-sheet'))`),
    Boolean,
    15_000,
    'the compatible API drawer'
  );

  const drawer = await evaluate(`(() => {
    const sheet = document.querySelector('.nmx-official-sheet');
    const input = sheet?.querySelector('.nmx-official-form input:not(:disabled)');
    const primary = sheet?.querySelector('.nmx-primary-button');
    if (!sheet || !input || !primary) return null;
    input.blur();
    const inputBefore = getComputedStyle(input).borderColor;
    input.focus();
    const sheetStyle = getComputedStyle(sheet);
    const inputStyle = getComputedStyle(input);
    const primaryStyle = getComputedStyle(primary);
    const rect = sheet.getBoundingClientRect();
    return {
      sheet: {
        background: sheetStyle.backgroundColor,
        color: sheetStyle.color,
        className: sheet.className,
        themeAncestor: Boolean(sheet.closest('.nmx-theme-light')),
        rect: [rect.left, rect.top, rect.right, rect.bottom],
        viewport: [innerWidth, innerHeight]
      },
      input: {
        background: inputStyle.backgroundColor,
        color: inputStyle.color,
        before: inputBefore,
        after: inputStyle.borderColor,
        outlineWidth: inputStyle.outlineWidth,
        boxShadow: inputStyle.boxShadow
      },
      primary: {
        background: primaryStyle.backgroundColor,
        color: primaryStyle.color,
        className: primary.className,
        disabled: primary.disabled,
        opacity: primaryStyle.opacity
      }
    };
  })()`);
  if (!drawer) throw new Error('The compatible API drawer did not expose its production controls.');

  const drawerTextControls = await evaluate(`(() => {
    const sheet = document.querySelector('.nmx-official-sheet');
    if (!sheet) return [];
    const selector = "input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='color']):not([type='file']):not([type='button']):not([type='submit']):not([type='reset']), textarea, select";
    return [...sheet.querySelectorAll(selector)].filter(control => {
      const rect = control.getBoundingClientRect();
      const style = getComputedStyle(control);
      return !control.disabled && rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }).map((control, index) => {
      control.blur();
      const before = getComputedStyle(control);
      const resting = { border: before.borderColor, outline: before.outlineWidth, shadow: before.boxShadow };
      control.focus();
      const focused = getComputedStyle(control);
      return {
        index,
        tag: control.tagName.toLowerCase(),
        type: control.getAttribute('type') || '',
        resting,
        focused: { border: focused.borderColor, outline: focused.outlineWidth, shadow: focused.boxShadow }
      };
    });
  })()`);
  const unstableDrawerControl = drawerTextControls.find(control => control.resting.border !== control.focused.border
    || control.focused.outline !== '0px'
    || control.focused.shadow !== 'none');
  if (unstableDrawerControl) {
    throw new Error(`A compatible API text control introduced a focus frame: ${JSON.stringify(unstableDrawerControl)}`);
  }

  const typographyAndMarkdown = await evaluate(`(() => {
    const shell = document.querySelector('.nmx-shell');
    if (!shell) return null;
    const baselineDocumentOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const fixture = document.createElement('article');
    fixture.className = 'nmx-agent-message';
    fixture.setAttribute('data-nextmux-visual-fixture', 'markdown');
    fixture.style.cssText = 'position:fixed;left:8px;top:48px;width:min(280px,calc(100vw - 32px));max-width:calc(100vw - 32px);visibility:hidden;pointer-events:none;';
    fixture.innerHTML = '<div><div class="nmx-assistant-markdown"><p>Readable prose with an_unbroken_identifier_that_must_not_widen_the_conversation_surface_0123456789.</p><ul><li>First item</li><li>Second item</li></ul><table><thead><tr><th>Column</th><th>Very long heading</th></tr></thead><tbody><tr><td>Value</td><td>unbroken_table_value_abcdefghijklmnopqrstuvwxyz_0123456789</td></tr></tbody></table><pre><code>const extremelyLongIdentifier = "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz";</code></pre></div></div>';
    shell.append(fixture);
    const markdown = fixture.querySelector('.nmx-assistant-markdown');
    const table = fixture.querySelector('table');
    const pre = fixture.querySelector('pre');
    const code = fixture.querySelector('code');
    const result = {
      uiFont: getComputedStyle(shell).fontFamily,
      proseFont: getComputedStyle(markdown).fontFamily,
      codeFont: getComputedStyle(code).fontFamily,
      fixtureWidth: fixture.getBoundingClientRect().width,
      markdownWidth: markdown.getBoundingClientRect().width,
      markdownScrollWidth: markdown.scrollWidth,
      tableWidth: table.getBoundingClientRect().width,
      tableScrollWidth: table.scrollWidth,
      preWidth: pre.getBoundingClientRect().width,
      preScrollWidth: pre.scrollWidth,
      baselineDocumentOverflow,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
    fixture.remove();
    return result;
  })()`);
  if (!typographyAndMarkdown) throw new Error('The Markdown visual fixture could not be mounted.');
  if (!/Microsoft YaHei|PingFang|Segoe UI|SF Pro/i.test(typographyAndMarkdown.uiFont)
      || !/Microsoft YaHei|PingFang|Segoe UI|SF Pro/i.test(typographyAndMarkdown.proseFont)
      || !/Cascadia|SFMono|Menlo|Monaco|Consolas|monospace/i.test(typographyAndMarkdown.codeFont)
      || typographyAndMarkdown.markdownWidth > typographyAndMarkdown.fixtureWidth + 1
      || typographyAndMarkdown.tableWidth > typographyAndMarkdown.markdownWidth + 1
      || typographyAndMarkdown.preWidth > typographyAndMarkdown.markdownWidth + 1
      || typographyAndMarkdown.documentOverflow > typographyAndMarkdown.baselineDocumentOverflow + 1) {
    throw new Error(`Typography or Markdown overflow contract failed: ${JSON.stringify(typographyAndMarkdown)}`);
  }

  const [left, top, right, bottom] = drawer.sheet.rect;
  const [viewportWidth, viewportHeight] = drawer.sheet.viewport;
  const assertions = {
    sheetLight: luminance(drawer.sheet.background) >= 0.68,
    sheetContrast: contrast(drawer.sheet.color, drawer.sheet.background),
    inputLight: luminance(drawer.input.background) >= 0.68,
    inputContrast: contrast(drawer.input.color, drawer.input.background),
    inputFocusStable: drawer.input.before === drawer.input.after
      && drawer.input.outlineWidth === '0px'
      && drawer.input.boxShadow === 'none',
    primaryDark: luminance(drawer.primary.background) <= 0.16,
    primaryContrast: contrast(drawer.primary.color, drawer.primary.background),
    viewportBounded: left >= 0 && top >= 0 && right <= viewportWidth && bottom <= viewportHeight
  };
  if (!assertions.sheetLight
      || assertions.sheetContrast < 4.5
      || !assertions.inputLight
      || assertions.inputContrast < 4.5
      || !assertions.inputFocusStable
      || !assertions.primaryDark
      || assertions.primaryContrast < 4.5
      || !assertions.viewportBounded) {
    throw new Error(`Light-theme visual contract failed: ${JSON.stringify({ assertions, drawer })}`);
  }

  await call('Emulation.setDeviceMetricsOverride', {
    width: 720,
    height: 560,
    deviceScaleFactor: 1,
    mobile: false
  });
  metricsOverridden = true;
  // Device-metrics emulation changes CSS viewport units immediately, while
  // Lumino may schedule its host resize on the next animation frame. Dispatch
  // the same resize signal as a real BrowserWindow resize and wait for the
  // product drawer—not merely innerWidth—to settle inside the viewport.
  await evaluate(`(() => { window.dispatchEvent(new Event('resize')); return true; })()`);
  const compactStartedAt = Date.now();
  const readCompact = () => evaluate(`(() => {
    const sheet = document.querySelector('.nmx-official-sheet');
    if (!sheet) return null;
    const rect = sheet.getBoundingClientRect();
    const controls = [...sheet.querySelectorAll('input, select, textarea, button')].map(control => {
      const controlRect = control.getBoundingClientRect();
      return { left: controlRect.left, right: controlRect.right, width: controlRect.width };
    });
    return {
      rect: [rect.left, rect.top, rect.right, rect.bottom],
      viewport: [innerWidth, innerHeight],
      documentOverflowX: getComputedStyle(document.documentElement).overflowX,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overflowingControls: controls.filter(control => control.left < -1 || control.right > innerWidth + 1)
    };
  })()`);
  const compact = await waitFor(
    readCompact,
    value => Boolean(value)
      && value.rect[0] >= -1
      && value.rect[1] >= -1
      && value.rect[2] <= value.viewport[0] + 1
      && value.rect[3] <= value.viewport[1] + 1
      && value.overflowingControls.length === 0,
    5_000,
    'the compact compatible API drawer to settle inside the viewport'
  );
  compact.settleMs = Date.now() - compactStartedAt;
  if (!compact) throw new Error('The compatible API drawer disappeared during compact viewport verification.');
  const [compactLeft, compactTop, compactRight, compactBottom] = compact.rect;
  const [compactWidth, compactHeight] = compact.viewport;
  if (compactLeft < -1 || compactTop < -1 || compactRight > compactWidth + 1 || compactBottom > compactHeight + 1
      || (compact.documentOverflowX !== 'hidden'
        && compact.documentOverflow > typographyAndMarkdown.baselineDocumentOverflow + 1)
      || compact.overflowingControls.length > 0) {
    throw new Error(`Compact drawer overflow contract failed: ${JSON.stringify(compact)}`);
  }
  await call('Emulation.clearDeviceMetricsOverride');
  metricsOverridden = false;

  evidence = {
    sourceStyleEvidence,
    composer,
    codingTextControls,
    drawer,
    drawerTextControls,
    typographyAndMarkdown,
    compact,
    assertions
  };
} catch (error) {
  failure = error;
} finally {
  try {
    if (metricsOverridden) {
      await call('Emulation.clearDeviceMetricsOverride');
      metricsOverridden = false;
    }
    if (sourceStyleInjected) {
      await evaluate(`document.getElementById(${JSON.stringify(sourceStyleId)})?.remove()`);
      sourceStyleInjected = false;
    }
    await evaluate(`(() => {
      const restore = (key, value) => value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
      restore('nextmux.desktop.theme.v1', ${JSON.stringify(previous.preference)});
      restore('theme', ${JSON.stringify(previous.theiaTheme)});
      return true;
    })()`);
    await reloadDesktopDocument({ call, evaluate, ignoreCache: true });
    await waitFor(
      () => evaluate(`Boolean(document.querySelector('.nmx-shell'))`),
      Boolean,
      30_000,
      'the restored NextMux shell'
    );
    const previousSection = previous.activeSection || (previous.codingVisible ? 'coding' : '');
    if (previousSection) {
      await evaluate(`(() => {
        const control = document.querySelector('[data-desktop-section=${JSON.stringify(previousSection)}]');
        if (control && control.getAttribute('aria-current') !== 'page') control.click();
        return Boolean(control);
      })()`);
      await waitFor(
        () => evaluate(`document.querySelector('[data-desktop-section=${JSON.stringify(previousSection)}]')?.getAttribute('aria-current') === 'page'`),
        Boolean,
        15_000,
        'the restored desktop section'
      );
    }
  } catch (restoreError) {
    failure ||= restoreError;
  }
  socket.close();
}

if (failure) throw failure;
console.log(JSON.stringify({ ok: true, evidence }, null, 2));
