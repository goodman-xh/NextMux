import * as React from '@theia/core/shared/react';
import * as ReactDOM from '@theia/core/shared/react-dom';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { transcriptionText } from './nextmux-transcription-locale';
import { OfferingPriceHover, offeringMultiplierBps, offeringPriceText } from './nextmux-offering-price';
import { ImeInput } from './nextmux-ime-field';
import { ModelTaxonomyTags } from './nextmux-model-taxonomy-tags';
import { relayMultiplierTag } from './nextmux-relay-picker';
import {
    COMIC_STEP_ICONS, ComicStepCandidate, ComicStepCapability, ComicStepRelay, ComicStepResolution, ComicStepSource,
    comicStepSourceLabel, comicStepText
} from './nextmux-comic-step-models';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

/**
 * “AI 模型”: one small panel where the whole comic workflow gets its models — a relay for every
 * step, and the model each step uses. The first visit opens it as a guide; closing it flies it
 * into the “AI 模型” button in the studio header, which opens it again. Each step can still pick
 * its own model in place; the panel shows those as “单独设置” with the way back.
 */

type SetupKey = 'introTitle' | 'title' | 'introLead' | 'lead' | 'relay' | 'smart' | 'smartHint' | 'covers' | 'steps' | 'own'
    | 'unsupported' | 'missing' | 'done' | 'button' | 'ready' | 'needs' | 'close' | 'unavailable'
    | 'step_text' | 'step_image' | 'step_video' | 'step_speech' | 'step_music' | 'step_sound_effect' | 'byVideo' | 'subtitlesNote';

