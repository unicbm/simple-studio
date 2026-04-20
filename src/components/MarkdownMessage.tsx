import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="markdown-block">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { children, className } = props;
            const code = String(children).replace(/\n$/, "");
            const isInline = !className;

            if (isInline) {
              return <code className="inline-code">{code}</code>;
            }

            return <CodeBlock code={code} className={className} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ code, className }: { code: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="code-shell">
      <div className="code-toolbar">
        <span>{className?.replace("language-", "") ?? "code"}</span>
        <button onClick={() => void handleCopy()}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre>
        <code className={className}>{code}</code>
      </pre>
    </div>
  );
}
