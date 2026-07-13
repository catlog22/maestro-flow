#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import YAML from 'yaml';

const root = process.cwd();
const errors = [];
const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const RUN_MODE_REF = '@~/.maestro/workflows/run-mode.md';
const CODEX_RUN_REF = '@~/.maestro/workflows/codex-run-mode.md';
const obsoleteRunMode = /\.workflow\/(?:scratch|\.scratchpad)|Legacy Compatibility Mapping|state\.json\.artifacts\[\]|<run_mode>|## Run Mode Contract|## Run Artifact Boundary|\{run_dir\}\/outputs\/(?:\*|\{YYYYMMDD\}|\$\{date\})/;
const claudeOnlyInvocation = /\b(?:Agent|AskUserQuestion|Task)\(/;
const manualRegistryMutation = /Append to `?Session ArtifactRegistry|Register [A-Z]{3} artifact in state\.json/i;

function parse(path) {
  const text = readFileSync(path, 'utf8');
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    errors.push(`${relative(root, path)}: missing YAML frontmatter`);
    return { text, data: null };
  }
  try {
    const data = YAML.parse(match[1]);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('frontmatter is not a mapping');
    return { text, data };
  } catch (error) {
    errors.push(`${relative(root, path)}: invalid YAML frontmatter: ${error.message}`);
    return { text, data: null };
  }
}

function sourceFor(name) {
  const skill = join(root, '.claude', 'skills', name, 'SKILL.md');
  const command = join(root, '.claude', 'commands', `${name}.md`);
  return existsSync(skill) ? skill : (existsSync(command) ? command : null);
}

for (const mirror of ['.agy', '.agents']) {
  const dir = join(root, mirror, 'skills');
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name, 'SKILL.md');
    if (!existsSync(path)) continue;
    const target = parse(path);
    const sourcePath = sourceFor(entry.name);
    if (!sourcePath || !target.data) continue;
    const source = parse(sourcePath);
    if (!source.data) continue;
    if (target.data['session-mode'] !== source.data['session-mode']) {
      errors.push(`${relative(root, path)}: session-mode diverges from ${relative(root, sourcePath)}`);
    }
    if (source.data.contract && JSON.stringify(target.data.contract) !== JSON.stringify(source.data.contract)) {
      errors.push(`${relative(root, path)}: nested contract diverges from canonical source`);
    }
    if (target.data['allowed-tools'] && !Array.isArray(target.data['allowed-tools']) && typeof target.data['allowed-tools'] !== 'string') {
      errors.push(`${relative(root, path)}: allowed-tools must be a string or sequence`);
    }
    if (Array.isArray(target.data['allowed-tools']) && target.data['allowed-tools'].some((tool) => typeof tool !== 'string' || /^[\[\]]|[\[\]]$/.test(tool))) {
      errors.push(`${relative(root, path)}: allowed-tools contains malformed tokens`);
    }
  }
}

const codexDir = join(root, '.codex', 'skills');
for (const entry of readdirSync(codexDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const path = join(codexDir, entry.name, 'SKILL.md');
  if (!existsSync(path)) continue;
  const { text, data } = parse(path);
  if (!data) continue;
  const mode = data['session-mode'];
  if (data.version !== packageVersion) {
    errors.push(`${relative(root, path)}: version ${String(data.version)} does not match package ${packageVersion}`);
  }
  if (!['run', 'none', 'bootstrap', 'deprecated'].includes(mode)) {
    errors.push(`${relative(root, path)}: missing or invalid session-mode`);
  }
  if (mode === 'run') {
    if (!text.includes(RUN_MODE_REF)) errors.push(`${relative(root, path)}: run mode missing canonical workflow reference`);
    if (!text.includes(CODEX_RUN_REF)) errors.push(`${relative(root, path)}: run mode missing Codex adapter reference`);
    if (obsoleteRunMode.test(text)) errors.push(`${relative(root, path)}: run mode contains embedded or obsolete lifecycle content`);
    const gates = data.contract?.gates ?? { entry: [], exit: [] };
    if (!data.contract || !Array.isArray(data.contract.consumes) || !Array.isArray(data.contract.produces)
      || !Array.isArray(gates.entry) || !Array.isArray(gates.exit)) {
      errors.push(`${relative(root, path)}: run contract missing or unparseable`);
    }
    const sourcePath = sourceFor(entry.name);
    if (sourcePath) {
      const source = parse(sourcePath);
      if (source.data?.contract && JSON.stringify(data.contract) !== JSON.stringify(source.data.contract)) {
        errors.push(`${relative(root, path)}: Run contract diverges from canonical source`);
      }
    }
  }
  if (claudeOnlyInvocation.test(text) || manualRegistryMutation.test(text)) {
    errors.push(`${relative(root, path)}: contains Claude-only invocation or manual artifact-registry mutation`);
  }
  if (text.includes('spawn_agents_on_csv({')) {
    const allowed = Array.isArray(data['allowed-tools']) ? data['allowed-tools'] : String(data['allowed-tools'] ?? '').split(/\s*,\s*/);
    if (!allowed.includes('spawn_agents_on_csv')) {
      errors.push(`${relative(root, path)}: uses spawn_agents_on_csv without declaring it in allowed-tools`);
    }
  }
  if ((text.match(/```/g)?.length ?? 0) % 2 !== 0) {
    errors.push(`${relative(root, path)}: unbalanced fenced code blocks`);
  }
  if (mode === 'bootstrap' && !text.includes('<bootstrap_mode>')) {
    errors.push(`${relative(root, path)}: bootstrap skill missing protected-store boundary`);
  }
  if (mode === 'deprecated' && !text.includes('<deprecated_command>')) {
    errors.push(`${relative(root, path)}: deprecated skill missing replacement boundary`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`session-run mirror lint failed: ${errors.length} issue(s)`);
  process.exit(1);
}
console.log('session-run mirror lint passed for .agy, .agents, and .codex');
