import { archiveProjectText } from './nextmux-archive-project-locale';
import { agentChildDraftText } from './nextmux-agent-child-draft-locale';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

const keys = ['title', 'description', 'privacy', 'exportAll', 'exportSelected', 'chooseArchive', 'previewTitle', 'previewSummary', 'conflicts', 'skipConflicts', 'copyConflicts', 'cancel', 'importNow', 'importing', 'exporting', 'chooseImport', 'chooseExport', 'exported', 'imported', 'failed', 'busyHint', 'historyDisabled', 'saveFailed', 'existing', 'copyExists', 'noConversations', 'warnings'] as const;
export type ConversationArchiveTextKey = typeof keys[number];
const translations: Readonly<Record<NextMuxDesktopLocale, readonly string[]>> = {
    'zh-CN': ['会话迁移', '迁移会话与附件，不迁移项目文件、凭据或执行队列。', '存档未加密，聊天正文与附件可能包含密钥或隐私。请妥善保管。', '导出', '导出所选', '导入', '导入预览', '{conversations} 个会话 · {attachments} 个附件 · {bytes}', '{count} 个会话标识已存在', '跳过已有会话', '导入为副本', '取消', '确认导入', '正在导入…', '正在导出…', '选择要导入的会话存档', '保存会话存档', '已导出 {conversations} 个会话与 {attachments} 个附件', '已导入 {imported} 个会话，跳过 {skipped} 个', '会话迁移失败', '请先暂停正在运行的任务，再迁移会话。', '请先开启保存本机对话记录。', '当前会话尚未保存，导出已停止，请重试。', '已存在', '副本已存在', '没有可导出的会话', '迁移说明'],
    'zh-TW': ['會話移轉', '移轉會話與附件，不移轉專案檔案、憑證或執行佇列。', '存檔未加密，聊天內容與附件可能包含金鑰或隱私。請妥善保管。', '匯出', '匯出所選', '匯入', '匯入預覽', '{conversations} 個會話 · {attachments} 個附件 · {bytes}', '{count} 個會話識別碼已存在', '略過現有會話', '匯入為副本', '取消', '確認匯入', '正在匯入…', '正在匯出…', '選擇要匯入的會話存檔', '儲存會話存檔', '已匯出 {conversations} 個會話與 {attachments} 個附件', '已匯入 {imported} 個會話，略過 {skipped} 個', '會話移轉失敗', '請先暫停執行中的工作，再移轉會話。', '請先開啟儲存本機對話記錄。', '目前會話尚未儲存，匯出已停止，請重試。', '已存在', '副本已存在', '沒有可匯出的會話', '移轉說明'],
    en: ['Conversation transfer', 'Transfer conversations and attachments, not project files, credentials or execution queues.', 'Archives are not encrypted. Conversation text and attachments may contain keys or private information. Keep them secure.', 'Export', 'Export selected', 'Import', 'Import preview', '{conversations} conversations · {attachments} attachments · {bytes}', '{count} conversation IDs already exist', 'Skip existing', 'Import copies', 'Cancel', 'Import now', 'Importing…', 'Exporting…', 'Choose conversation archive to import', 'Save conversation archive', 'Exported {conversations} conversations and {attachments} attachments', 'Imported {imported} conversations; skipped {skipped}', 'Conversation transfer failed', 'Pause running tasks before transferring conversations.', 'Enable local conversation history first.', 'The current conversation could not be saved. Export stopped; please retry.', 'Exists', 'Copy exists', 'No conversations to export', 'Transfer notes'],
    ja: ['会話の移行', '会話と添付ファイルを移行します。プロジェクトファイル、認証情報、実行キューは移行しません。', 'アーカイブは暗号化されません。会話や添付ファイルにキーや個人情報が含まれる場合があります。安全に保管してください。', 'エクスポート', '選択分をエクスポート', 'インポート', 'インポートの確認', '{conversations} 件の会話 · {attachments} 件の添付 · {bytes}', '{count} 件の会話 ID が既に存在します', '既存をスキップ', 'コピーとして取り込む', 'キャンセル', 'インポート', 'インポート中…', 'エクスポート中…', 'インポートする会話アーカイブを選択', '会話アーカイブを保存', '{conversations} 件の会話と {attachments} 件の添付をエクスポートしました', '{imported} 件をインポート、{skipped} 件をスキップしました', '会話の移行に失敗しました', '実行中のタスクを一時停止してから会話を移行してください。', '先にローカルの会話履歴保存を有効にしてください。', '現在の会話を保存できませんでした。エクスポートを停止しました。再試行してください。', '既存', 'コピーあり', 'エクスポートする会話がありません', '移行に関する注意'],
    ko: ['대화 이전', '대화와 첨부 파일을 이전합니다. 프로젝트 파일, 자격 증명, 실행 대기열은 이전하지 않습니다.', '보관 파일은 암호화되지 않습니다. 대화와 첨부 파일에 키나 개인정보가 포함될 수 있으니 안전하게 보관하세요.', '내보내기', '선택 항목 내보내기', '가져오기', '가져오기 미리보기', '대화 {conversations}개 · 첨부 {attachments}개 · {bytes}', '대화 ID {count}개가 이미 존재합니다', '기존 대화 건너뛰기', '사본으로 가져오기', '취소', '가져오기', '가져오는 중…', '내보내는 중…', '가져올 대화 보관 파일 선택', '대화 보관 파일 저장', '대화 {conversations}개와 첨부 {attachments}개를 내보냈습니다', '대화 {imported}개 가져옴, {skipped}개 건너뜀', '대화 이전 실패', '실행 중인 작업을 일시 중지한 후 대화를 이전하세요.', '먼저 로컬 대화 기록 저장을 켜세요.', '현재 대화를 저장하지 못해 내보내기를 중단했습니다. 다시 시도하세요.', '이미 있음', '사본 있음', '내보낼 대화가 없습니다', '이전 안내'],
    es: ['Transferir conversaciones', 'Transfiere conversaciones y adjuntos, no archivos del proyecto, credenciales ni colas de ejecución.', 'Los archivos no están cifrados. El texto y los adjuntos pueden contener claves o datos privados. Guárdalos de forma segura.', 'Exportar', 'Exportar selección', 'Importar', 'Vista previa', '{conversations} conversaciones · {attachments} adjuntos · {bytes}', 'Ya existen {count} ID de conversación', 'Omitir existentes', 'Importar copias', 'Cancelar', 'Importar ahora', 'Importando…', 'Exportando…', 'Elegir archivo de conversaciones para importar', 'Guardar archivo de conversaciones', 'Se exportaron {conversations} conversaciones y {attachments} adjuntos', 'Se importaron {imported}; se omitieron {skipped}', 'Error al transferir conversaciones', 'Pausa las tareas en curso antes de transferir conversaciones.', 'Activa primero el historial local de conversaciones.', 'No se pudo guardar la conversación actual. Exportación detenida; vuelve a intentarlo.', 'Existe', 'La copia existe', 'No hay conversaciones para exportar', 'Notas de transferencia'],
    fr: ['Transférer les conversations', 'Transfère les conversations et pièces jointes, pas les fichiers du projet, identifiants ou files d’exécution.', 'Les archives ne sont pas chiffrées. Les textes et pièces jointes peuvent contenir des clés ou des données privées. Protégez-les.', 'Exporter', 'Exporter la sélection', 'Importer', 'Aperçu de l’importation', '{conversations} conversations · {attachments} pièces jointes · {bytes}', '{count} identifiants de conversation existent déjà', 'Ignorer les existantes', 'Importer des copies', 'Annuler', 'Importer', 'Importation…', 'Exportation…', 'Choisir une archive de conversations à importer', 'Enregistrer l’archive', '{conversations} conversations et {attachments} pièces jointes exportées', '{imported} conversations importées ; {skipped} ignorées', 'Échec du transfert', 'Mettez les tâches en cours en pause avant le transfert.', 'Activez d’abord l’historique local des conversations.', 'La conversation actuelle n’a pas pu être enregistrée. Exportation arrêtée ; réessayez.', 'Existe', 'Copie existante', 'Aucune conversation à exporter', 'Notes de transfert'],
    de: ['Gespräche übertragen', 'Überträgt Gespräche und Anhänge, keine Projektdateien, Zugangsdaten oder Ausführungswarteschlangen.', 'Archive sind nicht verschlüsselt. Texte und Anhänge können Schlüssel oder private Daten enthalten. Sicher aufbewahren.', 'Exportieren', 'Auswahl exportieren', 'Importieren', 'Importvorschau', '{conversations} Gespräche · {attachments} Anhänge · {bytes}', '{count} Gesprächs-IDs sind bereits vorhanden', 'Vorhandene überspringen', 'Kopien importieren', 'Abbrechen', 'Jetzt importieren', 'Importieren…', 'Exportieren…', 'Gesprächsarchiv zum Import auswählen', 'Gesprächsarchiv speichern', '{conversations} Gespräche und {attachments} Anhänge exportiert', '{imported} Gespräche importiert; {skipped} übersprungen', 'Übertragung fehlgeschlagen', 'Laufende Aufgaben vor der Übertragung pausieren.', 'Zuerst den lokalen Gesprächsverlauf aktivieren.', 'Das aktuelle Gespräch konnte nicht gespeichert werden. Export abgebrochen; bitte erneut versuchen.', 'Vorhanden', 'Kopie vorhanden', 'Keine Gespräche zum Exportieren', 'Hinweise zur Übertragung'],
    'pt-BR': ['Transferir conversas', 'Transfere conversas e anexos, não arquivos do projeto, credenciais ou filas de execução.', 'Os arquivos não são criptografados. Textos e anexos podem conter chaves ou dados privados. Guarde-os com segurança.', 'Exportar', 'Exportar seleção', 'Importar', 'Prévia da importação', '{conversations} conversas · {attachments} anexos · {bytes}', '{count} IDs de conversa já existem', 'Ignorar existentes', 'Importar cópias', 'Cancelar', 'Importar agora', 'Importando…', 'Exportando…', 'Escolher arquivo de conversas para importar', 'Salvar arquivo de conversas', '{conversations} conversas e {attachments} anexos exportados', '{imported} conversas importadas; {skipped} ignoradas', 'Falha na transferência', 'Pause as tarefas em execução antes de transferir conversas.', 'Ative primeiro o histórico local de conversas.', 'Não foi possível salvar a conversa atual. Exportação interrompida; tente novamente.', 'Já existe', 'Cópia existente', 'Nenhuma conversa para exportar', 'Notas da transferência'],
    ru: ['Перенос бесед', 'Переносит беседы и вложения, но не файлы проекта, учётные данные или очереди выполнения.', 'Архивы не зашифрованы. Тексты и вложения могут содержать ключи или личные данные. Храните их безопасно.', 'Экспорт', 'Экспорт выбранного', 'Импорт', 'Предпросмотр импорта', '{conversations} бесед · {attachments} вложений · {bytes}', 'Уже существуют идентификаторы {count} бесед', 'Пропустить существующие', 'Импортировать копии', 'Отмена', 'Импортировать', 'Импорт…', 'Экспорт…', 'Выберите архив бесед для импорта', 'Сохранить архив бесед', 'Экспортировано бесед: {conversations}, вложений: {attachments}', 'Импортировано: {imported}; пропущено: {skipped}', 'Не удалось перенести беседы', 'Перед переносом приостановите выполняемые задачи.', 'Сначала включите локальную историю бесед.', 'Не удалось сохранить текущую беседу. Экспорт остановлен; повторите попытку.', 'Существует', 'Копия существует', 'Нет бесед для экспорта', 'Примечания к переносу'],
    ar: ['نقل المحادثات', 'ينقل المحادثات والمرفقات، وليس ملفات المشروع أو بيانات الاعتماد أو قوائم التنفيذ.', 'الأرشيف غير مشفّر. قد تحتوي النصوص والمرفقات على مفاتيح أو بيانات خاصة. احفظه بأمان.', 'تصدير', 'تصدير المحدد', 'استيراد', 'معاينة الاستيراد', '{conversations} محادثة · {attachments} مرفق · {bytes}', '{count} معرّف محادثة موجود بالفعل', 'تخطي الموجود', 'استيراد نسخ', 'إلغاء', 'استيراد الآن', 'جارٍ الاستيراد…', 'جارٍ التصدير…', 'اختيار أرشيف محادثات للاستيراد', 'حفظ أرشيف المحادثات', 'تم تصدير {conversations} محادثة و{attachments} مرفق', 'تم استيراد {imported} وتخطي {skipped}', 'تعذّر نقل المحادثات', 'أوقف المهام الجارية مؤقتًا قبل نقل المحادثات.', 'فعّل سجل المحادثات المحلي أولًا.', 'تعذّر حفظ المحادثة الحالية. توقف التصدير؛ أعد المحاولة.', 'موجود', 'النسخة موجودة', 'لا توجد محادثات للتصدير', 'ملاحظات النقل'],
    hi: ['वार्तालाप स्थानांतरण', 'वार्तालाप और संलग्नक स्थानांतरित होते हैं; प्रोजेक्ट फ़ाइलें, क्रेडेंशियल या निष्पादन कतारें नहीं।', 'अभिलेख एन्क्रिप्टेड नहीं हैं। पाठ और संलग्नकों में कुंजियाँ या निजी जानकारी हो सकती है। सुरक्षित रखें।', 'निर्यात करें', 'चयनित निर्यात करें', 'आयात करें', 'आयात पूर्वावलोकन', '{conversations} वार्तालाप · {attachments} संलग्नक · {bytes}', '{count} वार्तालाप ID पहले से मौजूद हैं', 'मौजूदा छोड़ें', 'प्रतियाँ आयात करें', 'रद्द करें', 'अभी आयात करें', 'आयात जारी…', 'निर्यात जारी…', 'आयात के लिए वार्तालाप अभिलेख चुनें', 'वार्तालाप अभिलेख सहेजें', '{conversations} वार्तालाप और {attachments} संलग्नक निर्यात हुए', '{imported} आयात हुए; {skipped} छोड़े गए', 'वार्तालाप स्थानांतरण विफल', 'वार्तालाप स्थानांतरित करने से पहले चालू कार्य रोकें।', 'पहले स्थानीय वार्तालाप इतिहास सक्षम करें।', 'वर्तमान वार्तालाप सहेजा नहीं जा सका। निर्यात रुका; पुनः प्रयास करें।', 'मौजूद', 'प्रति मौजूद', 'निर्यात करने के लिए कोई वार्तालाप नहीं', 'स्थानांतरण संबंधी जानकारी']
};

