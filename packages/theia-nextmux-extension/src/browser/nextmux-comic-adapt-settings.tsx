import * as React from '@theia/core/shared/react';
import { COMIC_SETTING_KEYS, COMIC_SETTING_PRESETS, comicLengthPlan, comicSettingPreset, normalizeComicAdaptSettings, type ComicSettingKey } from '@nextmux/comic-core/adaptation';
import type { ComicAdaptSettings } from '@nextmux/comic-core/adaptation';
import { ImeInput } from './nextmux-ime-field';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

/**
 * The adaptation settings in the new-comic sheet: episodes, length per episode and seven choices
 * (point of view, style, character rendering, costume, lighting, pacing, sound), each “follow the
 * text” by default or in the user's own words. The production desk (nextmux-comic-desk.tsx) follows.
 */
type Key = 'episodes' | 'episodeSeconds' | 'seconds' | 'minutes' | ComicSettingKey | 'custom' | 'customPlaceholder';

type Labels = Record<Key, string>;
/** Preset labels per setting, in COMIC_SETTING_PRESETS order, separated by "|". */
type OptionLabels = Record<ComicSettingKey, string>;

const TEXT: Record<string, Labels> = {
    'zh-CN': { episodes: '集数', episodeSeconds: '每集时长', seconds: '{n} 秒', minutes: '{n} 分钟', perspective: '叙述视角', style: '画面风格', look: '人物形象', costume: '服装', lighting: '光线', pacing: '节奏', sound: '声音', custom: '自定义…', customPlaceholder: '用你自己的话描述' },
    'zh-TW': { episodes: '集數', episodeSeconds: '每集時長', seconds: '{n} 秒', minutes: '{n} 分鐘', perspective: '敘述視角', style: '畫面風格', look: '人物形象', costume: '服裝', lighting: '光線', pacing: '節奏', sound: '聲音', custom: '自訂…', customPlaceholder: '用你自己的話描述' },
    en: { episodes: 'Episodes', episodeSeconds: 'Length per episode', seconds: '{n} s', minutes: '{n} min', perspective: 'Point of view', style: 'Visual style', look: 'Characters', costume: 'Costume', lighting: 'Lighting', pacing: 'Pacing', sound: 'Sound', custom: 'Custom…', customPlaceholder: 'Describe it in your own words' },
    ja: { episodes: '話数', episodeSeconds: '1 話の長さ', seconds: '{n} 秒', minutes: '{n} 分', perspective: '語りの視点', style: '画風', look: 'キャラクター表現', costume: '衣装', lighting: '光', pacing: 'テンポ', sound: '音声', custom: 'カスタム…', customPlaceholder: '自分の言葉で書く' },
    ko: { episodes: '에피소드 수', episodeSeconds: '에피소드 길이', seconds: '{n}초', minutes: '{n}분', perspective: '서술 시점', style: '화풍', look: '인물 표현', costume: '의상', lighting: '조명', pacing: '템포', sound: '소리', custom: '직접 입력…', customPlaceholder: '원하는 내용을 직접 적으세요' },
    es: { episodes: 'Episodios', episodeSeconds: 'Duración por episodio', seconds: '{n} s', minutes: '{n} min', perspective: 'Punto de vista', style: 'Estilo visual', look: 'Personajes', costume: 'Vestuario', lighting: 'Iluminación', pacing: 'Ritmo', sound: 'Sonido', custom: 'Personalizado…', customPlaceholder: 'Descríbelo con tus palabras' },
    fr: { episodes: 'Épisodes', episodeSeconds: 'Durée par épisode', seconds: '{n} s', minutes: '{n} min', perspective: 'Point de vue', style: 'Style visuel', look: 'Personnages', costume: 'Costumes', lighting: 'Lumière', pacing: 'Rythme', sound: 'Son', custom: 'Personnalisé…', customPlaceholder: 'Décrivez-le avec vos mots' },
    de: { episodes: 'Folgen', episodeSeconds: 'Länge pro Folge', seconds: '{n} s', minutes: '{n} Min.', perspective: 'Erzählperspektive', style: 'Bildstil', look: 'Figuren', costume: 'Kostüme', lighting: 'Licht', pacing: 'Tempo', sound: 'Ton', custom: 'Eigene…', customPlaceholder: 'In eigenen Worten beschreiben' },
    'pt-BR': { episodes: 'Episódios', episodeSeconds: 'Duração por episódio', seconds: '{n} s', minutes: '{n} min', perspective: 'Ponto de vista', style: 'Estilo visual', look: 'Personagens', costume: 'Figurino', lighting: 'Iluminação', pacing: 'Ritmo', sound: 'Som', custom: 'Personalizado…', customPlaceholder: 'Descreva com suas palavras' },
    ru: { episodes: 'Серии', episodeSeconds: 'Длина серии', seconds: '{n} с', minutes: '{n} мин', perspective: 'Точка зрения', style: 'Визуальный стиль', look: 'Персонажи', costume: 'Костюмы', lighting: 'Свет', pacing: 'Темп', sound: 'Звук', custom: 'Своё…', customPlaceholder: 'Опишите своими словами' },
    ar: { episodes: 'الحلقات', episodeSeconds: 'مدة الحلقة', seconds: '{n} ث', minutes: '{n} د', perspective: 'زاوية السرد', style: 'الأسلوب البصري', look: 'الشخصيات', costume: 'الأزياء', lighting: 'الإضاءة', pacing: 'الإيقاع', sound: 'الصوت', custom: 'مخصص…', customPlaceholder: 'صِفه بكلماتك' },
    hi: { episodes: 'एपिसोड', episodeSeconds: 'हर एपिसोड की लंबाई', seconds: '{n} से.', minutes: '{n} मिनट', perspective: 'कथा का नज़रिया', style: 'दृश्य शैली', look: 'किरदार', costume: 'पोशाक', lighting: 'रोशनी', pacing: 'रफ़्तार', sound: 'आवाज़', custom: 'अपना…', customPlaceholder: 'अपने शब्दों में लिखें' }
};

