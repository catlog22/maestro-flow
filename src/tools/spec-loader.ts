/**
 * Spec Loader
 *
 * Category-based loading with keyword cross-matching and knowhow tool discovery.
 * Reads .workflow/specs/*.md, filters by category via static mapping,
 * discovers knowhow tools with matching category, returns concatenated content.
 */

import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSpecEntries, formatSpecEntries, type SpecEntryParsed } from './spec-entry-parser.js';
import { paths } from '../config/paths.js';
import {
  SPEC_SEED_DOCS,
  formatSeedFrontmatter,
  hasFrontmatter,
  renderSeedContent,
} from './spec-seeds.js';
import { stripFrontmatter } from '../utils/frontmatter.js';

// ============================================================================
// Types
// ============================================================================

export type SpecCategory = 'coding' | 'arch' | 'debug' | 'test' | 'review' | 'learning' | 'ui';

export type SpecScope = 'project' | 'global' | 'team' | 'personal';

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
  'debug-notes.md':             'debug',
  'test-conventions.md':        'test',
  'review-standards.md':        'review',
  'quality-rules.md':           'review',
  'learnings.md':               'learning',
  'ui-conventions.md':          'ui',
};

const SPECS_DIR = '.workflow/specs';
export const TEAM_SPECS_DIR = '.workflow/collab/specs';

