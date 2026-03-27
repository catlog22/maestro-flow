// ---------------------------------------------------------------------------
// Graph Coordinator — Output Parser
// Extracts structured data from agent raw output text.
// ---------------------------------------------------------------------------

import type { CommandNode, ExtractionRule, OutputParser, ParsedResult } from './graph-types.js';

const RESULT_MARKER = '--- COORDINATE RESULT ---';

const FIELD_PATTERNS: Record<string, RegExp> = {
  status: /^STATUS:\s*(.+)/i,
  phase: /^PHASE:\s*(.+)/i,
  verification_status: /^VERIFICATION_STATUS:\s*(.+)/i,
  review_verdict: /^REVIEW_VERDICT:\s*(.+)/i,
  uat_status: /^UAT_STATUS:\s*(.+)/i,
  artifacts: /^ARTIFACTS:\s*(.+)/i,
  summary: /^SUMMARY:\s*(.+)/i,
};

function makeFailureResult(summary: string): ParsedResult {
  return {
    structured: {
      status: 'FAILURE',
      phase: null,
      verification_status: null,
      review_verdict: null,
      uat_status: null,
      artifacts: [],
      summary,
    },
  };
}

function parseResultBlock(block: string): ParsedResult['structured'] {
  const lines = block.split('\n');
  const raw: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    for (const [field, pattern] of Object.entries(FIELD_PATTERNS)) {
      const m = trimmed.match(pattern);
      if (m) {
        raw[field] = m[1].trim();
      }
    }
  }

  const status = raw.status?.toUpperCase() === 'SUCCESS' ? 'SUCCESS' as const : 'FAILURE' as const;

  const phaseRaw = raw.phase;
  const phase = phaseRaw && phaseRaw.toLowerCase() !== 'none' ? phaseRaw : null;

  const verificationStatus = raw.verification_status || null;
  const reviewVerdict = raw.review_verdict || null;
  const uatStatus = raw.uat_status || null;

  const artifactsRaw = raw.artifacts;
  let artifacts: string[] = [];
  if (artifactsRaw && artifactsRaw.toLowerCase() !== 'none') {
    artifacts = artifactsRaw.split(',').map(s => s.trim()).filter(Boolean);
  }

  const summary = raw.summary || '';

  return {
    status,
    phase,
    verification_status: verificationStatus,
    review_verdict: reviewVerdict,
    uat_status: uatStatus,
    artifacts,
    summary,
  };
}

function applyExtractRules(
  rawOutput: string,
  extract: Record<string, ExtractionRule>,
  structured: ParsedResult['structured'],
): void {
  for (const rule of Object.values(extract)) {
    switch (rule.strategy) {
      case 'regex': {
        const m = rawOutput.match(new RegExp(rule.pattern));
        if (m && m[1] !== undefined) {
          structured[rule.target] = m[1];
        }
        break;
      }
      case 'line_match': {
        for (const line of rawOutput.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith(rule.pattern)) {
            structured[rule.target] = trimmed.slice(rule.pattern.length).trim();
            break;
          }
        }
        break;
      }
      case 'json_path':
        // Reserved for future implementation
        break;
    }
  }
}

export class DefaultOutputParser implements OutputParser {
  parse(rawOutput: string, node: CommandNode): ParsedResult {
    if (!rawOutput || rawOutput.trim() === '') {
      return makeFailureResult('Empty output');
    }

    // Find the LAST COORDINATE RESULT block
    const lastIdx = rawOutput.lastIndexOf(RESULT_MARKER);
    if (lastIdx === -1) {
      const result = makeFailureResult('No COORDINATE RESULT block found');
      if (node.extract) {
        applyExtractRules(rawOutput, node.extract, result.structured);
      }
      return result;
    }

    const blockText = rawOutput.slice(lastIdx + RESULT_MARKER.length);
    const structured = parseResultBlock(blockText);

    if (node.extract) {
      applyExtractRules(rawOutput, node.extract, structured);
    }

    return { structured };
  }
}
