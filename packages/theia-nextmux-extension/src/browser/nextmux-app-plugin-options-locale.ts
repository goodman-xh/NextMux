import type { NextMuxDesktopLocale } from './nextmux-locale';

/**
 * Skill plugin options: the installed card's Options / Details dialogs, the parameter fields, and the Jev model bar and
 * goal controls on a tab's plugin bar and in the plugin market.
 */
type Key = 'options' | 'presets' | 'permissions' | 'license' | 'homepage' | 'noOptions' | 'chooseFile' | 'chooseFolder' | 'clear'
    | 'unsupportedFormat' | 'noFolder' | 'changeFolder' | 'modelBar' | 'modelSource' | 'sourcePlatform' | 'sourceOpenRouter' | 'sourceLocal'
    | 'jevModel' | 'chooseAvailable' | 'moreSettings' | 'noModelInSource' | 'sendGoal' | 'parameters' | 'fileLines' | 'manifest'
    | 'presetSurvive' | 'presetGrow' | 'presetTeam' | 'presetOrganize' | 'presetReview' | 'presetContinueEditing'
    | 'presetContinue' | 'presetCarefully' | 'presetFinish';

const en: Readonly<Record<Key, string>> = {
    options: 'Options', presets: 'Presets', permissions: 'Permissions', license: 'License', homepage: 'Homepage',
    noOptions: 'This plugin has no configurable parameters.', chooseFile: 'Choose file', chooseFolder: 'Choose folder', clear: 'Clear',
    unsupportedFormat: 'Unsupported file. Choose .nmxplugin, .zip, .tar.gz / .tgz, a .jevplugin package, a plugin.json / manifest.json manifest, or a local folder using “Load from folder”.',
    noFolder: 'No folder selected', changeFolder: 'Change folder',
    modelBar: 'Jev model', modelSource: 'Source', sourcePlatform: 'NextMux platform', sourceOpenRouter: 'Own API · OpenRouter', sourceLocal: 'Server on this computer',
    jevModel: 'Model', chooseAvailable: 'Choose an available model', moreSettings: 'More settings',
    noModelInSource: 'No usable Jev model from this source. Open More settings to pick another.', sendGoal: 'Send goal', parameters: 'Plugin parameters',
    fileLines: '{name} · {count} lines', manifest: 'Manifest (JSON)',
    presetSurvive: 'Stay alive', presetGrow: 'Build resources', presetTeam: 'Team objectives', presetOrganize: 'Organize the document', presetReview: 'Review the text',
    presetContinueEditing: 'Continue editing', presetContinue: 'Continue the task', presetCarefully: 'Proceed carefully', presetFinish: 'Finish the objective'
};

