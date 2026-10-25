import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Portal DOM ancestry: https://react.dev/reference/react-dom/createPortal
// Capture listeners: https://dom.spec.whatwg.org/#introduction-to-dom-events
// Virtuoso item wrappers: https://virtuoso.dev/react-virtuoso/virtuoso/customize-rendering/
// Execute production methods with DOM geometry fixtures, plus listener/JSX contracts.
// These regression checks do not replace interaction testing in the desktop GUI.
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const member = name => {
    const found = widget.members.find(node => node.name?.getText(file) === name);
    assert.ok(found, `production member ${name}`);
    return found.getText(file);
};
const compile = text => ts.transpile(text, { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React });

class ElementFixture {
    constructor(selectors = [], classes = []) {
        this.selectors = new Set(selectors);
        const names = new Set(classes);
        this.classList = { contains: name => names.has(name), add: name => names.add(name), remove: name => names.delete(name) };
    }
    closest(selector) {
        return selector.split(',').some(part => this.selectors.has(part.trim())) ? this : null;
    }
}

function harness(names, dependencies = {}) {
    const bindings = { Element: ElementFixture, HTMLElement: ElementFixture, requestAnimationFrame() {}, ...dependencies };
    const Harness = new Function(...Object.keys(bindings), compile(`class Harness { ${names.map(member).join('\n')} }; return Harness;`))(...Object.values(bindings));
    return Object.assign(new Harness(), {
        conversationTabMenuAt: { x: 240, y: 80 }, codingSessionMenuId: '', updates: 0,
        update() { this.updates++; }
    });
}

test('outside pointerdown dismisses the portal tab menu without closing the work context drawer', () => {
    const state = harness(['handleModelPickerOutsidePointerDown']);
    state.workContextOpen = true;
    state.handleModelPickerOutsidePointerDown({ target: new ElementFixture(['.nmx-code-block']) });
    assert.equal(state.conversationTabMenuAt, undefined);
    assert.equal(state.workContextOpen, true);
    assert.equal(state.updates, 1);
    state.handleModelPickerOutsidePointerDown({ target: new ElementFixture() });
    assert.equal(state.updates, 1, 'already closed menus do not force another render');
});

test('pointerdown inside the portal menu keeps its actions available', () => {
    const state = harness(['handleModelPickerOutsidePointerDown']);
    const menu = state.conversationTabMenuAt;
    state.handleModelPickerOutsidePointerDown({ target: new ElementFixture(['.nmx-conversation-tab-menu']) });
    assert.equal(state.conversationTabMenuAt, menu);
    assert.equal(state.updates, 0);
});

test('outside pointerdown also dismisses session menus and renders both closures once', () => {
    const state = harness(['handleModelPickerOutsidePointerDown']);
    state.codingSessionMenuId = 'session-one';
    state.handleModelPickerOutsidePointerDown({ target: new ElementFixture() });
    assert.equal(state.conversationTabMenuAt, undefined);
    assert.equal(state.codingSessionMenuId, '');
    assert.equal(state.updates, 1);
});

test('session menu items and their ellipsis trigger survive pointerdown', () => {
    for (const selector of ['.nmx-session-menu', '.nmx-session-more']) {
        const state = harness(['handleModelPickerOutsidePointerDown']);
        state.conversationTabMenuAt = undefined;
        state.codingSessionMenuId = 'session-one';
        state.handleModelPickerOutsidePointerDown({ target: new ElementFixture([selector]) });
        assert.equal(state.codingSessionMenuId, 'session-one');
        assert.equal(state.updates, 0);
    }
});

test('the tab menu is a dismissible transient surface and completion leaves the drawer open', () => {
    const state = harness(['hasDismissibleSurface', 'hasTransientNavigationSurface', 'dismissTopSurface', 'completeNavigationSurface']);
    assert.equal(state.hasDismissibleSurface(), true);
    assert.equal(state.hasTransientNavigationSurface(), true);
    Object.assign(state, {
        workContextOpen: true, navigationBackStack: [], navigationForwardStack: [],
        navigationSnapshot: () => ({}), closeWorkContextDrawer() { this.workContextOpen = false; }
    });
    state.completeNavigationSurface();
    assert.equal(state.conversationTabMenuAt, undefined);
    assert.equal(state.workContextOpen, true, 'completion closes the top menu, not its underlying drawer');
    assert.equal(state.hasTransientNavigationSurface(), false);
    state.workContextOpen = false;
    assert.equal(state.hasDismissibleSurface(), false);
    assert.equal(state.dismissTopSurface(), false);
});

