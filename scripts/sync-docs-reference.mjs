// scripts/sync-docs-reference.mjs
// Regenerates docs-site/src/content/docs/commands/reference.md from
// inventory-v2.json + .claude/commands/*.md frontmatter.
//
// Usage:
//   node scripts/sync-docs-reference.mjs          # write reference.md
//   node scripts/sync-docs-reference.mjs --check   # fail if out of sync (CI)

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const docsSite = join(root, 'docs-site');
const claudeCommands = join(root, '.claude', 'commands');
const claudeSkills = join(root, '.claude', 'skills');
const inventoryPath = join(docsSite, 'src/client/data/inventory-v2.json');
const referencePath = join(docsSite, 'src/content/docs/commands/reference.md');

function parseFrontmatter(markdown) {
  const m = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, content: markdown };
  const fm = {};
  let currentKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      let val = kv[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      fm[currentKey] = val;
    }
  }
  return { frontmatter: fm, content: m[2] };
}

function loadCommandFrontmatter(file) {
  const path = join(claudeCommands, basename(file));
  if (!existsSync(path)) return {};
  const md = readFileSync(path, 'utf8');
  return parseFrontmatter(md).frontmatter;
}

function listSkills(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => {
      const p = join(dir, f);
      return statSync(p).isDirectory() && existsSync(join(p, 'SKILL.md'));
    })
    .map(name => {
      const skillMd = readFileSync(join(dir, name, 'SKILL.md'), 'utf8');
      const fm = parseFrontmatter(skillMd).frontmatter;
      return { name, description: fm.description || fm.title || '' };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function esc(s) {
  return String(s || '').replace(/`/g, '\\`');
}

function generateReference() {
  const inv = JSON.parse(readFileSync(inventoryPath, 'utf8'));
  const categories = inv.categories || [];
  const commands = inv.commands || [];

  const byCat = {};
  for (const c of commands) {
    (byCat[c.category] = byCat[c.category] || []).push(c);
  }

  let out = '';
  out += '---\n';
  out += 'title: "Maestro Commands Quick Reference"\n';
  out += '---\n\n';
  out += '> Auto-generated from `inventory-v2.json` + `.claude/commands/*.md` frontmatter.\n';
  out += `> v2 (v0.5.51+): ${commands.length} commands across ${categories.length} categories.\n`;
  out += '> Do not edit by hand — run `npm run sync:docs-reference` to regenerate.\n\n';
  out += '---\n\n';

  // Commands by category
  for (const cat of categories) {
    const cmds = byCat[cat.id] || [];
    if (cmds.length === 0) continue;

    out += `## ${cat.name}\n\n`;
    out += `*${esc(cat.description)}*\n\n`;

    for (const cmd of cmds) {
      const fm = loadCommandFrontmatter(cmd.file || `${cmd.name}.md`);
      const desc = cmd.description || fm.description || '';
      const argHint = cmd.argumentHint || fm['argument-hint'] || '';
      const subcommands = cmd.subcommands || [];

      out += `### \`${cmd.name}\`\n\n`;
      if (argHint) {
        out += `**Usage:** \`${esc(argHint)}\`\n\n`;
      }
      out += `${esc(desc)}\n`;
      if (subcommands.length > 0) {
        out += `\n**Subcommands:** ${subcommands.map(s => `\`${s}\``).join(', ')}\n`;
      }
      out += '\n';
    }
    out += '---\n\n';
  }

  // Skills sections
  const teamSkills = listSkills(claudeSkills).filter(s => s.name.startsWith('team-'));
  const scholarSkills = listSkills(claudeSkills).filter(s => s.name.startsWith('scholar-'));
  const metaSkills = listSkills(claudeSkills).filter(s =>
    !s.name.startsWith('team-') && !s.name.startsWith('scholar-')
  );

  function renderSkillSection(title, skills, note) {
    if (skills.length === 0) return '';
    let s = `## ${title}\n\n`;
    if (note) s += `*${note}*\n\n`;
    for (const sk of skills) {
      s += `- **\`${sk.name}\`** — ${esc(sk.description)}\n`;
    }
    s += '\n---\n\n';
    return s;
  }

  out += renderSkillSection('Team Skills', teamSkills,
    'Multi-agent team collaboration skills in `.claude/skills/team-*`.');
  out += renderSkillSection('Scholar Skills', scholarSkills,
    'Academic writing & research skills in `.claude/skills/scholar-*`.');
  out += renderSkillSection('Meta Skills', metaSkills,
    'Skill tooling and prompt engineering in `.claude/skills/`.');

  // Migration footer
  out += '## v1 → v2 Migration\n\n';
  out += `> v0.5.51 consolidated 66 v1 commands into ${commands.length} v2 unified commands. `;
  out += 'For legacy v1 references, see `inventory.json` (v1 inventory). ';
  out += 'Key replacements:\n';
  out += '>\n';
  out += '> - `/maestro-plan`, `/maestro-execute`, `/maestro-quick` → `/maestro`, `/maestro-next`, or `/maestro-ralph`\n';
  out += '> - `/spec-add`, `/spec-load`, `/spec-remove`, `/spec-setup` → `/spec` subcommands\n';
  out += '> - `/manage-status`, `/manage-knowhow`, `/manage-issue`, `/manage-harvest` → `/manage` subcommands\n';
  out += '> - `/quality-review`, `/quality-test`, `/quality-debug` → `/maestro-ralph --engine swarm` or `/odyssey`\n';
  out += '> - `/learn-decompose`, `/learn-follow`, `/learn-investigate` → `/learn` subcommands\n';
  out += '> - `/odyssey-debug`, `/odyssey-improve`, `/odyssey-planex` → `/odyssey --mode <name>`\n';
  out += '> - `/wiki-connect`, `/wiki-digest` → `/manage knowledge wiki` subcommands\n';
  out += '\n';

  return out;
}

const newContent = generateReference();
const checkMode = process.argv.includes('--check');

if (checkMode) {
  const existing = existsSync(referencePath) ? readFileSync(referencePath, 'utf8') : '';
  if (existing !== newContent) {
    console.error('✗ reference.md is out of sync with inventory-v2.json + .claude/commands/');
    console.error('  Run: npm run sync:docs-reference');
    process.exit(1);
  }
  console.log('✓ reference.md is in sync');
} else {
  writeFileSync(referencePath, newContent);
  console.log(`✓ reference.md regenerated (${newContent.split('\n').length} lines)`);
}
