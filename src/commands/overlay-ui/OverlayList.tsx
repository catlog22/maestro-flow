import React, { useState, useMemo } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import type { OverlayFile } from '../../core/overlay/types.js';

export interface LoadError {
  path: string;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OverlayAppliedState {
  name: string;
  appliedScopes: string[]; // e.g. ['global', 'project']
}

export interface SectionMarker {
  overlayName: string;
  patchIdx: number;
  line: number;
  description: string;
}

export interface TargetSection {
  name: string;
  openLine: number;
  closeLine: number;
}

export interface TargetInfo {
  name: string;
  sections: TargetSection[];
  markers: SectionMarker[];
}

export interface OverlayListProps {
  overlays: OverlayFile[];
  errors: LoadError[];
  appliedState: Map<string, OverlayAppliedState>;
  targets: TargetInfo[];
  interactive: boolean;
  onDelete: (name: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Mode = 'view' | 'select';

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '\u2026';
}

/** Group markers by overlay name within a section. */
function groupMarkersByOverlay(markers: SectionMarker[]): Map<string, SectionMarker[]> {
  const map = new Map<string, SectionMarker[]>();
  for (const m of markers) {
    const list = map.get(m.overlayName) ?? [];
    list.push(m);
    map.set(m.overlayName, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function OverlayInfo({
  overlay,
  applied,
  maxWidth,
}: {
  overlay: OverlayFile;
  applied: OverlayAppliedState | undefined;
  maxWidth: number;
}) {
  const enabled = overlay.meta.enabled === false ? 'disabled' : 'enabled';
  const prio = overlay.meta.priority ?? 50;
  const status =
    applied && applied.appliedScopes.length > 0
      ? `applied[${applied.appliedScopes.join(',')}]`
      : 'pending';
  const desc = overlay.meta.description ?? '';
  const targets = overlay.meta.targets.join(', ');

  // Header line: name + status
  const headerExtra = `  [${enabled}]  priority=${prio}  ${status}`;
  const nameMaxLen = maxWidth - headerExtra.length - 4;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan" bold>
          {truncate(overlay.meta.name, Math.max(10, nameMaxLen))}
        </Text>
        <Text dimColor>{headerExtra}</Text>
      </Box>
      <Text dimColor>    targets: {targets}</Text>
      {desc ? <Text dimColor>    {truncate(desc, maxWidth - 4)}</Text> : null}
    </Box>
  );
}

function SectionMapView({
  targets,
  maxWidth,
}: {
  targets: TargetInfo[];
  maxWidth: number;
}) {
  if (targets.length === 0) return null;

  return (
    <Box flexDirection="column" marginTop={1}>
      {targets.map((t) => {
        const overlayNames = new Set(t.markers.map((m) => m.overlayName));

        // Build section -> markers lookup
        const sectionMarkers = new Map<string, SectionMarker[]>();
        for (const marker of t.markers) {
          let sectionName = '(outside sections)';
          for (const sec of t.sections) {
            if (marker.line > sec.openLine && marker.line < sec.closeLine) {
              sectionName = sec.name;
              break;
            }
          }
          const list = sectionMarkers.get(sectionName) ?? [];
          list.push(marker);
          sectionMarkers.set(sectionName, list);
        }

        return (
          <Box key={t.name} flexDirection="column" marginTop={1}>
            <Text bold>
              {'=== '}
              {t.name}.md
              {` (${overlayNames.size} overlay${overlayNames.size !== 1 ? 's' : ''}) ===`}
            </Text>
            {t.sections.map((sec) => {
              const lineRange = `L${sec.openLine + 1}-L${sec.closeLine + 1}`;
              const secMs = sectionMarkers.get(sec.name);
              const grouped = secMs ? groupMarkersByOverlay(secMs) : new Map();

              return (
                <Box key={sec.name} flexDirection="column">
                  <Text>
                    <Text dimColor>{'  '}{`[${lineRange}]`.padEnd(14)}</Text>
                    <Text color="yellow">{`<${sec.name}>`}</Text>
                  </Text>
                  {[...grouped.entries()].map(([ovName, patches]) => {
                    const patchNums = patches.map((p: SectionMarker) => `#${p.patchIdx}`).join(', ');
                    const desc = patches[0].description;
                    const descText = desc
                      ? `  "${truncate(desc, maxWidth - 30 - ovName.length)}"`
                      : '';
                    return (
                      <Text key={ovName}>
                        {'                   \u251c\u2500 '}
                        <Text color="green">{ovName}</Text>
                        <Text dimColor> ({patchNums}){descText}</Text>
                      </Text>
                    );
                  })}
                </Box>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function OverlayList({
  overlays: initialOverlays,
  errors,
  appliedState: initialApplied,
  targets: initialTargets,
  interactive,
  onDelete,
}: OverlayListProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const maxWidth = stdout?.columns ?? 80;

  const [overlays, setOverlays] = useState(initialOverlays);
  const [appliedState, setAppliedState] = useState(initialApplied);
  const [targets, setTargets] = useState(initialTargets);
  const [mode, setMode] = useState<Mode>(interactive ? 'view' : 'view');
  const [cursor, setCursor] = useState(0);
  const [message, setMessage] = useState('');

  const overlayNames = useMemo(() => overlays.map((o) => o.meta.name), [overlays]);

  useInput((input, key) => {
    if (!interactive) {
      // Any key exits in non-interactive mode
      if (key.return || key.escape || input === 'q') exit();
      return;
    }

    if (mode === 'view') {
      if (input === 'd' && overlays.length > 0) {
        setMode('select');
        setCursor(0);
        setMessage('');
      } else if (input === 'q' || key.escape) {
        exit();
      }
    } else if (mode === 'select') {
      if (key.upArrow) {
        setCursor((c) => (c <= 0 ? overlayNames.length - 1 : c - 1));
      } else if (key.downArrow) {
        setCursor((c) => (c >= overlayNames.length - 1 ? 0 : c + 1));
      } else if (key.return) {
        const name = overlayNames[cursor];
        if (name) {
          onDelete(name);
          // Update local state: remove deleted overlay
          setOverlays((prev) => prev.filter((o) => o.meta.name !== name));
          setAppliedState((prev) => {
            const next = new Map(prev);
            next.delete(name);
            return next;
          });
          setTargets((prev) =>
            prev.map((t) => ({
              ...t,
              markers: t.markers.filter((m) => m.overlayName !== name),
            })).filter((t) => t.markers.length > 0 || t.sections.length > 0),
          );
          setMessage(`Deleted "${name}"`);
          setCursor(0);
          setMode('view');
        }
      } else if (key.escape) {
        setMode('view');
      }
    }
  });

  // If all overlays removed
  if (overlays.length === 0 && errors.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>No overlays installed.</Text>
        {message ? <Text color="green">{message}</Text> : null}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Text bold color="cyan">Overlays</Text>

      {/* Overlay list */}
      <Box flexDirection="column" marginTop={1}>
        {overlays.map((o) => (
          <OverlayInfo
            key={o.meta.name}
            overlay={o}
            applied={appliedState.get(o.meta.name)}
            maxWidth={maxWidth}
          />
        ))}
      </Box>

      {/* Load errors */}
      {errors.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="red" bold>Load errors:</Text>
          {errors.map((e, i) => (
            <Box key={i} flexDirection="column">
              <Text color="red">{'  ! '}{e.path}</Text>
              {e.errors.map((msg, j) => (
                <Text key={j} dimColor>{'      '}{msg}</Text>
              ))}
            </Box>
          ))}
        </Box>
      ) : null}

      {/* Section map */}
      <SectionMapView targets={targets} maxWidth={maxWidth} />

      {/* Status message */}
      {message ? (
        <Box marginTop={1}>
          <Text color="green">{message}</Text>
        </Box>
      ) : null}

      {/* Delete selection mode */}
      {mode === 'select' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="yellow">Select overlay to delete:</Text>
          {overlayNames.map((name, i) => {
            const hl = i === cursor;
            const ov = overlays.find((o) => o.meta.name === name);
            const desc = ov?.meta.description ?? ov?.meta.targets.join(', ') ?? '';
            return (
              <Box key={name}>
                <Text color={hl ? 'cyan' : 'gray'}>{hl ? '>' : ' '} </Text>
                <Text color={hl ? 'cyan' : undefined} bold={hl}>{name}</Text>
                <Text dimColor> {'\u2014'} {truncate(desc, maxWidth - name.length - 6)}</Text>
              </Box>
            );
          })}
          <Box marginTop={1}><Text dimColor>[Enter] Delete  [Esc] Cancel</Text></Box>
        </Box>
      ) : null}

      {/* Footer hints */}
      {interactive && mode === 'view' ? (
        <Box marginTop={1}>
          <Text dimColor>
            {overlays.length > 0 ? '[d] Delete  ' : ''}[q] Quit
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
