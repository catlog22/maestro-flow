import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DefaultExprEvaluator, ExprSyntaxError } from '../expr-evaluator.js';
import type { WalkerContext, DecisionEdge } from '../graph-types.js';

function makeCtx(overrides: Partial<WalkerContext> = {}): WalkerContext {
  return {
    inputs: { phase: 'execute', retries: 3 },
    project: {
      initialized: true,
      current_phase: 2,
      phase_status: 'active',
      artifacts: { plan: true, spec: false },
      execution: { tasks_completed: 5, tasks_total: 10 },
      verification_status: 'pending',
      review_verdict: 'PASS',
      uat_status: 'not_started',
      phases_total: 4,
      phases_completed: 1,
      accumulated_context: null,
    },
    result: { status: 'passed', score: 85, issues: 0 },
    analysis: { quality_score: 90 },
    visits: { verify: 2, plan: 1 },
    var: { threshold: 80, label: 'review' },
    ...overrides,
  };
}

const evaluator = new DefaultExprEvaluator();

// ---------------------------------------------------------------------------
// 1. Path Resolution
// ---------------------------------------------------------------------------

describe('resolve — path access', () => {
  const ctx = makeCtx();

  it('resolves ctx.result.status', () => {
    assert.strictEqual(evaluator.resolve('ctx.result.status', ctx), 'passed');
  });

  it('resolves ctx.visits.verify', () => {
    assert.strictEqual(evaluator.resolve('ctx.visits.verify', ctx), 2);
  });

  it('resolves ctx.visits.unknown defaults to 0', () => {
    assert.strictEqual(evaluator.resolve('ctx.visits.unknown_node', ctx), 0);
  });

  it('resolves ctx.inputs.phase', () => {
    assert.strictEqual(evaluator.resolve('ctx.inputs.phase', ctx), 'execute');
  });

  it('resolves ctx.var.threshold', () => {
    assert.strictEqual(evaluator.resolve('ctx.var.threshold', ctx), 80);
  });

  it('resolves ctx.project.phase_status', () => {
    assert.strictEqual(evaluator.resolve('ctx.project.phase_status', ctx), 'active');
  });

  it('resolves ctx.project.artifacts.plan', () => {
    assert.strictEqual(evaluator.resolve('ctx.project.artifacts.plan', ctx), true);
  });

  it('resolves ctx.project.execution.tasks_completed', () => {
    assert.strictEqual(evaluator.resolve('ctx.project.execution.tasks_completed', ctx), 5);
  });

  it('returns undefined for non-existent nested path', () => {
    assert.strictEqual(evaluator.resolve('ctx.result.nonexistent.deep', ctx), undefined);
  });

  it('resolves without ctx prefix (result.status)', () => {
    assert.strictEqual(evaluator.resolve('result.status', ctx), 'passed');
  });

  it('returns undefined for unknown root', () => {
    assert.strictEqual(evaluator.resolve('unknown.path', ctx), undefined);
  });
});

// ---------------------------------------------------------------------------
// 2. Literal Evaluation
// ---------------------------------------------------------------------------

describe('resolve — literals', () => {
  const ctx = makeCtx();

  it('resolves string literal', () => {
    assert.strictEqual(evaluator.resolve('"hello"', ctx), 'hello');
  });

  it('resolves single-quoted string', () => {
    assert.strictEqual(evaluator.resolve("'world'", ctx), 'world');
  });

  it('resolves number', () => {
    assert.strictEqual(evaluator.resolve('42', ctx), 42);
  });

  it('resolves boolean true', () => {
    assert.strictEqual(evaluator.resolve('true', ctx), true);
  });

  it('resolves boolean false', () => {
    assert.strictEqual(evaluator.resolve('false', ctx), false);
  });

  it('resolves null', () => {
    assert.strictEqual(evaluator.resolve('null', ctx), null);
  });
});

// ---------------------------------------------------------------------------
// 3. Comparisons
// ---------------------------------------------------------------------------

describe('evaluate — comparisons', () => {
  const ctx = makeCtx();

  it('== with matching string', () => {
    assert.strictEqual(evaluator.evaluate('ctx.result.status == "passed"', ctx), true);
  });

  it('== with non-matching string', () => {
    assert.strictEqual(evaluator.evaluate('ctx.result.status == "failed"', ctx), false);
  });

  it('!= operator', () => {
    assert.strictEqual(evaluator.evaluate('ctx.result.status != "failed"', ctx), true);
  });

  it('>= with numbers', () => {
    assert.strictEqual(evaluator.evaluate('ctx.result.score >= 80', ctx), true);
  });

  it('> with numbers', () => {
    assert.strictEqual(evaluator.evaluate('ctx.result.score > 90', ctx), false);
  });

  it('<= with numbers', () => {
    assert.strictEqual(evaluator.evaluate('ctx.result.score <= 85', ctx), true);
  });

  it('< with numbers', () => {
    assert.strictEqual(evaluator.evaluate('ctx.result.score < 85', ctx), false);
  });

  it('== with loose coercion (string "3" == number 3)', () => {
    const ctx2 = makeCtx({ var: { val: '3' } });
    assert.strictEqual(evaluator.evaluate('ctx.var.val == 3', ctx2), true);
  });

  it('== with number to number', () => {
    assert.strictEqual(evaluator.evaluate('ctx.result.issues == 0', ctx), true);
  });
});

