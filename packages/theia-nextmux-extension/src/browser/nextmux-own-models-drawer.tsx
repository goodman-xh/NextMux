import * as React from '@theia/core/shared/react';

/** Keep focus inside the API's model list while its catalogue refreshes. */
export function OwnModelsDrawer(props: {
    readonly label: string;
    readonly children: React.ReactNode;
    readonly onClose: () => void;
    readonly trapFocus: (event: React.KeyboardEvent<HTMLElement>) => void;
}): React.ReactElement {
    const panel = React.useRef<HTMLElement>(null);
    React.useLayoutEffect(() => {
        const element = panel.current;
        if (!element || element.contains(document.activeElement)) return;
        (element.querySelector<HTMLElement>('[data-own-models-close]') || element).focus({ preventScroll: true });
    }, []);
    return <div className='nmx-sheet-backdrop nmx-mc-drawer-backdrop' onMouseDown={event => {
        if (event.target === event.currentTarget) props.onClose();
    }}>
        <section ref={panel} tabIndex={-1} className='nmx-purchase-sheet nmx-official-sheet nmx-mc-drawer nmx-own-models-drawer'
            role='dialog' aria-modal='true' aria-label={props.label} onMouseDown={event => event.stopPropagation()}
            onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === 'Escape') {
                    event.preventDefault(); event.stopPropagation(); props.onClose();
                } else props.trapFocus(event);
            }}>
            {props.children}
        </section>
    </div>;
}
