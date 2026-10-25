import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

import { OFFICIAL_PROVIDER_PRESETS } from '@nextmux/model-runtime';

import { localizeDesktopSurface, officialModelSurfaceText } from '../lib/browser/nextmux-surface-locale.js';
import { codingSurfaceCatalog } from '../lib/browser/nextmux-coding-surface-locale.js';
import { shellSurfaceCatalog } from '../lib/browser/nextmux-shell-surface-locale.js';
import { modelsSettingsSurfaceCatalog } from '../lib/browser/nextmux-models-settings-surface-locale.js';
import { MEDIA_SURFACE_REVIEWED, MEDIA_SURFACE_LOCALES } from '../lib/browser/nextmux-media-surface-reviewed.js';
import { mediaAuditText } from '../lib/browser/nextmux-media-audit-locale.js';

const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];

test('the reviewed top-up label (zh-CN 残忍充值) is rendered once across all locales, including the actual DOM localization pass', () => {
  const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const klass = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
  const localize = klass.members.find(node => node.name?.getText(file) === 'localizeRenderedSurface').getText(file);
  let topup;
  const visit = node => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'button'
      && node.getText(file).includes('this.openWalletTopup()') && node.getText(file).includes("'立即充值'")) topup = node;
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(topup, 'exercise the actual billing action');
  const literal = topup.openingElement.attributes.properties.some(node => node.name?.getText(file) === 'data-nmx-literal');
  const expected = ['残忍充值', '立即儲值', 'Top up now', 'チャージする', '충전하기', 'Recargar saldo',
    'Ajouter des fonds', 'Guthaben aufladen', 'Adicionar saldo', 'Пополнить баланс', 'إضافة رصيد', 'राशि जोड़ें'];
  for (const [index, locale] of locales.entries()) {
    const text = { data: localizeDesktopSurface(locale, '立即充值'), parentElement: { closest: () => literal ? {} : null } };
    const document = { createTreeWalker: () => { let read = false; return { nextNode: () => read ? null : (read = true, text) }; } };
    // The production walk skips literal/editor subtrees (nextmux-surface-walk.ts); the fixture node is either.
    const forEachSurfaceTextNode = (_root, visit) => { if (!text.parentElement.closest()) visit(text); };
    const isSurfaceLiteral = element => Boolean(element?.closest?.());
    const Harness = new Function('document', 'NodeFilter', 'localizeDesktopSurface', 'queueMicrotask', 'forEachSurfaceTextNode', 'isSurfaceLiteral',
      ts.transpile(`class Harness { ${localize} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))(
        document, { SHOW_TEXT: 4 }, localizeDesktopSurface, fn => fn(), forEachSurfaceTextNode, isSurfaceLiteral);
    const host = Object.assign(new Harness(), { desktopLocale: locale, localizationMutationSuppressionGeneration: 0,
      node: { querySelectorAll: () => [] }, localizedTextNodes: new WeakMap(), localizedAttributes: new WeakMap() });
    host.localizeRenderedSurface(); host.localizeRenderedSurface();
    assert.equal(text.data, expected[index], locale);
  }
});

test('every desktop surface string is present in every shipped locale', () => {
  const sourcePath = fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const catalog = JSON.parse(readFileSync(fileURLToPath(new URL('../src/browser/nextmux-surface-translations.json', import.meta.url)), 'utf8'));
  const directoryCatalog = JSON.parse(readFileSync(fileURLToPath(new URL('../src/browser/nextmux-directory-surface-translations.json', import.meta.url)), 'utf8'));
  const reviewedAdditions = JSON.parse(readFileSync(fileURLToPath(new URL('../src/browser/nextmux-surface-reviewed-additions.json', import.meta.url)), 'utf8'));
  const manualPath = fileURLToPath(new URL('../src/browser/nextmux-surface-locale.ts', import.meta.url));
  const manualFile = ts.createSourceFile(manualPath, readFileSync(manualPath, 'utf8'), ts.ScriptTarget.Latest, true);
  let manualCatalog;
  const readManual = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(manualFile) === 'manual' && ts.isObjectLiteralExpression(node.initializer)) {
      manualCatalog = Object.fromEntries(node.initializer.properties.map(locale => [locale.name.text,
        Object.fromEntries(locale.initializer.properties.map(entry => [entry.name.text, entry.initializer.text]))]));
    }
    ts.forEachChild(node, readManual);
  };
  readManual(manualFile);
  assert.ok(manualCatalog, 'the runtime manual surface overrides must be included in coverage');
  const surfaces = new Set();
  const add = value => {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (/[\u3400-\u9fff]/.test(normalized)) surfaces.add(normalized);
  };
  const visit = node => {
    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text);
    if (ts.isJsxText(node)) add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(surfaces.size > 900, `expected the complete desktop surface, found ${surfaces.size}`);
  for (const locale of locales.filter(locale => locale !== 'zh-CN')) {
    // Manual overrides take precedence at runtime. A generated-only check
    // rejects reviewed translations and can pass stale or incorrect labels.
    const mediaReviewed = Object.fromEntries(Object.entries(MEDIA_SURFACE_REVIEWED).map(([source, row]) => [source, row[MEDIA_SURFACE_LOCALES.indexOf(locale)]]));
    const merged = { ...catalog[locale], ...manualCatalog[locale], ...directoryCatalog[locale], ...shellSurfaceCatalog[locale], ...codingSurfaceCatalog[locale], ...modelsSettingsSurfaceCatalog[locale], ...reviewedAdditions[locale], ...mediaReviewed, 'ElevenLabs 音频': mediaAuditText(locale, 'elevenLabsAudio') };
    const missing = [...surfaces].filter(surface => !String(merged[surface] || '').trim());
    assert.deepEqual(missing, [], `${locale} is missing desktop surface translations`);
    for (const surface of surfaces) {
      assert.equal(localizeDesktopSurface(locale, surface).trim(), merged[surface].trim(), `${locale}:${surface}`);
    }
  }
  const englishWithHanCharacters = [...surfaces].filter(surface => /[\u3400-\u9fff]/.test(localizeDesktopSurface('en', surface)));
  assert.deepEqual(englishWithHanCharacters, []);
});

test('schedule guidance and recovery messages have reviewed translations in all twelve locales', () => {
  const labels = [
    '新建计划',
    '创建计划',
    '按本机时间执行；休眠期间的任务将在恢复后补跑一次，可随时暂停或删除。',
    '请先在对话中选择模型，再创建计划。',
    '计划读取失败',
    '计划读取失败，请重新打开应用；已保存的计划未被覆盖。',
    '计划保存失败，请重试；任务不会自动发送。',
    '上次运行已中断，请查看对话恢复。',
    '该次计划已启动或中断，请查看运行记录；不会重复发送。',
    '计划暂未执行，将自动重试。',
    '模型线路不可用，请更换',
    '任务已中断，请查看运行记录。',
    '任务已取消，可在对话中恢复。',
    '任务已执行结束，但检查未通过。',
    '任务已暂停，请在对话中继续。',
    '应用正在关闭，计划未重新发送；请查看运行记录。',
    '项目文件夹不存在或无法访问，请重新选择。',
    '所选路径不是项目文件夹，请重新选择。'
  ];
  for (const locale of locales) {
    for (const label of labels) {
      const localized = localizeDesktopSurface(locale, label);
      assert.ok(localized.trim(), `${locale}:${label}`);
      if (locale !== 'zh-CN') assert.notEqual(localized, label, `${locale}:${label}`);
      if (locale === 'en') assert.doesNotMatch(localized, /[\u3400-\u9fff]/u, label);
    }
  }
  assert.equal(localizeDesktopSurface('en', '新建计划'), 'New schedule');
  assert.equal(localizeDesktopSurface('de', '新建计划'), 'Neuer Zeitplan');
  assert.equal(localizeDesktopSurface('de', '创建计划'), 'Zeitplan erstellen');
});

test('goal file validation and conflict messages have reviewed translations in all twelve locales', () => {
  const source = readFileSync(new URL('../src/node/nextmux-goal-file.ts', import.meta.url), 'utf8');
  const labels = new Set([
    '目标文件已在其他位置修改，请打开文件查看。',
    '目标文件无法保存',
    '请保留目标文件的元数据，并在“提示词”段落中填写目标。',
    ...Array.from(source.matchAll(/failure\('[A-Z_]+', '([^']+)'\)/g), match => match[1])
  ]);
  assert.equal(labels.size, 11, 'cover every current goal-file validation reason and its UI messages');
  for (const locale of locales) {
    for (const label of labels) {
      const localized = localizeDesktopSurface(locale, label);
      assert.ok(localized.trim(), `${locale}:${label}`);
      assert.doesNotMatch(localized, /NextMux · desktop action/u, `${locale}:${label}`);
      if (locale !== 'zh-CN') assert.notEqual(localized, label, `${locale}:${label}`);
      if (locale === 'en') assert.doesNotMatch(localized, /[\u3400-\u9fff]/u, label);
    }
  }
  assert.equal(localizeDesktopSurface('en', '目标文件已在其他位置修改，请打开文件查看。'),
    'The goal file was changed elsewhere. Open the file to review it.');
  assert.equal(localizeDesktopSurface('en', '目标文件无法保存'), 'Unable to save the goal file');
  assert.equal(localizeDesktopSurface('en', '请保留目标文件的元数据，并在“提示词”段落中填写目标。'),
    'Keep the goal file metadata and enter your goal in the prompt section.');
});

test('dynamic accessibility labels use the selected locale', () => {
  const sourcePath = fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const untranslatedParts = [];
  const visit = node => {
    if (ts.isJsxAttribute(node) && node.name.text === 'aria-label' && ts.isJsxExpression(node.initializer)) {
      const value = node.initializer.expression;
      const parts = ts.isTemplateExpression(value)
        ? [value.head.text, ...value.templateSpans.map(span => span.literal.text)]
        : ts.isNoSubstitutionTemplateLiteral(value) ? [value.text] : [];
      untranslatedParts.push(...parts.filter(part => /[\u3400-\u9fff]/u.test(part)));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.deepEqual(untranslatedParts, []);
  const samples = [
    '跳到第 17 轮：Turn title',
    '关闭 Terminal 1',
    '文件差异 README.md',
    'Provider 线路',
    'Provider 官方连接',
    '移除 file.txt',
    '在 Workspace 中新建对话'
  ];
  for (const locale of locales.filter(candidate => candidate !== 'zh-CN')) {
    for (const sample of samples) {
      const localized = localizeDesktopSurface(locale, sample);
      assert.ok(localized.trim(), `${locale}:${sample}`);
      if (locale !== 'zh-TW' || sample !== '移除 file.txt') assert.notEqual(localized, sample, `${locale}:${sample}`);
    }
  }
  assert.equal(localizeDesktopSurface('en', samples[0]), 'Go to turn 17: Turn title');
  assert.equal(localizeDesktopSurface('en', samples[6]), 'Start a new conversation in Workspace');
  for (const locale of locales) {
    const ended = localizeDesktopSurface(locale, '对话已结束');
    assert.ok(ended.trim(), `${locale}:terminal conversation indicator`);
    if (locale !== 'zh-CN') assert.notEqual(ended, '对话已结束', `${locale}:terminal conversation indicator`);
  }
});

test('conversation directory portal renders translated labels and preserves the path in its accessible name', () => {
  const sourcePath = fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const klass = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
  const method = klass.members.find(node => node.name?.getText(file) === 'renderAttachmentPopoverPortal').getText(file);
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const ReactDOM = { createPortal: element => element };
  const Harness = new Function('React', 'ReactDOM', 'document', 'localizeDesktopSurface', 'narrowAgentPermission',
    ts.transpile(`class Harness { ${method} }; return Harness;`, {
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React
    }))(React, ReactDOM, { body: {} }, localizeDesktopSurface, permission => permission);
  const collect = (node, predicate, result = []) => {
    if (Array.isArray(node)) node.forEach(child => collect(child, predicate, result));
    else if (node && typeof node === 'object') {
      if (predicate(node)) result.push(node);
      collect(node.children, predicate, result);
    }
    return result;
  };
  for (const locale of ['zh-TW', 'en']) {
    const host = Object.assign(new Harness(), {
      desktopLocale: locale,
      codingPopover: 'directories',
      conversationDirectoriesSessionId: 'session-1',
      conversationDirectoriesBusy: false,
      conversationDirectoriesError: '',
      activeCodingSession: () => ({ id: 'session-1', workspacePath: '/tmp/main', permissionMode: 'workspace-write' }),
      conversationWorkspaceBindings: () => [
        { id: 'primary', path: '/tmp/main', status: 'missing' },
        { id: 'secondary', path: '/tmp/secondary', status: 'missing' }
      ],
      conversationDirectoryMutationBlocked: () => false,
      calculateModelPickerPlacement: () => ({ top: 0, left: 0, width: 292, height: 200, maxHeight: 300 }),
      resolvedDesktopTheme: () => 'light',
      permissionLabel: () => 'permission'
    });
    const tree = host.renderAttachmentPopoverPortal();
    const buttons = collect(tree, node => node.type === 'button');
    const unlink = buttons.find(node => String(node.props['aria-label']).includes('/tmp/secondary'));
    assert.ok(unlink, locale);
    assert.ok(unlink.props['aria-label'].endsWith('/tmp/secondary'), locale);
    if (locale === 'en') {
      assert.equal(unlink.props['aria-label'], 'Unlink directory /tmp/secondary');
      const labels = collect(tree, node => node.props && typeof node.props['aria-label'] === 'string')
        .map(node => node.props['aria-label']);
      assert.ok(labels.every(label => !/[\u3400-\u9fff]/u.test(label)), labels.join(' | '));
      const text = collect(tree, node => node.type === 'strong' || node.type === 'small' || node.type === 'p')
        .flatMap(node => node.children).filter(value => typeof value === 'string');
      assert.ok(text.every(value => !/[\u3400-\u9fff]/u.test(value)), text.join(' | '));
    } else {
      assert.equal(unlink.props['aria-label'], '解除目錄綁定 /tmp/secondary');
    }
  }
});

test('attachment action portal renders every action and its accessible name in the selected locale', () => {
  const sourcePath = fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const klass = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
  const method = klass.members.find(node => node.name?.getText(file) === 'renderAttachmentPopoverPortal').getText(file);
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const ReactDOM = { createPortal: element => element };
  const Harness = new Function('React', 'ReactDOM', 'document', 'localizeDesktopSurface', 'narrowAgentPermission',
    ts.transpile(`class Harness { ${method} }; return Harness;`, {
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React
    }))(React, ReactDOM, { body: {} }, localizeDesktopSurface, permission => permission);
  const collect = (node, predicate, result = []) => {
    if (Array.isArray(node)) node.forEach(child => collect(child, predicate, result));
    else if (node && typeof node === 'object') {
      if (predicate(node)) result.push(node);
      collect(node.children, predicate, result);
    }
    return result;
  };
  for (const locale of ['en', 'zh-TW']) {
    const host = Object.assign(new Harness(), {
      desktopLocale: locale, codingPopover: 'attachments', conversationDirectoriesBusy: false,
      activeCodingSession: () => ({ id: 'session-1', workspacePath: '/tmp/main' }),
      conversationDirectoryMutationBlocked: () => false,
      calculateModelPickerPlacement: () => ({ top: 0, left: 0, width: 292, height: 200, maxHeight: 300 }),
      resolvedDesktopTheme: () => 'light'
    });
    const tree = host.renderAttachmentPopoverPortal();
    const section = collect(tree, node => node.type === 'section')[0];
    const strong = collect(tree, node => node.type === 'strong').flatMap(node => node.children).filter(value => typeof value === 'string');
    const descriptions = collect(tree, node => node.type === 'small').flatMap(node => node.children).filter(value => typeof value === 'string');
    if (locale === 'en') {
      assert.equal(section.props['aria-label'], 'Add content');
      assert.deepEqual(strong, ['Add file', 'Add image', 'Send a folder to the model', 'Conversation folders', 'Goal']);
      assert.deepEqual(descriptions, [
        'Text is extracted from documents for the AI; up to 24 MB per file',
        'PNG, JPEG, WebP, GIF, BMP, AVIF and more; large images are compressed',
        'Attaches the folder structure and the contents of its text files',
        'Manage folders used by this conversation',
        'Set a goal in the input to keep working toward it'
      ]);
    } else {
      assert.equal(section.props['aria-label'], '新增內容');
      assert.equal(strong.at(-1), '目標');
      assert.equal(descriptions[0], '文件會擷取文字交給 AI，單個不超過 24 MB');
      assert.equal(descriptions[1], 'PNG、JPEG、WebP、GIF、BMP、AVIF 等，大圖自動壓縮');
      assert.equal(descriptions.at(-1), '在輸入框中設定持續執行的目標工作');
    }
  }
});

test('attachment cache coverage counts render as complete localized sentences', () => {
  const staging = '有 2 个暂存缓存目录，可校验的文件已计入用量，可重试清理。';
  const unavailable = '另有 3 个缓存目录无法安全读取，当前用量不完整，附件清理已暂停。';
  assert.equal(localizeDesktopSurface('zh-CN', staging), staging);
  assert.equal(localizeDesktopSurface('zh-CN', unavailable), unavailable);
  assert.equal(localizeDesktopSurface('en', staging),
    'Staging cache directories (2): verifiable files are included in usage; you can retry cleanup.');
  assert.equal(localizeDesktopSurface('en', unavailable),
    'Additional cache directories that cannot be read safely (3): current usage is incomplete, and attachment cleanup is paused.');
  for (const locale of locales) {
    for (const [source, count] of [[staging, '2'], [unavailable, '3']]) {
      const translated = localizeDesktopSurface(locale, source);
      assert.ok(translated.includes(count), `${locale}:${source}`);
      if (locale !== 'zh-CN') {
        assert.notEqual(translated, source, `${locale}:${source}`);
        if (locale !== 'zh-TW' && locale !== 'ja') {
          assert.doesNotMatch(translated, /[\u3400-\u9fff]/u, `${locale}:${translated}`);
        }
      }
    }
  }
});

test('conversation folder picker uses the selected locale for the native dialog', async () => {
  const sourcePath = fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const klass = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
  const method = klass.members.find(node => node.name?.getText(file) === 'chooseConversationWorkspaceDirectory').getText(file);
  const Harness = new Function('localizeDesktopSurface',
    ts.transpile(`class Harness { ${method} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))(localizeDesktopSurface);
  for (const locale of ['zh-TW', 'en']) {
    const calls = [];
    const host = Object.assign(new Harness(), {
      desktopLocale: locale,
      conversationDirectoriesSessionId: 'session-1', activeCodingSessionId: 'session-1',
      codingPopover: 'directories', codingSessions: [{ id: 'session-1', workspacePath: '/tmp/main', permissionMode: 'workspace-write' }],
      conversationDirectoriesBusy: false, conversationWorkspaceBindings: () => [],
      conversationDirectoryMutationBlocked: () => false, update: () => {},
      fileDialogService: { showOpenDialog: async options => { calls.push(options); return undefined; } }
    });
    await host.chooseConversationWorkspaceDirectory();
    assert.equal(calls.length, 1, locale);
    assert.equal(calls[0].title, locale === 'en' ? 'Add a folder to this conversation' : '為目前對話新增目錄', locale);
    assert.equal(calls[0].openLabel, locale === 'en' ? 'Add folder' : '新增目錄', locale);
  }
});

test('deep desktop surfaces have a complete locale entry', () => {
  for (const locale of locales) {
    const title = localizeDesktopSurface(locale, '素材与任务');
    const action = localizeDesktopSurface(locale, '今天想完成什么？');
    assert.ok(title.trim(), locale);
    assert.ok(action.trim(), locale);
    if (locale !== 'zh-CN') {
      assert.notEqual(title, '素材与任务', locale);
      assert.notEqual(action, '今天想完成什么？', locale);
    }
  }
});

test('dynamic and originally English desktop labels use the selected locale', () => {
  assert.equal(localizeDesktopSurface('en', '3 场景 · 8 镜头'), '3 scenes · 8 shots');
  assert.equal(localizeDesktopSurface('zh-CN', '2 scenes · 5 shots · JSON'), '2 场景 · 5 镜头 · JSON');
  assert.equal(localizeDesktopSurface('ja', 'FFmpeg unavailable'), 'FFmpeg 利用不可');
  assert.equal(localizeDesktopSurface('ja', 'FFmpeg unavailable · JSON'), 'FFmpeg 利用不可 · JSON');
  assert.equal(localizeDesktopSurface('zh-CN', 'Local project file · JSON'), '本地工程文件 · JSON');
  assert.equal(localizeDesktopSurface('ar', 'Local project file'), 'ملف مشروع محلي');
  assert.equal(localizeDesktopSurface('zh-TW', '服务在线'), '服務上線');
  assert.equal(localizeDesktopSurface('zh-TW', '返回模型选择'), '返回模型選擇');
});

test('dynamic paths stay unchanged in every locale after the cache exceeds its capacity', () => {
  for (const locale of locales) {
    for (let index = 0; index < 4_200; index += 1) {
      const path = `C:/workspace/packages/feature-${index}/index.ts`;
      assert.equal(localizeDesktopSurface(locale, path), path);
    }
    assert.equal(localizeDesktopSurface(locale, 'C:/workspace/packages/feature-0/index.ts'),
      'C:/workspace/packages/feature-0/index.ts');
  }
});

test('official model discovery counts render as complete locale-aware phrases', () => {
  assert.equal(officialModelSurfaceText('en', 'savedConnectionCount', { count: '3' }), '3 connections');
  assert.equal(officialModelSurfaceText('en', 'modelCount', { count: '2' }), '2 models');
  assert.equal(officialModelSurfaceText('en', 'dynamicModelCount', { count: '2' }), '2 discovered models');
  assert.equal(
    officialModelSurfaceText('en', 'discoverySuccess', { count: '2' }),
    'Read 2 models from this API. Models not returned remain unavailable.'
  );
  assert.equal(officialModelSurfaceText('en', 'expandAllProviders', { count: '15' }), 'Show all 15 providers');
  assert.equal(officialModelSurfaceText('en', 'collapseProviders', { count: '15' }), 'Collapse providers');
  for (const locale of locales) {
    for (const key of ['savedConnectionCount', 'modelCount', 'dynamicModelCount', 'discoverySuccess', 'expandAllProviders']) {
      const value = officialModelSurfaceText(locale, key, { count: '7' });
      assert.match(value, /7/);
      assert.doesNotMatch(value, /\{count\}/);
      if (locale === 'en') assert.doesNotMatch(value, /[㐀-鿿]/u, `${locale}:${key}`);
      if (locale !== 'zh-CN') {
        assert.notEqual(value, officialModelSurfaceText('zh-CN', key, { count: '7' }), `${locale}:${key}`);
      }
    }
    const collapsed = officialModelSurfaceText(locale, 'collapseProviders', { count: '7' });
    assert.ok(collapsed.trim(), `${locale}:collapseProviders`);
    assert.doesNotMatch(collapsed, /\{count\}/);
    if (locale === 'en') assert.doesNotMatch(collapsed, /[㐀-鿿]/u);
  }
});

test('comic production views are localized in every supported locale', () => {
  const labels = ['分镜台', '工作流', '素材库', '时间线', '镜头工作流', '连续性检查', '全片时间线'];
  for (const locale of locales) {
    for (const label of labels) {
      const localized = localizeDesktopSurface(locale, label);
      assert.ok(localized.trim(), `${locale}:${label}`);
      if (locale !== 'zh-CN') assert.notEqual(localized, label, `${locale}:${label}`);
    }
  }
});

test('comic revision-history actions rendered outside the desktop widget use the selected locale', () => {
  const source = readFileSync(new URL('../src/browser/nextmux-comic-history-archive-actions.tsx', import.meta.url), 'utf8');
  for (const label of ['备份修订历史', '恢复修订历史']) {
    assert.ok(source.includes(`>${label}</button>`), `${label} is a rendered action`);
    for (const locale of locales.filter(candidate => candidate !== 'zh-CN')) {
      const localized = localizeDesktopSurface(locale, label);
      assert.ok(localized.trim(), `${locale}:${label}`);
      assert.notEqual(localized, label, `${locale}:${label}`);
      if (locale === 'en') assert.doesNotMatch(localized, /[\u3400-\u9fff]/u);
    }
  }
  assert.equal(localizeDesktopSurface('en', '备份修订历史'), 'Back up revision history');
  assert.equal(localizeDesktopSurface('en', '恢复修订历史'), 'Restore revision history');
});

test('provider descriptions and connection guidance follow the selected locale', () => {
  const surfaces = OFFICIAL_PROVIDER_PRESETS.flatMap(provider => [provider.description, provider.connectionNote]);
  for (const locale of locales.filter(candidate => candidate !== 'zh-CN')) {
    for (const surface of surfaces) {
      const localized = localizeDesktopSurface(locale, surface);
      assert.ok(localized.trim(), `${locale}:${surface}`);
      if (locale !== 'zh-TW') assert.notEqual(localized, surface, `${locale}:${surface}`);
    }
  }
  const ollamaNote = OFFICIAL_PROVIDER_PRESETS.find(provider => provider.id === 'ollama')?.connectionNote;
  assert.ok(ollamaNote, 'the Ollama preset has connection guidance');
  const english = localizeDesktopSurface('en', ollamaNote);
  assert.match(english, /loopback address/i);
  assert.match(english, /no API key/i);
  assert.match(english, /system proxy/i);
  assert.doesNotMatch(english, /[\u3400-\u9fff]/u);
  const traditionalChinese = localizeDesktopSurface('zh-TW', ollamaNote);
  assert.match(traditionalChinese, /回環位址/);
  assert.doesNotMatch(traditionalChinese, /回环地址/);
});

test('localizing dynamic desktop labels stays within the interactive render budget', () => {
  localizeDesktopSurface('en', 'C:/workspace/warmup.txt');
  const startedAt = performance.now();
  for (let index = 0; index < 2_000; index += 1) {
    localizeDesktopSurface('en', `C:/workspace/packages/feature-${index}/index.ts`);
  }
  const elapsed = performance.now() - startedAt;
  assert.ok(elapsed < 120, `2,000 dynamic labels took ${elapsed.toFixed(1)}ms to localize`);
});
