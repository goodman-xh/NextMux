// Composer attachment presentation and folder import.
//
// Everything the composer shows for an attachment lives here: the file-type
// catalogue (one icon per format family and per common language), the chip,
// the drop overlay and the folder snapshot that turns a dropped directory
// into a single readable text attachment.  The widget keeps ownership of the
// import pipeline (limits, caching, session ownership); this module only
// describes files and renders them.
import * as React from 'react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

// ---------------------------------------------------------------------------
// Copy

export type ComposerAttachmentUiKey =
    | 'dropTitle' | 'dropHint' | 'folder' | 'folderFiles' | 'unsupported' | 'remove' | 'preview' | 'restoring' | 'restoreFailed'
    | 'folderEmpty' | 'folderFailed' | 'folderAsProject' | 'anchoredAfter' | 'anchoredStart' | 'dropInsertTitle' | 'dropInsertHint'
    | 'dropReadTitle' | 'dropReadHint' | 'dropProjectTitle' | 'dropProjectHint'
    | 'willExtract' | 'willDescribe' | 'willExtractHint' | 'willDescribeHint' | 'readInParts' | 'readInPartsHint';

const catalog: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<ComposerAttachmentUiKey, string>>>> = {
    'zh-CN': {
        dropTitle: '松开即可添加', dropHint: '支持图片、PDF、Office 文档、代码与文本、音视频和文件夹',
        folder: '文件夹', folderFiles: '{count} 个文件', unsupported: '当前模型不支持此格式', remove: '移除', preview: '预览',
        restoring: '正在恢复…', restoreFailed: '无法恢复', folderEmpty: '文件夹中没有可读取的文件。',
        folderFailed: '无法读取文件夹 {name}。', folderAsProject: '已将 {name} 设为项目文件夹',
        anchoredAfter: '位于“{text}”之后', anchoredStart: '位于正文开头', dropInsertTitle: '松开插入到这里', dropInsertHint: '文件夹插入路径 · 文件记住此位置',
        dropReadTitle: '松开让 AI 读取', dropReadHint: '文件和文件夹会作为附件添加',
        dropProjectTitle: '松开将文件夹设为项目文件夹', dropProjectHint: '拖入文件夹将设为当前对话的项目目录，文件仍作为附件添加',
        willExtract: '发送时提取文字', willDescribe: '模型无法直接读取',
        willExtractHint: '这个模型不能直接读取此格式，发送时由 NextMux 提取文字交给 AI。', willDescribeHint: '这个模型不接收此类文件，发送时只附上文件名和类型；需要读取内容请换用支持该格式的模型。',
        readInParts: '分段阅读 · {lines} 行', readInPartsHint: '内容太长，不再随每次请求整篇发送：已存为文本，AI 按需分段读取，后续消息里也能继续查阅。'
    },
    'zh-TW': {
        dropTitle: '放開即可新增', dropHint: '支援圖片、PDF、Office 文件、程式碼與文字、影音和資料夾',
        folder: '資料夾', folderFiles: '{count} 個檔案', unsupported: '目前模型不支援此格式', remove: '移除', preview: '預覽',
        restoring: '正在還原…', restoreFailed: '無法還原', folderEmpty: '資料夾中沒有可讀取的檔案。',
        folderFailed: '無法讀取資料夾 {name}。', folderAsProject: '已將 {name} 設為專案資料夾',
        anchoredAfter: '位於「{text}」之後', anchoredStart: '位於正文開頭', dropInsertTitle: '放開插入到這裡', dropInsertHint: '資料夾插入路徑 · 檔案記住此位置',
        dropReadTitle: '放開讓 AI 讀取', dropReadHint: '檔案和資料夾會以附件加入',
        dropProjectTitle: '放開設為專案資料夾', dropProjectHint: '拖入資料夾將設為目前對話的專案目錄，檔案仍以附件加入',
        willExtract: '傳送時擷取文字', willDescribe: '模型無法直接讀取',
        willExtractHint: '此模型不能直接讀取這個格式，傳送時由 NextMux 擷取文字交給 AI。', willDescribeHint: '此模型不接收這類檔案，傳送時只附上檔名和類型；需要讀取內容請改用支援該格式的模型。',
        readInParts: '分段閱讀 · {lines} 行', readInPartsHint: '內容太長，不再隨每次請求整篇傳送：已存為文字，AI 依需要分段讀取，後續訊息中也能繼續查閱。'
    },
    en: {
        dropTitle: 'Drop to attach', dropHint: 'Images, PDFs, Office documents, code and text, audio, video and folders',
        folder: 'Folder', folderFiles: '{count} files', unsupported: 'Not supported by this model', remove: 'Remove', preview: 'Preview',
        restoring: 'Restoring…', restoreFailed: 'Could not restore', folderEmpty: 'The folder has no readable files.',
        folderFailed: 'The folder {name} could not be read.', folderAsProject: '{name} is now the project folder',
        anchoredAfter: 'Placed after “{text}”', anchoredStart: 'Placed at the start of the message', dropInsertTitle: 'Drop to insert here', dropInsertHint: 'Folders insert their path · files remember this spot',
        dropReadTitle: 'Drop for AI to read', dropReadHint: 'Files and folders are added as attachments',
        dropProjectTitle: 'Drop to set as project folder', dropProjectHint: 'Dropped folders become this conversation’s project directory; files attach as usual',
        willExtract: 'Text extracted on send', willDescribe: 'Model can’t read this type',
        willExtractHint: 'This model can’t read the format directly, so NextMux extracts the text and sends that.', willDescribeHint: 'This model doesn’t accept this file type; only the name and type are sent. Switch to a model that accepts it to share the content.',
        readInParts: 'Read in parts · {lines} lines', readInPartsHint: 'Too long to send whole with every request: saved as text the AI reads in parts, also in later messages.'
    },
    ja: {
        dropTitle: 'ドロップして添付', dropHint: '画像、PDF、Office 文書、コードとテキスト、音声・動画、フォルダーに対応',
        folder: 'フォルダー', folderFiles: '{count} 個のファイル', unsupported: 'このモデルでは未対応の形式です', remove: '削除', preview: 'プレビュー',
        restoring: '復元中…', restoreFailed: '復元できません', folderEmpty: 'フォルダーに読み取れるファイルがありません。',
        folderFailed: 'フォルダー {name} を読み取れませんでした。', folderAsProject: '{name} をプロジェクトフォルダーに設定しました',
        anchoredAfter: '「{text}」の後に配置', anchoredStart: '本文の先頭に配置', dropInsertTitle: 'ドロップしてここに挿入', dropInsertHint: 'フォルダーはパスを挿入 · ファイルはこの位置を記憶',
        dropReadTitle: 'ドロップして AI に読ませる', dropReadHint: 'ファイルとフォルダーを添付として追加します',
        dropProjectTitle: 'ドロップしてプロジェクトフォルダーに設定', dropProjectHint: 'フォルダーはこの会話のプロジェクトディレクトリになり、ファイルは添付として追加されます',
        willExtract: '送信時にテキスト抽出', willDescribe: 'モデルは直接読めません',
        willExtractHint: 'このモデルは形式を直接読めないため、NextMux がテキストを抽出して送信します。', willDescribeHint: 'このモデルはこの種類のファイルを受け付けません。名前と種類のみ送信されます。',
        readInParts: '分割して読む · {lines} 行', readInPartsHint: '長いため毎回全文は送りません。テキストとして保存し、AI が必要な部分を読みます（後のメッセージでも参照できます）。'
    },
    ko: {
        dropTitle: '놓아서 첨부', dropHint: '이미지, PDF, Office 문서, 코드와 텍스트, 오디오·비디오, 폴더 지원',
        folder: '폴더', folderFiles: '파일 {count}개', unsupported: '이 모델에서 지원하지 않는 형식', remove: '제거', preview: '미리 보기',
        restoring: '복원 중…', restoreFailed: '복원할 수 없음', folderEmpty: '폴더에 읽을 수 있는 파일이 없습니다.',
        folderFailed: '{name} 폴더를 읽을 수 없습니다.', folderAsProject: '{name}을(를) 프로젝트 폴더로 설정했습니다',
        anchoredAfter: '“{text}” 뒤에 배치', anchoredStart: '메시지 맨 앞에 배치', dropInsertTitle: '놓아서 여기에 삽입', dropInsertHint: '폴더는 경로 삽입 · 파일은 이 위치 기억',
        dropReadTitle: '놓아서 AI가 읽게 하기', dropReadHint: '파일과 폴더가 첨부 파일로 추가됩니다',
        dropProjectTitle: '놓아서 프로젝트 폴더로 설정', dropProjectHint: '폴더는 현재 대화의 프로젝트 디렉터리로 설정되며 파일은 첨부 파일로 추가됩니다',
        willExtract: '보낼 때 텍스트 추출', willDescribe: '모델이 직접 읽을 수 없음',
        willExtractHint: '이 모델은 형식을 직접 읽을 수 없어 NextMux가 텍스트를 추출해 보냅니다.', willDescribeHint: '이 모델은 이 파일 형식을 받지 않아 이름과 형식만 보냅니다.',
        readInParts: '나눠 읽기 · {lines}줄', readInPartsHint: '너무 길어 요청마다 전체를 보내지 않습니다. 텍스트로 저장해 AI가 필요한 부분만 읽으며, 이후 메시지에서도 참조합니다.'
    },
    es: {
        dropTitle: 'Suelta para adjuntar', dropHint: 'Imágenes, PDF, documentos de Office, código y texto, audio, vídeo y carpetas',
        folder: 'Carpeta', folderFiles: '{count} archivos', unsupported: 'Este modelo no admite el formato', remove: 'Quitar', preview: 'Vista previa',
        restoring: 'Restaurando…', restoreFailed: 'No se pudo restaurar', folderEmpty: 'La carpeta no tiene archivos legibles.',
        folderFailed: 'No se pudo leer la carpeta {name}.', folderAsProject: '{name} es ahora la carpeta del proyecto',
        anchoredAfter: 'Colocado después de «{text}»', anchoredStart: 'Colocado al inicio del mensaje', dropInsertTitle: 'Suelta para insertar aquí', dropInsertHint: 'Las carpetas insertan su ruta · los archivos recuerdan esta posición',
        dropReadTitle: 'Suelta para que la IA lo lea', dropReadHint: 'Los archivos y carpetas se añaden como adjuntos',
        dropProjectTitle: 'Suelta para usar como carpeta del proyecto', dropProjectHint: 'Las carpetas serán el directorio del proyecto de esta conversación y los archivos se adjuntarán',
        willExtract: 'Se extrae el texto al enviar', willDescribe: 'El modelo no puede leerlo',
        willExtractHint: 'Este modelo no lee el formato directamente; NextMux extrae el texto y lo envía.', willDescribeHint: 'Este modelo no acepta este tipo de archivo; solo se envían el nombre y el tipo.',
        readInParts: 'Lectura por partes · {lines} líneas', readInPartsHint: 'Demasiado largo para enviarlo entero en cada solicitud: se guardó como texto y la IA lee las partes que necesita, también en mensajes posteriores.'
    },
    fr: {
        dropTitle: 'Déposez pour joindre', dropHint: 'Images, PDF, documents Office, code et texte, audio, vidéo et dossiers',
        folder: 'Dossier', folderFiles: '{count} fichiers', unsupported: 'Format non pris en charge par ce modèle', remove: 'Retirer', preview: 'Aperçu',
        restoring: 'Restauration…', restoreFailed: 'Restauration impossible', folderEmpty: 'Le dossier ne contient aucun fichier lisible.',
        folderFailed: 'Impossible de lire le dossier {name}.', folderAsProject: '{name} est désormais le dossier du projet',
        anchoredAfter: 'Placé après « {text} »', anchoredStart: 'Placé au début du message', dropInsertTitle: 'Déposez pour insérer ici', dropInsertHint: 'Les dossiers insèrent leur chemin · les fichiers retiennent cet endroit',
        dropReadTitle: 'Déposez pour que l’IA le lise', dropReadHint: 'Les fichiers et dossiers sont ajoutés en pièces jointes',
        dropProjectTitle: 'Déposez pour définir comme dossier du projet', dropProjectHint: 'Les dossiers deviennent le répertoire de projet de cette conversation ; les fichiers sont joints',
        willExtract: 'Texte extrait à l’envoi', willDescribe: 'Le modèle ne peut pas le lire',
        willExtractHint: 'Ce modèle ne lit pas ce format directement ; NextMux en extrait le texte et l’envoie.', willDescribeHint: 'Ce modèle n’accepte pas ce type de fichier ; seuls le nom et le type sont envoyés.',
        readInParts: 'Lu par parties · {lines} lignes', readInPartsHint: 'Trop long pour être envoyé en entier à chaque requête : enregistré en texte, l’IA en lit les parties utiles, y compris dans les messages suivants.'
    },
    de: {
        dropTitle: 'Zum Anhängen loslassen', dropHint: 'Bilder, PDFs, Office-Dokumente, Code und Text, Audio, Video und Ordner',
        folder: 'Ordner', folderFiles: '{count} Dateien', unsupported: 'Von diesem Modell nicht unterstützt', remove: 'Entfernen', preview: 'Vorschau',
        restoring: 'Wird wiederhergestellt…', restoreFailed: 'Wiederherstellung fehlgeschlagen', folderEmpty: 'Der Ordner enthält keine lesbaren Dateien.',
        folderFailed: 'Der Ordner {name} konnte nicht gelesen werden.', folderAsProject: '{name} ist jetzt der Projektordner',
        anchoredAfter: 'Nach „{text}“ platziert', anchoredStart: 'Am Anfang der Nachricht platziert', dropInsertTitle: 'Zum Einfügen hier loslassen', dropInsertHint: 'Ordner fügen ihren Pfad ein · Dateien merken sich diese Stelle',
        dropReadTitle: 'Loslassen, damit die KI es liest', dropReadHint: 'Dateien und Ordner werden als Anhänge hinzugefügt',
        dropProjectTitle: 'Loslassen, um als Projektordner festzulegen', dropProjectHint: 'Ordner werden zum Projektverzeichnis dieser Unterhaltung; Dateien werden als Anhänge hinzugefügt',
        willExtract: 'Text wird beim Senden extrahiert', willDescribe: 'Modell kann es nicht lesen',
        willExtractHint: 'Dieses Modell liest das Format nicht direkt; NextMux extrahiert den Text und sendet ihn.', willDescribeHint: 'Dieses Modell akzeptiert diesen Dateityp nicht; nur Name und Typ werden gesendet.',
        readInParts: 'In Teilen gelesen · {lines} Zeilen', readInPartsHint: 'Zu lang, um es mit jeder Anfrage ganz zu senden: als Text gespeichert, die KI liest die nötigen Teile – auch in späteren Nachrichten.'
    },
    'pt-BR': {
        dropTitle: 'Solte para anexar', dropHint: 'Imagens, PDFs, documentos do Office, código e texto, áudio, vídeo e pastas',
        folder: 'Pasta', folderFiles: '{count} arquivos', unsupported: 'Formato não compatível com este modelo', remove: 'Remover', preview: 'Visualizar',
        restoring: 'Restaurando…', restoreFailed: 'Não foi possível restaurar', folderEmpty: 'A pasta não tem arquivos legíveis.',
        folderFailed: 'Não foi possível ler a pasta {name}.', folderAsProject: '{name} agora é a pasta do projeto',
        anchoredAfter: 'Posicionado após “{text}”', anchoredStart: 'Posicionado no início da mensagem', dropInsertTitle: 'Solte para inserir aqui', dropInsertHint: 'Pastas inserem o caminho · arquivos lembram esta posição',
        dropReadTitle: 'Solte para a IA ler', dropReadHint: 'Arquivos e pastas são adicionados como anexos',
        dropProjectTitle: 'Solte para definir como pasta do projeto', dropProjectHint: 'Pastas passam a ser o diretório de projeto desta conversa; arquivos são anexados',
        willExtract: 'Texto extraído ao enviar', willDescribe: 'O modelo não lê este tipo',
        willExtractHint: 'Este modelo não lê o formato diretamente; o NextMux extrai o texto e o envia.', willDescribeHint: 'Este modelo não aceita este tipo de arquivo; só o nome e o tipo são enviados.',
        readInParts: 'Leitura por partes · {lines} linhas', readInPartsHint: 'Longo demais para enviar inteiro a cada solicitação: salvo como texto para a IA ler as partes necessárias, também em mensagens seguintes.'
    },
    ru: {
        dropTitle: 'Отпустите, чтобы прикрепить', dropHint: 'Изображения, PDF, документы Office, код и текст, аудио, видео и папки',
        folder: 'Папка', folderFiles: 'Файлов: {count}', unsupported: 'Формат не поддерживается этой моделью', remove: 'Удалить', preview: 'Просмотр',
        restoring: 'Восстановление…', restoreFailed: 'Не удалось восстановить', folderEmpty: 'В папке нет доступных для чтения файлов.',
        folderFailed: 'Не удалось прочитать папку {name}.', folderAsProject: 'Папка {name} выбрана как папка проекта',
        anchoredAfter: 'После «{text}»', anchoredStart: 'В начале сообщения', dropInsertTitle: 'Отпустите, чтобы вставить сюда', dropInsertHint: 'Папки вставляют путь · файлы запоминают это место',
        dropReadTitle: 'Отпустите, чтобы ИИ прочитал', dropReadHint: 'Файлы и папки добавляются как вложения',
        dropProjectTitle: 'Отпустите, чтобы выбрать папкой проекта', dropProjectHint: 'Папка станет каталогом проекта для этого диалога, а файлы добавятся как вложения',
        willExtract: 'Текст извлекается при отправке', willDescribe: 'Модель не читает этот тип',
        willExtractHint: 'Модель не читает этот формат напрямую, поэтому NextMux извлекает и отправляет текст.', willDescribeHint: 'Модель не принимает этот тип файла; отправляются только имя и тип.',
        readInParts: 'Чтение по частям · строк: {lines}', readInPartsHint: 'Слишком длинный, чтобы отправлять целиком с каждым запросом: сохранён как текст, ИИ читает нужные части, в том числе в следующих сообщениях.'
    },
    ar: {
        dropTitle: 'أفلت للإرفاق', dropHint: 'الصور وملفات PDF ومستندات Office والشيفرة والنصوص والصوت والفيديو والمجلدات',
        folder: 'مجلد', folderFiles: '{count} ملفات', unsupported: 'هذا النموذج لا يدعم هذا التنسيق', remove: 'إزالة', preview: 'معاينة',
        restoring: 'جارٍ الاستعادة…', restoreFailed: 'تعذّرت الاستعادة', folderEmpty: 'لا يحتوي المجلد على ملفات قابلة للقراءة.',
        folderFailed: 'تعذّرت قراءة المجلد {name}.', folderAsProject: 'أصبح {name} مجلد المشروع',
        anchoredAfter: 'بعد «{text}»', anchoredStart: 'في بداية الرسالة', dropInsertTitle: 'أفلت للإدراج هنا', dropInsertHint: 'المجلدات تُدرج مسارها · الملفات تتذكر هذا الموضع',
        dropReadTitle: 'أفلت ليقرأه الذكاء الاصطناعي', dropReadHint: 'تُضاف الملفات والمجلدات كمرفقات',
        dropProjectTitle: 'أفلت لتعيينه مجلدًا للمشروع', dropProjectHint: 'يصبح المجلد دليل المشروع لهذه المحادثة وتُضاف الملفات كمرفقات',
        willExtract: 'يُستخرج النص عند الإرسال', willDescribe: 'لا يستطيع النموذج قراءته',
        willExtractHint: 'لا يقرأ هذا النموذج التنسيق مباشرة، لذا يستخرج NextMux النص ويرسله.', willDescribeHint: 'لا يقبل هذا النموذج هذا النوع من الملفات؛ يُرسل الاسم والنوع فقط.',
        readInParts: 'قراءة على أجزاء · {lines} سطر', readInPartsHint: 'أطول من أن يُرسل كاملًا مع كل طلب: حُفظ نصًا ليقرأ الذكاء الاصطناعي الأجزاء التي يحتاجها، وفي الرسائل اللاحقة أيضًا.'
    },
    hi: {
        dropTitle: 'संलग्न करने के लिए छोड़ें', dropHint: 'इमेज, PDF, Office दस्तावेज़, कोड और टेक्स्ट, ऑडियो, वीडियो और फ़ोल्डर',
        folder: 'फ़ोल्डर', folderFiles: '{count} फ़ाइलें', unsupported: 'यह मॉडल इस फ़ॉर्मैट का समर्थन नहीं करता', remove: 'हटाएँ', preview: 'पूर्वावलोकन',
        restoring: 'पुनर्स्थापित हो रहा है…', restoreFailed: 'पुनर्स्थापित नहीं हो सका', folderEmpty: 'फ़ोल्डर में पढ़ने योग्य फ़ाइलें नहीं हैं।',
        folderFailed: 'फ़ोल्डर {name} पढ़ा नहीं जा सका।', folderAsProject: '{name} अब प्रोजेक्ट फ़ोल्डर है',
        anchoredAfter: '“{text}” के बाद', anchoredStart: 'संदेश की शुरुआत में', dropInsertTitle: 'यहाँ डालने के लिए छोड़ें', dropInsertHint: 'फ़ोल्डर अपना पथ डालते हैं · फ़ाइलें यह जगह याद रखती हैं',
        dropReadTitle: 'AI के पढ़ने के लिए छोड़ें', dropReadHint: 'फ़ाइलें और फ़ोल्डर अटैचमेंट के रूप में जुड़ते हैं',
        dropProjectTitle: 'प्रोजेक्ट फ़ोल्डर बनाने के लिए छोड़ें', dropProjectHint: 'फ़ोल्डर इस बातचीत की प्रोजेक्ट निर्देशिका बन जाएगा और फ़ाइलें अटैचमेंट के रूप में जुड़ेंगी',
        willExtract: 'भेजते समय टेक्स्ट निकाला जाएगा', willDescribe: 'मॉडल इसे सीधे नहीं पढ़ सकता',
        willExtractHint: 'यह मॉडल फ़ॉर्मैट सीधे नहीं पढ़ता, इसलिए NextMux टेक्स्ट निकालकर भेजता है।', willDescribeHint: 'यह मॉडल इस फ़ाइल प्रकार को स्वीकार नहीं करता; केवल नाम और प्रकार भेजे जाते हैं।',
        readInParts: 'हिस्सों में पढ़ा जाता है · {lines} पंक्तियाँ', readInPartsHint: 'हर अनुरोध के साथ पूरा भेजने के लिए बहुत लंबा: टेक्स्ट के रूप में सहेजा गया, AI ज़रूरी हिस्से पढ़ता है — आगे के संदेशों में भी।'
    }
};

