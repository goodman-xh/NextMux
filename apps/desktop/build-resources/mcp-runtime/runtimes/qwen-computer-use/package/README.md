# @qwen-code/open-computer-use

Cross-platform npm distribution for the open-source **Open Computer Use** MCP server.

This package bundles native runtimes for these supported platforms and lets the Node launcher choose the current `process.platform` / `process.arch` pair:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-x64`
- `win32-arm64`
- `win32-x64`

Global command aliases:

- `open-computer-use`
- `open-computer-use-mcp`

## Install

```bash
npm install -g @qwen-code/open-computer-use
```

The root launcher resolves the current `process.platform` / `process.arch` pair and runs the matching bundled native runtime.

## MCP config

If your MCP client accepts a stdio-style `mcpServers` JSON config, this is the default setup:

```json
{
  "mcpServers": {
    "open-computer-use": {
      "command": "open-computer-use",
      "args": ["mcp"]
    }
  }
}
```

Package page: https://www.npmjs.com/package/@qwen-code/open-computer-use

## Use

```bash
open-computer-use --version
open-computer-use --help
open-computer-use mcp
open-computer-use call list_apps

# macOS permission check and onboarding
open-computer-use doctor

# Installer helpers for MCP-capable CLIs
open-computer-use install-claude-mcp
open-computer-use install-gemini-mcp
open-computer-use install-gemini-mcp --scope user
open-computer-use install-opencode-mcp
```

## Notes

- Version: `0.2.3`
- Supported npm platforms: `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, `win32-arm64`, `win32-x64`
- macOS still requires `Accessibility` and `Screen Recording` permissions.
- Linux requires a signed-in desktop session with AT-SPI2 / D-Bus accessibility available for real app control.
- Windows requires a signed-in desktop session for UI Automation access.

Source repository: https://github.com/QwenLM/open-computer-use
