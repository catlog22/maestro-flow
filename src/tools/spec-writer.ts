/**
 * Spec Writer
 *
 * Append new spec entries to the appropriate category file.
 * Uses spec-entry-parser for formatting and spec-loader for directory resolution.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { formatNewEntry, parseSpecEntries } from './spec-entry-parser.js';
import { resolveSpecDir, CATEGORY_MAP, type SpecCategory, type SpecScope } from './spec-loader.js';
import { ensureSpecFile } from './spec-init.js';
import { slugify } from '../utils/frontmatter.js';

// ============================================================================
// Size guard — prevent oversized entries in spec files
// ============================================================================

/** Maximum content size (in characters) before auto-redirecting to knowhow */
export const MAX_SPEC_ENTRY_SIZE = 2048; // 2KB

// ============================================================================
// Types
// ============================================================================

export interface SpecAddResult {
  ok: boolean;
  file: string;
  category: SpecCategory;
  title: string;
  duplicate: boolean;
  /** Set to true when content exceeded MAX_SPEC_ENTRY_SIZE and was redirected to knowhow */
  redirected?: boolean;
  /** Path to the knowhow file when redirected */
  knowhowRef?: string;
  /** Auto-captured git evidence (commit hash) */
  evidence?: string;
}

// ============================================================================
// Auto-evidence: capture git HEAD as provenance
// ============================================================================

function captureGitEvidence(projectPath: string): string | undefined {
  try {
    const head = execSync('git rev-parse --short HEAD', {
      cwd: projectPath,
      timeout: 3000,
      encoding: 'utf-8',
    }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: projectPath,
      timeout: 3000,
      encoding: 'utf-8',
    }).trim();
    return `${branch}@${head}`;
  } catch {
    return undefined;
  }
}

// ============================================================================
// Reverse lookup: category -> filename
// ============================================================================

function categoryToFilename(category: SpecCategory): string | undefined {
  for (const [filename, cat] of Object.entries(CATEGORY_MAP)) {
    if (cat === category) return filename;
  }
  return undefined;
}

// ============================================================================
// Internal: knowhow redirect for oversized content
// ============================================================================

// slugify imported from utils/frontmatter.ts

/**
 * Create a knowhow file with the full content and return the relative ref path.
 * Used when spec entry content exceeds MAX_SPEC_ENTRY_SIZE.
 */
