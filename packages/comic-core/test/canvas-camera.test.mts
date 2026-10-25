import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMERA_MOVES, CAMERA_PRESETS, CAMERA_SPEEDS, STORYBOARD_FOCAL_LENGTHS, STORYBOARD_APERTURES,
  createCameraSelection, normalizeCameraSelection, applyCameraPreset, setCameraMovements,
  setCameraSpeed, toggleCameraMove, searchCameraMoves, compileCameraPrompt, cameraSelectionWarnings,
  createStoryboard, validateStoryboard, addStoryboardShot, deleteStoryboardShot, moveStoryboardShot,
  setStoryboardShotTime, fitStoryboardShotTime, reflowStoryboardTimes, setStoryboardDuration,
  setStoryboardAudioNotes, compileStoryboardPrompt, parseStoryboardPrompt, StoryboardValidationError,
} from "../lib/canvas-camera.js";
import type { CameraSelection, CanvasStoryboard, CanvasStoryboardShot } from "../lib/canvas-camera.js";

function twoShots(): CanvasStoryboard {
  return addStoryboardShot(createStoryboard(10));
}
function updateShot(storyboard: CanvasStoryboard, index: number, patch: Partial<CanvasStoryboardShot>): CanvasStoryboard {
  return { ...storyboard, shots: storyboard.shots.map((shot, position) => position === index ? { ...shot, ...patch } : shot) };
}

test("camera catalog covers 37 moves, 5 speeds and all 21 exact preset combinations", () => {
  assert.equal(CAMERA_MOVES.length, 37);
  assert.equal(new Set(CAMERA_MOVES.map(move => move.id)).size, 37);
  assert.equal(CAMERA_SPEEDS.length, 5);
  assert.equal(CAMERA_PRESETS.length, 21);
  assert.deepEqual(CAMERA_MOVES.reduce<Record<string, number>>((counts, move) => ({ ...counts, [move.category]: (counts[move.category] ?? 0) + 1 }), {}), {
    zoom: 6, horizontal: 7, vertical: 8, special: 16,
  });
  const expected = [
    ["zoom_in", "normal"], ["zoom_out", "normal"], ["pan_right", "normal"], ["pedestal_up", "slow"],
    ["tracking", "normal"], ["aerial+tilt_down", "slow"], ["push_in+tilt_up", "slow"],
    ["dolly_zoom+crane_up", "slow"], ["low_angle+crane_up", "normal"], ["push_in+dutch_angle", "slow"],
    ["zoom_in+rack_focus", "very_slow"], ["tracking+handheld", "fast"], ["orbit+tilt_down", "normal"],
    ["fly_through+push_in", "fast"], ["whip_pan+zoom_out", "very_fast"], ["aerial+orbit", "slow"],
    ["steadicam+pan_right", "normal"], ["handheld+zoom_in", "normal"], ["crane_up+roll", "very_slow"],
    ["first_person+handheld", "normal"], ["birds_eye+zoom_out", "slow"],
  ];
  assert.deepEqual(CAMERA_PRESETS.map(preset => [preset.movements.join("+"), preset.speed]), expected);
  for (const preset of CAMERA_PRESETS) {
    const selection = applyCameraPreset(preset.id);
    assert.equal(selection.presetId, preset.id);
    assert.deepEqual(selection.movements, preset.movements);
    assert.equal(selection.speed, preset.speed);
    assert.ok(compileCameraPrompt(selection, "", "A person walks").prompt.startsWith(`[${preset.label}]`));
  }
  assert.ok(searchCameraMoves("焦点").some(move => move.id === "rack_focus"));
  assert.ok(searchCameraMoves("PAN").some(move => move.id === "pan_left"));
});

test("compiler orders preset, actions, speed, upstream text, then raw user text with source offsets", () => {
  const selection = applyCameraPreset("cinematic_intro");
  const upstream = ["人物身份不变", "", "Keep the station architecture"];
  const user = "雨夜站台上，主角抬头。";
  const compiled = compileCameraPrompt(selection, upstream, user);
  assert.match(compiled.prompt, /^\[电影开场\] \[Move the camera toward the subject\] \[Tilt the camera upward from a fixed position\] \[at a slow pace\] 人物身份不变 Keep the station architecture 雨夜站台上，主角抬头。$/);
  assert.deepEqual(compiled.sources.map(part => part.source), ["preset", "movement", "movement", "speed", "upstreamText", "upstreamText", "userText"]);
  assert.deepEqual(compiled.sources.filter(part => part.source === "upstreamText").map(part => part.inputIndex), [0, 2]);
  for (const source of compiled.sources) assert.equal(compiled.prompt.slice(source.start, source.end), source.text);
  assert.ok(compiled.hasContent);
  assert.deepEqual(compiled.warnings, []);
  assert.deepEqual(compileCameraPrompt(selection, upstream, user), compiled, "recompiling the same raw inputs does not accumulate prefixes");
  assert.equal(compiled.sources.filter(part => part.source === "preset").length, 1);
  assert.equal(user, "雨夜站台上，主角抬头。");
});

