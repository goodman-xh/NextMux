import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import type { McpInputFieldSpec, McpServerConfiguration } from '../common/nextmux-mcp-access';
import {
    builtInMcpCapability, filterMcpRegistry, MCP_REGISTRY_ORIGIN, suggestedMcpServerName,
    type McpRegistryEntry, type McpRegistryInstallKind, type McpRegistryInstallOption, type McpRegistryState
} from '../common/nextmux-mcp-registry';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

/** Browse GitHub's MCP registry and prefill the “Add MCP” form with a reviewed configuration. */

const text = {
    en: { title: 'MCP directory', search: 'Search MCP servers', add: 'Add', added: 'Added', manual: 'Manual setup', repo: 'Repository', loading: 'Loading the directory…', failed: 'Couldn’t reach GitHub or the NextMux mirror. Check your network or proxy settings, then refresh.', retry: 'Retry', more: 'Show more ({count} left)', empty: 'No matching MCP servers', source: 'MCP list from GitHub:', stale: 'Showing the last loaded list', remote: 'Hosted', npx: 'Needs Node.js', uvx: 'Needs uv (Python)', docker: 'Needs Docker', keyRemote: 'Needs {keys}. After adding, set it under Authentication.', keyLocal: 'Needs {keys} set as an environment variable before it starts.', review: 'Check the prefilled settings below, then add.', builtIn: 'Built in', builtInHint: 'NextMux already includes this. Nothing to install.', builtInGithub: 'Built in. Link GitHub in Settings → Account to use it.', builtInSummary: 'Built in, no install needed: Context7 library docs, draw.io diagrams and GitHub (link your account in Settings → Account).' },
    'zh-CN': { title: 'MCP 目录', search: '搜索 MCP 服务', add: '添加', added: '已添加', manual: '需手动配置', repo: '仓库', loading: '正在加载目录…', failed: 'GitHub 和 NextMux 镜像都连不上。请检查网络或代理设置，然后点“刷新”。', retry: '重试', more: '显示更多（剩余 {count} 个）', empty: '没有匹配的 MCP 服务', source: 'MCP 列表来源于 GitHub：', stale: '显示的是上次加载的列表', remote: '云端服务', npx: '需要 Node.js', uvx: '需要 uv（Python）', docker: '需要 Docker', keyRemote: '需要 {keys}，添加后在「认证」里填写。', keyLocal: '启动前需要把 {keys} 设为系统环境变量。', review: '已填好下方的添加表单，确认后点添加。', builtIn: '已内置', builtInHint: 'NextMux 已内置此能力，无需安装。', builtInGithub: '已内置，在「设置 → 账户」绑定 GitHub 后即可使用。', builtInSummary: '已内置、无需安装：Context7 文档查询、draw.io 图表、GitHub（在「设置 → 账户」绑定账号）。' },
    'zh-TW': { title: 'MCP 目錄', search: '搜尋 MCP 服務', add: '新增', added: '已新增', manual: '需手動設定', repo: '儲存庫', loading: '正在載入目錄…', failed: 'GitHub 和 NextMux 鏡像都連不上。請檢查網路或代理設定，然後點「重新整理」。', retry: '重試', more: '顯示更多（剩餘 {count} 個）', empty: '沒有符合的 MCP 服務', source: 'MCP 清單來源於 GitHub：', stale: '顯示的是上次載入的清單', remote: '雲端服務', npx: '需要 Node.js', uvx: '需要 uv（Python）', docker: '需要 Docker', keyRemote: '需要 {keys}，新增後在「驗證」中填寫。', keyLocal: '啟動前需要把 {keys} 設為系統環境變數。', review: '已填好下方的新增表單，確認後點新增。', builtIn: '已內建', builtInHint: 'NextMux 已內建此功能，無需安裝。', builtInGithub: '已內建，在「設定 → 帳戶」綁定 GitHub 後即可使用。', builtInSummary: '已內建、無需安裝：Context7 文件查詢、draw.io 圖表、GitHub（在「設定 → 帳戶」綁定帳號）。' },
    ja: { title: 'MCP ディレクトリ', search: 'MCP サーバーを検索', add: '追加', added: '追加済み', manual: '手動設定', repo: 'リポジトリ', loading: 'ディレクトリを読み込み中…', failed: 'GitHub にも NextMux ミラーにも接続できません。ネットワークやプロキシの設定を確認してから更新してください。', retry: '再試行', more: 'さらに表示（残り {count} 件）', empty: '一致する MCP サーバーはありません', source: 'MCP 一覧の出典 GitHub：', stale: '前回読み込んだ一覧を表示しています', remote: 'ホスト型', npx: 'Node.js が必要', uvx: 'uv（Python）が必要', docker: 'Docker が必要', keyRemote: '{keys} が必要です。追加後に「認証」で設定してください。', keyLocal: '起動前に {keys} を環境変数に設定してください。', review: '下の追加フォームに入力済みです。確認して追加してください。', builtIn: '組み込み済み', builtInHint: 'NextMux に組み込まれているため、インストールは不要です。', builtInGithub: '組み込み済み。「設定 → アカウント」で GitHub を連携すると使えます。', builtInSummary: 'インストール不要の組み込み機能：Context7 のドキュメント検索、draw.io の図、GitHub（「設定 → アカウント」で連携）。' },
    ko: { title: 'MCP 디렉터리', search: 'MCP 서버 검색', add: '추가', added: '추가됨', manual: '수동 설정', repo: '저장소', loading: '디렉터리를 불러오는 중…', failed: 'GitHub와 NextMux 미러에 모두 연결할 수 없습니다. 네트워크 또는 프록시 설정을 확인한 뒤 새로고침하세요.', retry: '다시 시도', more: '더 보기 ({count}개 남음)', empty: '일치하는 MCP 서버가 없습니다', source: 'MCP 목록 출처 GitHub:', stale: '마지막으로 불러온 목록입니다', remote: '호스팅', npx: 'Node.js 필요', uvx: 'uv(Python) 필요', docker: 'Docker 필요', keyRemote: '{keys}이(가) 필요합니다. 추가 후 인증에서 설정하세요.', keyLocal: '시작 전에 {keys}을(를) 환경 변수로 설정해야 합니다.', review: '아래 추가 양식을 채웠습니다. 확인 후 추가하세요.', builtIn: '기본 제공', builtInHint: 'NextMux에 기본 포함되어 있어 설치할 필요가 없습니다.', builtInGithub: '기본 제공. 설정 → 계정에서 GitHub를 연결하면 사용할 수 있습니다.', builtInSummary: '설치 없이 기본 제공: Context7 문서 검색, draw.io 다이어그램, GitHub(설정 → 계정에서 연결).' },
    es: { title: 'Directorio MCP', search: 'Buscar servidores MCP', add: 'Añadir', added: 'Añadido', manual: 'Configuración manual', repo: 'Repositorio', loading: 'Cargando el directorio…', failed: 'No se pudo conectar con GitHub ni con el espejo de NextMux. Revisa la red o el proxy y actualiza.', retry: 'Reintentar', more: 'Mostrar más (quedan {count})', empty: 'No hay servidores MCP coincidentes', source: 'Lista MCP de GitHub:', stale: 'Se muestra la última lista cargada', remote: 'Alojado', npx: 'Requiere Node.js', uvx: 'Requiere uv (Python)', docker: 'Requiere Docker', keyRemote: 'Requiere {keys}. Tras añadirlo, configúralo en Autenticación.', keyLocal: 'Requiere {keys} como variable de entorno antes de iniciarse.', review: 'El formulario de abajo ya está rellenado; revísalo y añádelo.', builtIn: 'Integrado', builtInHint: 'NextMux ya lo incluye. No hay nada que instalar.', builtInGithub: 'Integrado. Vincula GitHub en Ajustes → Cuenta para usarlo.', builtInSummary: 'Integrado, sin instalar: documentación de librerías de Context7, diagramas de draw.io y GitHub (vincula tu cuenta en Ajustes → Cuenta).' },
    fr: { title: 'Annuaire MCP', search: 'Rechercher des serveurs MCP', add: 'Ajouter', added: 'Ajouté', manual: 'Configuration manuelle', repo: 'Dépôt', loading: 'Chargement de l’annuaire…', failed: 'Impossible de joindre GitHub ou le miroir NextMux. Vérifiez le réseau ou le proxy, puis actualisez.', retry: 'Réessayer', more: 'Afficher plus ({count} restants)', empty: 'Aucun serveur MCP correspondant', source: 'Liste MCP issue de GitHub :', stale: 'Dernière liste chargée affichée', remote: 'Hébergé', npx: 'Nécessite Node.js', uvx: 'Nécessite uv (Python)', docker: 'Nécessite Docker', keyRemote: 'Nécessite {keys}. Après l’ajout, renseignez-le dans Authentification.', keyLocal: 'Nécessite {keys} en variable d’environnement avant le démarrage.', review: 'Le formulaire ci-dessous est prérempli : vérifiez-le puis ajoutez.', builtIn: 'Intégré', builtInHint: 'NextMux l’inclut déjà : rien à installer.', builtInGithub: 'Intégré. Associez GitHub dans Réglages → Compte pour l’utiliser.', builtInSummary: 'Intégré, sans installation : documentation Context7, diagrammes draw.io et GitHub (associez votre compte dans Réglages → Compte).' },
    de: { title: 'MCP-Verzeichnis', search: 'MCP-Server suchen', add: 'Hinzufügen', added: 'Hinzugefügt', manual: 'Manuelle Einrichtung', repo: 'Repository', loading: 'Verzeichnis wird geladen…', failed: 'Weder GitHub noch der NextMux-Spiegel ist erreichbar. Prüfe Netzwerk- oder Proxy-Einstellungen und aktualisiere dann.', retry: 'Erneut versuchen', more: 'Mehr anzeigen ({count} übrig)', empty: 'Keine passenden MCP-Server', source: 'MCP-Liste von GitHub:', stale: 'Zuletzt geladene Liste', remote: 'Gehostet', npx: 'Benötigt Node.js', uvx: 'Benötigt uv (Python)', docker: 'Benötigt Docker', keyRemote: 'Benötigt {keys}. Nach dem Hinzufügen unter Authentifizierung eintragen.', keyLocal: 'Benötigt {keys} als Umgebungsvariable vor dem Start.', review: 'Das Formular unten ist ausgefüllt; prüfen und hinzufügen.', builtIn: 'Integriert', builtInHint: 'NextMux enthält das bereits. Keine Installation nötig.', builtInGithub: 'Integriert. Verknüpfen Sie GitHub unter Einstellungen → Konto.', builtInSummary: 'Integriert, ohne Installation: Context7-Dokumentation, draw.io-Diagramme und GitHub (Konto unter Einstellungen → Konto verknüpfen).' },
    'pt-BR': { title: 'Diretório MCP', search: 'Pesquisar servidores MCP', add: 'Adicionar', added: 'Adicionado', manual: 'Configuração manual', repo: 'Repositório', loading: 'Carregando o diretório…', failed: 'Não foi possível acessar o GitHub nem o espelho do NextMux. Verifique a rede ou o proxy e atualize.', retry: 'Tentar novamente', more: 'Mostrar mais (restam {count})', empty: 'Nenhum servidor MCP correspondente', source: 'Lista MCP do GitHub:', stale: 'Mostrando a última lista carregada', remote: 'Hospedado', npx: 'Requer Node.js', uvx: 'Requer uv (Python)', docker: 'Requer Docker', keyRemote: 'Requer {keys}. Depois de adicionar, defina em Autenticação.', keyLocal: 'Requer {keys} como variável de ambiente antes de iniciar.', review: 'O formulário abaixo já foi preenchido; revise e adicione.', builtIn: 'Integrado', builtInHint: 'O NextMux já inclui isto. Nada para instalar.', builtInGithub: 'Integrado. Vincule o GitHub em Configurações → Conta para usar.', builtInSummary: 'Integrado, sem instalar: documentação do Context7, diagramas do draw.io e GitHub (vincule sua conta em Configurações → Conta).' },
    ru: { title: 'Каталог MCP', search: 'Поиск MCP-серверов', add: 'Добавить', added: 'Добавлено', manual: 'Ручная настройка', repo: 'Репозиторий', loading: 'Загрузка каталога…', failed: 'Нет связи ни с GitHub, ни с зеркалом NextMux. Проверьте сеть или прокси и обновите.', retry: 'Повторить', more: 'Показать ещё (осталось {count})', empty: 'Подходящих MCP-серверов нет', source: 'Список MCP с GitHub:', stale: 'Показан последний загруженный список', remote: 'Облачный', npx: 'Нужен Node.js', uvx: 'Нужен uv (Python)', docker: 'Нужен Docker', keyRemote: 'Нужен {keys}. После добавления укажите его в разделе «Аутентификация».', keyLocal: 'Перед запуском задайте {keys} как переменную окружения.', review: 'Форма ниже заполнена — проверьте и добавьте.', builtIn: 'Встроено', builtInHint: 'Уже есть в NextMux, устанавливать не нужно.', builtInGithub: 'Встроено. Привяжите GitHub в «Настройки → Аккаунт».', builtInSummary: 'Встроено, без установки: документация Context7, диаграммы draw.io и GitHub (привяжите аккаунт в «Настройки → Аккаунт»).' },
    ar: { title: 'دليل MCP', search: 'ابحث عن خوادم MCP', add: 'إضافة', added: 'تمت الإضافة', manual: 'إعداد يدوي', repo: 'المستودع', loading: 'جارٍ تحميل الدليل…', failed: 'تعذّر الوصول إلى GitHub أو مرآة NextMux. تحقّق من إعدادات الشبكة أو الوكيل ثم حدّث.', retry: 'إعادة المحاولة', more: 'عرض المزيد (متبقٍ {count})', empty: 'لا توجد خوادم MCP مطابقة', source: 'قائمة MCP من GitHub:', stale: 'يتم عرض آخر قائمة محمّلة', remote: 'مستضاف', npx: 'يتطلب Node.js', uvx: 'يتطلب uv (Python)', docker: 'يتطلب Docker', keyRemote: 'يتطلب {keys}. بعد الإضافة اضبطه في المصادقة.', keyLocal: 'يتطلب ضبط {keys} كمتغير بيئة قبل التشغيل.', review: 'تم ملء نموذج الإضافة أدناه؛ راجعه ثم أضِف.', builtIn: 'مدمج', builtInHint: 'مضمّن في NextMux، لا حاجة للتثبيت.', builtInGithub: 'مدمج. اربط GitHub من الإعدادات ← الحساب لاستخدامه.', builtInSummary: 'مدمج دون تثبيت: توثيق Context7 ومخططات draw.io وGitHub (اربط حسابك من الإعدادات ← الحساب).' },
    hi: { title: 'MCP निर्देशिका', search: 'MCP सर्वर खोजें', add: 'जोड़ें', added: 'जोड़ा गया', manual: 'मैन्युअल सेटअप', repo: 'रिपॉज़िटरी', loading: 'निर्देशिका लोड हो रही है…', failed: 'GitHub या NextMux मिरर तक नहीं पहुँच सके। नेटवर्क या प्रॉक्सी सेटिंग जाँचें, फिर रीफ़्रेश करें।', retry: 'फिर कोशिश करें', more: 'और दिखाएं ({count} बाकी)', empty: 'कोई मिलता-जुलता MCP सर्वर नहीं', source: 'MCP सूची GitHub से:', stale: 'पिछली लोड की गई सूची दिखाई जा रही है', remote: 'होस्टेड', npx: 'Node.js चाहिए', uvx: 'uv (Python) चाहिए', docker: 'Docker चाहिए', keyRemote: '{keys} चाहिए। जोड़ने के बाद प्रमाणीकरण में सेट करें।', keyLocal: 'शुरू करने से पहले {keys} को एनवायरनमेंट वेरिएबल के रूप में सेट करें।', review: 'नीचे का फ़ॉर्म भर दिया गया है; जांचें और जोड़ें।', builtIn: 'बिल्ट-इन', builtInHint: 'NextMux में पहले से शामिल है, इंस्टॉल करने की ज़रूरत नहीं।', builtInGithub: 'बिल्ट-इन। इस्तेमाल के लिए सेटिंग्स → खाता में GitHub जोड़ें।', builtInSummary: 'बिना इंस्टॉल के बिल्ट-इन: Context7 दस्तावेज़, draw.io डायग्राम और GitHub (सेटिंग्स → खाता में खाता जोड़ें)।' }
} as const satisfies Record<NextMuxDesktopLocale, Record<string, string>>;

