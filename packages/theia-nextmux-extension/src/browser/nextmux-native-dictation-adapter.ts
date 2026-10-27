import type { NativeDictationBridge, NativeDictationCapability, NativeDictationEvent } from '../common/nextmux-native-dictation';

export type NativeDictationPhase = 'starting' | 'listening' | 'finishing' | 'ended' | 'unavailable' | 'error';
export interface DictationDraftOwner {
    /** Undefined means the original conversation/question no longer owns the field. */
    read(): string | undefined;
    write(value: string): void;
    /** Prevent a native write from replacing an already active IME composition. */
    isComposing?(): boolean;
    /** Receives each transcript update after it is written; callers should
     * only execute commands when `final` is true. */
    onTranscript?(transcript: string, final: boolean): void;
    readonly input: HTMLTextAreaElement;
}

/** One local native session, one explicit draft owner. Never calls a submit API. */
export class NativeDictationAdapter {
    protected disposed = false;
    protected startRequested = false;
    protected started = false;
    protected unsubscribe?: () => void;
    protected watchdog?: ReturnType<typeof setInterval>;
    protected phase: NativeDictationPhase = 'starting';
    protected expected: string;
    protected lastFinalTranscript?: string;
    protected level = 0;
    protected lastLevelAt = -Infinity;
    protected staleLevelTimer?: ReturnType<typeof setTimeout>;
    protected readonly prefix: string;
    protected readonly suffix: string;
    protected caretFrame?: number;
    protected caretView?: Window;
    protected caretRevision = 0;
    protected static readonly NON_EDIT_KEYS = new Set([
        'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock', 'Hyper', 'Super', 'Symbol',
        'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'
    ]);
    protected readonly cancelCaretOnEdit = (): void => this.clearCaret();
    protected readonly cancelOnEdit = (event?: Event): void => {
        if (event && event.type === 'pointerdown') {
            this.clearCaret();
            return;
        }
        if (event && typeof (event as KeyboardEvent).key === 'string'
            && NativeDictationAdapter.NON_EDIT_KEYS.has((event as KeyboardEvent).key)) {
            this.clearCaret();
            return;
        }
        this.cancel();
    };
    protected readonly edits = ['input', 'compositionstart', 'keydown'] as const;
    protected readonly caretEdits = ['input', 'compositionstart', 'keydown', 'pointerdown'] as const;

    constructor(protected readonly bridge: Partial<NativeDictationBridge> | undefined,
        protected readonly owner: DictationDraftOwner, protected readonly locale: string,
        protected readonly id: string, protected readonly onPhase: (phase: NativeDictationPhase) => void,
        protected readonly onLevel: (level: number) => void = () => undefined,
        protected readonly deviceId?: string) {
        this.locale = ({ en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ru: 'ru-RU', ar: 'ar-SA', hi: 'hi-IN' } as Record<string, string>)[locale] || locale;
        this.expected = owner.read() || '';
        const start = Math.max(0, Math.min(owner.input.selectionStart, this.expected.length));
        // Dictation inserts into the existing draft. A selected range is retained
        // rather than silently deleting text when this input mic starts.
        this.prefix = this.expected.slice(0, start);
        this.suffix = this.expected.slice(start);
    }

    get active(): boolean { return !this.disposed; }
    protected current(): boolean { return this.owner.input.isConnected && !this.owner.isComposing?.() && this.owner.read() === this.expected; }
    protected publish(phase: NativeDictationPhase): void {
        this.phase = phase;
        if (phase !== 'listening') this.clearLevel();
        this.onPhase(phase);
    }
    protected setLevel(value: number, freshPositive = false): void {
        // Each accepted measured positive packet can drive one local ripple,
        // even when normalization/clipping yields the same intensity again.
        // Repeated zero does not paint, and no timer invents positive sound.
        if (this.level === value && !freshPositive) return;
        this.level = value;
        try { this.onLevel(value); } catch { this.cancel(); }
    }
    protected clearLevel(): void {
        if (this.staleLevelTimer) clearTimeout(this.staleLevelTimer);
        this.staleLevelTimer = undefined;
        this.setLevel(0);
    }

    protected clearCaret(): void {
        this.caretRevision++;
        if (this.caretFrame !== undefined) this.caretView?.cancelAnimationFrame(this.caretFrame);
        this.caretFrame = undefined;
        this.caretView = undefined;
        for (const event of this.caretEdits) this.owner.input.removeEventListener?.(event, this.cancelCaretOnEdit);
        this.owner.input.ownerDocument?.removeEventListener?.('pointerdown', this.cancelCaretOnEdit, true);
    }

    /** Move only the owned selection after React has rendered the accepted draft. */
    protected followCaret(position: number): void {
        this.clearCaret();
        const input = this.owner.input, view = input.ownerDocument?.defaultView;
        if (!view?.requestAnimationFrame || typeof input.setSelectionRange !== 'function') return;
        const expected = this.expected, revision = this.caretRevision;
        this.caretView = view;
        // These short-lived listeners also protect a final result rendered just
        // after the native end event removed the recording listeners.
        for (const event of this.caretEdits) input.addEventListener?.(event, this.cancelCaretOnEdit);
        input.ownerDocument?.addEventListener?.('pointerdown', this.cancelCaretOnEdit, true);
        let frames = 0;
        const apply = (): void => {
            this.caretFrame = undefined;
            if (revision !== this.caretRevision) return;
            if (!input.isConnected || input.disabled || input.readOnly || this.owner.isComposing?.()
                || this.owner.read() !== expected) { this.clearCaret(); return; }
            if (input.value !== expected) {
                if (++frames < 3) this.caretFrame = view.requestAnimationFrame(apply);
                else this.clearCaret();
                return;
            }
            try { input.setSelectionRange(position, position); }
            finally { this.clearCaret(); }
        };
        this.caretFrame = view.requestAnimationFrame(apply);
    }

