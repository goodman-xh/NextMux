import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const core = require('../app-plugin-core.cjs');
const zipAdapter = require('../app-plugin-zip.cjs');

/** A BGRA frame filled with one colour, with helpers to paint rectangles and discs (as a game would draw them). */
function frame(width, height, [r, g, b] = [20, 24, 32]) {
  const data = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index++) { data[index * 4] = b; data[index * 4 + 1] = g; data[index * 4 + 2] = r; data[index * 4 + 3] = 255; }
  const value = { width, height, stride: width * 4, data };
  value.rect = (x, y, w, h, [cr, cg, cb]) => {
    for (let row = y; row < y + h; row++) for (let column = x; column < x + w; column++) {
      if (row < 0 || column < 0 || row >= height || column >= width) continue;
      const offset = row * value.stride + column * 4; data[offset] = cb; data[offset + 1] = cg; data[offset + 2] = cr;
    }
    return value;
  };
  value.disc = (cx, cy, radius, colour) => {
    for (let row = -radius; row <= radius; row++) for (let column = -radius; column <= radius; column++) if (row * row + column * column <= radius * radius) value.rect(cx + column, cy + row, 1, 1, colour);
    return value;
  };
  return value;
}

const coinImage = () => frame(24, 24, [20, 24, 32]).disc(12, 12, 10, [250, 200, 40]).rect(9, 9, 6, 6, [255, 240, 120]);

function manifest(overrides = {}) {
  return {
    schema: 'nextmux.app-plugin/1', id: 'com.example.coin-catcher', version: '1.0.0',
    name: { 'zh-CN': '接金币', en: 'Coin Catcher' }, description: { en: 'Moves the basket under falling coins.' }, author: { name: 'NextMux' },
    apps: [{ platform: 'macos', bundleId: 'com.apple.Safari', title: 'Coin Catcher' }, { platform: 'windows', program: 'chrome' }],
    display: { width: 400, height: 300 },
    input: { modes: ['foreground'], keys: ['left', 'right', 'space', 'ctrl'], pointer: [{ id: 'field', rect: [0, 0, 1, 1] }], maxActionsPerMinute: 300 },
    perception: { tickMs: 200, signals: [
      { id: 'hp', type: 'bar', rect: [0.1, 0.05, 0.5, 0.04], color: '#e0323c', tolerance: 40 },
      { id: 'coin', type: 'template', image: 'templates/coin.png', rect: [0, 0.1, 1, 0.8], threshold: 0.85, max: 3 },
      { id: 'paused', type: 'pixel', points: [[0.95, 0.05, '#ffffff']], tolerance: 10 },
      { id: 'moving', type: 'change', rect: [0, 0.1, 1, 0.8] }
    ] },
    actions: {
      left: { label: { 'zh-CN': '向左', en: 'Left' }, steps: [{ key: 'left', holdMs: 80 }] },
      right: { label: 'Right', steps: [{ key: 'right', holdMs: 80 }] },
      wait: { label: 'Wait', steps: [{ wait: 100 }] },
      grab: { label: 'Grab', steps: [{ click: 'signal:coin' }], cooldownMs: 500 }
    },
    reflexes: [{ when: 'hp < 0.3', do: 'wait', priority: 5 }],
    decisions: [
      { id: 'next', type: 'choice', question: 'Where should the basket go?', options: ['left', 'right', 'wait'], fallback: 'wait', minConfidence: 0.4 },
      { id: 'stuck', type: 'yesno', question: 'Is the game stuck?', everyMs: 3000, report: 0.8 },
      { id: 'danger', type: 'score', question: 'How risky is it?', levels: ['low', 'mid', 'high'], report: 'high' }
    ],
    events: [{ id: 'still', when: 'held(moving < 0.01, 5000)', message: { en: 'Nothing moves', 'zh-CN': '画面不动了' }, pause: true }],
    goals: { default: 'Catch coins', examples: ['Catch 50 coins'] },
    limits: { maxRunMinutes: 30, stopWhen: 'paused' },
    ...overrides
  };
}
const files = new Set(['plugin.json', 'templates/coin.png', 'tests/low.json']);

