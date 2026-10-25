import type { ToolExecutionSummary } from '@nextmux/agent-runtime';

/**
 * Structured, display-only summaries for the built-in browser tools.
 *
 * Behaviour follows Cline's browser session rows (Apache-2.0,
 * webview-ui/src/components/chat/BrowserSessionRow.tsx): a browser step is
 * shown as the action plus its human target ("Launch browser at <url>",
 * "Click (x, y)", "Type …") rather than a raw action identifier. NextMux keeps
 * the accessible name observed in the latest snapshot instead of coordinates,
 * and never records typed text (it may be a password).
 */

/** Accessible names of the elements in the latest snapshot, per conversation tab. */
export class BrowserRefNames {
    protected readonly tabs = new Map<string, Map<string, string>>();

    remember(tabKey: string, data: unknown): void {
        const snapshot = browserSnapshotOf(data);
        const elements = snapshot && Array.isArray(snapshot.elements) ? snapshot.elements : undefined;
        if (!elements) return;
        const names = new Map<string, string>();
        for (const element of elements.slice(0, 400)) {
            if (!element || typeof element !== 'object') continue;
            const { ref, name } = element as { ref?: unknown; name?: unknown };
            const label = typeof name === 'string' ? cleanTarget(name) : '';
            if (typeof ref === 'string' && ref && label) names.set(ref, label);
        }
        this.tabs.delete(tabKey);
        this.tabs.set(tabKey, names);
        while (this.tabs.size > 32) this.tabs.delete(this.tabs.keys().next().value as string);
    }

    name(tabKey: string, ref: string | undefined): string | undefined {
        return ref ? this.tabs.get(tabKey)?.get(ref) : undefined;
    }
}

interface BrowserSnapshotLike {
    readonly url?: unknown;
    readonly title?: unknown;
    readonly elements?: unknown;
}

function browserSnapshotOf(data: unknown): BrowserSnapshotLike | undefined {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
    const record = data as Record<string, unknown>;
    const nested = record.snapshot;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested as BrowserSnapshotLike;
    return 'elements' in record || 'url' in record ? record as BrowserSnapshotLike : undefined;
}

function cleanTarget(value: string, maximum = 80): string {
    const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length <= maximum ? text : `${text.slice(0, maximum - 1).trimEnd()}…`;
}

function safeHttpUrl(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href.slice(0, 2_048) : undefined;
    } catch {
        return undefined;
    }
}

export interface BrowserActivityInput {
    readonly action: string;
    readonly url?: string;
    readonly ref?: string;
    readonly targetRef?: string;
    readonly values?: readonly string[];
    readonly paths?: readonly string[];
    readonly message?: string;
    readonly data?: unknown;
}

/** Build the summary shown in the conversation for one completed browser tool call. */
export function browserActivitySummary(input: BrowserActivityInput, refNames: BrowserRefNames, tabKey: string): ToolExecutionSummary {
    const snapshot = browserSnapshotOf(input.data);
    const navigation = input.action === 'open' || input.action === 'navigate' || input.action === 'open_external';
    const url = navigation ? safeHttpUrl(input.url) || safeHttpUrl(snapshot?.url) : safeHttpUrl(snapshot?.url);
    const pageTitle = typeof snapshot?.title === 'string' ? cleanTarget(snapshot.title, 200) : '';
    let target: string | undefined;
    if (input.action === 'select' && input.values?.length) target = cleanTarget(input.values.join(', '));
    else if (input.action === 'upload' && input.paths?.length) {
        target = cleanTarget(input.paths.map(path => path.split(/[\\/]/).filter(Boolean).pop() || path).join(', '));
    } else if (['click', 'fill', 'select', 'upload', 'drag'].includes(input.action)) target = refNames.name(tabKey, input.ref);
    refNames.remember(tabKey, input.data);
    return {
        kind: 'browser.action',
        params: { action: input.action },
        title: 'Browser action',
        // Product messages are projected from semantic results; page content stays in the tool output.
        ...(target ? { target } : {}),
        ...(url ? { resource: { kind: 'browser' as const, url, ...(pageTitle ? { title: pageTitle } : {}) } } : {})
    };
}