const OPTIONS: Record<string, OptionLabels> = {
    'zh-CN': {
        perspective: '跟随原文|第一人称|第三人称|旁白讲述|多视角', style: '跟随原文|古风|水墨|仙侠|科技风|未来风|赛博朋克|废土|日系动漫|国漫 3D|美漫|3D 动画|电影写实|油画|水彩',
        look: '跟随画面风格|真人|仿真人|动漫|3D 卡通|Q 版', costume: '跟随原文|古风汉服|民国|现代日常|职场|校园|科幻|奇幻', lighting: '跟随剧情|自然光|电影感|黄昏暖光|清冷|夜景霓虹|暗调|梦幻柔光',
        pacing: '跟随原文|舒缓|适中|快节奏（爽剧）', sound: '对白与音效|旁白解说|无人声（仅音乐音效）'
    },
    'zh-TW': {
        perspective: '跟隨原文|第一人稱|第三人稱|旁白講述|多視角', style: '跟隨原文|古風|水墨|仙俠|科技風|未來風|賽博龐克|廢土|日系動漫|國漫 3D|美漫|3D 動畫|電影寫實|油畫|水彩',
        look: '跟隨畫面風格|真人|仿真人|動漫|3D 卡通|Q 版', costume: '跟隨原文|古風漢服|民國|現代日常|職場|校園|科幻|奇幻', lighting: '跟隨劇情|自然光|電影感|黃昏暖光|清冷|夜景霓虹|暗調|夢幻柔光',
        pacing: '跟隨原文|舒緩|適中|快節奏（爽劇）', sound: '對白與音效|旁白解說|無人聲（僅音樂音效）'
    },
    en: {
        perspective: 'As in the text|First person|Third person|Narrator|Multiple viewpoints', style: 'As in the text|Classical Chinese|Ink wash|Xianxia fantasy|High-tech|Futuristic|Cyberpunk|Wasteland|Anime|Chinese 3D animation|American comic|3D animation|Live-action film|Oil painting|Watercolour',
        look: 'Match the style|Real actors|Realistic CG|Anime|3D cartoon|Chibi', costume: 'As in the text|Hanfu|Republic of China era|Modern everyday|Business|School|Sci-fi|Fantasy', lighting: 'Follow the story|Natural|Cinematic|Golden hour|Cool|Night neon|Low-key|Dreamy',
        pacing: 'As in the text|Slow|Balanced|Fast (short drama)', sound: 'Dialogue and effects|Narration|No speech (music and effects)'
    },
    ja: {
        perspective: '原文どおり|一人称|三人称|ナレーション|複数視点', style: '原文どおり|古風|水墨|仙侠|ハイテク|未来|サイバーパンク|荒廃世界|アニメ|中国 3D アニメ|アメコミ|3D アニメ|実写映画|油絵|水彩',
        look: '画風に合わせる|実写|リアル CG|アニメ|3D カートゥーン|ちびキャラ', costume: '原文どおり|漢服|民国|現代の普段着|ビジネス|制服|SF|ファンタジー', lighting: '物語に合わせる|自然光|シネマ風|夕暮れ|寒色|夜のネオン|ローキー|夢幻',
        pacing: '原文どおり|ゆったり|ふつう|速い（ショートドラマ）', sound: '台詞と効果音|ナレーション|台詞なし（音楽と効果音）'
    },
    ko: {
        perspective: '원문대로|1인칭|3인칭|내레이션|다중 시점', style: '원문대로|고풍|수묵|선협|하이테크|미래|사이버펑크|황무지|일본 애니|중국 3D 애니|미국 코믹스|3D 애니메이션|실사 영화|유화|수채화',
        look: '화풍에 맞춤|실사 배우|리얼 CG|애니|3D 카툰|SD 캐릭터', costume: '원문대로|한푸|민국 시대|현대 일상복|오피스|교복|SF|판타지', lighting: '줄거리에 맞춤|자연광|시네마틱|노을빛|차가운 빛|밤 네온|로우키|몽환',
        pacing: '원문대로|느리게|보통|빠르게(숏드라마)', sound: '대사와 효과음|내레이션|대사 없음(음악·효과음)'
    },
    es: {
        perspective: 'Como en el texto|Primera persona|Tercera persona|Narrador|Varios puntos de vista', style: 'Como en el texto|Clásico chino|Tinta china|Fantasía xianxia|Alta tecnología|Futurista|Cyberpunk|Páramo|Anime|Animación china 3D|Cómic americano|Animación 3D|Cine realista|Óleo|Acuarela',
        look: 'Según el estilo|Actores reales|CG realista|Anime|Dibujo 3D|Chibi', costume: 'Como en el texto|Hanfu|Época republicana|Moderno|Oficina|Escolar|Ciencia ficción|Fantasía', lighting: 'Según la historia|Natural|Cinematográfica|Hora dorada|Fría|Neón nocturno|Clave baja|Onírica',
        pacing: 'Como en el texto|Pausado|Equilibrado|Rápido (microdrama)', sound: 'Diálogo y efectos|Narración|Sin voces (música y efectos)'
    },
    fr: {
        perspective: 'Comme le texte|Première personne|Troisième personne|Narrateur|Plusieurs points de vue', style: 'Comme le texte|Chinois classique|Lavis d’encre|Fantasy xianxia|High-tech|Futuriste|Cyberpunk|Terres dévastées|Anime|Animation chinoise 3D|Comics américain|Animation 3D|Cinéma réaliste|Peinture à l’huile|Aquarelle',
        look: 'Selon le style|Acteurs réels|CG réaliste|Anime|Cartoon 3D|Chibi', costume: 'Comme le texte|Hanfu|Époque républicaine|Moderne|Bureau|Uniforme scolaire|Science-fiction|Fantasy', lighting: 'Selon l’histoire|Naturelle|Cinéma|Heure dorée|Froide|Néons de nuit|Clair-obscur|Onirique',
        pacing: 'Comme le texte|Lent|Équilibré|Rapide (série courte)', sound: 'Dialogues et effets|Narration|Sans voix (musique et effets)'
    },
    de: {
        perspective: 'Wie im Text|Ich-Perspektive|Dritte Person|Erzähler|Mehrere Perspektiven', style: 'Wie im Text|Klassisch chinesisch|Tuschemalerei|Xianxia-Fantasy|Hightech|Futuristisch|Cyberpunk|Ödland|Anime|Chinesische 3D-Animation|US-Comic|3D-Animation|Realfilm|Ölgemälde|Aquarell',
        look: 'Passend zum Stil|Echte Darsteller|Realistisches CG|Anime|3D-Cartoon|Chibi', costume: 'Wie im Text|Hanfu|Republik-Ära|Modern|Büro|Schuluniform|Science-Fiction|Fantasy', lighting: 'Nach der Handlung|Natürlich|Filmisch|Goldene Stunde|Kühl|Nacht-Neon|Low-Key|Verträumt',
        pacing: 'Wie im Text|Ruhig|Ausgewogen|Schnell (Kurzdrama)', sound: 'Dialog und Effekte|Erzählstimme|Ohne Sprache (Musik und Effekte)'
    },
    'pt-BR': {
        perspective: 'Como no texto|Primeira pessoa|Terceira pessoa|Narrador|Vários pontos de vista', style: 'Como no texto|Clássico chinês|Nanquim|Fantasia xianxia|Alta tecnologia|Futurista|Cyberpunk|Terra devastada|Anime|Animação chinesa 3D|Quadrinho americano|Animação 3D|Cinema realista|Pintura a óleo|Aquarela',
        look: 'Conforme o estilo|Atores reais|CG realista|Anime|Cartoon 3D|Chibi', costume: 'Como no texto|Hanfu|Era republicana|Moderno|Escritório|Escolar|Ficção científica|Fantasia', lighting: 'Conforme a história|Natural|Cinematográfica|Hora dourada|Fria|Neon noturno|Low-key|Onírica',
        pacing: 'Como no texto|Calmo|Equilibrado|Rápido (microdrama)', sound: 'Diálogo e efeitos|Narração|Sem falas (música e efeitos)'
    },
    ru: {
        perspective: 'Как в тексте|От первого лица|От третьего лица|Рассказчик|Несколько точек зрения', style: 'Как в тексте|Классический китайский|Тушь|Сянься|Хай-тек|Футуризм|Киберпанк|Пустоши|Аниме|Китайская 3D-анимация|Американский комикс|3D-анимация|Игровое кино|Масло|Акварель',
        look: 'По стилю|Живые актёры|Реалистичная графика|Аниме|3D-мультфильм|Чиби', costume: 'Как в тексте|Ханьфу|Эпоха республики|Современная одежда|Офис|Школьная форма|Научная фантастика|Фэнтези', lighting: 'По сюжету|Естественный|Кинематографичный|Золотой час|Холодный|Ночной неон|Низкий ключ|Мечтательный',
        pacing: 'Как в тексте|Неспешный|Умеренный|Быстрый (короткая драма)', sound: 'Диалоги и эффекты|Закадровый голос|Без речи (музыка и эффекты)'
    },
    ar: {
        perspective: 'كما في النص|ضمير المتكلم|ضمير الغائب|راوٍ|وجهات نظر متعددة', style: 'كما في النص|صيني كلاسيكي|حبر صيني|خيال شيانشيا|تقنية عالية|مستقبلي|سايبربانك|أرض قاحلة|أنمي|رسوم صينية ثلاثية الأبعاد|كوميكس أمريكي|رسوم ثلاثية الأبعاد|سينما واقعية|لوحة زيتية|ألوان مائية',
        look: 'حسب الأسلوب|ممثلون حقيقيون|CG واقعي|أنمي|كرتون ثلاثي الأبعاد|تشيبي', costume: 'كما في النص|هانفو|حقبة الجمهورية|عصري يومي|رسمي للعمل|زي مدرسي|خيال علمي|فانتازيا', lighting: 'حسب القصة|طبيعية|سينمائية|الساعة الذهبية|باردة|نيون ليلي|إضاءة خافتة|حالمة',
        pacing: 'كما في النص|هادئ|متوازن|سريع (دراما قصيرة)', sound: 'حوار ومؤثرات|راوٍ|بلا كلام (موسيقى ومؤثرات)'
    },
    hi: {
        perspective: 'मूल पाठ जैसा|प्रथम पुरुष|तृतीय पुरुष|सूत्रधार|कई नज़रिए', style: 'मूल पाठ जैसा|शास्त्रीय चीनी|स्याही चित्र|शियानशिया फ़ैंटेसी|हाई-टेक|भविष्यवादी|साइबरपंक|वीरान दुनिया|एनीमे|चीनी 3D एनिमेशन|अमेरिकी कॉमिक|3D एनिमेशन|लाइव-एक्शन फ़िल्म|तैल चित्र|जलरंग',
        look: 'शैली के अनुसार|असली कलाकार|यथार्थ CG|एनीमे|3D कार्टून|चिबी', costume: 'मूल पाठ जैसा|हानफ़ू|गणराज्य काल|आधुनिक रोज़मर्रा|दफ़्तर|स्कूल यूनिफ़ॉर्म|साइंस-फ़िक्शन|फ़ैंटेसी', lighting: 'कहानी के अनुसार|प्राकृतिक|सिनेमाई|सुनहरी शाम|ठंडी|रात की नियॉन|लो-की|स्वप्निल',
        pacing: 'मूल पाठ जैसा|धीमी|संतुलित|तेज़ (शॉर्ट ड्रामा)', sound: 'संवाद और इफ़ेक्ट|सूत्रधार|बिना संवाद (संगीत और इफ़ेक्ट)'
    }
};

