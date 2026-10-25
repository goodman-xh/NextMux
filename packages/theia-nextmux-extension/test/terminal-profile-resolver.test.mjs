import assert from 'node:assert/strict';
import test from 'node:test';

import { parseWslDistributionOutput, resolveTerminalProfiles } from '../lib/node/nextmux-terminal-profile-resolver.js';

const windows = {
    SystemRoot: 'C:\\Windows',
    ProgramFiles: 'C:\\Program Files',
    LOCALAPPDATA: 'C:\\Users\\qa\\AppData\\Local',
    COMSPEC: 'C:\\Windows\\System32\\cmd.exe'
};

test('Windows discovery exposes PowerShell, Command Prompt, Git Bash, and WSL as independent profiles', async () => {
    const files = new Map([
        ['C:\\Tools\\PowerShell\\pwsh.exe', 'C:\\Tools\\PowerShell\\pwsh.exe'],
        ['C:\\Windows\\System32\\cmd.exe', 'C:\\Windows\\System32\\cmd.exe'],
        ['C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files\\Git\\cmd\\git.exe'],
        ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\bin\\bash.exe'],
        ['C:\\Windows\\System32\\wsl.exe', 'C:\\Windows\\System32\\wsl.exe']
    ]);
    const runtime = await resolveTerminalProfiles({
        platform: 'win32',
        architecture: 'x64',
        hostArchitecture: 'x64',
        osRelease: '10.0.26100',
        env: windows,
        wslDistributions: ['Ubuntu'],
        findExecutables: async name => name === 'pwsh.exe' ? ['C:\\Tools\\PowerShell\\pwsh.exe']
            : name === 'git.exe' ? ['C:\\Program Files\\Git\\cmd\\git.exe'] : [],
        existingExecutable: async candidate => files.get(candidate)
    });

    assert.deepEqual(runtime.profiles.map(profile => profile.shellKind), ['powershell', 'cmd', 'git_bash', 'wsl']);
    assert.equal(runtime.defaultProfileId, 'powershell');
    assert.equal(runtime.supportStatus, 'supported');
    assert.equal(runtime.wslStatus, 'ready');
    assert.equal(runtime.architecture, 'x64');
    assert.deepEqual(runtime.profiles.find(profile => profile.id === 'git_bash')?.shellArgs, ['--login', '-i']);
    assert.deepEqual(runtime.profiles.find(profile => profile.id === 'git_bash')?.env, { CHERE_INVOKING: '1' });
    assert.deepEqual(runtime.profiles.find(profile => profile.shellKind === 'wsl')?.shellArgs, ['-d', 'Ubuntu']);
    assert.equal(runtime.profiles.find(profile => profile.shellKind === 'wsl')?.label, 'WSL · Ubuntu');
});

test('Windows does not offer WSL when wsl.exe exists but no distribution is installed', async () => {
    const available = new Set([windows.COMSPEC, 'C:\\Windows\\System32\\wsl.exe']);
    const runtime = await resolveTerminalProfiles({
        platform: 'win32',
        env: windows,
        wslDistributions: [],
        findExecutables: async () => [],
        existingExecutable: async candidate => available.has(candidate) ? candidate : undefined
    });

    assert.deepEqual(runtime.profiles.map(profile => profile.shellKind), ['cmd']);
    assert.equal(runtime.wslStatus, 'setup_required');
    assert.notEqual(runtime.defaultProfileId, 'wsl');
});

test('Windows never exposes stale distributions when the WSL feature or enumeration probe failed', async () => {
    const available = new Set([windows.COMSPEC, 'C:\\Windows\\System32\\wsl.exe']);
    const runtime = await resolveTerminalProfiles({
        platform: 'win32',
        architecture: 'x64',
        hostArchitecture: 'x64',
        osRelease: '10.0.26100',
        env: windows,
        wslDistributions: ['Stale Ubuntu'],
        wslProbeFailed: true,
        findExecutables: async () => [],
        existingExecutable: async candidate => available.has(candidate) ? candidate : undefined
    });

    assert.equal(runtime.wslStatus, 'probe_failed');
    assert.deepEqual(runtime.profiles.map(profile => profile.id), ['command_prompt']);
    assert.equal(runtime.defaultProfileId, 'command_prompt');
});

