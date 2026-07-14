// ---------------------------------------------------------------------------
// Status checker — validates ralph session for structural + reference
// consistency. Delegates to cmd-check.ts checkSession().
//
// This module is kept for backward compatibility with callers that import
// checkStatus/summarize. The actual logic now lives in cmd-check.ts.
// ---------------------------------------------------------------------------

import type { CheckFinding } from './cmd-check.js';

export type { CheckFinding };

export function summarize(findings: CheckFinding[]): { errors: number; warnings: number } {
  return {
    errors: findings.filter(f => f.level === 'E').length,
    warnings: findings.filter(f => f.level === 'W').length,
  };
}
