import { readFile } from 'node:fs/promises';
import { NextMuxPlatformServiceImpl } from '../../lib/node/nextmux-platform-service.js';

const [, , profile, workspaceRoot] = process.argv;
class Observer extends NextMuxPlatformServiceImpl {
  nextmuxDataRoot() { return profile; }
}

const service = new Observer();
const before = await service.getComicExportWorkspaceState(workspaceRoot);
let clearReturned = false;
let clearErrorCode;
try {
  await service.clearDesktopLocalData({ workspaceRoot, categories: ['comic_exports'] });
  clearReturned = true;
} catch (error) { clearErrorCode = error.code; }
const historyPath = service.comicExportHistoryPath(service.mediaWorkspaceId(workspaceRoot));
const persisted = await readFile(historyPath, 'utf8').then(JSON.parse, () => undefined);
console.log(JSON.stringify({ activeId: before.active?.id ?? null, status: before.exports[0]?.status ?? null,
  clearReturned, clearErrorCode, persistedId: persisted?.exports[0]?.id ?? null }));
