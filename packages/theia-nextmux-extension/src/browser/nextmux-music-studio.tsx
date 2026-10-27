import * as React from '@theia/core/shared/react';
import { MediaDiagnostic } from './nextmux-media-diagnostics';
import type { ComicMusicSettings } from '@nextmux/comic-core';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { ImeInput, ImeTextarea } from './nextmux-ime-field';
import { musicMvText } from './nextmux-music-mv-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';
import { localizeDesktopSurface } from './nextmux-surface-locale';
import { ComicProjectLocationField, previewComicProjectFolderPath } from './nextmux-comic-kinds';

/**
 * 音乐制作 — the comic workspace's fourth kind: a song from lyrics (written by hand or by AI), a sound
 * (genre, mood, tempo, voice, language) and a music model; every generation is kept as a version and
 * one is chosen as the song; then a cover picture, and the song exported as audio or as a video.
 *
 * Presentation only: the widget owns the project, the models (the AI 模型 panel) and the jobs.
 */

const LOCALES: readonly NextMuxDesktopLocale[] = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
type Labels = readonly [string, string, string, string, string, string, string, string, string, string, string, string];
const pick = (locale: NextMuxDesktopLocale, labels: Labels): string => labels[Math.max(0, LOCALES.indexOf(locale))] || labels[0];

export interface MusicPreset { readonly id: string; readonly labels: Labels; readonly prompt: string }

export const MUSIC_GENRES: readonly MusicPreset[] = [
    { id: 'pop', labels: ['Pop', '流行', '流行', 'ポップ', '팝', 'Pop', 'Pop', 'Pop', 'Pop', 'Поп', 'بوب', 'पॉप'], prompt: 'pop' },
    { id: 'ballad', labels: ['Ballad', '抒情', '抒情', 'バラード', '발라드', 'Balada', 'Ballade', 'Ballade', 'Balada', 'Баллада', 'بالاد', 'बैलेड'], prompt: 'emotional ballad' },
    { id: 'folk', labels: ['Folk', '民谣', '民謠', 'フォーク', '포크', 'Folk', 'Folk', 'Folk', 'Folk', 'Фолк', 'فولك', 'फ़ोक'], prompt: 'acoustic folk' },
    { id: 'rock', labels: ['Rock', '摇滚', '搖滾', 'ロック', '록', 'Rock', 'Rock', 'Rock', 'Rock', 'Рок', 'روك', 'रॉक'], prompt: 'rock' },
    { id: 'rnb', labels: ['R&B', 'R&B', 'R&B', 'R&B', 'R&B', 'R&B', 'R&B', 'R&B', 'R&B', 'R&B', 'آر أند بي', 'R&B'], prompt: 'R&B' },
    { id: 'hiphop', labels: ['Hip-hop', '说唱', '饒舌', 'ヒップホップ', '힙합', 'Hip-hop', 'Hip-hop', 'Hip-Hop', 'Hip-hop', 'Хип-хоп', 'هيب هوب', 'हिप-हॉप'], prompt: 'hip-hop with rap verses' },
    { id: 'electronic', labels: ['Electronic', '电子', '電子', 'エレクトロ', '일렉트로닉', 'Electrónica', 'Électro', 'Elektronisch', 'Eletrônica', 'Электроника', 'إلكترونية', 'इलेक्ट्रॉनिक'], prompt: 'electronic dance' },
    { id: 'guofeng', labels: ['Chinese traditional', '古风', '古風', '中華風', '중국 전통풍', 'Tradicional china', 'Chinois traditionnel', 'Chinesisch traditionell', 'Tradicional chinesa', 'Китайский традиционный', 'صيني تقليدي', 'चीनी पारंपरिक'], prompt: 'Chinese traditional (guofeng) with guzheng, dizi and erhu' },
    { id: 'jazz', labels: ['Jazz', '爵士', '爵士', 'ジャズ', '재즈', 'Jazz', 'Jazz', 'Jazz', 'Jazz', 'Джаз', 'جاز', 'जैज़'], prompt: 'smooth jazz' },
    { id: 'lofi', labels: ['Lo-fi', 'Lo-fi', 'Lo-fi', 'ローファイ', '로파이', 'Lo-fi', 'Lo-fi', 'Lo-fi', 'Lo-fi', 'Лоу-фай', 'لو-فاي', 'लो-फ़ाई'], prompt: 'lo-fi chill' },
    { id: 'cinematic', labels: ['Cinematic', '影视配乐', '影視配樂', '映画音楽', '영화음악', 'Cinematográfica', 'Cinématique', 'Filmmusik', 'Cinematográfica', 'Кинематографичная', 'سينمائية', 'सिनेमाई'], prompt: 'cinematic orchestral' },
    { id: 'kids', labels: ['Children’s', '儿歌', '兒歌', '童謡', '동요', 'Infantil', 'Enfantine', 'Kinderlied', 'Infantil', 'Детская', 'أغنية أطفال', 'बाल गीत'], prompt: "cheerful children's song" }
];
export const MUSIC_MOODS: readonly MusicPreset[] = [
    { id: 'happy', labels: ['Happy', '欢快', '歡快', '明るい', '신나는', 'Alegre', 'Joyeuse', 'Fröhlich', 'Alegre', 'Весёлая', 'مبهجة', 'ख़ुशनुमा'], prompt: 'happy, upbeat' },
    { id: 'healing', labels: ['Soothing', '治愈', '療癒', '癒やし', '힐링', 'Reconfortante', 'Apaisante', 'Wohltuend', 'Reconfortante', 'Успокаивающая', 'مريحة', 'सुकून भरी'], prompt: 'warm, soothing' },
    { id: 'sad', labels: ['Sad', '伤感', '傷感', '切ない', '슬픈', 'Triste', 'Triste', 'Traurig', 'Triste', 'Грустная', 'حزينة', 'उदास'], prompt: 'melancholic, bittersweet' },
    { id: 'romantic', labels: ['Romantic', '浪漫', '浪漫', 'ロマンチック', '로맨틱', 'Romántica', 'Romantique', 'Romantisch', 'Romântica', 'Романтичная', 'رومانسية', 'रोमांटिक'], prompt: 'romantic, tender' },
    { id: 'passionate', labels: ['Energetic', '热血', '熱血', '熱い', '열정적인', 'Enérgica', 'Énergique', 'Energisch', 'Energética', 'Энергичная', 'حماسية', 'जोशीली'], prompt: 'energetic, passionate' },
    { id: 'calm', labels: ['Calm', '平静', '平靜', '穏やか', '잔잔한', 'Tranquila', 'Calme', 'Ruhig', 'Calma', 'Спокойная', 'هادئة', 'शांत'], prompt: 'calm, peaceful' },
    { id: 'epic', labels: ['Epic', '史诗', '史詩', '壮大', '웅장한', 'Épica', 'Épique', 'Episch', 'Épica', 'Эпичная', 'ملحمية', 'भव्य'], prompt: 'epic, soaring' },
    { id: 'mysterious', labels: ['Mysterious', '神秘', '神秘', 'ミステリアス', '신비로운', 'Misteriosa', 'Mystérieuse', 'Geheimnisvoll', 'Misteriosa', 'Таинственная', 'غامضة', 'रहस्यमय'], prompt: 'mysterious, atmospheric' }
];
export const MUSIC_TEMPOS: readonly MusicPreset[] = [
    { id: 'slow', labels: ['Slow', '慢', '慢', 'ゆっくり', '느리게', 'Lento', 'Lent', 'Langsam', 'Lento', 'Медленно', 'بطيء', 'धीमा'], prompt: 'slow tempo (about 70 BPM)' },
    { id: 'medium', labels: ['Medium', '中', '中', '普通', '보통', 'Medio', 'Moyen', 'Mittel', 'Médio', 'Средне', 'متوسط', 'मध्यम'], prompt: 'medium tempo (about 100 BPM)' },
    { id: 'fast', labels: ['Fast', '快', '快', '速い', '빠르게', 'Rápido', 'Rapide', 'Schnell', 'Rápido', 'Быстро', 'سريع', 'तेज़'], prompt: 'fast tempo (about 128 BPM)' }
];
export const MUSIC_VOCALS: readonly MusicPreset[] = [
    { id: 'female', labels: ['Female', '女声', '女聲', '女性', '여성', 'Femenina', 'Féminine', 'Weiblich', 'Feminina', 'Женский', 'نسائي', 'महिला'], prompt: 'a female lead vocalist' },
    { id: 'male', labels: ['Male', '男声', '男聲', '男性', '남성', 'Masculina', 'Masculine', 'Männlich', 'Masculina', 'Мужской', 'رجالي', 'पुरुष'], prompt: 'a male lead vocalist' },
    { id: 'duet', labels: ['Duet', '对唱', '對唱', 'デュエット', '듀엣', 'Dueto', 'Duo', 'Duett', 'Dueto', 'Дуэт', 'ثنائي', 'युगल'], prompt: 'a male and female duet' },
    { id: 'choir', labels: ['Choir', '合唱', '合唱', '合唱', '합창', 'Coro', 'Chœur', 'Chor', 'Coral', 'Хор', 'كورال', 'कोरस'], prompt: 'a choir' }
];
export const MUSIC_LANGUAGES: readonly MusicPreset[] = [
    { id: 'zh', labels: ['Mandarin', '普通话', '普通話', '中国語', '중국어', 'Mandarín', 'Mandarin', 'Mandarin', 'Mandarim', 'Китайский', 'الماندرين', 'मंदारिन'], prompt: 'Mandarin Chinese' },
    { id: 'yue', labels: ['Cantonese', '粤语', '粵語', '広東語', '광둥어', 'Cantonés', 'Cantonais', 'Kantonesisch', 'Cantonês', 'Кантонский', 'الكانتونية', 'कैंटोनीज़'], prompt: 'Cantonese' },
    { id: 'en', labels: ['English', '英语', '英語', '英語', '영어', 'Inglés', 'Anglais', 'Englisch', 'Inglês', 'Английский', 'الإنجليزية', 'अंग्रेज़ी'], prompt: 'English' },
    { id: 'ja', labels: ['Japanese', '日语', '日語', '日本語', '일본어', 'Japonés', 'Japonais', 'Japanisch', 'Japonês', 'Японский', 'اليابانية', 'जापानी'], prompt: 'Japanese' },
    { id: 'ko', labels: ['Korean', '韩语', '韓語', '韓国語', '한국어', 'Coreano', 'Coréen', 'Koreanisch', 'Coreano', 'Корейский', 'الكورية', 'कोरियाई'], prompt: 'Korean' }
];

