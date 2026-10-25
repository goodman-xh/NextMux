import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/nextmux-desktop-contribution.ts', import.meta.url), 'utf8');
const file = ts.createSourceFile('contribution.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const members = [], names = new Set(['handleProductWorkbenchShortcut', 'canHandleNavigationShortcut', 'registerCommands', 'registerKeybindings']);
let commands;
function visit(node) {
    if ((ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) && names.has(node.name.getText(file))) members.push(node.getText(file));
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'NextMuxCommands') commands = node.initializer.getText(file);
    ts.forEachChild(node, visit);
}
visit(file);
const code = ts.transpile(`const NextMuxCommands = ${commands}; class Base { registerKeybindings() {} } class Harness extends Base { ${members.join('\n')} }; return Harness;`, { target: ts.ScriptTarget.ES2022 });
class Element {
    constructor(kind = 'button') { this.kind = kind; this.isContentEditable = kind === 'contenteditable'; }
    closest(selector) { return selector.split(',').map(value => value.trim()).includes(this.kind) ? this : null; }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(mac) {
    const calls = [], handlers = new Map(), bindings = [], document = { activeElement: new Element() };
    const widget = {
        back: true, forward: true,
        canNavigateBack() { return this.back; }, canNavigateForward() { return this.forward; },
        commandNavigateBack() { calls.push('back'); }, commandNavigateForward() { calls.push('forward'); }
    };
    const Harness = new Function('isOSX', 'Element', 'HTMLElement', 'document', 'readDesktopLocale', 'desktopText', 'productMenuText', 'localizeDesktopSurface', 'workbenchText', 'NextMuxDesktopCommand', 'canvasKeyboardOwnsTarget', code)(
        mac, Element, Element, document, () => 'zh-CN', (_, text) => text, (_, text) => text, (_, text) => text, (_, text) => text,
        { id: 'nextmux.desktop.open' }, () => false
    );
    const state = Object.assign(new Harness(), { tryGetWidget: () => widget, openView: async () => widget });
    state.registerCommands({ registerCommand(command, handler) { handlers.set(command.id, handler); } });
    state.registerKeybindings({ registerKeybinding(binding) { bindings.push(binding); } });
    const dispatch = (key, options = {}) => {
        const event = { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, keyCode: 0,
            target: new Element(), prevented: false, defaultPrevented: false, stopped: false,
            preventDefault() { this.prevented = this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; },
            stopImmediatePropagation() { this.stopped = true; }, ...options };
        document.activeElement = event.target;
        state.handleProductWorkbenchShortcut(event);
        return event;
    };
    return { state, widget, calls, handlers, bindings, document, dispatch };
}
const navigationBindings = fixture => fixture.bindings.filter(binding => /\.navigate(?:Back|Forward)$/.test(binding.command));

test('platform registration includes all standard navigation bindings', () => {
    assert.deepEqual(navigationBindings(fixture(true)).map(({ command, keybinding }) => [command, keybinding]), [
        ['nextmux.desktop.navigateBack', 'cmd+['], ['nextmux.desktop.navigateBack', 'cmd+alt+left'],
        ['nextmux.desktop.navigateForward', 'cmd+]'], ['nextmux.desktop.navigateForward', 'cmd+alt+right']
    ]);
    assert.deepEqual(navigationBindings(fixture(false)).map(({ command, keybinding }) => [command, keybinding]), [
        ['nextmux.desktop.navigateBack', 'alt+left'], ['nextmux.desktop.navigateForward', 'alt+right']
    ]);
});

test('both platforms dispatch every supported chord once through the widget navigation commands', async () => {
    for (const mac of [true, false]) {
        const f = fixture(mac);
        const cases = mac ? [['[', { metaKey: true }], [']', { metaKey: true }], ['ArrowLeft', { metaKey: true, altKey: true }], ['ArrowRight', { metaKey: true, altKey: true }]]
            : [['ArrowLeft', { altKey: true }], ['ArrowRight', { altKey: true }]];
        for (const [key, options] of cases) {
            const event = f.dispatch(key, options);
            assert.equal(event.prevented, true); assert.equal(event.stopped, true);
        }
        await tick();
        assert.deepEqual(f.calls, mac ? ['back', 'forward', 'back', 'forward'] : ['back', 'forward']);
    }
});

test('capture leaves alternate modifiers and IME input alone', async () => {
    for (const mac of [true, false]) {
        const f = fixture(mac), key = mac ? '[' : 'ArrowLeft', modifiers = mac ? { metaKey: true } : { altKey: true };
        for (const options of [{ shiftKey: true }, { ctrlKey: true }, { isComposing: true }, { keyCode: 229 }]) {
            const event = f.dispatch(key, { ...modifiers, ...options });
            assert.equal(event.prevented, false); assert.equal(event.stopped, false);
        }
        const otherPlatform = f.dispatch(mac ? 'ArrowLeft' : '[', mac ? { altKey: true } : { metaKey: true });
        assert.equal(otherPlatform.prevented, false);
        await tick(); assert.deepEqual(f.calls, []);
    }
});

test('editors, terminals, browser surfaces and editable fields retain their keys in both dispatch paths', async () => {
    for (const mac of [true, false]) for (const kind of ['.monaco-editor', '.xterm', '.nmx-terminal-host', '.nmx-context-browser', 'webview', 'iframe', 'input', 'textarea', 'select', 'contenteditable']) {
        const f = fixture(mac), target = new Element(kind);
        const event = f.dispatch(mac ? '[' : 'ArrowLeft', { ...(mac ? { metaKey: true } : { altKey: true }), target });
        assert.equal(event.prevented, false, kind); assert.equal(event.stopped, false, kind);
        for (const binding of navigationBindings(f)) assert.equal(f.handlers.get(binding.command).isEnabled(binding.args), false, `${kind}: registry must not recapture a key`);
        await tick(); assert.deepEqual(f.calls, [], kind);
    }
});

test('command enabled state follows widget history independently of editing focus for explicit commands', async () => {
    const f = fixture(true), back = f.handlers.get('nextmux.desktop.navigateBack'), forward = f.handlers.get('nextmux.desktop.navigateForward');
    assert.ok(back && forward);
    assert.equal(back.isEnabled(), true); assert.equal(forward.isEnabled(), true);
    f.document.activeElement = new Element('textarea');
    assert.equal(back.isEnabled(), true); assert.equal(forward.isEnabled(), true);
    await back.execute(); await forward.execute(); assert.deepEqual(f.calls, ['back', 'forward']);
    f.widget.back = false; assert.equal(back.isEnabled(), false); assert.equal(forward.isEnabled(), true);
    f.widget.forward = false; assert.equal(forward.isEnabled(), false);
    f.state.tryGetWidget = () => undefined;
    assert.equal(back.isEnabled(), false); assert.equal(forward.isEnabled(), false);
});

test('unavailable navigation consumes app navigation chords without issuing commands or browser history traversal', async () => {
    const f = fixture(false); f.widget.back = false; f.widget.forward = false;
    for (const key of ['ArrowLeft', 'ArrowRight']) assert.equal(f.dispatch(key, { altKey: true }).prevented, true);
    await tick(); assert.deepEqual(f.calls, []);
});

test('an earlier keyboard owner can cancel navigation before the product capture handler', async () => {
    for (const mac of [true, false]) {
        const f = fixture(mac);
        const event = f.dispatch(mac ? '[' : 'ArrowLeft', { ...(mac ? { metaKey: true } : { altKey: true }), defaultPrevented: true });
        assert.equal(event.prevented, false, 'do not re-consume another listener’s event');
        assert.equal(event.stopped, false, 'let the owning listener control propagation');
        await tick(); assert.deepEqual(f.calls, []);
    }
});

test('before the widget exists navigation cannot create a view or leave the renderer page', () => {
    const f = fixture(false);
    f.state.tryGetWidget = () => undefined;
    f.state.openView = () => assert.fail('history shortcuts must not create a widget during startup or shutdown');
    for (const key of ['ArrowLeft', 'ArrowRight']) {
        const event = f.dispatch(key, { altKey: true });
        assert.equal(event.prevented, true); assert.equal(event.stopped, true);
    }
    assert.deepEqual(f.calls, []);
});

// Exercise the installed Theia listener and dispatch implementation, since a key
// yielded by the window capture handler next reaches its document listener.
const registrySource = readFileSync(new URL('../node_modules/@theia/core/src/browser/keybinding.ts', import.meta.url), 'utf8');
const registryFile = ts.createSourceFile('keybinding.ts', registrySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const registryClass = registryFile.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'KeybindingRegistry');
const registryMethods = ['registerEventListeners', 'run', 'isEnabledInScope', 'executeKeyBinding'].map(name => {
    const method = registryClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(registryFile) === name);
    assert.ok(method, `installed Theia ${name}`);
    return method.getText(registryFile);
});
function registryFixture(f, binding) {
    const listeners = new Map();
    const Registry = new Function('Disposable', 'KeyCode', ts.transpile(`class Registry { ${registryMethods.join('\n')} }; return Registry;`, { target: ts.ScriptTarget.ES2022 }))(
        { create: dispose => ({ dispose }) }, { createKeyCode: event => ({ event, isModifierOnly: () => false }) }
    );
    const registry = Object.assign(new Registry(), {
        corePreferences: {}, contexts: {}, keySequence: [], keyboardLayoutService: { validateKeyCode() {} },
        statusBar: { removeElement() {} }, isPseudoCommand: () => false,
        commandRegistry: {
            getCommand: id => f.handlers.has(id) ? { id } : undefined,
            isEnabled: (id, args) => f.handlers.get(id)?.isEnabled(args),
            executeCommand: (id, args) => f.handlers.get(id).execute(args)
        },
        matchKeybinding(_keys, event) { return this.isEnabledInScope(binding, event.target) ? { kind: 'full', binding } : undefined; },
        logger: { error: (_message, error) => { throw error; } }
    });
    const disposable = registry.registerEventListeners({ document: {
        addEventListener: (type, callback) => listeners.set(type, callback),
        removeEventListener: type => listeners.delete(type)
    } });
    return { listeners, dispose: () => disposable.dispose(), dispatch: event => { if (!event.stopped) listeners.get('keydown')(event); } };
}