test('goal presets, literal app titles and the 50 ms loop survive validation and summaries', () => {
  const checked = core.validateManifest(manifest({ loop: { tickMs: 50 }, presets: ['Catch coins', { id: 'careful', label: 'Careful', goal: 'Stay alive', description: 'Avoid risk' }],
    apps: [{ platform: 'windows', program: 'Notepad.exe', titleIncludes: '记事本', name: 'Notepad' }] }), { files });
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.equal(checked.manifest.perception.tickMs, 50);
  assert.deepEqual(checked.manifest.loop, { tickMs: 50 });
  assert.deepEqual(checked.manifest.presets, [{ id: 'preset_1', label: 'Catch coins', goal: 'Catch coins', description: '' }, { id: 'careful', label: 'Careful', goal: 'Stay alive', description: 'Avoid risk' }]);
  assert.deepEqual(core.manifestSummary(checked.manifest).presets, checked.manifest.presets);
  assert.equal(checked.manifest.apps[0].titleIncludes, '记事本');
  assert.equal(checked.manifest.apps[0].name, 'Notepad');
  for (const [input, expected] of [[1, 50], [9000, 5000]]) assert.equal(core.validateManifest(manifest({ loop: { tickMs: input } }), { files }).manifest.perception.tickMs, expected);
  assert.equal(core.validateManifest(manifest({ goals: ['Catch 5'] }), { files }).manifest.presets[0].goal, 'Catch 5');
  for (const presets of [[{ label: '', goal: 'x' }], [{ label: 'a', goal: 'x', id: 'same' }, { label: 'b', goal: 'y', id: 'same' }], 'invalid']) {
    assert.equal(core.validateManifest(manifest({ presets }), { files }).ok, false);
  }
  for (const program of ['C:\\WeGameApps\\英雄联盟\\WeGameLauncher\\launcher.exe', 'C:/Games/League of Legends.exe', '/Applications/Example.app']) {
    assert.equal(core.validateManifest(manifest({ apps: [{ platform: 'windows', program }] }), { files }).ok, true, program);
  }
  for (const program of ['bad\nprogram', 'bad\u0000program', ' ', 'x'.repeat(261), 'bad*name', 42]) {
    assert.equal(core.validateManifest(manifest({ apps: [{ platform: 'windows', program }] }), { files }).ok, false, String(program));
  }
});

test('aim-and-cast validates bounded pointer areas and choice-to-point mappings', () => {
  const original = manifest();
  const options = { actions: { ...original.actions,
    aim: { steps: [{ type: 'aim_and_cast', key: 'space', fromDecision: 'next' }] },
    chord: { type: 'chord', chord: ['ctrl', 'space'], area: 'field' },
    hover: { steps: [{ move: 'signal:coin' }] },
    ping: { steps: [{ click: [0.5, 0.5], button: 'middle', count: 1 }] } },
    decisions: [{ ...original.decisions[0], targets: { left: [0.2, 0.5], right: 'signal:coin' } }] };
  const checked = core.validateManifest(manifest(options), { files });
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.deepEqual(checked.manifest.actions.chord.steps[0], { keys: ['ctrl', 'space'], area: 'field' });
  assert.deepEqual(checked.manifest.actions.ping.steps[0], { click: [0.5, 0.5], button: 'middle', count: 1 });
  assert.equal(checked.manifest.actions.aim.steps[0].fromDecision, 'next');
  for (const step of [{ type: 'aim_and_cast', key: 'space' }, { key: 'space', fromDecision: 'missing' }, { key: 'space', area: 'missing' }, { move: [1.1, 0.5] }, { click: [0.5, 0.5], button: 'back' }]) {
    assert.equal(core.validateManifest(manifest({ ...options, actions: { ...options.actions, bad: { steps: [step] } } }), { files }).ok, false, JSON.stringify(step));
  }
  assert.equal(core.validateManifest(manifest({ ...options, decisions: [{ ...options.decisions[0], targets: { left: [2, 0.5] } }] }), { files }).ok, false);
});