/** The tags a music model reads as the song's structure, in the order a song usually has them. */
export const MUSIC_SECTION_TAGS: readonly { readonly tag: string; readonly labels: Labels }[] = [
    { tag: '[Intro]', labels: ['Intro', '前奏', '前奏', 'イントロ', '인트로', 'Intro', 'Intro', 'Intro', 'Intro', 'Вступление', 'مقدمة', 'इंट्रो'] },
    { tag: '[Verse]', labels: ['Verse', '主歌', '主歌', 'A メロ', '벌스', 'Estrofa', 'Couplet', 'Strophe', 'Verso', 'Куплет', 'مقطع', 'अंतरा'] },
    { tag: '[Pre-Chorus]', labels: ['Pre-chorus', '导歌', '導歌', 'B メロ', '프리코러스', 'Pre-estribillo', 'Pré-refrain', 'Pre-Chorus', 'Pré-refrão', 'Предприпев', 'ما قبل اللازمة', 'प्री-कोरस'] },
    { tag: '[Chorus]', labels: ['Chorus', '副歌', '副歌', 'サビ', '후렴', 'Estribillo', 'Refrain', 'Refrain', 'Refrão', 'Припев', 'اللازمة', 'कोरस'] },
    { tag: '[Bridge]', labels: ['Bridge', '桥段', '橋段', 'ブリッジ', '브리지', 'Puente', 'Pont', 'Bridge', 'Ponte', 'Бридж', 'جسر', 'ब्रिज'] },
    { tag: '[Outro]', labels: ['Outro', '尾声', '尾聲', 'アウトロ', '아웃트로', 'Final', 'Outro', 'Outro', 'Final', 'Концовка', 'خاتمة', 'आउट्रो'] }
];

export const MUSIC_LYRICS_LIMIT = 3_500;

export function defaultMusicSettings(patch: Partial<ComicMusicSettings> = {}): ComicMusicSettings {
    return { lyrics: '', instrumental: false, genre: '', mood: '', tempo: '', vocals: '', language: '', style: '', length: 'full', format: 'mp3', ...patch };
}

const phrase = (presets: readonly MusicPreset[], value: string): string => presets.find(preset => preset.id === value)?.prompt || value.trim();

/** How the song should sound, in the words music models follow best (English, concrete). */
export function musicSongPrompt(settings: ComicMusicSettings, _title = ''): string {
    const genre = phrase(MUSIC_GENRES, settings.genre);
    const mood = phrase(MUSIC_MOODS, settings.mood);
    const tempo = phrase(MUSIC_TEMPOS, settings.tempo);
    const vocals = settings.vocalSource === 'my_voice' && settings.mode !== 'cover' ? '' : phrase(MUSIC_VOCALS, settings.vocals);
    const language = phrase(MUSIC_LANGUAGES, settings.language);
    const piece = settings.instrumental ? 'instrumental piece' : 'song';
    return [
        `${settings.length === 'clip' ? 'A 30-second' : 'A full-length'} ${genre ? `${genre} ` : ''}${piece}${mood ? ` with a ${mood} mood` : ''}${tempo ? `, ${tempo}` : ''}.`,
        !settings.instrumental && (vocals || language) ? `Sung by ${vocals || 'a lead vocalist'}${language ? ` in ${language}` : ''}.` : '',
        !settings.instrumental && settings.vocalSource === 'my_voice' && settings.mode !== 'cover' ? 'Use the supplied vocal reference as the singing voice.' : '',
        settings.mode === 'cover' ? 'Restyle the supplied reference song with the requested arrangement.' : '',
        settings.style.trim(),
        settings.length === 'clip' ? '' : settings.instrumental ? 'Clear structure with an intro, development and an ending.' : 'Clear song structure with verses and a memorable chorus.'
    ].filter(Boolean).join(' ').slice(0, 2_000);
}

/** The cover picture: the song's mood as an album cover, no text (models misspell it), in the video's frame. */
export function musicCoverPrompt(settings: ComicMusicSettings, title: string, aspectRatio: string): string {
    const genre = phrase(MUSIC_GENRES, settings.genre);
    const mood = phrase(MUSIC_MOODS, settings.mood);
    const lines = settings.lyrics.split(/\r?\n/).map(line => line.trim()).filter(line => line && !/^\[.*\]$/.test(line)).slice(0, 8).join(' / ');
    return [
        `Album cover artwork${title.trim() ? ` for a song called “${title.trim()}”` : ''}${genre ? `, ${genre}` : ''}${mood ? `, ${mood} mood` : ''}.`,
        lines ? `The song is about: ${lines.slice(0, 600)}` : '',
        settings.style.trim() ? `Musical feel: ${settings.style.trim().slice(0, 300)}.` : '',
        `One striking, atmospheric image with a clear focal point, cinematic lighting, rich color; ${aspectRatio} frame.`,
        'No text, letters, logos or watermarks anywhere in the image.'
    ].filter(Boolean).join(' ').slice(0, 2_000);
}

/** The brief for AI 写词: lyrics in the song's language and sound, tagged by section, saved with comic.write_lyrics. */
export function musicLyricsInstructions(options: { readonly theme: string; readonly settings: ComicMusicSettings; readonly title: string; readonly appLanguage: string; readonly current?: string }): string {
    const language = phrase(MUSIC_LANGUAGES, options.settings.language) || options.appLanguage;
    const sound = [phrase(MUSIC_GENRES, options.settings.genre), phrase(MUSIC_MOODS, options.settings.mood), phrase(MUSIC_TEMPOS, options.settings.tempo)].filter(Boolean).join(', ');
    const clip = options.settings.length === 'clip';
    return [
        'You are a professional lyricist. Write original song lyrics that a music model will sing.',
        `Language: ${language}. Every line in ${language}, natural and singable; rhyme where the language allows.`,
        sound ? `The song: ${sound}${options.settings.style.trim() ? `; ${options.settings.style.trim()}` : ''}.` : '',
        options.title.trim() ? `Working title: “${options.title.trim()}”.` : '',
        `What it is about:\n<theme>\n${options.theme.trim()}\n</theme>`,
        options.current?.trim() ? `The current lyrics, to improve rather than start over when they fit the theme:\n<lyrics>\n${options.current.trim().slice(0, 3_000)}\n</lyrics>` : '',
        clip
            ? 'Length: a 30-second song — one [Verse] of 4 lines and one [Chorus] of 4 lines.'
            : 'Length: a full song — [Verse], [Pre-Chorus] (optional), [Chorus], a second [Verse], [Chorus], [Bridge], final [Chorus]; about 24–36 lines in all.',
        'Put each section tag on its own line in English exactly as written ([Intro], [Verse], [Pre-Chorus], [Chorus], [Bridge], [Outro]); the lyric lines follow it. No chords, no stage directions, no line numbers.',
        'Never copy or closely paraphrase existing songs, and never name real singers or bands.',
        'When you are done, call the comic.write_lyrics tool exactly once: { title, lyrics, style } (style: one short line of instruments or arrangement that suits the lyrics). Then reply with one short sentence.'
    ].filter(Boolean).join('\n\n');
}

type Key = 'kind' | 'createTitle' | 'createLead' | 'name' | 'namePlaceholder' | 'start' | 'startWrite' | 'startWriteLead' | 'startAi' | 'startAiLead' | 'startInstrumental' | 'startInstrumentalLead'
    | 'theme' | 'themePlaceholder' | 'aspect' | 'create' | 'creating' | 'cancel' | 'needTheme'
    | 'lyrics' | 'lyricsPlaceholder' | 'save' | 'saved' | 'unsaved' | 'count' | 'insert'
    | 'aiTitle' | 'aiLead' | 'aiRun' | 'aiRewrite' | 'aiRunning' | 'stop'
    | 'sound' | 'genre' | 'mood' | 'tempo' | 'vocals' | 'language' | 'length' | 'lengthFull' | 'lengthClip' | 'instrumental' | 'instrumentalLead' | 'style' | 'stylePlaceholder' | 'auto'
    | 'songTitle' | 'songLead' | 'generate' | 'generateAgain' | 'generating' | 'versions' | 'noVersions' | 'chosen' | 'choose' | 'failed' | 'retry' | 'price' | 'priceOwn' | 'needLyrics' | 'rights'
    | 'outputTitle' | 'cover' | 'coverLead' | 'coverGenerate' | 'coverAgain' | 'coverImport' | 'coverEmpty' | 'coverDrawing'
    | 'audio' | 'audioLead' | 'audioButton' | 'video' | 'videoLead' | 'videoButton' | 'needSong' | 'needCover' | 'next';