test("manual actions or speed edits always clear preset identity without mutating the saved selection", () => {
  const original = applyCameraPreset("action_chase");
  const changedSpeed = setCameraSpeed(original, "fast");
  assert.equal(changedSpeed.presetId, undefined, "manual speed selection is custom even if unchanged");
  assert.equal(toggleCameraMove(original, "handheld").presetId, undefined);
  assert.equal(setCameraMovements(original, original.movements).presetId, undefined);
  assert.deepEqual(original, { movements: ["tracking", "handheld"], speed: "fast", presetId: "action_chase" });
  const stale = { ...original, speed: "slow" as const };
  const compiled = compileCameraPrompt(stale, "", "Run through the street");
  assert.equal(compiled.selection.presetId, undefined);
  assert.equal(compiled.sources.some(source => source.source === "preset"), false);
  assert.ok(compiled.warnings.some(warning => warning.code === "preset_identity_removed"));
  assert.deepEqual(normalizeCameraSelection({ movements: ["pan_right", "pan_right"], speed: "normal" }), { movements: ["pan_right"], speed: "normal" });
  assert.throws(() => normalizeCameraSelection({ movements: ["not-a-move"], speed: "normal" } as unknown as CameraSelection), /Unknown camera movement/);
  assert.throws(() => setCameraSpeed(original, "unlimited" as never), /Unknown camera speed/);
  assert.throws(() => applyCameraPreset("imaginary" as never), /Unknown camera preset/);
});

test("normal speed and speed without actions omit speed fragments; movement-only prompts report missing content", () => {
  const normal = compileCameraPrompt(applyCameraPreset("simple_zoom_in"), "", "A flower");
  assert.equal(normal.sources.some(source => source.source === "speed"), false);
  const noActions = compileCameraPrompt({ movements: [], speed: "very_fast" }, "Sky", "");
  assert.equal(noActions.prompt, "Sky");
  const noContent = compileCameraPrompt(applyCameraPreset("simple_zoom_in"), " ", "\n");
  assert.equal(noContent.hasContent, false);
  assert.ok(noContent.warnings.some(warning => warning.code === "missing_content"));
  assert.deepEqual(createCameraSelection(), { movements: [], speed: "normal" });
});

test("conflicting movement selections stay explicit and produce actionable warnings", () => {
  const selection: CameraSelection = { movements: ["static", "tracking", "pan_left", "pan_right"], speed: "normal" };
  const warnings = cameraSelectionWarnings(selection);
  assert.ok(warnings.some(warning => warning.movements?.includes("static")));
  assert.ok(warnings.some(warning => warning.movements?.includes("pan_left") && warning.movements.includes("pan_right")));
  assert.equal(compileCameraPrompt(selection, "", "A dancer").selection.movements.length, 4);
});

test("storyboard defaults use the actual clip duration and never add a zero-length terminal shot", () => {
  const short = createStoryboard(3);
  assert.deepEqual(short.shots.map(shot => [shot.startSeconds, shot.endSeconds]), [[0, 3]]);
  assert.equal(short.soundEffects, false);
  assert.equal(short.backgroundMusic, false);
  assert.throws(() => addStoryboardShot(short), /No time remains/);
  for (const invalid of [undefined, -1, 0, NaN, Infinity]) assert.equal(createStoryboard(invalid).clipDurationSeconds, 30);
  const fractional = createStoryboard(5.25);
  const tail = addStoryboardShot(fractional);
  assert.deepEqual(tail.shots.map(shot => [shot.startSeconds, shot.endSeconds]), [[0, 5], [5, 5.2]]);
  assert.throws(() => addStoryboardShot(tail), /No time remains/);
  const tiny = createStoryboard(0.05);
  assert.equal(tiny.shots[0]!.startSeconds, undefined);
  assert.equal(tiny.shots[0]!.endSeconds, undefined);
  assert.deepEqual(validateStoryboard(tiny), []);
});

