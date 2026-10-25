import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CommunitySkillCard, CommunitySkillDetails, communitySkillReview } from '../lib/browser/nextmux-community-skill-card.js';
import { communitySkillText } from '../lib/browser/nextmux-community-skill-locale.js';
const require = createRequire(import.meta.url), coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const React = coreRequire('react'), { renderToStaticMarkup } = coreRequire('react-dom/server');
const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const skill = { id: 'fixture', name: '<script>Skill</script>', description: 'Description', sourceName: 'Author', repository: 'example/repo', path: 'skills/example', version: 'v2', installed: true, updateAvailable: true,
    metadata: { schemaVersion: 1, license: { status: 'declared', value: 'MIT' }, compatibility: { operatingSystems: { status: 'declared', values: ['windows', 'darwin'] }, architectures: { status: 'declared', values: ['arm64', 'x64'] } }, dependencies: { status: 'unknown', items: [] }, tools: { mode: 'restricted', allowedToolNames: ['read_file', 'write_file'] }, source: { status: 'verified', repository: 'example/repo', path: 'skills/example', revision: 'a'.repeat(40), sha256: 'b'.repeat(64) }, issues: [] },
    permissionChange: { state: 'changed', added: ['write_file'], removed: [], mayExpand: true, requiresReview: true, previousMode: 'restricted', nextMode: 'restricted', reviewToken: 'c'.repeat(64) } };
const props = { skill, locale: 'en', busy: false, blocked: false, status: '', sourceLabel: 'Source', removeLabel: 'Remove', onSource() {}, onRemove() {}, onInstall: async () => true };
const walk = element => !element || typeof element !== 'object' ? [] : [element, ...React.Children.toArray(element.props?.children).flatMap(walk)];
const button = (tree, label) => walk(tree).find(item => item.type === 'button' && item.props.children === label);

// Isolated hook/handler contract harness, not a browser or mounted React lifecycle test.
function harness(initial) {
    let current = initial; const slots = []; let index = 0;
    return { setProps(value) { current = value; }, render() {
        const pointer = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
        const previous = pointer.current; index = 0;
        pointer.current = {
            useState(initialValue) { const at = index++; if (!(at in slots)) slots[at] = initialValue; return [slots[at], value => { slots[at] = value; }]; },
            useRef(initialValue) { const at = index++; if (!(at in slots)) slots[at] = { current: initialValue }; return slots[at]; }
        };
        try { return CommunitySkillCard(current); } finally { pointer.current = previous; }
    } };
}

test('real metadata/card rendering is localized, literal, truthful about declarations and unknowns', () => {
    for (const locale of locales) {
        const html = renderToStaticMarkup(React.createElement(CommunitySkillCard, { ...props, locale }));
        for (const key of ['details', 'license', 'os', 'cpu', 'dependencies', 'source', 'boundary', 'unknown']) {
            const escaped = renderToStaticMarkup(React.createElement('span', null, communitySkillText(locale, key))).slice(6, -7);
            assert.ok(html.includes(escaped), `${locale}/${key}`);
        }
        assert.match(html, /MIT|arm64/); assert.match(html, /SHA-256/); assert.doesNotMatch(html, /<script>|undefined|checked=""/);
        assert.doesNotMatch(html, /type="checkbox"/, 'review not implicitly accepted or opened');
        if (locale === 'ar') assert.match(html, /dir="rtl"/);
    }
    const unknown = renderToStaticMarkup(React.createElement(CommunitySkillDetails, { skill: { ...skill, metadata: undefined }, locale: 'en' }));
    assert.match(unknown, /Unknown \/ undeclared/); assert.doesNotMatch(unknown, /Source hashes verified/);
});

test('review token must match the exact reviewed source snapshot and is not used for unchanged permissions', () => {
    assert.equal(communitySkillReview(skill, undefined), undefined);
    assert.equal(communitySkillReview(skill, 'old-token'), undefined);
    assert.deepEqual(communitySkillReview(skill, skill.permissionChange.reviewToken), { reviewToken: 'c'.repeat(64), permissionChangeAcknowledged: true });
    assert.equal(communitySkillReview({ ...skill, permissionChange: { ...skill.permissionChange, requiresReview: false } }, skill.permissionChange.reviewToken), undefined);
});

