/** 标记修图 mark editor text, in the 12 app languages (tsc enforces every key in every language). */
export type MarksTextKey = 'pen' | 'box' | 'arrow' | 'number' | 'undo' | 'redo' | 'clear' | 'color' | 'size' | 'thin' | 'medium' | 'thick'
    | 'red' | 'yellow' | 'green' | 'blue' | 'white' | 'empty' | 'saving' | 'failed' | 'nodeTitle' | 'instruction' | 'instructionHint' | 'needInstruction';

const ZH: Record<MarksTextKey, string> = {
    pen: '画笔', box: '方框', arrow: '箭头', number: '序号', undo: '撤销', redo: '重做', clear: '清空', color: '颜色', size: '粗细', thin: '细', medium: '中', thick: '粗',
    red: '红', yellow: '黄', green: '绿', blue: '蓝', white: '白', empty: '先在图上标出要改的地方',
    saving: '正在保存标记图…', failed: '标记图没保存成功：{error}', nodeTitle: '标记',
    instruction: '修改要求', instructionHint: '按序号写每处怎么改，例如：1 把纸条上的字改成“明天见”；2 去掉右上角的屏幕', needInstruction: '写下每个标记处要怎么改'
};
const ZH_TW: Record<MarksTextKey, string> = {
    pen: '畫筆', box: '方框', arrow: '箭頭', number: '序號', undo: '復原', redo: '重做', clear: '清空', color: '顏色', size: '粗細', thin: '細', medium: '中', thick: '粗',
    red: '紅', yellow: '黃', green: '綠', blue: '藍', white: '白', empty: '先在圖上標出要改的地方',
    saving: '正在儲存標記圖…', failed: '標記圖沒有儲存成功：{error}', nodeTitle: '標記',
    instruction: '修改要求', instructionHint: '按序號寫每處怎麼改，例如：1 把紙條上的字改成「明天見」；2 去掉右上角的螢幕', needInstruction: '寫下每個標記處要怎麼改'
};
const EN: Record<MarksTextKey, string> = {
    pen: 'Pen', box: 'Box', arrow: 'Arrow', number: 'Number', undo: 'Undo', redo: 'Redo', clear: 'Clear', color: 'Colour', size: 'Width', thin: 'Thin', medium: 'Medium', thick: 'Thick',
    red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue', white: 'White', empty: 'Mark the places to change on the picture first',
    saving: 'Saving the marked picture…', failed: 'The marked picture could not be saved: {error}', nodeTitle: 'Marked',
    instruction: 'What to change', instructionHint: 'Describe each change by number, e.g. 1 change the note to “See you tomorrow”; 2 remove the screen at the top right', needInstruction: 'Say how to change each marked place'
};
const JA: Record<MarksTextKey, string> = {
    pen: 'ペン', box: '四角', arrow: '矢印', number: '番号', undo: '元に戻す', redo: 'やり直す', clear: 'すべて消す', color: '色', size: '太さ', thin: '細', medium: '中', thick: '太',
    red: '赤', yellow: '黄', green: '緑', blue: '青', white: '白', empty: 'まず画像上で変えたい場所に印を付けてください',
    saving: '印付き画像を保存中…', failed: '印付き画像を保存できませんでした：{error}', nodeTitle: '印付き',
    instruction: '変更内容', instructionHint: '番号ごとに変更内容を書きます。例：1 メモの文字を「また明日」に；2 右上の画面を消す', needInstruction: '印を付けた場所をそれぞれどう変えるか書いてください'
};
const KO: Record<MarksTextKey, string> = {
    pen: '펜', box: '상자', arrow: '화살표', number: '번호', undo: '실행 취소', redo: '다시 실행', clear: '모두 지우기', color: '색', size: '굵기', thin: '가늘게', medium: '보통', thick: '굵게',
    red: '빨강', yellow: '노랑', green: '초록', blue: '파랑', white: '흰색', empty: '먼저 이미지에서 바꿀 곳을 표시하세요',
    saving: '표시한 이미지를 저장하는 중…', failed: '표시한 이미지를 저장하지 못했습니다: {error}', nodeTitle: '표시',
    instruction: '바꿀 내용', instructionHint: '번호별로 바꿀 내용을 적으세요. 예: 1 쪽지 글자를 “내일 봐”로; 2 오른쪽 위 화면 지우기', needInstruction: '표시한 곳마다 어떻게 바꿀지 적으세요'
};
const ES: Record<MarksTextKey, string> = {
    pen: 'Lápiz', box: 'Recuadro', arrow: 'Flecha', number: 'Número', undo: 'Deshacer', redo: 'Rehacer', clear: 'Borrar todo', color: 'Color', size: 'Grosor', thin: 'Fino', medium: 'Medio', thick: 'Grueso',
    red: 'Rojo', yellow: 'Amarillo', green: 'Verde', blue: 'Azul', white: 'Blanco', empty: 'Primero marca en la imagen lo que quieres cambiar',
    saving: 'Guardando la imagen marcada…', failed: 'No se pudo guardar la imagen marcada: {error}', nodeTitle: 'Marcada',
    instruction: 'Qué cambiar', instructionHint: 'Describe cada cambio por número, p. ej. 1 cambia la nota a «Hasta mañana»; 2 quita la pantalla de arriba a la derecha', needInstruction: 'Indica cómo cambiar cada zona marcada'
};
const FR: Record<MarksTextKey, string> = {
    pen: 'Crayon', box: 'Cadre', arrow: 'Flèche', number: 'Numéro', undo: 'Annuler', redo: 'Rétablir', clear: 'Tout effacer', color: 'Couleur', size: 'Épaisseur', thin: 'Fin', medium: 'Moyen', thick: 'Épais',
    red: 'Rouge', yellow: 'Jaune', green: 'Vert', blue: 'Bleu', white: 'Blanc', empty: 'Marquez d’abord sur l’image ce qu’il faut changer',
    saving: 'Enregistrement de l’image annotée…', failed: 'L’image annotée n’a pas pu être enregistrée : {error}', nodeTitle: 'Annotée',
    instruction: 'Ce qu’il faut changer', instructionHint: 'Décrivez chaque changement par numéro, p. ex. 1 remplacer le mot par « À demain » ; 2 retirer l’écran en haut à droite', needInstruction: 'Indiquez comment changer chaque zone marquée'
};
const DE: Record<MarksTextKey, string> = {
    pen: 'Stift', box: 'Rahmen', arrow: 'Pfeil', number: 'Nummer', undo: 'Rückgängig', redo: 'Wiederholen', clear: 'Alles löschen', color: 'Farbe', size: 'Stärke', thin: 'Dünn', medium: 'Mittel', thick: 'Dick',
    red: 'Rot', yellow: 'Gelb', green: 'Grün', blue: 'Blau', white: 'Weiß', empty: 'Markiere zuerst im Bild, was sich ändern soll',
    saving: 'Markiertes Bild wird gespeichert…', failed: 'Das markierte Bild konnte nicht gespeichert werden: {error}', nodeTitle: 'Markiert',
    instruction: 'Was sich ändern soll', instructionHint: 'Beschreibe jede Änderung nach Nummer, z. B. 1 Zettel-Text zu „Bis morgen“; 2 Bildschirm oben rechts entfernen', needInstruction: 'Beschreibe, wie sich jede markierte Stelle ändern soll'
};
const PT_BR: Record<MarksTextKey, string> = {
    pen: 'Caneta', box: 'Caixa', arrow: 'Seta', number: 'Número', undo: 'Desfazer', redo: 'Refazer', clear: 'Limpar tudo', color: 'Cor', size: 'Espessura', thin: 'Fina', medium: 'Média', thick: 'Grossa',
    red: 'Vermelho', yellow: 'Amarelo', green: 'Verde', blue: 'Azul', white: 'Branco', empty: 'Primeiro marque na imagem o que deve mudar',
    saving: 'Salvando a imagem marcada…', failed: 'Não foi possível salvar a imagem marcada: {error}', nodeTitle: 'Marcada',
    instruction: 'O que mudar', instructionHint: 'Descreva cada mudança pelo número, ex.: 1 trocar o bilhete por “Até amanhã”; 2 tirar a tela do canto superior direito', needInstruction: 'Diga como mudar cada lugar marcado'
};
const RU: Record<MarksTextKey, string> = {
    pen: 'Кисть', box: 'Рамка', arrow: 'Стрелка', number: 'Номер', undo: 'Отменить', redo: 'Повторить', clear: 'Очистить', color: 'Цвет', size: 'Толщина', thin: 'Тонкая', medium: 'Средняя', thick: 'Толстая',
    red: 'Красный', yellow: 'Жёлтый', green: 'Зелёный', blue: 'Синий', white: 'Белый', empty: 'Сначала отметьте на изображении, что нужно изменить',
    saving: 'Сохраняем изображение с пометками…', failed: 'Не удалось сохранить изображение с пометками: {error}', nodeTitle: 'С пометками',
    instruction: 'Что изменить', instructionHint: 'Опишите изменения по номерам, например: 1 заменить текст записки на «До завтра»; 2 убрать экран справа вверху', needInstruction: 'Опишите, как изменить каждое отмеченное место'
};
const AR: Record<MarksTextKey, string> = {
    pen: 'قلم', box: 'مربع', arrow: 'سهم', number: 'رقم', undo: 'تراجع', redo: 'إعادة', clear: 'مسح الكل', color: 'اللون', size: 'السماكة', thin: 'رفيع', medium: 'متوسط', thick: 'سميك',
    red: 'أحمر', yellow: 'أصفر', green: 'أخضر', blue: 'أزرق', white: 'أبيض', empty: 'حدّد أولًا على الصورة ما تريد تغييره',
    saving: 'جارٍ حفظ الصورة المعلَّمة…', failed: 'تعذّر حفظ الصورة المعلَّمة: {error}', nodeTitle: 'معلَّمة',
    instruction: 'ما الذي يتغير', instructionHint: 'اكتب كل تغيير برقمه، مثل: 1 غيّر نص الورقة إلى «أراك غدًا»؛ 2 أزل الشاشة أعلى اليمين', needInstruction: 'اكتب كيف يتغير كل موضع معلَّم'
};
const HI: Record<MarksTextKey, string> = {
    pen: 'पेन', box: 'बॉक्स', arrow: 'तीर', number: 'नंबर', undo: 'पूर्ववत करें', redo: 'फिर से करें', clear: 'सब मिटाएँ', color: 'रंग', size: 'मोटाई', thin: 'पतला', medium: 'मध्यम', thick: 'मोटा',
    red: 'लाल', yellow: 'पीला', green: 'हरा', blue: 'नीला', white: 'सफ़ेद', empty: 'पहले तस्वीर पर बदलने की जगह चिह्नित करें',
    saving: 'चिह्नित तस्वीर सहेजी जा रही है…', failed: 'चिह्नित तस्वीर सहेजी नहीं जा सकी: {error}', nodeTitle: 'चिह्नित',
    instruction: 'क्या बदलना है', instructionHint: 'हर बदलाव नंबर के साथ लिखें, जैसे: 1 पर्ची का लिखा “कल मिलते हैं” करें; 2 ऊपर दाईं ओर की स्क्रीन हटाएँ', needInstruction: 'हर चिह्नित जगह को कैसे बदलना है, लिखें'
};
const TEXT: Readonly<Record<string, Readonly<Record<MarksTextKey, string>>>> = { 'zh-CN': ZH, 'zh-TW': ZH_TW, en: EN, ja: JA, ko: KO, es: ES, fr: FR, de: DE, 'pt-BR': PT_BR, ru: RU, ar: AR, hi: HI };
export const COMIC_CANVAS_MARKS_LOCALES = Object.keys(TEXT);

export function marksText(locale: string, key: MarksTextKey, values?: Readonly<Record<string, string | number>>): string {
    const table = TEXT[locale] ?? (locale.startsWith('zh') ? (/TW|HK|Hant/i.test(locale) ? ZH_TW : ZH) : EN);
    return (table[key] ?? EN[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => values && name in values ? String(values[name]) : match);
}
