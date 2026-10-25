import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { goalEditorText, goalScheduleText } from '../lib/browser/nextmux-goal-schedule-locale.js';
import { localizeDesktopSurface } from '../lib/browser/nextmux-surface-locale.js';
import { desktopDomainMessage } from '../lib/browser/nextmux-domain-error-locale.js';
import { desktopStatus } from '../lib/common/nextmux-desktop-status.js';
import { runtimeFinalText } from '../lib/browser/nextmux-agent-outcome-locale.js';

import { GoalElapsed } from '../lib/browser/nextmux-goal-elapsed-view.js';
import { goalTurnRunning, isGoalElapsedTurn } from '../lib/browser/nextmux-goal-elapsed.js';

const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const React = core('react'), { renderToStaticMarkup } = core('react-dom/server'), puppeteer = platform('puppeteer');
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
function jsxElement(marker) {
    let result;
    function visit(node) {
        if (ts.isJsxElement(node) && node.openingElement.getText(file).includes(marker)) result ??= node.getText(file);
        ts.forEachChild(node, visit);
    }
    visit(widget); assert.ok(result, marker); return result;
}
const method = name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name).getText(file);
const Factory = new Function('React', 'goalScheduleText', 'localizeDesktopSurface', 'desktopDomainMessage', 'desktopStatus', 'runtimeFinalText', 'goalEditorText', 'GoalElapsed', 'goalTurnRunning', 'isGoalElapsedTurn', ts.transpile(`class Fixture {
 renderList(workspaceScheduledTasks) { return ${jsxElement("className='nmx-scheduled-page'")}; }
 renderGoal(codingGoal) { const codingSession = { turns: [] }; const codingGoalLabel = codingGoal.status === 'paused' ? 'pausedGoal' : 'activeGoal'; return ${jsxElement('className={\x60nmx-coding-goal ')}; }
 ${method('scheduledTaskTimeLabel')}
 ${method('scheduledTaskStatusLabel')}
}; return Fixture;`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }));
const Fixture = Factory(React, goalScheduleText, localizeDesktopSurface, desktopDomainMessage, desktopStatus, runtimeFinalText, goalEditorText, GoalElapsed, goalTurnRunning, isGoalElapsedTurn);
const walk = element => !element || typeof element !== 'object' ? [] : [element, ...React.Children.toArray(element.props?.children).flatMap(walk)];
const baseline = { id: 'plan', title: '每天检查项目任务与模型调用结果，保持正确的恢复记录', prompt: '检查多个项目的构建日志，汇报需要处理的问题并保留完整证据；所有结果在对应计划对话中查看。',
    cadence: 'daily', runAt: '09:00', enabled: false, lastStatus: 'complete', workspacePath: '/Users/Example/Projects/包含较长名称的项目', sessionId: 'session' };
const goal = { prompt: '完成模型与工作区验收，并保证多分支恢复不修改其他对话文件', status: 'active' };

test('goal and schedule controls describe their real action without changing execution handlers', () => {
    const calls = [];
    const fixture = Object.assign(new Fixture(), { desktopLocale: 'zh-CN', workspaceOptions: [], runningScheduledTaskIds: new Set(), toggleCodingGoal: () => calls.push('goal'),
        toggleScheduledTask: id => calls.push(id), openScheduleDialog: task => calls.push(task?.id || 'new'), deleteScheduledTask: id => calls.push(`delete:${id}`) });
    const goalButtons = walk(fixture.renderGoal(goal)).filter(node => node.type === 'button');
    assert.equal(goalButtons.length, 3); assert.match(renderToStaticMarkup(goalButtons[0]), /暂停/);
    assert.equal(goalButtons[1].props['aria-label'], '编辑目标'); assert.equal(goalButtons[2].props['aria-label'], '关闭目标'); goalButtons[0].props.onClick(); assert.deepEqual(calls, ['goal']);
    const list = fixture.renderList([baseline, { ...baseline, id: 'once', cadence: 'once', lastRunAt: Date.now() }]);
    const html = renderToStaticMarkup(list);
    assert.match(html, /计划已暂停 · 最近一次运行已完成。/); assert.match(html, /单次计划已执行 · 最近一次运行已完成。/);
    const checkboxes = walk(list).filter(node => node.type === 'input');
    assert.match(checkboxes[0].props['aria-label'], /启用计划/); assert.equal(checkboxes[1].props.disabled, true);
    assert.ok(walk(list).some(node => node.type === 'label' && node.props.title.includes('请编辑运行时间')));
    checkboxes[0].props.onChange(); assert.deepEqual(calls, ['goal', 'plan']);
    const idle = renderToStaticMarkup(fixture.renderList([{ ...baseline, lastStatus: undefined }]));
    assert.doesNotMatch(idle, /计划已暂停 · 已暂停/);
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        for (const key of ['pauseGoal', 'resumeGoal', 'pauseHint', 'paused', 'enable', 'disable', 'onceDone', 'onceHint', 'invalidTime']) assert.ok(goalScheduleText(locale, key)?.trim());
    }
});

