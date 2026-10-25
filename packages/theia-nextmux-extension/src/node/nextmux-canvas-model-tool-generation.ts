import { createHash } from 'node:crypto';
import type { CanvasAssetVersion, CanvasDocument, CanvasNode } from '@nextmux/comic-core';
import type { RunDesktopComicCanvasModelToolRequest } from '../common/nextmux-platform-protocol';
import type { CanvasModelToolRoutePlan } from '../common/nextmux-canvas-model-tools';
import { CanvasServiceError } from './nextmux-canvas-store';

function digest(value: unknown): string {
    const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
        : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().filter(key => (item as Record<string, unknown>)[key] !== undefined)
            .map(key => [key, canonical((item as Record<string, unknown>)[key])])) : item;
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function canvasModelToolRequestFingerprint(request: RunDesktopComicCanvasModelToolRequest): string {
    // Transport retries can use a refreshed revision; the operation and its confirmed cost stay fixed.
    const { workspaceRoot: _root, expectedRevision: _revision, position: _position, ...click } = request;
    return digest(click);
}

export interface CanvasModelToolClick {
    readonly key: string;
    readonly fingerprint: string;
    readonly nodeId: string;
    readonly nodeFingerprint: string;
    readonly capabilityVersion: string;
}

export function canvasModelToolClick(canvas: CanvasDocument, key: string): CanvasModelToolClick | undefined {
    const clicks = canvas.settings.canvasModelToolClicks;
    if (clicks === undefined) return undefined;
    if (!Array.isArray(clicks) || clicks.some(item => !item || typeof item !== 'object'
        || ['key', 'fingerprint', 'nodeId', 'nodeFingerprint', 'capabilityVersion'].some(field => typeof item[field] !== 'string' || !item[field]))) {
        throw new CanvasServiceError('CANVAS_TOOL_CLICK_INVALID', 'The persisted model tool click journal is invalid.');
    }
    return clicks.find((item: CanvasModelToolClick) => item.key === key);
}

export function canvasModelToolNodeFingerprint(node: CanvasNode): string {
    return digest(node);
}

export function canvasModelToolSource(canvas: CanvasDocument, nodeId: string, versionId: string): CanvasAssetVersion {
    const node = canvas.nodes.find(item => item.id === nodeId);
    const version = node && 'versions' in node.payload ? node.payload.versions.find(item => item.id === versionId) : undefined;
    if (!version) throw new CanvasServiceError('SOURCE_VERSION_MISSING', 'Select a persisted canvas media version before using this tool.');
    return structuredClone(version);
}

/** Add a generation node with frozen direct references, without invoking any provider. */
export function prepareCanvasModelToolGeneration(canvas: CanvasDocument, request: RunDesktopComicCanvasModelToolRequest,
    plan: Extract<CanvasModelToolRoutePlan, { status: 'available' }>): { canvas: CanvasDocument; click: CanvasModelToolClick } {
    const source = canvas.nodes.find(item => item.id === request.nodeId);
    if (!source) throw new CanvasServiceError('SOURCE_NODE_REQUIRED', 'Select a canvas source node.');
    const nodeId = `canvas-model-tool-${digest([canvas.id, request.idempotencyKey]).slice(0, 32)}`;
    if (canvas.nodes.some(node => node.id === nodeId)) throw new CanvasServiceError('CANVAS_TOOL_CLICK_CONFLICT', 'The tool node ID already belongs to another operation.');
    const payload = { modelId: plan.modelId, prompt: plan.prompt, parameters: plan.parameters, versions: [],
        inputs: plan.inputs.map((input, index) => ({ id: `${nodeId}-input-${index}`, role: input.role, order: index, version: structuredClone(input.version) })) };
    const base = { id: nodeId, title: `${source.title} · ${request.operation}`, position: request.position || { x: source.position.x + source.size.width + 60, y: source.position.y }, size: { width: 320, height: 240 } };
    const node: CanvasNode = plan.kind === 'image' ? { ...base, kind: 'imageGen', payload: { ...payload, mode: 'imageToImage' } }
        : { ...base, kind: 'videoGen', payload: { ...payload, mode: 'videoEdit' } };
    const click: CanvasModelToolClick = { key: request.idempotencyKey, fingerprint: canvasModelToolRequestFingerprint(request), nodeId,
        nodeFingerprint: canvasModelToolNodeFingerprint(node), capabilityVersion: plan.capabilityVersion };
    const previous = Array.isArray(canvas.settings.canvasModelToolClicks) ? canvas.settings.canvasModelToolClicks : [];
    return { canvas: { ...canvas, nodes: [...canvas.nodes, node], settings: { ...canvas.settings, canvasModelToolClicks: [...previous, click] } }, click };
}
