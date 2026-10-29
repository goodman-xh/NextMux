import * as React from '@theia/core/shared/react';
import { comicHomeText, type ComicHomeTextKey } from './nextmux-comic-home-text';
import { MediaDiagnostic } from './nextmux-media-diagnostics';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { ImeInput, ImeTextarea } from './nextmux-ime-field';
import { STOCK_MEDIA_PROVIDERS, STOCK_MEDIA_SITES, type StockMediaProvider, type StockMediaState } from '../common/nextmux-stock-media';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

/**
 * The four ways to start in the comic workspace, each with its own projects:
 *   novel — adapt a novel or script into shots on an infinite canvas
 *   image — bring pictures, describe the motion, a video model animates each one
 *   topic — give a topic; AI writes the narration and makes pictures, voice-over and subtitles
 *            (the idea of MoneyPrinterTurbo: one topic in, one short video out)
 *   music — lyrics (own or AI) and a sound in, a song out; then a cover, and audio or video (nextmux-music-studio.tsx)
 */

export type ComicProjectKind = 'novel' | 'image' | 'topic' | 'music';
export const COMIC_PROJECT_KINDS: readonly ComicProjectKind[] = ['novel', 'image', 'topic', 'music'];

export function comicProjectKindOf(value: string | undefined): ComicProjectKind {
    return value === 'image' || value === 'topic' || value === 'music' ? value : 'novel';
}

type KindKey = 'novel' | 'image' | 'topic' | 'music' | 'novelLead' | 'imageLead' | 'topicLead' | 'musicLead' | 'novelTags' | 'imageTags' | 'topicTags' | 'musicTags' | 'start' | 'projects' | 'empty' | 'newProject'
    | 'statusAll' | 'statusDraft' | 'statusProgress' | 'statusDone' | 'statusExported' | 'statusFailed' | 'statusEmpty' | 'failedBadge' | 'updated' | 'deletedNotice';
type SheetKey = 'imageTitle' | 'imageLead' | 'name' | 'images' | 'imagesDrop' | 'imagesAdd' | 'motion' | 'motionPlaceholder' | 'motionAll' | 'motionAllPlaceholder'
    | 'clipSeconds' | 'aspect' | 'create' | 'creating' | 'cancel' | 'remove' | 'needImages'
    | 'topicTitle' | 'topicLead' | 'topic' | 'topicPlaceholder' | 'length' | 'visual' | 'visualImages' | 'visualVideos' | 'voice' | 'voiceOn' | 'style' | 'stylePlaceholder'
    | 'textModel' | 'needTopic' | 'seconds'
    | 'sources' | 'sourcesLead' | 'sourceOwn' | 'sourceOwnLead' | 'sourceStock' | 'sourceStockLead' | 'sourceAi' | 'sourceAiLead' | 'filesDrop'
    | 'stockProvider' | 'stockKeyPlaceholder' | 'stockKeySaved' | 'stockKeyChange' | 'stockGetKey' | 'stockLicense' | 'needSource' | 'needFiles' | 'needStockKey' | 'noAiNote'
    | 'localUpload' | 'pickFromLibrary' | 'libraryEmpty' | 'saveLocation' | 'chooseFolder' | 'resetFolder';

