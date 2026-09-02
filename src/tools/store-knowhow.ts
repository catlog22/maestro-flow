/**
 * Store KnowHow Tool — Create and search reusable knowledge entries.
 *
 * Replaces the deprecated core_memory tool. Writes directly to
 * .workflow/knowhow/ as markdown files, automatically indexed by WikiIndexer.
 *
 * Operations: add, search
 * Storage: .workflow/knowhow/{PREFIX}-{timestamp}.md
 *
 * All nine content types share the canonical metadata model:
 *   session, tip, template, recipe, reference, decision, asset, blueprint,
 *   and document. Legacy type-specific aliases are accepted on read/input and
 *   normalized before canonical-only writes.
 */

import { z } from 'zod';
import type { ToolSchema, CcwToolResult } from '../types/tool-schema.js';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getProjectRoot } from '../utils/path-validator.js';
import {
  getActiveRepositoryExecution,
  resolveRepositoryContext,
  resolveRepositoryId,
  withRepositoryMutation,
  type RepositoryContext,
  type RepositoryMutationContext,
} from '../repository/context.js';
import { loadWorkspaceConfig, resolveWorkspaceLinks } from '../config/index.js';
import { isRepositoryApplicable } from '../repository/applicability.js';
import type { WikiIndexer } from '#maestro-dashboard/wiki/wiki-indexer.js';
import type { WikiEntry } from '#maestro-dashboard/wiki/wiki-types.js';
import {
  KNOWHOW_CATEGORIES as CATEGORIES,
  KNOWHOW_PREFIX_MAP as PREFIX_MAP,
  type KnowHowCategory,
  slugify,
  escapeYamlValue,
  getKnowhowDir as _getKnowhowDir,
  generateKnowhowFilename as generateId,
  normalizeCanonicalKnowledgeContent,
  normalizeKnowhowBody,
  normalizeKnowhowReplayPayload,
  parseFrontmatter,
  type CanonicalKnowledgeContent,
} from '../utils/frontmatter.js';
import { updateFileAtomic } from '../utils/atomic-write.js';
import {
  KnowhowLifecycleBridgeError,
  runKnowhowLifecycleAsync,
} from './knowhow-lifecycle-async.js';

const DECISION_STATUSES = ['proposed', 'accepted', 'superseded'] as const;
const LEGACY_STATUSES = [...DECISION_STATUSES, 'active', 'deprecated'] as const;

// --- Zod Schema ---

const OperationEnum = z.enum(['add', 'search', 'supersede', 'history', 'recover']);

