import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { requireCopyFallback } from './copy-fallback-module.mjs';

const require = createRequire(import.meta.url);
const coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const React = coreRequire('react');
const { renderToStaticMarkup } = coreRequire('react-dom/server');
const compile = (source, values = {}) => new Function(...Object.keys(values), ts.transpile(source, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React
}))(...Object.values(values));
function loadSource(path) {
    const url = new URL(`../src/${path}.ts`, import.meta.url);
    const module = { exports: {} };
    compile(readFileSync(url, 'utf8'), { module, exports: module.exports, require: name => {
        if (name === './nextmux-copy-fallback') return requireCopyFallback(name);
        // The marketplace reads the shared 50-vote approval formula from the relay evidence module.
        if (path === 'browser/nextmux-relay-marketplace' && name === '../common/nextmux-relay-evidence') return loadSource('common/nextmux-relay-evidence');
        assert.equal(path, 'browser/nextmux-relay-picker');
        assert.equal(name, './nextmux-relay-marketplace');
        return loadSource('browser/nextmux-relay-marketplace');
    } });
    return module.exports;
}
const { filterRelayPickerSources, modelPickerEvidenceText, relayMetricSignal, relayMultiplierTag, relayMultiplierText, relayPercentText, relayMeasurementExplanation, parseRelayFavoriteMerchants, serializeRelayFavoriteMerchants } = loadSource('browser/nextmux-relay-picker');
const { relayMerchantNumber } = loadSource('browser/nextmux-relay-marketplace');
const { relayText, relayDelistedText } = loadSource('browser/nextmux-relay-locale');
const { modelCenterText } = loadSource('browser/nextmux-model-center-locale');
const { relayAvailabilityText } = loadSource('browser/nextmux-relay-marketplace-locale');
const { placeAnchoredFloatingPanel } = loadSource('browser/nextmux-floating-panel');
const evidence = loadSource('common/nextmux-relay-evidence');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const method = name => {
    const node = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
    assert.ok(node, name); return node.getText(file);
};
const storage = new Map();
const viewWindow = { innerWidth: 900, innerHeight: 760, setTimeout: () => 1, clearTimeout() {}, localStorage: { setItem: (key, value) => storage.set(key, value) } };
const Widget = compile(`class Harness { ${['relayOptionIsFull', 'relayOptions', 'relayPickerOptions', 'toggleFavoriteMerchant', 'toggleFavoriteMerchantById', 'setRelaySourceQuery', 'setRelaySortMode', 'setRelaySourceTab', 'loadNextPublicMerchantPage', 'handlePublicMerchantScroll', 'renderRelayPopover', 'renderRelayPickerPortal', 'calculateModelPickerPlacement', 'toggleComposerRelayPicker'].map(method).join('\n')} }; return Harness;`, {
    ...loadSource('common/nextmux-relay-capacity'), RelayCapacityRefresh: () => null,
    React, ReactDOM: { createPortal: element => element }, document: { body: {} },
    ImeInput: 'input', ImeTextarea: 'textarea',
    window: viewWindow,
    filterRelayPickerSources, relayMetricSignal, relayMultiplierTag, relayMultiplierText, relayPercentText, relayMeasurementExplanation, serializeRelayFavoriteMerchants, RELAY_FAVORITES_STORAGE_KEY: 'nextmux.desktop.favoriteMerchants.v1', relayText, relayDelistedText, relayMerchantNumber, placeAnchoredFloatingPanel, ...evidence,
    ...require('../lib/browser/nextmux-offering-price.js'),
    FavoriteHeartIcon: require('../lib/browser/nextmux-favorite-icon.js').FavoriteHeartIcon,
    modelUsageText: (_locale, key) => key, modelCenterText,
    relayAvailabilityText, relayEvidenceText: () => 'Unmeasured', localizeDesktopSurface: (_locale, text) => text,
    managedRelayKey: id => `managed:${id}`, officialConnectionRelayKey: id => `official:${id}`,
    officialInvokableModelIds: connection => [connection.model]
});
const options = [
    { key: 'auto', kind: 'automatic', label: 'Automatic' },
    { key: 'managed:merchant-a', kind: 'managed', label: 'Atlas 世界', merchantId: 'merchant-a', publicCode: 'RLY-0000000000000001' },
    { key: 'managed:merchant-b', kind: 'managed', label: 'Atlas 世界', merchantId: 'merchant-b', publicCode: 'RLY-0000000000000002' },
    { key: 'official:key-one', kind: 'official', label: 'Official API', detail: 'Provider · key-one' },
    { key: 'official:key-two', kind: 'official', label: 'Custom API', detail: 'Compatible · key-two' }
];

test('composer names a custom API without inferring official status from its transport kind', () => {
    let quality, button;
    const walk = node => {
        if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'liveQualityLabel') quality = node.initializer;
        if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute)
            && attribute.name.getText(file) === 'data-relay-trigger' && attribute.initializer?.text === 'composer')) button = node;
        ts.forEachChild(node, walk);
    };
    walk(widget.members.find(node => node.name?.getText(file) === 'renderCodingWorkbench'));
    assert.ok(quality); assert.ok(button);
    const route = { kind: 'official_connection', connection: { label: 'Zeekai · 验收' } };
    const suffix = compile(`return (${quality.getText(file)});`, { route, routeDepthOption: undefined, selectedOffering: undefined });
    assert.equal(suffix, '', 'the shared BYOK transport does not establish official provider ownership');
    const markup = renderToStaticMarkup(compile(`return (function () { return (${button.getText(file)}); }).call({ codingPopover: '', desktopLocale: 'zh-CN' });`, {
        React, composerRelay: { label: route.connection.label, kind: 'official' }, composerRelayUnavailable: false,
        councilActiveOrPending: false, councilConfig: undefined,
        localizeDesktopSurface: (_locale, text) => text, relayText, relayDelistedText
    }));
    assert.match(markup, /aria-label="选择中转商或自有 API：Zeekai · 验收"/);
    assert.match(markup, /<span>Zeekai · 验收<\/span>/);
});

