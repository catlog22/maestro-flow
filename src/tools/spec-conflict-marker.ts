/**
 * Spec Conflict Marker
 *
 * Mark, clear, and list conflict annotations on <spec-entry> tags.
 * Used by agents during search (mark conflicts) and by audit commands (clear conflicts).
 *
 * Conflict flow:
 *   1. Agent search → detects knowledge conflict → markConflict()
 *   2. Injection → entries with confidence="contested" show warnings, sorted last
 *   3. /manage-knowledge-audit → reviews marks → clearConflict() or setConfidence()
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseSpecEntries, generateSid, type SpecEntryParsed, type ConfidenceLevel, VALID_CONFIDENCE_LEVELS } from './spec-entry-parser.js';
import { stripFrontmatter } from '../utils/frontmatter.js';
import { computeDecayFactor } from '../graph/kg/credibility.js';

// ============================================================================
// Types
// ============================================================================

export interface ConflictMark {
  file: string;
  lineStart: number;
  title: string;
  category: string;
  confidence: ConfidenceLevel;
  conflictMarker?: string;
  conflictNote?: string;
  date: string;
}

export interface MarkConflictOptions {
  marker?: string;
  note: string;
  confidence?: ConfidenceLevel;
}

export interface MarkResult {
  success: boolean;
  error?: string;
}

// ============================================================================
// Marker ID generation
// ============================================================================

function generateMarkerId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 6);
  return `CMK-${date}-${rand}`;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Mark a spec entry as conflicted by injecting conflict attributes into its tag.
 */
export function markConflict(
  projectPath: string,
  file: string,
  lineStart: number,
  options: MarkConflictOptions,
): MarkResult {
  const specsDir = join(projectPath, '.workflow', 'specs');
  const filePath = join(specsDir, file);

  if (!existsSync(filePath)) {
    return { success: false, error: `File not found: ${file}` };
  }

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return { success: false, error: `Cannot read: ${file}` };
  }

  const lines = content.split('\n');
  const targetLineIdx = lineStart - 1;

  if (targetLineIdx < 0 || targetLineIdx >= lines.length) {
    return { success: false, error: `Line ${lineStart} out of range` };
  }

  const line = lines[targetLineIdx];
  if (!line.includes('<spec-entry')) {
    return { success: false, error: `Line ${lineStart} is not a <spec-entry> tag` };
  }

  const marker = options.marker || generateMarkerId();
  const confidence = options.confidence || 'contested';

  let updated = line;
  updated = upsertAttribute(updated, 'confidence', confidence);
  updated = upsertAttribute(updated, 'conflict-marker', marker);
  updated = upsertAttribute(updated, 'conflict-note', options.note);

  lines[targetLineIdx] = updated;
  writeFileSync(filePath, lines.join('\n'), 'utf-8');

  return { success: true };
}

/**
 * Clear conflict markers from a spec entry, optionally setting a new confidence level.
 */
export function clearConflict(
  projectPath: string,
  file: string,
  lineStart: number,
  newConfidence?: ConfidenceLevel,
): MarkResult {
  const specsDir = join(projectPath, '.workflow', 'specs');
  const filePath = join(specsDir, file);

  if (!existsSync(filePath)) {
    return { success: false, error: `File not found: ${file}` };
  }

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return { success: false, error: `Cannot read: ${file}` };
  }

  const lines = content.split('\n');
  const targetLineIdx = lineStart - 1;

  if (targetLineIdx < 0 || targetLineIdx >= lines.length) {
    return { success: false, error: `Line ${lineStart} out of range` };
  }

  let line = lines[targetLineIdx];
  if (!line.includes('<spec-entry')) {
    return { success: false, error: `Line ${lineStart} is not a <spec-entry> tag` };
  }

  line = removeAttribute(line, 'conflict-marker');
  line = removeAttribute(line, 'conflict-note');

  if (newConfidence) {
    line = upsertAttribute(line, 'confidence', newConfidence);
  } else {
    line = removeAttribute(line, 'confidence');
  }

  lines[targetLineIdx] = line;
  writeFileSync(filePath, lines.join('\n'), 'utf-8');

  return { success: true };
}

/**
 * Set confidence level on a spec entry without modifying conflict markers.
 */
