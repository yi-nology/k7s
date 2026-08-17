/**
 * MarkdownMessage — renders AI assistant replies as formatted Markdown.
 *
 * Uses react-markdown + remark-gfm for GFM tables, task lists, strikethrough.
 * Code blocks get syntax highlighting via react-shiki (Shiki, a TextMate-
 * grammar highlighter). This replaced react-syntax-highlighter, which pulled
 * in highlight.js@10.7.3 — that line is EOL and carries a ReDoS advisory
 * (GHSA-7wwv-vh3v-6h6q) with no patch; Shiki has no such issue.
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
// `react-shiki` (full bundle) ships every TextMate grammar — ~10MB minified,
// all of it in the boot bundle when AiChat was statically imported. The /web
// entry lazy-loads only the languages a code block actually names, at an
// identical API; unknown languages degrade to plain text.
import ShikiHighlighter from 'react-shiki/web';
import styles from './AiChat.module.css';

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const codeStr = String(children).replace(/\n$/, '');
            if (match) {
              return (
                <ShikiHighlighter
                  language={match[1]}
                  theme="vsc-dark-plus"
                  // Match the old compact look: no language badge, no built-in
                  // layout styles — we drive appearance through AiChat.module.css.
                  showLanguage={false}
                  addDefaultStyles={false}
                  className={styles.codeBlock}
                  as="div"
                >
                  {codeStr}
                </ShikiHighlighter>
              );
            }
            // Inline code.
            return (
              <code className={styles.inlineCode} {...props}>
                {children}
              </code>
            );
          },
          table({ children }) {
            return (
              <div className={styles.tableWrapper}>
                <table className={styles.markdownTable}>{children}</table>
              </div>
            );
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
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
