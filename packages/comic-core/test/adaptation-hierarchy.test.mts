import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptComicHierarchically, chunkComicSource, comicPlanningBudget, comicPlanningTokens, parseComicPlanningJson, planComicEpisodeStoryboards } from '../lib/adaptation-hierarchy.js';
import { normalizeComicAdaptSettings } from '../lib/adaptation-settings.js';
import { comicEpisodeShotInstructions, comicTopicInstructions } from '../lib/adaptation-brief.js';
import { createComicProject } from '../lib/core.js';
import { parseComicAdaptation, applyComicAdaptation, parseComicScripts, applyComicScripts } from '../lib/adaptation.js';

const settings = normalizeComicAdaptSettings({ episodes: 3, episodeSeconds: 30 });
test('all source characters beyond 150k are read with a 4096-token model and bounded parallel scripts', async () => {
  const source = ('Ari meets Old Ari at the river. They are the same person.\n').repeat(3000) + 'THE FINAL LIGHTHOUSE ENDING';
  const calls: any[] = []; let active = 0, maximum = 0;
  const result = await adaptComicHierarchically({ sourceText: source, settings, language: 'English', aspectRatio: '9:16', contextWindowTokens: 4096, concurrency: 2,
    complete: async request => {
      calls.push(request); active++; maximum = Math.max(maximum, active);
      assert.ok(comicPlanningTokens(request.prompt) <= comicPlanningBudget(4096).input);
      await new Promise(resolve => setTimeout(resolve, 0)); active--;
      if (request.stage === 'chunk') return { summary: request.prompt.includes('THE FINAL LIGHTHOUSE ENDING') ? 'Ari reaches THE FINAL LIGHTHOUSE ENDING.' : 'Ari walks to the river.', characters: [{ name: 'Ari', aliases: ['Old Ari'], appearance: 'Grey hair.' }] };
      if (request.stage === 'reduce') return { summary: request.prompt.includes('THE FINAL LIGHTHOUSE ENDING') ? 'Ari reaches THE FINAL LIGHTHOUSE ENDING.' : 'Ari walks to the river.' };
      if (request.stage === 'bible') return { title: 'River', styleBible: 'Ink, grey and ochre, window light from left.' };
      if (request.stage === 'outline') return { title: `Part ${request.episodeNumber}`, outline: 'Ari arrives.', ending: `Ari waits at dock ${request.episodeNumber}.` };
      return { script: `River · day\nAri: We arrived. Episode ${request.episodeNumber}.` };
    } });
  const chunks = calls.filter(call => call.stage === 'chunk');
  assert.equal(chunks[0].sourceRange.start, 0);
  assert.equal(chunks.at(-1).sourceRange.end, source.length);
  for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i - 1].sourceRange.end, chunks[i].sourceRange.start);
  assert.ok(chunks.at(-1).prompt.includes('THE FINAL LIGHTHOUSE ENDING'));
  assert.equal(result.episodes.length, 3); assert.equal(maximum, 2);
  assert.deepEqual(result.characters[0].aliases, ['Old Ari']);
  const scripts = calls.filter(call => call.stage === 'script');
  assert.match(scripts[1].prompt, /PREVIOUS ENDING.*Ari waits at dock 1/);
  assert.match(scripts[0].prompt, /full coverage is in the notes above/);
  assert.equal(result.episodes.at(-1)?.sourceRange?.end, source.length);
  let project = createComicProject({ title: 'Test' });
  project = applyComicScripts(project, parseComicScripts(result));
  assert.equal(project.episodes?.at(-1)?.sourceRange?.end, source.length);
  assert.deepEqual(project.characters[0].aliases, ['Old Ari']);
});

test('a model failure identifies the exact unprocessed range and returns no partial scripts', async () => {
  await assert.rejects(adaptComicHierarchically({ sourceText: '失落灯塔。'.repeat(1000), settings, language: 'Chinese', aspectRatio: '9:16', contextWindowTokens: 4096,
    complete: async request => { throw new Error(`failed ${request.stage}`); } }), (error: unknown) => {
    assert.ok(error instanceof Error && 'readableError' in error);
    assert.match(error.message, /The chunk planning stage failed \(source characters 1–\d+\)/);
    const info = error.readableError as { messageKey: string; detail: string; params: { start: number; end: number } };
    assert.equal(info.messageKey, 'comic.hierarchy.stage_failed');
    assert.match(info.detail, /chunk failed: failed chunk/);
    assert.equal(info.params.start, 1);
    assert.ok(info.params.end > info.params.start);
    return true;
  });
  await assert.rejects(adaptComicHierarchically({ sourceText: 'A story', settings, language: 'English', aspectRatio: '9:16', complete: async () => ({}) }), /no verified context window/);
  await assert.rejects(adaptComicHierarchically({ sourceText: 'A story', settings, contextWindowTokens: 1024, language: 'English', aspectRatio: '9:16', complete: async () => ({}) }), /too small/);
});

