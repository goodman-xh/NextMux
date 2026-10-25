import * as React from '@theia/core/shared/react';
import { platformShortcutText } from './nextmux-shortcut-text';
import {
    Background, BackgroundVariant, BaseEdge, EdgeLabelRenderer, Handle, MarkerType, MiniMap, NodeToolbar, Position, ReactFlow, ReactFlowProvider, SelectionMode,
    applyNodeChanges, getBezierPath, useReactFlow, useViewport,
    type Connection, type Edge as FlowEdge, type EdgeChange, type EdgeProps, type FinalConnectionState, type Node as FlowNode, type NodeChange, type NodeProps
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '../../src/browser/style/nextmux-comic-canvas.css';
import { applyCanvasCommand, resolveCanvasInputs } from '@nextmux/comic-core/canvas';
import type { CanvasAssetVersion, CanvasDocument, CanvasEdge, CanvasFrameSelection, CanvasInputRole, CanvasGenerationMode, CanvasNode, CanvasPoint, PinColor } from '@nextmux/comic-core/canvas';
import {
    isCanvasDurationValid, reconcileCanvasGenerationParameters, resolveCanvasGenerationOptions, validateCanvasGenerationParameters,
    type CanvasCapabilityInput, type CanvasCapabilityIssue, type CanvasDurationRule, type CanvasModelCapability
} from '@nextmux/comic-core/canvas-capabilities';
import { ImeInput, ImeTextarea } from './nextmux-ime-field';
import {
    canvasAlternativeRoles, canvasConnectTargets, canvasCurrentVersion, canvasKindIcon, canvasLatestJob, canvasNodeBusy, canvasOutputKind, canvasPendingUpstream,
    canvasId, canvasVersionReady, connectCanvasNodes, canvasMediaCardSize, canvasBatchPlacementOffset, createCanvasNode, deleteFromCanvas, duplicateCanvasNodes, placeCanvasNode, rerouteCanvasEdge,
    CANVAS_ACTIVE_JOB, type CanvasAddKind
} from './nextmux-comic-canvas-logic';
import { canvasIssueText, canvasText, type CanvasTextKey } from './nextmux-comic-canvas-text';
import { BatchImportDialog } from './nextmux-comic-canvas-batch';
import { CanvasDownloadDialog, canvasDownloadItems, type CanvasDownloadSave } from './nextmux-comic-canvas-download';
import { downloadText } from './nextmux-comic-canvas-download-text';
import type { CanvasDownloadItem } from '../common/nextmux-canvas-download';
import { CanvasFrameExtractDialog, CanvasFrameExtractMenu, ToolDialog, ToolMenu, toolRunsImmediately, type CanvasToolId } from './nextmux-comic-canvas-tools';
import { AiToolDialog, type SavedMarks } from './nextmux-comic-canvas-ai-tools';
import { marksText } from './nextmux-comic-canvas-marks-text';
import { CanvasContinuitySummary, type CanvasContinuityFrame } from './nextmux-comic-continuity';
import { CanvasGenerationHistoryDialog } from './nextmux-comic-canvas-history';
import { canvasHistoryText } from './nextmux-comic-canvas-history-text';
import { CanvasFloatingForm } from './nextmux-comic-canvas-float';
import { CanvasModalLayer } from './nextmux-comic-canvas-modal';
import { CanvasRouteSelector, useCanvasRouteSelection } from './nextmux-comic-canvas-route-selector';
import { useCanvasKeyboard, type CanvasKeyboardViewport, type CanvasShortcut } from './nextmux-comic-canvas-keyboard';
import { CanvasViewControls } from './nextmux-comic-canvas-view-controls';
import { SurfaceTooltips } from './nextmux-surface-tooltips';
import { CanvasAutoDock } from './nextmux-comic-canvas-dock';
import { continuityText } from './nextmux-comic-continuity-text';
import { CanvasAssetLibraryDialog } from './nextmux-comic-asset-library';
import { canvasAssetSaveItems, saveCanvasAssets } from './nextmux-comic-asset-library-save';
import { comicAssetLibraryText } from './nextmux-comic-asset-library-text';
import { canvasLibraryReferenceRoles, removeCanvasDirectReference } from './nextmux-comic-canvas-reference-inputs';
import { CANVAS_DRAG_COPY_THRESHOLD, canvasDragGroupMembers, canvasDragMoveRoots, commitCanvasDragCopy, prepareCanvasDragCopy, type CanvasDragCopyPlan } from './nextmux-comic-canvas-drag-copy';
import type { CanvasAssetLibrarySaveInput, ComicAssetCategory, ComicAssetCategoryOption, ComicAssetLibraryEntry } from '../common/nextmux-comic-asset-library';
import { assertCanvasContinuityInputs } from '@nextmux/comic-core/canvas-continuity';
import type { CanvasImageToolId } from '@nextmux/comic-core/canvas-image-tools';
import { toolText } from './nextmux-comic-canvas-tools-text';
import { StoryboardDialog } from './nextmux-comic-canvas-storyboard';
import { storyboardText } from './nextmux-comic-canvas-storyboard-text';
import type { CanvasStoryboard, CameraSelection } from '@nextmux/comic-core/canvas-camera';
import { CompareWindow, LocatorPanel, PinPicker, PIN_SWATCH, SettingsPanel } from './nextmux-comic-canvas-panels';
import { CameraControl, CameraTags } from './nextmux-comic-canvas-camera';
import { composeCanvasCameraPrompt, deriveCanvasCameraPrompt, type CanvasCameraState } from './nextmux-comic-canvas-camera-state';
import { addCanvasCompareVersion, normalizeCanvasCompareLibrary, removeCanvasCompareVersion, type CanvasCompareLibrary } from './nextmux-comic-canvas-compare';
import { panelText } from './nextmux-comic-canvas-panels-text';
import { CANVAS_SNAP_GRID_SIZE, DEFAULT_CANVAS_SETTINGS, canvasSettingsStorageKey, normalizeCanvasSettings, type CanvasSettings } from './nextmux-comic-canvas-settings';
import { groupCanvasNodes, ungroupCanvas, updateCanvasNodeMembership } from './nextmux-comic-canvas-groups';
import { arrangeCanvas } from './nextmux-comic-canvas-layout';
import { parseCanvasClipboard, pasteCanvasClipboard, serializeCanvasClipboard } from './nextmux-comic-canvas-clipboard';
import { readCanvasClipboardText, readNativeCanvasClipboardText, writeCanvasClipboardText } from './nextmux-comic-canvas-clipboard-access';
import { clearCanvasPins, setCanvasNodePins } from './nextmux-comic-canvas-pins';
import { batchText } from './nextmux-comic-canvas-batch-text';
import { DirectorStage, emptyDirectorScene, type DirectorCapture } from './nextmux-comic-director';
import { directorText } from './nextmux-comic-director-text';
import { canvasOptionAdjustments, canvasOptionsText } from './nextmux-comic-canvas-options-text';
import { comicStartFrameSettings } from './nextmux-comic-start-frame-settings';
import { comicStartFrameText } from './nextmux-comic-start-frame-text';
import { fitCanvasNodeOptions, switchCanvasModeKeepingInputs } from './nextmux-comic-canvas-options';
import { CanvasEdgeAuditPanel } from './nextmux-comic-canvas-edge-audit-panel';
import { canvasEdgeBounds } from './nextmux-comic-canvas-edge-audit';
import { canvasEdgeAuditText } from './nextmux-comic-canvas-edge-audit-text';
import type { ComicDirectorModelImportResult } from '../common/nextmux-director-contracts';

/**
 * 画布 — the comic's infinite canvas, between 编剧 and 剪辑. Characters, their portraits, every shot's storyboard
 * picture and clip are nodes; wires carry results from one node into the next (a storyboard picture becomes its
 * clip's first frame). Nothing runs by itself: a node generates when its 生成 is pressed, or with the selection.
 *
 * The widget owns the document, its saving, the model routes and the jobs; this view edits the document through
 * comic-core's pure commands and reports every change with onChange.
 */

export interface CanvasModelChoice {
    /** Unique per route and model (one own-API connection can serve several models). */
    readonly key: string;
    /** What the desktop service takes: the own-API connection ID, or one fixed platform route. */
    readonly connectionId: string;
    readonly kind: 'image' | 'video';
    readonly modelId: string;
    readonly label: string;
    readonly source: string;
    readonly routeKind?: 'relay' | 'own';
    /** Stable merchant / own-connection identity, independent of model variants and display labels. */
    readonly sourceKey?: string;
    readonly sourceLabel?: string;
}

/** A route of a fixed-list model, with whether it can run (an unchecked route counts while its check runs). */
export interface CanvasModelRoute extends CanvasModelChoice {
    readonly available: boolean;
    readonly reason?: string;
}

/** One model of the canvas's fixed list (spec order) and the routes that serve it. */
export interface CanvasModelFamily {
    readonly id: string;
    readonly name: string;
    readonly vendor: string;
    readonly available: boolean;
    readonly reason?: string;
    readonly routes: readonly CanvasModelRoute[];
}

export interface CanvasCapabilityState {
    readonly capability?: CanvasModelCapability;
    readonly loading?: boolean;
    readonly error?: string;
}

export interface CanvasJobView {
    readonly status: string;
    /** True only for a live, owned media task accepted by the existing cancel action. */
    readonly cancellable?: boolean;
    /** Resume only an already accepted task whose frozen intent is still current. */
    readonly resumable?: boolean;
    /** The same accepted job is being retried; keep retry semantics and disable new generation. */
    readonly retryPending?: boolean;
    /** A recoverable accepted job waits for another media control; it remains Retry, not a new task. */
    readonly retryBlocked?: boolean;
    readonly progress?: number;
    readonly error?: string;
}

export interface ComicCanvasProps {
    readonly locale: string;
    readonly canvas: CanvasDocument;
    readonly saveState: 'saved' | 'saving' | 'dirty' | 'failed';
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    /** The routes of fixed-list models that can run (or are being checked). */
    readonly models: { readonly image: readonly CanvasModelChoice[]; readonly video: readonly CanvasModelChoice[] };
    /** Managed models of the fixed list that the user's privacy settings hide, per kind (shown with a link to the settings). */
    readonly onExportComposition?: (nodeId: string) => void;
    readonly compositionProgress?: (nodeId: string) => { readonly progress: number } | undefined;
    /** The canvas's fixed model list, in spec order, for the two-step picker. */
    readonly families: { readonly image: readonly CanvasModelFamily[]; readonly video: readonly CanvasModelFamily[] };
    readonly routeOf: (node: CanvasNode) => CanvasModelChoice | undefined;
    /** The studio's chosen image/video route: new nodes use it unless the user picks another. */
    readonly defaultRoute: (kind: 'image' | 'video') => CanvasModelChoice | undefined;
    readonly capabilityOf: (choice: CanvasModelChoice) => CanvasCapabilityState;
    readonly jobOf: (node: CanvasNode) => CanvasJobView | undefined;
    /** The amount and input-picture breakdown shown on the paid generate button. */
    readonly estimateOf?: (node: CanvasNode) => string | undefined;
    /** Nodes waiting for an upstream result before they start (a batch run). */
    readonly waiting: ReadonlySet<string>;
    /** Nodes whose generate click is being submitted. */
    readonly submitting: ReadonlySet<string>;
    readonly mediaUrl: (uri: string) => string;
    readonly defaults: { readonly aspectRatio?: string; readonly durationSeconds?: number; readonly frameRate?: number };
    readonly onChange: (next: CanvasDocument, options?: { readonly record?: boolean }) => void;
    readonly onPlanStory?: (nodeId: string) => void;
    readonly storyBusy?: boolean;
    readonly onCancelStory?: () => void;
    readonly storyStatus?: string;
    readonly onUndo: () => void;
    readonly onRedo: () => void;
    readonly onSetRoute: (nodeIds: readonly string[], choice: CanvasModelChoice) => void;
    readonly onRun: (nodeIds: readonly string[]) => void;
    readonly onCancelGeneration?: (nodeId: string, renderedJobId?: string) => void;
    readonly onResumeGeneration?: (nodeId: string, renderedJobId?: string) => void;
    readonly onExtract: (nodeId: string) => void;
    readonly onContinuityFrame: (nodeId: string, versionId: string) => Promise<CanvasContinuityFrame>;
    readonly onExtractVersion?: (nodeId: string, versionId: string, selection: CanvasFrameSelection) => Promise<CanvasContinuityFrame>;
    readonly onVideoInput?: (sourceNodeId: string | undefined, targetNodeId: string, mode?: CanvasGenerationMode) => void;
    readonly onVideoModeIntent?: (nodeId: string) => void;
    readonly onStartFrameSetup?: (nodeId: string) => void;
    readonly startFrameBusy?: (nodeId: string) => boolean;
    readonly startFrameStatus?: (nodeId: string) => import('@nextmux/media-core').MediaJobStatus | undefined;
    readonly onCancelStartFrame?: (nodeId: string) => void;
    readonly assetLibraryCategories: () => Promise<readonly ComicAssetCategoryOption[]>;
    readonly assetLibraryEntries: () => Promise<readonly ComicAssetLibraryEntry[]>;
    readonly loadHistoryCanvases?: () => Promise<readonly CanvasDocument[]>;
    readonly onSelectHistoryVersion?: (canvasId: string, nodeId: string, versionId: string) => Promise<void>;
    readonly onSaveLibraryAsset: (input: CanvasAssetLibrarySaveInput) => Promise<ComicAssetLibraryEntry>;
    readonly onUseLibraryAsset: (assetId: string, position: CanvasPoint, requestId: string, target?: { nodeId: string; role: CanvasInputRole }) => Promise<void>;
    readonly libraryScope?: string;
    readonly onUploadLibrary?: (defaultCategory?: ComicAssetCategory, retryFailed?: boolean) => Promise<readonly ComicAssetLibraryEntry[]>;
    readonly onPinLibrary?: (assetId: string, pinned: boolean) => Promise<void>;
    readonly onCategoryChangeLibrary?: (assetId: string, assetCategory: ComicAssetCategory) => Promise<void>;
    readonly onDeleteLibrary?: (assetId: string) => Promise<void>;
    readonly onAttachReference?: (sourceId: string, targetId: string, role: CanvasInputRole) => void;
    readonly onImport: (position: CanvasPoint, files?: readonly File[], target?: { nodeId: string; role: CanvasInputRole }) => void;
    readonly onUsePortrait: (characterNodeId: string, portraitNodeId: string) => void;
    readonly onRetrySave: () => void;
    readonly onNotice: (text: string) => void;
    /** Local media tools: nodes being processed (fraction when known), run one, cancel it, pick a LUT file. */
    readonly toolProgress: ReadonlyMap<string, number | undefined>;
    /** Resolves with the nodes the tool added (false when it did not finish). */
    readonly onTool: (nodeId: string, tool: CanvasToolId, parameters: Readonly<Record<string, unknown>>) => Promise<readonly CanvasNode[] | false>;
    readonly onCancelTool: (nodeId: string) => void;
    readonly onPickLut: () => Promise<string | undefined>;
    readonly onDirectorCapture: (nodeId: string, capture: DirectorCapture) => Promise<void>;
    /** 标记修图: save the marked picture as an image node; resolves with the canvas that now holds it. */
    readonly onSaveMarks: (request: { readonly nodeId: string; readonly versionId: string; readonly picture: Blob; readonly title: string; readonly position: CanvasPoint })
        => Promise<{ readonly canvas: CanvasDocument; readonly nodeId: string; readonly version: CanvasAssetVersion }>;
    readonly onDirectorImport: (file: File) => Promise<ComicDirectorModelImportResult>;
    readonly onDownload?: CanvasDownloadSave;
}

type T = (key: CanvasTextKey, values?: Record<string, string | number>) => string;

interface CanvasContextValue {
    readonly props: ComicCanvasProps;
    readonly t: T;
    readonly nodes: ReadonlyMap<string, CanvasNode>;
    readonly single?: string;
    readonly renaming?: string;
    readonly setRenaming: (id?: string) => void;
    readonly selectNode: (id: string) => void;
    readonly change: (next: CanvasDocument, record?: boolean) => void;
    readonly menuFor: (event: React.MouseEvent, nodeId: string) => void;
    readonly open: (uri: string, kind: 'image' | 'video') => void;
    /** 生成 through the optional countdown (settings) before the paid submit. */
    readonly run: (nodeIds: readonly string[]) => void;
    readonly openTool: (nodeId: string, tool: CanvasToolId) => void;
    readonly aiEdit: (nodeId: string, tool: CanvasImageToolId) => void;
    readonly extractFrame: (nodeId: string, versionId: string, choice: 'first' | 'last' | 'custom') => void;
    readonly pickReference: (nodeId: string, role: CanvasInputRole) => void;
    readonly saveAssets: (nodeIds: readonly string[]) => void;
    readonly download: (nodeIds: readonly string[]) => void;
    readonly openHistory: (nodeId?: string) => void;
    readonly openStoryboard: (nodeId: string, prompt: string) => void;
    readonly openDirector: (nodeId: string) => void;
    readonly compare: CanvasCompareLibrary;
    readonly toggleCompare: (nodeId: string) => void;
}

const CanvasContext = React.createContext<CanvasContextValue | undefined>(undefined);
const now = (): string => new Date().toISOString();

/** Keep the exact compiled prefix beside the text, including its single body separator. */
function withCameraState(canvas: CanvasDocument, nodeId: string, state: CanvasCameraState | undefined): CanvasDocument {
    const cameras = (canvas.settings.nodeCamera ?? {}) as Readonly<Record<string, CanvasCameraState>>;
    if (!state && cameras[nodeId] === undefined) return canvas;
    const { [nodeId]: _old, ...others } = cameras;
    return { ...canvas, settings: { ...canvas.settings, nodeCamera: state ? { ...others, [nodeId]: state } : others } };
}

function flowType(node: CanvasNode): string {
    return node.kind === 'group' ? 'canvasGroup' : 'canvasCard';
}

function originLabel(t: T, node: CanvasNode): string | undefined {
    const role = node.origin?.role;
    return role && ['portrait', 'storyboard', 'shotVideo', 'script', 'scene'].includes(role) ? t(`origin.${role}` as CanvasTextKey) : undefined;
}

/** Seeded titles carried an English suffix (“林澈 · Portrait”); the role chip says it in the user's language. */
function displayTitle(node: CanvasNode): string {
    return node.title.replace(/\s·\s(?:Portrait|Storyboard|Video)$/u, '');
}

function capabilityInputs(canvas: CanvasDocument, nodeId: string): readonly CanvasCapabilityInput[] {
    try {
        return resolveCanvasInputs(canvas, nodeId).inputs.map(input => ({ role: input.role, kind: input.kind, versionId: input.versionId,
            ...(input.edgeId ? { edgeId: input.edgeId } : {}), ...(input.metadata ? { metadata: input.metadata } : {}) }));
    } catch { return []; }
}

/** Everything that stops a node from generating now, in the user's language. */
function nodeProblems(t: T, locale: string, canvas: CanvasDocument, node: CanvasNode, capability: CanvasCapabilityState | undefined, hasRoute: boolean): {
    readonly blocking: readonly string[]; readonly upstream: readonly string[]; readonly issues: readonly CanvasCapabilityIssue[] } {
    if (node.kind !== 'imageGen' && node.kind !== 'videoGen') return { blocking: [], upstream: [], issues: [] };
    const blocking: string[] = [];
    if (!hasRoute) blocking.push(t('issue.NO_MODEL'));
    let missing: ReturnType<typeof resolveCanvasInputs>['missing'] = [];
    try {
        const resolved = resolveCanvasInputs(canvas, node.id);
        missing = resolved.missing;
        if (node.payload.continuity) {
            try { assertCanvasContinuityInputs(node.payload.continuity, resolved.inputs, node.payload.mode); }
            catch { blocking.push(continuityText(locale, 'invalid')); }
        }
    } catch { if (node.payload.continuity) blocking.push(continuityText(locale, 'invalid')); }
    const upstream = canvasPendingUpstream(canvas, node.id);
    for (const item of missing) {
        if (item.reason === 'noResult' && item.sourceNodeId && upstream.includes(item.sourceNodeId)) continue;
        blocking.push(t('issue.missing', { role: t(`role.${item.role}` as CanvasTextKey), reason: t(`missing.${item.reason}` as CanvasTextKey) }));
    }
    const content = node.kind === 'videoGen' ? deriveCanvasCameraPrompt(node.payload.prompt,
        (canvas.settings.nodeCamera as Readonly<Record<string, unknown>> | undefined)?.[node.id]).body : node.payload.prompt;
    if (!content.trim() && !canvas.edges.some(edge => edge.targetNodeId === node.id && edge.role === 'prompt')) blocking.push(t('promptPlaceholder'));
    const issues = capability?.capability ? validateCanvasGenerationParameters(capability.capability, node.payload.mode, node.payload.parameters, capabilityInputs(canvas, node.id)) : [];
    const field: Record<string, CanvasTextKey> = { resolution: 'resolution', aspectRatio: 'aspect', durationSeconds: 'duration', generateAudio: 'audio', mode: 'mode', modelId: 'model' };
    for (const issue of issues) {
        if (issue.code === 'MODE_UNSUPPORTED') { blocking.push(t('issue.MODE_UNSUPPORTED', { mode: t(`mode.${node.payload.mode}` as CanvasTextKey) })); continue; }
        const what = field[issue.path];
        blocking.push(issue.code === 'CAPABILITY_UNKNOWN' && what ? `${canvasIssueText(locale, issue)}（${t(what)}）` : canvasIssueText(locale, issue));
    }
    if (hasRoute && capability?.error) blocking.push(t('capabilityFailed', { error: capability.error }));
    return { blocking: [...new Set(blocking)], upstream, issues };
}

function statusOf(props: ComicCanvasProps, node: CanvasNode): { readonly key: string; readonly busy: boolean; readonly error?: string; readonly progress?: number } {
    if (props.submitting.has(node.id)) return { key: 'reserved', busy: true };
    const live = props.jobOf(node);
    const job = canvasLatestJob(node);
    const status = live?.status ?? job?.status;
    if (status && CANVAS_ACTIVE_JOB.has(status)) return { key: status, busy: true, ...(live?.progress !== undefined ? { progress: live.progress } : {}) };
    if (props.waiting.has(node.id)) return { key: 'waiting', busy: true };
    if (status === 'failed' || status === 'cancelled') return { key: status, busy: false, error: live?.error ?? job?.error?.message };
    return { key: canvasCurrentVersion(node) ? 'succeeded' : 'idle', busy: false };
}

// ——— nodes ———

function MediaPreview(props: { readonly node: CanvasNode; readonly url: (uri: string) => string; readonly onOpen: (uri: string, kind: 'image' | 'video') => void }): React.ReactElement | null {
    const version = canvasCurrentVersion(props.node);
    if (!version || !canvasVersionReady(version)) return null;
    const src = props.url(version.uri);
    if (version.kind === 'video') {
        return <video className='nmx-board-media' src={src} muted loop playsInline preload='metadata'
            onMouseEnter={event => { void event.currentTarget.play().catch(() => undefined); }}
            onMouseLeave={event => { event.currentTarget.pause(); }}
            onDoubleClick={() => props.onOpen(version.uri, 'video')} />;
    }
    if (version.kind === 'audio') return <audio className='nmx-board-audio' src={src} controls preload='metadata' />;
    return <img className='nmx-board-media' src={src} alt='' draggable={false} onDoubleClick={() => props.onOpen(version.uri, 'image')} />;
}

function VersionSwitcher(props: { readonly node: CanvasNode; readonly t: T; readonly change: (next: CanvasDocument, record?: boolean) => void; readonly canvas: CanvasDocument }): React.ReactElement | null {
    const { node, t } = props;
    if (!('versions' in node.payload) || node.payload.versions.length < 2) return null;
    const versions = node.payload.versions;
    const index = Math.max(0, versions.findIndex(version => version.id === (node.payload as { currentVersionId?: string }).currentVersionId));
    const pick = (to: number): void => {
        const version = versions[(to + versions.length) % versions.length];
        props.change(applyCanvasCommand(props.canvas, { type: 'node.selectVersion', nodeId: node.id, versionId: version.id }, { now: now() }), true);
    };
    return <div className='nmx-board-versions nodrag' onMouseDown={event => event.stopPropagation()}>
        <button type='button' title={t('previousVersion')} aria-label={t('previousVersion')} onClick={() => pick(index - 1)}><i className='codicon codicon-chevron-left'></i></button>
        <span data-nmx-literal>{t('version', { i: index + 1, n: versions.length })}</span>
        <button type='button' title={t('nextVersion')} aria-label={t('nextVersion')} onClick={() => pick(index + 1)}><i className='codicon codicon-chevron-right'></i></button>
    </div>;
}

function CanvasCard(flow: NodeProps): React.ReactElement | null {
    const context = React.useContext(CanvasContext)!;
    const { props, t } = context;
    const node = context.nodes.get(flow.id);
    if (!node) return null;
    const canvas = props.canvas;
    const status = statusOf(props, node);
    const generation = node.kind === 'imageGen' || node.kind === 'videoGen';
    const version = canvasCurrentVersion(node);
    const takesInput = generation || node.kind === 'frameExtract' || node.kind === 'composition' || node.kind === 'sceneComposer' || node.kind === 'world';
    const output = canvasOutputKind(node);
    const origin = originLabel(t, node);
    const single = context.single === node.id;
    const title = displayTitle(node);
    const statusText = status.key === 'waiting' ? t('status.waiting') : t(`status.${status.key}` as CanvasTextKey);
    const hasReference = generation && (canvas.edges.some(edge => edge.targetNodeId === node.id && ['firstFrame', 'lastFrame', 'referenceImage', 'referenceVideo', 'referenceAudio'].includes(edge.role))
        || 'inputs' in node.payload && Boolean(node.payload.inputs?.length));
    return <div className={`nmx-board-node is-${node.kind}${flow.selected ? ' is-selected' : ''}${status.busy ? ' is-busy' : ''}${status.key === 'failed' ? ' is-failed' : ''}${node.orphaned ? ' is-orphaned' : ''}`}
        onContextMenu={event => context.menuFor(event, node.id)}>
        <header className='nmx-board-node-title'>
            <i className={`codicon codicon-${canvasKindIcon(node.kind)}`} aria-hidden='true'></i>
            {context.renaming === node.id
                ? <ImeInput className='nmx-board-rename nodrag' autoFocus defaultValue={title} onKeyDown={event => {
                    if (event.key === 'Enter') { event.currentTarget.blur(); }
                    if (event.key === 'Escape') { context.setRenaming(undefined); }
                    event.stopPropagation();
                }} onBlur={event => {
                    const value = event.currentTarget.value.trim();
                    context.setRenaming(undefined);
                    if (value && value !== title) context.change({ ...canvas, nodes: canvas.nodes.map(item => item.id === node.id ? { ...item, title: value } : item) }, true);
                }} />
                : <span className='nmx-board-node-name' data-nmx-literal title={origin ? `${title} · ${origin}` : title} onDoubleClick={() => context.setRenaming(node.id)}>{title}</span>}
            {node.pinnedColors?.length ? <span className='nmx-board-node-pins'>{node.pinnedColors.map(color => <i key={color} style={{ background: PIN_SWATCH[color as PinColor] }} />)}</span> : undefined}
            {generation && (status.busy || status.key === 'failed') && <small className={`nmx-board-node-state is-${status.key}`}>{statusText}</small>}
        </header>
        <div className='nmx-board-node-body'>
            {(node.kind === 'sceneComposer' || node.kind === 'world') && <button type='button' className='nmx-director-open nodrag' onClick={() => context.openDirector(node.id)}>
                {directorText(props.locale, node.kind === 'world' ? 'world' : 'stage')}</button>}
            {node.kind === 'text' && <TextBody node={node} />}
            {node.kind === 'character' && <CharacterBody node={node} />}
            {node.kind !== 'text' && node.kind !== 'character' && <>
                <MediaPreview node={node} url={props.mediaUrl} onOpen={context.open} />
                {!version && <div className='nmx-board-placeholder'>
                    <i className={`codicon codicon-${canvasKindIcon(node.kind)}`} aria-hidden='true'></i>
                    <span>{node.kind === 'frameExtract' ? t('extract') : hasReference ? comicAssetLibraryText(props.locale, 'referenceAdded') : generation ? t('promptPlaceholder') : t('noResult')}</span>
                </div>}
                {props.toolProgress.has(node.id) && <div className='nmx-board-progress' role='status'>
                    <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>
                    <span>{toolText(props.locale, 'running')}{props.toolProgress.get(node.id) !== undefined ? ` ${Math.round((props.toolProgress.get(node.id) ?? 0) * 100)}%` : ''}</span>
                </div>}
                {status.busy && <div className='nmx-board-progress' role='status'>
                    <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>
                    <span>{statusText}{status.progress !== undefined ? ` ${Math.round(status.progress)}%` : ''}</span>
                </div>}
                {status.key === 'failed' && status.error && <div className='nmx-board-error' title={status.error} data-nmx-literal>{status.error}</div>}
            </>}
            {node.orphaned && <div className='nmx-board-orphaned'>{t('orphaned')}</div>}
            {flow.selected && <VersionSwitcher node={node} t={t} change={context.change} canvas={canvas} />}
        </div>
        {takesInput && <Handle type='target' position={Position.Left} className='nmx-board-handle is-in' />}
        {output !== 'group' && <Handle type='source' position={Position.Right} className={`nmx-board-handle is-out is-${output}`} />}
        {output === 'video' && <>
            <Handle id='sequence-in' type='target' position={Position.Left} className='nmx-board-handle is-sequence' style={{ top: '84%' }} data-help={props.locale.startsWith('zh') ? '播放顺序：连接上一个视频' : 'Playback order: connect the previous video'} />
            <Handle id='sequence-out' type='source' position={Position.Right} className='nmx-board-handle is-sequence' style={{ top: '84%' }} data-help={props.locale.startsWith('zh') ? '播放顺序：拖到下一个视频的顺序入口' : 'Playback order: drag to the next video sequence input'} />
        </>}
        {single && <NodeToolbar position={Position.Top} offset={34} className='nmx-board-toolbar nodrag'><NodeActions node={node} /></NodeToolbar>}
    </div>;
}

/** Match the reference NodeToolbar: screen-sized form, centered below its owner, no viewport clamping. */
function NodePanelOverlay(props: { readonly nodeId: string; readonly hidden: boolean }): React.ReactElement | null {
    const context = React.useContext(CanvasContext)!;
    const { x, y, zoom } = useViewport();
    const node = context.nodes.get(props.nodeId);
    if (!node || !(node.kind === 'imageGen' || node.kind === 'videoGen' || node.kind === 'frameExtract' || node.kind === 'composition')) return null;
    const left = (node.position.x + node.size.width / 2) * zoom + x;
    const top = (node.position.y + node.size.height) * zoom + y + 10;
    return <div className='nmx-board-panel-layer nodrag nopan nowheel' data-node-panel={node.id}
        data-interacting={props.hidden ? 'true' : 'false'} style={{ left, top, visibility: props.hidden ? 'hidden' : undefined }}>
        {node.kind === 'frameExtract' ? <FramePanel node={node} /> : <CanvasFloatingForm locale={context.props.locale} title={node.title || context.t(`kind.${node.kind}` as CanvasTextKey)}>
        {node.kind === 'videoGen' && node.payload.continuity && <CanvasContinuitySummary locale={context.props.locale} canvas={context.props.canvas} nodeId={node.id} record={node.payload.continuity}
            onRemove={() => { const { continuity: _removed, ...payload } = node.payload; context.change({ ...context.props.canvas,
                nodes: context.props.canvas.nodes.map(item => item.id === node.id ? { ...node, payload } : item) }, true); }} />}
        {node.kind === 'composition' ? <CompositionPanel node={node} /> : <GenerationPanel node={node} />}
        </CanvasFloatingForm>}
    </div>;
}

function TextBody(props: { readonly node: Extract<CanvasNode, { kind: 'text' }> }): React.ReactElement {
    return <InlineCanvasText node={props.node} />;
}

/** Edit the actual card. Each focus session is one undo step; every committed IME change is saved. */
function InlineCanvasText({ node }: { readonly node: Extract<CanvasNode, { kind: 'text' | 'imageGen' | 'videoGen' }> }): React.ReactElement {
    const context = React.useContext(CanvasContext)!;
    const current = React.useRef(context); current.current = context;
    const recorded = React.useRef(false);
    const composing = React.useRef(false);
    const value = node.kind === 'text' ? node.payload.text : node.kind === 'videoGen' ? deriveCanvasCameraPrompt(node.payload.prompt,
        (context.props.canvas.settings.nodeCamera as Readonly<Record<string, unknown>> | undefined)?.[node.id]).body : node.payload.prompt;
    const published = React.useRef(value);
    const pending = React.useRef<string[]>([]);
    const [draft, setDraft] = React.useState(value);
    React.useEffect(() => {
        const acknowledged = pending.current.lastIndexOf(value);
        if (acknowledged >= 0) {
            pending.current.splice(0, acknowledged + 1);
            // Widget renders are batched. An acknowledgement of an earlier
            // keystroke must not replace text entered since that render began.
            if (pending.current.length) return;
        } else pending.current = [];
        published.current = value; setDraft(value);
    }, [value]);
    const commit = (text: string): void => {
        if (text === published.current) return;
        const owner = current.current, canvas = owner.props.canvas;
        const latest = canvas.nodes.find(item => item.id === node.id);
        if (!latest || latest.kind !== 'text' && latest.kind !== 'imageGen' && latest.kind !== 'videoGen') return;
        const camera = latest.kind === 'videoGen' ? deriveCanvasCameraPrompt(latest.payload.prompt,
            (canvas.settings.nodeCamera as Readonly<Record<string, unknown>> | undefined)?.[node.id]) : undefined;
        if (text === (latest.kind === 'text' ? latest.payload.text : camera?.body ?? latest.payload.prompt)) return;
        // Explicit typing establishes authored text; only untouched legacy documents infer camera tokens.
        const cameraEdit = latest.kind === 'videoGen' ? composeCanvasCameraPrompt(text, camera?.state?.selection ?? { movements: [], speed: 'normal' }) : undefined;
        const prompt = cameraEdit?.prompt ?? text;
        let next = latest.kind === 'text'
            ? { ...canvas, revision: canvas.revision + 1, updatedAt: now(), nodes: canvas.nodes.map(item => item.id === node.id ? { ...latest, payload: { text } } : item) }
            : applyCanvasCommand(canvas, { type: 'node.setParameters', nodeId: node.id, parameters: latest.payload.parameters, prompt }, { now: now() });
        if (cameraEdit) next = withCameraState(next, node.id, cameraEdit.state);
        published.current = text; pending.current.push(text); owner.change(next, !recorded.current); recorded.current = true;
    };
    return <ImeTextarea className='nmx-board-inline-text nodrag nopan nowheel' value={draft} rows={node.kind === 'text' ? 4 : 3}
        aria-label={context.t(node.kind === 'text' ? 'textPlaceholder' : 'prompt')}
        placeholder={context.t(node.kind === 'text' ? 'textPlaceholder' : 'promptPlaceholder')}
        onFocus={() => context.selectNode(node.id)} onBlur={() => { recorded.current = false; }}
        onMouseDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}
        onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !event.nativeEvent.isComposing) event.currentTarget.blur(); }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={event => { composing.current = false; setDraft(event.currentTarget.value); commit(event.currentTarget.value); }}
        onChange={event => {
            const text = event.currentTarget.value; setDraft(text);
            if (!composing.current) commit(text);
        }} />;
}

