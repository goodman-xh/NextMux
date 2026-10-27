import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

const keys = [
    'description', 'chooseExport', 'exportSuccess', 'exportFailed', 'chooseImport', 'importSuccess',
    'importFailed', 'exportButton', 'importButton', 'readOnly', 'noFilm', 'historyRetention'
] as const;
export type ComicExportArchiveTextKey = typeof keys[number];

const values: Readonly<Record<NextMuxDesktopLocale, readonly string[]>> = {
    'zh-CN': [
        ' · 仅备份已结束导出记录；导入后只读，不含成片、字幕、素材、路径或错误原文',
        '选择成片导出记录备份的保存文件夹', '已备份 {count} 条已结束的成片导出记录；不含成片、字幕、素材、路径或错误原文。',
        '成片导出记录备份失败', '选择 .nmxcomicexports 成片导出记录备份文件',
        '已导入 {count} 条只读成片导出记录；不含成片文件，不能取消或重新执行。', '成片导出记录导入失败',
        '备份成片记录', '导入成片记录', '只读记录', '不含成片文件', '保留最近 20 条本机记录；导入历史单独保存'
    ],
    'zh-TW': [
        ' · 僅備份已結束的匯出紀錄；匯入後唯讀，不含成片、字幕、素材、路徑或錯誤原文',
        '選擇成片匯出紀錄備份的儲存資料夾', '已備份 {count} 筆已結束的成片匯出紀錄；不含成片、字幕、素材、路徑或錯誤原文。',
        '成片匯出紀錄備份失敗', '選擇 .nmxcomicexports 成片匯出紀錄備份檔案',
        '已匯入 {count} 筆唯讀成片匯出紀錄；不含成片檔案，無法取消或重新執行。', '成片匯出紀錄匯入失敗',
        '備份成片紀錄', '匯入成片紀錄', '唯讀紀錄', '不含成片檔案', '保留最近 20 筆本機紀錄；匯入歷史另行儲存'
    ],
    en: [
        ' · Finished export records only; imports are read-only and exclude films, subtitles, assets, paths, and raw errors',
        'Choose a folder for the film export history backup', 'Backed up {count} finished film export records; films, subtitles, assets, paths, and raw errors are excluded.',
        'Could not back up film export history', 'Choose a .nmxcomicexports film export history file',
        'Imported {count} read-only film export records; film files are excluded and the records cannot be cancelled or rerun.', 'Could not import film export history',
        'Back up export records', 'Import export records', 'Read-only record', 'Film file not included', 'Keeps the latest 20 local records; imported history is stored separately'
    ],
    ja: [
        ' · 終了した書き出し記録のみ。インポート後は読み取り専用で、動画、字幕、素材、パス、エラー原文は含まれません',
        '動画書き出し履歴のバックアップ先フォルダーを選択', '終了した動画書き出し記録 {count} 件をバックアップしました。動画、字幕、素材、パス、エラー原文は含まれません。',
        '動画書き出し履歴をバックアップできませんでした', '.nmxcomicexports の動画書き出し履歴ファイルを選択',
        '読み取り専用の書き出し記録 {count} 件をインポートしました。動画ファイルは含まれず、取消しや再実行はできません。', '動画書き出し履歴をインポートできませんでした',
        '書き出し記録をバックアップ', '書き出し記録をインポート', '読み取り専用', '動画ファイルなし', '最新 20 件のローカル記録を保持し、インポート履歴は別に保存します'
    ],
    ko: [
        ' · 완료된 내보내기 기록만 백업합니다. 가져온 기록은 읽기 전용이며 영상, 자막, 자료, 경로, 원본 오류는 포함되지 않습니다',
        '영상 내보내기 기록의 백업 폴더 선택', '완료된 영상 내보내기 기록 {count}건을 백업했습니다. 영상, 자막, 자료, 경로, 원본 오류는 포함되지 않습니다.',
        '영상 내보내기 기록을 백업하지 못했습니다', '.nmxcomicexports 영상 내보내기 기록 파일 선택',
        '읽기 전용 내보내기 기록 {count}건을 가져왔습니다. 영상 파일은 포함되지 않으며 취소하거나 다시 실행할 수 없습니다.', '영상 내보내기 기록을 가져오지 못했습니다',
        '내보내기 기록 백업', '내보내기 기록 가져오기', '읽기 전용 기록', '영상 파일 없음', '최근 로컬 기록 20건을 유지하고 가져온 기록은 별도로 저장합니다'
    ],
    es: [
        ' · Solo registros de exportaciones terminadas; las importaciones son de solo lectura y no incluyen vídeos, subtítulos, recursos, rutas ni errores originales',
        'Elegir carpeta para la copia del historial de exportaciones', 'Se guardaron {count} registros de exportaciones terminadas; no se incluyen vídeos, subtítulos, recursos, rutas ni errores originales.',
        'No se pudo guardar el historial de exportaciones', 'Elegir archivo .nmxcomicexports del historial de exportaciones',
        'Se importaron {count} registros de solo lectura; no incluyen vídeos y no pueden cancelarse ni ejecutarse de nuevo.', 'No se pudo importar el historial de exportaciones',
        'Guardar registros', 'Importar registros', 'Registro de solo lectura', 'Vídeo no incluido', 'Conserva los últimos 20 registros locales; el historial importado se guarda por separado'
    ],
    fr: [
        ' · Enregistrements d’exports terminés uniquement ; les imports sont en lecture seule et excluent films, sous-titres, médias, chemins et erreurs brutes',
        'Choisir un dossier pour la sauvegarde des exports', '{count} enregistrements d’exports terminés ont été sauvegardés, sans films, sous-titres, médias, chemins ni erreurs brutes.',
        'Impossible de sauvegarder l’historique des exports', 'Choisir un fichier .nmxcomicexports',
        '{count} enregistrements en lecture seule ont été importés. Les films sont exclus et ces exports ne peuvent être annulés ou relancés.', 'Impossible d’importer l’historique des exports',
        'Sauvegarder les exports', 'Importer les exports', 'Lecture seule', 'Film non inclus', 'Conserve les 20 derniers enregistrements locaux ; les imports sont stockés séparément'
    ],
    de: [
        ' · Nur abgeschlossene Exportdatensätze; importierte Daten sind schreibgeschützt und enthalten keine Filme, Untertitel, Medien, Pfade oder Fehlertexte',
        'Ordner für die Sicherung der Exporthistorie auswählen', '{count} abgeschlossene Exportdatensätze gesichert; Filme, Untertitel, Medien, Pfade und Fehlertexte sind nicht enthalten.',
        'Exporthistorie konnte nicht gesichert werden', '.nmxcomicexports-Datei für die Exporthistorie auswählen',
        '{count} schreibgeschützte Exportdatensätze importiert. Filmdateien sind nicht enthalten; Abbrechen oder erneutes Ausführen ist nicht möglich.', 'Exporthistorie konnte nicht importiert werden',
        'Exportdatensätze sichern', 'Exportdatensätze importieren', 'Schreibgeschützter Datensatz', 'Filmdatei nicht enthalten', 'Behält die letzten 20 lokalen Datensätze; importierte Historie wird getrennt gespeichert'
    ],
    'pt-BR': [
        ' · Apenas registros de exportações concluídas; importações são somente leitura e não incluem vídeos, legendas, recursos, caminhos ou erros originais',
        'Escolher pasta para o backup do histórico de exportações', '{count} registros de exportações concluídas salvos; vídeos, legendas, recursos, caminhos e erros originais não estão incluídos.',
        'Não foi possível salvar o histórico de exportações', 'Escolher arquivo .nmxcomicexports',
        '{count} registros somente leitura importados. Os vídeos não estão incluídos; não é possível cancelar nem executar novamente.', 'Não foi possível importar o histórico de exportações',
        'Salvar registros', 'Importar registros', 'Registro somente leitura', 'Vídeo não incluído', 'Mantém os 20 registros locais mais recentes; o histórico importado é salvo separadamente'
    ],
    ru: [
        ' · Только записи завершённых экспортов; импорт доступен лишь для чтения и не содержит видео, субтитров, материалов, путей и текста ошибок',
        'Выберите папку для резервной копии истории экспорта', 'Сохранено записей завершённого экспорта: {count}. Видео, субтитры, материалы, пути и текст ошибок не включены.',
        'Не удалось сохранить историю экспорта', 'Выберите файл истории экспорта .nmxcomicexports',
        'Импортировано записей только для чтения: {count}. Видеофайлы не включены; отменить или повторно запустить их нельзя.', 'Не удалось импортировать историю экспорта',
        'Сохранить записи экспорта', 'Импортировать записи', 'Только для чтения', 'Видеофайл не включён', 'Хранятся 20 последних локальных записей; импортированная история сохраняется отдельно'
    ],
    ar: [
        ' · سجلات التصدير المنتهية فقط؛ السجلات المستوردة للقراءة فقط ولا تتضمن الأفلام أو الترجمات أو المواد أو المسارات أو نصوص الأخطاء',
        'اختر مجلد حفظ نسخة سجل تصدير الأفلام', 'نُسخت {count} سجلات تصدير منتهية احتياطيًا؛ لا تشمل الأفلام أو الترجمات أو المواد أو المسارات أو نصوص الأخطاء.',
        'تعذر نسخ سجل التصدير احتياطيًا', 'اختر ملف سجل التصدير ‎.nmxcomicexports',
        'تم استيراد {count} سجلات للقراءة فقط؛ لا تشمل ملفات الأفلام ولا يمكن إلغاؤها أو تشغيلها مجددًا.', 'تعذر استيراد سجل التصدير',
        'نسخ سجلات التصدير', 'استيراد السجلات', 'سجل للقراءة فقط', 'ملف الفيلم غير مضمّن', 'تُحفظ آخر 20 سجلاً محليًا وتُخزن السجلات المستوردة بشكل منفصل'
    ],
    hi: [
        ' · केवल समाप्त निर्यात रिकॉर्ड; आयातित रिकॉर्ड केवल-पढ़ने योग्य हैं और उनमें फ़िल्म, उपशीर्षक, सामग्री, पथ या मूल त्रुटियाँ नहीं होतीं',
        'फ़िल्म निर्यात इतिहास के बैकअप का फ़ोल्डर चुनें', '{count} समाप्त निर्यात रिकॉर्ड का बैकअप लिया गया; फ़िल्म, उपशीर्षक, सामग्री, पथ और मूल त्रुटियाँ शामिल नहीं हैं।',
        'निर्यात इतिहास का बैकअप नहीं बन सका', '.nmxcomicexports निर्यात इतिहास फ़ाइल चुनें',
        '{count} केवल-पढ़ने योग्य निर्यात रिकॉर्ड आयात हुए। फ़िल्म फ़ाइलें शामिल नहीं हैं; इन्हें रद्द या फिर से चलाया नहीं जा सकता।', 'निर्यात इतिहास आयात नहीं हो सका',
        'निर्यात रिकॉर्ड का बैकअप', 'निर्यात रिकॉर्ड आयात करें', 'केवल-पढ़ने योग्य रिकॉर्ड', 'फ़िल्म फ़ाइल शामिल नहीं', 'पिछले 20 स्थानीय रिकॉर्ड रखे जाते हैं; आयातित इतिहास अलग संग्रहीत होता है'
    ]
};

function uncheckedComicExportArchiveText(locale: NextMuxDesktopLocale, key: ComicExportArchiveTextKey): string {
    const index = keys.indexOf(key);
    return values[locale][index] || values.en[index];
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function comicExportArchiveText(locale: Parameters<typeof uncheckedComicExportArchiveText>[0], key: Parameters<typeof uncheckedComicExportArchiveText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedComicExportArchiveText>>): string {
    return totalCopy(locale, key, language => uncheckedComicExportArchiveText(language, key, ...rest));
}
