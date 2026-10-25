import * as React from 'react';
import { Virtuoso } from 'react-virtuoso';
import { SurfaceTooltips } from './nextmux-surface-tooltips';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { isModelVisible, modelVisibilityCategories, ModelVisibilityCatalog, ModelVisibilityCategory, ModelVisibilityGroup, ModelVisibilityPreferences } from './nextmux-model-visibility';
import { modelCategoryLabel } from './nextmux-model-taxonomy-locale';
import { ModelTaxonomyTags } from './nextmux-model-taxonomy-tags';

const copy: Record<NextMuxDesktopLocale, readonly string[]> = {
    'zh-CN': ['模型', '从全球目录选择模型，统一筛选中转商和自有 API 的模型列表。', '搜索模型', '语言', '视频', '图片', '配音', '全部启用', '全部隐藏', '没有匹配的模型', '加载中…', '模型目录加载失败', '重试', '音乐', '音效', '语音识别', "灰度测试模型", "显示平台审核通过的测试模型。"],
    'zh-TW': ['模型', '從全球目錄選擇模型，統一篩選中轉商和自有 API 的模型清單。', '搜尋模型', '語言', '影片', '圖片', '配音', '全部啟用', '全部隱藏', '沒有符合的模型', '載入中…', '無法載入模型目錄', '重試', '音樂', '音效', '語音辨識', "灰度測試模型", "顯示平台審核通過的測試模型。"],
    en: ['Models', 'Select models from the global catalog to filter merchant and personal API model pickers.', 'Search models', 'Language', 'Video', 'Images', 'Dubbing', 'Enable all', 'Hide all', 'No matching models', 'Loading…', 'Could not load the model catalog.', 'Retry', 'Music', 'Sound effects', 'Transcription', "Preview models", "Show platform-approved preview models."],
    ja: ['モデル', 'グローバルカタログから選択し、仲介業者と自分の API のモデル一覧を絞り込みます。', 'モデルを検索', '言語', '動画', '画像', '吹き替え', 'すべて有効', 'すべて非表示', '該当するモデルなし', '読み込み中…', 'モデルカタログを読み込めません。', '再試行', '音楽', '効果音', '音声認識', "プレビューモデル", "承認済みのテストモデルを表示します。"],
    ko: ['모델', '전체 카탈로그에서 모델을 선택해 중개업체와 개인 API의 모델 목록을 필터링하세요.', '모델 검색', '언어', '동영상', '이미지', '더빙', '모두 활성화', '모두 숨기기', '일치하는 모델 없음', '불러오는 중…', '모델 카탈로그를 불러올 수 없습니다.', '다시 시도', '음악', '음향 효과', '음성 인식', "미리보기 모델", "플랫폼에서 승인한 테스트 모델을 표시합니다."],
    es: ['Modelos', 'Selecciona modelos del catálogo global para filtrar los modelos de intermediarios y de tu propia API.', 'Buscar modelos', 'Lenguaje', 'Vídeo', 'Imágenes', 'Doblaje', 'Activar todos', 'Ocultar todos', 'Sin coincidencias', 'Cargando…', 'No se pudo cargar el catálogo de modelos.', 'Reintentar', 'Música', 'Efectos de sonido', 'Transcripción', "Modelos de prueba", "Mostrar modelos de prueba aprobados."],
    fr: ['Modèles', 'Choisissez des modèles du catalogue mondial pour filtrer les modèles des revendeurs et de vos propres API.', 'Rechercher', 'Langage', 'Vidéo', 'Images', 'Doublage', 'Tout activer', 'Tout masquer', 'Aucun modèle trouvé', 'Chargement…', 'Impossible de charger le catalogue de modèles.', 'Réessayer', 'Musique', 'Effets sonores', 'Transcription', "Modèles en test", "Afficher les modèles en test approuvés."],
    de: ['Modelle', 'Wählen Sie Modelle aus dem globalen Katalog für die Modellauswahl von Anbietern und eigenen APIs.', 'Modelle suchen', 'Sprache', 'Video', 'Bilder', 'Vertonung', 'Alle aktivieren', 'Alle ausblenden', 'Keine passenden Modelle', 'Wird geladen…', 'Der Modellkatalog konnte nicht geladen werden.', 'Erneut versuchen', 'Musik', 'Soundeffekte', 'Transkription', "Testmodelle", "Freigegebene Testmodelle anzeigen."],
    'pt-BR': ['Modelos', 'Selecione modelos do catálogo global para filtrar as opções de revendedores e da sua própria API.', 'Buscar modelos', 'Linguagem', 'Vídeo', 'Imagens', 'Dublagem', 'Ativar todos', 'Ocultar todos', 'Nenhum modelo encontrado', 'Carregando…', 'Não foi possível carregar o catálogo de modelos.', 'Tentar novamente', 'Música', 'Efeitos sonoros', 'Transcrição', "Modelos de teste", "Mostrar modelos de teste aprovados."],
    ru: ['Модели', 'Выберите модели из общего каталога, чтобы отфильтровать списки посредников и собственных API.', 'Поиск моделей', 'Язык', 'Видео', 'Изображения', 'Озвучка', 'Включить все', 'Скрыть все', 'Модели не найдены', 'Загрузка…', 'Не удалось загрузить каталог моделей.', 'Повторить', 'Музыка', 'Звуковые эффекты', 'Распознавание речи', "Тестовые модели", "Показывать одобренные тестовые модели."],
    ar: ['النماذج', 'اختر نماذج من الفهرس العالمي لتصفية قوائم نماذج المورّدين وواجهات API الخاصة بك.', 'البحث عن نموذج', 'اللغة', 'الفيديو', 'الصور', 'الدبلجة', 'تفعيل الكل', 'إخفاء الكل', 'لا توجد نماذج مطابقة', 'جارٍ التحميل…', 'تعذّر تحميل فهرس النماذج.', 'إعادة المحاولة', 'الموسيقى', 'المؤثرات الصوتية', 'التعرّف على الكلام', "نماذج تجريبية", "عرض النماذج التجريبية المعتمدة."],
    hi: ['मॉडल', 'वैश्विक कैटलॉग से मॉडल चुनकर विक्रेताओं और अपने API की मॉडल सूचियाँ फ़िल्टर करें।', 'मॉडल खोजें', 'भाषा', 'वीडियो', 'चित्र', 'डबिंग', 'सभी चालू करें', 'सभी छिपाएँ', 'कोई मॉडल नहीं मिला', 'लोड हो रहा है…', 'मॉडल कैटलॉग लोड नहीं हुआ।', 'फिर कोशिश करें', 'संगीत', 'ध्वनि प्रभाव', 'वाक् पहचान', "परीक्षण मॉडल", "स्वीकृत परीक्षण मॉडल दिखाएँ।"]
};
export const modelVisibilityCopy = (locale: NextMuxDesktopLocale): readonly string[] => copy[locale];
const categoryScrollCopy: Record<NextMuxDesktopLocale, readonly [string, string]> = {
    'zh-CN': ['向左查看模型分类', '向右查看模型分类'], 'zh-TW': ['向左查看模型分類', '向右查看模型分類'],
    en: ['Scroll model categories left', 'Scroll model categories right'], ja: ['モデル分類を左へスクロール', 'モデル分類を右へスクロール'],
    ko: ['모델 분류를 왼쪽으로 스크롤', '모델 분류를 오른쪽으로 스크롤'], es: ['Desplazar categorías a la izquierda', 'Desplazar categorías a la derecha'],
    fr: ['Faire défiler les catégories vers la gauche', 'Faire défiler les catégories vers la droite'], de: ['Modellkategorien nach links scrollen', 'Modellkategorien nach rechts scrollen'],
    'pt-BR': ['Rolar categorias para a esquerda', 'Rolar categorias para a direita'], ru: ['Прокрутить категории влево', 'Прокрутить категории вправо'],
    ar: ['تمرير فئات النماذج إلى اليسار', 'تمرير فئات النماذج إلى اليمين'], hi: ['मॉडल श्रेणियाँ बाईं ओर स्क्रॉल करें', 'मॉडल श्रेणियाँ दाईं ओर स्क्रॉल करें']
};
export type ModelCreativityMode = 'normal' | 'rigorous' | 'creative';
/** Left to right like a slider: 严谨 · 正常 (the default, in the middle) · 发散. */
const CREATIVITY_ORDER = ['rigorous', 'normal', 'creative'] as const;
const creativityCopy: Record<NextMuxDesktopLocale, { readonly label: string; readonly normal: string; readonly rigorous: string; readonly creative: string; readonly help: string }> = {
    'zh-CN': { label: '回复风格', normal: '正常', rigorous: '严谨', creative: '发散', help: '正常：模型保持默认，不额外传参；严谨：更确定、更精炼；发散：更有创意、更多延展。' },
    'zh-TW': { label: '回覆風格', normal: '正常', rigorous: '嚴謹', creative: '發散', help: '正常：模型保持預設，不額外傳參；嚴謹：更確定、更精煉；發散：更有創意、更多延展。' },
    en: { label: 'Response style', normal: 'Normal', rigorous: 'Rigorous', creative: 'Creative', help: 'Normal keeps the model’s defaults and sends nothing extra; Rigorous favors precise, definite answers; Creative favors exploration.' },
    ja: { label: '応答スタイル', normal: '標準', rigorous: '厳密', creative: '発散', help: '標準はモデルの既定のまま何も追加しません。厳密は正確で確かな答え、発散は発想の広がりを重視します。' },
    ko: { label: '응답 스타일', normal: '보통', rigorous: '엄격', creative: '창의', help: '보통은 모델 기본값을 그대로 두고 아무것도 더하지 않습니다. 엄격은 정확하고 확실한 답을, 창의는 폭넓은 발상을 우선합니다.' },
    es: { label: 'Estilo de respuesta', normal: 'Normal', rigorous: 'Riguroso', creative: 'Creativo', help: 'Normal mantiene los valores del modelo sin añadir nada; Riguroso prioriza respuestas precisas y firmes; Creativo prioriza la exploración.' },
    fr: { label: 'Style de réponse', normal: 'Normal', rigorous: 'Rigoureux', creative: 'Créatif', help: 'Normal garde les réglages du modèle sans rien ajouter ; Rigoureux privilégie des réponses précises et nettes ; Créatif privilégie l’exploration.' },
    de: { label: 'Antwortstil', normal: 'Normal', rigorous: 'Präzise', creative: 'Kreativ', help: 'Normal lässt die Standardwerte des Modells unverändert; Präzise bevorzugt genaue, eindeutige Antworten; Kreativ bevorzugt neue Ideen.' },
    'pt-BR': { label: 'Estilo de resposta', normal: 'Normal', rigorous: 'Rigoroso', creative: 'Criativo', help: 'Normal mantém os padrões do modelo sem enviar nada a mais; Rigoroso prioriza respostas precisas e firmes; Criativo prioriza a exploração.' },
    ru: { label: 'Стиль ответа', normal: 'Обычный', rigorous: 'Строгий', creative: 'Творческий', help: 'Обычный оставляет настройки модели без изменений; Строгий выбирает точные, определённые ответы; Творческий — поиск идей.' },
    ar: { label: 'أسلوب الرد', normal: 'عادي', rigorous: 'دقيق', creative: 'إبداعي', help: 'العادي يُبقي إعدادات النموذج كما هي دون أي إضافة؛ الدقيق يفضّل الإجابات المحددة والواضحة؛ الإبداعي يفضّل استكشاف الأفكار.' },
    hi: { label: 'उत्तर शैली', normal: 'सामान्य', rigorous: 'सटीक', creative: 'रचनात्मक', help: 'सामान्य मॉडल की डिफ़ॉल्ट सेटिंग बिना कुछ जोड़े रखता है; सटीक स्पष्ट, निश्चित उत्तर चुनता है; रचनात्मक नए विचारों को प्राथमिकता देता है।' }
};
export function AnonymousModelsToggle(props: {
    readonly enabled: boolean;
    readonly label: string;
    readonly help: string;
    readonly onChange: (enabled: boolean) => void;
    readonly locale?: NextMuxDesktopLocale;
    readonly creativityMode?: ModelCreativityMode;
    readonly onCreativityModeChange?: (mode: ModelCreativityMode) => void;
}): React.ReactElement {
    const toggle = <label className='nmx-anonymous-models-toggle' data-help={props.help}>
        <input type='checkbox' data-help={props.help} checked={props.enabled} onChange={event => props.onChange(event.currentTarget.checked)} />
        <span>{props.label}</span>
    </label>;
    if (!props.onCreativityModeChange) {
        return <>{toggle}<SurfaceTooltips scope='.nmx-anonymous-models-toggle' /></>;
    }
    const cc = creativityCopy[props.locale || 'zh-CN'] || creativityCopy['zh-CN'];
    const currentMode: ModelCreativityMode = props.creativityMode || 'normal';
    const index = CREATIVITY_ORDER.indexOf(currentMode);
    // Arrow keys move along the three stops, as on a slider (the group is one tab stop).
    const step = (event: React.KeyboardEvent<HTMLDivElement>): void => {
        const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
        const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
        if (!forward && !backward && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        const rtl = getComputedStyle(event.currentTarget).direction === 'rtl' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight');
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? CREATIVITY_ORDER.length - 1
            : Math.max(0, Math.min(CREATIVITY_ORDER.length - 1, index + ((forward !== rtl) ? 1 : -1)));
        if (next === index) return;
        props.onCreativityModeChange?.(CREATIVITY_ORDER[next]);
        (event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next])?.focus();
    };
    return <><div className='nmx-models-settings-footer-bar'>
        {toggle}
        <div className='nmx-creativity-mode-control' data-help={cc.help}>
            <span className='nmx-creativity-mode-label' id='nmx-creativity-mode-label'>{cc.label}</span>
            <div className='nmx-creativity-mode-segmented' role='radiogroup' aria-labelledby='nmx-creativity-mode-label'
                data-position={index} onKeyDown={step}>
                <span className='nmx-creativity-mode-thumb' aria-hidden='true'></span>
                {CREATIVITY_ORDER.map(mode => <button key={mode} type='button' role='radio'
                    data-creativity-mode={mode}
                    className={currentMode === mode ? 'is-active' : ''}
                    aria-checked={currentMode === mode}
                    tabIndex={currentMode === mode ? 0 : -1}
                    onClick={() => props.onCreativityModeChange?.(mode)}>
                    {cc[mode]}
                </button>)}
            </div>
        </div>
    </div><SurfaceTooltips scope='.nmx-anonymous-models-toggle, .nmx-creativity-mode-control' /></>;
}
export interface ModelVisibilityOption { readonly id: string; readonly label: string; readonly providerName: string; readonly kind?: string; readonly output: readonly string[]; readonly capabilities: readonly string[]; readonly popularity?: { readonly rank?: number; readonly attribution?: string }; }
export function ModelVisibilitySettings(props: {
    locale: NextMuxDesktopLocale; preferences: ModelVisibilityPreferences; catalog?: ModelVisibilityCatalog;
    language: readonly ModelVisibilityOption[]; media: readonly ModelVisibilityOption[];
    onChange(ids: readonly string[], group: ModelVisibilityGroup, visible: boolean): void;
    loading?: boolean;
    error?: string;
    onRetry?(): void;
}): React.ReactElement {
    const [query, setQuery] = React.useState('');
    const [mediaType, setMediaType] = React.useState<Exclude<ModelVisibilityCategory, 'language'>>('image');
    const categoryNav = React.useRef<HTMLElement>(null);
    const [categoryOverflow, setCategoryOverflow] = React.useState({ left: false, right: false });
    const scrollBehavior = (): ScrollBehavior => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    const centerCategory = (button: HTMLElement, behavior: ScrollBehavior): void => {
        const nav = categoryNav.current;
        if (!nav) { return; }
        const viewport = nav.getBoundingClientRect(), item = button.getBoundingClientRect();
        // Physical geometry works with both positive LTR and negative RTL scrollLeft.
        // Scroll only this strip, without moving the Settings page or its parent columns.
        nav.scrollBy({ left: (item.left + item.right - viewport.left - viewport.right) / 2, behavior });
    };
    const c = copy[props.locale];
    const categories = Object.fromEntries((['language', '3d', 'image', 'video', 'speech', 'music', 'soundEffect', 'transcription'] as const)
        .map(category => [category, (category === 'language' ? props.language : category === '3d' ? [...props.language, ...props.media].filter((m, idx, arr) => arr.findIndex(x => x.id === m.id) === idx) : props.media)
            .filter(model => modelVisibilityCategories(model).includes(category))])) as Record<ModelVisibilityCategory, ModelVisibilityOption[]>;
    // Category names come from the shared taxonomy, as in every other model list (entries 3–6 and 13–15 above are unused).
    const categoryLabels: Record<ModelVisibilityCategory, string> = Object.fromEntries((['language', '3d', 'image', 'video', 'speech', 'music', 'soundEffect', 'transcription'] as const)
        .map(category => [category, modelCategoryLabel(props.locale, category === 'soundEffect' ? 'sound_effect' : category)])) as Record<ModelVisibilityCategory, string>;
    const count = (category: ModelVisibilityCategory): string => {
        const group = category === 'language' ? 'language' : 'media';
        return `${categories[category].filter(model => isModelVisible(props.preferences, model.id, group, props.catalog)).length}/${categories[category].length}`;
    };
    const hasCatalog = Object.values(categories).some(models => models.length > 0);
    const catalogStatus = props.loading ? c[10] : props.error ? c[11] : '';
    React.useLayoutEffect(() => {
        const nav = categoryNav.current;
        if (!nav) { return; }
        const updateOverflow = (): void => {
            const viewport = nav.getBoundingClientRect();
            const items = Array.from(nav.querySelectorAll<HTMLElement>('[data-model-category]')).map(item => item.getBoundingClientRect());
            const left = items.some(item => item.left < viewport.left - 1), right = items.some(item => item.right > viewport.right + 1);
            setCategoryOverflow(previous => previous.left === left && previous.right === right ? previous : { left, right });
        };
        updateOverflow();
        nav.addEventListener('scroll', updateOverflow, { passive: true });
        const observer = new ResizeObserver(updateOverflow);
        observer.observe(nav);
        nav.querySelectorAll('[data-model-category]').forEach(item => observer.observe(item));
        return () => { nav.removeEventListener('scroll', updateOverflow); observer.disconnect(); };
    }, [hasCatalog, catalogStatus, props.locale]);
    React.useLayoutEffect(() => {
        const selected = categoryNav.current?.querySelector<HTMLElement>(`[data-model-category='${mediaType}']`);
        if (selected) { centerCategory(selected, scrollBehavior()); }
    }, [mediaType, props.locale, hasCatalog, catalogStatus]);
    const status = catalogStatus && <div className={`nmx-model-visibility-status${hasCatalog ? '' : ' is-empty'}`} role={props.error && !props.loading ? 'alert' : 'status'}>
        <span>{catalogStatus}</span>{props.error && !props.loading && props.onRetry && <button type='button' onClick={props.onRetry}>{c[12]}</button>}
    </div>;
    const matches = (model: ModelVisibilityOption): boolean => `${model.label} ${model.providerName} ${model.id}`.toLowerCase().includes(query.trim().toLowerCase());
    // /api/models/global is already ordered "frontier + popular first"
    // (platform src/model-ranking.js: public weekly usage, NextMux usage and
    // release recency). Older servers ordered it by public usage alone. Either
    // way the server order is authoritative: never re-rank or alphabetize it.
    const language = categories.language.filter(matches);
    const media = categories[mediaType].filter(matches);
    const column = (models: readonly ModelVisibilityOption[], category: ModelVisibilityCategory, title: React.ReactNode) => {
        const group: ModelVisibilityGroup = category === 'language' ? 'language' : 'media';
        return <section className='nmx-model-visibility-column'>
        <header>{title}{category === 'language' && <span className='nmx-model-category-count' dir='ltr'>{count(category)}</span>}</header>
        <div className='nmx-model-visibility-actions'><button disabled={!models.length} onClick={() => props.onChange(models.map(m => m.id), group, true)}>{c[7]}</button><button disabled={!models.length} onClick={() => props.onChange(models.map(m => m.id), group, false)}>{c[8]}</button></div>
        {models.length ? <div className='nmx-model-visibility-list'><Virtuoso data={models} computeItemKey={(_, m) => m.id} defaultItemHeight={46} increaseViewportBy={120}
            itemContent={(_, model) => <label className='nmx-model-visibility-row' title={[model.label, model.id].filter(Boolean).join('\n')}>
                <input type='checkbox' aria-label={model.label} checked={isModelVisible(props.preferences, model.id, group, props.catalog)} onChange={event => props.onChange([model.id], group, event.currentTarget.checked)} />
                <span><strong>{model.label}</strong><ModelTaxonomyTags locale={props.locale} model={model} /></span>
            </label>} /></div> : <div className='nmx-model-visibility-empty'>{c[9]}</div>}
    </section>;
    };
    return <section className='nmx-model-visibility-settings' aria-busy={props.loading || undefined}>
        <input className='nmx-model-visibility-search' type='search' aria-label={c[2]} placeholder={c[2]} value={query} onChange={event => setQuery(event.currentTarget.value)} />
        {status}
        <div className='nmx-model-visibility-columns'>
            {column(language, 'language', <strong>{categoryLabels.language}</strong>)}
            {column(media, mediaType, <div className='nmx-model-category-navigation'>
                <button type='button' className='nmx-model-category-scroll is-left' aria-label={categoryScrollCopy[props.locale][0]} disabled={!categoryOverflow.left}
                    onClick={() => categoryNav.current?.scrollBy({ left: -categoryNav.current.clientWidth * .75, behavior: scrollBehavior() })}>
                    <svg viewBox='0 0 16 16' aria-hidden='true'><path d='m10 3-5 5 5 5' /></svg>
                </button>
                <nav ref={categoryNav} role='tablist' aria-label={c[0]}>{(['3d', 'image', 'video', 'speech', 'music', 'soundEffect', 'transcription'] as const).map(category => <button type='button' key={category} data-model-category={category} role='tab' aria-selected={category === mediaType} aria-pressed={category === mediaType}
                    onFocus={event => { if (event.currentTarget.matches(':focus-visible')) { centerCategory(event.currentTarget, 'auto'); } }}
                    onClick={event => { setMediaType(category); if (category === mediaType) { centerCategory(event.currentTarget, scrollBehavior()); } }}>
                    <span>{categoryLabels[category]}</span> <span className='nmx-model-category-count' dir='ltr'>{count(category)}</span>
                </button>)}</nav>
                <button type='button' className='nmx-model-category-scroll is-right' aria-label={categoryScrollCopy[props.locale][1]} disabled={!categoryOverflow.right}
                    onClick={() => categoryNav.current?.scrollBy({ left: categoryNav.current.clientWidth * .75, behavior: scrollBehavior() })}>
                    <svg viewBox='0 0 16 16' aria-hidden='true'><path d='m6 3 5 5-5 5' /></svg>
                </button>
            </div>)}
        </div>
    </section>;
}