function CharacterBody(props: { readonly node: Extract<CanvasNode, { kind: 'character' }> }): React.ReactElement {
    const context = React.useContext(CanvasContext)!;
    const { node } = props;
    const version = canvasCurrentVersion(node);
    return <div className='nmx-board-character'>
        {version && canvasVersionReady(version)
            ? <img src={context.props.mediaUrl(version.uri)} alt='' draggable={false} onDoubleClick={() => context.open(version.uri, 'image')} />
            : <div className='nmx-board-placeholder'><i className='codicon codicon-person' aria-hidden='true'></i><span>{context.t('characterNoPortrait')}</span></div>}
        <div className='nmx-board-character-text'>
            {node.payload.description && <strong data-nmx-literal>{node.payload.description}</strong>}
            {node.payload.appearance && <p data-nmx-literal>{node.payload.appearance}</p>}
            <button type='button' className='nodrag' title={context.props.locale.startsWith('zh') ? '从素材库选择人物定妆照' : 'Choose a portrait from the asset library'} onClick={() => context.pickReference(node.id, 'referenceImage')}><i className='codicon codicon-library' />{context.props.locale.startsWith('zh') ? '选择定妆照' : 'Choose portrait'}</button>
            <button type='button' className='nodrag' title={context.t('uploadHint')} onClick={() => context.props.onImport({ x: node.position.x, y: node.position.y - 300 }, undefined, { nodeId: node.id, role: 'referenceImage' })}>{context.t('upload')}</button>
        </div>
    </div>;
}