function uncheckedComposerAttachmentUiText(locale: NextMuxDesktopLocale, key: ComposerAttachmentUiKey, values: Readonly<Record<string, string | number>> = {}): string {
    const template = catalog[locale]?.[key] || catalog.en[key];
    return template.replace(/\{(\w+)\}/g, (match, name: string) => name in values ? String(values[name]) : match);
}

// ---------------------------------------------------------------------------
// File types

export type FileTypeFamily = 'folder' | 'image' | 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'archive'
    | 'audio' | 'video' | 'code' | 'data' | 'markup' | 'text' | 'font' | 'binary';

export interface FileTypeInfo {
    readonly family: FileTypeFamily;
    /** Short badge text, at most four characters. */
    readonly label: string;
    readonly color: string;
    /** Badge text colour; white unless the badge colour is light. */
    readonly ink: string;
}

const dark = '#1d1b1c';
type Spec = readonly [FileTypeFamily, string, string?, string?];

// Extension → [family, colour, badge label override, ink]. Colours follow each
// format's or language's widely recognised identity colour.
const specs: Readonly<Record<string, Spec>> = {
    // Documents
    pdf: ['pdf', '#e5484d'],
    doc: ['document', '#2b6cd4'], docx: ['document', '#2b6cd4'], odt: ['document', '#2b6cd4'], rtf: ['document', '#2b6cd4'],
    pages: ['document', '#f09a36'], wpd: ['document', '#2b6cd4'],
    xls: ['spreadsheet', '#1f8a4c'], xlsx: ['spreadsheet', '#1f8a4c'], xlsm: ['spreadsheet', '#1f8a4c'], ods: ['spreadsheet', '#1f8a4c'],
    numbers: ['spreadsheet', '#2fb35a', 'NUM'], csv: ['spreadsheet', '#2e9e6b'], tsv: ['spreadsheet', '#2e9e6b'],
    ppt: ['presentation', '#d9582b'], pptx: ['presentation', '#d9582b'], odp: ['presentation', '#d9582b'], key: ['presentation', '#2f7de1'],
    epub: ['document', '#7a5bc7'], mobi: ['document', '#7a5bc7'],
    // Images
    png: ['image', '#8e5bd8'], jpg: ['image', '#8e5bd8'], jpeg: ['image', '#8e5bd8', 'JPG'], webp: ['image', '#8e5bd8'], gif: ['image', '#8e5bd8'],
    bmp: ['image', '#8e5bd8'], avif: ['image', '#8e5bd8'], heic: ['image', '#8e5bd8'], heif: ['image', '#8e5bd8'], tif: ['image', '#8e5bd8'],
    tiff: ['image', '#8e5bd8', 'TIF'], ico: ['image', '#8e5bd8'], jxl: ['image', '#8e5bd8'], svg: ['image', '#e3a21a', undefined, dark],
    psd: ['image', '#2d8ceb'], ai: ['image', '#e8830c'], sketch: ['image', '#e8a70c', 'SKT', dark], fig: ['image', '#a259ff'],
    raw: ['image', '#8e5bd8'], dng: ['image', '#8e5bd8'], cr2: ['image', '#8e5bd8'], nef: ['image', '#8e5bd8'],
    // Audio / video
    mp3: ['audio', '#d6457c'], wav: ['audio', '#d6457c'], m4a: ['audio', '#d6457c'], aac: ['audio', '#d6457c'], ogg: ['audio', '#d6457c'],
    oga: ['audio', '#d6457c'], opus: ['audio', '#d6457c'], flac: ['audio', '#d6457c'], aiff: ['audio', '#d6457c'], aif: ['audio', '#d6457c'], mid: ['audio', '#d6457c'], midi: ['audio', '#d6457c', 'MIDI'],
    mp4: ['video', '#6750d9'], mov: ['video', '#6750d9'], m4v: ['video', '#6750d9'], webm: ['video', '#6750d9'], mkv: ['video', '#6750d9'],
    avi: ['video', '#6750d9'], mpeg: ['video', '#6750d9', 'MPG'], mpg: ['video', '#6750d9'], wmv: ['video', '#6750d9'], flv: ['video', '#6750d9'], '3gp': ['video', '#6750d9'],
    // Archives
    zip: ['archive', '#a47a3b'], rar: ['archive', '#a47a3b'], '7z': ['archive', '#a47a3b'], tar: ['archive', '#a47a3b'], gz: ['archive', '#a47a3b'],
    tgz: ['archive', '#a47a3b'], bz2: ['archive', '#a47a3b'], xz: ['archive', '#a47a3b'], zst: ['archive', '#a47a3b'], dmg: ['archive', '#7c858f'],
    iso: ['archive', '#7c858f'], pkg: ['archive', '#7c858f'], deb: ['archive', '#a80030'], rpm: ['archive', '#cc0000'], apk: ['archive', '#3ddc84', undefined, dark],
    jar: ['archive', '#b07219'], whl: ['archive', '#3572a5'],
    // Fonts
    ttf: ['font', '#56606b'], otf: ['font', '#56606b'], woff: ['font', '#56606b'], woff2: ['font', '#56606b', 'WOF2'],
    // Code
    ts: ['code', '#3178c6'], tsx: ['code', '#3178c6'], mts: ['code', '#3178c6'], cts: ['code', '#3178c6'], 'd.ts': ['code', '#3178c6'],
    js: ['code', '#f0d43a', undefined, dark], jsx: ['code', '#f0d43a', undefined, dark], mjs: ['code', '#f0d43a', undefined, dark], cjs: ['code', '#f0d43a', undefined, dark],
    py: ['code', '#3572a5'], pyi: ['code', '#3572a5'], pyx: ['code', '#3572a5'], ipynb: ['code', '#f37626', 'NB'],
    go: ['code', '#00add8'], rs: ['code', '#c7663d'], java: ['code', '#b07219'], kt: ['code', '#a97bff'], kts: ['code', '#a97bff'],
    c: ['code', '#555f6b'], h: ['code', '#555f6b'], cpp: ['code', '#f34b7d', 'C++'], cc: ['code', '#f34b7d', 'C++'], cxx: ['code', '#f34b7d', 'C++'],
    hpp: ['code', '#f34b7d', 'H++'], hh: ['code', '#f34b7d'], cs: ['code', '#178600', 'C#'], fs: ['code', '#b845fc', 'F#'], fsx: ['code', '#b845fc', 'F#'],
    rb: ['code', '#cc342d'], erb: ['code', '#cc342d'], rake: ['code', '#cc342d'], gemspec: ['code', '#cc342d', 'GEM'],
    php: ['code', '#777bb3'], swift: ['code', '#f05138'], m: ['code', '#438eff', 'OBJC'], mm: ['code', '#438eff', 'OBJC'],
    dart: ['code', '#00b4ab'], lua: ['code', '#000080'], r: ['code', '#198ce7'], rmd: ['code', '#198ce7'], jl: ['code', '#a270ba'],
    ex: ['code', '#6e4a7e'], exs: ['code', '#6e4a7e'], erl: ['code', '#b83998'], hrl: ['code', '#b83998'], clj: ['code', '#5881d8'], cljs: ['code', '#5881d8'],
    groovy: ['code', '#4298b8'], gradle: ['code', '#02303a'], scala: ['code', '#c22d40'], sbt: ['code', '#c22d40'], hs: ['code', '#5e5086'],
    ml: ['code', '#ef7a08'], mli: ['code', '#ef7a08'], elm: ['code', '#60b5cc'], nim: ['code', '#ffc200', undefined, dark], zig: ['code', '#ec915c'],
    cr: ['code', '#000100'], d: ['code', '#ba595e'], pl: ['code', '#0298c3'], pm: ['code', '#0298c3'], tcl: ['code', '#e4cc98', undefined, dark],
    vb: ['code', '#945db7'], vbs: ['code', '#945db7'], pas: ['code', '#e3f171', undefined, dark], f90: ['code', '#4d41b1'], f: ['code', '#4d41b1'],
    sol: ['code', '#aa6746'], move: ['code', '#4a137a'], v: ['code', '#b2b7f8', undefined, dark], sv: ['code', '#dae1c2', undefined, dark], vhd: ['code', '#adb2cb', undefined, dark],
    asm: ['code', '#6e4c13'], s: ['code', '#6e4c13'], wasm: ['binary', '#654ff0'], wat: ['code', '#654ff0'],
    cu: ['code', '#3a4e3a'], glsl: ['code', '#5686a5'], hlsl: ['code', '#aace60', undefined, dark], wgsl: ['code', '#1a5e9a'], metal: ['code', '#8f14e9'],
    sh: ['code', '#3f9b3a'], bash: ['code', '#3f9b3a'], zsh: ['code', '#3f9b3a'], fish: ['code', '#3f9b3a'], ps1: ['code', '#012456'], psm1: ['code', '#012456'],
    bat: ['code', '#c1f12e', undefined, dark], cmd: ['code', '#c1f12e', undefined, dark], applescript: ['code', '#101f1f', 'AS'],
    sql: ['data', '#e38c00'], prisma: ['data', '#2d3748'], graphql: ['data', '#e10098', 'GQL'], gql: ['data', '#e10098'], proto: ['data', '#4a8bd6'],
    thrift: ['data', '#d12127'], vue: ['code', '#41b883'], svelte: ['code', '#ff3e00'], astro: ['code', '#ff5a03'],
    // Markup / styles
    html: ['markup', '#e34c26'], htm: ['markup', '#e34c26'], xhtml: ['markup', '#e34c26'], xml: ['markup', '#0060ac'], xsd: ['markup', '#0060ac'],
    xsl: ['markup', '#0060ac'], plist: ['markup', '#7c858f'], css: ['markup', '#663399'], scss: ['markup', '#c6538c'], sass: ['markup', '#c6538c'],
    less: ['markup', '#1d365d'], styl: ['markup', '#ff6347'], pcss: ['markup', '#dd3a0a'], pug: ['markup', '#a86454'], hbs: ['markup', '#f7931e'],
    ejs: ['markup', '#a91e50'], njk: ['markup', '#3d8137'], liquid: ['markup', '#67b8de'], twig: ['markup', '#c1d026', undefined, dark], jinja: ['markup', '#a52a22'],
    md: ['text', '#3b6fd6'], markdown: ['text', '#3b6fd6', 'MD'], mdx: ['text', '#3b6fd6'], rst: ['text', '#141414'], adoc: ['text', '#e40046'],
    tex: ['text', '#3d6117'], bib: ['text', '#3d6117'], org: ['text', '#77aa99'], txt: ['text', '#6b7280'], log: ['text', '#6b7280'],
    srt: ['text', '#6b7280'], vtt: ['text', '#6b7280'],
    // Data / configuration
    json: ['data', '#c0a02d', undefined, dark], jsonc: ['data', '#c0a02d', undefined, dark], json5: ['data', '#c0a02d', undefined, dark], jsonl: ['data', '#c0a02d', undefined, dark],
    ndjson: ['data', '#c0a02d', 'NDJS', dark], geojson: ['data', '#c0a02d', 'GEO', dark], map: ['data', '#8a8f98'],
    yaml: ['data', '#cb171e', 'YML'], yml: ['data', '#cb171e'], toml: ['data', '#9c4221'], ini: ['data', '#6b7280'], cfg: ['data', '#6b7280'],
    conf: ['data', '#6b7280'], env: ['data', '#ecd53f', undefined, dark], properties: ['data', '#6b7280', 'PROP'], lock: ['data', '#8a8f98'],
    tf: ['data', '#7b42bc'], tfvars: ['data', '#7b42bc', 'TF'], hcl: ['data', '#7b42bc'], nix: ['data', '#7e7eff'], cue: ['data', '#5886e1'],
    dbml: ['data', '#6b7280'], diff: ['data', '#41535b'], patch: ['data', '#41535b'], sqlite: ['data', '#0f80cc', 'DB'], db: ['data', '#0f80cc'],
    parquet: ['data', '#50abf1'], avro: ['data', '#0040ff'], npy: ['data', '#013243'], h5: ['data', '#4d6c95'], pkl: ['data', '#3572a5']
};

