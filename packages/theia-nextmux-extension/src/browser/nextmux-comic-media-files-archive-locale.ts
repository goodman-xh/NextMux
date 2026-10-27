import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

const keys = ['name', 'summary', 'description', 'chooseExport', 'chooseImport', 'exportButton',
    'importButton', 'exportSuccess', 'importSuccess', 'exportFailed', 'importFailed'] as const;
export type ComicMediaFilesArchiveTextKey = typeof keys[number];

const values: Readonly<Record<NextMuxDesktopLocale, readonly string[]>> = {
    'zh-CN': ['漫剧素材与成片文件', '当前项目 nextmux.media 内的实际文件',
        ' · 含导入和生成素材、成片及字幕；不含工程文件、外部另存副本或任务记录。恢复需同一未变更工程且媒体目录为空',
        '选择媒体文件备份的保存文件夹', '选择 .nmxcomicmedia 媒体文件备份文件夹',
        '备份媒体文件', '恢复媒体文件', '已备份 {count} 个实际媒体文件（{size}）。',
        '已恢复 {count} 个实际媒体文件（{size}）。', '媒体文件备份失败', '媒体文件恢复失败'],
    'zh-TW': ['漫劇素材與成片檔案', '目前專案 nextmux.media 內的實際檔案',
        ' · 包含匯入與生成素材、成片及字幕；不含工程檔、外部另存副本或任務紀錄。復原須在相同且未變更的工程中，且媒體目錄為空',
        '選擇媒體檔案備份的儲存資料夾', '選擇 .nmxcomicmedia 媒體檔案備份資料夾',
        '備份媒體檔案', '復原媒體檔案', '已備份 {count} 個實際媒體檔案（{size}）。',
        '已復原 {count} 個實際媒體檔案（{size}）。', '媒體檔案備份失敗', '媒體檔案復原失敗'],
    en: ['Comic media and film files', 'Actual files in this project’s nextmux.media folder',
        ' · Includes imported and generated assets, films, and subtitles; excludes the project file, externally saved copies, and task records. Restore requires the same unchanged project and an empty media folder',
        'Choose a folder for the media-file backup', 'Choose a .nmxcomicmedia media-file backup folder',
        'Back up media files', 'Restore media files', 'Backed up {count} actual media files ({size}).',
        'Restored {count} actual media files ({size}).', 'Could not back up media files', 'Could not restore media files'],
    ja: ['漫画動画の素材と完成ファイル', 'このプロジェクトの nextmux.media にある実ファイル',
        ' · 取り込み・生成素材、完成動画、字幕を含みます。プロジェクトファイル、外部保存したコピー、タスク記録は含みません。同一の未変更プロジェクトと空のメディアフォルダーが必要です',
        'メディアファイルのバックアップ先を選択', '.nmxcomicmedia バックアップフォルダーを選択',
        'メディアをバックアップ', 'メディアを復元', '実ファイル {count} 件をバックアップしました（{size}）。',
        '実ファイル {count} 件を復元しました（{size}）。', 'メディアのバックアップに失敗しました', 'メディアの復元に失敗しました'],
    ko: ['만화 영상 소스 및 완성 파일', '이 프로젝트의 nextmux.media 실제 파일',
        ' · 가져오거나 생성한 소스, 완성 영상, 자막을 포함합니다. 프로젝트 파일, 외부 저장본, 작업 기록은 제외합니다. 동일한 변경되지 않은 프로젝트와 빈 미디어 폴더가 필요합니다',
        '미디어 파일 백업 폴더 선택', '.nmxcomicmedia 백업 폴더 선택',
        '미디어 파일 백업', '미디어 파일 복원', '실제 미디어 파일 {count}개를 백업했습니다({size}).',
        '실제 미디어 파일 {count}개를 복원했습니다({size}).', '미디어 파일을 백업하지 못했습니다', '미디어 파일을 복원하지 못했습니다'],
    es: ['Recursos y películas del cómic', 'Archivos reales de nextmux.media en este proyecto',
        ' · Incluye recursos importados y generados, películas y subtítulos; excluye el proyecto, las copias guardadas fuera y los registros de tareas. La restauración requiere el mismo proyecto sin cambios y una carpeta de medios vacía',
        'Elegir carpeta para la copia de archivos multimedia', 'Elegir carpeta .nmxcomicmedia',
        'Guardar archivos multimedia', 'Restaurar archivos multimedia', 'Se guardaron {count} archivos multimedia reales ({size}).',
        'Se restauraron {count} archivos multimedia reales ({size}).', 'No se pudieron guardar los archivos', 'No se pudieron restaurar los archivos'],
    fr: ['Médias et films de la BD', 'Fichiers réels de nextmux.media dans ce projet',
        ' · Inclut les médias importés ou générés, les films et les sous-titres ; exclut le fichier de projet, les copies externes et les tâches. La restauration exige le même projet inchangé et un dossier média vide',
        'Choisir le dossier de sauvegarde des médias', 'Choisir un dossier .nmxcomicmedia',
        'Sauvegarder les médias', 'Restaurer les médias', '{count} fichiers média réels sauvegardés ({size}).',
        '{count} fichiers média réels restaurés ({size}).', 'Échec de la sauvegarde des médias', 'Échec de la restauration des médias'],
    de: ['Comic-Medien und Filmdateien', 'Echte Dateien im Ordner nextmux.media dieses Projekts',
        ' · Enthält importierte und erzeugte Medien, Filme und Untertitel; keine Projektdatei, extern gespeicherten Kopien oder Auftragsdaten. Für die Wiederherstellung sind dasselbe unveränderte Projekt und ein leerer Medienordner nötig',
        'Ordner für die Mediensicherung wählen', '.nmxcomicmedia-Sicherungsordner wählen',
        'Mediendateien sichern', 'Mediendateien wiederherstellen', '{count} echte Mediendateien gesichert ({size}).',
        '{count} echte Mediendateien wiederhergestellt ({size}).', 'Mediensicherung fehlgeschlagen', 'Medienwiederherstellung fehlgeschlagen'],
    'pt-BR': ['Mídias e filmes do quadrinho', 'Arquivos reais em nextmux.media deste projeto',
        ' · Inclui mídias importadas e geradas, filmes e legendas; exclui o arquivo do projeto, cópias externas e registros de tarefas. A restauração exige o mesmo projeto sem alterações e uma pasta de mídia vazia',
        'Escolher pasta para backup de mídia', 'Escolher pasta .nmxcomicmedia',
        'Fazer backup da mídia', 'Restaurar mídia', '{count} arquivos de mídia reais salvos ({size}).',
        '{count} arquivos de mídia reais restaurados ({size}).', 'Falha no backup da mídia', 'Falha na restauração da mídia'],
    ru: ['Материалы и фильмы комикса', 'Настоящие файлы в nextmux.media этого проекта',
        ' · Включает импортированные и созданные материалы, фильмы и субтитры; не включает файл проекта, внешние копии и записи задач. Для восстановления нужны тот же неизменённый проект и пустая папка медиа',
        'Выберите папку для копии медиафайлов', 'Выберите папку .nmxcomicmedia',
        'Сохранить медиафайлы', 'Восстановить медиафайлы', 'Сохранено реальных медиафайлов: {count} ({size}).',
        'Восстановлено реальных медиафайлов: {count} ({size}).', 'Не удалось сохранить медиафайлы', 'Не удалось восстановить медиафайлы'],
    ar: ['وسائط القصص المصورة وملفات الفيلم', 'الملفات الفعلية في nextmux.media لهذا المشروع',
        ' · تشمل المواد المستوردة والمُنشأة والأفلام والترجمات؛ ولا تشمل ملف المشروع أو النسخ الخارجية أو سجلات المهام. تتطلب الاستعادة المشروع نفسه دون تغيير ومجلد وسائط فارغًا',
        'اختر مجلد نسخة ملفات الوسائط', 'اختر مجلد النسخة ‎.nmxcomicmedia',
        'نسخ ملفات الوسائط', 'استعادة ملفات الوسائط', 'نُسخ {count} من ملفات الوسائط الفعلية ({size}).',
        'استُعيد {count} من ملفات الوسائط الفعلية ({size}).', 'تعذر نسخ ملفات الوسائط', 'تعذرت استعادة ملفات الوسائط'],
    hi: ['कॉमिक मीडिया और फ़िल्म फ़ाइलें', 'इस प्रोजेक्ट के nextmux.media में वास्तविक फ़ाइलें',
        ' · आयातित और बनाई गई सामग्री, फ़िल्में और उपशीर्षक शामिल हैं; प्रोजेक्ट फ़ाइल, बाहरी प्रतियाँ और कार्य रिकॉर्ड शामिल नहीं हैं। पुनर्स्थापना के लिए वही अपरिवर्तित प्रोजेक्ट और खाली मीडिया फ़ोल्डर चाहिए',
        'मीडिया फ़ाइल बैकअप फ़ोल्डर चुनें', '.nmxcomicmedia बैकअप फ़ोल्डर चुनें',
        'मीडिया फ़ाइलों का बैकअप', 'मीडिया फ़ाइलें पुनर्स्थापित करें', '{count} वास्तविक मीडिया फ़ाइलों का बैकअप लिया गया ({size})।',
        '{count} वास्तविक मीडिया फ़ाइलें पुनर्स्थापित हुईं ({size})।', 'मीडिया बैकअप विफल रहा', 'मीडिया पुनर्स्थापना विफल रही']
};

function uncheckedComicMediaFilesArchiveText(locale: NextMuxDesktopLocale, key: ComicMediaFilesArchiveTextKey): string {
    const index = keys.indexOf(key);
    return values[locale][index] || values.en[index];
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function comicMediaFilesArchiveText(locale: Parameters<typeof uncheckedComicMediaFilesArchiveText>[0], key: Parameters<typeof uncheckedComicMediaFilesArchiveText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedComicMediaFilesArchiveText>>): string {
    return totalCopy(locale, key, language => uncheckedComicMediaFilesArchiveText(language, key, ...rest));
}
