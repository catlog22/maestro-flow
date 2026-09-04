#!/usr/bin/env node
/**
 * Pin/unpin sub-commands as standalone skill shortcuts.
 *
 * Usage:
 *   node <scripts_path>/pin.mjs pin <command>
 *   node <scripts_path>/pin.mjs unpin <command>
 *
 * `pin audit` creates a lightweight audit skill that redirects to Maestro's bundled Impeccable workflow.
 * `unpin audit` removes that shortcut.
 *
 * The script discovers harness directories (.claude/skills, .cursor/skills, etc.)
 * in the project root and creates/removes the pin in all of them.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { basename, join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// All known harness directories
const HARNESS_DIRS = [
  '.claude', '.cursor', '.gemini', '.codex', '.agents', '.agent', '.github', '.grok',
  '.hermes',
  '.trae', '.trae-cn', '.pi', '.opencode', '.kiro', '.rovodev', '.vibe', '.qoder',
];

const CODEX_HARNESSES = new Set(['.codex', '.agents']);

// Valid sub-command names
const VALID_COMMANDS = [
  'craft', 'init', 'extract', 'document', 'shape',
  'critique', 'audit',
  'polish', 'bolder', 'quieter', 'distill', 'harden', 'onboard', 'live',
  'animate', 'colorize', 'typeset', 'layout', 'delight', 'overdrive',
  'clarify', 'adapt', 'optimize',
];

// Marker to identify pinned skills (so unpin doesn't delete user skills)
const PIN_MARKER = '<!-- impeccable-pinned-skill -->';

/**
 * Walk up from startDir to find a project root.
 */
