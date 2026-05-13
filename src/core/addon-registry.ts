// ---------------------------------------------------------------------------
// Addon Registry — external skills installable via maestro install wizard.
//
// Each addon supports multiple harness targets (Claude Code, Codex, etc.).
// The install route copies from repo source paths to target harness dirs.
// ---------------------------------------------------------------------------

export type HarnessType = 'claude' | 'codex';

export interface AddonTarget {
  /** Harness type */
  harness: HarnessType;
  /** Source path within the repo (e.g. '.claude/skills/impeccable') */
  srcPath: string;
  /** Target path relative to base (e.g. '.claude/skills/impeccable') */
  destPath: string;
}

export interface AddonDef {
  /** Unique addon identifier */
  id: string;
  /** Display name */
  name: string;
  /** One-line description */
  description: string;
  /** GitHub repo in owner/repo format */
  repo: string;
  /** Branch to clone from */
  branch: string;
  /** Install targets per harness — each copies srcPath → destPath */
  targets: AddonTarget[];
  /** Homepage URL for info link */
  homepage?: string;
  /** Tags for categorization */
  tags?: string[];
}

/** Harness dir mapping: harness → dotdir */
export const HARNESS_DIRS: Record<HarnessType, string> = {
  claude: '.claude',
  codex: '.codex',
};

export const ADDON_REGISTRY: AddonDef[] = [
  {
    id: 'impeccable',
    name: 'Impeccable',
    description: 'Production-grade frontend design — 23 commands for UI craft, critique, polish, and iteration',
    repo: 'pbakaus/impeccable',
    branch: 'main',
    targets: [
      { harness: 'claude', srcPath: '.claude/skills/impeccable', destPath: '.claude/skills/impeccable' },
      { harness: 'codex', srcPath: '.codex/agents', destPath: '.codex/agents' },
    ],
    homepage: 'https://impeccable.style',
    tags: ['design', 'frontend', 'ui', 'ux'],
  },
  {
    id: 'ui-ux-pro-max',
    name: 'UI/UX Pro Max',
    description: 'Design intelligence — 50+ styles, 97 palettes, 57 font pairings, 99 UX guidelines across 9 stacks',
    repo: 'nextlevelbuilder/ui-ux-pro-max-skill',
    branch: 'main',
    targets: [
      { harness: 'claude', srcPath: '.claude/skills/ui-ux-pro-max', destPath: '.claude/skills/ui-ux-pro-max' },
      // Codex: reuse claude skill — same SKILL.md works in .codex/skills/
      { harness: 'codex', srcPath: '.claude/skills/ui-ux-pro-max', destPath: '.codex/skills/ui-ux-pro-max' },
    ],
    homepage: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
    tags: ['design', 'ui', 'ux', 'tokens', 'typography'],
  },
];
