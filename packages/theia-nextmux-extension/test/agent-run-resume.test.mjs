import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { OfficialModelError, terminalDeliveryError } from '@nextmux/model-runtime';
import { queuedModelRequestWasRejected } from '../lib/node/nextmux-queued-submission-store.js';

const protocol = readFileSync(fileURLToPath(new URL('../src/common/nextmux-platform-protocol.ts', import.meta.url)), 'utf8');
const service = readFileSync(fileURLToPath(new URL('../src/node/nextmux-platform-service.ts', import.meta.url)), 'utf8');
const widget = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
const history = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-conversation-history.ts', import.meta.url)), 'utf8');

test('desktop resume protocol exposes only an opaque run-state identifier', () => {
  assert.match(protocol, /readonly resumeCheckpointId\?: string/);
  assert.match(protocol, /readonly resumeStrategy\?: 'continue' \| 'retry'/);
  assert.match(protocol, /DesktopAgentRunFailure[\s\S]{0,400}readonly retrySafe\?: boolean/);
  assert.match(protocol, /DesktopAgentRunFailure[\s\S]{0,650}readonly resumeCheckpointId\?: string/);
  assert.doesNotMatch(protocol, /DesktopAgentRun(?:Request|Result)[\s\S]{0,900}readonly checkpoint\??:/);
  assert.match(service, /new AgentRunStateStore\(/);
  assert.match(service, /rebaseAgentRunCheckpoint\(/);
  assert.match(service, /retryAgentRunCheckpoint\(/);
  assert.match(service, /AgentRunInterruptedError/);
  assert.match(service, /finalizeInterruptedAgentCheckpoint\(error\.checkpoint, error\.events, runtime\)/);
  assert.match(service, /runStateStore\.save\(interruptedCheckpoint, stateOwner\)/);
  assert.match(service, /request\.resumeCheckpointId/);
});

test('root continuation narrows permission before creating tools and keeps one owner-scoped checkpoint path', () => {
  const rootResumeStart = service.indexOf('if (request.resumeCheckpointId && !childContinuation)');
  const runtimeStart = service.indexOf('const runtime = workspaceScope && workspaceScope.bindings.length > 1', rootResumeStart);
  const rootResume = service.slice(rootResumeStart, runtimeStart);
  assert.ok(rootResumeStart >= 0 && runtimeStart > rootResumeStart);
  assert.match(rootResume, /runStateStore\.loadRecord\(request\.resumeCheckpointId/);
  assert.match(rootResume, /effectivePermissionMode = narrowAgentPermission\(request\.permissionMode, storedContext\.permissionMode\)/);
  assert.match(rootResume, /taskContext: validateAgentTaskContext\([\s\S]*?permissionMode: effectivePermissionMode/);
  const runtimeCreation = service.slice(runtimeStart, service.indexOf('const tools = new AgentToolRegistry()', runtimeStart));
  assert.match(runtimeCreation, /MultiWorkspaceToolRuntime\.create\(/);
  assert.match(runtimeCreation, /WorkspaceToolRuntime\.create\(/);
  assert.doesNotMatch(runtimeCreation,
    /request\.resumeCheckpointId/,
    'a root checkpoint must be loaded before the permission-scoped runtime exists');
  assert.match(service, /rootRunId: childContinuation \? childContinuation\.rootRunId : backendRunId/,
    'the crash journal and root checkpoint share the resumed host-job owner');
});

test('safe pauses may continue automatically while stopped turns require explicit checkpoint resume', () => {
  assert.match(widget, /readonly resumeCheckpointId\?: string/);
  assert.match(widget, /resumePausedTurn\(/);
  assert.match(widget, /scheduleAutomaticResume\(/);
  assert.match(widget, /autoResumeDecision\(/);
  assert.match(widget, /failureKind: turn\.failure\?\.kind,[\s\S]{0,80}retrySafe: turn\.failure\?\.retrySafe/);
  assert.match(widget, /const delayMs = autoResumeDelayMs\([\s\S]{0,240}turn\.failure\?\.retryAfterMs[\s\S]{0,240}turn\.failure\?\.code[\s\S]{0,240}turn\.failure\?\.httpStatus/);
  assert.match(widget, /type: 'model_retry_scheduled'[\s\S]{0,300}reason: latestTurn\.failure\?\.code/);
  assert.match(widget, /resumeCheckpointId: run\.agentResult\.resumeCheckpointId/);
  assert.match(widget, /resumeCheckpointId: terminalFailure\.resumeCheckpointId/);
  assert.match(widget, /resumeStrategy: agentManualResumeStrategy\(resumedExecution\.turn\)!/);
  assert.match(widget, /resumePausedTurn\(sessionId, turnId, false\)/,
    'automatic continuation must retain the turn route instead of adopting a picker change');
  assert.match(widget, /!resumedExecution \|\| resumedExecution\.useSelectedRoute/);
  assert.match(widget, /resumedExecution\.turn\.routeId \|\| resumedExecution\.session\.routeId/);
  assert.match(widget, /routeId: route\.id, keyPriceQuoteId: route\.kind === 'managed_gateway' \? route\.keyPriceQuoteId : undefined,\s*events: run\.liveAgentEvents/,
    'each started continuation becomes the immutable route snapshot for its next automatic segment');
  assert.match(widget, /agentOutcomeText\(this\.desktopLocale, 'continueTask'\)/);
  assert.match(widget, /agentManualResumeStrategy\(\{ \.\.\.turn, stage, failure \}\)/);
  assert.match(widget, /session\.turns\.at\(-1\)\?\.id !== turnId/);
  assert.match(widget, /const cancelledActivityEvents = stage === 'cancelled' && \(liveResult\?\.stopReason \|\| turn\.stopReason\) === 'cancel_requested'\s*\? userCancelledActivityEvents\(activityEvents\) : activityEvents/,
    'only confirmed user cancellation may filter expected terminal abort diagnostics');
  assert.match(widget, /this\.renderAgentActivity\(cancelledActivityEvents, false, true, turn\.id, 'stopped', turn\.steeringMessages, liveResult\?\.changes \|\| turn\.changes\)/,
    'cancelled partial output remains visible beside the manual resume action');
  assert.doesNotMatch(widget, /CodingTurnRecord[\s\S]{0,1200}AgentRunCheckpoint/);
});

test('a persisted running turn is reconciled once and can only resume by explicit user action', () => {
  assert.match(widget, /turn\.stage === 'running' && !normalized\.agentRootRunId/,
    'legacy rows without a backend run id still settle instead of spinning forever');
  const start = widget.indexOf('protected async reconcileInterruptedAgentRun(');
  const end = widget.indexOf('protected async restoreCodingViewState(', start);
  const reconcile = widget.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(reconcile, /getAgentRunSnapshot\(requestedHostRunId, 0, 0, recoveryOwnerHint\)/);
  assert.match(reconcile, /turn\.agentHostRunId \|\| turn\.agentRootRunId/);
  assert.match(reconcile, /snapshot\.status !== 'interrupted'/);
  assert.match(reconcile, /stage: 'error'/);
  assert.match(reconcile, /failure\.resumeCheckpointId/);
  assert.doesNotMatch(reconcile, /resumePausedTurn|scheduleAutomaticResume|submitPrompt/,
    'restart recovery may expose a checkpoint but must never replay it itself');
  assert.match(widget, /await this\.reconcileInterruptedAgentRun\(session\.id\)/);
});

function directModelSeam(client, persistAgentOutputParts = async (_root, _ownerId, parts) => parts.map(part => part.type === 'text'
    ? part
    : { type: part.type, asset: { sha256: 'a'.repeat(64), mimeType: part.mimeType, sizeBytes: part.sizeBytes } })) {
    const file = ts.createSourceFile('service.ts', service, ts.ScriptTarget.Latest, true);
    const candidates = [];
    const visit = node => {
        // Match this callback's own client declaration and root options. Ancestor arrows
        // also contain the text, while the Council callback uses slotDirectOptions.
        if (ts.isArrowFunction(node) && ts.isBlock(node.body)
            && ts.isPropertyAssignment(node.parent) && node.parent.name.getText(file) === 'complete'
            && node.parameters[0]?.name.getText(file) === 'modelRequest'
            && node.body.statements.some(statement => ts.isVariableStatement(statement)
                && statement.declarationList.declarations.some(declaration => declaration.name.getText(file) === 'directClient'
                    && declaration.initializer && ts.isCallExpression(declaration.initializer)
                    && declaration.initializer.expression.getText(file) === 'createPreferredOfficialModelClient'
                    && declaration.initializer.arguments.some(argument => ts.isObjectLiteralExpression(argument)
                        && argument.properties.some(property => ts.isSpreadAssignment(property)
                            && property.expression.getText(file) === 'directClientOptions'))))) candidates.push(node);
        ts.forEachChild(node, visit);
    };
    visit(file);
    assert.equal(candidates.length, 1, 'execute the production direct model callback, not a copied adapter');
    const factory = new Function('createPreferredOfficialModelClient', 'requiredTransportCapabilitiesForRequest', 'OfficialModelError', 'terminalDeliveryError', 'persistAgentOutputParts', 'queuedModelRequestWasRejected', ts.transpile(`
        const directClientOptions = { model: 'fixture', acceptOrderedOutput: true };
        const stateConversationId = 'conversation-fixture', backendRunId = 'run-fixture';
        let modelCalled = false, resolvedOfficialModel;
        const rejections = [], execution = { onQueuedRequestRejected: rejected => rejections.push(rejected) };
        const complete = ${candidates[0].getText(file)};
        return { complete, rejections, state: () => ({ modelCalled, resolvedOfficialModel }) };
    `, { target: ts.ScriptTarget.ES2022 }));
    return factory.call(
        { nextmuxDataRoot: () => '/fixture-root', localConversationDataRoot: () => '/fixture-root' },
        options => { assert.deepEqual(options, { model: 'fixture', acceptOrderedOutput: true, requiredCapabilities: ['tools'] }); return client; },
        () => ['tools'], OfficialModelError, terminalDeliveryError, persistAgentOutputParts, queuedModelRequestWasRejected
    );
}

test('actual direct model callback preserves the original safe failure metadata without wrapping or replay', async () => {
    for (const fields of [
        { code: 'RATE_LIMITED', httpStatus: 429, retryAfterMs: 9000, retryable: true, retrySafe: false, stage: 'response', category: 'rate_limit' },
        { code: 'UNSUPPORTED_OUTPUT', retryable: false, retrySafe: false, stage: 'decode', category: 'invalid_response',
            usage: { inputTokens: 10, outputTokens: 20 }, usageKnown: true }
    ]) {
        let calls = 0;
        const failure = Object.assign(new Error('fixed public reason'), fields, { name: 'OfficialModelError', publicMessage: 'fixed public reason' });
        const seam = directModelSeam({ async complete() { calls++; throw failure; } });
        await assert.rejects(seam.complete({ messages: [], tools: [] }), error => error === failure);
        assert.equal(calls, 1);
        assert.deepEqual(seam.state(), { modelCalled: false, resolvedOfficialModel: undefined });
    }
});

test('actual direct callback only returns a queued task after a first unaccepted credential rejection', async () => {
    for (const accepted of [false, true]) {
        const failure = new OfficialModelError('AUTH_FAILED', 'key rejected', { httpStatus: 401 });
        const seam = directModelSeam({ async complete(request) {
            if (accepted) await request.onProviderEvent({ type: 'response.started', model: 'fixture' });
            throw failure;
        } });
        await assert.rejects(seam.complete({ messages: [], tools: [] }), error => error === failure);
        assert.deepEqual(seam.rejections, [false, !accepted]);
    }
    let calls = 0;
    const seam = directModelSeam({ async complete() {
        if (++calls === 1) return { content: 'paid', model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } };
        throw new OfficialModelError('AUTH_FAILED', 'key revoked later', { httpStatus: 401 });
    } });
    await seam.complete({ messages: [], tools: [] });
    await assert.rejects(seam.complete({ messages: [], tools: [] }));
    assert.deepEqual(seam.rejections, [false, false, false], 'a later rejection cannot replay an earlier paid turn');
});

test('actual direct model callback updates successful route accounting only after the returned response', async () => {
    let done;
    const response = { content: 'text', model: 'actual-model', usage: { inputTokens: 3, outputTokens: 4 } };
    const seam = directModelSeam({ complete: () => new Promise(resolve => { done = resolve; }) });
    const pending = seam.complete({ messages: [], tools: [] });
    assert.equal(seam.state().modelCalled, false);
    done(response);
    assert.deepEqual(await pending, response);
    assert.deepEqual(seam.state(), { modelCalled: true, resolvedOfficialModel: 'actual-model' });
});

test('actual direct desktop boundary persists ordered media before completion and returns only scoped references', async () => {
    const events = []; const order = []; let calls = 0;
    const seam = directModelSeam({ async complete(request) {
        calls++;
        await request.onProviderEvent?.({ type: 'response.completed', attemptId: 'fixture-attempt', model: 'fixture' });
        return { content: 'only a partial projection', model: 'actual-model',
            outputParts: [{ type: 'audio', mimeType: 'audio/wav', dataBase64: 'RAW_BYTES_MUST_STAY_IN_NODE', sizeBytes: 10 }],
            usage: { inputTokens: 3, outputTokens: 4 }, usageKnown: true };
    } }, async (root, ownerId, parts) => {
        order.push('persist');
        assert.equal(root, '/fixture-root'); assert.equal(ownerId, 'conversation-fixture');
        assert.equal(parts[0].dataBase64, 'RAW_BYTES_MUST_STAY_IN_NODE');
        return [{ type: 'audio', asset: { sha256: 'b'.repeat(64), mimeType: 'audio/wav', sizeBytes: 10 } }];
    });
    const result = await seam.complete({ messages: [], tools: [], onProviderEvent: event => {
        events.push(event); order.push('complete');
    } });
    assert.equal(calls, 1); assert.deepEqual(events.map(event => event.type), ['response.completed']);
    assert.deepEqual(order, ['persist', 'complete']);
    assert.deepEqual(result.outputParts, [{ type: 'audio', asset: { sha256: 'b'.repeat(64), mimeType: 'audio/wav', sizeBytes: 10 } }]);
    assert.equal(JSON.stringify(result).includes('RAW_BYTES_MUST_STAY_IN_NODE'), false);
    assert.deepEqual(seam.state(), { modelCalled: true, resolvedOfficialModel: 'actual-model' });
});

test('ordered output persistence failure is terminal and retains known usage without announcing completion', async () => {
    const events = [];
    const seam = directModelSeam({ async complete(request) {
        await request.onProviderEvent?.({ type: 'response.completed', attemptId: 'fixture-attempt', model: 'fixture' });
        return { content: 'projection', model: 'fixture', outputParts: [], usage: { inputTokens: 3, outputTokens: 4 }, usageKnown: true };
    } }, async () => { throw new Error('private storage details'); });
    await assert.rejects(seam.complete({ messages: [], tools: [], onProviderEvent: event => events.push(event) }), error => {
        assert.ok(error instanceof OfficialModelError); assert.equal(error.code, 'EVENT_DELIVERY_FAILED');
        assert.deepEqual(error.usage, { inputTokens: 3, outputTokens: 4 }); assert.equal(error.usageKnown, true);
        assert.equal(error.retryable, false); assert.equal(error.retrySafe, false);
        assert.equal(JSON.stringify(error).includes('private storage details'), false);
        return true;
    });
    assert.deepEqual(events, []);
});

test('actual direct desktop boundary delivers completion after acceptance, preserving known usage on observer failure', async () => {
    const completed = { type: 'response.completed', attemptId: 'fixture-attempt', model: 'fixture' };
    const response = { content: 'whole answer', model: 'fixture', usage: { inputTokens: 3, outputTokens: 4 }, usageKnown: true };
    for (const rejectCompletion of [false, true]) {
        let returned = false, calls = 0; const events = [];
        const seam = directModelSeam({ async complete(request) {
            calls++;
            await request.onProviderEvent?.({ type: 'response.started', attemptId: 'fixture-attempt', model: 'fixture' });
            await request.onProviderEvent?.(completed);
            returned = true; return response;
        } });
        const pending = seam.complete({ messages: [], tools: [], onProviderEvent: event => {
            events.push(event.type);
            if (event.type === 'response.completed') {
                assert.equal(returned, true); assert.equal(seam.state().modelCalled, true);
                if (rejectCompletion) throw new Error('private observer details');
            }
        } });
        if (rejectCompletion) await assert.rejects(pending, error => {
            assert.ok(error instanceof OfficialModelError); assert.equal(error.code, 'EVENT_DELIVERY_FAILED');
            assert.deepEqual(error.usage, response.usage); assert.equal(error.usageKnown, true); assert.equal(error.retrySafe, false);
            assert.equal(JSON.stringify(error).includes('private observer details'), false); return true;
        });
        else assert.deepEqual(await pending, response);
        assert.deepEqual(events, ['response.started', 'response.completed']); assert.equal(calls, 1);
    }
});

test('accepted empty ordered output and post-response cancellation preserve completion and usage semantics', async () => {
    for (const usageKnown of [undefined, true, false]) for (const cancel of [false, true]) {
        const controller = new AbortController(); const events = []; let calls = 0;
        const seam = directModelSeam({ async complete(request) {
            calls++;
            await request.onProviderEvent?.({ type: 'response.completed', attemptId: 'fixture', model: 'fixture' });
            if (cancel) controller.abort();
            return { content: 'answer', model: 'fixture', usage: { inputTokens: 3, outputTokens: 4 },
                ...(usageKnown === undefined ? {} : { usageKnown }), outputParts: [] };
        } });
        const pending = seam.complete({ messages: [], tools: [], signal: controller.signal, onProviderEvent: event => events.push(event) });
        if (cancel) {
            await assert.rejects(pending, error => {
                assert.ok(error instanceof OfficialModelError); assert.equal(error.code, 'CANCELLED');
                assert.equal(error.usageKnown, usageKnown !== false);
                assert.deepEqual(error.usage, usageKnown === false ? undefined : { inputTokens: 3, outputTokens: 4 });
                assert.equal(error.retrySafe, false); return true;
            });
            assert.deepEqual(events, []);
        } else {
            const result = await pending;
            assert.deepEqual(result.outputParts, []);
            assert.deepEqual(events.map(event => event.type), ['response.completed']);
        }
        assert.equal(calls, 1); assert.equal(seam.state().modelCalled, true);
    }
    const seam = directModelSeam({ async complete() { return { model: 'fixture', outputParts: [] }; } });
    assert.deepEqual(await seam.complete({ messages: [], tools: [] }), { model: 'fixture', outputParts: [] });
});

test('persisted child runs are recovered as interrupted instead of being shown as running forever', () => {
    assert.match(protocol, /\| 'interrupted'/);
    assert.match(widget, /const interrupted = status === 'running'/);
    assert.match(widget, /status: interrupted \? 'interrupted' : status/);
    assert.match(widget, /code: 'AGENT_RUN_INTERRUPTED'/);
    assert.match(widget, /case 'interrupted': return agentChildText\(this\.desktopLocale, 'interrupted'\)/);
    assert.match(widget, /active\.status === 'interrupted'/);
    assert.match(history, /'interrupted'/);
});
