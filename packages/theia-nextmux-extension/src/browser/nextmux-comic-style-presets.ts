import type { NextMuxDesktopLocale } from './nextmux-locale';

/**
 * Built-in visual & music style presets for Comic Media Studio modals and quick flows,
 * benchmarked against Fooocus (`sdxl_styles`) and InvokeAI style facets with
 * strict **User-Prompt-First** conflict resolution:
 *
 * 1. The user's trimmed prompt is ALWAYS placed at token position 0.
 * 2. Each preset decomposes its aesthetics into orthogonal facets
 *    (`medium`, `era`, `lighting`, `palette`, `camera` for visual;
 *     `genre`, `instrumentation`, `tempo`, `mood` for music).
 * 3. Any preset facet that conflicts with an explicit directive in the user's prompt
 *    is automatically stripped so the user's words always win without contradiction.
 */

export type ComicVisualStyleId =
    | 'none'
    | 'live_action'
    | 'semi_realistic_cg'
    | 'anime_2d'
    | 'ancient_chinese'
    | 'japanese_fresh'
    | 'cartoon_pixar'
    | 'cyberpunk_scifi'
    | 'cinematic_film'
    | 'ink_wash'
    | 'oil_impasto'
    | 'clay_stopmotion'
    | 'pixel_retro'
    | 'dark_fantasy';

export type ComicMusicStyleId =
    | 'none'
    | 'pop'
    | 'guofeng'
    | 'jpop_anime'
    | 'cinematic_score'
    | 'acoustic_folk'
    | 'electronic_edm'
    | 'rock'
    | 'hiphop_rap'
    | 'jazz_lofi'
    | 'healing_piano'
    | 'synthwave'
    | 'orchestral';

export type ComicStyleDomain = 'visual' | 'music';

type VisualMediumTag =
    | 'live_action'
    | 'semi_realistic_cg'
    | 'anime_2d'
    | 'guofeng_illustration'
    | 'cartoon_3d'
    | 'ink_wash'
    | 'oil_impasto'
    | 'clay_stopmotion'
    | 'pixel_retro';

type VisualEraTag =
    | 'ancient_chinese'
    | 'modern_urban'
    | 'cyberpunk_scifi'
    | 'dark_fantasy'
    | 'retro_pixel';

type VisualLightingTag =
    | 'natural_cinematic'
    | 'bright_fresh'
    | 'neon_night'
    | 'warm_mist'
    | 'dark_moody'
    | 'studio_soft';

type VisualPaletteTag =
    | 'natural_film'
    | 'vibrant_cel'
    | 'guofeng_jade_gold'
    | 'pastel_sky'
    | 'neon_cyan_magenta'
    | 'monochrome_ink'
    | 'rich_impasto'
    | 'dark_gothic';

type VisualCameraTag =
    | 'cinematic_lens'
    | 'dynamic_anime'
    | 'poetic_wide'
    | 'macro_miniature'
    | 'pixel_orthographic';

type MusicGenreTag =
    | 'pop'
    | 'guofeng'
    | 'jpop_anime'
    | 'cinematic_score'
    | 'acoustic_folk'
    | 'electronic_edm'
    | 'rock'
    | 'hiphop_rap'
    | 'jazz_lofi'
    | 'solo_piano'
    | 'synthwave'
    | 'orchestral';

type MusicInstrumentTag =
    | 'pop_band'
    | 'chinese_traditional'
    | 'jpop_band_strings'
    | 'epic_orchestra_percussion'
    | 'acoustic_guitar'
    | 'edm_synths'
    | 'electric_rock_band'
    | 'hiphop_808'
    | 'jazz_rhodes_brush'
    | 'solo_piano'
    | 'analog_synthwave'
    | 'symphonic_orchestra'
    | 'acappella';

type MusicTempoTag = 'slow' | 'mid' | 'fast';

type MusicMoodTag =
    | 'uplifting_bright'
    | 'poetic_elegant'
    | 'epic_dramatic'
    | 'warm_intimate'
    | 'energetic_driving'
    | 'chill_relaxed'
    | 'healing_calm'
    | 'retro_nocturnal'
    | 'sad_melancholic'
    | 'dark_tense';

export interface ComicFacetClause<Tag extends string = string> {
    readonly tag: Tag;
    readonly clause: string;
}

export interface ComicVisualStyleFacets {
    readonly medium?: ComicFacetClause<VisualMediumTag>;
    readonly era?: ComicFacetClause<VisualEraTag>;
    readonly lighting?: ComicFacetClause<VisualLightingTag>;
    readonly palette?: ComicFacetClause<VisualPaletteTag>;
    readonly camera?: ComicFacetClause<VisualCameraTag>;
}

export interface ComicMusicStyleFacets {
    readonly genre?: ComicFacetClause<MusicGenreTag>;
    readonly instrumentation?: ComicFacetClause<MusicInstrumentTag>;
    readonly tempo?: ComicFacetClause<MusicTempoTag>;
    readonly mood?: ComicFacetClause<MusicMoodTag>;
}

export interface ComicStylePreset<
    Id extends string = string,
    Facets extends object = ComicVisualStyleFacets | ComicMusicStyleFacets
> {
    readonly id: Id;
    readonly domain: ComicStyleDomain;
    readonly labelZhCN: string;
    readonly labelEn: string;
    readonly labels: Readonly<Record<NextMuxDesktopLocale, string>>;
    readonly facets: Facets;
}

function makeLabels(
    table: Readonly<Record<NextMuxDesktopLocale, string>>
): Readonly<Record<NextMuxDesktopLocale, string>> {
    return table;
}