const fileNameSpecs: Readonly<Record<string, Spec>> = {
    dockerfile: ['code', '#2496ed', 'DOCK'], containerfile: ['code', '#2496ed', 'DOCK'], makefile: ['code', '#427819', 'MAKE'],
    gnumakefile: ['code', '#427819', 'MAKE'], cmakelists: ['code', '#064f8c', 'CMK'], gemfile: ['code', '#cc342d', 'GEM'],
    rakefile: ['code', '#cc342d', 'RAKE'], podfile: ['code', '#ee3322', 'POD'], procfile: ['data', '#6b7280', 'PROC'],
    vagrantfile: ['code', '#1868f2', 'VAG'], brewfile: ['code', '#fbb040', 'BREW', dark], justfile: ['code', '#384d54', 'JUST'],
    license: ['text', '#6b7280', 'LIC'], licence: ['text', '#6b7280', 'LIC'], readme: ['text', '#3b6fd6', 'READ'], changelog: ['text', '#3b6fd6', 'LOG'],
    codeowners: ['data', '#6b7280', 'OWN'], '.gitignore': ['data', '#f05133', 'GIT'], '.gitattributes': ['data', '#f05133', 'GIT'],
    '.gitmodules': ['data', '#f05133', 'GIT'], '.dockerignore': ['data', '#2496ed', 'DOCK'], '.editorconfig': ['data', '#6b7280', 'CFG'],
    '.npmrc': ['data', '#cb3837', 'NPM'], '.nvmrc': ['data', '#3f9b3a', 'NVM'], '.prettierrc': ['data', '#56b3b4', 'PRET'],
    '.eslintrc': ['data', '#4b32c3', 'LINT'], '.babelrc': ['data', '#f5da55', 'BABL', dark], '.env': ['data', '#ecd53f', 'ENV', dark]
};