const copy: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<Key, string>>>> = {
    en,
    'zh-CN': {
        options: '配置选项', presets: '预设', permissions: '权限', license: '许可证', homepage: '主页', noOptions: '此插件没有可配置参数。',
        chooseFile: '选择文件', chooseFolder: '选择文件夹', clear: '清除',
        unsupportedFormat: '不支持此文件。请选择 .nmxplugin、.zip、.tar.gz / .tgz、.jevplugin 插件包、plugin.json / manifest.json 清单，或通过“从文件夹加载”选择本地文件夹。',
        noFolder: '未选择文件夹', changeFolder: '更换文件夹',
        modelBar: 'Jev 模型', modelSource: '来源', sourcePlatform: 'NextMux 平台', sourceOpenRouter: '自有 API · OpenRouter', sourceLocal: '本机服务',
        jevModel: '模型', chooseAvailable: '请选择可用模型', moreSettings: '详细配置', noModelInSource: '此来源暂无可用的 Jev 模型，请打开详细配置选择其他来源。',
        sendGoal: '发送目标', parameters: '插件参数', fileLines: '{name} · {count} 条', manifest: '清单（JSON）',
        presetSurvive: '优先生存', presetGrow: '稳定发育', presetTeam: '推进团队目标', presetOrganize: '整理当前文档', presetReview: '检查文本',
        presetContinueEditing: '继续编辑', presetContinue: '继续当前任务', presetCarefully: '稳妥推进', presetFinish: '完成当前目标'
    },
    'zh-TW': {
        options: '設定選項', presets: '預設', permissions: '權限', license: '授權條款', homepage: '首頁', noOptions: '此外掛沒有可設定參數。',
        chooseFile: '選擇檔案', chooseFolder: '選擇資料夾', clear: '清除',
        unsupportedFormat: '不支援此檔案。請選擇 .nmxplugin、.zip、.tar.gz / .tgz、.jevplugin 外掛包、plugin.json / manifest.json 清單，或透過「從資料夾載入」選擇本機資料夾。',
        noFolder: '未選擇資料夾', changeFolder: '更換資料夾',
        modelBar: 'Jev 模型', modelSource: '來源', sourcePlatform: 'NextMux 平台', sourceOpenRouter: '自有 API · OpenRouter', sourceLocal: '本機服務',
        jevModel: '模型', chooseAvailable: '請選擇可用模型', moreSettings: '詳細設定', noModelInSource: '此來源暫無可用的 Jev 模型，請開啟詳細設定選擇其他來源。',
        sendGoal: '傳送目標', parameters: '外掛參數', fileLines: '{name} · {count} 條', manifest: '清單（JSON）',
        presetSurvive: '優先生存', presetGrow: '穩定發育', presetTeam: '推進團隊目標', presetOrganize: '整理目前文件', presetReview: '檢查文字',
        presetContinueEditing: '繼續編輯', presetContinue: '繼續目前任務', presetCarefully: '穩妥推進', presetFinish: '完成目前目標'
    },
    ja: {
        options: '設定オプション', presets: 'プリセット', permissions: '権限', license: 'ライセンス', homepage: 'ホームページ', noOptions: '設定可能なパラメーターはありません。',
        chooseFile: 'ファイルを選択', chooseFolder: 'フォルダーを選択', clear: 'クリア',
        unsupportedFormat: '未対応のファイルです。.nmxplugin、.zip、.tar.gz / .tgz、.jevplugin、plugin.json / manifest.json、または「フォルダーから読み込む」でローカルフォルダーを選択してください。',
        noFolder: 'フォルダー未選択', changeFolder: 'フォルダーを変更',
        modelBar: 'Jev モデル', modelSource: '提供元', sourcePlatform: 'NextMux プラットフォーム', sourceOpenRouter: '自分の API · OpenRouter', sourceLocal: 'このコンピューターのサーバー',
        jevModel: 'モデル', chooseAvailable: '使えるモデルを選択', moreSettings: '詳細設定', noModelInSource: 'この提供元には使える Jev モデルがありません。詳細設定から別の提供元を選んでください。',
        sendGoal: '目標を送信', parameters: 'プラグインのパラメーター', fileLines: '{name} · {count} 行', manifest: 'マニフェスト（JSON）',
        presetSurvive: '生存を優先', presetGrow: '着実に育成', presetTeam: 'チーム目標を進める', presetOrganize: '文書を整理', presetReview: 'テキストを確認',
        presetContinueEditing: '編集を続ける', presetContinue: '現在の作業を続ける', presetCarefully: '慎重に進める', presetFinish: '現在の目標を完了'
    },
    ko: {
        options: '설정 옵션', presets: '프리셋', permissions: '권한', license: '라이선스', homepage: '홈페이지', noOptions: '설정할 수 있는 매개변수가 없습니다.',
        chooseFile: '파일 선택', chooseFolder: '폴더 선택', clear: '지우기',
        unsupportedFormat: '지원하지 않는 파일입니다. .nmxplugin, .zip, .tar.gz / .tgz, .jevplugin 패키지, plugin.json / manifest.json 또는 “폴더에서 불러오기”로 로컬 폴더를 선택하세요.',
        noFolder: '선택한 폴더 없음', changeFolder: '폴더 변경',
        modelBar: 'Jev 모델', modelSource: '제공처', sourcePlatform: 'NextMux 플랫폼', sourceOpenRouter: '내 API · OpenRouter', sourceLocal: '이 컴퓨터의 서버',
        jevModel: '모델', chooseAvailable: '사용 가능한 모델 선택', moreSettings: '세부 설정', noModelInSource: '이 제공처에는 사용할 수 있는 Jev 모델이 없습니다. 세부 설정에서 다른 제공처를 고르세요.',
        sendGoal: '목표 보내기', parameters: '플러그인 매개변수', fileLines: '{name} · {count}줄', manifest: '매니페스트(JSON)',
        presetSurvive: '생존 우선', presetGrow: '안정적으로 성장', presetTeam: '팀 목표 진행', presetOrganize: '문서 정리', presetReview: '텍스트 검토',
        presetContinueEditing: '편집 계속', presetContinue: '현재 작업 계속', presetCarefully: '신중하게 진행', presetFinish: '현재 목표 완료'
    },
    es: {
        options: 'Opciones', presets: 'Preajustes', permissions: 'Permisos', license: 'Licencia', homepage: 'Página web', noOptions: 'Este plugin no tiene parámetros configurables.',
        chooseFile: 'Elegir archivo', chooseFolder: 'Elegir carpeta', clear: 'Borrar',
        unsupportedFormat: 'Archivo no compatible. Elige .nmxplugin, .zip, .tar.gz / .tgz, un paquete .jevplugin, un manifiesto plugin.json / manifest.json o una carpeta local con «Cargar desde carpeta».',
        noFolder: 'Ninguna carpeta seleccionada', changeFolder: 'Cambiar carpeta',
        modelBar: 'Modelo Jev', modelSource: 'Origen', sourcePlatform: 'Plataforma NextMux', sourceOpenRouter: 'API propia · OpenRouter', sourceLocal: 'Servidor en este equipo',
        jevModel: 'Modelo', chooseAvailable: 'Elige un modelo disponible', moreSettings: 'Más ajustes', noModelInSource: 'Este origen no tiene un modelo Jev utilizable. Abre Más ajustes para elegir otro.',
        sendGoal: 'Enviar objetivo', parameters: 'Parámetros del plugin', fileLines: '{name} · {count} líneas', manifest: 'Manifiesto (JSON)',
        presetSurvive: 'Sobrevivir', presetGrow: 'Reunir recursos', presetTeam: 'Objetivos del equipo', presetOrganize: 'Ordenar el documento', presetReview: 'Revisar el texto',
        presetContinueEditing: 'Seguir editando', presetContinue: 'Continuar la tarea', presetCarefully: 'Avanzar con cuidado', presetFinish: 'Terminar el objetivo'
    },
    fr: {
        options: 'Options', presets: 'Préréglages', permissions: 'Autorisations', license: 'Licence', homepage: 'Site web', noOptions: 'Ce plugin ne possède aucun paramètre configurable.',
        chooseFile: 'Choisir un fichier', chooseFolder: 'Choisir un dossier', clear: 'Effacer',
        unsupportedFormat: 'Fichier non pris en charge. Choisissez .nmxplugin, .zip, .tar.gz / .tgz, un paquet .jevplugin, un manifeste plugin.json / manifest.json ou un dossier local avec « Charger depuis un dossier ».',
        noFolder: 'Aucun dossier sélectionné', changeFolder: 'Changer de dossier',
        modelBar: 'Modèle Jev', modelSource: 'Source', sourcePlatform: 'Plateforme NextMux', sourceOpenRouter: 'API personnelle · OpenRouter', sourceLocal: 'Serveur sur cet ordinateur',
        jevModel: 'Modèle', chooseAvailable: 'Choisir un modèle disponible', moreSettings: 'Plus de réglages', noModelInSource: 'Aucun modèle Jev utilisable pour cette source. Ouvrez Plus de réglages pour en choisir une autre.',
        sendGoal: 'Envoyer l’objectif', parameters: 'Paramètres du plugin', fileLines: '{name} · {count} lignes', manifest: 'Manifeste (JSON)',
        presetSurvive: 'Rester en vie', presetGrow: 'Accumuler des ressources', presetTeam: 'Objectifs d’équipe', presetOrganize: 'Organiser le document', presetReview: 'Relire le texte',
        presetContinueEditing: 'Poursuivre l’édition', presetContinue: 'Poursuivre la tâche', presetCarefully: 'Avancer prudemment', presetFinish: 'Atteindre l’objectif'
    },
    de: {
        options: 'Optionen', presets: 'Voreinstellungen', permissions: 'Berechtigungen', license: 'Lizenz', homepage: 'Webseite', noOptions: 'Dieses Plugin hat keine konfigurierbaren Parameter.',
        chooseFile: 'Datei auswählen', chooseFolder: 'Ordner auswählen', clear: 'Löschen',
        unsupportedFormat: 'Nicht unterstützte Datei. Wählen Sie .nmxplugin, .zip, .tar.gz / .tgz, ein .jevplugin-Paket, plugin.json / manifest.json oder über „Aus Ordner laden“ einen lokalen Ordner.',
        noFolder: 'Kein Ordner ausgewählt', changeFolder: 'Ordner ändern',
        modelBar: 'Jev-Modell', modelSource: 'Quelle', sourcePlatform: 'NextMux-Plattform', sourceOpenRouter: 'Eigene API · OpenRouter', sourceLocal: 'Server auf diesem Computer',
        jevModel: 'Modell', chooseAvailable: 'Verfügbares Modell wählen', moreSettings: 'Weitere Einstellungen', noModelInSource: 'Diese Quelle hat kein nutzbares Jev-Modell. Öffnen Sie Weitere Einstellungen, um eine andere zu wählen.',
        sendGoal: 'Ziel senden', parameters: 'Plugin-Parameter', fileLines: '{name} · {count} Zeilen', manifest: 'Manifest (JSON)',
        presetSurvive: 'Überleben', presetGrow: 'Ressourcen aufbauen', presetTeam: 'Teamziele', presetOrganize: 'Dokument ordnen', presetReview: 'Text prüfen',
        presetContinueEditing: 'Weiter bearbeiten', presetContinue: 'Aufgabe fortsetzen', presetCarefully: 'Vorsichtig vorgehen', presetFinish: 'Ziel abschließen'
    },
    'pt-BR': {
        options: 'Opções', presets: 'Predefinições', permissions: 'Permissões', license: 'Licença', homepage: 'Página inicial', noOptions: 'Este plugin não tem parâmetros configuráveis.',
        chooseFile: 'Escolher arquivo', chooseFolder: 'Escolher pasta', clear: 'Limpar',
        unsupportedFormat: 'Arquivo não compatível. Escolha .nmxplugin, .zip, .tar.gz / .tgz, um pacote .jevplugin, um manifesto plugin.json / manifest.json ou uma pasta local em “Carregar da pasta”.',
        noFolder: 'Nenhuma pasta selecionada', changeFolder: 'Trocar pasta',
        modelBar: 'Modelo Jev', modelSource: 'Origem', sourcePlatform: 'Plataforma NextMux', sourceOpenRouter: 'API própria · OpenRouter', sourceLocal: 'Servidor neste computador',
        jevModel: 'Modelo', chooseAvailable: 'Escolha um modelo disponível', moreSettings: 'Mais ajustes', noModelInSource: 'Esta origem não tem um modelo Jev utilizável. Abra Mais ajustes para escolher outra.',
        sendGoal: 'Enviar objetivo', parameters: 'Parâmetros do plugin', fileLines: '{name} · {count} linhas', manifest: 'Manifesto (JSON)',
        presetSurvive: 'Sobreviver', presetGrow: 'Juntar recursos', presetTeam: 'Objetivos da equipe', presetOrganize: 'Organizar o documento', presetReview: 'Revisar o texto',
        presetContinueEditing: 'Continuar editando', presetContinue: 'Continuar a tarefa', presetCarefully: 'Avançar com cuidado', presetFinish: 'Concluir o objetivo'
    },
    ru: {
        options: 'Параметры', presets: 'Предустановки', permissions: 'Разрешения', license: 'Лицензия', homepage: 'Сайт', noOptions: 'У плагина нет настраиваемых параметров.',
        chooseFile: 'Выбрать файл', chooseFolder: 'Выбрать папку', clear: 'Очистить',
        unsupportedFormat: 'Файл не поддерживается. Выберите .nmxplugin, .zip, .tar.gz / .tgz, пакет .jevplugin, манифест plugin.json / manifest.json или локальную папку через «Загрузить из папки».',
        noFolder: 'Папка не выбрана', changeFolder: 'Сменить папку',
        modelBar: 'Модель Jev', modelSource: 'Источник', sourcePlatform: 'Платформа NextMux', sourceOpenRouter: 'Свой API · OpenRouter', sourceLocal: 'Сервер на этом компьютере',
        jevModel: 'Модель', chooseAvailable: 'Выберите доступную модель', moreSettings: 'Подробные настройки', noModelInSource: 'У этого источника нет подходящей модели Jev. Откройте подробные настройки, чтобы выбрать другой.',
        sendGoal: 'Отправить цель', parameters: 'Параметры плагина', fileLines: '{name} · строк: {count}', manifest: 'Манифест (JSON)',
        presetSurvive: 'Выжить', presetGrow: 'Копить ресурсы', presetTeam: 'Цели команды', presetOrganize: 'Упорядочить документ', presetReview: 'Проверить текст',
        presetContinueEditing: 'Продолжить правку', presetContinue: 'Продолжить задачу', presetCarefully: 'Действовать осторожно', presetFinish: 'Завершить цель'
    },
    ar: {
        options: 'خيارات الإعداد', presets: 'الإعدادات المسبقة', permissions: 'الأذونات', license: 'الترخيص', homepage: 'الموقع', noOptions: 'لا توجد معلمات قابلة للإعداد لهذا الملحق.',
        chooseFile: 'اختيار ملف', chooseFolder: 'اختيار مجلد', clear: 'مسح',
        unsupportedFormat: 'ملف غير مدعوم. اختر .nmxplugin أو .zip أو .tar.gz / .tgz أو حزمة .jevplugin أو ملف plugin.json / manifest.json أو مجلداً محلياً عبر «تحميل من مجلد».',
        noFolder: 'لم يتم اختيار مجلد', changeFolder: 'تغيير المجلد',
        modelBar: 'نموذج Jev', modelSource: 'المصدر', sourcePlatform: 'منصة NextMux', sourceOpenRouter: 'واجهتك · OpenRouter', sourceLocal: 'خادم على هذا الجهاز',
        jevModel: 'النموذج', chooseAvailable: 'اختر نموذجًا متاحًا', moreSettings: 'إعدادات أكثر', noModelInSource: 'لا يوجد نموذج Jev صالح من هذا المصدر. افتح إعدادات أكثر لاختيار مصدر آخر.',
        sendGoal: 'إرسال الهدف', parameters: 'معلمات الملحق', fileLines: '{name} · {count} سطر', manifest: 'البيان (JSON)',
        presetSurvive: 'البقاء أولًا', presetGrow: 'جمع الموارد', presetTeam: 'أهداف الفريق', presetOrganize: 'تنظيم المستند', presetReview: 'مراجعة النص',
        presetContinueEditing: 'متابعة التحرير', presetContinue: 'متابعة المهمة', presetCarefully: 'التقدم بحذر', presetFinish: 'إنهاء الهدف'
    },
    hi: {
        options: 'सेटिंग विकल्प', presets: 'प्रीसेट', permissions: 'अनुमतियाँ', license: 'लाइसेंस', homepage: 'मुखपृष्ठ', noOptions: 'इस प्लगइन में बदलने योग्य पैरामीटर नहीं हैं।',
        chooseFile: 'फ़ाइल चुनें', chooseFolder: 'फ़ोल्डर चुनें', clear: 'साफ़ करें',
        unsupportedFormat: 'असमर्थित फ़ाइल। .nmxplugin, .zip, .tar.gz / .tgz, .jevplugin पैकेज, plugin.json / manifest.json मैनिफ़ेस्ट चुनें, या “फ़ोल्डर से लोड करें” से स्थानीय फ़ोल्डर चुनें।',
        noFolder: 'कोई फ़ोल्डर नहीं चुना', changeFolder: 'फ़ोल्डर बदलें',
        modelBar: 'Jev मॉडल', modelSource: 'स्रोत', sourcePlatform: 'NextMux प्लेटफ़ॉर्म', sourceOpenRouter: 'अपना API · OpenRouter', sourceLocal: 'इस कंप्यूटर का सर्वर',
        jevModel: 'मॉडल', chooseAvailable: 'उपलब्ध मॉडल चुनें', moreSettings: 'और सेटिंग', noModelInSource: 'इस स्रोत में उपयोग योग्य Jev मॉडल नहीं है। दूसरा चुनने के लिए और सेटिंग खोलें।',
        sendGoal: 'लक्ष्य भेजें', parameters: 'प्लगइन पैरामीटर', fileLines: '{name} · {count} पंक्तियाँ', manifest: 'मैनिफ़ेस्ट (JSON)',
        presetSurvive: 'बचे रहें', presetGrow: 'संसाधन जुटाएँ', presetTeam: 'टीम लक्ष्य', presetOrganize: 'दस्तावेज़ व्यवस्थित करें', presetReview: 'टेक्स्ट जाँचें',
        presetContinueEditing: 'संपादन जारी रखें', presetContinue: 'काम जारी रखें', presetCarefully: 'सावधानी से बढ़ें', presetFinish: 'लक्ष्य पूरा करें'
    }
};

export type AppPluginOptionsTextKey = Key;

export function appPluginOptionsText(locale: NextMuxDesktopLocale, key: Key, values: Readonly<Record<string, string | number>> = {}): string {
    const template = (copy[locale] || en)[key] || en[key];
    return template.replace(/\{(\w+)\}/g, (match, name: string) => name in values ? String(values[name]) : match);
}

export const appPluginOptionsLocales = Object.keys(copy) as readonly NextMuxDesktopLocale[];

/** Legacy .nmxplugin archives remain readable, but are no longer advertised. */
export function isAppPluginImportFile(path: string): boolean {
    const name = path.split(/[\\/]/).pop() || '';
    return /\.(?:zip|tar\.gz|tgz|jevplugin|nmxplugin)$/i.test(name) || /^(?:plugin|manifest)\.json$/.test(name);
}

export function appPluginParamExtensions(accept?: readonly string[]): string[] {
    return [...new Set((accept?.length ? accept : ['txt', 'md']).map(value => value.replace(/^\*?\./, '').toLowerCase()).filter(value => /^[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(value)))];
}