const copy: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<SetupKey, string>>>> = {
    'zh-CN': { introTitle: '先选好 AI 模型', title: 'AI 模型', introLead: '漫剧的每一步都会用到 AI。在这里选一次，之后每一步默认使用；需要时也能在步骤里单独更换。',
        lead: '每一步默认使用这里的选择，也可以在步骤里单独更换。', relay: '全局中转商', smart: '智能推荐', smartHint: '每一步自动选最合适的模型：优先自有 API，其次最优线路',
        covers: '支持 {count}/{total} 个步骤', steps: '各步骤模型', own: '单独设置', unsupported: '{relay} 不支持这一步，已用推荐模型', missing: '暂无可用模型',
        done: '完成', button: 'AI 模型', ready: '模型已就绪', needs: '{count} 个步骤缺少模型', close: '关闭', unavailable: '已不可用', byVideo: '由视频模型 {model} 一并生成', subtitlesNote: '字幕直接取自剧本文字，不需要模型；要从音轨识别字幕，用本机识别（设置 → 下载）。',
        step_text: '剧本改编', step_image: '画面', step_video: '视频', step_speech: '配音', step_music: '音乐', step_sound_effect: '音效' },
    'zh-TW': { introTitle: '先選好 AI 模型', title: 'AI 模型', introLead: '漫劇的每一步都會用到 AI。在這裡選一次，之後每一步預設使用；需要時也能在步驟裡單獨更換。',
        lead: '每一步預設使用這裡的選擇，也可以在步驟裡單獨更換。', relay: '全域中轉商', smart: '智慧推薦', smartHint: '每一步自動選最合適的模型：優先自有 API，其次最佳線路',
        covers: '支援 {count}/{total} 個步驟', steps: '各步驟模型', own: '單獨設定', unsupported: '{relay} 不支援這一步，已使用推薦模型', missing: '暫無可用模型',
        done: '完成', button: 'AI 模型', ready: '模型已就緒', needs: '{count} 個步驟缺少模型', close: '關閉', unavailable: '已無法使用', byVideo: '由影片模型 {model} 一併生成', subtitlesNote: '字幕直接取自劇本文字，不需要模型；要從音軌辨識字幕，用本機辨識（設定 → 下載）。',
        step_text: '劇本改編', step_image: '畫面', step_video: '影片', step_speech: '配音', step_music: '音樂', step_sound_effect: '音效' },
    en: { introTitle: 'Pick your AI models first', title: 'AI models', introLead: 'Every comic step uses AI. Choose once here and every step uses it by default — you can still change any step on its own.',
        lead: 'Every step uses these by default; you can still change a step on its own.', relay: 'Relay for all steps', smart: 'Smart pick', smartHint: 'Each step picks the best model: your own API first, then the best route',
        covers: 'Covers {count} of {total} steps', steps: 'Model per step', own: 'Set for this step', unsupported: '{relay} can’t do this step; using the recommended model', missing: 'No model yet',
        done: 'Done', button: 'AI models', ready: 'Models ready', needs: '{count} steps need a model', close: 'Close', unavailable: 'no longer available', byVideo: 'Made with the video by {model}', subtitlesNote: 'Subtitles come straight from the script — no model needed. Recognising them from a sound track runs on this computer (Settings → Downloads).',
        step_text: 'Script', step_image: 'Pictures', step_video: 'Video', step_speech: 'Voice', step_music: 'Music', step_sound_effect: 'Sound effects' },
    ja: { introTitle: 'まず AI モデルを選びましょう', title: 'AI モデル', introLead: 'コミック制作の各工程で AI を使います。ここで一度選べば各工程の既定になり、必要なら工程ごとに変更できます。',
        lead: '各工程はここでの選択を既定で使います。工程ごとに変更することもできます。', relay: '全工程の中継業者', smart: 'おまかせ', smartHint: '工程ごとに最適なモデルを選択：自分の API を優先し、次に最適ルート',
        covers: '{total} 工程中 {count} 工程に対応', steps: '工程ごとのモデル', own: 'この工程だけ', unsupported: '{relay} はこの工程に対応していないため、おすすめモデルを使います', missing: '使えるモデルがありません',
        done: '完了', button: 'AI モデル', ready: 'モデル準備完了', needs: '{count} 工程でモデルが未設定', close: '閉じる', unavailable: '利用できません', byVideo: '動画モデル {model} が一緒に生成', subtitlesNote: '字幕は台本からそのまま作るのでモデルは不要です。音声からの文字起こしはこのパソコンで行います（設定 → ダウンロード）。',
        step_text: '脚本化', step_image: '画像', step_video: '動画', step_speech: '音声', step_music: '音楽', step_sound_effect: '効果音' },
    ko: { introTitle: '먼저 AI 모델을 고르세요', title: 'AI 모델', introLead: '만화 제작의 모든 단계에서 AI를 씁니다. 여기서 한 번 고르면 각 단계의 기본값이 되고, 필요하면 단계별로 바꿀 수 있습니다.',
        lead: '모든 단계가 기본으로 이 선택을 씁니다. 단계별로 바꿀 수도 있습니다.', relay: '전체 단계 중계사', smart: '스마트 추천', smartHint: '단계마다 가장 알맞은 모델 선택: 내 API 우선, 다음은 최적 경로',
        covers: '{total}단계 중 {count}단계 지원', steps: '단계별 모델', own: '이 단계만 설정', unsupported: '{relay}은(는) 이 단계를 지원하지 않아 추천 모델을 씁니다', missing: '사용할 모델이 없습니다',
        done: '완료', button: 'AI 모델', ready: '모델 준비됨', needs: '{count}개 단계에 모델이 없습니다', close: '닫기', unavailable: '더 이상 사용할 수 없음', byVideo: '동영상 모델 {model}이(가) 함께 생성', subtitlesNote: '자막은 대본에서 바로 만들어 모델이 필요 없습니다. 오디오에서 자막을 인식하려면 이 컴퓨터에서 처리합니다(설정 → 다운로드).',
        step_text: '각본', step_image: '이미지', step_video: '동영상', step_speech: '음성', step_music: '음악', step_sound_effect: '효과음' },
    es: { introTitle: 'Elige primero tus modelos de IA', title: 'Modelos de IA', introLead: 'Cada paso del cómic usa IA. Elige aquí una vez y cada paso lo usará por defecto; también puedes cambiar cualquier paso por separado.',
        lead: 'Cada paso usa esto por defecto; también puedes cambiar un paso por separado.', relay: 'Proveedor para todos los pasos', smart: 'Elección inteligente', smartHint: 'Cada paso elige el mejor modelo: primero tu API, luego la mejor ruta',
        covers: 'Cubre {count} de {total} pasos', steps: 'Modelo por paso', own: 'Solo este paso', unsupported: '{relay} no puede hacer este paso; se usa el modelo recomendado', missing: 'Aún no hay modelo',
        done: 'Listo', button: 'Modelos de IA', ready: 'Modelos listos', needs: '{count} pasos necesitan un modelo', close: 'Cerrar', unavailable: 'ya no disponible', byVideo: 'Lo genera el vídeo ({model})', subtitlesNote: 'Los subtítulos salen del guion, sin modelo. Reconocerlos desde el audio se hace en este equipo (Ajustes → Descargas).',
        step_text: 'Guion', step_image: 'Imágenes', step_video: 'Vídeo', step_speech: 'Voz', step_music: 'Música', step_sound_effect: 'Efectos de sonido' },
    fr: { introTitle: 'Choisissez d’abord vos modèles d’IA', title: 'Modèles d’IA', introLead: 'Chaque étape de la BD utilise l’IA. Choisissez ici une fois : chaque étape l’utilisera par défaut, et vous pourrez toujours modifier une étape à part.',
        lead: 'Chaque étape utilise ce choix par défaut ; vous pouvez aussi modifier une étape à part.', relay: 'Fournisseur pour toutes les étapes', smart: 'Choix intelligent', smartHint: 'Chaque étape choisit le meilleur modèle : votre API d’abord, puis le meilleur itinéraire',
        covers: 'Couvre {count} étapes sur {total}', steps: 'Modèle par étape', own: 'Pour cette étape', unsupported: '{relay} ne gère pas cette étape ; modèle recommandé utilisé', missing: 'Aucun modèle pour l’instant',
        done: 'Terminé', button: 'Modèles d’IA', ready: 'Modèles prêts', needs: '{count} étapes sans modèle', close: 'Fermer', unavailable: 'plus disponible', byVideo: 'Généré avec la vidéo ({model})', subtitlesNote: 'Les sous-titres viennent du scénario, sans modèle. Les reconnaître depuis l’audio se fait sur cet ordinateur (Réglages → Téléchargements).',
        step_text: 'Scénario', step_image: 'Images', step_video: 'Vidéo', step_speech: 'Voix', step_music: 'Musique', step_sound_effect: 'Effets sonores' },
    de: { introTitle: 'Wählen Sie zuerst Ihre KI-Modelle', title: 'KI-Modelle', introLead: 'Jeder Comic-Schritt nutzt KI. Einmal hier wählen – jeder Schritt nutzt es standardmäßig, und Sie können jeden Schritt trotzdem einzeln ändern.',
        lead: 'Jeder Schritt nutzt diese Auswahl standardmäßig; Sie können einen Schritt auch einzeln ändern.', relay: 'Anbieter für alle Schritte', smart: 'Automatische Wahl', smartHint: 'Jeder Schritt wählt das beste Modell: zuerst Ihre API, dann die beste Route',
        covers: 'Deckt {count} von {total} Schritten ab', steps: 'Modell pro Schritt', own: 'Nur dieser Schritt', unsupported: '{relay} kann diesen Schritt nicht; empfohlenes Modell wird genutzt', missing: 'Noch kein Modell',
        done: 'Fertig', button: 'KI-Modelle', ready: 'Modelle bereit', needs: '{count} Schritten fehlt ein Modell', close: 'Schließen', unavailable: 'nicht mehr verfügbar', byVideo: 'Kommt mit dem Video ({model})', subtitlesNote: 'Untertitel kommen direkt aus dem Drehbuch – kein Modell nötig. Die Erkennung aus der Tonspur läuft auf diesem Computer (Einstellungen → Downloads).',
        step_text: 'Drehbuch', step_image: 'Bilder', step_video: 'Video', step_speech: 'Stimme', step_music: 'Musik', step_sound_effect: 'Soundeffekte' },
    'pt-BR': { introTitle: 'Escolha primeiro seus modelos de IA', title: 'Modelos de IA', introLead: 'Cada etapa do quadrinho usa IA. Escolha aqui uma vez e cada etapa usará por padrão; você ainda pode trocar qualquer etapa separadamente.',
        lead: 'Cada etapa usa esta escolha por padrão; você também pode trocar uma etapa separadamente.', relay: 'Fornecedor para todas as etapas', smart: 'Escolha inteligente', smartHint: 'Cada etapa escolhe o melhor modelo: sua API primeiro, depois a melhor rota',
        covers: 'Cobre {count} de {total} etapas', steps: 'Modelo por etapa', own: 'Só nesta etapa', unsupported: '{relay} não faz esta etapa; usando o modelo recomendado', missing: 'Ainda sem modelo',
        done: 'Concluir', button: 'Modelos de IA', ready: 'Modelos prontos', needs: '{count} etapas sem modelo', close: 'Fechar', unavailable: 'não está mais disponível', byVideo: 'Gerado junto com o vídeo ({model})', subtitlesNote: 'As legendas vêm do roteiro, sem modelo. Reconhecê-las do áudio é feito neste computador (Ajustes → Downloads).',
        step_text: 'Roteiro', step_image: 'Imagens', step_video: 'Vídeo', step_speech: 'Voz', step_music: 'Música', step_sound_effect: 'Efeitos sonoros' },
    ru: { introTitle: 'Сначала выберите модели ИИ', title: 'Модели ИИ', introLead: 'Каждый шаг комикса использует ИИ. Выберите здесь один раз — это станет выбором по умолчанию, а любой шаг можно изменить отдельно.',
        lead: 'Каждый шаг по умолчанию использует этот выбор; любой шаг можно изменить отдельно.', relay: 'Поставщик для всех шагов', smart: 'Умный выбор', smartHint: 'Каждый шаг выбирает лучшую модель: сначала ваша API, затем лучший маршрут',
        covers: 'Покрывает {count} из {total} шагов', steps: 'Модель для каждого шага', own: 'Только для этого шага', unsupported: '{relay} не поддерживает этот шаг; используется рекомендуемая модель', missing: 'Пока нет модели',
        done: 'Готово', button: 'Модели ИИ', ready: 'Модели готовы', needs: 'Шагов без модели: {count}', close: 'Закрыть', unavailable: 'больше недоступен', byVideo: 'Создаётся вместе с видео ({model})', subtitlesNote: 'Субтитры берутся из сценария — модель не нужна. Распознавание по звуку идёт на этом компьютере (Настройки → Загрузки).',
        step_text: 'Сценарий', step_image: 'Изображения', step_video: 'Видео', step_speech: 'Озвучка', step_music: 'Музыка', step_sound_effect: 'Звуковые эффекты' },
    ar: { introTitle: 'اختر نماذج الذكاء الاصطناعي أولًا', title: 'نماذج الذكاء الاصطناعي', introLead: 'كل خطوة في القصة المصورة تستخدم الذكاء الاصطناعي. اختر هنا مرة واحدة لتستخدمه كل خطوة افتراضيًا، ويمكنك تغيير أي خطوة بمفردها.',
        lead: 'تستخدم كل خطوة هذا الاختيار افتراضيًا، ويمكنك تغيير أي خطوة بمفردها.', relay: 'المزوّد لكل الخطوات', smart: 'اختيار ذكي', smartHint: 'تختار كل خطوة أفضل نموذج: واجهتك البرمجية أولًا ثم أفضل مسار',
        covers: 'يدعم {count} من {total} خطوات', steps: 'نموذج كل خطوة', own: 'لهذه الخطوة فقط', unsupported: '{relay} لا يدعم هذه الخطوة؛ سيُستخدم النموذج المُوصى به', missing: 'لا يوجد نموذج بعد',
        done: 'تم', button: 'نماذج الذكاء الاصطناعي', ready: 'النماذج جاهزة', needs: '{count} خطوات بلا نموذج', close: 'إغلاق', unavailable: 'لم يعد متاحًا', byVideo: 'يُنشأ مع الفيديو ({model})', subtitlesNote: 'الترجمة تُؤخذ من النص مباشرة دون نموذج، والتعرّف عليها من الصوت يتم على هذا الجهاز (الإعدادات ← التنزيلات).',
        step_text: 'السيناريو', step_image: 'الصور', step_video: 'الفيديو', step_speech: 'الصوت', step_music: 'الموسيقى', step_sound_effect: 'المؤثرات الصوتية' },
    hi: { introTitle: 'पहले अपने AI मॉडल चुनें', title: 'AI मॉडल', introLead: 'कॉमिक का हर चरण AI का उपयोग करता है। यहाँ एक बार चुनें — हर चरण डिफ़ॉल्ट रूप से इसे उपयोग करेगा, और आप किसी भी चरण को अलग से बदल सकते हैं।',
        lead: 'हर चरण डिफ़ॉल्ट रूप से यही चुनाव उपयोग करता है; आप किसी चरण को अलग से भी बदल सकते हैं।', relay: 'सभी चरणों के लिए रिले', smart: 'स्मार्ट चुनाव', smartHint: 'हर चरण सबसे अच्छा मॉडल चुनता है: पहले आपका API, फिर सर्वश्रेष्ठ मार्ग',
        covers: '{total} में से {count} चरण', steps: 'हर चरण का मॉडल', own: 'सिर्फ़ इस चरण के लिए', unsupported: '{relay} यह चरण नहीं कर सकता; अनुशंसित मॉडल उपयोग हो रहा है', missing: 'अभी कोई मॉडल नहीं',
        done: 'हो गया', button: 'AI मॉडल', ready: 'मॉडल तैयार', needs: '{count} चरणों में मॉडल नहीं है', close: 'बंद करें', unavailable: 'अब उपलब्ध नहीं', byVideo: 'वीडियो मॉडल {model} के साथ बनता है', subtitlesNote: 'उपशीर्षक सीधे पटकथा से आते हैं — मॉडल की ज़रूरत नहीं। ऑडियो से पहचान इसी कंप्यूटर पर होती है (सेटिंग्स → डाउनलोड)।',
        step_text: 'पटकथा', step_image: 'चित्र', step_video: 'वीडियो', step_speech: 'आवाज़', step_music: 'संगीत', step_sound_effect: 'साउंड इफ़ेक्ट' }
};

