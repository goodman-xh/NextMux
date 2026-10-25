import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveTerminalProfiles } from '../lib/node/nextmux-terminal-profile-resolver.js';

const renderer = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
const protocol = readFileSync(fileURLToPath(new URL('../src/common/nextmux-platform-protocol.ts', import.meta.url)), 'utf8');
const platformService = readFileSync(fileURLToPath(new URL('../src/node/nextmux-platform-service.ts', import.meta.url)), 'utf8');
const workspaceTools = readFileSync(fileURLToPath(new URL('../../agent-runtime/src/workspace-tools.ts', import.meta.url)), 'utf8');
const backend = readFileSync(fileURLToPath(new URL('../../agent-runtime/src/backend.ts', import.meta.url)), 'utf8');

const windowsEnvironment = {
    SystemRoot: 'C:\\Windows',
    ProgramFiles: 'C:\\Program Files',
    LOCALAPPDATA: 'C:\\Users\\qa\\AppData\\Local',
    COMSPEC: 'C:\\Windows\\System32\\cmd.exe'
};

const windowsExecutables = new Set([
    'C:\\Tools\\PowerShell\\pwsh.exe',
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    windowsEnvironment.COMSPEC,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Windows\\System32\\wsl.exe'
]);

const resolveWindows = validateProfile => resolveTerminalProfiles({
    platform: 'win32',
    architecture: 'x64',
    hostArchitecture: 'x64',
    osRelease: '10.0.26100',
    env: windowsEnvironment,
    wslDistributions: ['Ubuntu'],
    findExecutables: async name => name === 'pwsh.exe' ? ['C:\\Tools\\PowerShell\\pwsh.exe']
        : name === 'git.exe' ? ['C:\\Program Files\\Git\\cmd\\git.exe'] : [],
    existingExecutable: async candidate => windowsExecutables.has(candidate) ? candidate : undefined,
    validateProfile
});

test('settings can select every independently probed Windows profile by its real profile id', async () => {
    const runtime = await resolveWindows(async () => true);
    const ids = runtime.profiles.map(profile => profile.id);

    assert.deepEqual(ids.slice(0, 4), [
        'powershell',
        'windows_powershell',
        'command_prompt',
        'git_bash'
    ]);
    assert.equal(runtime.profiles[4].shellKind, 'wsl');
    assert.match(runtime.profiles[4].id, /^wsl:[a-f0-9]{12}$/);

    for (const rejectedId of ids) {
        const filtered = await resolveWindows(async profile => profile.id !== rejectedId);
        assert.equal(filtered.profiles.some(profile => profile.id === rejectedId), false,
            `${rejectedId} must not remain selectable after its PTY launch probe fails`);
    }
});

test('macOS uses the probed account login shell id and removes it when its launch probe fails', async () => {
    const options = {
        platform: 'darwin',
        architecture: 'arm64',
        hostArchitecture: 'arm64',
        osRelease: '23.6.0',
        accountShell: '/opt/homebrew/bin/fish',
        env: { SHELL: '/bin/zsh' },
        loginShells: ['/bin/zsh', '/bin/bash', '/bin/sh'],
        findExecutables: async () => [],
        existingExecutable: async candidate => [
            '/opt/homebrew/bin/fish', '/bin/zsh', '/bin/bash', '/bin/sh'
        ].includes(candidate) ? candidate : undefined
    };
    const accepted = await resolveTerminalProfiles({ ...options, validateProfile: async () => true });
    assert.equal(accepted.defaultProfileId, 'fish');
    assert.equal(accepted.profiles[0].source, 'account');
    assert.equal(accepted.profiles[0].shellPath, '/opt/homebrew/bin/fish');
    assert.deepEqual(accepted.profiles[0].shellArgs, ['-l']);

    const rejected = await resolveTerminalProfiles({
        ...options,
        validateProfile: async profile => profile.id !== 'fish'
    });
    assert.equal(rejected.profiles.some(profile => profile.id === 'fish'), false);
    assert.equal(rejected.defaultProfileId, 'zsh');
});