function fixture() {
    const instance = new Widget();
    Object.assign(instance, { activeSection: 'coding', activeRelayKey: 'managed:merchant-a', relaySourceTab: 'merchant',
        relaySourceQuery: '', relaySortMode: 'quality', desktopLocale: 'en', updates: 0,
        favoriteMerchantLabels: new Map(),
        publicMerchantPage: { merchants: options.filter(option => option.merchantId).map(option => ({ id: option.merchantId, name: option.label })) },
        favoriteMerchantPage: { merchants: options.filter(option => option.merchantId).map(option => ({ id: option.merchantId, name: option.label })) },
        publicMerchantPageRequest: 0, loadPublicMerchantPage() {}, tx: key => key,
        update() { this.updates++; }, relayOptions: () => options, relayOption: () => options[1], resolvedDesktopTheme: () => 'dark',
        selectRelay() { throw new Error('Browsing must not select a route'); },
        selectSection() { throw new Error('Picker must not navigate to model center'); } });
    return instance;
}
function* elements(value) {
    if (Array.isArray(value)) { for (const entry of value) yield* elements(entry); return; }
    if (!React.isValidElement(value)) return;
    yield value; yield* elements(value.props.children);
}
test('source tabs separate platform routes from both official and custom connections without merging names', () => {
    assert.deepEqual(filterRelayPickerSources(options, 'merchant', '').map(item => item.key), ['auto', 'managed:merchant-a', 'managed:merchant-b']);
    assert.deepEqual(filterRelayPickerSources(options, 'my-api', '').map(item => item.key), ['official:key-one', 'official:key-two']);
    assert.deepEqual(filterRelayPickerSources(options, 'favorite', '', new Set(['merchant-b'])).map(item => item.key), ['managed:merchant-b']);
    assert.equal(filterRelayPickerSources(options, 'merchant', '')[1], options[1]);
});
test('search matches names, stable merchant IDs, public merchant numbers and connection IDs within the chosen tab', () => {
    for (const query of [' MERCHANT-A ', options[1].publicCode.toLowerCase()]) {
        assert.deepEqual(filterRelayPickerSources(options, 'merchant', query).map(item => item.key), ['managed:merchant-a']);
    }
    assert.equal(filterRelayPickerSources(options, 'merchant', 'ＡＴＬＡＳ').length, 2);
    assert.equal(filterRelayPickerSources(options, 'merchant', '世界').length, 2);
    assert.equal(filterRelayPickerSources(options, 'merchant', 'key-one').length, 0);
    assert.equal(filterRelayPickerSources(options, 'my-api', 'key-two')[0], options[4]);
    assert.equal(filterRelayPickerSources(options, 'merchant', 'no-such-name').length, 0);
});
test('real tab/search/sort handlers update the view without changing the selected route or selecting a model', () => {
    const instance = fixture();
    const initial = instance.activeRelayKey;
    let tree = [...elements(instance.renderRelayPopover())];
    tree.find(node => node.props['data-relay-source-tab'] === 'my-api').props.onClick();
    assert.equal(instance.relaySourceTab, 'my-api');
    tree = [...elements(instance.renderRelayPopover())];
    tree.find(node => node.type === 'input').props.onChange({ currentTarget: { value: 'key-two' } });
    assert.equal(instance.relaySourceQuery, 'key-two');
    tree = [...elements(instance.renderRelayPopover())];
    assert.deepEqual(tree.filter(node => node.props['data-relay-key']).map(node => node.props['data-relay-key']), ['official:key-two']);
    tree.find(node => node.props['data-relay-source-tab'] === 'merchant').props.onClick();
    tree = [...elements(instance.renderRelayPopover())];
    tree.find(node => node.props['data-relay-sort'] === 'latency').props.onClick();
    assert.equal(instance.relaySortMode, 'latency');
    assert.equal(storage.get('nextmux.desktop.relaySort.v1'), 'latency');
    assert.equal(instance.activeRelayKey, initial);
    assert.equal(instance.updates, 4);
});
test('keyboard tabs use roving focus and switching tabs clears only the local search', () => {
    const instance = fixture(); instance.relaySourceQuery = 'old filter';
    const merchant = [...elements(instance.renderRelayPopover())].find(node => node.props['data-relay-source-tab'] === 'merchant');
    let prevented = 0, focused = '';
    merchant.props.onKeyDown({ key: 'ArrowRight', preventDefault() { prevented++; }, currentTarget: {
        parentElement: { querySelector(selector) { return { focus() { focused = selector; } }; } }
    } });
    assert.equal(prevented, 1); assert.match(focused, /favorite/);
    assert.equal(instance.relaySourceTab, 'favorite'); assert.equal(instance.relaySourceQuery, '');
    const tabs = [...elements(instance.renderRelayPopover())].filter(node => node.props.role === 'tab');
    assert.deepEqual(tabs.map(tab => tab.props.tabIndex), [-1, 0, -1]);
});
test('actual relay metrics reorder options in all four modes, preserving the automatic entry and unknown latency last', () => {
    const instance = fixture(); delete instance.relayOptions;
    const row = (id, quality, authenticity, latency, multiplier) => ({ merchantId: id, providerName: id, routeScore: 99, likes: quality, dislikes: 100 - quality,
        network: { availability: 1, sampleCount: 1, lastLatencyMs: latency }, fidelity: { index: authenticity, sampleCount: 3 }, multiplierBps: multiplier, registryModelId: 'same-model' });
    instance.managedOfferings = () => [row('a', 10, 100, 30, 30000), row('b', 20, 80, undefined, 10000), row('c', 30, 90, 0, 20000)];
    instance.publicMerchantPage = { merchants: ['a', 'b', 'c'].map(id => ({ id, name: id })) };
    instance.offeringMerchantId = row => row.merchantId; instance.officialModels = { connections: [] };
    const expected = { quality: ['c', 'b', 'a'], authenticity: ['a', 'c', 'b'], latency: ['c', 'a', 'b'], price: ['b', 'c', 'a'] };
    for (const [mode, order] of Object.entries(expected)) {
        instance.setRelaySortMode(mode);
        const rows = instance.relayOptions();
        assert.equal(rows[0].key, 'auto'); assert.deepEqual(rows.slice(1).map(row => row.merchantId), order);
    }
});
test('real rendering exposes selected sorting, three localized source tabs, search and in-place empty state across twelve locales', () => {
    const instance = fixture();
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        instance.desktopLocale = locale;
        const html = renderToStaticMarkup(instance.renderRelayPopover());
        for (const key of ['merchantSources', 'favoriteSources', 'myApiSources', 'searchSources', 'sourceTabs']) assert.ok(html.includes(relayText(locale, key)));
        const tree = [...elements(instance.renderRelayPopover())];
        const sortButtons = tree.filter(node => node.props['data-relay-sort']);
        assert.equal(sortButtons.filter(node => node.props['aria-pressed']).length, 1);
        assert.equal(sortButtons.filter(node => !node.props['aria-pressed']).length, 3);
        assert.equal((html.match(/role="tab"/g) || []).length, 3);
    }
    instance.relaySourceQuery = 'not found';
    instance.publicMerchantPage = { merchants: [] };
    const empty = renderToStaticMarkup(instance.renderRelayPopover());
    assert.ok(empty.includes(relayText(instance.desktopLocale, 'noMatchingSources')));
    assert.ok(!empty.includes(relayText(instance.desktopLocale, 'openModelCenter')));
});
test('relay drawer keeps a usable minimum height and grows for longer directories', () => {
    const instance = fixture(); instance.codingPopover = 'routes'; instance.modelPickerRelayOpen = true;
    const requests = [];
    instance.calculateModelPickerPlacement = (height, width) => { requests.push([height, width]); return { top: 50, left: 10, width, height: 450, maxHeight: 450 }; };
    for (const [count, loading, more, tab] of [[2, false, false, 'merchant'], [18, false, false, 'merchant'],
        [0, true, false, 'merchant'], [2, false, true, 'merchant'], [2, false, false, 'my-api'],
        [2, false, true, 'favorite'], [2, false, true, 'my-api']]) {
        instance.relayPickerOptions = () => Array(count).fill(options[1]);
        instance.publicMerchantPageLoading = loading;
        instance.publicMerchantPage.nextCursor = more ? 'next' : undefined;
        instance.relaySourceTab = tab;
        const tree = [...elements(instance.renderRelayPickerPortal())];
        const panel = tree.find(node => node.props.className?.includes('nmx-composer-popover'));
        assert.equal(panel.props.style.height, '450px');
    }
    assert.ok(requests.every(([, width]) => width === 264), 'source drawer matches the original narrow model picker width');
    const shortHeight = requests[0][0];
    assert.equal(shortHeight, 300, 'short directories retain the restored minimum drawer height');
    assert.equal(requests[1][0], 132 + 18 * 32, 'long directories include every row and merchant chrome');
    assert.equal(requests[2][0], shortHeight, 'initial loading fits within the restored drawer height');
    assert.equal(requests[3][0], shortHeight, 'load-more fits within the restored drawer height');
    assert.equal(requests[4][0], shortHeight, 'source tabs share the restored minimum height');
    assert.equal(requests[5][0], requests[4][0], 'a directory next cursor must not add an empty favorite footer');
    assert.equal(requests[6][0], requests[4][0], 'a directory next cursor must not add an empty personal API footer');
});
test('actual relay placement stays inside short, narrow and tall viewports and above an open terminal, regardless of result count', () => {
    for (const [width, height, terminalTop] of [[900, 760], [320, 260], [220, 360], [320, 900], [640, 360, 240]]) {
        viewWindow.innerWidth = width; viewWindow.innerHeight = height;
        const instance = fixture(); instance.codingPopover = 'routes'; instance.modelPickerRelayOpen = true;
        instance.terminalDrawerOpen = terminalTop !== undefined;
        const triggerTop = (terminalTop ?? height) - 65;
        instance.node = { querySelector(selector) {
            const rect = selector === '.nmx-composer-relay-button' ? { top: triggerTop, bottom: triggerTop + 32, left: width - 140, right: width - 16 }
                : selector === '.nmx-titlebar-primary-nav' ? { bottom: 40 }
                    : selector === '.nmx-coding-topbar' ? { bottom: 60 }
                        : selector === '.nmx-terminal-drawer.is-open' ? { top: terminalTop } : undefined;
            return rect && { getBoundingClientRect: () => rect };
        } };
        for (const count of [0, 1, 18, 100]) {
            for (const visibleCount of [count, 0]) {
                instance.relayPickerOptions = () => Array.from({ length: visibleCount }, (_, index) => ({ ...options[1], key: `managed:${index}` }));
                const panel = [...elements(instance.renderRelayPickerPortal())].find(node => node.props.className?.includes('nmx-composer-popover'));
                const numeric = key => parseFloat(panel.props.style[key]);
                assert.ok(numeric('top') >= 66, 'titlebar and workspace toolbar remain clear');
                assert.ok(numeric('left') >= 8); assert.ok(numeric('left') + numeric('width') <= width - 8);
                assert.ok(numeric('top') + numeric('height') <= (terminalTop ?? height) - 8);
                assert.ok(numeric('height') <= numeric('maxHeight'));
                if (visibleCount <= 2) assert.ok(numeric('height') <= 300, 'short/empty directory keeps its restored height within viewport bounds');
                if (visibleCount >= 100) assert.equal(numeric('height'), numeric('maxHeight'), 'large directory fills available height');
            }
        }
    }
});
test('merchant rows keep IDs in name tooltips, one compact row, with no invented personal API metrics', () => {
    const instance = fixture();
    let tree = [...elements(instance.renderRelayPopover())];
    const names = tree.filter(node => node.props.className === 'nmx-relay-option-name');
    assert.equal(names.length, 2);
    for (const [index, id] of ['merchant-a', 'merchant-b'].entries()) {
        // Two stores share the name "Atlas 世界": the public number tells them apart, the intro (or its placeholder) follows.
        assert.equal(names[index].props['aria-label'], `Atlas 世界\n${options[index + 1].publicCode}\n${modelCenterText('en', 'noStoreIntro')}`);
        assert.ok(!names[index].props['aria-label'].includes(id));
    }
    assert.equal(tree.filter(node => node.type === 'small' || node.type === 'code' || node.type === 'br').length, 1, 'only hidden popup header subtitle, not per-merchant multiline metadata');
    instance.setRelaySourceTab('my-api'); tree = [...elements(instance.renderRelayPopover())];
    assert.equal(tree.filter(node => node.props['data-relay-sort']).length, 0);
    // An own API is listed like a relay: its authenticity and measured speed, never quality or multiplier dials (it has no market score), and no model count.
    const own = tree.filter(node => node.props.className === 'nmx-relay-option-metrics is-own');
    assert.equal(own.length, 2);
    assert.deepEqual(own.map(row => [...elements(row)].filter(node => node.props['data-relay-metric']).map(node => node.props['data-relay-metric'])), [['authenticity', 'latency'], ['authenticity', 'latency']]);
    assert.equal(tree.filter(node => node.props.className?.includes('nmx-relay-merchant-id')).length, 0);
    assert.ok(!renderToStaticMarkup(instance.renderRelayPopover()).includes(relayText('en', 'modelCount', { count: 1 }).replace('1', '')), 'no model count');
});

