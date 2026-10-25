import assert from "node:assert/strict";
import test from "node:test";
import {
  IMAGE_TOOL_LOCALES, IMAGE_STYLE_PRESETS, IMAGE_LIGHTING_PRESETS, IMAGE_POSE_PRESETS,
  IMAGE_POSE_JOINT_IDS, IMAGE_PALETTE_PRESETS, imagePresetName,
  getImageStylePreset, getImageLightingPreset, getImagePosePreset, getImagePalettePreset,
} from "../lib/canvas-image-presets.js";
import type { ImagePreset } from "../lib/canvas-image-presets.js";

test("image preset catalogues cover every original replacement with stable distinct ids", () => {
  assert.deepEqual(IMAGE_TOOL_LOCALES, ["zh-CN", "en", "zh-TW", "ja", "ko", "es", "fr", "de", "pt-BR", "ru", "ar", "hi"]);
  for (const [catalogue, count] of [
    [IMAGE_STYLE_PRESETS, 114], [IMAGE_LIGHTING_PRESETS, 18], [IMAGE_POSE_PRESETS, 21], [IMAGE_PALETTE_PRESETS, 15],
  ] as const) {
    assert.equal(catalogue.length, count);
    assert.equal(new Set(catalogue.map(preset => preset.id)).size, count);
    for (const preset of catalogue) {
      assert.match(preset.id, /^[a-z][a-z0-9_]*$/);
      assert.deepEqual(Object.keys(preset.names), [...IMAGE_TOOL_LOCALES]);
      assert.ok(preset.promptFragment.length > 30, preset.id);
      for (const locale of IMAGE_TOOL_LOCALES) {
        assert.ok(preset.names[locale].trim(), `${preset.id}: ${locale}`);
        assert.equal(imagePresetName(preset, locale), preset.names[locale]);
      }
      assert.equal(imagePresetName(preset, "unsupported"), preset.names.en);
      assert.equal(imagePresetName(preset, "toString"), preset.names.en);
      assert.equal(imagePresetName(preset, "constructor"), preset.names.en);
    }
  }
  assert.deepEqual(IMAGE_STYLE_PRESETS.reduce<Record<string, number>>((counts, preset) => {
    counts[preset.categoryId] = (counts[preset.categoryId] ?? 0) + 1;
    return counts;
  }, {}), { animation: 34, digital: 8, cinema: 50, drama: 10, extended: 12 });
});

test("catalogues omit vendor assets, branding and hidden prompt fields", () => {
  const payload = JSON.stringify([IMAGE_STYLE_PRESETS, IMAGE_LIGHTING_PRESETS, IMAGE_POSE_PRESETS, IMAGE_PALETTE_PRESETS]);
  assert.doesNotMatch(payload, /https?:\/\/|original_image|styled_image|thumbnail|json_code|neowow|wlpaas|Arcane|Fortiche|Disney|Pixar|Spider|Barbie|Octane|Blender|Edgerunners|ArtStation/i);
  for (const preset of IMAGE_STYLE_PRESETS) {
    assert.ok(Object.keys(preset.configuration).length > 0);
    assert.equal("instruction" in preset.configuration, false);
    assert.equal("style_keywords" in preset.configuration, false);
  }
  assert.match(getImageStylePreset("anime_transparent_cel").promptFragment, /not a request for alpha output/);
  assert.match(getImageStylePreset("extended_thermal_visual").promptFragment, /do not claim measured temperatures/);
});

test("style presets retain explicit rendering and all numeric grading parameters", () => {
  const anime = getImageStylePreset("anime_90s_retro");
  assert.deepEqual(anime.configuration.rendering, {
    technique: "traditional cel animation", coloring: "limited color palette", outline: "sharp black lines", texture: "film grain and VHS artifacts",
  });
  const industrial = getImageStylePreset("digital_industrial_future");
  for (const field of ["cinematic_tech", "lighting_setup", "color_system", "material_and_texture", "composition_and_framing"]) {
    assert.ok(field in industrial.configuration, field);
  }
  const numeric = IMAGE_STYLE_PRESETS.filter(preset => preset.parameters);
  assert.equal(numeric.length, 79);
  const expectedFields = ["contrast", "saturation", "vibrance", "temperature", "tint", "clarity", "shadows", "highlights"];
  for (const preset of numeric) {
    assert.deepEqual(Object.keys(preset.parameters ?? {}), expectedFields);
    for (const [field, value] of Object.entries(preset.parameters ?? {})) {
      assert.ok(Number.isFinite(value) && value >= -100 && value <= 100, `${preset.id}: ${field}`);
      assert.ok(preset.promptFragment.includes(`${field} ${value >= 0 ? "+" : ""}${value}`), `${preset.id}: ${field}`);
    }
  }
  assert.deepEqual(getImageStylePreset("drama_film_noir").parameters, {
    contrast: 55, saturation: -100, vibrance: -100, temperature: 0, tint: 0, clarity: 35, shadows: -45, highlights: 15,
  });
});

