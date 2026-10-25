// Real stdio fixture: responses can deliberately violate freshness to exercise fail-closed behavior.
let buffered = Buffer.alloc(0);
const mode = process.argv[2] || 'push';
let document;
function send(value) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...value }));
  process.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
}
function errors(text) {
  return text.includes('unknown_name') ? [{ severity: 1, code: 'undefined-name', message: 'unknown_name is not defined',
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 12 } } }] : [];
}
function receive(message) {
  if (message.method === 'initialize') send({ id: message.id, result: { capabilities: mode === 'pull' ? { diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } } : {} } });
  if (message.method === 'textDocument/didOpen') document = message.params.textDocument;
  if (message.method === 'textDocument/didChange') document = { ...message.params.textDocument, text: message.params.contentChanges[0].text };
  if (['textDocument/didOpen', 'textDocument/didChange'].includes(message.method) && mode !== 'pull') send({ method: 'textDocument/publishDiagnostics',
    params: { uri: document.uri, ...(mode === 'unversioned' ? {} : { version: mode === 'stale' ? document.version - 1 : document.version }), diagnostics: errors(document.text) } });
  if (message.method === 'textDocument/diagnostic') send({ id: message.id, result: { kind: 'full', items: errors(document.text) } });
}
process.stdin.on('data', data => {
  buffered = Buffer.concat([buffered, data]);
  for (;;) {
    const end = buffered.indexOf('\r\n\r\n');
    if (end < 0) return;
    const length = Number(/Content-Length:\s*(\d+)/i.exec(buffered.subarray(0, end).toString())[1]);
    if (buffered.length < end + 4 + length) return;
    receive(JSON.parse(buffered.subarray(end + 4, end + 4 + length).toString()));
    buffered = buffered.subarray(end + 4 + length);
  }
});
