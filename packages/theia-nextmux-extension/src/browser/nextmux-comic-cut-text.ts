import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

/** Copy for the comic editor workspace (剪辑): media library, timeline and clip settings. */
export type ComicCutTextKey =
    | 'import' | 'importing' | 'undo' | 'redo' | 'split' | 'duplicate' | 'delete' | 'zoomIn' | 'zoomOut' | 'fitWidth' | 'export' | 'keyActions' | 'keys'
    | 'media' | 'all' | 'video' | 'image' | 'audio' | 'addToTimeline' | 'asVoice' | 'asMusic' | 'asEffect' | 'dropFiles' | 'formats' | 'used' | 'generated' | 'imported'
    | 'trackVideo' | 'trackVoice' | 'trackMusic' | 'trackEffect' | 'trackSubtitle' | 'dropHere' | 'emptyTimeline'
    | 'clip' | 'noSelection' | 'name' | 'duration' | 'seconds' | 'fit' | 'fitContain' | 'fitCover' | 'motion'
    | 'static' | 'push_in' | 'pull_out' | 'pan_left' | 'pan_right' | 'tilt_up' | 'tilt_down'
    | 'transitionIn' | 'transitionOut' | 'cut' | 'fade' | 'dissolve' | 'fadeIn' | 'fadeOut' | 'volume' | 'audioTracks' | 'remove' | 'extendMusic'
    | 'subtitleLines' | 'noAudio' | 'openStoryboard' | 'skipped' | 'imported1' | 'placeholderClip' | 'imageClip' | 'videoClip' | 'emptyClip' | 'playhead';

type Catalog = Readonly<Record<ComicCutTextKey, string>>;

const zhCN: Catalog = {
    import: '导入素材', importing: '正在导入…', undo: '撤销', redo: '重做', split: '分割', duplicate: '复制', delete: '删除', zoomIn: '放大时间线', zoomOut: '缩小时间线', fitWidth: '适应宽度', export: '导出成片',
    keys: '快捷键',
    keyActions: '空格|播放 / 暂停|后退 1 秒 · 暂停 · 播放（再按加速）|逐帧移动（按住 Shift 每次 1 秒）|跳到开头 / 结尾|在播放位置分割|裁掉播放位置左侧 / 右侧|复制片段|删除片段|撤销|重做|缩放时间线（也可 ⌘ + 滚轮或双指捏合）|时间线适应宽度（也可 Shift+Z）|导出成片',
    media: '素材', all: '全部', video: '视频', image: '图片', audio: '音频', addToTimeline: '添加到时间线', asVoice: '作为配音', asMusic: '作为背景音乐', asEffect: '作为音效',
    dropFiles: '把图片、视频或音频拖到这里，或点“导入素材”', formats: 'PNG · JPG · WebP · MP4 · MOV · WebM · MP3 · WAV · M4A', used: '已使用', generated: 'AI 生成', imported: '已导入',
    trackVideo: '画面', trackVoice: '配音', trackMusic: '音乐', trackEffect: '音效', trackSubtitle: '字幕', dropHere: '松开放到这里', emptyTimeline: '时间线是空的：从左边素材库拖入图片或视频，或直接从电脑拖进来。',
    clip: '片段', noSelection: '点选时间线上的片段来调整时长、画面、转场和声音。', name: '名称', duration: '片段时长', seconds: '秒', fit: '画面', fitContain: '完整显示', fitCover: '铺满裁切', motion: '运镜',
    static: '静止', push_in: '推近', pull_out: '拉远', pan_left: '向左移', pan_right: '向右移', tilt_up: '向上移', tilt_down: '向下移',
    transitionIn: '入场', transitionOut: '出场', cut: '直接切换', fade: '淡入淡出', dissolve: '叠化', fadeIn: '淡入', fadeOut: '淡出', volume: '音量', audioTracks: '声音', remove: '移除', extendMusic: '铺到结尾',
    subtitleLines: '字幕', noAudio: '未添加配音、音乐或音效', openStoryboard: '在分镜中编辑', skipped: '{count} 个文件未导入（格式不支持或超过 512 MB）', imported1: '已导入 {count} 个素材',
    placeholderClip: '未生成', imageClip: '图片', videoClip: '视频', emptyClip: '空镜头', playhead: '播放位置'
};

