import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

/** 我的 API: every connection the user added on this computer, managed in one dialog (add, edit, test, delete). */
const en = {
    title: 'My APIs', lead: 'API connections saved on this computer. Keys stay in {store}; prompts do not pass through NextMux.',
    count: '{count} connections', add: 'Add API', local: 'Ollama (this computer)', official: 'Official providers',
    empty: 'No APIs yet', emptyBody: 'Click Add API to connect any official provider, OpenAI-compatible API or relay, a generation API (video, image, music), or Ollama.',
    test: 'Test speed', testing: 'Testing…', edit: 'Edit', remove: 'Delete', removing: 'Deleting…', confirmRemove: 'Delete this connection and its saved API key?',
    confirm: 'Delete', cancel: 'Cancel', close: 'Close',
    verified: 'Tool calls verified', reachable: 'Reachable · tool calls not verified', unverified: 'Not tested yet', latency: '{ms} ms',
    storeMac: 'the macOS Keychain', storeWindows: 'Windows Credential Manager', storeOther: 'the system keyring',
    storeMacShort: 'macOS Keychain', storeWindowsShort: 'Windows Credential Manager', storeOtherShort: 'System keyring',
    compatibleTitle: 'Compatible API', ownApi: 'My API', mediaTitle: 'Generation API', ready: 'Connection verified', connectionFailed: "Unable to connect to the model service.", chatProtocol: "Provider / chat protocol", models: 'Models', refresh: 'Refresh models', refreshing: 'Refreshing…',
    remarkLabel: 'Remark / API name', remarkHint: 'Shown in My APIs and provider picker (optional)', remarkPlaceholder: 'e.g. Primary Relay / Team API',
        endpointPreview: 'Requests go to', endpointPinned: 'The # at the end keeps the API root as typed'
} as const;
type Key = keyof typeof en;
const translations: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<Key, string>>>> = {
    en,
    'zh-CN': {
        title: '我的 API', lead: '你的密钥只存放在本地，对话不经过 NextMux 平台。',
        count: '{count} 个连接', add: '添加 API', local: 'Ollama（本机）', official: '官方提供商',
        empty: '还没有添加 API', emptyBody: '点击右上角“添加 API”，可自由选择 OpenAI、Anthropic、Gemini、DeepSeek 等官方提供商、任意 OpenAI 兼容接口或中转商、生成类接口（视频、图片、音乐）或 Ollama。',
        test: '测速', testing: '测速中…', edit: '编辑', remove: '删除', removing: '删除中…', confirmRemove: '删除这个连接以及保存的 API Key？',
        confirm: '删除', cancel: '取消', close: '关闭',
        verified: '工具调用已验证', reachable: '可连接 · 工具调用未通过', unverified: '尚未检测', latency: '{ms} ms',
        storeMac: '系统钥匙串', storeWindows: 'Windows 凭据管理器', storeOther: '系统密钥环',
        storeMacShort: '系统钥匙串', storeWindowsShort: 'Windows 凭据管理器', storeOtherShort: '系统密钥环',
        compatibleTitle: '兼容 API', ownApi: '自有 API', mediaTitle: '生成接口', ready: '连接已验证', connectionFailed: "无法连接模型服务。", chatProtocol: "提供商 / 对话接口协议", models: '模型列表', refresh: '刷新模型', refreshing: '刷新中…',
        remarkLabel: '备注名称 / API 名称', remarkHint: '显示在“我的 API”与“选择中转商”（可选）', remarkPlaceholder: '例如：主力中转 / 公司 API',
        endpointPreview: '实际请求地址', endpointPinned: '末尾的 # 让接口根地址保持原样'
    },
    'zh-TW': {
        title: '我的 API', lead: '你的金鑰只存放在本機，對話不經過 NextMux 平台。',
        count: '{count} 個連線', add: '新增 API', local: 'Ollama（本機）', official: '官方供應商',
        empty: '還沒有新增 API', emptyBody: '點擊右上角「新增 API」，可自由選擇官方供應商、OpenAI 相容介面或中轉商、生成類介面（影片、圖片、音樂）或 Ollama。',
        test: '測速', testing: '測速中…', edit: '編輯', remove: '刪除', removing: '刪除中…', confirmRemove: '刪除這個連線以及儲存的 API Key？',
        confirm: '刪除', cancel: '取消', close: '關閉',
        verified: '工具呼叫已驗證', reachable: '可連線 · 工具呼叫未通過', unverified: '尚未檢測', latency: '{ms} ms',
        storeMac: '系統鑰匙圈', storeWindows: 'Windows 認證管理員', storeOther: '系統金鑰環',
        storeMacShort: '系統鑰匙圈', storeWindowsShort: 'Windows 認證管理員', storeOtherShort: '系統金鑰環',
        compatibleTitle: '相容 API', ownApi: '自有 API', mediaTitle: '生成介面', ready: '連線已驗證', connectionFailed: "無法連線至模型服務。", chatProtocol: "供應商 / 對話介面協定", models: '模型清單', refresh: '重新整理模型', refreshing: '重新整理中…',
        remarkLabel: '備註名稱 / API 名稱', remarkHint: '顯示在「我的 API」與「選擇中轉商」（選填）', remarkPlaceholder: '例如：主力中轉 / 公司 API',
        endpointPreview: '實際請求位址', endpointPinned: '結尾的 # 讓介面根位址保持原樣'
    },
    ja: {
        title: 'マイ API', lead: 'このコンピューターに保存された API 接続です。キーは{store}にのみ保存され、プロンプトは NextMux を経由しません。',
        count: '{count} 件の接続', add: 'API を追加', local: 'Ollama（このコンピューター）', official: '公式プロバイダー',
        empty: 'まだ API がありません', emptyBody: 'OpenAI 互換 API や中継サービス、生成系 API（動画・画像・音楽）、Ollama を追加できます。公式プロバイダーは「直接接続 API」から接続できます。',
        test: '速度テスト', testing: 'テスト中…', edit: '編集', remove: '削除', removing: '削除中…', confirmRemove: 'この接続と保存済みの API キーを削除しますか？',
        confirm: '削除', cancel: 'キャンセル', close: '閉じる',
        verified: 'ツール呼び出し確認済み', reachable: '接続可能 · ツール呼び出し未確認', unverified: '未テスト', latency: '{ms} ms',
        storeMac: 'macOS のキーチェーン', storeWindows: 'Windows 資格情報マネージャー', storeOther: 'システムのキーリング',
        storeMacShort: 'キーチェーン', storeWindowsShort: 'Windows 資格情報マネージャー', storeOtherShort: 'システムのキーリング',
        compatibleTitle: '互換 API', ownApi: 'マイ API', mediaTitle: '生成 API', ready: '接続確認済み', connectionFailed: "モデルサービスに接続できません。", chatProtocol: "プロバイダー / チャットプロトコル", models: 'モデル一覧', refresh: 'モデルを更新', refreshing: '更新中…',
        remarkLabel: '備考名 / API 名', remarkHint: '「マイ API」と中継選択に表示（任意）', remarkPlaceholder: '例：メイン中継 / 社内 API',
        endpointPreview: '実際のリクエスト先', endpointPinned: '末尾の # で API ルートを入力どおりに固定しています'
    },
    ko: {
        title: '내 API', lead: '이 컴퓨터에 저장된 API 연결입니다. 키는 {store}에만 저장되며 프롬프트는 NextMux를 거치지 않습니다.',
        count: '연결 {count}개', add: 'API 추가', local: 'Ollama(이 컴퓨터)', official: '공식 제공업체',
        empty: '아직 API가 없습니다', emptyBody: 'OpenAI 호환 API나 중계 서비스, 생성 API(동영상·이미지·음악) 또는 Ollama를 추가할 수 있습니다. 공식 제공업체는 “직접 연결 API”에서 연결하세요.',
        test: '속도 테스트', testing: '테스트 중…', edit: '편집', remove: '삭제', removing: '삭제 중…', confirmRemove: '이 연결과 저장된 API 키를 삭제할까요?',
        confirm: '삭제', cancel: '취소', close: '닫기',
        verified: '도구 호출 확인됨', reachable: '연결 가능 · 도구 호출 미확인', unverified: '아직 테스트하지 않음', latency: '{ms} ms',
        storeMac: 'macOS 키체인', storeWindows: 'Windows 자격 증명 관리자', storeOther: '시스템 키링',
        storeMacShort: '키체인', storeWindowsShort: 'Windows 자격 증명 관리자', storeOtherShort: '시스템 키링',
        compatibleTitle: '호환 API', ownApi: '내 API', mediaTitle: '생성 API', ready: '연결 확인됨', connectionFailed: "모델 서비스에 연결할 수 없습니다.", chatProtocol: "제공업체 / 채팅 프로토콜", models: '모델 목록', refresh: '모델 새로 고침', refreshing: '새로 고치는 중…',
        remarkLabel: '비고 이름 / API 이름', remarkHint: '‘내 API’ 및 중계 선택에 표시(선택)', remarkPlaceholder: '예: 주력 중계 / 사내 API',
        endpointPreview: '실제 요청 주소', endpointPinned: '끝의 #으로 API 루트를 입력한 그대로 둡니다'
    },
    es: {
        title: 'Mis API', lead: 'Conexiones de API guardadas en este equipo. Las claves solo se guardan en {store}; los prompts no pasan por NextMux.',
        count: '{count} conexiones', add: 'Añadir API', local: 'Ollama (este equipo)', official: 'Proveedores oficiales',
        empty: 'Aún no hay API', emptyBody: 'Añade cualquier API compatible con OpenAI o un intermediario, una API de generación (vídeo, imagen, música) u Ollama. Los proveedores oficiales se conectan desde API directa.',
        test: 'Probar velocidad', testing: 'Probando…', edit: 'Editar', remove: 'Eliminar', removing: 'Eliminando…', confirmRemove: '¿Eliminar esta conexión y su clave de API guardada?',
        confirm: 'Eliminar', cancel: 'Cancelar', close: 'Cerrar',
        verified: 'Llamadas a herramientas verificadas', reachable: 'Accesible · herramientas sin verificar', unverified: 'Sin probar', latency: '{ms} ms',
        storeMac: 'el llavero de macOS', storeWindows: 'el Administrador de credenciales de Windows', storeOther: 'el llavero del sistema',
        storeMacShort: 'Llavero de macOS', storeWindowsShort: 'Administrador de credenciales de Windows', storeOtherShort: 'Llavero del sistema',
        compatibleTitle: 'API compatible', ownApi: 'Mi API', mediaTitle: 'API de generación', ready: 'Conexión verificada', connectionFailed: "No se puede conectar al servicio de modelos.", chatProtocol: "Proveedor / protocolo de chat", models: 'Modelos', refresh: 'Actualizar modelos', refreshing: 'Actualizando…',
        remarkLabel: 'Nombre / nota de la API', remarkHint: 'Se muestra en Mis API y en el selector (opcional)', remarkPlaceholder: 'p. ej., Relé principal / API del equipo',
        endpointPreview: 'Las solicitudes van a', endpointPinned: 'La # final mantiene la raíz de la API tal como la escribiste'
    },
    fr: {
        title: 'Mes API', lead: 'Connexions API enregistrées sur cet ordinateur. Les clés restent dans {store} ; les prompts ne passent pas par NextMux.',
        count: '{count} connexions', add: 'Ajouter une API', local: 'Ollama (cet ordinateur)', official: 'Fournisseurs officiels',
        empty: 'Aucune API pour l’instant', emptyBody: 'Ajoutez une API compatible OpenAI ou un relais, une API de génération (vidéo, image, musique) ou Ollama. Les fournisseurs officiels se connectent depuis API directe.',
        test: 'Tester la vitesse', testing: 'Test…', edit: 'Modifier', remove: 'Supprimer', removing: 'Suppression…', confirmRemove: 'Supprimer cette connexion et sa clé API enregistrée ?',
        confirm: 'Supprimer', cancel: 'Annuler', close: 'Fermer',
        verified: 'Appels d’outils vérifiés', reachable: 'Accessible · outils non vérifiés', unverified: 'Pas encore testée', latency: '{ms} ms',
        storeMac: 'le trousseau macOS', storeWindows: 'le Gestionnaire d’identification Windows', storeOther: 'le trousseau du système',
        storeMacShort: 'Trousseau macOS', storeWindowsShort: 'Gestionnaire d’identification Windows', storeOtherShort: 'Trousseau du système',
        compatibleTitle: 'API compatible', ownApi: 'Mon API', mediaTitle: 'API de génération', ready: 'Connexion vérifiée', connectionFailed: "Impossible de se connecter au service de modèles.", chatProtocol: "Fournisseur / protocole de discussion", models: 'Modèles', refresh: 'Actualiser les modèles', refreshing: 'Actualisation…',
        remarkLabel: 'Nom / remarque de l’API', remarkHint: 'Affiché dans Mes API et le sélecteur (facultatif)', remarkPlaceholder: 'p. ex. Relais principal / API d’équipe',
        endpointPreview: 'Les requêtes vont vers', endpointPinned: 'Le # final garde la racine de l’API telle que saisie'
    },
    de: {
        title: 'Meine APIs', lead: 'Auf diesem Computer gespeicherte API-Verbindungen. Schlüssel liegen nur in {store}; Prompts laufen nicht über NextMux.',
        count: '{count} Verbindungen', add: 'API hinzufügen', local: 'Ollama (dieser Computer)', official: 'Offizielle Anbieter',
        empty: 'Noch keine APIs', emptyBody: 'Fügen Sie eine OpenAI-kompatible API oder einen Relay-Dienst, eine Generierungs-API (Video, Bild, Musik) oder Ollama hinzu. Offizielle Anbieter verbinden Sie unter „Direkte API“.',
        test: 'Geschwindigkeit testen', testing: 'Wird getestet…', edit: 'Bearbeiten', remove: 'Löschen', removing: 'Wird gelöscht…', confirmRemove: 'Diese Verbindung und ihren gespeicherten API-Schlüssel löschen?',
        confirm: 'Löschen', cancel: 'Abbrechen', close: 'Schließen',
        verified: 'Tool-Aufrufe bestätigt', reachable: 'Erreichbar · Tool-Aufrufe nicht bestätigt', unverified: 'Noch nicht getestet', latency: '{ms} ms',
        storeMac: 'dem macOS-Schlüsselbund', storeWindows: 'der Windows-Anmeldeinformationsverwaltung', storeOther: 'dem Systemschlüsselbund',
        storeMacShort: 'macOS-Schlüsselbund', storeWindowsShort: 'Windows-Anmeldeinformationsverwaltung', storeOtherShort: 'Systemschlüsselbund',
        compatibleTitle: 'Kompatible API', ownApi: 'Meine API', mediaTitle: 'Generierungs-API', ready: 'Verbindung bestätigt', connectionFailed: "Verbindung zum Modelldienst nicht möglich.", chatProtocol: "Anbieter / Chatprotokoll", models: 'Modelle', refresh: 'Modelle aktualisieren', refreshing: 'Wird aktualisiert…',
        remarkLabel: 'Bemerkungsname / API-Name', remarkHint: 'Wird in „Meine APIs“ und der Auswahl angezeigt (optional)', remarkPlaceholder: 'z. B. Haupt-Relay / Team-API',
        endpointPreview: 'Anfragen gehen an', endpointPinned: 'Das # am Ende lässt den API-Stamm so, wie er eingegeben wurde'
    },
    'pt-BR': {
        title: 'Minhas APIs', lead: 'Conexões de API salvas neste computador. As chaves ficam apenas {store}; os prompts não passam pela NextMux.',
        count: '{count} conexões', add: 'Adicionar API', local: 'Ollama (este computador)', official: 'Provedores oficiais',
        empty: 'Nenhuma API ainda', emptyBody: 'Adicione qualquer API compatível com OpenAI ou intermediário, uma API de geração (vídeo, imagem, música) ou Ollama. Provedores oficiais são conectados em API direta.',
        test: 'Testar velocidade', testing: 'Testando…', edit: 'Editar', remove: 'Excluir', removing: 'Excluindo…', confirmRemove: 'Excluir esta conexão e a chave de API salva?',
        confirm: 'Excluir', cancel: 'Cancelar', close: 'Fechar',
        verified: 'Chamadas de ferramentas verificadas', reachable: 'Acessível · ferramentas não verificadas', unverified: 'Ainda não testada', latency: '{ms} ms',
        storeMac: 'nas Chaves do macOS', storeWindows: 'no Gerenciador de Credenciais do Windows', storeOther: 'no chaveiro do sistema',
        storeMacShort: 'Chaves do macOS', storeWindowsShort: 'Gerenciador de Credenciais do Windows', storeOtherShort: 'Chaveiro do sistema',
        compatibleTitle: 'API compatível', ownApi: 'Minha API', mediaTitle: 'API de geração', ready: 'Conexão verificada', connectionFailed: "Não foi possível conectar ao serviço de modelos.", chatProtocol: "Provedor / protocolo de chat", models: 'Modelos', refresh: 'Atualizar modelos', refreshing: 'Atualizando…',
        remarkLabel: 'Nome / observação da API', remarkHint: 'Exibido em Minhas APIs e no seletor (opcional)', remarkPlaceholder: 'ex.: Relay principal / API da equipe',
        endpointPreview: 'As solicitações vão para', endpointPinned: 'O # no final mantém a raiz da API como foi digitada'
    },
    ru: {
        title: 'Мои API', lead: 'Подключения к API, сохранённые на этом компьютере. Ключи хранятся только в {store}; запросы не проходят через NextMux.',
        count: 'Подключений: {count}', add: 'Добавить API', local: 'Ollama (этот компьютер)', official: 'Официальные провайдеры',
        empty: 'API пока нет', emptyBody: 'Добавьте любой OpenAI-совместимый API или ретранслятор, API генерации (видео, изображения, музыка) или Ollama. Официальных провайдеров подключайте в разделе «Прямой API».',
        test: 'Проверить скорость', testing: 'Проверка…', edit: 'Изменить', remove: 'Удалить', removing: 'Удаление…', confirmRemove: 'Удалить это подключение и сохранённый ключ API?',
        confirm: 'Удалить', cancel: 'Отмена', close: 'Закрыть',
        verified: 'Вызовы инструментов подтверждены', reachable: 'Доступно · инструменты не подтверждены', unverified: 'Ещё не проверено', latency: '{ms} мс',
        storeMac: 'связке ключей macOS', storeWindows: 'диспетчере учётных данных Windows', storeOther: 'системном хранилище ключей',
        storeMacShort: 'Связка ключей macOS', storeWindowsShort: 'Диспетчер учётных данных Windows', storeOtherShort: 'Системное хранилище ключей',
        compatibleTitle: 'Совместимый API', ownApi: 'Мой API', mediaTitle: 'API генерации', ready: 'Подключение проверено', connectionFailed: "Не удалось подключиться к сервису моделей.", chatProtocol: "Провайдер / протокол чата", models: 'Модели', refresh: 'Обновить модели', refreshing: 'Обновление…',
        remarkLabel: 'Название / примечание API', remarkHint: 'Отображается в «Мои API» и выборе провайдера (необязательно)', remarkPlaceholder: 'напр., Основной ретранслятор / Командный API',
        endpointPreview: 'Запросы идут на', endpointPinned: '# в конце оставляет корень API таким, как он введён'
    },
    ar: {
        title: 'واجهات API الخاصة بي', lead: 'اتصالات API المحفوظة على هذا الكمبيوتر. تبقى المفاتيح في {store} فقط، ولا تمر الطلبات عبر NextMux.',
        count: '{count} اتصالات', add: 'إضافة API', local: 'Ollama (هذا الكمبيوتر)', official: 'المزوّدون الرسميون',
        empty: 'لا توجد واجهات API بعد', emptyBody: 'أضف أي API متوافقة مع OpenAI أو وسيطًا، أو API للتوليد (فيديو، صور، موسيقى) أو Ollama. يمكن ربط المزوّدين الرسميين من «API المباشرة».',
        test: 'اختبار السرعة', testing: 'جارٍ الاختبار…', edit: 'تعديل', remove: 'حذف', removing: 'جارٍ الحذف…', confirmRemove: 'هل تريد حذف هذا الاتصال ومفتاح API المحفوظ؟',
        confirm: 'حذف', cancel: 'إلغاء', close: 'إغلاق',
        verified: 'تم التحقق من استدعاء الأدوات', reachable: 'متاح · لم يتم التحقق من الأدوات', unverified: 'لم يُختبر بعد', latency: '{ms} مللي ثانية',
        storeMac: 'سلسلة مفاتيح macOS', storeWindows: 'مدير بيانات الاعتماد في Windows', storeOther: 'حلقة مفاتيح النظام',
        storeMacShort: 'سلسلة مفاتيح macOS', storeWindowsShort: 'مدير بيانات الاعتماد في Windows', storeOtherShort: 'حلقة مفاتيح النظام',
        compatibleTitle: 'API متوافقة', ownApi: 'API الخاصة بي', mediaTitle: 'API للتوليد', ready: 'تم التحقق من الاتصال', connectionFailed: "تعذر الاتصال بخدمة النماذج.", chatProtocol: "المزوّد / بروتوكول المحادثة", models: 'النماذج', refresh: 'تحديث النماذج', refreshing: 'جارٍ التحديث…',
        remarkLabel: 'اسم الملاحظة / واجهة API', remarkHint: 'يظهر في «واجهات API الخاصة بي» ومحدّد المزوّد (اختياري)', remarkPlaceholder: 'مثال: الوسيط الرئيسي / واجهة الفريق',
        endpointPreview: 'تُرسَل الطلبات إلى', endpointPinned: 'علامة # في النهاية تُبقي جذر الواجهة كما كُتب'
    },
    hi: {
        title: 'मेरे API', lead: 'इस कंप्यूटर पर सहेजे गए API कनेक्शन। कुंजियाँ केवल {store} में रहती हैं; प्रॉम्प्ट NextMux से होकर नहीं जाते।',
        count: '{count} कनेक्शन', add: 'API जोड़ें', local: 'Ollama (यह कंप्यूटर)', official: 'आधिकारिक प्रदाता',
        empty: 'अभी कोई API नहीं', emptyBody: 'कोई भी OpenAI-संगत API या रिले, जनरेशन API (वीडियो, चित्र, संगीत) या Ollama जोड़ें। आधिकारिक प्रदाता “डायरेक्ट API” से जोड़े जाते हैं।',
        test: 'गति जाँचें', testing: 'जाँच हो रही है…', edit: 'संपादित करें', remove: 'हटाएँ', removing: 'हटाया जा रहा है…', confirmRemove: 'यह कनेक्शन और इसकी सहेजी गई API कुंजी हटाएँ?',
        confirm: 'हटाएँ', cancel: 'रद्द करें', close: 'बंद करें',
        verified: 'टूल कॉल सत्यापित', reachable: 'पहुँच योग्य · टूल कॉल सत्यापित नहीं', unverified: 'अभी जाँचा नहीं गया', latency: '{ms} ms',
        storeMac: 'macOS कीचेन', storeWindows: 'Windows क्रेडेंशियल मैनेजर', storeOther: 'सिस्टम कीरिंग',
        storeMacShort: 'macOS कीचेन', storeWindowsShort: 'Windows क्रेडेंशियल मैनेजर', storeOtherShort: 'सिस्टम कीरिंग',
        compatibleTitle: 'संगत API', ownApi: 'मेरा API', mediaTitle: 'जनरेशन API', ready: 'कनेक्शन सत्यापित', connectionFailed: "मॉडल सेवा से कनेक्ट नहीं हो सका।", chatProtocol: "प्रदाता / चैट प्रोटोकॉल", models: 'मॉडल', refresh: 'मॉडल ताज़ा करें', refreshing: 'ताज़ा हो रहा है…',
        remarkLabel: 'टिप्पणी नाम / API नाम', remarkHint: '“मेरे API” और प्रदाता चयन में दिखता है (वैकल्पिक)', remarkPlaceholder: 'जैसे: मुख्य रिले / टीम API',
        endpointPreview: 'अनुरोध यहाँ जाते हैं', endpointPinned: 'अंत का # API रूट को लिखे अनुसार ही रखता है'
    }
};

