#!/usr/bin/env node

import {
  copyFileSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const write = process.argv.includes('--write');

const runCommands = new Set([
  'learn-investigate', 'maestro-amend', 'maestro-analyze', 'maestro-blueprint',
  'maestro-brainstorm', 'maestro-collab', 'maestro-companion', 'maestro-execute', 'maestro-fork', 'maestro-grill',
  'maestro-impeccable', 'maestro-merge', 'maestro-next', 'maestro-plan',
  'maestro-player', 'maestro-quick', 'maestro-ralph-cli-execute',
  'maestro-ralph-cli', 'maestro-ralph-execute', 'maestro-ralph-v2',
  'maestro-ralph', 'maestro-roadmap', 'maestro-swarm-workflow',
  'maestro-ui-codify', 'maestro-universal-workflow', 'maestro', 'manage-drift-realign',
  'manage-harvest', 'manage-knowledge-audit', 'manage-status', 'odyssey-debug',
  'odyssey-improve', 'odyssey-planex', 'odyssey-review-test-fix', 'odyssey-ui',
  'quality-auto-test', 'quality-debug', 'quality-refactor',
  'quality-retrospective', 'quality-review', 'quality-test', 'security-audit',
]);

const deprecatedCommands = new Set([
  'maestro-milestone-audit', 'maestro-milestone-complete',
  'maestro-milestone-release',
]);

const runSkills = new Set([
  'scholar-rebuttal-pro', 'scholar-writing', 'skill-generator', 'skill-iter-tune', 'skill-tuning',
  'team-adversarial-swarm', 'team-arch-opt', 'team-brainstorm',
  'team-coordinate', 'team-frontend-debug', 'team-frontend',
  'team-interactive-craft', 'team-issue', 'team-lifecycle-v4',
  'team-motion-design', 'team-perf-opt', 'team-planex',
  'team-quality-assurance', 'team-review', 'team-roadmap-dev', 'team-swarm',
  'team-tech-debt', 'team-testing', 'team-ui-polish', 'team-uidesign',
  'team-designer', 'team-ultra-analyze', 'team-ux-improve', 'team-visual-a11y',
  'workflow-skill-designer',
]);

const legacyPattern = /\.workflow\/(?:scratch|\.scratchpad|\.[a-z-]+|milestones|phases|plans|research|active)|context-package\.json|understanding\.md|evidence\.ndjson|status\.json|finish-work\.md/;

const noneWorkflows = new Set([
  'agy-instructions.md', 'chinese-response.md', 'claude-instructions.md',
  'codex-instructions.md', 'coding-philosophy.md', 'command-authoring.md',
  'delegate-usage.md', 'explore-usage.md', 'instruction-authoring-guide.md',
  'shell-exec-protocol.md', 'skill-authoring.md',
]);
const deprecatedWorkflows = new Set([
  'finish-work.md', 'milestone-audit.md', 'milestone-complete.md',
  'milestone-release.md',
]);

function insertFrontmatterField(text, key, value) {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return text;
  const normalized = text.replace(/\r\n/g, '\n');
  if (new RegExp(`^${key}:`, 'm').test(normalized)) {
    return normalized.replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${value}`);
  }
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) return normalized;
  return `${normalized.slice(0, end)}\n${key}: ${value}${normalized.slice(end)}`;
}

function insertGenericContract(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  if (/^contract:/m.test(normalized)) return normalized;
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) return normalized;
  const contract = `\ncontract:\n  discovery: self-described\n  consumes: []\n  produces: []\n  gates: { entry: [], exit: [] }`;
  return `${normalized.slice(0, end)}${contract}${normalized.slice(end)}`;
}

function commandRunBlock(name) {
  return `\n<run_mode>\n` +
    `**Session mode:** \`run\`. This block is MANDATORY and overrides legacy artifact-path examples below.\n\n` +
    `1. Before domain work, call \`maestro run create ${name} -- $ARGUMENTS\` and use the returned \`run_id\`, \`run_dir\`, and \`upstream\`.\n` +
    `2. Formal JSON/Markdown deliverables MUST be written under \`{run_dir}/outputs/\`; evidence goes to \`{run_dir}/evidence/\`; process narrative and handoff go to \`{run_dir}/report.md\`.\n` +
    `3. The model MUST NOT edit protocol JSON (\`run.json\`, \`session.json\`, \`gates.json\`, \`artifacts.json\`, \`evidence.json\`) or append to project \`state.json.artifacts[]\`.\n` +
    `4. Run \`maestro run check {run_id}\` before completion, repair blocking gaps, then run \`maestro run complete {run_id}\`.\n\n` +
    `**Legacy Compatibility Mapping:** Any later reference to \`scratch/\`, hidden command session directories, \`milestones/\`, \`phases/\`, \`context-package.json\`, \`understanding.md\`, \`evidence.ndjson\`, or a secondary \`status.json\` is a legacy semantic label only. Map formal deliverables to \`outputs/\`, narrative to \`report.md\`, evidence attachments to \`evidence/\`, and orchestration state to the active Session/Run runtime. Never create the legacy formal path.\n` +
    `</run_mode>\n`;
}

function skillRunBlock(name) {
  return `\n<run_mode>\n` +
    `**Session mode:** \`run\`. The coordinator MUST call \`maestro run create ${name} -- $ARGUMENTS\` before creating workers and retain the returned \`run_id\`/\`run_dir\`.\n\n` +
    `- Formal team deliverables go to \`{run_dir}/outputs/\`; evidence and worker traces go to \`{run_dir}/evidence/\`; the final synthesis and handoff go to \`{run_dir}/report.md\`.\n` +
    `- \`.workflow/.team/\` may remain only as the transient Agent message bus. Its \`.msg/\`, lease, and coordination metadata are not formal artifacts and MUST NOT be indexed as Session knowledge.\n` +
    `- **Legacy Compatibility Mapping:** Any legacy \`artifacts/\`, \`wisdom/\`, \`understanding.md\`, \`evidence.ndjson\`, or private session directory mentioned by role files is staging-only; copy the accepted result into the active Run before completion.\n` +
    `- Before reporting success, run \`maestro run check {run_id}\`, fix blocking gaps, then \`maestro run complete {run_id}\`.\n` +
    `</run_mode>\n`;
}

function workflowRunBlock() {
  return `\n## Run Mode Contract\n\n` +
    `This workflow executes inside the Run created by its command. The command-provided \`run_id\`, \`run_dir\`, and resolved \`upstream\` are authoritative. Formal outputs belong in \`{run_dir}/outputs/\`, evidence in \`{run_dir}/evidence/\`, and narrative/handoff in \`{run_dir}/report.md\`. Protocol JSON is CLI-owned.\n\n` +
    `### Legacy Compatibility Mapping\n\n` +
    `Legacy references to \`scratch/\`, hidden command directories, milestone/phase artifact folders, \`context-package.json\`, \`understanding.md\`, \`evidence.ndjson\`, or secondary \`status.json\` describe old semantics only. Do not create those formal paths; map them to the active Run boundary and finish with \`maestro run check\` plus \`maestro run complete\`.\n`;
}

function workflowMode(path) {
  const rel = relative(join(root, 'workflows'), path).replace(/\\/g, '/');
  const base = rel.split('/').at(-1);
  if (rel === 'init.md') return 'bootstrap';
  if (deprecatedWorkflows.has(rel)) return 'deprecated';
  if (noneWorkflows.has(rel) || noneWorkflows.has(base)) return 'none';
  return 'inherited';
}

function workflowSpecialBlock(mode) {
  if (mode === 'bootstrap') {
    return `\n## Bootstrap Boundary\n\nThis workflow runs before any Session exists. It MUST NOT call \`maestro run create\`; project bootstrap files are written through their protected stores.\n`;
  }
  if (mode === 'deprecated') {
    return `\n## Deprecated Workflow Boundary\n\nThis workflow is retained only for migration documentation. Entry commands MUST route to the Session/Run replacement and stop; do not execute the legacy writes below.\n`;
  }
  return '';
}

function setWorkflowMode(text, mode) {
  const normalized = text.replace(/\r\n/g, '\n');
  const marker = `<!-- session-mode: ${mode} -->`;
  const withoutMarker = normalized.replace(/^<!-- session-mode: [^>]+ -->\n?/, '');
  let body = withoutMarker.replace(/\n## Run Mode Contract\n[\s\S]*?(?=\n## |$)/, '');
  body = body.replace(/\n## Bootstrap Boundary\n[\s\S]*?(?=\n## |$)/, '');
  body = body.replace(/\n## Deprecated Workflow Boundary\n[\s\S]*?(?=\n## |$)/, '');
  if (mode === 'inherited' && legacyPattern.test(body)) body = insertWorkflowBlock(body);
  const special = workflowSpecialBlock(mode);
  if (special) {
    const firstHeading = body.match(/^# .+$/m);
    if (firstHeading?.index !== undefined) {
      const lineEnd = body.indexOf('\n', firstHeading.index);
      body = `${body.slice(0, lineEnd + 1)}${special}${body.slice(lineEnd + 1)}`;
    } else body = `${special}\n${body}`;
  }
  return `${marker}\n${body}`;
}

function skillChildRunBlock() {
  return `\n## Run Artifact Boundary\n\n` +
    `This file executes under the parent skill's active Run. The assignment MUST carry \`run_id\` and \`run_dir\`. Formal deliverables go to \`{run_dir}/outputs/\`, evidence/traces to \`{run_dir}/evidence/\`, and synthesis to \`{run_dir}/report.md\`. \`.workflow/.team/\` remains transient coordination only.\n\n` +
    `**Legacy Compatibility Mapping:** Any private session, \`artifacts/\`, \`wisdom/\`, \`understanding.md\`, or \`evidence.ndjson\` path below is staging-only and MUST be promoted into the active Run before completion.\n`;
}

function insertAfterFrontmatter(text, block) {
  const normalized = text.replace(/\r\n/g, '\n');
  if (normalized.includes('<run_mode>')) return normalized;
  if (normalized.startsWith('---\n')) {
    const end = normalized.indexOf('\n---\n', 4);
    if (end >= 0) return `${normalized.slice(0, end + 5)}${block}${normalized.slice(end + 5)}`;
  }
  return `${block}${normalized}`;
}

function insertWorkflowBlock(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  if (normalized.includes('## Run Mode Contract')) return normalized;
  const firstHeading = normalized.match(/^# .+$/m);
  if (!firstHeading || firstHeading.index === undefined) return `${workflowRunBlock()}\n${normalized}`;
  const lineEnd = normalized.indexOf('\n', firstHeading.index);
  return `${normalized.slice(0, lineEnd + 1)}${workflowRunBlock()}${normalized.slice(lineEnd + 1)}`;
}

function insertSkillChildBlock(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  if (normalized.includes('## Run Artifact Boundary')) return normalized;
  const firstHeading = normalized.match(/^# .+$/m);
  if (!firstHeading || firstHeading.index === undefined) return `${skillChildRunBlock()}\n${normalized}`;
  const lineEnd = normalized.indexOf('\n', firstHeading.index);
  return `${normalized.slice(0, lineEnd + 1)}${skillChildRunBlock()}${normalized.slice(lineEnd + 1)}`;
}

function update(path, transform) {
  const before = readFileSync(path, 'utf8');
  const after = transform(before);
  if (before === after) return false;
  if (write) {
    const tmp = `${path}.session-run-tmp`;
    const backup = `${path}.session-run-backup`;
    try {
      writeFileSync(tmp, after, 'utf8');
      if (existsSync(path)) copyFileSync(path, backup);
      rmSync(path, { force: true });
      renameSync(tmp, path);
      rmSync(backup, { force: true });
    } catch (error) {
      rmSync(tmp, { force: true });
      if (existsSync(backup)) {
        rmSync(path, { force: true });
        renameSync(backup, path);
      }
      throw error;
    }
  }
  console.log(`${write ? 'updated' : 'would update'} ${relative(root, path)}`);
  return true;
}

let changed = 0;
const commandDir = join(root, '.claude', 'commands');
for (const file of readdirSync(commandDir).filter((name) => name.endsWith('.md'))) {
  const name = file.slice(0, -3);
  let mode = 'none';
  if (name === 'maestro-init') mode = 'bootstrap';
  else if (deprecatedCommands.has(name)) mode = 'deprecated';
  else if (runCommands.has(name) || name === 'maestro-verify') mode = 'run';
  changed += Number(update(join(commandDir, file), (source) => {
    let text = insertFrontmatterField(source, 'session-mode', mode);
    if (mode === 'run') {
      text = insertGenericContract(text);
      text = insertAfterFrontmatter(text, commandRunBlock(name));
    }
    return text;
  }));
}

const skillDir = join(root, '.claude', 'skills');
for (const dir of readdirSync(skillDir)) {
  const path = join(skillDir, dir, 'SKILL.md');
  if (!existsSync(path)) continue;
  const mode = runSkills.has(dir) ? 'run' : 'none';
  changed += Number(update(path, (source) => {
    let text = insertFrontmatterField(source, 'session-mode', mode);
    if (mode === 'run') text = insertAfterFrontmatter(text, skillRunBlock(dir));
    return text;
  }));
}

function walkMarkdown(dir) {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) out.push(...walkMarkdown(path));
    else if (name.isFile() && name.name.endsWith('.md')) out.push(path);
  }
  return out;
}

for (const path of walkMarkdown(join(root, 'workflows'))) {
  changed += Number(update(path, (source) => setWorkflowMode(source, workflowMode(path))));
}

for (const skillName of runSkills) {
  const dir = join(skillDir, skillName);
  if (!existsSync(dir)) continue;
  for (const path of walkMarkdown(dir)) {
    if (path.endsWith(`${join(skillName, 'SKILL.md')}`) || path === join(dir, 'SKILL.md')) continue;
    const source = readFileSync(path, 'utf8');
    const rel = relative(dir, path).replace(/\\/g, '/');
    if (!legacyPattern.test(source) && !rel.startsWith('roles/')) continue;
    changed += Number(update(path, insertSkillChildBlock));
  }
}

console.log(`${write ? 'updated' : 'planned'} ${changed} files`);
