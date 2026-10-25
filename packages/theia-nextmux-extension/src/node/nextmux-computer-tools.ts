import { randomUUID } from 'node:crypto';
import Ajv, { type ValidateFunction } from 'ajv';
const validator = new Ajv({ strict: false, allErrors: false });
const actionValidators = new Map<string, ValidateFunction>();
import { AgentToolError, type AgentToolRegistry, type ToolHandlerResult } from '@nextmux/agent-runtime';
import { COMPUTER_USER_ESC_OBSERVATION, type DesktopComputerAction, type DesktopComputerCapability, type DesktopComputerToolRequest, type DesktopComputerToolResult,
    type DesktopTabAction } from '../common/nextmux-computer-automation';

// One text for computer.* and tabs.* (the renderer returns the same code for tabs).
export { COMPUTER_USER_ESC_OBSERVATION };

// CUA's structured predicates are not arbitrary JSON or free-form text. Keep
// their wire names so the model does not have to guess a driver's hidden schema.
const verificationPredicates = {
    type: 'array', minItems: 1, maxItems: 8,
    items: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: {
            window: {
                type: 'object', additionalProperties: false, minProperties: 1,
                properties: {
                    exists: { type: 'boolean' },
                    bounds: {
                        type: 'object', additionalProperties: false, required: ['x', 'y', 'width', 'height'],
                        properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' },
                            tolerance_px: { type: 'number', minimum: 0, maximum: 100 } }
                    }
                }
            },
            element: {
                type: 'object', additionalProperties: false, required: ['selector'], minProperties: 2,
                properties: {
                    selector: {
                        type: 'object', additionalProperties: false, minProperties: 1,
                        properties: { role: { type: 'string', minLength: 1 }, label_contains: { type: 'string', minLength: 1 } }
                    },
                    // The driver refuses element.exists=false: accessibility snapshots are not exhaustive, so a missing
                    // element is not proof that it is gone. The description says what to check instead.
                    exists: { type: 'boolean', enum: [true], description: 'Only true. An element cannot be proven absent (snapshots are partial); to confirm a dialog or popup closed, use {window:{exists:false}} on its own window, or check the element that should appear next.' },
                    value_equals: { type: 'string' },
                    enabled: { type: 'boolean' }, selected: { type: 'boolean' }
                }
            }
        }
    }
};

const actions: Readonly<Record<DesktopComputerAction, string>> = {
    listApps: 'List apps', listWindows: 'List app windows', openApp: 'Open app', observeWindow: 'Inspect app window',
    verifyState: 'Verify app state', click: 'Click app control', doubleClick: 'Double-click app control', rightClick: 'Open control menu',
    scroll: 'Scroll app window', drag: 'Drag app control', setValue: 'Set app control value', typeText: 'Type text',
    pressKey: 'Press key', hotkey: 'Press hotkey'
};
export const computerActionInputs: Readonly<Record<DesktopComputerAction, readonly string[]>> = {
    listApps: [], listWindows: ['pid', 'onScreenOnly'], openApp: ['selector'],
    observeWindow: ['pid', 'windowId', 'includeScreenshot', 'disableDiff', 'maxTextChars', 'maxElements', 'maxDepth'],
    verifyState: ['pid', 'windowId', 'expect', 'timeoutMs', 'stableSamples'],
    click: ['pid', 'windowId', 'elementToken', 'x', 'y', 'button', 'count'],
    doubleClick: ['pid', 'windowId', 'elementToken', 'x', 'y'],
    rightClick: ['pid', 'windowId', 'elementToken', 'x', 'y', 'modifier'],
    scroll: ['pid', 'windowId', 'elementToken', 'x', 'y', 'direction', 'by', 'amount'],
    drag: ['pid', 'windowId', 'fromX', 'fromY', 'toX', 'toY', 'durationMs', 'steps', 'button', 'modifier'],
    setValue: ['pid', 'windowId', 'elementToken', 'value'], typeText: ['pid', 'windowId', 'elementToken', 'text', 'delayMs'],
    pressKey: ['pid', 'windowId', 'elementToken', 'key', 'modifiers'], hotkey: ['pid', 'windowId', 'elementToken', 'keys']
};