function NodeActions(props: { readonly node: CanvasNode }): React.ReactElement {
    const context = React.useContext(CanvasContext)!;
    const { t } = context;
    const { node } = props;
    const canvas = context.props.canvas;
    const version = canvasCurrentVersion(node);
    // A portrait node's picture can become its character's portrait (the project's reference for every later clip).
    const portraitOf = node.kind === 'imageGen' && version ? canvas.edges
        .filter(edge => edge.targetNodeId === node.id).map(edge => canvas.nodes.find(item => item.id === edge.sourceNodeId))
        .find(source => source?.kind === 'character') : undefined;
    const [pinning, setPinning] = React.useState(false);
    const [toolsOpen, setToolsOpen] = React.useState(false);
    const [frameMenuOpen, setFrameMenuOpen] = React.useState(false);
    // Tool, frame and pin popovers close on any press outside them (their toggles live in this toolbar) or Escape.
    const popoverOpen = toolsOpen || frameMenuOpen || pinning;
    React.useEffect(() => {
        if (!popoverOpen) return;
        const close = (): void => { setToolsOpen(false); setFrameMenuOpen(false); setPinning(false); };
        const onPointerDown = (event: PointerEvent): void => {
            const target = event.target instanceof Element ? event.target : (event.target as Node | null)?.parentElement;
            if (!target?.closest('.nmx-board-tools, .nmx-board-pins, .nmx-board-toolbar')) close();
        };
        const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229) close(); };
        document.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('keydown', onKeyDown, true);
        return () => { document.removeEventListener('pointerdown', onPointerDown, true); window.removeEventListener('keydown', onKeyDown, true); };
    }, [popoverOpen]);
    const mediaKind = version && canvasVersionReady(version) ? version.kind : undefined;
    const action = (icon: string, label: string, run: () => void, disabled = false): React.ReactElement =>
        <button type='button' key={label} title={label} aria-label={label} disabled={disabled} onClick={run}><i className={`codicon codicon-${icon}`} aria-hidden='true'></i><span>{label}</span></button>;
    return <>
        {('versions' in node.payload) && action('history', canvasHistoryText(context.props.locale, 'title'), () => context.openHistory(node.id))}
        {version && canvasVersionReady(version) && version.kind !== 'audio' && action('screen-full', t('open'), () => context.open(version.uri, version.kind === 'video' ? 'video' : 'image'))}
        {version?.kind === 'video' && context.props.onExtractVersion && action('device-camera', t('extract'), () => { setToolsOpen(false); setPinning(false); setFrameMenuOpen(!frameMenuOpen); }, context.props.submitting.has(node.id))}
        {frameMenuOpen && version?.kind === 'video' && <CanvasFrameExtractMenu locale={context.props.locale} busy={context.props.submitting.has(node.id)}
            onClose={() => setFrameMenuOpen(false)} onPick={choice => { setFrameMenuOpen(false); context.extractFrame(node.id, version.id, choice); }} />}
        {portraitOf && action('person', t('usePortrait'), () => context.props.onUsePortrait(portraitOf.id, node.id))}
        {(mediaKind || node.kind === 'text' && node.payload.text.trim()) && action('save', comicAssetLibraryText(context.props.locale, 'save'), () => context.saveAssets([node.id]))}
        {(mediaKind === 'image' || mediaKind === 'video') && version && action('diff', toolText(context.props.locale, context.compare.some(entry => entry.uri === version.uri) ? 'compareRemove' : 'compareAdd'), () => context.toggleCompare(node.id))}
        {mediaKind && context.props.onDownload && action('desktop-download', downloadText(context.props.locale, 'download'), () => context.download([node.id]), canvasDownloadItems([node]).length === 0)}
        {mediaKind && action('tools', toolText(context.props.locale, 'tools'), () => { setFrameMenuOpen(false); setPinning(false); setToolsOpen(!toolsOpen); })}
        {toolsOpen && mediaKind && <ToolMenu locale={context.props.locale} kind={mediaKind} onPick={tool => { setToolsOpen(false); context.openTool(node.id, tool); }}
            onPickAi={edit => { setToolsOpen(false); context.aiEdit(node.id, edit); }} />}
        {action('pin', panelText(context.props.locale, 'pin'), () => { setToolsOpen(false); setFrameMenuOpen(false); setPinning(!pinning); })}
        {pinning && <PinPicker locale={context.props.locale} node={node} onChange={colors => context.change(setCanvasNodePins(canvas, node.id, colors, now()), true)} />}
        {node.kind === 'text' && context.props.onPlanStory && action('list-ordered', context.props.locale.startsWith('zh') ? 'AI 拆成镜头并按播放顺序连接' : 'Create connected shots from this story', () => context.props.onPlanStory!(node.id), context.props.storyBusy || !node.payload.text.trim())}
    </>;
}

/** The bottom bar of a selected generation node: prompt, model and its settings, inputs, 生成. */
function ReferenceMedia({ version, label, mediaUrl }: { readonly version: CanvasAssetVersion | undefined; readonly label: string; readonly mediaUrl: (uri: string) => string }): React.ReactElement {
    const [failed, setFailed] = React.useState(false);
    if (version && canvasVersionReady(version) && !failed) {
        if (version.kind === 'image') return <img src={mediaUrl(version.uri)} alt={label} onError={() => setFailed(true)} />;
        if (version.kind === 'video') return <video src={mediaUrl(version.uri)} muted playsInline preload='metadata' aria-label={label} onError={() => setFailed(true)} />;
    }
    return <i className={`codicon codicon-${version?.kind === 'audio' ? 'unmute' : 'device-camera-video'}`} aria-label={label} />;
}

function ReferenceInputs({ node }: { readonly node: Extract<CanvasNode, { kind: 'imageGen' | 'videoGen' }> }): React.ReactElement | null {
    const context = React.useContext(CanvasContext)!, owner = context.props, zh = owner.locale.startsWith('zh');
    const route = owner.routeOf(node);
    const availableRoles = canvasLibraryReferenceRoles(node, route ? owner.capabilityOf(route).capability : undefined);
    // Persisted references remain visible/removable even after the route stops supporting their role.
    const roles = [...new Set([...availableRoles, ...owner.canvas.edges.filter(edge => edge.targetNodeId === node.id).map(edge => edge.role),
        ...(node.payload.inputs ?? []).map(input => input.role)])].filter(role => ['firstFrame', 'lastFrame', 'referenceImage', 'referenceVideo', 'referenceAudio'].includes(role));
    const rootRef = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        const onMouseDown = (event: MouseEvent): void => {
            const root = rootRef.current;
            if (!root) return;
            for (const details of root.querySelectorAll<HTMLDetailsElement>('details.nmx-board-reference-picker[open]')) {
                if (!(event.target instanceof Node && details.contains(event.target))) details.removeAttribute('open');
            }
        };
        document.addEventListener('mousedown', onMouseDown);
        return () => document.removeEventListener('mousedown', onMouseDown);
    }, []);
    if (!roles.length) return null;
    return <div ref={rootRef} className='nmx-board-reference-inputs'>{roles.map(role => {
        const mediaKind = role === 'referenceVideo' ? 'video' : role === 'referenceAudio' ? 'audio' : 'image';
        const candidates = owner.canvas.nodes.filter(item => item.id !== node.id && canvasCurrentVersion(item)?.kind === mediaKind && canvasVersionReady(canvasCurrentVersion(item)!));
        const edges = owner.canvas.edges.filter(item => item.targetNodeId === node.id && item.role === role);
        return <div key={role} className='nmx-board-reference-slot' data-reference-role={role}>
            {edges.map(edge => {
                const source = owner.canvas.nodes.find(item => item.id === edge.sourceNodeId);
                const payload = source && 'versions' in source.payload ? source.payload : undefined;
                const versionId = edge.binding === 'pinnedVersion' ? edge.pinnedVersionId : payload?.currentVersionId;
                const version = payload?.versions.find(item => item.id === versionId);
                return <div className='nmx-board-reference-thumb' key={edge.id} title={source?.title}>
                    <ReferenceMedia key={version?.id ?? edge.id} version={version} label={source?.title ?? context.t(`role.${role}` as CanvasTextKey)} mediaUrl={owner.mediaUrl} />
                    <button type='button' title={context.t('removeEdge')} aria-label={context.t('removeEdge')} onClick={() => context.change(deleteFromCanvas(owner.canvas, [], [edge.id], now()), true)}>×</button>
                </div>;
            })}
            {(node.payload.inputs ?? []).filter(input => input.role === role).map(input => {
                const version = input.version, metadata = version.metadata;
                const description = [context.t(`role.${role}` as CanvasTextKey), metadata?.width && metadata?.height ? `${metadata.width} × ${metadata.height}` : '',
                    metadata?.durationMs !== undefined ? `${(metadata.durationMs / 1000).toFixed(2)} s` : '', metadata?.mimeType ?? ''].filter(Boolean).join(' · ');
                return <div className='nmx-board-reference-thumb' key={`direct:${input.id}`} data-direct-input={input.id} title={description}>
                    <ReferenceMedia key={version.id} version={version} label={description} mediaUrl={owner.mediaUrl} />
                    <button type='button' title={context.t('removeReference')} aria-label={context.t('removeReference')} onClick={() => context.change(removeCanvasDirectReference(owner.canvas, node.id, input.id, now()), true)}>×</button>
                </div>;
            })}
            {availableRoles.includes(role) && <details className='nmx-board-reference-picker' onKeyDown={event => {
                if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); event.currentTarget.removeAttribute('open'); }
            }}>
                <summary title={context.t(`role.${role}` as CanvasTextKey)} aria-label={`${context.t(`role.${role}` as CanvasTextKey)} · ${context.t('add')}`}><i className='codicon codicon-add' aria-hidden='true' /><span>{context.t(`role.${role}` as CanvasTextKey)}</span></summary>
                <div className='nmx-board-reference-row'>
                    <select aria-label={`${context.t(`role.${role}` as CanvasTextKey)} · ${zh ? '选择画布素材' : 'Canvas assets'}`} value='' onChange={event => {
                        if (event.currentTarget.value) { event.currentTarget.closest('details')?.removeAttribute('open'); owner.onAttachReference?.(event.currentTarget.value, node.id, role); }
                    }}><option value=''>{zh ? '选择画布素材' : 'Choose canvas asset'}</option>{candidates.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
                    <button type='button' title={zh ? '从素材库选择参考素材或人物照片' : 'Choose a reference or character photo from the library'} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); context.pickReference(node.id, role); }}>{zh ? '素材库' : 'Library'}</button>
                    <button type='button' title={`${context.t('upload')} · ${context.t(`role.${role}` as CanvasTextKey)}`} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); owner.onImport({ x: node.position.x, y: node.position.y - 300 }, undefined, { nodeId: node.id, role }); }}>{context.t('upload')}</button>
                </div>
            </details>}
        </div>;

    })}</div>;
}

