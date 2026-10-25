#!/usr/bin/env node

import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connectToNextMuxWorkbench, runInDisposableAttachmentFileDesktop } from './desktop-attachment-file-e2e-harness.mjs';
import { desktopEditorShortcutPlan } from './desktop-editor-shortcuts.mjs';

const relaunched = await runInDisposableAttachmentFileDesktop(import.meta.url, {
  label: 'file drawer production regression',
  withQaRoute: false,
});

if (!relaunched) await runFileDrawerRegression();

async function runFileDrawerRegression() {
  const port = process.env.NEXTMUX_CDP_PORT || '9222';
  const workspace = process.cwd();
  const stamp = Date.now();
  const prefix = `_nmx_file_preview_${stamp}`;
  const editMarker = `NextMux-editor-E2E-changed-${stamp}`;
  const fixtures = [
    { name: `${prefix}.txt`, marker: `TXT_${stamp}`, content: `TXT_${stamp}\nplain utf-8 文本\n`, language: 'plaintext', editable: true },
    { name: `${prefix}.md`, marker: `MD_${stamp}`, content: `# MD_${stamp}\n\n- markdown\n`, language: 'markdown' },
    { name: `${prefix}.json`, marker: `JSON_${stamp}`, content: `{\n  "marker": "JSON_${stamp}"\n}\n`, language: 'json' },
    { name: `${prefix}.yaml`, marker: `YAML_${stamp}`, content: `marker: YAML_${stamp}\nvalid: true\n`, language: 'yaml' },
    { name: `${prefix}.log`, marker: `LOG_${stamp}`, content: `[info] LOG_${stamp}\n`, language: 'plaintext' },
    { name: `${prefix}-NO_EXTENSION`, marker: `NOEXT_${stamp}`, content: `NOEXT_${stamp}\nno extension utf-8\n`, language: 'plaintext' },
  ];
  const large = {
    name: `${prefix}-large.txt`, marker: `LARGE_${stamp}`,
    endMarker: `LARGE_END_${stamp}`,
    content: `LARGE_${stamp}\n${'0123456789abcdef'.repeat(140_000)}\nLARGE_END_${stamp}\n`,
    language: 'plaintext', large: true,
  };
  const binary = { name: `${prefix}-binary.bin`, bytes: Buffer.from([0, 255, 0, 159, 146, 150, 1, 2, 3, 0]) };
  const allPaths = [...fixtures, large, binary].map(fixture => join(workspace, fixture.name));
  await Promise.all([
    ...fixtures.map(fixture => writeFile(join(workspace, fixture.name), fixture.content, { encoding: 'utf8', flag: 'wx' })),
    writeFile(join(workspace, large.name), large.content, { encoding: 'utf8', flag: 'wx' }),
    writeFile(join(workspace, binary.name), binary.bytes, { flag: 'wx' }),
  ]);

  const { socket, call, evaluate, onEvent } = await connectToNextMuxWorkbench(port);
  const javascriptDialogs = [];
  onEvent(message => {
    if (message.method === 'Page.javascriptDialogOpening') javascriptDialogs.push(message.params);
  });
  const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const expect = (condition, label, value) => {
    if (!condition) throw new Error(`${label}: ${JSON.stringify(value)}`);
  };
  const waitForValue = async (read, predicate, label, timeout = 15_000) => {
    const deadline = Date.now() + timeout;
    let value;
    while (Date.now() < deadline) {
      value = await read();
      if (predicate(value)) return value;
      await pause(100);
    }
    throw new Error(`Timed out: ${label}. Last value: ${JSON.stringify(value)}`);
  };
  const waitFor = (expression, label, timeout = 15_000) => waitForValue(
    () => evaluate(expression), Boolean, label, timeout
  );

  async function center(selector) {
    return waitFor(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node || node.disabled) return null;
      node.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
    })()`, selector);
  }
  async function click(selector) {
    const point = await center(selector);
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await pause(120);
  }
  async function shortcut(action) {
    for (const event of desktopEditorShortcutPlan(action, process.platform)) await call('Input.dispatchKeyEvent', event);
    await pause(150);
  }
  const drawerState = () => evaluate(`(() => {
    const drawer = document.querySelector('.nmx-work-context');
    const tabs = [...(drawer?.querySelectorAll('.nmx-file-editor-tab [role=tab]') || [])];
    const activeTab = tabs.find(node => node.getAttribute('aria-selected') === 'true');
    const tab = activeTab?.querySelector('strong')?.textContent?.trim() || '';
    const tabNames = tabs.map(node => node.querySelector('strong')?.textContent?.trim()).filter(Boolean);
    const activeTabName = activeTab?.querySelector('strong')?.textContent?.trim() || '';
    const selectedFile = drawer?.querySelector('.nmx-context-file-row.is-active')?.getAttribute('aria-label') || '';
    const historyKinds = [...(drawer?.querySelectorAll('[data-history-kind]') || [])].map(node => node.getAttribute('data-history-kind'));
    const error = drawer?.querySelector('.nmx-file-preview-state span')?.textContent?.trim() || '';
    const buttons = [...(drawer?.querySelectorAll('button') || [])].map(button => (button.innerText || button.title || button.getAttribute('aria-label') || '').trim());
    const monacoEditor = drawer?.querySelector('.nmx-monaco-file-editor .monaco-editor');
    return {
      open: Boolean(drawer), tab, tabNames, activeTabName, selectedFile, historyKinds, error,
      editor: Boolean(drawer?.querySelector('.nmx-context-file-preview .nmx-monaco-file-editor .monaco-editor')),
      standardFileList: Boolean(drawer?.querySelector('.nmx-context-file-list')),
      standardEditor: Boolean(drawer?.querySelector('.nmx-context-file-preview')),
      secondaryOpenEditor: buttons.some(label => /open in editor|在编辑器中打开|在編輯器中開啟/i.test(label)),
      modelLanguage: monacoEditor?.getAttribute('data-mode-id') || '',
      visibleText: drawer?.querySelector('.nmx-monaco-file-editor .view-lines')?.innerText || '',
      dirty: Boolean(drawer?.querySelector('.nmx-file-editor-tab em')),
    };
  })()`);
  async function openFixture(fixture, options = {}) {
    const name = fixture.name;
    const clicked = await evaluate(`(() => {
      const row = [...document.querySelectorAll('.nmx-context-file-row, .nmx-thread-file-row')]
        .find(node => node.getAttribute('aria-label') === ${JSON.stringify(name)});
      row?.scrollIntoView({ block: 'center' });
      row?.click();
      return Boolean(row);
    })()`);
    if (!clicked) throw new Error(`File rail does not contain ${name}.`);
    return waitForValue(drawerState, state => options.binary
      ? state.tab === name && state.selectedFile === name && Boolean(state.error) && !state.editor
      : state.tab === name && state.editor && !state.error && state.visibleText.includes(fixture.marker),
    `right drawer for ${name}`, options.large ? 45_000 : 15_000);
  }
  async function activateFileTab(name, expectedText) {
    const found = await evaluate(`(() => {
      const tab = [...document.querySelectorAll('.nmx-file-editor-tab [role=tab]')]
        .find(node => node.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(name)});
      tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); tab?.click(); return Boolean(tab);
    })()`);
    expect(found, 'existing file tab can be selected', name);
    return waitForValue(drawerState, state => state.activeTabName === name && state.editor && state.visibleText.includes(expectedText), `active tab content for ${name}`);
  }
  async function focusEditor() {
    await click('.nmx-monaco-file-editor .monaco-editor');
    await evaluate(`document.querySelector('.nmx-monaco-file-editor .native-edit-context, .nmx-monaco-file-editor textarea')?.focus()`);
  }
  async function editorText() {
    return evaluate(`document.querySelector('.nmx-monaco-file-editor .view-lines')?.innerText || ''`);
  }
  async function waitForDisk(path, expected, label) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (await readFile(path, 'utf8') === expected) return;
      await pause(100);
    }
    throw new Error(`Timed out: ${label}`);
  }

  const evidence = { textFiles: [], largeFile: undefined, binary: undefined, editor: {} };
  let passed = false;
  try {
    await Promise.all([call('Runtime.enable'), call('Page.enable')]);
    await call('Page.bringToFront');
    await call('Emulation.setFocusEmulationEnabled', { enabled: true });
    await call('Page.setWebLifecycleState', { state: 'active' });

    if (!await evaluate(`Boolean(document.querySelector('.nmx-coding-stage'))`)) {
      await waitFor(`Boolean(document.querySelector('[data-desktop-section="coding"]'))`, 'coding navigation');
      await evaluate(`document.querySelector('[data-desktop-section="coding"]')?.click()`);
      await waitFor(`Boolean(document.querySelector('.nmx-coding-stage'))`, 'coding conversation surface');
    }
    await evaluate(`localStorage.removeItem('nextmux.desktop.skipFileOverwriteConfirmation.v1')`);
    await waitFor(`Boolean(document.querySelector('.nmx-thread-files header button:not(:disabled)'))`, 'file rail refresh');
    await evaluate(`document.querySelector('.nmx-thread-files header button:not(:disabled)')?.click()`);
    for (const fixture of [...fixtures, large, binary]) {
      await waitFor(`Boolean([...document.querySelectorAll('.nmx-thread-file-row')]
        .find(node => node.getAttribute('aria-label') === ${JSON.stringify(fixture.name)}))`, `${fixture.name} in file rail`, 20_000);
    }

    for (const fixture of fixtures) {
      const state = await openFixture(fixture);
      expect(state.standardFileList && state.standardEditor, `${fixture.name} uses the standard right drawer`, state);
      expect(!state.secondaryOpenEditor, `${fixture.name} has no second Open in editor entry`, state);
      expect(state.visibleText.includes(fixture.marker), `${fixture.name} opens as UTF-8 text`, state);
      evidence.textFiles.push({ name: fixture.name, expectedLanguage: fixture.language, markerVisible: true, standardDrawer: true });
    }
    // Multiple files stay open as tabs; selecting a tab changes the active editor.
    const firstTab = await openFixture(fixtures[0]);
    const secondTab = await openFixture(fixtures[1]);
    expect(secondTab.tabNames.includes(fixtures[0].name) && secondTab.tabNames.includes(fixtures[1].name), 'file drawer keeps multiple open tabs', secondTab);
    await click(`.nmx-file-editor-tab [role=tab][aria-selected="false"]`);
    const switchedTab = await waitForValue(drawerState, state => state.activeTabName === fixtures[0].name, 'switching to the first file tab');
    expect(switchedTab.tab === fixtures[0].name, 'active tab drives the selected editor', switchedTab);
    evidence.editor.multipleTabs = true;

    const largeState = await openFixture(large, { large: true });
    expect(largeState.standardFileList && largeState.standardEditor && !largeState.secondaryOpenEditor, 'large text stays in the current right editor', largeState);
    await focusEditor();
    await shortcut('documentEnd');
    const largeTail = await waitForValue(drawerState, state => state.visibleText.includes(large.endMarker), 'large text final marker', 20_000);
    expect(large.content.length > 2 * 1024 * 1024, 'large text fixture exceeds the legacy preview limit', large.content.length);
    evidence.largeFile = { name: large.name, bytes: Buffer.byteLength(large.content), endMarkerVisible: true, standardDrawer: true, noSecondEntry: true };

    const binaryState = await openFixture(binary, { binary: true });
    expect(/binary|not.*text|不是.*文本|二进制|非文本|バイナリ/i.test(binaryState.error), 'true binary is rejected with a binary-only message', binaryState);
    expect(!binaryState.editor && !binaryState.secondaryOpenEditor && binaryState.standardFileList && binaryState.standardEditor,
      'binary rejection remains in the current right drawer without a second editor entry', binaryState);
    evidence.binary = { name: binary.name, message: binaryState.error, editorOpened: binaryState.editor, noSecondEntry: true };

    const editable = fixtures.find(fixture => fixture.editable);
    const editablePath = join(workspace, editable.name);
    await openFixture(editable);
    await focusEditor();
    await shortcut('selectAll');
    await call('Input.insertText', { text: editMarker });
    await waitFor(`Boolean(document.querySelector('.nmx-file-editor-tab em'))`, 'dirty marker after edit');
    evidence.editor.dirtyAfterEdit = true;
    await activateFileTab(fixtures[1].name, fixtures[1].marker);
    const returnedDraft = await activateFileTab(editable.name, editMarker);
    expect(returnedDraft.dirty, 'switching tabs preserves unsaved text and its dirty marker', returnedDraft);
    expect(await readFile(editablePath, 'utf8') === editable.content, 'tab switching does not implicitly save the draft');
    evidence.editor.unsavedAcrossTabs = true;
    await focusEditor();

    await shortcut('undo');
    await waitFor(`!document.querySelector('.nmx-file-editor-tab em')`, 'undo clears dirty marker');
    expect(!(await editorText()).includes(editMarker), 'undo restores original editor content', await editorText());
    evidence.editor.undoBeforeSave = true;

    await shortcut('redo');
    await waitFor(`Boolean(document.querySelector('.nmx-file-editor-tab em'))`, 'redo restores dirty marker');
    expect((await editorText()).includes(editMarker), 'redo restores edited content', await editorText());
    evidence.editor.redoBeforeSave = true;

    await shortcut('save');
    await waitForDisk(editablePath, editMarker, 'edited content saved to disk');
    expect(!await evaluate(`Boolean(document.querySelector('.nmx-file-save-confirm'))`),
      'an unchanged disk file saves without a confirmation');
    await waitFor(`!document.querySelector('.nmx-file-editor-tab em')`, 'dirty marker clears after save');
    evidence.editor.savedWithoutPrompt = true;

    await focusEditor();
    await shortcut('undo');
    await waitFor(`Boolean(document.querySelector('.nmx-file-editor-tab em'))`, 'undo after save marks file dirty');
    expect(!(await editorText()).includes(editMarker), 'undo remains available after save', await editorText());
    evidence.editor.undoAfterSave = true;
    await shortcut('redo');
    await waitFor(`!document.querySelector('.nmx-file-editor-tab em')`, 'redo after save returns to saved baseline');
    expect((await editorText()).includes(editMarker), 'redo remains available after save', await editorText());
    evidence.editor.redoAfterSave = true;

    // The timeline is a repeatable VS Code-style history surface. Saving a
    // second edit creates another saved entry; selecting original/saved applies
    // the snapshot to the editor and writes it without a confirmation dialog.
    const secondMarker = `NextMux-editor-E2E-second-${stamp}`;
    await focusEditor();
    await shortcut('selectAll');
    await call('Input.insertText', { text: secondMarker });
    await shortcut('save');
    await waitForDisk(editablePath, secondMarker, 'second edited content saved to disk');
    await waitFor(`!document.querySelector('.nmx-file-editor-tab em')`, 'second save clears dirty marker');
    // Find and replace use the editor's native Cmd/Ctrl bindings on both
    // supported desktop platforms.
    await focusEditor();
    await shortcut('find');
    await shortcut('replace');
    await evaluate(`(() => { const buttons = [...document.querySelectorAll('.nmx-work-context-header-actions > button')]; (buttons.find(button => button.getAttribute('aria-label') && !button.classList.contains('nmx-context-file-back-compat')) || buttons.at(-1))?.click(); })()`);
    await waitFor(`Boolean(document.querySelector('.nmx-context-file-menu[role=menu]'))`, 'file actions menu');
    const menuLabels = await evaluate(` [...document.querySelectorAll('.nmx-context-file-menu [role=menuitem]')].map(node => node.textContent.trim()) `);
    expect(menuLabels.some(label => /save all|全部保存|全部儲存/i.test(label))
      && menuLabels.some(label => /close all|全部关闭|全部關閉/i.test(label))
      && menuLabels.some(label => /left|向左|左侧/i.test(label))
      && menuLabels.some(label => /history|历史|版本|歷史/i.test(label)),
      'file actions menu exposes save-all, close-all, left-display and history', menuLabels);
    await evaluate(` [...document.querySelectorAll('.nmx-context-file-menu [role=menuitem]')].find(node => /history|历史|版本|歷史/i.test(node.textContent))?.click() `);
    await waitFor(`Boolean(document.querySelector('.nmx-context-file-history'))`, 'file history timeline');
    await waitForValue(drawerState, state => state.historyKinds.includes('original') && state.historyKinds.filter(kind => kind === 'saved').length >= 2, 'original and repeated saved history entries');
    const historyKinds = await evaluate(` [...document.querySelectorAll('[data-history-kind]')].map(node => node.getAttribute('data-history-kind')) `);
    expect(historyKinds.includes('current') && historyKinds.includes('original') && historyKinds.filter(kind => kind === 'saved').length >= 2,
      'timeline contains current, original and multiple saved entries', historyKinds);
    evidence.editor.timelineVisible = true;
    const historyScreenshot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(process.env.NEXTMUX_DESKTOP_E2E_PROFILE_DIR, 'logs', 'file-history-ui.png'), Buffer.from(historyScreenshot.data, 'base64'));
    await click('[data-history-kind="original"]');
    await waitForValue(drawerState, state => state.visibleText.includes(fixtures.find(item => item.editable).marker), 'original history restores baseline');
    await waitForDisk(editablePath, editable.content, 'original history snapshot saved without confirmation');
    expect(!await evaluate(`Boolean(document.querySelector('.nmx-file-save-confirm'))`), 'restoring original does not show overwrite confirmation');
    evidence.editor.originalRestored = true;
    await waitFor(`Boolean(document.querySelector('[data-history-kind="saved"]'))`, 'saved history remains selectable after restore');
    await click('[data-history-kind="saved"]');
    await waitForValue(drawerState, state => state.visibleText.includes(secondMarker), 'saved history restores latest snapshot');
    await waitForDisk(editablePath, secondMarker, 'saved history snapshot saved without confirmation');
    await click('[data-history-kind="saved"]');
    await waitForValue(drawerState, state => state.visibleText.includes(secondMarker), 'saved history can be selected repeatedly');
    evidence.editor.savedRestoredRepeatedly = true;
    expect(javascriptDialogs.length === 0, 'history restore does not open native dialogs', javascriptDialogs);

    passed = evidence.textFiles.length === fixtures.length
      && evidence.largeFile.noSecondEntry
      && !evidence.binary.editorOpened
      && Object.values(evidence.editor).every(Boolean)
      && javascriptDialogs.length === 0;
  } finally {
    await Promise.all(allPaths.map(path => rm(path, { force: true })));
    socket.close();
  }

  console.log(JSON.stringify({
    passed,
    disposableProfile: process.env.NEXTMUX_DESKTOP_E2E_PROFILE_DIR,
    javascriptDialogCount: javascriptDialogs.length,
    evidence,
  }, undefined, 2));
  if (!passed) process.exitCode = 1;
}
