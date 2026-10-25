/**
 * DOM walk for the desktop surface translator.
 *
 * The translator replaces known Chinese source strings in rendered UI chrome.
 * User content must never be rewritten: file text in Monaco, terminal rows in
 * xterm and anything marked `data-nmx-literal` are skipped as whole subtrees
 * (a TreeWalker `FILTER_REJECT`, the same technique VS Code uses to exclude
 * editor view lines from DOM scans), so opening a Chinese Markdown file in an
 * English UI shows the file exactly as written.
 */

/**
 * Subtrees that hold user, model or file content: messages, pasted text, code and editors. Neither their text nor
 * their attributes are translated, so a model name such as "fable5.1" or a pasted snippet stays exactly as written.
 */
export const SURFACE_CONTENT_SELECTOR = '[data-nmx-literal], .monaco-editor, .xterm, .nmx-terminal-host, pre, code, .nmx-user-markdown, .nmx-assistant-markdown, .nmx-message-pasted-chip';

/** Fields hold what the user typed: their text is never translated, while their placeholder, title and label are chrome. */
export const SURFACE_FIELD_SELECTOR = 'textarea, input, [contenteditable="true"]';

/** Every subtree whose text the translator never enters. */
export const SURFACE_LITERAL_SELECTOR = `${SURFACE_CONTENT_SELECTOR}, ${SURFACE_FIELD_SELECTOR}`;

/** True when `element` or one of its ancestors holds content, so its attributes stay as written too. */
export function isSurfaceLiteral(element: Element | null | undefined): boolean {
    return Boolean(element?.closest(SURFACE_CONTENT_SELECTOR));
}

/** Visits every translatable text node under `root`, never entering literal subtrees. */
export function forEachSurfaceTextNode(root: Element, visit: (node: Text) => void): void {
    if (isSurfaceLiteral(root)) return;
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: node => node.nodeType === Node.ELEMENT_NODE
            ? (node as Element).matches(SURFACE_LITERAL_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP
            : NodeFilter.FILTER_ACCEPT
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) visit(node as Text);
}