const kindCopy: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<KindKey, string>>>> = {
    'zh-CN': { novel: '小说转漫剧', image: '图片转视频', topic: '主题一键成片', music: '音乐制作',
        novelLead: '在画布里改编小说、拆分镜头，复用人物定妆照并生成图片、视频，再按镜头链条剪辑成片。',
        imageLead: '上传一张或多张图片，用一句话描述动作，选择视频模型让画面动起来，再剪辑成片。',
        topicLead: '输入一个主题或关键词，AI 写好解说文案，配上画面、配音和字幕，自动合成短视频。', musicLead: '写歌词或让 AI 写，选好曲风和人声，一键生成完整歌曲；再配上封面，导出音频或视频。',
        novelTags: 'AI 拆镜 · 素材库 · 无限画布', imageTags: '批量上传 · 动作描述 · 图生视频', topicTags: 'AI 文案 · 配音字幕 · 一键合成', musicTags: 'AI 写词 · 曲风人声 · 一键成曲',
        start: '开始创作', projects: '{count} 个项目', empty: '还没有项目', newProject: '新建',
        statusAll: '全部', statusDraft: '草稿', statusProgress: '进行中', statusDone: '已完成', statusExported: '已导出', statusFailed: '失败待处理', statusEmpty: '这里还没有项目', failedBadge: '{count} 个失败', updated: '{time} 更新', deletedNotice: '该文件夹项目已被删除' },
    'zh-TW': { novel: '小說轉漫劇', image: '圖片轉影片', topic: '主題一鍵成片', music: '音樂製作',
        novelLead: '在畫布裡改編小說、拆分鏡頭，重用人物定妝照並生成圖片、影片，再依鏡頭鏈條剪輯成片。',
        imageLead: '上傳一張或多張圖片，用一句話描述動作，選擇影片模型讓畫面動起來，再剪輯成片。',
        topicLead: '輸入一個主題或關鍵字，AI 寫好解說文案，配上畫面、配音和字幕，自動合成短影片。', musicLead: '寫歌詞或讓 AI 寫，選好曲風和人聲，一鍵生成完整歌曲；再配上封面，匯出音訊或影片。',
        novelTags: 'AI 拆鏡 · 素材庫 · 無限畫布', imageTags: '批次上傳 · 動作描述 · 圖生影片', topicTags: 'AI 文案 · 配音字幕 · 一鍵合成', musicTags: 'AI 寫詞 · 曲風人聲 · 一鍵成曲',
        start: '開始創作', projects: '{count} 個專案', empty: '還沒有專案', newProject: '新增',
        statusAll: '全部', statusDraft: '草稿', statusProgress: '進行中', statusDone: '已完成', statusExported: '已匯出', statusFailed: '失敗待處理', statusEmpty: '這裡還沒有專案', failedBadge: '{count} 個失敗', updated: '{time} 更新', deletedNotice: '該資料夾專案已被刪除' },
    en: { novel: 'Novel to comic', image: 'Picture to video', topic: 'Topic to video', music: 'Music',
        novelLead: 'Adapt a story on the canvas, plan shots, reuse character references, generate images and video, then edit the shot sequence.',
        imageLead: 'Upload one or more pictures, describe the motion in a sentence and let a video model bring them to life; then edit the film.',
        topicLead: 'Give a topic or keywords: AI writes the narration and adds pictures, voice-over and subtitles, then assembles a short video.', musicLead: 'Write lyrics or let AI write them, pick the sound and voice, and make a full song in one go; add a cover and export audio or video.',
        novelTags: 'AI shot planning · Asset library · Infinite canvas', imageTags: 'Batch upload · Motion prompts · Image to video', topicTags: 'AI script · Voice & subtitles · One click', musicTags: 'AI lyrics · Sound & voice · One-click song',
        start: 'Start creating', projects: '{count} projects', empty: 'No projects yet', newProject: 'New',
        statusAll: 'All', statusDraft: 'Drafts', statusProgress: 'In progress', statusDone: 'Completed', statusExported: 'Exported', statusFailed: 'Needs attention', statusEmpty: 'Nothing here yet', failedBadge: '{count} failed', updated: 'Updated {time}', deletedNotice: 'This project folder or its generated media has been deleted' },
    ja: { novel: '小説からアニメ漫画', image: '画像から動画', topic: 'テーマから動画', music: '音楽制作',
        novelLead: 'キャンバスで物語を脚色し、ショットを構成。人物の参照画像を再利用して画像や動画を生成し、順番に編集します。',
        imageLead: '画像をアップロードして動きを一文で書くと、動画モデルが画像を動かします。あとは編集して完成。',
        topicLead: 'テーマやキーワードを入れると、AI がナレーション原稿を書き、画像・音声・字幕を付けて短い動画にします。', musicLead: '歌詞を書くか AI に書かせ、曲調と歌声を選んでフルコーラスを生成。カバーを付けて音声や動画で書き出せます。',
        novelTags: 'AI ショット構成 · 素材ライブラリ · 無限キャンバス', imageTags: '一括アップロード · 動きの指示 · 画像から動画', topicTags: 'AI 原稿 · 音声と字幕 · ワンクリック', musicTags: 'AI 作詞 · 曲調と歌声 · ワンクリックで曲',
        start: '作成を始める', projects: '{count} 件', empty: 'まだありません', newProject: '新規',
        statusAll: 'すべて', statusDraft: '下書き', statusProgress: '進行中', statusDone: '完成', statusExported: '書き出し済み', statusFailed: '要対応', statusEmpty: 'まだありません', failedBadge: '失敗 {count} 件', updated: '{time} 更新', deletedNotice: 'このフォルダのプロジェクトは削除されました' },
    ko: { novel: '소설로 만화 영상', image: '이미지로 영상', topic: '주제로 영상', music: '음악 제작',
        novelLead: '캔버스에서 이야기를 각색하고 샷을 구성하세요. 인물 참조 이미지를 재사용해 이미지와 영상을 생성한 뒤 순서대로 편집합니다.',
        imageLead: '이미지를 올리고 동작을 한 문장으로 적으면 영상 모델이 이미지를 움직입니다. 편집해서 완성하세요.',
        topicLead: '주제나 키워드를 입력하면 AI가 내레이션 원고를 쓰고 이미지·음성·자막을 붙여 짧은 영상을 만듭니다.', musicLead: '가사를 쓰거나 AI에게 맡기고 장르와 보컬을 골라 한 번에 전체 곡을 만듭니다. 커버를 붙여 오디오나 영상으로 내보내세요.',
        novelTags: 'AI 샷 구성 · 소재 라이브러리 · 무한 캔버스', imageTags: '일괄 업로드 · 동작 설명 · 이미지→영상', topicTags: 'AI 원고 · 음성과 자막 · 원클릭', musicTags: 'AI 작사 · 장르와 보컬 · 원클릭 작곡',
        start: '만들기 시작', projects: '프로젝트 {count}개', empty: '아직 프로젝트가 없습니다', newProject: '새로 만들기',
        statusAll: '전체', statusDraft: '초안', statusProgress: '진행 중', statusDone: '완료', statusExported: '내보냄', statusFailed: '처리 필요', statusEmpty: '아직 없습니다', failedBadge: '실패 {count}건', updated: '{time} 업데이트', deletedNotice: '이 폴더 프로젝트가 삭제되었습니다' },
    es: { novel: 'Novela a cómic', image: 'Imagen a vídeo', topic: 'Tema a vídeo', music: 'Música',
        novelLead: 'Adapta una historia en el lienzo, organiza los planos, reutiliza referencias de personajes y genera imágenes y vídeo para editar la secuencia.',
        imageLead: 'Sube una o varias imágenes, describe el movimiento en una frase y un modelo de vídeo les da vida; luego edita la película.',
        topicLead: 'Escribe un tema o palabras clave: la IA redacta la narración, añade imágenes, voz y subtítulos y monta un vídeo corto.', musicLead: 'Escribe la letra o deja que la IA la escriba, elige sonido y voz y crea una canción completa; añade portada y exporta audio o vídeo.',
        novelTags: 'Planos con IA · Biblioteca · Lienzo infinito', imageTags: 'Subida en lote · Movimiento · Imagen a vídeo', topicTags: 'Guion IA · Voz y subtítulos · Un clic', musicTags: 'Letra con IA · Sonido y voz · Canción en un clic',
        start: 'Empezar', projects: '{count} proyectos', empty: 'Aún no hay proyectos', newProject: 'Nuevo',
        statusAll: 'Todos', statusDraft: 'Borradores', statusProgress: 'En curso', statusDone: 'Completados', statusExported: 'Exportados', statusFailed: 'Requieren atención', statusEmpty: 'Aún no hay nada aquí', failedBadge: '{count} fallidos', updated: 'Actualizado {time}', deletedNotice: 'La carpeta de este proyecto ha sido eliminada' },
    fr: { novel: 'Roman en BD animée', image: 'Image en vidéo', topic: 'Sujet en vidéo', music: 'Musique',
        novelLead: 'Adaptez un récit sur le canevas, organisez les plans, réutilisez les références des personnages, puis générez et montez les images et vidéos.',
        imageLead: 'Importez une ou plusieurs images, décrivez le mouvement en une phrase et un modèle vidéo les anime ; puis montez le film.',
        topicLead: 'Donnez un sujet ou des mots-clés : l’IA écrit la narration, ajoute images, voix off et sous-titres et assemble une courte vidéo.', musicLead: 'Écrivez les paroles ou laissez l’IA les écrire, choisissez le son et la voix, et créez une chanson complète ; ajoutez une pochette et exportez en audio ou en vidéo.',
        novelTags: 'Plans avec IA · Bibliothèque · Canevas infini', imageTags: 'Import en lot · Mouvement · Image en vidéo', topicTags: 'Script IA · Voix et sous-titres · En un clic', musicTags: 'Paroles IA · Son et voix · Chanson en un clic',
        start: 'Commencer', projects: '{count} projets', empty: 'Aucun projet', newProject: 'Nouveau',
        statusAll: 'Tous', statusDraft: 'Brouillons', statusProgress: 'En cours', statusDone: 'Terminés', statusExported: 'Exportés', statusFailed: 'À traiter', statusEmpty: 'Rien ici pour l’instant', failedBadge: '{count} en échec', updated: 'Mis à jour {time}', deletedNotice: 'Le dossier de ce projet a été supprimé' },
    de: { novel: 'Roman zum Comic', image: 'Bild zu Video', topic: 'Thema zu Video', music: 'Musik',
        novelLead: 'Geschichten auf der Leinwand adaptieren, Einstellungen planen, Figurenreferenzen wiederverwenden und Bilder sowie Videos als Sequenz schneiden.',
        imageLead: 'Bilder hochladen, die Bewegung in einem Satz beschreiben – ein Videomodell erweckt sie zum Leben; danach schneiden.',
        topicLead: 'Thema oder Stichwörter angeben: Die KI schreibt den Sprechertext, ergänzt Bilder, Stimme und Untertitel und schneidet ein kurzes Video.', musicLead: 'Songtext selbst schreiben oder von der KI schreiben lassen, Klang und Stimme wählen und einen ganzen Song erstellen; Cover dazu, als Audio oder Video exportieren.',
        novelTags: 'KI-Einstellungen · Mediathek · Unendliche Leinwand', imageTags: 'Stapel-Upload · Bewegung · Bild zu Video', topicTags: 'KI-Text · Stimme & Untertitel · Ein Klick', musicTags: 'KI-Text · Klang & Stimme · Song per Klick',
        start: 'Loslegen', projects: '{count} Projekte', empty: 'Noch keine Projekte', newProject: 'Neu',
        statusAll: 'Alle', statusDraft: 'Entwürfe', statusProgress: 'In Arbeit', statusDone: 'Fertig', statusExported: 'Exportiert', statusFailed: 'Fehler offen', statusEmpty: 'Noch nichts hier', failedBadge: '{count} fehlgeschlagen', updated: 'Aktualisiert {time}', deletedNotice: 'Dieser Projektordner wurde gelöscht' },
    'pt-BR': { novel: 'Romance em quadrinhos', image: 'Imagem em vídeo', topic: 'Tema em vídeo', music: 'Música',
        novelLead: 'Adapte uma história na tela, organize os planos, reutilize referências de personagens e gere imagens e vídeos para editar a sequência.',
        imageLead: 'Envie uma ou mais imagens, descreva o movimento em uma frase e um modelo de vídeo dá vida a elas; depois edite o filme.',
        topicLead: 'Informe um tema ou palavras-chave: a IA escreve a narração, adiciona imagens, voz e legendas e monta um vídeo curto.', musicLead: 'Escreva a letra ou deixe a IA escrever, escolha o som e a voz e crie uma música completa; adicione uma capa e exporte em áudio ou vídeo.',
        novelTags: 'Planos com IA · Biblioteca · Tela infinita', imageTags: 'Envio em lote · Movimento · Imagem em vídeo', topicTags: 'Roteiro IA · Voz e legendas · Um clique', musicTags: 'Letra com IA · Som e voz · Música em um clique',
        start: 'Começar', projects: '{count} projetos', empty: 'Nenhum projeto ainda', newProject: 'Novo',
        statusAll: 'Todos', statusDraft: 'Rascunhos', statusProgress: 'Em andamento', statusDone: 'Concluídos', statusExported: 'Exportados', statusFailed: 'Precisam de atenção', statusEmpty: 'Nada aqui ainda', failedBadge: '{count} com falha', updated: 'Atualizado {time}', deletedNotice: 'A pasta deste projeto foi excluída' },
    ru: { novel: 'Роман в комикс', image: 'Изображение в видео', topic: 'Тема в видео', music: 'Музыка',
        novelLead: 'Адаптируйте историю на холсте, планируйте кадры, используйте референсы персонажей, создавайте изображения и видео и монтируйте последовательность.',
        imageLead: 'Загрузите изображения, опишите движение одной фразой — видеомодель оживит их; затем смонтируйте ролик.',
        topicLead: 'Укажите тему или ключевые слова: ИИ напишет закадровый текст, добавит кадры, озвучку и субтитры и соберёт короткое видео.', musicLead: 'Напишите текст сами или поручите ИИ, выберите звучание и голос и создайте целую песню; добавьте обложку и экспортируйте аудио или видео.',
        novelTags: 'Кадры с ИИ · Библиотека · Бесконечный холст', imageTags: 'Пакетная загрузка · Движение · Изображение в видео', topicTags: 'Текст ИИ · Озвучка и субтитры · В один клик', musicTags: 'Текст от ИИ · Звучание и голос · Песня в один клик',
        start: 'Начать', projects: 'Проектов: {count}', empty: 'Проектов пока нет', newProject: 'Новый',
        statusAll: 'Все', statusDraft: 'Черновики', statusProgress: 'В работе', statusDone: 'Готовые', statusExported: 'Экспортированные', statusFailed: 'Требуют внимания', statusEmpty: 'Здесь пока пусто', failedBadge: 'Ошибок: {count}', updated: 'Обновлено {time}', deletedNotice: 'Папка этого проекта была удалена' },
    ar: { novel: 'رواية إلى قصة مصورة', image: 'صورة إلى فيديو', topic: 'موضوع إلى فيديو', music: 'الموسيقى',
        novelLead: 'حوّل القصة على اللوحة، ورتّب اللقطات، وأعد استخدام صور الشخصيات المرجعية، ثم أنشئ الصور والفيديو وحرّر تسلسل اللقطات.',
        imageLead: 'ارفع صورة أو أكثر وصف الحركة بجملة واحدة ليحرّكها نموذج فيديو، ثم حرّر الفيلم.',
        topicLead: 'اكتب موضوعًا أو كلمات مفتاحية: يكتب الذكاء الاصطناعي التعليق ويضيف الصور والصوت والترجمة ويجمع فيديو قصيرًا.', musicLead: 'اكتب الكلمات أو دع الذكاء الاصطناعي يكتبها، واختر الأسلوب والصوت لتُنشئ أغنية كاملة، ثم أضف غلافًا وصدّرها صوتًا أو فيديو.',
        novelTags: 'تخطيط اللقطات · مكتبة المواد · لوحة غير محدودة', imageTags: 'رفع دفعة · وصف الحركة · صورة إلى فيديو', topicTags: 'نص بالذكاء الاصطناعي · صوت وترجمة · بنقرة', musicTags: 'كلمات بالذكاء الاصطناعي · الأسلوب والصوت · أغنية بنقرة',
        start: 'ابدأ الإنشاء', projects: '{count} مشاريع', empty: 'لا توجد مشاريع بعد', newProject: 'جديد',
        statusAll: 'الكل', statusDraft: 'مسودات', statusProgress: 'قيد التنفيذ', statusDone: 'مكتملة', statusExported: 'مُصدَّرة', statusFailed: 'تحتاج معالجة', statusEmpty: 'لا شيء هنا بعد', failedBadge: '{count} فشل', updated: 'حُدِّث {time}', deletedNotice: 'تم حذف مجلد هذا المشروع' },
    hi: { novel: 'उपन्यास से कॉमिक', image: 'चित्र से वीडियो', topic: 'विषय से वीडियो', music: 'संगीत',
        novelLead: 'कैनवास पर कहानी रूपांतरित करें, शॉट बनाएँ, किरदारों की संदर्भ तस्वीरें दोबारा इस्तेमाल करें और चित्र व वीडियो बनाकर क्रम में संपादित करें।',
        imageLead: 'एक या अधिक चित्र अपलोड करें, एक वाक्य में गति लिखें और वीडियो मॉडल उन्हें जीवंत कर देगा; फिर फ़िल्म संपादित करें।',
        topicLead: 'कोई विषय या कीवर्ड दें: AI कथन लिखता है, चित्र, आवाज़ और उपशीर्षक जोड़ता है और छोटा वीडियो बनाता है।', musicLead: 'बोल ख़ुद लिखें या AI से लिखवाएँ, ध्वनि और आवाज़ चुनें और एक क्लिक में पूरा गीत बनाएँ; कवर जोड़कर ऑडियो या वीडियो निर्यात करें।',
        novelTags: 'AI शॉट योजना · सामग्री लाइब्रेरी · अनंत कैनवास', imageTags: 'बैच अपलोड · गति विवरण · चित्र से वीडियो', topicTags: 'AI स्क्रिप्ट · आवाज़ व उपशीर्षक · एक क्लिक', musicTags: 'AI बोल · ध्वनि और आवाज़ · एक क्लिक में गीत',
        start: 'बनाना शुरू करें', projects: '{count} प्रोजेक्ट', empty: 'अभी कोई प्रोजेक्ट नहीं', newProject: 'नया',
        statusAll: 'सभी', statusDraft: 'ड्राफ़्ट', statusProgress: 'जारी', statusDone: 'पूरे', statusExported: 'एक्सपोर्ट किए गए', statusFailed: 'ध्यान चाहिए', statusEmpty: 'अभी यहाँ कुछ नहीं', failedBadge: '{count} विफल', updated: '{time} अपडेट', deletedNotice: 'इस प्रोजेक्ट का फ़ोल्डर हटा दिया गया है' }
};

const sheetEn: Readonly<Record<SheetKey, string>> = {
    imageTitle: 'Picture to video', imageLead: 'Each picture becomes a shot; the video model animates it following your motion prompt.', name: 'Name',
    images: 'Pictures', imagesDrop: 'Drop pictures here or click to choose (PNG, JPG, WebP)', imagesAdd: 'Add pictures', motion: 'Motion', motionPlaceholder: 'How the picture moves',
    motionAll: 'Motion for every picture', motionAllPlaceholder: 'Used for pictures without their own motion prompt', clipSeconds: 'Length of each clip', aspect: 'Aspect ratio',
    create: 'Create', creating: 'Creating…', cancel: 'Cancel', remove: 'Remove', needImages: 'Add at least one picture.',
    topicTitle: 'Topic to video', topicLead: 'Write a topic or keywords. AI writes the narration and splits it into shots; then generate pictures, voice-over and subtitles in one go.',
    topic: 'Topic or keywords', topicPlaceholder: 'Topic or keywords', length: 'Video length',
    visual: 'Pictures from', visualImages: 'AI images (faster, cheaper)', visualVideos: 'AI video clips', voice: 'Voice-over', voiceOn: 'Generate voice-over and subtitles',
    style: 'Style', stylePlaceholder: 'Optional: documentary, warm and cosy, cyberpunk…', textModel: 'Script model', needTopic: 'Write a topic first.', seconds: 's',
    sources: 'Pictures from (choose any)', sourcesLead: 'Used shot by shot in this order: your files, then stock, then AI for the rest.', sourceOwn: 'My files', sourceOwnLead: 'Your pictures and clips, in the order you add them', sourceStock: 'Free stock', sourceStockLead: 'Photos and clips from Pexels or Pixabay that match each shot', sourceAi: 'AI', sourceAiLead: 'Image or video models make the remaining shots', filesDrop: 'Drop pictures or clips here, or click to choose', stockProvider: 'Stock library', stockKeyPlaceholder: 'Paste your free API key', stockKeySaved: 'API key saved in this computer’s keychain', stockKeyChange: 'Change', stockGetKey: 'Get a free key', stockLicense: 'Free to use commercially; the author and source stay in each file name.', needSource: 'Choose at least one picture source.', needFiles: 'Add at least one picture or clip.', needStockKey: 'Enter the stock library’s API key.', noAiNote: 'Shots without material stay empty; fill them in the editor later.',
    localUpload: 'Upload from computer', pickFromLibrary: 'Pick from asset library', libraryEmpty: 'No matching assets in library yet', saveLocation: 'Save location', chooseFolder: 'Choose folder', resetFolder: 'Default'
};

