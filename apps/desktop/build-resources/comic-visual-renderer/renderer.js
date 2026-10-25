"use strict";
var ComicVisual = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // ../../packages/comic-core/src/visual-effects/worker-entry.ts
  var worker_entry_exports = {};
  __export(worker_entry_exports, {
    comicVisualWorkerCommand: () => comicVisualWorkerCommand
  });

  // ../../packages/comic-core/src/visual-effects/freecut/effects/color.ts
  var color_exports = {};
  __export(color_exports, {
    GRADIENT_MAP_PRESETS: () => GRADIENT_MAP_PRESETS,
    brightness: () => brightness,
    colorWheels: () => colorWheels,
    contrast: () => contrast,
    curves: () => curves,
    exposure: () => exposure,
    gradientMap: () => gradientMap,
    grayscale: () => grayscale,
    hueShift: () => hueShift,
    invert: () => invert,
    levels: () => levels,
    powerWindow: () => powerWindow,
    saturation: () => saturation,
    secondaryQualifier: () => secondaryQualifier,
    sepia: () => sepia,
    temperature: () => temperature,
    vibrance: () => vibrance
  });

  // ../../packages/comic-core/src/visual-effects/freecut/shared/curve-spline.ts
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function computeMonotoneTangents(points) {
    if (points.length <= 1) return [0];
    const segmentCount = points.length - 1;
    const slopes = new Array(segmentCount);
    for (let i = 0; i < segmentCount; i += 1) {
      const left = points[i];
      const right = points[i + 1];
      const width = Math.max(1e-6, right.x - left.x);
      slopes[i] = (right.y - left.y) / width;
    }
    const tangents = new Array(points.length);
    tangents[0] = slopes[0];
    tangents[points.length - 1] = slopes[segmentCount - 1];
    for (let i = 1; i < points.length - 1; i += 1) {
      const prev = slopes[i - 1];
      const next = slopes[i];
      tangents[i] = prev * next <= 0 ? 0 : (prev + next) / 2;
    }
    for (let i = 0; i < segmentCount; i += 1) {
      const slope = slopes[i];
      if (Math.abs(slope) < 1e-6) {
        tangents[i] = 0;
        tangents[i + 1] = 0;
        continue;
      }
      const a = tangents[i] / slope;
      const b = tangents[i + 1] / slope;
      const magnitude = a * a + b * b;
      if (magnitude > 9) {
        const scale = 3 / Math.sqrt(magnitude);
        tangents[i] = scale * a * slope;
        tangents[i + 1] = scale * b * slope;
      }
    }
    return tangents;
  }
  function normalizeCurvePoints(points) {
    if (!points || points.length === 0) {
      return [
        { x: 0, y: 0 },
        { x: 1, y: 1 }
      ];
    }
    const sorted = points.map((point) => ({
      x: clamp(point.x, 0, 1),
      y: clamp(point.y, 0, 1)
    })).sort((a, b) => a.x - b.x);
    const deduped = [];
    for (const point of sorted) {
      const prev = deduped[deduped.length - 1];
      if (!prev || Math.abs(prev.x - point.x) > 5e-4) {
        deduped.push(point);
      }
    }
    if (deduped.length === 0) {
      return [
        { x: 0, y: 0 },
        { x: 1, y: 1 }
      ];
    }
    if (deduped[0].x > 1e-4) {
      deduped.unshift({ x: 0, y: deduped[0].y });
    } else {
      deduped[0] = { x: 0, y: deduped[0].y };
    }
    const last = deduped[deduped.length - 1];
    if (last.x < 0.9999) {
      deduped.push({ x: 1, y: last.y });
    } else if (Math.abs(last.x - 1) > 1e-4) {
      deduped[deduped.length - 1] = { x: 1, y: last.y };
    }
    return deduped;
  }
  function evaluateMonotoneCurve(points, x) {
    const normalized = normalizeCurvePoints(points);
    const input = clamp(x, 0, 1);
    if (input <= normalized[0].x) return normalized[0].y;
    if (input >= normalized[normalized.length - 1].x) return normalized[normalized.length - 1].y;
    let segmentIndex = normalized.length - 2;
    for (let i = 0; i < normalized.length - 1; i += 1) {
      const left2 = normalized[i];
      const right2 = normalized[i + 1];
      if (input >= left2.x && input <= right2.x) {
        segmentIndex = i;
        break;
      }
    }
    const left = normalized[segmentIndex];
    const right = normalized[segmentIndex + 1];
    const width = Math.max(1e-6, right.x - left.x);
    const t = clamp((input - left.x) / width, 0, 1);
    const t2 = t * t;
    const t3 = t2 * t;
    const tangents = computeMonotoneTangents(normalized);
    const m0 = tangents[segmentIndex];
    const m1 = tangents[segmentIndex + 1];
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    const y = h00 * left.y + h10 * width * m0 + h01 * right.y + h11 * width * m1;
    return clamp(y, 0, 1);
  }

  // ../../packages/comic-core/src/visual-effects/freecut/shared/gpu-curves.ts
  var DEFAULT_POINT_XS = {
    shadow: 0.25,
    highlight: 0.75
  };
  var GPU_CURVES_CHANNELS = ["master", "red", "green", "blue"];
  var GPU_CURVES_POINT_MIN_X = 0.02;
  var GPU_CURVES_POINT_MAX_X = 0.98;
  var GPU_CURVES_POINT_MIN_GAP = 0.04;
  function clamp2(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function asFiniteNumber(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }
  function getLegacyChannelOffset(params, channel) {
    const value = asFiniteNumber(params[channel], 0);
    return clamp2(value / 200, -0.5, 0.5);
  }
  function applyLegacyShadows(c, amount) {
    const shadow = 1 - c;
    return c + shadow * shadow * amount * 0.5;
  }
  function applyLegacyMidtones(c, amount) {
    const mid = 4 * c * (1 - c);
    return c + mid * amount * 0.25;
  }
  function applyLegacyHighlights(c, amount) {
    return c + c * c * amount * 0.5;
  }
  function applyLegacyContrast(c, amount) {
    return (c - 0.5) * (1 + amount) + 0.5;
  }
  function computeLegacyMasterCurve(params, input) {
    const shadows = asFiniteNumber(params.shadows, 0) / 100;
    const midtones = asFiniteNumber(params.midtones, 0) / 100;
    const highlights = asFiniteNumber(params.highlights, 0) / 100;
    const contrast2 = asFiniteNumber(params.contrast, 0) / 100;
    let value = input;
    value = applyLegacyShadows(value, shadows);
    value = applyLegacyMidtones(value, midtones);
    value = applyLegacyHighlights(value, highlights);
    value = applyLegacyContrast(value, contrast2);
    return clamp2(value, 0, 1);
  }
  function getGpuCurvesChannelParamKeys(channel) {
    const prefix = channel.charAt(0).toUpperCase() + channel.slice(1);
    return {
      shadowX: `${channel}ShadowX`,
      shadowY: `${channel}ShadowY`,
      highlightX: `${channel}HighlightX`,
      highlightY: `${channel}HighlightY`,
      prefix
    };
  }
  function getDefaultGpuCurvesChannelControl() {
    return {
      shadow: { x: DEFAULT_POINT_XS.shadow, y: DEFAULT_POINT_XS.shadow },
      highlight: { x: DEFAULT_POINT_XS.highlight, y: DEFAULT_POINT_XS.highlight }
    };
  }
  function sanitizeGpuCurvesChannelControl(control) {
    const defaultControl = getDefaultGpuCurvesChannelControl();
    let shadowX = clamp2(
      asFiniteNumber(control.shadow.x, defaultControl.shadow.x),
      GPU_CURVES_POINT_MIN_X,
      GPU_CURVES_POINT_MAX_X
    );
    let highlightX = clamp2(
      asFiniteNumber(control.highlight.x, defaultControl.highlight.x),
      GPU_CURVES_POINT_MIN_X,
      GPU_CURVES_POINT_MAX_X
    );
    if (shadowX > highlightX) {
      ;
      [shadowX, highlightX] = [highlightX, shadowX];
    }
    if (highlightX - shadowX < GPU_CURVES_POINT_MIN_GAP) {
      const midpoint = clamp2(
        (shadowX + highlightX) / 2,
        GPU_CURVES_POINT_MIN_X + GPU_CURVES_POINT_MIN_GAP / 2,
        GPU_CURVES_POINT_MAX_X - GPU_CURVES_POINT_MIN_GAP / 2
      );
      shadowX = midpoint - GPU_CURVES_POINT_MIN_GAP / 2;
      highlightX = midpoint + GPU_CURVES_POINT_MIN_GAP / 2;
    }
    return {
      shadow: {
        x: shadowX,
        y: clamp2(asFiniteNumber(control.shadow.y, defaultControl.shadow.y), 0, 1)
      },
      highlight: {
        x: highlightX,
        y: clamp2(asFiniteNumber(control.highlight.y, defaultControl.highlight.y), 0, 1)
      }
    };
  }
  function buildGpuCurvesChannelPoints(control) {
    const sanitized = sanitizeGpuCurvesChannelControl(control);
    return [{ x: 0, y: 0 }, sanitized.shadow, sanitized.highlight, { x: 1, y: 1 }];
  }
  function readGpuCurvesChannelControl(params, channel) {
    const keys = getGpuCurvesChannelParamKeys(channel);
    const hasExplicitPoints = [keys.shadowX, keys.shadowY, keys.highlightX, keys.highlightY].some(
      (key) => typeof params[key] === "number" && Number.isFinite(params[key])
    );
    if (hasExplicitPoints) {
      return sanitizeGpuCurvesChannelControl({
        shadow: {
          x: asFiniteNumber(params[keys.shadowX], DEFAULT_POINT_XS.shadow),
          y: asFiniteNumber(params[keys.shadowY], DEFAULT_POINT_XS.shadow)
        },
        highlight: {
          x: asFiniteNumber(params[keys.highlightX], DEFAULT_POINT_XS.highlight),
          y: asFiniteNumber(params[keys.highlightY], DEFAULT_POINT_XS.highlight)
        }
      });
    }
    if (channel === "master") {
      return sanitizeGpuCurvesChannelControl({
        shadow: {
          x: DEFAULT_POINT_XS.shadow,
          y: computeLegacyMasterCurve(params, DEFAULT_POINT_XS.shadow)
        },
        highlight: {
          x: DEFAULT_POINT_XS.highlight,
          y: computeLegacyMasterCurve(params, DEFAULT_POINT_XS.highlight)
        }
      });
    }
    const offset = getLegacyChannelOffset(params, channel);
    return sanitizeGpuCurvesChannelControl({
      shadow: {
        x: DEFAULT_POINT_XS.shadow,
        y: DEFAULT_POINT_XS.shadow + offset
      },
      highlight: {
        x: DEFAULT_POINT_XS.highlight,
        y: DEFAULT_POINT_XS.highlight + offset
      }
    });
  }
  var GPU_CURVES_LUT_WIDTH = 256;
  var GPU_CURVES_MAX_POINTS = 16;
  function getGpuCurvesPointsParamKey(channel) {
    return `${channel}Points`;
  }
  function sanitizeGpuCurvesChannelPoints(points) {
    const cleaned = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)).map((point) => ({ x: clamp2(point.x, 0, 1), y: clamp2(point.y, 0, 1) })).sort((a, b) => a.x - b.x).slice(0, GPU_CURVES_MAX_POINTS);
    const result = [];
    for (const point of cleaned) {
      const previous = result[result.length - 1];
      if (previous && point.x - previous.x < GPU_CURVES_POINT_MIN_GAP / 2) continue;
      result.push(point);
    }
    if (result.length < 2) {
      return [
        { x: 0, y: 0 },
        { x: 1, y: 1 }
      ];
    }
    return result;
  }
  function parseGpuCurvesChannelPoints(raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      const points = [];
      for (const entry of parsed) {
        if (!Array.isArray(entry) || entry.length < 2) return null;
        const [x, y] = entry;
        if (typeof x !== "number" || typeof y !== "number") return null;
        points.push({ x, y });
      }
      return points.length >= 2 ? sanitizeGpuCurvesChannelPoints(points) : null;
    } catch {
      return null;
    }
  }
  function readGpuCurvesChannelPoints(params, channel) {
    const raw = params[getGpuCurvesPointsParamKey(channel)];
    if (typeof raw === "string" && raw.length > 0) {
      const points = parseGpuCurvesChannelPoints(raw);
      if (points) return points;
    }
    return buildGpuCurvesChannelPoints(readGpuCurvesChannelControl(params, channel));
  }
  function buildGpuCurvesLutData(params) {
    const width = GPU_CURVES_LUT_WIDTH;
    const masterPoints = readGpuCurvesChannelPoints(params, "master");
    const redPoints = readGpuCurvesChannelPoints(params, "red");
    const greenPoints = readGpuCurvesChannelPoints(params, "green");
    const bluePoints = readGpuCurvesChannelPoints(params, "blue");
    const data = new Uint8Array(width * 4);
    for (let i = 0; i < width; i++) {
      const x = i / (width - 1);
      const master = evaluateMonotoneCurve(masterPoints, x);
      data[i * 4] = Math.round(clamp2(evaluateMonotoneCurve(redPoints, master), 0, 1) * 255);
      data[i * 4 + 1] = Math.round(clamp2(evaluateMonotoneCurve(greenPoints, master), 0, 1) * 255);
      data[i * 4 + 2] = Math.round(clamp2(evaluateMonotoneCurve(bluePoints, master), 0, 1) * 255);
      data[i * 4 + 3] = 255;
    }
    return data;
  }
  function getGpuCurvesLutKey(params) {
    const parts = [];
    for (const channel of GPU_CURVES_CHANNELS) {
      const keys = getGpuCurvesChannelParamKeys(channel);
      parts.push(
        asFiniteNumber(params[keys.shadowX], -1),
        asFiniteNumber(params[keys.shadowY], -1),
        asFiniteNumber(params[keys.highlightX], -1),
        asFiniteNumber(params[keys.highlightY], -1),
        typeof params[getGpuCurvesPointsParamKey(channel)] === "string" ? params[getGpuCurvesPointsParamKey(channel)] : ""
      );
    }
    return parts.join("|");
  }

  // ../../packages/comic-core/src/visual-effects/freecut/effects/color.ts
  function readNumberParam(params, key, fallback) {
    const value = params[key];
    return typeof value === "number" ? value : fallback;
  }
  function parseHexColorRgb(color, fallback) {
    if (typeof color !== "string" || !color.startsWith("#")) return fallback;
    const hex = color.slice(1);
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return fallback;
    const r = parseInt(full.slice(0, 2), 16) / 255;
    const g = parseInt(full.slice(2, 4), 16) / 255;
    const b = parseInt(full.slice(4, 6), 16) / 255;
    return [r, g, b].every(Number.isFinite) ? [r, g, b] : fallback;
  }
  var brightness = {
    id: "gpu-brightness",
    name: "Brightness",
    category: "color",
    entryPoint: "brightnessFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct BrightnessParams { amount: f32, _p1: f32, _p2: f32, _p3: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: BrightnessParams;
@fragment
fn brightnessFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let adjusted = color.rgb + params.amount;
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}`
    ),
    params: {
      amount: {
        type: "number",
        label: "Amount",
        default: 0,
        min: -1,
        max: 1,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p) => new Float32Array([p.amount ?? 0, 0, 0, 0])
  };
  var contrast = {
    id: "gpu-contrast",
    name: "Contrast",
    category: "color",
    entryPoint: "contrastFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct ContrastParams { amount: f32, _p1: f32, _p2: f32, _p3: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: ContrastParams;
@fragment
fn contrastFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let adjusted = (color.rgb - 0.5) * params.amount + 0.5;
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}`
    ),
    params: {
      amount: {
        type: "number",
        label: "Amount",
        default: 1,
        min: 0,
        max: 3,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p) => new Float32Array([p.amount ?? 1, 0, 0, 0])
  };
  var exposure = {
    id: "gpu-exposure",
    name: "Exposure",
    category: "color",
    entryPoint: "exposureFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct ExposureParams { exposure: f32, offset: f32, gamma: f32, _pad: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: ExposureParams;
@fragment
fn exposureFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  var adjusted = color.rgb * pow(2.0, params.exposure);
  adjusted += params.offset;
  adjusted = pow(max(adjusted, vec3f(0.0)), vec3f(1.0 / params.gamma));
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}`
    ),
    params: {
      exposure: {
        type: "number",
        label: "Exposure (EV)",
        default: 0,
        min: -3,
        max: 3,
        step: 0.1,
        animatable: true
      },
      offset: {
        type: "number",
        label: "Offset",
        default: 0,
        min: -0.5,
        max: 0.5,
        step: 0.01,
        animatable: true
      },
      gamma: {
        type: "number",
        label: "Gamma",
        default: 1,
        min: 0.2,
        max: 3,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p) => new Float32Array([
      p.exposure ?? 0,
      p.offset ?? 0,
      p.gamma ?? 1,
      0
    ])
  };
  var hueShift = {
    id: "gpu-hue-shift",
    name: "Hue Shift",
    category: "color",
    entryPoint: "hueShiftFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct HueShiftParams { shift: f32, span: f32, flow: f32, time: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: HueShiftParams;
@fragment
fn hueShiftFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  var hsv = rgb2hsv(color.rgb);
  // span compresses (<1) or expands (>1) the hue range around the shift offset;
  // span = 1 is a plain hue rotation (backward compatible), span = 0 maps every
  // pixel to a single hue (monochrome tint). flow cycles the offset over time.
  hsv.x = fract(params.shift + params.flow * params.time + hsv.x * params.span);
  return vec4f(hsv2rgb(hsv), color.a);
}`
    ),
    params: {
      shift: {
        type: "number",
        label: "Shift",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      span: {
        type: "number",
        label: "Span",
        default: 1,
        min: 0,
        max: 2,
        step: 0.01,
        animatable: true
      },
      flow: {
        type: "number",
        label: "Flow",
        default: 0,
        min: 0,
        max: 2,
        step: 0.05,
        animatable: false
      }
    },
    packUniforms: (p) => new Float32Array([
      p.shift ?? 0,
      p.span ?? 1,
      p.flow ?? 0,
      typeof p.__time === "number" ? p.__time : 0
    ])
  };
  var invert = {
    id: "gpu-invert",
    name: "Invert",
    category: "color",
    entryPoint: "invertFragment",
    uniformSize: 0,
    shader: (
      /* wgsl */
      `
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@fragment
fn invertFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  return vec4f(1.0 - color.rgb, color.a);
}`
    ),
    params: {},
    packUniforms: () => null
  };
  var levels = {
    id: "gpu-levels",
    name: "Levels",
    category: "color",
    entryPoint: "levelsFragment",
    uniformSize: 32,
    shader: (
      /* wgsl */
      `
struct LevelsParams {
  inputBlack: f32, inputWhite: f32, gamma: f32, outputBlack: f32,
  outputWhite: f32, _p1: f32, _p2: f32, _p3: f32,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: LevelsParams;
@fragment
fn levelsFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  var adjusted = (color.rgb - vec3f(params.inputBlack)) /
                 (params.inputWhite - params.inputBlack);
  adjusted = clamp(adjusted, vec3f(0.0), vec3f(1.0));
  adjusted = pow(adjusted, vec3f(1.0 / params.gamma));
  adjusted = mix(vec3f(params.outputBlack), vec3f(params.outputWhite), adjusted);
  return vec4f(adjusted, color.a);
}`
    ),
    params: {
      inputBlack: {
        type: "number",
        label: "Input Black",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      inputWhite: {
        type: "number",
        label: "Input White",
        default: 1,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      gamma: {
        type: "number",
        label: "Gamma",
        default: 1,
        min: 0.1,
        max: 3,
        step: 0.01,
        animatable: true
      },
      outputBlack: {
        type: "number",
        label: "Output Black",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      outputWhite: {
        type: "number",
        label: "Output White",
        default: 1,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p) => new Float32Array([
      p.inputBlack ?? 0,
      p.inputWhite ?? 1,
      p.gamma ?? 1,
      p.outputBlack ?? 0,
      p.outputWhite ?? 1,
      0,
      0,
      0
    ])
  };
  var saturation = {
    id: "gpu-saturation",
    name: "Saturation",
    category: "color",
    entryPoint: "saturationFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct SaturationParams { amount: f32, _p1: f32, _p2: f32, _p3: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: SaturationParams;
@fragment
fn saturationFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let gray = luminance601(color.rgb);
  let adjusted = mix(vec3f(gray), color.rgb, params.amount);
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}`
    ),
    params: {
      amount: {
        type: "number",
        label: "Amount",
        default: 1,
        min: 0,
        max: 3,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p) => new Float32Array([p.amount ?? 1, 0, 0, 0])
  };
  var temperature = {
    id: "gpu-temperature",
    name: "Temperature",
    category: "color",
    entryPoint: "temperatureFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct TemperatureParams { temperature: f32, tint: f32, _p1: f32, _p2: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: TemperatureParams;
@fragment
fn temperatureFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  var adjusted = color.rgb;
  adjusted.r += params.temperature * 0.1;
  adjusted.b -= params.temperature * 0.1;
  adjusted.g -= params.tint * 0.1;
  adjusted.r += params.tint * 0.05;
  adjusted.b += params.tint * 0.05;
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}`
    ),
    params: {
      temperature: {
        type: "number",
        label: "Temperature",
        default: 0,
        min: -1,
        max: 1,
        step: 0.01,
        animatable: true
      },
      tint: {
        type: "number",
        label: "Tint",
        default: 0,
        min: -1,
        max: 1,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p) => new Float32Array([p.temperature ?? 0, p.tint ?? 0, 0, 0])
  };
  var grayscale = {
    id: "gpu-grayscale",
    name: "Grayscale",
    category: "color",
    entryPoint: "grayscaleFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct GrayscaleParams { amount: f32, _p1: f32, _p2: f32, _p3: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: GrayscaleParams;
@fragment
fn grayscaleFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let gray = luminance601(color.rgb);
  let adjusted = mix(color.rgb, vec3f(gray), params.amount);
  return vec4f(adjusted, color.a);
}`
    ),
    params: {
      amount: {
        type: "number",
        label: "Amount",
        default: 1,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p) => new Float32Array([p.amount ?? 1, 0, 0, 0])
  };
  var sepia = {
    id: "gpu-sepia",
    name: "Sepia",
    category: "color",
    entryPoint: "sepiaFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct SepiaParams { amount: f32, _p1: f32, _p2: f32, _p3: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: SepiaParams;
@fragment
fn sepiaFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let sepiaR = dot(color.rgb, vec3f(0.393, 0.769, 0.189));
  let sepiaG = dot(color.rgb, vec3f(0.349, 0.686, 0.168));
  let sepiaB = dot(color.rgb, vec3f(0.272, 0.534, 0.131));
  let sepiaColor = vec3f(sepiaR, sepiaG, sepiaB);
  let adjusted = mix(color.rgb, sepiaColor, params.amount);
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}`
    ),
    params: {
      amount: {
        type: "number",
        label: "Amount",
        default: 1,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p) => new Float32Array([p.amount ?? 1, 0, 0, 0])
  };
  var curves = {
    id: "gpu-curves",
    name: "Curves",
    category: "color",
    entryPoint: "curvesFragment",
    uniformSize: 0,
    shader: (
      /* wgsl */
      `
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(3) var curveLut: texture_2d<f32>;

fn sampleCurveLut(value: f32) -> vec3f {
  let lutWidth = ${GPU_CURVES_LUT_WIDTH}.0;
  let u = (clamp(value, 0.0, 1.0) * (lutWidth - 1.0) + 0.5) / lutWidth;
  return textureSample(curveLut, texSampler, vec2f(u, 0.5)).rgb;
}

@fragment
fn curvesFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let c = vec3f(
    sampleCurveLut(color.r).r,
    sampleCurveLut(color.g).g,
    sampleCurveLut(color.b).b,
  );
  return vec4f(c, color.a);
}`
    ),
    params: Object.fromEntries([
      ...GPU_CURVES_CHANNELS.flatMap((channel) => {
        const keys = getGpuCurvesChannelParamKeys(channel);
        const defaults = getDefaultGpuCurvesChannelControl();
        const prefix = channel.charAt(0).toUpperCase() + channel.slice(1);
        return [
          [
            keys.shadowX,
            {
              type: "number",
              label: `${prefix} Shadow X`,
              default: defaults.shadow.x,
              min: 0,
              max: 1,
              step: 1e-3,
              animatable: true
            }
          ],
          [
            keys.shadowY,
            {
              type: "number",
              label: `${prefix} Shadow Y`,
              default: defaults.shadow.y,
              min: 0,
              max: 1,
              step: 1e-3,
              animatable: true
            }
          ],
          [
            keys.highlightX,
            {
              type: "number",
              label: `${prefix} Highlight X`,
              default: defaults.highlight.x,
              min: 0,
              max: 1,
              step: 1e-3,
              animatable: true
            }
          ],
          [
            keys.highlightY,
            {
              type: "number",
              label: `${prefix} Highlight Y`,
              default: defaults.highlight.y,
              min: 0,
              max: 1,
              step: 1e-3,
              animatable: true
            }
          ]
        ];
      }),
      ...GPU_CURVES_CHANNELS.map((channel) => {
        const prefix = channel.charAt(0).toUpperCase() + channel.slice(1);
        return [
          getGpuCurvesPointsParamKey(channel),
          {
            type: "json",
            label: `${prefix} Points`,
            default: ""
          }
        ];
      })
    ]),
    packUniforms: () => null,
    dataTexture: {
      dimension: "2d",
      key: getGpuCurvesLutKey,
      build: (params) => ({
        width: GPU_CURVES_LUT_WIDTH,
        height: 1,
        depth: 1,
        data: buildGpuCurvesLutData(params)
      })
    }
  };
  var colorWheels = {
    id: "gpu-color-wheels",
    name: "Color Wheels",
    category: "color",
    entryPoint: "colorWheelsFragment",
    uniformSize: 112,
    shader: (
      /* wgsl */
      `
struct WheelsParams {
  shHue: f32, shAmount: f32, midHue: f32, midAmount: f32,
  hlHue: f32, hlAmount: f32, temperature: f32, tint: f32,
  saturation: f32, exposure: f32, contrast: f32, pivot: f32,
  lift: f32, gamma: f32, gain: f32, offset: f32,
  blackPoint: f32, whitePoint: f32, offHue: f32, offAmount: f32,
  midDetail: f32, colorBoost: f32, shadows: f32, highlights: f32,
  hue: f32, lumMix: f32, _pad1: f32, _pad2: f32,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: WheelsParams;

fn wheelTint(color: vec3f, hue: f32, amount: f32, mask: f32) -> vec3f {
  if (amount < 0.001) { return color; }
  let rad = hue * TAU / 360.0;
  let tintColor = hsv2rgb(vec3f(hue / 360.0, 1.0, 1.0));
  return mix(color, color * mix(vec3f(1.0), tintColor, amount), mask);
}

@fragment
fn colorWheelsFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  var c = color.rgb;
  let luma = luminance601(c);
  let shadowMask = 1.0 - smoothstep(0.0, 0.5, luma);
  let highlightMask = smoothstep(0.5, 1.0, luma);
  let midtoneMask = 1.0 - shadowMask - highlightMask;
  c = wheelTint(c, params.shHue, params.shAmount, shadowMask);
  c = wheelTint(c, params.midHue, params.midAmount, midtoneMask);
  c = wheelTint(c, params.hlHue, params.hlAmount, highlightMask);
  c = wheelTint(c, params.offHue, params.offAmount, 1.0);
  let temp = params.temperature / 100.0;
  c.r += temp * 0.1;
  c.b -= temp * 0.1;
  let ti = params.tint / 100.0;
  c.g -= ti * 0.1;
  c.r += ti * 0.05;
  c.b += ti * 0.05;

  c *= pow(2.0, params.exposure);
  c = (c - vec3f(params.pivot)) * params.contrast + vec3f(params.pivot);
  if (abs(params.midDetail) > 0.001) {
    let detailLuma = luminance601(c);
    let detailAdjusted = vec3f(detailLuma) +
      (c - vec3f(detailLuma)) * (1.0 + params.midDetail / 100.0);
    c = mix(c, detailAdjusted, midtoneMask);
  }
  c = (c + vec3f(params.lift) + vec3f(params.offset)) * params.gain;
  c = pow(max(c, vec3f(0.0)), vec3f(1.0 / max(params.gamma, 0.05)));
  c = (c - vec3f(params.blackPoint)) /
      vec3f(max(params.whitePoint - params.blackPoint, 0.001));
  c += vec3f(params.shadows / 100.0) * shadowMask;
  c += vec3f(params.highlights / 100.0) * highlightMask;

  let sat = 1.0 + params.saturation / 100.0;
  let gray = luminance601(c);
  c = mix(vec3f(gray), c, sat);
  let colorBoost = params.colorBoost / 100.0;
  if (abs(colorBoost) > 0.001) {
    let boostedGray = luminance601(c);
    let chroma = c - vec3f(boostedGray);
    c = vec3f(boostedGray) + chroma * (1.0 + colorBoost * (1.0 - clamp(length(chroma), 0.0, 1.0)));
  }
  if (abs(params.hue - 50.0) > 0.001) {
    var hsv = rgb2hsv(c);
    hsv.x = fract(hsv.x + ((params.hue - 50.0) / 100.0));
    c = hsv2rgb(hsv);
  }
  let postLuma = luminance601(c);
  c = mix(vec3f(postLuma), c, clamp(params.lumMix / 100.0, 0.0, 1.0));
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), color.a);
}`
    ),
    params: {
      shadowsHue: {
        type: "number",
        label: "Lift Hue",
        default: 0,
        min: 0,
        max: 360,
        step: 1,
        animatable: true
      },
      shadowsAmount: {
        type: "number",
        label: "Lift Amount",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      midtonesHue: {
        type: "number",
        label: "Gamma Hue",
        default: 0,
        min: 0,
        max: 360,
        step: 1,
        animatable: true
      },
      midtonesAmount: {
        type: "number",
        label: "Gamma Amount",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      highlightsHue: {
        type: "number",
        label: "Gain Hue",
        default: 0,
        min: 0,
        max: 360,
        step: 1,
        animatable: true
      },
      highlightsAmount: {
        type: "number",
        label: "Gain Amount",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      offsetHue: {
        type: "number",
        label: "Offset Hue",
        default: 0,
        min: 0,
        max: 360,
        step: 1,
        animatable: true
      },
      offsetAmount: {
        type: "number",
        label: "Offset Amount",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      temperature: {
        type: "number",
        label: "Temperature",
        default: 0,
        min: -100,
        max: 100,
        step: 1,
        animatable: true
      },
      tint: {
        type: "number",
        label: "Tint",
        default: 0,
        min: -100,
        max: 100,
        step: 1,
        animatable: true
      },
      saturation: {
        type: "number",
        label: "Saturation",
        default: 0,
        min: -100,
        max: 100,
        step: 1,
        animatable: true
      },
      exposure: {
        type: "number",
        label: "Exposure",
        default: 0,
        min: -3,
        max: 3,
        step: 0.05,
        animatable: true
      },
      contrast: {
        type: "number",
        label: "Contrast",
        default: 1,
        min: 0,
        max: 2,
        step: 0.01,
        animatable: true
      },
      pivot: {
        type: "number",
        label: "Pivot",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      // Lift/gamma/gain/offset ranges mirror Resolve's primaries reach: lift
      // and offset span ±2.0 in normalized signal (Resolve shows offset as
      // 25 + 100x, i.e. -175..225), gamma is 0-centered in Resolve's display
      // (param = display + 1), gain is a plain multiplier up to 16 (+4 stops).
      lift: {
        type: "number",
        label: "Lift",
        default: 0,
        min: -2,
        max: 2,
        step: 0.01,
        animatable: true
      },
      gamma: {
        type: "number",
        label: "Gamma",
        default: 1,
        min: 0,
        max: 4,
        step: 0.01,
        animatable: true
      },
      gain: {
        type: "number",
        label: "Gain",
        default: 1,
        min: 0,
        max: 16,
        step: 0.01,
        animatable: true
      },
      offset: {
        type: "number",
        label: "Offset",
        default: 0,
        min: -2,
        max: 2,
        step: 25e-4,
        animatable: true
      },
      blackPoint: {
        type: "number",
        label: "Black Point",
        default: 0,
        min: 0,
        max: 0.5,
        step: 5e-3,
        animatable: true
      },
      whitePoint: {
        type: "number",
        label: "White Point",
        default: 1,
        min: 0.5,
        max: 1.5,
        step: 5e-3,
        animatable: true
      },
      midDetail: {
        type: "number",
        label: "Mid/Detail",
        default: 0,
        min: -100,
        max: 100,
        step: 1,
        animatable: true
      },
      colorBoost: {
        type: "number",
        label: "Color Boost",
        default: 0,
        min: -100,
        max: 100,
        step: 1,
        animatable: true
      },
      shadows: {
        type: "number",
        label: "Shadows",
        default: 0,
        min: -100,
        max: 100,
        step: 1,
        animatable: true
      },
      highlights: {
        type: "number",
        label: "Highlights",
        default: 0,
        min: -100,
        max: 100,
        step: 1,
        animatable: true
      },
      hue: {
        type: "number",
        label: "Hue",
        default: 50,
        min: 0,
        max: 100,
        step: 1,
        animatable: true
      },
      lumMix: {
        type: "number",
        label: "Lum Mix",
        default: 100,
        min: 0,
        max: 100,
        step: 1,
        animatable: true
      }
    },
    packUniforms: (p) => new Float32Array(
      COLOR_WHEELS_UNIFORM_PARAMS.map(([key, fallback]) => readNumberParam(p, key, fallback))
    )
  };
  var COLOR_WHEELS_UNIFORM_PARAMS = [
    ["shadowsHue", 0],
    ["shadowsAmount", 0],
    ["midtonesHue", 0],
    ["midtonesAmount", 0],
    ["highlightsHue", 0],
    ["highlightsAmount", 0],
    ["temperature", 0],
    ["tint", 0],
    ["saturation", 0],
    ["exposure", 0],
    ["contrast", 1],
    ["pivot", 0.5],
    ["lift", 0],
    ["gamma", 1],
    ["gain", 1],
    ["offset", 0],
    ["blackPoint", 0],
    ["whitePoint", 1],
    ["offsetHue", 0],
    ["offsetAmount", 0],
    ["midDetail", 0],
    ["colorBoost", 0],
    ["shadows", 0],
    ["highlights", 0],
    ["hue", 50],
    ["lumMix", 100],
    ["_pad1", 0],
    ["_pad2", 0]
  ];
  var secondaryQualifier = {
    id: "gpu-secondary-qualifier",
    name: "Secondary Qualifier",
    category: "color",
    entryPoint: "secondaryQualifierFragment",
    uniformSize: 64,
    shader: (
      /* wgsl */
      `
struct SecondaryQualifierParams {
  hueCenter: f32, hueWidth: f32, hueSoftness: f32, satLow: f32,
  satHigh: f32, satSoftness: f32, lumaLow: f32, lumaHigh: f32,
  lumaSoftness: f32, invertMask: f32, showMask: f32, exposure: f32,
  saturation: f32, temperature: f32, tint: f32, strength: f32,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: SecondaryQualifierParams;

fn circularHueDistance(hue: f32, center: f32) -> f32 {
  let diff = abs(hue - center);
  return min(diff, 1.0 - diff);
}

fn centeredRangeMask(value: f32, lowValue: f32, highValue: f32, softness: f32) -> f32 {
  let low = min(lowValue, highValue);
  let high = max(lowValue, highValue);
  let soft = max(softness, 0.0001);
  let lowMask = smoothstep(low - soft, low, value);
  let highMask = 1.0 - smoothstep(high, high + soft, value);
  return clamp(lowMask * highMask, 0.0, 1.0);
}

@fragment
fn secondaryQualifierFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let hsv = rgb2hsv(color.rgb);
  let luma = luminance601(color.rgb);
  let hueDistance = circularHueDistance(hsv.x, fract(params.hueCenter / 360.0));
  let hueWidth = clamp(params.hueWidth / 360.0, 0.0, 0.5);
  let hueSoftness = max(params.hueSoftness / 360.0, 0.0001);
  var mask = 1.0 - smoothstep(hueWidth, hueWidth + hueSoftness, hueDistance);
  mask *= centeredRangeMask(hsv.y, params.satLow, params.satHigh, params.satSoftness);
  mask *= centeredRangeMask(luma, params.lumaLow, params.lumaHigh, params.lumaSoftness);
  if (params.invertMask > 0.5) {
    mask = 1.0 - mask;
  }
  mask = clamp(mask * params.strength, 0.0, 1.0);

  if (params.showMask > 0.5) {
    return vec4f(vec3f(mask), color.a);
  }

  var corrected = color.rgb;
  corrected *= pow(2.0, params.exposure);
  let temp = params.temperature / 100.0;
  corrected.r += temp * 0.1;
  corrected.b -= temp * 0.1;
  let ti = params.tint / 100.0;
  corrected.g -= ti * 0.1;
  corrected.r += ti * 0.05;
  corrected.b += ti * 0.05;
  let sat = 1.0 + params.saturation / 100.0;
  let gray = luminance601(corrected);
  corrected = mix(vec3f(gray), corrected, sat);

  return vec4f(clamp(mix(color.rgb, corrected, mask), vec3f(0.0), vec3f(1.0)), color.a);
}`
    ),
    params: {
      hueCenter: {
        type: "number",
        label: "Hue Center",
        default: 0,
        min: 0,
        max: 360,
        step: 1,
        animatable: true
      },
      hueWidth: {
        type: "number",
        label: "Hue Width",
        default: 35,
        min: 0,
        max: 180,
        step: 1,
        animatable: true
      },
      hueSoftness: {
        type: "number",
        label: "Hue Softness",
        default: 20,
        min: 0,
        max: 120,
        step: 1,
        animatable: true
      },
      satLow: {
        type: "number",
        label: "Sat Low",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      satHigh: {
        type: "number",
        label: "Sat High",
        default: 1,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      satSoftness: {
        type: "number",
        label: "Sat Softness",
        default: 0.1,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      lumaLow: {
        type: "number",
        label: "Luma Low",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      lumaHigh: {
        type: "number",
        label: "Luma High",
        default: 1,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      lumaSoftness: {
        type: "number",
        label: "Luma Softness",
        default: 0.1,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      invertMask: {
        type: "boolean",
        label: "Invert Mask",
        default: false
      },
      showMask: {
        type: "boolean",
        label: "Show Mask",
        default: false
      },
      exposure: {
        type: "number",
        label: "Exposure",
        default: 0,
        min: -3,
        max: 3,
        step: 0.05,
        animatable: true
      },
      saturation: {
        type: "number",
        label: "Saturation",
        default: 0,
        min: -100,
        max: 100,
        step: 1,
        animatable: true
      },
      temperature: {
        type: "number",
        label: "Temperature",
        default: 0,
        min: -100,
        max: 100,
        step: 1,
        animatable: true
      },
      tint: {
        type: "number",
        label: "Tint",
        default: 0,
        min: -100,
        max: 100,
        step: 1,
        animatable: true
      },
      strength: {
        type: "number",
        label: "Strength",
        default: 1,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p) => new Float32Array(
      SECONDARY_QUALIFIER_UNIFORM_PARAMS.map(([key, fallback]) => {
        const value = p[key];
        if (typeof value === "boolean") return value ? 1 : 0;
        return typeof value === "number" ? value : fallback;
      })
    )
  };
  var SECONDARY_QUALIFIER_UNIFORM_PARAMS = [
    ["hueCenter", 0],
    ["hueWidth", 35],
    ["hueSoftness", 20],
    ["satLow", 0],
    ["satHigh", 1],
    ["satSoftness", 0.1],
    ["lumaLow", 0],
    ["lumaHigh", 1],
    ["lumaSoftness", 0.1],
    ["invertMask", 0],
    ["showMask", 0],
    ["exposure", 0],
    ["saturation", 0],
    ["temperature", 0],
    ["tint", 0],
    ["strength", 1]
  ];
  var POWER_WINDOW_SHAPE_MAP = {
    ellipse: 0,
    rectangle: 1
  };
  var powerWindow = {
    id: "gpu-power-window",
    name: "Power Window",
    category: "color",
    entryPoint: "powerWindowFragment",
    uniformSize: 64,
    shader: (
      /* wgsl */
      `
struct PowerWindowParams {
  shapeKind: f32, centerX: f32, centerY: f32, sizeX: f32,
  sizeY: f32, rotation: f32, feather: f32, invertMask: f32,
  showMask: f32, exposure: f32, saturation: f32, temperature: f32,
  tint: f32, strength: f32, sourceWidth: f32, sourceHeight: f32,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: PowerWindowParams;

fn rotateWindowPoint(point: vec2f, angleDeg: f32) -> vec2f {
  let angle = -angleDeg * PI / 180.0;
  let c = cos(angle);
  let s = sin(angle);
  return vec2f(point.x * c - point.y * s, point.x * s + point.y * c);
}

fn powerWindowMask(uv: vec2f) -> f32 {
  let aspect = max(params.sourceWidth / max(params.sourceHeight, 1.0), 0.0001);
  var local = uv - vec2f(params.centerX, params.centerY);
  local.x *= aspect;
  local = rotateWindowPoint(local, params.rotation);

  let size = max(vec2f(params.sizeX * aspect, params.sizeY) * 0.5, vec2f(0.0001));
  let normalized = local / size;
  let shapeKind = i32(params.shapeKind + 0.5);
  var dist = length(normalized);
  if (shapeKind == 1) {
    dist = max(abs(normalized.x), abs(normalized.y));
  }
  let feather = clamp(params.feather, 0.001, 1.0);
  return clamp(1.0 - smoothstep(1.0 - feather, 1.0, dist), 0.0, 1.0);
}

@fragment
fn powerWindowFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  var mask = powerWindowMask(input.uv);
  if (params.invertMask > 0.5) {
    mask = 1.0 - mask;
  }
  mask = clamp(mask * params.strength, 0.0, 1.0);

  if (params.showMask > 0.5) {
    return vec4f(vec3f(mask), color.a);
  }

  var corrected = color.rgb;
  corrected *= pow(2.0, params.exposure);
  let temp = params.temperature / 100.0;
  corrected.r += temp * 0.1;
  corrected.b -= temp * 0.1;
  let ti = params.tint / 100.0;
  corrected.g -= ti * 0.1;
  corrected.r += ti * 0.05;
  corrected.b += ti * 0.05;
  let sat = 1.0 + params.saturation / 100.0;
  let gray = luminance601(corrected);
  corrected = mix(vec3f(gray), corrected, sat);

  return vec4f(clamp(mix(color.rgb, corrected, mask), vec3f(0.0), vec3f(1.0)), color.a);
}`
    ),
    params: {
      shape: {
        type: "select",
        label: "Shape",
        default: "ellipse",
        options: [
          { value: "ellipse", label: "Ellipse" },
          { value: "rectangle", label: "Rectangle" }
        ]
      },
      centerX: {
        type: "number",
        label: "Center X",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      centerY: {
        type: "number",
        label: "Center Y",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      sizeX: {
        type: "number",
        label: "Width",
        default: 0.5,
        min: 0.02,
        max: 1.5,
        step: 0.01,
        animatable: true
      },
      sizeY: {
        type: "number",
        label: "Height",
        default: 0.5,
        min: 0.02,
        max: 1.5,
        step: 0.01,
        animatable: true
      },
      rotation: {
        type: "number",
        label: "Rotation",
        default: 0,
        min: -180,
        max: 180,
        step: 1,
        animatable: true
      },
      feather: {
        type: "number",
        label: "Feather",
        default: 0.3,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      invertMask: {
        type: "boolean",
        label: "Invert Mask",
        default: false
      },
      showMask: {
        type: "boolean",
        label: "Show Mask",
        default: false
      },
      exposure: {
        type: "number",
        label: "Exposure",
        default: 0.3,
        min: -3,
        max: 3,
        step: 0.05,
        animatable: true
      },
      saturation: {
        type: "number",
        label: "Saturation",
        default: 0,
        min: -100,
        max: 100,
        step: 1,
        animatable: true
      },
      temperature: {
        type: "number",
        label: "Temperature",
        default: 0,
        min: -100,
        max: 100,
        step: 1,
        animatable: true
      },
      tint: {
        type: "number",
        label: "Tint",
        default: 0,
        min: -100,
        max: 100,
        step: 1,
        animatable: true
      },
      strength: {
        type: "number",
        label: "Strength",
        default: 1,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p, w, h) => new Float32Array([
      POWER_WINDOW_SHAPE_MAP[p.shape] ?? 0,
      readNumberParam(p, "centerX", 0.5),
      readNumberParam(p, "centerY", 0.5),
      readNumberParam(p, "sizeX", 0.5),
      readNumberParam(p, "sizeY", 0.5),
      readNumberParam(p, "rotation", 0),
      readNumberParam(p, "feather", 0.3),
      p.invertMask === true ? 1 : 0,
      p.showMask === true ? 1 : 0,
      readNumberParam(p, "exposure", 0.3),
      readNumberParam(p, "saturation", 0),
      readNumberParam(p, "temperature", 0),
      readNumberParam(p, "tint", 0),
      readNumberParam(p, "strength", 1),
      w,
      h
    ])
  };
  var vibrance = {
    id: "gpu-vibrance",
    name: "Vibrance",
    category: "color",
    entryPoint: "vibranceFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct VibranceParams { amount: f32, _p1: f32, _p2: f32, _p3: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: VibranceParams;
@fragment
fn vibranceFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let maxC = max(max(color.r, color.g), color.b);
  let minC = min(min(color.r, color.g), color.b);
  let sat = (maxC - minC) / (maxC + 0.001);
  let vibrance = params.amount * (1.0 - sat);
  let gray = luminance601(color.rgb);
  let adjusted = mix(vec3f(gray), color.rgb, 1.0 + vibrance);
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}`
    ),
    params: {
      amount: {
        type: "number",
        label: "Amount",
        default: 0,
        min: -1,
        max: 1,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p) => new Float32Array([p.amount ?? 0, 0, 0, 0])
  };
  var GRADIENT_MAP_PRESETS = {
    inferno: ["#000004", "#420a68", "#932667", "#dd513a", "#fca50a", "#f0f921"],
    magma: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"],
    plasma: ["#0d0887", "#6a00a8", "#b12a90", "#e16462", "#fca636", "#f0f921"],
    viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
    turbo: ["#30123b", "#4675ed", "#1bcfd4", "#a4fc3b", "#fe9b2d", "#cb2a04", "#7a0403"],
    fire: ["#000000", "#7a0000", "#ff4800", "#ffd000", "#ffffff"],
    ice: ["#000010", "#003b6f", "#1b78c2", "#7ec8ff", "#ffffff"],
    sunset: ["#241634", "#c2456b", "#ffd9a0"],
    grayscale: ["#000000", "#ffffff"]
  };
  var GRADIENT_MAP_DEFAULT_CUSTOM = GRADIENT_MAP_PRESETS.inferno.join(", ");
  function gradientMapStops(preset, customStops) {
    const hexes = preset === "custom" ? customStops.split(",").map((s) => s.trim()).filter((s) => s.length > 0) : GRADIENT_MAP_PRESETS[preset] ?? GRADIENT_MAP_PRESETS.inferno;
    const stops = hexes.map((h) => parseHexColorRgb(h, [0, 0, 0]));
    if (stops.length === 0)
      return [
        [0, 0, 0],
        [1, 1, 1]
      ];
    if (stops.length === 1) return [stops[0], stops[0]];
    return stops;
  }
  function buildGradientMapLut(stops) {
    const width = 256;
    const data = new Uint8Array(width * 4);
    const segments = stops.length - 1;
    for (let i = 0; i < width; i++) {
      const t = i / (width - 1);
      const scaled = t * segments;
      const idx = Math.min(Math.floor(scaled), segments - 1);
      const f = scaled - idx;
      const a = stops[idx];
      const b = stops[idx + 1];
      data[i * 4] = Math.round((a[0] + (b[0] - a[0]) * f) * 255);
      data[i * 4 + 1] = Math.round((a[1] + (b[1] - a[1]) * f) * 255);
      data[i * 4 + 2] = Math.round((a[2] + (b[2] - a[2]) * f) * 255);
      data[i * 4 + 3] = 255;
    }
    return { width, height: 1, depth: 1, data };
  }
  var gradientMap = {
    id: "gpu-gradient-map",
    name: "Gradient Map",
    category: "color",
    entryPoint: "gradientMapFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct GradientMapParams { mix: f32, _p1: f32, _p2: f32, _p3: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: GradientMapParams;
@group(0) @binding(3) var gradientLut: texture_2d<f32>;
@fragment
fn gradientMapFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let lum = clamp(luminance601(color.rgb), 0.0, 1.0);
  let mapped = textureSampleLevel(gradientLut, texSampler, vec2f(lum, 0.5), 0.0).rgb;
  let outRgb = mix(color.rgb, mapped, clamp(params.mix, 0.0, 1.0));
  return vec4f(outRgb, color.a);
}`
    ),
    params: {
      preset: {
        type: "select",
        label: "Palette",
        default: "inferno",
        options: [
          { value: "inferno", label: "Inferno" },
          { value: "magma", label: "Magma" },
          { value: "plasma", label: "Plasma" },
          { value: "viridis", label: "Viridis" },
          { value: "turbo", label: "Turbo" },
          { value: "fire", label: "Fire" },
          { value: "ice", label: "Ice" },
          { value: "sunset", label: "Sunset" },
          { value: "grayscale", label: "Grayscale" },
          { value: "custom", label: "Custom" }
        ]
      },
      customStops: {
        type: "text",
        label: "Custom Stops",
        default: GRADIENT_MAP_DEFAULT_CUSTOM,
        visibleWhen: (params) => params.preset === "custom"
      },
      mix: {
        type: "number",
        label: "Mix",
        default: 1,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p) => new Float32Array([readNumberParam(p, "mix", 1), 0, 0, 0]),
    dataTexture: {
      dimension: "2d",
      key: (p) => {
        const preset = p.preset ?? "inferno";
        return preset === "custom" ? `custom:${p.customStops ?? ""}` : `preset:${preset}`;
      },
      build: (p) => buildGradientMapLut(
        gradientMapStops(p.preset ?? "inferno", p.customStops ?? "")
      )
    }
  };

  // ../../packages/comic-core/src/visual-effects/freecut/effects/lut.ts
  var lut_exports = {};
  __export(lut_exports, {
    lut3d: () => lut3d
  });

  // ../../packages/comic-core/src/visual-effects/freecut/lut/cube-lut.ts
  function decodeLutData(encoded) {
    const binary = atob(encoded);
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      data[i] = binary.charCodeAt(i);
    }
    return data;
  }
  function createIdentityLutData(size) {
    const data = new Uint8Array(size * size * size * 4);
    const denom = size > 1 ? size - 1 : 1;
    let offset = 0;
    for (let b = 0; b < size; b++) {
      const blue = Math.round(b / denom * 255);
      for (let g = 0; g < size; g++) {
        const green = Math.round(g / denom * 255);
        for (let r = 0; r < size; r++) {
          data[offset] = Math.round(r / denom * 255);
          data[offset + 1] = green;
          data[offset + 2] = blue;
          data[offset + 3] = 255;
          offset += 4;
        }
      }
    }
    return data;
  }

  // ../../packages/comic-core/src/visual-effects/freecut/effects/lut.ts
  var IDENTITY_LUT_SIZE = 2;
  var lut3d = {
    id: "gpu-lut",
    name: "LUT (.cube)",
    category: "color",
    entryPoint: "lutFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct LutParams { intensity: f32, size: f32, _p2: f32, _p3: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: LutParams;
@group(0) @binding(3) var lutTex: texture_3d<f32>;
@fragment
fn lutFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let size = max(params.size, 2.0);
  let coords = (clamp(color.rgb, vec3f(0.0), vec3f(1.0)) * (size - 1.0) + vec3f(0.5)) / size;
  let graded = textureSample(lutTex, texSampler, coords).rgb;
  return vec4f(mix(color.rgb, graded, clamp(params.intensity, 0.0, 1.0)), color.a);
}`
    ),
    params: {
      intensity: {
        type: "number",
        label: "Intensity",
        default: 1,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      lutName: { type: "json", label: "LUT Name", default: "" },
      lutSize: { type: "json", label: "LUT Size", default: "0" },
      lutData: { type: "json", label: "LUT Data", default: "" }
    },
    packUniforms: (p) => {
      const intensity = typeof p.intensity === "number" ? p.intensity : 1;
      const size = readLutSize(p);
      return new Float32Array([intensity, size, 0, 0]);
    },
    dataTexture: {
      dimension: "3d",
      // The base64 payload is the texture's identity. Returning the string
      // itself (no concatenation) keeps the per-frame key comparison a cheap
      // same-reference check for unchanged params.
      key: (p) => typeof p.lutData === "string" ? p.lutData : "",
      build: (p) => {
        const size = readLutSize(p);
        const encoded = typeof p.lutData === "string" ? p.lutData : "";
        if (size >= 2 && encoded.length > 0) {
          try {
            const data = decodeLutData(encoded);
            if (data.length === size * size * size * 4) {
              return { width: size, height: size, depth: size, data };
            }
          } catch {
          }
        }
        return {
          width: IDENTITY_LUT_SIZE,
          height: IDENTITY_LUT_SIZE,
          depth: IDENTITY_LUT_SIZE,
          data: createIdentityLutData(IDENTITY_LUT_SIZE)
        };
      }
    }
  };
  function readLutSize(params) {
    const raw = params.lutSize;
    const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : 0;
    if (!Number.isFinite(parsed) || parsed < 2 || parsed > 129) return IDENTITY_LUT_SIZE;
    return Math.floor(parsed);
  }

  // ../../packages/comic-core/src/visual-effects/freecut/effects/blur.ts
  var blur_exports = {};
  __export(blur_exports, {
    boxBlur: () => boxBlur,
    gaussianBlur: () => gaussianBlur,
    motionBlur: () => motionBlur,
    radialBlur: () => radialBlur,
    zoomBlur: () => zoomBlur
  });
  var gaussianBlur = {
    id: "gpu-gaussian-blur",
    name: "Gaussian Blur",
    category: "blur",
    entryPoint: "gaussianBlurFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct GaussianBlurParams { radius: f32, width: f32, height: f32, samples: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: GaussianBlurParams;
@fragment
fn gaussianBlurFragment(input: VertexOutput) -> @location(0) vec4f {
  if (params.radius < 0.5) {
    return textureSample(inputTex, texSampler, input.uv);
  }
  let texelSize = vec2f(1.0 / params.width, 1.0 / params.height);
  let sampleRadius = i32(clamp(params.samples, 1.0, 64.0));
  var color = vec4f(0.0);
  var totalWeight = 0.0;
  let sigma = params.radius / 3.0;
  let twoSigmaSq = 2.0 * sigma * sigma;
  for (var x = -sampleRadius; x <= sampleRadius; x++) {
    for (var y = -sampleRadius; y <= sampleRadius; y++) {
      let offset = vec2f(f32(x), f32(y)) * texelSize * (params.radius / f32(sampleRadius));
      let distSq = f32(x * x + y * y);
      let weight = exp(-distSq / twoSigmaSq);
      color += textureSample(inputTex, texSampler, input.uv + offset) * weight;
      totalWeight += weight;
    }
  }
  return color / totalWeight;
}`
    ),
    params: {
      radius: {
        type: "number",
        label: "Radius",
        default: 10,
        min: 0,
        max: 50,
        step: 1,
        animatable: true
      },
      samples: {
        type: "number",
        label: "Samples",
        default: 5,
        min: 1,
        max: 64,
        step: 1,
        animatable: false,
        quality: true
      }
    },
    packUniforms: (p, w, h) => new Float32Array([p.radius ?? 10, w, h, p.samples ?? 5])
  };
  var boxBlur = {
    id: "gpu-box-blur",
    name: "Box Blur",
    category: "blur",
    entryPoint: "boxBlurFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct BoxBlurParams { radius: f32, width: f32, height: f32, _pad: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: BoxBlurParams;
@fragment
fn boxBlurFragment(input: VertexOutput) -> @location(0) vec4f {
  if (params.radius < 0.5) {
    return textureSample(inputTex, texSampler, input.uv);
  }
  let texelSize = vec2f(1.0 / params.width, 1.0 / params.height);
  let samples = i32(params.radius);
  var color = vec4f(0.0);
  var count = 0.0;
  for (var x = -samples; x <= samples; x++) {
    for (var y = -samples; y <= samples; y++) {
      let offset = vec2f(f32(x), f32(y)) * texelSize;
      color += textureSample(inputTex, texSampler, input.uv + offset);
      count += 1.0;
    }
  }
  return color / count;
}`
    ),
    params: {
      radius: {
        type: "number",
        label: "Radius",
        default: 5,
        min: 0,
        max: 20,
        step: 1,
        animatable: true
      }
    },
    packUniforms: (p, w, h) => new Float32Array([p.radius ?? 5, w, h, 0])
  };
  var motionBlur = {
    id: "gpu-motion-blur",
    name: "Motion Blur",
    category: "blur",
    entryPoint: "motionBlurFragment",
    // Two vec4-aligned rows. The second row carries the hard radius bound so
    // corrupted/legacy project values cannot turn one layer into an unbounded
    // full-frame texture walk.
    uniformSize: 32,
    shader: (
      /* wgsl */
      `
struct MotionBlurParams {
  amount: f32,
  angle: f32,
  shutterAngle: f32,
  samples: f32,
  maxRadius: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: MotionBlurParams;
@fragment
fn motionBlurFragment(input: VertexOutput) -> @location(0) vec4f {
  let exposure = clamp(params.shutterAngle / 360.0, 0.0, 1.0);
  let radius = min(max(params.amount, 0.0) * exposure, params.maxRadius);
  if (radius < 0.001 || exposure < 0.001) {
    return textureSample(inputTex, texSampler, input.uv);
  }
  let direction = vec2f(cos(params.angle), sin(params.angle));
  // Quality is deliberately bounded: shutter blur is on a per-layer hot path.
  let samples = i32(clamp(params.samples, 4.0, 32.0));
  var color = vec4f(0.0);
  var totalWeight = 0.0;
  for (var i = 0; i < samples; i++) {
    let t = (f32(i) / f32(samples - 1) - 0.5) * 2.0;
    let offset = direction * t * radius;
    let weight = exp(-t * t * 2.0);
    color += textureSample(inputTex, texSampler, input.uv + offset) * weight;
    totalWeight += weight;
  }
  return color / totalWeight;
}`
    ),
    params: {
      amount: {
        type: "number",
        label: "Amount",
        default: 0.05,
        min: 0,
        max: 0.3,
        step: 5e-3,
        animatable: true
      },
      angle: {
        type: "number",
        label: "Angle",
        default: 0,
        min: 0,
        max: 6.28318,
        step: 0.01,
        animatable: true
      },
      samples: {
        type: "number",
        label: "Samples",
        default: 16,
        min: 4,
        max: 32,
        step: 1,
        animatable: false,
        quality: true
      },
      shutterAngle: {
        type: "number",
        label: "Shutter Angle",
        default: 180,
        min: 0,
        max: 360,
        step: 1,
        animatable: true
      }
    },
    packUniforms: (p) => new Float32Array([
      p.amount ?? 0.05,
      p.angle ?? 0,
      // Existing effect instances have legacy params but no shutterAngle;
      // a truly empty params object is the registry's "use defaults" probe.
      p.shutterAngle ?? (Object.keys(p).length > 0 ? 360 : 180),
      p.samples ?? 16,
      0.2,
      0,
      0,
      0
    ])
  };
  var radialBlur = {
    id: "gpu-radial-blur",
    name: "Radial Blur",
    category: "blur",
    entryPoint: "radialBlurFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct RadialBlurParams { amount: f32, centerX: f32, centerY: f32, samples: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: RadialBlurParams;
@fragment
fn radialBlurFragment(input: VertexOutput) -> @location(0) vec4f {
  let center = vec2f(params.centerX, params.centerY);
  let dir = input.uv - center;
  let dist = length(dir);
  if (params.amount < 0.01) {
    return textureSample(inputTex, texSampler, input.uv);
  }
  var color = vec4f(0.0);
  let samples = i32(clamp(params.samples, 4.0, 256.0));
  let amount = params.amount * 0.2;
  var totalWeight = 0.0;
  for (var i = 0; i < samples; i++) {
    let t = f32(i) / f32(samples - 1);
    let scale = 1.0 - amount * t * dist;
    let weight = 1.0 - t * 0.5;
    let samplePos = center + dir * scale;
    color += textureSample(inputTex, texSampler, samplePos) * weight;
    totalWeight += weight;
  }
  return color / totalWeight;
}`
    ),
    params: {
      amount: {
        type: "number",
        label: "Amount",
        default: 0.5,
        min: 0,
        max: 2,
        step: 0.01,
        animatable: true
      },
      centerX: {
        type: "number",
        label: "Center X",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      centerY: {
        type: "number",
        label: "Center Y",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      samples: {
        type: "number",
        label: "Samples",
        default: 32,
        min: 4,
        max: 256,
        step: 1,
        animatable: false,
        quality: true
      }
    },
    packUniforms: (p) => new Float32Array([
      p.amount ?? 0.5,
      p.centerX ?? 0.5,
      p.centerY ?? 0.5,
      p.samples ?? 32
    ])
  };
  var zoomBlur = {
    id: "gpu-zoom-blur",
    name: "Zoom Blur",
    category: "blur",
    entryPoint: "zoomBlurFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct ZoomBlurParams { amount: f32, centerX: f32, centerY: f32, samples: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: ZoomBlurParams;
@fragment
fn zoomBlurFragment(input: VertexOutput) -> @location(0) vec4f {
  let center = vec2f(params.centerX, params.centerY);
  let dir = input.uv - center;
  var color = vec4f(0.0);
  let samples = i32(clamp(params.samples, 4.0, 256.0));
  let amount = params.amount * 0.5;
  for (var i = 0; i < samples; i++) {
    let t = f32(i) / f32(samples - 1);
    let scale = 1.0 + amount * t;
    let samplePos = center + dir * scale;
    color += textureSample(inputTex, texSampler, samplePos);
  }
  return color / f32(samples);
}`
    ),
    params: {
      amount: {
        type: "number",
        label: "Amount",
        default: 0.3,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      centerX: {
        type: "number",
        label: "Center X",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      centerY: {
        type: "number",
        label: "Center Y",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      samples: {
        type: "number",
        label: "Samples",
        default: 16,
        min: 4,
        max: 256,
        step: 1,
        animatable: false,
        quality: true
      }
    },
    packUniforms: (p) => new Float32Array([
      p.amount ?? 0.3,
      p.centerX ?? 0.5,
      p.centerY ?? 0.5,
      p.samples ?? 16
    ])
  };

  // ../../packages/comic-core/src/visual-effects/freecut/effects/distort.ts
  var distort_exports = {};
  __export(distort_exports, {
    blocks: () => blocks,
    bulge: () => bulge,
    droste: () => droste,
    flutedGlass: () => flutedGlass,
    glassMosaic: () => glassMosaic,
    kaleidoscope: () => kaleidoscope,
    mirror: () => mirror,
    pixelate: () => pixelate,
    rgbSplit: () => rgbSplit,
    rippleGlass: () => rippleGlass,
    triggerWave: () => triggerWave,
    twirl: () => twirl,
    wave: () => wave
  });
  function parseHexColor(color, fallback) {
    if (!color.startsWith("#")) return fallback;
    const hex = color.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const values = hex.split("").map((ch) => parseInt(ch + ch, 16) / 255);
      if (values.slice(0, 3).every((v) => Number.isFinite(v))) {
        return [
          values[0] ?? fallback[0],
          values[1] ?? fallback[1],
          values[2] ?? fallback[2],
          values[3] ?? 1
        ];
      }
      return fallback;
    }
    if (hex.length === 6 || hex.length === 8) {
      const values = [
        parseInt(hex.slice(0, 2), 16) / 255,
        parseInt(hex.slice(2, 4), 16) / 255,
        parseInt(hex.slice(4, 6), 16) / 255,
        hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
      ];
      if (values.every((value) => Number.isFinite(value))) {
        return values;
      }
    }
    return fallback;
  }
  var pixelate = {
    id: "gpu-pixelate",
    name: "Pixelate",
    category: "distort",
    entryPoint: "pixelateFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct PixelateParams { pixelSize: f32, width: f32, height: f32, _p: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: PixelateParams;
@fragment
fn pixelateFragment(input: VertexOutput) -> @location(0) vec4f {
  let pixelX = params.pixelSize / params.width;
  let pixelY = params.pixelSize / params.height;
  let uv = vec2f(
    floor(input.uv.x / pixelX) * pixelX + pixelX * 0.5,
    floor(input.uv.y / pixelY) * pixelY + pixelY * 0.5
  );
  return textureSample(inputTex, texSampler, uv);
}`
    ),
    params: {
      size: {
        type: "number",
        label: "Pixel Size",
        default: 8,
        min: 1,
        max: 64,
        step: 1,
        animatable: true
      }
    },
    packUniforms: (p, w, h) => new Float32Array([p.size ?? 8, w, h, 0])
  };
  var rgbSplit = {
    id: "gpu-rgb-split",
    name: "RGB Split",
    category: "distort",
    entryPoint: "rgbSplitFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct RGBSplitParams { amount: f32, angle: f32, _p1: f32, _p2: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: RGBSplitParams;
@fragment
fn rgbSplitFragment(input: VertexOutput) -> @location(0) vec4f {
  let offset = vec2f(cos(params.angle), sin(params.angle)) * params.amount;
  let r = textureSample(inputTex, texSampler, input.uv + offset).r;
  let g = textureSample(inputTex, texSampler, input.uv).g;
  let b = textureSample(inputTex, texSampler, input.uv - offset).b;
  let a = textureSample(inputTex, texSampler, input.uv).a;
  return vec4f(r, g, b, a);
}`
    ),
    params: {
      amount: {
        type: "number",
        label: "Amount",
        default: 0.01,
        min: 0,
        max: 0.1,
        step: 1e-3,
        animatable: true
      },
      angle: {
        type: "number",
        label: "Angle",
        default: 0,
        min: 0,
        max: 6.28318,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p) => new Float32Array([p.amount ?? 0.01, p.angle ?? 0, 0, 0])
  };
  var twirl = {
    id: "gpu-twirl",
    name: "Twirl",
    category: "distort",
    entryPoint: "twirlFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct TwirlParams { amount: f32, radius: f32, centerX: f32, centerY: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: TwirlParams;
@fragment
fn twirlFragment(input: VertexOutput) -> @location(0) vec4f {
  let center = vec2f(params.centerX, params.centerY);
  let delta = input.uv - center;
  let dist = length(delta);
  let safeRadius = max(params.radius, 0.0001);
  let factor = 1.0 - min(dist / safeRadius, 1.0);
  let angle = params.amount * factor * factor;
  let s = sin(angle);
  let c = cos(angle);
  let rotated = vec2f(delta.x * c - delta.y * s, delta.x * s + delta.y * c);
  let twirledUV = center + rotated;
  let inRadius = dist < params.radius;
  let finalUV = select(input.uv, twirledUV, inRadius);
  return textureSample(inputTex, texSampler, finalUV);
}`
    ),
    params: {
      amount: {
        type: "number",
        label: "Amount",
        default: 1,
        min: -10,
        max: 10,
        step: 0.1,
        animatable: true
      },
      radius: {
        type: "number",
        label: "Radius",
        default: 0.5,
        min: 0.1,
        max: 1,
        step: 0.01,
        animatable: true
      },
      centerX: {
        type: "number",
        label: "Center X",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      centerY: {
        type: "number",
        label: "Center Y",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p) => new Float32Array([
      p.amount ?? 1,
      p.radius ?? 0.5,
      p.centerX ?? 0.5,
      p.centerY ?? 0.5
    ])
  };
  var wave = {
    id: "gpu-wave",
    name: "Wave",
    category: "distort",
    entryPoint: "waveFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct WaveParams { amplitudeX: f32, amplitudeY: f32, frequencyX: f32, frequencyY: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: WaveParams;
@fragment
fn waveFragment(input: VertexOutput) -> @location(0) vec4f {
  var uv = input.uv;
  uv.y += sin(uv.x * params.frequencyX * TAU) * params.amplitudeX;
  uv.x += sin(uv.y * params.frequencyY * TAU) * params.amplitudeY;
  return textureSample(inputTex, texSampler, uv);
}`
    ),
    params: {
      amplitudeX: {
        type: "number",
        label: "Horizontal Amp",
        default: 0.02,
        min: 0,
        max: 0.1,
        step: 1e-3,
        animatable: true
      },
      amplitudeY: {
        type: "number",
        label: "Vertical Amp",
        default: 0.02,
        min: 0,
        max: 0.1,
        step: 1e-3,
        animatable: true
      },
      frequencyX: {
        type: "number",
        label: "Horizontal Freq",
        default: 5,
        min: 1,
        max: 20,
        step: 0.5,
        animatable: true
      },
      frequencyY: {
        type: "number",
        label: "Vertical Freq",
        default: 5,
        min: 1,
        max: 20,
        step: 0.5,
        animatable: true
      }
    },
    packUniforms: (p) => new Float32Array([
      p.amplitudeX ?? 0.02,
      p.amplitudeY ?? 0.02,
      p.frequencyX ?? 5,
      p.frequencyY ?? 5
    ])
  };
  var triggerWave = {
    id: "gpu-trigger-wave",
    name: "Trigger Wave",
    category: "distort",
    entryPoint: "triggerWaveFragment",
    uniformSize: 64,
    shader: (
      /* wgsl */
      `
struct TriggerWaveParams {
  settingsA: vec4f,
  settingsB: vec4f,
  settingsC: vec4f,
  settingsD: vec4f,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: TriggerWaveParams;

@fragment
fn triggerWaveFragment(input: VertexOutput) -> @location(0) vec4f {
  let strength = params.settingsA.x;
  let radius = max(params.settingsA.y, 0.001);
  let frequency = max(params.settingsA.z, 0.001);
  let decay = max(params.settingsA.w, 0.001);

  let center = vec2f(params.settingsB.x, params.settingsB.y);
  let phase = fract(params.settingsB.z + params.settingsB.w * params.settingsC.z);
  let chroma = params.settingsC.x;
  let scanlineMix = clamp(params.settingsC.y, 0.0, 1.0);
  let aspect = max(params.settingsC.w, 0.001);
  let glowColor = params.settingsD.rgb * params.settingsD.a;

  let aspectDelta = vec2f((input.uv.x - center.x) * aspect, input.uv.y - center.y);
  let dist = length(aspectDelta);
  let safeDist = max(dist, 0.0001);
  let direction = vec2f(aspectDelta.x / aspect, aspectDelta.y) / safeDist;

  let ringRadius = phase * radius;
  let band = exp(-abs(dist - ringRadius) / decay);
  let tail = 1.0 - smoothstep(0.2, 1.0, phase);
  let carrier = sin((dist - ringRadius) * frequency * TAU);
  let force = carrier * band * tail * strength;
  let warpedUv = input.uv + direction * force;

  var color = textureSample(inputTex, texSampler, warpedUv);
  if (chroma > 0.0) {
    let chromaOffset = direction * chroma * band * (0.25 + abs(strength) * 20.0);
    let red = textureSample(inputTex, texSampler, warpedUv + chromaOffset).r;
    let blue = textureSample(inputTex, texSampler, warpedUv - chromaOffset).b;
    color = vec4f(red, color.g, blue, color.a);
  }

  if (scanlineMix > 0.0) {
    let line = 0.78 + 0.22 * sin(input.position.y * 2.4 + phase * TAU * 8.0);
    color = vec4f(mix(color.rgb, color.rgb * line, scanlineMix), color.a);
  }

  let glow = band * tail * clamp(abs(strength) * 12.0, 0.0, 1.0);
  color = vec4f(color.rgb + glowColor * glow, color.a);
  return vec4f(clamp(color.rgb, vec3f(0.0), vec3f(1.0)), color.a);
}`
    ),
    params: {
      strength: {
        type: "number",
        label: "Strength",
        default: 0.035,
        min: -0.15,
        max: 0.15,
        step: 1e-3,
        animatable: true
      },
      radius: {
        type: "number",
        label: "Radius",
        default: 0.85,
        min: 0.1,
        max: 1.5,
        step: 0.01,
        animatable: true
      },
      frequency: {
        type: "number",
        label: "Frequency",
        default: 18,
        min: 2,
        max: 64,
        step: 1,
        animatable: true
      },
      decay: {
        type: "number",
        label: "Decay",
        default: 0.08,
        min: 0.01,
        max: 0.3,
        step: 0.01,
        animatable: true
      },
      phase: {
        type: "number",
        label: "Phase",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      speed: {
        type: "number",
        label: "Speed",
        default: 1,
        min: 0,
        max: 4,
        step: 0.1,
        animatable: false
      },
      centerX: {
        type: "number",
        label: "Center X",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      centerY: {
        type: "number",
        label: "Center Y",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      chroma: {
        type: "number",
        label: "Chroma",
        default: 6e-3,
        min: 0,
        max: 0.05,
        step: 1e-3,
        animatable: true
      },
      scanlineMix: {
        type: "number",
        label: "Scanlines",
        default: 0.18,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      glowColor: {
        type: "color",
        label: "Glow Color",
        default: "#2e6b8c",
        animatable: true
      }
    },
    packUniforms: (p, w, h) => {
      const time = typeof p.__time === "number" ? p.__time : 0;
      const glowColor = parseHexColor(p.glowColor ?? "#2e6b8c", [0.18, 0.42, 0.55, 1]);
      return new Float32Array([
        p.strength ?? 0.035,
        p.radius ?? 0.85,
        p.frequency ?? 18,
        p.decay ?? 0.08,
        p.centerX ?? 0.5,
        p.centerY ?? 0.5,
        p.phase ?? 0,
        p.speed ?? 1,
        p.chroma ?? 6e-3,
        p.scanlineMix ?? 0.18,
        time,
        w / Math.max(h, 1),
        glowColor[0],
        glowColor[1],
        glowColor[2],
        glowColor[3]
      ]);
    }
  };
  var bulge = {
    id: "gpu-bulge",
    name: "Bulge/Pinch",
    category: "distort",
    entryPoint: "bulgeFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct BulgeParams { amount: f32, radius: f32, centerX: f32, centerY: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: BulgeParams;
@fragment
fn bulgeFragment(input: VertexOutput) -> @location(0) vec4f {
  let center = vec2f(params.centerX, params.centerY);
  let delta = input.uv - center;
  let dist = length(delta);
  let safeDist = max(dist, 0.0001);
  let normalizedDist = safeDist / params.radius;
  let factor = pow(normalizedDist, params.amount);
  let newDist = factor * params.radius;
  let direction = delta / safeDist;
  let bulgedUV = center + direction * newDist;
  let inRadius = dist < params.radius && dist > 0.0;
  let finalUV = select(input.uv, bulgedUV, inRadius);
  return textureSample(inputTex, texSampler, finalUV);
}`
    ),
    params: {
      amount: {
        type: "number",
        label: "Amount",
        default: 0.5,
        min: 0.1,
        max: 3,
        step: 0.1,
        animatable: true
      },
      radius: {
        type: "number",
        label: "Radius",
        default: 0.5,
        min: 0.1,
        max: 1,
        step: 0.01,
        animatable: true
      },
      centerX: {
        type: "number",
        label: "Center X",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      centerY: {
        type: "number",
        label: "Center Y",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p) => new Float32Array([
      p.amount ?? 0.5,
      p.radius ?? 0.5,
      p.centerX ?? 0.5,
      p.centerY ?? 0.5
    ])
  };
  var kaleidoscope = {
    id: "gpu-kaleidoscope",
    name: "Kaleidoscope",
    category: "distort",
    entryPoint: "kaleidoscopeFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct KaleidoscopeParams { segments: f32, rotation: f32, _p1: f32, _p2: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: KaleidoscopeParams;
@fragment
fn kaleidoscopeFragment(input: VertexOutput) -> @location(0) vec4f {
  var uv = input.uv - 0.5;
  let angle = atan2(uv.y, uv.x) + params.rotation;
  let radius = length(uv);
  let segmentAngle = TAU / params.segments;
  var a = fract(angle / segmentAngle) * segmentAngle;
  if (a > segmentAngle * 0.5) { a = segmentAngle - a; }
  uv = vec2f(cos(a), sin(a)) * radius + 0.5;
  return textureSample(inputTex, texSampler, uv);
}`
    ),
    params: {
      segments: {
        type: "number",
        label: "Segments",
        default: 6,
        min: 2,
        max: 16,
        step: 1,
        animatable: true
      },
      rotation: {
        type: "number",
        label: "Rotation",
        default: 0,
        min: 0,
        max: 6.28318,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p) => new Float32Array([p.segments ?? 6, p.rotation ?? 0, 0, 0])
  };
  var mirror = {
    id: "gpu-mirror",
    name: "Mirror",
    category: "distort",
    entryPoint: "mirrorFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct MirrorParams { horizontal: f32, vertical: f32, _p1: f32, _p2: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: MirrorParams;
@fragment
fn mirrorFragment(input: VertexOutput) -> @location(0) vec4f {
  var uv = input.uv;
  if (params.horizontal > 0.5 && uv.x > 0.5) { uv.x = 1.0 - uv.x; }
  if (params.vertical > 0.5 && uv.y > 0.5) { uv.y = 1.0 - uv.y; }
  return textureSample(inputTex, texSampler, uv);
}`
    ),
    params: {
      horizontal: { type: "boolean", label: "Horizontal", default: true },
      vertical: { type: "boolean", label: "Vertical", default: false }
    },
    packUniforms: (p) => new Float32Array([p.horizontal !== false ? 1 : 0, p.vertical === true ? 1 : 0, 0, 0])
  };
  var flutedGlass = {
    id: "gpu-fluted-glass",
    name: "Fluted Glass",
    category: "distort",
    entryPoint: "flutedGlassFragment",
    uniformSize: 128,
    shader: (
      /* wgsl */
      `
struct FlutedGlassParams {
  colorBack: vec4f,
  colorShadow: vec4f,
  colorHighlight: vec4f,
  settingsA: vec4f,
  settingsB: vec4f,
  settingsC: vec4f,
  settingsD: vec4f,
  margins: vec4f,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: FlutedGlassParams;

fn rotate2d(p: vec2f, angle: f32) -> vec2f {
  let c = cos(angle);
  let s = sin(angle);
  return vec2f(p.x * c - p.y * s, p.x * s + p.y * c);
}

fn rotateAspect(p: vec2f, angle: f32, aspect: f32) -> vec2f {
  var q = p;
  q.x *= aspect;
  q = rotate2d(q, angle);
  q.x /= aspect;
  return q;
}

fn smoothFract(x: f32) -> f32 {
  let f = fract(x);
  let w = fwidth(x);
  let edge = abs(f - 0.5) - 0.5;
  let band = smoothstep(-w, w, edge);
  return mix(f, 1.0 - f, band);
}

fn getUvFrame(uv: vec2f, softness: f32) -> f32 {
  let aax = 2.0 * fwidth(uv.x);
  let aay = 2.0 * fwidth(uv.y);
  let left = smoothstep(0.0, aax + softness, uv.x);
  let right = 1.0 - smoothstep(1.0 - softness - aax, 1.0, uv.x);
  let bottom = smoothstep(0.0, aay + softness, uv.y);
  let top = 1.0 - smoothstep(1.0 - softness - aay, 1.0, uv.y);
  return left * right * bottom * top;
}

fn samplePremultiplied(uv: vec2f) -> vec4f {
  let c = textureSampleLevel(inputTex, texSampler, uv, 0.0);
  return vec4f(c.rgb * c.a, c.a);
}

fn getBlur(uv: vec2f, texelSize: vec2f, dir: vec2f, sigma: f32) -> vec4f {
  if (sigma <= 0.5) {
    return textureSampleLevel(inputTex, texSampler, uv, 0.0);
  }

  let maxRadius = 50;
  let radius = i32(min(f32(maxRadius), ceil(3.0 * sigma)));
  let twoSigma2 = 2.0 * sigma * sigma;
  let gaussianNorm = 1.0 / sqrt(TAU * sigma * sigma);

  var sum = samplePremultiplied(uv) * gaussianNorm;
  var weightSum = gaussianNorm;

  for (var i = 1; i <= maxRadius; i = i + 1) {
    if (i > radius) {
      break;
    }

    let x = f32(i);
    let w = exp(-(x * x) / twoSigma2) * gaussianNorm;
    let offset = dir * texelSize * x;
    let s1 = samplePremultiplied(uv + offset);
    let s2 = samplePremultiplied(uv - offset);
    sum += (s1 + s2) * w;
    weightSum += 2.0 * w;
  }

  let result = sum / weightSum;
  if (result.a > 0.0) {
    return vec4f(result.rgb / result.a, result.a);
  }
  return result;
}

fn flutedOverlayNoise(p: vec2f) -> f32 {
  let coarse = noise2d(p * 0.83 + vec2f(4.1, -7.3));
  let medium = noise2d(vec2f(
    p.x * 1.27 - p.y * 0.58,
    p.x * 0.71 + p.y * 1.19
  ) + vec2f(-10.2, 5.4));
  let fine = noise2d(vec2f(
    p.x * -0.92 + p.y * 1.11,
    p.x * -1.06 - p.y * 0.82
  ) + vec2f(7.8, 9.6));
  return coarse * 0.45 + medium * 0.35 + fine * 0.2;
}

@fragment
fn flutedGlassFragment(input: VertexOutput) -> @location(0) vec4f {
  let width = max(params.settingsD.y, 1.0);
  let height = max(params.settingsD.z, 1.0);
  let aspect = max(params.settingsD.w, 0.0001);

  let size = clamp(params.settingsA.x, 0.0, 1.0);
  let shadowsAmount = clamp(params.settingsA.y, 0.0, 1.0);
  let angle = params.settingsA.z * PI / 180.0;
  let stretchAmount = clamp(params.settingsA.w, 0.0, 1.0);

  let shape = i32(params.settingsB.x);
  let distortionAmount = clamp(params.settingsB.y, 0.0, 1.0);
  let highlightsAmount = clamp(params.settingsB.z, 0.0, 1.0);
  let distortionShape = i32(params.settingsB.w);

  let shiftAmount = params.settingsC.x;
  let blurAmount = clamp(params.settingsC.y, 0.0, 1.0);
  let edgesAmount = clamp(params.settingsC.z, 0.0, 1.0);
  let grainMixer = clamp(params.settingsC.w, 0.0, 1.0);
  let grainOverlay = clamp(params.settingsD.x, 0.0, 1.0);

  let marginLeft = params.margins.x;
  let marginTop = params.margins.y;
  let marginRight = params.margins.z;
  let marginBottom = params.margins.w;

  let patternRotation = -angle;
  let patternSize = mix(200.0, 5.0, size);

  var uv = input.uv;
  let uvMask = input.position.xy / vec2f(width, height);
  let sw = vec2f(0.005);
  let mask =
    smoothstep(marginLeft, marginLeft + sw.x, uvMask.x + sw.x) *
    smoothstep(marginRight, marginRight + sw.x, 1.0 - uvMask.x + sw.x) *
    smoothstep(marginTop, marginTop + sw.y, uvMask.y + sw.y) *
    smoothstep(marginBottom, marginBottom + sw.y, 1.0 - uvMask.y + sw.y);
  let maskOuter =
    smoothstep(marginLeft - sw.x, marginLeft, uvMask.x + sw.x) *
    smoothstep(marginRight - sw.x, marginRight, 1.0 - uvMask.x + sw.x) *
    smoothstep(marginTop - sw.y, marginTop, uvMask.y + sw.y) *
    smoothstep(marginBottom - sw.y, marginBottom, 1.0 - uvMask.y + sw.y);
  let maskStroke = maskOuter - mask;
  let maskInner =
    smoothstep(marginLeft - 2.0 * sw.x, marginLeft, uvMask.x) *
    smoothstep(marginRight - 2.0 * sw.x, marginRight, 1.0 - uvMask.x) *
    smoothstep(marginTop - 2.0 * sw.y, marginTop, uvMask.y) *
    smoothstep(marginBottom - 2.0 * sw.y, marginBottom, 1.0 - uvMask.y);
  let maskStrokeInner = maskInner - mask;

  uv -= 0.5;
  uv *= patternSize;
  uv = rotateAspect(uv, patternRotation, aspect);

  var curve = 0.0;
  let patternY = uv.y / aspect;
  if (shape == 5) {
    curve = 0.5 + 0.5 * sin(0.5 * PI * uv.x) * cos(0.5 * PI * patternY);
  } else if (shape == 4) {
    curve = 10.0 * abs(fract(0.1 * patternY) - 0.5);
  } else if (shape == 3) {
    curve = 4.0 * sin(0.23 * patternY);
  } else if (shape == 2) {
    curve = 0.5 + 0.5 * sin(0.5 * uv.x) * sin(1.7 * uv.x);
  }

  let uvToFract = uv + curve;
  var fractOrigUV = fract(uv);
  var floorOrigUV = floor(uv);
  var x = smoothFract(uvToFract.x);
  let xNonSmooth = fract(uvToFract.x) + 0.0001;

  var highlightsWidth = 2.0 * max(0.001, fwidth(uvToFract.x));
  highlightsWidth += 2.0 * maskStrokeInner;
  var highlights = smoothstep(0.0, highlightsWidth, xNonSmooth);
  highlights *= smoothstep(1.0, 1.0 - highlightsWidth, xNonSmooth);
  highlights = 1.0 - highlights;
  highlights *= highlightsAmount;
  highlights = clamp(highlights, 0.0, 1.0);
  highlights *= mask;

  var shadows = pow(x, 1.3);
  var distortion = 0.0;
  var fadeX = 1.0;
  var frameFade = 0.0;

  var aa = fwidth(xNonSmooth);
  aa = max(aa, fwidth(uv.x));
  aa = max(aa, fwidth(uvToFract.x));
  aa = max(aa, 0.0001);

  if (distortionShape == 1) {
    distortion = -pow(1.5 * x, 3.0);
    distortion += 0.5 - shiftAmount;
    frameFade = pow(1.5 * x, 3.0);
    aa = max(0.2, aa);
    aa += mix(0.2, 0.0, size);
    fadeX = smoothstep(0.0, aa, xNonSmooth) * smoothstep(1.0, 1.0 - aa, xNonSmooth);
    distortion = mix(0.5, distortion, fadeX);
  } else if (distortionShape == 2) {
    distortion = 2.0 * pow(x, 2.0);
    distortion -= 0.5 + shiftAmount;
    frameFade = pow(abs(x - 0.5), 4.0);
    aa = max(0.2, aa);
    aa += mix(0.2, 0.0, size);
    fadeX = smoothstep(0.0, aa, xNonSmooth) * smoothstep(1.0, 1.0 - aa, xNonSmooth);
    distortion = mix(0.5, distortion, fadeX);
    frameFade = mix(1.0, frameFade, 0.5 * fadeX);
  } else if (distortionShape == 3) {
    distortion = pow(2.0 * (xNonSmooth - 0.5), 6.0);
    distortion -= 0.25;
    distortion -= shiftAmount;
    frameFade = 1.0 - 2.0 * pow(abs(x - 0.4), 2.0);
    aa = 0.15;
    aa += mix(0.1, 0.0, size);
    fadeX = smoothstep(0.0, aa, xNonSmooth) * smoothstep(1.0, 1.0 - aa, xNonSmooth);
    frameFade = mix(1.0, frameFade, fadeX);
  } else if (distortionShape == 4) {
    x = xNonSmooth;
    distortion = sin((x + 0.25) * TAU);
    shadows = 0.5 + 0.5 * asin(distortion) / (0.5 * PI);
    distortion *= 0.5;
    distortion -= shiftAmount;
    frameFade = 0.5 + 0.5 * sin(x * TAU);
  } else if (distortionShape == 5) {
    distortion -= pow(abs(x), 0.2) * x;
    distortion += 0.33;
    distortion -= 3.0 * shiftAmount;
    distortion *= 0.33;
    frameFade = 0.3 * smoothstep(0.0, 1.0, x);
    shadows = pow(x, 2.5);
    aa = max(0.1, aa);
    aa += mix(0.1, 0.0, size);
    fadeX = smoothstep(0.0, aa, xNonSmooth) * smoothstep(1.0, 1.0 - aa, xNonSmooth);
    distortion *= fadeX;
  }

  // Grain UV (and its derivatives) are only needed when grain or grain overlay
  // are active. grainMixer/grainOverlay are uniform, so these branches are
  // coherent across the draw \u2014 no divergence \u2014 and the dpdx/dpdy derivatives
  // stay in uniform control flow. Skips ~36 sin-based hash() calls per pixel
  // when grain is off (the common case), which dominates this shader's ALU.
  let grainActive = grainMixer > 0.0 || grainOverlay > 0.0;
  var grainUV = input.uv;
  if (grainActive) {
    let dudx = dpdx(input.uv);
    let dudy = dpdy(input.uv);
    var gUV = input.uv - 0.5;
    let derivativeScale = 0.8 / max(vec2f(length(dudx), length(dudy)), vec2f(0.0001));
    gUV *= derivativeScale;
    gUV += 0.5;
    grainUV = gUV;
  }
  if (grainMixer > 0.0) {
    var grain = flutedOverlayNoise(grainUV);
    grain = smoothstep(0.4, 0.7, grain);
    grain *= grainMixer;
    distortion = mix(distortion, 0.0, grain);
  }

  shadows = min(shadows, 1.0);
  shadows += maskStrokeInner;
  shadows *= mask;
  shadows = min(shadows, 1.0);
  shadows *= pow(shadowsAmount, 2.0);
  shadows = clamp(shadows, 0.0, 1.0);

  distortion *= 3.0 * distortionAmount;
  frameFade *= distortionAmount;

  fractOrigUV = vec2f(fractOrigUV.x + distortion, fractOrigUV.y);
  floorOrigUV = rotateAspect(floorOrigUV, -patternRotation, aspect);
  fractOrigUV = rotateAspect(fractOrigUV, -patternRotation, aspect);

  uv = (floorOrigUV + fractOrigUV) / patternSize;
  uv += vec2f(pow(maskStroke, 4.0));
  uv += 0.5;

  uv = mix(input.uv, uv, smoothstep(0.0, 0.7, mask));
  var blur = mix(0.0, 50.0, blurAmount);
  blur = mix(0.0, blur, smoothstep(0.5, 1.0, mask));

  var edgeDistortion = mix(0.0, 0.04, edgesAmount);
  edgeDistortion += 0.06 * frameFade * edgesAmount;
  edgeDistortion *= mask;
  let frame = getUvFrame(uv, edgeDistortion);

  // stretchAmount is uniform \u2014 skip the stretch warp (and its getUvFrame /
  // fwidth work) entirely when stretch is off.
  if (stretchAmount > 0.0) {
    var stretch = 1.0 - smoothstep(0.0, 0.5, xNonSmooth) * smoothstep(1.0, 0.5, xNonSmooth);
    stretch = pow(stretch, 2.0);
    stretch *= mask;
    stretch *= getUvFrame(uv, 0.1 + 0.05 * mask * frameFade);
    uv = vec2f(uv.x, mix(uv.y, 0.5, stretchAmount * stretch));
  }

  let imageSample = getBlur(uv, 1.0 / vec2f(width, height), vec2f(0.0, 1.0), blur);
  let image = vec4f(imageSample.rgb * imageSample.a, imageSample.a);
  let backColor = vec4f(params.colorBack.rgb * params.colorBack.a, params.colorBack.a);
  let highlightColor = vec4f(params.colorHighlight.rgb * params.colorHighlight.a, params.colorHighlight.a);
  let shadowColor = params.colorShadow;

  var color = highlightColor.rgb * highlights;
  var opacity = highlightColor.a * highlights;

  shadows = mix(shadows * shadowColor.a, 0.0, highlights);
  color = mix(color, shadowColor.rgb * shadowColor.a, 0.5 * shadows);
  color += 0.5 * pow(shadows, 0.5) * shadowColor.rgb;
  opacity += shadows;
  color = clamp(color, vec3f(0.0), vec3f(1.0));
  opacity = clamp(opacity, 0.0, 1.0);

  color += image.rgb * (1.0 - opacity) * frame;
  opacity += image.a * (1.0 - opacity) * frame;
  color += backColor.rgb * (1.0 - opacity);
  opacity += backColor.a * (1.0 - opacity);

  // grainOverlay is uniform \u2014 the two-octave overlay noise (24 sin-based
  // hash() calls) only runs when the overlay is actually dialed in.
  if (grainOverlay > 0.0) {
    var grainOverlayNoise = flutedOverlayNoise(rotate2d(grainUV, 1.0) + vec2f(3.0));
    grainOverlayNoise = mix(grainOverlayNoise, flutedOverlayNoise(rotate2d(grainUV, 2.0) + vec2f(-1.0)), 0.5);
    grainOverlayNoise = pow(grainOverlayNoise, 1.3);

    let grainOverlayV = grainOverlayNoise * 2.0 - 1.0;
    let grainOverlayColor = vec3f(select(0.0, 1.0, grainOverlayV >= 0.0));
    var grainOverlayStrength = grainOverlay * abs(grainOverlayV);
    grainOverlayStrength = pow(grainOverlayStrength, 0.8);
    grainOverlayStrength *= mask;
    color = mix(color, grainOverlayColor, 0.35 * grainOverlayStrength);
    opacity += 0.5 * grainOverlayStrength;
  }
  opacity = clamp(opacity, 0.0, 1.0);

  return vec4f(color, opacity);
}`
    ),
    params: {
      colorBack: { type: "color", label: "Back Color", default: "#00000000", animatable: true },
      colorShadow: { type: "color", label: "Shadow Color", default: "#000000", animatable: true },
      colorHighlight: {
        type: "color",
        label: "Highlight Color",
        default: "#ffffff",
        animatable: true
      },
      shadows: {
        type: "number",
        label: "Shadows",
        default: 0.25,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      highlights: {
        type: "number",
        label: "Highlights",
        default: 0.1,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      size: {
        type: "number",
        label: "Size",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      shape: {
        type: "select",
        label: "Shape",
        default: "lines",
        options: [
          { value: "lines", label: "Lines" },
          { value: "linesIrregular", label: "Irregular Lines" },
          { value: "wave", label: "Wave" },
          { value: "zigzag", label: "Zigzag" },
          { value: "pattern", label: "Pattern" }
        ]
      },
      angle: {
        type: "number",
        label: "Angle",
        default: 0,
        min: 0,
        max: 180,
        step: 1,
        animatable: true
      },
      distortionShape: {
        type: "select",
        label: "Distortion Shape",
        default: "prism",
        options: [
          { value: "prism", label: "Prism" },
          { value: "lens", label: "Lens" },
          { value: "contour", label: "Contour" },
          { value: "cascade", label: "Cascade" },
          { value: "flat", label: "Flat" }
        ]
      },
      distortion: {
        type: "number",
        label: "Distortion",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      shift: {
        type: "number",
        label: "Shift",
        default: 0,
        min: -1,
        max: 1,
        step: 0.01,
        animatable: true
      },
      stretch: {
        type: "number",
        label: "Stretch",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      blur: {
        type: "number",
        label: "Blur",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      edges: {
        type: "number",
        label: "Edges",
        default: 0.25,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      margin: {
        type: "number",
        label: "Margin",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      marginLeft: {
        type: "number",
        label: "Left Margin",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      marginRight: {
        type: "number",
        label: "Right Margin",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      marginTop: {
        type: "number",
        label: "Top Margin",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      marginBottom: {
        type: "number",
        label: "Bottom Margin",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      grainMixer: {
        type: "number",
        label: "Grain Mixer",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      grainOverlay: {
        type: "number",
        label: "Grain Overlay",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p, w, h) => {
      const gridShapeMap = {
        lines: 1,
        linesIrregular: 2,
        wave: 3,
        zigzag: 4,
        pattern: 5
      };
      const distortionShapeMap = {
        prism: 1,
        lens: 2,
        contour: 3,
        cascade: 4,
        flat: 5
      };
      const margin = p.margin ?? 0;
      const marginLeft = p.marginLeft ?? margin;
      const marginRight = p.marginRight ?? margin;
      const marginTop = p.marginTop ?? margin;
      const marginBottom = p.marginBottom ?? margin;
      const colorBack = parseHexColor(p.colorBack ?? "#00000000", [0, 0, 0, 0]);
      const colorShadow = parseHexColor(p.colorShadow ?? "#000000", [0, 0, 0, 1]);
      const colorHighlight = parseHexColor(p.colorHighlight ?? "#ffffff", [1, 1, 1, 1]);
      return new Float32Array([
        colorBack[0],
        colorBack[1],
        colorBack[2],
        colorBack[3],
        colorShadow[0],
        colorShadow[1],
        colorShadow[2],
        colorShadow[3],
        colorHighlight[0],
        colorHighlight[1],
        colorHighlight[2],
        colorHighlight[3],
        p.size ?? 0.5,
        p.shadows ?? 0.25,
        p.angle ?? 0,
        p.stretch ?? 0,
        gridShapeMap[p.shape] ?? 1,
        p.distortion ?? 0.5,
        p.highlights ?? 0.1,
        distortionShapeMap[p.distortionShape] ?? 1,
        p.shift ?? 0,
        p.blur ?? 0,
        p.edges ?? 0.25,
        p.grainMixer ?? 0,
        p.grainOverlay ?? 0,
        w,
        h,
        w / Math.max(h, 1),
        marginLeft,
        marginTop,
        marginRight,
        marginBottom
      ]);
    }
  };
  var rippleGlass = {
    id: "gpu-ripple-glass",
    name: "Ripple Glass",
    category: "distort",
    entryPoint: "rippleGlassFragment",
    uniformSize: 80,
    shader: (
      /* wgsl */
      `
struct RippleGlassParams {
  colorShadow: vec4f,
  colorHighlight: vec4f,
  settingsA: vec4f,
  settingsB: vec4f,
  settingsC: vec4f,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: RippleGlassParams;

@fragment
fn rippleGlassFragment(input: VertexOutput) -> @location(0) vec4f {
  let amount = params.settingsA.x;
  let rings = max(params.settingsA.y, 1.0);
  let shadowsAmount = clamp(params.settingsA.z, 0.0, 1.0);
  let highlightsAmount = clamp(params.settingsA.w, 0.0, 1.0);

  let origin = vec2f(params.settingsB.x, params.settingsB.y);
  let phase = params.settingsB.z;
  let falloff = max(params.settingsB.w, 0.001);

  let aberration = params.settingsC.x;
  let aspect = max(params.settingsC.w, 0.0001);

  // Aspect-corrected radial vector from the ripple origin.
  var p = input.uv - origin;
  p.x *= aspect;
  let dist = length(p);
  let dir = p / max(dist, 1e-4);
  // Radial offset expressed back in uv space (undo the aspect scaling on x).
  let radialUv = vec2f(dir.x / aspect, dir.y);

  let ringWidth = 1.0 / rings;
  let ringCoord = dist / ringWidth - phase;   // integer part = ring index
  let x = fract(ringCoord);                     // 0..1 within the ring
  let centered = x - 0.5;

  // Cylindrical lens bend: soft at the ring centre, steep toward the seams,
  // pulling samples back toward each ring centre (magnifying the band).
  let bend = -sign(centered) * pow(abs(centered) * 2.0, 1.5);

  // Reach envelope \u2014 fades the ripple away from the origin.
  let envelope = exp(-dist / falloff);

  let push = bend * amount * ringWidth * 1.5 * envelope;
  let offsetUv = radialUv * push;

  var color: vec4f;
  if (aberration > 0.0) {
    let ca = radialUv * aberration * ringWidth * envelope;
    let r = textureSample(inputTex, texSampler, input.uv + offsetUv + ca).r;
    let g = textureSample(inputTex, texSampler, input.uv + offsetUv).g;
    let b = textureSample(inputTex, texSampler, input.uv + offsetUv - ca).b;
    let a = textureSample(inputTex, texSampler, input.uv + offsetUv).a;
    color = vec4f(r, g, b, a);
  } else {
    color = textureSample(inputTex, texSampler, input.uv + offsetUv);
  }

  // Thin bright seam between rings + groove shadow that deepens toward it.
  let aa = 2.0 * max(0.001, fwidth(ringCoord));
  var highlights = 1.0 - (smoothstep(0.0, aa, x) * smoothstep(1.0, 1.0 - aa, x));
  highlights = clamp(highlights * highlightsAmount * envelope, 0.0, 1.0);

  var shadows = pow(abs(centered) * 2.0, 1.3);
  shadows = clamp(shadows * shadowsAmount * envelope, 0.0, 1.0);

  let shadowColor = params.colorShadow;
  let highlightColor = params.colorHighlight;

  var rgb = color.rgb;
  rgb = mix(rgb, shadowColor.rgb, 0.5 * shadows * shadowColor.a);
  rgb += highlightColor.rgb * highlights * highlightColor.a;
  rgb = clamp(rgb, vec3f(0.0), vec3f(1.0));

  return vec4f(rgb, color.a);
}`
    ),
    params: {
      colorShadow: { type: "color", label: "Shadow Color", default: "#000000", animatable: true },
      colorHighlight: {
        type: "color",
        label: "Highlight Color",
        default: "#ffffff",
        animatable: true
      },
      amount: {
        type: "number",
        label: "Amount",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      rings: {
        type: "number",
        label: "Rings",
        default: 14,
        min: 1,
        max: 64,
        step: 1,
        animatable: true
      },
      shadows: {
        type: "number",
        label: "Shadows",
        default: 0.25,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      highlights: {
        type: "number",
        label: "Highlights",
        default: 0.1,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      originX: {
        type: "number",
        label: "Origin X",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      originY: {
        type: "number",
        label: "Origin Y",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      phase: {
        type: "number",
        label: "Phase",
        default: 0,
        min: -1,
        max: 1,
        step: 0.01,
        animatable: true
      },
      falloff: {
        type: "number",
        label: "Falloff",
        default: 0.35,
        min: 0.05,
        max: 2,
        step: 0.01,
        animatable: true
      },
      aberration: {
        type: "number",
        label: "Aberration",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p, w, h) => {
      const shadow = parseHexColor(p.colorShadow ?? "#000000", [0, 0, 0, 1]);
      const highlight = parseHexColor(p.colorHighlight ?? "#ffffff", [1, 1, 1, 1]);
      return new Float32Array([
        shadow[0],
        shadow[1],
        shadow[2],
        shadow[3],
        highlight[0],
        highlight[1],
        highlight[2],
        highlight[3],
        p.amount ?? 0.5,
        p.rings ?? 14,
        p.shadows ?? 0.25,
        p.highlights ?? 0.1,
        p.originX ?? 0.5,
        p.originY ?? 0.5,
        p.phase ?? 0,
        p.falloff ?? 0.35,
        p.aberration ?? 0,
        w,
        h,
        w / Math.max(h, 1)
      ]);
    }
  };
  var glassMosaic = {
    id: "gpu-glass-mosaic",
    name: "Glass Mosaic",
    category: "distort",
    entryPoint: "glassMosaicFragment",
    uniformSize: 64,
    shader: (
      /* wgsl */
      `
struct GlassMosaicParams {
  colorShadow: vec4f,
  colorHighlight: vec4f,
  settingsA: vec4f,
  settingsB: vec4f,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: GlassMosaicParams;

@fragment
fn glassMosaicFragment(input: VertexOutput) -> @location(0) vec4f {
  let amount = params.settingsA.x;
  let cells = max(params.settingsA.y, 1.0);
  let shadowsAmount = clamp(params.settingsA.z, 0.0, 1.0);
  let highlightsAmount = clamp(params.settingsA.w, 0.0, 1.0);
  let aberration = params.settingsB.x;
  let aspect = max(params.settingsB.w, 0.0001);

  // Square-ish cells: cellsX counts columns across the width; rows scale by
  // aspect so each tile stays roughly square regardless of frame proportions.
  let cellUvSize = vec2f(1.0 / cells, aspect / cells);
  let grid = input.uv / cellUvSize;
  let local = fract(grid) - 0.5;                 // -0.5..0.5 within the cell
  let localUv = local * cellUvSize;              // same offset, in uv space

  // Spherical lens: magnify toward each cell centre, fading out near the rim.
  let dd = dot(local * 2.0, local * 2.0);        // 0 centre .. up to 2 at corners
  let lens = amount * pow(clamp(1.0 - dd, 0.0, 1.0), 0.5);
  let sampleUv = input.uv - localUv * lens;

  var color: vec4f;
  if (aberration > 0.0) {
    let ca = localUv * aberration;
    let r = textureSample(inputTex, texSampler, sampleUv - ca).r;
    let g = textureSample(inputTex, texSampler, sampleUv).g;
    let b = textureSample(inputTex, texSampler, sampleUv + ca).b;
    let a = textureSample(inputTex, texSampler, sampleUv).a;
    color = vec4f(r, g, b, a);
  } else {
    color = textureSample(inputTex, texSampler, sampleUv);
  }

  // Rounded-square edge factor: 0 at the cell centre, 1 at the rim.
  let edge = max(abs(local.x), abs(local.y)) * 2.0;
  let fw = fwidth(edge) + 0.001;

  // Bright bevel just inside each cell border.
  var highlights = smoothstep(1.0 - 6.0 * fw, 1.0 - 2.0 * fw, edge);
  highlights *= highlightsAmount;

  // Darker mortar at the seams + a gentle vignette toward the rim.
  let gap = smoothstep(1.0 - 2.0 * fw, 1.0, edge);
  var shadows = pow(edge, 3.0) * 0.5 + gap;
  shadows = clamp(shadows * shadowsAmount, 0.0, 1.0);

  // Diagonal bevel (light from top-left) gives each tile a glassy roundness.
  let bevel = (-local.x - local.y) * amount * 0.5;

  let shadowColor = params.colorShadow;
  let highlightColor = params.colorHighlight;

  var rgb = color.rgb * (1.0 + bevel);
  rgb = mix(rgb, shadowColor.rgb, 0.5 * shadows * shadowColor.a);
  rgb += highlightColor.rgb * highlights * highlightColor.a;
  rgb = clamp(rgb, vec3f(0.0), vec3f(1.0));

  return vec4f(rgb, color.a);
}`
    ),
    params: {
      colorShadow: { type: "color", label: "Shadow Color", default: "#000000", animatable: true },
      colorHighlight: {
        type: "color",
        label: "Highlight Color",
        default: "#ffffff",
        animatable: true
      },
      amount: {
        type: "number",
        label: "Amount",
        default: 0.55,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      cells: {
        type: "number",
        label: "Cells",
        default: 18,
        min: 2,
        max: 80,
        step: 1,
        animatable: true
      },
      shadows: {
        type: "number",
        label: "Shadows",
        default: 0.3,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      highlights: {
        type: "number",
        label: "Highlights",
        default: 0.12,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      aberration: {
        type: "number",
        label: "Aberration",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p, w, h) => {
      const shadow = parseHexColor(p.colorShadow ?? "#000000", [0, 0, 0, 1]);
      const highlight = parseHexColor(p.colorHighlight ?? "#ffffff", [1, 1, 1, 1]);
      return new Float32Array([
        shadow[0],
        shadow[1],
        shadow[2],
        shadow[3],
        highlight[0],
        highlight[1],
        highlight[2],
        highlight[3],
        p.amount ?? 0.55,
        p.cells ?? 18,
        p.shadows ?? 0.3,
        p.highlights ?? 0.12,
        p.aberration ?? 0,
        w,
        h,
        w / Math.max(h, 1)
      ]);
    }
  };
  var blocks = {
    id: "gpu-blocks",
    name: "Blocks",
    category: "distort",
    entryPoint: "blocksFragment",
    uniformSize: 32,
    shader: (
      /* wgsl */
      `
struct BlocksParams {
  size: f32, depth: f32, studSize: f32, gap: f32,
  width: f32, height: f32, pad0: f32, pad1: f32
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: BlocksParams;
@fragment
fn blocksFragment(input: VertexOutput) -> @location(0) vec4f {
  let cellX = max(params.size, 1.0) / params.width;
  let cellY = max(params.size, 1.0) / params.height;
  let cellIndex = vec2f(floor(input.uv.x / cellX), floor(input.uv.y / cellY));
  let cellCenter = vec2f((cellIndex.x + 0.5) * cellX, (cellIndex.y + 0.5) * cellY);
  let color = textureSample(inputTex, texSampler, cellCenter);

  // local position within the cell, centered at 0 (range -0.5..0.5)
  let local = vec2f(fract(input.uv.x / cellX), fract(input.uv.y / cellY)) - vec2f(0.5);
  let edge = max(abs(local.x), abs(local.y));

  // bevel: light from top-left, shadow toward bottom-right
  let shade = (-local.x - local.y) * params.depth;

  // raised stud at the cell center with its own bevel
  let studR = clamp(params.studSize, 0.0, 1.0) * 0.4;
  let stud = smoothstep(studR, studR - 0.03, length(local));
  let studShade = stud * ((-local.x - local.y) * params.depth * 2.0 + params.depth * 0.18);

  var rgb = color.rgb * (1.0 + shade) + color.rgb * studShade;

  // darken the mortar gap between blocks
  let gapMask = step(edge, 0.5 - clamp(params.gap, 0.0, 0.4));
  rgb = rgb * mix(0.55, 1.0, gapMask);

  return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), color.a);
}`
    ),
    params: {
      size: {
        type: "number",
        label: "Block Size",
        default: 24,
        min: 4,
        max: 120,
        step: 1,
        animatable: true
      },
      depth: {
        type: "number",
        label: "Depth",
        default: 0.5,
        min: 0,
        max: 1.5,
        step: 0.01,
        animatable: true
      },
      studSize: {
        type: "number",
        label: "Stud Size",
        default: 0.55,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      gap: {
        type: "number",
        label: "Gap",
        default: 0.06,
        min: 0,
        max: 0.4,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p, w, h) => new Float32Array([
      p.size ?? 24,
      p.depth ?? 0.5,
      p.studSize ?? 0.55,
      p.gap ?? 0.06,
      w,
      h,
      0,
      0
    ])
  };
  var droste = {
    id: "gpu-droste",
    name: "Droste",
    category: "distort",
    entryPoint: "drosteFragment",
    uniformSize: 32,
    shader: (
      /* wgsl */
      `
struct DrosteParams {
  strength: f32, scale: f32, centerX: f32, centerY: f32,
  spin: f32, width: f32, height: f32, pad: f32
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: DrosteParams;
@fragment
fn drosteFragment(input: VertexOutput) -> @location(0) vec4f {
  let aspect = params.width / max(params.height, 1.0);
  let center = vec2f(params.centerX, params.centerY);
  let p = (input.uv - center) * vec2f(aspect, 1.0);

  let r = max(length(p), 1e-4);
  let a = atan2(p.y, p.x);
  var z = vec2f(log(r), a);

  let period = log(max(params.scale, 1.0001));
  // Escher twist; strength dials from plain recursive zoom (0) to full spiral
  let alpha = atan2(period, TAU) * clamp(params.strength, 0.0, 2.0);
  let co = max(cos(alpha), 1e-3);
  let si = sin(alpha);
  z = vec2f(z.x * co - z.y * si, z.x * si + z.y * co) / co;

  // tile the log-radius into a single repeating band
  z.x = z.x - period * floor(z.x / period);

  let er = exp(z.x);
  let na = z.y + params.spin;
  let uv = center + vec2f(cos(na), sin(na)) * er / vec2f(aspect, 1.0);
  return textureSample(inputTex, texSampler, fract(uv));
}`
    ),
    params: {
      strength: {
        type: "number",
        label: "Spiral",
        default: 1,
        min: 0,
        max: 2,
        step: 0.01,
        animatable: true
      },
      scale: {
        type: "number",
        label: "Scale",
        default: 2,
        min: 1.1,
        max: 6,
        step: 0.05,
        animatable: true
      },
      centerX: {
        type: "number",
        label: "Center X",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      centerY: {
        type: "number",
        label: "Center Y",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      spin: {
        type: "number",
        label: "Spin",
        default: 0,
        min: -6.28318,
        max: 6.28318,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p, w, h) => new Float32Array([
      p.strength ?? 1,
      p.scale ?? 2,
      p.centerX ?? 0.5,
      p.centerY ?? 0.5,
      p.spin ?? 0,
      w,
      h,
      0
    ])
  };

  // ../../packages/comic-core/src/visual-effects/freecut/effects/stylize.ts
  var stylize_exports = {};
  __export(stylize_exports, {
    ascii: () => ascii,
    blockGlitch: () => blockGlitch,
    colorGlitch: () => colorGlitch,
    crt: () => crt,
    dither: () => dither,
    edgeDetect: () => edgeDetect,
    glow: () => glow,
    grain: () => grain,
    halftone: () => halftone,
    ink: () => ink,
    pixelSort: () => pixelSort,
    pixelSortHq: () => pixelSortHq,
    posterize: () => posterize,
    scanlines: () => scanlines,
    sharpen: () => sharpen,
    threshold: () => threshold,
    vhs: () => vhs,
    vignette: () => vignette
  });
  var vignette = {
    id: "gpu-vignette",
    name: "Vignette",
    category: "stylize",
    entryPoint: "vignetteFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct VignetteParams { amount: f32, size: f32, softness: f32, roundness: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: VignetteParams;
@fragment
fn vignetteFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let center = input.uv - 0.5;
  let aspect = vec2f(1.0, params.roundness);
  let dist = length(center * aspect) * 2.0;
  let vig = 1.0 - smoothstep(params.size, params.size + params.softness, dist);
  let vigColor = mix(vec3f(0.0), color.rgb, mix(1.0, vig, params.amount));
  return vec4f(vigColor, color.a);
}`
    ),
    params: {
      amount: {
        type: "number",
        label: "Amount",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      size: {
        type: "number",
        label: "Size",
        default: 0.5,
        min: 0,
        max: 1.5,
        step: 0.01,
        animatable: true
      },
      softness: {
        type: "number",
        label: "Softness",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      roundness: {
        type: "number",
        label: "Roundness",
        default: 1,
        min: 0.5,
        max: 2,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p) => new Float32Array([
      p.amount ?? 0.5,
      p.size ?? 0.5,
      p.softness ?? 0.5,
      p.roundness ?? 1
    ])
  };
  var grain = {
    id: "gpu-grain",
    name: "Film Grain",
    category: "stylize",
    entryPoint: "grainFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct GrainParams { amount: f32, size: f32, speed: f32, time: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: GrainParams;
fn grainNoise(uv: vec2f, t: f32) -> f32 {
  let seed = uv + vec2f(t * 0.1, t * 0.07);
  return fract(sin(dot(seed, vec2f(12.9898, 78.233))) * 43758.5453);
}
@fragment
fn grainFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let grainUV = input.uv * (100.0 / params.size);
  // Wrap the time seed: the sin() inside grainNoise loses precision once the
  // unbounded (time * speed) term grows large, freezing the grain over long
  // sessions. The 600s period is imperceptible but keeps the seed bounded.
  let gt = params.time * params.speed;
  let noise = grainNoise(grainUV, gt - floor(gt / 600.0) * 600.0) * 2.0 - 1.0;
  let luma = luminance(color.rgb);
  let grainIntensity = params.amount * (1.0 - luma * 0.5);
  let grainColor = color.rgb + vec3f(noise * grainIntensity);
  return vec4f(clamp(grainColor, vec3f(0.0), vec3f(1.0)), color.a);
}`
    ),
    params: {
      amount: {
        type: "number",
        label: "Amount",
        default: 0.1,
        min: 0,
        max: 0.5,
        step: 0.01,
        animatable: true
      },
      size: {
        type: "number",
        label: "Size",
        default: 1,
        min: 0.5,
        max: 5,
        step: 0.1,
        animatable: true
      },
      speed: {
        type: "number",
        label: "Speed",
        default: 1,
        min: 0,
        max: 5,
        step: 0.1,
        animatable: false
      }
    },
    packUniforms: (p) => {
      const time = typeof p.__time === "number" ? p.__time : 0;
      return new Float32Array([
        p.amount ?? 0.1,
        p.size ?? 1,
        p.speed ?? 1,
        time
      ]);
    }
  };
  var sharpen = {
    id: "gpu-sharpen",
    name: "Sharpen",
    category: "stylize",
    entryPoint: "sharpenFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct SharpenParams { amount: f32, radius: f32, width: f32, height: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: SharpenParams;
@fragment
fn sharpenFragment(input: VertexOutput) -> @location(0) vec4f {
  let texelSize = vec2f(1.0 / params.width, 1.0 / params.height);
  let center = textureSample(inputTex, texSampler, input.uv);
  var blur = vec4f(0.0);
  var totalWeight = 0.0;
  let samples = 3;
  let sigma = params.radius * 0.5 + 0.5;
  for (var x = -samples; x <= samples; x++) {
    for (var y = -samples; y <= samples; y++) {
      let offset = vec2f(f32(x), f32(y)) * texelSize * params.radius;
      let distSq = f32(x * x + y * y);
      let weight = exp(-distSq / (2.0 * sigma * sigma));
      blur += textureSample(inputTex, texSampler, input.uv + offset) * weight;
      totalWeight += weight;
    }
  }
  blur /= totalWeight;
  let sharpened = center.rgb + (center.rgb - blur.rgb) * params.amount;
  return vec4f(clamp(sharpened, vec3f(0.0), vec3f(1.0)), center.a);
}`
    ),
    params: {
      amount: {
        type: "number",
        label: "Amount",
        default: 1,
        min: 0,
        max: 5,
        step: 0.1,
        animatable: true
      },
      radius: {
        type: "number",
        label: "Radius",
        default: 1,
        min: 0.5,
        max: 5,
        step: 0.1,
        animatable: true
      }
    },
    packUniforms: (p, w, h) => new Float32Array([p.amount ?? 1, p.radius ?? 1, w, h])
  };
  var posterize = {
    id: "gpu-posterize",
    name: "Posterize",
    category: "stylize",
    entryPoint: "posterizeFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct PosterizeParams { levels: f32, _p1: f32, _p2: f32, _p3: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: PosterizeParams;
@fragment
fn posterizeFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let levels = max(params.levels, 2.0);
  let posterized = floor(color.rgb * levels) / (levels - 1.0);
  return vec4f(posterized, color.a);
}`
    ),
    params: {
      levels: {
        type: "number",
        label: "Levels",
        default: 6,
        min: 2,
        max: 32,
        step: 1,
        animatable: true
      }
    },
    packUniforms: (p) => new Float32Array([p.levels ?? 6, 0, 0, 0])
  };
  var glow = {
    id: "gpu-glow",
    name: "Glow",
    category: "stylize",
    entryPoint: "glowFragment",
    uniformSize: 32,
    shader: (
      /* wgsl */
      `
struct GlowParams {
  amount: f32, threshold: f32, radius: f32, softness: f32,
  width: f32, height: f32, rings: f32, samplesPerRing: f32,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: GlowParams;
@fragment
fn glowFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let texelSize = vec2f(1.0 / params.width, 1.0 / params.height);
  var glowVal = vec3f(0.0);
  var totalWeight = 0.0;
  let rings = i32(clamp(params.rings, 1.0, 32.0));
  let samplesPerRing = i32(clamp(params.samplesPerRing, 4.0, 64.0));
  for (var ring = 1; ring <= rings; ring++) {
    let ringRadius = f32(ring) * params.radius * texelSize.x * 10.0;
    let ringWeight = gaussian(f32(ring) / f32(rings), params.softness + 0.3);
    for (var i = 0; i < samplesPerRing; i++) {
      let angle = f32(i) * TAU / f32(samplesPerRing) + f32(ring) * 0.5;
      let offset = vec2f(cos(angle), sin(angle)) * ringRadius;
      let sampleColor = textureSample(inputTex, texSampler, input.uv + offset);
      let sampleLuma = luminance(sampleColor.rgb);
      let brightFactor = smoothstep(params.threshold - 0.1, params.threshold + 0.1, sampleLuma);
      let brightColor = sampleColor.rgb * brightFactor;
      glowVal += brightColor * ringWeight;
      totalWeight += ringWeight;
    }
  }
  let centerLuma = luminance(color.rgb);
  let centerBright = smoothstep(params.threshold - 0.1, params.threshold + 0.1, centerLuma);
  glowVal += color.rgb * centerBright * 2.0;
  totalWeight += 2.0;
  glowVal /= totalWeight;
  let result = color.rgb + glowVal * params.amount * 2.0;
  return vec4f(clamp(result, vec3f(0.0), vec3f(1.0)), color.a);
}`
    ),
    params: {
      amount: {
        type: "number",
        label: "Amount",
        default: 1,
        min: 0,
        max: 5,
        step: 0.1,
        animatable: true
      },
      threshold: {
        type: "number",
        label: "Threshold",
        default: 0.6,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      radius: {
        type: "number",
        label: "Radius",
        default: 20,
        min: 1,
        max: 100,
        step: 1,
        animatable: true
      },
      softness: {
        type: "number",
        label: "Softness",
        default: 0.5,
        min: 0.1,
        max: 1,
        step: 0.05,
        animatable: true
      },
      rings: {
        type: "number",
        label: "Rings",
        default: 4,
        min: 1,
        max: 32,
        step: 1,
        animatable: false,
        quality: true
      },
      samplesPerRing: {
        type: "number",
        label: "Samples/Ring",
        default: 16,
        min: 4,
        max: 64,
        step: 1,
        animatable: false,
        quality: true
      }
    },
    packUniforms: (p, w, h) => new Float32Array([
      p.amount ?? 1,
      p.threshold ?? 0.6,
      p.radius ?? 20,
      p.softness ?? 0.5,
      w,
      h,
      p.rings ?? 4,
      p.samplesPerRing ?? 16
    ])
  };
  var edgeDetect = {
    id: "gpu-edge-detect",
    name: "Edge Detect",
    category: "stylize",
    entryPoint: "edgeDetectFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct EdgeDetectParams { strength: f32, width: f32, height: f32, invertFlag: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: EdgeDetectParams;
@fragment
fn edgeDetectFragment(input: VertexOutput) -> @location(0) vec4f {
  let texelSize = vec2f(1.0 / params.width, 1.0 / params.height);
  let tl = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(-texelSize.x, -texelSize.y)).rgb);
  let t  = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(0.0, -texelSize.y)).rgb);
  let tr = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(texelSize.x, -texelSize.y)).rgb);
  let l  = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(-texelSize.x, 0.0)).rgb);
  let r  = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(texelSize.x, 0.0)).rgb);
  let bl = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(-texelSize.x, texelSize.y)).rgb);
  let b  = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(0.0, texelSize.y)).rgb);
  let br = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(texelSize.x, texelSize.y)).rgb);
  let gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
  let gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
  var edge = sqrt(gx*gx + gy*gy) * params.strength;
  edge = clamp(edge, 0.0, 1.0);
  if (params.invertFlag > 0.5) { edge = 1.0 - edge; }
  return vec4f(vec3f(edge), 1.0);
}`
    ),
    params: {
      strength: {
        type: "number",
        label: "Strength",
        default: 1,
        min: 0,
        max: 5,
        step: 0.1,
        animatable: true
      },
      invert: { type: "boolean", label: "Invert", default: false }
    },
    packUniforms: (p, w, h) => new Float32Array([p.strength ?? 1, w, h, p.invert ? 1 : 0])
  };
  var scanlines = {
    id: "gpu-scanlines",
    name: "Scanlines",
    category: "stylize",
    entryPoint: "scanlinesFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct ScanlinesParams { density: f32, opacity: f32, speed: f32, time: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: ScanlinesParams;
@fragment
fn scanlinesFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let scrollOffset = params.time * params.speed * 0.1;
  let scanline = sin((input.uv.y + scrollOffset) * params.density * 100.0) * 0.5 + 0.5;
  let darken = 1.0 - params.opacity * (1.0 - scanline);
  return vec4f(color.rgb * darken, color.a);
}`
    ),
    params: {
      density: {
        type: "number",
        label: "Density",
        default: 5,
        min: 1,
        max: 20,
        step: 0.5,
        animatable: true
      },
      opacity: {
        type: "number",
        label: "Opacity",
        default: 0.3,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      speed: {
        type: "number",
        label: "Scroll Speed",
        default: 0,
        min: 0,
        max: 5,
        step: 0.1,
        animatable: false
      }
    },
    packUniforms: (p) => {
      const time = typeof p.__time === "number" ? p.__time : 0;
      return new Float32Array([
        p.density ?? 5,
        p.opacity ?? 0.3,
        p.speed ?? 0,
        time
      ]);
    }
  };
  var colorGlitch = {
    id: "gpu-color-glitch",
    name: "Color Glitch",
    category: "stylize",
    entryPoint: "colorGlitchFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct ColorGlitchParams { intensity: f32, speed: f32, time: f32, _pad: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: ColorGlitchParams;
@fragment
fn colorGlitchFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let amt = clamp(params.intensity, 0.0, 1.0);

  // Discrete time steps give the stuttering digital-glitch cadence and keep the
  // look readable even when playback is paused (the seed stays fixed per step).
  // The seed MUST be wrapped into a small range: the shared sin() hash loses all
  // precision with large inputs, so an unbounded (time * speed) seed collapses
  // bandNoise to a constant at higher speeds / long sessions and the effect looks
  // frozen. Wrapping keeps the seed usable at any speed.
  let rawStep = floor(params.time * params.speed * 12.0);
  let t = rawStep - floor(rawStep / 64.0) * 64.0;

  // Tear the frame into horizontal bands; each band glitches independently.
  let band = floor(uv.y * 28.0);
  let bandNoise = hash(vec2f(band, t));

  // More bands corrupt as intensity rises (full frame at intensity = 1).
  let glitchOn = step(1.0 - amt, bandNoise);

  // Per-band horizontal block displacement.
  let shift = (hash(vec2f(band * 1.7, t + 3.0)) - 0.5) * 0.15 * amt * glitchOn;

  // RGB channel separation \u2014 the signature colour-glitch fringing, scaled so even
  // a single still frame reads clearly.
  let split = (0.004 + 0.02 * amt) * glitchOn;
  let baseUv = vec2f(uv.x + shift, uv.y);
  let r = textureSample(inputTex, texSampler, baseUv + vec2f(split, 0.0)).r;
  let g = textureSample(inputTex, texSampler, baseUv).g;
  let b = textureSample(inputTex, texSampler, baseUv - vec2f(split, 0.0)).b;
  let a = textureSample(inputTex, texSampler, baseUv).a;
  var rgb = vec3f(r, g, b);

  // Hard hue corruption on the strongest bands for the "colour" in colour glitch.
  let hueHit = step(0.82, bandNoise) * glitchOn;
  var hsv = rgb2hsv(rgb);
  hsv.x = fract(hsv.x + hash(vec2f(band, t + 7.0)));
  rgb = mix(rgb, hsv2rgb(hsv), hueHit);

  return vec4f(rgb, a);
}`
    ),
    params: {
      intensity: {
        type: "number",
        label: "Intensity",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      speed: {
        type: "number",
        label: "Speed",
        default: 1,
        min: 0.1,
        max: 5,
        step: 0.1,
        animatable: false
      }
    },
    packUniforms: (p) => {
      const time = typeof p.__time === "number" ? p.__time : 0;
      return new Float32Array([p.intensity ?? 0.5, p.speed ?? 1, time, 0]);
    }
  };
  var blockGlitch = {
    id: "gpu-block-glitch",
    name: "Block Glitch",
    category: "stylize",
    entryPoint: "blockGlitchFragment",
    uniformSize: 32,
    shader: (
      /* wgsl */
      `
struct BlockGlitchParams {
  coverage: f32, intensity: f32, blockSize: f32, speed: f32,
  time: f32, width: f32, height: f32, pad: f32
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: BlockGlitchParams;
@fragment
fn blockGlitchFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let amt = clamp(params.intensity, 0.0, 1.0);
  let cov = clamp(params.coverage, 0.0, 1.0);

  // Discrete, wrapped time step \u2014 keeps the sin() hash seed in its precise range
  // so the glitch stays alive at any speed / session length.
  let rawStep = floor(params.time * params.speed * 8.0);
  let t = rawStep - floor(rawStep / 64.0) * 64.0;

  // Block grid in pixels.
  let cell = max(params.blockSize, 2.0);
  let cols = max(params.width / cell, 1.0);
  let rows = max(params.height / cell, 1.0);
  let block = vec2f(floor(uv.x * cols), floor(uv.y * rows));

  // Per-block, per-step decision: does this block glitch?
  let r1 = hash(vec2f(block.x + block.y * 3.0, t));
  let glitchOn = step(1.0 - cov, r1);

  // Block displacement: a horizontal datamosh slab plus a smaller vertical jump.
  let dispX = (hash(vec2f(block.y, t + 5.0)) - 0.5) * 0.25 * amt * glitchOn;
  let vJump = step(0.6, hash(vec2f(block.x + block.y, t + 13.0)));
  let dispY = (hash(vec2f(block.x, t + 9.0)) - 0.5) * 0.06 * amt * glitchOn * vJump;
  let srcUv = vec2f(uv.x + dispX, uv.y + dispY);

  // RGB channel split on glitched blocks.
  let split = (0.01 + 0.03 * amt) * glitchOn;
  let rr = textureSample(inputTex, texSampler, srcUv + vec2f(split, 0.0)).r;
  let gg = textureSample(inputTex, texSampler, srcUv).g;
  let bb = textureSample(inputTex, texSampler, srcUv - vec2f(split, 0.0)).b;
  let aa = textureSample(inputTex, texSampler, srcUv).a;
  let rgb = vec3f(rr, gg, bb);

  // Digital corruption on a subset of glitched blocks: channel rotate / invert /
  // posterize. Sampling already done above, so this control flow is safe.
  let corrupt = step(0.7, hash(vec2f(block.x * 1.3 + block.y, t + 21.0))) * glitchOn;
  let mode = hash(vec2f(block.y * 2.1 + block.x, t + 27.0));
  var c = rgb;
  if (mode < 0.34) {
    c = rgb.gbr;
  } else if (mode < 0.67) {
    c = vec3f(1.0) - rgb;
  } else {
    c = floor(rgb * 4.0) / 4.0;
  }

  return vec4f(mix(rgb, c, corrupt), aa);
}`
    ),
    params: {
      coverage: {
        type: "number",
        label: "Coverage",
        default: 0.3,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      intensity: {
        type: "number",
        label: "Intensity",
        default: 0.6,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      blockSize: {
        type: "number",
        label: "Block Size",
        default: 40,
        min: 8,
        max: 200,
        step: 1,
        animatable: true
      },
      speed: {
        type: "number",
        label: "Speed",
        default: 1,
        min: 0.1,
        max: 5,
        step: 0.1,
        animatable: false
      }
    },
    packUniforms: (p, w, h) => new Float32Array([
      p.coverage ?? 0.3,
      p.intensity ?? 0.6,
      p.blockSize ?? 40,
      p.speed ?? 1,
      typeof p.__time === "number" ? p.__time : 0,
      w,
      h,
      0
    ])
  };
  var crt = {
    id: "gpu-crt",
    name: "CRT",
    category: "stylize",
    entryPoint: "crtFragment",
    uniformSize: 32,
    shader: (
      /* wgsl */
      `
struct CrtParams {
  curvature: f32, scanlines: f32, vignette: f32, chroma: f32,
  width: f32, height: f32, pad0: f32, pad1: f32
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: CrtParams;
@fragment
fn crtFragment(input: VertexOutput) -> @location(0) vec4f {
  // Barrel-warp the sampling coordinate around the screen centre.
  let curveAmt = clamp(params.curvature, 0.0, 1.0) * 0.35;
  let cc = input.uv * 2.0 - 1.0;
  let r2 = dot(cc, cc);
  let warped = cc * (1.0 + r2 * curveAmt);
  let cuv = warped * 0.5 + 0.5;

  // Soft black border where the warped image leaves the tube.
  let edge = 0.004 + curveAmt * 0.02;
  let mask = smoothstep(0.0, edge, cuv.x) * smoothstep(0.0, edge, 1.0 - cuv.x)
           * smoothstep(0.0, edge, cuv.y) * smoothstep(0.0, edge, 1.0 - cuv.y);

  // Chromatic aberration that grows toward the edges.
  let ca = params.chroma * 0.012 * r2;
  let dir = normalize(cc + vec2f(0.00001, 0.00001));
  let rC = textureSample(inputTex, texSampler, cuv + dir * ca).r;
  let gC = textureSample(inputTex, texSampler, cuv).g;
  let bC = textureSample(inputTex, texSampler, cuv - dir * ca).b;
  let aC = textureSample(inputTex, texSampler, cuv).a;
  var rgb = vec3f(rC, gC, bC);

  // Scanlines (resolution-independent line count).
  let sl = 0.5 + 0.5 * sin(cuv.y * 320.0 * PI);
  rgb = rgb * (1.0 - clamp(params.scanlines, 0.0, 1.0) * (1.0 - sl));

  // Vignette toward the corners.
  rgb = rgb * (1.0 - clamp(params.vignette, 0.0, 1.0) * smoothstep(0.35, 1.5, r2));

  return vec4f(rgb * mask, aC);
}`
    ),
    params: {
      curvature: {
        type: "number",
        label: "Curvature",
        default: 0.3,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      scanlines: {
        type: "number",
        label: "Scanlines",
        default: 0.3,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      vignette: {
        type: "number",
        label: "Vignette",
        default: 0.3,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      chroma: {
        type: "number",
        label: "Chroma",
        default: 0.4,
        min: 0,
        max: 2,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p, w, h) => new Float32Array([
      p.curvature ?? 0.3,
      p.scanlines ?? 0.3,
      p.vignette ?? 0.3,
      p.chroma ?? 0.4,
      w,
      h,
      0,
      0
    ])
  };
  function clamp01(value) {
    return Math.min(1, Math.max(0, value));
  }
  function parseHexColor2(color, fallback) {
    if (!color.startsWith("#")) return fallback;
    const hex = color.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const values = hex.split("").map((ch) => parseInt(ch + ch, 16) / 255);
      return [
        values[0] ?? fallback[0],
        values[1] ?? fallback[1],
        values[2] ?? fallback[2],
        values[3] ?? 1
      ];
    }
    if (hex.length === 6 || hex.length === 8) {
      const values = [
        parseInt(hex.slice(0, 2), 16) / 255,
        parseInt(hex.slice(2, 4), 16) / 255,
        parseInt(hex.slice(4, 6), 16) / 255,
        hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
      ];
      if (values.every((value) => Number.isFinite(value))) {
        return values;
      }
    }
    return fallback;
  }
  function legacySpacingToPaperSize(spacing, height) {
    if (!spacing || spacing <= 0 || !Number.isFinite(spacing)) return 0.5;
    const cellsPerSide = Math.max(7, Math.min(300, height / spacing));
    const normalized = clamp01((300 - cellsPerSide) / 293);
    return Math.pow(normalized, 1 / 0.7);
  }
  function legacyDotRatioToRadius(dotSize, spacing) {
    if (!dotSize || !spacing || spacing <= 0) return 1.25;
    return Math.max(0, Math.min(2, dotSize / spacing * 2));
  }
  var halftone = {
    id: "gpu-halftone",
    name: "Halftone",
    category: "stylize",
    entryPoint: "halftoneFragment",
    uniformSize: 80,
    shader: (
      /* wgsl */
      `
struct HalftoneParams {
  colorFront: vec4f,
  colorBack: vec4f,
  primary: vec4f,
  secondary: vec4f,
  tertiary: vec4f,
};

struct HalftoneSample {
  shape: f32,
  color: vec4f,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: HalftoneParams;

fn rotateHalftonePoint(p: vec2f, angleRad: f32) -> vec2f {
  let c = cos(angleRad);
  let s = sin(angleRad);
  return vec2f(p.x * c - p.y * s, p.x * s + p.y * c);
}

fn halftoneLinearStep(edge0: f32, edge1: f32, x: f32) -> f32 {
  return clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
}

fn halftoneSmoothStep(edge0: f32, edge1: f32, x: f32) -> f32 {
  return smoothstep(edge0, edge1, x);
}

fn halftoneSigmoid(x: f32, k: f32) -> f32 {
  return 1.0 / (1.0 + exp(-k * (x - 0.5)));
}

fn getCircle(uv: vec2f, r: f32, baseR: f32) -> f32 {
  let rr = mix(0.25 * baseR, 0.0, r);
  let d = length(uv - 0.5);
  let aa = 0.02;
  return 1.0 - smoothstep(rr - aa, rr + aa, d);
}

fn getCell(uv: vec2f) -> f32 {
  let insideX = step(0.0, uv.x) * (1.0 - step(1.0, uv.x));
  let insideY = step(0.0, uv.y) * (1.0 - step(1.0, uv.y));
  return insideX * insideY;
}

fn getCircleWithHole(uv: vec2f, r: f32, baseR: f32) -> f32 {
  let cell = getCell(uv);
  let rr = mix(0.75 * baseR, 0.0, r);
  let rMod = rr - floor(rr / 0.5) * 0.5;
  let d = length(uv - 0.5);
  let aa = 0.02;
  let circle = 1.0 - smoothstep(rMod - aa, rMod + aa, d);
  if (rr < 0.5) {
    return circle;
  }
  return cell - circle;
}

fn getGooeyBall(uv: vec2f, r: f32, baseR: f32, gridType: i32) -> f32 {
  var d = length(uv - 0.5);
  var sizeRadius = 0.3;
  if (gridType == 1) {
    sizeRadius = 0.42;
  }
  sizeRadius = mix(sizeRadius * baseR, 0.0, r);
  d = 1.0 - halftoneSmoothStep(0.0, sizeRadius, d);
  d = pow(d, 2.0 + baseR);
  return d;
}

fn getSoftBall(uv: vec2f, r: f32, baseR: f32) -> f32 {
  var d = length(uv - 0.5);
  var sizeRadius = clamp(baseR, 0.0, 1.0);
  sizeRadius = mix(0.5 * sizeRadius, 0.0, r);
  d = 1.0 - halftoneLinearStep(0.0, sizeRadius, d);
  let powRadius = 1.0 - halftoneLinearStep(0.0, 2.0, baseR);
  d = pow(d, 4.0 + 3.0 * powRadius);
  return d;
}

fn getLumAtPx(uv: vec2f, contrast: f32, inverted: bool) -> f32 {
  let tex = textureSampleLevel(inputTex, texSampler, uv, 0.0);
  if (tex.a <= 1e-4) {
    return select(0.0, 1.0, inverted);
  }
  let color = vec3f(
    halftoneSigmoid(tex.r, contrast),
    halftoneSigmoid(tex.g, contrast),
    halftoneSigmoid(tex.b, contrast)
  );
  var lum = luminance(color);
  if (inverted) {
    lum = 1.0 - lum;
  }
  return lum;
}

fn getLumBall(
  p: vec2f,
  pad: vec2f,
  texelSize: vec2f,
  inCellOffset: vec2f,
  contrast: f32,
  baseR: f32,
  stepSize: f32,
  styleType: i32,
  gridType: i32,
  inverted: bool,
  grainMixer: f32,
  grainSizeParam: f32
) -> HalftoneSample {
  let pp = p + inCellOffset;
  let uv_i = floor(pp);
  let uv_f = fract(pp);
  let samplingUV = (uv_i + 0.5 - inCellOffset) * pad + 0.5;
  let safeSamplingUV = clamp(samplingUV, texelSize * 0.5, vec2f(1.0) - texelSize * 0.5);
  var lum = getLumAtPx(safeSamplingUV, contrast, inverted);
  if (grainMixer > 0.001) {
    let grainSizeCurve = pow(grainSizeParam, 0.72);
    let grainDomainScale = mix(2600.0, 55.0, grainSizeCurve);
    let grainDomain = safeSamplingUV * grainDomainScale + inCellOffset * 37.0 + vec2f(21.0, -14.0);
    let grainPrimary = halftoneOverlayNoise(grainDomain * mix(1.15, 0.2, grainSizeCurve));
    let grainSecondary = halftoneNoise(
      grainDomain * mix(2.1, 0.38, grainSizeCurve) +
      uv_f * mix(14.0, 4.0, grainSizeCurve)
    );
    let edgeWeight = 1.0 - abs(lum * 2.0 - 1.0);
    let lumJitter = (grainSecondary * 2.0 - 1.0) * (0.08 + 0.32 * grainMixer) * (0.3 + 0.7 * edgeWeight);
    let lumCut = smoothstep(0.45, 0.85 - 0.2 * grainMixer, grainPrimary) * grainMixer * (0.1 + 0.8 * edgeWeight);
    lum = clamp(lum + lumJitter - lumCut, 0.0, 1.0);
  }
  let sampledColor = textureSampleLevel(inputTex, texSampler, safeSamplingUV, 0.0);
  let sourceCoverage = sampledColor.a;
  if (sourceCoverage <= 1e-4) {
    return HalftoneSample(0.0, vec4f(0.0));
  }
  var ballColor = vec4f(sampledColor.rgb * sourceCoverage, sourceCoverage);
  var ball = 0.0;
  if (styleType == 0) {
    ball = getCircle(uv_f, lum, baseR);
  } else if (styleType == 1) {
    ball = getGooeyBall(uv_f, lum, baseR, gridType);
  } else if (styleType == 2) {
    ball = getCircleWithHole(uv_f, lum, baseR);
  } else {
    ball = getSoftBall(uv_f, lum, baseR);
  }
  return HalftoneSample(ball * sourceCoverage, ballColor);
}

fn halftoneNoise(p: vec2f) -> f32 {
  let layerA = noise2d(p);
  let layerB = noise2d(vec2f(
    p.x * 1.31 + p.y * 0.74,
    p.x * -0.68 + p.y * 1.27
  ) + vec2f(11.7, 3.9));
  let layerC = noise2d(vec2f(
    p.x * -0.57 + p.y * 1.43,
    p.x * 1.19 + p.y * 0.53
  ) + vec2f(-7.4, 13.1));
  return (layerA + layerB + layerC) / 3.0;
}

fn halftoneOverlayNoise(p: vec2f) -> f32 {
  let coarse = halftoneNoise(p * 0.73 + vec2f(5.31, -8.17));
  let medium = halftoneNoise(vec2f(
    p.x * 1.41 - p.y * 0.52,
    p.x * 0.67 + p.y * 1.28
  ) + vec2f(-11.4, 4.6));
  let fine = halftoneNoise(vec2f(
    p.x * -0.88 + p.y * 1.19,
    p.x * -1.07 - p.y * 0.79
  ) + vec2f(8.2, 10.7));
  return coarse * 0.45 + medium * 0.35 + fine * 0.2;
}

fn getStepCount(styleType: i32) -> i32 {
  if (styleType == 1) {
    return 6;
  }
  if (styleType == 3) {
    return 6;
  }
  if (styleType == 0) {
    return 2;
  }
  return 1;
}

@fragment
fn halftoneFragment(input: VertexOutput) -> @location(0) vec4f {
  let sourceSample = textureSampleLevel(inputTex, texSampler, input.uv, 0.0);
  let sourceAlpha = sourceSample.a;
  if (sourceAlpha <= 1e-4) {
    return vec4f(0.0);
  }

  let dims = vec2f(textureDimensions(inputTex));
  let aspect = max(dims.x / max(dims.y, 1.0), 0.0001);
  let size = clamp(params.primary.x, 0.0, 1.0);
  let radius = clamp(params.primary.y, 0.0, 2.0);
  let contrastParam = clamp(params.primary.z, 0.0, 1.0);
  let originalColors = params.secondary.x > 0.5;
  let inverted = params.secondary.y > 0.5;
  let grainMixer = clamp(params.secondary.z, 0.0, 1.0);
  let grainOverlay = clamp(params.secondary.w, 0.0, 1.0);
  let grainSizeParam = clamp(params.tertiary.x, 0.0, 1.0);
  let gridType = i32(params.tertiary.y);
  let styleType = i32(params.tertiary.z);

  let stepCount = getStepCount(styleType);
  let stepSize = 1.0 / f32(stepCount);

  var cellsPerSide = mix(300.0, 7.0, pow(size, 0.7));
  cellsPerSide /= f32(stepCount);
  let cellSizeY = 1.0 / cellsPerSide;
  var pad = cellSizeY * vec2f(1.0 / aspect, 1.0);
  if (styleType == 1 && gridType == 1) {
    pad *= 0.7;
  }
  // Snap to whole cells AND force odd counts.  With an odd cell count the
  // centered grid puts uv = \xB1N.5 at the texture edges, which lands at
  // fract = 0.5 \u2014 right on the dot center.  Even counts land at fract = 0
  // (cell boundary), exposing the paper/background as a rectangular border.
  var rawCols = max(1.0, round(1.0 / max(pad.x, 1e-4)));
  var rawRows = max(1.0, round(1.0 / max(pad.y, 1e-4)));
  let cols = rawCols + select(0.0, 1.0, fract(rawCols * 0.5) < 0.25);
  let rows = rawRows + select(0.0, 1.0, fract(rawRows * 0.5) < 0.25);
  pad = vec2f(1.0 / cols, 1.0 / rows);
  let texelSize = 1.0 / max(dims, vec2f(1.0));

  var uv = input.uv - 0.5;
  uv /= pad;

  var contrast = mix(0.0, 15.0, pow(contrastParam, 1.5));
  var baseRadius = radius;
  if (originalColors) {
    contrast = mix(0.1, 4.0, pow(contrastParam, 2.0));
    baseRadius = 2.0 * pow(0.5 * radius, 0.3);
  }

  var totalShape = 0.0;
  var totalColor = vec3f(0.0);
  var totalOpacity = 0.0;

  for (var xi = 0; xi < 6; xi = xi + 1) {
    if (xi >= stepCount) {
      continue;
    }

    for (var yi = 0; yi < 6; yi = yi + 1) {
      if (yi >= stepCount) {
        continue;
      }

      var offset = vec2f(f32(xi) / f32(stepCount) - 0.5, f32(yi) / f32(stepCount) - 0.5);
      if (gridType == 1) {
        var rowIndex = f32(yi);
        var colIndex = f32(xi);
        if (stepCount == 1) {
          rowIndex = floor(uv.y + offset.y + 1.0);
          if (styleType == 1) {
            colIndex = floor(uv.x + offset.x + 1.0);
          }
        }
        if (styleType == 1) {
          if (fract((rowIndex + colIndex) * 0.5) >= 0.5) {
            continue;
          }
        } else if (fract(rowIndex * 0.5) >= 0.5) {
          offset.x += 0.5 * stepSize;
        }
      }

      let sample = getLumBall(
        uv,
        pad,
        texelSize,
        offset,
        contrast,
        baseRadius,
        stepSize,
        styleType,
        gridType,
        inverted,
        grainMixer,
        grainSizeParam
      );
      totalColor += sample.color.rgb * sample.shape;
      totalShape += sample.shape;
      totalOpacity += sample.shape;
    }
  }

  let eps = 1e-4;
  totalColor /= max(totalShape, eps);
  totalOpacity /= max(totalShape, eps);

  var finalShape = 0.0;
  if (styleType == 0) {
    finalShape = min(1.0, totalShape);
  } else if (styleType == 1) {
    let aa = 0.08;
    finalShape = smoothstep(0.5 - aa, 0.5 + aa, totalShape);
  } else if (styleType == 2) {
    finalShape = min(1.0, totalShape);
  } else {
    finalShape = totalShape;
  }

  let grainSizeCurve = pow(grainSizeParam, 0.72);
  let grainScale = mix(3200.0, 42.0, grainSizeCurve) * vec2f(1.0, 1.0 / aspect);
  let grainUV = input.uv * grainScale + vec2f(13.1, -9.7);
  let edgeBand = pow(clamp(1.0 - abs(finalShape * 2.0 - 1.0), 0.0, 1.0), 0.55);
  let grainField = halftoneOverlayNoise(grainUV * mix(0.95, 0.16, grainSizeCurve));
  let grainDetail = halftoneNoise(
    grainUV * mix(1.9, 0.28, grainSizeCurve) +
    vec2f(-17.3, 6.4)
  );
  let grainCut = smoothstep(0.42, 0.9, grainField);
  let grainWarp = (grainDetail * 2.0 - 1.0) * edgeBand * grainMixer * 0.24;
  let grainErode = edgeBand * grainCut * grainMixer * (0.35 + 1.75 * grainMixer);
  finalShape = clamp(finalShape + grainWarp - grainErode, 0.0, 1.0);

  var color = vec3f(0.0);
  var opacity = 0.0;
  if (originalColors) {
    color = totalColor * finalShape;
    opacity = totalOpacity * finalShape;
    let bgColor = params.colorBack.rgb * params.colorBack.a;
    color += bgColor * (1.0 - opacity);
    opacity += params.colorBack.a * (1.0 - opacity);
  } else {
    let fgColor = params.colorFront.rgb * params.colorFront.a;
    let bgColor = params.colorBack.rgb * params.colorBack.a;
    color = fgColor * finalShape;
    opacity = params.colorFront.a * finalShape;
    color += bgColor * (1.0 - opacity);
    opacity += params.colorBack.a * (1.0 - opacity);
  }

  var grainOverlayNoise = halftoneOverlayNoise(grainUV * mix(0.9, 0.14, grainSizeCurve));
  grainOverlayNoise = pow(grainOverlayNoise, 1.3);
  let grainOverlayV = grainOverlayNoise * 2.0 - 1.0;
  let grainOverlayColor = vec3f(select(0.0, 1.0, grainOverlayV >= 0.0));
  var grainOverlayStrength = grainOverlay * abs(grainOverlayV);
  grainOverlayStrength = pow(grainOverlayStrength, 0.8);
  color = mix(color, grainOverlayColor, 0.5 * grainOverlayStrength);
  opacity += 0.5 * grainOverlayStrength;

  opacity = clamp(opacity, 0.0, 1.0) * sourceAlpha;

  // Output STRAIGHT alpha (RGB not premultiplied) \u2014 the final blit premultiplies
  // once for the premultiplied output canvas. Multiplying RGB by sourceAlpha here
  // too would premultiply twice on masked/transparent content (sourceAlpha^2),
  // darkening the mask edge into a visible seam. Opaque pixels (sourceAlpha = 1)
  // are unchanged.
  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), opacity);
}`
    ),
    params: {
      colorFront: { type: "color", label: "Front Color", default: "#2b2b2b", animatable: true },
      colorBack: { type: "color", label: "Back Color", default: "#f2f1e8", animatable: true },
      originalColors: { type: "boolean", label: "Original Colors", default: false },
      inverted: { type: "boolean", label: "Inverted", default: false },
      grid: {
        type: "select",
        label: "Grid",
        default: "hex",
        options: [
          { value: "hex", label: "Hex" },
          { value: "square", label: "Square" }
        ]
      },
      type: {
        type: "select",
        label: "Type",
        default: "gooey",
        options: [
          { value: "classic", label: "Classic" },
          { value: "gooey", label: "Gooey" },
          { value: "holes", label: "Holes" },
          { value: "soft", label: "Soft" }
        ]
      },
      size: {
        type: "number",
        label: "Size",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      radius: {
        type: "number",
        label: "Radius",
        default: 1.25,
        min: 0,
        max: 2,
        step: 0.01,
        animatable: true
      },
      contrast: {
        type: "number",
        label: "Contrast",
        default: 0.4,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      grainMixer: {
        type: "number",
        label: "Grain Mixer",
        default: 0.2,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      grainOverlay: {
        type: "number",
        label: "Grain Overlay",
        default: 0.2,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      grainSize: {
        type: "number",
        label: "Grain Size",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p, w, h) => {
      const gridMap = { square: 0, hex: 1 };
      const styleMap = { classic: 0, gooey: 1, holes: 2, soft: 3 };
      const colorFront = parseHexColor2(p.colorFront ?? "#2b2b2b", [
        43 / 255,
        43 / 255,
        43 / 255,
        1
      ]);
      const colorBack = parseHexColor2(p.colorBack ?? "#f2f1e8", [
        242 / 255,
        241 / 255,
        232 / 255,
        1
      ]);
      const size = p.size ?? legacySpacingToPaperSize(p.spacing, h);
      const radius = p.radius ?? legacyDotRatioToRadius(p.dotSize, p.spacing);
      const contrast2 = p.contrast ?? 0.4;
      const originalColors = p.originalColors ?? false;
      const inverted = p.inverted ?? p.invert ?? false;
      const grainMixer = p.grainMixer ?? 0.2;
      const grainOverlay = p.grainOverlay ?? 0.2;
      const grainSize = p.grainSize ?? 0.5;
      const grid = p.grid ?? "hex";
      const type = p.type ?? p.dotStyle ?? "gooey";
      return new Float32Array([
        colorFront[0],
        colorFront[1],
        colorFront[2],
        colorFront[3],
        colorBack[0],
        colorBack[1],
        colorBack[2],
        colorBack[3],
        size,
        radius,
        contrast2,
        w / Math.max(h, 1),
        originalColors ? 1 : 0,
        inverted ? 1 : 0,
        grainMixer,
        grainOverlay,
        grainSize,
        gridMap[grid] ?? 1,
        styleMap[type] ?? 1,
        0
      ]);
    }
  };
  var DITHER_PATTERN_MAP = {
    bayer2: 0,
    bayer4: 1,
    bayer8: 2,
    halftone: 3,
    lines: 4,
    crosses: 5,
    dots: 6,
    grid: 7,
    scales: 8
  };
  var DITHER_MODE_MAP = {
    image: 0,
    linear: 1,
    radial: 2
  };
  var DITHER_STYLE_MAP = {
    threshold: 0,
    scaled: 1
  };
  var DITHER_SHAPE_MAP = {
    circle: 0,
    square: 1,
    diamond: 2
  };
  var DITHER_PALETTE_MAP = {
    bw: 0,
    gameboy: 1,
    cga: 2,
    sepia: 3
  };
  var ASCII_CHARSET_MAP = {
    standard: 0,
    simple: 1,
    blocks: 2,
    dots: 3,
    minimal: 4
  };
  var ASCII_ATLAS_RAMPS = {
    ascii: "@%#*+=-:. ",
    dense: "@WB#$oahkbn+=-:. ",
    binary: "01",
    symbols: "#@&$%*+!=;:-. "
  };
  var ASCII_ATLAS_CELL = 24;
  var ASCII_ATLAS_MAX_GLYPHS = 64;
  var ASCII_FONT_STACK = {
    monospace: "monospace",
    courier: '"Courier New", Courier, monospace',
    consolas: 'Consolas, "Lucida Console", monospace',
    lucida: '"Lucida Console", Monaco, monospace'
  };
  function asciiAtlasRamp(charSet, customChars) {
    if (charSet === "custom") {
      const chars = [...customChars].slice(0, ASCII_ATLAS_MAX_GLYPHS);
      return chars.length > 0 ? chars.join("") : null;
    }
    return ASCII_ATLAS_RAMPS[charSet] ?? null;
  }
  function buildAsciiAtlas(ramp, font) {
    const chars = [...ramp].slice(0, ASCII_ATLAS_MAX_GLYPHS);
    const cell = ASCII_ATLAS_CELL;
    const n = Math.max(chars.length, 1);
    const width = n * cell;
    const height = cell;
    const data = new Uint8Array(width * height * 4);
    const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : null;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      data.fill(255);
      return { width, height, depth: 1, data };
    }
    const fontStack = ASCII_FONT_STACK[font] ?? ASCII_FONT_STACK.monospace;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.font = `${Math.round(cell * 0.82)}px ${fontStack}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i], i * cell + cell / 2, cell / 2 + 1);
    }
    const img = ctx.getImageData(0, 0, width, height).data;
    for (let i = 0; i < width * height; i++) {
      const a = img[i * 4 + 3] ?? 0;
      data[i * 4] = a;
      data[i * 4 + 1] = a;
      data[i * 4 + 2] = a;
      data[i * 4 + 3] = a;
    }
    return { width, height, depth: 1, data };
  }
  var dither = {
    id: "gpu-dither",
    name: "Dither",
    category: "stylize",
    entryPoint: "ditherFragment",
    uniformSize: 48,
    shader: (
      /* wgsl */
      `
struct DitherParams {
  cellSize: f32, angleDeg: f32, scalePercent: f32, width: f32,
  height: f32, offsetX: f32, offsetY: f32, patternKind: f32,
  modeKind: f32, styleKind: f32, shapeKind: f32, paletteKind: f32,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: DitherParams;

fn bayer2Threshold(cell: vec2i) -> f32 {
  let x = cell.x % 2;
  let y = cell.y % 2;
  var raw = 0.0;
  if (y == 0) {
    raw = select(0.0, 2.0, x == 1);
  } else {
    raw = select(3.0, 1.0, x == 1);
  }
  return (raw + 0.5) / 4.0;
}

fn bayer4Index(cell: vec2i) -> i32 {
  let x = cell.x % 4;
  let y = cell.y % 4;
  if (y == 0) {
    if (x == 0) { return 0; }
    if (x == 1) { return 8; }
    if (x == 2) { return 2; }
    return 10;
  }
  if (y == 1) {
    if (x == 0) { return 12; }
    if (x == 1) { return 4; }
    if (x == 2) { return 14; }
    return 6;
  }
  if (y == 2) {
    if (x == 0) { return 3; }
    if (x == 1) { return 11; }
    if (x == 2) { return 1; }
    return 9;
  }
  if (x == 0) { return 15; }
  if (x == 1) { return 7; }
  if (x == 2) { return 13; }
  return 5;
}

fn bayer4Threshold(cell: vec2i) -> f32 {
  return (f32(bayer4Index(cell)) + 0.5) / 16.0;
}

fn bayer8Threshold(cell: vec2i) -> f32 {
  let base = bayer4Index(vec2i(cell.x % 4, cell.y % 4));
  let quad = select(0, 1, (cell.x % 8) >= 4) + select(0, 2, (cell.y % 8) >= 4);
  let offset = select(0, select(2, select(3, 1, quad == 3), quad == 2), quad > 0);
  let raw = 4 * base + offset;
  return (f32(raw) + 0.5) / 64.0;
}

fn patternThreshold(patternKind: i32, cell: vec2f, patternCellSize: f32) -> f32 {
  if (patternKind == 0) {
    return bayer2Threshold(vec2i(cell));
  }
  if (patternKind == 1) {
    return bayer4Threshold(vec2i(cell));
  }
  if (patternKind == 2) {
    return bayer8Threshold(vec2i(cell));
  }

  let safeCellSize = max(2.0, patternCellSize);
  let nx = fract(cell.x / safeCellSize);
  let ny = fract(cell.y / safeCellSize);
  let cx = 0.5;
  let cy = 0.5;

  if (patternKind == 3 || patternKind == 6) {
    let dx = nx - cx;
    let dy = ny - cy;
    return sqrt(dx * dx + dy * dy) * 1.41421356237;
  }
  if (patternKind == 4) {
    return ny;
  }
  if (patternKind == 5) {
    let distX = abs(nx - cx);
    let distY = abs(ny - cy);
    return min(distX, distY) * 2.0;
  }
  if (patternKind == 7) {
    let distX = abs(nx - cx);
    let distY = abs(ny - cy);
    return max(distX, distY) * 2.0;
  }
  if (patternKind == 8) {
    let sx = fract(nx * 2.0);
    let sy = fract(ny * 2.0);
    let dx = sx - 0.5;
    let dy = sy - 0.5;
    return sqrt(dx * dx + dy * dy) * 1.41421356237;
  }
  return 0.5;
}

fn paletteLastIndex(paletteKind: i32) -> i32 {
  if (paletteKind == 0) { return 1; }
  return 3;
}

fn paletteIndex(value: f32, paletteKind: i32) -> i32 {
  if (paletteKind == 0) {
    return select(1, 0, value <= 0.5);
  }
  if (value <= 0.25) { return 0; }
  if (value <= 0.5) { return 1; }
  if (value <= 0.75) { return 2; }
  return 3;
}

fn paletteColor(paletteKind: i32, colorIndex: i32) -> vec3f {
  if (paletteKind == 0) {
    if (colorIndex == 0) { return vec3f(0.0, 0.0, 0.0); }
    return vec3f(1.0, 1.0, 1.0);
  }
  if (paletteKind == 1) {
    if (colorIndex == 0) { return vec3f(0.0588, 0.2196, 0.0588); }
    if (colorIndex == 1) { return vec3f(0.1882, 0.3843, 0.1882); }
    if (colorIndex == 2) { return vec3f(0.5451, 0.6745, 0.0588); }
    return vec3f(0.6078, 0.7373, 0.0588);
  }
  if (paletteKind == 2) {
    if (colorIndex == 0) { return vec3f(0.0, 0.0, 0.0); }
    if (colorIndex == 1) { return vec3f(0.3333, 1.0, 1.0); }
    if (colorIndex == 2) { return vec3f(1.0, 0.3333, 1.0); }
    return vec3f(1.0, 1.0, 1.0);
  }
  if (colorIndex == 0) { return vec3f(0.1686, 0.1137, 0.0549); }
  if (colorIndex == 1) { return vec3f(0.4196, 0.2588, 0.1490); }
  if (colorIndex == 2) { return vec3f(0.7686, 0.5843, 0.4157); }
  return vec3f(0.9608, 0.9020, 0.7843);
}

fn clampTexelCoord(coord: vec2i, texSize: vec2i) -> vec2i {
  return vec2i(
    clamp(coord.x, 0, max(texSize.x - 1, 0)),
    clamp(coord.y, 0, max(texSize.y - 1, 0))
  );
}

fn loadInputTexel(coord: vec2i, texSize: vec2i) -> vec4f {
  return textureLoad(inputTex, clampTexelCoord(coord, texSize), 0);
}

fn sampleCellBrightness(cell: vec2f, cellSize: f32, texSizeI: vec2i) -> f32 {
  let sampleOffsets = array<vec2f, 4>(
    vec2f(0.25, 0.25),
    vec2f(0.75, 0.25),
    vec2f(0.25, 0.75),
    vec2f(0.75, 0.75)
  );
  var luminanceSum = 0.0;
  var alphaSum = 0.0;
  for (var i = 0; i < 4; i++) {
    let sampleCoord = vec2i((cell + sampleOffsets[i]) * cellSize);
    let sampleColor = loadInputTexel(sampleCoord, texSizeI);
    luminanceSum += luminance601(sampleColor.rgb) * sampleColor.a;
    alphaSum += sampleColor.a;
  }
  if (alphaSum <= 0.0001) {
    return 0.0;
  }
  return luminanceSum / alphaSum;
}

fn applyMode(brightness: f32, cell: vec2f, gridSize: vec2f, modeKind: i32, angleDeg: f32, scalePercent: f32, offsetX: f32, offsetY: f32) -> f32 {
  var adjusted = brightness;
  let nx = cell.x / max(gridSize.x, 1.0);
  let ny = cell.y / max(gridSize.y, 1.0);
  if (modeKind == 1) {
    let angleRad = angleDeg * PI / 180.0;
    let gradient = nx * cos(angleRad) + ny * sin(angleRad);
    adjusted = clamp(adjusted * 0.7 + gradient * 0.3, 0.0, 1.0);
  } else if (modeKind == 2) {
    let ox = offsetX / 100.0;
    let oy = offsetY / 100.0;
    let dx = nx - (0.5 + ox);
    let dy = ny - (0.5 + oy);
    let dist = length(vec2f(dx, dy)) * (scalePercent / 100.0) * 2.0;
    adjusted = clamp(adjusted * 0.7 + dist * 0.3, 0.0, 1.0);
  }
  return adjusted;
}

fn shapeMask(shapeKind: i32, localUv: vec2f, sizeFactor: f32, cellSize: f32) -> f32 {
  let centered = abs(localUv - 0.5) * 2.0;
  let radius = clamp(sizeFactor, 0.0, 1.0);
  let aa = max(1.0 / max(cellSize, 1.0), 0.003);

  if (shapeKind == 0) {
    return 1.0 - smoothstep(radius, radius + aa, length(centered));
  }
  if (shapeKind == 2) {
    return 1.0 - smoothstep(radius, radius + aa, centered.x + centered.y);
  }
  return 1.0 - smoothstep(radius, radius + aa, max(centered.x, centered.y));
}

@fragment
fn ditherFragment(input: VertexOutput) -> @location(0) vec4f {
  let texSize = vec2f(params.width, params.height);
  let texSizeI = vec2i(max(i32(params.width), 1), max(i32(params.height), 1));
  let cellSize = max(params.cellSize, 1.0);
  let pixelPos = input.uv * texSize;
  let base = loadInputTexel(vec2i(pixelPos), texSizeI);
  if (base.a <= 0.0001) {
    return vec4f(0.0);
  }

  let cell = floor(pixelPos / cellSize);
  let localUv = fract(pixelPos / cellSize);
  let gridSize = vec2f(
    max(1.0, ceil(texSize.x / cellSize)),
    max(1.0, ceil(texSize.y / cellSize))
  );

  let modeKind = i32(params.modeKind + 0.5);
  let styleKind = i32(params.styleKind + 0.5);
  let shapeKind = i32(params.shapeKind + 0.5);
  let paletteKind = i32(params.paletteKind + 0.5);
  let patternKind = i32(params.patternKind + 0.5);

  var brightness = sampleCellBrightness(cell, cellSize, texSizeI);
  brightness = applyMode(
    brightness,
    cell,
    gridSize,
    modeKind,
    params.angleDeg,
    params.scalePercent,
    params.offsetX,
    params.offsetY
  );

  var quantized = brightness;
  var sizeFactor = 1.0;
  if (styleKind == 1) {
    sizeFactor = 1.0 - brightness;
  } else {
    let threshold = patternThreshold(patternKind, cell, max(2.0, floor(cellSize * 0.5)));
    quantized = clamp(brightness + (threshold - 0.5) * 0.5, 0.0, 1.0);
  }

  let colorIndex = paletteIndex(quantized, paletteKind);
  let background = paletteColor(paletteKind, paletteLastIndex(paletteKind));
  let foreground = paletteColor(paletteKind, colorIndex);
  let mask = shapeMask(shapeKind, localUv, sizeFactor, cellSize);
  let color = mix(background, foreground, mask);

  return vec4f(color, base.a);
}`
    ),
    params: {
      pattern: {
        type: "select",
        label: "Pattern",
        default: "bayer4",
        options: [
          { value: "bayer2", label: "Bayer 2x2" },
          { value: "bayer4", label: "Bayer 4x4" },
          { value: "bayer8", label: "Bayer 8x8" },
          { value: "halftone", label: "Halftone" },
          { value: "lines", label: "Lines" },
          { value: "crosses", label: "Crosses" },
          { value: "dots", label: "Dots" },
          { value: "grid", label: "Grid" },
          { value: "scales", label: "Scales" }
        ]
      },
      mode: {
        type: "select",
        label: "Mode",
        default: "image",
        options: [
          { value: "image", label: "Image" },
          { value: "linear", label: "Linear" },
          { value: "radial", label: "Radial" }
        ]
      },
      style: {
        type: "select",
        label: "Style",
        default: "threshold",
        options: [
          { value: "threshold", label: "Threshold" },
          { value: "scaled", label: "Scaled" }
        ]
      },
      shape: {
        type: "select",
        label: "Shape",
        default: "square",
        options: [
          { value: "circle", label: "Circle" },
          { value: "square", label: "Square" },
          { value: "diamond", label: "Diamond" }
        ]
      },
      palette: {
        type: "select",
        label: "Palette",
        default: "gameboy",
        options: [
          { value: "bw", label: "B&W" },
          { value: "gameboy", label: "Game Boy" },
          { value: "cga", label: "CGA" },
          { value: "sepia", label: "Sepia" }
        ]
      },
      cellSize: {
        type: "number",
        label: "Cell Size",
        default: 8,
        min: 2,
        max: 32,
        step: 1,
        animatable: true
      },
      angle: {
        type: "number",
        label: "Angle",
        default: 45,
        min: 0,
        max: 360,
        step: 1,
        animatable: true,
        visibleWhen: (params) => params.mode === "linear"
      },
      scale: {
        type: "number",
        label: "Scale",
        default: 100,
        min: 25,
        max: 200,
        step: 1,
        animatable: true,
        visibleWhen: (params) => params.mode === "radial"
      },
      offsetX: {
        type: "number",
        label: "Offset X",
        default: 0,
        min: -100,
        max: 100,
        step: 1,
        animatable: true,
        visibleWhen: (params) => params.mode === "radial"
      },
      offsetY: {
        type: "number",
        label: "Offset Y",
        default: 0,
        min: -100,
        max: 100,
        step: 1,
        animatable: true,
        visibleWhen: (params) => params.mode === "radial"
      }
    },
    packUniforms: (p, w, h) => new Float32Array([
      p.cellSize ?? 8,
      p.angle ?? 45,
      p.scale ?? 100,
      w,
      h,
      p.offsetX ?? 0,
      p.offsetY ?? 0,
      DITHER_PATTERN_MAP[p.pattern] ?? DITHER_PATTERN_MAP.bayer4 ?? 0,
      DITHER_MODE_MAP[p.mode] ?? DITHER_MODE_MAP.image ?? 0,
      DITHER_STYLE_MAP[p.style] ?? DITHER_STYLE_MAP.threshold ?? 0,
      DITHER_SHAPE_MAP[p.shape] ?? DITHER_SHAPE_MAP.square ?? 0,
      DITHER_PALETTE_MAP[p.palette] ?? DITHER_PALETTE_MAP.gameboy ?? 0
    ])
  };
  var ascii = {
    id: "gpu-ascii",
    name: "ASCII",
    category: "stylize",
    entryPoint: "asciiFragment",
    uniformSize: 96,
    shader: (
      /* wgsl */
      `
struct AsciiParams {
  fontSize: f32, letterSpacing: f32, lineHeight: f32, charsetKind: f32,
  matchSourceColor: f32, invert: f32, asciiOpacity: f32, originalOpacity: f32,
  contrast: f32, brightness: f32, saturation: f32, width: f32,
  height: f32, transparentBg: f32, edgeDetect: f32, glyphCount: f32,
  textColor: vec4f,
  bgColor: vec4f,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: AsciiParams;
@group(0) @binding(3) var asciiAtlas: texture_2d<f32>;

fn asciiClampTexelCoord(coord: vec2i, texSize: vec2i) -> vec2i {
  return vec2i(
    clamp(coord.x, 0, max(texSize.x - 1, 0)),
    clamp(coord.y, 0, max(texSize.y - 1, 0))
  );
}

fn asciiLoadTexel(coord: vec2i, texSize: vec2i) -> vec4f {
  return textureLoad(inputTex, asciiClampTexelCoord(coord, texSize), 0);
}

fn asciiAdjustColor(color: vec3f, contrast: f32, brightness: f32) -> vec3f {
  return clamp((color - 0.5) * contrast + 0.5 + vec3f(brightness), vec3f(0.0), vec3f(1.0));
}

fn asciiApplySaturation(color: vec3f, saturation: f32) -> vec3f {
  let gray = vec3f(luminance601(color));
  return clamp(gray + (color - gray) * saturation, vec3f(0.0), vec3f(1.0));
}

fn asciiSegmentDistance(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let denom = max(dot(ba, ba), 0.0001);
  let h = clamp(dot(pa, ba) / denom, 0.0, 1.0);
  return length(pa - ba * h);
}

fn asciiLineMask(p: vec2f, a: vec2f, b: vec2f, thickness: f32, blur: f32) -> f32 {
  let d = asciiSegmentDistance(p, a, b);
  return 1.0 - smoothstep(thickness, thickness + blur, d);
}

fn asciiBoxMask(p: vec2f, center: vec2f, halfSize: vec2f, blur: f32) -> f32 {
  let d = abs(p - center) - halfSize;
  return 1.0 - smoothstep(0.0, blur, max(d.x, d.y));
}

fn asciiCircleMask(p: vec2f, center: vec2f, radius: f32, blur: f32) -> f32 {
  let d = distance(p, center);
  return 1.0 - smoothstep(radius, radius + blur, d);
}

fn asciiRingMask(p: vec2f, center: vec2f, outerRadius: f32, innerRadius: f32, blur: f32) -> f32 {
  let outer = asciiCircleMask(p, center, outerRadius, blur);
  let inner = asciiCircleMask(p, center, innerRadius, blur);
  return clamp(outer - inner, 0.0, 1.0);
}

fn asciiBayer4Index(cell: vec2i) -> i32 {
  let x = cell.x % 4;
  let y = cell.y % 4;
  if (y == 0) {
    if (x == 0) { return 0; }
    if (x == 1) { return 8; }
    if (x == 2) { return 2; }
    return 10;
  }
  if (y == 1) {
    if (x == 0) { return 12; }
    if (x == 1) { return 4; }
    if (x == 2) { return 14; }
    return 6;
  }
  if (y == 2) {
    if (x == 0) { return 3; }
    if (x == 1) { return 11; }
    if (x == 2) { return 1; }
    return 9;
  }
  if (x == 0) { return 15; }
  if (x == 1) { return 7; }
  if (x == 2) { return 13; }
  return 5;
}

fn asciiBayer4Threshold(cell: vec2i) -> f32 {
  return (f32(asciiBayer4Index(cell)) + 0.5) / 16.0;
}

fn asciiBlocksMask(glyphIndex: i32, localUv: vec2f) -> f32 {
  if (glyphIndex <= 0) {
    return 0.0;
  }
  if (glyphIndex >= 4) {
    return 1.0;
  }

  var density = 0.25;
  if (glyphIndex == 2) {
    density = 0.5;
  } else if (glyphIndex == 3) {
    density = 0.75;
  }
  let patternCell = vec2i(floor(localUv * 4.0));
  return select(0.0, 1.0, density > asciiBayer4Threshold(patternCell));
}

fn asciiStandardMask(glyphIndex: i32, localUv: vec2f, blur: f32) -> f32 {
  if (glyphIndex <= 0) {
    return 0.0;
  }
  if (glyphIndex == 1) {
    return asciiCircleMask(localUv, vec2f(0.5, 0.76), 0.06, blur);
  }
  if (glyphIndex == 2) {
    let topDot = asciiCircleMask(localUv, vec2f(0.5, 0.34), 0.05, blur);
    let bottomDot = asciiCircleMask(localUv, vec2f(0.5, 0.72), 0.05, blur);
    return clamp(topDot + bottomDot, 0.0, 1.0);
  }
  if (glyphIndex == 3) {
    return asciiBoxMask(localUv, vec2f(0.5, 0.56), vec2f(0.23, 0.05), blur);
  }
  if (glyphIndex == 4) {
    let topLine = asciiBoxMask(localUv, vec2f(0.5, 0.38), vec2f(0.23, 0.04), blur);
    let bottomLine = asciiBoxMask(localUv, vec2f(0.5, 0.66), vec2f(0.23, 0.04), blur);
    return clamp(topLine + bottomLine, 0.0, 1.0);
  }
  if (glyphIndex == 5) {
    let horizontal = asciiBoxMask(localUv, vec2f(0.5, 0.52), vec2f(0.23, 0.04), blur);
    let vertical = asciiBoxMask(localUv, vec2f(0.5, 0.52), vec2f(0.04, 0.23), blur);
    return clamp(horizontal + vertical, 0.0, 1.0);
  }
  if (glyphIndex == 6) {
    let horizontal = asciiBoxMask(localUv, vec2f(0.5, 0.52), vec2f(0.22, 0.035), blur);
    let vertical = asciiBoxMask(localUv, vec2f(0.5, 0.52), vec2f(0.035, 0.22), blur);
    let diagA = asciiLineMask(localUv, vec2f(0.22, 0.22), vec2f(0.78, 0.78), 0.03, blur);
    let diagB = asciiLineMask(localUv, vec2f(0.78, 0.22), vec2f(0.22, 0.78), 0.03, blur);
    return clamp(horizontal + vertical + diagA + diagB, 0.0, 1.0);
  }
  if (glyphIndex == 7) {
    let left = asciiBoxMask(localUv, vec2f(0.34, 0.52), vec2f(0.03, 0.26), blur);
    let right = asciiBoxMask(localUv, vec2f(0.66, 0.52), vec2f(0.03, 0.26), blur);
    let top = asciiBoxMask(localUv, vec2f(0.5, 0.36), vec2f(0.24, 0.03), blur);
    let bottom = asciiBoxMask(localUv, vec2f(0.5, 0.68), vec2f(0.24, 0.03), blur);
    return clamp(left + right + top + bottom, 0.0, 1.0);
  }
  if (glyphIndex == 8) {
    let diag = asciiLineMask(localUv, vec2f(0.18, 0.82), vec2f(0.82, 0.18), 0.03, blur);
    let topCircle = asciiRingMask(localUv, vec2f(0.3, 0.3), 0.12, 0.065, blur);
    let bottomCircle = asciiRingMask(localUv, vec2f(0.7, 0.7), 0.12, 0.065, blur);
    return clamp(diag + topCircle + bottomCircle, 0.0, 1.0);
  }

  let ring = asciiRingMask(localUv, vec2f(0.5, 0.5), 0.34, 0.19, blur);
  let inner = asciiCircleMask(localUv, vec2f(0.55, 0.49), 0.1, blur);
  let tail = asciiLineMask(localUv, vec2f(0.53, 0.52), vec2f(0.74, 0.58), 0.035, blur);
  return clamp(ring + inner + tail, 0.0, 1.0);
}

fn asciiGlyphCount(charsetKind: i32) -> i32 {
  if (charsetKind == 1) { return 6; }
  if (charsetKind == 2) { return 5; }
  if (charsetKind == 3) { return 4; }
  if (charsetKind == 4) { return 3; }
  return 10;
}

fn asciiGlyphMask(charsetKind: i32, glyphIndex: i32, localUv: vec2f, blur: f32) -> f32 {
  if (charsetKind == 0) {
    return asciiStandardMask(glyphIndex, localUv, blur);
  }
  if (charsetKind == 1) {
    let mapped = array<i32, 6>(0, 1, 3, 5, 6, 7);
    return asciiStandardMask(mapped[clamp(glyphIndex, 0, 5)], localUv, blur);
  }
  if (charsetKind == 2) {
    return asciiBlocksMask(glyphIndex, localUv);
  }
  if (charsetKind == 3) {
    if (glyphIndex <= 0) { return 0.0; }
    if (glyphIndex == 1) { return asciiCircleMask(localUv, vec2f(0.5, 0.56), 0.05, blur); }
    if (glyphIndex == 2) { return asciiCircleMask(localUv, vec2f(0.5, 0.54), 0.1, blur); }
    return asciiCircleMask(localUv, vec2f(0.5, 0.52), 0.16, blur);
  }
  if (glyphIndex <= 0) {
    return 0.0;
  }
  if (glyphIndex == 1) {
    return asciiCircleMask(localUv, vec2f(0.5, 0.58), 0.055, blur);
  }
  let diagA = asciiLineMask(localUv, vec2f(0.24, 0.24), vec2f(0.76, 0.76), 0.035, blur);
  let diagB = asciiLineMask(localUv, vec2f(0.76, 0.24), vec2f(0.24, 0.76), 0.035, blur);
  return clamp(diagA + diagB, 0.0, 1.0);
}

fn asciiGlyphIndex(brightness: f32, charsetKind: i32) -> i32 {
  let maxIndex = max(asciiGlyphCount(charsetKind) - 1, 0);
  let scaled = floor(clamp(brightness, 0.0, 1.0) * f32(maxIndex));
  return i32(clamp(scaled, 0.0, f32(maxIndex)));
}

// Sobel edge magnitude sampled at cell scale (steps = one cell), used to drive
// glyph density in edge-detection mode so glyphs trace contours instead of tone.
fn asciiEdgeStrength(centerPx: vec2f, texSize: vec2i, stepX: f32, stepY: f32) -> f32 {
  let sx = max(stepX, 1.0);
  let sy = max(stepY, 1.0);
  let tl = luminance601(asciiLoadTexel(vec2i(centerPx + vec2f(-sx, -sy)), texSize).rgb);
  let tc = luminance601(asciiLoadTexel(vec2i(centerPx + vec2f(0.0, -sy)), texSize).rgb);
  let tr = luminance601(asciiLoadTexel(vec2i(centerPx + vec2f(sx, -sy)), texSize).rgb);
  let ml = luminance601(asciiLoadTexel(vec2i(centerPx + vec2f(-sx, 0.0)), texSize).rgb);
  let mr = luminance601(asciiLoadTexel(vec2i(centerPx + vec2f(sx, 0.0)), texSize).rgb);
  let bl = luminance601(asciiLoadTexel(vec2i(centerPx + vec2f(-sx, sy)), texSize).rgb);
  let bc = luminance601(asciiLoadTexel(vec2i(centerPx + vec2f(0.0, sy)), texSize).rgb);
  let br = luminance601(asciiLoadTexel(vec2i(centerPx + vec2f(sx, sy)), texSize).rgb);
  let gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  let gy = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);
  return clamp(length(vec2f(gx, gy)), 0.0, 1.0);
}

@fragment
fn asciiFragment(input: VertexOutput) -> @location(0) vec4f {
  let texSize = vec2f(params.width, params.height);
  let texSizeI = vec2i(max(i32(params.width), 1), max(i32(params.height), 1));
  let pixelPos = input.uv * texSize;
  let base = asciiLoadTexel(vec2i(pixelPos), texSizeI);
  if (base.a <= 0.0001) {
    return vec4f(0.0);
  }

  let adjustedBase = asciiAdjustColor(base.rgb, params.contrast, params.brightness);
  let background = mix(params.bgColor.rgb, adjustedBase, params.originalOpacity);

  let charAspect = max(0.25, 0.6 + params.letterSpacing * 0.05);
  let cellWidth = max(params.fontSize * charAspect, 1.0);
  let cellHeight = max(params.fontSize * max(params.lineHeight, 0.25), 1.0);
  let cols = max(1.0, floor(params.width / cellWidth));
  let rows = max(1.0, floor(params.height / cellHeight));
  let gridSize = vec2f(cols * cellWidth, rows * cellHeight);
  let origin = (texSize - gridSize) * 0.5;

  let transparent = params.transparentBg >= 0.5;

  if (
    pixelPos.x < origin.x ||
    pixelPos.y < origin.y ||
    pixelPos.x >= origin.x + gridSize.x ||
    pixelPos.y >= origin.y + gridSize.y
  ) {
    // Border (grid letterboxing): no glyphs here. Transparent mode shows only the
    // original at its opacity; opaque mode shows the filled background.
    if (transparent) {
      return vec4f(adjustedBase, base.a * params.originalOpacity);
    }
    return vec4f(background, base.a);
  }

  let gridPos = (pixelPos - origin) / vec2f(cellWidth, cellHeight);
  let cell = floor(gridPos);
  let localUv = fract(gridPos);
  let samplePos = origin + (cell + vec2f(0.5)) * vec2f(cellWidth, cellHeight);
  let sampleColor = asciiLoadTexel(vec2i(samplePos), texSizeI);
  let adjustedSample = asciiAdjustColor(sampleColor.rgb, params.contrast, params.brightness);

  // Glyph density is driven by tone, or by edge magnitude in edge-detection mode.
  var density = luminance601(adjustedSample);
  if (params.edgeDetect >= 0.5) {
    density = asciiEdgeStrength(samplePos, texSizeI, cellWidth, cellHeight);
  }
  if (params.invert >= 0.5) {
    density = 1.0 - density;
  }

  // Atlas charsets (glyphCount > 0) sample real glyphs; otherwise fall back to
  // the procedural mask shapes of the legacy charsets.
  var mask = 0.0;
  if (params.glyphCount > 0.5) {
    let n = i32(params.glyphCount + 0.5);
    let gi = clamp(i32(floor(density * f32(n))), 0, n - 1);
    let lx = clamp(localUv.x, 0.04, 0.96);
    let atlasUv = vec2f((f32(gi) + lx) / f32(n), localUv.y);
    mask = textureSampleLevel(asciiAtlas, texSampler, atlasUv, 0.0).a;
  } else {
    let charsetKind = i32(params.charsetKind + 0.5);
    let glyphIndex = asciiGlyphIndex(density, charsetKind);
    let blur = max(0.5 / min(cellWidth, cellHeight), 0.002);
    mask = asciiGlyphMask(charsetKind, glyphIndex, localUv, blur);
  }

  var glyphColor = params.textColor.rgb;
  if (params.matchSourceColor >= 0.5) {
    glyphColor = asciiApplySaturation(adjustedSample, params.saturation);
  }

  let inkAlpha = clamp(mask * params.asciiOpacity, 0.0, 1.0);

  if (transparent) {
    // Composite glyph ink over the (optional) original underlay over transparency.
    let underA = params.originalOpacity * (1.0 - inkAlpha);
    let outA = inkAlpha + underA;
    let outRGB = (glyphColor * inkAlpha + adjustedBase * underA) / max(outA, 0.0001);
    return vec4f(outRGB, base.a * outA);
  }

  let color = mix(background, glyphColor, inkAlpha);
  return vec4f(color, base.a);
}`
    ),
    params: {
      charSet: {
        type: "select",
        label: "Character Set",
        default: "ascii",
        options: [
          { value: "ascii", label: "ASCII Ramp" },
          { value: "dense", label: "Dense" },
          { value: "binary", label: "Binary" },
          { value: "symbols", label: "Symbols" },
          { value: "custom", label: "Custom" },
          { value: "standard", label: "Standard (shapes)" },
          { value: "simple", label: "Simple (shapes)" },
          { value: "blocks", label: "Blocks (shapes)" },
          { value: "dots", label: "Dots (shapes)" },
          { value: "minimal", label: "Minimal (shapes)" }
        ]
      },
      customChars: {
        type: "text",
        label: "Custom Characters",
        default: "FREECUT 01",
        visibleWhen: (params) => params.charSet === "custom"
      },
      font: {
        type: "select",
        label: "Font",
        default: "monospace",
        options: [
          { value: "monospace", label: "Monospace" },
          { value: "courier", label: "Courier" },
          { value: "consolas", label: "Consolas" },
          { value: "lucida", label: "Lucida Console" }
        ],
        visibleWhen: (params) => asciiAtlasRamp(
          params.charSet ?? "ascii",
          params.customChars ?? ""
        ) !== null
      },
      fontSize: {
        type: "number",
        label: "Font Size",
        default: 8,
        min: 4,
        max: 24,
        step: 1,
        animatable: true
      },
      letterSpacing: {
        type: "number",
        label: "Letter Spacing",
        default: 0,
        min: -2,
        max: 5,
        step: 0.1,
        animatable: true
      },
      lineHeight: {
        type: "number",
        label: "Line Height",
        default: 1,
        min: 0.5,
        max: 2,
        step: 0.1,
        animatable: true
      },
      matchSourceColor: { type: "boolean", label: "Match Source Color", default: true },
      textColor: {
        type: "color",
        label: "Text Color",
        default: "#ffffff",
        animatable: true,
        visibleWhen: (params) => params.matchSourceColor !== true
      },
      bgColor: {
        type: "color",
        label: "Background",
        default: "#0a0a0f",
        animatable: true,
        visibleWhen: (params) => params.transparentBg !== true
      },
      transparentBg: { type: "boolean", label: "Transparent Background", default: false },
      edgeDetect: { type: "boolean", label: "Edge Detection", default: false },
      colorSaturation: {
        type: "number",
        label: "Saturation",
        default: 100,
        min: 0,
        max: 200,
        step: 1,
        animatable: true,
        visibleWhen: (params) => params.matchSourceColor === true
      },
      asciiOpacity: {
        type: "number",
        label: "ASCII Opacity",
        default: 100,
        min: 0,
        max: 100,
        step: 1,
        animatable: true
      },
      originalOpacity: {
        type: "number",
        label: "Original Opacity",
        default: 0,
        min: 0,
        max: 100,
        step: 1,
        animatable: true
      },
      contrast: {
        type: "number",
        label: "Contrast",
        default: 100,
        min: 50,
        max: 200,
        step: 1,
        animatable: true
      },
      brightness: {
        type: "number",
        label: "Brightness",
        default: 0,
        min: -100,
        max: 100,
        step: 1,
        animatable: true
      },
      invert: { type: "boolean", label: "Invert", default: false }
    },
    packUniforms: (p, w, h) => {
      const textColor = parseHexColor2(p.textColor ?? "#ffffff", [1, 1, 1, 1]);
      const bgColor = parseHexColor2(p.bgColor ?? "#0a0a0f", [
        10 / 255,
        10 / 255,
        15 / 255,
        1
      ]);
      const ramp = asciiAtlasRamp(p.charSet ?? "ascii", p.customChars ?? "");
      const glyphCount = ramp ? [...ramp].length : 0;
      return new Float32Array([
        p.fontSize ?? 8,
        p.letterSpacing ?? 0,
        p.lineHeight ?? 1,
        ASCII_CHARSET_MAP[p.charSet] ?? ASCII_CHARSET_MAP.standard ?? 0,
        p.matchSourceColor === false ? 0 : 1,
        p.invert === true ? 1 : 0,
        (p.asciiOpacity ?? 100) / 100,
        (p.originalOpacity ?? 0) / 100,
        (p.contrast ?? 100) / 100,
        (p.brightness ?? 0) / 255,
        (p.colorSaturation ?? 100) / 100,
        w,
        h,
        p.transparentBg === true ? 1 : 0,
        p.edgeDetect === true ? 1 : 0,
        glyphCount,
        textColor[0],
        textColor[1],
        textColor[2],
        textColor[3],
        bgColor[0],
        bgColor[1],
        bgColor[2],
        bgColor[3]
      ]);
    },
    dataTexture: {
      dimension: "2d",
      key: (p) => {
        const ramp = asciiAtlasRamp(p.charSet ?? "ascii", p.customChars ?? "");
        return ramp ? `${ramp}|${p.font ?? "monospace"}` : "";
      },
      build: (p) => {
        const ramp = asciiAtlasRamp(p.charSet ?? "ascii", p.customChars ?? "");
        if (!ramp) return { width: 1, height: 1, depth: 1, data: new Uint8Array([0, 0, 0, 0]) };
        return buildAsciiAtlas(ramp, p.font ?? "monospace");
      }
    }
  };
  var threshold = {
    id: "gpu-threshold",
    name: "Threshold",
    category: "stylize",
    entryPoint: "thresholdFragment",
    uniformSize: 16,
    shader: (
      /* wgsl */
      `
struct ThresholdParams { level: f32, _p1: f32, _p2: f32, _p3: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: ThresholdParams;
@fragment
fn thresholdFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let luma = luminance(color.rgb);
  let result = select(0.0, 1.0, luma > params.level);
  return vec4f(vec3f(result), color.a);
}`
    ),
    params: {
      level: {
        type: "number",
        label: "Level",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p) => new Float32Array([p.level ?? 0.5, 0, 0, 0])
  };
  var vhs = {
    id: "gpu-vhs",
    name: "VHS",
    category: "stylize",
    entryPoint: "vhsFragment",
    uniformSize: 32,
    shader: (
      /* wgsl */
      `
struct VhsParams {
  bleed: f32, waviness: f32, noise: f32, scanline: f32,
  time: f32, width: f32, height: f32, pad: f32
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: VhsParams;
@fragment
fn vhsFragment(input: VertexOutput) -> @location(0) vec4f {
  let t = params.time;
  var uv = input.uv;

  // horizontal tracking wobble (sin-based, stable at any phase)
  let wave = (sin(uv.y * 120.0 + t * 5.0) + sin(uv.y * 17.0 - t * 2.3)) * 0.5;
  uv.x = uv.x + wave * params.waviness * 0.015;

  // occasional tracking-band jump. Wrap every time-derived term before it feeds
  // hash() \u2014 the sin()-based hash collapses to a constant once the unbounded
  // (time * speed) seed grows large, killing the jumps over a session / at speed.
  let bandScroll = (t * 0.7) - floor((t * 0.7) / 64.0) * 64.0;
  let jumpStep = floor(t * 3.0) - floor(floor(t * 3.0) / 64.0) * 64.0;
  let bandId = floor(uv.y * 6.0 + bandScroll);
  let bandHit = step(0.92, hash(vec2f(bandId, jumpStep)));
  uv.x = uv.x + bandHit * (hash(vec2f(bandId, 7.0)) - 0.5) * 0.06;

  // chroma bleed (luma/chroma drift)
  let off = params.bleed * 0.012;
  let r = textureSample(inputTex, texSampler, vec2f(uv.x + off, uv.y)).r;
  let g = textureSample(inputTex, texSampler, uv).g;
  let b = textureSample(inputTex, texSampler, vec2f(uv.x - off, uv.y)).b;
  let a = textureSample(inputTex, texSampler, uv).a;
  var rgb = vec3f(r, g, b);

  // scanlines
  let sl = 0.82 + 0.18 * sin(input.position.y * PI);
  rgb = mix(rgb, rgb * sl, clamp(params.scanline, 0.0, 1.0));

  // tape noise \u2014 wrap the (unbounded) time addends so the per-pixel seed stays
  // bounded and the noise doesn't go static after ~30min of playback.
  let tnx = (t * 120.0) - floor((t * 120.0) / 512.0) * 512.0;
  let tny = (t * 60.0) - floor((t * 60.0) / 512.0) * 512.0;
  let n = hash(uv * vec2f(params.width, params.height) * 0.5 + vec2f(tnx, tny)) - 0.5;
  rgb = rgb + n * params.noise * 0.5;

  return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), a);
}`
    ),
    params: {
      bleed: {
        type: "number",
        label: "Chroma Bleed",
        default: 0.4,
        min: 0,
        max: 2,
        step: 0.01,
        animatable: true
      },
      waviness: {
        type: "number",
        label: "Tracking",
        default: 0.3,
        min: 0,
        max: 2,
        step: 0.01,
        animatable: true
      },
      noise: {
        type: "number",
        label: "Tape Noise",
        default: 0.25,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      scanline: {
        type: "number",
        label: "Scanlines",
        default: 0.35,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      speed: {
        type: "number",
        label: "Speed",
        default: 1,
        min: 0,
        max: 4,
        step: 0.1,
        animatable: false
      }
    },
    packUniforms: (p, w, h) => new Float32Array([
      p.bleed ?? 0.4,
      p.waviness ?? 0.3,
      p.noise ?? 0.25,
      p.scanline ?? 0.35,
      (typeof p.__time === "number" ? p.__time : 0) * (p.speed ?? 1),
      w,
      h,
      0
    ])
  };
  var ink = {
    id: "gpu-ink",
    name: "Ink",
    category: "stylize",
    entryPoint: "inkFragment",
    uniformSize: 64,
    shader: (
      /* wgsl */
      `
struct InkParams {
  strength: f32, spacing: f32, thickness: f32, edgeStrength: f32,
  tone: f32, width: f32, height: f32, _pad0: f32,
  inkR: f32, inkG: f32, inkB: f32,
  paperR: f32, paperG: f32, paperB: f32,
  _pad1: f32, _pad2: f32,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: InkParams;

// Coverage of a single hatch-line set at \`angle\`, in screen-space pixels.
// Returns 1 on a line, fading to 0 between lines (smoothstep gives spatial AA).
fn inkHatch(p: vec2f, angle: f32, spacing: f32, thickness: f32) -> f32 {
  let s = sin(angle);
  let c = cos(angle);
  let coord = p.x * c - p.y * s;
  let m = coord - floor(coord / spacing) * spacing;
  let d = min(m, spacing - m);
  return 1.0 - smoothstep(thickness * 0.5, thickness * 0.5 + 1.0, d);
}

// A hatch layer that fades in as tone drops below \`hi\` (over a soft window) so
// the four tonal bands blend smoothly instead of popping on gradients.
fn inkLayer(p: vec2f, angle: f32, spacing: f32, thickness: f32, lum: f32, hi: f32) -> f32 {
  let w = 1.0 - smoothstep(hi - 0.15, hi, lum);
  return inkHatch(p, angle, spacing, thickness) * w;
}

@fragment
fn inkFragment(input: VertexOutput) -> @location(0) vec4f {
  let src = textureSample(inputTex, texSampler, input.uv);
  let texel = vec2f(1.0 / params.width, 1.0 / params.height);

  // Sobel magnitude \u2192 contour outlines.
  let tl = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(-texel.x, -texel.y)).rgb);
  let t  = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(0.0, -texel.y)).rgb);
  let tr = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(texel.x, -texel.y)).rgb);
  let l  = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(-texel.x, 0.0)).rgb);
  let r  = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(texel.x, 0.0)).rgb);
  let bl = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(-texel.x, texel.y)).rgb);
  let b  = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(0.0, texel.y)).rgb);
  let br = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(texel.x, texel.y)).rgb);
  let gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
  let gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  let edge = clamp(sqrt(gx * gx + gy * gy) * params.edgeStrength, 0.0, 1.0);

  let lum = clamp(luminance(src.rgb) * params.tone, 0.0, 1.0);
  let p = input.uv * vec2f(params.width, params.height);
  let sp = max(params.spacing, 1.0);
  let th = params.thickness;

  var hatch = 0.0;
  hatch = max(hatch, inkLayer(p, 0.7854, sp, th, lum, 0.85));   // 45\xB0
  hatch = max(hatch, inkLayer(p, -0.7854, sp, th, lum, 0.65));  // -45\xB0
  hatch = max(hatch, inkLayer(p, 0.0, sp, th, lum, 0.45));      // horizontal
  hatch = max(hatch, inkLayer(p, 1.5708, sp, th, lum, 0.25));   // vertical

  let inkAmt = clamp(max(hatch, edge) * params.strength, 0.0, 1.0);
  let paper = vec3f(params.paperR, params.paperG, params.paperB);
  let inkColor = vec3f(params.inkR, params.inkG, params.inkB);
  return vec4f(mix(paper, inkColor, inkAmt), src.a);
}`
    ),
    params: {
      strength: {
        type: "number",
        label: "Ink Amount",
        default: 1,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      spacing: {
        type: "number",
        label: "Line Spacing",
        default: 6,
        min: 2,
        max: 24,
        step: 0.5,
        animatable: true
      },
      thickness: {
        type: "number",
        label: "Line Width",
        default: 1.2,
        min: 0.5,
        max: 4,
        step: 0.1,
        animatable: true
      },
      edgeStrength: {
        type: "number",
        label: "Outline",
        default: 1.5,
        min: 0,
        max: 5,
        step: 0.1,
        animatable: true
      },
      tone: {
        type: "number",
        label: "Shading",
        default: 1,
        min: 0.2,
        max: 2.5,
        step: 0.05,
        animatable: true
      },
      inkColor: { type: "color", label: "Ink", default: "#141414", animatable: true },
      paperColor: { type: "color", label: "Paper", default: "#f4f1e8", animatable: true }
    },
    packUniforms: (p, w, h) => {
      const ink2 = parseHexColor2(p.inkColor ?? "#141414", [0.08, 0.08, 0.08, 1]);
      const paper = parseHexColor2(p.paperColor ?? "#f4f1e8", [0.96, 0.95, 0.91, 1]);
      return new Float32Array([
        p.strength ?? 1,
        p.spacing ?? 6,
        p.thickness ?? 1.2,
        p.edgeStrength ?? 1.5,
        p.tone ?? 1,
        w,
        h,
        0,
        ink2[0],
        ink2[1],
        ink2[2],
        paper[0],
        paper[1],
        paper[2],
        0,
        0
      ]);
    }
  };
  var pixelSort = {
    id: "gpu-pixel-sort",
    name: "Pixel Sort (Streak)",
    category: "stylize",
    entryPoint: "pixelSortFragment",
    uniformSize: 32,
    shader: (
      /* wgsl */
      `
struct PixelSortParams {
  dirX: f32, dirY: f32, low: f32, high: f32,
  length: f32, order: f32, width: f32, height: f32,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: PixelSortParams;

// Statically-bounded scan cap keeps the loop compilable and its cost bounded;
// the animatable \`length\` param clamps the effective steps below this ceiling.
const PS_MAX_STEPS: i32 = 512;

// Sort key: carry the brightest value (order>0.5) or the darkest (order<=0.5).
fn psKey(lum: f32, order: f32) -> f32 {
  return select(-lum, lum, order > 0.5);
}

@fragment
fn pixelSortFragment(input: VertexOutput) -> @location(0) vec4f {
  let src = textureSample(inputTex, texSampler, input.uv);
  let lum0 = luminance(src.rgb);

  // Pixels outside the brightness band are left untouched \u2014 only masked spans
  // are sorted (the classic pixel-sort threshold behaviour).
  if (lum0 < params.low || lum0 > params.high) {
    return src;
  }

  let texel = vec2f(1.0 / params.width, 1.0 / params.height);
  let stepUv = vec2f(params.dirX, params.dirY) * texel;
  let maxN = i32(clamp(params.length, 1.0, f32(PS_MAX_STEPS)));

  var bestKey = psKey(lum0, params.order);
  var bestColor = src.rgb;

  for (var i: i32 = 1; i <= PS_MAX_STEPS; i = i + 1) {
    if (i > maxN) { break; }
    let uv = input.uv + stepUv * f32(i);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { break; }
    let s = textureSampleLevel(inputTex, texSampler, uv, 0.0);
    let l = luminance(s.rgb);
    if (l < params.low || l > params.high) { break; } // span boundary
    let k = psKey(l, params.order);
    if (k > bestKey) {
      bestKey = k;
      bestColor = s.rgb;
    }
  }
  return vec4f(bestColor, src.a);
}`
    ),
    params: {
      direction: {
        type: "select",
        label: "Direction",
        default: "right",
        options: [
          { value: "right", label: "Right" },
          { value: "left", label: "Left" },
          { value: "down", label: "Down" },
          { value: "up", label: "Up" }
        ]
      },
      order: {
        type: "select",
        label: "Carry",
        default: "bright",
        options: [
          { value: "bright", label: "Bright streaks" },
          { value: "dark", label: "Dark streaks" }
        ]
      },
      low: {
        type: "number",
        label: "Threshold Low",
        default: 0.25,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      high: {
        type: "number",
        label: "Threshold High",
        default: 1,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      length: {
        type: "number",
        label: "Length",
        default: 60,
        min: 2,
        max: 400,
        step: 1,
        quality: true
      }
    },
    packUniforms: (p, w, h) => {
      const dir = p.direction ?? "right";
      let dirX = 1;
      let dirY = 0;
      if (dir === "left") {
        dirX = -1;
        dirY = 0;
      } else if (dir === "down") {
        dirX = 0;
        dirY = 1;
      } else if (dir === "up") {
        dirX = 0;
        dirY = -1;
      }
      return new Float32Array([
        dirX,
        dirY,
        p.low ?? 0.25,
        p.high ?? 1,
        p.length ?? 60,
        p.order === "dark" ? 0 : 1,
        w,
        h
      ]);
    }
  };
  var pixelSortHq = {
    id: "gpu-pixel-sort-hq",
    name: "Pixel Sort",
    category: "stylize",
    entryPoint: "pixelSortHqMain",
    uniformSize: 32,
    compute: {
      dispatch: (w, h) => [Math.ceil(w / 8), Math.ceil(h / 8), 1]
    },
    shader: (
      /* wgsl */
      `
struct PixelSortHqParams {
  low: f32, high: f32, vertical: f32, descending: f32,
  width: f32, height: f32, _p0: f32, _p1: f32,
};
@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: PixelSortHqParams;

fn psInBand(l: f32) -> bool {
  return l >= params.low && l <= params.high;
}

// Luminance at an axis index \`i\` (perpendicular coordinate fixed at \`perp\`).
fn psLumAt(i: i32, perp: i32, vertical: bool) -> f32 {
  let c = select(vec2i(i, perp), vec2i(perp, i), vertical);
  return luminance(textureLoad(inputTex, c, 0).rgb);
}

@compute @workgroup_size(8, 8, 1)
fn pixelSortHqMain(@builtin(global_invocation_id) gid: vec3u) {
  let W = i32(params.width);
  let H = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= W || y >= H) { return; }

  let selfColor = textureLoad(inputTex, vec2i(x, y), 0);
  let selfLum = luminance(selfColor.rgb);

  // Pixels outside the brightness band stay exactly where they are.
  if (!psInBand(selfLum)) {
    textureStore(outputTex, vec2i(x, y), selfColor);
    return;
  }

  let vertical = params.vertical > 0.5;
  let axisLen = select(W, H, vertical);
  let perp = select(y, x, vertical);
  let pos = select(x, y, vertical);

  // Grow the contiguous masked span [s, e] that contains this pixel.
  var s = pos;
  loop {
    if (s == 0) { break; }
    if (!psInBand(psLumAt(s - 1, perp, vertical))) { break; }
    s = s - 1;
  }
  var e = pos;
  loop {
    if (e == axisLen - 1) { break; }
    if (!psInBand(psLumAt(e + 1, perp, vertical))) { break; }
    e = e + 1;
  }

  // Rank = count of span pixels that sort before this one. Equal luminances are
  // ordered by original index so ranks are unique across the span (a bijection
  // onto [s, e]) \u2014 every destination texel receives exactly one writer.
  var rank = 0;
  for (var i = s; i <= e; i = i + 1) {
    if (i == pos) { continue; }
    let li = psLumAt(i, perp, vertical);
    if (li < selfLum || (li == selfLum && i < pos)) {
      rank = rank + 1;
    }
  }

  // Ascending places the darkest at \`s\`; descending flips the span end-for-end.
  let dstIndex = select(s + rank, e - rank, params.descending > 0.5);
  let outCoord = select(vec2i(dstIndex, perp), vec2i(perp, dstIndex), vertical);
  textureStore(outputTex, outCoord, selfColor);
}`
    ),
    params: {
      orientation: {
        type: "select",
        label: "Orientation",
        default: "horizontal",
        options: [
          { value: "horizontal", label: "Horizontal" },
          { value: "vertical", label: "Vertical" }
        ]
      },
      order: {
        type: "select",
        label: "Order",
        default: "ascending",
        options: [
          { value: "ascending", label: "Dark \u2192 Bright" },
          { value: "descending", label: "Bright \u2192 Dark" }
        ]
      },
      low: {
        type: "number",
        label: "Threshold Low",
        default: 0.25,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      high: {
        type: "number",
        label: "Threshold High",
        default: 0.9,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p, w, h) => new Float32Array([
      p.low ?? 0.25,
      p.high ?? 0.9,
      p.orientation === "vertical" ? 1 : 0,
      p.order === "descending" ? 1 : 0,
      w,
      h,
      0,
      0
    ])
  };

  // ../../packages/comic-core/src/visual-effects/freecut/effects/keying.ts
  var keying_exports = {};
  __export(keying_exports, {
    chromaKey: () => chromaKey
  });
  var chromaKey = {
    id: "gpu-chroma-key",
    name: "Chroma Key",
    category: "keying",
    entryPoint: "chromaKeyFragment",
    uniformSize: 32,
    shader: (
      /* wgsl */
      `
struct ChromaKeyParams {
  keyR: f32, keyG: f32, keyB: f32, tolerance: f32,
  softness: f32, spillSuppression: f32, _p1: f32, _p2: f32,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: ChromaKeyParams;

fn rgb2ycbcr(rgb: vec3f) -> vec3f {
  let y = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
  let cb = 0.564 * (rgb.b - y);
  let cr = 0.713 * (rgb.r - y);
  return vec3f(y, cb, cr);
}

@fragment
fn chromaKeyFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let keyColor = vec3f(params.keyR, params.keyG, params.keyB);
  let colorYCbCr = rgb2ycbcr(color.rgb);
  let keyYCbCr = rgb2ycbcr(keyColor);
  let cbcrDist = length(colorYCbCr.yz - keyYCbCr.yz);
  let innerTolerance = params.tolerance;
  let outerTolerance = params.tolerance + params.softness;
  var alpha = smoothstep(innerTolerance, outerTolerance, cbcrDist);
  var finalColor = color.rgb;
  if (params.spillSuppression > 0.0) {
    if (params.keyG > params.keyR && params.keyG > params.keyB) {
      let spillAmount = max(0.0, finalColor.g - max(finalColor.r, finalColor.b)) * params.spillSuppression;
      finalColor.g -= spillAmount;
      finalColor.r += spillAmount * 0.5;
      finalColor.b += spillAmount * 0.5;
    } else if (params.keyB > params.keyR && params.keyB > params.keyG) {
      let spillAmount = max(0.0, finalColor.b - max(finalColor.r, finalColor.g)) * params.spillSuppression;
      finalColor.b -= spillAmount;
      finalColor.r += spillAmount * 0.5;
      finalColor.g += spillAmount * 0.5;
    }
  }
  return vec4f(finalColor, color.a * alpha);
}`
    ),
    params: {
      keyColor: {
        type: "select",
        label: "Key Color",
        default: "green",
        options: [
          { value: "green", label: "Green Screen" },
          { value: "blue", label: "Blue Screen" }
        ]
      },
      tolerance: {
        type: "number",
        label: "Tolerance",
        default: 0.2,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      },
      softness: {
        type: "number",
        label: "Edge Softness",
        default: 0.1,
        min: 0,
        max: 0.5,
        step: 0.01,
        animatable: true
      },
      spillSuppression: {
        type: "number",
        label: "Spill Suppression",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        animatable: true
      }
    },
    packUniforms: (p) => {
      let keyR = 0, keyG = 1, keyB = 0;
      if (p.keyColor === "blue") {
        keyR = 0;
        keyG = 0;
        keyB = 1;
      }
      return new Float32Array([
        keyR,
        keyG,
        keyB,
        p.tolerance ?? 0.2,
        p.softness ?? 0.1,
        p.spillSuppression ?? 0.5,
        0,
        0
      ]);
    }
  };

  // ../../packages/comic-core/src/visual-effects/freecut/registry.ts
  var GPU_EFFECT_REGISTRY = /* @__PURE__ */ new Map();
  var GPU_EFFECT_CATEGORIES = {
    color: [],
    blur: [],
    distort: [],
    stylize: [],
    keying: []
  };
  function isEffectDefinition(obj) {
    return typeof obj === "object" && obj !== null && "id" in obj && "name" in obj && "category" in obj && "shader" in obj && "entryPoint" in obj && "packUniforms" in obj;
  }
  function registerEffects(effects) {
    Object.values(effects).forEach((effect) => {
      if (isEffectDefinition(effect)) {
        GPU_EFFECT_REGISTRY.set(effect.id, effect);
        GPU_EFFECT_CATEGORIES[effect.category]?.push(effect);
      }
    });
  }
  registerEffects(color_exports);
  registerEffects(lut_exports);
  registerEffects(blur_exports);
  registerEffects(distort_exports);
  registerEffects(stylize_exports);
  registerEffects(keying_exports);

  // ../../packages/comic-core/src/visual-effects.ts
  var comicMaskRanges = { x: [-4, 4], y: [-4, 4], width: [1e-3, 8], height: [1e-3, 8], rotation: [-36e3, 36e3], feather: [0, 512], opacity: [0, 1] };
  function comicVisualPropertyRange(clip, property) {
    const [kind, id, key, ...rest] = property.split(":");
    if (rest.length) return void 0;
    if (kind === "effect") {
      const effect = clip.effects?.find((item) => item.id === id), param = effect && GPU_EFFECT_REGISTRY.get(effect.type)?.params[key];
      return param?.type === "number" && param.animatable === true ? [param.min ?? -1e5, param.max ?? 1e5] : void 0;
    }
    if (kind === "mask") {
      const mask = clip.masks?.find((item) => item.id === id);
      if (mask) {
        const point = /^point\.(\d+)\.(x|y|inX|inY|outX|outY)$/.exec(key);
        if (point && mask.points?.[Number(point[1])]) return [-4, 4];
        return mask.shape === "circle" && key === "height" ? void 0 : comicMaskRanges[key];
      }
    }
    return void 0;
  }
  function comicVisualPropertyBase(clip, property) {
    const [kind, id, key] = property.split(":");
    if (kind === "mask") {
      const mask = clip.masks?.find((m) => m.id === id), point = /^point\.(\d+)\.(x|y|inX|inY|outX|outY)$/.exec(key);
      if (point && mask?.points) {
        const p = mask.points[Number(point[1])], k = point[2];
        return p?.[k] ?? p?.[k.endsWith("X") ? "x" : "y"] ?? 0;
      }
    }
    const value = kind === "effect" ? clip.effects?.find((item) => item.id === id)?.params[key] : clip.masks?.find((item) => item.id === id)?.[key];
    return typeof value === "number" ? value : 0;
  }

  // ../../packages/comic-core/src/composition.ts
  var compiledCurves = /* @__PURE__ */ new WeakMap();
  var clamp3 = (n, a, b) => Math.min(b, Math.max(a, n));
  function ease(type, t) {
    return type === "hold" ? t >= 1 ? 1 : 0 : type === "easeIn" ? t * t : type === "easeOut" ? 1 - (1 - t) ** 2 : type === "easeInOut" ? t * t * (3 - 2 * t) : t;
  }
  function propertyBase(clip, property) {
    if (property.startsWith("effect:") || property.startsWith("mask:")) return comicVisualPropertyBase(clip, property);
    return property === "volume" ? clip.volume ?? 1 : clip.transform?.[property] ?? (property === "scale" || property === "opacity" ? 1 : 0);
  }
  function propertyValue(clip, property, frame) {
    let groups = clip.keyframes ? compiledCurves.get(clip.keyframes) : void 0;
    if (clip.keyframes && !groups) {
      const compiled = /* @__PURE__ */ new Map();
      for (const key of clip.keyframes) {
        const curve = compiled.get(key.property) ?? [];
        curve.push(key);
        compiled.set(key.property, curve);
      }
      for (const curve of compiled.values()) curve.sort((a, b) => a.frame - b.frame);
      groups = compiled;
      compiledCurves.set(clip.keyframes, groups);
    }
    const keys = groups?.get(property);
    if (!keys?.length) return propertyBase(clip, property);
    if (frame <= keys[0].frame) return keys[0].value;
    if (frame >= keys[keys.length - 1].frame) return keys[keys.length - 1].value;
    let low = 1, high = keys.length - 1;
    while (low < high) {
      const middle = low + high >>> 1;
      if (keys[middle].frame <= frame) low = middle + 1;
      else high = middle;
    }
    {
      const a = keys[low - 1], b = keys[low];
      const start = a.easingStart ?? 0, end = a.easingEnd ?? 1, u = clamp3((frame - a.frame) / (b.frame - a.frame), 0, 1);
      if (a.easing === "hold") return a.value;
      const denominator = ease(a.easing, end) - ease(a.easing, start);
      const progress = clamp3(denominator > 1e-12 ? (ease(a.easing, start + (end - start) * u) - ease(a.easing, start)) / denominator : u, 0, 1);
      const raw = a.value + (b.value - a.value) * progress;
      const visualRange = comicVisualPropertyRange(clip, String(property));
      if (visualRange) return clamp3(raw, visualRange[0], visualRange[1]);
      return clamp3(
        raw,
        property === "scale" ? 1e-3 : property === "opacity" || property === "volume" ? 0 : -1e5,
        property === "scale" ? 100 : property === "opacity" ? 1 : property === "volume" ? 4 : 1e5
      );
    }
  }
  function evaluateComicCompositionProperty(clip, property, localFrame) {
    return propertyValue(clip, property, clamp3(localFrame, 0, clip.durationFrames));
  }
  function fade(frame, duration, incoming = 0, outgoing = 0, incomingStart = 0, outgoingEnd = duration) {
    return clamp3(Math.min(incoming ? (frame - incomingStart) / incoming : 1, outgoing ? (outgoingEnd - frame) / outgoing : 1), 0, 1);
  }
  function evaluateComicCompositionClip(clip, localFrame) {
    const t = clamp3(localFrame, 0, clip.durationFrames), e = clip.envelope;
    const originalFrame = t + (e?.offsetFrames ?? 0), duration = e?.durationFrames ?? clip.durationFrames;
    const visualFade = fade(originalFrame, duration, e?.fadeInFrames ?? clip.fadeInFrames, e?.fadeOutFrames ?? clip.fadeOutFrames, e?.fadeInStartFrame, e?.fadeOutEndFrame);
    const audioFade = fade(originalFrame, duration, e?.audioFadeInFrames ?? clip.audioFadeInFrames, e?.audioFadeOutFrames ?? clip.audioFadeOutFrames, e?.audioFadeInStartFrame, e?.audioFadeOutEndFrame);
    const dissolveVisual = fade(originalFrame, duration, e?.dissolveInFrames, 0);
    const dissolveAudio = fade(originalFrame, duration, e?.dissolveInFrames, e?.dissolveOutFrames);
    return {
      x: propertyValue(clip, "x", t),
      y: propertyValue(clip, "y", t),
      scale: propertyValue(clip, "scale", t),
      rotation: propertyValue(clip, "rotation", t),
      opacity: clamp3(propertyValue(clip, "opacity", t) * (clip.legacyFadeToBlack ? 1 : visualFade) * dissolveVisual, 0, 1),
      brightness: clip.legacyFadeToBlack ? visualFade : 1,
      volume: propertyValue(clip, "volume", t) * audioFade * dissolveAudio
    };
  }
  var textLayouts = /* @__PURE__ */ new Map();
  function comicCompositionTextLines(value, fontSize, canvasWidth) {
    const cacheKey = `${fontSize}:${canvasWidth}:${value}`, cached = textLayouts.get(cacheKey);
    if (cached !== void 0) return cached;
    const size = Math.max(1, Number.isFinite(fontSize) ? fontSize : 56), width = Math.max(1, canvasWidth - 16);
    const Segmenter = Intl.Segmenter;
    const segmenter = Segmenter ? new Segmenter(void 0, { granularity: "grapheme" }) : void 0;
    const advance = (grapheme) => /^\s+$/.test(grapheme) ? 0.4 * size : /^[ilI.,'`!|:;]$/.test(grapheme) ? 0.4 * size : /^[a-z0-9\-()[\]{}]$/i.test(grapheme) && !/^[MWmw]$/.test(grapheme) ? 0.75 * size : /[\u{10000}-\u{10ffff}]/u.test(grapheme) ? 2 * size : size;
    const output = [];
    for (const paragraph of value.replace(/\r\n?/g, "\n").split("\n")) {
      const glyphs = segmenter ? [...segmenter.segment(paragraph)].map((item) => item.segment) : Array.from(paragraph);
      let line = [], used = 0;
      for (const glyph of glyphs) {
        const length = advance(glyph);
        if (line.length && used + length > width) {
          let space = -1;
          for (let i = line.length - 1; i >= 0; i--) if (/^\s$/.test(line[i])) {
            space = i;
            break;
          }
          if (space > 0 && space >= line.length / 2) {
            output.push(line.slice(0, space).join(""));
            line = line.slice(space + 1);
            used = line.reduce((sum, char) => sum + advance(char), 0);
          } else {
            output.push(line.join(""));
            line = [];
            used = 0;
          }
          if (line.length && used + length > width) {
            output.push(line.join(""));
            line = [];
            used = 0;
          }
        }
        line.push(glyph);
        used += length;
      }
      output.push(line.join(""));
    }
    const result = output.join("\n");
    textLayouts.set(cacheKey, result);
    if (textLayouts.size > 128) textLayouts.delete(textLayouts.keys().next().value);
    return result;
  }

  // ../../packages/comic-core/src/visual-effects/freecut/shared/fullscreen-quad.ts
  var FULLSCREEN_QUAD_WGSL = (
    /* wgsl */
    `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0)
  );
  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0),
    vec2f(1.0, 1.0),
    vec2f(0.0, 0.0),
    vec2f(0.0, 0.0),
    vec2f(1.0, 1.0),
    vec2f(1.0, 0.0)
  );
  var output: VertexOutput;
  output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  output.uv = uvs[vertexIndex];
  return output;
}
`
  );

  // ../../packages/comic-core/src/visual-effects/freecut/common.ts
  var COMMON_WGSL = (
    /* wgsl */
    `
${FULLSCREEN_QUAD_WGSL}

fn rgb2hsv(c: vec3f) -> vec3f {
  let K = vec4f(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  let p = mix(vec4f(c.bg, K.wz), vec4f(c.gb, K.xy), step(c.b, c.g));
  let q = mix(vec4f(p.xyw, c.r), vec4f(c.r, p.yzx), step(p.x, c.r));
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn hsv2rgb(c: vec3f) -> vec3f {
  let K = vec4f(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3f(0.0), vec3f(1.0)), c.y);
}

fn rgb2hsl(c: vec3f) -> vec3f {
  let maxC = max(max(c.r, c.g), c.b);
  let minC = min(min(c.r, c.g), c.b);
  let l = (maxC + minC) * 0.5;
  if (maxC == minC) { return vec3f(0.0, 0.0, l); }
  let d = maxC - minC;
  let s = select(d / (2.0 - maxC - minC), d / (maxC + minC), l > 0.5);
  var h: f32;
  if (maxC == c.r) {
    h = (c.g - c.b) / d + select(0.0, 6.0, c.g < c.b);
  } else if (maxC == c.g) {
    h = (c.b - c.r) / d + 2.0;
  } else {
    h = (c.r - c.g) / d + 4.0;
  }
  h /= 6.0;
  return vec3f(h, s, l);
}

fn hue2rgb(p: f32, q: f32, t: f32) -> f32 {
  var tt = t;
  if (tt < 0.0) { tt += 1.0; }
  if (tt > 1.0) { tt -= 1.0; }
  if (tt < 1.0/6.0) { return p + (q - p) * 6.0 * tt; }
  if (tt < 1.0/2.0) { return q; }
  if (tt < 2.0/3.0) { return p + (q - p) * (2.0/3.0 - tt) * 6.0; }
  return p;
}

fn hsl2rgb(c: vec3f) -> vec3f {
  if (c.y == 0.0) { return vec3f(c.z); }
  let q = select(c.z + c.y - c.z * c.y, c.z * (1.0 + c.y), c.z < 0.5);
  let p = 2.0 * c.z - q;
  return vec3f(
    hue2rgb(p, q, c.x + 1.0/3.0),
    hue2rgb(p, q, c.x),
    hue2rgb(p, q, c.x - 1.0/3.0)
  );
}

fn luminance(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn luminance601(c: vec3f) -> f32 {
  return dot(c, vec3f(0.299, 0.587, 0.114));
}

const PI: f32 = 3.14159265359;
const TAU: f32 = 6.28318530718;
const E: f32 = 2.71828182846;

fn gaussian(x: f32, sigma: f32) -> f32 {
  return exp(-(x * x) / (2.0 * sigma * sigma));
}

fn smootherstep(edge0: f32, edge1: f32, x: f32) -> f32 {
  let t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

fn hash(p: vec2f) -> f32 {
  let p2 = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
  return fract(sin(dot(p2, vec2f(12.9898, 78.233))) * 43758.5453);
}

fn noise2d(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2f(0.0, 0.0)), hash(i + vec2f(1.0, 0.0)), u.x),
    mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), u.x),
    u.y
  );
}
`
  );

  // ../../packages/comic-core/src/visual-effects/renderer.ts
  var textureUsage = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
  var bufferUsage = { COPY_DST: 8, UNIFORM: 64 };
  var blit = `${FULLSCREEN_QUAD_WGSL}
@group(0) @binding(0) var s: sampler; @group(0) @binding(1) var t: texture_2d<f32>; @fragment fn main(i:VertexOutput)->@location(0) vec4f {let c=textureSample(t,s,i.uv);return vec4f(c.rgb*c.a,c.a);}`;
  var ComicVisualRenderer = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 33554432) throw Error("Unsupported picture dimensions");
      this.source = new OffscreenCanvas(width, height);
      this.plane = new OffscreenCanvas(width, height);
      this.output = new OffscreenCanvas(width, height);
      this.below = new OffscreenCanvas(width, height);
      this.sourceContext = this.source.getContext("2d");
      this.planeContext = this.plane.getContext("2d");
      this.context = this.output.getContext("2d");
      if (!this.sourceContext || !this.planeContext || !this.context) throw Error("Canvas renderer unavailable");
    }
    width;
    height;
    source;
    plane;
    output;
    below;
    sourceContext;
    planeContext;
    context;
    device;
    gpuOutput;
    gpuContext;
    ping;
    pong;
    sampler;
    blitPipeline;
    pipelines = /* @__PURE__ */ new Map();
    uniforms = /* @__PURE__ */ new Map();
    textures = /* @__PURE__ */ new Map();
    maskCache = /* @__PURE__ */ new Map();
    failure;
    disposed = false;
    initialized;
    async prepare() {
      if (this.failure) throw this.failure;
      if (this.disposed) throw Error("Visual renderer closed");
      if (!this.initialized) this.initialized = (async () => {
        const gpu = navigator.gpu;
        if (!gpu) throw Error("WebGPU is unavailable on this device");
        const adapter = await gpu.requestAdapter();
        if (!adapter) throw Error("No compatible graphics adapter");
        this.device = await adapter.requestDevice();
        const d = this.device;
        if (this.width > d.limits.maxTextureDimension2D || this.height > d.limits.maxTextureDimension2D) throw Error("Picture exceeds graphics adapter limits");
        d.lost.then((info) => {
          if (!this.disposed) this.failure = Error(`Graphics device lost: ${info.message}`);
        });
        d.addEventListener("uncapturederror", (e) => {
          this.failure ??= Error(`Visual rendering failed: ${e.error.message}`);
        });
        this.sampler = d.createSampler({ magFilter: "linear", minFilter: "linear" });
        const descriptor = { size: [this.width, this.height], format: "rgba8unorm", usage: Object.values(textureUsage).reduce((a, b) => a | b, 0) };
        this.ping = d.createTexture(descriptor);
        this.pong = d.createTexture(descriptor);
        this.gpuOutput = new OffscreenCanvas(this.width, this.height);
        this.gpuContext = this.gpuOutput.getContext("webgpu");
        if (!this.gpuContext) throw Error("WebGPU canvas unavailable");
        const format = gpu.getPreferredCanvasFormat();
        this.gpuContext.configure({ device: d, format, alphaMode: "premultiplied" });
        this.blitPipeline = await d.createRenderPipelineAsync({ layout: "auto", vertex: { module: d.createShaderModule({ code: blit }), entryPoint: "vertexMain" }, fragment: { module: d.createShaderModule({ code: blit }), entryPoint: "main", targets: [{ format }] }, primitive: { topology: "triangle-list" } });
      })().catch((error) => {
        this.failure = error instanceof Error ? error : Error(String(error));
        throw this.failure;
      });
      await this.initialized;
    }
    /** Used before decoding: unsupported shaders fail before costly export work. */
    async preflight(effects) {
      if (effects.some((e) => e.enabled)) await this.prepare();
      for (const effect of effects) if (effect.enabled) await this.pipeline(effect.type);
    }
    async pipeline(type) {
      let p = this.pipelines.get(type);
      if (p) return p;
      const def = GPU_EFFECT_REGISTRY.get(type);
      if (!def) throw Error(`Unknown effect ${type}`);
      const d = this.device, module = d.createShaderModule({ code: `${COMMON_WGSL}
${def.shader}` });
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter((m) => m.type === "error");
      if (errors.length) throw Error(`${def.name}: ${errors.map((m) => m.message).join("; ")}`);
      const visibility = def.compute ? 4 : 2;
      const entries = def.compute ? [{ binding: 0, visibility, texture: {} }, { binding: 1, visibility, storageTexture: { access: "write-only", format: "rgba8unorm" } }] : [{ binding: 0, visibility, sampler: {} }, { binding: 1, visibility, texture: {} }];
      if (def.uniformSize) entries.push({ binding: 2, visibility, buffer: { type: "uniform" } });
      if (def.dataTexture) entries.push({ binding: 3, visibility, texture: { viewDimension: def.dataTexture.dimension } });
      const layout = d.createPipelineLayout({ bindGroupLayouts: [d.createBindGroupLayout({ entries })] });
      p = def.compute ? await d.createComputePipelineAsync({ layout, compute: { module, entryPoint: def.entryPoint } }) : await d.createRenderPipelineAsync({ layout, vertex: { module, entryPoint: "vertexMain" }, fragment: { module, entryPoint: def.entryPoint, targets: [{ format: "rgba8unorm" }] }, primitive: { topology: "triangle-list" } });
      this.pipelines.set(type, p);
      return p;
    }
    async effects(effects) {
      const enabled = effects.filter((e) => e.enabled);
      if (!enabled.length) return this.source;
      await this.prepare();
      const d = this.device;
      d.queue.copyExternalImageToTexture({ source: this.source }, { texture: this.ping }, [this.width, this.height]);
      let input = this.ping, output = this.pong;
      for (const effect of enabled) {
        const def = GPU_EFFECT_REGISTRY.get(effect.type), pipeline = await this.pipeline(effect.type), packed = def.packUniforms({ ...effect.params }, this.width, this.height);
        const entries = def.compute ? [{ binding: 0, resource: input.createView() }, { binding: 1, resource: output.createView() }] : [{ binding: 0, resource: this.sampler }, { binding: 1, resource: input.createView() }];
        if (packed) {
          const key = effect.type;
          let b = this.uniforms.get(key);
          if (!b) {
            b = d.createBuffer({ size: Math.max(16, def.uniformSize, packed.byteLength), usage: bufferUsage.COPY_DST | bufferUsage.UNIFORM });
            this.uniforms.set(key, b);
          }
          d.queue.writeBuffer(b, 0, packed);
          entries.push({ binding: 2, resource: { buffer: b } });
        }
        if (def.dataTexture) {
          const key = def.dataTexture.key({ ...effect.params });
          let cached = this.textures.get(effect.type);
          if (!cached || cached.key !== key) {
            cached?.texture.destroy();
            const data = def.dataTexture.build({ ...effect.params });
            if (data.width * data.height * data.depth * 4 !== data.data.length || data.data.length > 2e5) throw Error("Invalid effect auxiliary texture");
            const texture = d.createTexture({ size: [data.width, data.height, data.depth], dimension: def.dataTexture.dimension, format: "rgba8unorm", usage: 6 });
            d.queue.writeTexture({ texture }, data.data, { bytesPerRow: data.width * 4, rowsPerImage: data.height }, [data.width, data.height, data.depth]);
            cached = { key, texture };
            this.textures.set(effect.type, cached);
          }
          entries.push({ binding: 3, resource: cached.texture.createView({ dimension: def.dataTexture.dimension }) });
        }
        const encoder2 = d.createCommandEncoder(), group = d.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
        if (def.compute) {
          const pass2 = encoder2.beginComputePass();
          pass2.setPipeline(pipeline);
          pass2.setBindGroup(0, group);
          pass2.dispatchWorkgroups(...def.compute.dispatch(this.width, this.height));
          pass2.end();
        } else {
          const pass2 = encoder2.beginRenderPass({ colorAttachments: [{ view: output.createView(), loadOp: "clear", storeOp: "store" }] });
          pass2.setPipeline(pipeline);
          pass2.setBindGroup(0, group);
          pass2.draw(6);
          pass2.end();
        }
        d.queue.submit([encoder2.finish()]);
        [input, output] = [output, input];
      }
      const encoder = d.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.gpuContext.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store" }] });
      pass.setPipeline(this.blitPipeline);
      pass.setBindGroup(0, d.createBindGroup({ layout: this.blitPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: input.createView() }] }));
      pass.draw(6);
      pass.end();
      d.queue.submit([encoder.finish()]);
      await d.queue.onSubmittedWorkDone();
      if (this.failure) throw this.failure;
      return this.gpuOutput;
    }
    begin() {
      if (this.failure) throw this.failure;
      this.context.setTransform(1, 0, 0, 1, 0, 0);
      this.context.globalCompositeOperation = "source-over";
      this.context.globalAlpha = 1;
      this.context.fillStyle = "#000";
      this.context.fillRect(0, 0, this.width, this.height);
    }
    mask(mask) {
      const key = JSON.stringify(mask), cached = this.maskCache.get(key);
      if (cached) return cached;
      const canvas = new OffscreenCanvas(this.width, this.height), ctx = canvas.getContext("2d");
      ctx.save();
      ctx.translate(mask.x * this.width, mask.y * this.height);
      ctx.rotate(mask.rotation * Math.PI / 180);
      ctx.scale(mask.width * this.width, mask.shape === "circle" ? mask.width * this.width : mask.height * this.height);
      ctx.beginPath();
      if (mask.shape === "rectangle") ctx.rect(-0.5, -0.5, 1, 1);
      else if (mask.shape === "ellipse" || mask.shape === "circle") ctx.ellipse(0, 0, 0.5, 0.5, 0, 0, Math.PI * 2);
      else {
        const points = mask.points;
        ctx.moveTo(points[0].x - 0.5, points[0].y - 0.5);
        for (let i = 1; i <= points.length; i++) {
          const a = points[(i - 1) % points.length], b = points[i % points.length];
          ctx.bezierCurveTo((a.outX ?? a.x) - 0.5, (a.outY ?? a.y) - 0.5, (b.inX ?? b.x) - 0.5, (b.inY ?? b.y) - 0.5, b.x - 0.5, b.y - 0.5);
        }
        ctx.closePath();
      }
      ctx.restore();
      ctx.fillStyle = "#fff";
      ctx.filter = mask.feather ? `blur(${mask.feather}px)` : "none";
      ctx.fill();
      ctx.filter = "none";
      const result = new OffscreenCanvas(this.width, this.height), r = result.getContext("2d");
      r.fillStyle = "#fff";
      r.fillRect(0, 0, this.width, this.height);
      if (mask.invert) {
        r.globalCompositeOperation = "destination-out";
        r.globalAlpha = mask.opacity;
        r.drawImage(canvas, 0, 0);
      } else {
        r.globalCompositeOperation = "destination-in";
        r.globalAlpha = 1;
        r.drawImage(canvas, 0, 0);
        if (mask.opacity < 1) {
          r.globalCompositeOperation = "source-over";
          r.globalAlpha = 1 - mask.opacity;
          r.fillStyle = "#fff";
          r.fillRect(0, 0, this.width, this.height);
        }
      }
      this.maskCache.set(key, result);
      while (this.maskCache.size > Math.max(1, Math.min(16, Math.floor(33554432 / (this.width * this.height * 4))))) {
        const first = this.maskCache.keys().next().value, old = this.maskCache.get(first);
        this.maskCache.delete(first);
        old.width = old.height = 0;
      }
      return result;
    }
    async add(clip, localFrame, fps, source, text) {
      if (this.failure) throw this.failure;
      const s = this.sourceContext, w = this.width, h = this.height;
      s.setTransform(1, 0, 0, 1, 0, 0);
      s.globalAlpha = 1;
      s.globalCompositeOperation = "source-over";
      s.clearRect(0, 0, w, h);
      if (clip.legacyFadeToBlack) {
        s.fillStyle = "#000";
        s.fillRect(0, 0, w, h);
      }
      if (clip.kind === "text") {
        const style = clip.textStyle, size = style?.fontSize ?? 56;
        const font = /Mac|iPhone|iPad/.test(navigator.platform) ? "PingFang SC" : /Win/.test(navigator.platform) ? "Microsoft YaHei" : "Noto Sans CJK SC";
        s.font = `${style?.bold ? "bold " : ""}${size}px "${font}", sans-serif`;
        s.textBaseline = "middle";
        s.textAlign = style?.align ?? "center";
        const x = style?.align === "left" ? 0 : style?.align === "right" ? w : w / 2;
        const lines = comicCompositionTextLines(text ?? clip.text ?? "", size, w).split("\n");
        lines.forEach((line, i) => {
          const y = h / 2 + (i - (lines.length - 1) / 2) * size * 1.2;
          if (style?.backgroundColor) {
            s.fillStyle = style.backgroundColor;
            const tw = s.measureText(line).width;
            s.fillRect(x - (s.textAlign === "center" ? tw / 2 : s.textAlign === "right" ? tw : 0), y - size * 0.6, tw, size * 1.2);
          }
          s.fillStyle = style?.color ?? "#fff";
          s.fillText(line, x, y);
        });
      } else if (source) {
        const dims = source;
        const sw = dims.videoWidth || dims.naturalWidth || dims.width || w, sh = dims.videoHeight || dims.naturalHeight || dims.height || h;
        const scale = clip.fit === "cover" ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh);
        s.drawImage(source, (w - sw * scale) / 2, (h - sh * scale) / 2, sw * scale, sh * scale);
      }
      const effectValues = (clip.effects ?? []).map((effect) => ({ ...effect, params: { ...effect.params, ...Object.fromEntries(Object.keys(effect.params).filter((key) => typeof effect.params[key] === "number").map((key) => [key, evaluateComicCompositionProperty(clip, `effect:${effect.id}:${key}`, localFrame)])), __time: (localFrame + (clip.envelope?.offsetFrames ?? 0)) / fps } }));
      const treated = await this.effects(effectValues), p = this.planeContext;
      p.setTransform(1, 0, 0, 1, 0, 0);
      p.globalAlpha = 1;
      p.globalCompositeOperation = "source-over";
      p.clearRect(0, 0, w, h);
      p.drawImage(treated, 0, 0);
      const masks = (clip.masks ?? []).filter((m) => m.enabled).map((m) => ({ ...m, points: m.points?.map((p2, i) => ({ ...p2, ...Object.fromEntries(["x", "y", "inX", "inY", "outX", "outY"].map((key) => [key, evaluateComicCompositionProperty(clip, `mask:${m.id}:point.${i}.${key}`, localFrame)])) })), ...Object.fromEntries(["x", "y", "width", "height", "rotation", "feather", "opacity"].filter((key) => m.shape !== "circle" || key !== "height").map((key) => [key, evaluateComicCompositionProperty(clip, `mask:${m.id}:${key}`, localFrame)])) }));
      for (const m of masks.filter((m2) => m2.scope === "clip")) {
        p.globalCompositeOperation = "destination-in";
        p.drawImage(this.mask(m), 0, 0);
      }
      p.globalCompositeOperation = "source-over";
      const sample = evaluateComicCompositionClip(clip, localFrame), c = this.context;
      for (const m of masks.filter((m2) => m2.scope === "below")) {
        s.setTransform(1, 0, 0, 1, 0, 0);
        s.globalCompositeOperation = "source-over";
        s.globalAlpha = 1;
        s.clearRect(0, 0, w, h);
        s.save();
        s.translate(w / 2 + sample.x, h / 2 + sample.y);
        s.rotate(sample.rotation * Math.PI / 180);
        s.scale(sample.scale, sample.scale);
        s.drawImage(this.mask({ ...m, invert: false, opacity: 1 }), -w / 2, -h / 2);
        s.restore();
        const b = this.below.getContext("2d"), amount = m.opacity * sample.opacity;
        b.globalCompositeOperation = "source-over";
        b.globalAlpha = 1;
        b.clearRect(0, 0, w, h);
        b.fillStyle = "#fff";
        b.fillRect(0, 0, w, h);
        if (m.invert) {
          b.globalCompositeOperation = "destination-out";
          b.globalAlpha = amount;
          b.drawImage(this.source, 0, 0);
        } else {
          b.globalCompositeOperation = "destination-in";
          b.drawImage(this.source, 0, 0);
          if (amount < 1) {
            b.globalCompositeOperation = "source-over";
            b.globalAlpha = 1 - amount;
            b.fillRect(0, 0, w, h);
          }
        }
        c.globalCompositeOperation = "destination-in";
        c.drawImage(this.below, 0, 0);
        c.globalCompositeOperation = "destination-over";
        c.fillStyle = "#000";
        c.fillRect(0, 0, w, h);
        c.globalCompositeOperation = "source-over";
      }
      c.save();
      c.translate(w / 2 + sample.x, h / 2 + sample.y);
      c.rotate(sample.rotation * Math.PI / 180);
      c.scale(sample.scale, sample.scale);
      c.globalCompositeOperation = "source-over";
      c.globalAlpha = sample.opacity;
      c.filter = sample.brightness === void 0 ? "none" : `brightness(${sample.brightness})`;
      c.drawImage(this.plane, -w / 2, -h / 2);
      c.restore();
      c.filter = "none";
    }
    hasFailed() {
      return Boolean(this.failure);
    }
    failureReason() {
      return this.failure;
    }
    canvas() {
      return this.output;
    }
    pixels() {
      return new Uint8Array(this.context.getImageData(0, 0, this.width, this.height).data.buffer);
    }
    destroy() {
      this.disposed = true;
      this.ping?.destroy();
      this.pong?.destroy();
      for (const b of this.uniforms.values()) b.destroy();
      for (const t of this.textures.values()) t.texture.destroy();
      this.device?.destroy();
      for (const canvas of this.maskCache.values()) canvas.width = canvas.height = 0;
      this.maskCache.clear();
      this.source.width = this.source.height = this.plane.width = this.plane.height = this.output.width = this.output.height = this.below.width = this.below.height = 0;
    }
  };

  // ../../packages/comic-core/src/visual-effects/worker-entry.ts
  var renderer;
  async function comicVisualWorkerCommand(meta, bytes) {
    if (meta.command === "init") {
      renderer?.destroy();
      renderer = new ComicVisualRenderer(meta.width, meta.height);
      await renderer.preflight(meta.effects ?? []);
      return new Uint8Array();
    }
    if (!renderer) throw Error("Visual worker not initialized");
    if (meta.command === "begin") {
      renderer.begin();
      return new Uint8Array();
    }
    if (meta.command === "layer") {
      let source;
      try {
        if (bytes?.length) {
          if (bytes.length !== meta.width * meta.height * 4) throw Error("Invalid visual frame size");
          source = await createImageBitmap(new ImageData(new Uint8ClampedArray(bytes), meta.width, meta.height));
        }
        await renderer.add(meta.clip, meta.frame, meta.fps, source, meta.text);
        return new Uint8Array();
      } finally {
        source?.close();
      }
    }
    if (meta.command === "end") return renderer.pixels();
    throw Error("Unknown visual worker command");
  }
  return __toCommonJS(worker_entry_exports);
})();
