/**
 * Load Command — Unified knowledge loading (specs, wiki, sessions).
 *
 *   maestro load --type session --list             — list recent sessions
 *   maestro load --type session --id <id>          — load specific session
 *   maestro load --type spec --category coding     — load coding specs
 *   maestro load --type knowhow --list             — browse knowhow entries
 *   maestro load --type knowhow --id <id>          — load specific knowhow
 */

import type { Command } from 'commander';
import { resolve, join } from 'node:path';

import { truncate } from '../utils/cli-format.js';
import { isDeprecatedKnowledgeEntry } from '../utils/knowledge-lifecycle.js';
import type { WikiIndexer } from '#maestro-dashboard/wiki/wiki-indexer.js';
import type { WikiEntry, WikiIndex } from '#maestro-dashboard/wiki/wiki-types.js';
import { loadWorkspaceConfig, resolveWorkspaceLinks } from '../config/index.js';

const VALID_TYPES = ['spec', 'knowhow', 'note', 'domain', 'issue', 'project', 'roadmap', 'session', 'scratch'] as const;
type LoadType = (typeof VALID_TYPES)[number];

let _indexer: WikiIndexer | null = null;
let _indexerRoot: string | null = null;

async function getIndexer(projectRoot?: string): Promise<WikiIndexer> {
  const root = resolve(projectRoot ?? '.');
  if (_indexer && _indexerRoot === root) return _indexer;
  if (_indexerRoot !== root) {
    _indexer = null;
    _indexerRoot = root;
  }
  const { WikiIndexer: Cls } = await import('#maestro-dashboard/wiki/wiki-indexer.js');
  const workflowRoot = resolve(root, '.workflow');
  const projectPath = root;
  const wsConfig = loadWorkspaceConfig(projectPath);
  const resolved = resolveWorkspaceLinks(projectPath, wsConfig);
  const linkedWorkspaces = resolved
    .filter(lw => lw.valid)
    .map(lw => ({ name: lw.name, workflowRoot: lw.workflowRoot, shareTypes: lw.share }));
  _indexer = new Cls({ workflowRoot, linkedWorkspaces, persistence: 'read-only' });
  return _indexer;
}

/** Shared indexer accessor for knowledge signal-id validation (K8). */
export async function getWikiIndexer(projectRoot?: string): Promise<WikiIndexer> {
  return getIndexer(projectRoot);
}

function matchesType(entry: WikiEntry, type: LoadType): boolean {
  if (type === 'session') return entry.category === 'session';
  if (type === 'scratch') return entry.category === 'scratch';
  return entry.type === type;
}

function displayType(e: WikiEntry): string {
  if (e.category === 'session') return 'session';
  if (e.category === 'scratch') return 'scratch';
  return e.type;
}

function formatEntry(e: WikiEntry): string {
  const badge = displayType(e);
  const catTag = e.category && e.category !== 'session' && e.category !== 'scratch'
    ? ` [${e.category}]` : '';
  const codePaths = Array.isArray(e.ext?.codePaths)
    ? `\n\n[codePaths: ${(e.ext.codePaths as string[]).join(', ')}]` : '';
  const editedFiles = Array.isArray(e.ext?.editedFiles) && (e.ext.editedFiles as string[]).length > 0
    ? `\n\n[editedFiles: ${(e.ext.editedFiles as string[]).join(', ')}]` : '';
  const related = e.related.length > 0
    ? `\n[related: ${e.related.join(', ')}]` : '';
  // KG codegraph stubs carry no body in the wiki index — point at the source
  // file so the caller can still reach the full text.
  const body = e.body || e.summary;
  const filePath = typeof e.ext?.filePath === 'string' && e.ext.filePath.length > 0
    && !e.body
    ? `\n\n→ 全文: ${e.ext.filePath}` : '';
  return `## [${badge}]${catTag} ${e.title}\n\n${body}${codePaths}${editedFiles}${filePath}${related}`;
}

const TYPE_PREFIXES = ['spec', 'knowhow', 'note', 'domain', 'issue', 'project', 'roadmap', 'session', 'scratch'] as const;

/**
 * Resolve an entry ID with tolerance: exact match first, then
 * case-insensitive, then with the `--type` prefix applied (e.g. `--id dcs-…`
 * matches `knowhow-dcs-…`). When no type is given (wiki load/get), all known
 * type prefixes are tried. Mirrors the lowercase canonical IDs produced by
 * knowhowFileToWikiId() so hand-typed IDs don't miss.
 */
