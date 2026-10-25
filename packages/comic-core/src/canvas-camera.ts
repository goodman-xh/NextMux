/** Camera language is compiled before generation; it never edits or submits media. */
export const CAMERA_MOVES = [
  { id: "zoom_in", label: "拉近", category: "zoom", actionPhrase: "Zoom toward the subject" },
  { id: "zoom_out", label: "拉远", category: "zoom", actionPhrase: "Zoom out to reveal the surroundings" },
  { id: "push_in", label: "推进", category: "zoom", actionPhrase: "Move the camera toward the subject" },
  { id: "pull_out", label: "拉出", category: "zoom", actionPhrase: "Move the camera away from the subject" },
  { id: "dolly_zoom", label: "希区柯克", category: "zoom", actionPhrase: "Use a dolly zoom while keeping the subject the same size" },
  { id: "rack_focus", label: "焦点转移", category: "zoom", actionPhrase: "Shift focus between subjects at different depths" },
  { id: "pan_left", label: "左摇", category: "horizontal", actionPhrase: "Pan the camera to the left" },
  { id: "pan_right", label: "右摇", category: "horizontal", actionPhrase: "Pan the camera to the right" },
  { id: "truck_left", label: "左移", category: "horizontal", actionPhrase: "Translate the camera to the left" },
  { id: "truck_right", label: "右移", category: "horizontal", actionPhrase: "Translate the camera to the right" },
  { id: "arc_left", label: "左弧", category: "horizontal", actionPhrase: "Move along an arc on the subject's left side" },
  { id: "arc_right", label: "右弧", category: "horizontal", actionPhrase: "Move along an arc on the subject's right side" },
  { id: "slide", label: "滑轨", category: "horizontal", actionPhrase: "Glide smoothly along a camera slider" },
  { id: "tilt_up", label: "上仰", category: "vertical", actionPhrase: "Tilt the camera upward from a fixed position" },
  { id: "tilt_down", label: "下俯", category: "vertical", actionPhrase: "Tilt the camera downward from a fixed position" },
  { id: "pedestal_up", label: "升起", category: "vertical", actionPhrase: "Raise the camera vertically" },
  { id: "pedestal_down", label: "降落", category: "vertical", actionPhrase: "Lower the camera vertically" },
  { id: "crane_up", label: "摇臂升", category: "vertical", actionPhrase: "Lift the viewpoint with an ascending crane movement" },
  { id: "crane_down", label: "摇臂降", category: "vertical", actionPhrase: "Descend with a crane camera movement" },
  { id: "boom_up", label: "吊臂升", category: "vertical", actionPhrase: "Raise the camera on a boom arm" },
  { id: "boom_down", label: "吊臂降", category: "vertical", actionPhrase: "Lower the camera on a boom arm" },
  { id: "tracking", label: "跟踪", category: "special", actionPhrase: "Track the subject's movement through the scene" },
  { id: "orbit", label: "环绕", category: "special", actionPhrase: "Orbit the camera around the subject" },
  { id: "handheld", label: "手持", category: "special", actionPhrase: "Use natural handheld camera motion" },
  { id: "steadicam", label: "稳定器", category: "special", actionPhrase: "Follow the scene with a steady stabilized camera" },
  { id: "whip_pan", label: "甩镜", category: "special", actionPhrase: "Whip pan rapidly across the scene" },
  { id: "roll", label: "翻滚", category: "special", actionPhrase: "Rotate the camera around its viewing axis" },
  { id: "static", label: "静止", category: "special", actionPhrase: "Hold the camera still while the scene unfolds" },
  { id: "fly_through", label: "穿越", category: "special", actionPhrase: "Fly the camera through the space" },
  { id: "aerial", label: "航拍", category: "special", actionPhrase: "Observe the scene from a moving aerial viewpoint" },
  { id: "first_person", label: "第一人称", category: "special", actionPhrase: "Show the character's first-person viewpoint" },
  { id: "over_shoulder", label: "过肩", category: "special", actionPhrase: "Frame the scene over a foreground character's shoulder" },
  { id: "dutch_angle", label: "荷兰角", category: "special", actionPhrase: "Compose the frame with a tilted horizon" },
  { id: "low_angle", label: "低角度", category: "special", actionPhrase: "View the subject from a low camera angle" },
  { id: "high_angle", label: "高角度", category: "special", actionPhrase: "View the subject from a high camera angle" },
  { id: "birds_eye", label: "鸟瞰", category: "special", actionPhrase: "Look straight down from a bird's-eye viewpoint" },
  { id: "worms_eye", label: "虫视", category: "special", actionPhrase: "Look upward from a viewpoint close to the ground" },
] as const;

