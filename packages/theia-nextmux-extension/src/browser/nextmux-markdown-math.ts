import markdownit = require('@theia/core/shared/markdown-it');

/**
 * Math in conversation Markdown.
 *
 * Delimiters follow OpenCode's session Markdown (MIT, packages/ui/src/context/
 * marked-parser.tsx: `\(…\)` inline, `$$ … $$` blocks) plus the two forms
 * models commonly emit, `\[…\]` blocks and `$…$` inline with Pandoc's
 * `tex_math_dollars` rules (no space inside the delimiters, the closing `$`
 * not followed by a digit), so "$5 and $10" stays prose.
 *
 * The desktop does not bundle a TeX engine; formulas are shown as readable
 * Unicode in a math font. The TeX → Unicode table is a subset of unicodeit
 * (MIT, Copyright (c) 2010 Sven Kreiss, github.com/svenkreiss/unicodeit).
 * The original TeX stays available as the element title and for copying.
 */

type MarkdownIt = ReturnType<typeof markdownit>;

const SYMBOLS: Readonly<Record<string, string>> = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
    iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ',
    varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    times: '×', cdot: '⋅', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆', circ: '∘', bullet: '∙',
    le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝',
    ll: '≪', gg: '≫', infty: '∞', partial: '∂', nabla: '∇', sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', oint: '∮',
    to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔',
    implies: '⟹', iff: '⟺', mapsto: '↦', uparrow: '↑', downarrow: '↓',
    in: '∈', notin: '∉', ni: '∋', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', cup: '∪', cap: '∩', setminus: '∖',
    forall: '∀', exists: '∃', nexists: '∄', emptyset: '∅', varnothing: '∅', neg: '¬', lnot: '¬', land: '∧', wedge: '∧', lor: '∨', vee: '∨',
    oplus: '⊕', otimes: '⊗', perp: '⊥', parallel: '∥', angle: '∠', triangle: '△', degree: '°', prime: '′',
    ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', dots: '…', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ',
    langle: '⟨', rangle: '⟩', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', mid: '∣', vert: '|', Vert: '‖',
    quad: ' ', qquad: '  ', ',': ' ', ':': ' ', ';': ' ', '!': '', ' ': ' ',
    '{': '{', '}': '}', '%': '%', '$': '$', '#': '#', '&': '&', '_': '_', backslash: '\\',
    sin: 'sin', cos: 'cos', tan: 'tan', log: 'log', ln: 'ln', exp: 'exp', lim: 'lim', max: 'max', min: 'min', det: 'det', arg: 'arg',
    sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', arcsin: 'arcsin', arccos: 'arccos', arctan: 'arctan', gcd: 'gcd', sup: 'sup', inf: 'inf'
};
const BLACKBOARD: Readonly<Record<string, string>> = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ', H: 'ℍ' };
const SUPERSCRIPT: Readonly<Record<string, string>> = {
    0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
    a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ', n: 'ⁿ', o: 'ᵒ', p: 'ᵖ',
    r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ', T: 'ᵀ', '′': '′', '*': '*'
};
const SUBSCRIPT: Readonly<Record<string, string>> = {
    0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
    a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ'
};

/** Reads one TeX argument (a `{…}` group or a single token) starting at `index`. */
function argument(tex: string, index: number): { value: string; end: number } {
    while (tex[index] === ' ') index++;
    if (tex[index] === '{') {
        let depth = 0;
        for (let cursor = index; cursor < tex.length; cursor++) {
            if (tex[cursor] === '\\') { cursor++; continue; }
            if (tex[cursor] === '{') depth++;
            else if (tex[cursor] === '}' && --depth === 0) return { value: tex.slice(index + 1, cursor), end: cursor + 1 };
        }
        return { value: tex.slice(index + 1), end: tex.length };
    }
    if (tex[index] === '\\') {
        const name = /^\\(?:[A-Za-z]+|.)/.exec(tex.slice(index))?.[0] || '\\';
        return { value: name, end: index + name.length };
    }
    return { value: tex[index] || '', end: index + 1 };
}

