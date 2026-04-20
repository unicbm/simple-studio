import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("./lib/tauri", () => ({
  abortStream: vi.fn(),
  deleteSession: vi.fn(),
  exportData: vi.fn(),
  importData: vi.fn(),
  loadSessions: vi.fn(),
  loadSettings: vi.fn(),
  saveSession: vi.fn(),
  saveSettings: vi.fn(),
  startChatStream: vi.fn(),
}));

import { loadSessions, loadSettings, startChatStream } from "./lib/tauri";

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadSettings).mockResolvedValue({
      baseUrl: "https://api.example.com",
      apiKey: "secret",
      model: "demo-model",
      systemPrompt: "",
    });
    vi.mocked(loadSessions).mockResolvedValue([]);
  });

  it("switches between chat and settings views", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("All chats")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByText("Connection and data")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));

    expect(screen.getByText("Start a conversation")).toBeInTheDocument();
  });

  it("keeps all streamed chunks in order", async () => {
    vi.mocked(startChatStream).mockImplementation(async ({ requestId, messageId, onEvent }) => {
      onEvent({ event: "started", data: { requestId, messageId } });
      onEvent({ event: "delta", data: { requestId, messageId, textChunk: "你" } });
      onEvent({ event: "delta", data: { requestId, messageId, textChunk: "好" } });
      onEvent({ event: "delta", data: { requestId, messageId, textChunk: "！" } });
      onEvent({ event: "done", data: { requestId, messageId } });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("All chats")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Type a message"), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText("你好！")).toBeInTheDocument();
    });
  });

  it("can start a second round after the first one finishes", async () => {
    vi.mocked(startChatStream)
      .mockImplementationOnce(async ({ requestId, messageId, onEvent }) => {
        onEvent({ event: "started", data: { requestId, messageId } });
        onEvent({ event: "delta", data: { requestId, messageId, textChunk: "First round" } });
        onEvent({ event: "done", data: { requestId, messageId } });
      })
      .mockImplementationOnce(async ({ requestId, messageId, onEvent }) => {
        onEvent({ event: "started", data: { requestId, messageId } });
        onEvent({ event: "delta", data: { requestId, messageId, textChunk: "Second round" } });
        onEvent({ event: "done", data: { requestId, messageId } });
      });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("All chats")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Type a message"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText("First round")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Type a message"), {
      target: { value: "again" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText("Second round")).toBeInTheDocument();
    });

    expect(startChatStream).toHaveBeenCalledTimes(2);
  });
});
