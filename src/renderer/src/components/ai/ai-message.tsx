import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { CodeBlock } from "./code-block";

interface Props {
  content: string;
}

// markdown renderer for assistant replies: GFM + syntax-highlighted code
// blocks; custom <pre> adds the copy button (raw text, per FR-006/FR-007)
export function AiMessage({ content }: Props) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        pre({ children }) {
          // react-markdown renders code blocks as <pre><code>; pull the
          // code element's text + language from its child
          const codeEl = children as React.ReactElement<{
            className?: string;
            children?: React.ReactNode;
          }>;
          const lang = /language-(\w+)/.exec(codeEl?.props?.className ?? "")?.[1];
          const text = String(codeEl?.props?.children ?? "").replace(/\n$/, "");
          return <CodeBlock language={lang} code={text} />;
        },
        code({ className, children }) {
          // inline code only — fenced blocks are handled by <pre>
          return (
            <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs text-zinc-100">
              {children}
            </code>
          );
        },
        p({ children }) {
          return <p className="mb-2 last:mb-0">{children}</p>;
        },
        ul({ children }) {
          return <ul className="mb-2 list-disc pl-5 last:mb-0">{children}</ul>;
        },
        ol({ children }) {
          return (
            <ol className="mb-2 list-decimal pl-5 last:mb-0">{children}</ol>
          );
        },
        a({ href, children }) {
          return (
            <a href={href} className="text-blue-400 underline" target="_blank" rel="noreferrer">
              {children}
            </a>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
