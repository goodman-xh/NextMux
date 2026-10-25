import { previewResolvedEndpointUrl } from '@nextmux/model-runtime/endpoint-url'; // Not the root: it re-exports Node-only agent runtime code.

/**
 * Pure helpers behind Cherry Studio and LobeChat features the desktop uses: the artifact preview in the browser drawer
 * (#7), the Mermaid repair prompt, conversation export (#9) and the request-URL preview under an API address (#10).
 */

export interface PreviewableArtifactDescriptor {
  kind: 'html' | 'svg' | 'mermaid';
  language: string;
  code: string;
  title: string;
  /**
   * A whole page, SVG graphic or Mermaid diagram: opened automatically when a reply finishes. An HTML fragment
   * (a table, a form) is previewable on request only.
   */
  standalone: boolean;
}

/**
 * Cherry Studio #7 + LobeChat #16: the last previewable HTML page, SVG graphic or Mermaid diagram in a reply. A fence
 * left open (a reply cut short) is not a finished artifact.
 */
export function detectPreviewableArtifact(markdown: string): PreviewableArtifactDescriptor | null {
  const source = String(markdown || '');
  if (!source.trim()) {
    return null;
  }
  const fenceRegex = /^([ \t]{0,3})(`{3,}|~{3,})[ \t]*([a-zA-Z0-9_+-]*)[^\n]*\n([\s\S]*?)\n[ \t]{0,3}\2[`~]*[ \t]*$/gm;
  let lastMatch: PreviewableArtifactDescriptor | null = null;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(source)) !== null) {
    const lang = String(match[3] || '').trim().toLowerCase();
    const code = String(match[4] || '').trim();
    if (!code) {
      continue;
    }
    if (lang === 'mermaid') {
      lastMatch = { kind: 'mermaid', language: 'mermaid', code, title: 'Mermaid', standalone: true };
    } else if (lang === 'svg' || ((lang === 'xml' || !lang) && /^(?:<\?xml[^>]*>\s*)?<svg[\s>][\s\S]*<\/svg>$/i.test(code))) {
      lastMatch = { kind: 'svg', language: 'svg', code, title: 'SVG', standalone: true };
    } else if (lang === 'html' || lang === 'htm' || !lang) {
      const page = /^(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\s+html[^>]*>\s*)?<html[\s>]/i.test(code) || /^<!doctype\s+html/i.test(code);
      if (page || (lang && /<(?:div|main|section|body|canvas|style|script|table|form|svg|article|header|nav)[\s>]/i.test(code))) {
        lastMatch = { kind: 'html', language: 'html', code, title: 'HTML', standalone: page };
      }
    }
  }
  return lastMatch;
}

export interface ArtifactPreviewOptions {
  /** The desktop theme a Mermaid diagram follows; pages and SVG graphics keep the white canvas a browser gives them. */
  readonly theme: 'light' | 'dark';
  /** A random token the frame quotes in every message it posts to the drawer. */
  readonly channel: string;
  /** Base64 (UTF-8) of the Mermaid runtime, decoded and run only inside the sandboxed frame. */
  readonly mermaidRuntime?: string;
  /** Shown inside the frame when a diagram cannot be drawn. */
  readonly renderFailed: string;
}

/** A JSON value that is safe inside an inline script: no "</script" or "<!--" can end or bend the element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const PREVIEW_FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",Roboto,sans-serif';

/**
 * The document the browser drawer shows for an artifact. It always runs in a sandboxed frame with scripts but an
 * opaque origin (no access to NextMux, no top navigation); it reports to the drawer only through postMessage on
 * `options.channel`: `{ status: 'ready', svg? }` or `{ status: 'error', message }`.
 */
