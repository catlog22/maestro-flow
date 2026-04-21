/**
 * Spec Loader (simplified)
 *
 * Filename-based category routing. No frontmatter dependency.
 * Reads .workflow/specs/*.md, filters by category via static mapping,
 * returns concatenated content.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Types
// ============================================================================

export type SpecCategory = 'coding' | 'arch' | 'quality' | 'debug' | 'test' | 'review' | 'learning';

export interface SpecLoadResult {
  content: string;
  matchedSpecs: string[];
  totalLoaded: number;
}

// ============================================================================
// Filename → Category mapping (single source of truth)
// ============================================================================

export const CATEGORY_MAP: Record<string, SpecCategory> = {
  'coding-conventions.md':      'coding',
  'architecture-constraints.md': 'arch',
  'quality-rules.md':           'quality',
  'debug-notes.md':             'debug',
  'test-conventions.md':        'test',
  'review-standards.md':        'review',
  'learnings.md':               'learning',
};

const SPECS_DIR = '.workflow/specs';
export const TEAM_SPECS_DIR = '.workflow/collab/specs';

/** Layer labels used as section headers when multi-directory scanning is active. */
const LAYER_LABELS: Record<string, string> = {
  baseline: '# Baseline Specs',
  team: '# Team Specs',
  // personal label is dynamic — includes uid
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Load spec files from one or more directories.
 *
 * When `uid` is provided, scans three directories in order:
 *   1. .workflow/specs/              (baseline)
 *   2. .workflow/collab/specs/       (team shared)
 *   3. .workflow/collab/specs/{uid}/ (personal)
 *
 * Content from later layers is appended (never replaces earlier content).
 * Each layer's content is prefixed with a header for clarity.
 *
 * When `uid` is absent, only the baseline directory is scanned — identical
 * to the original single-directory behavior.
 */
export function loadSpecs(projectPath: string, category?: SpecCategory, uid?: string): SpecLoadResult {
  // Build ordered list of (directory, label) pairs to scan
  const layers = buildLayers(projectPath, uid);

  const allSections: string[] = [];
  const allMatched: string[] = [];
  let totalCount = 0;

  for (const { dir, label } of layers) {
    const { sections, matched } = loadFromDir(dir, category);
    if (sections.length === 0) continue;

    // Only add layer headers when multi-layer mode is active (uid provided)
    if (uid) {
      allSections.push(`${label}\n\n${sections.join('\n\n---\n\n')}`);
    } else {
      allSections.push(...sections);
    }
    allMatched.push(...matched);
    totalCount += matched.length;
  }

  return {
    content: allSections.length > 0
      ? `# Project Specs (${totalCount} loaded)\n\n${allSections.join('\n\n---\n\n')}`
      : '',
    matchedSpecs: allMatched,
    totalLoaded: totalCount,
  };
}

// ============================================================================
// Internal — multi-directory helpers
// ============================================================================

interface LayerDef {
  dir: string;
  label: string;
}

function buildLayers(projectPath: string, uid?: string): LayerDef[] {
  const baseline: LayerDef = {
    dir: join(projectPath, SPECS_DIR),
    label: LAYER_LABELS.baseline,
  };

  if (!uid) return [baseline];

  return [
    baseline,
    { dir: join(projectPath, TEAM_SPECS_DIR), label: LAYER_LABELS.team },
    { dir: join(projectPath, TEAM_SPECS_DIR, uid), label: `# Personal Specs (${uid})` },
  ];
}

/**
 * Load spec files from a single directory. Returns empty arrays if the
 * directory does not exist or is unreadable.
 */
function loadFromDir(
  specsDir: string,
  category?: SpecCategory,
): { sections: string[]; matched: string[] } {
  if (!existsSync(specsDir)) return { sections: [], matched: [] };

  let files: string[];
  try {
    files = readdirSync(specsDir).filter(f => f.endsWith('.md'));
  } catch {
    return { sections: [], matched: [] };
  }

  const sections: string[] = [];
  const matched: string[] = [];

  for (const file of files) {
    if (!shouldInclude(file, category)) continue;

    const filePath = join(specsDir, file);
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const body = stripFrontmatter(raw).trim();
    if (!body) continue;

    sections.push(body);
    matched.push(file);
  }

  return { sections, matched };
}

// ============================================================================
// Internal
// ============================================================================

function shouldInclude(filename: string, category?: SpecCategory): boolean {
  // No category filter → load all
  if (!category) return true;

  const cat = CATEGORY_MAP[filename];
  if (cat) return cat === category;

  // Unknown files: include only when no category filter
  return false;
}

function stripFrontmatter(raw: string): string {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('---')) return raw;
  const endIdx = trimmed.indexOf('\n---', 3);
  if (endIdx === -1) return raw;
  return trimmed.substring(endIdx + 4).trim();
}