export const COMIC_VISUAL_STYLE_PRESETS: readonly ComicStylePreset<ComicVisualStyleId, ComicVisualStyleFacets>[] = [
    {
        id: 'none',
        domain: 'visual',
        labelZhCN: '不限风格',
        labelEn: 'No style preset',
        labels: makeLabels({
            'zh-CN': '不限风格',
            'zh-TW': '不限風格',
            en: 'No style preset',
            ja: 'スタイル指定なし',
            ko: '스타일 제한 없음',
            es: 'Sin estilo predefinido',
            fr: 'Aucun style prédéfini',
            de: 'Keine Stilvorgabe',
            'pt-BR': 'Sem estilo predefinido',
            ru: 'Без предустановки стиля',
            ar: 'بدون نمط محدد',
            hi: 'कोई शैली प्रीसेट नहीं'
        }),
        facets: {}
    },
    {
        id: 'live_action',
        domain: 'visual',
        labelZhCN: '真人实拍',
        labelEn: 'Live-Action Photorealistic',
        labels: makeLabels({
            'zh-CN': '真人实拍',
            'zh-TW': '真人實拍',
            en: 'Live-Action Photorealistic',
            ja: '実写フォトリアル',
            ko: '실사 포토리얼',
            es: 'Acción real fotorrealista',
            fr: 'Prise de vue réelle photoréaliste',
            de: 'Realfilm Fotorealistisch',
            'pt-BR': 'Live-Action Fotorrealista',
            ru: 'Реалистичная живая съёмка',
            ar: 'تصوير واقعي حي',
            hi: 'लाइव-एक्शन फ़ोटोरियलिस्टिक'
        }),
        facets: {
            medium: { tag: 'live_action', clause: 'live-action photorealistic footage, authentic human skin texture and natural motion' },
            lighting: { tag: 'natural_cinematic', clause: 'physically accurate natural lighting' },
            palette: { tag: 'natural_film', clause: 'true-to-life film color science' },
            camera: { tag: 'cinematic_lens', clause: 'cinema prime lens optical depth of field' }
        }
    },
    {
        id: 'semi_realistic_cg',
        domain: 'visual',
        labelZhCN: '仿真人 / 3D CG',
        labelEn: 'Semi-Realistic 3D CG',
        labels: makeLabels({
            'zh-CN': '仿真人 / 3D CG',
            'zh-TW': '仿真人 / 3D CG',
            en: 'Semi-Realistic 3D CG',
            ja: 'セミリアル 3D CG',
            ko: '세미 리얼 3D CG',
            es: '3D CG semirrealista',
            fr: '3D CG semi-réaliste',
            de: 'Semirealistisches 3D-CG',
            'pt-BR': '3D CG Semirrealista',
            ru: 'Полуреалистичная 3D CG',
            ar: 'رسوم 3D CG شبه واقعية',
            hi: 'सेमी-रियलिस्टिक 3D CG'
        }),
        facets: {
            medium: { tag: 'semi_realistic_cg', clause: 'high-end semi-realistic 3D CG animation, detailed subsurface scattering and hair strands' },
            lighting: { tag: 'natural_cinematic', clause: 'volumetric global illumination and rim light' },
            palette: { tag: 'natural_film', clause: 'polished cinematic CG color grading' },
            camera: { tag: 'cinematic_lens', clause: 'smooth virtual cinema camera tracking' }
        }
    },
    {
        id: 'anime_2d',
        domain: 'visual',
        labelZhCN: '动漫 / 二次元',
        labelEn: 'Anime / 2D Cel',
        labels: makeLabels({
            'zh-CN': '动漫 / 二次元',
            'zh-TW': '動漫 / 二次元',
            en: 'Anime / 2D Cel',
            ja: 'アニメ / 2D セル画',
            ko: '애니메이션 / 2D 셀',
            es: 'Anime / 2D Cel',
            fr: 'Anime / 2D Cel',
            de: 'Anime / 2D-Cel',
            'pt-BR': 'Anime / 2D Cel',
            ru: 'Аниме / 2D сел-шейдинг',
            ar: 'أنمي / ثنائي الأبعاد',
            hi: 'एनिमे / 2D सेल'
        }),
        facets: {
            medium: { tag: 'anime_2d', clause: '2D anime cel-shaded keyframe animation, crisp hand-drawn linework' },
            lighting: { tag: 'bright_fresh', clause: 'expressive anime rim highlights and dramatic light shafts' },
            palette: { tag: 'vibrant_cel', clause: 'vibrant cel-shaded anime color palette' },
            camera: { tag: 'dynamic_anime', clause: 'dynamic anime sakuga framing' }
        }
    },
    {
        id: 'ancient_chinese',
        domain: 'visual',
        labelZhCN: '古风 / 国风仙侠',
        labelEn: 'Ancient Chinese / Guofeng',
        labels: makeLabels({
            'zh-CN': '古风 / 国风仙侠',
            'zh-TW': '古風 / 國風仙俠',
            en: 'Ancient Chinese / Guofeng',
            ja: '中国古風 / 仙侠',
            ko: '고풍 / 중국 선협',
            es: 'Chino antiguo / Guofeng',
            fr: 'Chine ancienne / Guofeng',
            de: 'Altes China / Guofeng',
            'pt-BR': 'China Antiga / Guofeng',
            ru: 'Древний Китай / Гофэн',
            ar: 'الطابع الصيني القديم / قوفنغ',
            hi: 'प्राचीन चीनी / गुओफेंग'
        }),
        facets: {
            medium: { tag: 'guofeng_illustration', clause: 'refined Oriental Guofeng aesthetic visual art with flowing silk textures' },
            era: { tag: 'ancient_chinese', clause: 'classical ancient Chinese xianxia pavilions and traditional attire' },
            lighting: { tag: 'warm_mist', clause: 'ethereal mountain mist and warm lantern glow' },
            palette: { tag: 'guofeng_jade_gold', clause: 'jade, cinnabar and warm ink-gold palette' },
            camera: { tag: 'poetic_wide', clause: 'poetic sweeping wuxia camera movement' }
        }
    },
    {
        id: 'japanese_fresh',
        domain: 'visual',
        labelZhCN: '日系清新',
        labelEn: 'Japanese Fresh / Makoto Shinkai',
        labels: makeLabels({
            'zh-CN': '日系清新',
            'zh-TW': '日系清新',
            en: 'Japanese Fresh / Makoto Shinkai',
            ja: '日系爽やか / 新海誠風',
            ko: '일본풍 청량 / 신카이 마코토 풍',
            es: 'Fresco japonés / Makoto Shinkai',
            fr: 'Fraîcheur japonaise / Makoto Shinkai',
            de: 'Japanisch Frisch / Makoto Shinkai',
            'pt-BR': 'Japonês Suave / Makoto Shinkai',
            ru: 'Японская свежесть / Макото Синкай',
            ar: 'الياباني المنعش / ماكوتو شينكاي',
            hi: 'जापानी फ़्रेश / मकोतो शिनकाई'
        }),
        facets: {
            medium: { tag: 'anime_2d', clause: 'luminous Japanese theatrical anime background art and delicate character lines' },
            lighting: { tag: 'bright_fresh', clause: 'sunlit lens flare, crisp cumulus clouds and shimmering reflections' },
            palette: { tag: 'pastel_sky', clause: 'clean azure sky and translucent pastel summer palette' },
            camera: { tag: 'poetic_wide', clause: 'gentle lyrical wide-angle framing' }
        }
    },
    {
        id: 'cartoon_pixar',
        domain: 'visual',
        labelZhCN: '卡通 / 皮克斯 3D',
        labelEn: '3D Cartoon / Pixar Style',
        labels: makeLabels({
            'zh-CN': '卡通 / 皮克斯 3D',
            'zh-TW': '卡通 / 皮克斯 3D',
            en: '3D Cartoon / Pixar Style',
            ja: '3D カートゥーン / ピクサー風',
            ko: '3D 카툰 / 픽사 스타일',
            es: 'Dibujos 3D / Estilo Pixar',
            fr: 'Cartoon 3D / Style Pixar',
            de: '3D-Cartoon / Pixar-Stil',
            'pt-BR': 'Cartoon 3D / Estilo Pixar',
            ru: '3D-мультфильм / Стиль Pixar',
            ar: 'كرتون ثلاثي الأبعاد / بيكسار',
            hi: '3D कार्टून / पिक्सार शैली'
        }),
        facets: {
            medium: { tag: 'cartoon_3d', clause: 'stylized Pixar-grade 3D feature animation, expressive proportions and tactile materials' },
            lighting: { tag: 'studio_soft', clause: 'warm bounce global illumination and soft rim lighting' },
            palette: { tag: 'vibrant_cel', clause: 'cheerful rich saturated storybook color palette' },
            camera: { tag: 'cinematic_lens', clause: 'playful cinematic character-focused framing' }
        }
    },
    {
        id: 'cyberpunk_scifi',
        domain: 'visual',
        labelZhCN: '赛博朋克 / 科幻',
        labelEn: 'Cyberpunk / Sci-Fi',
        labels: makeLabels({
            'zh-CN': '赛博朋克 / 科幻',
            'zh-TW': '賽博龐克 / 科幻',
            en: 'Cyberpunk / Sci-Fi',
            ja: 'サイバーパンク / SF',
            ko: '사이버펑크 / SF',
            es: 'Cyberpunk / Ciencia ficción',
            fr: 'Cyberpunk / Science-fiction',
            de: 'Cyberpunk / Sci-Fi',
            'pt-BR': 'Cyberpunk / Ficção científica',
            ru: 'Киберпанк / Научная фантастика',
            ar: 'سايبربانك / خيال علمي',
            hi: 'साइबरपंक / साइ-फ़ाई'
        }),
        facets: {
            era: { tag: 'cyberpunk_scifi', clause: 'futuristic cyberpunk sci-fi megacity and high-tech holograms' },
            lighting: { tag: 'neon_night', clause: 'high-contrast neon reflections on wet surfaces and volumetric haze' },
            palette: { tag: 'neon_cyan_magenta', clause: 'electric cyan, magenta and deep midnight-blue palette' },
            camera: { tag: 'cinematic_lens', clause: 'anamorphic widescreen sci-fi lens flares' }
        }
    },
    {
        id: 'cinematic_film',
        domain: 'visual',
        labelZhCN: '电影写实',
        labelEn: 'Cinematic Film / 35mm',
        labels: makeLabels({
            'zh-CN': '电影写实',
            'zh-TW': '電影寫實',
            en: 'Cinematic Film / 35mm',
            ja: 'シネマティック / 35mmフィルム',
            ko: '시네마틱 필름 / 35mm',
            es: 'Cine realista / 35 mm',
            fr: 'Cinéma réaliste / 35 mm',
            de: 'Kinofilm / 35 mm',
            'pt-BR': 'Cinema Realista / 35 mm',
            ru: 'Кинематографическая плёнка 35 мм',
            ar: 'سينمائي واقعي / 35 ملم',
            hi: 'सिनेमैटिक फ़िल्म / 35mm'
        }),
        facets: {
            medium: { tag: 'live_action', clause: '35mm Kodak Vision3 motion picture film stock, subtle organic film grain' },
            lighting: { tag: 'natural_cinematic', clause: 'dramatic motivated cinematography lighting and chiaroscuro contrast' },
            palette: { tag: 'natural_film', clause: 'theatrical teal-and-amber film color grading' },
            camera: { tag: 'cinematic_lens', clause: 'anamorphic cinema lens shallow depth of field' }
        }
    },
    {
        id: 'ink_wash',
        domain: 'visual',
        labelZhCN: '水墨国画',
        labelEn: 'Chinese Ink Wash',
        labels: makeLabels({
            'zh-CN': '水墨国画',
            'zh-TW': '水墨國畫',
            en: 'Chinese Ink Wash',
            ja: '水墨画',
            ko: '수묵화',
            es: 'Tinta china / Aguada',
            fr: 'Lavis à l’encre de Chine',
            de: 'Chinesische Tuschemalerei',
            'pt-BR': 'Pintura Chinesa a Nanquim',
            ru: 'Китайская тушь / Гохуа',
            ar: 'الرسم بالحبر الصيني',
            hi: 'चीनी स्याही चित्रकला'
        }),
        facets: {
            medium: { tag: 'ink_wash', clause: 'traditional Chinese xieyi ink-wash painting on textured xuan paper, fluid calligraphy brushwork' },
            lighting: { tag: 'warm_mist', clause: 'diffused atmospheric negative space and misty gradients' },
            palette: { tag: 'monochrome_ink', clause: 'layered sumi ink tones with subtle mineral vermilion accents' },
            camera: { tag: 'poetic_wide', clause: 'scroll-painting composition with breathing negative space' }
        }
    },
    {
        id: 'oil_impasto',
        domain: 'visual',
        labelZhCN: '油画厚涂',
        labelEn: 'Oil Painting / Impasto',
        labels: makeLabels({
            'zh-CN': '油画厚涂',
            'zh-TW': '油畫厚塗',
            en: 'Oil Painting / Impasto',
            ja: '油絵 / インパスト厚塗り',
            ko: '유화 / 임파스토 두꺼운 채색',
            es: 'Óleo / Impasto',
            fr: 'Peinture à l’huile / Empâtement',
            de: 'Ölgemälde / Impasto',
            'pt-BR': 'Pintura a Óleo / Impasto',
            ru: 'Масляная живопись / Импасто',
            ar: 'لوحة زيتية / إمباستو',
            hi: 'तैल चित्रकला / इम्पास्टो'
        }),
        facets: {
            medium: { tag: 'oil_impasto', clause: 'expressive oil painting on canvas, tactile palette-knife impasto brushstrokes' },
            lighting: { tag: 'natural_cinematic', clause: 'luminous painterly light and rich shadow modeling' },
            palette: { tag: 'rich_impasto', clause: 'rich pigment harmony and warm gallery tones' },
            camera: { tag: 'poetic_wide', clause: 'fine-art pictorial framing' }
        }
    },
    {
        id: 'clay_stopmotion',
        domain: 'visual',
        labelZhCN: '黏土定格',
        labelEn: 'Claymation / Stop-Motion',
        labels: makeLabels({
            'zh-CN': '黏土定格',
            'zh-TW': '黏土定格',
            en: 'Claymation / Stop-Motion',
            ja: 'クレイアニメ / ストップモーション',
            ko: '클레이 / 스톱모션',
            es: 'Plastilina / Stop-Motion',
            fr: 'Pâte à modeler / Stop-Motion',
            de: 'Knetanimation / Stop-Motion',
            'pt-BR': 'Massinha / Stop-Motion',
            ru: 'Пластилиновая стоп-моушн анимация',
            ar: 'صلصال / إيقاف الحركة',
            hi: 'क्लेमेशन / स्टॉप-मोशन'
        }),
        facets: {
            medium: { tag: 'clay_stopmotion', clause: 'handcrafted claymation stop-motion animation, subtle thumbprint clay textures' },
            lighting: { tag: 'studio_soft', clause: 'miniature tabletop studio softbox lighting' },
            palette: { tag: 'vibrant_cel', clause: 'tactile matte pigment colors' },
            camera: { tag: 'macro_miniature', clause: 'tilt-shift miniature macro lens depth of field' }
        }
    },
    {
        id: 'pixel_retro',
        domain: 'visual',
        labelZhCN: '像素复古',
        labelEn: 'Retro Pixel Art',
        labels: makeLabels({
            'zh-CN': '像素复古',
            'zh-TW': '像素復古',
            en: 'Retro Pixel Art',
            ja: 'レトロドット絵 / ピクセルアート',
            ko: '레트로 픽셀 아트',
            es: 'Pixel Art retro',
            fr: 'Pixel Art rétro',
            de: 'Retro-Pixel-Art',
            'pt-BR': 'Pixel Art Retrô',
            ru: 'Ретро пиксель-арт',
            ar: 'فن البكسل الكلاسيكي',
            hi: 'रेट्रो पिक्सेल आर्ट'
        }),
        facets: {
            medium: { tag: 'pixel_retro', clause: '16-bit retro pixel art animation, crisp pixel clusters and dithering' },
            era: { tag: 'retro_pixel', clause: 'classic arcade sprite aesthetic' },
            palette: { tag: 'vibrant_cel', clause: 'curated retro 16-bit color palette' },
            camera: { tag: 'pixel_orthographic', clause: 'clean parallax side-scrolling or isometric framing' }
        }
    },
    {
        id: 'dark_fantasy',
        domain: 'visual',
        labelZhCN: '暗黑奇幻',
        labelEn: 'Dark Fantasy',
        labels: makeLabels({
            'zh-CN': '暗黑奇幻',
            'zh-TW': '暗黑奇幻',
            en: 'Dark Fantasy',
            ja: 'ダークファンタジー',
            ko: '다크 판타지',
            es: 'Fantasía oscura',
            fr: 'Dark Fantasy',
            de: 'Dark Fantasy',
            'pt-BR': 'Fantasia Sombria',
            ru: 'Тёмное фэнтези',
            ar: 'فانتازيا مظلمة',
            hi: 'डार्क फ़ैंटेसी'
        }),
        facets: {
            era: { tag: 'dark_fantasy', clause: 'mythic gothic dark fantasy realm, weathered stone and ancient runes' },
            lighting: { tag: 'dark_moody', clause: 'moody low-key chiaroscuro lighting, ember sparks and volumetric fog' },
            palette: { tag: 'dark_gothic', clause: 'desaturated obsidian, ash-silver and ember-crimson palette' },
            camera: { tag: 'cinematic_lens', clause: 'epic dramatic low-angle cinema composition' }
        }
    }
];

