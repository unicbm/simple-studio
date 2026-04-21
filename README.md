# Simple Studio

Simple Studio is a local browser playground for OpenAI-compatible models.

The UI runs in your browser on `localhost`, and the backend is a small Rust HTTP service. The first goal is not a desktop shell or a multi-endpoint workspace. It is a fast, usable AI Studio-style playground with:

- left-side history rail
- central chat / prompt area
- right-side run settings
- OpenAI-compatible streaming chat
- local JSON persistence for settings and conversations

## Stack

- `Svelte 5`
- `Vite`
- `Rust`
- `axum`
- `reqwest`
- `Vitest`

## Local Run

Start the Rust API:

```powershell
npm run api
```

Start the frontend:

```powershell
npm install
npm run dev
```

Then open:

```text
http://127.0.0.1:1420
```

Windows one-click launcher:

- [start-simple-studio.bat](C:/Users/Uni/Documents/Github/Tauri-Studio/start-simple-studio.bat)

## API Surface

The browser app talks to the Rust backend through local HTTP:

- `GET /api/bootstrap`
- `GET /api/settings`
- `PUT /api/settings`
- `GET /api/conversations`
- `POST /api/conversations`
- `PATCH /api/conversations/:id`
- `DELETE /api/conversations/:id`
- `POST /api/chat/stream`

`POST /api/chat/stream` returns `text/event-stream` frames with:

- `start`
- `delta`
- `error`
- `done`

## Data Model

```ts
type AppSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemInstruction: string;
  temperature: number;
  maxOutputTokens: number;
  stream: boolean;
};

type Message = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt: string;
  status: "done" | "streaming" | "error";
};

type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
};
```

Local data is stored in:

```text
./.simple-studio-data/
```

Files:

- `settings.json`
- `conversations.json`

If an older `app-state.json` exists in that same local data folder, the Rust backend migrates the usable parts into the new model.

## Validation

Frontend:

```powershell
npm test
npm run build
```

Backend:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

## Current Scope

Implemented:

- browser-first local playground
- AI Studio-inspired three-column layout
- single saved model configuration
- basic history management
- OpenAI-compatible streaming

Not implemented:

- Tauri desktop runtime as the main path
- multi-endpoint routing
- model discovery
- health diagnostics
- import / export
- RAG or tool calling

## License

MIT
