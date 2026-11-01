import * as React from '@theia/core/shared/react';
import type { BrowserAutomationSurface } from './nextmux-browser-automation';
import type { OwnedBrowserBounds, OwnedBrowserBridge, OwnedBrowserEvent, OwnedBrowserNavigation, OwnedBrowserOwner, OwnedBrowserPreview, OwnedBrowserState } from '../common/nextmux-owned-browser';
import '../../src/browser/style/nextmux-owned-browser.css';

export interface OwnedBrowserSurface extends BrowserAutomationSurface {
    readonly ownedBrowser: OwnedBrowserOwner;
    ready(): Promise<void>;
    canGoBack(): boolean;
    canGoForward(): boolean;
    isLoading(): boolean;
    goBack(): void;
    goForward(): void;
    reload(): void;
    stop(): void;
    loadURL(url: string): Promise<void>;
    /**
     * Runs one AI browser action with the page parked in its hidden holder, where model input never takes the
     * person's keyboard focus, then attaches the live page again shortly after the last action. A destructive action
     * (close) is not given a page the person used in the last few seconds: the main registry refuses it.
     */
    withAgentAccess<T>(run: () => Promise<T>, options?: { readonly destructive?: boolean }): Promise<T>;
}

export interface OwnedBrowserLabels {
    loading: string; unavailable: string; preview: string; failed: string;
    agent: string; retry: string; loadFailed: string;
}

interface Props {
    readonly owner: OwnedBrowserOwner;
    readonly url: string;
    readonly title: string;
    readonly active: boolean;
    readonly mobile: boolean;
    readonly labels: OwnedBrowserLabels;
    readonly onLocation: (url: string) => void;
    readonly onTitle: (title: string) => void;
    readonly onSurface: (surface: OwnedBrowserSurface | undefined) => void;
    /** Every accepted page state (loading, history, mode) for the toolbar. */
    readonly onState?: (state: OwnedBrowserState) => void;
    /** A link the person opened in a new tab (target="_blank", window.open after a click, the context menu). */
    readonly onOpenUrl?: (url: string, background: boolean) => void;
    /** Cmd/Ctrl+L pressed inside the page. */
    readonly onFocusAddress?: () => void;
}
interface State { page?: OwnedBrowserState; preview?: OwnedBrowserPreview; error: boolean; agent: boolean }

// React unmounts synchronously; the native close acknowledgement is asynchronous.
// A replacement page with the same tab ID waits for that close before creating.
const browserLifecycles = new Map<string, Promise<void>>();
/** After the last AI step, the live page returns this much later: back-to-back steps do not attach in between. */
const AGENT_REATTACH_DELAY_MS = 250;
/** A page the person used this recently is not handed to a model close. */
const AGENT_RECENT_INPUT_MS = 4_000;
/** Floating host surfaces a native page would otherwise paint over (a native view is always above the DOM). */
const OVERLAY_SELECTOR = ['[aria-modal="true"]', '[role="dialog"]', '[role="alertdialog"]', '[role="menu"]', '[role="listbox"]', '[class*="-backdrop"]',
    '.nmx-popover', '.nmx-dropdown', '.nmx-overlay', '.lm-Menu', '.p-Menu', '.dialogOverlay', '.monaco-menu-container', '.quick-input-widget'].join(', ');
const PAGE_FAILURES = /^BROWSER_(?:NAVIGATION_FAILED|NAVIGATION_TIMEOUT|RENDERER_GONE)$/;
const QUIET_NAVIGATION_ERRORS = /\[BROWSER_(?:NAVIGATION_SUPERSEDED|CONTROL_BUSY|ACTION_EXPIRED|TRANSITION_BUSY)\]/;
const frame = (callback: () => void): number => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : setTimeout(callback, 16) as unknown as number;
const cancelFrame = (id: number): void => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); else clearTimeout(id); };

/**
 * A browser tab in the right drawer, the way coding IDEs embed one: whenever the tab is visible and nothing of the
 * host floats over it, the live page is attached (clicks, scrolling, typing, the context menu go straight to it, and
 * attaching never moves keyboard focus). It is parked in its hidden holder, showing one still frame, while a dialog
 * or menu overlaps it, while an AI step runs, or while it is off screen; it attaches again as soon as that ends.
 */