export function findEntry(index: WikiIndex, rawId: string, type?: LoadType): WikiEntry | null {
  const exact = index.byId[rawId];
  if (exact) return exact;
  const lower = rawId.toLowerCase();
  const candidates: string[] = [lower];
  if (type) {
    if (type !== 'session' && type !== 'scratch' && !lower.startsWith(`${type}-`)) {
      candidates.push(`${type}-${lower}`);
    }
  } else {
    for (const t of TYPE_PREFIXES) {
      if (!lower.startsWith(`${t}-`)) candidates.push(`${t}-${lower}`);
    }
  }
  for (const candidate of candidates) {
    for (const e of index.entries) {
      if (e.id.toLowerCase() === candidate) return e;
    }
  }
  return null;
}

function formatListLine(e: WikiEntry): string {
  const badge = displayType(e);
  const catTag = e.category && e.category !== 'session' && e.category !== 'scratch'
    ? `  ${e.category}` : '';
  const date = e.updated.slice(0, 10);
  const title = truncate(e.title, 50);
  return `  [${badge}]${catTag}  ${e.id}  ${title}  (${date})`;
}

function entryToJson(e: WikiEntry, brief: boolean): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: e.id, type: e.type, title: e.title,
    category: e.category, updated: e.updated,
  };
  if (brief) {
    base.summary = e.summary;
    return base;
  }
  return {
    ...base,
    summary: e.summary, body: e.body,
    related: e.related,
    codePaths: e.ext?.codePaths ?? null,
    editedFiles: e.ext?.editedFiles ?? null,
  };
}

export async function recordLoadedKnowledge(entries: WikiEntry[]): Promise<void> {
  try {
    const { recordKnowledgeConsumptionsDetailed } = await import('../graph/kg/knowledge-usage.js');
    const result = recordKnowledgeConsumptionsDetailed(
      process.cwd(),
      entries.map(entry => ({ id: entry.id, sourceRef: entry.sourceRef })),
    );
    if (result.nodeIds.length === 0) return;
    // Resolve exact read-only authority before writing attribution. A live Run
    // channel must not be collapsed to its Session when several Runs are active.
    try {
      const { SessionStore } = await import('../run/store.js');
      const { findKnowledgeAttributionAuthority } = await import('../run/knowledge-identity.js');
      const store = new SessionStore(process.cwd());
      const authority = findKnowledgeAttributionAuthority(process.cwd(), store);
      if (authority?.kind === 'run') {
        const { recordRunKnowledgeInputs } = await import('../run/knowledge.js');
        recordRunKnowledgeInputs(
          process.cwd(),
          authority.runId,
          result.nodeIds,
          'consumed',
          'load',
          authority.sessionId,
        );
        return;
      }
      if (authority?.kind === 'session') {
        const { recordSessionKnowledgeInputs } = await import('../run/session-knowledge.js');
        recordSessionKnowledgeInputs(
          process.cwd(),
          authority.sessionId,
          result.nodeIds,
          'consumed',
          'load',
        );
        return;
      }
    } catch {
      // Attribution is best-effort; fall through to the ambiguity warning.
    }
    console.error(
      'Warning: knowledge consumption recorded in the global ledger, but run/session '
      + 'attribution was skipped (write authority is absent or ambiguous).',
    );
  } catch {
    // Usage analytics must never block knowledge loading.
  }
}

