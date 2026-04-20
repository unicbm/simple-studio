import type {
  AppSettings,
  ChatMessage,
  ChatSession,
  RequestMessage,
} from "../types";

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = normalizeHostname(hostname);
  if (!normalizedHostname) {
    return false;
  }

  if (
    normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".localhost") ||
    normalizedHostname === "::1"
  ) {
    return true;
  }

  const ipv4Match = normalizedHostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  return ipv4Match !== null && Number(ipv4Match[1]) === 127;
}

function isAllowedBaseUrl(value: string): boolean {
  const url = new URL(value);
  return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHostname(url.hostname));
}

export function validateSettings(settings: AppSettings): string[] {
  const errors: string[] = [];
  const trimmedBaseUrl = settings.baseUrl.trim();

  if (!trimmedBaseUrl) {
    errors.push("Base URL is required.");
  }
  if (!settings.apiKey.trim()) {
    errors.push("API key is required.");
  }
  if (!settings.model.trim()) {
    errors.push("Model is required.");
  }

  try {
    if (trimmedBaseUrl) {
      if (!isAllowedBaseUrl(trimmedBaseUrl)) {
        errors.push(
          "Base URL must use HTTPS unless it targets localhost or another loopback address.",
        );
      }
    }
  } catch {
    errors.push("Base URL must be a valid absolute URL.");
  }

  return errors;
}

export function isSettingsComplete(settings: AppSettings): boolean {
  return validateSettings(settings).length === 0;
}

export function createEmptySession(): ChatSession {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "Untitled",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function replaceSession(
  sessions: ChatSession[],
  nextSession: ChatSession,
): ChatSession[] {
  const existing = sessions.find((session) => session.id === nextSession.id);
  if (!existing) {
    return [nextSession, ...sessions];
  }

  return sessions
    .map((session) => (session.id === nextSession.id ? nextSession : session))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function makeTitleFromContent(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "Untitled";
  }
  return compact.slice(0, 48);
}

export function buildRequestMessages(
  messages: ChatMessage[],
  systemPrompt?: string,
): RequestMessage[] {
  const baseMessages = messages
    .filter((message) => message.role !== "assistant" || message.content.trim())
    .map<RequestMessage>((message) => ({
      role: message.role,
      content: message.content,
    }));

  if (!systemPrompt?.trim()) {
    return baseMessages;
  }

  return [{ role: "system", content: systemPrompt.trim() }, ...baseMessages];
}

export function appendAssistantChunk(
  session: ChatSession,
  messageId: string,
  chunk: string,
): ChatSession {
  return {
    ...session,
    updatedAt: new Date().toISOString(),
    messages: session.messages.map((message) =>
      message.id === messageId
        ? {
            ...message,
            content: `${message.content}${chunk}`,
            status: "streaming",
          }
        : message,
    ),
  };
}

export function findRetryTarget(session: ChatSession): {
  history: ChatMessage[];
  user: ChatMessage;
  assistant: ChatMessage;
} | null {
  for (let index = session.messages.length - 1; index >= 1; index -= 1) {
    const assistant = session.messages[index];
    const user = session.messages[index - 1];

    if (assistant.role === "assistant" && user.role === "user") {
      return {
        history: session.messages.slice(0, index - 1),
        user,
        assistant,
      };
    }
  }

  return null;
}
