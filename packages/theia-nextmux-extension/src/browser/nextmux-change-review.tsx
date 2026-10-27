import * as React from 'react';
import type { AgentCheckpointDiff, AgentRunEvent, AgentRunVerification } from '@nextmux/agent-runtime';
import { supersededEditFailures } from './nextmux-agent-activity';
import { StreamFilePath } from './nextmux-conversation-stream';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { filesChangedLabel } from './nextmux-files-changed-label';
import { groupChangesByFile } from './nextmux-change-grouping';
export { groupChangesByFile } from './nextmux-change-grouping';
import '../../src/browser/style/nextmux-change-review.css';

const copy: Record<NextMuxDesktopLocale, readonly string[]> = {
    'zh-CN': ['个文件已修改', '执行结束', '检查通过', '尚未验证', '检查未通过', '恢复所有修改', '已恢复', '恢复', '检查中', '检查完成后又有修改，请重新验证', '恢复已记录修改', '大文件预览已省略，完整版本可恢复', '以下文件的修改没有生效，内容未变：'],
    'zh-TW': ['個檔案已修改', '執行結束', '檢查通過', '尚未驗證', '檢查未通過', '還原所有修改', '已還原', '還原', '檢查中', '檢查完成後又有修改，請重新驗證', '還原已記錄修改', '已略過大型檔案預覽，仍可還原完整版本', '以下檔案的修改沒有生效，內容未變：'],
    en: ['files changed', 'Run ended', 'Checks passed', 'Not verified', 'Checks failed', 'Restore all changes', 'Restored', 'Restore', 'Checking', 'Changes made after this check; verify again', 'Restore recorded changes', 'Large preview omitted; the complete version can be restored', 'These edits failed and were not applied; the files are unchanged:'],
    ja: ['ファイルを変更', '実行終了', 'チェック合格', '未検証', 'チェック失敗', 'すべての変更を戻す', '復元済み', '復元', '確認中', 'チェック後に変更あり。再検証が必要です', '記録済みの変更を復元', '大きなプレビューは省略。完全なバージョンを復元できます', '次のファイルの変更は失敗し、適用されていません（内容は変わっていません）：'],
    ko: ['개 파일 변경', '실행 종료', '검사 통과', '검증 안 됨', '검사 실패', '모든 변경 복원', '복원됨', '복원', '검사 중', '검사 후 변경됨. 다시 검증하세요', '기록된 변경 복원', '큰 파일 미리보기 생략; 전체 버전 복원 가능', '다음 파일의 수정이 실패해 적용되지 않았습니다(내용 변경 없음):'],
    es: ['archivos modificados', 'Ejecución terminada', 'Comprobaciones correctas', 'Sin verificar', 'Comprobaciones fallidas', 'Restaurar todos los cambios', 'Restaurado', 'Restaurar', 'Comprobando', 'Hay cambios posteriores; verificar de nuevo', 'Restaurar cambios registrados', 'Vista previa grande omitida; se puede restaurar la versión completa', 'Estas ediciones fallaron y no se aplicaron; los archivos no cambiaron:'],
    fr: ['fichiers modifiés', 'Exécution terminée', 'Vérifications réussies', 'Non vérifié', 'Vérifications échouées', 'Restaurer toutes les modifications', 'Restauré', 'Restaurer', 'Vérification', 'Modifications après le contrôle ; vérifier à nouveau', 'Restaurer les modifications enregistrées', 'Aperçu volumineux omis ; la version complète reste restaurable', 'Ces modifications ont échoué et n’ont pas été appliquées ; les fichiers sont inchangés :'],
    de: ['Dateien geändert', 'Ausführung beendet', 'Prüfungen bestanden', 'Nicht geprüft', 'Prüfungen fehlgeschlagen', 'Alle Änderungen wiederherstellen', 'Wiederhergestellt', 'Wiederherstellen', 'Prüfung läuft', 'Nach der Prüfung geändert; erneut prüfen', 'Erfasste Änderungen wiederherstellen', 'Große Vorschau ausgelassen; vollständige Version wiederherstellbar', 'Diese Änderungen sind fehlgeschlagen und wurden nicht übernommen; die Dateien sind unverändert:'],
    'pt-BR': ['arquivos alterados', 'Execução encerrada', 'Verificações aprovadas', 'Não verificado', 'Verificações falharam', 'Restaurar todas as alterações', 'Restaurado', 'Restaurar', 'Verificando', 'Alterações após a verificação; verificar novamente', 'Restaurar alterações registradas', 'Prévia grande omitida; a versão completa pode ser restaurada', 'Estas edições falharam e não foram aplicadas; os arquivos não mudaram:'],
    ru: ['файлов изменено', 'Выполнение завершено', 'Проверки пройдены', 'Не проверено', 'Проверки не пройдены', 'Восстановить все изменения', 'Восстановлено', 'Восстановить', 'Проверка', 'Изменено после проверки; проверьте снова', 'Восстановить записанные изменения', 'Большой просмотр пропущен; полную версию можно восстановить', 'Эти правки не удались и не применены; файлы не изменились:'],
    ar: ['ملفات معدّلة', 'انتهى التنفيذ', 'نجحت الفحوصات', 'لم يتم التحقق', 'فشلت الفحوصات', 'استعادة جميع التغييرات', 'تمت الاستعادة', 'استعادة', 'جارٍ التحقق', 'تغييرات بعد الفحص؛ يلزم التحقق مجدداً', 'استعادة التغييرات المسجلة', 'تم حذف المعاينة الكبيرة؛ يمكن استعادة النسخة الكاملة', 'فشلت هذه التعديلات ولم تُطبَّق؛ الملفات لم تتغير:'],
    hi: ['फ़ाइलें बदली गईं', 'निष्पादन समाप्त', 'जाँच सफल', 'सत्यापन नहीं हुआ', 'जाँच विफल', 'सभी बदलाव पुनर्स्थापित करें', 'पुनर्स्थापित', 'पुनर्स्थापित करें', 'जाँच जारी', 'जाँच के बाद बदलाव हुए; फिर सत्यापित करें', 'दर्ज बदलाव पुनर्स्थापित करें', 'बड़ा पूर्वावलोकन छोड़ा गया; पूरा संस्करण पुनर्स्थापित किया जा सकता है', 'ये बदलाव विफल रहे और लागू नहीं हुए; फ़ाइलें अपरिवर्तित हैं:']
};

