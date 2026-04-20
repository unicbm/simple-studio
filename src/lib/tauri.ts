import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  ChatSession,
  ImportedData,
  StartChatStreamInput,
  StreamEvent,
} from "../types";

export async function loadSettings(): Promise<AppSettings> {
  return invoke("load_settings");
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await invoke("save_settings", { settings });
}

export async function loadSessions(): Promise<ChatSession[]> {
  return invoke("load_sessions");
}

export async function saveSession(session: ChatSession): Promise<void> {
  await invoke("save_session", { session });
}

export async function deleteSession(sessionId: string): Promise<void> {
  await invoke("delete_session", { sessionId });
}

export async function startChatStream(input: StartChatStreamInput): Promise<void> {
  const onEvent = new Channel<StreamEvent>();
  onEvent.onmessage = input.onEvent;

  await invoke("start_chat_stream", {
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
  await invoke("abort_stream", { requestId });
}

export async function exportData(path: string): Promise<void> {
  await invoke("export_data", { path });
}

export async function importData(path: string): Promise<ImportedData> {
  return invoke("import_data", { path });
}
