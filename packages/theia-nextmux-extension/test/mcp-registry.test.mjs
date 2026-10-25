import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const registry = require('../lib/common/nextmux-mcp-registry.js');

const server = (overrides = {}) => ({ name: 'io.github.acme/tool', description: 'Does things', status: 'active',
    repository: { url: 'https://github.com/acme/tool', readme: 'x'.repeat(5000) },
    _meta: { 'io.modelcontextprotocol.registry/publisher-provided': { github: { display_name: 'Acme Tool', name_with_owner: 'acme/tool', stargazer_count: 1234, license: 'MIT License', primary_language: 'TypeScript' } } },
    ...overrides });

test('npm, PyPI, Docker and hosted servers become exact one-click configurations', () => {
    const entry = registry.parseMcpRegistryServer(server({
        remotes: [{ transport_type: 'sse', url: 'https://old.example/sse' }, { transport_type: 'streamable-http', url: 'https://mcp.acme.dev/mcp', headers: [{ name: 'Authorization', is_secret: true }] }],
        packages: [{ identifier: '@acme/tool-mcp', version: '1.2.3', environment_variables: [{ name: 'ACME_KEY', is_secret: true }] },
            { identifier: 'acme-tool', version: '0.4', runtime_hint: 'uvx' }, { identifier: 'ghcr.io/acme/tool:1', runtime_hint: 'docker' }]
    }));
    assert.deepEqual(entry.options.map(option => [option.kind, option.configuration, option.secrets]), [
        ['remote', { serverUrl: 'https://mcp.acme.dev/mcp' }, ['Authorization']],
        ['npx', { command: 'npx', args: ['-y', '@acme/tool-mcp@1.2.3'] }, ['ACME_KEY']],
        ['uvx', { command: 'uvx', args: ['acme-tool@0.4'] }, []],
        ['docker', { command: 'docker', args: ['run', '-i', '--rm', 'ghcr.io/acme/tool:1'] }, []]
    ]);
    assert.deepEqual({ title: entry.title, owner: entry.owner, stars: entry.stars, license: entry.license }, { title: 'Acme Tool', owner: 'acme', stars: 1234, license: 'MIT License' });
    assert.equal(JSON.stringify(entry).includes('xxxxx'), false, 'READMEs are not carried to the renderer');
});

test('registry arguments are kept in order; unfilled placeholders, downloads and plain HTTP are left for manual setup', () => {
    const serena = registry.parseMcpRegistryServer(server({ packages: [{ identifier: 'serena', runtime_hint: 'uvx',
        runtime_arguments: [{ type: 'named', name: '--from' }, { type: 'positional', value: 'git+https://github.com/oraios/serena' }, { type: 'positional', value: 'serena' }, { type: 'positional', value: 'start-mcp-server' }],
        package_arguments: [{ type: 'named', name: '--context' }, { type: 'positional', value: 'ide-assistant' }] }] }));
    assert.deepEqual(serena.options[0].configuration.args, ['--from', 'git+https://github.com/oraios/serena', 'serena', 'start-mcp-server', '--context', 'ide-assistant']);
    const manual = registry.parseMcpRegistryServer(server({
        remotes: [{ transport_type: 'streamable-http', url: 'http://insecure.example/mcp' }, { transport_type: 'streamable-http', url: 'https://{tenant}.example/mcp' }],
        packages: [{ identifier: 'uv', runtime_hint: 'uv', runtime_arguments: [{ type: 'named', name: '--directory', value: '{src}' }] },
            { identifier: 'https://example.com/tool.mcpb' }, { identifier: 'ghcr.io/x/y:1', runtime_hint: 'docker', runtime_arguments: [{ type: 'named', name: '-e', value: 'TOKEN={token}' }] }] }));
    assert.deepEqual(manual.options, []);
});

test('names follow the MCP name rule and search covers title, owner and description', () => {
    assert.equal(registry.suggestedMcpServerName({ id: 'x/y', title: 'Chrome DevTools MCP' }), 'chrome-devtools-mcp');
    const entries = [registry.parseMcpRegistryServer(server()), registry.parseMcpRegistryServer(server({ name: 'b/notion', description: 'Official Notion API', _meta: {} }))];
    assert.deepEqual(registry.filterMcpRegistry(entries, 'notion api').map(entry => entry.id), ['b/notion']);
    assert.deepEqual(registry.filterMcpRegistry(entries, 'ACME').map(entry => entry.id), ['io.github.acme/tool']);
    assert.equal(registry.parseMcpRegistryServer(server({ status: 'deleted' })), undefined);
});

test('Context7, draw.io and the official GitHub server show as built in, not as installs', async () => {
  const { builtInMcpCapability } = await import('../lib/common/nextmux-mcp-registry.js');
  assert.equal(builtInMcpCapability({ id: 'io.github.upstash/context7', repositoryUrl: 'https://github.com/upstash/context7' }), 'docs');
  assert.equal(builtInMcpCapability({ id: 'io.draw/mcp', repositoryUrl: 'https://github.com/jgraph/drawio-mcp' }), 'diagram');
  assert.equal(builtInMcpCapability({ id: 'io.github.github/github-mcp-server', repositoryUrl: 'https://github.com/github/github-mcp-server.git' }), 'github');
  assert.equal(builtInMcpCapability({ id: 'com.imnoo/drawing-converter', repositoryUrl: 'https://github.com/imnoo-team/drawing-converter-mcp' }), undefined);
  assert.equal(builtInMcpCapability({ id: 'io.github.someone/context7-fork', repositoryUrl: 'https://github.com/someone/context7-fork' }), undefined);
  const source = (await import('node:fs')).readFileSync(new URL('../src/browser/nextmux-mcp-registry-browser.tsx', import.meta.url), 'utf8');
  assert.match(source, /builtIn \? <small className='nmx-mcp-registry-builtin-badge'/);
});

test('registry extracts structured input fields for environment variables, package arguments, and remote auth headers', () => {
    const entry = registry.parseMcpRegistryServer(server({
        remotes: [{ transport_type: 'streamable-http', url: 'https://mcp.acme.dev/mcp', headers: [{ name: 'X-API-Key', is_secret: true }] }],
        packages: [
            {
                identifier: '@acme/fs-mcp',
                runtime_hint: 'npx',
                runtime_arguments: [{ type: 'named', name: '-y' }],
                environment_variables: [{ name: 'ACME_API_KEY', description: 'Acme API key', is_required: true, is_secret: true }],
                package_arguments: [{ type: 'positional', name: 'root_dir', description: 'Allowed directory', is_required: true }]
            },
            {
                identifier: 'markitdown-mcp',
                version: 'latest',
                runtime_hint: 'uvx'
            }
        ]
    }));
    const remoteOpt = entry.options.find(o => o.kind === 'remote');
    assert.equal(remoteOpt.defaultAuthKind, 'x-api-key');
    const npxOpt = entry.options.find(o => o.kind === 'npx');
    assert.deepEqual(npxOpt.configuration, { command: 'npx', args: ['-y', '@acme/fs-mcp'] });
    assert.equal(npxOpt.fields.length, 2);
    assert.equal(npxOpt.fields[0].key, 'ACME_API_KEY');
    assert.equal(npxOpt.fields[0].target, 'env');
    assert.equal(npxOpt.fields[0].secret, true);
    assert.equal(npxOpt.fields[1].key, 'root_dir');
    assert.equal(npxOpt.fields[1].target, 'arg');
    const uvxOpt = entry.options.find(o => o.kind === 'uvx');
    assert.deepEqual(uvxOpt.configuration, { command: 'uvx', args: ['markitdown-mcp'] });
});
