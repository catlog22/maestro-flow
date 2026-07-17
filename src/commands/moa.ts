// ---------------------------------------------------------------------------
// `maestro moa` — Mixture-of-Agents exploration via reference + aggregator endpoints
// ---------------------------------------------------------------------------

import { resolve } from 'node:path';
import type { Command } from 'commander';
import {
  loadExploreConfig,
  resolveExploreProxyUrl,
  injectProxy,
  resolveMoaPreset,
  DEFAULT_EXPLORE_MAX_TURNS,
  type PipelineStep,
} from '../agents/api-explore/config.js';
import { checkProxyReachable } from '../config/cli-tools-config.js';
import { moaAgentLoop, type MoaResult } from '../agents/api-explore/moa-loop.js';
import {
  generateSessionId,
  saveSession,
  listSessions,
  loadSession,
  type ExploreSession,
} from '../agents/api-explore/session.js';

function truncatePrompt(prompt: string, maxLen = 60): string {
  const oneLine = prompt.replace(/\n/g, ' ').trim();
  return oneLine.length > maxLen ? oneLine.slice(0, maxLen - 1) + '…' : oneLine;
}

function formatResults(prompts: string[], results: MoaResult[], presetName: string): string {
  if (results.length === 1) {
    return results[0].content || '(no output)';
  }

  const sections: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const promptTag = truncatePrompt(prompts[i] ?? '');
    const header = `── [${i + 1}] ${promptTag} ── MOA (${presetName})`;
    sections.push(`${header}\n${r.content || '(no output)'}`);
  }
  return sections.join('\n\n');
}

function buildMoaMetadata(
  prompts: string[],
  results: MoaResult[],
  presetName: string,
  referenceEndpoints: string[],
): NonNullable<ExploreSession['moa']> {
  return {
    preset: presetName,
    referenceEndpoints,
    results: results.map((r, i) => ({
      prompt: prompts[i] ?? '',
      degraded: r.degraded,
      content: r.content,
      referenceSummaries: r.referenceOutputs.map(ref => ({
        endpointName: ref.endpointName,
        model: ref.model,
        ok: !ref.error && !!ref.content,
        error: ref.error,
      })),
    })),
  };
}

