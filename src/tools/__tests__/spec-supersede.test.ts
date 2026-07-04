import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { supersedeEntry, getEvolutionChain, backfillSids, analyzeSpecHealth } from '../spec-conflict-marker.js';
import { parseSpecEntries } from '../spec-entry-parser.js';

let root: string;
let specsDir: string;

const OLD = 'S-20260101-old1';
const NEW = 'S-20260701-new1';

function specFile(extraEntries = ''): string {
  return `---
category: coding
---

<spec-entry category="coding" keywords="auth" date="2026-01-01" sid="${OLD}" title="Old rule">

### Old rule

Use JWT.

</spec-entry>

<spec-entry category="coding" keywords="auth" date="2026-07-01" sid="${NEW}" title="New rule" supersedes="${OLD}">

### New rule

Use OAuth.

</spec-entry>
${extraEntries}`;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'supersede-'));
  specsDir = join(root, '.workflow', 'specs');
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(join(specsDir, 'coding-conventions.md'), specFile(), 'utf-8');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('supersedeEntry', () => {
  it('marks the old entry deprecated with a superseded-by pointer', () => {
    const result = supersedeEntry(root, OLD, NEW);
    expect(result.success).toBe(true);

    const raw = readFileSync(join(specsDir, 'coding-conventions.md'), 'utf-8');
    const { entries } = parseSpecEntries(raw);
    const old = entries.find(e => e.sid === OLD)!;
    expect(old.status).toBe('deprecated');
    expect(old.supersededBy).toBe(NEW);

    // The replacement remains active and untouched.
    const fresh = entries.find(e => e.sid === NEW)!;
    expect(fresh.status).toBeUndefined();
  });

  it('reports failure when the sid does not exist', () => {
    const result = supersedeEntry(root, 'S-does-not-exist', NEW);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  it('is idempotent — re-running keeps a single status attribute', () => {
    supersedeEntry(root, OLD, NEW);
    supersedeEntry(root, OLD, NEW);
    const raw = readFileSync(join(specsDir, 'coding-conventions.md'), 'utf-8');
    const statusCount = (raw.match(/status="deprecated"/g) ?? []).length;
    const supersededByCount = (raw.match(/superseded-by=/g) ?? []).length;
    expect(statusCount).toBe(1);
    expect(supersededByCount).toBe(1);
  });
});

describe('getEvolutionChain', () => {
  it('returns the ordered chain (oldest → newest) from any member sid', () => {
    supersedeEntry(root, OLD, NEW);
    const fromOld = getEvolutionChain(root, OLD);
    const fromNew = getEvolutionChain(root, NEW);

    expect(fromOld.map(l => l.sid)).toEqual([OLD, NEW]);
    expect(fromNew.map(l => l.sid)).toEqual([OLD, NEW]);
    expect(fromOld[0].current).toBe(false);
    expect(fromOld[1].current).toBe(true);
  });

  it('builds the chain from supersedes before deprecated markers are synced', () => {
    // No supersedeEntry() call yet — the chain is still reconstructed purely
    // from NEW.supersedes=OLD, and NEW is reported as current (chain head).
    const chain = getEvolutionChain(root, NEW);
    expect(chain.map(l => l.sid)).toEqual([OLD, NEW]);
    expect(chain[chain.length - 1].current).toBe(true);
  });

  it('returns [] for an unknown sid', () => {
    expect(getEvolutionChain(root, 'S-nope')).toEqual([]);
  });

  it('does not loop forever on a cyclic chain', () => {
    // Craft a cycle: A supersedes B, B supersedes A.
    const cyclic = `---
category: coding
---

<spec-entry category="coding" keywords="x" date="2026-01-01" sid="S-A" title="A" supersedes="S-B">

### A

a

</spec-entry>

<spec-entry category="coding" keywords="x" date="2026-02-01" sid="S-B" title="B" supersedes="S-A">

### B

b

</spec-entry>`;
    writeFileSync(join(specsDir, 'coding-conventions.md'), cyclic, 'utf-8');
    const chain = getEvolutionChain(root, 'S-A');
    // Terminates; length bounded by number of distinct sids.
    expect(chain.length).toBeLessThanOrEqual(2);
  });
});

describe('backfillSids', () => {
  it('assigns a sid to entries that lack one and is idempotent', () => {
    const legacy = `---
category: coding
---

<spec-entry category="coding" keywords="a" date="2026-01-01" title="No sid here">

### No sid here

body

</spec-entry>`;
    writeFileSync(join(specsDir, 'coding-conventions.md'), legacy, 'utf-8');

    const first = backfillSids(root);
    expect(first.updated).toBe(1);

    const raw = readFileSync(join(specsDir, 'coding-conventions.md'), 'utf-8');
    expect(raw).toMatch(/sid="S-\d{8}-[a-z0-9]{4}"/);

    // Second run is a no-op.
    const second = backfillSids(root);
    expect(second.updated).toBe(0);
  });
});

describe('analyzeSpecHealth', () => {
  it('reports lifecycle counts and chain integrity', () => {
    supersedeEntry(root, OLD, NEW);
    const h = analyzeSpecHealth(root);
    expect(h.total).toBe(2);
    expect(h.active).toBe(1);
    expect(h.deprecated).toBe(1);
    expect(h.withSid).toBe(2);
    expect(h.chains).toBe(1);
    expect(h.danglingSupersedes).toEqual([]);
    expect(h.cyclicSids).toEqual([]);
  });

  it('flags a dangling supersedes reference', () => {
    const dangling = `---
category: coding
---

<spec-entry category="coding" keywords="a" date="2026-07-01" sid="S-live-1" title="Live" supersedes="S-ghost">

### Live

body

</spec-entry>`;
    writeFileSync(join(specsDir, 'coding-conventions.md'), dangling, 'utf-8');
    const h = analyzeSpecHealth(root);
    expect(h.danglingSupersedes).toHaveLength(1);
    expect(h.danglingSupersedes[0].target).toBe('S-ghost');
  });

  it('detects a supersedes cycle', () => {
    const cyclic = `---
category: coding
---

<spec-entry category="coding" keywords="x" date="2026-01-01" sid="S-A" title="A" supersedes="S-B">

### A

a

</spec-entry>

<spec-entry category="coding" keywords="x" date="2026-02-01" sid="S-B" title="B" supersedes="S-A">

### B

b

</spec-entry>`;
    writeFileSync(join(specsDir, 'coding-conventions.md'), cyclic, 'utf-8');
    const h = analyzeSpecHealth(root);
    expect(h.cyclicSids.sort()).toEqual(['S-A', 'S-B']);
  });
});