test('floating surface dismissal preserves menu-internal clicks and closes only the tab menu on outside clicks', () => {
    const state = harness(['dismissFloatingSurfaces', 'hasDismissibleSurface', 'dismissTopSurface', 'completeNavigationSurface']);
    Object.assign(state, {
        workContextOpen: true, navigationBackStack: [], navigationForwardStack: [],
        navigationSnapshot: () => ({}), closeWorkContextDrawer() { this.workContextOpen = false; }
    });
    const classes = member('renderConversationTabs').match(/className='([^']*nmx-conversation-tab-menu[^']*)'/)?.[1].split(/\s+/);
    assert.ok(classes, 'use the classes of the actual portal menu');
    state.dismissFloatingSurfaces(new ElementFixture(classes.map(name => `.${name}`)));
    assert.ok(state.conversationTabMenuAt, 'menu-internal clicks remain available');
    assert.equal(state.updates, 0);
    state.dismissFloatingSurfaces(new ElementFixture(['.nmx-code-block']));
    assert.equal(state.conversationTabMenuAt, undefined);
    assert.equal(state.workContextOpen, true, 'dismissFloatingSurfaces → completeNavigationSurface preserves the drawer');
});

function listenerHost() {
    const listeners = new Map();
    return {
        listeners,
        addEventListener(type, handler, options) { listeners.set(type, { handler, options }); },
        removeEventListener(type, handler, options) {
            const registered = listeners.get(type);
            assert.equal(registered?.handler, handler, `remove the registered ${type} handler`);
            const capture = value => typeof value === 'boolean' ? value : Boolean(value?.capture);
            assert.equal(capture(options), capture(registered.options), `matching ${type} capture on dispose`);
            listeners.delete(type);
        }
    };
}

function scrollActivityFixture() {
    const attach = member('init');
    const start = attach.indexOf('const scrollIdleTimers');
    const end = attach.indexOf('const guardFileDrop', start);
    assert.ok(start >= 0 && end > start, 'production scroll activity setup');
    const window = Object.assign(listenerHost(), { setTimeout: () => 1, clearTimeout() {} });
    const state = {
        node: listenerHost(), toDispose: [], conversationTabMenuAt: { x: 240, y: 80 }, updates: 0,
        update() { this.updates++; }
    };
    new Function('window', 'Element', 'HTMLElement', compile(attach.slice(start, end)))
        .call(state, window, ElementFixture, ElementFixture);
    return { state, window };
}

test('window capture wheel and node capture scroll dismiss even events from nested code blocks', () => {
    const { state, window } = scrollActivityFixture();
    for (const [host, eventType] of [[window, 'wheel'], [state.node, 'scroll']]) {
        const registration = host.listeners.get(eventType);
        assert.ok(registration, `${eventType} listener is registered`);
        assert.equal(typeof registration.options === 'boolean' ? registration.options : registration.options.capture, true);
        state.conversationTabMenuAt = { x: 240, y: 80 };
        const before = state.updates;
        registration.handler({ type: eventType, target: new ElementFixture(['.nmx-code-block']) });
        assert.equal(state.conversationTabMenuAt, undefined, `${eventType} from a non-stage descendant dismisses the menu`);
        assert.equal(state.updates, before + 1);
    }
    for (const disposable of state.toDispose) disposable.dispose();
    assert.equal(window.listeners.size, 0, 'window wheel listener is removed on dispose');
    assert.equal(state.node.listeners.size, 0, 'node scroll listener is removed on dispose');
});

test('scrolling inside the portal menu keeps it open', () => {
    const { state, window } = scrollActivityFixture();
    for (const [host, eventType] of [[window, 'wheel'], [state.node, 'scroll']]) {
        const registration = host.listeners.get(eventType);
        assert.ok(registration, `${eventType} listener is registered`);
        registration.handler({ type: eventType, target: new ElementFixture(['.nmx-conversation-tab-menu']) });
        assert.ok(state.conversationTabMenuAt);
    }
    assert.equal(state.updates, 0);
    for (const disposable of state.toDispose) disposable.dispose();
});