test('Windows hides Docker and Rancher utility distributions from the user terminal picker', async () => {
    const available = new Set([windows.COMSPEC, 'C:\\Windows\\System32\\wsl.exe']);
    const runtime = await resolveTerminalProfiles({
        platform: 'win32',
        architecture: 'x64',
        osRelease: '10.0.19045',
        env: windows,
        wslDistributions: ['docker-desktop', 'docker-desktop-data', 'Ubuntu', 'Rancher-Desktop', 'Debian'],
        findExecutables: async () => [],
        existingExecutable: async candidate => available.has(candidate) ? candidate : undefined
    });

    assert.deepEqual(runtime.wslDistributions, ['Ubuntu', 'Debian']);
    assert.deepEqual(runtime.profiles.filter(profile => profile.shellKind === 'wsl').map(profile => profile.label), [
        'WSL · Ubuntu',
        'WSL · Debian'
    ]);
});

test('Windows never reports WSL ready when every registered distribution fails its launch probe', async () => {
    const available = new Set([windows.COMSPEC, 'C:\\Windows\\System32\\wsl.exe']);
    const runtime = await resolveTerminalProfiles({
        platform: 'win32',
        architecture: 'x64',
        hostArchitecture: 'arm64',
        osRelease: '10.0.26100',
        env: windows,
        wslDistributions: ['Broken Ubuntu'],
        findExecutables: async () => [],
        existingExecutable: async candidate => available.has(candidate) ? candidate : undefined,
        validateProfile: async profile => profile.shellKind !== 'wsl'
    });

    assert.deepEqual(runtime.profiles.map(profile => profile.shellKind), ['cmd']);
    assert.equal(runtime.wslStatus, 'probe_failed');
    assert.equal(runtime.hostArchitecture, 'arm64');
});

test('Windows exposes PowerShell 7 and Windows PowerShell separately while keeping PowerShell 7 as default', async () => {
    const available = new Set([
        'C:\\Tools\\PowerShell\\pwsh.exe',
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        windows.COMSPEC
    ]);
    const runtime = await resolveTerminalProfiles({
        platform: 'win32',
        architecture: 'arm64',
        hostArchitecture: 'arm64',
        osRelease: '10.0.26100',
        env: windows,
        findExecutables: async name => name === 'pwsh.exe' ? ['C:\\Tools\\PowerShell\\pwsh.exe'] : [],
        existingExecutable: async candidate => available.has(candidate) ? candidate : undefined
    });

    assert.deepEqual(runtime.profiles.map(profile => profile.id), ['powershell', 'windows_powershell', 'command_prompt']);
    assert.deepEqual(runtime.profiles.filter(profile => profile.shellKind === 'powershell').map(profile => profile.shellArgs), [['-NoLogo'], ['-NoLogo']]);
    assert.match(runtime.profiles.find(profile => profile.id === 'powershell')?.env?.PSModulePath || '', /PowerShell[\\\\/]Modules/i);
    assert.doesNotMatch(runtime.profiles.find(profile => profile.id === 'powershell')?.env?.PSModulePath || '', /WindowsPowerShell/i);
    assert.match(runtime.profiles.find(profile => profile.id === 'windows_powershell')?.env?.PSModulePath || '', /WindowsPowerShell[\\\\/]Modules/i);
    assert.doesNotMatch(runtime.profiles.find(profile => profile.id === 'windows_powershell')?.env?.PSModulePath || '', /Tools[\\\\/]PowerShell[\\\\/]Modules/i);
    assert.equal(runtime.defaultProfileId, 'powershell');
    assert.equal(runtime.architecture, 'arm64');
    assert.equal(runtime.hostArchitecture, 'arm64');
});

test('Windows keeps the built-in Windows PowerShell as the default when PowerShell 7 is not installed', async () => {
    const windowsPowerShell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    const available = new Set([windowsPowerShell, windows.COMSPEC]);
    const runtime = await resolveTerminalProfiles({
        platform: 'win32',
        architecture: 'x64',
        hostArchitecture: 'x64',
        osRelease: '10.0.19045',
        env: windows,
        findExecutables: async () => [],
        existingExecutable: async candidate => available.has(candidate) ? candidate : undefined
    });

    assert.deepEqual(runtime.profiles.map(profile => profile.id), ['windows_powershell', 'command_prompt']);
    assert.equal(runtime.defaultProfileId, 'windows_powershell');
    assert.equal(runtime.shellPath, windowsPowerShell);
});

