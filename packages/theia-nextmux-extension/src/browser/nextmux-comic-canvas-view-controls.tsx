import * as React from '@theia/core/shared/react';
import { useReactFlow, useViewport } from '@xyflow/react';
import type { CanvasSettings } from './nextmux-comic-canvas-settings';
import { CanvasModalLayer } from './nextmux-comic-canvas-modal';
import { canvasText, CanvasTextKey } from './nextmux-comic-canvas-text';
import { toolText } from './nextmux-comic-canvas-tools-text';
import '../../src/browser/style/nextmux-comic-canvas-view-controls.css';

/** Neowow CanvasControls: grid, minimap, zoom menu, then separate compare/help buttons. */
export function CanvasViewControls(props: {
    readonly locale: string; readonly settings: CanvasSettings; readonly onSettings: (settings: CanvasSettings) => void;
    readonly root: React.RefObject<HTMLDivElement>; readonly compareCount: number; readonly onCompare: () => void;
    readonly onSelectAll: () => void;
}): React.ReactElement {
    const flow = useReactFlow(), { zoom } = useViewport();
    const zh = props.locale.startsWith('zh'), t = (key: CanvasTextKey): string => canvasText(props.locale, key);
    const copy = (cn: string, en: string): string => zh ? cn : en;
    const [open, setOpen] = React.useState(false), [guide, setGuide] = React.useState(false);
    const [availableHeight, setAvailableHeight] = React.useState(480);
    const menu = React.useRef<HTMLDivElement>(null), trigger = React.useRef<HTMLButtonElement>(null);
    const mac = /Mac|iPhone|iPad/i.test(navigator.platform), mod = mac ? '⌘' : 'Ctrl';
    React.useLayoutEffect(() => {
        if (!open) return;
        const update = (): void => {
            const board = props.root.current?.getBoundingClientRect(), button = trigger.current?.getBoundingClientRect();
            if (button) setAvailableHeight(Math.max(80, button.top - Math.max(8, board?.top ?? 8) - 18));
        };
        update(); menu.current?.focus({ preventScroll: true }); const observer = new ResizeObserver(update);
        if (props.root.current) observer.observe(props.root.current);
        window.addEventListener('resize', update);
        return () => { observer.disconnect(); window.removeEventListener('resize', update); };
    }, [open, props.root]);
    React.useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent): void => { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false); };
        document.addEventListener('pointerdown', outside);
        return () => document.removeEventListener('pointerdown', outside);
    }, [open]);
    const close = (): void => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
    const zoomTo = (value: number, duration = 150): void => { void flow.zoomTo(Math.max(.04, Math.min(3, value)), { duration }); };
    const pan = (x: number, y: number): void => { const view = flow.getViewport(); void flow.setViewport({ ...view, x: view.x + x * props.settings.navigationSensitivity, y: view.y + y * props.settings.navigationSensitivity }, { duration: 150 }); };
    const item = (label: string, keys: string, action: () => void): React.ReactElement => <button type='button' role='menuitem' aria-label={label} onClick={action}><span>{label}</span><kbd>{keys}</kbd></button>;
    return <>
        <div className='nmx-board-navigation nmx-board-view-controls' role='toolbar' aria-label={copy('画布视图', 'Canvas view')}>
            <div className='nmx-board-view-capsule'>
                <button type='button' aria-pressed={props.settings.showGrid} className={props.settings.showGrid ? 'is-on' : ''} title={t('grid')} aria-label={t('grid')}
                    onClick={() => props.onSettings({ ...props.settings, showGrid: !props.settings.showGrid })}><i className='codicon codicon-table' aria-hidden='true' /></button>
                <button type='button' aria-pressed={props.settings.minimap} className={props.settings.minimap ? 'is-on' : ''} title={t('minimap')} aria-label={t('minimap')}
                    onClick={() => props.onSettings({ ...props.settings, minimap: !props.settings.minimap })}><i className='codicon codicon-preview' aria-hidden='true' /></button>
                <button ref={trigger} type='button' className='nmx-board-zoom' aria-label={copy('缩放', 'Zoom')} title={copy('缩放', 'Zoom')} aria-haspopup='menu' aria-expanded={open}
                    onClick={() => setOpen(value => !value)}><i className='codicon codicon-search' aria-hidden='true' /><span data-nmx-literal>{Math.round(zoom * 100)}%</span></button>
            </div>
            <button type='button' className='nmx-board-view-round' title={toolText(props.locale, 'compare')} aria-label={toolText(props.locale, 'compare')} onClick={props.onCompare}>
                <i className='codicon codicon-diff' aria-hidden='true' />{props.compareCount > 0 && <span className='nmx-board-dock-count'>{props.compareCount}</span>}</button>
            <button type='button' className='nmx-board-view-round' title={copy('画布使用指南', 'Canvas guide')} aria-label={t('shortcuts')} onClick={() => { setOpen(false); setGuide(true); }}><i className='codicon codicon-question' aria-hidden='true' /></button>
            {open && <div ref={menu} className='nmx-board-zoom-menu' role='menu' tabIndex={-1} data-canvas-keyboard-exclude aria-label={copy('缩放与导航', 'Zoom and navigation')} style={{ maxHeight: availableHeight }}
                onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
                <label className='nmx-board-view-slider'><input type='range' min='4' max='300' step='1' aria-label={copy('缩放比例', 'Zoom level')} value={Math.round(zoom * 100)}
                    onChange={event => { const value = Number(event.currentTarget.value); zoomTo(Math.abs(value - 100) <= 5 ? 1 : value / 100, 0); }} /><output data-nmx-literal>{Math.round(zoom * 100)}%</output></label>
                {item(copy('缩放至 50%', 'Zoom to 50%'), '', () => zoomTo(.5))}
                {item(copy('缩放至 100%', 'Zoom to 100%'), '', () => zoomTo(1))}
                {item(t('fit'), `${mod} 0`, () => { void flow.fitView({ padding: .2, duration: 300, minZoom: .15 }); close(); })}
                <hr />
                {item(t('zoomIn'), 'E', () => zoomTo(flow.getZoom() * 1.2))}
                {item(t('zoomOut'), 'Q', () => zoomTo(flow.getZoom() / 1.2))}
                <hr />
                {item(copy('向上平移', 'Pan up'), 'W', () => pan(0, 100))}
                {item(copy('向下平移', 'Pan down'), 'S', () => pan(0, -100))}
                {item(copy('向左平移', 'Pan left'), 'A', () => pan(100, 0))}
                {item(copy('向右平移', 'Pan right'), 'D', () => pan(-100, 0))}
                <hr />
                <label className='nmx-board-view-preference'><span>{copy('快捷键灵敏度', 'Navigation sensitivity')}<output data-nmx-literal>{Math.round(props.settings.navigationSensitivity * 100)}%</output></span>
                    <input type='range' min='.2' max='3' step='.05' aria-label={copy('快捷键灵敏度', 'Navigation sensitivity')} value={props.settings.navigationSensitivity}
                        onChange={event => { const value = Number(event.currentTarget.value); props.onSettings({ ...props.settings, navigationSensitivity: Math.abs(value - 1) <= .06 ? 1 : value }); }} /></label>
                <label className='nmx-board-view-preference'><span>{copy('加速 Shift', 'Shift boost')}<output data-nmx-literal>×{props.settings.navigationShiftBoost}</output></span>
                    <input type='range' min='1' max='8' step='.1' aria-label={copy('Shift 加速倍率', 'Shift speed multiplier')} value={props.settings.navigationShiftBoost}
                        onChange={event => { const value = Number(event.currentTarget.value); props.onSettings({ ...props.settings, navigationShiftBoost: Math.abs(value - 2.5) <= .15 ? 2.5 : value }); }} /></label>
                <p>{copy('按住 Shift 时 WASD / QE 的速度再乘该倍率', 'Hold Shift to multiply the WASD / QE navigation speed.')}</p>
            </div>}
        </div>
        {guide && <CanvasGuide locale={props.locale} onClose={() => setGuide(false)} onSelectAll={() => { setGuide(false); props.onSelectAll(); props.root.current?.focus({ preventScroll: true }); }} />}
    </>;
}

