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

export type ImageLightboxTextKey = 'close' | 'zoomOut' | 'zoomIn' | 'previous' | 'next' | 'position';

const imageLightboxLabels: Readonly<Record<string, Readonly<Record<ImageLightboxTextKey, string>>>> = {
    'zh-CN': { close: '关闭图片预览', zoomOut: '缩小图片', zoomIn: '放大图片', previous: '上一个', next: '下一个', position: '第 {index} 个，共 {total} 个' },
    'zh-TW': { close: '關閉圖片預覽', zoomOut: '縮小圖片', zoomIn: '放大圖片', previous: '上一個', next: '下一個', position: '第 {index} 個，共 {total} 個' },
    en: { close: 'Close image preview', zoomOut: 'Zoom out image', zoomIn: 'Zoom in image', previous: 'Previous', next: 'Next', position: '{index} of {total}' },
    ja: { close: '画像プレビューを閉じる', zoomOut: '画像を縮小', zoomIn: '画像を拡大', previous: '前へ', next: '次へ', position: '{total} 件中 {index} 件目' },
    ko: { close: '이미지 미리보기 닫기', zoomOut: '이미지 축소', zoomIn: '이미지 확대', previous: '이전', next: '다음', position: '{total}개 중 {index}번째' },
    es: { close: 'Cerrar vista previa de imagen', zoomOut: 'Alejar imagen', zoomIn: 'Acercar imagen', previous: 'Anterior', next: 'Siguiente', position: '{index} de {total}' },
    fr: { close: 'Fermer l’aperçu de l’image', zoomOut: 'Réduire l’image', zoomIn: 'Agrandir l’image', previous: 'Précédent', next: 'Suivant', position: '{index} sur {total}' },
    de: { close: 'Bildvorschau schließen', zoomOut: 'Bild verkleinern', zoomIn: 'Bild vergrößern', previous: 'Vorheriges', next: 'Nächstes', position: '{index} von {total}' },
    'pt-BR': { close: 'Fechar prévia da imagem', zoomOut: 'Reduzir imagem', zoomIn: 'Ampliar imagem', previous: 'Anterior', next: 'Próximo', position: '{index} de {total}' },
    ru: { close: 'Закрыть предпросмотр изображения', zoomOut: 'Уменьшить изображение', zoomIn: 'Увеличить изображение', previous: 'Предыдущий', next: 'Следующий', position: '{index} из {total}' },
    ar: { close: 'إغلاق معاينة الصورة', zoomOut: 'تصغير الصورة', zoomIn: 'تكبير الصورة', previous: 'السابق', next: 'التالي', position: '{index} من {total}' },
    hi: { close: 'इमेज प्रीव्यू बंद करें', zoomOut: 'इमेज छोटा करें', zoomIn: 'इमेज बड़ा करें', previous: 'पिछला', next: 'अगला', position: '{total} में से {index}' }
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

/** "2 of 12" in words, for screen readers; the badge itself shows "2 / 12". `index` counts from 1. */
export function imageLightboxPosition(locale: string, index: number, total: number): string {
    return imageLightboxText(locale, 'position').replace('{index}', String(index)).replace('{total}', String(total));
}

/**
 * The pointer as a 'wheel' event's pointerX/pointerY expect it: relative to the image's transform-origin in its
 * untransformed box, measured from the rendered bounds and the computed origin (any origin, as the coding viewer does).
 */
export function imageLightboxPointer(image: Element | null | undefined, state: ImageLightboxState, clientX: number, clientY: number): { readonly pointerX: number; readonly pointerY: number } {
    const rect = image?.getBoundingClientRect();
    if (!image || !rect || !(rect.width > 0) || !(rect.height > 0)) return { pointerX: 0, pointerY: 0 };
    const origin = typeof getComputedStyle === 'function' ? getComputedStyle(image).transformOrigin.split(' ').map(value => Number.parseFloat(value)) : [];
    const scale = state.zoomPercent / 100;
    const originX = Number.isFinite(origin[0]) ? origin[0] * scale : rect.width / 2;
    const originY = Number.isFinite(origin[1]) ? origin[1] * scale : rect.height / 2;
    return { pointerX: clientX - (rect.left + originX - state.panX), pointerY: clientY - (rect.top + originY - state.panY) };
}

/** One step through a viewer's gallery: back (‹, ←) or forward (›, →). */
export type LightboxGalleryStep = -1 | 1;

/**
 * The item a step lands on in a gallery of `total` items. It wraps around at both ends (PhotoSwipe's `loop`); from an
 * item no longer in the gallery, forward starts at the first and back at the last. -1 for an empty gallery.
 */
export function lightboxGalleryIndex(index: number, total: number, step: LightboxGalleryStep): number {
    if (!Number.isInteger(total) || total < 1) return -1;
    if (!Number.isInteger(index) || index < 0 || index >= total) return step > 0 ? 0 : total - 1;
    return (index + step + total) % total;
}

export type LightboxKeyAction = 'close' | 'previous' | 'next';

/**
 * What a key does while a viewer is open: Escape closes it; ← and → step back and forward. Physical directions in
 * every language, like the ‹ › buttons on the left and right edges; never with Ctrl, Alt or ⌘ held (system and
 * app shortcuts), nor while an input method is composing.
 */
export function lightboxKeyAction(event: Pick<KeyboardEvent, 'key'> & Partial<Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'isComposing'>>): LightboxKeyAction | undefined {
    if (event.isComposing) return undefined;
    if (event.key === 'Escape') return 'close';
    if (event.altKey || event.ctrlKey || event.metaKey) return undefined;
    return event.key === 'ArrowLeft' ? 'previous' : event.key === 'ArrowRight' ? 'next' : undefined;
}

/**
 * A gallery is the container a viewer was opened from (a conversation's messages, the 素材 panel, a composer's
 * attachments): the images and videos clickable inside it, in document order, are what ‹ › step through, the way
 * PhotoSwipe builds a gallery from a container's children. Items carry data-nmx-gallery="image" | "video";
 * pictures in rendered messages and the preview buttons of attachment chips count without a mark.
 */
export const LIGHTBOX_GALLERY_ROOT = '[data-nmx-gallery-root]';
const LIGHTBOX_GALLERY_ITEM = '[data-nmx-gallery], .nmx-assistant-markdown img, .nmx-user-markdown img, .nmx-attachment-chip > .nmx-attachment-preview';

/** The kind of a gallery item, or undefined when it does not open in a viewer (an unmarked or unavailable item). */
export function lightboxGalleryKind(element: Element): 'image' | 'video' | undefined {
    const marked = element.getAttribute('data-nmx-gallery');
    if (marked !== null) return marked === 'image' || marked === 'video' ? marked : undefined;
    // A chip opens its picture or clip large; a folded paste or a document chip opens something else.
    if (element.classList.contains('nmx-attachment-preview')) {
        const family = element.parentElement?.getAttribute('data-file-family');
        return family === 'image' || family === 'video' ? family : undefined;
    }
    // A picture in a message opens on click unless it sits in a link, a button or a site icon (handleAssistantContentClick).
    if (element.tagName !== 'IMG' || element.closest('a, button, .nmx-site-icon')) return undefined;
    return element.getAttribute('data-nmx-local-src') || element.getAttribute('src') ? 'image' : undefined;
}

/** A gallery's items in document order: its own (not a nested gallery's), viewable, and on screen (not in a closed fold). */
export function lightboxGalleryItems(root: Element): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(LIGHTBOX_GALLERY_ITEM)).filter(element =>
        element.closest(LIGHTBOX_GALLERY_ROOT) === root && lightboxGalleryKind(element) !== undefined
        && !element.parentElement?.closest('[data-nmx-gallery]')
        && (typeof element.getClientRects !== 'function' || element.getClientRects().length > 0));
}

/** The gallery item a click on `target` opens, with its gallery; undefined outside any gallery. */
export function lightboxGalleryOrigin(target: EventTarget | null): { readonly root: Element; readonly element: HTMLElement } | undefined {
    const start = target && typeof (target as Partial<Element>).closest === 'function' ? target as Element : undefined;
    const element = start?.closest<HTMLElement>(LIGHTBOX_GALLERY_ITEM) || undefined;
    const root = element?.closest(LIGHTBOX_GALLERY_ROOT) || undefined;
    return element && root && lightboxGalleryKind(element) ? { root, element } : undefined;
}
