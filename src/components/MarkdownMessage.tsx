import { type AnchorHTMLAttributes, type ImgHTMLAttributes, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="markdown-block">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          a(props) {
            const { node: _node, href, children, ...anchorProps } = props;
            void _node;
            return (
              <SafeLink href={href} {...anchorProps}>
                {children}
              </SafeLink>
            );
          },
          code(props) {
            const { children, className } = props;
            const code = String(children).replace(/\n$/, "");
            const isInline = !className;

            if (isInline) {
              return <code className="inline-code">{code}</code>;
            }

            return <CodeBlock code={code} className={className} />;
          },
          img(props) {
            const { node: _node, alt } = props;
            void _node;
            return <BlockedImage alt={alt} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function SafeLink({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const safeHref = sanitizeExternalHref(href);

  if (!safeHref) {
    return <span>{children}</span>;
  }

  return (
    <a
      {...props}
      href={safeHref}
      onClick={(event) => {
        event.preventDefault();
        void Promise.resolve(openUrl(safeHref)).catch(() => undefined);
      }}
      rel="noreferrer noopener"
    >
      {children}
    </a>
  );
}

function BlockedImage({ alt }: ImgHTMLAttributes<HTMLImageElement>) {
  return <span className="blocked-asset">[{alt?.trim() || "Image"} omitted for safety]</span>;
}

function sanitizeExternalHref(href?: string): string | null {
  if (!href) {
    return null;
  }

  try {
    const url = new URL(href);
    return ALLOWED_EXTERNAL_PROTOCOLS.has(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
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