test('production goal and scheduled-list CSS preserves usable content and controls in narrow conversation regions', { timeout: 30000 }, async t => {
    const css = (await Promise.all(['nextmux.css', 'nextmux-desktop-production.css'].map(name => readFile(new URL(`../src/browser/style/${name}`, import.meta.url), 'utf8')))).join('\n');
    const [iconCss, iconFont] = await Promise.all([readFile(core.resolve('@vscode/codicons/dist/codicon.css'), 'utf8'), readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))]);
    const icons = iconCss.replace(/url\([^)]+\)/g, `url(data:font/ttf;base64,${iconFont.toString('base64')})`);
    const fixture = Object.assign(new Fixture(), { desktopLocale: 'zh-CN', workspaceOptions: [], runningScheduledTaskIds: new Set() });
    const content = renderToStaticMarkup(React.createElement(React.Fragment, null, fixture.renderGoal(goal), fixture.renderGoal({ ...goal, status: 'paused' }),
        fixture.renderList([baseline, { ...baseline, id: 'enabled', enabled: true, sessionId: undefined }])));
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); await page.setRequestInterception(true); page.on('request', request => void (request.url().startsWith('data:') ? request.continue() : request.abort()));
    for (const theme of ['dark', 'light']) for (const width of [710, 392, 320]) {
        await page.setViewport({ width, height: 900 });
        await page.setContent(`<html><head><style>${icons}\n${css}</style><style>html,body{margin:0;font:14px system-ui}.fixture{padding-top:16px}</style></head><body><div class="nmx-desktop-widget"><div class="nmx-shell nmx-theme-${theme} fixture" style="display:block;min-width:0;width:${width}px">${content}</div></div></body></html>`);
        await page.evaluate(() => document.fonts.ready);
        const geometry = await page.evaluate(() => {
            const rows = [...document.querySelectorAll('.nmx-scheduled-page article')].map(row => {
                const text = row.querySelector('.nmx-scheduled-description'), controls = row.querySelector('.nmx-scheduled-actions');
                return { rowWidth: row.clientWidth, rowScroll: row.scrollWidth, textWidth: text.getBoundingClientRect().width, textBottom: text.getBoundingClientRect().bottom,
                    controlsTop: controls.getBoundingClientRect().top, controlsRight: controls.getBoundingClientRect().right, rowRight: row.getBoundingClientRect().right,
                    title: text.querySelector('strong').title, prompt: text.querySelector('p').title, meta: text.querySelector('small').title,
                    enabledColor: getComputedStyle(row.firstElementChild).backgroundColor, toggleName: row.querySelector('input').getAttribute('aria-label') };
            });
            const goals = [...document.querySelectorAll('.nmx-coding-goal')].map(node => ({ color: getComputedStyle(node).color, opacity: getComputedStyle(node).opacity,
                background: getComputedStyle(node).backgroundColor, scroll: node.scrollWidth, width: node.clientWidth,
                buttons: [...node.querySelectorAll('button')].map(button => ({ width: button.getBoundingClientRect().width, color: getComputedStyle(button).color, background: getComputedStyle(button).backgroundColor, label: button.getAttribute('aria-label') || button.textContent.trim() })) }));
            return { rows, goals, iconLoaded: document.fonts.check('16px codicon') };
        });
        assert.equal(geometry.iconLoaded, true, 'production icon font is available');
        for (const row of geometry.rows) {
            assert.ok(row.textWidth >= Math.min(160, width - 120), `${theme}/${width}: meaningful content width`);
            assert.ok(row.rowScroll <= row.rowWidth + 1); assert.ok(row.controlsRight <= row.rowRight + 1);
            assert.ok(row.title && row.prompt && row.meta && row.toggleName);
            if (width < 600) assert.ok(row.controlsTop >= row.textBottom - 1, 'controls move below content according to container size');
        }
        for (const bar of geometry.goals) {
            assert.equal(bar.opacity, '1'); assert.ok(bar.scroll <= bar.width + 1); assert.notEqual(bar.color, bar.background);
            assert.equal(bar.buttons.length, 3); assert.ok(bar.buttons.every(button => button.width >= 24 && button.label));
        }
        if (theme === 'light') assert.notEqual(geometry.rows[1].enabledColor, 'rgb(34, 51, 41)', 'light theme must not retain the old dark green block');
        if (width === 392) await page.screenshot({ path: `/tmp/nm-goal-schedule-${theme}.png`, fullPage: true });
    }
});