export class NextMuxOwnedBrowserView extends React.PureComponent<Props, State> {
    override state: State = { error: false, agent: false };
    private readonly bridge: OwnedBrowserBridge | undefined = window.nextmuxDesktop?.ownedBrowser;
    private readonly owner = Object.freeze({ ...this.props.owner });
    private viewport: HTMLDivElement | null = null;
    private mounted = false;
    private page?: OwnedBrowserState;
    private initialization?: Promise<void>;
    private resizeObserver?: ResizeObserver;
    private bodyObserver?: MutationObserver;
    private unsubscribe?: () => void;
    private layoutFrame = 0;
    private recheckTimer?: ReturnType<typeof setTimeout>;
    private coveredTimer?: ReturnType<typeof setTimeout>;
    private retryTimer?: ReturnType<typeof setTimeout>;
    private reattachTimer?: ReturnType<typeof setTimeout>;
    private retryDelay = 0;
    private attaching?: Promise<void>;
    private releasing?: Promise<void>;
    private lastBounds = '';
    /** The host window was unfocused when the page last tried to attach: wait for it to be focused again. */
    private waitingForFocus = false;
    private agentDepth = 0;
    private capturing = false;
    private navigationGeneration = 0;

    private readonly surface: OwnedBrowserSurface = {
        ownedBrowser: this.owner,
        ready: () => this.ready(),
        getWebContentsId: () => this.page?.id || 0,
        canGoBack: () => Boolean(this.page?.canGoBack),
        canGoForward: () => Boolean(this.page?.canGoForward),
        isLoading: () => Boolean(this.page?.loading),
        goBack: () => { void this.navigate({ action: 'back' }).catch(this.navigationFailed); },
        goForward: () => { void this.navigate({ action: 'forward' }).catch(this.navigationFailed); },
        reload: () => { void this.navigate({ action: 'reload' }).catch(this.navigationFailed); },
        stop: () => { void this.navigate({ action: 'stop' }).catch(this.navigationFailed); },
        loadURL: url => this.navigate({ action: 'navigate', url }),
        withAgentAccess: (run, options) => this.withAgentAccess(run, options)
    };

    override componentDidMount(): void {
        this.mounted = true;
        this.props.onSurface(this.surface);
        this.resizeObserver = new ResizeObserver(this.scheduleLayout);
        if (this.viewport) {
            this.resizeObserver.observe(this.viewport);
            const drawer = this.viewport.closest?.('.nmx-work-context');
            if (drawer) this.resizeObserver.observe(drawer);
        }
        // Dialogs and menus mounted on <body> (Theia, Lumino, portals) appear as its direct children; nothing deeper
        // is observed, so typing anywhere in the window costs this view nothing.
        this.bodyObserver = new MutationObserver(this.scheduleLayout);
        if (document.body) this.bodyObserver.observe(document.body, { childList: true });
        document.addEventListener('focusin', this.hostActivity);
        document.addEventListener('pointerdown', this.hostActivity, { capture: true, passive: true });
        document.addEventListener('keydown', this.escapeKey, { passive: true });
        document.addEventListener('visibilitychange', this.visibilityChanged);
        window.addEventListener('resize', this.scheduleLayout);
        window.addEventListener('focus', this.windowFocused);
        this.unsubscribe = this.bridge?.onEvent?.(this.pageEvent);
        void this.ready().then(() => this.layoutNow()).catch(this.fail);
    }

    override componentDidUpdate(previous: Props): void {
        // The parent remounts on ownership changes. Never silently retarget an existing page.
        if (JSON.stringify(this.props.owner) !== JSON.stringify(this.owner)) { void this.park(); return; }
        if (previous.url !== this.props.url && this.props.url !== this.page?.url) void this.navigate({ action: 'navigate', url: this.props.url }).catch(this.navigationFailed);
        if (previous.mobile !== this.props.mobile) void this.navigate({ action: 'mobile', mobile: this.props.mobile }).catch(this.fail);
        if (previous.active !== this.props.active) {
            // Leaving the screen parks at once: a native page must never paint over another tab or a closing drawer.
            if (!this.props.active) void this.park();
            this.scheduleLayout();
        }
    }

