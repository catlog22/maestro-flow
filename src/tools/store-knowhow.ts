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
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getProjectRoot } from '../utils/path-validator.js';
import { WikiIndexer } from '#maestro-dashboard/wiki/wiki-indexer.js';
import type { WikiEntry } from '#maestro-dashboard/wiki/wiki-types.js';
import {
  KNOWHOW_CATEGORIES as CATEGORIES,
  KNOWHOW_PREFIX_MAP as PREFIX_MAP,
  type KnowHowCategory,
  slugify,
  escapeYamlValue,
  getKnowhowDir as _getKnowhowDir,
  generateKnowhowFilename as generateId,
} from '../utils/frontmatter.js';

const DECISION_STATUSES = ['proposed', 'accepted', 'superseded'] as const;

// --- Storage ---

function getKnowhowDir(): string {
  return _getKnowhowDir(getProjectRoot());
}

// --- Zod Schema ---

const OperationEnum = z.enum(['add', 'search']);

const ParamsSchema = z.object({
  operation: OperationEnum,
  // add params
  type: z.enum(CATEGORIES).optional(),
  title: z.string().optional(),
  description: z.string().optional(), // one-line summary for search results
  body: z.string().optional(),
  tags: z.array(z.string()).optional(),
  // type-specific fields (persisted to frontmatter)
  lang: z.string().optional(),       // template: programming language
  source: z.string().optional(),     // reference: original URL
  status: z.enum(DECISION_STATUSES).optional(), // decision: lifecycle status
  assetType: z.string().optional(),  // asset: asset subtype
  codePaths: z.array(z.string()).optional(), // asset/blueprint: related code paths
  category: z.string().optional(),  // spec category for tool discovery (coding, arch, test, etc.)
  specCategory: z.enum(['coding', 'arch', 'debug', 'test', 'review', 'learning', 'ui']).optional(),
  // search params
  query: z.string().optional(),
  limit: z.number().optional().default(20),
});

type Params = z.infer<typeof ParamsSchema>;

// --- Storage (delegated to shared module) ---

// --- Operations ---

function executeAdd(params: Params): CcwToolResult {
  const { type, title, description, body, tags, lang, source, status, assetType, codePaths, category, specCategory } = params;

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

  const { id, filename } = generateId(type, title);
  const filePath = join(dir, filename);

  // Build YAML frontmatter with type-specific fields
  const now = new Date().toISOString();
  const fmLines = ['---'];
  fmLines.push(`title: ${escapeYamlValue(title)}`);
  if (description) fmLines.push(`description: ${escapeYamlValue(description)}`);
  fmLines.push(`type: ${type}`);
  fmLines.push(`created: ${now}`);
  if (tags && tags.length > 0) {
    fmLines.push(`tags:`);
    for (const t of tags) fmLines.push(`  - ${t}`);
  }
  // Type-specific frontmatter fields
  if (lang) fmLines.push(`lang: ${lang}`);
  if (source) fmLines.push(`source: ${escapeYamlValue(source)}`);
  if (status) fmLines.push(`status: ${status}`);
  if (category) fmLines.push(`category: ${category}`);
  if (specCategory) fmLines.push(`specCategory: ${specCategory}`);
  if (assetType) fmLines.push(`assetType: ${escapeYamlValue(assetType)}`);
  if (codePaths && codePaths.length > 0) {
    fmLines.push('codePaths:');
    for (const p of codePaths) fmLines.push(`  - ${p}`);
  }
  fmLines.push('---', '', body);

  writeFileSync(filePath, fmLines.join('\n'), 'utf-8');

  return {
    success: true,
    result: {
      operation: 'add',
      id,
      filename,
      type,
      path: `knowhow/${filename}`,
      message: `Created ${type} entry: ${id}`,
    },
  };
}

// Cached WikiIndexer instance per project root. Lazy-initialized so the
// import cost is only paid when search is invoked.
let _searchIndexer: WikiIndexer | null = null;
let _searchIndexerRoot: string | null = null;

function getSearchIndexer(): WikiIndexer {
  const workflowRoot = join(getProjectRoot(), '.workflow');
  if (_searchIndexer && _searchIndexerRoot === workflowRoot) return _searchIndexer;
  _searchIndexer = new WikiIndexer({ workflowRoot });
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
    const indexer = getSearchIndexer();
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
        enum: ['add', 'search'],
        description: 'Operation to perform',
      },
      type: {
        type: 'string',
        enum: CATEGORIES,
        description: 'Knowhow content type. Required for add.',
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
      default:
        return { success: false, error: `Unknown operation: ${parsed.data.operation}` };
    }
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
