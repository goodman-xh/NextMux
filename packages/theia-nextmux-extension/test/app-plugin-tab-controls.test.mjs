import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { loadCurrentSource } from './helpers/current-source-loader.mjs';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const runtimeText = loadCurrentSource(new URL('../src/browser/nextmux-app-plugin-runtime-locale.ts', import.meta.url));
const viewCode = ts.transpileModule(readFileSync(new URL('../src/browser/nextmux-app-plugins-view.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }
}).outputText;
function loadView(react = core('react')) {
    const local = createRequire(new URL('../lib/browser/nextmux-app-plugins-view.js', import.meta.url)), module = { exports: {} };
    new Function('require', 'module', 'exports', viewCode)(name => name === '@theia/core/shared/react' ? react
        : name === './nextmux-app-plugin-runtime-locale' ? runtimeText : local(name), module, module.exports);
    return module.exports;
}
const { pluginsForApp, appPluginGoalPresets, appPluginInlineModels } = loadView();

const plugin = (id, apps, patch = {}) => ({ id, ok: true, enabled: true, ready: true, model: null, summary: { apps, decisions: [], goals: { default: '', examples: [] } }, ...patch });

test('app plugins match Windows paths, AUMIDs and localized window titles without crossing platforms', () => {
    const plugins = [
        plugin('notepad', [{ platform: 'windows', program: 'Notepad', titleIncludes: '记事本' }]),
        plugin('launcher', [{ platform: 'windows', program: 'launcher' }]),
        plugin('league', [{ platform: 'windows', program: 'League of Legends', name: '英雄联盟' }]),
        plugin('mac', [{ platform: 'macos', bundleId: 'com.apple.TextEdit', program: 'TextEdit.app' }]),
        // Installed plugins are always enabled now (apps/desktop/app-plugins.cjs migrates `enabled` to true), so only a
        // broken plugin is left out.
        plugin('invalid', [{ platform: 'windows', program: 'Notepad' }], { ok: false })
    ];
    const matches = (id, title, windowTitle, os = 'win32') => pluginsForApp(plugins, id, os, title, windowTitle).map(item => item.id);
    assert.deepEqual(matches('Microsoft.WindowsNotepad_8wekyb3d8bbwe!App'), ['notepad']);
    assert.deepEqual(matches('WindowsNotepad_8wekyb3d8bbwe'), ['notepad']);
    assert.deepEqual(matches('C:\\WeGameApps\\英雄联盟\\WeGameLauncher\\LAUNCHER.EXE'), ['launcher']);
    assert.deepEqual(matches('C:/Games/League of Legends.exe'), ['league']);
    assert.deepEqual(matches('unknown.exe', '新建文档', '无标题 - 记事本'), ['notepad']);
    assert.deepEqual(matches('', '英雄联盟 · 对局中'), ['league']);
    assert.deepEqual(matches(undefined, '', 'NOTEPAD - Notes'), ['notepad']);
    assert.deepEqual(matches('com.apple.TextEdit', '', '', 'MacIntel'), ['mac']);
    assert.deepEqual(matches('/Applications/TextEdit.app', '', '', 'darwin'), ['mac']);
    assert.deepEqual(matches('Notepad', '记事本', '', 'MacIntel'), []);
    assert.deepEqual(matches('unknown', 'unrelated window'), []);
    assert.deepEqual(matches('C:\\Microsoft.WindowsNotepad_cache\\unrelated.exe'), [], 'a directory name is not an AUMID');
    const short = [plugin('short', [{ platform: 'windows', program: 'x' }])];
    assert.equal(pluginsForApp(short, 'unknown', 'win32', 'example').length, 0, 'one-character program names do not match arbitrary titles');
    assert.equal(pluginsForApp(short, 'X.exe', 'win32').length, 1, 'short exact executable names still work');
});

test('declared presets win, older plugins get exactly three app-specific goals, and examples remain useful', () => {
    const base = plugin('example', []);
    const declared = [{ id: 'survive', label: '稳住', goal: '保持安全', description: '低风险推进' }];
    assert.deepEqual(appPluginGoalPresets({ ...base, presets: declared }, 'WeGame', 'zh-CN'), declared);
    assert.deepEqual(appPluginGoalPresets({ ...base, summary: { ...base.summary, presets: declared } }, 'WeGame', 'zh-CN'), declared);
    const game = appPluginGoalPresets(base, 'League of Legends', 'zh-CN');
    assert.equal(game.length, 3);
    assert.match(game[0].goal, /生存/);
    const document = appPluginGoalPresets(base, '记事本', 'zh-CN');
    assert.equal(document.length, 3);
    assert.match(document[0].goal, /文档/);
    const examples = appPluginGoalPresets({ ...base, summary: { ...base.summary, goals: { examples: ['Example goal'] } } }, 'Other', 'en');
    assert.equal(examples.length, 3);
    assert.equal(examples[0].goal, 'Example goal');
    assert.equal(new Set(examples.map(item => item.id)).size, 3);
});

test('inline Jev options use real configured sources and preserve active merchant/local selections', () => {
    const choices = {
        relays: [{ model: '~typesafe/jev-latest', label: 'Jev', routes: [{ offeringId: 'route', merchant: 'Seller' }] },
            { model: 'unavailable/jev-latest', label: 'Unavailable', routes: [] }],
        connections: [{ connectionId: 'own', provider: 'openrouter', label: 'My router', decisions: [{ model: '~typesafe/jev-latest', label: 'Jev' }] },
            { connectionId: 'other', provider: 'openai', label: 'Other API', decisions: [{ model: '~typesafe/jev-latest', label: 'Jev' }] }],
        local: [{ endpoint: 'http://127.0.0.1:9001', protocol: 'systemone', models: [{ model: 'systemone' }] }]
    };
    const current = { source: 'nextmux', model: '~typesafe/jev-latest', offeringId: 'preferred', merchant: 'Preferred seller' };
    const options = appPluginInlineModels(choices, current);
    assert.ok(options.includes(current));
    assert.equal(options.filter(item => item.source === 'connection').length, 1);
    assert.equal(options.find(item => item.source === 'connection').connectionId, 'own');
    assert.equal(options.find(item => item.source === 'local').endpoint, 'http://127.0.0.1:9001');
    assert.equal(options.some(item => item.model === 'unavailable/jev-latest'), false);
    const local = { source: 'local', model: 'systemone', endpoint: 'http://127.0.0.1:9001', protocol: 'systemone', images: true };
    assert.equal(appPluginInlineModels(choices, local).find(item => item.source === 'local'), local, 'a saved local vision capability is retained even when discovery omits it');
    assert.deepEqual(appPluginInlineModels(undefined), [], 'no fabricated endpoints or configured API ids');
});

// A component event harness: execute the real handlers, retain useState between renders, and flush
// effects on dependency changes. No DOM/layout behavior is claimed by these interaction unit tests.
function componentHarness() {
    const React = core('react');
    let context;
    const react = { ...React,
        useState(initial) {
            const owner = context, index = owner.index++;
            if (!(index in owner.values)) owner.values[index] = typeof initial === 'function' ? initial() : initial;
            return [owner.values[index], value => { owner.values[index] = typeof value === 'function' ? value(owner.values[index]) : value; owner.dirty = true; }];
        },
        useEffect(effect, dependencies) {
            const owner = context, index = owner.index++, previous = owner.values[index];
            if (!previous || dependencies.some((value, offset) => !Object.is(value, previous[offset]))) {
                owner.values[index] = dependencies;
                owner.effects.push(effect);
            }
        }
    };
    const view = loadView(react);
    function mount(element) {
        const owner = { values: [], index: 0, effects: [], dirty: false };
        return { render(props = element.props) {
            let result;
            for (let attempts = 0; attempts < 5; attempts++) {
                owner.index = 0; owner.dirty = false; owner.effects = []; context = owner;
                result = element.type(props); context = undefined;
                for (const effect of owner.effects) effect();
                if (!owner.dirty) return result;
            }
            throw new Error('Component did not settle');
        } };
    }
    return { ...view, mount };
}
function elements(root, predicate) {
    const found = [];
    const visit = value => {
        if (Array.isArray(value)) { value.forEach(visit); return; }
        if (!value || typeof value !== 'object') return;
        if (predicate(value)) found.push(value);
        visit(value.props?.children);
    };
    visit(root);
    return found;
}
const component = (root, name) => elements(root, element => (element.type?.name || element.type?.render?.name) === name)[0];
const tagged = (root, tag) => elements(root, element => element.type === tag);
// Preset goals render in their own (hook-free) AppPluginPresetChoices component inside the goal controls.
const presetButtons = root => { const choices = component(root, 'AppPluginPresetChoices'); return choices ? tagged(choices.type(choices.props), 'button') : []; };

test('app hub sends goals to its own run and routes another plugin preset through the start coordinator', () => {
    const view = componentHarness();
    const calls = [];
    const current = plugin('game', [], { presets: [{ id: 'safe', label: '优先生存', goal: '保持安全' }, { id: 'push', label: '推进目标', goal: '推进团队目标' }] });
    const base = { locale: 'zh-CN', appName: 'League of Legends', plugins: [current], compatible: [current],
        market: { plugins: [], loading: false, error: '' }, marketBusy: '', running: false,
        onStart: (...args) => calls.push(['start', ...args]), onCommand: value => calls.push(['command', value]), onChooseModel() {} };
    const hub = view.AppPluginHubDialog(base);
    assert.ok(component(hub, 'AppPluginInlineModelBar'));
    const goal = component(hub, 'AppPluginGoalControls'), mounted = view.mount(goal);
    let node = mounted.render();
    presetButtons(node)[0].props.onClick();
    assert.deepEqual(calls.at(-1), ['start', 'game', '保持安全']);
    assert.equal(component(mounted.render(), 'ImeInput').props.value, '保持安全');
    const activeRun = { runId: 'tab-run', pluginId: 'game', goal: '保持安全', ended: false, paused: true };
    const props = { ...goal.props, activeRun, running: true };
    node = mounted.render(props);
    presetButtons(node)[1].props.onClick();
    assert.deepEqual(calls.at(-1), ['command', { runId: 'tab-run', command: 'goal', goal: '推进团队目标' }]);
    node = mounted.render(props);
    assert.equal(component(node, 'ImeInput').props.value, '推进团队目标');
    component(node, 'ImeInput').props.onChange({ currentTarget: { value: '等待队友' } });
    node = mounted.render(props);
    tagged(node, 'form')[0].props.onSubmit({ preventDefault() {} });
    assert.deepEqual(calls.at(-1), ['command', { runId: 'tab-run', command: 'goal', goal: '等待队友' }]);
    const count = calls.length;
    node = mounted.render({ ...props, activeRun: { ...activeRun, pluginId: 'other-plugin' } });
    assert.ok(presetButtons(node).every(button => !button.props.disabled),
        'presets stay available when another plugin runs; an empty custom goal still cannot be submitted');
    presetButtons(node)[0].props.onClick();
    assert.equal(calls.length, count + 1);
    assert.deepEqual(calls.at(-1), ['start', 'game', '保持安全'], 'the widget stops the other plugin before starting this one');
    node = mounted.render({ ...goal.props, plugin: { ...current, ready: false } });
    assert.ok([...tagged(node, 'button'), ...presetButtons(node)].every(button => button.props.disabled));
});

test('inline Jev model selections immediately save real API/local configurations and preserve detail controls', () => {
    const view = componentHarness(), calls = [];
    const current = plugin('game', [], { model: { source: 'nextmux', model: '~typesafe/jev-latest' } });
    const choices = { relays: [{ model: '~typesafe/jev-latest', label: 'Jev', routes: [{ offeringId: 'route', merchant: 'Platform' }] }],
        connections: [{ connectionId: 'router', provider: 'openrouter', label: 'My OpenRouter', decisions: [{ model: '~typesafe/jev-latest', label: 'Jev' }], vision: [] }],
        local: [{ endpoint: 'http://127.0.0.1:9001', protocol: 'systemone', name: 'OpenJev', models: [{ model: 'systemone' }] }] };
    const hub = view.AppPluginHubDialog({ locale: 'zh-CN', appName: 'Game', plugins: [current], compatible: [current],
        market: { plugins: [] }, choices, onSaveModel: (...args) => calls.push(['model', ...args]), onChooseModel: id => calls.push(['details', id]) });
    const bar = component(hub, 'AppPluginInlineModelBar'), mounted = view.mount(bar);
    let node = mounted.render();
    tagged(node, 'select')[0].props.onChange({ currentTarget: { value: 'openrouter' } });
    assert.equal(calls.at(-1)[2].source, 'connection');
    assert.equal(calls.at(-1)[2].connectionId, 'router');
    assert.equal(calls.at(-1)[2].model, '~typesafe/jev-latest');
    node = mounted.render();
    tagged(node, 'select')[0].props.onChange({ currentTarget: { value: 'local' } });
    assert.equal(calls.at(-1)[2].source, 'local');
    assert.equal(calls.at(-1)[2].endpoint, 'http://127.0.0.1:9001');
    assert.equal(calls.at(-1)[2].protocol, 'systemone');
    node = mounted.render();
    const selectedOption = tagged(node, 'option').find(option => option.props.value?.includes('systemone'));
    tagged(node, 'select')[1].props.onChange({ currentTarget: { value: selectedOption.props.value } });
    assert.equal(calls.at(-1)[2].model, 'systemone');
    tagged(node, 'button')[0].props.onClick();
    assert.deepEqual(calls.at(-1), ['details', 'game']);
    const count = calls.length;
    const unavailable = { ...bar.props, choices: { relays: [], connections: [], local: [] } };
    node = mounted.render(unavailable);
    tagged(node, 'select')[0].props.onChange({ currentTarget: { value: 'openrouter' } });
    node = mounted.render(unavailable);
    assert.equal(calls.length, count, 'no fabricated connection is saved');
    assert.equal(tagged(node, 'select')[1].props.disabled, true);
    assert.match(tagged(node, 'small')[0].props.children, /暂无可用/);
});

test('run bar exposes inline models, sends goals while active, restarts ended runs and renders callback errors', () => {
    const view = componentHarness(), calls = [];
    const current = plugin('game', [], { presets: [{ id: 'safe', label: '优先生存', goal: '保持安全' }] });
    const run = { runId: 'tab-run', pluginId: 'game', name: 'Game', goal: '推进目标', ended: false, elapsedMs: 1, startedAt: 0, costUsd: 0 };
    const props = { locale: 'zh-CN', plugin: current, appName: 'League of Legends', run, now: 100,
        onStart: (...args) => calls.push(['start', ...args]), onCommand: value => calls.push(['command', value]), error: '保存模型失败' };
    const node = view.AppPluginRunBar(props);
    assert.ok(component(node, 'AppPluginInlineModelBar'));
    const modelBar = view.mount(component(node, 'AppPluginInlineModelBar')).render();
    assert.ok(tagged(modelBar, 'small').some(item => /立即应用到正在运行的插件/.test(item.props.children)));
    assert.equal(elements(node, element => element.props?.role === 'alert')[0].props.children, '保存模型失败');
    const goal = component(node, 'AppPluginGoalControls'), mounted = view.mount(goal);
    presetButtons(mounted.render())[0].props.onClick();
    assert.deepEqual(calls.at(-1), ['command', { runId: 'tab-run', command: 'goal', goal: '保持安全' }]);
    presetButtons(mounted.render({ ...goal.props, activeRun: { ...run, ended: true } }))[0].props.onClick();
    assert.deepEqual(calls.at(-1), ['start', 'game', '保持安全']);
    const hub = view.AppPluginHubDialog({ ...props, compatible: [current], plugins: [current], market: { plugins: [] } });
    assert.equal(elements(hub, element => element.props?.role === 'alert')[0].props.children, '保存模型失败');
});
