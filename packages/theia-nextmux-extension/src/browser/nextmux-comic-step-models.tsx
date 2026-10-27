import type { NextMuxDesktopLocale } from './nextmux-locale';
import { transcriptionText } from './nextmux-transcription-locale';
import type { PlatformOffering } from '../common/nextmux-platform-protocol';
import { offeringPriceSignature } from './nextmux-offering-price';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

/**
 * Model choice per comic step: the candidates for each step (only models that can do it), the
 * recommended one, and how a stored choice resolves. The choosing itself happens in one place, the
 * AI 模型 panel (nextmux-comic-model-setup.tsx); forms show the result with a “更换” link.
 */

export type ComicStepCapability = 'text' | 'image' | 'video' | 'speech' | 'music' | 'sound_effect' | 'transcription';
// 音效 is not a comic step (NextMux does not generate sound effects); 'sound_effect' stays in the type for old saved choices.
export const COMIC_STEP_CAPABILITIES: readonly ComicStepCapability[] = ['text', 'image', 'video', 'speech', 'music', 'transcription'];

export interface ComicStepSource {
    /** 'auto' | 'official:<connection>' | 'managed:<merchant>' | 'local' */
    readonly key: string;
    readonly kind: 'automatic' | 'official' | 'managed' | 'local';
    readonly label: string;
}

export interface ComicStepCandidate {
    /** `${source.key}::${routeId}` */
    readonly key: string;
    readonly routeId: string;
    /** Canonical model ID; one simple-menu row per model. */
    readonly model: string;
    readonly label: string;
    readonly source: ComicStepSource;
    /** Lower is better: platform recommendation, public popularity, recency. */
    readonly rank: number;
    readonly note?: string;
    /** Video candidates: whether the model also makes the sound (dialogue, effects, music). */
    readonly withSound?: boolean;
    /** A relay route's offering: its price card on hover (official price, multiplier, relay price). */
    readonly offering?: PlatformOffering;
}

/**
 * A relay lists the same model on several APIs: identical prices show once (the best-ranked route), different
 * prices each get a row. Own APIs, this Mac and automatic routing are left as they are.
 */
export function dedupeComicPriceVariants(candidates: readonly ComicStepCandidate[]): readonly ComicStepCandidate[] {
    const kept = new Map<string, ComicStepCandidate>();
    const out: ComicStepCandidate[] = [];
    for (const candidate of [...candidates].sort((left, right) => left.rank - right.rank)) {
        if (candidate.source.kind !== 'managed' || !candidate.offering) { out.push(candidate); continue; }
        const key = `${candidate.source.key}\n${candidate.model.toLowerCase()}\n${offeringPriceSignature(candidate.offering)}`;
        if (kept.has(key)) continue;
        kept.set(key, candidate);
        out.push(candidate);
    }
    // Keep the caller's order for everything that survived.
    const order = new Map(candidates.map((candidate, index) => [candidate.key, index]));
    return out.sort((left, right) => (order.get(left.key) ?? 0) - (order.get(right.key) ?? 0));
}

/** A relay the capability-filtered directory lists but whose models are not loaded yet. */
export interface ComicStepRelay {
    readonly key: string;
    readonly label: string;
}

export interface ComicStepPrefs {
    readonly choices: Partial<Record<ComicStepCapability, string>>;
    readonly advanced: Partial<Record<ComicStepCapability, boolean>>;
    /** Relay picked in advanced mode (it may have no chosen model yet). */
    readonly relays: Partial<Record<ComicStepCapability, string>>;
    /**
     * The relay every step uses unless the step has its own choice (the “AI 模型” panel):
     * '' picks per step (own API first, then quality), otherwise a source key.
     */
    readonly global?: string;
    /**
     * “默认推荐” in the AI 模型 panel: every step uses the recommended model and the per-step choices
     * (kept for when it is turned off) are ignored. Absent in older preferences: on unless a step or a
     * global relay was chosen.
     */
    readonly auto?: boolean;
}

export const COMIC_STEP_PREFS_KEY = 'nextmux.desktop.comicStepModels.v1';