function GenerationPanel(props: { readonly node: Extract<CanvasNode, { kind: 'imageGen' | 'videoGen' }> }): React.ReactElement {
    const context = React.useContext(CanvasContext)!;
    const { t } = context;
    const { node } = props;
    const owner = context.props;
    const canvas = owner.canvas;
    const kind = node.kind === 'imageGen' ? 'image' : 'video';
    const route = owner.routeOf(node);
    const capability = route ? owner.capabilityOf(route) : undefined;
    const model = capability?.capability;
    const resolved = model ? resolveCanvasGenerationOptions(model, node.payload.mode, node.payload.parameters, capabilityInputs(canvas, node.id)) : undefined;
    const [prompt, setPrompt] = React.useState(node.payload.prompt);
    const seen = React.useRef(node.payload.prompt);
    if (seen.current !== node.payload.prompt) { seen.current = node.payload.prompt; if (prompt !== node.payload.prompt) setPrompt(node.payload.prompt); }
    // The prompt is saved on blur; readiness already follows what is typed, so 生成 is usable while the field still has focus.
    const draft = prompt === node.payload.prompt ? node : { ...node, payload: { ...node.payload, prompt } } as typeof node;
    const problems = nodeProblems(t, owner.locale, draft === node ? canvas : { ...canvas, nodes: canvas.nodes.map(item => item.id === node.id ? draft : item) }, draft, capability, Boolean(route));
    const status = statusOf(owner, node);
    const estimate = owner.estimateOf?.(node);
    const commitPrompt = (value: string): void => {
        if (value === node.payload.prompt || value === seen.current) return;
        seen.current = value;
        owner.onChange(applyCanvasCommand(canvas, { type: 'node.setParameters', nodeId: node.id, parameters: node.payload.parameters, prompt: value }, { now: now() }), { record: true });
    };
    const setParameters = (patch: Record<string, unknown>): void => {
        const parameters: Record<string, unknown> = { ...node.payload.parameters, ...patch };
        for (const [key, value] of Object.entries(patch)) if (value === undefined) delete parameters[key];
        // Keep an unfinished numeric edit visible for validation. Other controls cascade immediately.
        const editingInvalidDuration = patch.durationSeconds !== undefined && resolved?.duration && !isCanvasDurationValid(resolved.duration, patch.durationSeconds);
        const result = model && !editingInvalidDuration ? reconcileCanvasGenerationParameters(model, node.payload.mode, parameters, capabilityInputs(canvas, node.id)) : undefined;
        let next = applyCanvasCommand(canvas, { type: 'node.setParameters', nodeId: node.id,
            parameters: result?.mode === node.payload.mode ? result.parameters : parameters,
            ...(result?.mode === node.payload.mode ? { optionDecision: result.optionDecision } : {}) }, { now: now() });
        if (typeof patch.aspectRatio === 'string' && patch.aspectRatio !== 'auto') {
            const changed = next.nodes.find(item => item.id === node.id);
            if (changed && (changed.kind === 'imageGen' || changed.kind === 'videoGen')) next = applyCanvasCommand(next,
                { type: 'node.resize', nodeId: node.id, size: canvasMediaCardSize(String(changed.payload.parameters.aspectRatio ?? patch.aspectRatio)) }, { now: now() });
        }
        owner.onChange(next, { record: true });
    };
    const setMode = (mode: CanvasGenerationMode): void => {
        owner.onVideoModeIntent?.(node.id);
        const chosen = node.kind === 'videoGen' ? { ...canvas, settings: { ...canvas.settings,
            manualVideoModes: { ...(canvas.settings.manualVideoModes as Record<string, boolean> | undefined), [node.id]: true } } } : canvas;
        if (mode === node.payload.mode) { if (chosen !== canvas) owner.onChange(chosen, { record: false }); return; }
        const hasVideo = canvas.edges.some(edge => edge.targetNodeId === node.id && edge.role === 'referenceVideo')
            || node.payload.inputs?.some(input => input.role === 'referenceVideo');
        if (node.kind === 'videoGen' && mode === 'imageToVideo' && hasVideo && owner.onVideoInput) {
            owner.onChange(chosen, { record: false });
            owner.onVideoInput(undefined, node.id, mode);
            return;
        }
        const switched = switchCanvasModeKeepingInputs(chosen, node.id, mode, now());
        if (!switched) { owner.onNotice(canvasOptionsText(owner.locale, 'modeBlocked')); return; }
        const result = model ? reconcileCanvasGenerationParameters(model, mode, node.payload.parameters, capabilityInputs(switched, node.id)) : undefined;
        const next = result?.mode === mode ? applyCanvasCommand(switched, { type: 'node.setParameters', nodeId: node.id,
            parameters: result.parameters, optionDecision: result.optionDecision }, { now: now() }) : switched;
        owner.onChange(next, { record: true });
    };
    /** Fit mode and settings to the model: keeps what it supports, falls back to its defaults for the rest. */
    const fit = (): void => {
        if (!model) return;
        let next = fitCanvasNodeOptions(canvas, node.id, model, now());
        if (!next) { owner.onNotice(canvasOptionsText(owner.locale, 'modeBlocked')); return; }
        const changed = next.nodes.find(item => item.id === node.id);
        if (changed && (changed.kind === 'imageGen' || changed.kind === 'videoGen')) {
            const nextAspect = changed.payload.parameters.aspectRatio;
            if (typeof nextAspect === 'string' && nextAspect !== 'auto' && nextAspect !== node.payload.parameters.aspectRatio) {
                next = applyCanvasCommand(next, { type: 'node.resize', nodeId: node.id, size: canvasMediaCardSize(nextAspect) }, { now: now() });
            }
        }
        owner.onChange(next, { record: true });
    };
    const allFamilies = kind === 'image' ? owner.families.image : owner.families.video;
    const routeSelection = useCanvasRouteSelection(allFamilies, route, choice => owner.onSetRoute([node.id], choice));
    const modes: readonly CanvasGenerationMode[] = model ? model.modes.map(item => item.mode).filter(mode => kind === 'image' ? mode === 'textToImage' || mode === 'imageToImage' : mode !== 'textToImage' && mode !== 'imageToImage')
        : kind === 'image' ? ['textToImage', 'imageToImage'] : ['textToVideo', 'imageToVideo', 'firstLastFrame', 'referenceToVideo'];
    const variants = resolved?.mode?.outputVariants ?? [];
    const ratios = resolved?.variant?.aspectRatios ?? [];
    // A model priced per quality tier (GPT Image low/medium/high) declares its qualities; the choice is what is billed.
    const qualityParameter = kind === 'image' ? resolved?.mode?.parameters?.find(parameter => parameter.key === 'quality' && parameter.type === 'string' && parameter.values?.length) : undefined;
    const qualityLabel = (value: string): string => ['low', 'medium', 'high', 'standard', 'hd'].includes(value) ? t(`quality.${value}` as CanvasTextKey) : value;
    const duration = kind === 'video' ? resolved?.duration : undefined;
    const audio = kind === 'video' ? resolved?.audioGeneration : undefined;
    const adjustmentNotes = canvasOptionAdjustments(owner.locale, node.payload.optionDecision);
    const audioReferenceCount = capabilityInputs(canvas, node.id).filter(input => input.role === 'referenceAudio').length;
    const fixable = Boolean(model) && problems.issues.some(issue => ['MODE_UNSUPPORTED', 'RESOLUTION_INVALID', 'ASPECT_RATIO_INVALID', 'DURATION_INVALID', 'AUDIO_INVALID', 'PARAMETER_UNSUPPORTED'].includes(issue.code));
    const blocked = problems.blocking.length > 0 || Boolean(route && capability?.loading) || routeSelection.blocked;
    const withUpstream = problems.upstream.length > 0;
    const retryPending = owner.jobOf(node)?.retryPending === true;
    const retryBlocked = owner.jobOf(node)?.retryBlocked === true;
    const run = (): void => {
        if (owner.submitting.has(node.id) || owner.jobOf(node)?.retryPending || owner.jobOf(node)?.retryBlocked) return;
        commitPrompt(prompt); context.run(withUpstream ? [...problems.upstream, node.id] : [node.id]);
    };
    const resumable = !status.busy && Boolean(owner.onResumeGeneration && owner.jobOf(node)?.resumable);
    const resume = (): void => { if (resumable && !owner.submitting.has(node.id) && !owner.jobOf(node)?.retryPending
        && !owner.jobOf(node)?.retryBlocked) owner.onResumeGeneration?.(node.id, canvasLatestJob(node)?.jobId); };
    const preparingStartFrame = owner.startFrameBusy?.(node.id) === true;
    const cancellable = Boolean(preparingStartFrame ? owner.onCancelStartFrame : owner.onCancelGeneration
        && (status.key === 'waiting' || owner.jobOf(node)?.cancellable));
    const cancel = (): void => {
        if (!cancellable) return;
        if (preparingStartFrame) { owner.onCancelStartFrame?.(node.id); return; }
        owner.onCancelGeneration?.(node.id, canvasLatestJob(node)?.jobId);
    };
    const cameras = (canvas.settings.nodeCamera ?? {}) as Readonly<Record<string, CanvasCameraState>>;
    const cameraView = deriveCanvasCameraPrompt(prompt, cameras[node.id]);
    const camera = cameraView.state;
    const [cameraOpen, setCameraOpen] = React.useState(false);
    const cameraTrigger = React.useRef<HTMLButtonElement>(null);
    const closeCamera = (): void => { setCameraOpen(false); cameraTrigger.current?.focus({ preventScroll: true }); };
    const applyCamera = (selection: CameraSelection): void => {
        const { state, prompt: text } = composeCanvasCameraPrompt(cameraView.body, selection);
        closeCamera();
        setPrompt(text);
        seen.current = text;
        const next = withCameraState(applyCanvasCommand(canvas, { type: 'node.setParameters', nodeId: node.id, parameters: node.payload.parameters, prompt: text }, { now: now() }), node.id, state);
        owner.onChange(next, { record: true });
    };
    return <section className='nmx-board-panel is-generation' onMouseDown={event => event.stopPropagation()} onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
            if (cameraOpen) { event.preventDefault(); closeCamera(); }
        }
    }}>
        <div className='nmx-board-generation-actions'>
            {kind === 'video' && owner.onStartFrameSetup && <button type='button' className={`nmx-board-field is-camera${comicStartFrameSettings(canvas, node.id)?.enabled ? ' is-set' : ''}`}
                aria-pressed={comicStartFrameSettings(canvas, node.id)?.enabled === true} title={comicStartFrameText(owner.locale, 'hint')}
                disabled={status.busy} onClick={() => owner.onStartFrameSetup?.(node.id)}><i className='codicon codicon-person' aria-hidden='true'/><span>{comicStartFrameText(owner.locale, 'title')}</span></button>}
            {kind === 'video' && <div className='nmx-board-mode-tabs' role='tablist' aria-label={t('mode')}>
                {[...new Set([...modes, node.payload.mode])].map(mode => <button type='button' key={mode} role='tab'
                    aria-selected={node.payload.mode === mode} title={t(`mode.${mode}` as CanvasTextKey)}
                    onClick={() => setMode(mode)}>{t(`mode.${mode}` as CanvasTextKey)}</button>)}
            </div>}
            {kind === 'video' && <button type='button' className={`nmx-board-field is-camera${(canvas.settings.nodeStoryboard as Record<string, unknown> | undefined)?.[node.id] ? ' is-set' : ''}`}
                title={storyboardText(owner.locale, 'open')}
                onClick={() => context.openStoryboard(node.id, prompt)}>
                <i className='codicon codicon-list-ordered' aria-hidden='true'></i><span>{storyboardText(owner.locale, 'open')}</span></button>}
            {kind === 'video' && <button ref={cameraTrigger} type='button' className={`nmx-board-field is-camera${camera && (camera.selection.movements.length > 0 || camera.selection.speed !== 'normal') ? ' is-set' : ''}`} title={panelText(owner.locale, 'camera')} onClick={() => setCameraOpen(!cameraOpen)} aria-expanded={cameraOpen}>
                <i className='codicon codicon-device-camera-video' aria-hidden='true'></i><span>{panelText(owner.locale, 'camera')}</span></button>}
            {variants.length > 0 && <label className='nmx-board-field is-resolution' title={t('resolution')}>
                <select aria-label={t('resolution')} value={String(node.payload.parameters.resolution ?? resolved?.variant?.resolution ?? '')} onChange={event => setParameters({ resolution: event.currentTarget.value })}>
                    {variants.map(variant => <option key={variant.id} value={variant.resolution}>{variant.resolution === 'auto' ? t('resolutionAuto') : variant.resolution}</option>)}
                </select>
            </label>}
            {qualityParameter && <label className='nmx-board-field is-quality' title={t('quality')}>
                <i className='codicon codicon-dashboard' aria-hidden='true'></i>
                <select aria-label={t('quality')} value={String(node.payload.parameters.quality ?? qualityParameter.defaultValue ?? '')} onChange={event => setParameters({ quality: event.currentTarget.value })}>
                    {qualityParameter.values!.map(value => <option key={String(value)} value={String(value)}>{qualityLabel(String(value))}</option>)}
                </select>
            </label>}
            {(ratios.length > 0 || typeof node.payload.parameters.aspectRatio === 'string') && <label className='nmx-board-field is-aspect' title={t('aspect')}>
                <select aria-label={t('aspect')} value={String(node.payload.parameters.aspectRatio ?? '')} onChange={event => setParameters({ aspectRatio: event.currentTarget.value || undefined })}>
                    {[...new Set([String(node.payload.parameters.aspectRatio ?? ''), ...ratios])].filter(Boolean).map(ratio => <option key={ratio} value={ratio} disabled={!ratios.includes(ratio)}>{ratio === 'auto' ? t('aspectAuto') : ratio}</option>)}
                </select>
            </label>}
            {kind === 'video' && <DurationField rule={duration} value={node.payload.parameters.durationSeconds} t={t} onChange={seconds => setParameters({ durationSeconds: seconds })} />}
        </div>
        <ReferenceInputs node={node} />
        {kind === 'video' && camera && <CameraTags locale={owner.locale} selection={camera.selection} onChange={applyCamera} />}
        {owner.startFrameBusy?.(node.id) && <div className='nmx-board-panel-note' role='status'>{owner.startFrameStatus?.(node.id) ? t(`status.${owner.startFrameStatus(node.id)}` as CanvasTextKey) : comicStartFrameText(owner.locale, 'preparing')}
            <button type='button' className='nmx-link-button' title={t('stop')} onClick={() => owner.onCancelStartFrame?.(node.id)}>{t('stop')}</button></div>}
        <InlineCanvasText node={node} />
        {problems.blocking.length > 0 && <ul className='nmx-board-problems'>
            {problems.blocking.slice(0, 4).map(text => <li key={text} data-nmx-literal>{text}</li>)}
            {fixable && <li><button type='button' className='nmx-link-button' onClick={fit}>{t('fitModel')}</button></li>}
        </ul>}
        <div className='nmx-board-panel-row nmx-board-parameter-row'>
            <CanvasRouteSelector locale={owner.locale} selection={routeSelection} />
            {audio && audio.mode !== 'unsupported' && <label className='nmx-board-field is-toggle' title={audio.mode === 'required' ? t('audioRequired') : t('audio')}>
                <input type='checkbox' disabled={audio.mode === 'required'} checked={audio.mode === 'required' || node.payload.parameters.generateAudio === true || (node.payload.parameters.generateAudio === undefined && audio.defaultEnabled)}
                    onChange={event => setParameters({ generateAudio: event.currentTarget.checked })} />
                <span>{t('audioOn')}</span>
            </label>}
            <button type='button' className='nmx-board-generate' disabled={retryPending || retryBlocked || (status.busy ? !cancellable : resumable ? false : blocked)} onClick={retryPending || retryBlocked ? undefined : status.busy ? cancel : resumable ? resume : run}
                aria-label={retryPending ? t('retry') : status.busy ? cancellable ? t('stop') : t('generating') : resumable ? t('retry') : canvasCurrentVersion(node) ? t('regenerate') : t('generate')}
                title={retryPending ? t('retry') : status.busy ? cancellable ? t('stop') : t('generating') : resumable ? t('retry') : problems.blocking[0] ?? (withUpstream ? t('waitingUpstream') : t('generate'))}>
                {retryPending ? <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i> : status.busy ? cancellable ? <i className='codicon codicon-debug-stop' aria-hidden='true'></i> : <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i> : <i className='codicon codicon-arrow-up' aria-hidden='true'></i>}
                {!retryPending && !status.busy && !resumable && estimate && <small className='nmx-board-generate-price' title={estimate} data-nmx-literal>{estimate}</small>}
            </button>
        </div>
        {cameraOpen && <CameraControl locale={owner.locale} selection={camera?.selection} onConfirm={applyCamera} onCancel={closeCamera} />}
        {adjustmentNotes.length > 0 && <div className='nmx-board-panel-note' role='status'>
            <span>{canvasOptionsText(owner.locale, 'adjusted')}</span>
            <ul>{adjustmentNotes.map((text, index) => <li key={index} data-nmx-literal>{text}</li>)}</ul>
        </div>}
        {audioReferenceCount > 0 && <p className='nmx-board-panel-note'>{canvasOptionsText(owner.locale, 'audioReferences', { n: audioReferenceCount })}</p>}
        {route && capability?.loading && <p className='nmx-board-panel-note'>{t('capabilityLoading')}</p>}
        {!problems.blocking.length && withUpstream && <p className='nmx-board-panel-note'>{t('waitingUpstream')}</p>}
    </section>;
}

/** 视频合成: the wired clips in wiring order, the frame rate, and 导出成片 (the result comes back as this node's version). */
function CompositionPanel(props: { readonly node: Extract<CanvasNode, { kind: 'composition' }> }): React.ReactElement {
    const context = React.useContext(CanvasContext)!;
    const { t } = context;
    const { node } = props;
    const owner = context.props;
    let inputs: ReturnType<typeof resolveCanvasInputs>['inputs'] = [];
    try { inputs = resolveCanvasInputs(owner.canvas, node.id).inputs; } catch { inputs = []; }
    const videos = inputs.filter(input => input.kind === 'video'), audio = inputs.filter(input => input.kind === 'audio');
    const seconds = Math.round(videos.reduce((total, input) => total + (input.metadata?.durationMs ?? 0), 0) / 100) / 10;
    const frameRate = Number(node.payload.parameters.frameRate) || owner.defaults.frameRate || 24;
    const progress = owner.compositionProgress?.(node.id);
    const titleOf = (sourceId: string): string => owner.canvas.nodes.find(item => item.id === sourceId)?.title ?? '';
    return <section className='nmx-board-panel is-composition' onMouseDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
        {inputs.length ? <ol className='nmx-board-composition-list'>
            {inputs.filter(input => input.kind === 'video' || input.kind === 'audio').map(input => <li key={`${input.edgeId ?? input.versionId}`}>
                <i className={`codicon codicon-${input.kind === 'video' ? 'device-camera-video' : 'unmute'}`} aria-hidden='true'></i>
                <span data-nmx-literal>{titleOf(input.sourceNodeId ?? '')}</span>
                <small>{input.metadata?.durationMs ? t('seconds', { n: Math.round(input.metadata.durationMs / 100) / 10 }) : ''}</small>
            </li>)}
        </ol> : <p className='nmx-board-panel-note'>{t('compositionHint')}</p>}
        <div className='nmx-board-panel-row'>
            <span className='nmx-board-field is-static' data-nmx-literal>{t('compositionClips', { n: videos.length, seconds })}{audio.length ? ` · ${t('compositionAudio', { n: audio.length })}` : ''}</span>
            <label className='nmx-board-field' title={t('frameRate')}>
                <select aria-label={t('frameRate')} value={String(frameRate)} onChange={event => owner.onChange(applyCanvasCommand(owner.canvas, { type: 'node.setParameters', nodeId: node.id,
                    parameters: { ...node.payload.parameters, frameRate: Number(event.currentTarget.value) } }, { now: now() }), { record: true })}>
                    {[24, 25, 30].map(rate => <option key={rate} value={rate}>{rate} fps</option>)}
                </select>
            </label>
            <span className='nmx-board-panel-spacer' />
            <button type='button' className='nmx-board-generate' disabled={!videos.length || Boolean(progress) || !owner.onExportComposition}
                title={videos.length ? '' : t('compositionNoVideo')} onClick={() => owner.onExportComposition?.(node.id)}>
                {progress ? <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i> : <i className='codicon codicon-export' aria-hidden='true'></i>}
                {progress ? t('exporting', { percent: Math.round(progress.progress * 100) }) : t('exportComposition')}
            </button>
        </div>
    </section>;
}

function DurationField(props: { readonly rule?: CanvasDurationRule; readonly value: unknown; readonly t: T; readonly onChange: (seconds: number) => void }): React.ReactElement {
    const { rule, t } = props;
    const value = typeof props.value === 'number' ? props.value : undefined;
    const invalid = rule && value !== undefined && !isCanvasDurationValid(rule, value);
    if (rule?.kind === 'fixed') return <span className='nmx-board-field is-duration is-static' title={t('duration')}>{t('seconds', { n: rule.seconds })}</span>;
    if (rule?.kind === 'enum') {
        return <label className={`nmx-board-field is-duration${invalid ? ' is-invalid' : ''}`} title={t('duration')}>
            <select aria-label={t('duration')} disabled={rule.seconds.length === 0} value={String(value ?? rule.defaultSeconds)} onChange={event => props.onChange(Number(event.currentTarget.value))}>
                {[...new Set([...(value !== undefined && !rule.seconds.includes(value) ? [value] : []), ...rule.seconds])].map(seconds => <option key={seconds} value={seconds} disabled={!rule.seconds.includes(seconds)}>{t('seconds', { n: seconds })}</option>)}
            </select>
        </label>;
    }
    return <label className={`nmx-board-field is-duration is-number${invalid ? ' is-invalid' : ''}`} title={t('duration')}>
        <ImeInput type='number' aria-label={t('duration')} value={value ?? (rule?.kind === 'range' ? rule.defaultSeconds : '')} min={rule?.kind === 'range' ? rule.min : 1}
            max={rule?.kind === 'range' ? rule.max : 300} step={rule?.kind === 'range' ? rule.step : 1}
            onChange={event => { const seconds = Number(event.currentTarget.value); if (Number.isFinite(seconds) && seconds > 0) props.onChange(seconds); }} />
        <span>{t('seconds', { n: '' }).trim()}</span>
    </label>;
}

function FramePanel(props: { readonly node: Extract<CanvasNode, { kind: 'frameExtract' }> }): React.ReactElement {
    const context = React.useContext(CanvasContext)!;
    const { t } = context;
    const { node } = props;
    const canvas = context.props.canvas;
    const selection = node.payload.selection;
    const set = (next: typeof selection): void => context.change({ ...canvas, nodes: canvas.nodes.map(item => item.id === node.id ? { ...node, payload: { ...node.payload, selection: next } } : item) }, true);
    const source = canvas.edges.some(edge => edge.targetNodeId === node.id);
    return <section className='nmx-board-panel is-frame' onMouseDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
        <div className='nmx-board-panel-row'>
            <div className='nmx-board-segmented' role='radiogroup'>
                {(['first', 'last', 'time'] as const).map(kind => <button type='button' key={kind} role='radio' aria-checked={selection.kind === kind}
                    className={selection.kind === kind ? 'is-active' : ''} onClick={() => set(kind === 'time' ? { kind, timeMs: selection.kind === 'time' ? selection.timeMs : 0 } : { kind })}>
                    {t(kind === 'first' ? 'extractFirst' : kind === 'last' ? 'extractLast' : 'extractAt')}</button>)}
            </div>
            {selection.kind === 'time' && <label className='nmx-board-field is-number'>
                <ImeInput type='number' min={0} step={0.1} value={selection.timeMs / 1000}
                    onChange={event => { const seconds = Number(event.currentTarget.value); if (Number.isFinite(seconds) && seconds >= 0) set({ kind: 'time', timeMs: Math.round(seconds * 1000) }); }} />
                <span>{t('seconds', { n: '' }).trim()}</span>
            </label>}
            <span className='nmx-board-panel-spacer' />
            <button type='button' className='nmx-board-generate' disabled={!source || context.props.submitting.has(node.id)} onClick={() => context.props.onExtract(node.id)}>
                <i className='codicon codicon-device-camera' aria-hidden='true'></i>{t('extractGo')}
            </button>
        </div>
    </section>;
}

function CanvasGroup(flow: NodeProps): React.ReactElement | null {
    const context = React.useContext(CanvasContext)!;
    const node = context.nodes.get(flow.id);
    if (!node) return null;
    return <div className={`nmx-board-group${flow.selected ? ' is-selected' : ''}`} onContextMenu={event => context.menuFor(event, node.id)}>
        <header data-nmx-literal>{displayTitle(node)}</header>
    </div>;
}

// ——— wires ———

function WireCutIcon(): React.ReactElement {
    return <svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' aria-hidden='true'>
        <circle cx='6' cy='6' r='3' /><circle cx='6' cy='18' r='3' /><path d='M8.2 8.2 21 21M8.2 15.8 21 3' />
    </svg>;
}

/** Keep the selected wire's actions at the clicked segment, including when its midpoint is offscreen. */
function useWireAnchor(selected: boolean | undefined): { readonly point?: CanvasPoint; readonly onClick: (event: React.MouseEvent<SVGGElement>) => void } {
    const flow = useReactFlow();
    const [point, setPoint] = React.useState<CanvasPoint>();
    React.useEffect(() => { if (!selected) setPoint(undefined); }, [selected]);
    return { point, onClick: event => setPoint(flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })) };
}

