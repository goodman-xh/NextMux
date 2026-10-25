import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DesktopDomainError, domainMessageFromError } from '../lib/common/nextmux-domain-errors.js';
import { desktopStatus, desktopStatusEnglish } from '../lib/common/nextmux-desktop-status.js';
import { desktopDomainFailure, desktopDomainMessage, officialCredentialHint } from '../lib/browser/nextmux-domain-error-locale.js';
import { modelFailure, modelFailureText } from '../lib/browser/nextmux-model-errors.js';
import { localizeDesktopSurface } from '../lib/browser/nextmux-surface-locale.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];

test('desktop statuses cover all 12 locales with parameters and no raw-text fallback', () => {
  for (const code of Object.keys(desktopStatusEnglish)) {
    for (const locale of locales) {
      const text = desktopDomainMessage(locale, desktopStatus(code, { count: 7 }));
      assert.ok(text.length > 0, `${locale}/${code}`);
      assert.doesNotMatch(text, /\{\w+\}/, `${locale}/${code}`);
      if (!['en', 'DESKTOP_DETAILS'].includes(locale === 'en' ? 'en' : code)) {
        assert.notEqual(text, desktopStatusEnglish[code], `${locale}/${code}`);
      }
    }
  }
  assert.equal(desktopDomainMessage('en', desktopStatus('GIT_CHANGES', { count: 7 })), 'Local changes: 7');
});

test('RPC serialization retains reason and parameters and local failures never become model failures', () => {
  const failure = new DesktopDomainError('SITE_SCRIPT_NOT_FOUND', 'The project does not contain this site script.', { script: '用户脚本' }, 'raw diagnostic');
  const wire = JSON.parse(JSON.stringify({ code: failure.code, data: failure.data, message: failure.message }));
  assert.equal(domainMessageFromError(wire).params.script, '用户脚本');
  for (const locale of locales) {
    const view = desktopDomainFailure(locale, wire);
    assert.ok(view.text);
    assert.equal(view.detail, 'raw diagnostic');
    assert.doesNotMatch(view.text, /raw diagnostic|用户脚本/);
    assert.equal(modelFailureText(locale, wire), view.text);
    assert.equal(modelFailure(locale, wire).domain, 'operation');
  }
});

test('unknown desktop diagnostics stay in details in every language', () => {
  for (const locale of locales) {
    const result = desktopDomainFailure(locale, new Error('Untranslated vendor diagnostic /private/example'));
    assert.doesNotMatch(result.text, /vendor|\/private/);
    assert.match(result.detail, /vendor diagnostic/);
  }
});

test('credential hints use source metadata, preserve masked keys, and never translate user data', () => {
  for (const locale of locales) {
    assert.equal(officialCredentialHint(locale, { providerId: 'ollama', keyHint: '本机服务 · 无需密钥' }), desktopDomainMessage(locale, desktopStatus('CREDENTIAL_LOCAL')));
    assert.equal(officialCredentialHint(locale, { providerId: 'bedrock', providerSettings: { credentialSource: 'environment' }, keyHint: '系统环境凭据' }), desktopDomainMessage(locale, desktopStatus('CREDENTIAL_ENVIRONMENT')));
    assert.equal(officialCredentialHint(locale, { keyHint: '•••• test' }), '•••• test');
  }
});

