/**
 * Consistent hover labels for icon-only buttons in the title bar and the
 * workspace controls. Native `title` tooltips do not appear inside the
 * frameless macOS title bar (a window drag region) and appear late elsewhere,
 * so icon buttons there get a small styled label instead. The native title is
 * held back while the label shows, so the two never stack.
 */
const TARGETS = '.nmx-workspace-controls button, .nmx-titlebar-actions button, .nmx-titlebar-context button, [data-nmx-tip]';
const DELAY_MS = 320;

export function installHoverTips(root: HTMLElement): () => void {
    const doc = root.ownerDocument;
    const view = doc.defaultView;
    if (!view) return () => undefined;
    let tip: HTMLDivElement | undefined;
    let target: HTMLElement | undefined;
    let timer = 0;
    let heldTitle: string | null = null;
    const restoreTitle = (): void => {
        if (target && heldTitle !== null && !target.hasAttribute('title')) target.setAttribute('title', heldTitle);
        heldTitle = null;
    };
    const hide = (): void => {
        view.clearTimeout(timer);
        timer = 0;
        restoreTitle();
        tip?.remove();
        tip = undefined;
        target = undefined;
    };
    const show = (element: HTMLElement): void => {
        const text = element.getAttribute('data-nmx-tip') || element.getAttribute('title') || element.getAttribute('aria-label') || '';
        if (!text.trim() || !element.isConnected) return;
        heldTitle = element.getAttribute('title');
        if (heldTitle !== null) element.removeAttribute('title');
        tip = doc.createElement('div');
        tip.className = 'nmx-hover-tip';
        tip.setAttribute('role', 'tooltip');
        tip.textContent = text;
        // The body, not the shell: the widget clips its own overflow and sits
        // under the application title bar. Theme colours come from the shell.
        const shell = element.closest<HTMLElement>('.nmx-shell') || root.querySelector<HTMLElement>('.nmx-shell');
        if (shell) {
            const style = view.getComputedStyle(shell);
            for (const name of ['--nmx-text', '--nmx-panel', '--nmx-border-strong']) {
                const value = style.getPropertyValue(name).trim();
                if (value) tip.style.setProperty(name, value);
            }
        }
        doc.body.appendChild(tip);
        const rect = element.getBoundingClientRect();
        const width = tip.offsetWidth;
        const height = tip.offsetHeight;
        const left = Math.max(6, Math.min(view.innerWidth - width - 6, rect.left + rect.width / 2 - width / 2));
        const below = rect.bottom + 6 + height <= view.innerHeight;
        tip.style.left = `${Math.round(left)}px`;
        tip.style.top = `${Math.round(below ? rect.bottom + 6 : rect.top - height - 6)}px`;
    };
    const over = (event: MouseEvent): void => {
        const element = (event.target as Element | null)?.closest?.(TARGETS) as HTMLElement | null;
        if (!element || !root.contains(element) || element.closest('.nmx-mc-hint') || element === target) return;
        hide();
        target = element;
        timer = view.setTimeout(() => { timer = 0; if (target === element) show(element); }, DELAY_MS);
    };
    const out = (event: MouseEvent): void => {
        if (!target) return;
        const next = event.relatedTarget as Node | null;
        if (next && target.contains(next)) return;
        hide();
    };
    const focus = (event: FocusEvent): void => {
        const element = (event.target as Element | null)?.closest?.(TARGETS) as HTMLElement | null;
        if (!element || !root.contains(element) || element.closest('.nmx-mc-hint')) return;
        hide(); target = element; show(element);
    };
    const labels = new Set<HTMLElement>();
    const updateOverflow = (element: HTMLElement): void => {
        const overflowing = element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1;
        element.toggleAttribute('data-nmx-nav-overflow', overflowing);
    };
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(entries => entries.forEach(entry => updateOverflow(entry.target as HTMLElement)));
    const refreshLabels = (): void => {
        const current = new Set(root.querySelectorAll<HTMLElement>('.nmx-titlebar-primary-nav button > span, .nmx-titlebar-context .nmx-context-entry-tab > span'));
        for (const label of labels) if (!current.has(label)) { resize?.unobserve(label); labels.delete(label); }
        for (const label of current) { if (!labels.has(label)) { labels.add(label); resize?.observe(label); } updateOverflow(label); }
    };
    const changes = new MutationObserver(refreshLabels);
    changes.observe(root, { childList: true, subtree: true, characterData: true });
    refreshLabels();
    root.addEventListener('focusin', focus);
    root.addEventListener('focusout', hide);
    root.addEventListener('mouseover', over);
    root.addEventListener('mouseout', out);
    root.addEventListener('mousedown', hide, true);
    view.addEventListener('blur', hide);
    view.addEventListener('scroll', hide, true);
    return () => {
        hide();
        resize?.disconnect(); changes.disconnect();
        for (const label of labels) label.removeAttribute('data-nmx-nav-overflow');
        root.removeEventListener('focusin', focus);
        root.removeEventListener('focusout', hide);
        root.removeEventListener('mouseover', over);
        root.removeEventListener('mouseout', out);
        root.removeEventListener('mousedown', hide, true);
        view.removeEventListener('blur', hide);
        view.removeEventListener('scroll', hide, true);
    };
}
