import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

const keys = ['openFiles', 'actions', 'saveAll', 'closeAll', 'expandLeft', 'history', 'loading', 'emptyHistory', 'current', 'after', 'before', 'original', 'saved', 'restored', 'historyPartial', 'historyFailed', 'historySaveFailed', 'restoreWidth'] as const;
export type FileDrawerTextKey = typeof keys[number] | 'historyDirty' | 'restoreVersion' | 'historyRestoredNoPreview';
const copy: Record<NextMuxDesktopLocale, readonly string[]> = {
    'zh-CN': ['打开的文件', '文件操作', '全部保存', '全部关闭', '向左显示', '文件历史版本', '加载中…', '暂无历史版本', '当前版本', '修改后'],
    'zh-TW': ['開啟的檔案', '檔案操作', '全部儲存', '全部關閉', '向左展開', '檔案歷史版本', '載入中…', '尚無歷史版本', '目前版本', '修改後'],
    en: ['Open files', 'File actions', 'Save all', 'Close all', 'Expand left', 'File history', 'Loading…', 'No history yet', 'Current version', 'After change'],
    ja: ['開いているファイル', 'ファイル操作', 'すべて保存', 'すべて閉じる', '左へ展開', 'ファイル履歴', '読み込み中…', '履歴はありません', '現在の版', '変更後'],
    ko: ['열린 파일', '파일 작업', '모두 저장', '모두 닫기', '왼쪽으로 확장', '파일 기록', '불러오는 중…', '기록 없음', '현재 버전', '변경 후'],
    es: ['Archivos abiertos', 'Acciones de archivo', 'Guardar todo', 'Cerrar todo', 'Expandir a la izquierda', 'Historial del archivo', 'Cargando…', 'Sin historial', 'Versión actual', 'Tras el cambio'],
    fr: ['Fichiers ouverts', 'Actions du fichier', 'Tout enregistrer', 'Tout fermer', 'Développer à gauche', 'Historique du fichier', 'Chargement…', 'Aucun historique', 'Version actuelle', 'Après modification'],
    de: ['Geöffnete Dateien', 'Dateiaktionen', 'Alle speichern', 'Alle schließen', 'Nach links erweitern', 'Dateiverlauf', 'Laden…', 'Noch kein Verlauf', 'Aktuelle Version', 'Nach Änderung'],
    'pt-BR': ['Arquivos abertos', 'Ações do arquivo', 'Salvar tudo', 'Fechar tudo', 'Expandir à esquerda', 'Histórico do arquivo', 'Carregando…', 'Sem histórico', 'Versão atual', 'Após alteração'],
    ru: ['Открытые файлы', 'Действия с файлом', 'Сохранить всё', 'Закрыть всё', 'Развернуть влево', 'История файла', 'Загрузка…', 'Истории пока нет', 'Текущая версия', 'После изменения'],
    ar: ['الملفات المفتوحة', 'إجراءات الملف', 'حفظ الكل', 'إغلاق الكل', 'توسيع لليسار', 'سجل الملف', 'جارٍ التحميل…', 'لا يوجد سجل بعد', 'الإصدار الحالي', 'بعد التعديل'],
    hi: ['खुली फ़ाइलें', 'फ़ाइल क्रियाएँ', 'सभी सहेजें', 'सभी बंद करें', 'बाईं ओर फैलाएँ', 'फ़ाइल इतिहास', 'लोड हो रहा है…', 'अभी इतिहास नहीं है', 'वर्तमान संस्करण', 'बदलाव के बाद']
};