test('Git and site services return semantic status, independent of presentation language', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-wp4-status-'));
  try {
    const service = new NextMuxPlatformServiceImpl();
    service.workspaceDirectory = async () => root;
    const git = await service.getWorkspaceGitState(root);
    assert.equal(git.repository, false);
    assert.equal(git.statusMessage.code, 'GIT_NOT_REPOSITORY');
    const empty = await service.getWorkspaceSiteState(root);
    assert.equal(empty.statusMessage.code, 'SITE_NO_SCRIPTS');
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
    const site = await service.getWorkspaceSiteState(root);
    assert.equal(site.statusMessage.code, 'SITE_SCRIPTS');
    assert.equal(site.statusMessage.params.count, 1);
    await assert.rejects(service.startWorkspaceSite(root, 'invalid script'), error => {
      assert.equal(error.code, 'INVALID_SITE_SCRIPT');
      assert.equal(error.data.domainError.code, 'INVALID_SITE_SCRIPT');
      return true;
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('same schedule compatibility code retains distinct validation reasons through RPC', async () => {
  const service = new NextMuxPlatformServiceImpl();
  service.loadDesktopScheduledTasks = async () => [];
  const base = { id: '11111111-1111-4111-8111-111111111111', workspacePath: '/tmp' };
  await assert.rejects(service.upsertDesktopScheduledTask(base), error => {
    assert.equal(error.code, 'INVALID_SCHEDULE');
    assert.equal(error.data.domainError.code, 'SCHEDULE_FIELDS_REQUIRED');
    for (const locale of locales) assert.ok(desktopDomainFailure(locale, { code: error.code, data: error.data }).text.length);
    return true;
  });
});

test('reviewed ordinary UI gaps have real translations without changing user strings', () => {
  for (const locale of locales.filter(locale => locale !== 'zh-CN')) {
    assert.notEqual(localizeDesktopSurface(locale, '设置要持续完成的目标任务'), '设置要持续完成的目标任务', locale);
  }
  assert.equal(localizeDesktopSurface('pt-BR', '能力'), 'Capacidades');
});

test('legacy code-only failures never print unresolved parameter names', () => {
  for (const locale of locales) {
    assert.doesNotMatch(desktopDomainFailure(locale, { code: 'STOCK_KEY_REJECTED' }).text, /\{provider\}/);
    assert.doesNotMatch(desktopDomainFailure(locale, { code: 'SKILL_BODY_TOO_LARGE' }).text, /\{limitBytes\}/);
  }
});

test('a full local managed-session pool is an operation failure, not a model outage', () => {
  const error = new DesktopDomainError('MANAGED_SESSION_CAPACITY', 'Local session slots are busy.');
  for (const locale of locales) {
    const failure = modelFailure(locale, { code: error.code, data: error.data, status: 503 });
    assert.equal(failure.domain, 'operation');
    assert.equal(failure.text, desktopDomainFailure(locale, error).text);
    assert.notEqual(failure.text, desktopDomainMessage(locale, desktopStatus('DESKTOP_OPERATION_FAILED')));
  }
});

test('editing a schedule time clears its previous semantic run result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-wp4-schedule-'));
  try {
    const service = new NextMuxPlatformServiceImpl();
    service.nextmuxDataRoot = () => root;
    service.registerDesktopScheduledTask = async () => ({ registered: false, mode: 'app_open', message: 'Runs while the app is open.' });
    const first = await service.upsertDesktopScheduledTask({
      id: '11111111-1111-4111-8111-111111111111', workspacePath: root,
      title: 'User schedule', prompt: 'User instructions', cadence: 'daily', runAt: '09:00', enabled: true, createdAt: Date.now(),
      modelRoute: { kind: 'official_connection', connectionId: 'test', model: 'test' }, permissionMode: 'read_only'
    });
    await service.saveDesktopScheduledTasks({ upsert: [{ ...first, lastStatus: 'complete', lastMessage: 'Old result', lastMessageDescriptor: desktopStatus('SCHEDULE_COMPLETE') }], remove: [] });
    const [saved] = await service.loadDesktopScheduledTasks();
    const edited = await service.upsertDesktopScheduledTask({ ...saved, runAt: '10:00' }, saved.definitionRevision);
    assert.equal(edited.lastStatus, 'idle');
    assert.equal(edited.lastMessage, undefined);
    assert.equal(edited.lastMessageDescriptor, undefined);
    assert.equal(edited.prompt, 'User instructions');
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('schedule folder failures keep distinct reasons in all 12 locales', () => {
  for (const locale of locales) {
    const missing = desktopDomainFailure(locale, new DesktopDomainError('SCHEDULE_WORKSPACE_UNAVAILABLE', 'Missing folder'));
    const file = desktopDomainFailure(locale, new DesktopDomainError('SCHEDULE_WORKSPACE_NOT_DIRECTORY', 'Path is a file'));
    const generic = desktopDomainMessage(locale, desktopStatus('DESKTOP_OPERATION_FAILED'));
    assert.notEqual(missing.text, generic, locale);
    assert.notEqual(file.text, generic, locale);
    assert.notEqual(file.text, missing.text, locale);
  }
});