const familyDefaults: Readonly<Record<FileTypeFamily, readonly [string, string]>> = {
    folder: ['#4f8fe8', ''], image: ['#8e5bd8', 'IMG'], pdf: ['#e5484d', 'PDF'], document: ['#2b6cd4', 'DOC'],
    spreadsheet: ['#1f8a4c', 'XLS'], presentation: ['#d9582b', 'PPT'], archive: ['#a47a3b', 'ZIP'], audio: ['#d6457c', 'AUD'],
    video: ['#6750d9', 'VID'], code: ['#56606b', 'CODE'], data: ['#6b7280', 'DATA'], markup: ['#e34c26', 'XML'],
    text: ['#6b7280', 'TXT'], font: ['#56606b', 'FONT'], binary: ['#7c858f', 'BIN']
};

/** Lower-case extension after the last dot; `.env.local` style dotfiles resolve to their base name. */
export function fileExtension(name: string): string {
    const base = name.trim().split(/[\\/]/).pop()?.toLocaleLowerCase() || '';
    if (base.endsWith('.d.ts')) return 'd.ts';
    const index = base.lastIndexOf('.');
    return index > 0 ? base.slice(index + 1) : '';
}

export const FOLDER_SNAPSHOT_SUFFIX = '.folder.md';

export function isFolderSnapshotName(name: string): boolean {
    return name.toLocaleLowerCase().endsWith(FOLDER_SNAPSHOT_SUFFIX) && name.length > FOLDER_SNAPSHOT_SUFFIX.length;
}