const copy: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<Key, string>>>> = {
    'zh-CN': { kind: '音乐制作', createTitle: '新建歌曲', createLead: '先定歌名和从哪开始，之后都能改。', name: '歌名', namePlaceholder: '输入歌名', start: '从哪开始',
        startWrite: '自己写歌词', startWriteLead: '在编辑器里写，段落用标签分开', startAi: 'AI 写歌词', startAiLead: '说一句想写什么，AI 写成完整歌词', startInstrumental: '纯音乐', startInstrumentalLead: '不唱词，只要旋律和编曲',
        theme: '想写什么', themePlaceholder: '描述这首歌想写什么', aspect: '封面与视频比例', create: '创建', creating: '创建中…', cancel: '取消', needTheme: '请写一句想写的内容。',
        lyrics: '歌词', lyricsPlaceholder: '[Verse]\n第一段主歌……\n\n[Chorus]\n副歌……', save: '保存', saved: '已保存', unsaved: '有未保存修改', count: '{n}/{max} 字', insert: '插入段落',
        aiTitle: 'AI 写词', aiLead: '写一句主题，AI 按下面的曲风和情绪写成带段落的歌词。已有歌词会在此基础上改写。', aiRun: 'AI 写歌词', aiRewrite: 'AI 重写', aiRunning: 'AI 正在写词…', stop: '停止',
        sound: '曲风与人声', genre: '曲风', mood: '情绪', tempo: '速度', vocals: '人声', language: '演唱语言', length: '长度', lengthFull: '完整歌曲', lengthClip: '30 秒片段',
        instrumental: '纯音乐', instrumentalLead: '不唱歌词，只生成旋律和编曲', style: '补充描述', stylePlaceholder: '乐器、年代或参考风格', auto: '由模型决定',
        songTitle: '生成歌曲', songLead: '用歌词和曲风生成。每次生成都保存为一个版本，选一个作为这首歌。', generate: '生成歌曲', generateAgain: '再生成一版', generating: '正在生成，完整歌曲约需 1–2 分钟…',
        versions: '版本', noVersions: '还没有生成过版本', chosen: '当前选用', choose: '选用', failed: '生成失败：{error}', retry: '重试', price: '约 {price}', priceOwn: '由你的 API 按其价格计费',
        needLyrics: '先写歌词，或打开“纯音乐”', rights: '请勿模仿真实歌手、使用他人歌词；商用请以所选模型提供方的条款为准。',
        outputTitle: '导出', cover: '封面', coverLead: '视频的画面，也可以作为音乐平台的封面。', coverGenerate: 'AI 生成封面', coverAgain: '重新生成', coverImport: '导入图片', coverEmpty: '还没有封面', coverDrawing: '正在生成封面…',
        audio: '导出音频', audioLead: '导出当前选用的版本（{format}）。', audioButton: '导出音频文件', video: '导出视频', videoLead: '封面画面配上歌曲，按 {ratio} 导出 MP4。', videoButton: '导出视频',
        needSong: '先生成并选用一个版本', needCover: '先生成或导入封面', next: '下一步' },
    'zh-TW': { kind: '音樂製作', createTitle: '新增歌曲', createLead: '先定歌名和從哪開始，之後都能改。', name: '歌名', namePlaceholder: '輸入歌名', start: '從哪開始',
        startWrite: '自己寫歌詞', startWriteLead: '在編輯器裡寫，段落用標籤分開', startAi: 'AI 寫歌詞', startAiLead: '說一句想寫什麼，AI 寫成完整歌詞', startInstrumental: '純音樂', startInstrumentalLead: '不唱詞，只要旋律和編曲',
        theme: '想寫什麼', themePlaceholder: '描述這首歌想寫什麼', aspect: '封面與影片比例', create: '建立', creating: '建立中…', cancel: '取消', needTheme: '請寫一句想寫的內容。',
        lyrics: '歌詞', lyricsPlaceholder: '[Verse]\n第一段主歌……\n\n[Chorus]\n副歌……', save: '儲存', saved: '已儲存', unsaved: '有未儲存的修改', count: '{n}/{max} 字', insert: '插入段落',
        aiTitle: 'AI 寫詞', aiLead: '寫一句主題，AI 依下方的曲風和情緒寫成帶段落的歌詞。已有歌詞會在此基礎上改寫。', aiRun: 'AI 寫歌詞', aiRewrite: 'AI 重寫', aiRunning: 'AI 正在寫詞…', stop: '停止',
        sound: '曲風與人聲', genre: '曲風', mood: '情緒', tempo: '速度', vocals: '人聲', language: '演唱語言', length: '長度', lengthFull: '完整歌曲', lengthClip: '30 秒片段',
        instrumental: '純音樂', instrumentalLead: '不唱歌詞，只生成旋律和編曲', style: '補充描述', stylePlaceholder: '樂器、年代或參考風格', auto: '由模型決定',
        songTitle: '生成歌曲', songLead: '用歌詞和曲風生成。每次生成都儲存為一個版本，選一個作為這首歌。', generate: '生成歌曲', generateAgain: '再生成一版', generating: '正在生成，完整歌曲約需 1–2 分鐘…',
        versions: '版本', noVersions: '還沒有生成過版本', chosen: '目前選用', choose: '選用', failed: '生成失敗：{error}', retry: '重試', price: '約 {price}', priceOwn: '由你的 API 依其價格計費',
        needLyrics: '先寫歌詞，或開啟「純音樂」', rights: '請勿模仿真實歌手、使用他人歌詞；商用請以所選模型提供方的條款為準。',
        outputTitle: '匯出', cover: '封面', coverLead: '影片的畫面，也可作為音樂平台的封面。', coverGenerate: 'AI 生成封面', coverAgain: '重新生成', coverImport: '匯入圖片', coverEmpty: '還沒有封面', coverDrawing: '正在生成封面…',
        audio: '匯出音訊', audioLead: '匯出目前選用的版本（{format}）。', audioButton: '匯出音訊檔', video: '匯出影片', videoLead: '封面畫面配上歌曲，依 {ratio} 匯出 MP4。', videoButton: '匯出影片',
        needSong: '先生成並選用一個版本', needCover: '先生成或匯入封面', next: '下一步' },
    en: { kind: 'Music', createTitle: 'New song', createLead: 'Pick a title and where to start; you can change everything later.', name: 'Title', namePlaceholder: 'Song title', start: 'Start with',
        startWrite: 'My own lyrics', startWriteLead: 'Write in the editor, sections marked with tags', startAi: 'AI lyrics', startAiLead: 'Say what it is about; AI writes the full lyrics', startInstrumental: 'Instrumental', startInstrumentalLead: 'No singing, just melody and arrangement',
        theme: 'What it is about', themePlaceholder: 'What the song is about', aspect: 'Cover and video shape', create: 'Create', creating: 'Creating…', cancel: 'Cancel', needTheme: 'Write a line about what the song is about.',
        lyrics: 'Lyrics', lyricsPlaceholder: '[Verse]\nFirst verse…\n\n[Chorus]\nChorus…', save: 'Save', saved: 'Saved', unsaved: 'Unsaved changes', count: '{n}/{max} characters', insert: 'Insert section',
        aiTitle: 'AI lyrics', aiLead: 'Write one line about the song; AI writes sectioned lyrics in the sound below. Existing lyrics are reworked rather than replaced.', aiRun: 'Write lyrics', aiRewrite: 'Rewrite', aiRunning: 'Writing lyrics…', stop: 'Stop',
        sound: 'Sound and voice', genre: 'Genre', mood: 'Mood', tempo: 'Tempo', vocals: 'Voice', language: 'Sung in', length: 'Length', lengthFull: 'Full song', lengthClip: '30-second clip',
        instrumental: 'Instrumental', instrumentalLead: 'The lyrics are not sung; melody and arrangement only', style: 'More about the sound', stylePlaceholder: 'Instruments, era or references', auto: 'Model decides',
        songTitle: 'Make the song', songLead: 'Made from the lyrics and the sound. Every take is kept as a version; choose one as the song.', generate: 'Make song', generateAgain: 'Another take', generating: 'Making the song — a full song takes about 1–2 minutes…',
        versions: 'Versions', noVersions: 'No versions yet', chosen: 'Chosen', choose: 'Choose', failed: 'Failed: {error}', retry: 'Retry', price: 'about {price}', priceOwn: 'Billed by your API at its own price',
        needLyrics: 'Write lyrics first, or turn on Instrumental', rights: 'Don’t imitate real singers or use other people’s lyrics; for commercial use follow the chosen model provider’s terms.',
        outputTitle: 'Export', cover: 'Cover', coverLead: 'The video’s picture, and a cover for music platforms.', coverGenerate: 'AI cover', coverAgain: 'Make again', coverImport: 'Import picture', coverEmpty: 'No cover yet', coverDrawing: 'Making the cover…',
        audio: 'Export audio', audioLead: 'Exports the chosen version ({format}).', audioButton: 'Export audio file', video: 'Export video', videoLead: 'The cover with the song, exported as a {ratio} MP4.', videoButton: 'Export video',
        needSong: 'Make and choose a version first', needCover: 'Make or import a cover first', next: 'Next' },
    ja: { kind: '音楽制作', createTitle: '新しい曲', createLead: '曲名と始め方を決めましょう。あとから変更できます。', name: '曲名', namePlaceholder: '曲名を入力', start: '始め方',
        startWrite: '自分で作詞', startWriteLead: 'エディターで書き、セクションはタグで区切ります', startAi: 'AI で作詞', startAiLead: 'テーマを一言伝えると AI が歌詞全体を書きます', startInstrumental: 'インスト', startInstrumentalLead: '歌なし、メロディーとアレンジのみ',
        theme: 'テーマ', themePlaceholder: '曲のテーマを入力', aspect: 'カバーと動画の比率', create: '作成', creating: '作成中…', cancel: 'キャンセル', needTheme: '曲のテーマを一言書いてください。',
        lyrics: '歌詞', lyricsPlaceholder: '[Verse]\nA メロ……\n\n[Chorus]\nサビ……', save: '保存', saved: '保存しました', unsaved: '未保存の変更があります', count: '{n}/{max} 文字', insert: 'セクションを挿入',
        aiTitle: 'AI 作詞', aiLead: 'テーマを一言書くと、下の曲調と雰囲気でセクション付きの歌詞を書きます。既存の歌詞は書き直しの土台になります。', aiRun: 'AI で作詞', aiRewrite: '書き直す', aiRunning: '作詞中…', stop: '停止',
        sound: '曲調と歌声', genre: 'ジャンル', mood: '雰囲気', tempo: 'テンポ', vocals: '歌声', language: '歌う言語', length: '長さ', lengthFull: 'フルコーラス', lengthClip: '30 秒',
        instrumental: 'インスト', instrumentalLead: '歌詞は歌わず、メロディーとアレンジだけを作ります', style: '補足', stylePlaceholder: '楽器・年代・参考スタイル', auto: 'モデルに任せる',
        songTitle: '曲を生成', songLead: '歌詞と曲調から生成します。生成ごとにバージョンとして残り、1 つを曲として選びます。', generate: '曲を生成', generateAgain: 'もう 1 バージョン', generating: '生成中です。フルコーラスは 1〜2 分ほどかかります…',
        versions: 'バージョン', noVersions: 'まだバージョンがありません', chosen: '選択中', choose: '選ぶ', failed: '失敗：{error}', retry: '再試行', price: '約 {price}', priceOwn: 'あなたの API の料金で課金されます',
        needLyrics: '先に歌詞を書くか、「インスト」をオンにしてください', rights: '実在の歌手の模倣や他人の歌詞の使用はしないでください。商用利用は選んだモデル提供元の規約に従ってください。',
        outputTitle: '書き出し', cover: 'カバー', coverLead: '動画の映像と、音楽配信用のカバーになります。', coverGenerate: 'AI でカバー作成', coverAgain: '作り直す', coverImport: '画像を読み込む', coverEmpty: 'カバーがまだありません', coverDrawing: 'カバーを作成中…',
        audio: '音声を書き出す', audioLead: '選択中のバージョンを書き出します（{format}）。', audioButton: '音声ファイルを書き出す', video: '動画を書き出す', videoLead: 'カバーと曲を {ratio} の MP4 で書き出します。', videoButton: '動画を書き出す',
        needSong: '先にバージョンを生成して選んでください', needCover: '先にカバーを作成または読み込んでください', next: '次へ' },
    ko: { kind: '음악 제작', createTitle: '새 노래', createLead: '제목과 시작 방법을 정하세요. 나중에 모두 바꿀 수 있습니다.', name: '제목', namePlaceholder: '곡 제목 입력', start: '시작 방법',
        startWrite: '직접 작사', startWriteLead: '편집기에서 쓰고, 구간은 태그로 나눕니다', startAi: 'AI 작사', startAiLead: '주제를 한 줄 쓰면 AI가 전체 가사를 씁니다', startInstrumental: '연주곡', startInstrumentalLead: '노래 없이 멜로디와 편곡만',
        theme: '주제', themePlaceholder: '노래의 주제를 입력', aspect: '커버와 영상 비율', create: '만들기', creating: '만드는 중…', cancel: '취소', needTheme: '노래의 주제를 한 줄 써 주세요.',
        lyrics: '가사', lyricsPlaceholder: '[Verse]\n1절……\n\n[Chorus]\n후렴……', save: '저장', saved: '저장됨', unsaved: '저장하지 않은 변경 사항', count: '{n}/{max}자', insert: '구간 넣기',
        aiTitle: 'AI 작사', aiLead: '주제를 한 줄 쓰면 아래 장르와 분위기로 구간이 나뉜 가사를 씁니다. 기존 가사는 바탕으로 다시 씁니다.', aiRun: 'AI 작사', aiRewrite: '다시 쓰기', aiRunning: '작사 중…', stop: '중지',
        sound: '장르와 보컬', genre: '장르', mood: '분위기', tempo: '템포', vocals: '보컬', language: '부를 언어', length: '길이', lengthFull: '전체 곡', lengthClip: '30초',
        instrumental: '연주곡', instrumentalLead: '가사는 부르지 않고 멜로디와 편곡만 만듭니다', style: '추가 설명', stylePlaceholder: '악기, 시대, 참고 스타일', auto: '모델이 결정',
        songTitle: '노래 만들기', songLead: '가사와 장르로 만듭니다. 만들 때마다 버전으로 남고, 하나를 노래로 고릅니다.', generate: '노래 만들기', generateAgain: '한 버전 더', generating: '만드는 중입니다. 전체 곡은 1~2분 정도 걸립니다…',
        versions: '버전', noVersions: '아직 버전이 없습니다', chosen: '선택됨', choose: '선택', failed: '실패: {error}', retry: '다시 시도', price: '약 {price}', priceOwn: '내 API 요금으로 청구됩니다',
        needLyrics: '먼저 가사를 쓰거나 「연주곡」을 켜세요', rights: '실제 가수를 흉내 내거나 다른 사람의 가사를 쓰지 마세요. 상업적 이용은 선택한 모델 제공사의 약관을 따르세요.',
        outputTitle: '내보내기', cover: '커버', coverLead: '영상의 화면이자 음원 사이트용 커버입니다.', coverGenerate: 'AI 커버 만들기', coverAgain: '다시 만들기', coverImport: '이미지 가져오기', coverEmpty: '아직 커버가 없습니다', coverDrawing: '커버를 만드는 중…',
        audio: '오디오 내보내기', audioLead: '선택한 버전을 내보냅니다({format}).', audioButton: '오디오 파일 내보내기', video: '영상 내보내기', videoLead: '커버와 노래를 {ratio} MP4로 내보냅니다.', videoButton: '영상 내보내기',
        needSong: '먼저 버전을 만들고 선택하세요', needCover: '먼저 커버를 만들거나 가져오세요', next: '다음' },
    es: { kind: 'Música', createTitle: 'Nueva canción', createLead: 'Elige un título y cómo empezar; luego puedes cambiarlo todo.', name: 'Título', namePlaceholder: 'Título de la canción', start: 'Empezar con',
        startWrite: 'Mi propia letra', startWriteLead: 'Escribe en el editor, con etiquetas para las secciones', startAi: 'Letra con IA', startAiLead: 'Di de qué trata; la IA escribe la letra completa', startInstrumental: 'Instrumental', startInstrumentalLead: 'Sin canto, solo melodía y arreglo',
        theme: 'De qué trata', themePlaceholder: 'De qué trata la canción', aspect: 'Formato de portada y vídeo', create: 'Crear', creating: 'Creando…', cancel: 'Cancelar', needTheme: 'Escribe una línea sobre la canción.',
        lyrics: 'Letra', lyricsPlaceholder: '[Verse]\nPrimera estrofa…\n\n[Chorus]\nEstribillo…', save: 'Guardar', saved: 'Guardado', unsaved: 'Cambios sin guardar', count: '{n}/{max} caracteres', insert: 'Insertar sección',
        aiTitle: 'Letra con IA', aiLead: 'Escribe una línea sobre la canción; la IA escribe una letra por secciones con el sonido de abajo. La letra actual se reescribe, no se descarta.', aiRun: 'Escribir letra', aiRewrite: 'Reescribir', aiRunning: 'Escribiendo la letra…', stop: 'Detener',
        sound: 'Sonido y voz', genre: 'Género', mood: 'Ánimo', tempo: 'Tempo', vocals: 'Voz', language: 'Idioma', length: 'Duración', lengthFull: 'Canción completa', lengthClip: 'Fragmento de 30 s',
        instrumental: 'Instrumental', instrumentalLead: 'La letra no se canta; solo melodía y arreglo', style: 'Más sobre el sonido', stylePlaceholder: 'Instrumentos, época o referencias', auto: 'Lo decide el modelo',
        songTitle: 'Crear la canción', songLead: 'Se crea con la letra y el sonido. Cada toma se guarda como versión; elige una como la canción.', generate: 'Crear canción', generateAgain: 'Otra toma', generating: 'Creando la canción; una completa tarda 1–2 minutos…',
        versions: 'Versiones', noVersions: 'Aún no hay versiones', chosen: 'Elegida', choose: 'Elegir', failed: 'Error: {error}', retry: 'Reintentar', price: 'aprox. {price}', priceOwn: 'Lo cobra tu API a su precio',
        needLyrics: 'Escribe la letra primero o activa Instrumental', rights: 'No imites a cantantes reales ni uses letras ajenas; para uso comercial sigue los términos del proveedor del modelo.',
        outputTitle: 'Exportar', cover: 'Portada', coverLead: 'La imagen del vídeo y la portada para plataformas de música.', coverGenerate: 'Portada con IA', coverAgain: 'Rehacer', coverImport: 'Importar imagen', coverEmpty: 'Aún no hay portada', coverDrawing: 'Creando la portada…',
        audio: 'Exportar audio', audioLead: 'Exporta la versión elegida ({format}).', audioButton: 'Exportar archivo de audio', video: 'Exportar vídeo', videoLead: 'La portada con la canción, en MP4 {ratio}.', videoButton: 'Exportar vídeo',
        needSong: 'Primero crea y elige una versión', needCover: 'Primero crea o importa una portada', next: 'Siguiente' },
    fr: { kind: 'Musique', createTitle: 'Nouvelle chanson', createLead: 'Choisissez un titre et un point de départ ; tout reste modifiable.', name: 'Titre', namePlaceholder: 'Titre de la chanson', start: 'Commencer par',
        startWrite: 'Mes propres paroles', startWriteLead: 'Écrivez dans l’éditeur, sections marquées par des balises', startAi: 'Paroles par IA', startAiLead: 'Dites de quoi elle parle ; l’IA écrit toutes les paroles', startInstrumental: 'Instrumental', startInstrumentalLead: 'Sans chant, mélodie et arrangement seulement',
        theme: 'Le sujet', themePlaceholder: 'Le sujet de la chanson', aspect: 'Format de la pochette et de la vidéo', create: 'Créer', creating: 'Création…', cancel: 'Annuler', needTheme: 'Écrivez une ligne sur le sujet.',
        lyrics: 'Paroles', lyricsPlaceholder: '[Verse]\nPremier couplet…\n\n[Chorus]\nRefrain…', save: 'Enregistrer', saved: 'Enregistré', unsaved: 'Modifications non enregistrées', count: '{n}/{max} caractères', insert: 'Insérer une section',
        aiTitle: 'Paroles par IA', aiLead: 'Écrivez une ligne sur la chanson ; l’IA écrit des paroles par sections dans le style ci-dessous. Les paroles actuelles sont retravaillées, pas jetées.', aiRun: 'Écrire les paroles', aiRewrite: 'Réécrire', aiRunning: 'Écriture des paroles…', stop: 'Arrêter',
        sound: 'Son et voix', genre: 'Genre', mood: 'Ambiance', tempo: 'Tempo', vocals: 'Voix', language: 'Langue chantée', length: 'Durée', lengthFull: 'Chanson complète', lengthClip: 'Extrait de 30 s',
        instrumental: 'Instrumental', instrumentalLead: 'Les paroles ne sont pas chantées ; mélodie et arrangement seulement', style: 'Précisions sur le son', stylePlaceholder: 'Instruments, époque ou références', auto: 'Au choix du modèle',
        songTitle: 'Créer la chanson', songLead: 'Créée à partir des paroles et du son. Chaque prise est gardée comme version ; choisissez-en une.', generate: 'Créer la chanson', generateAgain: 'Une autre prise', generating: 'Création en cours — une chanson complète prend 1 à 2 minutes…',
        versions: 'Versions', noVersions: 'Aucune version pour l’instant', chosen: 'Choisie', choose: 'Choisir', failed: 'Échec : {error}', retry: 'Réessayer', price: 'env. {price}', priceOwn: 'Facturé par votre API à son tarif',
        needLyrics: 'Écrivez d’abord les paroles ou activez Instrumental', rights: 'N’imitez pas de vrais chanteurs et n’utilisez pas les paroles d’autrui ; pour un usage commercial, suivez les conditions du fournisseur du modèle.',
        outputTitle: 'Exporter', cover: 'Pochette', coverLead: 'L’image de la vidéo et une pochette pour les plateformes musicales.', coverGenerate: 'Pochette par IA', coverAgain: 'Refaire', coverImport: 'Importer une image', coverEmpty: 'Pas encore de pochette', coverDrawing: 'Création de la pochette…',
        audio: 'Exporter l’audio', audioLead: 'Exporte la version choisie ({format}).', audioButton: 'Exporter le fichier audio', video: 'Exporter la vidéo', videoLead: 'La pochette avec la chanson, en MP4 {ratio}.', videoButton: 'Exporter la vidéo',
        needSong: 'Créez et choisissez d’abord une version', needCover: 'Créez ou importez d’abord une pochette', next: 'Suivant' },
    de: { kind: 'Musik', createTitle: 'Neuer Song', createLead: 'Titel und Startpunkt wählen – alles bleibt änderbar.', name: 'Titel', namePlaceholder: 'Songtitel', start: 'Beginnen mit',
        startWrite: 'Eigener Text', startWriteLead: 'Im Editor schreiben, Abschnitte mit Tags markieren', startAi: 'KI-Songtext', startAiLead: 'Worum es geht – die KI schreibt den ganzen Text', startInstrumental: 'Instrumental', startInstrumentalLead: 'Kein Gesang, nur Melodie und Arrangement',
        theme: 'Worum es geht', themePlaceholder: 'Worum es im Song geht', aspect: 'Format von Cover und Video', create: 'Erstellen', creating: 'Wird erstellt…', cancel: 'Abbrechen', needTheme: 'Schreiben Sie eine Zeile zum Thema.',
        lyrics: 'Songtext', lyricsPlaceholder: '[Verse]\nErste Strophe…\n\n[Chorus]\nRefrain…', save: 'Speichern', saved: 'Gespeichert', unsaved: 'Ungespeicherte Änderungen', count: '{n}/{max} Zeichen', insert: 'Abschnitt einfügen',
        aiTitle: 'KI-Songtext', aiLead: 'Eine Zeile zum Song – die KI schreibt einen gegliederten Text im Klang unten. Vorhandener Text wird überarbeitet, nicht verworfen.', aiRun: 'Text schreiben', aiRewrite: 'Neu schreiben', aiRunning: 'Text wird geschrieben…', stop: 'Stoppen',
        sound: 'Klang und Stimme', genre: 'Genre', mood: 'Stimmung', tempo: 'Tempo', vocals: 'Stimme', language: 'Gesungen auf', length: 'Länge', lengthFull: 'Ganzer Song', lengthClip: '30-Sekunden-Clip',
        instrumental: 'Instrumental', instrumentalLead: 'Der Text wird nicht gesungen; nur Melodie und Arrangement', style: 'Mehr zum Klang', stylePlaceholder: 'Instrumente, Ära oder Vorbilder', auto: 'Modell entscheidet',
        songTitle: 'Song erstellen', songLead: 'Aus Text und Klang erstellt. Jede Aufnahme bleibt als Version; wählen Sie eine als Song.', generate: 'Song erstellen', generateAgain: 'Weitere Aufnahme', generating: 'Song wird erstellt – ein ganzer Song dauert etwa 1–2 Minuten…',
        versions: 'Versionen', noVersions: 'Noch keine Versionen', chosen: 'Gewählt', choose: 'Wählen', failed: 'Fehlgeschlagen: {error}', retry: 'Erneut versuchen', price: 'ca. {price}', priceOwn: 'Ihre API berechnet ihren eigenen Preis',
        needLyrics: 'Erst den Text schreiben oder Instrumental einschalten', rights: 'Keine echten Sänger nachahmen und keine fremden Texte verwenden; für kommerzielle Nutzung gelten die Bedingungen des Modellanbieters.',
        outputTitle: 'Export', cover: 'Cover', coverLead: 'Das Bild des Videos und ein Cover für Musikplattformen.', coverGenerate: 'KI-Cover', coverAgain: 'Neu erstellen', coverImport: 'Bild importieren', coverEmpty: 'Noch kein Cover', coverDrawing: 'Cover wird erstellt…',
        audio: 'Audio exportieren', audioLead: 'Exportiert die gewählte Version ({format}).', audioButton: 'Audiodatei exportieren', video: 'Video exportieren', videoLead: 'Das Cover mit dem Song als MP4 im Format {ratio}.', videoButton: 'Video exportieren',
        needSong: 'Erst eine Version erstellen und wählen', needCover: 'Erst ein Cover erstellen oder importieren', next: 'Weiter' },
    'pt-BR': { kind: 'Música', createTitle: 'Nova música', createLead: 'Escolha um título e por onde começar; tudo pode ser mudado depois.', name: 'Título', namePlaceholder: 'Título da música', start: 'Começar com',
        startWrite: 'Minha própria letra', startWriteLead: 'Escreva no editor, com tags marcando as seções', startAi: 'Letra com IA', startAiLead: 'Diga sobre o que é; a IA escreve a letra toda', startInstrumental: 'Instrumental', startInstrumentalLead: 'Sem canto, só melodia e arranjo',
        theme: 'Sobre o que é', themePlaceholder: 'Sobre o que é a música', aspect: 'Formato da capa e do vídeo', create: 'Criar', creating: 'Criando…', cancel: 'Cancelar', needTheme: 'Escreva uma linha sobre a música.',
        lyrics: 'Letra', lyricsPlaceholder: '[Verse]\nPrimeiro verso…\n\n[Chorus]\nRefrão…', save: 'Salvar', saved: 'Salvo', unsaved: 'Alterações não salvas', count: '{n}/{max} caracteres', insert: 'Inserir seção',
        aiTitle: 'Letra com IA', aiLead: 'Escreva uma linha sobre a música; a IA escreve uma letra por seções no som abaixo. A letra atual é reescrita, não descartada.', aiRun: 'Escrever letra', aiRewrite: 'Reescrever', aiRunning: 'Escrevendo a letra…', stop: 'Parar',
        sound: 'Som e voz', genre: 'Gênero', mood: 'Clima', tempo: 'Andamento', vocals: 'Voz', language: 'Idioma cantado', length: 'Duração', lengthFull: 'Música completa', lengthClip: 'Trecho de 30 s',
        instrumental: 'Instrumental', instrumentalLead: 'A letra não é cantada; só melodia e arranjo', style: 'Mais sobre o som', stylePlaceholder: 'Instrumentos, época ou referências', auto: 'O modelo decide',
        songTitle: 'Criar a música', songLead: 'Criada a partir da letra e do som. Cada tomada fica como versão; escolha uma como a música.', generate: 'Criar música', generateAgain: 'Outra tomada', generating: 'Criando a música — uma completa leva cerca de 1–2 minutos…',
        versions: 'Versões', noVersions: 'Ainda não há versões', chosen: 'Escolhida', choose: 'Escolher', failed: 'Falhou: {error}', retry: 'Tentar de novo', price: 'cerca de {price}', priceOwn: 'Cobrado pela sua API ao preço dela',
        needLyrics: 'Escreva a letra antes ou ative Instrumental', rights: 'Não imite cantores reais nem use letras de outras pessoas; para uso comercial siga os termos do fornecedor do modelo.',
        outputTitle: 'Exportar', cover: 'Capa', coverLead: 'A imagem do vídeo e a capa para plataformas de música.', coverGenerate: 'Capa com IA', coverAgain: 'Refazer', coverImport: 'Importar imagem', coverEmpty: 'Ainda sem capa', coverDrawing: 'Criando a capa…',
        audio: 'Exportar áudio', audioLead: 'Exporta a versão escolhida ({format}).', audioButton: 'Exportar arquivo de áudio', video: 'Exportar vídeo', videoLead: 'A capa com a música, em MP4 {ratio}.', videoButton: 'Exportar vídeo',
        needSong: 'Crie e escolha uma versão primeiro', needCover: 'Crie ou importe uma capa primeiro', next: 'Avançar' },
    ru: { kind: 'Музыка', createTitle: 'Новая песня', createLead: 'Выберите название и с чего начать — всё можно изменить позже.', name: 'Название', namePlaceholder: 'Название песни', start: 'Начать с',
        startWrite: 'Свой текст', startWriteLead: 'Пишите в редакторе, разделы отмечайте тегами', startAi: 'Текст от ИИ', startAiLead: 'Скажите, о чём песня, — ИИ напишет весь текст', startInstrumental: 'Инструментал', startInstrumentalLead: 'Без вокала, только мелодия и аранжировка',
        theme: 'О чём песня', themePlaceholder: 'О чём песня', aspect: 'Формат обложки и видео', create: 'Создать', creating: 'Создание…', cancel: 'Отмена', needTheme: 'Напишите строку о песне.',
        lyrics: 'Текст', lyricsPlaceholder: '[Verse]\nПервый куплет…\n\n[Chorus]\nПрипев…', save: 'Сохранить', saved: 'Сохранено', unsaved: 'Есть несохранённые изменения', count: '{n}/{max} символов', insert: 'Вставить раздел',
        aiTitle: 'Текст от ИИ', aiLead: 'Напишите строку о песне — ИИ напишет текст по разделам в звучании ниже. Текущий текст дорабатывается, а не выбрасывается.', aiRun: 'Написать текст', aiRewrite: 'Переписать', aiRunning: 'Пишу текст…', stop: 'Остановить',
        sound: 'Звучание и голос', genre: 'Жанр', mood: 'Настроение', tempo: 'Темп', vocals: 'Голос', language: 'Язык исполнения', length: 'Длина', lengthFull: 'Полная песня', lengthClip: 'Фрагмент 30 с',
        instrumental: 'Инструментал', instrumentalLead: 'Текст не поётся; только мелодия и аранжировка', style: 'Подробнее о звучании', stylePlaceholder: 'Инструменты, эпоха или ориентиры', auto: 'Решает модель',
        songTitle: 'Создать песню', songLead: 'Создаётся по тексту и звучанию. Каждый дубль сохраняется как версия; выберите одну как песню.', generate: 'Создать песню', generateAgain: 'Ещё дубль', generating: 'Создаю песню — полная занимает 1–2 минуты…',
        versions: 'Версии', noVersions: 'Версий пока нет', chosen: 'Выбрана', choose: 'Выбрать', failed: 'Ошибка: {error}', retry: 'Повторить', price: 'около {price}', priceOwn: 'Оплачивается по цене вашей API',
        needLyrics: 'Сначала напишите текст или включите «Инструментал»', rights: 'Не подражайте реальным исполнителям и не используйте чужие тексты; для коммерческого использования следуйте условиям поставщика модели.',
        outputTitle: 'Экспорт', cover: 'Обложка', coverLead: 'Картинка для видео и обложка для музыкальных площадок.', coverGenerate: 'Обложка от ИИ', coverAgain: 'Сделать заново', coverImport: 'Импортировать картинку', coverEmpty: 'Обложки пока нет', coverDrawing: 'Создаю обложку…',
        audio: 'Экспорт аудио', audioLead: 'Экспортирует выбранную версию ({format}).', audioButton: 'Экспортировать аудиофайл', video: 'Экспорт видео', videoLead: 'Обложка с песней в MP4 формата {ratio}.', videoButton: 'Экспортировать видео',
        needSong: 'Сначала создайте и выберите версию', needCover: 'Сначала создайте или импортируйте обложку', next: 'Далее' },
    ar: { kind: 'الموسيقى', createTitle: 'أغنية جديدة', createLead: 'اختر عنوانًا ونقطة البداية، ويمكنك تغيير كل شيء لاحقًا.', name: 'العنوان', namePlaceholder: 'اسم الأغنية', start: 'ابدأ بـ',
        startWrite: 'كلماتي', startWriteLead: 'اكتب في المحرر وحدّد المقاطع بوسوم', startAi: 'كلمات بالذكاء الاصطناعي', startAiLead: 'قل عمّ تدور، ويكتب الذكاء الاصطناعي الكلمات كاملة', startInstrumental: 'موسيقى فقط', startInstrumentalLead: 'بلا غناء، لحن وتوزيع فقط',
        theme: 'عمّ تدور', themePlaceholder: 'عمّ تتحدث الأغنية', aspect: 'شكل الغلاف والفيديو', create: 'إنشاء', creating: 'جارٍ الإنشاء…', cancel: 'إلغاء', needTheme: 'اكتب سطرًا عن الأغنية.',
        lyrics: 'الكلمات', lyricsPlaceholder: '[Verse]\nالمقطع الأول…\n\n[Chorus]\nاللازمة…', save: 'حفظ', saved: 'تم الحفظ', unsaved: 'تغييرات غير محفوظة', count: '{n}/{max} حرف', insert: 'إدراج مقطع',
        aiTitle: 'كلمات بالذكاء الاصطناعي', aiLead: 'اكتب سطرًا عن الأغنية ليكتب الذكاء الاصطناعي كلمات مقسمة بالأسلوب أدناه. تُعاد صياغة الكلمات الحالية ولا تُحذف.', aiRun: 'اكتب الكلمات', aiRewrite: 'أعد الكتابة', aiRunning: 'جارٍ كتابة الكلمات…', stop: 'إيقاف',
        sound: 'الصوت والأداء', genre: 'النوع', mood: 'المزاج', tempo: 'الإيقاع', vocals: 'الصوت', language: 'لغة الغناء', length: 'المدة', lengthFull: 'أغنية كاملة', lengthClip: 'مقطع 30 ثانية',
        instrumental: 'موسيقى فقط', instrumentalLead: 'لا تُغنّى الكلمات، لحن وتوزيع فقط', style: 'تفاصيل الصوت', stylePlaceholder: 'الآلات أو الحقبة أو المراجع', auto: 'يقرّر النموذج',
        songTitle: 'إنشاء الأغنية', songLead: 'تُنشأ من الكلمات والأسلوب. تُحفظ كل محاولة نسخةً، واختر واحدة لتكون الأغنية.', generate: 'إنشاء الأغنية', generateAgain: 'محاولة أخرى', generating: 'جارٍ إنشاء الأغنية — تستغرق الكاملة نحو 1–2 دقيقة…',
        versions: 'النسخ', noVersions: 'لا توجد نسخ بعد', chosen: 'المختارة', choose: 'اختيار', failed: 'فشل: {error}', retry: 'إعادة المحاولة', price: 'نحو {price}', priceOwn: 'تحاسبك واجهتك البرمجية بسعرها',
        needLyrics: 'اكتب الكلمات أولًا أو فعّل «موسيقى فقط»', rights: 'لا تقلّد مغنين حقيقيين ولا تستخدم كلمات غيرك، وللاستخدام التجاري اتبع شروط مزوّد النموذج.',
        outputTitle: 'التصدير', cover: 'الغلاف', coverLead: 'صورة الفيديو وغلاف لمنصات الموسيقى.', coverGenerate: 'غلاف بالذكاء الاصطناعي', coverAgain: 'إعادة الإنشاء', coverImport: 'استيراد صورة', coverEmpty: 'لا يوجد غلاف بعد', coverDrawing: 'جارٍ إنشاء الغلاف…',
        audio: 'تصدير الصوت', audioLead: 'يصدّر النسخة المختارة ({format}).', audioButton: 'تصدير ملف صوتي', video: 'تصدير الفيديو', videoLead: 'الغلاف مع الأغنية بصيغة MP4 وبنسبة {ratio}.', videoButton: 'تصدير الفيديو',
        needSong: 'أنشئ نسخة واخترها أولًا', needCover: 'أنشئ غلافًا أو استورده أولًا', next: 'التالي' },
    hi: { kind: 'संगीत', createTitle: 'नया गीत', createLead: 'शीर्षक और शुरुआत चुनें; बाद में सब बदला जा सकता है।', name: 'शीर्षक', namePlaceholder: 'गाने का नाम', start: 'शुरुआत',
        startWrite: 'अपने बोल', startWriteLead: 'एडिटर में लिखें, हिस्सों को टैग से अलग करें', startAi: 'AI से बोल', startAiLead: 'बताइए गीत किस बारे में है; AI पूरे बोल लिखता है', startInstrumental: 'वाद्य संगीत', startInstrumentalLead: 'गायन नहीं, सिर्फ़ धुन और अरेंजमेंट',
        theme: 'किस बारे में', themePlaceholder: 'गाना किस बारे में है', aspect: 'कवर और वीडियो का अनुपात', create: 'बनाएँ', creating: 'बन रहा है…', cancel: 'रद्द करें', needTheme: 'गीत के बारे में एक पंक्ति लिखें।',
        lyrics: 'बोल', lyricsPlaceholder: '[Verse]\nपहला अंतरा…\n\n[Chorus]\nकोरस…', save: 'सहेजें', saved: 'सहेजा गया', unsaved: 'बिना सहेजे बदलाव', count: '{n}/{max} अक्षर', insert: 'हिस्सा जोड़ें',
        aiTitle: 'AI से बोल', aiLead: 'गीत के बारे में एक पंक्ति लिखें; AI नीचे की शैली में हिस्सों वाले बोल लिखता है। मौजूदा बोल दोबारा लिखे जाते हैं, फेंके नहीं जाते।', aiRun: 'बोल लिखें', aiRewrite: 'दोबारा लिखें', aiRunning: 'बोल लिखे जा रहे हैं…', stop: 'रोकें',
        sound: 'ध्वनि और आवाज़', genre: 'शैली', mood: 'मिज़ाज', tempo: 'गति', vocals: 'आवाज़', language: 'गायन की भाषा', length: 'लंबाई', lengthFull: 'पूरा गीत', lengthClip: '30 सेकंड की क्लिप',
        instrumental: 'वाद्य संगीत', instrumentalLead: 'बोल गाए नहीं जाते; सिर्फ़ धुन और अरेंजमेंट', style: 'ध्वनि के बारे में और', stylePlaceholder: 'वाद्य, दौर या संदर्भ', auto: 'मॉडल तय करे',
        songTitle: 'गीत बनाएँ', songLead: 'बोल और ध्वनि से बनता है। हर टेक एक संस्करण के रूप में रहता है; एक को गीत चुनें।', generate: 'गीत बनाएँ', generateAgain: 'एक और टेक', generating: 'गीत बन रहा है — पूरा गीत लगभग 1–2 मिनट लेता है…',
        versions: 'संस्करण', noVersions: 'अभी कोई संस्करण नहीं', chosen: 'चुना गया', choose: 'चुनें', failed: 'विफल: {error}', retry: 'फिर से करें', price: 'लगभग {price}', priceOwn: 'आपका API अपनी कीमत पर बिल करता है',
        needLyrics: 'पहले बोल लिखें या “वाद्य संगीत” चालू करें', rights: 'असली गायकों की नकल न करें और दूसरों के बोल न लें; व्यावसायिक उपयोग के लिए मॉडल प्रदाता की शर्तें देखें।',
        outputTitle: 'निर्यात', cover: 'कवर', coverLead: 'वीडियो की तस्वीर और संगीत प्लेटफ़ॉर्म का कवर।', coverGenerate: 'AI कवर', coverAgain: 'फिर से बनाएँ', coverImport: 'चित्र आयात करें', coverEmpty: 'अभी कोई कवर नहीं', coverDrawing: 'कवर बन रहा है…',
        audio: 'ऑडियो निर्यात', audioLead: 'चुना गया संस्करण निर्यात करता है ({format})।', audioButton: 'ऑडियो फ़ाइल निर्यात करें', video: 'वीडियो निर्यात', videoLead: 'कवर और गीत को {ratio} MP4 के रूप में निर्यात करता है।', videoButton: 'वीडियो निर्यात करें',
        needSong: 'पहले एक संस्करण बनाकर चुनें', needCover: 'पहले कवर बनाएँ या आयात करें', next: 'आगे' }
};

