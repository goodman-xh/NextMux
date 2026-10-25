import type { NextMuxDesktopLocale } from './nextmux-locale';
import type { ToolExecutionSummary } from '@nextmux/agent-runtime';

/**
 * Fixed tool-result titles written by the desktop backend and agent runtime
 * (project memory, schedules, conversation tools, delegated-workspace review).
 * Compatibility for older journals. New summaries use kind + params below.
 * Order matches `SOURCES`.
 */
const SOURCES = [
    '查找项目记忆', '读取项目记忆', '读取项目设计规范', '读取项目计划', '删除项目计划', '计划已存在',
    '检索本机对话', '读取指定对话消息', '本机对话已存在', '创建本机对话',
    '子任务改动待审查', '已合并子任务，请重新验证', '已恢复中断的合并'
] as const;

const TITLES: Readonly<Record<Exclude<NextMuxDesktopLocale, 'zh-CN'>, readonly string[]>> = {
    en: ['Search project memory', 'Read project memory', 'Read project design notes', 'Read scheduled tasks', 'Delete scheduled task', 'Scheduled task already exists',
        'Search conversations', 'Read conversation message', 'Conversation already exists', 'Create conversation',
        'Sub-agent changes ready for review', 'Merged sub-agent changes; verify again', 'Resumed interrupted merge'],
    'zh-TW': ['查找專案記憶', '讀取專案記憶', '讀取專案設計規範', '讀取專案排程', '刪除專案排程', '排程已存在',
        '搜尋本機對話', '讀取指定對話訊息', '本機對話已存在', '建立本機對話',
        '子任務變更待審查', '已合併子任務，請重新驗證', '已恢復中斷的合併'],
    ja: ['プロジェクトメモリを検索', 'プロジェクトメモリを読む', 'プロジェクト設計メモを読む', '予定タスクを読む', '予定タスクを削除', '予定タスクは既に存在します',
        '会話を検索', '会話メッセージを読む', '会話は既に存在します', '会話を作成',
        'サブエージェントの変更をレビュー待ち', 'サブエージェントの変更を統合（再検証が必要）', '中断された統合を再開'],
    ko: ['프로젝트 메모리 검색', '프로젝트 메모리 읽기', '프로젝트 디자인 노트 읽기', '예약 작업 읽기', '예약 작업 삭제', '예약 작업이 이미 있음',
        '대화 검색', '대화 메시지 읽기', '대화가 이미 있음', '대화 만들기',
        '하위 에이전트 변경 사항 검토 대기', '하위 에이전트 변경 병합됨, 다시 검증 필요', '중단된 병합 재개'],
    es: ['Buscar en la memoria del proyecto', 'Leer la memoria del proyecto', 'Leer notas de diseño del proyecto', 'Leer tareas programadas', 'Eliminar tarea programada', 'La tarea programada ya existe',
        'Buscar conversaciones', 'Leer mensaje de la conversación', 'La conversación ya existe', 'Crear conversación',
        'Cambios del subagente listos para revisar', 'Cambios del subagente combinados; vuelve a verificar', 'Combinación interrumpida reanudada'],
    fr: ['Rechercher dans la mémoire du projet', 'Lire la mémoire du projet', 'Lire les notes de conception', 'Lire les tâches planifiées', 'Supprimer la tâche planifiée', 'La tâche planifiée existe déjà',
        'Rechercher des conversations', 'Lire un message de conversation', 'La conversation existe déjà', 'Créer une conversation',
        'Modifications du sous-agent à examiner', 'Modifications du sous-agent fusionnées ; vérifiez à nouveau', 'Fusion interrompue reprise'],
    de: ['Projektgedächtnis durchsuchen', 'Projektgedächtnis lesen', 'Designnotizen des Projekts lesen', 'Geplante Aufgaben lesen', 'Geplante Aufgabe löschen', 'Geplante Aufgabe existiert bereits',
        'Unterhaltungen durchsuchen', 'Nachricht der Unterhaltung lesen', 'Unterhaltung existiert bereits', 'Unterhaltung erstellen',
        'Änderungen des Sub-Agenten zur Prüfung bereit', 'Änderungen des Sub-Agenten zusammengeführt; erneut prüfen', 'Unterbrochene Zusammenführung fortgesetzt'],
    'pt-BR': ['Pesquisar na memória do projeto', 'Ler a memória do projeto', 'Ler notas de design do projeto', 'Ler tarefas agendadas', 'Excluir tarefa agendada', 'A tarefa agendada já existe',
        'Pesquisar conversas', 'Ler mensagem da conversa', 'A conversa já existe', 'Criar conversa',
        'Alterações do subagente prontas para revisão', 'Alterações do subagente mescladas; verifique novamente', 'Mesclagem interrompida retomada'],
    ru: ['Поиск в памяти проекта', 'Чтение памяти проекта', 'Чтение заметок о дизайне проекта', 'Чтение запланированных задач', 'Удаление запланированной задачи', 'Запланированная задача уже существует',
        'Поиск по разговорам', 'Чтение сообщения разговора', 'Разговор уже существует', 'Создание разговора',
        'Изменения субагента ждут проверки', 'Изменения субагента объединены; проверьте снова', 'Прерванное объединение возобновлено'],
    ar: ['البحث في ذاكرة المشروع', 'قراءة ذاكرة المشروع', 'قراءة ملاحظات تصميم المشروع', 'قراءة المهام المجدولة', 'حذف مهمة مجدولة', 'المهمة المجدولة موجودة بالفعل',
        'البحث في المحادثات', 'قراءة رسالة المحادثة', 'المحادثة موجودة بالفعل', 'إنشاء محادثة',
        'تغييرات الوكيل الفرعي جاهزة للمراجعة', 'تم دمج تغييرات الوكيل الفرعي؛ تحقّق مجددًا', 'استؤنف الدمج المتوقف'],
    hi: ['प्रोजेक्ट मेमोरी खोजें', 'प्रोजेक्ट मेमोरी पढ़ें', 'प्रोजेक्ट डिज़ाइन नोट्स पढ़ें', 'निर्धारित कार्य पढ़ें', 'निर्धारित कार्य हटाएँ', 'निर्धारित कार्य पहले से मौजूद है',
        'बातचीत खोजें', 'बातचीत का संदेश पढ़ें', 'बातचीत पहले से मौजूद है', 'बातचीत बनाएँ',
        'सब-एजेंट के बदलाव समीक्षा के लिए तैयार', 'सब-एजेंट के बदलाव मर्ज हुए; फिर सत्यापित करें', 'रुका हुआ मर्ज फिर शुरू हुआ']
};

