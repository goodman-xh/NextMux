import * as React from '@theia/core/shared/react';
import { createPortal } from '@theia/core/shared/react-dom';
import { publicMerchantDepositText } from '../common/nextmux-public-merchants';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { modelCenterText } from './nextmux-model-center-locale';

// 保证金: what every surface shares for a store that holds the platform's security deposit. Its name is drawn in the
// rainbow of nextmux.css (`.is-deposit-verified`), and resting on the name shows one hint everywhere: the seal and
// the name, the store's public number, its introduction, and the deposit line.

/**
 * The gold seal of a store holding the platform's security deposit: a scalloped rosette in the theme's gold with a check
 * in the surface's ink. It is not the outlined `verified` mark of the authenticity metric beside it on the card.
 */
export function DepositVerifiedSeal({ size = 14 }: { size?: number }): React.ReactElement {
    return <svg className='nmx-mc-deposit-seal' width={size} height={size} viewBox='0 0 16 16' aria-hidden='true' focusable='false'>
        <g fill='currentColor'>
            <circle cx='8' cy='8' r='5.6' />
            {[0, 45, 90, 135, 180, 225, 270, 315].map(angle => <circle key={angle} r='2.3'
                cx={(8 + 5 * Math.cos(angle * Math.PI / 180)).toFixed(2)} cy={(8 + 5 * Math.sin(angle * Math.PI / 180)).toFixed(2)} />)}
        </g>
        <path d='M5.4 8.2l1.75 1.75 3.6-3.65' fill='none' stroke='var(--mc-gold-ink, #1d1b1e)' strokeWidth='1.55' strokeLinecap='round' strokeLinejoin='round' />
    </svg>;
}

/** What a store shows of itself beside its name. */
export interface DepositVerifiedStore {
    readonly name: string;
    readonly publicCode?: string;
    readonly storeTagline?: string;
    readonly storeDescription?: string;
}

/** The hint of a deposit-verified store's name, a line each: its name, public number, introduction, and the deposit line. */
export function depositVerifiedHintText(locale: NextMuxDesktopLocale, store: DepositVerifiedStore): string {
    return [store.name, store.publicCode, (store.storeTagline || store.storeDescription || '').trim() || modelCenterText(locale, 'noStoreIntro'),
        publicMerchantDepositText(locale)].filter(Boolean).join('\n');
}

/** What the element showing the name takes so that resting on it, or focusing it, shows the hint. */
export interface DepositVerifiedHintAnchor {
    readonly onMouseEnter: (event: React.SyntheticEvent<Element>) => void;
    readonly onMouseLeave: () => void;
    readonly onMouseDown: () => void;
    readonly onFocus: (event: React.SyntheticEvent<Element>) => void;
    readonly onBlur: () => void;
    readonly 'aria-describedby'?: string;
}

/**
 * The hint of a deposit-verified store for an element that cannot take a wrapper (a row's name, a field): `children`
 * renders that element with the handlers it is given. The hint is portalled to the page (into the open dialog the
 * element is in, which covers the page), so no list or panel clips it, with the seal before the name on its first
 * line; a press hides it (the element may open a menu of its own).
 */
export function DepositVerifiedHint({ text, locale, children }: {
    text: string; locale: NextMuxDesktopLocale; children: (anchor: DepositVerifiedHintAnchor) => React.ReactElement;
}): React.ReactElement {
    const id = React.useId();
    const anchor = React.useRef<Element>();
    const tooltip = React.useRef<HTMLSpanElement>(null);
    const [position, setPosition] = React.useState<{ left: number; top: number }>();
    const [host, setHost] = React.useState<Element>();
    const hide = React.useCallback(() => setPosition(undefined), []);
    React.useEffect(() => {
        if (!position) return;
        window.addEventListener('scroll', hide, true); window.addEventListener('resize', hide);
        return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); };
    }, [Boolean(position)]);
    const show = (event: React.SyntheticEvent<Element>): void => {
        anchor.current = event.currentTarget;
        setHost(event.currentTarget.closest('dialog[open]') ?? document.body);
        const rect = event.currentTarget.getBoundingClientRect();
        setPosition({ left: Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - 292)),
            top: Math.min(rect.bottom + 8, Math.max(12, window.innerHeight - 100)) });
    };
    // Once measured: under the element, above it when there is no room below, and inside the window.
    React.useLayoutEffect(() => {
        if (!position || !tooltip.current || !anchor.current) return;
        const rect = anchor.current.getBoundingClientRect();
        const size = tooltip.current.getBoundingClientRect();
        const top = rect.bottom + 8 + size.height <= window.innerHeight - 12 ? rect.bottom + 8 : Math.max(12, rect.top - size.height - 8);
        const left = Math.max(12, Math.min(rect.left, window.innerWidth - size.width - 12));
        if (left !== position.left || top !== position.top) setPosition({ left, top });
    }, [position, text]);
    return <>{children({ onMouseEnter: show, onMouseLeave: hide, onMouseDown: hide, onFocus: show, onBlur: hide, ...(position ? { 'aria-describedby': id } : {}) })}
        {position && createPortal(<span ref={tooltip} id={id} className='nmx-mc-tooltip' role='tooltip' dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale}
            style={position}><DepositVerifiedSeal size={13} />{text}</span>, host ?? document.body)}</>;
}