function uncheckedMusicText(locale: NextMuxDesktopLocale, key: Key, values: Readonly<Record<string, string | number>> = {}): string {
    return (copy[locale] || copy.en)[key].replace(/\{(\w+)\}/g, (match, name: string) => name in values ? String(values[name]) : match);
}
export type MusicTextKey = Key;

export function musicPresetLabel(locale: NextMuxDesktopLocale, preset: MusicPreset): string {
    return pick(locale, preset.labels);
}

// ── 新建歌曲 ──────────────────────────────────────────────────────────────

export type MusicStart = 'write' | 'ai' | 'instrumental';
export interface MusicCreateRequest {
    readonly title: string;
    readonly start: MusicStart;
    readonly theme: string;
    readonly ratio: string;
    readonly parentDirectory?: string;
}

export function MusicCreateSheet(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly busy: boolean;
    readonly error?: string;
    readonly errorDetail?: string;
    readonly textModel: React.ReactNode;
    readonly ratioOptions: readonly string[];
    readonly parentDirectory?: string;
    readonly defaultDirectory?: string;
    readonly existingPaths?: readonly string[];
    readonly defaultTitle?: string;
    readonly onChooseDirectory?: () => void;
    readonly onResetDirectory?: () => void;
    readonly onCancel: () => void;
    readonly onCreate: (request: MusicCreateRequest) => void;
}): React.ReactElement {
    const t = (key: Key): string => musicText(props.locale, key);
    const [title, setTitle] = React.useState('');
    const [start, setStart] = React.useState<MusicStart>('ai');
    const [theme, setTheme] = React.useState('');
    const [ratio, setRatio] = React.useState(props.ratioOptions?.[0] || '1:1');
    const [problem, setProblem] = React.useState('');
    React.useEffect(() => {
        if (props.busy) return;
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); props.onCancel(); }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [props.busy, props.onCancel]);
    const effectiveTitle = title.trim() || (start === 'ai' ? theme.trim().split(/[\n。.!?！？]/)[0].slice(0, 40) : '');
    const create = (): void => {
        if (start === 'ai' && !theme.trim()) { setProblem(t('needTheme')); return; }
        props.onCreate({
            title: effectiveTitle,
            start,
            theme: theme.trim(),
            ratio,
            ...(props.parentDirectory ? { parentDirectory: props.parentDirectory } : {})
        });
    };
    const activeParentDir = props.parentDirectory || props.defaultDirectory || '';
    const previewPath = previewComicProjectFolderPath(activeParentDir, effectiveTitle, props.defaultTitle || localizeDesktopSurface(props.locale, '未命名歌曲'), props.existingPaths);
    const ratioOptions = props.ratioOptions ?? ['1:1', '16:9', '9:16'];
    const starts: readonly { readonly id: MusicStart; readonly icon: string; readonly label: Key; readonly lead: Key }[] = [
        { id: 'ai', icon: 'sparkle', label: 'startAi', lead: 'startAiLead' },
        { id: 'write', icon: 'edit', label: 'startWrite', lead: 'startWriteLead' },
        { id: 'instrumental', icon: 'music', label: 'startInstrumental', lead: 'startInstrumentalLead' }
    ];
    return <div className='nmx-sheet-backdrop nmx-dialog-backdrop' onMouseDown={() => { if (!props.busy) props.onCancel(); }}>
        <section className='nmx-permission-sheet nmx-comic-create-sheet nmx-comic-create-v5 nmx-comic-kind-sheet nmx-music-create' role='dialog' aria-modal='true' aria-labelledby='nmx-music-create-title' onMouseDown={event => event.stopPropagation()}>
            <header><div><h2 id='nmx-music-create-title'><i className='codicon codicon-music' aria-hidden='true'></i>{t('createTitle')}</h2><p>{t('createLead')}</p></div>
                <button aria-label={t('cancel')} disabled={props.busy} onClick={props.onCancel}>×</button></header>
            <div className='nmx-comic-create-body'>
                <label className='nmx-comic-field'>{t('name')}<ImeInput autoFocus maxLength={120} value={title} placeholder={t('namePlaceholder')} onChange={event => setTitle(event.currentTarget.value)} /></label>
                <ComicProjectLocationField locale={props.locale} parentDirectory={activeParentDir}
                    defaultDirectory={props.defaultDirectory} previewPath={previewPath} disabled={props.busy}
                    onChooseDirectory={props.onChooseDirectory} onResetDirectory={props.onResetDirectory} />
                <div className='nmx-comic-field'>{t('start')}
                    <div className='nmx-music-starts' role='radiogroup' aria-label={t('start')}>
                        {starts.map(item => <button key={item.id} type='button' role='radio' aria-checked={start === item.id} className={start === item.id ? 'is-active' : ''}
                            onClick={() => { setStart(item.id); setProblem(''); }}>
                            <i className={`codicon codicon-${item.icon}`} aria-hidden='true'></i><strong>{t(item.label)}</strong><small>{t(item.lead)}</small></button>)}
                    </div>
                </div>
                {start === 'ai' && <>
                    <label className='nmx-comic-field'>{t('theme')}<ImeTextarea rows={3} maxLength={2_000} value={theme} placeholder={t('themePlaceholder')} onChange={event => { setTheme(event.currentTarget.value); setProblem(''); }} /></label>
                    {props.textModel}
                </>}
                <label className='nmx-comic-field'>{t('aspect')}<select value={ratio} onChange={event => setRatio(event.currentTarget.value)}>{ratioOptions.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
                {(problem || props.error) && <div className='nmx-agent-inline-error' role='alert'><span data-nmx-literal={!problem && Boolean(props.errorDetail) || undefined}>{problem || props.error}</span>
                    {!problem && props.errorDetail && <MediaDiagnostic locale={props.locale} detail={props.errorDetail} />}</div>}
            </div>
            <footer><button className='nmx-secondary-button' disabled={props.busy} onClick={props.onCancel}>{t('cancel')}</button>
                <button className='nmx-primary-button' disabled={props.busy} onClick={create}>{props.busy ? t('creating') : t('create')}</button></footer>
        </section>
    </div>;
}

