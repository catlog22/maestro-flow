// ---------------------------------------------------------------------------
// Loader — reads overlay files from disk and validates them.
//
// Overlay file format: JSON at `~/.maestro/overlays/<name>.json`
//
// Example:
//   {
//     "name": "cli-verify-after-execute",
//     "description": "Add CLI verification after execute",
//     "targets": ["maestro-execute", "maestro-plan"],
//     "priority": 50,
//     "enabled": true,
//     "patches": [
//       {
//         "section": "execution",
//         "mode": "append",
//         "content": "## CLI Verification\nRun `ccw cli ...`"
//       }
//     ]
//   }
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  KNOWN_SECTIONS,
  type OverlayFile,
  type OverlayMeta,
  type OverlayMode,
  type OverlayPatch,
} from './types.js';

const VALID_MODES: OverlayMode[] = ['append', 'prepend', 'replace', 'new-section'];
const NAME_RE = /^[a-z0-9][a-z0-9-_]*$/;

export class OverlayLoadError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly errors: string[],
  ) {
    super(`Overlay load error in ${filePath}:\n  - ${errors.join('\n  - ')}`);
    this.name = 'OverlayLoadError';
  }
}

export function loadOverlay(filePath: string): OverlayFile {
  const raw = readFileSync(filePath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new OverlayLoadError(filePath, [`invalid JSON: ${msg}`]);
  }

  const errors = validateOverlayMeta(parsed);
  if (errors.length > 0) {
    throw new OverlayLoadError(filePath, errors);
  }

  const meta = parsed as OverlayMeta;
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 8);

  return {
    meta,
    sourcePath: filePath,
    raw,
    hash,
  };
}

/** Returns a list of validation error strings. Empty = valid. */
export function validateOverlayMeta(input: unknown): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    return ['overlay must be a JSON object'];
  }
  const obj = input as Record<string, unknown>;

  if (typeof obj.name !== 'string' || !NAME_RE.test(obj.name)) {
    errors.push('`name` must match /^[a-z0-9][a-z0-9-_]*$/');
  }
  if (obj.description !== undefined && typeof obj.description !== 'string') {
    errors.push('`description` must be a string');
  }
  if (!Array.isArray(obj.targets) || obj.targets.length === 0) {
    errors.push('`targets` must be a non-empty string array');
  } else {
    for (const t of obj.targets) {
      if (typeof t !== 'string' || !t.trim()) {
        errors.push(`invalid target entry: ${JSON.stringify(t)}`);
      }
    }
  }
  if (obj.priority !== undefined && typeof obj.priority !== 'number') {
    errors.push('`priority` must be a number');
  }
  if (obj.enabled !== undefined && typeof obj.enabled !== 'boolean') {
    errors.push('`enabled` must be a boolean');
  }
  if (
    obj.scope !== undefined &&
    obj.scope !== 'global' &&
    obj.scope !== 'project' &&
    obj.scope !== 'any'
  ) {
    errors.push('`scope` must be one of: global | project | any');
  }
  if (
    obj.cli !== undefined &&
    obj.cli !== 'claude' &&
    obj.cli !== 'codex' &&
    obj.cli !== 'both'
  ) {
    errors.push('`cli` must be one of: claude | codex | both');
  }
  if (obj.docs !== undefined) {
    if (!Array.isArray(obj.docs)) {
      errors.push('`docs` must be a string array');
    } else {
      for (const d of obj.docs) {
        if (typeof d !== 'string') {
          errors.push(`invalid docs entry: ${JSON.stringify(d)}`);
        }
      }
    }
  }
  if (!Array.isArray(obj.patches) || obj.patches.length === 0) {
    errors.push('`patches` must be a non-empty array');
  } else {
    obj.patches.forEach((p, idx) => {
      errors.push(...validatePatch(p, idx));
    });
  }

  return errors;
}

function validatePatch(input: unknown, idx: number): string[] {
  const errs: string[] = [];
  const prefix = `patches[${idx}]`;
  if (!input || typeof input !== 'object') {
    return [`${prefix}: must be an object`];
  }
  const p = input as Record<string, unknown>;
  if (typeof p.section !== 'string' || !p.section.trim()) {
    errs.push(`${prefix}.section must be a non-empty string`);
  }
  if (typeof p.mode !== 'string' || !VALID_MODES.includes(p.mode as OverlayMode)) {
    errs.push(`${prefix}.mode must be one of: ${VALID_MODES.join(' | ')}`);
  }
  if (typeof p.content !== 'string') {
    errs.push(`${prefix}.content must be a string`);
  }
  if (p.mode === 'new-section') {
    if (p.afterSection !== undefined && typeof p.afterSection !== 'string') {
      errs.push(`${prefix}.afterSection must be a string if provided`);
    }
  } else if (typeof p.section === 'string') {
    // For existing-section modes, the section should be a known tag.
    if (!(KNOWN_SECTIONS as readonly string[]).includes(p.section)) {
      errs.push(
        `${prefix}.section "${p.section}" is not a known section (${KNOWN_SECTIONS.join(', ')})`,
      );
    }
  }
  return errs;
}

export interface LoadAllResult {
  overlays: OverlayFile[];
  errors: { path: string; errors: string[] }[];
}

/**
 * Load all valid top-level overlay JSON files from `dir`.
 * Ignores subdirectories (docs/, _shipped/ etc), files starting with `_`,
 * and non-.json files. Returns both successful overlays and collected errors
 * so callers can report them without throwing.
 *
 * Sorted by (priority ?? 50) asc, then name asc.
 */
export function loadAllOverlays(dir: string): LoadAllResult {
  const result: LoadAllResult = { overlays: [], errors: [] };
  if (!existsSync(dir)) return result;

  const seenNames = new Set<string>();

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.json')) continue;
    if (entry.name.startsWith('_')) continue;
    const fp = join(dir, entry.name);
    try {
      const overlay = loadOverlay(fp);
      if (seenNames.has(overlay.meta.name)) {
        result.errors.push({
          path: fp,
          errors: [`duplicate overlay name: ${overlay.meta.name}`],
        });
        continue;
      }
      seenNames.add(overlay.meta.name);
      result.overlays.push(overlay);
    } catch (err) {
      if (err instanceof OverlayLoadError) {
        result.errors.push({ path: err.filePath, errors: err.errors });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push({ path: fp, errors: [msg] });
      }
    }
  }

  result.overlays.sort((a, b) => {
    const pa = a.meta.priority ?? 50;
    const pb = b.meta.priority ?? 50;
    if (pa !== pb) return pa - pb;
    return a.meta.name.localeCompare(b.meta.name);
  });

  return result;
}
