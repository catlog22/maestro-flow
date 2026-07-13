#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import YAML from 'yaml';

const root = process.cwd();
const write = process.argv.includes('--write');
const codexRoot = join(root, '.codex', 'skills');
const claudeCommands = join(root, '.claude', 'commands');
const claudeSkills = join(root, '.claude', 'skills');
const RUN_MODE_REF = '@~/.maestro/workflows/run-mode.md';
const obsoleteArtifactPattern = /\.workflow\/(?:scratch|\.scratchpad)|Legacy Compatibility Mapping/;

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

function addRequiredReading(body) {
  if (body.includes(RUN_MODE_REF)) return body;
  const block = body.match(/<required_reading>([\s\S]*?)<\/required_reading>/i);
  if (block) return body.replace(block[0], `<required_reading>${block[1].trimEnd()}\n${RUN_MODE_REF}\n</required_reading>`);
  return `<required_reading>\n${RUN_MODE_REF}\n</required_reading>\n\n${body}`;
}

function specialBlock(mode) {
  if (mode === 'bootstrap') {
    return `<bootstrap_mode>\nThis skill initializes protected project state before a Session exists. It MUST NOT call \`maestro run create\`; bootstrap files remain owned by their protected stores.\n</bootstrap_mode>\n\n`;
  }
  if (mode === 'deprecated') {
    return `<deprecated_command>\nThis command has been removed. Use the canonical Session/Run replacement and do not create artifacts from this entry point.\n</deprecated_command>\n`;
  }
  return '';
}

function removeManagedBlock(body) {
  return body.replace(/^<(?:run_mode|bootstrap_mode|deprecated_command)>\r?\n[\s\S]*?<\/(?:run_mode|bootstrap_mode|deprecated_command)>\r?\n*/u, '');
}

function rewriteObsoleteArtifactPaths(body) {
  return body
    .replaceAll('.workflow/.scratchpad', '{run_dir}/outputs')
    .replaceAll('.workflow/scratch', '{run_dir}/outputs')
    .replace(/\{run_dir\}\/outputs\/(?:\{YYYYMMDD\}|\$\{date\}|\*)[^/\s`"']*\/?/g, '{run_dir}/outputs/')
    .replace(/Legacy Compatibility Mapping:?/g, 'Canonical Run Artifact Boundary:')
    .replace(/state\.json\.artifacts\[\]/g, 'Session ArtifactRegistry (runtime-owned)')
    .replace(/\bscratch directory\b/gi, 'Run output directory')
    .replace(/\bscratch dir\b/gi, 'Run output directory')
    .replace(/\bscratch artifacts\b/gi, 'Run artifacts')
    .replace(/\bscratch tasks?\b/gi, 'Run tasks')
    .replace(/\bscratch mode\b/gi, 'ad-hoc Run mode')
    .replace(/\bscratch session\b/gi, 'Run')
    .replace(/\bscratch fallback\b/gi, 'ArtifactRegistry lookup')
    .replace(/\bscratch_dir\b/g, 'run_dir');
}

let changed = 0;
for (const entry of readdirSync(codexRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const path = join(codexRoot, entry.name, 'SKILL.md');
  if (!existsSync(path)) continue;
  const before = readFileSync(path, 'utf8');
  const { data, body } = splitFrontmatter(before);
  let mode = sourceMode(entry.name);
  if (!mode) mode = obsoleteArtifactPattern.test(body) ? 'run' : 'none';
  if (mode === 'none' && obsoleteArtifactPattern.test(body)) mode = 'run';
  data['session-mode'] = mode;
  if (mode === 'run' && !data.contract) data.contract = genericContract();
  if (mode !== 'run') delete data.contract;
  let cleanBody = mode === 'deprecated' ? '' : rewriteObsoleteArtifactPaths(removeManagedBlock(body)).replace(/^\s+/, '');
  if (mode === 'run') cleanBody = addRequiredReading(cleanBody);
  const after = `---\n${YAML.stringify(data).trimEnd()}\n---\n\n${specialBlock(mode)}${cleanBody}`.trimEnd() + '\n';
  if (after === before) continue;
  changed++;
  if (write) writeFileSync(path, after, 'utf8');
  console.log(`${write ? 'updated' : 'would update'} ${relative(root, path)}`);
}

console.log(`${write ? 'updated' : 'planned'} ${changed} Codex skills`);
