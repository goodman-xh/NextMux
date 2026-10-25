import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

import {
  IMAGE_LIGHTBOX_ZOOM,
  createImageLightboxState,
  imageLightboxPercentage,
  updateImageLightbox
} from '../lib/browser/nextmux-image-lightbox.js';

const widgetSource = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
const style = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux.css', import.meta.url)), 'utf8');

const image = {
  src: 'data:image/png;base64,preview',
  alt: 'Preview',
  name: 'preview.png'
};

const dispatch = (state, event) => updateImageLightbox(state, event).state;

test('opening an image creates a full-screen preview state at 100%', () => {
  const initial = createImageLightboxState();
  const transition = updateImageLightbox(initial, { type: 'open', image });

  assert.equal(initial.isOpen, false);
  assert.equal(initial.image, undefined);
  assert.deepEqual(transition, {
    handled: true,
    state: {
      isOpen: true,
      image,
      zoomPercent: 100,
      panX: 0,
      panY: 0
    }
  });
  assert.equal(imageLightboxPercentage(transition.state), '100%');
});

test('zoom buttons use fixed steps and clamp at reasonable minimum and maximum values', () => {
  let state = dispatch(createImageLightboxState(), { type: 'open', image });

  state = dispatch(state, { type: 'zoom-in' });
  assert.equal(state.zoomPercent, 100 + IMAGE_LIGHTBOX_ZOOM.step);

  for (let index = 0; index < 100; index += 1) state = dispatch(state, { type: 'zoom-in' });
  assert.equal(state.zoomPercent, IMAGE_LIGHTBOX_ZOOM.max);

  for (let index = 0; index < 100; index += 1) state = dispatch(state, { type: 'zoom-out' });
  assert.equal(state.zoomPercent, IMAGE_LIGHTBOX_ZOOM.min);
});

test('opening another image resets zoom to 100%', () => {
  let state = dispatch(createImageLightboxState(), { type: 'open', image });
  state = dispatch(state, { type: 'wheel', deltaY: -120, pointerX: 120, pointerY: -80 });
  assert.notEqual(state.panX, 0);
  state = dispatch(state, {
    type: 'open',
    image: { src: 'data:image/jpeg;base64,next', name: 'next.jpg' }
  });

  assert.equal(state.zoomPercent, 100);
  assert.equal(state.panX, 0);
  assert.equal(state.panY, 0);
  assert.equal(state.image?.name, 'next.jpg');
});

test('Escape, backdrop and close button share explicit close semantics', () => {
  for (const source of ['escape', 'backdrop', 'button']) {
    const open = dispatch(createImageLightboxState(), { type: 'open', image });
    const transition = updateImageLightbox(open, { type: 'close', source });

    assert.equal(transition.handled, true, source);
    assert.deepEqual(transition.state, createImageLightboxState(), source);
  }
});

test('wheel zooms in and out at the pointer, then recenters at 100%', () => {
  let state = dispatch(createImageLightboxState(), { type: 'open', image });
  const zoomIn = updateImageLightbox(state, { type: 'wheel', deltaY: -120, pointerX: 120, pointerY: -80 });
  assert.equal(zoomIn.handled, true);
  state = zoomIn.state;
  assert.equal(state.zoomPercent, 125);
  assert.equal(state.panX, -30);
  assert.equal(state.panY, 20);

  const zoomOut = updateImageLightbox(state, { type: 'wheel', deltaY: 120, pointerX: 120, pointerY: -80 });
  assert.equal(zoomOut.handled, true);
  assert.equal(zoomOut.state.zoomPercent, 100);
  assert.equal(zoomOut.state.panX, 0);
  assert.equal(zoomOut.state.panY, 0);
});

test('moving the pointer between wheel events preserves the image point under each new cursor position', () => {
  let state = dispatch(createImageLightboxState(), { type: 'open', image });
  for (const [deltaY, pointerX, pointerY] of [[-1, 150, -90], [-1, -180, 110], [-1, 23, 45], [1, -67, -38]]) {
    const imageX = (pointerX - state.panX) / (state.zoomPercent / 100);
    const imageY = (pointerY - state.panY) / (state.zoomPercent / 100);
    state = dispatch(state, { type: 'wheel', deltaY, pointerX, pointerY });
    assert.ok(Math.abs(imageX * state.zoomPercent / 100 + state.panX - pointerX) < 1e-9);
    assert.ok(Math.abs(imageY * state.zoomPercent / 100 + state.panY - pointerY) < 1e-9);
  }
});

test('zero and non-finite wheel deltas remain unhandled without changing state', () => {
  const state = dispatch(createImageLightboxState(), { type: 'open', image });
  for (const deltaY of [0, -0, NaN, Infinity, -Infinity]) {
    const transition = updateImageLightbox(state, { type: 'wheel', deltaY, pointerX: 100, pointerY: 80 });
    assert.equal(transition.handled, false);
    assert.strictEqual(transition.state, state);
  }
});

