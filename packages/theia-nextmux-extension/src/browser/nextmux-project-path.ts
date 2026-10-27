import type { NextMuxDesktopLocale } from './nextmux-locale';

/** "Open the project folder" in each desktop language: Finder on macOS, File Explorer on Windows. */
const openCopy: Record<NextMuxDesktopLocale, readonly [mac: string, windows: string]> = {
    'zh-CN': ['在访达中打开项目文件夹', '在文件资源管理器中打开项目文件夹'],
    'zh-TW': ['在 Finder 中打開專案資料夾', '在檔案總管中打開專案資料夾'],
    en: ['Open the project folder in Finder', 'Open the project folder in File Explorer'],
    ja: ['Finder でプロジェクトフォルダを開く', 'エクスプローラーでプロジェクトフォルダを開く'],
    ko: ['Finder에서 프로젝트 폴더 열기', '파일 탐색기에서 프로젝트 폴더 열기'],
    es: ['Abrir la carpeta del proyecto en Finder', 'Abrir la carpeta del proyecto en el Explorador de archivos'],
    fr: ['Ouvrir le dossier du projet dans le Finder', 'Ouvrir le dossier du projet dans l’Explorateur de fichiers'],
    de: ['Projektordner im Finder öffnen', 'Projektordner im Datei-Explorer öffnen'],
    'pt-BR': ['Abrir a pasta do projeto no Finder', 'Abrir a pasta do projeto no Explorador de Arquivos'],
    ru: ['Открыть папку проекта в Finder', 'Открыть папку проекта в Проводнике'],
    ar: ['فتح مجلد المشروع في Finder', 'فتح مجلد المشروع في مستكشف الملفات'],
    hi: ['Finder में प्रोजेक्ट फ़ोल्डर खोलें', 'फ़ाइल एक्सप्लोरर में प्रोजेक्ट फ़ोल्डर खोलें']
};

export function projectFolderOpenText(locale: NextMuxDesktopLocale, platform: string): string {
    const copy = openCopy[locale] || openCopy.en;
    return /^win/i.test(platform) ? copy[1] : copy[0];
}

/**
 * The project path as the composer shows it: the home folder as "~" and, for a deep path, only its last two
 * folders ("~/…/nm/33"), so the row stays short; the full path is in the tooltip.
 */
export function projectPathLabel(path: string): string {
    const windows = /^[A-Za-z]:[\\/]/.test(path) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+/.test(path) || path.includes('\\');
    const separator = windows ? '\\' : '/';
    const normalized = windows ? path.replace(/\//g, '\\') : path;
    // Keep the root separator: C:\\ is a drive root, whereas C: is relative to that drive's current directory.
    const trimmed = /^[A-Za-z]:\\+$/.test(normalized) ? `${normalized.slice(0, 2)}\\`
        : normalized.replace(/[\\/]+$/, '') || normalized;
    const home = windows ? /^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/i : /^\/(?:Users|home)\/[^/]+(?=\/|$)/;
    const relative = trimmed.replace(home, '~');
    // UNC authority and share name belong to the root and must survive shortening.
    const head = relative.startsWith('~') ? '~' : windows
        ? /^\\\\[^\\]+\\[^\\]+/.exec(relative)?.[0] || /^[A-Za-z]:/.exec(relative)?.[0] || (relative.startsWith('\\') ? '\\' : '')
        : relative.startsWith('/') ? '/' : '';
    const tail = relative.slice(head.length).split(/[\\/]/).filter(Boolean);
    if (tail.length <= 3) return relative || separator;
    const shortened = ['…', ...tail.slice(-2)].join(separator);
    return head ? `${head}${head.endsWith(separator) ? '' : separator}${shortened}` : shortened;
}