test('wheel dismissal does not start scrollbar activity and scroll activity is cleaned up', () => {
    const { state, window } = scrollActivityFixture();
    const stage = new ElementFixture([], ['nmx-task-view']);
    const wheel = window.listeners.get('wheel');
    assert.ok(wheel, 'window wheel listener');
    wheel.handler({ type: 'wheel', target: stage });
    assert.equal(stage.classList.contains('is-scrolling'), false);
    state.node.listeners.get('scroll').handler({ type: 'scroll', target: stage });
    assert.equal(stage.classList.contains('is-scrolling'), true);
    for (const disposable of state.toDispose) disposable.dispose();
    assert.equal(stage.classList.contains('is-scrolling'), false);
});

test('stage scroll dismisses the tab menu even when a scroll animation frame is already queued', () => {
    const state = harness(['onCodingStageScroll']);
    state.threadScrollScheduled = true;
    state.onCodingStageScroll();
    assert.equal(state.conversationTabMenuAt, undefined);
    assert.equal(state.updates, 1);
    state.onCodingStageScroll();
    assert.equal(state.updates, 1);
});

function virtuosoHandler(name, state) {
    let expression;
    const visit = node => {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(file) === 'Virtuoso') {
            const attribute = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(file) === name);
            if (attribute?.initializer && ts.isJsxExpression(attribute.initializer)) expression = attribute.initializer.expression;
        }
        ts.forEachChild(node, visit);
    };
    visit(file);
    assert.ok(expression, `Virtuoso ${name} handler`);
    return new Function(compile(`return function () { return (${expression.getText(file)}); };`))().call(state);
}

test('Virtuoso wheel capture closes the tab menu while preserving user scroll intent', () => {
    const state = {
        conversationTabMenuAt: { x: 240, y: 80 }, threadJumpToken: 0, updates: 0, intents: 0, followCancelled: 0, restoreCancelled: 0,
        update() { this.updates++; }, noteThreadUserScrollIntent() { this.intents++; },
        cancelThreadBottomFollow() { this.followCancelled++; }, cancelThreadScrollRestore() { this.restoreCancelled++; }
    };
    const onWheelCapture = virtuosoHandler('onWheelCapture', state);
    onWheelCapture({ deltaY: -10 });
    assert.equal(state.conversationTabMenuAt, undefined);
    assert.equal(state.updates, 1);
    assert.equal(state.threadJumpToken, 1);
    assert.equal(state.intents, 1);
    assert.equal(state.followCancelled, 1);
    assert.equal(state.restoreCancelled, 1);
});

test('Virtuoso pointer capture closes the tab menu and keeps drag scrolling intent', () => {
    const state = {
        conversationTabMenuAt: { x: 240, y: 80 }, threadJumpToken: 0, updates: 0, intents: [], followCancelled: 0, restoreCancelled: 0,
        update() { this.updates++; }, noteThreadUserScrollIntent(drag) { this.intents.push(drag); },
        cancelThreadBottomFollow() { this.followCancelled++; }, cancelThreadScrollRestore() { this.restoreCancelled++; }
    };
    virtuosoHandler('onPointerDownCapture', state)({});
    assert.equal(state.conversationTabMenuAt, undefined);
    assert.equal(state.updates, 1);
    assert.equal(state.threadJumpToken, 1);
    assert.deepEqual(state.intents, [true]);
    assert.equal(state.followCancelled, 1);
    assert.equal(state.restoreCancelled, 1);
});

test('outside pointerdown remains installed in capture phase with matching disposal', () => {
    const attach = member('init');
    assert.match(attach, /window\.addEventListener\('pointerdown', this\.handleModelPickerOutsidePointerDown, true\)/);
    assert.match(attach, /window\.removeEventListener\('pointerdown', this\.handleModelPickerOutsidePointerDown, true\)/);
});

