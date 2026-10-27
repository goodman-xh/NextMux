import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

const saveAsKeys = ['saveAs', 'savedAs', 'saveAsExists', 'saveAsSource', 'saveAsTooLarge', 'saveAsChanged', 'saveAsUnsupported', 'saveAsFailed'] as const;
const keys = ['title', 'setting', 'settingBody', 'memory', 'saving', 'saved', 'failed', 'readonly', 'unavailable', 'open', 'retry', 'discard', 'confirmDiscard', 'cancel', 'empty', 'tooLarge', 'quota', 'disabled', 'conflict', 'copyAll', 'copied', ...saveAsKeys] as const;
export type EditorRecoveryTextKey = typeof keys[number];
const messages: Record<NextMuxDesktopLocale, readonly string[]> = {
    'zh-CN': ['文件恢复副本', '未保存文件恢复副本', '在本机保留未保存编辑的恢复副本，不修改原文件。', '仅在内存中', '正在备份', '已本机备份（原文件未保存）', '恢复副本操作失败，请重试。', '只读位置，不能修改原文件。', '文件或项目不可用。', '打开副本', '重试备份', '删除副本', '确认删除此恢复副本？原文件不会被删除，未保存的编辑可能丢失。', '取消', '暂无恢复副本。', '此文件超过恢复副本大小限制。', '恢复副本已达到本机容量限制。', '恢复副本已关闭；未保存编辑仅保留在内存中。', '磁盘内容已改变，请核对后再保存，不能自动覆盖。'],
    'zh-TW': ['檔案復原副本', '未儲存檔案復原副本', '在本機保留未儲存編輯的復原副本，不修改原檔案。', '僅在記憶體中', '正在備份', '已本機備份（原檔案未儲存）', '復原副本操作失敗，請重試。', '唯讀位置，不能修改原檔案。', '檔案或專案無法使用。', '開啟副本', '重試備份', '刪除副本', '確認刪除此復原副本？原檔案不會被刪除，未儲存的編輯可能遺失。', '取消', '尚無復原副本。', '此檔案超過復原副本大小限制。', '復原副本已達本機容量限制。', '復原副本已關閉；未儲存編輯僅保留在記憶體中。', '磁碟內容已變更，請核對後再儲存，不能自動覆寫。'],
    en: ['File recovery copies', 'Recovery copies for unsaved files', 'Keep local recovery copies of unsaved edits without changing original files.', 'Memory only', 'Backing up', 'Backed up locally (original unsaved)', 'Recovery operation failed. Please retry.', 'Read-only location; the original cannot be modified.', 'File or project unavailable.', 'Open copy', 'Retry backup', 'Delete copy', 'Delete this recovery copy? The original file stays; unsaved edits may be lost.', 'Cancel', 'No recovery copies.', 'This file exceeds the recovery copy size limit.', 'The local recovery copy quota is full.', 'Recovery copies are off; unsaved edits stay only in memory.', 'Disk content changed. Review before saving; no automatic overwrite.'],
    ja: ['ファイル復元用コピー', '未保存ファイルの復元用コピー', '元のファイルを変更せず、未保存の編集を端末内に復元用コピーとして保持します。', 'メモリ内のみ', 'バックアップ中', '端末内にバックアップ済み（原本は未保存）', '復元用コピーの操作に失敗しました。再試行してください。', '読み取り専用のため原本を変更できません。', 'ファイルまたはプロジェクトを利用できません。', 'コピーを開く', 'バックアップを再試行', 'コピーを削除', 'この復元用コピーを削除しますか？原本は残りますが、未保存の編集は失われる場合があります。', 'キャンセル', '復元用コピーはありません。', '復元用コピーのファイルサイズ上限を超えています。', '端末内の復元用コピーの容量上限に達しました。', '復元用コピーはオフです。未保存の編集はメモリ内にのみ残ります。', 'ディスクの内容が変わりました。保存前に確認してください。自動上書きはしません。'],
    ko: ['파일 복구 사본', '저장하지 않은 파일 복구 사본', '원본 파일을 변경하지 않고 저장하지 않은 편집의 복구 사본을 이 기기에 보관합니다.', '메모리에만 있음', '백업 중', '기기에 백업됨 (원본 미저장)', '복구 작업에 실패했습니다. 다시 시도하세요.', '읽기 전용 위치이므로 원본을 변경할 수 없습니다.', '파일 또는 프로젝트를 사용할 수 없습니다.', '사본 열기', '백업 재시도', '사본 삭제', '이 복구 사본을 삭제할까요? 원본은 유지되지만 저장하지 않은 편집은 사라질 수 있습니다.', '취소', '복구 사본이 없습니다.', '파일이 복구 사본 크기 제한을 초과했습니다.', '기기의 복구 사본 저장 한도에 도달했습니다.', '복구 사본이 꺼져 있습니다. 저장하지 않은 편집은 메모리에만 남습니다.', '디스크 내용이 변경되었습니다. 저장 전에 확인하세요. 자동으로 덮어쓰지 않습니다.'],
    es: ['Copias de recuperación', 'Copias de archivos sin guardar', 'Conserva copias locales de los cambios sin guardar, sin modificar los archivos originales.', 'Solo en memoria', 'Creando copia', 'Copia local lista (original sin guardar)', 'Falló la operación de recuperación. Reintenta.', 'Ubicación de solo lectura; no se puede modificar el original.', 'Archivo o proyecto no disponible.', 'Abrir copia', 'Reintentar copia', 'Eliminar copia', '¿Eliminar esta copia? El archivo original se conserva; los cambios sin guardar pueden perderse.', 'Cancelar', 'No hay copias de recuperación.', 'El archivo supera el tamaño máximo de recuperación.', 'Se alcanzó la cuota local de copias de recuperación.', 'Copias desactivadas; los cambios sin guardar quedan solo en memoria.', 'Cambió el contenido del disco. Revísalo antes de guardar; no se sobrescribe automáticamente.'],
    fr: ['Copies de récupération', 'Copies des fichiers non enregistrés', 'Conserver localement les modifications non enregistrées, sans modifier les fichiers originaux.', 'En mémoire uniquement', 'Copie en cours', 'Copie locale prête (original non enregistré)', 'Échec de la récupération. Réessayez.', 'Emplacement en lecture seule : original non modifiable.', 'Fichier ou projet indisponible.', 'Ouvrir la copie', 'Réessayer la copie', 'Supprimer la copie', 'Supprimer cette copie ? Le fichier original reste ; les modifications non enregistrées peuvent être perdues.', 'Annuler', 'Aucune copie de récupération.', 'Ce fichier dépasse la taille maximale des copies.', 'Le quota local des copies de récupération est atteint.', 'Copies désactivées : les modifications restent uniquement en mémoire.', 'Le contenu du disque a changé. Vérifiez avant d’enregistrer ; aucun écrasement automatique.'],
    de: ['Wiederherstellungskopien', 'Kopien ungespeicherter Dateien', 'Ungespeicherte Änderungen lokal sichern, ohne die Originaldateien zu ändern.', 'Nur im Arbeitsspeicher', 'Sicherung läuft', 'Lokal gesichert (Original ungespeichert)', 'Wiederherstellung fehlgeschlagen. Bitte erneut versuchen.', 'Schreibgeschützter Speicherort; Original nicht änderbar.', 'Datei oder Projekt nicht verfügbar.', 'Kopie öffnen', 'Sicherung wiederholen', 'Kopie löschen', 'Diese Kopie löschen? Die Originaldatei bleibt; ungespeicherte Änderungen können verloren gehen.', 'Abbrechen', 'Keine Wiederherstellungskopien.', 'Diese Datei überschreitet die maximale Kopiegröße.', 'Das lokale Kontingent für Wiederherstellungskopien ist voll.', 'Kopien deaktiviert; ungespeicherte Änderungen bleiben nur im Arbeitsspeicher.', 'Datenträgerinhalt geändert. Vor dem Speichern prüfen; kein automatisches Überschreiben.'],
    'pt-BR': ['Cópias de recuperação', 'Cópias de arquivos não salvos', 'Mantenha cópias locais das edições não salvas sem alterar os arquivos originais.', 'Somente na memória', 'Criando cópia', 'Cópia local pronta (original não salvo)', 'A recuperação falhou. Tente novamente.', 'Local somente leitura; o original não pode ser alterado.', 'Arquivo ou projeto indisponível.', 'Abrir cópia', 'Repetir cópia', 'Excluir cópia', 'Excluir esta cópia? O original permanece; edições não salvas podem ser perdidas.', 'Cancelar', 'Nenhuma cópia de recuperação.', 'Este arquivo excede o limite de tamanho da cópia.', 'A cota local de cópias de recuperação está cheia.', 'Cópias desativadas; edições não salvas ficam apenas na memória.', 'O conteúdo do disco mudou. Confira antes de salvar; sem sobrescrita automática.'],
    ru: ['Копии для восстановления', 'Копии несохранённых файлов', 'Хранить локальные копии несохранённых правок, не изменяя исходные файлы.', 'Только в памяти', 'Копирование', 'Локальная копия готова (оригинал не сохранён)', 'Ошибка восстановления. Повторите попытку.', 'Режим только для чтения; оригинал нельзя изменить.', 'Файл или проект недоступен.', 'Открыть копию', 'Повторить копирование', 'Удалить копию', 'Удалить эту копию? Оригинал останется, но несохранённые правки могут быть потеряны.', 'Отмена', 'Копий для восстановления нет.', 'Размер файла превышает лимит копии.', 'Локальная квота копий исчерпана.', 'Копии отключены; несохранённые правки остаются только в памяти.', 'Содержимое на диске изменилось. Проверьте перед сохранением; автоматической перезаписи нет.'],
    ar: ['نسخ استعادة الملفات', 'نسخ استعادة الملفات غير المحفوظة', 'احتفظ محليًا بنسخ للتعديلات غير المحفوظة دون تغيير الملفات الأصلية.', 'في الذاكرة فقط', 'جارٍ النسخ الاحتياطي', 'نُسخت محليًا (الأصل غير محفوظ)', 'فشلت عملية الاستعادة. أعد المحاولة.', 'الموقع للقراءة فقط ولا يمكن تعديل الأصل.', 'الملف أو المشروع غير متاح.', 'فتح النسخة', 'إعادة النسخ', 'حذف النسخة', 'حذف نسخة الاستعادة هذه؟ يبقى الملف الأصلي، وقد تُفقد التعديلات غير المحفوظة.', 'إلغاء', 'لا توجد نسخ استعادة.', 'يتجاوز الملف الحد الأقصى لحجم نسخة الاستعادة.', 'امتلأت السعة المحلية لنسخ الاستعادة.', 'نسخ الاستعادة متوقفة؛ تبقى التعديلات غير المحفوظة في الذاكرة فقط.', 'تغيّر محتوى القرص. راجعه قبل الحفظ؛ لا توجد كتابة تلقائية فوقه.'],
    hi: ['फ़ाइल पुनर्प्राप्ति प्रतियाँ', 'बिना सहेजी फ़ाइलों की पुनर्प्राप्ति प्रतियाँ', 'मूल फ़ाइलें बदले बिना, न सहेजे गए बदलावों की स्थानीय प्रतियाँ रखें।', 'केवल मेमोरी में', 'बैकअप बन रहा है', 'स्थानीय बैकअप तैयार (मूल नहीं सहेजा)', 'पुनर्प्राप्ति विफल हुई। फिर कोशिश करें।', 'स्थान केवल पढ़ने योग्य है; मूल फ़ाइल नहीं बदल सकते।', 'फ़ाइल या प्रोजेक्ट उपलब्ध नहीं है।', 'प्रति खोलें', 'बैकअप फिर बनाएँ', 'प्रति हटाएँ', 'यह पुनर्प्राप्ति प्रति हटाएँ? मूल फ़ाइल रहेगी; न सहेजे बदलाव खो सकते हैं।', 'रद्द करें', 'कोई पुनर्प्राप्ति प्रति नहीं है।', 'फ़ाइल पुनर्प्राप्ति प्रति की आकार सीमा से बड़ी है।', 'स्थानीय पुनर्प्राप्ति प्रतियों की सीमा भर गई है।', 'पुनर्प्राप्ति प्रतियाँ बंद हैं; न सहेजे बदलाव केवल मेमोरी में रहेंगे।', 'डिस्क का पाठ बदल गया है। सहेजने से पहले जाँचें; अपने-आप ओवरराइट नहीं होगा।']
};