test('wheel zoom clamps at both limits, consumes limit input and keeps invalid pointer coordinates finite', () => {
  let state = dispatch(createImageLightboxState(), { type: 'open', image });
  for (let index = 0; index < 100; index += 1) state = dispatch(state, { type: 'wheel', deltaY: -1, pointerX: NaN, pointerY: Infinity });
  assert.equal(state.zoomPercent, IMAGE_LIGHTBOX_ZOOM.max);
  assert.equal(state.panX, 0);
  assert.equal(state.panY, 0);
  const limit = updateImageLightbox(state, { type: 'wheel', deltaY: -1, pointerX: 100, pointerY: 80 });
  assert.equal(limit.handled, true);
  assert.strictEqual(limit.state, state);
  for (let index = 0; index < 100; index += 1) state = dispatch(state, { type: 'wheel', deltaY: 1, pointerX: 100, pointerY: 80 });
  assert.equal(state.zoomPercent, IMAGE_LIGHTBOX_ZOOM.min);
  assert.equal(state.panX, 0);
  assert.equal(state.panY, 0);
});

test('button zoom-out also recenters a wheel-panned image at 100%', () => {
  let state = dispatch(createImageLightboxState(), { type: 'open', image });
  state = dispatch(state, { type: 'wheel', deltaY: -1, pointerX: 140, pointerY: 70 });
  state = dispatch(state, { type: 'zoom-out' });
  assert.equal(state.zoomPercent, 100);
  assert.equal(state.panX, 0);
  assert.equal(state.panY, 0);
});

test('closed previews ignore zoom controls and remain closed', () => {
  const closed = createImageLightboxState();

  for (const type of ['zoom-in', 'zoom-out']) {
    const transition = updateImageLightbox(closed, { type });
    assert.equal(transition.handled, false);
    assert.strictEqual(transition.state, closed);
  }
  assert.deepEqual(updateImageLightbox(closed, { type: 'wheel', deltaY: -1, pointerX: 50, pointerY: 50 }), { state: closed, handled: false });
});

test('the desktop adapter covers the full viewport and exposes wheel and button zoom controls', () => {
  assert.match(widgetSource, /protected attachmentLightbox: ImageLightboxState = createImageLightboxState\(\)/);
  assert.match(widgetSource, /event\.key === 'Escape' && this\.attachmentLightbox\.isOpen/);
  assert.match(widgetSource, /onMouseDown=\{\(\) => this\.closeAttachmentLightbox\('backdrop'\)\}/);
  assert.match(widgetSource, /imageLightboxPercentage\(lightbox\)/);
  assert.match(widgetSource, /zoomAttachmentLightbox\('out'\)/);
  assert.match(widgetSource, /zoomAttachmentLightbox\('in'\)/);
  assert.match(widgetSource, /onWheel=\{event => this\.onAttachmentLightboxWheel\(event\)\}/);
  assert.match(widgetSource, /onWheel=\{event => this\.onContextImagePreviewWheel\(event\)\}/);
  assert.match(widgetSource, /addEventListener\('wheel', this\.attachmentLightboxNativeWheel, \{ passive: false \}\)/);
  assert.match(widgetSource, /addEventListener\('wheel', this\.contextImagePreviewNativeWheel, \{ passive: false \}\)/);
  assert.match(style, /\.nmx-attachment-lightbox\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?z-index:\s*10000;[\s\S]*?width:\s*100vw;[\s\S]*?height:\s*100vh;/);
  assert.match(style, /\.nmx-attachment-lightbox footer\s*\{[\s\S]*?position:\s*absolute;/);
  assert.match(style, /\.nmx-attachment-lightbox-stage > img\s*\{[^}]*transform:\s*translate\(var\(--nmx-image-pan-x, 0px\), var\(--nmx-image-pan-y, 0px\)\) scale\(var\(--nmx-image-zoom, 1\)\);[^}]*transform-origin:\s*50% 50%;[^}]*transition:\s*none;/);
  assert.match(style, /\.nmx-context-image-canvas > img\s*\{[^}]*transform:\s*translate\(var\(--nmx-image-pan-x, 0px\), var\(--nmx-image-pan-y, 0px\)\) scale\(var\(--nmx-image-zoom, 1\)\);/);
});

