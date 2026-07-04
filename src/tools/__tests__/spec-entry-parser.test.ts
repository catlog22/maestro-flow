import { describe, it } from 'vitest';
import assert from 'node:assert';
import {
  parseSpecEntries,
  validateSpecEntry,
  validateCategoryMatch,
  formatSpecEntries,
  formatNewEntry,
  generateSid,
  VALID_CATEGORIES,
} from '../spec-entry-parser.js';

// ---------------------------------------------------------------------------
// parseSpecEntries
// ---------------------------------------------------------------------------

describe('parseSpecEntries', () => {
  it('parses a single <spec-entry> block', () => {
    const content = `
<spec-entry category="coding" keywords="auth,token" date="2026-04-21">

### Token rotation needs email

Revoked column must be set.

</spec-entry>
`;
    const result = parseSpecEntries(content);
    assert.strictEqual(result.entries.length, 1);
    assert.strictEqual(result.errors.length, 0);

    const entry = result.entries[0];
    assert.strictEqual(entry.category, 'coding');
    assert.deepStrictEqual(entry.keywords, ['auth', 'token']);
    assert.strictEqual(entry.date, '2026-04-21');
    assert.strictEqual(entry.title, 'Token rotation needs email');
    assert.ok(entry.content.includes('Revoked column'));
  });

  it('parses multiple <spec-entry> blocks', () => {
    const content = `
<spec-entry category="coding" keywords="naming" date="2026-04-01">

### Use camelCase

Always use camelCase for variables.

</spec-entry>

<spec-entry category="arch" keywords="module,boundary" date="2026-04-02">

### No circular deps

Modules must not have circular dependencies.

</spec-entry>
`;
    const result = parseSpecEntries(content);
    assert.strictEqual(result.entries.length, 2);
    assert.strictEqual(result.entries[0].category, 'coding');
    assert.strictEqual(result.entries[1].category, 'arch');
  });

  it('extracts optional source attribute', () => {
    const content = `
<spec-entry category="learning" keywords="bug" date="2026-04-21" source="agent">

### Found off-by-one

Content here.

</spec-entry>
`;
    const result = parseSpecEntries(content);
    assert.strictEqual(result.entries[0].source, 'agent');
  });

  it('reports errors for missing attributes', () => {
    const content = `
<spec-entry date="2026-04-21">

### No category or keywords

Some content.

</spec-entry>
`;
    const result = parseSpecEntries(content);
    assert.strictEqual(result.entries.length, 1);
    assert.ok(result.errors.length >= 2); // missing category + missing keywords
    assert.ok(result.errors.some(e => e.message.includes('category')));
    assert.ok(result.errors.some(e => e.message.includes('keywords')));
  });

  it('reports error for invalid date format', () => {
    const content = `
<spec-entry category="coding" keywords="test" date="04-21-2026">

### Bad date

Content.

</spec-entry>
`;
    const result = parseSpecEntries(content);
    assert.ok(result.errors.some(e => e.message.includes('date')));
  });

  it('reports error for invalid category', () => {
    const content = `
<spec-entry category="invalid" keywords="test" date="2026-04-21">

### Invalid category

Content.

</spec-entry>
`;
    const result = parseSpecEntries(content);
    assert.ok(result.errors.some(e => e.message.includes('Invalid category')));
  });

  it('parses legacy heading entries from remaining text', () => {
    const content = `
### [2026-04-08 20:00] pattern: Schema isolation

Schema-per-tenant works well.
Phase: 1 | Source: phase-transition
`;
    const result = parseSpecEntries(content);
    assert.strictEqual(result.entries.length, 0);
    assert.strictEqual(result.legacy.length, 1);
    assert.ok(result.legacy[0].title.includes('pattern: Schema isolation'));
  });

  it('handles mixed new + legacy format', () => {
    const content = `
<spec-entry category="coding" keywords="naming" date="2026-04-21">

### Use camelCase

Content.

</spec-entry>

### [2026-04-08] decision: Use Zod

Zod provides better DX.
`;
    const result = parseSpecEntries(content);
    assert.strictEqual(result.entries.length, 1);
    assert.strictEqual(result.legacy.length, 1);
    assert.strictEqual(result.entries[0].title, 'Use camelCase');
    assert.ok(result.legacy[0].title.includes('decision: Use Zod'));
  });

  it('returns empty for content with no entries', () => {
    const content = `# Learnings

Some header text without entries.
`;
    const result = parseSpecEntries(content);
    assert.strictEqual(result.entries.length, 0);
    assert.strictEqual(result.legacy.length, 0);
  });

  it('handles keywords with spaces after commas', () => {
    const content = `
<spec-entry category="coding" keywords="auth, token, rotation" date="2026-04-21">

### Token rotation

Content.

</spec-entry>
`;
    const result = parseSpecEntries(content);
    assert.deepStrictEqual(result.entries[0].keywords, ['auth', 'token', 'rotation']);
  });
});