export const COMIC_MUSIC_STYLE_PRESETS: readonly ComicStylePreset<ComicMusicStyleId, ComicMusicStyleFacets>[] = [
    {
        id: 'none',
        domain: 'music',
        labelZhCN: '不限风格',
        labelEn: 'No style preset',
        labels: makeLabels({
            'zh-CN': '不限风格',
            'zh-TW': '不限風格',
            en: 'No style preset',
            ja: 'スタイル指定なし',
            ko: '스타일 제한 없음',
            es: 'Sin estilo predefinido',
            fr: 'Aucun style prédéfini',
            de: 'Keine Stilvorgabe',
            'pt-BR': 'Sem estilo predefinido',
            ru: 'Без предустановки стиля',
            ar: 'بدون نمط محدد',
            hi: 'कोई शैली प्रीसेट नहीं'
        }),
        facets: {}
    },
    {
        id: 'pop',
        domain: 'music',
        labelZhCN: '流行',
        labelEn: 'Pop',
        labels: makeLabels({
            'zh-CN': '流行',
            'zh-TW': '流行',
            en: 'Pop',
            ja: 'ポップ',
            ko: '팝',
            es: 'Pop',
            fr: 'Pop',
            de: 'Pop',
            'pt-BR': 'Pop',
            ru: 'Поп',
            ar: 'بوب',
            hi: 'पॉप'
        }),
        facets: {
            genre: { tag: 'pop', clause: 'modern polished pop production with catchy melodic hook' },
            instrumentation: { tag: 'pop_band', clause: 'layered keyboards, crisp drums, warm bass and clean guitar' },
            tempo: { tag: 'mid', clause: 'balanced mid-tempo pop groove' },
            mood: { tag: 'uplifting_bright', clause: 'expressive and radio-ready emotional clarity' }
        }
    },
    {
        id: 'guofeng',
        domain: 'music',
        labelZhCN: '古风国风',
        labelEn: 'Chinese Guofeng',
        labels: makeLabels({
            'zh-CN': '古风国风',
            'zh-TW': '古風國風',
            en: 'Chinese Guofeng',
            ja: '中国古風 / 国風',
            ko: '중국 고풍 / 국풍',
            es: 'Guofeng chino',
            fr: 'Guofeng chinois',
            de: 'Chinesischer Guofeng',
            'pt-BR': 'Guofeng Chinês',
            ru: 'Китайский Гофэн',
            ar: 'قوفنغ صيني تقليدي',
            hi: 'चीनी गुओफेंग'
        }),
        facets: {
            genre: { tag: 'guofeng', clause: 'Chinese Guofeng pentatonic fusion arrangement' },
            instrumentation: { tag: 'chinese_traditional', clause: 'guzheng, dizi bamboo flute, pipa, erhu and atmospheric strings' },
            tempo: { tag: 'mid', clause: 'flowing lyrical rhythm' },
            mood: { tag: 'poetic_elegant', clause: 'poetic Oriental elegance' }
        }
    },
    {
        id: 'jpop_anime',
        domain: 'music',
        labelZhCN: '日系动漫',
        labelEn: 'J-Pop / Anime',
        labels: makeLabels({
            'zh-CN': '日系动漫',
            'zh-TW': '日系動漫',
            en: 'J-Pop / Anime',
            ja: 'J-POP / アニソン',
            ko: 'J-Pop / 애니송',
            es: 'J-Pop / Anime',
            fr: 'J-Pop / Anime',
            de: 'J-Pop / Anime',
            'pt-BR': 'J-Pop / Anime',
            ru: 'J-Pop / Аниме',
            ar: 'جي-بوب / أنمي',
            hi: 'जे-पॉप / एनिमे'
        }),
        facets: {
            genre: { tag: 'jpop_anime', clause: 'J-Pop anisong soundtrack style with soaring chorus progression' },
            instrumentation: { tag: 'jpop_band_strings', clause: 'bright piano, overdriven rhythm guitar, agile bass, tight drums and strings' },
            tempo: { tag: 'fast', clause: 'upbeat energetic anime tempo' },
            mood: { tag: 'uplifting_bright', clause: 'youthful uplifting dramatic energy' }
        }
    },
    {
        id: 'cinematic_score',
        domain: 'music',
        labelZhCN: '影视史诗配乐',
        labelEn: 'Cinematic Epic Score',
        labels: makeLabels({
            'zh-CN': '影视史诗配乐',
            'zh-TW': '影視史詩配樂',
            en: 'Cinematic Epic Score',
            ja: 'シネマティック壮大劇伴',
            ko: '시네마틱 에픽 스코어',
            es: 'Banda sonora épica',
            fr: 'Musique de film épique',
            de: 'Epischer Filmmusik-Score',
            'pt-BR': 'Trilha Sonora Épica',
            ru: 'Эпический кинематографический саундтрек',
            ar: 'موسيقى تصويرية ملحمية',
            hi: 'सिनेमैटिक एपिक स्कोर'
        }),
        facets: {
            genre: { tag: 'cinematic_score', clause: 'epic cinematic trailer and film score orchestration' },
            instrumentation: { tag: 'epic_orchestra_percussion', clause: 'soaring symphonic strings, heroic French horns, deep taiko percussion and choir' },
            tempo: { tag: 'mid', clause: 'building dramatic crescendo pulse' },
            mood: { tag: 'epic_dramatic', clause: 'grand heroic cinematic tension and awe' }
        }
    },
    {
        id: 'acoustic_folk',
        domain: 'music',
        labelZhCN: '民谣原声',
        labelEn: 'Acoustic Folk',
        labels: makeLabels({
            'zh-CN': '民谣原声',
            'zh-TW': '民謠原聲',
            en: 'Acoustic Folk',
            ja: 'アコースティック・フォーク',
            ko: '어쿠스틱 포크',
            es: 'Folk acústico',
            fr: 'Folk acoustique',
            de: 'Akustik-Folk',
            'pt-BR': 'Folk Acústico',
            ru: 'Акустический фолк',
            ar: 'فولك صوتي هادئ',
            hi: 'अकूस्टिक फ़ोक'
        }),
        facets: {
            genre: { tag: 'acoustic_folk', clause: 'indie acoustic folk singer-songwriter arrangement' },
            instrumentation: { tag: 'acoustic_guitar', clause: 'fingerpicked steel-string acoustic guitar, subtle cello and light shaker' },
            tempo: { tag: 'slow', clause: 'gentle unhurried organic tempo' },
            mood: { tag: 'warm_intimate', clause: 'warm storytelling intimacy and natural room acoustics' }
        }
    },
    {
        id: 'electronic_edm',
        domain: 'music',
        labelZhCN: '电子律动',
        labelEn: 'Electronic / EDM',
        labels: makeLabels({
            'zh-CN': '电子律动',
            'zh-TW': '電子律動',
            en: 'Electronic / EDM',
            ja: 'エレクトロニック / EDM',
            ko: '일렉트로닉 / EDM',
            es: 'Electrónica / EDM',
            fr: 'Électronique / EDM',
            de: 'Elektronisch / EDM',
            'pt-BR': 'Eletrônica / EDM',
            ru: 'Электроника / EDM',
            ar: 'إلكتروني / EDM',
            hi: 'इलेक्ट्रॉनिक / EDM'
        }),
        facets: {
            genre: { tag: 'electronic_edm', clause: 'modern melodic electronic dance production' },
            instrumentation: { tag: 'edm_synths', clause: 'punchy sidechained sub-bass, shimmering synth leads, crisp four-on-the-floor kick and risers' },
            tempo: { tag: 'fast', clause: 'driving 124-128 BPM club groove' },
            mood: { tag: 'energetic_driving', clause: 'euphoric high-energy momentum' }
        }
    },
    {
        id: 'rock',
        domain: 'music',
        labelZhCN: '摇滚',
        labelEn: 'Rock',
        labels: makeLabels({
            'zh-CN': '摇滚',
            'zh-TW': '搖滾',
            en: 'Rock',
            ja: 'ロック',
            ko: '록',
            es: 'Rock',
            fr: 'Rock',
            de: 'Rock',
            'pt-BR': 'Rock',
            ru: 'Рок',
            ar: 'روك',
            hi: 'रॉक'
        }),
        facets: {
            genre: { tag: 'rock', clause: 'modern alternative and arena rock arrangement' },
            instrumentation: { tag: 'electric_rock_band', clause: 'crunchy overdriven electric guitars, punchy live drum kit and driving bass guitar' },
            tempo: { tag: 'fast', clause: 'powerful forward-driving rock rhythm' },
            mood: { tag: 'energetic_driving', clause: 'raw passionate anthem energy' }
        }
    },
    {
        id: 'hiphop_rap',
        domain: 'music',
        labelZhCN: '说唱律动',
        labelEn: 'Hip-Hop / Rap',
        labels: makeLabels({
            'zh-CN': '说唱律动',
            'zh-TW': '說唱律動',
            en: 'Hip-Hop / Rap',
            ja: 'ヒップホップ / ラップ',
            ko: '힙합 / 랩',
            es: 'Hip-Hop / Rap',
            fr: 'Hip-Hop / Rap',
            de: 'Hip-Hop / Rap',
            'pt-BR': 'Hip-Hop / Rap',
            ru: 'Хип-хоп / Рэп',
            ar: 'هيب هوب / راب',
            hi: 'हिप-हॉप / रैप'
        }),
        facets: {
            genre: { tag: 'hiphop_rap', clause: 'modern hip-hop beat production with rhythmic pocket' },
            instrumentation: { tag: 'hiphop_808', clause: 'deep 808 bass, crisp snare, syncopated hi-hat rolls and atmospheric keys' },
            tempo: { tag: 'mid', clause: 'head-nodding hip-hop bounce' },
            mood: { tag: 'energetic_driving', clause: 'confident streetwise groove' }
        }
    },
    {
        id: 'jazz_lofi',
        domain: 'music',
        labelZhCN: '爵士 Lo-Fi',
        labelEn: 'Jazz / Lo-Fi',
        labels: makeLabels({
            'zh-CN': '爵士 Lo-Fi',
            'zh-TW': '爵士 Lo-Fi',
            en: 'Jazz / Lo-Fi',
            ja: 'ジャズ / ローファイ',
            ko: '재즈 / 로파이',
            es: 'Jazz / Lo-Fi',
            fr: 'Jazz / Lo-Fi',
            de: 'Jazz / Lo-Fi',
            'pt-BR': 'Jazz / Lo-Fi',
            ru: 'Джаз / Lo-Fi',
            ar: 'جاز / لو-فاي',
            hi: 'जैज़ / लो-फ़ाई'
        }),
        facets: {
            genre: { tag: 'jazz_lofi', clause: 'jazzy lo-fi chillhop and extended seventh-chord harmony' },
            instrumentation: { tag: 'jazz_rhodes_brush', clause: 'warm Fender Rhodes electric piano, upright bass, brushed snare and mellow saxophone' },
            tempo: { tag: 'slow', clause: 'laid-back 80 BPM swing groove' },
            mood: { tag: 'chill_relaxed', clause: 'cozy late-night cafe nostalgia' }
        }
    },
    {
        id: 'healing_piano',
        domain: 'music',
        labelZhCN: '治愈纯钢琴',
        labelEn: 'Healing Solo Piano',
        labels: makeLabels({
            'zh-CN': '治愈纯钢琴',
            'zh-TW': '療癒純鋼琴',
            en: 'Healing Solo Piano',
            ja: '癒やしソロピアノ',
            ko: '힐링 솔로 피아노',
            es: 'Piano solo relajante',
            fr: 'Piano solo apaisant',
            de: 'Heilsames Solo-Klavier',
            'pt-BR': 'Piano Solo Relaxante',
            ru: 'Исцеляющее соло фортепиано',
            ar: 'بيانو منفرد هادئ',
            hi: 'सुकूनदेह सोलो पियानो'
        }),
        facets: {
            genre: { tag: 'solo_piano', clause: 'neoclassical healing piano composition' },
            instrumentation: { tag: 'solo_piano', clause: 'intimate felt grand piano with delicate pedal resonance' },
            tempo: { tag: 'slow', clause: 'gentle rubato slow tempo' },
            mood: { tag: 'healing_calm', clause: 'serene comforting emotional warmth' }
        }
    },
    {
        id: 'synthwave',
        domain: 'music',
        labelZhCN: '赛博合成波',
        labelEn: 'Cyber Synthwave',
        labels: makeLabels({
            'zh-CN': '赛博合成波',
            'zh-TW': '賽博合成波',
            en: 'Cyber Synthwave',
            ja: 'サイバー・シンセウェーブ',
            ko: '사이버 신스웨이브',
            es: 'Synthwave cyber',
            fr: 'Synthwave cyber',
            de: 'Cyber-Synthwave',
            'pt-BR': 'Cyber Synthwave',
            ru: 'Кибер-синтвейв',
            ar: 'سينثويف سايبر',
            hi: 'साइबर सिंथवेव'
        }),
        facets: {
            genre: { tag: 'synthwave', clause: '80s retro-futuristic outrun synthwave soundtrack' },
            instrumentation: { tag: 'analog_synthwave', clause: 'analog Juno arpeggios, gated-reverb snare, pulsing saw bass and soaring lead synth' },
            tempo: { tag: 'mid', clause: 'steady nocturnal 108 BPM cruising pulse' },
            mood: { tag: 'retro_nocturnal', clause: 'neon-drenched cyberpunk night drive atmosphere' }
        }
    },
    {
        id: 'orchestral',
        domain: 'music',
        labelZhCN: '古典管弦',
        labelEn: 'Classical Orchestral',
        labels: makeLabels({
            'zh-CN': '古典管弦',
            'zh-TW': '古典管弦',
            en: 'Classical Orchestral',
            ja: 'クラシック管弦楽',
            ko: '클래식 오케스트라',
            es: 'Orquestal clásico',
            fr: 'Orchestral classique',
            de: 'Klassisch Orchestral',
            'pt-BR': 'Orquestral Clássico',
            ru: 'Классический оркестр',
            ar: 'أوركسترا كلاسيكية',
            hi: 'शास्त्रीय ऑर्केस्ट्रा'
        }),
        facets: {
            genre: { tag: 'orchestral', clause: 'classical symphonic concert hall arrangement' },
            instrumentation: { tag: 'symphonic_orchestra', clause: 'full string section, woodwinds, concert harp, French horns and timpani' },
            tempo: { tag: 'mid', clause: 'expressive symphonic phrasing' },
            mood: { tag: 'poetic_elegant', clause: 'noble timeless orchestral grandeur' }
        }
    }
];