test('loading or not-yet-requested directories show a spinner without flashing an empty merchant state', () => {
    const instance = fixture();
    for (const loading of [false, true]) {
        instance.publicMerchantPage = undefined;
        instance.publicMerchantPageLoading = loading;
        const html = renderToStaticMarkup(instance.renderRelayPopover());
        assert.match(html, /codicon-loading codicon-modifier-spin/);
        assert.ok(html.includes(relayText('en', 'directoryLoading')));
        assert.ok(!html.includes(relayText('en', 'noRelay')));
    }
    instance.publicMerchantPage = { merchants: [] }; instance.publicMerchantPageLoading = false;
    assert.ok(renderToStaticMarkup(instance.renderRelayPopover()).includes(relayText('en', 'noRelay')));
});

test('every source row uses four status dials with exact values in accessible tooltips', () => {
    const instance = fixture();
    instance.relayOptions = () => [{ ...options[1], directoryOnly: true, quality: 0, authenticity: 0, latencyMs: 0, multiplierBps: 0 }];
    const tree = [...elements(instance.renderRelayPopover())];
    const metrics = tree.find(node => node.props.className === 'nmx-relay-option-metrics');
    const signals = [...elements(metrics)].filter(node => node.props['data-relay-metric']);
    assert.deepEqual([...elements(metrics)].filter(node => node.props['data-relay-metric']).map(node => node.props['aria-label']), ['Quality: 0%', 'Authenticity: 0%', 'Latency: 0 ms', 'Avg. multiplier: 0']);
    assert.deepEqual(signals.map(node => node.props['data-signal-level']), [1, 1, 5, 5]);
    for (const signal of signals) {
        assert.equal(signal.props.title, undefined, 'only one custom tooltip, no browser title bubble');
        const children = [...elements(signal)];
        assert.equal(children.filter(child => child.type === 'svg').length, 1);
        assert.equal(children.filter(child => child.type === 'i').length, 1, 'one meaningful metric glyph, not old signal bars');
        assert.equal(children.filter(child => child.type === 'circle').length, 2);
        assert.equal(children.find(child => child.props.className === 'nmx-relay-dial-value').props.strokeDasharray, `${signal.props['data-signal-level'] * 20} 100`);
    }
    assert.equal([...elements(metrics)].filter(node => node.type === 'b').length, 0, 'precision belongs in the tooltip, not clipped numbers');
    instance.relayOptions = () => [{ ...options[1], directoryOnly: true }];
    const unknown = [...elements(instance.renderRelayPopover())].find(node => node.props.className === 'nmx-relay-option-metrics');
    assert.deepEqual([...elements(unknown)].filter(node => node.props['data-relay-metric']).map(node => node.props['aria-label']), ['Quality: No measurement data yet', 'Authenticity: No authenticity data yet: measured when a model is listed, then from everyday use', 'Latency: No measurement data yet', 'Avg. multiplier: —']);
    const unknownDials = [...elements(unknown)].filter(node => node.props['data-relay-metric']);
    assert.equal(unknownDials.length, 4);
    assert.ok(unknownDials.every(node => node.props['data-signal-level'] === 0 && node.props.className.includes('is-unknown')));
    assert.ok(unknownDials.every(node => [...elements(node)].filter(child => child.type === 'circle').length === 1), 'unknown shows only the empty track');
    instance.relayPickerOptions = () => [{ ...options[1], directoryOnly: true, directoryStatus: 'unknown' }];
    const unverifiedRow = [...elements(instance.renderRelayPopover())].find(node => node.props.className?.includes('nmx-relay-option-row'));
    assert.ok(unverifiedRow.props.className.includes('is-unknown'));
    const unverifiedButton = [...elements(unverifiedRow)].find(node => node.props['data-relay-key']);
    assert.equal(unverifiedButton.props.disabled, true);
    assert.match(unverifiedButton.props['aria-label'], /Public directory unavailable/);
    instance.relayPickerOptions = () => [{ ...options[1], directoryOnly: true, directoryStatus: 'unavailable' }];
    const unavailableRow = [...elements(instance.renderRelayPopover())].find(node => node.props.className?.includes('nmx-relay-option-row'));
    assert.ok(unavailableRow.props.className.includes('is-unavailable'));
    delete instance.relayPickerOptions;
    for (const tab of ['merchant', 'favorite', 'my-api']) {
        instance.relaySourceTab = tab; instance.favoriteMerchantLabels.set('merchant-a', 'Atlas 世界');
        instance.relayOptions = () => [{ ...options[1], multiplierBps: 250 }, { ...options[3], latencyMs: 125 }];
        if (tab === 'my-api') {
            const own = [...elements(instance.renderRelayPopover())].filter(node => node.props.className === 'nmx-relay-option-metrics is-own');
            assert.equal(own.length, 1);
            assert.deepEqual([...elements(own[0])].filter(node => node.props['data-relay-metric']).map(node => node.props['data-relay-metric']), ['authenticity', 'latency']);
            continue;
        }
        const rows = [...elements(instance.renderRelayPopover())].filter(node => node.props.className === 'nmx-relay-option-metrics');
        assert.equal(rows.length, 1);
        assert.equal([...elements(rows[0])].filter(node => node.props['data-relay-metric']).length, 4);
        assert.equal([...elements(rows[0])].filter(node => node.type === 'svg').length, 4);
        assert.ok([...elements(rows[0])].find(node => node.props['data-relay-metric'] === 'price').props['aria-label'].includes('0.03'));
    }
});
test('auto-best is omitted from the merchant drawer; a merchant nobody has rated shows its initial 100%, labelled as initial', () => {
    const instance = fixture(); instance.relayPickerOptions = () => [options[0], { ...options[1], quality: 100, qualityInitial: true }];
    const rows = [...elements(instance.renderRelayPopover())].filter(node => node.props.className?.includes('nmx-relay-option-select'));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].props['data-relay-key'], options[1].key);
    assert.ok(!rows[0].props.className.includes('is-automatic'));
    const quality = [...elements(rows[0])].find(node => node.props['data-relay-metric'] === 'quality');
    // A newly listed store starts at 100% (the platform directory ranks it so too); the tooltip says no one has voted yet.
    assert.equal(quality.props['data-signal-level'], relayMetricSignal('quality', 100).level);
    assert.doesNotMatch(quality.props.className, /is-unknown/);
    assert.equal([...elements(quality)].find(node => node.props.className === 'nmx-relay-metric-value').props.children, '100%');
    assert.ok(quality.props['aria-label'].endsWith(modelCenterText('en', 'initialRating')), quality.props['aria-label']);
    assert.equal(options[1].quality, undefined, 'the fixture itself is not rewritten');
    quality.props.onPointerEnter({ currentTarget: { getBoundingClientRect: () => ({ left: 20, bottom: 100 }) } });
    assert.equal(instance.relayMetricTooltip.text, quality.props['aria-label']);
});

