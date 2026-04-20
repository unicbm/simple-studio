import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionListPane } from "./SessionListPane";
import type { ChatSession } from "../types";

const sessions: ChatSession[] = [
  {
    id: "session-1",
    title: "First chat",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [],
  },
  {
    id: "session-2",
    title: "Second chat",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T01:00:00.000Z",
    messages: [],
  },
];

describe("SessionListPane", () => {
  it("shows active session state and delete action", () => {
    const onDeleteSession = vi.fn();

    render(
      <SessionListPane
        activeSessionId="session-2"
        onCreateSession={() => undefined}
        onDeleteSession={onDeleteSession}
        onSelectSession={() => undefined}
        sessions={sessions}
      />,
    );

    expect(screen.getByText("Second chat").closest(".session-item")).toHaveClass("active");

    fireEvent.click(screen.getByLabelText("Delete Second chat"));

    expect(onDeleteSession).toHaveBeenCalledWith("session-2");
  });
});
