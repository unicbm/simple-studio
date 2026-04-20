import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsSheet } from "./SettingsSheet";

describe("SettingsSheet", () => {
  it("blocks invalid settings and surfaces validation messages", () => {
    const onSave = vi.fn();

    render(
      <SettingsSheet
        isOpen
        initialSettings={{ baseUrl: "", apiKey: "", model: "", systemPrompt: "" }}
        onClose={() => undefined}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByText("Save Settings"));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Base URL is required.")).toBeInTheDocument();
  });

  it("saves valid settings", () => {
    const onSave = vi.fn();

    render(
      <SettingsSheet
        isOpen
        initialSettings={{ baseUrl: "", apiKey: "", model: "", systemPrompt: "" }}
        onClose={() => undefined}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("https://api.openai.com"), {
      target: { value: "https://api.example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("sk-..."), {
      target: { value: "secret" },
    });
    fireEvent.change(screen.getByPlaceholderText("gpt-4.1-mini"), {
      target: { value: "demo-model" },
    });
    fireEvent.click(screen.getByText("Save Settings"));

    expect(onSave).toHaveBeenCalledWith({
      baseUrl: "https://api.example.com",
      apiKey: "secret",
      model: "demo-model",
      systemPrompt: "",
    });
  });
});
