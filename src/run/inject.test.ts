import { describe, expect, it } from 'vitest';
import {
  buildEnvelope,
  buildIntentSection,
  buildBoundaryContractSection,
  buildProgressSection,
  buildSignalsSection,
  truncate,
  capList,
  type BoundaryContractInput,
  type ProgressInput,
  type SignalsInput,
} from './inject.js';

// The ralph anchor's completion verb, reused across envelope assertions.
const ralphVerb = (n: string) => `maestro ralph complete ${n} --session S1`;

describe('inject truncation helpers', () => {
  it('truncate leaves short strings untouched and caps long ones with an ellipsis', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('abcdefghij', 10)).toBe('abcdefghij');
    expect(truncate('abcdefghijk', 10)).toBe('abcdefghij…');
  });

  it('capList caps item count, truncates each item to 200 chars, and reports overflow', () => {
    expect(capList(['a', 'b'], 3)).toBe('a; b');
    expect(capList(['a', 'b', 'c', 'd'], 2)).toBe('a; b (+2 more)');
    const long = 'x'.repeat(250);
    expect(capList([long], 3)).toBe('x'.repeat(200) + '…');
  });
});

describe('buildIntentSection', () => {
  it('returns null for empty or whitespace-only intent', () => {
    expect(buildIntentSection('')).toBeNull();
    expect(buildIntentSection('   ')).toBeNull();
  });

  it('trims and truncates the intent at 1200 chars', () => {
    expect(buildIntentSection('  refactor auth  ')).toBe('**Intent**: refactor auth');
    const long = 'i'.repeat(1300);
    expect(buildIntentSection(long)).toBe('**Intent**: ' + 'i'.repeat(1200) + '…');
  });
});

describe('buildBoundaryContractSection', () => {
  const empty: BoundaryContractInput = {
    in_scope: [], out_of_scope: [], constraints: [], definition_of_done: '',
  };

  it('returns null when the contract is entirely empty', () => {
    expect(buildBoundaryContractSection(empty)).toBeNull();
  });

  it('emits only the populated fields with the 300-char done cap', () => {
    const section = buildBoundaryContractSection({
      in_scope: ['src/run'],
      out_of_scope: [],
      constraints: ['no schema bump'],
      definition_of_done: 'd'.repeat(400),
    });
    expect(section).toBe([
      '**Boundary Contract**:',
      '- In scope: src/run',
      '- Constraints: no schema bump',
      '- Done when: ' + 'd'.repeat(300) + '…',
    ].join('\n'));
    // out_of_scope line absent because it was empty
    expect(section).not.toContain('Out of scope');
  });
});

describe('buildProgressSection', () => {
  it('returns null when no recent steps are present', () => {
    const input: ProgressInput = { recent: [], done_count: 0, pending_count: 3 };
    expect(buildProgressSection(input)).toBeNull();
  });

  it('renders recent steps, caveats (150 cap), summaries (200 cap), and the progress tally', () => {
    const input: ProgressInput = {
      recent: [
        { step_id: 'step-000-plan', command: 'plan', stage: 'planning', summary: 's'.repeat(250), caveats: null },
        { step_id: 'step-001-exec', command: 'execute', stage: null, summary: null, caveats: 'c'.repeat(200) },
      ],
      done_count: 2,
      pending_count: 1,
    };
    expect(buildProgressSection(input)).toBe([
      '**Execution Progress**:',
      '- [step-000-plan] plan (planning): ' + 's'.repeat(200) + '…',
      '- [step-001-exec] execute (—): (no summary)',
      '  ⚠️ ' + 'c'.repeat(150) + '…',
      '- Progress: 2 done, 1 pending',
    ].join('\n'));
  });
});