test('all four comparison bands preserve invalid values as unknown and show multipliers with at most two decimals', () => {
    for (const kind of ['quality', 'availability', 'latency', 'price']) {
        for (const value of [undefined, null, NaN, Infinity, -Infinity, -1, '0']) assert.deepEqual(relayMetricSignal(kind, value), { level: 0, tone: 'unknown' });
    }
    assert.deepEqual(relayMetricSignal('quality', 101), { level: 0, tone: 'unknown' });
    assert.deepEqual(relayMetricSignal('availability', 1.01), { level: 0, tone: 'unknown' });
    assert.deepEqual(relayMetricSignal('latency', Number.MAX_SAFE_INTEGER + 1), { level: 0, tone: 'unknown' });
    assert.deepEqual(relayMetricSignal('price', Number.MAX_SAFE_INTEGER + 1), { level: 0, tone: 'unknown' });
    assert.deepEqual(relayMetricSignal('price', .5), { level: 0, tone: 'unknown' });
    for (const [kind, values] of Object.entries({ quality: [0, 40, 60, 75, 90], availability: [0, .75, .9, .97, .99] })) {
        assert.deepEqual(values.map(value => relayMetricSignal(kind, value).level), [1, 2, 3, 4, 5]);
        assert.deepEqual(values.map(value => relayMetricSignal(kind, value).tone), ['poor', 'poor', 'medium', 'good', 'good']);
    }
    // Display keeps at most two decimals (billing keeps every basis point); a paid quote never reads "0".
    assert.equal(relayMultiplierText('en', 6_666), '0.67');
    assert.equal(relayMultiplierText('en', 1_450), '0.15', 'a half rounds up, unlike (0.145).toFixed(2)');
    assert.equal(relayMultiplierText('en', 250), '0.03');
    assert.equal(relayMultiplierText('en', 12_500), '1.25');
    assert.equal(relayMultiplierText('en', 10_000), '1');
    assert.equal(relayMultiplierText('en', 50), '0.01');
    assert.equal(relayMultiplierText('en', 49), '<0.01');
    assert.equal(relayMultiplierText('en', 1), '<0.01');
    assert.equal(relayMultiplierText('en', 0), '0');
    assert.equal(relayMultiplierText('de', 250), '0,03');
    assert.equal(relayMultiplierText('de', 1), '<0,01');
    assert.equal(relayMultiplierText('en', undefined), '—');
});

