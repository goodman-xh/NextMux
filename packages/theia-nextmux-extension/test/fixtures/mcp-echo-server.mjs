import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'nextmux-qa-echo', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  if (process.argv.includes('--fail-tools-list')) throw new Error('fixture tools/list rejected');
  return {
  tools: [{
    name: 'echo',
    description: 'Echo bounded text for the NextMux MCP bridge test.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: { text: { type: 'string', maxLength: 200 } },
    },
  }],
  };
});

server.setRequestHandler(CallToolRequestSchema, async request => {
  if (request.params.name !== 'echo') {
    return { isError: true, content: [{ type: 'text', text: 'Unknown tool' }] };
  }
  const text = typeof request.params.arguments?.text === 'string'
    ? request.params.arguments.text.slice(0, 200)
    : '';
  return { content: [{ type: 'text', text: `NextMux MCP echo: ${text}` }] };
});

await server.connect(new StdioServerTransport());
