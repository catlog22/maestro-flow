/**
 * Load Command — Unified knowledge loading (specs, wiki, sessions).
 *
 * Replaces separate `spec load` and `wiki load` as the primary entry point.
 *   maestro load <ids...>             — by wiki ID
 *   maestro load --category coding    — specs by category
 *   maestro load --type session       — recent sessions
 *   maestro load --type knowhow       — knowhow entries
 */

import type { Command } from 'commander';
import { resolve, join } from 'node:path';

import { WikiIndexer } from '#maestro-dashboard/wiki/wiki-indexer.js';
import type { WikiEntry } from '#maestro-dashboard/wiki/wiki-types.js';
import { loadWorkspaceConfig, resolveWorkspaceLinks } from '../config/index.js';

// Types accepted by --type (including virtual aliases)
const VALID_TYPES = ['spec', 'knowhow', 'note', 'domain', 'issue', 'project', 'roadmap', 'session', 'scratch'] as const;
type LoadType = (typeof VALID_TYPES)[number];

let _indexer: WikiIndexer | null = null;

function getIndexer(): WikiIndexer {
  if (!_indexer) {
    const workflowRoot = resolve('.workflow');
    const projectPath = process.cwd();
    const wsConfig = loadWorkspaceConfig(projectPath);
    const resolved = resolveWorkspaceLinks(projectPath, wsConfig);
    const linkedWorkspaces = resolved
      .filter(lw => lw.valid)
      .map(lw => ({ name: lw.name, workflowRoot: lw.workflowRoot, shareTypes: lw.share }));
    _indexer = new WikiIndexer({ workflowRoot, linkedWorkspaces });
  }
  return _indexer;
}

function matchesTypeFilter(entry: WikiEntry, type: LoadType): boolean {
  if (type === 'session') return entry.category === 'session';
  if (type === 'scratch') return entry.category === 'scratch';
  return entry.type === type;
}

function formatEntry(e: WikiEntry): string {
  const typeBadge = e.category === 'session' ? 'session'
    : e.category === 'scratch' ? 'scratch'
    : e.type;
  const catTag = e.category && e.category !== 'session' && e.category !== 'scratch'
    ? ` [${e.category}]` : '';
  const codePaths = Array.isArray(e.ext?.codePaths)
    ? `\n\n[codePaths: ${(e.ext.codePaths as string[]).join(', ')}]` : '';
  const editedFiles = Array.isArray(e.ext?.editedFiles) && (e.ext.editedFiles as string[]).length > 0
    ? `\n\n[editedFiles: ${(e.ext.editedFiles as string[]).join(', ')}]` : '';
  const related = e.related.length > 0
    ? `\n[related: ${e.related.join(', ')}]` : '';
  return `## [${typeBadge}]${catTag} ${e.title}\n\n${e.body || e.summary}${codePaths}${editedFiles}${related}`;
}

function entryToJson(e: WikiEntry): Record<string, unknown> {
  return {
    id: e.id,
    type: e.type,
    title: e.title,
    summary: e.summary,
    body: e.body,
    category: e.category,
    related: e.related,
    codePaths: e.ext?.codePaths ?? null,
    editedFiles: e.ext?.editedFiles ?? null,
    updated: e.updated,
  };
}

export function registerLoadCommand(program: Command): void {
  program
    .command('load [ids...]')
    .description('Unified knowledge loading — specs, wiki, sessions')
    .option('--type <type>', `Filter by type: ${VALID_TYPES.join(', ')}`)
    .option('--category <cat>', 'Filter by category (e.g. coding, arch, debug, session, recipe)')
    .option('--keyword <word>', 'Filter entries by keyword in title/body')
    .option('--scope <scope>', 'Spec scope: project|global|team|personal (default: project)')
    .option('--limit <n>', 'Max entries to load (default: 10 for type filter, unlimited for IDs)', '10')
    .option('--json', 'Output as JSON')
    .action(async (ids: string[], opts) => {
      const hasIds = ids.length > 0;
      const hasFilters = opts.type || opts.category;

      if (!hasIds && !hasFilters) {
        console.error('Usage: maestro load <ids...> or maestro load --type <type> [--category <cat>]');
        process.exit(1);
      }

      // spec category shortcut: --category coding → use spec-loader
      if (!hasIds && opts.category && !opts.type) {
        await loadBySpecCategory(opts);
        return;
      }

      const indexer = getIndexer();
      const index = await indexer.get();
      let entries: WikiEntry[];

      if (hasIds) {
        entries = ids
          .map(id => index.byId[id])
          .filter((e): e is WikiEntry => Boolean(e));
        const missing = ids.filter(id => !index.byId[id]);
        if (missing.length > 0) {
          console.error(`Not found: ${missing.join(', ')}`);
        }
      } else {
        const limit = parseInt(opts.limit, 10) || 10;
        let pool = index.entries;

        if (opts.type) {
          const type = opts.type as LoadType;
          if (!VALID_TYPES.includes(type)) {
            console.error(`Error: --type must be one of ${VALID_TYPES.join(', ')}`);
            process.exit(1);
          }
          pool = pool.filter(e => matchesTypeFilter(e, type));
        }

        if (opts.category) {
          pool = pool.filter(e => e.category === opts.category);
        }

        if (opts.keyword) {
          const kw = opts.keyword.toLowerCase();
          pool = pool.filter(e =>
            e.title.toLowerCase().includes(kw) ||
            e.body.toLowerCase().includes(kw) ||
            e.tags.some(t => t.toLowerCase().includes(kw)),
          );
        }

        // Sort by updated date (newest first) for session/scratch; by title for others
        const type = opts.type as LoadType | undefined;
        if (type === 'session' || type === 'scratch') {
          pool.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
        } else {
          pool.sort((a, b) => a.title.localeCompare(b.title));
        }

        entries = pool.slice(0, limit);
      }

      if (entries.length === 0) {
        console.error('No entries found.');
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify({
          totalLoaded: entries.length,
          entries: entries.map(entryToJson),
        }, null, 2));
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
  const loaderOpts = linkedSpecs.length > 0 ? { linkedWorkspaces: linkedSpecs } : undefined;

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