function uncheckedArchiveText(locale: NextMuxDesktopLocale, key: ConversationArchiveTextKey, values: Readonly<Record<string, string | number>> = {}): string {
    const template = translations[locale][keys.indexOf(key)];
    return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => values[name] === undefined ? placeholder : String(values[name]));
}

const warningMessages: Readonly<Record<NextMuxDesktopLocale, readonly string[]>> = {
    "en": [
        "Hidden reasoning was omitted.",
        "Runtime activity metadata was omitted.",
        "Child-task citations without a valid identity were omitted.",
        "Unsent messages were omitted.",
        "Some archive metadata was omitted."
    ],
    "zh-CN": [
        "已省略隐藏的推理内容。",
        "已省略运行时活动元数据。",
        "已省略缺少有效身份的子任务引用。",
        "已省略未发送的消息。",
        "已省略部分档案元数据。"
    ],
    "zh-TW": [
        "已省略隱藏的推理內容。",
        "已省略執行階段活動中繼資料。",
        "已省略缺少有效身分的子工作引用。",
        "已省略未傳送的訊息。",
        "已省略部分封存中繼資料。"
    ],
    "ja": [
        "非表示の推論内容は省略されました。",
        "実行時の活動メタデータは省略されました。",
        "有効な識別情報のない子タスクの引用は省略されました。",
        "未送信メッセージは省略されました。",
        "アーカイブの一部のメタデータは省略されました。"
    ],
    "ko": [
        "숨겨진 추론 내용은 제외되었습니다.",
        "런타임 활동 메타데이터는 제외되었습니다.",
        "유효한 식별자가 없는 하위 작업 인용은 제외되었습니다.",
        "보내지 않은 메시지는 제외되었습니다.",
        "일부 보관 메타데이터는 제외되었습니다."
    ],
    "es": [
        "Se omitió el razonamiento oculto.",
        "Se omitieron los metadatos de actividad de ejecución.",
        "Se omitieron las citas de subtareas sin identidad válida.",
        "Se omitieron los mensajes sin enviar.",
        "Se omitieron algunos metadatos del archivo."
    ],
    "fr": [
        "Le raisonnement masqué a été omis.",
        "Les métadonnées d’activité d’exécution ont été omises.",
        "Les citations de sous-tâches sans identité valide ont été omises.",
        "Les messages non envoyés ont été omis.",
        "Certaines métadonnées de l’archive ont été omises."
    ],
    "de": [
        "Verborgene Überlegungen wurden ausgelassen.",
        "Metadaten zu Laufzeitaktivitäten wurden ausgelassen.",
        "Zitate aus Teilaufgaben ohne gültige Kennung wurden ausgelassen.",
        "Nicht gesendete Nachrichten wurden ausgelassen.",
        "Einige Archivmetadaten wurden ausgelassen."
    ],
    "pt-BR": [
        "O raciocínio oculto foi omitido.",
        "Os metadados de atividade de execução foram omitidos.",
        "As citações de subtarefas sem identidade válida foram omitidas.",
        "As mensagens não enviadas foram omitidas.",
        "Alguns metadados do arquivo foram omitidos."
    ],
    "ru": [
        "Скрытые рассуждения пропущены.",
        "Метаданные действий во время выполнения пропущены.",
        "Цитаты подзадач без действительного идентификатора пропущены.",
        "Неотправленные сообщения пропущены.",
        "Часть метаданных архива пропущена."
    ],
    "ar": [
        "تم حذف الاستدلال المخفي.",
        "تم حذف بيانات نشاط التشغيل الوصفية.",
        "تم حذف استشهادات المهام الفرعية التي لا تحمل هوية صالحة.",
        "تم حذف الرسائل غير المرسلة.",
        "تم حذف بعض بيانات الأرشيف الوصفية."
    ],
    "hi": [
        "छिपी हुई तर्क सामग्री छोड़ दी गई।",
        "रनटाइम गतिविधि का मेटाडेटा छोड़ दिया गया।",
        "मान्य पहचान के बिना उपकार्य के उद्धरण छोड़ दिए गए।",
        "न भेजे गए संदेश छोड़ दिए गए।",
        "अभिलेख का कुछ मेटाडेटा छोड़ दिया गया।"
    ]
};
export function archiveWarningText(locale: NextMuxDesktopLocale, code: string): string {
    if (code === 'conversation_text_and_attachments_may_contain_secrets') return archiveText(locale, 'privacy');
    if (code === 'runtime_credentials_workspaces_permissions_and_pending_queue_not_imported') return archiveText(locale, 'description');
    if (code === 'project_labels_are_display_only_local_binding_requires_confirmation') return archiveProjectText(locale, 'bindingBoundary');
    if (code === 'unsent_child_drafts_omitted') return agentChildDraftText(locale, 'archiveOmitted');
    const index = ['hidden_reasoning_omitted', 'runtime_activity_metadata_omitted', 'child_citation_identity_missing', 'unsent_queue_omitted'].indexOf(code);
    return warningMessages[locale][index < 0 ? 4 : index];
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function archiveText(locale: Parameters<typeof uncheckedArchiveText>[0], key: Parameters<typeof uncheckedArchiveText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedArchiveText>>): string {
    return totalCopy(locale, key, language => uncheckedArchiveText(language, key, ...rest));
}
