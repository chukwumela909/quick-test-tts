"use client";

import { useState, useCallback, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface MessageContentProps {
  content: string;
  /** When true, suppress trailing whitespace artifacts during streaming. */
  streaming?: boolean;
}

function CodeBlock({ language, children }: { language?: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [children]);

  return (
    <div className="md-codeblock-wrap group">
      <div className="md-codeblock-bar">
        <span className="md-codeblock-lang">{language || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="md-codeblock-copy"
          aria-label="Copy code"
        >
          {copied ? "COPIED" : "COPY"}
        </button>
      </div>
      <pre className="md-codeblock">
        <code>{children}</code>
      </pre>
    </div>
  );
}

const components: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || "");
    const text = String(children ?? "").replace(/\n$/, "");
    // Inline code: no language class and no newlines.
    const isInline = !match && !text.includes("\n");
    if (isInline) {
      return (
        <code className="md-inline-code" {...props}>
          {children}
        </code>
      );
    }
    return <CodeBlock language={match?.[1]}>{text}</CodeBlock>;
  },
  pre({ children }) {
    // CodeBlock already renders its own <pre>; pass through to avoid nesting.
    return <>{children}</>;
  },
  a({ children, href }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="md-link"
      >
        {children}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="md-table-wrap">
        <table className="md-table">{children}</table>
      </div>
    );
  },
};

function MessageContentImpl({ content, streaming }: MessageContentProps) {
  const text = streaming ? content : content;
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default memo(MessageContentImpl);
