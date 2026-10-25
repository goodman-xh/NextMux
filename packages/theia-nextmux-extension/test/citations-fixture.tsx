import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { CitationList } from '../src/browser/nextmux-citations';
import type { NextMuxDesktopLocale } from '../src/browser/nextmux-locale';

function Fixture(): React.ReactElement {
    const [width, setWidth] = React.useState(960), [locale, setLocale] = React.useState<NextMuxDesktopLocale>('en');
    const [turn, setTurn] = React.useState('A'), [opened, setOpened] = React.useState('No navigation'), [geometry, setGeometry] = React.useState('');
    const citations = turn === 'A' ? Array.from({ length: 30 }, (_, index) => ({
        url: `https://example.test/${index}/${'long-path-'.repeat(20)}`,
        title: index === 0 ? '<img src=x onerror=alert(1)> literal title' : locale === 'ar' ? 'مصدر واضح مع عنوان طويل للاختبار'.repeat(4) : 'A long source title with a clearly visible destination '.repeat(4)
    })) : [];
    return <>
        <nav><label>Width <select value={width} onChange={event => setWidth(Number(event.currentTarget.value))}>{[960, 360, 320].map(value => <option key={value}>{value}</option>)}</select></label>
            <label>Locale <select value={locale} onChange={event => setLocale(event.currentTarget.value as NextMuxDesktopLocale)}><option>en</option><option>ar</option><option>de</option><option>zh-CN</option></select></label>
            <button onClick={() => setTurn(turn === 'A' ? 'B' : 'A')}>Switch answer ({turn})</button>
            <button onClick={() => { const panel = document.querySelector('.nmx-answer-citations'), list = panel?.querySelector('ol'); setGeometry(JSON.stringify({ frame: document.querySelector('main')?.getBoundingClientRect().width, panelWidth: panel?.getBoundingClientRect().width, scrollWidth: panel?.scrollWidth, listHeight: list?.getBoundingClientRect().height, listScrollHeight: list?.scrollHeight, links: panel?.querySelectorAll('a').length || 0 })); }}>Measure</button>
        </nav>
        <output>{opened}</output><output>{geometry}</output>
        <main style={{ width, maxWidth: '100%' }} dir={locale === 'ar' ? 'rtl' : 'ltr'}><p>Current answer {turn}</p>
            <CitationList locale={locale} citations={citations} onOpen={url => setOpened(`Explicit click only: ${url}`)} />
        </main>
    </>;
}
createRoot(document.getElementById('fixture')!).render(<Fixture />);
