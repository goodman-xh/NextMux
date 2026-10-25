import { modelCapabilityBadges, modelPrimaryCategory, type ModelCapabilityKey, type ModelPrimaryCategory } from '@nextmux/model-runtime/model-taxonomy';
import type { NextMuxDesktopLocale } from './nextmux-locale';

/**
 * Names of the ten primary categories and eleven capability badges (@nextmux/model-runtime/model-taxonomy), one
 * vocabulary for every desktop surface. The words are the desktop's own model-list wording, which the web portals
 * use too (merchant/admin `taxonomy.*` messages), so a model is named the same everywhere.
 */
interface TaxonomyLabels {
    readonly category: Readonly<Record<ModelPrimaryCategory, string>>;
    readonly capability: Readonly<Record<ModelCapabilityKey, string>>;
}

const labels: Readonly<Record<NextMuxDesktopLocale, TaxonomyLabels>> = {
    'zh-CN': {
        category: { language: '文字 / 对话', '3d': '3D', image: '图片', video: '视频', speech: '配音', music: '音乐', sound_effect: '音效', transcription: '语音转文字', decision: '决策', embedding: '向量', rerank: '重排序' },
        capability: { tools: '工具', reasoning: '思考', vision: '识图', web_search: '联网搜索', structured_output: '结构化输出', image_editing: '图片编辑', text_to_video: '文生视频', image_to_video: '图生视频', reference_to_video: '参考生视频', video_native_audio: '有声', vocal_reference: '参考人声' }
    },
    'zh-TW': {
        category: { language: '文字 / 對話', '3d': '3D', image: '圖片', video: '影片', speech: '配音', music: '音樂', sound_effect: '音效', transcription: '語音轉文字', decision: '決策', embedding: '向量', rerank: '重新排序' },
        capability: { tools: '工具', reasoning: '思考', vision: '識圖', web_search: '聯網搜尋', structured_output: '結構化輸出', image_editing: '圖片編輯', text_to_video: '文生影片', image_to_video: '圖生影片', reference_to_video: '參考生影片', video_native_audio: '有聲', vocal_reference: '參考人聲' }
    },
    en: {
        category: { language: 'Text & chat', '3d': '3D', image: 'Pictures', video: 'Video', speech: 'Voice-over', music: 'Music', sound_effect: 'Sound effects', transcription: 'Speech to text', decision: 'Decisions', embedding: 'Embeddings', rerank: 'Reranking' },
        capability: { tools: 'Tools', reasoning: 'Thinking', vision: 'Vision', web_search: 'Web search', structured_output: 'Structured output', image_editing: 'Image editing', text_to_video: 'Text to video', image_to_video: 'Image to video', reference_to_video: 'Reference to video', video_native_audio: 'With audio', vocal_reference: 'Vocal reference' }
    },
    ja: {
        category: { language: 'テキスト / 対話', '3d': '3D', image: '画像', video: '動画', speech: 'ナレーション', music: '音楽', sound_effect: '効果音', transcription: '文字起こし', decision: '意思決定', embedding: '埋め込み', rerank: '再ランキング' },
        capability: { tools: 'ツール', reasoning: '思考', vision: '画像認識', web_search: 'Web 検索', structured_output: '構造化出力', image_editing: '画像編集', text_to_video: 'テキストから動画', image_to_video: '画像から動画', reference_to_video: '参照画像から動画', video_native_audio: '音声付き', vocal_reference: '参考歌声' }
    },
    ko: {
        category: { language: '텍스트 / 대화', '3d': '3D', image: '이미지', video: '동영상', speech: '내레이션', music: '음악', sound_effect: '효과음', transcription: '음성 인식', decision: '의사결정', embedding: '임베딩', rerank: '재순위' },
        capability: { tools: '도구', reasoning: '사고', vision: '이미지 인식', web_search: '웹 검색', structured_output: '구조화 출력', image_editing: '이미지 편집', text_to_video: '텍스트로 동영상', image_to_video: '이미지로 동영상', reference_to_video: '참조로 동영상', video_native_audio: '오디오 포함', vocal_reference: '참고 음성' }
    },
    es: {
        category: { language: 'Texto y chat', '3d': '3D', image: 'Imágenes', video: 'Vídeo', speech: 'Voz en off', music: 'Música', sound_effect: 'Efectos de sonido', transcription: 'Voz a texto', decision: 'Decisiones', embedding: 'Embeddings', rerank: 'Reordenación' },
        capability: { tools: 'Herramientas', reasoning: 'Razonamiento', vision: 'Visión', web_search: 'Búsqueda web', structured_output: 'Salida estructurada', image_editing: 'Edición de imágenes', text_to_video: 'Texto a vídeo', image_to_video: 'Imagen a vídeo', reference_to_video: 'Referencia a vídeo', video_native_audio: 'Con audio', vocal_reference: 'Voz de referencia' }
    },
    fr: {
        category: { language: 'Texte et chat', '3d': '3D', image: 'Images', video: 'Vidéo', speech: 'Voix off', music: 'Musique', sound_effect: 'Effets sonores', transcription: 'Parole en texte', decision: 'Décisions', embedding: 'Embeddings', rerank: 'Reclassement' },
        capability: { tools: 'Outils', reasoning: 'Réflexion', vision: 'Vision', web_search: 'Recherche web', structured_output: 'Sortie structurée', image_editing: 'Retouche d’images', text_to_video: 'Texte vers vidéo', image_to_video: 'Image vers vidéo', reference_to_video: 'Référence vers vidéo', video_native_audio: 'Avec audio', vocal_reference: 'Voix de référence' }
    },
    de: {
        category: { language: 'Text & Chat', '3d': '3D', image: 'Bilder', video: 'Video', speech: 'Sprecher', music: 'Musik', sound_effect: 'Soundeffekte', transcription: 'Sprache zu Text', decision: 'Entscheidungen', embedding: 'Embeddings', rerank: 'Neusortierung' },
        capability: { tools: 'Tools', reasoning: 'Denken', vision: 'Bilderkennung', web_search: 'Websuche', structured_output: 'Strukturierte Ausgabe', image_editing: 'Bildbearbeitung', text_to_video: 'Text zu Video', image_to_video: 'Bild zu Video', reference_to_video: 'Referenz zu Video', video_native_audio: 'Mit Audio', vocal_reference: 'Stimmreferenz' }
    },
    'pt-BR': {
        category: { language: 'Texto e chat', '3d': '3D', image: 'Imagens', video: 'Vídeo', speech: 'Narração', music: 'Música', sound_effect: 'Efeitos sonoros', transcription: 'Fala para texto', decision: 'Decisões', embedding: 'Embeddings', rerank: 'Reordenação' },
        capability: { tools: 'Ferramentas', reasoning: 'Raciocínio', vision: 'Visão', web_search: 'Pesquisa na web', structured_output: 'Saída estruturada', image_editing: 'Edição de imagens', text_to_video: 'Texto para vídeo', image_to_video: 'Imagem para vídeo', reference_to_video: 'Referência para vídeo', video_native_audio: 'Com áudio', vocal_reference: 'Voz de referência' }
    },
    ru: {
        category: { language: 'Текст и чат', '3d': '3D', image: 'Изображения', video: 'Видео', speech: 'Озвучка', music: 'Музыка', sound_effect: 'Звуковые эффекты', transcription: 'Речь в текст', decision: 'Решения', embedding: 'Эмбеддинги', rerank: 'Ранжирование' },
        capability: { tools: 'Инструменты', reasoning: 'Размышление', vision: 'Зрение', web_search: 'Веб-поиск', structured_output: 'Структурированный вывод', image_editing: 'Редактирование изображений', text_to_video: 'Текст в видео', image_to_video: 'Изображение в видео', reference_to_video: 'Видео по образцу', video_native_audio: 'Со звуком', vocal_reference: 'Образец голоса' }
    },
    ar: {
        category: { language: 'نص ومحادثة', '3d': '3D', image: 'الصور', video: 'الفيديو', speech: 'التعليق الصوتي', music: 'موسيقى', sound_effect: 'مؤثرات صوتية', transcription: 'تحويل الكلام إلى نص', decision: 'قرارات', embedding: 'التضمين', rerank: 'إعادة الترتيب' },
        capability: { tools: 'أدوات', reasoning: 'تفكير', vision: 'رؤية', web_search: 'بحث الويب', structured_output: 'مخرجات منظمة', image_editing: 'تحرير الصور', text_to_video: 'نص إلى فيديو', image_to_video: 'صورة إلى فيديو', reference_to_video: 'مرجع إلى فيديو', video_native_audio: 'مع الصوت', vocal_reference: 'عينة صوتية' }
    },
    hi: {
        category: { language: 'टेक्स्ट और चैट', '3d': '3D', image: 'चित्र', video: 'वीडियो', speech: 'वॉइस-ओवर', music: 'संगीत', sound_effect: 'ध्वनि प्रभाव', transcription: 'स्पीच-टू-टेक्स्ट', decision: 'निर्णय', embedding: 'एम्बेडिंग', rerank: 'पुनः रैंकिंग' },
        capability: { tools: 'टूल', reasoning: 'सोच', vision: 'दृष्टि', web_search: 'वेब खोज', structured_output: 'संरचित आउटपुट', image_editing: 'चित्र संपादन', text_to_video: 'टेक्स्ट से वीडियो', image_to_video: 'चित्र से वीडियो', reference_to_video: 'संदर्भ से वीडियो', video_native_audio: 'ऑडियो सहित', vocal_reference: 'संदर्भ आवाज़' }
    }
};

