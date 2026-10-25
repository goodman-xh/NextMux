import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const React = require('react');
const { mcpChildEnvironment, mcpLauncherRuntime, resolveMcpLauncherSync } = require('../lib/node/nextmux-mcp-launch.js');
const { mcpFailureCode } = require('../lib/node/nextmux-mcp-server.js');
const { isMerchantApiDeletedFailure } = require('../lib/common/nextmux-merchant-api-deleted.js');
const { managedPriceText } = require('../lib/browser/nextmux-managed-price-text.js');

const widgetSource = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const launchSource = readFileSync(new URL('../src/node/nextmux-mcp-launch.ts', import.meta.url), 'utf8');

test('uvx, npx and docker are found where user-level installers put them, newest Python first, without touching PATH order', () => {
    const listings = {
        '/Library/Frameworks/Python.framework/Versions': ['3.9', 'Current', '3.13', '3.12'],
        '/Users/a/Library/Python': ['3.11', 'notes'],
        '/Users/a/.nvm/versions/node': ['v20.11.1', 'v22.3.0'],
        'C:\\Users\\A\\AppData\\Local\\Programs\\Python': ['Python39', 'Python313', 'Launcher', 'Python312-arm64'],
        'C:\\Users\\A\\AppData\\Roaming\\Python': ['Python311']
    };
    const list = directory => listings[directory] || [];
    const mac = mcpChildEnvironment({}, 'darwin', { HOME: '/Users/a', PATH: '/usr/bin:/custom/bin' }, list).PATH.split(':');
    assert.deepEqual(mac.slice(0, 2), ['/usr/bin', '/custom/bin'], 'inherited entries keep their order and win');
    for (const directory of ['/Users/a/.local/bin', '/Users/a/.cargo/bin', '/opt/homebrew/bin',
        '/Library/Frameworks/Python.framework/Versions/3.13/bin', '/Users/a/Library/Python/3.11/bin', '/Users/a/.nvm/versions/node/v22.3.0/bin']) {
        assert.ok(mac.includes(directory), directory);
    }
    assert.ok(mac.indexOf('/Library/Frameworks/Python.framework/Versions/3.13/bin') < mac.indexOf('/Library/Frameworks/Python.framework/Versions/3.9/bin'));
    assert.ok(!mac.some(entry => entry.includes('Current') || entry.includes('notes') || entry.includes('v20.11.1')));
    assert.equal(mac.filter(entry => entry === '/usr/bin').length, 1, 'no duplicates');

    const win = mcpChildEnvironment({}, 'win32', {
        USERPROFILE: 'C:\\Users\\A', APPDATA: 'C:\\Users\\A\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\A\\AppData\\Local',
        Path: 'C:\\Windows\\System32;C:\\USERS\\A\\.LOCAL\\BIN\\'
    }, list).PATH.split(';');
    assert.equal(win[0], 'C:\\Windows\\System32');
    assert.equal(win.filter(entry => entry.toLowerCase().replace(/\\+$/, '') === 'c:\\users\\a\\.local\\bin').length, 1, 'case-insensitive de-duplication');
    for (const directory of ['C:\\Users\\A\\.cargo\\bin', 'C:\\Users\\A\\scoop\\shims', 'C:\\Users\\A\\AppData\\Roaming\\npm',
        'C:\\Users\\A\\AppData\\Local\\Microsoft\\WinGet\\Links', 'C:\\Users\\A\\AppData\\Local\\Programs\\Python\\Python313\\Scripts',
        'C:\\Users\\A\\AppData\\Local\\Programs\\Python\\Python312-arm64\\Scripts', 'C:\\Users\\A\\AppData\\Roaming\\Python\\Python311\\Scripts']) {
        assert.ok(win.includes(directory), directory);
    }
    assert.ok(win.indexOf('C:\\Users\\A\\AppData\\Local\\Programs\\Python\\Python313\\Scripts') < win.indexOf('C:\\Users\\A\\AppData\\Local\\Programs\\Python\\Python39\\Scripts'));
    assert.ok(!win.some(entry => /Launcher\\Scripts/.test(entry)));
});

