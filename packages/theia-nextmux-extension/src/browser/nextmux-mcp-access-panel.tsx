import { McpRegistryBrowser, type McpRegistryPick } from './nextmux-mcp-registry-browser';
import type { McpRegistryInstallOption, McpRegistryState } from '../common/nextmux-mcp-registry';
import * as React from 'react';
import type { NextMuxPlatformService } from '../common/nextmux-platform-protocol';
import type { McpCredentialChange, McpInputFieldSpec, McpServerAccess, McpServerConfiguration } from '../common/nextmux-mcp-access';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { McpCredentialEditor } from './nextmux-mcp-credential-editor';
import { mcpCredentialText } from './nextmux-mcp-credential-locale';
import type { MCPFrontendNotificationService } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { createMcpAccessRefresh } from './nextmux-mcp-access-refresh';
import { mcpFormText, mcpKnownFormError, parseMcpAutoRecognizedInput, validateMcpServerForm, type McpFormIssue } from './nextmux-mcp-form-validation';

const labels: Readonly<Record<NextMuxDesktopLocale, readonly string[]>> = {
    'zh-CN': ['MCP 服务', '已启用的工具可用于所有对话。', '刷新', '检查配置', '允许启动', '停止并撤销', '当前没有已添加的服务', '工具', '参数协议不受支持，已禁用', '已即时保存', '操作未完成，请刷新后重新检查配置和授权。', '添加服务', '名称', '本机命令', '远程 HTTPS 地址', '参数 JSON 数组', '保存配置', '取消'],
    'zh-TW': ['MCP 授權', '已啟用的工具可用於所有對話。', '重新整理', '檢查設定', '允許啟動', '停止並撤銷', '目前沒有服務', '工具', '不支援此參數協定，已停用', '已即時儲存', '操作未完成，請重新整理並檢查設定與授權。', '新增服務', '名稱', '本機命令', '遠端 HTTPS 位址', '參數 JSON 陣列', '儲存設定（不啟動）', '取消'],
    en: ['MCP services', 'Enabled tools are available to every conversation.', 'Refresh', 'Review configuration', 'Allow startup', 'Stop and revoke', 'No services added', 'Tools', 'Unsupported input schema; disabled', 'Saved immediately', 'Not completed. Refresh and review configuration and permissions.', 'Add service', 'Name', 'Local command', 'Remote HTTPS URL', 'Arguments JSON array', 'Save configuration', 'Cancel'],
    ja: ['MCP 権限', '有効なツールはすべての会話で利用できます。', '更新', '設定を確認', '起動を許可', '停止して取り消す', 'サービス未設定', 'ツール', '未対応の入力スキーマのため無効', '即時保存済み', '未完了です。更新後、設定と権限を確認してください。', 'サービスを追加', '名前', 'ローカルコマンド', 'リモート HTTPS URL', '引数の JSON 配列', '設定を保存（起動しない）', 'キャンセル'],
    ko: ['MCP 권한', '활성화된 도구는 모든 대화에서 사용할 수 있습니다.', '새로고침', '설정 검토', '시작 허용', '중지 및 취소', '서비스 없음', '도구', '지원하지 않는 입력 스키마로 비활성화됨', '즉시 저장됨', '완료되지 않았습니다. 새로고침 후 설정과 권한을 확인하세요.', '서비스 추가', '이름', '로컬 명령', '원격 HTTPS URL', '인수 JSON 배열', '설정 저장 (시작하지 않음)', '취소'],
    fr: ['Accès MCP', 'Les outils activés sont disponibles dans toutes les conversations.', 'Actualiser', 'Vérifier la configuration', 'Autoriser le démarrage', 'Arrêter et révoquer', 'Aucun serveur configuré', 'Outils', 'Schéma non pris en charge ; désactivé', 'Enregistré immédiatement', 'Opération incomplète. Actualisez et vérifiez configuration et autorisations.', 'Ajouter un serveur', 'Nom', 'Commande locale', 'URL HTTPS distante', 'Arguments (tableau JSON)', 'Enregistrer sans démarrer', 'Annuler'],
    de: ['MCP-Zugriff', 'Aktivierte Werkzeuge stehen in allen Unterhaltungen zur Verfügung.', 'Aktualisieren', 'Konfiguration prüfen', 'Start erlauben', 'Stoppen und widerrufen', 'Keine Server konfiguriert', 'Werkzeuge', 'Eingabeschema nicht unterstützt; deaktiviert', 'Sofort gespeichert', 'Nicht abgeschlossen. Aktualisieren und Konfiguration sowie Freigaben prüfen.', 'Server hinzufügen', 'Name', 'Lokaler Befehl', 'Remote-HTTPS-URL', 'Argumente als JSON-Array', 'Speichern, nicht starten', 'Abbrechen'],
    es: ['Acceso MCP', 'Las herramientas activadas están disponibles en todas las conversaciones.', 'Actualizar', 'Revisar configuración', 'Permitir inicio', 'Detener y revocar', 'Sin servidores', 'Herramientas', 'Esquema no compatible; desactivado', 'Guardado al instante', 'No se completó. Actualiza y revisa configuración y permisos.', 'Añadir servidor', 'Nombre', 'Comando local', 'URL HTTPS remota', 'Argumentos (array JSON)', 'Guardar sin iniciar', 'Cancelar'],
    'pt-BR': ['Acesso MCP', 'As ferramentas ativadas estão disponíveis em todas as conversas.', 'Atualizar', 'Revisar configuração', 'Permitir início', 'Parar e revogar', 'Nenhum servidor', 'Ferramentas', 'Esquema não suportado; desativado', 'Salvo imediatamente', 'Não concluído. Atualize e revise configuração e permissões.', 'Adicionar servidor', 'Nome', 'Comando local', 'URL HTTPS remoto', 'Argumentos (array JSON)', 'Salvar sem iniciar', 'Cancelar'],
    ru: ['Доступ MCP', 'Включённые инструменты доступны во всех разговорах.', 'Обновить', 'Проверить настройки', 'Разрешить запуск', 'Остановить и отозвать', 'Серверы не настроены', 'Инструменты', 'Схема не поддерживается; отключено', 'Сохранено сразу', 'Не завершено. Обновите и проверьте настройки и разрешения.', 'Добавить сервер', 'Имя', 'Локальная команда', 'Удалённый HTTPS URL', 'Аргументы (массив JSON)', 'Сохранить без запуска', 'Отмена'],
    ar: ['صلاحيات MCP', 'الأدوات المفعلة متاحة في جميع المحادثات.', 'تحديث', 'مراجعة الإعدادات', 'السماح بالتشغيل', 'إيقاف وإلغاء', 'لا توجد خوادم', 'الأدوات', 'مخطط إدخال غير مدعوم؛ معطل', 'تم الحفظ فوراً', 'لم تكتمل العملية. حدّث وراجع الإعدادات والصلاحيات.', 'إضافة خادم', 'الاسم', 'أمر محلي', 'عنوان HTTPS بعيد', 'معاملات كمصفوفة JSON', 'حفظ الإعدادات دون تشغيل', 'إلغاء'],
    hi: ['MCP अनुमति', 'सक्षम टूल सभी बातचीत में उपलब्ध हैं।', 'रीफ़्रेश', 'सेटिंग की समीक्षा', 'आरंभ की अनुमति', 'रोकें और रद्द करें', 'कोई सर्वर नहीं', 'टूल', 'इनपुट स्कीमा समर्थित नहीं; अक्षम', 'तुरंत सहेजा गया', 'पूरा नहीं हुआ। रीफ़्रेश करके सेटिंग और अनुमतियाँ जाँचें।', 'सर्वर जोड़ें', 'नाम', 'स्थानीय कमांड', 'दूरस्थ HTTPS URL', 'आर्ग्युमेंट JSON ऐरे', 'सेटिंग सहेजें (आरंभ नहीं)', 'रद्द करें']
};

