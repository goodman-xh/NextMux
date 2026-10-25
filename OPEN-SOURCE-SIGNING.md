# NextMux 桌面客户端开源代码签名与公证方案 / Open-Source Desktop Code Signing & Notarization Plan

[简体中文](#简体中文) | [English](#english)

---

<a id="简体中文"></a>

## 简体中文

### 1. 概述与设计目标

NextMux 桌面客户端（基于 Eclipse Theia 与 Electron 构建）针对两大主流桌面操作系统（**macOS** 与 **Windows**）及四种目标 CPU 架构独立构建、打包与分发：

| 目标平台标识符 | 操作系统 | CPU 架构 | 产包格式 | 自动更新清单 |
| :--- | :--- | :--- | :--- | :--- |
| `darwin-arm64` | macOS (Apple Silicon M1/M2/M3/M4) | `arm64` | `.dmg`, `.zip` | `latest-mac-arm64.yml` |
| `darwin-x64` | macOS (Intel) | `x86_64` | `.dmg`, `.zip` | `latest-mac-x64.yml` |
| `win32-x64` | Windows 10 / 11 (64-bit) | `x64` | NSIS `-setup.exe`, `-portable.exe` | `latest-win-x64.yml` |
| `win32-arm64` | Windows 11 on ARM | `arm64` | NSIS `-setup.exe`, `-portable.exe` | `latest-win-arm64.yml` |

本方案旨在确保：
1. **社区开发者零门槛本地编译**：外部开发者克隆本开源仓库后，在未配置 Apple Developer ID 或 Windows Authenticode 证书的情况下（默认 `NEXTMUX_REQUIRE_SIGNING=0`），可直接编译出连接 NextMux 生产服务端（`https://nextmux.app`）的 `.dmg` 与 `.exe` 安装包。
2. **官方发行版强签名与公证闭环**：官方 CI/CD 发布流水线开启 `NEXTMUX_REQUIRE_SIGNING=1` 时，强制执行 macOS Hardened Runtime + Apple Notarization（公证与票据装订）以及 Windows Authenticode + RFC 3161 可信时间戳签名，并通过 `scripts/verify-desktop-signing.mjs` 自动审计。
3. **四架构原生二进制严格隔离**：在签名与打包前后（`beforePack`、`afterPack`、`afterAllArtifactBuild`），通过 `apps/desktop/native-package-architecture.cjs` 扫描全部 Mach-O / PE 原生二进制文件，严禁在 `darwin-arm64` 包中混入纯 `x86_64` 组件（如旧版 `macos-trash` 或异构 `node-pty/prebuilds`）。

---

### 2. macOS 代码签名与公证规范（`darwin-arm64` & `darwin-x64`）

#### 2.1 证书与权限配置（Entitlements）
- **签名证书类型**：`Developer ID Application: <Team Name> (<TEAM_ID>)`
- **Hardened Runtime**：在 `apps/desktop/electron-builder.config.cjs` 中强制开启 `hardenedRuntime: true`。
- **权限声明文件**：`apps/desktop/entitlements.mac.plist`（主应用与所有嵌套 Helper 进程均通过 `entitlements` 与 `entitlementsInherit` 继承）：
  - `com.apple.security.cs.allow-jit`（V8 JIT 编译支持）
  - `com.apple.security.cs.allow-unsigned-executable-memory`
  - `com.apple.security.device.audio-input`（原生语音听写 `NextMuxSpeechHelper.app` 麦克风权限）
  - `com.apple.security.automation.apple-events`（桌面工作台 Apple Events 自动化权限）

#### 2.2 嵌套原生二进制签名清单
构建脚本与 `electron-builder` 会由内向外（inside-out）依次对以下嵌套二进制及 Bundle 执行 `codesign --force --options runtime --timestamp`：
1. `Contents/Resources/speech/NextMuxSpeechHelper.app`（macOS 原生语音助手）
2. `Contents/Resources/display/NextMuxDisplayHelper`（macOS 虚拟显示器助手）
3. `Contents/Resources/app.asar.unpacked/lib/backend/macos-trash`（目标架构 Mach-O 回收站工具）
4. `Contents/Resources/app.asar.unpacked/lib/prebuilds/darwin-{arm64|x64}/pty.node` 及 `spawn-helper`
5. `Contents/Resources/app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v3/darwin/{arm64|x64}/` 下的 `.node` 与 `.dylib`
6. `Contents/Resources/git-runtime/darwin-{arm64|x64}/` 与 `computer-runtime/darwin-{arm64|x64}/`
7. `Contents/Frameworks/` 下的所有 Electron Helper `.app` 与 `Electron Framework.framework`
8. 顶层 `NextMux.app` Bundle

#### 2.3 Apple Notary Service 公证与装订（Stapling）
当环境变量 `NEXTMUX_REQUIRE_SIGNING=1` 时启用自动公证，所需的环境变量如下：
```bash
export NEXTMUX_REQUIRE_SIGNING=1
export CSC_LINK="/path/to/developer-id-application.p12"
export CSC_KEY_PASSWORD="<p12-password>"
export APPLE_ID="<apple-developer-email>"
export APPLE_APP_SPECIFIC_PASSWORD="<app-specific-password>"
export APPLE_TEAM_ID="<10-char-team-id>"
```
公证完成后自动执行票据装订，使离线安装的 macOS 用户无需联网即可通过 Gatekeeper 校验：
```bash
xcrun stapler staple "release/NextMux-0.1.0-alpha.5-arm64.dmg"
xcrun stapler validate "release/NextMux-0.1.0-alpha.5-arm64.dmg"
```

#### 2.4 macOS 签名自动化校验命令
使用仓库内置脚本校验 `.app` 与挂载后的 `.dmg` 镜像：
```bash
node scripts/verify-desktop-signing.mjs \
  --release-dir apps/desktop/release \
  --signed true \
  --output apps/desktop/release/signing-report-macos.json
```
该脚本依次执行：
- `/usr/bin/codesign --verify --deep --strict --verbose=4 NextMux.app`
- `/usr/bin/codesign -d --verbose=4 NextMux.app`（确认包含 `flags=0x10000(runtime)`）
- `/usr/sbin/spctl --assess --type execute --verbose=4 NextMux.app`
- `/usr/bin/xcrun stapler validate NextMux.app`

---

### 3. Windows 代码签名规范（`win32-x64` & `win32-arm64`）

#### 3.1 证书方案与开源签名渠道
Windows 端支持以下三种合规 Authenticode 签名渠道：
1. **Azure Trusted Signing / 硬件 HSM EV 代码签名证书**：立即获得 Microsoft Defender SmartScreen 声誉，消除首次安装拦截提示。
2. **SignPath.io Foundation 开源项目免费代码签名**：针对 Apache-2.0 开源仓库，可通过 GitHub Actions 构建产物直接对接 SignPath HSM 签名策略。
3. **标准 OV 代码签名证书（PKCS#12 / Cloud KMS）**：配合 RFC 3161 时间戳服务使用。

#### 3.2 签名配置与预签名组件保护
- **环境变量配置**：
  ```powershell
  $env:NEXTMUX_REQUIRE_SIGNING = "1"
  $env:WINDOWS_PUBLISHER_NAME = "CN=NextMux Contributors, O=NextMux, C=US"
  $env:WIN_CSC_LINK = "C:\path\to\codesign.pfx"
  $env:WIN_CSC_KEY_PASSWORD = "<pfx-password>"
  ```
- **预签名驱动二进制保护**：`apps/desktop/electron-builder.config.cjs` 中配置了 `signExts: ['!qwen-cua-driver-uia.exe']`，确保上游已签名的 UIAccess 驱动文件保持字节级一致，不被二次重签破坏哈希校验。
- **签名覆盖范围**：
  - 主程序 `NextMux.exe`
  - 原生语音助手 `resources/speech/NextMuxSpeechHelper.exe`
  - 原生音视频工具 `resources/native/ffmpeg/ffmpeg.exe` 与 `ffprobe.exe`
  - 解包原生模块 `node-pty`（`pty.node`、`conpty.node`、`conpty_console_list.node`）与 `onnxruntime-node`
  - NSIS 卸载程序 `Uninstall NextMux.exe`、提权助手 `elevate.exe`
  - 最终生成的安装包 `NextMux-<version>-setup.exe` 与便携包 `NextMux-<version>-portable.exe`

#### 3.3 Windows 签名自动化校验命令
```powershell
node scripts/verify-desktop-signing.mjs `
  --release-dir apps/desktop/release `
  --signed true `
  --output apps/desktop/release/signing-report-windows.json
```
该脚本调用 PowerShell `Get-AuthenticodeSignature` 验证所有 `*-setup.exe` 与 `*-portable.exe` 的 `Status == 'Valid'`、发布者主题匹配 `WINDOWS_PUBLISHER_NAME` 且包含有效的 RFC 3161 时间戳证书（`TimeStamperCertificate`）。

---

### 4. 社区开发者本地未签名构建说明（Unsigned Community Builds）

开源贡献者在本地构建时无需任何签名证书（默认 `NEXTMUX_REQUIRE_SIGNING` 未设置）：
- 构建出的客户端默认连接官方生产服务端 `https://nextmux.app`。
- 在 **macOS** 上安装自行编译或未签名的 `.dmg` 后，若遇到 Gatekeeper 提示，可执行以下命令移除隔离属性：
  ```bash
  sudo xattr -cr /Applications/NextMux.app
  ```
- 在 **Windows** 上运行自行编译的 `-setup.exe` 或 `-portable.exe` 时，可在 SmartScreen 弹窗中点击 **“更多信息 (More info)” -> “仍要运行 (Run anyway)”**。
- 所有发布包均附带 `.sha256` 校验文件（由 `scripts/write-release-checksums.mjs` 自动生成），用户可通过 `SHA-256` 校验安装包完整性。

---

<a id="english"></a>

## English

### 1. Overview & Goals

The NextMux Desktop Client (built on Eclipse Theia and Electron) is independently built, packaged, and verified across two desktop operating systems (**macOS** and **Windows**) and four CPU architectures:

| Target Identifier | Operating System | CPU Architecture | Package Formats | Auto-Update Manifest |
| :--- | :--- | :--- | :--- | :--- |
| `darwin-arm64` | macOS (Apple Silicon M1/M2/M3/M4) | `arm64` | `.dmg`, `.zip` | `latest-mac-arm64.yml` |
| `darwin-x64` | macOS (Intel) | `x86_64` | `.dmg`, `.zip` | `latest-mac-x64.yml` |
| `win32-x64` | Windows 10 / 11 (64-bit) | `x64` | NSIS `-setup.exe`, `-portable.exe` | `latest-win-x64.yml` |
| `win32-arm64` | Windows 11 on ARM | `arm64` | NSIS `-setup.exe`, `-portable.exe` | `latest-win-arm64.yml` |

Key guarantees of this signing architecture:
1. **Zero-Friction Local Builds for Open-Source Contributors**: Developers cloning this repository can build `.dmg` and `.exe` packages out of the box without Apple Developer ID or Windows Authenticode certificates (`NEXTMUX_REQUIRE_SIGNING=0` by default). Compiled builds connect directly to the production NextMux platform (`https://nextmux.app`).
2. **Strict Signing & Notarization for Official Releases**: Setting `NEXTMUX_REQUIRE_SIGNING=1` enforces macOS Hardened Runtime + Apple Notarization + Stapling and Windows Authenticode + RFC 3161 trusted timestamping, audited automatically by `scripts/verify-desktop-signing.mjs`.
3. **Strict Per-Architecture Native Binary Isolation**: During `beforePack`, `afterPack`, and `afterAllArtifactBuild`, `apps/desktop/native-package-architecture.cjs` inspects every Mach-O and PE binary to guarantee that no foreign-architecture binaries (such as `x86_64`-only `macos-trash` or mismatched `node-pty/prebuilds`) ever enter an installer.

---

### 2. macOS Code Signing & Notarization (`darwin-arm64` & `darwin-x64`)

#### 2.1 Certificate & Hardened Runtime Entitlements
- **Certificate Type**: `Developer ID Application: <Team Name> (<TEAM_ID>)`
- **Hardened Runtime**: Enabled via `hardenedRuntime: true` in `apps/desktop/electron-builder.config.cjs`.
- **Entitlements (`apps/desktop/entitlements.mac.plist`)**:
  - `com.apple.security.cs.allow-jit`
  - `com.apple.security.cs.allow-unsigned-executable-memory`
  - `com.apple.security.device.audio-input` (for native speech dictation via `NextMuxSpeechHelper.app`)
  - `com.apple.security.automation.apple-events` (for desktop automation tools)

#### 2.2 Inside-Out Native Binary Signing Order
1. `Contents/Resources/speech/NextMuxSpeechHelper.app`
2. `Contents/Resources/display/NextMuxDisplayHelper`
3. `Contents/Resources/app.asar.unpacked/lib/backend/macos-trash`
4. `Contents/Resources/app.asar.unpacked/lib/prebuilds/darwin-{arm64|x64}/pty.node` & `spawn-helper`
5. `Contents/Resources/app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v3/darwin/{arm64|x64}/` (`.node` and `.dylib`)
6. `Contents/Resources/git-runtime/darwin-{arm64|x64}/` & `computer-runtime/darwin-{arm64|x64}/`
7. Nested Electron Helpers & `Electron Framework.framework` under `Contents/Frameworks/`
8. Top-level `NextMux.app` bundle

#### 2.3 Apple Notary Service & Ticket Stapling
Required environment variables when `NEXTMUX_REQUIRE_SIGNING=1`:
```bash
export NEXTMUX_REQUIRE_SIGNING=1
export CSC_LINK="/path/to/developer-id-application.p12"
export CSC_KEY_PASSWORD="<p12-password>"
export APPLE_ID="<apple-developer-email>"
export APPLE_APP_SPECIFIC_PASSWORD="<app-specific-password>"
export APPLE_TEAM_ID="<10-char-team-id>"
```
Verification command:
```bash
node scripts/verify-desktop-signing.mjs \
  --release-dir apps/desktop/release \
  --signed true \
  --output apps/desktop/release/signing-report-macos.json
```

---

### 3. Windows Authenticode Signing (`win32-x64` & `win32-arm64`)

#### 3.1 Supported Signing Providers
1. **Azure Trusted Signing / Hardware HSM EV Certificate** (recommended for immediate Microsoft Defender SmartScreen reputation).
2. **SignPath.io Foundation Open-Source Code Signing** (for verifiable GitHub Actions open-source release pipelines).
3. **Standard OV Code Signing Certificate** with an RFC 3161 timestamp authority (`http://timestamp.acs.microsoft.com` or `http://timestamp.digicert.com`).

#### 3.2 Signing Configuration & Verification
```powershell
$env:NEXTMUX_REQUIRE_SIGNING = "1"
$env:WINDOWS_PUBLISHER_NAME = "CN=NextMux Contributors, O=NextMux, C=US"
$env:WIN_CSC_LINK = "C:\path\to\codesign.pfx"
$env:WIN_CSC_KEY_PASSWORD = "<pfx-password>"

node scripts/verify-desktop-signing.mjs `
  --release-dir apps/desktop/release `
  --signed true `
  --output apps/desktop/release/signing-report-windows.json
```
Note: `signExts: ['!qwen-cua-driver-uia.exe']` in `apps/desktop/electron-builder.config.cjs` preserves the upstream signature and pinned SHA-256 hash of `qwen-cua-driver-uia.exe`.

---

### 4. Unsigned Local Builds for Contributors

When building locally without signing credentials (`NEXTMUX_REQUIRE_SIGNING` unset):
- On **macOS**, clear the quarantine attribute if Gatekeeper prompts on an unsigned build:
  ```bash
  sudo xattr -cr /Applications/NextMux.app
  ```
- On **Windows**, click **More info -> Run anyway** if SmartScreen prompts on a locally built executable.
- Verify artifact integrity against the generated `.sha256` checksum files using `shasum -a 256` (macOS) or `Get-FileHash -Algorithm SHA256` (Windows).