function scripted(value: string, table: Readonly<Record<string, string>>, marker: string): string {
    const chars = [...value];
    if (chars.length && chars.every(char => table[char])) return chars.map(char => table[char]).join('');
    return chars.length === 1 ? `${marker}${value}` : `${marker}(${value})`;
}

const grouped = (value: string): string => [...value].length > 1 && !/^[\p{L}\p{N}]+$/u.test(value) ? `(${value})` : value;

const CALLIGRAPHIC: Readonly<Record<string, string>> = {
    A: '𝒜', B: 'ℬ', C: '𝒞', D: '𝒟', E: 'ℰ', F: 'ℱ', G: '𝒢', H: 'ℋ', I: 'ℐ', J: '𝒥', K: '𝒦', L: 'ℒ', M: 'ℳ',
    N: '𝒩', O: '𝒪', P: '𝒫', Q: '𝒬', R: 'ℛ', S: '𝒮', T: '𝒯', U: '𝒰', V: '𝒱', W: '𝒲', X: '𝒳', Y: '𝒴', Z: '𝒵'
};

/** Reads an optional `[…]` bracket argument starting at `index`. */
function optionalArgument(tex: string, index: number): { value: string; end: number } | undefined {
    while (tex[index] === ' ') index++;
    if (tex[index] !== '[') return undefined;
    let depth = 0;
    for (let cursor = index; cursor < tex.length; cursor++) {
        if (tex[cursor] === '\\') { cursor++; continue; }
        if (tex[cursor] === '[') depth++;
        else if (tex[cursor] === ']' && --depth === 0) return { value: tex.slice(index + 1, cursor), end: cursor + 1 };
    }
    return undefined;
}

/** Finds the matching `\end{env}` for a `\begin{env}` body starting at `bodyStart`. */
function findEnvironmentEnd(tex: string, env: string, bodyStart: number): { body: string; end: number } {
    let depth = 1;
    let cursor = bodyStart;
    while (cursor < tex.length) {
        const nextSlash = tex.indexOf('\\', cursor);
        if (nextSlash < 0) break;
        const match = /^\\(begin|end)\s*\{([^}]*)\}/.exec(tex.slice(nextSlash));
        if (!match) {
            cursor = nextSlash + 1;
            continue;
        }
        const kind = match[1];
        const name = match[2].trim();
        if (name === env) {
            if (kind === 'begin') depth++;
            else if (--depth === 0) {
                return { body: tex.slice(bodyStart, nextSlash), end: nextSlash + match[0].length };
            }
        }
        cursor = nextSlash + match[0].length;
    }
    return { body: tex.slice(bodyStart), end: tex.length };
}

function renderEnvironmentUnicode(env: string, rawBody: string): string {
    const body = rawBody.replace(/^\{[^}]*\}/, '');
    const rows = body
        .split(/\\\\(?:\s*\[[^\]]*\])?/)
        .map(row => row.trim())
        .filter(Boolean);
    if (/^(?:cases|dcases|rcases)$/.test(env)) {
        const formatted = rows.map(row => row.split('&').map(cell => texToUnicode(cell).trim()).filter(Boolean).join(', ')).join('; ');
        return env === 'rcases' ? `{ ${formatted} }` : `{ ${formatted}`;
    }
    const matrixWrappers: Readonly<Record<string, readonly [string, string]>> = {
        pmatrix: ['(', ')'],
        bmatrix: ['[', ']'],
        Bmatrix: ['{', '}'],
        vmatrix: ['|', '|'],
        Vmatrix: ['‖', '‖'],
        matrix: ['[', ']'],
        smallmatrix: ['(', ')']
    };
    if (matrixWrappers[env]) {
        const [open, close] = matrixWrappers[env];
        const formatted = rows.map(row => row.split('&').map(cell => texToUnicode(cell).trim()).filter(Boolean).join(', ')).join('; ');
        return `${open}${formatted}${close}`;
    }
    return rows.map(row => row.split('&').map(cell => texToUnicode(cell).trim()).filter(Boolean).join(' ')).join('; ');
}