describe('buildSignalsSection', () => {
  it('returns null when there are no caveats or deferred items', () => {
    const input: SignalsInput = { caveats: [], deferred: [] };
    expect(buildSignalsSection(input)).toBeNull();
  });

  it('keeps only the last 3 caveats and last 5 deferred items', () => {
    const input: SignalsInput = {
      caveats: ['c1', 'c2', 'c3', 'c4'],
      deferred: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'],
    };
    expect(buildSignalsSection(input)).toBe([
      '**⚠️ Accumulated Signals**:',
      '- Caveats: c2; c3; c4',
      '- Deferred work: d2; d3; d4; d5; d6',
      '- **Before proceeding, verify these signals do not conflict with your current task.**',
    ].join('\n'));
  });

  it('emits only the caveats line when deferred is empty', () => {
    const section = buildSignalsSection({ caveats: ['only'], deferred: [] });
    expect(section).toContain('- Caveats: only');
    expect(section).not.toContain('Deferred work');
  });
});

describe('buildEnvelope', () => {
  it('returns null when every section is null or empty', () => {
    expect(buildEnvelope({ sessionId: 'S1', sections: [null, '', null], completionVerb: ralphVerb })).toBeNull();
  });

  it('wraps surviving sections in the session_anchor frame with the completion guardrail', () => {
    const envelope = buildEnvelope({
      sessionId: 'S1',
      sections: ['**Intent**: do the thing', null, '**Scope**: small | Phase 1 | Milestone: M1'],
      completionVerb: ralphVerb,
    });
    expect(envelope).toBe([
      '<session_anchor>',
      '## Session Anchor — S1',
      '',
      '**Intent**: do the thing\n\n**Scope**: small | Phase 1 | Milestone: M1',
      '',
      '<!-- session_anchor: read-only grounding. Honor Intent + Boundary Contract before acting.',
      '     If your work would fall outside in_scope (or hit out_of_scope), stop and report via',
      '     `maestro ralph complete <N> --session S1 --status BLOCKED --reason "out_of_scope: ..."` instead of proceeding.',
      '     If Accumulated Signals suggest prior work conflicts with your task, report via',
      '     `maestro ralph complete <N> --session S1 --status BLOCKED --reason "drift_conflict: ..."` instead of proceeding. -->',
      '</session_anchor>',
    ].join('\n'));
  });

  it('accepts an engine-specific completion verb in the guardrail', () => {
    const envelope = buildEnvelope({
      sessionId: 'S2',
      sections: ['**Intent**: x'],
      completionVerb: (n) => `maestro run complete ${n}`,
    });
    expect(envelope).toContain('`maestro run complete <N> --status BLOCKED --reason "out_of_scope: ..."`');
    expect(envelope).toContain('`maestro run complete <N> --status BLOCKED --reason "drift_conflict: ..."`');
  });

  it('full assembly preserves section order and separates sections with a blank line', () => {
    const sections = [
      buildIntentSection('build the feature'),
      '**Scope**: small | Phase 1 | Milestone: M1',
      buildBoundaryContractSection({
        in_scope: ['src/run'], out_of_scope: ['schemas'], constraints: [], definition_of_done: 'tests green',
      }),
      buildProgressSection({
        recent: [{ step_id: 'step-000-plan', command: 'plan', stage: 'planning', summary: 'plan ready', caveats: null }],
        done_count: 1,
        pending_count: 1,
      }),
      buildSignalsSection({ caveats: ['watch the lock'], deferred: [] }),
    ];
    const envelope = buildEnvelope({ sessionId: 'S1', sections, completionVerb: ralphVerb })!;

    // All sections present, in order.
    const iIntent = envelope.indexOf('**Intent**:');
    const iScope = envelope.indexOf('**Scope**:');
    const iBoundary = envelope.indexOf('**Boundary Contract**:');
    const iProgress = envelope.indexOf('**Execution Progress**:');
    const iSignals = envelope.indexOf('**⚠️ Accumulated Signals**:');
    expect(iIntent).toBeGreaterThanOrEqual(0);
    expect(iScope).toBeGreaterThan(iIntent);
    expect(iBoundary).toBeGreaterThan(iScope);
    expect(iProgress).toBeGreaterThan(iBoundary);
    expect(iSignals).toBeGreaterThan(iProgress);
    // Frame + guardrail intact.
    expect(envelope.startsWith('<session_anchor>\n## Session Anchor — S1\n')).toBe(true);
    expect(envelope.endsWith('</session_anchor>')).toBe(true);
  });
});
