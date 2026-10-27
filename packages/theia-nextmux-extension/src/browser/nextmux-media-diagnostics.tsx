import * as React from 'react';
import type { DesktopComicExportState } from '../common/nextmux-platform-protocol';
import { mediaMessage, mediaMessageText } from '../common/nextmux-media-messages';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { mediaAuditText } from './nextmux-media-audit-locale';

export function MediaDiagnostic(props: { locale: NextMuxDesktopLocale; detail?: string }): React.ReactElement | null {
    // The original diagnostic stays with its owner; user cards show the reason.
    return null;
}

export function ComicExportWarnings(props: { locale: NextMuxDesktopLocale; state: DesktopComicExportState }): React.ReactElement | null {
    const infos = props.state.warningInfos || props.state.warnings.map(detail => mediaMessage('export_notice', {}, detail));
    return infos.length ? <details><summary>{mediaAuditText(props.locale, 'warnings', { count: infos.length })}</summary>
        {infos.map((info, index) => <div key={index}><p data-nmx-literal>{mediaMessageText(info, props.locale)}</p><MediaDiagnostic locale={props.locale} detail={info.detail} /></div>)}
    </details> : null;
}