test('update first opens an unchecked local review; confirm locks before awaiting and carries only the reviewed token', async () => {
    const calls = []; let resolve;
    const h = harness({ ...props, onInstall: review => { calls.push(review); return new Promise(r => { resolve = r; }); } });
    button(h.render(), 'Update').props.onClick();
    let tree = h.render(), checkbox = walk(tree).find(item => item.type === 'input');
    assert.equal(checkbox.props.checked, false); assert.equal(button(tree, 'Confirm install').props.disabled, true); assert.equal(calls.length, 0);
    checkbox.props.onChange({ currentTarget: { checked: true } }); tree = h.render();
    const confirm = button(tree, 'Confirm install'); confirm.props.onClick(); confirm.props.onClick();
    assert.equal(calls.length, 1); assert.deepEqual(calls[0], { reviewToken: 'c'.repeat(64), permissionChangeAcknowledged: true });
    resolve(true); await Promise.resolve();
    assert.equal(button(h.render(), 'Confirm install'), undefined);
});

test('changed snapshot invalidates acknowledgement, cancellation never installs, failures keep review', async () => {
    let calls = 0; const base = { ...props, onInstall: async () => { calls++; return false; } }; const h = harness(base);
    button(h.render(), 'Update').props.onClick();
    walk(h.render()).find(item => item.type === 'input').props.onChange({ currentTarget: { checked: true } });
    h.setProps({ ...base, skill: { ...skill, permissionChange: { ...skill.permissionChange, reviewToken: 'd'.repeat(64) } } });
    assert.equal(button(h.render(), 'Confirm install').props.disabled, true);
    button(h.render(), 'Cancel').props.onClick(); assert.equal(calls, 0);
    button(h.render(), 'Update').props.onClick();
    walk(h.render()).find(item => item.type === 'input').props.onChange({ currentTarget: { checked: true } });
    button(h.render(), 'Confirm install').props.onClick(); await Promise.resolve();
    assert.equal(calls, 1); assert.ok(button(h.render(), 'Confirm install'));
});

test('unknown updates without a receipt cannot install; unchanged first installs do not acquire review authority', async () => {
    const calls = []; const unknown = harness({ ...props, skill: { ...skill, permissionChange: { ...skill.permissionChange, reviewToken: undefined, mayExpand: null } }, onInstall: async value => { calls.push(value); return true; } });
    button(unknown.render(), 'Update').props.onClick();
    assert.equal(button(unknown.render(), 'Confirm install').props.disabled, true); assert.equal(walk(unknown.render()).some(item => item.type === 'input'), false);
    const first = harness({ ...props, skill: { ...skill, installed: false, updateAvailable: false, permissionChange: { state: 'not_installed', requiresReview: false } }, onInstall: async value => { calls.push(value); return true; } });
    button(first.render(), 'Install').props.onClick(); await Promise.resolve(); assert.deepEqual(calls, [undefined]);
});

test('widget binds review state to immutable receipt; CSS preserves full safety text and bounded small-container layout', () => {
    const widget = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    assert.match(widget, /CommunitySkillCard key=\{`\$\{skill.id\}:\$\{skill.permissionChange\?\.reviewToken \|\| ''\}`\}/);
    assert.match(widget, /platformService.installCommunitySkill\(id, review\)/);
    const css = readFileSync(new URL('../src/browser/style/nextmux.css', import.meta.url), 'utf8');
    assert.match(css, /\.nmx-community-skill-review \{[^}]*max-height: 360px;[^}]*overflow: auto/);
    assert.match(css, /\.nmx-community-skills-list \.nmx-community-skill-details p \{[^}]*-webkit-line-clamp: unset/);
    assert.match(css, /@container \(max-width: 540px\)/);
});

test('generated descriptions follow the locale while authored descriptions remain literal', () => {
    for (const locale of locales) {
        const declared = renderToStaticMarkup(React.createElement(CommunitySkillCard, { ...props, locale, skill: { ...skill, description: '用户原文 KEEP unchanged' } }));
        assert.match(declared, /用户原文 KEEP unchanged/);
        const generated = renderToStaticMarkup(React.createElement(CommunitySkillCard, { ...props, locale,
            skill: { ...skill, description: 'RAW GENERATED DEFAULT', descriptionMessage: { code: 'SKILL_DEFAULT_DESCRIPTION', params: { name: '作者的名字' }, fallbackEnglish: 'RAW GENERATED DEFAULT' } } }));
        assert.doesNotMatch(generated, /RAW GENERATED DEFAULT/);
        assert.match(generated, /作者的名字/);
    }
});
