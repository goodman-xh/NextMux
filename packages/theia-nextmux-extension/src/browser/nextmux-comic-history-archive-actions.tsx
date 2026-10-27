import * as React from 'react';

export interface ComicHistoryArchiveActionsProps {
    readonly busy: boolean;
    readonly files: number;
    readonly onExport: () => void;
    readonly onImport: () => void;
}

export function ComicHistoryArchiveActions(props: ComicHistoryArchiveActionsProps): React.ReactElement {
    return <>
        <button disabled={props.busy || props.files === 0} onClick={props.onExport}>备份修订历史</button>
        <button disabled={props.busy} onClick={props.onImport}>恢复修订历史</button>
    </>;
}

export function LocalDataDiagnosticAction(props: {
    readonly busy: boolean;
    readonly exporting: boolean;
    readonly onExport: () => void;
}): React.ReactElement {
    return <button type='button' disabled={props.busy} onClick={props.onExport}>
        {props.exporting ? '正在生成…' : '导出诊断报告'}
    </button>;
}
