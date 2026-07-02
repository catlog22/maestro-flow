// ---------------------------------------------------------------------------
// `maestro explore` — lightweight parallel code exploration via API endpoints
// ---------------------------------------------------------------------------

import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import type { Command } from 'commander';
import {
  loadExploreConfig,
  resolveEndpoints,
  getAllEndpoints,
  resolveExploreProxyUrl,
  injectProxy,
  resolveMoaPreset,
  type ResolvedMoaPreset,
} from '../agents/api-explore/config.js';
import { checkProxyReachable } from '../config/cli-tools-config.js';
import { buildJobs, buildJobsFromEntries, runExploreJobs, type ExploreResult } from '../agents/api-explore/runner.js';
import {
  generateSessionId,
  saveSession,
  listSessions,
  loadSession,
} from '../agents/api-explore/session.js';

function truncatePrompt(prompt: string, maxLen = 60): string {
  const oneLine = prompt.replace(/\n/g, ' ').trim();
  return oneLine.length > maxLen ? oneLine.slice(0, maxLen - 1) + '…' : oneLine;
}

function formatResults(results: ExploreResult[]): string {
  if (results.length === 1) {
    const r = results[0];
    if (r.error) return `Error (${r.endpointName}/${r.model}): ${r.error}`;
    return r.content ?? '(no output)';
  }

  const sections: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const promptTag = truncatePrompt(r.prompt);
    const header = `── [${i + 1}] ${promptTag} ── ${r.endpointName} (${r.model}) ${(r.durationMs / 1000).toFixed(1)}s`;
    if (r.error) {
      sections.push(`${header}\nError: ${r.error}`);
    } else {
      sections.push(`${header}\n${r.content ?? '(no output)'}`);
    }
  }
  return sections.join('\n\n');
}

export interface PromptEntry {
  prompt: string;
  endpoint?: string;
}

function loadPromptsFromFile(filePath: string): PromptEntry[] {
  const abs = resolve(filePath);
  if (!existsSync(abs)) {
    throw new Error(`Prompt file not found: ${abs}`);
  }
  const raw = readFileSync(abs, 'utf-8');

  if (filePath.endsWith('.json')) {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((item: unknown) => {
        if (typeof item === 'string') return { prompt: item };
        if (item && typeof item === 'object' && 'prompt' in item) {
          const obj = item as { prompt: unknown; endpoint?: unknown };
          return {
            prompt: String(obj.prompt),
            endpoint: obj.endpoint ? String(obj.endpoint) : undefined,
          };
        }
        throw new Error('JSON array items must be strings or objects with a "prompt" field');
      });
    }
    throw new Error('JSON file must contain an array of prompts');
  }

  return raw.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean).map(p => ({ prompt: p }));
}