function uncheckedComicModelSetupText(locale: NextMuxDesktopLocale, key: SetupKey, values: Readonly<Record<string, string | number>> = {}): string {
    if (key === 'subtitlesNote') return transcriptionText(locale, 'hint');
    return (copy[locale] || copy.en)[key].replace(/\{(\w+)\}/g, (match, name: string) => name in values ? String(values[name]) : match);
}

/** A step's name (剧本改编、画面、视频…). */
export function comicStepName(locale: NextMuxDesktopLocale, capability: ComicStepCapability): string {
    if (capability === 'transcription') return transcriptionText(locale, 'label');
    return comicModelSetupText(locale, `step_${capability}` as SetupKey);
}

/** Steps without which a comic cannot be made from a story (music and effects are optional). */
export const COMIC_CORE_STEPS: readonly ComicStepCapability[] = ['text', 'image', 'video'];

export interface ComicModelSetupStep {
    readonly capability: ComicStepCapability;
    readonly candidates: readonly ComicStepCandidate[];
    readonly resolution: ComicStepResolution;
}

/** The header button's summary: 默认推荐 or 手动选择, and how many core steps lack a model. */
export function comicModelSetupSummary(locale: NextMuxDesktopLocale, steps: readonly ComicModelSetupStep[], auto: boolean):
    { readonly relay: string; readonly missing: number } {
    return {
        relay: comicModelPanelText(locale, auto ? 'auto' : 'manual'),
        missing: steps.filter(step => COMIC_CORE_STEPS.includes(step.capability) && !step.resolution.candidate).length
    };
}

type PanelKey = 'auto' | 'autoOn' | 'autoOff' | 'relays' | 'ownApis' | 'recommended' | 'ownEmpty' | 'relayEmpty' | 'covered' | 'missingSteps'
    | 'manual' | 'loadRelay' | 'loadingRelay' | 'selected' | 'change' | 'sourceTitle' | 'sourceHint' | 'modelsTitle' | 'search' | 'noSource' | 'sourceLacks'
    | 'usingOther' | 'appliesNow' | 'useForAll' | 'useForAllHint' | 'changeSource' | 'ownNone' | 'relayNone';

