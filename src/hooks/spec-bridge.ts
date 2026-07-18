/**
 * Spec Keyword Bridge — Session-based dedup for keyword-triggered spec injection.
 *
 * Tracks which keywords and entries have already been injected in the current session
 * to prevent duplicate injection when the same keyword appears in multiple prompts.
 *
 * Bridge file: {tmpdir}/spec-kw-{sessionId}.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SPEC_KW_BRIDGE_PREFIX } from './constants.js';

// ============================================================================
// Types
// ============================================================================

export interface SpecKeywordBridge {
  session_id: string;
  injected_keywords: string[];
  injected_entries: string[];
  updated_at: number;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Read the spec keyword bridge file for a session.
 * Returns null if the file does not exist or is unreadable.
 */
export function readSpecBridge(sessionId: string): SpecKeywordBridge | null {
  const path = bridgePath(sessionId);
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as SpecKeywordBridge;
  } catch {
    return null;
  }
}

/**
 * Mark keywords and entry IDs as injected for this session.
 * Merges with existing bridge data (additive, never removes).
 */
export function markInjected(
  sessionId: string,
  keywords: string[],
  entryIds: string[],
): void {
  const existing = readSpecBridge(sessionId) ?? {
    session_id: sessionId,
    injected_keywords: [],
    injected_entries: [],
    updated_at: 0,
  };

  const kwSet = new Set(existing.injected_keywords);
  for (const kw of keywords) kwSet.add(kw.toLowerCase());

  const entrySet = new Set(existing.injected_entries);
  for (const id of entryIds) entrySet.add(id);

  const updated: SpecKeywordBridge = {
    session_id: sessionId,
    injected_keywords: [...kwSet],
    injected_entries: [...entrySet],
    updated_at: Math.floor(Date.now() / 1000),
  };

  try {
    writeFileSync(bridgePath(sessionId), JSON.stringify(updated), 'utf-8');
  } catch {
    // Best-effort — don't fail the hook if bridge write fails
  }
}

/**
 * Check if a keyword has already been injected this session.
 */
export function isKeywordInjected(sessionId: string, keyword: string): boolean {
  const bridge = readSpecBridge(sessionId);
  if (!bridge) return false;
  return bridge.injected_keywords.includes(keyword.toLowerCase());
}

/**
 * Check if an entry has already been injected this session.
 */
export function isEntryInjected(sessionId: string, entryId: string): boolean {
  const bridge = readSpecBridge(sessionId);
  if (!bridge) return false;
  return bridge.injected_entries.includes(entryId);
}

/**
 * Filter entries to only those not yet injected in this session.
 * An entry is considered "already injected" if its ID is in the bridge.
 */
export function filterUnjected<T extends { id: string }>(
  sessionId: string,
  entries: T[],
): T[] {
  const bridge = readSpecBridge(sessionId);
  if (!bridge) return entries;

  const injectedSet = new Set(bridge.injected_entries);
  return entries.filter(e => !injectedSet.has(e.id));
}

// ============================================================================
// Internal
// ============================================================================

function bridgePath(sessionId: string): string {
  return join(tmpdir(), `${SPEC_KW_BRIDGE_PREFIX}${sessionId}.json`);
}