const undoAllText: Record<NextMuxDesktopLocale, string> = {
    'zh-CN': '撤销全部恢复', 'zh-TW': '復原全部還原', en: 'Undo all restores', ja: 'すべての復元を取り消す',
    ko: '모든 복원 취소', es: 'Deshacer todas las restauraciones', fr: 'Annuler toutes les restaurations',
    de: 'Alle Wiederherstellungen rückgängig machen', 'pt-BR': 'Desfazer todas as restaurações',
    ru: 'Отменить все восстановления', ar: 'التراجع عن جميع عمليات الاستعادة', hi: 'सभी पुनर्स्थापन पूर्ववत करें'
};

export function NextMuxChangeReview(props: {
    locale: NextMuxDesktopLocale;
    changes: readonly AgentCheckpointDiff[];
    verification?: AgentRunVerification;
    warnings?: readonly string[];
    events?: readonly AgentRunEvent[];
    resolveFilePath?: (path: string) => string;
    restoring: boolean;
    blocked: boolean;
    isRestored: (id: string) => boolean;
    onOpen: (change: AgentCheckpointDiff) => void;
    onRestore: (id: string) => void;
    onUndoRestore?: (id: string) => void;
    onRestoreAll: () => void;
}): React.ReactElement | null {
    // One row per file for this turn: a file edited several times (or created
    // and later removed) is one change with its net line counts, and restoring
    // it returns the file to how it was before this turn touched it.
    const superseded = supersededEditFailures(props.events || []);
    const hiddenCheckpoints = new Set((props.events || []).flatMap(event =>
        event.type === 'tool_completed' && superseded.has(event.callId) && event.summary.checkpointId ? [event.summary.checkpointId] : []));
    const changes = groupChangesByFile(props.changes.filter(change => !hiddenCheckpoints.has(change.checkpointId)));
    if (!changes.length) return null;
    const labels = copy[props.locale] || copy.en;
    const isChangeRestored = (change: (typeof changes)[number]): boolean =>
        Boolean(props.isRestored(change.checkpointId) || change.checkpointIds?.some(id => props.isRestored(id)));
    const allRestored = changes.length > 0 && changes.every(isChangeRestored);
    return <details className='nmx-turn-change-review'>
        <summary>
            <i className='codicon codicon-diff' aria-hidden='true' />
            <span>{filesChangedLabel(props.locale, changes.length)}</span>
            <i className='codicon codicon-chevron-right nmx-review-chevron' aria-hidden='true' />
        </summary>
        <div className='nmx-turn-review-content'>
            {changes.length > 0 && <header><button type='button' disabled={Boolean(props.blocked || props.restoring)}
                onClick={props.onRestoreAll}>{allRestored ? undoAllText[props.locale] : labels[5]}</button></header>}
            {changes.map(change => {
                const restored = isChangeRestored(change);
                const fileTarget = change.externalTarget || change.path;
                return <div className={`nmx-turn-review-file${restored ? ' is-restored' : ''}`} key={change.checkpointId || `${change.workspaceRoot || ''}:${fileTarget}`}>
                    <button type='button' className='nmx-review-file-path'
                        data-nmx-file-target={fileTarget} data-nmx-path={fileTarget} data-nmx-label={change.path}
                        title={change.workspaceRoot ? `${change.workspaceRoot} · ${change.path}` : change.path}
                        onClick={() => props.onOpen(change)}>
                        {change.rootLabel && <small className='nmx-review-file-root'>{change.rootLabel}</small>}
                        <StreamFilePath path={fileTarget} resolve={props.resolveFilePath} onOpen={() => props.onOpen(change)} /></button>
                    {/* A restore recorded on this same turn is grouped with its edit; clicking 已恢复 prompts to undo the restore. */}
                    {!restored && (change.truncated && !change.patch ? <span title={labels[11]}><i className='codicon codicon-file' aria-hidden='true' /></span>
                        : change.beforeMode !== undefined && change.afterMode !== undefined && change.beforeMode !== null && change.afterMode !== null
                            && (change.beforeMode & 0o777) !== (change.afterMode & 0o777) && !change.additions && !change.deletions
                            ? <span>{(change.beforeMode & 0o777).toString(8)} → {(change.afterMode & 0o777).toString(8)}</span>
                            : <span><b>+{change.additions}</b> <em>−{change.deletions}</em></span>)}
                    {restored
                        ? <button type='button' className='nmx-review-restore-toggle is-restored' aria-pressed='true'
                            disabled={Boolean(props.blocked || props.restoring)}
                            onClick={() => (props.onUndoRestore || props.onRestore)(change.checkpointId)}>{labels[6]}</button>
                        : <button type='button' disabled={Boolean(!change.checkpointId || props.blocked || props.restoring)}
                            onClick={() => props.onRestore(change.checkpointId)}>{labels[7]}</button>}
                </div>;
            })}
        </div>
    </details>;
}
