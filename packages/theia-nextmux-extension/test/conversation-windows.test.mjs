import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseDetachedConversationLocation,
  buildDetachedConversationSearch,
  conversationTileCapacity,
  conversationTileGridSpec,
  conversationTileSlotBounds,
  tileConversationBounds,
  conversationTileBounds,
  assignNonDestructiveTileSlots,
  DEFAULT_CONVERSATION_TILE_WIDTH,
  DEFAULT_CONVERSATION_TILE_HEIGHT,
  MIN_CONVERSATION_TILE_WIDTH,
  MIN_CONVERSATION_TILE_HEIGHT,
  MAX_CONVERSATION_TILE_WIDTH,
  WARM_DETACHED_SESSION_ID
} = require('../lib/common/nextmux-conversation-window.js');

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
function assertPackedWithoutOverlap(tiles, area, label) {
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    assert.ok(tile.x >= area.x && tile.y >= area.y, `${label}: tile ${i} starts inside the work area`);
    assert.ok(tile.x + tile.width <= area.x + area.width && tile.y + tile.height <= area.y + area.height, `${label}: tile ${i} ends inside the work area`);
    for (let j = i + 1; j < tiles.length; j++) assert.equal(overlaps(tile, tiles[j]), false, `${label}: tiles ${i} and ${j} overlap`);
  }
}

test('parseDetachedConversationLocation and buildDetachedConversationSearch round-trip detached window params', () => {
  const search = buildDetachedConversationSearch('?locale=zh-CN', 'session-42');
  assert.equal(search, '?locale=zh-CN&nextmuxConversation=session-42');
  assert.equal(parseDetachedConversationLocation(search), 'session-42');
  assert.equal(parseDetachedConversationLocation('http://127.0.0.1:3000/?nextmuxConversation=hash-session'), 'hash-session');
  assert.equal(parseDetachedConversationLocation('?locale=zh-CN'), undefined);
  assert.equal(parseDetachedConversationLocation('?nextmuxConversation='), undefined);
});

test('conversationTileCapacity computes adaptive screen capacity for standard resolutions', () => {
  assert.equal(conversationTileCapacity({ x: 0, y: 25, width: 1440, height: 875 }), 6);
  assert.equal(conversationTileCapacity({ x: 0, y: 0, width: 2560, height: 1440 }), 9);
  assert.equal(conversationTileCapacity({ x: 0, y: 0, width: 3840, height: 2160 }), 12);
  assert.equal(conversationTileCapacity({ x: 0, y: 0, width: 1280, height: 720 }), 4);
  assert.equal(conversationTileCapacity({ x: 0, y: 0, width: 800, height: 600 }), 2);

  const spec1440 = conversationTileGridSpec({ x: 0, y: 25, width: 1440, height: 875 });
  assert.equal(spec1440.cols, 3);
  assert.equal(spec1440.rows, 2);
  assert.equal(spec1440.capacity, 6);
});

test('tileConversationBounds places tiles row-by-row left-to-right within workArea', () => {
  const area = { x: 0, y: 25, width: 1440, height: 875 };
  const tiles = tileConversationBounds(area, 6);
  assert.equal(tiles.length, 6);

  // Row 0: indices 0, 1, 2 left-to-right at the same top y
  assert.equal(tiles[0].y, tiles[1].y);
  assert.equal(tiles[1].y, tiles[2].y);
  assert.ok(tiles[0].x < tiles[1].x && tiles[1].x < tiles[2].x);

  // Row 1: indices 3, 4, 5 left-to-right below Row 0
  assert.ok(tiles[3].y > tiles[0].y);
  assert.equal(tiles[3].y, tiles[4].y);
  assert.equal(tiles[4].y, tiles[5].y);
  assert.ok(tiles[3].x < tiles[4].x && tiles[4].x < tiles[5].x);
  assert.equal(tiles[0].x, tiles[3].x);
  assert.equal(tiles[1].x, tiles[4].x);
  assert.equal(tiles[2].x, tiles[5].x);

  // Every tile stays strictly within workArea
  for (const b of tiles) {
    assert.ok(b.x >= area.x);
    assert.ok(b.y >= area.y);
    assert.ok(b.x + b.width <= area.x + area.width);
    assert.ok(b.y + b.height <= area.y + area.height);
  }
});