// ── 歌词与风格 ────────────────────────────────────────────────────────────

function PresetSelect(props: { readonly locale: NextMuxDesktopLocale; readonly label: string; readonly value: string; readonly presets: readonly MusicPreset[]; readonly disabled?: boolean; readonly onChange: (value: string) => void }): React.ReactElement {
    const known = props.presets.some(preset => preset.id === props.value);
    return <label className='nmx-music-field'><span>{props.label}</span>
        <select value={props.value} disabled={props.disabled} onChange={event => props.onChange(event.currentTarget.value)}>
            <option value=''>{musicText(props.locale, 'auto')}</option>
            {props.presets.map(preset => <option key={preset.id} value={preset.id}>{musicPresetLabel(props.locale, preset)}</option>)}
            {!known && props.value && <option value={props.value}>{props.value}</option>}
        </select></label>;
}

function Segments(props: { readonly locale: NextMuxDesktopLocale; readonly label: string; readonly value: string; readonly options: readonly { readonly id: string; readonly label: string }[]; readonly disabled?: boolean; readonly onChange: (value: string) => void }): React.ReactElement {
    return <div className='nmx-music-field'><span>{props.label}</span>
        <div className='nmx-music-segments' role='radiogroup' aria-label={props.label}>
            {props.options.map(option => <button key={option.id || 'auto'} type='button' role='radio' aria-checked={props.value === option.id} disabled={props.disabled}
                className={props.value === option.id ? 'is-active' : ''} onClick={() => props.onChange(option.id)}>{option.label}</button>)}
        </div></div>;
}