export function parseComicStepPrefs(value: string | null | undefined): ComicStepPrefs {
    const empty: ComicStepPrefs = { choices: {}, advanced: {}, relays: {}, auto: true };
    try {
        const parsed = JSON.parse(value || '{}') as Partial<Record<keyof ComicStepPrefs, Record<string, unknown>>>;
        const pick = <T,>(record: Record<string, unknown> | undefined, valid: (item: unknown) => item is T): Partial<Record<ComicStepCapability, T>> =>
            Object.fromEntries(COMIC_STEP_CAPABILITIES.flatMap(capability => valid(record?.[capability]) ? [[capability, record![capability] as T]] : []));
        const text = (item: unknown): item is string => typeof item === 'string' && item.length > 0 && item.length <= 600;
        const flag = (item: unknown): item is boolean => typeof item === 'boolean';
        const global = (parsed as { global?: unknown }).global;
        const auto = (parsed as { auto?: unknown }).auto;
        const choices = pick(parsed.choices, text);
        return { choices, advanced: pick(parsed.advanced, flag), relays: pick(parsed.relays, text),
            ...(text(global) ? { global } : {}),
            auto: typeof auto === 'boolean' ? auto : !Object.keys(choices).length && !text(global) };
    } catch {
        return empty;
    }
}

const sourceOrder: Readonly<Record<ComicStepSource['kind'], number>> = { official: 0, automatic: 1, local: 2, managed: 3 };

/**
 * One row per model for the simple menu. A model the user's own API serves comes from that API
 * (their key, no platform balance); otherwise from NextMux automatic routing; otherwise from the
 * best relay. Rows are ordered own API first, then by quality rank.
 */
export function simpleComicStepChoices(candidates: readonly ComicStepCandidate[]): readonly ComicStepCandidate[] {
    const best = new Map<string, ComicStepCandidate>();
    for (const candidate of candidates) {
        const id = candidate.model.trim().toLowerCase();
        const current = best.get(id);
        if (!current || sourceOrder[candidate.source.kind] < sourceOrder[current.source.kind]
            || sourceOrder[candidate.source.kind] === sourceOrder[current.source.kind] && candidate.rank < current.rank) best.set(id, candidate);
    }
    return [...best.values()].sort((left, right) => Number(left.source.kind !== 'official') - Number(right.source.kind !== 'official')
        || left.rank - right.rank || left.label.localeCompare(right.label));
}

export function defaultComicStepCandidate(candidates: readonly ComicStepCandidate[]): ComicStepCandidate | undefined {
    return simpleComicStepChoices(candidates)[0];
}

/**
 * The model a step uses: the user's choice when it still exists (by key, then by route), else the
 * same model from another source, else the recommended default.
 */
export function resolveComicStepCandidate(candidates: readonly ComicStepCandidate[], selected: string | undefined): ComicStepCandidate | undefined {
    if (selected) {
        const exact = candidates.find(candidate => candidate.key === selected)
            || candidates.find(candidate => candidate.routeId === selected || selected.endsWith(`::${candidate.routeId}`));
        if (exact) return exact;
        const model = selected.includes('::') ? undefined : selected.toLowerCase();
        const sameModel = model ? simpleComicStepChoices(candidates).find(candidate => candidate.model.toLowerCase() === model) : undefined;
        if (sameModel) return sameModel;
    }
    return defaultComicStepCandidate(candidates);
}

export interface ComicStepResolution {
    readonly candidate?: ComicStepCandidate;
    /** 'step': this step's own choice; 'global': the global relay's best model; 'recommended': the default pick. */
    readonly origin: 'step' | 'global' | 'recommended';
    /** A global relay is set but has no model for this step, so the recommended model is used. */
    readonly globalUnsupported: boolean;
}

/** The global relay's best model for this step (its own ranking), if it has one. */
export function bestComicStepCandidateFrom(candidates: readonly ComicStepCandidate[], sourceKey: string): ComicStepCandidate | undefined {
    return candidates.filter(candidate => candidate.source.key === sourceKey)
        .sort((left, right) => left.rank - right.rank || left.label.localeCompare(right.label))[0];
}

