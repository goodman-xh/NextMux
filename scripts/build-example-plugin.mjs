#!/usr/bin/env node
// Builds the runnable skill plugin example (docs/examples/app-plugins/coin-catcher):
//  - plugin/: plugin.json, README.md, icon.png, templates/*.png, examples/*.png, tests/*.json
//  - coin-catcher.nmxplugin (the package NextMux installs)
//  - game/CoinCatcher.app (macOS only): the demo game with its own bundle id, for a conversation tab
// The images are drawn here with the same geometry as game/index.html, so the replay tests read what the game shows.
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const core = require(join(root, 'apps/desktop/app-plugin-core.cjs'));
const zipAdapter = require(join(root, 'apps/desktop/app-plugin-zip.cjs'));
const example = join(root, 'docs/examples/app-plugins/coin-catcher');
const plugin = join(example, 'plugin');

// ---- A small RGBA canvas and PNG writer ------------------------------------------------------------------------
function canvas(width, height, fill = [0, 0, 0, 0]) {
  const data = Buffer.alloc(width * height * 4);
  const set = (x, y, [r, g, b, a = 255]) => { if (x < 0 || y < 0 || x >= width || y >= height) return; const o = (y * width + x) * 4; data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a; };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) set(x, y, fill);
  return {
    width, height, data,
    rect(x, y, w, h, color) { for (let row = Math.round(y); row < Math.round(y + h); row++) for (let column = Math.round(x); column < Math.round(x + w); column++) set(column, row, color); return this; },
    disc(cx, cy, radius, color) { for (let row = Math.floor(cy - radius); row <= cy + radius; row++) for (let column = Math.floor(cx - radius); column <= cx + radius; column++) if ((column + 0.5 - cx) ** 2 + (row + 0.5 - cy) ** 2 <= radius * radius) set(column, row, color); return this; }
  };
}
function png(image) {
  const chunk = (type, body) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(body.length);
    const head = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head, body])) >>> 0);
    return Buffer.concat([length, head, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0); header.writeUInt32BE(image.height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((image.width * 4 + 1) * image.height);
  for (let y = 0; y < image.height; y++) image.data.copy(rows, y * (image.width * 4 + 1) + 1, y * image.width * 4, (y + 1) * image.width * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- The game's picture (see game/index.html) ------------------------------------------------------------------
const W = 640, H = 440;
const colors = { back: [20, 23, 31], barBack: [42, 47, 58], bar: [224, 50, 60], coin: [250, 200, 40], coinCore: [255, 240, 120], basket: [59, 130, 246], white: [255, 255, 255] };
function frame({ hp = 1, coins = [], basket = 280, paused = false }) {
  const image = canvas(W, H, colors.back);
  image.rect(200, 40, 240, 16, colors.barBack).rect(200, 40, Math.round(240 * hp), 16, colors.bar);
  if (paused) image.rect(600, 40, 16, 16, colors.white);
  for (const [x, y] of coins) image.disc(x, y, 12, colors.coin).rect(x - 3, y - 3, 6, 6, colors.coinCore);
  image.rect(basket, 404, 80, 16, colors.basket).rect(basket + 20, 408, 8, 8, colors.white).rect(basket + 52, 408, 8, 8, colors.white);
  return image;
}

// ---- The plugin ---------------------------------------------------------------------------------------------------
const f = (value, total) => Math.round(value / total * 10000) / 10000;
const manifest = {
  schema: 'nextmux.app-plugin/1',
  id: 'app.nextmux.example.coin-catcher',
  version: '1.0.0',
  name: { 'zh-CN': '接金币 · 示例', 'zh-TW': '接金幣 · 範例', en: 'Coin Catcher · Example' },
  description: {
    'zh-CN': '移动篮子接住下落的金币：快到底的金币由反射规则立刻去接，其余时间由决策模型判断往哪走。用来学习怎么写技能插件。',
    'zh-TW': '移動籃子接住落下的金幣：快到底的金幣由反射規則立刻去接，其餘時間由決策模型判斷往哪走。用來學習怎麼寫技能外掛。',
    en: 'Moves the basket under falling coins: a reflex catches a coin about to land, the decision model steers the rest of the time. A starting point for writing skill plugins.'
  },
  author: { name: 'NextMux', url: 'https://nextmux.app' },
  license: 'MIT',
  apps: [{ platform: 'macos', bundleId: 'app.nextmux.demo.coin-catcher' }, { platform: 'windows', program: 'CoinCatcher' }],
  display: { width: W, height: H, note: 'The game window is always 640 × 440.' },
  input: { modes: ['foreground'], keys: ['left', 'right', 'p'], pointer: [], maxActionsPerMinute: 240 },
  perception: {
    tickMs: 150,
    vision: 'optional',
    visionHints: 'Yellow coins fall from the top; the blue basket at the bottom must be under them. The red bar at the top is health.',
    examples: ['examples/coin-left.png'],
    signals: [
      { id: 'hp', type: 'bar', rect: [f(200, W), f(40, H), f(240, W), f(16, H)], color: '#e0323c', tolerance: 40 },
      { id: 'coin', type: 'template', image: 'templates/coin.png', rect: [0, f(64, H), 1, f(360, H)], threshold: 0.8, max: 2 },
      { id: 'basket', type: 'template', image: 'templates/basket.png', rect: [0, f(396, H), 1, f(32, H)], threshold: 0.85, max: 1 },
      { id: 'paused', type: 'pixel', points: [[f(608, W), f(48, H), '#ffffff']], tolerance: 30 },
      { id: 'moving', type: 'change', rect: [0, f(64, H), 1, f(376, H)] }
    ]
  },
  actions: {
    left: { label: { 'zh-CN': '向左', en: 'Left' }, describe: 'Move the basket left a little', steps: [{ key: 'left', holdMs: 150 }] },
    right: { label: { 'zh-CN': '向右', en: 'Right' }, describe: 'Move the basket right a little', steps: [{ key: 'right', holdMs: 150 }] },
    wait: { label: { 'zh-CN': '不动', en: 'Stay' }, describe: 'The basket is already under the coin', steps: [{ wait: 100 }] },
    unpause: { label: { 'zh-CN': '继续游戏', en: 'Resume the game' }, steps: [{ key: 'p' }], cooldownMs: 2000 }
  },
  reflexes: [
    { when: 'coin.found and basket.found and coin.y > 0.7 and coin.x < basket.x - 0.05', do: 'left', priority: 10 },
    { when: 'coin.found and basket.found and coin.y > 0.7 and coin.x > basket.x + 0.05', do: 'right', priority: 10 }
  ],
  decisions: [
    { id: 'next', type: 'choice', everyMs: 400, minConfidence: 0.34, fallback: 'wait', options: ['left', 'right', 'wait'],
      question: 'The basket must be under the falling coin to catch it. Positions are fractions of the width: 0 is the left edge, 1 the right edge. Which way should the basket move now?' }
  ],
  events: [
    { id: 'paused', when: 'held(paused, 1500)', message: { 'zh-CN': '游戏被暂停了', en: 'The game is paused' }, pause: true },
    { id: 'still', when: 'held(moving < 0.002, 5000)', message: { 'zh-CN': '画面 5 秒没有变化', en: 'Nothing has moved for 5 seconds' } }
  ],
  knowledge: { 'zh-CN': '篮子宽度约 0.12。金币竖直下落，越靠下越要赶紧对准。', en: 'The basket is about 0.12 wide. Coins fall straight down; the lower a coin, the sooner the basket must be under it.' },
  goals: { default: 'Catch as many coins as possible', examples: ['接住 20 个金币', 'Play until I say stop'] },
  limits: { maxRunMinutes: 60, stopWhen: 'hp < 0.02' }
};

// ---- Write the plugin folder --------------------------------------------------------------------------------------
rmSync(plugin, { recursive: true, force: true });
for (const folder of ['templates', 'examples', 'tests']) mkdirSync(join(plugin, folder), { recursive: true });
const files = new Map();
const put = (name, data) => { files.set(name, data); writeFileSync(join(plugin, name), data); };
// Templates, cut at display size: the coin with transparent corners, the striped basket.
put('templates/coin.png', png(canvas(26, 26).disc(13, 13, 12, colors.coin).rect(10, 10, 6, 6, colors.coinCore)));
put('templates/basket.png', png(canvas(80, 16, colors.basket).rect(20, 4, 8, 8, colors.white).rect(52, 4, 8, 8, colors.white)));
// Icon.
const icon = canvas(128, 128, [0, 0, 0, 0]).rect(8, 8, 112, 112, [30, 36, 50]).disc(64, 46, 22, colors.coin).rect(58, 40, 12, 12, colors.coinCore).rect(28, 84, 72, 18, colors.basket);
put('icon.png', png(icon));
// Replay frames and their expectations.
put('examples/coin-left.png', png(frame({ hp: 0.62, coins: [[150, 340]], basket: 280 })));
put('examples/coin-right.png', png(frame({ hp: 1, coins: [[520, 360]], basket: 180 })));
put('examples/paused.png', png(frame({ hp: 0.4, coins: [[320, 200]], basket: 280, paused: true })));
put('tests/coin-left.json', Buffer.from(JSON.stringify({ name: 'A low coin on the left: move left at once', frame: '../examples/coin-left.png',
  expect: { signals: { hp: [0.55, 0.7], 'coin.found': true, 'basket.found': true, paused: false }, reflex: 'left' } }, null, 2)));
put('tests/coin-right.json', Buffer.from(JSON.stringify({ name: 'A low coin on the right: move right at once', frame: '../examples/coin-right.png',
  expect: { signals: { hp: [0.95, 1], 'coin.found': true }, reflex: 'right' } }, null, 2)));
put('tests/paused.json', Buffer.from(JSON.stringify({ name: 'Paused, coin high up: nothing urgent', frame: '../examples/paused.png',
  expect: { signals: { paused: true, 'coin.found': true }, reflex: null } }, null, 2)));
put('README.md', Buffer.from(readFileSync(join(example, 'README.md'), 'utf8')));
put('plugin.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));

// The package must pass the same checks NextMux runs before installing it.
const checked = core.validateManifest(manifest, { files: new Set(files.keys()) });
if (!checked.ok) { console.error(checked.errors.join('\n')); process.exit(1); }
const pack = zipAdapter.writeZip([...files.entries()].sort(([a], [b]) => a.localeCompare(b)));
zipAdapter.readZip(pack);
writeFileSync(join(example, 'coin-catcher.nmxplugin'), pack);
console.log(`Wrote ${join(example, 'coin-catcher.nmxplugin')} (${files.size} files, ${pack.length} bytes).`);

// ---- The demo game app (macOS) ---------------------------------------------------------------------------------
if (process.platform === 'darwin' && !process.argv.includes('--no-app')) {
  const app = join(example, 'game', 'CoinCatcher.app');
  rmSync(app, { recursive: true, force: true });
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
  mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true });
  writeFileSync(join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>app.nextmux.demo.coin-catcher</string>
  <key>CFBundleName</key><string>Coin Catcher</string>
  <key>CFBundleDisplayName</key><string>Coin Catcher</string>
  <key>CFBundleExecutable</key><string>CoinCatcher</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
`);
  writeFileSync(join(app, 'Contents', 'Resources', 'index.html'), readFileSync(join(example, 'game', 'index.html')));
  const built = spawnSync('xcrun', ['swiftc', '-O', '-o', join(app, 'Contents', 'MacOS', 'CoinCatcher'), join(example, 'game', 'CoinCatcher.swift')], { stdio: 'inherit' });
  if (built.status !== 0) process.exit(built.status || 1);
  spawnSync('codesign', ['--force', '--sign', '-', app], { stdio: 'ignore' });
  console.log(`Built ${app}.`);
}
if (!existsSync(join(example, 'mock-decision-server.mjs'))) console.warn('mock-decision-server.mjs is missing.');
void readdirSync;
