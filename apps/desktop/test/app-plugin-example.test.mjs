import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const core = require('../app-plugin-core.cjs');
const zipAdapter = require('../app-plugin-zip.cjs');
const example = new URL('../../../docs/examples/app-plugins/coin-catcher/', import.meta.url);

test('the Notepad goal-button example validates for both desktop platforms', () => {
  const raw = JSON.parse(readFileSync(new URL('../app-plugin-example/plugin.json', import.meta.url), 'utf8'));
  const checked = core.validateManifest(raw);
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.equal(checked.manifest.presets.length, 3);
  assert.equal(checked.manifest.apps.find(app => app.platform === 'windows').titleIncludes, '记事本');
  assert.equal(checked.manifest.input.modes.includes('foreground'), true);
});

/** Reads the example's PNGs (8-bit RGBA, no filters beyond "none", as the build script writes them) as BGRA. */
function decode(buffer) {
  let offset = 8, width = 0, height = 0;
  const data = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); }
    if (type === 'IDAT') data.push(body);
    offset += 12 + length;
  }
  const rows = inflateSync(Buffer.concat(data));
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = y * (width * 4 + 1) + 1 + x * 4, to = (y * width + x) * 4;
    pixels[to] = rows[from + 2]; pixels[to + 1] = rows[from + 1]; pixels[to + 2] = rows[from]; pixels[to + 3] = rows[from + 3];
  }
  return { width, height, stride: width * 4, data: pixels };
}

test('the Coin Catcher example package installs cleanly and passes its own replay tests', { skip: !existsSync(new URL('coin-catcher.nmxplugin', example)) }, () => {
  const files = zipAdapter.readZip(readFileSync(new URL('coin-catcher.nmxplugin', example)));
  const checked = core.validateManifest(JSON.parse(files.get('plugin.json').toString('utf8')), { files: new Set(files.keys()) });
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  const manifest = checked.manifest;
  const templates = new Map(['templates/coin.png', 'templates/basket.png'].map(name => [name, decode(files.get(name))]));
  assert.equal(manifest.tests.length, 3);
  for (const file of manifest.tests) {
    const replay = JSON.parse(files.get(file).toString('utf8'));
    const frame = decode(files.get(join('tests', replay.frame).replace(/\\/g, '/')));
    const signals = core.perceive(frame, manifest, templates, {});
    const result = core.checkReplay(manifest, replay, signals);
    assert.equal(result.ok, true, `${replay.name}: ${result.failures.join('; ')} ${JSON.stringify(signals)}`);
  }
  // Read at the size NextMux captures a Retina window (1024 wide), the same frame still finds coin and basket.
  const big = decode(files.get('examples/coin-left.png'));
  const scaled = { width: 1024, height: 704, stride: 1024 * 4, data: Buffer.alloc(1024 * 704 * 4) };
  for (let y = 0; y < 704; y++) for (let x = 0; x < 1024; x++) big.data.copy(scaled.data, (y * 1024 + x) * 4, (Math.floor(y * 440 / 704) * 640 + Math.floor(x * 640 / 1024)) * 4, (Math.floor(y * 440 / 704) * 640 + Math.floor(x * 640 / 1024)) * 4 + 4);
  const signals = core.perceive(scaled, manifest, templates, {});
  assert.equal(signals.coin.found && signals.basket.found, true, JSON.stringify(signals));
  assert.ok(Math.abs(signals.coin.x - 150 / 640) < 0.02 && Math.abs(signals.basket.x - 320 / 640) < 0.02, JSON.stringify(signals));
});

