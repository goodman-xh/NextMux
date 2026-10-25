import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareCanvasVideoPrompt } from '../lib/common/nextmux-canvas-prompts.js';
import { ComicPromptTranslationCache } from '../lib/common/nextmux-comic-prompts.js';

const english = { promptLanguage: 'en', maxPromptChars: 2000 };
const multilingual = { promptLanguage: 'any', maxPromptChars: 2000 };
const input = (values = {}) => ({ modelId: 'google/veo-3.1', cacheKey: 'project:node:text-route', prompt: 'The courier knocks on the door.', ...values });

test('already English production instructions need no planning request and retain exact authored bytes', async () => {
    const prompt = '  The courier knocks.\nKeep warm light.  ';
    const result = await prepareCanvasVideoPrompt(input({ prompt, negativePrompt: 'text, watermark', guide: english }), async () => { throw Error('unnecessary translation'); });
    assert.deepEqual(result, { prompt, negativePrompt: 'text, watermark' });
});

test('English-only model reuses the desk translator for visible production text and negative controls', async () => {
    let calls = 0;
    const result = await prepareCanvasVideoPrompt(input({ prompt: '邮递员敲门。\n场景：木屋门廊，深夜。', negativePrompt: '不要水印' }), async request => {
        calls++;
        assert.match(request.system, /Preserve all visual facts/);
        assert.match(request.system, /not dialogue/);
        assert.deepEqual(JSON.parse(request.prompt), { negative: '不要水印', prompt: '邮递员敲门。\n场景：木屋门廊，深夜。' });
        return '{"prompt":"The courier knocks on the wooden porch door at midnight.","negative":"no watermark"}';
    });
    assert.equal(calls, 1);
    assert.deepEqual(result, { prompt: 'The courier knocks on the wooden porch door at midnight.', negativePrompt: 'no watermark' });
});

test('multilingual models preserve original instructions without translation', async () => {
    assert.deepEqual(await prepareCanvasVideoPrompt(input({ prompt: '邮递员敲门。', negativePrompt: '不要水印', guide: multilingual }), async () => { throw Error('unnecessary translation'); }),
        { prompt: '邮递员敲门。', negativePrompt: '不要水印' });
    assert.deepEqual(await prepareCanvasVideoPrompt(input({ modelId: 'minimax/hailuo-3-max', prompt: '邮递员敲门。' }), async () => { throw Error('unnecessary translation'); }),
        { prompt: '邮递员敲门。' });
});

test('a required translation without a configured text route fails before media generation', async () => {
    await assert.rejects(prepareCanvasVideoPrompt(input({ prompt: '郵便配達員がドアを叩く。' })), error => error.code === 'CANVAS_PROMPT_TRANSLATION_REQUIRED');
    await assert.rejects(prepareCanvasVideoPrompt(input({ negativePrompt: 'водяной знак' })), error => error.code === 'CANVAS_PROMPT_TRANSLATION_REQUIRED');
});

test('quoted source language text survives translation exactly and alone does not require it', async () => {
    const prompt = 'He says “你好。” and holds a sign reading "欢迎".';
    assert.deepEqual(await prepareCanvasVideoPrompt(input({ prompt })), { prompt });
    const translated = await prepareCanvasVideoPrompt(input({ prompt: '他敲门说“你好。”', negativePrompt: '不要画“文字”' }), async request => {
        assert.match(request.system, /holds original-language text/);
        assert.deepEqual(JSON.parse(request.prompt), { negative: '不要画__NEXTMUX_QUOTE_1__', prompt: '他敲门说__NEXTMUX_QUOTE_0__' });
        return '{"prompt":"He knocks and says __NEXTMUX_QUOTE_0__.","negative":"Do not draw __NEXTMUX_QUOTE_1__."}';
    });
    assert.deepEqual(translated, { prompt: 'He knocks and says “你好。”.', negativePrompt: 'Do not draw “文字”.' });
});

test('translation validation refuses malformed, incomplete, source-language and omitted quote responses', async () => {
    await assert.rejects(prepareCanvasVideoPrompt(input({ prompt: '小猫轻轻眨眼。' }), async () => 'not JSON'), /invalid JSON/);
    await assert.rejects(prepareCanvasVideoPrompt(input({ prompt: '小猫轻轻眨眼。' }), async () => '{"prompt":"Blink."}'), /incomplete/);
    await assert.rejects(prepareCanvasVideoPrompt(input({ prompt: '小猫轻轻眨眼。' }), async () => '{"prompt":"小猫轻轻眨眼。","negative":""}'), /still in the source language/);
    await assert.rejects(prepareCanvasVideoPrompt(input({ prompt: '招牌写着“你好”' }), async () => '{"prompt":"A sign.","negative":""}'), /omitted quoted text/);
});

test('concurrent preparations share one translation and a changed prompt needs a fresh one', async () => {
    const cache = new ComicPromptTranslationCache();
    let calls = 0;
    const translate = async request => { calls++; return JSON.stringify({ prompt: JSON.parse(request.prompt).prompt.includes('敲门') ? 'He knocks.' : 'He waits.', negative: '' }); };
    const first = input({ prompt: '他敲门。', cache });
    assert.deepEqual(await Promise.all([prepareCanvasVideoPrompt(first, translate), prepareCanvasVideoPrompt(first, translate)]), [{ prompt: 'He knocks.' }, { prompt: 'He knocks.' }]);
    assert.equal(calls, 1);
    assert.deepEqual(await prepareCanvasVideoPrompt(input({ prompt: '他等待。', cache }), translate), { prompt: 'He waits.' });
    assert.equal(calls, 2);
});

test('avoid list is frozen into exact sent prompt only for adapters requiring a prompt suffix', async () => {
    assert.deepEqual(await prepareCanvasVideoPrompt(input({ negativePrompt: ' text, watermark ', negativePromptInPrompt: true })),
        { prompt: 'The courier knocks on the door.\n\nAvoid: text, watermark' });
    assert.deepEqual(await prepareCanvasVideoPrompt(input({ prompt: '他敲门。', negativePrompt: '水印', guide: multilingual, negativePromptInPrompt: true })),
        { prompt: '他敲门。\n\n避免：水印' });
    assert.deepEqual(await prepareCanvasVideoPrompt(input({ negativePrompt: 'watermark', negativePromptInPrompt: true, negativePromptLabel: 'Negative prompt: ' })),
        { prompt: 'The courier knocks on the door.\n\nNegative prompt: watermark' });
});

test('model limits validate the translated prompt and combined suffix without truncation', async () => {
    await assert.rejects(prepareCanvasVideoPrompt(input({ prompt: 'Long authored action', guide: { ...english, maxPromptChars: 8 } })), error => error.code === 'CANVAS_PROMPT_TOO_LONG');
    await assert.rejects(prepareCanvasVideoPrompt(input({ prompt: '敲门', guide: { ...english, maxPromptChars: 8 } }), async () => '{"prompt":"Knock on the wooden door.","negative":""}'), error => error.code === 'CANVAS_PROMPT_TOO_LONG');
    await assert.rejects(prepareCanvasVideoPrompt(input({ prompt: 'Knock.', negativePrompt: 'no watermark', negativePromptInPrompt: true, guide: { ...english, maxPromptChars: 10 } })), error => error.code === 'CANVAS_PROMPT_TOO_LONG');
    assert.deepEqual(await prepareCanvasVideoPrompt(input({ prompt: 'Knock.', negativePrompt: 'no watermark', guide: { ...english, maxPromptChars: 6 } })), { prompt: 'Knock.', negativePrompt: 'no watermark' });
});
