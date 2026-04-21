import type {
  AppStateSnapshot,
  Conversation,
  Message,
  MessageRole,
  RequestMessage,
  RouteTarget,
  TokenEstimate,
} from "../types";

export const DEFAULT_MAX_CONTEXT = 128_000;
export const DEFAULT_OUTPUT_RESERVE = 4_000;

export function createEmptySnapshot(): AppStateSnapshot {
  return {
    schemaVersion: 2,
    endpoints: [],
    routes: [],
    routeTargets: [],
    conversations: [],
    discoveredModels: [],
    healthReports: [],
  };
}

export function createBlankEndpoint() {
  return {
    id: crypto.randomUUID(),
    name: "New endpoint",
    providerKind: "openai-compatible" as const,
    baseUrl: "",
    apiKey: "",
    enabled: true,
    defaultModel: "",
  };
}

export function createBlankRoute() {
  return {
    route: {
      id: crypto.randomUUID(),
      name: "general-chat",
      strategy: "priority_failover" as const,
      targetIds: [],
    },
    targets: [],
  };
}

export function createConversation(routeId: string): Conversation {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "Untitled conversation",
    routeId,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function createMessage(role: MessageRole, content: string): Message {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
    status: role === "assistant" ? "streaming" : "done",
    includedInContext: true,
    pinned: false,
    summaryAnchor: false,
  };
}

export function buildRequestMessages(conversation: Conversation): RequestMessage[] {
  return conversation.messages
    .filter((message) => (message.includedInContext || message.pinned) && message.content.trim())
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

export function makeConversationTitle(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 48) : "Untitled conversation";
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

export function appendAssistantChunk(
  conversation: Conversation,
  messageId: string,
  chunk: string,
): Conversation {
  return {
    ...conversation,
    updatedAt: new Date().toISOString(),
    messages: conversation.messages.map((message) =>
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

export function updateMessageFlags(
  conversation: Conversation,
  messageId: string,
  nextFlags: Partial<Pick<Message, "includedInContext" | "pinned">>,
): Conversation {
  return {
    ...conversation,
    updatedAt: new Date().toISOString(),
    messages: conversation.messages.map((message) =>
      message.id === messageId ? { ...message, ...nextFlags } : message,
    ),
  };
}

export function markMessageStatus(
  conversation: Conversation,
  messageId: string,
  status: Message["status"],
  overrideContent?: string,
): Conversation {
  return {
    ...conversation,
    updatedAt: new Date().toISOString(),
    messages: conversation.messages.map((message) =>
      message.id === messageId
        ? {
            ...message,
            status,
            content: overrideContent ?? message.content,
          }
        : message,
    ),
  };
}

export function estimateTextTokens(text: string) {
  const compact = text.trim();
  if (!compact) {
    return { tokens: 0, confidence: "rough" as const, source: "heuristic" as const };
  }

  const chineseCount = (compact.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const ratio = chineseCount / compact.length;
  const tokens = ratio > 0.15 ? Math.round(compact.length * 1.18) : Math.round(compact.length / 3.8);

  return {
    tokens,
    confidence: compact.length < 24 ? ("rough" as const) : ("close" as const),
    source: "heuristic" as const,
  };
}

export function createTokenEstimate(
  conversation: Conversation | null,
  draft: string,
  reserveOutput = DEFAULT_OUTPUT_RESERVE,
  maxContext = DEFAULT_MAX_CONTEXT,
): TokenEstimate {
  const messageTokens =
    conversation?.messages
      .filter((message) => message.includedInContext || message.pinned)
      .reduce((sum, message) => sum + estimateTextTokens(message.content).tokens, 0) ?? 0;
  const draftEstimate = estimateTextTokens(draft);
  const input = messageTokens + draftEstimate.tokens;

  return {
    input,
    reserveOutput,
    totalPlanned: input + reserveOutput,
    confidence: input === 0 ? "rough" : draftEstimate.confidence,
    source: draftEstimate.source,
    maxContext,
  };
}

export function findRouteTarget(snapshot: AppStateSnapshot, routeId: string): RouteTarget | null {
  const route = snapshot.routes.find((candidate) => candidate.id === routeId);
  if (!route) {
    return null;
  }

  const sortedTargets = route.targetIds
    .map((targetId) => snapshot.routeTargets.find((target) => target.id === targetId) ?? null)
    .filter((target): target is RouteTarget => target !== null && target.enabled)
    .sort((left, right) => left.priority - right.priority);

  return sortedTargets[0] ?? null;
}

export function syncRouteTarget(routeId: string, endpointId: string, model: string) {
  const targetId = crypto.randomUUID();
  return {
    route: {
      id: routeId,
      targetIds: [targetId],
    },
    target: {
      id: targetId,
      endpointId,
      model,
      priority: 0,
      enabled: true,
    },
  };
}