/** Readable Unicode for a TeX formula (best effort; unknown commands keep their name). */
export function texToUnicode(tex: string, markUpright = false): string {
    let out = '';
    for (let index = 0; index < tex.length;) {
        const char = tex[index];
        if (char === '^' || char === '_') {
            const arg = argument(tex, index + 1);
            out += scripted(texToUnicode(arg.value, false), char === '^' ? SUPERSCRIPT : SUBSCRIPT, char);
            index = arg.end;
            continue;
        }
        if (char === '{' || char === '}') { index++; continue; }
        if (char === '&') { out += ' '; index++; continue; }
        if (char === '~') { out += ' '; index++; continue; }
        if (char !== '\\') { out += char; index++; continue; }
        const name = /^\\([A-Za-z]+|.)/.exec(tex.slice(index))?.[1] || '';
        index += 1 + name.length;
        if (name === 'begin') {
            const envArg = argument(tex, index);
            const envName = envArg.value.trim();
            const found = findEnvironmentEnd(tex, envName, envArg.end);
            out += renderEnvironmentUnicode(envName, found.body);
            index = found.end;
        } else if (name === 'end') {
            const envArg = argument(tex, index);
            index = envArg.end;
        } else if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
            const top = argument(tex, index), bottom = argument(tex, top.end);
            out += `${grouped(texToUnicode(top.value, markUpright))}/${grouped(texToUnicode(bottom.value, markUpright))}`;
            index = bottom.end;
        } else if (name === 'binom' || name === 'tbinom' || name === 'dbinom') {
            const top = argument(tex, index), bottom = argument(tex, top.end);
            out += `C(${texToUnicode(top.value, markUpright)}, ${texToUnicode(bottom.value, markUpright)})`;
            index = bottom.end;
        } else if (name === 'sqrt') {
            const deg = optionalArgument(tex, index);
            const arg = argument(tex, deg ? deg.end : index);
            const degText = deg ? texToUnicode(deg.value, false).trim() : '';
            const prefix = !degText ? '√' : degText === '3' ? '∛' : degText === '4' ? '∜' : `${scripted(degText, SUPERSCRIPT, '^')}√`;
            out += `${prefix}${grouped(texToUnicode(arg.value, markUpright))}`;
            index = arg.end;
        } else if (name === 'pmod') {
            const arg = argument(tex, index);
            out += ` (mod ${texToUnicode(arg.value, markUpright)})`;
            index = arg.end;
        } else if (name === 'bmod') {
            out += ' mod ';
        } else if (name === 'mathbb') {
            const arg = argument(tex, index);
            out += [...arg.value].map(letter => BLACKBOARD[letter] || letter).join('');
            index = arg.end;
        } else if (name === 'mathcal') {
            const arg = argument(tex, index);
            out += [...arg.value].map(letter => CALLIGRAPHIC[letter] || letter).join('');
            index = arg.end;
        } else if (/^(?:text|textrm|textit|textbf|texttt|textsf|mathrm|mathit|mathbf|mathsf|mathtt|operatorname|mbox|boldsymbol|bm|vec|overrightarrow|overleftarrow|hat|widehat|bar|overline|underline|tilde|widetilde|dot|ddot)$/.test(name)) {
            const arg = argument(tex, index);
            const isLiteralText = /^(?:text|textrm|textit|textbf|texttt|textsf|mbox)$/.test(name);
            const isUprightSpan = /^(?:text|textrm|textbf|texttt|textsf|mathrm|mathsf|mathtt|operatorname|mbox)$/.test(name);
            const inner = isLiteralText ? arg.value : texToUnicode(arg.value, markUpright && !isUprightSpan);
            const combined = name === 'vec' || name === 'overrightarrow' ? `${inner}⃗`
                : name === 'overleftarrow' ? `${inner}⃖`
                : name === 'hat' || name === 'widehat' ? `${inner}̂`
                : name === 'bar' || name === 'overline' ? `${inner}̅`
                : name === 'underline' ? `${inner}̲`
                : name === 'tilde' || name === 'widetilde' ? `${inner}̃`
                : name === 'dot' ? `${inner}̇`
                : name === 'ddot' ? `${inner}̈`
                : inner;
            out += markUpright && isUprightSpan ? `\uE000${combined}\uE001` : combined;
            index = arg.end;
        } else if (name === 'left' || name === 'right' || name === 'big' || name === 'Big' || name === 'bigg' || name === 'Bigg' || name === 'displaystyle' || name === 'textstyle' || name === 'limits' || name === 'nolimits') {
            if ((name === 'left' || name === 'right') && tex[index] === '.') index++;
        } else if (name === '\\') {
            const spacing = /^\s*\[[^\]]*\]/.exec(tex.slice(index));
            if (spacing) index += spacing[0].length;
            out += '; ';
        } else out += SYMBOLS[name] ?? name;
    }
    return out.replace(/[ \t]*(\uE001)[ \t]+/g, '$1 ').replace(/[ \t]+(\uE000)[ \t]*/g, ' $1').replace(/[ \t]+/g, ' ').replace(/\s*;\s*;/g, ';').trim();
}