export function registerLoadCommand(program: Command): void {
  program
    .command('load')
    .description('Unified knowledge loading — specs, wiki, sessions')
    .requiredOption('--type <type>', `Entry type: ${VALID_TYPES.join(', ')}`)
    .option('--id <ids>', 'Load specific entries by ID (comma-separated)')
    .option('--category <cat>', 'Filter by category (e.g. coding, arch, debug, recipe)')
    .option('--keyword <word>', 'Filter entries by keyword in title/body')
    .option('--tag <tag>', 'Filter entries by exact tag match')
    .option('--list', 'List matching entries (compact, no body)')
    .option('--scope <scope>', 'Spec scope: project|global|team|personal (default: project)')
    .option('--limit <n>', 'Max entries (default: 20 for --list, 10 for load)', '')
    .option('--include-deprecated', 'Include deprecated/superseded entries')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const type = opts.type as LoadType;
      if (!VALID_TYPES.includes(type)) {
        console.error(`Error: --type must be one of ${VALID_TYPES.join(', ')}`);
        process.exit(1);
      }

      import('../hooks/spec-analytics.js').then(({ logCliEndpoint }) => {
        logCliEndpoint(process.cwd(), 'load', { type, category: opts.category, id: opts.id, list: opts.list });
      }).catch(() => {});

      const isList = opts.list === true;
      const includeDeprecated = opts.includeDeprecated === true;
      const ids: string[] = opts.id ? opts.id.split(',').map((s: string) => s.trim()).filter(Boolean) : [];

      // --type spec (non-list, no specific IDs): delegate to spec-loader
      if (type === 'spec' && !isList && ids.length === 0) {
        await loadBySpecCategory(opts);
        return;
      }

      const indexer = await getIndexer();
      const index = await indexer.get();
      const defaultLimit = isList ? 20 : 10;
      const parsedLimit = opts.limit ? Number.parseInt(opts.limit, 10) : defaultLimit;
      const limit = Math.max(1, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : defaultLimit, 500));
      let entries: WikiEntry[];

      if (ids.length > 0) {
        entries = ids
          .map(id => findEntry(index, id, type))
          .filter((e): e is WikiEntry => e !== null && (includeDeprecated || !isDeprecatedKnowledgeEntry(e)));
        const missing = ids.filter(id => {
          const entry = findEntry(index, id, type);
          return !entry || (!includeDeprecated && isDeprecatedKnowledgeEntry(entry));
        });
        if (missing.length > 0) {
          const suffix = includeDeprecated ? '' : ' (use --include-deprecated to load retired entries)';
          console.error(`Not found or deprecated: ${missing.join(', ')}${suffix}`);
        }
      } else {
        let pool = index.entries.filter(e =>
          matchesType(e, type) && (includeDeprecated || !isDeprecatedKnowledgeEntry(e))
        );

        if (opts.category) {
          pool = pool.filter(e => e.category === opts.category);
        }
        if (opts.keyword) {
          const kw = opts.keyword.toLowerCase();
          pool = pool.filter(e =>
            e.title.toLowerCase().includes(kw) ||
            e.body.toLowerCase().includes(kw),
          );
        }
        if (opts.tag) {
          const tag = opts.tag.toLowerCase();
          pool = pool.filter(e => e.tags.includes(tag));
        }

        if (type === 'session' || type === 'scratch') {
          pool.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
        } else {
          // Content-bearing entries (file-backed or kg nodes with body) sort
          // before empty stub projections so discovery views aren't flooded
          // by codegraph stubs; title order stays deterministic within groups.
          pool.sort((a, b) => {
            // Codegraph stubs carry no body — keep them after entries that
            // surface full text so discovery views aren't flooded by stubs.
            const aStub = !a.body;
            const bStub = !b.body;
            if (aStub !== bStub) return aStub ? 1 : -1;
            return a.title.localeCompare(b.title);
          });
        }

        entries = pool.slice(0, limit);
      }

      if (entries.length === 0) {
        console.error('No entries found.');
        return;
      }

      // Listing is discovery only. Returning full content is an explicit
      // consumption signal, regardless of whether output is text or JSON.
      if (!isList) await recordLoadedKnowledge(entries);

      if (opts.json) {
        console.log(JSON.stringify({
          totalLoaded: entries.length,
          entries: entries.map(e => entryToJson(e, isList)),
        }, null, 2));
        return;
      }

      if (isList) {
        console.log(`${type}: ${entries.length} entries`);
        for (const e of entries) console.log(formatListLine(e));
        return;
      }

      const sections = entries.map(formatEntry);
      console.log(`# Loaded ${entries.length} entries\n\n---\n\n${sections.join('\n\n---\n\n')}`);
    });
}

async function loadBySpecCategory(opts: Record<string, unknown>): Promise<void> {
  const { loadSpecs } = await import('../tools/spec-loader.js');
  const projectPath = process.cwd();
  const wsConfig = loadWorkspaceConfig(projectPath);
  const resolved = resolveWorkspaceLinks(projectPath, wsConfig);
  const linkedSpecs = resolved
    .filter(lw => lw.valid && lw.share.includes('spec'))
    .map(lw => ({ name: lw.name, specsDir: join(lw.workflowRoot, 'specs') }));
  const loaderOpts = {
    ...(linkedSpecs.length > 0 ? { linkedWorkspaces: linkedSpecs } : {}),
    includeDeprecated: opts.includeDeprecated === true,
  };

  const scope = (opts.scope as string | undefined) ?? 'project';
  const keyword = opts.keyword as string | undefined;
  const category = opts.category as import('../tools/spec-loader.js').SpecCategory | undefined;
  const result = loadSpecs(projectPath, category, undefined, keyword, scope as import('../tools/spec-loader.js').SpecScope, loaderOpts);

  if (opts.json) {
    console.log(JSON.stringify({
      totalLoaded: result.totalLoaded,
      specs: result.matchedSpecs,
      content: result.content,
    }, null, 2));
  } else {
    console.log(result.content || '(No specs found)');
  }
}
