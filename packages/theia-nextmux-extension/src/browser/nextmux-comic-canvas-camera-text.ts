import { CAMERA_MOVES, CAMERA_PRESETS, CAMERA_SPEEDS, type CameraMoveId, type CameraPresetId, type CameraSelection, type CameraSpeedId } from '@nextmux/comic-core/canvas-camera';

export const CAMERA_CONTROL_LOCALES = ['zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'] as const;
const copy = {
    title: ['运镜控制','Camera movement','運鏡控制','カメラワーク','카메라 움직임','Movimiento de cámara','Mouvements de caméra','Kamerabewegung','Movimento de câmera','Движение камеры','حركة الكاميرا','कैमरा मूवमेंट'],
    presets: ['预设','Presets','預設','プリセット','프리셋','Preajustes','Préréglages','Vorlagen','Predefinições','Пресеты','إعدادات جاهزة','प्रीसेट'],
    custom: ['自定义运镜','Custom movement','自訂運鏡','カスタムカメラワーク','사용자 지정 움직임','Movimiento personalizado','Mouvement personnalisé','Eigene Bewegung','Movimento personalizado','Своя траектория','حركة مخصصة','कस्टम मूवमेंट'],
    zoom: ['缩放','Zoom','縮放','ズーム','줌','Zoom','Zoom','Zoom','Zoom','Масштаб','تقريب','ज़ूम'],
    horizontal: ['横向','Horizontal','橫向','水平','가로','Horizontal','Horizontal','Horizontal','Horizontal','По горизонтали','أفقي','क्षैतिज'],
    vertical: ['纵向','Vertical','縱向','垂直','세로','Vertical','Vertical','Vertikal','Vertical','По вертикали','عمودي','लंबवत'],
    special: ['特效','Special','特效','特殊','특수','Especial','Spécial','Spezial','Especial','Особые','خاص','विशेष'],
    speed: ['速度','Speed','速度','速度','속도','Velocidad','Vitesse','Tempo','Velocidade','Скорость','السرعة','गति'],
    hint: ['运镜将添加到提示词开头','Camera instructions are added before the prompt','運鏡將加入提示詞開頭','カメラ指示はプロンプトの先頭に追加されます','카메라 지시가 프롬프트 앞에 추가됩니다','Las instrucciones de cámara preceden al prompt','Les mouvements précèdent le prompt','Kameraanweisungen stehen vor dem Prompt','As instruções de câmera precedem o prompt','Указания камеры добавляются перед промптом','تُضاف تعليمات الكاميرا قبل النص','कैमरा निर्देश प्रॉम्प्ट से पहले जोड़े जाते हैं'],
    confirm: ['确定','Confirm','確定','確定','확인','Confirmar','Confirmer','Bestätigen','Confirmar','Применить','تأكيد','पुष्टि करें'],
    close: ['关闭运镜选择','Close camera selection','關閉運鏡選擇','カメラ選択を閉じる','카메라 선택 닫기','Cerrar selección de cámara','Fermer le choix de caméra','Kameraauswahl schließen','Fechar seleção de câmera','Закрыть выбор камеры','إغلاق اختيار الكاميرا','कैमरा चयन बंद करें'],
    clear: ['清空运镜','Clear camera movement','清空運鏡','カメラワークをクリア','카메라 움직임 지우기','Borrar movimiento','Effacer les mouvements','Bewegung löschen','Limpar movimento','Убрать движения','مسح حركة الكاميرا','कैमरा मूवमेंट हटाएँ'],
    remove: ['移除','Remove','移除','削除','제거','Quitar','Retirer','Entfernen','Remover','Убрать','إزالة','हटाएँ'],
    resetSpeed: ['恢复正常速度','Reset to normal speed','恢復正常速度','通常速度に戻す','보통 속도로 재설정','Restablecer velocidad normal','Rétablir la vitesse normale','Normales Tempo wiederherstellen','Restaurar velocidade normal','Вернуть обычную скорость','استعادة السرعة العادية','सामान्य गति बहाल करें']
} as const;

