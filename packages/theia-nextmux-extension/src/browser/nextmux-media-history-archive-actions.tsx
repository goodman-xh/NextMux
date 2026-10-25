import * as React from 'react';

export interface MediaHistoryArchiveActionsProps {
    readonly busy: boolean;
    readonly files: number;
    readonly exportLabel: string;
    readonly importLabel: string;
    readonly onExport: () => void;
    readonly onImport: () => void;
}

export function MediaHistoryArchiveActions(props: MediaHistoryArchiveActionsProps): React.ReactElement {
    return <>
        <button type='button' disabled={props.busy || props.files === 0} onClick={props.onExport}>{props.exportLabel}</button>
        <button type='button' disabled={props.busy} onClick={props.onImport}>{props.importLabel}</button>
    </>;
}