const zhTW: Catalog = {
    import: '匯入素材', importing: '正在匯入…', undo: '復原', redo: '重做', split: '分割', duplicate: '複製', delete: '刪除', zoomIn: '放大時間軸', zoomOut: '縮小時間軸', fitWidth: '符合寬度', export: '匯出成片',
    keys: '快捷鍵',
    keyActions: '空白鍵|播放 / 暫停|後退 1 秒 · 暫停 · 播放（再按加速）|逐格移動（按住 Shift 每次 1 秒）|跳到開頭 / 結尾|在播放位置分割|裁掉播放位置左側 / 右側|複製片段|刪除片段|復原|重做|縮放時間軸（也可 ⌘ + 滾輪或雙指縮放）|時間軸符合寬度（也可 Shift+Z）|匯出成片',
    media: '素材', all: '全部', video: '影片', image: '圖片', audio: '音訊', addToTimeline: '加入時間軸', asVoice: '作為配音', asMusic: '作為背景音樂', asEffect: '作為音效',
    dropFiles: '把圖片、影片或音訊拖到這裡，或點「匯入素材」', formats: 'PNG · JPG · WebP · MP4 · MOV · WebM · MP3 · WAV · M4A', used: '已使用', generated: 'AI 生成', imported: '已匯入',
    trackVideo: '畫面', trackVoice: '配音', trackMusic: '音樂', trackEffect: '音效', trackSubtitle: '字幕', dropHere: '放開放到這裡', emptyTimeline: '時間軸是空的：從左邊素材庫拖入圖片或影片，或直接從電腦拖進來。',
    clip: '片段', noSelection: '點選時間軸上的片段來調整時長、畫面、轉場和聲音。', name: '名稱', duration: '片段時長', seconds: '秒', fit: '畫面', fitContain: '完整顯示', fitCover: '鋪滿裁切', motion: '運鏡',
    static: '靜止', push_in: '推近', pull_out: '拉遠', pan_left: '向左移', pan_right: '向右移', tilt_up: '向上移', tilt_down: '向下移',
    transitionIn: '入場', transitionOut: '出場', cut: '直接切換', fade: '淡入淡出', dissolve: '疊化', fadeIn: '淡入', fadeOut: '淡出', volume: '音量', audioTracks: '聲音', remove: '移除', extendMusic: '鋪到結尾',
    subtitleLines: '字幕', noAudio: '未加入配音、音樂或音效', openStoryboard: '在分鏡中編輯', skipped: '{count} 個檔案未匯入（格式不支援或超過 512 MB）', imported1: '已匯入 {count} 個素材',
    placeholderClip: '未生成', imageClip: '圖片', videoClip: '影片', emptyClip: '空鏡頭', playhead: '播放位置'
};

const en: Catalog = {
    import: 'Import media', importing: 'Importing…', undo: 'Undo', redo: 'Redo', split: 'Split', duplicate: 'Duplicate', delete: 'Delete', zoomIn: 'Zoom in', zoomOut: 'Zoom out', fitWidth: 'Fit to width', export: 'Export video',
    keys: 'Keyboard shortcuts',
    keyActions: 'Space|Play / pause|Back 1 s · pause · play (again: faster)|Step one frame (Shift: 1 s)|Jump to start / end|Split at the playhead|Trim left / right of the playhead|Duplicate clip|Delete clip|Undo|Redo|Zoom the timeline (or ⌘ + wheel, pinch)|Fit the timeline (or Shift+Z)|Export',
    media: 'Media', all: 'All', video: 'Video', image: 'Images', audio: 'Audio', addToTimeline: 'Add to timeline', asVoice: 'Use as voice-over', asMusic: 'Use as background music', asEffect: 'Use as sound effect',
    dropFiles: 'Drop pictures, videos or audio here, or choose Import media', formats: 'PNG · JPG · WebP · MP4 · MOV · WebM · MP3 · WAV · M4A', used: 'In use', generated: 'AI generated', imported: 'Imported',
    trackVideo: 'Picture', trackVoice: 'Voice', trackMusic: 'Music', trackEffect: 'Effects', trackSubtitle: 'Subtitles', dropHere: 'Drop here', emptyTimeline: 'The timeline is empty: drag pictures or videos in from the media library, or straight from your computer.',
    clip: 'Clip', noSelection: 'Select a clip on the timeline to adjust its length, framing, transitions and sound.', name: 'Name', duration: 'Clip duration', seconds: 's', fit: 'Framing', fitContain: 'Show all', fitCover: 'Fill and crop', motion: 'Camera',
    static: 'Still', push_in: 'Push in', pull_out: 'Pull out', pan_left: 'Pan left', pan_right: 'Pan right', tilt_up: 'Tilt up', tilt_down: 'Tilt down',
    transitionIn: 'In', transitionOut: 'Out', cut: 'Cut', fade: 'Fade', dissolve: 'Dissolve', fadeIn: 'Fade in', fadeOut: 'Fade out', volume: 'Volume', audioTracks: 'Sound', remove: 'Remove', extendMusic: 'Run to the end',
    subtitleLines: 'Subtitles', noAudio: 'No added voice, music or effects', openStoryboard: 'Edit in storyboard', skipped: '{count} files were not imported (unsupported or over 512 MB)', imported1: 'Imported {count} items',
    placeholderClip: 'Not generated', imageClip: 'Picture', videoClip: 'Video', emptyClip: 'Empty shot', playhead: 'Playhead'
};

