import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';
export const IMAGE_LIGHTBOX_ZOOM = Object.freeze({
    initial: 100,
    min: 25,
    max: 400,
    step: 25
} as const);

export interface ImageLightboxImage {
    readonly src: string;
    readonly alt?: string;
    readonly name?: string;
}

export type ImageLightboxState =
    | {
        readonly isOpen: false;
        readonly image: undefined;
        readonly zoomPercent: typeof IMAGE_LIGHTBOX_ZOOM.initial;
        readonly panX: 0;
        readonly panY: 0;
    }
    | {
        readonly isOpen: true;
        readonly image: ImageLightboxImage;
        readonly zoomPercent: number;
        /** Translation in CSS pixels relative to the untransformed image origin. */
        readonly panX: number;
        readonly panY: number;
    };

export type ImageLightboxCloseSource = 'escape' | 'backdrop' | 'button';

export type ImageLightboxTextKey = 'close' | 'zoomOut' | 'zoomIn';

const imageLightboxLabels: Readonly<Record<string, Readonly<Record<ImageLightboxTextKey, string>>>> = {
    'zh-CN': { close: '关闭图片预览', zoomOut: '缩小图片', zoomIn: '放大图片' },
    'zh-TW': { close: '關閉圖片預覽', zoomOut: '縮小圖片', zoomIn: '放大圖片' },
    en: { close: 'Close image preview', zoomOut: 'Zoom out image', zoomIn: 'Zoom in image' },
    ja: { close: '画像プレビューを閉じる', zoomOut: '画像を縮小', zoomIn: '画像を拡大' },
    ko: { close: '이미지 미리보기 닫기', zoomOut: '이미지 축소', zoomIn: '이미지 확대' },
    es: { close: 'Cerrar vista previa de imagen', zoomOut: 'Alejar imagen', zoomIn: 'Acercar imagen' },
    fr: { close: 'Fermer l’aperçu de l’image', zoomOut: 'Réduire l’image', zoomIn: 'Agrandir l’image' },
    de: { close: 'Bildvorschau schließen', zoomOut: 'Bild verkleinern', zoomIn: 'Bild vergrößern' },
    'pt-BR': { close: 'Fechar prévia da imagem', zoomOut: 'Reduzir imagem', zoomIn: 'Ampliar imagem' },
    ru: { close: 'Закрыть предпросмотр изображения', zoomOut: 'Уменьшить изображение', zoomIn: 'Увеличить изображение' },
    ar: { close: 'إغلاق معاينة الصورة', zoomOut: 'تصغير الصورة', zoomIn: 'تكبير الصورة' },
    hi: { close: 'इमेज प्रीव्यू बंद करें', zoomOut: 'इमेज छोटा करें', zoomIn: 'इमेज बड़ा करें' }
};

/** UI-only labels; message text and model output are never localized here. */
function uncheckedImageLightboxText(locale: string, key: ImageLightboxTextKey): string {
    return imageLightboxLabels[locale]?.[key] || imageLightboxLabels.en[key];
}

export type ImageLightboxEvent =
    | { readonly type: 'open'; readonly image: ImageLightboxImage }
    | { readonly type: 'close'; readonly source: ImageLightboxCloseSource }
    | { readonly type: 'zoom-in' }
    | { readonly type: 'zoom-out' }
    | { readonly type: 'reset' }
    | { readonly type: 'pan'; readonly deltaX: number; readonly deltaY: number }
    | {
        readonly type: 'wheel';
        readonly deltaY: number;
        /** Pointer position in CSS pixels relative to the untransformed image origin. */
        readonly pointerX?: number;
        readonly pointerY?: number;
    };

export interface ImageLightboxTransition {
    readonly state: ImageLightboxState;
    /** Whether the presentation layer should consume the originating input. */
    readonly handled: boolean;
}

export function createImageLightboxState(): ImageLightboxState {
    return {
        isOpen: false,
        image: undefined,
        zoomPercent: IMAGE_LIGHTBOX_ZOOM.initial,
        panX: 0,
        panY: 0
    };
}

export function imageLightboxPercentage(state: ImageLightboxState): string {
    return `${state.zoomPercent}%`;
}

function changeZoom(state: ImageLightboxState, amount: number, pointerX = 0, pointerY = 0): ImageLightboxTransition {
    if (!state.isOpen) return { state, handled: false };
    const zoomPercent = Math.min(
        IMAGE_LIGHTBOX_ZOOM.max,
        Math.max(IMAGE_LIGHTBOX_ZOOM.min, state.zoomPercent + amount)
    );
    if (zoomPercent === state.zoomPercent) return { state, handled: true };
    if (zoomPercent <= 100) return { state: { ...state, zoomPercent, panX: 0, panY: 0 }, handled: true };
    const ratio = zoomPercent / state.zoomPercent;
    // p = imagePoint * scale + pan. Keep p fixed even when the cursor moves
    // between wheel events; changing transform-origin alone would make it jump.
    const anchoredPan = (pointer: number, pan: number): number => {
        const point = Number.isFinite(pointer) ? pointer : 0;
        return point - (point - pan) * ratio;
    };
    return { state: { ...state, zoomPercent, panX: anchoredPan(pointerX, state.panX), panY: anchoredPan(pointerY, state.panY) }, handled: true };
}

/**
 * Pure state transition seam for a full-screen image lightbox.
 *
 * The caller owns DOM behavior and supplies pointer coordinates from the current
 * image bounds. Valid wheel input is consumed even at a zoom limit, preventing
 * the underlying conversation from scrolling while the preview is open.
 */
export function updateImageLightbox(
    state: ImageLightboxState,
    event: ImageLightboxEvent
): ImageLightboxTransition {
    switch (event.type) {
        case 'open':
            return {
                state: {
                    isOpen: true,
                    image: event.image,
                    zoomPercent: IMAGE_LIGHTBOX_ZOOM.initial,
                    panX: 0,
                    panY: 0
                },
                handled: true
            };
        case 'close':
            return state.isOpen
                ? { state: createImageLightboxState(), handled: true }
                : { state, handled: false };
        case 'zoom-in':
            return changeZoom(state, IMAGE_LIGHTBOX_ZOOM.step);
        case 'zoom-out':
            return changeZoom(state, -IMAGE_LIGHTBOX_ZOOM.step);
        case 'reset':
            return state.isOpen ? { state: { ...state, zoomPercent: 100, panX: 0, panY: 0 }, handled: true } : { state, handled: false };
        case 'pan':
            return state.isOpen && state.zoomPercent > 100 && Number.isFinite(event.deltaX) && Number.isFinite(event.deltaY)
                ? { state: { ...state, panX: state.panX + event.deltaX, panY: state.panY + event.deltaY }, handled: true }
                : { state, handled: false };
        case 'wheel':
            if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return { state, handled: false };
            return changeZoom(state, event.deltaY < 0 ? IMAGE_LIGHTBOX_ZOOM.step : -IMAGE_LIGHTBOX_ZOOM.step, event.pointerX, event.pointerY);
    }
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function imageLightboxText(locale: Parameters<typeof uncheckedImageLightboxText>[0], key: Parameters<typeof uncheckedImageLightboxText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedImageLightboxText>>): string {
    return totalCopy(locale, key, language => uncheckedImageLightboxText(language, key, ...rest));
}
