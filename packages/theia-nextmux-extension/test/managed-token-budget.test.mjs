import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { estimateAgentModelInputTokens } from '@nextmux/agent-runtime/token-budget';
import { agentReplyReserveTokens } from '@nextmux/agent-runtime';
import { messagesWithToolImages } from '@nextmux/model-runtime';
import { estimateManagedGatewayInputTokens } from '../lib/common/nextmux-managed-token-budget.js';
import { estimateGatewayContextTokens, parseGatewayTools } from '../../../apps/cloudflare-platform/src/gateway.js';

const tool = index => ({ name: `fixture.tool-${index}`, description: `  Inspect code ${'说明 '.repeat(20)}  `,
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'A source path' } } },
    requiredPermission: 'read_only', source: 'builtin' });
const wireTools = Array.from({ length: 100 }, (_, index) => tool(index));

test('managed admission matches the real gateway context estimate for 100 tools and UTF8 text', () => {
    const instructions = '  Review the implementation.  ';
    const messages = [{ role: 'user', content: '代码审核与测试 '.repeat(500) },
        { role: 'assistant', content: 'Inspecting files', toolCalls: [{ id: 'call-1', name: 'fixture.tool-0', arguments: { path: 'src/入口.ts' } }] },
        { role: 'tool', content: 'source'.repeat(50), toolCallId: 'call-1' }];
    assert.equal(estimateManagedGatewayInputTokens(instructions, messages, wireTools),
        estimateGatewayContextTokens(instructions.trim(), messages, parseGatewayTools(wireTools)));
    const own = estimateAgentModelInputTokens(instructions, messages, wireTools);
    assert.ok(Math.abs(estimateManagedGatewayInputTokens(instructions, messages, wireTools) - own) < own * 0.15,
        'platform and own-API routes budget a request alike (about three bytes a token)');
});

test('managed estimates include tool-image forwarding, text/file attachments, output assets and provider state', () => {
    const asset = (mimeType, sizeBytes) => ({ sha256: 'a'.repeat(64), mimeType, sizeBytes });
    const messages = [{ role: 'user', content: 'Read these files', attachments: [
        { kind: 'text', name: 'readme.txt', content: 'Text attachment 说明' },
        { kind: 'file', name: 'input.pdf', mimeType: 'application/pdf', dataBase64: 'AAAA'.repeat(100) }
    ] }, { role: 'assistant', content: 'Prepared', providerState: { gemini: { signature: 'bounded-state' } },
        outputParts: [{ type: 'text', text: 'Prepared' }, { type: 'image', asset: asset('image/png', 4000) },
            { type: 'audio', asset: asset('audio/wav', 8000) }],
        toolCalls: [{ id: 'call-1', name: 'fixture.tool-0', arguments: {} }] },
    { role: 'tool', content: 'Screenshot', toolCallId: 'call-1', attachments: [
        { kind: 'image', name: 'capture.png', mimeType: 'image/png', dataBase64: 'AAAA'.repeat(200) }
    ] }];
    const transformed = messagesWithToolImages(messages).map(entry => entry.message);
    assert.equal(transformed.length, messages.length + 1);
    assert.equal(estimateManagedGatewayInputTokens('', messages, wireTools),
        estimateGatewayContextTokens('', transformed, parseGatewayTools(wireTools)));
});

test('non-serializable managed request metadata cannot bypass a capacity check', () => {
    const circular = {}; circular.self = circular;
    assert.equal(estimateManagedGatewayInputTokens('', [{ role: 'user', content: 'hello' }],
        [{ ...tool(0), inputSchema: circular }]), Number.MAX_SAFE_INTEGER);
});

// Exercise the actual managed pre-dispatch block without connecting to a provider.
const source = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true);
let managedClient;
const visit = node => {
    if (ts.isObjectLiteralExpression(node) && node.properties.some(property => ts.isPropertyAssignment(property)
        && property.name.getText(ast) === 'estimateInputTokens' && property.initializer.getText(ast).includes('estimateManagedGatewayInputTokens'))) managedClient = node;
    ts.forEachChild(node, visit);
};
visit(ast); assert.ok(managedClient);
const complete = managedClient.properties.find(property => property.name?.getText(ast) === 'complete').initializer;
const statements = [];
for (const statement of complete.body.statements) {
    if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => declaration.name.getText(ast) === 'attemptId')) break;
    statements.push(statement.getText(ast));
}
class CapacityError extends Error { constructor(code, message) { super(message); this.code = code; } }
const budgetAtDispatch = new Function('modelRequest', 'estimateManagedGatewayInputTokens', 'messagesWithToolImages', 'PlatformRequestError', 'agentReplyReserveTokens',
    ts.transpileModule(`const execution = {}, request = {}, managedRoute = {}, initialSwitchPolicy = {};
        const normalizeModelSwitchPolicyForDispatch = () => ({});
        ${statements.join('\n')}
        return { estimatedInput, maximumOutputTokens };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
const dispatch = (request, limits) => budgetAtDispatch.call({ contextLimitsForRequest: () => limits }, request,
    estimateManagedGatewayInputTokens, messagesWithToolImages, CapacityError, agentReplyReserveTokens);

test('managed preflight fits a request by tokens, as the gateway does, keeping room for a reply', () => {
    const limits = { contextWindowTokens: 5000, modelOutputTokenLimit: 4096 };
    // 1400 CJK characters are 4200 bytes but about 1400 tokens: they fit a 5000-token window (round 33: counting
    // bytes turned away every coding request on a 32k model).
    const fitting = { instructions: '', messages: [{ role: 'user', content: '一'.repeat(1400) }], tools: [], maxOutputTokens: 600 };
    assert.ok(dispatch(fitting, limits).estimatedInput < 1500);
    // Past the window minus a quarter-window reply reserve (5000 - 1250) it is still refused before sending.
    const tooLarge = { ...fitting, messages: [{ role: 'user', content: '一'.repeat(3800) }] };
    assert.throws(() => dispatch(tooLarge, limits), error => error.code === 'CONTEXT_WINDOW_EXCEEDED' && error.retrySafe === true);
});

test('managed preflight retains a fitting output request and rejects stale excess output instead of clipping it', () => {
    const request = { instructions: '', messages: [{ role: 'user', content: 'Review code' }], tools: [], maxOutputTokens: 512 };
    const limits = { contextWindowTokens: 5000, modelOutputTokenLimit: 4096 };
    const result = dispatch(request, limits);
    assert.equal(result.maximumOutputTokens, 512);
    assert.ok(result.estimatedInput + result.maximumOutputTokens <= limits.contextWindowTokens);
    assert.throws(() => dispatch({ ...request, maxOutputTokens: 5000 }, limits), error => error.code === 'CONTEXT_WINDOW_EXCEEDED');
});
