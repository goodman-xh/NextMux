import assert from 'node:assert/strict';
import test from 'node:test';
import { SKILL_DOMAIN_ENGLISH, SkillDomainError, skillDomainDescriptor } from '../lib/common/nextmux-skill-domain.js';
import { domainMessageFromError } from '../lib/common/nextmux-domain-errors.js';
import { skillDomainMessage } from '../lib/browser/nextmux-skill-domain-locale.js';
import { decodeSkillBytes, serializeNextMuxSkill } from '../lib/common/nextmux-skill-format.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { verifyGitHubToken } from '../lib/node/nextmux-github-tools.js';
import { githubErrorKey } from '../lib/browser/nextmux-github-account-panel.js';
import { searchStockMedia } from '../lib/node/nextmux-stock-media.js';
const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const params = { count: 3, name: '用户自己写的名字', provider: 'Pixabay', status: 503, limitBytes: 1024, limit: 24 };

test('all precise Skill, catalog, GitHub and stock reasons are localized in twelve locales, without raw details', () => {
    for (const code of Object.keys(SKILL_DOMAIN_ENGLISH)) {
        const message = skillDomainDescriptor(code, params, 'RAW PRIVATE ERROR 中文');
        for (const locale of locales) {
            const display = skillDomainMessage(locale, message);
            assert.ok(display?.trim(), `${code}/${locale}`);
            assert.doesNotMatch(display, /RAW PRIVATE ERROR|undefined|\{\w+\}/, `${code}/${locale}`);
            if (locale !== 'en') assert.notEqual(display, skillDomainMessage('en', message), `${code}/${locale} has English fallback`);
        }
    }
    for (const locale of locales) assert.ok(skillDomainMessage(locale, skillDomainDescriptor('SKILL_DEFAULT_DESCRIPTION', params)).includes(params.name));
    assert.equal(skillDomainMessage('en', { code: '__proto__', fallbackEnglish: 'raw' }), undefined);
});

test('RPC data keeps exact domain reasons and size parameters', () => {
    const error = new SkillDomainError('SKILL_BODY_TOO_LARGE', { limitBytes: 6 });
    const rpc = JSON.parse(JSON.stringify({ code: error.code, message: error.message, data: error.data }));
    assert.equal(domainMessageFromError(rpc).code, 'SKILL_BODY_TOO_LARGE');
    assert.equal(domainMessageFromError(rpc).params.limitBytes, 6);
    assert.match(skillDomainMessage('en', domainMessageFromError(rpc)), /6 bytes/);
    assert.throws(() => decodeSkillBytes(Uint8Array.of(255)), error => error.code === 'INVALID_SKILL_SOURCE' && error.data.domainError.code === 'SKILL_UTF8_INVALID');
    assert.throws(() => serializeNextMuxSkill({ name: 'bad name', description: 'desc', instructions: 'body' }), error => error.code === 'INVALID_SKILLS' && error.domainError.code === 'SKILL_NAME_INVALID');
    assert.throws(() => serializeNextMuxSkill({ name: 'sample', description: '', instructions: 'body' }), error => error.code === 'INVALID_SKILLS' && error.domainError.code === 'SKILL_DESCRIPTION_INVALID');
});

test('Skill URL failures retain compatible broad codes and distinct serialized reasons', async () => {
    const service = new NextMuxPlatformServiceImpl();
    for (const [url, code] of [['bad', 'SKILL_URL_INVALID'], ['http://github.com/a/b/tree/main/skill', 'SKILL_URL_HTTPS_REQUIRED'],
        ['https://github.com/a/b/tree/main/%zz', 'SKILL_URL_INVALID'], ['https://example.test/skill', 'SKILL_URL_UNSUPPORTED'],
        ['https://github.com/a/b/tree/main', 'SKILL_URL_TARGET_INVALID']]) {
        await assert.rejects(service.installCommunitySkillFromUrl(url), error => {
            assert.equal(error.data.domainError.code, code);
            assert.doesNotMatch(error.message, /[\u4e00-\u9fff]/);
            for (const locale of locales) assert.ok(skillDomainMessage(locale, error.data.domainError));
            return true;
        });
    }
});

test('GitHub account codes take precedence over legacy text and malformed account JSON is precise', async () => {
    assert.equal(githubErrorKey({ code: 'GITHUB_TOKEN_INVALID', message: 'network unavailable' }), 'errInvalid');
    assert.equal(githubErrorKey({ code: 'old', data: { domainError: skillDomainDescriptor('GITHUB_RATE_LIMITED') } }), 'errLimited');
    await assert.rejects(verifyGitHubToken(async () => new Response('bad json'), 'test-not-a-secret', 'classic'), error => {
        assert.equal(error.code, 'GITHUB_UNAVAILABLE');
        assert.equal(error.data.domainError.code, 'GITHUB_ACCOUNT_INVALID');
        return true;
    });
});

test('stock media preserves provider and HTTP status as parameters without retaining the credential', async () => {
    for (const [status, reason] of [[401, 'STOCK_KEY_REJECTED'], [429, 'STOCK_RATE_LIMITED'], [503, 'STOCK_HTTP_UNAVAILABLE']]) {
        await assert.rejects(searchStockMedia({ provider: 'pixabay', key: 'private-test-key', query: 'user query', kind: 'image', orientation: 'square' },
            async () => new Response('', { status })), error => {
                assert.equal(error.data.domainError.code, reason);
                assert.deepEqual(error.data.domainError.params, { provider: 'Pixabay', status });
                assert.doesNotMatch(JSON.stringify(error), /private-test-key|user query/);
                return true;
            });
    }
});
