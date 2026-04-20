# Tauri Studio

Tauri Studio 是一个极简桌面 LLM 聊天客户端，基于 `Tauri v2 + React + TypeScript + Rust`。

它的目标不是复刻 Cherry Studio 的完整功能面，而是把本地 AI 对话工具压缩成一个足够干净、足够稳定、足够容易维护的最小闭环。

当前版本聚焦这几件事：

- 单窗口桌面聊天
- OpenAI-compatible `chat/completions`
- Rust 侧流式请求，前端实时增量渲染
- 本地保存设置与会话
- JSON 导入 / 导出
- Windows 优先开发与打包

## Project Goal

很多桌面 AI 客户端最后都会不断堆功能，逐渐变成一个“什么都做一点”的平台。这个仓库反过来做约束：

- 不做助手市场
- 不做 MCP
- 不做 RAG / 知识库
- 不做插件系统
- 不做多模型并排对话
- 不做文件解析和图像工作流

先把聊天客户端本身做对，再决定要不要继续扩。

## Current Features

### Chat

- 左侧会话列表，右侧聊天区，底部输入框
- 新建会话、删除会话
- 流式输出
- 停止生成
- 重试上一轮

### Rendering

- Markdown 渲染
- 围栏代码块
- 代码复制

### Settings

- `baseUrl`
- `apiKey`
- `model`
- 可选 `systemPrompt`

### Local Data

- 本地保存设置
- 本地保存会话
- 导出 JSON
- 导入 JSON
- 损坏数据文件自动备份并恢复为空状态

## Tech Stack

- `Tauri v2`
- `React 19`
- `TypeScript`
- `Vite`
- `Rust`
- `reqwest`
- `Vitest + Testing Library`

## Project Structure

```text
.
├─ src/
│  ├─ components/         # UI components
│  ├─ lib/                # frontend state helpers and Tauri wrappers
│  ├─ App.tsx             # top-level app orchestration
│  └─ App.css             # application styles
├─ src-tauri/
│  └─ src/lib.rs          # Tauri commands, streaming, persistence, import/export
├─ AGENTS.md              # repo-specific agent guide
└─ README.md
```

## Quick Start

### Prerequisites

你需要本机具备：

- `Node.js`
- `Rust / cargo`
- Tauri v2 对应的 Windows 构建环境

### Run In Development

```powershell
npm install
npm run tauri dev
```

如果你只运行：

```powershell
npm run dev
```

那只会打开普通前端页面，不会有 Tauri 的本地能力。

## Provider Configuration

当前只支持 OpenAI-compatible 接口。你需要提供：

- `baseUrl`
- `apiKey`
- `model`

例如：

- `https://api.deepseek.com`
- `deepseek-chat`

## Validation

前端改动至少运行：

```powershell
npm test
npm run build
```

涉及 Rust / Tauri 命令时，再运行：

```powershell
cd src-tauri
cargo test
```

如果要验证桌面打包：

```powershell
npm run tauri build -- --debug
```

## Build Output

当前本地可生成 Windows 安装产物：

- `.msi`
- `.exe` installer

调试构建产物默认位于：

- `src-tauri/target/debug/bundle/msi/`
- `src-tauri/target/debug/bundle/nsis/`

## Data Model

### Settings

```ts
type AppSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt?: string;
};
```

### Session

```ts
type ChatMessage = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt: string;
  status?: "done" | "streaming" | "error";
};

type ChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};
```

### Export Format

```ts
type ExportBlob = {
  schemaVersion: number;
  settings: AppSettings;
  sessions: ChatSession[];
};
```

## Product Boundaries

这个仓库当前明确不做：

- Cherry Studio 的 Electron 迁移版
- 通用 AI 工作台
- 插件平台
- 助手市场
- 本地模型管理器
- RAG 工作流

如果你需要这些，应该是另一个项目，而不是在这个仓库里继续无上限堆功能。

## Roadmap

### Near Term

- 更稳的流式链路回归测试
- 更完整的错误提示与恢复
- 更清晰的设置页反馈
- 可选主题切换：浅色 / 深色 / 跟随系统

### Later

- 更完整的发布流程文档
- 可选 GitHub Actions 自动构建
- 可选 GitHub Releases 自动上传

## About GitHub Actions And Releases

如果你不熟这两个概念，可以简单理解成：

- `GitHub Actions`：自动测试、自动构建的流水线
- `GitHub Releases`：把安装包挂到 GitHub 发布页供下载

它们不是运行这个项目的前置条件。

也就是说：

- 你现在本地开发，不需要它们
- 你现在本地打包，不需要它们
- 只有你想让 GitHub 自动帮你构建和发布时，才需要配置

## License

当前仓库未单独补充许可证文件前，请先按仓库实际状态处理。  
如果后续要正式开源分发，建议补一个明确的 `LICENSE`。
