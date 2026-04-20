import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsView } from "./SettingsView";

describe("SettingsView", () => {
  it("blocks invalid settings and surfaces validation messages", () => {
    const onSave = vi.fn();

    render(
      <SettingsView
        errorMessage={null}
        initialSettings={{ baseUrl: "", apiKey: "", model: "", systemPrompt: "" }}
        onBack={() => undefined}
        onExport={() => undefined}
        onImport={() => undefined}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByText("Save settings"));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Base URL is required.")).toBeInTheDocument();
  });

  it("saves valid settings", () => {
    const onSave = vi.fn();

    render(
      <SettingsView
        errorMessage={null}
        initialSettings={{ baseUrl: "", apiKey: "", model: "", systemPrompt: "" }}
        onBack={() => undefined}
        onExport={() => undefined}
        onImport={() => undefined}
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
    fireEvent.click(screen.getByText("Save settings"));

    expect(onSave).toHaveBeenCalledWith({
      baseUrl: "https://api.example.com",
      apiKey: "secret",
      model: "demo-model",
      systemPrompt: "",
    });
  });

  it("rejects remote HTTP endpoints", () => {
    const onSave = vi.fn();

    render(
      <SettingsView
        errorMessage={null}
        initialSettings={{ baseUrl: "", apiKey: "", model: "", systemPrompt: "" }}
        onBack={() => undefined}
        onExport={() => undefined}
        onImport={() => undefined}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("https://api.openai.com"), {
      target: { value: "http://api.example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("sk-..."), {
      target: { value: "secret" },
    });
    fireEvent.change(screen.getByPlaceholderText("gpt-4.1-mini"), {
      target: { value: "demo-model" },
    });
    fireEvent.click(screen.getByText("Save settings"));

    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Base URL must use HTTPS unless it targets localhost or another loopback address.",
      ),
    ).toBeInTheDocument();
  });
});
