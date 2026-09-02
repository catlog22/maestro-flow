/**
 * Spec Writer
 *
 * Append new spec entries to the appropriate category file.
 * Uses spec-entry-parser for formatting and spec-loader for directory resolution.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { formatNewEntry, parseSpecEntries, generateSid } from './spec-entry-parser.js';
import { resolveSpecDir, CATEGORY_MAP, type SpecCategory, type SpecScope } from './spec-loader.js';
import { ensureSpecFile } from './spec-init.js';
import { normalizeCanonicalKnowledgeContent, slugify } from '../utils/frontmatter.js';
import { updateFileAtomic } from '../utils/atomic-write.js';
import { executeAdd, type KnowhowWriteContext } from './store-knowhow.js';
import {
  withRepositoryMutation,
  type RepositoryMutationContext,
} from '../repository/context.js';

// ============================================================================
// Size guard — prevent oversized entries in spec files
// ============================================================================

/** Maximum content size (in characters) before auto-redirecting to knowhow */
export const MAX_SPEC_ENTRY_SIZE = 2048; // 2KB
const REPOSITORY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  /** Stable identity assigned to the new entry (undefined for title duplicates). */
  sid?: string;
  /** True when an explicit sid replay matched every canonical caller-owned field. */
  replayed?: boolean;
}

export type SpecWriteContext = RepositoryMutationContext;

export interface SpecAppendOptions {
  allowDuplicateTitle?: boolean;
  /** Explicit host-resolved physical repository context. */
  operationContext?: SpecWriteContext;
  relatedPaths?: string[];
  appliesToRepoIds?: string[];
  /** Internal recursion fence: authority was revalidated under target locks. */
  mutationValidated?: boolean;
}

export interface CanonicalSpecWriteInput extends Record<string, unknown> {
  category: SpecCategory;
  title: string;
  content: string;
  keywords?: string[];
  sourceRef?: string | null;
  relatedPaths?: string[];
  appliesToRepoIds?: string[];
  /** Canonical ID-only physical target, verified against the resolved context. */
  targetRepoId?: string;
  scope?: SpecScope;
  uid?: string;
  sid?: string;
  allowDuplicateTitle?: boolean;
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

/**
 * Redirect oversized content through the canonical Knowhow writer. This keeps
 * Spec from maintaining a second, subtly different Knowhow serialization path.
 */
function redirectToKnowhow(
  context: KnowhowWriteContext,
  category: SpecCategory,
  title: string,
  content: string,
  keywords: string[],
  sourceRef: string | undefined,
  options: SpecAppendOptions | undefined,
): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const stableSlug = slugify(title).slice(0, 40) || 'entry';
  const response = executeAdd({
    operation: 'add',
    type: 'document',
    explicitId: `doc-${date}-${stableSlug}`,
    title,
    content,
    keywords,
    category,
    sourceRef,
    relatedPaths: options?.relatedPaths,
    appliesToRepoIds: options?.appliesToRepoIds,
    targetRepoId: context.repoId ?? undefined,
    limit: 20,
  }, context);
  if (!response.success) throw new Error(response.error ?? 'Knowhow redirect failed');
  return (response.result as { path: string }).path;
}

// ============================================================================
// Public API
// ============================================================================

function canonicalSpecReplayPayload(input: CanonicalSpecWriteInput): string {
  const canonical = normalizeCanonicalKnowledgeContent(input);
  if (!canonical.category || canonical.errors.length > 0) {
    throw new Error(canonical.errors.join('; ') || `Invalid Spec category: ${input.category}`);
  }
  const invalidApplicability = canonical.appliesToRepoIds.find(repoId => !REPOSITORY_ID_PATTERN.test(repoId));
  if (invalidApplicability) {
    throw new Error(`appliesToRepoIds must contain exact persisted repository IDs: ${invalidApplicability}`);
  }
  return JSON.stringify({
    category: canonical.category,
    title: canonical.title,
    content: canonical.content.replace(/\n+$/g, ''),
    keywords: [...new Set(canonical.keywords)].sort(),
    sourceRef: canonical.sourceRef,
    relatedPaths: [...new Set(canonical.relatedPaths)].sort(),
    appliesToRepoIds: [...new Set(canonical.appliesToRepoIds)].sort(),
  });
}

