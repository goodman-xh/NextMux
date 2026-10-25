import * as React from '@theia/core/shared/react';
import type { BrowserAutomationSurface } from './nextmux-browser-automation';
import type { OwnedBrowserBounds, OwnedBrowserBridge, OwnedBrowserNavigation, OwnedBrowserOwner, OwnedBrowserPreview, OwnedBrowserState } from '../common/nextmux-owned-browser';
import '../../src/browser/style/nextmux-owned-browser.css';

export interface OwnedBrowserSurface extends BrowserAutomationSurface {
    readonly ownedBrowser: OwnedBrowserOwner;
    ready(): Promise<void>;
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
    reload(): void;
    loadURL(url: string): Promise<void>;
}

interface BrowserLabels {
    background: string; manual: string; takeover: string; release: string;
    loading: string; unavailable: string; preview: string; failed: string;
}

interface Props {
    readonly owner: OwnedBrowserOwner;
    readonly url: string;
    readonly title: string;
    readonly active: boolean;
    readonly mobile: boolean;
    readonly labels: BrowserLabels;
    readonly onLocation: (url: string) => void;
    readonly onTitle: (title: string) => void;
    readonly onSurface: (surface: OwnedBrowserSurface | undefined) => void;
}
interface State { page?: OwnedBrowserState; preview?: OwnedBrowserPreview; error: boolean; changing: boolean }

// React unmounts synchronously; the native close acknowledgement is asynchronous.
// A replacement page with the same tab ID waits for that close before creating.
const browserLifecycles = new Map<string, Promise<void>>();

/** The renderer displays pixels only. The page and its automation never receive host input.
 * Explicit takeover moves the existing native view; it does not open a second page. */
export class NextMuxOwnedBrowserView extends React.PureComponent<Props, State> {
    override state: State = { error: false, changing: false };
    private readonly bridge: OwnedBrowserBridge | undefined = window.nextmuxDesktop?.ownedBrowser;
    private readonly owner = Object.freeze({ ...this.props.owner });
    private viewport: HTMLDivElement | null = null;
    private mounted = false;
    private page?: OwnedBrowserState;
    private initialization?: Promise<void>;
    private timer?: ReturnType<typeof setTimeout>;
    private observer?: ResizeObserver;
    private overlays?: MutationObserver;
    private layoutQueued = false;
    private refreshing = false;
    private releasing?: Promise<void>;
    private lastBounds = '';
    private takeoverPending = false;
    private navigationGeneration = 0;

    private readonly surface: OwnedBrowserSurface = {
        ownedBrowser: this.owner,
        ready: () => this.ready(),
        getWebContentsId: () => this.page?.id || 0,
        canGoBack: () => Boolean(this.page?.canGoBack),
        canGoForward: () => Boolean(this.page?.canGoForward),
        goBack: () => { void this.navigate({ action: 'back' }).catch(this.fail); },
        goForward: () => { void this.navigate({ action: 'forward' }).catch(this.fail); },
        reload: () => { void this.navigate({ action: 'reload' }).catch(this.fail); },
        loadURL: url => this.navigate({ action: 'navigate', url })
    };

    override componentDidMount(): void {
        this.mounted = true;
        this.props.onSurface(this.surface);
        this.observer = new ResizeObserver(this.scheduleLayout);
        if (this.viewport) this.observer.observe(this.viewport);
        this.overlays = new MutationObserver(this.scheduleLayout);
        this.overlays.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden'] });
        document.addEventListener('pointerdown', this.outsideInput, true);
        document.addEventListener('keydown', this.outsideInput, true);
        document.addEventListener('visibilitychange', this.visibilityChanged);
        window.addEventListener('resize', this.scheduleLayout);
        void this.ready().then(() => this.refresh()).catch(this.fail);
    }

    override componentDidUpdate(previous: Props): void {
        // The parent remounts on ownership changes. Never silently retarget an existing page.
        if (JSON.stringify(this.props.owner) !== JSON.stringify(this.owner)) { void this.release(); return; }
        if (previous.url !== this.props.url && this.props.url !== this.page?.url) void this.navigate({ action: 'navigate', url: this.props.url }).catch(this.fail);
        if (previous.mobile !== this.props.mobile) void this.navigate({ action: 'mobile', mobile: this.props.mobile }).catch(this.fail);
        if (!this.props.active && previous.active) void this.release();
        if (this.props.active && !previous.active) void this.refresh();
        this.scheduleLayout();
    }

