import { useEffect, useState } from "react";
import { validateSettings } from "../lib/chatState";
import type { AppSettings } from "../types";

interface SettingsViewProps {
  errorMessage: string | null;
  initialSettings: AppSettings;
  onBack: () => void;
  onExport: () => void;
  onImport: () => void;
  onSave: (settings: AppSettings) => void;
}

export function SettingsView({
  errorMessage,
  initialSettings,
  onBack,
  onExport,
  onImport,
  onSave,
}: SettingsViewProps) {
  const [formState, setFormState] = useState<AppSettings>(initialSettings);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    setFormState(initialSettings);
  }, [initialSettings]);

  function submit() {
    const nextErrors = validateSettings(formState);
    setErrors(nextErrors);
    if (nextErrors.length > 0) {
      return;
    }
    onSave(formState);
  }

  return (
    <section className="content-panel settings-view">
      <header>
        <div>
          <span className="section-label">Settings</span>
          <h2>Connection and data</h2>
          <p>Keep provider setup and local data operations out of the chat workspace.</p>
        </div>
        <div className="toolbar">
          <button className="toolbar-button" onClick={onBack} type="button">
            Back to chat
          </button>
          <button className="primary-button" onClick={submit} type="button">
            Save settings
          </button>
        </div>
      </header>

      <div className="settings-scroll">
        <section className="settings-section">
          <div>
            <h3>Provider</h3>
            <p className="settings-note">
              One OpenAI-compatible endpoint, one default model, one optional system prompt.
            </p>
          </div>
          <div className="settings-grid">
            <div className="settings-field">
              <label htmlFor="base-url">Base URL</label>
              <input
                id="base-url"
                onChange={(event) => {
                  const { value } = event.currentTarget;
                  setFormState((current) => ({ ...current, baseUrl: value }));
                }}
                placeholder="https://api.openai.com"
                value={formState.baseUrl}
              />
            </div>
            <div className="settings-field">
              <label htmlFor="model">Model</label>
              <input
                id="model"
                onChange={(event) => {
                  const { value } = event.currentTarget;
                  setFormState((current) => ({ ...current, model: value }));
                }}
                placeholder="gpt-4.1-mini"
                value={formState.model}
              />
            </div>
            <div className="settings-field span-2">
              <label htmlFor="api-key">API key</label>
              <input
                id="api-key"
                onChange={(event) => {
                  const { value } = event.currentTarget;
                  setFormState((current) => ({ ...current, apiKey: value }));
                }}
                placeholder="sk-..."
                type="password"
                value={formState.apiKey}
              />
            </div>
            <div className="settings-field span-2">
              <label htmlFor="system-prompt">Default system prompt</label>
              <textarea
                id="system-prompt"
                onChange={(event) => {
                  const { value } = event.currentTarget;
                  setFormState((current) => ({ ...current, systemPrompt: value }));
                }}
                placeholder="Optional global system instruction."
                rows={6}
                value={formState.systemPrompt ?? ""}
              />
              <p className="field-help">
                Applied to every request when present. Leave empty for plain chat behavior.
              </p>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div>
            <h3>Data</h3>
            <p className="settings-note">
              Export conversations as JSON or import a previously saved snapshot.
            </p>
          </div>
          <div className="settings-actions">
            <button className="secondary-button" onClick={onExport} type="button">
              Export JSON
            </button>
            <button className="secondary-button" onClick={onImport} type="button">
              Import JSON
            </button>
          </div>
        </section>

        {errors.length > 0 ? (
          <div className="validation-card">
            {errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </div>
        ) : null}

        {errorMessage ? (
          <div className="validation-card">
            <p>{errorMessage}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