const ja: Catalog = {
    ...en,
    import: '素材を読み込む', importing: '読み込み中…', undo: '取り消す', redo: 'やり直す', split: '分割', duplicate: '複製', delete: '削除', zoomIn: '拡大', zoomOut: '縮小', fitWidth: '幅に合わせる', export: '動画を書き出す',
    keys: 'ショートカット',
    keyActions: 'Space|再生 / 一時停止|1 秒戻る · 停止 · 再生（もう一度で倍速）|1 コマ移動（Shift で 1 秒）|先頭 / 末尾へ|再生位置で分割|再生位置の左 / 右をカット|クリップを複製|クリップを削除|取り消し|やり直し|タイムラインを拡大縮小（⌘ + ホイール、ピンチも可）|タイムライン全体表示（Shift+Z も可）|書き出し',
    media: '素材', all: 'すべて', video: '動画', image: '画像', audio: '音声', addToTimeline: 'タイムラインに追加', asVoice: 'ナレーションとして使う', asMusic: 'BGM として使う', asEffect: '効果音として使う',
    dropFiles: '画像・動画・音声をここにドロップするか「素材を読み込む」を選択', used: '使用中', generated: 'AI 生成', imported: '読み込み済み',
    trackVideo: '映像', trackVoice: 'ナレーション', trackMusic: '音楽', trackEffect: '効果音', trackSubtitle: '字幕', dropHere: 'ここにドロップ', emptyTimeline: 'タイムラインは空です。素材ライブラリやパソコンから画像・動画をドラッグしてください。',
    clip: 'クリップ', noSelection: 'タイムラインのクリップを選ぶと長さ・画面・トランジション・音を調整できます。', name: '名前', duration: 'クリップの長さ', seconds: '秒', fit: '画面', fitContain: '全体を表示', fitCover: '切り抜いて埋める', motion: 'カメラワーク',
    static: '固定', push_in: 'ズームイン', pull_out: 'ズームアウト', pan_left: '左へパン', pan_right: '右へパン', tilt_up: '上へティルト', tilt_down: '下へティルト',
    transitionIn: '開始', transitionOut: '終了', cut: 'カット', fade: 'フェード', dissolve: 'ディゾルブ', fadeIn: 'フェードイン', fadeOut: 'フェードアウト', volume: '音量', audioTracks: '音', remove: '外す', extendMusic: '最後まで流す',
    subtitleLines: '字幕', noAudio: '追加の音声・音楽・効果音はありません', openStoryboard: '絵コンテで編集', skipped: '{count} 件は読み込めませんでした（非対応形式または 512 MB 超）', imported1: '{count} 件を読み込みました',
    placeholderClip: '未生成', imageClip: '画像', videoClip: '動画', emptyClip: '空のショット', playhead: '再生位置'
};

const ko: Catalog = {
    ...en,
    import: '소재 가져오기', importing: '가져오는 중…', undo: '실행 취소', redo: '다시 실행', split: '분할', duplicate: '복제', delete: '삭제', zoomIn: '확대', zoomOut: '축소', fitWidth: '너비에 맞춤', export: '영상 내보내기',
    keys: '단축키',
    keyActions: 'Space|재생 / 일시정지|1초 뒤로 · 정지 · 재생(다시 누르면 빠르게)|한 프레임 이동(Shift: 1초)|처음 / 끝으로|재생 위치에서 분할|재생 위치 왼쪽 / 오른쪽 잘라내기|클립 복제|클립 삭제|실행 취소|다시 실행|타임라인 확대/축소(⌘ + 휠, 핀치도 가능)|타임라인 맞춤(Shift+Z도 가능)|내보내기',
    media: '소재', all: '전체', video: '영상', image: '이미지', audio: '오디오', addToTimeline: '타임라인에 추가', asVoice: '내레이션으로 사용', asMusic: '배경음악으로 사용', asEffect: '효과음으로 사용',
    dropFiles: '이미지, 영상, 오디오를 여기에 끌어 놓거나 “소재 가져오기”를 누르세요', used: '사용 중', generated: 'AI 생성', imported: '가져옴',
    trackVideo: '화면', trackVoice: '내레이션', trackMusic: '음악', trackEffect: '효과음', trackSubtitle: '자막', dropHere: '여기에 놓기', emptyTimeline: '타임라인이 비어 있습니다. 소재 라이브러리나 컴퓨터에서 이미지·영상을 끌어오세요.',
    clip: '클립', noSelection: '타임라인의 클립을 선택하면 길이, 화면, 전환, 소리를 조정할 수 있습니다.', name: '이름', duration: '클립 길이', seconds: '초', fit: '화면', fitContain: '전체 표시', fitCover: '채우기(자르기)', motion: '카메라 움직임',
    static: '고정', push_in: '줌 인', pull_out: '줌 아웃', pan_left: '왼쪽으로 이동', pan_right: '오른쪽으로 이동', tilt_up: '위로 이동', tilt_down: '아래로 이동',
    transitionIn: '시작', transitionOut: '끝', cut: '컷', fade: '페이드', dissolve: '디졸브', fadeIn: '페이드 인', fadeOut: '페이드 아웃', volume: '볼륨', audioTracks: '소리', remove: '제거', extendMusic: '끝까지 이어 재생',
    subtitleLines: '자막', noAudio: '추가한 음성, 음악, 효과음 없음', openStoryboard: '스토리보드에서 편집', skipped: '파일 {count}개를 가져오지 못했습니다(지원하지 않는 형식 또는 512 MB 초과)', imported1: '소재 {count}개를 가져왔습니다',
    placeholderClip: '생성 전', imageClip: '이미지', videoClip: '영상', emptyClip: '빈 샷', playhead: '재생 위치'
};

