<div align="center">

# NextMux

**开源 AI 编程、多智能体“臭皮匠模式”、桌面应用/游戏自动化与漫剧多轨视频工作台**

[![License: Apache-2.0 with Commons Clause](https://img.shields.io/badge/License-Apache%202.0%20%2B%20Commons%20Clause-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/badge/Release-v0.1.8-1263db)](https://github.com/goodman-xh/NextMux/releases/tag/v0.1.8)
[![Website](https://img.shields.io/badge/Website-nextmux.app-111111)](https://nextmux.app)

[English](./README.md) | **简体中文**

</div>

---

**NextMux** 是一款开源跨平台桌面端 AI 创作与工程工作台（原生支持 `macOS` 与 `Windows` 的 `arm64` / `x64` 四种架构），将 **AI 编程与终端自动化**、**多模型协同思辨（臭皮匠模式）**、**内嵌桌面软件与游戏插件控制** 以及 **漫剧无限画布与多轨视频剪辑台** 融为一体，内置透明验真的全球 AI 中转市场，并完整支持 **BYOK（自带 API Key）** 与本地 **Ollama** 模型。

---

## 为什么选择 NextMux？— 告别 $200/月 的单厂商高昂包月订阅

许多重度开发者与创作者每月花费 **$200 美元** 订阅单一厂商的固定套餐（如 Claude Max），不仅月底未用完的额度直接清零，而且只能使用单一厂商的文本模型；当需要调用其他顶尖模型、无审查模型，或进行漫剧生图、视频生成与配音时，又不得不额外购买多个平台的订阅。

NextMux 内置公开透明的 **AI 中转市场（Relay Marketplace）**，让全球优质中转商在价格倍率、首字延迟、可用率与模型真伪验真上同台竞争：

| 对比维度 | 单一厂商 $200/月 包月订阅（如 Claude Max） | 在 NextMux 充值 $200 美元（按量计费 · 永不过期） |
| :--- | :--- | :--- |
| **Claude Opus 5.5 成本** | 固定 **$200/月**（按月强制清零，不退不攒） | 中转市场低至 **0.1x – 0.2x 倍率**（**$200 相当于官方 $1,000–$2,000 额度**，可用数月，**余额永不过期**） |
| **全系顶尖编程与推理模型** | 仅限单一厂商模型 | 同一余额自由切换 **Claude Opus 5.5**、**GPT-5.6**、**Gemini 3.1 Pro**、**DeepSeek V4.1**、**Grok 4.20**、**Qwen 3.6** |
| **无审查（Uncensored）模型** | 严格内容过滤 / 不提供 | 直接调用多款 **无审查（Uncensored）** 文本、角色扮演、生图与视频模型，满足小说、剧本与自由创作需求 |
| **漫剧生图、视频与配音模型** | 不包含 | 同一账户直接调用 **Seedream 5.0**、**Flux**、**可灵 Kling 2.1**、**Veo 3**、**Wan 2.6**、**Suno 音乐**、**CosyVoice 配音** |
| **可用率与模型真伪验真** | 黑盒限流 | 实时展示每个中转节点的 **可用率 %**、**首字延迟 (ms)** 与 **模型真伪验真（Authenticity）** 徽章 |
| **自带 Key (BYOK) 与本地模型** | 不支持 | 零平台抽成接入个人 OpenAI / Anthropic / Gemini / 兼容 API Key 或本地 **Ollama** 模型 |

---

## 实机演示视频与产品截图

### 内嵌桌面软件与游戏自动化演示（《英雄联盟》+ JEV 客户端）

NextMux 可直接将本机运行的桌面软件或游戏窗口内嵌至会话标签页中，实时感知画面并由 JEV 独立键鼠通道执行后台自动化操控——JEV 的键鼠控制权与系统物理鼠标键盘完全独立、互不干扰（绝不抢占你正在使用的鼠标与键盘），且默认自动静音后台窗口：

<table>
<tr>
<td width="50%" align="center" valign="middle">
<img src="./assets/showcase/nextmux-lol-jev-demo-preview.gif" alt="NextMux 桌面软件与英雄联盟游戏自动化演示 GIF" width="100%" />
<br />
<sub><b>动态 GIF 预览（自动循环播放）</b></sub>
</td>
<td width="50%" align="center" valign="middle">

https://github.com/user-attachments/assets/9e24568a-bde0-46b6-8eb5-0bf5da6804f0

<sub><b>▶ 点击上方播放器直接播放有声高清演示视频（1440×900 60fps · 可开声音）</b></sub>
</td>
</tr>
</table>

---

### 1. AI 编程主工作台与 Git Diff 审查抽屉

多项目会话管理、工具调用实时追踪、内置原生终端，以及右侧分栏 Git Diff 逐块审查与暂存。

![NextMux AI 编程主工作台](./assets/showcase/01-macos-main-workbench.png)

### 2. 全球中转市场与实时路由切换抽屉

直观对比各中转商的实时可用率、模型真伪验真、首字延迟、思考深度（`low` / `medium` / `high` / `max`）、“自动最优”智能路由及价格倍率（`0.1x`–`1.0x`）。

https://github.com/user-attachments/assets/ad7551a4-f026-49a7-af77-fe1ec3ede348

![NextMux 中转市场与模型选择器](./assets/showcase/02-macos-relay-selector-drawer.png)

### 3. 臭皮匠模式（Council Mode）— 多智能体协同思辨

在同一任务下指派不同角色的子智能体（如系统架构师、安全审计员、性能工程师），分别挂载不同前沿模型并行交叉质询、辩论并收敛出最优方案。

https://github.com/user-attachments/assets/21730d54-9c7c-4496-8c52-e651b4ea20f8

![NextMux 臭皮匠模式](./assets/showcase/03-macos-council-mode.png)

### 4. 桌面应用与游戏内嵌插件视口

将任意 macOS 或 Windows 原生应用/游戏挂载到会话标签页内（支持“只在标签 / 也在桌面”切换、独立键鼠通道开关、后台默认静音及插件市场扩展，自动化操控与系统物理键鼠完全独立、互不影响）。

![NextMux 游戏与桌面插件内嵌视口](./assets/showcase/04-macos-plugin-lol-game.png)

### 5. 漫剧工作台 — 节点式无限画布（Infinite Canvas）

从空画布新建视频节点、配置运镜与提示词、选择模型生成分镜，并通过节点连线自动提取承接上一镜头的尾帧（Last Frame），保持人物与光影连贯。

https://github.com/user-attachments/assets/a71b55cf-17e3-4dc3-8cbf-5459afc54d77

![NextMux 漫剧无限画布](./assets/showcase/05-macos-comic-infinite-canvas.png)

### 6. 漫剧多轨视频时间线剪辑台

画布生成的镜头一键送入内置多轨时间线剪辑台（`字幕`、`画面`、`配音`、`音效`、`音乐` 五轨联动），支持 16:9 实时字幕预览、右侧属性检查器与 FFmpeg 硬件加速导出成片。

![NextMux 漫剧多轨时间线剪辑台](./assets/showcase/06-macos-comic-timeline-editor.png)

---

## 客户端下载（`v0.1.8` 四架构独立构建）

每个发布版本均针对不同操作系统与 CPU 架构独立编译、打包并校验原生二进制边界。您可直接从 **[官网下载页 (nextmux.app/download)](https://nextmux.app/download)** 或 **GitHub Releases** 获取安装包：

| 操作系统 | CPU 架构 | GitHub Release 安装包下载 | 官网高速直链 (`nextmux.app`) |
| :--- | :--- | :--- | :--- |
| **macOS** (`12.0+`) | Apple 芯片 (`darwin-arm64`) | [`NextMux-0.1.8-arm64.dmg`](https://github.com/goodman-xh/NextMux/releases/download/v0.1.8/NextMux-0.1.8-arm64.dmg) | [官网直链下载](https://nextmux.app/updates/releases/v0.1.8/macos/arm64/NextMux-0.1.8-arm64.dmg) |
| **macOS** (`12.0+`) | Intel 芯片 (`darwin-x64`) | [`NextMux-0.1.8-x64.dmg`](https://github.com/goodman-xh/NextMux/releases/download/v0.1.8/NextMux-0.1.8-x64.dmg) | [官网直链下载](https://nextmux.app/updates/releases/v0.1.8/macos/x64/NextMux-0.1.8-x64.dmg) |
| **Windows** (`10 / 11`) | x64 (`win32-x64`) | [`NextMux-0.1.8-x64-setup.exe`](https://github.com/goodman-xh/NextMux/releases/download/v0.1.8/NextMux-0.1.8-x64-setup.exe) | [官网直链下载](https://nextmux.app/updates/releases/v0.1.8/windows/x64/NextMux-0.1.8-x64-setup.exe) |
| **Windows** (`11`) | ARM64 (`win32-arm64`) | [`NextMux-0.1.8-arm64-setup.exe`](https://github.com/goodman-xh/NextMux/releases/download/v0.1.8/NextMux-0.1.8-arm64-setup.exe) | [官网直链下载](https://nextmux.app/updates/releases/v0.1.8/windows/arm64/NextMux-0.1.8-arm64-setup.exe) |

> 已安装的桌面端会在后台自动检测 `https://nextmux.app/updates`，当发现新版本时会在左下角账户栏旁显示圆角蓝色 **“更新”** 按钮，支持后台静默下载与一键升级。

---

## 开源 UI 界面代码结构

本仓库对外开源 NextMux 桌面端的**前端 UI 界面组件、工作台交互视图、12 语言界面文案、深浅色样式体系与启动动画视觉资源**；四架构桌面端完整安装包通过 [GitHub Releases](https://github.com/goodman-xh/NextMux/releases) 与 [官网下载页 (nextmux.app/download)](https://nextmux.app/download) 官方构建分发：

```text
NextMux/
├── apps/
│   └── desktop/
│       └── splash/                   # 启动画面 WebGL / Canvas 视觉动画与纹理贴图
├── assets/                           # 品牌标识、实机界面截图与功能演示视频
└── packages/
    └── theia-nextmux-extension/
        └── src/
            ├── browser/              # 编程主工作台、中转商与模型抽屉、臭皮匠模式、漫剧创作台与 12 语言界面文案
            │   └── style/            # 深浅色主题设计令牌、组件布局样式表与厂商图标
            └── styles.d.ts           # 前端视图桥接与静态资源 TypeScript 类型声明
```

---

## 开源与商业授权许可

本项目采用 [Apache License 2.0 with Commons Clause v1.0（非商业服务限制许可）](./LICENSE) 发布：免费支持个人使用、学术研究、插件开发与内部自用；**严禁在未获得 NextMux 官方书面授权的情况下将本项目（或其衍生版本）作为商业服务、SaaS 托管平台或商业分发版本提供给其他用户**（商业合作与授权请联系 [nextmux.app](https://www.nextmux.app)）。第三方组件声明详见 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)。
