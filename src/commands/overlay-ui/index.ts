import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { paths } from '../../config/paths.js';
import { getAllManifests } from '../../core/manifest.js';
import { loadAllOverlays } from '../../core/overlay/loader.js';
import { loadOverlayManifest } from '../../core/overlay/applier.js';
import { parseSections } from '../../core/overlay/section-parser.js';
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
    if (existsSync(globalCmds)) {
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

function collectTargets(dir: string, scopes: Scope[]): TargetInfo[] {
  const { overlays } = loadAllOverlays(dir);
  const targetNames = new Set<string>();
  for (const o of overlays) {
    if (o.meta.enabled === false) continue;
    for (const t of o.meta.targets) targetNames.add(t);
  }

  const results: TargetInfo[] = [];

  for (const s of scopes) {
    const cmdsDir = join(s.targetBase, '.claude', 'commands');
    if (!existsSync(cmdsDir)) continue;

    for (const target of targetNames) {
      const filePath = join(cmdsDir, `${target}.md`);
      if (!existsSync(filePath)) continue;

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

      // Only add if there are markers or sections
      if (markers.length > 0 || sections.length > 0) {
        results.push({ name: target, sections, markers });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runOverlayListUI(interactive: boolean): Promise<void> {
  const dir = overlayDir();
  if (!existsSync(dir)) {
    console.error(`No overlays directory at ${dir}`);
    return;
  }

  const { overlays, errors } = loadAllOverlays(dir);
  if (overlays.length === 0 && errors.length === 0) {
    console.error('No overlays installed.');
    return;
  }

  const scopes = discoverScopes();
  const appliedState = collectAppliedState(scopes);
  const targets = collectTargets(dir, scopes);

  // Dynamic imports for ink + React
  const { render } = await import('ink');
  const React = await import('react');
  const { OverlayList } = await import('./OverlayList.js');

  // Import remove logic
  const { removeOverlayFromTargets, deleteOverlayManifest, loadOverlayManifest } = await import(
    '../../core/overlay/applier.js'
  );
  const { loadOverlay } = await import('../../core/overlay/loader.js');
  const { unlinkSync, readdirSync } = await import('node:fs');
  const { join: joinPath } = await import('node:path');

  const handleDelete = (name: string): void => {
    // Strip markers from all scopes
    let filesChanged = 0;
    for (const s of scopes) {
      const res = removeOverlayFromTargets(name, s.scope, s.targetBase);
      filesChanged += res.filesChanged;
    }

    // Delete overlay file(s)
    if (existsSync(dir)) {
      for (const entry of readdirSync(dir)) {
        if (!entry.endsWith('.json')) continue;
        const fp = joinPath(dir, entry);
        try {
          const overlay = loadOverlay(fp);
          if (overlay.meta.name === name) unlinkSync(fp);
        } catch {
          // Skip unparseable
        }
      }
    }

    // Prune empty manifests
    for (const s of scopes) {
      const m = loadOverlayManifest(s.scope, s.targetBase);
      if (m && m.appliedOverlays.length === 0) {
        deleteOverlayManifest(s.scope, s.targetBase);
      }
    }
  };

  const isInteractive = interactive && !!process.stdin.isTTY;

  const { waitUntilExit } = render(
    React.createElement(OverlayList, {
      overlays,
      errors,
      appliedState,
      targets,
      interactive: isInteractive,
      onDelete: handleDelete,
    }),
    { exitOnCtrlC: true },
  );

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));

  await waitUntilExit();
}
