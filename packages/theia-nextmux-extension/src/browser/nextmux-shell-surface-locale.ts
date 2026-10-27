import type { NextMuxDesktopLocale } from './nextmux-locale';

/**
 * Reviewed labels for the app shell, settings, plugins and comic studio
 * surfaces. Like the coding-surface table they take precedence over the
 * machine-generated catalogue, which rendered film terms literally ("A grand
 * vision" for 大远景), leaked Chinese measure words ("0 piece MCP services")
 * or kept raw HTTP codes. Keys are the Simplified Chinese source strings.
 */
type Row = readonly [zhTW: string, en: string, ja: string, ko: string, es: string, fr: string, de: string, ptBR: string, ru: string, ar: string, hi: string];

const rows: Readonly<Record<string, Row>> = {
    // Appearance.
    '浅色': ['淺色', 'Light', 'ライト', '라이트', 'Claro', 'Clair', 'Hell', 'Claro', 'Светлая', 'فاتح', 'लाइट'],
    '深色': ['深色', 'Dark', 'ダーク', '다크', 'Oscuro', 'Sombre', 'Dunkel', 'Escuro', 'Тёмная', 'داكن', 'डार्क'],

    // Community Skills catalogue failures (GitHub rate limits are common for anonymous clients).
    'GitHub 访问受限，请稍后重试': ['GitHub 存取受限，請稍後再試', 'GitHub is rate-limiting requests. Try again later.', 'GitHub へのアクセスが制限されています。しばらくしてから再試行してください', 'GitHub 접근이 제한되었습니다. 잠시 후 다시 시도하세요', 'GitHub está limitando las solicitudes. Inténtalo más tarde.', 'GitHub limite les requêtes. Réessayez plus tard.', 'GitHub begrenzt Anfragen. Bitte später erneut versuchen.', 'O GitHub está limitando as solicitações. Tente mais tarde.', 'GitHub ограничивает запросы. Повторите позже.', 'يقيّد GitHub الطلبات. أعد المحاولة لاحقاً.', 'GitHub अनुरोध सीमित कर रहा है। बाद में पुनः प्रयास करें।'],
    'GitHub 暂时无法访问，请稍后重试': ['暫時無法存取 GitHub，請稍後再試', 'GitHub is unavailable right now. Try again later.', 'GitHub に接続できません。しばらくしてから再試行してください', '지금은 GitHub에 연결할 수 없습니다. 잠시 후 다시 시도하세요', 'GitHub no está disponible ahora. Inténtalo más tarde.', 'GitHub est indisponible. Réessayez plus tard.', 'GitHub ist gerade nicht erreichbar. Bitte später erneut versuchen.', 'O GitHub está indisponível. Tente mais tarde.', 'GitHub сейчас недоступен. Повторите позже.', 'GitHub غير متاح حالياً. أعد المحاولة لاحقاً.', 'GitHub अभी उपलब्ध नहीं है। बाद में पुनः प्रयास करें।'],
    '部分来源未更新：GitHub 访问受限，请稍后重试': ['部分來源未更新：GitHub 存取受限，請稍後再試', 'Some sources were not updated: GitHub is rate-limiting requests. Try again later.', '一部のソースを更新できませんでした：GitHub へのアクセスが制限されています', '일부 소스를 업데이트하지 못했습니다: GitHub 접근이 제한되었습니다', 'Algunas fuentes no se actualizaron: GitHub está limitando las solicitudes.', 'Certaines sources n’ont pas été mises à jour : GitHub limite les requêtes.', 'Einige Quellen wurden nicht aktualisiert: GitHub begrenzt Anfragen.', 'Algumas fontes não foram atualizadas: o GitHub está limitando as solicitações.', 'Некоторые источники не обновлены: GitHub ограничивает запросы.', 'لم تُحدَّث بعض المصادر: يقيّد GitHub الطلبات.', 'कुछ स्रोत अपडेट नहीं हुए: GitHub अनुरोध सीमित कर रहा है।'],
    '部分来源未更新：GitHub 暂时无法访问，请稍后重试': ['部分來源未更新：暫時無法存取 GitHub', 'Some sources were not updated: GitHub is unavailable right now.', '一部のソースを更新できませんでした：GitHub に接続できません', '일부 소스를 업데이트하지 못했습니다: GitHub에 연결할 수 없습니다', 'Algunas fuentes no se actualizaron: GitHub no está disponible.', 'Certaines sources n’ont pas été mises à jour : GitHub est indisponible.', 'Einige Quellen wurden nicht aktualisiert: GitHub ist nicht erreichbar.', 'Algumas fontes não foram atualizadas: o GitHub está indisponível.', 'Некоторые источники не обновлены: GitHub недоступен.', 'لم تُحدَّث بعض المصادر: GitHub غير متاح.', 'कुछ स्रोत अपडेट नहीं हुए: GitHub उपलब्ध नहीं है।'],

    // Comic studio: standard film shot sizes, not literal translations.
    '大远景': ['大遠景', 'Extreme long shot', '超ロングショット', '익스트림 롱 숏', 'Gran plano general', 'Très grand plan d’ensemble', 'Supertotale', 'Plano geral extremo', 'Сверхобщий план', 'لقطة بعيدة جداً', 'एक्सट्रीम लॉन्ग शॉट'],
    '远景': ['遠景', 'Long shot', 'ロングショット', '롱 숏', 'Plano general', 'Plan d’ensemble', 'Totale', 'Plano geral', 'Общий план', 'لقطة بعيدة', 'लॉन्ग शॉट'],
    '中景': ['中景', 'Medium shot', 'ミディアムショット', '미디엄 숏', 'Plano medio', 'Plan moyen', 'Halbnahe', 'Plano médio', 'Средний план', 'لقطة متوسطة', 'मीडियम शॉट'],
    '近景': ['近景', 'Medium close-up', 'バストショット', '미디엄 클로즈업', 'Plano medio corto', 'Plan rapproché', 'Nahe', 'Plano médio curto', 'Крупный средний план', 'لقطة قريبة متوسطة', 'मीडियम क्लोज़-अप'],
    '特写': ['特寫', 'Close-up', 'クローズアップ', '클로즈업', 'Primer plano', 'Gros plan', 'Großaufnahme', 'Close-up', 'Крупный план', 'لقطة مقرّبة', 'क्लोज़-अप'],
    '景别': ['景別', 'Shot size', 'ショットサイズ', '숏 크기', 'Tamaño de plano', 'Valeur de plan', 'Einstellungsgröße', 'Enquadramento', 'Крупность плана', 'حجم اللقطة', 'शॉट आकार'],
    '镜头': ['鏡頭', 'Shot', 'ショット', '숏', 'Plano', 'Plan', 'Einstellung', 'Plano', 'Кадр', 'لقطة', 'शॉट'],
    '新增镜头': ['新增鏡頭', 'New shot', 'ショットを追加', '숏 추가', 'Nuevo plano', 'Nouveau plan', 'Neue Einstellung', 'Novo plano', 'Новый кадр', 'لقطة جديدة', 'नया शॉट'],
    '＋ 新增镜头': ['＋ 新增鏡頭', '+ New shot', '+ ショットを追加', '+ 숏 추가', '+ Nuevo plano', '+ Nouveau plan', '+ Neue Einstellung', '+ Novo plano', '+ Новый кадр', '+ لقطة جديدة', '+ नया शॉट'],
    '上移': ['上移', 'Move up', '上へ', '위로', 'Subir', 'Monter', 'Nach oben', 'Mover para cima', 'Вверх', 'تحريك لأعلى', 'ऊपर ले जाएँ'],
    '下移': ['下移', 'Move down', '下へ', '아래로', 'Bajar', 'Descendre', 'Nach unten', 'Mover para baixo', 'Вниз', 'تحريك لأسفل', 'नीचे ले जाएँ'],
    '任务': ['任務', 'Tasks', 'タスク', '작업', 'Tareas', 'Tâches', 'Aufgaben', 'Tarefas', 'Задачи', 'المهام', 'कार्य'],
    '固定机位': ['固定機位', 'Static camera', '固定カメラ', '고정 카메라', 'Cámara fija', 'Plan fixe', 'Statische Kamera', 'Câmera fixa', 'Статичная камера', 'كاميرا ثابتة', 'स्थिर कैमरा'],
    '素材与任务': ['素材與任務', 'Assets and tasks', 'アセットとタスク', '에셋과 작업', 'Recursos y tareas', 'Ressources et tâches', 'Assets und Aufgaben', 'Recursos e tarefas', 'Ресурсы и задачи', 'الأصول والمهام', 'एसेट और कार्य'],
    '角色': ['角色', 'Characters', 'キャラクター', '캐릭터', 'Personajes', 'Personnages', 'Figuren', 'Personagens', 'Персонажи', 'الشخصيات', 'पात्र'],
    '工程': ['工程', 'Project', 'プロジェクト', '프로젝트', 'Proyecto', 'Projet', 'Projekt', 'Projeto', 'Проект', 'المشروع', 'प्रोजेक्ट'],
    '本地漫剧工程': ['本機漫劇工程', 'Local comic project', 'ローカルの漫画プロジェクト', '로컬 만화 프로젝트', 'Proyecto de cómic local', 'Projet BD local', 'Lokales Comic-Projekt', 'Projeto de quadrinhos local', 'Локальный проект комикса', 'مشروع قصص مصورة محلي', 'स्थानीय कॉमिक प्रोजेक्ट'],
    '余额、充值与消费': ['餘額、儲值與消費', 'Balance, top-ups and usage', '残高・チャージ・利用状況', '잔액, 충전 및 사용량', 'Saldo, recargas y uso', 'Solde, recharges et utilisation', 'Guthaben, Aufladungen und Nutzung', 'Saldo, recargas e uso', 'Баланс, пополнения и расходы', 'الرصيد والشحن والاستخدام', 'बैलेंस, टॉप-अप और उपयोग'],
    '本地工程文件': ['本機工程檔案', 'Local project file', 'ローカルのプロジェクトファイル', '로컬 프로젝트 파일', 'Archivo de proyecto local', 'Fichier de projet local', 'Lokale Projektdatei', 'Arquivo de projeto local', 'Локальный файл проекта', 'ملف مشروع محلي', 'स्थानीय प्रोजेक्ट फ़ाइल'],

    // Account card while signed out.
    '登录后可使用余额与平台线路': ['登入後可使用餘額與平台線路', 'Sign in to use your balance and platform relays', 'サインインすると残高とプラットフォーム経路を利用できます', '로그인하면 잔액과 플랫폼 경로를 사용할 수 있습니다', 'Inicia sesión para usar tu saldo y las rutas de la plataforma', 'Connectez-vous pour utiliser votre solde et les relais de la plateforme', 'Melde dich an, um Guthaben und Plattform-Relays zu nutzen', 'Entre para usar seu saldo e as rotas da plataforma', 'Войдите, чтобы использовать баланс и маршруты платформы', 'سجّل الدخول لاستخدام رصيدك ومسارات المنصة', 'बैलेंस और प्लेटफ़ॉर्म रूट उपयोग करने के लिए साइन इन करें'],

    // Scheduled tasks.
    '立即运行': ['立即執行', 'Run now', '今すぐ実行', '지금 실행', 'Ejecutar ahora', 'Exécuter maintenant', 'Jetzt ausführen', 'Executar agora', 'Запустить сейчас', 'تشغيل الآن', 'अभी चलाएँ'],
    '应用打开时运行': ['應用程式開啟時執行', 'Runs while the app is open', 'アプリの起動中に実行', '앱이 열려 있을 때 실행', 'Se ejecuta con la app abierta', 'S’exécute quand l’app est ouverte', 'Läuft, solange die App geöffnet ist', 'Executa com o app aberto', 'Выполняется, пока приложение открыто', 'يعمل أثناء فتح التطبيق', 'ऐप खुला रहने पर चलता है'],
    '后台唤醒': ['背景喚醒', 'Wakes in the background', 'バックグラウンドで起動', '백그라운드에서 실행', 'Se activa en segundo plano', 'Se lance en arrière-plan', 'Startet im Hintergrund', 'Inicia em segundo plano', 'Запускается в фоне', 'يعمل في الخلفية', 'बैकग्राउंड में चलता है'],

    // Sidebar.
    '添加项目': ['新增專案', 'Add project', 'プロジェクトを追加', '프로젝트 추가', 'Añadir proyecto', 'Ajouter un projet', 'Projekt hinzufügen', 'Adicionar projeto', 'Добавить проект', 'إضافة مشروع', 'प्रोजेक्ट जोड़ें'],
    '添加项目文件夹': ['新增專案資料夾', 'Add project folder', 'プロジェクトフォルダを追加', '프로젝트 폴더 추가', 'Añadir carpeta de proyecto', 'Ajouter un dossier de projet', 'Projektordner hinzufügen', 'Adicionar pasta do projeto', 'Добавить папку проекта', 'إضافة مجلد مشروع', 'प्रोजेक्ट फ़ोल्डर जोड़ें']
};