test('a well-formed plugin is accepted, normalized and summarized; broken ones list every problem', () => {
  const checked = core.validateManifest(manifest(), { files });
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  const value = checked.manifest;
  assert.equal(value.input.maxActionsPerMinute, 300);
  assert.equal(value.decisions[0].everyMs, 500, 'choices default to twice a second');
  assert.deepEqual(value.tests, ['tests/low.json']);
  const summary = core.manifestSummary(value, 'zh-CN');
  assert.equal(summary.name, '接金币');
  assert.equal(summary.actions.find(action => action.id === 'left').label, '向左');
  assert.equal(JSON.stringify(core.publicManifest(value)).includes('compiled'), false, 'no compiled trees over IPC');

  const broken = core.validateManifest(manifest({
    id: 'Not An Id', apps: [{ platform: 'linux' }],
    input: { keys: ['left', 'meta'], pointer: [] },
    actions: { left: { steps: [{ key: 'up' }] }, grab: { steps: [{ click: [0.5, 0.5] }] }, long: { steps: [{ wait: 2000 }, { wait: 2000 }, { wait: 2000 }] } },
    reflexes: [{ when: 'hp < ', do: 'left' }, { when: 'mana < 1', do: 'left' }],
    decisions: [{ id: 'next', type: 'choice', question: 'Go?', options: ['left'] }]
  }), { files });
  assert.equal(broken.ok, false);
  const text = broken.errors.join('\n');
  for (const expected of ['id:', 'apps[0].platform', 'input.keys', 'key "up" is not in input.keys', 'inside an input.pointer area', 'takes 6000 ms',
    'reflexes[0].when', '"mana" is not a signal', 'decisions[0].options']) assert.match(text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), expected);
  assert.equal(core.validateManifest(manifest(), { files: new Set(['plugin.json']) }).ok, false, 'a template image must be in the package');
  assert.equal(core.validateManifest({ ...manifest(), display: undefined }, { files }).ok, false, 'templates need the display size they were cut at');
});

test('expressions: comparisons, and/or/not, template fields, held(), since() and count(); nothing else parses', () => {
  const signals = new Map([['hp', 'bar'], ['coin', 'template'], ['moving', 'change']]);
  const actions = new Set(['left', 'right']);
  const compile = source => core.compileExpression(source, { signals, actions });
  const held = new Map();
  const context = (values, now = 0, history = []) => ({ signals: values, now, held,
    since: action => { const last = history.filter(item => item.action === action).at(-1); return last ? now - last.at : Infinity; },
    count: (action, ms) => history.filter(item => item.action === action && item.at >= now - ms).length });
  assert.equal(core.evaluate(compile('hp < 0.3 and not coin'), context({ hp: 0.2, coin: { found: false } })), true);
  assert.equal(core.evaluate(compile('coin.found and coin.x < 0.5 or hp >= 1'), context({ hp: 0.5, coin: { found: true, x: 0.3 } })), true);
  assert.equal(core.evaluate(compile('coin.x < 0.5'), context({ coin: { found: false, x: -1 } })), true, 'fields read as they are');
  assert.equal(core.evaluate(compile('hp < 0.3'), context({ hp: null })), false, 'an unknown reading never fires');
  const still = compile('held(moving < 0.01, 1000)');
  assert.equal(core.evaluate(still, context({ moving: 0 }, 0)), false);
  assert.equal(core.evaluate(still, context({ moving: 0 }, 999)), false);
  assert.equal(core.evaluate(still, context({ moving: 0 }, 1000)), true);
  assert.equal(core.evaluate(still, context({ moving: 0.5 }, 1100)), false, 'resets when the condition breaks');
  assert.equal(core.evaluate(still, context({ moving: 0 }, 1200)), false);
  const history = [{ action: 'left', at: 100 }, { action: 'left', at: 900 }];
  assert.equal(core.evaluate(compile('since("left") > 50'), context({}, 1000, history)), true);
  assert.equal(core.evaluate(compile('count("left", 500) >= 2'), context({}, 1000, history)), false);
  assert.equal(core.evaluate(compile('count("left", 1000) >= 2'), context({}, 1000, history)), true);
  assert.equal(core.evaluate(compile('coin.x < hp - 0.05'), context({ hp: 0.5, coin: { found: true, x: 0.44 } })), true, 'sums and differences');
  assert.equal(core.evaluate(compile('coin.x + 0.1 > hp'), context({ hp: 0.5, coin: { found: true, x: 0.3 } })), false);
  assert.equal(core.evaluate(compile('hp - 0.1 < 0.3'), context({ hp: null })), false, 'an unknown reading never fires in a sum');
  assert.equal(core.evaluate(compile('hp * 2 > 0.8'), context({ hp: 0.5 })), true, 'products and quotients');
  assert.equal(core.evaluate(compile('hp / 2 < 0.3'), context({ hp: 0.5 })), true);
  assert.equal(core.evaluate(compile('hp + 0.1 * 2 == 0.7'), context({ hp: 0.5 })), true, 'multiplication binds tighter than addition');
  assert.equal(core.evaluate(compile('hp / 0 > 0'), context({ hp: 0.5 })), false, 'division by zero evaluates to null');
  for (const bad of ['process.exit()', 'hp < 0.3; x', 'since(left) > 1', 'since("jump") > 1', 'hp.x < 1', '(hp < 1', 'hp * > 2', 'hp + < 1', 'a'.repeat(301)]) {
    assert.throws(() => compile(bad), undefined, bad);
  }
});

