import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  ChatSession,
  ImportedData,
  StartChatStreamInput,
  StreamEvent,
} from "../types";

const TAURI_READY_TIMEOUT_MS = 2000;
const TAURI_READY_POLL_MS = 25;

let tauriReadyPromise: Promise<void> | null = null;

function hasTauriInvokeBridge() {
  const candidate = globalThis as typeof globalThis & {
    __TAURI_INTERNALS__?: {
      invoke?: unknown;
      transformCallback?: unknown;
    };
  };

  return (
    typeof candidate.__TAURI_INTERNALS__?.invoke === "function" &&
    typeof candidate.__TAURI_INTERNALS__?.transformCallback === "function"
  );
}

function createTauriUnavailableError() {
  return new Error(
    "Tauri bridge is not available. Start the desktop app with `npm run tauri dev` or reopen the packaged app.",
  );
}

async function ensureTauriReady() {
  if (hasTauriInvokeBridge()) {
    return;
  }

  if (!tauriReadyPromise) {
    tauriReadyPromise = new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        if (hasTauriInvokeBridge()) {
          window.clearInterval(timer);
          tauriReadyPromise = null;
          resolve();
          return;
        }

        if (Date.now() - startedAt >= TAURI_READY_TIMEOUT_MS) {
          window.clearInterval(timer);
          tauriReadyPromise = null;
          reject(createTauriUnavailableError());
        }
      }, TAURI_READY_POLL_MS);
    });
  }

  await tauriReadyPromise;
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>) {
  await ensureTauriReady();
  return invoke<T>(command, args);
}

export async function loadSettings(): Promise<AppSettings> {
  return invokeTauri<AppSettings>("load_settings");
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await invokeTauri("save_settings", { settings });
}

export async function loadSessions(): Promise<ChatSession[]> {
  return invokeTauri<ChatSession[]>("load_sessions");
}

export async function saveSession(session: ChatSession): Promise<void> {
  await invokeTauri("save_session", { session });
}

export async function deleteSession(sessionId: string): Promise<void> {
  await invokeTauri("delete_session", { sessionId });
}

export async function startChatStream(input: StartChatStreamInput): Promise<void> {
  await ensureTauriReady();
  const onEvent = new Channel<StreamEvent>();
  onEvent.onmessage = input.onEvent;

  await invokeTauri("start_chat_stream", {
    payload: {
      requestId: input.requestId,
      messageId: input.messageId,
      settings: input.settings,
      messages: input.messages,
    },
    onEvent,
  });
}

export async function abortStream(requestId: string): Promise<void> {
  await invokeTauri("abort_stream", { requestId });
}

export async function exportData(path: string): Promise<void> {
  await invokeTauri("export_data", { path });
}

export async function importData(path: string): Promise<ImportedData> {
  return invokeTauri<ImportedData>("import_data", { path });
}