function CanvasGuide(props: { readonly locale: string; readonly onClose: () => void; readonly onSelectAll: () => void }): React.ReactElement {
    const zh = props.locale.startsWith('zh'), copy = (cn: string, en: string): string => zh ? cn : en;
    const t = (key: CanvasTextKey): string => canvasText(props.locale, key), mod = /Mac|iPhone|iPad/i.test(navigator.platform) ? '⌘' : 'Ctrl';
    const [section, setSection] = React.useState('shortcuts');
    const body = React.useRef<HTMLDivElement>(null);
    const backdropPress = React.useRef(false);
    const labels = { world: copy('3D 世界', '3D world'), shortcuts: t('shortcuts'), basic: copy('基础操作', 'Basics'), navigation: copy('画布导航', 'Canvas navigation'), advanced: copy('高级功能', 'Advanced'), settings: copy('自定义画布', 'Canvas settings') };
    const shortcuts: readonly (readonly [string, string])[] = [
        [t('copy'), `${mod} C`], [t('paste'), `${mod} V`], [t('duplicate'), `${mod} D`], [copy('节点复制', 'Copy nodes'), copy('Alt + 拖动节点', 'Alt + drag nodes')],
        [t('duplicate'), copy(`${mod} Alt + 拖动`, `${mod} Alt + drag`)], [t('rename'), 'F2'], [t('selectAll'), `${mod} A`], [t('undo'), `${mod} Z`],
        [t('redo'), `Shift ${mod} Z / ${mod} Y`], [t('delete'), 'Delete / Backspace'], [copy('打开菜单', 'Open menu'), copy('右键 / 双击', 'Right-click / double-click')], [t('addTitle'), 'Tab'],
        [copy('平移画布', 'Pan canvas'), copy('Space + 拖动 / 中键', 'Space + drag / middle button')], [copy('键盘平移', 'Pan with keyboard'), 'W / A / S / D'], [t('zoomIn'), 'E'], [t('zoomOut'), 'Q'],
        [copy('加速导航', 'Faster navigation'), copy('Shift + 导航键', 'Shift + navigation keys')], [t('upload'), copy(`拖入 / ${mod} V`, `Drop / ${mod} V`)],
        [t('fit'), `${mod} 0`], [copy('取消选择', 'Deselect'), 'Esc'], [t('group'), `${mod} G`], [t('ungroup'), `Shift ${mod} G`]
    ];
    const basics = [
        [t('addTitle'), copy('右键或双击画布空白处打开添加菜单，使用画布设置选择触发方式。', 'Open the add menu on blank canvas with a right-click or double-click, as chosen in Canvas settings.')],
        [copy('连接节点', 'Connect nodes'), copy('从输出点拖到输入点；拖到空白处可以创建并连接新节点。', 'Drag an output to an input, or release on blank canvas to create a connected node.')],
        [copy('选中与移动', 'Select and move'), copy('单击选中，拖拽移动；框选或按住 Shift 加选多个节点。', 'Click to select, drag to move; box-select or Shift-click to select several nodes.')],
        [t('rename'), copy('双击节点标题，或选中后按 F2。', 'Double-click a title, or select a node and press F2.')],
        [copy('编辑提示词', 'Edit prompts'), copy('文字在节点内直接编辑，生成提示词在该节点下方编辑。', 'Edit text in the node and generation prompts in the form below it.')],
        [copy('参考素材', 'Reference inputs'), copy('在首帧、尾帧、参考图或参考视频入口选择素材库、画布素材或本地上传。', 'Choose a library item, canvas asset or local upload for a first frame, last frame or supported reference slot.')]
    ];
    const entries = (rows: readonly (readonly string[])[]): React.ReactElement => <div className='nmx-canvas-guide-cards'>{rows.map(([title, text]) => <article key={title}><strong>{title}</strong><p>{text}</p></article>)}</div>;
    return <CanvasModalLayer locale={props.locale}><div className='nmx-canvas-guide-backdrop'
        onPointerDown={event => { backdropPress.current = event.button === 0 && event.target === event.currentTarget; }}
        onPointerUp={event => { if (event.target !== event.currentTarget) backdropPress.current = false; }}
        onPointerCancel={() => { backdropPress.current = false; }}
        onClick={event => { const close = backdropPress.current && event.target === event.currentTarget; backdropPress.current = false; if (close) props.onClose(); }}>
        <section className='nmx-canvas-guide' role='dialog' aria-modal='true' aria-label={copy('画布使用指南', 'Canvas guide')} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); props.onClose(); } }}>
            <header><strong>{copy('画布使用指南', 'Canvas guide')}</strong><button type='button' title={t('cancel')} aria-label={t('cancel')} onClick={props.onClose}><i className='codicon codicon-close' aria-hidden='true' /></button></header>
            <nav>{Object.entries(labels).map(([key, label]) => <button type='button' className={section === key ? 'is-active' : ''} key={key} onClick={() => { setSection(key); body.current?.querySelector(`[data-guide-section="${key}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}>{label}</button>)}</nav>
            <div className='nmx-canvas-guide-body' ref={body} onScroll={event => {
                const container = event.currentTarget, entries = [...container.querySelectorAll<HTMLElement>('[data-guide-section]')];
                const atEnd = container.scrollHeight - container.scrollTop - container.clientHeight < 2;
                const visible = atEnd ? entries.at(-1) : entries.filter(entry => entry.getBoundingClientRect().top <= container.getBoundingClientRect().top + 32).at(-1);
                if (visible?.dataset.guideSection) setSection(visible.dataset.guideSection);
            }}>
                <section data-guide-section='shortcuts'><h3>{labels.shortcuts}</h3><div className='nmx-canvas-guide-keys'>{shortcuts.map(([label, keys], index) => <div key={index}><span>{label}</span><kbd>{keys}</kbd></div>)}</div>
                    <p>{copy('在输入框中，快捷键用于编辑文字；弹窗打开或窗口失去焦点时，不会操作底层画布。', 'Text fields keep their editing shortcuts. Dialogs and inactive windows do not operate the canvas underneath.')}</p>
                    <button type='button' className='nmx-canvas-guide-select-all' onClick={props.onSelectAll}>{t('selectAll')} <kbd>{mod} A</kbd></button></section>
                <section data-guide-section='basic'><h3>{labels.basic}</h3>{entries(basics)}</section>
                <section data-guide-section='navigation'><h3>{labels.navigation}</h3>{entries([
                    [copy('平移画布', 'Pan canvas'), copy('按住空格拖拽，或中键/右键拖拽；W/A/S/D 连续平移。', 'Hold Space and drag, use the middle/right mouse button, or hold W/A/S/D.')],
                    [copy('缩放画布', 'Zoom canvas'), copy('E 放大、Q 缩小，以画布中心为锚点；左下角缩放菜单提供滑块和比例预设。', 'Hold E/Q to zoom around the canvas centre. The bottom-left menu offers a zoom slider and presets.')],
                    [t('fit'), copy('使用缩放菜单中的适合屏幕，或按 Cmd/Ctrl + 0。', 'Use Fit to screen in the zoom menu or press Cmd/Ctrl + 0.')],
                    [copy('导航速度', 'Navigation speed'), copy('在缩放菜单调整快捷键灵敏度和 Shift 加速倍率。', 'Adjust keyboard sensitivity and the Shift multiplier in the zoom menu.')]
                ])}</section>
                <section data-guide-section='advanced'><h3>{labels.advanced}</h3>{entries([
                    [copy('素材库', 'Asset library'), copy('右键图片或视频保存到素材库；在参考输入入口选择素材填入当前节点。', 'Right-click media to save it to the library. Pick a library item from a node’s reference input.')],
                    [copy('模型来源', 'Model sources'), copy('先选中转或自有 API，再选择具体中转商或连接以及它支持的模型。', 'Choose Relay or Own API, then a specific merchant or connection and one of its supported models.')],
                    [copy('历史与对比', 'History and compare'), copy('通过节点历史查看并切换已生成版本；加入对比库可比较图片或视频。', 'View and select generated versions in history, or add media to the comparison library.')],
                    [copy('打组与剪辑', 'Groups and editing'), copy('多选节点后打组或整理；视频的播放顺序连线用于进入剪辑时组织时间线。', 'Group or arrange selected nodes. Video playback links define the sequence used when creating a timeline.')]
                ])}</section>
                <section data-guide-section='settings'><h3>{labels.settings}</h3>{entries([[copy('画布设置', 'Canvas settings'), copy('底部设置入口提供网格、连线、滚轮、整理间距和生成通知等选项。左下角可以直接开关网格和小地图。', 'Canvas settings control the grid, wires, wheel behaviour, arrangement gaps and generation notifications. Toggle the grid and minimap at bottom left.')]])}</section>
                <section data-guide-section='world'><h3>{labels.world}</h3>{entries([[copy('3D 世界与导演台', '3D world and director'), copy('从添加节点菜单创建 3D 世界或导演台，点击节点中的入口进入编辑器；生成能力取决于所选 API 的实际支持。', 'Add a 3D world or director node and use its editor button. Generation capabilities depend on the selected API.')]])}</section>
            </div>
        </section>
    </div></CanvasModalLayer>;
}
