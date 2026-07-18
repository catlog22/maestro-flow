#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import YAML from 'yaml';

const root = process.cwd();
const write = process.argv.includes('--write');
const check = process.argv.includes('--check') || !write;
const onlyIndex = process.argv.findIndex(arg => arg === '--only');
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice('--only='.length)
  ?? (onlyIndex >= 0 ? process.argv[onlyIndex + 1] : null);
const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const codexRoot = join(root, '.codex', 'skills');
const claudeCommands = join(root, '.claude', 'commands');
const claudeSkills = join(root, '.claude', 'skills');
const RUN_MODE_REF = '@~/.maestro/workflows/run-mode.md';
const RUN_MODE_LITE_REF = '@~/.maestro/workflows/run-mode-lite.md';
const CODEX_RUN_REF = '@~/.maestro/workflows/codex-run-mode.md';
const obsoleteArtifactPattern = /\.workflow\/(?:scratch|\.scratchpad)|Legacy Compatibility Mapping/;

function splitFrontmatter(text) {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!match) return { data: {}, body: text };
  return { data: YAML.parse(match[1]) ?? {}, body: text.slice(match[0].length) };
}

function sourceMetadata(name) {
  const command = join(claudeCommands, `${name}.md`);
  const skill = join(claudeSkills, name, 'SKILL.md');
  const source = existsSync(command) ? command : (existsSync(skill) ? skill : null);
  if (!source) return null;
  const text = readFileSync(source, 'utf8');
  const data = splitFrontmatter(text).data;
  const usesLite = text.includes(RUN_MODE_LITE_REF);
  return { mode: data['session-mode'] ?? null, contract: data.contract ?? null, usesLite };
}

function genericContract() {
  return { discovery: 'self-described', consumes: [], produces: [], gates: { entry: [], exit: [] } };
}

