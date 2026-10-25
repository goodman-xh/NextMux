import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { CommunitySkillCard } from '../src/browser/nextmux-community-skill-card';
import type { DesktopCommunitySkill } from '../src/common/nextmux-platform-protocol';
import type { NextMuxDesktopLocale } from '../src/browser/nextmux-locale';

const source: DesktopCommunitySkill = { id: 'fixture', name: 'Example Skill', description: 'Literal metadata only, no installation or network access in this fixture.', repository: 'example/fixture', path: 'skills/example', sourceId: 'test', sourceName: 'Fixture', homepage: 'https://example.test', version: 'v2', installed: true, updateAvailable: true,
    metadata: { schemaVersion: 1, license: { status: 'declared', value: 'MIT' }, compatibility: { operatingSystems: { status: 'declared', values: ['windows', 'darwin', 'linux'] }, architectures: { status: 'declared', values: ['arm64', 'x64'] } }, dependencies: { status: 'unknown', items: [] }, tools: { mode: 'inherit', allowedToolNames: [] }, source: { status: 'verified', repository: 'example/fixture', path: 'skills/example', revision: 'a'.repeat(40), treeSha: 'b'.repeat(40), blobSha: 'c'.repeat(40), sha256: 'd'.repeat(64) }, issues: [] },
    permissionChange: { state: 'changed', added: [], removed: [], mayExpand: true, requiresReview: true, previousMode: 'restricted', nextMode: 'inherit', reviewToken: 'e'.repeat(64) } };
function Fixture(): React.ReactElement {
    const [width, setWidth] = React.useState(960), [locale, setLocale] = React.useState<NextMuxDesktopLocale>('en');
    const [busy, setBusy] = React.useState(false), [failure, setFailure] = React.useState(true), [calls, setCalls] = React.useState(0), [message, setMessage] = React.useState('No operation'), [geometry, setGeometry] = React.useState('');
    return <><nav><select aria-label='Width' value={width} onChange={event => setWidth(Number(event.currentTarget.value))}>{[960, 360, 320].map(n => <option key={n}>{n}</option>)}</select>
        <select aria-label='Locale' value={locale} onChange={event => setLocale(event.currentTarget.value as NextMuxDesktopLocale)}>{['en', 'ar', 'de', 'zh-CN'].map(value => <option key={value}>{value}</option>)}</select>
        <label><input type='checkbox' checked={failure} onChange={event => setFailure(event.currentTarget.checked)} />Simulate failure</label>
        <button onClick={() => { const panel = document.querySelector('.nmx-community-skill-card'), review = document.querySelector('.nmx-community-skill-review'); setGeometry(JSON.stringify({ panelWidth: panel?.getBoundingClientRect().width, scrollWidth: panel?.scrollWidth, reviewHeight: review?.getBoundingClientRect().height, reviewScrollHeight: review?.scrollHeight })); }}>Measure</button></nav>
        <output>Mock calls: {calls}. {message}</output><output>{geometry}</output>
        <main style={{ width, maxWidth: '100%' }}><section className='nmx-community-skills-list'><div><CommunitySkillCard skill={source} locale={locale} busy={busy} blocked={busy} status=''
            sourceLabel='Explicit source' removeLabel='Remove' onSource={() => setMessage('Explicit source callback only')} onRemove={() => setMessage('Mock remove only')}
            onInstall={async review => { setCalls(value => value + 1); setBusy(true); await new Promise(resolve => window.setTimeout(resolve, 600)); setBusy(false); setMessage(failure ? 'Mock failure, review retained' : `Mock success, reviewed: ${Boolean(review)}`); return !failure; }} /></div></section></main>
    </>;
}
createRoot(document.getElementById('fixture')!).render(<Fixture />);
