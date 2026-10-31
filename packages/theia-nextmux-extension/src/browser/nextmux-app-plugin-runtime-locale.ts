import type { NextMuxDesktopLocale } from './nextmux-locale';
import { totalCopy } from './nextmux-copy-fallback';

const en = {
    costUnknown: 'Cost unknown · dollar budget not enforced',
    budgetUnknown: 'Costs for this source are unknown, so the dollar budget cannot be enforced. Time and request limits still apply.',
    inputUnsupported: 'This computer cannot perform the input actions this plugin requires.',
    keyHoldUnsupported: 'This computer cannot hold keys. This plugin requires an explicit key hold.',
    keyChordUnsupported: 'This computer cannot press the key combination this plugin requires.',
    modifierUnsupported: 'This computer cannot press a modifier key on its own.',
    pointerMoveUnsupported: 'This computer cannot move the pointer without clicking. Aim-and-cast actions are unavailable.',
    pointerModifierUnsupported: 'This computer cannot hold modifier keys such as Shift while clicking or dragging in the background. Actions that click with modifier keys are unavailable.',
    pointerButtonUnsupported: 'This computer cannot click with the middle mouse button, or drag with the right or middle button, in the background.',
    modelChangesImmediate: 'Model changes are saved and applied immediately to running plugins.',
    requestLimit: 'request limit reached',
    paramPathInvalid: 'The selected folder path is invalid or does not exist. Choose an existing folder.',
    paramFileEmpty: 'The selected parameter file has no usable lines. Choose a non-empty file first.',
    textEmpty: 'The text to enter is empty. Fill in the required plugin parameter first.'
};
type Key = keyof typeof en;
export const APP_PLUGIN_RUNTIME_TEXT: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<Key, string>>>> = {
    en,
    'zh-CN': {
        pointerMoveUnsupported: '这台电脑不支持只移动鼠标指针，无法执行先瞄准再按键的动作。',
        pointerModifierUnsupported: '这台电脑不支持在后台点击或拖拽时按住 Shift 等修饰键，需要修饰键的点击动作不可用。',
        pointerButtonUnsupported: '这台电脑不支持在后台用鼠标中键点击，或用右键、中键拖拽。',
        modelChangesImmediate: '模型修改保存后会立即应用到正在运行的插件。',
        costUnknown: '费用未知 · 无法执行美元预算上限',
        budgetUnknown: '这个来源的费用未知，无法按美元预算上限停止。运行时间和请求次数上限仍然有效。',
        inputUnsupported: '这台电脑无法执行插件需要的输入动作。', keyHoldUnsupported: '这台电脑不支持长按按键，而这个插件明确要求长按。',
        keyChordUnsupported: '这台电脑不支持插件需要的按键组合。', modifierUnsupported: '这台电脑不支持单独按下修饰键。', requestLimit: '到达请求次数上限',
        paramPathInvalid: '所选文件夹路径无效或不存在，请重新选择有效的文件夹。',
        paramFileEmpty: '所选参数文件没有可用内容，请先选择包含内容的文件。',
        textEmpty: '要输入的文本为空，请先填写相应的插件参数。'
    },
    'zh-TW': {
        pointerMoveUnsupported: '這台電腦不支援只移動滑鼠指標，無法執行先瞄準再按鍵的動作。',
        pointerModifierUnsupported: '這台電腦不支援在背景點擊或拖曳時按住 Shift 等輔助鍵，需要輔助鍵的點擊動作無法使用。',
        pointerButtonUnsupported: '這台電腦不支援在背景以滑鼠中鍵點擊，或以右鍵、中鍵拖曳。',
        modelChangesImmediate: '模型變更儲存後會立即套用到執行中的外掛。',
        costUnknown: '費用未知 · 無法執行美元預算上限',
        budgetUnknown: '這個來源的費用未知，無法按美元預算上限停止。執行時間和請求次數上限仍然有效。',
        inputUnsupported: '這台電腦無法執行外掛需要的輸入動作。', keyHoldUnsupported: '這台電腦不支援長按按鍵，而這個外掛明確要求長按。',
        keyChordUnsupported: '這台電腦不支援外掛需要的按鍵組合。', modifierUnsupported: '這台電腦不支援單獨按下修飾鍵。', requestLimit: '已達請求次數上限',
        paramPathInvalid: '所選資料夾路徑無效或不存在，請重新選擇有效的資料夾。',
        paramFileEmpty: '所選參數檔案沒有可用內容，請先選擇包含內容的檔案。',
        textEmpty: '要輸入的文字為空，請先填寫相應的外掛參數。'
    },
    ja: {
        pointerMoveUnsupported: 'このコンピューターはクリックせずにポインターを移動できません。照準を合わせてからキーを押す操作は使えません。',
        pointerModifierUnsupported: 'このコンピューターはバックグラウンドでのクリックやドラッグ中に Shift などの修飾キーを押したままにできません。修飾キー付きのクリック操作は使えません。',
        pointerButtonUnsupported: 'このコンピューターはバックグラウンドで中ボタンのクリックや、右ボタン・中ボタンでのドラッグができません。',
        modelChangesImmediate: 'モデルの変更は保存後、実行中のプラグインにすぐに適用されます。',
        costUnknown: '費用不明 · ドル予算の上限は適用できません',
        budgetUnknown: 'この接続の費用は不明のため、ドル予算の上限では停止できません。時間とリクエスト回数の上限は引き続き有効です。',
        inputUnsupported: 'このコンピューターはプラグインが必要とする入力操作に対応していません。', keyHoldUnsupported: 'このコンピューターはキーの長押しに対応していません。このプラグインには長押しが必要です。',
        keyChordUnsupported: 'このコンピューターはプラグインが必要とするキーの組み合わせに対応していません。', modifierUnsupported: 'このコンピューターでは修飾キーを単独で押せません。', requestLimit: 'リクエスト回数の上限に達しました',
        paramPathInvalid: '選択したフォルダーのパスが無効か存在しません。有効なフォルダーを選び直してください。',
        paramFileEmpty: '選択したパラメーターファイルに使える行がありません。内容のあるファイルを選択してください。',
        textEmpty: '入力するテキストが空です。必要なプラグインパラメーターを先に入力してください。'
    },
    ko: {
        pointerMoveUnsupported: '이 컴퓨터는 클릭 없이 포인터를 이동할 수 없습니다. 조준 후 키 입력 동작을 사용할 수 없습니다.',
        pointerModifierUnsupported: '이 컴퓨터는 백그라운드에서 클릭하거나 드래그하는 동안 Shift 같은 보조 키를 누르고 있을 수 없습니다. 보조 키를 쓰는 클릭 동작을 사용할 수 없습니다.',
        pointerButtonUnsupported: '이 컴퓨터는 백그라운드에서 가운데 버튼으로 클릭하거나 오른쪽·가운데 버튼으로 드래그할 수 없습니다.',
        modelChangesImmediate: '모델 변경은 저장 후 실행 중인 플러그인에 즉시 적용됩니다.',
        costUnknown: '비용 알 수 없음 · 달러 예산 한도 적용 불가',
        budgetUnknown: '이 소스의 비용을 알 수 없어 달러 예산 한도로 중지할 수 없습니다. 시간 및 요청 횟수 한도는 계속 적용됩니다.',
        inputUnsupported: '이 컴퓨터는 플러그인에 필요한 입력 동작을 지원하지 않습니다.', keyHoldUnsupported: '이 컴퓨터는 키 길게 누르기를 지원하지 않으며, 이 플러그인은 이를 요구합니다.',
        keyChordUnsupported: '이 컴퓨터는 플러그인에 필요한 키 조합을 지원하지 않습니다.', modifierUnsupported: '이 컴퓨터는 보조 키만 따로 누르는 것을 지원하지 않습니다.', requestLimit: '요청 횟수 한도 도달',
        paramPathInvalid: '선택한 폴더 경로가 올바르지 않거나 존재하지 않습니다. 유효한 폴더를 다시 선택하세요.',
        paramFileEmpty: '선택한 매개변수 파일에 사용할 수 있는 줄이 없습니다. 내용이 있는 파일을 먼저 선택하세요.',
        textEmpty: '입력할 텍스트가 비어 있습니다. 필요한 플러그인 매개변수를 먼저 입력하세요.'
    },
    es: {
        pointerMoveUnsupported: 'Este equipo no puede mover el puntero sin hacer clic. Las acciones de apuntar y pulsar una tecla no están disponibles.',
        pointerModifierUnsupported: 'Este equipo no puede mantener teclas modificadoras como Mayús al hacer clic o arrastrar en segundo plano. Las acciones de clic con teclas modificadoras no están disponibles.',
        pointerButtonUnsupported: 'Este equipo no puede hacer clic con el botón central ni arrastrar con el botón derecho o central en segundo plano.',
        modelChangesImmediate: 'Los cambios de modelo se guardan y se aplican de inmediato a los plugins en ejecución.',
        costUnknown: 'Coste desconocido · presupuesto en dólares sin aplicar',
        budgetUnknown: 'Se desconoce el coste de esta fuente, por lo que no se puede aplicar el presupuesto en dólares. Los límites de tiempo y solicitudes siguen vigentes.',
        inputUnsupported: 'Este equipo no admite las acciones de entrada que necesita el plugin.', keyHoldUnsupported: 'Este equipo no puede mantener teclas pulsadas, pero el plugin lo requiere.',
        keyChordUnsupported: 'Este equipo no admite la combinación de teclas que necesita el plugin.', modifierUnsupported: 'Este equipo no puede pulsar una tecla modificadora por sí sola.', requestLimit: 'límite de solicitudes alcanzado',
        paramPathInvalid: 'La ruta de la carpeta seleccionada no es válida o no existe. Elige una carpeta existente.',
        paramFileEmpty: 'El archivo de parámetro seleccionado no tiene líneas utilizables. Elige primero un archivo con contenido.',
        textEmpty: 'El texto para escribir está vacío. Completa primero el parámetro requerido del plugin.'
    },
    fr: {
        pointerMoveUnsupported: 'Cet ordinateur ne peut pas déplacer le pointeur sans cliquer. Les actions de visée suivie d’une touche ne sont pas disponibles.',
        pointerModifierUnsupported: 'Cet ordinateur ne peut pas maintenir une touche de modification comme Maj pendant un clic ou un glisser en arrière-plan. Les clics avec touches de modification ne sont pas disponibles.',
        pointerButtonUnsupported: 'Cet ordinateur ne peut pas cliquer avec le bouton du milieu ni glisser avec le bouton droit ou du milieu en arrière-plan.',
        modelChangesImmediate: 'Les changements de modèle sont enregistrés et appliqués immédiatement aux plugins en cours.',
        costUnknown: 'Coût inconnu · budget en dollars non appliqué',
        budgetUnknown: 'Le coût de cette source est inconnu ; le budget en dollars ne peut donc pas être appliqué. Les limites de durée et de requêtes restent actives.',
        inputUnsupported: 'Cet ordinateur ne prend pas en charge les actions de saisie requises par le plugin.', keyHoldUnsupported: 'Cet ordinateur ne peut pas maintenir une touche enfoncée, alors que ce plugin le demande.',
        keyChordUnsupported: 'Cet ordinateur ne prend pas en charge la combinaison de touches requise par le plugin.', modifierUnsupported: 'Cet ordinateur ne peut pas appuyer sur une touche de modification seule.', requestLimit: 'limite de requêtes atteinte',
        paramPathInvalid: 'Le chemin du dossier sélectionné est invalide ou introuvable. Choisissez un dossier existant.',
        paramFileEmpty: 'Le fichier de paramètre sélectionné ne contient aucune ligne utilisable. Choisissez d’abord un fichier non vide.',
        textEmpty: 'Le texte à saisir est vide. Renseignez d’abord le paramètre requis du plugin.'
    },
    de: {
        pointerMoveUnsupported: 'Dieser Computer kann den Mauszeiger nicht ohne Klick bewegen. Zielen mit anschließendem Tastendruck ist nicht verfügbar.',
        pointerModifierUnsupported: 'Dieser Computer kann beim Klicken oder Ziehen im Hintergrund keine Zusatztasten wie Umschalt gedrückt halten. Klicks mit Zusatztasten sind nicht verfügbar.',
        pointerButtonUnsupported: 'Dieser Computer kann im Hintergrund weder mit der mittleren Maustaste klicken noch mit der rechten oder mittleren Maustaste ziehen.',
        modelChangesImmediate: 'Modelländerungen werden gespeichert und sofort auf laufende Plugins angewendet.',
        costUnknown: 'Kosten unbekannt · Dollarbudget wird nicht eingehalten',
        budgetUnknown: 'Die Kosten dieser Quelle sind unbekannt. Das Dollarbudget kann daher nicht durchgesetzt werden. Zeit- und Anfragelimits gelten weiterhin.',
        inputUnsupported: 'Dieser Computer unterstützt die vom Plugin benötigten Eingaben nicht.', keyHoldUnsupported: 'Dieser Computer kann Tasten nicht gedrückt halten, aber dieses Plugin benötigt diese Funktion.',
        keyChordUnsupported: 'Dieser Computer unterstützt die vom Plugin benötigte Tastenkombination nicht.', modifierUnsupported: 'Dieser Computer kann eine Modifikatortaste nicht einzeln drücken.', requestLimit: 'Anfragelimit erreicht',
        paramPathInvalid: 'Der ausgewählte Ordnerpfad ist ungültig oder existiert nicht. Wähle einen vorhandenen Ordner.',
        paramFileEmpty: 'Die ausgewählte Parameterdatei enthält keine verwendbaren Zeilen. Wähle zuerst eine nicht leere Datei.',
        textEmpty: 'Der einzugebende Text ist leer. Fülle zuerst den erforderlichen Plugin-Parameter aus.'
    },
    'pt-BR': {
        pointerMoveUnsupported: 'Este computador não pode mover o ponteiro sem clicar. Ações de mirar e pressionar uma tecla não estão disponíveis.',
        pointerModifierUnsupported: 'Este computador não consegue manter teclas modificadoras como Shift pressionadas ao clicar ou arrastar em segundo plano. Cliques com teclas modificadoras não estão disponíveis.',
        pointerButtonUnsupported: 'Este computador não consegue clicar com o botão do meio nem arrastar com o botão direito ou do meio em segundo plano.',
        modelChangesImmediate: 'As alterações do modelo são salvas e aplicadas imediatamente aos plugins em execução.',
        costUnknown: 'Custo desconhecido · orçamento em dólares não aplicado',
        budgetUnknown: 'O custo desta fonte é desconhecido, então o orçamento em dólares não pode ser aplicado. Os limites de tempo e solicitações continuam valendo.',
        inputUnsupported: 'Este computador não oferece as ações de entrada exigidas pelo plugin.', keyHoldUnsupported: 'Este computador não pode manter teclas pressionadas, mas este plugin exige isso.',
        keyChordUnsupported: 'Este computador não oferece a combinação de teclas exigida pelo plugin.', modifierUnsupported: 'Este computador não pode pressionar uma tecla modificadora sozinha.', requestLimit: 'limite de solicitações atingido',
        paramPathInvalid: 'O caminho da pasta selecionada é inválido ou não existe. Escolha uma pasta existente.',
        paramFileEmpty: 'O arquivo de parâmetro selecionado não contém linhas utilizáveis. Escolha primeiro um arquivo com conteúdo.',
        textEmpty: 'O texto a inserir está vazio. Preencha primeiro o parâmetro necessário do plugin.'
    },
    ru: {
        pointerMoveUnsupported: 'Этот компьютер не может перемещать указатель без щелчка. Действия с наведением и последующим нажатием клавиши недоступны.',
        pointerModifierUnsupported: 'Этот компьютер не может удерживать клавиши-модификаторы, например Shift, при щелчке или перетаскивании в фоновом режиме. Щелчки с модификаторами недоступны.',
        pointerButtonUnsupported: 'Этот компьютер не может в фоновом режиме щёлкать средней кнопкой мыши или перетаскивать правой или средней кнопкой.',
        modelChangesImmediate: 'Изменения модели сохраняются и сразу применяются к работающим плагинам.',
        costUnknown: 'Стоимость неизвестна · бюджет в долларах не применяется',
        budgetUnknown: 'Стоимость этого источника неизвестна, поэтому ограничить расходы долларовым бюджетом нельзя. Ограничения времени и числа запросов остаются в силе.',
        inputUnsupported: 'Этот компьютер не поддерживает нужные плагину действия ввода.', keyHoldUnsupported: 'Этот компьютер не поддерживает удержание клавиш, которое требуется плагину.',
        keyChordUnsupported: 'Этот компьютер не поддерживает нужное плагину сочетание клавиш.', modifierUnsupported: 'Этот компьютер не поддерживает отдельное нажатие клавиши-модификатора.', requestLimit: 'достигнут лимит запросов',
        paramPathInvalid: 'Выбранный путь к папке недействителен или не существует. Выберите существующую папку.',
        paramFileEmpty: 'В выбранном файле параметра нет подходящих строк. Сначала выберите непустой файл.',
        textEmpty: 'Текст для ввода пуст. Сначала укажите нужный параметр плагина.'
    },
    ar: {
        pointerMoveUnsupported: 'لا يستطيع هذا الكمبيوتر تحريك المؤشر دون النقر. إجراءات التصويب ثم الضغط على مفتاح غير متاحة.',
        pointerModifierUnsupported: 'لا يستطيع هذا الكمبيوتر إبقاء مفاتيح التعديل مثل Shift مضغوطة أثناء النقر أو السحب في الخلفية. إجراءات النقر مع مفاتيح التعديل غير متاحة.',
        pointerButtonUnsupported: 'لا يستطيع هذا الكمبيوتر النقر بالزر الأوسط أو السحب بالزر الأيمن أو الأوسط في الخلفية.',
        modelChangesImmediate: 'تُحفظ تغييرات النموذج وتُطبّق فورًا على الإضافات قيد التشغيل.',
        costUnknown: 'التكلفة غير معروفة · لا يُطبّق حد الميزانية بالدولار',
        budgetUnknown: 'تكلفة هذا المصدر غير معروفة، لذا لا يمكن تطبيق حد الميزانية بالدولار. تظل حدود الوقت وعدد الطلبات سارية.',
        inputUnsupported: 'لا يدعم هذا الكمبيوتر إجراءات الإدخال التي تتطلبها الإضافة.', keyHoldUnsupported: 'لا يدعم هذا الكمبيوتر الضغط المطوّل على المفاتيح الذي تتطلبه الإضافة.',
        keyChordUnsupported: 'لا يدعم هذا الكمبيوتر مجموعة المفاتيح التي تتطلبها الإضافة.', modifierUnsupported: 'لا يدعم هذا الكمبيوتر الضغط على مفتاح تعديل بمفرده.', requestLimit: 'تم بلوغ الحد الأقصى للطلبات',
        paramPathInvalid: 'مسار المجلد المحدد غير صالح أو غير موجود. اختر مجلداً موجوداً.',
        paramFileEmpty: 'ملف المعلمة المحدد لا يحتوي على أسطر صالحة للاستخدام. اختر ملفاً غير فارغ أولاً.',
        textEmpty: 'النص المطلوب إدخاله فارغ. املأ معلمة الإضافة المطلوبة أولاً.'
    },
    hi: {
        pointerMoveUnsupported: 'यह कंप्यूटर क्लिक किए बिना पॉइंटर नहीं हिला सकता। निशाना लगाकर कुंजी दबाने वाली क्रियाएँ उपलब्ध नहीं हैं।',
        pointerModifierUnsupported: 'यह कंप्यूटर बैकग्राउंड में क्लिक या ड्रैग करते समय Shift जैसी मॉडिफ़ायर कुंजियाँ दबाए नहीं रख सकता। मॉडिफ़ायर कुंजी वाले क्लिक उपलब्ध नहीं हैं।',
        pointerButtonUnsupported: 'यह कंप्यूटर बैकग्राउंड में बीच वाले बटन से क्लिक या दाएँ/बीच वाले बटन से ड्रैग नहीं कर सकता।',
        modelChangesImmediate: 'मॉडल के बदलाव सहेजे जाने के बाद चल रहे प्लगइन पर तुरंत लागू होते हैं।',
        costUnknown: 'लागत अज्ञात · डॉलर बजट लागू नहीं है',
        budgetUnknown: 'इस स्रोत की लागत अज्ञात है, इसलिए डॉलर बजट लागू नहीं किया जा सकता। समय और अनुरोधों की संख्या की सीमाएँ लागू रहेंगी।',
        inputUnsupported: 'यह कंप्यूटर प्लगइन के लिए ज़रूरी इनपुट क्रियाओं का समर्थन नहीं करता।', keyHoldUnsupported: 'यह कंप्यूटर कुंजी दबाकर रखने का समर्थन नहीं करता, जबकि इस प्लगइन को इसकी ज़रूरत है।',
        keyChordUnsupported: 'यह कंप्यूटर प्लगइन के लिए ज़रूरी कुंजी संयोजन का समर्थन नहीं करता।', modifierUnsupported: 'यह कंप्यूटर अकेले संशोधक कुंजी दबाने का समर्थन नहीं करता।', requestLimit: 'अनुरोध सीमा पूरी हुई',
        paramPathInvalid: 'चुना गया फ़ोल्डर पथ अमान्य है या मौजूद नहीं है। कोई मौजूदा फ़ोल्डर चुनें।',
        paramFileEmpty: 'चुनी गई पैरामीटर फ़ाइल में कोई उपयोगी पंक्ति नहीं है। पहले सामग्री वाली फ़ाइल चुनें।',
        textEmpty: 'दर्ज किया जाने वाला टेक्स्ट खाली है। पहले आवश्यक प्लगइन पैरामीटर भरें।'
    }
};