test('Windows x64 rejects builds below the current node-pty ConPTY floor instead of crashing after install', async () => {
    let nativeProbeCount = 0;
    const runtime = await resolveTerminalProfiles({
        platform: 'win32',
        architecture: 'x64',
        osRelease: '10.0.17763',
        env: windows,
        findExecutables: async () => [],
        existingExecutable: async candidate => candidate === windows.COMSPEC ? windows.COMSPEC : undefined,
        validateProfile: async () => {
            nativeProbeCount += 1;
            return true;
        }
    });

    assert.equal(runtime.supportStatus, 'unsupported');
    assert.equal(runtime.supportReason, 'windows_conpty_unavailable');
    assert.equal(nativeProbeCount, 0, 'unsupported Windows must be rejected before any native PTY probe');
});

test('Windows ConPTY support starts at build 18309', async () => {
    const resolveBuild = osRelease => resolveTerminalProfiles({
        platform: 'win32',
        architecture: 'x64',
        osRelease,
        env: windows,
        findExecutables: async () => [],
        existingExecutable: async candidate => candidate === windows.COMSPEC ? windows.COMSPEC : undefined
    });

    assert.equal((await resolveBuild('10.0.18308')).supportReason, 'windows_conpty_unavailable');
    assert.equal((await resolveBuild('10.0.18309')).supportStatus, 'supported');
});

test('Windows ARM64 requires 1903 or newer and accepts supported Windows 10 and 11 builds', async () => {
    const resolveBuild = osRelease => resolveTerminalProfiles({
        platform: 'win32',
        architecture: 'arm64',
        hostArchitecture: 'arm64',
        osRelease,
        env: windows,
        findExecutables: async () => [],
        existingExecutable: async candidate => candidate === windows.COMSPEC ? windows.COMSPEC : undefined
    });

    const oldWindows10 = await resolveBuild('10.0.17763');
    const windows10 = await resolveBuild('10.0.19045');
    const windows11 = await resolveBuild('10.0.26100');
    assert.equal(oldWindows10.supportStatus, 'unsupported');
    assert.equal(oldWindows10.supportReason, 'windows_conpty_unavailable');
    assert.equal(windows10.supportStatus, 'supported');
    assert.equal(windows11.supportStatus, 'supported');
});

test('distributable Windows x64 and ARM64 builds enforce their exact ConPTY floors across Windows 10 and 11', async () => {
    const cases = [
        { architecture: 'x64', release: '10.0.18308', status: 'unsupported', reason: 'windows_conpty_unavailable' },
        { architecture: 'x64', release: '10.0.18309', status: 'supported' },
        { architecture: 'x64', release: '10.0.19045', status: 'supported' },
        { architecture: 'x64', release: '10.0.22000', status: 'supported' },
        { architecture: 'arm64', release: '10.0.18361', status: 'unsupported', reason: 'windows_conpty_unavailable' },
        { architecture: 'arm64', release: '10.0.18362', status: 'supported' },
        { architecture: 'arm64', release: '10.0.19045', status: 'supported' },
        { architecture: 'arm64', release: '10.0.22000', status: 'supported' }
    ];

    for (const expected of cases) {
        const runtime = await resolveTerminalProfiles({
            platform: 'win32',
            architecture: expected.architecture,
            hostArchitecture: expected.architecture,
            osRelease: expected.release,
            env: windows,
            findExecutables: async () => [],
            existingExecutable: async candidate => candidate === windows.COMSPEC ? windows.COMSPEC : undefined
        });
        assert.equal(runtime.supportStatus, expected.status, `${expected.architecture} ${expected.release}`);
        assert.equal(runtime.supportReason, expected.reason, `${expected.architecture} ${expected.release}`);
    }
});

test('an x64 build running on Windows ARM64 uses the ARM64 host ConPTY floor', async () => {
    const runtime = await resolveTerminalProfiles({
        platform: 'win32',
        architecture: 'x64',
        hostArchitecture: 'arm64',
        osRelease: '10.0.18309',
        env: windows,
        findExecutables: async () => [],
        existingExecutable: async candidate => candidate === windows.COMSPEC ? windows.COMSPEC : undefined
    });

    assert.equal(runtime.supportStatus, 'unsupported');
    assert.equal(runtime.supportReason, 'windows_conpty_unavailable');
    assert.deepEqual(runtime.profiles, []);
    assert.equal(runtime.defaultProfileId, '');
});