export function setConfidence(
  projectPath: string,
  file: string,
  lineStart: number,
  confidence: ConfidenceLevel,
): MarkResult {
  if (!VALID_CONFIDENCE_LEVELS.includes(confidence)) {
    return { success: false, error: `Invalid confidence: ${confidence}` };
  }

  const specsDir = join(projectPath, '.workflow', 'specs');
  const filePath = join(specsDir, file);

  if (!existsSync(filePath)) {
    return { success: false, error: `File not found: ${file}` };
  }

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return { success: false, error: `Cannot read: ${file}` };
  }

  const lines = content.split('\n');
  const targetLineIdx = lineStart - 1;

  if (targetLineIdx < 0 || targetLineIdx >= lines.length) {
    return { success: false, error: `Line ${lineStart} out of range` };
  }

  let line = lines[targetLineIdx];
  if (!line.includes('<spec-entry')) {
    return { success: false, error: `Line ${lineStart} is not a <spec-entry> tag` };
  }

  line = upsertAttribute(line, 'confidence', confidence);
  lines[targetLineIdx] = line;
  writeFileSync(filePath, lines.join('\n'), 'utf-8');

  return { success: true };
}

/**
 * List all entries with conflict markers or degraded confidence across all spec files.
 */
export function listConflicts(projectPath: string): ConflictMark[] {
  const specsDir = join(projectPath, '.workflow', 'specs');
  if (!existsSync(specsDir)) return [];

  let files: string[];
  try {
    files = readdirSync(specsDir).filter(f => f.endsWith('.md'));
  } catch {
    return [];
  }

  const conflicts: ConflictMark[] = [];

  for (const file of files) {
    let raw: string;
    try {
      raw = readFileSync(join(specsDir, file), 'utf-8');
    } catch {
      continue;
    }

    const body = stripFrontmatter(raw);
    const { entries } = parseSpecEntries(body);

    for (const entry of entries) {
      if (entry.conflictMarker || entry.confidence === 'contested' || entry.confidence === 'low') {
        conflicts.push({
          file,
          lineStart: entry.lineStart,
          title: entry.title,
          category: entry.category,
          confidence: entry.confidence || 'medium',
          conflictMarker: entry.conflictMarker,
          conflictNote: entry.conflictNote,
          date: entry.date,
        });
      }
    }
  }

  return conflicts;
}

/**
 * Bulk clear all conflict markers in a spec file.
 */
export function clearAllConflicts(
  projectPath: string,
  file: string,
  newConfidence?: ConfidenceLevel,
): { cleared: number; errors: string[] } {
  const specsDir = join(projectPath, '.workflow', 'specs');
  const filePath = join(specsDir, file);

  if (!existsSync(filePath)) {
    return { cleared: 0, errors: [`File not found: ${file}`] };
  }

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return { cleared: 0, errors: [`Cannot read: ${file}`] };
  }

  const body = stripFrontmatter(content);
  const { entries } = parseSpecEntries(body);
  const marked = entries.filter(e => e.conflictMarker || e.confidence === 'contested');

  if (marked.length === 0) {
    return { cleared: 0, errors: [] };
  }

  let cleared = 0;
  const errors: string[] = [];

  for (const entry of marked.reverse()) {
    const result = clearConflict(projectPath, file, entry.lineStart, newConfidence);
    if (result.success) {
      cleared++;
    } else {
      errors.push(result.error || 'Unknown error');
    }
  }

  return { cleared, errors };
}

// ============================================================================
// Supersession — evolution chain over stable sids
// ============================================================================

export interface EvolutionLink {
  sid: string;
  file: string;
  title: string;
  status: ConfidenceLevel | 'active' | 'deprecated' | string;
  date: string;
  current: boolean;
}

/**
 * Mark the entry identified by `oldSid` as superseded by `newSid`:
 * sets `status="deprecated"` + `superseded-by="<newSid>"` on its tag line.
 *
 * Locates the entry by matching the `sid="..."` attribute directly on the
 * `<spec-entry>` opening line, so it is immune to frontmatter/line-number
 * drift (unlike the line-based conflict marker).
 */
export function supersedeEntry(
  projectPath: string,
  oldSid: string,
  newSid: string,
): MarkResult {
  const root = join(projectPath, '.workflow', 'specs');
  if (!existsSync(root)) return { success: false, error: 'No specs directory' };

  let files: string[];
  try {
    files = readdirSync(root).filter(f => f.endsWith('.md'));
  } catch {
    return { success: false, error: 'Cannot read specs directory' };
  }

  // Establish the link bidirectionally in one pass: mark the old entry
  // deprecated + superseded-by, and stamp `supersedes` onto the new entry so
  // the evolution chain (which walks `supersedes`) reconstructs correctly.
  let oldFound = false;
  for (const file of files) {
    const filePath = join(root, file);
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes('<spec-entry')) continue;
      if (line.includes(`sid="${oldSid}"`)) {
        let updated = upsertAttribute(line, 'status', 'deprecated');
        updated = upsertAttribute(updated, 'superseded-by', newSid);
        lines[i] = updated;
        oldFound = true;
        changed = true;
      } else if (line.includes(`sid="${newSid}"`)) {
        lines[i] = upsertAttribute(line, 'supersedes', oldSid);
        changed = true;
      }
    }
    if (changed) writeFileSync(filePath, lines.join('\n'), 'utf-8');
  }

  if (!oldFound) return { success: false, error: `sid not found: ${oldSid}` };
  return { success: true };
}

