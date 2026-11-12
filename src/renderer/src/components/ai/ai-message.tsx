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
    <div className="typeset typeset-docs max-w-[42em]">
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
            const lang = /language-(\w+)/.exec(
              codeEl?.props?.className ?? "",
            )?.[1];
            const text = String(codeEl?.props?.children ?? "").replace(
              /\n$/,
              "",
            );
            return <CodeBlock language={lang} code={text} />;
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                className="text-blue-400 underline"
                target="_blank"
                rel="noreferrer"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
