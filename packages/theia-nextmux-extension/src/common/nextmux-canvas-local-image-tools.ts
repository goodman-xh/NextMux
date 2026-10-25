import type { CanvasAssetVersion } from '@nextmux/comic-core';

/** Pure UI data and validation. It does not import Node, React or any model transport. */
export type CanvasCurvePoint = readonly [input: number, output: number];
export interface CanvasImageCurves {
    readonly rgb?: readonly CanvasCurvePoint[];
    readonly red?: readonly CanvasCurvePoint[];
    readonly green?: readonly CanvasCurvePoint[];
    readonly blue?: readonly CanvasCurvePoint[];
}
export interface CanvasColorTransferParameters { readonly strength?: number; readonly preserveLuminance?: boolean }
export interface CanvasPaletteExtractParameters { readonly colorCount?: number }
export interface CanvasExtractedPalette {
    readonly algorithm: 'lab-kmeans-v1';
    readonly requestedColorCount: number;
    readonly colors: readonly { readonly hex: string; readonly percentage: number }[];
    readonly sampleWidth: number;
    readonly sampleHeight: number;
}
export interface CanvasGridStitchParameters {
    readonly rows: number; readonly columns: number; readonly cellWidth: number; readonly cellHeight: number;
    readonly gap: number; readonly background: string; readonly cells: readonly (string | null)[];
}
export class CanvasLocalImageInputError extends Error {
    readonly code = 'INVALID_TOOL_INPUT';
    constructor(message: string) { super(message); this.name = 'CanvasLocalImageInputError'; }
}
function fail(message: string): never { throw new CanvasLocalImageInputError(message); }
function integer(value: number, name: string, min: number, max: number): number {
    if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${name} must be an integer in ${min}..${max}`);
    return value;
}
export const CANVAS_IDENTITY_CURVE: readonly CanvasCurvePoint[] = Object.freeze([Object.freeze([0, 0] as const), Object.freeze([1, 1] as const)]);
export const CANVAS_LOCAL_IMAGE_TOOL_DEFAULTS = Object.freeze({
    curves: Object.freeze({ rgb: CANVAS_IDENTITY_CURVE, red: CANVAS_IDENTITY_CURVE, green: CANVAS_IDENTITY_CURVE, blue: CANVAS_IDENTITY_CURVE }),
    transfer: Object.freeze({ strength: 1, preserveLuminance: false }), paletteExtract: Object.freeze({ colorCount: 6 }),
    gridStitch: Object.freeze({ rows: 2, columns: 2, cellWidth: 512, cellHeight: 512, gap: 4, background: '#000000' })
});
export const CANVAS_GRID_STITCH_LAYOUTS = Object.freeze([
    [1, 2], [2, 1], [2, 2], [2, 3], [3, 2], [2, 4], [4, 2], [3, 3], [3, 4], [4, 3], [4, 4], [4, 5], [5, 4], [5, 5], [6, 6]
].map(([rows, columns]) => Object.freeze({ id: `${rows}x${columns}`, rows, columns })));

/** Master RGB is applied after individual channels, matching FFmpeg's master curve. */
/**
 * FFmpeg's curves filter joins the points with a natural cubic spline (second derivative zero at both ends), holds the
 * end values outside them and clips to 0..1. The editor draws and previews the very same curve, so what you see is
 * what the filter renders.
 */
export function canvasCurveSampler(points: readonly (readonly [number, number])[]): (at: number) => number {
    const n = points.length;
    if (n < 3) return at => {
        const [[x0, y0], [x1, y1]] = n === 2 ? points as readonly [readonly [number, number], readonly [number, number]] : [[0, 0], [1, 1]] as const;
        return Math.max(0, Math.min(1, at <= x0 ? y0 : at >= x1 ? y1 : y0 + (y1 - y0) * (at - x0) / (x1 - x0)));
    };
    const h = points.slice(0, -1).map(([x], index) => points[index + 1][0] - x);
    // Tridiagonal system for the second derivatives r[1..n-2]; r[0] = r[n-1] = 0.
    const r = new Array<number>(n).fill(0), c = new Array<number>(n).fill(0), d = new Array<number>(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
        const a = h[i - 1], b = 2 * (h[i - 1] + h[i]), up = h[i];
        const rhs = 6 * ((points[i + 1][1] - points[i][1]) / h[i] - (points[i][1] - points[i - 1][1]) / h[i - 1]);
        const m = b - a * c[i - 1];
        c[i] = up / m; d[i] = (rhs - a * d[i - 1]) / m;
    }
    for (let i = n - 2; i >= 1; i--) r[i] = d[i] - c[i] * r[i + 1];
    return at => {
        if (at <= points[0][0]) return Math.max(0, Math.min(1, points[0][1]));
        if (at >= points[n - 1][0]) return Math.max(0, Math.min(1, points[n - 1][1]));
        let i = 0;
        while (i < n - 2 && at > points[i + 1][0]) i++;
        const span = h[i], t = at - points[i][0];
        const b = (points[i + 1][1] - points[i][1]) / span - span * r[i] / 2 - span * (r[i + 1] - r[i]) / 6;
        const value = points[i][1] + b * t + r[i] / 2 * t * t + (r[i + 1] - r[i]) / (6 * span) * t * t * t;
        return Math.max(0, Math.min(1, value));
    };
}

export function compileCanvasCurvesFilter(curves: CanvasImageCurves): string {
    if (!curves || typeof curves !== 'object' || Array.isArray(curves)) fail('Curves must be an object');
    if (Object.keys(curves).some(key => !['rgb', 'red', 'green', 'blue'].includes(key))) fail('Unknown curve channel');
    const options: string[] = [];
    for (const channel of ['red', 'green', 'blue', 'rgb'] as const) {
        const points = curves[channel]; if (points === undefined) continue;
        if (!Array.isArray(points) || points.length < 2 || points.length > 64) fail('Each curve requires 2..64 control points');
        let previous = -1;
        const text = points.map(point => {
            if (!Array.isArray(point) || point.length !== 2 || point.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) fail('Curve coordinates must be finite numbers in 0..1');
            if (point[0] <= previous) fail('Curve input coordinates must increase strictly'); previous = point[0];
            return `${point[0]}/${point[1]}`;
        }).join(' ');
        if (points[0][0] !== 0 || points[points.length - 1][0] !== 1) fail('Curve endpoints must cover input 0..1');
        options.push(`${channel === 'rgb' ? 'master' : channel}='${text}'`);
    }
    return `curves=${options.length ? options.join(':') : "master='0/0 1/1'"}`;
}

/** Use version IDs on RPC, never accept caller-supplied paths for a selected cell. Repeated IDs are allowed. */
export function buildCanvasGridStitchDraft(selected: readonly CanvasAssetVersion[], input: Partial<CanvasGridStitchParameters> = {}): {
    readonly sourceVersionId: string; readonly parameters: CanvasGridStitchParameters; readonly width: number; readonly height: number;
} {
    const p = { ...CANVAS_LOCAL_IMAGE_TOOL_DEFAULTS.gridStitch, ...input };
    integer(p.rows, 'rows', 1, 20); integer(p.columns, 'columns', 1, 20);
    integer(p.cellWidth, 'cellWidth', 1, 8192); integer(p.cellHeight, 'cellHeight', 1, 8192); integer(p.gap, 'gap', 0, 40);
    if (typeof p.background !== 'string' || !/^#[\da-f]{6}$/i.test(p.background)) fail('Grid background must be a six-digit hex colour');
    const ready = selected.filter(version => version.kind === 'image' && !['missing', 'uploading'].includes(version.status || '') && version.id && version.uri);
    const cells = input.cells ? [...input.cells] : ready.map(version => version.id);
    if (cells.length > p.rows * p.columns || !cells.some(Boolean)) fail('Place at least one image within the grid');
    if (cells.some(id => id !== null && (typeof id !== 'string' || !ready.some(version => version.id === id)))) fail('Every cell must refer to a selected ready image version');
    const width = p.cellWidth * p.columns + p.gap * (p.columns - 1), height = p.cellHeight * p.rows + p.gap * (p.rows - 1);
    if (width * height > 64 * 1024 * 1024) fail('The stitched image must not exceed 64 megapixels');
    return { sourceVersionId: cells.find((id): id is string => id !== null)!, width, height,
        parameters: { rows: p.rows, columns: p.columns, cellWidth: p.cellWidth, cellHeight: p.cellHeight, gap: p.gap, background: p.background.toUpperCase(), cells: [...cells, ...Array(p.rows * p.columns - cells.length).fill(null)] } };
}

export const CANVAS_LOCAL_IMAGE_TOOL_LOCALES = ['zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'] as const;
type Locale = typeof CANVAS_LOCAL_IMAGE_TOOL_LOCALES[number];
export type CanvasLocalImageToolTextKey = 'curves' | 'curvesHint' | 'transfer' | 'transferHint' | 'paletteExtract' | 'paletteExtractHint' | 'gridStitch' | 'gridStitchHint'
    | 'rgb' | 'red' | 'green' | 'blue' | 'strength' | 'referenceImage' | 'preserveLuminance' | 'colorCount' | 'rows' | 'columns' | 'gap' | 'background' | 'cellWidth' | 'cellHeight' | 'cells';
const keys: readonly CanvasLocalImageToolTextKey[] = ['curves', 'curvesHint', 'transfer', 'transferHint', 'paletteExtract', 'paletteExtractHint', 'gridStitch', 'gridStitchHint', 'rgb', 'red', 'green', 'blue', 'strength', 'referenceImage', 'preserveLuminance', 'colorCount', 'rows', 'columns', 'gap', 'background', 'cellWidth', 'cellHeight', 'cells'];
const texts: Readonly<Record<Locale, readonly string[]>> = {
    'zh-CN': ['曲线', '用 RGB 主曲线和独立通道曲线调整色调。', '色彩迁移', '匹配参考图的 Lab 色彩统计，保留透明度。', '提取调色盘', '从可见像素提取最多 5–8 种主色；纯色图会更少。', '宫格拼接', '选择图片版本并分配到格子；空格显示背景色。', 'RGB 主曲线', '红', '绿', '蓝', '强度', '参考图片', '保留亮度', '颜色数量', '行数', '列数', '间距', '背景色', '格子宽度', '格子高度', '格子'],
    en: ['Curves', 'Adjust tones with master RGB and individual channel curves.', 'Colour transfer', 'Match reference Lab colour statistics while preserving alpha.', 'Extract palette', 'Extract up to 5–8 dominant visible colours; flat images yield fewer.', 'Grid stitch', 'Assign selected image versions to cells; empty cells show the background.', 'Master RGB', 'Red', 'Green', 'Blue', 'Strength', 'Reference image', 'Preserve luminance', 'Colour count', 'Rows', 'Columns', 'Gap', 'Background', 'Cell width', 'Cell height', 'Cells'],
    'zh-TW': ['曲線', '用 RGB 主曲線和獨立通道曲線調整色調。', '色彩遷移', '匹配參考圖的 Lab 色彩統計，保留透明度。', '擷取調色盤', '從可見像素擷取最多 5–8 種主色；純色圖會更少。', '宮格拼接', '選擇圖片版本並分配到格子；空格顯示背景色。', 'RGB 主曲線', '紅', '綠', '藍', '強度', '參考圖片', '保留亮度', '顏色數量', '行數', '列數', '間距', '背景色', '格子寬度', '格子高度', '格子'],
    ja: ['トーンカーブ', 'RGB 全体と各チャンネルのカーブで色調を調整します。', '色彩転送', '参照画像の Lab 色統計に合わせ、透明度を保持します。', 'パレット抽出', '可視色を最大 5～8 色抽出します。単色画像では少なくなります。', 'グリッド結合', '選択画像をセルに配置します。空きセルは背景色になります。', 'RGB 全体', '赤', '緑', '青', '強度', '参照画像', '輝度を保持', '色数', '行数', '列数', '間隔', '背景色', 'セル幅', 'セル高さ', 'セル'],
    ko: ['곡선', 'RGB 전체 및 개별 채널 곡선으로 색조를 조정합니다.', '색상 전이', '참조 이미지의 Lab 색상 통계를 맞추고 투명도를 유지합니다.', '팔레트 추출', '보이는 주요 색상을 최대 5~8개 추출합니다. 단색은 더 적습니다.', '격자 합치기', '선택한 이미지 버전을 칸에 배치합니다. 빈칸은 배경색입니다.', '전체 RGB', '빨강', '초록', '파랑', '강도', '참조 이미지', '휘도 유지', '색상 수', '행 수', '열 수', '간격', '배경색', '칸 너비', '칸 높이', '칸'],
    es: ['Curvas', 'Ajusta tonos con la curva RGB maestra y las de cada canal.', 'Transferencia de color', 'Iguala las estadísticas Lab de la referencia y conserva la transparencia.', 'Extraer paleta', 'Extrae hasta 5–8 colores visibles; las imágenes uniformes dan menos.', 'Unir en cuadrícula', 'Asigna imágenes a celdas; las vacías muestran el fondo.', 'RGB maestro', 'Rojo', 'Verde', 'Azul', 'Intensidad', 'Imagen de referencia', 'Conservar luminancia', 'Número de colores', 'Filas', 'Columnas', 'Separación', 'Fondo', 'Ancho de celda', 'Alto de celda', 'Celdas'],
    fr: ['Courbes', 'Ajustez les tons avec la courbe RVB globale et celles des canaux.', 'Transfert de couleurs', 'Adapte les statistiques Lab à la référence en préservant la transparence.', 'Extraire la palette', 'Extrait jusqu’à 5–8 couleurs visibles ; les images uniformes en donnent moins.', 'Assembler en grille', 'Placez les images dans les cases ; les cases vides affichent le fond.', 'RVB global', 'Rouge', 'Vert', 'Bleu', 'Intensité', 'Image de référence', 'Préserver la luminance', 'Nombre de couleurs', 'Lignes', 'Colonnes', 'Espacement', 'Fond', 'Largeur de case', 'Hauteur de case', 'Cases'],
    de: ['Kurven', 'Passen Sie Farbtöne mit der RGB-Gesamtkurve und Kanalkurven an.', 'Farbübertragung', 'Gleicht Lab-Farbstatistiken an die Referenz an und erhält Transparenz.', 'Palette extrahieren', 'Extrahiert bis zu 5–8 sichtbare Hauptfarben; einfarbige Bilder liefern weniger.', 'Raster zusammensetzen', 'Ordnen Sie Bilder Zellen zu; leere Zellen zeigen den Hintergrund.', 'RGB-Gesamtkurve', 'Rot', 'Grün', 'Blau', 'Stärke', 'Referenzbild', 'Helligkeit erhalten', 'Farbanzahl', 'Zeilen', 'Spalten', 'Abstand', 'Hintergrund', 'Zellbreite', 'Zellhöhe', 'Zellen'],
    'pt-BR': ['Curvas', 'Ajuste tons com a curva RGB geral e curvas individuais dos canais.', 'Transferência de cor', 'Iguala as estatísticas Lab da referência e preserva a transparência.', 'Extrair paleta', 'Extrai até 5–8 cores visíveis; imagens uniformes geram menos.', 'Montar grade', 'Distribua imagens nas células; as vazias mostram o fundo.', 'RGB geral', 'Vermelho', 'Verde', 'Azul', 'Intensidade', 'Imagem de referência', 'Preservar luminância', 'Quantidade de cores', 'Linhas', 'Colunas', 'Espaçamento', 'Fundo', 'Largura da célula', 'Altura da célula', 'Células'],
    ru: ['Кривые', 'Настройте тона общей кривой RGB и кривыми отдельных каналов.', 'Перенос цвета', 'Сопоставляет статистику Lab с образцом, сохраняя прозрачность.', 'Извлечь палитру', 'Извлекает до 5–8 видимых цветов; в однотонных изображениях их меньше.', 'Собрать сетку', 'Разместите изображения в ячейках; пустые ячейки показывают фон.', 'Общая RGB', 'Красный', 'Зелёный', 'Синий', 'Сила', 'Изображение-образец', 'Сохранить яркость', 'Число цветов', 'Строки', 'Столбцы', 'Интервал', 'Фон', 'Ширина ячейки', 'Высота ячейки', 'Ячейки'],
    ar: ['المنحنيات', 'اضبط الدرجات بمنحنى RGB العام ومنحنيات القنوات.', 'نقل الألوان', 'يطابق إحصاءات Lab للصورة المرجعية ويحافظ على الشفافية.', 'استخراج لوحة الألوان', 'يستخرج حتى 5–8 ألوان مرئية؛ الصور الموحدة تعطي أقل.', 'دمج الشبكة', 'وزّع الصور المختارة على الخلايا؛ الخلايا الفارغة تعرض الخلفية.', 'RGB العام', 'أحمر', 'أخضر', 'أزرق', 'الشدة', 'الصورة المرجعية', 'الحفاظ على السطوع', 'عدد الألوان', 'الصفوف', 'الأعمدة', 'الفجوة', 'الخلفية', 'عرض الخلية', 'ارتفاع الخلية', 'الخلايا'],
    hi: ['कर्व', 'मुख्य RGB और अलग चैनल कर्व से रंगत बदलें।', 'रंग स्थानांतरण', 'संदर्भ की Lab रंग सांख्यिकी मिलाएँ और पारदर्शिता बनाए रखें।', 'पैलेट निकालें', 'अधिकतम 5–8 प्रमुख दिखने वाले रंग निकालें; एकरंगी चित्र में कम रंग होंगे।', 'ग्रिड जोड़ें', 'चुने हुए चित्रों को खानों में रखें; खाली खाने पृष्ठभूमि दिखाते हैं।', 'मुख्य RGB', 'लाल', 'हरा', 'नीला', 'तीव्रता', 'संदर्भ चित्र', 'प्रकाशमानता रखें', 'रंगों की संख्या', 'पंक्तियाँ', 'स्तंभ', 'अंतर', 'पृष्ठभूमि', 'खाने की चौड़ाई', 'खाने की ऊँचाई', 'खाने']
};
export function canvasLocalImageToolText(locale: string, key: CanvasLocalImageToolTextKey): string {
    const resolved = (CANVAS_LOCAL_IMAGE_TOOL_LOCALES as readonly string[]).includes(locale) ? locale as Locale : 'en';
    return texts[resolved][keys.indexOf(key)];
}