    override componentWillUnmount(): void {
        this.mounted = false;
        this.props.onSurface(undefined);
        if (this.layoutFrame) cancelFrame(this.layoutFrame);
        for (const timer of [this.recheckTimer, this.coveredTimer, this.retryTimer, this.reattachTimer]) if (timer) clearTimeout(timer);
        this.resizeObserver?.disconnect();
        this.bodyObserver?.disconnect();
        this.unsubscribe?.();
        document.removeEventListener('focusin', this.hostActivity);
        document.removeEventListener('pointerdown', this.hostActivity, { capture: true } as EventListenerOptions);
        document.removeEventListener('keydown', this.escapeKey);
        document.removeEventListener('visibilitychange', this.visibilityChanged);
        window.removeEventListener('resize', this.scheduleLayout);
        window.removeEventListener('focus', this.windowFocused);
        // create may still be in flight. Close only after that operation settles.
        const closed = (this.initialization || Promise.resolve()).catch(() => undefined)
            .then(() => this.bridge?.close(this.owner)).then(() => undefined, () => undefined);
        browserLifecycles.set(this.owner.browserId, closed);
        void closed.finally(() => { if (browserLifecycles.get(this.owner.browserId) === closed) browserLifecycles.delete(this.owner.browserId); });
    }

    private readonly fail = (): void => { if (this.mounted) this.setState({ error: true }); };
    /** A superseded, busy or expired navigation is not a page failure; a real one arrives as the page's error state. */
    private readonly navigationFailed = (error: unknown): void => {
        if (QUIET_NAVIGATION_ERRORS.test(error instanceof Error ? error.message : String(error))) return;
        this.fail();
    };

    private ready(): Promise<void> {
        if (!this.initialization) {
            const previous = browserLifecycles.get(this.owner.browserId) || Promise.resolve();
            this.initialization = previous.then(async () => {
                if (!this.bridge) throw new Error('Owned browser unavailable. Restart the desktop app.');
                this.accept(await this.bridge.create(this.owner, this.props.url));
                if (this.props.mobile && this.mounted) this.accept(await this.bridge.navigate(this.owner, { action: 'mobile', mobile: true }));
            });
            browserLifecycles.set(this.owner.browserId, this.initialization.catch(() => undefined));
        }
        return this.initialization;
    }

    private accept(page: OwnedBrowserState): void {
        if (!this.mounted || this.page && page.revision < this.page.revision) return;
        const old = this.page;
        this.page = page;
        this.setState(state => ({ page, error: false, preview: page.mode === 'manual' ? undefined : state.preview }));
        if (page.url && page.url !== old?.url) this.props.onLocation(page.url);
        if (page.title && page.title !== old?.title) this.props.onTitle(page.title);
        this.props.onState?.(page);
        // Main parks a page by itself (its window hid, shrank or lost the page); attach again when that allows.
        if (old?.mode === 'manual' && page.mode !== 'manual') this.scheduleLayout();
        // A parked, visible page shows its newest frame once loading settles.
        if (old?.loading && !page.loading && page.mode !== 'manual' && this.viewportRect()) void this.capturePreview();
        if (Boolean(old?.error) !== Boolean(page.error)) this.scheduleLayout();
    }

    private readonly pageEvent = (event: OwnedBrowserEvent): void => {
        const owner = event?.owner;
        if (!this.mounted || !owner || owner.conversationId !== this.owner.conversationId || owner.browserId !== this.owner.browserId
            || owner.workspaceRoot !== this.owner.workspaceRoot) return;
        if (event.type === 'state') this.accept(event.state);
        else if (event.type === 'open-url') this.props.onOpenUrl?.(event.url, event.background === true);
        else if (event.type === 'focus-address') this.props.onFocusAddress?.();
    };

    private async navigate(navigation: OwnedBrowserNavigation): Promise<void> {
        const generation = ++this.navigationGeneration;
        await this.ready();
        if (!this.mounted || !this.bridge) return;
        // The page's own attach or park transition settles first: navigation during it is refused as busy.
        await Promise.all([this.attaching, this.releasing]).catch(() => undefined);
        if (!this.mounted) return;
        try { this.accept(await this.bridge.navigate(this.owner, navigation)); }
        catch (error) {
            // The address field optimistically stores the requested URL. A
            // rejected navigation must restore the actual page, not persist a
            // URL that the browser never opened or override a newer request.
            if (generation === this.navigationGeneration && this.mounted) {
                const current = await this.bridge.state(this.owner).catch(() => undefined);
                if (current && generation === this.navigationGeneration && this.mounted
                    && (!this.page || current.revision >= this.page.revision)) {
                    this.accept(current);
                    if (current.url && current.url !== this.props.url) this.props.onLocation(current.url);
                }
            }
            throw error;
        }
    }

