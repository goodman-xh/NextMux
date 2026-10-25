import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
const style = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux.css', import.meta.url)), 'utf8');
const protocol = readFileSync(fileURLToPath(new URL('../src/common/nextmux-platform-protocol.ts', import.meta.url)), 'utf8');
const service = readFileSync(fileURLToPath(new URL('../src/node/nextmux-platform-service.ts', import.meta.url)), 'utf8');

const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const commandHostClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxCommandOutputHost');
assert.ok(commandHostClass);
const commandHostCode = ts.transpileModule(commandHostClass.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }
}).outputText;

function commandHostFixture(props = {}) {
    const frames = new Map();
    const terminals = [];
    const observers = [];
    let nextFrame = 0;
    let fitCalls = 0;
    const requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
    const React = {
        PureComponent: class { constructor(initialProps) { this.props = initialProps; } },
        Fragment: Symbol('Fragment'),
        createElement: (type, attributes, ...children) => ({ type, props: { ...attributes, children } })
    };
    class Terminal {
        constructor(options) {
            this.options = options;
            this.rows = 3;
            this.buffer = { active: { baseY: 0, viewportY: 0 } };
            this.writes = [];
            terminals.push(this);
        }
        loadAddon() {}
        open() {}
        attachCustomKeyEventHandler() {}
        reset() { this.writes.length = 0; }
        write(value, callback) { this.writes.push(value); callback?.(); }
        scrollToBottom() {}
    }
    const CommandHost = new Function('React', 'XtermTerminal', 'FitAddon', 'ResizeObserver',
        'requestAnimationFrame', 'cancelAnimationFrame', 'NEXTMUX_TERMINAL_THEMES',
        'NEXTMUX_TERMINAL_FONT_FAMILY', 'NEXTMUX_TERMINAL_SCROLLBACK_LINES', 'disposeXtermAfterWrites',
        `${commandHostCode}\nreturn NextMuxCommandOutputHost;`)(
        React, Terminal, class { fit() { fitCalls++; } },
        class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() {} },
        requestAnimationFrame, id => frames.delete(id), { dark: { background: '#000' }, light: { background: '#fff' } },
        'monospace', 10_000, () => {}
    );
    const component = new CommandHost({ commandLine: 'echo ready', output: '', running: false, theme: 'dark', ...props });
    const classes = new Set();
    const host = { isConnected: true, clientWidth: 640, clientHeight: 54, offsetHeight: 54, dataset: {}, style: {},
        classList: { contains: name => classes.has(name), toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } } };
    component.setHost(host);
    const flushFrames = () => {
        for (let attempts = 0; frames.size && attempts < 10; attempts++) {
            const pending = [...frames.values()];
            frames.clear();
            for (const callback of pending) callback();
        }
        assert.equal(frames.size, 0, 'terminal layout frames settle');
    };
    const update = changes => {
        const previous = component.props;
        component.props = { ...previous, ...changes };
        component.componentDidUpdate(previous);
    };
    return { component, host, terminals, observers, frames, flushFrames, update, fitCalls: () => fitCalls };
}

test('empty collapsed command output defers xterm until output or running state arrives', () => {
    for (const changes of [{ output: 'ready\r\n' }, { running: true }]) {
        const fixture = commandHostFixture();
        fixture.component.componentDidMount();
        fixture.update({ theme: 'light' });
        assert.equal(fixture.terminals.length, 0);
        assert.equal(fixture.frames.size, 0, 'hidden output schedules no terminal work');
        fixture.update(changes);
        assert.equal(fixture.terminals.length, 1);
        fixture.flushFrames();
        fixture.update({ output: 'ready\r\nnext line' });
        fixture.flushFrames();
        assert.equal(fixture.terminals.length, 1, 'subsequent output reuses the terminal');
        assert.equal(fixture.terminals[0].writes.join(''), 'ready\r\nnext line');
    }
});