const es: Catalog = {
    ...en,
    import: 'Importar medios', importing: 'Importando…', undo: 'Deshacer', redo: 'Rehacer', split: 'Dividir', duplicate: 'Duplicar', delete: 'Eliminar', zoomIn: 'Acercar', zoomOut: 'Alejar', fitWidth: 'Ajustar al ancho', export: 'Exportar vídeo',
    keys: 'Atajos de teclado',
    keyActions: 'Espacio|Reproducir / pausar|Atrás 1 s · pausa · reproducir (otra vez: más rápido)|Avanzar un fotograma (Shift: 1 s)|Ir al inicio / al final|Dividir en el cabezal|Recortar a la izquierda / derecha del cabezal|Duplicar clip|Eliminar clip|Deshacer|Rehacer|Zoom de la línea de tiempo (o ⌘ + rueda, pellizco)|Ajustar la línea de tiempo (o Shift+Z)|Exportar',
    media: 'Medios', all: 'Todo', video: 'Vídeo', image: 'Imágenes', audio: 'Audio', addToTimeline: 'Añadir a la línea de tiempo', asVoice: 'Usar como voz en off', asMusic: 'Usar como música de fondo', asEffect: 'Usar como efecto de sonido',
    dropFiles: 'Suelta aquí imágenes, vídeos o audio, o elige Importar medios', used: 'En uso', generated: 'Generado por IA', imported: 'Importado',
    trackVideo: 'Imagen', trackVoice: 'Voz', trackMusic: 'Música', trackEffect: 'Efectos', trackSubtitle: 'Subtítulos', dropHere: 'Suelta aquí', emptyTimeline: 'La línea de tiempo está vacía: arrastra imágenes o vídeos desde la biblioteca o desde tu ordenador.',
    clip: 'Clip', noSelection: 'Selecciona un clip para ajustar su duración, encuadre, transiciones y sonido.', name: 'Nombre', duration: 'Duración del clip', seconds: 's', fit: 'Encuadre', fitContain: 'Mostrar todo', fitCover: 'Rellenar y recortar', motion: 'Cámara',
    static: 'Fija', push_in: 'Acercar', pull_out: 'Alejar', pan_left: 'Paneo a la izquierda', pan_right: 'Paneo a la derecha', tilt_up: 'Inclinar arriba', tilt_down: 'Inclinar abajo',
    transitionIn: 'Entrada', transitionOut: 'Salida', cut: 'Corte', fade: 'Fundido', dissolve: 'Disolución', fadeIn: 'Fundido de entrada', fadeOut: 'Fundido de salida', volume: 'Volumen', audioTracks: 'Sonido', remove: 'Quitar', extendMusic: 'Hasta el final',
    subtitleLines: 'Subtítulos', noAudio: 'Sin voz, música ni efectos añadidos', openStoryboard: 'Editar en el guion gráfico', skipped: '{count} archivos no se importaron (formato no admitido o más de 512 MB)', imported1: 'Se importaron {count} elementos',
    placeholderClip: 'Sin generar', imageClip: 'Imagen', videoClip: 'Vídeo', emptyClip: 'Plano vacío', playhead: 'Cabezal'
};

