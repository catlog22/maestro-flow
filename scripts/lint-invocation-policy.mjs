import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const automatic = new Set(['maestro-next', 'maestro', 'maestro-ralph']);

function metadata(path) {
  const match = readFileSync(path, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  return Object.fromEntries(match[1].split(/\r?\n/).flatMap(line => {
    const item = line.match(/^([a-zA-Z][\w-]*):\s*(.*?)\s*$/);
    return item ? [[item[1], item[2].replace(/^['"]|['"]$/g, '')]] : [];
  }));
}

const errors = [];
const commands = join(root, '.claude', 'commands');
for (const file of readdirSync(commands).filter(file => file.endsWith('.md'))) {
  const path = join(commands, file);
  const data = metadata(path);
  const name = data.name || file.slice(0, -3);
  const expected = automatic.has(name) ? 'false' : 'true';
  if (data['disable-model-invocation'] !== expected) errors.push(`${relative(root, path)}: expected disable-model-invocation: ${expected}`);
}

const skills = join(root, '.claude', 'skills');
for (const dir of readdirSync(skills)) {
  const path = join(skills, dir, 'SKILL.md');
  if (existsSync(path) && metadata(path)['disable-model-invocation'] !== 'true') errors.push(`${relative(root, path)}: skills are not automatic entrypoints`);
}

const catalog = readFileSync(join(root, 'workflows', 'maestro.md'), 'utf8');
if (/['"]team_[a-z_]+['"]\s*:|cmd:\s*['"]team-/.test(catalog)) errors.push('workflows/maestro.md: team ecosystems must not appear in automatic chain routing');

if (errors.length) {
  console.error(`invocation policy lint failed: ${errors.length} issue(s)`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else console.log('invocation policy lint passed: maestro-next, maestro, maestro-ralph are the only automatic entrypoints');