// ---------------------------------------------------------------------------
// validateSpecEntry
// ---------------------------------------------------------------------------

describe('validateSpecEntry', () => {
  it('returns empty array for valid entry with category', () => {
    const errors = validateSpecEntry({
      category: 'coding',
      keywords: ['auth'],
      date: '2026-04-21',
      title: 'Test',
      content: 'Content',
      lineStart: 1,
      lineEnd: 5,
    });
    assert.strictEqual(errors.length, 0);
  });

  it('requires category', () => {
    const errors = validateSpecEntry({
      category: '',
      keywords: ['auth'],
      date: '2026-04-21',
      title: 'Test',
      content: 'Content',
      lineStart: 1,
      lineEnd: 5,
    });
    assert.ok(errors.some(e => e.includes('category')));
  });

  it('validates all categories are accepted', () => {
    for (const cat of VALID_CATEGORIES) {
      const errors = validateSpecEntry({
        category: cat,
        keywords: ['test'],
        date: '2026-04-21',
        title: 'Test',
        content: 'Content',
        lineStart: 1,
        lineEnd: 5,
      });
      assert.strictEqual(errors.length, 0, `Category "${cat}" should be valid`);
    }
  });
});

// ---------------------------------------------------------------------------
// validateCategoryMatch
// ---------------------------------------------------------------------------

describe('validateCategoryMatch', () => {
  it('returns null when categories match', () => {
    const result = validateCategoryMatch(
      { category: 'coding', keywords: [], date: '', title: '', content: '', lineStart: 0, lineEnd: 0 },
      'coding',
    );
    assert.strictEqual(result, null);
  });

  it('returns error when categories mismatch', () => {
    const result = validateCategoryMatch(
      { category: 'arch', keywords: [], date: '', title: '', content: '', lineStart: 0, lineEnd: 0 },
      'coding',
    );
    assert.ok(result?.includes('does not match'));
  });
});

// ---------------------------------------------------------------------------
// formatSpecEntries
// ---------------------------------------------------------------------------

describe('formatSpecEntries', () => {
  const entries = [
    { category: 'coding', keywords: ['auth', 'token'], date: '2026-04-21', title: 'Token rotation', content: '### Token rotation\n\nContent about auth.', lineStart: 1, lineEnd: 5 },
    { category: 'coding', keywords: ['naming'], date: '2026-04-20', title: 'Use camelCase', content: '### Use camelCase\n\nNaming convention.', lineStart: 10, lineEnd: 14 },
  ];

  it('returns all entries when no keyword filter', () => {
    const result = formatSpecEntries(entries);
    assert.ok(result.includes('Token rotation'));
    assert.ok(result.includes('Use camelCase'));
  });

  it('filters by keyword', () => {
    const result = formatSpecEntries(entries, 'auth');
    assert.ok(result.includes('Token rotation'));
    assert.ok(!result.includes('Use camelCase'));
  });

  it('returns empty string when no matches', () => {
    const result = formatSpecEntries(entries, 'nonexistent');
    assert.strictEqual(result, '');
  });
});