test('Windows settings expose only PowerShell, Windows PowerShell, cmd and Git Bash profiles that pass a real launch probe', async () => {
    const candidates = new Set([
        'C:\\Tools\\PowerShell\\pwsh.exe',
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        windows.COMSPEC,
        'C:\\Program Files\\Git\\bin\\bash.exe'
    ]);
    const probed = [];
    const runtime = await resolveTerminalProfiles({
        platform: 'win32',
        architecture: 'x64',
        hostArchitecture: 'x64',
        osRelease: '10.0.19045',
        env: windows,
        findExecutables: async name => name === 'pwsh.exe' ? ['C:\\Tools\\PowerShell\\pwsh.exe']
            : name === 'git.exe' ? ['C:\\Program Files\\Git\\cmd\\git.exe'] : [],
        existingExecutable: async candidate => candidates.has(candidate) ? candidate : undefined,
        validateProfile: async profile => {
            probed.push({ id: profile.id, path: profile.shellPath, args: [...profile.shellArgs] });
            return profile.id !== 'windows_powershell';
        }
    });

    assert.deepEqual(probed, [
        { id: 'powershell', path: 'C:\\Tools\\PowerShell\\pwsh.exe', args: ['-NoLogo'] },
        { id: 'windows_powershell', path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', args: ['-NoLogo'] },
        { id: 'command_prompt', path: windows.COMSPEC, args: ['/V:ON'] },
        { id: 'git_bash', path: 'C:\\Program Files\\Git\\bin\\bash.exe', args: ['--login', '-i'] }
    ]);
    assert.deepEqual(runtime.profiles.map(profile => profile.id), ['powershell', 'command_prompt', 'git_bash']);
    assert.equal(runtime.defaultProfileId, 'powershell');
});

test('profile launch validation removes stale candidates before the settings list is shown', async () => {
    const available = new Set(['C:\\Tools\\PowerShell\\pwsh.exe', windows.COMSPEC]);
    const runtime = await resolveTerminalProfiles({
        platform: 'win32',
        env: windows,
        findExecutables: async name => name === 'pwsh.exe' ? ['C:\\Tools\\PowerShell\\pwsh.exe'] : [],
        existingExecutable: async candidate => available.has(candidate) ? candidate : undefined,
        validateProfile: async profile => profile.id !== 'powershell'
    });

    assert.deepEqual(runtime.profiles.map(profile => profile.id), ['command_prompt']);
    assert.equal(runtime.defaultProfileId, 'command_prompt');
});

test('when every launch probe fails no unavailable profile remains default or launchable', async () => {
    const runtime = await resolveTerminalProfiles({
        platform: 'win32',
        architecture: 'x64',
        hostArchitecture: 'x64',
        osRelease: '10.0.26100',
        env: windows,
        findExecutables: async () => [],
        existingExecutable: async candidate => candidate === windows.COMSPEC ? windows.COMSPEC : undefined,
        validateProfile: async () => false
    });

    assert.equal(runtime.supportStatus, 'unsupported');
    assert.equal(runtime.supportReason, 'terminal_profile_unavailable');
    assert.deepEqual(runtime.profiles, []);
    assert.equal(runtime.defaultProfileId, '');
});

test('profile launch validation uses a bounded worker pool instead of starting every WSL distro at once', async () => {
    const available = new Set([windows.COMSPEC, 'C:\\Windows\\System32\\wsl.exe']);
    let active = 0;
    let maximumActive = 0;
    const runtime = await resolveTerminalProfiles({
        platform: 'win32',
        architecture: 'x64',
        osRelease: '10.0.26100',
        env: windows,
        wslDistributions: ['Ubuntu', 'Debian', 'Fedora', 'Kali', 'Alpine', 'OracleLinux'],
        findExecutables: async () => [],
        existingExecutable: async candidate => available.has(candidate) ? candidate : undefined,
        validateProfile: async () => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            await new Promise(resolve => setTimeout(resolve, 10));
            active -= 1;
            return true;
        }
    });

    assert.equal(runtime.profiles.length, 7);
    assert.ok(maximumActive <= 2, `expected at most two concurrent PTY probes, observed ${maximumActive}`);
});

