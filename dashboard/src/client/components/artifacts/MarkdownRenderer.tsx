import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

// ---------------------------------------------------------------------------
// MarkdownRenderer -- Notion-style markdown rendering with GFM support
// ---------------------------------------------------------------------------

const components: Components = {
  // Styled code blocks with monospace font
  code({ className, children, ...props }) {
    const isInline = !className;
    if (isInline) {
      return (
        <code
          className="bg-bg-secondary px-[var(--spacing-1)] py-[var(--spacing-0-5)] rounded-[var(--radius-sm)] text-[0.9em] font-mono text-accent-purple"
          {...props}
        >
          {children}
        </code>
      );
    }
    // Block code
    const lang = className?.replace('language-', '') ?? '';
    return (
      <div className="relative group">
        {lang && (
          <span className="absolute top-[var(--spacing-2)] right-[var(--spacing-2)] text-[length:var(--font-size-xs)] text-text-tertiary opacity-60">
            {lang}
          </span>
        )}
        <code className={`block font-mono text-[length:var(--font-size-sm)] ${className ?? ''}`} style={{ color: 'var(--code-t1)' }} {...props}>
          {children}
        </code>
      </div>
    );
  },
  // Block-level pre wrapper
  pre({ children, ...props }) {
    return (
      <pre
        className="rounded-[var(--radius-md)] p-[var(--spacing-4)] overflow-x-auto my-[var(--spacing-3)] border"
        style={{ background: 'var(--code-bg)', borderColor: 'var(--code-border)', color: 'var(--code-t1)' }}
        {...props}
      >
        {children}
      </pre>
    );
  },
  // Headings — Notion-style with letter-spacing
  h1({ children }) {
    return (
      <h1 className="text-[length:var(--font-size-2xl)] font-[var(--font-weight-bold)] text-text-primary mt-0 mb-[var(--spacing-4)] pb-[10px] border-b-2 border-border tracking-[var(--letter-spacing-tighter)]">
        {children}
      </h1>
    );
  },
  h2({ children }) {
    return (
      <h2 className="text-[length:var(--font-size-md)] font-[var(--font-weight-bold)] text-text-primary mt-[var(--spacing-6)] mb-[10px] pb-[var(--spacing-1-5)] border-b border-border-divider tracking-[var(--letter-spacing-tighter)]">
        {children}
      </h2>
    );
  },
  h3({ children }) {
    return (
      <h3 className="text-[14px] font-[var(--font-weight-semibold)] text-text-primary mt-[var(--spacing-4)] mb-[var(--spacing-2)] tracking-[var(--letter-spacing-tight)]">
        {children}
      </h3>
    );
  },
  h4({ children }) {
    return (
      <h4 className="text-[length:var(--font-size-md)] font-[var(--font-weight-semibold)] text-text-primary mt-[var(--spacing-6)] mb-[var(--spacing-2)] tracking-[var(--letter-spacing-tight)]">
        {children}
      </h4>
    );
  },
  // Paragraphs
  p({ children }) {
    return (
      <p className="text-[14px] text-text-secondary leading-[1.8] mb-[var(--spacing-3)] font-sans">
        {children}
      </p>
    );
  },
  // Links — Notion blue accent
  a({ href, children }) {
    return (
      <a
        href={href}
        className="text-accent-blue hover:underline transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] rounded-[var(--radius-sm)]"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  },
  // Lists
  ul({ children }) {
    return <ul className="list-disc pl-[24px] mb-[var(--spacing-3)] space-y-[var(--spacing-1)] text-text-secondary marker:text-text-tertiary">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="list-decimal pl-[24px] mb-[var(--spacing-3)] space-y-[var(--spacing-1)] text-text-secondary marker:text-text-tertiary">{children}</ol>;
  },
  li({ children }) {
    return <li className="text-[14px] text-text-secondary leading-[1.8] mb-[var(--spacing-1)]">{children}</li>;
  },
  // Blockquote — Notion style with left border
  blockquote({ children }) {
    return (
      <blockquote className="border-l-[3px] border-accent-purple pl-[var(--spacing-4)] py-[10px] pr-[var(--spacing-4)] my-[var(--spacing-3)] bg-tint-planning rounded-r-[10px] text-[13px] text-text-secondary italic leading-[1.7]">
        {children}
      </blockquote>
    );
  },
  // Table — Notion clean style
  table({ children }) {
    return (
      <div className="overflow-x-auto my-[var(--spacing-3)]">
        <table className="min-w-full border border-border">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="bg-bg-secondary">{children}</thead>;
  },
  th({ children }) {
    return (
      <th className="px-[var(--spacing-3)] py-[var(--spacing-2)] text-left text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] text-text-secondary border-b border-border">
        {children}
      </th>
    );
  },
  td({ children }) {
    return (
      <td className="px-[var(--spacing-3)] py-[var(--spacing-2)] text-[length:var(--font-size-sm)] text-text-primary border-b border-border">
        {children}
      </td>
    );
  },
  // Horizontal rule
  hr() {
    return <hr className="border-none h-px bg-border my-[var(--spacing-5)]" />;
  },
  // Strong / em
  strong({ children }) {
    return <strong className="font-[var(--font-weight-semibold)] text-text-primary">{children}</strong>;
  },
  em({ children }) {
    return <em className="italic text-text-secondary">{children}</em>;
  },
};

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="max-w-none text-text-primary leading-[var(--line-height-relaxed)] text-[length:var(--font-size-base)] font-sans" role="document">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
