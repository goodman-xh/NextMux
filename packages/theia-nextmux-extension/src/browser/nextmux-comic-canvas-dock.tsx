import * as React from '@theia/core/shared/react';
import '../../src/browser/style/nextmux-comic-canvas-dock.css';

const locales = ['zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const messages = {
    autoHide: ['自动收起工具栏', 'Auto-hide toolbar', '自動收起工具列', 'ツールバーを自動で隠す', '도구 모음 자동 숨기기', 'Ocultar barra automáticamente', 'Masquer automatiquement la barre', 'Werkzeugleiste automatisch ausblenden', 'Ocultar barra automaticamente', 'Автоматически скрывать панель', 'إخفاء شريط الأدوات تلقائيًا', 'टूलबार अपने आप छिपाएँ'],
    show: ['展开工具栏', 'Show toolbar', '展開工具列', 'ツールバーを表示', '도구 모음 표시', 'Mostrar barra', 'Afficher la barre', 'Werkzeugleiste anzeigen', 'Mostrar barra', 'Показать панель', 'إظهار شريط الأدوات', 'टूलबार दिखाएँ']
} as const;
export function canvasDockText(locale: string, key: keyof typeof messages): string {
    const index = locales.indexOf(locale);
    return messages[key]?.[index < 0 ? locale.startsWith('zh') ? 0 : 1 : index] ?? key;
}
function read(key: string): boolean { try { return localStorage.getItem(key) === 'true'; } catch { return false; } }

/** Display-only docking. It never changes grid snapping, the canvas document, or any model input. */
export function CanvasAutoDock(props: {
    readonly locale: string; readonly storageKey: string; readonly root: React.RefObject<HTMLDivElement>;
    readonly keepOpen: boolean; readonly children: React.ReactNode;
}): React.ReactElement {
    const [enabled, setEnabled] = React.useState(() => read(props.storageKey));
    const [hidden, setHidden] = React.useState(false);
    const [hovered, setHovered] = React.useState(false), [focused, setFocused] = React.useState(false);
    const [panelOpen, setPanelOpen] = React.useState(false);
    const delay = React.useRef(1200), dock = React.useRef<HTMLDivElement>(null);
    const focusRevealed = React.useRef(false);
    React.useLayoutEffect(() => {
        if (hidden || !focusRevealed.current) return;
        focusRevealed.current = false;
        dock.current?.querySelector<HTMLButtonElement>('button:not(.nmx-board-dock-reveal):not(:disabled)')?.focus();
    }, [hidden]);
    React.useEffect(() => { setEnabled(read(props.storageKey)); setHidden(false); delay.current = 1200; }, [props.storageKey]);
    React.useEffect(() => {
        const board = props.root.current;
        if (!board) return;
        const check = (): void => setPanelOpen(Boolean(board.querySelector('[role="dialog"], .nmx-board-side, .nmx-board-menu, .nmx-board-tools')));
        check();
        const observer = new MutationObserver(check);
        observer.observe(board, { childList: true, subtree: true, attributes: true, attributeFilter: ['role'] });
        return () => observer.disconnect();
    }, [props.root]);
    React.useEffect(() => {
        if (!enabled || props.keepOpen || panelOpen || hovered || focused) { setHidden(false); return; }
        const timer = window.setTimeout(() => setHidden(true), delay.current);
        return () => window.clearTimeout(timer);
    }, [enabled, props.keepOpen, panelOpen, hovered, focused]);
    const toggle = (): void => {
        const value = !enabled; delay.current = 1200; setHidden(false); setEnabled(value);
        try { localStorage.setItem(props.storageKey, String(value)); } catch { /* The preference still works this session. */ }
    };
    const show = (): void => { setHidden(false); dock.current?.querySelector<HTMLButtonElement>('button:not(.nmx-board-dock-reveal):not(:disabled)')?.focus(); };
    return <div ref={dock} className={`nmx-board-dock${enabled ? ' is-auto-dock' : ''}${hidden ? ' is-auto-hidden' : ''}`} role='toolbar'
        onMouseEnter={() => { delay.current = 300; setHovered(true); setHidden(false); }} onMouseLeave={() => { delay.current = 300; setHovered(false); }}
        onFocus={event => { focusRevealed.current = (event.target as HTMLElement).classList.contains('nmx-board-dock-reveal'); setFocused(true); setHidden(false); }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { delay.current = 300; setFocused(false); } }}>
        <button type='button' className='nmx-board-dock-reveal' hidden={!hidden} aria-label={canvasDockText(props.locale, 'show')} title={canvasDockText(props.locale, 'show')} onClick={show}>
            <i className='codicon codicon-chevron-up' aria-hidden='true' /></button>
        {props.children}
        <span className='nmx-board-dock-divider' />
        <button type='button' className={enabled ? 'is-on' : ''} aria-pressed={enabled} aria-label={canvasDockText(props.locale, 'autoHide')}
            title={canvasDockText(props.locale, 'autoHide')} onMouseDown={event => event.preventDefault()} onClick={toggle}><i className='codicon codicon-pin' aria-hidden='true' /></button>
    </div>;
}