export type CameraMoveId = typeof CAMERA_MOVES[number]["id"];
export type CameraMove = typeof CAMERA_MOVES[number];
export const CAMERA_SPEEDS = [
  { id: "very_slow", label: "极慢", actionPhrase: "at a very slow pace" },
  { id: "slow", label: "慢速", actionPhrase: "at a slow pace" },
  { id: "normal", label: "正常", actionPhrase: "" },
  { id: "fast", label: "快速", actionPhrase: "at a fast pace" },
  { id: "very_fast", label: "极快", actionPhrase: "at a very fast pace" },
] as const;
export type CameraSpeedId = typeof CAMERA_SPEEDS[number]["id"];
export const CAMERA_PRESETS = [
  { id: "simple_zoom_in", label: "简单拉近", movements: ["zoom_in"], speed: "normal" },
  { id: "simple_zoom_out", label: "简单拉远", movements: ["zoom_out"], speed: "normal" },
  { id: "smooth_pan", label: "平滑摇移", movements: ["pan_right"], speed: "normal" },
  { id: "gentle_rise", label: "缓缓升起", movements: ["pedestal_up"], speed: "slow" },
  { id: "tracking_follow", label: "跟踪拍摄", movements: ["tracking"], speed: "normal" },
  { id: "aerial_view", label: "航拍俯视", movements: ["aerial", "tilt_down"], speed: "slow" },
  { id: "cinematic_intro", label: "电影开场", movements: ["push_in", "tilt_up"], speed: "slow" },
  { id: "dramatic_reveal", label: "戏剧揭示", movements: ["dolly_zoom", "crane_up"], speed: "slow" },
  { id: "hero_entrance", label: "英雄登场", movements: ["low_angle", "crane_up"], speed: "normal" },
  { id: "mystery_reveal", label: "悬疑揭秘", movements: ["push_in", "dutch_angle"], speed: "slow" },
  { id: "intimate_portrait", label: "亲密特写", movements: ["zoom_in", "rack_focus"], speed: "very_slow" },
  { id: "action_chase", label: "动作追逐", movements: ["tracking", "handheld"], speed: "fast" },
  { id: "dynamic_orbit", label: "动态环绕", movements: ["orbit", "tilt_down"], speed: "normal" },
  { id: "fly_through_scene", label: "穿越场景", movements: ["fly_through", "push_in"], speed: "fast" },
  { id: "whip_pan_reveal", label: "甩镜转场", movements: ["whip_pan", "zoom_out"], speed: "very_fast" },
  { id: "epic_aerial", label: "史诗航拍", movements: ["aerial", "orbit"], speed: "slow" },
  { id: "smooth_explore", label: "平滑探索", movements: ["steadicam", "pan_right"], speed: "normal" },
  { id: "documentary_style", label: "纪录片风", movements: ["handheld", "zoom_in"], speed: "normal" },
  { id: "dreamy_float", label: "梦幻漂浮", movements: ["crane_up", "roll"], speed: "very_slow" },
  { id: "first_person_walk", label: "第一人称", movements: ["first_person", "handheld"], speed: "normal" },
  { id: "birds_eye_reveal", label: "鸟瞰全景", movements: ["birds_eye", "zoom_out"], speed: "slow" },
] as const satisfies readonly { id: string; label: string; movements: readonly CameraMoveId[]; speed: CameraSpeedId }[];
export type CameraPresetId = typeof CAMERA_PRESETS[number]["id"];
export interface CameraSelection {
  readonly movements: readonly CameraMoveId[];
  readonly speed: CameraSpeedId;
  readonly presetId?: CameraPresetId;
}
export interface CameraWarning {
  readonly code: "conflicting_movements" | "missing_content" | "preset_identity_removed";
  readonly message: string;
  readonly movements?: readonly CameraMoveId[];
}
export interface CameraPromptSource {
  readonly source: "preset" | "movement" | "speed" | "upstreamText" | "userText";
  readonly id?: string;
  readonly inputIndex?: number;
  readonly text: string;
  /** Character offsets into the final prompt, suitable for a source preview. */
  readonly start: number;
  readonly end: number;
}
export interface CompiledCameraPrompt {
  readonly prompt: string;
  readonly selection: CameraSelection;
  readonly sources: readonly CameraPromptSource[];
  readonly hasContent: boolean;
  readonly warnings: readonly CameraWarning[];
}

function moveFor(id: CameraMoveId): CameraMove {
  const move = CAMERA_MOVES.find(candidate => candidate.id === id);
  if (!move) throw new RangeError(`Unknown camera movement: ${String(id)}`);
  return move;
}
function speedFor(id: CameraSpeedId) {
  const speed = CAMERA_SPEEDS.find(candidate => candidate.id === id);
  if (!speed) throw new RangeError(`Unknown camera speed: ${String(id)}`);
  return speed;
}
function sameMoves(left: readonly CameraMoveId[], right: readonly CameraMoveId[]): boolean {
  return left.length === right.length && left.every(move => right.includes(move));
}