// Exercise the production adapter methods without booting the desktop services.
const widgetFile = ts.createSourceFile('widget.tsx', widgetSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const adapterMembers = new Set([
  'attachmentLightbox', 'attachmentLightboxWheelSurface', 'contextImagePreviewWheelSurface', 'contextImagePreviewZoom',
  'imagePreviewStyle', 'applyImagePreviewTransform', 'updateImagePreviewWheel', 'onAttachmentLightboxWheel',
  'onContextImagePreviewWheel', 'attachmentLightboxNativeWheel', 'contextImagePreviewNativeWheel',
  'bindAttachmentLightboxWheel', 'bindContextImagePreviewWheel'
]);
const members = [];
function collectAdapterMembers(node) {
  if ((ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) && adapterMembers.has(node.name.getText(widgetFile))) members.push(node.getText(widgetFile));
  ts.forEachChild(node, collectAdapterMembers);
}
collectAdapterMembers(widgetFile);
assert.equal(members.length, adapterMembers.size);
const adapterJs = ts.transpileModule(`class ImagePreviewAdapter { updateCalls = 0; update() { this.updateCalls++; } ${members.join('\n')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const createAdapter = new Function('updateImageLightbox', 'createImageLightboxState', `${adapterJs}; return () => new ImagePreviewAdapter();`)(updateImageLightbox, createImageLightboxState);

function makeSurface() {
  const style = new Map();
  const listeners = new Map();
  const imageElement = {
    style: { setProperty: (name, value) => style.set(name, value) },
    getBoundingClientRect() {
      const zoom = Number(style.get('--nmx-image-zoom') || 1);
      const panX = parseFloat(style.get('--nmx-image-pan-x') || '0');
      const panY = parseFloat(style.get('--nmx-image-pan-y') || '0');
      return { left: 400 + panX - 300 * zoom, top: 300 + panY - 200 * zoom, width: 600 * zoom, height: 400 * zoom };
    }
  };
  const surface = {
    querySelector: selector => selector === 'img' ? imageElement : null,
    addEventListener: (type, handler, options) => listeners.set(type, { handler, options }),
    removeEventListener: (type, handler) => { if (listeners.get(type)?.handler === handler) listeners.delete(type); }
  };
  const wheel = (deltaY, clientX = 500, clientY = 400) => ({
    currentTarget: surface, deltaY, clientX, clientY, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }
  });
  return { surface, style, listeners, wheel };
}

test('lightbox adapter anchors repeated native wheel events before re-render and cancels background scrolling', () => {
  const adapter = createAdapter();
  const { surface, style, listeners, wheel } = makeSurface();
  adapter.attachmentLightbox = dispatch(createImageLightboxState(), { type: 'open', image });
  adapter.bindAttachmentLightboxWheel(surface);
  assert.deepEqual(listeners.get('wheel').options, { passive: false });
  for (const [clientX, clientY] of [[550, 220], [300, 460], [610, 310]]) {
    const state = adapter.attachmentLightbox;
    const imageX = (clientX - 400 - state.panX) / (state.zoomPercent / 100);
    const imageY = (clientY - 300 - state.panY) / (state.zoomPercent / 100);
    const event = wheel(-120, clientX, clientY);
    listeners.get('wheel').handler(event);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
    const next = adapter.attachmentLightbox;
    assert.ok(Math.abs(400 + imageX * next.zoomPercent / 100 + next.panX - clientX) < 1e-9);
    assert.ok(Math.abs(300 + imageY * next.zoomPercent / 100 + next.panY - clientY) < 1e-9);
    assert.equal(style.get('--nmx-image-pan-x'), `${next.panX}px`);
    assert.equal(Number(style.get('--nmx-image-zoom')), next.zoomPercent / 100);
  }
  const ignored = wheel(0);
  listeners.get('wheel').handler(ignored);
  assert.equal(ignored.prevented, false);
  assert.equal(ignored.stopped, false);
  assert.equal(adapter.updateCalls, 3);
  adapter.bindAttachmentLightboxWheel(null);
  assert.equal(listeners.has('wheel'), false);
});

test('file drawer preview zooms directly and resets when its preview surface is reopened', () => {
  const adapter = createAdapter();
  const { surface, listeners, wheel } = makeSurface();
  adapter.contextFilePreview = { kind: 'image', uri: 'file:///preview.png', imageDataUrl: image.src, name: image.name };
  adapter.bindContextImagePreviewWheel(surface);
  assert.deepEqual(listeners.get('wheel').options, { passive: false });
  listeners.get('wheel').handler(wheel(-120, 550, 220));
  assert.equal(adapter.contextImagePreviewZoom.state.zoomPercent, 125);
  assert.equal(adapter.contextImagePreviewZoom.state.panX, -37.5);
  assert.equal(adapter.contextImagePreviewZoom.state.panY, 20);
  assert.equal(adapter.attachmentLightbox.isOpen, false);
  adapter.bindContextImagePreviewWheel(null);
  assert.equal(adapter.contextImagePreviewZoom, undefined);
  assert.equal(listeners.has('wheel'), false);
  const reopened = makeSurface();
  adapter.bindContextImagePreviewWheel(reopened.surface);
  reopened.listeners.get('wheel').handler(reopened.wheel(120));
  assert.equal(adapter.contextImagePreviewZoom.state.zoomPercent, 75);
  assert.equal(adapter.contextImagePreviewZoom.state.panX, 0);
  assert.equal(adapter.contextImagePreviewZoom.state.panY, 0);
});
