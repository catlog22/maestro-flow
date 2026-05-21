// ---------------------------------------------------------------------------
// GuideComponents — Shared visual components for guide & quick-start pages
// Mac-style terminal block, collapsible sections, and typography helpers
// ---------------------------------------------------------------------------

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

// -- Mac-style Terminal Block --

export interface TerminalBlockProps {
  children: React.ReactNode;
  title?: string;
  compact?: boolean;
}

export function TerminalBlock({ children, title, compact }: TerminalBlockProps) {
  return (
    <div
      className="rounded-[8px] overflow-hidden border"
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
      </div>
      <div
        className={[compact ? 'px-[12px] py-[6px]' : 'px-[14px] py-[10px]', 'font-[var(--font-mono)] overflow-x-auto'].join(' ')}
        style={{ backgroundColor: 'var(--color-terminal-body)' }}
      >
        {children}
      </div>
    </div>
  );
}
