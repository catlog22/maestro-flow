import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { lazy, Suspense } from 'react';

// Lazy-load mermaid — it's ~770KB so only load when a diagram is encountered
const MermaidBlock = lazy(() => import('./MermaidBlock.js').then(m => ({ default: m.MermaidBlock })));

// ---------------------------------------------------------------------------
// MarkdownRenderer -- warm minimal markdown rendering
// Dark code blocks, tinted callouts, clean typography
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u4e00-\u9fff\u3400-\u4dbf-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function getTextContent(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return getTextContent((node as React.ReactElement).props.children);
  }
  return '';
}

function AnchorLink({ id }: { id: string }) {
  return (
    <a href={`#${id}`} className="absolute -left-5 top-0 opacity-0 group-hover:opacity-100 transition-opacity text-accent-blue no-underline text-[length:var(--font-size-lg)]">
      #
    </a>
  );
}

const components: Components = {
  code({ className, children, ...props }) {
    const isInline = !className && !String(children).includes('\n');
    if (isInline) {
      return (
        <code className="bg-bg-secondary px-[7px] py-[2px] rounded-[var(--radius-sm)] text-[0.85em] font-mono text-accent-purple border border-border-divider" {...props}>
          {children}
        </code>
      );
    }
    const lang = className?.replace('language-', '') ?? '';
    if (lang === 'mermaid') {
      const chart = String(children).replace(/\n$/, '');
      return (
        <Suspense fallback={<div className="bg-bg-card border border-border rounded-[var(--radius-lg)] p-[var(--spacing-4)] my-[var(--spacing-4)] text-text-placeholder text-[length:var(--font-size-sm)]">Loading diagram...</div>}>
          <MermaidBlock chart={chart} />
        </Suspense>
      );
    }
    return (
      <div className="relative group">
        {lang && (
          <span className="absolute top-[var(--spacing-2)] right-[var(--spacing-3)] text-[length:11px] font-[var(--font-weight-semibold)] text-[rgba(255,255,255,0.4)] uppercase">
            {lang}
          </span>
        )}
        <code className={`block font-mono text-[length:var(--font-size-sm)] leading-[1.6] text-text-code ${className ?? ''}`} {...props}>
          {children}
        </code>
      </div>
    );
  },
  pre({ children, ...props }) {
    return <pre className="bg-bg-code rounded-[var(--radius-lg)] p-[var(--spacing-4)] overflow-x-auto my-[var(--spacing-4)]" {...props}>{children}</pre>;
  },
  h1({ children }) {
    const id = slugify(getTextContent(children));
    return <h1 id={id} className="group relative text-[length:28px] font-[var(--font-weight-bold)] text-text-primary mt-[var(--spacing-12)] mb-[var(--spacing-4)] pb-[var(--spacing-2)] border-b border-border-divider leading-[1.3]">{children}{id && <AnchorLink id={id} />}</h1>;
  },
  h2({ children }) {
    const id = slugify(getTextContent(children));
    return <h2 id={id} className="group relative text-[length:20px] font-[var(--font-weight-bold)] text-text-primary mt-[var(--spacing-12)] mb-[var(--spacing-4)] pb-[var(--spacing-2)] border-b border-border-divider">{children}{id && <AnchorLink id={id} />}</h2>;
  },
  h3({ children }) {
    const id = slugify(getTextContent(children));
    return <h3 id={id} className="group relative text-[length:16px] font-[var(--font-weight-semibold)] text-text-primary mt-[var(--spacing-8)] mb-[var(--spacing-3)]">{children}{id && <AnchorLink id={id} />}</h3>;
  },
  h4({ children }) {
    const id = slugify(getTextContent(children));
    return <h4 id={id} className="group relative text-[length:var(--font-size-base)] font-[var(--font-weight-semibold)] text-text-primary mt-[var(--spacing-6)] mb-[var(--spacing-2)]">{children}{id && <AnchorLink id={id} />}</h4>;
  },
  p({ children }) {
    return <p className="text-text-secondary leading-[var(--line-height-relaxed)] my-[var(--spacing-4)]">{children}</p>;
  },
  a({ href, children }) {
    return <a href={href} className="text-accent-blue font-[var(--font-weight-medium)] no-underline hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>;
  },
  ul({ children }) {
    return <ul className="list-disc pl-[var(--spacing-6)] my-[var(--spacing-4)] space-y-[var(--spacing-1-5)] text-text-secondary">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="list-decimal pl-[var(--spacing-6)] my-[var(--spacing-4)] space-y-[var(--spacing-1-5)] text-text-secondary">{children}</ol>;
  },
  li({ children }) { return <li className="text-text-secondary">{children}</li>; },
  blockquote({ children }) {
    return <blockquote className="border-l-[3px] border-accent-blue bg-tint-blue pl-[var(--spacing-4)] pr-[var(--spacing-3)] py-[var(--spacing-2)] my-[var(--spacing-4)] rounded-r-[var(--radius-default)] text-text-secondary">{children}</blockquote>;
  },
  table({ children }) {
    return <div className="overflow-x-auto my-[var(--spacing-4)]"><table className="w-full border-collapse text-[length:var(--font-size-sm)]">{children}</table></div>;
  },
  thead({ children }) { return <thead>{children}</thead>; },
  th({ children }) { return <th className="text-left px-[var(--spacing-3)] py-[var(--spacing-2)] font-[var(--font-weight-semibold)] text-text-primary bg-bg-secondary border-b border-border">{children}</th>; },
  td({ children }) { return <td className="px-[var(--spacing-3)] py-[var(--spacing-2)] text-text-secondary border-b border-border-divider">{children}</td>; },
  tr({ children, ...props }) { return <tr className="hover:bg-bg-hover transition-colors" {...props}>{children}</tr>; },
  hr() { return <hr className="border-border-divider my-[var(--spacing-6)]" />; },
  strong({ children }) { return <strong className="font-[var(--font-weight-semibold)] text-text-primary">{children}</strong>; },
  em({ children }) { return <em className="italic text-text-secondary">{children}</em>; },
};

export interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="max-w-none leading-[var(--line-height-relaxed)] text-[length:var(--font-size-base)]" role="document">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** Strip inline markdown formatting for clean display text */
function stripMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

export function extractToc(content: string): Array<{ id: string; level: number; text: string }> {
  const headings: Array<{ id: string; level: number; text: string }> = [];
  // Strip fenced code blocks to avoid matching # comments inside them
  const stripped = content.replace(/^```[\s\S]*?^```/gm, '');
  const regex = /^(#{1,4})\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(stripped)) !== null) {
    const level = m[1].length;
    const text = stripMarkdown(m[2].trim());
    const id = slugify(text);
    if (id) headings.push({ id, level, text });
  }
  return headings;
}