// Positional tables follow the stable core catalogs. Tests enforce completeness for every supported locale.
const movementLabels: readonly (readonly string[])[] = [
    CAMERA_MOVES.map(item => item.label),
    'Zoom in|Zoom out|Push in|Pull out|Dolly zoom|Rack focus|Pan left|Pan right|Truck left|Truck right|Arc left|Arc right|Slide|Tilt up|Tilt down|Rise|Descend|Crane up|Crane down|Boom up|Boom down|Tracking|Orbit|Handheld|Stabilized|Whip pan|Roll|Static|Fly through|Aerial|First person|Over shoulder|Dutch angle|Low angle|High angle|Bird’s eye|Worm’s eye'.split('|'),
    '拉近|拉遠|推進|拉出|希區考克|焦點轉移|左搖|右搖|左移|右移|左弧|右弧|滑軌|上仰|下俯|升起|降落|搖臂升|搖臂降|吊臂升|吊臂降|跟蹤|環繞|手持|穩定器|甩鏡|翻滾|靜止|穿越|航拍|第一人稱|過肩|荷蘭角|低角度|高角度|鳥瞰|蟲視'.split('|'),
    'ズームイン|ズームアウト|前進|後退|ドリーズーム|ピント送り|左パン|右パン|左移動|右移動|左アーク|右アーク|スライド|上向き|下向き|上昇|下降|クレーン上昇|クレーン下降|ブーム上昇|ブーム下降|追跡|周回|手持ち|安定撮影|ウィップパン|回転|固定|通り抜け|空撮|一人称|肩越し|ダッチアングル|ローアングル|ハイアングル|真上から|地面から'.split('|'),
    '줌 인|줌 아웃|전진|후진|돌리 줌|초점 이동|왼쪽 팬|오른쪽 팬|왼쪽 이동|오른쪽 이동|왼쪽 원호|오른쪽 원호|슬라이드|위로 틸트|아래로 틸트|상승|하강|크레인 상승|크레인 하강|붐 상승|붐 하강|추적|궤도 회전|핸드헬드|안정 촬영|휩 팬|롤 회전|고정|통과|항공 촬영|1인칭|어깨 너머|더치 앵글|로우 앵글|하이 앵글|조감|지면 시점'.split('|'),
    'Acercar zoom|Alejar zoom|Avanzar|Retroceder|Zoom compensado|Cambiar foco|Paneo izquierdo|Paneo derecho|Desplazar izquierda|Desplazar derecha|Arco izquierdo|Arco derecho|Deslizamiento|Inclinar arriba|Inclinar abajo|Subir|Bajar|Grúa ascendente|Grúa descendente|Brazo ascendente|Brazo descendente|Seguimiento|Órbita|Cámara en mano|Estabilizada|Paneo rápido|Rotación|Estática|Atravesar|Aérea|Primera persona|Sobre el hombro|Ángulo holandés|Contrapicado|Picado|Cenital|A ras del suelo'.split('|'),
    'Zoom avant|Zoom arrière|Avancer|Reculer|Travelling compensé|Transfert de point|Panoramique gauche|Panoramique droit|Translation gauche|Translation droite|Arc gauche|Arc droit|Glissement|Incliner vers le haut|Incliner vers le bas|Monter|Descendre|Grue montante|Grue descendante|Bras montant|Bras descendant|Suivi|Orbite|Caméra à l’épaule|Stabilisée|Panoramique rapide|Roulis|Fixe|Traversée|Vue aérienne|Première personne|Par-dessus l’épaule|Plan incliné|Contre-plongée|Plongée|Vue du dessus|Au ras du sol'.split('|'),
    'Heranzoomen|Herauszoomen|Vorfahrt|Rückfahrt|Dolly-Zoom|Fokusverlagerung|Links schwenken|Rechts schwenken|Links fahren|Rechts fahren|Linksbogen|Rechtsbogen|Gleitfahrt|Nach oben neigen|Nach unten neigen|Anheben|Absenken|Kran aufwärts|Kran abwärts|Ausleger aufwärts|Ausleger abwärts|Verfolgen|Umkreisen|Handkamera|Stabilisiert|Reißschwenk|Rollen|Statisch|Durchflug|Luftaufnahme|Ich-Perspektive|Über die Schulter|Schrägsicht|Untersicht|Aufsicht|Vogelperspektive|Froschperspektive'.split('|'),
    'Aproximar zoom|Afastar zoom|Avançar|Recuar|Dolly zoom|Troca de foco|Panorâmica esquerda|Panorâmica direita|Deslocar esquerda|Deslocar direita|Arco esquerdo|Arco direito|Deslizar|Inclinar para cima|Inclinar para baixo|Subir|Descer|Grua subindo|Grua descendo|Braço subindo|Braço descendo|Acompanhamento|Órbita|Câmera na mão|Estabilizada|Panorâmica rápida|Rolagem|Estática|Atravessar|Aérea|Primeira pessoa|Sobre o ombro|Ângulo holandês|Ângulo baixo|Ângulo alto|Vista superior|Rente ao chão'.split('|'),
    'Приблизить|Отдалить|Наезд|Отъезд|Долли-зум|Перевод фокуса|Панорама влево|Панорама вправо|Сдвиг влево|Сдвиг вправо|Дуга влево|Дуга вправо|Скольжение|Наклон вверх|Наклон вниз|Подъём|Спуск|Кран вверх|Кран вниз|Стрела вверх|Стрела вниз|Слежение|Облёт|С рук|Стабилизатор|Резкая панорама|Вращение|Статика|Пролёт|Аэросъёмка|От первого лица|Через плечо|Голландский угол|Нижний ракурс|Верхний ракурс|Строго сверху|У земли'.split('|'),
    'تقريب|تبعيد|تقدم|تراجع|زوم دولي|نقل التركيز|تحريك لليسار|تحريك لليمين|انتقال لليسار|انتقال لليمين|قوس يسار|قوس يمين|انزلاق|إمالة لأعلى|إمالة لأسفل|ارتفاع|هبوط|رافعة لأعلى|رافعة لأسفل|ذراع لأعلى|ذراع لأسفل|تتبع|دوران حول الهدف|محمولة باليد|مثبتة|تحريك خاطف|التفاف|ثابتة|عبور|تصوير جوي|منظور الشخص الأول|فوق الكتف|زاوية مائلة|زاوية منخفضة|زاوية مرتفعة|من الأعلى مباشرة|قرب الأرض'.split('|'),
    'ज़ूम इन|ज़ूम आउट|आगे बढ़ें|पीछे हटें|डॉली ज़ूम|फ़ोकस बदलें|बाएँ पैन|दाएँ पैन|बाएँ खिसकें|दाएँ खिसकें|बायाँ चाप|दायाँ चाप|स्लाइड|ऊपर झुकाएँ|नीचे झुकाएँ|ऊपर उठें|नीचे उतरें|क्रेन ऊपर|क्रेन नीचे|बूम ऊपर|बूम नीचे|ट्रैकिंग|परिक्रमा|हैंडहेल्ड|स्थिर कैमरा गति|व्हिप पैन|रोल|स्थिर|आर-पार उड़ान|हवाई दृश्य|प्रथम व्यक्ति|कंधे के ऊपर|तिरछा कोण|निचला कोण|ऊँचा कोण|सीधे ऊपर से|ज़मीन के पास'.split('|')
];
const presetLabels: readonly (readonly string[])[] = [
    CAMERA_PRESETS.map(item => item.label),
    'Simple zoom in|Simple zoom out|Smooth pan|Gentle rise|Tracking shot|Aerial view|Cinematic opening|Dramatic reveal|Hero entrance|Mystery reveal|Intimate portrait|Action chase|Dynamic orbit|Fly through scene|Whip pan transition|Epic aerial|Smooth exploration|Documentary style|Dreamy float|First-person walk|Bird’s-eye reveal'.split('|'),
    '簡單拉近|簡單拉遠|平滑搖移|緩緩升起|跟蹤拍攝|航拍俯視|電影開場|戲劇揭示|英雄登場|懸疑揭秘|親密特寫|動作追逐|動態環繞|穿越場景|甩鏡轉場|史詩航拍|平滑探索|紀錄片風|夢幻漂浮|第一人稱|鳥瞰全景'.split('|'),
    'シンプルズームイン|シンプルズームアウト|滑らかなパン|緩やかな上昇|追跡撮影|俯瞰空撮|映画のオープニング|劇的な登場|ヒーロー登場|謎の解明|親密なポートレート|アクション追跡|ダイナミック周回|シーン通過|ウィップパン転換|壮大な空撮|滑らかな探索|ドキュメンタリー風|夢の浮遊|一人称の歩行|真上から全景'.split('|'),
    '간단한 줌 인|간단한 줌 아웃|부드러운 팬|느린 상승|추적 촬영|항공 부감|영화 오프닝|극적인 공개|영웅 등장|미스터리 공개|친밀한 인물 촬영|액션 추격|역동적인 궤도 회전|장면 통과|휩 팬 전환|웅장한 항공 촬영|부드러운 탐색|다큐멘터리 스타일|몽환적인 부유|1인칭 걷기|조감 전경'.split('|'),
    'Zoom de acercamiento|Zoom de alejamiento|Paneo suave|Ascenso suave|Plano de seguimiento|Vista aérea|Apertura cinematográfica|Revelación dramática|Entrada heroica|Revelación misteriosa|Retrato íntimo|Persecución de acción|Órbita dinámica|Atravesar la escena|Transición rápida|Aérea épica|Exploración suave|Estilo documental|Flotación onírica|Paseo en primera persona|Revelación cenital'.split('|'),
    'Zoom avant simple|Zoom arrière simple|Panoramique fluide|Montée douce|Plan de suivi|Vue aérienne|Ouverture cinéma|Révélation dramatique|Entrée du héros|Révélation mystérieuse|Portrait intime|Course-poursuite|Orbite dynamique|Traversée du décor|Transition rapide|Vue aérienne épique|Exploration fluide|Style documentaire|Flottement onirique|Marche subjective|Révélation du dessus'.split('|'),
    'Einfach heranzoomen|Einfach herauszoomen|Sanfter Schwenk|Sanfter Aufstieg|Verfolgungsaufnahme|Luftaufsicht|Filmauftakt|Dramatische Enthüllung|Heldenauftritt|Geheimnis enthüllen|Intimes Porträt|Action-Verfolgung|Dynamische Umkreisung|Szenendurchflug|Reißschwenk-Übergang|Epische Luftaufnahme|Sanfte Erkundung|Dokumentarstil|Traumhaftes Schweben|Spaziergang aus Ich-Sicht|Vogelblick-Enthüllung'.split('|'),
    'Zoom de aproximação|Zoom de afastamento|Panorâmica suave|Subida suave|Plano de acompanhamento|Vista aérea|Abertura cinematográfica|Revelação dramática|Entrada heroica|Revelação misteriosa|Retrato íntimo|Perseguição de ação|Órbita dinâmica|Atravessar a cena|Transição rápida|Aérea épica|Exploração suave|Estilo documental|Flutuação onírica|Caminhada em primeira pessoa|Revelação superior'.split('|'),
    'Простое приближение|Простое отдаление|Плавная панорама|Мягкий подъём|Следящая съёмка|Вид с воздуха|Кино-вступление|Драматичное раскрытие|Выход героя|Раскрытие тайны|Камерный портрет|Погоня|Динамичный облёт|Пролёт через сцену|Резкий переход|Эпическая аэросъёмка|Плавное исследование|Документальный стиль|Сказочное парение|Прогулка от первого лица|Раскрытие сверху'.split('|'),
    'تقريب بسيط|تبعيد بسيط|تحريك سلس|ارتفاع هادئ|لقطة تتبع|منظر جوي|افتتاح سينمائي|كشف درامي|دخول البطل|كشف الغموض|لقطة شخصية قريبة|مطاردة حركية|دوران ديناميكي|عبور المشهد|انتقال خاطف|تصوير جوي ملحمي|استكشاف سلس|أسلوب وثائقي|طفو حالم|مشي بمنظور الشخص الأول|كشف من الأعلى'.split('|'),
    'सरल ज़ूम इन|सरल ज़ूम आउट|सहज पैन|धीरे उठना|ट्रैकिंग शॉट|हवाई दृश्य|सिनेमाई शुरुआत|नाटकीय खुलासा|नायक का प्रवेश|रहस्य का खुलासा|अंतरंग पोर्ट्रेट|एक्शन पीछा|गतिशील परिक्रमा|दृश्य से गुज़रना|व्हिप पैन बदलाव|भव्य हवाई दृश्य|सहज खोज|डॉक्यूमेंट्री शैली|स्वप्निल तैराव|प्रथम व्यक्ति सैर|ऊपर से खुलासा'.split('|')
];
const speedLabels: readonly (readonly string[])[] = [
    CAMERA_SPEEDS.map(item => item.label), 'Very slow|Slow|Normal|Fast|Very fast'.split('|'), '極慢|慢速|正常|快速|極快'.split('|'),
    '非常に遅い|遅い|通常|速い|非常に速い'.split('|'), '매우 느림|느림|보통|빠름|매우 빠름'.split('|'),
    'Muy lenta|Lenta|Normal|Rápida|Muy rápida'.split('|'), 'Très lent|Lent|Normal|Rapide|Très rapide'.split('|'),
    'Sehr langsam|Langsam|Normal|Schnell|Sehr schnell'.split('|'), 'Muito lenta|Lenta|Normal|Rápida|Muito rápida'.split('|'),
    'Очень медленно|Медленно|Обычно|Быстро|Очень быстро'.split('|'), 'بطيئة جداً|بطيئة|عادية|سريعة|سريعة جداً'.split('|'),
    'बहुत धीमी|धीमी|सामान्य|तेज़|बहुत तेज़'.split('|')
];
function localeIndex(locale: string): number {
    const index = CAMERA_CONTROL_LOCALES.indexOf(locale as typeof CAMERA_CONTROL_LOCALES[number]);
    return index < 0 ? locale.startsWith('zh') ? 0 : 1 : index;
}
export function cameraControlText(locale: string, key: keyof typeof copy): string { return copy[key]?.[localeIndex(locale)] ?? String(key); }
export function cameraMoveLabel(locale: string, id: CameraMoveId): string { return movementLabels[localeIndex(locale)][CAMERA_MOVES.findIndex(item => item.id === id)] ?? id; }
export function cameraSpeedLabel(locale: string, id: CameraSpeedId): string { return speedLabels[localeIndex(locale)][CAMERA_SPEEDS.findIndex(item => item.id === id)] ?? id; }
export function cameraPresetLabel(locale: string, id: CameraPresetId): string { return presetLabels[localeIndex(locale)][CAMERA_PRESETS.findIndex(item => item.id === id)] ?? id; }
export function cameraSelectionLabel(locale: string, selection: CameraSelection): string {
    if (selection.presetId) return cameraPresetLabel(locale, selection.presetId)
        + (selection.speed === 'normal' ? '' : ` · ${cameraSpeedLabel(locale, selection.speed)}`);
    return [...selection.movements.map(id => cameraMoveLabel(locale, id)), ...(selection.speed === 'normal' ? [] : [cameraSpeedLabel(locale, selection.speed)])].join(' + ');
}
