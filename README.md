# NextMux 桌面客户端 (Open-Source Desktop Workbench)

[简体中文](./README.md) | [English](./README.en.md)

NextMux 是一款开源的跨平台 **AI 编程工作台（Coding Workbench）** 与 **AI 漫剧创作工作台（Comic-Drama Workbench）** 桌面客户端，基于 Eclipse Theia 与 Electron 构建。

本仓库包含完整的 NextMux 桌面客户端源码、Agent 运行时、模型协议适配层、漫剧分镜与时间线核心以及本地工具/MCP/Skills 引擎。外部开发者克隆本仓库并本地编译打包后，**无需部署任何后端服务，即可开箱即用地连接 NextMux 官方生产服务端（`https://nextmux.app`）**，同时也支持完全离线/直连的 **“我的 API”（BYOK）** 与本地 Ollama 模型。

---

## 1. 官方四架构安装包下载与校验

NextMux 桌面端严格区分操作系统（**macOS** 与 **Windows**）及四种 CPU 架构（`darwin-arm64`、`darwin-x64`、`win32-x64`、`win32-arm64`），每个架构独立构建、打包、校验并生成独立的 `SHA-256` 校验文件：

| 操作系统 | CPU 架构 | 平台标识 | 官方下载渠道 | 安装包格式 |
| :--- | :--- | :--- | :--- | :--- |
| **macOS** (Apple 芯片 M1/M2/M3/M4) | `arm64` | `darwin-arm64` | [官网下载](https://nextmux.app) · [GitHub Releases](https://github.com/nextmux/nextmux/releases/latest) | `NextMux-<version>-arm64.dmg` / `.zip` |
| **macOS** (Intel 芯片) | `x86_64` | `darwin-x64` | [官网下载](https://nextmux.app) · [GitHub Releases](https://github.com/nextmux/nextmux/releases/latest) | `NextMux-<version>-x64.dmg` / `.zip` |
| **Windows 10 / 11** (64 位主流 PC) | `x64` | `win32-x64` | [官网下载](https://nextmux.app) · [GitHub Releases](https://github.com/nextmux/nextmux/releases/latest) | `NextMux-<version>-x64-setup.exe` / `-portable.exe` |
| **Windows 11 on ARM** (骁龙 X Elite 等) | `arm64` | `win32-arm64` | [官网下载](https://nextmux.app) · [GitHub Releases](https://github.com/nextmux/nextmux/releases/latest) | `NextMux-<version>-arm64-setup.exe` / `-portable.exe` |

### 安装包 SHA-256 完整性校验命令

- **macOS 终端**：
  ```bash
  shasum -a 256 NextMux-*.dmg
  ```
- **Windows PowerShell**：
  ```powershell
  Get-FileHash .\NextMux-*-setup.exe -Algorithm SHA256
  ```

> 关于代码签名、公证及本地未签名编译包的运行说明，请参阅 [OPEN-SOURCE-SIGNING.md](./OPEN-SOURCE-SIGNING.md)。

---

## 2. 核心功能特性

- **开箱即用连接官方生产平台（`https://nextmux.app`）**：
  - 默认内置生产服务端地址 `https://nextmux.app`（可通过环境变量 `NEXTMUX_PLATFORM_API_URL` 自定义）。
  - 支持桌面端一键设备授权登录、浏览 **模型中心（Model Center）** 全部公开商家与支持模型列表、查看模型倍率与实测真实性/延迟指标、使用平台托管路由与多模型委员会（Council）。
- **“我的 API”（BYOK 本地直连）**：
  - 支持配置并保存在操作系统钥匙串（macOS Keychain / Windows Credential Manager）中的自有 API 密钥。
  - 原生适配 OpenAI、Anthropic、Google Gemini、DeepSeek、Qwen（通义千问）、xAI、Mistral、Cohere V2、OpenRouter、本地 Ollama 以及任意 OpenAI 兼容接口，密钥仅保存在本机钥匙串，绝不上传至平台。
- **AI 编程工作台（Coding Workbench）**：
  - 支持多工作区文件读写、终端命令执行、Git 版本控制、冲突感知恢复检查点（Checkpoints）、子代理并行委派（Subagent Delegation）、Skills 自动发现以及 MCP（Model Context Protocol）服务器接入。
  - 支持海量对话与超长单对话历史（SQLite WAL + FTS5 索引 + 滚轮上滑按需加载历史消息，永不丢弃任何历史记录）。
- **AI 漫剧创作工作台（Comic-Drama Workbench）**：
  - 支持剧本解析、角色资产库、分镜画布（Canvas）、多模态图像/视频/配音/音效生成队列、逐帧时间线编辑以及本地 FFmpeg 合成导出。
- **12 种界面语言国际化**：
  - 原生支持简体中文、繁体中文、English、日本語、한국어、Español、Français、Deutsch、Português (Brasil)、Русский、العربية（含 RTL 布局）、हिन्दी。

---

## 3. 仓库目录结构

```text
apps/
  desktop/                   基于 Eclipse Theia 与 Electron 的桌面客户端主程序与打包配置
packages/
  theia-nextmux-extension/   桌面端核心前后端扩展（编程工作台、漫剧工作台、模型中心、本地 SQLite 存储）
  agent-runtime/             Agent 工具调度、MCP、权限控制、检查点恢复与多模型委员会运行时
  model-runtime/             多厂商官方 API 协议适配器、模型分类学与本地化错误诊断
  comic-core/                漫剧剧本、分镜、画布节点、镜头运动与时间线核心模型
  media-core/                持久化媒体生成任务队列、SRT 字幕渲染与传输校验
  contracts/                 跨模块稳定领域契约定义
  credential-core/           凭据策略与安全边界工具
  model-trust-core/          模型真实性与通道质量评估核心
  drivelist-portable/        跨平台磁盘卷枚举兼容层
  theia-ffmpeg-portable/     Electron FFmpeg 构建时可移植兼容层
patches/                     针对上游依赖的确定性补丁
scripts/                     桌面端原生模块构建、四架构独立打包、签名验证与安全扫描脚本
```

---

## 4. 从源码编译与运行

### 环境要求
- **Node.js**：`24.x LTS`（最低 `22.12+`，详见 `.node-version`）
- **包管理器**：`pnpm@11.19.0`（可通过 `corepack enable` 激活）
- **操作系统工具链**：
  - macOS：Xcode Command Line Tools（用于编译原生语音与虚拟显示器助手）
  - Windows：Visual Studio Build Tools / PowerShell（用于编译 Windows 原生语音与桌面自动化助手）

### 安装依赖与本地启动

```bash
# 1. 安装工作区依赖
pnpm install

# 2. 编译所有客户端核心包与桌面应用
pnpm desktop:build

# 3. 启动 NextMux 桌面客户端（默认连接 https://nextmux.app）
pnpm desktop:start
```

### 四架构独立打包命令

```bash
# macOS Apple Silicon (darwin-arm64) -> 生成 .dmg 与 .zip
pnpm --filter @nextmux/desktop run dist:mac:arm64

# macOS Intel (darwin-x64) -> 生成 .dmg 与 .zip
pnpm --filter @nextmux/desktop run dist:mac:x64

# Windows x64 (win32-x64) -> 生成 NSIS -setup.exe 与 -portable.exe
pnpm --filter @nextmux/desktop run dist:win:x64

# Windows ARM64 (win32-arm64) -> 生成 NSIS -setup.exe 与 -portable.exe
pnpm --filter @nextmux/desktop run dist:win:arm64
```

打包产物与 `.sha256` 校验文件将输出至 `apps/desktop/release/` 目录。

---

## 5. 安全、隐私与开源许可

- **零内置密钥承诺**：本仓库不包含任何私有 API 密钥、服务端凭据或用户数据。发版或提交前可运行内置扫描器验证：
  ```bash
  pnpm scan:secrets
  ```
- **开源许可证**：本项目采用 [Apache License 2.0](./LICENSE) 开源许可。贡献指南与安全漏洞提交流程请参阅 [CONTRIBUTING.md](./CONTRIBUTING.md)、[SECURITY.md](./SECURITY.md) 与 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。
