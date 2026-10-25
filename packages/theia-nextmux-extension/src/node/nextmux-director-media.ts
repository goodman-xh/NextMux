import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { inflateSync, gunzipSync } from 'node:zlib';

// Covers even an uncompressed RGBA canvas at the offered 2160p / 21:9 export size.
export const DIRECTOR_IMAGE_MAX_BYTES = 64 * 1024 * 1024;
export const DIRECTOR_MEDIA_MAX_BYTES = 256 * 1024 * 1024;
export const DIRECTOR_MAX_PIXELS = 33_554_432;
export const DIRECTOR_MAX_SPLATS = 1_000_000;

export class DirectorMediaError extends Error {
    constructor(readonly code: string, message: string) { super(message); this.name = 'DirectorMediaError'; }
}
function invalid(message: string): never { throw new DirectorMediaError('DIRECTOR_MEDIA_INVALID', message); }
export function directorSha256(data: string | Buffer): string { return createHash('sha256').update(data).digest('hex'); }
export function decodeDirectorBase64(text: unknown, limit: number): Buffer {
    if (typeof text !== 'string' || !text.length || text.length > Math.ceil(limit / 3) * 4
        || text.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) invalid('The captured file is empty, too large, or not valid base64.');
    const bytes = Buffer.from(text, 'base64');
    if (!bytes.length || bytes.length > limit || bytes.toString('base64') !== text) invalid('The captured file is empty, too large, or not valid base64.');
    return bytes;
}
export function assertDirectorDimensions(width: number, height: number): void {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
        || width > 8192 || height > 8192 || width * height > DIRECTOR_MAX_PIXELS) invalid('The captured image dimensions are invalid or too large.');
}
const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    return value >>> 0;
});
function crc32(bytes: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ PNG_CRC_TABLE[(crc ^ byte) & 255];
    return (crc ^ 0xffffffff) >>> 0;
}
/** Canvas PNGs have 8-bit noninterlaced samples. Validate the actual compressed raster and chunk checksums. */
export function validateDirectorPng(data: Buffer): { width: number; height: number } {
    if (data.length < 57 || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) invalid('A screenshot must be a PNG image.');
    let width = 0, height = 0, channels = 0, ended = false;
    const compressed: Buffer[] = [];
    for (let offset = 8; offset < data.length;) {
        if (offset + 12 > data.length) invalid('The PNG is truncated.');
        const length = data.readUInt32BE(offset), body = offset + 8, end = body + length;
        if (end + 4 > data.length) invalid('The PNG is truncated.');
        const tag = data.toString('ascii', offset + 4, body);
        if (crc32(data.subarray(offset + 4, end)) !== data.readUInt32BE(end)) invalid('The PNG checksum is invalid.');
        if (offset === 8 && tag !== 'IHDR') invalid('The PNG header is invalid.');
        if (tag === 'IHDR') {
            if (width || length !== 13 || data[body + 8] !== 8 || data[body + 10] || data[body + 11] || data[body + 12]) invalid('The PNG header is unsupported.');
            width = data.readUInt32BE(body); height = data.readUInt32BE(body + 4);
            channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[data[body + 9]];
            if (!channels) invalid('The PNG colour format is unsupported.');
            assertDirectorDimensions(width, height);
        } else if (tag === 'IDAT') compressed.push(data.subarray(body, end));
        else if (tag === 'IEND') {
            if (length || end + 4 !== data.length) invalid('The PNG has an invalid end marker.');
            ended = true;
        } else if (/^[A-Z]/.test(tag) && tag !== 'PLTE') invalid('The PNG has an unsupported critical chunk.');
        offset = end + 4;
    }
    if (!ended || !compressed.length) invalid('The PNG has no complete image raster.');
    const rowBytes = width * channels + 1, expected = rowBytes * height;
    let raster: Buffer;
    try { raster = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected }); } catch { invalid('The PNG image raster is invalid.'); }
    if (raster.length !== expected) invalid('The PNG image raster is incomplete.');
    for (let row = 0; row < height; row++) if (raster[row * rowBytes] > 4) invalid('The PNG image filter is invalid.');
    return { width, height };
}
export function validateDirectorWebm(data: Buffer, mimeType: string): void {
    if (!/^video\/webm(?:;\s*codecs=(?:"?(?:vp8|vp9|av1)(?:,opus)?"?))?$/i.test(mimeType)
        || data.length < 16 || data.readUInt32BE(0) !== 0x1a45dfa3) invalid('A recording must be a WebM video.');
    // Matroska shares the EBML magic; require WebM's actual DocType before invoking FFmpeg.
    if (!data.subarray(4, Math.min(512, data.length)).includes(Buffer.from([0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]))) invalid('The recording container is not WebM.');
}