test('assignNonDestructiveTileSlots assigns new windows to unoccupied slots without moving existing windows', () => {
  const area1 = { x: 0, y: 25, width: 1440, height: 875 };
  const display1 = { id: 1, workArea: area1 };
  const slot0 = conversationTileSlotBounds(area1, 0, 3, 2);
  const slot1 = conversationTileSlotBounds(area1, 1, 3, 2);
  const slot2 = conversationTileSlotBounds(area1, 2, 3, 2);
  const slot3 = conversationTileSlotBounds(area1, 3, 3, 2);

  // Case 1: Slots 0 and 1 are occupied; opening 2 new windows should get slots 2 and 3
  const addedAfterTwo = assignNonDestructiveTileSlots([display1], [slot0, slot1], 2);
  assert.equal(addedAfterTwo.length, 2);
  assert.deepEqual(addedAfterTwo[0].bounds, slot2);
  assert.deepEqual(addedAfterTwo[1].bounds, slot3);

  // Case 2: Slot 1 was closed (leaving slots 0 and 2 occupied); opening 1 new window fills gap at slot 1
  const fillGap = assignNonDestructiveTileSlots([display1], [slot0, slot2], 1);
  assert.equal(fillGap.length, 1);
  assert.deepEqual(fillGap[0].bounds, slot1);
});

test('assignNonDestructiveTileSlots spills over to secondary display when primary display is full', () => {
  const primaryArea = { x: 0, y: 25, width: 1440, height: 875 };
  const secondaryArea = { x: 1440, y: 0, width: 1440, height: 900 };
  const primary = { id: 1, workArea: primaryArea };
  const secondary = { id: 2, workArea: secondaryArea };

  // Occupy first 5 of 6 slots on primary display
  const existing = [0, 1, 2, 3, 4].map(i => conversationTileSlotBounds(primaryArea, i, 3, 2));

  // Open 3 new windows: 1st should take slot 5 on primary, 2nd & 3rd should take slots 0 & 1 on secondary
  const assigned = assignNonDestructiveTileSlots([primary, secondary], existing, 3);
  assert.equal(assigned.length, 3);
  assert.equal(assigned[0].displayIndex, 0);
  assert.equal(assigned[0].slotIndex, 5);
  assert.deepEqual(assigned[0].bounds, conversationTileSlotBounds(primaryArea, 5, 3, 2));

  assert.equal(assigned[1].displayIndex, 1);
  assert.equal(assigned[1].slotIndex, 0);
  assert.deepEqual(assigned[1].bounds, conversationTileSlotBounds(secondaryArea, 0, 3, 2));

  assert.equal(assigned[2].displayIndex, 1);
  assert.equal(assigned[2].slotIndex, 1);
  assert.deepEqual(assigned[2].bounds, conversationTileSlotBounds(secondaryArea, 1, 3, 2));
});

test('conversationTileBounds handles overflow beyond single-display capacity with bounded cascade', () => {
  const area = { x: -1920, y: 0, width: 1920, height: 1080 };
  for (let i = 0; i < 16; i++) {
    const b = conversationTileBounds(area, i, 16);
    assert.ok(b.x >= area.x);
    assert.ok(b.y >= area.y);
    assert.ok(b.x + b.width <= area.x + area.width);
    assert.ok(b.y + b.height <= area.y + area.height);
  }
});

test('detached tile constants: compact 380×540 default, 280×320 minimum, 1600 widest remembered width, standby id', () => {
  assert.equal(DEFAULT_CONVERSATION_TILE_WIDTH, 380);
  assert.equal(DEFAULT_CONVERSATION_TILE_HEIGHT, 540);
  assert.equal(MIN_CONVERSATION_TILE_WIDTH, 280);
  assert.equal(MIN_CONVERSATION_TILE_HEIGHT, 320);
  assert.equal(MAX_CONVERSATION_TILE_WIDTH, 1600);
  assert.equal(WARM_DETACHED_SESSION_ID, '__warm__');
});

