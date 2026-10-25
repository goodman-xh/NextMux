import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
const style = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux.css', import.meta.url)), 'utf8');
const productionStyle = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux-desktop-production.css', import.meta.url)), 'utf8');
const streamModel = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-conversation-stream-model.ts', import.meta.url)), 'utf8');
const streamView = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-conversation-stream.tsx', import.meta.url)), 'utf8');
const preview = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-file-preview.ts', import.meta.url)), 'utf8');

test('stopped and historical task narration never renders a streaming caret', () => {
  assert.match(streamModel, /const streamTail = agentStreamTailPresentation\(/);
  assert.match(streamModel, /streamTail\.showCursor/);
  assert.match(source, /terminalState\?: 'complete' \| 'stopped'/);
  assert.doesNotMatch(source, /const streamingNarration = running && !completedNarration;/);
});

test('completed turns always render a natural-language summary, including legacy empty responses', () => {
  assert.match(source, /completedAgentSummary\(activityEvents, liveResult\?\.changes \|\| turn\.changes \|\| \[\]\)/);
  assert.match(source, /\(stage === 'complete' \|\| stage === 'paused'\) && <\>/);
  assert.match(source, /className='nmx-gateway-content'/);
});

test('failed turns render one user-facing failure sentence without duplicating it as a title', () => {
  assert.doesNotMatch(source, /className='nmx-agent-state-title'/,
    'no generic state title above the stream; a pause is an ordered status row after the reply');
  assert.match(source, /stage === 'paused' && <StreamStatusRow locale=\{this\.desktopLocale\} item=\{turn\.stopReason === 'media_context_compaction_required'[\s\S]{0,600}title: agentOutcomeText\(this\.desktopLocale, 'mediaContextPaused'\)/,
    'a media-context pause shows its short reason on screen, not only in a tooltip');
  assert.match(source, /<StreamNotice locale=\{this\.desktopLocale\} tone='error' role=\{live \? 'alert' : 'status'\}/);
  assert.match(source, /stage === 'error' && <>[^\n]*<StreamNotice locale=\{this\.desktopLocale\} tone='error' role=\{live \? 'alert' : 'status'\} action=\{[^\n]*?this\.renderModelFailureAction\([^\n]*?\)\} text=\{this\.renderThreadText\(displayError \|\| agentOutcomeText\(this\.desktopLocale, 'fallbackBody'\)/,
    'a failed turn keeps one short localized notice without diagnostic disclosure');
  assert.match(source, /const displayError = error \|\| failure\s*\? conversationErrorText\(this\.desktopLocale, failure \|\| error, \{ source: modelFailureSource\(turn\.routeId\)/,
    'raw provider codes never reach the failure notice');
  assert.doesNotMatch(source, /stage === 'error'[^\n]{0,300}agentFailureTitle/,
    'the same localized failure must not be rendered a second time above the paragraph');
  const failureSurface = source.slice(source.indexOf("{stage === 'error' &&"), source.indexOf("{stage === 'cancelled' &&"));
  assert.doesNotMatch(failureSurface, /selectSection\('models'\)|前往模型中心|打开模型中心/,
    'a failed reply must explain the exact error without routing the user to an unrelated model-center action');
  assert.doesNotMatch(source, /const errorActivityEvents = stage === 'error' \? \[\]/,
    'a terminal error must not erase prior output and completed operations');
  assert.match(source, /renderAgentActivity\(errorActivityEvents, false, true, turn\.id, 'stopped', turn\.steeringMessages, liveResult\?\.changes \|\| turn\.changes\)/);
});

test('settled turns retain the latest semantic task plan without turning tool rows into tasks', () => {
  assert.match(streamModel, /agentTaskPlanSteps/);
  assert.match(streamModel, /const plan = !running \? agentTaskPlanSteps\(events\) : \[\]/);
  assert.match(source, /if \(!projection\.items\.length && projection\.plan\.length <= 1\)/);
  assert.match(streamView, /className='nmx-agent-plan-history'/);
  assert.match(streamView, /projection\.plan\.map\(step/);
  assert.match(style, /\.nmx-agent-plan-history\s*\{[\s\S]*?border:/);
});

test('completed assistant replies use the maintained safe Markdown renderer', () => {
  // Replies use the conversation Markdown host (markdown-it without raw HTML
  // + DOMPurify), not Theia's label renderer that turns `$(x)` into icons.
  assert.match(source, /import \{ ConversationMarkdown \} from '\.\/nextmux-conversation-markdown';/);
  assert.match(source, /<ConversationMarkdown markdown=\{normalizeConversationMarkdown\(value\)\} className='nmx-assistant-markdown'[\s\S]*?tokenizer=\{conversationCodeTokenizer\}[\s\S]*?onCopyCode=\{this\.copyConversationCode\}/);
  assert.match(source, /protected readonly copyConversationCode = \(code: string\)/,
    'one stable callback so memoized Markdown does not re-render on every update');
  const markdownHost = readFileSync(new URL('../src/browser/nextmux-conversation-markdown.tsx', import.meta.url), 'utf8');
  assert.match(markdownHost, /markdownit\(\{ html: false,/);
  assert.match(markdownHost, /DOMPurify\.sanitize\(/);
  assert.match(source, /protected renderUserMessage\(value: string, turnId: string\)/);
  assert.match(source, /const publicTurn = goalTurnPresentation\(\{ prompt: turn\.prompt,/);
  assert.match(source, /renderUserMessage\(publicTurn\.prompt, turn\.id\)/);
  assert.match(source, /copyToClipboard\(publicTurn\.prompt,/,
    'the sent prompt and its copy action must use the same public projection');
  assert.match(source, /renderAssistantOutput\(\s*pauseTextAlreadyShown \? '' : response,[\s\S]{0,420}turn\.id/);
  assert.match(source, /part\.type === 'text'[\s\S]{0,180}renderAssistantResponse\(part\.text/);
  assert.match(source, /part\.type === 'image'[\s\S]{0,180}<button[\s\S]{0,180}<img loading='lazy' decoding='async'/);
  assert.match(source, /<audio controls preload='metadata'/);
  assert.match(source, /assistantOutputPresentation\(value, rawParts\)/,
    'validated ordered parts are the sole response projection, including media-only replies');
  assert.doesNotMatch(source, /hasVisibleTextPart|key='output-text-fallback'/,
    'a synthetic legacy summary must not be inserted into a media-only ordered reply');
  assert.match(style, /\.nmx-assistant-markdown\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.match(style, /\.nmx-assistant-markdown pre\s*\{[\s\S]*?overflow:\s*auto;/);
  assert.match(style, /\.nmx-assistant-markdown table\s*\{[\s\S]*?display:\s*block;[\s\S]*?overflow-x:\s*auto;/);
  assert.match(style, /\.nmx-assistant-markdown :is\(ul, ol\)\s*\{[\s\S]*?padding-inline-start:\s*23px;/);
  assert.match(style, /\.nmx-user-markdown\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.match(productionStyle, /\.nmx-user-markdown a \{ color: #8ab4f8(?:\s*!important)?;/,
    'sent Markdown links keep the blue title style in the production cascade');
  assert.doesNotMatch(style, /\.nmx-agent-message\s+ul\s*\{[\s\S]*?list-style:\s*none;/,
    'generic assistant styles must not turn authored Markdown lists into card rows');
  assert.doesNotMatch(style, /\.nmx-agent-message\s+li\s*\{[\s\S]*?display:\s*flex;/,
    'ordered, unordered, nested, and wrapped Markdown list items keep native flow');
});

test('assistant time and persistent more action are right aligned and theme aware', () => {
  assert.match(source, /<i className='codicon codicon-ellipsis'><\/i>/);
  assert.doesNotMatch(source, /title=\{conversationText\(this\.desktopLocale, 'copyReply'\)\}/);
  const turnMenu = source.match(/\{stage !== 'running' && <div className='nmx-turn-copy'>[\s\S]*?<\/div>\}/)?.[0] || '';
  assert.equal((turnMenu.match(/<time>/g) || []).length, 1, 'time must not be duplicated inside the menu');
  const timeIndex = turnMenu.indexOf('<time>');
  const upIndex = turnMenu.indexOf("data-relay-feedback='up'");
  const downIndex = turnMenu.indexOf("data-relay-feedback='down'");
  const moreIndex = turnMenu.indexOf("data-message-action='more'");
  assert.ok(timeIndex >= 0 && timeIndex < upIndex && upIndex < downIndex && downIndex < moreIndex,
    'assistant footer order must be time, thumbs up, thumbs down, then more');
  assert.match(style, /\.nmx-turn-copy\s*\{[\s\S]*?margin-left:\s*auto;/);
  assert.match(style, /\.nmx-turn-copy > button\s*\{[\s\S]*?opacity:\s*1;/);
  assert.match(style, /\.nmx-turn-copy > section\s*\{[\s\S]*?right:\s*0;[\s\S]*?left:\s*auto;[\s\S]*?background:\s*var\(--nmx-panel\);/);
});

test('every settled reply exposes accessible feedback controls independent of merchant rating eligibility', () => {
  assert.match(source, /normalizeRelayFeedbackRequestIds\([\s\S]*?(?:this|run)\.agentResult\.route\.requestIds[\s\S]*?(?:this|run)\.agentResult\.route\.requestId/);
  assert.doesNotMatch(source, /relayFeedbackAvailable/);
  assert.match(source, /if \(!canRateRelayReply\(reply\.stage, requestIds\)\)/);
  assert.match(source, /submitCodingTurnRelayFeedback\([\s\S]*?submitRelayFeedbackBatch\(requestIds, nextVote\)/);
  assert.match(source, /aria-pressed=\{turn\.relayFeedback === 'up'\}/);
  assert.match(source, /aria-pressed=\{turn\.relayFeedback === 'down'\}/);
  assert.match(source, /aria-busy=\{relayFeedbackSubmittingVote === 'up'\}/);
  assert.match(source, /aria-busy=\{relayFeedbackSubmittingVote === 'down'\}/);
  assert.match(style, /\.nmx-turn-copy > button\.nmx-relay-feedback\.is-active/);
  assert.match(style, /\.nmx-turn-copy > button\s*\{[\s\S]*?opacity:\s*1;/,
    'feedback controls must remain visible without hovering the assistant footer');
  assert.doesNotMatch(style, /\.nmx-turn-copy[^\{]*\{[\s\S]{0,220}?opacity:\s*0/,
    'a broad footer rule must not hide the always-visible feedback controls');
  assert.match(source, /disabled=\{!this\.conversationHistoryReady\(\) \|\| relayFeedbackSubmittingVote !== undefined\}/,
    'feedback cannot mutate a partial startup history');
});

test('rating a reply bypasses the message and follow-up queues, and resumed replies require a fresh rating', () => {
  const feedbackStart = source.indexOf('protected async submitCodingTurnRelayFeedback');
  const feedbackEnd = source.indexOf('protected async openCodingSession', feedbackStart);
  assert.ok(feedbackStart >= 0 && feedbackEnd > feedbackStart, 'feedback handler boundaries must resolve');
  const feedbackHandler = source.slice(feedbackStart, feedbackEnd);
  assert.match(feedbackHandler, /submitRelayFeedbackBatch\(requestIds, nextVote\)/);
  assert.doesNotMatch(feedbackHandler, /submitPrompt|enqueueFollowUpTask|appendFollowUpTask/);
  assert.match(source, /A resumed reply may use additional routes[\s\S]*?relayFeedback: undefined/);
  assert.match(source, /resumedExecution\?\.turn\.relayRequestIds[\s\S]*?(?:this|run)\.agentResult\.route\.requestIds/);
  assert.match(feedbackHandler, /sameReplyLineage[\s\S]*?if \(!sameReplyLineage\)[\s\S]*?return;/,
    'a late feedback response cannot mark an expanded resumed reply as already rated');
  assert.match(source, /resumePausedTurn[\s\S]*?this\.relayFeedbackSubmittingVotes\?\.has\(turnId\)/,
    'manual continuation waits for a pending rating mutation');
  assert.match(source, /pendingRelayFeedbackSubmissions\.add\(pending\)[\s\S]*?pendingRelayFeedbackSubmissions\.delete\(pending\)/);
  assert.match(source, /Promise\.allSettled\(\[\.\.\.\(this\.pendingRelayFeedbackSubmissions \|\| \[\]\)\]\)/,
    'the close handshake waits for rating persistence before its final history flush');
});

test('large text uses the drawer editor directly without an artificial preview fallback', () => {
  const start = source.indexOf('protected async previewContextFile');
  const end = source.indexOf('protected openContextFile', start);
  const drawerLoader = source.slice(start, end);
  assert.match(drawerLoader, /fileService\.read\(resource,\s*\{[\s\S]*?acceptTextOnly:\s*true/);
  assert.doesNotMatch(drawerLoader, /512 \* 1024/);
  assert.doesNotMatch(source, /preview\.error \? <div className='nmx-file-preview-state'><span>\{preview\.error\}<\/span><button/);
  // Large files open whole in the editor (no truncated preview); only files past a
  // generous bound the window can hold are refused outright (audit DS-10).
  assert.match(drawerLoader, /limits: \{ size: FILE_DRAWER_TEXT_MAX_BYTES, memory: FILE_DRAWER_TEXT_MAX_BYTES \* 4 \}/);
  assert.match(preview, /FILE_DRAWER_TEXT_MAX_BYTES = 64 \* 1024 \* 1024/);
  assert.doesNotMatch(drawerLoader, /truncated: true/);
  assert.doesNotMatch(preview, /文件过大，无法在侧栏中预览/);
});

test('activity and prose rows use compact readable spacing', () => {
  const activity = style.match(/\.nmx-agent-activity\s*\{([^}]+)\}/)?.[1] || '';
  const narration = style.match(/\.nmx-agent-narration,\s*\.nmx-agent-message p\.nmx-agent-narration\s*\{([^}]+)\}/)?.[1] || '';
  assert.ok(Number(activity.match(/gap:\s*([\d.]+)px/)?.[1]) <= 4, 'ordinary status rows use a compact gap');
  assert.ok(Number(narration.match(/line-height:\s*([\d.]+)/)?.[1]) <= 1.6, 'prose does not acquire oversized line spacing');
  assert.match(narration, /color:\s*var\(--nmx-text\)/);
});


test('assistant replies and activity journals are fully visible without a whole-message collapse control', () => {
  const response = source.slice(source.indexOf('protected renderAssistantResponse('), source.indexOf('/** Render sent prompts'));
  assert.doesNotMatch(response, /collapsible|expandMessage|collapseMessage/);
  assert.doesNotMatch(source, /expandedAgentActivityIds|maximumVisible = expanded/);
});