const SUPPORTED_GLTF_EXTENSIONS = new Set(['KHR_materials_clearcoat', 'KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_transmission',
    'KHR_materials_unlit', 'KHR_materials_volume', 'KHR_texture_transform', 'KHR_lights_punctual', 'KHR_mesh_quantization',
    'KHR_materials_emissive_strength', 'KHR_materials_iridescence', 'KHR_materials_sheen', 'KHR_materials_anisotropy', 'KHR_materials_dispersion',
    'EXT_texture_webp', 'EXT_mesh_gpu_instancing']);
const UNAVAILABLE_GLTF_DECODERS = new Set(['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_meshopt_compression', 'KHR_texture_basisu', 'EXT_texture_avif']);
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function embedded(uri: unknown, allowed: readonly string[]): Buffer {
    if (typeof uri !== 'string') invalid('Every model dependency must be embedded in the file.');
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(uri);
    if (!match || !allowed.includes(match[1].toLowerCase())) invalid('Every model dependency must use a supported embedded data URI.');
    return decodeDirectorBase64(match[2], DIRECTOR_MEDIA_MAX_BYTES);
}
/** Reject external resources and decoder-dependent extensions; imported JSON never gains a remote fetch capability. */
export function validateDirectorGltf(data: Buffer, binary: boolean): void {
    let jsonData = data, bin: Buffer | undefined;
    if (binary) {
        if (data.length < 20 || data.toString('ascii', 0, 4) !== 'glTF' || data.readUInt32LE(4) !== 2 || data.readUInt32LE(8) !== data.length) invalid('The GLB header is invalid.');
        let chunks = 0;
        for (let offset = 12; offset < data.length;) {
            if (offset + 8 > data.length) invalid('The GLB chunk is truncated.');
            const length = data.readUInt32LE(offset), tag = data.readUInt32LE(offset + 4), start = offset + 8;
            if (length % 4 || start + length > data.length) invalid('The GLB chunk is truncated.');
            if (chunks === 0 && tag === 0x4e4f534a) jsonData = data.subarray(start, start + length);
            else if (chunks === 1 && tag === 0x004e4942) bin = data.subarray(start, start + length);
            else invalid('Only self-contained JSON and BIN GLB chunks are supported.');
            chunks++; offset = start + length;
        }
    }
    let gltf: unknown;
    try { gltf = JSON.parse(jsonData.toString('utf8').trim()) as unknown; } catch { invalid('The glTF JSON is invalid.'); }
    if (!object(gltf) || !object(gltf.asset) || gltf.asset.version !== '2.0' || gltf.asset.minVersion !== undefined && gltf.asset.minVersion !== '2.0') invalid('Only glTF 2.0 models are supported.');
    const array = (value: unknown): unknown[] => { if (value === undefined) return []; if (!Array.isArray(value)) invalid('The glTF dependency arrays are invalid.'); return value; };
    const buffers = array(gltf.buffers), views = array(gltf.bufferViews), images = array(gltf.images), required = array(gltf.extensionsRequired), used = array(gltf.extensionsUsed);
    if (required.some(extension => typeof extension !== 'string' || !SUPPORTED_GLTF_EXTENSIONS.has(extension))) invalid('The model requires a decoder extension that is not available.');
    // GLTFLoader constructs Draco's decoder even when listed only as optional; fail before persisting an unusable asset.
    if (used.some(extension => typeof extension !== 'string' || UNAVAILABLE_GLTF_DECODERS.has(extension))) invalid('The model uses a decoder extension that is not available.');
    const sizes: number[] = [];
    for (const [index, buffer] of buffers.entries()) {
        if (!object(buffer) || !Number.isSafeInteger(buffer.byteLength) || Number(buffer.byteLength) < 1) invalid('The model buffer is invalid.');
        const bytes = buffer.uri === undefined && binary && index === 0 && bin ? bin
            : embedded(buffer.uri, ['application/octet-stream', 'application/gltf-buffer']);
        if (bytes.length < Number(buffer.byteLength) || bytes.length > Number(buffer.byteLength) + (buffer.uri === undefined ? 3 : 0)) invalid('The model buffer size is invalid.');
        sizes.push(Number(buffer.byteLength));
    }
    for (const view of views) {
        if (!object(view) || !Number.isSafeInteger(view.buffer) || !Number.isSafeInteger(view.byteLength) || Number(view.byteLength) < 1
            || view.byteOffset !== undefined && (!Number.isSafeInteger(view.byteOffset) || Number(view.byteOffset) < 0)
            || sizes[Number(view.buffer)] === undefined || Number(view.byteOffset || 0) + Number(view.byteLength) > sizes[Number(view.buffer)]) invalid('The model buffer view is invalid.');
    }
    for (const image of images) {
        if (!object(image)) invalid('The model image is invalid.');
        if (image.uri !== undefined) embedded(image.uri, ['image/png', 'image/jpeg', 'image/webp']);
        else if (!Number.isSafeInteger(image.bufferView) || !views[Number(image.bufferView)] || !['image/png', 'image/jpeg', 'image/webp'].includes(String(image.mimeType))) invalid('The model image must use an embedded supported image.');
    }
    // An extension cannot sneak in another URI, including optional vendor resources.
    const walk = (item: unknown, depth = 0): void => {
        if (depth > 80) invalid('The model JSON is too deeply nested.');
        if (typeof item === 'number' && !Number.isFinite(item)) invalid('The model JSON contains non-finite numbers.');
        if (!item || typeof item !== 'object') return;
        for (const [key, child] of Object.entries(item)) {
            if (key === 'uri') embedded(child, ['application/octet-stream', 'application/gltf-buffer', 'image/png', 'image/jpeg', 'image/webp']);
            if (key === 'extensions' && object(child) && Object.keys(child).some(extension => UNAVAILABLE_GLTF_DECODERS.has(extension))) invalid('The model uses a decoder extension that is not available.');
            walk(child, depth + 1);
        }
    };
    walk(gltf);
}