const sheetCopy: Readonly<Partial<Record<NextMuxDesktopLocale, Readonly<Record<SheetKey, string>>>>> = {
    'zh-CN': { imageTitle: '图片转视频', imageLead: '每张图片会成为一个镜头，视频模型按你的动作描述让它动起来。', name: '名称',
        images: '图片', imagesDrop: '把图片拖到这里，或点击选择（PNG、JPG、WebP）', imagesAdd: '添加图片', motion: '动作描述', motionPlaceholder: '描述画面怎么动',
        motionAll: '统一动作描述', motionAllPlaceholder: '没有单独写动作的图片都用这一句', clipSeconds: '每段时长', aspect: '画面比例',
        create: '创建', creating: '创建中…', cancel: '取消', remove: '移除', needImages: '请至少添加一张图片。',
        topicTitle: '主题一键成片', topicLead: '写下主题或关键词，AI 会写好解说文案并拆成镜头；确认后一键生成画面、配音和字幕。',
        topic: '主题或关键词', topicPlaceholder: '输入主题或关键词', length: '视频时长',
        visual: '画面来源', visualImages: 'AI 生成图片（更快更省）', visualVideos: 'AI 生成视频', voice: '配音', voiceOn: '生成配音和字幕',
        style: '风格', stylePlaceholder: '可选：纪录片、温暖治愈、赛博朋克…', textModel: '文案模型', needTopic: '请先写下主题。', seconds: '秒',
        sources: '画面来源（可多选）', sourcesLead: '逐个镜头按顺序取用：先用你的素材，再用网络素材，剩下的由 AI 生成。', sourceOwn: '我的素材', sourceOwnLead: '你的图片和视频，按添加顺序放进镜头', sourceStock: '网络素材', sourceStockLead: '从免费图库（Pexels / Pixabay）为每个镜头找图片和视频', sourceAi: 'AI 生成', sourceAiLead: '用图片或视频模型生成剩下的镜头', filesDrop: '把图片或视频拖到这里，或点击选择', stockProvider: '图库', stockKeyPlaceholder: '粘贴免费申请的 API Key', stockKeySaved: 'API Key 已保存在本机钥匙串', stockKeyChange: '更换', stockGetKey: '免费申请 Key', stockLicense: '可免费商用，作者和来源会保留在文件名里。', needSource: '请至少选择一种画面来源。', needFiles: '请至少添加一张图片或一段视频。', needStockKey: '请填写图库的 API Key。', noAiNote: '没有素材的镜头会先空着，之后可以在剪辑里补上。',
        localUpload: '本地上传', pickFromLibrary: '从素材库挑选', libraryEmpty: '素材库中还没有可用素材', saveLocation: '保存位置', chooseFolder: '选择文件夹', resetFolder: '默认位置' },
    'zh-TW': { imageTitle: '圖片轉影片', imageLead: '每張圖片會成為一個鏡頭，影片模型依你的動作描述讓它動起來。', name: '名稱',
        images: '圖片', imagesDrop: '把圖片拖到這裡，或點擊選擇（PNG、JPG、WebP）', imagesAdd: '新增圖片', motion: '動作描述', motionPlaceholder: '描述畫面怎麼動',
        motionAll: '統一動作描述', motionAllPlaceholder: '沒有單獨寫動作的圖片都用這一句', clipSeconds: '每段時長', aspect: '畫面比例',
        create: '建立', creating: '建立中…', cancel: '取消', remove: '移除', needImages: '請至少新增一張圖片。',
        topicTitle: '主題一鍵成片', topicLead: '寫下主題或關鍵字，AI 會寫好解說文案並拆成鏡頭；確認後一鍵生成畫面、配音和字幕。',
        topic: '主題或關鍵字', topicPlaceholder: '輸入主題或關鍵字', length: '影片時長',
        visual: '畫面來源', visualImages: 'AI 生成圖片（更快更省）', visualVideos: 'AI 生成影片', voice: '配音', voiceOn: '生成配音和字幕',
        style: '風格', stylePlaceholder: '選填：紀錄片、溫暖療癒、賽博龐克…', textModel: '文案模型', needTopic: '請先寫下主題。', seconds: '秒',
        sources: '畫面來源（可多選）', sourcesLead: '逐個鏡頭依序取用：先用你的素材，再用網路素材，剩下的由 AI 生成。', sourceOwn: '我的素材', sourceOwnLead: '你的圖片和影片，依新增順序放進鏡頭', sourceStock: '網路素材', sourceStockLead: '從免費圖庫（Pexels / Pixabay）為每個鏡頭找圖片和影片', sourceAi: 'AI 生成', sourceAiLead: '用圖片或影片模型生成剩下的鏡頭', filesDrop: '把圖片或影片拖到這裡，或點擊選擇', stockProvider: '圖庫', stockKeyPlaceholder: '貼上免費申請的 API Key', stockKeySaved: 'API Key 已儲存在本機鑰匙圈', stockKeyChange: '更換', stockGetKey: '免費申請 Key', stockLicense: '可免費商用，作者和來源會保留在檔名裡。', needSource: '請至少選擇一種畫面來源。', needFiles: '請至少新增一張圖片或一段影片。', needStockKey: '請填寫圖庫的 API Key。', noAiNote: '沒有素材的鏡頭會先空著，之後可以在剪輯裡補上。',
        localUpload: '本機上傳', pickFromLibrary: '從素材庫挑選', libraryEmpty: '素材庫中還沒有可用素材', saveLocation: '儲存位置', chooseFolder: '選擇資料夾', resetFolder: '預設位置' },
    en: sheetEn,
    ja: { ...sheetEn, imageTitle: '画像から動画', imageLead: '画像ごとに 1 ショットになり、動画モデルが動きの指示どおりに動かします。', name: '名前',
        images: '画像', imagesDrop: '画像をここにドロップ、またはクリックして選択（PNG、JPG、WebP）', imagesAdd: '画像を追加', motion: '動き', motionPlaceholder: '画像の動きを入力',
        motionAll: 'すべての画像の動き', motionAllPlaceholder: '個別の指示がない画像に使います', clipSeconds: '各クリップの長さ', aspect: '画面比率',
        create: '作成', creating: '作成中…', cancel: 'キャンセル', remove: '外す', needImages: '画像を 1 枚以上追加してください。',
        topicTitle: 'テーマから動画', topicLead: 'テーマやキーワードを書くと、AI がナレーション原稿を書いてショットに分けます。そのあと画像・音声・字幕を一括生成します。',
        topic: 'テーマ・キーワード', topicPlaceholder: 'テーマやキーワード', length: '動画の長さ', visual: '映像', visualImages: 'AI 画像（速い・安い）', visualVideos: 'AI 動画',
        voice: 'ナレーション', voiceOn: 'ナレーションと字幕を生成', style: 'スタイル', stylePlaceholder: '任意：ドキュメンタリー、あたたかい雰囲気…', textModel: '原稿モデル', needTopic: '先にテーマを書いてください。', seconds: '秒',
        sources: '映像の素材（複数選択可）', sourcesLead: 'ショットごとにこの順で使います：自分の素材 → フリー素材 → 残りは AI。', sourceOwn: '自分の素材', sourceOwnLead: '画像や動画を追加した順にショットへ', sourceStock: 'フリー素材', sourceStockLead: 'Pexels / Pixabay から各ショットに合う写真や動画を探します', sourceAi: 'AI 生成', sourceAiLead: '残りのショットを画像・動画モデルで生成', filesDrop: '画像や動画をここにドロップ、またはクリックして選択', stockProvider: '素材サイト', stockKeyPlaceholder: '無料で取得した API キーを貼り付け', stockKeySaved: 'API キーはこのパソコンのキーチェーンに保存済み', stockKeyChange: '変更', stockGetKey: '無料でキーを取得', stockLicense: '商用利用可。作者と出典はファイル名に残ります。', needSource: '素材の種類を 1 つ以上選んでください。', needFiles: '画像か動画を 1 つ以上追加してください。', needStockKey: '素材サイトの API キーを入力してください。', noAiNote: '素材のないショットは空のままです。あとで編集で埋められます。',
        localUpload: 'パソコンから選択', pickFromLibrary: '素材ライブラリから選ぶ', libraryEmpty: '素材ライブラリに使える素材がありません', saveLocation: '保存先', chooseFolder: 'フォルダを選択', resetFolder: '規定の場所' },
    ko: { ...sheetEn, imageTitle: '이미지로 영상', imageLead: '이미지마다 샷 하나가 되고, 영상 모델이 동작 설명대로 움직입니다.', name: '이름',
        images: '이미지', imagesDrop: '이미지를 여기로 끌어 놓거나 눌러서 선택하세요(PNG, JPG, WebP)', imagesAdd: '이미지 추가', motion: '동작 설명', motionPlaceholder: '움직임을 설명',
        motionAll: '모든 이미지 동작', motionAllPlaceholder: '따로 적지 않은 이미지에 사용됩니다', clipSeconds: '클립 길이', aspect: '화면 비율',
        create: '만들기', creating: '만드는 중…', cancel: '취소', remove: '제거', needImages: '이미지를 하나 이상 추가하세요.',
        topicTitle: '주제로 영상', topicLead: '주제나 키워드를 적으면 AI가 내레이션을 쓰고 샷으로 나눕니다. 그다음 이미지·음성·자막을 한 번에 생성합니다.',
        topic: '주제 또는 키워드', topicPlaceholder: '주제 또는 키워드', length: '영상 길이', visual: '화면', visualImages: 'AI 이미지(빠르고 저렴)', visualVideos: 'AI 영상',
        voice: '내레이션', voiceOn: '내레이션과 자막 생성', style: '스타일', stylePlaceholder: '선택: 다큐멘터리, 따뜻한 분위기…', textModel: '원고 모델', needTopic: '먼저 주제를 적어 주세요.', seconds: '초',
        sources: '화면 소스(여러 개 선택 가능)', sourcesLead: '샷마다 이 순서로 씁니다: 내 소재 → 무료 스톡 → 나머지는 AI.', sourceOwn: '내 소재', sourceOwnLead: '추가한 순서대로 이미지와 영상을 샷에 넣습니다', sourceStock: '무료 스톡', sourceStockLead: 'Pexels / Pixabay에서 샷마다 어울리는 사진과 영상을 찾습니다', sourceAi: 'AI 생성', sourceAiLead: '남은 샷을 이미지·영상 모델로 생성', filesDrop: '이미지나 영상을 여기로 끌어 놓거나 눌러서 선택하세요', stockProvider: '스톡 사이트', stockKeyPlaceholder: '무료로 받은 API 키를 붙여 넣으세요', stockKeySaved: 'API 키가 이 컴퓨터의 키체인에 저장되어 있습니다', stockKeyChange: '변경', stockGetKey: '무료 키 받기', stockLicense: '상업적으로 무료 사용 가능하며, 작성자와 출처는 파일 이름에 남습니다.', needSource: '화면 소스를 하나 이상 고르세요.', needFiles: '이미지나 영상을 하나 이상 추가하세요.', needStockKey: '스톡 사이트의 API 키를 입력하세요.', noAiNote: '소재가 없는 샷은 비워 두며, 나중에 편집에서 채울 수 있습니다.',
        localUpload: '내 컴퓨터에서 업로드', pickFromLibrary: '소재 라이브러리에서 선택', libraryEmpty: '라이브러리에 사용할 수 있는 소재가 없습니다', saveLocation: '저장 위치', chooseFolder: '폴더 선택', resetFolder: '기본 위치' }
};

type ProjectKey = 'delete' | 'deleteTitle' | 'deleteHint' | 'outsideHint' | 'trash' | 'removeFromList' | 'cancel' | 'deleting' | 'failed' | 'reorderHint' | 'binMac' | 'binWin';