/** Fresh snapshots make editor drafts independent of saved node parameters. */
export function createCameraSelection(): CameraSelection {
  return { movements: [], speed: "normal" };
}
export function normalizeCameraSelection(selection: CameraSelection): CameraSelection {
  const movements = [...new Set(selection.movements)];
  movements.forEach(moveFor);
  speedFor(selection.speed);
  const preset = selection.presetId && CAMERA_PRESETS.find(candidate => candidate.id === selection.presetId);
  const presetId = preset && preset.speed === selection.speed && sameMoves(movements, preset.movements) ? preset.id : undefined;
  return { movements, speed: selection.speed, ...(presetId ? { presetId } : {}) };
}
export function applyCameraPreset(presetId: CameraPresetId): CameraSelection {
  const preset = CAMERA_PRESETS.find(candidate => candidate.id === presetId);
  if (!preset) throw new RangeError(`Unknown camera preset: ${String(presetId)}`);
  return { movements: [...preset.movements], speed: preset.speed, presetId };
}
/** Every manual edit clears identity, even when selecting the current speed again. */
export function setCameraMovements(selection: CameraSelection, movements: readonly CameraMoveId[]): CameraSelection {
  return normalizeCameraSelection({ movements, speed: selection.speed });
}
export function toggleCameraMove(selection: CameraSelection, movement: CameraMoveId): CameraSelection {
  moveFor(movement);
  return setCameraMovements(selection, selection.movements.includes(movement)
    ? selection.movements.filter(value => value !== movement) : [...selection.movements, movement]);
}
export function setCameraSpeed(selection: CameraSelection, speed: CameraSpeedId): CameraSelection {
  return normalizeCameraSelection({ movements: selection.movements, speed });
}
export function searchCameraMoves(query: string): readonly CameraMove[] {
  const needle = query.trim().toLocaleLowerCase();
  return CAMERA_MOVES.filter(move => `${move.id} ${move.label} ${move.actionPhrase}`.toLocaleLowerCase().includes(needle));
}
export function cameraSelectionWarnings(selection: CameraSelection): readonly CameraWarning[] {
  const normalized = normalizeCameraSelection(selection);
  const conflicts: readonly (readonly CameraMoveId[])[] = [
    ["zoom_in", "zoom_out"], ["push_in", "pull_out"], ["pan_left", "pan_right"],
    ["truck_left", "truck_right"], ["arc_left", "arc_right"], ["tilt_up", "tilt_down"],
    ["pedestal_up", "pedestal_down"], ["crane_up", "crane_down"], ["boom_up", "boom_down"],
  ];
  const warnings: CameraWarning[] = [];
  for (const pair of conflicts) if (pair.every(id => normalized.movements.includes(id))) {
    warnings.push({ code: "conflicting_movements", movements: pair, message: `运镜方向冲突：${pair.map(id => moveFor(id).label).join("、")}；可放入不同分镜。` });
  }
  const staticConflicts = normalized.movements.filter(id => !["static", "rack_focus", "over_shoulder", "dutch_angle", "low_angle", "high_angle", "birds_eye", "worms_eye", "first_person"].includes(id));
  if (normalized.movements.includes("static") && staticConflicts.length) warnings.push({
    code: "conflicting_movements", movements: ["static", ...staticConflicts], message: "静止机位与移动运镜同时存在；请确认意图或分开安排。",
  });
  if (selection.presetId && !normalized.presetId) warnings.push({ code: "preset_identity_removed", message: "动作或速度已自定义，组合预设身份已清除。" });
  return warnings;
}

/** Always compile from raw inputs. Passing a previously compiled prompt as user text would intentionally retain it. */
export function compileCameraPrompt(selection: CameraSelection, upstreamText: string | readonly string[], userText: string): CompiledCameraPrompt {
  const normalized = normalizeCameraSelection(selection);
  const warnings = [...cameraSelectionWarnings(selection)];
  const parts: Omit<CameraPromptSource, "start" | "end">[] = [];
  const preset = normalized.presetId && CAMERA_PRESETS.find(candidate => candidate.id === normalized.presetId);
  if (normalized.movements.length) {
    if (preset) parts.push({ source: "preset", id: preset.id, text: `[${preset.label}]` });
    for (const id of normalized.movements) parts.push({ source: "movement", id, text: `[${moveFor(id).actionPhrase}]` });
    if (normalized.speed !== "normal") parts.push({ source: "speed", id: normalized.speed, text: `[${speedFor(normalized.speed).actionPhrase}]` });
  }
  const upstream = typeof upstreamText === "string" ? [upstreamText] : upstreamText;
  upstream.forEach((text, inputIndex) => { if (text.trim()) parts.push({ source: "upstreamText", inputIndex, text }); });
  if (userText.trim()) parts.push({ source: "userText", text: userText });
  const hasContent = upstream.some(text => Boolean(text.trim())) || Boolean(userText.trim());
  if (!hasContent) warnings.push({ code: "missing_content", message: "运镜文字不能代替人物、动作或场景内容。" });
  let prompt = "";
  const sources = parts.map(part => {
    if (prompt) prompt += " ";
    const start = prompt.length;
    prompt += part.text;
    return { ...part, start, end: prompt.length };
  });
  return { prompt, selection: normalized, sources, hasContent, warnings };
}

