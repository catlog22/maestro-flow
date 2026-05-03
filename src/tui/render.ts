// ---------------------------------------------------------------------------
// Unified ink TUI renderer — single entry point for all terminal UI screens.
//
// Encapsulates: dynamic ink/React import, render lifecycle, signal handling,
// and cleanup. All `*-ui/` modules delegate here instead of duplicating the
// boilerplate.
// ---------------------------------------------------------------------------

import type { ComponentType } from 'react';

export interface RenderTuiOptions {
  exitOnCtrlC?: boolean; // default: true
}

/**
 * Render an ink React component as a full-screen TUI.
 *
 * - Dynamically imports ink + React (preserves tree-shaking / lazy loading).
 * - Registers SIGINT / SIGTERM handlers and cleans them up on exit.
 * - Resolves when the ink app unmounts.
 */
export async function renderTui<P extends object>(
  component: ComponentType<P>,
  props: P,
  options?: RenderTuiOptions,
): Promise<void> {
  const { render } = await import('ink');
  const React = await import('react');

  const { exitOnCtrlC = true } = options ?? {};

  const { waitUntilExit } = render(
    React.createElement(component, props),
    { exitOnCtrlC },
  );

  const onSignal = () => process.exit(0);
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    await waitUntilExit();
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}