test('perception reads bars, pixels, templates (found where they are) and change', () => {
  const plugin = core.validateManifest(manifest(), { files }).manifest;
  const templates = new Map([['templates/coin.png', coinImage()]]);
  // The game at the size the template was cut at, with the health bar 60% full and a coin at (300, 150).
  const game = frame(400, 300).rect(40, 15, 120, 12, [224, 50, 60]).rect(160, 15, 80, 12, [60, 60, 60]).disc(300, 150, 10, [250, 200, 40]).rect(297, 147, 6, 6, [255, 240, 120]);
  const memory = {};
  const first = core.perceive(game, plugin, templates, memory);
  assert.ok(Math.abs(first.hp - 0.6) < 0.02, `hp ${first.hp}`);
  assert.equal(first.paused, false);
  assert.equal(first.coin.found, true);
  assert.ok(Math.abs(first.coin.x - 0.75) < 0.03 && Math.abs(first.coin.y - 0.5) < 0.03, JSON.stringify(first.coin));
  assert.equal(first.moving, 1, 'no previous frame: counts as moving');
  const second = core.perceive(game, plugin, templates, memory);
  assert.equal(second.moving, 0, 'same picture: nothing moved');

  // The same game shrunk to half size (the frame NextMux reads is smaller than the window): still found.
  const half = frame(200, 150).rect(20, 8, 60, 6, [224, 50, 60]).disc(60, 90, 5, [250, 200, 40]).rect(59, 89, 3, 3, [255, 240, 120]);
  const small = core.perceive(half, plugin, templates, {});
  assert.equal(small.coin.found, true, JSON.stringify(small.coin));
  assert.ok(Math.abs(small.coin.x - 0.3) < 0.04 && Math.abs(small.coin.y - 0.6) < 0.04, JSON.stringify(small.coin));
  // Two coins, the white pause marker on: count 2, paused true; no coin: not found.
  const two = frame(400, 300).disc(80, 100, 10, [250, 200, 40]).rect(77, 97, 6, 6, [255, 240, 120]).disc(320, 200, 10, [250, 200, 40]).rect(317, 197, 6, 6, [255, 240, 120]).rect(376, 10, 8, 8, [255, 255, 255]);
  const both = core.perceive(two, plugin, templates, {});
  assert.equal(both.coin.count, 2);
  assert.equal(both.paused, true);
  assert.equal(core.perceive(frame(400, 300), plugin, templates, {}).coin.found, false);
});

