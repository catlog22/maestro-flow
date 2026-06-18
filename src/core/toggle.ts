// ---------------------------------------------------------------------------
// Toggle — enable/disable individual commands, skills, and agents.
//
// Three-state model:
//   on        = installed & enabled
//   off       = installed & disabled (.md → .md.disabled)
//   available = in source, not yet installed
// ---------------------------------------------------------------------------

import { join, dirname } from 'node:path';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
  cpSync,
  writeFileSync,
  renameSync,
} from 'node:fs';
import { findManifest, manifestFile } from './manifest.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToggleState = 'on' | 'off' | 'available';

export interface ToggleItem {
  name: string;
  type: 'command' | 'skill' | 'agent';
  state: ToggleState;
  sourcePath: string;
  targetActive: string;
  targetDisabled: string;
}

// ---------------------------------------------------------------------------
// Scan — merge source (available) and target (on/off) into unified list
// ---------------------------------------------------------------------------

export function scanToggleItems(pkgRoot: string, targetBase: string): ToggleItem[] {
  const items = new Map<string, ToggleItem>();

  const addSource = (dir: string, targetDir: string, type: ToggleItem['type'], isSkill: boolean) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (isSkill) {
        if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
        if (!existsSync(join(dir, entry.name, 'SKILL.md'))) continue;
        const key = `${type}:${entry.name}`;
        items.set(key, {
          name: entry.name, type, state: 'available',
          sourcePath: join(dir, entry.name),
          targetActive: join(targetDir, entry.name, 'SKILL.md'),
          targetDisabled: join(targetDir, entry.name, 'SKILL.md.disabled'),
        });
      } else {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        const name = entry.name.replace('.md', '');
        const key = `${type}:${name}`;
        items.set(key, {
          name, type, state: 'available',
          sourcePath: join(dir, entry.name),
          targetActive: join(targetDir, entry.name),
          targetDisabled: join(targetDir, `${entry.name}.disabled`),
        });
      }
    }
  };

  const markTarget = (dir: string, type: ToggleItem['type'], isSkill: boolean) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (isSkill) {
        if (!entry.isDirectory()) continue;
        const key = `${type}:${entry.name}`;
        const hasActive = existsSync(join(dir, entry.name, 'SKILL.md'));
        const hasDisabled = existsSync(join(dir, entry.name, 'SKILL.md.disabled'));
        if (hasActive || hasDisabled) {
          const existing = items.get(key);
          const state: ToggleState = hasActive ? 'on' : 'off';
          if (existing) {
            existing.state = state;
          } else {
            items.set(key, {
              name: entry.name, type, state,
              sourcePath: '',
              targetActive: join(dir, entry.name, 'SKILL.md'),
              targetDisabled: join(dir, entry.name, 'SKILL.md.disabled'),
            });
          }
        }
      } else {
        if (!entry.isFile()) continue;
        const isDisabled = entry.name.endsWith('.md.disabled');
        const isMd = entry.name.endsWith('.md') && !isDisabled;
        if (!isMd && !isDisabled) continue;
        const name = isDisabled ? entry.name.replace('.md.disabled', '') : entry.name.replace('.md', '');
        const key = `${type}:${name}`;
        const state: ToggleState = isMd ? 'on' : 'off';
        const existing = items.get(key);
        if (existing) {
          if (existing.state !== 'on') existing.state = state;
        } else {
          items.set(key, {
            name, type, state,
            sourcePath: '',
            targetActive: join(dir, `${name}.md`),
            targetDisabled: join(dir, `${name}.md.disabled`),
          });
        }
      }
    }
  };

  const srcClaude = join(pkgRoot, '.claude');
  const tgtClaude = join(targetBase, '.claude');

  addSource(join(srcClaude, 'commands'), join(tgtClaude, 'commands'), 'command', false);
  addSource(join(srcClaude, 'skills'), join(tgtClaude, 'skills'), 'skill', true);
  addSource(join(srcClaude, 'agents'), join(tgtClaude, 'agents'), 'agent', false);

  markTarget(join(tgtClaude, 'commands'), 'command', false);
  markTarget(join(tgtClaude, 'skills'), 'skill', true);
  markTarget(join(tgtClaude, 'agents'), 'agent', false);

  const srcCodex = join(pkgRoot, '.codex');
  const tgtCodex = join(targetBase, '.codex');
  addSource(join(srcCodex, 'skills'), join(tgtCodex, 'skills'), 'skill', true);
  addSource(join(srcCodex, 'agents'), join(tgtCodex, 'agents'), 'agent', false);
  markTarget(join(tgtCodex, 'skills'), 'skill', true);
  markTarget(join(tgtCodex, 'agents'), 'agent', false);

  return [...items.values()].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Apply — execute state transition on filesystem
// ---------------------------------------------------------------------------

export function applyToggle(item: ToggleItem, pkgRoot: string): boolean {
  if (item.state === 'on') {
    if (existsSync(item.targetActive)) {
      renameSync(item.targetActive, item.targetDisabled);
      return true;
    }
  } else if (item.state === 'off') {
    if (existsSync(item.targetDisabled)) {
      renameSync(item.targetDisabled, item.targetActive);
      return true;
    }
  } else {
    if (!item.sourcePath) return false;
    const targetDir = dirname(item.targetActive);
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    const srcStat = statSync(item.sourcePath);
    if (srcStat.isDirectory()) {
      cpSync(item.sourcePath, targetDir, { recursive: true });
    } else {
      copyFileSync(item.sourcePath, item.targetActive);
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Manifest integration — persist disabled-item list
// ---------------------------------------------------------------------------

export function updateManifestDisabledItems(
  scope: 'global' | 'project',
  targetPath: string,
  disabledNames: string[],
): void {
  const manifest = findManifest(scope, targetPath);
  if (!manifest) return;
  manifest.disabledItems = disabledNames;
  writeFileSync(manifestFile(manifest.id), JSON.stringify(manifest, null, 2), 'utf-8');
}
