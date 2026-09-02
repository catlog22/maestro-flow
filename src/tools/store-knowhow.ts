/**
 * Store KnowHow Tool — Create and search reusable knowledge entries.
 *
 * Replaces the deprecated core_memory tool. Writes directly to
 * .workflow/knowhow/ as markdown files, automatically indexed by WikiIndexer.
 *
 * Operations: add, search
 * Storage: .workflow/knowhow/{PREFIX}-{timestamp}.md
 *
 * Content types with type-specific fields:
 *   session (KNW-) — session state recovery
 *   tip     (TIP-) — quick note / reminder
 *   template (TPL-) — code/config template [+ lang]
 *   recipe   (RCP-) — step-by-step guide
 *   reference (REF-) — external doc summary [+ source]
 *   decision (DCS-) — architecture decision record [+ status]
 */

import { z } from 'zod';
import type { ToolSchema, CcwToolResult } from '../types/tool-schema.js';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getProjectRoot } from '../utils/path-validator.js';
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
  normalizeKnowhowBody,
  normalizeKnowhowReplayPayload,
  parseFrontmatter,
} from '../utils/frontmatter.js';
import { updateFileAtomic } from '../utils/atomic-write.js';
import {
  KnowhowLifecycleBridgeError,
  runKnowhowLifecycleAsync,
} from './knowhow-lifecycle-async.js';

const DECISION_STATUSES = ['proposed', 'accepted', 'superseded'] as const;

// --- Storage ---

function getKnowhowDir(): string {
  return _getKnowhowDir(getProjectRoot());
}

// --- Zod Schema ---

const OperationEnum = z.enum(['add', 'search', 'supersede', 'history', 'recover']);

const ParamsSchema = z.object({
  operation: OperationEnum,
  // add params
  id: z.string().optional(),
  type: z.enum(CATEGORIES).optional(),
  title: z.string().optional(),
  description: z.string().optional(), // one-line summary for search results
  body: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  // type-specific fields (persisted to frontmatter)
  lang: z.string().optional(),       // template: programming language
  source: z.string().optional(),     // reference: original URL
  status: z.enum(DECISION_STATUSES).optional(), // decision: lifecycle status
  assetType: z.string().optional(),  // asset: asset subtype
  codePaths: z.array(z.string()).optional(), // asset/blueprint: related code paths
  tool: z.boolean().optional(),
  category: z.string().optional(),  // spec category for tool discovery (coding, arch, test, etc.)
  specCategory: z.enum(['coding', 'arch', 'debug', 'test', 'review', 'learning', 'ui']).optional(),
  // search params
  query: z.string().optional(),
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
}

function renderKnowhowDocument(
  params: Params & { type: KnowHowCategory; title: string; body: string },
  created: string,
  explicitId: string | null,
): string {
  const {
    type, title, description, body, keywords, tags, lang, source, status,
    assetType, codePaths, tool, category, specCategory,
  } = params;
  const fmLines = ['---'];
  fmLines.push(`title: ${escapeYamlValue(title)}`);
  if (description) fmLines.push(`description: ${escapeYamlValue(description)}`);
  fmLines.push(`type: ${type}`);
  if (category) fmLines.push(`category: ${escapeYamlValue(category)}`);
  if (explicitId) fmLines.push(`explicitId: ${explicitId}`);
  fmLines.push(`created: ${created}`);
  if (keywords && keywords.length > 0) {
    fmLines.push('keywords:');
    for (const keyword of keywords) fmLines.push(`  - ${keyword}`);
  }
  if (tags && tags.length > 0) {
    fmLines.push('tags:');
    for (const tag of tags) fmLines.push(`  - ${tag}`);
  }
  if (lang) fmLines.push(`lang: ${lang}`);
  if (source) fmLines.push(`source: ${escapeYamlValue(source)}`);
  if (status) fmLines.push(`status: ${status}`);
  if (specCategory) fmLines.push(`specCategory: ${specCategory}`);
  if (assetType) fmLines.push(`assetType: ${escapeYamlValue(assetType)}`);
  if (codePaths && codePaths.length > 0) {
    fmLines.push('codePaths:');
    for (const path of codePaths) fmLines.push(`  - ${path}`);
  }
  if (tool) fmLines.push('tool: true');
  const normalizedBody = normalizeKnowhowBody(body)!;
  return `${fmLines.join('\n')}\n---\n\n${normalizedBody}`;
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
  };
}

