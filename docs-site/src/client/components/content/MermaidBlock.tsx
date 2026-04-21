import { useEffect, useRef, useState, useCallback } from 'react';
import mermaid from 'mermaid';

// ---------------------------------------------------------------------------
// MermaidBlock -- renders mermaid diagram with click-to-zoom overlay
// Zoom-to-cursor: scroll wheel keeps the point under cursor stationary
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
  const scaleRef = useRef(1.5);
  const [, forceUpdate] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const setScale = useCallback((next: number) => {
    scaleRef.current = Math.min(Math.max(next, 0.3), 4);
    forceUpdate((n) => n + 1);
  }, []);

  useEffect(() => {
    initMermaid();
    let cancelled = false;
    const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
    mermaid
      .render(id, chart)
      .then(({ svg: result }) => { if (!cancelled) { setSvg(result); setError(''); } })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Mermaid render error'); });
    return () => { cancelled = true; };
  }, [chart]);

  // Zoom-to-cursor: adjust scroll so the point under the cursor stays put
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const oldScale = scaleRef.current;
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    const newScale = Math.min(Math.max(oldScale + delta, 0.3), 4);

    // Cursor position relative to scrollable content
    const cursorX = e.clientX + scroller.scrollLeft;
    const cursorY = e.clientY + scroller.scrollTop;

    // After resize, that same content point moves to: cursor * (newScale / oldScale)
    const ratio = newScale / oldScale;

    scaleRef.current = newScale;
    forceUpdate((n) => n + 1);

    // Adjust scroll so cursor stays over the same content point
    requestAnimationFrame(() => {
      scroller.scrollLeft = cursorX * ratio - e.clientX;
      scroller.scrollTop = cursorY * ratio - e.clientY;
    });
  }, []);

  const closeOverlay = useCallback(() => {
    setExpanded(false);
    scaleRef.current = 1.5;
  }, []);

  // ESC to close; lock body scroll
  useEffect(() => {
    if (!expanded) return;
    document.body.style.overflow = 'hidden';
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeOverlay(); };
    document.addEventListener('keydown', handler);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handler);
    };
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

  const scale = scaleRef.current;

  return (
    <>
      {/* Inline diagram — click to expand */}
      <div
        className="bg-bg-code rounded-[var(--radius-lg)] p-[var(--spacing-5)] my-[var(--spacing-4)] overflow-x-auto cursor-zoom-in relative"
        onClick={() => setExpanded(true)}
      >
        <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
      </div>

      {/* Expanded overlay */}
      {expanded && (
        <div
          className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm"
          onClick={closeOverlay}
        >
          {/* Close */}
          <button
            onClick={closeOverlay}
            className="absolute top-[var(--spacing-5)] right-[var(--spacing-5)] z-10 w-8 h-8 flex items-center justify-center rounded-full bg-bg-card/80 text-text-secondary hover:text-text-primary hover:bg-bg-card transition-colors"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          {/* Zoom controls */}
          <div className="absolute bottom-[var(--spacing-5)] right-[var(--spacing-5)] z-10 flex items-center gap-2 bg-bg-card/80 rounded-[var(--radius-default)] px-3 py-1.5 text-[length:12px] text-text-secondary">
            <button onClick={(e) => { e.stopPropagation(); setScale(scale + 0.2); }} className="hover:text-text-primary px-1" aria-label="Zoom in">+</button>
            <span className="tabular-nums min-w-[3ch] text-center">{Math.round(scale * 100)}%</span>
            <button onClick={(e) => { e.stopPropagation(); setScale(scale - 0.2); }} className="hover:text-text-primary px-1" aria-label="Zoom out">&minus;</button>
            <span className="mx-1 text-border">|</span>
            <button onClick={(e) => { e.stopPropagation(); setScale(1.5); }} className="hover:text-text-primary">Reset</button>
          </div>

          {/* Scrollable viewport — starts top-left, no centering */}
          <div
            ref={scrollerRef}
            className="w-full h-full overflow-auto"
            onClick={(e) => e.stopPropagation()}
            onWheel={handleWheel}
          >
            <div
              className="mermaid-diagram bg-bg-code rounded-[var(--radius-lg)] p-[var(--spacing-8)]"
              style={{ width: `${scale * 90}vw`, maxWidth: 'none' }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </div>
      )}
    </>
  );
}