export function buildArtifactBrowserPreviewHtml(descriptor: PreviewableArtifactDescriptor, options: ArtifactPreviewOptions): string {
  const code = String(descriptor.code || '').trim();
  const channel = scriptJson(options.channel);
  if (descriptor.kind === 'html') {
    if (descriptor.standalone) {
      return code;
    }
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>body{margin:0;padding:16px;font-family:${PREVIEW_FONT};}</style>
</head>
<body>
${code}
</body>
</html>`;
  }
  if (descriptor.kind === 'svg') {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
html,body{height:100%;margin:0;background:#fff;}
#stage{box-sizing:border-box;min-height:100%;padding:24px;display:grid;place-items:center;}
#stage>svg{max-width:100%;max-height:calc(100vh - 48px);height:auto;}
</style>
</head>
<body>
<div id="stage">${code}</div>
<script>
(() => {
  const svg = document.querySelector('#stage > svg');
  parent.postMessage(svg ? { channel: ${channel}, status: 'ready', svg: svg.outerHTML } : { channel: ${channel}, status: 'error', message: 'No <svg> element' }, '*');
})();
</script>
</body>
</html>`;
  }
  const dark = options.theme === 'dark';
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
:root{color-scheme:${dark ? 'dark' : 'light'};}
html,body{min-height:100%;margin:0;}
body{background:${dark ? '#1c1b1c' : '#ffffff'};color:${dark ? '#e8e4e6' : '#2b272a'};font:13px/1.5 ${PREVIEW_FONT};}
#stage{box-sizing:border-box;min-height:100vh;padding:24px;display:grid;place-items:center;overflow:auto;}
#stage>svg{max-width:100%;height:auto;}
.nmx-wait{width:18px;height:18px;border-radius:50%;border:2px solid ${dark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.12)'};border-top-color:${dark ? '#e8e4e6' : '#2b272a'};animation:spin .8s linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}
@media (prefers-reduced-motion:reduce){.nmx-wait{animation:none;}}
.nmx-failed{max-width:560px;width:100%;box-sizing:border-box;padding:14px 16px;border:1px solid ${dark ? 'rgba(229,163,61,.45)' : 'rgba(140,86,25,.35)'};border-radius:10px;background:${dark ? 'rgba(229,163,61,.08)' : 'rgba(140,86,25,.06)'};}
.nmx-failed strong{display:block;margin-bottom:6px;font-size:13px;}
.nmx-failed pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;opacity:.85;}
</style>
</head>
<body>
<div id="stage"><div class="nmx-wait" role="status"></div></div>
<script>window.__nmxMermaid = ${scriptJson(options.mermaidRuntime || '')};</script>
<script>
(async () => {
  const post = data => parent.postMessage({ channel: ${channel}, ...data }, '*');
  const stage = document.getElementById('stage');
  try {
    const bytes = Uint8Array.from(atob(window.__nmxMermaid), c => c.charCodeAt(0));
    delete window.__nmxMermaid;
    (0, eval)(new TextDecoder().decode(bytes));
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: ${dark ? "'dark'" : "'default'"}, fontFamily: ${scriptJson(PREVIEW_FONT)},
      htmlLabels: false, flowchart: { htmlLabels: false } });
    const { svg } = await mermaid.render('nmx-mermaid-diagram', ${scriptJson(code)});
    stage.innerHTML = svg;
    const rendered = stage.querySelector('svg');
    post({ status: 'ready', svg: rendered ? rendered.outerHTML : svg });
  } catch (error) {
    const message = String((error && (error.message || error.str)) || error || '').slice(0, 2000);
    const box = document.createElement('div');
    box.className = 'nmx-failed';
    const title = document.createElement('strong');
    title.textContent = ${scriptJson(options.renderFailed)};
    const detail = document.createElement('pre');
    detail.textContent = message;
    box.append(title, detail);
    stage.replaceChildren(box);
    post({ status: 'error', message });
  }
})();
</script>
</body>
</html>`;
}

/**
 * The message "Fix with AI" puts in the composer for a diagram that would not draw: the instruction (in the user's
 * language, from the caller), the renderer's error and the diagram.
 */
export function buildMermaidRepairPrompt(mermaidCode: string, errorMessage: string | undefined, instruction: string, errorLabel: string): string {
  const cleanCode = String(mermaidCode || '').trim();
  const cleanError = String(errorMessage || '').trim();
  return [
    instruction,
    ...(cleanError ? [`${errorLabel}: ${cleanError}`] : []),
    '```mermaid',
    cleanCode,
    '```'
  ].join('\n');
}

export interface ExportableConversationTurn {
  id?: string;
  prompt?: string;
  response?: string;
  createdAt?: string;
  model?: string;
  pinned?: boolean;
  excludedFromContext?: boolean;
  relayFeedback?: 'up' | 'down' | null;
}

/** The exported document's own words (the caller passes the UI language's); `turn` contains {n}. */
export interface ConversationExportLabels {
  readonly untitled: string;
  readonly turn: string;
  readonly user: string;
  readonly assistant: string;
  readonly pinned: string;
  readonly excluded: string;
  /** The HTML lang attribute. */
  readonly lang: string;
}

const DEFAULT_EXPORT_LABELS: ConversationExportLabels = {
  untitled: '对话记录', turn: '第 {n} 轮', user: '用户', assistant: '助手', pinned: '重点保留', excluded: '已从上下文排除', lang: 'zh-CN'
};

/**
 * Cherry Studio #9: Export conversation turns to clean Markdown (.md).
 */