const diagnosticCopy: Readonly<Record<NextMuxDesktopLocale, readonly string[]>> = {
    'zh-CN': ['请先检查配置', '尚未授权启动', '缺少运行依赖，请检查安装', '认证失败，请检查登录或密钥', '连接失败，请检查服务后重试', '服务已停止', '服务未提供工具', '请勾选需要的工具', '已连接，工具已授权', '搜索工具', '加载更多', '目录过大，已显示前 4096 个工具', '检查连接'],
    'zh-TW': ['請先檢查設定', '尚未授權啟動', '缺少執行依賴，請檢查安裝', '驗證失敗，請檢查登入或金鑰', '連線失敗，請檢查服務後重試', '服務已停止', '服務未提供工具', '請勾選需要的工具', '已連線，工具已授權', '搜尋工具', '載入更多', '目錄過大，已顯示前 4096 個工具', '檢查連線'],
    en: ['Review configuration first', 'Startup not authorized', 'Runtime missing; check installation', 'Authentication failed; check login or key', 'Connection failed; check the server and retry', 'Server stopped', 'No tools provided', 'Select the tools to allow', 'Connected; tools authorized', 'Search tools', 'Load more', 'Catalog limit: first 4096 tools shown', 'Check connection'],
    ja: ['設定を確認してください', '起動未許可', '実行環境のインストールを確認', '認証情報を確認してください', '接続失敗。サービスを確認して再試行', '停止中', 'ツールなし', '許可するツールを選択', '接続済み・ツール許可済み', 'ツールを検索', 'さらに表示', '先頭4096件を表示', '接続を確認'],
    ko: ['설정을 확인하세요', '시작 미승인', '실행 환경 설치를 확인하세요', '로그인 또는 키를 확인하세요', '연결 실패. 서버 확인 후 재시도', '서버 중지됨', '제공된 도구 없음', '허용할 도구를 선택하세요', '연결됨 · 도구 승인됨', '도구 검색', '더 보기', '처음 4096개 도구 표시', '연결 확인'],
    fr: ['Vérifiez la configuration', 'Démarrage non autorisé', 'Vérifiez les dépendances installées', 'Vérifiez la connexion ou la clé', 'Connexion échouée, vérifiez le serveur', 'Serveur arrêté', 'Aucun outil fourni', 'Choisissez les outils à autoriser', 'Connecté, outils autorisés', 'Rechercher des outils', 'Afficher plus', '4096 premiers outils affichés', 'Vérifier la connexion'],
    de: ['Konfiguration prüfen', 'Start nicht freigegeben', 'Laufzeitinstallation prüfen', 'Anmeldung oder Schlüssel prüfen', 'Verbindung fehlgeschlagen, Server prüfen', 'Server gestoppt', 'Keine Werkzeuge bereitgestellt', 'Werkzeuge freigeben', 'Verbunden, Werkzeuge freigegeben', 'Werkzeuge suchen', 'Mehr anzeigen', 'Erste 4096 Werkzeuge angezeigt', 'Verbindung prüfen'],
    es: ['Revisa la configuración', 'Inicio sin autorización', 'Revisa las dependencias instaladas', 'Revisa el inicio de sesión o la clave', 'Error de conexión; revisa el servidor', 'Servidor detenido', 'Sin herramientas disponibles', 'Selecciona las herramientas permitidas', 'Conectado; herramientas autorizadas', 'Buscar herramientas', 'Mostrar más', 'Se muestran las primeras 4096 herramientas', 'Comprobar conexión'],
    'pt-BR': ['Revise a configuração', 'Início não autorizado', 'Verifique as dependências instaladas', 'Verifique o login ou a chave', 'Falha na conexão; verifique o servidor', 'Servidor parado', 'Nenhuma ferramenta fornecida', 'Selecione as ferramentas permitidas', 'Conectado; ferramentas autorizadas', 'Buscar ferramentas', 'Mostrar mais', 'Primeiras 4096 ferramentas exibidas', 'Verificar conexão'],
    ru: ['Проверьте настройки', 'Запуск не разрешён', 'Проверьте установку среды', 'Проверьте вход или ключ', 'Ошибка подключения; проверьте сервер', 'Сервер остановлен', 'Нет инструментов', 'Выберите разрешённые инструменты', 'Подключено, инструменты разрешены', 'Найти инструменты', 'Показать ещё', 'Показаны первые 4096 инструментов', 'Проверить подключение'],
    ar: ['راجع الإعدادات', 'بدء التشغيل غير مصرح', 'تحقق من تثبيت بيئة التشغيل', 'تحقق من تسجيل الدخول أو المفتاح', 'فشل الاتصال؛ تحقق من الخادم', 'الخادم متوقف', 'لا توجد أدوات', 'حدد الأدوات المسموح بها', 'متصل؛ الأدوات مصرح بها', 'البحث عن أدوات', 'عرض المزيد', 'عرض أول 4096 أداة', 'فحص الاتصال'],
    hi: ['सेटिंग जाँचें', 'आरंभ की अनुमति नहीं', 'रनटाइम इंस्टॉलेशन जाँचें', 'लॉगिन या कुंजी जाँचें', 'कनेक्शन विफल; सर्वर जाँचें', 'सर्वर रुका हुआ है', 'कोई टूल उपलब्ध नहीं', 'अनुमत टूल चुनें', 'कनेक्टेड; टूल अधिकृत', 'टूल खोजें', 'और दिखाएँ', 'पहले 4096 टूल दिखाए गए', 'कनेक्शन जाँचें']
};
const diagnosticKeys: readonly NonNullable<McpServerAccess['diagnostic']>[] = ['configuration', 'authorization', 'dependency', 'authentication', 'connection', 'stopped', 'empty', 'tools', 'ready'];

const detailCopy: Readonly<Record<NextMuxDesktopLocale, readonly string[]>> = {
    'zh-CN': ['详情', '诊断信息', '阶段', '错误代码', '退出码', '信号', '启动', '连接', '工具发现', '停止', '未启用', '待选工具', '连接异常', '已连接'],
    'zh-TW': ['詳情', '診斷資訊', '階段', '錯誤代碼', '結束碼', '訊號', '啟動', '連線', '工具探索', '停止', '未啟用', '待選工具', '連線異常', '已連線'],
    en: ['Details', 'Diagnostics', 'Stage', 'Error code', 'Exit code', 'Signal', 'Startup', 'Connection', 'Tool discovery', 'Stop', 'Not enabled', 'Select tools', 'Connection issue', 'Connected'],
    ja: ['詳細', '診断情報', '段階', 'エラーコード', '終了コード', 'シグナル', '起動', '接続', 'ツール検出', '停止', '未有効化', 'ツールを選択', '接続エラー', '接続済み'],
    ko: ['세부 정보', '진단', '단계', '오류 코드', '종료 코드', '신호', '시작', '연결', '도구 검색', '중지', '비활성', '도구 선택', '연결 문제', '연결됨'],
    fr: ['Détails', 'Diagnostic', 'Étape', 'Code erreur', 'Code de sortie', 'Signal', 'Démarrage', 'Connexion', 'Découverte des outils', 'Arrêter', 'Non activé', 'Choisir les outils', 'Erreur de connexion', 'Connecté'],
    de: ['Details', 'Diagnose', 'Phase', 'Fehlercode', 'Exit-Code', 'Signal', 'Start', 'Verbindung', 'Werkzeugsuche', 'Stoppen', 'Nicht aktiviert', 'Werkzeuge wählen', 'Verbindungsfehler', 'Verbunden'],
    es: ['Detalles', 'Diagnóstico', 'Etapa', 'Código de error', 'Código de salida', 'Señal', 'Inicio', 'Conexión', 'Descubrimiento de herramientas', 'Detener', 'No habilitado', 'Elegir herramientas', 'Error de conexión', 'Conectado'],
    'pt-BR': ['Detalhes', 'Diagnóstico', 'Etapa', 'Código de erro', 'Código de saída', 'Sinal', 'Início', 'Conexão', 'Descoberta de ferramentas', 'Parar', 'Não habilitado', 'Escolher ferramentas', 'Erro de conexão', 'Conectado'],
    ru: ['Подробности', 'Диагностика', 'Этап', 'Код ошибки', 'Код выхода', 'Сигнал', 'Запуск', 'Подключение', 'Поиск инструментов', 'Остановить', 'Не включён', 'Выбрать инструменты', 'Ошибка подключения', 'Подключено'],
    ar: ['التفاصيل', 'التشخيص', 'المرحلة', 'رمز الخطأ', 'رمز الخروج', 'الإشارة', 'بدء التشغيل', 'الاتصال', 'اكتشاف الأدوات', 'إيقاف', 'غير مفعل', 'اختر الأدوات', 'مشكلة اتصال', 'متصل'],
    hi: ['विवरण', 'निदान', 'चरण', 'त्रुटि कोड', 'निकास कोड', 'सिग्नल', 'आरंभ', 'कनेक्शन', 'टूल खोज', 'रोकें', 'सक्षम नहीं', 'टूल चुनें', 'कनेक्शन समस्या', 'कनेक्टेड']
};

export function McpFailureDetails({ locale, failure }: { locale: NextMuxDesktopLocale; failure: NonNullable<McpServerAccess['failure']> }): React.ReactElement {
    const copy = detailCopy[locale];
    return <details className='nmx-mcp-diagnostic'><summary>{copy[1]}</summary>
        <dl><dt>{copy[2]}</dt><dd>{copy[{ startup: 6, connection: 7, tools: 8 }[failure.stage]]}</dd>
            <dt>{copy[3]}</dt><dd><code>{failure.code}</code></dd>
            {failure.exitCode !== undefined && <><dt>{copy[4]}</dt><dd>{failure.exitCode}</dd></>}
            {failure.signal && <><dt>{copy[5]}</dt><dd><code>{failure.signal}</code></dd></>}
        </dl>
        {failure.detail && <pre>{failure.detail}</pre>}
    </details>;
}

const mcpCommandMissingText: Readonly<Record<NextMuxDesktopLocale, string>> = {
    'zh-CN': '找不到启动命令，请确认已安装或填写完整路径', 'zh-TW': '找不到啟動命令，請確認已安裝或填寫完整路徑',
    en: 'Command not found; install it or use the full path', ja: 'コマンドが見つかりません。インストールするかフルパスを指定してください',
    ko: '명령을 찾을 수 없습니다. 설치하거나 전체 경로를 입력하세요', fr: 'Commande introuvable ; installez-la ou indiquez le chemin complet',
    de: 'Befehl nicht gefunden; installieren oder vollständigen Pfad angeben', es: 'Comando no encontrado; instálalo o usa la ruta completa',
    'pt-BR': 'Comando não encontrado; instale-o ou use o caminho completo', ru: 'Команда не найдена; установите её или укажите полный путь',
    ar: 'تعذر العثور على الأمر؛ ثبّته أو استخدم المسار الكامل', hi: 'कमांड नहीं मिला; इसे इंस्टॉल करें या पूरा पथ दें'
};

/** A missing well-known launcher names what to install (uv for uvx, Node.js for npx), not a generic “command”. */
const mcpRuntimeMissingText: Readonly<Record<'uvx' | 'npx' | 'docker', Readonly<Record<NextMuxDesktopLocale, string>>>> = {
    uvx: {
        'zh-CN': '未检测到 uvx（Python uv），请先安装 uv 后重试', 'zh-TW': '未偵測到 uvx（Python uv），請先安裝 uv 後重試',
        en: 'uvx (Python uv) not found; install uv and retry', ja: 'uvx（Python uv）が見つかりません。uv をインストールしてから再試行してください',
        ko: 'uvx(Python uv)를 찾을 수 없습니다. uv를 설치한 뒤 다시 시도하세요', fr: 'uvx (Python uv) introuvable ; installez uv puis réessayez',
        de: 'uvx (Python uv) nicht gefunden; uv installieren und erneut versuchen', es: 'No se encontró uvx (Python uv); instala uv y reinténtalo',
        'pt-BR': 'uvx (Python uv) não encontrado; instale o uv e tente de novo', ru: 'uvx (Python uv) не найден; установите uv и повторите',
        ar: 'تعذر العثور على uvx (Python uv)؛ ثبّت uv ثم أعد المحاولة', hi: 'uvx (Python uv) नहीं मिला; uv इंस्टॉल करके फिर प्रयास करें'
    },
    npx: {
        'zh-CN': '未检测到 npx（Node.js），请先安装 Node.js 后重试', 'zh-TW': '未偵測到 npx（Node.js），請先安裝 Node.js 後重試',
        en: 'npx (Node.js) not found; install Node.js and retry', ja: 'npx（Node.js）が見つかりません。Node.js をインストールしてから再試行してください',
        ko: 'npx(Node.js)를 찾을 수 없습니다. Node.js를 설치한 뒤 다시 시도하세요', fr: 'npx (Node.js) introuvable ; installez Node.js puis réessayez',
        de: 'npx (Node.js) nicht gefunden; Node.js installieren und erneut versuchen', es: 'No se encontró npx (Node.js); instala Node.js y reinténtalo',
        'pt-BR': 'npx (Node.js) não encontrado; instale o Node.js e tente de novo', ru: 'npx (Node.js) не найден; установите Node.js и повторите',
        ar: 'تعذر العثور على npx (Node.js)؛ ثبّت Node.js ثم أعد المحاولة', hi: 'npx (Node.js) नहीं मिला; Node.js इंस्टॉल करके फिर प्रयास करें'
    },
    docker: {
        'zh-CN': '未检测到 Docker，请先安装并启动 Docker 后重试', 'zh-TW': '未偵測到 Docker，請先安裝並啟動 Docker 後重試',
        en: 'Docker not found; install and start Docker, then retry', ja: 'Docker が見つかりません。Docker をインストールして起動してから再試行してください',
        ko: 'Docker를 찾을 수 없습니다. Docker를 설치하고 실행한 뒤 다시 시도하세요', fr: 'Docker introuvable ; installez-le et lancez-le, puis réessayez',
        de: 'Docker nicht gefunden; Docker installieren und starten, dann erneut versuchen', es: 'No se encontró Docker; instálalo, inícialo y reinténtalo',
        'pt-BR': 'Docker não encontrado; instale e inicie o Docker e tente de novo', ru: 'Docker не найден; установите и запустите Docker, затем повторите',
        ar: 'تعذر العثور على Docker؛ ثبّته وشغّله ثم أعد المحاولة', hi: 'Docker नहीं मिला; Docker इंस्टॉल और चालू करके फिर प्रयास करें'
    }
};