/** Video storyboard intent only; this is not the image-camera equipment catalog. */
export const STORYBOARD_FOCAL_LENGTHS = [
  { value: "16mm超广角", label: "16mm 超广角" }, { value: "24mm广角", label: "24mm 广角" },
  { value: "35mm人文", label: "35mm 人文" }, { value: "50mm标准", label: "50mm 标准" },
  { value: "85mm人像", label: "85mm 人像" }, { value: "105mm微距", label: "105mm 微距" },
  { value: "135mm长焦", label: "135mm 长焦" }, { value: "200mm超长焦", label: "200mm 超长焦" },
] as const;
export const STORYBOARD_APERTURES = [
  { value: "f/1.4极浅景深", label: "f/1.4 极浅景深" }, { value: "f/1.8浅景深", label: "f/1.8 浅景深" },
  { value: "f/2.8柔和虚化", label: "f/2.8 柔和虚化" }, { value: "f/4.0适中景深", label: "f/4.0 适中景深" },
  { value: "f/5.6清晰适中", label: "f/5.6 清晰适中" }, { value: "f/8.0全面清晰", label: "f/8.0 全面清晰" },
  { value: "f/11风景锐利", label: "f/11 风景锐利" }, { value: "f/16超大景深", label: "f/16 超大景深" },
] as const;
export type StoryboardFocalLength = typeof STORYBOARD_FOCAL_LENGTHS[number]["value"];
export type StoryboardAperture = typeof STORYBOARD_APERTURES[number]["value"];
export const STORYBOARD_MAX_SHOTS = 8;
export const STORYBOARD_TIME_STEP_SECONDS = 0.1;
export interface CanvasStoryboardShot {
  readonly id: string;
  /** Both values may be omitted to clear time. Otherwise 0 <= start < end <= clip duration. */
  readonly startSeconds?: number;
  readonly endSeconds?: number;
  readonly focalLength?: StoryboardFocalLength;
  readonly aperture?: StoryboardAperture;
  readonly camera: CameraSelection;
  readonly foreground: string;
  readonly background: string;
  readonly requirements: string;
}
export interface CanvasStoryboard {
  readonly version: 1;
  readonly clipDurationSeconds: number;
  readonly shots: readonly CanvasStoryboardShot[];
  /** These booleans change prompt notes only. Native audio parameters belong to the generation request. */
  readonly soundEffects: boolean;
  readonly backgroundMusic: boolean;
  readonly guidance: readonly string[];
  /** An imported plain prompt remains recoverable without inventing shot contents. */
  readonly originalPrompt?: string;
}
export interface StoryboardIssue {
  readonly code: "duration" | "shot_count" | "shot_id" | "time" | "overlap" | "focal_length" | "aperture" | "camera" | "text" | "audio_notes" | "version";
  readonly shotId?: string;
  readonly message: string;
}
export interface StoryboardParseWarning {
  readonly code: "plain_prompt_preserved" | "time_clamped" | "time_reflowed" | "time_cleared" | "unrecognized_value" | "extra_shots_preserved" | "preset_requires_snapshot";
  readonly shotId?: string;
  readonly message: string;
}
export class StoryboardValidationError extends Error {
  readonly issues: readonly StoryboardIssue[];
  constructor(issues: readonly StoryboardIssue[]) {
    super(issues.map(issue => issue.message).join(" "));
    this.name = "StoryboardValidationError";
    this.issues = issues;
  }
}
function validDuration(duration: number | undefined): number {
  return typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : 30;
}
function snapTime(seconds: number): number { return Math.round(seconds * 10) / 10; }
function lastTime(duration: number): number { return Math.floor((duration + 1e-9) * 10) / 10; }
function hasTime(shot: CanvasStoryboardShot): shot is CanvasStoryboardShot & { startSeconds: number; endSeconds: number } {
  return shot.startSeconds !== undefined && shot.endSeconds !== undefined;
}
function blankShot(id: string, startSeconds?: number, endSeconds?: number): CanvasStoryboardShot {
  return { id, ...(startSeconds !== undefined && endSeconds !== undefined ? { startSeconds, endSeconds } : {}), camera: createCameraSelection(), foreground: "", background: "", requirements: "" };
}
function assertStoryboard(storyboard: CanvasStoryboard): void {
  const issues = validateStoryboard(storyboard);
  if (issues.length) throw new StoryboardValidationError(issues);
}
export function createStoryboard(clipDurationSeconds?: number): CanvasStoryboard {
  const duration = validDuration(clipDurationSeconds), end = lastTime(Math.min(duration, 5));
  return { version: 1, clipDurationSeconds: duration, shots: [end > 0 ? blankShot("shot-1", 0, end) : blankShot("shot-1")], soundEffects: false, backgroundMusic: false, guidance: [] };
}
export function validateStoryboard(storyboard: CanvasStoryboard): readonly StoryboardIssue[] {
  const issues: StoryboardIssue[] = [];
  const issue = (code: StoryboardIssue["code"], message: string, shotId?: string) => issues.push({ code, message, ...(shotId !== undefined ? { shotId } : {}) });
  if (storyboard.version !== 1) issue("version", "Unsupported storyboard version.");
  if (!Number.isFinite(storyboard.clipDurationSeconds) || storyboard.clipDurationSeconds <= 0) issue("duration", "Clip duration must be positive and finite.");
  if (storyboard.shots.length < 1 || storyboard.shots.length > STORYBOARD_MAX_SHOTS) issue("shot_count", "A storyboard must contain 1 to 8 shots.");
  if (typeof storyboard.soundEffects !== "boolean" || typeof storyboard.backgroundMusic !== "boolean") issue("audio_notes", "Sound effect and BGM notes must be booleans.");
  if (!Array.isArray(storyboard.guidance) || storyboard.guidance.some(text => typeof text !== "string") || (storyboard.originalPrompt !== undefined && typeof storyboard.originalPrompt !== "string")) issue("text", "Storyboard guidance and original prompt must be text.");
  const ids = new Set<string>();
  for (const shot of storyboard.shots) {
    if (typeof shot.id !== "string" || !shot.id.trim() || ids.has(shot.id)) issue("shot_id", "Shot ids must be non-empty and unique.", shot.id);
    ids.add(shot.id);
    if (shot.focalLength !== undefined && !STORYBOARD_FOCAL_LENGTHS.some(item => item.value === shot.focalLength)) issue("focal_length", "Unknown storyboard focal length.", shot.id);
    if (shot.aperture !== undefined && !STORYBOARD_APERTURES.some(item => item.value === shot.aperture)) issue("aperture", "Unknown storyboard aperture.", shot.id);
    if ([shot.foreground, shot.background, shot.requirements].some(text => typeof text !== "string")) issue("text", "Shot descriptions must be text.", shot.id);
    try { normalizeCameraSelection(shot.camera); } catch { issue("camera", "Unknown camera movement or speed.", shot.id); }
    if (shot.startSeconds === undefined && shot.endSeconds === undefined) continue;
    if (!hasTime(shot) || !Number.isFinite(shot.startSeconds) || !Number.isFinite(shot.endSeconds)
      || shot.startSeconds < 0 || shot.startSeconds >= shot.endSeconds || shot.endSeconds > storyboard.clipDurationSeconds
      || Math.abs(snapTime(shot.startSeconds) - shot.startSeconds) > 1e-8 || Math.abs(snapTime(shot.endSeconds) - shot.endSeconds) > 1e-8) {
      issue("time", "Shot times must use 0.1-second steps with 0 <= start < end <= clip duration.", shot.id);
    }
  }
  const timed = storyboard.shots.filter(hasTime).filter(shot => Number.isFinite(shot.startSeconds) && Number.isFinite(shot.endSeconds)).sort((a, b) => a.startSeconds - b.startSeconds);
  let previousEnd = 0;
  for (const shot of timed) {
    if (shot.startSeconds < previousEnd) issue("overlap", "Shot time intervals overlap.", shot.id);
    previousEnd = Math.max(previousEnd, shot.endSeconds);
  }
  return issues;
}
export function addStoryboardShot(storyboard: CanvasStoryboard, id?: string): CanvasStoryboard {
  assertStoryboard(storyboard);
  if (storyboard.shots.length >= STORYBOARD_MAX_SHOTS) throw new RangeError("A storyboard supports at most 8 shots.");
  const start = Math.max(0, ...storyboard.shots.filter(hasTime).map(shot => shot.endSeconds));
  const end = lastTime(Math.min(start + 5, storyboard.clipDurationSeconds));
  if (end <= start) throw new RangeError("No time remains in the clip for another shot.");
  let number = storyboard.shots.length + 1;
  while (storyboard.shots.some(shot => shot.id === `shot-${number}`)) number++;
  const result = { ...storyboard, shots: [...storyboard.shots, blankShot(id ?? `shot-${number}`, start, end)] };
  assertStoryboard(result);
  return result;
}
export function deleteStoryboardShot(storyboard: CanvasStoryboard, id: string): CanvasStoryboard {
  assertStoryboard(storyboard);
  if (!storyboard.shots.some(shot => shot.id === id)) throw new RangeError(`Unknown storyboard shot: ${id}`);
  if (storyboard.shots.length <= 1) throw new RangeError("At least one storyboard shot must remain.");
  return { ...storyboard, shots: storyboard.shots.filter(shot => shot.id !== id) };
}
/** Card order affects numbering, never silently changes authored time intervals. */
export function moveStoryboardShot(storyboard: CanvasStoryboard, id: string, toIndex: number): CanvasStoryboard {
  assertStoryboard(storyboard);
  const fromIndex = storyboard.shots.findIndex(shot => shot.id === id);
  if (fromIndex < 0) throw new RangeError(`Unknown storyboard shot: ${id}`);
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= storyboard.shots.length) throw new RangeError("Shot destination is outside the storyboard.");
  const shots = [...storyboard.shots];
  shots.splice(toIndex, 0, shots.splice(fromIndex, 1)[0]!);
  return { ...storyboard, shots };
}
export function setStoryboardShotTime(storyboard: CanvasStoryboard, id: string, startSeconds?: number, endSeconds?: number): CanvasStoryboard {
  assertStoryboard(storyboard);
  if (!storyboard.shots.some(shot => shot.id === id)) throw new RangeError(`Unknown storyboard shot: ${id}`);
  const shots = storyboard.shots.map(shot => {
    if (shot.id !== id) return shot;
    const { startSeconds: _start, endSeconds: _end, ...rest } = shot;
    return { ...rest, ...(startSeconds !== undefined || endSeconds !== undefined ? { startSeconds, endSeconds } : {}) };
  });
  const result = { ...storyboard, shots };
  assertStoryboard(result);
  return result;
}
/** Fit a drag into an available gap; occupied intervals cannot be crossed. */
export function fitStoryboardShotTime(storyboard: CanvasStoryboard, id: string, startSeconds: number, endSeconds: number): CanvasStoryboard {
  assertStoryboard(storyboard);
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) throw new RangeError("A dragged time interval must have positive finite length.");
  const timed = storyboard.shots.filter(shot => shot.id !== id).filter(hasTime).sort((a, b) => a.startSeconds - b.startSeconds);
  const gaps: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const shot of timed) { if (shot.startSeconds > cursor) gaps.push({ start: cursor, end: shot.startSeconds }); cursor = shot.endSeconds; }
  if (lastTime(storyboard.clipDurationSeconds) > cursor) gaps.push({ start: cursor, end: lastTime(storyboard.clipDurationSeconds) });
  if (!gaps.length) throw new RangeError("No time remains for this shot.");
  const overlap = (gap: { start: number; end: number }) => Math.max(0, Math.min(endSeconds, gap.end) - Math.max(startSeconds, gap.start));
  const distance = (gap: { start: number; end: number }) => Math.max(gap.start - startSeconds, startSeconds - gap.end, 0);
  gaps.sort((a, b) => overlap(b) - overlap(a) || distance(a) - distance(b));
  const gap = gaps[0]!;
  const length = Math.min(Math.max(0.1, snapTime(endSeconds - startSeconds)), snapTime(gap.end - gap.start));
  const start = snapTime(Math.max(gap.start, Math.min(snapTime(startSeconds), gap.end - length)));
  return setStoryboardShotTime(storyboard, id, start, snapTime(start + length));
}
/** Explicit reflow uses card order and fails if even the minimum intervals cannot fit. */
export function reflowStoryboardTimes(storyboard: CanvasStoryboard): CanvasStoryboard {
  assertStoryboard(storyboard);
  let cursor = 0;
  const limit = lastTime(storyboard.clipDurationSeconds);
  const shots = storyboard.shots.map((shot, index) => {
    const remaining = storyboard.shots.length - index - 1;
    const requested = hasTime(shot) ? snapTime(shot.endSeconds - shot.startSeconds) : 5;
    const available = snapTime(limit - cursor - remaining * 0.1);
    if (available < 0.1) throw new RangeError("Clip duration cannot fit every storyboard shot.");
    const startSeconds = cursor, endSeconds = snapTime(cursor + Math.min(requested, available));
    cursor = endSeconds;
    return { ...shot, startSeconds, endSeconds };
  });
  return { ...storyboard, shots };
}
/** A shorter generation duration must be acknowledged by editing intervals; invalid snapshots are rejected. */
export function setStoryboardDuration(storyboard: CanvasStoryboard, clipDurationSeconds: number): CanvasStoryboard {
  const result = { ...storyboard, clipDurationSeconds };
  assertStoryboard(result);
  return result;
}
export function setStoryboardAudioNotes(storyboard: CanvasStoryboard, notes: { readonly soundEffects?: boolean; readonly backgroundMusic?: boolean }): CanvasStoryboard {
  const result = { ...storyboard, ...(notes.soundEffects !== undefined ? { soundEffects: notes.soundEffects } : {}), ...(notes.backgroundMusic !== undefined ? { backgroundMusic: notes.backgroundMusic } : {}) };
  assertStoryboard(result);
  return result;
}

