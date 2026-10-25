import type { NextMuxDesktopLocale } from './nextmux-locale';
import { totalCopy } from './nextmux-copy-fallback';

const keys = ['title', 'detail', 'overwrite', 'rename'] as const;
const copy: Record<NextMuxDesktopLocale, readonly string[]> = {
    'zh-CN': ['存在同名文件', '覆盖会替换下列文件；也可以修改文件名称后重新导出。', '覆盖并导出', '重命名'],
    'zh-TW': ['已有同名檔案', '覆寫會取代下列檔案；也可以修改檔案名稱後重新匯出。', '覆寫並匯出', '重新命名'],
    en: ['Files already exist', 'Overwrite replaces the files below. You can also change the file name and export again.', 'Overwrite and export', 'Rename'],
    ja: ['同名のファイルがあります', '上書きすると以下のファイルが置き換わります。名前を変更して再度書き出すこともできます。', '上書きして書き出す', '名前を変更'],
    ko: ['같은 이름의 파일이 있습니다', '덮어쓰면 아래 파일이 교체됩니다. 파일 이름을 변경한 후 다시 내보낼 수도 있습니다.', '덮어쓰고 내보내기', '이름 변경'],
    es: ['Ya existen archivos con ese nombre', 'Sobrescribir reemplaza los archivos siguientes. También puedes cambiar el nombre y volver a exportar.', 'Sobrescribir y exportar', 'Cambiar nombre'],
    fr: ['Des fichiers existent déjà', 'Écraser remplace les fichiers ci-dessous. Vous pouvez aussi modifier le nom et relancer l’export.', 'Écraser et exporter', 'Renommer'],
    de: ['Dateien sind bereits vorhanden', 'Beim Überschreiben werden die folgenden Dateien ersetzt. Du kannst auch den Namen ändern und erneut exportieren.', 'Überschreiben und exportieren', 'Umbenennen'],
    'pt-BR': ['Já existem arquivos com esse nome', 'Sobrescrever substitui os arquivos abaixo. Você também pode mudar o nome e exportar novamente.', 'Sobrescrever e exportar', 'Renomear'],
    ru: ['Файлы уже существуют', 'Перезапись заменит указанные ниже файлы. Можно также изменить имя и повторить экспорт.', 'Перезаписать и экспортировать', 'Переименовать'],
    ar: ['توجد ملفات بالاسم نفسه', 'ستستبدل الكتابة فوق الملفات أدناه. يمكنك أيضًا تغيير الاسم ثم التصدير مجددًا.', 'استبدال وتصدير', 'إعادة التسمية'],
    hi: ['इसी नाम की फ़ाइलें मौजूद हैं', 'ओवरराइट करने से नीचे दी गई फ़ाइलें बदल जाएँगी। आप नाम बदलकर फिर से निर्यात भी कर सकते हैं।', 'ओवरराइट करके निर्यात करें', 'नाम बदलें']
};

export function comicExportConflictText(locale: NextMuxDesktopLocale, key: typeof keys[number]): string {
    return totalCopy(locale, key, language => copy[language]?.[keys.indexOf(key)]);
}
