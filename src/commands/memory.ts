import type { Command } from 'commander';
import { resolve } from 'node:path';

import { loadMemoryConfig } from '../memory/config.js';
import { extractWorkingMemoryFacts } from '../memory/extract.js';
import { promotePendingFacts, promoteWorkingMemoryFact } from '../memory/promote.js';
import { recallWorkingMemory } from '../memory/recall.js';
import { forgetFact, listFacts, rememberFact, upsertFacts } from '../memory/store.js';
import type { MemoryScope } from '../memory/types.js';

export function registerMemoryCommand(program: Command): void {
  const memory = program
    .command('memory')
    .description('Working-memory facts (personal practice plane; not Spec/Knowhow)');

  memory
    .command('remember <text>')
    .description('Store an explicit working-memory fact')
    .option('--scope <scope>', 'user | project | session', 'project')
    .option('--session <id>', 'Host session id (required for --scope session)')
    .option('--workflow-root <path>', 'Project root containing .workflow', process.cwd())
    .option('--json', 'Output as JSON')
    .action((text: string, opts: { scope: string; session?: string; workflowRoot: string; json?: boolean }) => {
      const scope = (['user', 'project', 'session'] as const).includes(opts.scope as MemoryScope)
        ? opts.scope as MemoryScope
        : 'project';
      if (scope === 'session' && !opts.session) {
        console.error('memory remember --scope session requires --session <id>');
        process.exitCode = 1;
        return;
      }
      try {
        const fact = rememberFact(resolve(opts.workflowRoot), text, 'user', scope, opts.session);
        if (opts.json) {
          console.log(JSON.stringify(fact));
          return;
        }
        console.log(`${fact.id}\t${fact.text}`);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  memory
    .command('list')
    .description('List working-memory facts')
    .option('--all', 'Include superseded and decayed facts')
    .option('--session <id>', 'Only include matching session-scoped facts')
    .option('--workflow-root <path>', 'Project root containing .workflow', process.cwd())
    .option('--json', 'Output as JSON')
    .action((opts: { all?: boolean; session?: string; workflowRoot: string; json?: boolean }) => {
      const root = resolve(opts.workflowRoot);
      const facts = listFacts(root, {
        status: opts.all ? 'all' : 'active',
        sessionId: opts.session,
      }, loadMemoryConfig(root));
      if (opts.json) {
        console.log(JSON.stringify(facts));
        return;
      }
      for (const fact of facts) console.log(`${fact.id}\t${fact.status}\t${fact.topic}\t${fact.text}`);
    });

  memory
    .command('forget <id>')
    .description('Remove a working-memory fact by id')
    .option('--workflow-root <path>', 'Project root containing .workflow', process.cwd())
    .action((id: string, opts: { workflowRoot: string }) => {
      const removed = forgetFact(resolve(opts.workflowRoot), id);
      if (!removed) {
        console.error(`Working memory fact not found: ${id}`);
        process.exitCode = 1;
      }
    });

  memory
    .command('extract')
    .description('Extract working-memory facts from text or a host transcript (local only)')
    .option('--text <text>', 'Conversation text to extract from')
    .option('--transcript <path>', 'Host transcript JSONL/JSON path')
    .option('--workflow-root <path>', 'Project root containing .workflow', process.cwd())
    .option('--json', 'Output as JSON')
    .action((opts: { text?: string; transcript?: string; workflowRoot: string; json?: boolean }) => {
      if (!opts.text && !opts.transcript) {
        console.error('Provide --text or --transcript');
        process.exitCode = 1;
        return;
      }
      const root = resolve(opts.workflowRoot);
      const extracted = extractWorkingMemoryFacts({
        transcript: opts.text,
        transcript_path: opts.transcript,
      });
      const upserted = upsertFacts(root, extracted, loadMemoryConfig(root));
      if (opts.json) {
        console.log(JSON.stringify({ extracted, ...upserted }));
        return;
      }
      if (upserted.added.length === 0 && upserted.updated.length === 0) {
        console.log('0 facts added');
        return;
      }
      for (const fact of [...upserted.added, ...upserted.updated]) console.log(`${fact.id}\t${fact.text}`);
    });

  memory
    .command('recall [query]')
    .description('Print the working-memory block that hooks would inject')
    .option('--session <id>', 'Host session id for session-scoped facts')
    .option('--workflow-root <path>', 'Project root containing .workflow', process.cwd())
    .option('--json', 'Output as JSON')
    .action(async (query: string | undefined, opts: { session?: string; workflowRoot: string; json?: boolean }) => {
      const root = resolve(opts.workflowRoot);
      const result = await recallWorkingMemory(root, query ?? '', {
        config: loadMemoryConfig(root),
        sessionId: opts.session,
      });
      if (opts.json) {
        console.log(JSON.stringify(result));
        return;
      }
      if (result.content) console.log(result.content);
    });

  memory
    .command('promote [id]')
    .description('Stage working-memory fact(s) as knowledge candidates (review/promote pipeline)')
    .option('--run <runId>', 'Canonical Run ID to attribute the candidate')
    .option('--session <sessionId>', 'Session ID')
    .option('--pending', 'Stage every pending active fact')
    .option('--workflow-root <path>', 'Project root containing .workflow', process.cwd())
    .option('--json', 'Output as JSON')
    .action((id: string | undefined, opts: { run?: string; session?: string; pending?: boolean; workflowRoot: string; json?: boolean }) => {
      const root = resolve(opts.workflowRoot);
      try {
        if (opts.pending || !id) {
          const staged = promotePendingFacts(root, { runId: opts.run, sessionId: opts.session });
          if (opts.json) {
            console.log(JSON.stringify(staged));
            return;
          }
          for (const item of staged) {
            console.log(`${item.fact_id}\t${item.skipped ? item.reason ?? 'skipped' : item.candidate_id}`);
          }
          return;
        }
        const result = promoteWorkingMemoryFact(root, id, opts.run, opts.session);
        if (opts.json) {
          console.log(JSON.stringify(result));
          return;
        }
        console.log(`${result.candidate_id}\t${result.run_id ?? result.session_id}`);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
