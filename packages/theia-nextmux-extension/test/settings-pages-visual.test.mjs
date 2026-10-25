import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const widgetUrl = new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url);

test('tab close preference is sent on attachment before lazy window-view initialization', async () => {
    const source = await readFile(widgetUrl, 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const members = ['TAB_APP_CLOSE_KEY', 'tabAppCloseBehavior', 'onAfterAttach'].map(name => {
        const member = widget.members.find(node => node.name?.getText(file) === name);
        assert.ok(member, `${name} must exist in the production widget`);
        return member.getText(file);
    }).join('\n');
    const { outputText } = ts.transpileModule(`class BaseWidget {
        onAfterAttach(message) { this.attachedMessage = message; }
    }
    class NextMuxDesktopWidget extends BaseWidget {
        ${members}
        initComputerWindowView() { throw new Error('attachment must not depend on lazy capture initialization'); }
    }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
    for (const saved of [null, 'desktop', 'quit', 'invalid', new Error('storage unavailable')]) {
        const calls = [];
        const window = {
            localStorage: { getItem(key) {
                assert.equal(key, 'nextmux.desktop.tabAppCloseBehavior');
                if (saved instanceof Error) throw saved;
                return saved;
            } },
            nextmuxDesktop: { setComputerTabCloseBehavior(value) { calls.push(value); return Promise.resolve(); } }
        };
        const Widget = vm.runInNewContext(`${outputText}\nNextMuxDesktopWidget;`, { window });
        const instance = new Widget();
        const message = { type: 'after-attach' };
        instance.onAfterAttach(message);
        assert.equal(instance.attachedMessage, message);
        assert.deepEqual(calls, [saved === 'quit' ? 'quit' : 'desktop']);
        window.nextmuxDesktop.setComputerTabCloseBehavior = () => Promise.reject(new Error('bridge unavailable'));
        instance.onAfterAttach(message);
        await new Promise(resolve => setImmediate(resolve));
        delete window.nextmuxDesktop.setComputerTabCloseBehavior;
        assert.doesNotThrow(() => instance.onAfterAttach(message));
        delete window.nextmuxDesktop;
        assert.doesNotThrow(() => instance.onAfterAttach(message));
    }
});

// Production renderSettings + settings navigation, rendered in real Chromium
// with production CSS (no parallel HTML copy): §6.8 account page with
// appearance & language, no proxy page, no explanatory subtitles, balance page.
async function fixtureBundle() {
    const source = await readFile(widgetUrl, 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const method = name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
    const context = method('renderContextPanel');
    const statements = context.body.statements;
    const buttonIndex = statements.findIndex(statement => ts.isVariableStatement(statement) && statement.getText(file).includes('const settingsButton'));
    assert.ok(buttonIndex > 0, 'settings navigation');
    const nav = statements.slice(buttonIndex).map(statement => statement.getText(file)).join('\n');
    const helpers = ['usageRecordPromptTokens', 'usageRecordTotalTokens'].map(name => file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(file)).join('\n');
    const entry = `import * as React from 'react'; import * as ReactDOM from 'react-dom'; import { createRoot } from 'react-dom/client';
import { NEXTMUX_DESKTOP_LOCALES, desktopText } from './nextmux-locale';
import { localizeDesktopSurface } from './nextmux-surface-locale';
import { ImeInput, ImeTextarea } from './nextmux-ime-field';
import { formatBalanceMicros, walletNetBalanceMicros } from './nextmux-money-format';
import { walletBalanceText } from './nextmux-wallet-balance-text';
import { dynamicLabel } from './nextmux-dynamic-label-locale';
import { incognitoText } from './nextmux-incognito-text';
import { DataLocationSection } from './nextmux-data-location';
import { conversationDisplayTitle } from './nextmux-conversation-domain-locale';
import { GitHubAccountSettings } from './nextmux-github-account-panel';
import { ThemePreferenceIcon } from './nextmux-theme-icons';
import { DeviceLinkActions, deviceLinkState, deviceLinkText } from './nextmux-device-link-status';
import { comicCountText, pluginSummaryText } from './nextmux-shell-surface-locale';
import { SystemPermissionsSettings, systemPermissionsText } from './nextmux-system-permissions-panel';
import { ConversationImportPanel, importText } from './nextmux-conversation-import-panel';
import { SYSTEM_NOTIFICATIONS_KEY, systemNotificationsEnabled, taskNotificationText } from './nextmux-task-notification-text';
import { AppPluginsSettings } from './nextmux-app-plugins-view';
import { appPluginText } from './nextmux-app-plugins-locale';
import { appControlText } from './nextmux-app-control';
const APP_PLUGIN_DOCS_URL = 'https://nextmux.app/docs/plugins', APP_PLUGIN_PUBLISH_URL = 'https://nextmux.app/plugins/publish';
import { modelVisibilityCopy } from './nextmux-model-visibility-settings';
import { linkOpeningText } from './nextmux-link-opening-locale';
import { terminalSurfaceText } from './nextmux-terminal-locale';
import { desktopAccountIdentity } from './nextmux-account-identity';
import { modelUsageText } from './nextmux-model-usage-locale';
import { UsageAnalytics } from './nextmux-usage-analytics';
import { usageAnalyticsText } from './nextmux-usage-analytics-locale';
import { RelaySwitchControl, relaySwitchCopy, automaticOptimalText } from './nextmux-relay-switch-control';
import { modelSwitchRouteKey } from '../common/nextmux-model-switch-policy';
import { AgentInstructionsSettings, agentInstructionsText } from './nextmux-agent-instructions-panel';
${helpers}
const params = new URLSearchParams(location.search), DAY = 86400000, now = Date.now();
const records = Array.from({ length: 24 }, (_, i) => ({ id: 'r' + i, canonicalModel: 'm' + (i % 3), modelName: ['Claude Sonnet 4.5', 'GPT-5.1', 'Gemini 2.5 Pro'][i % 3], providerName: 'Synthetic Relay', status: 'completed', currency: 'USD',
  chargedMicros: 2100 + i * 190, createdAt: now - (i % 12) * DAY, durationMs: 700 + i * 20, inputTokens: 1200, cachedInputTokens: 300, cacheWriteTokens: 0, outputTokens: 240, inputIncludesCached: true, attemptCount: 1 }));
const platformService = {
  async getMerchantUsageOverview(q) { return { items: [{ merchantId: 'm-1', providerName: 'Synthetic Relay', currency: 'USD', requestCount: 24, completedCount: 24, failedCount: 0, otherCount: 0, chargedMicros: records.reduce((s, r) => s + r.chargedMicros, 0),
    inputTokens: 28800, cachedInputTokens: 7200, cacheWriteTokens: 0, outputTokens: 5760, failoverCount: 0, averageDurationMs: 930, durationSampleCount: 24, modelMatchedCount: 24, modelMismatchedCount: 0, modelUnreportedCount: 0, modelEvidence: 'self_reported_consistent', firstAt: 1, latestAt: 2 }], range: { since: q.since, until: q.until }, refreshedAt: now }; },
  async getUsageHistory(q) { return { items: records, range: { since: q.since, until: q.until } }; },
  async getGitHubAccount() { return { connected: false, allowAgent: true }; }, async connectGitHubAccount() { return { connected: false, allowAgent: true }; },
  async disconnectGitHubAccount() { return { connected: false, allowAgent: true }; }, async setGitHubAgentAccess() { return { connected: false, allowAgent: true }; }
};
class FixtureWidget {
  deviceLink = undefined; deviceLinkStarting = false;
  currentDeviceLinkState() { return deviceLinkState({ linked: this.platformSession.linked, starting: this.deviceLinkStarting, expiresAt: this.deviceLink?.expiresAt }); }
  cancelDeviceLink() { (this.calls || []).push(['cancelLink']); this.deviceLink = undefined; this.update(); }
  desktopLocale = params.get('locale') || 'zh-CN'; settingsPanel = params.get('panel') || 'profile'; themePreference = 'system'; calls = [];
  platformSession = { linked: true, user: { id: 'user-1', email: 'reader@example.com', displayName: 'Synthetic Reader' }, wallets: [] };
  deviceLinkError = ''; modelSwitchError = ''; accountOverviewError = ''; accountOverviewLoading = false; billingTab = 'usage';
  accountOverview = { wallets: [{ currency: 'USD', availableMicros: 100000000, reservedMicros: 0, lifetimeSpentMicros: 52000, lifetimeCreditedMicros: 100052000 }], topups: [], movements: [],
    usage: records.slice(0, 12).map(r => ({ ...r, routeMode: 'automatic', failoverCount: 0, referenceModel: '', pricingMode: 'direct', settlementMultiplierBps: 10000, platformFeeBps: 0, metrics: [], meteringSource: 'provider_reported', startedAt: r.createdAt, completedAt: r.createdAt })), refreshedAt: 1 };
  linkOpeningPolicy = { getPreference: () => '' }; terminalRuntime = { profiles: [{ id: 'zsh', label: 'zsh' }], supportStatus: 'supported', platform: 'macos', wslStatus: 'not_applicable' }; terminalRuntimeLoading = false;
  workspaceSkills() { return []; } runningMcpServers = []; automaticRouting = false; walletTopupStage = 'idle';
  modelSwitchSettings = { get: () => ({ version: 1, revision: 0, mode: 'same_model', fallbackRegistryModelIds: [], merchantScope: 'selected_merchant' }) };
  platformService = platformService;
  // Settings → 技能插件 and the 工具权限 close-behavior row (renderSettings reads them).
  appPlugins = []; appPluginsLoading = false; appPluginsError = ''; appPluginsBusy = ''; appPluginsExpanded = ''; appPluginTests = {}; appPluginUninstall = '';
  appPluginsTab = 'installed'; appPluginMarket = { plugins: [], loading: false, error: '', query: '', busy: '', loaded: false };
  appControlAvailable() { return true; } renderAppPluginDialogs() { return null; } guard(_name, render) { return render(); } tabAppCloseBehavior() { return 'desktop'; } setTabAppCloseBehavior() {}
  loadAppPlugins() {} loadAppPluginMarket() {} getAppPluginFromMarket() {} openAppPluginModel() {}
  tx(key) { return desktopText(this.desktopLocale, key); }
  selectedTerminalProfile() { return this.terminalRuntime.profiles[0]; }
  formatMoneyMicros(currency, value) { return new Intl.NumberFormat(this.desktopLocale, { style: 'currency', currency, maximumFractionDigits: 6 }).format(value / 1e6); }
  formatMediaSize(bytes) { return bytes + ' B'; }
  openSettingsPanel(panel) { this.calls.push(['panel', panel]); this.settingsPanel = panel; this.update(); }
  setDesktopTheme(value) { this.calls.push(['theme', value]); this.themePreference = value; this.update(); }
  setDesktopLocale(value) { this.calls.push(['locale', value]); }
  setConversationLinkPreference() {} selectTerminalProfile() {} loadTerminalRuntime() {} openAccountPortal() {} openExternalUrl() {} loadAccountOverview() { this.calls.push(['refresh']); }
  selectBillingTab(tab) { this.billingTab = tab; this.update(); } openWalletTopup() {} startDeviceLink() {} setAutomaticRouting() {} changeModelSwitchPolicy() {}
  activeModelRoute() { return undefined; } modelOnlyDisplayName(value) { return value; }
  renderFullAccessConfirmation() { return null; } renderContextAccountDock() { return null; }
  resolvedDesktopTheme() { return params.get('theme') || 'dark'; }
  ${method('renderAutomaticRelaySwitch').getText(file)}
  ${method('renderSettings').getText(file)}
  ${['renderSkillsPanel', 'renderMcpPanel', 'renderAppPluginsPanel'].map(name => method(name).getText(file)).join('\n  ')}
  renderNav() { ${nav} }
  update() { ReactDOM.flushSync(() => root.render(<div className='nmx-desktop-widget' dir={this.desktopLocale === 'ar' ? 'rtl' : 'ltr'} lang={this.desktopLocale}><div className={'nmx-shell fixture-shell nmx-theme-' + this.resolvedDesktopTheme()}>
    {this.renderNav()}<section id='nmx-workspace' className='nmx-workspace'>{this.renderSettings()}</section></div></div>));
    requestAnimationFrame(() => localize(this.desktopLocale)); }
}
function localize(locale) {
  const node = document.querySelector('.nmx-desktop-widget'), walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current.parentElement?.closest('[data-nmx-literal]')) continue;
    const rendered = localizeDesktopSurface(locale, current.data); if (rendered !== current.data) current.data = rendered;
  }
  document.body.dataset.localized = String(Number(document.body.dataset.localized || 0) + 1);
}
const root = createRoot(document.getElementById('fixture')); const instance = new FixtureWidget(); window.fixture = instance; instance.update();`;
    const { outputFiles } = await desktop('esbuild').build({ stdin: { contents: entry, loader: 'tsx', resolveDir: dirname(fileURLToPath(widgetUrl)), sourcefile: 'settings-fixture.tsx' },
        bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent',
        alias: { react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client'),
            '@theia/core/shared/react': core.resolve('react') } });
    return outputFiles[0].contents;
}

test('settings account and balance pages render cleanly in real Chromium (light/dark, zh-CN/en, narrow/wide)', { timeout: 240000 }, async t => {
    const puppeteer = (await import(platform.resolve('puppeteer'))).default;
    await mkdir('/tmp/nm-shots/settings', { recursive: true });
    const style = name => readFile(new URL(`../src/browser/style/${name}`, import.meta.url));
    const assets = {
        '/fixture.js': ['text/javascript', await fixtureBundle()],
        '/style.css': ['text/css', await style('nextmux.css')], '/production.css': ['text/css', await style('nextmux-desktop-production.css')],
        '/pickers.css': ['text/css', await style('nextmux-pickers-settings.css')],
        '/icons.css': ['text/css', await readFile(core.resolve('@vscode/codicons/dist/codicon.css'))], '/codicon.ttf': ['font/ttf', await readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))],
        '/': ['text/html', `<!doctype html><html><head><meta charset='utf-8'><link rel='stylesheet' href='/icons.css'><link rel='stylesheet' href='/style.css'><link rel='stylesheet' href='/production.css'><link rel='stylesheet' href='/pickers.css'>
<style>html,body,#fixture,.nmx-desktop-widget{margin:0;width:100%;height:100%;font:13px system-ui}*{box-sizing:border-box}.fixture-shell{display:grid!important;grid-template-columns:minmax(180px,240px) minmax(0,1fr);height:100%}.fixture-shell .nmx-workspace{min-height:0}</style></head><body><div id='fixture'></div><script src='/fixture.js'></script></body></html>`]
    };
    const server = createServer((request, response) => {
        const asset = assets[new URL(request.url, 'http://127.0.0.1').pathname];
        response.writeHead(asset ? 200 : 404, { 'content-type': asset?.[0] || 'text/plain' }); response.end(asset?.[1] || 'Not found');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const theme of ['light', 'dark']) for (const locale of ['zh-CN', 'en']) for (const [width, height] of [[720, 760], [1280, 820]]) {
        const label = `${theme}-${locale}-${width}x${height}`;
        await page.setViewport({ width, height });
        await page.goto(`${origin}/?${new URLSearchParams({ theme, locale, panel: 'profile' })}`, { waitUntil: 'load' });
        await page.waitForFunction(() => Number(document.body.dataset.localized || 0) > 0);
        const account = await page.evaluate(() => ({
            nav: [...document.querySelectorAll('[data-settings-panel]')].map(button => button.dataset.settingsPanel),
            heading: document.querySelector('.nmx-settings-heading')?.textContent, subtitle: document.querySelectorAll('.nmx-settings-heading p, .nmx-workspace-topbar span').length,
            hasProfile: Boolean(document.querySelector('.nmx-account-settings .nmx-profile-card')), hasTheme: document.querySelectorAll('.nmx-account-settings .nmx-theme-options [role=radio]').length,
            hasLanguage: Boolean(document.querySelector('.nmx-account-settings .nmx-language-select select')), notes: document.querySelectorAll('.nmx-settings-group header small').length,
            pageWidth: document.documentElement.scrollWidth, text: document.body.innerText }));
        assert.deepEqual(account.nav.slice(0, 2), ['profile', 'billing'], `${label}: account first`);
        assert.ok(!account.nav.includes('network') && !account.nav.includes('general'), `${label}: retired tabs`);
        assert.ok(account.hasProfile && account.hasTheme === 3 && account.hasLanguage, `${label}: appearance & language on the account page`);
        assert.equal(account.subtitle, 0, `${label}: no explanatory subtitle`); assert.equal(account.notes, 0, `${label}: no group explanations`);
        assert.ok(account.pageWidth <= width, `${label}: horizontal overflow`);
        // Language names stay in their own script (简体中文, 繁體中文, 日本語), like every OS language picker.
        const translatable = account.text.split('\n').filter(line => !/^(简体中文|繁體中文|日本語)$/u.test(line.trim())).join('\n');
        if (locale === 'en') assert.doesNotMatch(translatable, /[\p{Script=Han}]/u, `${label}: untranslated Chinese on the account page`);
        assert.equal(await page.$eval('.nmx-language-select select', node => node.hasAttribute('data-nmx-literal') && [...node.options].map(option => option.textContent).slice(0, 3).join('|')), '简体中文|繁體中文|English', `${label}: language endonyms are not machine-translated`);
        await page.click('.nmx-theme-options [role=radio]:nth-child(2)');
        assert.deepEqual(await page.evaluate(() => window.fixture.calls.at(-1)), ['theme', 'light']);
        await page.screenshot({ path: `/tmp/nm-shots/settings/account-${label}.png` });

        await page.click('[data-settings-panel="billing"]');
        await page.waitForFunction(() => /\$/.test(document.querySelector('[data-usage-kpi="spend"] strong')?.textContent || ''));
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)));
        const billing = await page.evaluate(() => {
            const actions = document.querySelector('.nmx-billing-heading-actions'), heading = document.querySelector('.nmx-settings-heading h2');
            const table = document.querySelector('.nmx-billing-table');
            return { buttons: actions.querySelectorAll(':scope > button').length, sameRow: Math.abs(actions.getBoundingClientRect().top - heading.getBoundingClientRect().top) < 40,
                tabs: [...document.querySelectorAll('.nmx-billing-toolbar nav button')].map(button => button.title === button.textContent),
                tableScroll: getComputedStyle(table).overflowY, kpis: document.querySelectorAll('[data-usage-kpi]').length, pageWidth: document.documentElement.scrollWidth };
        });
        assert.equal(billing.buttons, 3, `${label}: three buttons in the title row`);
        assert.ok(billing.sameRow || width < 760, `${label}: actions share the title row`);
        assert.ok(billing.tabs.every(Boolean), `${label}: tab hover text`); assert.equal(billing.tableScroll, 'auto');
        assert.equal(billing.kpis, 5); assert.ok(billing.pageWidth <= width, `${label}: horizontal overflow`);
        await page.screenshot({ path: `/tmp/nm-shots/settings/balance-${label}.png` });

        await page.click('[data-settings-panel="permissions"]');
        await page.waitForSelector('.nmx-tab-app-close [role="radiogroup"]');
        const closeSetting = await page.$eval('.nmx-tab-app-close', row => ({
            title: row.querySelector('strong').textContent,
            description: row.querySelector('small').textContent,
            choices: [...row.querySelectorAll('[role="radio"]')].map(button => ({
                label: button.textContent, checked: button.getAttribute('aria-checked'), selected: button.classList.contains('is-selected')
            }))
        }));
        assert.deepEqual(closeSetting.choices.map(({ checked, selected }) => ({ checked, selected })), [
            { checked: 'false', selected: false }, { checked: 'true', selected: true }
        ], `${label}: return to desktop is the default of exactly two close choices`);
        if (locale === 'zh-CN') {
            assert.equal(closeSetting.title, '关闭标签或退出 NextMux 时');
            assert.equal(closeSetting.description, '只影响 NextMux 为标签打开的应用；你原本就开着的应用总是放回桌面。应用会正常退出，有未保存的内容会先问你。');
            assert.deepEqual(closeSetting.choices.map(choice => choice.label), ['退出标签里的应用', '把应用放回桌面']);
        }
        await page.screenshot({ path: `/tmp/nm-shots/settings/tab-app-close-${label}.png` });
    }
    assert.deepEqual(errors, []);
});
