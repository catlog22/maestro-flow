// ---------------------------------------------------------------------------
// Entry command generator — thin slash-command wrappers over `maestro run`.
//
// A generated entry command carries NO domain logic: its body is the Run
// lifecycle invocation (prepare → create → brief → execute → check → complete).
// All domain content lives in the step's prepare/<step>.md + workflows/<step>.md.
//
// Consumed by:
//   - `maestro install entry-commands` (CLI, per-step selection via --steps)
//   - component `commands-entry` (install TUI, default step set)
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import YAML from 'yaml';

/** Steps generated when no explicit selection is given. */
export const DEFAULT_ENTRY_STEPS = ['grill', 'collab'];

/** Steps that already ship a dedicated entry command (mode-qualified). */
const EXCLUDED_STEP_PATTERN = /^odyssey-/;

export interface EntryStepInfo {
  step: string;
  description: string;
  argumentHint: string;
  preparePath: string;
}

function parseFrontmatter(raw: string): Record<string, unknown> {
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  try {
    const parsed = YAML.parse(match[1]);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/**
 * Scan pkgRoot for steps eligible for entry command generation:
 * a step qualifies when both prepare/<step>.md and workflows/<step>.md exist.
 */
export function scanEntrySteps(pkgRoot: string): EntryStepInfo[] {
  const prepareDir = join(pkgRoot, 'prepare');
  if (!existsSync(prepareDir)) return [];
  const steps: EntryStepInfo[] = [];
  for (const entry of readdirSync(prepareDir)) {
    if (!entry.endsWith('.md')) continue;
    const step = basename(entry, '.md');
    if (EXCLUDED_STEP_PATTERN.test(step)) continue;
    if (!existsSync(join(pkgRoot, 'workflows', `${step}.md`))) continue;
    const preparePath = join(prepareDir, entry);
    const fm = parseFrontmatter(readFileSync(preparePath, 'utf-8'));
    steps.push({
      step,
      description: typeof fm.description === 'string' ? fm.description : `Run step ${step}`,
      argumentHint: typeof fm['argument-hint'] === 'string' ? fm['argument-hint'] : '',
      preparePath,
    });
  }
  return steps;
}

export function renderEntryCommand(info: EntryStepInfo): string {
  const hint = info.argumentHint ? `argument-hint: ${JSON.stringify(info.argumentHint)}\n` : '';
  return `---
name: maestro-${info.step}
description: ${JSON.stringify(info.description)}
${hint}allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
session-mode: run
generated-by: maestro install entry-commands
step: ${info.step}
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

<purpose>
Entry command for step \`${info.step}\` — a thin wrapper over the Run lifecycle. All domain logic lives in the step's prepare/workflow files; this command only drives the run verbs.
</purpose>

<execution>
1. \`maestro run prepare ${info.step}\` — read the returned pre-task thinking (purpose, contract, boundaries, risks) before doing anything. Note the returned \`workflow.path\`.
2. Follow run-mode.md: compose an ASCII session slug \`YYYYMMDD-${info.step}-{topic}\`, then run:
   \`maestro run create ${info.step} --session <slug> --intent "<one-line goal>" -- $ARGUMENTS\`
   Retain the returned \`run_id\`, \`run_dir\`, and \`upstream\`.
3. (Optional) \`maestro run brief <run_id>\` — re-attach the execution manual, goals, gate status, and upstream handoff. Recommended when resuming a Run or consuming upstream artifacts; a fresh Run with no upstream may instead read \`workflow.path\` from step 1 directly and skip this.
4. Execute the workflow completely. Write formal artifacts to \`{run_dir}/outputs/\`.
5. \`maestro run check <run_id>\` — repair any blocking artifact or exit gate it reports.
6. \`maestro run complete <run_id>\` — report success only after the Run is completed.
</execution>
`;
}

/**
 * Generate entry commands for the given steps into targetDir
 * (a `.claude/commands` directory). Unknown step names are skipped.
 */
export function buildEntryCommands(
  pkgRoot: string,
  targetDir: string,
  steps: string[] = DEFAULT_ENTRY_STEPS,
): { files: number; written: string[]; unknown: string[] } {
  const eligible = new Map(scanEntrySteps(pkgRoot).map(info => [info.step, info]));
  const written: string[] = [];
  const unknown: string[] = [];
  for (const step of steps) {
    const info = eligible.get(step);
    if (!info) {
      unknown.push(step);
      continue;
    }
    mkdirSync(targetDir, { recursive: true });
    const outPath = join(targetDir, `maestro-${step}.md`);
    writeFileSync(outPath, renderEntryCommand(info), 'utf-8');
    written.push(outPath);
  }
  return { files: written.length, written, unknown };
}
