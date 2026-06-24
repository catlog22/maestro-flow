/**
 * Spec Loader Ref Entry Formatting — comprehensive tests
 *
 * Covers: ref entry display format in loadSpecs (lightweight summary + load command)
 * Guide coverage: spec load 加载样式对比 — 内联 vs ref 引用条目的不同展示
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadSpecs } from '../spec-loader.js';

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

let testDir: string;
const GLOBAL_DIR_SUFFIX = '-global';
let globalDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'maestro-test-loader-ref-'));
  globalDir = mkdtempSync(join(tmpdir(), 'maestro-test-global-ref-'));
  mkdirSync(join(testDir, '.workflow', 'specs'), { recursive: true });
  // Pre-create global dir to prevent auto-init
  mkdirSync(globalDir, { recursive: true });
});

afterEach(() => {
  if (testDir && existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  if (globalDir && existsSync(globalDir)) rmSync(globalDir, { recursive: true, force: true });
});

function writeSpec(filename: string, content: string): void {
  writeFileSync(join(testDir, '.workflow', 'specs', filename), content, 'utf-8');
}

const TEST_OPTS = { get globalDir() { return globalDir; } };

// ---------------------------------------------------------------------------
// Inline vs Ref entry display
// ---------------------------------------------------------------------------

describe('loadSpecs — inline entry display', () => {
  it('shows full content for inline entries', () => {
    writeSpec('learnings.md', `# Learnings

<spec-entry category="learning" keywords="auth,jwt" date="2026-04-21">

### JWT Token Rotation

Always rotate refresh tokens on use. Revoked column must be set rather than deleting tokens. Refresh token generation must carry email from stored user data.

</spec-entry>
`);

    const result = loadSpecs(testDir, 'learning', undefined, undefined, undefined, TEST_OPTS);
    expect(result.content).toContain('JWT Token Rotation');
    expect(result.content).toContain('Always rotate refresh tokens');
    expect(result.content).toContain('Revoked column must be set');
    // Should NOT have "→ Detail:" for inline entries
    expect(result.content).not.toContain('→ Detail:');
  });
});

describe('loadSpecs — ref entry display', () => {
  it('shows summary + load command for ref entries', () => {
    writeSpec('learnings.md', `# Learnings

<spec-entry category="learning" keywords="oauth,pkce" date="2026-05-10" ref="knowhow/AST-oauth-flow.md">

### OAuth 2.0 PKCE Integration

Complete OAuth PKCE flow design with authorization code exchange.

</spec-entry>
`);

    const result = loadSpecs(testDir, 'learning', undefined, undefined, undefined, TEST_OPTS);
    expect(result.content).toContain('OAuth 2.0 PKCE Integration');
    // Should show the load command hint
    expect(result.content).toContain('→ Detail: maestro load --type knowhow --id');
    // The ref ID should be derived from the ref path
    expect(result.content).toContain('knowhow-oauth-flow');
  });

  it('strips knowhow/ prefix and .md suffix from ref for ID generation', () => {
    writeSpec('coding-conventions.md', `# Coding

<spec-entry category="coding" keywords="api" date="2026-05-10" ref="knowhow/DOC-api-design-standard.md">

### API Design Standard

REST API conventions for the project.

</spec-entry>
`);

    const result = loadSpecs(testDir, 'coding', undefined, undefined, undefined, TEST_OPTS);
    // DOC- prefix should be stripped, resulting in "api-design-standard"
    expect(result.content).toContain('knowhow-api-design-standard');
  });

  it('handles various knowhow prefixes in ref path', () => {
    const prefixes = ['KNW', 'TIP', 'TPL', 'RCP', 'REF', 'DCS', 'AST', 'BLP', 'DOC'];
    for (const prefix of prefixes) {
      // Fresh dir for each prefix test
      const freshDir = mkdtempSync(join(tmpdir(), `maestro-ref-prefix-${prefix}-`));
      const freshGlobal = mkdtempSync(join(tmpdir(), `maestro-ref-global-${prefix}-`));
      mkdirSync(join(freshDir, '.workflow', 'specs'), { recursive: true });
      mkdirSync(freshGlobal, { recursive: true });

      writeFileSync(join(freshDir, '.workflow', 'specs', 'learnings.md'), `# Learnings

<spec-entry category="learning" keywords="test" date="2026-05-10" ref="knowhow/${prefix}-my-doc.md">

### ${prefix} Document

Summary for ${prefix}.

</spec-entry>
`, 'utf-8');

      const result = loadSpecs(freshDir, 'learning', undefined, undefined, undefined, { globalDir: freshGlobal });
      expect(result.content).toContain('knowhow-my-doc');
      expect(result.content).not.toContain(`knowhow-${prefix.toLowerCase()}-`);

      rmSync(freshDir, { recursive: true, force: true });
      rmSync(freshGlobal, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Mixed inline + ref entries
// ---------------------------------------------------------------------------

describe('loadSpecs — mixed inline and ref entries', () => {
  it('displays both inline and ref entries correctly', () => {
    writeSpec('learnings.md', `# Learnings

<spec-entry category="learning" keywords="auth,jwt" date="2026-04-21">

### JWT Token Rotation

Always rotate refresh tokens on use.

</spec-entry>

<spec-entry category="learning" keywords="oauth,pkce" date="2026-05-10" ref="knowhow/AST-oauth-flow.md">

### OAuth 2.0 Integration

Complete OAuth PKCE flow. See referenced document.

</spec-entry>
`);

    const result = loadSpecs(testDir, 'learning', undefined, undefined, undefined, TEST_OPTS);
    // Inline entry — full content shown
    expect(result.content).toContain('JWT Token Rotation');
    expect(result.content).toContain('Always rotate refresh tokens');

    // Ref entry — summary + load hint
    expect(result.content).toContain('OAuth 2.0 Integration');
    expect(result.content).toContain('→ Detail: maestro load --type knowhow --id');
  });
});

// ---------------------------------------------------------------------------
// Keyword filtering with ref entries
// ---------------------------------------------------------------------------

describe('loadSpecs — keyword filtering with ref entries', () => {
  it('filters ref entries by keyword', () => {
    writeSpec('learnings.md', `# Learnings

<spec-entry category="learning" keywords="auth,jwt" date="2026-04-21">

### JWT Pattern

Content A.

</spec-entry>

<spec-entry category="learning" keywords="oauth,pkce" date="2026-05-10" ref="knowhow/AST-oauth-flow.md">

### OAuth Pattern

Content B.

</spec-entry>

<spec-entry category="learning" keywords="cache" date="2026-05-10" ref="knowhow/REF-cache.md">

### Cache Pattern

Content C.

</spec-entry>
`);

    // Filter by 'oauth' — should match only the ref entry
    const result = loadSpecs(testDir, 'learning', undefined, 'oauth', undefined, TEST_OPTS);
    expect(result.content).toContain('OAuth Pattern');
    expect(result.content).not.toContain('JWT Pattern');
    expect(result.content).not.toContain('Cache Pattern');
  });

  it('returns both inline and ref entries for shared keyword', () => {
    writeSpec('coding-conventions.md', `# Coding

<spec-entry category="coding" keywords="auth,validation" date="2026-04-21">

### Auth Validation Inline

Inline content.

</spec-entry>

<spec-entry category="coding" keywords="auth,architecture" date="2026-05-10" ref="knowhow/BLP-auth-arch.md">

### Auth Architecture Ref

Ref content.

</spec-entry>
`);

    const result = loadSpecs(testDir, 'coding', undefined, 'auth', undefined, TEST_OPTS);
    expect(result.content).toContain('Auth Validation Inline');
    expect(result.content).toContain('Auth Architecture Ref');
  });
});

// ---------------------------------------------------------------------------
// formatNewEntry with ref attribute
// ---------------------------------------------------------------------------

describe('formatNewEntry — ref attribute', () => {
  it('includes ref attribute in generated entry', async () => {
    const { formatNewEntry } = await import('../spec-entry-parser.js');
    const entry = formatNewEntry('learning', ['oauth', 'pkce'], '2026-05-10', 'OAuth Flow', 'Summary.', undefined, 'knowhow/AST-oauth-flow.md');
    expect(entry).toContain('ref="knowhow/AST-oauth-flow.md"');
    expect(entry).toContain('category="learning"');
    expect(entry).not.toContain('roles=');
    expect(entry).toContain('### OAuth Flow');
  });

  it('omits ref when not provided', async () => {
    const { formatNewEntry } = await import('../spec-entry-parser.js');
    const entry = formatNewEntry('coding', ['test'], '2026-05-10', 'Title', 'Body');
    expect(entry).not.toContain('ref=');
  });
});

// ---------------------------------------------------------------------------
// parseSpecEntries with ref attribute
// ---------------------------------------------------------------------------

describe('parseSpecEntries — ref attribute', () => {
  it('extracts ref attribute from spec-entry tag', async () => {
    const { parseSpecEntries } = await import('../spec-entry-parser.js');
    const content = `
<spec-entry category="learning" keywords="oauth" date="2026-05-10" ref="knowhow/AST-oauth-flow.md">

### OAuth Flow

Summary.

</spec-entry>
`;
    const result = parseSpecEntries(content);
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].ref).toBe('knowhow/AST-oauth-flow.md');
  });

  it('sets ref to undefined when not present', async () => {
    const { parseSpecEntries } = await import('../spec-entry-parser.js');
    const content = `
<spec-entry category="coding" keywords="test" date="2026-05-10">

### No Ref

Content.

</spec-entry>
`;
    const result = parseSpecEntries(content);
    expect(result.entries[0].ref).toBeUndefined();
  });
});
