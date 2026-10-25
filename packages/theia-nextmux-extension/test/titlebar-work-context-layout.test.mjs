import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widgetClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
assert.ok(widgetClass, 'desktop widget class exists');
const methodNames = ['computeTitlebarLayout', 'syncPaneCssVariables', 'constrainPaneSizes'];
const constantNames = ['CONTEXT_PANEL_AUTO_COLLAPSE_WIDTH', 'CONTEXT_PANEL_AUTO_EXPAND_WIDTH', 'CONTEXT_PANEL_MIN_WIDTH',
    'WORK_CONTEXT_MIN_WIDTH', 'TERMINAL_LIST_MAX_WIDTH', 'FILE_LIST_MIN_WIDTH', 'TERMINAL_MIN_HEIGHT'];
const members = new Map(widgetClass.members.filter(member => member.name).map(member => [member.name.getText(ast), member.getText(ast)]));
for (const name of [...methodNames, ...constantNames]) assert.ok(members.has(name), `${name} exists`);
const emitted = ts.transpileModule(`class NextMuxDesktopWidget {
    ${[...methodNames, ...constantNames].map(name => members.get(name)).join('\n')}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture({ windows = false, captionControls = false, width = 1200, drawerWidth = 400, overlay = false,
    actions, entryTabs, ...overrides } = {}) {
    const classes = new Set();
    const variables = new Map();
    const shell = { classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } } };
    const document = {
        body: { classList: { contains: name => name === 'windows' && windows } },
        getElementById: name => name === 'window-controls' && captionControls ? {} : null
    };
    const Widget = new Function('document', `${emitted}\nreturn NextMuxDesktopWidget;`)(document);
    const widget = Object.assign(new Widget(), {
        node: { querySelector(selector) {
            if (selector === '.nmx-shell') return shell;
            if (selector === '.nmx-titlebar-actions') return actions;
            if (selector === '.nmx-titlebar-context .nmx-context-entry-tabs') return entryTabs;
            return null;
        } },
        cachedPrimaryNavWidth: 248, cachedPrimaryNavIconWidth: 108, cachedWorkspaceControlsWidth: 136,
        titlebarCompact: false, titlebarCrowded: false, titlebarContextCloseOnly: false,
        contextPanelCollapsed: true, contextPanelWidth: 220, workContextWidth: drawerWidth,
        activeSection: 'coding', workContextOpen: true,
        paneShellWidth: () => width,
        effectiveWorkContextWidth() { return this.workContextWidth; },
        workContextIsOverlay: () => overlay,
        setPaneCssVariable: (name, value) => variables.set(name, value),
        effectiveTerminalListWidth() { return this.terminalListWidth; },
        ...overrides
    });
    return { widget, classes, variables };
}

for (const [platform, windows, narrowWidth, normalDrawerWidth] of [
    ['macOS', false, 600, 300], ['Windows', true, 700, 400]
]) {
    for (const overlay of [false, true]) {
        const mode = overlay ? 'maximized drawer' : 'normal drawer';
        test(`${platform} ${mode}: hide primary navigation before it overlaps context tabs`, () => {
            const { widget } = fixture({ windows, width: narrowWidth, overlay,
                drawerWidth: overlay ? narrowWidth : normalDrawerWidth });
            assert.deepEqual(widget.computeTitlebarLayout(), { compact: overlay && !windows, crowded: !overlay || windows, contextCloseOnly: false });
        });

        test(`${platform} ${mode}: keep only drawer close when available shell space falls below 136px`, () => {
            const exactWidth = windows ? 402 : 334;
            const { widget } = fixture({ windows, width: exactWidth - 1, drawerWidth: exactWidth - 1, overlay });
            assert.deepEqual(widget.computeTitlebarLayout(), { compact: false, crowded: true, contextCloseOnly: true });
            assert.equal(widget.computeTitlebarLayout(exactWidth).contextCloseOnly, false,
                'the 136px boundary still has room for three icons and close');
        });

        test(`${platform} ${mode}: drawer's own width can require close-only even in a wide window`, () => {
            const exactDrawerWidth = windows ? 290 : 152;
            const { widget } = fixture({ windows, width: 1200, drawerWidth: exactDrawerWidth - 1, overlay });
            assert.deepEqual(widget.computeTitlebarLayout(), { compact: false, crowded: true, contextCloseOnly: true });
            widget.workContextWidth = exactDrawerWidth;
            assert.equal(widget.computeTitlebarLayout().contextCloseOnly, false);
        });

        test(`${platform} ${mode}: widening restores tabs and primary navigation after close-only`, () => {
            const initialWidth = windows ? 401 : 333;
            const { widget, classes } = fixture({ windows, width: initialWidth, drawerWidth: initialWidth, overlay });
            widget.syncPaneCssVariables();
            assert.equal(widget.titlebarContextCloseOnly, true);
            assert.ok(classes.has('is-titlebar-context-close-only'));
            widget.paneShellWidth = () => 1400;
            widget.workContextWidth = overlay ? 1400 : 400;
            widget.syncPaneCssVariables();
            assert.deepEqual({ compact: widget.titlebarCompact, crowded: widget.titlebarCrowded,
                contextCloseOnly: widget.titlebarContextCloseOnly }, { compact: false, crowded: false, contextCloseOnly: false });
            assert.equal(classes.has('is-titlebar-context-close-only'), false);
            assert.equal(classes.has('is-titlebar-crowded'), false);
        });
    }

    test(`${platform}: measured left actions limit context tabs independently of fallback widths`, () => {
        const width = windows ? 450 : 400;
        const { widget } = fixture({ windows, width, drawerWidth: width, overlay: true });
        assert.equal(widget.computeTitlebarLayout().contextCloseOnly, false);
        const measured = fixture({ windows, width, drawerWidth: width, overlay: true,
            actions: { offsetLeft: windows ? 100 : 160, offsetWidth: 100 } }).widget;
        assert.equal(measured.computeTitlebarLayout().contextCloseOnly, true);
    });

    test(`${platform}: measured context tabs reserve their actual content width and recover when hidden`, () => {
        const width = windows ? 1000 : 900;
        const entryTabs = { offsetWidth: 420, scrollWidth: 420 };
        const { widget } = fixture({ windows, width, drawerWidth: width, overlay: true, entryTabs });
        assert.equal(widget.computeTitlebarLayout().crowded, true);
        // A previously hidden row may retain scrollWidth; only visible measurements are usable.
        entryTabs.offsetWidth = 0;
        widget.titlebarCrowded = true;
        assert.equal(widget.computeTitlebarLayout().crowded, false);
    });

    test(`${platform}: closed drawer preserves existing text, icon, and hidden navigation boundaries`, () => {
        const boundaries = windows
            ? [[842, 'text'], [840, 'icon'], [694, 'icon'], [692, 'hidden'], [600, 'hidden']]
            : [[638, 'text'], [636, 'icon'], [620, 'icon'], [600, 'icon'], [494, 'icon'], [492, 'hidden']];
        const { widget } = fixture({ windows, workContextOpen: false });
        for (const [width, expected] of boundaries) {
            const layout = widget.computeTitlebarLayout(width);
            assert.equal(layout.crowded ? 'hidden' : layout.compact ? 'icon' : 'text', expected, `${width}px`);
            assert.equal(layout.contextCloseOnly, false, `${width}px never hides closed-drawer tabs`);
        }
    });

    test(`${platform}: packed drawer icons keep the same reservation when widening through 310px`, () => {
        const width = windows ? 900 : 600;
        const { widget } = fixture({ windows, width, drawerWidth: windows ? 464 : 326, overlay: true });
        // The supplied drawer widths leave exactly 310px after platform-specific insets.
        assert.deepEqual(widget.computeTitlebarLayout(),
            { compact: !windows, crowded: false, contextCloseOnly: false });
        widget.workContextWidth += 1;
        assert.deepEqual(widget.computeTitlebarLayout(),
            { compact: !windows, crowded: false, contextCloseOnly: false });
    });

    for (const overlay of [false, true]) {
        const mode = overlay ? 'maximized drawer' : 'normal drawer';
        test(`${platform} ${mode}: navigation respects whichever extends farther, the sidebar or left actions`, () => {
            const width = overlay ? 1000 : 1400;
            const { widget } = fixture({ windows, width, drawerWidth: overlay ? width : 400, overlay,
                contextPanelCollapsed: false, contextPanelWidth: overlay ? 435 : 580 });
            assert.deepEqual(widget.computeTitlebarLayout(), { compact: true, crowded: false, contextCloseOnly: false });
            widget.contextPanelWidth = overlay ? 436 : 582;
            assert.deepEqual(widget.computeTitlebarLayout(), { compact: false, crowded: true, contextCloseOnly: false },
                'the visible sidebar must remain clear even when native actions end farther left');

            const actions = { offsetLeft: overlay ? 335 : 390, offsetWidth: 100 };
            const measured = fixture({ windows, width, drawerWidth: overlay ? width : 400, overlay,
                contextPanelCollapsed: false, contextPanelWidth: 220, actions }).widget;
            assert.deepEqual(measured.computeTitlebarLayout(), { compact: true, crowded: false, contextCloseOnly: false });
            actions.offsetLeft += 1;
            assert.deepEqual(measured.computeTitlebarLayout(), { compact: false, crowded: true, contextCloseOnly: false },
                'left actions must remain clear even when the sidebar ends farther left');
        });
    }
}

