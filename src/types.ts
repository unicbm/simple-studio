export type ProviderKind = "openai-compatible";
export type MessageRole = "system" | "user" | "assistant";
export type MessageStatus = "done" | "streaming" | "error";
export type ConnectivityStatus =
  | "healthy"
  | "auth_error"
  | "unreachable"
  | "partial"
  | "rate_limited"
  | "degraded";
export type RouteStrategy = "priority_failover";
export type TokenConfidence = "exact" | "close" | "rough";
export type TokenSource = "provider" | "local" | "heuristic";

export interface EndpointProfile {
  id: string;
  name: string;
  providerKind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  defaultModel?: string;
}

export interface RouteTarget {
  id: string;
  endpointId: string;
  model: string;
  priority: number;
  enabled: boolean;
}

export interface Route {
  id: string;
  name: string;
  strategy: RouteStrategy;
  targetIds: string[];
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  status: MessageStatus;
  includedInContext: boolean;
  pinned: boolean;
  summaryAnchor?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  routeId: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

export interface DiscoveredModel {
  id: string;
  endpointId: string;
  modelName: string;
  contextWindow?: number;
  discoveredAt: string;
}

export interface ConnectivityReport {
  endpointId: string;
  status: ConnectivityStatus;
  latencyMs?: number;
  firstTokenMs?: number;
  message: string;
  testedAt: string;
}

export interface TokenEstimate {
  input: number;
  reserveOutput: number;
  totalPlanned: number;
  confidence: TokenConfidence;
  source: TokenSource;
  maxContext: number;
}

export interface RequestMessage {
  role: MessageRole;
  content: string;
}

export interface AppStateSnapshot {
  schemaVersion: number;
  endpoints: EndpointProfile[];
  routes: Route[];
  routeTargets: RouteTarget[];
  conversations: Conversation[];
  discoveredModels: DiscoveredModel[];
  healthReports: ConnectivityReport[];
}

export type StreamEvent =
  | { event: "start"; data: { requestId: string; messageId: string } }
  | {
      event: "meta";
      data: { requestId: string; messageId: string; routeId: string; endpointId: string; model: string };
    }
  | { event: "delta"; data: { requestId: string; messageId: string; textChunk: string } }
  | { event: "error"; data: { requestId: string; messageId: string; message: string } }
  | { event: "stop"; data: { requestId: string; messageId: string } };

export interface StreamChatViaRouteInput {
  requestId: string;
  conversationId: string;
  routeId: string;
  messageId: string;
  messages: RequestMessage[];
  onEvent: (event: StreamEvent) => void;
}
