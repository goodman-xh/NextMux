import type { DesktopBrowserToolRequest, DesktopBrowserToolResult } from './nextmux-platform-protocol';

/** Immutable per-page owner. A tab never acquires another conversation's page. */
export interface OwnedBrowserOwner {
    readonly conversationId: string;
    readonly browserId: string;
    readonly workspaceRoot: string;
}

export interface OwnedBrowserState {
    readonly id: number;
    readonly url: string;
    readonly title: string;
    readonly loading: boolean;
    readonly canGoBack: boolean;
    readonly canGoForward: boolean;
    readonly mode: 'background' | 'transitioning' | 'manual';
    readonly revision: number;
    readonly mobile: boolean;
    readonly error?: { readonly code: string; readonly message: string };
}

export interface OwnedBrowserPreview {
    readonly dataURL: string;
    readonly width: number;
    readonly height: number;
    readonly revision: number;
    readonly capturedAt: number;
    readonly captureStartedAt: number;
}

export interface OwnedBrowserBounds { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface OwnedBrowserNavigation {
    readonly action: 'navigate' | 'back' | 'forward' | 'reload' | 'mobile';
    readonly url?: string;
    readonly mobile?: boolean;
}

export interface OwnedBrowserBridge {
    create(owner: OwnedBrowserOwner, url: string): Promise<OwnedBrowserState>;
    state(owner: OwnedBrowserOwner): Promise<OwnedBrowserState>;
    preview(owner: OwnedBrowserOwner): Promise<OwnedBrowserPreview>;
    action(owner: OwnedBrowserOwner, request: DesktopBrowserToolRequest): Promise<DesktopBrowserToolResult>;
    cancel(owner: OwnedBrowserOwner, requestId: string): Promise<boolean>;
    navigate(owner: OwnedBrowserOwner, navigation: OwnedBrowserNavigation): Promise<OwnedBrowserState>;
    takeover(owner: OwnedBrowserOwner, bounds: OwnedBrowserBounds): Promise<OwnedBrowserState>;
    release(owner: OwnedBrowserOwner): Promise<OwnedBrowserState>;
    resize(owner: OwnedBrowserOwner, bounds: OwnedBrowserBounds): Promise<OwnedBrowserState>;
    close(owner: OwnedBrowserOwner): Promise<boolean>;
}