function floatingFixture(options = {}) {
    const {
        turnCopy = true, triggerTurnCopy = turnCopy, triggerTop = 500, triggerBottom = triggerTop + 24,
        nextUserTop, nextUserLeft = 760, composerTop = 820, stageTop = 100, connected = true, virtualized = false
    } = options;
    const menu = {
        ownerDocument: { defaultView: { innerWidth: 1200, innerHeight: 900 } },
        classList: { contains: name => turnCopy && name === 'nmx-turn-copy-menu' },
        offsetWidth: 200, style: {},
        get offsetHeight() { return this.style.maxHeight ? Math.min(160, Number.parseInt(this.style.maxHeight)) : 160; }
    };
    const nextUserRect = nextUserTop === undefined ? undefined : { top: nextUserTop, bottom: nextUserTop + 80, left: nextUserLeft, right: 1000 };
    const nextItem = { querySelector: selector => selector === '.nmx-user-message' && nextUserRect ? { getBoundingClientRect: () => nextUserRect } : null };
    const turn = {
        nextElementSibling: virtualized ? null : nextItem,
        closest: selector => virtualized && selector === '[data-item-index]' ? { nextElementSibling: nextItem } : null
    };
    const trigger = {
        isConnected: connected,
        getBoundingClientRect: () => ({ top: triggerTop, bottom: triggerBottom, left: 976, right: 1000 }),
        closest: selector => selector === '.nmx-task-turn' ? turn : selector === '.nmx-turn-copy' && triggerTurnCopy ? {} : null
    };
    const state = harness(['placeFloatingMenu']);
    state.node = { querySelector: selector => selector === '.nmx-task-view' ? { getBoundingClientRect: () => ({ top: stageTop, bottom: 800 }) }
        : selector === '.nmx-composer-wrap' ? { getBoundingClientRect: () => ({ top: composerTop }) } : null };
    state.placeFloatingMenu(menu, trigger);
    return { menu, nextUserRect, state, trigger };
}

test('turn copy menus open downward and cover the next prompt without horizontal displacement', () => {
    for (const virtualized of [false, true]) for (const nextUserLeft of [90, 760]) {
        const { menu, nextUserRect } = floatingFixture({ triggerTop: 112, nextUserTop: 165, nextUserLeft, virtualized });
        assert.equal(menu.style.top, '142px');
        assert.equal(menu.style.left, '800px');
        assert.equal(menu.style.position, 'fixed');
        assert.equal(menu.style.right, 'auto');
        assert.equal(menu.style.bottom, 'auto');
        assert.equal(menu.style.maxHeight, '');
        assert.ok(Number.parseInt(menu.style.top) + menu.offsetHeight > nextUserRect.top);
    }
});

test('turn copy menus flip upward only when the downward position crosses the viewport floor', () => {
    assert.equal(floatingFixture({ triggerTop: 500, nextUserTop: 550 }).menu.style.top, '530px');
    assert.equal(floatingFixture({ triggerTop: 700, nextUserTop: 750 }).menu.style.top, '534px');
    assert.equal(floatingFixture({ triggerTop: 700, composerTop: 0 }).menu.style.top, '730px');
    assert.equal(floatingFixture({ triggerTop: 760, composerTop: 0 }).menu.style.top, '594px');
});

test('ordinary floating menus still open downward and flip upward at the composer boundary', () => {
    assert.equal(floatingFixture({ turnCopy: false }).menu.style.top, '530px');
    assert.equal(floatingFixture({ turnCopy: false, triggerTop: 700 }).menu.style.top, '534px');
    assert.deepEqual(floatingFixture({ connected: false }).menu.style, {}, 'detached triggers are not positioned');
});


test('turn menu stacking promotes its Virtuoso item so downward overlap remains visible', () => {
    for (const name of ['nextmux.css', 'nextmux-desktop-production.css']) {
        const css = readFileSync(new URL(`../src/browser/style/${name}`, import.meta.url), 'utf8');
        assert.match(css, /\[data-item-index\]:has\(\.nmx-message-menu\)[^{]*\{[^}]*z-index:\s*[1-9]\d*[^}]*overflow:\s*visible/);
        assert.match(css, /\.nmx-turn-copy-menu\s*\{[^}]*z-index:\s*[1-9]\d*/);
    }
});