test('fill terminals initialize immediately even without output while populated activity waits for its mount frame', () => {
    const filled = commandHostFixture({ fill: true });
    filled.component.componentDidMount();
    assert.equal(filled.terminals.length, 1);
    filled.flushFrames();
    const activity = commandHostFixture({ output: 'ready' });
    activity.component.componentDidMount();
    assert.equal(activity.terminals.length, 0);
    activity.flushFrames();
    assert.equal(activity.terminals.length, 1);
});

test('initial resize observer delivery and collapse height animation do not refit command terminals', () => {
    const fixture = commandHostFixture({ output: 'ready' });
    fixture.component.componentDidMount();
    fixture.flushFrames();
    assert.equal(fixture.fitCalls(), 1);
    fixture.observers[0].callback([{ contentRect: { width: fixture.host.clientWidth, height: fixture.host.clientHeight } }]);
    fixture.observers[0].callback([{ contentRect: { width: fixture.host.clientWidth, height: 160 } }]);
    assert.equal(fixture.frames.size, 0);
    assert.equal(fixture.fitCalls(), 1);
    fixture.observers[0].callback([{ contentRect: { width: 500, height: 160 } }]);
    fixture.flushFrames();
    assert.equal(fixture.fitCalls(), 2, 'a real width change still fits the output');
});

test('expanded command copy stays hidden through 240 characters and reveals a truncated header command', () => {
    for (const length of [1, 239, 240, 241]) {
        const { component } = commandHostFixture({ commandLine: 'x'.repeat(length) });
        const command = component.render().props.children[0];
        assert.equal(command.props.className, 'nmx-agent-command-line');
        assert.equal(command.props.hidden, length <= 240);
        assert.equal(command.props.children.find(child => child.type === 'code').props.children[0], 'x'.repeat(length));
    }
});

test('expanded command activity uses a real read-only xterm that can stream terminal control sequences', () => {
    assert.match(source, /class NextMuxCommandOutputHost extends React\.PureComponent/);
    assert.match(source, /new XtermTerminal\(\{[\s\S]*?allowTransparency:\s*false[\s\S]*?disableStdin:\s*true/);
    assert.match(source, /terminal\.write\(this\.props\.output\.slice\(this\.renderedOutput\.length\)\)/);
    assert.match(source, /this\.host\.classList\.toggle\('is-scrollable', scrollable\)/);
    assert.match(source, /className='nmx-agent-command-line'[\s\S]*?<code data-nmx-literal>\{commandLine\}<\/code>/);
    assert.doesNotMatch(source, /terminal\.writeln\([^\n]*commandLine/);
    assert.match(source, /<NextMuxCommandOutputHost[\s\S]*?commandLine=\{commandLine\}[\s\S]*?output=\{output\}/);
    assert.doesNotMatch(source, /<pre data-nmx-literal>\{output\}<\/pre>/);
    assert.match(style, /\.nmx-agent-command-xterm\s*\{/);
    assert.match(style, /\.nmx-agent-command-xterm:not\(\.is-fill\):not\(\.is-scrollable\) \.xterm-viewport\s*\{[\s\S]*?overflow-y:\s*hidden !important;/);
});

test('a running process activity adopts the later authoritative process command line', () => {
    // The stream projection owns command rows (nextmux-conversation-stream-model.ts).
    const model = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-conversation-stream-model.ts', import.meta.url)), 'utf8');
    assert.match(model, /commandActivityPresentation\(locale, 'running'/);
    assert.match(model, /processCommandLine:\s*processCommandLines\.get\(event\.callId\)/);
    assert.match(model, /event\.summary\?\.commandLine/);
});

test('agent process tools are bound to the conversation real terminal capability', () => {
    assert.match(protocol, /readonly terminalId\?: number/);
    assert.match(source, /createTerminalForSession\(codingSession, 'agent', false, false, true\)/);
    assert.match(source, /terminalId: sharedTerminal\.widget\.terminalId/);
    assert.match(service, /new TheiaTerminalProcessRegistry\([\s\S]*?request\.terminalId[\s\S]*?terminalProfile/);
    assert.match(service, /processRegistry\s*\n?\s*\}\);/);
});
