/** Display Command shortcuts using the current desktop's primary modifier. Does not change key handling. */
export function platformShortcutText(text: string, platform = typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent): string {
    return /Mac|iPhone|iPad/i.test(platform)
        ? text : text.replace(/⇧⌘/g, 'Ctrl+Shift+').replace(/⌘(\s?\+\s?|\s?)/g, 'Ctrl+');
}
