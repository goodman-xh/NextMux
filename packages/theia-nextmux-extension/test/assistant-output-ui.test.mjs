import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { agentRouteEvidencePresentation } from '../lib/browser/nextmux-agent-route-evidence.js';
import { assistantOutputPresentation } from '../lib/browser/nextmux-assistant-output.js';

const asset = (mimeType, sizeBytes = 128) => ({ sha256: 'a'.repeat(64), mimeType, sizeBytes });

test('ordered assistant output keeps mixed text and media in exact provider order', () => {
    const parts = [
        { type: 'text', text: 'Here is the synthetic report.\n\n| Item | State |\n|---|---|\n| Demo | Ready |' },
        { type: 'image', asset: asset('image/png') },
        { type: 'text', text: '\n\n[Open the fictional reference](https://example.invalid/reference).' },
        { type: 'audio', asset: asset('audio/wav', 256) }
    ];
    const result = assistantOutputPresentation('A legacy fallback must not be inserted.', parts);
    assert.equal(result.kind, 'ordered');
    assert.deepEqual(result.parts.map(part => part.type), ['text', 'image', 'text', 'audio']);
    assert.equal(result.parts.filter(part => part.type === 'text').map(part => part.text).join(''),
        `${parts[0].text}${parts[2].text}`);
});

test('media-only ordered output never acquires a synthetic prose summary', () => {
    const result = assistantOutputPresentation('Synthetic completion summary', [
        { type: 'image', asset: asset('image/webp') },
        { type: 'audio', asset: asset('audio/mpeg') }
    ]);
    assert.deepEqual(result, {
        kind: 'ordered',
        parts: [
            { type: 'image', asset: asset('image/webp') },
            { type: 'audio', asset: asset('audio/mpeg') }
        ]
    });
    assert.equal('text' in result, false);
});

test('legacy and damaged historical output take the safe Markdown fallback', () => {
    assert.deepEqual(assistantOutputPresentation('Legacy Markdown', undefined), { kind: 'legacy-text', text: 'Legacy Markdown' });
    assert.deepEqual(assistantOutputPresentation('Recoverable text', [
        { type: 'image', asset: asset('image/png', 0) }
    ]), { kind: 'legacy-text', text: 'Recoverable text' });
});

test('only a real failover produces a compact durable route receipt', () => {
    assert.equal(agentRouteEvidencePresentation('en', 'Demo Model · Fictional Provider', 0), undefined);
    assert.equal(agentRouteEvidencePresentation('en', 'Demo Model · Fictional Provider', undefined), undefined);
    const receipt = agentRouteEvidencePresentation('en', `  ⇄ Demo\nModel · Fictional Provider ${'x'.repeat(300)}`, 2);
    assert.deepEqual({ title: receipt.title, count: receipt.count }, { title: 'Route switched 2', count: 2 });
    assert.equal(receipt.route.includes('\n'), false);
    assert.ok(receipt.route.startsWith('Demo Model · Fictional Provider'));
    assert.equal(receipt.route.length, 180);
});

test('desktop binds ordered output, switch evidence and compact responsive contracts', () => {
    const widget = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
    const style = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux-desktop-production.css', import.meta.url)), 'utf8');
    const render = widget.slice(widget.indexOf('protected renderAssistantOutput('), widget.indexOf('protected renderThreadNavigator('));
    assert.match(render, /assistantOutputPresentation\(value, rawParts\)/);
    assert.match(render, /output\.kind === 'legacy-text'/);
    assert.match(render, /data-output-kind='ordered'/);
    assert.doesNotMatch(render, /hasVisibleTextPart|:fallback/);
    assert.match(widget, /agentRouteEvidencePresentation\(this\.desktopLocale, turn\.routeLabel, turn\.failoverCount\)/);
    assert.match(widget, /className='nmx-turn-route-evidence' role='status'/);
    assert.match(style, /\.nmx-desktop-widget \.nmx-assistant-output\s*\{[^}]*container-type:\s*inline-size/s);
    assert.match(style, /\.nmx-desktop-widget \.nmx-turn-route-evidence\s*\{[^}]*grid-template-columns:\s*18px minmax\(0, 1fr\)/s);
    assert.match(style, /--nmx-question-max-height:\s*min\(38dvh, 320px\)/);
    assert.match(style, /@media \(max-height: 560px\)[\s\S]*?--nmx-question-max-height:\s*min\(34dvh, 220px\)/);
    const streamStyle = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux-conversation-stream.css', import.meta.url)), 'utf8');
    assert.match(streamStyle, /\n\.nmx-stream-target\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
});

