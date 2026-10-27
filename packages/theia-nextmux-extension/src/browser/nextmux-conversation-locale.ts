import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

const en = {
    stopBeforeDelete: 'Please stop this conversation first',
    addCodeHosting: 'Add code hosting service',
    copyMessage: 'Copy message',
    editMessage: 'Edit message',
    cancelEdit: 'Cancel editing',
    sendEditedMessage: 'Send edited message',
    branchTitle: 'Continue from this message?',
    branchPrompt: 'A new branch keeps the original conversation and continues separately from this message.',
    branchAttachmentNote: 'Original attachments will be restored from the managed local cache. If a file is unavailable, sending is blocked until you add it again.',
    attachmentRecoveryFailed: 'Could not restore “{name}”. Add the original file again, then resend.',
    branchSuffix: 'Branch',
    replaceWarning: 'Without a branch, this message and everything after it will be deleted.',
    restoreWorkspaceOption: 'Roll back code',
    restoreWorkspaceHint: 'Only file changes recorded by NextMux can be restored. Changes made by terminal commands or external programs may not be fully covered.',
    createBranch: 'Create branch',
    dontCreate: 'Continue',
    cancel: 'Cancel',
    restoringCode: 'Restoring the workspace to the state before this message…',
    restoreFailed: 'Could not restore the earlier code state.',
    restoreWorkspaceMissing: 'The workspace for this conversation is no longer available.',
    copyReply: 'Copy reply',
    copyContent: 'Copy message content',
    copyId: 'Copy message ID',
    copyConversationId: 'Copy conversation ID',
    copyLocator: 'Copy message link',
    contentCopied: 'Message copied',
    idCopied: 'Message ID copied',
    conversationIdCopied: 'Conversation ID copied',
    locatorCopied: 'Message link copied',
    expandMessage: 'Show more',
    collapseMessage: 'Show less',
    revertFilesOnly: 'Undo this turn’s file changes (keep the chat)',
    moreFiles: '{count} more files'
} as const;

export type ConversationTextKey = keyof typeof en;
type ConversationCatalog = Readonly<Record<ConversationTextKey, string>>;