test('WSL distribution discovery decodes the UTF-16LE output used by wsl.exe', () => {
    const bytes = Buffer.from('\ufeffUbuntu\r\nDebian\r\n', 'utf16le');
    assert.deepEqual(parseWslDistributionOutput(bytes), ['Ubuntu', 'Debian']);
});

test('Windows discovery keeps Command Prompt available when optional shells are absent', async () => {
    const runtime = await resolveTerminalProfiles({
        platform: 'win32',
        env: windows,
        findExecutables: async () => [],
        existingExecutable: async candidate => candidate === windows.COMSPEC ? windows.COMSPEC : undefined
    });

    assert.deepEqual(runtime.profiles.map(profile => profile.id), ['command_prompt']);
    assert.equal(runtime.shellPath, windows.COMSPEC);
    assert.equal(runtime.defaultProfileId, 'command_prompt');
});

test('Windows ARM64 discovery also checks architecture-aware installation roots', async () => {
    const env = {
        ...windows,
        ProgramW6432: 'C:\\Program Files',
        'ProgramFiles(Arm)': 'C:\\Program Files (Arm)'
    };
    const available = new Set([
        'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
        'C:\\Windows\\System32\\cmd.exe',
        'C:\\Program Files (Arm)\\Git\\bin\\bash.exe'
    ]);
    const runtime = await resolveTerminalProfiles({
        platform: 'win32',
        env,
        findExecutables: async () => [],
        existingExecutable: async candidate => available.has(candidate) ? candidate : undefined
    });

    assert.deepEqual(runtime.profiles.map(profile => profile.id), ['powershell', 'command_prompt', 'git_bash']);
    assert.equal(runtime.defaultProfileId, 'powershell');
});

test('macOS discovery is architecture-independent and preserves the login shell', async () => {
    const runtime = await resolveTerminalProfiles({
        platform: 'darwin',
        env: { SHELL: '/bin/zsh' },
        findExecutables: async () => [],
        existingExecutable: async candidate => ['/bin/zsh', '/bin/bash', '/bin/sh'].includes(candidate) ? candidate : undefined
    });

    assert.equal(runtime.platform, 'macos');
    assert.equal(runtime.defaultProfileId, 'zsh');
    assert.deepEqual(runtime.profiles.map(profile => profile.shellKind), ['zsh', 'bash', 'sh']);
});

test('macOS version and architecture gates match the two distributable builds', async () => {
    let nativeProbeCount = 0;
    const resolveMac = (architecture, osRelease) => resolveTerminalProfiles({
        platform: 'darwin',
        architecture,
        hostArchitecture: architecture,
        osRelease,
        accountShell: '/bin/zsh',
        env: { SHELL: '/bin/zsh' },
        findExecutables: async () => [],
        existingExecutable: async candidate => candidate === '/bin/zsh' ? candidate : undefined,
        validateProfile: async () => {
            nativeProbeCount += 1;
            return true;
        }
    });

    const oldIntel = await resolveMac('x64', '20.6.0');
    assert.equal(nativeProbeCount, 0, 'unsupported macOS must be rejected before any native PTY probe');
    const supportedIntel = await resolveMac('x64', '21.6.0');
    const supportedAppleSilicon = await resolveMac('arm64', '23.6.0');
    assert.equal(oldIntel.supportStatus, 'unsupported');
    assert.equal(oldIntel.supportReason, 'macos_version_unsupported');
    assert.ok(nativeProbeCount > 0, 'supported macOS hosts should validate discovered profiles');
    assert.equal(supportedIntel.supportStatus, 'supported');
    assert.equal(supportedAppleSilicon.supportStatus, 'supported');
});