test('Windows native caption controls select Windows geometry before the body class is mounted', () => {
    const { widget } = fixture({ width: 390, drawerWidth: 390, overlay: true, captionControls: true });
    assert.equal(widget.computeTitlebarLayout().contextCloseOnly, true);
    const mac = fixture({ width: 390, drawerWidth: 390, overlay: true }).widget;
    assert.equal(mac.computeTitlebarLayout().contextCloseOnly, false);
});

test('close-only remains inactive outside the coding drawer and in detached or unmeasured shells', () => {
    for (const overrides of [{ workContextOpen: false }, { activeSection: 'comic' }]) {
        assert.equal(fixture({ width: 300, drawerWidth: 100, ...overrides }).widget.computeTitlebarLayout().contextCloseOnly, false);
    }
    for (const overrides of [{ detachedConversationId: 'detached' }, { width: 0 }, { width: -1 }]) {
        assert.deepEqual(fixture(overrides).widget.computeTitlebarLayout(),
            { compact: false, crowded: false, contextCloseOnly: false });
    }
});

test('syncPaneCssVariables toggles close-only independently of an already crowded primary navigation', () => {
    const { widget, classes } = fixture();
    let closeOnly = true;
    widget.computeTitlebarLayout = () => ({ compact: false, crowded: true, contextCloseOnly: closeOnly });
    widget.syncPaneCssVariables();
    assert.equal(widget.titlebarContextCloseOnly, true);
    assert.ok(classes.has('is-titlebar-context-close-only'));
    closeOnly = false;
    widget.syncPaneCssVariables();
    assert.equal(widget.titlebarContextCloseOnly, false);
    assert.equal(classes.has('is-titlebar-context-close-only'), false);
    assert.ok(classes.has('is-titlebar-crowded'));
});