const copyMessages: Record<NextMuxDesktopLocale, readonly [string, string]> = {
    'zh-CN': ['复制当前侧全文', '已复制当前侧全文；文件尚未保存。'],
    'zh-TW': ['複製目前側全文', '已複製目前側全文；檔案尚未儲存。'],
    en: ['Copy all text on this side', 'This side was copied; the file was not saved.'],
    ja: ['この側の全文をコピー', 'この側の全文をコピーしました。ファイルは保存されていません。'],
    ko: ['현재 쪽 전체 텍스트 복사', '현재 쪽을 복사했습니다. 파일은 저장되지 않았습니다.'],
    es: ['Copiar todo el texto de este lado', 'Se copió este lado; el archivo no se ha guardado.'],
    fr: ['Copier tout le texte de ce côté', 'Ce côté a été copié ; le fichier n’a pas été enregistré.'],
    de: ['Gesamten Text dieser Seite kopieren', 'Diese Seite wurde kopiert; die Datei wurde nicht gespeichert.'],
    'pt-BR': ['Copiar todo o texto deste lado', 'Este lado foi copiado; o arquivo não foi salvo.'],
    ru: ['Копировать весь текст этой стороны', 'Текст этой стороны скопирован; файл не сохранён.'],
    ar: ['نسخ كل نص الجانب الحالي', 'نُسخ هذا الجانب؛ لم يُحفظ الملف.'],
    hi: ['इस तरफ़ का पूरा पाठ कॉपी करें', 'इस तरफ़ का पाठ कॉपी हुआ; फ़ाइल सहेजी नहीं गई।']
};