/** Deleting and ordering comic projects ({bin} is the Trash on macOS, the Recycle Bin on Windows). */
const projectCopy: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<ProjectKey, string>>>> = {
    'zh-CN': { delete: '删除', deleteTitle: '删除“{title}”？', deleteHint: '项目文件夹会移到{bin}，需要时可以从{bin}恢复。人物库里的人物会保留。',
        outsideHint: '这个项目不在漫剧库文件夹里，只会从列表中移除，文件夹本身不会动。', trash: '移到{bin}', removeFromList: '从列表移除', cancel: '取消',
        deleting: '正在删除…', failed: '没能删除：{reason}', reorderHint: '长按可拖动调整顺序', binMac: '废纸篓', binWin: '回收站' },
    'zh-TW': { delete: '刪除', deleteTitle: '刪除「{title}」？', deleteHint: '專案資料夾會移到{bin}，需要時可以從{bin}還原。人物庫裡的人物會保留。',
        outsideHint: '這個專案不在漫劇庫資料夾裡，只會從清單中移除，資料夾本身不會動。', trash: '移到{bin}', removeFromList: '從清單移除', cancel: '取消',
        deleting: '正在刪除…', failed: '無法刪除：{reason}', reorderHint: '長按可拖曳調整順序', binMac: '垃圾桶', binWin: '資源回收筒' },
    en: { delete: 'Delete', deleteTitle: 'Delete “{title}”?', deleteHint: 'The project folder moves to the {bin}, where you can restore it. Characters in the character library are kept.',
        outsideHint: 'This project is outside the comic library folder, so it is only removed from this list; the folder itself is left alone.', trash: 'Move to {bin}',
        removeFromList: 'Remove from list', cancel: 'Cancel', deleting: 'Deleting…', failed: 'Couldn’t delete: {reason}', reorderHint: 'Press and hold, then drag to reorder', binMac: 'Trash', binWin: 'Recycle Bin' },
    ja: { delete: '削除', deleteTitle: '「{title}」を削除しますか？', deleteHint: 'プロジェクトのフォルダは{bin}に移動し、必要なら{bin}から戻せます。キャラクターライブラリの人物は残ります。',
        outsideHint: 'このプロジェクトはライブラリのフォルダの外にあるため、一覧から外すだけでフォルダはそのままです。', trash: '{bin}に入れる', removeFromList: '一覧から外す', cancel: 'キャンセル',
        deleting: '削除中…', failed: '削除できませんでした：{reason}', reorderHint: '長押ししてドラッグすると並べ替えられます', binMac: 'ゴミ箱', binWin: 'ごみ箱' },
    ko: { delete: '삭제', deleteTitle: '‘{title}’을(를) 삭제할까요?', deleteHint: '프로젝트 폴더는 {bin}(으)로 이동하며, 필요하면 {bin}에서 복원할 수 있습니다. 캐릭터 라이브러리의 인물은 유지됩니다.',
        outsideHint: '이 프로젝트는 라이브러리 폴더 밖에 있어 목록에서만 제거되고 폴더는 그대로 남습니다.', trash: '{bin}(으)로 이동', removeFromList: '목록에서 제거', cancel: '취소',
        deleting: '삭제 중…', failed: '삭제하지 못했습니다: {reason}', reorderHint: '길게 누른 뒤 끌어서 순서를 바꿀 수 있습니다', binMac: '휴지통', binWin: '휴지통' },
    es: { delete: 'Eliminar', deleteTitle: '¿Eliminar «{title}»?', deleteHint: 'La carpeta del proyecto se mueve a la {bin}, desde donde puedes restaurarla. Los personajes de la biblioteca se conservan.',
        outsideHint: 'Este proyecto está fuera de la carpeta de la biblioteca: solo se quita de la lista y la carpeta no se toca.', trash: 'Mover a la {bin}', removeFromList: 'Quitar de la lista',
        cancel: 'Cancelar', deleting: 'Eliminando…', failed: 'No se pudo eliminar: {reason}', reorderHint: 'Mantén pulsado y arrastra para reordenar', binMac: 'Papelera', binWin: 'Papelera de reciclaje' },
    fr: { delete: 'Supprimer', deleteTitle: 'Supprimer « {title} » ?', deleteHint: 'Le dossier du projet va dans la {bin}, d’où vous pouvez le récupérer. Les personnages de la bibliothèque sont conservés.',
        outsideHint: 'Ce projet est hors du dossier de la bibliothèque : il est seulement retiré de la liste, le dossier reste intact.', trash: 'Mettre à la {bin}', removeFromList: 'Retirer de la liste',
        cancel: 'Annuler', deleting: 'Suppression…', failed: 'Suppression impossible : {reason}', reorderHint: 'Maintenez puis faites glisser pour réordonner', binMac: 'Corbeille', binWin: 'Corbeille' },
    de: { delete: 'Löschen', deleteTitle: '„{title}“ löschen?', deleteHint: 'Der Projektordner wandert in den {bin} und lässt sich von dort wiederherstellen. Figuren in der Figurenbibliothek bleiben erhalten.',
        outsideHint: 'Dieses Projekt liegt außerhalb des Bibliotheksordners. Es wird nur aus der Liste entfernt; der Ordner bleibt unberührt.', trash: 'In den {bin} legen', removeFromList: 'Aus der Liste entfernen',
        cancel: 'Abbrechen', deleting: 'Wird gelöscht…', failed: 'Löschen fehlgeschlagen: {reason}', reorderHint: 'Gedrückt halten und ziehen zum Umsortieren', binMac: 'Papierkorb', binWin: 'Papierkorb' },
    'pt-BR': { delete: 'Excluir', deleteTitle: 'Excluir “{title}”?', deleteHint: 'A pasta do projeto vai para a {bin}, de onde dá para restaurá-la. Os personagens da biblioteca são mantidos.',
        outsideHint: 'Este projeto está fora da pasta da biblioteca: ele só sai da lista e a pasta não é alterada.', trash: 'Mover para a {bin}', removeFromList: 'Remover da lista',
        cancel: 'Cancelar', deleting: 'Excluindo…', failed: 'Não foi possível excluir: {reason}', reorderHint: 'Toque e segure, depois arraste para reordenar', binMac: 'Lixeira', binWin: 'Lixeira' },
    ru: { delete: 'Удалить', deleteTitle: 'Удалить «{title}»?', deleteHint: 'Папка проекта будет перемещена в {bin}, откуда её можно восстановить. Персонажи в библиотеке сохранятся.',
        outsideHint: 'Этот проект лежит вне папки библиотеки: он будет только убран из списка, папка останется на месте.', trash: 'Переместить в {bin}', removeFromList: 'Убрать из списка',
        cancel: 'Отмена', deleting: 'Удаление…', failed: 'Не удалось удалить: {reason}', reorderHint: 'Удерживайте и перетащите, чтобы изменить порядок', binMac: 'Корзину', binWin: 'Корзину' },
    ar: { delete: 'حذف', deleteTitle: 'حذف «{title}»؟', deleteHint: 'سيُنقل مجلد المشروع إلى {bin} ويمكنك استعادته منها. تبقى الشخصيات في مكتبة الشخصيات.',
        outsideHint: 'هذا المشروع خارج مجلد المكتبة، لذا سيُزال من القائمة فقط ويبقى المجلد كما هو.', trash: 'نقل إلى {bin}', removeFromList: 'إزالة من القائمة',
        cancel: 'إلغاء', deleting: 'جارٍ الحذف…', failed: 'تعذّر الحذف: {reason}', reorderHint: 'اضغط مطولًا ثم اسحب لتغيير الترتيب', binMac: 'سلة المهملات', binWin: 'سلة المحذوفات' },
    hi: { delete: 'हटाएँ', deleteTitle: '“{title}” हटाएँ?', deleteHint: 'प्रोजेक्ट फ़ोल्डर {bin} में चला जाएगा, जहाँ से उसे वापस लाया जा सकता है। कैरेक्टर लाइब्रेरी के पात्र बने रहेंगे।',
        outsideHint: 'यह प्रोजेक्ट लाइब्रेरी फ़ोल्डर के बाहर है, इसलिए यह सिर्फ़ सूची से हटेगा; फ़ोल्डर जैसा है वैसा रहेगा।', trash: '{bin} में भेजें', removeFromList: 'सूची से हटाएँ',
        cancel: 'रद्द करें', deleting: 'हटाया जा रहा है…', failed: 'हटाया नहीं जा सका: {reason}', reorderHint: 'क्रम बदलने के लिए दबाकर रखें और खींचें', binMac: 'ट्रैश', binWin: 'रीसायकल बिन' }
};

function uncheckedComicProjectText(locale: NextMuxDesktopLocale, key: ProjectKey, values?: Readonly<Record<string, string | number>>): string {
    const text = (projectCopy[locale] || projectCopy.en)[key];
    return values ? text.replace(/\{(\w+)\}/g, (match, name: string) => values[name] === undefined ? match : String(values[name])) : text;
}

function uncheckedComicKindText(locale: NextMuxDesktopLocale, key: KindKey, values?: Readonly<Record<string, string | number>>): string {
    const text = (kindCopy[locale] || kindCopy.en)[key];
    return values ? text.replace(/\{(\w+)\}/g, (match, name: string) => values[name] === undefined ? match : String(values[name])) : text;
}

function uncheckedComicSheetText(locale: NextMuxDesktopLocale, key: SheetKey): string {
    return (sheetCopy[locale] || sheetEn)[key];
}

export const COMIC_KIND_ICONS: Readonly<Record<ComicProjectKind, string>> = { novel: 'book', image: 'file-media', topic: 'wand', music: 'music' };

export type ComicHomeStatus = 'all' | 'draft' | 'progress' | 'done' | 'exported' | 'failed';
export const COMIC_HOME_STATUSES: readonly ComicHomeStatus[] = ['all', 'draft', 'progress', 'done', 'exported', 'failed'];

export interface ComicHomeProject {
    readonly path: string;
    readonly title: string;
    readonly kind: ComicProjectKind;
    readonly stage: 'draft' | 'progress' | 'done';
    readonly exported: boolean;
    readonly failedJobs: number;
    readonly coverUrl?: string;
    readonly aspectRatio: string;
    /** Duration or shot progress, already worded by the caller. */
    readonly meta: string;
    readonly progress: number;
    readonly updated: string;
    /** Organiser data (folders, sort, cover); absent for comics outside the library. */
    readonly projectId?: string;
    readonly folderId?: string | null;
    readonly updatedAtMs?: number;
}

export interface ComicHomeFolder { readonly id: string; readonly name: string }
export const COMIC_HOME_ALL_FOLDERS = '__all__';
export const COMIC_HOME_UNFILED = '__none__';

export function comicHomeStatusOf(project: ComicHomeProject, status: ComicHomeStatus): boolean {
    return status === 'all' || (status === 'exported' ? project.exported : status === 'failed' ? project.failedJobs > 0 : project.stage === status);
}

export interface ComicCreationLibraryItem {
    readonly id: string;
    readonly name: string;
    readonly kind: 'image' | 'video' | 'audio';
    readonly path: string;
    readonly previewUrl?: string;
}

/**
 * Preview the non-conflicting project folder path under `parentDirectory` so the creation sheet
 * shows the exact folder path that `createProject` will create.
 */
export function previewComicProjectFolderPath(
    parentDirectory: string,
    rawTitle: string,
    fallbackTitle: string,
    existingProjectPaths: readonly string[] = []
): string {
    const base = parentDirectory.replace(/[\\/]+$/, '');
    if (!base) return '';
    const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/';
    const effectiveTitle = rawTitle.trim() || fallbackTitle.trim() || 'Untitled';
    const rawSlug = effectiveTitle
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[.\s]+/, '')
        .slice(0, 60)
        .replace(/[. ]+$/, '') || 'comic';
    const norm = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const taken = new Set(existingProjectPaths.map(norm));
    let slug = rawSlug;
    let suffix = 1;
    while (taken.has(norm(`${base}${sep}${slug}`))) {
        suffix += 1;
        slug = `${rawSlug} ${suffix}`;
    }
    return `${base}${sep}${slug}`;
}

/**
 * 保存位置: the one place a creation sheet shows where the project goes. `readOnly` is for a folder that is used
 * as-is (an open empty folder), so there is nothing to choose.
 */
