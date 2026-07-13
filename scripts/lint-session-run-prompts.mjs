#!/usr/bin/env node

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import YAML from 'yaml';

const root = process.cwd();
const errors = [];
const commandDir = join(root, '.claude', 'commands');
const skillDir = join(root, '.claude', 'skills');
const RUN_MODE_REF = '@~/.maestro/workflows/run-mode.md';
const obsoleteRunMode = /\.workflow\/(?:scratch|\.scratchpad)|Legacy Compatibility Mapping|state\.json\.artifacts\[\]|<run_mode>|## Run Mode Contract|## Run Artifact Boundary|\{run_dir\}\/outputs\/(?:\*|\{YYYYMMDD\}|\$\{date\})/;

function field(text, name) {
  return text.match(new RegExp(`^${name}:\\s*([^\\r\\n]+)`, 'm'))?.[1]?.trim() ?? null;
}

function frontmatter(text) {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  return match ? YAML.parse(match[1]) : null;
}

function validatePrompt(path, kind) {
  const text = readFileSync(path, 'utf8');
  const mode = field(text, 'session-mode');
  if (!mode) errors.push(`${relative(root, path)}: missing session-mode classification`);
  if (!['run', 'none', 'bootstrap', 'deprecated'].includes(mode ?? '')) {
    errors.push(`${relative(root, path)}: invalid session-mode ${mode}`);
  }
  if (mode === 'run') {
    if (!text.includes(RUN_MODE_REF)) errors.push(`${relative(root, path)}: run mode missing canonical workflow reference`);
    if (obsoleteRunMode.test(text)) errors.push(`${relative(root, path)}: run mode contains embedded or obsolete lifecycle content`);
    if (kind === 'command') {
      const parsed = frontmatter(text);
      const contract = parsed?.contract;
      const gates = contract?.gates ?? { entry: [], exit: [] };
      if (!contract || !Array.isArray(contract.consumes) || !Array.isArray(contract.produces)
        || !Array.isArray(gates.entry) || !Array.isArray(gates.exit)) {
        errors.push(`${relative(root, path)}: run mode contract is missing or unparseable`);
      } else if (contract.produces.length === 0 && contract.discovery !== 'self-described') {
        errors.push(`${relative(root, path)}: empty produces requires discovery: self-described`);
      }
    }
  }
  if (mode === 'deprecated' && !text.includes('<deprecated_command>')) {
    errors.push(`${relative(root, path)}: deprecated command missing mandatory replacement block`);
  }
  if (mode === 'none' && /\.workflow\/(?:scratch|\.scratchpad|\.[a-z-]+|milestones|phases)|context-package\.json|understanding\.md|evidence\.ndjson|status\.json/.test(text)) {
    errors.push(`${relative(root, path)}: ${kind} classified none but contains legacy session writes`);
  }
  if (mode === 'none' && /^contract:/m.test(text)) {
    errors.push(`${relative(root, path)}: ${kind} has a Run contract but is classified none`);
  }
}

for (const file of readdirSync(commandDir).filter((name) => name.endsWith('.md'))) {
  validatePrompt(join(commandDir, file), 'command');
}

for (const dir of readdirSync(skillDir)) {
  const path = join(skillDir, dir, 'SKILL.md');
  if (existsSync(path)) validatePrompt(path, 'skill');
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

function hasActiveLegacyWrite(text) {
  const legacyTarget = String.raw`(?:\.workflow\/(?:scratch|\.scratchpad|\.[a-z-]+|milestones|phases|plans|research|active)[^\s\`"']*|context-package\.json|understanding\.md|evidence\.ndjson|status\.json)`;
  return new RegExp(String.raw`(?:Write|Edit|write_file|edit_file|write_to_file|replace_file_content)\s*\([^\n]*${legacyTarget}`, 'i').test(text)
    || new RegExp(String.raw`(?:write|append|persist|save|create|update|output(?:s)?(?:\s+files?)?\s+(?:to|in)|session path\s*:)\s*[^\n]*${legacyTarget}`, 'i').test(text);
}

for (const path of walkMarkdown(join(root, 'workflows'))) {
  const text = readFileSync(path, 'utf8');
  const workflowMode = text.match(/^<!-- session-mode: ([^ ]+) -->/)?.[1];
  if (!workflowMode || !['inherited', 'none', 'bootstrap', 'deprecated'].includes(workflowMode)) {
    errors.push(`${relative(root, path)}: missing or invalid workflow session-mode`);
  }
  if (workflowMode === 'inherited') {
    if (!text.includes(RUN_MODE_REF)) errors.push(`${relative(root, path)}: inherited workflow missing canonical Run reference`);
    if (obsoleteRunMode.test(text)) errors.push(`${relative(root, path)}: inherited workflow contains embedded or obsolete lifecycle content`);
  }
  if (workflowMode === 'bootstrap' && !text.includes('## Bootstrap Boundary')) {
    errors.push(`${relative(root, path)}: bootstrap workflow missing boundary`);
  }
  if (workflowMode === 'deprecated' && !text.includes('## Removed Workflow')) {
    errors.push(`${relative(root, path)}: removed workflow missing terminal boundary`);
  }
}


for (const dir of readdirSync(skillDir)) {
  const skillPath = join(skillDir, dir, 'SKILL.md');
  if (!existsSync(skillPath)) continue;
  const skillText = readFileSync(skillPath, 'utf8');
  if (field(skillText, 'session-mode') !== 'run') continue;
  for (const path of walkMarkdown(join(skillDir, dir))) {
    if (path === skillPath) continue;
    const text = readFileSync(path, 'utf8');
    const rel = relative(join(skillDir, dir), path).replace(/\\/g, '/');
    const executable = rel.startsWith('roles/') || rel.startsWith('phases/') || rel === 'templates/skill-md.md';
    if (executable && !text.includes(RUN_MODE_REF)) errors.push(`${relative(root, path)}: executable run skill child missing canonical Run reference`);
    if (obsoleteRunMode.test(text)) errors.push(`${relative(root, path)}: run skill child contains embedded or obsolete lifecycle content`);
  }
}

const canonicalRunMode = join(root, 'workflows', 'run-mode.md');
if (!existsSync(canonicalRunMode)) errors.push('workflows/run-mode.md: missing canonical Run workflow');
else {
  const text = readFileSync(canonicalRunMode, 'utf8');
  for (const token of ['maestro run create', 'same normalized intent', '{run_dir}/outputs/', 'maestro run check', 'maestro run complete']) {
    if (!text.includes(token)) errors.push(`workflows/run-mode.md: missing ${token}`);
  }
}

for (const dir of readdirSync(skillDir)) {
  const skillPath = join(skillDir, dir, 'SKILL.md');
  if (!existsSync(skillPath)) continue;
  const skillText = readFileSync(skillPath, 'utf8');
  if (field(skillText, 'session-mode') !== 'none') continue;
  for (const path of walkMarkdown(join(skillDir, dir))) {
    if (hasActiveLegacyWrite(readFileSync(path, 'utf8'))) {
      errors.push(`${relative(root, path)}: none skill subtree contains an active legacy session write`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  console.error(`session-run prompt lint failed: ${errors.length} issue(s)`);
  process.exit(1);
}

const commandCount = readdirSync(commandDir).filter((name) => name.endsWith('.md')).length;
const skillCount = readdirSync(skillDir).filter((dir) => existsSync(join(skillDir, dir, 'SKILL.md'))).length;
console.log(`session-run prompt lint passed: ${commandCount} commands, ${skillCount} skills`);
