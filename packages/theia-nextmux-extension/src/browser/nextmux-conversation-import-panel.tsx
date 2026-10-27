import { conversationText } from './nextmux-conversation-locale';
import { conversationErrorPresentation, conversationDetailsLabel } from './nextmux-conversation-domain-locale';
import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import type {
    ConversationImportCandidate, ConversationImportResult, ConversationImportScan, ConversationImportSource, ConversationImportSourceSummary
} from '../common/nextmux-conversation-import-protocol';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

/** Settings → Import: bring conversations from Claude Code, Claude Cowork, Codex and Cursor into NextMux. */

type Key = 'nav' | 'title' | 'lead' | 'rescan' | 'scanning' | 'scannedAt' | 'notFound' | 'noAccess' | 'noAccessHint' | 'addFolder' | 'removeFolder' | 'removeFolderHint' | 'customTag' | 'removeImported' | 'removeImportedConfirm'
    | 'counts' | 'nothing' | 'importAll' | 'importSelected' | 'choose' | 'hideList' | 'importing' | 'done' | 'failedCount' | 'undo' | 'undone'
    | 'status.new' | 'status.updated' | 'status.deleted' | 'status.imported' | 'noProject' | 'selectAll' | 'historyOff' | 'error' | 'searchPlaceholder' | 'more';

