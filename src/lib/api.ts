import type { AppSettings, BootstrapPayload, Conversation, StreamEvent } from "../types";

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function getBootstrap() {
  return request<BootstrapPayload>("/api/bootstrap");
}

export function getSettings() {
  return request<AppSettings>("/api/settings");
}

export function saveSettings(settings: AppSettings) {
  return request<AppSettings>("/api/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export function createConversation() {
  return request<Conversation>("/api/conversations", {
    method: "POST",
  });
}

export function renameConversation(conversationId: string, title: string) {
  return request<Conversation>(`/api/conversations/${conversationId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export async function deleteConversation(conversationId: string) {
  const response = await fetch(`/api/conversations/${conversationId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Delete failed with ${response.status}`);
  }
}

function consumeSseFrames(buffer: string, onFrame: (json: string) => void) {
  let remaining = buffer;
  let separatorIndex = remaining.indexOf("\n\n");

  while (separatorIndex >= 0) {
    const frame = remaining.slice(0, separatorIndex);
    remaining = remaining.slice(separatorIndex + 2);

    const payload = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");

    if (payload) {
      onFrame(payload);
    }

    separatorIndex = remaining.indexOf("\n\n");
  }

  return remaining;
}

export async function streamChat(options: {
  conversationId: string;
  input: string;
  settings?: AppSettings;
  signal?: AbortSignal;
  onEvent: (event: StreamEvent) => void;
}) {
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      conversationId: options.conversationId,
      input: options.input,
      settings: options.settings,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Chat request failed with ${response.status}`);
  }

  if (!response.body) {
    throw new Error("Streaming response body is not available.");
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    buffer = consumeSseFrames(buffer, (payload) => {
      options.onEvent(JSON.parse(payload) as StreamEvent);
    });
  }
}