test('the decision model reads a short state and named questions; answers are read from any wrapping', () => {
  const plugin = core.validateManifest(manifest({ knowledge: { en: 'Coins fall straight down. '.repeat(40) }, state: { maxTokens: 120 } }), { files }).manifest;
  const state = core.renderState(plugin, { goal: 'Catch 50 coins', signals: { hp: 0.62, coin: { found: true, count: 1, x: 0.71, y: 0.5 }, paused: false, moving: 0.2 },
    history: [{ action: 'left', at: Date.now() - 400, by: 'decision' }] });
  assert.match(state, /^Goal \(from the user, via the assistant\): Catch 50 coins/);
  assert.match(state, /coin 1 found \(nearest at x 0\.71, y 0\.5\)/);
  assert.match(state, /hp 62%/);
  assert.ok(core.estimateTokens(state) <= 120, `${core.estimateTokens(state)} tokens`);
  const templated = core.validateManifest(manifest({ state: { template: 'Goal {{goal}} | HP {{hp%}} | coin at {{coin.x}} | {{history:2}}' } }), { files }).manifest;
  assert.match(core.renderState(templated, { goal: 'g', signals: { hp: 0.5, coin: { found: true, x: 0.25 } }, history: [] }), /^Goal g \| HP 50% \| coin at 0\.25 \| none yet$/);
  assert.equal(core.validateManifest(manifest({ state: { template: '{{mana}}' } }), { files }).ok, false);

  const questions = core.buildQuestions(plugin, plugin.decisions, 'zh-CN');
  assert.deepEqual(Object.keys(questions), ['next', 'stuck', 'danger']);
  assert.deepEqual(questions.next, { type: 'choice', instructions: 'Where should the basket go?', criteria: { left: 'Left', right: 'Right', wait: 'Wait' } });
  assert.deepEqual(questions.stuck, { type: 'noul', instructions: 'Is the game stuck?' });
  assert.equal(questions.danger.type, 'choice');
  assert.match(questions.danger.instructions, /low < mid < high/);

  const answers = core.readAnswers({ answers: { next: { choice: 'right', probabilities: { left: 0.1, right: 0.8, wait: 0.1 }, confidence: 0.8 }, stuck: { noul: 0.9 }, danger: { probabilities: { low: 0.2, high: 0.7 } } } }, plugin.decisions);
  assert.equal(answers.next.choice, 'right');
  assert.equal(answers.stuck.yes, 0.9);
  assert.equal(answers.danger.choice, 'high');
  assert.equal(answers.danger.confidence, 0.7);
  assert.equal(core.readAnswers({ next: { choice: 'jump' } }, plugin.decisions).next, undefined, 'an action the question did not offer is ignored');
});

test('replay tests compare readings and the reflex; a package is a strict zip', () => {
  const plugin = core.validateManifest(manifest(), { files }).manifest;
  const passed = core.checkReplay(plugin, { name: 'low', expect: { signals: { hp: [0.1, 0.25], 'coin.found': true }, reflex: 'wait' } }, { hp: 0.2, coin: { found: true, count: 1, x: 0.5, y: 0.5 } });
  assert.deepEqual(passed, { name: 'low', ok: true, failures: [], diagnostics: [], defaultName: false });
  const failed = core.checkReplay(plugin, { expect: { signals: { hp: [0.5, 1] }, reflex: null } }, { hp: 0.2 });
  assert.equal(failed.ok, false);
  assert.equal(failed.failures.length, 2);

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const zip = zipAdapter.writeZip([['coin-catcher/plugin.json', Buffer.from('{}')], ['coin-catcher/templates/coin.png', png]]);
  const read = zipAdapter.readZip(zip);
  assert.deepEqual([...read.keys()].sort(), ['plugin.json', 'templates/coin.png'], 'one wrapping folder is removed');
  const reject = (entries, code) => assert.throws(() => zipAdapter.readZip(zipAdapter.writeZip(entries)), error => error.code === code, code);
  reject([['plugin.json', Buffer.from('{}')], ['../evil.json', Buffer.from('x')]], 'package_path');
  reject([['plugin.json', Buffer.from('{}')], ['run.sh', Buffer.from('x')]], 'package_unexpected_file');
  reject([['plugin.json', Buffer.from('{}')], ['templates/fake.png', Buffer.from('not a png')]], 'package_not_png');
  reject([['README.md', Buffer.from('x')]], 'package_manifest_missing');
  reject([['plugin.json', Buffer.alloc(600 * 1024)]], 'package_file_size');
  assert.throws(() => zipAdapter.readZip(Buffer.from('not a zip at all, definitely not')), error => error.code === 'package_not_zip');
});

