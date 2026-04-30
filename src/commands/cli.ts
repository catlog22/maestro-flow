// ---------------------------------------------------------------------------
// `maestro cli` — unified CLI agent command
// Runs agent tools (gemini, qwen, codex, claude, opencode) with a shared
// interface for prompt, mode, model, working directory, templates, and more.
// ---------------------------------------------------------------------------

import type { Command } from 'commander';
import { resolve } from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { CliAgentRunner } from '../agents/cli-agent-runner.js';
import { CliHistoryStore } from '../agents/cli-history-store.js';
import type { ExecutionMeta, EntryLike } from '../agents/cli-history-store.js';
import { loadCliToolsConfig, selectTool, selectToolByRole } from '../config/cli-tools-config.js';
import {
  deriveExecutionStatus,
  padRight,
  truncate,
} from '../utils/cli-format.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusLabel(meta: ExecutionMeta): string {
  const s = deriveExecutionStatus(meta);
  return s === 'completed' ? 'done' : s === 'unknown' ? `exit:${meta.exitCode ?? '?'}` : s;
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerCliCommand(program: Command): void {
  const cli = program
    .command('cli')
    .description('Run CLI agent tools with unified interface');

  // ---- Main execution (default action) ------------------------------------

  cli
    .option('-p, --prompt <prompt>', 'Prompt to send to the agent')
    .option('--tool <name>', 'CLI tool to use (gemini, qwen, codex, claude, opencode)')
    .option('--role <role>', 'Capability role for auto tool selection (analyze, explore, review, implement, plan, brainstorm, research)')
    .option('--mode <mode>', 'Execution mode (analysis or write)', 'analysis')
    .option('--model <model>', 'Model override')
    .option('--cd <dir>', 'Working directory')
    .option('--rule <template>', 'Template name — auto-loads protocol + template appended to prompt')
    .option('--id <id>', 'Execution ID (auto-generated if omitted)')
    .option('--resume [id]', 'Resume previous session (last if no id)')
    .option('--includeDirs <dirs>', 'Additional directories (comma-separated)')
    .action(async (opts: {
      prompt?: string;
      tool?: string;
      role?: string;
      mode: string;
      model?: string;
      cd?: string;
      rule?: string;
      id?: string;
      resume?: string | true;
      includeDirs?: string;
    }) => {
      if (!opts.prompt) {
        console.error('error: required option \'-p, --prompt <prompt>\' not specified');
        process.exit(1);
      }

      const workDir = resolve(opts.cd ?? process.cwd());
      const config = await loadCliToolsConfig(workDir);

      // Tool resolution priority: --tool > --role > first-enabled fallback
      let selected;
      if (opts.tool) {
        if (opts.role) {
          process.stderr.write(`Warning: --tool overrides --role; using tool "${opts.tool}" directly.\n`);
        }
        selected = selectTool(opts.tool, config);
      } else if (opts.role) {
        selected = selectToolByRole(opts.role, config);
      } else {
        selected = selectTool(undefined, config);
      }

      const toolName = selected?.name ?? opts.tool ?? 'gemini';
      const model = opts.model ?? selected?.entry?.primaryModel;
      const mode = opts.mode as 'analysis' | 'write';

      if (mode !== 'analysis' && mode !== 'write') {
        console.error(`Invalid mode: ${opts.mode}. Use "analysis" or "write".`);
        process.exit(1);
      }

      try {
        const runner = new CliAgentRunner();
        const exitCode = await runner.run({
          prompt: opts.prompt,
          tool: toolName,
          mode,
          model,
          workDir,
          rule: opts.rule,
          execId: opts.id,
          resume: opts.resume === true ? 'last' : opts.resume,
          includeDirs: opts.includeDirs?.split(',').map(d => d.trim()).filter(Boolean),
          settingsFile: selected?.entry?.settingsFile,
          baseTool: selected?.entry?.baseTool,
        });
        process.exit(exitCode);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`CLI agent failed: ${message}`);
        process.exit(1);
      }
    });

  // ---- show subcommand ----------------------------------------------------

  cli
    .command('show')
    .description('List recent CLI executions')
    .option('--all', 'Include full history')
    .action((opts: { all?: boolean }) => {
      const store = new CliHistoryStore();
      const limit = opts.all ? 100 : 20;
      const items = store.listRecent(limit);

      if (items.length === 0) {
        console.log('No recent executions.');
        return;
      }

      // Column widths
      const colId = 24;
      const colTool = 10;
      const colMode = 10;
      const colStatus = 10;
      const colPrompt = 50;

      const header = [
        padRight('ID', colId),
        padRight('Tool', colTool),
        padRight('Mode', colMode),
        padRight('Status', colStatus),
        padRight('Prompt', colPrompt),
      ].join('  ');

      const sep = '-'.repeat(header.length);

      console.log(header);
      console.log(sep);

      for (const meta of items) {
        const row = [
          padRight(meta.execId, colId),
          padRight(meta.tool, colTool),
          padRight(meta.mode, colMode),
          padRight(statusLabel(meta), colStatus),
          padRight(truncate(meta.prompt, colPrompt), colPrompt),
        ].join('  ');
        console.log(row);
      }
    });

  // ---- watch subcommand ---------------------------------------------------

  cli
    .command('watch <id>')
    .description('Stream execution output in real-time until completion')
    .option('--timeout <ms>', 'Auto-exit after N milliseconds', '120000')
    .action(async (id: string, opts: { timeout: string }) => {
      const store = new CliHistoryStore();
      const jsonlPath = store.jsonlPathFor(id);
      const timeoutMs = parseInt(opts.timeout, 10) || 120_000;

      // Check if execution exists (meta or jsonl)
      const meta = store.loadMeta(id);
      if (!meta) {
        // No meta yet — might still be starting; check if jsonl exists
        try {
          statSync(jsonlPath);
        } catch {
          console.error(`Execution not found: ${id}`);
          process.exit(1);
        }
      }

      // If already completed, just dump output and exit
      if (meta?.completedAt) {
        const output = store.getOutput(id);
        if (output) process.stderr.write(output);
        process.exit(meta.exitCode === 0 ? 0 : 1);
        return;
      }

      // Tail the JSONL file, rendering entries to stderr
      let offset = 0;
      let finished = false;
      let exitCode = 0;

      const poll = () => {
        let raw: string;
        try {
          raw = readFileSync(jsonlPath, 'utf-8');
        } catch {
          return; // file not ready yet
        }

        const lines = raw.split('\n');
        for (let i = offset; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          try {
            const entry = JSON.parse(line) as EntryLike;
            // Render to stderr
            if (entry.type === 'assistant_message' && entry.partial !== true) {
              process.stderr.write(String(entry.content ?? ''));
            } else if (entry.type === 'tool_use') {
              if (entry.status === 'running') {
                process.stderr.write(`[Tool: ${entry.name}]\n`);
              } else if (entry.status === 'completed' || entry.status === 'failed') {
                process.stderr.write(`[Tool ${entry.name}: ${entry.status}]\n`);
              }
            } else if (entry.type === 'error') {
              process.stderr.write(`Error: ${entry.message}\n`);
            } else if (entry.type === 'token_usage') {
              process.stderr.write(`[Tokens: ${entry.inputTokens}in/${entry.outputTokens}out]\n`);
            } else if (entry.type === 'status_change') {
              if (entry.status === 'stopped') {
                finished = true;
                exitCode = 0;
              } else if (entry.status === 'error') {
                finished = true;
                exitCode = 1;
              }
            }
          } catch {
            // skip malformed
          }
        }
        offset = lines.length;
      };

      // Also check meta.json for completion (safety net when stopped event missing)
      const checkMeta = () => {
        const m = store.loadMeta(id);
        if (m?.completedAt) {
          finished = true;
          exitCode = m.exitCode === 0 ? 0 : 1;
        }
      };

      const startTime = Date.now();
      await new Promise<void>((res) => {
        const interval = setInterval(() => {
          poll();
          checkMeta();
          if (finished || Date.now() - startTime > timeoutMs) {
            clearInterval(interval);
            if (!finished && Date.now() - startTime > timeoutMs) {
              process.stderr.write('\n[watch timeout]\n');
              exitCode = 2;
            }
            res();
          }
        }, 500);
      });

      process.exit(exitCode);
    });

  // ---- output subcommand --------------------------------------------------

  cli
    .command('output <id>')
    .description('Get assistant output for a CLI execution')
    .option('--verbose', 'Show full metadata and raw output')
    .option('--tail <n>', 'Show last N lines of output', parseInt)
    .option('--lines <n>', 'Alias for --tail', parseInt)
    .action((id: string, opts: { verbose?: boolean; tail?: number; lines?: number }) => {
      const store = new CliHistoryStore();
      const meta = store.loadMeta(id);

      if (!meta) {
        console.error(`Execution not found: ${id}`);
        process.exit(1);
      }

      // Always show status header
      const status = statusLabel(meta);
      const elapsed = meta.completedAt
        ? `${((new Date(meta.completedAt).getTime() - new Date(meta.startedAt).getTime()) / 1000).toFixed(1)}s`
        : 'running';
      console.error(`[${meta.execId}] ${meta.tool}/${meta.mode} — ${status} (${elapsed})`);

      if (opts.verbose) {
        console.error(`Start:  ${meta.startedAt}`);
        if (meta.completedAt) {
          console.error(`End:    ${meta.completedAt}`);
        }
        console.error('---');
      }

      const output = store.getOutput(id);
      if (!output) {
        console.error(`No output available for: ${id}`);
        process.exit(1);
      }

      const tailN = opts.tail ?? opts.lines;
      if (tailN && tailN > 0) {
        const lines = output.split('\n');
        const sliced = lines.slice(-tailN);
        process.stdout.write(sliced.join('\n'));
      } else {
        process.stdout.write(output);
      }
    });
}