export function comicStylePresetLabel(
    locale: NextMuxDesktopLocale,
    preset: { readonly labels: Readonly<Record<NextMuxDesktopLocale, string>>; readonly labelEn: string }
): string {
    return preset.labels[locale] ?? preset.labelEn;
}

export function getComicStylePresetLabel(
    domain: ComicStyleDomain,
    presetId: string,
    locale: NextMuxDesktopLocale
): string {
    const list: readonly ComicStylePreset[] = domain === 'music' ? COMIC_MUSIC_STYLE_PRESETS : COMIC_VISUAL_STYLE_PRESETS;
    const found = list.find(item => item.id === presetId) ?? list[0];
    return comicStylePresetLabel(locale, found);
}

// ---------------------------------------------------------------------------
// Conflict Detection Rules (User-Prompt-First)
// ---------------------------------------------------------------------------

const VISUAL_MEDIUM_DETECTORS: readonly { readonly tag: VisualMediumTag; readonly pattern: RegExp }[] = [
    {
        tag: 'live_action',
        pattern: /真人|实拍|写实摄影|照片级|纪实摄影|单反实拍|电影实拍|live[- ]?action|photoreal(?:istic)?|raw photo|real[- ]person|documentary footage/i
    },
    {
        tag: 'semi_realistic_cg',
        pattern: /仿真人|3d\s*cg|虚幻引擎|\bue5\b|\boctane\b|\bredshift\b|\bc4d\b|\bblender\b|semi[- ]?realistic\s*cg|unreal engine/i
    },
    {
        tag: 'anime_2d',
        pattern: /动漫|二次元|赛璐璐|日漫|番剧|手绘动画|2d\s*动画|\banime\b|\bmanga\b|2d\s*cel|cel[- ]?shad/i
    },
    {
        tag: 'cartoon_3d',
        pattern: /皮克斯|迪士尼|卡通\s*3d|三头身|盲盒公仔|\bpixar\b|\bdisney\b|3d\s*cartoon/i
    },
    {
        tag: 'ink_wash',
        pattern: /水墨|国画|白描|写意画|工笔画|宣纸|ink[- ]?wash|sumi[- ]?e|chinese ink painting/i
    },
    {
        tag: 'oil_impasto',
        pattern: /油画|厚涂|水彩|丙烯画|印象派|梵高|oil painting|\bimpasto\b|\bgouache\b|\bwatercolor\b/i
    },
    {
        tag: 'clay_stopmotion',
        pattern: /黏土|粘土|定格动画|泥塑|毛毡|折纸|\bclay(?:mation)?\b|stop[- ]?motion|\bfelt puppet\b/i
    },
    {
        tag: 'pixel_retro',
        pattern: /像素|8[- ]?bit|16[- ]?bit|红白机|街机点阵|pixel[- ]?art|\bvoxel\b/i
    }
];

