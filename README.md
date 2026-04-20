# Tauri Studio

极简桌面 LLM 聊天客户端，目标是把本地对话工作流压缩到最小闭环：

- 单窗口，两栏布局
- 只支持 OpenAI-compatible `chat/completions`
- Rust 代理流式请求，前端通过 Tauri channel 接收增量输出
- 本地保存设置和会话
- JSON 导入 / 导出

## Stack

- Tauri v2
- React 19 + TypeScript + Vite
- Rust thin layer for streaming, storage, and file operations

## Local Development

```powershell
npm install
npm run tauri dev
```

## Validation

```powershell
npm test
npm run build
cd src-tauri
cargo test
```

## Data Model

- Settings: `baseUrl`, `apiKey`, `model`, optional `systemPrompt`
- Sessions: `id`, `title`, timestamps, and ordered messages
- Export format: versioned JSON blob with `schemaVersion`, `settings`, and `sessions`

## Release

仓库包含两个 GitHub Actions 工作流：

- `ci.yml`: Windows 上跑前端测试、前端构建、Rust 测试
- `release.yml`: 使用 `tauri-apps/tauri-action@v1` 在 tag 推送时构建并上传 Windows bundle 到 GitHub Releases