/**
 * The model a step uses: its own choice when that model still exists, else the global relay's best
 * model for the step, else the recommended one (also when the global relay cannot do this step).
 */
/**
 * 默认推荐: the user's own API first; otherwise the relay model the platform set as this kind × step's default
 * (admin → 默认模型, already swapped for a working one when its route is down); otherwise the best-ranked model.
 */
export function recommendedComicStepCandidate(candidates: readonly ComicStepCandidate[], platformDefault?: { readonly sourceKey: string; readonly model: string }): ComicStepCandidate | undefined {
    const best = defaultComicStepCandidate(candidates);
    if (!platformDefault || best?.source.kind === 'official') return best;
    const model = platformDefault.model.toLowerCase();
    return candidates.find(candidate => candidate.source.key === platformDefault.sourceKey && candidate.model.toLowerCase() === model)
        || candidates.find(candidate => candidate.source.kind === 'managed' && candidate.model.toLowerCase() === model)
        || best;
}

export function resolveComicStep(candidates: readonly ComicStepCandidate[], stored: string | undefined, globalRelay: string | undefined, auto = false,
    platformDefault?: { readonly sourceKey: string; readonly model: string }): ComicStepResolution {
    if (auto) return { candidate: recommendedComicStepCandidate(candidates, platformDefault), origin: 'recommended', globalUnsupported: false };
    if (stored) {
        const own = resolveComicStepCandidate(candidates, stored);
        const exists = own && (own.key === stored || own.routeId === stored || stored.endsWith(`::${own.routeId}`)
            || !stored.includes('::') && own.model.toLowerCase() === stored.toLowerCase());
        if (own && exists) return { candidate: own, origin: 'step', globalUnsupported: false };
    }
    if (globalRelay) {
        const best = bestComicStepCandidateFrom(candidates, globalRelay);
        if (best) return { candidate: best, origin: 'global', globalUnsupported: false };
        return { candidate: defaultComicStepCandidate(candidates), origin: 'recommended', globalUnsupported: true };
    }
    return { candidate: recommendedComicStepCandidate(candidates, platformDefault), origin: 'recommended', globalUnsupported: false };
}

type TextKey = 'text' | 'image' | 'video' | 'speech' | 'music' | 'sound_effect' | 'choose' | 'recommended' | 'advanced' | 'simple'
    | 'relay' | 'model' | 'ownApi' | 'automatic' | 'local' | 'search' | 'none' | 'addApi' | 'loading' | 'relayEmpty' | 'chooseRelay'
    | 'advancedHint' | 'relays' | 'models' | 'noMatch' | 'global' | 'follow' | 'others' | 'withSound' | 'silent' | 'refresh';
