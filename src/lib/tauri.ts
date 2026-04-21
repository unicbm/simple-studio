import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  AppStateSnapshot,
  ConnectivityReport,
  Conversation,
  DiscoveredModel,
  EndpointProfile,
  Route,
  RouteTarget,
  StreamChatViaRouteInput,
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

export async function listAppState(): Promise<AppStateSnapshot> {
  return invokeTauri<AppStateSnapshot>("list_app_state");
}

export async function saveEndpoint(endpoint: EndpointProfile): Promise<void> {
  await invokeTauri("save_endpoint", { endpoint });
}

export async function deleteEndpoint(endpointId: string): Promise<void> {
  await invokeTauri("delete_endpoint", { endpointId });
}

export async function testEndpointConnectivity(endpointId: string): Promise<ConnectivityReport> {
  return invokeTauri<ConnectivityReport>("test_endpoint_connectivity", { endpointId });
}

export async function discoverEndpointModels(endpointId: string): Promise<DiscoveredModel[]> {
  return invokeTauri<DiscoveredModel[]>("discover_endpoint_models", { endpointId });
}

export async function saveRoute(route: Route, targets: RouteTarget[]): Promise<void> {
  await invokeTauri("save_route", { route, targets });
}

export async function saveConversation(conversation: Conversation): Promise<void> {
  await invokeTauri("save_conversation", { conversation });
}

export async function streamChatViaRoute(input: StreamChatViaRouteInput): Promise<void> {
  await ensureTauriReady();
  const onEvent = new Channel<StreamEvent>();
  onEvent.onmessage = input.onEvent;

  await invokeTauri("stream_chat_via_route", {
    payload: {
      requestId: input.requestId,
      routeId: input.routeId,
      conversationId: input.conversationId,
      messageId: input.messageId,
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

export async function importData(path: string): Promise<AppStateSnapshot> {
  return invokeTauri<AppStateSnapshot>("import_data", { path });
}
