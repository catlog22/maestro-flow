/**
 * Spec Command — CLI endpoint for project spec management
 *
 * Subcommands: load, list, init, status
 */

import { Option, type Command } from 'commander';

const VALID_SCOPES = ['project', 'global', 'team', 'personal'] as const;
const SCOPE_LABELS: Record<string, string> = {
  project: 'Project specs',
  global: 'Global specs',
  team: 'Team specs',
  personal: 'Personal specs',
};

/** Resolve uid for scopes that need it (personal). */
async function resolveUid(opts: { uid?: string }): Promise<string | undefined> {
  if (opts.uid) return opts.uid;
  try {
    const { resolveSelf } = await import('../tools/team-members.js');
    const self = resolveSelf();
    return self?.uid;
  } catch {
    return undefined;
  }
}

function validateScope(value: string | undefined): import('../tools/spec-loader.js').SpecScope {
  if (!value) return 'project';
  if (!VALID_SCOPES.includes(value as typeof VALID_SCOPES[number])) {
    console.error(`Error: --scope must be one of ${VALID_SCOPES.join(', ')} (got "${value}")`);
    process.exit(1);
  }
  return value as import('../tools/spec-loader.js').SpecScope;
}

export function registerSpecCommand(program: Command): void {
  const spec = program
    .command('spec')
    .description('Project spec management (init, load, list, status)');

  // ── load ──────────────────────────────────────────────────────────────
  spec
    .command('load')
    .description('Load specs by category')
    .option('--category <cat>', 'Filter by category: coding|arch|debug|test|review|learning|ui')
    .option('--keyword <word>', 'Filter entries by keyword')
    .option('--scope <scope>', 'Spec scope: project|global|team|personal (default: project)')
    .option('--uid <uid>', 'User id for personal scope (auto-detected from git if omitted)')
    .option('--stdin', 'Read input from stdin (Hook mode)')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const { logCliEndpoint } = await import('../hooks/spec-analytics.js');
      const { loadSpecs } = await import('../tools/spec-loader.js');
      const { loadWorkspaceConfig, resolveWorkspaceLinks } = await import('../config/index.js');
      const { join } = await import('node:path');
      logCliEndpoint(process.cwd(), 'spec load', { category: opts.category, scope: opts.scope, keyword: opts.keyword, stdin: !!opts.stdin });

      let projectPath = process.cwd();
      let keyword = opts.keyword as string | undefined;

      if (opts.stdin) {
        try {
          const raw = await readStdin();
          if (raw) {
            const stdinData = JSON.parse(raw);
            if (stdinData?.cwd && typeof stdinData.cwd === 'string') {
              projectPath = stdinData.cwd;
            }
            if (stdinData?.keyword && typeof stdinData.keyword === 'string') {
              keyword = stdinData.keyword;
            }
          }
        } catch {
          process.stdout.write(JSON.stringify({ continue: true }));
          process.exit(0);
        }
      }

      const scope = validateScope(opts.scope);
      const uid = await resolveUid(opts);

      if (scope === 'personal' && !uid) {
        console.error('Error: personal scope requires --uid or team membership (maestro collab join).');
        process.exit(1);
      }

      const wsConfig = loadWorkspaceConfig(projectPath);
      const resolved = resolveWorkspaceLinks(projectPath, wsConfig);
      const linkedSpecs = resolved
        .filter(lw => lw.valid && lw.share.includes('spec'))
        .map(lw => ({ name: lw.name, specsDir: join(lw.workflowRoot, 'specs') }));
      const loaderOpts = linkedSpecs.length > 0 ? { linkedWorkspaces: linkedSpecs } : undefined;
      const result = loadSpecs(projectPath, opts.category, uid, keyword, scope, loaderOpts);

      if (opts.stdin) {
        if (result.content) {
          const wrapped = `<project-specs>\n${result.content}\n</project-specs>`;
          process.stdout.write(JSON.stringify({ continue: true, systemMessage: wrapped }));
        } else {
          process.stdout.write(JSON.stringify({ continue: true }));
        }
        process.exit(0);
      }

      if (opts.json) {
        console.log(JSON.stringify({
          specs: result.matchedSpecs,
          totalLoaded: result.totalLoaded,
          content: result.content,
        }, null, 2));
      } else {
        console.log(result.content || '(No specs found)');
      }
    });

  // ── list ──────────────────────────────────────────────────────────────
  spec
    .command('list')
    .alias('ls')
    .description('List spec files (all scopes by default)')
    .option('--scope <scope>', 'Spec scope: project|global|team|personal (omit for all)')
    .option('--uid <uid>', 'User id for personal scope')
    .action(async (opts) => {
      const { logCliEndpoint } = await import('../hooks/spec-analytics.js');
      logCliEndpoint(process.cwd(), 'spec list', { scope: opts.scope });
      const { existsSync, readdirSync, readFileSync: readFs } = await import('node:fs');
      const { join: pathJoin } = await import('node:path');
      const { resolveSpecDir } = await import('../tools/spec-loader.js');
      const { parseSpecEntries: parseEntries } = await import('../tools/spec-entry-parser.js');

      const uid = await resolveUid(opts);

      const printFileEntries = (specsDir: string, file: string) => {
        try {
          const raw = readFs(pathJoin(specsDir, file), 'utf-8');
          const { entries } = parseEntries(raw);
          if (entries.length === 0) {
            console.log(`  ${file}`);
          } else {
            console.log(`  ${file} (${entries.length} entries)`);
            for (const e of entries) {
              let label = e.title || e.content.replace(/\n/g, ' ').trim();
              if (label.length > 50) label = label.slice(0, 50) + '...';
              console.log(`    L${String(e.lineStart).padEnd(4)} ${label}`);
            }
          }
        } catch {
          console.log(`  ${file}`);
        }
      };

      // When --scope is explicitly given, show that scope only
      if (opts.scope) {
        const scope = validateScope(opts.scope);
        if (scope === 'personal' && !uid) {
          console.error('Error: personal scope requires --uid or team membership.');
          process.exit(1);
        }

        const specsDir = resolveSpecDir(process.cwd(), scope, uid);
        const label = SCOPE_LABELS[scope];

        if (!existsSync(specsDir)) {
          console.log(`No ${label.toLowerCase()} directory. Run "maestro spec init --scope ${scope}" to create.`);
          return;
        }

        const files = readdirSync(specsDir).filter(f => f.endsWith('.md'));
        if (files.length === 0) {
          console.log(`No ${label.toLowerCase()} files found.`);
          return;
        }

        console.log(`${label} (${files.length} files)  [${specsDir}]\n`);
        for (const file of files) printFileEntries(specsDir, file);
        return;
      }

      // No --scope: show overview of all scopes
      const scopesToShow: Array<typeof VALID_SCOPES[number]> = ['global', 'project', 'team'];
      let totalFiles = 0;

      for (const scope of scopesToShow) {
        const specsDir = resolveSpecDir(process.cwd(), scope);
        const label = SCOPE_LABELS[scope];
        const exists = existsSync(specsDir);

        if (!exists) {
          console.log(`${label}: (not initialized)`);
          console.log('');
          continue;
        }

        const files = readdirSync(specsDir).filter((f: string) => f.endsWith('.md'));
        totalFiles += files.length;

        if (files.length === 0) {
          console.log(`${label}: (empty)  [${specsDir}]`);
        } else {
          console.log(`${label} (${files.length} files)  [${specsDir}]`);
          for (const file of files) printFileEntries(specsDir, file);
        }
        console.log('');
      }

      if (totalFiles === 0) {
        console.log('No spec files found in any scope. Run "maestro spec init" to initialize.');
      }
    });

  // ── search ────────────────────────────────────────────────────────────
  spec
    .command('search <query...>')
    .description('Search spec entries by keyword or text')
    .option('--scope <scope>', 'Spec scope: project|global|team|personal (omit for all)')
    .option('--uid <uid>', 'User id for personal scope')
    .option('--json', 'Output as JSON')
    .action(async (queryParts: string[], opts) => {
      console.warn('[deprecated] Use "maestro search --type spec" instead');
      const q = queryParts.join(' ');
      const { runUnifiedSearch } = await import('./search.js');
      const results = await runUnifiedSearch(q, { type: 'spec', limit: 20 });

      if (opts.json) {
        console.log(JSON.stringify({ query: q, count: results.length, results }, null, 2));
        return;
      }

      console.log(`Found ${results.length} entries matching "${q}"`);
      for (const r of results) {
        const cat = r.category ? `[${r.category}] ` : '';
        const path = r.source?.path ? `${r.source.path}  ` : '';
        console.log(`  ${cat}${path}${r.id}  ${r.title}`);
        if (r.snippet) {
          console.log(`    ${r.snippet}`);
        } else if (r.summary) {
          console.log(`    ${r.summary}`);
        }
      }
    });

  // ── init ──────────────────────────────────────────────────────────────
  spec
    .command('init')
    .description('Initialize spec system with seed documents')
    .option('--scope <scope>', 'Spec scope: project|global|team|personal (default: project)')
    .option('--uid <uid>', 'User id for personal scope')
    .action(async (opts) => {
      const { logCliEndpoint } = await import('../hooks/spec-analytics.js');
      logCliEndpoint(process.cwd(), 'spec init', { scope: opts.scope });
      const { initSpecSystem } = await import('../tools/spec-init.js');

      const scope = validateScope(opts.scope);
      const uid = await resolveUid(opts);

      if (scope === 'personal' && !uid) {
        console.error('Error: personal scope requires --uid or team membership.');
        process.exit(1);
      }

      const label = SCOPE_LABELS[scope];
      console.log(`Initializing ${label.toLowerCase()}...`);
      const result = initSpecSystem(process.cwd(), scope, uid);

      if (result.directories.length > 0) {
        console.log('\nDirectories created:');
        for (const dir of result.directories) console.log(`  + ${dir}`);
      }

      if (result.created.length > 0) {
        console.log('\nSeed files created:');
        for (const file of result.created) console.log(`  + ${file}`);
      }

      if (result.migrated.length > 0) {
        console.log('\nFrontmatter added (migrated):');
        for (const file of result.migrated) console.log(`  ~ ${file}`);
      }

      if (result.skipped.length > 0) {
        console.log('\nSkipped (already exist):');
        for (const file of result.skipped) console.log(`  - ${file}`);
      }

      if (
        result.directories.length === 0 &&
        result.created.length === 0 &&
        result.migrated.length === 0
      ) {
        console.log('\nSpec system already initialized. No changes made.');
      }
    });

  // ── status ────────────────────────────────────────────────────────────
  spec
    .command('status')
    .description('Show spec system status (all scopes by default)')
    .option('--scope <scope>', 'Spec scope: project|global|team|personal (omit for all)')
    .option('--uid <uid>', 'User id for personal scope')
    .action(async (opts) => {
      const { logCliEndpoint } = await import('../hooks/spec-analytics.js');
      logCliEndpoint(process.cwd(), 'spec status', { scope: opts.scope });
      const { existsSync, readdirSync, readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { resolveSpecDir } = await import('../tools/spec-loader.js');

      const uid = await resolveUid(opts);

      const printScopeStatus = (scope: typeof VALID_SCOPES[number], specsDir: string) => {
        const label = SCOPE_LABELS[scope];
        const dirExists = existsSync(specsDir);

        if (!dirExists) {
          console.log(`${label}: not initialized`);
          console.log(`  Run "maestro spec init --scope ${scope}" to initialize.`);
          return;
        }

        const files = readdirSync(specsDir).filter((f: string) => f.endsWith('.md'));
        console.log(`${label} (${files.length} files)  [${specsDir}]`);

        for (const file of files) {
          const size = readFileSync(join(specsDir, file), 'utf-8').length;
          console.log(`    ${file}  (${size} chars)`);
        }
      };

      // When --scope is explicitly given, show that scope only
      if (opts.scope) {
        const scope = validateScope(opts.scope);
        if (scope === 'personal' && !uid) {
          console.error('Error: personal scope requires --uid or team membership.');
          process.exit(1);
        }
        console.log('Spec System Status\n');
        printScopeStatus(scope, resolveSpecDir(process.cwd(), scope, uid));
        return;
      }

      // No --scope: show all scopes
      console.log('Spec System Status\n');
      const scopesToShow: Array<typeof VALID_SCOPES[number]> = ['global', 'project', 'team'];
      for (const scope of scopesToShow) {
        printScopeStatus(scope, resolveSpecDir(process.cwd(), scope));
        console.log('');
      }
    });

  // ── add ──────────────────────────────────────────────────────────────
  spec
    .command('add')
    .description('Add a spec entry to the appropriate file')
    .argument('<category>', 'Entry category: coding|arch|debug|test|review|learning')
    .argument('<title>', 'Entry title')
    .argument('[content]', 'Entry content (if omitted, reads from remaining args)')
    .option('--keywords <words>', 'Comma-separated keywords')
    .option('--description <desc>', 'One-line description for search results')
    .option('--source <source>', 'Source reference (e.g., analyze:ANL-xxx)')
    .option('--ref <path>', 'Create as index entry referencing a knowhow document')
    .option('--knowhow-type <type>', 'Knowhow type for --ref (asset, blueprint, document, template, etc.)')
    .option('--scope <scope>', 'Spec scope: project|global|team|personal (default: project)')
    .option('--uid <uid>', 'User id for personal scope')
    .option('--stdin', 'Read JSON array from stdin: [{category,title,content,keywords}]')
    .option('--json', 'Output result as JSON')
    .action(async (category: string, title: string, content: string | undefined, opts: Record<string, unknown>) => {
      const { logCliEndpoint } = await import('../hooks/spec-analytics.js');
      logCliEndpoint(process.cwd(), 'spec add', { category, scope: opts.scope, keywords: opts.keywords, stdin: !!opts.stdin });
      const { appendSpecEntry } = await import('../tools/spec-writer.js');
      const { VALID_CATEGORIES } = await import('../tools/spec-entry-parser.js');

      // ── stdin batch mode ───────────────────────────────────────────
      if (opts.stdin) {
        const raw = await readStdin();
        if (!raw) {
          console.error('Error: --stdin specified but no input received.');
          process.exit(1);
        }

        let items: Array<{ category: string; title: string; content: string; keywords?: string[] | string; source?: string }>;
        try {
          items = JSON.parse(raw);
        } catch {
          console.error('Error: invalid JSON on stdin.');
          process.exit(1);
        }

        if (!Array.isArray(items)) {
          console.error('Error: stdin must be a JSON array.');
          process.exit(1);
        }

        const scope = validateScope(opts.scope as string | undefined);
        const uid = await resolveUid(opts as { uid?: string });

        if (scope === 'personal' && !uid) {
          console.error('Error: personal scope requires --uid or team membership.');
          process.exit(1);
        }

        const results = items.map(item => {
          const kw = Array.isArray(item.keywords)
            ? item.keywords
            : typeof item.keywords === 'string'
              ? item.keywords.split(',').map((k: string) => k.trim()).filter(Boolean)
              : [];
          return appendSpecEntry(process.cwd(), item.category as import('../tools/spec-loader.js').SpecCategory, item.title, item.content || '', kw, item.source, scope, uid);
        });

        if (opts.json) {
          console.log(JSON.stringify(results, null, 2));
        } else {
          for (const r of results) {
            if (r.duplicate) {
              console.log(`\u26A0 Skipped duplicate: "${r.title}" already exists in ${r.file}`);
            } else if (r.ok) {
              console.log(`\u2713 Added to ${r.file} [${r.category}] "${r.title}"`);
            } else {
              console.error(`Error: failed to add "${r.title}"`);
            }
          }
        }
        return;
      }

      // ── single entry mode ─────────────────────────────────────────
      if (!VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number])) {
        console.error(`Error: category must be one of ${VALID_CATEGORIES.join(', ')} (got "${category}")`);
        process.exit(1);
      }

      const scope = validateScope(opts.scope as string | undefined);
      const uid = await resolveUid(opts as { uid?: string });

      if (scope === 'personal' && !uid) {
        console.error('Error: personal scope requires --uid or team membership.');
        process.exit(1);
      }

      const keywords = typeof opts.keywords === 'string'
        ? opts.keywords.split(',').map((k: string) => k.trim()).filter(Boolean)
        : [];

      // ── --ref mode: create index entry referencing a knowhow document ──
      const refPath = opts.ref as string | undefined;
      if (refPath) {
        const { existsSync: fileExists, mkdirSync: mkDir, writeFileSync: writeFs, readFileSync: readFs } = await import('node:fs');
        const { join: pathJoin, resolve: pathResolve } = await import('node:path');

        const knowhowType = (opts.knowhowType ?? opts['knowhow-type']) as string | undefined;
        const absRefPath = pathResolve(process.cwd(), '.workflow', refPath);

        // If ref file doesn't exist AND --knowhow-type given → create knowhow doc first
        if (!fileExists(absRefPath) && knowhowType) {
          const { KNOWHOW_PREFIX_MAP } = await import('../utils/frontmatter.js');
          const prefix = KNOWHOW_PREFIX_MAP[knowhowType] ?? 'DOC';
          const dir = pathJoin(process.cwd(), '.workflow', 'knowhow');
          if (!fileExists(dir)) mkDir(dir, { recursive: true });

          const { escapeYamlValue } = await import('../utils/frontmatter.js');
          const now = new Date();
          const fmLines = ['---', `title: ${escapeYamlValue(title)}`, `type: ${knowhowType}`, `category: ${category}`, `created: ${now.toISOString()}`];
          if (keywords.length > 0) {
            fmLines.push('keywords:');
            for (const t of keywords) fmLines.push(`  - ${t}`);
          }
          fmLines.push('---', '', content || '');
          writeFs(absRefPath, fmLines.join('\n'), 'utf-8');
          console.log(`Created knowhow doc: ${refPath}`);
        } else if (!fileExists(absRefPath) && !knowhowType) {
          console.error(`Error: ref path "${refPath}" does not exist. Use --knowhow-type to create it.`);
          process.exit(1);
        }

        // Create spec index entry with summary (first ~200 chars)
        let summary = content || '';
        if (!summary && fileExists(absRefPath)) {
          const raw = readFs(absRefPath, 'utf-8');
          // Strip frontmatter
          const trimmed = raw.trimStart();
          if (trimmed.startsWith('---')) {
            const endIdx = trimmed.indexOf('\n---', 3);
            summary = endIdx !== -1 ? trimmed.substring(endIdx + 4).trim() : raw;
          } else {
            summary = raw;
          }
        }
        summary = summary.slice(0, 200).replace(/\s+/g, ' ').trim();

        const { appendSpecEntryWithRef } = await import('../tools/spec-writer.js');
        const result = appendSpecEntryWithRef(
          process.cwd(),
          category as import('../tools/spec-loader.js').SpecCategory,
          title,
          summary,
          keywords,
          refPath,
          opts.source as string | undefined,
          scope,
          uid,
        );

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.duplicate) {
          console.log(`\u26A0 Skipped duplicate: "${result.title}" already exists in ${result.file}`);
        } else if (result.ok) {
          console.log(`\u2713 Added ref entry to ${result.file} [${result.category}] "${result.title}" → ${refPath}`);
        } else {
          console.error(`Error: failed to add "${result.title}"`);
          process.exit(1);
        }
        return;
      }

      const result = appendSpecEntry(
        process.cwd(),
        category as import('../tools/spec-loader.js').SpecCategory,
        title,
        content || '',
        keywords,
        opts.source as string | undefined,
        scope,
        uid,
        opts.description as string | undefined,
      );

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.duplicate) {
        console.log(`\u26A0 Skipped duplicate: "${result.title}" already exists in ${result.file}`);
      } else if (result.ok) {
        console.log(`\u2713 Added to ${result.file} [${result.category}] "${result.title}"`);
      } else {
        console.error(`Error: failed to add "${result.title}"`);
        process.exit(1);
      }
    });

  // ── injection ──────────────────────────────────────────────────────────
  const injection = spec
    .command('injection')
    .alias('inj')
    .description('Manage spec injection configuration (.workflow/config.json → specInjection)');

  // spec injection show
  injection
    .command('show')
    .description('Show current spec injection config')
    .option('--json', 'Output raw JSON')
    .action(async (opts: { json?: boolean }) => {
      const { logCliEndpoint } = await import('../hooks/spec-analytics.js');
      logCliEndpoint(process.cwd(), 'spec injection show', {});
      const { loadSpecInjectionConfig } = await import('../config/index.js');
      const config = loadSpecInjectionConfig(process.cwd());

      if (opts.json) {
        console.log(JSON.stringify(config, null, 2));
        return;
      }

      if (Object.keys(config).length === 0) {
        console.log('No spec injection config. Use "maestro spec injection set" to configure.');
        return;
      }

      // Agent mappings
      if (config.mapping) {
        console.log('\nAgent Mappings:');
        for (const [agent, mapping] of Object.entries(config.mapping)) {
          console.log(`  ${agent}:`);
          console.log(`    categories: ${mapping.categories.join(', ')}`);
          if (mapping.includeKeywords?.length) console.log(`    include: ${mapping.includeKeywords.join(', ')}`);
          if (mapping.excludeKeywords?.length) console.log(`    exclude: ${mapping.excludeKeywords.join(', ')}`);
          if (mapping.extras?.length) console.log(`    extras: ${mapping.extras.join(', ')}`);
        }
      }

      // Category docs
      if (config.categoryDocs) {
        console.log('\nCategory Documents:');
        for (const [cat, docConfig] of Object.entries(config.categoryDocs)) {
          console.log(`  ${cat}:`);
          if (docConfig.specFiles?.length) console.log(`    specFiles: ${docConfig.specFiles.join(', ')}`);
          if (docConfig.docs?.length) console.log(`    docs: ${docConfig.docs.join(', ')}`);
        }
      }

      // Always (session start)
      if (config.always) {
        console.log('\nAlways Inject (session start):');
        if (config.always.docs?.length) console.log(`  docs: ${config.always.docs.join(', ')}`);
        if (config.always.keywords?.length) console.log(`  keywords: ${config.always.keywords.join(', ')}`);
        if (config.always.categories?.length) console.log(`  categories: ${config.always.categories.join(', ')}`);
      }

      // Keyword filters
      if (config.keywordFilters) {
        console.log('\nGlobal Keyword Filters:');
        if (config.keywordFilters.include?.length) console.log(`  include: ${config.keywordFilters.include.join(', ')}`);
        if (config.keywordFilters.exclude?.length) console.log(`  exclude: ${config.keywordFilters.exclude.join(', ')}`);
      }

      if (config.maxContentLength) {
        console.log(`\nMax Content Length: ${config.maxContentLength}`);
      }
    });

  // spec injection set agent
  injection
    .command('agent')
    .description('Configure agent-type spec mapping')
    .argument('<agent>', 'Agent type (e.g. code-developer, tdd-developer)')
    .option('--categories <cats>', 'Comma-separated categories (e.g. coding,test,ui)')
    .option('--include <keywords>', 'Comma-separated include keywords')
    .option('--exclude <keywords>', 'Comma-separated exclude keywords')
    .option('--extras <paths>', 'Comma-separated extra doc paths')
    .option('--remove', 'Remove this agent mapping')
    .action(async (agent: string, opts: { categories?: string; include?: string; exclude?: string; extras?: string; remove?: boolean }) => {
      const { logCliEndpoint } = await import('../hooks/spec-analytics.js');
      logCliEndpoint(process.cwd(), 'spec injection agent', { agentType: agent, remove: !!opts.remove });
      const { loadSpecInjectionConfig, saveSpecInjectionConfig } = await import('../config/index.js');
      const config = loadSpecInjectionConfig(process.cwd());

      if (opts.remove) {
        if (config.mapping) {
          delete config.mapping[agent];
          if (Object.keys(config.mapping).length === 0) delete config.mapping;
        }
        saveSpecInjectionConfig(process.cwd(), config);
        console.log(`\u2713 Removed agent mapping: ${agent}`);
        return;
      }

      if (!opts.categories) {
        console.error('Error: --categories is required (e.g. --categories coding,test)');
        process.exit(1);
      }

      const { VALID_CATEGORIES } = await import('../tools/spec-entry-parser.js');
      const categories = opts.categories.split(',').map(s => s.trim()).filter(Boolean);
      for (const cat of categories) {
        if (!(VALID_CATEGORIES as readonly string[]).includes(cat)) {
          console.error(`Error: invalid category "${cat}". Valid: ${VALID_CATEGORIES.join(', ')}`);
          process.exit(1);
        }
      }

      if (!config.mapping) config.mapping = {};
      const existing = config.mapping[agent] || { categories: [] };
      existing.categories = categories;
      if (opts.include) existing.includeKeywords = opts.include.split(',').map(s => s.trim()).filter(Boolean);
      if (opts.exclude) existing.excludeKeywords = opts.exclude.split(',').map(s => s.trim()).filter(Boolean);
      if (opts.extras) existing.extras = opts.extras.split(',').map(s => s.trim()).filter(Boolean);
      config.mapping[agent] = existing;

      saveSpecInjectionConfig(process.cwd(), config);
      console.log(`\u2713 Agent mapping set: ${agent} → [${categories.join(', ')}]`);
      if (existing.includeKeywords?.length) console.log(`  include: ${existing.includeKeywords.join(', ')}`);
      if (existing.excludeKeywords?.length) console.log(`  exclude: ${existing.excludeKeywords.join(', ')}`);
      if (existing.extras?.length) console.log(`  extras: ${existing.extras.join(', ')}`);
    });

  // spec injection category
  injection
    .command('category')
    .description('Associate extra documents with a category')
    .argument('<category>', 'Category name (coding|arch|debug|test|review|learning|ui)')
    .option('--spec-files <files>', 'Comma-separated extra spec filenames in .workflow/specs/')
    .option('--docs <paths>', 'Comma-separated doc paths (relative to project or knowhow/ prefix)')
    .option('--remove', 'Remove this category doc config')
    .action(async (category: string, opts: { specFiles?: string; docs?: string; remove?: boolean }) => {
      const { logCliEndpoint } = await import('../hooks/spec-analytics.js');
      logCliEndpoint(process.cwd(), 'spec injection category', { category, remove: !!opts.remove });
      const { VALID_CATEGORIES } = await import('../tools/spec-entry-parser.js');
      if (!(VALID_CATEGORIES as readonly string[]).includes(category)) {
        console.error(`Error: invalid category "${category}". Valid: ${VALID_CATEGORIES.join(', ')}`);
        process.exit(1);
      }

      const { loadSpecInjectionConfig, saveSpecInjectionConfig } = await import('../config/index.js');
      const config = loadSpecInjectionConfig(process.cwd());

      if (opts.remove) {
        if (config.categoryDocs) {
          delete config.categoryDocs[category];
          if (Object.keys(config.categoryDocs).length === 0) delete config.categoryDocs;
        }
        saveSpecInjectionConfig(process.cwd(), config);
        console.log(`\u2713 Removed category docs: ${category}`);
        return;
      }

      if (!opts.specFiles && !opts.docs) {
        console.error('Error: provide --spec-files and/or --docs');
        process.exit(1);
      }

      if (!config.categoryDocs) config.categoryDocs = {};
      const existing = config.categoryDocs[category] || {};
      if (opts.specFiles) existing.specFiles = opts.specFiles.split(',').map(s => s.trim()).filter(Boolean);
      if (opts.docs) existing.docs = opts.docs.split(',').map(s => s.trim()).filter(Boolean);
      config.categoryDocs[category] = existing;

      saveSpecInjectionConfig(process.cwd(), config);
      console.log(`\u2713 Category docs set: ${category}`);
      if (existing.specFiles?.length) console.log(`  specFiles: ${existing.specFiles.join(', ')}`);
      if (existing.docs?.length) console.log(`  docs: ${existing.docs.join(', ')}`);
    });

  // spec injection always
  injection
    .command('always')
    .description('Manage always-inject config (session start): docs, keywords, and categories')
    .option('--docs <paths>', 'Comma-separated doc paths to add')
    .option('--keywords <kw>', 'Comma-separated keywords: always inject matching entries')
    .option('--categories <cats>', 'Comma-separated categories: always inject these categories')
    .option('--remove-docs <paths>', 'Remove doc paths')
    .option('--remove-keywords <kw>', 'Remove keywords')
    .option('--remove-categories <cats>', 'Remove categories')
    .option('--clear', 'Clear all always-inject config')
    .action(async (opts: {
      docs?: string; keywords?: string; categories?: string;
      removeDocs?: string; removeKeywords?: string; removeCategories?: string;
      clear?: boolean;
    }) => {
      const { logCliEndpoint } = await import('../hooks/spec-analytics.js');
      logCliEndpoint(process.cwd(), 'spec injection always', { clear: !!opts.clear });
      const { loadSpecInjectionConfig, saveSpecInjectionConfig } = await import('../config/index.js');
      const config = loadSpecInjectionConfig(process.cwd());

      if (opts.clear) {
        delete config.always;
        saveSpecInjectionConfig(process.cwd(), config);
        console.log('\u2713 Cleared all always-inject config');
        return;
      }

      if (!config.always) config.always = {};
      const always = config.always;

      // Docs
      if (opts.docs) {
        const docs = new Set(always.docs ?? []);
        for (const p of opts.docs.split(',').map(s => s.trim()).filter(Boolean)) docs.add(p);
        always.docs = [...docs];
      }
      if (opts.removeDocs) {
        const docs = new Set(always.docs ?? []);
        for (const p of opts.removeDocs.split(',').map(s => s.trim()).filter(Boolean)) docs.delete(p);
        always.docs = docs.size > 0 ? [...docs] : undefined;
      }

      // Keywords
      if (opts.keywords) {
        const kw = new Set(always.keywords ?? []);
        for (const k of opts.keywords.split(',').map(s => s.trim()).filter(Boolean)) kw.add(k);
        always.keywords = [...kw];
      }
      if (opts.removeKeywords) {
        const kw = new Set(always.keywords ?? []);
        for (const k of opts.removeKeywords.split(',').map(s => s.trim()).filter(Boolean)) kw.delete(k);
        always.keywords = kw.size > 0 ? [...kw] : undefined;
      }

      // Categories
      if (opts.categories) {
        const cats = new Set(always.categories ?? []);
        for (const c of opts.categories.split(',').map(s => s.trim()).filter(Boolean)) cats.add(c);
        always.categories = [...cats];
      }
      if (opts.removeCategories) {
        const cats = new Set(always.categories ?? []);
        for (const c of opts.removeCategories.split(',').map(s => s.trim()).filter(Boolean)) cats.delete(c);
        always.categories = cats.size > 0 ? [...cats] : undefined;
      }

      // Clean up empty
      if (!always.docs?.length) delete always.docs;
      if (!always.keywords?.length) delete always.keywords;
      if (!always.categories?.length) delete always.categories;
      if (!always.docs && !always.keywords && !always.categories) {
        delete config.always;
      }

      saveSpecInjectionConfig(process.cwd(), config);
      console.log('\u2713 Always-inject (session start):');
      if (config.always?.docs?.length) console.log(`  docs: ${config.always.docs.join(', ')}`);
      if (config.always?.keywords?.length) console.log(`  keywords: ${config.always.keywords.join(', ')}`);
      if (config.always?.categories?.length) console.log(`  categories: ${config.always.categories.join(', ')}`);
      if (!config.always) console.log('  (empty)');
    });

  // spec injection filter
  injection
    .command('filter')
    .description('Set global keyword filters')
    .option('--include <keywords>', 'Comma-separated include keywords (replaces)')
    .option('--exclude <keywords>', 'Comma-separated exclude keywords (replaces)')
    .option('--clear', 'Clear all keyword filters')
    .action(async (opts: { include?: string; exclude?: string; clear?: boolean }) => {
      const { logCliEndpoint } = await import('../hooks/spec-analytics.js');
      logCliEndpoint(process.cwd(), 'spec injection filter', { clear: !!opts.clear });
      const { loadSpecInjectionConfig, saveSpecInjectionConfig } = await import('../config/index.js');
      const config = loadSpecInjectionConfig(process.cwd());

      if (opts.clear) {
        delete config.keywordFilters;
        saveSpecInjectionConfig(process.cwd(), config);
        console.log('\u2713 Cleared all keyword filters');
        return;
      }

      if (!config.keywordFilters) config.keywordFilters = {};
      if (opts.include) config.keywordFilters.include = opts.include.split(',').map(s => s.trim()).filter(Boolean);
      if (opts.exclude) config.keywordFilters.exclude = opts.exclude.split(',').map(s => s.trim()).filter(Boolean);

      saveSpecInjectionConfig(process.cwd(), config);
      if (config.keywordFilters.include?.length) console.log(`\u2713 Include: ${config.keywordFilters.include.join(', ')}`);
      if (config.keywordFilters.exclude?.length) console.log(`\u2713 Exclude: ${config.keywordFilters.exclude.join(', ')}`);
    });

  // spec injection preview
  injection
    .command('preview')
    .description('Preview what would be injected for an agent type')
    .argument('<agent>', 'Agent type (e.g. code-developer, general)')
    .option('--json', 'Output as JSON')
    .action(async (agent: string, opts: { json?: boolean }) => {
      const { logCliEndpoint } = await import('../hooks/spec-analytics.js');
      logCliEndpoint(process.cwd(), 'spec injection preview', { agentType: agent });
      const { evaluateSpecInjection } = await import('../hooks/spec-injector.js');
      const { loadSpecInjectionConfig } = await import('../config/index.js');

      const cwd = process.cwd();
      const config = loadSpecInjectionConfig(cwd);
      const result = evaluateSpecInjection(agent, cwd, undefined, config);

      if (opts.json) {
        console.log(JSON.stringify({
          agent,
          inject: result.inject,
          categories: result.categories,
          specCount: result.specCount,
          budgetAction: result.budgetAction,
          contentLength: result.content?.length ?? 0,
        }, null, 2));
        return;
      }

      console.log(`\nInjection Preview: ${agent}`);
      console.log(`  Inject: ${result.inject ? 'yes' : 'no'}`);
      if (result.categories?.length) console.log(`  Categories: ${result.categories.join(', ')}`);
      if (result.specCount) console.log(`  Entries: ${result.specCount}`);
      if (result.budgetAction) console.log(`  Budget: ${result.budgetAction}`);
      if (result.content) {
        console.log(`  Content: ${result.content.length} chars`);
        console.log('\n--- Preview (first 500 chars) ---');
        console.log(result.content.slice(0, 500));
        if (result.content.length > 500) console.log('\n... (truncated)');
      }
    });
  // ── conflict ─────────────────────────────────────────────────────────
  const conflict = spec
    .command('conflict')
    .description('Manage confidence and conflict markers on spec entries');

  conflict
    .command('list')
    .alias('ls')
    .description('List all entries with conflict markers or degraded confidence')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const { listConflicts } = await import('../tools/spec-conflict-marker.js');
      const conflicts = listConflicts(process.cwd());

      if (opts.json) {
        console.log(JSON.stringify(conflicts, null, 2));
        return;
      }

      if (conflicts.length === 0) {
        console.log('No conflicts or degraded entries found.');
        return;
      }

      console.log(`Found ${conflicts.length} marked entries:\n`);
      for (const c of conflicts) {
        const badge = c.confidence === 'contested' ? '[CONTESTED]'
          : c.confidence === 'low' ? '[LOW]'
          : `[${c.confidence.toUpperCase()}]`;
        console.log(`  ${badge} ${c.file}:${c.lineStart} "${c.title}" [${c.category}]`);
        if (c.conflictNote) console.log(`    Note: ${c.conflictNote}`);
        if (c.conflictMarker) console.log(`    Marker: ${c.conflictMarker}`);
      }
    });

  conflict
    .command('mark')
    .description('Mark a spec entry as conflicted')
    .argument('<file>', 'Spec filename (e.g. coding-conventions.md)')
    .argument('<line>', 'Line number of the <spec-entry> tag')
    .requiredOption('--note <text>', 'Conflict description')
    .option('--marker <id>', 'Conflict marker ID (auto-generated if omitted)')
    .option('--confidence <level>', 'Confidence level: high|medium|low|contested (default: contested)')
    .action(async (file: string, line: string, opts: { note: string; marker?: string; confidence?: string }) => {
      const { markConflict } = await import('../tools/spec-conflict-marker.js');
      const result = markConflict(process.cwd(), file, parseInt(line, 10), {
        note: opts.note,
        marker: opts.marker,
        confidence: (opts.confidence as 'contested') || 'contested',
      });

      if (result.success) {
        console.log(`Marked ${file}:${line} as conflicted.`);
      } else {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
    });

  conflict
    .command('clear')
    .description('Clear conflict markers from a spec entry')
    .argument('<file>', 'Spec filename')
    .argument('<line>', 'Line number of the <spec-entry> tag')
    .option('--confidence <level>', 'Set new confidence level after clearing (default: remove)')
    .action(async (file: string, line: string, opts: { confidence?: string }) => {
      const { clearConflict } = await import('../tools/spec-conflict-marker.js');
      const result = clearConflict(
        process.cwd(),
        file,
        parseInt(line, 10),
        opts.confidence as 'high' | undefined,
      );

      if (result.success) {
        console.log(`Cleared conflict markers from ${file}:${line}.`);
      } else {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
    });

  conflict
    .command('set-confidence')
    .description('Set confidence level on a spec entry')
    .argument('<file>', 'Spec filename')
    .argument('<line>', 'Line number of the <spec-entry> tag')
    .argument('<level>', 'Confidence level: high|medium|low|contested')
    .action(async (file: string, line: string, level: string) => {
      const { setConfidence } = await import('../tools/spec-conflict-marker.js');
      const result = setConfidence(
        process.cwd(),
        file,
        parseInt(line, 10),
        level as 'high',
      );

      if (result.success) {
        console.log(`Set confidence=${level} on ${file}:${line}.`);
      } else {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
    });

  conflict
    .command('clear-all')
    .description('Clear all conflict markers in a spec file')
    .argument('<file>', 'Spec filename')
    .option('--confidence <level>', 'Set new confidence level after clearing')
    .action(async (file: string, opts: { confidence?: string }) => {
      const { clearAllConflicts } = await import('../tools/spec-conflict-marker.js');
      const result = clearAllConflicts(
        process.cwd(),
        file,
        opts.confidence as 'high' | undefined,
      );

      console.log(`Cleared ${result.cleared} conflict markers from ${file}.`);
      if (result.errors.length > 0) {
        for (const err of result.errors) console.error(`  Error: ${err}`);
      }
    });

  // ── analytics ────────────────────────────────────────────────────────
  spec
    .command('analytics')
    .alias('stats')
    .description('View spec injection analytics and statistics')
    .option('--json', 'Output as JSON')
    .option('--recent <n>', 'Show last N events')
    .option('--summary', 'Show summary statistics only (default)')
    .option('--clear', 'Archive current log and start fresh')
    .option('--tui', 'Open TUI analytics panel')
    .action(async (opts: { json?: boolean; recent?: string; summary?: boolean; clear?: boolean; tui?: boolean }) => {
      const { logCliEndpoint } = await import('../hooks/spec-analytics.js');
      logCliEndpoint(process.cwd(), 'spec analytics', { json: !!opts.json, recent: opts.recent, clear: !!opts.clear, tui: !!opts.tui });

      if (opts.tui) {
        const { runSpecAnalyticsTui } = await import('../tui/config-ui/index.js');
        await runSpecAnalyticsTui();
        return;
      }

      const { readAnalytics, readRecentAnalytics, computeStats, getLogFileSize, clearAnalyticsLog } = await import('../hooks/spec-analytics.js');
      const cwd = process.cwd();

      if (opts.clear) {
        const archived = clearAnalyticsLog(cwd);
        console.log(archived ? `\u2713 \u65E5\u5FD7\u5DF2\u5F52\u6863\u5230: ${archived}` : '\u65E0\u65E5\u5FD7\u6587\u4EF6\u53EF\u5F52\u6863\u3002');
        return;
      }

      if (opts.recent) {
        const n = parseInt(opts.recent, 10) || 20;
        const recent = readRecentAnalytics(cwd, n);
        if (recent.length === 0) {
          console.log('\u6682\u65E0\u5206\u6790\u6570\u636E\u3002Spec \u6CE8\u5165\u4E8B\u4EF6\u4F1A\u81EA\u52A8\u8BB0\u5F55\u3002');
          return;
        }

        if (opts.json) {
          console.log(JSON.stringify(recent, null, 2));
          return;
        }

        console.log(`\n\u8FD1\u671F\u4E8B\u4EF6\uFF08\u6700\u8FD1 ${recent.length} \u6761\uFF09\uFF1A\n`);
        for (const entry of recent) {
          const ts = entry.timestamp.slice(0, 19).replace('T', ' ');
          if (entry.type === 'injection') {
            const status = entry.inject ? '\x1b[32m\u2713\x1b[0m' : '\x1b[31m\u2717\x1b[0m';
            const src = entry.source.replace('spec-', '').padEnd(20);
            const agent = (entry.agentType ?? entry.inferredCategory ?? '').padEnd(22);
            const kw = entry.matchedKeywords?.length ? ` \u5173\u952E\u8BCD:[${entry.matchedKeywords.join(',')}]` : '';
            const reason = entry.reason ? ` (${entry.reason})` : '';
            console.log(`  ${ts}  ${status} ${src} ${agent} ${entry.specCount} \u6761${kw}${reason}`);
          } else if (entry.type === 'cli') {
            console.log(`  ${ts}  \x1b[36m\u547D\u4EE4\x1b[0m ${entry.command.padEnd(25)} ${JSON.stringify(entry.args)}`);
          } else if (entry.type === 'hook') {
            console.log(`  ${ts}  \x1b[33mHook\x1b[0m ${entry.hookName.padEnd(20)} ${entry.nodeId ?? ''}`);
          }
        }
        return;
      }

      // Default: summary
      const entries = readAnalytics(cwd);
      if (entries.length === 0) {
        console.log('\u6682\u65E0\u5206\u6790\u6570\u636E\u3002Spec \u6CE8\u5165\u4E8B\u4EF6\u4F1A\u81EA\u52A8\u8BB0\u5F55\u3002');
        return;
      }

      const fileSize = getLogFileSize(cwd);
      const stats = computeStats(entries, fileSize);

      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      console.log('\nSpec \u6CE8\u5165\u5206\u6790\u62A5\u544A');
      console.log('==================\n');
      console.log(`  \u603B\u6CE8\u5165\u6B21\u6570:      ${stats.totalInjections}`);
      console.log(`  \u6210\u529F:            ${stats.successfulInjections} (${stats.hitRate.toFixed(1)}%)`);
      console.log(`  \u5931\u8D25:            ${stats.failedInjections} (${(100 - stats.hitRate).toFixed(1)}%)`);

      // By source
      const sources = Object.entries(stats.bySource);
      if (sources.length > 0) {
        console.log('\n  \u6309\u6765\u6E90:');
        for (const [src, s] of sources) {
          const rate = s.total > 0 ? ((s.injected / s.total) * 100).toFixed(1) : '0.0';
          console.log(`    ${src.padEnd(28)} ${String(s.total).padStart(4)} (\u547D\u4E2D\u7387 ${rate}%)`);
        }
      }

      // By agent type
      const agents = Object.entries(stats.byAgentType).sort((a, b) => b[1].total - a[1].total);
      if (agents.length > 0) {
        console.log('\n  \u6309 Agent/Category:');
        for (const [agent, s] of agents.slice(0, 10)) {
          const rate = s.total > 0 ? ((s.injected / s.total) * 100).toFixed(1) : '0.0';
          console.log(`    ${agent.padEnd(28)} ${String(s.total).padStart(4)} (\u547D\u4E2D\u7387 ${rate}%)`);
        }
        if (agents.length > 10) console.log(`    \u2026 \u53E6\u6709 ${agents.length - 10} \u9879`);
      }

      // Budget actions
      const budgets = Object.entries(stats.byBudgetAction);
      if (budgets.length > 0) {
        console.log('\n  \u4E0A\u4E0B\u6587\u9884\u7B97:');
        console.log(`    ${budgets.map(([k, v]) => `${k}: ${v}`).join('  ')}`);
      }

      // Top keywords
      if (stats.keywordStats.topKeywords.length > 0) {
        console.log('\n  \u70ED\u95E8\u5173\u952E\u8BCD:');
        console.log(`    ${stats.keywordStats.topKeywords.slice(0, 10).map(k => `${k.keyword} (${k.count})`).join('  ')}`);
        console.log(`    \u5E73\u5747\u5339\u914D/\u6B21: ${stats.keywordStats.avgMatchedPerPrompt.toFixed(1)}  \u53BB\u91CD\u8FC7\u6EE4: ${stats.keywordStats.dedupFilteredTotal}`);
      }

      // Hook stats
      if (stats.hookStats.totalInvocations > 0) {
        console.log('\n  Hook \u8C03\u7528:');
        const hooks = Object.entries(stats.hookStats.byHook).sort((a, b) => b[1] - a[1]);
        console.log(`    ${hooks.map(([k, v]) => `${k}: ${v}`).join('  ')}`);
        if (stats.hookStats.avgDurationMs > 0) {
          console.log(`    \u5E73\u5747\u8017\u65F6: ${stats.hookStats.avgDurationMs.toFixed(1)}ms`);
        }
      }

      // CLI stats
      const cliEntries = Object.entries(stats.cliStats).sort((a, b) => b[1] - a[1]);
      if (cliEntries.length > 0) {
        console.log('\n  CLI \u7AEF\u70B9\u8C03\u7528:');
        console.log(`    ${cliEntries.map(([k, v]) => `${k}: ${v}`).join('  ')}`);
      }

      // Log info
      const sizeKB = (stats.logFileSize / 1024).toFixed(1);
      const earliest = stats.timeRange.earliest ? stats.timeRange.earliest.slice(0, 10) : '\u2014';
      const latest = stats.timeRange.latest ? stats.timeRange.latest.slice(0, 10) : '\u2014';
      console.log(`\n  \u65E5\u5FD7: ${sizeKB} KB | ${stats.totalEntries} \u6761\u8BB0\u5F55 | ${earliest} ~ ${latest}`);
    });
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('readable', () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk as string;
      }
    });
    process.stdin.on('end', () => resolve(data));
    if (process.stdin.isTTY) resolve('');
  });
}
