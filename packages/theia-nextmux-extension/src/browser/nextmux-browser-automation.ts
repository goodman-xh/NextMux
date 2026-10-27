import type { DesktopBrowserToolRequest, DesktopBrowserToolResult } from '../common/nextmux-platform-protocol';
import { browserActionToolResult } from './nextmux-browser-tool-result';

export interface BrowserAutomationSurface {
    readonly ownedBrowser?: import('../common/nextmux-owned-browser').OwnedBrowserOwner;
    ready?(): Promise<void>;
    executeJavaScript?(source: string, userGesture?: boolean): Promise<unknown>;
    getWebContentsId?(): number;
}

export interface BrowserPageCommand {
    readonly action: 'snapshot' | 'click' | 'fill';
    readonly ref?: string;
    readonly selector?: string;
    readonly text?: string;
    readonly timeoutMs?: number;
    readonly operationId?: string;
    readonly expiresAt?: number;
}

/** This bounded function is serialized into the isolated guest page. Models cannot submit code.
 * Workflow follows OpenClaw snapshot/ref ownership and Playwright actionability checks.
 * We retain Electron's existing sandbox instead of installing another browser runtime. */
export async function executeBrowserPageCommand(command: BrowserPageCommand): Promise<Record<string, unknown>> {
    type Observed = { element: Element; name: string };
    type RefState = { snapshotId: string; refs: Map<string, Observed> };
    const scope = window as Window & {
        __nextmuxObservedElementsV1?: RefState;
        __nextmuxCancelledBrowserCommandsV1?: Set<string>;
        __nextmuxConsoleErrors?: string[];
        __nextmuxConsoleHookInstalledV1?: boolean;
    };
    const recordConsoleError = (entry: string): void => {
        const list = (scope.__nextmuxConsoleErrors ||= []);
        const formatted = (entry || '').replace(/\s+/g, ' ').trim().slice(0, 300);
        if (!formatted) return;
        list.push(formatted);
        if (list.length > 20) list.splice(0, list.length - 20);
    };
    if (!scope.__nextmuxConsoleHookInstalledV1) {
        scope.__nextmuxConsoleHookInstalledV1 = true;
        if (typeof console !== 'undefined' && typeof console.error === 'function') {
            const origConsoleError = console.error.bind(console);
            console.error = (...args: unknown[]): void => {
                try {
                    recordConsoleError(args.map(arg => arg instanceof Error ? (arg.stack || arg.message) : typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '));
                } catch { /* ignore */ }
                origConsoleError(...args);
            };
        }
        if (typeof scope.addEventListener === 'function') {
            scope.addEventListener('error', (event: ErrorEvent) => {
                recordConsoleError(event?.message || String(event?.error || 'Page error'));
            });
            scope.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
                const reason = event?.reason;
                recordConsoleError(reason instanceof Error ? (reason.stack || reason.message) : String(reason || 'Unhandled promise rejection'));
            });
        }
    }
    const recentConsoleErrors = (): string[] => (scope.__nextmuxConsoleErrors || []).slice(-20).map(item => String(item).slice(0, 300));
    const cancelled = (): boolean => Boolean(command.operationId && scope.__nextmuxCancelledBrowserCommandsV1?.has(command.operationId)
        || command.expiresAt !== undefined && Date.now() >= command.expiresAt);
    const clean = (value: string | null | undefined, length = 160): string => (value || '').replace(/\s+/g, ' ').trim().slice(0, length);
    const nameOf = (element: Element): string => {
        const labelled = (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
            .map(id => element.ownerDocument.getElementById(id)?.textContent || '').join(' ');
        const labels = 'labels' in element ? Array.from((element as HTMLInputElement).labels || []).map(label => label.textContent).join(' ') : '';
        return clean(element.getAttribute('aria-label') || labelled || labels || element.getAttribute('alt')
            || element.getAttribute('title') || element.getAttribute('placeholder') || (element as HTMLElement).innerText || element.textContent);
    };
    const visible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
        return element.isConnected && rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden'
            && style.display !== 'none' && style.opacity !== '0' && !element.closest('[inert], [aria-hidden="true"]');
    };
    const elements = (): Element[] => {
        const result: Element[] = [];
        const visit = (root: Document | ShadowRoot): void => {
            for (const element of Array.from(root.querySelectorAll('*'))) {
                if (element.matches('a[href],button,input,textarea,select,summary,[role="button"],[role="link"],[role="checkbox"],[role="textbox"],[contenteditable="true"],[tabindex]')) result.push(element);
                if (element.shadowRoot) visit(element.shadowRoot);
            }
        };
        visit(document);
        return result;
    };
    const snapshot = (): Record<string, unknown> => {
        const snapshotId = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        const state: RefState = { snapshotId, refs: new Map() };
        const found = elements().filter(visible), items = found.slice(0, 80).map((element, index) => {
            const ref = `${snapshotId}e${index + 1}`, name = nameOf(element);
            state.refs.set(ref, { element, name });
            const tag = element.tagName.toLowerCase();
            return { ref, role: element.getAttribute('role') || (tag === 'a' ? 'link' : tag), name,
                ...(element.matches(':disabled,[aria-disabled="true"]') ? { disabled: true } : {}),
                ...(element.matches('[readonly],[aria-readonly="true"]') ? { readonly: true } : {}) };
        });
        scope.__nextmuxObservedElementsV1 = state;
        return { url: location.href, title: document.title, readyState: document.readyState, snapshotId,
            text: (document.body?.innerText || '').slice(0, 8_000), elements: items,
            truncated: found.length > items.length, scope: 'main-document-and-open-shadow-roots',
            consoleErrors: recentConsoleErrors() };
    };
    if (command.action === 'snapshot') {
        if (!document.body || document.readyState === 'loading') return { ok: false, code: 'PAGE_NOT_READY', message: 'The page is still loading. Read it again shortly.' };
        return { ok: true, ...snapshot() };
    }
    if ((!command.ref && !command.selector) || command.ref && command.selector) return { ok: false, code: 'INVALID_TARGET', message: 'Provide a ref from the latest snapshot or one unique selector.' };
    const deadline = Date.now() + Math.max(100, Math.min(10_000, command.timeoutMs || 5_000));
    let failure = 'The element is not actionable. ', previousRect = '', stableCount = 0;
    while (Date.now() < deadline) {
        if (cancelled()) return { ok: false, code: 'CANCELLED', message: 'The browser action was cancelled or expired and was not executed.' };
        let target: Element | undefined;
        if (command.ref) {
            const observed = scope.__nextmuxObservedElementsV1?.refs.get(command.ref);
            if (!observed || !observed.element.isConnected || nameOf(observed.element) !== observed.name) {
                return { ok: false, code: 'STALE_ELEMENT_REF', message: 'The element ref is stale. Read browser.snapshot again before acting; do not guess selectors.' };
            }
            target = observed.element;
        } else {
            let matches: NodeListOf<Element>;
            try { matches = document.querySelectorAll(command.selector!); }
            catch { return { ok: false, code: 'INVALID_SELECTOR', message: 'The selector is invalid. Use a ref returned by browser.snapshot.' }; }
            if (matches.length > 1) return { ok: false, code: 'AMBIGUOUS_ELEMENT', message: 'The selector matches multiple elements. Use a unique ref from the snapshot.' };
            target = matches[0];
        }
        if (!target) failure = 'The element was not found. ';
        else if (!visible(target)) failure = 'The element is not visible. ';
        else if (target.matches(':disabled,[aria-disabled="true"]')) failure = 'The element is disabled. ';
        else if (command.action === 'fill' && target.matches('[readonly],[aria-readonly="true"]')) failure = 'The input is read-only. ';
        else {
            const rect = target.getBoundingClientRect();
            const signature = [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value)).join(',');
            stableCount = signature === previousRect ? stableCount + 1 : 0;
            previousRect = signature;
            if (!stableCount) { await new Promise(resolve => setTimeout(resolve, 80)); continue; }
            target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
            const point = target.getBoundingClientRect();
            const root = target.getRootNode() as Document | ShadowRoot;
            let hit = root.elementFromPoint(point.x + point.width / 2, point.y + point.height / 2);
            while (hit && hit.shadowRoot) {
                const inner = hit.shadowRoot.elementFromPoint(point.x + point.width / 2, point.y + point.height / 2);
                if (!inner || inner === hit) break;
                hit = inner;
            }
            if (!hit || (hit !== target && !target.contains(hit) && !(target.shadowRoot && target.shadowRoot.contains(hit)))) failure = 'The element is covered by other content. ';
            else if (command.action === 'fill') {
                const editable = target as HTMLElement;
                if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement) && !editable.isContentEditable) {
                    return { ok: false, code: 'NOT_EDITABLE', message: 'The element does not accept text input.' };
                }
                if (target instanceof HTMLInputElement && ['file', 'checkbox', 'radio', 'button', 'submit', 'hidden'].includes(target.type)) {
                    return { ok: false, code: 'NOT_EDITABLE', message: 'This input type does not support fill.' };
                }
                const text = command.text || '';
                // Native setters notify React/Vue controlled fields through their normal input/change path.
                const applyControlledValue = (): void => {
                    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
                        const prototype = target instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
                        Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(target, text);
                    } else editable.textContent = text;
                    const InputEventCtor = typeof InputEvent === 'function' ? InputEvent : Event;
                    target!.dispatchEvent(new InputEventCtor('input', { bubbles: true, composed: true, ...(InputEventCtor !== Event ? { data: text, inputType: 'insertText' } : {}) } as InputEventInit));
                    target!.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                };
                applyControlledValue();
                await new Promise(resolve => setTimeout(resolve, 80));
                let actual = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target.value : editable.textContent;
                if (target.isConnected && actual !== text) {
                    applyControlledValue();
                    actual = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target.value : editable.textContent;
                }
                if (!target.isConnected || actual !== text) return { ok: false, code: 'FILL_NOT_RETAINED', message: 'The input value was not retained. Read the page again to verify it.' };
                return { ok: true, action: 'fill', verification: 'value-retained', snapshot: snapshot(), consoleErrors: recentConsoleErrors() };
            } else {
                if (!(target instanceof HTMLElement)) return { ok: false, code: 'NOT_CLICKABLE', message: 'The element does not support clicking.' };
                const before = { url: location.href, text: (document.body?.innerText || '').slice(0, 8_000) };
                let delivered = false;
                const observe = (): void => { delivered = true; };
                target.addEventListener('click', observe, { capture: true, once: true });
                try { target.click(); } finally { target.removeEventListener('click', observe, true); }
                if (!delivered) return { ok: false, code: 'CLICK_NOT_DELIVERED', message: 'The click was not delivered. Read the page again to verify it.' };
                // A click acknowledgement never claims the website completed its business operation.
                return { ok: true, action: 'click', verification: 'event-delivered', before, consoleErrors: recentConsoleErrors() };
            }
        }
        stableCount = 0;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return { ok: false, code: 'ELEMENT_NOT_ACTIONABLE', message: `${failure}The wait ended. Read the page again.` };
}