test('source chunking is contiguous, budgeted and preserves surrogate pairs', () => {
  const source = '灯塔🌊的一天。\n'.repeat(30);
  const chunks = chunkComicSource(source, 50);
  assert.equal(chunks.map(range => source.slice(range.start, range.end)).join(''), source);
  assert.ok(chunks.every(range => comicPlanningTokens(source.slice(range.start, range.end)) <= 50));
  assert.ok(chunks.every(range => !/[\uD800-\uDBFF]$/.test(source.slice(range.start, range.end))));
});

test('planner briefs carry director grammar, tone, search terms and new camera vocabulary', () => {
  const topic = comicTopicInstructions({ topic: '城市', seconds: 30, maxShotSeconds: 6, aspectRatio: '9:16', language: 'Chinese', narrator: '旁白', stockSearch: true });
  assert.match(topic, /searchTerms as an array of 3–6 English search words/);
  assert.match(topic, /180-degree/); assert.match(topic, /15–20 seconds/);
  const episode = comicEpisodeShotInstructions({ settings, episode: { number: 1, title: 'One', script: 'River · day' }, styleBible: '', characters: [], maxShotSeconds: 6, aspectRatio: '9:16', language: 'English' });
  for (const field of ['cameraAngle', 'depthOfField', 'transition', 'beats', 'tone', 'crane_up']) assert.ok(episode.includes(field));
});

test('adaptation stores shot grammar and merges aliases into a single speaking character', () => {
  const adaptation = parseComicAdaptation({ characters: [{ name: 'Ari', aliases: ['Old Ari'], appearance: 'grey hair' }, { name: 'Old Ari', aliases: ['Ari'], appearance: 'grey hair' }], episodes: [{ number: 1, scenes: [{ shots: [{ title: 'Arrival', durationSeconds: 6, visualPrompt: 'Ari walks.', characters: ['Old Ari'], cameraAngle: 'low', lens: { focalLength: 'wide', depthOfField: 'deep' }, cameraMotion: 'orbit', transition: 'dissolve', beats: [{ startSeconds: 0, endSeconds: 5, action: 'walks' }], searchTerms: ['river', 'dock', 'sunset'], dialogue: [{ speaker: 'Old Ari', text: 'Home.', tone: 'soft' }] }] }] }] });
  const result = applyComicAdaptation(createComicProject({ title: 'Test' }), adaptation, { mode: 'replace' }).project;
  assert.equal(result.characters.length, 1);
  const shot = result.scenes[0].shots[0];
  assert.equal(shot.cameraAngle, 'low'); assert.equal(shot.lens?.focalLength, 'wide'); assert.equal(shot.transition, 'dissolve');
  assert.equal(shot.dialogueCues[0].tone, 'soft'); assert.equal(shot.dialogueCues[0].speakerCharacterId, result.characters[0].id);
  assert.deepEqual(shot.searchTerms, ['river', 'dock', 'sunset']);
});


test('4096-token storyboard passes preserve all screenplay excerpts and scene boundaries', async () => {
  const script = 'River · day\n' + 'Ari walks to the lighthouse.\n'.repeat(40) + 'Home · night\n' + 'Ari: Final return.\n'.repeat(25);
  const calls: string[] = [];
  const adaptation = await planComicEpisodeStoryboards({ episode: { number: 2, title: 'Return', script }, settings: normalizeComicAdaptSettings({ episodes: 1, episodeSeconds: 90 }),
    styleBible: 'Ink, ochre.', characters: [{ name: 'Ari', appearance: 'Grey hair' }], language: 'English', aspectRatio: '9:16', maxShotSeconds: 8, contextWindowTokens: 4096,
    complete: async request => { calls.push(request.prompt); assert.ok(comicPlanningTokens(request.prompt) <= comicPlanningBudget(4096).input);
      const count = Number(/Create exactly (\d+) shots/.exec(request.prompt)?.[1] || 1);
      return { shots: Array.from({length:count}, () => ({ title: 'Return', durationSeconds: 8, action: 'Ari returns.', visualPrompt: 'Ari walks.', dialogue: [] })) }; }
  }) as any;
  assert.equal(adaptation.episodes[0].scenes.length, 2);
  assert.equal(adaptation.episodes[0].scenes[1].location, 'Home');
  const excerpts = calls.map(prompt => /<excerpt[^>]+>\n([\s\S]*)\n<\/excerpt>/.exec(prompt)?.[1] || '');
  assert.equal(excerpts.join(''), script);
  assert.ok(calls.at(-1)?.includes('Final return.'));
  assert.equal(parseComicAdaptation(adaptation).episodes[0].scenes.length, 2);
});

test('parseComicPlanningJson strips reasoning <think>/<thinking> blocks, prose around fences, trailing commas and unescaped newlines', () => {
  const raw = `<think>Let me draft a JSON:\n{"draft": true}\n</think>\nHere is the planned script:\n\`\`\`json\n{\n  "title": "灯塔",\n  "script": "第一行\n第二行",\n}\n\`\`\`\nDone.`;
  const parsed = parseComicPlanningJson(raw);
  assert.equal(parsed.title, '灯塔');
  assert.equal(parsed.script, '第一行\n第二行');
});