/** Background restore has no panel-owned RPC, but still needs a working Stop action. */
export function mcpStartupPending(server: Pick<McpServerAccess, 'status'>, pending: boolean): boolean {
    return pending || server.status === 'Starting' || server.status === 'Connecting';
}

export function mcpStatus(locale: NextMuxDesktopLocale, server: McpServerAccess): { readonly label: string; readonly tone: 'ready' | 'working' | 'error' | 'idle' } {
    const translations: Readonly<Record<NextMuxDesktopLocale, readonly string[]>> = {
        'zh-CN': ['已连接', '启动中', '已停止', '需要处理'], 'zh-TW': ['已連線', '啟動中', '已停止', '需要處理'],
        en: ['Connected', 'Starting', 'Stopped', 'Action needed'], ja: ['接続済み', '起動中', '停止中', '対応が必要'],
        ko: ['연결됨', '시작 중', '중지됨', '조치 필요'], fr: ['Connecté', 'Démarrage', 'Arrêté', 'Action requise'],
        de: ['Verbunden', 'Wird gestartet', 'Gestoppt', 'Aktion erforderlich'], es: ['Conectado', 'Iniciando', 'Detenido', 'Se requiere acción'],
        'pt-BR': ['Conectado', 'Iniciando', 'Parado', 'Ação necessária'], ru: ['Подключено', 'Запуск', 'Остановлено', 'Требуется действие'],
        ar: ['متصل', 'جارٍ التشغيل', 'متوقف', 'يتطلب إجراء'], hi: ['कनेक्टेड', 'शुरू हो रहा है', 'रुका हुआ', 'कार्रवाई आवश्यक']
    };
    const copy = translations[locale];
    if (server.status === 'Starting' || server.status === 'Connecting') return { label: copy[1], tone: 'working' };
    if (server.failure) {
        // Every failure code in every language (audit A10-006): zh-CN, zh-TW, en, ja, ko, es, fr, de, pt-BR, ru, ar, hi.
        const failureCopy: Record<NonNullable<McpServerAccess['failure']>['code'], readonly string[]> = {
            runtime_missing: ['未找到运行组件，请修复安装后重试', '找不到執行元件，請修復安裝後重試', 'Runtime component missing; repair installation and retry', '実行コンポーネントが見つかりません。インストールを修復して再試行してください', '실행 구성 요소가 없습니다. 설치를 복구한 뒤 다시 시도하세요', 'Falta un componente de ejecución; repara la instalación y reinténtalo', 'Composant d’exécution manquant ; réparez l’installation puis réessayez', 'Laufzeitkomponente fehlt; Installation reparieren und erneut versuchen', 'Componente de execução ausente; repare a instalação e tente de novo', 'Нет компонента среды выполнения; восстановите установку и повторите', 'مكوّن التشغيل مفقود؛ أصلح التثبيت ثم أعد المحاولة', 'रनटाइम घटक नहीं मिला; इंस्टॉलेशन ठीक करके फिर प्रयास करें'],
            browser_missing: ['未找到浏览器，请检查浏览器安装', '找不到瀏覽器，請檢查瀏覽器安裝', 'Browser executable missing; check browser installation', 'ブラウザーが見つかりません。インストールを確認してください', '브라우저를 찾을 수 없습니다. 설치를 확인하세요', 'No se encuentra el navegador; revisa su instalación', 'Navigateur introuvable ; vérifiez son installation', 'Browser nicht gefunden; Installation prüfen', 'Navegador não encontrado; verifique a instalação', 'Браузер не найден; проверьте установку', 'المتصفح غير موجود؛ تحقّق من تثبيته', 'ब्राउज़र नहीं मिला; इंस्टॉलेशन जाँचें'],
            permission_denied: ['系统拒绝访问，请检查应用权限', '系統拒絕存取，請檢查應用程式權限', 'Access denied; check application permissions', 'アクセスが拒否されました。アプリの権限を確認してください', '접근이 거부되었습니다. 앱 권한을 확인하세요', 'Acceso denegado; revisa los permisos de la aplicación', 'Accès refusé ; vérifiez les autorisations de l’application', 'Zugriff verweigert; App-Berechtigungen prüfen', 'Acesso negado; verifique as permissões do aplicativo', 'Доступ запрещён; проверьте разрешения приложения', 'تم رفض الوصول؛ تحقّق من أذونات التطبيق', 'पहुँच अस्वीकृत; ऐप अनुमतियाँ जाँचें'],
            timeout: ['连接超时，请检查服务后重试', '連線逾時，請檢查服務後重試', 'Connection timed out; check the server and retry', '接続がタイムアウトしました。サーバーを確認して再試行してください', '연결 시간이 초과되었습니다. 서버를 확인하고 다시 시도하세요', 'Se agotó el tiempo de conexión; revisa el servidor y reinténtalo', 'Délai de connexion dépassé ; vérifiez le serveur puis réessayez', 'Zeitüberschreitung; Server prüfen und erneut versuchen', 'Tempo de conexão esgotado; verifique o servidor e tente de novo', 'Время подключения истекло; проверьте сервер и повторите', 'انتهت مهلة الاتصال؛ تحقّق من الخادم ثم أعد المحاولة', 'कनेक्शन का समय समाप्त; सर्वर जाँचकर फिर प्रयास करें'],
            authentication: ['认证失败，请检查登录或密钥', '驗證失敗，請檢查登入或金鑰', 'Authentication failed; check login or key', '認証に失敗しました。ログインまたはキーを確認してください', '인증에 실패했습니다. 로그인 또는 키를 확인하세요', 'Error de autenticación; revisa el inicio de sesión o la clave', 'Échec de l’authentification ; vérifiez la connexion ou la clé', 'Authentifizierung fehlgeschlagen; Anmeldung oder Schlüssel prüfen', 'Falha na autenticação; verifique o login ou a chave', 'Ошибка аутентификации; проверьте вход или ключ', 'فشلت المصادقة؛ تحقّق من تسجيل الدخول أو المفتاح', 'प्रमाणीकरण विफल; लॉगिन या कुंजी जाँचें'],
            process_exit: ['服务意外断开，请重新启动', '服務意外中斷，請重新啟動', 'Server disconnected unexpectedly; restart to reconnect', 'サーバーが予期せず切断されました。再起動してください', '서버 연결이 예기치 않게 끊겼습니다. 다시 시작하세요', 'El servidor se desconectó; reinícialo para reconectar', 'Le serveur s’est déconnecté ; redémarrez-le pour vous reconnecter', 'Server unerwartet getrennt; zum Verbinden neu starten', 'O servidor desconectou; reinicie para reconectar', 'Сервер неожиданно отключился; перезапустите его', 'انقطع الخادم فجأة؛ أعد تشغيله لإعادة الاتصال', 'सर्वर अचानक डिस्कनेक्ट हुआ; फिर से शुरू करें'],
            protocol: ['服务返回的数据无法识别，请检查配置', '服務傳回的資料無法辨識，請檢查設定', 'Invalid server response; check configuration', 'サーバーの応答を認識できません。設定を確認してください', '서버 응답을 인식할 수 없습니다. 구성을 확인하세요', 'Respuesta del servidor no válida; revisa la configuración', 'Réponse du serveur invalide ; vérifiez la configuration', 'Ungültige Serverantwort; Konfiguration prüfen', 'Resposta inválida do servidor; verifique a configuração', 'Некорректный ответ сервера; проверьте настройки', 'استجابة الخادم غير صالحة؛ تحقّق من الإعدادات', 'सर्वर का उत्तर अमान्य; कॉन्फ़िगरेशन जाँचें'],
            connection: ['连接失败，请检查服务后重试', '連線失敗，請檢查服務後重試', 'Connection failed; check the server and retry', '接続に失敗しました。サーバーを確認して再試行してください', '연결에 실패했습니다. 서버를 확인하고 다시 시도하세요', 'Error de conexión; revisa el servidor y reinténtalo', 'Échec de la connexion ; vérifiez le serveur puis réessayez', 'Verbindung fehlgeschlagen; Server prüfen und erneut versuchen', 'Falha na conexão; verifique o servidor e tente de novo', 'Не удалось подключиться; проверьте сервер и повторите', 'فشل الاتصال؛ تحقّق من الخادم ثم أعد المحاولة', 'कनेक्शन विफल; सर्वर जाँचकर फिर प्रयास करें']
        };
        // A user-added local command that cannot be spawned is almost always a
        // missing executable or PATH entry, not a broken NextMux install.
        const failureLabel = server.local && server.failure.stage === 'startup' && server.failure.code === 'runtime_missing'
            ? (server.failure.runtime ? mcpRuntimeMissingText[server.failure.runtime]?.[locale] : undefined) || mcpCommandMissingText[locale]
            : failureCopy[server.failure.code]?.[['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'].indexOf(locale)]
                || diagnosticCopy[locale][diagnosticKeys.indexOf(server.diagnostic || 'connection')];
        return { label: server.failure.stage === 'tools' ? `${labels[locale][7]}: ${failureLabel}` : failureLabel, tone: 'error' };
    }
    if (server.diagnostic) {
        const tone = server.diagnostic === 'ready' && server.running && server.approved ? 'ready'
            : ['authorization', 'stopped', 'empty'].includes(server.diagnostic) ? 'idle'
                : server.diagnostic === 'tools' ? 'working' : 'error';
        return { label: diagnosticCopy[locale][diagnosticKeys.indexOf(server.diagnostic)], tone };
    }
    if (server.running && server.approved) return { label: copy[0], tone: 'working' };
    if (server.status === 'Not Running' || server.status === 'Not Connected') return { label: diagnosticCopy[locale][5], tone: 'idle' };
    return { label: copy[3], tone: 'error' };
}