/** Layer labels used as section headers when multi-directory scanning is active. */
const LAYER_LABELS: Record<string, string> = {
  global: '# Global Specs',
  baseline: '# Baseline Specs',
  team: '# Team Specs',
  // personal label is dynamic — includes uid
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Resolve the directory for a given spec scope.
 *
 * | scope      | directory                           |
 * |------------|-------------------------------------|
 * | project    | .workflow/specs/                    |
 * | global     | ~/.maestro/specs/                   |
 * | team       | .workflow/collab/specs/              |
 * | personal   | .workflow/collab/specs/{uid}/        |
 */
export function resolveSpecDir(projectPath: string, scope: SpecScope, uid?: string): string {
  switch (scope) {
    case 'global':   return paths.specs;
    case 'team':     return join(projectPath, TEAM_SPECS_DIR);
    case 'personal': {
      if (!uid) throw new Error('personal scope requires uid');
      return join(projectPath, TEAM_SPECS_DIR, uid);
    }
    case 'project':
    default:         return join(projectPath, SPECS_DIR);
  }
}

/**
 * Load spec files from one or more directories.
 *
 * Layer scanning order (lowest → highest priority):
 *   0. ~/.maestro/specs/             (global — when `scope` includes global)
 *   1. .workflow/specs/              (baseline)
 *   2. .workflow/collab/specs/       (team shared — when `uid` is provided)
 *   3. .workflow/collab/specs/{uid}/ (personal — when `uid` is provided)
 *
 * Content from later layers is appended (never replaces earlier content).
 * Each layer's content is prefixed with a header for clarity.
 *
 * @param scope   Controls which extra layers to include beyond baseline.
 *                - 'project': baseline only (default)
 *                - 'global': global + baseline
 *                - 'team': baseline + team shared
 *                - 'personal': baseline + team shared + personal (requires uid)
 *                - undefined: same as 'project'; uid alone still triggers team+personal for backward compat
 */
export interface LoadSpecsOptions {
  /** Override global specs directory (for testing). Defaults to ~/.maestro/specs/ */
  globalDir?: string;
  /** Keyword whitelist: only include entries matching at least one keyword */
  includeKeywords?: string[];
  /** Keyword blacklist: exclude entries matching any of these keywords */
  excludeKeywords?: string[];
  /** Extra spec filenames to include for the category (dynamic CATEGORY_MAP extension) */
  extraSpecFiles?: string[];
  /** Linked workspace specs directories (read-only, inserted between global and baseline layers) */
  linkedWorkspaces?: Array<{ name: string; specsDir: string }>;
}

export function loadSpecs(projectPath: string, category?: SpecCategory, uid?: string, keyword?: string, scope?: SpecScope, options?: LoadSpecsOptions): SpecLoadResult {
  const globalDir = options?.globalDir ?? paths.specs;

  // Build ordered list of (directory, label) pairs to scan
  const layers = buildLayers(projectPath, uid, scope, globalDir, options?.linkedWorkspaces);

  // Auto-init baseline and global layers.
  // Team/personal are per-user — auto-creating them for arbitrary uids is wrong.
  autoInitSeeds(join(projectPath, SPECS_DIR));
  autoInitSeeds(globalDir);

  // First pass: collect results per layer (skip empty)
  const layerResults: Array<{ label: string; sections: string[]; matched: string[] }> = [];
  for (const { dir, label } of layers) {
    const { sections, matched } = loadFromDir(dir, category, keyword, options);
    if (sections.length > 0) {
      layerResults.push({ label, sections, matched });
    }
  }

  // Only show layer headers when multiple layers have actual content
  const multiLayer = layerResults.length > 1;

  const allSections: string[] = [];
  const allMatched: string[] = [];
  let totalCount = 0;

  for (const { label, sections, matched } of layerResults) {
    if (multiLayer) {
      allSections.push(`${label}\n\n${sections.join('\n\n---\n\n')}`);
    } else {
      allSections.push(...sections);
    }
    allMatched.push(...matched);
    totalCount += matched.length;
  }

  // Tool discovery: scan knowhow/ for documents matching category + tool: true
  if (category) {
    const toolSection = discoverKnowhowTools(join(projectPath, '.workflow'), category);
    if (toolSection) {
      allSections.push(toolSection.content);
      totalCount += toolSection.count;
    }
  }

  // Hit tracking: silently log which specs were loaded for decay analysis
  if (totalCount > 0) {
    recordHit(projectPath, category, keyword, allMatched);
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

function buildLayers(projectPath: string, uid?: string, scope?: SpecScope, globalDir?: string, linkedWorkspaces?: Array<{ name: string; specsDir: string }>): LayerDef[] {
  const layers: LayerDef[] = [];

  // Global layer — always included as lowest priority
  layers.push({ dir: globalDir ?? paths.specs, label: LAYER_LABELS.global });

  // Linked workspace layers — between global and baseline (read-only)
  if (linkedWorkspaces) {
    for (const lw of linkedWorkspaces) {
      if (existsSync(lw.specsDir)) {
        layers.push({ dir: lw.specsDir, label: `# Linked Specs (${lw.name})` });
      }
    }
  }

  // Baseline — always included
  layers.push({
    dir: join(projectPath, SPECS_DIR),
    label: LAYER_LABELS.baseline,
  });

  // Team + personal layers
  // Activated by scope='team'|'personal', or by uid (backward compat)
  if (scope === 'team' || scope === 'personal' || uid) {
    layers.push({ dir: join(projectPath, TEAM_SPECS_DIR), label: LAYER_LABELS.team });

    if (uid) {
      layers.push({ dir: join(projectPath, TEAM_SPECS_DIR, uid), label: `# Personal Specs (${uid})` });
    }
  }

  return layers;
}

/**
 * Load spec files from a single directory. Returns empty arrays if the
 * directory does not exist or is unreadable.
 *
 * When `category` is provided:
 * - Primary category doc is loaded in full
 * - Other files: only entries with matching keywords are included (cross-category)
 */
function loadFromDir(
  specsDir: string,
  category?: SpecCategory,
  keyword?: string,
  options?: LoadSpecsOptions,
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
    if (!shouldInclude(file, category, options?.extraSpecFiles)) continue;

    const filePath = join(specsDir, file);
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const body = stripFrontmatter(raw).trim();
    if (!body) continue;

    // Primary category doc → full load; other files → keyword-filtered only
    const fileCategory = CATEGORY_MAP[file];
    const isPrimaryDoc = category && (fileCategory === category || options?.extraSpecFiles?.includes(file));

    const workflowRoot = join(specsDir, '..');
    const formatted = formatFileContent(body, keyword, isPrimaryDoc ? undefined : category, workflowRoot, options);
    if (formatted) {
      sections.push(formatted);
      matched.push(file);
    }
  }

  return { sections, matched };
}

// ============================================================================
// Internal
// ============================================================================

function shouldInclude(filename: string, category?: SpecCategory, extraSpecFiles?: string[]): boolean {
  if (!category) return true; // No filter → load all

  // Extra spec files for this category → always include as primary
  if (extraSpecFiles?.includes(filename)) return true;

  // Category filter: include primary doc + all other files (for keyword cross-matching)
  const cat = CATEGORY_MAP[filename];
  if (!cat) {
    console.warn(`[spec] file not in category map, skipped: ${filename}`);
    return false;
  }

  // Primary category doc → always include (full load)
  if (cat === category) return true;

  // Other category files → include for keyword-based cross-category matching
  return true;
}

/**
 * Parse file body, strip <spec-entry> tags, format clean output with metadata.
 * When keyword is provided, only return matching entries.
 * When crossCategory is provided, only return entries whose keywords overlap
 * (cross-category matching for non-primary docs).
 * Falls back to raw body for files with no structured entries.
 */
function formatFileContent(body: string, keyword?: string, crossCategory?: SpecCategory, workflowRoot?: string, options?: LoadSpecsOptions): string | null {
  const { entries, legacy } = parseSpecEntries(body);

  // No structured entries → pass through raw body (or keyword-grep it)
  if (entries.length === 0 && legacy.length === 0) {
    // Cross-category mode: non-primary docs with no structured entries are skipped
    if (crossCategory) return null;

    // Skip files that are just headings with no real content (e.g. empty seed files)
    const stripped = body.replace(/^#+\s+.*$/gm, '').replace(/^---+$/gm, '').trim();
    if (!stripped) return null;

    if (keyword) {
      return body.toLowerCase().includes(keyword.toLowerCase()) ? body : null;
    }
    return body;
  }

  // In cross-category mode: only show entries that have keyword overlap
  let filteredEntries = entries;
  if (crossCategory && keyword) {
    const kw = keyword.toLowerCase();
    filteredEntries = entries.filter(e => e.keywords.includes(kw));
    if (filteredEntries.length === 0) return null;
  } else if (crossCategory) {
    // Cross-category without keyword → skip (no way to match)
    return null;
  }

  // Apply keyword whitelist/blacklist filters from config
  if (options?.includeKeywords?.length) {
    const include = new Set(options.includeKeywords.map(k => k.toLowerCase()));
    filteredEntries = filteredEntries.filter(e =>
      e.keywords.some(k => include.has(k.toLowerCase())),
    );
  }
  if (options?.excludeKeywords?.length) {
    const exclude = new Set(options.excludeKeywords.map(k => k.toLowerCase()));
    filteredEntries = filteredEntries.filter(e =>
      !e.keywords.some(k => exclude.has(k.toLowerCase())),
    );
  }

  const parts: string[] = [];

  // Separate ref entries (lightweight display) from regular entries
  const refEntries = filteredEntries.filter(e => e.ref);
  const regularEntries = filteredEntries.filter(e => !e.ref);

  if (keyword) {
    const kw = keyword.toLowerCase();
    const matchedRegular = regularEntries.filter(e => e.keywords.includes(kw));
    const matchedRef = refEntries.filter(e => e.keywords.includes(kw));
    if (matchedRegular.length > 0) parts.push(formatSpecEntries(matchedRegular));
    if (matchedRef.length > 0) parts.push(matchedRef.map(e => formatRefEntry(e, workflowRoot)).join('\n\n---\n\n'));
    if (!crossCategory) {
      for (const leg of legacy) {
        if (leg.content.toLowerCase().includes(kw)) parts.push(leg.content);
      }
    }
  } else {
    if (regularEntries.length > 0) parts.push(formatSpecEntries(regularEntries));
    if (refEntries.length > 0) parts.push(refEntries.map(e => formatRefEntry(e, workflowRoot)).join('\n\n---\n\n'));
    if (!crossCategory) {
      for (const leg of legacy) parts.push(leg.content);
    }
  }

  return parts.length > 0 ? parts.join('\n\n---\n\n') : null;
}

/**
 * Format a ref entry as a lightweight summary with a load command hint.
 *
 * Summary resolution order:
 *   1. YAML `summary` field from the referenced knowhow document
 *   2. Spec-entry content body (first 200 chars after heading)
 */
function formatRefEntry(e: SpecEntryParsed, workflowRoot?: string): string {
  const refStem = (e.ref ?? '').replace(/^knowhow\//, '').replace(/\.md$/, '');
  const refSlug = refStem.replace(/^(KNW|TIP|TPL|RCP|REF|DCS|AST|BLP|DOC)-/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const refId = `knowhow-${refSlug}`;

  // Try to read YAML summary from the referenced knowhow document
  let summary = resolveRefSummary(e.ref, workflowRoot);

  // Fallback: extract summary from spec-entry content (strip heading)
  if (!summary) {
    summary = e.content;
    const headingIdx = summary.indexOf('\n');
    if (headingIdx !== -1 && summary.trimStart().startsWith('###')) {
      summary = summary.slice(headingIdx).trim();
    }
    summary = summary.slice(0, 200).replace(/\s+/g, ' ').trim();
  }

  return `### ${e.title}\n\n${summary}\n\n\u2192 Detail: maestro wiki load ${refId}`;
}

/**
 * Read a knowhow file's YAML frontmatter `summary` field.
 * Returns null if the file doesn't exist or has no summary.
 */
function resolveRefSummary(ref: string | undefined, workflowRoot: string | undefined): string | null {
  if (!ref || !workflowRoot) return null;
  const absPath = join(workflowRoot, ref);
  try {
    const raw = readFileSync(absPath, 'utf-8');
    const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;
    const summaryMatch = fmMatch[1].match(/^summary:\s*"?(.+?)"?\s*$/m);
    return summaryMatch ? summaryMatch[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Scan knowhow/ for documents matching category + tool: true in YAML frontmatter.
 * Returns a formatted section with tool summaries and load commands.
 */
function discoverKnowhowTools(workflowRoot: string, category: SpecCategory): { content: string; count: number } | null {
  const knowhowDir = join(workflowRoot, 'knowhow');
  if (!existsSync(knowhowDir)) return null;

  let files: string[];
  try {
    files = readdirSync(knowhowDir).filter(f => f.endsWith('.md'));
  } catch {
    return null;
  }

  const tools: Array<{ title: string; summary: string; id: string }> = [];

  for (const file of files) {
    try {
      const raw = readFileSync(join(knowhowDir, file), 'utf-8');
      const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;

      const fm = fmMatch[1];
      // Check tool: true
      if (!/^tool:\s*true\s*$/m.test(fm)) continue;
      // Check category match
      const catMatch = fm.match(/^category:\s*(.+)$/m);
      if (!catMatch || catMatch[1].trim() !== category) continue;

      const titleMatch = fm.match(/^title:\s*(.+)$/m);
      const summaryMatch = fm.match(/^summary:\s*"?(.+?)"?\s*$/m);
      const title = titleMatch ? titleMatch[1].trim() : file;

      // Summary: YAML summary field, or first paragraph after frontmatter
      let summary = summaryMatch ? summaryMatch[1].trim() : '';
      if (!summary) {
        const body = raw.slice(fmMatch[0].length + 1).trim();
        summary = body.split('\n\n')[0].slice(0, 200).replace(/\s+/g, ' ');
      }

      const stem = file.replace(/\.md$/, '');
      const slug = stem.replace(/^(KNW|TIP|TPL|RCP|REF|DCS|AST|BLP|DOC)-/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      tools.push({ title, summary, id: `knowhow-${slug}` });
    } catch {
      continue;
    }
  }

  if (tools.length === 0) return null;

  const content = `## Available Tools (${category})\n\n` +
    tools.map(t => `### ${t.title} (tool)\n\n${t.summary}\n\n→ Load: maestro wiki load ${t.id}`).join('\n\n---\n\n');

  return { content, count: tools.length };
}

// ============================================================================
// Auto-init seed files
// ============================================================================

/** Directories already checked this process — skip re-checking. */
const autoInitChecked = new Set<string>();

/**
 * Auto-create a specs directory with seed files if it does not exist,
 * and migrate existing files that lack a YAML frontmatter block.
 * Applies to every layer (global, baseline, team, personal).
 *
 * For project-local dirs: only runs when `.workflow/` already exists
 * (i.e. the project is maestro-managed).
 * For global (`~/.maestro/specs/`): always creates — the home dir exists by definition.
 *
 * Synchronous, per-directory dedup, best-effort — never throws.
 */
function autoInitSeeds(specsDir: string): void {
  if (autoInitChecked.has(specsDir)) return;

  // For project-local paths, only auto-init when .workflow/ already exists.
  // Global path (under ~/.maestro/) always qualifies.
  const isGlobal = specsDir === paths.specs;
  if (!isGlobal) {
    // Walk up to check if .workflow/ parent exists
    // specsDir patterns: <project>/.workflow/specs, <project>/.workflow/collab/specs[/<uid>]
    const workflowIdx = specsDir.replace(/\\/g, '/').indexOf('.workflow/');
    if (workflowIdx !== -1) {
      const workflowDir = specsDir.substring(0, workflowIdx + '.workflow'.length);
      if (!existsSync(workflowDir)) return;
    }
  }

  try {
    if (!existsSync(specsDir)) {
      mkdirSync(specsDir, { recursive: true });
    }
    for (const doc of SPEC_SEED_DOCS) {
      const filePath = join(specsDir, doc.filename);
      if (!existsSync(filePath)) {
        writeFileSync(filePath, renderSeedContent(doc), 'utf-8');
        continue;
      }
      // Migrate: legacy stubs lack the YAML frontmatter block — prepend it.
      const raw = readFileSync(filePath, 'utf-8');
      if (!hasFrontmatter(raw)) {
        const merged = `${formatSeedFrontmatter(doc.frontmatter)}\n\n${raw.replace(/^\s+/, '')}`;
        writeFileSync(filePath, merged, 'utf-8');
      }
    }
    autoInitChecked.add(specsDir);
  } catch {
    // Best-effort — don't block loading; don't mark as checked so retry is possible
  }
}

// ============================================================================
// Extra document loading
// ============================================================================

export interface ExtraDocsResult {
  content: string;
  count: number;
}

/**
 * Load additional documents from arbitrary paths.
 *
 * Path resolution:
 *   - Starts with `knowhow/` → resolved from `.workflow/knowhow/`
 *   - Otherwise → resolved relative to projectPath
 *
 * Returns concatenated markdown content and loaded count.
 */
export function loadExtraDocs(projectPath: string, docPaths?: string[]): ExtraDocsResult {
  if (!docPaths || docPaths.length === 0) return { content: '', count: 0 };

  const sections: string[] = [];

  for (const docPath of docPaths) {
    const absPath = docPath.startsWith('knowhow/')
      ? join(projectPath, '.workflow', docPath)
      : join(projectPath, docPath);

    try {
      if (!existsSync(absPath)) continue;
      const raw = readFileSync(absPath, 'utf-8');
      const body = stripFrontmatter(raw).trim();
      if (body) {
        sections.push(body);
      }
    } catch {
      continue;
    }
  }

  return {
    content: sections.length > 0 ? sections.join('\n\n---\n\n') : '',
    count: sections.length,
  };
}

// ============================================================================
// Hit tracking — append-only JSONL log for decay analysis
// ============================================================================

function recordHit(
  projectPath: string,
  category: SpecCategory | undefined,
  keyword: string | undefined,
  matchedFiles: string[],
): void {
  try {
    const hitLog = join(projectPath, SPECS_DIR, '.hit-log.jsonl');
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      cat: category ?? null,
      kw: keyword ?? null,
      files: matchedFiles,
    });
    appendFileSync(hitLog, entry + '\n', 'utf-8');
  } catch {
    // Best-effort — never block loading
  }
}