const VISUAL_ERA_DETECTORS: readonly { readonly tag: VisualEraTag; readonly pattern: RegExp }[] = [
    {
        tag: 'ancient_chinese',
        pattern: /古风|古代|古装|仙侠|武侠|修仙|汉服|宫廷|江湖|长安|王朝|ancient chinese|\bdynasty\b|\bhanfu\b|\bxianxia\b|\bwuxia\b/i
    },
    {
        tag: 'modern_urban',
        pattern: /现代|都市|城市街头|摩天大楼|写字楼|地铁|汽车|西装|便利店|咖啡馆|现代校园|教室|街头滑板|\bmodern\b|\burban\b|city street|\bdowntown\b|\bskyscraper\b|\bsubway\b|modern office/i
    },
    {
        tag: 'cyberpunk_scifi',
        pattern: /赛博朋克|赛博|科幻|未来都市|机甲|太空|星际|全息|宇宙飞船|废土机械|\bcyberpunk\b|sci[- ]?fi|\bfuturistic\b|\bmecha\b|\bspaceship\b|\bhologram\b/i
    },
    {
        tag: 'dark_fantasy',
        pattern: /中世纪|哥特古堡|地下城|暗黑魔幻|恶魔深渊|克苏鲁|\bmedieval\b|gothic castle|\bdungeon\b|\belden\b|\blovecraft\b/i
    }
];

