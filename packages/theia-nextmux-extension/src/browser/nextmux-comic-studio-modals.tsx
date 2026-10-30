import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';
import { ImeInput, ImeTextarea } from './nextmux-ime-field';
import {
    ComicProjectLocationField,
    type ComicCreationLibraryItem
} from './nextmux-comic-kinds';
import {
    COMIC_MUSIC_STYLE_PRESETS,
    COMIC_VISUAL_STYLE_PRESETS,
    comicStylePresetLabel
} from './nextmux-comic-style-presets';

export type ComicStudioModalKind = 'image' | 'topic' | 'music';

export interface ComicStudioGeneratedTake {
    readonly id: string;
    readonly kind: 'video' | 'audio' | 'image';
    readonly title: string;
    /** Playable URL in renderer (data:, blob:, file:// or local media preview URL). */
    readonly mediaUrl: string;
    /** Absolute path on disk inside user's selected folder, used by right-click "打开视频/音频/图片所在文件夹". */
    readonly filePath: string;
    readonly thumbnailUrl?: string;
    readonly durationSeconds?: number;
    readonly aspectRatio?: string;
    readonly createdAtLabel?: string;
    readonly modelLabel?: string;
    readonly prompt?: string;
    readonly assetId?: string;
}

export interface ComicStudioSourceFile {
    readonly id: string;
    readonly name: string;
    readonly kind: 'image' | 'video' | 'audio';
    readonly previewUrl?: string;
    readonly path?: string;
}

