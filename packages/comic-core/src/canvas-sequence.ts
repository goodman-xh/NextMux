import type { CanvasDocument, CanvasNode, CanvasValidationIssue } from './canvas.js';

/** Playback order only. These links never become model inputs. */
export interface CanvasSequenceLink { readonly id: string; readonly sourceNodeId: string; readonly targetNodeId: string }
export class CanvasSequenceError extends Error {
  constructor(readonly code: string, message: string, readonly nodeIds: readonly string[] = []) { super(message); this.name = 'CanvasSequenceError'; }
}
export function isCanvasSequenceNode(node: CanvasNode): boolean {
  return node.kind === 'video' || node.kind === 'videoGen' || node.kind === 'composition'
    || (node.kind === 'sceneComposer' || node.kind === 'world') && node.payload.versions.some(version => version.kind === 'video');
}
export function validateCanvasSequenceLinks(canvas: Pick<CanvasDocument, 'nodes'>, value: unknown): readonly CanvasValidationIssue[] {
  if (value === undefined) return [];
  const issues: CanvasValidationIssue[] = [];
  const add = (code: string, path: string, message: string): void => { issues.push({ code, path, message }); };
  if (!Array.isArray(value)) return [{ code: 'SEQUENCE_ARRAY', path: 'sequenceLinks', message: 'Sequence links must be an array' }];
  const nodes = new Map(canvas.nodes.map(node => [node.id, node])), ids = new Set<string>(), pairs = new Set<string>();
  const outgoing = new Map<string, string[]>(), degree = new Map<string, number>();
  for (const [index, link] of value.entries()) {
    const path = `sequenceLinks.${index}`;
    if (!link || typeof link !== 'object' || !['id', 'sourceNodeId', 'targetNodeId'].every(key => typeof link[key] === 'string' && link[key].trim())) {
      add('SEQUENCE_LINK', path, 'A sequence link needs an id and two node ids'); continue;
    }
    if (ids.has(link.id)) add('SEQUENCE_ID', path, 'Sequence link ids must be unique');
    ids.add(link.id);
    const pair = JSON.stringify([link.sourceNodeId, link.targetNodeId]);
    if (pairs.has(pair)) add('SEQUENCE_DUPLICATE', path, 'Sequence link already exists');
    pairs.add(pair);
    const source = nodes.get(link.sourceNodeId), target = nodes.get(link.targetNodeId);
    if (!source || !target) { add('SEQUENCE_NODE_MISSING', path, 'Sequence link references a missing node'); continue; }
    if (!isCanvasSequenceNode(source) || !isCanvasSequenceNode(target)) add('SEQUENCE_VIDEO_REQUIRED', path, 'Only video output nodes can enter a playback sequence');
    if (source.id === target.id) add('SEQUENCE_CYCLE', path, 'A sequence cannot loop to itself');
    outgoing.set(source.id, [...(outgoing.get(source.id) ?? []), target.id]);
    degree.set(source.id, degree.get(source.id) ?? 0); degree.set(target.id, (degree.get(target.id) ?? 0) + 1);
  }
  const ready = [...degree].filter(([, count]) => count === 0).map(([id]) => id); let visited = 0;
  for (let index = 0; index < ready.length; index++) {
    visited++;
    for (const next of outgoing.get(ready[index]) ?? []) { const count = degree.get(next)! - 1; degree.set(next, count); if (!count) ready.push(next); }
  }
  if (visited < degree.size) add('SEQUENCE_CYCLE', 'sequenceLinks', 'Playback sequences cannot contain cycles');
  return issues;
}
export interface CanvasSequenceAnalysis {
  readonly nodeIds: readonly string[]; readonly roots: readonly string[];
  readonly successors: Readonly<Record<string, readonly string[]>>;
  readonly predecessors: Readonly<Record<string, readonly string[]>>;
  readonly requiresChoice: boolean;
}
export function analyzeCanvasSequence(canvas: CanvasDocument): CanvasSequenceAnalysis {
  const issues = validateCanvasSequenceLinks(canvas, canvas.sequenceLinks);
  if (issues.length) throw new CanvasSequenceError(issues[0].code, issues[0].message);
  const nodeIds = canvas.nodes.filter(isCanvasSequenceNode).map(node => node.id);
  const successors: Record<string, string[]> = Object.fromEntries(nodeIds.map(id => [id, []]));
  const predecessors: Record<string, string[]> = Object.fromEntries(nodeIds.map(id => [id, []]));
  for (const link of canvas.sequenceLinks ?? []) { successors[link.sourceNodeId].push(link.targetNodeId); predecessors[link.targetNodeId].push(link.sourceNodeId); }
  const roots = nodeIds.filter(id => !predecessors[id].length);
  return { nodeIds, roots, successors, predecessors,
    requiresChoice: roots.length !== 1 || nodeIds.some(id => successors[id].length > 1 || predecessors[id].length > 1) };
}
/** Explicit paths may select branches or concatenate independent chains; no hidden ordering by coordinates. */
export function resolveCanvasSequence(canvas: CanvasDocument, paths?: readonly (readonly string[])[]): readonly string[] {
  const graph = analyzeCanvasSequence(canvas);
  if (!graph.nodeIds.length) throw new CanvasSequenceError('SEQUENCE_EMPTY', 'The canvas has no video nodes');
  let selected = paths;
  if (selected === undefined) {
    if (graph.requiresChoice) throw new CanvasSequenceError('SEQUENCE_CHOICE_REQUIRED', 'Choose a branch or the order of independent video chains', graph.roots);
    const path: string[] = []; let id: string | undefined = graph.roots[0];
    while (id) { path.push(id); id = graph.successors[id][0]; }
    selected = [path];
  }
  if (!Array.isArray(selected) || !selected.length || selected.length > 5000) throw new CanvasSequenceError('SEQUENCE_PATH', 'Choose at least one video path');
  const seen = new Set<string>(), result: string[] = [];
  for (const path of selected) {
    if (!Array.isArray(path) || !path.length) throw new CanvasSequenceError('SEQUENCE_PATH', 'A selected path must contain video nodes');
    for (const [index, id] of path.entries()) {
      if (!Object.hasOwn(graph.successors, id)) throw new CanvasSequenceError('SEQUENCE_NODE_MISSING', 'The selected video node does not belong to this canvas', [id]);
      if (seen.has(id)) throw new CanvasSequenceError('SEQUENCE_DUPLICATE_NODE', 'A video node cannot occur twice in one timeline import', [id]);
      if (index && !graph.successors[path[index - 1]].includes(id)) throw new CanvasSequenceError('SEQUENCE_PATH', 'Adjacent videos must have an explicit playback sequence link', [path[index - 1], id]);
      seen.add(id); result.push(id);
    }
  }
  if (result.length > 5000) throw new CanvasSequenceError('SEQUENCE_LIMIT', 'A timeline import supports at most 5000 video nodes');
  return result;
}
