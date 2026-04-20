# Tauri Studio Agent Guide

This file defines repo-specific defaults for agents working in this repository.

## Product Shape

- This repo is a minimal desktop LLM chat client, not a full Cherry Studio clone.
- Keep the scope narrow: single-window chat, OpenAI-compatible `chat/completions`, local persistence, JSON import/export.
- Do not introduce MCP, RAG, plugin systems, file parsing, multi-model compare, theme systems, or other platform features unless the user explicitly asks for them.

## Tech Boundaries

- Frontend: React 19 + TypeScript + Vite.
- Desktop shell: Tauri v2.
- Backend: Rust thin layer for streaming requests, persistence, and file operations.
- Prefer implementing product behavior in React/TypeScript. Keep Rust changes narrowly scoped to:
  - OpenAI-compatible request handling
  - streaming/channel transport
  - local file persistence and import/export
  - small app-level integrations needed by Tauri

## Working Style

- Preserve the current architecture split: UI and interaction work belongs in `src/`; Tauri commands and persistence belong in `src-tauri/src/lib.rs`.
- Avoid pushing presentation concerns into Rust.
- For UI work, prioritize desktop productivity-tool ergonomics over decorative visuals.
- When redesigning UI, use Cherry Studio only as a layout and usability reference, not as a copy target.

## Key Files

- `src/App.tsx`: top-level app container and page-level state orchestration.
- `src/components/`: chat shell, navigation, session list, composer, settings, markdown rendering.
- `src/lib/chatState.ts`: frontend chat/session state helpers.
- `src/lib/tauri.ts`: typed Tauri invoke wrappers.
- `src-tauri/src/lib.rs`: Tauri command implementations, streaming, persistence, import/export.

## Commands

- Install deps: `npm install`
- Frontend dev server: `npm run dev`
- Desktop app dev: `npm run tauri dev`
- Frontend tests: `npm test`
- Frontend build: `npm run build`
- Rust tests: `cd src-tauri; cargo test`
- Desktop debug bundle: `npm run tauri build -- --debug`

## Validation Rules

- For frontend-only changes, run at minimum:
  - `npm test`
  - `npm run build`
- For Rust or Tauri command changes, also run:
  - `cd src-tauri; cargo test`
- For non-trivial desktop UX or packaging work, prefer also running:
  - `npm run tauri build -- --debug`
- If a required validation cannot run, say exactly which command was skipped and why.

## Tests

- Keep pure state logic covered in `src/lib/*.test.ts`.
- Keep UI/component behavior covered with Vitest + Testing Library in `src/**/*.test.tsx`.
- Prefer adding tests for view switching, settings validation, session interactions, and markdown/code-copy behavior when touching those areas.

## Git

- Commit coherent units of work after validation passes.
- Do not amend commits unless explicitly asked.
- Do not reintroduce `.github/workflows/*` changes unless the user explicitly asks and the available GitHub credentials can push workflow files.