/**
 * Reconstruct the full evolution chain (oldest → newest) that `sid` belongs to.
 * Walks `supersedes` backward to the root and `superseded-by` forward to the
 * head. Returns an ordered list; empty when `sid` is unknown.
 */
export function getEvolutionChain(projectPath: string, sid: string): EvolutionLink[] {
  const root = join(projectPath, '.workflow', 'specs');
  if (!existsSync(root)) return [];

  let files: string[];
  try {
    files = readdirSync(root).filter(f => f.endsWith('.md'));
  } catch {
    return [];
  }

  type SidNode = { entry: SpecEntryParsed; file: string };
  const bySid = new Map<string, SidNode>();
  for (const file of files) {
    let raw: string;
    try {
      raw = readFileSync(join(root, file), 'utf-8');
    } catch {
      continue;
    }
    const { entries } = parseSpecEntries(stripFrontmatter(raw));
    for (const e of entries) {
      if (e.sid) bySid.set(e.sid, { entry: e, file });
    }
  }

  if (!bySid.has(sid)) return [];

  // Walk backward to the oldest ancestor via `supersedes`.
  let rootSid = sid;
  const guardBack = new Set<string>();
  while (true) {
    if (guardBack.has(rootSid)) break; // cycle guard
    guardBack.add(rootSid);
    const node = bySid.get(rootSid);
    const prev = node?.entry.supersedes;
    if (prev && bySid.has(prev)) rootSid = prev;
    else break;
  }

  // Forward adjacency comes from `supersedes` (declared when the newer entry is
  // created — the authoritative pointer) rather than `superseded-by` (a
  // post-hoc marker that may lag): if entry E supersedes X, X's successor is E.
  const successorOf = new Map<string, string>();
  for (const [sidKey, node] of bySid) {
    const prev = node.entry.supersedes;
    if (prev) successorOf.set(prev, sidKey);
  }

  const chain: EvolutionLink[] = [];
  const guardFwd = new Set<string>();
  let cur: string | undefined = rootSid;
  while (cur && bySid.has(cur) && !guardFwd.has(cur)) {
    guardFwd.add(cur);
    const node: SidNode = bySid.get(cur)!;
    chain.push({
      sid: cur,
      file: node.file,
      title: node.entry.title,
      status: node.entry.status ?? node.entry.confidence ?? 'active',
      date: node.entry.date,
      current: false,
    });
    cur = successorOf.get(cur);
  }
  // The chain head (newest version) is current, regardless of whether the
  // deprecated markers have been synced onto the older entries yet.
  if (chain.length > 0) chain[chain.length - 1].current = true;

  return chain;
}

// ============================================================================
// Health report — knowledge gardener observability
// ============================================================================

export interface SpecHealthReport {
  total: number;
  active: number;
  deprecated: number;
  contested: number;
  lowConfidence: number;
  withSid: number;
  withoutSid: number;
  /** Number of evolution chains with more than one version. */
  chains: number;
  /** Entries whose `supersedes` points at a sid that no longer exists. */
  danglingSupersedes: Array<{ sid: string; target: string; file: string }>;
  /** sids participating in a supersedes cycle. */
  cyclicSids: string[];
  /** Mean time-decay factor across active entries (1 = all fresh, →floor = stale). */
  avgFreshness: number;
  /** Active entries whose freshness has decayed below the 0.5 warning threshold. */
  staleActive: number;
}

/**
 * Compute a knowledge-health report over all spec entries.
 *
 * Read-only observability for the gardener: it never mutates files — low
 * freshness is *reported*, not auto-downgraded (that stays a human/audit call,
 * keeping confidence and time-decay as separate concerns).
 */