    override componentWillUnmount(): void {
        this.mounted = false;
        this.props.onSurface(undefined);
        if (this.timer) clearTimeout(this.timer);
        this.observer?.disconnect();
        this.overlays?.disconnect();
        document.removeEventListener('pointerdown', this.outsideInput, true);
        document.removeEventListener('keydown', this.outsideInput, true);
        document.removeEventListener('visibilitychange', this.visibilityChanged);
        window.removeEventListener('resize', this.scheduleLayout);
        // create may still be in flight. Close only after that operation settles.
        const closed = (this.initialization || Promise.resolve()).catch(() => undefined)
            .then(() => this.bridge?.close(this.owner)).then(() => undefined, () => undefined);
        browserLifecycles.set(this.owner.browserId, closed);
        void closed.finally(() => { if (browserLifecycles.get(this.owner.browserId) === closed) browserLifecycles.delete(this.owner.browserId); });
    }

    private readonly fail = (): void => { if (this.mounted) this.setState({ error: true, changing: false }); };

    private ready(): Promise<void> {
        if (!this.initialization) {
            const previous = browserLifecycles.get(this.owner.browserId) || Promise.resolve();
            this.initialization = previous.then(async () => {
            if (!this.bridge) throw new Error('Owned browser unavailable. Restart the desktop app.');
            this.accept(await this.bridge.create(this.owner, this.props.url));
            if (this.props.mobile && this.mounted) this.accept(await this.bridge.navigate(this.owner, { action: 'mobile', mobile: true }));
            if (this.mounted) await this.layout();
            });
            browserLifecycles.set(this.owner.browserId, this.initialization.catch(() => undefined));
        }
        return this.initialization;
    }

    private accept(page: OwnedBrowserState): void {
        if (!this.mounted || this.page && page.revision < this.page.revision) return;
        const old = this.page;
        this.page = page;
        this.setState(state => ({ page, error: Boolean(page.error), preview: state.preview?.revision === page.revision ? state.preview : undefined }));
        if (page.url && page.url !== old?.url) this.props.onLocation(page.url);
        if (page.title && page.title !== old?.title) this.props.onTitle(page.title);
    }

