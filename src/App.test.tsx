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

import { loadSessions, loadSettings } from "./lib/tauri";

describe("App", () => {
  beforeEach(() => {
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
});
