import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
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

  it("opens safe links externally", () => {
    render(<MarkdownMessage content="[OpenAI](https://openai.com)" />);

    fireEvent.click(screen.getByRole("link", { name: "OpenAI" }));

    expect(openUrl).toHaveBeenCalledWith("https://openai.com/");
  });

  it("blocks markdown images and unsafe link schemes", () => {
    render(<MarkdownMessage content={"![tracking pixel](https://example.com/pixel.png)\n\n[Run](javascript:alert(1))"} />);

    expect(screen.getByText("[tracking pixel omitted for safety]")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Run" })).not.toBeInTheDocument();
  });
});