const catalog: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<Key, string>>>> = {
    'zh-CN': { removeImported: '移除已导入的对话（{count}）', removeImportedConfirm: '再点一次，移除这 {count} 个对话', nav: '导入', title: '导入其他工具的对话', lead: '把 Claude Code、Claude Cowork、Codex 和 Cursor 里的对话导入 NextMux。只读取，不会修改这些工具的文件。导入后会出现在左侧对应的项目里。',
        rescan: '重新扫描', scanning: '正在扫描…', scannedAt: '上次扫描：{time}', notFound: '未在默认位置找到', noAccess: '没有读取权限', noAccessHint: '在“系统设置 → 隐私与安全性 → 完全磁盘访问”里允许 NextMux 后重新扫描。', addFolder: '添加其他位置…', removeFolder: '不再扫描此位置', removeFolderHint: '以后不再从这个文件夹查找对话。不会删除任何文件，也不会删除已导入的对话。', customTag: '你添加的',
        counts: '{importable} 个可导入 · {imported} 个已导入', nothing: '没有找到对话', importAll: '导入全部（{count}）', importSelected: '导入所选（{count}）', choose: '选择对话…', hideList: '收起列表', importing: '正在导入…',
        done: '已导入 {imported} 个，更新 {updated} 个', failedCount: '{count} 个未导入', undo: '撤销本次导入', undone: '已撤销，移除了 {count} 个对话',
        'status.new': '新', 'status.updated': '有更新', 'status.deleted': '已删除，可重新导入', 'status.imported': '已导入', noProject: '无项目', selectAll: '全选', historyOff: '请先在“隐私”中开启“保存本机对话记录”。', error: '出错了：{error}', searchPlaceholder: '搜索标题或项目', more: '还有 {count} 个，搜索可缩小范围' },
    'zh-TW': { removeImported: '移除已匯入的對話（{count}）', removeImportedConfirm: '再點一次，移除這 {count} 個對話', nav: '匯入', title: '匯入其他工具的對話', lead: '把 Claude Code、Claude Cowork、Codex 和 Cursor 裡的對話匯入 NextMux。只讀取，不會修改這些工具的檔案。匯入後會出現在左側對應的專案裡。',
        rescan: '重新掃描', scanning: '正在掃描…', scannedAt: '上次掃描：{time}', notFound: '未在預設位置找到', noAccess: '沒有讀取權限', noAccessHint: '在「系統設定 → 隱私權與安全性 → 完整磁碟取用權限」允許 NextMux 後重新掃描。', addFolder: '新增其他位置…', removeFolder: '不再掃描此位置', removeFolderHint: '之後不再從這個資料夾尋找對話。不會刪除任何檔案，也不會刪除已匯入的對話。', customTag: '你新增的',
        counts: '{importable} 個可匯入 · {imported} 個已匯入', nothing: '沒有找到對話', importAll: '全部匯入（{count}）', importSelected: '匯入所選（{count}）', choose: '選擇對話…', hideList: '收起清單', importing: '正在匯入…',
        done: '已匯入 {imported} 個，更新 {updated} 個', failedCount: '{count} 個未匯入', undo: '復原這次匯入', undone: '已復原，移除了 {count} 個對話',
        'status.new': '新', 'status.updated': '有更新', 'status.deleted': '已刪除，可重新匯入', 'status.imported': '已匯入', noProject: '無專案', selectAll: '全選', historyOff: '請先在「隱私」中開啟「儲存本機對話記錄」。', error: '發生錯誤：{error}', searchPlaceholder: '搜尋標題或專案', more: '還有 {count} 個，可用搜尋縮小範圍' },
    en: { removeImported: 'Remove imported conversations ({count})', removeImportedConfirm: 'Click again to remove these {count} conversations', nav: 'Import', title: 'Import conversations from other tools', lead: 'Bring conversations from Claude Code, Claude Cowork, Codex and Cursor into NextMux. Their files are only read, never changed. Imported conversations appear under their project on the left.',
        rescan: 'Scan again', scanning: 'Scanning…', scannedAt: 'Last scan: {time}', notFound: 'Not found in the usual place', noAccess: 'No permission to read', noAccessHint: 'Allow NextMux in System Settings → Privacy & Security → Full Disk Access, then scan again.', addFolder: 'Add another location…', removeFolder: 'Stop scanning here', removeFolderHint: 'NextMux stops looking for conversations in this folder. No files and no imported conversations are deleted.', customTag: 'Added by you',
        counts: '{importable} to import · {imported} imported', nothing: 'No conversations found', importAll: 'Import all ({count})', importSelected: 'Import selected ({count})', choose: 'Choose conversations…', hideList: 'Hide list', importing: 'Importing…',
        done: 'Imported {imported}, updated {updated}', failedCount: '{count} not imported', undo: 'Undo this import', undone: 'Undone: removed {count} conversations',
        'status.new': 'New', 'status.updated': 'Updated', 'status.deleted': 'Deleted, can import again', 'status.imported': 'Imported', noProject: 'No project', selectAll: 'Select all', historyOff: 'Turn on “Save conversation history” in Privacy first.', error: 'Something went wrong: {error}', searchPlaceholder: 'Search titles or projects', more: '{count} more — search to narrow down' },
    ja: { removeImported: '取り込んだ会話を削除（{count}）', removeImportedConfirm: 'もう一度クリックで {count} 件を削除', nav: 'インポート', title: '他のツールの会話をインポート', lead: 'Claude Code、Claude Cowork、Codex、Cursor の会話を NextMux に取り込みます。ファイルは読み取るだけで変更しません。取り込んだ会話は左側の該当プロジェクトに表示されます。',
        rescan: '再スキャン', scanning: 'スキャン中…', scannedAt: '前回のスキャン：{time}', notFound: '通常の場所に見つかりません', noAccess: '読み取り権限がありません', noAccessHint: 'システム設定 → プライバシーとセキュリティ → フルディスクアクセスで NextMux を許可してから再スキャンしてください。', addFolder: '別の場所を追加…', removeFolder: 'この場所を検索しない', removeFolderHint: 'このフォルダーでの会話の検索をやめます。ファイルや取り込み済みの会話は削除されません。', customTag: '追加した場所',
        counts: 'インポート可能 {importable} 件 · 取り込み済み {imported} 件', nothing: '会話が見つかりません', importAll: 'すべてインポート（{count}）', importSelected: '選択分をインポート（{count}）', choose: '会話を選ぶ…', hideList: 'リストを閉じる', importing: 'インポート中…',
        done: '{imported} 件を取り込み、{updated} 件を更新しました', failedCount: '{count} 件は取り込めませんでした', undo: '今回のインポートを取り消す', undone: '取り消しました（{count} 件を削除）',
        'status.new': '新規', 'status.updated': '更新あり', 'status.deleted': '削除済み・再取り込み可', 'status.imported': '取り込み済み', noProject: 'プロジェクトなし', selectAll: 'すべて選択', historyOff: '先に「プライバシー」で会話履歴の保存をオンにしてください。', error: 'エラー：{error}', searchPlaceholder: 'タイトルやプロジェクトを検索', more: 'ほかに {count} 件 — 検索で絞り込めます' },
    ko: { removeImported: '가져온 대화 제거({count})', removeImportedConfirm: '한 번 더 클릭하면 {count}개를 제거합니다', nav: '가져오기', title: '다른 도구의 대화 가져오기', lead: 'Claude Code, Claude Cowork, Codex, Cursor의 대화를 NextMux로 가져옵니다. 파일은 읽기만 하고 바꾸지 않습니다. 가져온 대화는 왼쪽의 해당 프로젝트 아래에 표시됩니다.',
        rescan: '다시 검색', scanning: '검색 중…', scannedAt: '마지막 검색: {time}', notFound: '기본 위치에서 찾지 못함', noAccess: '읽기 권한 없음', noAccessHint: '시스템 설정 → 개인정보 보호 및 보안 → 전체 디스크 접근 권한에서 NextMux를 허용한 뒤 다시 검색하세요.', addFolder: '다른 위치 추가…', removeFolder: '이 위치 검색 안 함', removeFolderHint: '이 폴더에서 더 이상 대화를 찾지 않습니다. 파일이나 가져온 대화는 삭제되지 않습니다.', customTag: '직접 추가함',
        counts: '가져올 수 있음 {importable}개 · 가져옴 {imported}개', nothing: '대화를 찾지 못했습니다', importAll: '모두 가져오기({count})', importSelected: '선택 항목 가져오기({count})', choose: '대화 선택…', hideList: '목록 접기', importing: '가져오는 중…',
        done: '{imported}개 가져옴, {updated}개 업데이트', failedCount: '{count}개는 가져오지 못함', undo: '이번 가져오기 취소', undone: '취소됨: 대화 {count}개 제거',
        'status.new': '새 대화', 'status.updated': '업데이트 있음', 'status.deleted': '삭제됨, 다시 가져오기 가능', 'status.imported': '가져옴', noProject: '프로젝트 없음', selectAll: '모두 선택', historyOff: '먼저 개인정보에서 “대화 기록 저장”을 켜세요.', error: '오류: {error}', searchPlaceholder: '제목 또는 프로젝트 검색', more: '{count}개 더 있음 — 검색으로 좁혀 보세요' },
    es: { removeImported: 'Quitar conversaciones importadas ({count})', removeImportedConfirm: 'Pulsa otra vez para quitar {count}', nav: 'Importar', title: 'Importar conversaciones de otras herramientas', lead: 'Trae a NextMux las conversaciones de Claude Code, Claude Cowork, Codex y Cursor. Sus archivos solo se leen, nunca se cambian. Aparecen bajo su proyecto a la izquierda.',
        rescan: 'Buscar de nuevo', scanning: 'Buscando…', scannedAt: 'Última búsqueda: {time}', notFound: 'No está en la ubicación habitual', noAccess: 'Sin permiso de lectura', noAccessHint: 'Permite NextMux en Ajustes del Sistema → Privacidad y seguridad → Acceso total al disco y vuelve a buscar.', addFolder: 'Añadir otra ubicación…', removeFolder: 'Dejar de buscar aquí', removeFolderHint: 'NextMux deja de buscar conversaciones en esta carpeta. No se borra ningún archivo ni conversación importada.', customTag: 'Añadida por ti',
        counts: '{importable} por importar · {imported} importadas', nothing: 'No se encontraron conversaciones', importAll: 'Importar todo ({count})', importSelected: 'Importar selección ({count})', choose: 'Elegir conversaciones…', hideList: 'Ocultar lista', importing: 'Importando…',
        done: '{imported} importadas, {updated} actualizadas', failedCount: '{count} sin importar', undo: 'Deshacer esta importación', undone: 'Deshecho: se quitaron {count} conversaciones',
        'status.new': 'Nueva', 'status.updated': 'Actualizada', 'status.deleted': 'Eliminada, se puede reimportar', 'status.imported': 'Importada', noProject: 'Sin proyecto', selectAll: 'Seleccionar todo', historyOff: 'Activa antes “Guardar historial de conversaciones” en Privacidad.', error: 'Algo salió mal: {error}', searchPlaceholder: 'Buscar títulos o proyectos', more: '{count} más: busca para acotar' },
    fr: { removeImported: 'Retirer les conversations importées ({count})', removeImportedConfirm: 'Cliquez encore pour en retirer {count}', nav: 'Importer', title: 'Importer des conversations d’autres outils', lead: 'Importez dans NextMux les conversations de Claude Code, Claude Cowork, Codex et Cursor. Leurs fichiers sont seulement lus, jamais modifiés. Elles apparaissent sous leur projet à gauche.',
        rescan: 'Rechercher à nouveau', scanning: 'Recherche…', scannedAt: 'Dernière recherche : {time}', notFound: 'Introuvable à l’emplacement habituel', noAccess: 'Lecture non autorisée', noAccessHint: 'Autorisez NextMux dans Réglages Système → Confidentialité et sécurité → Accès complet au disque, puis relancez la recherche.', addFolder: 'Ajouter un autre emplacement…', removeFolder: 'Ne plus chercher ici', removeFolderHint: 'NextMux ne cherche plus de conversations dans ce dossier. Aucun fichier ni conversation importée n’est supprimé.', customTag: 'Ajouté par vous',
        counts: '{importable} à importer · {imported} importées', nothing: 'Aucune conversation trouvée', importAll: 'Tout importer ({count})', importSelected: 'Importer la sélection ({count})', choose: 'Choisir des conversations…', hideList: 'Masquer la liste', importing: 'Importation…',
        done: '{imported} importées, {updated} mises à jour', failedCount: '{count} non importées', undo: 'Annuler cette importation', undone: 'Annulé : {count} conversations retirées',
        'status.new': 'Nouvelle', 'status.updated': 'Mise à jour', 'status.deleted': 'Supprimée, réimportable', 'status.imported': 'Importée', noProject: 'Sans projet', selectAll: 'Tout sélectionner', historyOff: 'Activez d’abord « Enregistrer l’historique » dans Confidentialité.', error: 'Une erreur est survenue : {error}', searchPlaceholder: 'Rechercher un titre ou un projet', more: '{count} de plus — recherchez pour affiner' },
    de: { removeImported: 'Importierte Unterhaltungen entfernen ({count})', removeImportedConfirm: 'Zum Entfernen von {count} erneut klicken', nav: 'Import', title: 'Unterhaltungen aus anderen Tools importieren', lead: 'Übernehmen Sie Unterhaltungen aus Claude Code, Claude Cowork, Codex und Cursor in NextMux. Deren Dateien werden nur gelesen, nie geändert. Importierte Unterhaltungen erscheinen links unter ihrem Projekt.',
        rescan: 'Erneut suchen', scanning: 'Suche…', scannedAt: 'Letzte Suche: {time}', notFound: 'Am üblichen Ort nicht gefunden', noAccess: 'Keine Leseberechtigung', noAccessHint: 'Erlauben Sie NextMux unter Systemeinstellungen → Datenschutz & Sicherheit → Festplattenvollzugriff und suchen Sie erneut.', addFolder: 'Weiteren Ort hinzufügen…', removeFolder: 'Hier nicht mehr suchen', removeFolderHint: 'NextMux sucht in diesem Ordner nicht mehr nach Unterhaltungen. Es werden keine Dateien und keine importierten Unterhaltungen gelöscht.', customTag: 'Von Ihnen hinzugefügt',
        counts: '{importable} importierbar · {imported} importiert', nothing: 'Keine Unterhaltungen gefunden', importAll: 'Alle importieren ({count})', importSelected: 'Auswahl importieren ({count})', choose: 'Unterhaltungen auswählen…', hideList: 'Liste ausblenden', importing: 'Import läuft…',
        done: '{imported} importiert, {updated} aktualisiert', failedCount: '{count} nicht importiert', undo: 'Diesen Import rückgängig machen', undone: 'Rückgängig: {count} Unterhaltungen entfernt',
        'status.new': 'Neu', 'status.updated': 'Aktualisiert', 'status.deleted': 'Gelöscht, erneut importierbar', 'status.imported': 'Importiert', noProject: 'Kein Projekt', selectAll: 'Alle auswählen', historyOff: 'Aktivieren Sie zuerst „Verlauf speichern“ unter Datenschutz.', error: 'Fehler: {error}', searchPlaceholder: 'Titel oder Projekt suchen', more: '{count} weitere — zum Eingrenzen suchen' },
    'pt-BR': { removeImported: 'Remover conversas importadas ({count})', removeImportedConfirm: 'Clique de novo para remover {count}', nav: 'Importar', title: 'Importar conversas de outras ferramentas', lead: 'Traga para o NextMux as conversas do Claude Code, Claude Cowork, Codex e Cursor. Os arquivos são apenas lidos, nunca alterados. Elas aparecem no projeto correspondente à esquerda.',
        rescan: 'Procurar de novo', scanning: 'Procurando…', scannedAt: 'Última busca: {time}', notFound: 'Não encontrado no local padrão', noAccess: 'Sem permissão de leitura', noAccessHint: 'Permita o NextMux em Ajustes do Sistema → Privacidade e Segurança → Acesso Total ao Disco e procure de novo.', addFolder: 'Adicionar outro local…', removeFolder: 'Parar de procurar aqui', removeFolderHint: 'O NextMux deixa de procurar conversas nesta pasta. Nenhum arquivo nem conversa importada é apagado.', customTag: 'Adicionado por você',
        counts: '{importable} para importar · {imported} importadas', nothing: 'Nenhuma conversa encontrada', importAll: 'Importar tudo ({count})', importSelected: 'Importar selecionadas ({count})', choose: 'Escolher conversas…', hideList: 'Ocultar lista', importing: 'Importando…',
        done: '{imported} importadas, {updated} atualizadas', failedCount: '{count} não importadas', undo: 'Desfazer esta importação', undone: 'Desfeito: {count} conversas removidas',
        'status.new': 'Nova', 'status.updated': 'Atualizada', 'status.deleted': 'Excluída, pode reimportar', 'status.imported': 'Importada', noProject: 'Sem projeto', selectAll: 'Selecionar tudo', historyOff: 'Ative antes “Salvar histórico de conversas” em Privacidade.', error: 'Algo deu errado: {error}', searchPlaceholder: 'Buscar títulos ou projetos', more: 'Mais {count} — busque para filtrar' },
    ru: { removeImported: 'Удалить импортированные беседы ({count})', removeImportedConfirm: 'Нажмите ещё раз, чтобы удалить {count}', nav: 'Импорт', title: 'Импорт бесед из других инструментов', lead: 'Перенесите в NextMux беседы из Claude Code, Claude Cowork, Codex и Cursor. Их файлы только читаются и не изменяются. Беседы появятся слева в своих проектах.',
        rescan: 'Искать снова', scanning: 'Поиск…', scannedAt: 'Последний поиск: {time}', notFound: 'Не найдено в обычном месте', noAccess: 'Нет прав на чтение', noAccessHint: 'Разрешите NextMux в Системных настройках → Конфиденциальность и безопасность → Полный доступ к диску и повторите поиск.', addFolder: 'Добавить другое место…', removeFolder: 'Не искать здесь', removeFolderHint: 'NextMux перестанет искать беседы в этой папке. Файлы и импортированные беседы не удаляются.', customTag: 'Добавлено вами',
        counts: 'Можно импортировать: {importable} · импортировано: {imported}', nothing: 'Беседы не найдены', importAll: 'Импортировать всё ({count})', importSelected: 'Импортировать выбранное ({count})', choose: 'Выбрать беседы…', hideList: 'Скрыть список', importing: 'Импорт…',
        done: 'Импортировано {imported}, обновлено {updated}', failedCount: 'Не импортировано: {count}', undo: 'Отменить этот импорт', undone: 'Отменено: удалено бесед — {count}',
        'status.new': 'Новая', 'status.updated': 'Обновлена', 'status.deleted': 'Удалена, можно импортировать снова', 'status.imported': 'Импортирована', noProject: 'Без проекта', selectAll: 'Выбрать все', historyOff: 'Сначала включите «Сохранять историю бесед» в разделе «Конфиденциальность».', error: 'Ошибка: {error}', searchPlaceholder: 'Поиск по названию или проекту', more: 'Ещё {count} — уточните поиском' },
    ar: { removeImported: 'إزالة المحادثات المستوردة ({count})', removeImportedConfirm: 'انقر مجددًا لإزالة {count}', nav: 'استيراد', title: 'استيراد المحادثات من أدوات أخرى', lead: 'انقل محادثات Claude Code وClaude Cowork وCodex وCursor إلى NextMux. تُقرأ ملفاتها فقط ولا تُعدَّل. تظهر المحادثات المستوردة تحت مشروعها في اليسار.',
        rescan: 'البحث مجددًا', scanning: 'جارٍ البحث…', scannedAt: 'آخر بحث: {time}', notFound: 'غير موجود في المكان المعتاد', noAccess: 'لا يوجد إذن قراءة', noAccessHint: 'اسمح لـ NextMux من إعدادات النظام ← الخصوصية والأمن ← الوصول الكامل إلى القرص ثم ابحث مجددًا.', addFolder: 'إضافة موقع آخر…', removeFolder: 'التوقف عن البحث هنا', removeFolderHint: 'يتوقف NextMux عن البحث عن المحادثات في هذا المجلد. لا تُحذف أي ملفات ولا محادثات مستوردة.', customTag: 'أضفته أنت',
        counts: '{importable} للاستيراد · {imported} مستوردة', nothing: 'لم يُعثر على محادثات', importAll: 'استيراد الكل ({count})', importSelected: 'استيراد المحدد ({count})', choose: 'اختيار المحادثات…', hideList: 'إخفاء القائمة', importing: 'جارٍ الاستيراد…',
        done: 'تم استيراد {imported} وتحديث {updated}', failedCount: 'لم يُستورد {count}', undo: 'التراجع عن هذا الاستيراد', undone: 'تم التراجع: أُزيلت {count} محادثة',
        'status.new': 'جديدة', 'status.updated': 'محدَّثة', 'status.deleted': 'محذوفة، يمكن استيرادها مجددًا', 'status.imported': 'مستوردة', noProject: 'بلا مشروع', selectAll: 'تحديد الكل', historyOff: 'فعّل أولًا «حفظ سجل المحادثات» في الخصوصية.', error: 'حدث خطأ: {error}', searchPlaceholder: 'ابحث في العناوين أو المشاريع', more: '{count} أخرى — ابحث للتضييق' },
    hi: { removeImported: 'इम्पोर्ट की गई बातचीत हटाएँ ({count})', removeImportedConfirm: '{count} हटाने के लिए फिर क्लिक करें', nav: 'इम्पोर्ट', title: 'दूसरे टूल की बातचीत इम्पोर्ट करें', lead: 'Claude Code, Claude Cowork, Codex और Cursor की बातचीत NextMux में लाएँ। उनकी फ़ाइलें सिर्फ़ पढ़ी जाती हैं, बदली नहीं जातीं। इम्पोर्ट की गई बातचीत बाईं ओर अपने प्रोजेक्ट में दिखेगी।',
        rescan: 'फिर खोजें', scanning: 'खोज रहा है…', scannedAt: 'पिछली खोज: {time}', notFound: 'सामान्य जगह पर नहीं मिला', noAccess: 'पढ़ने की अनुमति नहीं', noAccessHint: 'System Settings → Privacy & Security → Full Disk Access में NextMux को अनुमति दें, फिर खोजें।', addFolder: 'दूसरी जगह जोड़ें…', removeFolder: 'यहाँ खोजना बंद करें', removeFolderHint: 'NextMux इस फ़ोल्डर में बातचीत खोजना बंद कर देगा। कोई फ़ाइल या इम्पोर्ट की गई बातचीत नहीं हटेगी।', customTag: 'आपने जोड़ा',
        counts: '{importable} इम्पोर्ट योग्य · {imported} इम्पोर्ट हो चुकी', nothing: 'कोई बातचीत नहीं मिली', importAll: 'सब इम्पोर्ट करें ({count})', importSelected: 'चुनी हुई इम्पोर्ट करें ({count})', choose: 'बातचीत चुनें…', hideList: 'सूची छिपाएँ', importing: 'इम्पोर्ट हो रहा है…',
        done: '{imported} इम्पोर्ट, {updated} अपडेट', failedCount: '{count} इम्पोर्ट नहीं हुईं', undo: 'यह इम्पोर्ट पूर्ववत करें', undone: 'पूर्ववत: {count} बातचीत हटाई गईं',
        'status.new': 'नई', 'status.updated': 'अपडेट हुई', 'status.deleted': 'हटाई गई, फिर इम्पोर्ट कर सकते हैं', 'status.imported': 'इम्पोर्ट हो चुकी', noProject: 'कोई प्रोजेक्ट नहीं', selectAll: 'सब चुनें', historyOff: 'पहले Privacy में “बातचीत इतिहास सहेजें” चालू करें।', error: 'गड़बड़ी: {error}', searchPlaceholder: 'शीर्षक या प्रोजेक्ट खोजें', more: '{count} और — खोजकर सीमित करें' }
};

