import * as monaco from '@theia/monaco-editor-core';
import type { CodeTokenizer } from './nextmux-conversation-markdown';
import { grammars } from './vendor/monaco-languages';

/**
 * Syntax colours for the file drawer editor and reply code blocks.
 *
 * Theia's editor core has no tokenizers of its own; VS Code grammars normally
 * arrive with plugins, which NextMux does not bundle. Theia still registers
 * language ids such as "typescript" without a tokenizer, so "the language is
 * known" does not mean "the language is coloured". Monarch grammars from
 * monaco-editor (MIT, vendored in ./vendor) fill the gap, and a language a
 * plugin already colours keeps the plugin's TextMate grammar.
 */
const EXTENSION_LANGUAGES: Readonly<Record<string, string>> = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
    py: 'python', pyw: 'python', pyi: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', kts: 'kotlin',
    c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', ino: 'cpp', cu: 'cpp',
    cs: 'csharp', csx: 'csharp', rb: 'ruby', rake: 'ruby', gemspec: 'ruby', php: 'php', swift: 'swift',
    sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ksh: 'shell', command: 'shell', ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
    bat: 'bat', cmd: 'bat', html: 'html', htm: 'html', xhtml: 'html', vue: 'html', svelte: 'html', astro: 'html',
    css: 'css', scss: 'scss', sass: 'scss', less: 'less', json: 'json', jsonc: 'json', json5: 'json', jsonl: 'json',
    webmanifest: 'json', ipynb: 'json', yaml: 'yaml', yml: 'yaml', xml: 'xml', svg: 'xml', plist: 'xml', xsd: 'xml', xsl: 'xml',
    csproj: 'xml', md: 'markdown', markdown: 'markdown', mdx: 'markdown', sql: 'sql', graphql: 'graphql', gql: 'graphql',
    toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini', env: 'ini', editorconfig: 'ini', gitconfig: 'ini',
    dockerfile: 'dockerfile', lua: 'lua', dart: 'dart', scala: 'scala', sc: 'scala', sbt: 'scala', r: 'r', pl: 'perl', pm: 'perl',
    m: 'objective-c', mm: 'objective-c', vb: 'vb', proto: 'protobuf', tf: 'hcl', tfvars: 'hcl', hcl: 'hcl',
    ex: 'elixir', exs: 'elixir', clj: 'clojure', cljs: 'clojure', edn: 'clojure', fs: 'fsharp', fsx: 'fsharp', jl: 'julia',
    sol: 'solidity', cshtml: 'razor', hbs: 'handlebars', handlebars: 'handlebars', pug: 'pug', coffee: 'coffeescript',
    tcl: 'tcl', scm: 'scheme', pas: 'pascal', s: 'mips', wgsl: 'wgsl', sv: 'systemverilog', svh: 'systemverilog', v: 'systemverilog'
};
const FILE_NAME_LANGUAGES: Readonly<Record<string, string>> = {
    dockerfile: 'dockerfile', containerfile: 'dockerfile', makefile: 'shell', gemfile: 'ruby', rakefile: 'ruby', podfile: 'ruby',
    '.bashrc': 'shell', '.zshrc': 'shell', '.profile': 'shell', '.gitignore': 'ini', '.npmrc': 'ini', '.env': 'ini'
};

export function editorLanguageForName(name: string): string {
    const lower = name.toLocaleLowerCase();
    if (FILE_NAME_LANGUAGES[lower]) return FILE_NAME_LANGUAGES[lower];
    if (lower.startsWith('dockerfile.') || lower.endsWith('.dockerfile')) return 'dockerfile';
    if (lower.startsWith('.env.')) return 'ini';
    const extension = lower.includes('.') ? lower.split('.').pop() || '' : '';
    return EXTENSION_LANGUAGES[extension] || 'plaintext';
}

/** A compact JSON/JSONC grammar: monaco-editor colours JSON through a worker we do not ship. */
const jsonGrammar = {
    conf: { comments: { lineComment: '//', blockComment: ['/*', '*/'] }, brackets: [['{', '}'], ['[', ']']],
        autoClosingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '"', close: '"' }] },
    language: {
        tokenPostfix: '.json',
        tokenizer: {
            root: [
                [/\/\/.*$/, 'comment'], [/\/\*/, 'comment', '@comment'],
                [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'type'],
                [/"(?:[^"\\]|\\.)*"/, 'string'],
                [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
                [/\b(?:true|false|null)\b/, 'keyword'],
                [/[{}[\],:]/, 'delimiter']
            ],
            comment: [[/[^/*]+/, 'comment'], [/\*\//, 'comment', '@pop'], [/[/*]/, 'comment']]
        }
    }
} as const;

const prepared = new Set<string>();

/** Make sure `language` has a tokenizer before a model is created for it. */
export function ensureEditorLanguage(language: string): void {
    if (prepared.has(language) || language === 'plaintext') return;
    prepared.add(language);
    const load = language === 'json' ? () => jsonGrammar : (grammars as Record<string, (() => { conf: unknown; language: unknown }) | undefined>)[language];
    if (!load) return;
    try {
        const known = monaco.languages.getLanguages().some(item => item.id === language);
        // A plugin that registered the language also brings its grammar; keep it.
        if (known && hasTokenizer(language)) return;
        if (!known) monaco.languages.register({ id: language });
        const grammar = load();
        monaco.languages.setMonarchTokensProvider(language, grammar.language as monaco.languages.IMonarchLanguage);
        monaco.languages.setLanguageConfiguration(language, grammar.conf as monaco.languages.LanguageConfiguration);
    } catch {
        // Colouring is cosmetic: an editor without it still opens the file.
    }
}

function hasTokenizer(language: string): boolean {
    try {
        const tokens = monaco.editor.tokenize('const x = "1"; // x', language);
        return tokens.length > 0 && tokens[0].some(token => token.type !== '');
    } catch {
        return false;
    }
}

/** Kept for callers that prepare the editor once; languages load on demand. */
export function ensureNextMuxEditorLanguages(): void {
    ensureEditorLanguage('json');
}

/** Reply code blocks reuse the editor's grammars (no extra highlighter). */
export const conversationCodeTokenizer: CodeTokenizer = (code, languageId) => {
    ensureEditorLanguage(languageId);
    if (!monaco.languages.getLanguages().some(language => language.id === languageId)) return undefined;
    return monaco.editor.tokenize(code, languageId);
};