test("all lighting presets compile each source role, direction, intensity and actual color", () => {
  const legalRoles = new Set(["key", "fill", "rim", "ambient", "point"]);
  for (const preset of IMAGE_LIGHTING_PRESETS) {
    assert.ok(Number.isFinite(preset.sceneRotationY));
    assert.ok(preset.lights.length >= 1 && preset.lights.length <= 3);
    for (const light of preset.lights) {
      assert.ok(legalRoles.has(light.role));
      assert.ok(light.yawDegrees >= -180 && light.yawDegrees <= 180);
      assert.ok(light.elevationDegrees >= -90 && light.elevationDegrees <= 90);
      assert.ok(light.intensity >= 0 && light.intensity <= 2);
      assert.match(light.hex, /^#[0-9A-F]{6}$/);
      for (const fragment of [light.role, `yaw ${light.yawDegrees} degrees`, `elevation ${light.elevationDegrees} degrees`, `intensity ${light.intensity}`, light.hex]) {
        assert.ok(preset.promptFragment.includes(fragment), `${preset.id}: ${fragment}`);
      }
    }
  }
  assert.deepEqual(getImageLightingPreset("three_point").lights.map(light => [light.role, light.position, light.intensity]), [
    ["key", "front_left", 1], ["fill", "front_right", 0.5], ["rim", "back", 0.8],
  ]);
  assert.equal(getImageLightingPreset("campfire").lights[0]?.hex, "#FF6B35");
});

test("pose diagrams have all 15 finite joints and unique coherent guides", () => {
  assert.equal(IMAGE_POSE_JOINT_IDS.length, 15);
  assert.equal(new Set(IMAGE_POSE_PRESETS.map(preset => JSON.stringify(preset.joints))).size, 21);
  for (const preset of IMAGE_POSE_PRESETS) {
    assert.deepEqual(Object.keys(preset.joints), [...IMAGE_POSE_JOINT_IDS]);
    for (const joint of Object.values(preset.joints)) {
      assert.ok(Number.isFinite(joint.x) && joint.x >= 0 && joint.x <= 80);
      assert.ok(Number.isFinite(joint.y) && joint.y >= 0 && joint.y <= 90);
      assert.ok(Number.isFinite(joint.radius) && joint.radius > 0);
    }
  }
  assert.match(getImagePosePreset("kneeling").promptFragment, /one knee/);
  assert.match(getImagePosePreset("crossed_arms").promptFragment, /arms across the chest/);
});

test("palette proportions are normalized and appear in each palette prompt", () => {
  for (const preset of IMAGE_PALETTE_PRESETS) {
    assert.equal(preset.colors.length, 5);
    assert.equal(new Set(preset.colors.map(color => color.hex)).size, 5);
    assert.ok(Math.abs(preset.colors.reduce((total, color) => total + color.weight, 0) - 1) < 1e-12);
    for (const color of preset.colors) {
      assert.match(color.hex, /^#[0-9A-F]{6}$/);
      assert.ok(color.weight > 0 && color.weight <= 1);
      assert.ok(preset.promptFragment.includes(`${color.hex} ${Math.round(color.weight * 100)}%`));
    }
  }
  assert.deepEqual(getImagePalettePreset("blue_mood").colors.map(color => color.weight), [0.1, 0.2, 0.25, 0.25, 0.2]);
});

test("lookups fail closed and exported shared data is deeply immutable", () => {
  for (const getter of [getImageStylePreset, getImageLightingPreset, getImagePosePreset, getImagePalettePreset]) {
    assert.throws(() => getter("unknown"), RangeError);
  }
  function assertFrozen(value: unknown) {
    if (value !== null && typeof value === "object") {
      assert.ok(Object.isFrozen(value));
      for (const child of Object.values(value)) assertFrozen(child);
    }
  }
  for (const catalogue of [IMAGE_STYLE_PRESETS, IMAGE_LIGHTING_PRESETS, IMAGE_POSE_PRESETS, IMAGE_PALETTE_PRESETS]) assertFrozen(catalogue);
  assert.throws(() => { (getImagePosePreset("standing").joints.head as { x: number }).x = 0; }, TypeError);
  assert.equal(getImagePosePreset("standing").joints.head.x, 40);
  const first: ImagePreset | undefined = IMAGE_STYLE_PRESETS[0];
  assert.ok(first);
  assert.throws(() => { (first.names as Record<string, string>).en = "changed"; }, TypeError);
});