export const appPluginRuntimeText = (locale: NextMuxDesktopLocale, key: Key): string => totalCopy(locale, key, language => APP_PLUGIN_RUNTIME_TEXT[language][key]);

/** Keep the plugin's action/step location, but describe the platform limitation in the user's language. */
export function appPluginInputError(locale: NextMuxDesktopLocale, error: unknown): string | undefined {
    if (typeof error !== 'string') return undefined;
    const match = /^(?:(.{1,140}): )?(computer_input_unsupported|plugin_input_unsupported|computer_key_hold_unsupported|computer_key_chord_unsupported|computer_modifier_key_unsupported|computer_pointer_move_unsupported|computer_pointer_modifier_unsupported|computer_pointer_button_unsupported|param_path_invalid|param_file_empty|text_empty)$/.exec(error);
    if (!match) return undefined;
    const keys: Readonly<Record<string, Key>> = {
        computer_key_hold_unsupported: 'keyHoldUnsupported', computer_key_chord_unsupported: 'keyChordUnsupported',
        computer_modifier_key_unsupported: 'modifierUnsupported', computer_pointer_move_unsupported: 'pointerMoveUnsupported',
        computer_pointer_modifier_unsupported: 'pointerModifierUnsupported', computer_pointer_button_unsupported: 'pointerButtonUnsupported',
        param_path_invalid: 'paramPathInvalid', param_file_empty: 'paramFileEmpty', text_empty: 'textEmpty'
    };
    const key = keys[match[2]] || 'inputUnsupported';
    return `${match[1] ? `${match[1]}: ` : ''}${appPluginRuntimeText(locale, key)}`;
}