test('tiles default to the compact 380px width, at most 540px tall, side by side from the top left 10px apart', () => {
  for (const area of [
    { x: 0, y: 25, width: 1440, height: 875 },
    { x: 0, y: 25, width: 1920, height: 1055 },
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: 0, y: 0, width: 2560, height: 1440 },
    { x: 0, y: 0, width: 3840, height: 2160 }
  ]) {
    const spec = conversationTileGridSpec(area);
    const label = `${area.width}x${area.height}`;
    assert.equal(spec.cellWidth, 380, `${label}: grid cell width`);
    assert.ok(spec.cellHeight <= 540, `${label}: grid cell height`);
    const tiles = tileConversationBounds(area, spec.capacity);
    assert.equal(tiles.length, spec.capacity);
    for (const tile of tiles) {
      assert.equal(tile.width, 380, `${label}: tile width`);
      assert.ok(tile.height <= 540 && tile.height >= 300, `${label}: tile height ${tile.height}`);
    }
    assert.equal(tiles[0].x, area.x + 10);
    assert.equal(tiles[0].y, area.y + 10);
    // Neighbours sit exactly one 10px gap apart instead of spreading across the screen.
    assert.equal(tiles[1].x - (tiles[0].x + tiles[0].width), 10, `${label}: column gap`);
    assert.equal(tiles[spec.cols].y - (tiles[0].y + tiles[0].height), 10, `${label}: row gap`);
    assertPackedWithoutOverlap(tiles, area, label);
  }
  // Tall screens cap the height at 540px.
  assert.equal(conversationTileSlotBounds({ x: 0, y: 0, width: 3840, height: 2160 }, 0).height, 540);
  assert.equal(conversationTileSlotBounds({ x: 0, y: 25, width: 1440, height: 875 }, 0).height, 422);
  // A narrow screen still fits its tiles inside the work area.
  assertPackedWithoutOverlap(tileConversationBounds({ x: 0, y: 0, width: 800, height: 600 }, 2), { x: 0, y: 0, width: 800, height: 600 }, '800x600');
});

test('a remembered 460px width sizes every new tile and packs them without overlap', () => {
  const area = { x: 0, y: 25, width: 1440, height: 875 };
  const display = { id: 1, workArea: area };
  const spec = conversationTileGridSpec(area, undefined, 460);
  assert.equal(spec.cols, 3, 'three 460px columns still fit 1440px');
  assert.equal(spec.cellWidth, 460);
  const slots = Array.from({ length: spec.capacity }, (_, index) => conversationTileSlotBounds(area, index, spec.cols, spec.rows, 460));
  for (const slot of slots) assert.equal(slot.width, 460);
  assert.deepEqual(slots.slice(0, 3).map(slot => slot.x), [10, 480, 950]);
  assertPackedWithoutOverlap(slots, area, '460 slots');

  const assigned = assignNonDestructiveTileSlots([display], [], spec.capacity, 460);
  assert.deepEqual(assigned.map(item => item.bounds), slots);
  for (const item of assigned) assert.equal(item.bounds.width, 460);
  assertPackedWithoutOverlap(assigned.map(item => item.bounds), area, '460 assigned');

  // Existing 460px windows keep their place; the next window takes the first free 460px slot.
  const next = assignNonDestructiveTileSlots([display], [slots[0], slots[1]], 1, 460);
  assert.deepEqual(next[0].bounds, slots[2]);
  assert.equal(overlaps(next[0].bounds, slots[0]) || overlaps(next[0].bounds, slots[1]), false);

  // The other helpers accept the same width.
  assert.deepEqual(conversationTileBounds(area, 1, undefined, 460), slots[1]);
  assert.deepEqual(tileConversationBounds(area, 2, 460), slots.slice(0, 2));
});

