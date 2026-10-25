import type { NextMuxDesktopLocale } from './nextmux-locale';

export type DecodedTextPreview =
    | { readonly kind: 'text'; readonly content: string }
    | { readonly kind: 'binary' };

/**
 * The largest text document that the file drawer will materialize in one
 * browser document.  This is deliberately much larger than the old preview
 * cap, while still putting a deterministic upper bound on renderer memory.
 */
export const DEFAULT_TEXT_PREVIEW_MAX_BYTES = 16 * 1024 * 1024;

/** The largest text file the drawer opens in its editor: large files stay editable, pathological ones are refused. */
export const FILE_DRAWER_TEXT_MAX_BYTES = 64 * 1024 * 1024;

/** The largest picture the file drawer decodes (it is shown from memory as a data URL). */
export const IMAGE_PREVIEW_MAX_BYTES = 32 * 1024 * 1024;

export type FilePreviewByteSource = Uint8Array | ArrayBuffer;

export interface TextPreviewOptions {
    readonly maxBytes?: number;
}

export type TextFilePreview = DecodedTextPreview | {
    readonly kind: 'too-large';
    readonly sizeBytes: number;
    readonly maxBytes: number;
};

export type FilePreviewErrorKind = 'missing' | 'binary' | 'unavailable' | 'ambiguous' | 'tooLarge';

/**
 * Guards asynchronous file reads against both a newer request and a
 * conversation switch.  Keeping this tiny predicate outside the widget makes
 * the ownership rule explicit and independently testable.
 */
export function filePreviewRequestIsCurrent(
    currentToken: number,
    requestToken: number,
    currentSessionId: string,
    requestSessionId: string
): boolean {
    return currentToken === requestToken && currentSessionId === requestSessionId;
}

