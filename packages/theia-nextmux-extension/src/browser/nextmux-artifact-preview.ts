/**
 * Previewing an HTML page, SVG graphic or Mermaid diagram from a reply in the browser drawer (Cherry Studio #7 /
 * LobeChat #16): the drawer's words, the Mermaid runtime handed to the sandboxed frame, and saving a picture.
 */
import type { NextMuxDesktopLocale } from './nextmux-locale';
import type { PreviewableArtifactDescriptor } from '../common/nextmux-cherry-lobechat-helpers';

export type ArtifactPreviewTextKey = 'html' | 'svg' | 'mermaid' | 'saveImage' | 'fixWithAi' | 'close' | 'rendering'
    | 'renderFailed' | 'saved' | 'savedAsSvg' | 'saveFailed' | 'repairInstruction' | 'repairError';

const en: Readonly<Record<ArtifactPreviewTextKey, string>> = {
    html: 'Web page', svg: 'SVG graphic', mermaid: 'Mermaid diagram', saveImage: 'Save image', fixWithAi: 'Fix with AI',
    close: 'Close preview', rendering: 'Drawing…', renderFailed: 'This diagram could not be drawn', saved: 'Image saved',
    savedAsSvg: 'Saved as SVG: this graphic cannot be turned into a PNG', saveFailed: 'The image could not be saved',
    repairInstruction: 'This Mermaid diagram does not render. Fix its syntax (put labels with brackets or special characters in double quotes) and reply with the corrected ```mermaid block only.',
    repairError: 'Renderer error'
};

