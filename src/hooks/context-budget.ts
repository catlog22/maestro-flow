/**
 * Context Budget Manager
 *
 * Determines how much spec content to inject based on remaining context %.
 * Reads bridge metrics written by the statusline hook.
 *
 * Budget tiers:
 *   > 50% remaining  → full    (inject all specs)
 *   35–50%           → reduced (markdown-aware truncation)
 *   25–35%           → minimal (headings only + learnings)
 *   < 25%            → skip    (context is critical)
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BRIDGE_PREFIX, STALE_SECONDS } from './constants.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BudgetAction = 'full' | 'reduced' | 'minimal' | 'skip';

export interface BudgetResult {
  action: BudgetAction;
  content?: string;
  reason?: string;
}

interface BridgeMetrics {
  remaining_percentage: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const FULL_THRESHOLD = 50;
const REDUCED_THRESHOLD = 35;
const MINIMAL_THRESHOLD = 25;

/** Default max chars for reduced-tier truncation */
const DEFAULT_MAX_CHARS = 4096;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decide how much spec content to inject given current context budget.
 * If no bridge metrics are available, defaults to 'full' (be generous).
 */
export function evaluateContextBudget(
  specContent: string,
  sessionId?: string,
): BudgetResult {
  if (!specContent) return { action: 'skip', reason: 'no content' };

  const remaining = readRemainingPct(sessionId);

  // No metrics → assume plenty of context
  if (remaining === null) {
    return { action: 'full', content: specContent };
  }

  if (remaining > FULL_THRESHOLD) {
    return { action: 'full', content: specContent };
  }

  if (remaining > REDUCED_THRESHOLD) {
    // wrapper-aware：truncation 必须保留 <maestro-context> 开闭标签，否则裸正文泄漏进对话
    const { open, body } = unwrapMaestroContext(specContent);
    return {
      action: 'reduced',
      content: rewrapMaestroContext(open, truncateMarkdown(body, DEFAULT_MAX_CHARS)),
      reason: `Context at ${100 - remaining}% used — specs truncated`,
    };
  }

  if (remaining > MINIMAL_THRESHOLD) {
    const { open, body } = unwrapMaestroContext(specContent);
    return {
      action: 'minimal',
      content: rewrapMaestroContext(open, extractHeadingsOnly(body)),
      reason: `Context at ${100 - remaining}% used — headings only`,
    };
  }

  return {
    action: 'skip',
    reason: `Context at ${100 - remaining}% used — spec injection skipped`,
  };
}

// ---------------------------------------------------------------------------
// Bridge reader
// ---------------------------------------------------------------------------

const WRAPPER_OPEN_RE = /^<maestro-context[^>]*>\n?/;
const WRAPPER_CLOSE_RE = /\n?<\/maestro-context>\s*$/;

/** 剥离 <maestro-context> 包裹；无包裹时 open 为 ''。 */
function unwrapMaestroContext(content: string): { open: string; body: string } {
  const openMatch = content.match(WRAPPER_OPEN_RE);
  const open = openMatch ? openMatch[0] : '';
  const body = (open ? content.slice(open.length) : content).replace(WRAPPER_CLOSE_RE, '');
  return { open, body };
}

/** 还原包裹；无 open（输入本就没有包裹）时原样返回。 */
function rewrapMaestroContext(open: string, body: string): string {
  if (!open) return body;
  return `${open.trimEnd()}\n${body}\n</maestro-context>`;
}

function readRemainingPct(sessionId?: string): number | null {
  if (!sessionId) return null;
  const metricsPath = join(tmpdir(), `${BRIDGE_PREFIX}${sessionId}.json`);
  if (!existsSync(metricsPath)) return null;

  try {
    const metrics: BridgeMetrics = JSON.parse(readFileSync(metricsPath, 'utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (metrics.timestamp && (now - metrics.timestamp) > STALE_SECONDS) return null;
    return metrics.remaining_percentage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Markdown truncation (reduced tier)
// ---------------------------------------------------------------------------

/**
 * Markdown-aware truncation: preserve headings + first paragraph per section.
 * Inserts "[... N lines omitted]" for collapsed sections.
 */
export function truncateMarkdown(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;

  const lines = content.split('\n');
  const result: string[] = [];
  let currentLen = 0;
  let inFirstParagraph = false;
  let skippedLines = 0;

  for (const line of lines) {
    const isHeading = /^#{1,6}\s/.test(line);
    const isSeparator = /^---\s*$/.test(line);
    const isEmpty = line.trim() === '';

    if (isHeading || isSeparator) {
      // Flush skipped count
      if (skippedLines > 0) {
        result.push(`[... ${skippedLines} lines omitted]`);
        skippedLines = 0;
      }
      result.push(line);
      currentLen += line.length + 1;
      inFirstParagraph = true;
      continue;
    }

    if (inFirstParagraph && !isEmpty) {
      result.push(line);
      currentLen += line.length + 1;
      if (currentLen > maxChars) break;
      continue;
    }

    if (isEmpty && inFirstParagraph) {
      inFirstParagraph = false;
      result.push('');
      continue;
    }

    // Beyond first paragraph — skip
    skippedLines++;
  }

  if (skippedLines > 0) {
    result.push(`[... ${skippedLines} lines omitted]`);
  }

  return result.join('\n');
}

// ---------------------------------------------------------------------------
// Headings-only extraction (minimal tier)
// ---------------------------------------------------------------------------

function extractHeadingsOnly(content: string): string {
  const lines = content.split('\n');
  const headings = lines.filter(l => /^#{1,6}\s/.test(l));
  if (headings.length === 0) return '[Specs available but omitted — context is low]';
  return '# Project Specs (headings only — context limited)\n\n' + headings.join('\n');
}
