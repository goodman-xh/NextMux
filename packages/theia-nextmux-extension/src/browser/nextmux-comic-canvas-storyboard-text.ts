/** 分镜栏 copy (node-loadable). A missing language falls back to English. */
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

type StoryboardBaseTextKey = 'title' | 'open' | 'count' | 'duration' | 'close' | 'from' | 'to' | 'up' | 'down' | 'remove' | 'focal' | 'aperture' | 'camera' | 'speed' | 'none' | 'custom'
    | 'foreground' | 'foregroundHint' | 'background' | 'backgroundHint' | 'requirements' | 'requirementsHint' | 'add' | 'reflow' | 'soundEffects' | 'music' | 'keepPlain'
    | 'notesHint' | 'cancel' | 'apply'
    | 'issue.duration' | 'issue.shot_count' | 'issue.shot_id' | 'issue.time' | 'issue.overlap' | 'issue.focal_length' | 'issue.aperture' | 'issue.camera' | 'issue.text' | 'issue.audio_notes' | 'issue.version';

const ZH: Record<StoryboardBaseTextKey, string> = {
    title: '分镜栏', open: '分镜', count: '{n}/{max} 个分镜', duration: '{n} 秒', close: '关闭', from: '从', to: '到', up: '上移', down: '下移', remove: '删除分镜',
    focal: '焦距', aperture: '光圈', camera: '运镜', speed: '速度', none: '不指定', custom: '自定义', foreground: '前景', foregroundHint: '前景',
    background: '远景', backgroundHint: '画面后方的环境', requirements: '要求', requirementsHint: '这一段的动作、表情和镜头要求', add: '添加分镜', reflow: '按顺序重排时间',
    soundEffects: '提示音效', music: '提示配乐', keepPlain: '保留原提示词', notesHint: '分镜会写进这段视频的提示词；音效和配乐只是提示，不改变声音设置。', cancel: '取消', apply: '写入提示词',
    'issue.duration': '视频时长无效', 'issue.shot_count': '分镜数量需在 1 到 8 个之间', 'issue.shot_id': '分镜编号重复', 'issue.time': '时间区间无效，需在视频时长内且起点早于终点',
    'issue.overlap': '和其他分镜的时间重叠', 'issue.focal_length': '焦距无效', 'issue.aperture': '光圈无效', 'issue.camera': '运镜无效', 'issue.text': '文字过长或含无效字符', 'issue.audio_notes': '音效配乐设置无效', 'issue.version': '分镜数据版本不支持'
};

const EN: Record<StoryboardBaseTextKey, string> = {
    title: 'Storyboard', open: 'Storyboard', count: '{n}/{max} shots', duration: '{n} s', close: 'Close', from: 'From', to: 'To', up: 'Move up', down: 'Move down', remove: 'Remove shot',
    focal: 'Lens', aperture: 'Aperture', camera: 'Camera', speed: 'Speed', none: 'Any', custom: 'Custom', foreground: 'Foreground', foregroundHint: 'Foreground',
    background: 'Background', backgroundHint: 'The setting behind', requirements: 'Direction', requirementsHint: 'Action, expression and framing for this part', add: 'Add a shot', reflow: 'Re-time in order',
    soundEffects: 'Note sound effects', music: 'Note music', keepPlain: 'Keep the original prompt', notesHint: 'The shots go into this clip’s prompt; sound and music are notes only and do not change the sound setting.', cancel: 'Cancel', apply: 'Write to prompt',
    'issue.duration': 'The clip duration is invalid', 'issue.shot_count': 'Use 1 to 8 shots', 'issue.shot_id': 'Duplicate shot id', 'issue.time': 'The time range must lie inside the clip, start before end',
    'issue.overlap': 'Overlaps another shot', 'issue.focal_length': 'Invalid lens', 'issue.aperture': 'Invalid aperture', 'issue.camera': 'Invalid camera move', 'issue.text': 'Text too long or invalid', 'issue.audio_notes': 'Invalid sound notes', 'issue.version': 'Unsupported storyboard version'
};

