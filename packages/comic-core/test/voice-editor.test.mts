import test from "node:test";
import assert from "node:assert/strict";
import { applyComicPlaybackCommand, parseComicVoiceCommand } from "../lib/voice.js";

test("editor voice commands distinguish absolute positions from relative jumps", () => {
  assert.deepEqual(parseComicVoiceCommand("快进到30秒"), { type: "seek_time", seconds: 30 });
  assert.deepEqual(parseComicVoiceCommand("后退到10秒"), { type: "seek_time", seconds: 10 });
  assert.deepEqual(parseComicVoiceCommand("快进5秒"), { type: "forward", seconds: 5 });
  assert.deepEqual(parseComicVoiceCommand("前进一秒"), { type: "forward", seconds: 1 });
  assert.deepEqual(parseComicVoiceCommand("后退一秒"), { type: "rewind", seconds: 1 });
  assert.deepEqual(parseComicVoiceCommand("前进到第3集"), { type: "seek_episode", episodeNumber: 3 });
  assert.deepEqual(parseComicVoiceCommand("回到开头"), { type: "seek_time", seconds: 0 });
  assert.deepEqual(parseComicVoiceCommand("停止"), { type: "pause" });
});

test("hold commands seek and keep the frame paused", () => {
  const command = parseComicVoiceCommand("停在第二集的1分5秒");
  assert.deepEqual(command, { type: "seek_time", episodeNumber: 2, seconds: 65, hold: true });
  const state = applyComicPlaybackCommand({ episodeNumber: 1, currentSeconds: 0, durationSeconds: 120, playing: true, speed: 1 },
    command as Extract<typeof command, { type: "seek_time" }>);
  assert.equal(state.playing, false);
  assert.equal(state.currentSeconds, 65);
});

test("look changes after stopping become frame edits, not playback", () => {
  for (const text of ["把这个人物的头发改成银色", "背景再深一点", "服装再炫酷一点"]) {
    assert.deepEqual(parseComicVoiceCommand(text), { type: "edit_frame", instruction: text });
  }
  assert.equal(parseComicVoiceCommand("今天天气不错"), undefined);
});
