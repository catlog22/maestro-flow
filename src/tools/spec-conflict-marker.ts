/**
 * Spec Conflict Marker
 *
 * Mark, clear, and list conflict annotations on <spec-entry> tags.
 * Used by agents during search (mark conflicts) and by audit commands (clear conflicts).
 *
 * Conflict flow:
 *   1. Agent search → detects knowledge conflict → markConflict()
 *   2. Injection → entries with confidence="contested" show warnings, sorted last
 *   3. /maestro-manage knowledge audit → reviews marks → clearConflict() or setConfidence()
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseSpecEntries, generateSid, type SpecEntryParsed, type ConfidenceLevel, VALID_CONFIDENCE_LEVELS } from './spec-entry-parser.js';
import { TEAM_SPECS_DIR } from './spec-loader.js';
import { stripFrontmatter } from '../utils/frontmatter.js';
import { computeDecayFactor } from '../graph/kg/credibility.js';
import { updateFileAtomic } from '../utils/atomic-write.js';

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

/** Update one structured entry while holding the file's cross-process lock. */
function updateEntryLineAtomic(
  filePath: string,
  fileLabel: string,
  lineStart: number,
  edit: (line: string) => string,
): MarkResult {
  let validationError: string | undefined;
  try {
    updateFileAtomic(filePath, current => {
      if (current === null) {
        validationError = `File not found: ${fileLabel}`;
        return null;
      }

      const lines = current.split('\n');
      const targetLineIdx = lineStart - 1;
      if (targetLineIdx < 0 || targetLineIdx >= lines.length) {
        validationError = `Line ${lineStart} out of range`;
        return null;
      }
      if (!lines[targetLineIdx].includes('<spec-entry')) {
        validationError = `Line ${lineStart} is not a <spec-entry> tag`;
        return null;
      }

      lines[targetLineIdx] = edit(lines[targetLineIdx]);
      return lines.join('\n');
    });
  } catch (error) {
    return { success: false, error: `Cannot update ${fileLabel}: ${(error as Error).message}` };
  }
  return validationError ? { success: false, error: validationError } : { success: true };
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
// Scope directories
// ============================================================================

/**
 * All spec scope directories that may hold entries: project baseline, global
 * (~/.maestro/specs), team shared, and personal ({uid} subdirectories).
 * Only existing directories are returned. sid-based functions (supersede,
 * history, health, backfill) iterate these so global/team/personal entries
 * participate in the lifecycle; file+line based functions stay project-scoped
 * because their callers pass paths relative to `.workflow/specs/`.
 */
export function specDirs(projectPath: string): string[] {
  const teamDir = join(projectPath, TEAM_SPECS_DIR);
  const dirs = [
    join(projectPath, '.workflow', 'specs'),
    join(process.env.MAESTRO_HOME ?? join(homedir(), '.maestro'), 'specs'),
    teamDir,
  ];
  if (existsSync(teamDir)) {
    try {
      for (const d of readdirSync(teamDir, { withFileTypes: true })) {
        if (d.isDirectory()) dirs.push(join(teamDir, d.name));
      }
    } catch { /* unreadable team dir — personal layers skipped */ }
  }
  return dirs.filter(d => existsSync(d));
}

/** Markdown spec files in a directory; empty when unreadable. */
function listSpecFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter(f => f.endsWith('.md'));
  } catch {
    return [];
  }
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

  const marker = options.marker || generateMarkerId();
  const confidence = options.confidence || 'contested';
  return updateEntryLineAtomic(filePath, file, lineStart, line => {
    let updated = upsertAttribute(line, 'confidence', confidence);
    updated = upsertAttribute(updated, 'conflict-marker', marker);
    updated = upsertAttribute(updated, 'conflict-note', options.note);
    return upsertAttribute(updated, 'conflict-date', new Date().toISOString().slice(0, 10));
  });
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

  return updateEntryLineAtomic(filePath, file, lineStart, original => {
    let line = removeAttribute(original, 'conflict-marker');
    line = removeAttribute(line, 'conflict-note');
    line = removeAttribute(line, 'conflict-date');
    return newConfidence
      ? upsertAttribute(line, 'confidence', newConfidence)
      : removeAttribute(line, 'confidence');
  });
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

  return updateEntryLineAtomic(
    filePath,
    file,
    lineStart,
    line => upsertAttribute(line, 'confidence', confidence),
  );
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

    // Parse RAW content so lineStart matches markConflict/clearConflict, which
    // index raw file lines (the parser ignores non-tag text like frontmatter).
    const { entries } = parseSpecEntries(raw);

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
          date: entry.conflictDate || entry.date,
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

  // Parse RAW content so entry.lineStart lines up with clearConflict's raw
  // line indexing (frontmatter must not shift the reported line numbers).
  const { entries } = parseSpecEntries(content);
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
  /** True on a deprecated chain head — its successor no longer exists (broken chain). */
  broken?: boolean;
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
  if (oldSid === newSid) {
    return { success: false, error: `Cannot supersede a sid with itself: ${oldSid}` };
  }

  const dirs = specDirs(projectPath);
  if (dirs.length === 0) return { success: false, error: 'No specs directory' };

  // Establish the link bidirectionally in one pass: mark the old entry
  // deprecated + superseded-by, and stamp `supersedes` onto the new entry so
  // the evolution chain (which walks `supersedes`) reconstructs correctly.
  // Writes are deferred until validation passes, so guard failures never
  // leave a half-written link.
  let oldFound = false;
  let newFound = false;
  const pendingWrites: Array<{
    filePath: string;
    original: string;
    content: string;
    updatesOld: boolean;
  }> = [];
  for (const dir of dirs) {
    for (const file of listSpecFiles(dir)) {
      const filePath = join(dir, file);
      let content: string;
      try {
        content = readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }
      const lines = content.split('\n');
      let changed = false;
      let updatesOld = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes('<spec-entry')) continue;
        if (line.includes(`sid="${oldSid}"`)) {
          const existingBy = readAttribute(line, 'superseded-by');
          if (existingBy && existingBy !== newSid) {
            return {
              success: false,
              error: `${oldSid} is already superseded by ${existingBy} — run 'maestro spec history ${oldSid}' to inspect the chain`,
            };
          }
          let updated = upsertAttribute(line, 'status', 'deprecated');
          updated = upsertAttribute(updated, 'superseded-by', newSid);
          lines[i] = updated;
          oldFound = true;
          updatesOld = true;
          changed = true;
        } else if (line.includes(`sid="${newSid}"`)) {
          // Comma-append (deduped) so merging several old entries into one
          // new entry keeps every earlier `supersedes` link intact.
          const merged = [...new Set([...splitSids(readAttribute(line, 'supersedes')), oldSid])].join(',');
          lines[i] = upsertAttribute(line, 'supersedes', merged);
          newFound = true;
          changed = true;
        }
      }
      if (changed) {
        pendingWrites.push({ filePath, original: content, content: lines.join('\n'), updatesOld });
      }
    }
  }

  if (!oldFound) return { success: false, error: `sid not found: ${oldSid}` };
  if (!newFound) return { success: false, error: `sid not found: ${newSid}` };

  // Write the successor side first. If a later cross-file update fails, the
  // old rule stays active instead of disappearing from default search/load.
  pendingWrites.sort((a, b) => Number(a.updatesOld) - Number(b.updatesOld));
  for (const w of pendingWrites) {
    try {
      updateFileAtomic(w.filePath, current => {
        if (current !== w.original) {
          throw new Error(`Concurrent modification detected: ${w.filePath}`);
        }
        return w.content;
      });
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
  return { success: true };
}

/**
 * Reconstruct the full evolution chain (oldest → newest) that `sid` belongs to.
 * Walks `supersedes` backward to the root and `superseded-by` forward to the
 * head. Returns an ordered list; empty when `sid` is unknown.
 */
export function getEvolutionChain(projectPath: string, sid: string): EvolutionLink[] {
  type SidNode = { entry: SpecEntryParsed; file: string };
  const bySid = new Map<string, SidNode>();
  for (const dir of specDirs(projectPath)) {
    for (const file of listSpecFiles(dir)) {
      let raw: string;
      try {
        raw = readFileSync(join(dir, file), 'utf-8');
      } catch {
        continue;
      }
      const { entries } = parseSpecEntries(stripFrontmatter(raw));
      for (const e of entries) {
        if (e.sid) bySid.set(e.sid, { entry: e, file });
      }
    }
  }

  if (!bySid.has(sid)) return [];

  // Walk backward to the oldest ancestor via `supersedes` (first existing
  // parent when an entry merges several).
  let rootSid = sid;
  const guardBack = new Set<string>();
  while (true) {
    if (guardBack.has(rootSid)) break; // cycle guard
    guardBack.add(rootSid);
    const node = bySid.get(rootSid);
    const prev = splitSids(node?.entry.supersedes).find(p => bySid.has(p));
    if (prev) rootSid = prev;
    else break;
  }

  // Forward adjacency comes from `supersedes` (declared when the newer entry is
  // created — the authoritative pointer) rather than `superseded-by` (a
  // post-hoc marker that may lag): if entry E supersedes X, X's successor is E.
  const successorOf = new Map<string, string>();
  for (const [sidKey, node] of bySid) {
    for (const prev of splitSids(node.entry.supersedes)) successorOf.set(prev, sidKey);
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
  // deprecated markers have been synced onto the older entries yet — unless
  // the head itself is deprecated (its successor was deleted): a deprecated
  // entry must never be presented as current, so flag the chain as broken.
  if (chain.length > 0) {
    const tail = chain[chain.length - 1];
    if (tail.status === 'deprecated') tail.broken = true;
    else tail.current = true;
  }

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
  /** Entries whose `superseded-by` points at a sid that no longer exists (successor deleted). */
  danglingSupersededBy: Array<{ sid: string; target: string; file: string }>;
  /** sids participating in a supersedes cycle. */
  cyclicSids: string[];
  /** Contested entries whose conflict-date is older than 30 days (entries without conflict-date are skipped). */
  contestedStale: number;
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
  const report: SpecHealthReport = {
    total: 0, active: 0, deprecated: 0, contested: 0, lowConfidence: 0,
    withSid: 0, withoutSid: 0, chains: 0,
    danglingSupersedes: [], danglingSupersededBy: [], cyclicSids: [],
    avgFreshness: 1, staleActive: 0, contestedStale: 0,
  };

  const all: Array<{ entry: SpecEntryParsed; file: string }> = [];
  for (const dir of specDirs(projectPath)) {
    for (const file of listSpecFiles(dir)) {
      let raw: string;
      try {
        raw = readFileSync(join(dir, file), 'utf-8');
      } catch {
        continue;
      }
      const { entries } = parseSpecEntries(stripFrontmatter(raw));
      for (const e of entries) all.push({ entry: e, file });
    }
  }

  const bySid = new Map<string, SpecEntryParsed>();
  for (const { entry } of all) if (entry.sid) bySid.set(entry.sid, entry);

  let freshnessSum = 0;
  for (const { entry, file } of all) {
    report.total++;
    if (entry.sid) report.withSid++; else report.withoutSid++;
    if (entry.confidence === 'contested') {
      report.contested++;
      const marked = entry.conflictDate ? Date.parse(entry.conflictDate) : NaN;
      if (!Number.isNaN(marked) && nowMs - marked > 30 * 86_400_000) report.contestedStale++;
    }
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

    if (entry.sid) {
      for (const target of splitSids(entry.supersedes)) {
        if (!bySid.has(target)) report.danglingSupersedes.push({ sid: entry.sid, target, file });
      }
      if (entry.supersededBy && !bySid.has(entry.supersededBy)) {
        report.danglingSupersededBy.push({ sid: entry.sid, target: entry.supersededBy, file });
      }
    }
  }

  report.avgFreshness = report.active > 0 ? freshnessSum / report.active : 1;

  // Count chains: a chain is anchored by its oldest root — an entry that has
  // been superseded (someone points `supersedes` at it) but itself supersedes
  // nothing. Each multi-version chain has exactly one such root.
  const isSuperseded = new Set<string>();
  for (const { entry } of all) for (const s of splitSids(entry.supersedes)) isSuperseded.add(s);
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
      cur = splitSids(bySid.get(cur)!.supersedes)[0];
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
  let updated = 0;
  for (const dir of specDirs(projectPath)) {
    for (const file of listSpecFiles(dir)) {
      const filePath = join(dir, file);
      updateFileAtomic(filePath, current => {
        if (current === null) return null;
        const lines = current.split('\n');
        let changed = false;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes('<spec-entry') && !/\bsid="/.test(line)) {
            lines[i] = upsertAttribute(line, 'sid', generateSid(now));
            changed = true;
            updated++;
          }
        }
        return changed ? lines.join('\n') : current;
      });
    }
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

function readAttribute(tagLine: string, attr: string): string | undefined {
  const m = tagLine.match(new RegExp(`\\s${attr}="([^"]*)"`));
  return m ? m[1] : undefined;
}

/** Split a comma-separated `supersedes` value into trimmed sids. */
function splitSids(value: string | undefined): string[] {
  return value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
}

// stripFrontmatter imported from utils/frontmatter.ts
