import * as React from '@theia/core/shared/react';

/**
 * Keeps the transcript's last message clear of the floating composer. The
 * composer grows with attachments, pasted-text chips, queued follow-ups and
 * long drafts; a fixed bottom padding let it cover the latest reply.
 *
 * The overlap is measured, written to `--nmx-composer-clearance` on the shell,
 * and when the reader was at the bottom before the composer grew, the
 * transcript is kept pinned to the bottom (the same stick-to-bottom intent the
 * thread already follows for streaming output). A reader who scrolled up to
 * older messages is left where they are.
 */
export function observeComposerClearance(anchor: HTMLElement, gap = 28): () => void {
    const shell = anchor.closest<HTMLElement>('.nmx-shell');
    const view = anchor.ownerDocument.defaultView;
    const composer = anchor.closest<HTMLElement>('.nmx-composer-wrap');
    if (!shell || !view || !composer) return () => undefined;
    let frame = 0;
    let previous = -1;
    let disposed = false;
    const thread = (): HTMLElement | null => shell.querySelector<HTMLElement>('.nmx-task-view');
    const measure = (): void => {
        frame = 0;
        if (disposed || !anchor.isConnected) return;
        const scroller = thread();
        if (!scroller) return;
        const box = composer.querySelector<HTMLElement>('.nmx-composer');
        if (box) shell.style.setProperty('--nmx-composer-box-height', `${Math.ceil(box.getBoundingClientRect().height)}px`);
        const overlap = Math.max(0, scroller.getBoundingClientRect().bottom - composer.getBoundingClientRect().top);
        const clearance = Math.ceil(overlap + gap);
        if (clearance === previous) return;
        const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
        const pinned = distanceFromBottom <= Math.max(96, previous > 0 ? Math.abs(clearance - previous) + 24 : 96);
        const grew = clearance > previous;
        previous = clearance;
        shell.style.setProperty('--nmx-composer-clearance', `${clearance}px`);
        if (pinned && grew) {
            view.requestAnimationFrame(() => {
                if (disposed) return;
                const current = thread();
                if (current) current.scrollTop = current.scrollHeight;
            });
        }
    };
    const schedule = (): void => {
        if (!frame && !disposed) frame = view.requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(composer);
    const scroller = thread();
    if (scroller) observer.observe(scroller);
    // The transcript is remounted per conversation; re-attach when it changes.
    const mutations = new MutationObserver(() => {
        const current = thread();
        if (current && current !== observed) { observed = current; observer.observe(current); schedule(); }
    });
    let observed = scroller;
    mutations.observe(shell, { childList: true, subtree: true });
    schedule();
    return () => {
        disposed = true;
        observer.disconnect();
        mutations.disconnect();
        if (frame) view.cancelAnimationFrame(frame);
        shell.style.removeProperty('--nmx-composer-clearance');
        shell.style.removeProperty('--nmx-composer-box-height');
    };
}

export function ComposerClearance(): React.ReactElement {
    const anchor = React.useRef<HTMLSpanElement>(null);
    React.useEffect(() => anchor.current ? observeComposerClearance(anchor.current) : undefined, []);
    return <span ref={anchor} className='nmx-composer-clearance-anchor' aria-hidden='true' />;
}