const fr: Catalog = {
    ...en,
    import: 'Importer des médias', importing: 'Importation…', undo: 'Annuler', redo: 'Rétablir', split: 'Scinder', duplicate: 'Dupliquer', delete: 'Supprimer', zoomIn: 'Zoom avant', zoomOut: 'Zoom arrière', fitWidth: 'Ajuster à la largeur', export: 'Exporter la vidéo',
    keys: 'Raccourcis clavier',
    keyActions: 'Espace|Lecture / pause|Reculer d’1 s · pause · lecture (encore : plus vite)|Avancer d’une image (Maj : 1 s)|Aller au début / à la fin|Scinder à la tête de lecture|Couper à gauche / à droite de la tête de lecture|Dupliquer le clip|Supprimer le clip|Annuler|Rétablir|Zoomer la timeline (ou ⌘ + molette, pincement)|Ajuster la timeline (ou Maj+Z)|Exporter',
    media: 'Médias', all: 'Tout', video: 'Vidéo', image: 'Images', audio: 'Audio', addToTimeline: 'Ajouter à la timeline', asVoice: 'Utiliser comme voix off', asMusic: 'Utiliser comme musique de fond', asEffect: 'Utiliser comme effet sonore',
    dropFiles: 'Déposez ici des images, vidéos ou sons, ou choisissez Importer des médias', used: 'Utilisé', generated: 'Généré par IA', imported: 'Importé',
    trackVideo: 'Image', trackVoice: 'Voix', trackMusic: 'Musique', trackEffect: 'Effets', trackSubtitle: 'Sous-titres', dropHere: 'Déposer ici', emptyTimeline: 'La timeline est vide : glissez des images ou vidéos depuis la bibliothèque ou votre ordinateur.',
    clip: 'Clip', noSelection: 'Sélectionnez un clip pour régler sa durée, son cadrage, ses transitions et son son.', name: 'Nom', duration: 'Durée du clip', seconds: 's', fit: 'Cadrage', fitContain: 'Tout afficher', fitCover: 'Remplir et recadrer', motion: 'Caméra',
    static: 'Fixe', push_in: 'Zoom avant', pull_out: 'Zoom arrière', pan_left: 'Panoramique gauche', pan_right: 'Panoramique droite', tilt_up: 'Inclinaison haut', tilt_down: 'Inclinaison bas',
    transitionIn: 'Entrée', transitionOut: 'Sortie', cut: 'Coupe', fade: 'Fondu', dissolve: 'Fondu enchaîné', fadeIn: 'Fondu d’entrée', fadeOut: 'Fondu de sortie', volume: 'Volume', audioTracks: 'Son', remove: 'Retirer', extendMusic: 'Jusqu’à la fin',
    subtitleLines: 'Sous-titres', noAudio: 'Aucune voix, musique ou effet ajouté', openStoryboard: 'Modifier dans le storyboard', skipped: '{count} fichiers non importés (format non pris en charge ou plus de 512 Mo)', imported1: '{count} éléments importés',
    placeholderClip: 'Non généré', imageClip: 'Image', videoClip: 'Vidéo', emptyClip: 'Plan vide', playhead: 'Tête de lecture'
};

const de: Catalog = {
    ...en,
    import: 'Medien importieren', importing: 'Wird importiert…', undo: 'Rückgängig', redo: 'Wiederholen', split: 'Teilen', duplicate: 'Duplizieren', delete: 'Löschen', zoomIn: 'Vergrößern', zoomOut: 'Verkleinern', fitWidth: 'An Breite anpassen', export: 'Video exportieren',
    keys: 'Tastenkürzel',
    keyActions: 'Leertaste|Wiedergabe / Pause|1 s zurück · Pause · Wiedergabe (erneut: schneller)|Ein Bild weiter (Umschalt: 1 s)|Zum Anfang / Ende|Am Abspielkopf teilen|Links / rechts vom Abspielkopf kürzen|Clip duplizieren|Clip löschen|Rückgängig|Wiederholen|Timeline zoomen (oder ⌘ + Mausrad, Zwei-Finger)|Timeline einpassen (oder Umschalt+Z)|Exportieren',
    media: 'Medien', all: 'Alle', video: 'Video', image: 'Bilder', audio: 'Audio', addToTimeline: 'Zur Zeitleiste hinzufügen', asVoice: 'Als Sprecherstimme verwenden', asMusic: 'Als Hintergrundmusik verwenden', asEffect: 'Als Soundeffekt verwenden',
    dropFiles: 'Bilder, Videos oder Audio hier ablegen oder „Medien importieren“ wählen', used: 'Verwendet', generated: 'KI-generiert', imported: 'Importiert',
    trackVideo: 'Bild', trackVoice: 'Stimme', trackMusic: 'Musik', trackEffect: 'Effekte', trackSubtitle: 'Untertitel', dropHere: 'Hier ablegen', emptyTimeline: 'Die Zeitleiste ist leer: Ziehen Sie Bilder oder Videos aus der Mediathek oder direkt vom Computer hierher.',
    clip: 'Clip', noSelection: 'Wählen Sie einen Clip, um Länge, Bildausschnitt, Übergänge und Ton anzupassen.', name: 'Name', duration: 'Cliplänge', seconds: 's', fit: 'Bildausschnitt', fitContain: 'Alles zeigen', fitCover: 'Füllen und zuschneiden', motion: 'Kamera',
    static: 'Starr', push_in: 'Heranzoomen', pull_out: 'Herauszoomen', pan_left: 'Schwenk links', pan_right: 'Schwenk rechts', tilt_up: 'Neigen nach oben', tilt_down: 'Neigen nach unten',
    transitionIn: 'Anfang', transitionOut: 'Ende', cut: 'Schnitt', fade: 'Blende', dissolve: 'Überblendung', fadeIn: 'Einblenden', fadeOut: 'Ausblenden', volume: 'Lautstärke', audioTracks: 'Ton', remove: 'Entfernen', extendMusic: 'Bis zum Ende',
    subtitleLines: 'Untertitel', noAudio: 'Keine zusätzliche Stimme, Musik oder Effekte', openStoryboard: 'Im Storyboard bearbeiten', skipped: '{count} Dateien wurden nicht importiert (nicht unterstützt oder über 512 MB)', imported1: '{count} Elemente importiert',
    placeholderClip: 'Nicht erzeugt', imageClip: 'Bild', videoClip: 'Video', emptyClip: 'Leere Einstellung', playhead: 'Abspielposition'
};

