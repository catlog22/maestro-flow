#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifySessionRunProfile,
  CODEX_RUN_REF,
  parseFrontmatter,
} from './session-run-profiles.mjs';

const MIRRORS = [
  { root: '.agy', platform: 'agy' },
  { root: '.agents', platform: 'agents-standard' },
  { root: '.codex', platform: 'codex' },
];
const obsoleteRunMode = /\.workflow\/(?:scratch|\.scratchpad)|Legacy Compatibility Mapping|state\.json\.artifacts\[\]|<run_mode>|## Run Mode Contract|## Run Artifact Boundary|\{run_dir\}\/outputs\/(?:\*|\{YYYYMMDD\}|\$\{date\})/;
const claudeOnlyInvocation = /\b(?:Agent|AskUserQuestion|Task)\(/;
const manualRegistryMutation = /Append to `?Session ArtifactRegistry|Register [A-Z]{3} artifact in state\.json/i;
const legacyTeamStateFile = /team-state\.json|(?<!team-)session\.json/;

function walkMarkdown(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(path));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(path);
  }
  return out;
}

function sourceEntries(root) {
  const entries = new Map();
  const commandDir = join(root, '.claude', 'commands');
  const skillDir = join(root, '.claude', 'skills');
  if (existsSync(commandDir)) {
    for (const file of readdirSync(commandDir).filter(name => name.endsWith('.md')).sort()) {
      entries.set(file.replace(/\.md$/, ''), join(commandDir, file));
    }
  }
  if (existsSync(skillDir)) {
    for (const name of readdirSync(skillDir).sort()) {
      const path = join(skillDir, name, 'SKILL.md');
      if (existsSync(path)) entries.set(name, path);
    }
  }
  return entries;
}

function parseFile(path, root, errors) {
  const text = readFileSync(path, 'utf8');
  try {
    const data = parseFrontmatter(text);
    if (!data) throw new Error('frontmatter is missing or not a mapping');
    return { text, data };
  } catch (error) {
    errors.push(`${relative(root, path)}: invalid YAML frontmatter: ${error.message}`);
    return { text, data: null };
  }
}

function expectedMode(sourceMode, platform) {
  return platform === 'codex' && sourceMode === 'brief' ? 'none' : sourceMode;
}

export function lintSessionRunMirrors(root = process.cwd()) {
  const errors = [];
  const packagePath = join(root, 'package.json');
  if (!existsSync(packagePath)) return ['package.json: missing package metadata'];
  const packageVersion = JSON.parse(readFileSync(packagePath, 'utf8')).version;
  const sources = sourceEntries(root);

  for (const mirror of MIRRORS) {
    const skillsDir = join(root, mirror.root, 'skills');
    if (!existsSync(skillsDir)) {
      errors.push(`${mirror.root}/skills: missing mirror root`);
      continue;
    }

    for (const [name, sourcePath] of sources) {
      const path = join(skillsDir, name, 'SKILL.md');
      if (!existsSync(path)) {
        errors.push(`${mirror.root}/skills/${name}/SKILL.md: missing mirror entry`);
        continue;
      }
      const source = parseFile(sourcePath, root, errors);
      const target = parseFile(path, root, errors);
      if (!source.data || !target.data) continue;

      const expected = expectedMode(source.data['session-mode'], mirror.platform);
      if (target.data['session-mode'] !== expected) {
        errors.push(`${relative(root, path)}: session-mode ${String(target.data['session-mode'])} diverges from ${String(expected)}`);
      }
      const sourceProfile = classifySessionRunProfile({
        path: relative(root, sourcePath), kind: 'skill', text: source.text, metadata: source.data,
      });
      const targetProfile = classifySessionRunProfile({
        path: relative(root, path), kind: 'skill', text: target.text, metadata: target.data,
      });
      for (const error of targetProfile.errors) errors.push(`${relative(root, path)}: ${error}`);
      if (targetProfile.profile !== sourceProfile.profile) {
        errors.push(`${relative(root, path)}: lifecycle profile ${targetProfile.profile} diverges from ${sourceProfile.profile}`);
      }

      if (source.data.contract && JSON.stringify(target.data.contract) !== JSON.stringify(source.data.contract)) {
        errors.push(`${relative(root, path)}: nested contract diverges from canonical source`);
      }
      if (expected !== 'run' && target.data.contract) {
        errors.push(`${relative(root, path)}: non-Run mirror retains a Run contract`);
      }
      if (target.data['allowed-tools'] && !Array.isArray(target.data['allowed-tools']) && typeof target.data['allowed-tools'] !== 'string') {
        errors.push(`${relative(root, path)}: allowed-tools must be a string or sequence`);
      }
      if (Array.isArray(target.data['allowed-tools']) && target.data['allowed-tools'].some(tool => typeof tool !== 'string' || /^[\[\]]|[\[\]]$/.test(tool))) {
        errors.push(`${relative(root, path)}: allowed-tools contains malformed tokens`);
      }

      if (mirror.platform !== 'codex') continue;
      if (target.data.version !== packageVersion) {
        errors.push(`${relative(root, path)}: version ${String(target.data.version)} does not match package ${packageVersion}`);
      }
      if (!['run', 'none', 'bootstrap', 'deprecated'].includes(target.data['session-mode'])) {
        errors.push(`${relative(root, path)}: missing or invalid Codex session-mode`);
      }
      if (expected === 'run') {
        if (targetProfile.profile === 'full' && !target.text.includes(CODEX_RUN_REF)) {
          errors.push(`${relative(root, path)}: full Run mode missing Codex adapter reference`);
        }
        if (obsoleteRunMode.test(target.text)) errors.push(`${relative(root, path)}: run mode contains embedded or obsolete lifecycle content`);
        const gates = target.data.contract?.gates ?? { entry: [], exit: [] };
        if (!target.data.contract || !Array.isArray(target.data.contract.consumes) || !Array.isArray(target.data.contract.produces)
          || !Array.isArray(gates.entry) || !Array.isArray(gates.exit)) {
          errors.push(`${relative(root, path)}: run contract missing or unparseable`);
        }
        if (name.startsWith('team-')) {
          for (const childPath of walkMarkdown(join(skillsDir, name))) {
            if (legacyTeamStateFile.test(readFileSync(childPath, 'utf8'))) {
              errors.push(`${relative(root, childPath)}: team skill must use the single team-session.json state authority`);
            }
          }
        }
      }
      if (claudeOnlyInvocation.test(target.text) || manualRegistryMutation.test(target.text)) {
        errors.push(`${relative(root, path)}: contains Claude-only invocation or manual artifact-registry mutation`);
      }
      if (target.text.includes('spawn_agents_on_csv({')) {
        const allowed = Array.isArray(target.data['allowed-tools'])
          ? target.data['allowed-tools']
          : String(target.data['allowed-tools'] ?? '').split(/\s*,\s*/);
        if (!allowed.includes('spawn_agents_on_csv')) {
          errors.push(`${relative(root, path)}: uses spawn_agents_on_csv without declaring it in allowed-tools`);
        }
      }
      if ((target.text.match(/```/g)?.length ?? 0) % 2 !== 0) errors.push(`${relative(root, path)}: unbalanced fenced code blocks`);
      if (expected === 'bootstrap' && !target.text.includes('<bootstrap_mode>')) errors.push(`${relative(root, path)}: bootstrap skill missing protected-store boundary`);
      if (expected === 'deprecated' && !target.text.includes('<deprecated_command>')) errors.push(`${relative(root, path)}: deprecated skill missing replacement boundary`);
    }
  }
  return errors.sort();
}

function main() {
  const errors = lintSessionRunMirrors(process.cwd());
  if (errors.length) {
    console.error(errors.join('\n'));
    console.error(`session-run mirror lint failed: ${errors.length} issue(s)`);
    process.exitCode = 1;
    return;
  }
  console.log('session-run mirror lint passed for .agy, .agents, and .codex');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