const ZH_TW: Record<StoryboardBaseTextKey, string> = {
    title: '分鏡欄', open: '分鏡', count: '{n}/{max} 個分鏡', duration: '{n} 秒', close: '關閉', from: '從', to: '到', up: '上移', down: '下移', remove: '刪除分鏡',
    focal: '焦距', aperture: '光圈', camera: '運鏡', speed: '速度', none: '不指定', custom: '自訂', foreground: '前景', foregroundHint: '前景',
    background: '遠景', backgroundHint: '畫面後方的環境', requirements: '要求', requirementsHint: '這一段的動作、表情和鏡頭要求', add: '新增分鏡', reflow: '依順序重排時間',
    soundEffects: '提示音效', music: '提示配樂', keepPlain: '保留原提示詞', notesHint: '分鏡會寫進這段影片的提示詞；音效和配樂只是提示，不會變更聲音設定。', cancel: '取消', apply: '寫入提示詞',
    'issue.duration': '影片時長無效', 'issue.shot_count': '分鏡數量須介於 1 至 8 個', 'issue.shot_id': '分鏡編號重複', 'issue.time': '時間區間須在影片時長內，且起點須早於終點',
    'issue.overlap': '與其他分鏡的時間重疊', 'issue.focal_length': '焦距無效', 'issue.aperture': '光圈無效', 'issue.camera': '運鏡無效', 'issue.text': '文字過長或含有無效字元', 'issue.audio_notes': '音效配樂設定無效', 'issue.version': '不支援此分鏡資料版本'
};

const JA: Record<StoryboardBaseTextKey, string> = {
    title: '絵コンテ', open: '絵コンテ', count: '{n}/{max} ショット', duration: '{n} 秒', close: '閉じる', from: '開始', to: '終了', up: '上へ', down: '下へ', remove: 'ショットを削除',
    focal: '焦点距離', aperture: '絞り', camera: 'カメラワーク', speed: '速度', none: '指定なし', custom: 'カスタム', foreground: '前景', foregroundHint: '前景',
    background: '背景', backgroundHint: '奥に見える場所や環境', requirements: '演出', requirementsHint: 'この部分の動作、表情、構図の指定', add: 'ショットを追加', reflow: '順番に時間を振り直す',
    soundEffects: '効果音を指定', music: '音楽を指定', keepPlain: '元のプロンプトを残す', notesHint: 'ショットはこの動画のプロンプトに追加されます。効果音と音楽は指示のみで、音声設定は変更しません。', cancel: 'キャンセル', apply: 'プロンプトに反映',
    'issue.duration': '動画の長さが無効です', 'issue.shot_count': 'ショット数は1〜8にしてください', 'issue.shot_id': 'ショット番号が重複しています', 'issue.time': '時間範囲は動画内に収め、開始を終了より前にしてください',
    'issue.overlap': '他のショットと時間が重複しています', 'issue.focal_length': '焦点距離が無効です', 'issue.aperture': '絞りが無効です', 'issue.camera': 'カメラワークが無効です', 'issue.text': 'テキストが長すぎるか、無効な文字が含まれています', 'issue.audio_notes': '効果音・音楽の指定が無効です', 'issue.version': 'この絵コンテのデータ形式には対応していません'
};

const KO: Record<StoryboardBaseTextKey, string> = {
    title: '스토리보드', open: '스토리보드', count: '{n}/{max}개 숏', duration: '{n}초', close: '닫기', from: '시작', to: '끝', up: '위로', down: '아래로', remove: '숏 삭제',
    focal: '초점 거리', aperture: '조리개', camera: '카메라 움직임', speed: '속도', none: '지정 안 함', custom: '직접 설정', foreground: '전경', foregroundHint: '전경',
    background: '배경', backgroundHint: '화면 뒤쪽의 장소나 환경', requirements: '연출', requirementsHint: '이 부분의 동작, 표정, 구도 지시', add: '숏 추가', reflow: '순서대로 시간 재배치',
    soundEffects: '효과음 지시', music: '음악 지시', keepPlain: '원래 프롬프트 유지', notesHint: '숏은 이 영상의 프롬프트에 추가됩니다. 효과음과 음악은 지시만 추가하며 소리 설정은 바꾸지 않습니다.', cancel: '취소', apply: '프롬프트에 반영',
    'issue.duration': '영상 길이가 올바르지 않습니다', 'issue.shot_count': '숏 수는 1~8개여야 합니다', 'issue.shot_id': '숏 번호가 중복되었습니다', 'issue.time': '시간 범위는 영상 안에 있어야 하며 시작이 끝보다 빨라야 합니다',
    'issue.overlap': '다른 숏과 시간이 겹칩니다', 'issue.focal_length': '초점 거리가 올바르지 않습니다', 'issue.aperture': '조리개가 올바르지 않습니다', 'issue.camera': '카메라 움직임이 올바르지 않습니다', 'issue.text': '텍스트가 너무 길거나 올바르지 않은 문자가 있습니다', 'issue.audio_notes': '효과음·음악 지시가 올바르지 않습니다', 'issue.version': '지원하지 않는 스토리보드 데이터 버전입니다'
};

