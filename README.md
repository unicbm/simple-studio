# Tauri Studio

Minimal desktop LLM chat client built with `Tauri v2`, `React`, `TypeScript`, and `Rust`.

## Scope

Tauri Studio keeps the surface area intentionally small:

- single-window chat client
- OpenAI-compatible `chat/completions`
- streaming responses through Tauri channels
- local settings and session persistence
- JSON import / export
- Windows-first development and packaging

## Public Repo Notes

- This repository is safe to publish, but the app stores your configured `apiKey` locally on your machine for runtime use.
- New JSON exports intentionally omit `apiKey`, but exported chat history can still contain sensitive prompts or model output.
- Do not commit ad-hoc local exports, copied app data, `.env` files, or recovered `*.corrupt.*.json` files.
- Remote providers must use `https://`. Plain `http://` is only accepted for local loopback targets such as `localhost`, `127.0.0.1`, or `::1`.

Out of scope for this repository:

- MCP
- RAG / knowledge base
- plugin system
- assistant marketplace
- multi-model compare
- local model management
- file parsing and multimodal workflows

## Feature Set

### Chat

- session list
- create / delete session
- streaming output
- stop generation
- retry last turn

### Rendering

- Markdown
- fenced code blocks
- copy code

### Settings

- `baseUrl`
- `apiKey`
- `model`
- optional `systemPrompt`

### Local Data

- persisted settings
- persisted sessions
- export snapshot as JSON
- import snapshot from JSON
- corrupted app data backup and recovery

## Stack

- `Tauri v2`
- `React 19`
- `TypeScript`
- `Vite`
- `Rust`
- `reqwest`
- `Vitest`
- `Testing Library`

## Repository Layout

```text
.
├─ src/
│  ├─ components/
│  ├─ lib/
│  ├─ App.tsx
│  └─ App.css
├─ src-tauri/
│  └─ src/lib.rs
├─ AGENTS.md
└─ README.md
```

## Development

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

Desktop debug bundle:

```powershell
npm run tauri build -- --debug
```

## Provider Configuration

The current client expects a single OpenAI-compatible endpoint:

- `baseUrl`
- `apiKey`
- `model`

Example:

- `https://api.deepseek.com`
- `deepseek-chat`

## Data Model

```ts
type AppSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt?: string;
};

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

type ExportBlob = {
  schemaVersion: number;
  settings: AppSettings;
  sessions: ChatSession[];
};
```

New exports intentionally omit `apiKey`. Re-enter the key after importing on another machine.

## Build Output

Debug bundle output:

- `src-tauri/target/debug/bundle/msi/`
- `src-tauri/target/debug/bundle/nsis/`

## Roadmap

- stronger streaming regression coverage
- tighter error and recovery paths
- clearer settings feedback
- optional theme switcher
- automated release pipeline

## License

MIT