export interface StoryboardPromptSource {
  readonly source: "shot" | "soundEffectsNote" | "backgroundMusicNote" | "guidance" | "originalText";
  readonly shotId?: string;
  readonly inputIndex?: number;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}
export interface CompiledStoryboardPrompt {
  readonly prompt: string;
  /** Persist this snapshot beside the prompt to retain ids and preset identity. */
  readonly storyboard: CanvasStoryboard;
  readonly sources: readonly StoryboardPromptSource[];
  readonly warnings: readonly (CameraWarning & { readonly shotId: string })[];
}
function escapeText(text: string): string {
  return text.replace(/\\/g, "\\u005c").replace(/【/g, "\\u3010");
}
function unescapeText(text: string): string {
  return text.replace(/\\u(005c|3010)/g, (_, code: string) => code === "005c" ? "\\" : "【");
}
export function compileStoryboardPrompt(storyboard: CanvasStoryboard): CompiledStoryboardPrompt {
  assertStoryboard(storyboard);
  const snapshot: CanvasStoryboard = {
    ...storyboard, guidance: [...storyboard.guidance],
    shots: storyboard.shots.map(shot => ({ ...shot, camera: normalizeCameraSelection(shot.camera) })),
  };
  const parts: (Omit<StoryboardPromptSource, "start" | "end"> & { separator: string })[] = [];
  if (snapshot.originalPrompt) parts.push({ source: "originalText", text: escapeText(snapshot.originalPrompt), separator: "" });
  snapshot.shots.forEach((shot, index) => {
    let text = `【分镜${index + 1}】`;
    if (hasTime(shot)) text += `【时间】${shot.startSeconds.toFixed(1)}s-${shot.endSeconds.toFixed(1)}s`;
    if (shot.focalLength) text += `【焦距】${shot.focalLength}`;
    if (shot.aperture) text += `【光圈】${shot.aperture}`;
    if (shot.camera.movements.length) text += `【运镜】${shot.camera.movements.map(id => moveFor(id).label).join("+")} · ${speedFor(shot.camera.speed).label}`;
    for (const [label, value] of [["前景", shot.foreground], ["远景", shot.background], ["要求", shot.requirements]]) if (value) text += `【${label}】${escapeText(value!)}`;
    parts.push({ source: "shot", shotId: shot.id, text, separator: "\n\n" });
  });
  parts.push({ source: "soundEffectsNote", text: `【音效】${snapshot.soundEffects ? "开启" : "关闭"}`, separator: "\n\n" });
  parts.push({ source: "backgroundMusicNote", text: `【BGM】${snapshot.backgroundMusic ? "开启" : "关闭"}`, separator: "\n" });
  snapshot.guidance.forEach((text, inputIndex) => parts.push({ source: "guidance", inputIndex, text: `【指导】${escapeText(text)}`, separator: "\n" }));
  let prompt = "";
  const sources = parts.map(({ separator, ...part }) => {
    if (prompt) prompt += separator;
    const start = prompt.length;
    prompt += part.text;
    return { ...part, start, end: prompt.length };
  });
  const warnings = storyboard.shots.flatMap(shot => cameraSelectionWarnings(shot.camera).map(warning => ({ ...warning, shotId: shot.id })));
  return { prompt, storyboard: snapshot, sources, warnings };
}
export interface ParseStoryboardOptions {
  readonly clipDurationSeconds?: number;
  /** Text does not encode preset ids; a matching saved selection can restore them. */
  readonly sourceStoryboard?: CanvasStoryboard;
}
export interface ParsedStoryboardPrompt {
  readonly storyboard: CanvasStoryboard;
  readonly warnings: readonly StoryboardParseWarning[];
  readonly hadMarkers: boolean;
  /** Unknown or plain text is preserved for UI review, never discarded. */
  readonly unparsedText: string;
}
function parseCameraText(text: string, saved?: CameraSelection): { camera: CameraSelection; unknown: string[] } {
  const [movementText, speedText] = text.split(/\s*·\s*/);
  const unknown: string[] = [];
  const movements: CameraMoveId[] = [];
  for (const label of movementText!.split(/\s*[+＋]\s*/).filter(Boolean)) {
    const move = CAMERA_MOVES.find(candidate => candidate.label === label || candidate.id === label);
    if (move) movements.push(move.id); else unknown.push(label);
  }
  const speed = CAMERA_SPEEDS.find(candidate => candidate.label === speedText || candidate.id === speedText)?.id ?? "normal";
  if (speedText && !CAMERA_SPEEDS.some(candidate => candidate.label === speedText || candidate.id === speedText)) unknown.push(speedText);
  const parsed = normalizeCameraSelection({ movements, speed });
  const normalizedSaved = saved && normalizeCameraSelection(saved);
  return { camera: normalizedSaved && sameMoves(normalizedSaved.movements, parsed.movements) && normalizedSaved.speed === parsed.speed
    ? { ...parsed, ...(normalizedSaved.presetId ? { presetId: normalizedSaved.presetId } : {}) } : parsed, unknown };
}