test('unknown desktop architectures and old macOS releases are disabled before launch probing', async () => {
    const cases = [
        { platform: 'win32', architecture: 'ia32', osRelease: '10.0.26100', shell: windows.COMSPEC, env: windows, reason: 'unsupported_architecture' },
        { platform: 'win32', architecture: 'riscv64', osRelease: '10.0.26100', shell: windows.COMSPEC, env: windows, reason: 'unsupported_architecture' },
        { platform: 'darwin', architecture: 'x64', osRelease: '20.6.0', shell: '/bin/zsh', env: { SHELL: '/bin/zsh' }, reason: 'macos_version_unsupported' },
        { platform: 'darwin', architecture: 'arm64', osRelease: '20.6.0', shell: '/bin/zsh', env: { SHELL: '/bin/zsh' }, reason: 'macos_version_unsupported' },
        { platform: 'darwin', architecture: 'ppc64', osRelease: '23.6.0', shell: '/bin/zsh', env: { SHELL: '/bin/zsh' }, reason: 'unsupported_architecture' }
    ];

    for (const expected of cases) {
        let probes = 0;
        const runtime = await resolveTerminalProfiles({
            platform: expected.platform,
            architecture: expected.architecture,
            hostArchitecture: expected.architecture,
            osRelease: expected.osRelease,
            accountShell: expected.platform === 'darwin' ? expected.shell : undefined,
            env: expected.env,
            findExecutables: async () => [],
            existingExecutable: async candidate => candidate === expected.shell ? candidate : undefined,
            validateProfile: async () => {
                probes += 1;
                return true;
            }
        });
        assert.equal(runtime.supportStatus, 'unsupported', `${expected.platform} ${expected.architecture} ${expected.osRelease}`);
        assert.equal(runtime.supportReason, expected.reason, `${expected.platform} ${expected.architecture} ${expected.osRelease}`);
        assert.equal(probes, 0, 'unsupported hosts must not load or probe native PTY binaries');
        assert.deepEqual(runtime.profiles, [], 'unsupported hosts must not expose launchable profiles');
        assert.equal(runtime.defaultProfileId, '', 'unsupported hosts must not nominate an unavailable default');
    }
});

test('non-distributable operating systems and missing macOS shells fail closed', async () => {
    const cases = [
        { platform: 'linux', accountShell: '/bin/bash', existing: new Set(['/bin/bash']) },
        { platform: 'freebsd', accountShell: '/bin/sh', existing: new Set(['/bin/sh']) },
        { platform: 'darwin', accountShell: '/missing/zsh', existing: new Set() }
    ];

    for (const expected of cases) {
        let probes = 0;
        const runtime = await resolveTerminalProfiles({
            platform: expected.platform,
            architecture: 'x64',
            hostArchitecture: 'x64',
            osRelease: expected.platform === 'darwin' ? '23.6.0' : '6.0.0',
            accountShell: expected.accountShell,
            env: { SHELL: expected.accountShell },
            findExecutables: async () => [],
            existingExecutable: async candidate => expected.existing.has(candidate) ? candidate : undefined,
            validateProfile: async () => {
                probes += 1;
                return true;
            }
        });

        assert.equal(runtime.supportStatus, 'unsupported', expected.platform);
        assert.equal(runtime.supportReason, 'terminal_profile_unavailable', expected.platform);
        assert.equal(probes, 0, `${expected.platform} must not load or probe native PTY binaries`);
        assert.deepEqual(runtime.profiles, [], expected.platform);
        assert.equal(runtime.defaultProfileId, '', expected.platform);
    }
});

test('macOS Intel and Apple Silicon preserve the operating-system account login shell as the default', async () => {
    const cases = [
        { architecture: 'x64', release: '21.6.0', accountShell: '/usr/local/bin/bash', id: 'bash' },
        { architecture: 'arm64', release: '23.6.0', accountShell: '/opt/homebrew/bin/fish', id: 'fish' }
    ];
    for (const expected of cases) {
        const available = new Set([expected.accountShell, '/bin/zsh', '/bin/bash', '/bin/sh']);
        const runtime = await resolveTerminalProfiles({
            platform: 'darwin',
            architecture: expected.architecture,
            hostArchitecture: expected.architecture,
            osRelease: expected.release,
            accountShell: expected.accountShell,
            env: { SHELL: '/bin/zsh' },
            loginShells: ['/bin/zsh', '/bin/bash', '/bin/sh'],
            findExecutables: async () => [],
            existingExecutable: async candidate => available.has(candidate) ? candidate : undefined
        });
        assert.equal(runtime.supportStatus, 'supported');
        assert.equal(runtime.defaultProfileId, expected.id);
        assert.equal(runtime.shellPath, expected.accountShell);
        assert.equal(runtime.profiles[0].source, 'account');
        assert.deepEqual(runtime.profiles[0].shellArgs, ['-l']);
    }
});