test('constrainPaneSizes reports and synchronizes changes to close-only without other pane or titlebar changes', () => {
    const { widget, classes } = fixture({ contextPanelCollapsed: false, titlebarCrowded: true });
    Object.assign(widget, {
        preferredContextPanelWidth: widget.contextPanelWidth,
        preferredWorkContextWidth: widget.workContextWidth,
        terminalListWidth: 220, preferredTerminalListWidth: 220,
        contextFileListWidth: 180, preferredContextFileListWidth: 180,
        terminalDrawerHeight: 240, preferredTerminalDrawerHeight: 240,
        clampPaneSize: (value, min, max) => Math.max(min, Math.min(max, value)),
        contextPanelMaximumWidth: () => 500, workContextMaximumWidth: () => 1400,
        terminalListMinimumWidth: () => 100, contextFileListMaximumWidth: () => 400,
        terminalMaximumHeight: () => 600
    });
    let closeOnly = true;
    widget.computeTitlebarLayout = () => ({ compact: false, crowded: true, contextCloseOnly: closeOnly });
    assert.equal(widget.constrainPaneSizes(), true);
    assert.equal(widget.titlebarContextCloseOnly, true);
    assert.ok(classes.has('is-titlebar-context-close-only'));
    assert.equal(widget.constrainPaneSizes(), false, 'an unchanged layout does not trigger a rerender');
    closeOnly = false;
    assert.equal(widget.constrainPaneSizes(), true);
    assert.equal(widget.titlebarContextCloseOnly, false);
    assert.equal(classes.has('is-titlebar-context-close-only'), false);
    assert.equal(widget.constrainPaneSizes(), false);
});

