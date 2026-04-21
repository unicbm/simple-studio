import { describe, expect, it } from "vitest";
import {
  buildRequestMessages,
  createConversation,
  createMessage,
  createTokenEstimate,
  findRouteTarget,
} from "./workspace";
import type { AppStateSnapshot, Conversation } from "../types";

function makeConversation(): Conversation {
  return {
    ...createConversation("route-1"),
    messages: [
      { ...createMessage("user", "Visible prompt"), status: "done", includedInContext: true },
      { ...createMessage("assistant", "Excluded response"), status: "done", includedInContext: false },
      { ...createMessage("user", "Pinned note"), status: "done", includedInContext: false, pinned: true },
    ],
  };
}

describe("workspace helpers", () => {
  it("builds request payload from included and pinned messages", () => {
    const payload = buildRequestMessages(makeConversation());

    expect(payload).toHaveLength(2);
    expect(payload[0].content).toBe("Visible prompt");
    expect(payload[1].content).toBe("Pinned note");
  });

  it("updates token estimate with draft changes", () => {
    const conversation = makeConversation();
    const base = createTokenEstimate(conversation, "");
    const withDraft = createTokenEstimate(conversation, "Adding more context here");

    expect(withDraft.input).toBeGreaterThan(base.input);
    expect(withDraft.confidence).toBe("close");
  });

  it("picks the highest-priority enabled route target", () => {
    const snapshot: AppStateSnapshot = {
      schemaVersion: 2,
      endpoints: [],
      routes: [
        {
          id: "route-1",
          name: "general",
          strategy: "priority_failover",
          targetIds: ["t-2", "t-1"],
        },
      ],
      routeTargets: [
        { id: "t-1", endpointId: "ep-1", model: "gpt-a", priority: 2, enabled: true },
        { id: "t-2", endpointId: "ep-2", model: "gpt-b", priority: 0, enabled: true },
      ],
      conversations: [],
      discoveredModels: [],
      healthReports: [],
    };

    expect(findRouteTarget(snapshot, "route-1")?.id).toBe("t-2");
  });
});
