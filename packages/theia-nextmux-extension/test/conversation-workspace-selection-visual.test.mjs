import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const React = core('react'), { renderToStaticMarkup } = core('react-dom/server'), puppeteer = platform('puppeteer');
const { narrowAgentPermission } = require('@nextmux/agent-runtime/permission');
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const method = name => widget.members.find(node => node.name?.getText(file) === name).getText(file);
const Harness = new Function('React', 'ReactDOM', 'document', 'localizeDesktopSurface', 'narrowAgentPermission', ts.transpile(`class Harness {
    ${method('renderAttachmentPopoverPortal')}
    ${method('conversationWorkspaceBindings')}
    ${method('conversationDirectoryMutationBlocked')}
}; return Harness;`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }))(
    React, { createPortal: element => element }, { body: {} }, (_locale, value) => value, narrowAgentPermission);
const walk = node => !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(walk)];
function fixture(theme = 'dark', height = 600) {
    const root = '/QA/主目录', calls = [];
    const session = { id: 'qa', workspacePath: root, permissionMode: 'full_access', turns: [], workspaceBindings: [
        { id: 'primary', path: root, permission: 'full_access' },
        { id: 'extra', path: '/QA/第二个具有较长名称的目录/long-component/'.repeat(3), permission: 'read_only' },
        { id: 'missing', path: '/QA/不可用目录', permission: 'workspace_write', status: 'missing' },
        { id: 'unlinked', path: '/QA/已解除目录', permission: 'full_access', status: 'unlinked' },
    ] };
    const state = Object.assign(new Harness(), { desktopLocale: 'zh-CN', codingPopover: 'directories', conversationDirectoriesSessionId: 'qa',
        conversationDirectoriesBusy: false, conversationDirectoriesError: '', applicationExitPreparing: false, restoringCheckpointId: '', turnEditSubmitting: false,
        scheduledAgentRuns: new Map(), activeAgentSessionId: '', activeAgentRunId: '', agentStage: 'idle', agentStopping: false,
        activeCodingSession: () => session, resolvedDesktopTheme: () => theme, permissionLabel: mode => mode === 'read_only' ? '只读' : mode === 'workspace_write' ? '工作区写入' : '完全访问',
        calculateModelPickerPlacement: panelHeight => ({ top: 12, left: 12, width: 292, height: Math.min(panelHeight, height - 24), maxHeight: height - 24 }),
        unlinkConversationWorkspaceDirectory: id => calls.push(`unlink:${id}`), chooseConversationWorkspaceDirectory: () => calls.push('add'),
        openConversationDirectories: () => calls.push('directories'), update() {} });
    return { state, session, calls };
}

test('production directory controls identify their scope, expose no primary removal and remain blocked during an unsettled run', () => {
    const f = fixture();
    const elements = walk(f.state.renderAttachmentPopoverPortal());
    const buttons = elements.filter(node => node.type === 'button');
    assert.equal(buttons.filter(node => node.props['aria-label']?.startsWith('解除目录绑定')).length, 2);
    assert.ok(!buttons.some(node => node.props['aria-label'] === '解除目录绑定 /QA/主目录'));
    const remove = buttons.find(node => node.props['aria-label']?.includes('第二个')); remove.props.onClick();
    assert.deepEqual(f.calls, ['unlink:extra']);
    const html = renderToStaticMarkup(f.state.renderAttachmentPopoverPortal());
    assert.match(html, /解除绑定不会删除文件/); assert.match(html, /目录不可用/); assert.match(html, /已解除绑定/); assert.match(html, /只读/);
    f.session.permissionMode = 'workspace_write';
    assert.doesNotMatch(renderToStaticMarkup(f.state.renderAttachmentPopoverPortal()), /完全访问/, 'show the effective grant after the conversation narrows it');
    f.state.activeAgentSessionId = 'qa'; f.state.activeAgentRunId = 'stopping'; f.state.agentStage = 'cancelled';
    const blocked = walk(f.state.renderAttachmentPopoverPortal()).filter(node => node.type === 'button' && node.props['aria-label'] !== '返回添加内容');
    assert.ok(blocked.every(node => node.props.disabled));
    f.state.codingPopover = 'attachments';
    const menu = walk(f.state.renderAttachmentPopoverPortal()).filter(node => node.type === 'button');
    assert.equal(menu.length, 5); assert.match(renderToStaticMarkup(f.state.renderAttachmentPopoverPortal()), /目标/);
    menu.find(button => renderToStaticMarkup(button).includes('对话目录')).props.onClick();
    assert.deepEqual(f.calls, ['unlink:extra', 'directories']);
});

