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
import { parseSpecEntries, type SpecEntryParsed, type ConfidenceLevel, VALID_CONFIDENCE_LEVELS } from './spec-entry-parser.js';
import { stripFrontmatter } from '../utils/frontmatter.js';

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
