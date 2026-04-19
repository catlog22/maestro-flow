import { useState, useEffect, useMemo } from 'react';
import X from 'lucide-react/dist/esm/icons/x.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';

// ---------------------------------------------------------------------------
// FileViewer — displays file content with line numbers and syntax highlighting
// ---------------------------------------------------------------------------

interface FileViewerProps {
  filePath: string;
  onClose: () => void;
  /** When true, show compact path bar instead of full header */
  embedded?: boolean;
}

// ---- Lightweight syntax highlighting (no external deps) ----

/** File extension to language mapping */
function getLang(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'ts', tsx: 'ts', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
    json: 'json', css: 'css', html: 'html', md: 'md', yaml: 'yaml', yml: 'yaml',
    py: 'py', rs: 'rs', go: 'go', sh: 'sh', bash: 'sh',
  };
  return map[ext] ?? '';
}

/** Tokenize a line into spans with color classes */
function highlightLine(line: string, lang: string): (string | { text: string; color: string })[] {
  if (!lang || lang === 'md') return [line];

  const tokens: (string | { text: string; color: string })[] = [];
  // Simple regex-based tokenizer
  const patterns: [RegExp, string][] = lang === 'json'
    ? [
        [/"(?:[^"\\]|\\.)*"/g, 'var(--color-accent-green, #3D9B6F)'],
        [/\b(true|false|null)\b/g, 'var(--color-accent-orange, #D4832E)'],
        [/\b\d+(?:\.\d+)?\b/g, 'var(--color-accent-blue, #4A90D9)'],
      ]
    : [
        // Comments
        [/\/\/.*$/gm, 'var(--color-text-tertiary)'],
        // Strings
        [/(['"`])(?:(?!\1|\\).|\\.)*\1/g, 'var(--color-accent-green, #3D9B6F)'],
        // Template literals (simplified)
        [/`[^`]*`/g, 'var(--color-accent-green, #3D9B6F)'],
        // Keywords
        [/\b(import|export|from|const|let|var|function|return|if|else|for|while|class|interface|type|extends|implements|new|async|await|try|catch|throw|switch|case|break|default|yield|of|in|as|is|typeof|instanceof|void|null|undefined|true|false|this|super|static|readonly|public|private|protected|abstract|enum|namespace|module|declare|require)\b/g, 'var(--color-accent-purple, #8B6BBF)'],
        // Numbers
        [/\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/g, 'var(--color-accent-blue, #4A90D9)'],
        // Function calls
        [/\b([a-zA-Z_$]\w*)\s*\(/g, 'var(--color-accent-orange, #D4832E)'],
      ];

  // Apply highlighting by finding all matches and sorting by position
  interface Match { start: number; end: number; text: string; color: string }
  const matches: Match[] = [];

  for (const [re, color] of patterns) {
    const regex = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = regex.exec(line)) !== null) {
      // For function calls, only color the function name (group 1)
      if (m[1] && re.source.includes('\\(')) {
        matches.push({ start: m.index, end: m.index + m[1].length, text: m[1], color });
      } else {
        matches.push({ start: m.index, end: m.index + m[0].length, text: m[0], color });
      }
    }
  }

  // Sort by position, remove overlaps
  matches.sort((a, b) => a.start - b.start);
  const filtered: Match[] = [];
  let lastEnd = 0;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      filtered.push(m);
      lastEnd = m.end;
    }
  }

  // Build token list
  let pos = 0;
  for (const m of filtered) {
    if (m.start > pos) tokens.push(line.slice(pos, m.start));
    tokens.push({ text: m.text, color: m.color });
    pos = m.end;
  }
  if (pos < line.length) tokens.push(line.slice(pos));

  return tokens.length > 0 ? tokens : [line];
}

export function FileViewer({ filePath, onClose, embedded }: FileViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/workspace/file?path=${encodeURIComponent(filePath)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setError(`Failed to load: ${res.status}`);
          setContent(null);
        } else {
          setContent(await res.text());
        }
      })
      .catch(() => {
        if (!cancelled) setError('Failed to fetch file');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [filePath]);

  const fileName = filePath.split('/').pop() ?? filePath;
  const lang = getLang(filePath);
  const lines = useMemo(() => content?.split('\n') ?? [], [content]);
  const gutterWidth = lines.length > 0 ? String(lines.length).length : 1;

  return (
    <div className="flex flex-col h-full">
      {/* Full header — standalone mode */}
      {!embedded && (
        <div
          className="shrink-0 flex items-center gap-2 px-4 py-2 border-b"
          style={{ borderColor: 'var(--color-border-divider)', backgroundColor: 'var(--color-bg-secondary)' }}
        >
          <FileText size={13} strokeWidth={1.8} style={{ color: 'var(--color-text-tertiary)' }} />
          <span className="text-[12px] font-medium truncate flex-1" style={{ color: 'var(--color-text-primary)' }} title={filePath}>
            {fileName}
          </span>
          <span className="text-[10px] truncate max-w-[200px]" style={{ color: 'var(--color-text-tertiary)' }}>
            {filePath}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 rounded flex items-center justify-center transition-colors"
            style={{ color: 'var(--color-text-tertiary)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)'; }}
            aria-label="Close file viewer"
          >
            <X size={12} strokeWidth={2} />
          </button>
        </div>
      )}

      {/* Compact path bar — embedded mode */}
      {embedded && (
        <div
          className="shrink-0 flex items-center gap-[6px] px-3 h-[26px] border-b"
          style={{ borderColor: 'var(--color-border-divider)', backgroundColor: 'var(--color-bg-primary)' }}
        >
          <FileText size={12} strokeWidth={1.8} style={{ color: 'var(--color-text-tertiary)' }} />
          <span className="text-[11px] truncate" style={{ color: 'var(--color-text-secondary)' }} title={filePath}>
            {filePath}
          </span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="p-4 text-[12px] animate-pulse" style={{ color: 'var(--color-text-tertiary)' }}>
            Loading...
          </div>
        )}
        {error && (
          <div className="p-4 text-[12px]" style={{ color: 'var(--color-accent-red)' }}>
            {error}
          </div>
        )}
        {!loading && !error && content !== null && (
          <div
            className="m-0 text-[12px] leading-[1.7]"
            style={{ fontFamily: 'var(--font-mono)', tabSize: 2 }}
          >
            {lines.map((line, i) => (
              <div key={i} className="flex hover:bg-bg-hover" style={{ minHeight: '1.7em' }}>
                {/* Line number gutter */}
                <span
                  className="shrink-0 select-none text-right pr-[12px] pl-[12px]"
                  style={{
                    color: 'var(--color-text-placeholder)',
                    width: `${gutterWidth + 3}ch`,
                    userSelect: 'none',
                  }}
                >
                  {i + 1}
                </span>
                {/* Code content with syntax highlighting */}
                <span className="flex-1 whitespace-pre-wrap break-all pr-4" style={{ color: 'var(--color-text-primary)' }}>
                  {highlightLine(line, lang).map((token, j) =>
                    typeof token === 'string'
                      ? <span key={j}>{token}</span>
                      : <span key={j} style={{ color: token.color }}>{token.text}</span>,
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
