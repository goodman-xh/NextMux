import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(relative, replacements = {}) {
    const module = { exports: {} };
    const js = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    Function('require', 'module', 'exports', js)(id => replacements[id] || require(id), module, module.exports);
    return module.exports;
}
const council = load('../../agent-runtime/src/council.ts');
const config = load('../src/common/nextmux-council-config.ts', { '@nextmux/agent-runtime/council': council });
const rawWidget = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const widgetAst = ts.createSourceFile('widget.tsx', rawWidget, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = widgetAst.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const methods = ['ensureCouncilConfigsLoaded', 'persistCouncilConfigs', 'sessionCouncilKey', 'invalidCouncilConfigEntry',
    'invalidCouncilConfigMessage', 'councilConfigForEditing', 'activeCouncilConfig', 'pendingCouncilConfig', 'effectiveCouncilConfig',
    'saveCouncilConfigModal', 'closeCouncilConfigModal', 'executePromptSubmission'].map(name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(widgetAst) === name).getText(widgetAst)).join('\n');
const compiled = ts.transpileModule(`class NextMuxDesktopWidget {
    static COUNCIL_CONFIGS_STORAGE_KEY='v2'; static LEGACY_COUNCIL_CONFIGS_STORAGE_KEY='v1'; ${methods}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const message = (_locale, error) => `Please correct Council: ${error}`;
const Harness = Function('normalizeAgentCouncilConfigRoles', 'validateAgentCouncilConfig', 'councilConfigRepairDraft',
    'validateDesktopCouncilConfig', 'councilInvalidHistoryMessage', 'councilValidationMessage', `${compiled};return NextMuxDesktopWidget;`)
    (council.normalizeAgentCouncilConfigRoles, council.validateAgentCouncilConfig, config.councilConfigRepairDraft,
        config.validateDesktopCouncilConfig, message, message);
const slot = (id, roles = ['generalist']) => ({ slotId: id, modelId: `model-${id}`, modelLabel: id, routeId: `route-${id}`,
    roles, route: { kind: 'official_connection', connectionId: `connection-${id}`, model: `model-${id}` } });
const valid = () => ({ enabled: true, revision: 7, sourceKey: 'official:provider', leadSlotId: 'lead',
    slots: [slot('lead', ['lead']), slot('front', ['frontend']), slot('back', ['backend'])] });
function fixture(storage = new Map()) {
    globalThis.window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
    const host = new Harness();
    Object.assign(host, { councilConfigsBySession: new Map(), invalidCouncilConfigsBySession: new Map(),
        pendingCouncilConfigsBySession: new Map(), activeCodingSessionId: 's', desktopLocale: 'zh-CN', updates: 0, opens: 0,
        update() { this.updates++; }, openCouncilConfigModal() { this.opens++; },
        councilModalSlots: [], councilModalRelayKey: 'official:provider', councilConfigModalOpen: true,
        relayPickerOptions: () => [], relayOption: () => ({ label: 'Provider' }),
        councilRoutesForRelay: () => { throw Error('invalid drafts must stop before route work'); }
    });
    return { host, storage };
}

test('shared validation rejects malformed configurations without throwing', () => {
    const cases = [[null, 'min_slots'], [{ ...valid(), relayKey: 7 }, 'config_invalid'], [{ ...valid(), enabled: 'true' }, 'config_invalid'], [{ slots: [] }, 'min_slots'],
        [{ ...valid(), slots: [...valid().slots, ...Array.from({ length: 6 }, (_, i) => slot(`more-${i}`))] }, 'max_slots'],
        [{ ...valid(), slots: [null, ...valid().slots.slice(1)] }, 'slot_invalid']];
    for (const [field, value, error] of [['slotId', '', 'slot_id_required'], ['slotId', 'front', 'duplicate_slot_ids'],
        ['modelId', 3, 'slot_model_required'], ['roles', [], 'slot_roles_required'], ['roles', ['unknown'], 'slot_roles_invalid'],
        ['roles', [undefined], 'slot_roles_invalid']]) {
        const input = valid(); input.slots[0][field] = value; cases.push([input, error]);
    }
    for (const [input, error] of cases) assert.deepEqual(council.validateAgentCouncilConfig(input), { valid: false, error });
    assert.deepEqual(council.validateAgentCouncilConfig(valid()), { valid: true });
    const eight = valid(); eight.slots.push(...Array.from({ length: 5 }, (_, i) => slot(`more-${i}`)));
    assert.equal(council.validateAgentCouncilConfig(eight).valid, true);
});

test('exactly one lead is enforced while a temporary zero-lead draft is retained for editing', () => {
    const { host } = fixture();
    const noLead = valid(); noLead.slots[0].roles = ['planning'];
    assert.equal(council.validateAgentCouncilConfig(noLead).error, 'lead_required');
    const twoLeads = valid(); twoLeads.slots[1].roles.push('lead');
    assert.equal(council.validateAgentCouncilConfig(twoLeads).error, 'multiple_leads');
    assert.equal(council.validateAgentCouncilConfig({ ...valid(), leadSlotId: 'front' }).error, 'lead_slot_mismatch');
    for (const draft of [noLead, twoLeads, { slots: Array.from({ length: 9 }, (_, i) => slot(`slot-${i}`, i ? ['qa'] : ['lead'])) }]) {
        host.councilModalSlots = draft.slots;
        host.saveCouncilConfigModal();
        assert.strictEqual(host.councilModalSlots, draft.slots);
        assert.equal(host.councilConfigModalOpen, true);
        assert.equal(host.councilConfigsBySession.size, 0);
    }
});

test('15 historical labels map into 8 canonical roles without changing model, slot or route identity', () => {
    assert.deepEqual(council.AGENT_COUNCIL_ROLE_IDS, ['lead', 'planning', 'frontend', 'backend', 'qa', 'review', 'delivery', 'generalist']);
    const legacy = valid(); legacy.slots[1].roles = ['requirements', 'research', 'architecture', 'ui_design', 'frontend',
        'systems', 'data', 'backend', 'security', 'review', 'platform', 'docs', 'qa', 'generalist'];
    const old = structuredClone(legacy), migrated = council.normalizeAgentCouncilConfigRoles(legacy);
    assert.deepEqual(migrated.slots[1].roles, ['planning', 'frontend', 'backend', 'review', 'delivery', 'qa', 'generalist']);
    assert.deepEqual(legacy, old);
    for (let i = 0; i < legacy.slots.length; i++) {
        assert.equal(migrated.slots[i].slotId, legacy.slots[i].slotId); assert.equal(migrated.slots[i].modelId, legacy.slots[i].modelId);
        assert.strictEqual(migrated.slots[i].route, legacy.slots[i].route);
    }
    assert.equal(council.validateAgentCouncilConfig(migrated).valid, true);
    const unknown = valid(); unknown.slots[1].roles = ['custom-expert'];
    assert.equal(council.validateAgentCouncilConfig(council.normalizeAgentCouncilConfigRoles(unknown)).error, 'slot_roles_invalid');
    assert.equal(council.isAgentCouncilRoleId('ui_design'), true, 'historical receipt role is still accepted unchanged');
    const routed = council.resolveAgentCouncilSlot(legacy.slots, 'architecture', 'unknown-slot', 0);
    assert.equal(routed.role, 'planning'); assert.equal(routed.slotId, 'front');
    const instructions = council.buildCouncilLeadInstructions(migrated.slots);
    assert.match(instructions, /`planning`/); assert.doesNotMatch(instructions, /`ui_design`|`architecture`|`security`/);
});

test('v1 migrates to v2 while keeping its bytes and invalid entries available for repair', () => {
    const legacy = valid(); legacy.slots[1].roles = ['architecture', 'requirements'];
    const invalid = valid(); invalid.slots[1].roles = ['unrecognized'];
    const original = JSON.stringify({ s: legacy, broken: invalid }, null, 2);
    const { host, storage } = fixture(new Map([['v1', original]]));
    host.ensureCouncilConfigsLoaded();
    assert.equal(storage.get('v1'), original);
    assert.deepEqual(host.activeCouncilConfig('s').slots[1].roles, ['planning']);
    assert.deepEqual(JSON.parse(storage.get('v2')).broken, invalid);
    host.persistCouncilConfigs();
    assert.equal(storage.get('v1'), original);
    assert.deepEqual(host.invalidCouncilConfigsBySession.get('broken'), invalid);
    const reopened = fixture(storage).host;
    assert.deepEqual(reopened.activeCouncilConfig('s').slots[1].roles, ['planning']);
    assert.equal(reopened.activeCouncilConfig('broken'), undefined);
    assert.match(reopened.invalidCouncilConfigMessage('broken'), /slot_roles_invalid/);
});

test('invalid history never executes or silently borrows another conversation, and repair drafts do not mutate it', async () => {
    const invalid = valid(); invalid.slots[1].slotId = 'lead'; invalid.slots[2].roles = ['bad-role'];
    const { host, storage } = fixture(new Map([['v1', JSON.stringify({ s: invalid, good: valid() })]]));
    const draft = host.councilConfigForEditing('s');
    assert.equal(new Set(draft.slots.map(item => item.slotId)).size, 3);
    assert.deepEqual(draft.slots[2].roles, []);
    assert.deepEqual(host.invalidCouncilConfigsBySession.get('s'), invalid);
    assert.equal(await host.executePromptSubmission('coding'), false);
    assert.equal(host.opens, 1);
    host.activeCodingSessionId = 'good';
    assert.equal(await host.executePromptSubmission('coding', { session: { id: 's' } }), false);
    assert.equal(host.opens, 1, 'background invalid session must not open the visible session settings');
    host.persistCouncilConfigs();
    assert.deepEqual(JSON.parse(storage.get('v2')).s, invalid);
});

test('explicitly saving a corrected draft replaces only its invalid entry and leaves v1 recovery intact', () => {
    const invalid = valid(); invalid.slots[1].roles = ['old-unknown-role'];
    const other = valid(); other.slots[1].slotId = 'lead';
    const raw = JSON.stringify({ s: invalid, other });
    const { host, storage } = fixture(new Map([['v1', raw]]));
    const repaired = host.councilConfigForEditing('s');
    repaired.slots[1].roles = ['planning'];
    host.councilModalSlots = repaired.slots;
    host.councilRoutesForRelay = () => repaired.slots.map(item => ({ id: item.routeId, kind: 'official_connection',
        connection: { id: item.route.connectionId, model: item.modelId } }));
    host.modelKeyForRoute = route => route.connection.model;
    host.scheduleRouteModelLabel = route => route.id;
    host.isCodingSessionRunning = () => false;
    host.saveCouncilConfigModal();
    const saved = host.activeCouncilConfig('s');
    assert.deepEqual(saved.slots.map(item => item.slotId), invalid.slots.map(item => item.slotId));
    assert.deepEqual(saved.slots.map(item => item.modelId), invalid.slots.map(item => item.modelId));
    assert.deepEqual(saved.slots.map(item => item.route), invalid.slots.map(item => item.route));
    assert.deepEqual(saved.slots[1].roles, ['planning']);
    assert.equal(saved.revision, invalid.revision + 1);
    assert.equal(host.invalidCouncilConfigEntry('s'), undefined);
    // Saving closes the modal through its 160 ms fade-out (closeCouncilConfigModal).
    assert.equal(host.councilConfigModalClosing, true);
    assert.deepEqual(JSON.parse(storage.get('v2')).other, other);
    assert.equal(storage.get('v1'), raw);
});

test('broken JSON survives as a retained invalid entry rather than being discarded on a later save', () => {
    const raw = '{"s":broken'; const { host, storage } = fixture(new Map([['v1', raw]]));
    host.ensureCouncilConfigsLoaded(); host.persistCouncilConfigs();
    assert.equal(storage.get('v1'), raw);
    assert.equal(JSON.parse(storage.get('v2'))[''], raw);
    assert.match(host.invalidCouncilConfigMessage('s'), /min_slots/);
});

const serviceSource = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const serviceAst = ts.createSourceFile('service.ts', serviceSource, ts.ScriptTarget.Latest, true);
const service = serviceAst.statements.find(node => ts.isClassDeclaration(node) && node.members.some(member => member.name?.getText(serviceAst) === 'startAgentRun'));
const serviceMethods = ['normalizeCouncilRunRequest', 'startAgentRun', 'startAgentRunForProject'].map(name =>
    service.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(serviceAst) === name).getText(serviceAst)).join('\n');
class Failure extends Error { constructor(code, message) { super(message); this.code = code; } }
const Host = Function('normalizeAgentCouncilConfigRoles', 'validateDesktopCouncilConfig', 'agentCouncilValidationErrorMessage', 'PlatformRequestError',
    `${ts.transpileModule(`class Host { ${serviceMethods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};return Host;`)
    (council.normalizeAgentCouncilConfigRoles, config.validateDesktopCouncilConfig, council.agentCouncilValidationErrorMessage, Failure);

test('both host admission paths reject invalid Council before workspace, model, or conversation side effects', async () => {
    const host = new Host();
    const noLead = valid(); noLead.slots[0].roles = ['qa'];
    for (const candidate of [noLead, null, { ...valid(), slots: [...valid().slots, slot('lead')] }]) {
        for (const name of ['startAgentRun', 'startAgentRunForProject']) {
            await assert.rejects(host[name]({ councilConfig: candidate, childContinuation: { childRunId: 'child' }, conversationId: 's' }),
                error => error.code === 'COUNCIL_CONFIG_INVALID' && /Council/i.test(error.message));
        }
    }
    const legacy = valid(); legacy.slots[1].roles = ['ui_design'];
    const normalized = host.normalizeCouncilRunRequest({ councilConfig: legacy });
    assert.deepEqual(normalized.councilConfig.slots[1].roles, ['frontend']);
    assert.strictEqual(normalized.councilConfig.slots[1].route, legacy.slots[1].route);
    assert.equal(host.normalizeCouncilRunRequest({ councilConfig: { enabled: false } }).councilConfig, undefined);
    const missingRoute = valid(); delete missingRoute.slots[1].route;
    assert.throws(() => host.normalizeCouncilRunRequest({ councilConfig: missingRoute }), /provider route/);
});

const discovery = load('../src/node/nextmux-official-discovery.ts');
let slotClientSource;
(function walk(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(serviceAst) === 'getCouncilSlotModelClient') slotClientSource = node.initializer.getText(serviceAst);
    ts.forEachChild(node, walk);
})(serviceAst);
assert.ok(slotClientSource);
const clientJs = ts.transpileModule(`const getClient = ${slotClientSource};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function slotClientFixture(selected = slot('specialist'), options = {}) {
    const created = [];
    const connection = { id: 'connection-specialist', providerId: 'openai', model: 'changed-default', protocol: 'openai_responses',
        discoveredModels: [{ id: 'model-specialist', type: 'chat', capabilities: ['text', 'tools'], toolsSupported: true }] };
    const host = { readOfficialConnectionIndex: async () => options.connections ?? [connection],
        readOfficialCredential: async () => options.noCredential ? null : 'fixture-only', modelConnectionNetwork: () => ({}) };
    const get = Function('councilConfig', 'councilSlotModelClients', 'model', 'PlatformRequestError', 'boundedModel',
        'isDiscoveredInvocationAllowed', 'credentialSourceFor', 'createPreferredOfficialModelClient', `${clientJs};return getClient;`)
        .call(host, { slots: selected ? [selected] : [] }, new Map(), { defaultModelMustNeverBeReturned: true }, Failure, id => id,
            discovery.isDiscoveredInvocationAllowed, () => 'api_key', config => { created.push(config); return { estimateInputTokens: () => 1 }; });
    return { get, created, connection };
}

test('a resolved slot never borrows the lead model when connection, credential, exact model or route is unavailable', async () => {
    const missingExact = slot('specialist'); delete missingExact.route.model;
    const invalidRoute = slot('specialist'); invalidRoute.route = { kind: 'removed_kind' };
    const blocked = { id: 'connection-specialist', providerId: 'openai', model: 'model-specialist',
        discoveredModels: [{ id: 'model-specialist', toolsSupported: false }] };
    const failures = [slotClientFixture(null), slotClientFixture(slot('specialist'), { connections: [] }),
        slotClientFixture(slot('specialist'), { noCredential: true }), slotClientFixture(missingExact), slotClientFixture(invalidRoute),
        slotClientFixture(slot('specialist'), { connections: [blocked] })];
    for (const fixture of failures) {
        await assert.rejects(fixture.get('specialist'), error => error.code === 'COUNCIL_SLOT_ROUTE_UNAVAILABLE');
        assert.equal(fixture.created.length, 0);
    }
    const exact = slotClientFixture();
    const client = await exact.get('specialist');
    assert.equal(client.defaultModelMustNeverBeReturned, undefined);
    assert.equal(exact.created[0].model, 'model-specialist');
    assert.notEqual(exact.created[0].model, exact.connection.model, 'changed connection default cannot replace the saved exact model');
    assert.strictEqual(await exact.get('specialist'), client);
    assert.equal(exact.created.length, 1);
});

test('managed routes retain their declared fixed or automatic identity, while incomplete routes require repair', () => {
    for (const route of [{ mode: 'fixed', offeringId: 'offering-1', keyPriceQuoteId: 'quote-1' },
        { mode: 'automatic', registryModelId: 'registry-1', keyPriceQuoteId: 'quote-1' }]) {
        const saved = valid(); saved.slots[1].route = { kind: 'managed_gateway', route };
        assert.equal(config.validateDesktopCouncilConfig(saved).valid, true);
        const normalized = new Host().normalizeCouncilRunRequest({ councilConfig: saved });
        assert.strictEqual(normalized.councilConfig.slots[1].route.route, route);
    }
    for (const route of [{ mode: 'fixed' }, { mode: 'automatic' }, { mode: 'unrecognized', offeringId: 'offering-1' }]) {
        const saved = valid(); saved.slots[1].route = { kind: 'managed_gateway', route };
        assert.equal(config.validateDesktopCouncilConfig(saved).error, 'slot_route_required');
    }
});
