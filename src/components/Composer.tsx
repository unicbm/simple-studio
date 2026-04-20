interface ComposerProps {
  currentRequestId: string | null;
  draft: string;
  errorMessage: string | null;
  onChangeDraft: (value: string) => void;
  onSend: () => void;
}

export function Composer({
  currentRequestId,
  draft,
  errorMessage,
  onChangeDraft,
  onSend,
}: ComposerProps) {
  return (
    <footer className="composer">
      <textarea
        onChange={(event) => onChangeDraft(event.currentTarget.value)}
        placeholder="Type a message"
        rows={4}
        value={draft}
      />
      <div className="composer-actions">
        <div className="composer-meta">
          <p className="input-hint">
            Send one prompt at a time. Streaming output appears in place.
          </p>
          {errorMessage ? <p className="error-copy">{errorMessage}</p> : null}
        </div>
        <button
          className="primary-button"
          disabled={!draft.trim() || Boolean(currentRequestId)}
          onClick={onSend}
          type="button"
        >
          Send
        </button>
      </div>
    </footer>
  );
}
