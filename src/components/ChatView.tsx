import { MarkdownMessage } from "./MarkdownMessage";
import { Composer } from "./Composer";
import type { AppSettings, ChatSession } from "../types";

interface ChatViewProps {
  activeSession: ChatSession | null;
  currentRequestId: string | null;
  draft: string;
  errorMessage: string | null;
  hasSessions: boolean;
  isConfigured: boolean;
  settings: AppSettings;
  statusMessage: string | null;
  onChangeDraft: (value: string) => void;
  onCreateSession: () => void;
  onOpenSettings: () => void;
  onRetry: () => void;
  onSend: () => void;
  onStop: () => void;
}

export function ChatView({
  activeSession,
  currentRequestId,
  draft,
  errorMessage,
  hasSessions,
  isConfigured,
  settings,
  statusMessage,
  onChangeDraft,
  onCreateSession,
  onOpenSettings,
  onRetry,
  onSend,
  onStop,
}: ChatViewProps) {
  const showEmptyState = !activeSession || activeSession.messages.length === 0;

  return (
    <section className="content-panel chat-view">
      <header className="chat-header">
        <div>
          <span className="section-label">Workspace</span>
          <h2>{activeSession?.title ?? "Start a conversation"}</h2>
          <p className="chat-subline">
            {isConfigured
              ? `${settings.model} · ${settings.baseUrl}`
              : "Configure a compatible endpoint before sending messages."}
          </p>
        </div>
        <div className="toolbar">
          <button className="toolbar-button" onClick={onRetry} type="button">
            Retry
          </button>
          <button
            className="danger-button"
            disabled={!currentRequestId}
            onClick={onStop}
            type="button"
          >
            Stop
          </button>
          <button className="toolbar-button" onClick={onOpenSettings} type="button">
            Open settings
          </button>
        </div>
      </header>

      <div className="status-bar">
        <div className="status-leading">
          <span className="status-dot" />
          <span className="status-text">{statusMessage ?? "Idle"}</span>
        </div>
        <span className="status-text">
          {currentRequestId ? "Streaming response" : "Ready for next message"}
        </span>
      </div>

      <section className="message-list">
        {showEmptyState ? (
          <div className="empty-state">
            <strong>{hasSessions ? "This chat is empty" : "Set up and start chatting"}</strong>
            <p>
              {isConfigured
                ? "Create or select a conversation, then send your first prompt."
                : "Open settings, save your endpoint, then create a new chat."}
            </p>
            <div className="toolbar">
              {!isConfigured ? (
                <button className="primary-button" onClick={onOpenSettings} type="button">
                  Configure endpoint
                </button>
              ) : null}
              <button className="secondary-button" onClick={onCreateSession} type="button">
                New chat
              </button>
            </div>
          </div>
        ) : (
          activeSession.messages.map((message) => (
            <article key={message.id} className={`message-card role-${message.role}`}>
              <div className="message-meta">
                <span className="message-role">{message.role}</span>
                <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
                {message.status ? <span>{message.status}</span> : null}
              </div>
              <div className="message-bubble">
                <MarkdownMessage content={message.content || "_Waiting for response..._"} />
              </div>
            </article>
          ))
        )}
      </section>

      <Composer
        currentRequestId={currentRequestId}
        draft={draft}
        errorMessage={errorMessage}
        onChangeDraft={onChangeDraft}
        onSend={onSend}
      />
    </section>
  );
}
