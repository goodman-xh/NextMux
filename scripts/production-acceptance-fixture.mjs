import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

// Deterministic, non-private inputs for a real desktop model/tool task.
// Existing files are never overwritten; model outputs are kept for inspection.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  name.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return result;
}

export function acceptanceChartPng() {
  const width = 240, height = 180;
  const raw = Buffer.alloc(height * (width * 3 + 1), 255);
  const bars = [{ x: 30, h: 96, rgb: [220, 45, 55] }, { x: 100, h: 72, rgb: [30, 165, 85] }, { x: 170, h: 120, rgb: [45, 95, 220] }];
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (const bar of bars) if (y >= height - 20 - bar.h && y < height - 20) {
      for (let x = bar.x; x < bar.x + 40; x++) {
        raw.set(bar.rgb, y * (width * 3 + 1) + 1 + x * 3);
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export async function createAcceptanceFixture(directory) {
  const target = resolve(directory);
  await mkdir(target, { recursive: true });
  const files = {
    'sales.csv': 'region,color,revenue_usd\nNorth,red,120\nSouth,green,90\nWest,blue,150\n',
    'brief.md': '# NextMux acceptance dataset\n\nSynthetic data only. Each region has one revenue entry in sales.csv. The chart uses the corresponding colors.\n\nDeliver report.md and summary.json in the model-specific output folder requested in the conversation. The report should explain the total, leading region, and chart observation.\n',
    'chart.png': acceptanceChartPng()
  };
  for (const [name, content] of Object.entries(files)) {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    try { await writeFile(join(target, name), bytes, { flag: 'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST' || !bytes.equals(await readFile(join(target, name)))) throw error;
    }
  }
  return { directory: target, inputs: Object.keys(files), expected: { totalRevenueUsd: 360, leadingRegion: 'West', highestBarColor: 'blue' } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Specify a dedicated acceptance project directory');
  console.log(JSON.stringify(await createAcceptanceFixture(process.argv[2]), null, 2));
}
