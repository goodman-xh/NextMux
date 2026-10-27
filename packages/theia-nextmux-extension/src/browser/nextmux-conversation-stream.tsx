import * as React from 'react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import type { StreamDetails, StreamItem, StreamProjection, StreamRowItem, StreamSteeringItem } from './nextmux-conversation-stream-model';
import { conversationStreamText } from './nextmux-conversation-stream-locale';
import { compactDirectoryPrefix } from './nextmux-conversation-media';

/**
 * Conversation output stream.
 *
 * Ported from OpenCode's session UI (MIT, Copyright (c) 2025 opencode):
 * - `BasicTool` (packages/session-ui/src/components/basic-tool.tsx): one-line
 *   trigger with title/subtitle/diff counts, chevron, collapsed body that is
 *   mounted only while open and animates its height (`animate(height: auto)`).
 * - `TextShimmer` (packages/ui/src/components/text-shimmer.css): the running
 *   title sweep.
 * - markdown-stream.ts: settled Markdown blocks are cached and only the live
 *   tail block re-renders while text streams.
 * Radix UI's Presence (MIT) is the model for `FadePresence`: an element stays
 * mounted until its exit animation ends.
 * Codex desktop is the visual benchmark: muted single-line status rows and
 * body text at full contrast that is never collapsed.
 */

export interface StreamOpenTarget {
    readonly kind: 'file' | 'browser';
    readonly summary: NonNullable<StreamRowItem['open']>['summary'];
}

export function StreamFilePath(props: { path: string; resolve?: (path: string) => string; onOpen?: () => void }): React.ReactElement {
    const fullPath = props.resolve?.(props.path) || props.path;
    const slash = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'));
    return <span className='nmx-file-path-pill' role='link' tabIndex={0} title={fullPath} data-path={fullPath}
        data-nmx-path={fullPath} data-nmx-file-target={props.path}
        onClick={event => { event.stopPropagation(); props.onOpen?.(); }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); props.onOpen?.(); } }}>
        {slash >= 0 && <span className='nmx-file-path-dir'><span>{compactDirectoryPrefix(fullPath.slice(0, slash + 1))}</span></span>}
        <span className='nmx-file-path-name'><span>{fullPath.slice(slash + 1)}</span></span>
    </span>;
}

export interface ConversationStreamProps {
    readonly locale: NextMuxDesktopLocale;
    readonly projection: StreamProjection;
    readonly label: string;
    readonly planLabel: string;
    /** Changes when rendered Markdown must be refreshed (e.g. a thread search query). */
    readonly renderVersion?: string;
    /** Current conversation Find text; only matching stored details are temporarily expanded. */
    readonly searchQuery?: string;
    /** Resolved app theme; expanded terminals are themed by it and must re-render on a switch. */
    readonly theme?: string;
    readonly restoringCheckpointId?: string;
    readonly isRestored?: (checkpointId: string) => boolean;
    readonly isCheckpointRestored?: (checkpointId: string) => boolean;
    readonly renderMarkdown: (text: string, key: string) => React.ReactNode;
    readonly renderTerminal: (command: string, output: string, running: boolean) => React.ReactNode;
    readonly renderSteering: (item: StreamSteeringItem) => React.ReactNode;
    readonly onOpen: (target: StreamOpenTarget) => void;
    readonly onOpenFilePath?: (path: string, directory?: boolean) => void;
    readonly resolveFilePath?: (path: string) => string;
    readonly onRestore: (checkpointId: string) => void;
    readonly onUndoRestore?: (checkpointId: string) => void;
    readonly onClickCapture?: React.MouseEventHandler<HTMLElement>;
    readonly idPrefix: string;
}