export interface ComicMediaStudioModalProps {
    readonly locale: NextMuxDesktopLocale;
    readonly kind: ComicStudioModalKind;
    readonly open: boolean;
    readonly isLightTheme?: boolean;
    /** Bound project path when reopening an existing project card; undefined before first generation. */
    readonly boundProjectPath?: string;
    readonly title: string;
    readonly onTitleChange: (value: string) => void;
    /** Save folder controls */
    readonly parentDirectory: string;
    readonly defaultDirectory?: string;
    readonly previewFolderPath: string;
    readonly canOpenDirectory?: boolean;
    readonly onChooseDirectory?: () => void;
    readonly onResetDirectory?: () => void;
    readonly onOpenDirectory?: () => void;
    /** Source files (images for image-to-video; optional own materials for topic-to-video) */
    readonly sourceFiles: readonly ComicStudioSourceFile[];
    readonly onPickLocalFiles?: () => void;
    readonly onDropLocalFiles?: (files: FileList) => void;
    readonly onRemoveSourceFile?: (id: string) => void;
    readonly libraryItems?: readonly ComicCreationLibraryItem[];
    readonly onToggleLibraryItem?: (item: ComicCreationLibraryItem) => void;
    readonly selectedLibraryIds?: ReadonlySet<string>;
    /** Isolated Coding-style Relay + Model picker slot(s) rendered by parent widget */
    readonly primaryModelPickerSlot?: React.ReactNode;
    /** Optional secondary model picker slot ONLY for `topic` (script model); NEVER rendered for `image` or `music`! */
    readonly secondaryModelPickerSlot?: React.ReactNode;
    /** Optional tertiary model picker slot ONLY for `topic` (speech / voice-over model when TTS is active). */
    readonly tertiaryModelPickerSlot?: React.ReactNode;
    /** Prompt & style */
    readonly prompt: string;
    readonly onPromptChange: (value: string) => void;
    readonly stylePresetId: string;
    readonly onStylePresetChange: (presetId: string) => void;
    /** Parameters */
    readonly seconds: number;
    readonly secondsOptions: readonly number[];
    readonly onSecondsChange: (seconds: number) => void;
    readonly aspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
    readonly aspectRatioOptions?: readonly ('16:9' | '9:16' | '1:1' | '4:3' | '3:4')[];
    readonly onAspectRatioChange: (ratio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4') => void;
    /** Optional native sound / voice / music controls */
    readonly soundSupported?: boolean;
    readonly soundEnabled?: boolean;
    readonly onSoundEnabledChange?: (enabled: boolean) => void;
    /** Topic-specific controls */
    readonly topicVisualMode?: 'videos' | 'images';
    readonly onTopicVisualModeChange?: (mode: 'videos' | 'images') => void;
    readonly topicVoiceSubtitles?: boolean;
    readonly onTopicVoiceSubtitlesChange?: (enabled: boolean) => void;
    readonly topicVoiceSummaryText?: string;
    readonly topicSources?: { readonly own: boolean; readonly stock: boolean; readonly ai: boolean };
    readonly onTopicToggleSource?: (key: 'own' | 'stock' | 'ai') => void;
    readonly topicStockProvider?: 'pexels' | 'pixabay';
    readonly onTopicStockProviderChange?: (provider: 'pexels' | 'pixabay') => void;
    readonly topicStockKeySaved?: boolean;
    readonly topicStockKeyInput?: string;
    readonly onTopicStockKeyInputChange?: (value: string) => void;
    readonly topicStockEditingKey?: boolean;
    readonly onTopicStockEditingKeyChange?: (editing: boolean) => void;
    readonly onOpenStockKeyPage?: (provider: 'pexels' | 'pixabay') => void;
    /** Music-specific controls */
    readonly musicInstrumental?: boolean;
    readonly onMusicInstrumentalChange?: (instrumental: boolean) => void;
    readonly musicFullTrack?: boolean;
    readonly onMusicFullTrackChange?: (fullTrack: boolean) => void;
    /** Pricing & execution state */
    readonly estimatedPriceLabel: string;
    readonly estimatedPriceHint?: string;
    readonly blockedReason?: string;
    readonly onBlockedAction?: () => void;
    readonly blockedActionLabel?: string;
    readonly generating: boolean;
    readonly generatingStageLabel?: string;
    readonly errorMessage?: string;
    /** Generated takes history & active take */
    readonly takes: readonly ComicStudioGeneratedTake[];
    readonly activeTakeId?: string;
    readonly onSelectTake: (takeId: string) => void;
    /** Actions */
    readonly onGenerate: () => void;
    readonly onCancelGenerate?: () => void;
    readonly onRevealInFolder: (filePath: string) => void;
    readonly onEnterEditor: () => void;
    readonly onClose: () => void;
    readonly onFormScroll?: () => void;
    readonly onDismissTransientOverlay?: () => boolean;
}

const DEFAULT_ASPECT_RATIOS: readonly ('16:9' | '9:16' | '1:1' | '4:3' | '3:4')[] = [
    '16:9',
    '9:16',
    '1:1',
    '4:3',
    '3:4'
];

const MODAL_KIND_ICONS: Readonly<Record<ComicStudioModalKind, string>> = {
    image: 'file-media',
    topic: 'wand',
    music: 'music'
};

const zhCN = {
    titleImage: '图片转视频',
    titleTopic: '主题一键成片',
    titleMusic: '音乐制作',
    projectTitlePlaceholder: '输入项目名称（可选）',
    boundProjectBadge: '已绑定目录',
    close: '关闭',
    selectImages: '选择图片',
    dropImagesHint: '拖拽图片至此，或点击上传（支持 PNG / JPG / WebP）',
    referenceAssetsOptional: '参考素材 (可选)',
    dropTopicFilesHint: '拖拽参考图片或视频至此，或点击添加',
    localUpload: '本地上传',
    assetLibrary: '素材库',
    libraryEmpty: '素材库中暂无可用素材',
    removeFile: '移除',
    videoModel: '视频模型',
    modelSelection: '模型选择',
    scriptModel: '文案模型',
    visualModel: '画面模型',
    musicModel: '音乐模型',
    prompt: '提示词',
    promptImagePlaceholder: '描述画面中的人物动作、运镜方向与光影变化…',
    topicPrompt: '主题或剧情描述',
    topicPromptPlaceholder: '输入视频主题、核心卖点或故事梗概，AI 将自动撰写解说并合成成片…',
    musicPrompt: '音乐提示词 / 歌词描述',
    musicPromptPlaceholder: '描述曲风情绪、配器节奏，或直接输入完整歌词（支持 [Verse] / [Chorus] 标记）…',
    songTitleOptional: '歌曲名称 (可选)',
    songTitlePlaceholder: '给这首歌起个名字…',
    durationSeconds: '时长 (秒)',
    targetDuration: '目标时长',
    secondsValue: '{n}秒',
    aspectRatio: '画面比例',
    visualStyle: '画面风格',
    musicStyle: '音乐风格',
    userPromptPriority: '用户提示词优先',
    generateSound: '生成声音',
    generateSoundHint: '同步生成环境音与原生音效',
    topicVisualType: '画面类型',
    topicVisualVideos: 'AI 视频',
    topicVisualImages: 'AI 动态画面',
    voiceAndSubtitles: '配音与字幕',
    voiceAndSubtitlesHint: '自动生成旁白配音与同步字幕',
    vocalMode: '人声模式',
    instrumental: '纯音乐',
    withVocals: '带人声',
    musicDuration: '音乐时长',
    clip30s: '30秒片段',
    fullSong: '完整歌曲',
    estimatedPrice: '预估价格',
    resolveAction: '去处理',
    cancel: '取消',
    generating: '生成中…',
    generateVideo: '生成视频',
    generateMusic: '生成音乐',
    regenerate: '重新生成',
    previewArea: '预览区',
    zoomPreview: '放大预览',
    zoomDetails: '放大详情',
    revealInFolder: '打开所在文件夹',
    revealVideoInFolder: '打开视频所在文件夹',
    revealAudioInFolder: '打开音频所在文件夹',
    revealImageInFolder: '打开图片所在文件夹',
    voiceModel: '配音模型',
    visualSources: '画面来源（可多选）',
    sourceOwn: '我的素材',
    sourceOwnSub: '本地图片 / 视频',
    sourceStock: '网络素材',
    sourceStockSub: 'Pexels · Pixabay',
    sourceAi: 'AI 生成',
    sourceAiSub: 'AI 图片 · AI 视频',
    stockKeySaved: 'API Key 已保存在系统钥匙串',
    stockKeyChange: '更换',
    stockKeyPlaceholder: '粘贴 {provider} API Key',
    stockGetKey: '免费申请 Key',
    stockLicenseNote: '来自 Pexels / Pixabay 免费商用素材库，生成时自动检索并下载至项目文件夹。',
    noAiHintNote: '没有素材的镜头会先空着，之后可以在剪辑里补上。',
    enterEditor: '进入剪辑',
    emptyStageTitle: '作品预览舞台',
    emptyStageHint: '生成完成后将在此直接播放，并自动保存至所选文件夹',
    regeneratingBanner: '正在生成新版本…',
    play: '播放',
    pause: '暂停',
    playPause: '播放 / 暂停',
    mute: '静音',
    unmute: '取消静音',
    volume: '音量',
    prevTake: '上一条',
    nextTake: '下一条',
    takesCount: '{count} 条记录'
};

type StudioModalTextKey = keyof typeof zhCN;
type StudioModalCopyTable = Readonly<Record<StudioModalTextKey, string>>;

const zhTW: StudioModalCopyTable = {
    titleImage: '圖片轉影片',
    titleTopic: '主題一鍵成片',
    titleMusic: '音樂製作',
    projectTitlePlaceholder: '輸入專案名稱（選填）',
    boundProjectBadge: '已綁定目錄',
    close: '關閉',
    selectImages: '選擇圖片',
    dropImagesHint: '拖曳圖片至此，或點擊上傳（支援 PNG / JPG / WebP）',
    referenceAssetsOptional: '參考素材 (選填)',
    dropTopicFilesHint: '拖曳參考圖片或影片至此，或點擊新增',
    localUpload: '本機上傳',
    assetLibrary: '素材庫',
    libraryEmpty: '素材庫中暫無可用素材',
    removeFile: '移除',
    videoModel: '影片模型',
    modelSelection: '模型選擇',
    scriptModel: '文案模型',
    visualModel: '畫面模型',
    musicModel: '音樂模型',
    prompt: '提示詞',
    promptImagePlaceholder: '描述畫面中的人物動作、運鏡方向與光影變化…',
    topicPrompt: '主題或劇情描述',
    topicPromptPlaceholder: '輸入影片主題、核心賣點或故事梗概，AI 將自動撰寫解說並合成成片…',
    musicPrompt: '音樂提示詞 / 歌詞描述',
    musicPromptPlaceholder: '描述曲風情緒、配器節奏，或直接輸入完整歌詞（支援 [Verse] / [Chorus] 標記）…',
    songTitleOptional: '歌曲名稱 (選填)',
    songTitlePlaceholder: '替這首歌取個名字…',
    durationSeconds: '時長 (秒)',
    targetDuration: '目標時長',
    secondsValue: '{n}秒',
    aspectRatio: '畫面比例',
    visualStyle: '畫面風格',
    musicStyle: '音樂風格',
    userPromptPriority: '使用者提示詞優先',
    generateSound: '生成聲音',
    generateSoundHint: '同步生成環境音與原生音效',
    topicVisualType: '畫面類型',
    topicVisualVideos: 'AI 影片',
    topicVisualImages: 'AI 動態畫面',
    voiceAndSubtitles: '配音與字幕',
    voiceAndSubtitlesHint: '自動生成旁白配音與同步字幕',
    vocalMode: '人聲模式',
    instrumental: '純音樂',
    withVocals: '帶人聲',
    musicDuration: '音樂時長',
    clip30s: '30秒片段',
    fullSong: '完整歌曲',
    estimatedPrice: '預估價格',
    resolveAction: '前往處理',
    cancel: '取消',
    generating: '生成中…',
    generateVideo: '生成影片',
    generateMusic: '生成音樂',
    regenerate: '重新生成',
    previewArea: '預覽區',
    zoomPreview: '放大預覽',
    zoomDetails: '放大詳情',
    revealInFolder: '開啟所在資料夾',
    revealVideoInFolder: '開啟影片所在資料夾',
    revealAudioInFolder: '開啟音訊所在資料夾',
    revealImageInFolder: '開啟圖片所在資料夾',
    voiceModel: '配音模型',
    visualSources: '畫面來源（可多選）',
    sourceOwn: '我的素材',
    sourceOwnSub: '本機圖片 / 影片',
    sourceStock: '網路素材',
    sourceStockSub: 'Pexels · Pixabay',
    sourceAi: 'AI 生成',
    sourceAiSub: 'AI 圖片 · AI 影片',
    stockKeySaved: 'API Key 已儲存在系統鑰匙圈',
    stockKeyChange: '更換',
    stockKeyPlaceholder: '貼上 {provider} API Key',
    stockGetKey: '免費申請 Key',
    stockLicenseNote: '來自 Pexels / Pixabay 免費商用素材庫，生成時自動檢索並下載至專案資料夾。',
    noAiHintNote: '沒有素材的鏡頭會先留空，之後可以在剪輯裡補上。',
    enterEditor: '進入剪輯',
    emptyStageTitle: '作品預覽舞台',
    emptyStageHint: '生成完成後將在此直接播放，並自動儲存至所選資料夾',
    regeneratingBanner: '正在生成新版本…',
    play: '播放',
    pause: '暫停',
    playPause: '播放 / 暫停',
    mute: '靜音',
    unmute: '取消靜音',
    volume: '音量',
    prevTake: '上一條',
    nextTake: '下一條',
    takesCount: '{count} 條記錄'
};

const en: StudioModalCopyTable = {
    titleImage: 'Image to Video',
    titleTopic: 'Topic to Video',
    titleMusic: 'Music Studio',
    projectTitlePlaceholder: 'Project name (optional)',
    boundProjectBadge: 'Folder bound',
    close: 'Close',
    selectImages: 'Select image',
    dropImagesHint: 'Drop an image here or click to upload (PNG / JPG / WebP)',
    referenceAssetsOptional: 'Reference material (optional)',
    dropTopicFilesHint: 'Drop a reference image or clip here, or click to add',
    localUpload: 'Local upload',
    assetLibrary: 'Asset library',
    libraryEmpty: 'No matching assets in library yet',
    removeFile: 'Remove',
    videoModel: 'Video model',
    modelSelection: 'Models',
    scriptModel: 'Script model',
    visualModel: 'Visual model',
    musicModel: 'Music model',
    prompt: 'Prompt',
    promptImagePlaceholder: 'Describe subject motion, camera movement and lighting…',
    topicPrompt: 'Topic or story brief',
    topicPromptPlaceholder: 'Enter a topic, key points or story outline; AI writes the script and assembles the video…',
    musicPrompt: 'Music prompt / lyrics',
    musicPromptPlaceholder: 'Describe mood, instruments and groove, or write full lyrics ([Verse] / [Chorus])…',
    songTitleOptional: 'Song title (optional)',
    songTitlePlaceholder: 'Name your track…',
    durationSeconds: 'Duration (s)',
    targetDuration: 'Target length',
    secondsValue: '{n}s',
    aspectRatio: 'Aspect ratio',
    visualStyle: 'Visual style',
    musicStyle: 'Music style',
    userPromptPriority: 'Your prompt takes priority',
    generateSound: 'Generate sound',
    generateSoundHint: 'Synthesize synchronized ambient audio and sound effects',
    topicVisualType: 'Visual mode',
    topicVisualVideos: 'AI Video',
    topicVisualImages: 'AI Motion Stills',
    voiceAndSubtitles: 'Voice-over & subtitles',
    voiceAndSubtitlesHint: 'Automatically synthesize narration and synced captions',
    vocalMode: 'Vocal mode',
    instrumental: 'Instrumental',
    withVocals: 'With vocals',
    musicDuration: 'Track length',
    clip30s: '30s clip',
    fullSong: 'Full song',
    estimatedPrice: 'Estimated cost',
    resolveAction: 'Resolve',
    cancel: 'Cancel',
    generating: 'Generating…',
    generateVideo: 'Generate video',
    generateMusic: 'Generate music',
    regenerate: 'Regenerate',
    previewArea: 'Preview stage',
    zoomPreview: 'Zoom preview',
    zoomDetails: 'Expand details',
    revealInFolder: 'Show in folder',
    revealVideoInFolder: 'Show video in folder',
    revealAudioInFolder: 'Show audio in folder',
    revealImageInFolder: 'Show image in folder',
    voiceModel: 'Voice model',
    visualSources: 'Visual sources (multi-select)',
    sourceOwn: 'My media',
    sourceOwnSub: 'Local photos & clips',
    sourceStock: 'Stock media',
    sourceStockSub: 'Pexels · Pixabay',
    sourceAi: 'AI generated',
    sourceAiSub: 'AI images · AI video',
    stockKeySaved: 'API Key saved in system keychain',
    stockKeyChange: 'Change',
    stockKeyPlaceholder: 'Paste {provider} API Key',
    stockGetKey: 'Get free Key',
    stockLicenseNote: 'Royalty-free clips and photos from Pexels / Pixabay are downloaded directly into your project folder.',
    noAiHintNote: 'Shots without matching media stay empty for now and can be filled in the Editor later.',
    enterEditor: 'Open in Editor',
    emptyStageTitle: 'Preview Stage',
    emptyStageHint: 'Generated media will play right here and save automatically to your selected folder',
    regeneratingBanner: 'Generating new take…',
    play: 'Play',
    pause: 'Pause',
    playPause: 'Play / Pause',
    mute: 'Mute',
    unmute: 'Unmute',
    volume: 'Volume',
    prevTake: 'Previous take',
    nextTake: 'Next take',
    takesCount: '{count} takes'
};

const ja: StudioModalCopyTable = {
    ...en,
    titleImage: '画像から動画',
    titleTopic: 'テーマから動画作成',
    titleMusic: '音楽制作',
    projectTitlePlaceholder: 'プロジェクト名（任意）',
    boundProjectBadge: 'フォルダ固定',
    close: '閉じる',
    selectImages: '画像を選択',
    dropImagesHint: 'ここに画像をドロップ、またはクリックして追加',
    referenceAssetsOptional: '参考素材（任意）',
    localUpload: 'ローカルから追加',
    assetLibrary: '素材ライブラリ',
    libraryEmpty: '利用できる素材がまだありません',
    removeFile: '削除',
    videoModel: '動画モデル',
    modelSelection: 'モデル選択',
    scriptModel: '原稿モデル',
    visualModel: '映像モデル',
    musicModel: '音楽モデル',
    prompt: 'プロンプト',
    topicPrompt: 'テーマ・ストーリー',
    musicPrompt: '音楽プロンプト / 歌詞',
    songTitleOptional: '曲名（任意）',
    durationSeconds: '長さ（秒）',
    targetDuration: '目標時間',
    secondsValue: '{n}秒',
    aspectRatio: '画面比率',
    visualStyle: '映像スタイル',
    musicStyle: '音楽スタイル',
    userPromptPriority: '入力プロンプト優先',
    generateSound: '音声を生成',
    topicVisualType: '映像タイプ',
    topicVisualVideos: 'AI 動画',
    topicVisualImages: 'AI モーション画像',
    voiceAndSubtitles: 'ナレーションと字幕',
    vocalMode: 'ボーカル設定',
    instrumental: 'インスト',
    withVocals: 'ボーカルあり',
    musicDuration: '曲の長さ',
    clip30s: '30秒クリップ',
    fullSong: 'フル楽曲',
    estimatedPrice: '概算料金',
    cancel: 'キャンセル',
    generating: '生成中…',
    generateVideo: '動画を生成',
    generateMusic: '音楽を生成',
    regenerate: '再生成',
    previewArea: 'プレビュー',
    zoomPreview: '拡大表示',
    zoomDetails: '詳細表示',
    revealInFolder: 'フォルダを開く',
    revealVideoInFolder: '動画の保存先フォルダを開く',
    revealAudioInFolder: '音声の保存先フォルダを開く',
    revealImageInFolder: '画像の保存先フォルダを開く',
    voiceModel: '音声モデル',
    visualSources: '映像ソース（複数選択可）',
    sourceOwn: '自分の素材',
    sourceOwnSub: 'ローカル画像 / 動画',
    sourceStock: 'フリー素材',
    sourceStockSub: 'Pexels · Pixabay',
    sourceAi: 'AI 生成',
    sourceAiSub: 'AI 画像 · AI 動画',
    stockKeySaved: 'API キーはシステムのキーチェーンに保存済みです',
    stockKeyChange: '変更',
    stockKeyPlaceholder: '{provider} API Key を貼り付け',
    stockGetKey: '無料でキーを取得',
    stockLicenseNote: 'Pexels / Pixabay の商用利用可能な素材を検索し、プロジェクトフォルダへ保存します。',
    noAiHintNote: '素材がないカットは空のまま残され、後から編集画面で追加できます。',
    enterEditor: '編集へ進む',
    emptyStageTitle: 'プレビューステージ',
    emptyStageHint: '生成が完了するとここで再生され、選択したフォルダに自動保存されます',
    regeneratingBanner: '新しいテイクを生成中…',
    playPause: '再生 / 一時停止',
    prevTake: '前へ',
    nextTake: '次へ',
    takesCount: '{count} 件'
};

const ko: StudioModalCopyTable = {
    ...en,
    titleImage: '이미지로 영상',
    titleTopic: '주제로 원클릭 영상',
    titleMusic: '음악 제작',
    projectTitlePlaceholder: '프로젝트 이름 (선택)',
    boundProjectBadge: '폴더 연결됨',
    close: '닫기',
    selectImages: '이미지 선택',
    dropImagesHint: '이미지를 여기에 놓거나 클릭하여 업로드',
    referenceAssetsOptional: '참고 소재 (선택)',
    localUpload: '로컬 업로드',
    assetLibrary: '소재 라이브러리',
    libraryEmpty: '라이브러리에 사용 가능한 소재가 없습니다',
    removeFile: '제거',
    videoModel: '영상 모델',
    modelSelection: '모델 선택',
    scriptModel: '원고 모델',
    visualModel: '화면 모델',
    musicModel: '음악 모델',
    prompt: '프롬프트',
    topicPrompt: '주제 또는 줄거리 설명',
    musicPrompt: '음악 프롬프트 / 가사 설명',
    songTitleOptional: '곡 제목 (선택)',
    durationSeconds: '길이 (초)',
    targetDuration: '목표 길이',
    secondsValue: '{n}초',
    aspectRatio: '화면 비율',
    visualStyle: '화면 스타일',
    musicStyle: '음악 스타일',
    userPromptPriority: '사용자 프롬프트 우선',
    generateSound: '사운드 생성',
    topicVisualType: '화면 유형',
    topicVisualVideos: 'AI 영상',
    topicVisualImages: 'AI 모션 이미지',
    voiceAndSubtitles: '내레이션 및 자막',
    vocalMode: '보컬 모드',
    instrumental: '연주곡',
    withVocals: '보컬 포함',
    musicDuration: '음악 길이',
    clip30s: '30초 클립',
    fullSong: '전체 곡',
    estimatedPrice: '예상 비용',
    cancel: '취소',
    generating: '생성 중…',
    generateVideo: '영상 생성',
    generateMusic: '음악 생성',
    regenerate: '다시 생성',
    previewArea: '미리보기',
    zoomPreview: '크게 보기',
    zoomDetails: '상세 보기',
    revealInFolder: '폴더에서 열기',
    revealVideoInFolder: '영상이 있는 폴더 열기',
    revealAudioInFolder: '오디오가 있는 폴더 열기',
    revealImageInFolder: '이미지가 있는 폴더 열기',
    voiceModel: '음성 모델',
    visualSources: '화면 소스 (다중 선택)',
    sourceOwn: '내 소재',
    sourceOwnSub: '로컬 이미지 / 영상',
    sourceStock: '웹 무료 소재',
    sourceStockSub: 'Pexels · Pixabay',
    sourceAi: 'AI 생성',
    sourceAiSub: 'AI 이미지 · AI 영상',
    stockKeySaved: 'API 키가 시스템 키체인에 저장되었습니다',
    stockKeyChange: '변경',
    stockKeyPlaceholder: '{provider} API Key 붙여넣기',
    stockGetKey: '무료 키 발급',
    stockLicenseNote: 'Pexels / Pixabay 무료 상업용 소재를 검색해 프로젝트 폴더로 바로 저장합니다.',
    noAiHintNote: '소재가 없는 컷은 비워 두며 나중에 편집에서 채울 수 있습니다.',
    enterEditor: '편집으로 이동',
    emptyStageTitle: '미리보기 스테이지',
    emptyStageHint: '생성이 완료되면 이곳에서 바로 재생되고 선택한 폴더에 자동 저장됩니다',
    regeneratingBanner: '새 버전 생성 중…',
    playPause: '재생 / 일시정지',
    prevTake: '이전',
    nextTake: '다음',
    takesCount: '{count}개 기록'
};

const es: StudioModalCopyTable = {
    ...en,
    titleImage: 'Imagen a vídeo',
    titleTopic: 'Tema a vídeo',
    titleMusic: 'Producción musical',
    close: 'Cerrar',
    selectImages: 'Seleccionar imagen',
    dropImagesHint: 'Arrastra una imagen aquí o haz clic para subir (PNG / JPG / WebP)',
    dropTopicFilesHint: 'Arrastra una imagen o vídeo de referencia aquí, o haz clic para añadir',
    localUpload: 'Subir archivo',
    assetLibrary: 'Biblioteca',
    videoModel: 'Modelo de vídeo',
    modelSelection: 'Modelos',
    scriptModel: 'Modelo de guion',
    visualModel: 'Modelo visual',
    musicModel: 'Modelo musical',
    prompt: 'Prompt',
    topicPrompt: 'Tema o descripción',
    musicPrompt: 'Prompt musical / letra',
    songTitleOptional: 'Título de la canción (opcional)',
    durationSeconds: 'Duración (s)',
    targetDuration: 'Duración objetivo',
    aspectRatio: 'Relación de aspecto',
    visualStyle: 'Estilo visual',
    musicStyle: 'Estilo musical',
    userPromptPriority: 'Prioridad a tu prompt',
    generateSound: 'Generar sonido',
    voiceAndSubtitles: 'Voz y subtítulos',
    vocalMode: 'Modo vocal',
    instrumental: 'Instrumental',
    withVocals: 'Con voz',
    musicDuration: 'Duración',
    clip30s: 'Clip 30s',
    fullSong: 'Canción completa',
    estimatedPrice: 'Precio estimado',
    cancel: 'Cancelar',
    generating: 'Generando…',
    generateVideo: 'Generar vídeo',
    generateMusic: 'Generar música',
    regenerate: 'Regenerar',
    previewArea: 'Vista previa',
    zoomPreview: 'Ampliar vista',
    revealInFolder: 'Mostrar en carpeta',
    revealVideoInFolder: 'Mostrar vídeo en carpeta',
    revealAudioInFolder: 'Mostrar audio en carpeta',
    revealImageInFolder: 'Mostrar imagen en carpeta',
    voiceModel: 'Modelo de voz',
    visualSources: 'Fuentes visuales (selección múltiple)',
    sourceOwn: 'Mis archivos',
    sourceOwnSub: 'Fotos y clips locales',
    sourceStock: 'Material web',
    sourceStockSub: 'Pexels · Pixabay',
    sourceAi: 'Generación IA',
    sourceAiSub: 'Imagen IA · Vídeo IA',
    stockKeySaved: 'Clave API guardada en el llavero del sistema',
    stockKeyChange: 'Cambiar',
    stockKeyPlaceholder: 'Pegar clave API de {provider}',
    stockGetKey: 'Obtener clave gratis',
    stockLicenseNote: 'Material libre de derechos de Pexels / Pixabay descargado directamente en tu carpeta.',
    noAiHintNote: 'Las tomas sin material quedarán vacías por ahora y podrás completarlas en el editor.',
    enterEditor: 'Ir al editor'
};

const fr: StudioModalCopyTable = {
    ...en,
    titleImage: 'Image en vidéo',
    titleTopic: 'Sujet en vidéo',
    titleMusic: 'Studio musical',
    close: 'Fermer',
    selectImages: 'Choisir une image',
    dropImagesHint: 'Déposez une image ici ou cliquez pour importer (PNG / JPG / WebP)',
    dropTopicFilesHint: 'Déposez une image ou un extrait de référence ici, ou cliquez pour ajouter',
    localUpload: 'Importer',
    assetLibrary: 'Bibliothèque',
    videoModel: 'Modèle vidéo',
    modelSelection: 'Modèles',
    scriptModel: 'Modèle de script',
    visualModel: 'Modèle visuel',
    musicModel: 'Modèle musical',
    prompt: 'Prompt',
    topicPrompt: 'Sujet ou scénario',
    musicPrompt: 'Prompt musical / paroles',
    songTitleOptional: 'Titre du morceau (optionnel)',
    durationSeconds: 'Durée (s)',
    targetDuration: 'Durée cible',
    aspectRatio: 'Format d’image',
    visualStyle: 'Style visuel',
    musicStyle: 'Style musical',
    userPromptPriority: 'Priorité à votre prompt',
    generateSound: 'Générer le son',
    voiceAndSubtitles: 'Voix off et sous-titres',
    vocalMode: 'Mode vocal',
    instrumental: 'Instrumental',
    withVocals: 'Avec voix',
    musicDuration: 'Durée musicale',
    clip30s: 'Extrait 30s',
    fullSong: 'Morceau complet',
    estimatedPrice: 'Coût estimé',
    cancel: 'Annuler',
    generating: 'Génération…',
    generateVideo: 'Générer la vidéo',
    generateMusic: 'Générer la musique',
    regenerate: 'Régénérer',
    previewArea: 'Aperçu',
    zoomPreview: 'Agrandir',
    revealInFolder: 'Afficher dans le dossier',
    revealVideoInFolder: 'Afficher la vidéo dans le dossier',
    revealAudioInFolder: 'Afficher l’audio dans le dossier',
    revealImageInFolder: 'Afficher l’image dans le dossier',
    voiceModel: 'Modèle vocal',
    visualSources: 'Sources visuelles (choix multiple)',
    sourceOwn: 'Mes médias',
    sourceOwnSub: 'Photos et vidéos locales',
    sourceStock: 'Banque libre',
    sourceStockSub: 'Pexels · Pixabay',
    sourceAi: 'Génération IA',
    sourceAiSub: 'Images IA · Vidéo IA',
    stockKeySaved: 'Clé API enregistrée dans le trousseau système',
    stockKeyChange: 'Modifier',
    stockKeyPlaceholder: 'Coller la clé API {provider}',
    stockGetKey: 'Obtenir une clé gratuite',
    stockLicenseNote: 'Médias libres de droits Pexels / Pixabay téléchargés directement dans le dossier du projet.',
    noAiHintNote: 'Les plans sans média resteront vides pour l’instant et pourront être complétés dans l’éditeur.',
    enterEditor: 'Ouvrir dans l’éditeur'
};

const de: StudioModalCopyTable = {
    ...en,
    titleImage: 'Bild zu Video',
    titleTopic: 'Thema zu Video',
    titleMusic: 'Musikproduktion',
    close: 'Schließen',
    selectImages: 'Bild auswählen',
    dropImagesHint: 'Bild hierher ziehen oder zum Hochladen klicken (PNG / JPG / WebP)',
    dropTopicFilesHint: 'Referenzbild oder Clip hierher ziehen oder zum Hinzufügen klicken',
    localUpload: 'Hochladen',
    assetLibrary: 'Mediathek',
    videoModel: 'Videomodell',
    modelSelection: 'Modelle',
    scriptModel: 'Skriptmodell',
    visualModel: 'Bildmodell',
    musicModel: 'Musikmodell',
    prompt: 'Prompt',
    topicPrompt: 'Thema oder Handlung',
    musicPrompt: 'Musik-Prompt / Songtext',
    songTitleOptional: 'Songtitel (optional)',
    durationSeconds: 'Dauer (Sek.)',
    targetDuration: 'Zieldauer',
    aspectRatio: 'Seitenverhältnis',
    visualStyle: 'Bildstil',
    musicStyle: 'Musikstil',
    userPromptPriority: 'Eigener Prompt hat Vorrang',
    generateSound: 'Ton generieren',
    voiceAndSubtitles: 'Stimme & Untertitel',
    vocalMode: 'Gesangsmodus',
    instrumental: 'Instrumental',
    withVocals: 'Mit Gesang',
    musicDuration: 'Songlänge',
    clip30s: '30s-Clip',
    fullSong: 'Ganzer Song',
    estimatedPrice: 'Geschätzter Preis',
    cancel: 'Abbrechen',
    generating: 'Wird erstellt…',
    generateVideo: 'Video erstellen',
    generateMusic: 'Musik erstellen',
    regenerate: 'Neu erstellen',
    previewArea: 'Vorschau',
    zoomPreview: 'Vergrößern',
    revealInFolder: 'Im Ordner anzeigen',
    revealVideoInFolder: 'Video im Ordner anzeigen',
    revealAudioInFolder: 'Audio im Ordner anzeigen',
    revealImageInFolder: 'Bild im Ordner anzeigen',
    voiceModel: 'Sprachmodell',
    visualSources: 'Bildquellen (Mehrfachauswahl)',
    sourceOwn: 'Eigene Medien',
    sourceOwnSub: 'Lokale Bilder & Clips',
    sourceStock: 'Stock-Medien',
    sourceStockSub: 'Pexels · Pixabay',
    sourceAi: 'KI-Generierung',
    sourceAiSub: 'KI-Bilder · KI-Video',
    stockKeySaved: 'API-Schlüssel im System-Schlüsselbund gespeichert',
    stockKeyChange: 'Ändern',
    stockKeyPlaceholder: '{provider} API-Schlüssel einfügen',
    stockGetKey: 'Kostenlosen Key holen',
    stockLicenseNote: 'Lizenzfreie Medien von Pexels / Pixabay werden direkt in den Projektordner geladen.',
    noAiHintNote: 'Einstellungen ohne passendes Material bleiben vorerst leer und können im Schnitt ergänzt werden.',
    enterEditor: 'Zum Schnitt'
};

const ptBR: StudioModalCopyTable = {
    ...en,
    titleImage: 'Imagem em vídeo',
    titleTopic: 'Tema em vídeo',
    titleMusic: 'Estúdio musical',
    close: 'Fechar',
    selectImages: 'Selecionar imagem',
    dropImagesHint: 'Arraste uma imagem aqui ou clique para enviar (PNG / JPG / WebP)',
    dropTopicFilesHint: 'Arraste uma imagem ou vídeo de referência aqui, ou clique para adicionar',
    localUpload: 'Enviar do computador',
    assetLibrary: 'Biblioteca',
    videoModel: 'Modelo de vídeo',
    modelSelection: 'Modelos',
    scriptModel: 'Modelo de roteiro',
    visualModel: 'Modelo visual',
    musicModel: 'Modelo de música',
    prompt: 'Prompt',
    topicPrompt: 'Tema ou descrição',
    musicPrompt: 'Prompt musical / letra',
    songTitleOptional: 'Nome da música (opcional)',
    durationSeconds: 'Duração (s)',
    targetDuration: 'Duração alvo',
    aspectRatio: 'Proporção',
    visualStyle: 'Estilo visual',
    musicStyle: 'Estilo musical',
    userPromptPriority: 'Seu prompt tem prioridade',
    generateSound: 'Gerar som',
    voiceAndSubtitles: 'Narração e legendas',
    vocalMode: 'Modo vocal',
    instrumental: 'Instrumental',
    withVocals: 'Com voz',
    musicDuration: 'Duração da faixa',
    clip30s: 'Trecho de 30s',
    fullSong: 'Música completa',
    estimatedPrice: 'Preço estimado',
    cancel: 'Cancelar',
    generating: 'Gerando…',
    generateVideo: 'Gerar vídeo',
    generateMusic: 'Gerar música',
    regenerate: 'Gerar novamente',
    previewArea: 'Pré-visualização',
    zoomPreview: 'Ampliar',
    revealInFolder: 'Mostrar na pasta',
    revealVideoInFolder: 'Mostrar vídeo na pasta',
    revealAudioInFolder: 'Mostrar áudio na pasta',
    revealImageInFolder: 'Mostrar imagem na pasta',
    voiceModel: 'Modelo de voz',
    visualSources: 'Fontes visuais (múltipla escolha)',
    sourceOwn: 'Meus arquivos',
    sourceOwnSub: 'Fotos e clipes locais',
    sourceStock: 'Banco de mídia',
    sourceStockSub: 'Pexels · Pixabay',
    sourceAi: 'Gerado por IA',
    sourceAiSub: 'Imagens IA · Vídeo IA',
    stockKeySaved: 'Chave de API salva nas chaves do sistema',
    stockKeyChange: 'Alterar',
    stockKeyPlaceholder: 'Colar chave de API {provider}',
    stockGetKey: 'Obter chave grátis',
    stockLicenseNote: 'Mídias gratuitas para uso comercial de Pexels / Pixabay baixadas na pasta do projeto.',
    noAiHintNote: 'Cenas sem mídia ficarão vazias por enquanto e poderão ser preenchidas na edição.',
    enterEditor: 'Ir para edição'
};

const ru: StudioModalCopyTable = {
    ...en,
    titleImage: 'Изображение в видео',
    titleTopic: 'Тема в видео',
    titleMusic: 'Создание музыки',
    close: 'Закрыть',
    selectImages: 'Выбрать изображение',
    dropImagesHint: 'Перетащите изображение сюда или нажмите для загрузки (PNG / JPG / WebP)',
    dropTopicFilesHint: 'Перетащите референсное изображение или видео сюда либо нажмите, чтобы добавить',
    localUpload: 'Загрузить файл',
    assetLibrary: 'Библиотека',
    videoModel: 'Видеомодель',
    modelSelection: 'Выбор моделей',
    scriptModel: 'Модель сценария',
    visualModel: 'Визуальная модель',
    musicModel: 'Музыкальная модель',
    prompt: 'Промпт',
    topicPrompt: 'Тема или сюжет',
    musicPrompt: 'Музыкальный промпт / текст',
    songTitleOptional: 'Название песни (необяз.)',
    durationSeconds: 'Длительность (с)',
    targetDuration: 'Целевая длина',
    aspectRatio: 'Соотношение сторон',
    visualStyle: 'Визуальный стиль',
    musicStyle: 'Музыкальный стиль',
    userPromptPriority: 'Приоритет вашего промпта',
    generateSound: 'Генерировать звук',
    voiceAndSubtitles: 'Озвучка и субтитры',
    vocalMode: 'Режим вокала',
    instrumental: 'Инструментал',
    withVocals: 'С вокалом',
    musicDuration: 'Длина трека',
    clip30s: 'Фрагмент 30с',
    fullSong: 'Полная песня',
    estimatedPrice: 'Оценка стоимости',
    cancel: 'Отмена',
    generating: 'Генерация…',
    generateVideo: 'Создать видео',
    generateMusic: 'Создать музыку',
    regenerate: 'Сгенерировать снова',
    previewArea: 'Предпросмотр',
    zoomPreview: 'Увеличить',
    revealInFolder: 'Показать в папке',
    revealVideoInFolder: 'Показать видео в папке',
    revealAudioInFolder: 'Показать аудио в папке',
    revealImageInFolder: 'Показать изображение в папке',
    voiceModel: 'Голосовая модель',
    visualSources: 'Источники кадров (мультивыбор)',
    sourceOwn: 'Мои материалы',
    sourceOwnSub: 'Локальные фото и видео',
    sourceStock: 'Стоковые медиа',
    sourceStockSub: 'Pexels · Pixabay',
    sourceAi: 'ИИ-генерация',
    sourceAiSub: 'ИИ-фото · ИИ-видео',
    stockKeySaved: 'API-ключ сохранён в системной связке ключей',
    stockKeyChange: 'Сменить',
    stockKeyPlaceholder: 'Вставьте API Key {provider}',
    stockGetKey: 'Получить ключ бесплатно',
    stockLicenseNote: 'Бесплатные материалы Pexels / Pixabay скачиваются прямо в папку проекта.',
    noAiHintNote: 'Кадры без материалов пока останутся пустыми — их можно дополнить при монтаже.',
    enterEditor: 'Перейти к монтажу'
};

const ar: StudioModalCopyTable = {
    ...en,
    titleImage: 'صورة إلى فيديو',
    titleTopic: 'موضوع إلى فيديو',
    titleMusic: 'إنتاج الموسيقى',
    close: 'إغلاق',
    selectImages: 'اختيار صورة',
    localUpload: 'رفع محلي',
    assetLibrary: 'مكتبة المواد',
    videoModel: 'نموذج الفيديو',
    modelSelection: 'اختيار النماذج',
    scriptModel: 'نموذج النص',
    visualModel: 'نموذج المشاهد',
    musicModel: 'نموذج الموسيقى',
    prompt: 'الموجّه',
    topicPrompt: 'وصف الموضوع أو القصة',
    musicPrompt: 'موجّه الموسيقى / الكلمات',
    songTitleOptional: 'اسم الأغنية (اختياري)',
    durationSeconds: 'المدة (ث)',
    targetDuration: 'المدة المستهدفة',
    aspectRatio: 'نسبة الأبعاد',
    visualStyle: 'النمط البصري',
    musicStyle: 'النمط الموسيقي',
    userPromptPriority: 'الأولوية لوصفك',
    generateSound: 'توليد الصوت',
    voiceAndSubtitles: 'التعليق والترجمة',
    vocalMode: 'وضع الغناء',
    instrumental: 'موسيقى فقط',
    withVocals: 'مع غناء',
    musicDuration: 'مدة المقطع',
    clip30s: 'مقطع 30ث',
    fullSong: 'أغنية كاملة',
    estimatedPrice: 'التكلفة التقديرية',
    cancel: 'إلغاء',
    generating: 'جارٍ الإنشاء…',
    generateVideo: 'إنشاء فيديو',
    generateMusic: 'إنشاء موسيقى',
    regenerate: 'إعادة الإنشاء',
    previewArea: 'منطقة المعاينة',
    zoomPreview: 'تكبير المعاينة',
    revealInFolder: 'إظهار في المجلد',
    revealVideoInFolder: 'إظهار الفيديو في المجلد',
    revealAudioInFolder: 'إظهار الصوت في المجلد',
    revealImageInFolder: 'إظهار الصورة في المجلد',
    voiceModel: 'نموذج الصوت',
    visualSources: 'مصادر المشاهد (متعدد)',
    sourceOwn: 'وسائطي',
    sourceOwnSub: 'صور ومقاطع محلية',
    sourceStock: 'مكتبة مجانية',
    sourceStockSub: 'Pexels · Pixabay',
    sourceAi: 'توليد بالذكاء الاصطناعي',
    sourceAiSub: 'صور ذكية · فيديو ذكي',
    stockKeySaved: 'تم حفظ مفتاح API في سلسلة مفاتيح النظام',
    stockKeyChange: 'تغيير',
    stockKeyPlaceholder: 'الصق مفتاح API لـ {provider}',
    stockGetKey: 'احصل على مفتاح مجاني',
    stockLicenseNote: 'تُحمَّل الوسائط المجانية من Pexels / Pixabay مباشرة إلى مجلد المشروع.',
    noAiHintNote: 'المشاهد التي بلا وسائط ستبقى فارغة مؤقتاً ويمكن إكمالها في المونتاج.',
    enterEditor: 'الدخول إلى المونتاج'
};

const hi: StudioModalCopyTable = {
    ...en,
    titleImage: 'चित्र से वीडियो',
    titleTopic: 'विषय से वीडियो',
    titleMusic: 'संगीत निर्माण',
    close: 'बंद करें',
    selectImages: 'चित्र चुनें',
    localUpload: 'लोकल अपलोड',
    assetLibrary: 'सामग्री लाइब्रेरी',
    videoModel: 'वीडियो मॉडल',
    modelSelection: 'मॉडल चयन',
    scriptModel: 'स्क्रिप्ट मॉडल',
    visualModel: 'विज़ुअल मॉडल',
    musicModel: 'संगीत मॉडल',
    prompt: 'प्रॉम्प्ट',
    topicPrompt: 'विषय या कहानी विवरण',
    musicPrompt: 'संगीत प्रॉम्प्ट / बोल',
    songTitleOptional: 'गीत का नाम (वैकल्पिक)',
    durationSeconds: 'अवधि (सेकंड)',
    targetDuration: 'लक्षित अवधि',
    aspectRatio: 'आस्पेक्ट रेशियो',
    visualStyle: 'दृश्य शैली',
    musicStyle: 'संगीत शैली',
    userPromptPriority: 'आपका प्रॉम्प्ट प्राथमिकता पर',
    generateSound: 'ध्वनि बनाएँ',
    voiceAndSubtitles: 'आवाज़ और उपशीर्षक',
    vocalMode: 'वोकल मोड',
    instrumental: 'इंस्ट्रूमेंटल',
    withVocals: 'वोकल सहित',
    musicDuration: 'संगीत अवधि',
    clip30s: '30 सेकंड क्लिप',
    fullSong: 'पूरा गीत',
    estimatedPrice: 'अनुमानित मूल्य',
    cancel: 'रद्द करें',
    generating: 'बन रहा है…',
    generateVideo: 'वीडियो बनाएँ',
    generateMusic: 'संगीत बनाएँ',
    regenerate: 'पुनः बनाएँ',
    previewArea: 'प्रीव्यू मंच',
    zoomPreview: 'बड़ा प्रीव्यू',
    revealInFolder: 'फ़ोल्डर में दिखाएँ',
    revealVideoInFolder: 'वीडियो का फ़ोल्डर खोलें',
    revealAudioInFolder: 'ऑडियो का फ़ोल्डर खोलें',
    revealImageInFolder: 'चित्र का फ़ोल्डर खोलें',
    voiceModel: 'वॉइस मॉडल',
    visualSources: 'दृश्य स्रोत (एकाधिक चयन)',
    sourceOwn: 'मेरी सामग्री',
    sourceOwnSub: 'लोकल फ़ोटो और क्लिप',
    sourceStock: 'वेब स्टॉक मीडिया',
    sourceStockSub: 'Pexels · Pixabay',
    sourceAi: 'AI जनरेटेड',
    sourceAiSub: 'AI चित्र · AI वीडियो',
    stockKeySaved: 'API कुंजी सिस्टम कीचेन में सहेजी गई है',
    stockKeyChange: 'बदलें',
    stockKeyPlaceholder: '{provider} API Key पेस्ट करें',
    stockGetKey: 'मुफ़्त Key प्राप्त करें',
    stockLicenseNote: 'Pexels / Pixabay से निःशुल्क व्यावसायिक मीडिया सीधे आपके प्रोजेक्ट फ़ोल्डर में डाउनलोड होता है।',
    noAiHintNote: 'बिना मीडिया वाले शॉट अभी खाली रहेंगे और बाद में एडिटर में भरे जा सकते हैं।',
    enterEditor: 'एडिटर में खोलें'
};

const STUDIO_MODAL_TABLES: Readonly<Record<NextMuxDesktopLocale, StudioModalCopyTable>> = {
    'zh-CN': zhCN,
    'zh-TW': zhTW,
    en,
    ja,
    ko,
    es,
    fr,
    de,
    'pt-BR': ptBR,
    ru,
    ar,
    hi
};

function uncheckedComicStudioModalText(
    locale: NextMuxDesktopLocale,
    key: StudioModalTextKey,
    values: Readonly<Record<string, string | number>> = {}
): string {
    const table = STUDIO_MODAL_TABLES[locale] ?? en;
    return (table[key] ?? en[key]).replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? ''));
}