/** Name to show for an attachment: a folder snapshot shows as `name/`. */
export function attachmentDisplayName(name: string): string {
    return isFolderSnapshotName(name) ? `${name.slice(0, -FOLDER_SNAPSHOT_SUFFIX.length)}/` : name;
}

export function fileTypeInfo(name: string, mimeType = '', kind?: 'image' | 'text' | 'file'): FileTypeInfo {
    if (isFolderSnapshotName(name)) return { family: 'folder', label: '', color: familyDefaults.folder[0], ink: '#fff' };
    const base = name.trim().split(/[\\/]/).pop()?.toLocaleLowerCase() || '';
    const stem = base.replace(/\.[^.]*$/, '');
    const extension = fileExtension(name);
    const named = fileNameSpecs[base] || (base.startsWith('.env') ? fileNameSpecs['.env'] : undefined)
        || (!extension || extension === 'txt' || extension === 'md' ? fileNameSpecs[stem] : undefined);
    const spec = named || specs[extension];
    if (spec) {
        const [family, color, label, ink] = spec;
        return { family, color, label: (label ?? extension).toLocaleUpperCase().slice(0, 4), ink: ink || '#fff' };
    }
    const mime = mimeType.toLocaleLowerCase();
    const family: FileTypeFamily = kind === 'image' || mime.startsWith('image/') ? 'image'
        : mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : mime === 'application/pdf' ? 'pdf'
        : kind === 'text' || mime.startsWith('text/') ? 'text' : 'binary';
    const [color, fallback] = familyDefaults[family];
    const label = extension && extension.length <= 4 && /^[a-z0-9+#]+$/.test(extension) ? extension.toLocaleUpperCase() : fallback;
    return { family, color, label, ink: '#fff' };
}

// ---------------------------------------------------------------------------
// Icons

export function FileTypeIcon({ name, mimeType, kind, size = 30 }: {
    readonly name: string; readonly mimeType?: string; readonly kind?: 'image' | 'text' | 'file'; readonly size?: number
}): React.ReactElement {
    const info = fileTypeInfo(name, mimeType, kind);
    if (info.family === 'folder') {
        return <svg className='nmx-file-type-icon is-folder' width={size} height={size} viewBox='0 0 32 32' aria-hidden='true' focusable='false'>
            <path className='nmx-folder-back' d='M3 8.5A2.5 2.5 0 0 1 5.5 6h6.4c.7 0 1.3.3 1.8.8l1.6 1.7h11.2A2.5 2.5 0 0 1 29 11v13.5a2.5 2.5 0 0 1-2.5 2.5h-21A2.5 2.5 0 0 1 3 24.5z' fill={info.color} />
            <path className='nmx-folder-front' d='M3 12.5A2.5 2.5 0 0 1 5.5 10h21a2.5 2.5 0 0 1 2.5 2.5v12a2.5 2.5 0 0 1-2.5 2.5h-21A2.5 2.5 0 0 1 3 24.5z' fill={info.color} />
        </svg>;
    }
    const label = info.label;
    const badgeWidth = Math.max(13, 5 + label.length * 4.6);
    return <svg className={`nmx-file-type-icon is-${info.family}`} width={size} height={size} viewBox='0 0 32 32' aria-hidden='true' focusable='false'>
        <path className='nmx-file-page' d='M8 2.5h10.2c.5 0 1 .2 1.4.6l5.8 5.8c.4.4.6.9.6 1.4V27a2.5 2.5 0 0 1-2.5 2.5H8A2.5 2.5 0 0 1 5.5 27V5A2.5 2.5 0 0 1 8 2.5z' />
        <path className='nmx-file-fold' d='M18.5 2.7V8a1.9 1.9 0 0 0 1.9 1.9h5.4' />
        <path d='M9.5 12.5h8M9.5 15.5h11' className='nmx-file-lines' />
        {label && <g>
            <rect x={16 - badgeWidth / 2} y='18' width={badgeWidth} height='8.6' rx='2.2' fill={info.color} />
            <text x='16' y='24.35' textAnchor='middle' fill={info.ink} fontSize={label.length > 3 ? 5.4 : 6} fontWeight='700'
                fontFamily='-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' letterSpacing='.1'>{label}</text>
        </g>}
    </svg>;
}

// ---------------------------------------------------------------------------
// Chip

export interface AttachmentChipProps {
    readonly name: string;
    readonly kind?: 'image' | 'text' | 'file';
    readonly mimeType?: string;
    readonly meta?: string;
    readonly thumbnail?: string;
    readonly state?: 'ready' | 'unsupported' | 'pending' | 'failed' | 'converted' | 'limited';
    readonly hint?: string;
    readonly locale: NextMuxDesktopLocale;
    readonly onPreview?: () => void;
    readonly onRemove?: () => void;
    readonly removeLabel?: string;
    readonly previewLabel?: string;
    readonly leaving?: boolean;
    /** The attachment remembers a position in the message text. */
    readonly anchored?: boolean;
    readonly className?: string;
    readonly children?: React.ReactNode;
}

/**
 * One attachment in the composer. The name is truncated to one line; the
 * native tooltip carries the full name (and the reason when unusable).
 */
export function AttachmentChip(props: AttachmentChipProps): React.ReactElement {
    const { name, kind, mimeType, thumbnail, state = 'ready', locale } = props;
    const display = attachmentDisplayName(name);
    const info = fileTypeInfo(name, mimeType, kind);
    const typeLabel = info.family === 'folder' ? composerAttachmentUiText(locale, 'folder') : info.label || '';
    const meta = [typeLabel, props.meta].filter(Boolean).join(' · ');
    const title = [display, props.hint].filter(Boolean).join('\n');
    const body = <>
        <span className={`nmx-attachment-thumb is-${info.family}`}>
            {thumbnail ? <img src={thumbnail} alt='' draggable={false} /> : <FileTypeIcon name={name} mimeType={mimeType} kind={kind} />}
            {state === 'pending' && <i className='nmx-attachment-spinner' aria-hidden='true'></i>}
            {state === 'failed' && <i className='codicon codicon-warning nmx-attachment-state' aria-hidden='true'></i>}
            {props.anchored && <i className='codicon codicon-pinned nmx-attachment-anchor' aria-hidden='true'></i>}
        </span>
        <span className='nmx-attachment-text'>
            <b data-nmx-literal>{display}</b>
            <small>{state === 'unsupported' ? composerAttachmentUiText(locale, 'unsupported')
                : state === 'converted' ? `${typeLabel} · ${composerAttachmentUiText(locale, 'willExtract')}`
                : state === 'limited' ? composerAttachmentUiText(locale, 'willDescribe')
                : state === 'pending' ? composerAttachmentUiText(locale, 'restoring')
                : state === 'failed' ? composerAttachmentUiText(locale, 'restoreFailed') : meta}</small>
        </span>
    </>;
    return <span className={`nmx-attachment-chip is-${state}${props.leaving ? ' is-leaving' : ''}${props.className ? ` ${props.className}` : ''}`} title={title} data-file-family={info.family}>
        {props.onPreview
            ? <button type='button' className='nmx-attachment-preview' aria-label={props.previewLabel || display} onClick={props.onPreview}>{body}</button>
            : <span className='nmx-attachment-label'>{body}</span>}
        {props.children}
        {props.onRemove && <button type='button' className='nmx-attachment-remove' aria-label={props.removeLabel || composerAttachmentUiText(locale, 'remove')}
            title={props.removeLabel || composerAttachmentUiText(locale, 'remove')} onClick={props.onRemove}><i className='codicon codicon-close' aria-hidden='true'></i></button>}
    </span>;
}

export function ComposerDropOverlay({ locale, variant = 'composer', asProject = false }: { readonly locale: NextMuxDesktopLocale; readonly variant?: 'composer' | 'thread'; readonly asProject?: boolean }): React.ReactElement {
    if (variant === 'thread') {
        return <div className='nmx-thread-drop-overlay' role='presentation'>
            <div className='nmx-thread-drop-card'>
                <span className='nmx-drop-stack' aria-hidden='true'>
                    <span className='nmx-drop-card is-back'><FileTypeIcon name='a.docx' size={26} /></span>
                    <span className='nmx-drop-card is-mid'><FileTypeIcon name='a.ts' size={26} /></span>
                    <span className='nmx-drop-card is-front'><FileTypeIcon name='folder.folder.md' size={26} /></span>
                </span>
                <span className='nmx-drop-copy'>
                    <strong>{composerAttachmentUiText(locale, asProject ? 'dropProjectTitle' : 'dropReadTitle')}</strong>
                    <small>{composerAttachmentUiText(locale, asProject ? 'dropProjectHint' : 'dropReadHint')}</small>
                </span>
            </div>
        </div>;
    }
    return <div className='nmx-composer-drop-overlay' role='presentation'>
        <span className='nmx-drop-stack' aria-hidden='true'>
            <span className='nmx-drop-card is-back'><FileTypeIcon name='a.pdf' size={26} /></span>
            <span className='nmx-drop-card is-mid'><FileTypeIcon name='a.png' size={26} /></span>
            <span className='nmx-drop-card is-front'><FileTypeIcon name='folder.folder.md' size={26} /></span>
        </span>
        <span className='nmx-drop-copy'>
            <strong>{composerAttachmentUiText(locale, 'dropTitle')}</strong>
            <small>{composerAttachmentUiText(locale, 'dropHint')}</small>
        </span>
    </div>;
}

// ---------------------------------------------------------------------------
// Image normalisation

/** Image formats models rarely accept natively. Chromium decodes BMP, AVIF and ICO; the rest stay as files when it cannot. */
export const CONVERTIBLE_IMAGE_MIME = /^image\/(bmp|x-ms-bmp|avif|x-icon|vnd\.microsoft\.icon|heic|heif|tiff|jxl)$/;

/**
 * Re-encode a decodable image as PNG (JPEG when the PNG would exceed the
 * image limit). Returns undefined when this runtime cannot decode the source,
 * in which case the original bytes are attached unchanged.
 */
export async function convertImageForModels(name: string, bytes: Uint8Array, mimeType: string, maxBytes = 10 * 1024 * 1024)
    : Promise<{ readonly name: string; readonly bytes: Uint8Array; readonly mimeType: string } | undefined> {
    if (!CONVERTIBLE_IMAGE_MIME.test(mimeType) || typeof createImageBitmap !== 'function' || typeof document === 'undefined') return undefined;
    let bitmap: ImageBitmap | undefined;
    try {
        const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
        bitmap = await createImageBitmap(blob);
        const longest = Math.max(bitmap.width, bitmap.height);
        const scale = longest > 4096 ? 4096 / longest : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (!context) return undefined;
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const encode = (type: string, quality?: number) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
        let output = await encode('image/png'), outputType = 'image/png';
        if (!output || output.size > maxBytes) { output = await encode('image/jpeg', .9); outputType = 'image/jpeg'; }
        if (!output || output.size > maxBytes) return undefined;
        const stem = name.replace(/\.[^.]+$/, '') || 'image';
        return { name: `${stem}.${outputType === 'image/png' ? 'png' : 'jpg'}`, bytes: new Uint8Array(await output.arrayBuffer()), mimeType: outputType };
    } catch {
        return undefined;
    } finally {
        bitmap?.close();
    }
}

/**
 * Scale an oversized photo or screenshot to at most 2560 px on its longest
 * side and re-encode it under `maxBytes` (JPEG, or WebP when it has
 * transparency). Returns undefined if it cannot be made smaller.
 */
export async function shrinkImageForModels(name: string, bytes: Uint8Array, mimeType: string, maxBytes = 5 * 1024 * 1024)
    : Promise<{ readonly name: string; readonly bytes: Uint8Array; readonly mimeType: string } | undefined> {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return undefined;
    let bitmap: ImageBitmap | undefined;
    try {
        bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: mimeType }));
        const stem = name.replace(/\.[^.]+$/, '') || 'image';
        for (const side of [2560, 2048, 1600, 1280]) {
            const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            const context = canvas.getContext('2d');
            if (!context) return undefined;
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const alpha = mimeType !== 'image/jpeg' && context.getImageData(0, 0, Math.min(canvas.width, 64), Math.min(canvas.height, 64)).data.some((value, index) => index % 4 === 3 && value < 255);
            const type = alpha ? 'image/webp' : 'image/jpeg';
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, .88));
            if (blob && blob.size <= maxBytes) return { name: `${stem}.${type === 'image/webp' ? 'webp' : 'jpg'}`, bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: type };
        }
        return undefined;
    } catch {
        return undefined;
    } finally {
        bitmap?.close();
    }
}

