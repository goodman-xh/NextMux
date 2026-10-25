import * as React from '@theia/core/shared/react';
import { createPortal } from '@theia/core/shared/react-dom';

/** Full paths live outside the horizontally clipped tab strip, including its first tab. */
export function NextMuxFileTabButton({ path, theme, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    path: string; theme: 'dark' | 'light';
}): React.ReactElement {
    const id = React.useId();
    const anchor = React.useRef<HTMLButtonElement>(null);
    const tooltip = React.useRef<HTMLDivElement>(null);
    const timer = React.useRef<ReturnType<typeof setTimeout>>();
    const [position, setPosition] = React.useState<{ left: number; top: number }>();
    const cancelHide = (): void => { clearTimeout(timer.current); };
    const close = (): void => { cancelHide(); setPosition(undefined); };
    const hide = (): void => {
        cancelHide();
        timer.current = setTimeout(() => { if (document.activeElement !== anchor.current) setPosition(undefined); }, 120);
    };
    const show = (): void => {
        cancelHide();
        const rect = anchor.current?.getBoundingClientRect();
        if (rect) setPosition({ left: Math.max(8, rect.left), top: rect.bottom + 6 });
    };
    React.useEffect(() => () => clearTimeout(timer.current), []);
    React.useEffect(() => {
        if (!position) return;
        window.addEventListener('resize', close);
        window.addEventListener('scroll', close, true);
        return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
    }, [Boolean(position)]);
    React.useLayoutEffect(() => {
        if (!position || !tooltip.current || !anchor.current) return;
        const rect = anchor.current.getBoundingClientRect(), size = tooltip.current.getBoundingClientRect();
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - size.width - 8));
        const top = rect.bottom + size.height + 6 <= window.innerHeight - 8 ? rect.bottom + 6 : Math.max(8, rect.top - size.height - 6);
        if (left !== position.left || top !== position.top) setPosition({ left, top });
    }, [position, path]);
    return <><button {...props} ref={anchor} aria-describedby={position ? id : undefined}
        onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
        onClick={event => { close(); props.onClick?.(event); }}
        onKeyDown={event => { if (event.key === 'Escape' && position) { event.stopPropagation(); close(); } props.onKeyDown?.(event); }}>
        {children}
    </button>{position && createPortal(<div ref={tooltip} id={id} role='tooltip' data-nmx-literal
        className={`nmx-file-path-tooltip nmx-theme-${theme}`} style={position} onMouseEnter={cancelHide} onMouseLeave={hide}>{path}</div>, document.body)}</>;
}