const serviceCopy: Readonly<Record<NextMuxDesktopLocale, readonly string[]>> = {
    'zh-CN': ['搜索服务', '没有匹配的服务', '连接设置', '每行一个参数', '修改'], 'zh-TW': ['搜尋服務', '沒有符合的服務', '連線設定', '每行一個參數', '修改'],
    en: ['Search services', 'No matching services', 'Connection settings', 'One argument per line', 'Edit'],
    ja: ['サービスを検索', '一致するサービスなし', '接続設定', '引数は1行に1つ', '編集'], ko: ['서비스 검색', '일치하는 서비스 없음', '연결 설정', '한 줄에 인수 하나', '편집'],
    fr: ['Rechercher des services', 'Aucun service trouvé', 'Paramètres de connexion', 'Un argument par ligne', 'Modifier'],
    de: ['Dienste suchen', 'Keine passenden Dienste', 'Verbindungseinstellungen', 'Ein Argument pro Zeile', 'Bearbeiten'],
    es: ['Buscar servicios', 'Sin servicios coincidentes', 'Configuración de conexión', 'Un argumento por línea', 'Editar'],
    'pt-BR': ['Buscar serviços', 'Nenhum serviço encontrado', 'Configurações de conexão', 'Um argumento por linha', 'Editar'],
    ru: ['Поиск сервисов', 'Сервисы не найдены', 'Настройки подключения', 'Один аргумент на строку', 'Изменить'],
    ar: ['البحث عن خدمات', 'لا توجد خدمات مطابقة', 'إعدادات الاتصال', 'معامل واحد في كل سطر', 'تعديل'],
    hi: ['सेवाएँ खोजें', 'कोई मेल खाती सेवा नहीं', 'कनेक्शन सेटिंग', 'प्रत्येक पंक्ति में एक आर्ग्युमेंट', 'संपादित करें']
};

const connectionCopy: Readonly<Record<NextMuxDesktopLocale, readonly string[]>> = {
    'zh-CN': ['添加第三方工具服务。内置文件、浏览器与电脑工具按权限自动提供。', '添加并连接', '启用全部支持的工具', '连接后会显示可用工具，由你选择启用范围。'],
    'zh-TW': ['新增第三方工具服務。內建檔案、瀏覽器與電腦工具依權限自動提供。', '新增並連線', '啟用所有支援的工具', '連線後顯示可用工具，由你選擇啟用範圍。'],
    en: ['Add third-party tools. Built-in file, browser and computer tools follow your permissions.', 'Add and connect', 'Enable all supported tools', 'After connecting, choose which discovered tools to enable.'],
    ja: ['外部ツールを追加します。組み込みのファイル・ブラウザー・コンピューターツールは権限に従います。', '追加して接続', '対応ツールをすべて有効化', '接続後、検出されたツールから有効にするものを選びます。'],
    ko: ['외부 도구를 추가합니다. 기본 파일, 브라우저 및 컴퓨터 도구는 권한에 따라 제공됩니다.', '추가 및 연결', '지원되는 모든 도구 활성화', '연결 후 검색된 도구 중 사용할 도구를 선택하세요.'],
    fr: ['Ajoutez des outils tiers. Les outils intégrés de fichiers, navigateur et ordinateur suivent vos autorisations.', 'Ajouter et connecter', 'Activer tous les outils compatibles', 'Après connexion, choisissez les outils découverts à activer.'],
    de: ['Drittanbieter-Werkzeuge hinzufügen. Integrierte Datei-, Browser- und Computerwerkzeuge beachten Ihre Berechtigungen.', 'Hinzufügen und verbinden', 'Alle unterstützten Werkzeuge aktivieren', 'Wählen Sie nach der Verbindung die zu aktivierenden Werkzeuge.'],
    es: ['Añade herramientas externas. Las herramientas integradas de archivos, navegador y ordenador respetan tus permisos.', 'Añadir y conectar', 'Activar todas las herramientas compatibles', 'Tras conectar, elige qué herramientas descubiertas activar.'],
    'pt-BR': ['Adicione ferramentas externas. As ferramentas integradas de arquivos, navegador e computador seguem suas permissões.', 'Adicionar e conectar', 'Ativar todas as ferramentas compatíveis', 'Após conectar, escolha quais ferramentas encontradas ativar.'],
    ru: ['Добавьте сторонние инструменты. Встроенные инструменты файлов, браузера и компьютера соблюдают ваши разрешения.', 'Добавить и подключить', 'Включить все поддерживаемые инструменты', 'После подключения выберите инструменты для включения.'],
    ar: ['أضف أدوات خارجية. أدوات الملفات والمتصفح والكمبيوتر المدمجة تلتزم بصلاحياتك.', 'إضافة واتصال', 'تفعيل جميع الأدوات المدعومة', 'بعد الاتصال، اختر الأدوات المكتشفة التي تريد تفعيلها.'],
    hi: ['बाहरी टूल जोड़ें। अंतर्निहित फ़ाइल, ब्राउज़र और कंप्यूटर टूल आपकी अनुमतियों का पालन करते हैं।', 'जोड़ें और कनेक्ट करें', 'सभी समर्थित टूल सक्षम करें', 'कनेक्ट होने के बाद खोजे गए टूल में से सक्षम करने वाले टूल चुनें।']
};

/** Keep the common one-argument-per-line form; accept existing JSON arrays on paste. */
export function parseMcpArguments(value: string): string[] {
    if (!value.trim().startsWith('[')) return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) throw new Error('MCP_CONFIG_INVALID');
    return parsed;
}

function mcpTransportText(locale: NextMuxDesktopLocale, local: boolean): string {
    const copy: Readonly<Record<NextMuxDesktopLocale, readonly string[]>> = {
        'zh-CN': ['本机 stdio', '远程 HTTP'], 'zh-TW': ['本機 stdio', '遠端 HTTP'], en: ['Local stdio', 'Remote HTTP'],
        ja: ['ローカル stdio', 'リモート HTTP'], ko: ['로컬 stdio', '원격 HTTP'], fr: ['stdio local', 'HTTP distant'],
        de: ['Lokales stdio', 'Remote-HTTP'], es: ['stdio local', 'HTTP remoto'], 'pt-BR': ['stdio local', 'HTTP remoto'],
        ru: ['Локальный stdio', 'Удалённый HTTP'], ar: ['stdio محلي', 'HTTP بعيد'], hi: ['स्थानीय stdio', 'रिमोट HTTP']
    };
    return copy[locale][local ? 0 : 1];
}

const mcpFieldCopy: Readonly<Record<NextMuxDesktopLocale, readonly [transport: string, args: string, headers: string]>> = {
    'zh-CN': ['连接类型', '{n} 个参数', '{n} 个请求头'], 'zh-TW': ['連線類型', '{n} 個參數', '{n} 個請求標頭'],
    en: ['Transport', '{n} args', '{n} headers'], ja: ['接続方式', '引数 {n} 個', 'ヘッダー {n} 個'], ko: ['연결 방식', '인수 {n}개', '헤더 {n}개'],
    fr: ['Transport', '{n} arguments', '{n} en-têtes'], de: ['Verbindungsart', '{n} Argumente', '{n} Header'],
    es: ['Tipo de conexión', '{n} argumentos', '{n} encabezados'], 'pt-BR': ['Tipo de conexão', '{n} argumentos', '{n} cabeçalhos'],
    ru: ['Тип подключения', 'аргументов: {n}', 'заголовков: {n}'], ar: ['نوع الاتصال', '{n} معاملات', '{n} ترويسات'], hi: ['कनेक्शन प्रकार', '{n} आर्ग्युमेंट', '{n} हेडर']
};

/** Localized field label for the add-service transport select. */
export function mcpTransportLabel(locale: NextMuxDesktopLocale): string {
    return mcpFieldCopy[locale][0];
}

function mcpCountText(locale: NextMuxDesktopLocale, kind: 'args' | 'headers', count: number): string {
    return mcpFieldCopy[locale][kind === 'args' ? 1 : 2].replace('{n}', String(count));
}

/**
 * The editor shows one argument per line (the same shape Claude Desktop /
 * Cline users paste). Fall back to a JSON array only when a value cannot be
 * represented losslessly on its own line.
 */
export function formatMcpArguments(args: readonly string[]): string {
    const lineSafe = args.every(arg => arg.length > 0 && arg === arg.trim() && !/[\r\n]/.test(arg)) && !args[0]?.startsWith('[');
    return lineSafe ? args.join('\n') : JSON.stringify(args);
}

export function parseMcpEnvironment(value: string): Record<string, string> {
    const trimmed = value.trim();
    if (!trimmed) return {};
    if (trimmed.startsWith('{')) {
        const parsed: unknown = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('MCP_CONFIG_INVALID');
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(k) || typeof v !== 'string') throw new Error('MCP_CONFIG_INVALID');
            out[k] = v;
        }
        return out;
    }
    const out: Record<string, string> = {};
    for (const rawLine of trimmed.split(/\r?\n|;/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const eq = line.indexOf('=');
        if (eq <= 0) throw new Error('MCP_CONFIG_INVALID');
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)) throw new Error('MCP_CONFIG_INVALID');
        out[key] = val;
    }
    return out;
}