/** What each computer.* tool does, for the model (activity kinds are localized by the UI). */
const computerActionDescriptions: Readonly<Record<string, string>> = {
    listApps: 'List the apps running on the user\'s computer with their name, bundle id / program name and pid.',
    listWindows: 'List the windows of the user\'s desktop apps with pid, windowId, title and bounds.',
    openApp: 'Open an app on the user\'s own desktop (or bring it to the front) when they explicitly request desktop app control. This does not open a tab; for a desktop app you work in for the user, use tabs.open_app. For explicit browser/link requests, use browser.open, which follows the user\'s saved browser choice; naming Chrome, Safari or Edge alone does not request desktop app control. Public online research first uses available remote research tools; if unavailable or insufficient after checking actual results, use browser.open as the fallback, never openApp merely to search.',
    observeWindow: 'Read a window\'s accessible controls: returns a snapshotId, an element token for each control and the window coordinates.',
    verifyState: 'Check structured window/element predicates without acting. Example expect: [{element:{selector:{label_contains:"Save"},exists:true}}]. Use current observed labels/roles. Predicates are AND-combined. Only status=satisfied with stable=true proves the expectation; unknown, unsatisfied or stable=false do not. window.exists proves only that the window is present, not that an action succeeded. To confirm something closed or disappeared, use window.exists:false on that window (dialogs and sheets are usually their own windows) or check the element that should replace it; element.exists:false is not available because element snapshots are partial.',
    click: 'Act on a supported control at fresh window screenshot coordinates or by elementToken (resolved to the centre of the observed control). Use set_value for a token-bound value write.',
    doubleClick: 'Double-click at fresh window screenshot coordinates or by elementToken (centre of the observed control) where posted window messages support it (Windows); macOS returns background_unsupported.',
    rightClick: 'Open a supported control menu at fresh window screenshot coordinates or by elementToken (centre of the observed control) via AXShowMenu or Windows messages.',
    scroll: 'Scroll at fresh window screenshot coordinates or by elementToken (centre of the observed control) through a supported window adapter; use tabs.scroll on Windows. macOS line scrolling is currently background_unsupported.',
    drag: 'Drag between pixels in the returned window screenshot, with the mouse button held. For an accessibility frame in screen points, subtract context.windowBounds.x/y then multiply by context.screenshotScale; do not use desktop coordinates or unscaled points. An adapter without nonintrusive drag returns background_unsupported; there is no system-pointer fallback.',
    setValue: 'Set the value of an editable control (by element token).',
    typeText: 'Insert text into the exact window selected/focused field through AXSelectedText or Windows messages; when elementToken is given, clicks the centre of the observed control first to focus it.',
    pressKey: 'Request a supported window key action (when elementToken is given, clicks the centre of the observed control first to focus it). Windows supports posted single keys; macOS supports advertised AXConfirm/AXCancel only. Unsupported keys or modifiers return an error.',
    hotkey: 'Request a key combination (when elementToken is given, clicks the centre of the observed control first to focus it). No currently verified nonintrusive adapter supports arbitrary chords; returns background_unsupported.'
};