export const ConversationStream = React.memo(function ConversationStream(props: ConversationStreamProps): React.ReactElement {
    const { projection, locale } = props;
    const [visibleRowLimit, setVisibleRowLimit] = React.useState(240);
    const searching = Boolean(props.searchQuery?.trim());
    const { visibleItems, hiddenRowCount } = React.useMemo(() => {
        if (projection.items.length <= visibleRowLimit || searching) return { visibleItems: projection.items, hiddenRowCount: 0 };
        const visible: StreamItem[] = [];
        let rowCount = 0;
        let hiddenRowCount = 0;
        // Keep all prose and steering messages in journal order; only older status rows are deferred.
        for (let index = projection.items.length - 1; index >= 0; index--) {
            const item = projection.items[index];
            if (item.kind !== 'row' || rowCount++ < visibleRowLimit) visible.push(item);
            else hiddenRowCount++;
        }
        return { visibleItems: hiddenRowCount ? visible.reverse() : projection.items, hiddenRowCount };
    }, [projection.items, visibleRowLimit, searching]);
    return <section data-nmx-literal className={`nmx-agent-activity nmx-stream${projection.streamTail.state === 'running' ? ' is-live' : ''}`} aria-label={props.label} onClickCapture={props.onClickCapture}>
        {hiddenRowCount > 0 && <button type='button' className='nmx-stream-trigger nmx-stream-earlier-activity'
            onClick={() => setVisibleRowLimit(limit => limit + 240)}>{`+ ${hiddenRowCount}`}</button>}
        {projection.plan.length > 1 && <section className='nmx-agent-plan-history' aria-label={props.planLabel}>
            <header><i className='codicon codicon-list-ordered' aria-hidden='true'></i><strong>{props.planLabel}</strong><span>{projection.plan.length}</span></header>
            <ol>{projection.plan.map(step => <li className={`is-${step.status}`} data-plan-step-id={step.id} key={step.id}>
                <i className={`codicon codicon-${step.status === 'completed' ? 'pass' : 'circle-large-outline'}`} aria-hidden='true'></i>
                <span data-nmx-literal>{props.searchQuery?.trim()
                    ? <StreamSearchText text={step.title} query={props.searchQuery} /> : step.title}</span>
            </li>)}</ol>
        </section>}
        {visibleItems.map(item => item.kind === 'text'
            ? <StreamText key={item.key} text={item.text} streaming={item.streaming} renderMarkdown={props.renderMarkdown}
                markdownKey={`${props.idPrefix}:${item.key}`} renderVersion={props.renderVersion} />
            : item.kind === 'steering' ? <React.Fragment key={item.key}>{props.renderSteering(item)}</React.Fragment>
                : <StreamRow key={item.key} item={item} locale={locale} idPrefix={props.idPrefix}
                    restoring={Boolean(item.restoreCheckpointId && item.restoreCheckpointId === props.restoringCheckpointId)}
                    restored={Boolean(item.restoreCheckpointId && (props.isCheckpointRestored || props.isRestored)?.(item.restoreCheckpointId))}
                    restoreBusy={Boolean(props.restoringCheckpointId)}
                    renderMarkdown={props.renderMarkdown} renderTerminal={props.renderTerminal} renderVersion={props.renderVersion} searchQuery={props.searchQuery} theme={props.theme}
                    onOpen={props.onOpen} onOpenFilePath={props.onOpenFilePath} resolveFilePath={props.resolveFilePath} onRestore={props.onRestore} onUndoRestore={props.onUndoRestore} />)}
        {projection.idleCaret && <span className='nmx-stream-idle-caret' aria-hidden='true'></span>}
    </section>;
});

// ---------------------------------------------------------------------------
// Body text

function matchFenceMarker(line: string): { readonly marker: string; readonly hasInfo: boolean } | undefined {
    const match = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!match) return undefined;
    const [, marker, rest] = match;
    // CommonMark §4.5: info strings for backtick code blocks cannot contain backticks.
    if (marker[0] === '`' && rest.includes('`')) return undefined;
    return { marker, hasInfo: rest.trim().length > 0 };
}

function matchMathBlockOpen(trimmed: string): '$$' | '\\[' | undefined {
    if (trimmed === '$$' || (trimmed.startsWith('$$') && !trimmed.slice(2).trimEnd().endsWith('$$'))) return '$$';
    if (trimmed === '\\[' || (trimmed.startsWith('\\[') && !trimmed.slice(2).trimEnd().endsWith('\\]'))) return '\\[';
    return undefined;
}

function isMathBlockClose(trimmed: string, open: '$$' | '\\['): boolean {
    const close = open === '$$' ? '$$' : '\\]';
    return trimmed === close || trimmed.endsWith(close);
}

function hasReferenceLinkOutsideFences(text: string): boolean {
    if (!/^[ \t]{0,3}\[[^\]]+\]:[ \t]*\S/m.test(text)) return false;
    let fence: string | undefined;
    let innerFenceDepth = 0;
    for (const line of text.split('\n')) {
        const fenceMatch = matchFenceMarker(line);
        if (fence) {
            if (fenceMatch && fenceMatch.marker[0] === fence[0] && fenceMatch.marker.length >= fence.length) {
                if (!fenceMatch.hasInfo) {
                    if (innerFenceDepth > 0) innerFenceDepth -= 1;
                    else fence = undefined;
                } else {
                    innerFenceDepth += 1;
                }
            }
            continue;
        }
        if (fenceMatch) {
            fence = fenceMatch.marker;
            innerFenceDepth = 0;
            continue;
        }
        if (/^[ \t]{0,3}\[[^\]]+\]:[ \t]*\S/.test(line)) return true;
    }
    return false;
}

/**
 * Split Markdown into top-level blocks at blank lines outside fenced code and display math.
 * Lists, indented continuations and reference definitions stay together, so a
 * settled block renders exactly as it would inside the whole document.
 * (Behaviour of OpenCode's markdown-stream.ts `stream()`.)
 */