test('macOS account login shell outranks a stale SHELL environment and unknown shells are not given guessed flags', async () => {
    const available = new Set(['/opt/custom/bin/nu', '/bin/zsh', '/bin/bash', '/bin/sh']);
    const runtime = await resolveTerminalProfiles({
        platform: 'darwin',
        architecture: 'arm64',
        osRelease: '23.6.0',
        accountShell: '/opt/custom/bin/nu',
        env: { SHELL: '/bin/bash' },
        loginShells: ['/bin/zsh', '/bin/bash', '/bin/sh'],
        findExecutables: async () => [],
        existingExecutable: async candidate => available.has(candidate) ? candidate : undefined
    });

    assert.equal(runtime.defaultProfileId, 'nu');
    assert.equal(runtime.profiles[0].shellPath, '/opt/custom/bin/nu');
    assert.deepEqual(runtime.profiles[0].shellArgs, []);
    assert.equal(runtime.supportStatus, 'supported');
});

test('macOS discovers installed Intel and Apple Silicon login shells without hard-coded architecture assumptions', async () => {
    const available = new Set(['/opt/homebrew/bin/fish', '/usr/local/bin/bash', '/bin/zsh', '/bin/sh']);
    const runtime = await resolveTerminalProfiles({
        platform: 'darwin',
        env: { SHELL: '/opt/homebrew/bin/fish' },
        loginShells: ['/bin/zsh', '/usr/local/bin/bash', '/opt/homebrew/bin/fish', '/bin/sh'],
        findExecutables: async () => [],
        existingExecutable: async candidate => available.has(candidate) ? candidate : undefined
    });

    assert.equal(runtime.defaultProfileId, 'fish');
    assert.deepEqual(runtime.profiles.map(profile => profile.shellPath), [
        '/opt/homebrew/bin/fish',
        '/bin/zsh',
        '/usr/local/bin/bash',
        '/bin/sh'
    ]);
});

test('macOS also discovers installed PATH shells that are not yet the account default or in /etc/shells', async () => {
    const available = new Set(['/bin/zsh', '/opt/homebrew/bin/fish', '/usr/local/bin/pwsh', '/bin/bash', '/bin/sh']);
    const runtime = await resolveTerminalProfiles({
        platform: 'darwin',
        architecture: 'arm64',
        osRelease: '23.6.0',
        accountShell: '/bin/zsh',
        env: { SHELL: '/bin/zsh' },
        loginShells: ['/bin/zsh'],
        findExecutables: async name => name === 'fish' ? ['/opt/homebrew/bin/fish']
            : name === 'pwsh' ? ['/usr/local/bin/pwsh'] : [],
        existingExecutable: async candidate => available.has(candidate) ? candidate : undefined
    });

    assert.equal(runtime.defaultProfileId, 'zsh');
    assert.deepEqual(runtime.profiles.map(profile => profile.shellPath), [
        '/bin/zsh',
        '/opt/homebrew/bin/fish',
        '/usr/local/bin/pwsh',
        '/bin/bash',
        '/bin/sh'
    ]);
    assert.equal(runtime.profiles.find(profile => profile.shellPath.endsWith('/pwsh'))?.label, 'PowerShell');
    assert.deepEqual(runtime.profiles.find(profile => profile.shellPath.endsWith('/pwsh'))?.shellArgs, ['-NoLogo']);
});

test('a stale shell early on PATH falls back to the next working install of the same shell (A20-05)', async () => {
    const files = new Map([
        ['C:\\Old PowerShell\\pwsh.exe', 'C:\\Old PowerShell\\pwsh.exe'],
        ['C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'],
        ['C:\\Windows\\System32\\cmd.exe', 'C:\\Windows\\System32\\cmd.exe']
    ]);
    const checked = [];
    const runtime = await resolveTerminalProfiles({
        platform: 'win32', architecture: 'x64', hostArchitecture: 'x64', osRelease: '10.0.26100', env: windows,
        findExecutables: async name => name === 'pwsh.exe' ? ['C:\\Old PowerShell\\pwsh.exe'] : [],
        existingExecutable: async candidate => files.get(candidate),
        validateProfile: async profile => { checked.push(profile.shellPath); return profile.shellPath !== 'C:\\Old PowerShell\\pwsh.exe'; }
    });
    assert.equal(runtime.defaultProfileId, 'powershell');
    assert.equal(runtime.shellPath, 'C:\\Program Files\\PowerShell\\7\\pwsh.exe');
    assert.ok(checked.includes('C:\\Old PowerShell\\pwsh.exe'));
});