const ParamsSchema = z.object({
  operation: OperationEnum,
  // add params
  id: z.string().optional(), // legacy alias for explicitId
  explicitId: z.string().optional(),
  type: z.enum(CATEGORIES).optional(),
  title: z.string().optional(),
  description: z.string().optional(), // legacy read/input alias; summaries derive from content
  content: z.string().optional(),
  body: z.string().optional(), // legacy alias for content
  keywords: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(), // legacy alias merged into keywords
  language: z.string().optional(),
  lang: z.string().optional(), // legacy alias for language
  sourceRef: z.string().optional(),
  source: z.string().optional(), // legacy alias for sourceRef
  decisionState: z.enum(DECISION_STATUSES).optional(),
  lifecycleStatus: z.enum(['active', 'deprecated']).optional(),
  status: z.enum(LEGACY_STATUSES).optional(), // legacy ambiguous status
  assetType: z.string().optional(), // legacy value becomes a keyword
  relatedPaths: z.array(z.string()).optional(),
  codePaths: z.array(z.string()).optional(), // legacy alias for relatedPaths
  appliesToRepoIds: z.array(z.string()).optional(),
  /** Canonical ID-only physical write target. Human selectors are resolved by the CLI. */
  targetRepoId: z.string().optional(),
  tool: z.boolean().optional(),
  category: z.string().optional(),
  specCategory: z.string().optional(), // legacy alias for constrained category
  // search params
  query: z.string().optional(),
  repo: z.string().optional(),
  limit: z.number().optional().default(20),
  oldId: z.string().optional(),
  newId: z.string().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

// --- Storage (delegated to shared module) ---

// --- Operations ---

export interface KnowhowAddResult {
  schema_version: 'knowhow-add-result/1.0';
  operation: 'add';
  id: string;
  filename: string;
  path: string;
  created: string;
  replayed: boolean;
  type: KnowHowCategory;
  message: string;
  warnings?: string[];
}

export function renderKnowhowDocument(
  canonical: CanonicalKnowledgeContent & { type: KnowHowCategory },
  created: string,
): string {
  const fmLines = ['---'];
  fmLines.push(`title: ${escapeYamlValue(canonical.title)}`);
  fmLines.push(`type: ${canonical.type}`);
  if (canonical.category) fmLines.push(`category: ${canonical.category}`);
  if (canonical.explicitId) fmLines.push(`explicitId: ${canonical.explicitId}`);
  fmLines.push(`created: ${created}`);
  if (canonical.keywords.length > 0) {
    fmLines.push('keywords:');
    for (const keyword of canonical.keywords) fmLines.push(`  - ${escapeYamlValue(keyword)}`);
  }
  if (canonical.language) fmLines.push(`language: ${escapeYamlValue(canonical.language)}`);
  if (canonical.sourceRef) fmLines.push(`sourceRef: ${escapeYamlValue(canonical.sourceRef)}`);
  if (canonical.decisionState) fmLines.push(`decisionState: ${canonical.decisionState}`);
  fmLines.push(`lifecycleStatus: ${canonical.lifecycleStatus}`);
  if (canonical.relatedPaths.length > 0) {
    fmLines.push('relatedPaths:');
    for (const path of canonical.relatedPaths) fmLines.push(`  - ${escapeYamlValue(path)}`);
  }
  if (canonical.appliesToRepoIds.length > 0) {
    fmLines.push('appliesToRepoIds:');
    for (const repoId of canonical.appliesToRepoIds) fmLines.push(`  - ${escapeYamlValue(repoId)}`);
  }
  if (canonical.tool) fmLines.push('tool: true');
  const normalizedContent = normalizeKnowhowBody(canonical.content)!;
  return `${fmLines.join('\n')}\n---\n\n${normalizedContent}`;
}

function bodyFromDocument(parsedBody: string): string {
  return parsedBody.replace(/^\r?\n(?:\r?\n)?/, '');
}

function addResult(
  type: KnowHowCategory,
  id: string,
  filename: string,
  created: string,
  replayed: boolean,
  warnings: string[] = [],
): KnowhowAddResult {
  return {
    schema_version: 'knowhow-add-result/1.0',
    operation: 'add',
    id,
    filename,
    path: `knowhow/${filename}`,
    created,
    replayed,
    type,
    message: replayed ? `Replayed ${type} entry: ${id}` : `Created ${type} entry: ${id}`,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export type KnowhowWriteContext = RepositoryMutationContext;

export function executeAdd(params: Params, context?: KnowhowWriteContext): CcwToolResult {
  const type = params.type;
  if (!type) return { success: false, error: 'Parameter "type" is required for add operation' };
  const legacyAliases = [
    ['id', params.id], ['description', params.description], ['body', params.body],
    ['tags', params.tags], ['lang', params.lang], ['source', params.source],
    ['status', params.status], ['assetType', params.assetType],
    ['codePaths', params.codePaths], ['specCategory', params.specCategory],
  ].filter(([, value]) => value !== undefined).map(([name]) => String(name));
  const warnings = legacyAliases.map(name => `Deprecated parameter "${name}" was normalized to the canonical contract`);
  if (params.id && params.explicitId && params.id.trim().toLowerCase() !== params.explicitId.trim().toLowerCase()) {
    return { success: false, error: 'Parameters "id" and "explicitId" must identify the same entry' };
  }

  const canonical = normalizeCanonicalKnowledgeContent({
    ...params,
    explicitId: params.explicitId ?? params.id,
  });
  if (!canonical.title) return { success: false, error: 'Parameter "title" is required for add operation' };
  if (!canonical.content) return { success: false, error: 'Parameter "content" is required for add operation' };
  if (canonical.errors.length > 0) {
    return { success: false, error: canonical.errors.join('; ') };
  }
  if (canonical.decisionState && type !== 'decision') {
    return { success: false, error: 'Parameter "decisionState" is only valid for type "decision"' };
  }
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (params.targetRepoId && !uuidPattern.test(params.targetRepoId)) {
    return {
      success: false,
      error: `targetRepoId must be an exact persisted repository ID: ${params.targetRepoId}`,
    };
  }
  const invalidApplicability = canonical.appliesToRepoIds.find(repoId => !uuidPattern.test(repoId));
  if (invalidApplicability) {
    return {
      success: false,
      error: `appliesToRepoIds must contain exact persisted repository IDs: ${invalidApplicability}`,
    };
  }

  if (params.targetRepoId && context?.repoId !== params.targetRepoId) {
    return { success: false, error: `Resolved write context does not match targetRepoId: ${params.targetRepoId}` };
  }

  const dir = _getKnowhowDir(context?.projectRoot ?? getProjectRoot());
  const { id, filename, explicitId } = generateId(type, canonical.title, canonical.explicitId);
  const filePath = join(dir, filename);
  const mutate = (): CcwToolResult => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const now = new Date().toISOString();
    const canonicalWithIdentity = { ...canonical, type, explicitId };
    const replayPayload = explicitId
      ? normalizeKnowhowReplayPayload(canonicalWithIdentity)
      : null;
    const document = renderKnowhowDocument(canonicalWithIdentity, now);
    let created = now;
    let replayed = false;
    updateFileAtomic(filePath, current => {
      if (current === null) return document;
      if (!explicitId || !replayPayload) {
        throw new Error(`Knowhow entry already exists: ${filename}`);
      }

      const parsed = parseFrontmatter(current);
      const existingCreated = parsed.data.created;
      if (typeof existingCreated !== 'string' || !existingCreated) {
        throw new Error(`CALLER_PAYLOAD_CONFLICT: existing entry has no valid created metadata: ${id}`);
      }
      const existingPayload = normalizeKnowhowReplayPayload({
        ...parsed.data,
        content: bodyFromDocument(parsed.body),
        explicitId: parsed.data.explicitId ?? explicitId,
      });
      if (existingPayload.sha256 !== replayPayload.sha256
        || existingPayload.canonical !== replayPayload.canonical) {
        throw new Error(`CALLER_PAYLOAD_CONFLICT: divergent existing explicit id ${id}`);
      }
      created = existingCreated;
      replayed = true;
      return current;
    });

    return {
      success: true,
      result: addResult(type, id, filename, created, replayed, warnings),
    };
  };
  return context?.relation === 'linked'
    ? withRepositoryMutation(context, 'knowhow', [filePath], mutate)
    : mutate();
}

async function executeSupersede(
  params: Params,
  projectRoot = getProjectRoot(),
  repositoryContext?: KnowhowWriteContext,
): Promise<CcwToolResult> {
  if (!params.oldId) return { success: false, error: 'Parameter "oldId" is required for supersede operation' };
  if (!params.newId) return { success: false, error: 'Parameter "newId" is required for supersede operation' };
  const response = await runKnowhowLifecycleAsync({
    operation: 'supersede',
    projectRoot,
    oldId: params.oldId,
    newId: params.newId,
    repositoryContext,
  });
  if (response.operation !== 'supersede') {
    throw new Error('Knowhow lifecycle worker returned a mismatched operation');
  }
  const result = response.result;
  return result.success
    ? { success: true, result }
    : { success: false, error: result.error ?? 'Knowhow supersede failed' };
}

async function executeHistory(params: Params, projectRoot = getProjectRoot()): Promise<CcwToolResult> {
  if (!params.id) return { success: false, error: 'Parameter "id" is required for history operation' };
  const response = await runKnowhowLifecycleAsync({
    operation: 'history',
    projectRoot,
    id: params.id,
  });
  if (response.operation !== 'history') {
    throw new Error('Knowhow lifecycle worker returned a mismatched operation');
  }
  return {
    success: true,
    result: {
      schema_version: 'knowhow-history-result/1.0',
      operation: 'history',
      id: params.id,
      entries: response.entries,
    },
  };
}

async function executeRecover(
  projectRoot = getProjectRoot(),
  repositoryContext?: KnowhowWriteContext,
): Promise<CcwToolResult> {
  const response = await runKnowhowLifecycleAsync({
    operation: 'recover',
    projectRoot,
    repositoryContext,
  });
  if (response.operation !== 'recover') {
    throw new Error('Knowhow lifecycle worker returned a mismatched operation');
  }
  return response.result.success
    ? { success: true, result: response.result }
    : {
      success: false,
      error: response.result.error ?? 'Knowhow lifecycle recovery failed',
    };
}

// Cached WikiIndexer instance per project root. Lazy-initialized so the
// import cost is only paid when search is invoked.
let _searchIndexer: WikiIndexer | null = null;
let _searchIndexerRoot: string | null = null;

async function getSearchIndexer(): Promise<WikiIndexer> {
  const projectRoot = getProjectRoot();
  const workflowRoot = join(projectRoot, '.workflow');
  if (_searchIndexer && _searchIndexerRoot === workflowRoot) return _searchIndexer;
  const { WikiIndexer: Cls } = await import('#maestro-dashboard/wiki/wiki-indexer.js');
  const current = resolveRepositoryContext('current', { projectRoot });
  const linkedWorkspaces = resolveWorkspaceLinks(projectRoot, loadWorkspaceConfig(projectRoot))
    .filter(link => link.valid)
    .map(link => ({
      name: link.name,
      workflowRoot: link.workflowRoot,
      shareTypes: link.share,
      repoId: link.repoId,
      repoName: link.repoName,
      workspaceFence: link.repoId ? `repo:${link.repoId}` : `linked:${link.name}`,
    }));
  _searchIndexer = new Cls({
    workflowRoot,
    linkedWorkspaces,
    repository: {
      repoId: current.repoId,
      repoName: current.repoName,
      alias: current.alias,
      workspaceFence: current.repoId ? `repo:${current.repoId}` : 'local',
    },
    persistence: 'read-only',
  });
  _searchIndexerRoot = workflowRoot;
  return _searchIndexer;
}

function deriveTypeLabel(entry: WikiEntry): string {
  const kind = (entry.ext as { virtualKind?: string })?.virtualKind;
  if (kind) return kind;
  if (entry.type === 'knowhow') {
    const filename = entry.source.path.split('/').pop() ?? '';
    const m = filename.match(/^([A-Z]{3})-/);
    if (m) {
      const cat = Object.entries(PREFIX_MAP).find(([, p]) => p === m[1])?.[0];
      if (cat) return cat;
    }
  }
  return entry.type;
}

async function executeSearch(params: Params): Promise<CcwToolResult> {
  const { query, limit } = params;
  if (!query) return { success: false, error: 'Parameter "query" is required for search operation' };

  const workflowRoot = join(getProjectRoot(), '.workflow');
  if (!existsSync(workflowRoot)) {
    return { success: true, result: { operation: 'search', query, matches: [], total_matches: 0 } };
  }

  let entries: WikiEntry[];
  try {
    const target = resolveRepositoryContext(params.repo ?? 'current', { projectRoot: getProjectRoot() });
    const explicitRepository = Boolean(params.repo);
    const indexer = await getSearchIndexer();
    entries = (await indexer.search(query, limit ?? 20, {
      filters: {
        type: 'knowhow',
        ...(explicitRepository && target.repoId ? { repoId: target.repoId } : {}),
        ...(explicitRepository && !target.repoId ? { repoAlias: target.alias } : {}),
        applicableRepoId: target.repoId ?? '__legacy__',
      },
    })).filter(entry => isRepositoryApplicable(entry, target.repoId));
  } catch (err) {
    return { success: false, error: `WikiIndexer search failed: ${(err as Error).message}` };
  }

  const matches = entries.map((e) => ({
    id: e.id,
    filename: e.source.path,
    title: e.title || 'Untitled',
    type: deriveTypeLabel(e),
    category: e.category,
    status: e.status,
    tags: e.tags,
    excerpt: (e.summary || '').slice(0, 200) + ((e.summary?.length ?? 0) > 200 ? '...' : ''),
    repoId: e.repoId ?? e.source.repoId ?? null,
    repoName: e.repoName ?? e.source.repoName ?? null,
    alias: e.alias ?? e.source.alias ?? null,
    workspaceFence: e.workspaceFence ?? e.source.workspaceFence ?? null,
    appliesToRepoIds: e.appliesToRepoIds ?? null,
  }));

  return {
    success: true,
    result: {
      operation: 'search',
      query,
      matches,
      total_matches: matches.length,
    },
  };
}

// --- Tool Schema ---

export const schema: ToolSchema = {
  name: 'store_knowhow',
  description: `Store reusable knowledge (knowhow) entries to .workflow/knowhow/.

**Operations:**

*   **add** — Create a new knowhow entry.
    Required: type, title, content
    Optional canonical fields: keywords, category, sourceRef, relatedPaths,
      appliesToRepoIds, language, decisionState, lifecycleStatus, tool, explicitId
    Legacy aliases remain accepted on input but are never emitted by new writes:
      body, tags, specCategory, source, codePaths, lang, assetType, status, id

*   **search** — Full-text search knowhow entries.
    Required: query
    Optional: limit (default: 20)

*   **supersede** — Link two knowhow entries bidirectionally.
    Required: oldId, newId

*   **history** — Read the evolution chain containing an entry.
    Required: id

*   **recover** — Explicitly recover a pending lifecycle intent.

**Types & prefixes:**
  session    → KNW-{ts}.md   session state recovery
  tip        → TIP-{ts}.md   quick note / reminder
  template   → TPL-{ts}.md   code/config template
  recipe     → RCP-{ts}.md   step-by-step guide
  reference  → REF-{ts}.md   external doc summary
  decision   → DCS-{ts}.md   architecture decision record
  asset      → AST-{ts}.md   reusable asset (prompt, config, workflow)
  blueprint  → BLP-{ts}.md   architecture blueprint with code paths
  document   → DOC-{ts}.md   general document / fallback category

Entries are automatically indexed by WikiIndexer (type=knowhow, category={type}).`,
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['add', 'search', 'supersede', 'history', 'recover'],
        description: 'Operation to perform',
      },
      type: {
        type: 'string',
        enum: CATEGORIES,
        description: 'Knowhow content type. Required for add.',
      },
      id: {
        type: 'string',
        description: 'Legacy alias for explicitId on add, or the entry id for history.',
      },
      explicitId: {
        type: 'string',
        description: 'Stable caller-owned Knowhow id for idempotent add.',
      },
      title: {
        type: 'string',
        description: 'Entry title. Required for add.',
      },
      description: {
        type: 'string',
        description: 'Deprecated summary alias. New entries derive summaries from content.',
      },
      content: {
        type: 'string',
        description: 'Canonical entry content in markdown. Required for add.',
      },
      body: {
        type: 'string',
        description: 'Legacy alias for content.',
      },
      keywords: {
        type: 'array',
        items: { type: 'string' },
        description: 'Caller-owned semantic keywords.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Legacy alias merged into keywords.',
      },
      language: {
        type: 'string',
        description: 'Optional content/programming language.',
      },
      lang: {
        type: 'string',
        description: 'Legacy alias for language.',
      },
      sourceRef: {
        type: 'string',
        description: 'General provenance URL or document identifier.',
      },
      source: {
        type: 'string',
        description: 'Legacy alias for sourceRef.',
      },
      decisionState: {
        type: 'string',
        enum: DECISION_STATUSES,
        description: '[decision] Proposed, accepted, or superseded decision state.',
      },
      lifecycleStatus: {
        type: 'string',
        enum: ['active', 'deprecated'],
        description: 'Knowledge lifecycle, independent of decisionState.',
      },
      status: {
        type: 'string',
        enum: LEGACY_STATUSES,
        description: 'Legacy ambiguous alias for decisionState/lifecycleStatus.',
      },
      assetType: {
        type: 'string',
        description: '[asset] Asset subtype (e.g. prompt, config, workflow).',
      },
      relatedPaths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Project-relative related paths, valid for every Knowhow type.',
      },
      codePaths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Legacy alias for relatedPaths.',
      },
      targetRepoId: {
        type: 'string',
        description: 'Exact persisted repository ID for the physical Knowhow store. Names, paths, and aliases are not accepted.',
      },
      appliesToRepoIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Exact persisted repository IDs to which the content applies. Names, paths, and aliases are not accepted.',
      },
      category: {
        type: 'string',
        enum: ['coding', 'arch', 'debug', 'test', 'review', 'learning', 'ui'],
        description: 'Canonical constrained category for search and injection.',
      },
      specCategory: {
        type: 'string',
        description: 'Legacy category alias; free values are retained as keywords.',
      },
      // search
      query: {
        type: 'string',
        description: 'Search query. Required for search.',
      },
      limit: {
        type: 'number',
        description: 'Max search results (default: 20).',
      },
      repo: {
        type: 'string',
        description: 'Search target repository selector (current, ID, linked alias, or unique name).',
      },
      tool: {
        type: 'boolean',
        description: 'Mark the entry as a reusable tool.',
      },
      oldId: {
        type: 'string',
        description: 'Existing knowhow id to deprecate.',
      },
      newId: {
        type: 'string',
        description: 'Replacement knowhow id.',
      },
    },
    required: ['operation'],
  },
};