/** Legacy time intervals are clamped and overlapping intervals are explicitly reflowed, with warnings. */
export function parseStoryboardPrompt(prompt: string, options: ParseStoryboardOptions = {}): ParsedStoryboardPrompt {
  const duration = validDuration(options.clipDurationSeconds ?? options.sourceStoryboard?.clipDurationSeconds);
  if (options.sourceStoryboard && duration === options.sourceStoryboard.clipDurationSeconds) {
    const compiled = compileStoryboardPrompt(options.sourceStoryboard);
    if (compiled.prompt === prompt) return { storyboard: compiled.storyboard, warnings: [], hadMarkers: true, unparsedText: compiled.storyboard.originalPrompt ?? "" };
  }
  const markers = [...prompt.matchAll(/【分镜\s*(\d+)】/g)];
  if (!markers.length) {
    const storyboard = { ...createStoryboard(duration), ...(prompt ? { originalPrompt: prompt } : {}) };
    return { storyboard, hadMarkers: false, unparsedText: prompt, warnings: prompt ? [{ code: "plain_prompt_preserved", message: "原提示词已保留；尚未拆成分镜。" }] : [] };
  }
  const warnings: StoryboardParseWarning[] = [], unparsed: string[] = [];
  const prefix = unescapeText(prompt.slice(0, markers[0]!.index).replace(/\n\n$/, ""));
  if (prefix) unparsed.push(prefix);
  const shots: CanvasStoryboardShot[] = [];
  let soundEffects = false, backgroundMusic = false;
  const guidance: string[] = [];
  for (let index = 0; index < markers.length; index++) {
    const marker = markers[index]!, next = markers[index + 1];
    const block = prompt.slice(marker.index! + marker[0].length, next?.index ?? prompt.length);
    if (index >= STORYBOARD_MAX_SHOTS) { unparsed.push(`${marker[0]}${block}`); warnings.push({ code: "extra_shots_preserved", message: "超过 8 镜的内容已保留在待处理原文中。" }); continue; }
    const saved = options.sourceStoryboard?.shots[index];
    const id = saved?.id ?? `shot-${index + 1}`;
    const fields = [...block.matchAll(/【(时间|焦距|光圈|运镜|前景|远景|要求|音效|BGM|指导)】/g)];
    if (block.slice(0, fields[0]?.index ?? block.length).trim()) unparsed.push(block.slice(0, fields[0]?.index ?? block.length).trim());
    let shot = blankShot(id);
    const seen = new Set<string>();
    for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
      const field = fields[fieldIndex]!, label = field[1]!;
      const rawValue = block.slice(field.index! + field[0].length, fields[fieldIndex + 1]?.index ?? block.length).replace(/\s+$/, "");
      const value = unescapeText(rawValue);
      if (seen.has(label) && label !== "指导") { unparsed.push(`${field[0]}${value}`); warnings.push({ code: "unrecognized_value", shotId: id, message: `重复的${label}字段已保留。` }); continue; }
      seen.add(label);
      if (label === "前景") shot = { ...shot, foreground: value };
      else if (label === "远景") shot = { ...shot, background: value };
      else if (label === "要求") shot = { ...shot, requirements: value };
      else if (label === "指导") guidance.push(value);
      else if (label === "焦距" || label === "光圈") {
        const catalog = label === "焦距" ? STORYBOARD_FOCAL_LENGTHS : STORYBOARD_APERTURES;
        const item = catalog.find(candidate => candidate.value === value || candidate.label === value);
        if (item) shot = label === "焦距" ? { ...shot, focalLength: item.value as StoryboardFocalLength } : { ...shot, aperture: item.value as StoryboardAperture };
        else { unparsed.push(`${field[0]}${value}`); warnings.push({ code: "unrecognized_value", shotId: id, message: `无法识别${label}，原值已保留。` }); }
      } else if (label === "运镜") {
        const parsed = parseCameraText(value, saved?.camera);
        shot = { ...shot, camera: parsed.camera };
        if (parsed.unknown.length) { unparsed.push(`${field[0]}${value}`); warnings.push({ code: "unrecognized_value", shotId: id, message: `无法识别运镜：${parsed.unknown.join("、")}；原值已保留。` }); }
        if (!saved && parsed.camera.movements.length) warnings.push({ code: "preset_requires_snapshot", shotId: id, message: "运镜动作已恢复；仅凭文字无法确认组合预设身份。" });
      } else if (label === "时间") {
        const time = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*s?\s*[-–]\s*(-?\d+(?:\.\d+)?)\s*s?\s*$/i);
        if (!time) { unparsed.push(`${field[0]}${value}`); warnings.push({ code: "time_cleared", shotId: id, message: "无法解析的时间已清除，原值已保留。" }); }
        else {
          const rawStart = Number(time[1]), rawEnd = Number(time[2]);
          const startSeconds = Math.max(0, Math.min(snapTime(rawStart), lastTime(duration)));
          const endSeconds = Math.max(0, Math.min(snapTime(rawEnd), lastTime(duration)));
          if (endSeconds <= startSeconds) { unparsed.push(`${field[0]}${value}`); warnings.push({ code: "time_cleared", shotId: id, message: "此时间区间没有可用长度，请重新设定。" }); }
          else {
            shot = { ...shot, startSeconds, endSeconds };
            if (rawStart !== startSeconds || rawEnd !== endSeconds) warnings.push({ code: "time_clamped", shotId: id, message: "时间已吸附到 0.1 秒并限制在当前生成时长内。" });
          }
        }
      } else if (label === "音效" || label === "BGM") {
        const lines = value.split(/\r?\n/), state = lines.shift()!.trim();
        if (state === "开启" || state === "关闭") { if (label === "音效") soundEffects = state === "开启"; else backgroundMusic = state === "开启"; }
        else { unparsed.push(`${field[0]}${state}`); warnings.push({ code: "unrecognized_value", message: `无法识别${label}开关，已保留原文。` }); }
        if (lines.join("\n").trim()) { const text = lines.join("\n").trim(); guidance.push(text); }
      }
    }
    shots.push(shot);
  }
  let storyboard: CanvasStoryboard = { version: 1, clipDurationSeconds: duration, shots, soundEffects, backgroundMusic, guidance, ...(unparsed.length ? { originalPrompt: unparsed.join("\n\n") } : {}) };
  if (validateStoryboard(storyboard).some(issue => issue.code === "overlap")) {
    let cursor = 0;
    storyboard = { ...storyboard, shots: shots.map(shot => {
      if (!hasTime(shot)) return shot;
      const length = snapTime(shot.endSeconds - shot.startSeconds);
      const endSeconds = Math.min(snapTime(cursor + length), lastTime(duration));
      const startSeconds = cursor;
      cursor = endSeconds;
      if (endSeconds <= startSeconds) {
        const { startSeconds: _start, endSeconds: _end, ...cleared } = shot;
        warnings.push({ code: "time_cleared", shotId: shot.id, message: "重排后没有剩余时间；请缩短或删除分镜。" });
        return cleared;
      }
      warnings.push({ code: "time_reflowed", shotId: shot.id, message: "重叠时间已按卡片顺序重排，请确认镜头时界。" });
      return { ...shot, startSeconds, endSeconds };
    }) };
  }
  assertStoryboard(storyboard);
  return { storyboard, warnings, hadMarkers: true, unparsedText: unparsed.join("\n\n") };
}
