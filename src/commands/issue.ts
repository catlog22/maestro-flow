import type { Command } from 'commander';
import { resolve } from 'node:path';
import {
  closeIssue,
  createIssue,
  getIssue,
  linkIssue,
  listIssues,
  updateIssue,
  type IssueRecord,
} from '../issues/store.js';

const ACTIVE_STATUSES = new Set(['open', 'in_progress']);
const FINAL_STATUSES = new Set(['completed', 'failed', 'deferred']);
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);

function root(opts: { workflowRoot?: string }): string {
  return resolve(opts.workflowRoot ?? '.workflow');
}

function output(value: unknown, json?: boolean): void {
  if (json) console.log(JSON.stringify(value, null, 2));
  else if (Array.isArray(value)) {
    for (const issue of value as IssueRecord[]) {
      console.log(`${issue.id}\t${issue.status}\t${issue.severity ?? '-'}\t${issue.priority ?? '-'}\t${issue.title}`);
    }
  } else {
    const issue = value as IssueRecord;
    console.log(`${issue.id}\t${issue.status}\t${issue.title}`);
  }
}

function fail(error: unknown): void {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

export function registerIssueCommand(program: Command): void {
  const issue = program.command('issue').description('Lightweight local issue lifecycle management');
  issue.option('--workflow-root <path>', 'Path to .workflow', '.workflow');

  issue.command('create')
    .description('Create an issue')
    .requiredOption('--title <title>', 'Issue title')
    .option('--severity <value>', 'critical|high|medium|low', 'medium')
    .option('--source <value>', 'Issue source', 'manual')
    .option('--priority <number>', 'Priority 1-5', value => Number(value), 3)
    .option('--description <text>', 'Detailed description')
    .option('--tags <csv>', 'Comma-separated tags')
    .option('--json', 'Output JSON')
    .action(async opts => {
      try {
        if (!SEVERITIES.has(opts.severity)) throw new Error(`Invalid severity: ${opts.severity}`);
        if (!Number.isInteger(opts.priority) || opts.priority < 1 || opts.priority > 5) throw new Error('Priority must be an integer from 1 to 5');
        const created = await createIssue(root(issue.opts()), {
          title: opts.title,
          severity: opts.severity,
          source: opts.source,
          priority: opts.priority,
          description: opts.description,
          tags: opts.tags?.split(',').map((tag: string) => tag.trim()).filter(Boolean),
        });
        output(created, opts.json);
      } catch (error) { fail(error); }
    });

  issue.command('list')
    .description('List issues')
    .option('--status <value>', 'Comma-separated statuses')
    .option('--severity <value>', 'Filter severity')
    .option('--source <value>', 'Filter source')
    .option('--all', 'Include closed history')
    .option('--json', 'Output JSON')
    .action(opts => {
      try {
        const statuses = opts.status ? new Set(String(opts.status).split(',')) : null;
        const issues = listIssues(root(issue.opts()), opts.all)
          .filter(record => !statuses || statuses.has(record.status))
          .filter(record => !opts.severity || record.severity === opts.severity)
          .filter(record => !opts.source || record.source === opts.source)
          .sort((a, b) => Number(a.priority ?? 3) - Number(b.priority ?? 3));
        output(opts.json ? { issues, total: issues.length } : issues, opts.json);
      } catch (error) { fail(error); }
    });

  issue.command('status <id>')
    .description('Show an issue')
    .option('--json', 'Output JSON')
    .action((id, opts) => {
      try {
        const found = getIssue(root(issue.opts()), id);
        if (!found) throw new Error(`Issue not found: ${id}`);
        output(found, opts.json);
      } catch (error) { fail(error); }
    });

  issue.command('update <id>')
    .description('Update an active issue')
    .option('--status <value>', 'open|in_progress')
    .option('--priority <number>', 'Priority 1-5', value => Number(value))
    .option('--severity <value>', 'critical|high|medium|low')
    .option('--tags <csv>', 'Replace tags')
    .option('--fix-direction <text>', 'Fix direction or solution locator')
    .option('--description <text>', 'Detailed description')
    .option('--note <text>', 'Append feedback note')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      try {
        if (opts.status && !ACTIVE_STATUSES.has(opts.status)) throw new Error(`Invalid active status: ${opts.status}`);
        if (opts.severity && !SEVERITIES.has(opts.severity)) throw new Error(`Invalid severity: ${opts.severity}`);
        if (opts.priority !== undefined && (!Number.isInteger(opts.priority) || opts.priority < 1 || opts.priority > 5)) throw new Error('Priority must be an integer from 1 to 5');
        const updates: Record<string, unknown> = {};
        for (const key of ['status', 'priority', 'severity', 'description'] as const) if (opts[key] !== undefined) updates[key] = opts[key];
        if (opts.tags !== undefined) updates.tags = opts.tags.split(',').map((tag: string) => tag.trim()).filter(Boolean);
        if (opts.fixDirection !== undefined) updates.fix_direction = opts.fixDirection;
        if (Object.keys(updates).length === 0 && !opts.note) throw new Error('No updates specified');
        output(await updateIssue(root(issue.opts()), id, updates, opts.note), opts.json);
      } catch (error) { fail(error); }
    });

  issue.command('close <id>')
    .description('Close and archive an issue')
    .requiredOption('--resolution <text>', 'Resolution summary')
    .option('--status <value>', 'completed|failed|deferred', 'completed')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      try {
        if (!FINAL_STATUSES.has(opts.status)) throw new Error(`Invalid final status: ${opts.status}`);
        output(await closeIssue(root(issue.opts()), id, opts.status, opts.resolution), opts.json);
      } catch (error) { fail(error); }
    });

  issue.command('link <id>')
    .description('Link an issue to a task reference')
    .requiredOption('--task <id>', 'Task reference')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      try { output(await linkIssue(root(issue.opts()), id, opts.task), opts.json); }
      catch (error) { fail(error); }
    });
}
