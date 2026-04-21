import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

// ---------------------------------------------------------------------------
// MermaidBlock -- renders mermaid diagram code as SVG
// Uses theme-aware rendering with transparent background
// ---------------------------------------------------------------------------

let mermaidInitialized = false;

function initMermaid() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    themeVariables: {
      // Transparent background — container div provides the background
      mainBkg: 'transparent',
      // Text colors matching the site palette
      primaryTextColor: '#78756F',
      // Node styling — light stroke, no fill
      primaryColor: '#F3F0EA',
      primaryBorderColor: '#E8E5DE',
      lineColor: '#A09D97',
      // Edge labels
      edgeLabelBackground: 'transparent',
      // Cluster/group styling
      clusterBkg: 'transparent',
      clusterBorder: '#E8E5DE',
      // Node text
      nodeTextColor: '#2D2A26',
      nodeBorder: '#E8E5DE',
      // Font
      fontFamily: 'inherit',
      fontSize: '13px',
    },
    securityLevel: 'loose',
    fontFamily: 'inherit',
  });
  mermaidInitialized = true;
}

interface MermaidBlockProps {
  chart: string;
}

export function MermaidBlock({ chart }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');

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
    <div
      ref={containerRef}
      className="my-[var(--spacing-4)] overflow-x-auto [&_svg]:max-w-full [&_svg]:mx-auto [&_.node rect]:fill-bg-secondary [&_.node rect]:stroke-border [&_.node polygon]:fill-bg-secondary [&_.node polygon]:stroke-border [&_.edgeLabel]:fill-transparent [&_.edgePath]:stroke-text-tertiary [&_.cluster rect]:fill-transparent [&_.cluster rect]:stroke-border"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