    async start(): Promise<void> {
        if (this.disposed || this.startRequested) return;
        this.startRequested = true;
        this.publish('starting');
        if (this.disposed) return;
        if (!this.current()) { this.cancel(); return; }
        // Install draft cancellation before an asynchronous capability probe.
        // Blur alone does not change the captured logical owner.
        for (const event of this.edits) this.owner.input.addEventListener(event, this.cancelOnEdit);
        this.watchdog = setInterval(() => { if (!this.current()) this.cancel(); }, 250);
        const bridge = this.bridge;
        if (!bridge?.getSpeechCapability || !bridge.startSpeech || !bridge.finishSpeech || !bridge.cancelSpeech || !bridge.onSpeechEvent) {
            this.end('unavailable'); return;
        }
        // No Web Speech probe here: Electron 42 can kill its renderer merely
        // checking processLocally. Native capability checks never record audio.
        let capability: NativeDictationCapability;
        try { capability = await bridge.getSpeechCapability(this.locale); }
        catch { if (!this.disposed) this.end('unavailable'); return; }
        if (this.disposed) return;
        if (!this.current()) { this.cancel(); return; }
        if (!capability?.localOnly || !['macos-speech', 'windows-system-speech'].includes(capability.engine)
            || !['ready', 'permission-required'].includes(capability.status)) { this.end('unavailable'); return; }
        this.unsubscribe = bridge.onSpeechEvent(event => this.receive(event));
        this.started = true;
        try {
            const accepted = await bridge.startSpeech({
                sessionId: this.id,
                locale: this.locale,
                ...(this.deviceId ? { deviceId: this.deviceId } : {})
            });
            if (this.disposed) { if (accepted) void bridge.cancelSpeech(this.id).catch(() => undefined); return; }
            if (!accepted) this.end('error');
        } catch { if (!this.disposed) this.end('error'); }
    }

    protected receive(event: NativeDictationEvent): void {
        if (this.disposed || event.sessionId !== this.id) return;
        if (!this.current()) { this.cancel(); return; }
        if (event.type === 'listening' && this.phase !== 'finishing') this.publish('listening');
        else if (event.type === 'level') {
            if (this.phase !== 'listening') return;
            const clampedValue = Number.isFinite(event.value) ? Math.max(0, Math.min(1, event.value)) : 0;
            const now = performance.now();
            if (now - this.lastLevelAt < 100) return;
            this.lastLevelAt = now;
            if (this.staleLevelTimer) clearTimeout(this.staleLevelTimer);
            // No positive silence floor. A lost stream cannot leave fake sound.
            const level = clampedValue <= .025 ? 0 : clampedValue;
            this.setLevel(level, level > 0);
            if (this.level > 0) this.staleLevelTimer = setTimeout(() => this.clearLevel(), 300);
        } else if (event.type === 'transcript') {
            if (typeof event.text !== 'string') { this.cancel(); return; }
            // Helpers publish a cumulative session transcript. An empty native
            // completion after silence/finish must not erase already heard text.
            if (!event.text.trim()) return;
            const maxInsert = Math.max(0, 10000 - this.prefix.length - this.suffix.length);
            const overLimit = event.text.length > maxInsert;
            if (overLimit) {
                if (maxInsert <= 0) { this.finish(); return; }
                event = { ...event, text: event.text.slice(0, maxInsert) };
            }
            const value = this.prefix + event.text + this.suffix;
            const changed = value !== this.expected;
            const newlyFinal = event.final && this.lastFinalTranscript !== event.text;
            if (!changed && !newlyFinal) return;
            this.expected = value;
            if (event.final) this.lastFinalTranscript = event.text;
            try {
                if (changed) { this.owner.write(value); this.followCaret(this.prefix.length + event.text.length); }
                this.owner.onTranscript?.(event.text, event.final);
            }
            catch { this.end('error'); return; }
            if (overLimit) this.finish();
        } else if (event.type === 'end') {
            this.end(['completed', 'stopped', 'cancelled'].includes(event.reason) ? 'ended' : 'error');
        }
    }

    finish(): void {
        if (this.disposed || this.phase === 'finishing') return;
        if (!this.started) { this.cancel(); return; }
        this.publish('finishing');
        void this.bridge?.finishSpeech?.(this.id).then(accepted => {
            if (!accepted && !this.disposed) this.end('error');
        }).catch(() => { if (!this.disposed) this.end('error'); });
    }

    cancel(): void {
        this.clearCaret();
        if (this.disposed) return;
        this.end('ended');
    }

    protected end(phase: NativeDictationPhase): void {
        if (this.disposed) return;
        this.disposed = true;
        if (phase !== 'ended') this.clearCaret();
        this.unsubscribe?.();
        if (this.watchdog) clearInterval(this.watchdog);
        this.clearLevel();
        for (const event of this.edits) this.owner.input.removeEventListener(event, this.cancelOnEdit);
        if (this.started) void this.bridge?.cancelSpeech?.(this.id).catch(() => undefined);
        this.publish(phase);
    }
}