// ---------------------------------------------------------------------------
// formatNewEntry
// ---------------------------------------------------------------------------

describe('formatNewEntry', () => {
  it('produces valid <spec-entry> block with category attribute', () => {
    const result = formatNewEntry('coding', ['auth', 'token'], '2026-04-21', 'Token rotation', 'Content here.');
    assert.ok(result.startsWith('<spec-entry'));
    assert.ok(result.endsWith('</spec-entry>'));
    assert.ok(result.includes('category="coding"'), 'should write category attribute');
    assert.ok(!result.includes('roles='), 'should not write roles attribute');
    assert.ok(result.includes('keywords="auth,token"'));
    assert.ok(result.includes('date="2026-04-21"'));
    assert.ok(result.includes('### Token rotation'));
  });

  it('includes source attribute when provided', () => {
    const result = formatNewEntry('coding', ['test'], '2026-04-21', 'Title', 'Body', 'agent');
    assert.ok(result.includes('source="agent"'));
  });

  it('omits source attribute when not provided', () => {
    const result = formatNewEntry('coding', ['test'], '2026-04-21', 'Title', 'Body');
    assert.ok(!result.includes('source='));
  });
});

// ---------------------------------------------------------------------------
// Supersession lifecycle (sid / supersedes / superseded-by / status)
// ---------------------------------------------------------------------------

describe('generateSid', () => {
  it('produces a stable S-YYYYMMDD-xxxx identity', () => {
    const sid = generateSid(new Date('2026-07-04T12:00:00Z'));
    assert.match(sid, /^S-20260704-[a-z0-9]{4}$/);
  });

  it('produces distinct ids across calls', () => {
    const a = generateSid();
    const b = generateSid();
    assert.notStrictEqual(a, b);
  });
});

describe('lifecycle round-trip', () => {
  it('writes and parses sid/supersedes/status attributes', () => {
    const entry = formatNewEntry(
      'coding', ['auth'], '2026-07-04', 'New rule', 'Body',
      undefined, undefined, undefined, undefined, undefined, undefined,
      { sid: 'S-20260704-aaaa', supersedes: 'S-20260101-bbbb' },
    );
    assert.ok(entry.includes('sid="S-20260704-aaaa"'));
    assert.ok(entry.includes('supersedes="S-20260101-bbbb"'));

    const { entries } = parseSpecEntries(entry);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].sid, 'S-20260704-aaaa');
    assert.strictEqual(entries[0].supersedes, 'S-20260101-bbbb');
    assert.strictEqual(entries[0].status, undefined, 'active status writes no attribute');
  });

  it('writes status only when deprecated, and parses superseded-by', () => {
    const active = formatNewEntry('coding', ['x'], '2026-07-04', 'T', 'B',
      undefined, undefined, undefined, undefined, undefined, undefined, { status: 'active' });
    assert.ok(!active.includes('status='), 'active status is implicit');

    const deprecated = formatNewEntry('coding', ['x'], '2026-07-04', 'T', 'B',
      undefined, undefined, undefined, undefined, undefined, undefined,
      { status: 'deprecated', supersededBy: 'S-20260704-cccc' });
    assert.ok(deprecated.includes('status="deprecated"'));
    assert.ok(deprecated.includes('superseded-by="S-20260704-cccc"'));

    const { entries } = parseSpecEntries(deprecated);
    assert.strictEqual(entries[0].status, 'deprecated');
    assert.strictEqual(entries[0].supersededBy, 'S-20260704-cccc');
  });

  it('ignores an invalid status value', () => {
    const raw = '<spec-entry category="coding" keywords="x" date="2026-07-04" title="T" status="bogus">\n\n### T\n\nB\n\n</spec-entry>';
    const { entries } = parseSpecEntries(raw);
    assert.strictEqual(entries[0].status, undefined);
  });
});