export type MyApisTextKey = Key;
function uncheckedMyApisText(locale: NextMuxDesktopLocale, key: Key, values: Readonly<Record<string, string | number>> = {}): string {
    return (translations[locale] || en)[key].replace(/\{(\w+)\}/g, (match, name: string) => name in values ? String(values[name]) : match);
}

export type CredentialStorePlatform = 'mac' | 'windows' | 'other';
export function credentialStorePlatform(platform = typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent): CredentialStorePlatform {
    return /^mac|darwin/i.test(platform) || /Macintosh/.test(platform) ? 'mac' : /^win/i.test(platform) || /Windows/.test(platform) ? 'windows' : 'other';
}
/** Where keytar keeps API keys: the macOS Keychain or the Windows Credential Manager, named as the OS names it. */
export function credentialStoreName(locale: NextMuxDesktopLocale, platform: CredentialStorePlatform = credentialStorePlatform(), short = true): string {
    const key = platform === 'mac' ? 'storeMac' : platform === 'windows' ? 'storeWindows' : 'storeOther';
    return myApisText(locale, (short ? `${key}Short` : key) as Key);
}

export interface MyApiRow {
    readonly id: string;
    readonly name: string;
    readonly providerName: string;
    readonly host: string;
    readonly summary: string;
    readonly status: 'verified' | 'reachable' | 'ready' | 'unverified';
    /** chat: an OpenAI-compatible or official chat API; media: a generation API (video, image, music); local: Ollama. */
    readonly kind?: 'chat' | 'media' | 'local';
    readonly latencyMs?: number;
    readonly logo?: React.ReactNode;
    /** Models this API listed (0 when not read yet). */
    readonly modelCount?: number;
}

