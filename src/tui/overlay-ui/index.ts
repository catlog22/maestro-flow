import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { paths } from '../../config/paths.js';
import { getAllManifests } from '../../core/manifest.js';
import { loadAllOverlays, loadOverlay } from '../../core/overlay/loader.js';
import {
  loadOverlayManifest,
  removeOverlayFromTargets,
  deleteOverlayManifest,
} from '../../core/overlay/applier.js';
import { parseSections } from '../../core/overlay/section-parser.js';
import { renderTui } from '../render.js';
import type {
  OverlayAppliedState,
  SectionMarker,
  TargetInfo,
  TargetSection,
} from './OverlayList.js';

// ---------------------------------------------------------------------------
// Scope discovery (shared with overlay.ts)
// ---------------------------------------------------------------------------

interface Scope {
  scope: 'global' | 'project';
  targetBase: string;
}

function discoverScopes(): Scope[] {
  const manifests = getAllManifests();
  const scopes: Scope[] = [];
  const seen = new Set<string>();
  for (const m of manifests) {
    const targetBase = m.scope === 'global' ? homedir() : m.targetPath;
    const key = `${m.scope}:${targetBase}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scopes.push({ scope: m.scope, targetBase });
  }
  if (scopes.length === 0) {
    const globalCmds = join(homedir(), '.claude', 'commands');
    const globalSkills = join(homedir(), '.codex', 'skills');
    if (existsSync(globalCmds) || existsSync(globalSkills)) {
      scopes.push({ scope: 'global', targetBase: homedir() });
    }
  }
  return scopes;
}

function overlayDir(): string {
  return join(paths.home, 'overlays');
}

// ---------------------------------------------------------------------------
// Data collection for the ink component
// ---------------------------------------------------------------------------

function collectAppliedState(scopes: Scope[]): Map<string, OverlayAppliedState> {
  const result = new Map<string, OverlayAppliedState>();
  for (const s of scopes) {
    const m = loadOverlayManifest(s.scope, s.targetBase);
    if (!m) continue;
    for (const ao of m.appliedOverlays) {
      const existing = result.get(ao.overlayName);
      if (existing) {
        if (!existing.appliedScopes.includes(s.scope)) {
          existing.appliedScopes.push(s.scope);
        }
      } else {
        result.set(ao.overlayName, {
          name: ao.overlayName,
          appliedScopes: [s.scope],
        });
      }
    }
  }
  return result;
}

const MARKER_RE = /^<!-- maestro-overlay:([^#]+)#(\d+)\s+hash=\S+\s*-->$/;

/** Resolve potential file paths for a target, checking both Claude and Codex locations. */
function resolveTargetFiles(
  targetBase: string,
  targetName: string,
  cli: 'claude' | 'codex' | 'both',
): { path: string; cli: 'claude' | 'codex' }[] {
  const result: { path: string; cli: 'claude' | 'codex' }[] = [];
  if (cli === 'claude' || cli === 'both') {
    const p = join(targetBase, '.claude', 'commands', `${targetName}.md`);
    if (existsSync(p)) result.push({ path: p, cli: 'claude' });
  }
  if (cli === 'codex' || cli === 'both') {
    const p = join(targetBase, '.codex', 'skills', targetName, 'SKILL.md');
    if (existsSync(p)) result.push({ path: p, cli: 'codex' });
  }
  return result;
}

function collectTargets(dir: string, scopes: Scope[]): TargetInfo[] {
  const { overlays } = loadAllOverlays(dir);

  // Collect target → cli mapping from overlays
  const targetCli = new Map<string, 'claude' | 'codex' | 'both'>();
  for (const o of overlays) {
    if (o.meta.enabled === false) continue;
    const cli = o.meta.cli ?? 'claude';
    for (const t of o.meta.targets) {
      const existing = targetCli.get(t);
      if (!existing) {
        targetCli.set(t, cli);
      } else if (existing !== cli) {
        targetCli.set(t, 'both');
      }
    }
  }

  const results: TargetInfo[] = [];
  const seen = new Set<string>();

  for (const s of scopes) {
    for (const [target, cli] of targetCli) {
      const files = resolveTargetFiles(s.targetBase, target, cli);
      for (const { path: filePath, cli: fileCli } of files) {
        const key = `${fileCli}:${target}:${s.targetBase}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const content = readFileSync(filePath, 'utf-8');
        const parsed = parseSections(content);

        const markers: SectionMarker[] = [];
        for (let i = 0; i < parsed.lines.length; i++) {
          const m = MARKER_RE.exec(parsed.lines[i]);
          if (m) {
            let desc = '';
            for (let j = i + 1; j < parsed.lines.length && j < i + 5; j++) {
              const line = parsed.lines[j].trim();
              if (line.startsWith('<!-- /maestro-overlay:')) break;
              if (line.startsWith('#')) {
                desc = line.replace(/^#+\s*/, '').trim();
                break;
              }
              if (line && !line.startsWith('<!--')) {
                desc = line.slice(0, 50);
                break;
              }
            }
            markers.push({
              overlayName: m[1],
              patchIdx: parseInt(m[2], 10),
              line: i,
              description: desc,
            });
          }
        }

        const sections: TargetSection[] = parsed.sections.map((sec) => ({
          name: sec.name,
          openLine: sec.openLine,
          closeLine: sec.closeLine,
        }));

        if (markers.length > 0 || sections.length > 0) {
          results.push({ name: target, cli: fileCli, sections, markers });
        }
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Data preparation (reusable by ConfigHub)
// ---------------------------------------------------------------------------

export interface OverlayData {
  overlays: import('../../core/overlay/types.js').OverlayFile[];
  errors: { path: string; errors: string[] }[];
  appliedState: Map<string, OverlayAppliedState>;
  targets: TargetInfo[];
  handleDelete: (name: string) => void;
}

/**
 * Collect overlay data for rendering. Returns null if no overlays directory
 * or no overlays installed.
 */
export function prepareOverlayData(): OverlayData | null {
  const dir = overlayDir();
  if (!existsSync(dir)) return null;

  const { overlays, errors } = loadAllOverlays(dir);
  if (overlays.length === 0 && errors.length === 0) return null;

  const scopes = discoverScopes();
  const appliedState = collectAppliedState(scopes);
  const targets = collectTargets(dir, scopes);

  const handleDelete = (name: string): void => {
    let filesChanged = 0;
    for (const s of scopes) {
      const res = removeOverlayFromTargets(name, s.scope, s.targetBase);
      filesChanged += res.filesChanged;
    }
    if (existsSync(dir)) {
      for (const entry of readdirSync(dir)) {
        if (!entry.endsWith('.json')) continue;
        const fp = join(dir, entry);
        try {
          const overlay = loadOverlay(fp);
          if (overlay.meta.name === name) unlinkSync(fp);
        } catch { /* Skip unparseable */ }
      }
    }
    for (const s of scopes) {
      const m = loadOverlayManifest(s.scope, s.targetBase);
      if (m && m.appliedOverlays.length === 0) {
        deleteOverlayManifest(s.scope, s.targetBase);
      }
    }
  };

  return { overlays, errors, appliedState, targets, handleDelete };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runOverlayListUI(interactive: boolean): Promise<void> {
  const data = prepareOverlayData();
  if (!data) {
    console.error('No overlays installed.');
    return;
  }

  const { OverlayList } = await import('./OverlayList.js');
  const isInteractive = interactive && !!process.stdin.isTTY;

  await renderTui(OverlayList, {
    ...data,
    interactive: isInteractive,
    onDelete: data.handleDelete,
  });
}