function CanvasWire(flow: EdgeProps): React.ReactElement {
    const context = React.useContext(CanvasContext)!;
    const { t } = context;
    const [path, labelX, labelY] = getBezierPath(flow);
    const edge = context.props.canvas.edges.find(item => item.id === flow.id);
    const [open, setOpen] = React.useState(false);
    const anchor = useWireAnchor(flow.selected);
    React.useEffect(() => { if (!flow.selected) setOpen(false); }, [flow.selected]);
    React.useEffect(() => {
        if (!open) return;
        const handlePointerDown = (event: PointerEvent): void => {
            const target = event.target as Element | null;
            if (target?.closest?.(`[data-canvas-edge-id="${CSS.escape(flow.id)}"]`)) return;
            setOpen(false);
        };
        document.addEventListener('pointerdown', handlePointerDown, true);
        return () => document.removeEventListener('pointerdown', handlePointerDown, true);
    }, [open, flow.id]);
    const roles = edge ? canvasAlternativeRoles(context.props.canvas, edge) : [];
    return <>
        <g onClick={anchor.onClick} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
            <BaseEdge id={flow.id} path={path} markerEnd={flow.markerEnd} className={`nmx-board-wire is-${edge?.role ?? 'prompt'}${flow.selected ? ' is-selected' : ''}`} interactionWidth={16} />
        </g>
        {edge && flow.selected && <EdgeLabelRenderer>
            <div className='nmx-board-wire-label nodrag nopan is-selected' data-canvas-edge-id={flow.id} style={{ transform: `translate(-50%, -50%) translate(${anchor.point?.x ?? labelX}px, ${anchor.point?.y ?? labelY}px)` }}>
                <button type='button' className='nmx-board-wire-role' onClick={() => setOpen(!open)} disabled={roles.length < 2}>{t(`role.${edge.role}` as CanvasTextKey)}</button>
                <button type='button' className='nmx-board-wire-cut' title={t('removeEdge')} aria-label={t('removeEdge')}
                    onClick={() => context.change(deleteFromCanvas(context.props.canvas, [], [edge.id], now()), true)}><WireCutIcon /></button>
                {open && roles.length > 1 && <div className='nmx-board-menu is-wire' role='menu' aria-label={t('edgeAs')}>
                    <header>{t('edgeAs')}</header>
                    {roles.map(role => <button type='button' role='menuitemradio' aria-checked={role === edge.role} key={role} onClick={() => {
                        setOpen(false);
                        const result = rerouteCanvasEdge(context.props.canvas, edge.id, role, now());
                        if (result.error) context.props.onNotice(t('connectFailed', { reason: t(`issue.${result.error}` as CanvasTextKey) }));
                        else context.change(result.canvas, true);
                    }}>{t(`role.${role}` as CanvasTextKey)}{role === edge.role && <i className='codicon codicon-check' aria-hidden='true'></i>}</button>)}
                </div>}
            </div>
        </EdgeLabelRenderer>}
    </>;
}

const NODE_TYPES = { canvasCard: CanvasCard, canvasGroup: CanvasGroup };
function SequenceWire(flow: EdgeProps): React.ReactElement {
    const context = React.useContext(CanvasContext)!;
    const [path, x, y] = getBezierPath(flow);
    const anchor = useWireAnchor(flow.selected);
    const label = context.props.locale.startsWith('zh') ? '播放顺序' : 'Playback order';
    return <><g onClick={anchor.onClick} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
            <BaseEdge id={flow.id} path={path} markerEnd={flow.markerEnd} className='nmx-board-sequence-wire' interactionWidth={20} />
        </g>
        {flow.selected && <EdgeLabelRenderer><div className='nmx-board-wire-label nodrag nopan is-selected' data-canvas-edge-id={flow.id} style={{ transform: `translate(-50%,-50%) translate(${anchor.point?.x ?? x}px,${anchor.point?.y ?? y}px)` }}>
            <span>{label} →</span><button type='button' className='nmx-board-wire-cut' title={context.t('removeEdge')} aria-label={context.t('removeEdge')}
                onClick={() => context.change(applyCanvasCommand(context.props.canvas, { type: 'sequence.disconnect', linkId: flow.id }, { now: now() }), true)}><WireCutIcon /></button>
        </div></EdgeLabelRenderer>}</>;
}
const EDGE_TYPES = { canvasWire: CanvasWire, sequenceWire: SequenceWire };

// ——— the board ———

interface MenuState {
    readonly x: number;
    readonly y: number;
    readonly at: CanvasPoint;
    readonly kind: 'add' | 'node' | 'connect';
    readonly nodeId?: string;
    readonly from?: string;
}

const ADD_KINDS: readonly CanvasAddKind[] = ['imageGen', 'videoGen', 'frameExtract', 'composition', 'sceneComposer', 'world'];