test('metric thresholds have explicit inclusive boundaries and correctly reverse latency and multiplier direction', () => {
    const thresholds = { quality: [40, 60, 75, 90], availability: [.75, .9, .97, .99], latency: [500, 1000, 2000, 4000], price: [5000, 10000, 15000, 20000] };
    for (const [kind, boundaries] of Object.entries(thresholds)) {
        const ascendingGood = kind === 'quality' || kind === 'availability';
        const step = kind === 'availability' ? .0001 : kind === 'price' ? 1 : .01;
        for (const [index, threshold] of boundaries.entries()) {
            const before = relayMetricSignal(kind, threshold - step).level;
            const at = relayMetricSignal(kind, threshold).level;
            const after = relayMetricSignal(kind, threshold + step).level;
            assert.deepEqual([before, at, after], ascendingGood ? [index + 1, index + 2, index + 2] : [5 - index, 5 - index, 4 - index], `${kind}: ${threshold}`);
        }
        const values = [0, ...boundaries, boundaries.at(-1) + step];
        const levels = values.map(value => relayMetricSignal(kind, value).level);
        assert.ok(levels.every((value, index) => index === 0 || (ascendingGood ? value >= levels[index - 1] : value <= levels[index - 1])), `${kind}: monotonic in the correct direction`);
        assert.equal(relayMetricSignal(kind, 0).level, ascendingGood ? 1 : 5, `${kind}: measured zero is not unknown`);
    }
    for (const [value, level] of [[0, 5], [250, 5], [5000, 5], [10000, 4], [15000, 3], [20000, 2], [20001, 1]])
        assert.equal(relayMetricSignal('price', value).level, level);
});