export function ComicProjectLocationField(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly parentDirectory: string;
    readonly defaultDirectory?: string;
    readonly previewPath: string;
    readonly disabled?: boolean;
    readonly readOnly?: boolean;
    readonly onChooseDirectory?: () => void;
    readonly onResetDirectory?: () => void;
}): React.ReactElement {
    const t = (key: SheetKey): string => comicSheetText(props.locale, key);
    const displayPath = props.previewPath || props.parentDirectory;
    const isCustom = Boolean(props.defaultDirectory && props.parentDirectory && props.parentDirectory !== props.defaultDirectory);
    return <div className='nmx-comic-field nmx-comic-location-field'>
        <span>{t('saveLocation')}</span>
        <div className='nmx-comic-location-row'>
            <span className='nmx-comic-location-box' title={displayPath}>
                <i className='codicon codicon-folder-opened' aria-hidden='true'></i>
                {/* The marks keep the path left-to-right inside the right-to-left box that keeps a long path's end. */}
                <code className='nmx-comic-location-path' data-nmx-literal>{`\u200e${displayPath || '—'}\u200e`}</code>
            </span>
            {!props.readOnly && isCustom && props.onResetDirectory && <button type='button' className='nmx-secondary-button nmx-comic-location-btn' disabled={props.disabled} onClick={props.onResetDirectory}>
                {t('resetFolder')}</button>}
            {!props.readOnly && <button type='button' className='nmx-secondary-button nmx-comic-location-btn' disabled={props.disabled || !props.onChooseDirectory} onClick={props.onChooseDirectory}>
                <i className='codicon codicon-folder' aria-hidden='true'></i>{t('chooseFolder')}</button>}
        </div>
    </div>;
}

export function ComicCreationLibraryPicker(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly items: readonly ComicCreationLibraryItem[];
    readonly selectedPaths?: ReadonlySet<string>;
    readonly onPick: (item: ComicCreationLibraryItem) => void;
}): React.ReactElement {
    const t = (key: SheetKey): string => comicSheetText(props.locale, key);
    if (!props.items.length) {
        return <div className='nmx-comic-create-lib-empty'><i className='codicon codicon-inbox' aria-hidden='true'></i><span>{t('libraryEmpty')}</span></div>;
    }
    return <div className='nmx-comic-create-lib-picker' role='list'>
        {props.items.map(item => {
            const active = Boolean(props.selectedPaths?.has(item.path));
            return <button key={item.id} type='button' role='listitem' className={`nmx-comic-create-lib-card${active ? ' is-selected' : ''}`}
                title={item.name} onClick={() => props.onPick(item)}>
                <span className='nmx-comic-create-lib-thumb'>
                    {item.kind === 'image' && item.previewUrl ? <img src={item.previewUrl} alt='' loading='lazy' draggable={false} />
                        : item.kind === 'video' && item.previewUrl ? <video src={item.previewUrl} muted preload='metadata' />
                        : <i className={`codicon codicon-${item.kind === 'video' ? 'device-camera-video' : item.kind === 'audio' ? 'unmute' : 'file-media'}`} aria-hidden='true'></i>}
                    {active && <em className='nmx-comic-create-lib-check' aria-hidden='true'><i className='codicon codicon-check'></i></em>}
                </span>
                <span className='nmx-comic-create-lib-name' data-nmx-literal>{item.name}</span>
            </button>;
        })}
    </div>;
}

/**
 * The comic home: the four kinds as tabs; each shows its projects under 全部 / 草稿 / 进行中 / 已完成 / 已导出 /
 * 失败待处理, newest first, with its own 新建 button. A kind without projects shows what it makes and how to start.
 */
