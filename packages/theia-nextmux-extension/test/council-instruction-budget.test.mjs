import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { composeAgentInstructions } from '../lib/node/nextmux-agent-instructions.js';
import { DEFAULT_AGENT_INSTRUCTIONS } from '@nextmux/agent-runtime';
import { nextmuxAppInstructions, nextmuxTabInstructions } from '../lib/node/nextmux-app-tools.js';

const source = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const service = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxPlatformServiceImpl');
const method = service.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === 'agentRunInstructions').getText(ast);
const js = ts.transpileModule(`class Harness { ${method} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const council = {};
Function('exports', 'require', ts.transpile(readFileSync(new URL('../../agent-runtime/src/council.ts', import.meta.url), 'utf8'), {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
}))(council, (await import('node:module')).createRequire(import.meta.url));
const Harness = Function('readAgentInstructionFile', 'agentInstructionPath', 'readOtherInstructionFiles', 'DEFAULT_AGENT_INSTRUCTIONS',
    'nextmuxAppInstructions', 'nextmuxTabInstructions', 'composeAgentInstructions', `${js}; return Harness;`)(
    async (_path, scope) => ({ content: `${scope} instructions\n${'x'.repeat(20000)}` }), directory => directory, async () => [],
    DEFAULT_AGENT_INSTRUCTIONS, nextmuxAppInstructions, nextmuxTabInstructions, composeAgentInstructions);

test('long user instruction files cannot remove the configured team or delegation protocol', async () => {
    const slots = [
        { slotId: 'lead', modelId: 'lead-model', roles: ['lead'] },
        { slotId: 'designer', modelId: 'design-model', roles: ['ui_design', 'frontend'] },
        { slotId: 'generalist', modelId: 'other-model', roles: ['generalist'] }
    ];
    const modeInstructions = council.buildCouncilLeadInstructions(slots);
    const host = new Harness();
    Object.assign(host, { nextmuxDataRoot: () => '/personal', communitySkillsInstallRoot: () => '/skills', agentUiLabels: {},
        computerTools: { offersTabs: () => true } });
    const result = await host.agentRunInstructions('/workspace', true, modeInstructions);
    assert.ok(result.length <= 32_000, 'within the runner limit (AGENT_INSTRUCTIONS_LIMIT)');
    // The user's own files keep real room even with the coding, tab and team guidance in front of them.
    assert.ok(result.slice(result.indexOf('## User instructions (AGENTS.md)')).length > 10_000);
    assert.ok(result.includes(modeInstructions), 'complete roster and acceptance protocol must survive');
    assert.ok(result.includes('first delegate the visual design/review'));
    assert.ok(result.includes('personal instructions'));
    assert.ok(result.includes('project instructions'));
    assert.match(source, /agentRunInstructions\(workspaceRoot, request\.workbench !== 'comic', councilLeadInstructions\)/);
});