function uncheckedImportText(locale: NextMuxDesktopLocale, key: Key, values: Readonly<Record<string, string | number>> = {}): string {
    return (catalog[locale] || catalog.en)[key].replace(/\{(\w+)\}/g, (match, name: string) => values[name] === undefined ? match : String(values[name]));
}

const SOURCE_NAMES: Readonly<Record<ConversationImportSource, string>> = { 'claude-code': 'Claude Code', 'claude-cowork': 'Claude Cowork', codex: 'Codex', cursor: 'Cursor' };
const SOURCE_MARKS: Readonly<Record<ConversationImportSource, string>> = { 'claude-code': 'CC', 'claude-cowork': 'CW', codex: 'CX', cursor: 'CU' };
const LIST_LIMIT = 200;

export interface ConversationImportPanelProps {
    readonly locale: NextMuxDesktopLocale;
    readonly scan: ConversationImportScan | undefined;
    readonly scanning: boolean;
    readonly historyEnabled: boolean;
    readonly onRescan: () => void;
    readonly onImport: (source: ConversationImportSource, externalIds?: readonly string[]) => Promise<ConversationImportResult>;
    readonly deletionBlocked?: (sessionIds: readonly string[]) => boolean;
    readonly onUndo: (sessionIds: readonly string[], undoBatch?: boolean) => Promise<number>;
    /** The last import per source, kept by the host so "Undo" survives leaving this page. */
    readonly results: Partial<Record<ConversationImportSource, ConversationImportResult>>;
    readonly onResult: (source: ConversationImportSource, result: ConversationImportResult | undefined) => void;
    readonly onAddFolder: (source: ConversationImportSource) => void;
    readonly onRemoveFolder: (source: ConversationImportSource, path: string) => void;
}