export interface MyApisDialogProps {
    readonly locale: NextMuxDesktopLocale;
    readonly platform?: CredentialStorePlatform;
    readonly rows: readonly MyApiRow[];
    /** Any connection operation in flight disables the other actions, as in the connection drawer. */
    readonly busy: boolean;
    readonly busyId?: string;
    readonly busyStage?: 'testing' | 'removing' | string;
    readonly confirmRemoveId?: string;
    readonly highlightId?: string;
    readonly message?: string;
    readonly error?: string;
    readonly onDismissError?: () => void;
    readonly onClose: () => void;
    readonly onAdd: () => void;
    readonly onAddLocal?: () => void;
    readonly onOfficial: () => void;
    readonly onEdit: (id: string) => void;
    readonly onTest: (id: string) => void;
    readonly onRemove: (id: string) => void;
    readonly onCancelRemove: () => void;
    /** The grouped model list of one connection (classified locally), shown under its row. */
    readonly renderModels?: (id: string) => React.ReactNode;
    readonly onRefreshModels?: (id: string) => void;
    readonly onOpenModels?: (id: string, trigger: HTMLElement) => void;
}

/** A toast consumes four seconds of visible, unpaused time, including its 200 ms exit. */
export class MyApisToastLifetime {
    private remaining = 4000;
    private started = 0;
    private active = false;
    private closed = false;
    private fadeTimer: number | undefined;
    private closeTimer: number | undefined;
    constructor(private readonly leaving: (value: boolean) => void, private readonly dismiss: () => void) { this.resume(); }
    private clear(): void { window.clearTimeout(this.fadeTimer); window.clearTimeout(this.closeTimer); }
    pause(): void {
        if (!this.active || this.closed) return;
        this.remaining = Math.max(0, this.remaining - (Date.now() - this.started));
        this.active = false; this.clear(); this.leaving(false);
    }
    resume(): void {
        if (this.active || this.closed) return;
        this.active = true; this.started = Date.now();
        this.fadeTimer = window.setTimeout(() => this.leaving(true), Math.max(0, this.remaining - 200));
        this.closeTimer = window.setTimeout(() => { this.closed = true; this.active = false; this.dismiss(); }, this.remaining);
    }
    close(): void {
        if (this.closed) return;
        this.closed = true; this.active = false; this.clear(); this.leaving(true);
        this.closeTimer = window.setTimeout(this.dismiss, 200);
    }
    dispose(): void { this.closed = true; this.clear(); }
}

