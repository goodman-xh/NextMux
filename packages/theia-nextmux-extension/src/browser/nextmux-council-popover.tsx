import * as React from 'react';
import { createPortal } from '@theia/core/shared/react-dom';

/** Keep menus inside the dialog's visible body, clear of its title and actions. */
export function councilPopoverPlacement(anchor: { left: number; top: number; bottom: number; width: number },
    bounds: { left: number; top: number; width: number; bottom: number }, preferredWidth: number, preferredHeight = 264) {
    const gap = 6;
    const width = Math.max(0, Math.min(preferredWidth, bounds.width));
    const left = Math.max(bounds.left, Math.min(anchor.left, bounds.left + bounds.width - width));
    const height = Math.max(0, bounds.bottom - bounds.top);
    const below = Math.min(height, Math.max(0, bounds.bottom - anchor.bottom - gap));
    const above = Math.min(height, Math.max(0, anchor.top - bounds.top - gap));
    const up = above > below;
    const maxHeight = Math.min(preferredHeight, 264, Math.max(above, below));
    const top = up ? anchor.top - gap - maxHeight : anchor.bottom + gap;
    return { left, top: Math.max(bounds.top, Math.min(top, bounds.bottom - maxHeight)),
        width, maxHeight, up };
}

export const CouncilPopover: React.FC<{
    readonly dialog: React.RefObject<HTMLElement>;
    readonly anchor: React.RefObject<HTMLDivElement>;
    readonly kind: 'model' | 'role' | 'relay';
    readonly slotId?: string;
    readonly label?: string;
    readonly onDismiss: () => void;
    readonly children: React.ReactNode;
}> = ({ dialog, anchor, kind, slotId, label, onDismiss, children }) => {
    const menu = React.useRef<HTMLDivElement>(null);
    const [placement, setPlacement] = React.useState<ReturnType<typeof councilPopoverPlacement>>();
    const positioned = Boolean(placement);
    React.useEffect(() => {
        const outside = (event: PointerEvent): void => {
            if (event.target instanceof Element && event.target.closest('.nmx-model-effort-portal')) return;
            if (event.target instanceof Node && !menu.current?.contains(event.target) && !anchor.current?.contains(event.target)) onDismiss();
        };
        const escape = (event: KeyboardEvent): void => {
            if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
            event.preventDefault(); event.stopPropagation(); onDismiss();
            anchor.current?.querySelector('button')?.focus({ preventScroll: true });
        };
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('keydown', escape, true);
        return () => {
            document.removeEventListener('pointerdown', outside, true);
            document.removeEventListener('keydown', escape, true);
        };
    }, [anchor, onDismiss]);
    React.useEffect(() => {
        if (positioned && kind !== 'relay') {
            const selected = menu.current?.querySelector<HTMLElement>('[aria-selected="true"], [aria-checked="true"]')
                ?? menu.current?.querySelector<HTMLElement>('button');
            selected?.focus({ preventScroll: true });
            if (selected && menu.current) {
                menu.current.scrollTop = Math.max(0, selected.offsetTop - menu.current.clientHeight / 2 + selected.offsetHeight / 2);
            }
        }
    }, [kind, positioned]);
    React.useLayoutEffect(() => {
        const root = dialog.current;
        const control = anchor.current;
        if (!root || !control) return;
        const update = () => {
            const rect = root.getBoundingClientRect();
            const header = root.querySelector(':scope > header')!.getBoundingClientRect();
            const footer = root.querySelector(':scope > footer')!.getBoundingClientRect();
            const trigger = control.querySelector('button')!.getBoundingClientRect();
            const result = councilPopoverPlacement(trigger,
                { left: rect.left + 16, top: header.bottom + 6, width: rect.width - 32, bottom: footer.top - 6 },
                kind === 'relay' ? trigger.width : kind === 'role' ? 280 : 340,
                menu.current ? menu.current.scrollHeight + 2 : 264);
            const next = { ...result, left: result.left - rect.left - root.clientLeft, top: result.top - rect.top - root.clientTop };
            setPlacement(previous => previous && previous.left === next.left && previous.top === next.top
                && previous.width === next.width && previous.maxHeight === next.maxHeight && previous.up === next.up ? previous : next);
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(root);
        observer.observe(control);
        if (menu.current) observer.observe(menu.current);
        root.addEventListener('scroll', update, true);
        window.addEventListener('resize', update);
        return () => {
            observer.disconnect();
            root.removeEventListener('scroll', update, true);
            window.removeEventListener('resize', update);
        };
    }, [dialog, anchor, kind]);
    const dismiss = () => {
        onDismiss();
        anchor.current?.querySelector('button')?.focus({ preventScroll: true });
    };
    if (!dialog.current) return null;
    return createPortal(<div ref={menu}
        className={`nmx-council-popover nmx-council-${kind === 'relay' ? 'relay-drawer-container nmx-model-picker-relay-view' : `${kind}-dropdown`}${placement?.up ? ' is-drop-up' : ''}`}
        data-council-model-picker={kind === 'model' ? slotId : undefined}
        data-council-model-dropdown={kind === 'model' ? slotId : undefined}
        data-council-role-picker={kind === 'role' ? slotId : undefined}
        data-council-relay-picker={kind === 'relay' ? 'true' : undefined}
        data-council-relay-drawer={kind === 'relay' ? 'true' : undefined}
        role={kind === 'model' ? 'listbox' : 'group'} aria-label={label}
        style={placement ? { left: placement.left, top: placement.top, width: placement.width, maxHeight: placement.maxHeight } : { visibility: 'hidden' }}
        onWheel={event => event.stopPropagation()}
        onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Escape') {
                event.preventDefault(); event.stopPropagation(); dismiss(); return;
            }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || kind === 'relay') return;
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
            if (!items.length) return;
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
                : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            event.preventDefault(); event.stopPropagation(); items[next].focus();
        }}
    >{children}</div>, dialog.current);
};

export function useCouncilDialogFocus(ref: React.RefObject<HTMLElement>): void {
    const [previous] = React.useState(() => document.activeElement as HTMLElement | null);
    React.useEffect(() => {
        if (!ref.current?.contains(document.activeElement)) ref.current?.focus({ preventScroll: true });
        return () => {
            const target = previous?.isConnected && previous !== document.body ? previous
                : document.querySelector<HTMLElement>('.nmx-composer .nmx-council-toggle')
                    ?? document.querySelector<HTMLElement>('.nmx-composer .nmx-composer-tool');
            target?.focus({ preventScroll: true });
        };
    }, [ref, previous]);
}

export function trapCouncilDialogFocus(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.key !== 'Tab') return;
    const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
        .filter(node => node.getClientRects().length > 0);
    const first = nodes[0]; const last = nodes[nodes.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
        event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) {
        event.preventDefault(); first.focus();
    }
}