test('pointer and keyboard metric tooltips are portaled out of the scroll clip and clear on scrolling', () => {
    const instance = fixture();
    instance.relayOptions = () => [{ ...options[1], quality: 90, authenticity: 97, latencyMs: 500, multiplierBps: 10000 }];
    const anchor = { getBoundingClientRect: () => ({ left: 40, bottom: 200 }) };
    const row = [...elements(instance.renderRelayPopover())].find(node => node.props['data-relay-key']);
    row.props.onFocus({ currentTarget: anchor });
    let tooltip = [...elements(instance.renderRelayPopover())].find(node => node.props.role === 'tooltip');
    assert.match(tooltip.props.children, /Quality: 90%\nAuthenticity: 97%\nLatency: 500 ms\nAvg\. multiplier: 1/);
    const latency = [...elements(instance.renderRelayPopover())].find(node => node.props['data-relay-metric'] === 'latency');
    latency.props.onPointerEnter({ currentTarget: anchor });
    tooltip = [...elements(instance.renderRelayPopover())].find(node => node.props.role === 'tooltip');
    assert.equal(tooltip.props.children, 'Latency: 500 ms');
    instance.handlePublicMerchantScroll({ currentTarget: { scrollHeight: 600, scrollTop: 50, clientHeight: 300 } });
    assert.equal(instance.relayMetricTooltip, undefined);
});

