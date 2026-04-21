import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.svelte";

vi.mock("./lib/api", () => ({
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
  getBootstrap: vi.fn(),
  renameConversation: vi.fn(),
  saveSettings: vi.fn(),
  streamChat: vi.fn(),
}));

import {
  createConversation,
  getBootstrap,
  saveSettings,
  streamChat,
} from "./lib/api";

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getBootstrap).mockResolvedValue({
      settings: {
        baseUrl: "https://api.example.com",
        apiKey: "secret",
        model: "gpt-4.1-mini",
        systemInstruction: "",
        temperature: 1,
        maxOutputTokens: 4096,
        stream: true,
      },
      conversations: [],
    });
    vi.mocked(createConversation).mockResolvedValue({
      id: "conv-1",
      title: "New chat",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      messages: [],
    });
    vi.mocked(saveSettings).mockImplementation(async (settings) => settings);
  });

  it("renders the browser playground shell", async () => {
    render(App);

    await waitFor(() => {
      expect(screen.getByText("Simple Studio")).toBeInTheDocument();
    });

    expect(screen.getByText("Run settings")).toBeInTheDocument();
    expect(screen.getByText("Explore local prompts")).toBeInTheDocument();
  });

  it("saves run settings", async () => {
    render(App);

    await waitFor(() => {
      expect(screen.getByDisplayValue("https://api.example.com")).toBeInTheDocument();
    });

    await fireEvent.input(screen.getByDisplayValue("https://api.example.com"), {
      target: { value: "https://api.deepseek.com" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Save run settings" }));

    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalled();
    });
  });

  it("streams chat content in order", async () => {
    vi.mocked(streamChat).mockImplementation(async ({ onEvent, conversationId }) => {
      onEvent({
        event: "start",
        data: {
          conversationId,
          userMessageId: "user-1",
          assistantMessageId: "assistant-1",
        },
      });
      onEvent({
        event: "delta",
        data: {
          conversationId,
          messageId: "assistant-1",
          textChunk: "你",
        },
      });
      onEvent({
        event: "delta",
        data: {
          conversationId,
          messageId: "assistant-1",
          textChunk: "好",
        },
      });
      onEvent({
        event: "done",
        data: {
          conversationId,
          messageId: "assistant-1",
        },
      });
    });

    render(App);

    await waitFor(() => {
      expect(screen.getByLabelText("Prompt")).toBeInTheDocument();
    });

    await fireEvent.input(screen.getByLabelText("Prompt"), {
      target: { value: "你好" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(screen.getAllByText("你好").length).toBeGreaterThan(1);
    });
  });
});