/** The reader-language form of a fixed runtime title, or `undefined` for any other text. */
export function localizedRuntimeToolTitle(locale: NextMuxDesktopLocale, title: string): string | undefined {
    const index = Math.max((SOURCES as readonly string[]).indexOf(title.trim()), TITLES.en.indexOf(title.trim()));
    if (index < 0) return undefined;
    return locale === 'zh-CN' ? SOURCES[index] : (TITLES[locale] || TITLES.en)[index];
}

// Compact activity labels are action · object in every language. Keeping the
// two translated terms separate also prevents IDs, names and paths from being
// interpreted as translation keys. These are display labels, never model text.
const actionKeys = ['read', 'search', 'create', 'update', 'delete', 'move', 'apply', 'write', 'list', 'open', 'inspect', 'verify', 'click', 'doubleClick', 'rightClick', 'scroll', 'drag', 'fill', 'type', 'key', 'hotkey', 'show', 'screenshot', 'close', 'start', 'stop', 'status', 'review', 'merge', 'recover', 'restore', 'save', 'call'] as const;
const objectKeys = ['workspace', 'file', 'text', 'map', 'process', 'tools', 'memory', 'design', 'schedules', 'skill', 'mcp', 'conversation', 'comicProject', 'scene', 'shot', 'dialogue', 'character', 'storyboard', 'lyrics', 'scripts', 'app', 'window', 'tab', 'plugin', 'draft', 'input', 'output', 'bindings'] as const;
type Action = typeof actionKeys[number];
type ObjectKind = typeof objectKeys[number];
type Vocabulary = { readonly actions: string; readonly objects: string; readonly messages: string };
const vocabulary: Readonly<Record<NextMuxDesktopLocale, Vocabulary>> = {
    en: {
        actions: 'Read|Search|Create|Update|Delete|Move|Apply|Write|List|Open|Inspect|Verify|Click|Double-click|Right-click|Scroll|Drag|Fill|Type|Press key|Shortcut|Show|Screenshot|Close|Start|Stop|Status|Review|Merge|Recover|Restore|Save|Call',
        objects: 'Workspace|File|Text|Project map|Process|Tools|Project memory|Project design|Schedules|Skill|MCP server|Conversation|Comic project|Scene|Shot|Dialogue|Character|Storyboard|Lyrics|Scripts|App|Window|Tab|Plugin|Experience draft|Process input|Process output|Workspace bindings',
        messages: '{count} items|{count} matches|{count} files|{count} updates · sequence {sequence}|Search coverage is incomplete; narrow the directory and search again.|Changes are in a separate workspace; review before merging.|Task completed|Task stopped|Task limit reached|Tool execution failed|Permission denied|Tool not found|Tool not allowed|The operation result is unknown; it will not be replayed automatically.|Task cancelled|No changes needed|Already exists|Process exited|Awaiting user approval|{count} symbols|Tool completed|Tool started|The operation result needs verification'
    },
    'zh-CN': {
        actions: '读取|搜索|创建|更新|删除|移动|应用|写入|列出|打开|查看|核对|点击|双击|右键点击|滚动|拖动|填写|输入|按键|快捷键|显示|截图|关闭|启动|停止|状态|审查|合并|恢复|还原|保存|调用',
        objects: '工作区|文件|文本|项目结构|进程|工具|项目记忆|项目设计|计划|技能|MCP 服务|对话|漫画项目|场景|镜头|对白|角色|分镜改编|歌词|剧本|应用|窗口|标签|插件|经验草稿|进程输入|进程输出|工作目录',
        messages: '{count} 项|{count} 处匹配|{count} 个文件|{count} 个增量 · 序列 {sequence}|搜索范围未完全覆盖，请缩小目录继续搜索。|改动位于独立工作区，审查后可合并。|任务已完成|任务已停止|任务已达到限制|工具执行失败|权限不足|工具不存在|工具未获授权|操作结果不确定，不会自动重放。|任务已取消|无需修改|已存在|进程已结束|等待用户批准|{count} 个符号|工具已完成|工具已启动|操作结果待确认'
    },
    'zh-TW': {
        actions: '讀取|搜尋|建立|更新|刪除|移動|套用|寫入|列出|開啟|查看|核對|點擊|按兩下|按右鍵|捲動|拖曳|填寫|輸入|按鍵|快捷鍵|顯示|截圖|關閉|啟動|停止|狀態|審查|合併|復原|還原|儲存|呼叫',
        objects: '工作區|檔案|文字|專案結構|程序|工具|專案記憶|專案設計|排程|技能|MCP 服務|對話|漫畫專案|場景|鏡頭|對白|角色|分鏡改編|歌詞|劇本|應用程式|視窗|分頁|外掛|經驗草稿|程序輸入|程序輸出|工作目錄',
        messages: '{count} 項|{count} 處符合|{count} 個檔案|{count} 個增量 · 序列 {sequence}|搜尋範圍未完全涵蓋，請縮小目錄後再搜尋。|變更位於獨立工作區，審查後可合併。|任務已完成|任務已停止|任務已達限制|工具執行失敗|權限不足|工具不存在|工具未獲授權|操作結果不確定，不會自動重播。|任務已取消|無需修改|已存在|程序已結束|等待使用者核准|{count} 個符號|工具已完成|工具已啟動|操作結果待確認'
    },
    ja: {
        actions: '読み取り|検索|作成|更新|削除|移動|適用|書き込み|一覧|開く|確認|検証|クリック|ダブルクリック|右クリック|スクロール|ドラッグ|入力|文字入力|キー入力|ショートカット|表示|スクリーンショット|閉じる|開始|停止|状態|レビュー|統合|復旧|復元|保存|呼び出し',
        objects: 'ワークスペース|ファイル|テキスト|プロジェクト構造|プロセス|ツール|プロジェクトメモリ|プロジェクト設計|予定タスク|スキル|MCP サーバー|会話|漫画プロジェクト|シーン|ショット|台詞|キャラクター|絵コンテ|歌詞|脚本|アプリ|ウィンドウ|タブ|プラグイン|経験の下書き|プロセス入力|プロセス出力|作業ディレクトリ',
        messages: '{count} 件|{count} 件一致|{count} ファイル|更新 {count} 件 · 順序 {sequence}|検索範囲が不完全です。ディレクトリを絞って再検索してください。|変更は別のワークスペースにあります。レビューしてから統合してください。|タスク完了|タスク停止|タスクの上限に到達|ツール実行失敗|権限がありません|ツールが見つかりません|ツールは未承認です|操作結果が不明なため、自動再実行しません。|タスクをキャンセルしました|変更は不要です|既に存在します|プロセス終了|ユーザーの承認待ち|{count} シンボル|ツール完了|ツール開始|操作結果の確認が必要です'
    },
    ko: {
        actions: '읽기|검색|생성|업데이트|삭제|이동|적용|쓰기|목록|열기|확인|검증|클릭|두 번 클릭|오른쪽 클릭|스크롤|드래그|입력|텍스트 입력|키 누르기|단축키|표시|스크린샷|닫기|시작|중지|상태|검토|병합|복구|복원|저장|호출',
        objects: '워크스페이스|파일|텍스트|프로젝트 구조|프로세스|도구|프로젝트 메모리|프로젝트 설계|예약 작업|스킬|MCP 서버|대화|만화 프로젝트|장면|샷|대사|캐릭터|스토리보드|가사|대본|앱|창|탭|플러그인|경험 초안|프로세스 입력|프로세스 출력|작업 디렉터리',
        messages: '{count}개 항목|{count}개 일치|파일 {count}개|업데이트 {count}개 · 순서 {sequence}|검색 범위가 불완전합니다. 디렉터리를 좁혀 다시 검색하세요.|변경 사항은 별도 워크스페이스에 있습니다. 검토 후 병합하세요.|작업 완료|작업 중지|작업 한도 도달|도구 실행 실패|권한 부족|도구를 찾을 수 없음|도구가 승인되지 않음|작업 결과를 알 수 없어 자동으로 다시 실행하지 않습니다.|작업 취소됨|변경 불필요|이미 존재함|프로세스 종료|사용자 승인 대기|기호 {count}개|도구 완료|도구 시작|작업 결과 확인 필요'
    },
    es: {
        actions: 'Lectura|Búsqueda|Creación|Actualización|Eliminación|Movimiento|Aplicación|Escritura|Listado|Apertura|Inspección|Verificación|Clic|Doble clic|Clic derecho|Desplazamiento|Arrastre|Relleno|Entrada de texto|Pulsación de tecla|Atajo|Visualización|Captura|Cierre|Inicio|Detención|Estado|Revisión|Combinación|Recuperación|Restauración|Guardado|Llamada',
        objects: 'Espacio de trabajo|Archivo|Texto|Estructura del proyecto|Proceso|Herramientas|Memoria del proyecto|Diseño del proyecto|Tareas programadas|Habilidad|Servidor MCP|Conversación|Proyecto de cómic|Escena|Plano|Diálogo|Personaje|Guion gráfico|Letras|Guiones|Aplicación|Ventana|Pestaña|Complemento|Borrador de experiencia|Entrada del proceso|Salida del proceso|Directorios de trabajo',
        messages: '{count} elementos|{count} coincidencias|{count} archivos|{count} actualizaciones · secuencia {sequence}|La búsqueda está incompleta; limita el directorio y vuelve a buscar.|Los cambios están en otro espacio de trabajo; revísalos antes de combinarlos.|Tarea completada|Tarea detenida|Límite de tarea alcanzado|Falló la herramienta|Permiso denegado|Herramienta no encontrada|Herramienta no autorizada|El resultado es desconocido; la operación no se repetirá automáticamente.|Tarea cancelada|No se necesitan cambios|Ya existe|Proceso finalizado|Esperando autorización del usuario|{count} símbolos|Herramienta completada|Herramienta iniciada|El resultado requiere verificación'
    },
    fr: {
        actions: 'Lecture|Recherche|Création|Mise à jour|Suppression|Déplacement|Application|Écriture|Liste|Ouverture|Inspection|Vérification|Clic|Double-clic|Clic droit|Défilement|Glissement|Remplissage|Saisie|Touche|Raccourci|Affichage|Capture|Fermeture|Démarrage|Arrêt|État|Révision|Fusion|Récupération|Restauration|Enregistrement|Appel',
        objects: 'Espace de travail|Fichier|Texte|Structure du projet|Processus|Outils|Mémoire du projet|Conception du projet|Tâches planifiées|Compétence|Serveur MCP|Conversation|Projet de bande dessinée|Scène|Plan|Dialogue|Personnage|Storyboard|Paroles|Scénarios|Application|Fenêtre|Onglet|Extension|Brouillon d’expérience|Entrée du processus|Sortie du processus|Dossiers de travail',
        messages: '{count} éléments|{count} correspondances|{count} fichiers|{count} mises à jour · séquence {sequence}|La recherche est incomplète ; réduisez le dossier et relancez-la.|Les modifications sont dans un autre espace de travail ; vérifiez-les avant fusion.|Tâche terminée|Tâche arrêtée|Limite de tâche atteinte|Échec de l’outil|Permission refusée|Outil introuvable|Outil non autorisé|Le résultat est inconnu ; l’opération ne sera pas répétée automatiquement.|Tâche annulée|Aucune modification nécessaire|Existe déjà|Processus terminé|En attente d’autorisation|{count} symboles|Outil terminé|Outil démarré|Le résultat doit être vérifié'
    },
    de: {
        actions: 'Lesen|Suchen|Erstellen|Aktualisieren|Löschen|Verschieben|Anwenden|Schreiben|Auflisten|Öffnen|Prüfen|Überprüfen|Klicken|Doppelklick|Rechtsklick|Scrollen|Ziehen|Ausfüllen|Texteingabe|Tastendruck|Tastenkürzel|Anzeigen|Bildschirmfoto|Schließen|Starten|Stoppen|Zustand|Begutachten|Zusammenführen|Wiederherstellen|Zurücksetzen|Speichern|Aufrufen',
        objects: 'Arbeitsbereich|Datei|Text|Projektstruktur|Prozess|Werkzeuge|Projektgedächtnis|Projektgestaltung|Geplante Aufgaben|Fähigkeit|MCP-Server|Unterhaltung|Comicprojekt|Szene|Einstellung|Dialog|Figur|Storyboard|Liedtexte|Drehbücher|App|Fenster|Tab|Plugin|Erfahrungsentwurf|Prozesseingabe|Prozessausgabe|Arbeitsverzeichnisse',
        messages: '{count} Einträge|{count} Treffer|{count} Dateien|{count} Aktualisierungen · Sequenz {sequence}|Die Suche ist unvollständig. Grenze das Verzeichnis ein und suche erneut.|Die Änderungen liegen in einem separaten Arbeitsbereich. Prüfe sie vor dem Zusammenführen.|Aufgabe abgeschlossen|Aufgabe gestoppt|Aufgabenlimit erreicht|Werkzeug fehlgeschlagen|Zugriff verweigert|Werkzeug nicht gefunden|Werkzeug nicht genehmigt|Das Ergebnis ist unbekannt; die Aktion wird nicht automatisch wiederholt.|Aufgabe abgebrochen|Keine Änderungen nötig|Bereits vorhanden|Prozess beendet|Wartet auf Genehmigung|{count} Symbole|Werkzeug abgeschlossen|Werkzeug gestartet|Das Ergebnis muss überprüft werden'
    },
    'pt-BR': {
        actions: 'Leitura|Pesquisa|Criação|Atualização|Exclusão|Movimentação|Aplicação|Escrita|Listagem|Abertura|Inspeção|Verificação|Clique|Clique duplo|Clique direito|Rolagem|Arraste|Preenchimento|Digitação|Tecla|Atalho|Exibição|Captura|Fechamento|Início|Parada|Estado|Revisão|Mesclagem|Recuperação|Restauração|Salvamento|Chamada',
        objects: 'Espaço de trabalho|Arquivo|Texto|Estrutura do projeto|Processo|Ferramentas|Memória do projeto|Design do projeto|Tarefas agendadas|Habilidade|Servidor MCP|Conversa|Projeto de quadrinhos|Cena|Plano|Diálogo|Personagem|Storyboard|Letras|Roteiros|Aplicativo|Janela|Aba|Plugin|Rascunho de experiência|Entrada do processo|Saída do processo|Diretórios de trabalho',
        messages: '{count} itens|{count} correspondências|{count} arquivos|{count} atualizações · sequência {sequence}|A busca está incompleta; restrinja o diretório e pesquise novamente.|As alterações estão em outro espaço de trabalho; revise antes de mesclar.|Tarefa concluída|Tarefa interrompida|Limite da tarefa atingido|Falha na ferramenta|Permissão negada|Ferramenta não encontrada|Ferramenta não autorizada|O resultado é desconhecido; a operação não será repetida automaticamente.|Tarefa cancelada|Nenhuma alteração necessária|Já existe|Processo encerrado|Aguardando autorização|{count} símbolos|Ferramenta concluída|Ferramenta iniciada|O resultado precisa ser verificado'
    },
    ru: {
        actions: 'Чтение|Поиск|Создание|Обновление|Удаление|Перемещение|Применение|Запись|Список|Открытие|Осмотр|Проверка|Щелчок|Двойной щелчок|Правый щелчок|Прокрутка|Перетаскивание|Заполнение|Ввод текста|Нажатие клавиши|Сочетание клавиш|Показ|Снимок экрана|Закрытие|Запуск|Остановка|Состояние|Рецензирование|Объединение|Восстановление|Откат|Сохранение|Вызов',
        objects: 'Рабочая область|Файл|Текст|Структура проекта|Процесс|Инструменты|Память проекта|Дизайн проекта|Запланированные задачи|Навык|Сервер MCP|Разговор|Проект комикса|Сцена|Кадр|Диалог|Персонаж|Раскадровка|Тексты песен|Сценарии|Приложение|Окно|Вкладка|Плагин|Черновик опыта|Ввод процесса|Вывод процесса|Рабочие каталоги',
        messages: 'Элементов: {count}|Совпадений: {count}|Файлов: {count}|Обновлений: {count} · последовательность {sequence}|Поиск неполный. Сузьте каталог и повторите поиск.|Изменения находятся в отдельной рабочей области. Проверьте их перед объединением.|Задача завершена|Задача остановлена|Достигнут лимит задачи|Ошибка инструмента|Доступ запрещён|Инструмент не найден|Инструмент не разрешён|Результат неизвестен; операция не будет повторена автоматически.|Задача отменена|Изменения не нужны|Уже существует|Процесс завершён|Ожидание разрешения пользователя|Символов: {count}|Инструмент завершён|Инструмент запущен|Результат требует проверки'
    },
    ar: {
        actions: 'قراءة|بحث|إنشاء|تحديث|حذف|نقل|تطبيق|كتابة|قائمة|فتح|فحص|تحقق|نقر|نقر مزدوج|نقر بالزر الأيمن|تمرير|سحب|ملء|إدخال نص|ضغط مفتاح|اختصار|عرض|لقطة شاشة|إغلاق|بدء|إيقاف|حالة|مراجعة|دمج|استرداد|استعادة|حفظ|استدعاء',
        objects: 'مساحة العمل|ملف|نص|بنية المشروع|عملية|أدوات|ذاكرة المشروع|تصميم المشروع|مهام مجدولة|مهارة|خادم MCP|محادثة|مشروع قصص مصورة|مشهد|لقطة|حوار|شخصية|لوحة القصة|كلمات الأغنية|نصوص|تطبيق|نافذة|علامة تبويب|إضافة|مسودة خبرة|مدخلات العملية|مخرجات العملية|مجلدات العمل',
        messages: '{count} عناصر|{count} تطابقات|{count} ملفات|{count} تحديثات · التسلسل {sequence}|البحث غير مكتمل؛ حدد مجلداً أضيق وأعد البحث.|التغييرات في مساحة عمل منفصلة؛ راجعها قبل الدمج.|اكتملت المهمة|توقفت المهمة|تم بلوغ حد المهمة|فشل تنفيذ الأداة|الإذن مرفوض|الأداة غير موجودة|الأداة غير مصرح بها|نتيجة العملية غير معروفة؛ لن تتكرر تلقائياً.|أُلغيت المهمة|لا حاجة لتغييرات|موجود بالفعل|انتهت العملية|بانتظار موافقة المستخدم|{count} رموز|اكتملت الأداة|بدأت الأداة|تحتاج النتيجة إلى التحقق'
    },
    hi: {
        actions: 'पढ़ना|खोज|बनाना|अपडेट|हटाना|स्थानांतरण|लागू करना|लिखना|सूची|खोलना|निरीक्षण|सत्यापन|क्लिक|दोहरा क्लिक|दायाँ क्लिक|स्क्रॉल|खींचना|भरना|टाइप करना|कुंजी दबाना|शॉर्टकट|दिखाना|स्क्रीनशॉट|बंद करना|शुरू करना|रोकना|स्थिति|समीक्षा|मर्ज|पुनर्प्राप्ति|बहाली|सहेजना|कॉल',
        objects: 'वर्कस्पेस|फ़ाइल|पाठ|प्रोजेक्ट संरचना|प्रक्रिया|टूल|प्रोजेक्ट मेमोरी|प्रोजेक्ट डिज़ाइन|निर्धारित कार्य|कौशल|MCP सर्वर|बातचीत|कॉमिक प्रोजेक्ट|दृश्य|शॉट|संवाद|पात्र|स्टोरीबोर्ड|गीत|पटकथाएँ|ऐप|विंडो|टैब|प्लगइन|अनुभव मसौदा|प्रक्रिया इनपुट|प्रक्रिया आउटपुट|कार्य निर्देशिकाएँ',
        messages: '{count} आइटम|{count} मिलान|{count} फ़ाइलें|{count} अपडेट · क्रम {sequence}|खोज अधूरी है; निर्देशिका सीमित करके फिर खोजें।|बदलाव अलग वर्कस्पेस में हैं; मर्ज करने से पहले समीक्षा करें।|कार्य पूरा हुआ|कार्य रुक गया|कार्य सीमा पूरी हुई|टूल निष्पादन विफल|अनुमति अस्वीकृत|टूल नहीं मिला|टूल अधिकृत नहीं है|परिणाम अज्ञात है; कार्रवाई अपने आप दोहराई नहीं जाएगी।|कार्य रद्द हुआ|बदलाव आवश्यक नहीं|पहले से मौजूद|प्रक्रिया समाप्त|उपयोगकर्ता की अनुमति की प्रतीक्षा|{count} प्रतीक|टूल पूरा हुआ|टूल शुरू हुआ|परिणाम का सत्यापन आवश्यक है'
    }
};