const ES: Record<StoryboardBaseTextKey, string> = {
    title: 'Guion gráfico', open: 'Guion gráfico', count: '{n}/{max} tomas', duration: '{n} s', close: 'Cerrar', from: 'Desde', to: 'Hasta', up: 'Subir', down: 'Bajar', remove: 'Eliminar toma',
    focal: 'Distancia focal', aperture: 'Apertura', camera: 'Movimiento de cámara', speed: 'Velocidad', none: 'Sin especificar', custom: 'Personalizado', foreground: 'Primer plano', foregroundHint: 'Primer plano',
    background: 'Fondo', backgroundHint: 'El entorno que aparece detrás', requirements: 'Indicaciones', requirementsHint: 'Acción, expresión y encuadre de esta parte', add: 'Añadir toma', reflow: 'Reordenar tiempos',
    soundEffects: 'Indicar efectos de sonido', music: 'Indicar música', keepPlain: 'Conservar la descripción original', notesHint: 'Las tomas se añaden a la descripción de este vídeo. Los efectos de sonido y la música son solo indicaciones y no cambian el ajuste de sonido.', cancel: 'Cancelar', apply: 'Añadir a la descripción',
    'issue.duration': 'La duración del vídeo no es válida', 'issue.shot_count': 'Usa entre 1 y 8 tomas', 'issue.shot_id': 'Número de toma duplicado', 'issue.time': 'El intervalo debe estar dentro del vídeo y empezar antes de terminar',
    'issue.overlap': 'El tiempo se solapa con otra toma', 'issue.focal_length': 'Distancia focal no válida', 'issue.aperture': 'Apertura no válida', 'issue.camera': 'Movimiento de cámara no válido', 'issue.text': 'El texto es demasiado largo o contiene caracteres no válidos', 'issue.audio_notes': 'Las indicaciones de sonido y música no son válidas', 'issue.version': 'Versión de datos del guion gráfico no compatible'
};

const FR: Record<StoryboardBaseTextKey, string> = {
    title: 'Storyboard', open: 'Storyboard', count: '{n}/{max} plans', duration: '{n} s', close: 'Fermer', from: 'Début', to: 'Fin', up: 'Monter', down: 'Descendre', remove: 'Supprimer le plan',
    focal: 'Focale', aperture: 'Ouverture', camera: 'Mouvement de caméra', speed: 'Vitesse', none: 'Non précisé', custom: 'Personnalisé', foreground: 'Premier plan', foregroundHint: 'Premier plan',
    background: 'Arrière-plan', backgroundHint: 'Le décor visible derrière', requirements: 'Consignes', requirementsHint: 'Action, expression et cadrage pour cette partie', add: 'Ajouter un plan', reflow: 'Recaler les temps',
    soundEffects: 'Indiquer les effets sonores', music: 'Indiquer la musique', keepPlain: 'Garder la description d’origine', notesHint: 'Les plans sont ajoutés à la description de cette vidéo. Les effets sonores et la musique sont de simples consignes et ne modifient pas le réglage du son.', cancel: 'Annuler', apply: 'Ajouter à la description',
    'issue.duration': 'La durée de la vidéo est invalide', 'issue.shot_count': 'Utilisez entre 1 et 8 plans', 'issue.shot_id': 'Numéro de plan en double', 'issue.time': 'L’intervalle doit rester dans la vidéo, avec un début antérieur à la fin',
    'issue.overlap': 'L’intervalle chevauche celui d’un autre plan', 'issue.focal_length': 'Focale invalide', 'issue.aperture': 'Ouverture invalide', 'issue.camera': 'Mouvement de caméra invalide', 'issue.text': 'Le texte est trop long ou contient des caractères invalides', 'issue.audio_notes': 'Les consignes de son et de musique sont invalides', 'issue.version': 'Version des données du storyboard non prise en charge'
};

const DE: Record<StoryboardBaseTextKey, string> = {
    title: 'Storyboard', open: 'Storyboard', count: '{n}/{max} Einstellungen', duration: '{n} s', close: 'Schließen', from: 'Von', to: 'Bis', up: 'Nach oben', down: 'Nach unten', remove: 'Einstellung löschen',
    focal: 'Brennweite', aperture: 'Blende', camera: 'Kamerabewegung', speed: 'Geschwindigkeit', none: 'Keine Vorgabe', custom: 'Benutzerdefiniert', foreground: 'Vordergrund', foregroundHint: 'Vordergrund',
    background: 'Hintergrund', backgroundHint: 'Die Umgebung hinter dem Motiv', requirements: 'Vorgaben', requirementsHint: 'Handlung, Ausdruck und Bildausschnitt für diesen Teil', add: 'Einstellung hinzufügen', reflow: 'Zeiten neu anordnen',
    soundEffects: 'Toneffekte vorgeben', music: 'Musik vorgeben', keepPlain: 'Ursprüngliche Beschreibung behalten', notesHint: 'Die Einstellungen werden der Beschreibung dieses Videos hinzugefügt. Toneffekte und Musik sind nur Vorgaben und ändern die Toneinstellung nicht.', cancel: 'Abbrechen', apply: 'In Beschreibung übernehmen',
    'issue.duration': 'Die Videodauer ist ungültig', 'issue.shot_count': 'Verwende 1 bis 8 Einstellungen', 'issue.shot_id': 'Doppelte Einstellungsnummer', 'issue.time': 'Der Zeitraum muss innerhalb des Videos liegen; der Beginn muss vor dem Ende liegen',
    'issue.overlap': 'Der Zeitraum überschneidet sich mit einer anderen Einstellung', 'issue.focal_length': 'Ungültige Brennweite', 'issue.aperture': 'Ungültige Blende', 'issue.camera': 'Ungültige Kamerabewegung', 'issue.text': 'Der Text ist zu lang oder enthält ungültige Zeichen', 'issue.audio_notes': 'Ungültige Ton- und Musikvorgaben', 'issue.version': 'Diese Version der Storyboard-Daten wird nicht unterstützt'
};