const historyCopy: Record<NextMuxDesktopLocale, readonly string[]> = {
    'zh-CN': ['修改前', '原文件', '文件已保存', '版本已恢复', '部分历史版本暂时无法读取，可重新打开重试。', '无法读取此历史版本，请重试。'],
    'zh-TW': ['修改前', '原始檔案', '檔案已儲存', '版本已還原', '部分歷史版本暫時無法讀取，可重新開啟重試。', '無法讀取此歷史版本，請重試。'],
    en: ['Before change', 'Original file', 'File saved', 'Version restored', 'Some versions could not be loaded. Reopen history to retry.', 'Could not load this version. Please retry.'],
    ja: ['変更前', '元のファイル', '保存済み', '復元済み', '一部の履歴を読み込めませんでした。履歴を開き直してください。', 'この版を読み込めませんでした。再試行してください。'],
    ko: ['변경 전', '원본 파일', '파일 저장됨', '버전 복원됨', '일부 기록을 불러오지 못했습니다. 다시 열어 주세요.', '이 버전을 불러오지 못했습니다. 다시 시도하세요.'],
    es: ['Antes del cambio', 'Archivo original', 'Archivo guardado', 'Versión restaurada', 'No se pudieron cargar algunas versiones. Vuelva a abrir el historial.', 'No se pudo cargar esta versión. Reinténtelo.'],
    fr: ['Avant modification', 'Fichier original', 'Fichier enregistré', 'Version restaurée', 'Certaines versions n’ont pas pu être chargées. Rouvrez l’historique.', 'Impossible de charger cette version. Réessayez.'],
    de: ['Vor Änderung', 'Originaldatei', 'Datei gespeichert', 'Version wiederhergestellt', 'Einige Versionen konnten nicht geladen werden. Verlauf erneut öffnen.', 'Diese Version konnte nicht geladen werden. Bitte erneut versuchen.'],
    'pt-BR': ['Antes da alteração', 'Arquivo original', 'Arquivo salvo', 'Versão restaurada', 'Não foi possível carregar algumas versões. Abra o histórico novamente.', 'Não foi possível carregar esta versão. Tente novamente.'],
    ru: ['До изменения', 'Исходный файл', 'Файл сохранён', 'Версия восстановлена', 'Не удалось загрузить часть версий. Откройте историю заново.', 'Не удалось загрузить эту версию. Повторите попытку.'],
    ar: ['قبل التعديل', 'الملف الأصلي', 'تم حفظ الملف', 'تمت استعادة الإصدار', 'تعذر تحميل بعض الإصدارات. أعد فتح السجل للمحاولة.', 'تعذر تحميل هذا الإصدار. حاول مرة أخرى.'],
    hi: ['बदलाव से पहले', 'मूल फ़ाइल', 'फ़ाइल सहेजी गई', 'संस्करण बहाल', 'कुछ संस्करण लोड नहीं हो सके। इतिहास फिर से खोलें।', 'यह संस्करण लोड नहीं हो सका। फिर कोशिश करें।']
};

