#!/usr/bin/env node
const mcpConfig = {
  "mcpServers": {
    "open-computer-use": {
      "command": "open-computer-use",
      "args": [
        "mcp"
      ]
    }
  }
};
const lines = [
  "",
  "Installed @qwen-code/open-computer-use@0.2.3.",
  "Package: https://www.npmjs.com/package/@qwen-code/open-computer-use",
  "Commands: open-computer-use, open-computer-use-mcp",
  "Native runtime will be selected from bundled artifacts for " + process.platform + "-" + process.arch + ".",
  "",
  "Next:",
  "1. Run open-computer-use --version",
  "2. Add the MCP config below to your host client",
  "3. On macOS, run open-computer-use doctor and grant Accessibility / Screen Recording if prompted",
  "",
  "MCP config:",
  JSON.stringify(mcpConfig, null, 2),
  "",
];
for (const line of lines) {
  console.log(line);
}