export interface MusicLyricsViewProps {
    readonly locale: NextMuxDesktopLocale;
    readonly settings: ComicMusicSettings;
    readonly draft: string;
    readonly dirty: boolean;
    readonly busy: boolean;
    readonly theme: string;
    readonly writing: boolean;
    readonly writingProgress?: string;
    readonly writeError?: string;
    readonly textModel: React.ReactNode;
    readonly onDraft: (text: string) => void;
    readonly onSave: () => void;
    readonly onTheme: (text: string) => void;
    readonly onWrite: () => void;
    readonly onStopWriting: () => void;
    readonly onSettings: (patch: Partial<ComicMusicSettings>) => void;
    readonly onNext: () => void;
}

export function MusicLyricsView(props: MusicLyricsViewProps): React.ReactElement {
    const t = (key: Key, values?: Readonly<Record<string, string | number>>): string => musicText(props.locale, key, values);
    const editor = React.useRef<HTMLTextAreaElement>(null);
    const s = props.settings;
    const insert = (tag: string): void => {
        const node = editor.current;
        const text = props.draft;
        const at = node ? node.selectionStart : text.length;
        const before = text.slice(0, at);
        const lead = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
        const next = `${before}${lead}${tag}\n${text.slice(at)}`;
        props.onDraft(next.slice(0, MUSIC_LYRICS_LIMIT));
        requestAnimationFrame(() => { const position = before.length + lead.length + tag.length + 1; node?.focus(); node?.setSelectionRange(position, position); });
    };
    return <section className='nmx-music-lyrics'>
        <div className='nmx-music-card nmx-music-editor'>
            <header><div><h2>{t('lyrics')}</h2><small data-nmx-literal>{t('count', { n: props.draft.length, max: MUSIC_LYRICS_LIMIT })}{props.dirty ? ` · ${t('unsaved')}` : ''}</small></div>
                <button type='button' className='nmx-secondary-button' disabled={!props.dirty || props.busy} onClick={props.onSave}>{props.dirty ? t('save') : t('saved')}</button></header>
            <div className='nmx-music-tags' role='toolbar' aria-label={t('insert')}>
                {MUSIC_SECTION_TAGS.map(item => <button key={item.tag} type='button' disabled={props.busy || s.instrumental} onClick={() => insert(item.tag)} title={item.tag}>
                    <i className='codicon codicon-add' aria-hidden='true'></i>{pick(props.locale, item.labels)}</button>)}
            </div>
            <ImeTextarea ref={editor} className='nmx-music-editor-text' value={props.draft} maxLength={MUSIC_LYRICS_LIMIT} placeholder={t('lyricsPlaceholder')} disabled={props.busy}
                spellCheck={false} onChange={event => props.onDraft(event.currentTarget.value)} />
            <footer><small>{t('rights')}</small>
                <button type='button' className='nmx-primary-button' disabled={props.busy} onClick={props.onNext}>{t('next')}<i className='codicon codicon-arrow-right' aria-hidden='true'></i></button></footer>
        </div>
        <aside className='nmx-music-side'>
            <div className='nmx-music-card nmx-music-ai'>
                <h3><i className='codicon codicon-sparkle' aria-hidden='true'></i>{t('aiTitle')}</h3>
                <p>{t('aiLead')}</p>
                <ImeTextarea rows={3} maxLength={2_000} value={props.theme} placeholder={t('themePlaceholder')} disabled={props.writing} onChange={event => props.onTheme(event.currentTarget.value)} />
                {props.textModel}
                {props.writing && <div className='nmx-music-progress' role='status'><i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i><span data-nmx-literal>{props.writingProgress || t('aiRunning')}</span></div>}
                {props.writeError && <div className='nmx-agent-inline-error' role='alert' data-nmx-literal>{props.writeError}</div>}
                {props.writing
                    ? <button type='button' className='nmx-secondary-button' onClick={props.onStopWriting}>{t('stop')}</button>
                    : <button type='button' className='nmx-primary-button' disabled={props.busy || !props.theme.trim()} onClick={props.onWrite}>
                        <i className='codicon codicon-sparkle' aria-hidden='true'></i>{props.draft.trim() ? t('aiRewrite') : t('aiRun')}</button>}
            </div>
            <div className='nmx-music-card nmx-music-sound'>
                <h3><i className='codicon codicon-settings' aria-hidden='true'></i>{t('sound')}</h3>
                <label className='nmx-music-switch'><span><strong>{t('instrumental')}</strong><small>{t('instrumentalLead')}</small></span>
                    <button type='button' role='switch' aria-checked={s.instrumental} className={`nmx-comic-setup-toggle ${s.instrumental ? 'is-on' : ''}`} disabled={props.busy}
                        onClick={() => props.onSettings({ instrumental: !s.instrumental })}><span aria-hidden='true'></span></button></label>
                <PresetSelect locale={props.locale} label={t('genre')} value={s.genre} presets={MUSIC_GENRES} disabled={props.busy} onChange={genre => props.onSettings({ genre })} />
                <PresetSelect locale={props.locale} label={t('mood')} value={s.mood} presets={MUSIC_MOODS} disabled={props.busy} onChange={mood => props.onSettings({ mood })} />
                <Segments locale={props.locale} label={t('tempo')} value={s.tempo} disabled={props.busy} onChange={tempo => props.onSettings({ tempo })}
                    options={[{ id: '', label: t('auto') }, ...MUSIC_TEMPOS.map(preset => ({ id: preset.id, label: musicPresetLabel(props.locale, preset) }))]} />
                {!s.instrumental && <>
                    <Segments locale={props.locale} label={t('vocals')} value={s.vocals} disabled={props.busy} onChange={vocals => props.onSettings({ vocals })}
                        options={[{ id: '', label: t('auto') }, ...MUSIC_VOCALS.map(preset => ({ id: preset.id, label: musicPresetLabel(props.locale, preset) }))]} />
                    <PresetSelect locale={props.locale} label={t('language')} value={s.language} presets={MUSIC_LANGUAGES} disabled={props.busy} onChange={language => props.onSettings({ language })} />
                </>}
                <Segments locale={props.locale} label={t('length')} value={s.length} disabled={props.busy} onChange={length => props.onSettings({ length: length === 'clip' ? 'clip' : 'full' })}
                    options={[{ id: 'full', label: t('lengthFull') }, { id: 'clip', label: t('lengthClip') }]} />
                <label className='nmx-music-field'><span>{t('style')}</span>
                    <StyleField value={s.style} placeholder={t('stylePlaceholder')} disabled={props.busy} onCommit={style => props.onSettings({ style })} /></label>
            </div>
        </aside>
    </section>;
}

