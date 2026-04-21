import type { AppSettings, Conversation, Message, MessageRole } from "../types";

export const DEFAULT_SETTINGS: AppSettings = {
  baseUrl: "",
  apiKey: "",
  model: "gpt-4.1-mini",
  systemInstruction: "",
  temperature: 1,
  maxOutputTokens: 4096,
  stream: true,
};

export function createLocalMessage(role: MessageRole, content: string, status: Message["status"]): Message {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
    status,
  };
}

export function replaceConversation(
  conversations: Conversation[],
  nextConversation: Conversation,
): Conversation[] {
  const existing = conversations.some((conversation) => conversation.id === nextConversation.id);
  const next = existing
    ? conversations.map((conversation) =>
        conversation.id === nextConversation.id ? nextConversation : conversation,
      )
    : [nextConversation, ...conversations];

  return next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function updateConversation(
  conversations: Conversation[],
  conversationId: string,
  updater: (conversation: Conversation) => Conversation,
): Conversation[] {
  return conversations.map((conversation) =>
    conversation.id === conversationId ? updater(conversation) : conversation,
  );
}

export function makeConversationTitle(input: string) {
  const compact = input.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 42) : "New chat";
}

export function validateSettings(settings: AppSettings) {
  const errors: string[] = [];

  if (!settings.baseUrl.trim()) {
    errors.push("Base URL is required.");
  }
  if (!settings.apiKey.trim()) {
    errors.push("API key is required.");
  }
  if (!settings.model.trim()) {
    errors.push("Model is required.");
  }
  if (settings.temperature < 0 || settings.temperature > 2) {
    errors.push("Temperature must be between 0 and 2.");
  }
  if (settings.maxOutputTokens < 1) {
    errors.push("Max output tokens must be greater than 0.");
  }

  return errors;
}