/** Bottom-right connection error, with focus/hover pause and focusable dismissal. */
export function MyApisErrorToast({ locale, error, toastKey, onDismiss }: {
    readonly locale: NextMuxDesktopLocale;
    readonly error?: string;
    readonly toastKey?: string;
    readonly onDismiss?: () => void;
}): React.ReactElement | null {
    const effectiveKey = error ? (toastKey || error) : '';
    const [dismissedKey, setDismissedKey] = React.useState('');
    const [fading, setFading] = React.useState(false);
    const lifetime = React.useRef<MyApisToastLifetime>();
    const onDismissRef = React.useRef(onDismiss);
    onDismissRef.current = onDismiss;
    React.useEffect(() => {
        setFading(false);
        if (!effectiveKey) { setDismissedKey(''); return; }
        if (effectiveKey === dismissedKey) return;
        const timer = new MyApisToastLifetime(setFading, () => {
            setDismissedKey(effectiveKey);
            setFading(false);
            onDismissRef.current?.();
        });
        lifetime.current = timer;
        return () => { timer.dispose(); if (lifetime.current === timer) lifetime.current = undefined; };
    }, [effectiveKey, dismissedKey]);
    if (!error || !effectiveKey || effectiveKey === dismissedKey) return null;
    const closeLabel = myApisText(locale, 'close');
    const safeMessage = error && !/secret|Bearer\s+|sk-[A-Za-z0-9_-]{6,}|https?:\/\//i.test(error)
        ? error
        : myApisText(locale, 'connectionFailed');
    return <div className={`nmx-my-apis-error-toast nmx-floating-toast is-error${fading ? ' is-fading is-leaving' : ''}`} role='status'
        dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale} data-nmx-literal
        onMouseDown={event => event.stopPropagation()}
        onMouseEnter={() => lifetime.current?.pause()}
        onMouseLeave={event => { if (!event.currentTarget.contains(document.activeElement)) lifetime.current?.resume(); }}
        onFocus={() => lifetime.current?.pause()} onBlur={event => { if (!event.currentTarget.matches(':hover')) lifetime.current?.resume(); }}>
        <i className='codicon codicon-error' aria-hidden='true' />
        <span className='nmx-my-apis-toast-text nmx-floating-toast-text'>{safeMessage}</span>
        <button type='button' className='nmx-my-apis-toast-close nmx-floating-toast-close' aria-label={closeLabel} title={closeLabel}
            onClick={() => lifetime.current?.close()}>
            <i className='codicon codicon-close' aria-hidden='true' />
        </button>
    </div>;
}

