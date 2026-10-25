import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { MusicMvView, type MusicMvVisual } from '../src/browser/nextmux-music-mv';
import { estimateMusicLyrics, nudgeMusicLyricLine, setMusicLyricStart, splitMusicMvSegments } from '@nextmux/comic-core/music-mv';
import type { NextMuxDesktopLocale } from '../src/browser/nextmux-locale';

const durationMs = 42_000;
const lyrics = '[Verse]\n风经过旧站台\n灯火落进你的眼\n\n[Chorus]\n让晚风带走等待\n让星光陪我回来\n\n[Outro]\n这一刻慢慢盛开\n把明天轻轻装进口袋';
const initialLines = estimateMusicLyrics(lyrics, durationMs);
const initialSegments: MusicMvVisual[] = splitMusicMvSegments(initialLines, durationMs, 'Warm acoustic folk, dusk by the sea').map((segment, index) => ({ ...segment,
    source: index === 0 ? 'ai-video' : index === 1 ? 'upload-image' : 'upload-video', url: index === 1 ? '/scene.svg' : '/visual.mp4',
    prompt: ['海边城市的蓝调时刻，温柔的路灯沿街渐次亮起，镜头缓慢向前。', '晚霞落在海岸边，柔和的云层，画面安静而开阔。', '遠处灯塔划过海面，夜空星光闪烁，镜头缓慢平移。'][index % 3]
}));
function Fixture(): React.ReactElement {
    const locale = (new URLSearchParams(location.search).get('locale') || 'zh-CN') as NextMuxDesktopLocale;
    const [lines, setLines] = React.useState(initialLines);
    const [segments, setSegments] = React.useState(initialSegments);
    const [receipt, setReceipt] = React.useState('');
    const [modelRevision, setModelRevision] = React.useState(1);
    const confirmationKey = JSON.stringify({ modelRevision, segments });
    return <main lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} className='nmx-shell nmx-theme-dark'>
        <header><strong>NextMux · Music MV · 隔离结构与交互夹具</strong><p>合成素材，不调用模型；MV 样式由 Claude 另行实现。</p></header>
        <button data-fixture-change-model onClick={() => setModelRevision(value => value + 1)}>Fixture: change quote</button>
        <MusicMvView locale={locale} songUrl='/song.wav' ratio='16:9' durationMs={durationMs} alignment={lines.some(line => line.alignment === 'estimated') ? 'estimated' : 'manual'}
            lines={lines} segments={segments} videoModel={<div><span>视频模型 </span><strong>Synthetic Cinema {modelRevision}</strong></div>}
            modelName={`Synthetic Cinema ${modelRevision}`} confirmationKey={confirmationKey} canGenerate={true} estimateForSegments={ids => `¥ ${(ids.length * .8).toFixed(2)}（模拟报价）`}
            onAlign={() => { setLines(previous => previous.map(line => ({ ...line, alignment: 'recognized' }))); setReceipt('aligned'); }}
            onTap={(id, at) => { setLines(previous => setMusicLyricStart(previous, id, at, durationMs)); setReceipt(`tap:${id}:${at}`); }}
            onNudge={(id, delta) => { setLines(previous => nudgeMusicLyricLine(previous, id, delta, durationMs)); setReceipt(`nudge:${id}:${delta}`); }}
            onSegmentSource={(id, source) => setSegments(previous => previous.map(segment => segment.id === id ? { ...segment, source, url: undefined } : segment))}
            onSegmentPrompt={(id, prompt) => setSegments(previous => previous.map(segment => segment.id === id ? { ...segment, prompt } : segment))}
            onImport={(id, source) => { setSegments(previous => previous.map(segment => segment.id === id ? { ...segment, source, url: source === 'upload-image' ? '/scene.svg' : '/visual.mp4' } : segment)); setReceipt(`import:${id}`); }}
            onGenerate={(ids, key) => setReceipt(`generated:${ids.join(',')}:${key === confirmationKey}`)}
            onRebuild={() => setReceipt('rebuilt')} onNext={() => setReceipt('next')} />
        <output data-fixture-receipt={receipt}>{receipt}</output>
    </main>;
}
createRoot(document.getElementById('fixture')!).render(<Fixture />);