const HTML: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, char => HTML[char]);

const FUNCTION_NAMES = new Set(['sin', 'cos', 'tan', 'log', 'ln', 'exp', 'lim', 'max', 'min', 'det', 'arg', 'sinh', 'cosh', 'tanh',
    'arcsin', 'arccos', 'arctan', 'gcd', 'sup', 'inf', 'mod', 'dim', 'ker', 'deg', 'hom', 'Pr']);

function formatItalicMathVariables(segment: string): string {
    return segment.split(/([A-Za-z]+[\u0300-\u036f\u20d0-\u20ff]*)/).map((part, index) => {
        if (index % 2 === 0) return escapeHtml(part);
        const base = part.replace(/[\u0300-\u036f\u20d0-\u20ff]+/g, '');
        return FUNCTION_NAMES.has(base) ? escapeHtml(part) : `<i>${escapeHtml(part)}</i>`;
    }).join('');
}

/** TeX convention: Latin letters are italic variables; digits, operators, upright spans, and function names stay upright. */
function mathHtml(unicode: string): string {
    return unicode.split(/(\uE000[\s\S]*?\uE001)/).map((chunk, idx) => {
        if (idx % 2 === 1) {
            return escapeHtml(chunk.slice(1, -1));
        }
        return formatItalicMathVariables(chunk);
    }).join('');
}

function renderMath(tex: string, display: boolean): string {
    const source = tex.trim();
    const tag = display ? 'div' : 'span';
    return `<${tag} class="${display ? 'nmx-md-math' : 'nmx-md-math-inline'}" role="math" dir="ltr" title="${escapeHtml(source)}" aria-label="${escapeHtml(source)}">${mathHtml(texToUnicode(source, true))}</${tag}>${display ? '\n' : ''}`;
}

