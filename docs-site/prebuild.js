// prebuild.js — Copy .claude commands and skills into docs-site for Vite glob resolution
import { cpSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = join(__dirname, '..');

const destCmds = join(__dirname, '.claude', 'commands');
const destSkills = join(__dirname, '.claude', 'skills');
const srcCmds = join(root, '.claude', 'commands');
const srcSkills = join(root, '.claude', 'skills');

// Copy commands — include directories and .md files only
if (existsSync(srcCmds)) {
  mkdirSync(destCmds, { recursive: true });
  cpSync(srcCmds, destCmds, {
    recursive: true,
    filter: (src) => {
      if (statSync(src).isDirectory()) return true;
      return src.endsWith('.md');
    }
  });
  const count = readdirSync(destCmds).filter(f => f.endsWith('.md')).length;
  console.log(`Copied commands: ${count} files`);
}

// Copy skills
if (existsSync(srcSkills)) {
  mkdirSync(destSkills, { recursive: true });
  cpSync(srcSkills, destSkills, { recursive: true });
  console.log(`Copied skills: ${readdirSync(destSkills).length} directories`);
}
