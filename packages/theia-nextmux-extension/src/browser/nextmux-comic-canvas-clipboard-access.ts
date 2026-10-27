/** Reuse the desktop's existing preload bridge; browser Clipboard API permissions may be denied in Electron. */
interface NativeClipboard {
    readonly writeClipboard?: (text: string) => void | Promise<void>;
    readonly readClipboard?: () => string | Promise<string>;
}

function nativeClipboard(): NativeClipboard | undefined {
    return (window as Window & { readonly electronTheiaCore?: NativeClipboard }).electronTheiaCore;
}

export async function writeCanvasClipboardText(text: string): Promise<void> {
    const native = nativeClipboard();
    if (native?.writeClipboard) { await native.writeClipboard(text); return; }
    if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE');
    await navigator.clipboard.writeText(text);
}

export async function readCanvasClipboardText(): Promise<string> {
    const native = nativeClipboard();
    if (native?.readClipboard) return await native.readClipboard();
    if (!navigator.clipboard?.readText) throw new Error('CLIPBOARD_UNAVAILABLE');
    return await navigator.clipboard.readText();
}

/** Keyboard fallback is desktop-only; normal browser paste retains its native files and permissions. */
export async function readNativeCanvasClipboardText(): Promise<string | undefined> {
    const native = nativeClipboard();
    return native?.readClipboard ? await native.readClipboard() : undefined;
}
