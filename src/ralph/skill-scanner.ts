// ---------------------------------------------------------------------------
// Skill scanner — discovers commands + skills across all platforms.
//
// Sources (project overrides global by `(platform, name)`):
//   - <cwd>/.claude/commands/*.md           type: command, scope: project, platform: claude
//   - ~/.claude/commands/*.md               type: command, scope: global,  platform: claude
//   - <cwd>/.claude/skills/*/SKILL.md       type: skill,   scope: project, platform: claude
//   - ~/.claude/skills/*/SKILL.md           type: skill,   scope: global,  platform: claude
//   - <cwd>/.codex/skills/*/SKILL.md        type: skill,   scope: project, platform: codex
//   - ~/.codex/skills/*/SKILL.md            type: skill,   scope: global,  platform: codex
//   - <cwd>/.agents/skills/*/SKILL.md       type: skill,   scope: project, platform: agent
//   - ~/.agents/skills/*/SKILL.md           type: skill,   scope: global,  platform: agent
//   - <cwd>/.agy/skills/*/SKILL.md          type: skill,   scope: project, platform: agy
//   - ~/.agy/skills/*/SKILL.md              type: skill,   scope: global,  platform: agy
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseSkillManifest } from './skill-resolver.js';

export type SkillPlatform = 'claude' | 'codex' | 'agent' | 'agy';

export interface ScannedSkill {
  type: 'command' | 'skill';
  scope: 'global' | 'project';
  platform: SkillPlatform;
  name: string;
  filePath: string;
  description: string;
  argumentHint: string;
  requiredCount: number;
  deferredCount: number;
  missingRequired: string[];
}

function collectCommandFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    const full = join(dir, name);
    try {
      if (statSync(full).isFile()) out.push(full);
    } catch { /* ignore */ }
  }
  return out;
}

function collectSkillFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const skillFile = join(dir, name, 'SKILL.md');
    try {
      if (existsSync(skillFile) && statSync(skillFile).isFile()) out.push(skillFile);
    } catch { /* ignore */ }
  }
  return out;
}

function scanOne(
  filePath: string,
  type: 'command' | 'skill',
  scope: 'global' | 'project',
  platform: SkillPlatform,
  fallbackName: string,
): ScannedSkill {
  try {
    const m = parseSkillManifest(filePath);
    const fmName = (m.frontmatter.name ?? '').toString().trim();
    const description = (m.frontmatter.description ?? '').toString();
    const argumentHint = (m.frontmatter['argument-hint'] ?? '').toString();
    return {
      type,
      scope,
      platform,
      name: fmName || fallbackName,
      filePath,
      description,
      argumentHint,
      requiredCount: m.requiredPaths.length,
      deferredCount: m.deferredPaths.length,
      missingRequired: m.missingRequired,
    };
  } catch {
    return {
      type, scope, platform, name: fallbackName, filePath,
      description: '(parse error)', argumentHint: '',
      requiredCount: 0, deferredCount: 0, missingRequired: [],
    };
  }
}

interface ScanSource {
  files: string[];
  type: 'command' | 'skill';
  scope: 'global' | 'project';
  platform: SkillPlatform;
  nameFn: (p: string) => string;
}

export interface ScanOptions {
  platform?: SkillPlatform;
}

export function scanAllSkills(
  workflowRoot: string = resolve(process.cwd()),
  opts: ScanOptions = {},
): ScannedSkill[] {
  const home = homedir();
  const commandName = (p: string) => p.split(/[\\/]/).pop()!.replace(/\.md$/, '');
  const skillName = (p: string) => p.split(/[\\/]/).slice(-2, -1)[0];

  const allSources: ScanSource[] = [
    // Claude platform
    {
      files: collectCommandFiles(join(home, '.claude', 'commands')),
      type: 'command', scope: 'global', platform: 'claude', nameFn: commandName,
    },
    {
      files: collectCommandFiles(join(workflowRoot, '.claude', 'commands')),
      type: 'command', scope: 'project', platform: 'claude', nameFn: commandName,
    },
    {
      files: collectSkillFiles(join(home, '.claude', 'skills')),
      type: 'skill', scope: 'global', platform: 'claude', nameFn: skillName,
    },
    {
      files: collectSkillFiles(join(workflowRoot, '.claude', 'skills')),
      type: 'skill', scope: 'project', platform: 'claude', nameFn: skillName,
    },
    // Codex platform
    {
      files: collectSkillFiles(join(home, '.codex', 'skills')),
      type: 'skill', scope: 'global', platform: 'codex', nameFn: skillName,
    },
    {
      files: collectSkillFiles(join(workflowRoot, '.codex', 'skills')),
      type: 'skill', scope: 'project', platform: 'codex', nameFn: skillName,
    },
    // Agent Skills open-standard (.agents/)
    {
      files: collectSkillFiles(join(home, '.agents', 'skills')),
      type: 'skill', scope: 'global', platform: 'agent', nameFn: skillName,
    },
    {
      files: collectSkillFiles(join(workflowRoot, '.agents', 'skills')),
      type: 'skill', scope: 'project', platform: 'agent', nameFn: skillName,
    },
    // Agy / Antigravity (.agy/)
    {
      files: collectSkillFiles(join(home, '.agy', 'skills')),
      type: 'skill', scope: 'global', platform: 'agy', nameFn: skillName,
    },
    {
      files: collectSkillFiles(join(workflowRoot, '.agy', 'skills')),
      type: 'skill', scope: 'project', platform: 'agy', nameFn: skillName,
    },
  ];

  const sources = opts.platform
    ? allSources.filter(s => s.platform === opts.platform)
    : allSources;

  // Project overrides global per (platform, type, name).
  const merged = new Map<string, ScannedSkill>();
  for (const src of sources) {
    for (const file of src.files) {
      const entry = scanOne(file, src.type, src.scope, src.platform, src.nameFn(file));
      const key = `${entry.platform}::${entry.type}::${entry.name}`;
      const existing = merged.get(key);
      if (!existing || (existing.scope === 'global' && entry.scope === 'project')) {
        merged.set(key, entry);
      }
    }
  }

  return Array.from(merged.values()).sort((a, b) => {
    if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    if (a.scope !== b.scope) return a.scope.localeCompare(b.scope);
    return a.name.localeCompare(b.name);
  });
}

/** Look up a single skill/command by name. Returns null if not found. */
export function findSkill(
  name: string,
  type?: 'command' | 'skill',
  platform?: SkillPlatform,
): ScannedSkill | null {
  const all = scanAllSkills(undefined, platform ? { platform } : {});
  return all.find(s => s.name === name && (!type || s.type === type)) ?? null;
}
