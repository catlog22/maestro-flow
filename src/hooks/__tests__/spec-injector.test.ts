import './isolate-maestro-home.js'; // 必须第一个 import：先把 MAESTRO_HOME 隔离到临时目录
import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateSpecInjection } from '../spec-injector.js';
import { evaluateContextBudget, truncateMarkdown } from '../context-budget.js';
import { BRIDGE_PREFIX } from '../constants.js';

// ---------------------------------------------------------------------------
// Test project setup — temporary directory with spec files
// ---------------------------------------------------------------------------

const TEST_DIR = join(tmpdir(), `maestro-test-specs-${Date.now()}`);
const SPECS_DIR = join(TEST_DIR, '.workflow', 'specs');

function setupTestSpecs(): void {
  mkdirSync(SPECS_DIR, { recursive: true });
  writeFileSync(join(SPECS_DIR, 'coding-conventions.md'), `---
title: Coding Conventions
category: coding
---

# Coding Conventions

## Naming
- Use camelCase for variables
- Use PascalCase for classes

## Formatting
- 2 spaces indentation
- Max 120 chars per line
`);
  writeFileSync(join(SPECS_DIR, 'architecture-constraints.md'), `---
title: Architecture Constraints
category: arch
---

# Architecture Constraints

## Module Structure
- Layered architecture
- No circular dependencies
`);
  writeFileSync(join(SPECS_DIR, 'quality-rules.md'), `---
title: Quality Rules
category: review
---

# Quality Rules

## Code Quality
- No any types
- No ts-ignore
`);
  writeFileSync(join(SPECS_DIR, 'test-conventions.md'), `---
title: Test Conventions
category: test
---

# Test Conventions

## Framework
- Use node:test
- Use assert module
`);
  writeFileSync(join(SPECS_DIR, 'learnings.md'), `---
title: Learnings
category: learning
---

# Learnings

- Pattern X works well for Y
`);
}