export function validateDirectorSpz(data: Buffer): void {
    let unpacked: Buffer;
    try { unpacked = gunzipSync(data, { maxOutputLength: DIRECTOR_MEDIA_MAX_BYTES }); } catch { invalid('The SPZ file is not a valid bounded gzip stream.'); }
    if (unpacked.length < 16 || unpacked.toString('ascii', 0, 4) !== 'NGSP') invalid('The SPZ header is invalid.');
    const version = unpacked.readUInt32LE(4), count = unpacked.readUInt32LE(8), degree = unpacked[12];
    if (![1, 2, 3].includes(version) || count < 1 || count > DIRECTOR_MAX_SPLATS || degree > 3 || unpacked[13] > 24 || unpacked[15] !== 0) invalid('The SPZ version or point count is unsupported.');
    const harmonics = (degree + 1) ** 2 - 1;
    const expected = 16 + count * ((version === 1 ? 6 : 9) + 1 + 3 + 3 + (version === 3 ? 4 : 3) + harmonics * 3);
    if (unpacked.length !== expected) invalid('The SPZ point data is incomplete.');
}

const PLY_BYTES: Record<string, number> = { char: 1, uchar: 1, short: 2, ushort: 2, int: 4, uint: 4, float: 4, double: 8 };
/** Matches Spark 2.3's binary point-cloud/standard Gaussian decoder; no ASCII, list or vendor compression. */
export function validateDirectorPly(data: Buffer): void {
    const prefix = data.subarray(0, Math.min(data.length, 65536)).toString('ascii'), end = /(?:^|\n)end_header\n/.exec(prefix);
    if (!/^ply\n/.test(prefix) || !end) invalid('The PLY header must use supported LF line endings.');
    const headerEnd = end.index + end[0].length;
    if (!isUtf8(data.subarray(0, headerEnd))) invalid('The PLY header is not valid UTF-8.');
    const lines = data.subarray(0, headerEnd).toString('utf8').split('\n');
    let format = '', count = 0, inVertex = false;
    const properties: { name: string; type: string; offset: number }[] = [];
    let stride = 0;
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.startsWith('format ')) {
            if (format || !/^format binary_little_endian 1\.0$/.test(line)) invalid('Only binary little-endian PLY 1.0 is supported.');
            format = line.split(/\s+/)[1];
        }
        else if (line.startsWith('element ')) {
            const fields = line.split(/\s+/);
            if (fields.length !== 3 || !/^\d+$/.test(fields[2])) invalid('The PLY element count is invalid.');
            inVertex = fields[1] === 'vertex';
            if (inVertex) { if (count) invalid('The PLY contains duplicate vertices.'); count = Number(fields[2]); }
            else if (Number(fields[2]) || fields[1] === 'chunk' || fields[1] === 'sh') invalid('Only uncompressed point/splat PLY files are supported.');
        } else if (line.startsWith('property ')) {
            const [, type, name] = line.split(/\s+/);
            if (!inVertex || line.split(/\s+/).length !== 3 || !PLY_BYTES[type] || !name || properties.some(item => item.name === name)) invalid('The PLY vertex property is unsupported.');
            properties.push({ type, name, offset: stride }); stride += PLY_BYTES[type];
        } else if (line && line !== 'ply' && line !== 'end_header' && !/^(?:comment|obj_info)(?:\s|$)/.test(line)) invalid('The PLY header contains unsupported data.');
    }
    if (format !== 'binary_little_endian' || !Number.isSafeInteger(count) || count < 1 || count > DIRECTOR_MAX_SPLATS
        || properties.length > 128 || !['x', 'y', 'z'].every(name => properties.some(item => item.name === name))) invalid('The PLY point format or count is unsupported.');
    const has = (name: string): boolean => properties.some(item => item.name === name);
    if (!['red', 'green', 'blue'].every(has)) {
        if (!['scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'opacity', 'f_dc_0', 'f_dc_1', 'f_dc_2'].every(has)) invalid('The PLY needs RGB point colours or complete Gaussian attributes.');
        const harmonics = properties.filter(item => item.name.startsWith('f_rest_'));
        if (![0, 9, 24, 45].includes(harmonics.length) || !harmonics.every((_, index) => has(`f_rest_${index}`))) invalid('The PLY spherical harmonic attributes are incomplete.');
    }
    if (data.length - headerEnd !== count * stride) invalid('The PLY point data is incomplete.');
    for (const property of properties.filter(item => ['float', 'double'].includes(item.type))) {
        for (let index = 0; index < count; index++) {
            const offset = headerEnd + index * stride + property.offset, value = PLY_BYTES[property.type] === 8 ? data.readDoubleLE(offset) : data.readFloatLE(offset);
            if (!Number.isFinite(Math.fround(value))) invalid('The PLY contains point data outside its decoder precision.');
        }
    }
}