    /** The viewport rectangle while this tab is on screen; CSS pixels (main converts with the host zoom factor). */
    private viewportRect(): DOMRect | undefined {
        if (!this.mounted || !this.viewport || !this.props.active || document.hidden) return undefined;
        const rect = this.viewport.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2 || rect.left < 0 || rect.top < 0 || rect.right > window.innerWidth + 1 || rect.bottom > window.innerHeight + 1) return undefined;
        return rect;
    }

    /** Whether a visible dialog, menu or popover of the host overlaps the page (only those few selectors are read). */
    private covered(rect: DOMRect): boolean {
        const own = this.viewport?.closest?.('.nmx-browser-view') || this.viewport;
        for (const node of Array.from(document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR))) {
            if (own?.contains(node) || this.viewport && node.contains(this.viewport)) continue;
            const box = node.getBoundingClientRect();
            if (box.width <= 0 || box.height <= 0 || box.left >= rect.right || box.right <= rect.left || box.top >= rect.bottom || box.bottom <= rect.top) continue;
            const style = getComputedStyle(node);
            if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') return true;
        }
        return false;
    }

    private failure(): boolean {
        const page = this.page;
        return Boolean(page?.error && PAGE_FAILURES.test(page.error.code) && !page.loading);
    }

    private readonly scheduleLayout = (): void => {
        if (!this.mounted || this.layoutFrame) return;
        this.layoutFrame = frame(() => { this.layoutFrame = 0; void this.layoutNow().catch(this.fail); });
    };
    /** A click, focus change or Escape may open or close a dialog a frame later: look now and once more shortly. */
    private readonly hostActivity = (): void => {
        this.scheduleLayout();
        if (this.recheckTimer) clearTimeout(this.recheckTimer);
        this.recheckTimer = setTimeout(() => { this.recheckTimer = undefined; this.scheduleLayout(); }, 150);
    };
    private readonly escapeKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') this.hostActivity(); };
    private readonly visibilityChanged = (): void => {
        if (document.hidden) void this.park();
        else { this.waitingForFocus = false; this.scheduleLayout(); }
    };
    private readonly windowFocused = (): void => { this.waitingForFocus = false; this.scheduleLayout(); };

    private async layoutNow(): Promise<void> {
        if (!this.mounted || !this.page || !this.bridge) return;
        const rect = this.viewportRect();
        if (!rect) { await this.park(); return; }
        const covered = this.covered(rect);
        if (this.coveredTimer) { clearTimeout(this.coveredTimer); this.coveredTimer = undefined; }
        // While a dialog covers the page nothing else may report its closing: look again until it is gone.
        if (covered) this.coveredTimer = setTimeout(() => { this.coveredTimer = undefined; this.scheduleLayout(); }, 400);
        if (covered || this.agentDepth > 0 || this.failure()) {
            await this.park();
            if (this.mounted && !this.failure() && this.viewportRect()) void this.capturePreview();
            return;
        }
        const bounds: OwnedBrowserBounds = { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.floor(rect.width), height: Math.floor(rect.height) };
        const key = JSON.stringify(bounds);
        if (this.page.mode === 'manual' && !this.releasing) {
            if (key === this.lastBounds) return;
            this.lastBounds = key;
            try { this.accept(await this.bridge.resize(this.owner, bounds)); }
            catch { this.lastBounds = ''; await this.park(); this.retryLater(); }
            return;
        }
        if (this.page.mode !== 'transitioning' && !this.waitingForFocus && !this.retryTimer) await this.attach(bounds, key);
    }

    private attach(bounds: OwnedBrowserBounds, key: string): Promise<void> {
        if (this.attaching || !this.bridge) return this.attaching || Promise.resolve();
        const bridge = this.bridge;
        this.attaching = (async () => {
            if (this.releasing) await this.releasing;
            if (!this.mounted) return;
            try {
                const page = await bridge.takeover(this.owner, bounds);
                this.accept(page);
                if (page.mode === 'manual') { this.lastBounds = key; this.retryDelay = 0; }
                // Main attaches only to a visible, focused window; until it is focused again the page stays parked.
                else { this.waitingForFocus = true; if (this.viewportRect()) void this.capturePreview(); }
            } catch { this.retryLater(); }
        })().finally(() => {
            this.attaching = undefined;
            // Something may have changed while main was settling (a dialog opened, the tab was hidden): look again.
            this.scheduleLayout();
        });
        return this.attaching;
    }

    /** A refused attach is retried later, backing off, never in a tight loop. */
    private retryLater(): void {
        if (!this.mounted || this.retryTimer) return;
        this.retryDelay = Math.min(8_000, Math.max(500, this.retryDelay * 2));
        this.retryTimer = setTimeout(() => { this.retryTimer = undefined; this.scheduleLayout(); }, this.retryDelay);
    }

    /** Parks the page in its hidden holder. Immediate even while an attach is settling (main suppresses it). */
    private park(): Promise<void> {
        if (!this.bridge || !this.page) return Promise.resolve();
        if (this.page.mode === 'background' && !this.attaching) return this.releasing || Promise.resolve();
        if (!this.releasing) {
            this.lastBounds = '';
            this.releasing = this.bridge.release(this.owner).then(page => this.accept(page)).catch(this.fail).finally(() => { this.releasing = undefined; });
        }
        return this.releasing;
    }

    /** One still frame of a parked, visible page. A frame of an older state is never shown. */
    private async capturePreview(attempt = 0): Promise<void> {
        if (!this.bridge || !this.page || this.capturing) return;
        this.capturing = true;
        let stale = false;
        try {
            const preview = await this.bridge.preview(this.owner);
            if (this.mounted && this.page && this.page.mode !== 'manual') {
                if (preview.revision === this.page.revision) this.setState({ preview });
                else stale = true;
            }
        } catch { /* busy or not painted yet: the next change captures again */ }
        finally { this.capturing = false; }
        if (stale && attempt < 2 && this.mounted) setTimeout(() => { if (this.page?.mode !== 'manual' && this.viewportRect()) void this.capturePreview(attempt + 1); }, 120);
    }

    private async withAgentAccess<T>(run: () => Promise<T>, options: { readonly destructive?: boolean } = {}): Promise<T> {
        await this.ready().catch(() => undefined);
        if (!this.mounted || !this.page) return run();
        // The person is using this page: a model close is refused by the registry while it stays attached.
        if (options.destructive && this.page.mode === 'manual' && Date.now() - (this.page.userInputAt || 0) < AGENT_RECENT_INPUT_MS) return run();
        this.agentDepth += 1;
        if (this.reattachTimer) { clearTimeout(this.reattachTimer); this.reattachTimer = undefined; }
        if (!this.state.agent) this.setState({ agent: true });
        try {
            if (this.attaching) await this.attaching.catch(() => undefined);
            await this.park();
            if (this.viewportRect()) void this.capturePreview();
            return await run();
        } finally {
            this.agentDepth -= 1;
            if (!this.agentDepth && this.mounted) {
                this.reattachTimer = setTimeout(() => {
                    this.reattachTimer = undefined;
                    if (!this.mounted || this.agentDepth) return;
                    this.setState({ agent: false });
                    this.scheduleLayout();
                }, AGENT_REATTACH_DELAY_MS);
            }
        }
    }

    private readonly retry = (): void => {
        if (this.state.error) this.setState({ error: false });
        void this.navigate({ action: 'navigate', url: this.page?.url && !/^about:|^chrome-error:/.test(this.page.url) ? this.page.url : this.props.url }).catch(this.navigationFailed);
    };

    override render(): React.ReactNode {
        const { page, preview, agent } = this.state, labels = this.props.labels;
        const attached = page?.mode === 'manual';
        const failed = this.failure() || this.state.error && !attached;
        return <div className={`nmx-owned-browser${this.props.mobile ? ' is-mobile' : ''}`} data-browser-mode={page?.mode || 'loading'}>
            <div className='nmx-owned-browser-viewport' ref={node => { this.viewport = node; }} aria-label={labels.preview} aria-busy={Boolean(page?.loading)}>
                {!attached && !failed && preview && <img src={preview.dataURL} alt={this.props.title} draggable={false} />}
                {!attached && !failed && !preview && this.props.active && <div className='nmx-owned-browser-placeholder' role='status'>
                    <i className={`codicon codicon-${!page || page.loading ? 'loading codicon-modifier-spin' : 'globe'}`} /><span>{!page || page.loading ? labels.loading : labels.unavailable}</span>
                </div>}
                {failed && <div className='nmx-owned-browser-error' role='alert'>
                    <i className='codicon codicon-warning' />
                    <strong>{labels.loadFailed}</strong>
                    <span data-nmx-literal>{page?.error?.message || labels.failed}</span>
                    <button type='button' onClick={this.retry}><i className='codicon codicon-refresh' />{labels.retry}</button>
                </div>}
                {agent && !attached && <div className='nmx-owned-browser-agent' role='status'><i className='codicon codicon-sparkle' /><span>{labels.agent}</span></div>}
            </div>
        </div>;
    }
}