const ptBR: Catalog = {
    ...en,
    import: 'Importar mídia', importing: 'Importando…', undo: 'Desfazer', redo: 'Refazer', split: 'Dividir', duplicate: 'Duplicar', delete: 'Excluir', zoomIn: 'Ampliar', zoomOut: 'Reduzir', fitWidth: 'Ajustar à largura', export: 'Exportar vídeo',
    keys: 'Atalhos de teclado',
    keyActions: 'Espaço|Reproduzir / pausar|Voltar 1 s · pausar · reproduzir (de novo: mais rápido)|Avançar um quadro (Shift: 1 s)|Ir ao início / fim|Dividir no cursor|Cortar à esquerda / direita do cursor|Duplicar clipe|Excluir clipe|Desfazer|Refazer|Zoom da linha do tempo (ou ⌘ + roda, pinça)|Ajustar a linha do tempo (ou Shift+Z)|Exportar',
    media: 'Mídia', all: 'Tudo', video: 'Vídeo', image: 'Imagens', audio: 'Áudio', addToTimeline: 'Adicionar à linha do tempo', asVoice: 'Usar como narração', asMusic: 'Usar como música de fundo', asEffect: 'Usar como efeito sonoro',
    dropFiles: 'Solte aqui imagens, vídeos ou áudio, ou escolha Importar mídia', used: 'Em uso', generated: 'Gerado por IA', imported: 'Importado',
    trackVideo: 'Imagem', trackVoice: 'Narração', trackMusic: 'Música', trackEffect: 'Efeitos', trackSubtitle: 'Legendas', dropHere: 'Solte aqui', emptyTimeline: 'A linha do tempo está vazia: arraste imagens ou vídeos da biblioteca ou do seu computador.',
    clip: 'Clipe', noSelection: 'Selecione um clipe para ajustar duração, enquadramento, transições e som.', name: 'Nome', duration: 'Duração do clipe', seconds: 's', fit: 'Enquadramento', fitContain: 'Mostrar tudo', fitCover: 'Preencher e recortar', motion: 'Câmera',
    static: 'Parada', push_in: 'Aproximar', pull_out: 'Afastar', pan_left: 'Panorâmica à esquerda', pan_right: 'Panorâmica à direita', tilt_up: 'Inclinar para cima', tilt_down: 'Inclinar para baixo',
    transitionIn: 'Entrada', transitionOut: 'Saída', cut: 'Corte', fade: 'Esmaecer', dissolve: 'Dissolver', fadeIn: 'Esmaecer entrada', fadeOut: 'Esmaecer saída', volume: 'Volume', audioTracks: 'Som', remove: 'Remover', extendMusic: 'Até o fim',
    subtitleLines: 'Legendas', noAudio: 'Sem voz, música ou efeitos adicionados', openStoryboard: 'Editar no storyboard', skipped: '{count} arquivos não foram importados (formato não suportado ou acima de 512 MB)', imported1: '{count} itens importados',
    placeholderClip: 'Não gerado', imageClip: 'Imagem', videoClip: 'Vídeo', emptyClip: 'Plano vazio', playhead: 'Posição'
};

