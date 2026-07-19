/**
 * Spec Validator Guard — PreToolUse: Write
 *
 * Validates that spec file entries use the <spec-entry> closed-tag format.
 * Pure evaluation function — no I/O, follows workflow-guard.ts pattern.
 *
 * Only activates when the file path targets .workflow/specs/.
 */

import { parseSpecEntries, validateSpecEntry, validateCategoryMatch, VALID_CATEGORIES } from '../../tools/spec-entry-parser.js';
import { CATEGORY_MAP } from '../../tools/spec-loader.js';
import { basename } from 'node:path';

// ============================================================================
// Types
// ============================================================================

export interface SpecValidatorResult {
  valid: boolean;
  mode: 'warn' | 'block';
  errors: Array<{ line: number; message: string }>;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Evaluate spec file content for format compliance.
 *
 * @param filePath  Absolute or relative file path being written
 * @param content   The full file content after the write/edit
 * @param mode      'warn' (advisory) or 'block' (reject write)
 */
export function evaluateSpecValidator(
  filePath: string,
  content: string,
  mode: 'warn' | 'block' = 'warn',
): SpecValidatorResult {
  // Only validate files in .workflow/specs/
  if (!isSpecFile(filePath)) {
    return { valid: true, mode, errors: [] };
  }

  const errors: Array<{ line: number; message: string }> = [];

  // Determine expected category from filename
  const fileName = basename(filePath);
  const expectedCategory = CATEGORY_MAP[fileName];

  // Parse entries
  const result = parseSpecEntries(content);

  // Collect parser-level errors
  errors.push(...result.errors);

  // Validate category match per entry
  if (expectedCategory) {
    for (const entry of result.entries) {
      const mismatch = validateCategoryMatch(entry, expectedCategory);
      if (mismatch) {
        errors.push({ line: entry.lineStart, message: mismatch });
      }
    }
  }

  // Check for unclosed tags
  const openCount = (content.match(/<spec-entry\b/g) || []).length;
  const closeCount = (content.match(/<\/spec-entry>/g) || []).length;
  if (openCount !== closeCount) {
    errors.push({
      line: 1,
      message: `Unbalanced tags: ${openCount} opening <spec-entry> vs ${closeCount} closing </spec-entry>`,
    });
  }

  return {
    valid: errors.length === 0,
    mode,
    errors,
  };
}

// ============================================================================
// Internal
// ============================================================================

function isSpecFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.includes('.workflow/specs/') && normalized.endsWith('.md');
}