test("storyboard add/delete limits maintain 1 to 8 shots with unique ids", () => {
  let storyboard = createStoryboard(40);
  for (let index = 1; index < 8; index++) storyboard = addStoryboardShot(storyboard);
  assert.equal(storyboard.shots.length, 8);
  assert.throws(() => addStoryboardShot(storyboard), /at most 8/);
  assert.throws(() => deleteStoryboardShot(createStoryboard(), "shot-1"), /At least one/);
  assert.throws(() => addStoryboardShot(createStoryboard(20), "shot-1"), StoryboardValidationError);
  assert.throws(() => deleteStoryboardShot(storyboard, "missing"), /Unknown/);
  const removed = deleteStoryboardShot(storyboard, "shot-5");
  assert.equal(removed.shots.length, 7);
  assert.equal(storyboard.shots.length, 8);
});

test("time validation rejects non-finite, overlapping, partial, off-grid and out-of-clip intervals", () => {
  const storyboard = twoShots();
  for (const patch of [
    { startSeconds: NaN }, { endSeconds: Infinity }, { startSeconds: -1 }, { startSeconds: 5, endSeconds: 5 },
    { startSeconds: 3, endSeconds: 2 }, { startSeconds: .25 }, { endSeconds: 10.1 },
    { startSeconds: 4, endSeconds: 6 }, { endSeconds: undefined },
  ]) assert.throws(() => compileStoryboardPrompt(updateShot(storyboard, 0, patch)), StoryboardValidationError);
  assert.throws(() => setStoryboardDuration(storyboard, 6), StoryboardValidationError, "switching to a shorter model duration needs an interval edit");
  assert.throws(() => setStoryboardDuration(storyboard, Infinity), StoryboardValidationError);
  const cleared = setStoryboardShotTime(storyboard, "shot-1");
  assert.equal(cleared.shots[0]!.startSeconds, undefined);
  assert.equal(cleared.shots[0]!.endSeconds, undefined);
  assert.equal(compileStoryboardPrompt(cleared).sources[0]!.text.includes("【时间】"), false);
  assert.throws(() => setStoryboardShotTime(storyboard, "shot-1", 1, undefined), StoryboardValidationError);
});

test("gap-constrained drags cannot overlap another shot; card reordering is distinct from time reflow", () => {
  const storyboard = twoShots();
  const fitted = fitStoryboardShotTime(storyboard, "shot-1", 4, 9);
  assert.deepEqual(fitted.shots.map(shot => [shot.startSeconds, shot.endSeconds]), [[0, 5], [5, 10]]);
  const reordered = moveStoryboardShot(storyboard, "shot-2", 0);
  assert.deepEqual(reordered.shots.map(shot => [shot.id, shot.startSeconds, shot.endSeconds]), [["shot-2", 5, 10], ["shot-1", 0, 5]]);
  assert.deepEqual(reflowStoryboardTimes(reordered).shots.map(shot => [shot.id, shot.startSeconds, shot.endSeconds]), [["shot-2", 0, 5], ["shot-1", 5, 10]]);
  assert.throws(() => moveStoryboardShot(storyboard, "shot-1", 10), /outside/);
  assert.throws(() => fitStoryboardShotTime(storyboard, "shot-1", 4, 3), /positive finite/);
  assert.deepEqual(validateStoryboard(fitted), []);
});

test("focal length and aperture catalogs are eight values each and validate independently", () => {
  assert.equal(STORYBOARD_FOCAL_LENGTHS.length, 8);
  assert.equal(STORYBOARD_APERTURES.length, 8);
  for (let index = 0; index < 8; index++) {
    const storyboard = updateShot(createStoryboard(5), 0, { focalLength: STORYBOARD_FOCAL_LENGTHS[index]!.value, aperture: STORYBOARD_APERTURES[index]!.value });
    const compiled = compileStoryboardPrompt(storyboard);
    const parsed = parseStoryboardPrompt(compiled.prompt, { clipDurationSeconds: 5 });
    assert.equal(parsed.storyboard.shots[0]!.focalLength, storyboard.shots[0]!.focalLength);
    assert.equal(parsed.storyboard.shots[0]!.aperture, storyboard.shots[0]!.aperture);
  }
  assert.throws(() => compileStoryboardPrompt(updateShot(createStoryboard(), 0, { focalLength: "24mm fictional" as never })), StoryboardValidationError);
  assert.throws(() => compileStoryboardPrompt(updateShot(createStoryboard(), 0, { aperture: "f/0" as never })), StoryboardValidationError);
});

