import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  supersedeEntry, getEvolutionChain, backfillSids, analyzeSpecHealth,
  markConflict, clearConflict, clearAllConflicts, listConflicts,
} from '../spec-conflict-marker.js';
import { parseSpecEntries } from '../spec-entry-parser.js';

let root: string;
let specsDir: string;
let prevMaestroHome: string | undefined;

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
  // specDirs() resolves the global scope from MAESTRO_HOME — isolate per test.
  prevMaestroHome = process.env.MAESTRO_HOME;
  process.env.MAESTRO_HOME = join(root, '.maestro');
});

afterEach(() => {
  if (prevMaestroHome === undefined) delete process.env.MAESTRO_HOME;
  else process.env.MAESTRO_HOME = prevMaestroHome;
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

describe('conflict mark → list → clear round-trip (raw line numbers)', () => {
  function tagLineOf(sid: string): number {
    const raw = readFileSync(join(specsDir, 'coding-conventions.md'), 'utf-8');
    return raw.split('\n').findIndex(l => l.includes(`sid="${sid}"`)) + 1;
  }

  it('list reports the raw line number so clear lands on the same tag despite frontmatter', () => {
    const line = tagLineOf(OLD);
    expect(markConflict(root, 'coding-conventions.md', line, { note: 'disputed' }).success).toBe(true);

    const listed = listConflicts(root);
    expect(listed).toHaveLength(1);
    expect(listed[0].lineStart).toBe(line);

    const cleared = clearConflict(root, listed[0].file, listed[0].lineStart);
    expect(cleared.success).toBe(true);
    expect(listConflicts(root)).toEqual([]);

    const after = readFileSync(join(specsDir, 'coding-conventions.md'), 'utf-8');
    expect(after).not.toContain('conflict-marker=');
    expect(after).not.toContain('conflict-note=');
    expect(after).not.toContain('conflict-date=');
  });

  it('clear-all clears every marked entry in a frontmatter\'d file', () => {
    expect(markConflict(root, 'coding-conventions.md', tagLineOf(OLD), { note: 'a' }).success).toBe(true);
    expect(markConflict(root, 'coding-conventions.md', tagLineOf(NEW), { note: 'b' }).success).toBe(true);

    const result = clearAllConflicts(root, 'coding-conventions.md');
    expect(result.errors).toEqual([]);
    expect(result.cleared).toBe(2);
    expect(listConflicts(root)).toEqual([]);
  });

  it('records conflict-date at mark time and prefers it in list output', () => {
    markConflict(root, 'coding-conventions.md', tagLineOf(OLD), { note: 'aging check' });

    const today = new Date().toISOString().slice(0, 10);
    const raw = readFileSync(join(specsDir, 'coding-conventions.md'), 'utf-8');
    expect(raw).toContain(`conflict-date="${today}"`);

    const listed = listConflicts(root);
    expect(listed[0].date).toBe(today);
  });

  it('health counts contested entries whose conflict-date is older than 30 days', () => {
    markConflict(root, 'coding-conventions.md', tagLineOf(OLD), { note: 'old dispute' });
    const raw = readFileSync(join(specsDir, 'coding-conventions.md'), 'utf-8');
    writeFileSync(
      join(specsDir, 'coding-conventions.md'),
      raw.replace(/conflict-date="[^"]*"/, 'conflict-date="2026-01-01"'),
      'utf-8',
    );

    const h = analyzeSpecHealth(root, Date.parse('2026-07-01'));
    expect(h.contested).toBe(1);
    expect(h.contestedStale).toBe(1);
  });
});

describe('broken evolution chain (successor deleted)', () => {
  const DEAD = `---
category: coding
---

<spec-entry category="coding" keywords="a" date="2026-01-01" sid="S-dead-1" title="Dead end" status="deprecated" superseded-by="S-gone">

### Dead end

body

</spec-entry>`;

  it('does not mark a deprecated chain head as current and flags it broken', () => {
    writeFileSync(join(specsDir, 'coding-conventions.md'), DEAD, 'utf-8');
    const chain = getEvolutionChain(root, 'S-dead-1');
    expect(chain).toHaveLength(1);
    expect(chain[0].current).toBe(false);
    expect(chain[0].broken).toBe(true);
  });

  it('health reports the dangling superseded-by reference', () => {
    writeFileSync(join(specsDir, 'coding-conventions.md'), DEAD, 'utf-8');
    const h = analyzeSpecHealth(root);
    expect(h.danglingSupersededBy).toHaveLength(1);
    expect(h.danglingSupersededBy[0].target).toBe('S-gone');
  });
});

describe('merge semantics — one entry supersedes several', () => {
  const OLD2 = 'S-20260102-old2';
  const EXTRA = `
<spec-entry category="coding" keywords="auth" date="2026-01-02" sid="${OLD2}" title="Second old rule">

### Second old rule

Use sessions.

</spec-entry>`;

  it('appends to supersedes instead of replacing the earlier link', () => {
    writeFileSync(join(specsDir, 'coding-conventions.md'), specFile(EXTRA), 'utf-8');
    expect(supersedeEntry(root, OLD2, NEW).success).toBe(true);

    const raw = readFileSync(join(specsDir, 'coding-conventions.md'), 'utf-8');
    expect(raw).toContain(`supersedes="${OLD},${OLD2}"`);

    // Both old entries still reach NEW through the forward adjacency.
    expect(getEvolutionChain(root, OLD).map(l => l.sid)).toContain(NEW);
    expect(getEvolutionChain(root, OLD2).map(l => l.sid)).toContain(NEW);

    // The dangling check splits the multi-value — nothing dangles here.
    expect(analyzeSpecHealth(root).danglingSupersedes).toEqual([]);
  });

  it('dedupes when the same supersede is re-run', () => {
    supersedeEntry(root, OLD, NEW);
    supersedeEntry(root, OLD, NEW);
    const raw = readFileSync(join(specsDir, 'coding-conventions.md'), 'utf-8');
    expect(raw).toContain(`supersedes="${OLD}"`);
    expect(raw).not.toContain(`${OLD},${OLD}`);
  });
});

describe('supersede guards', () => {
  it('rejects superseding a sid with itself', () => {
    const result = supersedeEntry(root, OLD, OLD);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/itself/);
  });

  it('rejects re-superseding an entry that already points at a different successor', () => {
    const THIRD = 'S-20260715-thrd';
    const extra = `
<spec-entry category="coding" keywords="auth" date="2026-07-15" sid="${THIRD}" title="Third rule">

### Third rule

Use passkeys.

</spec-entry>`;
    writeFileSync(join(specsDir, 'coding-conventions.md'), specFile(extra), 'utf-8');
    expect(supersedeEntry(root, OLD, NEW).success).toBe(true);

    const result = supersedeEntry(root, OLD, THIRD);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already superseded by/);
    expect(result.error).toContain(`maestro spec history ${OLD}`);

    // The established link is untouched.
    const raw = readFileSync(join(specsDir, 'coding-conventions.md'), 'utf-8');
    expect(raw).toContain(`superseded-by="${NEW}"`);
    expect(raw).not.toContain(`superseded-by="${THIRD}"`);
  });
});

