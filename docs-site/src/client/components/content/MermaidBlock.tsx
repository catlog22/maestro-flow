import { useEffect, useRef, useState, useCallback } from 'react';
import mermaid from 'mermaid';

// ---------------------------------------------------------------------------
// MermaidBlock -- renders mermaid diagram with click-to-zoom overlay
// ---------------------------------------------------------------------------

let mermaidInitialized = false;

function initMermaid() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    themeVariables: {
      mainBkg: '#302D28',
      primaryBorderColor: '#5A554F',
      primaryTextColor: '#E8E5DE',
      lineColor: '#78756F',
      edgeLabelBackground: 'transparent',
      clusterBkg: 'rgba(255,255,255,0.03)',
      clusterBorder: '#4A4740',
      secondaryColor: '#302D28',
      secondaryBorderColor: '#5AC78B',
      secondaryTextColor: '#E8E5DE',
      tertiaryColor: '#302D28',
      tertiaryBorderColor: '#6BA8E8',
      tertiaryTextColor: '#E8E5DE',
      lineWidth: '1.5px',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '13px',
    },
    securityLevel: 'loose',
    fontFamily: 'Inter, system-ui, sans-serif',
  });
  mermaidInitialized = true;
}

interface MermaidBlockProps {
  chart: string;
}

export function MermaidBlock({ chart }: MermaidBlockProps) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [expanded, setExpanded] = useState(false);
  const [scale, setScale] = useState(1.5);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    initMermaid();

    let cancelled = false;
    const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;

    mermaid
      .render(id, chart)
      .then(({ svg: result }) => {
        if (!cancelled) {
          setSvg(result);
          setError('');
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Mermaid render error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chart]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale((s) => Math.min(Math.max(s + (e.deltaY < 0 ? 0.15 : -0.15), 0.3), 3));
  }, []);

  const closeOverlay = useCallback(() => {
    setExpanded(false);
    setScale(1.5);
  }, []);

  // ESC to close
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeOverlay();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [expanded, closeOverlay]);

  if (error) {
    return (
      <div className="bg-bg-code rounded-[var(--radius-lg)] p-[var(--spacing-4)] my-[var(--spacing-4)] text-red-400 text-[length:var(--font-size-sm)] font-mono overflow-x-auto">
        <p className="mb-2 font-semibold">Mermaid render error:</p>
        <pre className="whitespace-pre-wrap">{error}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="bg-bg-code rounded-[var(--radius-lg)] p-[var(--spacing-4)] my-[var(--spacing-4)] text-text-placeholder text-[length:var(--font-size-sm)]">
        Loading diagram...
      </div>
    );
  }

  return (
    <>
      {/* Inline diagram — click to expand */}
      <div
        className="bg-bg-code rounded-[var(--radius-lg)] p-[var(--spacing-5)] my-[var(--spacing-4)] overflow-x-auto cursor-zoom-in relative"
        onClick={() => setExpanded(true)}
      >
        <div
          className="mermaid-diagram"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

      {/* Expanded overlay */}
      {expanded && (
        <div
          className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm"
          onClick={closeOverlay}
        >
          {/* Close button */}
          <button
            onClick={closeOverlay}
            className="absolute top-[var(--spacing-5)] right-[var(--spacing-5)] z-10 w-8 h-8 flex items-center justify-center rounded-full bg-bg-card/80 text-text-secondary hover:text-text-primary hover:bg-bg-card transition-colors"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          {/* Zoom controls */}
          <div className="absolute bottom-[var(--spacing-5)] right-[var(--spacing-5)] z-10 flex items-center gap-2 bg-bg-card/80 rounded-[var(--radius-default)] px-3 py-1.5 text-[length:12px] text-text-secondary">
            <button onClick={(e) => { e.stopPropagation(); setScale((s) => Math.min(s + 0.2, 4)); }} className="hover:text-text-primary px-1" aria-label="Zoom in">+</button>
            <span className="tabular-nums min-w-[3ch] text-center">{Math.round(scale * 100)}%</span>
            <button onClick={(e) => { e.stopPropagation(); setScale((s) => Math.max(s - 0.2, 0.5)); }} className="hover:text-text-primary px-1" aria-label="Zoom out">&minus;</button>
            <span className="mx-1 text-border">|</span>
            <button onClick={(e) => { e.stopPropagation(); setScale(1.5); }} className="hover:text-text-primary">Reset</button>
          </div>

          {/* Full viewport scrollable area */}
          <div
            ref={overlayRef}
            className="w-full h-full overflow-auto"
            onClick={(e) => e.stopPropagation()}
            onWheel={handleWheel}
          >
            <div
              className="mermaid-diagram bg-bg-code rounded-[var(--radius-lg)] p-[var(--spacing-8)] m-auto"
              style={{ width: `${scale * 90}vw`, maxWidth: 'none' }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </div>
      )}
    </>
  );
}