function findProjectRoot(startDir = process.cwd()) {
  let dir = resolve(startDir);
  while (dir !== '/') {
    if (
      existsSync(join(dir, 'package.json')) ||
      existsSync(join(dir, '.git')) ||
      existsSync(join(dir, 'skills-lock.json'))
    ) {
      return dir;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(startDir);
}

/**
 * Find project/user harness skill directories that expose maestro-impeccable.
 */
function findHarnessDirs(projectRoot) {
  const dirs = [];
  const seen = new Set();
  const roots = [projectRoot, homedir()];
  for (const root of roots) {
    for (const harness of HARNESS_DIRS) {
      const harnessDir = join(root, harness);
      const skillsDir = join(harnessDir, 'skills');
      const hasEntry = existsSync(join(harnessDir, 'commands', 'maestro-impeccable.md'))
        || existsSync(join(skillsDir, 'maestro-impeccable', 'SKILL.md'));
      const key = resolve(skillsDir);
      if (hasEntry && !seen.has(key)) {
        seen.add(key);
        dirs.push(skillsDir);
      }
    }
  }
  return dirs;
}

/**
 * Load command metadata (descriptions for pinned skills).
 */
function loadCommandMetadata() {
  const metadataPath = join(__dirname, 'command-metadata.json');
  if (existsSync(metadataPath)) {
    return JSON.parse(readFileSync(metadataPath, 'utf-8'));
  }
  return {};
}

/**
 * Generate a pinned skill's SKILL.md content.
 */
function commandPrefixForSkillsDir(skillsDir) {
  return CODEX_HARNESSES.has(basename(dirname(skillsDir))) ? '$' : '/';
}

function generatePinnedSkill(command, metadata, commandPrefix, isCodex) {
  const desc = metadata[command]?.description || `Shortcut for ${commandPrefix}maestro-impeccable ${command}.`;
  const hint = metadata[command]?.argumentHint || '[target]';
  const providerFrontmatter = isCodex
    ? `metadata:\n  argument-hint: "${hint}"`
    : `argument-hint: "${hint}"\nuser-invocable: true`;

  return `---
name: ${command}
description: "${desc}"
${providerFrontmatter}
---

${PIN_MARKER}

This is a pinned shortcut for \`${commandPrefix}maestro-impeccable ${command}\`.

Invoke ${commandPrefix}maestro-impeccable ${command}, passing along any arguments provided here, and follow its instructions.
`;
}

// OpenCode 1.18.10 does not honor `user-invocable: true` on SKILL.md frontmatter
// (see docs/HARNESSES.md and opencode/packages/core/src/v1/config/command.ts),
// so a pinned skill there shows up in `opencode debug skill` but never in the
// slash menu. The fix is a sibling `commands/impeccable-<cmd>.md` that uses the
// OpenCode command schema (description, agent, subtask). Its body forwards to
// the self-contained maestro-impeccable entry, so every pin keeps one runtime.
const OPENCODE_PIN_MARKER = '<!-- impeccable-pinned-command -->';
function generatePinnedOpencodeCommand(command, metadata) {
  const desc = metadata[command]?.description || `Impeccable sub-command shortcut; runs the ${command} workflow via /maestro-impeccable.`;
  return `---
description: "${desc}"
agent: build
subtask: true
---

${OPENCODE_PIN_MARKER}

Invoke \`/maestro-impeccable ${command}\`, passing along all arguments, and follow the bundled workflow. Do not resolve or install another Impeccable skill.

$ARGUMENTS
`;
}

// OpenCode's user-scope config dir. Mirrors the CLI's opencodeGlobalConfigDir
// precedence (OPENCODE_CONFIG_DIR → XDG_CONFIG_HOME/opencode →
// ~/.config/opencode); duplicated here because this script ships inside the
// installed skill and cannot import the CLI.
function opencodeUserConfigDir() {
  if (process.env.OPENCODE_CONFIG_DIR) return process.env.OPENCODE_CONFIG_DIR;
  if (process.env.XDG_CONFIG_HOME) return join(process.env.XDG_CONFIG_HOME, 'opencode');
  return join(homedir(), '.config', 'opencode');
}

/**
 * Resolve every commands dir that should receive an OpenCode pin: the
 * project-local dir when the project has the skill, plus the user config dir
 * when Impeccable is installed globally (#406 layout). A user-scope skill is
 * visible from every project, so its pinned commands belong next to it.
 * With `forCleanup`, both commands dirs are included even when the Maestro
 * entry is gone, so unpin can still reach a pin left behind by an older install;
 * removal stays safe because removePinnedOpencodeCommand is marker-guarded.
 */
function findOpencodeCommandsDirs(projectRoot, { forCleanup = false } = {}) {
  const dirs = [];
  const seen = new Set();
  const push = (commandsDir) => {
    const key = resolve(commandsDir);
    if (!seen.has(key)) {
      seen.add(key);
      dirs.push(commandsDir);
    }
  };
  if (forCleanup || existsSync(join(projectRoot, '.opencode', 'skills', 'maestro-impeccable'))) {
    push(join(projectRoot, '.opencode', 'commands'));
  }
  const userConfig = opencodeUserConfigDir();
  if (forCleanup || existsSync(join(userConfig, 'skills', 'maestro-impeccable'))) {
    push(join(userConfig, 'commands'));
  }
  return dirs;
}

function writePinnedOpencodeCommand(commandsDir, command, metadata) {
  const commandFile = join(commandsDir, `impeccable-${command}.md`);
  if (existsSync(commandFile)) {
    const existing = readFileSync(commandFile, 'utf-8');
    if (!existing.includes(OPENCODE_PIN_MARKER)) {
      console.log(`  SKIP: ${commandFile} (non-pinned command already exists)`);
      return false;
    }
  } else {
    mkdirSync(commandsDir, { recursive: true });
  }
  writeFileSync(commandFile, generatePinnedOpencodeCommand(command, metadata));
  console.log(`  + ${commandFile}`);
  return true;
}

function removePinnedOpencodeCommand(commandsDir, command) {
  const commandFile = join(commandsDir, `impeccable-${command}.md`);
  if (!existsSync(commandFile)) return false;
  const content = readFileSync(commandFile, 'utf-8');
  if (!content.includes(OPENCODE_PIN_MARKER)) {
    console.log(`  SKIP: ${commandFile} (not a pinned command)`);
    return false;
  }
  rmSync(commandFile, { force: true });
  console.log(`  - ${commandFile}`);
  return true;
}

/**
 * Pin a command: create shortcut skill in all harness dirs.
 */
function pin(command, projectRoot) {
  const metadata = loadCommandMetadata();
  const harnessDirs = findHarnessDirs(projectRoot);
  const opencodeCommandsDirs = findOpencodeCommandsDirs(projectRoot);

  if (harnessDirs.length === 0 && opencodeCommandsDirs.length === 0) {
    console.log('No harness directories with maestro-impeccable installed found.');
    return false;
  }

  let created = 0;

  // OpenCode is handled separately below because its shortcut format is a
  // slash command, not a SKILL.md. Excluding it from the skill loop here
  // prevents a duplicate `.opencode/skills/<cmd>/SKILL.md` that OpenCode
  // would never surface as `/<cmd>`.
  for (const skillsDir of harnessDirs) {
    if (skillsDir.includes(`${sep}.opencode${sep}`)) continue;
    const commandPrefix = commandPrefixForSkillsDir(skillsDir);
    const content = generatePinnedSkill(command, metadata, commandPrefix, commandPrefix === '$');
    // Check if skill already exists (and isn't a pin)
    const skillDir = join(skillsDir, command);
    if (existsSync(skillDir)) {
      const existingMd = join(skillDir, 'SKILL.md');
      if (existsSync(existingMd)) {
        const existing = readFileSync(existingMd, 'utf-8');
        if (!existing.includes(PIN_MARKER)) {
          console.log(`  SKIP: ${skillDir} (non-pinned skill already exists)`);
          continue;
        }
      }
    }

    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8');
    console.log(`  + ${skillDir}`);
    created++;
  }

  // OpenCode: write a slash command bridge, not a skill shortcut. Covers both
  // project installs and user-scope (global config) installs.
  for (const commandsDir of opencodeCommandsDirs) {
    if (writePinnedOpencodeCommand(commandsDir, command, metadata)) created++;
  }

  if (created > 0) {
    console.log(`\nPinned '${command}' as a standalone shortcut in ${created} location(s).`);
    console.log('Use the pinned command directly in each harness.');
  }

  return created > 0;
}

/**
 * Unpin a command: remove shortcut skill in all harness dirs.
 */
function unpin(command, projectRoot) {
  const harnessDirs = findHarnessDirs(projectRoot);
  let removed = 0;

  // OpenCode has its own cleanup path below; skip the skill loop here so a
  // stray `.opencode/skills/<cmd>/SKILL.md` written by an older Impeccable
  // version is never silently dropped here.
  for (const skillsDir of harnessDirs) {
    if (skillsDir.includes(`${sep}.opencode${sep}`)) continue;
    const skillDir = join(skillsDir, command);
    if (!existsSync(skillDir)) continue;

    const skillMd = join(skillDir, 'SKILL.md');
    if (!existsSync(skillMd)) continue;

    // Safety: only remove if it's a pinned skill
    const content = readFileSync(skillMd, 'utf-8');
    if (!content.includes(PIN_MARKER)) {
      console.log(`  SKIP: ${skillDir} (not a pinned skill)`);
      continue;
    }

    rmSync(skillDir, { recursive: true, force: true });
    console.log(`  - ${skillDir}`);
    removed++;
  }

  // OpenCode: remove the pinned command file if it's one of ours, in every
  // scope it could have been written to — even when the Maestro entry is
  // already gone, since removal is marker-guarded.
  for (const commandsDir of findOpencodeCommandsDirs(projectRoot, { forCleanup: true })) {
    if (removePinnedOpencodeCommand(commandsDir, command)) removed++;
  }

  if (removed > 0) {
    console.log(`\nUnpinned '${command}' from ${removed} location(s).`);
    console.log(`Use maestro-impeccable ${command} directly to access it.`);
  } else {
    console.log(`No pinned '${command}' shortcut found.`);
  }

  return removed > 0;
}

// --- CLI ---
const [,, action, command] = process.argv;

if (!action || !command) {
  console.log('Usage: node pin.mjs <pin|unpin> <command>');
  console.log(`\nAvailable commands: ${VALID_COMMANDS.join(', ')}`);
  process.exit(1);
}

if (action !== 'pin' && action !== 'unpin') {
  console.error(`Unknown action: ${action}. Use 'pin' or 'unpin'.`);
  process.exit(1);
}

if (!VALID_COMMANDS.includes(command)) {
  console.error(`Unknown command: ${command}`);
  console.error(`Available commands: ${VALID_COMMANDS.join(', ')}`);
  process.exit(1);
}

const root = findProjectRoot();

if (action === 'pin') {
  pin(command, root);
} else {
  unpin(command, root);
}
