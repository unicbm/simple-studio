interface PrimaryNavProps {
  currentView: "chat" | "settings";
  isConfigured: boolean;
  sessionCount: number;
  onChangeView: (view: "chat" | "settings") => void;
}

export function PrimaryNav({
  currentView,
  isConfigured,
  sessionCount,
  onChangeView,
}: PrimaryNavProps) {
  return (
    <aside className="primary-nav">
      <div className="brand-mark" aria-label="Simple Studio">
        SS
      </div>

      <nav className="nav-cluster" aria-label="Primary">
        <button
          className={currentView === "chat" ? "nav-button active" : "nav-button"}
          onClick={() => onChangeView("chat")}
        >
          Chats
        </button>
        <button
          className={currentView === "settings" ? "nav-button active" : "nav-button"}
          onClick={() => onChangeView("settings")}
        >
          Settings
        </button>
      </nav>

      <div className="nav-meta">
        <div className="nav-stat">
          <div>{sessionCount} sessions</div>
          <div className="nav-status">
            <span className={isConfigured ? "nav-status-dot ready" : "nav-status-dot"} />
            <span>{isConfigured ? "Configured" : "Needs setup"}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