// ---------------------------------------------------------------------------
// 4. Logical Operators
// ---------------------------------------------------------------------------

describe('evaluate — logical operators', () => {
  const ctx = makeCtx();

  it('&& both true', () => {
    assert.strictEqual(
      evaluator.evaluate('ctx.result.score >= 80 && ctx.result.issues == 0', ctx),
      true,
    );
  });

  it('&& one false', () => {
    assert.strictEqual(
      evaluator.evaluate('ctx.result.score >= 90 && ctx.result.issues == 0', ctx),
      false,
    );
  });

  it('|| one true', () => {
    assert.strictEqual(
      evaluator.evaluate('ctx.result.score >= 90 || ctx.result.issues == 0', ctx),
      true,
    );
  });

  it('! negation', () => {
    assert.strictEqual(evaluator.evaluate('!false', ctx), true);
    assert.strictEqual(evaluator.evaluate('!true', ctx), false);
  });

  it('! on path expression', () => {
    assert.strictEqual(evaluator.evaluate('!ctx.project.artifacts.spec', ctx), true);
  });

  it('parenthesized grouping', () => {
    // (false && true) || true => true
    assert.strictEqual(
      evaluator.evaluate('(ctx.result.score > 90 && ctx.result.issues == 0) || ctx.visits.verify >= 1', ctx),
      true,
    );
  });

  it('nested parentheses', () => {
    assert.strictEqual(
      evaluator.evaluate('(ctx.result.status == "passed") && (ctx.visits.verify > 0)', ctx),
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Edge Matching
// ---------------------------------------------------------------------------

describe('match — DecisionEdge', () => {
  const ctx = makeCtx();

  it('value exact match (string)', () => {
    const edge: DecisionEdge = { value: 'passed', target: 'next' };
    assert.strictEqual(evaluator.match(edge, 'passed', ctx), true);
    assert.strictEqual(evaluator.match(edge, 'failed', ctx), false);
  });

  it('value match with loose coercion', () => {
    const edge: DecisionEdge = { value: 3, target: 'next' };
    assert.strictEqual(evaluator.match(edge, '3', ctx), true);
  });

  it('match expression', () => {
    const edge: DecisionEdge = { match: 'ctx.result.score >= 80', target: 'next' };
    assert.strictEqual(evaluator.match(edge, 'passed', ctx), true);
  });

  it('match expression false', () => {
    const edge: DecisionEdge = { match: 'ctx.result.score >= 90', target: 'next' };
    assert.strictEqual(evaluator.match(edge, 'passed', ctx), false);
  });

  it('label match (case-insensitive)', () => {
    const edge: DecisionEdge = { label: 'PASSED', target: 'next' };
    assert.strictEqual(evaluator.match(edge, 'passed', ctx), true);
  });

  it('default edge', () => {
    const edge: DecisionEdge = { default: true, target: 'fallback' };
    assert.strictEqual(evaluator.match(edge, 'anything', ctx), true);
  });

  it('priority: value > match > label > default', () => {
    // value takes precedence even if match would fail
    const edge: DecisionEdge = {
      value: 'passed',
      match: 'ctx.result.score >= 999',
      label: 'nope',
      default: true,
      target: 'next',
    };
    assert.strictEqual(evaluator.match(edge, 'passed', ctx), true);
    assert.strictEqual(evaluator.match(edge, 'failed', ctx), false);
  });

  it('no value, uses match', () => {
    const edge: DecisionEdge = {
      match: 'ctx.result.issues == 0',
      label: 'nope',
      default: true,
      target: 'next',
    };
    assert.strictEqual(evaluator.match(edge, 'irrelevant', ctx), true);
  });

  it('no value, no match, uses label', () => {
    const edge: DecisionEdge = { label: 'passed', default: true, target: 'next' };
    assert.strictEqual(evaluator.match(edge, 'passed', ctx), true);
    assert.strictEqual(evaluator.match(edge, 'failed', ctx), false);
  });
});

// ---------------------------------------------------------------------------
// 6. Error Handling
// ---------------------------------------------------------------------------

describe('error handling', () => {
  const ctx = makeCtx();

  it('throws ExprSyntaxError for invalid syntax', () => {
    assert.throws(() => evaluator.evaluate('==', ctx), ExprSyntaxError);
  });

  it('throws ExprSyntaxError for unterminated string', () => {
    assert.throws(() => evaluator.evaluate('"hello', ctx), ExprSyntaxError);
  });

  it('throws ExprSyntaxError for unexpected character', () => {
    assert.throws(() => evaluator.evaluate('a @ b', ctx), ExprSyntaxError);
  });

  it('throws ExprSyntaxError for trailing tokens', () => {
    assert.throws(() => evaluator.evaluate('true false', ctx), ExprSyntaxError);
  });

  it('missing path returns undefined, does not throw', () => {
    assert.strictEqual(evaluator.resolve('ctx.result.nonexistent', ctx), undefined);
  });

  it('visits default to 0 for missing node', () => {
    assert.strictEqual(evaluator.resolve('ctx.visits.never_visited', ctx), 0);
  });
});