function addRequiredReading(body, usesLite = false) {
  const runRef = usesLite ? RUN_MODE_LITE_REF : RUN_MODE_REF;
  const block = body.match(/<required_reading>([\s\S]*?)<\/required_reading>/i);
  if (block) {
    let refs = block[1].split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    refs = refs.filter(r => r !== RUN_MODE_REF && r !== RUN_MODE_LITE_REF && r !== CODEX_RUN_REF);
    refs.unshift(runRef);
    if (!usesLite) refs.push(CODEX_RUN_REF);
    return body.replace(block[0], `<required_reading>\n${refs.join('\n')}\n</required_reading>`);
  }
  const refsBlock = usesLite ? runRef : `${runRef}\n${CODEX_RUN_REF}`;
  return `<required_reading>\n${refsBlock}\n</required_reading>\n\n${body}`;
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

function removeManagedRunReading(body) {
  const block = body.match(/^<required_reading>([\s\S]*?)<\/required_reading>\s*/i);
  if (!block) return body;
  const refs = block[1].split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    .filter(ref => ref !== RUN_MODE_REF && ref !== RUN_MODE_LITE_REF && ref !== CODEX_RUN_REF);
  const replacement = refs.length > 0 ? `<required_reading>\n${refs.join('\n')}\n</required_reading>\n\n` : '';
  return body.replace(block[0], replacement);
}

function rewriteObsoleteArtifactPaths(body) {
  return body
    .replaceAll('.workflow/.scratchpad', '{run_dir}/outputs')
    .replaceAll('.workflow/scratch', '{run_dir}/outputs')
    .replace(/\{run_dir\}\/outputs\/(?:\{YYYYMMDD\}|\$\{date\}|\*)[^/\s`"']*\/?/g, '{run_dir}/outputs/')
    .replace(/Legacy Compatibility Mapping:?/g, 'Canonical Run Artifact Boundary:')
    .replace(/state\.json\.artifacts\[\]/g, 'Session ArtifactRegistry (runtime-owned)')
    .replace(/state\.json\.artifacts\[[^\]]+\]/g, 'the upstream map returned by `maestro run create`')
    .replace(/state\.json artifact registry/gi, 'Session `artifacts.json` registry')
    .replace(/state\.json for type=([a-z-]+) artifacts/gi, 'the Run upstream map for kind=$1 artifacts')
    .replace(/Query state\.json for type=([a-z-]+) artifacts/gi, 'Query the Run upstream map for kind=$1 artifacts')
    .replace(/\.workflow\/\.csv-wave\/\{[^\n`]+\}/g, '{run_dir}/work/csv-wave')
    .replace(/\.workflow\/\.csv-wave\//g, '{run_dir}/work/csv-wave/')
    .replace(/finish-work \(archive\.json[^)]*\)/gi, '`maestro run check` then `maestro run complete`')
    .replace(/finish-work/gi, '`maestro run check` then `maestro run complete`')
    .replace(/archive\.json/g, 'sealed Run metadata')
    .replace(/([A-Z]{3}) artifact MUST be registered in state\.json/gi, 'Declared $1 contract outputs MUST be present before `maestro run complete`')
    .replace(/Register artifact in state\.json/gi, 'Let `maestro run complete` register declared typed artifacts')
    .replace(/Artifact registered in state\.json \(type=([a-z-]+)[^)]*\)/gi, 'Declared kind=$1 output registered by `maestro run complete`')
    .replace(/Artifact MUST be registered in state\.json/gi, 'Declared typed output MUST be present before `maestro run complete`')
    .replace(/Artifact registered in state\.json/gi, 'Declared typed output registered by `maestro run complete`')
    .replace(/Register ([A-Z]{3}) artifact in state\.json[^\n]*/gi, 'Validate declared $1 outputs; `maestro run complete` performs registry mutation.')
    .replace(/([A-Z]{3}) artifact registered in state\.json[^\n]*/gi, 'Declared $1 output registered by `maestro run complete`')
    .replace(/state\.json updated with ([A-Z]{3}) artifact[^\n]*/gi, 'Declared $1 output registered by `maestro run complete`')
    .replace(/Artifact registration in state\.json/gi, 'Typed artifact registration by `maestro run complete`')
    .replace(/state\.json artifacts（[^）]+）/gi, 'Session `artifacts.json` and the Run upstream map')
    .replace(/state\.json artifacts\s*\([^)]*\)/gi, 'Session `artifacts.json` and the Run upstream map')
    .replace(/per-phase `scratch\/\*\/index\.json`, task files `scratch\/\*\/\.task\/TASK-\*\.json`/gi, 'Session Run metadata and typed plan artifacts')
    .replace(/Copy worktree `scratch\/\*` to main `\{run_dir\}\/outputs\/`/gi, 'Merge canonical `.workflow/sessions/` records and referenced Run artifacts')
    .replace(/path: "scratch\/\{YYYYMMDD\}-([^"\n]+)"/g, 'path: "runs/{run_id}/outputs/$1"')
    .replace(/注册 ([A-Z]{3}) artifact、更新 index\.json/gi, '校验 $1 contract outputs，并由 `maestro run complete` 注册 typed artifacts')
    .replace(/\{run_dir\}\/outputs\/refactor-\{slug\}-\{date\}\/?/g, '{run_dir}/outputs/')
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
  if (only && entry.name !== only) continue;
  const path = join(codexRoot, entry.name, 'SKILL.md');
  if (!existsSync(path)) continue;
  const before = readFileSync(path, 'utf8');
  const { data, body } = splitFrontmatter(before);
  const source = sourceMetadata(entry.name);
  let mode = source?.mode ?? null;
  if (!mode) mode = obsoleteArtifactPattern.test(body) ? 'run' : 'none';
  if (mode === 'brief') mode = 'none';
  data.version = packageVersion;
  data['session-mode'] = mode;
  if (mode === 'run') data.contract = source?.contract ?? data.contract ?? genericContract();
  if (mode !== 'run') delete data.contract;
  let cleanBody = mode === 'deprecated'
    ? ''
    : rewriteObsoleteArtifactPaths(removeManagedRunReading(removeManagedBlock(body))).replace(/^\s+/, '');
  if (mode === 'run') cleanBody = addRequiredReading(cleanBody, source?.usesLite ?? false);
  const after = `---\n${YAML.stringify(data).trimEnd()}\n---\n\n${specialBlock(mode)}${cleanBody}`.trimEnd() + '\n';
  if (after === before) continue;
  changed++;
  if (write) writeFileSync(path, after, 'utf8');
  console.log(`${write ? 'updated' : 'would update'} ${relative(root, path)}`);
}

if (check && changed > 0) {
  console.error(`Codex skill mirrors are stale: ${changed} file(s). Run: node scripts/sync-codex-run-mode.mjs --write`);
  process.exitCode = 1;
} else {
  console.log(`${write ? 'updated' : 'checked'} ${changed} Codex skills`);
}
