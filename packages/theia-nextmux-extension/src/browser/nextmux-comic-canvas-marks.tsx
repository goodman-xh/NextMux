import * as React from '@theia/core/shared/react';
import { marksText, type MarksTextKey } from './nextmux-comic-canvas-marks-text';
import { platformShortcutText } from './nextmux-shortcut-text';

/**
 * 标记修图: the user draws visible marks (pen, boxes, arrows, numbered badges) over the source picture. The marks are
 * kept in picture pixels, previewed as SVG and rendered with the picture into one PNG at the picture's own size; the
 * model receives that marked picture plus the per-number instructions, and is asked to remove the marks.
 */
export type MarkTool = 'pen' | 'box' | 'arrow' | 'number';
export interface MarkPoint { readonly x: number; readonly y: number }
export interface CanvasMark {
    readonly tool: MarkTool;
    readonly color: string;
    /** Stroke width in picture pixels. */
    readonly width: number;
    readonly points: readonly MarkPoint[];
    readonly label?: number;
}

const COLORS: readonly { readonly hex: string; readonly name: MarksTextKey }[] = [
    { hex: '#FF3B30', name: 'red' }, { hex: '#FFD60A', name: 'yellow' }, { hex: '#34C759', name: 'green' }, { hex: '#0A84FF', name: 'blue' }, { hex: '#FFFFFF', name: 'white' }
];
const SIZES: readonly { readonly key: MarksTextKey; readonly share: number }[] = [{ key: 'thin', share: 0.004 }, { key: 'medium', share: 0.007 }, { key: 'thick', share: 0.012 }];
const TOOLS: readonly { readonly tool: MarkTool; readonly icon: string }[] = [
    { tool: 'pen', icon: 'edit' }, { tool: 'box', icon: 'primitive-square' }, { tool: 'arrow', icon: 'arrow-up' }, { tool: 'number', icon: 'symbol-numeric' }
];

/** Light marks get dark text and a dark outline; dark marks get white text. */
function lightColor(hex: string): boolean {
    const value = Number.parseInt(hex.slice(1), 16);
    return ((value >> 16 & 255) * 299 + (value >> 8 & 255) * 587 + (value & 255) * 114) / 1000 > 160;
}
function badgeRadius(mark: CanvasMark): number { return Math.max(10, mark.width * 3.4); }

/** One SVG/Path2D path per mark (numbers are drawn as a badge instead). */
export function markPath(mark: CanvasMark): string {
    const [first, ...rest] = mark.points;
    if (!first) return '';
    const last = rest[rest.length - 1] ?? first;
    switch (mark.tool) {
        case 'pen': return `M${first.x} ${first.y}${rest.length ? rest.map(point => `L${point.x} ${point.y}`).join('') : `L${first.x + 0.01} ${first.y}`}`;
        case 'box': return `M${first.x} ${first.y}H${last.x}V${last.y}H${first.x}Z`;
        case 'arrow': {
            const angle = Math.atan2(last.y - first.y, last.x - first.x), length = Math.hypot(last.x - first.x, last.y - first.y);
            const head = Math.min(length * 0.45, Math.max(mark.width * 4.5, 14));
            const wing = (turn: number): string => `${last.x - head * Math.cos(angle + turn)} ${last.y - head * Math.sin(angle + turn)}`;
            return `M${first.x} ${first.y}L${last.x} ${last.y}M${wing(0.5)}L${last.x} ${last.y}L${wing(-0.5)}`;
        }
        default: return '';
    }
}

/** The picture with its marks, at the picture's natural size, as PNG bytes. */
export async function renderMarkedPicture(image: HTMLImageElement, marks: readonly CanvasMark[]): Promise<Blob> {
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height) throw new Error('The picture has not loaded.');
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Drawing is unavailable.');
    context.drawImage(image, 0, 0, width, height);
    context.lineCap = 'round'; context.lineJoin = 'round';
    for (const mark of marks) {
        if (mark.tool === 'number') {
            const at = mark.points[0], radius = badgeRadius(mark);
            if (!at) continue;
            context.beginPath(); context.arc(at.x, at.y, radius, 0, Math.PI * 2);
            context.fillStyle = mark.color; context.fill();
            context.lineWidth = Math.max(2, radius * 0.16); context.strokeStyle = lightColor(mark.color) ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.9)'; context.stroke();
            context.fillStyle = lightColor(mark.color) ? '#111' : '#fff';
            context.font = `700 ${Math.round(radius * 1.15)}px -apple-system, "PingFang SC", "Segoe UI", sans-serif`;
            context.textAlign = 'center'; context.textBaseline = 'middle';
            context.fillText(String(mark.label ?? 1), at.x, at.y + radius * 0.04);
            continue;
        }
        const path = new Path2D(markPath(mark));
        context.lineWidth = mark.width + Math.max(2, mark.width * 0.6); context.strokeStyle = lightColor(mark.color) ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.55)'; context.stroke(path);
        context.lineWidth = mark.width; context.strokeStyle = mark.color; context.stroke(path);
    }
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The marked picture could not be encoded.')), 'image/png'));
}