const VISUAL_LIGHTING_CONFLICTS: readonly { readonly allowTags: readonly VisualLightingTag[]; readonly pattern: RegExp }[] = [
    {
        allowTags: ['bright_fresh'],
        pattern: /正午|烈日|晴朗白昼|阳光明媚|刺眼阳光|高调光|harsh midday|bright daylight|sunny afternoon|high[- ]?key lighting/i
    },
    {
        allowTags: ['neon_night'],
        pattern: /赛博朋克|赛博霓虹|霓虹夜景|赛博雨夜|激光灯|neon[- ]?lit night|cyberpunk neon/i
    },
    {
        allowTags: ['dark_moody'],
        pattern: /伸手不见五指|暗黑阴影|恐怖幽暗|深夜烛光|阴森|低压暗调|黑白默片|pitch dark|low[- ]?key chiaroscuro|eerie candlelight|gothic gloom|\bnoir\b/i
    },
    {
        allowTags: [],
        pattern: /布光为|打光为|光线设定|lighting\s*:/i
    }
];

const VISUAL_PALETTE_CONFLICTS: readonly { readonly allowTags: readonly VisualPaletteTag[]; readonly pattern: RegExp }[] = [
    {
        allowTags: [],
        pattern: /黑白|默片|单色|去色|黑白胶片|素描黑白|black[- ]?and[- ]?white|\bmonochrome\b|\bgrayscale\b|\bnoir\b|\bb&w\b/i
    },
    {
        allowTags: ['neon_cyan_magenta'],
        pattern: /赛博朋克霓虹|赛博霓虹|荧光霓虹|电光蓝|品红青色|\bcyberpunk neon\b|\bneon palette\b|magenta[- ]cyan/i
    },
    {
        allowTags: ['pastel_sky'],
        pattern: /莫兰迪|低饱和粉彩|马卡龙色|\bpastel palette\b|\bmorandi\b/i
    },
    {
        allowTags: ['dark_gothic'],
        pattern: /废土冷灰|阴冷低饱和|暗沉灰调|bleach bypass|desaturated grim/i
    },
    {
        allowTags: [],
        pattern: /色调为|主色调|配色为|color palette\s*:|color grading\s*:/i
    }
];

