import stripAnsi = require('strip-ansi');

const MAX_ESCAPE_CARRY_CHARS = 512;
const INCOMPLETE_ESCAPE_SUFFIX = /\u001b(?:|\[[\x30-\x3f]*[\x20-\x2f]*|\[H\r?|\][^\u0007\u001b]*(?:\u001b)?|[PX^_][^\u0007\u001b]*(?:\u001b)?|[()*+\-./])$/;

function collapseCarriageReturnLine(line: string): string {
    if (!line.includes('\r')) return line;
    const frames = line.split('\r');
    for (let index = frames.length - 1; index >= 0; index -= 1) {
        if (frames[index].length > 0) return frames[index];
    }
    return '';
}

/**
 * Converts ConPTY's terminal screen-diff stream into the append-only text that
 * agent tools and the compact command transcript consume. The actual Theia
 * terminal continues to receive the original bytes, so this does not replace
 * or emulate the user's interactive shell.
 */
export class NextMuxTerminalOutputNormalizer {
    readonly #expectedEcho: string;
    readonly #internalMarkerId: string;
    #echoBuffer = '';
    #escapeCarry = '';
    #waitingForEcho: boolean;
    #emittedVisibleOutput = false;
    /** The transcript's last line has no newline yet. */
    #lineOpen = false;
    /** The previous write ended with a bare carriage return: what follows rewrites the line already shown. */
    #returnPending = false;

    constructor(expectedEcho = '', internalMarkerId = '') {
        this.#expectedEcho = expectedEcho;
        this.#internalMarkerId = internalMarkerId;
        this.#waitingForEcho = Boolean(expectedEcho);
    }

    push(value: string): string {
        let source = value.replace(/\0/g, '');
        if (!source) return '';
        if (this.#waitingForEcho) {
            this.#echoBuffer += source;
            const buffered = this.#echoBuffer;
            if (this.#expectedEcho.startsWith(buffered)) return '';
            if (buffered.startsWith(this.#expectedEcho)) {
                const remainder = buffered.slice(this.#expectedEcho.length);
                const newline = /^(?:\r\n|\n|\r)/.exec(remainder);
                if (!newline) return '';
                source = remainder.slice(newline[0].length);
            } else {
                // Some shells disable command echo. Do not discard the first
                // real output chunk merely because the expected echo is absent.
                source = buffered;
            }
            this.#echoBuffer = '';
            this.#waitingForEcho = false;
        }

        if (this.#escapeCarry) {
            source = this.#escapeCarry + source;
            this.#escapeCarry = '';
        }
        const incompleteEscape = INCOMPLETE_ESCAPE_SUFFIX.exec(source);
        if (incompleteEscape && incompleteEscape[0].length <= MAX_ESCAPE_CARRY_CHARS) {
            this.#escapeCarry = incompleteEscape[0];
            source = source.slice(0, source.length - incompleteEscape[0].length);
            if (!source) return '';
        }

        return this.#render(source);
    }

    /**
     * Ends the command: output held back while the echo was unconfirmed is returned. An escape sequence that never
     * finished shows nothing on a terminal either, so it is dropped; it may be the start of this run's private
     * completion marker, which must not reach the transcript.
     */
    flush(): string {
        this.#escapeCarry = '';
        if (!this.#waitingForEcho) return '';
        const buffered = this.#echoBuffer;
        this.#echoBuffer = '';
        this.#waitingForEcho = false;
        if (!buffered || this.#expectedEcho.startsWith(buffered)) return '';
        return this.#render(buffered.startsWith(this.#expectedEcho) ? buffered.slice(this.#expectedEcho.length) : buffered);
    }

    #render(source: string): string {
        // ConPTY emits a cursor-home followed by LF when a logical line wraps
        // at the hidden terminal width. Removing that synthetic boundary keeps
        // identifiers and log records intact. Real process newlines do not use
        // this cursor-home prefix and remain line breaks.
        const unwrapped = source
            .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, '')
            .replace(/\u001b\[H(?:\r\n|\n|\r)/g, '');
        const stripped = stripAnsi(unwrapped)
            .replace(/\r\n/g, '\n')
            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
        const rawLines = stripped.split('\n');
        // The transcript only appends: a carriage return that rewrites the line already shown (a progress bar redrawn
        // in its own write) continues on a new line, and the frames within one write collapse to the last one.
        const rewritesShownLine = this.#returnPending || rawLines[0].includes('\r');
        const lastLine = rawLines[rawLines.length - 1];
        if (lastLine.endsWith('\r')) this.#returnPending = true;
        else if (lastLine || rawLines.length > 1) this.#returnPending = false;
        let normalized = stripped.includes('\r') ? rawLines.map(collapseCarriageReturnLine).join('\n') : stripped;
        if (this.#internalMarkerId) {
            // Only this run's own random marker identifies an echoed or repainted probe (audit B06-06): program
            // output that merely mentions "__nextmux_" or "Console]::Write" is kept. Probe text that wrapped onto
            // the lines right next to a marker line goes with it; everything else in the chunk stays.
            const marker = this.#internalMarkerId;
            const fragments = [marker, marker.slice(-24), marker.slice(0, 16)];
            const genericNeedles = ['$__nextmux', '__nextmux_', 'NextMuxStart;', ']777;NextMux;', 'Console]::Write'];
            const lines = normalized.split('\n');
            const isMarker = lines.map(line => fragments.some(fragment => fragment && line.includes(fragment)));
            if (isMarker.some(Boolean)) {
                const drop = isMarker.slice();
                for (let index = 0; index < lines.length; index++) {
                    if (!isMarker[index]) continue;
                    for (const step of [-1, 1]) {
                        for (let next = index + step; next >= 0 && next < lines.length && !drop[next]
                            && genericNeedles.some(needle => lines[next].includes(needle)); next += step) drop[next] = true;
                    }
                }
                normalized = lines.filter((_line, index) => !drop[index]).join('\n');
            }
        }
        if (!this.#emittedVisibleOutput) {
            if (!normalized.trim()) return '';
            normalized = normalized.replace(/^\n+/, '');
            this.#emittedVisibleOutput = true;
        } else if (rewritesShownLine && this.#lineOpen && normalized && !normalized.startsWith('\n')) {
            normalized = `\n${normalized}`;
        }
        if (normalized) this.#lineOpen = !normalized.endsWith('\n');
        return normalized;
    }
}
