#!/usr/bin/env node

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
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
  if (!['run', 'none', 'brief', 'bootstrap', 'deprecated'].includes(mode ?? '')) {
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
  if ((mode === 'none' || mode === 'brief') && hasActiveLegacyWrite(text)) {
    errors.push(`${relative(root, path)}: ${kind} classified ${mode} but contains legacy session writes`);
  }
  if ((mode === 'none' || mode === 'brief') && /^contract:/m.test(text)) {
    errors.push(`${relative(root, path)}: ${kind} has a Run contract but is classified ${mode}`);
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
  // Artifact filenames such as understanding.md and evidence.ndjson are also
  // valid inside canonical knowledge stores. Detect legacy locations and
  // runtime-owned protocol files instead of banning those names globally.
  const legacyTarget = String.raw`(?:\.workflow\/(?:scratch|\.scratchpad|\.[a-z-]+|milestones|phases|plans|research|active)[^\s\`"']*|context-package\.json|status\.json)`;
  return new RegExp(String.raw`(?:Write|Edit|write_file|edit_file|write_to_file|replace_file_content)\s*\([^\n]*${legacyTarget}`, 'i').test(text)
    || new RegExp(String.raw`(?:write|append|persist|save|create|update|output(?:s)?(?:\s+files?)?\s+(?:to|in)|session path\s*:)\s*[^\n]*${legacyTarget}`, 'i').test(text);
}

const associatedPrepare = new Map();
const associatedCommands = new Map();

for (const path of walkMarkdown(join(root, 'workflows'))) {
  const text = readFileSync(path, 'utf8');
  const metadata = frontmatter(text);
  const workflowMode = metadata?.['session-mode']
    ?? text.match(/^<!-- session-mode: ([^ ]+) -->/)?.[1];
  if (!workflowMode || !['inherited', 'none', 'bootstrap', 'deprecated'].includes(workflowMode)) {
    errors.push(`${relative(root, path)}: missing or invalid workflow session-mode`);
  }
  if (workflowMode === 'inherited') {
    const canonicalRunMode = path === join(root, 'workflows', 'run-mode.md');
    const inheritsThroughStepMetadata = typeof metadata?.prepare === 'string';
    if (!canonicalRunMode && !inheritsThroughStepMetadata && !text.includes(RUN_MODE_REF)) {
      errors.push(`${relative(root, path)}: inherited workflow missing canonical Run reference`);
    }
    if (obsoleteRunMode.test(text)) errors.push(`${relative(root, path)}: inherited workflow contains embedded or obsolete lifecycle content`);
  }
  if (workflowMode === 'bootstrap' && !text.includes('## Bootstrap Boundary')) {
    errors.push(`${relative(root, path)}: bootstrap workflow missing boundary`);
  }
  if (workflowMode === 'deprecated' && !text.includes('## Removed Workflow')) {
    errors.push(`${relative(root, path)}: removed workflow missing terminal boundary`);
  }

  if (metadata && ('prepare' in metadata || 'commands' in metadata)) {
    const workflowName = basename(path, '.md');
    if (metadata.name !== workflowName) {
      errors.push(`${relative(root, path)}: workflow name must match basename ${workflowName}`);
    }
    if (typeof metadata.prepare !== 'string' || metadata.prepare.length === 0) {
      errors.push(`${relative(root, path)}: workflow association missing prepare`);
    } else {
      const previous = associatedPrepare.get(metadata.prepare);
      if (previous) errors.push(`${relative(root, path)}: prepare ${metadata.prepare} already associated by ${previous}`);
      else associatedPrepare.set(metadata.prepare, relative(root, path));
      if (!existsSync(join(root, 'prepare', `${metadata.prepare}.md`))) {
        errors.push(`${relative(root, path)}: associated prepare/${metadata.prepare}.md does not exist`);
      }
    }
    if (!Array.isArray(metadata.commands) || metadata.commands.length === 0
      || metadata.commands.some(command => typeof command !== 'string' || command.length === 0)) {
      errors.push(`${relative(root, path)}: workflow association requires non-empty commands`);
    } else {
      for (const command of metadata.commands) {
        const previous = associatedCommands.get(command);
        if (previous) errors.push(`${relative(root, path)}: command ${command} already associated by ${previous}`);
        else associatedCommands.set(command, relative(root, path));
      }
    }
  }
}

for (const file of readdirSync(join(root, 'prepare')).filter(name => name.endsWith('.md'))) {
  const step = basename(file, '.md');
  if (!associatedPrepare.has(step)) errors.push(`prepare/${file}: missing workflow YAML association`);
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
