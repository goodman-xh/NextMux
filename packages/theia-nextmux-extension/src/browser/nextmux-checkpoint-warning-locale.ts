import type { NextMuxDesktopLocale } from './nextmux-locale';

const structuralWarning = 'Folders, folder permissions or symbolic links changed; those changes cannot be restored from checkpoints';
const snapshotBudgetWarning = 'Source snapshot file/byte budget reached';
/** Keep routine snapshot coverage in recovery data without repeating it in chat.
 * Unknown diagnostics and actionable recovery failures remain visible. */
export function visibleCheckpointWarnings(warnings: readonly string[] = []): string[] {
    return warnings.filter(warning => warning !== snapshotBudgetWarning);
}
const snapshotBudgetWarningCopy: Record<NextMuxDesktopLocale, string> = {
    'zh-CN': '部分文件超出检查点的数量或大小限制，未纳入恢复快照。仅已记录的文件更改可以恢复；这不表示任务执行失败。',
    'zh-TW': '部分檔案超出檢查點的數量或大小限制，未納入還原快照。只有已記錄的檔案變更可以還原；這不表示工作執行失敗。',
    en: snapshotBudgetWarning,
    ja: 'ファイル数またはサイズの上限により、一部のファイルは復元スナップショットに含まれていません。記録済みの変更のみ復元できます。タスクの失敗を意味するものではありません。',
    ko: '파일 수 또는 크기 제한으로 일부 파일이 복구 스냅샷에서 제외되었습니다. 기록된 변경 사항만 복구할 수 있으며, 작업 실패를 의미하지 않습니다.',
    es: 'Algunos archivos superan el límite de cantidad o tamaño de la instantánea. Solo pueden restaurarse los cambios registrados; esto no indica que la tarea haya fallado.',
    fr: 'Certains fichiers dépassent les limites de nombre ou de taille de l’instantané. Seules les modifications enregistrées peuvent être restaurées ; cela ne signifie pas que la tâche a échoué.',
    de: 'Einige Dateien überschreiten die Anzahl- oder Größenbegrenzung des Wiederherstellungsabbilds. Nur erfasste Änderungen können wiederhergestellt werden; dies bedeutet keinen Aufgabenfehler.',
    'pt-BR': 'Alguns arquivos excedem o limite de quantidade ou tamanho do snapshot. Apenas alterações registradas podem ser restauradas; isso não indica falha na tarefa.',
    ru: 'Некоторые файлы превышают лимит количества или размера снимка. Можно восстановить только записанные изменения; это не означает сбой задачи.',
    ar: 'تجاوزت بعض الملفات حد العدد أو الحجم للقطة الاستعادة. يمكن استعادة التغييرات المسجلة فقط؛ وهذا لا يعني فشل المهمة.',
    hi: 'कुछ फ़ाइलें संख्या या आकार सीमा के कारण पुनर्स्थापना स्नैपशॉट में शामिल नहीं हैं। केवल दर्ज बदलाव बहाल किए जा सकते हैं; इसका मतलब कार्य विफल होना नहीं है।'
};
const structuralWarningCopy: Record<NextMuxDesktopLocale, string> = {
    'zh-CN': '目录、目录权限或符号链接已更改；检查点无法恢复这些更改。',
    'zh-TW': '資料夾、資料夾權限或符號連結已變更；檢查點無法還原這些變更。',
    en: structuralWarning,
    ja: 'フォルダー、フォルダーの権限、またはシンボリックリンクが変更されました。これらの変更はチェックポイントから復元できません。',
    ko: '폴더, 폴더 권한 또는 심볼릭 링크가 변경되었습니다. 체크포인트에서 이러한 변경을 복원할 수 없습니다.',
    es: 'Se modificaron carpetas, permisos de carpetas o enlaces simbólicos; los puntos de control no pueden restaurar esos cambios.',
    fr: 'Des dossiers, leurs autorisations ou des liens symboliques ont été modifiés ; les points de contrôle ne peuvent pas restaurer ces changements.',
    de: 'Ordner, Ordnerberechtigungen oder symbolische Links wurden geändert; diese Änderungen können nicht aus Prüfpunkten wiederhergestellt werden.',
    'pt-BR': 'Pastas, permissões de pastas ou links simbólicos foram alterados; os pontos de verificação não podem restaurar essas alterações.',
    ru: 'Папки, права доступа к папкам или символические ссылки изменены; эти изменения нельзя восстановить из контрольных точек.',
    ar: 'تغيّرت مجلدات أو أذونات مجلدات أو روابط رمزية؛ لا يمكن استعادة هذه التغييرات من نقاط التحقق.',
    hi: 'फ़ोल्डर, फ़ोल्डर की अनुमतियाँ या प्रतीकात्मक लिंक बदले गए हैं; चेकपॉइंट से इन बदलावों को पुनर्स्थापित नहीं किया जा सकता।'
};

/** Translate only an exact known warning; preserve unfamiliar diagnostics verbatim. */
export function checkpointWarningText(locale: NextMuxDesktopLocale, warning: string): string {
    if (warning === snapshotBudgetWarning) return snapshotBudgetWarningCopy[locale] || snapshotBudgetWarningCopy.en;
    return warning === structuralWarning ? structuralWarningCopy[locale] || structuralWarningCopy.en : warning;
}