function SourceCard(props: ConversationImportPanelProps & { readonly summary: ConversationImportSourceSummary }): React.ReactElement {
    const { locale, summary } = props;
    const t = (key: Key, values?: Readonly<Record<string, string | number>>): string => importText(locale, key, values);
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
    const [busy, setBusy] = React.useState(false);
    const result = props.results[summary.source];
    const setResult = (next: ConversationImportResult | undefined): void => props.onResult(summary.source, next);
    const [removeArmed, setRemoveArmed] = React.useState(false);
    const importedIds = summary.candidates.filter(item => item.status === 'imported' || item.status === 'updated').map(item => item.sessionId);
    const removeBlocked = props.deletionBlocked?.(importedIds) || false;
    const undoBlocked = Boolean(result && props.deletionBlocked?.(result.sessionIds));
    const blockedHint = conversationText(locale, 'stopBeforeDelete');
    const [message, setMessage] = React.useState('');
    const [error, setError] = React.useState<unknown>();
    const importable = summary.candidates.filter(item => item.status !== 'imported');
    const needle = query.trim().toLocaleLowerCase();
    const visible = (needle ? summary.candidates.filter(item => item.title.toLocaleLowerCase().includes(needle) || item.workspacePath.toLocaleLowerCase().includes(needle)) : summary.candidates);
    const blocked = summary.roots.some(root => root.found && !root.readable);
    const found = summary.roots.some(root => root.found);
    const run = async (ids?: readonly string[]): Promise<void> => {
        setBusy(true); setError(undefined); setMessage('');
        try {
            const outcome = await props.onImport(summary.source, ids);
            setResult(outcome);
            setSelected(new Set());
        } catch (cause) { setError(cause); }
        finally { setBusy(false); }
    };
    const undo = async (): Promise<void> => {
        if (!result || props.deletionBlocked?.(result.sessionIds)) return;
        setBusy(true); setError(undefined);
        try { const removed = await props.onUndo(result.sessionIds, true); setMessage(t('undone', { count: removed })); setResult(undefined); }
        catch (cause) { setError(cause); }
        finally { setBusy(false); }
    };
    const removeImported = async (): Promise<void> => {
        if (props.deletionBlocked?.(importedIds)) return;
        if (!removeArmed) { setRemoveArmed(true); return; }
        setRemoveArmed(false); setBusy(true); setError(undefined);
        try { const removed = await props.onUndo(importedIds); setMessage(t('undone', { count: removed })); setResult(undefined); }
        catch (cause) { setError(cause); }
        finally { setBusy(false); }
    };
    const toggle = (id: string): void => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    const failure = error === undefined ? undefined : conversationErrorPresentation(locale, error, 'import_failed');
    const scanFailure = summary.error || summary.domainError ? conversationErrorPresentation(locale, summary.domainError ? { domainError: summary.domainError } : summary.error, 'import_scan_failed') : undefined;
    const statusLabel = (item: ConversationImportCandidate): string => t(`status.${item.status}` as Key);
    return <article className={`nmx-import-source ${summary.importable ? 'has-items' : ''}`}>
        <header>
            <span className={`nmx-import-mark is-${summary.source}`} aria-hidden='true'>{SOURCE_MARKS[summary.source]}</span>
            <div>
                <strong>{SOURCE_NAMES[summary.source]}</strong>
                <small>{scanFailure ? scanFailure.summary : summary.total ? t('counts', { importable: summary.importable, imported: summary.imported }) : blocked ? t('noAccess') : found ? t('nothing') : t('notFound')}</small>
            </div>
            <div className='nmx-import-actions'>
                {summary.importable > 0 && <button type='button' className='nmx-primary-button' disabled={busy || props.scanning || !props.historyEnabled} onClick={() => void run()}>
                    {busy ? t('importing') : t('importAll', { count: summary.importable })}</button>}
                {summary.total > 0 && <button type='button' className='nmx-secondary-button' aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)}>{open ? t('hideList') : t('choose')}</button>}
            </div>
        </header>
        <ul className='nmx-import-roots'>
            {summary.roots.map(root => <li key={root.path} className={root.found ? root.readable ? 'is-found' : 'is-blocked' : 'is-missing'}>
                <i className={`codicon codicon-${root.found ? root.readable ? 'folder' : 'lock' : 'circle-slash'}`} aria-hidden='true'></i>
                <span data-nmx-literal title={root.path}>{root.path}</span>
                {root.custom && <em className='nmx-import-custom-tag'>{t('customTag')}</em>}
                {root.custom && <button type='button' className='nmx-link-button' title={t('removeFolderHint')} onClick={() => props.onRemoveFolder(summary.source, root.path)}>{t('removeFolder')}</button>}
            </li>)}
            <li><button type='button' className='nmx-link-button' onClick={() => props.onAddFolder(summary.source)}><i className='codicon codicon-add' aria-hidden='true'></i>{t('addFolder')}</button></li>
        </ul>
        {blocked && <p className='nmx-import-hint'>{t('noAccessHint')}</p>}
        {importedIds.length > 0 && !result && <div className='nmx-import-manage'>
            <button type='button' className={`nmx-link-button ${removeArmed ? 'is-danger' : ''}${removeBlocked ? ' is-blocked' : ''}`} aria-disabled={removeBlocked || undefined} title={removeBlocked ? blockedHint : undefined} data-nmx-tip={removeBlocked ? blockedHint : undefined} disabled={busy} onBlur={() => setRemoveArmed(false)}
                onClick={() => void removeImported()}>{removeArmed ? t('removeImportedConfirm', { count: importedIds.length }) : t('removeImported', { count: importedIds.length })}</button>
        </div>}
        {!props.historyEnabled && summary.importable > 0 && <p className='nmx-import-hint'>{t('historyOff')}</p>}
        {failure && <div className='nmx-agent-inline-error' role='alert'>{failure.summary}{failure.details && <details><summary>{conversationDetailsLabel(locale)}</summary><pre data-nmx-literal>{failure.details}</pre></details>}</div>}
        {scanFailure?.details && <details><summary>{conversationDetailsLabel(locale)}</summary><pre data-nmx-literal>{scanFailure.details}</pre></details>}
        {message && <p className='nmx-import-result' role='status'>{message}</p>}
        {result && <div className='nmx-import-result' role='status'>
            <span>{t('done', { imported: result.imported, updated: result.updated })}{result.failed.length ? ` · ${t('failedCount', { count: result.failed.length })}` : ''}</span>
            {result.sessionIds.length > 0 && <button type='button' className={`nmx-link-button${undoBlocked ? ' is-blocked' : ''}`} aria-disabled={undoBlocked || undefined} title={undoBlocked ? blockedHint : undefined} data-nmx-tip={undoBlocked ? blockedHint : undefined} disabled={busy} onClick={() => void undo()}>{t('undo')}</button>}
            {result.failed.length > 0 && <details><summary>{t('failedCount', { count: result.failed.length })}</summary>
                <ul>{result.failed.slice(0, 100).map(item => <li key={item.externalId}><span data-nmx-literal>{item.title}</span> — <small>{conversationErrorPresentation(locale, item.domainError ? { domainError: item.domainError } : item.reason, 'import_failed').summary}</small><details><summary>{conversationDetailsLabel(locale)}</summary><pre data-nmx-literal>{conversationErrorPresentation(locale, item.domainError ? { domainError: item.domainError } : item.reason, 'import_failed').details}</pre></details></li>)}</ul></details>}
        </div>}
        {open && <div className='nmx-import-list'>
            <div className='nmx-import-list-tools'>
                <input type='search' value={query} placeholder={t('searchPlaceholder')} onChange={event => setQuery(event.currentTarget.value)} />
                <label><input type='checkbox' checked={importable.length > 0 && importable.every(item => selected.has(item.externalId))}
                    onChange={event => setSelected(event.currentTarget.checked ? new Set(importable.map(item => item.externalId)) : new Set())} />{t('selectAll')}</label>
                <button type='button' className='nmx-primary-button' disabled={busy || !selected.size || !props.historyEnabled} onClick={() => void run([...selected])}>{t('importSelected', { count: selected.size })}</button>
            </div>
            <ul>{visible.slice(0, LIST_LIMIT).map(item => <li key={item.externalId} className={`is-${item.status}`}>
                <label>
                    <input type='checkbox' disabled={item.status === 'imported'} checked={selected.has(item.externalId)} onChange={() => toggle(item.externalId)} />
                    <span><strong data-nmx-literal title={item.title}>{item.title}</strong>
                        <small><span data-nmx-literal title={item.workspacePath}>{item.workspacePath ? item.workspacePath.split(/[\\/]/).filter(Boolean).at(-1) : t('noProject')}</span> · {new Date(item.updatedAt).toLocaleDateString(locale)}</small></span>
                    <em>{statusLabel(item)}</em>
                </label>
            </li>)}</ul>
            {visible.length > LIST_LIMIT && <p className='nmx-import-hint'>{t('more', { count: visible.length - LIST_LIMIT })}</p>}
        </div>}
    </article>;
}

