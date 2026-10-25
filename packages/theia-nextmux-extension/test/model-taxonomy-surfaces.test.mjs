import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { MODEL_CAPABILITY_KEYS, MODEL_PRIMARY_CATEGORIES } from '@nextmux/model-runtime/model-taxonomy';
import { modelCapabilityLabel, modelCapabilityTagLabels, modelCategoryLabel, modelTaxonomyView } from '../lib/browser/nextmux-model-taxonomy-locale.js';
import { ModelTaxonomyTags } from '../lib/browser/nextmux-model-taxonomy-tags.js';
import { canvasText } from '../lib/browser/nextmux-comic-canvas-text.js';
import { MODEL_CENTER_CATEGORIES, modelCenterFilterLabel } from '../lib/browser/nextmux-model-center-merchants.js';
import { comicCandidateTaxonomyFacts } from '../lib/browser/nextmux-comic-model-setup.js';

// One vocabulary for every desktop surface: ten primary categories, eleven capability badges, never mixed (Task DK-T2).
const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const React = core('react'), { renderToStaticMarkup } = core('react-dom/server');
const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];

test('every locale names all eleven categories and eleven badges, each name distinct', () => {
  for (const locale of locales) {
    const categories = MODEL_PRIMARY_CATEGORIES.map(category => modelCategoryLabel(locale, category));
    const badges = MODEL_CAPABILITY_KEYS.map(key => modelCapabilityLabel(locale, key));
    for (const name of [...categories, ...badges]) assert.ok(name.trim(), locale);
    assert.equal(new Set(categories).size, 11, `${locale} categories`);
    assert.equal(new Set(badges).size, 11, `${locale} badges`);
  }
  // zh-CN is the desktop's own model-list wording, word for word.
  assert.deepEqual(MODEL_PRIMARY_CATEGORIES.map(category => modelCategoryLabel('zh-CN', category)),
    ['文字 / 对话', '3D', '图片', '视频', '配音', '音乐', '音效', '语音转文字', '决策', '向量', '重排序']);
  assert.deepEqual(MODEL_CAPABILITY_KEYS.map(key => modelCapabilityLabel('zh-CN', key)),
    ['工具', '思考', '识图', '联网搜索', '结构化输出', '图片编辑', '文生视频', '图生视频', '参考生视频', '有声', '参考人声']);
});

test('the desktop names match the web portals’ taxonomy messages in every locale', t => {
  const directory = new URL('../../../apps/cloudflare-platform/web/src/i18n/messages/admin/', import.meta.url);
  if (!existsSync(new URL('en.ts', directory))) { t.skip('web message catalogue not in this checkout'); return; }
  for (const locale of locales) {
    const source = readFileSync(new URL(`${locale}.ts`, directory), 'utf8');
    const message = key => JSON.parse(new RegExp(`"${key.replace(/\./g, '\\.')}":\\s*("(?:[^"\\\\]|\\\\.)*")`).exec(source)?.[1] ?? 'null');
    for (const category of MODEL_PRIMARY_CATEGORIES) assert.equal(modelCategoryLabel(locale, category), message(`taxonomy.category.${category}`), `${locale} ${category}`);
    for (const key of MODEL_CAPABILITY_KEYS) assert.equal(modelCapabilityLabel(locale, key), message(`taxonomy.cap.${key}`), `${locale} ${key}`);
  }
});

test('a model row resolves to one category and its badges; the chip strip shows exactly that', () => {
  const veo = { id: 'veo-3.1-fast', kind: 'video', input: ['text', 'image'], output: ['video', 'audio'], capabilities: ['video_generation', 'video_native_audio'] };
  assert.deepEqual(modelTaxonomyView('zh-CN', veo), { category: 'video', categoryLabel: '视频',
    badges: [{ key: 'text_to_video', label: '文生视频' }, { key: 'image_to_video', label: '图生视频' }, { key: 'video_native_audio', label: '有声' }] });
  assert.deepEqual(modelCapabilityTagLabels('en', { id: 'm', output: ['text'], capabilities: ['coding', 'reasoning', 'input:image'] }), ['Tools', 'Thinking', 'Vision']);
  const html = renderToStaticMarkup(React.createElement(ModelTaxonomyTags, { locale: 'en', model: veo, showCategory: true }));
  assert.match(html, /^<span class="nmx-model-taxonomy" title="Video · Text to video · Image to video · With audio" data-nmx-literal="true">/);
  assert.match(html, /<span class="nmx-model-taxonomy-category" data-model-category="video">Video<\/span>/);
  assert.equal((html.match(/nmx-model-taxonomy-badge/g) || []).length, 3);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(ModelTaxonomyTags, { locale: 'en', model: veo })), /nmx-model-taxonomy-category/, 'grouped lists show badges only');
  assert.equal(renderToStaticMarkup(React.createElement(ModelTaxonomyTags, { locale: 'en', model: { id: 'plain-chat', output: ['text'] } })), '', 'nothing to show renders nothing');
});