const PACKAGE_FORMATS = '.zip / .tar.gz / .tgz / .jevplugin; plugin.json / manifest.json';
const packageCopy: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<'format' | 'corrupt' | 'manifest' | 'unsafe' | 'limit' | 'read' | 'install' | 'runtime' | 'supported', string>>>> = {
    en: { format: 'Unsupported plugin file type.', corrupt: 'The plugin archive is corrupt or uses unsupported compression.', manifest: 'A valid plugin.json or manifest.json is required.', unsafe: 'The plugin contains an unsafe path, link, duplicate or unsupported file.', limit: 'The plugin exceeds the file count or size limit.', read: 'The plugin file or folder could not be read.', install: 'The plugin could not be saved. The previous installation was retained where recovery succeeded.', runtime: 'The plugin decision runtime is missing or damaged. Reinstall NextMux to restore it.', supported: 'Supported: {formats}, or a plugin folder.' },
    'zh-CN': { format: '不支持此插件文件类型。', corrupt: '插件压缩包已损坏或使用了不支持的压缩方式。', manifest: '需要有效的 plugin.json 或 manifest.json。', unsafe: '插件包含不安全的路径、链接、重复文件或不支持的文件。', limit: '插件超出文件数量或大小限制。', read: '无法读取插件文件或文件夹。', install: '无法保存插件；恢复成功时已保留之前的安装版本。', runtime: '插件决策运行库缺失或损坏，请重新安装 NextMux 修复。', supported: '支持：{formats}，或插件文件夹。' },
    'zh-TW': { format: '不支援此外掛檔案類型。', corrupt: '外掛壓縮檔已損壞或使用不支援的壓縮方式。', manifest: '需要有效的 plugin.json 或 manifest.json。', unsafe: '外掛包含不安全的路徑、連結、重複或不支援的檔案。', limit: '外掛超出檔案數量或大小限制。', read: '無法讀取外掛檔案或資料夾。', install: '無法儲存外掛；復原成功時已保留先前版本。', runtime: '外掛決策執行庫遺失或損壞，請重新安裝 NextMux 修復。', supported: '支援：{formats}，或外掛資料夾。' },
    ja: { format: 'このプラグインファイル形式には対応していません。', corrupt: 'アーカイブが破損しているか、未対応の圧縮方式です。', manifest: '有効な plugin.json または manifest.json が必要です。', unsafe: '安全でないパス、リンク、重複または未対応のファイルがあります。', limit: 'ファイル数またはサイズの上限を超えています。', read: 'プラグインのファイルまたはフォルダーを読み取れません。', install: 'プラグインを保存できません。復元に成功した場合、以前のバージョンが保持されます。', runtime: 'プラグインの決定ランタイムが見つからないか破損しています。NextMux を再インストールしてください。', supported: '対応形式：{formats}、またはプラグインフォルダー。' },
    ko: { format: '지원하지 않는 플러그인 파일 형식입니다.', corrupt: '압축 파일이 손상되었거나 지원하지 않는 압축 방식입니다.', manifest: '유효한 plugin.json 또는 manifest.json이 필요합니다.', unsafe: '안전하지 않은 경로, 링크, 중복 파일 또는 지원하지 않는 파일이 있습니다.', limit: '파일 수 또는 크기 제한을 초과했습니다.', read: '플러그인 파일이나 폴더를 읽을 수 없습니다.', install: '플러그인을 저장할 수 없습니다. 복구에 성공한 경우 이전 설치가 유지됩니다.', runtime: '플러그인 의사결정 런타임이 없거나 손상되었습니다. NextMux를 다시 설치하세요.', supported: '지원: {formats} 또는 플러그인 폴더.' },
    es: { format: 'Tipo de archivo de plugin no compatible.', corrupt: 'El archivo está dañado o usa una compresión no compatible.', manifest: 'Se necesita un plugin.json o manifest.json válido.', unsafe: 'El plugin contiene rutas inseguras, enlaces, duplicados o archivos no compatibles.', limit: 'El plugin supera el límite de archivos o tamaño.', read: 'No se puede leer el archivo o la carpeta del plugin.', install: 'No se pudo guardar el plugin. La instalación anterior se conservó si la recuperación tuvo éxito.', runtime: 'Falta el entorno de decisión del plugin o está dañado. Reinstala NextMux.', supported: 'Compatible: {formats}, o una carpeta de plugin.' },
    fr: { format: 'Type de fichier de plugin non pris en charge.', corrupt: 'L’archive est corrompue ou utilise une compression non prise en charge.', manifest: 'Un fichier plugin.json ou manifest.json valide est requis.', unsafe: 'Le plugin contient un chemin dangereux, un lien, un doublon ou un fichier non pris en charge.', limit: 'Le plugin dépasse la limite de fichiers ou de taille.', read: 'Impossible de lire le fichier ou le dossier du plugin.', install: 'Impossible d’enregistrer le plugin. L’installation précédente est conservée si la restauration réussit.', runtime: 'Le moteur de décision du plugin est absent ou endommagé. Réinstallez NextMux.', supported: 'Formats acceptés : {formats}, ou un dossier de plugin.' },
    de: { format: 'Nicht unterstützter Plugin-Dateityp.', corrupt: 'Das Archiv ist beschädigt oder verwendet eine nicht unterstützte Komprimierung.', manifest: 'Eine gültige plugin.json oder manifest.json ist erforderlich.', unsafe: 'Das Plugin enthält unsichere Pfade, Links, Duplikate oder nicht unterstützte Dateien.', limit: 'Das Plugin überschreitet die Datei- oder Größenbegrenzung.', read: 'Die Plugin-Datei oder der Ordner kann nicht gelesen werden.', install: 'Das Plugin konnte nicht gespeichert werden. Bei erfolgreicher Wiederherstellung bleibt die vorherige Installation erhalten.', runtime: 'Die Entscheidungs-Laufzeit des Plugins fehlt oder ist beschädigt. Installieren Sie NextMux erneut.', supported: 'Unterstützt: {formats} oder ein Plugin-Ordner.' },
    'pt-BR': { format: 'Tipo de arquivo de plugin não compatível.', corrupt: 'O arquivo está corrompido ou usa compressão não compatível.', manifest: 'É necessário um plugin.json ou manifest.json válido.', unsafe: 'O plugin contém caminhos inseguros, links, duplicatas ou arquivos não compatíveis.', limit: 'O plugin excede o limite de arquivos ou tamanho.', read: 'Não foi possível ler o arquivo ou a pasta do plugin.', install: 'Não foi possível salvar o plugin. A instalação anterior foi mantida se a recuperação teve sucesso.', runtime: 'O runtime de decisão do plugin está ausente ou danificado. Reinstale o NextMux.', supported: 'Formatos aceitos: {formats}, ou uma pasta de plugin.' },
    ru: { format: 'Этот тип файла плагина не поддерживается.', corrupt: 'Архив повреждён или использует неподдерживаемое сжатие.', manifest: 'Требуется корректный plugin.json или manifest.json.', unsafe: 'Плагин содержит небезопасные пути, ссылки, дубликаты или неподдерживаемые файлы.', limit: 'Превышен лимит числа или размера файлов плагина.', read: 'Не удалось прочитать файл или папку плагина.', install: 'Не удалось сохранить плагин. При успешном восстановлении предыдущая установка сохранена.', runtime: 'Среда принятия решений плагина отсутствует или повреждена. Переустановите NextMux.', supported: 'Поддерживаются: {formats} или папка плагина.' },
    ar: { format: 'نوع ملف الملحق غير مدعوم.', corrupt: 'الأرشيف تالف أو يستخدم ضغطاً غير مدعوم.', manifest: 'يلزم ملف plugin.json أو manifest.json صالح.', unsafe: 'يحتوي الملحق على مسارات غير آمنة أو روابط أو ملفات مكررة أو غير مدعومة.', limit: 'يتجاوز الملحق حد عدد الملفات أو حجمها.', read: 'تعذرت قراءة ملف الملحق أو مجلده.', install: 'تعذر حفظ الملحق. تم الاحتفاظ بالتثبيت السابق عند نجاح الاستعادة.', runtime: 'بيئة قرارات الملحق مفقودة أو تالفة. أعد تثبيت NextMux.', supported: 'المدعوم: {formats}، أو مجلد ملحق.' },
    hi: { format: 'यह प्लगइन फ़ाइल प्रकार समर्थित नहीं है।', corrupt: 'आर्काइव खराब है या असमर्थित संपीड़न का उपयोग करता है।', manifest: 'मान्य plugin.json या manifest.json आवश्यक है।', unsafe: 'प्लगइन में असुरक्षित पथ, लिंक, डुप्लिकेट या असमर्थित फ़ाइलें हैं।', limit: 'प्लगइन फ़ाइल संख्या या आकार सीमा से अधिक है।', read: 'प्लगइन फ़ाइल या फ़ोल्डर पढ़ा नहीं जा सका।', install: 'प्लगइन सहेजा नहीं जा सका। पुनर्प्राप्ति सफल होने पर पिछला इंस्टॉलेशन सुरक्षित है।', runtime: 'प्लगइन निर्णय रनटाइम गायब या खराब है। NextMux फिर से इंस्टॉल करें।', supported: 'समर्थित: {formats}, या प्लगइन फ़ोल्डर।' }
};

/** Package failures always explain both the problem and the formats the local installer accepts. */
export function appPluginPackageError(locale: NextMuxDesktopLocale, error: unknown): string | undefined {
    if (typeof error !== 'string') return undefined;
    const copy = packageCopy[locale] || packageCopy.en;
    if (error === 'plugin_runtime_unavailable') return copy.runtime;
    if (error === 'install_failed') return copy.install;
    if (error === 'plugin_file_invalid') return copy.read;
    const kind = error === 'package_format_unsupported' ? 'format'
        : ['package_manifest_missing', 'plugin_invalid', 'plugin.json'].includes(error) ? 'manifest'
            : ['package_size', 'package_files', 'package_file_size'].includes(error) ? 'limit'
                : ['package_path', 'package_link', 'package_duplicate', 'package_unexpected_file', 'package_not_png'].includes(error) ? 'unsafe'
                    : ['package_corrupt', 'package_not_zip', 'package_compression', 'package_encrypted', 'package_not_tar'].includes(error) ? 'corrupt'
                        : error === 'package_read_failed' ? 'read' : undefined;
    return kind ? `${copy[kind]} ${copy.supported.replace('{formats}', PACKAGE_FORMATS)}` : undefined;
}