const translations: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<ArtifactPreviewTextKey, string>>>> = {
    en,
    'zh-CN': { html: '网页', svg: 'SVG 矢量图', mermaid: 'Mermaid 图表', saveImage: '保存图片', fixWithAi: '让 AI 修复',
        close: '关闭预览', rendering: '正在绘制…', renderFailed: '这个图表无法绘制', saved: '图片已保存',
        savedAsSvg: '已保存为 SVG：这个图形无法转成 PNG', saveFailed: '无法保存图片',
        repairInstruction: '这个 Mermaid 图表无法渲染。请修复语法（含括号或特殊字符的标签用双引号包裹），只回复修复后的 ```mermaid 代码块。',
        repairError: '渲染报错' },
    'zh-TW': { html: '網頁', svg: 'SVG 向量圖', mermaid: 'Mermaid 圖表', saveImage: '儲存圖片', fixWithAi: '讓 AI 修復',
        close: '關閉預覽', rendering: '正在繪製…', renderFailed: '這個圖表無法繪製', saved: '圖片已儲存',
        savedAsSvg: '已儲存為 SVG：這個圖形無法轉成 PNG', saveFailed: '無法儲存圖片',
        repairInstruction: '這個 Mermaid 圖表無法渲染。請修復語法（含括號或特殊字元的標籤用雙引號包住），只回覆修復後的 ```mermaid 程式碼區塊。',
        repairError: '渲染錯誤' },
    ja: { html: 'Web ページ', svg: 'SVG 画像', mermaid: 'Mermaid 図', saveImage: '画像を保存', fixWithAi: 'AI で修正',
        close: 'プレビューを閉じる', rendering: '描画中…', renderFailed: 'この図は描画できません', saved: '画像を保存しました',
        savedAsSvg: 'SVG として保存しました（この図形は PNG にできません）', saveFailed: '画像を保存できませんでした',
        repairInstruction: 'この Mermaid 図は描画できません。構文を修正し（括弧や特殊文字を含むラベルは二重引用符で囲む）、修正後の ```mermaid ブロックだけを返してください。',
        repairError: '描画エラー' },
    ko: { html: '웹 페이지', svg: 'SVG 그래픽', mermaid: 'Mermaid 다이어그램', saveImage: '이미지 저장', fixWithAi: 'AI로 수정',
        close: '미리보기 닫기', rendering: '그리는 중…', renderFailed: '이 다이어그램을 그릴 수 없습니다', saved: '이미지를 저장했습니다',
        savedAsSvg: 'SVG로 저장했습니다: 이 그래픽은 PNG로 바꿀 수 없습니다', saveFailed: '이미지를 저장하지 못했습니다',
        repairInstruction: '이 Mermaid 다이어그램이 렌더링되지 않습니다. 문법을 고치고(괄호나 특수 문자가 있는 레이블은 큰따옴표로 감싸기) 수정된 ```mermaid 블록만 답하세요.',
        repairError: '렌더링 오류' },
    es: { html: 'Página web', svg: 'Gráfico SVG', mermaid: 'Diagrama Mermaid', saveImage: 'Guardar imagen', fixWithAi: 'Corregir con IA',
        close: 'Cerrar vista previa', rendering: 'Dibujando…', renderFailed: 'No se pudo dibujar este diagrama', saved: 'Imagen guardada',
        savedAsSvg: 'Guardado como SVG: este gráfico no se puede convertir en PNG', saveFailed: 'No se pudo guardar la imagen',
        repairInstruction: 'Este diagrama Mermaid no se representa. Corrige su sintaxis (pon entre comillas dobles las etiquetas con paréntesis o caracteres especiales) y responde solo con el bloque ```mermaid corregido.',
        repairError: 'Error del renderizador' },
    fr: { html: 'Page web', svg: 'Image SVG', mermaid: 'Diagramme Mermaid', saveImage: 'Enregistrer l’image', fixWithAi: 'Corriger avec l’IA',
        close: 'Fermer l’aperçu', rendering: 'Dessin en cours…', renderFailed: 'Ce diagramme ne peut pas être dessiné', saved: 'Image enregistrée',
        savedAsSvg: 'Enregistré en SVG : cette image ne peut pas devenir un PNG', saveFailed: 'L’image n’a pas pu être enregistrée',
        repairInstruction: 'Ce diagramme Mermaid ne s’affiche pas. Corrigez sa syntaxe (mettez entre guillemets les libellés avec parenthèses ou caractères spéciaux) et répondez uniquement avec le bloc ```mermaid corrigé.',
        repairError: 'Erreur du moteur de rendu' },
    de: { html: 'Webseite', svg: 'SVG-Grafik', mermaid: 'Mermaid-Diagramm', saveImage: 'Bild speichern', fixWithAi: 'Mit KI korrigieren',
        close: 'Vorschau schließen', rendering: 'Wird gezeichnet…', renderFailed: 'Dieses Diagramm lässt sich nicht zeichnen', saved: 'Bild gespeichert',
        savedAsSvg: 'Als SVG gespeichert: Diese Grafik lässt sich nicht in PNG umwandeln', saveFailed: 'Das Bild konnte nicht gespeichert werden',
        repairInstruction: 'Dieses Mermaid-Diagramm wird nicht dargestellt. Korrigiere die Syntax (Beschriftungen mit Klammern oder Sonderzeichen in doppelte Anführungszeichen setzen) und antworte nur mit dem korrigierten ```mermaid-Block.',
        repairError: 'Fehler des Renderers' },
    'pt-BR': { html: 'Página web', svg: 'Gráfico SVG', mermaid: 'Diagrama Mermaid', saveImage: 'Salvar imagem', fixWithAi: 'Corrigir com IA',
        close: 'Fechar prévia', rendering: 'Desenhando…', renderFailed: 'Não foi possível desenhar este diagrama', saved: 'Imagem salva',
        savedAsSvg: 'Salvo como SVG: este gráfico não pode virar PNG', saveFailed: 'Não foi possível salvar a imagem',
        repairInstruction: 'Este diagrama Mermaid não é renderizado. Corrija a sintaxe (coloque entre aspas duplas os rótulos com parênteses ou caracteres especiais) e responda apenas com o bloco ```mermaid corrigido.',
        repairError: 'Erro do renderizador' },
    ru: { html: 'Веб-страница', svg: 'SVG-графика', mermaid: 'Диаграмма Mermaid', saveImage: 'Сохранить изображение', fixWithAi: 'Исправить с ИИ',
        close: 'Закрыть просмотр', rendering: 'Рисование…', renderFailed: 'Эту диаграмму не удалось нарисовать', saved: 'Изображение сохранено',
        savedAsSvg: 'Сохранено как SVG: эту графику нельзя превратить в PNG', saveFailed: 'Не удалось сохранить изображение',
        repairInstruction: 'Эта диаграмма Mermaid не отображается. Исправьте синтаксис (подписи со скобками или спецсимволами заключите в двойные кавычки) и ответьте только исправленным блоком ```mermaid.',
        repairError: 'Ошибка отрисовки' },
    ar: { html: 'صفحة ويب', svg: 'رسم SVG', mermaid: 'مخطط Mermaid', saveImage: 'حفظ الصورة', fixWithAi: 'إصلاح بالذكاء الاصطناعي',
        close: 'إغلاق المعاينة', rendering: 'جارٍ الرسم…', renderFailed: 'تعذّر رسم هذا المخطط', saved: 'تم حفظ الصورة',
        savedAsSvg: 'حُفظ بصيغة SVG: لا يمكن تحويل هذا الرسم إلى PNG', saveFailed: 'تعذّر حفظ الصورة',
        repairInstruction: 'لا يمكن عرض مخطط Mermaid هذا. أصلح الصياغة (ضع التسميات التي تحتوي على أقواس أو رموز خاصة بين علامتي تنصيص مزدوجتين) وأجب بكتلة ```mermaid المصححة فقط.',
        repairError: 'خطأ العرض' },
    hi: { html: 'वेब पेज', svg: 'SVG ग्राफ़िक', mermaid: 'Mermaid आरेख', saveImage: 'छवि सहेजें', fixWithAi: 'AI से ठीक करें',
        close: 'पूर्वावलोकन बंद करें', rendering: 'बनाया जा रहा है…', renderFailed: 'यह आरेख नहीं बन सका', saved: 'छवि सहेजी गई',
        savedAsSvg: 'SVG के रूप में सहेजा: यह ग्राफ़िक PNG में नहीं बदल सकता', saveFailed: 'छवि सहेजी नहीं जा सकी',
        repairInstruction: 'यह Mermaid आरेख रेंडर नहीं होता। इसका सिंटैक्स ठीक करें (कोष्ठक या विशेष वर्णों वाले लेबल दोहरे उद्धरण चिह्नों में रखें) और केवल सुधरा हुआ ```mermaid ब्लॉक भेजें।',
        repairError: 'रेंडर त्रुटि' }
};