test('wider remembered widths drop columns so tiles never overlap, and stay within the screen', () => {
  const area = { x: 0, y: 25, width: 1440, height: 875 };
  const wide = conversationTileGridSpec(area, undefined, 600);
  assert.equal(wide.cols, 2);
  assert.equal(wide.capacity, 4);
  assert.equal(conversationTileCapacity(area, 600), 4);
  const wideTiles = tileConversationBounds(area, wide.capacity, 600);
  for (const tile of wideTiles) assert.equal(tile.width, 600);
  assertPackedWithoutOverlap(wideTiles, area, '600');

  const full = conversationTileGridSpec(area, undefined, 1500);
  assert.equal(full.cols, 1);
  const fullTile = conversationTileSlotBounds(area, 0, undefined, undefined, 1500);
  assert.equal(fullTile.width, 1420, 'a width beyond the screen is limited to the screen less its margins');
  assert.equal(fullTile.x, 10);

  // A default-width capacity is unchanged without a remembered width.
  assert.equal(conversationTileCapacity(area), 6);
  // An unusable width (zero, negative, NaN, Infinity) falls back to the compact default.
  for (const invalid of [0, -20, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(conversationTileSlotBounds(area, 0, undefined, undefined, invalid), conversationTileSlotBounds(area, 0));
    assert.equal(conversationTileGridSpec(area, undefined, invalid).cols, 3);
  }
});

test('remembered widths spill to the next display without overlapping the windows already there', () => {
  const primaryArea = { x: 0, y: 25, width: 1440, height: 875 };
  const secondaryArea = { x: 1440, y: 0, width: 1920, height: 1080 };
  const displays = [{ id: 1, workArea: primaryArea }, { id: 2, workArea: secondaryArea }];
  const primarySpec = conversationTileGridSpec(primaryArea, undefined, 460);
  const existing = Array.from({ length: primarySpec.capacity }, (_, index) => conversationTileSlotBounds(primaryArea, index, primarySpec.cols, primarySpec.rows, 460));
  const [spill] = assignNonDestructiveTileSlots(displays, existing, 1, 460);
  assert.equal(spill.displayIndex, 1);
  assert.equal(spill.slotIndex, 0);
  assert.equal(spill.bounds.width, 460);
  assert.equal(spill.bounds.x, secondaryArea.x + 10);
  for (const window of existing) assert.equal(overlaps(spill.bounds, window), false);
});

// ---------------------------------------------------------------------------------------------------------------
// The actual native window manager (electron-main/nextmux-conversation-windows.ts) with stub Electron objects:
// no window opens, no user profile changes, timers and the clock are driven by the test.
// ---------------------------------------------------------------------------------------------------------------
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';

const ts = require('typescript');
const nativeSource = readFileSync(new URL('../src/electron-main/nextmux-conversation-windows.ts', import.meta.url), 'utf8');
const nativeCommon = require('../lib/common/nextmux-conversation-window.js');
const settle = () => new Promise(resolve => setImmediate(resolve));
const realDelay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function nativeFixture({ userData, throttled = true } = {}) {
  const app = new EventEmitter(), handlers = new Map(), windows = [], created = [], closeOrder = [], timers = new Set();
  let nextId = 0, clock = 1_000_000;
  app.getPath = name => { if (name !== 'userData' || !userData) throw new Error('no user data directory'); return userData; };
  app.focus = () => {};
  app.quit = () => {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    app.emit('before-quit', event);
    if (!event.defaultPrevented) app.committed = true;
  };
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options; this.destroyed = false; this.visible = true; this.bounds = { x: 0, y: 25, width: 1000, height: 700 };
      this.messages = []; this.throttling = [];
      let background = throttled;
      this.webContents = Object.assign(new EventEmitter(), {
        id: ++nextId, mainFrame: {}, url: 'file:///fixture/index.html',
        getURL() { return this.url; }, isLoading: () => false,
        getBackgroundThrottling: () => background,
        setBackgroundThrottling: allowed => { background = allowed; this.throttling.push(allowed); },
        send: (channel, ...args) => this.messages.push({ channel, args })
      });
      windows.push(this);
      this[Symbol.for('nextmux.conversation-window.quit-request')] = () => {
        closeOrder.push(this);
        return new Promise(resolve => { this.finishQuit = saved => { if (saved) this.destroy(); resolve(saved); }; });
      };
    }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    isMinimized() { return false; }
    isFullScreen() { return false; }
    isMaximized() { return false; }
    hide() { this.visible = false; }
    show() { this.visible = true; }
    focus() {}
    flashFrame() {}
    getBounds() { return { ...this.bounds }; }
    setBounds(bounds) { this.bounds = { ...bounds }; this.emit('resize'); }
    setMinimumSize(width, height) { this.minimumSize = [width, height]; }
    setResizable() {}
    close() { this[Symbol.for('nextmux.conversation-window.close')]?.(); }
    destroy() { if (this.destroyed) return; this.destroyed = true; this.visible = false; this.emit('closed'); }
    // The page loads, paints once and its conversation view asks for state.
    async loadURL(url) { this.webContents.url = url; this.emit('ready-to-show'); invoke('state', this); }
    events(type) { return this.messages.filter(message => message.channel === 'nextmux:conversation:event' && message.args[0].type === type).map(message => message.args[0]); }
  }
  Window.fromWebContents = contents => windows.find(window => window.webContents === contents);
  Window.getAllWindows = () => windows.filter(window => !window.destroyed);
  const display = { id: 1, workArea: { x: 0, y: 25, width: 1440, height: 875 } };
  const electron = { app, BrowserWindow: Window, ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    screen: { getDisplayMatching: () => display, getAllDisplays: () => [display], getPrimaryDisplay: () => display },
    systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: true }) } };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(nativeSource, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true
  } }).outputText, {
    exports, URL, console, Date: { now: () => clock },
    process: { platform: 'darwin', env: {}, pid: 4242 },
    require(name) {
      if (name === '@theia/core/shared/inversify') return { injectable: () => value => value };
      if (name === '@theia/core/electron-shared/electron') return electron;
      if (name === '../common/nextmux-conversation-window') return nativeCommon;
      if (name === 'node:crypto') return { randomUUID: () => 'request' };
      if (name === 'node:fs/promises' || name === 'node:path') return require(name);
      throw new Error(`Unexpected native dependency: ${name}`);
    },
    setTimeout(callback, milliseconds) { const timer = { callback, due: clock + milliseconds, unref() { return this; } }; timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); }
  }, { filename: 'conversation-windows-native.js' });
  const native = new exports.NextMuxConversationWindows();
  const application = {
    createWindow: async options => { created.push(options); return new Window(options); },
    getDefaultTheiaWindowOptions: () => ({ show: false, webPreferences: { preload: '/fixture/preload.js' } })
  };
  native.onStart(application);
  const event = window => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  function invoke(name, window, ...args) { return handlers.get(`nextmux:conversation:${name}`)(event(window), ...args); }
  function advance(milliseconds) {
    clock += milliseconds;
    for (const timer of [...timers].sort((a, b) => a.due - b.due)) if (timer.due <= clock && timers.has(timer)) { timers.delete(timer); timer.callback(); }
  }
  const primary = new Window(); invoke('state', primary);
  const publish = (...ids) => invoke('publish', primary, ids.map(id => ({ id, set: { id, title: `Title ${id}` }, unset: [] })));
  const detached = () => windows.filter(window => window !== primary && !window.destroyed);
  return { app, application, invoke, primary, windows, created, closeOrder, advance, publish, detached };
}

