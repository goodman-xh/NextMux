import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { FILE_DRAWER_TEXT_MAX_BYTES, IMAGE_PREVIEW_MAX_BYTES, filePreviewRequestIsCurrent, filePreviewErrorText } from '../lib/browser/nextmux-file-preview.js';

const repo = new URL('../../../', import.meta.url);
const files = createRequire(new URL('packages/theia-nextmux-extension/package.json', repo))('@theia/filesystem/lib/common/files');
const extension = createRequire(new URL('packages/theia-nextmux-extension/package.json', repo));
const ts = extension('typescript');
const URI = extension('@theia/core/lib/common/uri').default;
const source = readFileSync(new URL('packages/theia-nextmux-extension/src/browser/nextmux-desktop-widget.tsx', repo), 'utf8');
const ast = ts.createSourceFile('nextmux-desktop-widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(item => ts.isClassDeclaration(item) && item.name?.text === 'NextMuxDesktopWidget');
const methods = ['previewContextFile', 'beginContextFileOpen', 'finishContextFileOpen'].map(name => {
  const method = widget.members.find(item => item.name?.getText(ast) === name);
  assert.ok(method, `the real file drawer method ${name} must be present`); return method.getText(ast);
});
const harnessSource = ts.transpile(`class NextMuxDesktopWidget { static FILE_LIST_MIN_WIDTH = 220; static LARGE_TEXT_FILE_CHARACTERS = 200000; ${methods.join('\n')} }`, {
  target: ts.ScriptTarget.ES2022
});
const Harness = new Function('URI', 'filePreviewRequestIsCurrent', 'filePreviewErrorText', 'crypto', 'FILE_DRAWER_TEXT_MAX_BYTES', 'IMAGE_PREVIEW_MAX_BYTES', 'FileOperationResult', 'toFileOperationResult', 'FileSystemProviderCapabilities',
  `${harnessSource}; return NextMuxDesktopWidget;`)(URI, filePreviewRequestIsCurrent, filePreviewErrorText, { randomUUID }, FILE_DRAWER_TEXT_MAX_BYTES, IMAGE_PREVIEW_MAX_BYTES, { FILE_NOT_FOUND: 1, FILE_TOO_LARGE: 7, FILE_EXCEEDS_MEMORY_LIMIT: 9 }, files.toFileOperationResult, { Readonly: 1 }); // const enums are inlined by tsc in the product

function drawer(name, readOperations, size = 1024) {
  const instance = new Harness();
  Object.assign(instance, {
    activeCodingSessionId: 'conversation', contextFileTabs: new Map(), contextFileSavingUris: new Set(),
    contextFilePreviewRequestToken: 0, codingViewRestoreToken: 0, contextFilePreview: undefined,
    contextFileDrafts: {}, workContextMode: 'browser', workContextOpen: false,
    contextFileListWidth: 350, contextFileHistoryOpen: false, desktopLocale: 'en',
    rememberContextFileTab() {}, detachContextEditorRecovery: () => true,
    editorRecoveryController: () => ({ refresh: async () => undefined, find: () => undefined, state: { entries: [] } }),
    clampPaneSize: value => value, contextFileListMaximumWidth: () => 800, constrainPaneSizes() {}, update() {},
    attachmentExtension: fileName => fileName.split('.').at(-1), imageMimeType: () => 'image/png',
    bytesToBase64: () => 'AA==', contextFileVersionTarget: () => undefined,
    persistActiveCodingSessionState() {},
    fileService: {
      async readFile(_resource, options) {
        readOperations.push({ branch: 'image', options });
        return { value: { buffer: Uint8Array.of(137, 80, 78, 71) } };
      },
      async read(_resource, options) {
        readOperations.push({ branch: 'text', options });
        return { value: 'short fixture' };
      },
      async resolve() { return { isReadonly: false, size }; },
      hasCapability: () => false
    }
  });
  return instance.previewContextFile({ uri: `file:///tmp/${name}`, path: `/tmp/${name}`, name, directory: false }).then(() => instance);
}

// Audit DS-10: the file drawer reads within bounds the window can hold.
test('file drawer must place a finite practical read limit on image and text files', async () => {
  const operations = [];
  await drawer('image.png', operations);
  await drawer('document.txt', operations);
  assert.deepEqual(operations.map(item => item.branch), ['image', 'text']);
  const budgets = operations.map(({ branch, options }) => ({ branch,
    bounded: Number.isSafeInteger(options?.limits?.size) && options.limits.size <= 128 * 1024 * 1024 }));
  assert.deepEqual(budgets, [{ branch: 'image', bounded: true }, { branch: 'text', bounded: true }],
    'a crafted large image or text file must not request an unbounded read into the renderer');
});

test('a picture larger than the drawer bound is refused before reading, with a readable message', async () => {
  const operations = [];
  const instance = await drawer('huge.png', operations, IMAGE_PREVIEW_MAX_BYTES + 1);
  assert.deepEqual(operations, []);
  assert.equal(instance.contextFilePreview.error, filePreviewErrorText('en', 'tooLarge'));
});