// ---------------------------------------------------------------------------
// Folder snapshot

/** The subset of the File and Directory Entries API the snapshot needs. */
export interface FolderEntryLike {
    readonly name: string;
    readonly isFile: boolean;
    readonly isDirectory: boolean;
}
export interface FolderFileEntryLike extends FolderEntryLike {
    file(success: (file: File) => void, failure?: (error: unknown) => void): void;
}
export interface FolderDirectoryEntryLike extends FolderEntryLike {
    createReader(): { readEntries(success: (entries: FolderEntryLike[]) => void, failure?: (error: unknown) => void): void };
}

export interface FolderSnapshotOptions {
    /** Path of the folder inside the open project, when it is inside it. */
    readonly workspaceRelativePath?: string;
    readonly maxCharacters?: number;
    readonly maxFileCharacters?: number;
    readonly maxEntries?: number;
    readonly maxDepth?: number;
    readonly maxTreeLines?: number;
    readonly isTextName?: (name: string) => boolean;
}

export interface FolderSnapshot {
    readonly name: string;
    readonly content: string;
    readonly fileCount: number;
    readonly includedCount: number;
}

/** Generated, vendored or VCS directories that never help a model read a project. */
export const FOLDER_SKIP_DIRECTORIES: ReadonlySet<string> = new Set([
    '.git', '.hg', '.svn', 'node_modules', 'bower_components', 'jspm_packages', '.pnpm-store', '.yarn', 'dist', 'build', 'out', 'target',
    '.next', '.nuxt', '.svelte-kit', '.turbo', '.parcel-cache', '.cache', '.vite', 'coverage', '.nyc_output', '__pycache__', '.venv', 'venv',
    '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache', '.gradle', '.idea', '.vs', 'Pods', 'DerivedData', 'vendor', '.terraform', '.DS_Store'
]);

