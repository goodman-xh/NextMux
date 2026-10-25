import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(packageRoot, 'src', 'browser', 'style', 'provider-logos');
const destination = join(packageRoot, 'lib', 'browser', 'style', 'provider-logos');

await mkdir(dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true, force: true });

// The reviewed microphone component imports this stylesheet from its compiled sibling.
await cp(join(packageRoot, 'src', 'browser', 'style', 'nextmux-dictation-button.css'),
    join(packageRoot, 'lib', 'browser', 'style', 'nextmux-dictation-button.css'));

// Shared WGSL renderer is also used by the isolated desktop export worker.
const {buildComicVisualRenderer}=await import('../../../scripts/build-comic-visual-renderer.mjs');
await buildComicVisualRenderer();

await cp(join(packageRoot,'src/browser/style/nextmux-comic-visual-panel.css'),join(packageRoot,'lib/browser/style/nextmux-comic-visual-panel.css'));

// Character start-frame panel imports this stylesheet from its compiled sibling.
await cp(join(packageRoot, 'src/browser/style/nextmux-comic-start-frame.css'),
    join(packageRoot, 'lib/browser/style/nextmux-comic-start-frame.css'));