export function executeAdd(params: Params): CcwToolResult {
  const {
    id: explicitIdInput, type, title, description, body, keywords, tags, lang,
    source, status, assetType, codePaths, category, specCategory,
  } = params;

  if (!type) return { success: false, error: 'Parameter "type" is required for add operation' };
  if (!title) return { success: false, error: 'Parameter "title" is required for add operation' };
  if (!body) return { success: false, error: 'Parameter "body" is required for add operation' };

  // Validate type-specific fields
  if (lang && type !== 'template') {
    return { success: false, error: 'Parameter "lang" is only valid for type "template"' };
  }
  if (source && type !== 'reference') {
    return { success: false, error: 'Parameter "source" is only valid for type "reference"' };
  }
  if (status && type !== 'decision') {
    return { success: false, error: 'Parameter "status" is only valid for type "decision"' };
  }
  if (assetType && type !== 'asset') {
    return { success: false, error: 'Parameter "assetType" is only valid for type "asset"' };
  }
  if (codePaths && type !== 'blueprint' && type !== 'asset') {
    return { success: false, error: 'Parameter "codePaths" is only valid for type "asset" or "blueprint"' };
  }

  const dir = getKnowhowDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const { id, filename, explicitId } = generateId(type, title, explicitIdInput);
  const filePath = join(dir, filename);
  const now = new Date().toISOString();
  const replayPayload = explicitId
    ? normalizeKnowhowReplayPayload({
      type,
      category,
      title,
      description,
      keywords,
      tags,
      body,
      explicitId,
    })
    : null;
  const document = renderKnowhowDocument(
    {
      ...params,
      type,
      title,
      body,
      keywords,
      tags,
      category,
      description,
      lang,
      source,
      status,
      assetType,
      codePaths,
      specCategory,
    },
    now,
    explicitId,
  );
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
      type: parsed.data.type,
      category: parsed.data.category,
      title: parsed.data.title,
      description: parsed.data.description,
      keywords: parsed.data.keywords,
      tags: parsed.data.tags,
      body: bodyFromDocument(parsed.body),
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
    result: addResult(type, id, filename, created, replayed),
  };
}

async function executeSupersede(params: Params): Promise<CcwToolResult> {
  if (!params.oldId) return { success: false, error: 'Parameter "oldId" is required for supersede operation' };
  if (!params.newId) return { success: false, error: 'Parameter "newId" is required for supersede operation' };
  const response = await runKnowhowLifecycleAsync({
    operation: 'supersede',
    projectRoot: getProjectRoot(),
    oldId: params.oldId,
    newId: params.newId,
  });
  if (response.operation !== 'supersede') {
    throw new Error('Knowhow lifecycle worker returned a mismatched operation');
  }
  const result = response.result;
  return result.success
    ? { success: true, result }
    : { success: false, error: result.error ?? 'Knowhow supersede failed' };
}

async function executeHistory(params: Params): Promise<CcwToolResult> {
  if (!params.id) return { success: false, error: 'Parameter "id" is required for history operation' };
  const response = await runKnowhowLifecycleAsync({
    operation: 'history',
    projectRoot: getProjectRoot(),
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

async function executeRecover(): Promise<CcwToolResult> {
  const response = await runKnowhowLifecycleAsync({
    operation: 'recover',
    projectRoot: getProjectRoot(),
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
  const workflowRoot = join(getProjectRoot(), '.workflow');
  if (_searchIndexer && _searchIndexerRoot === workflowRoot) return _searchIndexer;
  const { WikiIndexer: Cls } = await import('#maestro-dashboard/wiki/wiki-indexer.js');
  _searchIndexer = new Cls({ workflowRoot, persistence: 'read-only' });
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
    const indexer = await getSearchIndexer();
    entries = await indexer.search(query, limit ?? 20);
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
    Required: type, title, body
    Optional: description (one-line summary for search results), tags
    Type-specific fields:
      template:  lang (programming language)
      reference: source (URL)
      decision:  status (proposed | accepted | superseded)
      asset:     assetType (e.g. api-contract, prompt), codePaths (related source paths)
      blueprint: codePaths (related source paths)
    Optional: tags (string[]), category, specCategory (spec category for agent injection)

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
        description: 'Stable explicit id for add, or the entry id for history.',
      },
      title: {
        type: 'string',
        description: 'Entry title. Required for add.',
      },
      description: {
        type: 'string',
        description: 'One-line description for search results. Falls back to first paragraph of body.',
      },
      body: {
        type: 'string',
        description: 'Entry body in markdown. Required for add.',
      },
      keywords: {
        type: 'array',
        items: { type: 'string' },
        description: 'Caller-owned semantic keywords.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Categorization tags.',
      },
      // type-specific
      lang: {
        type: 'string',
        description: '[template] Programming language (e.g. typescript, python, bash, yaml).',
      },
      source: {
        type: 'string',
        description: '[reference] Original URL or document identifier.',
      },
      status: {
        type: 'string',
        enum: DECISION_STATUSES,
        description: '[decision] Lifecycle status: proposed → accepted → superseded.',
      },
      assetType: {
        type: 'string',
        description: '[asset] Asset subtype (e.g. prompt, config, workflow).',
      },
      codePaths: {
        type: 'array',
        items: { type: 'string' },
        description: '[asset/blueprint] Related code paths.',
      },
      category: {
        type: 'string',
        description: 'Spec category for agent auto-discovery (coding, arch, test, debug, review, learning).',
      },
      specCategory: {
        type: 'string',
        enum: ['coding', 'arch', 'debug', 'test', 'review', 'learning', 'ui'],
        description: 'Spec category for cross-system alignment. Allows knowhow entries to be injected alongside spec entries by spec-injector.',
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

export async function handler(params: Record<string, unknown>): Promise<CcwToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid params: ${parsed.error.message}` };
  }

  try {
    switch (parsed.data.operation) {
      case 'add':
        return executeAdd(parsed.data);
      case 'search':
        return executeSearch(parsed.data);
      case 'supersede':
        return await executeSupersede(parsed.data);
      case 'history':
        return await executeHistory(parsed.data);
      case 'recover':
        return await executeRecover();
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
