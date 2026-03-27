import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DefaultOutputParser } from '../output-parser.js';
import type { CommandNode } from '../graph-types.js';

function makeNode(extract?: CommandNode['extract']): CommandNode {
  return { type: 'command', cmd: 'test', next: 'done', extract };
}

const parser = new DefaultOutputParser();

describe('DefaultOutputParser', () => {
  it('parses full 7-field RESULT block', () => {
    const raw = `Some output text here.

--- COORDINATE RESULT ---
STATUS: SUCCESS
PHASE: 2
VERIFICATION_STATUS: passed
REVIEW_VERDICT: PASS
UAT_STATUS: pending
ARTIFACTS: plan.json, state.json, context.md
SUMMARY: All tasks completed successfully
`;
    const result = parser.parse(raw, makeNode());

    assert.strictEqual(result.structured.status, 'SUCCESS');
    assert.strictEqual(result.structured.phase, '2');
    assert.strictEqual(result.structured.verification_status, 'passed');
    assert.strictEqual(result.structured.review_verdict, 'PASS');
    assert.strictEqual(result.structured.uat_status, 'pending');
    assert.deepStrictEqual(result.structured.artifacts, ['plan.json', 'state.json', 'context.md']);
    assert.strictEqual(result.structured.summary, 'All tasks completed successfully');
  });

  it('parses partial block with only STATUS and SUMMARY', () => {
    const raw = `--- COORDINATE RESULT ---
STATUS: SUCCESS
SUMMARY: Partial result
`;
    const result = parser.parse(raw, makeNode());

    assert.strictEqual(result.structured.status, 'SUCCESS');
    assert.strictEqual(result.structured.phase, null);
    assert.strictEqual(result.structured.verification_status, null);
    assert.strictEqual(result.structured.review_verdict, null);
    assert.strictEqual(result.structured.uat_status, null);
    assert.deepStrictEqual(result.structured.artifacts, []);
    assert.strictEqual(result.structured.summary, 'Partial result');
  });

  it('returns failure when no RESULT block found', () => {
    const raw = 'Just some random output without any markers.';
    const result = parser.parse(raw, makeNode());

    assert.strictEqual(result.structured.status, 'FAILURE');
    assert.strictEqual(result.structured.summary, 'No COORDINATE RESULT block found');
  });

  it('returns failure for empty output', () => {
    const result = parser.parse('', makeNode());
    assert.strictEqual(result.structured.status, 'FAILURE');
    assert.strictEqual(result.structured.summary, 'Empty output');
  });

  it('parses ARTIFACTS "none" as empty array', () => {
    const raw = `--- COORDINATE RESULT ---
STATUS: SUCCESS
ARTIFACTS: none
SUMMARY: No artifacts
`;
    const result = parser.parse(raw, makeNode());
    assert.deepStrictEqual(result.structured.artifacts, []);
  });

  it('parses comma-separated ARTIFACTS into array', () => {
    const raw = `--- COORDINATE RESULT ---
STATUS: SUCCESS
ARTIFACTS: a.txt, b.json , c.md
SUMMARY: Has artifacts
`;
    const result = parser.parse(raw, makeNode());
    assert.deepStrictEqual(result.structured.artifacts, ['a.txt', 'b.json', 'c.md']);
  });

  it('applies regex extract rule', () => {
    const raw = `Error count: 42 found in scan.
--- COORDINATE RESULT ---
STATUS: FAILURE
SUMMARY: Scan failed
`;
    const node = makeNode({
      error_count: {
        strategy: 'regex',
        pattern: 'Error count: (\\d+)',
        target: 'error_count',
      },
    });
    const result = parser.parse(raw, node);

    assert.strictEqual(result.structured.error_count, '42');
    assert.strictEqual(result.structured.status, 'FAILURE');
  });

  it('applies line_match extract rule', () => {
    const raw = `VERDICT: APPROVED with conditions
--- COORDINATE RESULT ---
STATUS: SUCCESS
SUMMARY: Review done
`;
    const node = makeNode({
      verdict: {
        strategy: 'line_match',
        pattern: 'VERDICT:',
        target: 'review_line',
      },
    });
    const result = parser.parse(raw, node);
    assert.strictEqual(result.structured.review_line, 'APPROVED with conditions');
  });

  it('uses last RESULT block when multiple exist', () => {
    const raw = `--- COORDINATE RESULT ---
STATUS: FAILURE
SUMMARY: First attempt failed

Some retry output...

--- COORDINATE RESULT ---
STATUS: SUCCESS
PHASE: 3
SUMMARY: Second attempt succeeded
`;
    const result = parser.parse(raw, makeNode());

    assert.strictEqual(result.structured.status, 'SUCCESS');
    assert.strictEqual(result.structured.phase, '3');
    assert.strictEqual(result.structured.summary, 'Second attempt succeeded');
  });

  it('handles case-insensitive field names', () => {
    const raw = `--- COORDINATE RESULT ---
status: SUCCESS
Phase: 1
verification_Status: passed
Review_Verdict: WARN
Uat_Status: failed
artifacts: report.md
Summary: Mixed case test
`;
    const result = parser.parse(raw, makeNode());

    assert.strictEqual(result.structured.status, 'SUCCESS');
    assert.strictEqual(result.structured.phase, '1');
    assert.strictEqual(result.structured.verification_status, 'passed');
    assert.strictEqual(result.structured.review_verdict, 'WARN');
    assert.strictEqual(result.structured.uat_status, 'failed');
    assert.deepStrictEqual(result.structured.artifacts, ['report.md']);
    assert.strictEqual(result.structured.summary, 'Mixed case test');
  });

  it('applies extract rules even without RESULT block', () => {
    const raw = 'SCORE: 85 out of 100';
    const node = makeNode({
      score: {
        strategy: 'regex',
        pattern: 'SCORE: (\\d+)',
        target: 'quality_score',
      },
    });
    const result = parser.parse(raw, node);

    assert.strictEqual(result.structured.status, 'FAILURE');
    assert.strictEqual(result.structured.quality_score, '85');
  });

  it('defaults STATUS to FAILURE when missing', () => {
    const raw = `--- COORDINATE RESULT ---
SUMMARY: No status field present
`;
    const result = parser.parse(raw, makeNode());
    assert.strictEqual(result.structured.status, 'FAILURE');
    assert.strictEqual(result.structured.summary, 'No status field present');
  });

  it('treats PHASE "none" as null', () => {
    const raw = `--- COORDINATE RESULT ---
STATUS: SUCCESS
PHASE: none
SUMMARY: Phase is none
`;
    const result = parser.parse(raw, makeNode());
    assert.strictEqual(result.structured.phase, null);
  });
});