test('Theia fallback preserves IME and cancelled keys and cannot recapture editable shortcuts', async () => {
    const f = fixture(false), registry = registryFixture(f, navigationBindings(f)[0]);
    for (const options of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }, { target: new Element('textarea') }, { target: new Element('.monaco-editor') }]) {
        const event = f.dispatch('ArrowLeft', { altKey: true, ...options });
        registry.dispatch(event);
        assert.equal(event.prevented, false);
    }
    registry.listeners.get('compositionstart')();
    registry.listeners.get('keydown')({ defaultPrevented: false, target: new Element(), isComposing: false, keyCode: 0 });
    registry.listeners.get('compositionend')();
    await tick(); assert.deepEqual(f.calls, []);
    const handled = f.dispatch('ArrowLeft', { altKey: true });
    registry.dispatch(handled); await tick(); assert.deepEqual(f.calls, ['back'], 'capture and registry do not double-navigate');
    registry.dispose(); assert.equal(registry.listeners.size, 0);
});

const widgetSource = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const widgetFile = ts.createSourceFile('widget.tsx', widgetSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widgetClass = widgetFile.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const widgetMember = name => {
    const method = widgetClass.members.find(node => node.name?.getText(widgetFile) === name);
    assert.ok(method, `production widget ${name}`); return method;
};
const windowParts = widgetMember('renderWindowParts');
const navigationButtons = [];
function collectNavigationButtons(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(widgetFile) === 'button') {
        const label = node.openingElement.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(widgetFile) === 'aria-label');
        if (label?.initializer && ts.isStringLiteral(label.initializer) && ['返回上一页', '前进到下一页'].includes(label.initializer.text)) navigationButtons.push(node);
    }
    ts.forEachChild(node, collectNavigationButtons);
}
collectNavigationButtons(windowParts);
assert.equal(navigationButtons.length, 2, 'both stable accessible navigation controls remain in the real window');
const windowLocals = windowParts.body.statements.filter(ts.isVariableStatement).map(node => node.getText(widgetFile)).join('\n');
const buttonHarnessCode = ts.transpile(`class Widget {
    ${['commandNavigateBack', 'commandNavigateForward'].map(name => widgetMember(name).getText(widgetFile)).join('\n')}
    renderButtons() { ${windowLocals}; return [${navigationButtons.map(node => node.getText(widgetFile)).join(',')}]; }
}; return Widget;`, { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React });

