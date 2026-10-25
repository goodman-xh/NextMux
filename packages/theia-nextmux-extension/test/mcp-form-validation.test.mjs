import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { McpAccessPanel, parseMcpArguments } from '../lib/browser/nextmux-mcp-access-panel.js';
import { mcpFormText, mcpKnownFormError, validateMcpServerForm } from '../lib/browser/nextmux-mcp-form-validation.js';
const require = createRequire(import.meta.url), coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const React = coreRequire('react'), { renderToStaticMarkup } = coreRequire('react-dom/server');
const valid = { name: 'nextmux-echo', local: false, address: 'https://fixture.invalid/mcp', args: [] };

test('MCP identifiers match registry boundaries and duplicate checks never rename an existing service', () => {
    for (const name of ['NextMux 验收回显', 'two words', '__proto__', 'constructor', 'prototype', '', 'x'.repeat(65)]) {
        assert.equal(validateMcpServerForm({ ...valid, name }, []).name, 'nameRule', name);
    }
    for (const name of ['nextmux-echo', 'Example_1.2', 'x'.repeat(64)]) assert.deepEqual(validateMcpServerForm({ ...valid, name }, []), {});
    assert.equal(validateMcpServerForm(valid, ['nextmux-echo']).name, 'nameExists');
    assert.deepEqual(validateMcpServerForm(valid, ['nextmux-echo'], 'nextmux-echo'), {});
    assert.deepEqual(validateMcpServerForm({ ...valid, name: '  nextmux-echo  ' }, []), {});
});

test('URLs reject malformed and credential-bearing configuration while local arguments preserve real paths', () => {
    for (const address of ['', 'not a URL', 'http://localhost/mcp', 'ftp://fixture.invalid', 'https://user:secret@fixture.invalid', 'https://fixture.invalid/?key=secret', 'https://fixture.invalid/#secret']) {
        assert.equal(validateMcpServerForm({ ...valid, address }, []).address, 'urlRule', address);
    }
    const command = { ...valid, local: true, address: '/Users/Example User/工具/node', args: parseMcpArguments('["a folder", "--literal=$VALUE", ""]') };
    assert.deepEqual(validateMcpServerForm(command, []), {});
    for (const address of ['', 'x'.repeat(2049), 'node\0secret', 'node\n--not-an-argument']) assert.equal(validateMcpServerForm({ ...command, address }, []).address, 'commandRule');
    for (const args of [undefined, Array(65).fill('x'), ['x'.repeat(2049)], Array(6).fill('x'.repeat(1800))]) assert.equal(validateMcpServerForm({ ...command, args }, []).args, 'argsRule');
    assert.deepEqual(validateMcpServerForm({ ...command, args: Array(64).fill('x') }, []), {});
});

test('every supported locale explains input rules; only exact public error codes are disclosed', () => {
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        for (const key of ['nameLabel', 'nameRule', 'nameExists', 'urlRule', 'commandRule', 'argsRule']) assert.ok(mcpFormText(locale, key)?.trim().length > 0, `${locale}/${key}`);
        assert.match(mcpFormText(locale, 'nameRule'), /64/);
        assert.match(mcpFormText(locale, 'urlRule'), /HTTPS/);
    }
    for (const [code, key] of [['MCP_NAME_INVALID', 'nameRule'], ['MCP_NAME_EXISTS', 'nameExists'], ['MCP_URL_INVALID', 'urlRule'], ['MCP_COMMAND_INVALID', 'commandRule']]) assert.equal(mcpKnownFormError(new Error(code)), key);
    for (const failure of [new Error('https://user:SECRET@host.invalid'), new Error('MCP_NAME_INVALID: SECRET'), 'MCP_NAME_INVALID', { message: 'MCP_NAME_INVALID: SECRET' }, undefined]) assert.equal(mcpKnownFormError(failure), undefined);
});

