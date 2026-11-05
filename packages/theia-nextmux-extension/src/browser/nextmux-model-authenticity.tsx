import * as React from 'react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { relayText } from './nextmux-relay-locale';
import { relayMetricSignal, relayPercentText } from './nextmux-relay-picker';

/**
 * A model row's 真实性, after its multiplier in every model picker (coding, comic chat, comic studio, Council): the
 * verified mark and the measured share in its band's colour (relayMetricSignal, the relay drawer's 真实性 bands), or a
 * muted "—" while the model has no identity evidence. A relay's 真实性 in the relay drawer is the mean of these values
 * (measuredRelayAuthenticity), so the two drawers agree. The row's own label says it in words; this is its visual only.
 *
 * Hovering the tag names it (真实性): its title, which the shell's hover tips show as their label inside the Council
 * dialog (data-nmx-tip, instead of the whole row's), and, where the picker passes onHover, the picker's own tooltip,
 * which holds the title back while it shows so the two never stack.
 */
export function ModelAuthenticityTag(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly value: number | undefined;
    readonly onHover?: (text: string, element: HTMLElement) => void;
    readonly onLeave?: () => void;
}): React.ReactElement {
    const { tone } = relayMetricSignal('authenticity', props.value);
    const label = relayText(props.locale, 'authenticity');
    const { onHover, onLeave } = props;
    return <small className='nmx-model-authenticity' data-tone={tone} dir='ltr' aria-hidden='true' title={label} data-nmx-tip={label}
        onPointerEnter={onHover ? event => onHover(label, event.currentTarget) : undefined} onPointerLeave={onLeave}>
        <i className='codicon codicon-verified' aria-hidden='true'></i>{relayPercentText(props.locale, props.value)}
    </small>;
}