test('a missing uvx falls back to `uv tool run`, never downloads an installer, and names its runtime', () => {
    const exists = new Set(['/opt/tools/uv']);
    const fs = require('node:fs');
    const original = fs.existsSync;
    fs.existsSync = path => exists.has(path) || original(path);
    try {
        assert.deepEqual(resolveMcpLauncherSync('uvx', ['markitdown-mcp'], { PATH: '/opt/tools' }, 'darwin'), { command: 'uv', args: ['tool', 'run', 'markitdown-mcp'] });
        exists.delete('/opt/tools/uv');
        assert.deepEqual(resolveMcpLauncherSync('uvx', ['markitdown-mcp'], { PATH: '/opt/tools' }, 'darwin'), { command: 'uvx', args: ['markitdown-mcp'] });
    } finally { fs.existsSync = original; }
    assert.deepEqual(resolveMcpLauncherSync('npx', ['@acme/mcp'], { PATH: '' }, 'darwin'), { command: 'npx', args: ['-y', '@acme/mcp'] });
    assert.doesNotMatch(launchSource, /install\.sh|install\.ps1|astral\.sh|execFile|child_process/, 'nothing is fetched or executed on the person\'s behalf');
    assert.equal(mcpLauncherRuntime('C:\\Tools\\uvx.exe'), 'uvx');
    assert.equal(mcpLauncherRuntime('"C:\\Program Files\\nodejs\\npx.cmd"'), 'npx');
    assert.equal(mcpLauncherRuntime('docker'), 'docker');
    assert.equal(mcpLauncherRuntime('pnpm'), undefined, 'pnpm is not Node.js alone, so no "install Node.js" advice');
});

test('a command the shell cannot find is runtime_missing on every platform; 401/403 is authentication', () => {
    assert.equal(mcpFailureCode('spawn uvx ENOENT'), 'runtime_missing');
    assert.equal(mcpFailureCode("'uvx' is not recognized as an internal or external command"), 'runtime_missing');
    assert.equal(mcpFailureCode("'uvx' 不是内部或外部命令，也不是可运行的程序"), 'runtime_missing');
    assert.equal(mcpFailureCode('MCP process exited with code 9009', 9009), 'runtime_missing');
    assert.equal(mcpFailureCode('MCP process exited with code 127', 127), 'runtime_missing');
    assert.equal(mcpFailureCode('Error POSTing to endpoint (HTTP 401): unauthorized'), 'authentication');
    assert.equal(mcpFailureCode('SSE error: Non-200 status code (403)'), 'authentication');
    assert.equal(mcpFailureCode('MCP process exited with code 1', 1), 'process_exit');
    assert.equal(mcpFailureCode('read 4010 bytes'), 'connection', 'a number that merely contains 401 is not an auth failure');
});

test('a deleted merchant API is recognised wherever an adapter puts it, and nothing else is', () => {
    assert.equal(isMerchantApiDeletedFailure({ code: 'REQUEST_REJECTED', httpStatus: 410,
        readableError: { kind: 'relay_unavailable', source: 'relay', code: 'merchant_api_deleted' } }), true);
    assert.equal(isMerchantApiDeletedFailure({ code: 'MODEL_CALL_FAILED', data: { readableError: { kind: 'relay_unavailable', code: 'merchant_api_deleted' } } }), true);
    assert.equal(isMerchantApiDeletedFailure({ code: 'REQUEST_REJECTED', providerCode: 'merchant_api_deleted' }), true);
    assert.equal(isMerchantApiDeletedFailure({ failure: { message: '当前使用的商家 API 已被删除，对话已停止，请切换其他商家或模型。' } }), true);
    assert.equal(isMerchantApiDeletedFailure(Object.assign(new Error('wrapped'), { cause: { code: 'merchant_api_deleted' } })), true);
    const cyclic = { code: 'X' }; cyclic.error = cyclic;
    assert.equal(isMerchantApiDeletedFailure(cyclic), false);
    for (const other of [{ code: 'ROUTE_UNAVAILABLE' }, { code: 'REQUEST_REJECTED', httpStatus: 410 }, 'route_not_found', undefined, null])
        assert.equal(isMerchantApiDeletedFailure(other), false, JSON.stringify(other));
});

