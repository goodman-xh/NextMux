# NextMux Desktop Client (Open-Source AI Coding & Comic-Drama Workbench)

[简体中文](./README.md) | [English](./README.en.md)

NextMux is an open-source, cross-platform **AI Coding Workbench** and **AI Comic-Drama Creation Workbench** desktop application built on Eclipse Theia and Electron.

This repository contains the complete NextMux desktop client source code, agent runtime, model protocol adapters, comic-drama storyboard & timeline core, and local tools/MCP/Skills engine. Developers who clone and build this repository **connect to the official NextMux production platform (`https://nextmux.app`) out of the box without deploying any backend infrastructure**, while also enjoying full support for direct **"My API" (BYOK)** connections and local Ollama models.

---

## 1. Official 4-Architecture Downloads & Verification

NextMux Desktop strictly separates builds across operating systems (**macOS** and **Windows**) and four CPU architectures (`darwin-arm64`, `darwin-x64`, `win32-x64`, `win32-arm64`). Every target architecture is independently built, packaged, verified, and published with its own `SHA-256` checksum manifest:

| Operating System | CPU Architecture | Target ID | Official Download Channels | Package Formats |
| :--- | :--- | :--- | :--- | :--- |
| **macOS** (Apple Silicon M1/M2/M3/M4) | `arm64` | `darwin-arm64` | [Official Website](https://nextmux.app) · [GitHub Releases](https://github.com/nextmux/nextmux/releases/latest) | `NextMux-<version>-arm64.dmg` / `.zip` |
| **macOS** (Intel) | `x86_64` | `darwin-x64` | [Official Website](https://nextmux.app) · [GitHub Releases](https://github.com/nextmux/nextmux/releases/latest) | `NextMux-<version>-x64.dmg` / `.zip` |
| **Windows 10 / 11** (64-bit PC) | `x64` | `win32-x64` | [Official Website](https://nextmux.app) · [GitHub Releases](https://github.com/nextmux/nextmux/releases/latest) | `NextMux-<version>-x64-setup.exe` / `-portable.exe` |
| **Windows 11 on ARM** (Snapdragon X, etc.) | `arm64` | `win32-arm64` | [Official Website](https://nextmux.app) · [GitHub Releases](https://github.com/nextmux/nextmux/releases/latest) | `NextMux-<version>-arm64-setup.exe` / `-portable.exe` |

### Verifying Package SHA-256 Checksums

- **macOS Terminal**:
  ```bash
  shasum -a 256 NextMux-*.dmg
  ```
- **Windows PowerShell**:
  ```powershell
  Get-FileHash .\NextMux-*-setup.exe -Algorithm SHA256
  ```

> For code signing, notarization, and running unsigned local community builds, see [OPEN-SOURCE-SIGNING.md](./OPEN-SOURCE-SIGNING.md).

---

## 2. Key Features

- **Out-of-the-Box Production Platform Connectivity (`https://nextmux.app`)**:
  - Pre-configured with the official production endpoint `https://nextmux.app` (customizable via `NEXTMUX_PLATFORM_API_URL`).
  - Supports one-click desktop device link sign-in, browsing public relays and supported model catalogs in the **Model Center**, inspecting pricing multipliers and measured fidelity/latency metrics, and dispatching requests through managed routes or the multi-model Council.
- **"My API" (BYOK Direct Connections)**:
  - Store your own API keys securely in the operating system keychain (macOS Keychain / Windows Credential Manager).
  - First-class adapters for OpenAI, Anthropic, Google Gemini, DeepSeek, Qwen, xAI, Mistral, Cohere V2, OpenRouter, local Ollama, and custom OpenAI-compatible endpoints. Your BYOK credentials never leave your machine.
- **AI Coding Workbench**:
  - Multi-workspace file editing, terminal execution, Git integration, conflict-aware recovery checkpoints, subagent delegation, workspace Skills discovery, and Model Context Protocol (MCP) server integration.
  - Built for massive scale: SQLite WAL + FTS5 trigram indexing with on-demand scroll-up history pagination, preserving 100% of historical turns without truncation.
- **AI Comic-Drama Workbench**:
  - Script parsing, character asset libraries, infinite storyboard canvas, durable multimodal generation queues (image, video, speech, sound effects), frame-accurate timelines, and local FFmpeg export.
- **12-Locale Internationalization**:
  - Supports Simplified Chinese, Traditional Chinese, English, Japanese, Korean, Spanish, French, German, Brazilian Portuguese, Russian, Arabic (with RTL layout), and Hindi.

---

## 3. Repository Layout

```text
apps/
  desktop/                   Eclipse Theia + Electron desktop application & packaging configuration
packages/
  theia-nextmux-extension/   Core desktop frontend/backend extension (Coding, Comic-Drama, Model Center, SQLite store)
  agent-runtime/             Agent tool execution, MCP, permissions, checkpoints & multi-model Council runtime
  model-runtime/             Multi-provider official API adapters, model taxonomy & localized error diagnostics
  comic-core/                Comic scripts, scenes, shots, canvas nodes, camera motion & timeline core
  media-core/                Durable media job queue, SRT rendering & transport validation
  contracts/                 Shared domain contracts
  credential-core/           Credential policy & safety boundaries
  model-trust-core/          Model authenticity & channel quality evaluation core
  drivelist-portable/        Cross-platform drive enumeration compatibility layer
  theia-ffmpeg-portable/     Portable Electron FFmpeg build-time layer
patches/                     Deterministic patches for upstream dependencies
scripts/                     Native helper compilation, 4-arch packaging, signing verification & secret scanning scripts
```

---

## 4. Building & Running from Source

### Prerequisites
- **Node.js**: `24.x LTS` (minimum `22.12+`, pinned in `.node-version`)
- **Package Manager**: `pnpm@11.19.0` (enable via `corepack enable`)
- **Native Toolchain**:
  - macOS: Xcode Command Line Tools
  - Windows: Visual Studio Build Tools & PowerShell

### Install, Build & Start

```bash
# 1. Install workspace dependencies
pnpm install

# 2. Build all client packages and the desktop application
pnpm desktop:build

# 3. Launch the NextMux desktop client (connects to https://nextmux.app by default)
pnpm desktop:start
```

### Packaging Installers for All 4 Architectures

```bash
# macOS Apple Silicon (darwin-arm64) -> outputs .dmg and .zip
pnpm --filter @nextmux/desktop run dist:mac:arm64

# macOS Intel (darwin-x64) -> outputs .dmg and .zip
pnpm --filter @nextmux/desktop run dist:mac:x64

# Windows x64 (win32-x64) -> outputs NSIS -setup.exe and -portable.exe
pnpm --filter @nextmux/desktop run dist:win:x64

# Windows ARM64 (win32-arm64) -> outputs NSIS -setup.exe and -portable.exe
pnpm --filter @nextmux/desktop run dist:win:arm64
```

Installers and `.sha256` checksum files are written to `apps/desktop/release/`.

---

## 5. Security, Privacy & License

- **Zero Embedded Secrets**: This repository contains zero private API keys, server secrets, or user data. Run the built-in secret scanner at any time:
  ```bash
  pnpm scan:secrets
  ```
- **License**: Licensed under the [Apache License 2.0](./LICENSE). See [CONTRIBUTING.md](./CONTRIBUTING.md), [SECURITY.md](./SECURITY.md), and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) for contribution and security reporting guidelines.

## Code Signing Policy

Free code signing on Windows is provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/). See [CODE_SIGNING_POLICY.md](./CODE_SIGNING_POLICY.md) for details.
