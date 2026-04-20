import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownMessage } from "./MarkdownMessage";

describe("MarkdownMessage", () => {
  it("copies code block content", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    render(<MarkdownMessage content={"```ts\nconst answer = 42;\n```"} />);

    fireEvent.click(screen.getByText("Copy"));

    expect(writeText).toHaveBeenCalledWith("const answer = 42;");
  });
});