/** The panel's own words: one switch, then (when it is off) steps on the left and relay / own-API tabs on the right. */
const panelCopy: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<PanelKey, string>>>> = {
    'zh-CN': { auto: '默认推荐', autoOn: '每一步自动使用推荐模型：优先你的自有 API，其次最优中转线路。', autoOff: '关闭后，在下面按步骤选择模型。',
        relays: '中转商', ownApis: '自有 API', recommended: '推荐', ownEmpty: '还没有能做这一步的自有 API', relayEmpty: '暂无中转商提供这类模型',
        covered: '现在由视频模型 {model} 一并生成；也可以在下面单独选一个模型。', missingSteps: '{steps} 暂无可用模型', manual: '手动选择',
        loadRelay: '查看模型', loadingRelay: '加载中…', selected: '已选', change: '更换',
        sourceTitle: '选择来源', sourceHint: '先选中转商或自有 API，下面只列出它提供的模型。', modelsTitle: '为每个功能选模型', search: '搜索中转商', noSource: '先在上面选一个来源', sourceLacks: '{source} 没有{step}模型', usingOther: '当前使用 {model}（{source}）', appliesNow: '选中即生效', useForAll: '用于全部', useForAllHint: '同时用于：{list}', changeSource: '换个来源', ownNone: '还没有自有 API', relayNone: '没有找到中转商' },
    'zh-TW': { auto: '預設推薦', autoOn: '每一步自動使用推薦模型：優先你的自有 API，其次最佳中轉線路。', autoOff: '關閉後，在下方依步驟選擇模型。',
        relays: '中轉商', ownApis: '自有 API', recommended: '推薦', ownEmpty: '還沒有能做這一步的自有 API', relayEmpty: '暫無中轉商提供這類模型',
        covered: '目前由影片模型 {model} 一併生成；也可以在下方單獨選一個模型。', missingSteps: '{steps} 暫無可用模型', manual: '手動選擇',
        loadRelay: '查看模型', loadingRelay: '載入中…', selected: '已選', change: '更換',
        sourceTitle: '選擇來源', sourceHint: '先選中轉商或自有 API，下方只列出它提供的模型。', modelsTitle: '為每個功能選模型', search: '搜尋中轉商', noSource: '先在上方選一個來源', sourceLacks: '{source} 沒有{step}模型', usingOther: '目前使用 {model}（{source}）', appliesNow: '選中即生效', useForAll: '用於全部', useForAllHint: '同時用於：{list}', changeSource: '換個來源', ownNone: '還沒有自有 API', relayNone: '找不到中轉商' },
    en: { auto: 'Recommended', autoOn: 'Every step uses the recommended model: your own API first, then the best relay route.', autoOff: 'Pick a model for each step below.',
        relays: 'Relays', ownApis: 'Own APIs', recommended: 'Recommended', ownEmpty: 'None of your own APIs can do this step yet', relayEmpty: 'No relay offers this kind of model yet',
        covered: 'Made with the video by {model} for now; you can still pick a model of its own below.', missingSteps: 'No model yet for {steps}', manual: 'Chosen by step',
        loadRelay: 'Show models', loadingRelay: 'Loading…', selected: 'Selected', change: 'Change',
        sourceTitle: 'Choose a source', sourceHint: 'Pick a relay or one of your own APIs first; only its models are listed below.', modelsTitle: 'A model for each function', search: 'Search relays', noSource: 'Choose a source above first', sourceLacks: '{source} has no {step} model', usingOther: 'Using {model} ({source}) for now', appliesNow: 'Applies as soon as you pick', useForAll: 'Use for all', useForAllHint: 'Also use for: {list}', changeSource: 'Change source', ownNone: 'No own API yet', relayNone: 'No relays found' },
    ja: { auto: 'おすすめ', autoOn: '各工程でおすすめモデルを自動で使います：自分の API を優先し、次に最適な中継ルート。', autoOff: '下で工程ごとにモデルを選びます。',
        relays: '中継業者', ownApis: '自分の API', recommended: 'おすすめ', ownEmpty: 'この工程に使える自分の API はまだありません', relayEmpty: 'この種類のモデルを提供する中継業者はまだありません',
        covered: '今は動画モデル {model} が一緒に生成します。下で個別に選ぶこともできます。', missingSteps: '{steps} に使えるモデルがありません', manual: '工程ごとに選択',
        loadRelay: 'モデルを表示', loadingRelay: '読み込み中…', selected: '選択中', change: '変更',
        sourceTitle: 'ソースを選ぶ', sourceHint: 'まず中継業者か自分の API を選びます。下にはそのモデルだけが表示されます。', modelsTitle: '機能ごとにモデルを選ぶ', search: '中継業者を検索', noSource: 'まず上でソースを選んでください', sourceLacks: '{source} には「{step}」のモデルがありません', usingOther: '現在は {model}（{source}）を使用中', appliesNow: '選ぶとすぐ反映されます', useForAll: 'すべてに使う', useForAllHint: '次にも使う：{list}', changeSource: 'ソースを変更', ownNone: '自分の API はまだありません', relayNone: '中継業者が見つかりません' },
    ko: { auto: '기본 추천', autoOn: '모든 단계에서 추천 모델을 자동으로 씁니다: 내 API 우선, 다음은 최적 중계 경로.', autoOff: '아래에서 단계별로 모델을 고르세요.',
        relays: '중계사', ownApis: '내 API', recommended: '추천', ownEmpty: '이 단계를 할 수 있는 내 API가 아직 없습니다', relayEmpty: '이 종류의 모델을 제공하는 중계사가 아직 없습니다',
        covered: '지금은 동영상 모델 {model}이(가) 함께 생성합니다. 아래에서 따로 모델을 고를 수도 있습니다.', missingSteps: '{steps}에 사용할 모델이 없습니다', manual: '단계별 선택',
        loadRelay: '모델 보기', loadingRelay: '불러오는 중…', selected: '선택됨', change: '변경',
        sourceTitle: '소스 선택', sourceHint: '먼저 중계사나 내 API를 고르세요. 아래에는 그 모델만 표시됩니다.', modelsTitle: '기능별 모델 선택', search: '중계사 검색', noSource: '먼저 위에서 소스를 고르세요', sourceLacks: '{source}에는 {step} 모델이 없습니다', usingOther: '지금은 {model}({source}) 사용 중', appliesNow: '선택하면 바로 적용됩니다', useForAll: '모두에 사용', useForAllHint: '함께 사용: {list}', changeSource: '소스 변경', ownNone: '아직 내 API가 없습니다', relayNone: '중계사를 찾지 못했습니다' },
    es: { auto: 'Recomendado', autoOn: 'Cada paso usa el modelo recomendado: primero tu propia API y luego la mejor ruta de proveedor.', autoOff: 'Elige un modelo para cada paso abajo.',
        relays: 'Proveedores', ownApis: 'Tus API', recommended: 'Recomendado', ownEmpty: 'Ninguna de tus API puede hacer este paso todavía', relayEmpty: 'Ningún proveedor ofrece este tipo de modelo todavía',
        covered: 'Por ahora lo genera el vídeo ({model}); también puedes elegir un modelo propio abajo.', missingSteps: 'Aún no hay modelo para {steps}', manual: 'Elegido por paso',
        loadRelay: 'Ver modelos', loadingRelay: 'Cargando…', selected: 'Elegido', change: 'Cambiar',
        sourceTitle: 'Elige una fuente', sourceHint: 'Primero elige un proveedor o una de tus API; abajo solo aparecen sus modelos.', modelsTitle: 'Un modelo para cada función', search: 'Buscar proveedores', noSource: 'Primero elige una fuente arriba', sourceLacks: '{source} no tiene modelo de {step}', usingOther: 'Por ahora se usa {model} ({source})', appliesNow: 'Se aplica al elegir', useForAll: 'Usar en todo', useForAllHint: 'Usar también en: {list}', changeSource: 'Cambiar fuente', ownNone: 'Aún no tienes API propias', relayNone: 'No se encontraron proveedores' },
    fr: { auto: 'Recommandé', autoOn: 'Chaque étape utilise le modèle recommandé : votre propre API d’abord, puis le meilleur fournisseur.', autoOff: 'Choisissez un modèle par étape ci-dessous.',
        relays: 'Fournisseurs', ownApis: 'Vos API', recommended: 'Recommandé', ownEmpty: 'Aucune de vos API ne gère encore cette étape', relayEmpty: 'Aucun fournisseur ne propose encore ce type de modèle',
        covered: 'Généré pour l’instant avec la vidéo ({model}) ; vous pouvez aussi choisir un modèle dédié ci-dessous.', missingSteps: 'Pas encore de modèle pour {steps}', manual: 'Choisi par étape',
        loadRelay: 'Voir les modèles', loadingRelay: 'Chargement…', selected: 'Choisi', change: 'Changer',
        sourceTitle: 'Choisir une source', sourceHint: 'Choisissez d’abord un fournisseur ou l’une de vos API ; seuls ses modèles sont listés ci-dessous.', modelsTitle: 'Un modèle par fonction', search: 'Rechercher un fournisseur', noSource: 'Choisissez d’abord une source ci-dessus', sourceLacks: '{source} n’a pas de modèle pour « {step} »', usingOther: 'Utilise {model} ({source}) pour l’instant', appliesNow: 'Appliqué dès le choix', useForAll: 'Utiliser partout', useForAllHint: 'Utiliser aussi pour : {list}', changeSource: 'Changer de source', ownNone: 'Aucune API personnelle', relayNone: 'Aucun fournisseur trouvé' },
    de: { auto: 'Empfohlen', autoOn: 'Jeder Schritt nutzt das empfohlene Modell: zuerst Ihre eigene API, dann die beste Anbieter-Route.', autoOff: 'Wählen Sie unten für jeden Schritt ein Modell.',
        relays: 'Anbieter', ownApis: 'Eigene APIs', recommended: 'Empfohlen', ownEmpty: 'Noch keine eigene API kann diesen Schritt', relayEmpty: 'Noch kein Anbieter bietet diese Modellart an',
        covered: 'Kommt vorerst mit dem Video ({model}); Sie können unten auch ein eigenes Modell wählen.', missingSteps: 'Noch kein Modell für {steps}', manual: 'Pro Schritt gewählt',
        loadRelay: 'Modelle zeigen', loadingRelay: 'Wird geladen…', selected: 'Gewählt', change: 'Ändern',
        sourceTitle: 'Quelle wählen', sourceHint: 'Wählen Sie zuerst einen Anbieter oder eine eigene API; unten stehen nur deren Modelle.', modelsTitle: 'Ein Modell pro Funktion', search: 'Anbieter suchen', noSource: 'Wählen Sie zuerst oben eine Quelle', sourceLacks: '{source} hat kein Modell für „{step}“', usingOther: 'Vorerst {model} ({source})', appliesNow: 'Gilt sofort nach der Auswahl', useForAll: 'Für alle nutzen', useForAllHint: 'Auch nutzen für: {list}', changeSource: 'Quelle ändern', ownNone: 'Noch keine eigene API', relayNone: 'Keine Anbieter gefunden' },
    'pt-BR': { auto: 'Recomendado', autoOn: 'Cada etapa usa o modelo recomendado: primeiro sua própria API, depois a melhor rota de fornecedor.', autoOff: 'Escolha um modelo para cada etapa abaixo.',
        relays: 'Fornecedores', ownApis: 'Suas APIs', recommended: 'Recomendado', ownEmpty: 'Nenhuma das suas APIs faz esta etapa ainda', relayEmpty: 'Nenhum fornecedor oferece este tipo de modelo ainda',
        covered: 'Por enquanto é gerado com o vídeo ({model}); você também pode escolher um modelo próprio abaixo.', missingSteps: 'Ainda sem modelo para {steps}', manual: 'Escolhido por etapa',
        loadRelay: 'Ver modelos', loadingRelay: 'Carregando…', selected: 'Escolhido', change: 'Trocar',
        sourceTitle: 'Escolha uma fonte', sourceHint: 'Primeiro escolha um fornecedor ou uma das suas APIs; abaixo só aparecem os modelos dela.', modelsTitle: 'Um modelo para cada função', search: 'Buscar fornecedores', noSource: 'Escolha uma fonte acima primeiro', sourceLacks: '{source} não tem modelo de {step}', usingOther: 'Usando {model} ({source}) por enquanto', appliesNow: 'Aplica-se ao escolher', useForAll: 'Usar em tudo', useForAllHint: 'Usar também em: {list}', changeSource: 'Trocar fonte', ownNone: 'Nenhuma API própria ainda', relayNone: 'Nenhum fornecedor encontrado' },
    ru: { auto: 'Рекомендуемые', autoOn: 'Каждый шаг использует рекомендуемую модель: сначала ваша API, затем лучший маршрут поставщика.', autoOff: 'Выберите модель для каждого шага ниже.',
        relays: 'Поставщики', ownApis: 'Свои API', recommended: 'Рекомендуем', ownEmpty: 'Ни одна ваша API пока не умеет этот шаг', relayEmpty: 'Пока ни один поставщик не предлагает такие модели',
        covered: 'Пока создаётся вместе с видео ({model}); ниже можно выбрать отдельную модель.', missingSteps: 'Нет модели для: {steps}', manual: 'Выбор по шагам',
        loadRelay: 'Показать модели', loadingRelay: 'Загрузка…', selected: 'Выбрано', change: 'Изменить',
        sourceTitle: 'Выберите источник', sourceHint: 'Сначала выберите поставщика или свою API; ниже показаны только их модели.', modelsTitle: 'Модель для каждой функции', search: 'Поиск поставщиков', noSource: 'Сначала выберите источник выше', sourceLacks: 'У {source} нет модели для «{step}»', usingOther: 'Пока используется {model} ({source})', appliesNow: 'Применяется сразу после выбора', useForAll: 'Для всех', useForAllHint: 'Использовать также для: {list}', changeSource: 'Сменить источник', ownNone: 'Своих API пока нет', relayNone: 'Поставщики не найдены' },
    ar: { auto: 'المُوصى به', autoOn: 'تستخدم كل خطوة النموذج المُوصى به: واجهتك البرمجية أولًا ثم أفضل مسار لدى المزوّدين.', autoOff: 'اختر نموذجًا لكل خطوة أدناه.',
        relays: 'المزوّدون', ownApis: 'واجهاتك البرمجية', recommended: 'مُوصى به', ownEmpty: 'لا توجد واجهة برمجية خاصة بك تدعم هذه الخطوة بعد', relayEmpty: 'لا يوجد مزوّد يقدّم هذا النوع من النماذج بعد',
        covered: 'يُنشأ حاليًا مع الفيديو ({model})، ويمكنك اختيار نموذج خاص به أدناه.', missingSteps: 'لا يوجد نموذج بعد لـ {steps}', manual: 'اختيار لكل خطوة',
        loadRelay: 'عرض النماذج', loadingRelay: 'جارٍ التحميل…', selected: 'مُختار', change: 'تغيير',
        sourceTitle: 'اختر المصدر', sourceHint: 'اختر أولًا مزوّدًا أو إحدى واجهاتك البرمجية؛ تظهر أدناه نماذجه فقط.', modelsTitle: 'نموذج لكل وظيفة', search: 'ابحث عن مزوّد', noSource: 'اختر مصدرًا في الأعلى أولًا', sourceLacks: 'لا يملك {source} نموذجًا لـ«{step}»', usingOther: 'يُستخدم {model} ({source}) حاليًا', appliesNow: 'يُطبَّق فور الاختيار', useForAll: 'استخدمه للكل', useForAllHint: 'استخدمه أيضًا لـ: {list}', changeSource: 'غيّر المصدر', ownNone: 'لا توجد واجهة برمجية خاصة بعد', relayNone: 'لم يُعثر على مزوّدين' },
    hi: { auto: 'अनुशंसित', autoOn: 'हर चरण अनुशंसित मॉडल उपयोग करता है: पहले आपका अपना API, फिर सबसे अच्छा रिले मार्ग।', autoOff: 'नीचे हर चरण के लिए मॉडल चुनें।',
        relays: 'रिले', ownApis: 'अपने API', recommended: 'अनुशंसित', ownEmpty: 'आपका कोई API अभी यह चरण नहीं कर सकता', relayEmpty: 'अभी कोई रिले ऐसा मॉडल नहीं देता',
        covered: 'अभी वीडियो मॉडल {model} के साथ बनता है; नीचे अलग मॉडल भी चुन सकते हैं।', missingSteps: '{steps} के लिए अभी कोई मॉडल नहीं', manual: 'चरण के अनुसार चुना',
        loadRelay: 'मॉडल देखें', loadingRelay: 'लोड हो रहा है…', selected: 'चुना गया', change: 'बदलें',
        sourceTitle: 'स्रोत चुनें', sourceHint: 'पहले कोई रिले या अपना API चुनें; नीचे सिर्फ़ उसी के मॉडल दिखते हैं।', modelsTitle: 'हर काम के लिए मॉडल', search: 'रिले खोजें', noSource: 'पहले ऊपर कोई स्रोत चुनें', sourceLacks: '{source} के पास {step} का मॉडल नहीं है', usingOther: 'अभी {model} ({source}) इस्तेमाल हो रहा है', appliesNow: 'चुनते ही लागू हो जाता है', useForAll: 'सब में इस्तेमाल करें', useForAllHint: 'इनमें भी इस्तेमाल करें: {list}', changeSource: 'स्रोत बदलें', ownNone: 'अभी कोई अपना API नहीं', relayNone: 'कोई रिले नहीं मिला' }
};

