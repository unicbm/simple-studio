import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, makeConversationTitle, replaceConversation, validateSettings } from "./playground";

describe("playground helpers", () => {
  it("creates compact conversation titles", () => {
    expect(makeConversationTitle("  Hello    world  from   Simple Studio ")).toBe(
      "Hello world from Simple Studio",
    );
  });

  it("replaces and sorts conversations by update time", () => {
    const conversations = [
      {
        id: "a",
        title: "Older",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        messages: [],
      },
    ];

    const next = replaceConversation(conversations, {
      id: "b",
      title: "Newer",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      messages: [],
    });

    expect(next[0].id).toBe("b");
  });

  it("validates required settings", () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toContain("Base URL is required.");
  });
});