test('A-003 RE2 accepts nested quantifiers in linear time, preserves OCR captures and rejects unsupported syntax on install', async () => {
  const { execFileSync } = await import('node:child_process');
  const result = execFileSync(process.execPath, ['-e', `
    const core = require('./app-plugin-core.cjs');
    const { appMatches } = require('./app-plugins.cjs');
    const input = 'a'.repeat(34) + '!';
    const start = Date.now();
    if (core.readText({pattern:'(a+)+$'}, input) !== '') throw Error('unexpected match');
    if (appMatches({apps:[{platform:'macos',bundleId:'com.test',title:'(a+)+$'}]}, {bundleId:'com.test'}, input, 'darwin')) throw Error('unexpected title');
    setImmediate(() => process.stdout.write('stop-responsive:' + (Date.now() - start)));
  `], { cwd: new URL('..', import.meta.url), timeout: 2000, encoding: 'utf8' });
  assert.match(result, /^stop-responsive:/);
  assert.ok(Number(result.split(':')[1]) < 500);
  assert.equal(core.readText({ pattern: 'Score: ([0-9]+)', number: true }, 'Score: 42'), 42);
  for (const pattern of ['(?=a)', '(a)\\1']) {
    const raw = manifest({ apps: [{ platform: 'macos', bundleId: 'com.example.game', title: pattern }] });
    assert.ok(core.validateManifest(raw, { files }).errors.some(error => error.startsWith('apps[0].title:')));
    const textRaw = manifest({ perception: { signals: [{ id: 'score', type: 'text', rect: [0, 0, 1, 1], pattern }] } });
    assert.ok(core.validateManifest(textRaw).errors.some(error => error.includes('pattern')));
  }
});

test('A-010 normalization preserves omitted tap and explicit hold without changing semantics', () => {
  for (const holdMs of [undefined, 0, 50]) {
    const checked = core.validateManifest(manifest({ actions: { left: { steps: [{ key: 'left', ...(holdMs !== undefined ? { holdMs } : {}) }] } }, decisions: [], reflexes: [{ when: 'hp < 0.3', do: 'left' }] }), { files });
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    assert.equal(checked.manifest.actions.left.steps[0].holdMs, holdMs);
    assert.equal(Object.hasOwn(checked.manifest.actions.left.steps[0], 'holdMs'), holdMs !== undefined);
  }
});