function Board(props: ComicCanvasProps): React.ReactElement {
    const t: T = React.useCallback((key, values) => String(key) === 'kind.sceneComposer' ? directorText(props.locale, 'stage') : String(key) === 'kind.world' ? directorText(props.locale, 'world') : canvasText(props.locale, key, values), [props.locale]);
    const flow = useReactFlow();
    const root = React.useRef<HTMLDivElement>(null);
    const canvas = props.canvas;
    const activeCanvas = React.useRef(canvas); activeCanvas.current = canvas;
    const nodes = React.useMemo(() => new Map(canvas.nodes.map(node => [node.id, node])), [canvas]);
    const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
    const [selectedEdges, setSelectedEdges] = React.useState<ReadonlySet<string>>(new Set());
    React.useEffect(() => {
        // Undo, external edits and deletions can remove IDs without a Flow selection event.
        // Preserve the same Set when every selected item still exists.
        const nodeIds = new Set(canvas.nodes.map(node => node.id));
        const edgeIds = new Set([...canvas.edges, ...(canvas.sequenceLinks ?? [])].map(edge => edge.id));
        setSelected(previous => [...previous].every(id => nodeIds.has(id)) ? previous : new Set([...previous].filter(id => nodeIds.has(id))));
        setSelectedEdges(previous => [...previous].every(id => edgeIds.has(id)) ? previous : new Set([...previous].filter(id => edgeIds.has(id))));
    }, [canvas.nodes, canvas.edges, canvas.sequenceLinks]);
    const [renaming, setRenaming] = React.useState<string>();
    const [menu, setMenu] = React.useState<MenuState>();
    const [director, setDirector] = React.useState<string>();
    const openDirector = React.useCallback((nodeId: string) => { setMenu(undefined); setDirector(nodeId); }, []);
    // Per-user canvas preferences (this browser profile), never part of the project document.
    const settingsKey = canvasSettingsStorageKey('desktop');
    const [settings, setSettingsState] = React.useState<CanvasSettings>(() => {
        try { return normalizeCanvasSettings(JSON.parse(window.localStorage.getItem(settingsKey) || '{}')); } catch { return { ...DEFAULT_CANVAS_SETTINGS }; }
    });
    const setSettings = (next: CanvasSettings): void => {
        setSettingsState(next);
        try { window.localStorage.setItem(settingsKey, JSON.stringify(next)); } catch { /* kept for this session */ }
    };
    const [side, setSide] = React.useState<'locate' | 'settings' | 'edges'>();
    const [nodeDragging, setNodeDragging] = React.useState(false);
    const [pendingRun, setPendingRun] = React.useState<{ readonly ids: readonly string[]; readonly endsAt: number }>();
    const [, tick] = React.useState(0);
    React.useEffect(() => {
        if (!pendingRun) return;
        const timer = window.setInterval(() => {
            if (Date.now() >= pendingRun.endsAt) { window.clearInterval(timer); setPendingRun(undefined); props.onRun(pendingRun.ids); } else tick(value => value + 1);
        }, 250);
        return () => window.clearInterval(timer);
    }, [pendingRun, props.onRun]);
    const run = React.useCallback((ids: readonly string[]) => {
        if (settings.submitDelaySeconds > 0) {
            setPendingRun(prev => ({
                ids: [...new Set([...(prev?.ids ?? []), ...ids])],
                endsAt: Date.now() + settings.submitDelaySeconds * 1000
            }));
        } else props.onRun(ids);
    }, [settings.submitDelaySeconds, props.onRun]);
    const connectingFrom = React.useRef<string>();
    const [preview, setPreview] = React.useState<{ readonly uri: string; readonly kind: 'image' | 'video' }>();
    const previewBackdropPress = React.useRef(false);
    const [batch, setBatch] = React.useState<CanvasPoint>();
    const [toolDialog, setToolDialog] = React.useState<{ readonly nodeId: string; readonly tool: CanvasToolId; readonly stitch?: readonly string[] }>();
    const [frameDialog, setFrameDialog] = React.useState<{ readonly nodeId: string; readonly version: CanvasAssetVersion }>();
    const [frameBusy, setFrameBusy] = React.useState(false);
    const mounted = React.useRef(true);
    React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const [storyboardFor, setStoryboardFor] = React.useState<{ readonly nodeId: string; readonly prompt: string }>();
    const openStoryboard = React.useCallback((nodeId: string, prompt: string) => setStoryboardFor({ nodeId, prompt }), []);
    // 对比库: this viewer's own list for this project (browser storage), never part of the document.
    const compareKey = `nextmux.canvas.compare.v1:${canvas.projectId}`;
    const [compare, setCompareState] = React.useState<CanvasCompareLibrary>(() => {
        try { return normalizeCanvasCompareLibrary(JSON.parse(window.localStorage.getItem(compareKey) || '[]')); } catch { return []; }
    });
    const [compareOpen, setCompareOpen] = React.useState(false);
    React.useEffect(() => {
        try { setCompareState(normalizeCanvasCompareLibrary(JSON.parse(window.localStorage.getItem(compareKey) || '[]'))); } catch { setCompareState([]); }
        setCompareOpen(false);
    }, [compareKey]);
    const [downloads, setDownloads] = React.useState<readonly CanvasDownloadItem[]>();
    const [history, setHistory] = React.useState<{ readonly canvases: readonly CanvasDocument[]; readonly nodeId?: string }>();
    const historyRequest = React.useRef(0);
    React.useEffect(() => () => { historyRequest.current++; }, []);
    const openHistory = (nodeId?: string): void => {
        const request = ++historyRequest.current;
        setHistory({ canvases: [canvas], ...(nodeId ? { nodeId } : {}) });
        if (!nodeId && props.loadHistoryCanvases) void props.loadHistoryCanvases().then(canvases => {
            if (historyRequest.current === request) setHistory({ canvases });
        }).catch(() => { if (historyRequest.current === request) props.onNotice(canvasHistoryText(props.locale, 'failedAction')); });
    };
    const closeHistory = (): void => { historyRequest.current++; setHistory(undefined); };

    const download = (ids: readonly string[]): void => { const items = canvasDownloadItems(ids.flatMap(id => { const node = nodes.get(id); return node ? [node] : []; })); if (items.length) setDownloads(items); };
    const setCompare = (next: CanvasCompareLibrary): void => {
        setCompareState(next);
        try { window.localStorage.setItem(compareKey, JSON.stringify(next)); } catch { /* this session only */ }
    };
    const toggleCompare = (nodeId: string): void => {
        const version = canvasCurrentVersion(nodes.get(nodeId));
        if (version && compare.some(entry => entry.uri === version.uri)) { setCompare(removeCanvasCompareVersion(compare, version.uri)); return; }
        const result = addCanvasCompareVersion(compare, version);
        if (result.ok) setCompare(result.library);
        else props.onNotice(toolText(props.locale, result.code === 'LIBRARY_FULL' ? 'compareFull' : result.code === 'DUPLICATE_URI' ? 'compareDuplicate' : 'compareMissing', { limit: result.limit }));
    };
    /** A finished tool's first output becomes the selection and comes into view, so it is never left under the source's panels. */
    const revealCreated = React.useCallback((created: readonly CanvasNode[] | false): void => {
        const first = created ? created[0] : undefined;
        if (!first) return;
        setSelected(new Set([first.id]));
        void flow.setCenter(first.position.x + first.size.width / 2, first.position.y + first.size.height / 2, { zoom: Math.max(flow.getZoom(), 0.6), duration: 300 });
    }, [flow]);
    const runFrameExtraction = async (nodeId: string, versionId: string, selection: CanvasFrameSelection): Promise<void> => {
        if (!props.onExtractVersion) return;
        setFrameBusy(true);
        try {
            const result = await props.onExtractVersion(nodeId, versionId, selection);
            if (mounted.current && activeCanvas.current.id === canvas.id && activeCanvas.current.projectId === canvas.projectId) revealCreated([result.node]);
        } finally { if (mounted.current) setFrameBusy(false); }
    };
    const extractFrame = (nodeId: string, versionId: string, choice: 'first' | 'last' | 'custom'): void => {
        const source = nodes.get(nodeId);
        const version = source && 'versions' in source.payload ? source.payload.versions.find(item => item.id === versionId) : undefined;
        if (!version || frameBusy) return;
        if (choice === 'custom') setFrameDialog({ nodeId, version });
        else void runFrameExtraction(nodeId, versionId, { kind: choice }).catch(error => {
            if (mounted.current) props.onNotice(t('extractFailed', { error: error instanceof Error ? error.message : String(error) }));
        });
    };
    const openTool = React.useCallback((nodeId: string, tool: CanvasToolId) => {
        if (toolRunsImmediately(tool)) void props.onTool(nodeId, tool, {}).then(revealCreated);
        else setToolDialog({ nodeId, tool });
    }, [props.onTool, revealCreated]);
    const open = React.useCallback((uri: string, kind: 'image' | 'video') => setPreview({ uri, kind }), []);

    const change = React.useCallback((next: CanvasDocument, record = true) => props.onChange(next, { record }), [props.onChange]);

    const [dragPreview, setDragPreview] = React.useState<readonly CanvasNode[]>([]);
    const dragCopy = React.useRef<{ readonly anchor: string; readonly origin: CanvasPoint; readonly plan?: CanvasDragCopyPlan; offset: CanvasPoint; active: boolean }>();
    React.useEffect(() => { dragCopy.current = undefined; setDragPreview([]); }, [canvas.id, canvas.projectId]);

    // The flow's own node list follows the document; while dragging it moves ahead and the document catches up on drop.
    const toFlow = React.useCallback((node: CanvasNode): FlowNode => ({
        id: node.id, type: flowType(node), position: node.position, data: {}, selected: selected.has(node.id),
        style: { width: node.size.width, height: node.size.height }, zIndex: node.kind === 'group' ? -1 : 1,
        ...(node.kind === 'group' ? { dragHandle: '.nmx-board-group header', selectable: true } : {})
    }), [selected]);
    const [flowNodes, setFlowNodes] = React.useState<FlowNode[]>(() => canvas.nodes.map(toFlow));
    // Keep React Flow's measurements across document updates, so wires keep their ports between renders.
    React.useEffect(() => {
        setFlowNodes(previous => {
            const measured = new Map(previous.map(node => [node.id, node.measured]));
            return [...canvas.nodes, ...dragPreview].map(node => { const flowNode = toFlow(node); const size = measured.get(node.id); return size ? { ...flowNode, measured: size } : flowNode; });
        });
    }, [canvas, toFlow, dragPreview]);
    const flowEdges = React.useMemo<FlowEdge[]>(() => [...canvas.edges.map(edge => ({ id: edge.id, source: edge.sourceNodeId, target: edge.targetNodeId, type: 'canvasWire',
        ariaLabel: `${t(`role.${edge.role}` as CanvasTextKey)}: ${nodes.get(edge.sourceNodeId)?.title ?? edge.sourceNodeId} → ${nodes.get(edge.targetNodeId)?.title ?? edge.targetNodeId}`,
        selected: selectedEdges.has(edge.id), animated: settings.wireAnimation,
        ...(settings.wireFocusOnly && !selected.has(edge.sourceNodeId) && !selected.has(edge.targetNodeId) && !selectedEdges.has(edge.id) ? { className: 'is-dim' } : {}) })), ...(canvas.sequenceLinks ?? []).map(link => ({ id: link.id, source: link.sourceNodeId, target: link.targetNodeId, sourceHandle: 'sequence-out', targetHandle: 'sequence-in', type: 'sequenceWire', markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--cv-sequence)', width: 18, height: 18 }, selected: selectedEdges.has(link.id), ariaLabel: `${props.locale.startsWith('zh') ? '播放顺序' : 'Playback order'}: ${nodes.get(link.sourceNodeId)?.title ?? link.sourceNodeId} → ${nodes.get(link.targetNodeId)?.title ?? link.targetNodeId}` }))],
        [canvas, nodes, t, props.locale, selectedEdges, selected, settings.wireAnimation, settings.wireFocusOnly]);
    // Members of a dragged group move with it.
    const dragOrigin = React.useRef<Map<string, CanvasPoint>>();

    const onNodesChange = React.useCallback((changes: NodeChange[]) => {
        const positions = changes.filter((item): item is Extract<NodeChange, { type: 'position' }> => item.type === 'position');
        const selection = changes.filter((item): item is Extract<NodeChange, { type: 'select' }> => item.type === 'select');
        if (selection.length) setSelected(previous => {
            const next = new Set(previous);
            for (const item of selection) { if (item.selected) next.add(item.id); else next.delete(item.id); }
            return next;
        });
        const measured = changes.filter(item => item.type === 'dimensions');
        if (measured.length && !positions.length) { setFlowNodes(current => applyNodeChanges(measured, current)); return; }
        if (!positions.length) return;
        const copying = dragCopy.current;
        if (copying) {
            const position = positions.find(item => item.id === copying.anchor)?.position;
            if (position) copying.offset = { x: position.x - copying.origin.x, y: position.y - copying.origin.y };
            copying.active ||= Math.abs(copying.offset.x) > CANVAS_DRAG_COPY_THRESHOLD || Math.abs(copying.offset.y) > CANVAS_DRAG_COPY_THRESHOLD;
            if (positions.some(item => item.dragging === false)) {
                dragCopy.current = undefined; dragOrigin.current = undefined; setDragPreview([]);
                if (copying.active && copying.plan) {
                    const result = commitCanvasDragCopy(activeCanvas.current, copying.plan, copying.offset, now());
                    if (result.ok) { change(result.canvas, true); setSelected(new Set(result.ids)); }
                    else { props.onNotice(`${panelText(props.locale, 'pasteRefused')} ${result.message}`); setFlowNodes(activeCanvas.current.nodes.map(toFlow)); }
                } else setFlowNodes(activeCanvas.current.nodes.map(toFlow));
            } else {
                const previews = copying.active && copying.plan ? copying.plan.nodes.map(node => ({ ...node,
                    position: { x: node.position.x + copying.offset.x, y: node.position.y + copying.offset.y } })) : [];
                setDragPreview(previews);
                // React Flow continues reporting the source IDs; only the transient copies follow those positions.
                setFlowNodes(current => {
                    const measuredById = new Map(current.map(node => [node.id, node.measured]));
                    return [...activeCanvas.current.nodes, ...previews].map(node => ({ ...toFlow(node), measured: measuredById.get(node.id) }));
                });
            }
            return;
        }
        setFlowNodes(current => {
            let next = applyNodeChanges([...measured, ...positions], current);
            const roots = new Set(canvasDragMoveRoots(canvas, positions.map(item => item.id)));
            for (const item of positions.filter(item => roots.has(item.id))) {
                const node = nodes.get(item.id);
                if (node?.kind !== 'group' || !item.position) continue;
                const start = dragOrigin.current?.get(node.id) ?? node.position;
                const dx = item.position.x - start.x, dy = item.position.y - start.y;
                const members = canvasDragGroupMembers(canvas, node.id);
                next = next.map(flowNode => members.has(flowNode.id)
                    ? { ...flowNode, position: { x: (nodes.get(flowNode.id)?.position.x ?? 0) + dx, y: (nodes.get(flowNode.id)?.position.y ?? 0) + dy } } : flowNode);
            }
            return next;
        });
        const done = positions.filter(item => item.dragging === false);
        if (!done.length) return;
        let next = canvas;
        const moved = new Set<string>();
        const roots = new Set(canvasDragMoveRoots(canvas, done.map(item => item.id)));
        for (const item of done.filter(item => roots.has(item.id))) {
            const flowNode = flowNodes.find(candidate => candidate.id === item.id);
            const position = item.position ?? flowNode?.position;
            const node = nodes.get(item.id);
            if (!position || !node || moved.has(node.id)) continue;
            const rounded = { x: Math.round(position.x), y: Math.round(position.y) };
            if (rounded.x === node.position.x && rounded.y === node.position.y) continue;
            next = applyCanvasCommand(next, { type: 'node.move', nodeId: node.id, position: rounded }, { now: now() });
            moved.add(node.id);
            // A node dropped inside a scene group joins it; dragged out, it leaves.
            if (node.kind !== 'group') {
                const membership = updateCanvasNodeMembership(next, node.id, now());
                if (membership.ok && membership.changed) next = membership.canvas;
            }
        }
        dragOrigin.current = undefined;
        if (next !== canvas) change(next, true);
    }, [canvas, nodes, flowNodes, change, toFlow, props.onNotice, props.locale]);

    const onEdgesChange = React.useCallback((changes: EdgeChange[]) => {
        const selection = changes.filter((item): item is Extract<EdgeChange, { type: 'select' }> => item.type === 'select');
        if (selection.length) setSelectedEdges(previous => {
            const next = new Set(previous);
            for (const item of selection) { if (item.selected) next.add(item.id); else next.delete(item.id); }
            return next;
        });
    }, []);

    const connect = React.useCallback((sourceId: string, targetId: string) => {
        const source = nodes.get(sourceId), target = nodes.get(targetId);
        if (source && canvasOutputKind(source) === 'video' && target?.kind === 'videoGen' && props.onVideoInput) {
            props.onVideoInput(sourceId, targetId);
            return;
        }
        const result = connectCanvasNodes(canvas, sourceId, targetId, now());
        if (result.error) { props.onNotice(t('connectFailed', { reason: t(`issue.${result.error}` as CanvasTextKey) })); return; }
        change(result.canvas, true);
        if (result.dropped?.length) props.onNotice(t('droppedEdges', { n: result.dropped.length }));
    }, [canvas, nodes, change, props.onNotice, props.onVideoInput, t]);

    const onConnect = React.useCallback((connection: Connection) => {
        if (!connection.source || !connection.target) return;
        if (connection.sourceHandle?.startsWith('sequence') || connection.targetHandle?.startsWith('sequence')) {
            if (connection.sourceHandle !== 'sequence-out' || connection.targetHandle !== 'sequence-in') { props.onNotice(props.locale.startsWith('zh') ? '请连接两个视频的播放顺序端口' : 'Connect the playback sequence ports of two videos'); return; }
            try { change(applyCanvasCommand(canvas, { type: 'sequence.connect', link: { id: canvasId('canvas-sequence'), sourceNodeId: connection.source, targetNodeId: connection.target } }, { now: now() }), true); }
            catch (error) { props.onNotice(error instanceof Error ? error.message : String(error)); }
        } else connect(connection.source, connection.target);
    }, [connect, canvas, change, props.onNotice, props.locale]);

    const screenToFlow = React.useCallback((x: number, y: number): CanvasPoint => {
        const point = flow.screenToFlowPosition({ x, y });
        return { x: Math.round(point.x), y: Math.round(point.y) };
    }, [flow]);

    const localPoint = (x: number, y: number): { x: number; y: number } => {
        const rect = root.current?.getBoundingClientRect();
        return { x: x - (rect?.left ?? 0), y: y - (rect?.top ?? 0) };
    };

    const onConnectEnd = React.useCallback((event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
        const from = state.fromNode?.id ?? connectingFrom.current;
        connectingFrom.current = undefined;
        if (state.isValid || !from) return;
        // Invalid port-to-port drops and playback ports never become ordinary references.
        if (state.toHandle || state.fromHandle?.id?.startsWith('sequence')) return;
        const point = 'changedTouches' in event ? event.changedTouches[0] : event;
        const target = (event.target as HTMLElement | null)?.closest('.react-flow__node');
        if (target) {
            // Dropped on a node's body rather than its port: connect to that node.
            const id = target.getAttribute('data-id');
            if (id && id !== from) state.fromHandle?.type === 'target' ? connect(id, from) : connect(from, id);
            return;
        }
        // The add-node menu creates downstream nodes. An input drag needs an upstream source.
        if (state.fromHandle?.type === 'target') return;
        const local = localPoint(point.clientX, point.clientY);
        setMenu({ x: local.x, y: local.y, at: screenToFlow(point.clientX, point.clientY), kind: 'connect', from });
    }, [connect, screenToFlow]);

    const center = (): CanvasPoint => {
        const rect = root.current?.getBoundingClientRect();
        return rect ? screenToFlow(rect.left + rect.width / 2, rect.top + rect.height / 2) : { x: 0, y: 0 };
    };

    const addNode = (kind: CanvasAddKind, at: CanvasPoint, from?: string, draft?: { readonly title: string; readonly prompt: string }): CanvasNode => {
        const selectedRoute = kind === 'videoGen' ? props.defaultRoute('video') ?? props.models.video[0]
            : kind === 'imageGen' ? props.defaultRoute('image') ?? props.models.image[0] : undefined;
        const draftNode = createCanvasNode(kind, at, {
            title: draft?.title ?? t(`kind.${kind}` as CanvasTextKey), aspectRatio: props.defaults.aspectRatio, durationSeconds: props.defaults.durationSeconds,
            imageModelId: (props.defaultRoute('image') ?? props.models.image[0])?.modelId, videoModelId: (props.defaultRoute('video') ?? props.models.video[0])?.modelId
        });
        const created = { ...draftNode, position: placeCanvasNode(canvas, at, draftNode.size) };
        const node: CanvasNode = draft && created.kind === 'imageGen' ? { ...created, payload: { ...created.payload, prompt: draft.prompt } }
            : draft && created.kind === 'videoGen' ? { ...created, payload: { ...created.payload, prompt: draft.prompt } } : created;
        let next = applyCanvasCommand(canvas, { type: 'node.add', node }, { now: now() });
        if (selectedRoute) next = { ...next, settings: { ...next.settings, nodeRoutes: {
            ...(next.settings.nodeRoutes as Record<string, string> | undefined), [node.id]: selectedRoute.key } } };
        const source = from ? nodes.get(from) : undefined;
        const videoInput = Boolean(source && canvasOutputKind(source) === 'video' && kind === 'videoGen' && props.onVideoInput);
        if (videoInput && source) {
            next = applyCanvasCommand(next, { type: 'sequence.connect', link: { id: canvasId('canvas-sequence'), sourceNodeId: source.id, targetNodeId: node.id } }, { now: now() });
        } else if (from) {
            const wired = connectCanvasNodes(next, from, node.id, now());
            if (!wired.error) next = wired.canvas;
        }
        change(next, true);
        setSelected(new Set([node.id]));
        setMenu(undefined);
        if (videoInput && from) props.onVideoInput?.(from, node.id);
        return node;
    };

    const deleteSelection = (): void => {
        if (!selected.size && !selectedEdges.size) return;
        change(deleteFromCanvas(canvas, [...selected], [...selectedEdges], now()), true);
        setSelected(new Set());
        setSelectedEdges(new Set());
    };

    const duplicate = (ids: readonly string[]): void => {
        const result = duplicateCanvasNodes(canvas, ids, { x: 40, y: 40 }, now());
        if (!result.ids.length) return;
        change(result.canvas, true);
        setSelected(new Set(result.ids));
    };

    const copySelection = async (): Promise<void> => {
        try {
            const text = serializeCanvasClipboard(canvas, [...selected]);
            await writeCanvasClipboardText(text);
            props.onNotice(panelText(props.locale, 'copied', { n: selected.size }));
        } catch { props.onNotice(panelText(props.locale, 'clipboardUnavailable')); }
    };
    const pasteClipboard = async (): Promise<void> => {
        let text = '';
        try { text = await readCanvasClipboardText(); }
        catch { props.onNotice(panelText(props.locale, 'clipboardUnavailable')); return; }
        const latest = activeCanvas.current;
        if (latest.id !== canvas.id || latest.projectId !== canvas.projectId) return;
        pasteCanvasText(text, latest);
    };
    const pasteCanvasText = (text: string, latest = canvas): void => {
        const result = pasteCanvasClipboard(latest, text, { offset: { x: 60, y: 60 }, now: now() });
        if (!result.ok) { props.onNotice(panelText(props.locale, 'pasteRefused')); return; }
        change(result.canvas, true);
        setSelected(new Set(result.ids));
        props.onNotice(panelText(props.locale, 'pasted', { n: result.ids.length }));
    };
    const onCanvasPaste = (event: ClipboardEvent): boolean => {
        const data = event.clipboardData;
        if (!data) return false;
        const files = (data.files.length ? Array.from(data.files) : Array.from(data.items).flatMap(item => {
            const file = item.kind === 'file' ? item.getAsFile() : null; return file ? [file] : [];
        })).filter(file => /^(image|video|audio)\//.test(file.type));
        if (files.length) { props.onImport(center(), files); return true; }
        const text = data.getData('text/plain');
        if (!text || !parseCanvasClipboard(text).ok) return false;
        pasteCanvasText(text); return true;
    };
    const onCanvasPasteFallback = (claim: (text: string) => boolean): void => {
        void readNativeCanvasClipboardText().then(text => {
            const latest = activeCanvas.current;
            if (!text || latest.id !== canvas.id || latest.projectId !== canvas.projectId || !parseCanvasClipboard(text).ok || !claim(text)) return;
            pasteCanvasText(text, latest);
        }).catch(() => undefined); // Native file paste is still allowed when there is no canvas text.
    };
    const groupSelection = (): void => {
        if (!selected.size) return;
        const result = groupCanvasNodes(canvas, [...selected], { title: t('groupName'), settings, now: now() });
        if (!result.ok) { props.onNotice(panelText(props.locale, 'groupLimit', { limit: result.limit, count: result.count })); return; }
        change(result.canvas, true);
        setSelected(new Set([result.node.id]));
    };
    const ungroupSelection = (): void => {
        let next = canvas;
        for (const id of selected) { const node = next.nodes.find(item => item.id === id); if (node?.kind === 'group') next = ungroupCanvas(next, node.payload.groupId, now()); }
        if (next !== canvas) { change(next, true); setSelected(new Set()); }
    };
    const arrangeSelection = (mode: 'grid' | 'wires'): void => {
        const ids = [...selected];
        if (ids.length < 2) return;
        let next = canvas;
        for (const placed of arrangeCanvas(canvas, ids, { mode, settings, locale: props.locale })) {
            const node = next.nodes.find(item => item.id === placed.nodeId);
            if (node && (node.position.x !== placed.position.x || node.position.y !== placed.position.y)) next = applyCanvasCommand(next, { type: 'node.move', nodeId: placed.nodeId, position: placed.position }, { now: now() });
        }
        if (next !== canvas) change(next, true);
    };
    const locate = (nodeId: string): void => {
        const node = nodes.get(nodeId);
        if (!node) return;
        void flow.setCenter(node.position.x + node.size.width / 2, node.position.y + node.size.height / 2, { zoom: Math.max(flow.getZoom(), 0.6), duration: 300 });
        setSelected(new Set([nodeId]));
    };

    const generationSelected = [...selected].filter(id => { const node = nodes.get(id); return node?.kind === 'imageGen' || node?.kind === 'videoGen'; });
    const stitchable = [...selected].filter(id => { const current = canvasCurrentVersion(nodes.get(id)); return current?.kind === 'image' && canvasVersionReady(current); });

    // Include group members too; clipboard/delete deduplicate and arrangeCanvas moves each group as one block.
    const selectAll = (): void => { setSelected(new Set(canvas.nodes.map(node => node.id))); setSelectedEdges(new Set()); };
    const persistViewport = (next: CanvasKeyboardViewport): void => {
        const rounded = { x: Math.round(next.x), y: Math.round(next.y), zoom: Math.round(next.zoom * 1000) / 1000 };
        if (rounded.x !== canvas.viewport.x || rounded.y !== canvas.viewport.y || rounded.zoom !== canvas.viewport.zoom) change({ ...canvas, viewport: rounded }, false);
    };
    const onCanvasShortcut = (command: CanvasShortcut): boolean => {
        if (director) return false;
        switch (command) {
            case 'cancel': {
                const openPicker = root.current?.querySelector<HTMLDetailsElement>('details.nmx-board-reference-picker[open]');
                if (openPicker) openPicker.removeAttribute('open');
                else if (preview) setPreview(undefined);
                else if (menu) setMenu(undefined);
                else if (side) setSide(undefined);
                else { setSelected(new Set()); setSelectedEdges(new Set()); }
                break;
            }
            case 'undo': if (props.canUndo) props.onUndo(); break;
            case 'redo': if (props.canRedo) props.onRedo(); break;
            case 'duplicate': duplicate([...selected]); break;
            case 'copy': if (selected.size) void copySelection(); else return false; break;
            case 'paste': void pasteClipboard(); break;
            case 'group': groupSelection(); break;
            case 'ungroup': ungroupSelection(); break;
            case 'selectAll': selectAll(); break;
            case 'fit': void flow.fitView({ padding: 0.2, duration: 300, minZoom: 0.15 }); break;
            case 'zoomIn': case 'zoomOut': void flow.zoomTo(Math.max(0.04, Math.min(3, flow.getZoom() * (command === 'zoomIn' ? 1.2 : 1 / 1.2))), { duration: 300 }); break;
            case 'delete': deleteSelection(); break;
            case 'rename': if (selected.size === 1) setRenaming([...selected][0]); break;
            case 'add': {
                const rect = root.current?.getBoundingClientRect();
                setMenu({ x: (rect?.width ?? 0) / 2 - 110, y: (rect?.height ?? 0) / 2 - 120, at: center(), kind: 'add' }); break;
            }
        }
        return true;
    };
    const keyboard = useCanvasKeyboard({ root, scopeKey: `${canvas.projectId}:${canvas.id}`, settings, onCommand: onCanvasShortcut, onPaste: onCanvasPaste, onPasteFallback: onCanvasPasteFallback,
        getViewport: () => flow.getViewport(), setViewport: next => flow.setViewport(next), onNavigationEnd: persistViewport });

    const menuFor = React.useCallback((event: React.MouseEvent, nodeId: string) => {
        event.preventDefault();
        event.stopPropagation();
        if (!selected.has(nodeId)) setSelected(new Set([nodeId]));
        const local = localPoint(event.clientX, event.clientY);
        setMenu({ x: local.x, y: local.y, at: screenToFlow(event.clientX, event.clientY), kind: 'node', nodeId });
    }, [selected, screenToFlow]);

    const single = selected.size === 1 ? [...selected][0] : undefined;
    const [aiDialog, setAiDialog] = React.useState<{ readonly nodeId: string; readonly tool: CanvasImageToolId }>();
    const libraryScope = `${props.libraryScope ?? canvas.projectId}:${canvas.id}`;
    const [libraryOpen, setLibraryOpen] = React.useState<CanvasPoint & { scope: string; target?: { nodeId: string; role: CanvasInputRole } }>();
    React.useEffect(() => { setLibraryOpen(undefined); }, [libraryScope]);
    const saveAssets = (nodeIds: readonly string[]): void => {
        void saveCanvasAssets({ scope: libraryScope, locale: props.locale, items: canvasAssetSaveItems(canvas, nodeIds),
            onSave: props.onSaveLibraryAsset, onNotice: props.onNotice });
    };
    const aiEdit = (nodeId: string, tool: CanvasImageToolId): void => setAiDialog({ nodeId, tool });
    /** AI tool drafts: new image nodes wired to the source, on the chosen route; optionally run straight away. */
    const createAiNodes = (created: readonly CanvasNode[], edges: readonly CanvasEdge[], route: CanvasModelChoice, runNow: boolean, source: CanvasNode, base?: SavedMarks): void => {
        // Marked drafts build on the canvas that already holds the marked picture, and sit after that picture.
        const anchor = base?.node ?? source;
        const offset = canvasBatchPlacementOffset(base?.canvas ?? canvas, created,
            { x: anchor.position.x + anchor.size.width + 260, y: anchor.position.y + anchor.size.height / 2 });
        let next = base?.canvas ?? canvas;
        for (const node of created) next = applyCanvasCommand(next, { type: 'node.add', node: { ...node, title: `${source.title} · ${node.title}`, position: { x: node.position.x + offset.x, y: node.position.y + offset.y } } }, { now: now() });
        for (const edge of edges) next = applyCanvasCommand(next, { type: 'edge.connect', edge }, { now: now() });
        change(next, true);
        const ids = created.map(node => node.id);
        props.onSetRoute(ids, route);
        setSelected(new Set(ids.slice(0, 1)));
        setAiDialog(undefined);
        const first = next.nodes.find(node => node.id === ids[0]);
        if (first) void flow.setCenter(first.position.x + first.size.width / 2, first.position.y + first.size.height / 2 + 120, { zoom: Math.max(flow.getZoom(), 0.6), duration: 300 });
        props.onNotice(toolText(props.locale, 'aiNodesCreated', { n: ids.length }));
        if (runNow) run(ids);
    };
    const context: CanvasContextValue = { props, t, nodes: dragPreview.length ? new Map([...nodes, ...dragPreview.map(node => [node.id, node] as const)]) : nodes, ...(single ? { single } : {}), ...(renaming ? { renaming } : {}), setRenaming, selectNode: id => setSelected(new Set([id])), change, menuFor, open, run, openTool, aiEdit, extractFrame, pickReference: (nodeId, role) => { const node = nodes.get(nodeId); if (node) { setSelected(new Set([nodeId])); setLibraryOpen({ scope: libraryScope, x: node.position.x, y: node.position.y - 300, target: { nodeId, role } }); } }, saveAssets, download, openHistory, openStoryboard, openDirector, compare, toggleCompare };

    const onDrop = (event: React.DragEvent<HTMLDivElement>): void => {
        const files = Array.from(event.dataTransfer.files || []).filter(file => /^(image|video|audio)\//.test(file.type));
        if (!files.length) return;
        event.preventDefault();
        props.onImport(screenToFlow(event.clientX, event.clientY), files);
    };

    React.useEffect(() => {
        if (!side) return;
        const handleOutsideSidePress = (event: Event): void => {
            const raw = event.target as Node | null;
            const target = raw instanceof Element ? raw : raw?.parentElement ?? null;
            if (target?.closest('.nmx-board-side, [data-nmx-side-toggle], .nmx-board-modal-layer, .nmx-canvas-floating-host, .nmx-comic-lightbox')) return;
            setSide(undefined);
        };
        document.addEventListener('pointerdown', handleOutsideSidePress, true);
        document.addEventListener('mousedown', handleOutsideSidePress, true);
        return () => {
            document.removeEventListener('pointerdown', handleOutsideSidePress, true);
            document.removeEventListener('mousedown', handleOutsideSidePress, true);
        };
    }, [side]);

    return <CanvasContext.Provider value={context}>
        <SurfaceTooltips scope='.nmx-board, .nmx-board-modal-layer, .nmx-canvas-floating-host, .nmx-canvas-history, .nmx-canvas-tabs, .nmx-desk-footer, .nmx-desk-header' />
        <div ref={root} className={`nmx-board${settings.wireHoverHighlight ? '' : ' no-wire-hover'}`} style={{ ['--cv-wire-width' as string]: `${settings.wireWidth}px` }} tabIndex={-1}
            onPointerDownCapture={event => {
                const target = event.target as Element | null;
                if (side && !target?.closest('.nmx-board-side, [data-nmx-side-toggle]')) setSide(undefined);
                root.current?.querySelectorAll<HTMLDetailsElement>('.nmx-board-reference-picker[open]').forEach(picker => {
                    if (!target || !picker.contains(target)) picker.removeAttribute('open');
                });
            }}
            onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={onDrop}>
            <ReactFlow nodes={flowNodes} edges={flowEdges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES}
                onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
                onConnectStart={(_event, params) => { connectingFrom.current = params.nodeId ?? undefined; }} onConnectEnd={onConnectEnd}
                onNodeDragStart={(event, node, dragged) => {
                    setNodeDragging(true); dragOrigin.current = new Map([[node.id, nodes.get(node.id)?.position ?? node.position]]);
                    if (!('altKey' in event) || !event.altKey || (event.target as Element | null)?.closest('input,textarea,select,button,[contenteditable="true"],.nodrag')) return;
                    const ids = dragged.length ? dragged.map(item => item.id) : selected.has(node.id) ? [...selected] : [node.id];
                    const result = prepareCanvasDragCopy(canvas, ids, event.metaKey || event.ctrlKey, now());
                    dragCopy.current = { anchor: node.id, origin: nodes.get(node.id)?.position ?? node.position, offset: { x: 0, y: 0 }, active: false, ...(result.ok ? { plan: result.plan } : {}) };
                    if (!result.ok) props.onNotice(`${panelText(props.locale, 'pasteRefused')} ${result.message}`);
                }}
                onNodeDrag={(event, node, dragged) => {
                    if (dragCopy.current || !('altKey' in event) || !event.altKey) return;
                    const origin = dragOrigin.current?.get(node.id);
                    if (!origin) return;
                    const offset = { x: node.position.x - origin.x, y: node.position.y - origin.y };
                    if (Math.abs(offset.x) <= CANVAS_DRAG_COPY_THRESHOLD && Math.abs(offset.y) <= CANVAS_DRAG_COPY_THRESHOLD) return;
                    const ids = dragged.length ? dragged.map(item => item.id) : selected.has(node.id) ? [...selected] : [node.id];
                    const result = prepareCanvasDragCopy(canvas, ids, event.metaKey || event.ctrlKey, now());
                    dragCopy.current = { anchor: node.id, origin, offset, active: true, ...(result.ok ? { plan: result.plan } : {}) };
                    if (result.ok) setDragPreview(result.plan.nodes.map(item => ({ ...item, position: { x: item.position.x + offset.x, y: item.position.y + offset.y } })));
                    else props.onNotice(`${panelText(props.locale, 'pasteRefused')} ${result.message}`);
                }}
                onNodeDragStop={() => setNodeDragging(false)}
                onPaneClick={() => {
                    setMenu(undefined); setSelected(new Set()); setSelectedEdges(new Set());
                    // The floating 生成记录 window is not modal: a click on the empty canvas puts it away.
                    if (history && !history.nodeId) closeHistory();
                    root.current?.focus();
                }}
                onPaneContextMenu={event => {
                    event.preventDefault();
                    if (settings.blankAreaAction !== 'rightClick') return;
                    const local = localPoint(event.clientX, event.clientY); setMenu({ x: local.x, y: local.y, at: screenToFlow(event.clientX, event.clientY), kind: 'add' });
                }}
                onDoubleClick={event => {
                    if (settings.blankAreaAction !== 'doubleClick') return;
                    if ((event.target as HTMLElement).closest('.react-flow__node, .react-flow__edge, .nmx-board-menu')) return;
                    const local = localPoint(event.clientX, event.clientY);
                    setMenu({ x: local.x, y: local.y, at: screenToFlow(event.clientX, event.clientY), kind: 'add' });
                }}
                defaultViewport={canvas.viewport.zoom ? { x: canvas.viewport.x, y: canvas.viewport.y, zoom: canvas.viewport.zoom } : undefined}
                onInit={instance => {
                    // A canvas never viewed opens readable at its top-left (characters, then the first shots),
                    // rather than shrunk until a whole long episode fits.
                    if (canvas.viewport.x !== 0 || canvas.viewport.y !== 0 || canvas.viewport.zoom !== 1 || !canvas.nodes.length) return;
                    const rect = root.current?.getBoundingClientRect();
                    if (!rect) return;
                    const left = Math.min(...canvas.nodes.map(node => node.position.x)), top = Math.min(...canvas.nodes.map(node => node.position.y));
                    const right = Math.max(...canvas.nodes.map(node => node.position.x + node.size.width)), bottom = Math.max(...canvas.nodes.map(node => node.position.y + node.size.height));
                    const zoom = Math.max(0.35, Math.min(1, (rect.width - 120) / Math.max(1, right - left), (rect.height - 160) / Math.max(1, bottom - top)));
                    void instance.setViewport({ x: Math.round(60 - left * zoom), y: Math.round(60 - top * zoom), zoom });
                }}
                minZoom={0.04} maxZoom={3} zoomOnDoubleClick={false} panOnScroll={settings.wheelAction === 'pan'} zoomOnScroll={settings.wheelAction === 'zoom'}
                panOnScrollSpeed={0.35 * settings.panSensitivity} snapToGrid={settings.snapGrid} snapGrid={[CANVAS_SNAP_GRID_SIZE, CANVAS_SNAP_GRID_SIZE]} zoomOnPinch selectionOnDrag={!keyboard.spacePressed} panOnDrag={keyboard.spacePressed ? true : [1, 2]} selectionMode={SelectionMode.Partial}
                deleteKeyCode={null} selectionKeyCode={null} panActivationKeyCode={null} nodesDraggable={!keyboard.spacePressed} multiSelectionKeyCode={['Meta', 'Control', 'Shift']} connectionRadius={60}
                proOptions={{ hideAttribution: true }}
                onMoveEnd={(_event, next) => {
                    if (!keyboard.navigationActive.current) persistViewport(next);
                }}>
                {settings.showGrid && <Background variant={BackgroundVariant.Dots} gap={settings.gridSpacing} size={settings.gridDotSize} className='nmx-board-grid' />}
                {settings.minimap && <MiniMap pannable zoomable className='nmx-board-minimap' nodeBorderRadius={8} />}
            </ReactFlow>

            <SaveBadge state={props.saveState} t={t} onRetry={props.onRetrySave} />
            {side === 'edges' && <CanvasEdgeAuditPanel locale={props.locale} canvas={canvas} onClose={() => setSide(undefined)}
                onApply={next => { change(next, true); setSelectedEdges(new Set()); }} onLocate={edge => {
                    const bounds = canvasEdgeBounds(canvas, edge);
                    setSelected(new Set()); setSelectedEdges(new Set([edge.id]));
                    if (bounds) void flow.fitBounds(bounds, { padding: 0.3, duration: 300 });
                }} />}
            {director && (() => {
                const node = nodes.get(director);
                if (!node || (node.kind !== 'sceneComposer' && node.kind !== 'world')) return null;
                const versions = [...node.payload.versions, ...(node.payload.inputs ?? []).map(input => input.version)];
                try { for (const input of resolveCanvasInputs(canvas, node.id).inputs.filter(input => input.kind === 'image')) {
                    if (!versions.some(version => version.id === input.versionId)) versions.push({ id: input.versionId, assetId: input.assetId, kind: 'image', uri: input.uri, createdAt: canvas.createdAt });
                } } catch { /* Invalid dependencies are shown by the canvas. */ }
                const images = versions.filter(version => version.kind === 'image' && canvasVersionReady(version)).map(version => ({ id: version.id, uri: version.uri, title: canvas.nodes.find(source => 'versions' in source.payload && source.payload.versions.some(item => item.id === version.id))?.title ?? node.title }));
                return <DirectorStage key={`director-${node.id}`} locale={props.locale} scene={node.kind === 'sceneComposer' ? node.payload.scene : node.payload.world.scene ?? { ...emptyDirectorScene(), aspectRatio: node.payload.world.aspectRatio }}
                    {...(node.kind === 'world' ? { world: node.payload.world } : {})} images={images} resolveAssetUrl={props.mediaUrl}
                    onClose={() => { setDirector(undefined); root.current?.focus(); }}
                    onSave={scene => { if (node.kind === 'sceneComposer') change(applyCanvasCommand(canvas, { type: 'node.setScene', nodeId: node.id, scene }, { now: now() }), true); }}
                    onSaveWorld={world => { if (node.kind === 'world') change(applyCanvasCommand(canvas, { type: 'node.setWorld', nodeId: node.id, world }, { now: now() }), true); }}
                    onCapture={capture => props.onDirectorCapture(node.id, capture)} onImportModel={props.onDirectorImport} />;
            })()}
            {single && <NodePanelOverlay key={single} nodeId={single} hidden={nodeDragging || keyboard.navigating} />}

            {!canvas.nodes.length && <div className='nmx-board-empty'><strong>{t('empty')}</strong><span>{t('emptyHint')}</span></div>}
            <ReturnToNodes canvas={canvas} root={root} t={t} />

            {selected.size > 1 && <div className='nmx-board-selection' role='toolbar'>
                <span data-nmx-literal>{t('selected', { n: selected.size })}</span>
                <button type='button' onClick={() => saveAssets([...selected])}><i className='codicon codicon-save' aria-hidden='true'></i>{comicAssetLibraryText(props.locale, 'save')}</button>
                {props.onDownload && <button type='button' disabled={!canvasDownloadItems(canvas.nodes.filter(node => selected.has(node.id))).length} onClick={() => download([...selected])}><i className='codicon codicon-desktop-download' aria-hidden='true'></i>{downloadText(props.locale, 'download')}</button>}
                <button type='button' onClick={groupSelection} title={platformShortcutText('⌘G')}><i className='codicon codicon-folder' aria-hidden='true'></i>{t('group')}</button>
                <button type='button' onClick={() => arrangeSelection('grid')}><i className='codicon codicon-layout' aria-hidden='true'></i>{panelText(props.locale, 'arrangeGrid')}</button>
                <button type='button' onClick={() => arrangeSelection('wires')}><i className='codicon codicon-type-hierarchy-sub' aria-hidden='true'></i>{panelText(props.locale, 'arrangeWires')}</button>
                {stitchable.length > 1 && <button type='button' onClick={() => setToolDialog({ nodeId: stitchable[0], tool: 'image.gridStitch', stitch: stitchable })}>
                    <i className='codicon codicon-layout-panel' aria-hidden='true'></i>{toolText(props.locale, 'tool.image.gridStitch')}</button>}
                {generationSelected.length > 0 && <button type='button' title={t('generateSelected', { n: generationSelected.length })} className='is-primary' onClick={() => run(generationSelected)}>
                    <i className='codicon codicon-sparkle' aria-hidden='true'></i>{t('generateSelected', { n: generationSelected.length })}</button>}
                <button type='button' onClick={() => duplicate([...selected])}><i className='codicon codicon-copy' aria-hidden='true'></i>{t('duplicate')}</button>
                <button type='button' onClick={deleteSelection}><i className='codicon codicon-trash' aria-hidden='true'></i>{t('delete')}</button>
            </div>}

            {downloads && props.onDownload && <CanvasModalLayer locale={props.locale}><CanvasDownloadDialog locale={props.locale} items={downloads} onSave={props.onDownload} onClose={() => setDownloads(undefined)}
                onSaved={result => props.onNotice(downloadText(props.locale, 'saved', { name: result.fileName }))} /></CanvasModalLayer>}
            {history && <CanvasGenerationHistoryDialog key={`${canvas.id}:${history.nodeId ?? 'global'}`} locale={props.locale}
                canvases={history.canvases.map(item => item.id === canvas.id ? canvas : item)}
                {...(history.nodeId ? { initialCanvasId: canvas.id, initialNodeId: history.nodeId } : {})}
                mediaUrl={props.mediaUrl} onClose={closeHistory}
                onRefresh={async () => {
                    const request = historyRequest.current;
                    const canvases = props.loadHistoryCanvases ? await props.loadHistoryCanvases() : [canvas];
                    if (request === historyRequest.current) setHistory(current => current ? { ...current, canvases } : undefined);
                }}
                onSelectVersion={async (canvasId, nodeId, versionId) => {
                    const request = historyRequest.current;
                    if (props.onSelectHistoryVersion) await props.onSelectHistoryVersion(canvasId, nodeId, versionId);
                    else {
                        if (canvasId !== canvas.id) throw new Error('CANVAS_NOT_FOUND');
                        change(applyCanvasCommand(canvas, { type: 'node.selectVersion', nodeId, versionId }, { now: now() }), true);
                    }
                    if (request === historyRequest.current) closeHistory();
                }} />}
            {props.storyStatus && <div className='nmx-board-story-status' role='status'><span>{props.storyStatus}</span>{props.storyBusy && <button type='button' title={t('cancel')} onClick={props.onCancelStory}>{t('cancel')}</button>}</div>}
            <CanvasViewControls locale={props.locale} settings={settings} onSettings={setSettings} root={root} compareCount={compare.length} onCompare={() => setCompareOpen(true)} onSelectAll={selectAll} />
            <CanvasAutoDock locale={props.locale} storageKey={`${settingsKey}:autoDock`} root={root} keepOpen={Boolean(single || menu || side || preview || director || compareOpen || toolDialog || aiDialog || frameDialog || batch || downloads || libraryOpen)}>
                <button type='button' className='is-primary' title={t('addTitle')} aria-label={t('addTitle')} onClick={() => { const rect = root.current?.getBoundingClientRect(); setMenu({ x: (rect?.width ?? 0) / 2 - 110, y: (rect?.height ?? 0) - 330, at: center(), kind: 'add' }); }}>
                    <i className='codicon codicon-add' aria-hidden='true' /></button>
                <button type='button' title={comicAssetLibraryText(props.locale, 'library')} aria-label={comicAssetLibraryText(props.locale, 'library')} onClick={() => setLibraryOpen({ ...center(), scope: libraryScope })}><i className='codicon codicon-folder' aria-hidden='true' /></button>
                <button type='button' title={canvasHistoryText(props.locale, 'title')} aria-label={canvasHistoryText(props.locale, 'title')} onClick={() => openHistory()}><i className='codicon codicon-history' aria-hidden='true' /></button>
                <button type='button' data-nmx-side-toggle='true' className={side === 'locate' ? 'is-on' : ''} aria-pressed={side === 'locate'} onClick={() => setSide(side === 'locate' ? undefined : 'locate')} title={panelText(props.locale, 'locate')} aria-label={panelText(props.locale, 'locate')}><i className='codicon codicon-target' aria-hidden='true' /></button>
                <button type='button' data-nmx-side-toggle='true' className={side === 'settings' ? 'is-on' : ''} aria-pressed={side === 'settings'} onClick={() => setSide(side === 'settings' ? undefined : 'settings')} title={panelText(props.locale, 'settings')} aria-label={panelText(props.locale, 'settings')}><i className='codicon codicon-settings-gear' aria-hidden='true' /></button>
            </CanvasAutoDock>
            <div className='nmx-board-statistics'>
                <span title={props.locale.startsWith('zh') ? '连线数量' : 'Connections'}><i className='codicon codicon-arrow-right' aria-hidden='true' />{canvas.edges.length + (canvas.sequenceLinks?.length ?? 0)}</span>
                <span title={props.locale.startsWith('zh') ? '节点数量' : 'Nodes'}><i className='codicon codicon-layout' aria-hidden='true' />{canvas.nodes.length}</span>
                <button type='button' data-nmx-side-toggle='true' title={canvasEdgeAuditText(props.locale, 'title')} aria-label={canvasEdgeAuditText(props.locale, 'title')} onClick={() => setSide(side === 'edges' ? undefined : 'edges')}><i className='codicon codicon-warning' aria-hidden='true' /></button>
            </div>

            {menu && <CanvasMenu menu={menu} t={t} canvas={canvas} onClose={() => setMenu(undefined)} onAdd={addNode}
                onSaveAssets={ids => { setMenu(undefined); saveAssets(ids); }} saveLabel={comicAssetLibraryText(props.locale, 'save')}
                onUpload={at => { setMenu(undefined); props.onImport(at); }} onBatch={at => { setMenu(undefined); setBatch(at); }} batchLabel={batchText(props.locale, 'menu')} canUndo={props.canUndo} canRedo={props.canRedo} onUndo={props.onUndo} onRedo={props.onRedo}
                onRun={ids => { setMenu(undefined); run(ids); }} onDuplicate={ids => { setMenu(undefined); duplicate(ids); }}
                onUngroup={groupId => { setMenu(undefined); change(ungroupCanvas(canvas, groupId, now()), true); setSelected(new Set()); }} ungroupLabel={t('ungroup')}
                onDelete={() => { setMenu(undefined); deleteSelection(); }} onRename={id => { setMenu(undefined); setRenaming(id); }} selected={selected} />}

            {side === 'locate' && <LocatorPanel locale={props.locale} t={t} canvas={canvas} mediaUrl={props.mediaUrl} onLocate={locate} onClose={() => setSide(undefined)}
                onClearPins={color => change(clearCanvasPins(canvas, color, now()), true)} />}
            {side === 'settings' && <SettingsPanel locale={props.locale} t={t} settings={settings} onChange={setSettings} onClose={() => setSide(undefined)} />}
            {pendingRun && <div className='nmx-board-countdown' role='status'>
                <i className='codicon codicon-watch' aria-hidden='true'></i>
                <span data-nmx-literal>{panelText(props.locale, 'submitIn', { n: Math.max(0, Math.ceil((pendingRun.endsAt - Date.now()) / 1000)) })}</span>
                <button type='button' onClick={() => setPendingRun(undefined)}>{panelText(props.locale, 'cancelSubmit')}</button>
            </div>}

            {aiDialog && (() => {
                const node = nodes.get(aiDialog.nodeId);
                const version = canvasCurrentVersion(node);
                if (!node || !version || version.kind !== 'image') return null;
                const initial = node.kind === 'imageGen' ? props.routeOf(node) : props.defaultRoute('image');
                return <CanvasModalLayer locale={props.locale}><AiToolDialog locale={props.locale} tool={aiDialog.tool} canvas={canvas} source={node} version={version} families={props.families.image}
                    {...(initial ? { initialRoute: initial } : {})} capabilityOf={props.capabilityOf} mediaUrl={props.mediaUrl} defaults={props.defaults}
                    position={{ x: node.position.x + node.size.width + 260, y: node.position.y }} onClose={() => setAiDialog(undefined)}
                    onCreate={(created, edges, route, runNow, base) => createAiNodes(created, edges, route, runNow, node, base)}
                    onSaveMarks={async picture => {
                        const saved = await props.onSaveMarks({ nodeId: node.id, versionId: version.id, picture, title: `${node.title} · ${marksText(props.locale, 'nodeTitle')}`,
                            position: placeCanvasNode(canvas, { x: node.position.x + node.size.width + 200, y: node.position.y + node.size.height / 2 }, node.size) });
                        const marked = saved.canvas.nodes.find(item => item.id === saved.nodeId);
                        if (!marked) throw new Error(marksText(props.locale, 'empty'));
                        return { canvas: saved.canvas, node: marked, version: saved.version };
                    }} /></CanvasModalLayer>;
            })()}

            {libraryOpen?.scope === libraryScope && <CanvasModalLayer locale={props.locale}><CanvasAssetLibraryDialog locale={props.locale} load={props.assetLibraryEntries}
                operationScope={`${props.libraryScope ?? canvas.id}:${libraryOpen.target ? `${libraryOpen.target.nodeId}:${libraryOpen.target.role}` : 'canvas'}`}
                {...(libraryOpen.target ? { useLabel: `${comicAssetLibraryText(props.locale, 'useInput')} · ${t(`role.${libraryOpen.target.role}` as CanvasTextKey)}`, initialFilter: libraryOpen.target.role === 'referenceAudio' ? 'audio' as const : libraryOpen.target.role === 'referenceVideo' ? 'video' as const : 'image' as const,
                    selectTypes: [libraryOpen.target.role === 'referenceAudio' ? 'audio' as const : libraryOpen.target.role === 'referenceVideo' ? 'video' as const : 'image' as const] } : {})}
                onUpload={props.onUploadLibrary} onPin={props.onPinLibrary} onCategoryChange={props.onCategoryChangeLibrary} onDelete={props.onDeleteLibrary}
                onUse={async (assetId, requestId) => { await props.onUseLibraryAsset(assetId, libraryOpen, requestId, libraryOpen.target); if (libraryOpen.target) setLibraryOpen(current => current === libraryOpen ? undefined : current); }} onClose={() => setLibraryOpen(current => current === libraryOpen ? undefined : current)} /></CanvasModalLayer>}

            {frameDialog && <CanvasModalLayer locale={props.locale}><CanvasFrameExtractDialog locale={props.locale}
                version={frameDialog.version} mediaUrl={props.mediaUrl} busy={frameBusy}
                onRun={selection => runFrameExtraction(frameDialog.nodeId, frameDialog.version.id, selection)}
                onClose={() => setFrameDialog(undefined)} /></CanvasModalLayer>}

            {toolDialog && (() => {
                const node = nodes.get(toolDialog.nodeId);
                const version = canvasCurrentVersion(node);
                if (!node || !version) return null;
                const pictures = canvas.nodes.filter(item => item.id !== node.id).flatMap(item => { const current = canvasCurrentVersion(item); return current?.kind === 'image' && canvasVersionReady(current) ? [{ versionId: current.id, title: item.title, uri: current.uri }] : []; });
                const stitch = toolDialog.stitch?.flatMap(id => { const item = nodes.get(id), current = canvasCurrentVersion(item); return item && current?.kind === 'image' ? [{ version: current, title: item.title }] : []; });
                return <CanvasModalLayer locale={props.locale}><ToolDialog locale={props.locale} tool={toolDialog.tool} version={version} mediaUrl={props.mediaUrl} pictures={pictures} {...(stitch ? { stitch } : {})}
                    busy={props.toolProgress.has(node.id)} {...(props.toolProgress.get(node.id) !== undefined ? { progress: props.toolProgress.get(node.id) } : {})}
                    onPickLut={props.onPickLut} onCancel={() => props.onCancelTool(node.id)} onClose={() => setToolDialog(undefined)}
                    onRun={parameters => { void props.onTool(node.id, toolDialog.tool, parameters).then(created => { if (created) { setToolDialog(undefined); revealCreated(created); } }); }} /></CanvasModalLayer>;
            })()}

            {compareOpen && <CanvasModalLayer locale={props.locale}><CompareWindow locale={props.locale} library={compare} mediaUrl={props.mediaUrl} onClose={() => setCompareOpen(false)}
                onRemove={uri => setCompare(removeCanvasCompareVersion(compare, uri))} onClear={() => setCompare([])} /></CanvasModalLayer>}

            {storyboardFor && (() => {
                const node = nodes.get(storyboardFor.nodeId);
                if (!node || node.kind !== 'videoGen') return null;
                const saved = (canvas.settings.nodeStoryboard as Readonly<Record<string, CanvasStoryboard>> | undefined)?.[node.id];
                const cameraPrompt = deriveCanvasCameraPrompt(storyboardFor.prompt,
                    (canvas.settings.nodeCamera as Readonly<Record<string, unknown>> | undefined)?.[node.id]);
                const seconds = typeof node.payload.parameters.durationSeconds === 'number' ? node.payload.parameters.durationSeconds : props.defaults.durationSeconds ?? 5;
                let inputs: ReturnType<typeof resolveCanvasInputs>['inputs'] = [];
                try { inputs = resolveCanvasInputs(canvas, node.id).inputs; } catch { /* Invalid inputs stay reported on the node's generation form. */ }
                const references = inputs.flatMap(input => input.kind === 'image' || input.kind === 'video' || input.kind === 'audio'
                    ? [{ id: `${input.edgeId ?? input.inputId ?? input.versionId}:${input.versionId}`, kind: input.kind, uri: props.mediaUrl(input.uri),
                        label: nodes.get(input.sourceNodeId ?? '')?.title ?? t(`role.${input.role}` as CanvasTextKey) }] : []);
                return <StoryboardDialog locale={props.locale} prompt={cameraPrompt.body} durationSeconds={seconds} references={references} {...(saved ? { saved } : {})} onClose={() => setStoryboardFor(undefined)}
                    onApply={(body, storyboard) => {
                        setStoryboardFor(undefined);
                        const { prompt, state } = composeCanvasCameraPrompt(body, cameraPrompt.state?.selection ?? { movements: [], speed: 'normal' });
                        let next = withCameraState(applyCanvasCommand(canvas, { type: 'node.setParameters', nodeId: node.id, parameters: node.payload.parameters, prompt }, { now: now() }), node.id, state);
                        next = { ...next, settings: { ...next.settings, nodeStoryboard: { ...(next.settings.nodeStoryboard as Record<string, CanvasStoryboard> | undefined), [node.id]: storyboard } } };
                        change(next, true);
                    }} />;
            })()}

            {batch && <CanvasModalLayer locale={props.locale}><BatchImportDialog locale={props.locale} t={t} canvas={canvas} origin={batch} models={props.models} defaultRoute={props.defaultRoute} defaults={props.defaults}
                onClose={() => setBatch(undefined)} onAdd={(next, ids, route) => {
                    setBatch(undefined);
                    change(next, true);
                    setSelected(new Set(ids));
                    const kind = route?.kind;
                    if (route && kind && props.defaultRoute(kind)?.key !== route.key) props.onSetRoute(ids, route);
                }} /></CanvasModalLayer>}

            {preview && <CanvasModalLayer locale={props.locale}><div className='nmx-board-lightbox' role='dialog' aria-modal='true'
                onPointerDown={event => { previewBackdropPress.current = event.button === 0 && event.target === event.currentTarget; event.stopPropagation(); }}
                onPointerUp={event => { if (event.target !== event.currentTarget) previewBackdropPress.current = false; event.stopPropagation(); }}
                onPointerCancel={() => { previewBackdropPress.current = false; }}
                onClick={event => { const close = previewBackdropPress.current && event.target === event.currentTarget; previewBackdropPress.current = false; event.stopPropagation(); if (close) setPreview(undefined); }}
                onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); setPreview(undefined); } }}>
                {preview.kind === 'video'
                    ? <video src={props.mediaUrl(preview.uri)} controls autoPlay playsInline />
                    : <img src={props.mediaUrl(preview.uri)} alt='' />}
                <button type='button' className='nmx-board-lightbox-close' aria-label={t('cancel')} title={t('cancel')} onPointerDown={event => event.stopPropagation()} onClick={() => setPreview(undefined)}><i className='codicon codicon-close' aria-hidden='true'></i></button>
            </div></CanvasModalLayer>}
        </div>
    </CanvasContext.Provider>;
}

function ReturnToNodes(props: { readonly canvas: CanvasDocument; readonly root: React.RefObject<HTMLDivElement>; readonly t: T }): React.ReactElement | null {
    const flow = useReactFlow();
    const viewport = useViewport();
    const rect = props.root.current?.getBoundingClientRect();
    if (!rect || !props.canvas.nodes.length) return null;
    const left = -viewport.x / viewport.zoom, top = -viewport.y / viewport.zoom;
    const right = left + rect.width / viewport.zoom, bottom = top + rect.height / viewport.zoom;
    if (props.canvas.nodes.some(node => node.position.x < right && node.position.x + node.size.width > left && node.position.y < bottom && node.position.y + node.size.height > top)) return null;
    return <button type='button' className='nmx-board-return' onClick={() => void flow.fitView({ padding: 0.15, duration: 250 })}>
        <span>{props.t('noViewNodes')}</span><strong>{props.t('backToNodes')}</strong></button>;
}

function SaveBadge(props: { readonly state: ComicCanvasProps['saveState']; readonly t: T; readonly onRetry: () => void }): React.ReactElement {
    const { state, t } = props;
    return <div className={`nmx-board-save is-${state}`} role='status' title={state === 'saved' ? t('saved') : undefined} aria-label={state === 'saved' ? t('saved') : undefined}>
        {state === 'saving' && <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>}
        {state === 'saved' && <i className='codicon codicon-check' aria-hidden='true'></i>}
        {state === 'failed' && <i className='codicon codicon-warning' aria-hidden='true'></i>}
        {state !== 'saved' && <span>{t(state === 'saving' ? 'saving' : state === 'failed' ? 'saveFailed' : 'unsaved')}</span>}
        {state === 'failed' && <button type='button' className='nmx-link-button' onClick={props.onRetry}>{t('retry')}</button>}
    </div>;
}

function CanvasMenu(props: {
    readonly menu: MenuState; readonly t: T; readonly canvas: CanvasDocument; readonly selected: ReadonlySet<string>;
    readonly canUndo: boolean; readonly canRedo: boolean;
    readonly onClose: () => void; readonly onAdd: (kind: CanvasAddKind, at: CanvasPoint, from?: string) => void; readonly onUpload: (at: CanvasPoint) => void;
    readonly onBatch: (at: CanvasPoint) => void; readonly batchLabel: string;
    readonly onSaveAssets: (ids: readonly string[]) => void; readonly saveLabel: string;
    readonly onUngroup: (groupId: string) => void; readonly ungroupLabel: string;
    readonly onUndo: () => void; readonly onRedo: () => void; readonly onRun: (ids: readonly string[]) => void; readonly onDuplicate: (ids: readonly string[]) => void;
    readonly onDelete: () => void; readonly onRename: (id: string) => void;
}): React.ReactElement {
    const { menu, t, canvas } = props;
    const box = React.useRef<HTMLDivElement>(null);
    const [placement, setPlacement] = React.useState({ x: menu.x, y: menu.y });
    React.useLayoutEffect(() => {
        const place = (): void => {
            const element = box.current, parent = element?.offsetParent as HTMLElement | null;
            if (!element || !parent) return;
            const x = Math.max(8, Math.min(menu.x, parent.clientWidth - element.offsetWidth - 8));
            const y = Math.max(8, Math.min(menu.y, parent.clientHeight - element.offsetHeight - 8));
            setPlacement(current => current.x === x && current.y === y ? current : { x, y });
        };
        place(); window.addEventListener('resize', place);
        return () => window.removeEventListener('resize', place);
    }, [menu.x, menu.y, menu.nodeId, props.selected.size]);
    React.useEffect(() => {
        const close = (event: MouseEvent): void => { if (!box.current?.contains(event.target as Node)) props.onClose(); };
        window.addEventListener('mousedown', close, true);
        return () => window.removeEventListener('mousedown', close, true);
    }, [props.onClose]);
    const source = menu.from ? canvas.nodes.find(node => node.id === menu.from) : undefined;
    const kinds = menu.kind === 'connect' && source ? canvasConnectTargets(canvasOutputKind(source)) : ADD_KINDS;
    const item = (icon: string, label: string, run: () => void, disabled = false): React.ReactElement =>
        <button type='button' role='menuitem' key={label} disabled={disabled} onClick={run}><i className={`codicon codicon-${icon}`} aria-hidden='true'></i>{label}</button>;
    const node = menu.nodeId ? canvas.nodes.find(item => item.id === menu.nodeId) : undefined;
    const ids = node && props.selected.has(node.id) ? [...props.selected] : node ? [node.id] : [];
    const runnable = ids.filter(id => { const candidate = canvas.nodes.find(item => item.id === id); return candidate?.kind === 'imageGen' || candidate?.kind === 'videoGen'; });
    return <div ref={box} className='nmx-board-menu' role='menu' style={{ left: placement.x, top: placement.y, maxHeight: 'calc(100% - 16px)', overflowY: 'auto' }} onContextMenu={event => event.preventDefault()}>
        {menu.kind === 'node' && node ? <>
            {runnable.length > 0 && item('sparkle', runnable.length > 1 ? t('generateSelected', { n: runnable.length }) : t('generate'), () => props.onRun(runnable), runnable.some(id => canvasNodeBusy(canvas.nodes.find(item => item.id === id))))}
            {node.kind === 'group' && item('folder-opened', `${props.ungroupLabel}  ${platformShortcutText('⇧⌘G')}`, () => props.onUngroup(node.payload.groupId))}
            {item('save', props.saveLabel, () => props.onSaveAssets(ids), !ids.some(id => { const candidate = canvas.nodes.find(item => item.id === id), version = canvasCurrentVersion(candidate);
                return candidate?.kind === 'text' ? Boolean(candidate.payload.text.trim()) : Boolean(version && canvasVersionReady(version)); }))}
            {item('edit', `${t('rename')}  F2`, () => props.onRename(node.id), ids.length > 1)}
            {item('copy', `${t('duplicate')}  ${platformShortcutText('⌘D')}`, () => props.onDuplicate(ids))}
            {item('trash', t('delete'), props.onDelete)}
        </> : <>
            <header>{menu.kind === 'connect' ? t('connectNew') : t('addTitle')}</header>
            {kinds.map(kind => item(canvasKindIcon(kind), t(`kind.${kind}` as CanvasTextKey), () => props.onAdd(kind, menu.at, menu.from)))}
            {menu.kind === 'add' && <>
                <hr />
                {item('list-ordered', props.batchLabel, () => props.onBatch(menu.at))}
                {item('cloud-upload', t('upload'), () => props.onUpload(menu.at))}
                {item('discard', t('undo'), () => { props.onClose(); props.onUndo(); }, !props.canUndo)}
                {item('redo', t('redo'), () => { props.onClose(); props.onRedo(); }, !props.canRedo)}
            </>}
        </>}
    </div>;
}

/** The canvas step of the production desk. */
export function ComicCanvas(props: ComicCanvasProps): React.ReactElement {
    return <ReactFlowProvider><Board {...props} /></ReactFlowProvider>;
}