test('a deleted merchant API stops for good: no automatic resume, a manual continue only with a checkpoint', () => {
    const resume = widgetSource.slice(widgetSource.indexOf('protected scheduleAutomaticResume('), widgetSource.indexOf('protected scheduleAutomaticResume(') + 6000);
    assert.match(resume, /const blocksAutomaticResume = [\s\S]*?MERCHANT_API_DELETED[\s\S]*?merchant_api_deleted/);
    assert.equal((resume.match(/!blocksAutomaticResume\(/g) || []).length, 2, 'both eligibility checks exclude it');
    const service = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
    assert.match(service, /isMerchantApiDeletedFailure\(modelFailure\) \|\| isMerchantApiDeletedFailure\(error\)[\s\S]{0,400}code: 'MERCHANT_API_DELETED', message, kind: 'waiting_user', retryable: false,\s*resumable: Boolean\(resumableState\.resumeCheckpointId\)/);
});

function cornerNotice() {
    const file = ts.createSourceFile('widget.tsx', widgetSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let arrow;
    const visit = node => {
        if (!arrow && ts.isArrowFunction(node) && node.getText(file).includes('One notice at a time, at the right end of this row')) arrow = node;
        ts.forEachChild(node, visit);
    };
    visit(file);
    assert.ok(arrow, 'corner notice renderer');
    return new Function('React', 'managedPriceText', ts.transpile(`return function(routePriceNotice) { return (${arrow.getText(file)})(); };`, {
        target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React
    }))(React, managedPriceText);
}

test('the composer corner shows at most one notice: a new error or warning first, then council, then price', () => {
    const render = cornerNotice();
    const price = { message: '该模型的倍率已被商家调整，请知悉！', detail: '倍率已从 ×0.5 调整为 ×1', sessionId: 'a', pricingUpdate: { id: 'p', offeringId: 'o' } };
    const harness = (notifications, council = '') => ({ desktopLocale: 'zh-CN', activeCodingSessionId: 'a', councilBelowNotice: council,
        composerNotifications: notifications, dismissComposerNotification() {}, dismissRoutePriceNotice() {}, update() {} });
    const deleted = { id: 'n1', conversationId: 'a', kind: 'error', title: '当前商家 API 已被删除，对话已停止，请切换模型', body: '' };
    const info = { id: 'n2', conversationId: 'a', kind: 'info', title: '已复制', body: '' };
    const other = { id: 'n3', conversationId: 'b', kind: 'warning', title: '另一个对话', body: '' };

    let element = render.call(harness([info, deleted, other], '该文件不存在'), price);
    assert.match(element.props.className, /is-error/);
    assert.equal(element.props['data-help'], deleted.title);
    assert.equal(React.Children.toArray(element.props.children).find(child => child.type === 'span').props.children, deleted.title);

    element = render.call(harness([info], '该文件不存在'), price);
    assert.equal(element.props['data-council-below-notice'], 'true', 'plain information waits behind the council notice');
    element = render.call(harness([info]), price);
    assert.equal(element.props['data-price-event-id'], 'p');
    element = render.call(harness([info]), undefined);
    assert.match(element.props.className, /is-info/);
    assert.equal(render.call(harness([other]), undefined), null, 'another conversation\'s notice never shows here');

    const microphone = { id: 'm', kind: 'warning', title: '未获得麦克风权限，请在系统隐私设置中开启', body: 'Windows 11：打开“设置 → 隐私和安全性 → 麦克风”…' };
    element = render.call(harness([microphone]), price);
    assert.match(element.props.className, /is-warning/);
    assert.equal(element.props['data-help'], microphone.body, 'the long steps are hover text, the capsule keeps one short line');
});

test('nothing is written into or under the composer except the corner capsule', () => {
    assert.doesNotMatch(widgetSource, /this\.voiceError|nmx-microphone-meter'|className='nmx-microphone-select'/);
    const composer = widgetSource.slice(widgetSource.indexOf("<div className={`nmx-composer ${this.composerDragActive"), widgetSource.indexOf("{this.renderComposerTelemetryBar?.(codingSession)}"));
    assert.doesNotMatch(composer, /nmx-settings-inline-error|nmx-comic-chat-note/);
    const comic = readFileSync(new URL('../src/browser/nextmux-comic-chat-view.tsx', import.meta.url), 'utf8');
    const below = comic.slice(comic.indexOf("<div className='nmx-composer-below nmx-comic-chat-below'>"), comic.indexOf('export interface ComicMaterialView'));
    assert.doesNotMatch(below, /is-warning'>\{t\('noModel'\)\}|is-warning'>\{props\.blocked\}/, 'warnings moved into the capsule');
    assert.match(below, /nmx-council-below-notice \$\{tone\}/);
});