function cleanupTestSpecs(): void {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// evaluateSpecInjection
// ---------------------------------------------------------------------------

describe('evaluateSpecInjection', () => {
  beforeEach(() => setupTestSpecs());
  afterEach(() => cleanupTestSpecs());

  it('injects coding specs for code-developer agent', () => {
    const result = evaluateSpecInjection('code-developer', TEST_DIR);
    assert.strictEqual(result.inject, true);
    assert.ok(result.content?.includes('Coding Conventions'));
    assert.ok(result.categories?.includes('coding'));
  });

  it('injects arch specs for workflow-planner agent', () => {
    const result = evaluateSpecInjection('workflow-planner', TEST_DIR);
    assert.strictEqual(result.inject, true);
    assert.ok(result.content?.includes('Architecture Constraints'));
    assert.ok(result.categories?.includes('arch'));
  });

  it('injects multiple categories for tdd-developer', () => {
    const result = evaluateSpecInjection('tdd-developer', TEST_DIR);
    assert.strictEqual(result.inject, true);
    assert.ok(result.categories?.includes('coding'));
    assert.ok(result.categories?.includes('test'));
    assert.ok(result.content?.includes('Test Conventions'));
    assert.ok(result.content?.includes('Coding Conventions'));
  });

  it('returns inject: false for unknown agent type', () => {
    const result = evaluateSpecInjection('my-custom-agent', TEST_DIR);
    assert.strictEqual(result.inject, false);
  });

  it('returns inject: false when no specs directory exists', () => {
    // 两点确定性保障：
    // 1. 传空 uid：scope 限定 project baseline（否则 loadSpecs 对 global 层 auto-seed）
    // 2. 用每次全新的临时路径：'/nonexistent/path' 会解析到盘符根目录，
    //    logInjectionEvent 写入的 .workflow/spec-analytics.jsonl 会残留在根目录，
    //    下一轮 autoInit 见到 .workflow 已存在就会播种——测试因此奇偶轮交替失败并污染盘符根
    const base = mkdtempSync(join(tmpdir(), 'maestro-no-specs-'));
    try {
      const result = evaluateSpecInjection('code-developer', join(base, 'path'), undefined, undefined, '');
      assert.strictEqual(result.inject, false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('does not include learnings.md when loading coding category', () => {
    // cli-explore-agent 的映射是 ['coding','arch']（不含 learning）：
    // 验证 category 隔离——coding 加载不会带出 learnings.md。
    // （code-developer 映射含 learning，不能用在此断言）
    const result = evaluateSpecInjection('cli-explore-agent', TEST_DIR);
    assert.ok(!result.content?.includes('Pattern X works well'));
  });

  it('respects config mapping override', () => {
    const result = evaluateSpecInjection('my-custom-agent', TEST_DIR, undefined, {
      mapping: { 'my-custom-agent': { categories: ['test'] } },
    });
    assert.strictEqual(result.inject, true);
    assert.ok(result.content?.includes('Test Conventions'));
  });
});

// ---------------------------------------------------------------------------
// evaluateContextBudget
// ---------------------------------------------------------------------------

describe('evaluateContextBudget', () => {
  const SESSION_ID = `test-budget-${Date.now()}`;

  afterEach(() => {
    // Clean up bridge file
    const bridgePath = join(tmpdir(), `${BRIDGE_PREFIX}${SESSION_ID}.json`);
    if (existsSync(bridgePath)) rmSync(bridgePath);
  });

  function writeBridgeMetrics(remaining: number): void {
    const bridgePath = join(tmpdir(), `${BRIDGE_PREFIX}${SESSION_ID}.json`);
    writeFileSync(bridgePath, JSON.stringify({
      session_id: SESSION_ID,
      remaining_percentage: remaining,
      used_pct: 100 - remaining,
      timestamp: Math.floor(Date.now() / 1000),
    }));
  }

  it('returns full when no bridge metrics available', () => {
    const result = evaluateContextBudget('some content');
    assert.strictEqual(result.action, 'full');
    assert.strictEqual(result.content, 'some content');
  });

  it('returns full when remaining > 50%', () => {
    writeBridgeMetrics(60);
    const result = evaluateContextBudget('content here', SESSION_ID);
    assert.strictEqual(result.action, 'full');
  });

  it('returns reduced when remaining 35-50%', () => {
    writeBridgeMetrics(40);
    const longContent = '# Heading\n\nFirst paragraph.\n\nSecond paragraph that is very long.\n'.repeat(100);
    const result = evaluateContextBudget(longContent, SESSION_ID);
    assert.strictEqual(result.action, 'reduced');
    assert.ok(result.content!.length < longContent.length);
  });

  it('returns minimal when remaining 25-35%', () => {
    writeBridgeMetrics(30);
    const result = evaluateContextBudget('# Heading\n\nSome content.', SESSION_ID);
    assert.strictEqual(result.action, 'minimal');
    assert.ok(result.content?.includes('headings only'));
  });

  it('returns skip when remaining < 25%', () => {
    writeBridgeMetrics(20);
    const result = evaluateContextBudget('content', SESSION_ID);
    assert.strictEqual(result.action, 'skip');
    assert.strictEqual(result.content, undefined);
  });

  it('returns skip for empty content', () => {
    const result = evaluateContextBudget('');
    assert.strictEqual(result.action, 'skip');
  });
});

// ---------------------------------------------------------------------------
// truncateMarkdown
// ---------------------------------------------------------------------------

describe('truncateMarkdown', () => {
  it('returns content as-is if under maxChars', () => {
    const short = '# Title\n\nContent.';
    assert.strictEqual(truncateMarkdown(short, 1000), short);
  });

  it('preserves headings and first paragraphs', () => {
    const content = [
      '# Title',
      '',
      'First paragraph under title.',
      '',
      'Second paragraph should be omitted.',
      'Third paragraph should also be omitted.',
      '',
      '## Section 2',
      '',
      'First paragraph under section 2.',
      '',
      'More content here.',
    ].join('\n');

    const result = truncateMarkdown(content, 150);
    assert.ok(result.includes('# Title'));
    assert.ok(result.includes('## Section 2'));
    // Truncated content should be shorter than original
    assert.ok(result.length < content.length);
  });

  it('handles content with no headings', () => {
    const content = 'Line 1\nLine 2\nLine 3\n'.repeat(100);
    const result = truncateMarkdown(content, 50);
    assert.ok(result.length <= content.length);
  });
});
