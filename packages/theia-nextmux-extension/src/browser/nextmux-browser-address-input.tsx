import * as React from '@theia/core/shared/react';

interface Props {
    /** The page's current address. */
    readonly url: string;
    readonly placeholder: string;
    readonly label: string;
    /** Enter: open what was typed (the caller normalizes it into an address or a search). */
    readonly onNavigate: (value: string) => void;
    readonly inputRef?: (node: HTMLInputElement | null) => void;
}
interface State { readonly draft: string; readonly editing: boolean }

/**
 * The browser address bar. While it has focus, what the person types is a local draft: one small component renders
 * per key (not the workbench), and the page's own address changes (redirects, SPA history) never overwrite it.
 * Without focus it shows the page's address. Focusing selects the whole address, Escape restores it and leaves the
 * field, Enter opens what was typed. Keyed by tab, never by URL, so it is never remounted under the caret.
 */
export class NextMuxBrowserAddressInput extends React.PureComponent<Props, State> {
    override state: State = { draft: this.props.url, editing: false };
    private input: HTMLInputElement | null = null;
    private selectOnMouseUp = false;

    static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
        return state.editing || state.draft === props.url ? null : { draft: props.url };
    }

    /** Focus and select the address (Cmd/Ctrl+L). */
    focusAndSelect(): void {
        if (!this.input) return;
        this.input.focus();
        this.input.select();
    }

    private readonly bind = (node: HTMLInputElement | null): void => {
        this.input = node;
        this.props.inputRef?.(node);
    };

    private readonly focused = (event: React.FocusEvent<HTMLInputElement>): void => {
        this.setState({ editing: true });
        // A click would collapse the selection on mouse-up: select there instead, once (as browsers do).
        this.selectOnMouseUp = true;
        event.currentTarget.select();
    };

    private readonly mouseUp = (event: React.MouseEvent<HTMLInputElement>): void => {
        if (!this.selectOnMouseUp) return;
        this.selectOnMouseUp = false;
        if (event.currentTarget.selectionStart === event.currentTarget.selectionEnd) {
            event.preventDefault();
            event.currentTarget.select();
        }
    };

    private readonly blurred = (): void => {
        this.selectOnMouseUp = false;
        this.setState({ editing: false, draft: this.props.url });
    };

    private readonly changed = (event: React.ChangeEvent<HTMLInputElement>): void => {
        this.selectOnMouseUp = false;
        this.setState({ draft: event.currentTarget.value, editing: true });
    };

    private readonly keyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter') {
            event.preventDefault();
            const value = this.state.draft.trim();
            this.setState({ editing: false, draft: value ? this.state.draft : this.props.url });
            if (value) this.props.onNavigate(value);
            event.currentTarget.blur();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.setState({ editing: false, draft: this.props.url });
            event.currentTarget.blur();
        }
    };

    override render(): React.ReactNode {
        return <input ref={this.bind} name='url' type='text' spellCheck={false} autoComplete='off' autoCorrect='off' autoCapitalize='off'
            enterKeyHint='go' value={this.state.draft} placeholder={this.props.placeholder} aria-label={this.props.label} title={this.state.editing ? undefined : this.props.url}
            onFocus={this.focused} onBlur={this.blurred} onChange={this.changed} onKeyDown={this.keyDown} onMouseUp={this.mouseUp} />;
    }
}
