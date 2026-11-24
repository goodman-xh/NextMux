import * as React from '@theia/core/shared/react';

// Input identity, rather than focus, records compositions that began before mic startup.
const composingInputs = new WeakSet<HTMLInputElement | HTMLTextAreaElement>();
export const isImeFieldComposing = (input: HTMLInputElement | HTMLTextAreaElement): boolean => composingInputs.has(input);

function createSyntheticChangeEvent<T extends HTMLInputElement | HTMLTextAreaElement>(target: T): React.ChangeEvent<T> {
    return { target, currentTarget: target, type: 'change' } as unknown as React.ChangeEvent<T>;
}

/**
 * Text fields whose value lives on the widget (`value={this.x}` + `this.update()`).
 *
 * The widget re-renders on the next frame, not inside React's input event, so a plain
 * controlled field is reset to the old value by React right after every keystroke. Latin
 * typing hides it, but an input method (Chinese, Japanese, Korean…) loses its composition and
 * commits the raw pinyin ("nninihniha…"). These fields keep the typed value in React state, so
 * React never resets it, and adopt a new value from the owner when it really changes (reset,
 * AI fill) unless the user is in the middle of composing.
 *
 * While an IME composition is active (`composing.current === true`), intermediate `onChange`
 * events update only local state and are never forwarded to the parent; `onCompositionEnd`
 * commits the finalized string immediately to the parent. When `commitDelayMs > 0`, non-IME
 * parent notifications are debounced and flushed synchronously on blur, unmount, or (for
 * single-line inputs) Enter/Escape.
 */
function useImeSafeValue<T extends HTMLInputElement | HTMLTextAreaElement>(
    value: string | number | readonly string[] | undefined,
    onChange: React.ChangeEventHandler<T> | undefined,
    onCompositionStart: React.CompositionEventHandler<T> | undefined,
    onCompositionEnd: React.CompositionEventHandler<T> | undefined,
    onBlur: React.FocusEventHandler<T> | undefined,
    onKeyDown: React.KeyboardEventHandler<T> | undefined,
    commitDelayMs: number | undefined,
    flushOnEnterEscape: boolean
): Pick<
    React.InputHTMLAttributes<T>,
    'value' | 'onChange' | 'onCompositionStart' | 'onCompositionEnd' | 'onBlur' | 'onKeyDown'
> {
    const incoming = value === undefined || value === null ? '' : String(value);
    const [local, setLocal] = React.useState(incoming);
    const [seen, setSeen] = React.useState(incoming);
    const composing = React.useRef(false);
    const onChangeRef = React.useRef(onChange);
    onChangeRef.current = onChange;
    const timerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const pendingTargetRef = React.useRef<T | undefined>(undefined);
    const lastCommittedRef = React.useRef<string | undefined>(undefined);

    const clearPendingTimer = (): void => {
        if (timerRef.current !== undefined) {
            clearTimeout(timerRef.current);
            timerRef.current = undefined;
        }
    };

    const flushPending = React.useCallback((): void => {
        if (composing.current) return;
        clearPendingTimer();
        const pendingTarget = pendingTargetRef.current;
        pendingTargetRef.current = undefined;
        if (!pendingTarget) return;
        lastCommittedRef.current = pendingTarget.value;
        onChangeRef.current?.(createSyntheticChangeEvent(pendingTarget));
    }, []);

    if (incoming !== seen) {
        setSeen(incoming);
        if (!composing.current) {
            const isAckOfLastCommit = pendingTargetRef.current !== undefined && incoming === lastCommittedRef.current;
            if (!isAckOfLastCommit) {
                clearPendingTimer();
                pendingTargetRef.current = undefined;
                lastCommittedRef.current = undefined;
                setLocal(incoming);
            }
        }
    }

    React.useEffect(() => () => flushPending(), [flushPending]);

    return {
        value: local,
        onChange: event => {
            const target = event.currentTarget;
            const nextValue = target.value;
            setLocal(nextValue);
            if (composing.current) return;
            const delay = typeof commitDelayMs === 'number' && commitDelayMs > 0 ? commitDelayMs : 0;
            if (delay <= 0) {
                clearPendingTimer();
                pendingTargetRef.current = undefined;
                lastCommittedRef.current = nextValue;
                onChange?.(event);
                return;
            }
            pendingTargetRef.current = target;
            clearPendingTimer();
            timerRef.current = setTimeout(() => {
                timerRef.current = undefined;
                const pendingTarget = pendingTargetRef.current;
                pendingTargetRef.current = undefined;
                if (!pendingTarget || composing.current) return;
                lastCommittedRef.current = pendingTarget.value;
                onChangeRef.current?.(createSyntheticChangeEvent(pendingTarget));
            }, delay);
        },
        onCompositionStart: event => {
            composing.current = true;
            if (event.currentTarget) composingInputs.add(event.currentTarget);
            clearPendingTimer();
            pendingTargetRef.current = undefined;
            onCompositionStart?.(event);
        },
        onCompositionEnd: event => {
            const target = event.currentTarget;
            composing.current = false;
            if (target) composingInputs.delete(target);
            clearPendingTimer();
            pendingTargetRef.current = undefined;
            const nextValue = target?.value ?? '';
            setLocal(nextValue);
            setSeen(incoming);
            lastCommittedRef.current = nextValue;
            onCompositionEnd?.(event);
            if (target) onChangeRef.current?.(createSyntheticChangeEvent(target));
        },
        onBlur: event => {
            flushPending();
            onBlur?.(event);
        },
        onKeyDown: event => {
            if (flushOnEnterEscape && !composing.current && (event.key === 'Enter' || event.key === 'Escape')) {
                flushPending();
            }
            onKeyDown?.(event);
        }
    };
}

/**
 * What people type here is prompts, names, paths, keys and code, not prose to proofread: no spelling underline, no
 * autocorrect and no automatic capitals unless a field asks for them.
 */
const PLAIN_TEXT_ENTRY = { spellCheck: false, autoCorrect: 'off', autoCapitalize: 'off' } as const;

export interface ImeInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    readonly commitDelayMs?: number;
}

export interface ImeTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    readonly commitDelayMs?: number;
}

export const ImeInput = React.forwardRef<HTMLInputElement, ImeInputProps>(function ImeInput(props, ref) {
    const { value, onChange, onCompositionStart, onCompositionEnd, onBlur, onKeyDown, commitDelayMs, ...rest } = props;
    return <input ref={ref} {...PLAIN_TEXT_ENTRY} {...rest} {...useImeSafeValue(value, onChange, onCompositionStart, onCompositionEnd, onBlur, onKeyDown, commitDelayMs, true)} />;
});

export const ImeTextarea = React.forwardRef<HTMLTextAreaElement, ImeTextareaProps>(function ImeTextarea(props, ref) {
    const { value, onChange, onCompositionStart, onCompositionEnd, onBlur, onKeyDown, commitDelayMs, ...rest } = props;
    return <textarea ref={ref} {...PLAIN_TEXT_ENTRY} {...rest} {...useImeSafeValue(value, onChange, onCompositionStart, onCompositionEnd, onBlur, onKeyDown, commitDelayMs, false)} />;
});