const VISUAL_CAMERA_CONFLICTS: readonly { readonly allowTags: readonly VisualCameraTag[]; readonly pattern: RegExp }[] = [
    {
        allowTags: ['macro_miniature'],
        pattern: /极特写|面部特写|微距|眼部特写|extreme close[- ]?up|\bmacro\b|tight close[- ]?up/i
    },
    {
        allowTags: ['poetic_wide'],
        pattern: /航拍|无人机|上帝视角|鸟瞰|俯拍全景|\baerial\b|\bdrone\b|bird'?s[- ]?eye|top[- ]?down/i
    },
    {
        allowTags: [],
        pattern: /第一人称|主观视角|手持晃动|伪纪录|鱼眼|固定机位|静止三脚架|\bpov\b|first[- ]?person|shaky handheld|found footage|\bfisheye\b|static tripod|locked[- ]?off/i
    }
];

const MUSIC_GENRE_DETECTORS: readonly { readonly tag: MusicGenreTag; readonly pattern: RegExp }[] = [
    { tag: 'rock', pattern: /摇滚|重金属|朋克|硬核|死金|\brock\b|heavy metal|\bpunk\b|\bgrunge\b|\bhardcore\b/i },
    { tag: 'hiphop_rap', pattern: /说唱|嘻哈|\btrap\b|\bdrill\b|boom\s*bap|\bhip[- ]?hop\b|\brap\b/i },
    { tag: 'electronic_edm', pattern: /电子舞曲|\bedm\b|\btechno\b|\bhouse\b|\bdubstep\b|\btrance\b|drum and bass|\bdnb\b/i },
    { tag: 'guofeng', pattern: /古风|国风|中国风|戏腔|民乐|\bguofeng\b|traditional chinese music/i },
    { tag: 'acoustic_folk', pattern: /民谣|乡村原声|\bfolk\b|\bamericana\b|acoustic country/i },
    { tag: 'jazz_lofi', pattern: /爵士|蓝调|布鲁斯|波萨诺瓦|\bjazz\b|\bblues\b|bossa nova|lo[- ]?fi/i },
    { tag: 'orchestral', pattern: /古典交响|巴洛克|室内乐|歌剧|\bclassical\b|\bsymphony\b|\bbaroque\b|\bopera\b/i },
    { tag: 'synthwave', pattern: /合成波|蒸汽波|\bsynthwave\b|\bvaporwave\b|\bretrowave\b/i },
    { tag: 'jpop_anime', pattern: /日系燃曲|二次元主题曲|\bj[- ]?pop\b|\banisong\b|anime opening/i },
    { tag: 'solo_piano', pattern: /纯钢琴曲|钢琴独奏曲|solo piano piece/i }
];

const MUSIC_INSTRUMENT_CONFLICTS: readonly { readonly allowTags: readonly MusicInstrumentTag[]; readonly pattern: RegExp }[] = [
    {
        allowTags: ['acappella'],
        pattern: /阿卡贝拉|无伴奏|纯人声清唱|不要乐器|a\s*cappella|unaccompanied vocal|vocals only/i
    },
    {
        allowTags: ['solo_piano'],
        pattern: /纯钢琴|钢琴独奏|仅有钢琴|只有钢琴|solo piano|piano only/i
    },
    {
        allowTags: ['electric_rock_band', 'jpop_band_strings'],
        pattern: /失真电吉他|重金属电吉他|重型电吉他|双踩架子鼓|电吉他嘶吼|distorted electric guitar|heavy metal guitar|double kick drum/i
    },
    {
        allowTags: ['chinese_traditional'],
        pattern: /纯民乐|古筝独奏|二胡独奏|琵琶独奏|竹笛独奏|唢呐|\bguzheng solo\b|\berhu solo\b|\bsuona\b/i
    },
    {
        allowTags: ['hiphop_808', 'edm_synths', 'analog_synthwave'],
        pattern: /808\s*鼓|重低音\s*808|酸音合成器|\b808\s*bass\b|acid synth|modular synth only/i
    },
    {
        allowTags: ['acoustic_guitar'],
        pattern: /木吉他独奏|指弹木吉他|只有木吉他|solo acoustic guitar|fingerstyle guitar only/i
    }
];