test('model evidence labels cover all app languages and never claim discovered means verified', () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        for (const key of ['authenticity', 'listingPending']) {
            assert.ok(modelPickerEvidenceText(locale, key));
            if (locale !== 'en') assert.notEqual(modelPickerEvidenceText(locale, key), modelPickerEvidenceText('en', key));
        }
    }
    const render = method('renderCodingWorkbench');
    assert.doesNotMatch(render, /const priceLabel|formatOfferingPrice\(quotedOffering\)/);
    assert.match(render, /onFocus=\{event => this\.openModelEffortPicker/);
    assert.match(render, /className='nmx-model-evidence'/);
    assert.match(render, /if \(!supported\) return;/);
});
test('opening the picker starts on the current source type without changing routing; browsing tabs is not remembered as routing', () => {
    const instance = fixture(); instance.activeRelayKey = 'official:key-one'; instance.codingPopover = '';
    instance.clearNavigationSurfaces = () => {}; instance.rememberNavigation = () => {};
    instance.toggleComposerRelayPicker();
    assert.equal(instance.relaySourceTab, 'my-api'); assert.equal(instance.activeRelayKey, 'official:key-one');
    instance.setRelaySourceTab('merchant'); assert.equal(instance.activeRelayKey, 'official:key-one');
});
test('merchant favorites persist locally, filter independently, and can be removed without selecting a route', () => {
    const instance = fixture();
    const merchant = options[2];
    instance.toggleFavoriteMerchant(merchant);
    assert.deepEqual([...instance.favoriteMerchantLabels], [['merchant-b', 'Atlas 世界']]);
    assert.deepEqual(parseRelayFavoriteMerchants(storage.get('nextmux.desktop.favoriteMerchants.v1')), instance.favoriteMerchantLabels);
    instance.setRelaySourceTab('favorite');
    assert.deepEqual(instance.relayPickerOptions().map(option => option.key), ['managed:merchant-b']);
    const favorite = [...elements(instance.renderRelayPopover())].find(node => node.props['data-relay-favorite'] === 'merchant-b');
    assert.equal(favorite.props['aria-pressed'], true);
    favorite.props.onClick();
    assert.equal(instance.favoriteMerchantLabels.size, 0);
    assert.equal(instance.activeRelayKey, 'managed:merchant-a');
});
test('merchant directory appends vertically near the scroll edge without page-arrow navigation', () => {
    const instance = fixture(); let loads = 0;
    instance.publicMerchantPage = { merchants: [], nextCursor: 'merchant-next' };
    instance.loadPublicMerchantPage = query => { loads++; assert.deepEqual(query, { after: 'merchant-next' }); };
    instance.handlePublicMerchantScroll({ currentTarget: { scrollHeight: 500, scrollTop: 300, clientHeight: 140 } });
    assert.equal(loads, 1);
    instance.handlePublicMerchantScroll({ currentTarget: { scrollHeight: 500, scrollTop: 100, clientHeight: 140 } });
    assert.equal(loads, 1);
    const markup = renderToStaticMarkup(instance.renderRelayPopover());
    assert.doesNotMatch(markup, /codicon-chevron-left|codicon-chevron-right/);
});
test('picker styles retain theme tokens, explicit hover/focus, fixed controls and independently scrolling results', () => {
    const css = readFileSync(new URL('../src/browser/style/nextmux.css', import.meta.url), 'utf8');
    assert.match(css, /\.nmx-relay-sort button\.is-active\s*\{[^}]*box-shadow:/);
    assert.match(css, /\.nmx-relay-sort button:hover,[\s\S]*?background: var\(--nmx-hover\)/);
    assert.match(css, /\.nmx-relay-sort button:focus-visible,[\s\S]*?outline: 2px solid var\(--nmx-focus-ring\)/);
    assert.match(css, /\.nmx-relay-sort button::after\s*\{[^}]*content: attr\(data-tooltip\);[^}]*visibility: hidden/);
    assert.match(css, /\.nmx-relay-sort button:hover::after,[\s\S]*?visibility: visible/);
    assert.match(css, /\.nmx-relay-source-tabs\s*\{[^}]*grid-template-columns: repeat\(3/);
    assert.match(css, /\.nmx-relay-source-search > input\s*\{[^}]*min-width: 0/);
    assert.match(css, /\.nmx-model-picker-relay-view \.nmx-relay-options\s*\{[^}]*min-height: 0;[^}]*flex: 1 1 auto/);
    assert.match(css, /\.nmx-model-picker-relay-view \.nmx-relay-option-select\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) 120px/);
    assert.match(css, /\.nmx-model-picker-relay-view \.nmx-relay-option-metrics > \.nmx-relay-metric-dial\s*\{[^}]*width: 24px;[^}]*height: 24px/);
    assert.match(css, /\.nmx-model-picker-relay-view \.nmx-relay-option-metrics\s*\{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
    assert.match(css, /\.nmx-model-picker-relay-view \.nmx-relay-favorite\s*\{[^}]*right: auto;[^}]*inset-inline-end: 0;/);
    assert.match(css, /\.nmx-relay-favorite\s*\{[^}]*position: absolute/);
    assert.match(css, /\.nmx-composer \.nmx-composer-relay-button\s*\{[^}]*min-width: min\(156px, 34cqw\);[^}]*max-width: min\(190px, 34cqw\);[^}]*flex-shrink: 0/);
    assert.match(css, /@container nmx-composer-width \(max-width: 440px\)\s*\{[\s\S]*?\.nmx-composer \.nmx-composer-relay-button\s*\{[^}]*width: 31px;[^}]*min-width: 31px/);
    assert.match(css, /\.nmx-official-sheet > header > div > span\s*\{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere/);
});

test('decision models (Jev) are a tool, never offered as a chat or creative model', async () => {
    const { isDecisionModel } = await import('../lib/common/nextmux-decision-models.js');
    for (const id of ['typesafe/jev-1.13', '~typesafe/jev-latest', 'somerelay/jev-1.13', 'jev', 'jaredpalmer/kev-4b', 'respan/span-01']) assert.equal(isDecisionModel(id), true, id);
    // Jev Router picks a chat model for each request: it chats, so it is an ordinary model.
    for (const id of ['typesafe/jev-router', 'openai/gpt-6-astra', 'anthropic/claude-opus-5.5', 'acme/jevons-7b', 'google/gemini-3.1-pro-preview']) assert.equal(isDecisionModel(id), false, id);
    // Confirmed exact identities override bad directory metadata; unknown names follow declared output.
    assert.equal(isDecisionModel('acme/fast-chooser', ['decisions']), true);
    assert.equal(isDecisionModel('typesafe/jev-1.13', ['text']), true);
    assert.equal(isDecisionModel('vendor/jev-9', ['text']), false);
});