const saveAsMessages: Record<NextMuxDesktopLocale, readonly [string, string, string, string, string, string, string, string]> = {
    'zh-CN': ['将当前侧另存为新文件', '当前侧已另存；原文件未改动，恢复副本仍保留。', '目标已存在，请选择新的文件名。', '不能选择原文件，请选择新的位置或文件名。', '另存内容超过 16 MiB 限制。', '内容或页面已改变，本次另存已取消；请重新选择。', '此文件系统不支持安全创建，请选择另一个本地位置。', '未能确认另存完成，请检查目标文件后重试；原文件和恢复副本未改动。'],
    'zh-TW': ['將目前側另存為新檔案', '目前側已另存；原檔案未變更，復原副本仍保留。', '目標已存在，請選擇新的檔名。', '不能選擇原檔案，請選擇新的位置或檔名。', '另存內容超過 16 MiB 限制。', '內容或頁面已變更，本次另存已取消；請重新選擇。', '此檔案系統不支援安全建立，請選擇其他本機位置。', '無法確認另存完成，請檢查目標檔案後重試；原檔案及復原副本未變更。'],
    en: ['Save this side as a new file', 'This side was saved separately; the original and recovery copy are unchanged.', 'The destination exists. Choose a new filename.', 'Choose a location or filename different from the original.', 'The export exceeds the 16 MiB limit.', 'The content or view changed. Export cancelled; please select again.', 'This filesystem cannot safely create the file. Choose another local location.', 'Export could not be confirmed. Check the destination before retrying; the original and recovery copy are unchanged.'],
    ja: ['この側を新しいファイルとして保存', '別のファイルに保存しました。原本と復元用コピーは変更していません。', '保存先は存在します。新しいファイル名を選択してください。', '原本とは異なる場所またはファイル名を選択してください。', '保存する内容が 16 MiB の上限を超えています。', '内容または画面が変わったため保存を中止しました。再度選択してください。', 'このファイルシステムでは安全に作成できません。別のローカル保存先を選択してください。', '保存完了を確認できません。保存先を確認してから再試行してください。原本と復元用コピーは変更していません。'],
    ko: ['현재 쪽을 새 파일로 저장', '별도 파일로 저장했습니다. 원본과 복구 사본은 그대로입니다.', '대상이 이미 있습니다. 새 파일 이름을 선택하세요.', '원본과 다른 위치 또는 파일 이름을 선택하세요.', '저장할 내용이 16 MiB 한도를 초과합니다.', '내용 또는 화면이 변경되어 저장을 취소했습니다. 다시 선택하세요.', '이 파일 시스템에서는 안전하게 만들 수 없습니다. 다른 로컬 위치를 선택하세요.', '저장 완료를 확인할 수 없습니다. 대상을 확인한 후 다시 시도하세요. 원본과 복구 사본은 그대로입니다.'],
    es: ['Guardar este lado como archivo nuevo', 'Este lado se guardó por separado; el original y la copia de recuperación no cambiaron.', 'El destino existe. Elige un nombre nuevo.', 'Elige una ubicación o un nombre distinto del original.', 'El contenido supera el límite de 16 MiB.', 'El contenido o la vista cambió. Se canceló el guardado; selecciona de nuevo.', 'Este sistema de archivos no permite crear el archivo de forma segura. Elige otra ubicación local.', 'No se pudo confirmar el guardado. Revisa el destino antes de reintentar; el original y la copia no cambiaron.'],
    fr: ['Enregistrer ce côté dans un nouveau fichier', 'Ce côté a été enregistré séparément ; l’original et la copie de récupération sont inchangés.', 'La destination existe. Choisissez un nouveau nom.', 'Choisissez un emplacement ou un nom différent de l’original.', 'Le contenu dépasse la limite de 16 MiB.', 'Le contenu ou la vue a changé. Enregistrement annulé ; sélectionnez à nouveau.', 'Ce système de fichiers ne permet pas une création sûre. Choisissez un autre emplacement local.', 'Enregistrement non confirmé. Vérifiez la destination avant de réessayer ; l’original et la copie sont inchangés.'],
    de: ['Diese Seite als neue Datei speichern', 'Diese Seite wurde separat gespeichert; Original und Wiederherstellungskopie sind unverändert.', 'Das Ziel existiert. Wählen Sie einen neuen Dateinamen.', 'Wählen Sie einen anderen Speicherort oder Dateinamen als beim Original.', 'Der Inhalt überschreitet die Grenze von 16 MiB.', 'Inhalt oder Ansicht geändert. Speichern abgebrochen; bitte erneut auswählen.', 'Dieses Dateisystem erlaubt keine sichere Erstellung. Wählen Sie einen anderen lokalen Speicherort.', 'Speichern nicht bestätigt. Prüfen Sie das Ziel vor einem neuen Versuch; Original und Kopie sind unverändert.'],
    'pt-BR': ['Salvar este lado como novo arquivo', 'Este lado foi salvo separadamente; o original e a cópia de recuperação não mudaram.', 'O destino existe. Escolha um novo nome.', 'Escolha um local ou nome diferente do original.', 'O conteúdo excede o limite de 16 MiB.', 'O conteúdo ou a tela mudou. Salvamento cancelado; selecione novamente.', 'Este sistema de arquivos não permite criar com segurança. Escolha outro local no computador.', 'Não foi possível confirmar o salvamento. Confira o destino antes de tentar novamente; o original e a cópia não mudaram.'],
    ru: ['Сохранить эту сторону в новый файл', 'Эта сторона сохранена отдельно; оригинал и копия восстановления не изменены.', 'Файл назначения существует. Выберите новое имя.', 'Выберите путь или имя, отличное от оригинала.', 'Содержимое превышает лимит 16 МиБ.', 'Содержимое или экран изменились. Сохранение отменено; выберите снова.', 'Эта файловая система не поддерживает безопасное создание. Выберите другое локальное место.', 'Сохранение не подтверждено. Проверьте файл назначения перед повтором; оригинал и копия не изменены.'],
    ar: ['حفظ هذا الجانب كملف جديد', 'حُفظ هذا الجانب منفصلًا؛ لم يتغير الأصل ولا نسخة الاستعادة.', 'الوجهة موجودة. اختر اسم ملف جديدًا.', 'اختر موقعًا أو اسمًا مختلفًا عن الأصل.', 'يتجاوز المحتوى حد 16 MiB.', 'تغيّر المحتوى أو العرض. أُلغي الحفظ؛ اختر مجددًا.', 'لا يدعم نظام الملفات هذا الإنشاء الآمن. اختر موقعًا محليًا آخر.', 'تعذّر تأكيد الحفظ. تحقق من الوجهة قبل إعادة المحاولة؛ لم يتغير الأصل ولا نسخة الاستعادة.'],
    hi: ['इस तरफ़ को नई फ़ाइल में सहेजें', 'यह तरफ़ अलग सहेजी गई; मूल फ़ाइल और पुनर्प्राप्ति प्रति नहीं बदलीं।', 'लक्ष्य पहले से मौजूद है। नया फ़ाइल नाम चुनें।', 'मूल से अलग स्थान या फ़ाइल नाम चुनें।', 'सामग्री 16 MiB की सीमा से अधिक है।', 'सामग्री या दृश्य बदल गया। सहेजना रद्द हुआ; फिर चुनें।', 'यह फ़ाइल सिस्टम सुरक्षित रूप से फ़ाइल नहीं बना सकता। दूसरा स्थानीय स्थान चुनें।', 'सहेजने की पुष्टि नहीं हुई। फिर कोशिश करने से पहले लक्ष्य जाँचें; मूल और पुनर्प्राप्ति प्रति नहीं बदलीं।']
};

