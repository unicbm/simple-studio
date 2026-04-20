import { useEffect, useMemo, useRef, useState, startTransition } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import "./App.css";
import { MarkdownMessage } from "./components/MarkdownMessage";
import { SettingsSheet } from "./components/SettingsSheet";
import {
  appendAssistantChunk,
  buildRequestMessages,
  createEmptySession,
  findRetryTarget,
  isSettingsComplete,
  makeTitleFromContent,
  replaceSession,
  validateSettings,
} from "./lib/chatState";
import {
  abortStream,
  deleteSession as deleteSessionRecord,
  exportData,
  importData,
  loadSessions,
  loadSettings,
  saveSession,
  saveSettings,
  startChatStream,
} from "./lib/tauri";
import type {
  AppSettings,
  ChatMessage,
  ChatSession,
  StreamEvent,
} from "./types";

const DEFAULT_SETTINGS: AppSettings = {
  baseUrl: "",
  apiKey: "",
  model: "",
  systemPrompt: "",
};

function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sessionsRef = useRef<ChatSession[]>([]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      try {
        const [loadedSettings, loadedSessions] = await Promise.all([
          loadSettings(),
          loadSessions(),
        ]);

        if (!isMounted) {
          return;
        }

        startTransition(() => {
          setSettings(loadedSettings);
          setSessions(loadedSessions);
          setActiveSessionId(loadedSessions[0]?.id ?? null);
          setLoading(false);
        });
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setLoading(false);
        setErrorMessage(
          error instanceof Error ? error.message : "Failed to load app data.",
        );
      }
    }

    void bootstrap();

    return () => {
      isMounted = false;
    };
  }, []);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  async function persistSession(nextSession: ChatSession) {
    setSessions((currentSessions) => replaceSession(currentSessions, nextSession));
    await saveSession(nextSession);
  }

  async function handleCreateSession() {
    const session = createEmptySession();
    startTransition(() => {
      setSessions((currentSessions) => [session, ...currentSessions]);
      setActiveSessionId(session.id);
    });
    await saveSession(session);
  }

  async function handleDeleteSession(sessionId: string) {
    const nextSessions = sessions.filter((session) => session.id !== sessionId);
    startTransition(() => {
      setSessions(nextSessions);
      setActiveSessionId((currentId) => {
        if (currentId !== sessionId) {
          return currentId;
        }

        return nextSessions[0]?.id ?? null;
      });
    });
    await deleteSessionRecord(sessionId);
  }

  async function handleSaveSettings(nextSettings: AppSettings) {
    const errors = validateSettings(nextSettings);
    if (errors.length > 0) {
      setErrorMessage(errors[0]);
      return;
    }

    setSettings(nextSettings);
    setErrorMessage(null);
    await saveSettings(nextSettings);
    setStatusMessage("Settings saved.");
    setIsSettingsOpen(false);
  }

  function ensureActiveSession(): ChatSession {
    if (activeSession) {
      return activeSession;
    }

    const session = createEmptySession();
    setSessions((currentSessions) => [session, ...currentSessions]);
    setActiveSessionId(session.id);
    void saveSession(session);
    return session;
  }

  async function runStream(
    session: ChatSession,
    userMessage: ChatMessage,
    history: ChatMessage[],
  ) {
    const requestId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      status: "streaming",
    };

    const titledSession =
      session.title === "Untitled"
        ? { ...session, title: makeTitleFromContent(userMessage.content) }
        : session;

    const nextSession: ChatSession = {
      ...titledSession,
      updatedAt: new Date().toISOString(),
      messages: [...history, userMessage, assistantMessage],
    };

    await persistSession(nextSession);

    const requestMessages = buildRequestMessages(nextSession.messages, settings.systemPrompt);

    setCurrentRequestId(requestId);
    setErrorMessage(null);
    setStatusMessage("Generating...");

    const onEvent = (event: StreamEvent) => {
      if (event.event === "delta") {
        const sourceSession = sessionsRef.current.find((item) => item.id === session.id);
        if (!sourceSession) {
          return;
        }

        const updatedSession = appendAssistantChunk(
          sourceSession,
          event.data.messageId,
          event.data.textChunk,
        );
        void persistSession(updatedSession);
        return;
      }

      if (event.event === "done") {
        const sourceSession = sessionsRef.current.find((item) => item.id === session.id);
        if (!sourceSession) {
          return;
        }

        const updatedSession: ChatSession = {
          ...sourceSession,
          updatedAt: new Date().toISOString(),
          messages: sourceSession.messages.map((message) =>
            message.id === event.data.messageId
              ? { ...message, status: "done" }
              : message,
          ),
        };
        void persistSession(updatedSession);
        setCurrentRequestId(null);
        setStatusMessage("Ready.");
        return;
      }

      if (event.event === "aborted") {
        const sourceSession = sessionsRef.current.find((item) => item.id === session.id);
        if (!sourceSession) {
          return;
        }

        const updatedSession: ChatSession = {
          ...sourceSession,
          updatedAt: new Date().toISOString(),
          messages: sourceSession.messages.map((message) =>
            message.id === event.data.messageId
              ? { ...message, status: "error" }
              : message,
          ),
        };
        void persistSession(updatedSession);
        setCurrentRequestId(null);
        setStatusMessage("Generation stopped.");
        return;
      }

      if (event.event === "error") {
        const sourceSession = sessionsRef.current.find((item) => item.id === session.id);
        if (!sourceSession) {
          return;
        }

        const updatedSession: ChatSession = {
          ...sourceSession,
          updatedAt: new Date().toISOString(),
          messages: sourceSession.messages.map((message) =>
            message.id === event.data.messageId
              ? { ...message, status: "error", content: event.data.message || message.content }
              : message,
          ),
        };
        void persistSession(updatedSession);
        setCurrentRequestId(null);
        setStatusMessage(null);
        setErrorMessage(event.data.message);
      }
    };

    try {
      await startChatStream({
        requestId,
        messageId: assistantMessageId,
        settings,
        messages: requestMessages,
        onEvent,
      });
    } catch (error) {
      setCurrentRequestId(null);
      setStatusMessage(null);
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to start generation.",
      );
    }
  }

  async function handleSend() {
    if (!draft.trim() || currentRequestId) {
      return;
    }

    if (!isSettingsComplete(settings)) {
      setIsSettingsOpen(true);
      setErrorMessage("Configure base URL, API key, and model before chatting.");
      return;
    }

    const session = ensureActiveSession();
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: draft.trim(),
      createdAt: new Date().toISOString(),
      status: "done",
    };

    setDraft("");
    await runStream(session, userMessage, session.messages);
  }

  async function handleRetry() {
    if (!activeSession || currentRequestId) {
      return;
    }

    const retryTarget = findRetryTarget(activeSession);
    if (!retryTarget) {
      setErrorMessage("Nothing to retry in this conversation yet.");
      return;
    }

    const nextMessages = activeSession.messages.filter(
      (message) => message.id !== retryTarget.assistant.id,
    );
    const nextSession = {
      ...activeSession,
      updatedAt: new Date().toISOString(),
      messages: nextMessages,
    };
    await persistSession(nextSession);
    await runStream(nextSession, retryTarget.user, retryTarget.history);
  }

  async function handleStop() {
    if (!currentRequestId) {
      return;
    }

    await abortStream(currentRequestId);
  }

  async function handleExport() {
    const path = await save({
      defaultPath: "tauri-studio-export.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });

    if (!path) {
      return;
    }

    await exportData(path);
    setStatusMessage("Data exported.");
  }

  async function handleImport() {
    const path = await open({
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });

    if (!path || Array.isArray(path)) {
      return;
    }

    const imported = await importData(path);
    startTransition(() => {
      setSettings(imported.settings);
      setSessions(imported.sessions);
      setActiveSessionId(imported.sessions[0]?.id ?? null);
      setErrorMessage(null);
      setStatusMessage("Data imported.");
    });
  }

  if (loading) {
    return (
      <main className="shell loading-shell">
        <div className="loading-panel">
          <p className="eyebrow">Tauri Studio</p>
          <h1>Booting local workspace</h1>
          <p>Loading settings, sessions, and app data.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand-block">
          <p className="eyebrow">Desktop LLM Console</p>
          <h1>Tauri Studio</h1>
          <p className="muted">
            OpenAI-compatible chat, local persistence, and streaming replies.
          </p>
        </div>

        <div className="sidebar-actions">
          <button className="primary-button" onClick={() => void handleCreateSession()}>
            New Session
          </button>
          <button className="ghost-button" onClick={() => setIsSettingsOpen(true)}>
            Settings
          </button>
          <button className="ghost-button" onClick={() => void handleExport()}>
            Export JSON
          </button>
          <button className="ghost-button" onClick={() => void handleImport()}>
            Import JSON
          </button>
        </div>

        <div className="session-list">
          {sessions.length === 0 ? (
            <div className="empty-card">
              <p>No conversations yet.</p>
              <span>Start a session and send your first prompt.</span>
            </div>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                className={session.id === activeSessionId ? "session-card active" : "session-card"}
                onClick={() => setActiveSessionId(session.id)}
              >
                <span>{session.title}</span>
                <small>{new Date(session.updatedAt).toLocaleString()}</small>
                <strong>{session.messages.length} messages</strong>
                <i
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleDeleteSession(session.id);
                  }}
                >
                  Delete
                </i>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="chat-panel">
        <header className="chat-header">
          <div>
            <p className="eyebrow">Conversation</p>
            <h2>{activeSession?.title ?? "Select or create a session"}</h2>
          </div>
          <div className="toolbar">
            <button className="ghost-button" onClick={() => void handleRetry()}>
              Retry
            </button>
            <button
              className="ghost-button"
              disabled={!currentRequestId}
              onClick={() => void handleStop()}
            >
              Stop
            </button>
          </div>
        </header>

        <section className="status-strip">
          <div>
            <span className="status-dot" />
            <p>{statusMessage ?? "Idle"}</p>
          </div>
          {!isSettingsComplete(settings) ? (
            <small>Settings incomplete. Open the panel to configure your endpoint.</small>
          ) : (
            <small>
              {settings.model} via {settings.baseUrl}
            </small>
          )}
        </section>

        <section className="message-list">
          {activeSession?.messages.length ? (
            activeSession.messages.map((message) => (
              <article key={message.id} className={`message-card role-${message.role}`}>
                <header>
                  <span>{message.role}</span>
                  <small>{new Date(message.createdAt).toLocaleTimeString()}</small>
                  {message.status ? <em>{message.status}</em> : null}
                </header>
                <MarkdownMessage content={message.content || "_Waiting for response..._"} />
              </article>
            ))
          ) : (
            <div className="empty-stage">
              <p>Minimal by design.</p>
              <span>
                One protocol, one window, one local store. Configure the endpoint and start
                chatting.
              </span>
            </div>
          )}
        </section>

        <footer className="composer">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            placeholder="Ask the model something concrete."
            rows={4}
          />
          <div className="composer-actions">
            <div>{errorMessage ? <p className="error-copy">{errorMessage}</p> : null}</div>
            <button
              className="primary-button"
              disabled={!draft.trim() || Boolean(currentRequestId)}
              onClick={() => void handleSend()}
            >
              Send
            </button>
          </div>
        </footer>
      </section>

      <SettingsSheet
        isOpen={isSettingsOpen}
        initialSettings={settings}
        onClose={() => setIsSettingsOpen(false)}
        onSave={(nextSettings) => void handleSaveSettings(nextSettings)}
      />
    </main>
  );
}

export default App;
