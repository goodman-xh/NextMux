#!/usr/bin/env node

import { connectToNextMuxWorkbench } from './desktop-attachment-file-e2e-harness.mjs';

const port = process.env.NEXTMUX_CDP_PORT || '9222';
// The Electron process exposes transient page targets while the workbench
// reloads. Connect to the renderer that actually mounted NextMux instead of
// relying on /json target order, which can otherwise make this locale test
// race a blank/stale page.
const { socket, call, evaluate } = await connectToNextMuxWorkbench(port);

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const expect = (condition, label, value) => {
    if (!condition) throw new Error(`${label}: ${JSON.stringify(value)}`);
};

async function waitFor(expression, label, timeout = 20_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const value = await evaluate(expression);
        if (value) return value;
        await pause(120);
    }
    throw new Error(`Timed out: ${label}`);
}

async function point(selector) {
    return waitFor(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        if (!node) return null;
        node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight
            ? { x: rect.left + rect.width / 2, y: Math.max(1, Math.min(innerHeight - 1, rect.top + rect.height / 2)) }
            : null;
    })()`, selector);
}

async function click(selector) {
    const target = await point(selector);
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 });
    await pause(220);
}

async function openGeneralSettings() {
    if (await evaluate(`Boolean(document.querySelector('.nmx-language-select select'))`)) return;
    await click('.nmx-account-trigger');
    await waitFor(`Boolean(document.querySelector('.nmx-settings-page'))`, 'settings page');
    if (!(await evaluate(`Boolean(document.querySelector('.nmx-language-select select'))`))) {
        await click('.nmx-settings-nav button[data-settings-panel="general"]');
    }
    await waitFor(`Boolean(document.querySelector('.nmx-language-select select'))`, 'appearance and language settings');
}

async function setLocale(locale) {
    await openGeneralSettings();
    await evaluate(`(() => {
        const select = document.querySelector('.nmx-language-select select');
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(select, ${JSON.stringify(locale)});
    select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await pause(1_800);
    await waitFor(`document.documentElement.lang === ${JSON.stringify(locale)}
        && Boolean(document.querySelector('.nmx-language-select select'))
        && ${process.platform === 'darwin'
            ? "Boolean(document.querySelector('.nmx-shell'))"
            : "document.querySelectorAll('#theia-top-panel .lm-MenuBar-itemLabel').length >= 4"}`, `${locale} reload`);
}

async function topMenuLabels() {
    return evaluate(`[...document.querySelectorAll('#theia-top-panel .lm-MenuBar-itemLabel')].map(node => node.textContent.trim())`);
}

async function menuSurfaceEvidence() {
    if (process.platform === 'darwin') {
        return evaluate(`({
            surface: 'native-electron-menu-bar',
            topPanelPresent: Boolean(document.querySelector('#theia-top-panel')),
            topPanelHidden: document.querySelector('#theia-top-panel')?.classList.contains('lm-mod-hidden') === true,
            locale: document.documentElement.lang,
            localeId: localStorage.getItem('localeId') || ''
        })`);
    }
    return { surface: 'in-window-menu-bar', labels: await topMenuLabels() };
}

async function conversationLiteralSample(targetTurnId = '') {
    await click('.nmx-titlebar-primary-nav button:nth-child(2)');
    await waitFor(`Boolean(document.querySelector('.nmx-task-view'))`, 'conversation view');
    return evaluate(`(async () => {
        const scroller = document.querySelector('.nmx-task-view');
        if (!scroller) return { id: '', prompts: [], responses: [] };
        const originalTop = scroller.scrollTop;
        const targetTurnId = ${JSON.stringify(targetTurnId)};
        const read = () => {
            const candidates = [...document.querySelectorAll('.nmx-task-turn')];
            const turn = targetTurnId
                ? candidates.find(node => node.getAttribute('data-turn-id') === targetTurnId)
                : candidates.find(node => node.querySelector('.nmx-user-message .nmx-literal-content')?.textContent.trim()
                    && node.querySelector('.nmx-agent-message .nmx-gateway-content')?.textContent.trim());
            if (!turn) return null;
            return {
                id: turn.getAttribute('data-turn-id') || '',
                prompts: [...turn.querySelectorAll('.nmx-user-message .nmx-literal-content')].map(node => node.textContent.trim()),
                responses: [...turn.querySelectorAll('.nmx-agent-message .nmx-gateway-content')].map(node => node.textContent.trim())
            };
        };
        let sample = read();
        let top = 0;
        let stableEndFrames = 0;
        // Virtuoso discovers variable-height history while it mounts ranges.
        // Recompute the maximum instead of freezing the first provisional
        // scrollHeight after a locale reload, otherwise a distant target turn
        // can be skipped even though it exists unchanged in the conversation.
        for (let attempt = 0; !sample && attempt < 220; attempt += 1) {
            const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
            scroller.scrollTo({ top: Math.min(top, maximum), behavior: 'auto' });
            await new Promise(resolve => setTimeout(resolve, 70));
            sample = read();
            if (sample) break;
            const measuredMaximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
            if (top >= measuredMaximum - 1) {
                stableEndFrames += 1;
                if (stableEndFrames >= 5) break;
                top = measuredMaximum;
            } else {
                stableEndFrames = 0;
                top = Math.min(measuredMaximum, top + Math.max(480, Math.floor(scroller.clientHeight * 1.5)));
            }
        }
        scroller.scrollTo({ top: originalTop, behavior: 'auto' });
        await new Promise(resolve => setTimeout(resolve, 80));
        return sample || { id: '', prompts: [], responses: [] };
    })()`);
}

async function terminalLocaleSample() {
    return evaluate(`(() => ({
        panelLabel: document.querySelector('.nmx-terminal-drawer')?.getAttribute('aria-label') || '',
        heading: document.querySelector('.nmx-terminal-drawer > header > div > strong')?.textContent.trim() || '',
        scope: [...document.querySelectorAll('.nmx-terminal-drawer > header nav > button')].map(node => node.textContent.trim()),
        records: [...document.querySelectorAll('.nmx-terminal-list article')].map(node => ({
            title: node.querySelector('.nmx-terminal-select strong')?.textContent.trim() || '',
            session: node.querySelector('.nmx-terminal-select small')?.textContent.trim() || '',
            tooltip: node.querySelector('.nmx-terminal-select')?.getAttribute('title') || '',
            readOnly: node.getAttribute('aria-readonly') === 'true'
        }))
    }))()`);
}

const expectedMenus = {
    'zh-CN': ['文件', '编辑', '视图', '帮助'],
    en: ['File', 'Edit', 'View', 'Help'],
    ja: ['ファイル', '編集', '表示', 'ヘルプ'],
    ar: ['ملف', 'تحرير', 'عرض', 'مساعدة']
};
const expectedTerminal = {
    'zh-CN': { panel: '终端面板', heading: '终端', scope: ['当前对话', '所有对话'], rename: '双击重命名' },
    en: { panel: 'Terminal panel', heading: 'Terminal', scope: ['Current conversation', 'All conversations'], rename: 'Double-click to rename' },
    ja: { panel: 'ターミナルパネル', heading: 'ターミナル', scope: ['現在の会話', 'すべての会話'], rename: 'ダブルクリックして名前を変更' },
    ar: { panel: 'لوحة الطرفية', heading: 'الطرفية', scope: ['المحادثة الحالية', 'كل المحادثات'], rename: 'انقر نقرًا مزدوجًا لإعادة التسمية' }
};

let originalLocale = 'en';
let passed = false;
const evidence = {};

try {
    await call('Page.enable');
    await call('Page.bringToFront');
    await call('Emulation.setFocusEmulationEnabled', { enabled: true });
    await call('Page.setWebLifecycleState', { state: 'active' });
    originalLocale = await evaluate(`localStorage.getItem('nextmux.locale') || document.documentElement.lang || 'en'`);
    const originalSample = await conversationLiteralSample();
    expect(originalSample.prompts.length > 0 && originalSample.responses.length > 0,
        'conversation contains literal user and assistant content', originalSample);
    evidence.originalSample = originalSample;
    const originalTerminal = await terminalLocaleSample();
    expect(originalTerminal.records.every(record => !record.readOnly), 'terminal drawer contains no synthetic task-terminal cards', originalTerminal);
    expect(originalTerminal.panelLabel === expectedTerminal[originalLocale]?.panel, 'original terminal panel locale', originalTerminal);
    evidence.originalTerminal = originalTerminal;

    for (const locale of ['ja', 'ar']) {
        await openGeneralSettings();
        await setLocale(locale);
        const menus = await menuSurfaceEvidence();
        if (process.platform === 'darwin') {
            expect(menus.topPanelPresent && menus.topPanelHidden,
                `${locale}: native macOS menu surface`, menus);
            expect(menus.locale === locale && menus.localeId === locale,
                `${locale}: native menu locale state`, menus);
        } else {
            expect(JSON.stringify(menus.labels) === JSON.stringify(expectedMenus[locale]), `${locale}: product menus follow locale`, menus.labels);
        }
        expect(await evaluate(`document.documentElement.dir`) === (locale === 'ar' ? 'rtl' : 'ltr'), `${locale}: document direction`);

        const sample = await conversationLiteralSample(originalSample.id);
        expect(JSON.stringify(sample) === JSON.stringify(originalSample), `${locale}: authored conversation content stays unchanged`, sample);

        const terminal = await terminalLocaleSample();
        expect(terminal.panelLabel === expectedTerminal[locale].panel, `${locale}: terminal panel label`, terminal);
        expect(terminal.heading === expectedTerminal[locale].heading, `${locale}: terminal heading`, terminal);
        expect(JSON.stringify(terminal.scope) === JSON.stringify(expectedTerminal[locale].scope), `${locale}: terminal scope labels`, terminal);
        expect(terminal.records.every(record => !record.readOnly), `${locale}: no synthetic task terminal is projected`, terminal.records);
        expect(terminal.records.every(record => record.tooltip.endsWith(expectedTerminal[locale].rename)), `${locale}: interactive terminal tooltip is explicitly localized`, terminal.records);

        let fileMenu;
        if (process.platform === 'darwin') {
            fileMenu = { surface: 'native-electron-menu-bar', inspectedInRenderer: false };
        } else {
            await click('#theia-top-panel .lm-MenuBar-item:nth-child(1)');
            fileMenu = await waitFor(`(() => {
                const node = [...document.querySelectorAll('.lm-Menu')].find(candidate => {
                    const rect = candidate.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                });
                if (!node) return null;
                const rect = node.getBoundingClientRect();
                return { rect: rect.toJSON(), items: [...node.querySelectorAll('.lm-Menu-itemLabel')].map(item => item.textContent.trim()).filter(Boolean) };
            })()`, `${locale}: file menu opens`);
            expect(fileMenu.rect.left >= 0 && fileMenu.rect.top >= 0 && fileMenu.rect.right <= await evaluate(`innerWidth`) && fileMenu.rect.bottom <= await evaluate(`innerHeight`),
                `${locale}: file menu stays inside window`, fileMenu);
            expect(fileMenu.items.length > 0 && fileMenu.items.length <= 6, `${locale}: file menu contains only product-relevant actions`, fileMenu.items);
            await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
            await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
            await pause(120);
        }
        evidence[locale] = { menus, fileMenu, terminal, direction: await evaluate(`document.documentElement.dir`) };
    }

    await setLocale(originalLocale);
    evidence.restoredMenus = await menuSurfaceEvidence();
    if (process.platform === 'darwin') {
        expect(evidence.restoredMenus.locale === originalLocale && evidence.restoredMenus.localeId === originalLocale,
            'original interface language restored', evidence.restoredMenus);
    } else {
        expect(JSON.stringify(evidence.restoredMenus.labels) === JSON.stringify(expectedMenus[originalLocale] || evidence.restoredMenus.labels),
            'original interface language restored', evidence.restoredMenus.labels);
    }
    const restoredSample = await conversationLiteralSample(originalSample.id);
    expect(JSON.stringify(restoredSample) === JSON.stringify(originalSample), 'conversation content survives locale round trip', restoredSample);
    const restoredTerminal = await terminalLocaleSample();
    expect(restoredTerminal.records.every(record => !record.readOnly), 'locale reload does not resurrect synthetic or exited terminals', restoredTerminal.records);
    passed = true;
} finally {
    const current = await evaluate(`localStorage.getItem('nextmux.locale') || document.documentElement.lang`).catch(() => originalLocale);
    if (current !== originalLocale) await setLocale(originalLocale).catch(() => undefined);
    socket.close();
}

console.log(JSON.stringify({ passed, evidence }, undefined, 2));
