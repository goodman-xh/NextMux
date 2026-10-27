import type { NextMuxDesktopLocale } from './nextmux-locale';

const en = {
    timeline: 'Timeline', newTimeline: 'New edit from this canvas', choose: 'Choose video order',
    help: 'Choose a starting video, then a branch. Add another chain to append it. Only the selected paths enter this edit; existing edits stay unchanged.',
    start: 'Starting video', next: 'Next video', add: 'Add another chain', remove: 'Remove chain',
    stop: 'End here', empty: 'Choose a video', create: 'Create edit', cancel: 'Cancel',
    legacy: 'Keep existing edit', fromCanvas: 'Create from canvas', legacyHelp: 'This project has an existing edit. Keep its cuts, or create a separate edit from the canvas videos.',
    loading: 'Loading timeline…', source: 'Show source canvas', result: 'Export result'
};
const historyKeys = ['chooseSaved', 'open', 'deletedSource', 'source'] as const;
type Key = keyof typeof en | typeof historyKeys[number];
const historyRows: Record<string, readonly string[]> = {
    en: ['Choose a saved edit', 'Open edit', 'Source canvas deleted', 'Source'],
    'zh-CN': ['选择已有剪辑', '打开剪辑', '来源画布已删除', '来源'], 'zh-TW': ['選擇已有剪輯', '開啟剪輯', '來源畫布已刪除', '來源'],
    ja: ['保存済みの編集を選択', '編集を開く', '元のキャンバスは削除済み', '元のキャンバス'], ko: ['저장된 편집 선택', '편집 열기', '원본 캔버스가 삭제됨', '원본'],
    de: ['Gespeicherten Schnitt wählen', 'Schnitt öffnen', 'Quellleinwand gelöscht', 'Quelle'], fr: ['Choisir un montage enregistré', 'Ouvrir le montage', 'Canevas source supprimé', 'Source'],
    es: ['Elegir una edición guardada', 'Abrir edición', 'Lienzo de origen eliminado', 'Origen'], pt: ['Escolher edição salva', 'Abrir edição', 'Tela de origem excluída', 'Origem'],
    ru: ['Выберите сохранённый монтаж', 'Открыть монтаж', 'Исходный холст удалён', 'Источник'], ar: ['اختيار مونتاج محفوظ', 'فتح المونتاج', 'حُذفت اللوحة المصدر', 'المصدر'],
    hi: ['सहेजा गया संपादन चुनें', 'संपादन खोलें', 'मूल कैनवास हटाया गया', 'स्रोत']
};
const rows: Record<string, readonly string[]> = {
    'zh-CN': ['时间线','从当前画布新建剪辑','选择视频顺序','选择起点，再选择分支。添加其他链条可接在后面。只有选中路径会进入本次剪辑，已有剪辑保持不变。','起始视频','下一个视频','添加其他链条','移除链条','到这里结束','选择视频','创建剪辑','取消','保留已有剪辑','从画布新建','这个项目已有剪辑。可保留原有裁切，或用画布视频另建一份剪辑。','正在加载时间线…','查看来源画布','导出结果'],
    'zh-TW': ['時間軸','從目前畫布新增剪輯','選擇影片順序','選擇起點，再選擇分支。新增其他鏈條可接在後面。只有所選路徑會進入本次剪輯，已有剪輯保持不變。','起始影片','下一個影片','新增其他鏈條','移除鏈條','到這裡結束','選擇影片','建立剪輯','取消','保留已有剪輯','從畫布新增','這個專案已有剪輯。可保留原有裁切，或用畫布影片另建一份剪輯。','正在載入時間軸…','查看來源畫布','匯出結果'],
    ja: ['タイムライン','現在のキャンバスから新規編集','動画の順序を選択','開始動画と分岐を選びます。別のチェーンを追加すると後に続きます。選択した経路のみを読み込み、既存の編集は保持します。','開始動画','次の動画','別のチェーンを追加','チェーンを削除','ここで終了','動画を選択','編集を作成','キャンセル','既存の編集を保持','キャンバスから作成','既存の編集があります。カットを保持するか、キャンバスの動画で別の編集を作成できます。','タイムラインを読み込み中…','元のキャンバスを表示','書き出し結果'],
    ko: ['타임라인','현재 캔버스로 새 편집','영상 순서 선택','시작 영상과 분기를 선택하세요. 다른 체인을 추가하면 뒤에 이어집니다. 선택한 경로만 사용하며 기존 편집은 유지됩니다.','시작 영상','다음 영상','다른 체인 추가','체인 제거','여기서 끝내기','영상 선택','편집 만들기','취소','기존 편집 유지','캔버스에서 만들기','기존 편집이 있습니다. 기존 자르기를 유지하거나 캔버스 영상으로 별도 편집을 만들 수 있습니다.','타임라인 불러오는 중…','원본 캔버스 보기','내보내기 결과'],
    de: ['Zeitleiste','Neuer Schnitt aus dieser Leinwand','Videoreihenfolge wählen','Startvideo und Verzweigung wählen. Weitere Ketten werden angehängt. Nur gewählte Pfade werden übernommen; vorhandene Schnitte bleiben erhalten.','Startvideo','Nächstes Video','Weitere Kette hinzufügen','Kette entfernen','Hier beenden','Video wählen','Schnitt erstellen','Abbrechen','Vorhandenen Schnitt behalten','Aus Leinwand erstellen','Ein Schnitt ist vorhanden. Zuschnitte behalten oder einen separaten Schnitt aus den Leinwandvideos erstellen.','Zeitleiste wird geladen…','Quellleinwand anzeigen','Exportergebnis'],
    fr: ['Montage','Nouveau montage depuis ce canevas','Choisir l’ordre des vidéos','Choisissez une vidéo de départ puis une branche. Ajoutez une autre chaîne à la suite. Seuls les parcours choisis sont importés ; les montages existants sont conservés.','Vidéo de départ','Vidéo suivante','Ajouter une autre chaîne','Retirer la chaîne','Terminer ici','Choisir une vidéo','Créer le montage','Annuler','Conserver le montage existant','Créer depuis le canevas','Ce projet contient un montage. Conservez ses coupes ou créez un montage séparé à partir des vidéos du canevas.','Chargement du montage…','Afficher le canevas source','Résultat de l’export'],
    es: ['Línea de tiempo','Nueva edición desde este lienzo','Elegir orden de vídeos','Elige el vídeo inicial y una rama. Añade otra cadena al final. Solo se importan las rutas elegidas; las ediciones existentes se conservan.','Vídeo inicial','Vídeo siguiente','Añadir otra cadena','Quitar cadena','Terminar aquí','Elegir vídeo','Crear edición','Cancelar','Conservar edición existente','Crear desde el lienzo','El proyecto ya tiene una edición. Conserva sus cortes o crea otra con los vídeos del lienzo.','Cargando línea de tiempo…','Ver lienzo de origen','Resultado de exportación'],
    pt: ['Linha do tempo','Nova edição desta tela','Escolher ordem dos vídeos','Escolha o vídeo inicial e uma ramificação. Adicione outra cadeia ao final. Só os caminhos escolhidos são importados; as edições existentes são mantidas.','Vídeo inicial','Próximo vídeo','Adicionar outra cadeia','Remover cadeia','Terminar aqui','Escolher vídeo','Criar edição','Cancelar','Manter edição existente','Criar a partir da tela','O projeto já tem uma edição. Mantenha os cortes ou crie uma edição separada com os vídeos da tela.','Carregando linha do tempo…','Ver tela de origem','Resultado da exportação'],
    ru: ['Таймлайн','Новый монтаж из этого холста','Выберите порядок видео','Выберите начальное видео и ветку. Другую цепочку можно добавить в конец. Импортируются только выбранные пути; существующий монтаж сохраняется.','Начальное видео','Следующее видео','Добавить другую цепочку','Удалить цепочку','Закончить здесь','Выбрать видео','Создать монтаж','Отмена','Сохранить существующий монтаж','Создать из холста','В проекте уже есть монтаж. Сохраните его обрезку или создайте отдельный монтаж из видео на холсте.','Загрузка таймлайна…','Показать исходный холст','Результат экспорта'],
    ar: ['المخطط الزمني','مونتاج جديد من هذه اللوحة','اختيار ترتيب الفيديو','اختر فيديو البداية ثم الفرع. أضف سلسلة أخرى لإلحاقها. تُستورد المسارات المحددة فقط وتُحفظ عمليات المونتاج الموجودة.','فيديو البداية','الفيديو التالي','إضافة سلسلة أخرى','إزالة السلسلة','إنهاء هنا','اختيار فيديو','إنشاء مونتاج','إلغاء','الاحتفاظ بالمونتاج الموجود','إنشاء من اللوحة','يوجد مونتاج في المشروع. احتفظ بقصّه أو أنشئ مونتاجًا منفصلًا من فيديوهات اللوحة.','جارٍ تحميل المخطط الزمني…','عرض اللوحة المصدر','نتيجة التصدير'],
    hi: ['टाइमलाइन','इस कैनवास से नया संपादन','वीडियो का क्रम चुनें','पहला वीडियो और फिर शाखा चुनें। अंत में दूसरी शृंखला जोड़ें। केवल चुने हुए पथ आयात होंगे; पुराने संपादन सुरक्षित रहेंगे।','पहला वीडियो','अगला वीडियो','दूसरी शृंखला जोड़ें','शृंखला हटाएँ','यहाँ समाप्त करें','वीडियो चुनें','संपादन बनाएँ','रद्द करें','मौजूदा संपादन रखें','कैनवास से बनाएँ','इस प्रोजेक्ट में पहले से संपादन है। उसके कट रखें या कैनवास वीडियो से अलग संपादन बनाएँ।','टाइमलाइन लोड हो रही है…','मूल कैनवास देखें','निर्यात परिणाम']
};
export function canvasTimelineText(locale: NextMuxDesktopLocale, key: Key): string {
    if (!(key in en)) return (historyRows[locale] ?? historyRows[locale.split('-')[0]] ?? historyRows.en)[historyKeys.indexOf(key as typeof historyKeys[number])] ?? String(key);
    const row = rows[locale] ?? rows[locale.split('-')[0]];
    return row?.[Object.keys(en).indexOf(key)] ?? en[key as keyof typeof en] ?? String(key);
}
