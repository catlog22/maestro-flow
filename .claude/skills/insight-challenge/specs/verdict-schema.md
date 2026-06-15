# Verdict Schema Specification

## Overview

This document defines the structured output format for insight challenge verdicts. The schema ensures consistent, machine-readable results that can be consumed by downstream systems.

## Verdict JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["finding_id", "challenge_result", "confidence", "reasoning"],
  "properties": {
    "finding_id": {
      "type": "string",
      "description": "Original finding identifier"
    },
    "challenge_result": {
      "type": "string",
      "enum": ["overturned", "weakened", "confirmed"],
      "description": "Verdict of the challenge"
    },
    "confidence": {
      "type": "integer",
      "minimum": 0,
      "maximum": 100,
      "description": "Confidence score (0-100)"
    },
    "reasoning": {
      "type": "string",
      "description": "Detailed explanation of the verdict"
    },
    "counter_evidence": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Evidence that contradicts the finding"
    },
    "supporting_evidence": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Evidence that supports the finding"
    },
    "adjusted_severity": {
      "type": "string",
      "enum": ["none", "critical", "high", "medium", "low"],
      "description": "Recommended severity after challenge"
    },
    "recommendation": {
      "type": "string",
      "description": "Recommended action"
    },
    "metadata": {
      "type": "object",
      "properties": {
        "challenge_duration_ms": { "type": "integer" },
        "files_reviewed": { "type": "array", "items": { "type": "string" } },
        "design_docs_checked": { "type": "array", "items": { "type": "string" } },
        "challenge_strategies_applied": { "type": "array", "items": { "type": "string" } }
      }
    }
  }
}
```

## Field Definitions

### finding_id
- **Type**: string
- **Required**: yes
- **Description**: The original finding identifier (e.g., "HIGH-01", "CRIT-03")
- **Example**: "HIGH-01"

### challenge_result
- **Type**: string (enum)
- **Required**: yes
- **Values**:
  - `overturned`: Finding is factually incorrect; source code directly contradicts claims
  - `weakened`: Finding is partially correct but overstated, misscoped, or missing context
  - `confirmed`: Finding is accurate; source code supports all claims

### confidence
- **Type**: integer (0-100)
- **Required**: yes
- **Description**: How confident the challenger is in the verdict
- **Scale**:
  - 90-100: Clear, unambiguous evidence
  - 70-89: Strong evidence with minor uncertainty
  - 50-69: Mixed evidence; judgment call
  - Below 50: Insufficient evidence

### reasoning
- **Type**: string
- **Required**: yes
- **Description**: Detailed explanation of why the verdict was reached
- **Should include**:
  - Summary of the original claim
  - What evidence was found
  - Why the evidence supports the verdict
  - Any caveats or limitations

### counter_evidence
- **Type**: array of strings
- **Required**: no (but expected for overturned/weakened)
- **Description**: Specific evidence that contradicts the finding
- **Format**: Each item should reference a specific file and line
- **Example**: ["src/types.ts line 64: 'resolves' IS declared in KnowledgeEdgeKind"]

### supporting_evidence
- **Type**: array of strings
- **Required**: no (but expected for confirmed)
- **Description**: Specific evidence that supports the finding
- **Format**: Same as counter_evidence

### adjusted_severity
- **Type**: string (enum)
- **Required**: no
- **Values**:
  - `none`: Finding should be dismissed entirely
  - `critical`, `high`, `medium`, `low`: Adjusted severity level
- **Description**: Recommended severity after considering challenge evidence
- **Default**: Original severity if not specified

### recommendation
- **Type**: string
- **Required**: no
- **Description**: Recommended next action
- **Examples**:
  - "Dismiss this finding; the claimed gap does not exist"
  - "Downgrade to medium severity; the issue exists but is less critical than claimed"
  - "Confirm and prioritize; the finding is accurate and important"

### metadata
- **Type**: object
- **Required**: no
- **Description**: Additional context about the challenge process
- **Fields**:
  - `challenge_duration_ms`: Time spent on the challenge
  - `files_reviewed`: List of files examined
  - `design_docs_checked`: Design documents consulted
  - `challenge_strategies_applied`: Which challenge strategies were used

## Example Verdicts

### Overturned Finding

```json
{
  "finding_id": "HIGH-01",
  "challenge_result": "overturned",
  "confidence": 97,
  "reasoning": "The finding's central claim is factually incorrect. Both 'resolves' and 'documents' ARE declared in KnowledgeEdgeKind in types.ts (lines 64 and 61 respectively). The '28 edge types' design requirement is a misattribution -- the design doc specifies 12 CodeEdgeKind + 8 KnowledgeEdgeKind = 20, and the implementation has 21.",
  "counter_evidence": [
    "types.ts lines 58-67: KnowledgeEdgeKind explicitly declares all 9 types including 'resolves' (L64) and 'documents' (L61)",
    "Design doc plan-maestrograph.md L1327: specifies '12 + 8 种知识关系' = 20 total, not 28",
    "The '28' number in the finding matches LANGUAGES constant (L1344), not edge types"
  ],
  "supporting_evidence": [],
  "adjusted_severity": "none",
  "recommendation": "Dismiss this finding; the claimed type gap does not exist"
}
```

### Weakened Finding

```json
{
  "finding_id": "MED-02",
  "challenge_result": "weakened",
  "confidence": 75,
  "reasoning": "The finding correctly identifies that function X lacks input validation, but overstates the severity. The function is only called internally with pre-validated data, reducing the actual risk.",
  "counter_evidence": [
    "src/service.ts: Function X is only called from Y() which validates inputs",
    "No external API exposes this function directly"
  ],
  "supporting_evidence": [
    "src/utils.ts line 45: Function X确实没有输入验证"
  ],
  "adjusted_severity": "low",
  "recommendation": "Add defensive validation as a best practice, but do not prioritize as high severity"
}
```

### Confirmed Finding

```json
{
  "finding_id": "CRIT-03",
  "challenge_result": "confirmed",
  "confidence": 95,
  "reasoning": "The finding accurately identifies a SQL injection vulnerability. User input is directly concatenated into the query string without parameterization.",
  "counter_evidence": [],
  "supporting_evidence": [
    "src/db.ts line 78: query = 'SELECT * FROM users WHERE id = ' + userId",
    "userId comes directly from req.params.id without sanitization"
  ],
  "adjusted_severity": "critical",
  "recommendation": "Immediate fix required; use parameterized queries"
}
```

## Batch Processing

When processing multiple findings:

```json
{
  "batch_id": "review-2026-06-12",
  "total_findings": 5,
  "verdicts": [
    { "finding_id": "HIGH-01", "challenge_result": "overturned", ... },
    { "finding_id": "HIGH-02", "challenge_result": "confirmed", ... },
    { "finding_id": "MED-01", "challenge_result": "weakened", ... }
  ],
  "summary": {
    "overturned": 1,
    "weakened": 1,
    "confirmed": 3,
    "adjusted_effort_savings": "40% of original findings dismissed or downgraded"
  }
}
```

## Integration with Downstream Systems

### Quality Dashboard
- Verdicts update finding status in quality tracking
- Confidence scores affect finding priority
- Adjusted severities trigger appropriate workflows

### Knowledge System
- Confirmed findings become knowhow candidates
- Challenge patterns become review specs
- Overturned findings improve future detection

### Team Skills
- Verdicts feed into team scoring algorithms
- Challenge results inform convergence criteria
- Adversarial patterns enhance team review quality
