// prebuild.js — Copy .claude/.codex commands/skills into docs-site for Vite glob resolution
import { cpSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = join(__dirname, '..');

// Copy .claude commands
const srcCmds = join(root, '.claude', 'commands');
const destCmds = join(__dirname, '.claude', 'commands');
if (existsSync(srcCmds)) {
  mkdirSync(destCmds, { recursive: true });
  cpSync(srcCmds, destCmds, {
    recursive: true,
    filter: (src) => statSync(src).isDirectory() || src.endsWith('.md'),
  });
  const count = readdirSync(destCmds).filter(f => f.endsWith('.md')).length;
  console.log(`Copied .claude/commands: ${count} files`);
}

// Copy .claude skills
const srcSkills = join(root, '.claude', 'skills');
const destSkills = join(__dirname, '.claude', 'skills');
if (existsSync(srcSkills)) {
  mkdirSync(destSkills, { recursive: true });
  cpSync(srcSkills, destSkills, { recursive: true });
  console.log(`Copied .claude/skills: ${readdirSync(destSkills).length} directories`);
}

// Copy .codex skills
const srcCodexSkills = join(root, '.codex', 'skills');
const destCodexSkills = join(__dirname, '.codex', 'skills');
if (existsSync(srcCodexSkills)) {
  mkdirSync(destCodexSkills, { recursive: true });
  cpSync(srcCodexSkills, destCodexSkills, { recursive: true });
  console.log(`Copied .codex/skills: ${readdirSync(destCodexSkills).length} directories`);
} else {
  console.log(`Skipped .codex/skills (not found)`);
}
