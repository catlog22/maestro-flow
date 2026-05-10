/**
 * Spec Command — CLI endpoint for project spec management
 *
 * Subcommands: load, list, init, status
 */

import type { Command } from 'commander';

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
    .description('Load specs matching category or role')
    .option('--category <stage>', 'Filter by category: coding|arch|quality|debug|test|review|learning|tools')
    .option('--role <role>', 'Filter by role: implement|plan|test|review|analyze|explore|brainstorm|research')
    .option('--keyword <word>', 'Filter entries by keyword')
    .option('--scope <scope>', 'Spec scope: project|global|team|personal (default: project)')
    .option('--uid <uid>', 'User id for personal scope (auto-detected from git if omitted)')
    .option('--stdin', 'Read input from stdin (Hook mode)')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const { loadSpecs } = await import('../tools/spec-loader.js');

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

      const role = opts.role as string | undefined;
      const result = loadSpecs(projectPath, opts.category, uid, keyword, scope, { role });

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
    .description('List spec files for a given scope')
    .option('--scope <scope>', 'Spec scope: project|global|team|personal (default: project)')
    .option('--uid <uid>', 'User id for personal scope')
    .action(async (opts) => {
      const { existsSync, readdirSync } = await import('node:fs');
      const { resolveSpecDir } = await import('../tools/spec-loader.js');

      const scope = validateScope(opts.scope);
      const uid = await resolveUid(opts);

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
      for (const file of files) {
        console.log(`  ${file}`);
      }
    });

  // ── init ──────────────────────────────────────────────────────────────
  spec
    .command('init')
    .description('Initialize spec system with seed documents')
    .option('--scope <scope>', 'Spec scope: project|global|team|personal (default: project)')
    .option('--uid <uid>', 'User id for personal scope')
    .action(async (opts) => {
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

      if (result.skipped.length > 0) {
        console.log('\nSkipped (already exist):');
        for (const file of result.skipped) console.log(`  - ${file}`);
      }

      if (result.directories.length === 0 && result.created.length === 0) {
        console.log('\nSpec system already initialized. No changes made.');
      }
    });

  // ── status ────────────────────────────────────────────────────────────
  spec
    .command('status')
    .description('Show spec system status')
    .option('--scope <scope>', 'Spec scope: project|global|team|personal (default: project)')
    .option('--uid <uid>', 'User id for personal scope')
    .action(async (opts) => {
      const { existsSync, readdirSync, readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { resolveSpecDir } = await import('../tools/spec-loader.js');

      const scope = validateScope(opts.scope);
      const uid = await resolveUid(opts);

      if (scope === 'personal' && !uid) {
        console.error('Error: personal scope requires --uid or team membership.');
        process.exit(1);
      }

      const specsDir = resolveSpecDir(process.cwd(), scope, uid);
      const label = SCOPE_LABELS[scope];
      const dirExists = existsSync(specsDir);

      if (!dirExists) {
        console.log(`${label} directory: missing`);
        console.log(`Run "maestro spec init --scope ${scope}" to initialize.`);
        return;
      }

      const files = readdirSync(specsDir).filter(f => f.endsWith('.md'));
      console.log(`${label} System Status\n`);
      console.log(`  Directory: OK (${specsDir})`);
      console.log(`  Files: ${files.length}\n`);

      for (const file of files) {
        const size = readFileSync(join(specsDir, file), 'utf-8').length;
        console.log(`    ${file}  (${size} chars)`);
      }
    });

  // ── add ──────────────────────────────────────────────────────────────
  spec
    .command('add')
    .description('Add a spec entry to the appropriate file')
    .argument('<category>', 'Entry category: coding|arch|quality|debug|test|review|learning')
    .argument('<title>', 'Entry title')
    .argument('[content]', 'Entry content (if omitted, reads from remaining args)')
    .option('--keywords <words>', 'Comma-separated keywords')
    .option('--roles <roles>', 'Comma-separated roles (implement,plan,test,review,analyze,explore)')
    .option('--source <source>', 'Source reference (e.g., analyze:ANL-xxx)')
    .option('--ref <path>', 'Create as index entry referencing a knowhow document')
    .option('--knowhow-type <type>', 'Knowhow type for --ref (asset, blueprint, document, template, etc.)')
    .option('--scope <scope>', 'Spec scope: project|global|team|personal (default: project)')
    .option('--uid <uid>', 'User id for personal scope')
    .option('--stdin', 'Read JSON array from stdin: [{category,title,content,keywords}]')
    .option('--json', 'Output result as JSON')
    .action(async (category: string, title: string, content: string | undefined, opts: Record<string, unknown>) => {
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

      const roles = typeof opts.roles === 'string'
        ? opts.roles.split(',').map((r: string) => r.trim().toLowerCase()).filter(Boolean)
        : undefined;

      // ── --ref mode: create index entry referencing a knowhow document ──
      const refPath = opts.ref as string | undefined;
      if (refPath) {
        const { existsSync: fileExists, mkdirSync: mkDir, writeFileSync: writeFs, readFileSync: readFs } = await import('node:fs');
        const { join: pathJoin, resolve: pathResolve } = await import('node:path');

        const knowhowType = (opts.knowhowType ?? opts['knowhow-type']) as string | undefined;
        const absRefPath = pathResolve(process.cwd(), '.workflow', refPath);

        // If ref file doesn't exist AND --knowhow-type given → create knowhow doc first
        if (!fileExists(absRefPath) && knowhowType) {
          const KNOWHOW_PREFIX_MAP: Record<string, string> = {
            session: 'KNW', tip: 'TIP', template: 'TPL', recipe: 'RCP',
            reference: 'REF', decision: 'DCS', asset: 'AST', blueprint: 'BLP',
            document: 'DOC',
          };
          const prefix = KNOWHOW_PREFIX_MAP[knowhowType] ?? 'DOC';
          const dir = pathJoin(process.cwd(), '.workflow', 'knowhow');
          if (!fileExists(dir)) mkDir(dir, { recursive: true });

          const now = new Date();
          const fmLines = ['---', `title: ${title}`, `type: ${knowhowType}`, `category: ${knowhowType}`, `created: ${now.toISOString()}`];
          if (keywords.length > 0) {
            fmLines.push('tags:');
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
        roles,
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