/** Canonical object contract for ordinary Spec creation. */
export function writeSpecEntry(
  context: SpecWriteContext,
  input: CanonicalSpecWriteInput,
): SpecAddResult {
  if (input.targetRepoId && !REPOSITORY_ID_PATTERN.test(input.targetRepoId)) {
    throw new Error(`targetRepoId must be an exact persisted repository ID: ${input.targetRepoId}`);
  }
  if (input.targetRepoId && context.repoId !== input.targetRepoId) {
    throw new Error(`Resolved write context does not match targetRepoId: ${input.targetRepoId}`);
  }
  if ((input.scope ?? 'project') !== 'project' && input.targetRepoId) {
    throw new Error(`Scope "${input.scope}" cannot use targetRepoId to choose its physical store`);
  }
  return appendSpecEntry(
    context.projectRoot,
    input.category,
    input.title,
    input.content,
    input.keywords ?? [],
    input.sourceRef === null ? '' : input.sourceRef,
    input.scope,
    input.uid,
    undefined,
    input.sid,
    {
      operationContext: context,
      relatedPaths: input.relatedPaths,
      appliesToRepoIds: input.appliesToRepoIds,
      allowDuplicateTitle: input.allowDuplicateTitle,
    },
  );
}

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
  sidOverride?: string,
  options?: SpecAppendOptions,
): SpecAddResult {
  const resolvedScope = scope ?? 'project';
  if (resolvedScope !== 'project' && options?.operationContext?.relation === 'linked') {
    throw new Error(`Scope "${resolvedScope}" cannot use a repository selector to choose its physical store`);
  }
  const physicalProjectPath = options?.operationContext?.projectRoot ?? projectPath;
  const filename = categoryToFilename(category);
  if (!filename) {
    return { ok: false, file: '', category, title, duplicate: false };
  }
  if (options?.operationContext?.relation === 'linked' && !options.mutationValidated) {
    const guardedFile = join(resolveSpecDir(physicalProjectPath, resolvedScope, uid), filename);
    return withRepositoryMutation(
      options.operationContext,
      'spec',
      [guardedFile],
      () => appendSpecEntry(
        projectPath, category, title, content, keywords, source, scope, uid,
        description, sidOverride, { ...options, mutationValidated: true },
      ),
    );
  }
  canonicalSpecReplayPayload({
    category, title, content, keywords, sourceRef: source,
    relatedPaths: options?.relatedPaths,
    appliesToRepoIds: options?.appliesToRepoIds,
  });
  const evidence = source ?? captureGitEvidence(physicalProjectPath);

  // Size guard: redirect oversized content to knowhow
  if (content && content.length > MAX_SPEC_ENTRY_SIZE) {
    const knowhowContext: KnowhowWriteContext = options?.operationContext ?? {
      projectRoot: physicalProjectPath,
      repoId: null,
      relation: 'current',
    };
    const ref = redirectToKnowhow(
      knowhowContext, category, title, content, keywords, source, options,
    );
    const summary = content.slice(0, 200).replace(/\s+/g, ' ').trim();
    console.log('[spec] Content exceeds 2KB, stored as knowhow with spec ref');
    const result = appendSpecEntryWithRef(
      projectPath, category, title, summary, keywords, ref, evidence, scope, uid, sidOverride, options,
    );
    return { ...result, redirected: true, knowhowRef: ref, evidence };
  }

  const specsDir = resolveSpecDir(physicalProjectPath, resolvedScope, uid);

  // Ensure directory exists
  if (!existsSync(specsDir)) {
    mkdirSync(specsDir, { recursive: true });
  }

  const filePath = join(specsDir, filename);

  // Ensure file exists with proper YAML frontmatter; also migrates legacy
  // stubs that lack a frontmatter block.
  ensureSpecFile(specsDir, filename);

  // Lock-guarded read-modify-write (G-A4): the duplicate check and the
  // append must see the same content, so both run inside the lock.
  const date = new Date().toISOString().slice(0, 10);
  const sid = sidOverride ?? generateSid();
  let isDuplicate = false;
  let replayed = false;
  updateFileAtomic(filePath, existing => {
    const current = existing ?? '';
    // Parsed duplicate check: exact title match against parsed entries
    const { entries, legacy } = parseSpecEntries(current);
    if (sidOverride) {
      const existingReplay = entries.find(entry => entry.sid === sidOverride);
      if (existingReplay) {
        const existingBody = existingReplay.content
          .replace(/^###\s+.*(?:\r?\n)+(?:\r?\n)?/, '')
          .trim();
        const expected = canonicalSpecReplayPayload({
          category, title, content, keywords, sourceRef: source,
          relatedPaths: options?.relatedPaths,
          appliesToRepoIds: options?.appliesToRepoIds,
        });
        const actual = canonicalSpecReplayPayload({
          category: existingReplay.category as SpecCategory,
          title: existingReplay.title,
          content: existingBody,
          keywords: existingReplay.keywords,
          sourceRef: source === undefined ? undefined : existingReplay.sourceRef,
          relatedPaths: existingReplay.relatedPaths,
          appliesToRepoIds: existingReplay.appliesToRepoIds,
        });
        if (actual !== expected) {
          throw new Error(`CALLER_PAYLOAD_CONFLICT: divergent existing spec sid ${sidOverride}`);
        }
        replayed = true;
        return null;
      }
    }
    isDuplicate = !options?.allowDuplicateTitle && (
      entries.some(
        e => e.title.toLowerCase().trim() === title.toLowerCase().trim()
      ) || legacy.some(
        e => e.title.toLowerCase().trim() === title.toLowerCase().trim()
      )
    );
    if (isDuplicate) return null;

    // Generate and append entry with a stable identity
    const entry = formatNewEntry(
      category, keywords, date, title, content, evidence, undefined, description,
      undefined, undefined, undefined,
      {
        sid,
        relatedPaths: options?.relatedPaths,
        appliesToRepoIds: options?.appliesToRepoIds,
      },
    );
    return current + '\n\n' + entry;
  });

  if (replayed) {
    return { ok: true, file: filePath, category, title, duplicate: false, evidence, sid, replayed: true };
  }
  if (isDuplicate) {
    return { ok: true, file: filePath, category, title, duplicate: true };
  }
  return { ok: true, file: filePath, category, title, duplicate: false, evidence, sid };
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
  sidOverride?: string,
  options?: SpecAppendOptions,
): SpecAddResult {
  const resolvedScope = scope ?? 'project';
  if (resolvedScope !== 'project' && options?.operationContext?.relation === 'linked') {
    throw new Error(`Scope "${resolvedScope}" cannot use a repository selector to choose its physical store`);
  }
  const physicalProjectPath = options?.operationContext?.projectRoot ?? projectPath;
  const specsDir = resolveSpecDir(physicalProjectPath, resolvedScope, uid);

  const filename = categoryToFilename(category);
  if (!filename) {
    return { ok: false, file: '', category, title, duplicate: false };
  }
  if (options?.operationContext?.relation === 'linked' && !options.mutationValidated) {
    return withRepositoryMutation(
      options.operationContext,
      'spec',
      [join(specsDir, filename)],
      () => appendSpecEntryWithRef(
        projectPath, category, title, summary, keywords, ref, source, scope, uid,
        sidOverride, { ...options, mutationValidated: true },
      ),
    );
  }

  if (!existsSync(specsDir)) {
    mkdirSync(specsDir, { recursive: true });
  }

  const filePath = join(specsDir, filename);

  // Ensure file exists with proper YAML frontmatter; also migrates legacy
  // stubs that lack a frontmatter block.
  ensureSpecFile(specsDir, filename);

  // Lock-guarded read-modify-write (G-A4) — same protocol as appendSpecEntry.
  const date = new Date().toISOString().slice(0, 10);
  const sid = sidOverride ?? generateSid();
  let isDuplicateRef = false;
  let replayed = false;
  updateFileAtomic(filePath, existing => {
    const current = existing ?? '';
    // Parsed duplicate check: exact title match against parsed entries
    const { entries: existingEntries, legacy: existingLegacy } = parseSpecEntries(current);
    if (sidOverride) {
      const existingReplay = existingEntries.find(entry => entry.sid === sidOverride);
      if (existingReplay) {
        const existingBody = existingReplay.content
          .replace(/^###\s+.*(?:\r?\n)+(?:\r?\n)?/, '')
          .trim();
        const expected = `${canonicalSpecReplayPayload({
          category, title, content: summary, keywords, sourceRef: source,
          relatedPaths: options?.relatedPaths,
          appliesToRepoIds: options?.appliesToRepoIds,
        })}\nref:${ref}`;
        const actual = `${canonicalSpecReplayPayload({
          category: existingReplay.category as SpecCategory,
          title: existingReplay.title,
          content: existingBody,
          keywords: existingReplay.keywords,
          sourceRef: source === undefined ? undefined : existingReplay.sourceRef,
          relatedPaths: existingReplay.relatedPaths,
          appliesToRepoIds: existingReplay.appliesToRepoIds,
        })}\nref:${existingReplay.ref ?? ''}`;
        if (actual !== expected) {
          throw new Error(`CALLER_PAYLOAD_CONFLICT: divergent existing spec sid ${sidOverride}`);
        }
        replayed = true;
        return null;
      }
    }
    isDuplicateRef = !options?.allowDuplicateTitle && (
      existingEntries.some(
        e => e.title.toLowerCase().trim() === title.toLowerCase().trim()
      ) || existingLegacy.some(
        e => e.title.toLowerCase().trim() === title.toLowerCase().trim()
      )
    );
    if (isDuplicateRef) return null;

    const entry = formatNewEntry(
      category, keywords, date, title, summary, source, ref, undefined,
      undefined, undefined, undefined,
      {
        sid,
        relatedPaths: options?.relatedPaths,
        appliesToRepoIds: options?.appliesToRepoIds,
      },
    );
    return current + '\n\n' + entry;
  });

  if (replayed) {
    return { ok: true, file: filePath, category, title, duplicate: false, sid, replayed: true };
  }
  if (isDuplicateRef) {
    return { ok: true, file: filePath, category, title, duplicate: true };
  }
  return { ok: true, file: filePath, category, title, duplicate: false, sid };
}