/** markdown-it plugin: `$$…$$` / `\[…\]` blocks and `\(…\)` / `$…$` inline math. */
export function markdownMath(md: MarkdownIt): void {
    md.inline.ruler.before('escape', 'nmx_math_inline', (state, silent) => {
        const src = state.src, start = state.pos;
        let open: string, close: string;
        if (src.startsWith('\\(', start)) { open = '\\('; close = '\\)'; }
        else if (src[start] === '$' && src[start + 1] !== '$') {
            open = '$'; close = '$';
            // Pandoc tex_math_dollars: "$" followed by a non-space and not preceded by a digit or "$".
            if (!src[start + 1] || /\s/.test(src[start + 1]) || (start > 0 && /[\d$\\]/.test(src[start - 1]))) return false;
        } else return false;
        let end = start + open.length;
        for (; end < src.length; end++) {
            if (src[end] === '\\' && close === '$') { end++; continue; }
            if (src.startsWith(close, end)) break;
        }
        if (end >= src.length) return false;
        const content = src.slice(start + open.length, end);
        if (!content.trim() || content.includes('\n\n')) return false;
        if (close === '$') {
            // Single-dollar inline math cannot span across newlines, end with whitespace, or be followed by a digit/word character.
            if (content.includes('\n')) return false;
            if (/\s/.test(src[end - 1]) || /[0-9A-Za-z_]/.test(src[end + 1] || '')) return false;
            // Reject bare numbers like "$50$" and currency-prefixed prose spans (e.g. "$100，公式为$x$", "$100 ($x$)", "$100 for Basic").
            if (/^\d+(?:[.,]\d+)*$/.test(content.trim())) return false;
            const strippedTexText = content.replace(/\\(?:text|textrm|mathrm|mbox)\s*\{[^{}]*\}/g, '');
            if (/[\u3000-\u303f\uff00-\uffef]/.test(strippedTexText)) return false;
            if (/^\d+(?:[.,]\d+)*(?:[kmbKMB]\b)?(?:\s*[,，;；:：/\\~～—–-]\s*[A-Za-z\u3400-\u9fff]|\s+[A-Za-z\u3400-\u9fff]{2,}|\s*[\u3400-\u9fff（(])/.test(strippedTexText) && !/[\\^_=+<>]/.test(strippedTexText)) return false;
            if (!/[\\^_=+<>]|\d.*[+\-*/=<>^_]|[+\-*/=<>^_].*\d|^\s*[A-Za-z](?:[0-9_^*+\-/=<>()\sA-Za-z]*)?\s*$/.test(content)) return false;
        }
        if (!silent) {
            const token = state.push('nmx_math_inline', 'span', 0);
            token.content = content;
            token.markup = open;
        }
        state.pos = end + close.length;
        return true;
    });
    md.block.ruler.before('fence', 'nmx_math_block', (state, startLine, endLine, silent) => {
        const lineStart = state.bMarks[startLine] + state.tShift[startLine];
        if (state.sCount[startLine] - state.blkIndent >= 4) return false;
        const first = state.src.slice(lineStart, state.eMarks[startLine]);
        const open = first.startsWith('$$') ? '$$' : first.startsWith('\\[') ? '\\[' : '';
        if (!open) return false;
        const close = open === '$$' ? '$$' : '\\]';
        let rest = first.slice(open.length);
        let content = '';
        let line = startLine;
        const closing = rest.trimEnd().endsWith(close) && rest.trim().length >= close.length;
        if (closing) {
            content = rest.trimEnd().slice(0, -close.length);
            if (!content.trim() && open === '$$' && rest.trim() === '$$') return false;
        } else {
            const lines = [rest];
            let found = false;
            for (line = startLine + 1; line < endLine; line++) {
                const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
                if (state.sCount[line] < state.blkIndent && text.trim()) break;
                const at = text.trimEnd().lastIndexOf(close);
                if (at >= 0 && at === text.trimEnd().length - close.length) { lines.push(text.trimEnd().slice(0, at)); found = true; break; }
                lines.push(text);
            }
            if (!found) return false;
            content = lines.join('\n');
        }
        if (!content.trim()) return false;
        if (silent) return true;
        const token = state.push('nmx_math_block', 'div', 0);
        token.block = true;
        token.content = content;
        token.map = [startLine, line + 1];
        token.markup = open;
        state.line = line + 1;
        return true;
    }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
    md.renderer.rules.nmx_math_inline = (tokens, index) => renderMath(tokens[index].content, false);
    md.renderer.rules.nmx_math_block = (tokens, index) => renderMath(tokens[index].content, true);
}