/** Free text saved when the field loses focus (not on every key). */
function StyleField(props: { readonly value: string; readonly placeholder: string; readonly disabled?: boolean; readonly onCommit: (value: string) => void }): React.ReactElement {
    const [value, setValue] = React.useState(props.value);
    React.useEffect(() => setValue(props.value), [props.value]);
    return <ImeTextarea rows={2} maxLength={2_000} value={value} placeholder={props.placeholder} disabled={props.disabled}
        onChange={event => setValue(event.currentTarget.value)} onBlur={() => { if (value.trim() !== props.value.trim()) props.onCommit(value.trim()); }} />;
}

// ── 生成歌曲 ──────────────────────────────────────────────────────────────

export interface MusicVersion {
    readonly id: string;
    readonly url?: string;
    readonly model?: string;
    readonly createdAt: string;
    readonly chosen: boolean;
}

export interface MusicSongViewProps {
    readonly locale: NextMuxDesktopLocale;
    readonly musicModel: React.ReactNode;
    readonly referenceFields?: React.ReactNode;
    readonly price?: string;
    readonly ownApi: boolean;
    readonly canGenerate: boolean;
    readonly blockedReason?: string;
    readonly running: number;
    readonly failure?: string;
    readonly versions: readonly MusicVersion[];
    readonly busy: boolean;
    readonly onGenerate: () => void;
    readonly onRetry?: () => void;
    readonly onChoose: (assetId: string) => void;
    readonly onNext: () => void;
}