const PT_BR: Record<StoryboardBaseTextKey, string> = {
    title: 'Storyboard', open: 'Storyboard', count: '{n}/{max} planos', duration: '{n} s', close: 'Fechar', from: 'De', to: 'Até', up: 'Subir', down: 'Descer', remove: 'Remover plano',
    focal: 'Distância focal', aperture: 'Abertura', camera: 'Movimento de câmera', speed: 'Velocidade', none: 'Sem especificar', custom: 'Personalizado', foreground: 'Primeiro plano', foregroundHint: 'Primeiro plano',
    background: 'Fundo', backgroundHint: 'O ambiente que aparece atrás', requirements: 'Orientações', requirementsHint: 'Ação, expressão e enquadramento desta parte', add: 'Adicionar plano', reflow: 'Reordenar tempos',
    soundEffects: 'Indicar efeitos sonoros', music: 'Indicar música', keepPlain: 'Manter a descrição original', notesHint: 'Os planos são adicionados à descrição deste vídeo. Os efeitos sonoros e a música são apenas orientações e não alteram a configuração de som.', cancel: 'Cancelar', apply: 'Adicionar à descrição',
    'issue.duration': 'A duração do vídeo é inválida', 'issue.shot_count': 'Use de 1 a 8 planos', 'issue.shot_id': 'Número de plano duplicado', 'issue.time': 'O intervalo deve estar dentro do vídeo e começar antes de terminar',
    'issue.overlap': 'O intervalo se sobrepõe ao de outro plano', 'issue.focal_length': 'Distância focal inválida', 'issue.aperture': 'Abertura inválida', 'issue.camera': 'Movimento de câmera inválido', 'issue.text': 'O texto é longo demais ou contém caracteres inválidos', 'issue.audio_notes': 'As orientações de som e música são inválidas', 'issue.version': 'Versão dos dados do storyboard não suportada'
};

const RU: Record<StoryboardBaseTextKey, string> = {
    title: 'Раскадровка', open: 'Раскадровка', count: '{n}/{max} кадров', duration: '{n} с', close: 'Закрыть', from: 'От', to: 'До', up: 'Выше', down: 'Ниже', remove: 'Удалить кадр',
    focal: 'Фокусное расстояние', aperture: 'Диафрагма', camera: 'Движение камеры', speed: 'Скорость', none: 'Не задано', custom: 'Своё значение', foreground: 'Передний план', foregroundHint: 'Передний план',
    background: 'Задний план', backgroundHint: 'Окружение позади', requirements: 'Указания', requirementsHint: 'Действие, выражение лица и композиция этой части', add: 'Добавить кадр', reflow: 'Пересчитать время по порядку',
    soundEffects: 'Указать звуковые эффекты', music: 'Указать музыку', keepPlain: 'Сохранить исходное описание', notesHint: 'Кадры добавляются в описание этого видео. Звуковые эффекты и музыка служат лишь указаниями и не меняют настройку звука.', cancel: 'Отмена', apply: 'Добавить в описание',
    'issue.duration': 'Недопустимая длительность видео', 'issue.shot_count': 'Укажите от 1 до 8 кадров', 'issue.shot_id': 'Повторяется номер кадра', 'issue.time': 'Интервал должен находиться внутри видео, а начало — предшествовать концу',
    'issue.overlap': 'Интервал пересекается с другим кадром', 'issue.focal_length': 'Недопустимое фокусное расстояние', 'issue.aperture': 'Недопустимая диафрагма', 'issue.camera': 'Недопустимое движение камеры', 'issue.text': 'Текст слишком длинный или содержит недопустимые символы', 'issue.audio_notes': 'Недопустимые указания для звука и музыки', 'issue.version': 'Эта версия данных раскадровки не поддерживается'
};