// --- Handler ---

export async function handler(
  params: Record<string, unknown>,
  operationContext?: KnowhowWriteContext,
): Promise<CcwToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid params: ${parsed.error.message}` };
  }

  try {
    switch (parsed.data.operation) {
      case 'add': {
        let context = operationContext;
        const active = getActiveRepositoryExecution();
        const hostRoot = context?.authorityRoot ?? active?.actor.currentProjectRoot ?? getProjectRoot();
        if (active) {
          if (parsed.data.targetRepoId && active.target.repoId !== parsed.data.targetRepoId) {
            return { success: false, error: `Resolved write context does not match targetRepoId: ${parsed.data.targetRepoId}` };
          }
          if (!active.target.repoId) {
            return { success: false, error: 'Repository mutation requires a persisted target repository identity' };
          }
          context = resolveRepositoryId(active.target.repoId, {
            projectRoot: active.actor.currentProjectRoot,
            corpus: 'knowhow',
            mode: 'write',
          });
        } else if (parsed.data.targetRepoId) {
          if (context && context.repoId !== parsed.data.targetRepoId) {
            return { success: false, error: `Resolved write context does not match targetRepoId: ${parsed.data.targetRepoId}` };
          }
          context ??= resolveRepositoryId(parsed.data.targetRepoId, {
            projectRoot: hostRoot,
            corpus: 'knowhow',
            mode: 'write',
          });
        }
        if (!operationContext && parsed.data.appliesToRepoIds?.length) {
          for (const repoId of parsed.data.appliesToRepoIds) {
            resolveRepositoryId(repoId, { projectRoot: hostRoot });
          }
        }
        return executeAdd(parsed.data, context);
      }
      case 'search':
        return executeSearch(parsed.data);
      case 'supersede':
      case 'history':
      case 'recover': {
        const active = getActiveRepositoryExecution();
        const mode = parsed.data.operation === 'history' ? 'read' : 'write';
        let targetRoot = getProjectRoot();
        let context = operationContext;
        if (active) {
          if (parsed.data.targetRepoId && active.target.repoId !== parsed.data.targetRepoId) {
            return { success: false, error: `Resolved repository context does not match targetRepoId: ${parsed.data.targetRepoId}` };
          }
          targetRoot = active.target.projectRoot;
          if (mode === 'write' && active.target.repoId) {
            context = resolveRepositoryId(active.target.repoId, {
              projectRoot: active.actor.currentProjectRoot,
              corpus: 'knowhow',
              mode,
            });
          }
        } else if (parsed.data.targetRepoId) {
          context = resolveRepositoryId(parsed.data.targetRepoId, {
            projectRoot: operationContext?.authorityRoot ?? getProjectRoot(),
            corpus: 'knowhow',
            mode,
          });
          targetRoot = context.projectRoot;
        }
        if (parsed.data.operation === 'supersede') {
          return await executeSupersede(parsed.data, targetRoot, context);
        }
        if (parsed.data.operation === 'history') return await executeHistory(parsed.data, targetRoot);
        return await executeRecover(targetRoot, context);
      }
      default:
        return { success: false, error: `Unknown operation: ${parsed.data.operation}` };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof KnowhowLifecycleBridgeError
        ? `${error.code}: ${error.message}`
        : (error as Error).message,
    };
  }
}