const copy: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<TextKey, string>>>> = {
    'zh-CN': { text: '文本模型', image: '图片模型', video: '视频模型', speech: '配音模型', music: '音乐模型', sound_effect: '音效模型', choose: '选择模型', recommended: '推荐',
        advanced: '高级', simple: '简洁', relay: '中转商', model: '模型', ownApi: '自有 API', automatic: '自动（最优线路）', local: '本机', search: '搜索', none: '暂无支持这一步的模型',
        addApi: '添加自有 API', loading: '正在读取模型…', relayEmpty: '该中转商没有支持这一步的模型', chooseRelay: '选择中转商', advancedHint: '按中转商选择模型',
        relays: '个中转商', models: '个模型', noMatch: '没有匹配的结果', global: '全局', follow: '跟随全局设置', others: '其他来源', withSound: '含声音', silent: '仅画面', refresh: '刷新模型列表' },
    'zh-TW': { text: '文字模型', image: '圖片模型', video: '影片模型', speech: '配音模型', music: '音樂模型', sound_effect: '音效模型', choose: '選擇模型', recommended: '推薦',
        advanced: '進階', simple: '簡潔', relay: '中轉商', model: '模型', ownApi: '自有 API', automatic: '自動（最佳線路）', local: '本機', search: '搜尋', none: '暫無支援這一步的模型',
        addApi: '新增自有 API', loading: '正在讀取模型…', relayEmpty: '此中轉商沒有支援這一步的模型', chooseRelay: '選擇中轉商', advancedHint: '依中轉商選擇模型',
        relays: '個中轉商', models: '個模型', noMatch: '沒有符合的結果', global: '全域', follow: '跟隨全域設定', others: '其他來源', withSound: '含聲音', silent: '僅畫面', refresh: '重新整理模型清單' },
    en: { text: 'Text model', image: 'Image model', video: 'Video model', speech: 'Voice model', music: 'Music model', sound_effect: 'Sound effect model', choose: 'Choose a model', recommended: 'Recommended',
        advanced: 'Advanced', simple: 'Simple', relay: 'Relay', model: 'Model', ownApi: 'Own API', automatic: 'Automatic (best route)', local: 'This computer', search: 'Search', none: 'No model can do this step yet',
        addApi: 'Add your own API', loading: 'Loading models…', relayEmpty: 'This relay has no model for this step', chooseRelay: 'Choose a relay', advancedHint: 'Choose by relay',
        relays: 'relays', models: 'models', noMatch: 'No matches', global: 'Global', follow: 'Use the global choice', others: 'Other sources', withSound: 'with sound', silent: 'picture only', refresh: 'Refresh model lists' },
    ja: { text: 'テキストモデル', image: '画像モデル', video: '動画モデル', speech: '音声モデル', music: '音楽モデル', sound_effect: '効果音モデル', choose: 'モデルを選択', recommended: 'おすすめ',
        advanced: '詳細', simple: 'シンプル', relay: '中継業者', model: 'モデル', ownApi: '自分の API', automatic: '自動（最適ルート）', local: 'このコンピュータ', search: '検索', none: 'この工程に使えるモデルがありません',
        addApi: '自分の API を追加', loading: 'モデルを読み込み中…', relayEmpty: 'この中継業者にはこの工程のモデルがありません', chooseRelay: '中継業者を選択', advancedHint: '中継業者から選ぶ',
        relays: '件の中継業者', models: '件のモデル', noMatch: '一致する項目はありません', global: '全体', follow: '全体の設定に従う', others: 'その他のソース', withSound: '音声付き', silent: '映像のみ', refresh: 'モデル一覧を更新' },
    ko: { text: '텍스트 모델', image: '이미지 모델', video: '동영상 모델', speech: '음성 모델', music: '음악 모델', sound_effect: '효과음 모델', choose: '모델 선택', recommended: '추천',
        advanced: '고급', simple: '간단히', relay: '중계사', model: '모델', ownApi: '내 API', automatic: '자동(최적 경로)', local: '이 컴퓨터', search: '검색', none: '이 단계에 쓸 수 있는 모델이 없습니다',
        addApi: '내 API 추가', loading: '모델 불러오는 중…', relayEmpty: '이 중계사에는 이 단계용 모델이 없습니다', chooseRelay: '중계사 선택', advancedHint: '중계사별로 선택',
        relays: '개 중계사', models: '개 모델', noMatch: '일치하는 항목이 없습니다', global: '전체', follow: '전체 설정 따르기', others: '다른 소스', withSound: '사운드 포함', silent: '화면만', refresh: '모델 목록 새로고침' },
    es: { text: 'Modelo de texto', image: 'Modelo de imagen', video: 'Modelo de vídeo', speech: 'Modelo de voz', music: 'Modelo de música', sound_effect: 'Modelo de efectos', choose: 'Elegir modelo', recommended: 'Recomendado',
        advanced: 'Avanzado', simple: 'Simple', relay: 'Proveedor', model: 'Modelo', ownApi: 'API propia', automatic: 'Automático (mejor ruta)', local: 'Este equipo', search: 'Buscar', none: 'Aún no hay modelos para este paso',
        addApi: 'Añadir API propia', loading: 'Cargando modelos…', relayEmpty: 'Este proveedor no tiene modelos para este paso', chooseRelay: 'Elegir proveedor', advancedHint: 'Elegir por proveedor',
        relays: 'proveedores', models: 'modelos', noMatch: 'Sin resultados', global: 'Global', follow: 'Usar la elección global', others: 'Otras fuentes', withSound: 'con sonido', silent: 'solo imagen', refresh: 'Actualizar modelos' },
    fr: { text: 'Modèle de texte', image: 'Modèle d’image', video: 'Modèle vidéo', speech: 'Modèle vocal', music: 'Modèle musical', sound_effect: 'Modèle d’effets sonores', choose: 'Choisir un modèle', recommended: 'Recommandé',
        advanced: 'Avancé', simple: 'Simple', relay: 'Fournisseur', model: 'Modèle', ownApi: 'API personnelle', automatic: 'Automatique (meilleur itinéraire)', local: 'Cet ordinateur', search: 'Rechercher', none: 'Aucun modèle pour cette étape',
        addApi: 'Ajouter une API personnelle', loading: 'Chargement des modèles…', relayEmpty: 'Ce fournisseur n’a aucun modèle pour cette étape', chooseRelay: 'Choisir un fournisseur', advancedHint: 'Choisir par fournisseur',
        relays: 'fournisseurs', models: 'modèles', noMatch: 'Aucun résultat', global: 'Global', follow: 'Suivre le choix global', others: 'Autres sources', withSound: 'avec son', silent: 'image seule', refresh: 'Actualiser les modèles' },
    de: { text: 'Textmodell', image: 'Bildmodell', video: 'Videomodell', speech: 'Sprachmodell', music: 'Musikmodell', sound_effect: 'Soundeffekt-Modell', choose: 'Modell wählen', recommended: 'Empfohlen',
        advanced: 'Erweitert', simple: 'Einfach', relay: 'Anbieter', model: 'Modell', ownApi: 'Eigene API', automatic: 'Automatisch (beste Route)', local: 'Dieser Computer', search: 'Suchen', none: 'Noch kein Modell für diesen Schritt',
        addApi: 'Eigene API hinzufügen', loading: 'Modelle werden geladen…', relayEmpty: 'Dieser Anbieter hat kein Modell für diesen Schritt', chooseRelay: 'Anbieter wählen', advancedHint: 'Nach Anbieter wählen',
        relays: 'Anbieter', models: 'Modelle', noMatch: 'Keine Treffer', global: 'Global', follow: 'Globale Auswahl verwenden', others: 'Andere Quellen', withSound: 'mit Ton', silent: 'nur Bild', refresh: 'Modelle aktualisieren' },
    'pt-BR': { text: 'Modelo de texto', image: 'Modelo de imagem', video: 'Modelo de vídeo', speech: 'Modelo de voz', music: 'Modelo de música', sound_effect: 'Modelo de efeitos', choose: 'Escolher modelo', recommended: 'Recomendado',
        advanced: 'Avançado', simple: 'Simples', relay: 'Fornecedor', model: 'Modelo', ownApi: 'API própria', automatic: 'Automático (melhor rota)', local: 'Este computador', search: 'Pesquisar', none: 'Ainda não há modelos para esta etapa',
        addApi: 'Adicionar API própria', loading: 'Carregando modelos…', relayEmpty: 'Este fornecedor não tem modelos para esta etapa', chooseRelay: 'Escolher fornecedor', advancedHint: 'Escolher por fornecedor',
        relays: 'fornecedores', models: 'modelos', noMatch: 'Nenhum resultado', global: 'Global', follow: 'Usar a escolha global', others: 'Outras fontes', withSound: 'com som', silent: 'só imagem', refresh: 'Atualizar modelos' },
    ru: { text: 'Текстовая модель', image: 'Модель изображений', video: 'Видеомодель', speech: 'Голосовая модель', music: 'Музыкальная модель', sound_effect: 'Модель звуковых эффектов', choose: 'Выбрать модель', recommended: 'Рекомендуется',
        advanced: 'Расширенно', simple: 'Просто', relay: 'Поставщик', model: 'Модель', ownApi: 'Своя API', automatic: 'Автоматически (лучший маршрут)', local: 'Этот компьютер', search: 'Поиск', none: 'Пока нет моделей для этого шага',
        addApi: 'Добавить свою API', loading: 'Загрузка моделей…', relayEmpty: 'У этого поставщика нет моделей для этого шага', chooseRelay: 'Выбрать поставщика', advancedHint: 'Выбор по поставщику',
        relays: 'поставщиков', models: 'моделей', noMatch: 'Ничего не найдено', global: 'Общий', follow: 'Как в общих настройках', others: 'Другие источники', withSound: 'со звуком', silent: 'только картинка', refresh: 'Обновить модели' },
    ar: { text: 'نموذج النص', image: 'نموذج الصور', video: 'نموذج الفيديو', speech: 'نموذج الصوت', music: 'نموذج الموسيقى', sound_effect: 'نموذج المؤثرات', choose: 'اختر نموذجًا', recommended: 'مُوصى به',
        advanced: 'متقدم', simple: 'بسيط', relay: 'المزوّد', model: 'النموذج', ownApi: 'واجهتك البرمجية', automatic: 'تلقائي (أفضل مسار)', local: 'هذا الجهاز', search: 'بحث', none: 'لا توجد نماذج لهذه الخطوة بعد',
        addApi: 'أضف واجهتك البرمجية', loading: 'جارٍ تحميل النماذج…', relayEmpty: 'لا يملك هذا المزوّد نموذجًا لهذه الخطوة', chooseRelay: 'اختر مزوّدًا', advancedHint: 'الاختيار حسب المزوّد',
        relays: 'مزوّدين', models: 'نماذج', noMatch: 'لا توجد نتائج', global: 'عام', follow: 'اتبع الاختيار العام', others: 'مصادر أخرى', withSound: 'مع صوت', silent: 'صورة فقط', refresh: 'تحديث النماذج' },
    hi: { text: 'टेक्स्ट मॉडल', image: 'इमेज मॉडल', video: 'वीडियो मॉडल', speech: 'वॉइस मॉडल', music: 'म्यूज़िक मॉडल', sound_effect: 'साउंड इफ़ेक्ट मॉडल', choose: 'मॉडल चुनें', recommended: 'अनुशंसित',
        advanced: 'उन्नत', simple: 'सरल', relay: 'रिले', model: 'मॉडल', ownApi: 'अपना API', automatic: 'स्वचालित (सर्वश्रेष्ठ मार्ग)', local: 'यह कंप्यूटर', search: 'खोजें', none: 'इस चरण के लिए अभी कोई मॉडल नहीं',
        addApi: 'अपना API जोड़ें', loading: 'मॉडल लोड हो रहे हैं…', relayEmpty: 'इस रिले में इस चरण का कोई मॉडल नहीं', chooseRelay: 'रिले चुनें', advancedHint: 'रिले के अनुसार चुनें',
        relays: 'रिले', models: 'मॉडल', noMatch: 'कोई परिणाम नहीं', global: 'वैश्विक', follow: 'वैश्विक चुनाव अपनाएँ', others: 'अन्य स्रोत', withSound: 'ध्वनि सहित', silent: 'केवल चित्र', refresh: 'मॉडल रीफ़्रेश करें' }
};

function uncheckedComicStepText(locale: NextMuxDesktopLocale, key: TextKey | 'transcription'): string {
    if (key === 'transcription') return transcriptionText(locale, 'label');
    return (copy[locale] || copy.en)[key];
}

export const COMIC_STEP_ICONS: Readonly<Record<ComicStepCapability, string>> = {
    text: 'book', image: 'file-media', video: 'device-camera-video', speech: 'mic', music: 'music', sound_effect: 'unmute', transcription: 'comment'
};

/** How a source reads in menus: own APIs are marked, automatic routing and this Mac are named. */
export function comicStepSourceLabel(locale: NextMuxDesktopLocale, source: ComicStepSource): string {
    const t = (key: TextKey): string => comicStepText(locale, key);
    return source.kind === 'automatic' ? t('automatic') : source.kind === 'local' ? t('local')
        : source.kind === 'official' ? `${t('ownApi')} · ${source.label}` : source.label;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function comicStepText(locale: Parameters<typeof uncheckedComicStepText>[0], key: Parameters<typeof uncheckedComicStepText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedComicStepText>>): string {
    return totalCopy(locale, key, language => uncheckedComicStepText(language, key, ...rest));
}