test('a standby window loads hidden behind the main window, takes the next conversation in place, then refills', async () => {
  const f = nativeFixture();
  f.primary.webContents.emit('did-finish-load');
  f.advance(1199); await settle();
  assert.equal(f.created.length, 0, 'the main window gets a head start');
  f.advance(1); await settle();
  assert.equal(f.created.length, 1);
  const [standby] = f.detached();
  assert.equal(f.created[0].preventAutomaticShow, true, "Theia's show-on-first-paint is off for a standby window");
  assert.equal(f.created[0].show, false);
  assert.equal(f.created[0].webPreferences.preload, '/fixture/preload.js', "Theia's own window defaults are kept");
  assert.equal(new URL(standby.webContents.url).searchParams.get('nextmuxConversation'), WARM_DETACHED_SESSION_ID);
  assert.equal(standby.isVisible(), false);
  assert.deepEqual(standby.minimumSize, [MIN_CONVERSATION_TILE_WIDTH, MIN_CONVERSATION_TILE_HEIGHT]);
  assert.equal(f.invoke('state', standby).sessionId, WARM_DETACHED_SESSION_ID);
  assert.equal(f.invoke('state', standby).sessions.length, 0);
  assert.equal(f.invoke('state', f.primary).windows.some(entry => entry.owner === standby.webContents.id), false, 'renderers never see a standby window');

  f.publish('chat');
  const opening = f.invoke('open', f.primary, ['chat']);
  await settle();
  const assign = standby.events('assign').at(-1);
  assert.equal(assign.sessionId, 'chat');
  assert.deepEqual(Array.from(assign.sessions, session => session.id), ['chat']);
  assert.equal(standby.isVisible(), false, 'it renders the conversation while still hidden');
  assert.deepEqual(standby.throttling, [false]);
  f.advance(100);
  assert.equal(await opening, true);
  assert.equal(standby.isVisible(), true);
  assert.deepEqual(standby.throttling, [false], 'background throttling stays disabled once shown');
  assert.equal(f.created.length, 1, 'no new page started for the tile');
  assert.equal(standby.getBounds().width, DEFAULT_CONVERSATION_TILE_WIDTH);
  assert.deepEqual(Array.from(f.invoke('state', standby).sessions, session => session.id), ['chat']);
  assert.deepEqual(Array.from(f.invoke('state', f.primary).windows.filter(entry => entry.owner === standby.webContents.id),
    entry => [entry.sessionId, entry.visible]), [['chat', true]]);

  f.advance(400); await settle();
  assert.equal(f.created.length, 2, 'the pool refills behind the tile');
  assert.equal(f.detached().at(-1).isVisible(), false);
  assert.equal(f.created[1].preventAutomaticShow, true);
});

