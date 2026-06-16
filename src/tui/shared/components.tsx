// ---------------------------------------------------------------------------
// TUI Shared Components — reusable building blocks for all modules
// ---------------------------------------------------------------------------

import React from 'react';
import { Box, Text } from 'ink';
import { C, SYM, SP } from './tokens.js';

// ---------------------------------------------------------------------------
// KeyHints — context-sensitive keyboard shortcut footer
// ---------------------------------------------------------------------------

interface KeyHintsProps {
  hints: string;
}

/**
 * Standardized keyboard hint footer.
 * Always rendered at the bottom of interactive screens with marginTop={1}.
 */
export function KeyHints({ hints }: KeyHintsProps) {
  return (
    <Box marginTop={SP.sectionGap} paddingX={SP.detailPadX}>
      <Text dimColor>{hints}</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// SectionHeader — consistent section title
// ---------------------------------------------------------------------------

interface SectionHeaderProps {
  title: string;
}

/**
 * Bold cyan section header — the standard heading pattern.
 */
export function SectionHeader({ title }: SectionHeaderProps) {
  return <Text bold color={C.primary}>{title}</Text>;
}

// ---------------------------------------------------------------------------
// StatusBadge — enabled/disabled indicator
// ---------------------------------------------------------------------------

interface StatusBadgeProps {
  enabled: boolean;
  /** Override labels. Default: ✓/✗ */
  labels?: { on: string; off: string };
}

/**
 * Standardized status indicator: green ✓ or red ✗.
 */
export function StatusBadge({ enabled, labels }: StatusBadgeProps) {
  const label = enabled
    ? (labels?.on ?? SYM.enabled)
    : (labels?.off ?? SYM.disabled);
  return (
    <Text color={enabled ? C.success : C.error}>{label}</Text>
  );
}

// ---------------------------------------------------------------------------
// CursorMarker — navigation cursor for list items
// ---------------------------------------------------------------------------

interface CursorMarkerProps {
  active: boolean;
}

/**
 * Standardized cursor: ▸ in cyan when active, space when not.
 */
export function CursorMarker({ active }: CursorMarkerProps) {
  return (
    <Text color={active ? C.primary : undefined}>
      {active ? SYM.cursor : SYM.cursorBlank}{' '}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Checkbox — multi-select checkbox indicator
// ---------------------------------------------------------------------------

interface CheckboxProps {
  checked: boolean;
  highlighted?: boolean;
}

/**
 * Standardized checkbox: [x] in green when checked, [ ] in gray when not.
 * When highlighted and checked, uses greenBright.
 */
export function Checkbox({ checked, highlighted }: CheckboxProps) {
  const color = checked
    ? (highlighted ? C.successBright : C.success)
    : C.neutral;
  return (
    <Text color={color}>{checked ? SYM.checkOn : SYM.checkOff} </Text>
  );
}

// ---------------------------------------------------------------------------
// Breadcrumb — navigation path (Hub > Section > Panel)
// ---------------------------------------------------------------------------

interface BreadcrumbProps {
  path: string[];
}

export function Breadcrumb({ path }: BreadcrumbProps) {
  return (
    <Box>
      {path.map((segment, i) => (
        <Box key={i}>
          {i > 0 && <Text dimColor> {'>'} </Text>}
          <Text color={i === path.length - 1 ? C.primary : C.neutral} bold={i === path.length - 1}>
            {segment}
          </Text>
        </Box>
      ))}
      <Text dimColor>{'  '}[Esc] back</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// StepProgress — flow step progress indicators
// ---------------------------------------------------------------------------

interface StepProgressProps {
  steps: { key: string; label: string }[];
  currentKey: string;
}

/**
 * Horizontal step progress bar: [x] done [>] current [ ] pending
 */
export function StepProgress({ steps, currentKey }: StepProgressProps) {
  const currentIdx = steps.findIndex(s => s.key === currentKey);
  return (
    <Box gap={SP.inlineGap}>
      {steps.map((s, i) => {
        const isDone = i < currentIdx;
        const isCurrent = s.key === currentKey;
        const symbol = isDone ? SYM.stepDone : isCurrent ? SYM.stepActive : SYM.stepPending;
        const color = isDone ? C.success : isCurrent ? C.primary : C.neutral;
        return (
          <Text key={s.key} bold={isCurrent} color={color}>
            {symbol} {s.label}
          </Text>
        );
      })}
    </Box>
  );
}
