// Synthetic 2x3 images generated and decoded offline with the already-installed
// sharp 0.35.2. These constants contain no user image, path, credential or network URL.
export const smallImages: Readonly<Record<string, string>> = {
  png: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWPwjGn2jGlmQKEAR5EG8c7DT68AAAAASUVORK5CYII=',
  jpeg: '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCOAWgH/9k=',
  webp: 'UklGRjIAAABXRUJQVlA4ICYAAABwAQCdASoCAAMAAUAmJYgCdAF1AAD+8Bvf8OfbH72Mf4NkimuwAA==',
  webpLossless: 'UklGRh4AAABXRUJQVlA4TBEAAAAvAYAAAAdQriZ1sP+BiOh/AAA=',
  webpExtended: 'UklGRlQAAABXRUJQVlA4WAoAAAAQAAAAAQAAAgAAQUxQSAcAAAAAgICAgICAAFZQOCAmAAAAcAEAnQEqAgADAAFAJiWIAnQBdQAA/vAb3/Dn2x+9jH+DZIprsAA=',
  gif: 'R0lGODlhAgADAIAAAExpcUlcgyH5BAUAAAAALAAAAAACAAMAAAICjF8AOw==',
};
export const animatedImages: Readonly<Record<string, string>> = {
  gif: 'R0lGODlhAgADAIAAAExpcXh4eCH/C05FVFNDQVBFMi4wAwEAAAAh+QQFCgAAACwAAAAAAgADAAACAoxfACH5BAUKAAAALAAAAAACAAMAgExpcfDw8AICjF8AOw==',
  webp: 'UklGRpQAAABXRUJQVlA4WAoAAAACAAAAAQAAAgAAQU5JTQYAAAD/////AABBTk1GMAAAAAAAAAAAAAEAAAIAAGQAAAJWUDggGAAAADABAJ0BKgIAAwABQCYlpAADcAD+3BAAAEFOTUYwAAAAAAAAAAAAAQAAAgAAZAAAAFZQOCAYAAAANAEAnQEqAgADAAAAJiWkAANwAP78BKAA',
};

export const imageMime = (kind: string): string => `image/${kind.startsWith('webp') ? 'webp' : kind}`;
export const bytesFor = (kind: string): Buffer => Buffer.from(smallImages[kind], 'base64');

// Change only a genuine size-bearing header. The huge samples intentionally do
// not contain enormous pixel payloads and must never be passed to a full decoder.
export function withDimensions(kind: string, width: number, height: number): Buffer {
  const bytes = bytesFor(kind);
  if (kind === 'png') { bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); }
  else if (kind === 'gif') { bytes.writeUInt16LE(width, 6); bytes.writeUInt16LE(height, 8); }
  else if (kind === 'jpeg') {
    const sof = bytes.indexOf(Buffer.from([0xff, 0xc0]));
    if (sof < 0) throw new Error('Synthetic JPEG has no baseline SOF');
    bytes.writeUInt16BE(height, sof + 5); bytes.writeUInt16BE(width, sof + 7);
  } else if (kind === 'webp') {
    bytes.writeUInt16LE(width, 26); bytes.writeUInt16LE(height, 28);
  } else if (kind === 'webpLossless') {
    const bits = ((width - 1) | ((height - 1) << 14)) >>> 0;
    bytes.writeUInt32LE(bits, 21);
  } else if (kind === 'webpExtended') {
    bytes.writeUIntLE(width - 1, 24, 3); bytes.writeUIntLE(height - 1, 27, 3);
  } else throw new Error('Unknown synthetic format');
  return bytes;
}