export function comicStudioModalText(
    locale: Parameters<typeof uncheckedComicStudioModalText>[0],
    key: Parameters<typeof uncheckedComicStudioModalText>[1],
    ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedComicStudioModalText>>
): string {
    return totalCopy(locale, key, language => uncheckedComicStudioModalText(language, key, ...rest));
}

function formatMediaClock(secondsInput: number | undefined): string {
    const safe = Number.isFinite(secondsInput) && (secondsInput ?? 0) > 0 ? Math.floor(secondsInput as number) : 0;
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

interface StudioContextMenuState {
    readonly x: number;
    readonly y: number;
    readonly takeId: string;
    readonly filePath: string;
    readonly mediaKind: 'video' | 'audio' | 'image';
}

export function ComicMediaStudioModal(props: ComicMediaStudioModalProps): React.ReactElement | null {
    const t = (key: StudioModalTextKey, values?: Readonly<Record<string, string | number>>): string =>
        comicStudioModalText(props.locale, key, values);

    const [draggingFiles, setDraggingFiles] = React.useState(false);
    const [showLibrary, setShowLibrary] = React.useState(false);
    const [showTopicAssets, setShowTopicAssets] = React.useState(false);
    const [contextMenu, setContextMenu] = React.useState<StudioContextMenuState | undefined>(undefined);
    const [lightboxOpen, setLightboxOpen] = React.useState(false);
    const [sourceZoomItem, setSourceZoomItem] = React.useState<{
        readonly id?: string;
        readonly path?: string;
        readonly title: string;
        readonly kind: 'image' | 'video';
        readonly url: string;
    } | null>(null);
    const [sourceZoomAspectRatio, setSourceZoomAspectRatio] = React.useState<number | undefined>(undefined);
    const [isLightTheme, setIsLightTheme] = React.useState(() => {
        if (typeof props.isLightTheme === 'boolean') {
            return props.isLightTheme;
        }
        if (typeof document !== 'undefined') {
            return Boolean(
                document.querySelector(
                    '.nmx-shell.nmx-theme-light, .nmx-desktop-widget.nmx-theme-light, body.nmx-theme-light'
                )
            );
        }
        return false;
    });

    // Media playback state for active take
    const videoRef = React.useRef<HTMLVideoElement | null>(null);
    const audioRef = React.useRef<HTMLAudioElement | null>(null);
    const lightboxVideoRef = React.useRef<HTMLVideoElement | null>(null);
    const lightboxAudioRef = React.useRef<HTMLAudioElement | null>(null);
    const stageResumeTimeRef = React.useRef<number>(0);
    const pendingAutoPlayTakeIdRef = React.useRef<string | undefined>(undefined);
    const fileInputRef = React.useRef<HTMLInputElement | null>(null);
    const filmstripRef = React.useRef<HTMLDivElement | null>(null);
    const wheelAccumRef = React.useRef<number>(0);
    const wheelLastResetRef = React.useRef<number>(0);
    const lightboxBackdropDownRef = React.useRef(false);
    const sourceLightboxBackdropDownRef = React.useRef(false);
    const sourceZoomMediaStateRef = React.useRef<{
        restoredUrl: string;
        currentTime: number;
        volume: number;
        muted: boolean;
    }>({ restoredUrl: '', currentTime: 0, volume: 1, muted: false });

    const closeSourceZoom = React.useCallback((): void => {
        sourceLightboxBackdropDownRef.current = false;
        sourceZoomMediaStateRef.current = { restoredUrl: '', currentTime: 0, volume: 1, muted: false };
        setSourceZoomItem(null);
        setSourceZoomAspectRatio(undefined);
    }, []);

    const [isPlaying, setIsPlaying] = React.useState(false);
    const [currentTime, setCurrentTime] = React.useState(0);
    const [duration, setDuration] = React.useState(0);
    const [muted, setMuted] = React.useState(false);
    const [volume, setVolume] = React.useState(0.9);

    const activeIndex = React.useMemo(() => {
        if (props.takes.length === 0) {
            return -1;
        }
        if (props.activeTakeId) {
            const idx = props.takes.findIndex(item => item.id === props.activeTakeId);
            if (idx >= 0) {
                return idx;
            }
        }
        return 0;
    }, [props.takes, props.activeTakeId]);

    const activeTake: ComicStudioGeneratedTake | undefined =
        activeIndex >= 0 ? props.takes[activeIndex] : undefined;

    const isImageStage = activeTake?.kind === 'image';
    const isAudioStage =
        !isImageStage && (activeTake?.kind === 'audio' || (props.kind === 'music' && activeTake?.kind !== 'video'));
    const isVideoStage = Boolean(activeTake && !isImageStage && !isAudioStage);

    const effectiveTopicSources = React.useMemo(() => {
        if (props.topicSources) {
            return props.topicSources;
        }
        return {
            own: props.sourceFiles.length > 0 || showTopicAssets,
            stock: false,
            ai: true
        };
    }, [props.topicSources, props.sourceFiles.length, showTopicAssets]);

    const openLightbox = React.useCallback(
        (targetTakeId?: string): void => {
            const switching = Boolean(targetTakeId && targetTakeId !== activeTake?.id);
            if (switching && targetTakeId) {
                stageResumeTimeRef.current = 0;
                props.onSelectTake(targetTakeId);
            } else {
                const stageTime = isAudioStage
                    ? audioRef.current?.currentTime
                    : isVideoStage
                      ? videoRef.current?.currentTime
                      : 0;
                stageResumeTimeRef.current =
                    typeof stageTime === 'number' && Number.isFinite(stageTime) && stageTime > 0 ? stageTime : 0;
            }
            if (videoRef.current && !videoRef.current.paused) {
                videoRef.current.pause();
            }
            if (audioRef.current && !audioRef.current.paused) {
                audioRef.current.pause();
            }
            setIsPlaying(false);
            setLightboxOpen(true);
        },
        [activeTake?.id, isAudioStage, isVideoStage, props.onSelectTake]
    );

    const closeLightbox = React.useCallback((): void => {
        const latestTime =
            lightboxAudioRef.current?.currentTime ??
            lightboxVideoRef.current?.currentTime ??
            stageResumeTimeRef.current;
        if (lightboxVideoRef.current && !lightboxVideoRef.current.paused) {
            lightboxVideoRef.current.pause();
        }
        if (lightboxAudioRef.current && !lightboxAudioRef.current.paused) {
            lightboxAudioRef.current.pause();
        }
        setLightboxOpen(false);
        if (typeof latestTime === 'number' && Number.isFinite(latestTime) && latestTime >= 0) {
            stageResumeTimeRef.current = latestTime;
            setCurrentTime(latestTime);
            const targetMedia = isAudioStage ? audioRef.current : isVideoStage ? videoRef.current : null;
            if (targetMedia) {
                try {
                    targetMedia.currentTime = latestTime;
                } catch {
                    // Ignore seek error when stage media metadata has not loaded yet
                }
            }
        }
    }, [isAudioStage, isVideoStage]);

    React.useEffect(() => {
        if (!props.open) {
            setContextMenu(undefined);
            setLightboxOpen(false);
            closeSourceZoom();
            setDraggingFiles(false);
            return;
        }
        if (typeof props.isLightTheme === 'boolean') {
            setIsLightTheme(props.isLightTheme);
            return;
        }
        if (typeof document === 'undefined') {
            return;
        }
        const syncThemeFromDom = (): void => {
            const lightHost = document.querySelector(
                '.nmx-shell.nmx-theme-light, .nmx-desktop-widget.nmx-theme-light, body.nmx-theme-light'
            );
            setIsLightTheme(Boolean(lightHost));
        };
        syncThemeFromDom();
        if (typeof MutationObserver === 'undefined') {
            return;
        }
        const observer = new MutationObserver(() => syncThemeFromDom());
        const targets = new Set<Element>(
            Array.from(document.querySelectorAll('.nmx-shell, .nmx-desktop-widget'))
        );
        if (document.body) {
            targets.add(document.body);
        }
        if (document.documentElement) {
            targets.add(document.documentElement);
        }
        for (const target of targets) {
            observer.observe(target, { attributes: true, attributeFilter: ['class'] });
        }
        return () => observer.disconnect();
    }, [props.open, props.isLightTheme]);

    React.useEffect(() => {
        if (props.sourceFiles.length > 0) {
            setShowLibrary(false);
            if (props.kind === 'topic') {
                setShowTopicAssets(true);
            }
        }
    }, [props.sourceFiles.length, props.kind]);

    // Reset transient playback readout when switching active take
    React.useEffect(() => {
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(activeTake?.durationSeconds ?? 0);
    }, [activeTake?.id, activeTake?.mediaUrl, activeTake?.durationSeconds]);

    // Keep <audio> element volume and mute state synchronized with React state
    React.useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = muted ? 0 : volume;
            audioRef.current.muted = muted;
        }
        if (lightboxAudioRef.current) {
            lightboxAudioRef.current.volume = muted ? 0 : volume;
            lightboxAudioRef.current.muted = muted;
        }
    }, [activeTake?.id, activeTake?.mediaUrl, volume, muted, lightboxOpen]);

    // Honor pending play triggered from context menu on a non-active take
    React.useEffect(() => {
        if (!activeTake || pendingAutoPlayTakeIdRef.current !== activeTake.id) {
            return;
        }
        pendingAutoPlayTakeIdRef.current = undefined;
        const media = isAudioStage ? audioRef.current : isVideoStage ? videoRef.current : null;
        if (media) {
            const promise = media.play();
            if (promise && typeof promise.catch === 'function') {
                promise.catch(() => undefined);
            }
        }
    }, [activeTake?.id, isAudioStage, isVideoStage]);

    // Scroll active take card smoothly into view in filmstrip
    React.useEffect(() => {
        if (!props.open || !activeTake || !filmstripRef.current) {
            return;
        }
        const escapedId = activeTake.id.replace(/["\\]/g, '\\$&');
        const card = filmstripRef.current.querySelector<HTMLElement>(`[data-take-id="${escapedId}"]`);
        if (card && typeof card.scrollIntoView === 'function') {
            card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }, [props.open, activeTake?.id]);

    // Close context menu on outside pointerdown or scroll; handle Escape hierarchy cleanly in capture phase
    React.useEffect(() => {
        if (!props.open || typeof document === 'undefined') {
            return;
        }
        const onPointerDown = (event: PointerEvent): void => {
            if (!contextMenu) {
                return;
            }
            const target = event.target as Element | null;
            if (!target?.closest('.nmx-comic-studio-context-menu')) {
                setContextMenu(undefined);
            }
        };
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key !== 'Escape' || event.isComposing) {
                return;
            }
            if (contextMenu) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                setContextMenu(undefined);
                return;
            }
            if (sourceZoomItem) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                closeSourceZoom();
                return;
            }
            if (lightboxOpen) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                closeLightbox();
                return;
            }
            // Do not hijack Escape if an open model/relay popover exists in the document
            if (
                document.querySelector(
                    '.nmx-studio-isolated-picker-portal, .nmx-model-picker-popover, .nmx-relay-popover, .nmx-comic-chat-popover'
                )
            ) {
                return;
            }
            if (props.generating) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            props.onClose();
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            window.removeEventListener('keydown', onKeyDown, true);
        };
    }, [props.open, props.generating, props.onClose, contextMenu, sourceZoomItem, closeSourceZoom, lightboxOpen, closeLightbox]);

    if (!props.open) {
        return null;
    }

    const modalTitle =
        props.kind === 'image' ? t('titleImage') : props.kind === 'topic' ? t('titleTopic') : t('titleMusic');
    const ratioChoices =
        props.aspectRatioOptions && props.aspectRatioOptions.length > 0
            ? props.aspectRatioOptions
            : DEFAULT_ASPECT_RATIOS;
    const visualPresets = COMIC_VISUAL_STYLE_PRESETS;
    const musicPresets = COMIC_MUSIC_STYLE_PRESETS;
    const hasActiveStylePreset = Boolean(props.stylePresetId && props.stylePresetId !== 'none');

    const filteredLibraryItems = (props.libraryItems ?? []).filter(item =>
        props.kind === 'image' ? item.kind === 'image' : item.kind === 'image' || item.kind === 'video'
    );

    const isLibraryItemSelected = (item: ComicCreationLibraryItem): boolean =>
        Boolean(
            props.selectedLibraryIds?.has(item.id) ||
                props.selectedLibraryIds?.has(item.path) ||
                props.sourceFiles.some(file => file.id === item.id || (Boolean(file.path) && file.path === item.path))
        );

    const triggerLocalPick = (): void => {
        if (props.onPickLocalFiles) {
            props.onPickLocalFiles();
            return;
        }
        fileInputRef.current?.click();
    };

    const handleDrop = (event: React.DragEvent<HTMLElement>): void => {
        event.preventDefault();
        event.stopPropagation();
        setDraggingFiles(false);
        if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
            props.onDropLocalFiles?.(event.dataTransfer.files);
        }
    };

    const stepTake = (delta: -1 | 1): void => {
        if (props.takes.length <= 1 || activeIndex < 0) {
            return;
        }
        const nextIndex = Math.max(0, Math.min(props.takes.length - 1, activeIndex + delta));
        if (nextIndex !== activeIndex) {
            props.onSelectTake(props.takes[nextIndex].id);
        }
    };

    const handleFilmstripWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
        const container = filmstripRef.current;
        const useVertical = Math.abs(event.deltaY) >= Math.abs(event.deltaX);
        const delta = useVertical ? event.deltaY : event.deltaX;
        if (!delta) {
            return;
        }
        if (container && useVertical) {
            container.scrollLeft += event.deltaY;
        }
        if (props.takes.length > 1) {
            const now = Date.now();
            if (now - wheelLastResetRef.current > 320) {
                wheelAccumRef.current = 0;
            }
            wheelLastResetRef.current = now;
            wheelAccumRef.current += delta;
            if (Math.abs(wheelAccumRef.current) >= 40) {
                const direction: -1 | 1 = wheelAccumRef.current > 0 ? 1 : -1;
                wheelAccumRef.current = 0;
                stepTake(direction);
            }
        }
    };

    const openTakeContextMenu = (
        event: React.MouseEvent<HTMLElement>,
        take: ComicStudioGeneratedTake
    ): void => {
        event.preventDefault();
        event.stopPropagation();
        const maxW = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const maxH = typeof window !== 'undefined' ? window.innerHeight : 800;
        const x = Math.max(8, Math.min(event.clientX, maxW - 228));
        const y = Math.max(8, Math.min(event.clientY, maxH - 148));
        const mediaKind: 'video' | 'audio' | 'image' =
            take.kind === 'image'
                ? 'image'
                : take.kind === 'audio' || (props.kind === 'music' && take.kind !== 'video')
                  ? 'audio'
                  : 'video';
        setContextMenu({
            x,
            y,
            takeId: take.id,
            filePath: take.filePath,
            mediaKind
        });
    };

    const toggleActivePlayback = (): void => {
        if (!activeTake || isImageStage) {
            return;
        }
        const media = isAudioStage ? audioRef.current : videoRef.current;
        if (!media) {
            return;
        }
        if (media.paused) {
            const promise = media.play();
            if (promise && typeof promise.catch === 'function') {
                promise.catch(() => undefined);
            }
        } else {
            media.pause();
        }
    };

    const toggleAudioMute = (): void => {
        const nextMuted = !muted;
        setMuted(nextMuted);
        if (audioRef.current) {
            audioRef.current.muted = nextMuted;
        }
        if (lightboxAudioRef.current) {
            lightboxAudioRef.current.muted = nextMuted;
        }
    };

    const changeAudioVolume = (nextVolume: number): void => {
        const clamped = Math.max(0, Math.min(1, nextVolume));
        setVolume(clamped);
        if (clamped > 0 && muted) {
            setMuted(false);
        }
        if (audioRef.current) {
            audioRef.current.volume = clamped;
            if (clamped > 0) {
                audioRef.current.muted = false;
            }
        }
        if (lightboxAudioRef.current) {
            lightboxAudioRef.current.volume = clamped;
            if (clamped > 0) {
                lightboxAudioRef.current.muted = false;
            }
        }
    };

    const knownAudioDuration =
        duration > 0
            ? duration
            : activeTake?.durationSeconds && activeTake.durationSeconds > 0
              ? activeTake.durationSeconds
              : 0;
    const sliderMaxDuration = knownAudioDuration > 0 ? knownAudioDuration : Math.max(1, Math.ceil(currentTime));

    const seekAudio = (nextTime: number): void => {
        const liveDur =
            knownAudioDuration > 0
                ? knownAudioDuration
                : audioRef.current?.duration && Number.isFinite(audioRef.current.duration) && audioRef.current.duration > 0
                  ? audioRef.current.duration
                  : Math.max(nextTime, 1);
        const clamped = Math.max(0, Math.min(liveDur, nextTime));
        setCurrentTime(clamped);
        if (audioRef.current) {
            try {
                audioRef.current.currentTime = clamped;
            } catch {
                // Ignore seek error when media metadata has not loaded yet
            }
        }
    };

    const renderSourceActionsAndLibrary = (closeLibraryOnPick: boolean): React.ReactElement => (
        <>
            <div className='nmx-comic-studio-source-actions'>
                <button
                    type='button'
                    className='nmx-comic-studio-ghost-btn'
                    disabled={props.generating}
                    onClick={triggerLocalPick}
                >
                    <i className='codicon codicon-folder-opened' aria-hidden='true' />
                    <span>{t('localUpload')}</span>
                </button>
                {(props.libraryItems !== undefined || props.onToggleLibraryItem !== undefined) && (
                    <button
                        type='button'
                        className={`nmx-comic-studio-ghost-btn${showLibrary ? ' is-active' : ''}`}
                        disabled={props.generating}
                        aria-expanded={showLibrary}
                        onClick={() => setShowLibrary(current => !current)}
                    >
                        <i className='codicon codicon-library' aria-hidden='true' />
                        <span>{t('assetLibrary')}</span>
                        {filteredLibraryItems.length > 0 && <b data-nmx-literal>{filteredLibraryItems.length}</b>}
                    </button>
                )}
            </div>
            {showLibrary && (
                <div className='nmx-comic-studio-lib-drawer'>
                    {filteredLibraryItems.length === 0 ? (
                        <p className='nmx-comic-studio-lib-empty'>{t('libraryEmpty')}</p>
                    ) : (
                        <div className='nmx-comic-studio-lib-grid' role='list'>
                            {filteredLibraryItems.map(item => {
                                const selected = isLibraryItemSelected(item);
                                return (
                                    <button
                                        key={item.id}
                                        type='button'
                                        role='listitem'
                                        className={`nmx-comic-studio-lib-item${selected ? ' is-selected' : ''}`}
                                        title={item.name}
                                        onClick={() => {
                                            props.onToggleLibraryItem?.(item);
                                            if (closeLibraryOnPick) {
                                                setShowLibrary(false);
                                            }
                                        }}
                                    >
                                        <span className='nmx-comic-studio-lib-thumb'>
                                            {item.kind === 'image' && item.previewUrl ? (
                                                <img src={item.previewUrl} alt='' loading='lazy' draggable={false} />
                                            ) : item.kind === 'video' && item.previewUrl ? (
                                                <video src={item.previewUrl} muted preload='metadata' />
                                            ) : (
                                                <i
                                                    className={`codicon codicon-${item.kind === 'video' ? 'device-camera-video' : 'file-media'}`}
                                                    aria-hidden='true'
                                                />
                                            )}
                                            {selected && (
                                                <em className='nmx-comic-studio-lib-check' aria-hidden='true'>
                                                    <i className='codicon codicon-check' />
                                                </em>
                                            )}
                                            {(item.kind === 'image' || item.kind === 'video') && item.previewUrl && (
                                                <span
                                                    role='button'
                                                    tabIndex={0}
                                                    className='nmx-comic-studio-lib-zoom'
                                                    title={t('zoomPreview')}
                                                    aria-label={t('zoomPreview')}
                                                    onPointerDown={event => event.stopPropagation()}
                                                    onMouseDown={event => event.stopPropagation()}
                                                    onClick={event => {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        const thumbVideo =
                                                            item.kind === 'video'
                                                                ? event.currentTarget.parentElement?.querySelector('video')
                                                                : null;
                                                        const ar =
                                                            thumbVideo && thumbVideo.videoWidth > 0 && thumbVideo.videoHeight > 0
                                                                ? thumbVideo.videoWidth / thumbVideo.videoHeight
                                                                : undefined;
                                                        sourceZoomMediaStateRef.current = {
                                                            restoredUrl: '',
                                                            currentTime: 0,
                                                            volume: 1,
                                                            muted: false
                                                        };
                                                        setSourceZoomAspectRatio(ar);
                                                        setSourceZoomItem({
                                                            id: item.id,
                                                            path: item.path,
                                                            title: item.name,
                                                            kind: item.kind === 'video' ? 'video' : 'image',
                                                            url: item.previewUrl || ''
                                                        });
                                                    }}
                                                    onKeyDown={event => {
                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                            event.preventDefault();
                                                            event.stopPropagation();
                                                            const thumbVideo =
                                                                item.kind === 'video'
                                                                    ? event.currentTarget.parentElement?.querySelector('video')
                                                                    : null;
                                                            const ar =
                                                                thumbVideo && thumbVideo.videoWidth > 0 && thumbVideo.videoHeight > 0
                                                                    ? thumbVideo.videoWidth / thumbVideo.videoHeight
                                                                    : undefined;
                                                            sourceZoomMediaStateRef.current = {
                                                                restoredUrl: '',
                                                                currentTime: 0,
                                                                volume: 1,
                                                                muted: false
                                                            };
                                                            setSourceZoomAspectRatio(ar);
                                                            setSourceZoomItem({
                                                                id: item.id,
                                                                path: item.path,
                                                                title: item.name,
                                                                kind: item.kind === 'video' ? 'video' : 'image',
                                                                url: item.previewUrl || ''
                                                            });
                                                        }
                                                    }}
                                                >
                                                    <i className='codicon codicon-screen-full' aria-hidden='true' />
                                                </span>
                                            )}
                                        </span>
                                        <small data-nmx-literal>{item.name}</small>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </>
    );

    const renderSourcePickerBlock = (mode: 'image' | 'topic'): React.ReactElement => {
        const accept = mode === 'image' ? 'image/png,image/jpeg,image/webp,image/bmp' : 'image/*,video/*';
        const activeSource = props.sourceFiles[0];
        return (
            <div className='nmx-comic-studio-source-block'>
                <input
                    ref={fileInputRef}
                    type='file'
                    accept={accept}
                    className='nmx-comic-studio-hidden-file'
                    tabIndex={-1}
                    onChange={event => {
                        if (event.currentTarget.files && event.currentTarget.files.length > 0) {
                            props.onDropLocalFiles?.(event.currentTarget.files);
                            event.currentTarget.value = '';
                        }
                    }}
                />
                {!activeSource ? (
                    <>
                        <div
                            className={`nmx-comic-studio-dropzone${draggingFiles ? ' is-dragging' : ''}`}
                            onDragOver={event => {
                                event.preventDefault();
                                setDraggingFiles(true);
                            }}
                            onDragLeave={() => setDraggingFiles(false)}
                            onDrop={handleDrop}
                            onClick={triggerLocalPick}
                            role='button'
                            tabIndex={0}
                            onKeyDown={event => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    triggerLocalPick();
                                }
                            }}
                        >
                            <i className='codicon codicon-cloud-upload' aria-hidden='true' />
                            <span>{mode === 'image' ? t('dropImagesHint') : t('dropTopicFilesHint')}</span>
                        </div>
                        {renderSourceActionsAndLibrary(true)}
                    </>
                ) : (
                    <div className='nmx-comic-studio-dropzone-preview' data-source-kind={activeSource.kind}>
                        <div
                            className={`nmx-comic-studio-dropzone-media${(activeSource.kind === 'image' || activeSource.kind === 'video') && activeSource.previewUrl ? ' is-zoomable' : ''}`}
                            onClick={
                                (activeSource.kind === 'image' || activeSource.kind === 'video') && activeSource.previewUrl
                                    ? event => {
                                          const previewVideo =
                                              activeSource.kind === 'video'
                                                  ? event.currentTarget.querySelector('video')
                                                  : null;
                                          const ar =
                                              previewVideo && previewVideo.videoWidth > 0 && previewVideo.videoHeight > 0
                                                  ? previewVideo.videoWidth / previewVideo.videoHeight
                                                  : undefined;
                                          sourceZoomMediaStateRef.current = {
                                              restoredUrl: '',
                                              currentTime: 0,
                                              volume: 1,
                                              muted: false
                                          };
                                          setSourceZoomAspectRatio(ar);
                                          setSourceZoomItem({
                                              id: activeSource.id,
                                              path: activeSource.path,
                                              title: activeSource.name,
                                              kind: activeSource.kind as 'image' | 'video',
                                              url: activeSource.previewUrl!
                                          });
                                      }
                                    : undefined
                            }
                        >
                            {activeSource.kind === 'image' && activeSource.previewUrl ? (
                                <img src={activeSource.previewUrl} alt={activeSource.name} draggable={false} />
                            ) : activeSource.kind === 'video' && activeSource.previewUrl ? (
                                <video src={activeSource.previewUrl} muted playsInline preload='metadata' />
                            ) : (
                                <div className='nmx-comic-studio-dropzone-fallback'>
                                    <i
                                        className={`codicon codicon-${activeSource.kind === 'video' ? 'device-camera-video' : activeSource.kind === 'audio' ? 'music' : 'file-media'}`}
                                        aria-hidden='true'
                                    />
                                </div>
                            )}
                        </div>
                        <div className='nmx-comic-studio-dropzone-caption' title={activeSource.name}>
                            <span data-nmx-literal>{activeSource.name}</span>
                        </div>
                        {(activeSource.kind === 'image' || activeSource.kind === 'video') && activeSource.previewUrl && (
                            <button
                                type='button'
                                className={`nmx-comic-studio-dropzone-zoom nmx-comic-studio-lib-zoom${props.onRemoveSourceFile ? ' has-remove' : ''}`}
                                aria-label={t('zoomPreview')}
                                title={t('zoomPreview')}
                                onPointerDown={event => event.stopPropagation()}
                                onMouseDown={event => event.stopPropagation()}
                                onClick={event => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    const previewVideo =
                                        activeSource.kind === 'video'
                                            ? event.currentTarget.parentElement?.querySelector('video')
                                            : null;
                                    const ar =
                                        previewVideo && previewVideo.videoWidth > 0 && previewVideo.videoHeight > 0
                                            ? previewVideo.videoWidth / previewVideo.videoHeight
                                            : undefined;
                                    sourceZoomMediaStateRef.current = {
                                        restoredUrl: '',
                                        currentTime: 0,
                                        volume: 1,
                                        muted: false
                                    };
                                    setSourceZoomAspectRatio(ar);
                                    setSourceZoomItem({
                                        id: activeSource.id,
                                        path: activeSource.path,
                                        title: activeSource.name,
                                        kind: activeSource.kind as 'image' | 'video',
                                        url: activeSource.previewUrl!
                                    });
                                }}
                            >
                                <i className='codicon codicon-screen-full' aria-hidden='true' />
                            </button>
                        )}
                        {props.onRemoveSourceFile && (
                            <button
                                type='button'
                                className='nmx-comic-studio-dropzone-remove'
                                aria-label={`${t('removeFile')} ${activeSource.name}`}
                                title={t('removeFile')}
                                disabled={props.generating}
                                onClick={event => {
                                    event.stopPropagation();
                                    props.onRemoveSourceFile?.(activeSource.id);
                                }}
                            >
                                <i className='codicon codicon-close' aria-hidden='true' />
                            </button>
                        )}
                    </div>
                )}
            </div>
        );
    };

    const renderDurationControl = (label: string): React.ReactElement => {
        const options = props.secondsOptions.length > 0 ? props.secondsOptions : [props.seconds || 5];
        return (
            <div className='nmx-comic-studio-field'>
                <span className='nmx-comic-studio-label'>{label}</span>
                {options.length <= 5 ? (
                    <div className='nmx-comic-studio-pills' role='radiogroup' aria-label={label}>
                        {options.map(sec => {
                            const active = sec === props.seconds;
                            return (
                                <button
                                    key={sec}
                                    type='button'
                                    role='radio'
                                    aria-checked={active}
                                    disabled={props.generating}
                                    className={`nmx-comic-studio-pill${active ? ' is-active' : ''}`}
                                    onClick={() => props.onSecondsChange(sec)}
                                >
                                    <span data-nmx-literal>{t('secondsValue', { n: sec })}</span>
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <select
                        className='nmx-comic-studio-select'
                        value={String(props.seconds)}
                        disabled={props.generating}
                        aria-label={label}
                        onChange={event => props.onSecondsChange(Number(event.currentTarget.value))}
                    >
                        {options.map(sec => (
                            <option key={sec} value={String(sec)}>
                                {t('secondsValue', { n: sec })}
                            </option>
                        ))}
                    </select>
                )}
            </div>
        );
    };

    const renderAspectRatioControl = (): React.ReactElement => (
        <div className='nmx-comic-studio-field'>
            <span className='nmx-comic-studio-label'>{t('aspectRatio')}</span>
            <div className='nmx-comic-studio-ratio-row' role='radiogroup' aria-label={t('aspectRatio')}>
                {ratioChoices.map(ratio => {
                    const active = ratio === props.aspectRatio;
                    return (
                        <button
                            key={ratio}
                            type='button'
                            role='radio'
                            aria-checked={active}
                            disabled={props.generating}
                            className={`nmx-comic-studio-ratio-pill${active ? ' is-active' : ''}`}
                            onClick={() => props.onAspectRatioChange(ratio)}
                        >
                            <i className='nmx-comic-studio-ratio-box' data-ratio={ratio} aria-hidden='true' />
                            <span data-nmx-literal>{ratio}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );

    const renderStyleSelect = (domain: 'visual' | 'music'): React.ReactElement => {
        const label = domain === 'music' ? t('musicStyle') : t('visualStyle');
        const list = domain === 'music' ? musicPresets : visualPresets;
        return (
            <div className='nmx-comic-studio-field'>
                <div className='nmx-comic-studio-label-row'>
                    <span className='nmx-comic-studio-label'>{label}</span>
                    {hasActiveStylePreset && (
                        <em className='nmx-comic-studio-priority-hint'>
                            <i className='codicon codicon-sparkle' aria-hidden='true' />
                            <span>{t('userPromptPriority')}</span>
                        </em>
                    )}
                </div>
                <select
                    className='nmx-comic-studio-select'
                    aria-label={label}
                    value={props.stylePresetId || 'none'}
                    disabled={props.generating}
                    onChange={event => props.onStylePresetChange(event.currentTarget.value)}
                >
                    {list.map(preset => (
                        <option key={preset.id} value={preset.id}>
                            {comicStylePresetLabel(props.locale, preset)}
                        </option>
                    ))}
                </select>
            </div>
        );
    };

    const primaryCtaLabel = props.generating
        ? t('generating')
        : props.takes.length > 0
          ? t('regenerate')
          : props.kind === 'music'
            ? t('generateMusic')
            : t('generateVideo');

    const effectiveLightTheme = typeof props.isLightTheme === 'boolean' ? props.isLightTheme : isLightTheme;
    const safeErrorMessage = typeof props.errorMessage === 'string' ? props.errorMessage.trim() : '';
    const safeBlockedReason = typeof props.blockedReason === 'string' ? props.blockedReason.trim() : '';

    const activeStockProvider = props.topicStockProvider ?? 'pexels';
    const activeStockProviderLabel = activeStockProvider === 'pixabay' ? 'Pixabay' : 'Pexels';

    const handleTopicToggleSource = (key: 'own' | 'stock' | 'ai'): void => {
        const current = effectiveTopicSources;
        const activeCount = (current.own ? 1 : 0) + (current.stock ? 1 : 0) + (current.ai ? 1 : 0);
        if (current[key] && activeCount <= 1) {
            return;
        }
        if (props.onTopicToggleSource) {
            props.onTopicToggleSource(key);
            return;
        }
        if (key === 'own') {
            setShowTopicAssets(!current.own);
        }
    };

    const resolvedSourceZoomUrl = sourceZoomItem
        ? props.sourceFiles.find(
              item =>
                  (Boolean(sourceZoomItem.id) && (item.id === sourceZoomItem.id || item.id === `lib:${sourceZoomItem.id}`)) ||
                  (Boolean(sourceZoomItem.path) && item.path === sourceZoomItem.path)
          )?.previewUrl ||
          (props.libraryItems ?? []).find(
              item =>
                  (Boolean(sourceZoomItem.id) && item.id === sourceZoomItem.id) ||
                  (Boolean(sourceZoomItem.path) && item.path === sourceZoomItem.path)
          )?.previewUrl ||
          sourceZoomItem.url
        : '';

    return (
        <div
            className={`nmx-comic-studio-modal-backdrop is-${props.kind}${effectiveLightTheme ? ' nmx-theme-light' : ''}`}
            dir={props.locale === 'ar' ? 'rtl' : undefined}
            data-lightbox-open={lightboxOpen || Boolean(sourceZoomItem) ? 'true' : undefined}
            data-context-menu-open={contextMenu ? 'true' : undefined}
            onMouseDown={event => {
                if (event.target === event.currentTarget) {
                    props.onDismissTransientOverlay?.();
                }
            }}
        >
            <section
                className={`nmx-comic-studio-modal is-${props.kind}`}
                role='dialog'
                aria-modal='true'
                aria-label={modalTitle}
            >
                {/* Compact 48px Studio Header */}
                <header className='nmx-comic-studio-header'>
                    <div className='nmx-comic-studio-header-brand'>
                        <span className={`nmx-comic-studio-kind-badge is-${props.kind}`} aria-hidden='true'>
                            <i className={`codicon codicon-${MODAL_KIND_ICONS[props.kind]}`} />
                        </span>
                        <h2>{modalTitle}</h2>
                    </div>
                    {props.kind !== 'music' && (
                        <div className='nmx-comic-studio-header-title'>
                            <ImeInput
                                maxLength={80}
                                value={props.title}
                                disabled={props.generating}
                                placeholder={t('projectTitlePlaceholder')}
                                aria-label={t('projectTitlePlaceholder')}
                                onChange={event => props.onTitleChange(event.currentTarget.value)}
                            />
                        </div>
                    )}
                    {props.boundProjectPath && (
                        <span className='nmx-comic-studio-bound-pill' title={props.boundProjectPath}>
                            <i className='codicon codicon-lock' aria-hidden='true' />
                            <span>{t('boundProjectBadge')}</span>
                        </span>
                    )}
                    <div className='nmx-comic-studio-header-spacer' />
                    <button
                        type='button'
                        className='nmx-comic-studio-close-btn'
                        aria-label={t('close')}
                        title={t('close')}
                        onClick={props.onClose}
                    >
                        <i className='codicon codicon-close' aria-hidden='true' />
                    </button>
                </header>

                {/* Two-Column Left-Right Studio Body */}
                <div className='nmx-comic-studio-body'>
                    {/* Left Column: Compact Scrollable Parameters + Sticky Pricing/Generate Footer */}
                    <div className='nmx-comic-studio-left'>
                        <div className='nmx-comic-studio-form' onScroll={() => props.onFormScroll?.()}>
                            <ComicProjectLocationField
                                locale={props.locale}
                                parentDirectory={props.parentDirectory}
                                defaultDirectory={props.defaultDirectory}
                                previewPath={props.boundProjectPath || props.previewFolderPath}
                                disabled={props.generating}
                                readOnly={Boolean(props.boundProjectPath)}
                                canOpenDirectory={props.canOpenDirectory}
                                onChooseDirectory={props.onChooseDirectory}
                                onResetDirectory={props.onResetDirectory}
                                onOpenDirectory={props.onOpenDirectory}
                            />

                            {props.kind === 'image' && (
                                <>
                                    <div className='nmx-comic-studio-field'>
                                        <span className='nmx-comic-studio-label'>{t('selectImages')}</span>
                                        {renderSourcePickerBlock('image')}
                                    </div>

                                    <div className='nmx-comic-studio-field'>
                                        <span className='nmx-comic-studio-label'>{t('videoModel')}</span>
                                        <div className='nmx-comic-studio-model-slot'>{props.primaryModelPickerSlot}</div>
                                    </div>

                                    <div className='nmx-comic-studio-field'>
                                        <span className='nmx-comic-studio-label'>{t('prompt')}</span>
                                        <ImeTextarea
                                            rows={3}
                                            className='nmx-comic-studio-textarea'
                                            value={props.prompt}
                                            disabled={props.generating}
                                            placeholder={t('promptImagePlaceholder')}
                                            aria-label={t('prompt')}
                                            onChange={event => props.onPromptChange(event.currentTarget.value)}
                                        />
                                    </div>

                                    {renderDurationControl(t('durationSeconds'))}
                                    {renderAspectRatioControl()}
                                    {renderStyleSelect('visual')}

                                    {props.soundSupported && (
                                        <div className='nmx-comic-studio-switch-card'>
                                            <div className='nmx-comic-studio-switch-copy'>
                                                <strong>{t('generateSound')}</strong>
                                                <small>{t('generateSoundHint')}</small>
                                            </div>
                                            <button
                                                type='button'
                                                role='switch'
                                                aria-checked={Boolean(props.soundEnabled)}
                                                aria-label={t('generateSound')}
                                                disabled={props.generating}
                                                className={`nmx-comic-studio-switch is-primary${props.soundEnabled ? ' is-on' : ''}`}
                                                onClick={() => props.onSoundEnabledChange?.(!props.soundEnabled)}
                                            >
                                                <span />
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}

                            {props.kind === 'topic' && (
                                <>
                                    <div className='nmx-comic-studio-field'>
                                        <span className='nmx-comic-studio-label'>{t('topicPrompt')}</span>
                                        <ImeTextarea
                                            rows={3}
                                            className='nmx-comic-studio-textarea'
                                            value={props.prompt}
                                            disabled={props.generating}
                                            placeholder={t('topicPromptPlaceholder')}
                                            aria-label={t('topicPrompt')}
                                            onChange={event => props.onPromptChange(event.currentTarget.value)}
                                        />
                                    </div>

                                    <div className='nmx-comic-studio-field'>
                                        <span className='nmx-comic-studio-label'>{t('visualSources')}</span>
                                        <div
                                            className='nmx-comic-studio-source-modes'
                                            role='group'
                                            aria-label={t('visualSources')}
                                        >
                                            <button
                                                type='button'
                                                aria-pressed={effectiveTopicSources.own}
                                                disabled={props.generating}
                                                title={`${t('sourceOwn')} · ${t('sourceOwnSub')}`}
                                                className={`nmx-comic-studio-source-mode-btn${effectiveTopicSources.own ? ' is-active' : ''}`}
                                                onClick={() => handleTopicToggleSource('own')}
                                            >
                                                <i className='codicon codicon-folder-library' aria-hidden='true' />
                                                <span>{t('sourceOwn')}</span>
                                            </button>
                                            <button
                                                type='button'
                                                aria-pressed={effectiveTopicSources.stock}
                                                disabled={props.generating}
                                                title={`${t('sourceStock')} · ${t('sourceStockSub')}`}
                                                className={`nmx-comic-studio-source-mode-btn${effectiveTopicSources.stock ? ' is-active' : ''}`}
                                                onClick={() => handleTopicToggleSource('stock')}
                                            >
                                                <i className='codicon codicon-globe' aria-hidden='true' />
                                                <span>{t('sourceStock')}</span>
                                            </button>
                                            <button
                                                type='button'
                                                aria-pressed={effectiveTopicSources.ai}
                                                disabled={props.generating}
                                                title={`${t('sourceAi')} · ${t('sourceAiSub')}`}
                                                className={`nmx-comic-studio-source-mode-btn${effectiveTopicSources.ai ? ' is-active' : ''}`}
                                                onClick={() => handleTopicToggleSource('ai')}
                                            >
                                                <i className='codicon codicon-sparkle' aria-hidden='true' />
                                                <span>{t('sourceAi')}</span>
                                            </button>
                                        </div>
                                    </div>

                                    {effectiveTopicSources.own && (
                                        <div className='nmx-comic-studio-field nmx-comic-studio-collapsible'>
                                            <span className='nmx-comic-studio-label'>{t('sourceOwn')}</span>
                                            {renderSourcePickerBlock('topic')}
                                        </div>
                                    )}

                                    {effectiveTopicSources.stock && (
                                        <div className='nmx-comic-studio-stock-panel'>
                                            <div
                                                className='nmx-comic-studio-segmented nmx-comic-studio-segment'
                                                role='radiogroup'
                                                aria-label={t('sourceStock')}
                                            >
                                                <button
                                                    type='button'
                                                    role='radio'
                                                    aria-checked={activeStockProvider === 'pexels'}
                                                    disabled={props.generating}
                                                    className={`nmx-comic-studio-seg-btn${activeStockProvider === 'pexels' ? ' is-active' : ''}`}
                                                    onClick={() => props.onTopicStockProviderChange?.('pexels')}
                                                >
                                                    <span data-nmx-literal>Pexels</span>
                                                </button>
                                                <button
                                                    type='button'
                                                    role='radio'
                                                    aria-checked={activeStockProvider === 'pixabay'}
                                                    disabled={props.generating}
                                                    className={`nmx-comic-studio-seg-btn${activeStockProvider === 'pixabay' ? ' is-active' : ''}`}
                                                    onClick={() => props.onTopicStockProviderChange?.('pixabay')}
                                                >
                                                    <span data-nmx-literal>Pixabay</span>
                                                </button>
                                            </div>

                                            {props.topicStockKeySaved && !props.topicStockEditingKey ? (
                                                <div className='nmx-comic-studio-stock-saved'>
                                                    <i className='codicon codicon-pass-filled' aria-hidden='true' />
                                                    <span>{t('stockKeySaved')}</span>
                                                    <button
                                                        type='button'
                                                        className='nmx-comic-studio-stage-btn'
                                                        disabled={props.generating}
                                                        onClick={() => props.onTopicStockEditingKeyChange?.(true)}
                                                    >
                                                        {t('stockKeyChange')}
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className='nmx-comic-studio-stock-key-row'>
                                                    <ImeInput
                                                        type='password'
                                                        className='nmx-comic-studio-input'
                                                        value={props.topicStockKeyInput ?? ''}
                                                        disabled={props.generating}
                                                        placeholder={t('stockKeyPlaceholder', {
                                                            provider: activeStockProviderLabel
                                                        })}
                                                        aria-label={t('stockKeyPlaceholder', {
                                                            provider: activeStockProviderLabel
                                                        })}
                                                        onChange={event =>
                                                            props.onTopicStockKeyInputChange?.(event.currentTarget.value)
                                                        }
                                                    />
                                                    <button
                                                        type='button'
                                                        className='nmx-comic-studio-stock-link'
                                                        onClick={() => props.onOpenStockKeyPage?.(activeStockProvider)}
                                                    >
                                                        <span>{t('stockGetKey')}</span>
                                                        <i className='codicon codicon-link-external' aria-hidden='true' />
                                                    </button>
                                                </div>
                                            )}

                                            <p className='nmx-comic-studio-hint-note'>{t('stockLicenseNote')}</p>
                                        </div>
                                    )}

                                    <div className='nmx-comic-studio-field'>
                                        <span className='nmx-comic-studio-label'>{t('modelSelection')}</span>
                                        <div className='nmx-comic-studio-model-stack'>
                                            {props.secondaryModelPickerSlot && (
                                                <div className='nmx-comic-studio-model-row'>
                                                    <small className='nmx-comic-studio-sublabel'>{t('scriptModel')}</small>
                                                    <div className='nmx-comic-studio-model-slot'>
                                                        {props.secondaryModelPickerSlot}
                                                    </div>
                                                </div>
                                            )}
                                            {effectiveTopicSources.ai && props.primaryModelPickerSlot && (
                                                <div className='nmx-comic-studio-model-row'>
                                                    <small className='nmx-comic-studio-sublabel'>{t('visualModel')}</small>
                                                    <div className='nmx-comic-studio-model-slot'>
                                                        {props.primaryModelPickerSlot}
                                                    </div>
                                                </div>
                                            )}
                                            {(props.topicVoiceSubtitles ?? true) && props.tertiaryModelPickerSlot && (
                                                <div className='nmx-comic-studio-model-row'>
                                                    <small className='nmx-comic-studio-sublabel'>{t('voiceModel')}</small>
                                                    <div className='nmx-comic-studio-model-slot'>
                                                        {props.tertiaryModelPickerSlot}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {effectiveTopicSources.ai ? (
                                        <div className='nmx-comic-studio-grid-2'>
                                            <div className='nmx-comic-studio-field'>
                                                <span className='nmx-comic-studio-label'>{t('topicVisualType')}</span>
                                                <div
                                                    className='nmx-comic-studio-segmented'
                                                    role='radiogroup'
                                                    aria-label={t('topicVisualType')}
                                                >
                                                    <button
                                                        type='button'
                                                        role='radio'
                                                        aria-checked={(props.topicVisualMode ?? 'videos') === 'videos'}
                                                        disabled={props.generating}
                                                        className={`nmx-comic-studio-seg-btn${(props.topicVisualMode ?? 'videos') === 'videos' ? ' is-active' : ''}`}
                                                        onClick={() => props.onTopicVisualModeChange?.('videos')}
                                                    >
                                                        {t('topicVisualVideos')}
                                                    </button>
                                                    <button
                                                        type='button'
                                                        role='radio'
                                                        aria-checked={props.topicVisualMode === 'images'}
                                                        disabled={props.generating}
                                                        className={`nmx-comic-studio-seg-btn${props.topicVisualMode === 'images' ? ' is-active' : ''}`}
                                                        onClick={() => props.onTopicVisualModeChange?.('images')}
                                                    >
                                                        {t('topicVisualImages')}
                                                    </button>
                                                </div>
                                            </div>
                                            {renderDurationControl(t('targetDuration'))}
                                        </div>
                                    ) : (
                                        <>
                                            <p className='nmx-comic-studio-hint-note'>{t('noAiHintNote')}</p>
                                            {renderDurationControl(t('targetDuration'))}
                                        </>
                                    )}

                                    {renderAspectRatioControl()}
                                    {renderStyleSelect('visual')}

                                    <div className='nmx-comic-studio-switch-card'>
                                        <div className='nmx-comic-studio-switch-copy'>
                                            <strong>{t('voiceAndSubtitles')}</strong>
                                            <small data-nmx-literal={Boolean(props.topicVoiceSummaryText) || undefined}>
                                                {props.topicVoiceSummaryText || t('voiceAndSubtitlesHint')}
                                            </small>
                                        </div>
                                        <button
                                            type='button'
                                            role='switch'
                                            aria-checked={props.topicVoiceSubtitles ?? true}
                                            aria-label={t('voiceAndSubtitles')}
                                            disabled={props.generating}
                                            className={`nmx-comic-studio-switch is-primary${(props.topicVoiceSubtitles ?? true) ? ' is-on' : ''}`}
                                            onClick={() =>
                                                props.onTopicVoiceSubtitlesChange?.(!(props.topicVoiceSubtitles ?? true))
                                            }
                                        >
                                            <span />
                                        </button>
                                    </div>
                                </>
                            )}

                            {props.kind === 'music' && (
                                <>
                                    <div className='nmx-comic-studio-field'>
                                        <span className='nmx-comic-studio-label'>{t('songTitleOptional')}</span>
                                        <ImeInput
                                            maxLength={80}
                                            className='nmx-comic-studio-input'
                                            value={props.title}
                                            disabled={props.generating}
                                            placeholder={t('songTitlePlaceholder')}
                                            aria-label={t('songTitleOptional')}
                                            onChange={event => props.onTitleChange(event.currentTarget.value)}
                                        />
                                    </div>

                                    <div className='nmx-comic-studio-field'>
                                        <span className='nmx-comic-studio-label'>{t('musicModel')}</span>
                                        <div className='nmx-comic-studio-model-slot'>{props.primaryModelPickerSlot}</div>
                                    </div>

                                    <div className='nmx-comic-studio-grid-2'>
                                        <div className='nmx-comic-studio-field'>
                                            <span className='nmx-comic-studio-label'>{t('vocalMode')}</span>
                                            <div
                                                className='nmx-comic-studio-segmented'
                                                role='radiogroup'
                                                aria-label={t('vocalMode')}
                                            >
                                                <button
                                                    type='button'
                                                    role='radio'
                                                    aria-checked={Boolean(props.musicInstrumental)}
                                                    disabled={props.generating}
                                                    className={`nmx-comic-studio-seg-btn${props.musicInstrumental ? ' is-active' : ''}`}
                                                    onClick={() => props.onMusicInstrumentalChange?.(true)}
                                                >
                                                    {t('instrumental')}
                                                </button>
                                                <button
                                                    type='button'
                                                    role='radio'
                                                    aria-checked={!props.musicInstrumental}
                                                    disabled={props.generating}
                                                    className={`nmx-comic-studio-seg-btn${!props.musicInstrumental ? ' is-active' : ''}`}
                                                    onClick={() => props.onMusicInstrumentalChange?.(false)}
                                                >
                                                    {t('withVocals')}
                                                </button>
                                            </div>
                                        </div>

                                        <div className='nmx-comic-studio-field'>
                                            <span className='nmx-comic-studio-label'>{t('musicDuration')}</span>
                                            <div
                                                className='nmx-comic-studio-segmented'
                                                role='radiogroup'
                                                aria-label={t('musicDuration')}
                                            >
                                                <button
                                                    type='button'
                                                    role='radio'
                                                    aria-checked={!props.musicFullTrack}
                                                    disabled={props.generating}
                                                    className={`nmx-comic-studio-seg-btn${!props.musicFullTrack ? ' is-active' : ''}`}
                                                    onClick={() => props.onMusicFullTrackChange?.(false)}
                                                >
                                                    {t('clip30s')}
                                                </button>
                                                <button
                                                    type='button'
                                                    role='radio'
                                                    aria-checked={Boolean(props.musicFullTrack)}
                                                    disabled={props.generating}
                                                    className={`nmx-comic-studio-seg-btn${props.musicFullTrack ? ' is-active' : ''}`}
                                                    onClick={() => props.onMusicFullTrackChange?.(true)}
                                                >
                                                    {t('fullSong')}
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {renderStyleSelect('music')}

                                    <div className='nmx-comic-studio-field'>
                                        <span className='nmx-comic-studio-label'>{t('musicPrompt')}</span>
                                        <ImeTextarea
                                            rows={4}
                                            className='nmx-comic-studio-textarea is-music'
                                            value={props.prompt}
                                            disabled={props.generating}
                                            placeholder={t('musicPromptPlaceholder')}
                                            aria-label={t('musicPrompt')}
                                            onChange={event => props.onPromptChange(event.currentTarget.value)}
                                        />
                                    </div>
                                </>
                            )}

                            {safeErrorMessage && (
                                <div className='nmx-comic-studio-error' role='alert'>
                                    <i className='codicon codicon-error' aria-hidden='true' />
                                    <span data-nmx-literal>{safeErrorMessage}</span>
                                </div>
                            )}
                        </div>

                        {/* Sticky Left Footer */}
                        <footer className='nmx-comic-studio-left-footer'>
                            {safeBlockedReason && (
                                <div className='nmx-comic-studio-blocked-bar' role='status'>
                                    <i className='codicon codicon-warning' aria-hidden='true' />
                                    <span data-nmx-literal title={safeBlockedReason}>
                                        {safeBlockedReason}
                                    </span>
                                    {props.onBlockedAction && (
                                        <button
                                            type='button'
                                            className='nmx-comic-studio-blocked-btn'
                                            onClick={props.onBlockedAction}
                                        >
                                            {props.blockedActionLabel || t('resolveAction')}
                                        </button>
                                    )}
                                </div>
                            )}
                            <div className='nmx-comic-studio-footer-main'>
                                <div
                                    className='nmx-comic-studio-price'
                                    title={props.estimatedPriceHint || props.estimatedPriceLabel}
                                >
                                    <small>{t('estimatedPrice')}</small>
                                    <strong data-nmx-literal>{props.estimatedPriceLabel || '—'}</strong>
                                </div>
                                <div className='nmx-comic-studio-footer-actions'>
                                    {props.generating && props.onCancelGenerate && (
                                        <button
                                            type='button'
                                            className='nmx-comic-studio-ghost-btn'
                                            onClick={props.onCancelGenerate}
                                        >
                                            {t('cancel')}
                                        </button>
                                    )}
                                    <button
                                        type='button'
                                        className='nmx-comic-studio-cta is-primary'
                                        disabled={props.generating || Boolean(safeBlockedReason)}
                                        onClick={props.onGenerate}
                                    >
                                        {props.generating ? (
                                            <i
                                                className='codicon codicon-loading codicon-modifier-spin'
                                                aria-hidden='true'
                                            />
                                        ) : props.takes.length > 0 ? (
                                            <i className='codicon codicon-refresh' aria-hidden='true' />
                                        ) : (
                                            <i className='codicon codicon-sparkle' aria-hidden='true' />
                                        )}
                                        <span>{primaryCtaLabel}</span>
                                    </button>
                                </div>
                            </div>
                        </footer>
                    </div>

                    {/* Right Column: Top Action Bar + Hero Media Stage + Bottom History Filmstrip */}
                    <div className='nmx-comic-studio-right'>
                        <div className='nmx-comic-studio-stage-bar'>
                            <div className='nmx-comic-studio-stage-meta'>
                                {activeTake ? (
                                    <>
                                        <strong data-nmx-literal title={activeTake.title}>
                                            {activeTake.title}
                                        </strong>
                                        <span className='nmx-comic-studio-meta-badges' data-nmx-literal>
                                            {[
                                                activeTake.aspectRatio,
                                                activeTake.durationSeconds
                                                    ? `${Math.round(activeTake.durationSeconds)}s`
                                                    : undefined,
                                                activeTake.modelLabel
                                            ]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </span>
                                    </>
                                ) : (
                                    <strong>{t('previewArea')}</strong>
                                )}
                            </div>

                            {props.takes.length > 0 && activeTake && (
                                <div className='nmx-comic-studio-stage-actions'>
                                    <button
                                        type='button'
                                        className='nmx-comic-studio-stage-btn'
                                        title={isAudioStage ? t('zoomDetails') : t('zoomPreview')}
                                        onClick={() => openLightbox()}
                                    >
                                        <i className='codicon codicon-screen-full' aria-hidden='true' />
                                        <span>{isAudioStage ? t('zoomDetails') : t('zoomPreview')}</span>
                                    </button>
                                    <button
                                        type='button'
                                        className='nmx-comic-studio-stage-btn'
                                        title={t('revealInFolder')}
                                        onClick={() => props.onRevealInFolder(activeTake.filePath)}
                                    >
                                        <i className='codicon codicon-folder-opened' aria-hidden='true' />
                                        <span>{t('revealInFolder')}</span>
                                    </button>
                                    <button
                                        type='button'
                                        className='nmx-comic-studio-enter-btn is-primary'
                                        onClick={props.onEnterEditor}
                                    >
                                        <i className='codicon codicon-play-circle' aria-hidden='true' />
                                        <span>{t('enterEditor')}</span>
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Hero Media Preview Stage */}
                        <div className='nmx-comic-studio-stage'>
                            {props.takes.length > 0 && props.generating && (
                                <div className='nmx-comic-studio-regen-pill' role='status'>
                                    <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true' />
                                    <span data-nmx-literal={Boolean(props.generatingStageLabel) || undefined}>
                                        {props.generatingStageLabel || t('regeneratingBanner')}
                                    </span>
                                </div>
                            )}

                            {props.takes.length === 0 && !props.generating && (
                                <div
                                    className='nmx-comic-studio-empty-stage'
                                    data-ratio={props.kind === 'music' ? '1:1' : props.aspectRatio}
                                >
                                    {props.kind === 'image' && props.sourceFiles[0]?.previewUrl ? (
                                        <div className='nmx-comic-studio-empty-seed'>
                                            <img src={props.sourceFiles[0].previewUrl} alt='' draggable={false} />
                                        </div>
                                    ) : (
                                        <span className='nmx-comic-studio-empty-icon' aria-hidden='true'>
                                            <i className={`codicon codicon-${MODAL_KIND_ICONS[props.kind]}`} />
                                        </span>
                                    )}
                                    <strong>{t('emptyStageTitle')}</strong>
                                    <p>{t('emptyStageHint')}</p>
                                </div>
                            )}

                            {props.takes.length === 0 && props.generating && (
                                <div className='nmx-comic-studio-generating-card' role='status'>
                                    <span className='nmx-comic-studio-spinner-ring' aria-hidden='true'>
                                        <i className='codicon codicon-loading codicon-modifier-spin' />
                                    </span>
                                    <strong>{t('generating')}</strong>
                                    {props.generatingStageLabel && (
                                        <p data-nmx-literal>{props.generatingStageLabel}</p>
                                    )}
                                </div>
                            )}

                            {activeTake && isImageStage && (
                                <div
                                    className='nmx-comic-studio-video-wrap'
                                    onContextMenu={event => openTakeContextMenu(event, activeTake)}
                                >
                                    <img
                                        key={activeTake.id}
                                        className='nmx-comic-studio-image'
                                        src={activeTake.mediaUrl}
                                        alt={activeTake.title}
                                        draggable={false}
                                    />
                                    <button
                                        type='button'
                                        className='nmx-comic-studio-stage-zoom-fab'
                                        aria-label={t('zoomPreview')}
                                        title={t('zoomPreview')}
                                        onClick={() => openLightbox()}
                                    >
                                        <i className='codicon codicon-screen-full' aria-hidden='true' />
                                    </button>
                                </div>
                            )}

                            {activeTake && isVideoStage && (
                                <div
                                    className='nmx-comic-studio-video-wrap'
                                    onContextMenu={event => openTakeContextMenu(event, activeTake)}
                                >
                                    <video
                                        key={activeTake.id}
                                        ref={videoRef}
                                        className='nmx-comic-studio-video'
                                        src={activeTake.mediaUrl}
                                        poster={activeTake.thumbnailUrl}
                                        controls
                                        playsInline
                                        onPlay={() => setIsPlaying(true)}
                                        onPause={() => setIsPlaying(false)}
                                        onEnded={() => setIsPlaying(false)}
                                    />
                                    <button
                                        type='button'
                                        className='nmx-comic-studio-stage-zoom-fab'
                                        aria-label={t('zoomPreview')}
                                        title={t('zoomPreview')}
                                        onClick={() => openLightbox()}
                                    >
                                        <i className='codicon codicon-screen-full' aria-hidden='true' />
                                    </button>
                                </div>
                            )}

                            {activeTake && isAudioStage && (
                                <div
                                    className={`nmx-comic-studio-audio-deck${isPlaying ? ' is-playing' : ''}`}
                                    onContextMenu={event => openTakeContextMenu(event, activeTake)}
                                >
                                    <audio
                                        key={activeTake.id}
                                        ref={audioRef}
                                        src={activeTake.mediaUrl}
                                        preload='metadata'
                                        onLoadedMetadata={event => {
                                            event.currentTarget.volume = muted ? 0 : volume;
                                            event.currentTarget.muted = muted;
                                            const dur = event.currentTarget.duration;
                                            if (Number.isFinite(dur) && dur > 0) {
                                                setDuration(dur);
                                            }
                                        }}
                                        onDurationChange={event => {
                                            const dur = event.currentTarget.duration;
                                            if (Number.isFinite(dur) && dur > 0) {
                                                setDuration(dur);
                                            }
                                        }}
                                        onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)}
                                        onPlay={() => setIsPlaying(true)}
                                        onPause={() => setIsPlaying(false)}
                                        onEnded={() => setIsPlaying(false)}
                                    />

                                    <div className='nmx-comic-studio-audio-art-row'>
                                        <div className={`nmx-comic-studio-audio-disc${isPlaying ? ' is-spinning' : ''}`}>
                                            {activeTake.thumbnailUrl ? (
                                                <img src={activeTake.thumbnailUrl} alt='' draggable={false} />
                                            ) : (
                                                <i className='codicon codicon-music' aria-hidden='true' />
                                            )}
                                            <span className='nmx-comic-studio-disc-spindle' aria-hidden='true' />
                                        </div>

                                        <div className='nmx-comic-studio-audio-info'>
                                            <div className='nmx-comic-studio-eq' aria-hidden='true'>
                                                <i />
                                                <i />
                                                <i />
                                                <i />
                                                <i />
                                            </div>
                                            <h3 data-nmx-literal>{activeTake.title}</h3>
                                            <small data-nmx-literal>
                                                {[activeTake.modelLabel, activeTake.createdAtLabel]
                                                    .filter(Boolean)
                                                    .join(' · ') || modalTitle}
                                            </small>
                                            {activeTake.prompt && (
                                                <p className='nmx-comic-studio-audio-prompt' data-nmx-literal>
                                                    {activeTake.prompt}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    <div className='nmx-comic-studio-audio-transport'>
                                        <button
                                            type='button'
                                            className='nmx-comic-studio-audio-play is-primary'
                                            aria-label={isPlaying ? t('pause') : t('play')}
                                            title={isPlaying ? t('pause') : t('play')}
                                            onClick={toggleActivePlayback}
                                        >
                                            <i
                                                className={`codicon codicon-${isPlaying ? 'debug-pause' : 'play'}`}
                                                aria-hidden='true'
                                            />
                                        </button>

                                        <div className='nmx-comic-studio-audio-timeline'>
                                            <input
                                                type='range'
                                                min={0}
                                                max={sliderMaxDuration}
                                                step={0.1}
                                                value={Math.min(currentTime, sliderMaxDuration)}
                                                aria-label={modalTitle}
                                                onChange={event => seekAudio(Number(event.currentTarget.value))}
                                            />
                                            <div className='nmx-comic-studio-audio-clock' data-nmx-literal>
                                                <span>{formatMediaClock(currentTime)}</span>
                                                <span>{knownAudioDuration > 0 ? formatMediaClock(knownAudioDuration) : '--:--'}</span>
                                            </div>
                                        </div>

                                        <div className='nmx-comic-studio-audio-vol'>
                                            <button
                                                type='button'
                                                className='nmx-comic-studio-vol-btn'
                                                aria-label={muted ? t('unmute') : t('mute')}
                                                title={muted ? t('unmute') : t('mute')}
                                                onClick={toggleAudioMute}
                                            >
                                                <i
                                                    className={`codicon codicon-${muted || volume === 0 ? 'mute' : 'unmute'}`}
                                                    aria-hidden='true'
                                                />
                                            </button>
                                            <input
                                                type='range'
                                                min={0}
                                                max={1}
                                                step={0.05}
                                                value={muted ? 0 : volume}
                                                aria-label={t('volume')}
                                                onChange={event => changeAudioVolume(Number(event.currentTarget.value))}
                                            />
                                        </div>

                                        <button
                                            type='button'
                                            className='nmx-comic-studio-vol-btn'
                                            aria-label={t('zoomDetails')}
                                            title={t('zoomDetails')}
                                            onClick={() => openLightbox()}
                                        >
                                            <i className='codicon codicon-screen-full' aria-hidden='true' />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Bottom History Filmstrip Carousel */}
                        {props.takes.length > 0 && (
                            <div className='nmx-comic-studio-filmstrip-bar'>
                                <button
                                    type='button'
                                    className='nmx-comic-studio-filmstrip-nav is-prev'
                                    aria-label={t('prevTake')}
                                    title={t('prevTake')}
                                    disabled={activeIndex <= 0}
                                    onClick={() => stepTake(-1)}
                                >
                                    <i className='codicon codicon-chevron-left' aria-hidden='true' />
                                </button>

                                <div
                                    ref={filmstripRef}
                                    className='nmx-comic-studio-filmstrip'
                                    role='listbox'
                                    aria-label={t('takesCount', { count: props.takes.length })}
                                    onWheel={handleFilmstripWheel}
                                >
                                    {props.takes.map((take, idx) => {
                                        const selected = take.id === activeTake?.id;
                                        const takeIsImage = take.kind === 'image';
                                        const takeIsAudio =
                                            !takeIsImage &&
                                            (take.kind === 'audio' || (props.kind === 'music' && take.kind !== 'video'));
                                        return (
                                            <button
                                                key={take.id}
                                                type='button'
                                                role='option'
                                                aria-selected={selected}
                                                data-take-id={take.id}
                                                className={`nmx-comic-studio-take-card${selected ? ' is-active' : ''}`}
                                                title={take.title}
                                                onClick={() => props.onSelectTake(take.id)}
                                                onContextMenu={event => openTakeContextMenu(event, take)}
                                            >
                                                <span className='nmx-comic-studio-take-thumb'>
                                                    {takeIsImage ? (
                                                        <img
                                                            src={take.thumbnailUrl || take.mediaUrl}
                                                            alt=''
                                                            loading='lazy'
                                                            draggable={false}
                                                        />
                                                    ) : take.thumbnailUrl ? (
                                                        <img src={take.thumbnailUrl} alt='' loading='lazy' draggable={false} />
                                                    ) : !takeIsAudio ? (
                                                        <video
                                                            src={take.mediaUrl}
                                                            preload='metadata'
                                                            muted
                                                            playsInline
                                                        />
                                                    ) : (
                                                        <span className='nmx-comic-studio-take-wave' aria-hidden='true'>
                                                            <i className='codicon codicon-music' />
                                                        </span>
                                                    )}
                                                    <b className='nmx-comic-studio-take-index' data-nmx-literal>
                                                        #{idx + 1}
                                                    </b>
                                                    {take.durationSeconds !== undefined && take.durationSeconds > 0 && (
                                                        <em className='nmx-comic-studio-take-dur' data-nmx-literal>
                                                            {formatMediaClock(take.durationSeconds)}
                                                        </em>
                                                    )}
                                                </span>
                                                <small data-nmx-literal>{take.title}</small>
                                            </button>
                                        );
                                    })}
                                </div>

                                <button
                                    type='button'
                                    className='nmx-comic-studio-filmstrip-nav is-next'
                                    aria-label={t('nextTake')}
                                    title={t('nextTake')}
                                    disabled={activeIndex >= props.takes.length - 1}
                                    onClick={() => stepTake(1)}
                                >
                                    <i className='codicon codicon-chevron-right' aria-hidden='true' />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {/* Right-Click Floating Context Menu (direct child of fixed backdrop so viewport coords are exact) */}
            {contextMenu && (
                <div
                    className='nmx-comic-studio-context-menu'
                    role='menu'
                    style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
                >
                    <button
                        type='button'
                        role='menuitem'
                        onClick={() => {
                            const targetPath = contextMenu.filePath;
                            setContextMenu(undefined);
                            props.onRevealInFolder(targetPath);
                        }}
                    >
                        <i className='codicon codicon-folder-opened' aria-hidden='true' />
                        <span>
                            {contextMenu.mediaKind === 'audio'
                                ? t('revealAudioInFolder')
                                : contextMenu.mediaKind === 'image'
                                  ? t('revealImageInFolder')
                                  : t('revealVideoInFolder')}
                        </span>
                    </button>
                    <button
                        type='button'
                        role='menuitem'
                        onClick={() => {
                            const targetTakeId = contextMenu.takeId;
                            setContextMenu(undefined);
                            openLightbox(targetTakeId);
                        }}
                    >
                        <i className='codicon codicon-screen-full' aria-hidden='true' />
                        <span>{contextMenu.mediaKind === 'audio' ? t('zoomDetails') : t('zoomPreview')}</span>
                    </button>
                    {contextMenu.mediaKind !== 'image' && (
                        <button
                            type='button'
                            role='menuitem'
                            onClick={() => {
                                const targetTakeId = contextMenu.takeId;
                                setContextMenu(undefined);
                                if (targetTakeId !== activeTake?.id) {
                                    pendingAutoPlayTakeIdRef.current = targetTakeId;
                                    props.onSelectTake(targetTakeId);
                                } else {
                                    toggleActivePlayback();
                                }
                            }}
                        >
                            <i
                                className={`codicon codicon-${contextMenu.takeId === activeTake?.id && isPlaying ? 'debug-pause' : 'play'}`}
                                aria-hidden='true'
                            />
                            <span>{t('playPause')}</span>
                        </button>
                    )}
                </div>
            )}

            {/* Fullscreen / Large Zoom Lightbox */}
            {lightboxOpen && activeTake && (
                <div
                    className='nmx-comic-studio-lightbox'
                    role='dialog'
                    aria-modal='true'
                    aria-label={activeTake.title}
                    onPointerDown={event => {
                        event.stopPropagation();
                        lightboxBackdropDownRef.current = event.target === event.currentTarget;
                    }}
                    onMouseDown={event => {
                        event.stopPropagation();
                        lightboxBackdropDownRef.current = event.target === event.currentTarget;
                    }}
                    onClick={event => {
                        event.stopPropagation();
                        const shouldClose =
                            (lightboxBackdropDownRef.current || event.detail === 0) &&
                            event.target === event.currentTarget;
                        lightboxBackdropDownRef.current = false;
                        if (shouldClose) {
                            closeLightbox();
                        }
                    }}
                >
                    <header
                        className='nmx-comic-studio-lightbox-bar'
                        onPointerDown={event => {
                            event.stopPropagation();
                            lightboxBackdropDownRef.current = false;
                        }}
                        onMouseDown={event => {
                            event.stopPropagation();
                            lightboxBackdropDownRef.current = false;
                        }}
                        onClick={event => event.stopPropagation()}
                    >
                        <strong data-nmx-literal>{activeTake.title}</strong>
                        <div className='nmx-comic-studio-lightbox-actions'>
                            <button
                                type='button'
                                className='nmx-comic-studio-stage-btn'
                                onClick={() => props.onRevealInFolder(activeTake.filePath)}
                            >
                                <i className='codicon codicon-folder-opened' aria-hidden='true' />
                                <span>{t('revealInFolder')}</span>
                            </button>
                            <button
                                type='button'
                                className='nmx-comic-studio-enter-btn is-primary'
                                onClick={() => {
                                    closeLightbox();
                                    props.onEnterEditor();
                                }}
                            >
                                <i className='codicon codicon-play-circle' aria-hidden='true' />
                                <span>{t('enterEditor')}</span>
                            </button>
                            <button
                                type='button'
                                className='nmx-comic-studio-close-btn'
                                aria-label={t('close')}
                                title={t('close')}
                                onClick={() => closeLightbox()}
                            >
                                <i className='codicon codicon-close' aria-hidden='true' />
                            </button>
                        </div>
                    </header>
                    <div
                        className='nmx-comic-studio-lightbox-body'
                        onPointerDown={event => {
                            event.stopPropagation();
                            lightboxBackdropDownRef.current = event.target === event.currentTarget;
                        }}
                        onMouseDown={event => {
                            event.stopPropagation();
                            lightboxBackdropDownRef.current = event.target === event.currentTarget;
                        }}
                        onClick={event => {
                            event.stopPropagation();
                            const shouldClose =
                                (lightboxBackdropDownRef.current || event.detail === 0) &&
                                event.target === event.currentTarget;
                            lightboxBackdropDownRef.current = false;
                            if (shouldClose) {
                                closeLightbox();
                            }
                        }}
                        onContextMenu={event => openTakeContextMenu(event, activeTake)}
                    >
                        {isImageStage ? (
                            <img
                                className='nmx-comic-studio-lightbox-image'
                                src={activeTake.mediaUrl}
                                alt={activeTake.title}
                                draggable={false}
                                onPointerDown={event => {
                                    event.stopPropagation();
                                    lightboxBackdropDownRef.current = false;
                                }}
                                onMouseDown={event => {
                                    event.stopPropagation();
                                    lightboxBackdropDownRef.current = false;
                                }}
                                onMouseUp={() => {
                                    lightboxBackdropDownRef.current = false;
                                }}
                                onClick={event => event.stopPropagation()}
                            />
                        ) : isAudioStage ? (
                            <div
                                className='nmx-comic-studio-lightbox-audio'
                                onPointerDown={event => {
                                    event.stopPropagation();
                                    lightboxBackdropDownRef.current = false;
                                }}
                                onMouseDown={event => {
                                    event.stopPropagation();
                                    lightboxBackdropDownRef.current = false;
                                }}
                                onMouseUp={() => {
                                    lightboxBackdropDownRef.current = false;
                                }}
                                onClick={event => event.stopPropagation()}
                            >
                                <div className='nmx-comic-studio-audio-disc is-large'>
                                    {activeTake.thumbnailUrl ? (
                                        <img src={activeTake.thumbnailUrl} alt='' draggable={false} />
                                    ) : (
                                        <i className='codicon codicon-music' aria-hidden='true' />
                                    )}
                                    <span className='nmx-comic-studio-disc-spindle' aria-hidden='true' />
                                </div>
                                <h3 data-nmx-literal>{activeTake.title}</h3>
                                {activeTake.prompt && <p data-nmx-literal>{activeTake.prompt}</p>}
                                <audio
                                    ref={lightboxAudioRef}
                                    src={activeTake.mediaUrl}
                                    controls
                                    autoPlay
                                    onLoadedMetadata={event => {
                                        event.currentTarget.volume = muted ? 0 : volume;
                                        event.currentTarget.muted = muted;
                                        const resume = stageResumeTimeRef.current;
                                        if (
                                            resume > 0 &&
                                            Number.isFinite(event.currentTarget.duration) &&
                                            resume < event.currentTarget.duration
                                        ) {
                                            try {
                                                event.currentTarget.currentTime = resume;
                                            } catch {
                                                // Ignore seek error
                                            }
                                        }
                                    }}
                                    onTimeUpdate={event => {
                                        stageResumeTimeRef.current = event.currentTarget.currentTime;
                                    }}
                                />
                            </div>
                        ) : (
                            <video
                                ref={lightboxVideoRef}
                                className='nmx-comic-studio-lightbox-video'
                                src={activeTake.mediaUrl}
                                poster={activeTake.thumbnailUrl}
                                controls
                                autoPlay
                                playsInline
                                controlsList='nofullscreen noremoteplayback'
                                disablePictureInPicture
                                onPointerDown={event => {
                                    event.stopPropagation();
                                    lightboxBackdropDownRef.current = false;
                                }}
                                onMouseDown={event => {
                                    event.stopPropagation();
                                    lightboxBackdropDownRef.current = false;
                                }}
                                onMouseUp={() => {
                                    lightboxBackdropDownRef.current = false;
                                }}
                                onClick={event => event.stopPropagation()}
                                onLoadedMetadata={event => {
                                    const resume = stageResumeTimeRef.current;
                                    if (
                                        resume > 0 &&
                                        Number.isFinite(event.currentTarget.duration) &&
                                        resume < event.currentTarget.duration
                                    ) {
                                        try {
                                            event.currentTarget.currentTime = resume;
                                        } catch {
                                            // Ignore seek error
                                        }
                                    }
                                }}
                                onTimeUpdate={event => {
                                    stageResumeTimeRef.current = event.currentTarget.currentTime;
                                }}
                            />
                        )}
                    </div>
                </div>
            )}

            {/* Source / Inner Asset Library Zoom Lightbox */}
            {sourceZoomItem && resolvedSourceZoomUrl && (
                <div
                    className='nmx-comic-studio-lightbox is-source-zoom'
                    role='dialog'
                    aria-modal='true'
                    aria-label={sourceZoomItem.title}
                    onPointerDown={event => {
                        event.stopPropagation();
                        sourceLightboxBackdropDownRef.current = event.target === event.currentTarget;
                    }}
                    onMouseDown={event => {
                        event.stopPropagation();
                        sourceLightboxBackdropDownRef.current = event.target === event.currentTarget;
                    }}
                    onClick={event => {
                        event.stopPropagation();
                        const shouldClose =
                            (sourceLightboxBackdropDownRef.current || event.detail === 0) &&
                            event.target === event.currentTarget;
                        sourceLightboxBackdropDownRef.current = false;
                        if (shouldClose) {
                            closeSourceZoom();
                        }
                    }}
                >
                    <header
                        className='nmx-comic-studio-lightbox-bar'
                        onPointerDown={event => {
                            event.stopPropagation();
                            sourceLightboxBackdropDownRef.current = false;
                        }}
                        onMouseDown={event => {
                            event.stopPropagation();
                            sourceLightboxBackdropDownRef.current = false;
                        }}
                        onClick={event => event.stopPropagation()}
                    >
                        <strong data-nmx-literal>{sourceZoomItem.title}</strong>
                        <div className='nmx-comic-studio-lightbox-actions'>
                            <button
                                type='button'
                                className='nmx-comic-studio-close-btn'
                                aria-label={t('close')}
                                title={t('close')}
                                onClick={() => closeSourceZoom()}
                            >
                                <i className='codicon codicon-close' aria-hidden='true' />
                            </button>
                        </div>
                    </header>
                    <div
                        className='nmx-comic-studio-lightbox-body'
                        onPointerDown={event => {
                            event.stopPropagation();
                            sourceLightboxBackdropDownRef.current = event.target === event.currentTarget;
                        }}
                        onMouseDown={event => {
                            event.stopPropagation();
                            sourceLightboxBackdropDownRef.current = event.target === event.currentTarget;
                        }}
                        onClick={event => {
                            event.stopPropagation();
                            const shouldClose =
                                (sourceLightboxBackdropDownRef.current || event.detail === 0) &&
                                event.target === event.currentTarget;
                            sourceLightboxBackdropDownRef.current = false;
                            if (shouldClose) {
                                closeSourceZoom();
                            }
                        }}
                    >
                        {sourceZoomItem.kind === 'video' ? (
                            <video
                                key={sourceZoomItem.id || sourceZoomItem.path || sourceZoomItem.title}
                                className='nmx-comic-studio-lightbox-video is-responsive-video'
                                style={
                                    sourceZoomAspectRatio
                                        ? ({
                                              '--nmx-studio-zoom-ar': String(Number(sourceZoomAspectRatio.toFixed(6)))
                                          } as React.CSSProperties)
                                        : undefined
                                }
                                src={resolvedSourceZoomUrl}
                                controls
                                autoPlay
                                playsInline
                                controlsList='nofullscreen noremoteplayback'
                                disablePictureInPicture
                                onPointerDown={event => {
                                    event.stopPropagation();
                                    sourceLightboxBackdropDownRef.current = false;
                                }}
                                onMouseDown={event => {
                                    event.stopPropagation();
                                    sourceLightboxBackdropDownRef.current = false;
                                }}
                                onMouseUp={() => {
                                    sourceLightboxBackdropDownRef.current = false;
                                }}
                                onClick={event => event.stopPropagation()}
                                onLoadedMetadata={event => {
                                    const el = event.currentTarget;
                                    if (el.videoWidth > 0 && el.videoHeight > 0) {
                                        setSourceZoomAspectRatio(el.videoWidth / el.videoHeight);
                                    }
                                    const saved = sourceZoomMediaStateRef.current;
                                    try {
                                        el.volume = Math.max(0, Math.min(1, saved.volume));
                                        el.muted = saved.muted;
                                    } catch {
                                        // Ignore volume restore error
                                    }
                                    if (
                                        saved.currentTime > 0 &&
                                        (!Number.isFinite(el.duration) || saved.currentTime < el.duration - 0.15)
                                    ) {
                                        try {
                                            el.currentTime = saved.currentTime;
                                        } catch {
                                            // Ignore seek error
                                        }
                                    }
                                    saved.restoredUrl = resolvedSourceZoomUrl;
                                    const playPromise = el.play?.();
                                    if (playPromise && typeof playPromise.catch === 'function') {
                                        playPromise.catch(() => undefined);
                                    }
                                }}
                                onTimeUpdate={event => {
                                    const el = event.currentTarget;
                                    if (
                                        sourceZoomMediaStateRef.current.restoredUrl === resolvedSourceZoomUrl &&
                                        el.readyState >= 1
                                    ) {
                                        sourceZoomMediaStateRef.current.currentTime = el.currentTime;
                                    }
                                }}
                                onVolumeChange={event => {
                                    const el = event.currentTarget;
                                    sourceZoomMediaStateRef.current.volume = el.volume;
                                    sourceZoomMediaStateRef.current.muted = el.muted;
                                }}
                            />
                        ) : (
                            <img
                                key={sourceZoomItem.id || sourceZoomItem.path || resolvedSourceZoomUrl}
                                className='nmx-comic-studio-lightbox-image'
                                src={resolvedSourceZoomUrl}
                                alt={sourceZoomItem.title}
                                draggable={false}
                                onPointerDown={event => {
                                    event.stopPropagation();
                                    sourceLightboxBackdropDownRef.current = false;
                                }}
                                onMouseDown={event => {
                                    event.stopPropagation();
                                    sourceLightboxBackdropDownRef.current = false;
                                }}
                                onMouseUp={() => {
                                    sourceLightboxBackdropDownRef.current = false;
                                }}
                                onClick={event => event.stopPropagation()}
                            />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
