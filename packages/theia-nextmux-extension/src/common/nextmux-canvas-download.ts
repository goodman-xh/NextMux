export type CanvasDownloadRule = 'index_name' | 'name_index' | 'name' | 'index' | 'type_index';
export interface CanvasDownloadNaming {
    readonly rule: CanvasDownloadRule;
    readonly start: number;
    readonly padding: number;
    readonly separator: '_' | '-' | ' ' | '';
    readonly prefix: string;
    readonly timestamp: boolean;
}
export interface CanvasDownloadItem {
    readonly nodeId: string;
    readonly versionId: string;
    readonly assetId: string;
    readonly kind: 'image' | 'video' | 'audio';
    readonly label: string;
    readonly extension: string;
    readonly name: string;
    readonly manual: boolean;
}
export interface ExportCanvasDownloadRequest {
    readonly workspaceRoot: string;
    readonly canvasId?: string;
    readonly requestId: string;
    readonly destinationUri: string;
    readonly items: readonly Pick<CanvasDownloadItem, 'nodeId' | 'versionId' | 'assetId' | 'name' | 'extension'>[];
}
export interface CanvasDownloadScope { readonly workspaceRoot: string; readonly canvasId?: string; readonly requestId: string; }
export interface CanvasDownloadResult { readonly destinationUri: string; readonly fileName: string; readonly files: readonly string[]; readonly bytes: number; }
export const DEFAULT_CANVAS_DOWNLOAD_NAMING: CanvasDownloadNaming = { rule: 'index_name', start: 1, padding: 3, separator: '_', prefix: '', timestamp: false };
export const CANVAS_DOWNLOAD_MAX_ITEMS = 1000;
const rules: readonly CanvasDownloadRule[] = ['index_name', 'name_index', 'name', 'index', 'type_index'];
const forbidden = /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
export function sanitizeCanvasDownloadName(value: string): string {
    const characters = Array.from(value.normalize('NFC').replace(forbidden, '_').replace(/^[ .]+|[ .]+$/gu, '')).slice(0, 140);
    while (new TextEncoder().encode(characters.join('')).length > 210) characters.pop();
    const name = characters.join('').replace(/[ .]+$/gu, '');
    return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name) ? `_${name}` : name;
}
export function canvasDownloadExtension(uri: string): string | undefined {
    // Registered local assets only; a URL query must never become part of a filename.
    const match = /^nextmux\.media\/(?:[^?#\\]+\/)*[^/?#\\]+\.([a-z0-9]{1,8})$/iu.exec(uri);
    return match?.[1].toLowerCase();
}
export function normalizeCanvasDownloadNaming(value: unknown): CanvasDownloadNaming {
    const input = value && typeof value === 'object' ? value as Partial<CanvasDownloadNaming> : {};
    return { rule: rules.includes(input.rule!) ? input.rule! : 'index_name',
        start: Number.isInteger(input.start) && input.start! >= 0 && input.start! <= 99999 ? input.start! : 1,
        padding: Number.isInteger(input.padding) && input.padding! >= 1 && input.padding! <= 6 ? input.padding! : 3,
        separator: ['_', '-', ' ', ''].includes(input.separator!) ? input.separator! : '_',
        prefix: typeof input.prefix === 'string' ? sanitizeCanvasDownloadName(input.prefix.slice(0, 24)) : '', timestamp: input.timestamp === true };
}
export function canvasDownloadTimestamp(date = new Date()): string {
    const n = (value: number): string => String(value).padStart(2, '0');
    return `${date.getFullYear()}${n(date.getMonth() + 1)}${n(date.getDate())}_${n(date.getHours())}${n(date.getMinutes())}${n(date.getSeconds())}`;
}
export function canvasDownloadAutoName(item: Pick<CanvasDownloadItem, 'label' | 'kind' | 'extension'>, index: number, options: CanvasDownloadNaming, stamp: string): string {
    const number = String(options.start + index).padStart(options.padding, '0');
    const label = sanitizeCanvasDownloadName(item.label.replace(new RegExp(`\\.${item.extension}$`, 'iu'), '')) || item.kind;
    const pieces = options.rule === 'index_name' ? [number, label] : options.rule === 'name_index' ? [label, number]
        : options.rule === 'name' ? [label] : options.rule === 'index' ? [number] : [item.kind, number];
    return sanitizeCanvasDownloadName([options.prefix, ...(options.timestamp ? [stamp] : []), ...pieces].filter(Boolean).join(options.separator));
}
export function renameCanvasDownloads(items: readonly CanvasDownloadItem[], options: CanvasDownloadNaming, stamp: string, all = false): CanvasDownloadItem[] {
    return items.map((item, index) => item.manual && !all ? item : { ...item, manual: false, name: canvasDownloadAutoName(item, index, options, stamp) });
}
export function canvasDownloadFileNames(items: readonly Pick<CanvasDownloadItem, 'name' | 'extension'>[]): { readonly names: readonly string[]; readonly conflicts: readonly number[]; readonly empty: readonly number[] } {
    const used = new Set<string>(), names: string[] = [], conflicts: number[] = [], empty: number[] = [];
    items.forEach((item, index) => {
        const extension = /^[a-z0-9]{1,8}$/iu.test(item.extension) ? item.extension.toLowerCase() : '';
        // The input edits the stem. If the original extension is typed once, do not append it twice.
        const stem = sanitizeCanvasDownloadName(extension ? item.name.replace(new RegExp(`\\.${extension}$`, 'iu'), '') : item.name);
        if (!stem || !extension) empty.push(index);
        let name = `${stem}.${extension}`, suffix = 1;
        while (used.has(name.toLocaleLowerCase('en-US'))) { name = `${stem}(${++suffix}).${extension}`; }
        if (suffix > 1) conflicts.push(index);
        used.add(name.toLocaleLowerCase('en-US')); names.push(name);
    });
    return { names, conflicts, empty };
}