/** Files that commonly hold credentials; they are listed but their contents are never read. */
export function isSensitiveFileName(name: string): boolean {
    const lower = name.toLocaleLowerCase();
    return /^\.env(\..+)?$/.test(lower) && !/\.(example|sample|template|dist)$/.test(lower)
        || /\.(pem|key|p12|pfx|jks|keystore|kdbx|ppk|asc|gpg)$/.test(lower)
        || /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/.test(lower)
        || ['.npmrc', '.pypirc', '.netrc', '.git-credentials', 'credentials', 'credentials.json', 'secrets.json', 'service-account.json'].includes(lower);
}

const priorityNames = ['readme', 'readme.md', 'package.json', 'pyproject.toml', 'cargo.toml', 'go.mod', 'pom.xml', 'build.gradle',
    'build.gradle.kts', 'composer.json', 'gemfile', 'requirements.txt', 'tsconfig.json', 'dockerfile', 'makefile'];

const readEntries = (directory: FolderDirectoryEntryLike): Promise<FolderEntryLike[]> => new Promise((resolve, reject) => {
    const reader = directory.createReader(), all: FolderEntryLike[] = [];
    // readEntries returns batches (100 in Chromium) until an empty batch.
    const next = (): void => reader.readEntries(batch => {
        if (!batch.length) { resolve(all); return; }
        all.push(...batch);
        if (all.length > 20_000) { resolve(all); return; }
        next();
    }, reject);
    next();
});

const readFile = (entry: FolderFileEntryLike): Promise<File> => new Promise((resolve, reject) => entry.file(resolve, reject));