export function artifactPreviewText(locale: NextMuxDesktopLocale, key: ArtifactPreviewTextKey): string {
    return (translations[locale] || en)[key] || en[key];
}

export const artifactPreviewLocales = Object.keys(translations) as readonly NextMuxDesktopLocale[];

/** The drawer's state for one preview; `svg` arrives from the frame once a graphic or diagram is drawn. */
export interface ArtifactPreviewState {
    readonly id: string;
    readonly sessionId: string;
    readonly channel: string;
    /** The theme the frame was drawn in (a Mermaid diagram's colors and its saved picture's background). */
    readonly theme: 'light' | 'dark';
    readonly descriptor: PreviewableArtifactDescriptor;
    readonly html: string;
    readonly status: 'loading' | 'ready' | 'error';
    readonly svg?: string;
    readonly error?: string;
}

/** Base64 of UTF-8 text, in chunks small enough for String.fromCharCode. */
export function utf8ToBase64(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}

let mermaidRuntime: Promise<string> | undefined;

/**
 * The Mermaid runtime for the preview frame, loaded and encoded once, on the first diagram. A real dynamic import:
 * the bundler gives the 2.8 MB library its own chunk (packaged with lib/**), fetched only when a diagram is shown.
 */
export function mermaidRuntimeBase64(): Promise<string> {
    mermaidRuntime ??= import('./vendor/mermaid-tiny-source.js')
        .then(module => utf8ToBase64(module.MERMAID_TINY_SOURCE))
        .catch(error => { mermaidRuntime = undefined; throw error; });
    return mermaidRuntime;
}

