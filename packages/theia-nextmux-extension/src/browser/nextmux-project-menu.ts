import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';
export const HIDDEN_PROJECTS_STORAGE_KEY = 'nextmux.desktop.hiddenProjects.v1';

export function readHiddenProjects(raw: string | null): Set<string> {
    try {
        const values: unknown = JSON.parse(raw || '[]');
        // This is only a bounded UI preference list for hidden project paths;
        // it is unrelated to conversation history capacity (which is indexed
        // locally and has no 5,000-session cap).
        return new Set(Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string'
            && value.length > 0 && value.length <= 4096 && !value.includes('\0')).slice(0, 5000) : []);
    } catch { return new Set(); }
}

const english = {
    delete: 'Delete', title: 'Remove project?',
    hint: 'Hide from the list. Conversations and files are kept.',
    erase: 'Permanently delete all conversations in this project',
    warning: 'Conversations cannot be recovered. Project files are not deleted.',
    busy: 'Stop this project’s running tasks before deleting its conversations.',
    failed: 'The project could not be removed. Please retry.', cancel: 'Cancel', saving: 'Saving…'
};
type ProjectMenuKey = keyof typeof english;
const translations: Readonly<Record<string, typeof english>> = {
    'zh-CN': { delete: '删除', title: '移除项目？', hint: '仅从列表隐藏，保留对话和文件。', erase: '永久删除此项目下的所有对话', warning: '对话无法恢复；不会删除磁盘中的项目文件。', busy: '请先停止此项目中正在运行的任务，再删除对话。', failed: '未能移除项目，请重试。', cancel: '取消', saving: '保存中…' },
    'zh-TW': { delete: '刪除', title: '移除專案？', hint: '僅從列表隱藏，保留對話和檔案。', erase: '永久刪除此專案下的所有對話', warning: '對話無法復原；不會刪除磁碟中的專案檔案。', busy: '請先停止此專案中正在執行的任務，再刪除對話。', failed: '未能移除專案，請重試。', cancel: '取消', saving: '儲存中…' },
    ja: { delete: '削除', title: 'プロジェクトを非表示にしますか？', hint: '一覧から非表示にします。会話とファイルは保持されます。', erase: 'このプロジェクトのすべての会話を完全に削除する', warning: '会話は復元できません。プロジェクトのファイルは削除されません。', busy: '会話を削除する前に、このプロジェクトの実行中のタスクを停止してください。', failed: 'プロジェクトを非表示にできませんでした。再試行してください。', cancel: 'キャンセル', saving: '保存中…' },
    ko: { delete: '삭제', title: '프로젝트를 숨길까요?', hint: '목록에서만 숨깁니다. 대화와 파일은 보존됩니다.', erase: '이 프로젝트의 모든 대화를 영구 삭제', warning: '대화는 복구할 수 없습니다. 프로젝트 파일은 삭제되지 않습니다.', busy: '대화를 삭제하기 전에 이 프로젝트에서 실행 중인 작업을 중지하세요.', failed: '프로젝트를 숨기지 못했습니다. 다시 시도하세요.', cancel: '취소', saving: '저장 중…' },
    de: { delete: 'Löschen', title: 'Projekt entfernen?', hint: 'Aus der Liste ausblenden. Gespräche und Dateien bleiben erhalten.', erase: 'Alle Gespräche dieses Projekts endgültig löschen', warning: 'Gespräche können nicht wiederhergestellt werden. Projektdateien bleiben erhalten.', busy: 'Beenden Sie zuerst die laufenden Aufgaben dieses Projekts.', failed: 'Das Projekt konnte nicht entfernt werden. Bitte erneut versuchen.', cancel: 'Abbrechen', saving: 'Speichern…' },
    fr: { delete: 'Supprimer', title: 'Retirer le projet ?', hint: 'Masquer dans la liste. Les conversations et fichiers sont conservés.', erase: 'Supprimer définitivement toutes les conversations de ce projet', warning: 'Les conversations seront irrécupérables. Les fichiers du projet sont conservés.', busy: 'Arrêtez les tâches en cours de ce projet avant de supprimer ses conversations.', failed: 'Impossible de retirer le projet. Réessayez.', cancel: 'Annuler', saving: 'Enregistrement…' },
    es: { delete: 'Eliminar', title: '¿Quitar el proyecto?', hint: 'Ocultar de la lista. Se conservan las conversaciones y los archivos.', erase: 'Eliminar permanentemente todas las conversaciones de este proyecto', warning: 'Las conversaciones no se pueden recuperar. Los archivos no se eliminan.', busy: 'Detén las tareas en curso de este proyecto antes de eliminar sus conversaciones.', failed: 'No se pudo quitar el proyecto. Inténtalo de nuevo.', cancel: 'Cancelar', saving: 'Guardando…' },
    it: { delete: 'Elimina', title: 'Rimuovere il progetto?', hint: 'Nascondi dall’elenco. Conversazioni e file vengono conservati.', erase: 'Elimina definitivamente tutte le conversazioni del progetto', warning: 'Le conversazioni non saranno recuperabili. I file del progetto non verranno eliminati.', busy: 'Interrompi le attività in corso del progetto prima di eliminarne le conversazioni.', failed: 'Impossibile rimuovere il progetto. Riprova.', cancel: 'Annulla', saving: 'Salvataggio…' },
    pt: { delete: 'Excluir', title: 'Remover projeto?', hint: 'Ocultar da lista. As conversas e os arquivos são mantidos.', erase: 'Excluir permanentemente todas as conversas deste projeto', warning: 'As conversas não poderão ser recuperadas. Os arquivos do projeto não são excluídos.', busy: 'Pare as tarefas em execução deste projeto antes de excluir suas conversas.', failed: 'Não foi possível remover o projeto. Tente novamente.', cancel: 'Cancelar', saving: 'Salvando…' },
    ru: { delete: 'Удалить', title: 'Убрать проект?', hint: 'Скрыть из списка. Диалоги и файлы сохранятся.', erase: 'Навсегда удалить все диалоги этого проекта', warning: 'Диалоги нельзя будет восстановить. Файлы проекта не удаляются.', busy: 'Остановите выполняющиеся задачи этого проекта перед удалением диалогов.', failed: 'Не удалось убрать проект. Повторите попытку.', cancel: 'Отмена', saving: 'Сохранение…' },
    ar: { delete: 'حذف', title: 'إزالة المشروع؟', hint: 'إخفاء من القائمة مع الاحتفاظ بالمحادثات والملفات.', erase: 'حذف جميع محادثات هذا المشروع نهائيًا', warning: 'لا يمكن استعادة المحادثات. لن تُحذف ملفات المشروع.', busy: 'أوقف مهام هذا المشروع الجارية قبل حذف محادثاته.', failed: 'تعذرت إزالة المشروع. حاول مجددًا.', cancel: 'إلغاء', saving: 'جارٍ الحفظ…' },
    hi: { delete: 'हटाएँ', title: 'प्रोजेक्ट हटाएँ?', hint: 'सूची से छिपाएँ। बातचीत और फ़ाइलें बनी रहेंगी।', erase: 'इस प्रोजेक्ट की सभी बातचीत हमेशा के लिए मिटाएँ', warning: 'बातचीत वापस नहीं मिलेगी। प्रोजेक्ट की फ़ाइलें नहीं मिटेंगी।', busy: 'बातचीत मिटाने से पहले इस प्रोजेक्ट के चल रहे कार्य रोकें।', failed: 'प्रोजेक्ट नहीं हटाया जा सका। फिर से कोशिश करें।', cancel: 'रद्द करें', saving: 'सहेजा जा रहा है…' }
};

function uncheckedProjectMenuText(locale: string, key: ProjectMenuKey): string {
    return (translations[locale] || translations[locale.split('-')[0]] || english)[key];
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function projectMenuText(locale: Parameters<typeof uncheckedProjectMenuText>[0], key: Parameters<typeof uncheckedProjectMenuText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedProjectMenuText>>): string {
    return totalCopy(locale, key, language => uncheckedProjectMenuText(language, key, ...rest));
}
