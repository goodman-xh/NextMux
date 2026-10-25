import assert from 'node:assert/strict';
import test from 'node:test';
import { matchCatalogModel } from '../lib/browser/nextmux-own-model-match.js';
import { ownModelKind } from '../lib/browser/nextmux-own-model-kind.js';

const model = (canonicalModel, extra = {}) => ({ id: canonicalModel, canonicalModel, provider: canonicalModel.split('/')[0], output: ['text'], capabilities: [],
    contextTokens: null, maximumOutputTokens: null, ...extra });
const catalog = [
    model('anthropic/claude-sonnet-4.5', { aliases: ['anthropic/claude-sonnet-4-5', 'claude-sonnet-4-5', 'claude-sonnet-4-5-20250929'], capabilities: ['tools', 'vision', 'reasoning'], contextTokens: 200000,
        referencePrice: { currency: 'USD', unit: 'per_million_tokens', input: 3, output: 15, source: 'Models.dev' } }),
    model('openai/gpt-4o', { aliases: ['gpt-4o-2024-08-06'], contextTokens: 128000 }),
    model('openai/gpt-image-1', { output: ['image'] }),
    model('deepseek/deepseek-chat', { aliases: ['deepseek/deepseek-v3'] }),
    model('alibaba/wan-2.5', { output: ['video'] }),
    model('google/gemini-2.5-flash-image', { output: ['image', 'text'], aliases: ['nano-banana'] }),
    model('meta-llama/llama-3.1-8b-instruct'),
    model('nousresearch/llama-3.1-8b-instruct'),
    model('mistralai/mistral-large'), model('someone/mistral-large'), model('another/mistral-large'),
];

test('relay spellings of a model resolve to its public directory entry on this computer', () => {
    const cases = [
        ['claude-sonnet-4-5-20250929', 'anthropic/claude-sonnet-4.5'],
        ['[官转]claude-sonnet-4-5', 'anthropic/claude-sonnet-4.5'],
        ['anthropic/claude-sonnet-4.5', 'anthropic/claude-sonnet-4.5'],
        ['gpt-4o', 'openai/gpt-4o'],
        ['gpt-4o-2024-11-20', 'openai/gpt-4o'],
        ['GPT-4o', 'openai/gpt-4o'],
        ['video_wan_2.5', 'alibaba/wan-2.5'],
        ['deepseek-chat', 'deepseek/deepseek-chat'],
        ['deepseek-v3', 'deepseek/deepseek-chat'],
        // Two providers publish the same name: the family names its author.
        ['llama-3.1-8b-instruct', 'meta-llama/llama-3.1-8b-instruct'],
        ['mistral-large', 'mistralai/mistral-large'],
    ];
    for (const [id, expected] of cases) assert.equal(matchCatalogModel(id, undefined, catalog)?.canonicalModel, expected, id);
    // A label written by the relay helps when the id says nothing.
    assert.equal(matchCatalogModel('m-1024', 'GPT-4o', catalog)?.canonicalModel, 'openai/gpt-4o');
    // Unknown or unresolvable names stay unmatched instead of guessing.
    assert.equal(matchCatalogModel('totally-unknown-model', undefined, catalog), undefined);
    assert.equal(matchCatalogModel('gpt-4o', undefined, []), undefined);
    assert.equal(matchCatalogModel('', undefined, catalog), undefined);
});

test('the directory fills a kind only when the API reported none; what the API reported wins', () => {
    const banana = matchCatalogModel('nano-banana', undefined, catalog);
    assert.equal(ownModelKind({ id: 'nano-banana' }), 'llm');
    assert.equal(ownModelKind({ id: 'nano-banana' }, banana), 'image');
    assert.equal(ownModelKind({ id: 'nano-banana', outputModalities: ['text'] }, banana), 'llm');
    assert.equal(ownModelKind({ id: 'video_wan_2.5' }, matchCatalogModel('video_wan_2.5', undefined, catalog)), 'video');
});

test('numbered author releases cannot borrow the base model or its reference price', () => {
    const base = model('deepseek/deepseek-v4.1-flash', { aliases: ['deepseek-v4.1-flash-1017'], referencePrice: { input: 1, output: 2 } });
    const variant = model('deepseek/deepseek-v4.1-flash-1017', { aliases: ['deepseek-v4.1-flash'] });
    for (const name of ['DeepSeek-V4.1-Flash 1017', 'DeepSeek-V4.1-Flash1017', 'deepseek-v4.1-flash-1017', '[官方]deepseek-v4.1-flash-1017']) {
        assert.equal(matchCatalogModel(name, 'DeepSeek-V4.1-Flash', [base, variant]), variant, name);
        assert.equal(matchCatalogModel(name, 'DeepSeek-V4.1-Flash', [base]), undefined, name);
    }
    assert.equal(matchCatalogModel('deepseek-v4.1-flash', undefined, [variant]), undefined);
    for (const name of ['deepseek-v3-0324', 'deepseek-r1-0528', 'qwen3-max-0902', 'mistral-large-2512', 'mistral-small-2603']) {
        const provider = name.startsWith('deepseek') ? 'deepseek' : name.startsWith('qwen') ? 'qwen' : 'mistralai';
        const row = model(`${provider}/${name}`), unsuffixed = model(`${provider}/${name.replace(/-\d{4}$/, '')}`);
        assert.equal(matchCatalogModel(name.replace(/-(\d{4})$/, ' $1'), undefined, [unsuffixed, row]), row);
        assert.equal(matchCatalogModel(name, undefined, [unsuffixed]), undefined);
    }
});

test('Claude short names and dated relay snapshots share the same explicit version', () => {
    const opus = model('anthropic/claude-opus-5.5');
    for (const name of ['opus 5.5', 'opus5.5 1222', 'claude-opus-5.5-1222', 'opus-5-5-20261222']) {
        assert.equal(matchCatalogModel(name, undefined, [opus]), opus, name);
    }
    assert.equal(matchCatalogModel('opus5.6 1222', undefined, [opus]), undefined);
});