/** The pixel size an SVG draws at: its width/height, else its viewBox, else a readable default. */
export function svgIntrinsicSize(svg: string): { readonly width: number; readonly height: number } {
    const root = /<svg\b[^>]*>/i.exec(svg)?.[0] || '';
    const attribute = (name: string): number | undefined => {
        const value = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([0-9.]+)\\s*(?:px)?\\s*["']`, 'i').exec(root)?.[1];
        const number = value === undefined ? NaN : Number(value);
        return Number.isFinite(number) && number > 0 ? number : undefined;
    };
    const viewBox = /\sviewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)\s*["']/i.exec(root);
    const boxWidth = viewBox ? Number(viewBox[1]) : NaN;
    const boxHeight = viewBox ? Number(viewBox[2]) : NaN;
    const width = attribute('width') ?? (boxWidth > 0 ? boxWidth : undefined);
    const height = attribute('height') ?? (boxHeight > 0 ? boxHeight : undefined);
    if (width && height) return { width, height };
    if (width && boxWidth > 0 && boxHeight > 0) return { width, height: width * boxHeight / boxWidth };
    return { width: 1200, height: 800 };
}

/**
 * A PNG of an SVG at twice its size (at most 8192 px a side), on `background` when given. Drawing happens in an
 * <img>, where an SVG's scripts never run. Rejects when the browser refuses to export the canvas (an SVG with
 * foreignObject content); the caller then saves the SVG itself.
 */
export function svgToPngBytes(svg: string, background?: string): Promise<Uint8Array> {
    const { width, height } = svgIntrinsicSize(svg);
    const scale = Math.max(0.1, Math.min(2, 8192 / Math.max(width, height)));
    const sized = svg.replace(/<svg\b([^>]*)>/i, (_tag, attributes: string) =>
        `<svg${attributes.replace(/\s(?:width|height)\s*=\s*(["'])[^"']*\1/gi, '')} width="${width}" height="${height}">`);
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(width * scale));
                canvas.height = Math.max(1, Math.round(height * scale));
                const context = canvas.getContext('2d');
                if (!context) throw new Error('CANVAS_UNAVAILABLE');
                if (background) { context.fillStyle = background; context.fillRect(0, 0, canvas.width, canvas.height); }
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(blob => {
                    if (!blob) { reject(new Error('PNG_EXPORT_FAILED')); return; }
                    void blob.arrayBuffer().then(buffer => resolve(new Uint8Array(buffer)), reject);
                }, 'image/png');
            } catch (error) {
                reject(error);
            }
        };
        image.onerror = () => reject(new Error('SVG_DECODE_FAILED'));
        image.src = `data:image/svg+xml;base64,${utf8ToBase64(sized)}`;
    });
}

/** A file name for a saved picture: the kind and a timestamp, nothing taken from the reply. */
export function artifactImageFileName(kind: PreviewableArtifactDescriptor['kind'], extension: 'png' | 'svg', at = new Date()): string {
    const stamp = `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, '0')}${String(at.getDate()).padStart(2, '0')}-${String(at.getHours()).padStart(2, '0')}${String(at.getMinutes()).padStart(2, '0')}${String(at.getSeconds()).padStart(2, '0')}`;
    return `${kind === 'mermaid' ? 'diagram' : 'graphic'}-${stamp}.${extension}`;
}
