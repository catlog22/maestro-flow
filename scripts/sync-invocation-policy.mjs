#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const check = process.argv.includes('--check');
const automatic = new Set(['maestro-next', 'maestro', 'maestro-ralph']);

function update(path, expected) {
  const before = readFileSync(path, 'utf8');
  const newline = before.includes('\r\n') ? '\r\n' : '\n';
  const match = before.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return `${relative(root, path)}: missing frontmatter`;
  let frontmatter = match[1];
  if (/^disable-model-invocation:/m.test(frontmatter)) {
    frontmatter = frontmatter.replace(/^disable-model-invocation:.*$/m, `disable-model-invocation: ${expected}`);
  } else {
    frontmatter = frontmatter.replace(/^(name:.*)$/m, `$1${newline}disable-model-invocation: ${expected}`);
  }
  const after = before.slice(0, match.index + 4) + frontmatter + before.slice(match.index + 4 + match[1].length);
  if (after === before) return null;
  if (!check) writeFileSync(path, after, 'utf8');
  return relative(root, path);
}

const changed = [];
const errors = [];

const commandsDir = join(root, '.claude', 'commands');
for (const file of readdirSync(commandsDir).filter(file => file.endsWith('.md'))) {
  const name = file.slice(0, -3);
  const result = update(join(commandsDir, file), automatic.has(name) ? 'false' : 'true');
  if (result?.includes('missing frontmatter')) errors.push(result); else if (result) changed.push(result);
}

for (const base of [join(root, '.claude', 'skills'), join(root, '.codex', 'skills')]) {
  for (const dir of readdirSync(base)) {
    const path = join(base, dir, 'SKILL.md');
    if (!existsSync(path)) continue;
    const isCodexEntrypoint = base.includes(`${join('.codex', 'skills')}`) && automatic.has(dir);
    const result = update(path, isCodexEntrypoint ? 'false' : 'true');
    if (result?.includes('missing frontmatter')) errors.push(result); else if (result) changed.push(result);
  }
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else if (check && changed.length) {
  console.error(`invocation policy is stale: ${changed.length} file(s)`);
  for (const file of changed) console.error(`- ${file}`);
  process.exitCode = 1;
} else {
  console.log(`${check ? 'checked' : 'updated'} ${changed.length} invocation-policy file(s)`);
}