test('actual titlebar controls expose platform hints, stable labels, live availability and the shared navigation pipeline', () => {
    for (const [platform, userAgent, hints] of [
        ['MacIntel', '', ['⌘[', '⌘]']], ['Win32', '', ['Alt+←', 'Alt+→']],
        ['Linux x86_64', '', ['Alt+←', 'Alt+→']], ['', 'Macintosh', ['⌘[', '⌘]']]
    ]) {
        const Widget = new Function('navigator', 'React', buttonHarnessCode)({ platform, userAgent }, { createElement: (type, props) => ({ type, props }) });
        const calls = [], state = Object.assign(new Widget(), {
            back: false, forward: false, canNavigateBack() { return this.back; }, canNavigateForward() { return this.forward; },
            runNavigationCommand(direction) { calls.push(direction); return Promise.resolve(); }
        });
        for (const [back, forward] of [[false, false], [true, false], [false, true], [true, true]]) {
            Object.assign(state, { back, forward });
            const buttons = state.renderButtons();
            for (const [index, label] of ['返回上一页', '前进到下一页'].entries()) {
                const { props } = buttons[index];
                assert.equal(props['aria-label'], label);
                assert.equal(props.title, `${label} (${hints[index]})`);
                assert.equal(props['data-nmx-tip'], props.title);
                assert.equal(props.disabled, ![back, forward][index]);
                if (!props.disabled) props.onClick();
            }
        }
        assert.deepEqual(calls, ['back', 'forward', 'back', 'forward'], `${platform || userAgent}: both buttons use command wrappers and runNavigationCommand`);
    }
});