function table<T>(tables: Record<string, T>, locale: string): T {
    return tables[locale] || tables[locale.split('-')[0]] || tables.en;
}

function uncheckedComicFlowText(locale: string, key: Key, values: Record<string, string | number> = {}): string {
    return (table(TEXT, locale)[key] || TEXT.en[key]).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
}

/** Menu labels for one setting, keyed by preset id. */
export function comicSettingOptions(locale: string, key: ComicSettingKey): readonly { readonly id: string; readonly label: string }[] {
    // An unknown setting has no options (never a throw while rendering).
    const labels = (table(OPTIONS, locale)[key] ?? OPTIONS.en[key] ?? '').split('|');
    const fallback = (OPTIONS.en[key] ?? '').split('|');
    return Object.keys(COMIC_SETTING_PRESETS[key] ?? {}).map((id, index) => ({ id, label: labels[index] || fallback[index] || id }));
}

/** For tests: every locale has a label for every preset. */
export const COMIC_FLOW_LOCALES = Object.keys(TEXT);
export function comicFlowOptionCounts(locale: string): Record<ComicSettingKey, number> {
    return Object.fromEntries(COMIC_SETTING_KEYS.map(key => [key, (OPTIONS[locale] || OPTIONS.en)[key].split('|').length])) as Record<ComicSettingKey, number>;
}