export function computerFailureMessage(result: DesktopComputerToolResult, read = false): string {
    if (result.error === 'interrupted_by_user_esc') {
        return COMPUTER_USER_ESC_OBSERVATION;
    }
    if (result.error === 'computer_window_closed') {
        return 'computer_window_closed: The target window or its app closed while the action ran. Do not retry clicks on the closed window. Check with computer.list_windows (or tabs.list) whether it reopened, relaunch the app only if the task needs it, or finish the task another way.';
    }
    if (result.error === 'computer_element_unlocatable') {
        return 'computer_element_unlocatable: The element token has no usable on-window bounds in the current observation. Use x/y from a fresh computer.observe_window screenshot, or tabs.*.';
    }
    if (result.error === 'computer_builtin_surface_requires_browser') {
        return 'The action was not sent. This is NextMux’s own window. Use browser.tabs, browser.snapshot and browser.fill/click for its built-in browser; never fall back to desktop keyboard, mouse or clipboard input.';
    }
    if (!result.diagnostic) return result.error || 'The computer action did not complete. Look at the window again before acting.';
    const diagnostic = result.diagnostic;
    const facts: Record<string, unknown> = {};
    for (const [key, allowed] of Object.entries({
        phase: ['host', 'native_call', 'result_encoding'], source: ['host', 'computer_use', 'driver'],
        driverTag: ['Configuration', 'InvalidArguments', 'Transport', 'Protocol', 'Tool', 'Shutdown', 'RuntimeAlreadyExists', 'Worker', 'Remote', 'ActionInterrupted'],
        completion: ['not_started', 'completed', 'unknown']
    })) {
        const value = diagnostic[key as keyof typeof diagnostic];
        if (typeof value === 'string' && allowed.includes(value)) facts[key] = value;
    }
    if (diagnostic.nativeCode === -25204 && diagnostic.nativeAction === 'AXPress') {
        facts.nativeCode = -25204; facts.nativeAction = 'AXPress';
    }
    const operation = diagnostic.operation;
    if (operation) for (const key of ['dispatched', 'committed', 'cancellationRequested'] as const) {
        if (typeof operation[key] === 'boolean') facts[key] = operation[key];
    }
    const code = typeof result.error === 'string' && /^[a-z_\d]{1,100}$/i.test(result.error) ? result.error : 'computer_operation_failed';
    if (code === 'uiaccess_worker_unavailable') {
        return `${code}. The Windows UIAccess worker is not available for direct desktop computer.* actions. Open the app in a conversation tab with tabs.open_app (or use its existing tab from tabs.list), then inspect with tabs.screenshot and act with tabs.click / tabs.type / tabs.key / tabs.scroll / tabs.drag.`;
    }
    if (diagnostic.phase === 'host' && ['computer_snapshot_stale', 'computer_element_stale'].includes(code)) {
        return `${code}. The action was not sent: the snapshot or element token is out of date. Call computer.observe_window for a new snapshotId and element tokens, then decide from the current window.`;
    }
    return `${code}. ${code === 'computer_ax_action_unconfirmed' ? 'The system did not confirm whether the click happened; this is neither success nor failure. ' : ''}${read ? 'The read did not complete; look at the app again.'
        : 'The result is not verified. Call computer.observe_window to see the window now before the next step, and do not replay the action. "completed" or "committed" only describe the dispatch, not that the window reached the expected state; false alone does not prove the action had no effect.'} ${JSON.stringify(facts)}`;
}

/** A bounded bridge to the Electron host; it does not implement a second computer driver. */
/** How long a computer tool call waits for the user to grant the system permission it needs. */
export const COMPUTER_PERMISSION_WAIT_MS = 10 * 60_000;

export class DesktopComputerTools {
    private capability: DesktopComputerCapability | undefined;
    private readonly pending = new Map<string, {
        request: DesktopComputerToolRequest;
        settle: (result: DesktopComputerToolResult) => void;
    }>();
    private readonly tabQueues = new Map<string, Promise<unknown>>();
    private closed = false;

    private enqueueByTab<T>(tabKey: string | undefined, task: () => Promise<T>): Promise<T> {
        if (!tabKey) return task();
        const previous = this.tabQueues.get(tabKey) ?? Promise.resolve();
        const next = previous.then(task);
        const tracked = next.then(
            () => { if (this.tabQueues.get(tabKey) === tracked) this.tabQueues.delete(tabKey); },
            () => { if (this.tabQueues.get(tabKey) === tracked) this.tabQueues.delete(tabKey); }
        );
        this.tabQueues.set(tabKey, tracked);
        return next;
    }

    setCapability(capability: DesktopComputerCapability): void { this.capability = capability; }
    /** Whether runs get the tab tools (and so the instructions that go with them). */
    offersTabs(): boolean {
        return !this.closed && Boolean(this.capability) && (this.capability!.available || this.capability!.reason === 'permission_required' || this.capability!.reason === 'worker_install_required');
    }
    requests(): readonly DesktopComputerToolRequest[] { return [...this.pending.values()].slice(0, 8).map(item => item.request); }
    resolve(result: DesktopComputerToolResult): boolean {
        const item = this.pending.get(result?.requestId);
        if (!item) return false;
        item.settle(result);
        return true;
    }
    dispose(): void {
        this.closed = true;
        for (const item of [...this.pending.values()]) item.settle({ requestId: item.request.id, ok: false, error: 'COMPUTER_CANCELLED' });
    }

