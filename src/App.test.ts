import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.svelte";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("./lib/tauri", () => ({
  abortStream: vi.fn(),
  deleteEndpoint: vi.fn(),
  discoverEndpointModels: vi.fn(),
  exportData: vi.fn(),
  importData: vi.fn(),
  listAppState: vi.fn(),
  saveConversation: vi.fn(),
  saveEndpoint: vi.fn(),
  saveRoute: vi.fn(),
  streamChatViaRoute: vi.fn(),
  testEndpointConnectivity: vi.fn(),
}));

import { listAppState, streamChatViaRoute } from "./lib/tauri";

function createSnapshot() {
  return {
    schemaVersion: 2,
    endpoints: [
      {
        id: "ep-1",
        name: "Primary endpoint",
        providerKind: "openai-compatible" as const,
        baseUrl: "https://api.example.com",
        apiKey: "secret",
        enabled: true,
        defaultModel: "gpt-4.1-mini",
      },
    ],
    routes: [
      {
        id: "route-1",
        name: "smart-general",
        strategy: "priority_failover" as const,
        targetIds: ["target-1"],
      },
      {
        id: "route-2",
        name: "fast-fallback",
        strategy: "priority_failover" as const,
        targetIds: ["target-2"],
      },
    ],
    routeTargets: [
      {
        id: "target-1",
        endpointId: "ep-1",
        model: "gpt-4.1-mini",
        priority: 0,
        enabled: true,
      },
      {
        id: "target-2",
        endpointId: "ep-1",
        model: "gpt-4.1-nano",
        priority: 0,
        enabled: true,
      },
    ],
    conversations: [],
    discoveredModels: [],
    healthReports: [],
  };
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listAppState).mockResolvedValue(createSnapshot());
  });

  it("renders the single-workspace shell", async () => {
    render(App);

    await waitFor(() => {
      expect(screen.getByText("Tauri Studio")).toBeInTheDocument();
    });

    expect(screen.getByText("Planned payload")).toBeInTheDocument();
    expect(screen.getByText("Endpoint signal")).toBeInTheDocument();
  });

  it("keeps streamed chunks in order", async () => {
    vi.mocked(streamChatViaRoute).mockImplementation(async ({ requestId, messageId, routeId, onEvent }) => {
      onEvent({ event: "start", data: { requestId, messageId } });
      onEvent({
        event: "meta",
        data: { requestId, messageId, routeId, endpointId: "ep-1", model: "gpt-4.1-mini" },
      });
      onEvent({ event: "delta", data: { requestId, messageId, textChunk: "你" } });
      onEvent({ event: "delta", data: { requestId, messageId, textChunk: "好" } });
      onEvent({ event: "stop", data: { requestId, messageId } });
    });

    render(App);

    await waitFor(() => {
      expect(screen.getByLabelText("Prompt")).toBeInTheDocument();
    });

    await fireEvent.input(screen.getByLabelText("Prompt"), {
      target: { value: "你好" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getAllByText("你好").length).toBeGreaterThan(1);
    });
  });

  it("updates route selection from the composer", async () => {
    render(App);

    await waitFor(() => {
      expect(screen.getByLabelText("Route")).toBeInTheDocument();
    });

    await fireEvent.change(screen.getByLabelText("Route"), {
      target: { value: "route-2" },
    });

    await waitFor(() => {
      expect(screen.getByText("route / fast-fallback")).toBeInTheDocument();
    });
  });
});
