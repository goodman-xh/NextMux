import { componentDomainMessage } from './nextmux-component-domain-locale';
import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { DESKTOP_VOICES, type DesktopComponentId, type DesktopComponentState, type DesktopComponentsState } from '../common/nextmux-components';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

/**
 * Settings → Downloads: open-source tools NextMux fetches after installation instead of carrying
 * them in the installer (see common/nextmux-components.ts). Each row says what the tool is for,
 * where the working copy comes from, and offers download / cancel / remove.
 */

type Key = 'auto' | 'autoHint' | 'folder' | 'recommended' | 'download' | 'cancel' | 'remove' | 'retry' | 'website'
    | 'ready' | 'missing' | 'queued' | 'downloading' | 'installing' | 'failed' | 'unsupported' | 'external' | 'connected'
    | 'downloaded' | 'bundled' | 'system' | 'configured' | 'size' | 'installed' | 'loading'
    | 'ffmpeg' | 'ffmpegLead' | 'engine' | 'engineLead' | 'sensevoice' | 'sensevoiceLead' | 'whisper' | 'whisperLead' | 'chromium' | 'chromiumLead' | 'comfy' | 'comfyLead'
    | 'voiceEngine' | 'voiceEngineLead' | 'voiceModel' | 'voiceModelLead' | 'voicePick' | 'voicePreview';

