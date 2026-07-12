#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import YAML from 'yaml';

const root = process.cwd();
const write = process.argv.includes('--write');
const codexRoot = join(root, '.codex', 'skills');
const claudeCommands = join(root, '.claude', 'commands');
const claudeSkills = join(root, '.claude', 'skills');
const legacyPattern = /\.workflow\/(?:scratch|\.scratchpad|\.[a-z-]+|milestones|phases|plans|research|active)|context-package\.json|understanding\.md|evidence\.ndjson|status\.json/;

function splitFrontmatter(text) {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!match) return { data: {}, body: text };
  return { data: YAML.parse(match[1]) ?? {}, body: text.slice(match[0].length) };
}

function sourceMode(name) {
  const command = join(claudeCommands, `${name}.md`);
  const skill = join(claudeSkills, name, 'SKILL.md');
  const source = existsSync(command) ? command : (existsSync(skill) ? skill : null);
  if (!source) return null;
  return splitFrontmatter(readFileSync(source, 'utf8')).data['session-mode'] ?? null;
}

function genericContract() {
  return { discovery: 'self-described', consumes: [], produces: [], gates: { entry: [], exit: [] } };
}

function runBlock(name) {
  return `<run_mode>\n` +
    `**Session mode:** \`run\`. This boundary is mandatory and overrides legacy Codex session-path examples below.\n\n` +
    `1. Before domain work, call \`maestro run create ${name} -- $ARGUMENTS\` and retain the returned \`run_id\`, \`run_dir\`, and \`upstream\`.\n` +
    `2. Formal deliverables go to \`{run_dir}/outputs/\`; evidence and worker traces go to \`{run_dir}/evidence/\`; synthesis and handoff go to \`{run_dir}/report.md\`.\n` +
    `3. Do not edit protocol JSON or append to project \`state.json.artifacts[]\`.\n` +
    `4. Finish with \`maestro run check {run_id}\` and \`maestro run complete {run_id}\`.\n\n` +
    `**Legacy Compatibility Mapping:** Later references to scratch, hidden command/team directories, milestones, phases, \`context-package.json\`, \`understanding.md\`, \`evidence.ndjson\`, or secondary \`status.json\` are semantic labels only. Map them into the active Run and never create a second formal truth source.\n` +
    `</run_mode>\n\n`;
}

function specialBlock(mode) {
  if (mode === 'bootstrap') {
    return `<bootstrap_mode>\nThis skill initializes protected project state before a Session exists. It MUST NOT call \`maestro run create\`; bootstrap files remain owned by their protected stores.\n</bootstrap_mode>\n\n`;
  }
  if (mode === 'deprecated') {
    return `<deprecated_command>\nThis Codex skill is retained for compatibility only. Route to the Session/Run replacement named by the canonical Claude command and stop; do not execute legacy milestone/session writes below.\n</deprecated_command>\n\n`;
  }
  return '';
}

function removeManagedBlock(body) {
  return body.replace(/^<(?:run_mode|bootstrap_mode|deprecated_command)>\r?\n[\s\S]*?<\/(?:run_mode|bootstrap_mode|deprecated_command)>\r?\n*/u, '');
}

let changed = 0;
for (const entry of readdirSync(codexRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const path = join(codexRoot, entry.name, 'SKILL.md');
  if (!existsSync(path)) continue;
  const before = readFileSync(path, 'utf8');
  const { data, body } = splitFrontmatter(before);
  let mode = sourceMode(entry.name);
  if (!mode) mode = legacyPattern.test(body) ? 'run' : 'none';
  if (mode === 'none' && legacyPattern.test(body)) mode = 'run';
  data['session-mode'] = mode;
  if (mode === 'run' && !data.contract) data.contract = genericContract();
  if (mode !== 'run') delete data.contract;
  const cleanBody = removeManagedBlock(body);
  const after = `---\n${YAML.stringify(data).trimEnd()}\n---\n\n${mode === 'run' ? runBlock(entry.name) : specialBlock(mode)}${cleanBody.replace(/^\s+/, '')}`;
  if (after === before) continue;
  changed++;
  if (write) writeFileSync(path, after, 'utf8');
  console.log(`${write ? 'updated' : 'would update'} ${relative(root, path)}`);
}

console.log(`${write ? 'updated' : 'planned'} ${changed} Codex skills`);