test("storyboard prompt uses Chinese markers and text can round trip with references, multiline content and literal markers", () => {
  let storyboard = twoShots();
  storyboard = updateShot(storyboard, 0, {
    focalLength: "35mm人文", aperture: "f/2.8柔和虚化", camera: applyCameraPreset("cinematic_intro"),
    foreground: "@图片1 中的主角", background: "@视频1 雨夜车站", requirements: "抬头看窗外。\n引用台词含【分镜9】与【时间】，路径 C:\\tmp。",
  });
  storyboard = updateShot(storyboard, 1, { requirements: "@音频1 中的脚步声作为参考。" });
  storyboard = { ...storyboard, guidance: ["保持人物服装与空间关系一致。", "广告画面需要文字，请保留品牌标识。"] };
  const compiled = compileStoryboardPrompt(storyboard);
  assert.match(compiled.prompt, /^【分镜1】【时间】0\.0s-5\.0s【焦距】35mm人文【光圈】f\/2\.8柔和虚化【运镜】推进\+上仰 · 慢速/);
  assert.match(compiled.prompt, /【音效】关闭\n【BGM】关闭/);
  assert.equal(compiled.prompt.includes("[Move the camera"), false, "storyboard uses Chinese movement descriptions");
  for (const source of compiled.sources) assert.equal(compiled.prompt.slice(source.start, source.end), source.text);
  const parsed = parseStoryboardPrompt(compiled.prompt, { clipDurationSeconds: 10 });
  assert.equal(parsed.hadMarkers, true);
  assert.equal(parsed.storyboard.shots.length, 2);
  assert.equal(parsed.storyboard.shots[0]!.requirements, storyboard.shots[0]!.requirements);
  assert.equal(parsed.storyboard.shots[0]!.foreground, "@图片1 中的主角");
  assert.deepEqual(parsed.storyboard.guidance, storyboard.guidance);
  assert.deepEqual(parsed.storyboard.shots[0]!.camera, { movements: ["push_in", "tilt_up"], speed: "slow" });
  assert.equal(parsed.storyboard.shots[0]!.camera.presetId, undefined);
  assert.ok(parsed.warnings.some(warning => warning.code === "preset_requires_snapshot"));
  assert.deepEqual(parseStoryboardPrompt(compiled.prompt, { sourceStoryboard: compiled.storyboard }).storyboard, storyboard, "saved snapshot restores preset ids");
});

test("structured prompt snapshots retain preset identity across content edits and drop it across movement edits", () => {
  const original = updateShot(createStoryboard(), 0, { camera: applyCameraPreset("cinematic_intro"), requirements: "Original" });
  const compiled = compileStoryboardPrompt(original);
  const changedContent = parseStoryboardPrompt(compiled.prompt.replace("Original", "Changed"), { sourceStoryboard: compiled.storyboard });
  assert.equal(changedContent.storyboard.shots[0]!.camera.presetId, "cinematic_intro");
  assert.equal(changedContent.storyboard.shots[0]!.requirements, "Changed");
  const changedMovement = parseStoryboardPrompt(compiled.prompt.replace("推进+上仰 · 慢速", "拉近 · 慢速"), { sourceStoryboard: compiled.storyboard });
  assert.equal(changedMovement.storyboard.shots[0]!.camera.presetId, undefined);
  const whitespace = updateShot(original, 0, { requirements: "  lines\nwith trailing whitespace \n" });
  const snapshot = compileStoryboardPrompt(whitespace);
  assert.deepEqual(parseStoryboardPrompt(snapshot.prompt, { sourceStoryboard: snapshot.storyboard }).storyboard, whitespace);
});