const text: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<Key, string>>>> = {
    'zh-CN': { auto: '自动在后台下载推荐项目', autoHint: "首次启动后在后台依次下载 FFmpeg、适合界面语言的字幕识别模型，以及中文/英文的自然语音", folder: '打开下载文件夹', recommended: '推荐',
        download: '下载', cancel: '取消', remove: '删除', retry: '重试', website: '官网', ready: '已就绪', missing: '未下载', queued: '排队中', downloading: '下载中', installing: '安装中', failed: '下载失败', unsupported: '此系统不支持', external: '需单独安装', connected: '已连接',
        downloaded: '已下载', bundled: '随应用附带', system: '使用本机已安装的版本', configured: '使用自定义路径', size: '约 {size}', installed: '占用 {size}', loading: '正在读取…',
        ffmpeg: 'FFmpeg', ffmpegLead: '漫剧剪辑、导出成片和从音轨识别字幕都要用到的音视频工具。', engine: '字幕识别引擎（sherpa-onnx）', engineLead: '在本机把音轨识别成带时间的字幕，音频不会上传。', sensevoice: '识别模型 · 中英日韩粤（SenseVoice）', sensevoiceLead: '中文、英文、日文、韩文和粤语识别效果最好。',
        whisper: '识别模型 · 多语言（Whisper）', whisperLead: '其他语言使用。', chromium: '浏览器自动化用的 Chromium', chromiumLead: '只有电脑上没有 Chrome 或 Edge 时，AI 操作浏览器才需要它。', comfy: 'ComfyUI', comfyLead: '本机图像生成工作流，需要单独安装；装好后在“媒体设置”里填写地址。', voiceEngine: "朗读引擎（sherpa-onnx）", voiceEngineLead: "在本机合成语音，文字不会上传。", voiceModel: "自然语音 · 中英文（Kokoro）", voiceModelLead: "语音剪辑等回复用接近真人的声音朗读，完全在本机运行。", voicePick: "朗读声音", voicePreview: "试听" },
    'zh-TW': { auto: '自動在背景下載推薦項目', autoHint: "首次啟動後在背景依序下載 FFmpeg、適合介面語言的字幕辨識模型，以及中文／英文的自然語音", folder: '開啟下載資料夾', recommended: '推薦',
        download: '下載', cancel: '取消', remove: '刪除', retry: '重試', website: '官網', ready: '已就緒', missing: '未下載', queued: '排隊中', downloading: '下載中', installing: '安裝中', failed: '下載失敗', unsupported: '此系統不支援', external: '需另外安裝', connected: '已連線',
        downloaded: '已下載', bundled: '隨應用附帶', system: '使用本機已安裝的版本', configured: '使用自訂路徑', size: '約 {size}', installed: '佔用 {size}', loading: '正在讀取…',
        ffmpeg: 'FFmpeg', ffmpegLead: '漫劇剪輯、匯出成片和從音軌辨識字幕都要用到的影音工具。', engine: '字幕辨識引擎（sherpa-onnx）', engineLead: '在本機把音軌辨識成帶時間的字幕，音訊不會上傳。', sensevoice: '辨識模型 · 中英日韓粵（SenseVoice）', sensevoiceLead: '中文、英文、日文、韓文和粵語辨識效果最好。',
        whisper: '辨識模型 · 多語言（Whisper）', whisperLead: '其他語言使用。', chromium: '瀏覽器自動化用的 Chromium', chromiumLead: '只有電腦上沒有 Chrome 或 Edge 時，AI 操作瀏覽器才需要它。', comfy: 'ComfyUI', comfyLead: '本機圖像生成工作流，需要另外安裝；裝好後在「媒體設定」填寫位址。', voiceEngine: "朗讀引擎（sherpa-onnx）", voiceEngineLead: "在本機合成語音，文字不會上傳。", voiceModel: "自然語音 · 中英文（Kokoro）", voiceModelLead: "語音剪輯等回覆用接近真人的聲音朗讀，完全在本機執行。", voicePick: "朗讀聲音", voicePreview: "試聽" },
    en: { auto: 'Download recommended items in the background', autoHint: "After the first launch, in order: FFmpeg, the subtitle model for your language, then the Chinese/English natural voice", folder: 'Open download folder', recommended: 'Recommended',
        download: 'Download', cancel: 'Cancel', remove: 'Remove', retry: 'Retry', website: 'Website', ready: 'Ready', missing: 'Not downloaded', queued: 'Queued', downloading: 'Downloading', installing: 'Installing', failed: 'Download failed', unsupported: 'Not available for this system', external: 'Installed separately', connected: 'Connected',
        downloaded: 'Downloaded', bundled: 'Comes with the app', system: 'Using the copy installed on this computer', configured: 'Using a custom path', size: 'about {size}', installed: 'uses {size}', loading: 'Loading…',
        ffmpeg: 'FFmpeg', ffmpegLead: 'Audio and video tool for comic editing, export and subtitle recognition.', engine: 'Subtitle recogniser (sherpa-onnx)', engineLead: 'Turns sound tracks into timed subtitles on this computer; audio is never uploaded.', sensevoice: 'Model · Chinese, English, Japanese, Korean (SenseVoice)', sensevoiceLead: 'Best for Chinese, English, Japanese, Korean and Cantonese.',
        whisper: 'Model · multilingual (Whisper)', whisperLead: 'Used for other languages.', chromium: 'Chromium for browser automation', chromiumLead: 'Only needed when this computer has no Chrome or Edge.', comfy: 'ComfyUI', comfyLead: 'Local image workflows, installed separately; then enter its address in media settings.', voiceEngine: "Speech synthesiser (sherpa-onnx)", voiceEngineLead: "Turns replies into speech on this computer; the text is never uploaded.", voiceModel: "Natural voices · Chinese & English (Kokoro)", voiceModelLead: "Replies such as voice editing are read in a near-human voice, entirely on this computer.", voicePick: "Voice", voicePreview: "Listen" },
    ja: { auto: '推奨項目をバックグラウンドでダウンロード', autoHint: "初回起動後に FFmpeg、表示言語に合う字幕モデル、中国語／英語の自然な音声の順にダウンロード", folder: 'ダウンロードフォルダを開く', recommended: '推奨',
        download: 'ダウンロード', cancel: 'キャンセル', remove: '削除', retry: '再試行', website: '公式サイト', ready: '利用可能', missing: '未ダウンロード', queued: '待機中', downloading: 'ダウンロード中', installing: 'インストール中', failed: 'ダウンロード失敗', unsupported: 'このシステムでは利用不可', external: '別途インストール', connected: '接続済み',
        downloaded: 'ダウンロード済み', bundled: 'アプリに同梱', system: 'このパソコンにある版を使用', configured: 'カスタムパスを使用', size: '約 {size}', installed: '{size} 使用', loading: '読み込み中…',
        ffmpeg: 'FFmpeg', ffmpegLead: 'コミックの編集・書き出し・字幕認識に使う音声／動画ツール。', engine: '字幕認識エンジン（sherpa-onnx）', engineLead: '音声をこのパソコン上でタイムコード付き字幕にします。音声はアップロードされません。', sensevoice: 'モデル · 中英日韓粤（SenseVoice）', sensevoiceLead: '中国語・英語・日本語・韓国語・広東語に最適。',
        whisper: 'モデル · 多言語（Whisper）', whisperLead: 'その他の言語に使用。', chromium: 'ブラウザ自動化用 Chromium', chromiumLead: 'Chrome や Edge がない場合のみ必要です。', comfy: 'ComfyUI', comfyLead: 'ローカル画像ワークフロー。別途インストールし、メディア設定でアドレスを入力します。', voiceEngine: "読み上げエンジン（sherpa-onnx）", voiceEngineLead: "このパソコンで音声を合成し、テキストは送信しません。", voiceModel: "自然な音声 · 中国語・英語（Kokoro）", voiceModelLead: "音声編集などの返答を人に近い声で読み上げます（すべてこのパソコン上）。", voicePick: "読み上げの声", voicePreview: "試聴" },
    ko: { auto: '추천 항목을 백그라운드에서 다운로드', autoHint: "첫 실행 후 FFmpeg, 화면 언어에 맞는 자막 모델, 중국어/영어 자연스러운 음성을 차례로 받습니다", folder: '다운로드 폴더 열기', recommended: '추천',
        download: '다운로드', cancel: '취소', remove: '삭제', retry: '다시 시도', website: '웹사이트', ready: '준비됨', missing: '받지 않음', queued: '대기 중', downloading: '다운로드 중', installing: '설치 중', failed: '다운로드 실패', unsupported: '이 시스템에서는 사용할 수 없음', external: '별도 설치', connected: '연결됨',
        downloaded: '다운로드됨', bundled: '앱에 포함', system: '이 컴퓨터에 설치된 버전 사용', configured: '사용자 지정 경로 사용', size: '약 {size}', installed: '{size} 사용', loading: '불러오는 중…',
        ffmpeg: 'FFmpeg', ffmpegLead: '코믹 편집, 내보내기, 자막 인식에 쓰는 오디오·비디오 도구입니다.', engine: '자막 인식 엔진(sherpa-onnx)', engineLead: '이 컴퓨터에서 오디오를 시간 정보가 있는 자막으로 바꿉니다. 오디오는 업로드되지 않습니다.', sensevoice: '모델 · 중·영·일·한·광둥어(SenseVoice)', sensevoiceLead: '중국어, 영어, 일본어, 한국어, 광둥어에 가장 좋습니다.',
        whisper: '모델 · 다국어(Whisper)', whisperLead: '그 밖의 언어에 사용합니다.', chromium: '브라우저 자동화용 Chromium', chromiumLead: 'Chrome이나 Edge가 없을 때만 필요합니다.', comfy: 'ComfyUI', comfyLead: '로컬 이미지 워크플로입니다. 별도로 설치한 뒤 미디어 설정에 주소를 입력하세요.', voiceEngine: "읽기 엔진(sherpa-onnx)", voiceEngineLead: "이 컴퓨터에서 음성을 합성하며 텍스트는 올리지 않습니다.", voiceModel: "자연스러운 음성 · 중국어·영어(Kokoro)", voiceModelLead: "음성 편집 등의 답변을 사람에 가까운 목소리로 읽어 줍니다. 모두 이 컴퓨터에서 실행됩니다.", voicePick: "읽기 목소리", voicePreview: "미리 듣기" },
    es: { auto: 'Descargar en segundo plano lo recomendado', autoHint: "Tras el primer inicio, por orden: FFmpeg, el modelo de subtítulos de tu idioma y la voz natural en chino/inglés", folder: 'Abrir carpeta de descargas', recommended: 'Recomendado',
        download: 'Descargar', cancel: 'Cancelar', remove: 'Eliminar', retry: 'Reintentar', website: 'Sitio web', ready: 'Listo', missing: 'Sin descargar', queued: 'En cola', downloading: 'Descargando', installing: 'Instalando', failed: 'Error de descarga', unsupported: 'No disponible en este sistema', external: 'Se instala aparte', connected: 'Conectado',
        downloaded: 'Descargado', bundled: 'Incluido en la app', system: 'Usa la copia instalada en este equipo', configured: 'Usa una ruta personalizada', size: 'unos {size}', installed: 'ocupa {size}', loading: 'Cargando…',
        ffmpeg: 'FFmpeg', ffmpegLead: 'Herramienta de audio y vídeo para editar, exportar y reconocer subtítulos.', engine: 'Reconocedor de subtítulos (sherpa-onnx)', engineLead: 'Convierte el audio en subtítulos con tiempos en este equipo; el audio no se sube.', sensevoice: 'Modelo · chino, inglés, japonés, coreano (SenseVoice)', sensevoiceLead: 'Mejor para chino, inglés, japonés, coreano y cantonés.',
        whisper: 'Modelo · multilingüe (Whisper)', whisperLead: 'Para los demás idiomas.', chromium: 'Chromium para automatizar el navegador', chromiumLead: 'Solo si este equipo no tiene Chrome ni Edge.', comfy: 'ComfyUI', comfyLead: 'Flujos de imagen locales; se instala aparte y luego se indica su dirección en los ajustes de medios.', voiceEngine: "Sintetizador de voz (sherpa-onnx)", voiceEngineLead: "Convierte las respuestas en voz en este equipo; el texto no se sube.", voiceModel: "Voces naturales · chino e inglés (Kokoro)", voiceModelLead: "Respuestas como la edición por voz se leen con una voz casi humana, todo en este equipo.", voicePick: "Voz", voicePreview: "Escuchar" },
    fr: { auto: 'Télécharger en arrière-plan les éléments recommandés', autoHint: "Après le premier lancement, dans l’ordre : FFmpeg, le modèle de sous-titres de votre langue, puis la voix naturelle chinois/anglais", folder: 'Ouvrir le dossier', recommended: 'Recommandé',
        download: 'Télécharger', cancel: 'Annuler', remove: 'Supprimer', retry: 'Réessayer', website: 'Site web', ready: 'Prêt', missing: 'Non téléchargé', queued: 'En attente', downloading: 'Téléchargement', installing: 'Installation', failed: 'Échec du téléchargement', unsupported: 'Indisponible sur ce système', external: 'Installé séparément', connected: 'Connecté',
        downloaded: 'Téléchargé', bundled: 'Fourni avec l’app', system: 'Utilise la copie installée', configured: 'Utilise un chemin personnalisé', size: 'environ {size}', installed: 'occupe {size}', loading: 'Chargement…',
        ffmpeg: 'FFmpeg', ffmpegLead: 'Outil audio et vidéo pour le montage, l’export et la reconnaissance des sous-titres.', engine: 'Reconnaissance de sous-titres (sherpa-onnx)', engineLead: 'Transforme l’audio en sous-titres minutés sur cet ordinateur, sans l’envoyer.', sensevoice: 'Modèle · chinois, anglais, japonais, coréen (SenseVoice)', sensevoiceLead: 'Idéal pour le chinois, l’anglais, le japonais, le coréen et le cantonais.',
        whisper: 'Modèle · multilingue (Whisper)', whisperLead: 'Pour les autres langues.', chromium: 'Chromium pour l’automatisation du navigateur', chromiumLead: 'Utile seulement sans Chrome ni Edge.', comfy: 'ComfyUI', comfyLead: 'Flux d’images locaux, à installer séparément puis à renseigner dans les réglages médias.', voiceEngine: "Synthèse vocale (sherpa-onnx)", voiceEngineLead: "Lit les réponses sur cet ordinateur ; le texte n’est jamais envoyé.", voiceModel: "Voix naturelles · chinois et anglais (Kokoro)", voiceModelLead: "Les réponses (montage à la voix…) sont lues d’une voix presque humaine, entièrement sur cet ordinateur.", voicePick: "Voix", voicePreview: "Écouter" },
    de: { auto: 'Empfohlenes im Hintergrund laden', autoHint: "Nach dem ersten Start der Reihe nach: FFmpeg, das Untertitelmodell deiner Sprache, dann die natürliche Stimme (Chinesisch/Englisch)", folder: 'Download-Ordner öffnen', recommended: 'Empfohlen',
        download: 'Laden', cancel: 'Abbrechen', remove: 'Entfernen', retry: 'Erneut', website: 'Website', ready: 'Bereit', missing: 'Nicht geladen', queued: 'Wartet', downloading: 'Wird geladen', installing: 'Wird installiert', failed: 'Download fehlgeschlagen', unsupported: 'Für dieses System nicht verfügbar', external: 'Separat installiert', connected: 'Verbunden',
        downloaded: 'Geladen', bundled: 'In der App enthalten', system: 'Nutzt die installierte Version', configured: 'Nutzt einen eigenen Pfad', size: 'etwa {size}', installed: 'belegt {size}', loading: 'Wird gelesen…',
        ffmpeg: 'FFmpeg', ffmpegLead: 'Audio- und Videowerkzeug für Schnitt, Export und Untertitelerkennung.', engine: 'Untertitelerkennung (sherpa-onnx)', engineLead: 'Macht aus Tonspuren Untertitel mit Zeiten – lokal, ohne Upload.', sensevoice: 'Modell · Chinesisch, Englisch, Japanisch, Koreanisch (SenseVoice)', sensevoiceLead: 'Am besten für Chinesisch, Englisch, Japanisch, Koreanisch und Kantonesisch.',
        whisper: 'Modell · mehrsprachig (Whisper)', whisperLead: 'Für andere Sprachen.', chromium: 'Chromium für Browser-Automation', chromiumLead: 'Nur nötig ohne Chrome oder Edge.', comfy: 'ComfyUI', comfyLead: 'Lokale Bild-Workflows, separat installiert; dann Adresse in den Medien-Einstellungen eintragen.', voiceEngine: "Sprachsynthese (sherpa-onnx)", voiceEngineLead: "Liest Antworten auf diesem Computer vor; der Text wird nicht hochgeladen.", voiceModel: "Natürliche Stimmen · Chinesisch & Englisch (Kokoro)", voiceModelLead: "Antworten wie beim Sprachschnitt werden mit fast menschlicher Stimme gelesen – komplett lokal.", voicePick: "Stimme", voicePreview: "Anhören" },
    'pt-BR': { auto: 'Baixar em segundo plano os itens recomendados', autoHint: "Após o primeiro início, em ordem: FFmpeg, o modelo de legendas do seu idioma e a voz natural em chinês/inglês", folder: 'Abrir pasta de downloads', recommended: 'Recomendado',
        download: 'Baixar', cancel: 'Cancelar', remove: 'Remover', retry: 'Tentar de novo', website: 'Site', ready: 'Pronto', missing: 'Não baixado', queued: 'Na fila', downloading: 'Baixando', installing: 'Instalando', failed: 'Falha no download', unsupported: 'Indisponível neste sistema', external: 'Instalado à parte', connected: 'Conectado',
        downloaded: 'Baixado', bundled: 'Vem com o app', system: 'Usa a cópia instalada neste computador', configured: 'Usa um caminho personalizado', size: 'cerca de {size}', installed: 'ocupa {size}', loading: 'Carregando…',
        ffmpeg: 'FFmpeg', ffmpegLead: 'Ferramenta de áudio e vídeo para editar, exportar e reconhecer legendas.', engine: 'Reconhecedor de legendas (sherpa-onnx)', engineLead: 'Transforma o áudio em legendas com tempos neste computador, sem enviar nada.', sensevoice: 'Modelo · chinês, inglês, japonês, coreano (SenseVoice)', sensevoiceLead: 'Melhor para chinês, inglês, japonês, coreano e cantonês.',
        whisper: 'Modelo · multilíngue (Whisper)', whisperLead: 'Para os demais idiomas.', chromium: 'Chromium para automação do navegador', chromiumLead: 'Só é preciso sem Chrome ou Edge.', comfy: 'ComfyUI', comfyLead: 'Fluxos de imagem locais, instalados à parte; depois informe o endereço nos ajustes de mídia.', voiceEngine: "Sintetizador de voz (sherpa-onnx)", voiceEngineLead: "Transforma respostas em fala neste computador; o texto não é enviado.", voiceModel: "Vozes naturais · chinês e inglês (Kokoro)", voiceModelLead: "Respostas como a edição por voz são lidas com voz quase humana, tudo neste computador.", voicePick: "Voz", voicePreview: "Ouvir" },
    ru: { auto: 'Скачивать рекомендуемое в фоне', autoHint: "После первого запуска по порядку: FFmpeg, модель субтитров для вашего языка и естественный голос (китайский/английский)", folder: 'Открыть папку загрузок', recommended: 'Рекомендуется',
        download: 'Скачать', cancel: 'Отмена', remove: 'Удалить', retry: 'Повторить', website: 'Сайт', ready: 'Готово', missing: 'Не скачано', queued: 'В очереди', downloading: 'Скачивается', installing: 'Устанавливается', failed: 'Ошибка загрузки', unsupported: 'Недоступно для этой системы', external: 'Устанавливается отдельно', connected: 'Подключено',
        downloaded: 'Скачано', bundled: 'Входит в приложение', system: 'Используется установленная копия', configured: 'Используется свой путь', size: 'около {size}', installed: 'занимает {size}', loading: 'Загрузка…',
        ffmpeg: 'FFmpeg', ffmpegLead: 'Инструмент для монтажа, экспорта и распознавания субтитров.', engine: 'Распознавание субтитров (sherpa-onnx)', engineLead: 'Превращает звук в субтитры с таймингом прямо на компьютере, без отправки.', sensevoice: 'Модель · китайский, английский, японский, корейский (SenseVoice)', sensevoiceLead: 'Лучше всего для китайского, английского, японского, корейского и кантонского.',
        whisper: 'Модель · многоязычная (Whisper)', whisperLead: 'Для остальных языков.', chromium: 'Chromium для автоматизации браузера', chromiumLead: 'Нужен, только если нет Chrome или Edge.', comfy: 'ComfyUI', comfyLead: 'Локальные графические процессы; ставится отдельно, адрес указывается в настройках медиа.', voiceEngine: "Синтез речи (sherpa-onnx)", voiceEngineLead: "Озвучивает ответы на этом компьютере; текст никуда не отправляется.", voiceModel: "Естественные голоса · китайский и английский (Kokoro)", voiceModelLead: "Ответы, например при голосовом монтаже, читаются почти человеческим голосом — полностью на компьютере.", voicePick: "Голос", voicePreview: "Прослушать" },
    ar: { auto: 'تنزيل العناصر الموصى بها في الخلفية', autoHint: "بعد التشغيل الأول بالترتيب: FFmpeg، ثم نموذج الترجمة للغتك، ثم الصوت الطبيعي بالصينية/الإنجليزية", folder: 'فتح مجلد التنزيلات', recommended: 'موصى به',
        download: 'تنزيل', cancel: 'إلغاء', remove: 'حذف', retry: 'إعادة المحاولة', website: 'الموقع', ready: 'جاهز', missing: 'غير منزّل', queued: 'في الانتظار', downloading: 'جارٍ التنزيل', installing: 'جارٍ التثبيت', failed: 'فشل التنزيل', unsupported: 'غير متاح لهذا النظام', external: 'يُثبَّت بشكل منفصل', connected: 'متصل',
        downloaded: 'منزّل', bundled: 'مضمّن في التطبيق', system: 'يستخدم النسخة المثبتة على الجهاز', configured: 'يستخدم مسارًا مخصصًا', size: 'نحو {size}', installed: 'يشغل {size}', loading: 'جارٍ القراءة…',
        ffmpeg: 'FFmpeg', ffmpegLead: 'أداة صوت وفيديو للتحرير والتصدير والتعرّف على الترجمة.', engine: 'التعرّف على الترجمة (sherpa-onnx)', engineLead: 'يحوّل الصوت إلى ترجمة بتوقيتات على هذا الجهاز دون رفعه.', sensevoice: 'نموذج · الصينية والإنجليزية واليابانية والكورية (SenseVoice)', sensevoiceLead: 'الأفضل للصينية والإنجليزية واليابانية والكورية والكانتونية.',
        whisper: 'نموذج · متعدد اللغات (Whisper)', whisperLead: 'للغات الأخرى.', chromium: 'Chromium لأتمتة المتصفح', chromiumLead: 'مطلوب فقط عند غياب Chrome وEdge.', comfy: 'ComfyUI', comfyLead: 'مسارات صور محلية تُثبَّت بشكل منفصل، ثم أدخل عنوانها في إعدادات الوسائط.', voiceEngine: "محرك القراءة (sherpa-onnx)", voiceEngineLead: "يحوّل الردود إلى كلام على هذا الجهاز؛ لا يُرفع النص.", voiceModel: "أصوات طبيعية · الصينية والإنجليزية (Kokoro)", voiceModelLead: "تُقرأ الردود مثل التحرير الصوتي بصوت قريب من البشر، بالكامل على هذا الجهاز.", voicePick: "الصوت", voicePreview: "استماع" },
    hi: { auto: 'सुझाए गए आइटम बैकग्राउंड में डाउनलोड करें', autoHint: "पहली बार खोलने के बाद क्रम से: FFmpeg, आपकी भाषा का सबटाइटल मॉडल, फिर चीनी/अंग्रेज़ी स्वाभाविक आवाज़", folder: 'डाउनलोड फ़ोल्डर खोलें', recommended: 'सुझाया गया',
        download: 'डाउनलोड', cancel: 'रद्द करें', remove: 'हटाएँ', retry: 'फिर कोशिश करें', website: 'वेबसाइट', ready: 'तैयार', missing: 'डाउनलोड नहीं हुआ', queued: 'कतार में', downloading: 'डाउनलोड हो रहा है', installing: 'इंस्टॉल हो रहा है', failed: 'डाउनलोड विफल', unsupported: 'इस सिस्टम के लिए उपलब्ध नहीं', external: 'अलग से इंस्टॉल', connected: 'जुड़ा हुआ',
        downloaded: 'डाउनलोड हो गया', bundled: 'ऐप के साथ', system: 'कंप्यूटर पर इंस्टॉल कॉपी उपयोग में', configured: 'कस्टम पथ उपयोग में', size: 'लगभग {size}', installed: '{size} जगह', loading: 'पढ़ रहे हैं…',
        ffmpeg: 'FFmpeg', ffmpegLead: 'कॉमिक संपादन, निर्यात और सबटाइटल पहचान के लिए ऑडियो-वीडियो टूल।', engine: 'सबटाइटल पहचान (sherpa-onnx)', engineLead: 'ऑडियो को इसी कंप्यूटर पर समय सहित सबटाइटल में बदलता है; ऑडियो अपलोड नहीं होता।', sensevoice: 'मॉडल · चीनी, अंग्रेज़ी, जापानी, कोरियाई (SenseVoice)', sensevoiceLead: 'चीनी, अंग्रेज़ी, जापानी, कोरियाई और कैंटोनीज़ के लिए सबसे अच्छा।',
        whisper: 'मॉडल · बहुभाषी (Whisper)', whisperLead: 'अन्य भाषाओं के लिए।', chromium: 'ब्राउज़र ऑटोमेशन के लिए Chromium', chromiumLead: 'केवल तब चाहिए जब Chrome या Edge न हो।', comfy: 'ComfyUI', comfyLead: 'स्थानीय इमेज वर्कफ़्लो, अलग से इंस्टॉल करें; फिर मीडिया सेटिंग में पता भरें।', voiceEngine: "पढ़ने का इंजन (sherpa-onnx)", voiceEngineLead: "जवाबों को इसी कंप्यूटर पर आवाज़ में बदलता है; टेक्स्ट अपलोड नहीं होता।", voiceModel: "स्वाभाविक आवाज़ें · चीनी और अंग्रेज़ी (Kokoro)", voiceModelLead: "वॉइस एडिटिंग जैसे जवाब इंसान जैसी आवाज़ में पढ़े जाते हैं, पूरी तरह इसी कंप्यूटर पर।", voicePick: "आवाज़", voicePreview: "सुनें" },
};

