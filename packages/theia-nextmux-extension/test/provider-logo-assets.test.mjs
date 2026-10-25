import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetModulePath = path.join(packageRoot, 'src/browser/nextmux-provider-logos.ts');
const widgetPath = path.join(packageRoot, 'src/browser/nextmux-desktop-widget.tsx');
const cssPath = path.join(packageRoot, 'src/browser/style/nextmux.css');
const logoDirectory = path.join(packageRoot, 'src/browser/style/provider-logos');
const builtLogoDirectory = path.join(packageRoot, 'lib/browser/style/provider-logos');
const presetPath = path.resolve(packageRoot, '../model-runtime/src/presets.ts');

const brandedProviderIds = [
    'openai', 'anthropic', 'gemini', 'xai', 'mistral', 'cohere', 'openrouter', 'deepseek', 'qwen',
    'zhipu', 'moonshot', 'minimax', 'doubao', 'ernie', 'hunyuan', 'azure_openai', 'vertex', 'bedrock'
];

test('every branded direct provider maps to a valid bundled SVG', async () => {
    const source = await readFile(assetModulePath, 'utf8');
    const imports = new Map([...source.matchAll(/import\s+(\w+)\s+from\s+'\.\/style\/provider-logos\/([^']+\.svg)'/g)]
        .map(match => [match[1], match[2]]));

    for (const providerId of brandedProviderIds) {
        const entry = new RegExp(`\\b${providerId}: \\{ src: (\\w+), monochrome: (?:true|false) \\}`).exec(source);
        assert.ok(entry, `${providerId} must have one canonical asset-map entry`);
        const filename = imports.get(entry[1]);
        assert.ok(filename, `${providerId} must reference an imported local asset`);
        const svg = await readFile(path.join(logoDirectory, filename), 'utf8');
        const builtSvg = await readFile(path.join(builtLogoDirectory, filename), 'utf8');
        assert.match(svg, /^<svg\b/);
        assert.match(svg, /viewBox="0 0 24 24"/);
        assert.match(svg, /<(?:path|circle|rect)\b/);
        assert.equal(builtSvg, svg, `${providerId} must ship the same SVG in the compiled extension`);
    }

    const providerCompanyMarks = {
        qwen: 'alibabacloud.svg', doubao: 'volcengine.svg', ernie: 'baiducloud.svg',
        hunyuan: 'tencentcloud.svg', moonshot: 'moonshot.svg', xai: 'xai.svg'
    };
    for (const [providerId, expectedFilename] of Object.entries(providerCompanyMarks)) {
        const entry = new RegExp(`\\b${providerId}: \\{ src: (\\w+), monochrome: (?:true|false) \\}`).exec(source);
        assert.equal(imports.get(entry[1]), expectedFilename, `${providerId} must use its API destination's mark`);
    }
});

test('provider-logo rendering contains only the bundled provider mark and preserves colour artwork', async () => {
    const [widget, css] = await Promise.all([readFile(widgetPath, 'utf8'), readFile(cssPath, 'utf8')]);
    assert.match(widget, /officialProviderLogoAsset\(provider\.id\)/);
    assert.match(widget, /<img className=\{`nmx-provider-logo/);
    assert.doesNotMatch(widget, /nmx-provider-logo-fallback/);
    const logoRule = /\.nmx-provider-logo\s*\{([^}]*)\}/.exec(css)?.[1] || '';
    assert.doesNotMatch(logoRule, /\b(?:border|background|border-radius)\s*:/);
    assert.match(css, /\.nmx-provider-logo\.is-monochrome\s*\{/);
    assert.doesNotMatch(css, /\.nmx-provider-logo\.is-azure_openai/);
});

test('OpenAI is one official provider and ChatGPT is not a duplicate API destination', async () => {
    const [source, widget] = await Promise.all([readFile(presetPath, 'utf8'), readFile(widgetPath, 'utf8')]);
    assert.equal((source.match(/\bid: "openai"/g) || []).length, 1);
    assert.doesNotMatch(source, /\bid: "chatgpt"/i);
    assert.match(source, /id: "openai",\s+name: "OpenAI",\s+modelFamily: "GPT"/);
    assert.match(source, /id: "azure_openai",\s+name: "Azure OpenAI",\s+modelFamily: "OpenAI"/);
    assert.match(widget, /officialPresetProviders\.map\(item => <option key=\{item\.id\} value=\{item\.id\}>\{`\$\{item\.name\} · \$\{item\.protocol\}`\}<\/option>\)/,
        'direct API cards must lead with the API destination, not a product family that looks like a duplicate provider');
});
