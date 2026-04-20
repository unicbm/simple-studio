import type { ChatSession } from "../types";

interface SessionListPaneProps {
  activeSessionId: string | null;
  sessions: ChatSession[];
  onCreateSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onSelectSession: (sessionId: string) => void;
}

export function SessionListPane({
  activeSessionId,
  sessions,
  onCreateSession,
  onDeleteSession,
  onSelectSession,
}: SessionListPaneProps) {
  return (
    <aside className="session-pane">
      <header className="session-pane-header">
        <span className="section-label">Conversations</span>
        <h1>All chats</h1>
        <p>Keep the list tight and the context local.</p>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="primary-button" onClick={onCreateSession}>
            New chat
          </button>
        </div>
      </header>

      <div className="session-search">
        <input
          aria-label="Search sessions"
          disabled
          placeholder="Search sessions (coming later)"
          readOnly
        />
      </div>

      <div className="session-list">
        {sessions.length === 0 ? (
          <div className="empty-list">
            <strong>No saved chats</strong>
            <p className="empty-detail">Create one conversation and it will appear here.</p>
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={session.id === activeSessionId ? "session-item active" : "session-item"}
            >
              <button className="session-select" onClick={() => onSelectSession(session.id)}>
                <span className="session-title">{session.title}</span>
                <span className="session-summary">
                  {session.messages.length} messages
                </span>
                <span className="session-summary">
                  {new Date(session.updatedAt).toLocaleString()}
                </span>
              </button>
              <button
                aria-label={`Delete ${session.title}`}
                className="session-delete"
                onClick={() => onDeleteSession(session.id)}
                type="button"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