const ru: Catalog = {
    ...en,
    import: 'Импорт медиа', importing: 'Импорт…', undo: 'Отменить', redo: 'Повторить', split: 'Разрезать', duplicate: 'Дублировать', delete: 'Удалить', zoomIn: 'Увеличить', zoomOut: 'Уменьшить', fitWidth: 'По ширине', export: 'Экспорт видео',
    keys: 'Горячие клавиши',
    keyActions: 'Пробел|Воспроизведение / пауза|Назад на 1 с · пауза · воспроизведение (ещё раз — быстрее)|На один кадр (Shift — 1 с)|В начало / в конец|Разрезать по курсору|Обрезать слева / справа от курсора|Дублировать клип|Удалить клип|Отменить|Повторить|Масштаб таймлайна (или ⌘ + колесо, щипок)|Вписать таймлайн (или Shift+Z)|Экспорт',
    media: 'Медиа', all: 'Все', video: 'Видео', image: 'Изображения', audio: 'Аудио', addToTimeline: 'Добавить на таймлайн', asVoice: 'Как озвучку', asMusic: 'Как фоновую музыку', asEffect: 'Как звуковой эффект',
    dropFiles: 'Перетащите сюда изображения, видео или аудио или выберите «Импорт медиа»', used: 'Используется', generated: 'Создано ИИ', imported: 'Импортировано',
    trackVideo: 'Кадр', trackVoice: 'Озвучка', trackMusic: 'Музыка', trackEffect: 'Эффекты', trackSubtitle: 'Субтитры', dropHere: 'Отпустите здесь', emptyTimeline: 'Таймлайн пуст: перетащите изображения или видео из медиатеки или с компьютера.',
    clip: 'Клип', noSelection: 'Выберите клип на таймлайне, чтобы настроить длительность, кадрирование, переходы и звук.', name: 'Название', duration: 'Длительность клипа', seconds: 'с', fit: 'Кадрирование', fitContain: 'Показать целиком', fitCover: 'Заполнить с обрезкой', motion: 'Камера',
    static: 'Статично', push_in: 'Наезд', pull_out: 'Отъезд', pan_left: 'Панорама влево', pan_right: 'Панорама вправо', tilt_up: 'Наклон вверх', tilt_down: 'Наклон вниз',
    transitionIn: 'Вход', transitionOut: 'Выход', cut: 'Склейка', fade: 'Затемнение', dissolve: 'Наплыв', fadeIn: 'Появление', fadeOut: 'Исчезание', volume: 'Громкость', audioTracks: 'Звук', remove: 'Убрать', extendMusic: 'До конца',
    subtitleLines: 'Субтитры', noAudio: 'Нет добавленной речи, музыки или эффектов', openStoryboard: 'Редактировать в раскадровке', skipped: 'Не импортировано файлов: {count} (формат не поддерживается или больше 512 МБ)', imported1: 'Импортировано: {count}',
    placeholderClip: 'Не создан', imageClip: 'Изображение', videoClip: 'Видео', emptyClip: 'Пустой кадр', playhead: 'Позиция'
};

const ar: Catalog = {
    ...en,
    import: 'استيراد وسائط', importing: 'جارٍ الاستيراد…', undo: 'تراجع', redo: 'إعادة', split: 'تقسيم', duplicate: 'تكرار', delete: 'حذف', zoomIn: 'تكبير', zoomOut: 'تصغير', fitWidth: 'ملاءمة العرض', export: 'تصدير الفيديو',
    keys: 'اختصارات لوحة المفاتيح',
    keyActions: 'مسافة|تشغيل / إيقاف مؤقت|رجوع ثانية · إيقاف · تشغيل (مرة أخرى: أسرع)|إطار واحد (Shift: ثانية)|إلى البداية / النهاية|تقسيم عند مؤشر التشغيل|قص يسار / يمين المؤشر|تكرار المقطع|حذف المقطع|تراجع|إعادة|تكبير الخط الزمني (أو ⌘ + العجلة، القرص)|ملاءمة الخط الزمني (أو Shift+Z)|تصدير',
    media: 'الوسائط', all: 'الكل', video: 'فيديو', image: 'صور', audio: 'صوت', addToTimeline: 'إضافة إلى المخطط الزمني', asVoice: 'استخدام كتعليق صوتي', asMusic: 'استخدام كموسيقى خلفية', asEffect: 'استخدام كمؤثر صوتي',
    dropFiles: 'أفلت الصور أو الفيديو أو الصوت هنا، أو اختر استيراد وسائط', used: 'مستخدم', generated: 'من إنشاء الذكاء الاصطناعي', imported: 'مستورد',
    trackVideo: 'الصورة', trackVoice: 'التعليق', trackMusic: 'الموسيقى', trackEffect: 'المؤثرات', trackSubtitle: 'الترجمة', dropHere: 'أفلت هنا', emptyTimeline: 'المخطط الزمني فارغ: اسحب صورًا أو مقاطع من مكتبة الوسائط أو من جهازك.',
    clip: 'مقطع', noSelection: 'اختر مقطعًا في المخطط الزمني لضبط مدته وتأطيره وانتقالاته وصوته.', name: 'الاسم', duration: 'مدة المقطع', seconds: 'ث', fit: 'التأطير', fitContain: 'إظهار الكل', fitCover: 'ملء مع قص', motion: 'حركة الكاميرا',
    static: 'ثابت', push_in: 'تقريب', pull_out: 'إبعاد', pan_left: 'تحريك يسارًا', pan_right: 'تحريك يمينًا', tilt_up: 'إمالة للأعلى', tilt_down: 'إمالة للأسفل',
    transitionIn: 'البداية', transitionOut: 'النهاية', cut: 'قطع', fade: 'تلاشٍ', dissolve: 'مزج', fadeIn: 'ظهور تدريجي', fadeOut: 'اختفاء تدريجي', volume: 'مستوى الصوت', audioTracks: 'الصوت', remove: 'إزالة', extendMusic: 'حتى النهاية',
    subtitleLines: 'الترجمة', noAudio: 'لم تُضف أصوات أو موسيقى أو مؤثرات', openStoryboard: 'تحرير في لوحة القصة', skipped: 'لم يُستورد {count} ملفًا (صيغة غير مدعومة أو أكبر من 512 ميغابايت)', imported1: 'تم استيراد {count} عنصرًا',
    placeholderClip: 'لم يُنشأ', imageClip: 'صورة', videoClip: 'فيديو', emptyClip: 'لقطة فارغة', playhead: 'موضع التشغيل'
};