test('the Douyin Assistant skill plugin validates, parses media timestamps and OCR boxes across window sizes, and triggers reflexes from params', () => {
  const douyinDir = new URL('../../../docs/examples/app-plugins/douyin-assistant/', import.meta.url);
  const files = zipAdapter.readZip(readFileSync(new URL('douyin-assistant.nmxplugin', douyinDir)));
  const checked = core.validateManifest(JSON.parse(files.get('plugin.json').toString('utf8')), { files: new Set(files.keys()) });
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  const manifest = checked.manifest;
  assert.equal(manifest.params.length, 5);
  assert.deepEqual(manifest.params.map(p => p.id), ['auto_next_on_finish', 'auto_next_seconds', 'auto_like', 'auto_comment', 'comment_file']);

  const byId = Object.fromEntries(manifest.perception.signals.map(s => [s.id, s]));
  // 1. Featured grid page -> enter_recommend reflex fires using OCR box coordinates (both macOS Vision and Windows word-level OCR)
  const navRecommendMac = core.readText(byId.nav_recommend, '精选\n推荐\n关注', [{ text: '推荐', x: 0.033, y: 0.207 }]);
  const navRecommendWin = core.readText(byId.nav_recommend, '精 选\n推 荐', [
    { text: '推', x: 0.035, y: 0.11 },
    { text: '荐', x: 0.045, y: 0.11 }
  ]);
  assert.equal(navRecommendMac.found, true);
  assert.equal(navRecommendMac.x, 0.033);
  assert.equal(navRecommendWin.found, true);
  assert.equal(navRecommendWin.x, 0.04);
  const featuredTabs = core.readText(byId.featured_tabs, '全部 公开课 游戏 二次元', [{ text: '公开课', x: 0.18, y: 0.08 }]);
  assert.equal(featuredTabs.found, true);

  // 2. Media timestamp parsing (remaining, duration, elapsed) including Windows spaced colons
  assert.equal(core.readText(byId.video_remaining, '00:14 / 00:15'), 1);
  assert.equal(core.readText(byId.video_duration, '00:14 / 00:15'), 15);
  assert.equal(core.readText(byId.video_elapsed, '00 : 14 / 00 : 15'), 14);

  // 3. Comment box matching and reflex priority evaluation
  const commentBox = core.readText(byId.comment_box, '留下你的精彩评论吧', [{ text: '留下你的精彩评论吧', x: 0.78, y: 0.94 }]);
  assert.equal(commentBox.found, true);
  assert.equal(commentBox.x, 0.78);

  const baseSignals = {
    nav_recommend: navRecommendMac,
    featured_tabs: { found: false, count: 0, x: -1, y: -1, text: '', items: [] },
    video_remaining: 8,
    video_duration: 15,
    video_elapsed: 7,
    comment_box: commentBox,
    motion: 0.12
  };
  const params = {
    auto_next_on_finish: true,
    auto_next_seconds: 15,
    auto_like: true,
    auto_comment: true,
    comment_file: { count: 3, lines: ['太赞了！', '干货满满', '666支持一下'] }
  };
  const pickReflex = (signals, overrides = {}) => {
    const ctx = {
      signals,
      params,
      now: 10_000,
      held: new Map(),
      since: () => Infinity,
      count: () => 0,
      ...overrides
    };
    return manifest.reflexes.find(item => core.truthy(core.evaluate(item.compiled, ctx)))?.do || null;
  };
  // On Featured page or initial startup before entering Recommend -> enter_recommend
  assert.equal(pickReflex({ ...baseSignals, featured_tabs: featuredTabs }), 'enter_recommend');
  assert.equal(pickReflex(baseSignals), 'enter_recommend');
  // In Recommend feed after initial enter_recommend, before liking -> like_video
  assert.equal(pickReflex(baseSignals, {
    count: action => action === 'enter_recommend' ? 1 : 0,
    since: action => action === 'enter_recommend' ? 3000 : Infinity
  }), 'like_video');
  // After liking on current video, with comment_box visible -> post_comment
  assert.equal(pickReflex(baseSignals, {
    count: action => (action === 'enter_recommend' || action === 'like_video') ? 1 : 0,
    since: action => action === 'enter_recommend' ? 3000 : action === 'like_video' ? 500 : Infinity
  }), 'post_comment');
  // After liking and commenting on current video, when video finishes (remaining <= 1.5s) -> next_video
  assert.equal(pickReflex({ ...baseSignals, video_remaining: 1, video_elapsed: 14 }, {
    count: action => (action === 'enter_recommend' || action === 'like_video' || action === 'post_comment') ? 1 : 0,
    since: action => action === 'enter_recommend' ? 3000 : (action === 'like_video' || action === 'post_comment') ? 500 : Infinity
  }), 'next_video');
});