test('canvas video modes carry the badge names; Model Center filters use category words and keep tools apart', () => {
  for (const locale of locales) {
    assert.equal(canvasText(locale, 'mode.textToVideo'), modelCapabilityLabel(locale, 'text_to_video'), locale);
    assert.equal(canvasText(locale, 'mode.imageToVideo'), modelCapabilityLabel(locale, 'image_to_video'), locale);
    assert.equal(canvasText(locale, 'mode.referenceToVideo'), modelCapabilityLabel(locale, 'reference_to_video'), locale);
    assert.equal(modelCenterFilterLabel(locale, 'reasoning'), modelCategoryLabel(locale, 'language'));
    assert.equal(modelCenterFilterLabel(locale, '3d'), modelCategoryLabel(locale, '3d'));
    assert.equal(modelCenterFilterLabel(locale, 'audio'), ['speech', 'music', 'sound_effect'].map(category => modelCategoryLabel(locale, category)).join(' / '));
    assert.equal(modelCenterFilterLabel(locale, 'coding'), modelCapabilityLabel(locale, 'tools'));
  }
  assert.deepEqual(MODEL_CENTER_CATEGORIES.map(entry => entry.filter), ['reasoning', '3d', 'image', 'video', 'audio'], 'the directory server’s browse buckets');
  assert.ok(MODEL_CENTER_CATEGORIES.every(entry => entry.categories.every(category => MODEL_PRIMARY_CATEGORIES.includes(category))));
});

test('comic candidates use the studio’s sound verdict for the shared “with audio” badge', () => {
  const offering = { id: 'o1', displayName: 'Kling', registryModelId: 'kling-v2', kind: 'video', category: 'video', input: ['text', 'image'], output: ['video', 'audio'], capabilities: ['video_generation', 'native_audio'] };
  const badges = facts => modelTaxonomyView('zh-CN', facts).badges.map(badge => badge.key);
  assert.ok(badges(comicCandidateTaxonomyFacts({ model: 'kling-v2', label: 'Kling', withSound: true, offering }, 'video')).includes('video_native_audio'));
  assert.ok(!badges(comicCandidateTaxonomyFacts({ model: 'kling-v2', label: 'Kling', withSound: false, offering }, 'video')).includes('video_native_audio'), 'a silent verdict never shows “with audio”');
  // An own-API candidate has only its id: it is filed under the step's category.
  const own = comicCandidateTaxonomyFacts({ model: 'my-video-model', label: 'My video', withSound: true }, 'video');
  assert.deepEqual(modelTaxonomyView('en', own), { category: 'video', categoryLabel: 'Video',
    badges: [{ key: 'text_to_video', label: 'Text to video' }, { key: 'video_native_audio', label: 'With audio' }] });
  assert.equal(modelTaxonomyView('en', comicCandidateTaxonomyFacts({ model: 'qwen3-max', label: 'Qwen' }, 'text')).category, 'language');
});

test('Settings → Models, the own-API list and the merchant drawer read names from the shared taxonomy', () => {
  const read = name => readFileSync(new URL(`../src/browser/${name}`, import.meta.url), 'utf8');
  const settings = read('nextmux-model-visibility-settings.tsx');
  assert.match(settings, /modelCategoryLabel\(props\.locale, category === 'soundEffect' \? 'sound_effect' : category\)/);
  assert.match(settings, /<ModelTaxonomyTags locale=\{props\.locale\} model=\{model\} \/>/);
  const own = read('nextmux-official-discovery.tsx');
  assert.match(own, /modelCategoryLabel\(locale, kind === 'llm' \? 'language' : kind\)/);
  assert.doesNotMatch(own, /\b(?:tools|vision|reasoning|llm): '/, 'the own-API list keeps no names of its own for categories or badges');
  const drawer = read('nextmux-model-center-merchants.tsx');
  assert.match(drawer, /<ModelTaxonomyTags locale=\{locale\} model=\{model\} showCategory \/>/);
  assert.match(read('nextmux-desktop-widget.tsx'), /<header><strong>\{model\.label\}<\/strong><ModelTaxonomyTags locale=\{this\.desktopLocale\} model=\{model\} \/><\/header>/);
});