const smartFormCopy: Readonly<Record<NextMuxDesktopLocale, readonly [smartPlaceholder: string, smartAction: string, envLabel: string, authOptional: string,
    requiredBadge: string, optionalBadge: string, methodLabel: string, recognized: string, unrecognized: string, addVariable: string,
    removeVariable: string, valuePlaceholder: string, envRule: string]>> = {
    'zh-CN': ['粘贴 JSON 配置、npx/uvx 命令或 HTTPS 地址自动识别…', '智能识别', '环境变量（选填）', '认证密钥（选填，留空可稍后配置）', '必填', '选填', '安装方式',
        '已识别，已填入下方字段', '无法识别，请粘贴 JSON 配置、命令或 HTTPS 地址', '添加变量', '删除变量', '值', '变量名只能用字母、数字和下划线，不能以数字开头，且不能重复'],
    'zh-TW': ['貼上 JSON 設定、npx/uvx 命令或 HTTPS 位址自動識別…', '智慧識別', '環境變數（選填）', '驗證金鑰（選填，留空可稍後設定）', '必填', '選填', '安裝方式',
        '已識別，已填入下方欄位', '無法識別，請貼上 JSON 設定、命令或 HTTPS 位址', '新增變數', '刪除變數', '值', '變數名稱只能用字母、數字和底線，不能以數字開頭，且不能重複'],
    en: ['Paste JSON config, npx/uvx command, or HTTPS URL to auto-fill…', 'Auto-fill', 'Environment variables (optional)', 'Authentication key (optional, or configure later)', 'Required', 'Optional', 'Install method',
        'Recognized — the fields below are filled in', 'Not recognized. Paste a JSON config, a command or an HTTPS URL', 'Add variable', 'Remove variable', 'Value', 'Names use letters, digits and underscores, cannot start with a digit, and must be unique'],
    ja: ['JSON 設定、npx/uvx コマンド、または HTTPS URL を貼り付けて自動入力…', '自動認識', '環境変数（任意）', '認証キー（任意、後で設定可能）', '必須', '任意', 'インストール方式',
        '認識しました。下の欄に入力済みです', '認識できません。JSON 設定、コマンド、または HTTPS URL を貼り付けてください', '変数を追加', '変数を削除', '値', '名前は英数字とアンダースコアのみ、数字で始めず、重複できません'],
    ko: ['JSON 설정, npx/uvx 명령 또는 HTTPS URL을 붙여넣어 자동 입력…', '자동 인식', '환경 변수 (선택)', '인증 키 (선택, 나중에 설정 가능)', '필수', '선택', '설치 방식',
        '인식했습니다. 아래 칸이 채워졌습니다', '인식할 수 없습니다. JSON 설정, 명령 또는 HTTPS URL을 붙여넣으세요', '변수 추가', '변수 삭제', '값', '이름은 영문, 숫자, 밑줄만 쓸 수 있고 숫자로 시작하거나 중복될 수 없습니다'],
    fr: ['Collez une config JSON, commande npx/uvx ou URL HTTPS…', 'Reconnaître', 'Variables d’environnement (optionnel)', 'Clé d’authentification (optionnel)', 'Requis', 'Optionnel', 'Méthode',
        'Reconnu — les champs ci-dessous sont remplis', 'Non reconnu. Collez une config JSON, une commande ou une URL HTTPS', 'Ajouter une variable', 'Supprimer la variable', 'Valeur', 'Noms : lettres, chiffres et _, sans chiffre en tête ni doublon'],
    de: ['JSON-Konfiguration, npx/uvx-Befehl oder HTTPS-URL einfügen…', 'Erkennen', 'Umgebungsvariablen (optional)', 'Authentifizierungsschlüssel (optional)', 'Erforderlich', 'Optional', 'Methode',
        'Erkannt – die Felder unten sind ausgefüllt', 'Nicht erkannt. JSON-Konfiguration, Befehl oder HTTPS-URL einfügen', 'Variable hinzufügen', 'Variable entfernen', 'Wert', 'Namen: Buchstaben, Ziffern und _, nicht mit einer Ziffer beginnend, eindeutig'],
    es: ['Pega JSON, comando npx/uvx o URL HTTPS para autocompletar…', 'Reconocer', 'Variables de entorno (opcional)', 'Clave de autenticación (opcional)', 'Obligatorio', 'Opcional', 'Método',
        'Reconocido: los campos de abajo están completos', 'No reconocido. Pega una config JSON, un comando o una URL HTTPS', 'Añadir variable', 'Quitar variable', 'Valor', 'Nombres: letras, dígitos y _, sin empezar por dígito ni repetirse'],
    'pt-BR': ['Cole JSON, comando npx/uvx ou URL HTTPS para preencher…', 'Reconhecer', 'Variáveis de ambiente (opcional)', 'Chave de autenticação (opcional)', 'Obrigatório', 'Opcional', 'Método',
        'Reconhecido — os campos abaixo foram preenchidos', 'Não reconhecido. Cole uma config JSON, um comando ou uma URL HTTPS', 'Adicionar variável', 'Remover variável', 'Valor', 'Nomes: letras, dígitos e _, sem começar por dígito nem repetir'],
    ru: ['Вставьте JSON, команду npx/uvx или HTTPS URL…', 'Распознать', 'Переменные окружения (необязательно)', 'Ключ аутентификации (необязательно)', 'Обязательно', 'Опционально', 'Способ',
        'Распознано — поля ниже заполнены', 'Не распознано. Вставьте JSON, команду или HTTPS URL', 'Добавить переменную', 'Удалить переменную', 'Значение', 'Имена: буквы, цифры и _, не с цифры и без повторов'],
    ar: ['الصق إعداد JSON أو أمر npx/uvx أو رابط HTTPS للتعبئة التلقائية…', 'تعرّف تلقائي', 'متغيرات البيئة (اختياري)', 'مفتاح المصادقة (اختياري)', 'مطلوب', 'اختياري', 'طريقة التثبيت',
        'تم التعرّف — مُلئت الحقول أدناه', 'تعذّر التعرّف. الصق إعداد JSON أو أمرًا أو رابط HTTPS', 'إضافة متغير', 'حذف المتغير', 'القيمة', 'الأسماء: أحرف وأرقام و _ فقط، لا تبدأ برقم ولا تتكرر'],
    hi: ['ऑटो-फ़िल के लिए JSON कॉन्फ़िग, npx/uvx कमांड या HTTPS URL पेस्ट करें…', 'ऑटो-पहचान', 'एनवायरनमेंट वेरिएबल (वैकल्पिक)', 'प्रमाणीकरण कुंजी (वैकल्पिक)', 'आवश्यक', 'वैकल्पिक', 'इंस्टॉल तरीका',
        'पहचान लिया — नीचे के फ़ील्ड भर दिए गए', 'पहचान नहीं हुई। JSON कॉन्फ़िग, कमांड या HTTPS URL पेस्ट करें', 'वेरिएबल जोड़ें', 'वेरिएबल हटाएँ', 'मान', 'नाम में केवल अक्षर, अंक और _ हों, अंक से शुरू न हों और दोहराए न जाएँ']
};

/** One editable environment variable; the id keeps React rows stable while a key is being typed. */
interface McpEnvRow { readonly id: number; readonly key: string; readonly value: string }
let mcpEnvRowSeed = 0;
function mcpEnvRows(env: Readonly<Record<string, string>> | undefined): McpEnvRow[] {
    return Object.entries(env || {}).map(([key, value]) => ({ id: ++mcpEnvRowSeed, key, value }));
}
const MCP_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
/** A value under a name like *_KEY or *TOKEN is masked as it is typed. */
const MCP_SECRET_ENV_KEY = /(?:KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL)/i;


function mcpRestartText(locale: NextMuxDesktopLocale, fallback: string): string {
    const copy: Readonly<Partial<Record<NextMuxDesktopLocale, string>>> = {
        'zh-CN': '重新启动', 'zh-TW': '重新啟動', en: 'Restart', ja: '再起動', ko: '다시 시작',
        fr: 'Redémarrer', de: 'Neu starten', es: 'Reiniciar', 'pt-BR': 'Reiniciar', ru: 'Перезапустить', ar: 'إعادة التشغيل', hi: 'पुनः आरंभ'
    };
    return copy[locale] || fallback;
}

function mcpDetailsText(locale: NextMuxDesktopLocale, server: McpServerAccess): string {
    // The manager intentionally returns a redacted summary. Keep raw details
    // out of the card while retaining it as a tooltip for diagnostics.
    try {
        const detail = JSON.parse(server.details) as Record<string, unknown>;
        if (server.local) {
            const args = typeof detail.args === 'number' ? detail.args : typeof detail.arguments === 'number' ? detail.arguments : undefined;
            return args === undefined ? mcpTransportText(locale, true) : `${mcpTransportText(locale, true)} · ${mcpCountText(locale, 'args', args)}`;
        }
        const headers = typeof detail.headers === 'number' ? detail.headers : undefined;
        return headers === undefined ? mcpTransportText(locale, false) : `${mcpTransportText(locale, false)} · ${mcpCountText(locale, 'headers', headers)}`;
    } catch {
        return mcpTransportText(locale, server.local);
    }
}

