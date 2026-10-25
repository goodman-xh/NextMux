import { CanvasLocalImageInputError } from '../common/nextmux-canvas-local-image-tools';
import type { CanvasColorTransferParameters, CanvasExtractedPalette } from '../common/nextmux-canvas-local-image-tools';

export type CanvasLab = readonly [number, number, number];
export interface CanvasLabStatistics { readonly mean: CanvasLab; readonly standardDeviation: CanvasLab; readonly weight: number }
const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));
const linear = (value: number): number => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
const gamma = (value: number): number => value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055;
const f = (value: number): number => value > 216 / 24389 ? Math.cbrt(value) : value * 841 / 108 + 4 / 29;
const finv = (value: number): number => value > 6 / 29 ? value ** 3 : (value - 4 / 29) * 108 / 841;
/** Standard sRGB → CIE Lab with D65 white point. Inputs and outputs here use RGB 0..1. */
export function canvasRgbToLab(rgb: CanvasLab): CanvasLab {
    const [r, g, b] = rgb.map(value => linear(clamp(value)));
    const x = f((.4124564 * r + .3575761 * g + .1804375 * b) / .95047);
    const y = f(.2126729 * r + .7151522 * g + .072175 * b);
    const z = f((.0193339 * r + .119192 * g + .9503041 * b) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function canvasLabToRgb(lab: CanvasLab): CanvasLab {
    const y = (lab[0] + 16) / 116, x = finv(y + lab[1] / 500) * .95047, z = finv(y - lab[2] / 200) * 1.08883;
    const yy = finv(y);
    return [gamma(3.2404542 * x - 1.5371385 * yy - .4985314 * z), gamma(-.969266 * x + 1.8760108 * yy + .041556 * z), gamma(.0556434 * x - .2040259 * yy + 1.0572252 * z)].map(value => clamp(value)) as unknown as CanvasLab;
}
function validateRgba(rgba: Uint8Array): void {
    if (!rgba.length || rgba.length % 4) throw new CanvasLocalImageInputError('A non-empty decoded RGBA sample is required');
}
/** Alpha-weighted Welford moments ignore invisible RGB and remain stable for solid images. */
export function canvasLabStatistics(rgba: Uint8Array): CanvasLabStatistics {
    validateRgba(rgba);
    const mean = [0, 0, 0], m2 = [0, 0, 0]; let weight = 0;
    for (let i = 0; i < rgba.length; i += 4) {
        const w = rgba[i + 3] / 255; if (!w) continue;
        const lab = canvasRgbToLab([rgba[i] / 255, rgba[i + 1] / 255, rgba[i + 2] / 255]);
        const next = weight + w;
        for (let channel = 0; channel < 3; channel++) {
            const delta = lab[channel] - mean[channel]; mean[channel] += delta * w / next;
            m2[channel] += w * delta * (lab[channel] - mean[channel]);
        }
        weight = next;
    }
    if (!weight) throw new CanvasLocalImageInputError('The image sample has no visible pixels');
    return { mean: mean as unknown as CanvasLab, standardDeviation: m2.map(value => Math.sqrt(Math.max(0, value / weight))) as unknown as CanvasLab, weight };
}
/** Reinhard-style statistics adapted to D65 CIE Lab; capped gains protect nearly constant channels. */
export function canvasTransferRgb(rgb: CanvasLab, source: CanvasLabStatistics, reference: CanvasLabStatistics, parameters: CanvasColorTransferParameters = {}): CanvasLab {
    const strength = parameters.strength ?? 1;
    if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw new CanvasLocalImageInputError('Transfer strength must be a number in 0..1');
    if (parameters.preserveLuminance !== undefined && typeof parameters.preserveLuminance !== 'boolean') throw new CanvasLocalImageInputError('preserveLuminance must be a boolean');
    if (!strength) return [...rgb];
    const lab = canvasRgbToLab(rgb);
    const mapped = lab.map((value, channel) => {
        if (parameters.preserveLuminance && channel === 0) return value;
        const sigma = source.standardDeviation[channel];
        const gain = sigma < 1 ? 1 : clamp(reference.standardDeviation[channel] / sigma, 1 / 3, 3);
        return (value - source.mean[channel]) * gain + reference.mean[channel];
    }) as unknown as CanvasLab;
    const target = canvasLabToRgb(mapped);
    return rgb.map((value, channel) => clamp(value * (1 - strength) + target[channel] * strength)) as unknown as CanvasLab;
}
export function buildCanvasColorTransferCube(source: CanvasLabStatistics, reference: CanvasLabStatistics, parameters: CanvasColorTransferParameters = {}, size = 33): string {
    if (!Number.isInteger(size) || size < 2 || size > 65) throw new CanvasLocalImageInputError('Transfer LUT size must be an integer in 2..65');
    const rows = ['TITLE "NextMux local Lab colour transfer"', `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
    for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
        rows.push(canvasTransferRgb([r / (size - 1), g / (size - 1), b / (size - 1)], source, reference, parameters).map(value => value.toFixed(7)).join(' '));
    }
    return rows.join('\n') + '\n';
}
interface Bin { readonly key: number; readonly weight: number; readonly lab: CanvasLab }
const distance = (a: CanvasLab, b: CanvasLab): number => a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0);
/** Deterministic weighted Lab k-means on 5-bit RGB bins; transparent pixels never vote. */
export function extractCanvasPalette(rgba: Uint8Array, colorCount = 6, sampleWidth = rgba.length / 4, sampleHeight = 1): CanvasExtractedPalette {
    validateRgba(rgba);
    if (!Number.isInteger(colorCount) || colorCount < 5 || colorCount > 8) throw new CanvasLocalImageInputError('Palette colour count must be an integer in 5..8');
    if (!Number.isSafeInteger(sampleWidth) || !Number.isSafeInteger(sampleHeight) || sampleWidth < 1 || sampleHeight < 1 || sampleWidth * sampleHeight * 4 !== rgba.length) throw new CanvasLocalImageInputError('Palette sample dimensions must match its RGBA bytes');
    const map = new Map<number, { weight: number; rgb: number[] }>();
    for (let i = 0; i < rgba.length; i += 4) {
        const weight = rgba[i + 3] / 255; if (!weight) continue;
        const key = (rgba[i] >> 3) << 10 | (rgba[i + 1] >> 3) << 5 | (rgba[i + 2] >> 3);
        const bin = map.get(key) || { weight: 0, rgb: [0, 0, 0] }; bin.weight += weight;
        for (let c = 0; c < 3; c++) bin.rgb[c] += rgba[i + c] / 255 * weight;
        map.set(key, bin);
    }
    const bins: Bin[] = [...map].sort(([a], [b]) => a - b).map(([key, bin]) => ({ key, weight: bin.weight, lab: canvasRgbToLab(bin.rgb.map(value => value / bin.weight) as unknown as CanvasLab) }));
    if (!bins.length) throw new CanvasLocalImageInputError('The image sample has no visible pixels');
    const count = Math.min(colorCount, bins.length);
    const first = bins.reduce((best, bin) => bin.weight > best.weight ? bin : best, bins[0]);
    let centers: CanvasLab[] = [first.lab];
    while (centers.length < count) {
        const next = bins.reduce((best, bin) => {
            const score = Math.min(...centers.map(center => distance(bin.lab, center))) * Math.sqrt(bin.weight);
            return score > best.score ? { score, bin } : best;
        }, { score: -1, bin: bins[0] });
        centers.push(next.bin.lab);
    }
    const nearest = (lab: CanvasLab): number => centers.reduce((best, center, index) => distance(lab, center) < distance(lab, centers[best]) ? index : best, 0);
    for (let step = 0; step < 24; step++) {
        const sums = centers.map(() => ({ weight: 0, lab: [0, 0, 0] }));
        for (const bin of bins) { const sum = sums[nearest(bin.lab)]; sum.weight += bin.weight; for (let c = 0; c < 3; c++) sum.lab[c] += bin.lab[c] * bin.weight; }
        const next = sums.map((sum, index) => sum.weight ? sum.lab.map(value => value / sum.weight) as unknown as CanvasLab : centers[index]);
        const moved = next.some((center, index) => distance(center, centers[index]) > .000001); centers = next; if (!moved) break;
    }
    const weights = centers.map(() => 0); for (const bin of bins) weights[nearest(bin.lab)] += bin.weight;
    const combined = new Map<string, number>();
    centers.forEach((center, index) => {
        if (!weights[index]) return;
        const hex = '#' + canvasLabToRgb(center).map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
        combined.set(hex, (combined.get(hex) || 0) + weights[index]);
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const colors = [...combined].sort(([a, aw], [b, bw]) => bw - aw || a.localeCompare(b)).map(([hex, weight]) => ({ hex, percentage: Math.round(weight / total * 10000) / 100 }));
    colors[0].percentage = Math.round((colors[0].percentage + 100 - colors.reduce((sum, item) => sum + item.percentage, 0)) * 100) / 100;
    return { algorithm: 'lab-kmeans-v1', requestedColorCount: colorCount, colors, sampleWidth, sampleHeight };
}

/** A real swatch image remains useful in the existing image-node and export workflow. */
export function canvasPalettePpm(palette: CanvasExtractedPalette): Buffer {
    const width = palette.colors.length * 64, height = 64, data = Buffer.alloc(width * height * 3);
    palette.colors.forEach((color, cell) => {
        const rgb = [1, 3, 5].map(offset => parseInt(color.hex.slice(offset, offset + 2), 16));
        for (let y = 0; y < height; y++) for (let x = cell * 64; x < (cell + 1) * 64; x++) for (let c = 0; c < 3; c++) data[(y * width + x) * 3 + c] = rgb[c];
    });
    return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), data]);
}