    private async navigate(navigation: OwnedBrowserNavigation): Promise<void> {
        const generation = ++this.navigationGeneration;
        await this.ready();
        if (!this.mounted || !this.bridge) return;
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
        } finally { void this.refresh(); }
    }

    private async refresh(): Promise<void> {
        if (!this.mounted || !this.props.active || this.refreshing || document.hidden || !this.bridge) return;
        this.refreshing = true;
        if (this.timer) clearTimeout(this.timer);
        try {
            await this.ready();
            if (!this.mounted || !this.props.active) return;
            this.accept(await this.bridge.state(this.owner));
            if (this.page?.mode === 'background') await this.layout();
            if (this.page?.mode === 'background' && this.bounds()) {
                const preview = await this.bridge.preview(this.owner);
                if (this.mounted && this.props.active && this.page?.mode === 'background' && preview.revision === this.page.revision) this.setState({ preview });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!/\[BROWSER_PREVIEW_(?:STALE|BUSY|RATE_LIMIT|EMPTY|TIMEOUT)\]/.test(message)) this.fail();
        }
        finally {
            this.refreshing = false;
            if (this.mounted && this.props.active) this.timer = setTimeout(() => void this.refresh(), this.page?.loading ? 400 : 1_000);
        }
    }

    /** CSS-pixel rectangles; main validates and converts using the host zoom
     * factor. devicePixelRatio includes monitor scale and is not that factor. */
    private bounds(): OwnedBrowserBounds | undefined {
        if (!this.viewport || !this.props.active || document.hidden) return undefined;
        const rect = this.viewport.getBoundingClientRect();
        if (rect.width < 32 || rect.height < 32 || rect.left < 0 || rect.top < 0 || rect.right > window.innerWidth + 1 || rect.bottom > window.innerHeight + 1) return undefined;
        // A dialog/menu can be smaller than the viewport; check intersecting surfaces,
        // not only its centre. Native children otherwise paint above host DOM.
        const blockers = document.querySelectorAll<HTMLElement>('[aria-modal="true"], [role="menu"], [role="listbox"], .nmx-popover, .nmx-dropdown, .nmx-overlay');
        for (const node of blockers) {
            if (this.viewport.contains(node)) continue;
            const style = getComputedStyle(node), box = node.getBoundingClientRect();
            if (style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0
                && box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top) return undefined;
        }
        for (const [x, y] of [[rect.left + 2, rect.top + 2], [rect.right - 2, rect.top + 2], [rect.left + 2, rect.bottom - 2], [rect.right - 2, rect.bottom - 2], [rect.left + rect.width / 2, rect.top + rect.height / 2]]) {
            const element = document.elementFromPoint(x, y);
            if (element !== this.viewport && !this.viewport.contains(element)) return undefined;
        }
        return { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.floor(rect.width), height: Math.floor(rect.height) };
    }

    private readonly scheduleLayout = (): void => {
        if (!this.mounted || this.layoutQueued) return;
        this.layoutQueued = true;
        queueMicrotask(() => { this.layoutQueued = false; if (this.mounted) void this.layout().catch(this.fail); });
    };

    private async layout(): Promise<void> {
        if (!this.page || !this.bridge) return;
        const bounds = this.bounds();
        if (!bounds) { await this.release(); return; }
        const key = JSON.stringify(bounds);
        if (key !== this.lastBounds) {
            this.lastBounds = key;
            try { this.accept(await this.bridge.resize(this.owner, bounds)); }
            catch (error) { this.lastBounds = ''; await this.release(); throw error; }
        }
    }

    private readonly outsideInput = (event: Event): void => {
        if ((this.takeoverPending || this.page?.mode !== 'background') && !this.viewport?.closest('.nmx-browser-view')?.contains(event.target as Node)) void this.release();
    };
    private readonly visibilityChanged = (): void => { if (document.hidden) void this.release(); else void this.refresh(); };

    private release(): Promise<void> {
        if (!this.bridge || !this.page || this.page.mode === 'background' && !this.takeoverPending) return Promise.resolve();
        if (!this.releasing) this.releasing = this.bridge.release(this.owner).then(page => this.accept(page)).catch(this.fail).finally(() => { this.releasing = undefined; });
        return this.releasing;
    }

    private readonly toggle = async (): Promise<void> => {
        if (!this.bridge || this.state.changing) return;
        this.setState({ changing: true });
        try {
            await this.ready();
            if (this.page?.mode === 'manual') await this.release();
            else {
                const bounds = this.bounds();
                if (!bounds) return;
                this.takeoverPending = true;
                const page = await this.bridge.takeover(this.owner, bounds);
                this.accept(page);
                // The user may have switched tabs/opened a dialog while cancellation settled.
                if (!this.bounds()) await this.release();
            }
        } catch { this.fail(); }
        finally { this.takeoverPending = false; if (this.mounted) this.setState({ changing: false }); }
    };

    override render(): React.ReactNode {
        const manual = this.state.page?.mode === 'manual', labels = this.props.labels;
        const busy = this.state.changing || this.state.page?.mode === 'transitioning' && !this.state.error;
        return <div className={`nmx-owned-browser${this.props.mobile ? ' is-mobile' : ''}`} data-browser-mode={this.state.page?.mode || 'loading'}>
            <div className='nmx-owned-browser-status'>
                <span role='status'>{busy ? labels.loading : manual ? labels.manual : labels.background}</span>
                <button type='button' disabled={!this.state.page || busy} onClick={() => void this.toggle()}>{manual ? labels.release : labels.takeover}</button>
            </div>
            <div className='nmx-owned-browser-viewport' ref={node => { this.viewport = node; }} aria-label={labels.preview}>
                {!manual && this.state.preview && <img src={this.state.preview.dataURL} alt={this.props.title} draggable={false} />}
                {!manual && !this.state.preview && <div className='nmx-owned-browser-placeholder' role='status'><i className='codicon codicon-globe' /><span>{this.state.error ? labels.failed : this.state.page?.loading || !this.state.page ? labels.loading : labels.unavailable}</span></div>}
            </div>
        </div>;
    }
}
