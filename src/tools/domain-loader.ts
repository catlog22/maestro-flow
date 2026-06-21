/**
 * Domain Loader — CRUD for .workflow/domain/glossary.json
 *
 * Provides read/write operations with file locking, auto-backup, mtime cache,
 * and schema validation. All write operations go through GlossaryLock.
 */

import {
  readFileSync, writeFileSync, existsSync, mkdirSync,
  copyFileSync, readdirSync, unlinkSync, statSync,
} from 'node:fs';
import { join } from 'node:path';
import { validateGlossary, validateRelationships, type ValidationError, type ValidationWarning } from './domain-schema.js';

// ============================================================================
// Types
// ============================================================================

export interface DomainTerm {
  id: string;
  canonical: string;
  aliases: string[];
  definition: string;
  relationships: string[];
  keywords: string[];
  concept_ref?: string;
  rewrite_hints?: Record<string, string>;
  tier?: 'core' | 'extended' | 'peripheral';
  status?: 'active' | 'deprecated';
  deprecated_info?: {
    reason: string;
    successor_id?: string;
    deprecated_at: string;
  };
  source: {
    kind: 'discover' | 'finish-work' | 'manual' | 'import';
    session?: string;
    registered_at: string;
  };
}

export interface DomainGlossary {
  $schema: string;
  project?: string;
  terms: DomainTerm[];
}

export interface GlossaryLoadResult {
  exists: boolean;
  glossary: DomainGlossary | null;
  activeTerms: DomainTerm[];
  isEmpty: boolean;
}

// ============================================================================
// Paths
// ============================================================================

function glossaryPath(workflowRoot: string): string {
  return join(workflowRoot, 'domain', 'glossary.json');
}

function domainDir(workflowRoot: string): string {
  return join(workflowRoot, 'domain');
}

// ============================================================================
// File lock (cross-process)
// ============================================================================

const STALE_TIMEOUT_MS = 30_000;

export class GlossaryLock {
  private lockPath: string;
  private held = false;

  constructor(workflowRoot: string) {
    this.lockPath = join(workflowRoot, 'domain', '.glossary.lock');
  }

  acquire(): void {
    try {
      writeFileSync(this.lockPath, String(process.pid), { flag: 'wx' });
      this.held = true;
      return;
    } catch {
      // EEXIST — lock file exists, check if stale
    }
    try {
      const content = readFileSync(this.lockPath, 'utf-8').trim();
      const pid = parseInt(content, 10);
      const lockAge = Date.now() - statSync(this.lockPath).mtimeMs;
      if (lockAge < STALE_TIMEOUT_MS && !isNaN(pid) && isProcessAlive(pid)) {
        throw new Error(`glossary.json locked by PID ${pid}. Delete ${this.lockPath} if stale.`);
      }
    } catch (e) {
      if ((e as Error).message.includes('locked by PID')) throw e;
    }
    try { unlinkSync(this.lockPath); } catch { /* already gone */ }
    try {
      writeFileSync(this.lockPath, String(process.pid), { flag: 'wx' });
      this.held = true;
    } catch {
      throw new Error(`Cannot acquire glossary lock: ${this.lockPath}`);
    }
  }

  release(): void {
    if (!this.held) return;
    try {
      const content = readFileSync(this.lockPath, 'utf-8').trim();
      if (parseInt(content, 10) === process.pid) unlinkSync(this.lockPath);
    } catch { /* already gone */ }
    this.held = false;
  }

  withLock<T>(fn: () => T): T {
    this.acquire();
    try { return fn(); } finally { this.release(); }
  }
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// ============================================================================
// Backup
// ============================================================================

const MAX_BACKUPS = 10;

function backupGlossary(workflowRoot: string): void {
  const gPath = glossaryPath(workflowRoot);
  if (!existsSync(gPath)) return;
  const backupDir = join(workflowRoot, 'domain', '.backups');
  mkdirSync(backupDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:\-T]/g, '').replace(/\..+/, '');
  copyFileSync(gPath, join(backupDir, `glossary-${ts}.json`));
  const backups = readdirSync(backupDir)
    .filter(f => f.startsWith('glossary-') && f.endsWith('.json'))
    .sort().reverse();
  for (const old of backups.slice(MAX_BACKUPS)) {
    try { unlinkSync(join(backupDir, old)); } catch { /* ignore */ }
  }
}