export function registerExploreCommand(program: Command): void {
  const explore = program
    .command('explore [prompts...]')
    .description('Lightweight parallel code exploration via API endpoints')
    .option('-f, --file <path>', 'Load prompts from a JSON or text file')
    .option('-e, --endpoint <names>', 'Endpoint name(s), comma-separated (default: first available)')
    .option('--all', 'Fan out to all configured endpoints')
    .option('--parallel <n>', 'Max concurrent endpoint queues (default: from config or 4)', parseInt)
    .option('--ep-concurrency <n>', 'Max concurrent jobs per endpoint (default: 1 = serial)', parseInt)
    .option('--max-turns <n>', 'Max agent turns per job (default: from config or 6)', parseInt)
    .option('--cd <dir>', 'Working directory for exploration')
    .option('-o, --output-dir <dir>', 'Save session to custom directory instead of .workflow/explore/')
    .option('--no-save', 'Do not save session')
    .option('--json', 'Output results as JSON')
    .option('--moa [preset]', 'Route through MOA (optional preset name)')
    .action(async (
      promptArgs: string[],
      opts: {
        file?: string;
        endpoint?: string;
        all?: boolean;
        parallel?: number;
        epConcurrency?: number;
        maxTurns?: number;
        cd?: string;
        outputDir?: string;
        save?: boolean;
        json?: boolean;
        moa?: string | boolean;
      },
    ) => {
      const entries: PromptEntry[] = promptArgs.map(p => ({ prompt: p }));
      if (opts.file) {
        try {
          entries.push(...loadPromptsFromFile(opts.file));
        } catch (err) {
          console.error(`Error loading prompt file: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
      }

      if (entries.length === 0) {
        console.error(
          'Usage: maestro explore "prompt" [more prompts...]\n' +
          '       maestro explore -f prompts.json\n\n' +
          'Subcommands:\n' +
          '  maestro explore show               List recent sessions\n' +
          '  maestro explore output <id>         Show session results\n',
        );
        process.exit(1);
      }

      const config = loadExploreConfig();
      let proxyUrl = resolveExploreProxyUrl(config);
      if (proxyUrl) {
        const reachable = await checkProxyReachable(proxyUrl);
        if (!reachable) {
          process.stderr.write(`Warning: proxy ${proxyUrl} is unreachable, proceeding without proxy.\n`);
          proxyUrl = undefined;
        }
      }
      const cwd = resolve(opts.cd ?? process.cwd());
      const maxTurns = opts.maxTurns ?? config.maxTurns ?? 6;
      const concurrency = opts.parallel ?? config.concurrency ?? 4;

      let resolvedPreset: ResolvedMoaPreset | undefined;
      if (opts.moa) {
        resolvedPreset = resolveMoaPreset(
          config,
          typeof opts.moa === 'string' ? opts.moa : undefined,
        ) ?? undefined;
        if (!resolvedPreset) {
          console.error(
            'No MOA preset configured. Add "moa" section to ~/.maestro/api-explore.json',
          );
          process.exit(1);
        }
        if (resolvedPreset && proxyUrl) {
          injectProxy(resolvedPreset.referenceEndpoints, proxyUrl);
          resolvedPreset.aggregatorEndpoint = {
            ...resolvedPreset.aggregatorEndpoint,
            llmConfig: { ...resolvedPreset.aggregatorEndpoint.llmConfig, proxyUrl },
          };
        }
      }

      const globalEndpoints = resolveEndpoints(config, opts.endpoint, opts.all);
      injectProxy(globalEndpoints, proxyUrl);

      if (globalEndpoints.length === 0) {
        console.error(
          'No endpoints configured.\n' +
          'Configure ~/.maestro/api-explore.json with "endpoints" or legacy fields.\n' +
          'Run `maestro explore --help` for details.',
        );
        process.exit(1);
      }

      const allEps = getAllEndpoints(config);
      injectProxy(allEps, proxyUrl);
      const jobs = opts.all
        ? buildJobs(entries.map(e => e.prompt), globalEndpoints)
        : buildJobsFromEntries(entries, globalEndpoints, allEps);
      const totalJobs = jobs.length;

      const sessionId = generateSessionId();
      const usedEndpoints = [...new Set(jobs.map(j => j.endpointName))];
      process.stderr.write(
        `[${sessionId}] ${entries.length} prompt(s), ${totalJobs} job(s), concurrency=${concurrency}\n`,
      );
      for (const name of usedEndpoints) {
        const model = jobs.find(j => j.endpointName === name)?.llmConfig.model ?? '?';
        process.stderr.write(`  ${name}: ${model}\n`);
      }
      process.stderr.write('\n');

      const epConcurrency = opts.epConcurrency ?? 1;
      const startTime = Date.now();
      const results = await runExploreJobs({
        jobs,
        cwd,
        maxTurns,
        concurrency,
        endpointConcurrency: epConcurrency,
        moaPreset: resolvedPreset,
        onProgress: (msg) => process.stderr.write(`${msg}\n`),
      });
      const totalDuration = Date.now() - startTime;

      // Save session
      if (opts.save !== false) {
        const savedPath = saveSession({
          id: sessionId,
          startedAt: new Date(startTime).toISOString(),
          cwd,
          prompts: entries.map(e => e.prompt),
          endpoints: usedEndpoints,
          totalJobs,
          concurrency,
          maxTurns,
          durationMs: totalDuration,
          results,
          moa: resolvedPreset ? {
            preset: typeof opts.moa === 'string' ? opts.moa : 'default',
            referenceEndpoints: resolvedPreset.referenceEndpoints.map(ep => ep.name),
            results: [],
          } : undefined,
        }, opts.outputDir);
        process.stderr.write(`\nSession saved: ${savedPath}\n`);
      }

      if (opts.json) {
        process.stdout.write(JSON.stringify(results, null, 2) + '\n');
      } else {
        process.stdout.write(formatResults(results) + '\n');
      }

      const failed = results.filter(r => r.error);
      if (failed.length > 0) {
        process.stderr.write(`${failed.length}/${totalJobs} job(s) failed.\n`);
        process.exit(1);
      }
    });

  // ---- show subcommand -------------------------------------------------------

  explore
    .command('show')
    .description('List recent explore sessions')
    .option('--cd <dir>', 'Working directory')
    .option('-o, --output-dir <dir>', 'Custom session directory')
    .action((opts: { cd?: string; outputDir?: string }) => {
      const cwd = resolve(opts.cd ?? process.cwd());
      const sessions = listSessions(cwd, opts.outputDir);

      if (sessions.length === 0) {
        console.log('No explore sessions found.');
        return;
      }

      console.log('ID                          Prompts  Duration');
      console.log('─'.repeat(55));
      for (const s of sessions) {
        const dur = `${(s.durationMs / 1000).toFixed(1)}s`;
        console.log(`${s.id.padEnd(28)} ${String(s.prompts).padEnd(9)} ${dur}`);
      }
    });

  // ---- output subcommand -----------------------------------------------------

  explore
    .command('output <id>')
    .description('Show results from a saved explore session')
    .option('--cd <dir>', 'Working directory')
    .option('-o, --output-dir <dir>', 'Custom session directory')
    .option('--json', 'Output as JSON')
    .action((id: string, opts: { cd?: string; outputDir?: string; json?: boolean }) => {
      const cwd = resolve(opts.cd ?? process.cwd());
      const session = loadSession(cwd, id, opts.outputDir);

      if (!session) {
        console.error(`Session not found: ${id}`);
        process.exit(1);
      }

      process.stderr.write(
        `[${session.id}] ${session.prompts.length} prompt(s), ${(session.durationMs / 1000).toFixed(1)}s total\n` +
        `Endpoints: ${session.endpoints.join(', ')}\n\n`,
      );

      if (opts.json) {
        process.stdout.write(JSON.stringify(session.results, null, 2) + '\n');
      } else {
        process.stdout.write(formatResults(session.results) + '\n');
      }
    });
}