/** The natural voices by DESKTOP_VOICES order, then the sentence a preview reads (in a language the voices speak). */
const VOICE_TEXT: Readonly<Record<string, readonly string[]>> = {
    'zh-CN': ["女声 · 自然", "女声 · 明亮", "男声 · 沉稳", "男声 · 清朗", "英文女声", "你好，我是你的剪辑助手，已经为你前进一秒。"],
    'zh-TW': ["女聲 · 自然", "女聲 · 明亮", "男聲 · 沉穩", "男聲 · 清朗", "英文女聲", "你好，我是你的剪輯助手，已經為你前進一秒。"],
    en: ["Female · natural (Chinese)", "Female · bright (Chinese)", "Male · steady (Chinese)", "Male · clear (Chinese)", "Female (English)", "Hi, I am your editing assistant. Moved forward one second."],
    ja: ["女性 · 自然（中国語）", "女性 · 明るい（中国語）", "男性 · 落ち着いた（中国語）", "男性 · 澄んだ（中国語）", "女性（英語）", "Hi, I am your editing assistant. Moved forward one second."],
    ko: ["여성 · 자연스러운(중국어)", "여성 · 밝은(중국어)", "남성 · 차분한(중국어)", "남성 · 맑은(중국어)", "여성(영어)", "Hi, I am your editing assistant. Moved forward one second."],
    es: ["Mujer · natural (chino)", "Mujer · luminosa (chino)", "Hombre · sereno (chino)", "Hombre · claro (chino)", "Mujer (inglés)", "Hi, I am your editing assistant. Moved forward one second."],
    fr: ["Femme · naturelle (chinois)", "Femme · lumineuse (chinois)", "Homme · posé (chinois)", "Homme · clair (chinois)", "Femme (anglais)", "Hi, I am your editing assistant. Moved forward one second."],
    de: ["Frau · natürlich (Chinesisch)", "Frau · hell (Chinesisch)", "Mann · ruhig (Chinesisch)", "Mann · klar (Chinesisch)", "Frau (Englisch)", "Hi, I am your editing assistant. Moved forward one second."],
    'pt-BR': ["Mulher · natural (chinês)", "Mulher · brilhante (chinês)", "Homem · sereno (chinês)", "Homem · claro (chinês)", "Mulher (inglês)", "Hi, I am your editing assistant. Moved forward one second."],
    ru: ["Женский · естественный (кит.)", "Женский · звонкий (кит.)", "Мужской · спокойный (кит.)", "Мужской · чистый (кит.)", "Женский (англ.)", "Hi, I am your editing assistant. Moved forward one second."],
    ar: ["أنثى · طبيعي (صيني)", "أنثى · مشرق (صيني)", "ذكر · رزين (صيني)", "ذكر · صافٍ (صيني)", "أنثى (إنجليزي)", "Hi, I am your editing assistant. Moved forward one second."],
    hi: ["महिला · स्वाभाविक (चीनी)", "महिला · चमकदार (चीनी)", "पुरुष · स्थिर (चीनी)", "पुरुष · साफ़ (चीनी)", "महिला (अंग्रेज़ी)", "Hi, I am your editing assistant. Moved forward one second."],
};