export function editorSaveAsErrorKey(error: unknown): EditorRecoveryTextKey {
    const code = (error as { code?: unknown })?.code;
    const text = typeof code === 'string' ? code : error instanceof Error ? error.message : '';
    if (text.includes('EDITOR_SAVE_AS_TARGET_EXISTS')) return 'saveAsExists';
    if (text.includes('EDITOR_SAVE_AS_SAME_SOURCE')) return 'saveAsSource';
    if (text.includes('EDITOR_SAVE_AS_TOO_LARGE')) return 'saveAsTooLarge';
    if (text.includes('EDITOR_SAVE_AS_CANCELLED')) return 'saveAsChanged';
    if (text.includes('EDITOR_SAVE_AS_UNSUPPORTED_FILESYSTEM')) return 'saveAsUnsupported';
    return 'saveAsFailed';
}

function uncheckedEditorRecoveryText(locale: NextMuxDesktopLocale, key: EditorRecoveryTextKey): string {
    if (key === 'copyAll' || key === 'copied') return copyMessages[locale][key === 'copyAll' ? 0 : 1];
    const saveAsIndex = (saveAsKeys as readonly string[]).indexOf(key);
    if (saveAsIndex >= 0) return saveAsMessages[locale][saveAsIndex];
    return messages[locale][keys.indexOf(key)];
}

/** Only known protocol codes select fixed text. Never render an exception. */
export function editorRecoveryErrorKey(code?: string): EditorRecoveryTextKey {
    switch (code) {
        case 'EDITOR_RECOVERY_TOO_LARGE': return 'tooLarge';
        case 'EDITOR_RECOVERY_QUOTA_EXCEEDED': return 'quota';
        case 'EDITOR_RECOVERY_DISABLED': return 'disabled';
        case 'EDITOR_RECOVERY_CONFLICT': return 'conflict';
        case 'EDITOR_RECOVERY_READ_ONLY': return 'readonly';
        case 'EDITOR_RECOVERY_UNAVAILABLE': return 'unavailable';
        case 'EDITOR_RECOVERY_NOT_FOUND': return 'unavailable';
        case 'EDITOR_RECOVERY_UNSAFE_PATH': return 'unavailable';
        default: return 'failed';
    }
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function editorRecoveryText(locale: Parameters<typeof uncheckedEditorRecoveryText>[0], key: Parameters<typeof uncheckedEditorRecoveryText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedEditorRecoveryText>>): string {
    return totalCopy(locale, key, language => uncheckedEditorRecoveryText(language, key, ...rest));
}