export function markdownStreamBlocks(text: string): readonly string[] {
    if (hasReferenceLinkOutsideFences(text)) return [text];
    const blocks: string[] = [];
    let current: string[] = [];
    let fence: string | undefined;
    let innerFenceDepth = 0;
    let mathFence: '$$' | '\\[' | undefined;
    let blank = false;
    let inList = false;
    const listItem = /^[ \t]{0,3}(?:[*+-]|\d{1,9}[.)])[ \t]/;
    const flush = (): void => {
        if (current.length) blocks.push(current.join('\n'));
        current = [];
        inList = false;
        mathFence = undefined;
    };
    for (const line of text.split('\n')) {
        const fenceMatch = matchFenceMarker(line);
        const trimmed = line.trim();
        if (fence) {
            current.push(line);
            if (fenceMatch && fenceMatch.marker[0] === fence[0] && fenceMatch.marker.length >= fence.length) {
                if (!fenceMatch.hasInfo) {
                    if (innerFenceDepth > 0) innerFenceDepth -= 1;
                    else fence = undefined;
                } else {
                    innerFenceDepth += 1;
                }
            }
            continue;
        }
        if (mathFence) {
            current.push(line);
            if (isMathBlockClose(trimmed, mathFence)) mathFence = undefined;
            continue;
        }
        if (!trimmed) {
            blank = true;
            if (current.length) current.push(line);
            continue;
        }
        const continuation = /^[ \t]/.test(line) || (inList && listItem.test(line));
        if (blank && current.length && !continuation) {
            while (current.length && !current[current.length - 1].trim()) current.pop();
            flush();
        }
        blank = false;
        if (fenceMatch) {
            fence = fenceMatch.marker;
            innerFenceDepth = 0;
        } else {
            const mathOpen = matchMathBlockOpen(trimmed);
            if (mathOpen) mathFence = mathOpen;
        }
        if (listItem.test(line)) inList = true;
        current.push(line);
    }
    flush();
    return blocks.length ? blocks : [text];
}

interface StreamTextProps {
    readonly text: string;
    readonly streaming: boolean;
    readonly markdownKey: string;
    readonly renderVersion?: string;
    readonly renderMarkdown: (text: string, key: string) => React.ReactNode;
}

const StreamBlock = React.memo(function StreamBlock(props: { text: string; markdownKey: string; renderVersion?: string;
    renderMarkdown: (text: string, key: string) => React.ReactNode }): React.ReactElement {
    return <>{props.renderMarkdown(props.text, props.markdownKey)}</>;
}, (previous, next) => previous.text === next.text && previous.renderVersion === next.renderVersion && previous.markdownKey === next.markdownKey);

/**
 * Stabilize unsettled Markdown syntax at the very end of the active streaming tail block:
 * 1. Hide a trailing un-newlined opening fence line (` ```ts `, `$$`, `\[`) so raw fence syntax does not flash before its newline arrives.
 * 2. Close an unclosed inline code backtick span on the final line once non-empty text follows it (ignoring escaped `\` `).
 * 3. Close an unclosed `**` strong emphasis span on the final line once non-empty text follows it.
 */