export interface MarkEditorProps {
    readonly locale: string;
    readonly src: string;
    readonly marks: readonly CanvasMark[];
    readonly onChange: (marks: readonly CanvasMark[]) => void;
    readonly imageRef: React.MutableRefObject<HTMLImageElement | null>;
    readonly disabled?: boolean;
}

export function MarkEditor(props: MarkEditorProps): React.ReactElement {
    const m = (key: MarksTextKey): string => marksText(props.locale, key);
    const [tool, setTool] = React.useState<MarkTool>('pen');
    const [color, setColor] = React.useState(COLORS[0].hex);
    const [size, setSize] = React.useState(1);
    const [natural, setNatural] = React.useState<{ width: number; height: number }>();
    const [draft, setDraft] = React.useState<CanvasMark>();
    const [future, setFuture] = React.useState<readonly (readonly CanvasMark[])[]>([]);
    const svg = React.useRef<SVGSVGElement | null>(null);
    const stage = React.useRef<HTMLDivElement | null>(null);
    const [room, setRoom] = React.useState<{ width: number; height: number }>();
    // The picture fits the stage whatever the dialog size; marks stay in picture pixels.
    React.useLayoutEffect(() => {
        const element = stage.current;
        if (!element) return undefined;
        const measure = (): void => { const box = element.getBoundingClientRect(); setRoom({ width: Math.max(0, box.width - 16), height: Math.max(0, box.height - 16) }); };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    const scale = natural && room?.width && room.height ? Math.min(room.width / natural.width, room.height / natural.height, 2) : 0;
    const long = natural ? Math.max(natural.width, natural.height) : 1000;
    const width = Math.max(2, Math.round(long * SIZES[size].share));

    const commit = (next: readonly CanvasMark[]): void => { setFuture([]); props.onChange(next); };
    const undo = (): void => { if (!props.marks.length) return; setFuture([props.marks, ...future]); props.onChange(props.marks.slice(0, -1)); };
    const redo = (): void => { const [next, ...rest] = future; if (!next) return; setFuture(rest); props.onChange(next); };
    const point = (event: React.PointerEvent): MarkPoint | undefined => {
        const box = svg.current?.getBoundingClientRect();
        if (!box || !natural || !box.width || !box.height) return undefined;
        const clamp = (value: number, max: number): number => Math.round(Math.min(max, Math.max(0, value)) * 10) / 10;
        return { x: clamp((event.clientX - box.left) / box.width * natural.width, natural.width), y: clamp((event.clientY - box.top) / box.height * natural.height, natural.height) };
    };
    const down = (event: React.PointerEvent<SVGSVGElement>): void => {
        if (props.disabled || event.button !== 0) return;
        const at = point(event);
        if (!at) return;
        event.preventDefault();
        if (tool === 'number') {
            const label = props.marks.reduce((top, mark) => Math.max(top, mark.label ?? 0), 0) + 1;
            commit([...props.marks, { tool, color, width, points: [at], label }]);
            return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        setDraft({ tool, color, width, points: [at] });
    };
    const move = (event: React.PointerEvent<SVGSVGElement>): void => {
        if (!draft) return;
        const at = point(event);
        if (!at) return;
        if (draft.tool === 'pen') {
            const last = draft.points[draft.points.length - 1];
            if (Math.hypot(at.x - last.x, at.y - last.y) >= Math.max(1, width * 0.35)) setDraft({ ...draft, points: [...draft.points, at] });
        } else setDraft({ ...draft, points: [draft.points[0], at] });
    };
    const up = (): void => {
        if (!draft) return;
        const [first] = draft.points, last = draft.points[draft.points.length - 1];
        // A click without a drag only counts for the pen (a dot); boxes and arrows need some extent.
        const big = draft.tool === 'pen' || Math.hypot(last.x - first.x, last.y - first.y) >= Math.max(6, width * 2);
        if (big) commit([...props.marks, draft]);
        setDraft(undefined);
    };

    const drawn = draft ? [...props.marks, draft] : props.marks;
    return <div className='nmx-board-marks' onKeyDown={event => {
        if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z' || (event.target as HTMLElement).closest('textarea, input')) return;
        event.preventDefault(); if (event.shiftKey) redo(); else undo();
    }}>
        <div className='nmx-board-marks-tools' role='toolbar' aria-label={m('pen')}>
            <div className='nmx-board-marks-group'>
                {TOOLS.map(item => <button key={item.tool} type='button' className={tool === item.tool ? 'is-on' : ''} aria-pressed={tool === item.tool} title={m(item.tool)} disabled={props.disabled}
                    onClick={() => setTool(item.tool)}><i className={`codicon codicon-${item.icon}`} aria-hidden='true'></i><span>{m(item.tool)}</span></button>)}
            </div>
            <div className='nmx-board-marks-group' role='radiogroup' aria-label={m('color')}>
                {COLORS.map(item => <button key={item.hex} type='button' role='radio' aria-checked={color === item.hex} aria-label={m(item.name)} title={m(item.name)}
                    className={`nmx-board-marks-swatch${color === item.hex ? ' is-on' : ''}`} style={{ background: item.hex }} disabled={props.disabled} onClick={() => setColor(item.hex)} />)}
            </div>
            <div className='nmx-board-marks-group' role='radiogroup' aria-label={m('size')}>
                {SIZES.map((item, index) => <button key={item.key} type='button' role='radio' aria-checked={size === index} title={m(item.key)} aria-label={m(item.key)}
                    className={`nmx-board-marks-size${size === index ? ' is-on' : ''}`} disabled={props.disabled} onClick={() => setSize(index)}>
                    <span style={{ width: 4 + index * 4, height: 4 + index * 4 }} /></button>)}
            </div>
            <div className='nmx-board-marks-group'>
                <button type='button' title={`${m('undo')} (${platformShortcutText('⌘Z')})`} aria-label={m('undo')} disabled={props.disabled || !props.marks.length} onClick={undo}><i className='codicon codicon-discard' aria-hidden='true'></i></button>
                <button type='button' title={`${m('redo')} (${platformShortcutText('⇧⌘Z')})`} aria-label={m('redo')} disabled={props.disabled || !future.length} onClick={redo}><i className='codicon codicon-redo' aria-hidden='true'></i></button>
                <button type='button' title={m('clear')} aria-label={m('clear')} disabled={props.disabled || !props.marks.length} onClick={() => { setFuture([props.marks, ...future]); props.onChange([]); }}><i className='codicon codicon-clear-all' aria-hidden='true'></i></button>
            </div>
        </div>
        <div className='nmx-board-marks-stage' ref={stage}>
            <div className='nmx-board-marks-picture' style={scale && natural ? { width: Math.round(natural.width * scale), height: Math.round(natural.height * scale) } : { opacity: 0 }}>
                <img ref={props.imageRef} src={props.src} alt='' crossOrigin='anonymous' draggable={false}
                    onLoad={event => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
                {natural && <svg ref={svg} viewBox={`0 0 ${natural.width} ${natural.height}`} preserveAspectRatio='none' className={`is-${tool}`}
                    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDraft(undefined)}>
                    {drawn.map((mark, index) => mark.tool === 'number'
                        ? <g key={index} transform={`translate(${mark.points[0].x} ${mark.points[0].y})`}>
                            <circle r={badgeRadius(mark)} fill={mark.color} stroke={lightColor(mark.color) ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.9)'} strokeWidth={Math.max(2, badgeRadius(mark) * 0.16)} />
                            <text textAnchor='middle' dominantBaseline='central' fontWeight={700} fontSize={Math.round(badgeRadius(mark) * 1.15)} fill={lightColor(mark.color) ? '#111' : '#fff'}>{mark.label}</text>
                        </g>
                        : <g key={index} fill='none' strokeLinecap='round' strokeLinejoin='round'>
                            <path d={markPath(mark)} stroke={lightColor(mark.color) ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.55)'} strokeWidth={mark.width + Math.max(2, mark.width * 0.6)} />
                            <path d={markPath(mark)} stroke={mark.color} strokeWidth={mark.width} />
                        </g>)}
                </svg>}
            </div>
        </div>
    </div>;
}
