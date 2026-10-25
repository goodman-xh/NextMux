import assert from 'node:assert/strict';
import test from 'node:test';
import { ComicHierarchyError, comicPlanningBudget, comicPlanningTokens, rewriteComicEpisodeScript } from '../lib/adaptation-hierarchy.js';
import { normalizeComicAdaptSettings } from '../lib/adaptation-settings.js';

const settings = normalizeComicAdaptSettings({ episodes: 3, episodeSeconds: 45, pacing: 'fast' });
const characters = [
  { name: 'Ari', aliases: ['The Ferryman'], appearance: 'Grey hair', voice: 'Low' },
  { name: 'Nora', aliases: ['The Queen'], appearance: 'Black hair' },
];
const episode = {
  number: 2, title: 'Old title', script: 'River · day\nAri: Stay here.',
  sourceRange: { start: 8, end: 48 }, outline: 'The Ferryman finds the bridge.',
  ending: 'Ari is on the bridge, holding the lantern.',
};
const sourceText = 'OUTSIDE-' + 'The Ferryman finds the bridge at dawn. XX' + '-OUTSIDE';

test('single-episode rewrite shares script-stage rules and preserves the episode contract', async () => {
  const calls: { prompt: string; maxOutputTokens: number }[] = [];
  const rewritten = await rewriteComicEpisodeScript({ sourceText, episode, settings, styleBible: 'Ink, ochre, light from east.',
    characters, previousEnding: 'Ari steps onto the bridge.', nextOpening: 'Ari sees the tower beyond it.',
    note: 'Make the dialogue quieter.', language: 'English', aspectRatio: '9:16', contextWindowTokens: 8192,
    complete: async request => { calls.push(request); return { title: 'At the bridge', script: 'Bridge · dawn\nAri: I am here.' }; } });
  assert.equal(calls.length, 1);
  const { prompt, maxOutputTokens } = calls[0]!;
  assert.equal(maxOutputTokens, comicPlanningBudget(8192).output);
  assert.ok(comicPlanningTokens(prompt) <= comicPlanningBudget(8192).input);
  for (const expected of ['episode 2 (45s)', 'Pacing:', 'Ink, ochre, light from east.', 'OUTLINE: The Ferryman finds the bridge.',
    'ENDING CONTRACT: Ari is on the bridge, holding the lantern.', 'PREVIOUS ENDING (continue this exact position): Ari steps onto the bridge.',
    'NEXT EPISODE OPENING (end so this follows on): Ari sees the tower beyond it.', 'Make the dialogue quieter.',
    'Use scene headings, visible action, named dialogue', 'Return {script,title?}', '<source start="8" end="48">']) assert.ok(prompt.includes(expected), expected);
  assert.match(prompt, /CAST: \[\{"name":"Ari"/);
  assert.doesNotMatch(prompt, /"name":"Nora"/);
  assert.equal(rewritten.title, 'At the bridge');
  assert.equal(rewritten.script, 'Bridge · dawn\nAri: I am here.');
  assert.equal(rewritten.number, episode.number);
  assert.equal(rewritten.sourceRange, episode.sourceRange);
  assert.equal(rewritten.outline, episode.outline);
  assert.equal(rewritten.ending, episode.ending);
});

test('old episodes use the complete saved script as the base, with title fallback', async () => {
  let prompt = '';
  const oldEpisode = { number: 1, title: 'Keep this title', script: 'Old pier · night\nSomeone drops a key.' };
  const result = await rewriteComicEpisodeScript({ sourceText: 'SOURCE STORY MUST NOT BE SENT', episode: oldEpisode, settings,
    styleBible: 'Blue dusk.', characters, language: 'English', aspectRatio: '16:9', contextWindowTokens: 4096,
    complete: async request => { prompt = request.prompt; return { title: ' '.repeat(121), script: 'Old pier · night\nA key falls.' }; } });
  assert.match(prompt, /CURRENT SCRIPT \(base for this rewrite; no source range is available\)/);
  assert.match(prompt, /Old pier · night\nSomeone drops a key/);
  assert.doesNotMatch(prompt, /SOURCE STORY MUST NOT BE SENT/);
  assert.match(prompt, /"name":"Ari"/);
  assert.match(prompt, /"name":"Nora"/);
  assert.equal(result.title, oldEpisode.title);
  assert.equal(result.script, 'Old pier · night\nA key falls.');
});

test('long source ranges use labelled opening and ending excerpts', async () => {
  const longSource = 'OPENING Ari ' + 'middle '.repeat(3000) + 'Nora crosses.' + 'middle '.repeat(3000) + ' Ari ENDING';
  let prompt = '';
  await rewriteComicEpisodeScript({ sourceText: longSource,
    episode: { ...episode, sourceRange: { start: 0, end: longSource.length } }, settings, styleBible: 'Ink.',
    characters, language: 'English', aspectRatio: '9:16', contextWindowTokens: 4096,
    complete: async request => { prompt = request.prompt; return { script: 'Bridge · dawn\nAri walks.' }; } });
  assert.match(prompt, /Direct opening excerpt \[0,/);
  assert.match(prompt, /Direct ending excerpt \[\d+,\d+\):/);
  assert.match(prompt, /OPENING/);
  assert.match(prompt, /ENDING/);
  assert.match(prompt, /middle is omitted from this prompt/);
  assert.match(prompt, /"name":"Ari"/);
  assert.doesNotMatch(prompt, /"name":"Nora"/);
  assert.ok(comicPlanningTokens(prompt) <= comicPlanningBudget(4096).input);
});

test('rewrite model errors identify script stage and episode', async () => {
  await assert.rejects(rewriteComicEpisodeScript({ sourceText, episode, settings, styleBible: 'Ink.', characters,
    language: 'English', aspectRatio: '9:16', contextWindowTokens: 4096, complete: async () => 'not JSON' }), error => {
    assert.ok(error instanceof ComicHierarchyError);
    assert.equal(error.stage, 'script');
    assert.equal(error.readableError.params.episode, 2);
    assert.match(error.readableError.detail, /invalid JSON/);
    return true;
  });
  await assert.rejects(rewriteComicEpisodeScript({ sourceText, episode, settings, styleBible: 'Ink.', characters,
    language: 'English', aspectRatio: '9:16', contextWindowTokens: 4096, complete: async () => ({ script: 'x'.repeat(30001) }) }),
    /script planning stage failed/);
});

test('rewrite rejects impossible budgets, excessive notes, and cancellation before model calls', async () => {
  let calls = 0;
  const complete = async () => { calls++; return { script: 'Should not happen.' }; };
  const base = { sourceText, episode, settings, styleBible: 'Ink.', characters, language: 'English', aspectRatio: '9:16', complete };
  await assert.rejects(rewriteComicEpisodeScript({ ...base, contextWindowTokens: 1024 }), error => error instanceof ComicHierarchyError && /too small/.test(error.message));
  await assert.rejects(rewriteComicEpisodeScript({ ...base, contextWindowTokens: 4096, note: 'x'.repeat(1001) }), error => error instanceof ComicHierarchyError && /1000/.test(error.message));
  await assert.rejects(rewriteComicEpisodeScript({ ...base, episode: { number: 1, title: 'Old', script: 'x'.repeat(10000) }, contextWindowTokens: 4096 }),
    error => error instanceof ComicHierarchyError && error.message.includes('input budget'));
  await assert.rejects(rewriteComicEpisodeScript({ ...base, contextWindowTokens: 4096, isCancelled: () => true }), error => (error as { code?: string }).code === 'AGENT_CANCELLED');
  assert.equal(calls, 0);
});