const EPISODE_SECONDS = [30, 60, 90, 120, 180, 300, 600];
const CUSTOM = '__custom';

/** The adaptation settings in the new-comic sheet: episodes, length, and seven look-and-feel choices. */
/** How the story's length compares with the chosen screen time (the same measure the adaptation brief uses). */
const LENGTH_TEXT: Record<string, readonly [string, string, string, string, string, string]> = {
    'zh-CN': ["原文约 {units} {unit}，照原样拍约 {source} 秒；设置共 {target} 秒（{episodes} 集 × {each} 秒）→ ", "AI 会忠实扩写约 {factor} 倍：补足动作、对白和情绪，不加新情节。", "AI 会浓缩到约 {percent}%：保留主线、转折和关键台词。", "长度相当，按原文逐场改编。", "字", "词"],
    'zh-TW': ["原文約 {units} {unit}，照原樣拍約 {source} 秒；設定共 {target} 秒（{episodes} 集 × {each} 秒）→ ", "AI 會忠實擴寫約 {factor} 倍：補足動作、對白和情緒，不加新情節。", "AI 會濃縮到約 {percent}%：保留主線、轉折和關鍵台詞。", "長度相當，依原文逐場改編。", "字", "詞"],
    en: ["The story is about {units} {unit}, about {source} s on screen as written; you chose {target} s ({episodes} × {each} s) → ", "the AI expands it about {factor}× faithfully: more action, dialogue and emotion, no new plot.", "the AI condenses it to about {percent}%: the main line, turning points and key lines stay.", "the length fits; it is adapted scene for scene.", "characters", "words"],
    ja: ["原文は約 {units} {unit}、そのまま映像化すると約 {source} 秒。設定は計 {target} 秒（{episodes} 話 × {each} 秒）→ ", "AI が約 {factor} 倍に忠実に膨らませます（動き・台詞・感情を補い、新しい筋は加えません）。", "AI が約 {percent}% に凝縮します（本筋・転機・重要な台詞は残します）。", "長さが合っているので、原文どおりに脚色します。", "字", "語"],
    ko: ["원문 약 {units}{unit}, 그대로 찍으면 약 {source}초. 설정은 총 {target}초({episodes}화 × {each}초) → ", "AI가 약 {factor}배로 충실히 늘립니다(동작·대사·감정 보강, 새 줄거리 없음).", "AI가 약 {percent}%로 압축합니다(주요 줄거리·전환점·핵심 대사 유지).", "길이가 맞아 원문대로 각색합니다.", "자", "단어"],
    es: ["El texto tiene unas {units} {unit}: tal cual, unos {source} s en pantalla; elegiste {target} s ({episodes} × {each} s) → ", "la IA lo amplía unas {factor} veces, con fidelidad: más acción, diálogo y emoción, sin trama nueva.", "la IA lo condensa a un {percent}%: se conservan la trama, los giros y las frases clave.", "la duración encaja; se adapta escena por escena.", "caracteres", "palabras"],
    fr: ["Le texte fait environ {units} {unit}, soit environ {source} s à l’écran tel quel ; vous avez choisi {target} s ({episodes} × {each} s) → ", "l’IA l’étoffe d’environ {factor}×, fidèlement : plus d’action, de dialogue et d’émotion, sans nouvelle intrigue.", "l’IA le condense à environ {percent} % : l’intrigue, les tournants et les répliques clés restent.", "la durée convient ; adaptation scène par scène.", "caractères", "mots"],
    de: ["Der Text hat etwa {units} {unit}, wörtlich verfilmt etwa {source} s; gewählt sind {target} s ({episodes} × {each} s) → ", "die KI erweitert ihn etwa {factor}-fach, werkgetreu: mehr Handlung, Dialog und Gefühl, keine neue Handlung.", "die KI verdichtet ihn auf etwa {percent} %: Handlung, Wendepunkte und Schlüsselsätze bleiben.", "die Länge passt; Szene für Szene adaptiert.", "Zeichen", "Wörter"],
    'pt-BR': ["O texto tem cerca de {units} {unit}, uns {source} s na tela como está; você escolheu {target} s ({episodes} × {each} s) → ", "a IA o expande cerca de {factor}×, com fidelidade: mais ação, diálogo e emoção, sem enredo novo.", "a IA o condensa para cerca de {percent}%: enredo, viradas e falas-chave ficam.", "a duração bate; adaptação cena a cena.", "caracteres", "palavras"],
    ru: ["В тексте около {units} {unit}, как есть — около {source} с на экране; выбрано {target} с ({episodes} × {each} с) → ", "ИИ бережно расширит его примерно в {factor} раза: больше действия, диалогов и эмоций, без нового сюжета.", "ИИ сожмёт его примерно до {percent}%: сюжет, повороты и ключевые реплики сохранятся.", "длина подходит — адаптация сцена за сценой.", "знаков", "слов"],
    ar: ["النص نحو {units} {unit}، أي نحو {source} ث على الشاشة كما هو؛ اخترت {target} ث ({episodes} × {each} ث) ← ", "سيوسّعه الذكاء الاصطناعي نحو {factor} مرة بأمانة: حركة وحوار وعاطفة أكثر، دون حبكة جديدة.", "سيكثّفه الذكاء الاصطناعي إلى نحو {percent}%: تبقى الحبكة والتحولات والجمل الأساسية.", "الطول مناسب؛ يُقتبس مشهدًا بمشهد.", "حرفًا", "كلمة"],
    hi: ["कहानी लगभग {units} {unit} की है, जैसी है वैसी लगभग {source} सेकंड; आपने {target} सेकंड चुने ({episodes} × {each} से.) → ", "AI इसे ईमानदारी से लगभग {factor} गुना बढ़ाएगा: ज़्यादा ऐक्शन, संवाद और भाव, कोई नया कथानक नहीं।", "AI इसे लगभग {percent}% तक संक्षिप्त करेगा: मुख्य कथा, मोड़ और अहम संवाद बने रहेंगे।", "लंबाई ठीक है; दृश्य-दर-दृश्य रूपांतरण होगा।", "अक्षर", "शब्द"],
};