export function ComicHomeCategories(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly kind: ComicProjectKind;
    readonly status: ComicHomeStatus;
    readonly projects: readonly ComicHomeProject[];
    /** Shown instead of counts and projects while the library is still being read. */
    readonly loading?: string;
    readonly disabled?: boolean;
    /** Project paths whose folder or generated media was found missing on disk; renders inline deleted notice on matching cards across all 4 tabs. */
    readonly deletedProjectPaths?: ReadonlySet<string>;
    readonly onKind: (kind: ComicProjectKind) => void;
    readonly onStatus: (status: ComicHomeStatus) => void;
    readonly onOpen: (project: ComicHomeProject) => void;
    readonly onCreate: (kind: ComicProjectKind) => void;
    /** The card's delete action (in its ⋯ menu). */
    readonly onDelete?: (project: ComicHomeProject) => void;
    /** Open the project's folder in the system file manager (Finder / Explorer). */
    readonly onOpenFolder?: (project: ComicHomeProject) => void;
    /** Folders, search and sort (the organiser). Without `folders` the bar is hidden. */
    readonly folders?: readonly ComicHomeFolder[];
    readonly folder?: string;
    readonly query?: string;
    readonly sort?: 'recent' | 'name';
    readonly onFolder?: (folderId: string) => void;
    readonly onQuery?: (query: string) => void;
    readonly onSort?: (sort: 'recent' | 'name') => void;
    readonly onCreateFolder?: (name: string) => Promise<void>;
    readonly onRenameFolder?: (folderId: string, name: string) => Promise<void>;
    readonly onDeleteFolder?: (folderId: string) => Promise<void>;
    readonly onMove?: (project: ComicHomeProject, folderId: string | null) => Promise<void>;
    readonly onRename?: (project: ComicHomeProject, title: string) => Promise<void>;
    readonly onDuplicate?: (project: ComicHomeProject) => Promise<void>;
    readonly onLoadCovers?: (project: ComicHomeProject) => Promise<readonly { readonly id: string; readonly url: string }[]>;
    readonly onCover?: (project: ComicHomeProject, assetId: string | null) => Promise<void>;
}): React.ReactElement {
    const t = (key: KindKey, values?: Readonly<Record<string, string | number>>): string => comicKindText(props.locale, key, values);
    const h = (key: ComicHomeTextKey, values?: Readonly<Record<string, string | number>>): string => comicHomeText(props.locale, key, values);
    const folders = props.folders;
    const folder = props.folder ?? COMIC_HOME_ALL_FOLDERS;
    const query = (props.query ?? '').trim().toLocaleLowerCase(props.locale);
    const inFolder = (project: ComicHomeProject): boolean => !folders || folder === COMIC_HOME_ALL_FOLDERS ? true
        : folder === COMIC_HOME_UNFILED ? !project.folderId || !folders.some(item => item.id === project.folderId) : project.folderId === folder;
    const collator = React.useMemo(() => new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' }), []);
    const ofKind = props.projects.filter(project => project.kind === props.kind && inFolder(project) && (!query || project.title.toLocaleLowerCase(props.locale).includes(query)))
        .sort((a, b) => props.sort === 'name' ? collator.compare(a.title, b.title) : (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));
    const shown = ofKind.filter(project => comicHomeStatusOf(project, props.status));
    const [menu, setMenu] = React.useState<string>();
    const [naming, setNaming] = React.useState<{ readonly kind: 'newFolder' | 'renameFolder' | 'renameProject'; readonly id?: string; readonly value: string; readonly project?: ComicHomeProject }>();
    const [confirmFolder, setConfirmFolder] = React.useState<string>();
    const [covers, setCovers] = React.useState<{ readonly project: ComicHomeProject; readonly items?: readonly { readonly id: string; readonly url: string }[] }>();
    const [busy, setBusy] = React.useState(false);
    const [problem, setProblem] = React.useState<string>();
    React.useEffect(() => {
        if (!menu && !naming && !confirmFolder && !covers) return;
        const onPointerDown = (event: PointerEvent): void => {
            const target = event.target as Element | null;
            if (menu && !target?.closest('.nmx-comic-org-menu, .nmx-comic-cats-delete')) setMenu(undefined);
            if ((naming || confirmFolder || covers) && !busy && !target?.closest('.nmx-comic-org-dialog, .nmx-comic-org-menu, .nmx-comic-org-icon')) {
                setNaming(undefined); setConfirmFolder(undefined); setCovers(undefined);
            }
        };
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key !== 'Escape' || event.isComposing || busy) return;
            if (menu) { setMenu(undefined); return; }
            if (naming || confirmFolder || covers) { setNaming(undefined); setConfirmFolder(undefined); setCovers(undefined); }
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [menu, naming, confirmFolder, covers, busy]);
    const act = async (work: () => Promise<void>, after?: () => void): Promise<void> => {
        setBusy(true); setProblem(undefined);
        try { await work(); after?.(); } catch (error) { setProblem(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
    };
    const saveName = (): void => {
        if (!naming) return;
        const value = naming.value.trim();
        if (!value) { setProblem(h('nameRequired')); return; }
        if (Array.from(value).length > 64) { setProblem(h('nameTooLong')); return; }
        if (naming.kind !== 'renameProject' && folders?.some(item => item.id !== naming.id && item.name.normalize('NFKC').toLocaleLowerCase() === value.normalize('NFKC').toLocaleLowerCase())) { setProblem(h('folderExists')); return; }
        void act(() => naming.kind === 'newFolder' ? props.onCreateFolder!(value) : naming.kind === 'renameFolder' ? props.onRenameFolder!(naming.id!, value) : props.onRename!(naming.project!, value), () => setNaming(undefined));
    };
    const statusLabel: Readonly<Record<ComicHomeStatus, KindKey>> = { all: 'statusAll', draft: 'statusDraft', progress: 'statusProgress', done: 'statusDone', exported: 'statusExported', failed: 'statusFailed' };
    const move = (event: React.KeyboardEvent<HTMLDivElement>, items: readonly string[], current: string, select: (value: string) => void): void => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const index = items.indexOf(current);
        const rtl = event.currentTarget.closest('[dir="rtl"]') !== null;
        const step = (event.key === 'ArrowRight') !== rtl ? 1 : -1;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + step + items.length) % items.length;
        event.preventDefault();
        select(items[next]);
        (event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next])?.focus();
    };
    return <section className='nmx-comic-cats' onPointerDownCapture={event => {
        const target = event.target as Element | null;
        if (menu && !target?.closest('.nmx-comic-org-menu, .nmx-comic-cats-delete')) setMenu(undefined);
        if ((naming || confirmFolder || covers) && !busy && !target?.closest('.nmx-comic-org-dialog, .nmx-comic-org-menu, .nmx-comic-org-icon')) {
            setNaming(undefined); setConfirmFolder(undefined); setCovers(undefined);
        }
    }}>
        <div className='nmx-comic-cats-tabs' role='tablist' aria-label={t('start')} onKeyDown={event => move(event, COMIC_PROJECT_KINDS, props.kind, value => props.onKind(value as ComicProjectKind))}>
            {COMIC_PROJECT_KINDS.map(kind => {
                const count = props.projects.filter(project => project.kind === kind).length;
                const active = kind === props.kind;
                return <button key={kind} type='button' role='tab' id={`nmx-comic-cat-${kind}`} aria-selected={active} aria-controls='nmx-comic-cat-panel' tabIndex={active ? 0 : -1}
                    className={`nmx-comic-cats-tab is-${kind}${active ? ' is-active' : ''}`} onClick={() => props.onKind(kind)}>
                    <span className='nmx-comic-cats-icon' aria-hidden='true'><i className={`codicon codicon-${COMIC_KIND_ICONS[kind]}`}></i></span>
                    <span className='nmx-comic-cats-name'><strong>{t(kind)}</strong><small>{props.loading ?? (count ? t('projects', { count }) : t('empty'))}</small></span>
                </button>;
            })}
        </div>
        <div className={`nmx-comic-cats-panel is-${props.kind}`} id='nmx-comic-cat-panel' role='tabpanel' aria-labelledby={`nmx-comic-cat-${props.kind}`}>
            <header>
                <div><h2>{t(props.kind)}</h2><p>{t(`${props.kind}Lead` as KindKey)}</p></div>
                <button type='button' className='nmx-comic-cats-new' disabled={props.disabled} onClick={() => props.onCreate(props.kind)}>
                    <i className='codicon codicon-add' aria-hidden='true'></i>{t('newProject')}</button>
            </header>
            {folders && <div className='nmx-comic-org'>
                {folders.length > 0 && <div className='nmx-comic-org-folders' role='tablist' aria-label={h('moveTo')}>
                    {[{ id: COMIC_HOME_ALL_FOLDERS, name: h('folderAll') }, { id: COMIC_HOME_UNFILED, name: h('folderNone') }, ...folders].map(item => {
                        const count = props.projects.filter(project => project.kind === props.kind && (item.id === COMIC_HOME_ALL_FOLDERS || (item.id === COMIC_HOME_UNFILED
                            ? !project.folderId || !folders.some(other => other.id === project.folderId) : project.folderId === item.id))).length;
                        const real = item.id !== COMIC_HOME_ALL_FOLDERS && item.id !== COMIC_HOME_UNFILED;
                        return <span key={item.id} className={`nmx-comic-org-folder${folder === item.id ? ' is-active' : ''}`}>
                            <button type='button' role='tab' aria-selected={folder === item.id} onClick={() => props.onFolder?.(item.id)}>
                                {real && <i className='codicon codicon-folder' aria-hidden='true'></i>}<span data-nmx-literal={real ? '' : undefined}>{item.name}</span><b data-nmx-literal>{count}</b></button>
                            {real && folder === item.id && <>
                                <button type='button' className='nmx-comic-org-icon' aria-label={h('renameFolder')} title={h('renameFolder')} disabled={busy} onClick={() => { setProblem(undefined); setNaming({ kind: 'renameFolder', id: item.id, value: item.name }); }}><i className='codicon codicon-edit' aria-hidden='true'></i></button>
                                <button type='button' className='nmx-comic-org-icon' aria-label={h('deleteFolder')} title={h('deleteFolder')} disabled={busy} onClick={() => setConfirmFolder(item.id)}><i className='codicon codicon-trash' aria-hidden='true'></i></button>
                            </>}
                        </span>;
                    })}
                </div>}
                <div className='nmx-comic-org-tools'>
                    <label className='nmx-comic-org-search'><i className='codicon codicon-search' aria-hidden='true'></i>
                        <ImeInput value={props.query ?? ''} placeholder={h('search')} aria-label={h('search')} onChange={event => props.onQuery?.(event.currentTarget.value)} /></label>
                    <select value={props.sort ?? 'recent'} aria-label={h('sortRecent')} onChange={event => props.onSort?.(event.currentTarget.value === 'name' ? 'name' : 'recent')}>
                        <option value='recent'>{h('sortRecent')}</option><option value='name'>{h('sortName')}</option>
                    </select>
                </div>
                {naming && <div className='nmx-comic-org-dialog' role='dialog' aria-modal='true' aria-label={h(naming.kind === 'newFolder' ? 'newFolder' : naming.kind === 'renameFolder' ? 'renameFolder' : 'rename')}
                    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !event.nativeEvent.isComposing) setNaming(undefined); if (event.key === 'Enter' && !event.nativeEvent.isComposing) saveName(); }}>
                    <strong>{h(naming.kind === 'newFolder' ? 'newFolder' : naming.kind === 'renameFolder' ? 'renameFolder' : 'rename')}</strong>
                    <ImeInput autoFocus maxLength={80} value={naming.value} placeholder={h(naming.kind === 'renameProject' ? 'projectName' : 'folderName')} onChange={event => setNaming({ ...naming, value: event.currentTarget.value })} />
                    <button type='button' className='nmx-secondary-button' disabled={busy} onClick={() => setNaming(undefined)}>{h('cancel')}</button>
                    <button type='button' className='nmx-primary-button' disabled={busy} onClick={saveName}>{h('save')}</button>
                </div>}
                {confirmFolder && <div className='nmx-comic-org-dialog' role='dialog' aria-modal='true' aria-label={h('deleteFolder')} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') setConfirmFolder(undefined); }}>
                    <strong>{h('deleteFolder')}</strong><p>{h('deleteFolderBody')}</p>
                    <button type='button' className='nmx-secondary-button' autoFocus disabled={busy} onClick={() => setConfirmFolder(undefined)}>{h('cancel')}</button>
                    <button type='button' className='nmx-primary-button is-danger' disabled={busy} onClick={() => void act(() => props.onDeleteFolder!(confirmFolder), () => { setConfirmFolder(undefined); props.onFolder?.(COMIC_HOME_ALL_FOLDERS); })}>{h('deleteFolder')}</button>
                </div>}
                {covers && <div className='nmx-comic-org-dialog is-covers' role='dialog' aria-modal='true' aria-label={h('coverTitle')} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') setCovers(undefined); }}>
                    <strong>{h('coverTitle')}</strong>
                    {!covers.items ? <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>
                        : covers.items.length ? <div className='nmx-comic-org-covers'>{covers.items.map(item => <button type='button' key={item.id} disabled={busy}
                            onClick={() => void act(() => props.onCover!(covers.project, item.id), () => setCovers(undefined))}><img src={item.url} alt='' loading='lazy' /></button>)}</div>
                        : <p>{h('noCoverImages')}</p>}
                    <button type='button' className='nmx-secondary-button' onClick={() => setCovers(undefined)}>{h('cancel')}</button>
                </div>}
                {problem && <p className='nmx-comic-org-problem' role='alert'>{problem}</p>}
            </div>}
            {ofKind.length > 0 && <div className='nmx-comic-cats-status' role='tablist' aria-label={t(props.kind)}
                onKeyDown={event => move(event, COMIC_HOME_STATUSES, props.status, value => props.onStatus(value as ComicHomeStatus))}>
                {COMIC_HOME_STATUSES.map(status => {
                    const count = ofKind.filter(project => comicHomeStatusOf(project, status)).length;
                    const active = status === props.status;
                    return <button key={status} type='button' role='tab' aria-selected={active} tabIndex={active ? 0 : -1}
                        className={`${active ? 'is-active' : ''}${status === 'failed' && count ? ' is-alert' : ''}`} onClick={() => props.onStatus(status)}>
                        {t(statusLabel[status])}<b data-nmx-literal>{count}</b></button>;
                })}
            </div>}
            {props.loading ? <p className='nmx-comic-cats-loading' role='status'><i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>{props.loading}</p>
                : ofKind.length === 0 && (query || folder !== COMIC_HOME_ALL_FOLDERS) ? <p className='nmx-comic-cats-empty'>{h('noMatches')}</p>
                : ofKind.length === 0 ? <button type='button' className={`nmx-comic-cats-first is-${props.kind}`} disabled={props.disabled} onClick={() => props.onCreate(props.kind)}>
                    <span className='nmx-comic-kind-art' aria-hidden='true'>
                        {props.kind === 'novel' && <><i className='is-page'></i><i className='is-page'></i><i className='is-panel'></i></>}
                        {props.kind === 'image' && <><i className='is-photo'></i><i className='is-play'></i><i className='is-motion'></i></>}
                        {props.kind === 'topic' && <><i className='is-bulb'></i><i className='is-wave'></i><i className='is-reel'></i></>}
                        {props.kind === 'music' && <><i className='is-disc'></i><i className='is-bars'></i><i className='is-note'></i></>}
                    </span>
                    <span className='nmx-comic-kind-tags'>{t(`${props.kind}Tags` as KindKey).split(' · ').map(tag => <em key={tag}>{tag}</em>)}</span>
                    <b>{t('start')}<i className='codicon codicon-arrow-right' aria-hidden='true'></i></b>
                </button>
                : shown.length === 0 ? <p className='nmx-comic-cats-empty'>{t('statusEmpty')}</p>
                    : <div className='nmx-comic-home-grid' role='list' aria-label={t(props.kind)}>{shown.map(project => {
                        const isDeleted = Boolean(props.deletedProjectPaths?.has(project.path));
                        return <div role='listitem' key={project.path} className={`nmx-comic-cats-item${isDeleted ? ' is-deleted' : ''}`}>
                            {isDeleted && props.onDelete && <button type='button' className='nmx-comic-cats-remove-deleted is-danger'
                                aria-label={`${comicProjectText(props.locale, 'removeFromList')} · ${project.title}`}
                                title={comicProjectText(props.locale, 'removeFromList')} disabled={props.disabled}
                                onClick={event => { event.stopPropagation(); props.onDelete!(project); }}>
                                <i className='codicon codicon-trash' aria-hidden='true'></i></button>}
                            {(props.onDelete || props.onRename || props.onDuplicate || props.onOpenFolder) && <button type='button' className='nmx-comic-cats-delete' aria-label={`${h('more')} · ${project.title}`} aria-haspopup='menu' aria-expanded={menu === project.path}
                                title={h('more')} disabled={props.disabled} onClick={() => setMenu(menu === project.path ? undefined : project.path)}>
                                <i className='codicon codicon-ellipsis' aria-hidden='true'></i></button>}
                            {menu === project.path && <div className='nmx-comic-org-menu' role='menu' onKeyDown={event => { if (event.key === 'Escape') setMenu(undefined); }}>
                                {props.onRename && <button type='button' role='menuitem' onClick={() => { setMenu(undefined); setProblem(undefined); setNaming({ kind: 'renameProject', value: project.title, project }); }}><i className='codicon codicon-edit' aria-hidden='true'></i>{h('rename')}</button>}
                                {props.onDuplicate && <button type='button' role='menuitem' disabled={busy} onClick={() => { setMenu(undefined); void act(() => props.onDuplicate!(project)); }}><i className='codicon codicon-copy' aria-hidden='true'></i>{h('duplicate')}</button>}
                                {props.onOpenFolder && <button type='button' role='menuitem' onClick={() => { setMenu(undefined); props.onOpenFolder!(project); }}><i className='codicon codicon-folder-opened' aria-hidden='true'></i>{h('openFolder')}</button>}
                                {props.onDelete && <button type='button' role='menuitem' className='is-danger' onClick={() => { setMenu(undefined); props.onDelete!(project); }}><i className='codicon codicon-trash' aria-hidden='true'></i>{comicProjectText(props.locale, 'delete')}</button>}
                            </div>}
                            <button type='button' className={`nmx-comic-home-card nmx-comic-cats-card${isDeleted ? ' is-deleted' : ''}`} title={project.path} onClick={() => props.onOpen(project)}>
                                <span className={`nmx-comic-home-cover is-${(project.aspectRatio || '16:9').replace(':', 'x')}${project.coverUrl ? ' has-picture' : ''}`}>
                                    {project.coverUrl ? <img src={project.coverUrl} alt='' loading='lazy' draggable={false} />
                                        : <span className='nmx-comic-home-cover-frame'><b data-nmx-literal>{Array.from(project.title || '?')[0]}</b></span>}
                                    <span className='nmx-comic-cats-badges'>
                                        {project.exported && <em className='is-exported'><i className='codicon codicon-check' aria-hidden='true'></i>{t('statusExported')}</em>}
                                        {project.failedJobs > 0 && <em className='is-failed'><i className='codicon codicon-warning' aria-hidden='true'></i>{t('failedBadge', { count: project.failedJobs })}</em>}
                                    </span>
                                    <small data-nmx-literal>{project.aspectRatio}</small>
                                </span>
                                <span className='nmx-comic-home-card-copy'>
                                    <strong data-nmx-literal>{project.title}</strong>
                                    {isDeleted && <span className='nmx-comic-card-deleted-notice' role='status'>
                                        <i className='codicon codicon-warning' aria-hidden='true'></i>
                                        <span>{t('deletedNotice')}</span>
                                    </span>}
                                    <small data-nmx-literal>{project.meta} · {t('updated', { time: project.updated })}</small>
                                    <span className='nmx-comic-home-progress' aria-hidden='true'><i style={{ width: `${project.progress}%` }}></i></span>
                                </span>
                            </button></div>;
                    })}</div>}
        </div>
    </section>;
}

export interface ComicImageCreateItem {
    readonly file?: File;
    readonly path?: string;
    readonly name?: string;
    readonly prompt: string;
}