const previewErrors: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<FilePreviewErrorKind, string>>>> = {
    'zh-CN': {
        ambiguous: '多个工作目录中存在同一路径，无法确定要打开的文件。',
        missing: '该文件不存在',
        binary: '此文件不是 UTF-8 文本，无法在侧栏中预览。',
        unavailable: '暂时无法读取此文件。',
        tooLarge: '此文件太大，无法在侧栏中打开；可以用系统应用打开。'
    },
    'zh-TW': {
        ambiguous: '多個工作目錄中存在相同路徑，無法確定要開啟的檔案。',
        missing: '檔案已不存在或已被移動。',
        binary: '此檔案不是 UTF-8 文字，無法在側欄中預覽。',
        unavailable: '暫時無法讀取此檔案。',
        tooLarge: '此檔案太大，無法在側欄中開啟；可以用系統應用程式開啟。'
    },
    en: {
        ambiguous: 'This path exists in multiple working directories. The file to open cannot be determined.',
        missing: 'This file no longer exists or has been moved.',
        binary: 'This file is not UTF-8 text and cannot be previewed here.',
        unavailable: 'This file could not be read right now.',
        tooLarge: 'This file is too large to open here; open it with a system app instead.'
    },
    ja: {
        ambiguous: '複数の作業ディレクトリに同じパスがあるため、開くファイルを特定できません。',
        missing: 'このファイルは存在しないか、移動されています。',
        binary: 'このファイルは UTF-8 テキストではないため、ここではプレビューできません。',
        unavailable: '現在このファイルを読み取れません。',
        tooLarge: 'このファイルは大きすぎるため、ここでは開けません。システムのアプリで開いてください。'
    },
    ko: {
        ambiguous: '여러 작업 디렉터리에 같은 경로가 있어 열 파일을 확인할 수 없습니다.',
        missing: '이 파일이 더 이상 없거나 이동되었습니다.',
        binary: '이 파일은 UTF-8 텍스트가 아니므로 여기에서 미리 볼 수 없습니다.',
        unavailable: '지금 이 파일을 읽을 수 없습니다.',
        tooLarge: '이 파일은 너무 커서 여기서 열 수 없습니다. 시스템 앱으로 여세요.'
    },
    es: {
        ambiguous: 'Esta ruta existe en varios directorios de trabajo. No se puede determinar qué archivo abrir.',
        missing: 'Este archivo ya no existe o se ha movido.',
        binary: 'Este archivo no es texto UTF-8 y no se puede previsualizar aquí.',
        unavailable: 'No se pudo leer este archivo ahora.',
        tooLarge: 'Este archivo es demasiado grande para abrirlo aquí; ábrelo con una app del sistema.'
    },
    fr: {
        ambiguous: 'Ce chemin existe dans plusieurs répertoires de travail. Impossible de déterminer le fichier à ouvrir.',
        missing: 'Ce fichier n’existe plus ou a été déplacé.',
        binary: 'Ce fichier n’est pas du texte UTF-8 et ne peut pas être prévisualisé ici.',
        unavailable: 'Impossible de lire ce fichier pour le moment.',
        tooLarge: 'Ce fichier est trop volumineux pour être ouvert ici ; ouvrez-le avec une app du système.'
    },
    de: {
        ambiguous: 'Dieser Pfad existiert in mehreren Arbeitsverzeichnissen. Die zu öffnende Datei ist nicht eindeutig.',
        missing: 'Diese Datei ist nicht mehr vorhanden oder wurde verschoben.',
        binary: 'Diese Datei ist kein UTF-8-Text und kann hier nicht angezeigt werden.',
        unavailable: 'Diese Datei kann derzeit nicht gelesen werden.',
        tooLarge: 'Diese Datei ist zu groß, um sie hier zu öffnen; öffne sie mit einer System-App.'
    },
    'pt-BR': {
        ambiguous: 'Este caminho existe em vários diretórios de trabalho. Não é possível determinar qual arquivo abrir.',
        missing: 'Este arquivo não existe mais ou foi movido.',
        binary: 'Este arquivo não é texto UTF-8 e não pode ser visualizado aqui.',
        unavailable: 'Não foi possível ler este arquivo agora.',
        tooLarge: 'Este arquivo é grande demais para abrir aqui; abra-o com um app do sistema.'
    },
    ru: {
        ambiguous: 'Этот путь существует в нескольких рабочих каталогах. Невозможно определить, какой файл открыть.',
        missing: 'Этот файл больше не существует или был перемещён.',
        binary: 'Этот файл не является текстом UTF-8 и не может быть показан здесь.',
        unavailable: 'Сейчас не удалось прочитать этот файл.',
        tooLarge: 'Файл слишком большой, чтобы открыть его здесь; откройте его в системном приложении.'
    },
    ar: {
        ambiguous: 'يوجد هذا المسار في عدة مجلدات عمل. لا يمكن تحديد الملف المراد فتحه.',
        missing: 'لم يعد هذا الملف موجودًا أو تم نقله.',
        binary: 'هذا الملف ليس نصًا بترميز UTF-8 ولا يمكن معاينته هنا.',
        unavailable: 'تعذرت قراءة هذا الملف الآن.',
        tooLarge: 'هذا الملف أكبر من أن يُفتح هنا؛ افتحه بتطبيق من النظام.'
    },
    hi: {
        ambiguous: 'यह पथ कई कार्य निर्देशिकाओं में मौजूद है। यह तय नहीं किया जा सकता कि कौन सी फ़ाइल खोलनी है।',
        missing: 'यह फ़ाइल अब मौजूद नहीं है या स्थानांतरित कर दी गई है।',
        binary: 'यह फ़ाइल UTF-8 टेक्स्ट नहीं है और इसका यहाँ पूर्वावलोकन नहीं किया जा सकता।',
        unavailable: 'इस फ़ाइल को अभी पढ़ा नहीं जा सका।',
        tooLarge: 'यह फ़ाइल यहाँ खोलने के लिए बहुत बड़ी है; इसे किसी सिस्टम ऐप से खोलें।'
    }
};