function fence(content: string): string {
    const longest = Math.max(2, ...(content.match(/`{3,}/g) || []).map(run => run.length));
    return '`'.repeat(longest + 1);
}

/**
 * Read a dropped directory into one Markdown document: a tree of every file
 * (generated and vendored folders skipped) followed by the contents of the
 * readable text files, most useful first, within a character budget that fits
 * the text-attachment limit. Credentials are listed but never read.
 */
export async function buildFolderSnapshot(root: FolderDirectoryEntryLike, options: FolderSnapshotOptions = {}): Promise<FolderSnapshot> {
    const maxCharacters = options.maxCharacters ?? 110_000;
    const maxFileCharacters = options.maxFileCharacters ?? 24_000;
    const maxEntries = options.maxEntries ?? 4_000;
    const maxDepth = options.maxDepth ?? 12;
    const maxTreeLines = options.maxTreeLines ?? 400;
    const isText = options.isTextName ?? (() => true);
    interface Node { readonly path: string; readonly depth: number; readonly directory: boolean; readonly entry: FolderEntryLike }
    const nodes: Node[] = [];
    const skipped: string[] = [];
    let truncated = false;
    const walk = async (directory: FolderDirectoryEntryLike, prefix: string, depth: number): Promise<void> => {
        const children = (await readEntries(directory)).sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
        for (const child of children) {
            if (nodes.length >= maxEntries) { truncated = true; return; }
            const path = prefix ? `${prefix}/${child.name}` : child.name;
            if (child.isDirectory) {
                if (FOLDER_SKIP_DIRECTORIES.has(child.name)) { skipped.push(`${path}/`); continue; }
                nodes.push({ path, depth, directory: true, entry: child });
                if (depth + 1 < maxDepth) await walk(child as FolderDirectoryEntryLike, path, depth + 1);
                else truncated = true;
            } else if (child.isFile && child.name !== '.DS_Store') nodes.push({ path, depth, directory: false, entry: child });
        }
    };
    await walk(root, '', 0);
    const files = nodes.filter(node => !node.directory);
    const rank = (node: Node): number => {
        const name = node.entry.name.toLocaleLowerCase();
        const priority = priorityNames.indexOf(name);
        return priority >= 0 && node.depth === 0 ? priority - 100 : node.depth * 10 + (name.startsWith('.') ? 5 : 0);
    };
    const candidates = files.filter(node => !isSensitiveFileName(node.entry.name) && isText(node.entry.name))
        .sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
    const header = [
        `# Folder: ${root.name}/`,
        options.workspaceRelativePath ? `Project path: ${options.workspaceRelativePath}/ (other files can be read from the project directly)` : '',
        `Files: ${files.length}${truncated ? '+' : ''}`
    ].filter(Boolean).join('\n');
    const treeLines = nodes.slice(0, maxTreeLines).map(node => `${'  '.repeat(node.depth + 1)}${node.entry.name}${node.directory ? '/' : ''}`);
    if (nodes.length > maxTreeLines) treeLines.push(`  … ${nodes.length - maxTreeLines} more`);
    if (skipped.length) treeLines.push(`  (skipped: ${skipped.slice(0, 12).join(', ')}${skipped.length > 12 ? ', …' : ''})`);
    const tree = `## Structure\n${root.name}/\n${treeLines.join('\n')}`;
    let used = header.length + tree.length + 32;
    const sections: string[] = [];
    const omitted: string[] = [];
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (const node of candidates) {
        if (used >= maxCharacters - 200) { omitted.push(node.path); continue; }
        let text: string;
        try {
            const file = await readFile(node.entry as FolderFileEntryLike);
            if (file.size > 512 * 1024) { omitted.push(node.path); continue; }
            const bytes = new Uint8Array(await file.arrayBuffer());
            if (bytes.subarray(0, 8_192).includes(0)) continue;
            text = decoder.decode(bytes);
        } catch {
            continue;
        }
        const budget = Math.min(maxFileCharacters, maxCharacters - used - 120);
        if (budget < 400 && text.length > budget) { omitted.push(node.path); continue; }
        const clipped = text.length > budget ? `${text.slice(0, budget)}\n… (truncated, ${text.length - budget} more characters)` : text;
        const language = fileExtension(node.entry.name);
        const marker = fence(clipped);
        const section = `### ${node.path}\n${marker}${language}\n${clipped}${clipped.endsWith('\n') ? '' : '\n'}${marker}`;
        sections.push(section);
        used += section.length + 2;
    }
    const footer = omitted.length ? `\n\n_Contents not included (size budget): ${omitted.slice(0, 40).join(', ')}${omitted.length > 40 ? ', …' : ''}_` : '';
    const content = `${header}\n\n${tree}\n\n## Contents\n\n${sections.join('\n\n')}${footer}\n`;
    return { name: root.name, content, fileCount: files.length, includedCount: sections.length };
}

// ---------------------------------------------------------------------------
// Drop position inside the composer text

export interface TextareaDropCaret {
    /** Character offset in the textarea value. */
    readonly offset: number;
    /** Caret box relative to the textarea's border box. */
    readonly left: number;
    readonly top: number;
    readonly height: number;
}

const mirroredProperties = ['boxSizing', 'width', 'height', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderStyle', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch',
    'fontSize', 'fontSizeAdjust', 'lineHeight', 'fontFamily', 'fontFeatureSettings', 'textAlign', 'textTransform', 'textIndent',
    'letterSpacing', 'wordSpacing', 'tabSize', 'direction', 'overflowWrap', 'wordBreak'] as const;

/**
 * Character offset and caret box under a pointer inside a textarea. A
 * transparent mirror with identical typography is laid over the textarea for
 * one hit test (textareas expose no caret-from-point API of their own).
 */
export function textareaDropCaret(textarea: HTMLTextAreaElement, clientX: number, clientY: number): TextareaDropCaret | undefined {
    const documentRef = textarea.ownerDocument;
    const caretFromPoint = (documentRef as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint;
    if (typeof caretFromPoint !== 'function') return undefined;
    const rect = textarea.getBoundingClientRect();
    const style = documentRef.defaultView?.getComputedStyle(textarea);
    if (!style || !rect.width || !rect.height) return undefined;
    const mirror = documentRef.createElement('div');
    for (const property of mirroredProperties) (mirror.style as unknown as Record<string, string>)[property] = style[property];
    Object.assign(mirror.style, {
        position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
        margin: '0', overflow: 'hidden', whiteSpace: 'pre-wrap', wordWrap: 'break-word', opacity: '0', zIndex: '2147483647',
        pointerEvents: 'auto', borderColor: 'transparent', background: 'transparent', color: 'transparent'
    });
    const text = documentRef.createTextNode(textarea.value + '​');
    mirror.appendChild(text);
    documentRef.body.appendChild(mirror);
    try {
        mirror.scrollTop = textarea.scrollTop;
        mirror.scrollLeft = textarea.scrollLeft;
        const range = caretFromPoint.call(documentRef, Math.min(Math.max(clientX, rect.left + 1), rect.right - 1), Math.min(Math.max(clientY, rect.top + 1), rect.bottom - 1));
        let offset = textarea.value.length;
        if (range && range.startContainer === text) offset = Math.min(range.startOffset, textarea.value.length);
        else if (range && range.startContainer === mirror) offset = range.startOffset > 0 ? textarea.value.length : 0;
        const caret = documentRef.createRange();
        caret.setStart(text, offset);
        caret.setEnd(text, Math.min(offset + 1, text.length));
        const box = caret.getClientRects()[0] || caret.getBoundingClientRect();
        const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 18;
        return { offset, left: box.left - rect.left, top: box.top - rect.top + Math.max(0, (box.height - lineHeight) / 2), height: lineHeight };
    } finally {
        mirror.remove();
    }
}

/**
 * Shift attachment anchors after the composer text changed from `before` to
 * `after`. The edit is the region between the common prefix and suffix; an
 * anchor inside a replaced region moves to its end.
 */
export function rebaseTextAnchors(anchors: ReadonlyMap<string, number>, before: string, after: string): Map<string, number> {
    const next = new Map<string, number>();
    if (before === after) { for (const [id, offset] of anchors) next.set(id, Math.min(offset, after.length)); return next; }
    let prefix = 0;
    const limit = Math.min(before.length, after.length);
    while (prefix < limit && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1;
    let suffix = 0;
    while (suffix < limit - prefix && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)) suffix += 1;
    const oldEnd = before.length - suffix, newEnd = after.length - suffix;
    for (const [id, offset] of anchors) {
        next.set(id, offset <= prefix ? offset : offset >= oldEnd ? offset + (after.length - before.length) : newEnd);
    }
    return next;
}

/** Text to insert for a dropped folder path, padded so it never fuses with neighbouring words. */
export function folderPathInsertion(value: string, offset: number, path: string): { readonly text: string; readonly caret: number } {
    const quoted = /\s/.test(path) ? `\`${path}\`` : path;
    const before = value.slice(0, offset), after = value.slice(offset);
    const lead = before && !/\s$/.test(before) ? ' ' : '';
    const trail = !after || /^\s/.test(after) ? (after ? '' : ' ') : ' ';
    const text = `${before}${lead}${quoted}${trail}${after}`;
    return { text, caret: before.length + lead.length + quoted.length + trail.length };
}

/**
 * Model-facing marker for an attachment dropped at a text position. The
 * marker is placed in the prompt sent to the model only; the visible message
 * keeps the chip above the text.
 */
export function attachmentAnchorMarker(name: string, kind: 'image' | 'text' | 'file', index: number): string {
    const display = attachmentDisplayName(name).replace(/[\r\n\]]/g, ' ');
    const label = isFolderSnapshotName(name) ? 'Attached folder' : kind === 'image' ? 'Attached image' : 'Attached file';
    return `[${label} ${index}: ${display}]`;
}

/** Insert markers at their anchors (processed right to left so earlier offsets stay valid). */
export function placeAnchorMarkers(value: string, anchored: readonly { readonly offset: number; readonly marker: string }[]): string {
    let result = value;
    // Right to left; for one offset the later drop is inserted first so drop order is kept.
    const ordered = anchored.map((item, index) => ({ ...item, index })).sort((a, b) => b.offset - a.offset || b.index - a.index);
    for (const item of ordered) {
        const offset = Math.max(0, Math.min(result.length, item.offset));
        const before = result.slice(0, offset), after = result.slice(offset);
        result = `${before}${before && !/\s$/.test(before) ? ' ' : ''}${item.marker}${after && !/^\s/.test(after) ? ' ' : ''}${after}`;
    }
    return result;
}

/** Blinking insertion caret shown while a drag hovers over the message text. */
export function TextDropIndicator({ caret, locale }: { readonly caret: TextareaDropCaret; readonly locale: NextMuxDesktopLocale }): React.ReactElement {
    return <div className='nmx-text-drop-indicator' style={{ left: `${Math.round(caret.left)}px`, top: `${Math.round(caret.top)}px`, height: `${Math.round(caret.height)}px` }} aria-hidden='true'>
        <span className='nmx-text-drop-caret'></span>
        <span className='nmx-text-drop-label'><strong>{composerAttachmentUiText(locale, 'dropInsertTitle')}</strong><small>{composerAttachmentUiText(locale, 'dropInsertHint')}</small></span>
    </div>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function composerAttachmentUiText(locale: Parameters<typeof uncheckedComposerAttachmentUiText>[0], key: Parameters<typeof uncheckedComposerAttachmentUiText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedComposerAttachmentUiText>>): string {
    return totalCopy(locale, key, language => uncheckedComposerAttachmentUiText(language, key, ...rest));
}
