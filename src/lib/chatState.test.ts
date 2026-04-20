import { describe, expect, it } from "vitest";
import {
  appendAssistantChunk,
  buildRequestMessages,
  findRetryTarget,
  makeTitleFromContent,
  validateSettings,
} from "./chatState";
import type { ChatSession } from "../types";

describe("chatState", () => {
  it("validates settings", () => {
    expect(validateSettings({ baseUrl: "", apiKey: "", model: "" })).toContain(
      "Base URL is required.",
    );
  });

  it("creates compact session titles", () => {
    expect(makeTitleFromContent("  explain    tauri channels in detail  ")).toBe(
      "explain tauri channels in detail",
    );
  });

  it("appends stream chunks to assistant messages", () => {
    const session: ChatSession = {
      id: "1",
      title: "Untitled",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "Hel",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };

    expect(appendAssistantChunk(session, "m1", "lo").messages[0].content).toBe("Hello");
  });

  it("builds request messages with optional system prompt", () => {
    expect(
      buildRequestMessages(
        [
          {
            id: "1",
            role: "user",
            content: "Hi",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        "Be concise.",
      )[0],
    ).toEqual({ role: "system", content: "Be concise." });
  });

  it("finds the last retryable user and assistant pair", () => {
    const session: ChatSession = {
      id: "1",
      title: "Retry",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      messages: [
        {
          id: "u1",
          role: "user",
          content: "Hello",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "a1",
          role: "assistant",
          content: "Hi",
          createdAt: "2026-01-01T00:00:01.000Z",
        },
      ],
    };

    expect(findRetryTarget(session)?.assistant.id).toBe("a1");
  });
});