const translations: Readonly<Record<NextMuxDesktopLocale, ConversationCatalog>> = {
    en,
    'zh-CN': {
        stopBeforeDelete: '请先停止当前对话', addCodeHosting: '添加代码托管服务',
        copyMessage: '复制消息', editMessage: '编辑消息', cancelEdit: '取消编辑', sendEditedMessage: '发送修改后的消息',
        branchTitle: '从这里创建分支？', branchPrompt: '创建分支会保留原对话，从这条消息在新对话中继续。',
        branchAttachmentNote: '原附件会从本机受控缓存恢复；如果某个文件不可用，将阻止发送并提示你重新添加。', attachmentRecoveryFailed: '无法恢复附件“{name}”。请重新添加原文件后再发送。', branchSuffix: '分支',
        replaceWarning: '不创建分支会删除这条消息及其之后的内容。',
        restoreWorkspaceOption: '回滚代码',
        restoreWorkspaceHint: '仅恢复 NextMux 已记录的文件修改；终端命令或外部程序产生的变更可能无法完整恢复。',
        createBranch: '创建分支', dontCreate: '继续', cancel: '取消', restoringCode: '正在将代码恢复到这条消息之前的状态…', restoreFailed: '无法恢复到之前的代码状态。', restoreWorkspaceMissing: '当前对话绑定的工作区已不可用。',
        copyReply: '复制回复', copyContent: '复制本条对话内容', copyId: '复制消息 ID', copyConversationId: '复制对话 ID', copyLocator: '复制定位引用',
        contentCopied: '对话内容已复制', idCopied: '消息 ID 已复制', conversationIdCopied: '对话 ID 已复制', locatorCopied: '消息定位引用已复制', expandMessage: '展开全文', collapseMessage: '收起', revertFilesOnly: '仅还原代码文件（保留聊天记录）', moreFiles: '另有 {count} 个文件'
    },
    'zh-TW': {
        stopBeforeDelete: '請先停止目前對話', addCodeHosting: '新增程式碼託管服務',
        copyMessage: '複製訊息', editMessage: '編輯訊息', cancelEdit: '取消編輯', sendEditedMessage: '傳送修改後的訊息',
        branchTitle: '從這則訊息繼續？', branchPrompt: '建議將目前對話建立為新的對話分支。要立即建立嗎？',
        branchAttachmentNote: '原附件會從本機受控快取還原；若某個檔案無法使用，將阻止傳送並提示你重新加入。', attachmentRecoveryFailed: '無法還原附件「{name}」。請重新加入原始檔案後再傳送。', branchSuffix: '分支',
        replaceWarning: '不建立新分支將永久刪除目前對話中的這則訊息及其後所有訊息。',
        restoreWorkspaceOption: '回復程式碼',
        restoreWorkspaceHint: '僅還原 NextMux 已記錄的檔案修改；終端機指令或外部程式造成的變更可能無法完整還原。',
        createBranch: '建立分支', dontCreate: '繼續', cancel: '取消', restoringCode: '正在將程式碼還原到這則訊息之前的狀態…', restoreFailed: '無法還原先前的程式碼狀態。', restoreWorkspaceMissing: '此對話綁定的工作區已無法使用。',
        copyReply: '複製回覆', copyContent: '複製訊息內容', copyId: '複製訊息 ID', copyConversationId: '複製對話 ID', copyLocator: '複製定位連結',
        contentCopied: '訊息內容已複製', idCopied: '訊息 ID 已複製', conversationIdCopied: '對話 ID 已複製', locatorCopied: '訊息定位連結已複製', expandMessage: '展開全文', collapseMessage: '收起', revertFilesOnly: '僅還原程式碼檔案（保留聊天記錄）', moreFiles: '另有 {count} 個檔案'
    },
    ja: {
        stopBeforeDelete: '先にこの会話を停止してください', addCodeHosting: 'コードホスティングサービスを追加',
        copyMessage: 'メッセージをコピー', editMessage: 'メッセージを編集', cancelEdit: '編集をキャンセル', sendEditedMessage: '編集したメッセージを送信',
        branchTitle: 'このメッセージから続けますか？', branchPrompt: '新しい会話ブランチを作成することをおすすめします。作成しますか？',
        branchAttachmentNote: '元の添付ファイルはローカルの管理キャッシュから復元されます。利用できないファイルがある場合は、再追加するまで送信できません。', attachmentRecoveryFailed: '添付ファイル「{name}」を復元できません。元のファイルを追加し直してから再送信してください。', branchSuffix: 'ブランチ',
        replaceWarning: 'ブランチを作成しない場合、このメッセージ以降は現在の会話から完全に削除されます。',
        restoreWorkspaceOption: 'コードをロールバック',
        restoreWorkspaceHint: 'NextMux が記録したファイル変更のみ復元できます。ターミナルコマンドや外部アプリによる変更は完全に復元できない場合があります。',
        createBranch: 'ブランチを作成', dontCreate: '続行', cancel: 'キャンセル', restoringCode: 'このメッセージより前の状態にコードを復元しています…', restoreFailed: '以前のコード状態を復元できませんでした。', restoreWorkspaceMissing: 'この会話のワークスペースは利用できません。',
        copyReply: '返信をコピー', copyContent: '内容をコピー', copyId: 'メッセージ ID をコピー', copyConversationId: '会話 ID をコピー', copyLocator: 'メッセージリンクをコピー',
        contentCopied: 'メッセージをコピーしました', idCopied: 'メッセージ ID をコピーしました', conversationIdCopied: '会話 ID をコピーしました', locatorCopied: 'メッセージリンクをコピーしました', expandMessage: '全文を表示', collapseMessage: '折りたたむ', revertFilesOnly: 'このターンのファイル変更だけ元に戻す（会話は残す）', moreFiles: 'ほか {count} 個のファイル'
    },
    ko: {
        stopBeforeDelete: '먼저 현재 대화를 중지하세요', addCodeHosting: '코드 호스팅 서비스 추가',
        copyMessage: '메시지 복사', editMessage: '메시지 편집', cancelEdit: '편집 취소', sendEditedMessage: '편집한 메시지 보내기',
        branchTitle: '이 메시지부터 계속할까요?', branchPrompt: '새 대화 분기를 만드는 것을 권장합니다. 지금 만들까요?',
        branchAttachmentNote: '원래 첨부 파일은 로컬 관리 캐시에서 복원됩니다. 사용할 수 없는 파일이 있으면 다시 추가할 때까지 전송이 차단됩니다.', attachmentRecoveryFailed: '첨부 파일 “{name}”을(를) 복원할 수 없습니다. 원본 파일을 다시 추가한 후 보내세요.', branchSuffix: '분기',
        replaceWarning: '분기를 만들지 않으면 이 메시지와 이후 모든 메시지가 현재 대화에서 영구 삭제됩니다.',
        restoreWorkspaceOption: '코드 롤백',
        restoreWorkspaceHint: 'NextMux가 기록한 파일 변경만 복원됩니다. 터미널 명령이나 외부 프로그램의 변경은 완전히 복원되지 않을 수 있습니다.',
        createBranch: '분기 만들기', dontCreate: '계속', cancel: '취소', restoringCode: '이 메시지 이전 상태로 코드를 복원하는 중…', restoreFailed: '이전 코드 상태를 복원하지 못했습니다.', restoreWorkspaceMissing: '이 대화의 작업 공간을 사용할 수 없습니다.',
        copyReply: '답변 복사', copyContent: '메시지 내용 복사', copyId: '메시지 ID 복사', copyConversationId: '대화 ID 복사', copyLocator: '메시지 링크 복사',
        contentCopied: '메시지를 복사했습니다', idCopied: '메시지 ID를 복사했습니다', conversationIdCopied: '대화 ID를 복사했습니다', locatorCopied: '메시지 링크를 복사했습니다', expandMessage: '전체 보기', collapseMessage: '접기', revertFilesOnly: '이 턴의 파일 변경만 되돌리기(대화 유지)', moreFiles: '파일 {count}개 더'
    },
    es: {
        stopBeforeDelete: 'Detén primero esta conversación', addCodeHosting: 'Añadir servicio de alojamiento de código',
        copyMessage: 'Copiar mensaje', editMessage: 'Editar mensaje', cancelEdit: 'Cancelar edición', sendEditedMessage: 'Enviar mensaje editado',
        branchTitle: '¿Continuar desde este mensaje?', branchPrompt: 'Recomendamos crear una nueva rama de conversación. ¿Quieres crearla ahora?',
        branchAttachmentNote: 'Los adjuntos originales se restaurarán desde la caché local administrada. Si falta algún archivo, el envío se bloqueará hasta que lo vuelvas a añadir.', attachmentRecoveryFailed: 'No se pudo restaurar “{name}”. Vuelve a añadir el archivo original antes de enviarlo.', branchSuffix: 'Rama',
        replaceWarning: 'Si continúas sin crear una rama, este mensaje y todos los posteriores se eliminarán permanentemente de la conversación actual.',
        restoreWorkspaceOption: 'Revertir código',
        restoreWorkspaceHint: 'Solo se restauran los cambios de archivo registrados por NextMux. Los cambios de terminal o programas externos pueden no quedar cubiertos por completo.',
        createBranch: 'Crear rama', dontCreate: 'Continuar', cancel: 'Cancelar', restoringCode: 'Restaurando el código al estado anterior a este mensaje…', restoreFailed: 'No se pudo restaurar el estado anterior del código.', restoreWorkspaceMissing: 'El espacio de trabajo de esta conversación ya no está disponible.',
        copyReply: 'Copiar respuesta', copyContent: 'Copiar contenido', copyId: 'Copiar ID del mensaje', copyConversationId: 'Copiar ID de conversación', copyLocator: 'Copiar enlace del mensaje',
        contentCopied: 'Mensaje copiado', idCopied: 'ID del mensaje copiado', conversationIdCopied: 'ID de conversación copiado', locatorCopied: 'Enlace del mensaje copiado', expandMessage: 'Mostrar más', collapseMessage: 'Mostrar menos', revertFilesOnly: 'Deshacer solo los cambios de archivos (conservar el chat)', moreFiles: '{count} archivos más'
    },
    fr: {
        stopBeforeDelete: 'Arrêtez d’abord cette conversation', addCodeHosting: 'Ajouter un service d’hébergement de code',
        copyMessage: 'Copier le message', editMessage: 'Modifier le message', cancelEdit: 'Annuler la modification', sendEditedMessage: 'Envoyer le message modifié',
        branchTitle: 'Continuer depuis ce message ?', branchPrompt: 'Nous recommandons de créer une nouvelle branche de conversation. La créer maintenant ?',
        branchAttachmentNote: 'Les pièces jointes d’origine seront restaurées depuis le cache local géré. Si un fichier manque, l’envoi sera bloqué jusqu’à ce que vous l’ajoutiez à nouveau.', attachmentRecoveryFailed: 'Impossible de restaurer « {name} ». Ajoutez à nouveau le fichier d’origine avant de renvoyer le message.', branchSuffix: 'Branche',
        replaceWarning: 'Sans nouvelle branche, ce message et tous les suivants seront définitivement supprimés de la conversation actuelle.',
        restoreWorkspaceOption: 'Restaurer le code',
        restoreWorkspaceHint: 'Seules les modifications de fichiers enregistrées par NextMux peuvent être restaurées. Les changements issus du terminal ou de programmes externes peuvent être incomplets.',
        createBranch: 'Créer une branche', dontCreate: 'Continuer', cancel: 'Annuler', restoringCode: 'Restauration du code à l’état précédant ce message…', restoreFailed: 'Impossible de restaurer l’état antérieur du code.', restoreWorkspaceMissing: 'L’espace de travail de cette conversation n’est plus disponible.',
        copyReply: 'Copier la réponse', copyContent: 'Copier le contenu', copyId: 'Copier l’ID du message', copyConversationId: 'Copier l’ID de conversation', copyLocator: 'Copier le lien du message',
        contentCopied: 'Message copié', idCopied: 'ID du message copié', conversationIdCopied: 'ID de conversation copié', locatorCopied: 'Lien du message copié', expandMessage: 'Afficher plus', collapseMessage: 'Réduire', revertFilesOnly: 'Annuler seulement les modifications de fichiers (garder la discussion)', moreFiles: '{count} autres fichiers'
    },
    de: {
        stopBeforeDelete: 'Bitte zuerst diese Unterhaltung stoppen', addCodeHosting: 'Code-Hosting-Dienst hinzufügen',
        copyMessage: 'Nachricht kopieren', editMessage: 'Nachricht bearbeiten', cancelEdit: 'Bearbeitung abbrechen', sendEditedMessage: 'Bearbeitete Nachricht senden',
        branchTitle: 'Ab dieser Nachricht fortfahren?', branchPrompt: 'Wir empfehlen einen neuen Unterhaltungszweig. Jetzt erstellen?',
        branchAttachmentNote: 'Die ursprünglichen Anhänge werden aus dem verwalteten lokalen Cache wiederhergestellt. Fehlt eine Datei, bleibt das Senden gesperrt, bis sie erneut hinzugefügt wurde.', attachmentRecoveryFailed: '„{name}“ konnte nicht wiederhergestellt werden. Fügen Sie die Originaldatei erneut hinzu und senden Sie dann noch einmal.', branchSuffix: 'Zweig',
        replaceWarning: 'Ohne neuen Zweig werden diese und alle folgenden Nachrichten dauerhaft aus der aktuellen Unterhaltung entfernt.',
        restoreWorkspaceOption: 'Code zurücksetzen',
        restoreWorkspaceHint: 'Nur von NextMux erfasste Dateiänderungen können wiederhergestellt werden. Änderungen durch Terminalbefehle oder externe Programme sind möglicherweise nicht vollständig abgedeckt.',
        createBranch: 'Zweig erstellen', dontCreate: 'Weiter', cancel: 'Abbrechen', restoringCode: 'Code wird auf den Stand vor dieser Nachricht zurückgesetzt…', restoreFailed: 'Der frühere Codezustand konnte nicht wiederhergestellt werden.', restoreWorkspaceMissing: 'Der Arbeitsbereich dieser Unterhaltung ist nicht mehr verfügbar.',
        copyReply: 'Antwort kopieren', copyContent: 'Inhalt kopieren', copyId: 'Nachrichten-ID kopieren', copyConversationId: 'Unterhaltungs-ID kopieren', copyLocator: 'Nachrichtenlink kopieren',
        contentCopied: 'Nachricht kopiert', idCopied: 'Nachrichten-ID kopiert', conversationIdCopied: 'Unterhaltungs-ID kopiert', locatorCopied: 'Nachrichtenlink kopiert', expandMessage: 'Mehr anzeigen', collapseMessage: 'Weniger anzeigen', revertFilesOnly: 'Nur die Dateiänderungen zurücknehmen (Chat behalten)', moreFiles: '{count} weitere Dateien'
    },
    'pt-BR': {
        stopBeforeDelete: 'Pare esta conversa primeiro', addCodeHosting: 'Adicionar serviço de hospedagem de código',
        copyMessage: 'Copiar mensagem', editMessage: 'Editar mensagem', cancelEdit: 'Cancelar edição', sendEditedMessage: 'Enviar mensagem editada',
        branchTitle: 'Continuar desta mensagem?', branchPrompt: 'Recomendamos criar uma nova ramificação da conversa. Criar agora?',
        branchAttachmentNote: 'Os anexos originais serão restaurados do cache local gerenciado. Se algum arquivo não estiver disponível, o envio será bloqueado até que ele seja adicionado novamente.', attachmentRecoveryFailed: 'Não foi possível restaurar “{name}”. Adicione o arquivo original novamente antes de enviar.', branchSuffix: 'Ramificação',
        replaceWarning: 'Sem uma nova ramificação, esta mensagem e todas as posteriores serão removidas permanentemente da conversa atual.',
        restoreWorkspaceOption: 'Reverter código',
        restoreWorkspaceHint: 'Somente alterações de arquivos registradas pelo NextMux podem ser restauradas. Mudanças feitas pelo terminal ou por programas externos podem não ser totalmente cobertas.',
        createBranch: 'Criar ramificação', dontCreate: 'Continuar', cancel: 'Cancelar', restoringCode: 'Restaurando o código para o estado anterior a esta mensagem…', restoreFailed: 'Não foi possível restaurar o estado anterior do código.', restoreWorkspaceMissing: 'O espaço de trabalho desta conversa não está mais disponível.',
        copyReply: 'Copiar resposta', copyContent: 'Copiar conteúdo', copyId: 'Copiar ID da mensagem', copyConversationId: 'Copiar ID da conversa', copyLocator: 'Copiar link da mensagem',
        contentCopied: 'Mensagem copiada', idCopied: 'ID da mensagem copiado', conversationIdCopied: 'ID da conversa copiado', locatorCopied: 'Link da mensagem copiado', expandMessage: 'Mostrar mais', collapseMessage: 'Mostrar menos', revertFilesOnly: 'Desfazer só as alterações de arquivos (manter a conversa)', moreFiles: 'Mais {count} arquivos'
    },
    ru: {
        stopBeforeDelete: 'Сначала остановите этот разговор', addCodeHosting: 'Добавить сервис хостинга кода',
        copyMessage: 'Копировать сообщение', editMessage: 'Изменить сообщение', cancelEdit: 'Отменить изменение', sendEditedMessage: 'Отправить изменённое сообщение',
        branchTitle: 'Продолжить с этого сообщения?', branchPrompt: 'Рекомендуем создать новую ветку диалога. Создать сейчас?',
        branchAttachmentNote: 'Исходные вложения будут восстановлены из управляемого локального кэша. Если файл недоступен, отправка будет заблокирована, пока вы не добавите его снова.', attachmentRecoveryFailed: 'Не удалось восстановить файл «{name}». Добавьте исходный файл снова и повторите отправку.', branchSuffix: 'Ветка',
        replaceWarning: 'Без новой ветки это и все последующие сообщения будут навсегда удалены из текущего диалога.',
        restoreWorkspaceOption: 'Откатить код',
        restoreWorkspaceHint: 'Восстанавливаются только изменения файлов, записанные NextMux. Изменения из терминала или внешних программ могут быть восстановлены не полностью.',
        createBranch: 'Создать ветку', dontCreate: 'Продолжить', cancel: 'Отмена', restoringCode: 'Код восстанавливается до состояния перед этим сообщением…', restoreFailed: 'Не удалось восстановить предыдущее состояние кода.', restoreWorkspaceMissing: 'Рабочая область этого диалога больше недоступна.',
        copyReply: 'Копировать ответ', copyContent: 'Копировать содержимое', copyId: 'Копировать ID сообщения', copyConversationId: 'Копировать ID диалога', copyLocator: 'Копировать ссылку',
        contentCopied: 'Сообщение скопировано', idCopied: 'ID сообщения скопирован', conversationIdCopied: 'ID диалога скопирован', locatorCopied: 'Ссылка скопирована', expandMessage: 'Показать полностью', collapseMessage: 'Свернуть', revertFilesOnly: 'Откатить только изменения файлов (чат сохранить)', moreFiles: 'Ещё файлов: {count}'
    },
    ar: {
        stopBeforeDelete: 'يرجى إيقاف هذه المحادثة أولاً', addCodeHosting: 'إضافة خدمة استضافة الشيفرة',
        copyMessage: 'نسخ الرسالة', editMessage: 'تعديل الرسالة', cancelEdit: 'إلغاء التعديل', sendEditedMessage: 'إرسال الرسالة المعدلة',
        branchTitle: 'المتابعة من هذه الرسالة؟', branchPrompt: 'نوصي بإنشاء فرع محادثة جديد. هل تريد إنشاءه الآن؟',
        branchAttachmentNote: 'ستُستعاد المرفقات الأصلية من ذاكرة التخزين المؤقت المحلية المُدارة. إذا تعذر العثور على ملف، فسيُمنع الإرسال حتى تعيد إضافته.', attachmentRecoveryFailed: 'تعذرت استعادة المرفق «{name}». أعد إضافة الملف الأصلي ثم أرسل الرسالة مرة أخرى.', branchSuffix: 'فرع',
        replaceWarning: 'من دون فرع جديد ستُحذف هذه الرسالة وكل الرسائل اللاحقة نهائيًا من المحادثة الحالية.',
        restoreWorkspaceOption: 'التراجع عن الشفرة',
        restoreWorkspaceHint: 'يمكن استعادة تغييرات الملفات التي سجلها NextMux فقط. قد لا تُغطى بالكامل التغييرات التي نفذتها أوامر الطرفية أو البرامج الخارجية.',
        createBranch: 'إنشاء فرع', dontCreate: 'متابعة', cancel: 'إلغاء', restoringCode: 'جارٍ استعادة الشفرة إلى حالتها قبل هذه الرسالة…', restoreFailed: 'تعذرت استعادة حالة الشفرة السابقة.', restoreWorkspaceMissing: 'لم تعد مساحة عمل هذه المحادثة متاحة.',
        copyReply: 'نسخ الرد', copyContent: 'نسخ المحتوى', copyId: 'نسخ معرّف الرسالة', copyConversationId: 'نسخ معرّف المحادثة', copyLocator: 'نسخ رابط الرسالة',
        contentCopied: 'تم نسخ الرسالة', idCopied: 'تم نسخ معرّف الرسالة', conversationIdCopied: 'تم نسخ معرّف المحادثة', locatorCopied: 'تم نسخ رابط الرسالة', expandMessage: 'عرض المزيد', collapseMessage: 'عرض أقل', revertFilesOnly: 'التراجع عن تغييرات الملفات فقط (مع إبقاء المحادثة)', moreFiles: '{count} ملفات أخرى'
    },
    hi: {
        stopBeforeDelete: 'पहले इस बातचीत को रोकें', addCodeHosting: 'कोड होस्टिंग सेवा जोड़ें',
        copyMessage: 'संदेश कॉपी करें', editMessage: 'संदेश संपादित करें', cancelEdit: 'संपादन रद्द करें', sendEditedMessage: 'संपादित संदेश भेजें',
        branchTitle: 'इस संदेश से आगे बढ़ें?', branchPrompt: 'हम नई बातचीत शाखा बनाने की सलाह देते हैं। अभी बनाएँ?',
        branchAttachmentNote: 'मूल अटैचमेंट प्रबंधित स्थानीय कैश से बहाल किए जाएँगे। कोई फ़ाइल उपलब्ध न होने पर उसे दोबारा जोड़ने तक भेजना रोक दिया जाएगा।', attachmentRecoveryFailed: '“{name}” अटैचमेंट बहाल नहीं हो सका। मूल फ़ाइल दोबारा जोड़कर फिर भेजें।', branchSuffix: 'शाखा',
        replaceWarning: 'नई शाखा के बिना यह संदेश और इसके बाद के सभी संदेश वर्तमान बातचीत से स्थायी रूप से हट जाएँगे।',
        restoreWorkspaceOption: 'कोड वापस करें',
        restoreWorkspaceHint: 'केवल NextMux द्वारा दर्ज फ़ाइल बदलाव बहाल किए जा सकते हैं। टर्मिनल कमांड या बाहरी प्रोग्राम के बदलाव पूरी तरह शामिल नहीं हो सकते।',
        createBranch: 'शाखा बनाएँ', dontCreate: 'जारी रखें', cancel: 'रद्द करें', restoringCode: 'कोड को इस संदेश से पहले की स्थिति में बहाल किया जा रहा है…', restoreFailed: 'पहले की कोड स्थिति बहाल नहीं हो सकी।', restoreWorkspaceMissing: 'इस बातचीत का कार्यक्षेत्र अब उपलब्ध नहीं है।',
        copyReply: 'उत्तर कॉपी करें', copyContent: 'संदेश सामग्री कॉपी करें', copyId: 'संदेश ID कॉपी करें', copyConversationId: 'बातचीत ID कॉपी करें', copyLocator: 'संदेश लिंक कॉपी करें',
        contentCopied: 'संदेश कॉपी हुआ', idCopied: 'संदेश ID कॉपी हुआ', conversationIdCopied: 'बातचीत ID कॉपी हुआ', locatorCopied: 'संदेश लिंक कॉपी हुआ', expandMessage: 'पूरा दिखाएँ', collapseMessage: 'समेटें', revertFilesOnly: 'सिर्फ़ फ़ाइल बदलाव वापस लें (चैट रखें)', moreFiles: '{count} और फ़ाइलें'
    }
};

function uncheckedConversationText(
    locale: NextMuxDesktopLocale,
    key: ConversationTextKey,
    values: Readonly<Record<string, string | number>> = {}
): string {
    return translations[locale][key].replace(/\{([a-z]+)\}/gi, (_match, name: string) => String(values[name] ?? ''));
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function conversationText(locale: Parameters<typeof uncheckedConversationText>[0], key: Parameters<typeof uncheckedConversationText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedConversationText>>): string {
    return totalCopy(locale, key, language => uncheckedConversationText(language, key, ...rest));
}