export function exportConversationToMarkdown(
  title: string,
  turns: readonly ExportableConversationTurn[],
  labels: ConversationExportLabels = DEFAULT_EXPORT_LABELS
): string {
  const safeTitle = String(title || labels.untitled).trim() || labels.untitled;
  const lines: string[] = [`# ${safeTitle}`, ''];
  for (const [index, turn] of (turns || []).entries()) {
    const prompt = String(turn?.prompt || '').trim();
    const response = String(turn?.response || '').trim();
    if (!prompt && !response) {
      continue;
    }
    const badges: string[] = [];
    if (turn?.pinned) badges.push(`📌 ${labels.pinned}`);
    if (turn?.excludedFromContext) badges.push(`🚫 ${labels.excluded}`);
    const badgeSuffix = badges.length ? ` (${badges.join(' · ')})` : '';
    lines.push(`## ${labels.turn.replace('{n}', String(index + 1))}${badgeSuffix}`, '');
    if (prompt) {
      lines.push(`### ${labels.user}`, '', prompt, '');
    }
    if (response) {
      lines.push(`### ${labels.assistant}`, '', response, '');
    }
  }
  return `${lines.join('\n').trim()}\n`;
}

function escapeHtmlText(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Cherry Studio #9: Export conversation turns to standalone HTML (.html).
 */
export function exportConversationToHtml(
  title: string,
  turns: readonly ExportableConversationTurn[],
  labels: ConversationExportLabels = DEFAULT_EXPORT_LABELS
): string {
  const safeTitle = String(title || labels.untitled).trim() || labels.untitled;
  const turnBlocks = (turns || [])
    .map((turn, index) => {
      const prompt = String(turn?.prompt || '').trim();
      const response = String(turn?.response || '').trim();
      if (!prompt && !response) {
        return '';
      }
      return `<section class="turn">
  <h2>${escapeHtmlText(labels.turn.replace('{n}', String(index + 1)))}${turn?.pinned ? ` <span class="badge">📌 ${escapeHtmlText(labels.pinned)}</span>` : ''}${turn?.excludedFromContext ? ` <span class="badge muted">🚫 ${escapeHtmlText(labels.excluded)}</span>` : ''}</h2>
  ${prompt ? `<div class="role user"><strong>${escapeHtmlText(labels.user)}</strong><pre>${escapeHtmlText(prompt)}</pre></div>` : ''}
  ${response ? `<div class="role assistant"><strong>${escapeHtmlText(labels.assistant)}</strong><pre>${escapeHtmlText(response)}</pre></div>` : ''}
</section>`;
    })
    .filter(Boolean)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="${escapeHtmlText(labels.lang)}"${/^(?:ar|he|fa|ur)\b/.test(labels.lang) ? ' dir="rtl"' : ''}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtmlText(safeTitle)}</title>
<style>
  body{max-width:860px;margin:32px auto;padding:0 20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0f172a;line-height:1.6;background:#f8fafc;}
  h1{font-size:24px;margin-bottom:24px;}
  .turn{background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;margin-bottom:16px;}
  .turn h2{font-size:15px;margin:0 0 12px;color:#475569;}
  .badge{display:inline-block;padding:2px 8px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:12px;}
  .badge.muted{background:#f1f5f9;color:#64748b;}
  .role{margin-top:10px;}
  .role strong{display:block;font-size:13px;color:#334155;margin-bottom:4px;}
  pre{white-space:pre-wrap;word-break:break-word;margin:0;font-family:inherit;background:#f8fafc;padding:10px 12px;border-radius:8px;}
</style>
</head>
<body>
<h1>${escapeHtmlText(safeTitle)}</h1>
${turnBlocks}
</body>
</html>`;
}

/**
 * Cherry Studio #10: where a typed base URL really sends chat requests, computed by the transports' own resolver. A
 * trailing `#` keeps the API root as typed, but the operation path (/chat/completions, /messages, …) is still added,
 * so the chat URL is what the user should see in both cases. Built-in providers keep their own paths (providerId).
 */
export function formatLiveEndpointPreview(
  rawBaseUrl: string,
  options: { readonly protocol?: string; readonly providerId?: string; readonly model?: string } = {}
): { readonly resolvedUrl: string; readonly rawLocked: boolean } {
  const trimmed = String(rawBaseUrl || '').trim();
  if (!trimmed) return { resolvedUrl: '', rawLocked: false };
  const preview = previewResolvedEndpointUrl(trimmed, options.protocol, options.providerId || undefined);
  const model = String(options.model || '').trim();
  return {
    resolvedUrl: model ? preview.chatUrl.replace('{model}', encodeURIComponent(model)) : preview.chatUrl,
    rawLocked: trimmed.endsWith('#')
  };
}