/** New “picture to video” project: pictures, one motion prompt each (or one for all), model, length. */
export function ComicImageCreateSheet(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly busy: boolean;
    readonly error?: string;
    readonly errorDetail?: string;
    readonly modelPicker: React.ReactNode;
    readonly textPicker?: React.ReactNode;
    readonly ratioOptions: readonly string[];
    readonly ratio: string;
    readonly onRatio: (ratio: string) => void;
    readonly secondsOptions: readonly number[];
    readonly libraryItems?: readonly ComicCreationLibraryItem[];
    readonly parentDirectory?: string;
    readonly defaultDirectory?: string;
    readonly existingPaths?: readonly string[];
    readonly defaultTitle?: string;
    readonly onChooseDirectory?: () => void;
    readonly onResetDirectory?: () => void;
    readonly onCancel: () => void;
    readonly onCreate: (request: { readonly title: string; readonly items: readonly ComicImageCreateItem[]; readonly seconds: number; readonly parentDirectory?: string }) => void;
}): React.ReactElement {
    const t = (key: SheetKey): string => comicSheetText(props.locale, key);
    const [title, setTitle] = React.useState('');
    const [items, setItems] = React.useState<readonly { readonly key: string; readonly file?: File; readonly path?: string; readonly name: string; readonly url: string; readonly prompt: string }[]>([]);
    const [shared, setShared] = React.useState('');
    const [seconds, setSeconds] = React.useState(props.secondsOptions?.[0] || 5);
    const [dragging, setDragging] = React.useState(false);
    const [showLibrary, setShowLibrary] = React.useState(false);
    const [problem, setProblem] = React.useState('');
    const urls = React.useRef<string[]>([]);
    React.useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); }, []);
    const secondsKey = props.secondsOptions.join(',');
    React.useEffect(() => {
        if (props.secondsOptions.length > 0 && !props.secondsOptions.includes(seconds)) {
            setSeconds(props.secondsOptions[0]);
        }
    }, [secondsKey, seconds]);
    React.useEffect(() => {
        if (props.busy) return;
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); props.onCancel(); }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [props.busy, props.onCancel]);
    const imageLibraryItems = React.useMemo(() => (props.libraryItems ?? []).filter(item => item.kind === 'image'), [props.libraryItems]);
    const selectedLibraryPaths = React.useMemo(() => new Set(items.map(item => item.path).filter((value): value is string => Boolean(value))), [items]);
    const add = (files: readonly File[]): void => {
        const pictures = files.filter(file => /^image\/(png|jpe?g|webp|bmp)$/i.test(file.type) || /\.(png|jpe?g|webp|bmp)$/i.test(file.name));
        if (!pictures.length) return;
        const next = pictures.slice(0, Math.max(0, 50 - items.length)).map(file => {
            const url = URL.createObjectURL(file);
            urls.current.push(url);
            return { key: `${file.name}:${file.size}:${Math.random().toString(36).slice(2)}`, file, name: file.name, url, prompt: '' };
        });
        setItems(current => [...current, ...next]);
        setProblem('');
        if (!title && pictures[0]) setTitle(pictures[0].name.replace(/\.[a-z0-9]{1,5}$/i, '').slice(0, 60));
    };
    const pickFromLibrary = (item: ComicCreationLibraryItem): void => {
        setItems(current => {
            const exists = current.some(entry => entry.path === item.path);
            if (exists) return current.filter(entry => entry.path !== item.path);
            if (current.length >= 50) return current;
            return [...current, { key: `lib:${item.id}:${Math.random().toString(36).slice(2)}`, path: item.path, name: item.name, url: item.previewUrl || '', prompt: '' }];
        });
        setProblem('');
        if (!title && item.name) setTitle(item.name.replace(/\.[a-z0-9]{1,5}$/i, '').slice(0, 60));
    };
    const pick = (): void => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = 'image/png,image/jpeg,image/webp,image/bmp';
        input.onchange = () => add([...(input.files || [])]);
        input.click();
    };
    const create = (): void => {
        if (!items.length) { setProblem(t('needImages')); return; }
        props.onCreate({
            title: title.trim(),
            seconds,
            items: items.map(item => ({ file: item.file, path: item.path, name: item.name, prompt: item.prompt.trim() || shared.trim() })),
            ...(props.parentDirectory ? { parentDirectory: props.parentDirectory } : {})
        });
    };
    const activeParentDir = props.parentDirectory || props.defaultDirectory || '';
    const previewPath = previewComicProjectFolderPath(activeParentDir, title, props.defaultTitle || t('imageTitle'), props.existingPaths);
    return <div className='nmx-sheet-backdrop nmx-dialog-backdrop' onMouseDown={() => { if (!props.busy) props.onCancel(); }}>
        <section className='nmx-permission-sheet nmx-comic-create-sheet nmx-comic-create-v5 nmx-comic-kind-sheet is-image' role='dialog' aria-modal='true' aria-labelledby='nmx-comic-image-title' onMouseDown={event => event.stopPropagation()}>
            <header><div><h2 id='nmx-comic-image-title'><i className='codicon codicon-file-media' aria-hidden='true'></i>{t('imageTitle')}</h2><p>{t('imageLead')}</p></div>
                <button aria-label={t('cancel')} disabled={props.busy} onClick={props.onCancel}>×</button></header>
            <div className='nmx-comic-create-body'>
                <label className='nmx-comic-field'>{t('name')}<ImeInput maxLength={120} value={title} onChange={event => setTitle(event.currentTarget.value)} /></label>
                <ComicProjectLocationField locale={props.locale} parentDirectory={activeParentDir}
                    defaultDirectory={props.defaultDirectory} previewPath={previewPath} disabled={props.busy}
                    onChooseDirectory={props.onChooseDirectory} onResetDirectory={props.onResetDirectory} />
                <div className='nmx-comic-field'>
                    <div className='nmx-comic-create-field-head'>
                        <span>{t('images')}</span>
                        <span className='nmx-comic-create-source-actions'>
                            <button type='button' className='nmx-secondary-button nmx-comic-source-action-btn' disabled={props.busy} onClick={pick}>
                                <i className='codicon codicon-cloud-upload' aria-hidden='true'></i>{t('localUpload')}</button>
                            <button type='button' className={`nmx-secondary-button nmx-comic-source-action-btn${showLibrary ? ' is-active' : ''}`} aria-pressed={showLibrary} disabled={props.busy} onClick={() => setShowLibrary(current => !current)}>
                                <i className='codicon codicon-library' aria-hidden='true'></i>{t('pickFromLibrary')}</button>
                        </span>
                    </div>
                    {showLibrary && <ComicCreationLibraryPicker locale={props.locale} items={imageLibraryItems} selectedPaths={selectedLibraryPaths} onPick={pickFromLibrary} />}
                    <div className={`nmx-comic-image-drop ${dragging ? 'is-drop' : ''} ${items.length ? 'has-items' : ''}`}
                        onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; setDragging(true); } }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={event => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); event.stopPropagation(); setDragging(false); add([...event.dataTransfer.files]); }}>
                        {items.map((item, index) => <article key={item.key} className='nmx-comic-image-item'>
                            <span className='nmx-comic-image-index'>{String(index + 1).padStart(2, '0')}</span>
                            {item.url ? <img src={item.url} alt='' draggable={false} /> : <span className='nmx-comic-image-placeholder'><i className='codicon codicon-file-media' aria-hidden='true'></i></span>}
                            <ImeTextarea rows={2} value={item.prompt} maxLength={2000} placeholder={shared.trim() || t('motionPlaceholder')} aria-label={t('motion')}
                                onChange={event => { const value = event.currentTarget.value; setItems(current => current.map(entry => entry.key === item.key ? { ...entry, prompt: value } : entry)); }} />
                            <button type='button' title={t('remove')} aria-label={t('remove')} onClick={() => setItems(current => current.filter(entry => entry.key !== item.key))}><i className='codicon codicon-close' aria-hidden='true'></i></button>
                        </article>)}
                        <button type='button' className='nmx-comic-image-add' onClick={pick}><i className='codicon codicon-cloud-upload' aria-hidden='true'></i><span>{items.length ? t('imagesAdd') : t('imagesDrop')}</span></button>
                    </div>
                </div>
                <label className='nmx-comic-field'>{t('motionAll')}<ImeTextarea rows={2} maxLength={2000} value={shared} placeholder={t('motionAllPlaceholder')} onChange={event => setShared(event.currentTarget.value)} /></label>
                {props.modelPicker}
                {props.textPicker}
                <div className='nmx-comic-create-row'>
                    <label className='nmx-comic-field'>{t('aspect')}<select value={props.ratio} onChange={event => props.onRatio(event.currentTarget.value)}>{(props.ratioOptions ?? ['16:9', '9:16', '1:1', '4:3']).map(ratio => <option key={ratio} value={ratio}>{ratio}</option>)}</select></label>
                    <label className='nmx-comic-field'>{t('clipSeconds')}<select value={seconds} onChange={event => setSeconds(Number(event.currentTarget.value))}>{(props.secondsOptions ?? [5, 10]).map(value => <option key={value} value={value}>{value} {t('seconds')}</option>)}</select></label>
                </div>
                {(problem || props.error) && <div className='nmx-agent-inline-error' role='alert'><span data-nmx-literal={!problem && Boolean(props.errorDetail) || undefined}>{problem || props.error}</span>
                    {!problem && props.errorDetail && <MediaDiagnostic locale={props.locale} detail={props.errorDetail} />}</div>}
            </div>
            <footer><button className='nmx-secondary-button' disabled={props.busy} onClick={props.onCancel}>{t('cancel')}</button>
                <button className='nmx-primary-button' disabled={props.busy} onClick={create}>{props.busy ? t('creating') : t('create')}</button></footer>
        </section>
    </div>;
}

/** Where a topic video's pictures come from; they are used in this order, shot by shot. */
export interface ComicTopicSources {
    readonly own: boolean;
    readonly stock: boolean;
    readonly ai: boolean;
}

export interface ComicTopicCreateRequest {
    readonly title: string;
    readonly topic: string;
    readonly seconds: number;
    readonly visual: 'image' | 'video';
    readonly voice: boolean;
    readonly style: string;
    readonly sources: ComicTopicSources;
    /** The user's own pictures and clips (sources.own). */
    readonly files: readonly File[];
    /** Asset paths chosen from the global asset library (sources.own). */
    readonly libraryPaths?: readonly string[];
    readonly stockProvider: StockMediaProvider;
    /** A newly typed stock-library key; checked and kept in the keychain on create. */
    readonly stockKey?: string;
    readonly parentDirectory?: string;
}

const MATERIAL_TYPES = /\.(png|jpe?g|webp|bmp|mp4|m4v|mov|webm)$/i;

/**
 * New “topic to video” project. Pictures can come from the user's own files, free stock libraries
 * and AI models — any combination, used in that order: own files first, stock for the shots left,
 * AI for the rest. Without AI, shots with no material stay empty and can be filled in the editor.
 */