const readingMethodNames = ['captureThreadReadingAnchor', 'restoreThreadReadingAnchor', 'onCodingStageScroll',
    'onThreadAtBottomStateChange', 'schedulePaneResizeUpdate'];
for (const name of readingMethodNames) assert.ok(members.has(name), `${name} exists`);
const readingCode = ts.transpileModule(`class ReadingWidget {
    ${readingMethodNames.map(name => members.get(name)).join('\n')}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function readingFixture() {
    const frames = new Map();
    const timers = new Map();
    const calls = { bottom: 0, markers: 0, updates: 0, revealed: 0, persisted: 0 };
    let nextFrame = 0;
    let nextTimer = 0;
    const requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
    const window = { requestAnimationFrame, clearTimeout: id => timers.delete(id),
        setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; } };
    const selectActiveThreadMarker = (turns, top, atBottom, latest) => {
        calls.markers++;
        return atBottom ? latest : [...turns].reverse().find(turn => turn.top <= top)?.id || turns[0]?.id;
    };
    const Widget = new Function('requestAnimationFrame', 'window', 'selectActiveThreadMarker',
        `${readingCode}\nreturn ReadingWidget;`)(requestAnimationFrame, window, selectActiveThreadMarker);
    const stage = { clientWidth: 900, clientHeight: 500, scrollHeight: 5000, scrollTop: 376,
        getBoundingClientRect: () => ({ top: 100 }) };
    const layout = [
        { id: 'older', top: 0, height: 200 },
        { id: 'reading', top: 200, height: 400 },
        { id: 'later', top: 600, height: 300 }
    ];
    const turns = layout.map(item => ({ dataset: { turnId: item.id }, getBoundingClientRect() {
        const top = 100 + item.top - stage.scrollTop;
        return { top, height: item.height, bottom: top + item.height };
    } }));
    stage.querySelectorAll = () => turns;
    const widget = Object.assign(new Widget(), {
        node: { querySelector: selector => selector === '.nmx-task-view' ? stage : null },
        activeCodingSessionId: 'session-a', activeThreadTurnId: 'reading',
        threadAwayFromBottom: true, threadUnseenUpdates: 0, threadScrollScheduled: false,
        threadVirtuosoRef: { current: { autoscrollToBottom() { calls.bottom++; } } },
        threadUserScrolledRecently: () => true,
        latestThreadTurnId: () => 'later',
        setActiveThreadMarker(id) {
            const changed = this.activeThreadTurnId !== id;
            this.activeThreadTurnId = id;
            return changed;
        },
        revealActiveThreadMarker() { calls.revealed++; },
        update() { calls.updates++; },
        persistActiveCodingSessionState() { calls.persisted++; },
        paneResizeSignature: () => 'shell-geometry', paneResizeAppliedSignature: '',
        constrainPaneSizes: () => false, syncPaneCssVariables() {}, repositionModelEffortPicker() {}
    });
    const resize = (width, readingHeight) => {
        stage.clientWidth = width;
        layout[1].height = readingHeight;
        layout[2].top = layout[1].top + readingHeight;
    };
    const flushFrame = () => {
        const pending = [...frames.values()];
        frames.clear();
        for (const callback of pending) callback();
    };
    return { widget, stage, turns, layout, calls, frames, timers, resize, flushFrame };
}

test('thread reading anchor preserves the fractional position when a turn grows and shrinks with width', () => {
    const { widget, stage, resize } = readingFixture();
    widget.captureThreadReadingAnchor();
    assert.deepEqual(widget.threadReadingAnchor, {
        sessionId: 'session-a', turnId: 'reading', turnRatio: 0.5, offsetPx: 200, stageWidth: 900
    });
    resize(500, 800);
    widget.restoreThreadReadingAnchor();
    assert.equal(stage.scrollTop, 576);
    assert.equal(widget.threadReadingAnchor.stageWidth, 500);
    resize(1200, 200);
    widget.restoreThreadReadingAnchor(stage);
    assert.equal(stage.scrollTop, 276);
    assert.equal(widget.threadReadingAnchor.turnRatio, 0.5);
    assert.equal(widget.threadReadingAnchor.stageWidth, 1200);
});

test('thread reading anchors are session isolated and bottom readers retain Virtuoso following', () => {
    const { widget, stage, resize, calls } = readingFixture();
    widget.captureThreadReadingAnchor(stage);
    resize(500, 800);
    widget.activeCodingSessionId = 'session-b';
    widget.restoreThreadReadingAnchor(stage);
    assert.equal(stage.scrollTop, 376, 'another session cannot apply the old reading anchor');
    assert.equal(widget.threadReadingAnchor.stageWidth, 900);
    widget.threadAwayFromBottom = false;
    widget.restoreThreadReadingAnchor(stage);
    assert.equal(calls.bottom, 1);
    assert.equal(widget.threadReadingAnchor, undefined);
});

test('width reflow scroll restores the anchor without overwriting the active timeline marker', () => {
    const { widget, stage, resize, calls, flushFrame } = readingFixture();
    widget.captureThreadReadingAnchor(stage);
    widget.activeThreadTurnId = 'preserved-marker';
    resize(500, 800);
    widget.onCodingStageScroll();
    flushFrame();
    assert.equal(stage.scrollTop, 576);
    assert.equal(widget.activeThreadTurnId, 'preserved-marker');
    assert.equal(calls.markers, 0);
    assert.equal(widget.threadReadingAnchor.turnRatio, 0.5);
});

test('ordinary reader scrolling refreshes the reading anchor and active marker at unchanged width', () => {
    const { widget, stage, calls, timers, flushFrame } = readingFixture();
    widget.captureThreadReadingAnchor(stage);
    widget.activeThreadTurnId = 'older';
    stage.scrollTop += 50;
    widget.onCodingStageScroll();
    flushFrame();
    assert.equal(widget.activeThreadTurnId, 'reading');
    assert.equal(calls.markers, 1);
    assert.equal(widget.threadReadingAnchor.turnRatio, 0.625);
    assert.equal(widget.threadReadingAnchor.offsetPx, 250);
    assert.equal(timers.size, 1, 'the ordinary scroll position remains eligible for persistence');
});

test('pane resize restores around CSS width changes and again after the render frame', () => {
    const { widget, stage, resize, calls, frames, flushFrame } = readingFixture();
    widget.captureThreadReadingAnchor(stage);
    widget.syncPaneCssVariables = () => resize(500, 800);
    widget.update = () => {
        calls.updates++;
        assert.equal(stage.scrollTop, 576, 'CSS reflow is restored before the widget render');
        resize(500, 1000);
    };
    widget.schedulePaneResizeUpdate();
    widget.schedulePaneResizeUpdate();
    assert.equal(frames.size, 1, 'duplicate resize notifications share one scheduled update');
    flushFrame();
    assert.equal(calls.updates, 1);
    assert.equal(frames.size, 1, 'a post-render restoration is queued');
    flushFrame();
    assert.equal(stage.scrollTop, 676);
    assert.equal(widget.threadReadingAnchor.turnRatio, 0.5);
});

test('anchor capture handles the first visible turn and ignores an unmeasured stage', () => {
    const { widget, stage, layout } = readingFixture();
    stage.scrollTop = 0;
    layout[0].top = 80;
    widget.captureThreadReadingAnchor(stage);
    assert.equal(widget.threadReadingAnchor.turnId, 'older');
    assert.equal(widget.threadReadingAnchor.turnRatio, 0);
    const anchor = widget.threadReadingAnchor;
    stage.clientWidth = 0;
    widget.captureThreadReadingAnchor(stage);
    assert.equal(widget.threadReadingAnchor, anchor);
});

test('Virtuoso bottom callbacks preserve reading intent during width reflow before scroll handling', async () => {
    for (const [width, height, restoredScrollTop] of [[902, 200, 276], [898, 800, 576]]) {
        const { widget, stage, resize, frames, flushFrame } = readingFixture();
        widget.captureThreadReadingAnchor(stage);
        widget.threadUnseenUpdates = 3;
        resize(width, height);
        widget.onThreadAtBottomStateChange(true);
        assert.equal(widget.threadAwayFromBottom, true, 'reflow must not change the reader into bottom-follow mode');
        assert.equal(widget.activeThreadTurnId, 'reading');
        assert.equal(widget.threadUnseenUpdates, 3);
        assert.equal(frames.size, 1, 'the independent Virtuoso callback schedules width restoration');
        flushFrame();
        flushFrame();
        assert.equal(stage.scrollTop, restoredScrollTop);
        assert.equal(widget.threadReadingAnchor.stageWidth, width);
        widget.onThreadAtBottomStateChange(true);
        assert.equal(widget.threadAwayFromBottom, false, 'a subsequent genuine bottom callback still works');
        assert.equal(widget.activeThreadTurnId, 'later');
        assert.equal(widget.threadUnseenUpdates, 0);
        await Promise.resolve();
    }
    const { widget, stage } = readingFixture();
    widget.captureThreadReadingAnchor(stage);
    stage.clientWidth += 1;
    widget.onThreadAtBottomStateChange(true);
    assert.equal(widget.threadAwayFromBottom, false, 'one pixel of measurement noise does not defer bottom state');
    await Promise.resolve();
});

test('hidden stages retain reading anchors while removed turns release them for later user scrolling', () => {
    const { widget, stage, turns, calls, flushFrame } = readingFixture();
    widget.captureThreadReadingAnchor(stage);
    const anchor = widget.threadReadingAnchor;
    for (const width of [0, -1]) {
        stage.clientWidth = width;
        widget.restoreThreadReadingAnchor(stage);
        assert.equal(widget.threadReadingAnchor, anchor, 'temporary hidden geometry keeps the original anchor');
        assert.equal(widget.threadReadingAnchor.stageWidth, 900);
        assert.equal(stage.scrollTop, 376);
    }
    stage.clientWidth = 500;
    turns.splice(1, 1);
    widget.restoreThreadReadingAnchor(stage);
    assert.equal(widget.threadReadingAnchor, undefined, 'an unmounted turn cannot keep intercepting width scrolls');
    widget.onCodingStageScroll();
    flushFrame();
    assert.equal(calls.markers, 1, 'later scrolling reaches the normal marker and anchor update path');
    assert.equal(widget.threadReadingAnchor.turnId, 'older');
    assert.equal(widget.threadReadingAnchor.stageWidth, 500);
});
