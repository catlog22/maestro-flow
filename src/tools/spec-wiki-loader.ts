import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { lstat, readFile, readdir, stat } from 'node:fs/promises';

import type { WikiEntry, WikiScope } from '#maestro-dashboard/wiki/wiki-types.js';
import type { RepositoryContext } from '../repository/context.js';
import {
  normalizeCanonicalKnowledgeContent,
  parseFrontmatter,
  slugify,
} from '../utils/frontmatter.js';

interface SpecScopeConfig {
  dir: string;
  allowedRoot: string;
  scope: WikiScope;
  idPrefix: string;
  sourcePrefix: string;
}

async function specScopes(repository: RepositoryContext): Promise<SpecScopeConfig[]> {
  const workflowRoot = repository.workflowRoot;
  const maestroHome = process.env.MAESTRO_HOME ?? join(homedir(), '.maestro');
  const scopes: SpecScopeConfig[] = [
    {
      dir: join(maestroHome, 'specs'),
      allowedRoot: join(maestroHome, 'specs'),
      scope: 'global',
      idPrefix: 'spec:global:',
      sourcePrefix: '~/.maestro/specs/',
    },
    {
      dir: join(workflowRoot, 'specs'),
      allowedRoot: workflowRoot,
      scope: 'project',
      idPrefix: 'spec:project:',
      sourcePrefix: 'specs/',
    },
    {
      dir: join(workflowRoot, 'collab', 'specs'),
      allowedRoot: workflowRoot,
      scope: 'team',
      idPrefix: 'spec:team:',
      sourcePrefix: 'collab/specs/',
    },
  ];

  const personalRoot = join(workflowRoot, 'collab', 'specs');
  try {
    const entries = await readdir(personalRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      scopes.push({
        dir: join(personalRoot, entry.name),
        allowedRoot: workflowRoot,
        scope: 'personal',
        idPrefix: `spec:personal:${entry.name}:`,
        sourcePrefix: `collab/specs/${entry.name}/`,
      });
    }
  } catch {
    // Optional scope.
  }
  return scopes;
}

function applyRepositoryOrigin(entry: WikiEntry, repository: RepositoryContext): WikiEntry {
  const workspaceFence = repository.repoId ? `repo:${repository.repoId}` : undefined;
  entry.repoId = repository.repoId;
  entry.repoName = repository.repoName;
  entry.alias = repository.alias;
  entry.workspaceFence = workspaceFence;
  entry.source.repoId = repository.repoId;
  entry.source.repoName = repository.repoName;
  entry.source.alias = repository.alias;
  if (workspaceFence) entry.source.workspaceFence = workspaceFence;
  return entry;
}

/**
 * Load file-backed spec entries without importing or rebuilding WikiIndexer.
 * The returned projection intentionally matches WikiIndexer's spec IDs and
 * lifecycle metadata so the load command can retain its existing filters.
 */
export async function loadSpecWikiEntries(repository: RepositoryContext): Promise<WikiEntry[]> {
  const [scopes, { parseSpecEntries }, { resolveAllowedSourcePath }] = await Promise.all([
    specScopes(repository),
    import('#maestro-dashboard/wiki/spec-entry-parser.js'),
    import('#maestro-dashboard/wiki/source-path.js'),
  ]);
  const out: WikiEntry[] = [];

  for (const { dir, allowedRoot, scope, idPrefix, sourcePrefix } of scopes) {
    let names: string[];
    try { names = await readdir(dir); } catch { continue; }
    const batches = await Promise.all(names
      .filter(name => extname(name).toLowerCase() === '.md')
      .map(async name => {
        const path = resolveAllowedSourcePath(join(dir, name), allowedRoot, 'file');
        if (!path) return [] as WikiEntry[];
        try {
          const info = await lstat(path);
          if (!info.isFile() || info.isSymbolicLink()) return [] as WikiEntry[];
          const [raw, timestamps] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
          const { data, body } = parseFrontmatter(raw);
          const stem = basename(name, extname(name));
          const parentId = `${idPrefix}${slugify(stem)}`;
          const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
          const normalized = normalizeCanonicalKnowledgeContent({
            ...data,
            title: typeof data.title === 'string' ? data.title : heading ?? stem,
            content: body,
          });
          const created = new Date(timestamps.birthtimeMs || timestamps.mtimeMs).toISOString();
          const updated = new Date(timestamps.mtimeMs).toISOString();
          const source = {
            kind: 'file' as const,
            path: `${sourcePrefix}${name}`,
          };
          const container = applyRepositoryOrigin({
            id: parentId,
            type: 'spec',
            title: normalized.title,
            summary: normalized.summary,
            tags: normalized.keywords,
            status: normalized.lifecycleStatus,
            created,
            updated,
            related: [],
            source,
            body,
            ext: {},
            scope,
            category: normalized.category,
            specCategory: normalized.category,
            createdBy: typeof data.createdBy === 'string' ? data.createdBy : null,
            sourceRef: normalized.sourceRef,
            parent: null,
            appliesToRepoIds: normalized.appliesToRepoIds.length > 0
              ? normalized.appliesToRepoIds
              : undefined,
          }, repository);

          const entries = parseSpecEntries(body, name, data).map(spec => {
            const related: string[] = [];
            if (spec.ref) {
              const refStem = spec.ref.replace(/^knowhow\//, '').replace(/\.md$/, '');
              related.push(`knowhow-${slugify(refStem)}`);
            }
            return applyRepositoryOrigin({
              id: `${idPrefix}${spec.id}`,
              type: 'spec',
              title: spec.title,
              summary: spec.description || spec.content.slice(0, 240).replace(/\s+/g, ' '),
              tags: spec.keywords,
              status: spec.lifecycleStatus ?? 'active',
              created,
              updated,
              related,
              source: { ...source },
              body: spec.content,
              ext: {
                entryType: spec.type,
                timestamp: spec.timestamp,
                ...(spec.ref ? { ref: spec.ref } : {}),
                ...(spec.confidence ? { confidence: spec.confidence } : {}),
                ...(spec.conflictNote ? { conflictNote: spec.conflictNote } : {}),
                ...(spec.lifecycleStatus ? { lifecycleStatus: spec.lifecycleStatus } : {}),
                ...(spec.status ? { status: spec.status } : {}),
                ...(spec.relatedPaths ? { relatedPaths: spec.relatedPaths } : {}),
                ...(spec.appliesToRepoIds ? { appliesToRepoIds: spec.appliesToRepoIds } : {}),
                ...(spec.language ? { language: spec.language } : {}),
                ...(spec.decisionState ? { decisionState: spec.decisionState } : {}),
                ...(spec.supersededBy ? { supersededBy: spec.supersededBy } : {}),
                ...(spec.sid ? { sid: spec.sid } : {}),
                ...(spec.supersedes ? { supersedes: spec.supersedes } : {}),
              },
              scope,
              category: spec.category || normalized.category,
              specCategory: normalized.category,
              createdBy: container.createdBy,
              sourceRef: spec.sourceRef ?? container.sourceRef,
              parent: parentId,
              appliesToRepoIds: spec.appliesToRepoIds ?? container.appliesToRepoIds,
            }, repository);
          });
          return [container, ...entries];
        } catch {
          return [] as WikiEntry[];
        }
      }));
    for (const entries of batches) out.push(...entries);
  }

  return out;
}
