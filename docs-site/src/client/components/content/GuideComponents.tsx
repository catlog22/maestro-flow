// ---------------------------------------------------------------------------
// GuideComponents — Shared visual components for guide & quick-start pages
// Mac-style terminal block, collapsible sections, and typography helpers
// ---------------------------------------------------------------------------

import { useState, useCallback, useRef } from 'react';

// -- Language → Display Title --

const LANG_TITLES: Record<string, string> = {
  bash: 'Terminal', sh: 'Terminal', shell: 'Terminal', zsh: 'Terminal',
  json: 'JSON', jsonc: 'JSON',
  typescript: 'TypeScript', ts: 'TypeScript', tsx: 'TypeScript',
  javascript: 'JavaScript', js: 'JavaScript', jsx: 'JavaScript',
  markdown: 'Markdown', md: 'Markdown',
  yaml: 'YAML', yml: 'YAML',
  css: 'CSS', html: 'HTML',
  python: 'Python', py: 'Python',
  sql: 'SQL', graphql: 'GraphQL',
  toml: 'TOML', ini: 'INI', diff: 'Diff',
};

export function langToTitle(lang: string): string {
  return LANG_TITLES[lang] || (lang ? lang.charAt(0).toUpperCase() + lang.slice(1) : '');
}

// -- Copy Button --

function CopyButton({ contentRef }: { contentRef: React.RefObject<HTMLDivElement | null> }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text = contentRef.current?.textContent ?? '';
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [contentRef]);

  return (
    <button
      onClick={handleCopy}
      className="ml-auto flex items-center gap-[4px] px-[6px] py-[2px] rounded-[4px] text-[11px] transition-colors duration-150 cursor-pointer border-none"
      style={{
        color: copied ? 'var(--color-accent-green)' : 'var(--color-terminal-title-text)',
        backgroundColor: copied ? 'rgba(30, 142, 62, 0.1)' : 'transparent',
      }}
      onMouseEnter={(e) => {
        if (!copied) (e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)');
      }}
      onMouseLeave={(e) => {
        if (!copied) (e.currentTarget.style.backgroundColor = 'transparent');
      }}
      title="Copy"
    >
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// -- Mac-style Terminal Block --

export interface TerminalBlockProps {
  children: React.ReactNode;
  title?: string;
  compact?: boolean;
}

export function TerminalBlock({ children, title, compact }: TerminalBlockProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="rounded-[8px] overflow-hidden border group/terminal"
      style={{
        borderColor: 'var(--color-terminal-border)',
        boxShadow: 'var(--color-terminal-shadow)',
      }}
    >
      <div
        className={['flex items-center px-[12px]', compact ? 'py-[5px]' : 'py-[7px]'].join(' ')}
        style={{
          backgroundColor: 'var(--color-terminal-titlebar)',
          borderBottom: '1px solid var(--color-terminal-titlebar-border)',
        }}
      >
        <span className="flex items-center gap-[6px] mr-[10px]">
          <span className="w-[10px] h-[10px] rounded-full bg-[#ff5f57]" />
          <span className="w-[10px] h-[10px] rounded-full bg-[#febc2e]" />
          <span className="w-[10px] h-[10px] rounded-full bg-[#28c840]" />
        </span>
        {title && (
          <span
            className="text-[11px] font-[var(--font-weight-medium)] truncate"
            style={{ color: 'var(--color-terminal-title-text)' }}
          >
            {title}
          </span>
        )}
        <CopyButton contentRef={contentRef} />
      </div>
      <div
        ref={contentRef}
        className={[compact ? 'px-[12px] py-[6px]' : 'px-[14px] py-[10px]', 'font-[var(--font-mono)] overflow-x-auto'].join(' ')}
        style={{ backgroundColor: 'var(--color-terminal-body)' }}
      >
        {children}
      </div>
    </div>
  );
}