function McpToolList({ server, locale, blocked, update }: { server: McpServerAccess; locale: NextMuxDesktopLocale; blocked: boolean;
    update: (tools: McpServerAccess['tools']) => void }): React.ReactElement {
    const [query, setQuery] = React.useState('');
    const [limit, setLimit] = React.useState(24);
    const [expanded, setExpanded] = React.useState(!server.tools.some(tool => tool.approved));
    const t = labels[locale], d = diagnosticCopy[locale];
    const matches = server.tools.filter(tool => `${tool.name} ${tool.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    return <details className='nmx-mcp-tools' open={expanded || Boolean(query)} onToggle={event => setExpanded(event.currentTarget.open)}>
        <summary><span>{t[7]}</span><small>{server.tools.filter(tool => tool.approved).length}/{server.tools.length}</small></summary>
        <fieldset disabled={blocked} aria-label={t[7]}>
            <button type='button' disabled={!server.tools.some(tool => tool.supported && !tool.approved)} onClick={() => update(server.tools.filter(tool => tool.supported))}>{connectionCopy[locale][2]}</button>
            {server.tools.length > 24 && <input type='search' aria-label={d[9]} placeholder={d[9]} value={query} onChange={event => { setQuery(event.currentTarget.value); setLimit(24); }} />}
            {query && <small>{matches.length} / {server.tools.length}</small>}
            {matches.slice(0, limit).map(tool => <label key={tool.name} title={tool.supported ? tool.description : t[8]}>
                <input type='checkbox' checked={tool.approved} disabled={!tool.supported} onChange={event => update(server.tools.filter(item => item.name === tool.name ? event.currentTarget.checked : item.approved))} />
                <span><strong>{tool.name}</strong><small>{tool.supported ? tool.description : t[8]}</small></span>
            </label>)}
            {matches.length > limit && <button type='button' onClick={() => setLimit(value => value + 24)}>{d[10]} ({matches.length - limit})</button>}
            {server.toolsTruncated && <small>{d[11]}</small>}
            <small>{t[9]}</small>
        </fieldset>
    </details>;
}

export function McpAccessPanel(props: {
    readonly initialQuery?: string;
    readonly onInitialQueryConsumed?: () => void;
    locale: NextMuxDesktopLocale; service: NextMuxPlatformService;
    addServer: (name: string, configuration: McpServerConfiguration) => Promise<void>;
    editableConfiguration?: (name: string) => McpServerConfiguration | undefined;
    updateServer?: (name: string, configuration: McpServerConfiguration) => Promise<void>;
    changeCredential: (change: McpCredentialChange) => Promise<readonly McpServerAccess[]>;
    credentialConfigurable: (name: string) => boolean;
    notifications?: MCPFrontendNotificationService;
    onChange: () => void;
    /** GitHub's MCP registry; when present the directory is listed below the installed servers. */
    loadRegistry?: (force?: boolean) => Promise<McpRegistryState>;
    openExternal?: (url: string) => void;
}): React.ReactElement {
    const t = labels[props.locale];
    const [servers, setServers] = React.useState<readonly McpServerAccess[]>([]);
    const [busy, setBusy] = React.useState(false);
    const [pendingServer, setPendingServer] = React.useState<string>();
    const operation = React.useRef<'change' | 'revoke' | undefined>();
    const revision = React.useRef(0);
    const [error, setError] = React.useState<boolean | McpFormIssue>(false);
    const [adding, setAdding] = React.useState(false);
    const [editing, setEditing] = React.useState<string>();
    const [query, setQuery] = React.useState(props.initialQuery || '');
    React.useEffect(() => { props.onInitialQueryConsumed?.(); }, []);
    const [name, setName] = React.useState('');
    const [local, setLocal] = React.useState(false);
    const [address, setAddress] = React.useState('');
    const [args, setArgs] = React.useState('');
    const [credentialServer, setCredentialServer] = React.useState<string>();
    const [credentialNotice, setCredentialNotice] = React.useState<'saved' | 'failed'>();
    const [accessReady, setAccessReady] = React.useState(false);
    const refresh = React.useRef<ReturnType<typeof createMcpAccessRefresh>>();
    const [expandedServers, setExpandedServers] = React.useState<ReadonlySet<string>>(new Set());
    const [registryHint, setRegistryHint] = React.useState('');
    /** A directory entry that declares a secret (an API key header) opens its credential editor once added. */
    const [credentialAfterAdd, setCredentialAfterAdd] = React.useState(false);
    const [envRows, setEnvRows] = React.useState<readonly McpEnvRow[]>([]);
    /** The name the last recognition filled in; a later paste may replace it, a typed name is kept. */
    const [autoName, setAutoName] = React.useState('');
    const [smartState, setSmartState] = React.useState<'recognized' | 'unrecognized'>();
    const [pickFields, setPickFields] = React.useState<readonly McpInputFieldSpec[]>([]);
    const [fieldValues, setFieldValues] = React.useState<Readonly<Record<string, string>>>({});
    const [pickOptions, setPickOptions] = React.useState<readonly McpRegistryInstallOption[]>([]);
    const [inlineAuthKind, setInlineAuthKind] = React.useState<'bearer' | 'x-api-key' | 'api-key'>('bearer');
    const [inlineAuthToken, setInlineAuthToken] = React.useState('');
    const [smartInput, setSmartInput] = React.useState('');

    const applyAutoRecognized = (raw: string): boolean => {
        const recognized = parseMcpAutoRecognizedInput(raw);
        if (!recognized) return false;
        if (!editing && recognized.name && (!name.trim() || name === autoName)) { setName(recognized.name); setAutoName(recognized.name); }
        setLocal(recognized.local);
        setAddress(recognized.address);
        setArgs(recognized.local ? formatMcpArguments(recognized.args) : '');
        if (recognized.local && recognized.env && Object.keys(recognized.env).length > 0) setEnvRows(mcpEnvRows(recognized.env));
        if (!recognized.local) {
            if (recognized.authKind) setInlineAuthKind(recognized.authKind);
            if (recognized.authToken) setInlineAuthToken(recognized.authToken);
        }
        setError(false);
        return true;
    };

    const applyInstallOption = (option: McpRegistryInstallOption): void => {
        const configuration = option.configuration;
        setLocal('command' in configuration);
        setAddress('command' in configuration ? configuration.command : configuration.serverUrl);
        setArgs('command' in configuration ? formatMcpArguments(configuration.args) : '');
        setEnvRows('command' in configuration ? mcpEnvRows(configuration.env) : []);
        const initialFields = option.fields || [];
        setPickFields(initialFields);
        const defaults: Record<string, string> = {};
        for (const f of initialFields) {
            if (f.defaultValue) defaults[f.key] = f.defaultValue;
        }
        setFieldValues(defaults);
        setCredentialAfterAdd(option.kind === 'remote' && option.secrets.length > 0);
        setInlineAuthKind(option.defaultAuthKind || 'bearer');
        setInlineAuthToken('');
        setError(false);
    };

    /** A directory pick fills the add form; the person still reviews and adds it. */
    const openPrefilled = (pick: McpRegistryPick): void => {
        const configuration = pick.configuration;
        setEditing(undefined); setName(pick.name); setAutoName(pick.name);
        setLocal('command' in configuration);
        setAddress('command' in configuration ? configuration.command : configuration.serverUrl);
        setArgs('command' in configuration ? formatMcpArguments(configuration.args) : '');
        setEnvRows('command' in configuration ? mcpEnvRows(configuration.env) : []);
        const initialFields = pick.fields || [];
        setPickFields(initialFields);
        const defaults: Record<string, string> = {};
        for (const f of initialFields) {
            if (f.defaultValue) defaults[f.key] = f.defaultValue;
        }
        setFieldValues(defaults);
        setPickOptions(pick.options || []);
        setInlineAuthKind(pick.defaultAuthKind || 'bearer');
        setInlineAuthToken('');
        setSmartInput(''); setSmartState(undefined);
        setRegistryHint(pick.hint);
        setCredentialAfterAdd(pick.requiresAuth === true);
        setCredentialServer(undefined); setCredentialNotice(undefined); setError(false); setAdding(true);
        requestAnimationFrame(() => document.querySelector('.nmx-mcp-form')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    };
    const openEditor = (serverName?: string): void => {
        setRegistryHint(''); setCredentialAfterAdd(false);
        setPickFields([]); setFieldValues({}); setPickOptions([]); setInlineAuthToken(''); setSmartInput(''); setSmartState(undefined); setAutoName('');
        const config = serverName ? props.editableConfiguration?.(serverName) : undefined;
        if (serverName && (!config || !props.updateServer)) return;
        setEditing(serverName); setName(serverName || '');
        setLocal(config ? 'command' in config : false);
        setAddress(config ? 'command' in config ? config.command : config.serverUrl : '');
        setArgs(config && 'command' in config ? formatMcpArguments(config.args) : '');
        setEnvRows(config && 'command' in config ? mcpEnvRows(config.env) : []);
        setCredentialServer(undefined); setCredentialNotice(undefined); setError(false); setAdding(true);
    };
    const perform = async (action: () => Promise<readonly McpServerAccess[]>, revoke = false, serverName?: string): Promise<boolean> => {
        // Revocation must not wait for a tool-list or grant RPC. Its newer revision
        // also prevents an older response from restoring stale permissions in the UI.
        if (operation.current && (!revoke || operation.current === 'revoke')) return false;
        const current = ++revision.current;
        const accessVersion = refresh.current?.version;
        operation.current = revoke ? 'revoke' : 'change'; setPendingServer(serverName); setBusy(true); setError(false);
        try { const next = await action(); if (current === revision.current) {
            if (refresh.current?.version === accessVersion) { setServers(next); setAccessReady(true); } else refresh.current?.refresh();
            if (!revoke && serverName) setExpandedServers(previous => new Set(previous).add(serverName));
            props.onChange(); return true;
        } }
        catch (failure) { if (current === revision.current) {
            if (serverName) setExpandedServers(previous => new Set(previous).add(serverName));
            setError(mcpKnownFormError(failure) || true); refresh.current?.refresh();
        } }
        finally { if (current === revision.current) { operation.current = undefined; setPendingServer(undefined); setBusy(false); } }
        return false;
    };
    React.useEffect(() => {
        const reader = createMcpAccessRefresh({ load: () => props.service.getMcpAccess(),
            invalidate: () => { setAccessReady(false); setCredentialServer(undefined); setServers(current => current.map(server => ({ ...server, approved: false, running: false, tools: [] }))); },
            accept: next => { setServers(next); setAccessReady(true); }, failed: () => { setAccessReady(false); setError(true); } });
        refresh.current = reader;
        const subscription = props.notifications?.onDidUpdateMCPServers(() => reader.refresh());
        reader.refresh();
        return () => { subscription?.dispose(); reader.dispose(); refresh.current = undefined; ++revision.current; operation.current = undefined; };
    }, [props.service, props.notifications]);
    const blocked = busy || !accessReady;
    let parsedArguments: string[] | undefined;
    try { parsedArguments = parseMcpArguments(args); } catch { /* Invalid JSON is explained beside the field. */ }
    // Blank rows are ignored; a row with a value needs a valid, unique name.
    const filledEnvRows = envRows.filter(row => row.key.trim() || row.value.trim());
    const invalidEnvRows = new Set(filledEnvRows.filter((row, index) => !MCP_ENV_KEY.test(row.key.trim())
        || filledEnvRows.findIndex(other => other.key.trim() === row.key.trim()) !== index).map(row => row.id));
    const mergedEnv: Record<string, string> = Object.fromEntries(filledEnvRows.filter(row => !invalidEnvRows.has(row.id)).map(row => [row.key.trim(), row.value.trim()]));
    if (local) {
        // A directory entry's named variables win over a free row with the same name.
        for (const f of pickFields) if (f.target === 'env' && fieldValues[f.key]?.trim()) mergedEnv[f.key] = fieldValues[f.key].trim();
    }
    const missingRequiredField = pickFields.some(f => f.required && (f.target === 'env' ? !mergedEnv[f.key]?.trim() : !fieldValues[f.key]?.trim()));
    const formIssues = validateMcpServerForm({ name, local, address, args: parsedArguments, env: mergedEnv }, servers.map(server => server.name), editing);
    const invalidForm = Object.keys(formIssues).length > 0 || missingRequiredField || (local && invalidEnvRows.size > 0);
    const visibleServers = servers.filter(server => server.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    const sCopy = smartFormCopy[props.locale] || smartFormCopy.en;
    return <section className='nmx-mcp-access' aria-busy={busy} dir={props.locale === 'ar' ? 'rtl' : undefined} data-nmx-literal>
        <header className='nmx-mcp-heading'>
            <div><h3>{t[0]}</h3><p className='nmx-settings-note'>{connectionCopy[props.locale][0]}</p></div>
        </header>
        <div className='nmx-mcp-toolbar'>
            <input type='search' className='nmx-mcp-search' aria-label={serviceCopy[props.locale][0]} placeholder={serviceCopy[props.locale][0]} value={query} onChange={event => setQuery(event.currentTarget.value)} />
            <button type='button' disabled={busy} onClick={() => { setError(false); refresh.current?.refresh(); }}>{diagnosticCopy[props.locale][12]}</button>
            <button type='button' disabled={blocked} onClick={() => openEditor()}>{t[11]}</button>
        </div>
        {error && !credentialNotice && <p role='alert'>{typeof error === 'string' ? mcpFormText(props.locale, error) : t[10]}</p>}
        {credentialNotice && <p role={credentialNotice === 'failed' ? 'alert' : 'status'}>{mcpCredentialText(props.locale, credentialNotice)}</p>}
        {adding && <form className='nmx-mcp-form' noValidate onSubmit={event => { event.preventDefault(); if (blocked || invalidForm) return; void perform(async () => {
            const serverName = name.trim();
            const baseArgs = local ? parseMcpArguments(args) : [];
            const extraArgs: string[] = [];
            if (local) {
                for (const f of pickFields) {
                    const val = fieldValues[f.key]?.trim();
                    if (f.target === 'arg' && val) {
                        if (f.argFlag) extraArgs.push(f.argFlag, val);
                        else extraArgs.push(val);
                    }
                }
            }
            const finalArgs = [...baseArgs, ...extraArgs];
            const hasEnv = local && Object.keys(mergedEnv).length > 0;
            const configuration: McpServerConfiguration = local
                ? { command: address.trim(), args: finalArgs, ...(hasEnv ? { env: mergedEnv } : {}) }
                : { serverUrl: address.trim() };
            const pendingToken = !local && !editing ? inlineAuthToken.trim() : '';
            const pendingAuthKind = inlineAuthKind;
            if (editing) {
                if (!props.updateServer) throw new Error('MCP_CONFIG_NOT_EDITABLE');
                await props.updateServer(editing, configuration);
            } else await props.addServer(serverName, configuration);
            setAdding(false); setEditing(undefined); setName(''); setAutoName(''); setAddress(''); setArgs(''); setEnvRows([]);
            setPickFields([]); setFieldValues({}); setPickOptions([]); setInlineAuthToken(''); setSmartInput(''); setSmartState(undefined);
            let next = await props.service.getMcpAccess();
            if (editing) return next;
            let added = next.find(server => server.name === serverName);
            if (!added || added.needsReview) throw new Error('MCP_CONFIGURATION_REVIEW_REQUIRED');
            // If user provided an inline remote authentication token during add, store it in secure credentials before starting.
            if (pendingToken && added.credentialEditable === true && props.credentialConfigurable(serverName)) {
                try {
                    next = await props.changeCredential({
                        serverName,
                        fingerprint: added.fingerprint,
                        action: 'set',
                        kind: pendingAuthKind,
                        value: pendingToken
                    });
                    added = next.find(server => server.name === serverName) || added;
                } catch { /* Fall back to post-start credential editor if keychain save fails. */ }
            }
            // The form explicitly says Add and connect. This grants this
            // connection only; tool schemas still require their own selection.
            const needsCredential = credentialAfterAdd && !pendingToken;
            setCredentialAfterAdd(false);
            try {
                const started = await props.service.changeMcpAccess({ serverName, fingerprint: added.fingerprint, action: 'start' });
                if (needsCredential && started.find(server => server.name === serverName)?.credentialEditable === true) setCredentialServer(serverName);
                return started;
            } catch (failure) {
                // A server that answers 401/403 (or whose directory entry declares a secret) opens its credential
                // editor; its row already shows the authentication failure, so this is not a dead-end error.
                if (!needsCredential && !/^MCP_(?:START_FAILED_AUTHENTICATION|AUTHENTICATION_REQUIRED)$/.test(failure instanceof Error ? failure.message : '')) throw failure;
                const latest = await props.service.getMcpAccess();
                if (latest.find(server => server.name === serverName)?.credentialEditable !== true) throw failure;
                setCredentialServer(serverName);
                return latest;
            }
        }, false, name.trim()); }}>
            <strong className='nmx-mcp-form-title'>{editing ? `${serviceCopy[props.locale][4]} · ${editing}` : t[11]}</strong>
            {!editing && <div className={`nmx-mcp-smart-bar${smartState ? ` is-${smartState}` : ''}`}>
                <i className='codicon codicon-sparkle' aria-hidden='true' />
                <input type='text' value={smartInput} placeholder={sCopy[0]} aria-label={sCopy[0]} aria-describedby={smartState ? 'nmx-mcp-smart-state' : undefined}
                    disabled={busy} spellCheck={false} autoComplete='off'
                    onPaste={event => {
                        // A paste is a whole configuration: recognise it at once instead of on every keystroke.
                        const pasted = event.clipboardData.getData('text');
                        if (!pasted.trim()) return;
                        event.preventDefault();
                        const recognized = applyAutoRecognized(pasted);
                        setSmartInput(recognized ? '' : pasted); setSmartState(recognized ? 'recognized' : 'unrecognized');
                    }}
                    onKeyDown={event => {
                        if (event.key !== 'Enter' || event.nativeEvent.isComposing || !smartInput.trim()) return;
                        event.preventDefault();
                        const recognized = applyAutoRecognized(smartInput);
                        if (recognized) setSmartInput('');
                        setSmartState(recognized ? 'recognized' : 'unrecognized');
                    }}
                    onChange={event => { setSmartInput(event.currentTarget.value); setSmartState(undefined); }} />
                <button type='button' disabled={busy || !smartInput.trim()} onClick={() => {
                    const recognized = applyAutoRecognized(smartInput);
                    if (recognized) setSmartInput('');
                    setSmartState(recognized ? 'recognized' : 'unrecognized');
                }}>{sCopy[1]}</button>
                {smartState && <small id='nmx-mcp-smart-state' role='status'><i className={`codicon codicon-${smartState === 'recognized' ? 'check' : 'warning'}`} aria-hidden='true' />
                    {smartState === 'recognized' ? sCopy[7] : sCopy[8]}</small>}
            </div>}
            {!editing && <p className='nmx-settings-note'>{registryHint || connectionCopy[props.locale][3]}</p>}
            {pickOptions.length > 1 && <div className='nmx-mcp-option-pills' role='group' aria-label={sCopy[6]}>
                <span>{sCopy[6]}</span>
                <div>{pickOptions.map(opt => {
                    const active = (opt.kind === 'remote') === !local && (opt.kind === 'remote' || ('command' in opt.configuration && opt.configuration.command === address));
                    return <button key={opt.kind} type='button' className={active ? 'is-active' : ''} aria-pressed={active} disabled={busy} onClick={() => applyInstallOption(opt)}>
                        {opt.kind === 'remote' ? mcpTransportText(props.locale, false) : opt.kind}</button>;
                })}</div>
            </div>}
            <label>{mcpFormText(props.locale, 'nameLabel')}<input required value={name} maxLength={64} placeholder='my-mcp' spellCheck={false} autoComplete='off' aria-invalid={Boolean(name && formIssues.name)} aria-describedby='nmx-mcp-name-hint' disabled={busy || Boolean(editing)} onChange={event => { setName(event.currentTarget.value); setError(false); }} />
                <small id='nmx-mcp-name-hint' role='status'>{mcpFormText(props.locale, formIssues.name || 'nameRule')}</small></label>
            <label><span>{mcpTransportLabel(props.locale)}</span><select disabled={busy} value={local ? 'local' : 'remote'} aria-label={mcpTransportLabel(props.locale)} onChange={event => { setLocal(event.currentTarget.value === 'local'); setAddress(''); setError(false); }}><option value='remote'>{t[14]}</option><option value='local'>{t[13]}</option></select></label>
            <label className='nmx-mcp-long-field'>{t[local ? 13 : 14]}<input required value={address} maxLength={2048} placeholder={local ? 'npx' : 'https://example.com/mcp'} aria-invalid={Boolean(address && formIssues.address)} aria-describedby='nmx-mcp-address-hint' disabled={busy} spellCheck={false} autoComplete='off' dir='ltr'
                onPaste={event => {
                    // A whole JSON block or command pasted here fills the form the same way as the bar above.
                    const pasted = event.clipboardData.getData('text').trim();
                    if (!(pasted.startsWith('{') || /\s/.test(pasted)) || !applyAutoRecognized(pasted)) return;
                    event.preventDefault();
                    setSmartState('recognized');
                }}
                onChange={event => { setAddress(event.currentTarget.value); setError(false); }} />
                <small id='nmx-mcp-address-hint' role='status'>{mcpFormText(props.locale, local ? 'commandRule' : 'urlRule')}</small></label>
            {local && <label className='nmx-mcp-long-field'>{serviceCopy[props.locale][3]}<textarea value={args} maxLength={8000} rows={3} placeholder={'-y\n@modelcontextprotocol/server-filesystem'} aria-invalid={Boolean(formIssues.args)} aria-describedby={formIssues.args ? 'nmx-mcp-args-error' : undefined} disabled={busy} spellCheck={false} dir='ltr' onChange={event => { setArgs(event.currentTarget.value); setError(false); }} />
                {formIssues.args && <small id='nmx-mcp-args-error' role='status'>{mcpFormText(props.locale, formIssues.args)}</small>}</label>}
            {(pickFields.length > 0 || local || !editing) && <div className='nmx-mcp-form-extra'>
                {pickFields.length > 0 && <div className='nmx-mcp-dynamic-fields'>
                    {pickFields.map(field => {
                        const id = `nmx-mcp-field-${field.target}-${field.key.replace(/[^A-Za-z0-9_-]/g, '_')}`;
                        return <div key={`${field.target}:${field.key}`} className='nmx-mcp-dynamic-field'>
                            <label className='nmx-mcp-dynamic-field-head' htmlFor={id}>
                                <strong dir='auto'>{field.label}</strong>
                                <small className={field.required ? 'is-required' : ''}>{field.required ? sCopy[4] : sCopy[5]}</small>
                            </label>
                            <input id={id} type={field.secret ? 'password' : 'text'} value={fieldValues[field.key] ?? ''} placeholder={field.placeholder || field.defaultValue || field.key}
                                aria-invalid={field.required && !fieldValues[field.key]?.trim() ? true : undefined} disabled={busy} spellCheck={false} dir='ltr'
                                autoComplete={field.secret ? 'new-password' : 'off'} onChange={event => {
                                    const val = event.currentTarget.value;
                                    setFieldValues(prev => ({ ...prev, [field.key]: val }));
                                    setError(false);
                                }} />
                            {field.description && field.description !== field.label && <small dir='auto'>{field.description}</small>}
                        </div>;
                    })}
                </div>}
                {local && <div className='nmx-mcp-env-field' role='group' aria-label={sCopy[2]}>
                    <span>{sCopy[2]}</span>
                    {envRows.map(row => <div key={row.id} className='nmx-mcp-env-row'>
                        <input type='text' value={row.key} placeholder='API_KEY' aria-label={`${sCopy[2]} · KEY`} aria-invalid={invalidEnvRows.has(row.id) || undefined}
                            disabled={busy} spellCheck={false} autoComplete='off' dir='ltr'
                            onPaste={event => {
                                // Several KEY=VALUE lines pasted into a name become rows.
                                const pasted = event.clipboardData.getData('text');
                                if (!pasted.includes('=')) return;
                                let parsed: Record<string, string>;
                                try { parsed = parseMcpEnvironment(pasted); } catch { return; }
                                if (!Object.keys(parsed).length) return;
                                event.preventDefault();
                                setEnvRows(rows => [...rows.filter(item => item.id !== row.id && (item.key.trim() || item.value.trim()) && !Object.prototype.hasOwnProperty.call(parsed, item.key.trim())), ...mcpEnvRows(parsed)]);
                            }}
                            onChange={event => { const key = event.currentTarget.value; setEnvRows(rows => rows.map(item => item.id === row.id ? { ...item, key } : item)); setError(false); }} />
                        <input type={MCP_SECRET_ENV_KEY.test(row.key) ? 'password' : 'text'} value={row.value} placeholder={sCopy[11]} aria-label={`${row.key || sCopy[2]} · ${sCopy[11]}`}
                            disabled={busy} spellCheck={false} autoComplete={MCP_SECRET_ENV_KEY.test(row.key) ? 'new-password' : 'off'} dir='ltr'
                            onChange={event => { const value = event.currentTarget.value; setEnvRows(rows => rows.map(item => item.id === row.id ? { ...item, value } : item)); setError(false); }} />
                        <button type='button' className='nmx-mcp-env-remove' aria-label={`${sCopy[10]}${row.key ? ` ${row.key}` : ''}`} title={sCopy[10]} disabled={busy}
                            onClick={() => setEnvRows(rows => rows.filter(item => item.id !== row.id))}><i className='codicon codicon-close' aria-hidden='true' /></button>
                    </div>)}
                    {invalidEnvRows.size > 0 && <small className='is-invalid' role='status'>{sCopy[12]}</small>}
                    <button type='button' className='nmx-mcp-env-add' disabled={busy || envRows.length >= 64}
                        onClick={() => setEnvRows(rows => [...rows, ...mcpEnvRows({ '': '' })])}><i className='codicon codicon-add' aria-hidden='true' />{sCopy[9]}</button>
                </div>}
                {!local && !editing && <div className='nmx-mcp-inline-auth'>
                    <div className='nmx-mcp-inline-auth-head'>
                        <span>{sCopy[3]}</span>
                        <div className='nmx-mcp-option-pills' role='group' aria-label={sCopy[3]}>
                            {(['bearer', 'x-api-key', 'api-key'] as const).map(kind => <button key={kind} type='button' className={inlineAuthKind === kind ? 'is-active' : ''} aria-pressed={inlineAuthKind === kind}
                                disabled={busy} onClick={() => setInlineAuthKind(kind)}>{kind === 'bearer' ? 'Bearer' : kind}</button>)}
                        </div>
                    </div>
                    <input type='password' value={inlineAuthToken} maxLength={2048} placeholder={mcpCredentialText(props.locale, 'secret')} aria-label={`${sCopy[3]} · ${inlineAuthKind === 'bearer' ? 'Bearer' : inlineAuthKind}`}
                        disabled={busy} spellCheck={false} autoComplete='new-password' dir='ltr' onChange={event => { setInlineAuthToken(event.currentTarget.value); setError(false); }} />
                </div>}
            </div>}
            <div className='nmx-settings-actions'><button type='submit' disabled={blocked || invalidForm}>{editing ? t[16] : connectionCopy[props.locale][1]}</button><button type='button' disabled={busy} onClick={() => setAdding(false)}>{t[17]}</button></div>
        </form>}
        {accessReady && !servers.length && <p>{t[6]}</p>}
        {accessReady && servers.length > 0 && !visibleServers.length && <p>{serviceCopy[props.locale][1]}</p>}
        <div className='nmx-mcp-server-list'>
        {visibleServers.map(server => {
            const status = mcpStatus(props.locale, server);
            const copy = detailCopy[props.locale];
            const expanded = expandedServers.has(server.name);
            const detailsId = `nmx-mcp-details-${encodeURIComponent(server.name)}`;
            const restart = server.approved && !server.running;
            const pending = mcpStartupPending(server, pendingServer === server.name && busy);
            const action = pending ? 'revoke' : restart || !server.approved ? 'start' : 'revoke';
            const stopping = pendingServer === server.name && busy && operation.current === 'revoke';
            const actionLabel = pending ? t[5] : server.needsReview && !server.approved ? t[3] : restart ? mcpRestartText(props.locale, t[4]) : t[action === 'revoke' ? 5 : 4];
            const statusLabel = status.tone === 'error' ? copy[12] : server.diagnostic === 'authorization' ? copy[10]
                : server.diagnostic === 'tools' ? copy[11] : server.diagnostic === 'ready' ? copy[13] : status.label;
            return <article key={server.name} className='nmx-mcp-server'>
            {/* Cline ServerRow's compact disclosure pattern, adapted to the existing access RPC.
                Reference: cline/cline@254f40c4b592d1e662b84f2ba06fe45dca77cab3 (Apache-2.0). */}
            <header className='nmx-mcp-server-heading'>
                <button className='nmx-mcp-server-toggle' aria-expanded={expanded} aria-controls={detailsId} aria-label={`${server.name}: ${copy[0]}`} onClick={() => setExpandedServers(previous => {
                    const next = new Set(previous); if (next.has(server.name)) next.delete(server.name); else next.add(server.name); return next;
                })}><i className={`codicon codicon-chevron-${expanded ? 'down' : 'right'}`} aria-hidden='true' /><strong title={server.name}>{server.name}</strong></button>
                <span className={`nmx-mcp-status nmx-mcp-status-${status.tone}`} title={status.label} role='status'><i aria-hidden='true' /><span>{statusLabel}</span></span>
                <button className='nmx-mcp-server-action' title={actionLabel} aria-label={`${server.name}: ${actionLabel}`} disabled={stopping || (!pending && (!accessReady || busy))} onClick={() => void perform(() => action !== 'revoke' && !server.approved && server.needsReview ? props.service.reviewMcpAccess(server.name)
                    : props.service.changeMcpAccess({ serverName: server.name, fingerprint: server.fingerprint, action }).catch(async failure => {
                        // Starting a server that wants credentials opens its editor rather than only an error line.
                        if (action !== 'start' || server.credentialEditable !== true
                            || !/^MCP_(?:START_FAILED_AUTHENTICATION|AUTHENTICATION_REQUIRED)$/.test(failure instanceof Error ? failure.message : '')) throw failure;
                        setCredentialServer(server.name);
                        return props.service.getMcpAccess();
                    }), action === 'revoke', server.name)}>{action === 'revoke' ? copy[9] : actionLabel}</button>
            </header>
            <div id={detailsId} className='nmx-mcp-server-body' hidden={!expanded}>
            {(server.failure || server.diagnostic === 'tools' || server.needsReview) && <p className='nmx-mcp-guidance'>{status.label}</p>}
            {server.failure && <McpFailureDetails locale={props.locale} failure={server.failure} />}
            <details className='nmx-mcp-connection' open={credentialServer === server.name || server.failure?.code === 'authentication' || server.diagnostic === 'authentication' || undefined}><summary>{serviceCopy[props.locale][2]}</summary>
                <div className='nmx-mcp-connection-info'>{!server.local && (() => {
                    const editableConfig = props.editableConfiguration?.(server.name);
                    const connectionDisplay = editableConfig && 'serverUrl' in editableConfig ? editableConfig.serverUrl : server.connection;
                    return <span dir='ltr'>{connectionDisplay}</span>;
                })()}<small>{mcpDetailsText(props.locale, server)}</small>
                {props.updateServer && props.editableConfiguration?.(server.name) && <button disabled={blocked} onClick={() => openEditor(server.name)}>{serviceCopy[props.locale][4]}</button>}</div>
            {server.credentialEditable === true && <div className='nmx-mcp-auth-summary' hidden={credentialServer === server.name}>
                <span><bdi dir='ltr'>{server.credential ? `${server.credential.kind === 'bearer' ? 'Bearer' : server.credential.kind} · ${mcpCredentialText(props.locale, 'configured')}` : mcpCredentialText(props.locale, 'none')}</bdi></span>
                {props.credentialConfigurable(server.name) ? <button disabled={blocked} onClick={() => { setAdding(false); setCredentialNotice(undefined); setCredentialServer(credentialServer === server.name ? undefined : server.name); }}>{mcpCredentialText(props.locale, 'authentication')}</button>
                    : <small>{mcpCredentialText(props.locale, 'userOnly')}</small>}
            </div>}
            {credentialServer === server.name && server.credentialEditable === true && props.credentialConfigurable(server.name) && <McpCredentialEditor key={`${server.name}:${server.fingerprint}`} server={server} locale={props.locale} busy={blocked}
                onCancel={() => setCredentialServer(undefined)} onSave={async change => {
                    const nextRevision = revision.current + 1;
                    setCredentialNotice(undefined);
                    const saved = await perform(async () => {
                        try { return await props.changeCredential(change); }
                        catch (error) {
                            // Rotation may have succeeded in secure storage while the
                            // preference write failed. Never show the old grants as active.
                            if (revision.current === nextRevision) refresh.current?.refresh();
                            throw error;
                        }
                    });
                    if (revision.current === nextRevision) { setCredentialNotice(saved ? 'saved' : 'failed'); if (saved) setCredentialServer(undefined); }
                    return saved;
            }} />}
            </details>
            {server.running && server.tools.length > 0 && <McpToolList server={server} locale={props.locale} blocked={blocked} update={selected => {
                void perform(() => props.service.changeMcpAccess({ serverName: server.name, fingerprint: server.fingerprint, action: 'tools', tools: selected.map(item => ({ name: item.name, fingerprint: item.fingerprint })) }));
            }} />}
            </div>
        </article>;
        })}
        </div>
        {props.loadRegistry && props.openExternal && <McpRegistryBrowser initialQuery={props.initialQuery} locale={props.locale} load={props.loadRegistry} disabled={blocked}
            existingNames={new Set(servers.map(server => server.name))} openExternal={props.openExternal} onPick={openPrefilled} />}
    </section>;
}