test('a relay row the pointer or focus rests on reads its first model page once, so 选择模型 opens from memory', async () => {
    const timers = new Map();
    let timerId = 0;
    const clock = { setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; }, clearTimeout(id) { timers.delete(id); } };
    const fire = () => { const due = [...timers.values()]; timers.clear(); for (const timer of due) timer.callback(); };
    const settle = async () => { for (let index = 0; index < 6; index++) await new Promise(resolve => setImmediate(resolve)); };
    const Preloader = compile(`class Harness { ${['preloadMerchantCatalogSnapshot', 'scheduleMerchantCatalogPreload', 'cancelMerchantCatalogPreload'].map(method).join('\n')} }; return Harness;`,
        { window: clock, managedRelayKey: id => `managed:${id}` });
    const reads = [], pending = new Map();
    const page = (merchantId, extra = {}) => ({ merchantId, online: true, offerings: [{ id: `${merchantId}-1`, merchantId }], ...extra });
    const preloader = Object.assign(new Preloader(), {
        isDisposed: false, activeRelayKey: 'managed:active', platformSession: { linked: true, user: { id: 'owner' } }, catalogSnapshotRevision: 1,
        catalogRemovedMerchants: new Set(), merchantPickerSnapshots: new Map(), merchantCatalogPreloads: new Map(),
        merchantCatalogPreloadTimer: 0, merchantCatalogPreloadIntent: '', offeringMerchantId: offering => offering.merchantId,
        platformService: { getMerchantCatalog: merchantId => { reads.push(merchantId); return new Promise(resolve => pending.set(merchantId, resolve)); } }
    });

    // Sweeping across rows reads nothing; a row someone rests on is read once, after a short intent delay.
    preloader.scheduleMerchantCatalogPreload('swept');
    preloader.cancelMerchantCatalogPreload('swept');
    preloader.scheduleMerchantCatalogPreload('rested');
    preloader.scheduleMerchantCatalogPreload('rested');
    assert.deepEqual([...timers.values()].map(timer => timer.delay), [150]);
    fire(); await settle();
    assert.deepEqual(reads, ['rested']);
    pending.get('rested')(page('rested')); await settle();
    assert.equal(preloader.merchantPickerSnapshots.get('rested').catalog.merchantId, 'rested');
    assert.equal(preloader.merchantCatalogPreloads.size, 0, 'a settled read is released');

    // A fresh snapshot, the active relay (it has its own loader), a removed merchant and a second read of one merchant are skipped.
    for (const id of ['rested', 'active']) preloader.preloadMerchantCatalogSnapshot(id);
    preloader.catalogRemovedMerchants.add('removed'); preloader.preloadMerchantCatalogSnapshot('removed');
    preloader.preloadMerchantCatalogSnapshot('c'); preloader.preloadMerchantCatalogSnapshot('c');
    // Two reads at most run at a time.
    preloader.preloadMerchantCatalogSnapshot('d'); preloader.preloadMerchantCatalogSnapshot('e');
    await settle();
    assert.deepEqual(reads, ['rested', 'c', 'd']);

    // A late page after a change of account is dropped, and so is a page holding another merchant's offerings.
    preloader.platformSession = { linked: true, user: { id: 'someone-else' } };
    pending.get('c')(page('c'));
    pending.get('d')(page('d', { offerings: [{ id: 'foreign', merchantId: 'other' }] }));
    await settle();
    assert.equal(preloader.merchantPickerSnapshots.has('c'), false);
    assert.equal(preloader.merchantPickerSnapshots.has('d'), false);
    preloader.platformSession = { linked: true, user: { id: 'owner' } };

    // A stale list longer than one page is never traded for its first page, so it is not even read.
    const long = { merchantId: 'long', online: true, offerings: Array.from({ length: 150 }, (_, index) => ({ id: `long-${index}`, merchantId: 'long' })) };
    preloader.merchantPickerSnapshots.set('long', { catalog: long, updatedAt: Date.now() - 60_000 });
    preloader.preloadMerchantCatalogSnapshot('long');
    assert.equal(reads.includes('long'), false);
    // A stale single-page list is read again and replaced.
    preloader.merchantPickerSnapshots.set('short', { catalog: page('short'), updatedAt: Date.now() - 60_000 });
    preloader.preloadMerchantCatalogSnapshot('short'); await settle();
    pending.get('short')(page('short', { offerings: [{ id: 'short-2', merchantId: 'short' }] })); await settle();
    assert.deepEqual(preloader.merchantPickerSnapshots.get('short').catalog.offerings.map(offering => offering.id), ['short-2']);

    // The cache stays at 16 entries and never drops the active relay's own snapshot.
    preloader.merchantPickerSnapshots.clear();
    preloader.merchantPickerSnapshots.set('active', { catalog: page('active'), updatedAt: Date.now() });
    for (let index = 0; index < 15; index++) preloader.merchantPickerSnapshots.set(`m${index}`, { catalog: page(`m${index}`), updatedAt: Date.now() });
    preloader.preloadMerchantCatalogSnapshot('newest'); await settle();
    pending.get('newest')(page('newest')); await settle();
    assert.equal(preloader.merchantPickerSnapshots.size, 16);
    assert.ok(preloader.merchantPickerSnapshots.has('active') && preloader.merchantPickerSnapshots.has('newest'));
    assert.equal(preloader.merchantPickerSnapshots.has('m0'), false);

    // The drawer wires it: a selectable relay row schedules on hover and focus and cancels on leave and blur;
    // a delisted relay, a full relay and an own API never read ahead.
    const instance = fixture();
    const intents = [];
    Object.assign(instance, { scheduleMerchantCatalogPreload: id => intents.push(['schedule', id]), cancelMerchantCatalogPreload: id => intents.push(['cancel', id]) });
    const rowsOf = () => [...elements(instance.renderRelayPopover())].filter(node => node.props.className?.includes('nmx-relay-option-row'));
    const touch = row => { row.props.onPointerEnter({ currentTarget: {} }); row.props.onFocus({ currentTarget: {} }); row.props.onPointerLeave(); row.props.onBlur(); };
    instance.relayOptions = () => [options[1], { ...options[2], directoryOnly: true, directoryStatus: 'unavailable' }];
    rowsOf().forEach(touch);
    assert.deepEqual(intents.splice(0), [['schedule', 'merchant-a'], ['schedule', 'merchant-a'], ['cancel', 'merchant-a'], ['cancel', 'merchant-a'],
        ['cancel', 'merchant-b'], ['cancel', 'merchant-b']]);
    instance.relayOptionIsFull = option => option.merchantId === 'merchant-a';
    touch(rowsOf()[0]);
    assert.deepEqual(intents.splice(0), [['cancel', 'merchant-a'], ['cancel', 'merchant-a']]);
    delete instance.relayOptionIsFull;
    instance.relaySourceTab = 'my-api';
    instance.relayOptions = () => [options[3]];
    const own = rowsOf();
    assert.equal(own.length, 1);
    touch(own[0]);
    assert.deepEqual(intents.splice(0), [['cancel', undefined], ['cancel', undefined]]);
});