const order: readonly NextMuxDesktopLocale[] = ['zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];

export const shellSurfaceCatalog: Readonly<Partial<Record<NextMuxDesktopLocale, Readonly<Record<string, string>>>>> = Object.fromEntries(
    order.map((locale, index) => [locale, Object.fromEntries(Object.entries(rows).map(([source, row]) => [source, row[index]]))])
);

/** Reviewed shell label, or undefined when another catalogue owns the string. */
export function shellSurfaceText(locale: NextMuxDesktopLocale, value: string): string | undefined {
    return shellSurfaceCatalog[locale]?.[value];
}

/** Every Simplified Chinese source string this table reviews (for locale-coverage tests). */
export const shellSurfaceSources: readonly string[] = Object.keys(rows);

const pluginSummaryCopy: Readonly<Record<NextMuxDesktopLocale, readonly [skills: string, mcp: string, skillsCard: string, mcpCard: string]>> = {
    'zh-CN': ['{n} 个 Skills', '{n} 个 MCP 服务', '{n} 个可用 Skills', '{n} 个运行中的服务'],
    'zh-TW': ['{n} 個 Skills', '{n} 個 MCP 服務', '{n} 個可用 Skills', '{n} 個執行中的服務'],
    en: ['{n} Skills', '{n} MCP services', '{n} available', '{n} running'],
    ja: ['Skills {n} 件', 'MCP サービス {n} 件', '利用可能 {n} 件', '実行中 {n} 件'],
    ko: ['Skills {n}개', 'MCP 서비스 {n}개', '사용 가능 {n}개', '실행 중 {n}개'],
    es: ['{n} Skills', '{n} servicios MCP', '{n} disponibles', '{n} en ejecución'],
    fr: ['{n} Skills', '{n} services MCP', '{n} disponibles', '{n} en cours'],
    de: ['{n} Skills', '{n} MCP-Dienste', '{n} verfügbar', '{n} aktiv'],
    'pt-BR': ['{n} Skills', '{n} serviços MCP', '{n} disponíveis', '{n} em execução'],
    ru: ['Skills: {n}', 'Сервисы MCP: {n}', 'Доступно: {n}', 'Запущено: {n}'],
    ar: ['{n} Skills', '{n} خدمات MCP', '{n} متاحة', '{n} قيد التشغيل'],
    hi: ['{n} Skills', '{n} MCP सेवाएँ', '{n} उपलब्ध', '{n} चल रही हैं']
};

/** "3 Skills · 1 MCP service" line of the Plugins page, fully localized (no measure-word leaks). */
export function pluginSummaryText(locale: NextMuxDesktopLocale, kind: 'summary' | 'skillsCard' | 'mcpCard', skills: number, mcp: number): string {
    const copy = pluginSummaryCopy[locale];
    if (kind === 'skillsCard') return copy[2].replace('{n}', String(skills));
    if (kind === 'mcpCard') return copy[3].replace('{n}', String(mcp));
    return `${copy[0].replace('{n}', String(skills))} · ${copy[1].replace('{n}', String(mcp))}`;
}

type ComicCountKind = 'scriptChars' | 'episodes' | 'characters' | 'sceneDrafts' | 'scenes' | 'shots';
/** [one, other] forms; `{n}` is replaced with the formatted count. */
const comicCountCopy: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<ComicCountKind, readonly [string, string]>>>> = {
    'zh-CN': { scriptChars: ['{n} 字', '{n} 字'], episodes: ['{n} 集', '{n} 集'], characters: ['{n} 个角色', '{n} 个角色'], sceneDrafts: ['{n} 个场景草案', '{n} 个场景草案'], scenes: ['{n} 场景', '{n} 场景'], shots: ['{n} 镜头', '{n} 镜头'] },
    'zh-TW': { scriptChars: ['{n} 字', '{n} 字'], episodes: ['{n} 集', '{n} 集'], characters: ['{n} 個角色', '{n} 個角色'], sceneDrafts: ['{n} 個場景草案', '{n} 個場景草案'], scenes: ['{n} 場景', '{n} 場景'], shots: ['{n} 鏡頭', '{n} 鏡頭'] },
    en: { scriptChars: ['{n} character', '{n} characters'], episodes: ['{n} episode', '{n} episodes'], characters: ['{n} role', '{n} roles'], sceneDrafts: ['{n} scene draft', '{n} scene drafts'], scenes: ['{n} scene', '{n} scenes'], shots: ['{n} shot', '{n} shots'] },
    ja: { scriptChars: ['{n} 文字', '{n} 文字'], episodes: ['{n} 話', '{n} 話'], characters: ['キャラクター {n} 人', 'キャラクター {n} 人'], sceneDrafts: ['シーン案 {n} 件', 'シーン案 {n} 件'], scenes: ['{n} シーン', '{n} シーン'], shots: ['{n} ショット', '{n} ショット'] },
    ko: { scriptChars: ['{n}자', '{n}자'], episodes: ['{n}화', '{n}화'], characters: ['캐릭터 {n}명', '캐릭터 {n}명'], sceneDrafts: ['장면 초안 {n}개', '장면 초안 {n}개'], scenes: ['장면 {n}개', '장면 {n}개'], shots: ['숏 {n}개', '숏 {n}개'] },
    es: { scriptChars: ['{n} carácter', '{n} caracteres'], episodes: ['{n} episodio', '{n} episodios'], characters: ['{n} personaje', '{n} personajes'], sceneDrafts: ['{n} borrador de escena', '{n} borradores de escena'], scenes: ['{n} escena', '{n} escenas'], shots: ['{n} plano', '{n} planos'] },
    fr: { scriptChars: ['{n} caractère', '{n} caractères'], episodes: ['{n} épisode', '{n} épisodes'], characters: ['{n} personnage', '{n} personnages'], sceneDrafts: ['{n} brouillon de scène', '{n} brouillons de scène'], scenes: ['{n} scène', '{n} scènes'], shots: ['{n} plan', '{n} plans'] },
    de: { scriptChars: ['{n} Zeichen', '{n} Zeichen'], episodes: ['{n} Folge', '{n} Folgen'], characters: ['{n} Figur', '{n} Figuren'], sceneDrafts: ['{n} Szenenentwurf', '{n} Szenenentwürfe'], scenes: ['{n} Szene', '{n} Szenen'], shots: ['{n} Einstellung', '{n} Einstellungen'] },
    'pt-BR': { scriptChars: ['{n} caractere', '{n} caracteres'], episodes: ['{n} episódio', '{n} episódios'], characters: ['{n} personagem', '{n} personagens'], sceneDrafts: ['{n} rascunho de cena', '{n} rascunhos de cena'], scenes: ['{n} cena', '{n} cenas'], shots: ['{n} plano', '{n} planos'] },
    ru: { scriptChars: ['Символов: {n}', 'Символов: {n}'], episodes: ['Серий: {n}', 'Серий: {n}'], characters: ['Персонажей: {n}', 'Персонажей: {n}'], sceneDrafts: ['Черновиков сцен: {n}', 'Черновиков сцен: {n}'], scenes: ['Сцен: {n}', 'Сцен: {n}'], shots: ['Кадров: {n}', 'Кадров: {n}'] },
    ar: { scriptChars: ['{n} حرف', '{n} حرف'], episodes: ['{n} حلقة', '{n} حلقات'], characters: ['{n} شخصية', '{n} شخصيات'], sceneDrafts: ['{n} مسودة مشهد', '{n} مسودات مشاهد'], scenes: ['{n} مشهد', '{n} مشاهد'], shots: ['{n} لقطة', '{n} لقطات'] },
    hi: { scriptChars: ['{n} अक्षर', '{n} अक्षर'], episodes: ['{n} एपिसोड', '{n} एपिसोड'], characters: ['{n} पात्र', '{n} पात्र'], sceneDrafts: ['{n} दृश्य ड्राफ़्ट', '{n} दृश्य ड्राफ़्ट'], scenes: ['{n} दृश्य', '{n} दृश्य'], shots: ['{n} शॉट', '{n} शॉट'] }
};

/** Localized, pluralized comic counters ("1 scene · 3 shots"); never passes through the substring translator. */
export function comicCountText(locale: NextMuxDesktopLocale, kind: ComicCountKind, count: number): string {
    const [one, other] = comicCountCopy[locale][kind];
    const rule = new Intl.PluralRules(locale).select(count);
    return (rule === 'one' ? one : other).replace('{n}', count.toLocaleString(locale));
}
