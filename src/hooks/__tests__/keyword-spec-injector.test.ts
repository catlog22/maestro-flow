/**
 * Keyword Spec Injector — comprehensive tests
 *
 * Covers: evaluateKeywordInjection (prompt tokenization, keyword matching, injection, dedup)
 * Guide coverage: Keyword 注入 — UserPromptSubmit 时从 prompt 提取关键词匹配 spec entries
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { evaluateKeywordInjection } from '../keyword-spec-injector.js';
import { SPEC_KW_BRIDGE_PREFIX } from '../constants.js';

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

let testDir: string;
let sessionCounter = 0;
const SESSION_BASE = `test-kw-inject-${Date.now()}`;

function newSessionId(): string {
  return `${SESSION_BASE}-${sessionCounter++}`;
}

function bridgePath(sessionId: string): string {
  return join(tmpdir(), `${SPEC_KW_BRIDGE_PREFIX}${sessionId}.json`);
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'maestro-test-kw-injector-'));
  mkdirSync(join(testDir, '.workflow', 'specs'), { recursive: true });
});

afterEach(() => {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

function writeSpecFile(filename: string, content: string): void {
  writeFileSync(join(testDir, '.workflow', 'specs', filename), content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Basic keyword matching
// ---------------------------------------------------------------------------

describe('evaluateKeywordInjection — basic matching', () => {
  it('injects when prompt contains matching keyword', () => {
    writeSpecFile('coding-conventions.md', `
<spec-entry category="coding" keywords="auth,token" date="2026-04-21">

### Token Rotation

Always rotate refresh tokens.

</spec-entry>
`);

    const sid = newSessionId();
    try {
      const result = evaluateKeywordInjection('implement auth token rotation', testDir, sid);
      expect(result.inject).toBe(true);
      expect(result.content).toContain('Token Rotation');
      expect(result.matchedKeywords).toContain('auth');
      expect(result.matchedEntries).toBeGreaterThan(0);
    } finally {
      const path = bridgePath(sid);
      if (existsSync(path)) rmSync(path);
    }
  });

  it('does not inject when no keywords match', () => {
    writeSpecFile('coding-conventions.md', `
<spec-entry category="coding" keywords="auth,token" date="2026-04-21">

### Token Rotation

Content.

</spec-entry>
`);

    const sid = newSessionId();
    const result = evaluateKeywordInjection('fix the database connection', testDir, sid);
    expect(result.inject).toBe(false);
  });

  it('does not inject for empty prompt', () => {
    writeSpecFile('coding-conventions.md', `
<spec-entry category="coding" keywords="auth" date="2026-04-21">

### Entry

Content.

</spec-entry>
`);

    const sid = newSessionId();
    const result = evaluateKeywordInjection('', testDir, sid);
    expect(result.inject).toBe(false);
  });

  it('does not inject when no specs exist', () => {
    // No spec files written
    const sid = newSessionId();
    const result = evaluateKeywordInjection('implement auth', testDir, sid);
    expect(result.inject).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Prompt tokenization
// ---------------------------------------------------------------------------

describe('evaluateKeywordInjection — tokenization', () => {
  it('filters out stop words from prompt', () => {
    writeSpecFile('coding-conventions.md', `
<spec-entry category="coding" keywords="the,and,for" date="2026-04-21">

### Stop words entry

Should not match common words.

</spec-entry>
`);

    const sid = newSessionId();
    // 'the', 'and', 'for' are stop words and should not trigger matching
    const result = evaluateKeywordInjection('the code and the function for this', testDir, sid);
    expect(result.inject).toBe(false);
  });

  it('filters keywords shorter than MIN_KEYWORD_LENGTH (3)', () => {
    writeSpecFile('coding-conventions.md', `
<spec-entry category="coding" keywords="ab,xy" date="2026-04-21">

### Short keywords

Content.

</spec-entry>
`);

    const sid = newSessionId();
    const result = evaluateKeywordInjection('ab xy test', testDir, sid);
    // 'ab' and 'xy' are < 3 chars, should not match
    expect(result.inject).toBe(false);
  });

  it('lowercases prompt words for matching', () => {
    writeSpecFile('coding-conventions.md', `
<spec-entry category="coding" keywords="auth" date="2026-04-21">

### Auth pattern

Content.

</spec-entry>
`);

    const sid = newSessionId();
    try {
      const result = evaluateKeywordInjection('Fix the AUTH module', testDir, sid);
      expect(result.inject).toBe(true);
    } finally {
      const path = bridgePath(sid);
      if (existsSync(path)) rmSync(path);
    }
  });
});

// ---------------------------------------------------------------------------
// Session dedup
// ---------------------------------------------------------------------------

describe('evaluateKeywordInjection — session dedup', () => {
  it('does not re-inject the same entry in the same session', () => {
    writeSpecFile('coding-conventions.md', `
<spec-entry category="coding" keywords="auth" date="2026-04-21">

### Auth Pattern

Content.

</spec-entry>
`);

    const sid = newSessionId();
    try {
      // First injection
      const first = evaluateKeywordInjection('implement auth', testDir, sid);
      expect(first.inject).toBe(true);

      // Second injection with same keyword — should be deduped
      const second = evaluateKeywordInjection('check auth again', testDir, sid);
      expect(second.inject).toBe(false);
    } finally {
      const path = bridgePath(sid);
      if (existsSync(path)) rmSync(path);
    }
  });

  it('injects new entries even if some are deduped', () => {
    writeSpecFile('coding-conventions.md', `
<spec-entry category="coding" keywords="auth" date="2026-04-21">

### Auth Pattern

Content A.

</spec-entry>

<spec-entry category="coding" keywords="cache" date="2026-04-22">

### Cache Pattern

Content B.

</spec-entry>
`);

    const sid = newSessionId();
    try {
      // First injection — matches 'auth'
      const first = evaluateKeywordInjection('fix auth module', testDir, sid);
      expect(first.inject).toBe(true);

      // Second injection — 'auth' deduped, but 'cache' is new
      const second = evaluateKeywordInjection('check auth and cache', testDir, sid);
      expect(second.inject).toBe(true);
      expect(second.content).toContain('Cache Pattern');
    } finally {
      const path = bridgePath(sid);
      if (existsSync(path)) rmSync(path);
    }
  });
});

// ---------------------------------------------------------------------------
// Max entries limit
// ---------------------------------------------------------------------------

describe('evaluateKeywordInjection — max entries', () => {
  it('limits injection to MAX_ENTRIES_PER_INJECTION (5)', () => {
    // Create 8 entries that all match keyword "api"
    const entries = Array.from({ length: 8 }, (_, i) => `
<spec-entry category="coding" keywords="api" date="2026-04-${String(i + 10).padStart(2, '0')}">

### API Pattern ${i + 1}

Content ${i + 1}.

</spec-entry>`).join('\n');

    writeSpecFile('coding-conventions.md', `# Coding\n${entries}`);

    const sid = newSessionId();
    try {
      const result = evaluateKeywordInjection('implement api endpoint', testDir, sid);
      expect(result.inject).toBe(true);
      expect(result.matchedEntries).toBeLessThanOrEqual(5);
    } finally {
      const path = bridgePath(sid);
      if (existsSync(path)) rmSync(path);
    }
  });
});

// ---------------------------------------------------------------------------
// Output format
// ---------------------------------------------------------------------------

describe('evaluateKeywordInjection — output format', () => {
  it('wraps content in maestro-context with a keyword section', () => {
    writeSpecFile('coding-conventions.md', `
<spec-entry category="coding" keywords="auth" date="2026-04-21">

### Auth Guard

Implement auth guards.

</spec-entry>
`);

    const sid = newSessionId();
    try {
      const result = evaluateKeywordInjection('implement auth guard', testDir, sid);
      expect(result.inject).toBe(true);
      expect(result.content).toContain('<maestro-context');
      expect(result.content).toContain('</maestro-context>');
      expect(result.content).toMatch(/budget="\d+\/\d+"/);
      expect(result.content).toContain('## keyword[');
      expect(result.content).toContain('auth');
    } finally {
      const path = bridgePath(sid);
      if (existsSync(path)) rmSync(path);
    }
  });
});