export function ConversationImportPanel(props: ConversationImportPanelProps): React.ReactElement {
    const t = (key: Key, values?: Readonly<Record<string, string | number>>): string => importText(props.locale, key, values);
    return <section className='nmx-settings-panel nmx-import-panel'>
        <header className='nmx-import-header'>
            <div><h3>{t('title')}</h3><p>{t('lead')}</p></div>
            <div><button type='button' className='nmx-secondary-button' disabled={props.scanning} onClick={props.onRescan}>
                <i className={`codicon codicon-${props.scanning ? 'loading codicon-modifier-spin' : 'refresh'}`} aria-hidden='true'></i>{props.scanning ? t('scanning') : t('rescan')}</button>
                {props.scan && <small>{t('scannedAt', { time: new Date(props.scan.scannedAt).toLocaleString(props.locale) })}</small>}</div>
        </header>
        {!props.scan ? <p className='nmx-import-hint'>{t('scanning')}</p>
            : props.scan.sources.map(summary => <SourceCard key={summary.source} {...props} summary={summary} />)}
    </section>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function importText(locale: Parameters<typeof uncheckedImportText>[0], key: Parameters<typeof uncheckedImportText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedImportText>>): string {
    return totalCopy(locale, key, language => uncheckedImportText(language, key, ...rest));
}
