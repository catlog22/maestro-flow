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
import type { WikiIndexer } from '#maestro-dashboard/wiki/wiki-indexer.js';
import type { WikiEntry } from '#maestro-dashboard/wiki/wiki-types.js';
import { loadWorkspaceConfig, resolveWorkspaceLinks } from '../config/index.js';

const VALID_TYPES = ['spec', 'knowhow', 'note', 'domain', 'issue', 'project', 'roadmap', 'session', 'scratch'] as const;
type LoadType = (typeof VALID_TYPES)[number];

let _indexer: WikiIndexer | null = null;

async function getIndexer(): Promise<WikiIndexer> {
  if (!_indexer) {
    const { WikiIndexer: Cls } = await import('#maestro-dashboard/wiki/wiki-indexer.js');
    const workflowRoot = resolve('.workflow');
    const projectPath = process.cwd();
    const wsConfig = loadWorkspaceConfig(projectPath);
    const resolved = resolveWorkspaceLinks(projectPath, wsConfig);
    const linkedWorkspaces = resolved
      .filter(lw => lw.valid)
      .map(lw => ({ name: lw.name, workflowRoot: lw.workflowRoot, shareTypes: lw.share }));
    _indexer = new Cls({ workflowRoot, linkedWorkspaces });
  }
  return _indexer;
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
  return `## [${badge}]${catTag} ${e.title}\n\n${e.body || e.summary}${codePaths}${editedFiles}${related}`;
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

export function registerLoadCommand(program: Command): void {
  program
    .command('load')
    .description('Unified knowledge loading — specs, wiki, sessions')
    .requiredOption('--type <type>', `Entry type: ${VALID_TYPES.join(', ')}`)
    .option('--id <ids>', 'Load specific entries by ID (comma-separated)')
    .option('--category <cat>', 'Filter by category (e.g. coding, arch, debug, recipe)')
    .option('--keyword <word>', 'Filter entries by keyword in title/body')
    .option('--list', 'List matching entries (compact, no body)')
    .option('--scope <scope>', 'Spec scope: project|global|team|personal (default: project)')
    .option('--limit <n>', 'Max entries (default: 20 for --list, 10 for load)', '')
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
      const ids: string[] = opts.id ? opts.id.split(',').map((s: string) => s.trim()).filter(Boolean) : [];

      // --type spec (non-list, no specific IDs): delegate to spec-loader
      if (type === 'spec' && !isList && ids.length === 0) {
        await loadBySpecCategory(opts);
        return;
      }

      const indexer = await getIndexer();
      const index = await indexer.get();
      const defaultLimit = isList ? 20 : 10;
      const limit = opts.limit ? parseInt(opts.limit, 10) : defaultLimit;
      let entries: WikiEntry[];

      if (ids.length > 0) {
        entries = ids
          .map(id => index.byId[id])
          .filter((e): e is WikiEntry => Boolean(e));
        const missing = ids.filter(id => !index.byId[id]);
        if (missing.length > 0) console.error(`Not found: ${missing.join(', ')}`);
      } else {
        let pool = index.entries.filter(e => matchesType(e, type));

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