function uncheckedFileDrawerText(locale: NextMuxDesktopLocale, key: FileDrawerTextKey): string {
    const restoreCopy: Record<NextMuxDesktopLocale, readonly [string, string, string]> = {
        'zh-CN': ['请先保存当前编辑，再恢复历史版本；未保存内容已保留。', '恢复此版本', '文件已恢复。大文件暂不自动预览，可重新打开查看。'],
        'zh-TW': ['請先儲存目前編輯，再還原歷史版本；未儲存內容已保留。', '還原此版本', '檔案已還原。大型檔案暫不自動預覽，可重新開啟查看。'],
        en: ['Save your edits before restoring a version. Unsaved changes have been kept.', 'Restore this version', 'File restored. Large files are not previewed automatically; reopen to view.'],
        ja: ['履歴を復元する前に編集を保存してください。未保存の内容は保持されています。', 'この版を復元', 'ファイルを復元しました。大きなファイルは再度開いて確認してください。'],
        ko: ['버전을 복원하기 전에 편집 내용을 저장하세요. 저장하지 않은 내용은 보존되었습니다.', '이 버전 복원', '파일을 복원했습니다. 큰 파일은 다시 열어 확인하세요.'],
        es: ['Guarde sus cambios antes de restaurar una versión. Se han conservado los cambios sin guardar.', 'Restaurar esta versión', 'Archivo restaurado. Vuelva a abrir los archivos grandes para verlos.'],
        fr: ['Enregistrez vos modifications avant de restaurer une version. Les modifications non enregistrées sont conservées.', 'Restaurer cette version', 'Fichier restauré. Rouvrez les fichiers volumineux pour les consulter.'],
        de: ['Speichern Sie Ihre Änderungen vor der Wiederherstellung. Ungespeicherte Änderungen bleiben erhalten.', 'Diese Version wiederherstellen', 'Datei wiederhergestellt. Große Dateien zum Anzeigen erneut öffnen.'],
        'pt-BR': ['Salve suas alterações antes de restaurar uma versão. As alterações não salvas foram mantidas.', 'Restaurar esta versão', 'Arquivo restaurado. Reabra arquivos grandes para visualizá-los.'],
        ru: ['Сохраните изменения перед восстановлением версии. Несохранённые изменения сохранены в редакторе.', 'Восстановить эту версию', 'Файл восстановлен. Откройте большой файл повторно для просмотра.'],
        ar: ['احفظ تعديلاتك قبل استعادة إصدار. تم الاحتفاظ بالتغييرات غير المحفوظة.', 'استعادة هذا الإصدار', 'تمت استعادة الملف. أعد فتح الملفات الكبيرة لعرضها.'],
        hi: ['संस्करण बहाल करने से पहले संपादन सहेजें। बिना सहेजे बदलाव सुरक्षित हैं।', 'यह संस्करण बहाल करें', 'फ़ाइल बहाल हो गई। बड़ी फ़ाइल देखने के लिए दोबारा खोलें।']
    };
    if (key === 'historyDirty') return restoreCopy[locale][0];
    if (key === 'restoreVersion') return restoreCopy[locale][1];
    if (key === 'historyRestoredNoPreview') return restoreCopy[locale][2];
    if (key === 'restoreWidth') return {
        'zh-CN': '恢复宽度', 'zh-TW': '還原寬度', en: 'Restore width', ja: '幅を元に戻す', ko: '너비 복원',
        es: 'Restaurar ancho', fr: 'Rétablir la largeur', de: 'Breite zurücksetzen', 'pt-BR': 'Restaurar largura',
        ru: 'Восстановить ширину', ar: 'استعادة العرض', hi: 'चौड़ाई बहाल करें'
    }[locale];
    if (key === 'historySaveFailed') return {
        'zh-CN': '文件已保存，但未能保存历史版本。', 'zh-TW': '檔案已儲存，但未能儲存歷史版本。',
        en: 'The file was saved, but its history version could not be stored.', ja: 'ファイルは保存されましたが、履歴を保存できませんでした。',
        ko: '파일은 저장되었지만 기록 버전을 저장하지 못했습니다.', es: 'El archivo se guardó, pero no se pudo guardar su versión en el historial.',
        fr: 'Le fichier a été enregistré, mais sa version historique n’a pas pu être conservée.', de: 'Die Datei wurde gespeichert, ihre Verlaufsversion jedoch nicht.',
        'pt-BR': 'O arquivo foi salvo, mas não foi possível guardar sua versão no histórico.', ru: 'Файл сохранён, но его версию не удалось добавить в историю.',
        ar: 'تم حفظ الملف، لكن تعذر حفظ إصداره في السجل.', hi: 'फ़ाइल सहेजी गई, लेकिन उसका इतिहास संस्करण सहेजा नहीं जा सका।'
    }[locale];
    const index = keys.indexOf(key);
    return index < 10 ? copy[locale][index] : historyCopy[locale][index - 10];
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function fileDrawerText(locale: Parameters<typeof uncheckedFileDrawerText>[0], key: Parameters<typeof uncheckedFileDrawerText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedFileDrawerText>>): string {
    return totalCopy(locale, key, language => uncheckedFileDrawerText(language, key, ...rest));
}