export function analyzeSpecHealth(projectPath: string, nowMs: number = Date.now()): SpecHealthReport {
  const root = join(projectPath, '.workflow', 'specs');
  const report: SpecHealthReport = {
    total: 0, active: 0, deprecated: 0, contested: 0, lowConfidence: 0,
    withSid: 0, withoutSid: 0, chains: 0,
    danglingSupersedes: [], cyclicSids: [], avgFreshness: 1, staleActive: 0,
  };
  if (!existsSync(root)) return report;

  let files: string[];
  try {
    files = readdirSync(root).filter(f => f.endsWith('.md'));
  } catch {
    return report;
  }

  const all: Array<{ entry: SpecEntryParsed; file: string }> = [];
  for (const file of files) {
    let raw: string;
    try {
      raw = readFileSync(join(root, file), 'utf-8');
    } catch {
      continue;
    }
    const { entries } = parseSpecEntries(stripFrontmatter(raw));
    for (const e of entries) all.push({ entry: e, file });
  }

  const bySid = new Map<string, SpecEntryParsed>();
  for (const { entry } of all) if (entry.sid) bySid.set(entry.sid, entry);

  let freshnessSum = 0;
  for (const { entry, file } of all) {
    report.total++;
    if (entry.sid) report.withSid++; else report.withoutSid++;
    if (entry.confidence === 'contested') report.contested++;
    if (entry.confidence === 'low') report.lowConfidence++;

    if (entry.status === 'deprecated') {
      report.deprecated++;
    } else {
      report.active++;
      const parsed = entry.date ? Date.parse(entry.date) : NaN;
      const freshness = Number.isNaN(parsed)
        ? 1
        : computeDecayFactor(Math.max(0, (nowMs - parsed) / 86_400_000), 'spec');
      freshnessSum += freshness;
      if (freshness < 0.5) report.staleActive++;
    }

    if (entry.supersedes && !bySid.has(entry.supersedes) && entry.sid) {
      report.danglingSupersedes.push({ sid: entry.sid, target: entry.supersedes, file });
    }
  }

  report.avgFreshness = report.active > 0 ? freshnessSum / report.active : 1;

  // Count chains: a chain is anchored by its oldest root — an entry that has
  // been superseded (someone points `supersedes` at it) but itself supersedes
  // nothing. Each multi-version chain has exactly one such root.
  const isSuperseded = new Set<string>();
  for (const { entry } of all) if (entry.supersedes) isSuperseded.add(entry.supersedes);
  for (const sid of bySid.keys()) {
    if (isSuperseded.has(sid) && !declaresSupersedes(bySid, sid)) report.chains++;
  }

  // Detect supersedes cycles by walking each sid's chain until it repeats.
  const cyclic = new Set<string>();
  for (const startSid of bySid.keys()) {
    const seen = new Set<string>();
    let cur: string | undefined = startSid;
    while (cur && bySid.has(cur)) {
      if (seen.has(cur)) { for (const s of seen) cyclic.add(s); break; }
      seen.add(cur);
      cur = bySid.get(cur)!.supersedes;
    }
  }
  report.cyclicSids = [...cyclic];

  return report;
}

/** True when `sid` itself declares a `supersedes` (i.e. it is not a chain root). */
function declaresSupersedes(bySid: Map<string, SpecEntryParsed>, sid: string): boolean {
  return !!bySid.get(sid)?.supersedes;
}

/**
 * Assign a stable `sid` to every `<spec-entry>` that lacks one. Legacy entries
 * predate the identity scheme; backfilling lets them join supersession chains.
 * Idempotent — entries that already carry a sid are skipped.
 */
export function backfillSids(projectPath: string, now: Date = new Date()): { updated: number } {
  const root = join(projectPath, '.workflow', 'specs');
  if (!existsSync(root)) return { updated: 0 };

  let files: string[];
  try {
    files = readdirSync(root).filter(f => f.endsWith('.md'));
  } catch {
    return { updated: 0 };
  }

  let updated = 0;
  for (const file of files) {
    const filePath = join(root, file);
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('<spec-entry') && !/\bsid="/.test(line)) {
        lines[i] = upsertAttribute(line, 'sid', generateSid(now));
        changed = true;
        updated++;
      }
    }
    if (changed) writeFileSync(filePath, lines.join('\n'), 'utf-8');
  }
  return { updated };
}

// ============================================================================
// Attribute manipulation helpers
// ============================================================================

function upsertAttribute(tagLine: string, attr: string, value: string): string {
  const escaped = value.replace(/"/g, '&quot;');
  const attrRe = new RegExp(`\\s${attr}="[^"]*"`, 'g');

  if (attrRe.test(tagLine)) {
    return tagLine.replace(attrRe, ` ${attr}="${escaped}"`);
  }

  const insertPoint = tagLine.indexOf('>');
  if (insertPoint === -1) return tagLine;
  return tagLine.slice(0, insertPoint) + ` ${attr}="${escaped}"` + tagLine.slice(insertPoint);
}

function removeAttribute(tagLine: string, attr: string): string {
  return tagLine.replace(new RegExp(`\\s*${attr}="[^"]*"`, 'g'), '');
}

// stripFrontmatter imported from utils/frontmatter.ts
