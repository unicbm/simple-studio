# Simple Studio

Minimal desktop LLM workspace built with `Tauri v2`, `Svelte 5`, `TypeScript`, and `Rust`.

## Scope

Simple Studio is now a compact single-window workspace rather than a single-endpoint chat form. The MVP keeps the surface area narrow:

- single workspace with conversation rail, reading column, and context lens
- OpenAI-compatible endpoint management
- route-based chat with `priority_failover`
- model discovery through `GET /v1/models`
- connectivity testing with user-facing health states
- streaming responses through Tauri channels
- local JSON snapshot persistence
- JSON import / export
- Windows-first development and packaging

## Public Repo Notes

- This repository is safe to publish, but the app stores configured API keys locally for runtime use.
- JSON exports omit `apiKey`, but exported chat history can still contain sensitive prompts or model output.
- Do not commit ad-hoc local exports, copied app data, `.env` files, or recovered `*.corrupt.*.json` files.
- Remote providers must use `https://`. Plain `http://` is only accepted for local loopback targets such as `localhost`, `127.0.0.1`, or `::1`.

Out of scope for this MVP:

- Anthropic and Gemini adapters
- MCP, tools, plugin systems, or agent workflows
- RAG / knowledge base features
- SQLite / system keychain storage
- multi-window workflows
- multimodal file parsing

## Feature Set

### Workspace

- route rail and conversation rail
- document-style message stream
- settings drawer for endpoints, routes, and data actions
- context lens with include / exclude / pin controls
- token estimate and output reserve display

### Endpoints and Routes

- create / update / delete OpenAI-compatible endpoints
- create / update `priority_failover` routes
- one active route target per route in the MVP UI
- model discovery cache per endpoint
- connectivity test with `healthy`, `auth_error`, `unreachable`, `partial`, `rate_limited`, `degraded`

### Chat

- create conversation
- route-bound streaming chat
- stop generation
- Markdown rendering during streaming

### Local Data

- persisted app snapshot in JSON
- import / export snapshot as JSON
- legacy migration from `settings.json` + `sessions.json`
- corrupted state backup and recovery

## Stack

- `Tauri v2`
- `Svelte 5`
- `TypeScript`
- `Vite`
- `Rust`
- `reqwest`
- `Vitest`
- `@testing-library/svelte`

## Repository Layout

```text
.
├─ src/
│  ├─ components/
│  ├─ lib/
│  ├─ App.svelte
│  └─ app.css
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

## Provider Model

The current MVP supports OpenAI-compatible providers only.

An endpoint stores:

- `name`
- `baseUrl`
- `apiKey`
- `defaultModel`
- `enabled`

A route stores:

- `name`
- `strategy`
- `targetIds`

Each route target stores:

- `endpointId`
- `model`
- `priority`
- `enabled`

## Data Model

```ts
type EndpointProfile = {
  id: string;
  name: string;
  providerKind: "openai-compatible";
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  defaultModel?: string;
};

type Route = {
  id: string;
  name: string;
  strategy: "priority_failover";
  targetIds: string[];
};

type Message = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt: string;
  status: "done" | "streaming" | "error";
  includedInContext: boolean;
  pinned: boolean;
};

type Conversation = {
  id: string;
  title: string;
  routeId: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
};

type AppStateSnapshot = {
  schemaVersion: number;
  endpoints: EndpointProfile[];
  routes: Route[];
  routeTargets: RouteTarget[];
  conversations: Conversation[];
  discoveredModels: DiscoveredModel[];
  healthReports: ConnectivityReport[];
};
```

Exports omit `apiKey`. Re-enter the key after importing on another machine.

## Build Output

Debug bundle output:

- `src-tauri/target/debug/bundle/msi/`
- `src-tauri/target/debug/bundle/nsis/`

## Current MVP Limits

- only OpenAI-compatible endpoints are implemented
- only `priority_failover` routing is implemented
- route UI manages one primary target per route
- context lens supports `included / pinned / estimate`, not summary checkpoints
- persistence is JSON-based, not SQLite

## License

MIT