export function ComicTopicCreateSheet(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly busy: boolean;
    readonly error?: string;
    readonly errorDetail?: string;
    readonly textPicker: React.ReactNode;
    readonly imagePicker: React.ReactNode;
    readonly videoPicker: React.ReactNode;
    readonly speechPicker: React.ReactNode;
    readonly ratioOptions: readonly string[];
    readonly ratio: string;
    readonly onRatio: (ratio: string) => void;
    /** Which stock libraries already have a key in the keychain. */
    readonly stockState?: StockMediaState;
    readonly libraryItems?: readonly ComicCreationLibraryItem[];
    readonly parentDirectory?: string;
    readonly defaultDirectory?: string;
    readonly existingPaths?: readonly string[];
    readonly defaultTitle?: string;
    readonly onChooseDirectory?: () => void;
    readonly onResetDirectory?: () => void;
    readonly onOpenLink: (url: string) => void;
    readonly onCancel: () => void;
    readonly onCreate: (request: ComicTopicCreateRequest) => void;
}): React.ReactElement {
    const t = (key: SheetKey): string => comicSheetText(props.locale, key);
    const [title, setTitle] = React.useState('');
    const [topic, setTopic] = React.useState('');
    const [seconds, setSeconds] = React.useState(60);
    const [visual, setVisual] = React.useState<'image' | 'video'>('image');
    const [voice, setVoice] = React.useState(true);
    const [style, setStyle] = React.useState('');
    const [sources, setSources] = React.useState<ComicTopicSources>({ own: false, stock: false, ai: true });
    const [files, setFiles] = React.useState<readonly File[]>([]);
    const [libraryPicked, setLibraryPicked] = React.useState<readonly ComicCreationLibraryItem[]>([]);
    const [showLibrary, setShowLibrary] = React.useState(false);
    const [provider, setProvider] = React.useState<StockMediaProvider>('pexels');
    const [stockKey, setStockKey] = React.useState('');
    const [editKey, setEditKey] = React.useState(false);
    const [dragging, setDragging] = React.useState(false);
    const [problem, setProblem] = React.useState('');
    const fileInput = React.useRef<HTMLInputElement>(null);
    const keySaved = Boolean(props.stockState?.providers[provider]?.configured);
    React.useEffect(() => {
        if (props.busy) return;
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); props.onCancel(); }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [props.busy, props.onCancel]);
    const visualLibraryItems = React.useMemo(() => (props.libraryItems ?? []).filter(item => item.kind === 'image' || item.kind === 'video'), [props.libraryItems]);
    const selectedLibraryPaths = React.useMemo(() => new Set(libraryPicked.map(item => item.path)), [libraryPicked]);
    const addFiles = (list: FileList | null): void => {
        const picked = Array.from(list || []).filter(file => MATERIAL_TYPES.test(file.name));
        if (picked.length) {
            setFiles(current => [...current, ...picked].slice(0, Math.max(0, 50 - libraryPicked.length)));
            setSources(current => ({ ...current, own: true }));
        }
        setProblem('');
    };
    const pickFromLibrary = (item: ComicCreationLibraryItem): void => {
        setLibraryPicked(current => {
            const exists = current.some(entry => entry.path === item.path);
            if (exists) return current.filter(entry => entry.path !== item.path);
            if (current.length + files.length >= 50) return current;
            return [...current, item];
        });
        setSources(current => ({ ...current, own: true }));
        setProblem('');
    };
    const toggle = (key: keyof ComicTopicSources): void => { setSources(current => ({ ...current, [key]: !current[key] })); setProblem(''); };
    const effectiveTitle = title.trim() || topic.trim().split(/[\n。.!?！？]/)[0].slice(0, 60);
    const create = (): void => {
        if (!topic.trim()) { setProblem(t('needTopic')); return; }
        if (!sources.own && !sources.stock && !sources.ai) { setProblem(t('needSource')); return; }
        if (sources.own && !files.length && !libraryPicked.length) { setProblem(t('needFiles')); return; }
        if (sources.stock && !keySaved && !stockKey.trim()) { setProblem(t('needStockKey')); return; }
        props.onCreate({
            title: effectiveTitle,
            topic: topic.trim(),
            seconds,
            visual,
            voice,
            style: style.trim(),
            sources,
            files: sources.own ? files : [],
            ...(sources.own && libraryPicked.length ? { libraryPaths: libraryPicked.map(item => item.path) } : {}),
            stockProvider: provider,
            ...(sources.stock && stockKey.trim() ? { stockKey: stockKey.trim() } : {}),
            ...(props.parentDirectory ? { parentDirectory: props.parentDirectory } : {})
        });
    };
    const activeParentDir = props.parentDirectory || props.defaultDirectory || '';
    const previewPath = previewComicProjectFolderPath(activeParentDir, effectiveTitle, props.defaultTitle || t('topicTitle'), props.existingPaths);
    const ratioOptions = props.ratioOptions ?? ['16:9', '9:16', '1:1', '4:3'];
    const sourceCard = (key: keyof ComicTopicSources, icon: string, name: SheetKey, lead: SheetKey): React.ReactElement =>
        <label className={`nmx-comic-source ${sources[key] ? 'is-on' : ''}`}>
            <input type='checkbox' checked={sources[key]} onChange={() => toggle(key)} />
            <i className={`codicon codicon-${icon}`} aria-hidden='true'></i>
            <span><strong>{t(name)}</strong><small>{t(lead)}</small></span>
        </label>;
    return <div className='nmx-sheet-backdrop nmx-dialog-backdrop' onMouseDown={() => { if (!props.busy) props.onCancel(); }}>
        <section className='nmx-permission-sheet nmx-comic-create-sheet nmx-comic-create-v5 nmx-comic-kind-sheet is-topic' role='dialog' aria-modal='true' aria-labelledby='nmx-comic-topic-title' onMouseDown={event => event.stopPropagation()}>
            <header><div><h2 id='nmx-comic-topic-title'><i className='codicon codicon-wand' aria-hidden='true'></i>{t('topicTitle')}</h2><p>{t('topicLead')}</p></div>
                <button aria-label={t('cancel')} disabled={props.busy} onClick={props.onCancel}>×</button></header>
            <div className='nmx-comic-create-body'>
                <label className='nmx-comic-field is-grow'>{t('topic')}<ImeTextarea autoFocus rows={4} maxLength={4000} value={topic} placeholder={t('topicPlaceholder')} onChange={event => { setTopic(event.currentTarget.value); setProblem(''); }} /></label>
                <label className='nmx-comic-field'>{t('name')}<ImeInput maxLength={120} value={title} onChange={event => setTitle(event.currentTarget.value)} /></label>
                <ComicProjectLocationField locale={props.locale} parentDirectory={activeParentDir}
                    defaultDirectory={props.defaultDirectory} previewPath={previewPath} disabled={props.busy}
                    onChooseDirectory={props.onChooseDirectory} onResetDirectory={props.onResetDirectory} />
                <div className='nmx-comic-create-row'>
                    <label className='nmx-comic-field'>{t('length')}<select value={seconds} onChange={event => setSeconds(Number(event.currentTarget.value))}>{[30, 60, 90, 180].map(value => <option key={value} value={value}>{value} {t('seconds')}</option>)}</select></label>
                    <label className='nmx-comic-field'>{t('aspect')}<select value={props.ratio} onChange={event => props.onRatio(event.currentTarget.value)}>{ratioOptions.map(ratio => <option key={ratio} value={ratio}>{ratio}</option>)}</select></label>
                </div>
                {props.textPicker}
                <div className='nmx-comic-field nmx-comic-sources'>
                    <div className='nmx-comic-create-field-head'>
                        <span className='nmx-comic-sources-head'>{t('sources')}<small>{t('sourcesLead')}</small></span>
                        <span className='nmx-comic-create-source-actions'>
                            <button type='button' className='nmx-secondary-button nmx-comic-source-action-btn' disabled={props.busy} onClick={() => { setSources(current => ({ ...current, own: true })); fileInput.current?.click(); }}>
                                <i className='codicon codicon-cloud-upload' aria-hidden='true'></i>{t('localUpload')}</button>
                            <button type='button' className={`nmx-secondary-button nmx-comic-source-action-btn${showLibrary ? ' is-active' : ''}`} aria-pressed={showLibrary} disabled={props.busy} onClick={() => { setSources(current => ({ ...current, own: true })); setShowLibrary(current => !current); }}>
                                <i className='codicon codicon-library' aria-hidden='true'></i>{t('pickFromLibrary')}</button>
                        </span>
                    </div>
                    <div className='nmx-comic-source-grid' role='group' aria-label={t('sources')}>
                        {sourceCard('own', 'folder-opened', 'sourceOwn', 'sourceOwnLead')}
                        {sourceCard('stock', 'globe', 'sourceStock', 'sourceStockLead')}
                        {sourceCard('ai', 'sparkle', 'sourceAi', 'sourceAiLead')}
                    </div>
                    {showLibrary && <ComicCreationLibraryPicker locale={props.locale} items={visualLibraryItems} selectedPaths={selectedLibraryPaths} onPick={pickFromLibrary} />}
                    <input ref={fileInput} type='file' multiple hidden accept='image/png,image/jpeg,image/webp,image/bmp,video/mp4,video/quicktime,video/webm,.m4v' onChange={event => { addFiles(event.currentTarget.files); event.currentTarget.value = ''; }} />
                    {sources.own && <div className='nmx-comic-source-detail'>
                        <div className={`nmx-comic-drop ${dragging ? 'is-dragging' : ''}`} role='button' tabIndex={0}
                            onClick={() => fileInput.current?.click()} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.current?.click(); } }}
                            onDragOver={event => { event.preventDefault(); event.stopPropagation(); setDragging(true); }} onDragLeave={() => setDragging(false)}
                            onDrop={event => { event.preventDefault(); event.stopPropagation(); setDragging(false); addFiles(event.dataTransfer.files); }}>
                            <i className='codicon codicon-cloud-upload' aria-hidden='true'></i><span>{t('filesDrop')}</span>
                        </div>
                        {(files.length > 0 || libraryPicked.length > 0) && <ol className='nmx-comic-material-list'>
                            {files.map((file, index) => <li key={`file-${file.name}-${index}`}>
                                <i className={`codicon codicon-${/\.(mp4|m4v|mov|webm)$/i.test(file.name) ? 'device-camera-video' : 'file-media'}`} aria-hidden='true'></i>
                                <span data-nmx-literal title={file.name}>{index + 1}. {file.name}</span>
                                <button type='button' aria-label={t('remove')} title={t('remove')} onClick={() => setFiles(current => current.filter((_, position) => position !== index))}>×</button>
                            </li>)}
                            {libraryPicked.map((item, index) => <li key={`lib-${item.id}-${index}`}>
                                <i className={`codicon codicon-${item.kind === 'video' ? 'device-camera-video' : 'file-media'}`} aria-hidden='true'></i>
                                <span data-nmx-literal title={item.name}>{files.length + index + 1}. {item.name}</span>
                                <button type='button' aria-label={t('remove')} title={t('remove')} onClick={() => setLibraryPicked(current => current.filter(entry => entry.path !== item.path))}>×</button>
                            </li>)}
                        </ol>}
                    </div>}
                    {sources.stock && <div className='nmx-comic-source-detail'>
                        <div className='nmx-cut-segmented' role='radiogroup' aria-label={t('stockProvider')}>
                            {STOCK_MEDIA_PROVIDERS.map(value => <button key={value} type='button' role='radio' aria-checked={provider === value} className={provider === value ? 'is-active' : ''}
                                onClick={() => { setProvider(value); setEditKey(false); setStockKey(''); }}>{STOCK_MEDIA_SITES[value].name}</button>)}
                        </div>
                        {keySaved && !editKey
                            ? <p className='nmx-comic-stock-key is-saved'><i className='codicon codicon-pass-filled' aria-hidden='true'></i>{t('stockKeySaved')}<button type='button' className='nmx-link-button' onClick={() => setEditKey(true)}>{t('stockKeyChange')}</button></p>
                            : <label className='nmx-comic-field'>{`${STOCK_MEDIA_SITES[provider].name} API Key`}
                                <span className='nmx-comic-stock-key'><input type='password' autoComplete='off' spellCheck={false} maxLength={200} value={stockKey} placeholder={t('stockKeyPlaceholder')}
                                    onChange={event => { setStockKey(event.currentTarget.value); setProblem(''); }} />
                                    <button type='button' className='nmx-link-button' onClick={() => props.onOpenLink(STOCK_MEDIA_SITES[provider].keyPage)}>{t('stockGetKey')}<i className='codicon codicon-link-external' aria-hidden='true'></i></button></span></label>}
                        <small className='nmx-comic-source-note'>{t('stockLicense')}</small>
                    </div>}
                    {sources.ai ? <div className='nmx-comic-source-detail'>
                        <div className='nmx-cut-segmented nmx-comic-visual-choice' role='radiogroup' aria-label={t('visual')}>
                            {(['image', 'video'] as const).map(value => <button key={value} type='button' role='radio' aria-checked={visual === value} className={visual === value ? 'is-active' : ''} onClick={() => setVisual(value)}>{t(value === 'image' ? 'visualImages' : 'visualVideos')}</button>)}
                        </div>
                        {visual === 'image' ? props.imagePicker : props.videoPicker}
                    </div> : <small className='nmx-comic-source-note'>{t('noAiNote')}</small>}
                </div>
                <label className='nmx-comic-check'><input type='checkbox' checked={voice} onChange={event => setVoice(event.currentTarget.checked)} /><span><strong>{t('voiceOn')}</strong></span></label>
                {voice && props.speechPicker}
                <label className='nmx-comic-field'>{t('style')}<ImeInput maxLength={200} value={style} placeholder={t('stylePlaceholder')} onChange={event => setStyle(event.currentTarget.value)} /></label>
                {(problem || props.error) && <div className='nmx-agent-inline-error' role='alert'><span data-nmx-literal={!problem && Boolean(props.errorDetail) || undefined}>{problem || props.error}</span>
                    {!problem && props.errorDetail && <MediaDiagnostic locale={props.locale} detail={props.errorDetail} />}</div>}
            </div>
            <footer><button className='nmx-secondary-button' disabled={props.busy} onClick={props.onCancel}>{t('cancel')}</button>
                <button className='nmx-primary-button' disabled={props.busy} onClick={create}>{props.busy ? t('creating') : t('create')}</button></footer>
        </section>
    </div>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function comicProjectText(locale: Parameters<typeof uncheckedComicProjectText>[0], key: Parameters<typeof uncheckedComicProjectText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedComicProjectText>>): string {
    return totalCopy(locale, key, language => uncheckedComicProjectText(language, key, ...rest));
}
export function comicKindText(locale: Parameters<typeof uncheckedComicKindText>[0], key: Parameters<typeof uncheckedComicKindText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedComicKindText>>): string {
    return totalCopy(locale, key, language => uncheckedComicKindText(language, key, ...rest));
}
export function comicSheetText(locale: Parameters<typeof uncheckedComicSheetText>[0], key: Parameters<typeof uncheckedComicSheetText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedComicSheetText>>): string {
    return totalCopy(locale, key, language => uncheckedComicSheetText(language, key, ...rest));
}