test('tiles requested while the standby window is still loading wait for it; only one of them takes it', async () => {
  const f = nativeFixture({ throttled: false });
  let releaseCreation;
  const gate = new Promise(resolve => { releaseCreation = resolve; });
  const createWindow = f.application.createWindow;
  f.application.createWindow = async options => { await gate; return createWindow(options); };
  f.primary.webContents.emit('did-finish-load');
  f.advance(1200); await settle();
  f.publish('first', 'second');
  const both = f.invoke('open', f.primary, ['first', 'second']);
  await settle();
  assert.equal(f.created.length, 0, 'no second page starts while the standby window loads');
  releaseCreation();
  assert.equal(await both, true);
  assert.equal(f.created.length, 2, 'the standby page plus one new page for the other tile');
  assert.equal(f.created[0].preventAutomaticShow, true);
  assert.equal(f.created[1].preventAutomaticShow, true, 'a detached conversation window stays hidden until positioned and disables background throttling');
  assert.equal(f.created[1].webPreferences.backgroundThrottling, false);
  assert.deepEqual(Array.from(f.invoke('state', f.primary).windows, entry => entry.sessionId).sort(), ['first', 'second']);
  const standby = f.detached().find(window => window.options === f.created[0]);
  assert.equal(standby.events('assign').at(-1).sessionId, 'first');
  assert.equal(standby.isVisible(), true);
  const tiles = f.detached().map(window => window.getBounds());
  assert.equal(overlaps(tiles[0], tiles[1]), false);
});

test('a released window waits as a standby (at most two); quitting closes standby windows without a save handshake', async () => {
  const f = nativeFixture({ throttled: false });
  f.publish('a', 'b', 'c');
  assert.equal(await f.invoke('open', f.primary, ['a', 'b', 'c']), true);
  const [wa, wb, wc] = f.detached();
  for (const window of [wa, wb]) {
    window.close();
    assert.equal(window.events('hidden').length, 1);
    assert.equal(await f.invoke('release', window), true);
    assert.equal(window.isDestroyed(), false, 'kept as a standby window');
    assert.equal(window.events('assign').at(-1).sessionId, WARM_DETACHED_SESSION_ID);
    assert.equal(window.events('assign').at(-1).sessions.length, 0);
  }
  wc.close();
  assert.equal(await f.invoke('release', wc), true);
  assert.equal(wc.isDestroyed(), true, 'a third standby window is not kept');
  assert.equal(f.invoke('state', f.primary).windows.length, 0, 'standby windows are not listed');
  // Closing a standby window only keeps it hidden; it reveals nothing in the main window.
  const reveals = f.primary.events('reveal').length;
  wa.close();
  assert.equal(f.primary.events('reveal').length, reveals);
  assert.equal(wa.isDestroyed(), false);

  assert.equal(await f.invoke('open', f.primary, ['c']), true);
  assert.equal(f.created.length, 3, 'reopening reuses a standby window');
  const reused = [wa, wb].find(window => window.events('assign').at(-1).sessionId === 'c');
  const spare = [wa, wb].find(window => window !== reused);
  assert.equal(reused.isVisible(), true);
  assert.equal(spare.isVisible(), false);

  f.app.quit(); await settle();
  assert.deepEqual(f.closeOrder, [reused]);
  reused.finishQuit(true); await settle();
  assert.equal(spare.isDestroyed(), true, 'the standby window closed without asking its page');
  assert.equal(f.closeOrder.includes(spare), false);
  assert.deepEqual(f.closeOrder, [reused, f.primary]);
  f.primary.finishQuit(true); await settle();
  assert.equal(f.app.committed, true);
});

