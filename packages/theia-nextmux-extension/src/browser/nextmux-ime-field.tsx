import * as React from '@theia/core/shared/react';

// Input identity, rather than focus, records compositions that began before mic startup.
const composingInputs = new WeakSet<HTMLInputElement | HTMLTextAreaElement>();
export const isImeFieldComposing = (input: HTMLInputElement | HTMLTextAreaElement): boolean => composingInputs.has(input);

/**
 * Text fields whose value lives on the widget (`value={this.x}` + `this.update()`).
 *
 * The widget re-renders on the next frame, not inside React's input event, so a plain
 * controlled field is reset to the old value by React right after every keystroke. Latin
 * typing hides it, but an input method (Chinese, Japanese, Korean…) loses its composition and
 * commits the raw pinyin ("nninihniha…"). These fields keep the typed value in React state, so
 * React never resets it, and adopt a new value from the owner when it really changes (reset,
 * AI fill) unless the user is in the middle of composing.
 */
function useImeSafeValue<T extends HTMLInputElement | HTMLTextAreaElement>(
    value: string | number | readonly string[] | undefined,
    onChange: React.ChangeEventHandler<T> | undefined,
    onCompositionStart: React.CompositionEventHandler<T> | undefined,
    onCompositionEnd: React.CompositionEventHandler<T> | undefined
): Pick<React.InputHTMLAttributes<T>, 'value' | 'onChange' | 'onCompositionStart' | 'onCompositionEnd'> {
    const incoming = value === undefined || value === null ? '' : String(value);
    const [local, setLocal] = React.useState(incoming);
    const [seen, setSeen] = React.useState(incoming);
    const composing = React.useRef(false);
    if (incoming !== seen) {
        setSeen(incoming);
        if (!composing.current) setLocal(incoming);
    }
    return {
        value: local,
        onChange: event => { setLocal(event.currentTarget.value); onChange?.(event); },
        onCompositionStart: event => { composing.current = true; composingInputs.add(event.currentTarget); onCompositionStart?.(event); },
        onCompositionEnd: event => {
            composing.current = false;
            composingInputs.delete(event.currentTarget);
            setLocal(event.currentTarget.value);
            setSeen(incoming);
            onCompositionEnd?.(event);
        }
    };
}

export const ImeInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function ImeInput(props, ref) {
    const { value, onChange, onCompositionStart, onCompositionEnd, ...rest } = props;
    return <input ref={ref} {...rest} {...useImeSafeValue(value, onChange, onCompositionStart, onCompositionEnd)} />;
});

export const ImeTextarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function ImeTextarea(props, ref) {
    const { value, onChange, onCompositionStart, onCompositionEnd, ...rest } = props;
    return <textarea ref={ref} {...rest} {...useImeSafeValue(value, onChange, onCompositionStart, onCompositionEnd)} />;
});