function uncheckedComicModelPanelText(locale: NextMuxDesktopLocale, key: PanelKey, values: Readonly<Record<string, string | number>> = {}): string {
    return (panelCopy[locale] || panelCopy.en)[key].replace(/\{(\w+)\}/g, (match, name: string) => name in values ? String(values[name]) : match);
}

/** Which tab a model belongs to: relays (NextMux routing and merchants) or the user's own (own APIs and this Mac). */
export function comicSetupTab(candidate: Pick<ComicStepCandidate, 'source'>): 'relay' | 'own' {
    return candidate.source.kind === 'official' || candidate.source.kind === 'local' ? 'own' : 'relay';
}

/**
 * One tab's list, grouped by where the models come from, recommended first: NextMux automatic routing
 * leads the relays, then each relay (its best model first); own APIs by their best model, this Mac last.
 */
export function comicSetupGroups(candidates: readonly ComicStepCandidate[], tab: 'relay' | 'own'):
    readonly { readonly source: ComicStepSource; readonly candidates: readonly ComicStepCandidate[] }[] {
    const bySource = new Map<string, { source: ComicStepSource; candidates: ComicStepCandidate[] }>();
    for (const candidate of candidates) {
        if (comicSetupTab(candidate) !== tab) continue;
        const entry = bySource.get(candidate.source.key) || { source: candidate.source, candidates: [] };
        entry.candidates.push(candidate);
        bySource.set(candidate.source.key, entry);
    }
    const kindOrder: Readonly<Record<ComicStepSource['kind'], number>> = { automatic: 0, official: 0, managed: 1, local: 2 };
    const groups = [...bySource.values()].map(entry => ({ source: entry.source,
        candidates: [...entry.candidates].sort((left, right) => left.rank - right.rank || left.label.localeCompare(right.label)) }));
    return groups.sort((left, right) => kindOrder[left.source.kind] - kindOrder[right.source.kind]
        || left.candidates[0].rank - right.candidates[0].rank || left.source.label.localeCompare(right.source.label));
}

/** One place models come from, as the panel's source list shows it. */
export interface ComicSetupSource {
    readonly key: string;
    readonly kind: ComicStepSource['kind'];
    readonly label: string;
    /** Functions it has a model for. */
    readonly steps: readonly ComicStepCapability[];
    /** Functions the relay directory lists it for whose models are not loaded yet. */
    readonly listed: readonly ComicStepCapability[];
    /** Its best model's rank (lower is better). */
    readonly rank: number;
}

/**
 * The sources of one tab — relays (NextMux routing first) or the user's own APIs and this Mac — each with the
 * functions of this kind it can do, the most capable first. Relays the directory knows but whose models are not
 * loaded yet are listed too (with the functions they are listed for), so choosing one can load it.
 */
export function comicSetupSources(steps: readonly ComicModelSetupStep[], tab: 'relay' | 'own',
    pending: Partial<Record<ComicStepCapability, readonly ComicStepRelay[]>> = {}): readonly ComicSetupSource[] {
    const order = steps.map(step => step.capability);
    const bySource = new Map<string, { key: string; kind: ComicStepSource['kind']; label: string; steps: Set<ComicStepCapability>; listed: Set<ComicStepCapability>; rank: number }>();
    for (const step of steps) for (const candidate of step.candidates) {
        if (comicSetupTab(candidate) !== tab) continue;
        const entry = bySource.get(candidate.source.key) || { key: candidate.source.key, kind: candidate.source.kind, label: candidate.source.label, steps: new Set(), listed: new Set(), rank: Number.MAX_SAFE_INTEGER };
        entry.steps.add(step.capability);
        entry.rank = Math.min(entry.rank, candidate.rank);
        bySource.set(entry.key, entry);
    }
    if (tab === 'relay') for (const step of steps) for (const relay of pending[step.capability] || []) {
        const entry = bySource.get(relay.key) || { key: relay.key, kind: 'managed' as const, label: relay.label, steps: new Set<ComicStepCapability>(), listed: new Set<ComicStepCapability>(), rank: Number.MAX_SAFE_INTEGER };
        if (!entry.steps.has(step.capability)) entry.listed.add(step.capability);
        bySource.set(entry.key, entry);
    }
    const kindOrder: Readonly<Record<ComicStepSource['kind'], number>> = { automatic: 0, official: 0, managed: 1, local: 2 };
    const sorted = (set: Set<ComicStepCapability>): ComicStepCapability[] => order.filter(capability => set.has(capability));
    return [...bySource.values()].map(entry => ({ key: entry.key, kind: entry.kind, label: entry.label, steps: sorted(entry.steps), listed: sorted(entry.listed), rank: entry.rank }))
        .sort((left, right) => kindOrder[left.kind] - kindOrder[right.kind] || right.steps.length - left.steps.length
            || right.listed.length - left.listed.length || left.rank - right.rank || left.label.localeCompare(right.label));
}

/** The source the panel shows models from: the one chosen, else where the first step's model comes from. */
export function comicSetupChosenSource(steps: readonly ComicModelSetupStep[], chosen: string | undefined): string {
    return chosen || steps.map(step => step.resolution.candidate?.source.key).find(Boolean) || '';
}