const KNOWN_BINARY_NAMES = new Set(['thumbs.db', 'desktop.ini']);
const KNOWN_BINARY_EXTENSIONS = new Set([
    '7z', 'avif', 'bmp', 'bz2', 'class', 'dll', 'dylib', 'eot', 'exe', 'flac', 'gif', 'gz',
    'heic', 'ico', 'jar', 'jpeg', 'jpg', 'm4a', 'mkv', 'mov', 'mp3', 'mp4', 'ogg', 'otf',
    'pdf', 'png', 'rar', 'so', 'tar', 'ttf', 'wav', 'webm', 'webp', 'woff', 'woff2', 'xz', 'zip'
]);

/**
 * File names are only a routing hint.  The bytes remain authoritative, so an
 * unknown extension is still attempted as text unless it is a well-known
 * binary/media format.  This lets extensionless files and project-specific
 * source files use the same drawer editor as .txt/.md/.json/.yaml/.log.
 */
export function isTextPreviewCandidate(fileName: string): boolean {
    const normalized = fileName.trim().replace(/\\/g, '/');
    const baseName = normalized.slice(normalized.lastIndexOf('/') + 1).toLocaleLowerCase();
    if (!baseName) return false;

    if (KNOWN_BINARY_NAMES.has(baseName)) return false;

    const dot = baseName.lastIndexOf('.');
    const extension = dot >= 0 ? baseName.slice(dot + 1) : '';

    // A dotfile such as .env or .gitignore is extensionless.  A hidden media
    // file such as .png is still excluded when its suffix is known binary.
    if (dot === 0 && baseName.indexOf('.', 1) < 0) return !KNOWN_BINARY_EXTENSIONS.has(baseName.slice(1));
    if (dot <= 0 || dot === baseName.length - 1) return true;
    return !KNOWN_BINARY_EXTENSIONS.has(extension);
}

function asPreviewBytes(bytes: FilePreviewByteSource): Uint8Array {
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function previewMaxBytes(options?: TextPreviewOptions): number {
    const maxBytes = options?.maxBytes ?? DEFAULT_TEXT_PREVIEW_MAX_BYTES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
        throw new RangeError('maxBytes must be a positive safe integer');
    }
    return maxBytes;
}

function isAllowedTextControl(code: number): boolean {
    // CR/LF/TAB are ordinary text; FF/BS occur in generated logs and ESC is
    // used by ANSI-coloured terminal logs.  NUL and the remaining controls are
    // intentionally treated as binary indicators.
    return code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c
        || code === 0x0d || code === 0x1b;
}

export function decodeUtf8TextPreview(bytes: FilePreviewByteSource): DecodedTextPreview {
    const source = asPreviewBytes(bytes);
    if (source.includes(0)) return { kind: 'binary' };
    try {
        const content = new TextDecoder('utf-8', { fatal: true }).decode(source);
        let disallowedControls = 0;
        for (let index = 0; index < content.length; index += 1) {
            const code = content.charCodeAt(index);
            if ((code < 0x20 && !isAllowedTextControl(code)) || code === 0x7f) disallowedControls += 1;
        }
        // A small amount of unusual control formatting is valid in logs.  A
        // high absolute count or density still protects the editor from
        // accepting arbitrary binary data that happens to decode as UTF-8.
        if (disallowedControls > 16 || disallowedControls / Math.max(1, content.length) > .02) {
            return { kind: 'binary' };
        }
        return { kind: 'text', content };
    } catch {
        return { kind: 'binary' };
    }
}

/**
 * Applies the drawer's bounded-read policy before decoding.  The size check
 * happens first so an oversized or malformed payload cannot force a full
 * decode; files within the limit are returned unchanged for the existing
 * right-side file editor.
 */
export function prepareTextFilePreview(
    bytes: FilePreviewByteSource,
    options?: TextPreviewOptions
): TextFilePreview {
    const source = asPreviewBytes(bytes);
    const maxBytes = previewMaxBytes(options);
    if (source.byteLength > maxBytes) {
        return { kind: 'too-large', sizeBytes: source.byteLength, maxBytes };
    }
    return decodeUtf8TextPreview(source);
}

export function filePreviewErrorText(locale: NextMuxDesktopLocale, kind: FilePreviewErrorKind): string {
    return previewErrors[locale][kind];
}