export function comicLengthPlanText(locale: string, sourceText: string, settings: ComicAdaptSettings): string {
    if (!sourceText.trim()) return '';
    const plan = comicLengthPlan(sourceText, settings.episodes, settings.episodeSeconds);
    const [lead, expand, condense, keep, characters, words] = LENGTH_TEXT[locale] || LENGTH_TEXT[locale.split('-')[0]] || LENGTH_TEXT.en;
    const fill = (text: string): string => text.replace(/\{(\w+)\}/g, (_, name: string) => String(({ units: plan.units.toLocaleString(), unit: plan.unit === 'characters' ? characters : words,
        source: plan.sourceSeconds, target: plan.targetSeconds, episodes: settings.episodes, each: settings.episodeSeconds, factor: plan.factor.toFixed(1), percent: Math.round(plan.factor * 100) } as Record<string, string | number>)[name] ?? ''));
    return fill(lead) + fill(plan.mode === 'expand' ? expand : plan.mode === 'condense' ? condense : keep);
}

export function ComicAdaptSettingsFields(props: {
    readonly locale: string;
    readonly settings: ComicAdaptSettings;
    readonly disabled?: boolean;
    /** The story: shown against the chosen length (condensed, expanded or kept) before adapting. */
    readonly sourceText?: string;
    readonly onChange: (settings: ComicAdaptSettings) => void;
}): React.ReactElement {
    const { locale, settings } = props;
    const lengthPlan = props.sourceText ? comicLengthPlanText(locale, props.sourceText, settings) : '';
    const t = (key: Key, values?: Record<string, string | number>) => comicFlowText(locale, key, values);
    const [customOpen, setCustomOpen] = React.useState<Partial<Record<ComicSettingKey, boolean>>>({});
    const set = (patch: Partial<ComicAdaptSettings>) => props.onChange({ ...settings, ...patch });
    const lengths = EPISODE_SECONDS.includes(settings.episodeSeconds) ? EPISODE_SECONDS : [...EPISODE_SECONDS, settings.episodeSeconds].sort((a, b) => a - b);
    return <div className='nmx-comic-flow-settings'>
        <div className='nmx-comic-flow-settings-row'>
            <label className='nmx-comic-field'>{t('episodes')}
                <input type='number' min={1} max={100} step={1} disabled={props.disabled} value={settings.episodes}
                    onChange={event => { const value = Math.round(Number(event.currentTarget.value)); if (value >= 1 && value <= 100) set({ episodes: value }); }} /></label>
            <label className='nmx-comic-field'>{t('episodeSeconds')}
                <select disabled={props.disabled} value={String(settings.episodeSeconds)} onChange={event => set({ episodeSeconds: Number(event.currentTarget.value) })}>
                    {lengths.map(value => <option key={value} value={value}>{value < 60 || value % 60 ? t('seconds', { n: value }) : t('minutes', { n: value / 60 })}</option>)}
                </select></label>
        </div>
        {lengthPlan && <p className='nmx-comic-length-plan' data-nmx-literal>{lengthPlan}</p>}
        <div className='nmx-comic-flow-settings-grid'>
            {COMIC_SETTING_KEYS.map(key => {
                const value = settings[key] || 'default';
                const preset = comicSettingPreset(key, value);
                const custom = !preset || customOpen[key];
                return <label key={key} className={`nmx-comic-field ${custom ? 'is-custom' : ''}`}>{t(key)}
                    <select disabled={props.disabled} value={custom ? CUSTOM : preset} onChange={event => {
                        const next = event.currentTarget.value;
                        if (next === CUSTOM) { setCustomOpen({ ...customOpen, [key]: true }); return; }
                        setCustomOpen({ ...customOpen, [key]: false });
                        set({ [key]: next } as Partial<ComicAdaptSettings>);
                    }}>
                        {comicSettingOptions(locale, key).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                        <option value={CUSTOM}>{t('custom')}</option>
                    </select>
                    {/* Saved when the field is left (or on Enter), so typing does not re-render the whole app per key. */}
                    {custom && <ImeInput maxLength={500} disabled={props.disabled} autoFocus={Boolean(customOpen[key])} placeholder={t('customPlaceholder')}
                        defaultValue={preset ? '' : value}
                        onBlur={event => set({ [key]: event.currentTarget.value.trim() || 'default' } as Partial<ComicAdaptSettings>)}
                        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />}
                </label>;
            })}
        </div>
    </div>;
}

type UploadProblem = 'format' | 'size' | 'small' | 'shape';
type ExtraKey = UploadProblem | 'portraitModel' | 'settingsTitle' | 'openDesk' | 'startAdapt' | 'desk'
    | 'sequel' | 'sequelTitle' | 'sequelLead' | 'sequelPlaceholder' | 'sequelRun' | 'readaptAll' | 'readaptConfirm' | 'cancel';

/** Uploads to a role or the character library must suit the video models (the strictest common limits). */
const EXTRA: Record<string, Record<ExtraKey, string>> = {
    'zh-CN': { format: '请上传 JPG、PNG 或 WebP 图片。', size: '图片不能超过 10 MB。', small: '图片太小：短边至少 512 像素（建议 1024 以上）。', shape: '图片太窄或太宽：长宽比需在 1:2.5 到 2.5:1 之间。', portraitModel: '人物形象模型', settingsTitle: '改编设置', openDesk: '打开制作台', startAdapt: '开始改编', desk: '制作台', sequel: '写续集', sequelTitle: '续集', sequelLead: '粘贴接下来的章节。已有的 {n} 集和拍好的镜头保持不变，新内容会改编成第 {next} 集起的新剧集，集数和每集时长按上方的改编设置。', sequelPlaceholder: '粘贴后续章节…', sequelRun: '改编续集', readaptAll: '重新改编全部', readaptConfirm: '会替换全部 {n} 集和已拍的镜头，再点一次确认。', cancel: '取消' },
    'zh-TW': { format: '請上傳 JPG、PNG 或 WebP 圖片。', size: '圖片不能超過 10 MB。', small: '圖片太小：短邊至少 512 像素（建議 1024 以上）。', shape: '圖片太窄或太寬：長寬比需在 1:2.5 到 2.5:1 之間。', portraitModel: '人物形象模型', settingsTitle: '改編設定', openDesk: '開啟製作台', startAdapt: '開始改編', desk: '製作台', sequel: '寫續集', sequelTitle: '續集', sequelLead: '貼上接下來的章節。已有的 {n} 集和拍好的鏡頭保持不變，新內容會改編成第 {next} 集起的新劇集，集數和每集時長依上方的改編設定。', sequelPlaceholder: '貼上後續章節…', sequelRun: '改編續集', readaptAll: '重新改編全部', readaptConfirm: '會取代全部 {n} 集和已拍的鏡頭，再按一次確認。', cancel: '取消' },
    en: { format: 'Upload a JPG, PNG or WebP picture.', size: 'The picture must be 10 MB or smaller.', small: 'The picture is too small: the short side needs at least 512 px (1024+ recommended).', shape: 'The picture is too narrow or too wide: keep it between 1:2.5 and 2.5:1.', portraitModel: 'Portrait model', settingsTitle: 'Adaptation settings', openDesk: 'Open production desk', startAdapt: 'Adapt', desk: 'Production desk', sequel: 'Write a sequel', sequelTitle: 'Sequel', sequelLead: 'Paste the chapters that come next. The {n} existing episodes and their filmed clips stay as they are; the new text becomes new episodes from episode {next}, with the episode count and length from the adaptation settings above.', sequelPlaceholder: 'Paste the next chapters…', sequelRun: 'Adapt the sequel', readaptAll: 'Re-adapt everything', readaptConfirm: 'This replaces all {n} episodes and their filmed clips. Click again to confirm.', cancel: 'Cancel' },
    ja: { format: 'JPG・PNG・WebP の画像をアップロードしてください。', size: '画像は 10 MB 以下にしてください。', small: '画像が小さすぎます：短辺 512 px 以上（1024 以上推奨）。', shape: '画像が細長すぎます：縦横比は 1:2.5〜2.5:1 にしてください。', portraitModel: '立ち絵モデル', settingsTitle: '脚色の設定', openDesk: '制作デスクを開く', startAdapt: '脚色する', desk: '制作デスク', sequel: '続編を書く', sequelTitle: '続編', sequelLead: '続きの章を貼り付けてください。既存の {n} 話と撮影済みのクリップはそのまま残り、新しい文章は第 {next} 話からの新しい話になります。話数と 1 話の長さは上の脚色設定に従います。', sequelPlaceholder: '続きの章を貼り付け…', sequelRun: '続編を脚色', readaptAll: 'すべて脚色し直す', readaptConfirm: '{n} 話すべてと撮影済みのクリップを置き換えます。もう一度押して確定。', cancel: 'キャンセル' },
    ko: { format: 'JPG, PNG 또는 WebP 이미지를 올려 주세요.', size: '이미지는 10MB 이하여야 합니다.', small: '이미지가 너무 작습니다: 짧은 변 512px 이상(1024 이상 권장).', shape: '이미지가 너무 좁거나 넓습니다: 비율은 1:2.5~2.5:1이어야 합니다.', portraitModel: '인물 이미지 모델', settingsTitle: '각색 설정', openDesk: '제작 데스크 열기', startAdapt: '각색하기', desk: '제작 데스크', sequel: '속편 쓰기', sequelTitle: '속편', sequelLead: '이어지는 챕터를 붙여 넣으세요. 기존 {n}화와 촬영된 클립은 그대로 두고, 새 내용은 {next}화부터 새 회차로 각색합니다. 회차 수와 회차당 길이는 위의 각색 설정을 따릅니다.', sequelPlaceholder: '다음 챕터 붙여 넣기…', sequelRun: '속편 각색', readaptAll: '전체 다시 각색', readaptConfirm: '{n}화 전체와 촬영된 클립을 교체합니다. 한 번 더 눌러 확인하세요.', cancel: '취소' },
    es: { format: 'Sube una imagen JPG, PNG o WebP.', size: 'La imagen debe pesar 10 MB o menos.', small: 'La imagen es demasiado pequeña: el lado corto necesita al menos 512 px (1024+ recomendado).', shape: 'La imagen es demasiado estrecha o ancha: mantenla entre 1:2,5 y 2,5:1.', portraitModel: 'Modelo de retratos', settingsTitle: 'Ajustes de adaptación', openDesk: 'Abrir mesa de producción', startAdapt: 'Adaptar', desk: 'Mesa de producción', sequel: 'Escribir una secuela', sequelTitle: 'Secuela', sequelLead: 'Pega los capítulos siguientes. Los {n} episodios existentes y sus clips filmados no cambian; el texto nuevo se convierte en episodios nuevos desde el episodio {next}, con el número y la duración de los ajustes de adaptación de arriba.', sequelPlaceholder: 'Pega los capítulos siguientes…', sequelRun: 'Adaptar la secuela', readaptAll: 'Adaptar todo de nuevo', readaptConfirm: 'Esto reemplaza los {n} episodios y sus clips filmados. Pulsa otra vez para confirmar.', cancel: 'Cancelar' },
    fr: { format: 'Importez une image JPG, PNG ou WebP.', size: 'L’image doit faire 10 Mo au plus.', small: 'Image trop petite : le petit côté doit faire au moins 512 px (1024+ conseillé).', shape: 'Image trop étroite ou trop large : entre 1:2,5 et 2,5:1.', portraitModel: 'Modèle de portraits', settingsTitle: 'Réglages d’adaptation', openDesk: 'Ouvrir la table de production', startAdapt: 'Adapter', desk: 'Table de production', sequel: 'Écrire une suite', sequelTitle: 'Suite', sequelLead: 'Collez les chapitres suivants. Les {n} épisodes existants et leurs plans tournés restent tels quels ; le nouveau texte devient de nouveaux épisodes à partir de l’épisode {next}, avec le nombre et la durée des réglages d’adaptation ci-dessus.', sequelPlaceholder: 'Collez les chapitres suivants…', sequelRun: 'Adapter la suite', readaptAll: 'Tout réadapter', readaptConfirm: 'Cela remplace les {n} épisodes et leurs plans tournés. Cliquez à nouveau pour confirmer.', cancel: 'Annuler' },
    de: { format: 'Bitte ein JPG-, PNG- oder WebP-Bild hochladen.', size: 'Das Bild darf höchstens 10 MB groß sein.', small: 'Bild zu klein: die kurze Seite braucht mindestens 512 px (1024+ empfohlen).', shape: 'Bild zu schmal oder zu breit: zwischen 1:2,5 und 2,5:1 halten.', portraitModel: 'Porträtmodell', settingsTitle: 'Adaptionseinstellungen', openDesk: 'Produktionstisch öffnen', startAdapt: 'Adaptieren', desk: 'Produktionstisch', sequel: 'Fortsetzung schreiben', sequelTitle: 'Fortsetzung', sequelLead: 'Füge die nächsten Kapitel ein. Die {n} vorhandenen Folgen und ihre gedrehten Clips bleiben unverändert; der neue Text wird zu neuen Folgen ab Folge {next}, mit Anzahl und Länge aus den Adaptionseinstellungen oben.', sequelPlaceholder: 'Nächste Kapitel einfügen…', sequelRun: 'Fortsetzung adaptieren', readaptAll: 'Alles neu adaptieren', readaptConfirm: 'Das ersetzt alle {n} Folgen und ihre gedrehten Clips. Zum Bestätigen erneut klicken.', cancel: 'Abbrechen' },
    'pt-BR': { format: 'Envie uma imagem JPG, PNG ou WebP.', size: 'A imagem deve ter até 10 MB.', small: 'Imagem pequena demais: o lado menor precisa de pelo menos 512 px (1024+ recomendado).', shape: 'Imagem estreita ou larga demais: mantenha entre 1:2,5 e 2,5:1.', portraitModel: 'Modelo de retratos', settingsTitle: 'Ajustes de adaptação', openDesk: 'Abrir mesa de produção', startAdapt: 'Adaptar', desk: 'Mesa de produção', sequel: 'Escrever continuação', sequelTitle: 'Continuação', sequelLead: 'Cole os próximos capítulos. Os {n} episódios existentes e os clipes gravados continuam como estão; o texto novo vira novos episódios a partir do episódio {next}, com a quantidade e a duração dos ajustes de adaptação acima.', sequelPlaceholder: 'Cole os próximos capítulos…', sequelRun: 'Adaptar a continuação', readaptAll: 'Adaptar tudo de novo', readaptConfirm: 'Isso substitui os {n} episódios e os clipes gravados. Clique de novo para confirmar.', cancel: 'Cancelar' },
    ru: { format: 'Загрузите изображение JPG, PNG или WebP.', size: 'Изображение должно быть не больше 10 МБ.', small: 'Изображение слишком маленькое: короткая сторона не меньше 512 px (лучше 1024+).', shape: 'Изображение слишком узкое или широкое: соотношение от 1:2,5 до 2,5:1.', portraitModel: 'Модель портретов', settingsTitle: 'Настройки адаптации', openDesk: 'Открыть производственный стол', startAdapt: 'Адаптировать', desk: 'Производственный стол', sequel: 'Написать продолжение', sequelTitle: 'Продолжение', sequelLead: 'Вставьте следующие главы. {n} готовых серий и снятые клипы останутся без изменений; новый текст станет новыми сериями, начиная с {next}-й, с числом и длительностью серий из настроек адаптации выше.', sequelPlaceholder: 'Вставьте следующие главы…', sequelRun: 'Адаптировать продолжение', readaptAll: 'Адаптировать всё заново', readaptConfirm: 'Это заменит все {n} серий и снятые клипы. Нажмите ещё раз для подтверждения.', cancel: 'Отмена' },
    ar: { format: 'ارفع صورة JPG أو PNG أو WebP.', size: 'يجب ألا يتجاوز حجم الصورة 10 ميغابايت.', small: 'الصورة صغيرة جدًا: الضلع الأقصر 512 بكسل على الأقل (يُفضّل 1024+).', shape: 'الصورة ضيقة أو عريضة جدًا: اجعل النسبة بين 1:2.5 و2.5:1.', portraitModel: 'نموذج صور الشخصيات', settingsTitle: 'إعدادات الاقتباس', openDesk: 'فتح منضدة الإنتاج', startAdapt: 'اقتباس', desk: 'منضدة الإنتاج', sequel: 'كتابة جزء تالٍ', sequelTitle: 'الجزء التالي', sequelLead: 'الصق الفصول التالية. تبقى الحلقات الـ{n} الموجودة ولقطاتها المصوّرة كما هي، ويتحول النص الجديد إلى حلقات جديدة بدءًا من الحلقة {next}، بعدد ومدة الحلقات من إعدادات الاقتباس أعلاه.', sequelPlaceholder: 'الصق الفصول التالية…', sequelRun: 'اقتباس الجزء التالي', readaptAll: 'إعادة اقتباس الكل', readaptConfirm: 'سيستبدل هذا الحلقات الـ{n} كلها ولقطاتها المصوّرة. انقر مرة أخرى للتأكيد.', cancel: 'إلغاء' },
    hi: { format: 'JPG, PNG या WebP तस्वीर अपलोड करें।', size: 'तस्वीर 10 MB या उससे छोटी हो।', small: 'तस्वीर बहुत छोटी है: छोटी भुजा कम से कम 512 px (1024+ बेहतर)।', shape: 'तस्वीर बहुत पतली या चौड़ी है: अनुपात 1:2.5 से 2.5:1 के बीच रखें।', portraitModel: 'किरदार तस्वीर मॉडल', settingsTitle: 'रूपांतरण सेटिंग्स', openDesk: 'प्रोडक्शन डेस्क खोलें', startAdapt: 'रूपांतरण करें', desk: 'प्रोडक्शन डेस्क', sequel: 'सीक्वल लिखें', sequelTitle: 'सीक्वल', sequelLead: 'आगे के अध्याय चिपकाएँ। मौजूदा {n} एपिसोड और उनकी शूट की गई क्लिप वैसी ही रहेंगी; नया टेक्स्ट एपिसोड {next} से नए एपिसोड बनेगा, एपिसोड की संख्या और लंबाई ऊपर की रूपांतरण सेटिंग्स से।', sequelPlaceholder: 'आगे के अध्याय चिपकाएँ…', sequelRun: 'सीक्वल रूपांतरित करें', readaptAll: 'सब दोबारा रूपांतरित करें', readaptConfirm: 'इससे सभी {n} एपिसोड और उनकी शूट की गई क्लिप बदल जाएँगी। पुष्टि के लिए फिर से क्लिक करें।', cancel: 'रद्द करें' }
};

function uncheckedComicAdaptExtraText(locale: string, key: ExtraKey): string {
    return (EXTRA[locale] || EXTRA[locale.split('-')[0]] || EXTRA.en)[key] || EXTRA.en[key];
}

export function comicPortraitUploadProblem(locale: string, problem: UploadProblem): string {
    return comicAdaptExtraText(locale, problem);
}

export const COMIC_ADAPT_SETTINGS_KEY = 'nextmux.comicAdaptSettings.v1';

/** The settings the user chose last time (they carry over to the next comic). */
export function storedComicAdaptSettings(): ComicAdaptSettings {
    try {
        const raw = window.localStorage.getItem(COMIC_ADAPT_SETTINGS_KEY);
        const { clipSeconds: _ignored, ...settings } = normalizeComicAdaptSettings(raw ? JSON.parse(raw) : undefined);
        return settings;
    } catch {
        return normalizeComicAdaptSettings(undefined);
    }
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function comicFlowText(locale: Parameters<typeof uncheckedComicFlowText>[0], key: Parameters<typeof uncheckedComicFlowText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedComicFlowText>>): string {
    return totalCopy(locale, key, language => uncheckedComicFlowText(language, key, ...rest));
}
export function comicAdaptExtraText(locale: Parameters<typeof uncheckedComicAdaptExtraText>[0], key: Parameters<typeof uncheckedComicAdaptExtraText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedComicAdaptExtraText>>): string {
    return totalCopy(locale, key, language => uncheckedComicAdaptExtraText(language, key, ...rest));
}
