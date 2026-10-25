import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const widget = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');

test('settings owns no duplicate model-management or media-runtime destination', () => {
  const settingsNav = widget.match(/nmx-context-nav nmx-settings-nav[\s\S]*?<\/nav>/)?.[0] || '';
  assert.doesNotMatch(settingsNav, /settingsButton\('(official|managed|routing|media)'/);
  assert.doesNotMatch(widget, /settingsPanel === '(official|managed|routing|media)'/);
  assert.match(widget, /打开模型中心/);
});

test('legacy model deny-lists are removed and cannot filter discovered source models', () => {
  assert.match(widget, /removeItem\('nextmux\.desktop\.disabledCodingModels\.v1'\)/);
  assert.match(widget, /removeItem\('nextmux\.desktop\.disabledComicModels\.v1'\)/);
  assert.doesNotMatch(widget, /disabledCodingModelIds|disabledComicModelIds/);
});

test('local-data scope is explicit', () => {
  assert.match(widget, /完整对话记录', '本机所有项目/);
  assert.match(widget, /conversation_attachments: \['对话附件（受控缓存）', '已登记的项目缓存与应用自有对话缓存', 'files', 'managed'\]/);
  assert.match(widget, /category === 'conversation_attachments' \? '已纳入管理的缓存目录'/);
  assert.match(widget, /确认删除全部/);
});

test('the network & proxy page is retired: settings follow the system proxy with no hidden manual mode', async () => {
  const settingsNav = widget.match(/nmx-context-nav nmx-settings-nav[\s\S]*?<\/nav>/)?.[0] || '';
  assert.doesNotMatch(settingsNav, /settingsButton\('(network|general)'/);
  assert.doesNotMatch(widget, /settingsPanel === '(network|general)'/);
  assert.doesNotMatch(widget, /saveNetworkSettings|testNetworkSettings|networkDraft|代理模式|手动代理/);
  const protocol = readFileSync(fileURLToPath(new URL('../src/common/nextmux-platform-protocol.ts', import.meta.url)), 'utf8');
  assert.doesNotMatch(protocol, /saveNetworkSettings|testNetworkSettings|SaveDesktopNetworkSettingsRequest/);
  // Behavior: a legacy manual/insecure proxy file cannot override the system proxy.
  const { mkdtemp, rm, writeFile, mkdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { NextMuxPlatformServiceImpl } = await import('../lib/node/nextmux-platform-service.js');
  const root = await mkdtemp(join(tmpdir(), 'nextmux-network-legacy-'));
  const saved = { https: process.env.HTTPS_PROXY, http: process.env.HTTP_PROXY, lower: process.env.https_proxy, lowerHttp: process.env.http_proxy, all: process.env.ALL_PROXY, lowerAll: process.env.all_proxy };
  try {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'network-settings-v1.json'), JSON.stringify({ schemaVersion: 1, mode: 'manual', proxyUrl: 'http://127.0.0.1:9', username: '', hasPassword: false, noProxy: '', rejectUnauthorized: false }));
    process.env.HTTPS_PROXY = 'http://proxy.system.invalid:3128'; delete process.env.HTTP_PROXY; delete process.env.https_proxy; delete process.env.http_proxy; delete process.env.ALL_PROXY; delete process.env.all_proxy;
    class Fixture extends NextMuxPlatformServiceImpl { nextmuxDataRoot() { return root; } }
    const service = new Fixture();
    const settings = await service.getNetworkSettings();
    await service.removeRetiredNetworkSettings();
    const { access } = await import('node:fs/promises');
    await assert.rejects(access(join(root, 'network-settings-v1.json')), { code: 'ENOENT' }, 'the retired proxy file is removed once');
    assert.equal(settings.mode, 'system');
    assert.equal(settings.source, 'environment');
    assert.equal(settings.rejectUnauthorized, true);
    assert.match(settings.resolvedProxy, /proxy\.system\.invalid/);
  } finally {
    for (const [key, name] of [['https', 'HTTPS_PROXY'], ['http', 'HTTP_PROXY'], ['lower', 'https_proxy'], ['lowerHttp', 'http_proxy'], ['all', 'ALL_PROXY'], ['lowerAll', 'all_proxy']]) {
      if (saved[key] === undefined) delete process.env[name]; else process.env[name] = saved[key];
    }
    // Restore undici's default dispatcher for the rest of this process.
    const { setGlobalDispatcher, Agent } = await import('undici');
    setGlobalDispatcher(new Agent());
    await rm(root, { recursive: true, force: true });
  }
});

test('appearance and language live on the account page and settings pages carry no explanatory subtitles', () => {
  const settingsNav = widget.match(/nmx-context-nav nmx-settings-nav[\s\S]*?<\/nav>/)?.[0] || '';
  assert.match(settingsNav, /settingsButton\('profile', this\.tx\('account'\)\)/);
  const settings = widget.slice(widget.indexOf('    protected renderSettings(): React.ReactNode {'), widget.indexOf('    commandNewConversation(): void {'));
  const account = settings.slice(settings.indexOf("if (this.settingsPanel === 'profile')"), settings.indexOf("} else if (this.settingsPanel === 'billing')"));
  assert.match(account, /nmx-profile-card/);
  assert.match(account, /nmx-theme-options/);
  assert.match(account, /nmx-language-select/);
  assert.doesNotMatch(settings, /<p>\{subtitle\}<\/p>|<span>\{subtitle\}<\/span>/);
  assert.doesNotMatch(settings, /选择应用的明暗显示方式|使用窗口左上角按钮可随时收起|这里设置新对话的默认权限/);
  assert.match(widget, /commandOpenSettings\(\): void \{\s*this\.openSettingsPanel\('profile'\)/);
});