const walk = element => !element || typeof element !== 'object' ? [] : [element, ...React.Children.toArray(element.props?.children).flatMap(walk)];
const flush = async () => { for (let n = 0; n < 24; n++) await Promise.resolve(); };
// Execute production React handlers with isolated state. These contracts do not claim Electron or network acceptance.
function panel(overrides = {}, initialServers = []) {
    const slots = []; slots[0] = initialServers; slots[15] = true;
    const calls = [];
    const server = { name: 'nextmux-echo', fingerprint: 'fixture', needsReview: false, tools: [], local: false, connection: '', details: '{}' };
    const props = { locale: 'zh-CN', service: { getMcpAccess: async () => [server], changeMcpAccess: async input => { calls.push(['start', input]); return [server]; } },
        addServer: async (...args) => calls.push(['add', ...args]), changeCredential: async () => [], credentialConfigurable: () => false, onChange() {}, ...overrides };
    function render() {
        const pointer = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
        const old = pointer.current; let index = 0;
        pointer.current = { useState(value) { const at = index++; if (!(at in slots)) slots[at] = typeof value === 'function' ? value() : value;
            return [slots[at], next => { slots[at] = typeof next === 'function' ? next(slots[at]) : next; }]; },
            useRef(value) { const at = index++; if (!(at in slots)) slots[at] = { current: value }; return slots[at]; }, useEffect() {} };
        try { return McpAccessPanel(props); } finally { pointer.current = old; }
    }
    const field = placeholder => walk(render()).find(node => node.type === 'input' && node.props.placeholder === placeholder);
    const change = (placeholder, value) => field(placeholder).props.onChange({ currentTarget: { value } });
    const form = () => walk(render()).find(node => node.type === 'form');
    const submit = () => form().props.onSubmit({ preventDefault() {} });
    const button = () => walk(form()).find(node => node.type === 'button' && node.props.type === 'submit');
    walk(render()).find(node => node.type === 'button' && node.props.children === '添加服务').props.onClick();
    return { render, calls, change, field, form, submit, button };
}

test('production form rejects the reported Chinese name before RPC and allows corrected add-and-connect once', async () => {
    const h = panel(); assert.equal(h.button().props.disabled, true);
    h.change('my-mcp', 'NextMux 验收回显'); h.change('https://example.com/mcp', valid.address);
    assert.equal(h.field('my-mcp').props['aria-invalid'], true); assert.equal(h.button().props.disabled, true);
    assert.match(renderToStaticMarkup(h.render()), /不支持空格、中文或保留名称/);
    h.submit(); await flush(); assert.equal(h.calls.length, 0);
    h.change('my-mcp', valid.name); assert.equal(h.button().props.disabled, false);
    h.submit(); h.submit(); await flush();
    assert.equal(h.calls.filter(call => call[0] === 'add').length, 1);
    assert.deepEqual(h.calls[0], ['add', valid.name, { serverUrl: valid.address }]);
    assert.equal(h.calls[1][0], 'start'); assert.equal(h.form(), undefined);
});

test('duplicate-name and argument errors remain editable; safe server errors replace vague failures', async () => {
    const h = panel({}, [{ name: valid.name, tools: [], local: true, details: '{}', connection: '' }]);
    h.change('my-mcp', valid.name); h.change('https://example.com/mcp', valid.address);
    assert.equal(h.button().props.disabled, true); assert.match(renderToStaticMarkup(h.render()), /此服务标识已存在/);
    h.change('my-mcp', 'different');
    walk(h.form()).find(node => node.type === 'select').props.onChange({ currentTarget: { value: 'local' } });
    h.change('npx', 'node');
    walk(h.form()).find(node => node.type === 'textarea').props.onChange({ currentTarget: { value: '[42]' } });
    assert.equal(h.button().props.disabled, true); h.submit(); await flush(); assert.equal(h.calls.length, 0);
    assert.match(renderToStaticMarkup(h.render()), /参数须为字符串 JSON 数组/);
    for (const [failure, expected] of [[new Error('MCP_NAME_EXISTS'), /此服务标识已存在/], [new Error('SECRET-provider-body'), /操作未完成/]]) {
        const race = panel({ addServer: async () => { throw failure; } });
        race.change('my-mcp', valid.name); race.change('https://example.com/mcp', valid.address);
        race.submit(); await flush(); const html = renderToStaticMarkup(race.render());
        assert.match(html, expected); assert.doesNotMatch(html, /SECRET-provider-body|MCP_NAME_EXISTS/);
        assert.ok(race.form()); assert.equal(race.field('my-mcp').props.value, valid.name);
    }
});