const labelsFor = (locale: NextMuxDesktopLocale): TaxonomyLabels => labels[locale] || labels.en;

/** The name of one primary category. */
export function modelCategoryLabel(locale: NextMuxDesktopLocale, category: ModelPrimaryCategory): string {
    return labelsFor(locale).category[category];
}

/** The name of one capability badge. */
export function modelCapabilityLabel(locale: NextMuxDesktopLocale, key: ModelCapabilityKey): string {
    return labelsFor(locale).capability[key] ?? String(key);
}

export interface ModelTaxonomyView {
    readonly category: ModelPrimaryCategory;
    readonly categoryLabel: string;
    readonly badges: readonly { readonly key: ModelCapabilityKey; readonly label: string }[];
}

/** A model row's one category and its badges, named for `locale` (any catalog, offering or own-API row shape). */
export function modelTaxonomyView(locale: NextMuxDesktopLocale, model: unknown): ModelTaxonomyView {
    const category = modelPrimaryCategory(model);
    return {
        category, categoryLabel: modelCategoryLabel(locale, category),
        badges: modelCapabilityBadges(model, category).map(key => ({ key, label: modelCapabilityLabel(locale, key) }))
    };
}

/** Just the badge names of a model row, in display order. */
export function modelCapabilityTagLabels(locale: NextMuxDesktopLocale, model: unknown): readonly string[] {
    return modelTaxonomyView(locale, model).badges.map(badge => badge.label);
}

