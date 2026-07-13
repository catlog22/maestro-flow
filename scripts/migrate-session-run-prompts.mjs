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

const RUN_MODE_REF = '@~/.maestro/workflows/run-mode.md';
const obsoleteArtifactPattern = /\.workflow\/(?:scratch|\.scratchpad)|Legacy Compatibility Mapping/;

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

function stripEmbeddedRunMode(text) {
  return text
    .replace(/\n?<run_mode>\s*[\s\S]*?<\/run_mode>\s*/g, '\n')
    .replace(/\n## Run Mode Contract\n[\s\S]*?(?=\n## |$)/g, '')
    .replace(/\n## Run Artifact Boundary\n[\s\S]*?(?=\n## |$)/g, '');
}

function addRequiredReading(text, ref = RUN_MODE_REF) {
  const normalized = text.replace(/\r\n/g, '\n');
  if (normalized.includes(ref)) return normalized;
  const block = normalized.match(/<required_reading>([\s\S]*?)<\/required_reading>/i);
  if (block) {
    return normalized.replace(block[0], `<required_reading>${block[1].trimEnd()}\n${ref}\n</required_reading>`);
  }
  const addition = `\n<required_reading>\n${ref}\n</required_reading>\n`;
  if (normalized.startsWith('---\n')) {
    const end = normalized.indexOf('\n---\n', 4);
    if (end >= 0) return `${normalized.slice(0, end + 5)}${addition}${normalized.slice(end + 5)}`;
  }
  const markerEnd = normalized.startsWith('<!-- session-mode:') ? normalized.indexOf('\n') : -1;
  if (markerEnd >= 0) return `${normalized.slice(0, markerEnd + 1)}${addition}${normalized.slice(markerEnd + 1)}`;
  return `${addition}${normalized}`;
}

function removeRequiredReading(text, ref = RUN_MODE_REF) {
  const normalized = text.replace(/\r\n/g, '\n');
  const block = normalized.match(/<required_reading>([\s\S]*?)<\/required_reading>/i);
  if (!block || !block[1].includes(ref)) return normalized;
  const remaining = block[1].split('\n').map(line => line.trimEnd()).filter(line => line.trim() !== ref && line.trim() !== '');
  return normalized.replace(block[0], remaining.length > 0
    ? `<required_reading>\n${remaining.join('\n')}\n</required_reading>`
    : '');
}

function rewriteObsoleteArtifactPaths(text) {
  return text
    .replaceAll('.workflow/.scratchpad', '{run_dir}/outputs')
    .replaceAll('.workflow/scratch', '{run_dir}/outputs')
    .replace(/\{run_dir\}\/outputs\/(?:\{YYYYMMDD\}|\$\{date\}|\*)[^/\s`"']*\/?/g, '{run_dir}/outputs/')
    .replace(/\{run_dir\}\/outputs\/\$\{[^}]+\}[^/\s`"']*/g, '{run_dir}/outputs')
    .replace(/Legacy Compatibility Mapping:?/g, 'Canonical Run Artifact Boundary:')
    .replace(/state\.json\.artifacts\[\]/g, 'Session ArtifactRegistry (runtime-owned)')
    .replace(/\bscratch directory\b/gi, 'Run output directory')
    .replace(/\bscratch dir\b/gi, 'Run output directory')
    .replace(/\bscratch artifacts\b/gi, 'Run artifacts')
    .replace(/\bscratch tasks\b/gi, 'Run tasks')
    .replace(/\bscratch task\b/gi, 'Run task')
    .replace(/\bscratch mode\b/gi, 'ad-hoc Run mode')
    .replace(/\bscratch session\b/gi, 'Run')
    .replace(/\bscratch fallback\b/gi, 'ArtifactRegistry lookup')
    .replace(/\bscratch_dir\b/g, 'run_dir')
    .replaceAll('.scratchpad-template', 'run-template');
}

function deprecatedCommandStub(text, name) {
  const replacements = {
    'maestro-milestone-audit': '`maestro-verify` or `quality-review` inside the target Session',
    'maestro-milestone-complete': '`maestro run seal-session <session-id>` after all Runs are sealed',
    'maestro-milestone-release': 'the project release workflow after the Session DAG is sealed',
  };
  const normalized = text.replace(/\r\n/g, '\n');
  const end = normalized.indexOf('\n---\n', 4);
  const head = end >= 0 ? normalized.slice(0, end + 5) : normalized;
  return `${head}\n<deprecated_command>\nThis command has been removed. Use ${replacements[name] ?? 'the canonical Session/Run replacement'}. Do not create artifacts from this entry point.\n</deprecated_command>\n`;
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
    return `\n## Removed Workflow\n\nThis workflow no longer executes. Use the canonical Session/Run command replacement.\n`;
  }
  return '';
}

function setWorkflowMode(text, mode) {
  const normalized = text.replace(/\r\n/g, '\n');
  const marker = `<!-- session-mode: ${mode} -->`;
  const withoutMarker = normalized.replace(/^<!-- session-mode: [^>]+ -->\n?/, '');
  let body = stripEmbeddedRunMode(withoutMarker);
  body = body.replace(/\n## Bootstrap Boundary\n[\s\S]*?(?=\n## |$)/, '');
  body = body.replace(/\n## Deprecated Workflow Boundary\n[\s\S]*?(?=\n## |$)/, '');
  if (mode === 'inherited') body = addRequiredReading(rewriteObsoleteArtifactPaths(body));
  if (mode === 'deprecated') return `${marker}${workflowSpecialBlock(mode)}`;
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
      text = addRequiredReading(rewriteObsoleteArtifactPaths(stripEmbeddedRunMode(text)));
    }
    if (mode === 'deprecated') text = deprecatedCommandStub(text, name);
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
    if (mode === 'run') text = addRequiredReading(rewriteObsoleteArtifactPaths(stripEmbeddedRunMode(text)));
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
    const rel = relative(dir, path).replace(/\\/g, '/');
    const executable = rel.startsWith('roles/') || rel.startsWith('phases/') || rel === 'templates/skill-md.md';
    changed += Number(update(path, (source) => {
      const cleaned = rewriteObsoleteArtifactPaths(stripEmbeddedRunMode(source));
      return executable ? addRequiredReading(cleaned) : removeRequiredReading(cleaned);
    }));
  }
}

console.log(`${write ? 'updated' : 'planned'} ${changed} files`);