const hi: Catalog = {
    ...en,
    import: 'मीडिया आयात करें', importing: 'आयात हो रहा है…', undo: 'पूर्ववत करें', redo: 'फिर से करें', split: 'विभाजित करें', duplicate: 'डुप्लिकेट', delete: 'हटाएँ', zoomIn: 'ज़ूम इन', zoomOut: 'ज़ूम आउट', fitWidth: 'चौड़ाई में फ़िट', export: 'वीडियो निर्यात करें',
    keys: 'कीबोर्ड शॉर्टकट',
    keyActions: 'स्पेस|चलाएँ / रोकें|1 सेकंड पीछे · रोकें · चलाएँ (फिर दबाएँ: तेज़)|एक फ़्रेम आगे (Shift: 1 सेकंड)|शुरुआत / अंत पर जाएँ|प्लेहेड पर विभाजित करें|प्लेहेड के बाएँ / दाएँ काटें|क्लिप डुप्लिकेट करें|क्लिप हटाएँ|पूर्ववत करें|फिर से करें|टाइमलाइन ज़ूम (या ⌘ + व्हील, पिंच)|टाइमलाइन फ़िट (या Shift+Z)|निर्यात',
    media: 'मीडिया', all: 'सभी', video: 'वीडियो', image: 'चित्र', audio: 'ऑडियो', addToTimeline: 'टाइमलाइन में जोड़ें', asVoice: 'वॉइस-ओवर के रूप में', asMusic: 'बैकग्राउंड म्यूज़िक के रूप में', asEffect: 'साउंड इफ़ेक्ट के रूप में',
    dropFiles: 'चित्र, वीडियो या ऑडियो यहाँ छोड़ें, या “मीडिया आयात करें” चुनें', used: 'उपयोग में', generated: 'AI द्वारा बनाया गया', imported: 'आयातित',
    trackVideo: 'दृश्य', trackVoice: 'आवाज़', trackMusic: 'संगीत', trackEffect: 'इफ़ेक्ट', trackSubtitle: 'उपशीर्षक', dropHere: 'यहाँ छोड़ें', emptyTimeline: 'टाइमलाइन खाली है: मीडिया लाइब्रेरी या अपने कंप्यूटर से चित्र या वीडियो खींचें।',
    clip: 'क्लिप', noSelection: 'लंबाई, फ़्रेमिंग, ट्रांज़िशन और ध्वनि बदलने के लिए टाइमलाइन पर एक क्लिप चुनें।', name: 'नाम', duration: 'क्लिप की अवधि', seconds: 'से.', fit: 'फ़्रेमिंग', fitContain: 'पूरा दिखाएँ', fitCover: 'भरें और काटें', motion: 'कैमरा',
    static: 'स्थिर', push_in: 'पास जाएँ', pull_out: 'दूर जाएँ', pan_left: 'बाएँ पैन', pan_right: 'दाएँ पैन', tilt_up: 'ऊपर टिल्ट', tilt_down: 'नीचे टिल्ट',
    transitionIn: 'शुरुआत', transitionOut: 'अंत', cut: 'कट', fade: 'फ़ेड', dissolve: 'डिज़ॉल्व', fadeIn: 'फ़ेड इन', fadeOut: 'फ़ेड आउट', volume: 'वॉल्यूम', audioTracks: 'ध्वनि', remove: 'हटाएँ', extendMusic: 'अंत तक',
    subtitleLines: 'उपशीर्षक', noAudio: 'कोई अतिरिक्त आवाज़, संगीत या ध्वनि प्रभाव नहीं', openStoryboard: 'स्टोरीबोर्ड में संपादित करें', skipped: '{count} फ़ाइलें आयात नहीं हुईं (असमर्थित या 512 MB से बड़ी)', imported1: '{count} आइटम आयात हुए',
    placeholderClip: 'बनाया नहीं गया', imageClip: 'चित्र', videoClip: 'वीडियो', emptyClip: 'खाली शॉट', playhead: 'प्लेहेड'
};

const catalogs: Readonly<Record<NextMuxDesktopLocale, Catalog>> = { 'zh-CN': zhCN, 'zh-TW': zhTW, en, ja, ko, es, fr, de, 'pt-BR': ptBR, ru, ar, hi };

function uncheckedComicCutText(locale: NextMuxDesktopLocale, key: ComicCutTextKey, values?: Readonly<Record<string, string | number>>): string {
    const text = (catalogs[locale] || en)[key];
    return values ? text.replace(/\{(\w+)\}/g, (match, name: string) => values[name] === undefined ? match : String(values[name])) : text;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function comicCutText(locale: Parameters<typeof uncheckedComicCutText>[0], key: Parameters<typeof uncheckedComicCutText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedComicCutText>>): string {
    return totalCopy(locale, key, language => uncheckedComicCutText(language, key, ...rest));
}