function redirectToKnowhow(
  projectPath: string,
  category: SpecCategory,
  title: string,
  content: string,
  keywords: string[],
): string {
  const knowhowDir = join(projectPath, '.workflow', 'knowhow');
  if (!existsSync(knowhowDir)) {
    mkdirSync(knowhowDir, { recursive: true });
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const slug = slugify(title).slice(0, 40);
  const filename = slug ? `DOC-${ts}-${slug}.md` : `DOC-${ts}-${pad(now.getHours())}${pad(now.getMinutes())}.md`;

  const fmLines = ['---'];
  fmLines.push(`title: ${title}`);
  fmLines.push(`type: document`);
  fmLines.push(`category: ${category}`);
  fmLines.push(`created: ${now.toISOString()}`);
  if (keywords.length > 0) {
    fmLines.push('tags:');
    for (const t of keywords) fmLines.push(`  - ${t}`);
  }
  fmLines.push('---', '', content);

  writeFileSync(join(knowhowDir, filename), fmLines.join('\n'), 'utf-8');

  return `knowhow/${filename}`;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Append a new spec entry to the appropriate file for the given category.
 *
 * - Resolves target directory via scope
 * - Creates directory and file if missing
 * - Skips duplicates (case-insensitive title match)
 * - Formats entry using `formatNewEntry` and appends to file
 * - Auto-redirects to knowhow when content exceeds MAX_SPEC_ENTRY_SIZE
 */
export function appendSpecEntry(
  projectPath: string,
  category: SpecCategory,
  title: string,
  content: string,
  keywords: string[],
  source?: string,
  scope?: SpecScope,
  uid?: string,
  description?: string,
): SpecAddResult {
  const evidence = source ?? captureGitEvidence(projectPath);

  // Size guard: redirect oversized content to knowhow
  if (content && content.length > MAX_SPEC_ENTRY_SIZE) {
    const ref = redirectToKnowhow(projectPath, category, title, content, keywords);
    const summary = content.slice(0, 200).replace(/\s+/g, ' ').trim();
    console.log('[spec] Content exceeds 2KB, stored as knowhow with spec ref');
    const result = appendSpecEntryWithRef(
      projectPath, category, title, summary, keywords, ref, evidence, scope, uid,
    );
    return { ...result, redirected: true, knowhowRef: ref, evidence };
  }

  const specsDir = resolveSpecDir(projectPath, scope ?? 'project', uid);

  const filename = categoryToFilename(category);
  if (!filename) {
    return { ok: false, file: '', category, title, duplicate: false };
  }

  // Ensure directory exists
  if (!existsSync(specsDir)) {
    mkdirSync(specsDir, { recursive: true });
  }

  const filePath = join(specsDir, filename);

  // Ensure file exists with proper YAML frontmatter; also migrates legacy
  // stubs that lack a frontmatter block.
  ensureSpecFile(specsDir, filename);

  // Read current content
  const existing = readFileSync(filePath, 'utf-8');

  // Parsed duplicate check: exact title match against parsed entries
  const { entries, legacy } = parseSpecEntries(existing);
  const isDuplicate = entries.some(
    e => e.title.toLowerCase().trim() === title.toLowerCase().trim()
  ) || legacy.some(
    e => e.title.toLowerCase().trim() === title.toLowerCase().trim()
  );
  if (isDuplicate) {
    return { ok: true, file: filePath, category, title, duplicate: true };
  }

  // Generate and append entry
  const date = new Date().toISOString().slice(0, 10);
  const entry = formatNewEntry(category, keywords, date, title, content, evidence, undefined, description);
  writeFileSync(filePath, existing + '\n\n' + entry, 'utf-8');

  return { ok: true, file: filePath, category, title, duplicate: false, evidence };
}

/**
 * Append a spec index entry that references a knowhow document.
 * The entry body is a summary, with a ref attribute pointing to the knowhow file.
 */
export function appendSpecEntryWithRef(
  projectPath: string,
  category: SpecCategory,
  title: string,
  summary: string,
  keywords: string[],
  ref: string,
  source?: string,
  scope?: SpecScope,
  uid?: string,
): SpecAddResult {
  const specsDir = resolveSpecDir(projectPath, scope ?? 'project', uid);

  const filename = categoryToFilename(category);
  if (!filename) {
    return { ok: false, file: '', category, title, duplicate: false };
  }

  if (!existsSync(specsDir)) {
    mkdirSync(specsDir, { recursive: true });
  }

  const filePath = join(specsDir, filename);

  // Ensure file exists with proper YAML frontmatter; also migrates legacy
  // stubs that lack a frontmatter block.
  ensureSpecFile(specsDir, filename);

  const existing = readFileSync(filePath, 'utf-8');

  // Parsed duplicate check: exact title match against parsed entries
  const { entries: existingEntries, legacy: existingLegacy } = parseSpecEntries(existing);
  const isDuplicateRef = existingEntries.some(
    e => e.title.toLowerCase().trim() === title.toLowerCase().trim()
  ) || existingLegacy.some(
    e => e.title.toLowerCase().trim() === title.toLowerCase().trim()
  );
  if (isDuplicateRef) {
    return { ok: true, file: filePath, category, title, duplicate: true };
  }

  const date = new Date().toISOString().slice(0, 10);
  const entry = formatNewEntry(category, keywords, date, title, summary, source, ref);
  writeFileSync(filePath, existing + '\n\n' + entry, 'utf-8');

  return { ok: true, file: filePath, category, title, duplicate: false };
}
