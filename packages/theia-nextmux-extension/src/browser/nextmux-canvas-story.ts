import type { CanvasSequenceLink } from '@nextmux/comic-core/canvas-sequence';
import type { CanvasDocument, CanvasNode } from '@nextmux/comic-core/canvas';

export interface CanvasStoryPlan {
    readonly characters: readonly { name: string; appearance: string }[];
    readonly shots: readonly { title: string; prompt: string; characters: readonly string[] }[];
}
export interface CanvasStoryCheckpoint {
    readonly id: string; readonly source: string; readonly chunks: readonly string[];
    readonly completed: number; readonly nodeIds: readonly string[]; readonly lastNodeId?: string;
    /** A polling interruption resumes the same local agent run; a parsed plan survives later local save failures. */
    readonly pendingRunId?:string; readonly pendingPlan?:CanvasStoryPlan;
}
/** Exact source coverage, bounded requests, no episode or guessed model-duration constraints. */
export function splitCanvasStory(source: string, maximum = 6000): readonly string[] {
    if (!Number.isInteger(maximum) || maximum < 256) throw new Error('The selected text model has insufficient context.');
    const chunks: string[] = [];
    for (let start = 0; start < source.length;) {
        let end = Math.min(source.length, start + maximum);
        if (end < source.length) {
            const paragraph = source.lastIndexOf('\n', end);
            if (paragraph > start + maximum / 2) end = paragraph + 1;
            if (/[\uD800-\uDBFF]/u.test(source[end - 1])) end--;
        }
        chunks.push(source.slice(start, end)); start = end;
    }
    return chunks;
}
export function parseCanvasStoryPlan(raw: string): CanvasStoryPlan {
    const value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    const field = (item: unknown, name: string, maximum: number): string => {
        if (typeof item !== 'string' || !item.trim() || item.length > maximum) throw new Error(`Invalid storyboard ${name}; no nodes were added.`);
        return item.trim();
    };
    if (!value || !Array.isArray(value.shots) || !value.shots.length || value.shots.length > 40 || !Array.isArray(value.characters) || value.characters.length > 24) throw new Error('Invalid storyboard structure; no nodes were added.');
    const characters = value.characters.map((item: {name?:unknown;appearance?:unknown}) => ({ name: field(item?.name, 'character name', 120), appearance: field(item?.appearance, 'appearance', 1600) }));
    const shots = value.shots.map((item: {title?:unknown;prompt?:unknown;characters?:unknown}) => {
        if (!Array.isArray(item?.characters) || item.characters.length > 24) throw new Error('Invalid storyboard character references.');
        return { title: field(item.title, 'title', 120), prompt: field(item.prompt, 'prompt', 2400), characters: item.characters.map(name => field(name, 'character reference', 120)) };
    });
    return { characters, shots };
}
/** Atomic chunk append; deterministic node IDs make a retry safe after a lost save response. */
export function appendCanvasStoryChunk(canvas: CanvasDocument, checkpoint: CanvasStoryCheckpoint, plan: CanvasStoryPlan,
    options: { modelId: string; routeKey?: string; aspectRatio?: string; characterNodes: Readonly<Record<string, CanvasNode>>; now: string }): CanvasDocument {
    const prefix = `${checkpoint.id}-${checkpoint.completed}`;
    const ids = plan.shots.map((_, index) => `${prefix}-shot-${index}`);
    if (ids.some(id => canvas.nodes.some(node => node.id === id))) throw new Error('This storyboard chunk is already present. Reload the saved checkpoint before retrying.');
    const generatedCharacters = [...new Map(Object.values(options.characterNodes).map(node=>[node.id,node])).values()].filter(node => !canvas.nodes.some(existing => existing.id === node.id));
    const right = canvas.nodes.reduce((x, node) => Math.max(x, node.position.x + node.size.width), -440);
    const y = checkpoint.lastNodeId ? canvas.nodes.find(node => node.id === checkpoint.lastNodeId)?.position.y ?? 120 : 120;
    const nodes: CanvasNode[] = plan.shots.map((shot, index) => ({ id: ids[index], kind: 'videoGen', title: shot.title, position: { x: right + 100 + index * 460, y }, size: { width: 360, height: 260 }, createdAt: options.now,
        payload: { prompt: shot.prompt, mode: 'textToVideo', modelId: options.modelId, parameters: options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}, versions: [] } }));
    const chain = [...(checkpoint.lastNodeId ? [checkpoint.lastNodeId] : []), ...ids];
    const sequenceLinks: CanvasSequenceLink[] = chain.slice(1).map((id, i) => ({ id: `${prefix}-sequence-${i}`, sourceNodeId: chain[i], targetNodeId: id }));
    const edges = plan.shots.flatMap((shot, index) => [...new Map(shot.characters.map(name => {
        const character = options.characterNodes[name];
        if (!character) throw new Error(`Unknown storyboard character: ${name}`);
        return [character.id,character] as const;
    })).values()].map((character,order)=>({ id: `${prefix}-character-${index}-${character.id}`, sourceNodeId: character.id, sourcePort: 'output', targetNodeId: ids[index], targetPort: 'character', role: 'character' as const, order, binding: 'followCurrent' as const })));
    const characterNodes=new Map(Object.values(options.characterNodes).map(node=>[node.id,node]));
    return { ...canvas, nodes: [...canvas.nodes.map(node=>characterNodes.get(node.id)??node), ...generatedCharacters, ...nodes], edges: [...canvas.edges, ...edges], sequenceLinks: [...(canvas.sequenceLinks ?? []), ...sequenceLinks],
        settings: { ...canvas.settings, nodeRoutes: { ...(canvas.settings.nodeRoutes as Record<string,string> ?? {}), ...(options.routeKey ? Object.fromEntries(ids.map(id => [id, options.routeKey])) : {}) } }, updatedAt: options.now };
}