export function MusicSongView(props: MusicSongViewProps): React.ReactElement {
    const t = (key: Key, values?: Readonly<Record<string, string | number>>): string => musicText(props.locale, key, values);
    const formatTime = (value: string): string => { try { return new Intl.DateTimeFormat(props.locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); } catch { return value; } };
    return <section className='nmx-music-song'>
        <div className='nmx-music-card nmx-music-generate'>
            <header><div><h2>{t('songTitle')}</h2><p>{t('songLead')}</p></div></header>
            {props.musicModel}
            {props.referenceFields}
            <div className='nmx-music-generate-row'>
                <small data-nmx-literal>{props.ownApi ? t('priceOwn') : props.price ? t('price', { price: props.price }) : ''}</small>
                <button type='button' className='nmx-primary-button' disabled={!props.canGenerate || props.busy} title={props.blockedReason} onClick={props.onGenerate}>
                    <i className={`codicon codicon-${props.running ? 'loading codicon-modifier-spin' : 'play-circle'}`} aria-hidden='true'></i>{props.versions.length ? t('generateAgain') : t('generate')}</button>
            </div>
            {props.blockedReason && !props.canGenerate && <p className='nmx-music-note is-warn'><i className='codicon codicon-info' aria-hidden='true'></i>{props.blockedReason}</p>}
            {props.running > 0 && <div className='nmx-music-progress' role='status'><i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i><span>{t('generating')}</span></div>}
            {props.failure && <div className='nmx-agent-inline-error' role='alert'><span data-nmx-literal>{t('failed', { error: props.failure })}</span>
                {props.onRetry && <button type='button' className='nmx-link-button' onClick={props.onRetry}>{t('retry')}</button>}</div>}
        </div>
        <div className='nmx-music-card nmx-music-versions'>
            <header><h3>{t('versions')}</h3><small data-nmx-literal>{props.versions.length || ''}</small></header>
            {props.versions.length === 0 ? <p className='nmx-music-empty'><i className='codicon codicon-music' aria-hidden='true'></i>{t('noVersions')}</p>
                : <ol>{props.versions.map((version, index) => <li key={version.id} className={version.chosen ? 'is-chosen' : ''}>
                    <span className='nmx-music-version-index' data-nmx-literal>{`v${props.versions.length - index}`}</span>
                    <span className='nmx-music-version-copy'><strong data-nmx-literal>{version.model || '—'}</strong><small data-nmx-literal>{formatTime(version.createdAt)}</small></span>
                    {version.url ? <audio controls preload='metadata' src={version.url} controlsList='nodownload noplaybackrate' /> : <span />}
                    {version.chosen ? <em className='nmx-music-chosen'><i className='codicon codicon-check' aria-hidden='true'></i>{t('chosen')}</em>
                        : <button type='button' className='nmx-secondary-button' disabled={props.busy} onClick={() => props.onChoose(version.id)}>{t('choose')}</button>}
                </li>)}</ol>}
            <footer><button type='button' className='nmx-primary-button' disabled={!props.versions.some(version => version.chosen)} onClick={props.onNext}>{t('next')}<i className='codicon codicon-arrow-right' aria-hidden='true'></i></button></footer>
        </div>
    </section>;
}

// ── 导出 ─────────────────────────────────────────────────────────────────

export interface MusicOutputViewProps {
    readonly locale: NextMuxDesktopLocale;
    readonly coverUrl?: string;
    readonly coverModel: React.ReactNode;
    readonly drawingCover: boolean;
    readonly coverError?: string;
    readonly ratio: string;
    readonly format: string;
    readonly hasSong: boolean;
    readonly hasMv?: boolean;
    readonly mvReady?: boolean;
    readonly exporting: boolean;
    readonly busy: boolean;
    readonly message?: string;
    readonly onGenerateCover: () => void;
    readonly onImportCover: () => void;
    readonly onExportAudio: () => void;
    readonly onExportVideo: () => void;
}

export function MusicOutputView(props: MusicOutputViewProps): React.ReactElement {
    const t = (key: Key, values?: Readonly<Record<string, string | number>>): string => musicText(props.locale, key, values);
    const [width, height] = props.ratio.split(':').map(Number);
    const needsVisuals = props.hasMv ? !props.mvReady : !props.coverUrl;
    const visualHint = props.hasMv ? musicMvText(props.locale, 'needSegments') : t('needCover');
    return <section className='nmx-music-output'>
        <div className='nmx-music-card nmx-music-cover'>
            <header><div><h2>{t('cover')}</h2><p>{props.hasMv ? musicMvText(props.locale, 'coverLead') : t('coverLead')}</p></div></header>
            <div className='nmx-music-cover-frame' style={{ aspectRatio: `${width || 1} / ${height || 1}` }}>
                {props.coverUrl ? <img src={props.coverUrl} alt='' /> : <span><i className='codicon codicon-file-media' aria-hidden='true'></i>{props.drawingCover ? t('coverDrawing') : t('coverEmpty')}</span>}
                {props.drawingCover && <span className='nmx-music-cover-busy' aria-hidden='true'><i className='codicon codicon-loading codicon-modifier-spin'></i></span>}
            </div>
            {props.coverModel}
            {props.coverError && <div className='nmx-agent-inline-error' role='alert' data-nmx-literal>{props.coverError}</div>}
            <div className='nmx-music-actions'>
                <button type='button' className='nmx-secondary-button' disabled={props.busy || props.drawingCover} onClick={props.onImportCover}><i className='codicon codicon-cloud-upload' aria-hidden='true'></i>{t('coverImport')}</button>
                <button type='button' className='nmx-primary-button' disabled={props.busy || props.drawingCover} onClick={props.onGenerateCover}><i className='codicon codicon-sparkle' aria-hidden='true'></i>{props.coverUrl ? t('coverAgain') : t('coverGenerate')}</button>
            </div>
        </div>
        <div className='nmx-music-exports'>
            <div className='nmx-music-card nmx-music-export'>
                <span className='nmx-music-export-icon' aria-hidden='true'><i className='codicon codicon-unmute'></i></span>
                <div><h3>{t('audio')}</h3><p>{t('audioLead', { format: props.format.toUpperCase() })}</p></div>
                <button type='button' className='nmx-primary-button' disabled={!props.hasSong || props.busy || props.exporting} title={props.hasSong ? undefined : t('needSong')} onClick={props.onExportAudio}>{t('audioButton')}</button>
            </div>
            <div className='nmx-music-card nmx-music-export'>
                <span className='nmx-music-export-icon' aria-hidden='true'><i className='codicon codicon-device-camera-video'></i></span>
                <div><h3>{t('video')}</h3><p>{props.hasMv ? musicMvText(props.locale, 'mvExportLead', { ratio: props.ratio }) : t('videoLead', { ratio: props.ratio })}</p></div>
                <button type='button' className='nmx-primary-button' disabled={!props.hasSong || needsVisuals || props.busy || props.exporting}
                    title={!props.hasSong ? t('needSong') : needsVisuals ? visualHint : undefined} onClick={props.onExportVideo}>{t('videoButton')}</button>
            </div>
            {(!props.hasSong || needsVisuals) && <p className='nmx-music-note'><i className='codicon codicon-info' aria-hidden='true'></i>{!props.hasSong ? t('needSong') : visualHint}</p>}
            {props.message && <p className='nmx-music-note is-done' role='status' data-nmx-literal>{props.message}</p>}
        </div>
    </section>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function musicText(locale: Parameters<typeof uncheckedMusicText>[0], key: Parameters<typeof uncheckedMusicText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedMusicText>>): string {
    return totalCopy(locale, key, language => uncheckedMusicText(language, key, ...rest));
}
