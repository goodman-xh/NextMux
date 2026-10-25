/** Temporary conversation copy, independent of model/provider privacy promises. */
const copy: Readonly<Record<string, readonly [string, string, string, string]>> = {
    'zh-CN': ['无痕对话', '无痕对话：退出应用后自动删除本次对话及其临时工作区文件。主动另存的文件会保留。', '保存本机对话记录', '普通对话始终保存在本机。需要临时对话时，请使用无痕对话。'],
    'zh-TW': ['無痕對話', '無痕對話：結束應用程式後，自動刪除本次對話及其暫存工作區檔案。主動另存的檔案會保留。', '儲存本機對話記錄', '一般對話一律儲存在本機。需要臨時對話時，請使用無痕對話。'],
    en: ['Incognito', 'Incognito conversation: this conversation and files in its temporary workspace are deleted when you quit the app. Files you explicitly save elsewhere are kept.', 'Save local conversation history', 'Regular conversations are always saved locally. Use an incognito conversation for temporary work.'],
    ja: ['シークレット', 'シークレット会話：アプリ終了時にこの会話と一時作業領域のファイルを削除します。別の場所に保存したファイルは残ります。', '会話履歴をローカルに保存', '通常の会話は常にローカルに保存します。一時的な作業にはシークレット会話を使ってください。'],
    ko: ['시크릿 대화', '시크릿 대화: 앱을 종료하면 이 대화와 임시 작업 공간의 파일이 삭제됩니다. 다른 위치에 직접 저장한 파일은 유지됩니다.', '로컬 대화 기록 저장', '일반 대화는 항상 로컬에 저장됩니다. 임시 작업에는 시크릿 대화를 사용하세요.'],
    es: ['Conversación privada', 'Al salir de la aplicación se borran esta conversación y los archivos de su espacio de trabajo temporal. Los archivos guardados expresamente en otra ubicación se conservan.', 'Guardar historial local', 'Las conversaciones normales siempre se guardan localmente. Usa una conversación privada para trabajar de forma temporal.'],
    fr: ['Conversation privée', 'À la fermeture de l’application, cette conversation et les fichiers de son espace de travail temporaire sont supprimés. Les fichiers enregistrés volontairement ailleurs sont conservés.', 'Enregistrer l’historique local', 'Les conversations normales sont toujours enregistrées localement. Utilisez une conversation privée pour un travail temporaire.'],
    de: ['Inkognito', 'Beim Beenden der App werden diese Unterhaltung und die Dateien ihres temporären Arbeitsbereichs gelöscht. Bewusst an anderer Stelle gespeicherte Dateien bleiben erhalten.', 'Lokalen Verlauf speichern', 'Normale Unterhaltungen werden immer lokal gespeichert. Nutzen Sie Inkognito für vorübergehende Aufgaben.'],
    'pt-BR': ['Conversa privada', 'Ao sair da aplicação, esta conversa e os arquivos de seu espaço de trabalho temporário são apagados. Arquivos salvos explicitamente em outro local são mantidos.', 'Salvar histórico local', 'As conversas normais são sempre salvas localmente. Use uma conversa privada para trabalhos temporários.'],
    ru: ['Инкогнито', 'При выходе из приложения этот разговор и файлы его временной рабочей области удаляются. Файлы, явно сохранённые в другом месте, остаются.', 'Сохранять историю локально', 'Обычные разговоры всегда сохраняются локально. Для временной работы используйте инкогнито.'],
    ar: ['محادثة خفية', 'عند الخروج من التطبيق تُحذف هذه المحادثة وملفاتها المحلية المؤقتة. تُحتفظ بالملفات التي تحفظها صراحةً في مكان آخر.', 'حفظ سجل المحادثات محليًا', 'تُحفظ المحادثات العادية دائمًا محليًا. استخدم محادثة خفية للعمل المؤقت.'],
    hi: ['गुप्त बातचीत', 'ऐप बंद करने पर यह बातचीत और इसकी स्थानीय अस्थायी फ़ाइलें हट जाती हैं। दूसरी जगह जानबूझकर सहेजी गई फ़ाइलें बनी रहती हैं।', 'स्थानीय बातचीत इतिहास सहेजें', 'सामान्य बातचीत हमेशा स्थानीय रूप से सहेजी जाती है। अस्थायी काम के लिए गुप्त बातचीत का उपयोग करें।']
};
const unavailable: Readonly<Record<string, string>> = {
    'zh-CN': '无痕工作区尚未就绪，请重启应用后重试。', 'zh-TW': '無痕工作區尚未就緒，請重新啟動應用程式後重試。',
    en: 'The incognito workspace is not ready. Restart the app and try again.',
    ja: 'シークレット作業領域の準備ができていません。アプリを再起動してください。',
    ko: '시크릿 작업 공간이 준비되지 않았습니다. 앱을 다시 시작하세요.',
    es: 'El espacio privado no está listo. Reinicia la aplicación.', fr: 'L’espace privé n’est pas prêt. Redémarrez l’application.',
    de: 'Der Inkognito-Arbeitsbereich ist noch nicht bereit. Starten Sie die App neu.',
    'pt-BR': 'O espaço privado não está pronto. Reinicie o aplicativo.', ru: 'Рабочая область инкогнито не готова. Перезапустите приложение.',
    ar: 'مساحة العمل الخفية غير جاهزة. أعد تشغيل التطبيق.', hi: 'गुप्त कार्यक्षेत्र तैयार नहीं है। ऐप फिर से शुरू करें।'
};
const modeCopy: Readonly<Record<string, readonly [string, string, string, string, string, string, string]>> = {
    'zh-CN': ['当前已开启：无痕对话', '关闭无痕对话？', '关闭后，本次对话及其工作区文件会保存在本机，退出应用后不会自动删除。转为普通对话后，不能再改回无痕。', '关闭并保留', '正在切换对话模式…', '请等当前任务结束后再切换对话模式。', '未能切换对话模式，请重试。'],
    'zh-TW': ['目前已開啟：無痕對話', '關閉無痕對話？', '關閉後，本次對話及其工作區檔案會儲存在本機，結束應用程式後不會自動刪除。轉為一般對話後，無法再改回無痕。', '關閉並保留', '正在切換對話模式…', '請等目前的任務結束後再切換對話模式。', '無法切換對話模式，請重試。'],
    en: ['Currently on: Incognito', 'Turn off incognito?', 'This conversation and its workspace files will be saved locally and kept when you quit the app. Once converted to a regular conversation, it cannot be made incognito again.', 'Turn off and keep', 'Changing conversation mode…', 'Wait for the current task to finish before changing conversation mode.', 'Could not change conversation mode. Try again.'],
    ja: ['現在オン：シークレット', 'シークレットをオフにしますか？', 'この会話と作業領域のファイルをローカルに保存し、アプリ終了後も保持します。通常の会話に変更すると、シークレットには戻せません。', 'オフにして保持', '会話モードを切り替え中…', '実行中のタスクが完了してから会話モードを切り替えてください。', '会話モードを切り替えられませんでした。再試行してください。'],
    ko: ['현재 켜짐: 시크릿 대화', '시크릿 대화를 끌까요?', '이 대화와 작업 공간 파일이 로컬에 저장되며 앱을 종료해도 유지됩니다. 일반 대화로 전환하면 다시 시크릿 대화로 바꿀 수 없습니다.', '끄고 보관', '대화 모드 변경 중…', '현재 작업이 끝난 후 대화 모드를 변경하세요.', '대화 모드를 변경하지 못했습니다. 다시 시도하세요.'],
    es: ['Activada: conversación privada', '¿Desactivar la conversación privada?', 'Esta conversación y los archivos de su espacio de trabajo se guardarán localmente y se conservarán al salir de la aplicación. Una vez convertida en una conversación normal, no podrá volver a ser privada.', 'Desactivar y conservar', 'Cambiando el modo de conversación…', 'Espera a que termine la tarea actual antes de cambiar el modo de conversación.', 'No se pudo cambiar el modo de conversación. Inténtalo de nuevo.'],
    fr: ['Activée : conversation privée', 'Désactiver la conversation privée ?', 'Cette conversation et les fichiers de son espace de travail seront enregistrés localement et conservés à la fermeture de l’application. Une fois devenue normale, cette conversation ne pourra plus repasser en mode privé.', 'Désactiver et conserver', 'Changement du mode de conversation…', 'Attendez la fin de la tâche en cours avant de changer le mode de conversation.', 'Impossible de changer le mode de conversation. Réessayez.'],
    de: ['Aktiv: Inkognito', 'Inkognito deaktivieren?', 'Diese Unterhaltung und die Dateien ihres Arbeitsbereichs werden lokal gespeichert und beim Beenden der App behalten. Nach der Umwandlung in eine normale Unterhaltung kann sie nicht wieder inkognito werden.', 'Deaktivieren und behalten', 'Unterhaltungsmodus wird geändert…', 'Warten Sie, bis die aktuelle Aufgabe beendet ist, bevor Sie den Unterhaltungsmodus ändern.', 'Der Unterhaltungsmodus konnte nicht geändert werden. Versuchen Sie es erneut.'],
    'pt-BR': ['Ativada: conversa privada', 'Desativar a conversa privada?', 'Esta conversa e os arquivos de seu espaço de trabalho serão salvos localmente e mantidos ao sair do aplicativo. Depois de convertida em conversa normal, ela não poderá voltar ao modo privado.', 'Desativar e manter', 'Alterando o modo da conversa…', 'Aguarde a conclusão da tarefa atual antes de alterar o modo da conversa.', 'Não foi possível alterar o modo da conversa. Tente novamente.'],
    ru: ['Включено: инкогнито', 'Выключить инкогнито?', 'Этот разговор и файлы его рабочей области будут сохранены локально и останутся после выхода из приложения. После преобразования в обычный разговор вернуть режим инкогнито нельзя.', 'Выключить и сохранить', 'Изменение режима разговора…', 'Дождитесь завершения текущей задачи, прежде чем менять режим разговора.', 'Не удалось изменить режим разговора. Повторите попытку.'],
    ar: ['مفعّل حاليًا: المحادثة الخفية', 'هل تريد إيقاف المحادثة الخفية؟', 'ستُحفظ هذه المحادثة وملفات مساحة عملها محليًا وستبقى عند الخروج من التطبيق. بعد تحويلها إلى محادثة عادية، لا يمكن إعادتها إلى الوضع الخفي.', 'إيقاف مع الاحتفاظ', 'جارٍ تغيير وضع المحادثة…', 'انتظر انتهاء المهمة الحالية قبل تغيير وضع المحادثة.', 'تعذّر تغيير وضع المحادثة. حاول مجددًا.'],
    hi: ['अभी चालू: गुप्त बातचीत', 'गुप्त बातचीत बंद करें?', 'यह बातचीत और इसके कार्यक्षेत्र की फ़ाइलें स्थानीय रूप से सहेजी जाएँगी और ऐप बंद करने पर भी रहेंगी। सामान्य बातचीत में बदलने के बाद इसे फिर से गुप्त नहीं बनाया जा सकता।', 'बंद करें और रखें', 'बातचीत का मोड बदल रहा है…', 'बातचीत का मोड बदलने से पहले मौजूदा काम पूरा होने दें।', 'बातचीत का मोड नहीं बदला जा सका। फिर कोशिश करें।']
};
const modeKeys = { onHint: 0, disableTitle: 1, disableBody: 2, disableAction: 3, switching: 4, busy: 5, failed: 6 } as const;
export const INCOGNITO_TEXT_LOCALES = Object.freeze(Object.keys(copy));
export function incognitoText(locale: string, key: 'label' | 'hint' | 'historyLabel' | 'historyDescription' | 'unavailable' | keyof typeof modeKeys): string {
    if (key === 'unavailable') return unavailable[locale] || unavailable.en;
    if (key in modeKeys) return (modeCopy[locale] || modeCopy.en)[modeKeys[key as keyof typeof modeKeys]];
    return (copy[locale] || copy.en)[{ label: 0, hint: 1, historyLabel: 2, historyDescription: 3 }[key as 'label' | 'hint' | 'historyLabel' | 'historyDescription']] ?? String(key);
}