const MUSIC_MOOD_CONFLICTS: readonly { readonly allowTags: readonly MusicMoodTag[]; readonly pattern: RegExp }[] = [
    {
        allowTags: ['sad_melancholic'],
        pattern: /悲伤|凄凉|忧郁|苦涩|催泪|哀伤|心碎|\bsad\b|\bmelanchol(?:y|ic)\b|\bheartbreak\b|\bsorrow(?:ful)?\b|\btearful\b/i
    },
    {
        allowTags: ['dark_tense'],
        pattern: /阴森|诡异|恐怖|压抑|悬疑|暗黑|绝望|\bdark\b|\beerie\b|\bsuspense(?:ful)?\b|\bominous\b|\bhorror\b|\bgrim\b/i
    },
    {
        allowTags: ['energetic_driving', 'epic_dramatic'],
        pattern: /狂暴|愤怒|炸裂|热血沸腾|激昂燃爆|重金属咆哮|\baggressive\b|\bfierce\b|\bfurious\b|\bexplosive\b|\bhype\b/i
    },
    {
        allowTags: ['healing_calm', 'chill_relaxed', 'warm_intimate'],
        pattern: /安静治愈|助眠|冥想|宁静平和|催眠温柔|\bcalm\b|\bpeaceful\b|\bmeditative\b|\bsoothing\b|\blullaby\b/i
    },
    {
        allowTags: ['uplifting_bright'],
        pattern: /欢快甜美|开心活泼|喜庆热闹|轻松搞笑|\bcheerful\b|\bjoyful\b|\bhappy\b|\bplayful\b|\bfestive\b/i
    }
];

function detectUserMusicTempo(prompt: string): { readonly explicitBpm: boolean; readonly tag?: MusicTempoTag } {
    const bpmMatch = prompt.match(/(\d{2,3})\s*bpm\b/i);
    if (bpmMatch) {
        const bpm = Number(bpmMatch[1]);
        if (Number.isFinite(bpm) && bpm > 0) {
            const tag: MusicTempoTag = bpm <= 85 ? 'slow' : bpm >= 120 ? 'fast' : 'mid';
            return { explicitBpm: true, tag };
        }
    }
    if (/慢速|慢节奏|舒缓慢板|极慢|缓慢|\bslow(?:\s+tempo)?\b|\badagio\b|\blento\b|\bdowntempo\b/i.test(prompt)) {
        return { explicitBpm: false, tag: 'slow' };
    }
    if (/快节奏|高速|疾驰|激燃快板|极快|快板|\bfast(?:\s+tempo)?\b|\bupbeat\b|high[- ]?tempo|\ballegro\b|\bpresto\b/i.test(prompt)) {
        return { explicitBpm: false, tag: 'fast' };
    }
    return { explicitBpm: false };
}

function hasVisualFacetConflict(
    prompt: string,
    facetName: keyof ComicVisualStyleFacets,
    facet: ComicFacetClause<string>
): boolean {
    if (!prompt) {
        return false;
    }
    switch (facetName) {
        case 'medium':
            return VISUAL_MEDIUM_DETECTORS.some(detector => detector.tag !== facet.tag && detector.pattern.test(prompt));
        case 'era':
            return VISUAL_ERA_DETECTORS.some(detector => detector.tag !== facet.tag && detector.pattern.test(prompt));
        case 'lighting':
            return VISUAL_LIGHTING_CONFLICTS.some(rule => !rule.allowTags.includes(facet.tag as VisualLightingTag) && rule.pattern.test(prompt));
        case 'palette':
            return VISUAL_PALETTE_CONFLICTS.some(rule => !rule.allowTags.includes(facet.tag as VisualPaletteTag) && rule.pattern.test(prompt));
        case 'camera':
            return VISUAL_CAMERA_CONFLICTS.some(rule => !rule.allowTags.includes(facet.tag as VisualCameraTag) && rule.pattern.test(prompt));
        default:
            return false;
    }
}

function hasMusicFacetConflict(
    prompt: string,
    facetName: keyof ComicMusicStyleFacets,
    facet: ComicFacetClause<string>
): boolean {
    if (!prompt) {
        return false;
    }
    switch (facetName) {
        case 'genre':
            return MUSIC_GENRE_DETECTORS.some(detector => detector.tag !== facet.tag && detector.pattern.test(prompt));
        case 'instrumentation':
            return MUSIC_INSTRUMENT_CONFLICTS.some(
                rule => !rule.allowTags.includes(facet.tag as MusicInstrumentTag) && rule.pattern.test(prompt)
            );
        case 'tempo': {
            const detected = detectUserMusicTempo(prompt);
            if (detected.explicitBpm) {
                // Whenever the user specifies an exact BPM, never inject a preset BPM/tempo phrase that could fight it.
                return true;
            }
            return Boolean(detected.tag && detected.tag !== facet.tag);
        }
        case 'mood':
            return MUSIC_MOOD_CONFLICTS.some(
                rule => !rule.allowTags.includes(facet.tag as MusicMoodTag) && rule.pattern.test(prompt)
            );
        default:
            return false;
    }
}

/**
 * Merges a user's prompt with a selected visual or music style preset while guaranteeing
 * **User-Prompt-First** priority:
 *
 * - `userPrompt.trim()` always appears first (index 0) so the user's explicit intent carries
 *   the highest attention weight.
 * - Any preset facet (`medium`, `era`, `lighting`, `palette`, `camera` for `'visual'`;
 *   `genre`, `instrumentation`, `tempo`, `mood` for `'music'`) that conflicts with the user's
 *   prompt is omitted.
 * - When `presetId === 'none'` or unknown, returns `userPrompt.trim()` unchanged.
 */
export function mergeComicPromptWithStylePreset(
    userPrompt: string,
    presetId: string,
    domain: ComicStyleDomain
): string {
    const trimmed = (userPrompt ?? '').trim();
    if (!presetId || presetId === 'none') {
        return trimmed;
    }

    const keptClauses: string[] = [];
    const normalizedLower = trimmed.toLowerCase();

    if (domain === 'visual') {
        const preset = COMIC_VISUAL_STYLE_PRESETS.find(item => item.id === presetId);
        if (!preset) {
            return trimmed;
        }
        const order: readonly (keyof ComicVisualStyleFacets)[] = ['medium', 'era', 'lighting', 'palette', 'camera'];
        for (const key of order) {
            const facet = preset.facets[key];
            if (!facet || !facet.clause) {
                continue;
            }
            if (hasVisualFacetConflict(trimmed, key, facet)) {
                continue;
            }
            if (normalizedLower && normalizedLower.includes(facet.clause.toLowerCase())) {
                continue;
            }
            keptClauses.push(facet.clause);
        }
    } else {
        const preset = COMIC_MUSIC_STYLE_PRESETS.find(item => item.id === presetId);
        if (!preset) {
            return trimmed;
        }
        const order: readonly (keyof ComicMusicStyleFacets)[] = ['genre', 'instrumentation', 'tempo', 'mood'];
        for (const key of order) {
            const facet = preset.facets[key];
            if (!facet || !facet.clause) {
                continue;
            }
            if (hasMusicFacetConflict(trimmed, key, facet)) {
                continue;
            }
            if (normalizedLower && normalizedLower.includes(facet.clause.toLowerCase())) {
                continue;
            }
            keptClauses.push(facet.clause);
        }
    }

    if (keptClauses.length === 0) {
        return trimmed;
    }
    if (!trimmed) {
        return keptClauses.join(', ');
    }
    const separator = /[。！？.!?,，;；:：]$/.test(trimmed) ? ' ' : ', ';
    return `${trimmed}${separator}${keptClauses.join(', ')}`;
}