const operations: Readonly<Record<string, readonly [Action, ObjectKind]>> = {
    'workspace.list_files': ['list', 'workspace'], 'workspace.read_file': ['read', 'file'], 'workspace.search_text': ['search', 'text'],
    'workspace.project_map': ['inspect', 'map'], 'workspace.write_file': ['write', 'file'], 'workspace.apply_patch': ['apply', 'file'], 'workspace.restore': ['restore', 'file'],
    'workspace.list_bindings': ['list', 'bindings'], 'process.run': ['call', 'process'], 'process.start': ['start', 'process'],
    'process.read': ['read', 'output'], 'process.write': ['write', 'input'], 'process.terminate': ['stop', 'process'], 'tool.search': ['search', 'tools'],
    'project_memory.search': ['search', 'memory'], 'project_memory.read': ['read', 'memory'], 'project_memory.propose': ['save', 'draft'], 'project_design.read': ['read', 'design'],
    'nextmux.skills.list': ['list', 'skill'], 'nextmux.skills.install': ['apply', 'skill'], 'nextmux.skills.create': ['create', 'skill'],
    'nextmux.mcp.add': ['create', 'mcp'], 'nextmux.mcp.list': ['list', 'mcp'], 'nextmux.list_schedules': ['read', 'schedules'],
    'nextmux.schedule.create': ['create', 'schedules'], 'nextmux.schedule.update': ['update', 'schedules'], 'nextmux.schedule.remove': ['delete', 'schedules'], 'nextmux.schedule.exists': ['read', 'schedules'],
    'agent.review_changes': ['review', 'workspace'], 'agent.merge_changes': ['merge', 'workspace'], 'agent.recover_merge': ['recover', 'workspace'],
    'conversation.search': ['search', 'conversation'], 'conversation.read': ['read', 'conversation'], 'conversation.create': ['create', 'conversation'], 'conversation.exists': ['read', 'conversation'],
    'comic.get_project': ['read', 'comicProject'], 'comic.get_scene': ['read', 'scene'], 'comic.create_project': ['create', 'comicProject'], 'comic.update_project': ['update', 'comicProject'],
    'comic.add_scene': ['create', 'scene'], 'comic.update_scene': ['update', 'scene'], 'comic.delete_scene': ['delete', 'scene'],
    'comic.add_shot': ['create', 'shot'], 'comic.update_shot': ['update', 'shot'], 'comic.delete_shot': ['delete', 'shot'], 'comic.move_shot': ['move', 'shot'],
    'comic.replace_dialogue': ['update', 'dialogue'], 'comic.add_character': ['create', 'character'], 'comic.update_character': ['update', 'character'], 'comic.delete_character': ['delete', 'character'],
    'comic.apply_adaptation': ['apply', 'storyboard'], 'comic.write_lyrics': ['write', 'lyrics'], 'comic.write_scripts': ['write', 'scripts'],
    'skill.load': ['read', 'skill'], 'mcp.call': ['call', 'mcp'],
    'computer.list_apps': ['list', 'app'], 'computer.list_windows': ['list', 'window'], 'computer.open_app': ['open', 'app'],
    'computer.observe_window': ['inspect', 'window'], 'computer.verify_state': ['verify', 'window'], 'computer.click': ['click', 'app'],
    'computer.double_click': ['doubleClick', 'app'], 'computer.right_click': ['rightClick', 'app'], 'computer.scroll': ['scroll', 'app'], 'computer.drag': ['drag', 'app'],
    'computer.set_value': ['fill', 'app'], 'computer.type_text': ['type', 'app'], 'computer.press_key': ['key', 'app'], 'computer.hotkey': ['hotkey', 'app'],
    'tabs.open_app': ['open', 'app'], 'tabs.list': ['list', 'tab'], 'tabs.set': ['update', 'tab'], 'tabs.show': ['show', 'tab'], 'tabs.screenshot': ['screenshot', 'tab'],
    'tabs.click': ['click', 'tab'], 'tabs.drag': ['drag', 'tab'], 'tabs.scroll': ['scroll', 'tab'], 'tabs.key': ['key', 'tab'], 'tabs.type': ['type', 'tab'], 'tabs.close': ['close', 'tab'],
    'plugins.list': ['list', 'plugin'], 'plugins.start': ['start', 'plugin'], 'plugins.command': ['update', 'plugin'], 'plugins.status': ['status', 'plugin'], 'plugins.stop': ['stop', 'plugin']
};