// ============================================================================
// Read (with cache)
// ============================================================================

const _glossaryCache = new Map<string, { mtime: number; size: number; data: DomainGlossary }>();
const CACHE_MAX_ENTRIES = 10;

export function readGlossary(workflowRoot: string): DomainGlossary {
  const gPath = glossaryPath(workflowRoot);
  if (!existsSync(gPath)) return { $schema: 'domain/1.0', terms: [] };
  const raw = readFileSync(gPath, 'utf-8');
  let data: unknown;
  try { data = JSON.parse(raw); } catch (e) {
    throw new Error(`glossary.json invalid JSON: ${(e as Error).message}. Check file or restore from .backups/`);
  }
  const errors = validateGlossary(data);
  if (errors.length > 0) {
    const msg = errors.slice(0, 5).map(e => `${e.path}: ${e.message}`).join('; ');
    throw new Error(`glossary.json validation failed: ${msg}`);
  }
  return data as DomainGlossary;
}

export function readGlossaryCached(workflowRoot: string): DomainGlossary {
  const gPath = glossaryPath(workflowRoot);
  if (!existsSync(gPath)) return { $schema: 'domain/1.0', terms: [] };
  const st = statSync(gPath);
  const cached = _glossaryCache.get(gPath);
  if (cached && cached.mtime === st.mtimeMs && cached.size === st.size) return cached.data;
  const data = readGlossary(workflowRoot);
  if (_glossaryCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = _glossaryCache.keys().next().value;
    if (oldest) _glossaryCache.delete(oldest);
  }
  _glossaryCache.set(gPath, { mtime: st.mtimeMs, size: st.size, data });
  return data;
}

function clearCache(): void {
  _glossaryCache.clear();
}

// ============================================================================
// Write (with lock + backup)
// ============================================================================

function writeGlossary(workflowRoot: string, glossary: DomainGlossary): void {
  const gPath = glossaryPath(workflowRoot);
  mkdirSync(domainDir(workflowRoot), { recursive: true });
  backupGlossary(workflowRoot);
  writeFileSync(gPath, JSON.stringify(glossary, null, 2) + '\n', 'utf-8');
  clearCache();
}

// ============================================================================
// Safe load (for consumers that need empty-glossary safety)
// ============================================================================

export function loadGlossary(projectPath: string): GlossaryLoadResult {
  const wRoot = join(projectPath, '.workflow');
  const gPath = glossaryPath(wRoot);
  if (!existsSync(gPath))
    return { exists: false, glossary: null, activeTerms: [], isEmpty: true };
  try {
    const glossary = readGlossaryCached(wRoot);
    if (!Array.isArray(glossary.terms))
      return { exists: true, glossary, activeTerms: [], isEmpty: true };
    const activeTerms = glossary.terms.filter(t => (t.status ?? 'active') === 'active');
    return { exists: true, glossary, activeTerms, isEmpty: glossary.terms.length === 0 };
  } catch {
    return { exists: true, glossary: null, activeTerms: [], isEmpty: true };
  }
}

// ============================================================================
// CRUD operations (all locked)
// ============================================================================

export function initDomain(workflowRoot: string, project?: string): string {
  const dir = domainDir(workflowRoot);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'concepts'), { recursive: true });
  const gPath = glossaryPath(workflowRoot);
  if (!existsSync(gPath)) {
    const glossary: DomainGlossary = {
      $schema: 'domain/1.0',
      ...(project ? { project } : {}),
      terms: [],
    };
    writeFileSync(gPath, JSON.stringify(glossary, null, 2) + '\n', 'utf-8');
  }
  return gPath;
}

