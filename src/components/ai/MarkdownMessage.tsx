/**
 * MarkdownMessage — renders AI assistant replies as formatted Markdown.
 *
 * Uses react-markdown + remark-gfm for GFM tables, task lists, strikethrough.
 * Code blocks get syntax highlighting via react-syntax-highlighter with a
 * theme that matches k7s's dark color palette.
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import styles from './AiChat.module.css';

// Customize the syntax highlighter theme to match k7s's --bg-terminal.
const k7sTheme = {
  ...vscDarkPlus,
  'pre[class*="language-"]': {
    ...vscDarkPlus['pre[class*="language-"]'],
    background: 'var(--bg-terminal)',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 12px',
    margin: '8px 0',
    fontSize: '12px',
    lineHeight: '1.5',
    fontFamily: 'var(--font-mono)',
  },
  'code[class*="language-"]': {
    ...vscDarkPlus['code[class*="language-"]'],
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
  },
};

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
                <SyntaxHighlighter
                  style={k7sTheme}
                  language={match[1]}
                  PreTag="div"
                >
                  {codeStr}
                </SyntaxHighlighter>
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