export function stabilizeStreamingMarkdownTail(block: string): string {
    if (!block) return block;
    const lines = block.split('\n');
    let fence: string | undefined;
    let innerFenceDepth = 0;
    let mathFence: '$$' | '\\[' | undefined;
    for (let index = 0; index < lines.length - 1; index += 1) {
        const line = lines[index];
        const trimmed = line.trim();
        const fenceMatch = matchFenceMarker(line);
        if (fence) {
            if (fenceMatch && fenceMatch.marker[0] === fence[0] && fenceMatch.marker.length >= fence.length) {
                if (!fenceMatch.hasInfo) {
                    if (innerFenceDepth > 0) innerFenceDepth -= 1;
                    else fence = undefined;
                } else {
                    innerFenceDepth += 1;
                }
            }
        } else if (mathFence) {
            if (isMathBlockClose(trimmed, mathFence)) mathFence = undefined;
        } else if (fenceMatch) {
            fence = fenceMatch.marker;
            innerFenceDepth = 0;
        } else {
            const mathOpen = matchMathBlockOpen(trimmed);
            if (mathOpen) mathFence = mathOpen;
        }
    }
    if (fence || mathFence) return block;
    const lastLine = lines[lines.length - 1];
    const lastTrimmed = lastLine.trim();
    if (!block.endsWith('\n') && (matchFenceMarker(lastLine) || lastTrimmed === '$$' || lastTrimmed === '\\[')) {
        return lines.slice(0, -1).join('\n');
    }
    const backtickRuns: { readonly index: number; readonly token: string }[] = [];
    for (const match of lastLine.matchAll(/`+/g)) {
        const idx = match.index ?? 0;
        let backslashes = 0;
        for (let pos = idx - 1; pos >= 0 && lastLine[pos] === '\\'; pos--) backslashes++;
        if (backslashes % 2 === 1) continue;
        backtickRuns.push({ index: idx, token: match[0] });
    }
    let openToken: { readonly index: number; readonly token: string } | undefined;
    for (const run of backtickRuns) {
        if (!openToken) {
            if (run.token.length <= 2) openToken = run;
        } else if (run.token.length === openToken.token.length) {
            openToken = undefined;
        }
    }
    if (openToken && lastLine.slice(openToken.index + openToken.token.length).trim().length > 0) {
        return `${block}${openToken.token}`;
    }
    if (!openToken) {
        let openBoldIndex = -1;
        for (const match of lastLine.matchAll(/\*\*+/g)) {
            const idx = match.index ?? 0;
            if (match[0].length !== 2) continue;
            let backslashes = 0;
            for (let pos = idx - 1; pos >= 0 && lastLine[pos] === '\\'; pos--) backslashes++;
            if (backslashes % 2 === 1) continue;
            const inCode = backtickRuns.some((run, rIdx) => rIdx % 2 === 0 && backtickRuns[rIdx + 1] && idx > run.index && idx < backtickRuns[rIdx + 1].index);
            if (inCode) continue;
            if (openBoldIndex < 0) {
                const nextChar = lastLine[idx + 2] || '';
                if (nextChar && !/\s/.test(nextChar)) openBoldIndex = idx;
            } else {
                openBoldIndex = -1;
            }
        }
        if (openBoldIndex >= 0 && lastLine.slice(openBoldIndex + 2).trim().length > 0) {
            return `${block}**`;
        }
    }
    return block;
}

/**
 * Assistant prose: always expanded, normal line height, no collapse toggle.
 * The block split is kept after streaming ends, so completion never replaces
 * the rendered reply (no flash, text selection and copied states survive);
 * block margins collapse through the wrappers exactly as in one document.
 */
export const StreamText = React.memo(function StreamText(props: StreamTextProps): React.ReactElement {
    const blocks = markdownStreamBlocks(props.text);
    return <div className={`nmx-agent-narration nmx-stream-text${props.streaming ? ' is-streaming' : ''}`} data-nmx-literal>
        {blocks.map((block, index) => <StreamBlock key={index}
            text={props.streaming && index === blocks.length - 1 ? stabilizeStreamingMarkdownTail(block) : block}
            markdownKey={`${props.markdownKey}:${index}`}
            renderVersion={props.renderVersion} renderMarkdown={props.renderMarkdown} />)}
    </div>;
}, (previous, next) => previous.text === next.text && previous.streaming === next.streaming
    && previous.renderVersion === next.renderVersion && previous.markdownKey === next.markdownKey);

// ---------------------------------------------------------------------------
// Status rows

interface StreamRowProps {
    readonly resolveFilePath?: (path: string) => string;
    readonly item: StreamRowItem;
    readonly locale: NextMuxDesktopLocale;
    readonly idPrefix: string;
    readonly restoring: boolean;
    readonly restored?: boolean;
    readonly restoreBusy: boolean;
    readonly renderVersion?: string;
    readonly theme?: string;
    readonly searchQuery?: string;
    readonly renderMarkdown: (text: string, key: string) => React.ReactNode;
    readonly renderTerminal: (command: string, output: string, running: boolean) => React.ReactNode;
    readonly onOpen: (target: StreamOpenTarget) => void;
    readonly onOpenFilePath?: (path: string, directory?: boolean) => void;
    readonly onRestore: (checkpointId: string) => void;
    readonly onUndoRestore?: (checkpointId: string) => void;
}

function sameDetails(a: StreamDetails | undefined, b: StreamDetails | undefined): boolean {
    if (a === b) return true;
    if (!a || !b || a.kind !== b.kind) return false;
    const left = a as unknown as Record<string, unknown>, right = b as unknown as Record<string, unknown>;
    return Object.keys(left).every(key => left[key] === right[key]) && Object.keys(right).length === Object.keys(left).length;
}

function sameRow(a: StreamRowItem, b: StreamRowItem): boolean {
    const left = a as unknown as Record<string, unknown>, right = b as unknown as Record<string, unknown>;
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        if (key === 'details') continue;
        if (key === 'open') {
            if (a.open?.kind !== b.open?.kind || a.open?.label !== b.open?.label) return false;
            continue;
        }
        if (left[key] !== right[key]) return false;
    }
    return sameDetails(a.details, b.details);
}

/** Keep this projection aligned with turnSearchableFields; do not read or request resources. */
function searchableStreamDetails(details: StreamDetails | undefined): string {
    if (!details) return '';
    if (details.kind === 'text' || details.kind === 'markdown') return details.text;
    if (details.kind === 'terminal') return [details.command, details.output].filter(Boolean).join('\n');
    if (details.kind === 'link') return [details.title, details.url, details.text].filter(Boolean).join(' ');
    return '';
}

function streamCommandOutput(output: string): string {
    return output.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

interface StreamSearchRange { readonly start: number; readonly end: number }

function streamSearchRanges(text: string, query: string): readonly StreamSearchRange[] {
    const needle = query.trim().toLocaleLowerCase();
    const normalized = text.toLocaleLowerCase();
    const ranges: StreamSearchRange[] = [];
    let found = needle ? normalized.indexOf(needle) : -1;
    while (found >= 0) {
        ranges.push({ start: found, end: found + needle.length });
        found = normalized.indexOf(needle, found + needle.length);
    }
    return ranges;
}

function StreamSearchText(props: { text: string; query: string; ranges?: readonly StreamSearchRange[] }): React.ReactElement {
    const nodes: React.ReactNode[] = [];
    let cursor = 0;
    for (const range of props.ranges ?? streamSearchRanges(props.text, props.query)) {
        const start = Math.max(0, range.start), end = Math.min(props.text.length, range.end);
        if (start >= end) continue;
        if (start > cursor) nodes.push(props.text.slice(cursor, start));
        nodes.push(<mark className='nmx-search-hit' data-thread-search-offset={start} key={start}>{props.text.slice(start, end)}</mark>);
        cursor = end;
    }
    if (cursor < props.text.length) nodes.push(props.text.slice(cursor));
    return <span data-thread-search-field='activity'>{nodes}</span>;
}

export const StreamRow = React.memo(function StreamRow(props: StreamRowProps): React.ReactElement {
    const { item, locale } = props;
    const [expanded, setExpanded] = React.useState(false);
    const expandable = Boolean(item.details);
    const query = props.searchQuery?.trim() || '';
    const searchExpanded = Boolean(query && searchableStreamDetails(item.details).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    const detailsOpen = expanded || searchExpanded;
    const lastSearchQuery = React.useRef('');
    if (searchExpanded) lastSearchQuery.current = query;
    const detailsId = `${props.idPrefix}:${item.key}:details`.replace(/[^A-Za-z0-9_:-]/g, '_');
    const open = item.open;
    const fileResourcePath = open?.kind === 'file' && open.summary.resource?.kind === 'file' ? open.summary.resource.path : undefined;
    const fileDataProps = fileResourcePath
        ? { 'data-nmx-file-target': fileResourcePath, 'data-nmx-path': fileResourcePath, 'data-nmx-label': item.target || fileResourcePath }
        : undefined;
    const openFileTarget = open?.kind === 'file' ? (event: React.MouseEvent): void => {
        event.stopPropagation();
        props.onOpen({ kind: open.kind, summary: open.summary });
    } : undefined;
    const activate = (): void => {
        // Search expansion is derived, so leaving Find restores the user's previous choice.
        if (expandable) { if (!searchExpanded) setExpanded(value => !value); }
        else if (open) props.onOpen({ kind: open.kind, summary: open.summary });
    };
    const interactive = expandable || Boolean(open);
    // Search uses this same joined row in turnSearchableFields. Project its ranges back into
    // each styled segment, so a phrase spanning title/target/meta still highlights in place.
    const fields = ['title', 'target', 'after', 'meta', 'chip'] as const;
    const rowRanges = query ? streamSearchRanges(fields.map(field => item[field]).filter(Boolean).join(' '), query) : [];
    const fieldOffsets = new Map<typeof fields[number], number>();
    let offset = 0;
    for (const field of fields) {
        const value = item[field];
        if (!value) continue;
        fieldOffsets.set(field, offset);
        offset += value.length + 1;
    }
    const labelText = (field: typeof fields[number]): React.ReactNode => {
        const value = item[field];
        if (field === 'target' && fileResourcePath) return <StreamFilePath path={fileResourcePath} resolve={props.resolveFilePath}
            onOpen={() => props.onOpenFilePath ? props.onOpenFilePath(fileResourcePath) : open && props.onOpen({ kind: open.kind, summary: open.summary })} />;
        if (!value || !query) return value;
        const start = fieldOffsets.get(field) || 0;
        return <StreamSearchText text={value} query={query}
            ranges={rowRanges.map(range => ({ start: range.start - start, end: range.end - start }))} />;
    };
    // Whitespace text nodes keep the accessible name readable; flex gap owns the visual spacing.
    const label = <>
        {item.phrase
            ? <span className={`nmx-stream-title nmx-stream-phrase${item.shimmer ? ' nmx-stream-shimmer' : ''}`}>{labelText('title')}<span className='nmx-stream-target' data-nmx-literal onClick={openFileTarget}>{labelText('target')}</span>{labelText('after')}</span>
            : <>
                {query ? <span className={`nmx-stream-title${item.shimmer ? ' nmx-stream-shimmer' : ''}`}>{labelText('title')}</span>
                    : <SwapText className={`nmx-stream-title${item.shimmer ? ' nmx-stream-shimmer' : ''}`} value={item.title} />}
                {item.target && <>{' '}<span className={`nmx-stream-target is-${item.targetStyle || 'plain'}`} data-nmx-literal onClick={openFileTarget}>{labelText('target')}</span></>}
            </>}
        {item.meta && <>{' '}<span className='nmx-stream-meta' data-nmx-literal>{labelText('meta')}</span></>}
        {(item.additions !== undefined || item.deletions !== undefined) && <span className='nmx-stream-diffstat' aria-label={`+${item.additions ?? 0} −${item.deletions ?? 0}`}>
            {item.additions !== undefined && <b>+{item.additions}</b>}{item.deletions !== undefined && <em>−{item.deletions}</em>}
        </span>}
        {item.chip && <>{' '}<span className='nmx-stream-chip'>{labelText('chip')}</span></>}
    </>;
    const restored = Boolean(props.restored);
    const restoreLabel = conversationStreamText(locale, props.restoring ? 'restoring' : restored ? 'restored' : 'restore');
    return <div className={`nmx-stream-row is-${item.tone}${detailsOpen ? ' is-expanded' : ''}${interactive ? ' is-interactive' : ''}${restored ? ' is-restored' : ''}`}
        data-activity-kind={item.activity} data-activity-tool={item.tool} data-activity-source={item.source}>
        <div className='nmx-stream-line'>
            {interactive
                ? <button type='button' className='nmx-stream-trigger' title={item.tooltip} onClick={activate} {...fileDataProps}
                    aria-expanded={expandable ? detailsOpen : undefined} aria-controls={expandable && detailsOpen ? detailsId : undefined}>
                    <i className={`codicon codicon-${item.icon} nmx-stream-icon`} aria-hidden='true'></i>
                    <span className='nmx-stream-label'>{label}</span>
                    {expandable && <i className='codicon codicon-chevron-right nmx-stream-chevron' aria-hidden='true'></i>}
                </button>
                : <div className='nmx-stream-trigger' title={item.tooltip} {...fileDataProps}>
                    <i className={`codicon codicon-${item.icon} nmx-stream-icon`} aria-hidden='true'></i>
                    <span className='nmx-stream-label'>{label}</span>
                </div>}
            {open && expandable && <button type='button' className='nmx-stream-action' aria-label={open.label} title={open.label} {...fileDataProps}
                onClick={() => props.onOpen({ kind: open.kind, summary: open.summary })}>
                <i className={`codicon codicon-${open.kind === 'file' ? 'go-to-file' : 'link-external'}`} aria-hidden='true'></i>
            </button>}
            {item.restoreCheckpointId && <button type='button'
                className={`nmx-stream-action nmx-file-activity-restore${props.restoring ? ' is-busy' : ''}${restored ? ' is-restored' : ''}`}
                disabled={props.restoring || props.restoreBusy}
                aria-pressed={restored ? true : undefined}
                aria-label={restoreLabel} title={restoreLabel}
                onClick={() => (restored && props.onUndoRestore ? props.onUndoRestore : props.onRestore)(item.restoreCheckpointId!)}>
                <i className={`codicon codicon-${props.restoring ? 'loading codicon-modifier-spin' : restored ? 'history' : 'discard'}`} aria-hidden='true'></i>
                {restored && <span className='nmx-stream-restore-label'>{restoreLabel}</span>}
            </button>}
        </div>
        {expandable && <StreamCollapse open={detailsOpen} id={detailsId} immediate={item.details?.kind === 'terminal'}>
            {() => <StreamDetailsView details={item.details!} markdownKey={`${props.idPrefix}:${item.key}:details`}
                streaming={item.tone === 'running'}
                renderMarkdown={props.renderMarkdown} renderTerminal={props.renderTerminal}
                onOpenFilePath={props.onOpenFilePath} resolveFilePath={props.resolveFilePath}
                // Keep the search-only body during its exit animation. In particular, closing Find must not
                // briefly mount a terminal renderer that the user had never expanded.
                searchQuery={searchExpanded ? query : !detailsOpen ? lastSearchQuery.current || undefined : undefined} />}
        </StreamCollapse>}
    </div>;
}, (previous, next) => sameRow(previous.item, next.item) && previous.locale === next.locale && previous.restoring === next.restoring
    && previous.restored === next.restored && previous.restoreBusy === next.restoreBusy && previous.renderVersion === next.renderVersion && previous.theme === next.theme
    && previous.idPrefix === next.idPrefix && previous.searchQuery === next.searchQuery);

export interface ListedStreamEntry {
    readonly kind: 'file' | 'directory';
    readonly path: string;
    readonly name: string;
    readonly parent?: string;
}

export function parseListedStreamEntries(text: string): readonly ListedStreamEntry[] | undefined {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!lines.length) return undefined;
    const entries: ListedStreamEntry[] = [];
    for (const line of lines) {
        const match = /^(file|directory)\s*·\s*(.+)$/i.exec(line);
        if (!match) return undefined;
        const kind = match[1].toLowerCase() === 'directory' ? 'directory' : 'file';
        const rawPath = match[2].trim();
        if (!rawPath) return undefined;
        const normalized = rawPath.replace(/\\/g, '/').replace(/\/+$/, '');
        const slash = normalized.lastIndexOf('/');
        const name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
        const parent = slash >= 0 ? normalized.slice(0, slash) : undefined;
        entries.push({ kind, path: rawPath, name: name || rawPath, ...(parent ? { parent } : {}) });
    }
    return entries;
}

function listedStreamEntryIcon(entry: ListedStreamEntry): string {
    if (entry.kind === 'directory') return 'folder';
    const lower = entry.name.toLowerCase();
    if (/\.(?:png|jpe?g|gif|webp|svg|bmp|ico|mp4|webm|mov|mp3|wav|ogg|m4a)$/.test(lower)) return 'file-media';
    if (/\.(?:ts|tsx|js|jsx|mjs|cjs|json|py|rs|go|java|c|cpp|h|css|scss|less|html|xml|yml|yaml|toml|sh|ps1|sql)$/.test(lower)) return 'file-code';
    if (/\.(?:pdf)$/.test(lower)) return 'file-pdf';
    if (/\.(?:zip|tar|gz|tgz|7z|rar)$/.test(lower)) return 'file-zip';
    return 'file';
}

function StreamDetailsView(props: { details: StreamDetails; markdownKey: string;
    streaming?: boolean;
    resolveFilePath?: (path: string) => string;
    searchQuery?: string;
    onOpenFilePath?: (path: string, directory?: boolean) => void;
    renderMarkdown: (text: string, key: string) => React.ReactNode;
    renderTerminal: (command: string, output: string, running: boolean) => React.ReactNode }): React.ReactElement {
    const { details } = props;
    if (props.searchQuery) return <pre className='nmx-stream-details is-text is-searching' data-nmx-literal>
        <StreamSearchText text={details.kind === 'terminal' ? streamCommandOutput(details.output) : searchableStreamDetails(details)} query={props.searchQuery} />
    </pre>;
    // Native text paints in the same commit as the disclosure; mounting an
    // asynchronous xterm here delayed the first output and repeated long commands.
    if (details.kind === 'terminal') return <pre className='nmx-stream-details is-text is-terminal' data-nmx-literal>{streamCommandOutput(details.output)}</pre>;
    if (details.kind === 'markdown') {
        const text = props.streaming ? stabilizeStreamingMarkdownTail(details.text) : details.text;
        return <div className='nmx-stream-details is-markdown nmx-agent-thinking-content'>{props.renderMarkdown(text, props.markdownKey)}</div>;
    }
    if (details.kind === 'diff') return <pre className='nmx-stream-details is-diff' data-nmx-literal>{diffLines(details.patch).map((line, index) =>
        <span key={index} className={line.kind ? `is-${line.kind}` : undefined}>{line.text}{'\n'}</span>)}</pre>;
    if (details.kind === 'link') return <div className='nmx-stream-details is-link' data-nmx-literal>
        {details.title && <strong>{details.title}</strong>}<span>{details.url}</span>{details.text && <p>{details.text}</p>}
    </div>;
    const listedEntries = parseListedStreamEntries(details.text);
    if (listedEntries) {
        return <div className='nmx-stream-details is-text is-file-list' role='list' data-nmx-literal>
            {listedEntries.map((entry, index) => <button key={`${entry.kind}:${entry.path}:${index}`} type='button' role='listitem'
                className={`nmx-stream-file-entry is-${entry.kind}${props.onOpenFilePath ? ' is-openable' : ''}`}
                data-nmx-file-target={entry.path} data-nmx-path={entry.path} data-nmx-label={entry.path}
                data-nmx-directory={entry.kind === 'directory' ? 'true' : undefined}
                title={entry.path}
                onClick={() => props.onOpenFilePath?.(entry.path, entry.kind === 'directory')}>
                <i className={`codicon codicon-${listedStreamEntryIcon(entry)} nmx-stream-file-entry-icon`} aria-hidden='true' />
                <span className='nmx-stream-file-entry-name'><StreamFilePath path={entry.path} resolve={props.resolveFilePath}
                    onOpen={() => props.onOpenFilePath?.(entry.path, entry.kind === 'directory')} /></span>
                <i className='codicon codicon-chevron-right nmx-stream-file-entry-open' aria-hidden='true' />
            </button>)}
        </div>;
    }
    return <p className='nmx-stream-details is-text' data-nmx-literal>{details.text}</p>;
}

/** Unified diff body without file headers, bounded for the transcript. */
export function diffLines(patch: string, maximum = 400): readonly { readonly kind?: 'add' | 'del' | 'hunk'; readonly text: string }[] {
    const lines = patch.replace(/\r\n/g, '\n').split('\n').filter(line => !/^(?:diff --git|index |--- |\+\+\+ |Index: |=+$)/.test(line));
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    const visible = lines.slice(0, maximum).map(line => ({
        ...(line.startsWith('@@') ? { kind: 'hunk' as const } : line.startsWith('+') ? { kind: 'add' as const } : line.startsWith('-') ? { kind: 'del' as const } : {}),
        text: line
    }));
    return lines.length > maximum ? [...visible, { kind: 'hunk' as const, text: `… +${lines.length - maximum}` }] : visible;
}

// ---------------------------------------------------------------------------
// Motion helpers

function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const EASE_OUT = 'cubic-bezier(0.2, 0, 0, 1)';

/**
 * Height transition for tool details (OpenCode `BasicTool` animated body).
 * The body is mounted only while open or closing, so collapsed rows cost
 * nothing; once open it returns to `height: auto` so live output can grow.
 */
export function StreamCollapse(props: { open: boolean; id: string; immediate?: boolean; children: () => React.ReactNode }): React.ReactElement | null {
    const [present, setPresent] = React.useState(props.open);
    const ref = React.useRef<HTMLDivElement>(null);
    const first = React.useRef(true);
    const animation = React.useRef<Animation | undefined>(undefined);
    if (props.open && !present) setPresent(true);
    React.useLayoutEffect(() => {
        const element = ref.current;
        if (first.current) { first.current = false; return; }
        if (!element) return;
        animation.current?.cancel();
        if (props.immediate || prefersReducedMotion() || typeof element.animate !== 'function') {
            element.style.height = '';
            if (!props.open) setPresent(false);
            return;
        }
        const from = props.open ? 0 : element.getBoundingClientRect().height;
        element.style.height = 'auto';
        const to = props.open ? element.getBoundingClientRect().height : 0;
        element.style.overflow = 'hidden';
        const running = element.animate([{ height: `${from}px`, opacity: props.open ? 0 : 1 }, { height: `${to}px`, opacity: props.open ? 1 : 0 }],
            { duration: 200, easing: EASE_OUT, fill: 'forwards' });
        animation.current = running;
        running.onfinish = () => {
            if (animation.current !== running) return;
            // Keep the closed height while React commits the unmount. Cancelling
            // a forwards-filled animation over height:auto otherwise reveals
            // the full body for a frame before setPresent(false) takes effect.
            if (!props.open) element.style.height = '0px';
            running.cancel();
            if (props.open) {
                element.style.overflow = '';
                element.style.height = '';
            } else setPresent(false);
        };
    }, [props.open]);
    if (!present) return null;
    return <div ref={ref} id={props.id} className='nmx-stream-collapse' role='region'>{props.children()}</div>;
}

/** Cross-fades a status label when it changes, e.g. “Compacting context” → “Context compacted”. */
export function SwapText(props: { value: string; className: string }): React.ReactElement {
    const [state, setState] = React.useState<{ current: string; previous?: string; epoch: number }>({ current: props.value, epoch: 0 });
    if (state.current !== props.value) {
        setState({ current: props.value, previous: prefersReducedMotion() ? undefined : state.current, epoch: state.epoch + 1 });
    }
    return <span className={`nmx-stream-swap ${props.className}`}>
        <span key={state.epoch} className={state.epoch ? 'nmx-stream-swap-in' : undefined}>{state.current}</span>
        {state.previous !== undefined && <span key={`out-${state.epoch}`} className='nmx-stream-swap-out' aria-hidden='true'
            onAnimationEnd={() => setState(value => value.epoch === state.epoch ? { current: value.current, epoch: value.epoch } : value)}>{state.previous}</span>}
    </span>;
}

/**
 * Keeps a child mounted until its exit animation ends (Radix Presence).
 * The child receives `nmx-presence-enter` / `nmx-presence-exit` classes.
 */
export function FadePresence(props: { present: boolean; children: React.ReactElement<{ className?: string; onAnimationEnd?: React.AnimationEventHandler }> }): React.ReactElement | null {
    const [mounted, setMounted] = React.useState(props.present);
    const last = React.useRef(props.children);
    if (props.present) last.current = props.children;
    if (props.present && !mounted) setMounted(true);
    const exiting = !props.present && mounted;
    React.useEffect(() => {
        if (exiting && prefersReducedMotion()) setMounted(false);
    }, [exiting]);
    if (!mounted) return null;
    const child = last.current;
    return React.cloneElement(child, {
        className: `${child.props.className || ''} ${exiting ? 'nmx-presence-exit' : 'nmx-presence-enter'}`.trim(),
        onAnimationEnd: (event: React.AnimationEvent) => {
            child.props.onAnimationEnd?.(event);
            if (exiting && event.target === event.currentTarget) setMounted(false);
        }
    });
}

/** A standalone status line in stream style (e.g. “Paused” after a paused turn's reply). */
export function StreamStatusRow(props: { locale: NextMuxDesktopLocale; item: StreamRowItem }): React.ReactElement {
    return <div className='nmx-stream nmx-stream-status'>
        <StreamRow item={props.item} locale={props.locale} idPrefix='status' restoring={false} restoreBusy={false}
            renderMarkdown={noMarkdown} renderTerminal={noMarkdown} onOpen={noop} onRestore={noop} />
    </div>;
}

const noMarkdown = (): React.ReactNode => undefined;
const noop = (): void => undefined;

// ---------------------------------------------------------------------------
// Notices

/** Short, localized turn notice (errors, balance). Raw codes never reach this surface. */
/**
 * `role` defaults to `status`: only a failure that happens now (the live turn)
 * should interrupt a screen reader with `alert`; history must stay quiet.
 */
export function StreamNotice(props: { locale?: NextMuxDesktopLocale; tone: 'error' | 'warning'; text: React.ReactNode; action?: React.ReactNode;
    dismissLabel?: string; onDismiss?: () => void; role?: 'alert' | 'status'; detail?: string }): React.ReactElement {
    return <div className={`nmx-stream-notice is-${props.tone}`} role={props.role || 'status'}>
        <i className={`codicon codicon-${props.tone === 'error' ? 'error' : 'warning'}`} aria-hidden='true'></i>
        <span className='nmx-stream-notice-text'>{props.text}</span>
        {props.action}
        {props.onDismiss && <button type='button' className='nmx-stream-notice-dismiss' aria-label={props.dismissLabel} title={props.dismissLabel}
            onClick={props.onDismiss}><i className='codicon codicon-close' aria-hidden='true'></i></button>}
    </div>;
}

export type { StreamItem };
