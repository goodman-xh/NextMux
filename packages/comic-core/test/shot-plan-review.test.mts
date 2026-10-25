import assert from 'node:assert/strict';
import test from 'node:test';

import { comicShotPlanCorrection, comicShotPlanIssues, parseComicAdaptation } from '../lib/index.js';
import { comicEpisodeShotInstructions, comicScriptInstructions, normalizeComicAdaptSettings } from '../lib/adaptation-brief.js';

const plan = (shot: Record<string, unknown>) => parseComicAdaptation({ episodes: [{ number: 1, scenes: [{ title: '书房', shots: [{ title: '人设立住', durationSeconds: 4, visualPrompt: '书房，王爷端坐看书', action: '王爷看书', ...shot }] }] }] });

test('a filmable shot plan passes: beats cover the shot, every line is directed and fits', () => {
  const ready = plan({ durationSeconds: 6, beats: [{ startSeconds: 0, endSeconds: 3, action: '丫头凑上前，歪头小声试探' }, { startSeconds: 3, endSeconds: 6, action: '王爷眼都不抬，冷淡回应' }],
    dialogue: [{ speaker: '丫头', text: '人人都说王爷不近女色。', tone: '小声试探，凑上前' }, { speaker: '王爷', text: '嗯。', tone: '眼都不抬，冷淡' }] });
  assert.deepEqual(comicShotPlanIssues(ready), []);
});

test('flat or over-stuffed shots are sent back with the exact problems', () => {
  const issues = comicShotPlanIssues(parseComicAdaptation({ episodes: [{ number: 2, scenes: [{ title: '老屋', shots: [
    { title: '归家', durationSeconds: 7, visualPrompt: '老屋正厅', action: '母亲斟茶', dialogue: [{ speaker: '母亲', text: '回来了就好。' }] },
    { title: '空镜', durationSeconds: 4, visualPrompt: '空荡的院子', action: '' },
    { title: '长台词', durationSeconds: 3, visualPrompt: '甲说话', action: '甲说话', dialogue: [{ speaker: '甲', tone: '急切', text: '这件事我已经想了整整三天三夜，今天必须把它说清楚，不然谁也别想走。' }] },
    { title: '短节拍', durationSeconds: 8, visualPrompt: '乙走过', action: '乙走过', beats: [{ startSeconds: 0, endSeconds: 1, action: '乙起身' }, { startSeconds: 1, endSeconds: 2, action: '乙转身' }] },
  ] }] }] }));
  assert.deepEqual(issues.map(issue => `${issue.shot}:${issue.problem}`), [
    '1:no_beats', '1:line_without_direction', '2:no_action', '3:lines_too_long', '4:beats_short',
  ]);
  const correction = comicShotPlanCorrection(issues);
  assert.match(correction, /episode 2, scene 1, shot 1: a shot of 5 seconds or more needs at least two timed beats/);
  assert.doesNotMatch(correction, /\p{Script=Han}/u, 'tool messages stay in English');
  assert.match(correction, /call the tool again with the whole episode/);
  assert.deepEqual(comicShotPlanIssues(plan({ dialogue: [{ speaker: '旁白', text: '夜深了。' }] }), { silent: true }), [], 'a silent work has no lines to direct');
});

test('the script and shot briefs ask for directed lines, milestones, end states and one dramatic job per shot', () => {
  const settings = normalizeComicAdaptSettings({});
  const script = comicScriptInstructions({ settings, language: 'Simplified Chinese', aspectRatio: '9:16' });
  assert.match(script, /Name（how it is said: tone, expression, gesture）: line/);
  assert.match(script, /head-to-body proportion/);
  assert.match(script, /personality stays out of appearance/);
  const shots = comicEpisodeShotInstructions({ settings, episode: { number: 1, title: '不近女色？', script: '书房 · 夜\n丫头（小声试探）：人人都说王爷不近女色。' },
    styleBible: '古风', characters: [{ name: '丫头', appearance: '浅绿色薄纱汉代广袖服' }], maxShotSeconds: 8, aspectRatio: '9:16', language: 'Simplified Chinese' });
  for (const rule of [/Each shot does one dramatic job/, /Performance: every spoken line has a tone/, /Action milestones/, /beats: the checkable steps of the shot/, /every line has a tone directing how it is said/, /Write the performance, not a caption/]) assert.match(shots, rule);
  assert.match(shots, /0–4 秒：甲放下茶杯，抬眼小声试探/);
});
