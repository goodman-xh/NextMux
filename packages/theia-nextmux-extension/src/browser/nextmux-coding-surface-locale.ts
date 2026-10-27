import type { NextMuxDesktopLocale } from './nextmux-locale';

/**
 * Reviewed labels for the coding workspace (sidebar, composer, permission
 * prompts, conversation dialogs and drawer chrome). They take precedence over
 * the machine-generated surface catalogue, which rendered several of these as
 * the wrong part of speech ("Cancelled" on Cancel buttons, "Pin" as a list
 * heading), as a placeholder ("NextMux · desktop action") or left them in
 * Chinese. Keys are the Simplified Chinese source strings.
 */
type Row = readonly [zhTW: string, en: string, ja: string, ko: string, es: string, fr: string, de: string, ptBR: string, ru: string, ar: string, hi: string];

const rows: Readonly<Record<string, Row>> = {
    // Generic dialog actions used across the workspace.
    '取消': ['取消', 'Cancel', 'キャンセル', '취소', 'Cancelar', 'Annuler', 'Abbrechen', 'Cancelar', 'Отмена', 'إلغاء', 'रद्द करें'],
    '删除': ['刪除', 'Delete', '削除', '삭제', 'Eliminar', 'Supprimer', 'Löschen', 'Excluir', 'Удалить', 'حذف', 'हटाएं'],
    '关闭': ['關閉', 'Close', '閉じる', '닫기', 'Cerrar', 'Fermer', 'Schließen', 'Fechar', 'Закрыть', 'إغلاق', 'बंद करें'],
    '保存': ['儲存', 'Save', '保存', '저장', 'Guardar', 'Enregistrer', 'Speichern', 'Salvar', 'Сохранить', 'حفظ', 'सहेजें'],
    '保存中…': ['儲存中…', 'Saving…', '保存中…', '저장 중…', 'Guardando…', 'Enregistrement…', 'Wird gespeichert…', 'Salvando…', 'Сохранение…', 'جارٍ الحفظ…', 'सहेजा जा रहा है…'],
    '发送': ['傳送', 'Send', '送信', '보내기', 'Enviar', 'Envoyer', 'Senden', 'Enviar', 'Отправить', 'إرسال', 'भेजें'],
    '加载中...': ['載入中…', 'Loading…', '読み込み中…', '불러오는 중…', 'Cargando…', 'Chargement…', 'Wird geladen…', 'Carregando…', 'Загрузка…', 'جارٍ التحميل…', 'लोड हो रहा है…'],
    '加载中…': ['載入中…', 'Loading…', '読み込み中…', '불러오는 중…', 'Cargando…', 'Chargement…', 'Wird geladen…', 'Carregando…', 'Загрузка…', 'جارٍ التحميل…', 'लोड हो रहा है…'],
    '读取中': ['讀取中', 'Loading', '読み込み中', '불러오는 중', 'Cargando', 'Chargement', 'Wird geladen', 'Carregando', 'Загрузка', 'جارٍ التحميل', 'लोड हो रहा है'],
    '加载更多': ['載入更多', 'Load more', 'さらに読み込む', '더 불러오기', 'Cargar más', 'Charger plus', 'Mehr laden', 'Carregar mais', 'Загрузить ещё', 'تحميل المزيد', 'और लोड करें'],

    // Sidebar.
    '新对话': ['新對話', 'New conversation', '新しい会話', '새 대화', 'Nueva conversación', 'Nouvelle conversation', 'Neue Unterhaltung', 'Nova conversa', 'Новый диалог', 'محادثة جديدة', 'नई बातचीत'],
    '已安排': ['已排程', 'Scheduled', 'スケジュール', '예약됨', 'Programadas', 'Planifiées', 'Geplant', 'Agendadas', 'Запланированные', 'المجدولة', 'शेड्यूल की गई'],
    '插件': ['外掛', 'Plugins', 'プラグイン', '플러그인', 'Complementos', 'Extensions', 'Plug-ins', 'Plugins', 'Плагины', 'الإضافات', 'प्लगइन'],
    '置顶': ['已置頂', 'Pinned', 'ピン留め', '고정됨', 'Fijadas', 'Épinglées', 'Angeheftet', 'Fixadas', 'Закреплённые', 'المثبّتة', 'पिन की गई'],
    '置顶对话': ['置頂', 'Pin', 'ピン留め', '고정', 'Fijar', 'Épingler', 'Anheften', 'Fixar', 'Закрепить', 'تثبيت', 'पिन करें'],
    '取消置顶': ['取消置頂', 'Unpin', 'ピン留めを外す', '고정 해제', 'Dejar de fijar', 'Désépingler', 'Nicht mehr anheften', 'Desafixar', 'Открепить', 'إلغاء التثبيت', 'पिन हटाएं'],
    '最近': ['最近', 'Recent', '最近', '최근', 'Recientes', 'Récentes', 'Zuletzt', 'Recentes', 'Недавние', 'الأخيرة', 'हाल की'],
    '暂无对话': ['尚無對話', 'No conversations', '会話はありません', '대화 없음', 'Sin conversaciones', 'Aucune conversation', 'Keine Unterhaltungen', 'Nenhuma conversa', 'Нет диалогов', 'لا توجد محادثات', 'कोई बातचीत नहीं'],
    '收起对话': ['收合', 'Show less', '折りたたむ', '접기', 'Mostrar menos', 'Afficher moins', 'Weniger anzeigen', 'Mostrar menos', 'Свернуть', 'عرض أقل', 'कम दिखाएं'],
    '松开以添加': ['放開以新增', 'Drop to add', 'ドロップして追加', '놓아서 추가', 'Suelta para añadir', 'Déposez pour ajouter', 'Zum Hinzufügen ablegen', 'Solte para adicionar', 'Отпустите, чтобы добавить', 'أفلِت للإضافة', 'जोड़ने के लिए छोड़ें'],
    '在此项目中新建对话': ['在此專案中新增對話', 'New conversation in this project', 'このプロジェクトで新しい会話', '이 프로젝트에서 새 대화', 'Nueva conversación en este proyecto', 'Nouvelle conversation dans ce projet', 'Neue Unterhaltung in diesem Projekt', 'Nova conversa neste projeto', 'Новый диалог в этом проекте', 'محادثة جديدة في هذا المشروع', 'इस प्रोजेक्ट में नई बातचीत'],
    '对话选项': ['對話選項', 'Conversation options', '会話のオプション', '대화 옵션', 'Opciones de la conversación', 'Options de la conversation', 'Optionen der Unterhaltung', 'Opções da conversa', 'Параметры диалога', 'خيارات المحادثة', 'बातचीत के विकल्प'],
    '平铺该对话': ['平鋪此對話', 'Tile this conversation', 'この会話をタイル表示', '이 대화를 타일로 열기', 'Abrir en mosaico', 'Ouvrir en mosaïque', 'Als Kachel öffnen', 'Abrir em mosaico', 'Открыть плиткой', 'فتح كنافذة مصغّرة', 'इस बातचीत को टाइल करें'],
    '平铺所有对话': ['平鋪所有對話', 'Tile all conversations', 'すべての会話をタイル表示', '모든 대화를 타일로 열기', 'Abrir todas en mosaico', 'Tout ouvrir en mosaïque', 'Alle als Kacheln öffnen', 'Abrir todas em mosaico', 'Открыть все плитками', 'فتح الكل كنوافذ مصغّرة', 'सभी बातचीत टाइल करें'],
    '重命名': ['重新命名', 'Rename', '名前を変更', '이름 바꾸기', 'Cambiar nombre', 'Renommer', 'Umbenennen', 'Renomear', 'Переименовать', 'إعادة التسمية', 'नाम बदलें'],
    '删除对话': ['刪除對話', 'Delete conversation', '会話を削除', '대화 삭제', 'Eliminar conversación', 'Supprimer la conversation', 'Unterhaltung löschen', 'Excluir conversa', 'Удалить диалог', 'حذف المحادثة', 'बातचीत हटाएं'],
    '通知': ['通知', 'Notifications', '通知', '알림', 'Notificaciones', 'Notifications', 'Benachrichtigungen', 'Notificações', 'Уведомления', 'الإشعارات', 'सूचनाएं'],
    '清空': ['全部清除', 'Clear all', 'すべて消去', '모두 지우기', 'Borrar todo', 'Tout effacer', 'Alle löschen', 'Limpar tudo', 'Очистить всё', 'مسح الكل', 'सभी साफ़ करें'],
    '暂无通知': ['尚無通知', 'No notifications', '通知はありません', '알림 없음', 'No hay notificaciones', 'Aucune notification', 'Keine Benachrichtigungen', 'Nenhuma notificação', 'Нет уведомлений', 'لا توجد إشعارات', 'कोई सूचना नहीं'],
    '任务状态和后台运行结果会显示在这里。': ['任務狀態與背景執行結果會顯示在這裡。', 'Task updates and background results appear here.', 'タスクの状態とバックグラウンドの結果がここに表示されます。', '작업 상태와 백그라운드 실행 결과가 여기에 표시됩니다.', 'Aquí aparecen el estado de las tareas y los resultados en segundo plano.', 'L’état des tâches et les résultats en arrière-plan s’affichent ici.', 'Hier erscheinen Aufgabenstatus und Hintergrundergebnisse.', 'O status das tarefas e os resultados em segundo plano aparecem aqui.', 'Здесь появятся статусы задач и результаты фоновой работы.', 'ستظهر هنا حالة المهام ونتائج التشغيل في الخلفية.', 'कार्य की स्थिति और बैकग्राउंड नतीजे यहां दिखेंगे।'],
    '关键词、对话 ID 或消息 ID': ['關鍵字、對話 ID 或訊息 ID', 'Keyword, conversation ID or message ID', 'キーワード、会話 ID、メッセージ ID', '키워드, 대화 ID 또는 메시지 ID', 'Palabra clave, ID de conversación o mensaje', 'Mot-clé, ID de conversation ou de message', 'Suchwort, Unterhaltungs-ID oder Nachrichten-ID', 'Palavra-chave, ID da conversa ou mensagem', 'Ключевое слово, ID диалога или сообщения', 'كلمة مفتاحية أو معرّف المحادثة أو الرسالة', 'कीवर्ड, बातचीत ID या संदेश ID'],
    '正在搜索…': ['正在搜尋…', 'Searching…', '検索中…', '검색 중…', 'Buscando…', 'Recherche…', 'Suche…', 'Pesquisando…', 'Поиск…', 'جارٍ البحث…', 'खोज जारी है…'],
    '搜索全局对话': ['搜尋所有對話', 'Search all conversations', 'すべての会話を検索', '모든 대화 검색', 'Buscar en todas las conversaciones', 'Rechercher dans toutes les conversations', 'Alle Unterhaltungen durchsuchen', 'Pesquisar em todas as conversas', 'Поиск по всем диалогам', 'البحث في كل المحادثات', 'सभी बातचीत खोजें'],
    '没有匹配的对话': ['沒有相符的對話', 'No matching conversations', '一致する会話はありません', '일치하는 대화 없음', 'No hay conversaciones que coincidan', 'Aucune conversation correspondante', 'Keine passenden Unterhaltungen', 'Nenhuma conversa correspondente', 'Совпадений нет', 'لا توجد محادثات مطابقة', 'कोई मिलती-जुलती बातचीत नहीं'],

    // Conversation dialogs.
    '重命名对话': ['重新命名對話', 'Rename conversation', '会話の名前を変更', '대화 이름 바꾸기', 'Cambiar nombre de la conversación', 'Renommer la conversation', 'Unterhaltung umbenennen', 'Renomear conversa', 'Переименовать диалог', 'إعادة تسمية المحادثة', 'बातचीत का नाम बदलें'],
    '名称': ['名稱', 'Name', '名前', '이름', 'Nombre', 'Nom', 'Name', 'Nome', 'Название', 'الاسم', 'नाम'],
    '删除对话？': ['刪除對話？', 'Delete conversation?', '会話を削除しますか？', '대화를 삭제할까요?', '¿Eliminar la conversación?', 'Supprimer la conversation ?', 'Unterhaltung löschen?', 'Excluir a conversa?', 'Удалить диалог?', 'حذف المحادثة؟', 'बातचीत हटाएं?'],
    '此对话及其本机历史记录将被永久删除。': ['此對話及其本機記錄將被永久刪除。', 'This conversation and its local history will be permanently deleted.', 'この会話とローカルの履歴は完全に削除されます。', '이 대화와 로컬 기록이 영구적으로 삭제됩니다.', 'Esta conversación y su historial local se eliminarán de forma permanente.', 'Cette conversation et son historique local seront définitivement supprimés.', 'Diese Unterhaltung und ihr lokaler Verlauf werden dauerhaft gelöscht.', 'Esta conversa e o histórico local serão excluídos permanentemente.', 'Этот диалог и его локальная история будут удалены безвозвратно.', 'سيتم حذف هذه المحادثة وسجلها المحلي نهائيًا.', 'यह बातचीत और इसका स्थानीय इतिहास स्थायी रूप से हट जाएगा।'],

    // Composer and permissions.
    '发送消息或描述任务': ['傳送訊息或描述任務', 'Send a message or describe a task', 'メッセージを送信、またはタスクを説明', '메시지를 보내거나 작업을 설명하세요', 'Envía un mensaje o describe una tarea', 'Envoyez un message ou décrivez une tâche', 'Nachricht senden oder Aufgabe beschreiben', 'Envie uma mensagem ou descreva uma tarefa', 'Напишите сообщение или опишите задачу', 'أرسل رسالة أو صِف مهمة', 'संदेश भेजें या कार्य बताएं'],
    '停止任务': ['停止任務', 'Stop', '停止', '중지', 'Detener', 'Arrêter', 'Stoppen', 'Parar', 'Остановить', 'إيقاف', 'रोकें'],
    '正在停止任务': ['正在停止任務', 'Stopping', '停止しています', '중지하는 중', 'Deteniendo', 'Arrêt en cours', 'Wird gestoppt', 'Parando', 'Останавливается', 'جارٍ الإيقاف', 'रोका जा रहा है'],
    '正在停止…': ['正在停止…', 'Stopping…', '停止しています…', '중지하는 중…', 'Deteniendo…', 'Arrêt…', 'Wird gestoppt…', 'Parando…', 'Остановка…', 'جارٍ الإيقاف…', 'रोका जा रहा है…'],
    '工具权限': ['工具權限', 'Permissions', 'ツールの権限', '도구 권한', 'Permisos de herramientas', 'Autorisations des outils', 'Tool-Berechtigungen', 'Permissões de ferramentas', 'Разрешения инструментов', 'أذونات الأدوات', 'टूल अनुमतियां'],
    '应用于当前对话': ['套用至目前對話', 'Applies to this conversation', 'この会話に適用', '현재 대화에 적용', 'Se aplica a esta conversación', 'S’applique à cette conversation', 'Gilt für diese Unterhaltung', 'Aplica-se a esta conversa', 'Действует в этом диалоге', 'ينطبق على هذه المحادثة', 'इस बातचीत पर लागू'],
    '只读': ['唯讀', 'Read-only', '読み取り専用', '읽기 전용', 'Solo lectura', 'Lecture seule', 'Schreibgeschützt', 'Somente leitura', 'Только чтение', 'قراءة فقط', 'केवल पढ़ना'],
    '工作区写入': ['工作區寫入', 'Workspace write', 'ワークスペースへの書き込み', '작업 공간 쓰기', 'Escritura en el espacio de trabajo', 'Écriture dans l’espace de travail', 'Schreiben im Arbeitsbereich', 'Gravação no espaço de trabalho', 'Запись в рабочей области', 'الكتابة في مساحة العمل', 'वर्कस्पेस में लिखना'],
    '完全访问': ['完整存取', 'Full access', 'フルアクセス', '전체 액세스', 'Acceso completo', 'Accès complet', 'Vollzugriff', 'Acesso total', 'Полный доступ', 'وصول كامل', 'पूर्ण एक्सेस'],
    '读取项目，不修改文件': ['讀取專案，不修改檔案', 'Reads the project, never edits files', 'プロジェクトを読み取り、ファイルは変更しません', '프로젝트를 읽기만 하고 파일은 수정하지 않음', 'Lee el proyecto sin modificar archivos', 'Lit le projet sans modifier de fichiers', 'Liest das Projekt, ändert keine Dateien', 'Lê o projeto sem alterar arquivos', 'Читает проект, не изменяя файлы', 'يقرأ المشروع دون تعديل الملفات', 'प्रोजेक्ट पढ़ता है, फ़ाइलें नहीं बदलता'],
    '可修改当前工作区': ['可修改目前工作區', 'Can edit the current workspace', '現在のワークスペースを変更できます', '현재 작업 공간을 수정할 수 있음', 'Puede modificar el espacio de trabajo actual', 'Peut modifier l’espace de travail actuel', 'Darf den aktuellen Arbeitsbereich ändern', 'Pode alterar o espaço de trabalho atual', 'Может изменять текущую рабочую область', 'يمكنه تعديل مساحة العمل الحالية', 'मौजूदा वर्कस्पेस बदल सकता है'],
    '可运行进程并访问工作区外部': ['可執行程序並存取工作區以外', 'Can run processes and reach outside the workspace', 'プロセスを実行し、ワークスペース外にもアクセスできます', '프로세스를 실행하고 작업 공간 밖에 접근할 수 있음', 'Puede ejecutar procesos y acceder fuera del espacio de trabajo', 'Peut exécuter des processus et accéder hors de l’espace de travail', 'Darf Prozesse starten und außerhalb des Arbeitsbereichs zugreifen', 'Pode executar processos e acessar fora do espaço de trabalho', 'Может запускать процессы и работать вне рабочей области', 'يمكنه تشغيل العمليات والوصول إلى خارج مساحة العمل', 'प्रोसेस चला सकता है और वर्कस्पेस के बाहर पहुंच सकता है'],
    '选择中转商：': ['選擇中轉商：', 'Provider: ', 'プロバイダー：', '공급자: ', 'Proveedor: ', 'Fournisseur : ', 'Anbieter: ', 'Provedor: ', 'Поставщик: ', 'المزوّد: ', 'प्रदाता: '],
    '打开独立对话窗口': ['開啟獨立對話視窗', 'Open conversation window', '会話ウィンドウを開く', '대화 창 열기', 'Abrir la ventana de la conversación', 'Ouvrir la fenêtre de la conversation', 'Unterhaltungsfenster öffnen', 'Abrir janela da conversa', 'Открыть окно диалога', 'فتح نافذة المحادثة', 'बातचीत विंडो खोलें'],
    '本机对话工作区': ['本機對話工作區', 'Local conversation workspace', 'ローカルの会話ワークスペース', '로컬 대화 작업 공간', 'Espacio de trabajo local de la conversación', 'Espace de travail local de la conversation', 'Lokaler Arbeitsbereich der Unterhaltung', 'Espaço de trabalho local da conversa', 'Локальная рабочая область диалога', 'مساحة عمل المحادثة المحلية', 'स्थानीय बातचीत वर्कस्पेस'],
    '项目目录未挂载，将使用本机对话工作区': ['專案資料夾未掛載，將使用本機對話工作區', 'The project folder isn’t available, so a local conversation workspace will be used.', 'プロジェクトフォルダーを利用できないため、ローカルの会話ワークスペースを使用します。', '프로젝트 폴더를 사용할 수 없어 로컬 대화 작업 공간을 사용합니다.', 'La carpeta del proyecto no está disponible; se usará un espacio de trabajo local.', 'Le dossier du projet est indisponible ; un espace de travail local sera utilisé.', 'Der Projektordner ist nicht verfügbar; ein lokaler Arbeitsbereich wird verwendet.', 'A pasta do projeto não está disponível; será usado um espaço de trabalho local.', 'Папка проекта недоступна, будет использована локальная рабочая область.', 'مجلد المشروع غير متاح، لذا ستُستخدم مساحة عمل محلية.', 'प्रोजेक्ट फ़ोल्डर उपलब्ध नहीं है, इसलिए स्थानीय वर्कस्पेस इस्तेमाल होगा।'],
    '今天想做什么？': ['今天想做什麼？', 'What would you like to work on today?', '今日は何をしますか？', '오늘은 무엇을 할까요?', '¿En qué trabajamos hoy?', 'Sur quoi travaille-t-on aujourd’hui ?', 'Woran arbeiten wir heute?', 'No que vamos trabalhar hoje?', 'Над чем поработаем сегодня?', 'على ماذا نعمل اليوم؟', 'आज किस पर काम करें?'],
    '回到底部': ['回到底部', 'Scroll to bottom', '一番下へ', '맨 아래로', 'Ir al final', 'Aller en bas', 'Nach unten', 'Ir para o fim', 'Вниз', 'الانتقال إلى الأسفل', 'नीचे जाएं'],
    '有新消息，回到底部': ['有新訊息，回到底部', 'New messages — scroll to bottom', '新しいメッセージ — 一番下へ', '새 메시지 — 맨 아래로', 'Mensajes nuevos: ir al final', 'Nouveaux messages — aller en bas', 'Neue Nachrichten – nach unten', 'Novas mensagens — ir para o fim', 'Новые сообщения — вниз', 'رسائل جديدة — الانتقال إلى الأسفل', 'नए संदेश — नीचे जाएं'],

    // Full-access confirmation.
    '确认完全访问': ['確認完整存取', 'Confirm full access', 'フルアクセスの確認', '전체 액세스 확인', 'Confirmar acceso completo', 'Confirmer l’accès complet', 'Vollzugriff bestätigen', 'Confirmar acesso total', 'Подтвердите полный доступ', 'تأكيد الوصول الكامل', 'पूर्ण एक्सेस की पुष्टि करें'],
    '允许此对话完全访问？': ['允許此對話完整存取？', 'Allow full access for this conversation?', 'この会話にフルアクセスを許可しますか？', '이 대화에 전체 액세스를 허용할까요?', '¿Permitir acceso completo a esta conversación?', 'Autoriser l’accès complet pour cette conversation ?', 'Vollzugriff für diese Unterhaltung erlauben?', 'Permitir acesso total para esta conversa?', 'Разрешить полный доступ для этого диалога?', 'السماح بالوصول الكامل لهذه المحادثة؟', 'इस बातचीत को पूर्ण एक्सेस दें?'],
    '将完全访问设为新对话默认值？': ['將完整存取設為新對話的預設值？', 'Use full access by default for new conversations?', '新しい会話の既定をフルアクセスにしますか？', '새 대화의 기본값을 전체 액세스로 설정할까요?', '¿Usar acceso completo por defecto en las conversaciones nuevas?', 'Utiliser l’accès complet par défaut pour les nouvelles conversations ?', 'Vollzugriff standardmäßig für neue Unterhaltungen verwenden?', 'Usar acesso total por padrão em novas conversas?', 'Использовать полный доступ по умолчанию для новых диалогов?', 'استخدام الوصول الكامل افتراضيًا للمحادثات الجديدة؟', 'नई बातचीत के लिए पूर्ण एक्सेस को डिफ़ॉल्ट बनाएं?'],
    '此档位可启动本机进程，并可能修改当前工作区外的系统状态。确认后只影响新建对话，已有对话的权限不会改变。': [
        '此層級可啟動本機程序，並可能變更目前工作區以外的系統狀態。確認後只影響新對話，現有對話的權限不會改變。',
        'This level can start local processes and may change system state outside the workspace. Only new conversations are affected; existing ones keep their permissions.',
        'このレベルではローカルのプロセスを起動でき、ワークスペース外のシステム状態を変更する可能性があります。新しい会話にのみ適用され、既存の会話の権限は変わりません。',
        '이 단계는 로컬 프로세스를 시작할 수 있고 작업 공간 밖의 시스템 상태를 바꿀 수 있습니다. 새 대화에만 적용되며 기존 대화의 권한은 바뀌지 않습니다.',
        'Este nivel puede iniciar procesos locales y cambiar el estado del sistema fuera del espacio de trabajo. Solo afecta a las conversaciones nuevas; las existentes conservan sus permisos.',
        'Ce niveau peut lancer des processus locaux et modifier l’état du système hors de l’espace de travail. Seules les nouvelles conversations sont concernées ; les autres gardent leurs autorisations.',
        'Diese Stufe kann lokale Prozesse starten und den Systemzustand außerhalb des Arbeitsbereichs ändern. Gilt nur für neue Unterhaltungen; bestehende behalten ihre Berechtigungen.',
        'Este nível pode iniciar processos locais e alterar o estado do sistema fora do espaço de trabalho. Afeta apenas novas conversas; as existentes mantêm suas permissões.',
        'Этот уровень может запускать локальные процессы и менять состояние системы вне рабочей области. Применяется только к новым диалогам; у существующих разрешения не изменятся.',
        'يمكن لهذا المستوى تشغيل عمليات محلية وقد يغيّر حالة النظام خارج مساحة العمل. ينطبق على المحادثات الجديدة فقط، وتحتفظ المحادثات الحالية بأذوناتها.',
        'यह स्तर स्थानीय प्रोसेस शुरू कर सकता है और वर्कस्पेस के बाहर सिस्टम की स्थिति बदल सकता है। यह केवल नई बातचीत पर लागू होगा; मौजूदा बातचीत की अनुमतियां नहीं बदलेंगी।'],
    '此档位可启动本机进程，并可能修改当前工作区外的系统状态。确认后，本对话后续任务将保持完全访问，直到主动切换权限。': [
        '此層級可啟動本機程序，並可能變更目前工作區以外的系統狀態。確認後，此對話後續任務將維持完整存取，直到你切換權限。',
        'This level can start local processes and may change system state outside the workspace. This conversation keeps full access until you change it.',
        'このレベルではローカルのプロセスを起動でき、ワークスペース外のシステム状態を変更する可能性があります。変更するまで、この会話はフルアクセスのままです。',
        '이 단계는 로컬 프로세스를 시작할 수 있고 작업 공간 밖의 시스템 상태를 바꿀 수 있습니다. 변경하기 전까지 이 대화는 전체 액세스를 유지합니다.',
        'Este nivel puede iniciar procesos locales y cambiar el estado del sistema fuera del espacio de trabajo. Esta conversación mantendrá el acceso completo hasta que lo cambies.',
        'Ce niveau peut lancer des processus locaux et modifier l’état du système hors de l’espace de travail. Cette conversation garde l’accès complet jusqu’à ce que vous le changiez.',
        'Diese Stufe kann lokale Prozesse starten und den Systemzustand außerhalb des Arbeitsbereichs ändern. Diese Unterhaltung behält den Vollzugriff, bis du ihn änderst.',
        'Este nível pode iniciar processos locais e alterar o estado do sistema fora do espaço de trabalho. Esta conversa mantém o acesso total até você alterá-lo.',
        'Этот уровень может запускать локальные процессы и менять состояние системы вне рабочей области. Диалог сохранит полный доступ, пока вы его не измените.',
        'يمكن لهذا المستوى تشغيل عمليات محلية وقد يغيّر حالة النظام خارج مساحة العمل. ستحتفظ هذه المحادثة بالوصول الكامل حتى تغيّره.',
        'यह स्तर स्थानीय प्रोसेस शुरू कर सकता है और वर्कस्पेस के बाहर सिस्टम की स्थिति बदल सकता है। जब तक आप नहीं बदलते, यह बातचीत पूर्ण एक्सेस पर रहेगी।'],
    '允许完全访问': ['允許完整存取', 'Allow full access', 'フルアクセスを許可', '전체 액세스 허용', 'Permitir acceso completo', 'Autoriser l’accès complet', 'Vollzugriff erlauben', 'Permitir acesso total', 'Разрешить полный доступ', 'السماح بالوصول الكامل', 'पूर्ण एक्सेस दें'],

    // Drawer and workbench chrome.
    '打开终端': ['開啟終端機', 'Open terminal', 'ターミナルを開く', '터미널 열기', 'Abrir terminal', 'Ouvrir le terminal', 'Terminal öffnen', 'Abrir terminal', 'Открыть терминал', 'فتح الطرفية', 'टर्मिनल खोलें'],
    '收起终端': ['收合終端機', 'Hide terminal', 'ターミナルを隠す', '터미널 숨기기', 'Ocultar terminal', 'Masquer le terminal', 'Terminal ausblenden', 'Ocultar terminal', 'Скрыть терминал', 'إخفاء الطرفية', 'टर्मिनल छिपाएं'],
    '打开右侧面板': ['開啟右側面板', 'Open side panel', 'サイドパネルを開く', '사이드 패널 열기', 'Abrir panel lateral', 'Ouvrir le panneau latéral', 'Seitenleiste öffnen', 'Abrir painel lateral', 'Открыть боковую панель', 'فتح اللوحة الجانبية', 'साइड पैनल खोलें'],
    '关闭右侧面板': ['關閉右側面板', 'Close side panel', 'サイドパネルを閉じる', '사이드 패널 닫기', 'Cerrar panel lateral', 'Fermer le panneau latéral', 'Seitenleiste schließen', 'Fechar painel lateral', 'Закрыть боковую панель', 'إغلاق اللوحة الجانبية', 'साइड पैनल बंद करें'],
    '对话内容时序': ['對話時間軸', 'Conversation timeline', '会話のタイムライン', '대화 타임라인', 'Cronología de la conversación', 'Chronologie de la conversation', 'Verlauf der Unterhaltung', 'Linha do tempo da conversa', 'Хронология диалога', 'المخطط الزمني للمحادثة', 'बातचीत की टाइमलाइन'],
    '删除文件': ['已刪除檔案', 'Deleted file', '削除されたファイル', '삭제된 파일', 'Archivo eliminado', 'Fichier supprimé', 'Gelöschte Datei', 'Arquivo excluído', 'Удалённый файл', 'ملف محذوف', 'हटाई गई फ़ाइल']
};

const order: readonly NextMuxDesktopLocale[] = ['zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];

export const codingSurfaceCatalog: Readonly<Partial<Record<NextMuxDesktopLocale, Readonly<Record<string, string>>>>> = Object.fromEntries(
    order.map((locale, index) => [locale, Object.fromEntries(Object.entries(rows).map(([source, row]) => [source, row[index]]))])
);

/** Reviewed coding-workspace label, or undefined when the shared catalogue owns the string. */
export function codingSurfaceText(locale: NextMuxDesktopLocale, value: string): string | undefined {
    return codingSurfaceCatalog[locale]?.[value];
}