type Key = keyof typeof text.en;
function uncheckedMcpRegistryText(locale: NextMuxDesktopLocale, key: Key, values: Record<string, string | number> = {}): string {
    const template: string = (text[locale] || text.en)[key];
    return Object.entries(values).reduce<string>((out, [name, value]) => out.replaceAll(`{${name}}`, String(value)), template);
}

export interface McpRegistryPick {
    readonly name: string;
    readonly configuration: McpServerConfiguration;
    /** One sentence shown above the prefilled form (keys to set, review). */
    readonly hint: string;
    readonly requiresAuth?: boolean;
    readonly defaultAuthKind?: 'bearer' | 'x-api-key' | 'api-key';
    readonly fields?: readonly McpInputFieldSpec[];
    readonly options?: readonly McpRegistryInstallOption[];
}

const PAGE = 60;
const starLabel = (stars: number): string => stars >= 1000 ? `${(stars / 1000).toFixed(stars >= 10_000 ? 0 : 1)}k` : String(stars);

export function McpRegistryBrowser(props: {
    readonly initialQuery?: string;
    readonly locale: NextMuxDesktopLocale;
    readonly load: (force?: boolean) => Promise<McpRegistryState>;
    readonly existingNames: ReadonlySet<string>;
    readonly disabled?: boolean;
    readonly onPick: (pick: McpRegistryPick) => void;
    readonly openExternal: (url: string) => void;
}): React.ReactElement {
    const t = (key: Key, values?: Record<string, string | number>) => mcpRegistryText(props.locale, key, values);
    const [state, setState] = React.useState<McpRegistryState>();
    const [loading, setLoading] = React.useState(false);
    const [query, setQuery] = React.useState(props.initialQuery || '');
    const [limit, setLimit] = React.useState(PAGE);
    const load = React.useCallback(async (force = false) => {
        setLoading(true);
        try { setState(await props.load(force)); }
        catch (error) { setState({ entries: [], refreshedAt: 0, stale: true, message: error instanceof Error ? error.message : t('failed') }); }
        finally { setLoading(false); }
    }, [props.load]);
    React.useEffect(() => { void load(); }, [load]);
    const matching = filterMcpRegistry(state?.entries || [], query);
    const visible = matching.slice(0, limit);
    const uniqueName = (entry: McpRegistryEntry): string => {
        let name = suggestedMcpServerName(entry);
        for (let suffix = 2; props.existingNames.has(name) && suffix < 100; suffix++) name = `${suggestedMcpServerName(entry).slice(0, 60)}-${suffix}`;
        return name;
    };
    const pick = (entry: McpRegistryEntry, option: McpRegistryInstallOption): void => {
        const name = uniqueName(entry);
        const keys = option.secrets.join(', ');
        const hint = [keys ? t(option.kind === 'remote' ? 'keyRemote' : 'keyLocal', { keys }) : '', t('review')].filter(Boolean).join(' ');
        props.onPick({
            name,
            configuration: option.configuration,
            hint,
            requiresAuth: option.kind === 'remote' && option.secrets.length > 0,
            defaultAuthKind: option.defaultAuthKind,
            fields: option.fields,
            options: entry.options
        });
    };
    const pickManual = (entry: McpRegistryEntry): void => {
        const name = uniqueName(entry);
        props.onPick({
            name,
            configuration: { command: 'npx', args: [] },
            hint: `${t('manual')} · ${t('review')}`
        });
    };
    const kindLabel = (kind: McpRegistryInstallKind): string => t(kind === 'remote' ? 'remote' : kind);
    return <section className='nmx-community-skills-list nmx-mcp-registry' aria-busy={loading}>
        <header><strong>{t('title')}</strong><span>{matching.length}</span></header>
        <p className='nmx-mcp-registry-builtin'><i className='codicon codicon-check-all' aria-hidden='true'></i><span>{t('builtInSummary')}</span></p>
        <div className='nmx-mcp-registry-toolbar'>
            <label><i className='codicon codicon-search' aria-hidden='true'></i><input type='search' value={query} placeholder={t('search')} aria-label={t('search')}
                onChange={event => { setQuery(event.currentTarget.value.slice(0, 120)); setLimit(PAGE); }} /></label>
            <button type='button' disabled={loading} title={t('retry')} aria-label={t('retry')} onClick={() => void load(true)}><i className={`codicon codicon-${loading ? 'loading codicon-modifier-spin' : 'refresh'}`}></i></button>
        </div>
        {state?.stale && state.message && <p className={`nmx-settings-inline-error ${state.entries.length ? 'is-warning' : ''}`} role='status'>
            <span data-nmx-literal title={state.message}>{state.entries.length ? `${t('stale')} · ${state.message}` : t('failed')}</span>
            <button type='button' disabled={loading} onClick={() => void load(true)}><i className={`codicon codicon-${loading ? 'loading codicon-modifier-spin' : 'refresh'}`} aria-hidden='true'></i>{t('retry')}</button></p>}
        <div className='nmx-mcp-registry-list'>
            {!state && loading && <div className='nmx-settings-empty'><i className='codicon codicon-loading codicon-modifier-spin'></i><span>{t('loading')}</span></div>}
            {visible.map(entry => {
                const added = props.existingNames.has(suggestedMcpServerName(entry));
                const builtIn = builtInMcpCapability(entry);
                const option = entry.options.find(item => (item.kind === 'npx' || item.kind === 'uvx') && item.secrets.length === 0)
                    || entry.options.find(item => item.kind === 'npx')
                    || entry.options[0];
                return <article key={entry.id} data-mcp-registry-id={entry.id} className={added || builtIn ? 'is-installed' : ''}>
                    <span className='nmx-community-skill-icon' aria-hidden='true'>{entry.title.slice(0, 1).toUpperCase()}</span>
                    <div>
                        <strong data-nmx-literal title={entry.id}>{entry.title}<small> · {entry.owner}</small></strong>
                        <span data-nmx-literal title={entry.description}>{entry.description}</span>
                        <small data-nmx-literal>★ {starLabel(entry.stars)}{entry.license ? ` · ${entry.license}` : ''}{entry.options.length ? ` · ${entry.options.map(item => kindLabel(item.kind)).join(' / ')}` : ''}</small>
                    </div>
                    <div className='nmx-mcp-registry-actions'>
                        {builtIn ? <small className='nmx-mcp-registry-builtin-badge' title={t(builtIn === 'github' ? 'builtInGithub' : 'builtInHint')}><i className='codicon codicon-check' aria-hidden='true'></i>{t('builtIn')}</small>
                            : option ? <button type='button' disabled={props.disabled || added} onClick={() => pick(entry, option)}>{added ? t('added') : t('add')}</button>
                                : <button type='button' disabled={props.disabled || added} onClick={() => pickManual(entry)}>{added ? t('added') : t('add')}</button>}
                        {entry.repositoryUrl && <button type='button' className='is-link' title={entry.repositoryUrl} aria-label={`${t('repo')}: ${entry.title}`} onClick={() => props.openExternal(entry.repositoryUrl)}><i className='codicon codicon-link-external'></i></button>}
                    </div>
                </article>;
            })}
            {state && !loading && matching.length === 0 && <div className='nmx-settings-empty'><i className='codicon codicon-search'></i><strong>{t('empty')}</strong></div>}
            {visible.length < matching.length && <button type='button' className='nmx-community-skills-more' onClick={() => setLimit(limit + PAGE)}>{t('more', { count: matching.length - visible.length })}</button>}
        </div>
        <footer className='nmx-mcp-registry-source'>{t('source')} <button type='button' className='is-link' onClick={() => props.openExternal(MCP_REGISTRY_ORIGIN)}>{MCP_REGISTRY_ORIGIN}</button></footer>
    </section>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function mcpRegistryText(locale: Parameters<typeof uncheckedMcpRegistryText>[0], key: Parameters<typeof uncheckedMcpRegistryText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedMcpRegistryText>>): string {
    return totalCopy(locale, key, language => uncheckedMcpRegistryText(language, key, ...rest));
}
