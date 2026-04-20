import { open, save } from "@tauri-apps/plugin-dialog";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { ChatView } from "./components/ChatView";
import { PrimaryNav } from "./components/PrimaryNav";
import { SessionListPane } from "./components/SessionListPane";
import { SettingsView } from "./components/SettingsView";
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
  const [view, setView] = useState<"chat" | "settings">("chat");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
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

  function commitSessions(nextSessions: ChatSession[]) {
    sessionsRef.current = nextSessions;
    setSessions(nextSessions);
  }

  function upsertSessionInMemory(nextSession: ChatSession) {
    const nextSessions = replaceSession(sessionsRef.current, nextSession);
    commitSessions(nextSessions);
    return nextSession;
  }

  async function persistSession(nextSession: ChatSession) {
    const committedSession = upsertSessionInMemory(nextSession);
    await saveSession(committedSession);
  }

  function updateSession(
    sessionId: string,
    updater: (session: ChatSession) => ChatSession,
    options?: { persist?: boolean },
  ) {
    const sourceSession = sessionsRef.current.find((session) => session.id === sessionId);
    if (!sourceSession) {
      return null;
    }

    const nextSession = updater(sourceSession);
    upsertSessionInMemory(nextSession);

    if (options?.persist) {
      void saveSession(nextSession);
    }

    return nextSession;
  }

  async function handleCreateSession() {
    const session = createEmptySession();
    startTransition(() => {
      const nextSessions = [session, ...sessionsRef.current];
      commitSessions(nextSessions);
      setActiveSessionId(session.id);
      setView("chat");
    });
    await saveSession(session);
  }

  async function handleDeleteSession(sessionId: string) {
    const nextSessions = sessionsRef.current.filter((session) => session.id !== sessionId);
    startTransition(() => {
      commitSessions(nextSessions);
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
    setStatusMessage("Settings saved.");
    await saveSettings(nextSettings);
    setView("chat");
  }

  function ensureActiveSession(): ChatSession {
    if (activeSession) {
      return activeSession;
    }

    const session = createEmptySession();
    commitSessions([session, ...sessionsRef.current]);
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
        updateSession(
          session.id,
          (sourceSession) =>
            appendAssistantChunk(
              sourceSession,
              event.data.messageId,
              event.data.textChunk,
            ),
          { persist: false },
        );
        return;
      }

      if (event.event === "done") {
        updateSession(
          session.id,
          (sourceSession) => ({
            ...sourceSession,
            updatedAt: new Date().toISOString(),
            messages: sourceSession.messages.map((message) =>
              message.id === event.data.messageId
                ? { ...message, status: "done" }
                : message,
            ),
          }),
          { persist: true },
        );
        setCurrentRequestId(null);
        setStatusMessage("Ready.");
        return;
      }

      if (event.event === "aborted") {
        updateSession(
          session.id,
          (sourceSession) => ({
            ...sourceSession,
            updatedAt: new Date().toISOString(),
            messages: sourceSession.messages.map((message) =>
              message.id === event.data.messageId
                ? { ...message, status: "error" }
                : message,
            ),
          }),
          { persist: true },
        );
        setCurrentRequestId(null);
        setStatusMessage("Generation stopped.");
        return;
      }

      if (event.event === "error") {
        updateSession(
          session.id,
          (sourceSession) => ({
            ...sourceSession,
            updatedAt: new Date().toISOString(),
            messages: sourceSession.messages.map((message) =>
              message.id === event.data.messageId
                ? {
                    ...message,
                    status: "error",
                    content: event.data.message || message.content,
                  }
                : message,
            ),
          }),
          { persist: true },
        );
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
      setView("settings");
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
      defaultPath: "simple-studio-export.json",
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
      commitSessions(imported.sessions);
      setActiveSessionId(imported.sessions[0]?.id ?? null);
      setView("chat");
      setErrorMessage(null);
      setStatusMessage("Data imported.");
    });
  }

  if (loading) {
    return (
      <main className="app-shell loading-shell">
        <div className="loading-card">
          <span className="section-label">Simple Studio</span>
          <h1>Loading workspace</h1>
          <p>Reading your local settings and conversation history.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <PrimaryNav
        currentView={view}
        isConfigured={isSettingsComplete(settings)}
        sessionCount={sessions.length}
        onChangeView={setView}
      />

      <SessionListPane
        activeSessionId={activeSessionId}
        sessions={sessions}
        onCreateSession={() => void handleCreateSession()}
        onDeleteSession={(sessionId) => void handleDeleteSession(sessionId)}
        onSelectSession={(sessionId) => {
          setActiveSessionId(sessionId);
          setView("chat");
        }}
      />

      {view === "settings" ? (
        <SettingsView
          errorMessage={errorMessage}
          initialSettings={settings}
          onBack={() => setView("chat")}
          onExport={() => void handleExport()}
          onImport={() => void handleImport()}
          onSave={(nextSettings) => void handleSaveSettings(nextSettings)}
        />
      ) : (
        <ChatView
          activeSession={activeSession}
          currentRequestId={currentRequestId}
          draft={draft}
          errorMessage={errorMessage}
          hasSessions={sessions.length > 0}
          isConfigured={isSettingsComplete(settings)}
          settings={settings}
          statusMessage={statusMessage}
          onChangeDraft={setDraft}
          onCreateSession={() => void handleCreateSession()}
          onOpenSettings={() => setView("settings")}
          onRetry={() => void handleRetry()}
          onSend={() => void handleSend()}
          onStop={() => void handleStop()}
        />
      )}
    </main>
  );
}

export default App;