test('path and directory parameters validate and project into manifestSummary', () => {
  const checked = core.validateManifest(manifest({
    params: [
      { id: 'save_dir', type: 'path', label: { en: 'Save folder', 'zh-CN': '保存目录' }, default: '/tmp/default', accept: ['.txt', '.json'] },
      { id: 'output_dir', type: 'directory', label: 'Output folder', accept: ['.md'] }
    ]
  }), { files });
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.equal('accept' in checked.manifest.params[0], false, 'accept is ignored on path parameters');
  assert.equal('accept' in checked.manifest.params[1], false, 'accept is ignored on directory parameters');
  const summary = core.manifestSummary(checked.manifest, 'zh-CN');
  assert.deepEqual(summary.params, [
    { id: 'save_dir', type: 'path', label: '保存目录', default: '/tmp/default' },
    { id: 'output_dir', type: 'directory', label: 'Output folder', default: '' }
  ]);
  const normalized = core.validateManifest(manifest({
    params: [
      { id: 'posix_dir', type: 'path', label: 'POSIX', default: '/tmp/sub/../exports/' },
      { id: 'win_dir', type: 'directory', label: 'Windows', default: 'C:\\Users\\demo\\..\\Exports\\' },
      { id: 'cleared_dir', type: 'path', label: 'Cleared', default: null }
    ],
    state: { template: 'Folder={{param.posix_dir}} Colon={{param:win_dir}} Direct={{posix_dir}}' }
  }), { files });
  assert.equal(normalized.ok, true, JSON.stringify(normalized.errors));
  assert.deepEqual(normalized.manifest.params.map(item => item.default), ['/tmp/exports', 'C:\\Users\\Exports', '']);
  const defaultState = core.validateManifest(manifest({
    params: [
      { id: 'save_dir', type: 'path', label: { en: 'Save folder', 'zh-CN': '保存目录' }, default: '/tmp/default' },
      { id: 'output_dir', type: 'directory', label: 'Output folder' }
    ]
  }), { files });
  assert.match(core.renderState(defaultState.manifest, { params: { save_dir: '/var/data/out', output_dir: '/var/data/dir' } }), /Parameters: save_dir=\/var\/data\/out, output_dir=\/var\/data\/dir/);
  assert.equal(core.renderState(normalized.manifest, { params: { posix_dir: '/var/exports', win_dir: 'C:\\Out' } }), 'Folder=/var/exports Colon=C:\\Out Direct=/var/exports');
  for (const badDefault of ['relative/folder', './folder', '../folder', '/tmp/bad\u0000folder', '/' + 'a'.repeat(4096), 42, true, {}]) {
    const invalid = core.validateManifest(manifest({ params: [{ id: 'save_dir', type: 'path', label: 'Save folder', default: badDefault }] }), { files });
    assert.equal(invalid.ok, false, JSON.stringify(badDefault));
    assert.ok(invalid.diagnostics.some(item => item.path === 'params[0].default' && (item.code === 'plugin.expected' || item.code === 'plugin.length')));
  }

  // Embedded {{param:<id>}} placeholders and {{line:<id>}} parameter type checks in step.text
  const embeddedValid = core.validateManifest(manifest({
    params: [
      { id: 'save_dir', type: 'path', label: 'Save folder', default: '/tmp/out' },
      { id: 'prefix', type: 'string', label: 'Prefix', default: 'run' },
      { id: 'comments', type: 'file', label: 'Comments' }
    ],
    actions: {
      left: { steps: [{ text: 'dir={{param:save_dir}}/{{param:prefix}}' }] },
      right: { steps: [{ text: '{{line:comments}}' }] },
      wait: { steps: [{ wait: 10 }] }
    }
  }), { files });
  assert.equal(embeddedValid.ok, true, JSON.stringify(embeddedValid.errors));

  const embeddedUnknown = core.validateManifest(manifest({
    params: [{ id: 'save_dir', type: 'path', label: 'Save folder' }],
    actions: {
      left: { steps: [{ text: 'Export to {{param:save_dir}} and {{param:missing_one}} / {{param:missing_two}}' }] },
      right: { steps: [{ wait: 10 }] },
      wait: { steps: [{ wait: 10 }] }
    }
  }), { files });
  assert.equal(embeddedUnknown.ok, false);
  assert.ok(embeddedUnknown.diagnostics.some(d => d.path === 'actions.left.steps[0].text' && d.code === 'plugin.placeholder' && d.params?.value === 'missing_one'));
  assert.ok(embeddedUnknown.diagnostics.some(d => d.path === 'actions.left.steps[0].text' && d.code === 'plugin.placeholder' && d.params?.value === 'missing_two'));

  for (const nonFileType of ['path', 'directory', 'string', 'number', 'boolean', 'select']) {
    const lineNonFile = core.validateManifest(manifest({
      params: [{
        id: 'not_a_file',
        type: nonFileType,
        label: 'Param',
        ...(nonFileType === 'select' ? { options: ['a', 'b'] } : {})
      }],
      actions: {
        left: { steps: [{ text: '{{line:not_a_file}}' }] },
        right: { steps: [{ wait: 10 }] },
        wait: { steps: [{ wait: 10 }] }
      }
    }), { files });
    assert.equal(lineNonFile.ok, false, `expected {{line:...}} on ${nonFileType} param to fail`);
    assert.ok(lineNonFile.diagnostics.some(d => d.path === 'actions.left.steps[0].text' && d.code === 'plugin.expected' && d.params?.expected === 'file'));
  }
});