const AR: Record<StoryboardBaseTextKey, string> = {
    title: 'لوحة القصة', open: 'لوحة القصة', count: '{n}/{max} لقطات', duration: '{n} ث', close: 'إغلاق', from: 'من', to: 'إلى', up: 'لأعلى', down: 'لأسفل', remove: 'حذف اللقطة',
    focal: 'البعد البؤري', aperture: 'فتحة العدسة', camera: 'حركة الكاميرا', speed: 'السرعة', none: 'غير محدد', custom: 'مخصص', foreground: 'المقدمة', foregroundHint: 'المقدمة',
    background: 'الخلفية', backgroundHint: 'المكان أو البيئة خلف العناصر الأمامية', requirements: 'التوجيهات', requirementsHint: 'الحركة والتعبير وتكوين الصورة في هذا الجزء', add: 'إضافة لقطة', reflow: 'ترتيب الأوقات بالتتابع',
    soundEffects: 'وصف المؤثرات الصوتية', music: 'وصف الموسيقى', keepPlain: 'الإبقاء على الوصف الأصلي', notesHint: 'تُضاف اللقطات إلى وصف هذا الفيديو. المؤثرات الصوتية والموسيقى مجرد توجيهات ولا تغيّر إعداد الصوت.', cancel: 'إلغاء', apply: 'إضافة إلى الوصف',
    'issue.duration': 'مدة الفيديو غير صالحة', 'issue.shot_count': 'استخدم من 1 إلى 8 لقطات', 'issue.shot_id': 'رقم اللقطة مكرر', 'issue.time': 'يجب أن تكون الفترة داخل مدة الفيديو وأن تسبق بدايتها نهايتها',
    'issue.overlap': 'تتداخل الفترة مع لقطة أخرى', 'issue.focal_length': 'البعد البؤري غير صالح', 'issue.aperture': 'فتحة العدسة غير صالحة', 'issue.camera': 'حركة الكاميرا غير صالحة', 'issue.text': 'النص طويل جدًا أو يحتوي على أحرف غير صالحة', 'issue.audio_notes': 'توجيهات الصوت والموسيقى غير صالحة', 'issue.version': 'إصدار بيانات لوحة القصة غير مدعوم'
};

const HI: Record<StoryboardBaseTextKey, string> = {
    title: 'स्टोरीबोर्ड', open: 'स्टोरीबोर्ड', count: '{n}/{max} शॉट', duration: '{n} से.', close: 'बंद करें', from: 'से', to: 'तक', up: 'ऊपर करें', down: 'नीचे करें', remove: 'शॉट हटाएँ',
    focal: 'फ़ोकल लंबाई', aperture: 'अपर्चर', camera: 'कैमरे की गति', speed: 'गति', none: 'तय नहीं', custom: 'अपना मान', foreground: 'अग्रभूमि', foregroundHint: 'अग्रभूमि',
    background: 'पृष्ठभूमि', backgroundHint: 'पीछे दिख रहा स्थान या माहौल', requirements: 'निर्देश', requirementsHint: 'इस हिस्से की क्रिया, हावभाव और फ़्रेमिंग के निर्देश', add: 'शॉट जोड़ें', reflow: 'समय क्रम से बाँटें',
    soundEffects: 'ध्वनि प्रभाव बताएँ', music: 'संगीत बताएँ', keepPlain: 'मूल प्रॉम्प्ट बनाए रखें', notesHint: 'शॉट इस वीडियो के प्रॉम्प्ट में जोड़े जाएँगे। ध्वनि प्रभाव और संगीत केवल निर्देश हैं; इनसे आवाज़ की सेटिंग नहीं बदलेगी।', cancel: 'रद्द करें', apply: 'प्रॉम्प्ट में लिखें',
    'issue.duration': 'वीडियो की अवधि अमान्य है', 'issue.shot_count': '1 से 8 शॉट रखें', 'issue.shot_id': 'शॉट का नंबर दोहराया गया है', 'issue.time': 'समय सीमा वीडियो के भीतर होनी चाहिए और शुरुआत अंत से पहले होनी चाहिए',
    'issue.overlap': 'समय किसी दूसरे शॉट से टकराता है', 'issue.focal_length': 'फ़ोकल लंबाई अमान्य है', 'issue.aperture': 'अपर्चर अमान्य है', 'issue.camera': 'कैमरे की गति अमान्य है', 'issue.text': 'टेक्स्ट बहुत लंबा है या उसमें अमान्य अक्षर हैं', 'issue.audio_notes': 'ध्वनि और संगीत के निर्देश अमान्य हैं', 'issue.version': 'स्टोरीबोर्ड डेटा का यह संस्करण समर्थित नहीं है'
};

