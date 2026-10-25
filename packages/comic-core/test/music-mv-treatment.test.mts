import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateMusicLyrics, splitMusicMvSegments, planMusicMvVisuals, musicMvSectionEnergy } from '../lib/music-mv.js';

test('MV treatment plans one visible scene per section with bounded concurrency and no lyric-as-prompt fallback', async () => {
  const lyrics = '[Verse]\n雨落在心里\n[Chorus]\n太阳照亮我';
  const lines = estimateMusicLyrics(lyrics, 60000);
  const segments = splitMusicMvSegments(lines, 60000, 'soft piano');
  assert.ok(segments.every(segment => !segment.prompt.includes('雨落在心里') && !segment.prompt.includes('太阳照亮我')));
  let calls = 0, active = 0, peak = 0;
  const prompts: string[] = [];
  const planned = await planMusicMvVisuals({ lyrics, lines, segments, style: 'soft piano', singerPortrait: true, generate: async prompt => {
    prompts.push(prompt); calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    return prompt.includes('Design a music-video') ? JSON.stringify({ protagonist: 'a traveller holding a red kite', palette: ['indigo', 'amber', 'ivory'], recurringImages: ['kite', 'water reflections'] })
      : JSON.stringify({ scene: 'The traveller releases the kite; the camera rises from eye level to above the river as the kite lifts.', performance: true });
  } });
  assert.equal(calls, segments.length + 1);
  assert.equal(peak, 2);
  assert.equal(planned.segments.length, segments.length);
  assert.ok(planned.segments.every(segment => segment.prompt.includes('red kite') && segment.prompt.includes('No text or lyrics on screen') && segment.prompt.includes('Silent video') && segment.performance));
  assert.ok(prompts.some(prompt => prompt.includes('Energy: restrained')));
  assert.ok(prompts.some(prompt => prompt.includes('Energy: expansive')));
  assert.equal(musicMvSectionEnergy('Pre-Chorus'), 'rising');
});

test('MV cached treatment still plans segment visuals and excludes unsupported performance', async () => {
  const lines = estimateMusicLyrics('one line', 5000);
  const segments = splitMusicMvSegments(lines, 5000);
  let calls = 0;
  const result = await planMusicMvVisuals({ lyrics: 'one line', lines, segments, style: '', treatment: { protagonist: 'a leaf', palette: ['red','gold','green'], recurringImages: ['leaf','ripples'] },
    generate: async prompt => { calls++; assert.ok(!prompt.includes('Design a music-video')); return JSON.stringify({ scene: 'A leaf drifts toward a pond; a slow downward tilt follows it.', performance: true }); } });
  assert.equal(calls, 1); assert.equal(result.segments[0]?.performance, false);
});

test('invalid MV treatment and incomplete scene fail explicitly without fabricated visuals', async () => {
  const options = { lyrics: '', lines: [], segments: splitMusicMvSegments([], 1000), style: '' };
  await assert.rejects(planMusicMvVisuals({ ...options, generate: async () => '{}' }), /protagonist/);
  await assert.rejects(planMusicMvVisuals({ ...options, treatment: { protagonist: 'a leaf', palette: ['red','gold','green'], recurringImages: ['leaf','ripples'] }, generate: async () => '{"scene":""}' }), /scene/);
});

test('MV visual planner tolerates <think> reasoning prefixes and trailing commas from reasoning models', async () => {
  const lines = estimateMusicLyrics('one line', 5000);
  const segments = splitMusicMvSegments(lines, 5000);
  const result = await planMusicMvVisuals({
    lyrics: 'one line', lines, segments, style: 'indie',
    generate: async prompt => prompt.includes('Design a music-video')
      ? '<think>Thinking about visual motifs...</think>\n```json\n{"protagonist":"a cyclist","palette":["blue","silver","ochre",],"recurringImages":["bicycle","streetlights",]}\n```'
      : '<thinking>Planning segment 1...</thinking>{"scene":"The cyclist coasts down a wet hill; camera tracks alongside.","performance":false,}'
  });
  assert.equal(result.treatment.protagonist, 'a cyclist');
  assert.ok(result.segments[0]?.prompt.includes('wet hill'));
});