test('MCP fields keep usable width inside the real settings cascade in local and remote modes', { timeout: 30000 }, async t => {
    const css = (await Promise.all(['nextmux.css', 'nextmux-desktop-production.css'].map(name => readFile(new URL(`../src/browser/style/${name}`, import.meta.url), 'utf8')))).join('\n');
    const puppeteer = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url))('puppeteer');
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setRequestInterception(true); page.on('request', request => void (request.url().startsWith('data:') ? request.continue() : request.abort()));
    for (const theme of ['light', 'dark']) for (const local of [false, true]) {
        const h = panel();
        if (local) walk(h.form()).find(node => node.type === 'select').props.onChange({ currentTarget: { value: 'local' } });
        const markup = renderToStaticMarkup(h.render());
        // A narrow settings region can occur in a wide window: viewport-only breakpoints are insufficient.
        for (const [viewport, pane] of [[1326, 832], [1326, 430], [480, 480], [320, 320]]) {
            await page.setViewport({ width: viewport, height: 768 });
            await page.setContent(`<html><head><style>${css}</style><style>html,body{margin:0;font:14px system-ui}</style></head><body><div class="nmx-desktop-widget"><div class="nmx-shell nmx-theme-${theme}" style="display:block;min-width:0;width:${viewport}px"><main class="nmx-workspace" style="width:${pane}px"><div class="nmx-workspace-scroll nmx-settings-page"><section class="nmx-settings-panel">${markup}</section></div></main></div></div></body></html>`);
            const geometry = await page.evaluate(() => {
                const form = document.querySelector('.nmx-mcp-form'), rect = node => {
                    const { left, right, top, bottom, width } = node.getBoundingClientRect(); return { left, right, top, bottom, width };
                };
                const formStyle = getComputedStyle(form);
                return { width: form.clientWidth, contentWidth: form.clientWidth - parseFloat(formStyle.paddingLeft) - parseFloat(formStyle.paddingRight), scroll: form.scrollWidth, fields: [...form.querySelectorAll(':scope > label')].map(label => {
                    const control = label.querySelector('input,select,textarea'), hint = label.querySelector('small');
                    const title = document.createRange(); title.selectNode(label.firstChild);
                    return { label: rect(label), control: rect(control), hint: hint && rect(hint), title: rect(title), color: getComputedStyle(control).color, background: getComputedStyle(control).backgroundColor };
                }) };
            });
            const context = `${theme}/${local ? 'local' : 'remote'}/${viewport}/${pane}`;
            assert.equal(geometry.fields.length, local ? 4 : 3, context);
            assert.ok(geometry.scroll <= geometry.width + 1, `${context}: form does not overflow`);
            for (const field of geometry.fields.slice(2)) assert.ok(field.control.width >= geometry.contentWidth - 1, `${context}: connection values use the full form width`);
            if (viewport === 1326 && pane === 832) assert.ok(Math.abs(geometry.fields[0].label.top - geometry.fields[1].label.top) <= 1, `${context}: name and transport share the first row`);
            if (local) assert.ok(geometry.fields[3].label.top >= geometry.fields[2].label.bottom - 1, `${context}: arguments follow the full-width command`);
            for (const field of geometry.fields) {
                assert.ok(field.control.width >= Math.min(180, geometry.width - 32), `${context}: usable control width ${field.control.width}`);
                assert.ok(Math.abs(field.control.width - field.label.width) <= 1, `${context}: control fills its field`);
                assert.ok(field.control.top >= field.title.bottom - 1, `${context}: label precedes its control`);
                assert.notEqual(field.color, field.background, `${context}: readable control`);
                if (field.hint) {
                    assert.ok(field.hint.top >= field.control.bottom - 1, `${context}: help stays below its control`);
                    assert.ok(Math.abs(field.hint.width - field.control.width) <= 1, `${context}: help uses the field width`);
                }
            }
            if (pane === 430 || viewport <= 480) assert.ok(geometry.fields[1].label.top >= geometry.fields[0].label.bottom - 1, `${context}: narrow pane stacks fields`);
            if (theme === 'light' && viewport === 1326) await page.screenshot({ path: `/tmp/nmx-mcp-layout-${local ? 'local' : 'remote'}-${pane}.png`, fullPage: true });
        }
    }
});
