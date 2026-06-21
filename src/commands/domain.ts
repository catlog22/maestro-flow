/**
 * Domain Command — CLI endpoint for project domain term management
 *
 * Subcommands: init, add, list, show, update, remove, search, discover,
 *              import, deprecate, validate
 */

import type { Command } from 'commander';
import { resolve, join } from 'node:path';

function getWorkflowRoot(): string {
  return resolve('.workflow');
}

export function registerDomainCommand(program: Command): void {
  const domain = program
    .command('domain')
    .description('Domain knowledge management (glossary of project terms)');

  // ── init ──────────────────────────────────────────────────────────────
  domain
    .command('init')
    .description('Initialize .workflow/domain/ with empty glossary.json')
    .option('--project <name>', 'Project name for glossary metadata')
    .action(async (opts) => {
      const { initDomain } = await import('../tools/domain-loader.js');
      const path = initDomain(getWorkflowRoot(), opts.project);
      console.log(`Initialized domain glossary: ${path}`);
    });

  // ── add ───────────────────────────────────────────────────────────────
  domain
    .command('add <canonical> <definition>')
    .description('Add a new domain term (requires confirmation)')
    .option('--aliases <csv>', 'Comma-separated aliases')
    .option('--keywords <csv>', 'Comma-separated trigger keywords')
    .option('--relationships <csv>', 'Comma-separated related term ids')
    .option('--concept-ref <path>', 'Path to detailed concept document')
    .option('--tier <tier>', 'Term tier: core|extended|peripheral', 'core')
    .action(async (canonical: string, definition: string, opts) => {
      const { addTerm } = await import('../tools/domain-loader.js');
      const id = canonical.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!id) {
        console.error('Cannot generate kebab-case ID from canonical name. Use English characters in the name.');
        process.exit(1);
      }

      const term = {
        id,
        canonical,
        aliases: opts.aliases ? opts.aliases.split(',').map((a: string) => a.trim()) : [],
        definition,
        relationships: opts.relationships ? opts.relationships.split(',').map((r: string) => r.trim()) : [],
        keywords: opts.keywords ? opts.keywords.split(',').map((k: string) => k.trim()) : [],
        ...(opts.conceptRef ? { concept_ref: opts.conceptRef } : {}),
        tier: opts.tier as 'core' | 'extended' | 'peripheral',
        status: 'active' as const,
        source: {
          kind: 'manual' as const,
          registered_at: new Date().toISOString(),
        },
      };

      console.log(`\nRegistering domain term:`);
      console.log(`  ID:          ${id}`);
      console.log(`  Canonical:   ${canonical}`);
      console.log(`  Definition:  ${definition}`);
      console.log(`  Aliases:     ${term.aliases.join(', ') || '(none)'}`);
      console.log(`  Keywords:    ${term.keywords.join(', ') || '(none)'}`);
      console.log(`  Relations:   ${term.relationships.join(', ') || '(none)'}`);
      console.log(`  Tier:        ${term.tier}`);

      try {
        addTerm(getWorkflowRoot(), term);
        console.log(`\n✓ Registered: ${canonical}`);
      } catch (e) {
        console.error(`\n✗ Failed: ${(e as Error).message}`);
        process.exit(1);
      }
    });

  // ── list ──────────────────────────────────────────────────────────────
  domain
    .command('list')
    .description('List all domain terms')
    .option('--json', 'Output as JSON')
    .option('--status <status>', 'Filter by status: active|deprecated')
    .action(async (opts) => {
      const { readGlossary } = await import('../tools/domain-loader.js');
      const glossary = readGlossary(getWorkflowRoot());

      let terms = glossary.terms;
      if (opts.status) {
        terms = terms.filter(t => (t.status ?? 'active') === opts.status);
      }

      if (opts.json) {
        console.log(JSON.stringify(terms, null, 2));
        return;
      }

      if (terms.length === 0) {
        console.log('No domain terms. Run `maestro domain discover` or `maestro domain add`.');
        return;
      }

      console.log(`Domain terms (${terms.length}):\n`);
      let maxId = 4;
      let maxCan = 9;
      for (const t of terms) {
        if (t.id.length > maxId) maxId = t.id.length;
        if (t.canonical.length > maxCan) maxCan = t.canonical.length;
      }
      console.log(`  ${'ID'.padEnd(maxId)}  ${'Canonical'.padEnd(maxCan)}  Tier       Status      Definition`);
      console.log(`  ${'─'.repeat(maxId)}  ${'─'.repeat(maxCan)}  ${'─'.repeat(10)} ${'─'.repeat(11)} ${'─'.repeat(40)}`);
      for (const t of terms) {
        const tier = (t.tier ?? 'core').padEnd(10);
        const status = (t.status ?? 'active').padEnd(11);
        const def = t.definition.length > 40 ? t.definition.slice(0, 37) + '...' : t.definition;
        console.log(`  ${t.id.padEnd(maxId)}  ${t.canonical.padEnd(maxCan)}  ${tier} ${status} ${def}`);
      }
    });

  // ── show ──────────────────────────────────────────────────────────────
  domain
    .command('show <id>')
    .description('Show detailed information for a domain term')
    .option('--json', 'Output as JSON')
    .option('--full', 'Show full concept_ref content')
    .action(async (id: string, opts) => {
      const { readGlossary } = await import('../tools/domain-loader.js');
      const { existsSync, readFileSync } = await import('node:fs');
      const glossary = readGlossary(getWorkflowRoot());
      const term = glossary.terms.find(t => t.id === id);

      if (!term) {
        console.error(`Term "${id}" not found. Run \`maestro domain list\` for available terms.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(term, null, 2));
        return;
      }

      console.log(`\n## ${term.canonical} (${term.id})`);
      console.log(`\n${term.definition}`);
      console.log(`\nAliases:       ${term.aliases.join(', ') || '(none)'}`);
      console.log(`Keywords:      ${term.keywords.join(', ') || '(none)'}`);
      console.log(`Relationships: ${term.relationships.join(', ') || '(none)'}`);
      console.log(`Tier:          ${term.tier ?? 'core'}`);
      console.log(`Status:        ${term.status ?? 'active'}`);
      console.log(`Source:        ${term.source.kind} (${term.source.registered_at})`);

      if (term.deprecated_info) {
        console.log(`\nDeprecated:`);
        console.log(`  Reason:    ${term.deprecated_info.reason}`);
        if (term.deprecated_info.successor_id)
          console.log(`  Successor: ${term.deprecated_info.successor_id}`);
        console.log(`  Since:     ${term.deprecated_info.deprecated_at}`);
      }

      if (term.concept_ref) {
        const { resolve: resolvePath, sep } = await import('node:path');
        const domainBase = resolvePath(join(getWorkflowRoot(), 'domain'));
        const conceptPath = resolvePath(join(getWorkflowRoot(), 'domain', term.concept_ref));
        if (!conceptPath.startsWith(domainBase + sep) && conceptPath !== domainBase) {
          console.log(`\nConcept ref: ${term.concept_ref} (path escapes domain directory — skipped)`);
        } else if (existsSync(conceptPath)) {
          const content = readFileSync(conceptPath, 'utf-8');
          const limit = opts.full ? Infinity : 3000;
          const display = content.length > limit
            ? content.slice(0, limit) + `\n... (${content.split('\n').length} lines total)`
            : content;
          console.log(`\n--- Concept Document ---\n${display}`);
        } else {
          console.log(`\nConcept ref: ${term.concept_ref} (file not found)`);
        }
      }
    });

  // ── update ────────────────────────────────────────────────────────────
  domain
    .command('update <id>')
    .description('Update a domain term')
    .option('--definition <text>', 'New definition')
    .option('--add-alias <csv>', 'Add aliases (comma-separated)')
    .option('--remove-alias <csv>', 'Remove aliases (comma-separated)')
    .option('--add-relationship <csv>', 'Add relationships')
    .option('--add-keyword <csv>', 'Add keywords')
    .option('--tier <tier>', 'Update tier: core|extended|peripheral')
    .action(async (id: string, opts) => {
      const { readGlossary, updateTerm } = await import('../tools/domain-loader.js');
      const glossary = readGlossary(getWorkflowRoot());
      const term = glossary.terms.find(t => t.id === id);
      if (!term) {
        console.error(`Term "${id}" not found`);
        process.exit(1);
      }

      const updates: Record<string, unknown> = {};

      if (opts.definition) updates.definition = opts.definition;
      if (opts.tier) updates.tier = opts.tier;

      if (opts.addAlias) {
        const toAdd = opts.addAlias.split(',').map((a: string) => a.trim());
        updates.aliases = [...new Set([...term.aliases, ...toAdd])];
      }
      if (opts.removeAlias) {
        const toRemove = new Set(opts.removeAlias.split(',').map((a: string) => a.trim()));
        const base = (updates.aliases as string[] | undefined) ?? term.aliases;
        updates.aliases = base.filter((a: string) => !toRemove.has(a));
      }
      if (opts.addRelationship) {
        const toAdd = opts.addRelationship.split(',').map((r: string) => r.trim());
        updates.relationships = [...new Set([...term.relationships, ...toAdd])];
      }
      if (opts.addKeyword) {
        const toAdd = opts.addKeyword.split(',').map((k: string) => k.trim());
        updates.keywords = [...new Set([...term.keywords, ...toAdd])];
      }

      if (Object.keys(updates).length === 0) {
        console.log('No updates specified.');
        return;
      }

      updateTerm(getWorkflowRoot(), id, updates as any);
      console.log(`✓ Updated: ${term.canonical}`);
    });

  // ── remove ────────────────────────────────────────────────────────────
  domain
    .command('remove <id>')
    .description('Remove a domain term')
    .action(async (id: string) => {
      const { removeTerm } = await import('../tools/domain-loader.js');
      try {
        const { warnings } = removeTerm(getWorkflowRoot(), id);
        if (warnings.length > 0) {
          console.warn('Warnings:');
          for (const w of warnings) console.warn(`  ${w}`);
        }
        console.log(`✓ Removed: ${id}`);
      } catch (e) {
        console.error(`✗ Failed: ${(e as Error).message}`);
        process.exit(1);
      }
    });

  // ── search ────────────────────────────────────────────────────────────
  domain
    .command('search <query>')
    .description('Search domain terms (canonical + aliases + definition + keywords)')
    .option('--json', 'Output as JSON')
    .action(async (query: string, opts) => {
      const { readGlossary } = await import('../tools/domain-loader.js');
      const glossary = readGlossary(getWorkflowRoot());
      const q = query.toLowerCase();

      const results = glossary.terms.filter(t => {
        if (t.canonical.toLowerCase().includes(q)) return true;
        if (t.definition.toLowerCase().includes(q)) return true;
        if (t.aliases.some(a => a.toLowerCase().includes(q))) return true;
        if (t.keywords.some(k => k.toLowerCase().includes(q))) return true;
        return false;
      });

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log(`No domain terms match "${query}".`);
        return;
      }

      console.log(`Domain: "${query}" (${results.length} results)\n`);
      for (const t of results) {
        const status = t.status === 'deprecated' ? ' [deprecated]' : '';
        console.log(`  [domain] ${t.canonical}${status} — ${t.definition}`);
        if (t.aliases.length) console.log(`    Aliases: ${t.aliases.join(', ')}`);
        if (t.relationships.length) {
          const relNames = t.relationships.map(rid => {
            const rel = glossary.terms.find(rt => rt.id === rid);
            return rel ? `${rel.canonical}` : rid;
          });
          console.log(`    Related: → ${relNames.join(', → ')}`);
        }
      }
    });

  // ── discover ──────────────────────────────────────────────────────────
  domain
    .command('discover')
    .description('Scan codebase for domain term candidates')
    .option('--scope <dir>', 'Limit scan directory')
    .option('--recent <days>', 'Only files modified in last N days', parseInt)
    .option('--min-freq <n>', 'Minimum occurrence frequency', parseInt)
    .option('--limit <n>', 'Maximum candidates to show', parseInt)
    .option('--exclude <pattern>', 'Exclude file pattern')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const { scanForDomainTerms } = await import('../tools/domain-scanner.js');
      const projectRoot = process.cwd();

      console.log(`Scanning ${opts.scope || projectRoot} for domain terms...`);

      const candidates = scanForDomainTerms(projectRoot, getWorkflowRoot(), {
        scope: opts.scope,
        recentDays: opts.recent,
        minFreq: opts.minFreq ?? 2,
        limit: opts.limit ?? 20,
        exclude: opts.exclude,
      });

      if (opts.json) {
        console.log(JSON.stringify(candidates, null, 2));
        return;
      }

      if (candidates.length === 0) {
        console.log('No domain term candidates found. Try lowering --min-freq or widening --scope.');
        return;
      }

      console.log(`\n=== DOMAIN TERM CANDIDATES (${candidates.length}) ===\n`);
      console.log(`  #  Term             Freq  Confidence  Source              Auto Definition`);
      console.log(`  ─  ───────────────  ────  ──────────  ──────────────────  ────────────────────────────`);
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const sources = [...new Set(c.sources.map(s => s.kind))].join('+');
        const def = c.autoDefinition
          ? c.autoDefinition.length > 28 ? c.autoDefinition.slice(0, 25) + '...' : c.autoDefinition
          : '(no auto definition)';
        console.log(
          `  ${String(i + 1).padStart(2)}  ${c.normalized.padEnd(15)}  ${String(c.frequency).padStart(4)}  ${c.confidence.toFixed(2).padStart(10)}  ${sources.padEnd(18)}  ${def}`,
        );
      }

      console.log(`\nUse \`maestro domain add "<canonical>" "<definition>"\` to register terms.`);
    });

  // ── import ────────────────────────────────────────────────────────────
  domain
    .command('import')
    .description('Import terms from external sources')
    .option('--from <source>', 'Source: context-package | @<file>')
    .option('--session <path>', 'Session directory for context-package import')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      if (!opts.from) {
        console.error('Error: --from is required (context-package | @<file>)');
        process.exit(1);
      }

      const { existsSync, readFileSync } = await import('node:fs');
      const { readGlossary, GlossaryLock } = await import('../tools/domain-loader.js');
      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { validateGlossary } = await import('../tools/domain-schema.js');

      if (opts.from.startsWith('@')) {
        const filePath = resolve(opts.from.slice(1));
        if (!existsSync(filePath)) {
          console.error(`File not found: ${filePath}`);
          process.exit(1);
        }
        let data: unknown;
        try { data = JSON.parse(readFileSync(filePath, 'utf-8')); } catch (e) {
          console.error(`Invalid JSON: ${(e as Error).message}`);
          process.exit(1);
        }
        const rawTerms: unknown[] = Array.isArray(data) ? data : (data as Record<string, unknown>).terms as unknown[] ?? [];

        const REQUIRED_FIELDS = ['id', 'canonical', 'definition'];
        const now = new Date().toISOString();
        const validated: Array<Record<string, unknown>> = [];
        let skippedInvalid = 0;
        for (const raw of rawTerms) {
          if (!raw || typeof raw !== 'object') { skippedInvalid++; continue; }
          const t = raw as Record<string, unknown>;
          if (REQUIRED_FIELDS.some(f => typeof t[f] !== 'string' || !(t[f] as string).length)) { skippedInvalid++; continue; }
          if (!Array.isArray(t.aliases)) t.aliases = [];
          validated.push(t);
        }

        // Bulk import under single lock
        const lock = new GlossaryLock(getWorkflowRoot());
        let imported = 0;
        let skippedDup = 0;
        try {
          lock.acquire();
          const glossary = readGlossary(getWorkflowRoot());
          const existingIds = new Set(glossary.terms.map(t => t.id));
          for (const t of validated) {
            if (existingIds.has(t.id as string)) { skippedDup++; continue; }
            existingIds.add(t.id as string);
            glossary.terms.push({
              id: t.id as string,
              canonical: t.canonical as string,
              aliases: t.aliases as string[],
              definition: t.definition as string,
              relationships: Array.isArray(t.relationships) ? t.relationships as string[] : [],
              keywords: Array.isArray(t.keywords) ? t.keywords as string[] : [],
              ...(typeof t.tier === 'string' ? { tier: t.tier } : {}),
              ...(typeof t.concept_ref === 'string' ? { concept_ref: t.concept_ref } : {}),
              source: { kind: 'import' as const, registered_at: now },
            } as any);
            imported++;
          }
          const domainPath = join(getWorkflowRoot(), 'domain');
          mkdirSync(domainPath, { recursive: true });
          writeFileSync(join(domainPath, 'glossary.json'), JSON.stringify(glossary, null, 2) + '\n', 'utf-8');
        } finally {
          lock.release();
        }
        console.log(`Imported ${imported} terms (${skippedDup} duplicates, ${skippedInvalid} invalid skipped).`);
      } else {
        console.log(`Import from ${opts.from} — not yet implemented for this source type.`);
      }
    });

  // ── deprecate ─────────────────────────────────────────────────────────
  domain
    .command('deprecate <id>')
    .description('Deprecate a domain term (soft removal)')
    .option('--reason <text>', 'Deprecation reason', 'Deprecated')
    .option('--successor <id>', 'Successor term id')
    .action(async (id: string, opts) => {
      const { deprecateTerm } = await import('../tools/domain-loader.js');
      try {
        deprecateTerm(getWorkflowRoot(), id, opts.reason, opts.successor);
        console.log(`✓ Deprecated: ${id}`);
        if (opts.successor) console.log(`  Successor: ${opts.successor}`);
      } catch (e) {
        console.error(`✗ Failed: ${(e as Error).message}`);
        process.exit(1);
      }
    });

  // ── validate ──────────────────────────────────────────────────────────
  domain
    .command('validate')
    .description('Validate glossary.json schema and relationships')
    .action(async () => {
      const { validateGlossaryFile } = await import('../tools/domain-loader.js');
      const { errors, warnings } = validateGlossaryFile(getWorkflowRoot());

      if (errors.length === 0 && warnings.length === 0) {
        console.log('✓ glossary.json is valid.');
        return;
      }

      if (errors.length > 0) {
        console.error(`\nErrors (${errors.length}):`);
        for (const e of errors) console.error(`  ${e.path}: ${e.message}`);
      }
      if (warnings.length > 0) {
        console.warn(`\nWarnings (${warnings.length}):`);
        for (const w of warnings) console.warn(`  [${w.kind}] ${w.termId}: ${w.message}`);
      }

      if (errors.length > 0) process.exit(1);
    });
}