export const runtimeActivityKinds = Object.keys(operations);

const errorMessages: Readonly<Record<NextMuxDesktopLocale, readonly string[]>> = {
    en: ['The target is not a file', 'The file exceeds the size limit', 'Check the tool arguments', 'The path is outside the allowed workspace', 'Read a new browser snapshot before acting', 'This action is not supported', 'The operation timed out; verify its result before retrying', 'The operation was cancelled', 'The requested file was not found', 'The edit format wasn’t recognized; retrying another way', 'The edit didn’t match the file’s current content', 'The file changed since it was read; reading it again'],
    'zh-CN': ['目标不是文件', '文件超过大小限制', '请检查工具参数', '路径超出允许的工作区', '请先读取新的浏览器快照再操作', '不支持此操作', '操作已超时，请核对结果后再重试', '操作已取消', '未找到请求的文件', '修改格式无法识别，正在换一种方式', '修改内容与文件当前内容不符', '文件在读取后已变化，正在重新读取'],
    'zh-TW': ['目標不是檔案', '檔案超過大小限制', '請檢查工具參數', '路徑超出允許的工作區', '請先讀取新的瀏覽器快照再操作', '不支援此操作', '操作已逾時，請核對結果後再重試', '操作已取消', '找不到要求的檔案', '修改格式無法辨識，正在換一種方式', '修改內容與檔案目前內容不符', '檔案在讀取後已變更，正在重新讀取'],
    ja: ['対象はファイルではありません', 'ファイルのサイズが上限を超えています', 'ツールの引数を確認してください', 'パスは許可されたワークスペース外です', '操作前に新しいブラウザのスナップショットを読んでください', 'この操作はサポートされていません', '操作がタイムアウトしました。結果を確認してから再試行してください', '操作がキャンセルされました', '指定されたファイルが見つかりません', '編集形式を認識できません。別の方法で再試行します', '編集内容がファイルの現在の内容と一致しません', '読み取り後にファイルが変更されました。再読み込みします'],
    ko: ['대상이 파일이 아닙니다', '파일이 크기 제한을 초과합니다', '도구 인수를 확인하세요', '경로가 허용된 워크스페이스 밖에 있습니다', '작업 전에 새 브라우저 스냅샷을 읽으세요', '지원되지 않는 작업입니다', '작업 시간이 초과되었습니다. 결과를 확인한 후 다시 시도하세요', '작업이 취소되었습니다', '요청한 파일을 찾을 수 없습니다', '편집 형식을 인식하지 못했습니다. 다른 방법으로 다시 시도합니다', '편집 내용이 파일의 현재 내용과 맞지 않습니다', '읽은 후 파일이 변경되어 다시 읽는 중입니다'],
    es: ['El destino no es un archivo', 'El archivo supera el límite de tamaño', 'Comprueba los argumentos de la herramienta', 'La ruta está fuera del espacio de trabajo permitido', 'Lee una nueva captura del navegador antes de actuar', 'Esta acción no es compatible', 'La operación agotó el tiempo; verifica el resultado antes de reintentar', 'La operación se canceló', 'No se encontró el archivo solicitado', 'No se reconoció el formato de la edición; se intenta de otra forma', 'La edición no coincide con el contenido actual del archivo', 'El archivo cambió después de leerlo; se vuelve a leer'],
    fr: ['La cible n’est pas un fichier', 'Le fichier dépasse la taille autorisée', 'Vérifiez les arguments de l’outil', 'Le chemin est hors de l’espace de travail autorisé', 'Lisez un nouvel instantané du navigateur avant d’agir', 'Cette action n’est pas prise en charge', 'Le délai est dépassé ; vérifiez le résultat avant de réessayer', 'L’opération a été annulée', 'Le fichier demandé est introuvable', 'Format de modification non reconnu ; nouvel essai autrement', 'La modification ne correspond pas au contenu actuel du fichier', 'Le fichier a changé depuis sa lecture ; nouvelle lecture'],
    de: ['Das Ziel ist keine Datei', 'Die Datei überschreitet das Größenlimit', 'Prüfe die Werkzeugargumente', 'Der Pfad liegt außerhalb des erlaubten Arbeitsbereichs', 'Lies vor der Aktion einen neuen Browser-Snapshot', 'Diese Aktion wird nicht unterstützt', 'Die Aktion hat das Zeitlimit überschritten; prüfe das Ergebnis vor einem neuen Versuch', 'Die Aktion wurde abgebrochen', 'Die angeforderte Datei wurde nicht gefunden', 'Das Änderungsformat wurde nicht erkannt; neuer Versuch auf anderem Weg', 'Die Änderung passt nicht zum aktuellen Dateiinhalt', 'Die Datei hat sich seit dem Lesen geändert; sie wird neu gelesen'],
    'pt-BR': ['O destino não é um arquivo', 'O arquivo excede o limite de tamanho', 'Verifique os argumentos da ferramenta', 'O caminho está fora do espaço de trabalho permitido', 'Leia uma nova captura do navegador antes de agir', 'Esta ação não é suportada', 'A operação expirou; verifique o resultado antes de tentar novamente', 'A operação foi cancelada', 'O arquivo solicitado não foi encontrado', 'O formato da edição não foi reconhecido; tentando de outra forma', 'A edição não corresponde ao conteúdo atual do arquivo', 'O arquivo mudou depois da leitura; lendo novamente'],
    ru: ['Цель не является файлом', 'Файл превышает допустимый размер', 'Проверьте аргументы инструмента', 'Путь находится за пределами разрешённой рабочей области', 'Перед действием прочитайте новый снимок браузера', 'Это действие не поддерживается', 'Время операции истекло; проверьте результат перед повтором', 'Операция отменена', 'Запрошенный файл не найден', 'Формат правки не распознан; пробуем другим способом', 'Правка не совпадает с текущим содержимым файла', 'Файл изменился после чтения; читаем заново'],
    ar: ['الهدف ليس ملفاً', 'يتجاوز الملف حد الحجم', 'تحقق من معاملات الأداة', 'المسار خارج مساحة العمل المسموحة', 'اقرأ لقطة متصفح جديدة قبل التصرف', 'هذا الإجراء غير مدعوم', 'انتهت مهلة العملية؛ تحقق من النتيجة قبل إعادة المحاولة', 'أُلغيت العملية', 'لم يتم العثور على الملف المطلوب', 'لم يُتعرّف على صيغة التعديل؛ تجري المحاولة بطريقة أخرى', 'لا يطابق التعديل المحتوى الحالي للملف', 'تغيّر الملف بعد قراءته؛ تجري إعادة قراءته'],
    hi: ['लक्ष्य फ़ाइल नहीं है', 'फ़ाइल आकार सीमा से अधिक है', 'टूल के तर्क जाँचें', 'पथ अनुमत वर्कस्पेस से बाहर है', 'कार्रवाई से पहले नया ब्राउज़र स्नैपशॉट पढ़ें', 'यह कार्रवाई समर्थित नहीं है', 'कार्रवाई का समय समाप्त हुआ; दोबारा प्रयास से पहले परिणाम जाँचें', 'कार्रवाई रद्द हुई', 'अनुरोधित फ़ाइल नहीं मिली', 'संपादन का प्रारूप पहचाना नहीं गया; दूसरे तरीके से कोशिश हो रही है', 'संपादन फ़ाइल की मौजूदा सामग्री से मेल नहीं खाता', 'पढ़ने के बाद फ़ाइल बदल गई; फिर से पढ़ी जा रही है']
};