const TEXT: Readonly<Record<string, Readonly<Record<StoryboardBaseTextKey, string>>>> = { 'zh-CN': ZH, 'zh-TW': ZH_TW, en: EN, ja: JA, ko: KO, es: ES, fr: FR, de: DE, 'pt-BR': PT_BR, ru: RU, ar: AR, hi: HI };
export const COMIC_CANVAS_STORYBOARD_LOCALES = Object.keys(TEXT);


type StoryboardLayoutTextKey = 'dialogTitle' | 'subtitle' | 'shot' | 'range' | 'clearTime' | 'drag' | 'references' | 'other' | 'chooseCamera' | 'noTime' | 'soundLabel' | 'musicLabel' | 'confirm' | 'guidance';
export type StoryboardTextKey = StoryboardBaseTextKey | StoryboardLayoutTextKey;
const LAYOUT_TEXT: Readonly<Record<string, Readonly<Record<StoryboardLayoutTextKey, string>>>> = {
    "zh-CN": {
        "dialogTitle": "分镜栏编辑",
        "subtitle": "编排镜头内容、时间区间与拍摄参数",
        "shot": "分镜 {n}",
        "range": "时间区间",
        "clearTime": "清除时间区间",
        "drag": "拖拽排序，也可用上下方向键调整顺序",
        "references": "参考素材",
        "other": "其它",
        "chooseCamera": "选择运镜",
        "noTime": "没有剩余时间，请先缩短或清除已有分镜时间区间",
        "soundLabel": "音效",
        "musicLabel": "BGM",
        "confirm": "确定",
        "guidance": "1、无字幕，视频全程无字幕，无任何文字。\n2、视频中的人物光线根据环境光设定，不要单独给任何光源。\n3、注意人的头发要根据身体运动而运动，可以遮住人物部分脸。\n4、所有镜头的人物位置关系以及人物和环境的关系要有正确的合理性和连贯性！"
    },
    "en": {
        "dialogTitle": "Edit storyboard",
        "subtitle": "Arrange shot content, time ranges and camera settings",
        "shot": "Shot {n}",
        "range": "Time range",
        "clearTime": "Clear time range",
        "drag": "Drag to reorder, or use the up and down arrow keys",
        "references": "References",
        "other": "Other",
        "chooseCamera": "Choose camera movement",
        "noTime": "No time remains. Shorten or clear an existing shot’s time range first.",
        "soundLabel": "Sound effects",
        "musicLabel": "BGM",
        "confirm": "Confirm",
        "guidance": "1. No subtitles or visible text throughout the video.\n2. Light characters according to the environment; do not add separate light sources.\n3. Hair should move with the body and may partially cover the face.\n4. Keep character positions and their relationship to the environment plausible and consistent across shots."
    },
    "zh-TW": {
        "dialogTitle": "分鏡欄編輯",
        "subtitle": "編排鏡頭內容、時間區間與拍攝參數",
        "shot": "分鏡 {n}",
        "range": "時間區間",
        "clearTime": "清除時間區間",
        "drag": "拖曳排序，也可用上下方向鍵調整順序",
        "references": "參考素材",
        "other": "其它",
        "chooseCamera": "選擇運鏡",
        "noTime": "沒有剩餘時間，請先縮短或清除已有分鏡時間區間",
        "soundLabel": "音效",
        "musicLabel": "BGM",
        "confirm": "確定",
        "guidance": "1、全程不要字幕或任何文字。\n2、人物光線依環境光設定，不要另外加入光源。\n3、頭髮應隨身體運動，可遮住部分臉部。\n4、各鏡頭的人物位置與環境關係須合理且連貫。"
    },
    "ja": {
        "dialogTitle": "絵コンテを編集",
        "subtitle": "ショットの内容、時間範囲、撮影設定を調整",
        "shot": "ショット {n}",
        "range": "時間範囲",
        "clearTime": "時間範囲を解除",
        "drag": "ドラッグ、または上下キーで並べ替え",
        "references": "参考素材",
        "other": "その他",
        "chooseCamera": "カメラワークを選択",
        "noTime": "残り時間がありません。既存の時間範囲を短くするか解除してください。",
        "soundLabel": "効果音",
        "musicLabel": "BGM",
        "confirm": "確定",
        "guidance": "1. 動画全体に字幕や文字を入れない。\n2. 人物の照明は環境光に合わせ、別の光源を加えない。\n3. 髪は体の動きに合わせて動き、顔の一部を覆ってもよい。\n4. 各ショットの人物の位置と環境との関係を自然で一貫したものにする。"
    },
    "ko": {
        "dialogTitle": "스토리보드 편집",
        "subtitle": "숏 내용, 시간 범위와 촬영 설정 편집",
        "shot": "숏 {n}",
        "range": "시간 범위",
        "clearTime": "시간 범위 지우기",
        "drag": "드래그하거나 위아래 화살표 키로 순서 변경",
        "references": "참고 자료",
        "other": "기타",
        "chooseCamera": "카메라 움직임 선택",
        "noTime": "남은 시간이 없습니다. 기존 숏의 시간 범위를 줄이거나 지우세요.",
        "soundLabel": "효과음",
        "musicLabel": "BGM",
        "confirm": "확인",
        "guidance": "1. 영상 전체에 자막이나 문자를 넣지 않습니다.\n2. 인물 조명은 환경광에 맞추고 별도 광원을 추가하지 않습니다.\n3. 머리카락은 몸의 움직임에 따라 움직이며 얼굴 일부를 가려도 됩니다.\n4. 모든 숏에서 인물 위치와 환경의 관계가 자연스럽고 일관되게 유지되어야 합니다."
    },
    "es": {
        "dialogTitle": "Editar guion gráfico",
        "subtitle": "Organiza las tomas, sus tiempos y los ajustes de cámara",
        "shot": "Toma {n}",
        "range": "Intervalo",
        "clearTime": "Borrar intervalo",
        "drag": "Arrastra o usa las flechas arriba y abajo para reordenar",
        "references": "Referencias",
        "other": "Otros",
        "chooseCamera": "Elegir movimiento",
        "noTime": "No queda tiempo. Acorta o borra primero un intervalo existente.",
        "soundLabel": "Efectos de sonido",
        "musicLabel": "BGM",
        "confirm": "Confirmar",
        "guidance": "1. Sin subtítulos ni texto visible durante el vídeo.\n2. Ilumina a los personajes según el ambiente, sin luces independientes.\n3. El cabello debe acompañar el movimiento corporal y puede cubrir parte del rostro.\n4. Mantén posiciones y relaciones con el entorno plausibles y coherentes entre tomas."
    },
    "fr": {
        "dialogTitle": "Modifier le storyboard",
        "subtitle": "Organisez les plans, leurs durées et les réglages de prise de vue",
        "shot": "Plan {n}",
        "range": "Intervalle",
        "clearTime": "Effacer l’intervalle",
        "drag": "Glissez ou utilisez les flèches haut et bas pour réordonner",
        "references": "Références",
        "other": "Autres",
        "chooseCamera": "Choisir un mouvement",
        "noTime": "Il ne reste plus de temps. Réduisez ou effacez un intervalle existant.",
        "soundLabel": "Effets sonores",
        "musicLabel": "BGM",
        "confirm": "Confirmer",
        "guidance": "1. Aucun sous-titre ni texte visible dans la vidéo.\n2. Éclairez les personnages selon la lumière ambiante, sans source distincte.\n3. Les cheveux suivent le corps et peuvent masquer une partie du visage.\n4. Gardez des positions et des rapports avec le décor plausibles et cohérents entre les plans."
    },
    "de": {
        "dialogTitle": "Storyboard bearbeiten",
        "subtitle": "Inhalte, Zeitbereiche und Kameraeinstellungen planen",
        "shot": "Einstellung {n}",
        "range": "Zeitbereich",
        "clearTime": "Zeitbereich löschen",
        "drag": "Ziehen oder mit den Pfeiltasten nach oben und unten verschieben",
        "references": "Referenzen",
        "other": "Sonstiges",
        "chooseCamera": "Kamerabewegung wählen",
        "noTime": "Keine Zeit übrig. Zuerst einen vorhandenen Zeitbereich kürzen oder löschen.",
        "soundLabel": "Toneffekte",
        "musicLabel": "BGM",
        "confirm": "Bestätigen",
        "guidance": "1. Keine Untertitel oder sichtbarer Text im gesamten Video.\n2. Figuren entsprechend dem Umgebungslicht beleuchten, ohne separate Lichtquellen.\n3. Haare folgen der Körperbewegung und dürfen Teile des Gesichts verdecken.\n4. Positionen und Beziehungen zur Umgebung über alle Einstellungen plausibel und konsistent halten."
    },
    "pt-BR": {
        "dialogTitle": "Editar storyboard",
        "subtitle": "Organize cenas, intervalos e configurações de câmera",
        "shot": "Plano {n}",
        "range": "Intervalo",
        "clearTime": "Limpar intervalo",
        "drag": "Arraste ou use as setas para cima e para baixo para reordenar",
        "references": "Referências",
        "other": "Outros",
        "chooseCamera": "Escolher movimento",
        "noTime": "Não há tempo restante. Reduza ou limpe um intervalo existente.",
        "soundLabel": "Efeitos sonoros",
        "musicLabel": "BGM",
        "confirm": "Confirmar",
        "guidance": "1. Sem legendas ou texto visível em todo o vídeo.\n2. Ilumine os personagens conforme o ambiente, sem fontes separadas.\n3. O cabelo acompanha o corpo e pode cobrir parte do rosto.\n4. Mantenha as posições e relações com o ambiente plausíveis e consistentes entre planos."
    },
    "ru": {
        "dialogTitle": "Редактор раскадровки",
        "subtitle": "Настройте содержание кадров, интервалы и параметры съёмки",
        "shot": "Кадр {n}",
        "range": "Интервал",
        "clearTime": "Очистить интервал",
        "drag": "Перетащите или используйте стрелки вверх и вниз для изменения порядка",
        "references": "Референсы",
        "other": "Прочее",
        "chooseCamera": "Выбрать движение",
        "noTime": "Свободного времени нет. Сократите или очистите существующий интервал.",
        "soundLabel": "Звуковые эффекты",
        "musicLabel": "BGM",
        "confirm": "Подтвердить",
        "guidance": "1. Никаких субтитров или видимого текста в видео.\n2. Освещение персонажей соответствует окружению, без отдельных источников света.\n3. Волосы движутся вместе с телом и могут частично закрывать лицо.\n4. Положение персонажей и связь с окружением должны быть правдоподобными и последовательными во всех кадрах."
    },
    "ar": {
        "dialogTitle": "تحرير لوحة القصة",
        "subtitle": "رتّب محتوى اللقطات والفترات الزمنية وإعدادات التصوير",
        "shot": "اللقطة {n}",
        "range": "الفترة الزمنية",
        "clearTime": "مسح الفترة الزمنية",
        "drag": "اسحب للترتيب أو استخدم سهمي الأعلى والأسفل",
        "references": "المراجع",
        "other": "أخرى",
        "chooseCamera": "اختر حركة الكاميرا",
        "noTime": "لا يوجد وقت متبقٍ. قصّر فترة موجودة أو امسحها أولاً.",
        "soundLabel": "مؤثرات صوتية",
        "musicLabel": "BGM",
        "confirm": "تأكيد",
        "guidance": "1. بدون ترجمة أو نص ظاهر طوال الفيديو.\n2. إضاءة الشخصيات حسب الإضاءة المحيطة دون مصادر منفصلة.\n3. يتحرك الشعر مع الجسم وقد يغطي جزءاً من الوجه.\n4. حافظ على مواضع الشخصيات وعلاقتها بالبيئة بصورة منطقية ومتسقة بين اللقطات."
    },
    "hi": {
        "dialogTitle": "स्टोरीबोर्ड संपादित करें",
        "subtitle": "शॉट की सामग्री, समय सीमा और कैमरा सेटिंग तय करें",
        "shot": "शॉट {n}",
        "range": "समय सीमा",
        "clearTime": "समय सीमा हटाएँ",
        "drag": "क्रम बदलने के लिए खींचें या ऊपर और नीचे की तीर कुंजियाँ दबाएँ",
        "references": "संदर्भ",
        "other": "अन्य",
        "chooseCamera": "कैमरा गति चुनें",
        "noTime": "समय शेष नहीं है। पहले किसी मौजूदा शॉट की समय सीमा घटाएँ या हटाएँ।",
        "soundLabel": "ध्वनि प्रभाव",
        "musicLabel": "BGM",
        "confirm": "पुष्टि करें",
        "guidance": "1. पूरे वीडियो में उपशीर्षक या दृश्य पाठ न हो।\n2. पात्रों की रोशनी परिवेश के अनुसार हो; अलग प्रकाश स्रोत न जोड़ें।\n3. बाल शरीर की गति के साथ हिलें और चेहरे का कुछ भाग ढक सकते हैं।\n4. सभी शॉट में पात्रों की स्थिति और परिवेश के साथ संबंध यथार्थपूर्ण और सुसंगत रखें।"
    }
};

function uncheckedStoryboardText(locale: string, key: StoryboardTextKey, values?: Readonly<Record<string, string | number>>): string {
    const language = locale.startsWith('zh') && locale !== 'zh-TW' ? 'zh-CN' : locale;
    const raw = LAYOUT_TEXT[language]?.[key as StoryboardLayoutTextKey] ?? TEXT[language]?.[key as StoryboardBaseTextKey];
    if (typeof raw !== 'string') throw new Error('missing');
    return raw.replace(/\{(\w+)\}/g, (match, name: string) => values && values[name] !== undefined ? String(values[name]) : match);
}

export function storyboardText(locale: string, key: StoryboardTextKey, ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedStoryboardText>>): string {
    return totalCopy(locale, key, language => uncheckedStoryboardText(language, key, ...rest));
}