test('a width set by hand sizes later tiles and survives a restart; programmatic or unannounced resizes do not count', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'nmx-tile-width-'));
  try {
    const f = nativeFixture({ userData, throttled: false });
    f.publish('one', 'two');
    assert.equal(await f.invoke('open', f.primary, ['one']), true);
    const [one] = f.detached();
    assert.equal(one.getBounds().width, 380);
    one.emit('will-resize', {}, { ...one.getBounds(), width: 466.4 });
    assert.equal(f.created.length, 1);
    f.advance(401);
    one.emit('will-resize', {}, { ...one.getBounds(), width: 466.4 });
    one.bounds = { ...one.bounds, width: 466 };
    one.emit('resize');
    f.advance(250); await realDelay(80);
    assert.deepEqual(JSON.parse(readFileSync(join(userData, 'nextmux-conversation-window-prefs.json'), 'utf8')), { preferredTileWidth: 466 });
    assert.equal(await f.invoke('open', f.primary, ['two']), true);
    const two = f.detached().find(window => window !== one && new URL(window.webContents.url).searchParams.get('nextmuxConversation') === 'two');
    assert.equal(two.getBounds().width, 466);
    // Tiling moves windows programmatically; a resize without will-resize (a snap or zoom on macOS) is not a chosen width.
    assert.equal(f.invoke('tile', f.primary), true);
    f.advance(1500);
    two.bounds = { ...two.bounds, width: 900 };
    two.emit('resize');
    f.advance(250); await realDelay(80);
    assert.deepEqual(JSON.parse(readFileSync(join(userData, 'nextmux-conversation-window-prefs.json'), 'utf8')), { preferredTileWidth: 466 });

    const restarted = nativeFixture({ userData, throttled: false });
    await realDelay(80);
    restarted.publish('three');
    assert.equal(await restarted.invoke('open', restarted.primary, ['three']), true);
    assert.equal(restarted.detached()[0].getBounds().width, 466);
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});

test('the standby placeholder is never a conversation: publish, open, focus and reclaim ignore it', async () => {
  const f = nativeFixture();
  assert.equal(f.invoke('publish', f.primary, [{ id: WARM_DETACHED_SESSION_ID, set: { id: WARM_DETACHED_SESSION_ID }, unset: [] }]), true);
  assert.equal(f.invoke('state', f.primary).sessions.some(session => session.id === WARM_DETACHED_SESSION_ID), false);
  assert.equal(await f.invoke('open', f.primary, [WARM_DETACHED_SESSION_ID]), false);
  assert.equal(f.invoke('focus', f.primary, WARM_DETACHED_SESSION_ID), false);
  assert.equal(f.invoke('reclaim', f.primary, WARM_DETACHED_SESSION_ID), false);
  // A detached window may exit tiling for its own conversation only.
  f.publish('own', 'other');
  assert.equal(await f.invoke('open', f.primary, ['own', 'other']), true);
  const [own] = f.detached();
  assert.equal(f.invoke('reclaim', own, 'other'), false);
  assert.equal(f.invoke('reclaim', own, 'own'), true);
  assert.equal(own.isVisible(), false);
});

test('a file opened in a detached window, which has no file drawer, comes to the main window with its conversation', async () => {
  const f = nativeFixture();
  f.publish('docs');
  assert.equal(await f.invoke('open', f.primary, ['docs']), true);
  const [tile] = f.detached();
  const lastReveal = () => ({ ...f.primary.events('reveal').at(-1) });
  const file = 'file:///Users/me/project/AGENTS.md';
  f.primary.hide();
  assert.equal(f.invoke('reveal-in-main', tile, 'docs', file).ok, true);
  assert.equal(f.primary.isVisible(), true, 'the main window comes forward');
  assert.deepEqual(lastReveal(), { type: 'reveal', sessionId: 'docs', fileUri: file });
  // Only a bounded file: URI travels; anything else reveals the conversation alone.
  for (const unsafe of ['https://example.com/AGENTS.md', 'javascript:alert(1)', 'file:///x\nnext', `file:///${'a'.repeat(8200)}`, 42, undefined]) {
    assert.equal(f.invoke('reveal-in-main', tile, 'docs', unsafe).ok, true);
    assert.deepEqual(lastReveal(), { type: 'reveal', sessionId: 'docs' });
  }
  const reveals = f.primary.events('reveal').length;
  assert.equal(f.invoke('reveal-in-main', tile, '  ', file).ok, false, 'a file without its conversation is not revealed');
  assert.equal(f.primary.events('reveal').length, reveals);
});