export function voiceLabel(locale: string, index: number): string {
    return (VOICE_TEXT[locale] || VOICE_TEXT.en)[index] || VOICE_TEXT.en[index] || '';
}

export function voicePreviewSentence(locale: string): string {
    return (VOICE_TEXT[locale] || VOICE_TEXT.en)[5];
}

function uncheckedDownloadsText(locale: NextMuxDesktopLocale, key: Key, values: Readonly<Record<string, string>> = {}): string {
    return (text[locale] || text.en)[key].replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

const ROWS: Readonly<Record<DesktopComponentId, { readonly icon: string; readonly name: Key; readonly lead: Key }>> = {
    ffmpeg: { icon: 'device-camera-video', name: 'ffmpeg', lead: 'ffmpegLead' },
    'speech-engine': { icon: 'mic', name: 'engine', lead: 'engineLead' },
    'speech-sensevoice': { icon: 'symbol-text', name: 'sensevoice', lead: 'sensevoiceLead' },
    'speech-whisper': { icon: 'globe', name: 'whisper', lead: 'whisperLead' },
    'voice-engine': { icon: 'unmute', name: 'voiceEngine', lead: 'voiceEngineLead' },
    'voice-kokoro': { icon: 'account', name: 'voiceModel', lead: 'voiceModelLead' },
    'mcp-chromium': { icon: 'browser', name: 'chromium', lead: 'chromiumLead' },
    comfyui: { icon: 'graph', name: 'comfy', lead: 'comfyLead' },
};

export function DownloadsPanel(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly state?: DesktopComponentsState;
    readonly error?: string;
    readonly formatSize: (bytes: number) => string;
    readonly onDownload: (id: DesktopComponentId) => void;
    readonly onCancel: (id: DesktopComponentId) => void;
    readonly onRemove: (id: DesktopComponentId) => void;
    readonly onAutoDownload: (enabled: boolean) => void;
    readonly onOpenFolder: (path: string) => void;
    readonly onOpenLink: (url: string) => void;
    /** Natural voice: choose one, and hear it (the id being read aloud, if any). */
    readonly onVoice?: (voice: string) => void;
    readonly onPreviewVoice?: (voice: string) => void;
    readonly previewingVoice?: string;
}): React.ReactElement {
    const t = (key: Key, values?: Readonly<Record<string, string>>): string => downloadsText(props.locale, key, values);
    const status = (component: DesktopComponentState): string => {
        if (component.status === 'ready') return component.id === 'comfyui' ? t('connected')
            : [t('ready'), component.source ? t(component.source) : ''].filter(Boolean).join(' · ');
        if (component.status === 'downloading' || component.status === 'installing') {
            const percent = component.downloadBytes && component.receivedBytes ? Math.min(99, Math.floor(component.receivedBytes / component.downloadBytes * 100)) : undefined;
            return component.status === 'installing' ? t('installing') : percent === undefined ? t('downloading') : `${t('downloading')} ${percent}%`;
        }
        return t(component.status);
    };
    return <section className='nmx-settings-panel nmx-downloads'>
        <div className='nmx-downloads-toolbar'>
            <label className='nmx-downloads-auto' title={t('autoHint')}>
                <input type='checkbox' checked={props.state?.autoDownload ?? true} disabled={!props.state} onChange={event => props.onAutoDownload(event.currentTarget.checked)} />
                <span>{t('auto')}</span>
            </label>
            {props.state && <button type='button' className='nmx-link-button' onClick={() => props.onOpenFolder(props.state!.directory)}><i className='codicon codicon-folder-opened' aria-hidden='true'></i>{t('folder')}</button>}
        </div>
        {props.error && <p className='nmx-settings-inline-error' role='alert'>{props.error}</p>}
        {!props.state ? <div className='nmx-settings-empty'><i className='codicon codicon-loading codicon-modifier-spin'></i><span>{t('loading')}</span></div>
            : <ul className='nmx-downloads-list'>{props.state.components.filter(component => component.id !== 'comfyui' && component.id !== 'voice-engine' && component.id !== 'voice-kokoro' && ROWS[component.id]).map(component => {
                const row = ROWS[component.id];
                const busy = component.status === 'queued' || component.status === 'downloading' || component.status === 'installing';
                const percent = component.status === 'downloading' && component.downloadBytes && component.receivedBytes ? Math.min(100, component.receivedBytes / component.downloadBytes * 100) : undefined;
                const meta = [component.version, component.license, component.status === 'ready' && component.installedBytes ? t('installed', { size: props.formatSize(component.installedBytes) })
                    : component.downloadBytes ? t('size', { size: props.formatSize(component.downloadBytes) }) : ''].filter(Boolean).join(' · ');
                return <li key={component.id} className={`nmx-downloads-item is-${component.status}`} data-component={component.id}>
                    <span className='nmx-downloads-icon' aria-hidden='true'><i className={`codicon codicon-${row.icon}`}></i></span>
                    <div className='nmx-downloads-copy'>
                        <strong>{t(row.name)}{component.recommended && <em>{t('recommended')}</em>}</strong>
                        <small>{t(row.lead)}</small>
                        <small className='nmx-downloads-meta' data-nmx-literal>{meta}</small>
                        {percent !== undefined && <span className='nmx-downloads-progress' role='progressbar' aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><i style={{ width: `${percent}%` }}></i></span>}
                        {(component.status === 'failed' || component.status === 'unsupported') && (component.domainError || component.error) && <>
                            <small className='nmx-downloads-error' data-nmx-literal>{component.domainError && componentDomainMessage(props.locale, component.domainError) || t(component.status)}</small>
                            {(component.domainError?.technicalDetails || component.error) && <details className='nmx-downloads-error'>
                                <summary>{componentDomainMessage(props.locale, { code: 'DOMAIN_DETAILS', fallbackEnglish: 'Details' })}</summary>
                                <pre data-nmx-literal>{component.domainError?.technicalDetails || component.error}</pre>
                            </details>}
                        </>}
                        {component.id === 'voice-kokoro' && component.status === 'ready' && props.onVoice && (() => {
                            const chosen = props.state!.voice || (props.locale.startsWith('zh') ? 'zh-female-natural' : 'en-female');
                            // The voices need the engine as well: without it, preview is off and says why (audit A15-05).
                            const engineReady = props.state!.components.some(item => item.id === 'voice-engine' && item.status === 'ready');
                            return <div className='nmx-downloads-voice'>
                                <label><span>{t('voicePick')}</span><select value={chosen} onChange={event => props.onVoice!(event.currentTarget.value)}>
                                    {DESKTOP_VOICES.map((voice, index) => <option key={voice.id} value={voice.id}>{voiceLabel(props.locale, index)}</option>)}</select></label>
                                <button type='button' className='nmx-secondary-button' disabled={Boolean(props.previewingVoice) || !engineReady}
                                    title={engineReady ? undefined : `${t('voiceEngine')} · ${t('missing')}`} onClick={() => props.onPreviewVoice?.(chosen)}>
                                    <i className={`codicon codicon-${props.previewingVoice ? 'loading codicon-modifier-spin' : 'play'}`} aria-hidden='true'></i>{t('voicePreview')}</button>
                            </div>;
                        })()}
                    </div>
                    <span className={`nmx-downloads-status is-${component.status}`}>{status(component)}</span>
                    <div className='nmx-downloads-actions'>
                        {(component.status === 'missing' || component.status === 'failed') && <button type='button' className='nmx-primary-button' onClick={() => props.onDownload(component.id)}>{component.status === 'failed' ? t('retry') : t('download')}</button>}
                        {busy && <button type='button' className='nmx-secondary-button' onClick={() => props.onCancel(component.id)}>{t('cancel')}</button>}
                        {component.removable && !busy && <button type='button' className='nmx-secondary-button' onClick={() => props.onRemove(component.id)}>{t('remove')}</button>}
                        {component.homepage && <button type='button' className='nmx-link-button' title={component.homepage} onClick={() => props.onOpenLink(component.homepage)}>{t('website')}<i className='codicon codicon-link-external' aria-hidden='true'></i></button>}
                    </div>
                </li>;
            })}</ul>}
    </section>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function downloadsText(locale: Parameters<typeof uncheckedDownloadsText>[0], key: Parameters<typeof uncheckedDownloadsText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedDownloadsText>>): string {
    return totalCopy(locale, key, language => uncheckedDownloadsText(language, key, ...rest));
}
