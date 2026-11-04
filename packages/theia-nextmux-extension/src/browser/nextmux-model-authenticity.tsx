import * as React from 'react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { relayMetricSignal, relayPercentText } from './nextmux-relay-picker';

/**
 * A model row's 真实性, after its multiplier in every model picker (coding, comic chat, comic studio, Council): the
 * verified mark and the measured share in its band's colour (relayMetricSignal, the relay drawer's 真实性 bands), or a
 * muted "—" while the model has no identity evidence. A relay's 真实性 in the relay drawer is the mean of these values
 * (measuredRelayAuthenticity), so the two drawers agree. The row's own label says it in words; this is its visual only.
 */
export function ModelAuthenticityTag(props: { readonly locale: NextMuxDesktopLocale; readonly value: number | undefined }): React.ReactElement {
    const { tone } = relayMetricSignal('authenticity', props.value);
    return <small className='nmx-model-authenticity' data-tone={tone} dir='ltr' aria-hidden='true'>
        <i className='codicon codicon-verified' aria-hidden='true'></i>{relayPercentText(props.locale, props.value)}
    </small>;
}
