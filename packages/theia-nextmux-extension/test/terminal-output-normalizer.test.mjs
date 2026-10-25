import assert from 'node:assert/strict';
import test from 'node:test';
import { NextMuxTerminalOutputNormalizer } from '../lib/node/nextmux-terminal-output-normalizer.js';

test('normalizes ConPTY screen diffs without exposing the injected completion probe', () => {
    const marker = 'NM_PROGRESS_E2E_1788171846225';
    const internalId = 'fd84b2be-b948-4e1a-bac8-47fcbc0ea311';
    const injected = `cd "C:\\workspace" && cmd /C ""node" "-e" "setTimeout^(^(^)=^>console.log^('${marker}'^),1500^)"" & set "__nextmux_exit=!errorlevel!" & powershell.exe -NoLogo -NoProfile -NonInteractive -Command "[Console]::Write([char]27 + ']777;NextMux;${internalId};' + $env:__nextmux_exit + [char]7)"`;
    const normalizer = new NextMuxTerminalOutputNormalizer(injected);

    assert.equal(normalizer.push(`${injected}\r\n`), '');
    assert.equal(normalizer.push(`\u001b]0;cmd /C node\u0007`), '');
    assert.equal(normalizer.push('\u001b[?25l\u001b[8;1;19t\u001b[H\n\n\u001b[K\u001b[?25h'), '');
    assert.equal(normalizer.push(`\u001b[?25lNM_PROGRESS_E2E_178\u001b[H\n8171846225\u001b[K\u001b[H\u001b[?25h\n\u001b[K`), `${marker}\n`);
    assert.equal(normalizer.push(`\u001b]0;powershell.exe ]777;NextMux;${internalId}\u0007`), '');
});

test('preserves ordinary output when the shell does not echo the injected command', () => {
    const normalizer = new NextMuxTerminalOutputNormalizer('echo expected');
    assert.equal(normalizer.push('\u001b[32mserver ready\u001b[0m\r\n'), 'server ready\n');
    assert.equal(normalizer.push('request 1\r\nrequest 2\r\n'), 'request 1\nrequest 2\n');
});

test('removes a cancellation repaint of the private completion probe without losing real output', () => {
    const markerId = '5714a960-7929-45bd-a363-2562f0434905';
    const normalizer = new NextMuxTerminalOutputNormalizer('', markerId);
    assert.equal(normalizer.push('server started\r\n'), 'server started\n');
    assert.equal(normalizer.push(`partial log\r\n${markerId};$__nextmuxExitCode\`a\")\r\n`), 'partial log\n');
    assert.equal(normalizer.push(`${markerId.slice(-24)};$__nextmuxExitCode\`a\")\r\n`), '');
});

test('buffers trailing incomplete CSI/OSC sequences across chunks and collapses standalone carriage-return progress frames', () => {
    const normalizer = new NextMuxTerminalOutputNormalizer();
    assert.equal(normalizer.push('\u001b[38;5;'), '');
    assert.equal(normalizer.push('196mError\u001b[0m\r\n'), 'Error\n');
    assert.equal(normalizer.push('\u001b]0;Window TitlePart1'), '');
    assert.equal(normalizer.push('Part2\u0007Downloading 10%\rDownloading 45%\rDownloading 100%\r\n'), 'Downloading 100%\n');
});

test('progress redrawn in separate writes continues on new lines instead of running together', () => {
    const run = (normalizer, chunks) => chunks.map(chunk => normalizer.push(chunk)).join('');
    assert.equal(run(new NextMuxTerminalOutputNormalizer(), ['Downloading 10%\r', 'Downloading 45%\r', 'Downloading 100%\r\n', 'done\n']),
        'Downloading 10%\nDownloading 45%\nDownloading 100%\ndone\n');
    assert.equal(run(new NextMuxTerminalOutputNormalizer(), ['\rbuilding |', '\rbuilding /', '\rbuilt\n']), 'building |\nbuilding /\nbuilt\n');
    // A carriage return and line feed split across writes is one line break, not a rewrite.
    assert.equal(run(new NextMuxTerminalOutputNormalizer(), ['line one\r', '\nline two\r\n']), 'line one\nline two\n');
    assert.equal(run(new NextMuxTerminalOutputNormalizer(), ['prompt> ', 'answer\n']), 'prompt> answer\n');
});

test('ending the command drops an unfinished escape sequence and never leaks the private completion marker', () => {
    const markerId = '5714a960-7929-45bd-a363-2562f0434905';
    const normalizer = new NextMuxTerminalOutputNormalizer('', markerId);
    assert.equal(normalizer.push('build ok\r\n'), 'build ok\n');
    assert.equal(normalizer.push(`\u001b]777;NextMux;${markerId};0`), '');
    assert.equal(normalizer.flush(), '');
    // Output held back while the injected command's echo was unconfirmed is returned, without the echo.
    const echoed = new NextMuxTerminalOutputNormalizer('echo hi');
    assert.equal(echoed.push('echo hi'), '');
    assert.equal(echoed.push('partial'), '');
    assert.equal(echoed.flush(), 'partial');
    const unconfirmed = new NextMuxTerminalOutputNormalizer('echo hi');
    assert.equal(unconfirmed.push('echo h'), '');
    assert.equal(unconfirmed.flush(), '', 'a prefix of the injected command is its echo');
});