export interface ComicModelSetupProps {
    readonly locale: NextMuxDesktopLocale;
    readonly themeClass: string;
    /** First visit: a guide title and lead. */
    readonly intro: boolean;
    readonly steps: readonly ComicModelSetupStep[];
    /** Step names where the work differs (the music studio calls the text step “写词”). */
    readonly stepLabels?: Partial<Record<ComicStepCapability, string>>;
    /** Which kind these choices belong to (each of the four kinds keeps its own), shown beside the title. */
    readonly scopeLabel?: string;
    /** The chosen video model when it also makes the sound: voice, music and effects then come with the video. */
    readonly soundVideoModel?: string;
    /** Re-read every model list (new models, their classification). */
    readonly onRefresh?: () => void;
    readonly refreshing?: boolean;
    /** “默认推荐”: every step uses the recommended model and the steps are hidden. */
    readonly auto: boolean;
    /** The source chosen in step 1 (a relay, NextMux routing, an own API or this Mac); every function follows it. */
    readonly source?: string;
    /** The function to show first (from a “更换” link). */
    readonly focus?: ComicStepCapability;
    /** Relays known to have such models whose model lists are not loaded yet. */
    readonly pendingRelays?: Partial<Record<ComicStepCapability, readonly ComicStepRelay[]>>;
    /** The relay whose models are being read. */
    readonly loadingRelayKey?: string;
    readonly busy?: boolean;
    /** The header button the panel flies out of and back into. */
    readonly anchorSelector: string;
    /** Incremented by the owner (the header button) to close with the same animation. */
    readonly closeRequest?: number;
    readonly onAutoChange: (auto: boolean) => void;
    readonly onSourceSelect: (sourceKey: string) => void;
    readonly onStepSelect: (capability: ComicStepCapability, candidateKey: string) => void;
    /** 用于全部: the same model for every function it serves at this source. */
    readonly onStepSelectMany: (choices: Partial<Record<ComicStepCapability, string>>) => void;
    readonly onAddApi: () => void;
    /** Called once the panel has flown into the button. */
    readonly onClose: () => void;
}

const SOURCE_ICONS: Readonly<Record<ComicStepSource['kind'], string>> = { automatic: 'sparkle', managed: 'server-environment', official: 'key', local: 'vm' };

const SOUND_EVIDENCE = new Set(['video_native_audio', 'with_audio', 'native_audio']);

/**
 * What the shared taxonomy reads for a candidate: its relay offering, or its id filed under the step's category, with
 * the studio's own sound verdict for video (`withSound`) deciding the "with audio" badge either way.
 */
export function comicCandidateTaxonomyFacts(candidate: Pick<ComicStepCandidate, 'model' | 'label' | 'withSound' | 'offering'>, capability: ComicStepCapability): object {
    const base = candidate.offering ?? { id: candidate.model, label: candidate.label, kind: capability === 'text' ? 'llm' : capability, capabilities: [] as readonly string[], output: [] as readonly string[] };
    if (candidate.withSound === undefined) return base;
    const capabilities = base.capabilities.filter(value => !SOUND_EVIDENCE.has(value.toLowerCase()));
    return { ...base, capabilities: candidate.withSound ? [...capabilities, 'video_native_audio'] : capabilities,
        output: candidate.withSound ? base.output : base.output.filter(value => value.toLowerCase() !== 'audio') };
}

/**
 * The panel works like the comic conversation's model picker: first where the models come from (a relay or an own
 * API), then a model for each function from that source. A function the source cannot do says so and shows what
 * is used meanwhile. Closing flies the panel back into its button; nothing here re-renders the app while it moves.
 */