export function addTerm(workflowRoot: string, term: DomainTerm): void {
  const lock = new GlossaryLock(workflowRoot);
  lock.withLock(() => {
    const glossary = readGlossary(workflowRoot);
    if (glossary.terms.some(t => t.id === term.id)) {
      throw new Error(`Term "${term.id}" already exists. Use updateTerm instead.`);
    }
    glossary.terms.push(term);
    writeGlossary(workflowRoot, glossary);
  });
}

export function updateTerm(
  workflowRoot: string,
  termId: string,
  updates: Partial<Omit<DomainTerm, 'id'>>,
): void {
  const lock = new GlossaryLock(workflowRoot);
  lock.withLock(() => {
    const glossary = readGlossary(workflowRoot);
    const idx = glossary.terms.findIndex(t => t.id === termId);
    if (idx === -1) throw new Error(`Term "${termId}" not found`);
    glossary.terms[idx] = { ...glossary.terms[idx], ...updates };
    writeGlossary(workflowRoot, glossary);
  });
}

export function removeTerm(workflowRoot: string, termId: string): { warnings: string[] } {
  const warnings: string[] = [];
  const lock = new GlossaryLock(workflowRoot);
  lock.withLock(() => {
    const glossary = readGlossary(workflowRoot);
    const idx = glossary.terms.findIndex(t => t.id === termId);
    if (idx === -1) throw new Error(`Term "${termId}" not found`);

    // Check for dangling spec references
    const danglingRefs = checkDanglingSpecRefs(workflowRoot, termId);
    if (danglingRefs.length > 0) {
      warnings.push(
        `${danglingRefs.length} spec entries reference domain="${termId}":\n` +
        danglingRefs.map(r => `  - ${r}`).join('\n'),
      );
    }

    // Check for relationship references from other terms
    const referencedBy = glossary.terms.filter(
      t => t.id !== termId && t.relationships?.includes(termId),
    );
    if (referencedBy.length > 0) {
      warnings.push(
        `${referencedBy.length} terms reference "${termId}" in relationships: ` +
        referencedBy.map(t => t.id).join(', '),
      );
    }

    glossary.terms.splice(idx, 1);
    writeGlossary(workflowRoot, glossary);
  });
  return { warnings };
}

export function deprecateTerm(
  workflowRoot: string,
  termId: string,
  reason: string,
  successorId?: string,
): void {
  updateTerm(workflowRoot, termId, {
    status: 'deprecated',
    deprecated_info: {
      reason,
      ...(successorId ? { successor_id: successorId } : {}),
      deprecated_at: new Date().toISOString(),
    },
  });
}

// ============================================================================
// Validation helpers
// ============================================================================

export function validateGlossaryFile(workflowRoot: string): {
  errors: ValidationError[];
  warnings: ValidationWarning[];
} {
  const gPath = glossaryPath(workflowRoot);
  if (!existsSync(gPath)) return { errors: [{ path: '$', message: 'glossary.json not found' }], warnings: [] };
  let data: unknown;
  try { data = JSON.parse(readFileSync(gPath, 'utf-8')); } catch (e) {
    return { errors: [{ path: '$', message: `invalid JSON: ${(e as Error).message}` }], warnings: [] };
  }
  const errors = validateGlossary(data);
  const terms = (data as Record<string, unknown>).terms;
  const warnings = Array.isArray(terms)
    ? validateRelationships(terms as Array<{ id: string; relationships?: string[] }>)
    : [];
  return { errors, warnings };
}

// ============================================================================
// Dangling spec reference check
// ============================================================================

function checkDanglingSpecRefs(workflowRoot: string, termId: string): string[] {
  const specsDir = join(workflowRoot, 'specs');
  if (!existsSync(specsDir)) return [];
  const refs: string[] = [];
  const needle = `domain="${termId}"`;
  for (const name of readdirSync(specsDir)) {
    if (!name.endsWith('.md')) continue;
    const content = readFileSync(join(specsDir, name), 'utf-8');
    if (content.includes(needle)) refs.push(name);
  }
  return refs;
}