    register(registry: AgentToolRegistry, conversationId: string): void {
        if (!conversationId || this.closed || !this.capability
            || !this.capability.available && this.capability.reason !== 'permission_required' && this.capability.reason !== 'worker_install_required') return;
        const scalar = { type: 'integer', minimum: 0 };
        const text = { type: 'string', maxLength: 16_000 };
        const properties = { pid: scalar, windowId: scalar, snapshotId: text, elementToken: text,
            x: { type: 'number' }, y: { type: 'number' }, fromX: { type: 'number' }, fromY: { type: 'number' },
            toX: { type: 'number' }, toY: { type: 'number' }, text, value: text, key: text, selector: text,
            keys: { type: 'array', items: text, maxItems: 8 }, modifiers: { type: 'array', items: text, maxItems: 8 },
            direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, by: { type: 'string', enum: ['line', 'page'] },
            amount: { type: 'number' }, durationMs: { type: 'integer', minimum: 0, maximum: 10_000 }, steps: { type: 'integer', minimum: 1, maximum: 100 },
            delayMs: { type: 'integer', minimum: 0, maximum: 1000 }, button: { type: 'string' }, modifier: { type: 'array', items: text, maxItems: 8 }, count: { type: 'integer', minimum: 1, maximum: 3 },
            expect: verificationPredicates, timeoutMs: { type: 'integer', minimum: 1, maximum: 10_000 }, stableSamples: { type: 'integer', minimum: 1, maximum: 5 }, onScreenOnly: { type: 'boolean' },
            includeScreenshot: { type: 'boolean' }, disableDiff: { type: 'boolean' },
            maxTextChars: { type: 'integer', minimum: 512, maximum: 48_000 }, maxElements: { type: 'integer', minimum: 1, maximum: 500 },
            maxDepth: { type: 'integer', minimum: 1, maximum: 30 } };
        this.registerTabTools(registry, conversationId);
        for (const [action, title] of Object.entries(actions) as [DesktopComputerAction, string][]) {
            const read = ['listApps', 'listWindows', 'observeWindow', 'verifyState'].includes(action);
            const required = action === 'openApp' ? ['selector'] : ['listApps', 'listWindows'].includes(action) ? []
                : action === 'observeWindow' ? ['pid', 'windowId'] : ['pid', 'windowId', 'snapshotId'];
            const extraRequired = action === 'typeText' ? ['text'] : action === 'setValue' ? ['elementToken', 'value']
                : action === 'pressKey' ? ['key'] : action === 'hotkey' ? ['keys'] : action === 'drag' ? ['fromX', 'fromY', 'toX', 'toY']
                    : action === 'scroll' ? ['direction', 'amount'] : action === 'verifyState' ? ['expect'] : [];
            const fields = [...computerActionInputs[action], ...(required.includes('snapshotId') ? ['snapshotId'] : [])];
            const inputSchema = { type: 'object', additionalProperties: false,
                properties: Object.fromEntries(fields.map(field => [field, properties[field as keyof typeof properties]])),
                required: [...required, ...extraRequired] };
            let validate = actionValidators.get(action);
            if (!validate) { validate = validator.compile(inputSchema); actionValidators.set(action, validate); }
            const toolName = `computer.${action.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}`;
            registry.register({ name: toolName, description: `${computerActionDescriptions[action] || title} Input is restricted to supported window-scoped AX/value or Windows messages; arbitrary SDK event input returns background_unsupported. These tools work on the user's own desktop apps (or on a tab's window by its pid and windowId), never NextMux's built-in browser. For that browser use browser.* exclusively, even after a stale ref or failed fill; do not substitute system keyboard, mouse, clipboard or shell automation. Get pid and windowId from computer.list_apps / computer.list_windows (or tabs.list), then computer.observe_window for a snapshotId, element tokens and window coordinates. Use elementToken for set_value or to target the centre of the observed control; use fresh x/y screenshot coordinates or tabs.* when a token has no bounds. Observe again after every action. Never guess windows, snapshots or element tokens.`,
                source: 'builtin', requiredPermission: 'full_access', executionKind: read ? 'read' : 'side_effect',
                inputSchema
            }, async (input, context): Promise<ToolHandlerResult> => {
                if (!validate!(input)) throw new AgentToolError('INVALID_COMPUTER_INPUT', 'The arguments do not match this tool\'s schema.');
                const request: DesktopComputerToolRequest = { id: `computer-${randomUUID()}`, conversationId,
                    runId: context.runId, expiresAt: Date.now() + 45_000, action, input: input as Record<string, unknown> };
                const result = await this.request(request, context.signal);
                if (!result.ok) {
                    const code = result.error === 'computer_ax_action_unconfirmed' && result.diagnostic?.phase === 'native_call'
                        && result.diagnostic.nativeCode === -25204 && result.diagnostic.nativeAction === 'AXPress' ? 'COMPUTER_AX_ACTION_UNCONFIRMED'
                        : result.diagnostic?.phase === 'host' && ['computer_snapshot_stale', 'computer_element_stale'].includes(result.error || '')
                            ? result.error!.toUpperCase() : 'COMPUTER_OPERATION_FAILED';
                    // An Esc stop reads as COMPUTER_USER_ESC_OBSERVATION; the widget refuses further control this turn itself.
                    throw new AgentToolError(code, computerFailureMessage(result, read));
                }
                return { modelOutput: result.output ?? { ok: true }, summary: { kind: toolName, title },
                    ...(result.images?.length ? { attachments: result.images.slice(0, 4)
                        .filter(image => ['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType) && image.data.length <= 12_000_000)
                        .map((image, index) => ({ kind: 'image' as const, name: `window-${index + 1}`, mimeType: image.mimeType === 'image/png' ? 'image/png' as const : image.mimeType === 'image/jpeg' ? 'image/jpeg' as const : 'image/webp' as const, dataBase64: image.data })) } : {}) };
            });
        }
    }

    /**
     * Tabs the AI opens above the conversation. A tab holds one app window as a surface of its own: on macOS it
     * is kept off the user's screens, the user watches it live and may enable their mouse or its sound there.
     * It is operated with the same computer.* tools, by the pid and windowId the tab reports.
     */
    private registerTabTools(registry: AgentToolRegistry, conversationId: string): void {
        const tools: readonly { action: DesktopTabAction; name: string; title: string; description: string; read: boolean;
            properties: Readonly<Record<string, unknown>>; required: readonly string[] }[] = [
            { action: 'tabOpenApp', name: 'tabs.open_app', title: 'Open app in tab', read: false, required: ['app'],
                properties: { app: { type: 'string', minLength: 1, maxLength: 256 } },
                description: 'Open an app (its name in any language, e.g. "WeChat" or its localized name, or its bundle id / program name) in its own tab above this conversation and return its tabId, pid and windowId. '
                    + 'For a browser, use this only when the user attached it with [App: ...], explicitly selected its existing app tab, or explicitly requested a browser app tab above the conversation. Ordinary browser/link/search requests, including just naming Chrome, Safari or Edge, use browser.open and the saved browser choice. '
                    + 'If the app already has a live tab in this conversation, nothing is opened again: that tab is shown and the result says alreadyOpen: true (tell the user it was already open). A tab whose app has quit (disconnected) is replaced by a fresh one. '
                    + 'Use a tab for an app you work in for the user: it runs apart from their desktop (on macOS off their screens) and they watch it live in the tab. '
                    + 'See it with tabs.screenshot and act with tabs.click / tabs.drag / tabs.scroll / tabs.key / tabs.type (only supported window-scoped actions; games/canvas may return background_unsupported), or with computer.observe_window / computer.click … on that pid and windowId when the app has accessible controls. '
                    + 'Supported actions can target an unselected tab; this is not a guarantee for every application or canvas. '
                    + 'To act on the user\'s own desktop instead, use computer.* on its windows directly; that never opens a tab.' },
            { action: 'tabList', name: 'tabs.list', title: 'List conversation tabs', read: true, required: [], properties: {},
                description: 'List the tabs of this conversation with their tabId, title, appId, kind, pid and windowId, whether the app still runs (status connected / disconnected), where its window shows (placement: "tab" = only in the tab, "desktop" = also on the user\'s desktop), whether its sound is on, whether the user\'s keyboard & mouse are allowed (keyboardMouse), and which tab the user is looking at.' },
            { action: 'tabSet', name: 'tabs.set', title: 'Update tab settings', read: false, required: ['tabId'],
                properties: { tabId: { type: 'string', minLength: 1, maxLength: 200 }, sound: { type: 'boolean' }, keyboardMouse: { type: 'boolean' },
                    placement: { type: 'string', enum: ['tab', 'desktop'] } },
                description: 'Change a tab\'s switches, the same ones the user has at the top of the tab, when the user asks: sound (true = the app may play sound, false = muted), keyboardMouse (true = the user may click and type inside the tab; false = only you and plugins drive it through the tab, while a window on the desktop can always be used directly on the desktop), placement ("tab" = the window runs only inside the tab, off the user\'s desktop, macOS only; "desktop" = it also shows on the user\'s desktop). Give only the switches to change. Returns the tab\'s switches afterwards; tell the user what changed.' },
            { action: 'tabShow', name: 'tabs.show', title: 'Show tab', read: false, required: ['tabId'],
                properties: { tabId: { type: 'string', minLength: 1, maxLength: 200 } },
                description: 'Show a tab of this conversation to the user (use "conversation" to go back to the conversation itself).' },
            { action: 'tabScreenshot', name: 'tabs.screenshot', title: 'Inspect tab screenshot', read: true, required: ['tabId'],
                properties: { tabId: { type: 'string', minLength: 1, maxLength: 200 }, maxSize: { type: 'integer', minimum: 256, maximum: 2048 } },
                description: 'A picture of the app window in a tab, from the system\'s window capture (any app, games included; no accessibility needed). Returns the image with its width and height; tabs.click, tabs.drag and tabs.scroll take coordinates in this image\'s pixels.' },
            { action: 'tabClick', name: 'tabs.click', title: 'Click in tab', read: false, required: ['tabId', 'x', 'y'],
                properties: { tabId: { type: 'string', minLength: 1, maxLength: 200 }, x: { type: 'number', minimum: 0 }, y: { type: 'number', minimum: 0 }, double: { type: 'boolean' }, button: { type: 'string', enum: ['left', 'right'], default: 'left' }, delivery: { type: 'string', enum: ['auto', 'background'], default: 'background' } },
                description: 'Click in a tab\'s app window at x, y (pixels of the latest tabs.screenshot of that tab). button is left (default) or right. The click goes to the window in the background (delivery auto): no system mouse/keyboard fallback is used. On macOS supported AX controls can act; an editable field click selects the typing target without positioning its caret. If the app ignores it or returns background_unsupported, report the unsupported action; never retry through global mouse or keyboard input. Take a new screenshot afterwards to see the result.' },
            { action: 'tabDrag', name: 'tabs.drag', title: 'Drag in tab', read: false, required: ['tabId', 'from', 'to'],
                properties: { tabId: { type: 'string', minLength: 1, maxLength: 200 },
                    from: { type: 'object', additionalProperties: false, required: ['x', 'y'], properties: { x: { type: 'number', minimum: 0 }, y: { type: 'number', minimum: 0 } } },
                    to: { type: 'object', additionalProperties: false, required: ['x', 'y'], properties: { x: { type: 'number', minimum: 0 }, y: { type: 'number', minimum: 0 } } },
                    durationMs: { type: 'integer', minimum: 50, maximum: 2000, default: 300 } },
                description: 'Hold the left mouse button and drag from {x, y} to {x, y} in a tab\'s app. Both points are pixels of that tab\'s latest tabs.screenshot. durationMs is 50–2000 ms (default 300). Current macOS/Windows adapters return background_unsupported for drag; never use global input as a fallback.' },
            { action: 'tabScroll', name: 'tabs.scroll', title: 'Scroll in tab', read: false, required: ['tabId', 'x', 'y', 'direction'],
                properties: { tabId: { type: 'string', minLength: 1, maxLength: 200 }, x: { type: 'number', minimum: 0 }, y: { type: 'number', minimum: 0 },
                    direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'integer', minimum: 1, maximum: 10 }, delivery: { type: 'string', enum: ['auto', 'background'], default: 'background' } },
                description: 'Scroll in a tab\'s app window at x, y (pixels of the latest tabs.screenshot). Background delivery like tabs.click; Unsupported actions return an error; foreground fallback is unavailable.' },
            { action: 'tabKey', name: 'tabs.key', title: 'Press key in tab', read: false, required: ['tabId'],
                properties: { tabId: { type: 'string', minLength: 1, maxLength: 200 }, key: { type: 'string', minLength: 1, maxLength: 24 },
                    keys: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 24 } },
                    modifiers: { type: 'array', maxItems: 4, uniqueItems: true, items: { type: 'string', enum: ['cmd', 'ctrl', 'alt', 'shift'] } }, holdMs: { type: 'integer', minimum: 0, maximum: 3000, default: 0 }, delivery: { type: 'string', enum: ['auto', 'background'], default: 'background' } },
                description: 'Press key OR simultaneously hold keys (1–4 distinct keys), never both. holdMs is 0–3000 ms (default 0; positive durations require a supported background adapter); all keys are released afterwards. Unsupported held or simultaneous input returns an explicit error. Keys: a–z, 0–9, enter, tab, space, escape, backspace, delete, up, down, left, right, home, end, pageup, pagedown, f1–f12 and punctuation. ctrl, alt, shift and cmd can be pressed alone or included in keys; modifiers can accompany the key(s).' },
            { action: 'tabType', name: 'tabs.type', title: 'Type in tab', read: false, required: ['tabId', 'text'],
                properties: { tabId: { type: 'string', minLength: 1, maxLength: 200 }, text: { type: 'string', minLength: 1, maxLength: 2000 }, delivery: { type: 'string', enum: ['auto', 'background'], default: 'background' } },
                description: 'Type text into the focused field of a tab\'s app (click the field first). Background delivery like tabs.click; macOS inserts through AXSelectedText into the selected field when supported; Unsupported actions return an error; foreground fallback is unavailable.' },
            { action: 'tabClose', name: 'tabs.close', title: 'Close tab', read: false, required: ['tabId'],
                properties: { tabId: { type: 'string', minLength: 1, maxLength: 200 } },
                description: 'Close a tab of this conversation. An app NextMux opened for the tab quits (or goes back to the desktop, as the user chose in Settings); an app the user already had open goes back to their desktop.' },
            // Skill plugins (技能插件): fast decision loops the user installed for particular apps, mostly games.
            { action: 'pluginList', name: 'plugins.list', title: 'List skill plugins', read: true, required: [], properties: {},
                description: 'List the skill plugins the user installed: id, name, what it does, the apps it works with (bundle ids / program names), example goals, whether it is ready (has a decision model), and the plugin runs of this conversation (runId, tabId, state). '
                    + 'A skill plugin drives one app in a tab quickly with a fast decision model (such as Jev), following the plugin\'s own rules; use one only when the user asks for it or for the long, repetitive play it was made for.' },
            { action: 'pluginStart', name: 'plugins.start', title: 'Start skill plugin', read: false, required: ['tabId', 'plugin'],
                properties: { tabId: { type: 'string', minLength: 1, maxLength: 200 }, plugin: { type: 'string', minLength: 3, maxLength: 100 }, goal: { type: 'string', maxLength: 400 },
                    params: { type: 'object', additionalProperties: true },
                    maxMinutes: { type: 'integer', minimum: 1, maximum: 1440 }, maxCostUsd: { type: 'number', exclusiveMinimum: 0, maximum: 100 } },
                description: 'Start a skill plugin on a tab whose app it is made for, with a goal in the user\'s words (e.g. "level up to 30, drink a potion when health is low") and optional params (plugin parameter values or local .txt/.md file paths). '
                    + 'The user confirms in a dialog and may change the goal, parameters, the time and spending limits, or choose a dry run: wait for the answer. Returns the runId. '
                    + 'While a plugin runs on a tab, do not click or press keys in that tab yourself. Follow it with plugins.status, change its goal/params or resume it after a pause with plugins.command, and end it with plugins.stop.' },
            { action: 'pluginCommand', name: 'plugins.command', title: 'Update skill plugin', read: false, required: ['runId'],
                properties: { runId: { type: 'string', minLength: 1, maxLength: 80 }, goal: { type: 'string', maxLength: 400 }, params: { type: 'object', additionalProperties: true }, resume: { type: 'boolean' }, pause: { type: 'boolean' } },
                description: 'Give a running plugin a new goal or updated params, resume it after it paused on an event (resume: true), or pause it (pause: true).' },
            { action: 'pluginStatus', name: 'plugins.status', title: 'Read skill plugin status', read: true, required: ['runId'],
                properties: { runId: { type: 'string', minLength: 1, maxLength: 80 }, waitMs: { type: 'integer', minimum: 0, maximum: 60000 } },
                description: 'A plugin run\'s state: goal, running / paused / ended (and why), elapsed time, spending, actions and decisions so far, the last decision, its current readings and its recent events. '
                    + 'With waitMs, wait up to that long for a new event or the end before answering, to supervise it without polling.' },
            { action: 'pluginStop', name: 'plugins.stop', title: 'Stop skill plugin', read: false, required: ['runId'],
                properties: { runId: { type: 'string', minLength: 1, maxLength: 80 } },
                description: 'Stop a plugin run at once; every held key is released.' }
        ];
        for (const tool of tools) {
            const inputSchema = { type: 'object', additionalProperties: false, properties: tool.properties, required: [...tool.required],
                ...(tool.action === 'tabKey' ? { oneOf: [{ required: ['key'] }, { required: ['keys'] }] } : {}) };
            // A tab tool's schema can differ with the host's capability: cache by the schema, not by the action name.
            const validatorKey = `tab:${JSON.stringify(inputSchema)}`;
            let validate = actionValidators.get(validatorKey);
            if (!validate) { validate = validator.compile(inputSchema); actionValidators.set(validatorKey, validate); }
            registry.register({ name: tool.name, description: tool.description, source: 'builtin', requiredPermission: tool.read ? 'read_only' : 'full_access',
                executionKind: tool.read ? 'read' : 'side_effect', inputSchema
            }, async (input, context): Promise<ToolHandlerResult> => {
                if (!validate!(input)) throw new AgentToolError('INVALID_TAB_INPUT', 'The arguments do not match this tool\'s schema.');
                const rawTabId = (input as Record<string, unknown>)?.tabId;
                const tabQueueKey = !tool.read && typeof rawTabId === 'string' && rawTabId ? `${conversationId}:${rawTabId}` : undefined;
                return this.enqueueByTab(tabQueueKey, async () => {
                    // Starting a plugin waits for the user's confirmation; a status call may wait for the next event.
                    const timeoutMs = tool.action === 'pluginStart' ? 300_000 : tool.action === 'pluginStatus' ? 75_000 : 45_000;
                    const result = await this.request({ id: `computer-${randomUUID()}`, conversationId, runId: context.runId, expiresAt: Date.now() + timeoutMs,
                        action: tool.action, input: input as Record<string, unknown> }, context.signal, timeoutMs);
                    if (!result.ok) {
                        const message = result.error === 'interrupted_by_user_esc' || result.error === 'computer_window_closed' || result.error === 'computer_element_unlocatable'
                            ? computerFailureMessage(result, tool.read)
                            : (result.error || 'The tab operation did not complete.');
                        throw new AgentToolError(tool.action.startsWith('plugin') ? 'PLUGIN_OPERATION_FAILED' : 'TAB_OPERATION_FAILED', message);
                    }
                    const images = (result.images || []).filter(image => ['image/png', 'image/jpeg'].includes(image.mimeType) && image.data.length <= 12_000_000).slice(0, 1);
                    return { modelOutput: result.output ?? { ok: true }, summary: { kind: tool.name, title: tool.title },
                        ...(images.length ? { attachments: images.map(image => ({ kind: 'image' as const, name: 'tab', mimeType: image.mimeType === 'image/png' ? 'image/png' as const : 'image/jpeg' as const, dataBase64: image.data })) } : {}) };
                });
            });
        }
    }

    private request(request: DesktopComputerToolRequest, signal?: AbortSignal, timeoutMs = 45_000): Promise<DesktopComputerToolResult> {
        if (this.closed || signal?.aborted) return Promise.resolve({ requestId: request.id, ok: false, error: 'COMPUTER_CANCELLED' });
        // Without the system permission the app asks the user for it and holds this call until it is granted, so the
        // model waits instead of telling the user what to click (the user takes a while in System Settings).
        if (this.capability && !this.capability.available
            && (this.capability.reason === 'permission_required' || this.capability.reason === 'worker_install_required')) {
            timeoutMs = Math.max(timeoutMs, COMPUTER_PERMISSION_WAIT_MS);
            request = { ...request, expiresAt: Math.max(request.expiresAt, Date.now() + COMPUTER_PERMISSION_WAIT_MS) };
        }
        if (this.pending.size >= 8) return Promise.resolve({ requestId: request.id, ok: false, error: 'COMPUTER_BUSY' });
        return new Promise(resolve => {
            const settle = (result: DesktopComputerToolResult): void => {
                if (!this.pending.delete(request.id)) return;
                clearTimeout(timer);
                signal?.removeEventListener('abort', cancel);
                resolve(result);
            };
            const cancel = (): void => settle({ requestId: request.id, ok: false, error: 'Cancelled. Input already sent may have taken effect: look at the window before acting again.' });
            const timer = setTimeout(() => settle({ requestId: request.id, ok: false, error: 'Timed out. Look at the window to check the result before repeating the action.' }), timeoutMs);
            this.pending.set(request.id, { request, settle });
            signal?.addEventListener('abort', cancel, { once: true });
            if (signal?.aborted) cancel();
        });
    }
}