export function MyApisDialog(props: MyApisDialogProps): React.ReactElement {
    const t = (key: Key, values?: Readonly<Record<string, string | number>>): string => myApisText(props.locale, key, values);
    const panel = React.useRef<HTMLElement>(null);
    const [modelsOpen, setModelsOpen] = React.useState('');
    React.useEffect(() => {
        const highlighted = props.highlightId && panel.current?.querySelector<HTMLElement>(`[data-connection-id="${CSS.escape(props.highlightId)}"]`);
        if (highlighted) highlighted.scrollIntoView({ block: 'nearest' });
        (panel.current?.querySelector<HTMLElement>('.nmx-my-apis-toolbar button') || panel.current)?.focus();
    }, []);
    const status = (row: MyApiRow): string => [t(row.status), row.latencyMs && row.status !== 'unverified' ? t('latency', { ms: row.latencyMs }) : ''].filter(Boolean).join(' · ');
    return <div className='nmx-sheet-backdrop nmx-my-apis-backdrop' onMouseDown={() => { if (!props.busy) props.onClose(); }}>
        <section ref={panel} tabIndex={-1} className='nmx-my-apis' role='dialog' aria-modal='true' aria-labelledby='nmx-my-apis-title'
            onMouseDown={event => event.stopPropagation()}
            onKeyDown={event => { if (event.key === 'Escape' && !props.busy) { event.preventDefault(); event.stopPropagation(); props.onClose(); } }}>
            <header>
                <div><h2 id='nmx-my-apis-title'>{t('title')}{props.rows.length > 0 && <span className='nmx-my-apis-count'>{t('count', { count: props.rows.length })}</span>}</h2>
                    <p>{t('lead', { store: credentialStoreName(props.locale, props.platform, false) })}</p></div>
                <button type='button' className='nmx-my-apis-close' disabled={props.busy} onClick={props.onClose} aria-label={t('close')} title={t('close')}><i className='codicon codicon-close' aria-hidden='true' /></button>
            </header>
            <div className='nmx-my-apis-toolbar'>
                <button type='button' className='nmx-primary-button' disabled={props.busy} onClick={props.onAdd}><i className='codicon codicon-add' aria-hidden='true' /><span>{t('add')}</span></button>
                {props.onAddLocal && <button type='button' className='nmx-secondary-button' disabled={props.busy} onClick={props.onAddLocal}><i className='codicon codicon-device-desktop' aria-hidden='true' />{t('local')}</button>}
                <button type='button' className='nmx-my-apis-link' disabled={props.busy} onClick={props.onOfficial}>{t('official')}<i className='codicon codicon-chevron-right' aria-hidden='true' /></button>
            </div>
            {props.message && <p className='nmx-my-apis-message' role='status' aria-live='polite'>{props.message}</p>}
            {props.rows.length === 0
                ? <div className='nmx-my-apis-empty'><i className='codicon codicon-plug' aria-hidden='true' /><strong>{t('empty')}</strong><p>{t('emptyBody')}</p></div>
                : <ul className='nmx-my-apis-list'>{props.rows.map(row => {
                    const confirming = props.confirmRemoveId === row.id;
                    const mine = props.busyId === row.id;
                    return <li key={row.id} data-connection-id={row.id} className={row.id === props.highlightId ? 'is-highlighted' : undefined}>
                        <span className='nmx-my-apis-logo' aria-hidden='true'>{row.logo || <i className={`codicon codicon-${row.kind === 'media' ? 'device-camera-video' : row.kind === 'local' ? 'device-desktop' : 'plug'}`} />}</span>
                        <div className='nmx-my-apis-main'>
                            <strong data-nmx-literal title={row.name}>{row.name}</strong>
                            <small data-nmx-literal title={`${row.providerName} · ${row.host}`}>{row.providerName}{row.host ? ` · ${row.host}` : ''}</small>
                            <span className='nmx-my-apis-status'><i className={`nmx-connection-dot is-${row.status === 'unverified' ? 'unverified' : 'verified'}${row.status === 'reachable' ? ' is-partial' : ''}`} aria-hidden='true' />
                                <span data-nmx-literal>{status(row)}{row.summary ? ` · ${row.summary}` : ''}</span></span>
                        </div>
                        {confirming
                            ? <div className='nmx-my-apis-actions is-confirming' role='group' aria-label={t('confirmRemove')}>
                                <span>{t('confirmRemove')}</span>
                                <button type='button' disabled={props.busy} onClick={props.onCancelRemove}>{t('cancel')}</button>
                                <button type='button' className='is-danger' disabled={props.busy} onClick={() => props.onRemove(row.id)}>{mine && props.busyStage === 'removing' ? t('removing') : t('confirm')}</button>
                            </div>
                            : <div className='nmx-my-apis-actions'>
                                {(props.renderModels || props.onOpenModels) && <button type='button' data-api-action='models' aria-haspopup={props.onOpenModels ? 'dialog' : undefined} aria-expanded={modelsOpen === row.id}
                                    onClick={event => props.onOpenModels ? props.onOpenModels(row.id, event.currentTarget) : setModelsOpen(modelsOpen === row.id ? '' : row.id)}>{t('models')}<span className='nmx-my-apis-model-count'><span data-nmx-literal>{row.modelCount ?? 0}</span></span></button>}
                                <button type='button' data-api-action='speed' disabled={props.busy} onClick={() => props.onTest(row.id)}>{mine && props.busyStage === 'testing' ? t('testing') : t('test')}</button>
                                <button type='button' data-api-action='edit' disabled={props.busy} onClick={() => props.onEdit(row.id)}>{t('edit')}</button>
                                <button type='button' data-api-action='delete' className='nmx-my-apis-remove' disabled={props.busy} onClick={() => props.onRemove(row.id)} aria-label={`${t('remove')} ${row.name}`} title={t('remove')}><i className='codicon codicon-trash' aria-hidden='true' /></button>
                            </div>}
                        {modelsOpen === row.id && props.renderModels && <div className='nmx-my-apis-models' id={`nmx-my-apis-models-${row.id}`}>
                            {props.renderModels(row.id)}
                            {props.onRefreshModels && <button type='button' className='nmx-my-apis-refresh' disabled={props.busy} onClick={() => props.onRefreshModels!(row.id)}>
                                <i className={`codicon codicon-${mine && props.busyStage === 'discovering' ? 'sync codicon-modifier-spin' : 'refresh'}`} aria-hidden='true' />{mine && props.busyStage === 'discovering' ? t('refreshing') : t('refresh')}</button>}
                        </div>}
                    </li>;
                })}</ul>}
        </section>
        <MyApisErrorToast locale={props.locale} error={props.error} onDismiss={props.onDismissError} />
    </div>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function myApisText(locale: Parameters<typeof uncheckedMyApisText>[0], key: Parameters<typeof uncheckedMyApisText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedMyApisText>>): string {
    return totalCopy(locale, key, language => uncheckedMyApisText(language, key, ...rest));
}
