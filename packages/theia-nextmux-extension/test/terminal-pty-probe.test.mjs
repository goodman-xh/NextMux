import assert from 'node:assert/strict';
import test from 'node:test';

import { probeTerminalProfilePty, terminalProfileProbeLaunch } from '../lib/node/nextmux-terminal-pty-probe.js';

const marker = 'NEXTMUX_PTY_PROBE_TEST';

test('PTY probe launches every shell exactly like production without accepting its echoed input as proof', () => {
    const cases = [
        [{ shellKind: 'powershell', shellArgs: ['-NoLogo'] }, ['-NoLogo'], /Write-Output.*\+.*exit/],
        [{ shellKind: 'cmd', shellArgs: [] }, [], /set .*echo\(.*\r\nexit \/b 0/s],
        [{ shellKind: 'git_bash', shellArgs: ['--login', '-i'] }, ['--login', '-i'], /printf.*%s%s.*exit/],
        [{ shellKind: 'wsl', shellArgs: ['-d', 'Ubuntu'] }, ['-d', 'Ubuntu'], /printf.*WSL_DISTRO_NAME.*exit/],
        [{ shellKind: 'zsh', shellArgs: ['-l'] }, ['-l'], /printf.*%s%s.*exit/],
        [{ shellKind: 'fish', shellArgs: ['-l'] }, ['-l'], /printf.*%s%s.*exit/]
    ];
    for (const [profile, expectedArgs, expectedInput] of cases) {
        const launch = terminalProfileProbeLaunch(profile, marker);
        assert.deepEqual(launch.args, expectedArgs);
        assert.match(launch.input, expectedInput);
        assert.ok(launch.expectedOutput);
        assert.equal(launch.input.includes(launch.expectedOutput), false,
            `${profile.shellKind} input must not contain the complete success marker`);
    }
});

test('each WSL launch requires a marker bound to the exact requested distribution', () => {
    const ubuntu = terminalProfileProbeLaunch({ shellKind: 'wsl', shellArgs: ['-d', 'Ubuntu'] }, marker);
    const debian = terminalProfileProbeLaunch({ shellKind: 'wsl', shellArgs: ['-d', 'Debian'] }, marker);

    assert.notEqual(ubuntu.expectedOutput, debian.expectedOutput);
    assert.match(ubuntu.expectedOutput, /^NEXTMUX_PTY_PROBE_TEST_WSL_[A-F0-9]{12}:Ubuntu$/);
    assert.match(debian.expectedOutput, /^NEXTMUX_PTY_PROBE_TEST_WSL_[A-F0-9]{12}:Debian$/);
    assert.match(ubuntu.input, /\$WSL_DISTRO_NAME/);
    assert.equal(ubuntu.input.includes('Ubuntu'), false);
});

test('profile availability requires a real PTY output, resize and clean exit', async () => {
    let captured;
    let resized;
    let wrote = '';
    let terminateCalls = 0;
    const ok = await probeTerminalProfilePty({
        id: 'powershell', shellKind: 'powershell', shellPath: 'pwsh', shellArgs: ['-NoLogo'], label: 'PowerShell', source: 'path'
    }, {
        cwd: 'C:\\workspace',
        env: {},
        marker,
        createSession: options => {
            captured = options;
            return {
                running: false,
                ready: async () => undefined,
                resize: (columns, rows) => { resized = [columns, rows]; },
                write: async value => { wrote += value; },
                waitForExit: async () => ({
                    chunks: [{ sequence: 1, stream: 'pty', text: `${marker}\r\n` }],
                    exitCode: 0,
                    failure: ''
                }),
                terminate: async () => {
                    terminateCalls += 1;
                    return true;
                }
            };
        }
    });
    assert.equal(ok, true);
    assert.equal(captured.tty, true);
    assert.equal(captured.command, 'pwsh');
    assert.deepEqual(resized, [100, 24]);
    assert.match(wrote, /Write-Output.*\+.*exit/);
    assert.equal(wrote.includes(marker), false);
    assert.equal(captured.env.HISTFILE, '/dev/null');
    assert.equal(captured.env.fish_history, '');
    assert.match(captured.env.APPDATA, /NEXTMUX_PTY_PROBE_TEST/);
    assert.equal(captured.env.XDG_DATA_HOME, captured.env.APPDATA);
    assert.equal(terminateCalls, 1, 'cleanup runs even when the session reports itself stopped');
});

test('Windows PowerShell, Windows PowerShell, cmd, Git Bash and multiple WSL distributions must each pass their own production-shaped PTY launch', async () => {
    const profiles = [
        { id: 'powershell', shellKind: 'powershell', shellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', shellArgs: ['-NoLogo'], label: 'PowerShell', source: 'path' },
        { id: 'windows_powershell', shellKind: 'powershell', shellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', shellArgs: ['-NoLogo'], label: 'Windows PowerShell', source: 'system' },
        { id: 'command_prompt', shellKind: 'cmd', shellPath: 'C:\\Windows\\System32\\cmd.exe', shellArgs: [], label: 'Command Prompt', source: 'system' },
        { id: 'git_bash', shellKind: 'git_bash', shellPath: 'C:\\Program Files\\Git\\bin\\bash.exe', shellArgs: ['--login', '-i'], label: 'Git Bash', source: 'path', env: { CHERE_INVOKING: '1' } },
        { id: 'wsl:ubuntu', shellKind: 'wsl', shellPath: 'C:\\Windows\\System32\\wsl.exe', shellArgs: ['-d', 'Ubuntu'], label: 'WSL · Ubuntu', source: 'wsl' },
        { id: 'wsl:debian', shellKind: 'wsl', shellPath: 'C:\\Windows\\System32\\wsl.exe', shellArgs: ['-d', 'Debian'], label: 'WSL · Debian', source: 'wsl' }
    ];

    for (const profile of profiles) {
        let startOptions;
        let input = '';
        const expectedOutput = terminalProfileProbeLaunch(profile, marker).expectedOutput;
        const accepted = await probeTerminalProfilePty(profile, {
            cwd: 'C:\\workspace',
            env: {},
            marker,
            createSession: options => {
                startOptions = options;
                return {
                    running: true,
                    ready: async () => undefined,
                    resize: () => undefined,
                    write: async value => { input += value; },
                    waitForExit: async () => ({
                        chunks: [{ sequence: 1, stream: 'pty', text: `${expectedOutput}\r\n` }],
                        exitCode: 0,
                        failure: ''
                    }),
                    terminate: async () => true
                };
            }
        });

        assert.equal(accepted, true, profile.id);
        assert.equal(startOptions.command, profile.shellPath, profile.id);
        assert.deepEqual(startOptions.args, profile.shellArgs, profile.id);
        assert.equal(startOptions.tty, true, profile.id);
        assert.equal(input.includes(expectedOutput), false, profile.id);
        if (profile.shellKind === 'wsl') {
            assert.match(startOptions.env.WSLENV, /(?:^|:)NEXTMUX_TERMINAL_PROBE(?:$|:)/);
            assert.match(startOptions.env.WSLENV, /(?:^|:)HISTFILE(?:$|:)/);
            assert.match(startOptions.env.WSLENV, /(?:^|:)fish_history(?:$|:)/);
        }
        if (profile.shellKind === 'git_bash') assert.equal(startOptions.env.CHERE_INVOKING, '1');
    }
});

test('an echo-only PTY cannot satisfy the launch probe', async () => {
    let input = '';
    const accepted = await probeTerminalProfilePty({
        id: 'command_prompt', shellKind: 'cmd', shellPath: 'cmd.exe', shellArgs: [], label: 'Command Prompt', source: 'system'
    }, {
        cwd: 'C:\\workspace', env: {}, marker,
        createSession: () => ({
            running: true,
            ready: async () => undefined,
            resize: () => undefined,
            write: async value => { input += value; },
            waitForExit: async () => ({
                chunks: [{ sequence: 1, stream: 'pty', text: input }],
                exitCode: 0,
                failure: ''
            }),
            terminate: async () => true
        })
    });

    assert.equal(accepted, false);
});

test('ConPTY cursor movement immediately after the executed marker is accepted', async () => {
    const accepted = await probeTerminalProfilePty({
        id: 'command_prompt', shellKind: 'cmd', shellPath: 'cmd.exe', shellArgs: [], label: 'Command Prompt', source: 'system'
    }, {
        cwd: 'C:\\workspace', env: {}, marker,
        createSession: () => ({
            running: true,
            ready: async () => undefined,
            resize: () => undefined,
            write: async () => undefined,
            waitForExit: async () => ({
                chunks: [{ sequence: 1, stream: 'pty', text: `${marker}\x1b[11;1HC:\\workspace>` }],
                exitCode: 0,
                failure: ''
            }),
            terminate: async () => true
        })
    });

    assert.equal(accepted, true);
});

test('WSL rejects a successful PTY from the wrong distribution and accepts the exact distro marker', async () => {
    const profile = {
        id: 'wsl:ubuntu', shellKind: 'wsl', shellPath: 'wsl.exe', shellArgs: ['-d', 'Ubuntu'], label: 'WSL · Ubuntu', source: 'wsl'
    };
    const launch = terminalProfileProbeLaunch(profile, marker);
    const run = output => probeTerminalProfilePty(profile, {
        cwd: 'C:\\workspace', env: {}, marker,
        createSession: () => ({
            running: true,
            ready: async () => undefined,
            resize: () => undefined,
            write: async () => undefined,
            waitForExit: async () => ({
                chunks: [{ sequence: 1, stream: 'pty', text: `${output}\r\n` }],
                exitCode: 0,
                failure: ''
            }),
            terminate: async () => true
        })
    });

    assert.equal(await run(launch.expectedOutput.replace(/:Ubuntu$/, ':Debian')), false);
    assert.equal(await run(launch.expectedOutput), true);
});

test('macOS Intel and Apple Silicon login shells are probed with their discovered login arguments', async () => {
    const profiles = [
        { id: 'zsh', shellKind: 'zsh', shellPath: '/bin/zsh', shellArgs: ['-l'], label: 'Zsh', source: 'account' },
        { id: 'bash', shellKind: 'bash', shellPath: '/usr/local/bin/bash', shellArgs: ['-l'], label: 'Bash', source: 'account' },
        { id: 'fish', shellKind: 'fish', shellPath: '/opt/homebrew/bin/fish', shellArgs: ['-l'], label: 'Fish', source: 'account' }
    ];

    for (const profile of profiles) {
        let startOptions;
        const accepted = await probeTerminalProfilePty(profile, {
            cwd: '/workspace',
            env: {},
            marker,
            createSession: options => {
                startOptions = options;
                return {
                    running: true,
                    ready: async () => undefined,
                    resize: () => undefined,
                    write: async () => undefined,
                    waitForExit: async () => ({
                        chunks: [{ sequence: 1, stream: 'pty', text: `${marker}\n` }],
                        exitCode: 0,
                        failure: ''
                    }),
                    terminate: async () => true
                };
            }
        });
        assert.equal(accepted, true, profile.id);
        assert.equal(startOptions.command, profile.shellPath, profile.id);
        assert.deepEqual(startOptions.args, ['-l'], profile.id);
    }
});

test('profile is rejected when native PTY output or exit status is wrong', async () => {
    const base = {
        id: 'shell', shellKind: 'sh', shellPath: '/bin/sh', shellArgs: ['-l'], label: 'sh', source: 'system'
    };
    const rejected = await probeTerminalProfilePty(base, {
        cwd: '/tmp', env: {}, marker,
        createSession: () => ({
            running: false,
            ready: async () => undefined,
            resize: () => undefined,
            write: async () => undefined,
            waitForExit: async () => ({ chunks: [], exitCode: 0 }),
            terminate: async () => true
        })
    });
    assert.equal(rejected, false);
});

test('a profile is rejected independently for missing marker, non-zero exit, or reported PTY failure', async () => {
    const profile = {
        id: 'command_prompt', shellKind: 'cmd', shellPath: 'cmd.exe', shellArgs: [], label: 'Command Prompt', source: 'system'
    };
    const cases = [
        { name: 'missing marker', snapshot: { chunks: [{ sequence: 1, stream: 'pty', text: 'ready' }], exitCode: 0, failure: '' } },
        { name: 'non-zero exit', snapshot: { chunks: [{ sequence: 1, stream: 'pty', text: marker }], exitCode: 1, failure: '' } },
        { name: 'PTY failure', snapshot: { chunks: [{ sequence: 1, stream: 'pty', text: marker }], exitCode: 0, failure: 'spawn failed' } }
    ];
    for (const expected of cases) {
        const accepted = await probeTerminalProfilePty(profile, {
            cwd: 'C:\\workspace', env: {}, marker,
            createSession: () => ({
                running: false,
                ready: async () => undefined,
                resize: () => undefined,
                write: async () => undefined,
                waitForExit: async () => expected.snapshot,
                terminate: async () => true
            })
        });
        assert.equal(accepted, false, expected.name);
    }
});

test('profile probe enforces its own deadline and terminates a session whose readiness hangs', async () => {
    let terminateCalls = 0;
    const startedAt = Date.now();
    const accepted = await probeTerminalProfilePty({
        id: 'wsl:ubuntu', shellKind: 'wsl', shellPath: 'wsl.exe', shellArgs: ['-d', 'Ubuntu'], label: 'WSL · Ubuntu', source: 'wsl'
    }, {
        cwd: 'C:\\workspace',
        env: {},
        marker,
        timeoutMs: 20,
        createSession: () => ({
            running: false,
            ready: () => new Promise(() => undefined),
            resize: () => undefined,
            write: async () => undefined,
            waitForExit: async () => ({ chunks: [], exitCode: null }),
            terminate: async () => {
                terminateCalls += 1;
                return true;
            }
        })
    });

    assert.equal(accepted, false);
    assert.ok(Date.now() - startedAt < 500, 'probe should not inherit an indefinitely hanging readiness promise');
    assert.equal(terminateCalls, 1);
});