export function registerMoaCommand(program: Command): void {
  const moa = program
    .command('moa [prompts...]')
    .description('Mixture-of-Agents exploration: reference endpoints inform an aggregator')
    .option('--preset <name>', 'MOA preset name (default: from config)')
    .option('--max-turns <n>', 'Max Batch rounds per reference/aggregator (default: 5)', parseInt)
    .option('--cd <dir>', 'Working directory for exploration')
    .option('-o, --output-dir <dir>', 'Save session to custom directory instead of .workflow/explore/')
    .option('--no-save', 'Do not save session')
    .option('--no-cache', 'Bypass MOA reference cache')
    .option('--steps <json>', 'Dynamic pipeline steps (JSON array)')
    .option('--json', 'Output results as JSON')
    .action(async (
      promptArgs: string[],
      opts: {
        preset?: string;
        maxTurns?: number;
        cd?: string;
        outputDir?: string;
        save?: boolean;
        cache?: boolean;
        steps?: string;
        json?: boolean;
      },
    ) => {
      const prompts = promptArgs.filter(Boolean);
      if (prompts.length === 0) {
        console.error(
          'Usage: maestro moa "prompt" [more prompts...]\n\n' +
          'Subcommands:\n' +
          '  maestro moa show               List recent sessions\n' +
          '  maestro moa output <id>         Show session results\n',
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

      const preset = resolveMoaPreset(config, opts.preset);
      if (!preset) {
        process.stderr.write(
          'No MOA preset configured. Add presets to ~/.maestro/moa.json\n' +
          'See: maestro moa --help\n',
        );
        process.exit(1);
      }
      if (proxyUrl) {
        injectProxy(preset.referenceEndpoints, proxyUrl);
        preset.aggregatorEndpoint = {
          ...preset.aggregatorEndpoint,
          llmConfig: { ...preset.aggregatorEndpoint.llmConfig, proxyUrl },
        };
      }

      const cwd = resolve(opts.cd ?? process.cwd());
      const maxTurns = opts.maxTurns ?? DEFAULT_EXPLORE_MAX_TURNS;
      const presetName = opts.preset ?? config.moa?.defaultPreset ?? 'default';
      const referenceEndpoints = preset.referenceEndpoints.map(ep => ep.name);

      let dynamicPipeline: PipelineStep[] | undefined;
      if (opts.steps) {
        try {
          dynamicPipeline = JSON.parse(opts.steps) as PipelineStep[];
          if (!Array.isArray(dynamicPipeline)) throw new Error('steps must be a JSON array');
        } catch (err) {
          process.stderr.write(`Invalid --steps JSON: ${err instanceof Error ? err.message : String(err)}\n`);
          process.exit(1);
        }
      }

      const sessionId = generateSessionId();
      process.stderr.write(
        `[${sessionId}] MOA (${presetName}) — ${prompts.length} prompt(s), maxTurns=${maxTurns}\n`,
      );
      process.stderr.write(
        `  references: ${referenceEndpoints.join(', ')}\n` +
        `  aggregator: ${preset.aggregatorEndpoint.name}:${preset.aggregatorEndpoint.llmConfig.model}\n\n`,
      );

      const startTime = Date.now();
      const results: MoaResult[] = [];
      for (const prompt of prompts) {
        const result = await moaAgentLoop({
          prompt,
          preset,
          cwd,
          maxTurns,
          cache: opts.cache,
          pipeline: dynamicPipeline,
          onProgress: msg => process.stderr.write(msg + '\n'),
        });
        results.push(result);
      }
      const totalDuration = Date.now() - startTime;

      const totalRefIn = results.reduce((sum, r) => sum + r.referenceOutputs.reduce((s, ref) => s + ref.usage.inputTokens, 0), 0);
      const totalRefOut = results.reduce((sum, r) => sum + r.referenceOutputs.reduce((s, ref) => s + ref.usage.outputTokens, 0), 0);
      const totalAggIn = results.reduce((sum, r) => sum + r.usage.aggregator.inputTokens, 0);
      const totalAggOut = results.reduce((sum, r) => sum + r.usage.aggregator.outputTokens, 0);
      process.stderr.write(`\nusage: refs=${totalRefIn}/${totalRefOut} agg=${totalAggIn}/${totalAggOut} total=${totalRefIn + totalAggIn}/${totalRefOut + totalAggOut}\n`);

      if (opts.save !== false) {
        const savedPath = saveSession({
          id: sessionId,
          startedAt: new Date(startTime).toISOString(),
          cwd,
          prompts,
          endpoints: [...referenceEndpoints, preset.aggregatorEndpoint.name],
          totalJobs: prompts.length,
          concurrency: 1,
          maxTurns,
          durationMs: totalDuration,
          results: [],
          moa: buildMoaMetadata(prompts, results, presetName, referenceEndpoints),
        }, opts.outputDir);
        process.stderr.write(`\nSession saved: ${savedPath}\n`);
      }

      if (opts.json) {
        process.stdout.write(JSON.stringify(results, null, 2) + '\n');
      } else {
        process.stdout.write(formatResults(prompts, results, presetName) + '\n');
      }

      const degraded = results.filter(r => r.degraded);
      if (degraded.length > 0) {
        process.stderr.write(`${degraded.length}/${results.length} prompt(s) ran degraded (no reference output).\n`);
      }
    });

  // ---- show subcommand -------------------------------------------------------

  moa
    .command('show')
    .description('List recent MOA/explore sessions')
    .option('--cd <dir>', 'Working directory')
    .option('-o, --output-dir <dir>', 'Custom session directory')
    .action((opts: { cd?: string; outputDir?: string }) => {
      const cwd = resolve(opts.cd ?? process.cwd());
      const sessions = listSessions(cwd, opts.outputDir);

      if (sessions.length === 0) {
        console.log('No sessions found.');
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

  moa
    .command('output <id>')
    .description('Show results from a saved MOA session')
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

      if (opts.json) {
        process.stdout.write(JSON.stringify(session.moa ?? session.results, null, 2) + '\n');
        return;
      }

      if (session.moa) {
        process.stderr.write(
          `[${session.id}] MOA (${session.moa.preset}) — ${session.prompts.length} prompt(s), ` +
          `${(session.durationMs / 1000).toFixed(1)}s total\n` +
          `References: ${session.moa.referenceEndpoints.join(', ')}\n\n`,
        );
        const results: MoaResult[] = session.moa.results.map(r => ({
          content: r.content,
          degraded: r.degraded,
          referenceOutputs: r.referenceSummaries.map(ref => ({
            endpointName: ref.endpointName,
            model: ref.model,
            content: ref.ok ? '' : null,
            error: ref.error,
            durationMs: 0,
            usage: { inputTokens: 0, outputTokens: 0 },
          })),
          usage: { references: [], aggregator: { inputTokens: 0, outputTokens: 0 } },
        }));
        process.stdout.write(formatResults(session.prompts, results, session.moa.preset) + '\n');
      } else {
        process.stderr.write(
          `[${session.id}] ${session.prompts.length} prompt(s), ` +
          `${(session.durationMs / 1000).toFixed(1)}s total (non-MOA session)\n\n`,
        );
        process.stdout.write(JSON.stringify(session.results, null, 2) + '\n');
      }
    });
}
