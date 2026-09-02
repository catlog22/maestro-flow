import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auditKnowledge } from './audit.js';
import { createRun } from '../run/runtime.js';

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'maestro-knowledge-audit-'));
  roots.push(path);
  mkdirSync(join(path, '.workflow'), { recursive: true });
  writeFileSync(join(path, '.workflow', 'config.json'), JSON.stringify({
    session_schema: {
      schema_version: 'session-schema-selection/1.0',
      writer: 'session/1.3',
      features: { session_statusless: false },
    },
  }), 'utf8');
  return path;
}

function writeUnsynchronizedChain(projectRoot: string): string {
  const dir = join(projectRoot, '.workflow', 'specs');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'coding-conventions.md');
  writeFileSync(path, `---
category: coding
---

<spec-entry category="coding" keywords="store" date="2026-07-01" sid="S-old" title="Old store rule">

### Old store rule

Use the old store.

</spec-entry>

<spec-entry category="coding" keywords="store" date="2026-07-02" sid="S-new" title="New store rule" supersedes="S-old">

### New store rule

Use the canonical store.

</spec-entry>
`, 'utf8');
  return path;
}

function installCommand(projectRoot: string): void {
  const commandDir = join(projectRoot, '.claude', 'commands');
  const workflowDir = join(projectRoot, 'workflows');
  mkdirSync(commandDir, { recursive: true });
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(
    join(commandDir, 'audit-demo.md'),
    '<contract>\nconsumes: []\nproduces: []\ngates:\n  entry: []\n  exit: []\n</contract>\n',
    'utf8',
  );
  writeFileSync(join(workflowDir, 'audit-demo.md'), '# audit-demo\n', 'utf8');
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('knowledge audit and pruning', () => {
  it('keeps the default audit read-only and exposes deterministic lifecycle repair', async () => {
    const projectRoot = root();
    const specPath = writeUnsynchronizedChain(projectRoot);

    const report = await auditKnowledge(projectRoot, { scope: 'spec' });
    expect(report.findings).toContainEqual(expect.objectContaining({
      subtype: 'unsynchronized-supersession',
      target: 'S-old',
      recommended_action: 'deprecate',
    }));
    expect(report.prune_plan).toEqual([]);
    expect(readFileSync(specPath, 'utf8')).not.toContain('sid="S-old" title="Old store rule" status="deprecated"');

    const planned = await auditKnowledge(projectRoot, { scope: 'spec', prune: true });
    expect(planned.prune_plan).toEqual([
      expect.objectContaining({
        action: 'deprecate',
        target_id: 'S-old',
        successor_id: 'S-new',
      }),
    ]);
    expect(readFileSync(specPath, 'utf8')).not.toContain('sid="S-old" title="Old store rule" status="deprecated"');
  });

  it('declares that usage signals cannot independently trigger pruning', async () => {
    const projectRoot = root();
    const report = await auditKnowledge(projectRoot, { scope: 'all', prune: true });
    expect(report.safety).toEqual({
      usage_only_never_pruned: true,
      physical_delete: false,
      diagnostics_read_only: true,
      normalization_requires_prior_report: true,
    });
    expect(report.prune_plan.every(action => action.reason === 'unsynchronized-supersession'))
      .toBe(true);
    expect(existsSync(join(projectRoot, '.workflow', 'sessions'))).toBe(false);
  });

  it('soft-prunes exact spec duplicates with a deterministic canonical successor', async () => {
    const projectRoot = root();
    const dir = join(projectRoot, '.workflow', 'specs');
    mkdirSync(dir, { recursive: true });
    const specPath = join(dir, 'coding-conventions.md');
    writeFileSync(specPath, `---
category: coding
---

<spec-entry category="coding" keywords="store" date="2026-07-01" sid="S-a" title="Store rule">

### Store rule

Use one transaction.

</spec-entry>

<spec-entry category="coding" keywords="store" date="2026-07-02" sid="S-b" title="Store rule">

### Store rule

Use one transaction.

</spec-entry>
`, 'utf8');

    const before = readFileSync(specPath, 'utf8');
    const planned = await auditKnowledge(projectRoot, { scope: 'spec', prune: true });
    expect(planned.prune_plan).toEqual([
      expect.objectContaining({
        store: 'spec',
        target_id: 'S-b',
        successor_id: 'S-a',
        reason: 'exact-duplicate',
      }),
    ]);
    expect(readFileSync(specPath, 'utf8')).toBe(before);
  });

  it('soft-prunes exact knowhow duplicates through the lifecycle supersession API', async () => {
    const projectRoot = root();
    const dir = join(projectRoot, '.workflow', 'knowhow');
    mkdirSync(dir, { recursive: true });
    const body = (title: string) => `---
title: ${title}
type: tip
status: active
---

Use bounded semantic neighborhoods.
`;
    const canonical = join(dir, 'TIP-20260728-a.md');
    const duplicate = join(dir, 'TIP-20260728-b.md');
    writeFileSync(canonical, body('Search diversity'), 'utf8');
    writeFileSync(duplicate, body('Search diversity'), 'utf8');

    const canonicalBefore = readFileSync(canonical, 'utf8');
    const duplicateBefore = readFileSync(duplicate, 'utf8');
    const planned = await auditKnowledge(projectRoot, { scope: 'knowhow', prune: true });
    expect(planned.prune_plan).toEqual([
      expect.objectContaining({
        store: 'knowhow',
        target_id: 'knowhow-tip-20260728-b',
        successor_id: 'knowhow-tip-20260728-a',
        reason: 'exact-duplicate',
      }),
    ]);
    expect(readFileSync(canonical, 'utf8')).toBe(canonicalBefore);
    expect(readFileSync(duplicate, 'utf8')).toBe(duplicateBefore);
  });

  it('prefers canonical Knowhow lifecycle and related paths over conflicting legacy aliases', async () => {
    const projectRoot = root();
    const dir = join(projectRoot, '.workflow', 'knowhow');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'TIP-20260728-canonical.md');
    writeFileSync(path, `---
title: Canonical metadata
type: tip
lifecycleStatus: deprecated
status: active
relatedPaths:
  - src/existing.ts
codePaths:
  - src/missing.ts
---

Canonical fields win.
`, 'utf8');
    writeFileSync(join(projectRoot, 'src', 'existing.ts'), '', 'utf8');

    const report = await auditKnowledge(projectRoot, { scope: 'knowhow' });
    expect(report.knowhow).toMatchObject({ active: 0, deprecated: 1 });
    expect(report.findings).not.toContainEqual(expect.objectContaining({
      subtype: 'ghost-code-reference',
      evidence: expect.stringContaining('src/missing.ts'),
    }));
    expect(readFileSync(path, 'utf8')).toContain('status: active');
  });

  it('reports corrupt Session authority instead of returning a clean pipeline', async () => {
    const projectRoot = root();
    const sessionDir = join(projectRoot, '.workflow', 'sessions', 'corrupt-session');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'session.json'), '{}\n', 'utf8');

    const report = await auditKnowledge(projectRoot, { scope: 'all' });
    expect(report.findings).toContainEqual(expect.objectContaining({
      store: 'pipeline',
      priority: 'P1',
      subtype: 'invalid-session-authority',
      target: 'corrupt-session',
    }));
  });

  it('reports an invalid knowledge ledger instead of swallowing it', async () => {
    const projectRoot = root();
    installCommand(projectRoot);
    const created = createRun({
      projectRoot,
      command: 'audit-demo',
      sessionId: 'ledger-session',
      intent: 'audit invalid ledger',
    });
    writeFileSync(
      join(
        projectRoot,
        '.workflow',
        'sessions',
        created.session_id,
        'runs',
        created.run_id,
        'knowledge-delta.json',
      ),
      '{}\n',
      'utf8',
    );

    const report = await auditKnowledge(projectRoot, { scope: 'all' });
    const finding = report.findings.find(item => item.subtype === 'invalid-knowledge-ledger');
    expect(finding).toEqual(expect.objectContaining({
      store: 'pipeline',
      priority: 'P1',
      subtype: 'invalid-knowledge-ledger',
      target: created.session_id,
    }));
    expect(finding!.evidence.length).toBeLessThan(500);
    expect(finding!.evidence).toContain('schema_version');
  });
});