test("parser preserves ordinary prompts and unknown legacy fields rather than replacing them with empty text", () => {
  const plain = "人物走进雨中的站台。\n保留衣服颜色。";
  const parsed = parseStoryboardPrompt(plain, { clipDurationSeconds: 8 });
  assert.equal(parsed.hadMarkers, false);
  assert.equal(parsed.unparsedText, plain);
  assert.equal(parsed.storyboard.originalPrompt, plain);
  assert.equal(parsed.storyboard.shots[0]!.requirements, "");
  const roundTrip = parseStoryboardPrompt(compileStoryboardPrompt(parsed.storyboard).prompt, { clipDurationSeconds: 8 });
  assert.equal(roundTrip.storyboard.originalPrompt, plain);
  const unknown = parseStoryboardPrompt("【分镜1】【焦距】900mm未知【光圈】f/0【运镜】推进+未知动作 · 极慢【时间】broken【要求】保留动作\n\n【音效】开启\n【BGM】关闭\n保持光照一致。", { clipDurationSeconds: 8 });
  assert.match(unknown.unparsedText, /900mm未知/);
  assert.match(unknown.unparsedText, /未知动作/);
  assert.match(unknown.unparsedText, /broken/);
  assert.equal(unknown.storyboard.soundEffects, true);
  assert.equal(unknown.storyboard.backgroundMusic, false);
  assert.deepEqual(unknown.storyboard.guidance, ["保持光照一致。"]);
  assert.deepEqual(unknown.storyboard.shots[0]!.camera, { movements: ["push_in"], speed: "very_slow" });
  assert.equal(unknown.storyboard.shots[0]!.requirements, "保留动作");
  assert.deepEqual(validateStoryboard(unknown.storyboard), []);
});

test("legacy interval parsing clamps to duration, reflows overlaps, and clears terminal zero lengths with visible warnings", () => {
  const prompt = "【分镜1】【时间】-2.0s-4.0s【要求】A\n\n【分镜2】【时间】3.0s-7.0s【要求】B\n\n【分镜3】【时间】4.0s-7.0s【要求】C\n【音效】关闭\n【BGM】关闭";
  const parsed = parseStoryboardPrompt(prompt, { clipDurationSeconds: 6 });
  assert.deepEqual(parsed.storyboard.shots.map(shot => [shot.startSeconds, shot.endSeconds]), [[0, 4], [4, 6], [undefined, undefined]]);
  assert.ok(parsed.warnings.some(warning => warning.code === "time_clamped"));
  assert.ok(parsed.warnings.some(warning => warning.code === "time_reflowed"));
  assert.ok(parsed.warnings.some(warning => warning.code === "time_cleared"));
  assert.deepEqual(validateStoryboard(parsed.storyboard), []);
  const full = parseStoryboardPrompt("【分镜1】【时间】6.0s-6.0s", { clipDurationSeconds: 6 });
  assert.equal(full.storyboard.shots[0]!.startSeconds, undefined);
  assert.match(full.unparsedText, /6.0s-6.0s/);
  const ordered = parseStoryboardPrompt("【分镜1】【时间】5.0s-10.0s\n\n【分镜2】【时间】0.0s-5.0s", { clipDurationSeconds: 10 });
  assert.deepEqual(ordered.storyboard.shots.map(shot => shot.startSeconds), [5, 0], "valid times remain authored even when card order differs");
});

test("more than eight imported shots stay recoverable without producing extra editor cards", () => {
  const prompt = Array.from({ length: 9 }, (_, index) => `【分镜${index + 1}】【要求】Shot ${index + 1}`).join("\n\n");
  const parsed = parseStoryboardPrompt(prompt);
  assert.equal(parsed.storyboard.shots.length, 8);
  assert.match(parsed.unparsedText, /【分镜9】【要求】Shot 9/);
  assert.ok(parsed.warnings.some(warning => warning.code === "extra_shots_preserved"));
});

test("sound effects and BGM compile prompt notes without mutating native generation or playback audio controls", () => {
  const generationParameters = Object.freeze({ generateAudio: false, referenceAudio: "track.wav", preserveOriginalAudio: true, previewMute: true });
  const storyboard = createStoryboard(5);
  const withNotes = setStoryboardAudioNotes(storyboard, { soundEffects: true, backgroundMusic: true });
  assert.equal(storyboard.soundEffects, false);
  assert.equal(storyboard.backgroundMusic, false);
  assert.match(compileStoryboardPrompt(withNotes).prompt, /【音效】开启\n【BGM】开启/);
  assert.deepEqual(generationParameters, { generateAudio: false, referenceAudio: "track.wav", preserveOriginalAudio: true, previewMute: true });
  assert.equal("generateAudio" in withNotes, false);
  assert.equal("referenceAudio" in withNotes, false);
  assert.throws(() => setStoryboardAudioNotes(storyboard, { backgroundMusic: "true" as never }), StoryboardValidationError);
});