async function closeFixtureBrowser(browser) {
    const child = browser.process();
    let timeout;
    try {
        await Promise.race([
            browser.close(),
            new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Chromium close timed out')), 5000); })
        ]);
    } catch (error) {
        child?.kill('SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 250));
        if (child?.exitCode === null) child.kill('SIGKILL');
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

test('production directory markup and CSS retain readable paths and reachable controls in dark/light narrow isolated Chromium', { timeout: 90000 }, async t => {
    let stage = 'reading styles';
    t.after(() => t.diagnostic(`directory visual final stage: ${stage}`));
    const css = (await Promise.all(['nextmux.css', 'nextmux-desktop-production.css'].map(name => readFile(new URL(`../src/browser/style/${name}`, import.meta.url), 'utf8')))).join('\n');
    const [iconCss, font] = await Promise.all([readFile(core.resolve('@vscode/codicons/dist/codicon.css'), 'utf8'), readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))]);
    const icons = iconCss.replace(/url\([^)]+\)/g, `url(data:font/ttf;base64,${font.toString('base64')})`);
    stage = 'launching Chromium';
    const browser = await puppeteer.launch({ headless: true, timeout: 20000 }); t.after(() => closeFixtureBrowser(browser));
    stage = 'opening page';
    const page = await browser.newPage(); await page.setRequestInterception(true);
    page.on('request', request => void (request.url().startsWith('data:') ? request.continue() : request.abort()));
    for (const theme of ['dark', 'light']) for (const height of [380, 650]) {
        stage = `${theme}/${height}: setting viewport`;
        await page.setViewport({ width: 320, height });
        const f = fixture(theme, height);
        const html = renderToStaticMarkup(f.state.renderAttachmentPopoverPortal());
        stage = `${theme}/${height}: loading markup`;
        await page.setContent(`<html><head><style>${icons}\n${css}</style><style>html,body{margin:0;font:14px system-ui}</style></head><body>${html}</body></html>`, { timeout: 10000 });
        stage = `${theme}/${height}: loading fonts`;
        await page.waitForFunction(() => document.fonts.status === 'loaded', { timeout: 5000 });
        stage = `${theme}/${height}: measuring layout`;
        const measured = await page.evaluate(() => {
            const panel = document.querySelector('.nmx-conversation-directories');
            panel.scrollTop = panel.scrollHeight;
            const last = panel.lastElementChild, box = panel.getBoundingClientRect(), button = last.getBoundingClientRect();
            return { width: panel.clientWidth, scrollWidth: panel.scrollWidth, bottom: box.bottom, top: box.top,
                lastBottom: button.bottom, lastWidth: button.width, color: getComputedStyle(last).color,
                background: getComputedStyle(panel).backgroundColor,
                rows: [...panel.querySelectorAll('.nmx-directory-row')].map(row => ({ width: row.clientWidth, scrollWidth: row.scrollWidth,
                    textWidth: row.querySelector('code').getBoundingClientRect().width, title: row.firstElementChild.title })) };
        });
        assert.ok(measured.scrollWidth <= measured.width + 1, `${theme}/${height}: no horizontal overflow`);
        assert.ok(measured.top >= 0 && measured.bottom <= height + 1);
        assert.ok(measured.lastBottom <= measured.bottom + 1 && measured.lastWidth > 200, 'scrolling reaches the add action');
        assert.notEqual(measured.color, measured.background);
        assert.ok(measured.rows.every(row => row.scrollWidth <= row.width + 1 && row.textWidth > 170 && row.title));
    }
    stage = 'layout checks complete';
});