test('Douyin scales OCR and action targets, uses idempotent mouse likes, and waits the configured seconds', () => {
  const folder = new URL('../../../docs/examples/app-plugins/douyin-assistant/', import.meta.url);
  const files = zipAdapter.readZip(readFileSync(new URL('douyin-assistant.nmxplugin', folder)));
  assert.deepEqual(files.get('plugin.json'), readFileSync(new URL('plugin/plugin.json', folder)));
  const manifest = core.validateManifest(JSON.parse(files.get('plugin.json'))).manifest;
  const byId = Object.fromEntries(manifest.perception.signals.map(signal => [signal.id, signal]));
  for (const [width, height] of [[1080, 720], [2192, 1252]]) {
    const frame = { width, height, stride: width * 4, data: Buffer.alloc(width * height * 4) };
    const texts = new Map([
      ['nav_recommend', core.readText(byId.nav_recommend, '推荐', [{ text: '推', x: 40 / 1080, y: 150 / 720 }, { text: '荐', x: 60 / 1080, y: 150 / 720 }])],
      ['comment_box', core.readText(byId.comment_box, '留下你的精彩评论吧', [{ text: '留下你的精彩评论吧', x: (width * 0.78) / width, y: (height * 0.94) / height }])],
      ['video_duration', core.readText(byId.video_duration, '00:14 / 00:15')],
      ['video_elapsed', core.readText(byId.video_elapsed, '00:14 / 00:15')],
      ['video_remaining', core.readText(byId.video_remaining, '00:14 / 00:15')]
    ]);
    const signals = { ...core.perceive(frame, manifest, new Map(), {}), ...Object.fromEntries(texts) };
    assert.equal(signals.nav_recommend.found, true); assert.equal(signals.comment_box.x, 0.78);
    assert.equal(signals.video_remaining, 1);
    const click = manifest.actions.like_video.steps[0];
    assert.equal(click.count, 2); assert.deepEqual(click.click, [0.45, 0.45]);
    assert.equal(click.click[0] * width, width * 0.45); assert.equal(click.click[1] * height, height * 0.45);
    assert.equal(manifest.input.keys.includes('z'), false);
    // Keyboard reaches background windows on macOS and Windows; background scroll is refused on macOS.
    assert.equal(manifest.actions.next_video.steps[0].key, 'down'); assert.equal(manifest.actions.next_video.steps[0].scroll, undefined);
    assert.equal(manifest.actions.prev_video.steps[0].key, 'up');
    assert.equal(manifest.actions.post_comment.steps[0].at, 'signal:comment_box');
    assert.equal(manifest.actions.post_comment.steps[0].text, '{{line:comment_file}}');
  }
  for (const id of ['nav_recommend', 'comment_box']) {
    const label = id === 'nav_recommend' ? '推荐' : '留下你的精彩评论吧';
    assert.equal(core.readText(byId[id], label).found, false, 'text alone must not click an assumed centre');
    assert.equal(core.readText(byId[id], label, [{ text: label, x: NaN, y: 0.9 }]).found, false);
    assert.equal(core.readText(byId[id], label, [{ text: label, x: 0.99, y: 0.01 }]).found, false);
  }
  const like = manifest.reflexes.find(reflex => reflex.do === 'like_video');
  const signals = { featured_tabs: { found: false }, comment_box: { found: false } };
  const context = { signals, params: { auto_like: true }, now: 4000000, held: new Map(), count: () => 0,
    since: action => action === 'like_video' ? 3900000 : action === 'enter_recommend' ? 3990000 : Infinity };
  assert.equal(core.evaluate(like.compiled, context), false, 'evicted history and an hour on one video cannot repeat a like');
  assert.equal(core.evaluate(like.compiled, { ...context, since: action => action === 'next_video' ? 2000 : context.since(action) }), true);
  const timer = manifest.reflexes.find(reflex => reflex.when.includes('held('));
  for (const seconds of [1, 15, 600]) {
    const held = new Map(), params = { auto_next_seconds: seconds };
    const evaluateAt = now => core.evaluate(timer.compiled, { signals, params, now, held, since: () => 10000, count: () => 0 });
    assert.equal(evaluateAt(0), false); assert.equal(evaluateAt(seconds * 1000 - 1), false); assert.equal(evaluateAt(seconds * 1000), true);
  }
  assert.equal(core.evaluate(timer.compiled, { ...context, params: { auto_next_seconds: 0 } }), false);
});
