import { useEffect, useState } from "react";
import { validateSettings } from "../lib/chatState";
import type { AppSettings } from "../types";

interface SettingsSheetProps {
  isOpen: boolean;
  initialSettings: AppSettings;
  onClose: () => void;
  onSave: (settings: AppSettings) => void;
}

export function SettingsSheet({
  isOpen,
  initialSettings,
  onClose,
  onSave,
}: SettingsSheetProps) {
  const [formState, setFormState] = useState<AppSettings>(initialSettings);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    setFormState(initialSettings);
  }, [initialSettings]);

  if (!isOpen) {
    return null;
  }

  function submit() {
    const nextErrors = validateSettings(formState);
    setErrors(nextErrors);
    if (nextErrors.length > 0) {
      return;
    }
    onSave(formState);
  }

  return (
    <div className="settings-backdrop" role="presentation" onClick={onClose}>
      <section className="settings-sheet" onClick={(event) => event.stopPropagation()}>
        <header>
          <p className="eyebrow">Endpoint Settings</p>
          <h3>Connect one OpenAI-compatible model</h3>
        </header>

        <label>
          <span>Base URL</span>
          <input
            value={formState.baseUrl}
            onChange={(event) => {
              const { value } = event.currentTarget;
              setFormState((current) => ({ ...current, baseUrl: value }));
            }}
            placeholder="https://api.openai.com"
          />
        </label>

        <label>
          <span>API Key</span>
          <input
            type="password"
            value={formState.apiKey}
            onChange={(event) => {
              const { value } = event.currentTarget;
              setFormState((current) => ({ ...current, apiKey: value }));
            }}
            placeholder="sk-..."
          />
        </label>

        <label>
          <span>Model</span>
          <input
            value={formState.model}
            onChange={(event) => {
              const { value } = event.currentTarget;
              setFormState((current) => ({ ...current, model: value }));
            }}
            placeholder="gpt-4.1-mini"
          />
        </label>

        <label>
          <span>System Prompt</span>
          <textarea
            rows={5}
            value={formState.systemPrompt ?? ""}
            onChange={(event) => {
              const { value } = event.currentTarget;
              setFormState((current) => ({
                ...current,
                systemPrompt: value,
              }));
            }}
            placeholder="Optional global system instruction."
          />
        </label>

        {errors.length > 0 ? (
          <div className="validation-card">
            {errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </div>
        ) : null}

        <footer className="sheet-actions">
          <button className="ghost-button" onClick={onClose}>
            Close
          </button>
          <button className="primary-button" onClick={submit}>
            Save Settings
          </button>
        </footer>
      </section>
    </div>
  );
}