function localizedToolError(locale: NextMuxDesktopLocale, code: string): string | undefined {
    const index = code === 'NOT_A_FILE' ? 0 : /FILE_TOO_LARGE|RANGE_TOO_LARGE/.test(code) ? 1
        : /^INVALID_|ARGUMENT/.test(code) ? 2 : /PATH.*(?:OUTSIDE|ESCAPE)|OUTSIDE_WORKSPACE/.test(code) ? 3
            : /STALE_(?:ELEMENT_REF|REFERENCE)|BROWSER_(?:FRAME_CHANGED|TARGET_REQUIRED|AMBIGUOUS_SELECTOR)/.test(code) ? 4
                : /UNSUPPORTED/.test(code) ? 5 : /TIMEOUT|TIMED_OUT/.test(code) ? 6 : /CANCELLED|DISPOSED|EXPIRED/.test(code) ? 7
                    : /FILE_NOT_FOUND|ENOENT/.test(code) ? 8 : code === 'PATCH_INVALID' ? 9 : code === 'PATCH_FAILED' ? 10
                        : code === 'STALE_WRITE' ? 11 : -1;
    return index < 0 ? undefined : errorMessages[locale][index];
}

export function localizedRuntimeActivity(locale: NextMuxDesktopLocale, summary: Pick<ToolExecutionSummary, 'kind' | 'params' | 'details'>): { title: string; details: readonly string[] } | undefined {
    const { kind, params = {} } = summary;
    if (!kind) return undefined;
    const words = vocabulary[locale];
    const message = (index: number, values = params): string => words.messages.split('|')[index].replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? ''));
    const operation = operations[kind];
    let title = operation ? `${words.actions.split('|')[actionKeys.indexOf(operation[0])]} · ${words.objects.split('|')[objectKeys.indexOf(operation[1])]}` : '';
    const details = [...(summary.details || [])]; // Explicit external names/paths, never generated prose.
    if (kind === 'tool.error') {
        const code = String(params.code || '');
        title = localizedToolError(locale, code) || message(code === 'CANCELLED' ? 14 : /PERMISSION/.test(code) ? 10 : code === 'TOOL_NOT_FOUND' ? 11 : code === 'TOOL_NOT_ALLOWED' ? 12
            : code === 'TOOL_EXECUTION_UNKNOWN' ? 13 : code === 'COMPUTER_AX_ACTION_UNCONFIRMED' ? 22 : 9);
        // Diagnostics remain in the event; expanded details show the safe localized reason.
        return { title, details: title ? [title] : [] };
    }
    if (kind === 'tool.execution_unknown') return { title: message(13), details: [] };
    if (kind === 'tool.started' || kind === 'tool.completed') return { title: typeof params.target === 'string' && params.target
        ? params.target : message(kind === 'tool.started' ? 21 : 20), details: [] };
    if (kind === 'agent.delegate') {
        title = message(params.status === 'cancelled' ? 7 : params.status === 'limit_reached' || params.status === 'paused' ? 8 : 6);
        if (params.requiresMerge) details.push(message(5));
    }
    if (!title) return undefined;
    if (typeof params.name === 'string' && params.name) title += `: ${params.name}`;
    if (kind.endsWith('.exists')) details.push(message(16));
    if (kind === 'nextmux.mcp.add') details.push(message(18));
    if (kind === 'workspace.apply_patch' && params.unchanged) details.push(message(15));
    if (kind === 'process.read') {
        details.push(message(3));
        if (params.running === false) details.push(message(17));
    } else if (typeof params.count === 'number') details.push(message(kind === 'workspace.search_text' || kind === 'tool.search' ? 1 : kind === 'workspace.project_map' ? 2 : 0));
    if (kind === 'workspace.search_text' && params.incomplete) details.push(message(4));
    if (kind === 'workspace.project_map' && typeof params.symbolCount === 'number') details.push(message(19, { count: params.symbolCount }));
    return { title, details: [...new Set(details)] };
}