export function ComicModelSetup(props: ComicModelSetupProps): React.ReactElement {
    const t = (key: SetupKey, values?: Readonly<Record<string, string | number>>): string => comicModelSetupText(props.locale, key, values);
    const p = (key: PanelKey, values?: Readonly<Record<string, string | number>>): string => comicModelPanelText(props.locale, key, values);
    const panel = React.useRef<HTMLElement>(null);
    const sourceList = React.useRef<HTMLDivElement>(null);
    const [phase, setPhase] = React.useState<'enter' | 'open' | 'leave'>('enter');
    const [place, setPlace] = React.useState<{ top: number; side: number; maxHeight: number }>();
    const [active, setActive] = React.useState<ComicStepCapability>(props.focus || props.steps[0]?.capability || 'text');
    const chosen = comicSetupChosenSource(props.steps, props.source);
    const chosenKind = props.steps.flatMap(step => step.candidates).find(candidate => candidate.source.key === chosen);
    const [tab, setTab] = React.useState<'relay' | 'own'>(chosenKind ? comicSetupTab(chosenKind) : chosen === 'local' || chosen.startsWith('official:') ? 'own' : 'relay');
    const [query, setQuery] = React.useState('');
    // Once a source is chosen the list folds into one row with 更换, as the conversation's relay button does.
    const [picking, setPicking] = React.useState(!chosen);
    React.useEffect(() => { if (!chosen) setPicking(true); }, [chosen]);
    const rtl = props.locale === 'ar';
    const leaving = React.useRef(false);
    /** Where the button is relative to the panel's centre, measured while nothing moves (never at close time). */
    const flight = React.useRef<{ x: number; y: number }>({ x: 0, y: -24 });
    const id = React.useId();
    const onClose = React.useRef(props.onClose);
    onClose.current = props.onClose;
    React.useEffect(() => { if (props.focus) setActive(props.focus); }, [props.focus]);

    const anchor = (): HTMLElement | undefined => document.querySelector<HTMLElement>(props.anchorSelector) || undefined;
    const measure = React.useCallback((): void => {
        const rect = anchor()?.getBoundingClientRect();
        const top = rect && rect.height ? Math.round(rect.bottom + 10) : 64;
        // Aligned with the button's outer edge (the header's end: right, or left in RTL).
        const side = rect && rect.width ? Math.max(12, Math.round(rtl ? rect.left : window.innerWidth - rect.right)) : 20;
        setPlace(previous => previous && previous.top === top && previous.side === side && previous.maxHeight === Math.max(240, window.innerHeight - top - 16)
            ? previous : { top, side, maxHeight: Math.max(240, window.innerHeight - top - 16) });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.anchorSelector]);
    /** The panel rests at `place`, so its centre follows from its box size alone: no transform has to be undone to measure it. */
    const aim = (): void => {
        const node = panel.current;
        if (!node || !place) return;
        const target = anchor()?.getBoundingClientRect();
        const width = node.offsetWidth, height = node.offsetHeight;
        const centerX = rtl ? place.side + width / 2 : window.innerWidth - place.side - width / 2;
        const centerY = place.top + height / 2;
        flight.current = { x: target && target.width ? Math.round(target.left + target.width / 2 - centerX) : 0, y: target && target.height ? Math.round(target.top + target.height / 2 - centerY) : -24 };
        node.style.setProperty('--nmx-fly-x', `${flight.current.x}px`);
        node.style.setProperty('--nmx-fly-y', `${flight.current.y}px`);
    };
    const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const close = React.useCallback((): void => {
        if (leaving.current) return;
        leaving.current = true;
        // The flight was measured when the panel settled; closing only flips a class (compositor-only transform).
        setPhase('leave');
        window.setTimeout(() => onClose.current(), reducedMotion() ? 0 : 260);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    React.useLayoutEffect(() => { measure(); }, [measure]);
    // The panel's height changes with the tab and function shown: keep the flight to the button current.
    React.useLayoutEffect(() => { if (phase === 'open') aim(); }, [phase, active, tab, props.auto]); // eslint-disable-line react-hooks/exhaustive-deps
    React.useLayoutEffect(() => {
        if (!place) return;
        aim();
        if (phase !== 'enter') return;
        const frame = requestAnimationFrame(() => requestAnimationFrame(() => { setPhase('open'); panel.current?.focus({ preventScroll: true }); }));
        return () => cancelAnimationFrame(frame);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [place]);
    React.useEffect(() => {
        // Any press outside the panel (the page, the conversation box, the sidebar) closes it; the press still
        // reaches what was pressed. Other model pickers' own portals (price cards) count as inside.
        const outside = (event: Event): void => {
            const target = event.target as Element | null;
            if (!target || panel.current?.contains(target) || target.closest?.('.nmx-offering-price-pop') || anchor()?.contains(target)) return;
            close();
        };
        let frame = 0;
        const resize = (): void => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
        document.addEventListener('pointerdown', outside, true);
        window.addEventListener('resize', resize);
        return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', resize); cancelAnimationFrame(frame); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [close, measure]);
    const firstRequest = React.useRef(props.closeRequest);
    React.useEffect(() => { if (props.closeRequest !== firstRequest.current) close(); }, [props.closeRequest, close]);

    const keyDown = (event: React.KeyboardEvent): void => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close(); }
    };
    // comicStepName also names 字幕识别 (transcription), which has no step_* key of its own.
    const label = (capability: ComicStepCapability): string => props.stepLabels?.[capability] || comicStepName(props.locale, capability);
    const coveredBy = (step: ComicModelSetupStep): boolean => Boolean(props.soundVideoModel) && step.resolution.origin !== 'step'
        && ['speech', 'music', 'sound_effect'].includes(step.capability);
    const missing = props.steps.filter(step => COMIC_CORE_STEPS.includes(step.capability) && !step.resolution.candidate && !coveredBy(step));
    const step = props.steps.find(item => item.capability === active) || props.steps[0];
    const pending = props.pendingRelays || {};
    const relaySources = React.useMemo(() => comicSetupSources(props.steps, 'relay', pending), [props.steps, pending]);
    const ownSources = React.useMemo(() => comicSetupSources(props.steps, 'own'), [props.steps]);
    const sources = tab === 'relay' ? relaySources : ownSources;
    const needle = query.trim().toLocaleLowerCase();
    const shown = needle ? sources.filter(source => sourceName(source).toLocaleLowerCase().includes(needle)) : sources;
    const chosenSource = [...relaySources, ...ownSources].find(source => source.key === chosen);
    const loadingChosen = Boolean(chosen) && props.loadingRelayKey === chosen;
    function sourceName(source: Pick<ComicStepSource, 'kind' | 'label'>): string {
        return source.kind === 'automatic' ? comicStepText(props.locale, 'automatic') : source.kind === 'local' ? comicStepText(props.locale, 'local') : source.label;
    }
    // The chosen source scrolls into view when the list opens.
    React.useEffect(() => {
        if (picking) sourceList.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    }, [tab, picking]);
    const choose = (key: string): void => { props.onSourceSelect(key); setPicking(false); setQuery(''); };
    const openSources = (): void => {
        setPicking(true);
        requestAnimationFrame(() => sourceList.current?.querySelector<HTMLElement>('[aria-selected="true"], button')?.focus({ preventScroll: false }));
    };
    const sourceIcon = (source: ComicSetupSource): React.ReactNode => <span className='nmx-comic-setup-source-icon' aria-hidden='true'><i className={`codicon codicon-${SOURCE_ICONS[source.kind]}`}></i></span>;
    const sourceCopy = (source: ComicSetupSource): React.ReactNode => <span className='nmx-comic-setup-source-copy'>
        <strong data-nmx-literal={source.kind === 'managed' || source.kind === 'official' || undefined}>{sourceName(source)}</strong>
        <span className='nmx-comic-setup-caps'>
            {source.steps.map(capability => <em key={capability}>{label(capability)}</em>)}
            {source.listed.map(capability => <em key={capability} className='is-listed'>{label(capability)}</em>)}
        </span>
    </span>;

    const renderSources = (): React.ReactNode => <section className='nmx-comic-setup-block' aria-labelledby={`${id}-source`}>
        <header className='nmx-comic-setup-block-head'>
            <span className='nmx-comic-setup-num' aria-hidden='true'>1</span>
            <div><strong id={`${id}-source`}>{p('sourceTitle')}</strong><small>{p('sourceHint')}</small></div>
        </header>
        {!picking && chosenSource ? <div className='nmx-comic-setup-source is-selected is-summary'>
            {sourceIcon(chosenSource)}{sourceCopy(chosenSource)}
            {loadingChosen && <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>}
            <button type='button' className='nmx-comic-setup-change' onClick={openSources}>{p('change')}</button>
        </div> : <>
        <div className='nmx-comic-setup-tabs' role='tablist' aria-label={p('sourceTitle')}>
            {(['relay', 'own'] as const).map(value => <button key={value} type='button' role='tab' aria-selected={tab === value}
                className={tab === value ? 'is-active' : ''} onClick={() => { setTab(value); setQuery(''); }}>
                <i className={`codicon codicon-${value === 'relay' ? 'server' : 'key'}`} aria-hidden='true'></i>{p(value === 'relay' ? 'relays' : 'ownApis')}
                <em data-nmx-literal>{value === 'relay' ? relaySources.length : ownSources.length}</em></button>)}
        </div>
        {sources.length > 6 && <label className='nmx-comic-setup-search'><i className='codicon codicon-search' aria-hidden='true'></i>
            <ImeInput value={query} maxLength={80} placeholder={p('search')} aria-label={p('search')} onChange={event => setQuery(event.currentTarget.value)} /></label>}
        <div ref={sourceList} className='nmx-comic-setup-sources' role='listbox' aria-label={p(tab === 'relay' ? 'relays' : 'ownApis')}>
            {shown.map(source => {
                const selected = source.key === chosen;
                const loading = props.loadingRelayKey === source.key;
                return <button key={source.key} type='button' role='option' aria-selected={selected} className={`nmx-comic-setup-source ${selected ? 'is-selected' : ''}`}
                    onClick={() => choose(source.key)}>
                    {sourceIcon(source)}{sourceCopy(source)}
                    {loading ? <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>
                        : selected && <i className='codicon codicon-check nmx-comic-setup-source-check' aria-hidden='true'></i>}
                </button>;
            })}
            {!shown.length && <div className='nmx-comic-setup-empty is-compact'>
                <span>{props.busy ? comicStepText(props.locale, 'loading') : needle ? comicStepText(props.locale, 'noMatch') : p(tab === 'own' ? 'ownNone' : 'relayNone')}</span>
                {tab === 'own' && !props.busy && !needle && <button type='button' className='nmx-secondary-button' onClick={props.onAddApi}><i className='codicon codicon-add' aria-hidden='true'></i>{comicStepText(props.locale, 'addApi')}</button>}
            </div>}
        </div>
        </>}
    </section>;

    const renderModels = (current: ComicModelSetupStep): React.ReactNode => {
        const selected = current.resolution.candidate;
        const covered = coveredBy(current);
        const here = current.candidates.filter(candidate => candidate.source.key === chosen).sort((left, right) => left.rank - right.rank || left.label.localeCompare(right.label));
        const sourceLabel = chosenSource ? sourceName(chosenSource) : '';
        // The same model at this source for every function it serves: function → its key there.
        const also = (candidate: ComicStepCandidate): Partial<Record<ComicStepCapability, string>> => Object.fromEntries(props.steps.flatMap(item => {
            const match = item.candidates.find(other => other.source.key === chosen && other.model.toLowerCase() === candidate.model.toLowerCase());
            return match ? [[item.capability, match.key]] : [];
        }));
        const empty = (): React.ReactNode => {
            if (!chosen) return <p className='nmx-comic-setup-hint'>{p('noSource')}</p>;
            if (loadingChosen || props.busy && !here.length) return <p className='nmx-comic-setup-hint'><i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>{p('loadingRelay')}</p>;
            return <div className='nmx-comic-setup-gap'>
                <p><i className='codicon codicon-info' aria-hidden='true'></i><span>{p('sourceLacks', { source: sourceLabel || p('sourceTitle'), step: label(current.capability) })}</span></p>
                {selected && !covered && <small data-nmx-literal>{p('usingOther', { model: selected.label, source: comicStepSourceLabel(props.locale, selected.source) })}</small>}
                <div>
                    <button type='button' className='nmx-link-button' onClick={openSources}>{p('changeSource')}</button>
                    <button type='button' className='nmx-link-button' onClick={props.onAddApi}>{comicStepText(props.locale, 'addApi')}</button>
                </div>
            </div>;
        };
        return <div className='nmx-comic-setup-models' role='tabpanel' id={`${id}-pane`} aria-labelledby={`${id}-step-${current.capability}`}>
            {covered && <p className='nmx-comic-setup-covered'><i className='codicon codicon-check' aria-hidden='true'></i>{p('covered', { model: props.soundVideoModel! })}</p>}
            {here.length ? <div className='nmx-comic-setup-list' role='listbox' aria-label={label(current.capability)}>
                {here.map((candidate, index) => {
                    const isChosen = !covered && selected?.key === candidate.key;
                    const serves = also(candidate);
                    const others = (Object.keys(serves) as ComicStepCapability[]).filter(capability => capability !== current.capability);
                    const allSet = others.every(capability => props.steps.find(item => item.capability === capability)?.resolution.candidate?.key === serves[capability]);
                    // A relay model shows how it is priced (multiplier, or the relay's own price); the hover card has every rate.
                    const priceTag = candidate.offering ? (bps => bps === null ? offeringPriceText(props.locale, 'ownTag') : relayMultiplierTag(props.locale, bps))(offeringMultiplierBps(candidate.offering)) : '';
                    // "With audio" is a shared badge below; a silent video still says so in words (picture only).
                    const detail = [candidate.withSound === false ? comicStepText(props.locale, 'silent') : '', priceTag, candidate.note].filter(Boolean).join(' · ');
                    return <div key={candidate.key} className={`nmx-comic-setup-model ${isChosen ? 'is-selected' : ''}`}>
                        <OfferingPriceHover locale={props.locale} offering={candidate.offering} themeClass={props.themeClass}>
                            <button type='button' role='option' aria-selected={isChosen} onClick={() => props.onStepSelect(current.capability, candidate.key)}>
                                <span className='nmx-comic-setup-radio' aria-hidden='true'>{isChosen && <i className='codicon codicon-check'></i>}</span>
                                <span className='nmx-comic-setup-option-copy'>
                                    <strong data-nmx-literal>{candidate.label}{index === 0 && <em className='nmx-comic-setup-badge'>{p('recommended')}</em>}</strong>
                                    {detail && <small data-nmx-literal>{detail}</small>}
                                    <ModelTaxonomyTags locale={props.locale} model={comicCandidateTaxonomyFacts(candidate, current.capability)} />
                                    {others.length > 0 && <span className='nmx-comic-setup-caps'>{(Object.keys(serves) as ComicStepCapability[]).map(capability =>
                                        <em key={capability} className={capability === current.capability ? 'is-here' : ''}>{label(capability)}</em>)}</span>}
                                </span>
                            </button>
                        </OfferingPriceHover>
                        {others.length > 0 && <button type='button' className='nmx-comic-setup-all' disabled={isChosen && allSet}
                            title={p('useForAllHint', { list: [current.capability, ...others].map(label).join('、') })} onClick={() => props.onStepSelectMany(serves)}>{p('useForAll')}</button>}
                    </div>;
                })}
            </div> : empty()}
        </div>;
    };

    const renderFunctions = (): React.ReactNode => <section className={`nmx-comic-setup-block ${chosen ? '' : 'is-waiting'}`} aria-labelledby={`${id}-models`}>
        <header className='nmx-comic-setup-block-head'>
            <span className='nmx-comic-setup-num' aria-hidden='true'>2</span>
            <div><strong id={`${id}-models`}>{p('modelsTitle')}</strong>{chosenSource && <small data-nmx-literal>{sourceName(chosenSource)}</small>}</div>
        </header>
        <nav className='nmx-comic-setup-functions' role='tablist' aria-label={t('steps')}>
            {props.steps.map(item => {
                const candidate = coveredBy(item) ? undefined : item.resolution.candidate;
                const elsewhere = Boolean(candidate && chosen && candidate.source.key !== chosen);
                return <button key={item.capability} id={`${id}-step-${item.capability}`} type='button' role='tab' aria-selected={item.capability === step.capability}
                    aria-controls={`${id}-pane`} className={`${item.capability === step.capability ? 'is-active' : ''} ${coveredBy(item) ? 'is-covered' : candidate ? elsewhere ? 'is-elsewhere' : 'is-set' : 'is-missing'}`}
                    title={candidate ? `${candidate.label} · ${comicStepSourceLabel(props.locale, candidate.source)}` : undefined}
                    onClick={() => setActive(item.capability)}>
                    <i className={`codicon codicon-${COMIC_STEP_ICONS[item.capability]}`} aria-hidden='true'></i>
                    <strong>{label(item.capability)}</strong>
                    <small data-nmx-literal={Boolean(candidate) || undefined}>{coveredBy(item) ? t('byVideo', { model: props.soundVideoModel! }) : candidate ? candidate.label : props.busy ? comicStepText(props.locale, 'loading') : t('missing')}</small>
                </button>;
            })}
        </nav>
        {step && renderModels(step)}
    </section>;

    return ReactDOM.createPortal(<div className='nmx-model-picker-portal nmx-desktop-widget' dir={rtl ? 'rtl' : 'ltr'} lang={props.locale}>
        <div className={`nmx-model-picker-surface nmx-shell ${props.themeClass}`}>
            <section ref={panel} className={`nmx-comic-setup is-${phase} ${props.intro ? 'is-intro' : ''} ${props.auto ? 'is-auto' : 'is-manual'}`} role='dialog' aria-modal='false' aria-labelledby={`${id}-title`}
                tabIndex={-1} onKeyDown={keyDown} style={place ? { top: place.top, [rtl ? 'left' : 'right']: place.side, maxHeight: place.maxHeight } : { visibility: 'hidden' }}>
                <header className='nmx-comic-setup-head'>
                    <span className='nmx-comic-setup-mark' aria-hidden='true'><i className='codicon codicon-sparkle'></i></span>
                    <div><h2 id={`${id}-title`}>{props.intro ? t('introTitle') : t('title')}{props.scopeLabel && <span className='nmx-comic-setup-scope'>{props.scopeLabel}</span>}</h2><p>{props.intro ? t('introLead') : t('lead')}</p></div>
                    {props.onRefresh && <button type='button' className='nmx-comic-setup-close' disabled={props.refreshing} aria-label={comicStepText(props.locale, 'refresh')} title={comicStepText(props.locale, 'refresh')}
                        onClick={props.onRefresh}><i className={`codicon codicon-${props.refreshing ? 'sync codicon-modifier-spin' : 'refresh'}`} aria-hidden='true'></i></button>}
                    <button type='button' className='nmx-comic-setup-close' aria-label={t('close')} title={t('close')} onClick={close}><i className='codicon codicon-close' aria-hidden='true'></i></button>
                </header>
                <div className='nmx-comic-setup-body'>
                    <div className='nmx-comic-setup-switch'>
                        <div><strong id={`${id}-auto`}>{p('auto')}</strong><small>{props.auto ? p('autoOn') : p('autoOff')}</small></div>
                        <button type='button' role='switch' aria-checked={props.auto} aria-labelledby={`${id}-auto`} className={`nmx-comic-setup-toggle ${props.auto ? 'is-on' : ''}`}
                            onClick={() => props.onAutoChange(!props.auto)}><span aria-hidden='true'></span></button>
                    </div>
                    {props.auto && missing.length > 0 && <p className='nmx-comic-setup-warn'><i className='codicon codicon-warning' aria-hidden='true'></i>
                        {p('missingSteps', { steps: missing.map(item => label(item.capability)).join('、') })}</p>}
                    {!props.auto && renderSources()}
                    {!props.auto && step && renderFunctions()}
                    {!props.auto && props.steps.some(item => item.capability === 'speech') && <p className='nmx-comic-setup-note'><i className='codicon codicon-info' aria-hidden='true'></i>{t('subtitlesNote')}</p>}
                </div>
                {/* A choice applies the moment it is made: no 完成 button to press. */}
                <footer className='nmx-comic-setup-foot'>
                    <span className='nmx-comic-setup-saved'><i className='codicon codicon-check' aria-hidden='true'></i>{p('appliesNow')}</span>
                    <button type='button' className='nmx-secondary-button' onClick={props.onAddApi}><i className='codicon codicon-add' aria-hidden='true'></i>{comicStepText(props.locale, 'addApi')}</button>
                </footer>
            </section>
        </div>
    </div>, document.body);
}

/** The studio header's entry to the panel; it pulses when the panel lands in it. */
export function ComicModelButton(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly open: boolean;
    readonly landed: boolean;
    readonly relay: string;
    readonly missing: number;
    readonly onClick: () => void;
}): React.ReactElement {
    const t = (key: SetupKey, values?: Readonly<Record<string, string | number>>): string => comicModelSetupText(props.locale, key, values);
    const state = props.missing ? t('needs', { count: props.missing }) : t('ready');
    return <button type='button' className={`nmx-comic-ai-button ${props.open ? 'is-open' : ''} ${props.landed ? 'is-landed' : ''}`} data-nmx-comic-ai
        aria-haspopup='dialog' aria-expanded={props.open} title={`${t('title')} · ${props.relay} · ${state}`} onClick={props.onClick}>
        <i className='codicon codicon-sparkle' aria-hidden='true'></i>
        <span className='nmx-comic-ai-label'>{t('button')}</span>
        <small data-nmx-literal>{props.relay}</small>
        <b className={props.missing ? 'is-warn' : 'is-ok'} aria-label={state}></b>
    </button>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function comicModelSetupText(locale: Parameters<typeof uncheckedComicModelSetupText>[0], key: Parameters<typeof uncheckedComicModelSetupText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedComicModelSetupText>>): string {
    return totalCopy(locale, key, language => uncheckedComicModelSetupText(language, key, ...rest));
}
export function comicModelPanelText(locale: Parameters<typeof uncheckedComicModelPanelText>[0], key: Parameters<typeof uncheckedComicModelPanelText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedComicModelPanelText>>): string {
    return totalCopy(locale, key, language => uncheckedComicModelPanelText(language, key, ...rest));
}