export async function runBrowserPageAction(surface: BrowserAutomationSurface, request: Pick<DesktopBrowserToolRequest, 'id' | 'action'> & Partial<DesktopBrowserToolRequest>, isActive?: () => Promise<boolean>): Promise<DesktopBrowserToolResult> {
    const cancelled = (): DesktopBrowserToolResult => ({ requestId: request.id, ok: false, code: 'CANCELLED', message: 'The browser action was cancelled.' });
    const pending = async (): Promise<boolean> => (!isActive || await isActive())
        && (request.expiresAt === undefined || request.expiresAt > Date.now());
    if (!await pending()) return cancelled();
    // Electron executes against the same owned webview using Puppeteer's native
    // locator/frame APIs. The DOM fallback is kept only for the web-only host.
    const bridge = typeof window !== 'undefined' ? window.nextmuxDesktop : undefined;
    if (surface.ownedBrowser) {
        const owner = surface.ownedBrowser, owned = bridge?.ownedBrowser;
        if (!owned || request.conversationId !== owner.conversationId || request.browserId !== owner.browserId || request.workspaceRoot !== owner.workspaceRoot) return { requestId: request.id, ok: false, code: 'BROWSER_REQUEST_DENIED', message: 'The browser owner has changed.' };
        let checking = false;
        const timer = isActive ? setInterval(() => {
            if (checking) return;
            checking = true;
            void pending().then(active => active ? undefined : owned.cancel(owner, request.id)).catch(() => owned.cancel(owner, request.id).catch(() => false)).finally(() => { checking = false; });
        }, 150) : undefined;
        try {
            // Canonical normalization belongs at the checked widget boundary.
            // This helper never silently rewrites a caller's ownership scope.
            const result = await owned.action(owner, { ...request, expiresAt: request.expiresAt ?? Date.now() + 30_000 } as DesktopBrowserToolRequest);
            return await pending() ? result : cancelled();
        } finally { if (timer !== undefined) clearInterval(timer); }
    }
    if (bridge?.performBrowserAction && surface.getWebContentsId && request.conversationId && request.browserId && request.workspaceRoot) {
        const guestId = surface.getWebContentsId();
        let checking = false;
        const timer = isActive ? setInterval(() => {
            if (checking) return;
            checking = true;
            void isActive().then(active => active ? undefined : bridge.cancelBrowserAction?.(guestId, request.id))
                .catch(() => bridge.cancelBrowserAction?.(guestId, request.id)).finally(() => { checking = false; });
        }, 150) : undefined;
        try {
            if (isActive && !await isActive()) return { requestId: request.id, ok: false, code: 'CANCELLED', message: 'The browser action was cancelled.' };
            const result = await bridge.performBrowserAction(guestId, request as DesktopBrowserToolRequest);
            return await pending() ? result : cancelled();
        } finally { if (timer !== undefined) clearInterval(timer); }
    }
    if (!surface.executeJavaScript) return { requestId: request.id, ok: false, code: 'BROWSER_UNAVAILABLE', message: 'This page cannot execute browser actions.' };
    const executeJavaScript = surface.executeJavaScript.bind(surface);
    const execute = (command: BrowserPageCommand): Promise<unknown> => executeJavaScript(`(${executeBrowserPageCommand.toString()})(${JSON.stringify(command)})`, false);
    if (request.action !== 'snapshot' && request.action !== 'click' && request.action !== 'fill') return { requestId: request.id, ok: false, code: 'UNSUPPORTED_ACTION', message: 'The page action is not supported.' };
    let checking = false, finished = false;
    const cancel = (): Promise<unknown> => Promise.resolve().then(() => executeJavaScript(`(window.__nextmuxCancelledBrowserCommandsV1 ||= new Set()).add(${JSON.stringify(request.id)})`, false));
    const timer = isActive && request.action !== 'snapshot' ? setInterval(() => {
        if (checking) return;
        checking = true;
        void isActive().then(active => finished || active ? undefined : cancel()).catch(() => finished ? undefined : cancel().catch(() => undefined)).finally(() => { checking = false; });
    }, 150) : undefined;
    let value: unknown;
    try {
        value = await execute({ action: request.action, ref: request.ref, selector: request.selector, text: request.text,
            timeoutMs: request.timeoutMs, operationId: request.id, expiresAt: request.expiresAt });
    } finally {
        finished = true;
        if (timer !== undefined) clearInterval(timer);
        void Promise.resolve().then(() => executeJavaScript(`window.__nextmuxCancelledBrowserCommandsV1?.delete(${JSON.stringify(request.id)})`, false)).catch(() => undefined);
    }
    const result = browserActionToolResult(request.id, value);
    if (!await pending()) return cancelled();
    if (!result.ok || request.action !== 'click') return result;
    // Re-read after delivery; a navigation may temporarily destroy the old execution context.
    const end = Date.now() + 4_000;
    await new Promise(resolve => setTimeout(resolve, 100));
    while (Date.now() < end) {
        if (!await pending()) return cancelled();
        try {
            const after = await execute({ action: 'snapshot' }) as Record<string, unknown>;
            if (!await pending()) return cancelled();
            if (after?.ok === true) {
                const before = (value as { before?: { url?: string; text?: string } }).before;
                return { requestId: request.id, ok: true, data: { ok: true, action: 'click', verification: 'event-delivered-and-page-observed',
                    pageChanged: before?.url !== after.url || before?.text !== after.text, snapshot: after,
                    consoleErrors: Array.isArray(after.consoleErrors) ? after.consoleErrors : [] } };
            }
        } catch { /* Navigation destroys the old document; observe the new one without clicking again. */ }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return { requestId: request.id, ok: false, code: 'CLICK_RESULT_UNCONFIRMED', message: 'The click was delivered, but its result is unverified. Read a snapshot to verify it; do not click again.' };
}

export function browserConversationKey(conversationId: string): string { return `session:${conversationId}`; }
export function browserWorkspaceMatches(expected: string | undefined, actual: string): boolean {
    if (!expected) return true;
    const normalize = (value: string): string => {
        const path = value.replace(/\\/g, '/').replace(/\/+$/, '');
        return /^[a-z]:\//i.test(path) || path.startsWith('//') ? path.toLowerCase() : path;
    };
    return normalize(expected) === normalize(actual);
}

/** Resolve aliases only on a mismatch; containment is not sufficient ownership. */
export async function browserWorkspaceMatchesCanonical(expected: string | undefined, actual: string,
    resolveRoot: (root: string, target: string) => Promise<{ readonly inside: boolean; readonly path?: string }>): Promise<boolean> {
    if (browserWorkspaceMatches(expected, actual)) return true;
    if (!expected || !actual) return false;
    try {
        const [left, right] = await Promise.all([resolveRoot(expected, expected), resolveRoot(actual, actual)]);
        return left.inside && right.inside && Boolean(left.path && right.path)
            && browserWorkspaceMatches(left.path, right.path!);
    } catch { return false; }
}

export function findOwnedBrowser<T extends { readonly id: string; readonly conversationId?: string }>(tabs: readonly T[], browserId: string | undefined, conversationId: string): T | undefined {
    return tabs.find(tab => tab.id === browserId && tab.conversationId === conversationId);
}
