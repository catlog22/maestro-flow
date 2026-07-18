// ---------------------------------------------------------------------------
// `maestro ralph skills` — list effective commands + skills.
// `--steps` additionally lists the step registry (prepare/ + workflows/) so
// chain-build prevalidation can resolve lifecycle step names (analyze/plan/
// execute/…), which live outside `.claude/` and only resolve at run time via
// `resolveStepContent`.
// ---------------------------------------------------------------------------

import { scanAllSkills, type SkillPlatform } from './skill-scanner.js';
import { listResolvableSteps } from '../run/contract.js';

export interface SkillsCmdOptions {
  json?: boolean;
  quiet?: boolean;
  platform?: SkillPlatform;
  steps?: boolean;
}

const VALID_PLATFORMS: SkillPlatform[] = ['claude', 'codex', 'agent', 'agy'];

export async function runSkills(opts: SkillsCmdOptions): Promise<number> {
  if (opts.platform && !VALID_PLATFORMS.includes(opts.platform)) {
    console.error(`[ralph skills] --platform must be one of: ${VALID_PLATFORMS.join(', ')} (got "${opts.platform}")`);
    return 2;
  }
  if (!opts.platform) {
    console.error(`[ralph skills] WARNING: --platform not specified — returning ALL platforms.`);
    console.error(`  Available: ${VALID_PLATFORMS.join(', ')}`);
    console.error(`  Usage: maestro ralph skills --platform <claude|codex|agent|agy>`);
    console.error('');
  }
  const all = scanAllSkills(undefined, opts.platform ? { platform: opts.platform } : {});
  // Steps are platform-neutral: the same prepare/workflows registry serves every
  // platform (per-platform `.codex.md`-style overrides need the base file anyway).
  const steps = opts.steps ? listResolvableSteps(process.cwd()) : [];

  if (opts.json) {
    for (const s of all) {
      process.stdout.write(JSON.stringify({
        type: s.type,
        scope: s.scope,
        platform: s.platform,
        name: s.name,
        path: s.filePath,
        hint: s.argumentHint,
        description: s.description,
        required: s.requiredCount,
        deferred: s.deferredCount,
        missing_required: s.missingRequired,
      }) + '\n');
    }
    for (const s of steps) {
      process.stdout.write(JSON.stringify({
        type: 'step',
        scope: s.scope,
        platform: 'all',
        name: s.name,
        path: s.path,
        source: s.source,
      }) + '\n');
    }
    return 0;
  }

  if (!opts.quiet) {
    const header = pad('PLATFORM', 9) + pad('TYPE', 9) + pad('SCOPE', 9) + pad('NAME', 32) + pad('HINT', 28) + 'REQ DEF';
    console.log(header);
    console.log('─'.repeat(Math.max(80, header.length)));
  }
  for (const s of all) {
    const hint = s.argumentHint || '—';
    const missingMark = s.missingRequired.length > 0 ? '!' : ' ';
    const line =
      pad(s.platform, 9) +
      pad(s.type, 9) +
      pad(s.scope, 9) +
      pad(s.name, 32) +
      pad(hint.slice(0, 26), 28) +
      `${String(s.requiredCount).padStart(3)} ${String(s.deferredCount).padStart(3)} ${missingMark}`;
    console.log(line);
  }
  for (const s of steps) {
    console.log(
      pad('all', 9) +
      pad('step', 9) +
      pad(s.scope, 9) +
      pad(s.name, 32) +
      pad(s.source, 28) +
      '  -   -',
    );
  }
  if (!opts.quiet) {
    const counts = countByType(all);
    const platformLabel = opts.platform ? ` [${opts.platform}]` : '';
    const missing = all.filter(s => s.missingRequired.length > 0).length;
    const stepLabel = opts.steps ? `, ${steps.length} step` : '';
    console.log('');
    console.log(`  ${all.length + steps.length} entries${platformLabel} (${counts.command} command, ${counts.skill} skill${stepLabel})` +
      (missing > 0 ? ` — ${missing} with missing required_reading (!)` : ''));
  }
  return 0;
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width - 1) + ' ';
  return s + ' '.repeat(width - s.length);
}

function countByType(all: ReturnType<typeof scanAllSkills>) {
  return all.reduce((acc, s) => { acc[s.type] += 1; return acc; }, { command: 0, skill: 0 } as { command: number; skill: number });
}
