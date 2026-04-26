// ---------------------------------------------------------------------------
// Overlay types — shared shapes for overlay loading, patching, and tracking.
// ---------------------------------------------------------------------------

export type OverlayMode = 'append' | 'prepend' | 'replace' | 'new-section';

/** Target CLI tool for overlay application. */
export type OverlayCli = 'claude' | 'codex' | 'both';

/** XML-tagged sections recognised in command and skill files. */
export const KNOWN_SECTIONS = [
  'purpose',
  'required_reading',
  'deferred_reading',
  'context',
  'execution',
  'error_codes',
  'success_criteria',
] as const;

export type KnownSection = (typeof KNOWN_SECTIONS)[number];

export interface OverlayPatch {
  /** Target section name (KnownSection for existing sections, any slug for new-section). */
  section: string;
  mode: OverlayMode;
  /** Raw markdown body injected between markers. */
  content: string;
  /** For `new-section`: insert after this existing section's close tag. */
  afterSection?: string;
}

export interface OverlayMeta {
  name: string;
  description?: string;
  targets: string[];
  priority?: number;
  enabled?: boolean;
  scope?: 'global' | 'project' | 'any';
  /** Target CLI: 'claude' (default) | 'codex' | 'both'. */
  cli?: OverlayCli;
  docs?: string[];
  patches: OverlayPatch[];
}

export interface OverlayFile {
  meta: OverlayMeta;
  sourcePath: string;
  /** Full file contents (frontmatter + body). */
  raw: string;
  /** SHA-256 of `raw`, short 8-char form used in markers. */
  hash: string;
}

export interface AppliedTarget {
  commandName: string;
  commandPath: string;
  sectionsPatched: string[];
  markerIds: string[];
}

export interface AppliedOverlay {
  overlayName: string;
  overlayHash: string;
  targets: AppliedTarget[];
}

export interface OverlayManifest {
  version: '1.0';
  scope: 'global' | 'project';
  targetBase: string;
  installedAt: string;
  appliedOverlays: AppliedOverlay[];
}

export const OVERLAY_MANIFEST_VERSION = '1.0' as const;