describe('multi-scope lifecycle (specDirs)', () => {
  const G_OLD = 'S-20260101-glob';

  function writeGlobalSpec(): string {
    const globalSpecs = join(root, '.maestro', 'specs');
    mkdirSync(globalSpecs, { recursive: true });
    writeFileSync(join(globalSpecs, 'coding-conventions.md'), `---
category: coding
---

<spec-entry category="coding" keywords="g" date="2026-01-01" sid="${G_OLD}" title="Global rule">

### Global rule

g

</spec-entry>`, 'utf-8');
    return globalSpecs;
  }

  it('supersedes an entry living in the global scope', () => {
    const globalSpecs = writeGlobalSpec();
    expect(supersedeEntry(root, G_OLD, NEW).success).toBe(true);

    const raw = readFileSync(join(globalSpecs, 'coding-conventions.md'), 'utf-8');
    expect(raw).toContain('status="deprecated"');
    expect(raw).toContain(`superseded-by="${NEW}"`);

    // History reconstructs the cross-scope chain.
    expect(getEvolutionChain(root, G_OLD).map(l => l.sid)).toContain(NEW);
  });

  it('health counts global-scope entries', () => {
    writeGlobalSpec();
    const h = analyzeSpecHealth(root);
    expect(h.total).toBe(3);
  });
});