test('the selected profile id is preserved from Settings into both user-terminal and agent requests', () => {
    assert.match(protocol, /interface DesktopAgentRunRequest[\s\S]*?readonly terminalProfileId\?: string;/,
        'the renderer/backend contract must carry the selected profile id');
    assert.match(renderer, /nextRuntime\.profiles\.some\(profile => profile\.id === saved\)[\s\S]*?\? saved : nextRuntime\.defaultProfileId/,
        'a persisted id is restored only when it still exists in the probed inventory');
    assert.match(renderer, /selectTerminalProfile\(profileId: string\)[\s\S]*?profiles\.some\(profile => profile\.id === profileId\)\) return;[\s\S]*?this\.terminalProfileId = profileId;[\s\S]*?localStorage\.setItem\('nextmux\.desktop\.terminalProfile\.v1', profileId\)/,
        'Settings must reject undiscovered ids and persist the exact selected id');
    assert.match(renderer, /profiles \|\| \[\]\)\.map\(profile => <option key=\{profile\.id\} value=\{profile\.id\}>/,
        'the Settings picker must be generated exclusively from the probed inventory');
    assert.match(renderer, /const terminalProfile = this\.selectedTerminalProfile\(\);[\s\S]*?terminalService\.newTerminal\(\{[\s\S]*?shellPath: terminalProfile\.shellPath,[\s\S]*?shellArgs: \[\.\.\.terminalProfile\.shellArgs\][\s\S]*?'nextmux\.profileId': terminalProfile\.id/,
        'the user terminal must launch the selected profile and retain its real id');
    assert.match(renderer, /const startRequest: DesktopAgentRunRequest = \{[\s\S]*?terminalProfileId: this\.selectedTerminalProfile\(\)\?\.id[\s\S]*?startAgentRun\(\{ \.\.\.startRequest,/,
        'the same selected id must be sent with the AI task');
});

test('the backend resolves that id once and wires the same profile into AgentRunner process.start', () => {
    assert.match(platformService, /profiles\.find\(profile => profile\.id === \(request\.terminalProfileId \|\| terminalRuntime\.defaultProfileId\)\)/,
        'the backend must resolve the renderer id against its own probed inventory');
    assert.match(platformService, /if \(!terminalProfile\) throw new PlatformRequestError\('TERMINAL_PROFILE_NOT_FOUND'/,
        'an unavailable or stale profile id must fail closed');
    assert.match(platformService, /WorkspaceToolRuntime\.create\(\{[\s\S]*?terminalProfile: \{[\s\S]*?id: terminalProfile\.id,[\s\S]*?shellPath: terminalProfile\.shellPath,[\s\S]*?shellArgs: terminalProfile\.shellArgs,[\s\S]*?env: terminalProfile\.env/,
        'the resolved profile must be copied without substituting another shell');
    assert.match(platformService, /runtime\.registerTools\(tools\);[\s\S]*?new BuiltinAgentBackend\(\{[\s\S]*?model,[\s\S]*?tools,/,
        'the runtime process tools must be the same registry passed to the built-in agent backend');
    assert.match(backend, /new AgentRunner\(\{[\s\S]*?\.\.\.this\.#options/,
        'AgentRunner must receive the backend tool registry containing the profile-bound process tools');
    assert.match(workspaceTools, /name: "process\.start"[\s\S]*?useTerminalProfile: \{ type: "boolean" \}[\s\S]*?this\.#startProcess\(input, context\)/,
        'process.start must expose the explicit useTerminalProfile switch');
    assert.match(workspaceTools, /const useTerminalProfile = options\.allowTty[\s\S]*?const command = useTerminalProfile[\s\S]*?this\.#terminalProfile!\.shellPath[\s\S]*?const args = useTerminalProfile[\s\S]*?this\.#terminalProfile!\.shellArgs[\s\S]*?env: \{ \.\.\.this\.#processEnvironment\(useTerminalProfile \? this\.#terminalProfile\?\.env : undefined\)/,
        'process.start(useTerminalProfile=true) must launch the selected shell path, args and environment');
});
