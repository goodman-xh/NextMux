import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
const style = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux.css', import.meta.url)), 'utf8');
const terminalHostStart = source.indexOf('class NextMuxTerminalHost');
const commandMirrorStart = source.indexOf('class NextMuxCommandOutputHost');
const terminalHost = source.slice(terminalHostStart, commandMirrorStart);
const commandMirror = source.slice(commandMirrorStart);

test('the bottom terminal owns the live Theia widget while AI activity stays read-only', () => {
    assert.ok(terminalHostStart >= 0 && commandMirrorStart > terminalHostStart);
    assert.match(terminalHost, /readonly terminal\?: TerminalWidget/);
    assert.match(terminalHost, /UnsafeWidgetUtilities\.attach\(terminal, this\.host\)/);
    assert.doesNotMatch(terminalHost, /new XtermTerminal/);
    assert.match(terminalHost, /terminal\.activate\(\)/);
    assert.match(terminalHost, /terminal\.paste\(text\)/);
    assert.match(commandMirror, /new XtermTerminal\(\{[\s\S]*?disableStdin:\s*true/);
    assert.match(commandMirror, /aria-readonly='true'/);
});

test('the terminal drawer contains only first-class attached interactive terminals', () => {
    assert.doesNotMatch(source, /nextmux-terminal-task-history/);
    assert.doesNotMatch(source, /NextMuxTaskTerminalHost|taskTerminalRecords|renderTaskTerminalSurface/);
    assert.doesNotMatch(source, /is-readonly|aria-readonly=\{taskRecord/);
    assert.doesNotMatch(style, /\.nmx-task-terminal-(?:history|xterm|commands)/);
    assert.match(source, /record\.widget[\s\S]*?<NextMuxTerminalHost terminal=\{record\.widget\}/);
    assert.match(source, /className='nmx-terminal-close'[\s\S]*?closeConversationTerminal\(record\.id\)/);
});
