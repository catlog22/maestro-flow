// ---------------------------------------------------------------------------
// TUI Design Tokens — The Cyberdeck Console
//
// Single source of truth for all visual constants across TUI modules.
// See: .workflow/impeccable/DESIGN.md
// ---------------------------------------------------------------------------

/** Semantic color palette — terminal ANSI names */
export const C = {
  /** Primary action/highlight — headers, active selections, focus */
  primary: 'cyan',
  /** Completion, selection, enabled states */
  success: 'green',
  /** Double-emphasis: selected + highlighted only */
  successBright: 'greenBright',
  /** Attention without urgency — warnings, current-state markers */
  warning: 'yellow',
  /** Error, failure, disabled status */
  error: 'red',
  /** Inactive, secondary, index numbers */
  neutral: 'gray',
  /** Metadata accents — model names, effort indicators */
  accent: 'magenta',
} as const;

/** Standardized UI symbols */
export const SYM = {
  // Multi-select checkboxes
  checkOn: '✓',
  checkOff: '·',
  // Single-select radio
  radioOn: '●',
  radioOff: '○',
  // Navigation cursor
  cursor: '▸',
  cursorBlank: ' ',
  // Step progress
  stepDone: '✓',
  stepActive: '▸',
  stepPending: '·',
  // Status indicators
  enabled: '✓',
  disabled: '✗',
  // Scroll indicators
  scrollUp: '▲',
  scrollDown: '▼',
  // Tree structure
  treeBranch: '├──',
  treeEnd: '└──',
  treePipe: '│',
  // Configured/present indicator
  dot: '●',
  dotEmpty: '○',
} as const;

/** Spacing constants (Ink Box units) */
export const SP = {
  /** Standard label column width for padEnd alignment */
  labelWidth: 14,
  /** Primary panel horizontal padding */
  panelPadX: 2,
  /** Primary panel vertical padding */
  panelPadY: 1,
  /** Detail/secondary panel horizontal padding */
  detailPadX: 1,
  /** Vertical gap between sections (marginTop) */
  sectionGap: 1,
  /** Gap between tabs */
  tabGap: 2,
  /** Gap between inline elements */
  inlineGap: 1,
} as const;

/** Border style presets */
export const BORDER = {
  /** Primary containers — round border in cyan */
  primary: { borderStyle: 'round' as const, borderColor: C.primary },
  /** Success containers — round border in green */
  success: { borderStyle: 'round' as const, borderColor: C.success },
  /** Warning containers — round border in yellow */
  warning: { borderStyle: 'round' as const, borderColor: C.warning },
  /** Detail/secondary containers — single border in gray */
  detail: { borderStyle: 'single' as const, borderColor: C.neutral },
} as const;
