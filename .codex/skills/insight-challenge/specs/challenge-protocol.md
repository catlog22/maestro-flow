# Challenge Protocol Specification

## Overview

This protocol defines the systematic approach to challenging code quality findings. The goal is to ensure findings are accurate before action is taken, reducing false positives and wasted effort.

## Challenge Methodology

### Step 1: Claim Decomposition

Break the finding into atomic, verifiable claims:

1. **Existence claims**: "X exists/does not exist in file Y"
2. **Behavior claims**: "Function X does Y when Z"
3. **Structure claims**: "Type X has N members"
4. **Conformance claims**: "Implementation deviates from design by X"
5. **Numeric claims**: "Missing N items (expected M, found K)"

Each claim must be independently verifiable.

### Step 2: Evidence Collection

For each claim, collect:

1. **Primary evidence**: Direct source code reading
2. **Secondary evidence**: Related files, imports, type definitions
3. **Design evidence**: Referenced design documents
4. **Usage evidence**: How the code is actually used

Evidence hierarchy:
- Source code > Design docs > Comments > Assumptions

### Step 3: Adversarial Analysis

Apply these challenge strategies:

#### Strategy A: Direct Verification
Read the exact file and line referenced. Does the claim match reality?

```
Claim: "Line 58: type X is missing"
Action: Read line 58 of the file
Result: Line 58 shows type X IS present → claim overturned
```

#### Strategy B: Context Expansion
The claim may be technically correct but misleadingly decontextualized.

```
Claim: "Function X has no error handling"
Action: Read the full function and its callers
Result: Error handling is done by callers → claim weakened
```

#### Strategy C: Scope Correction
The claim may confuse different scopes or namespaces.

```
Claim: "28 edge types required, only 21 found"
Action: Check what "28" refers to in design docs
Result: 28 = language types, not edge types → claim overturned
```

#### Strategy D: Temporal Check
The claim may reference outdated code.

```
Claim: "File X uses deprecated API Y"
Action: Check git history and current code
Result: API was updated last week → claim overturned
```

#### Strategy E: Completeness Check
The claim may be partially correct but incomplete.

```
Claim: "Type X is missing from union"
Action: Check all union members
Result: X is present but Y is actually missing → claim weakened
```

### Step 4: Verdict Determination

Use this decision tree:

```
Is the primary claim factually incorrect?
  ├─ Yes → verdict = "overturned"
  └─ No → Is the severity/scope overstated?
       ├─ Yes → verdict = "weakened"
       └─ No → Is the claim accurate?
            ├─ Yes → verdict = "confirmed"
            └─ Uncertain → verdict = "weakened" (lower confidence)
```

### Step 5: Confidence Scoring

| Confidence | Meaning |
|------------|---------|
| 90-100% | Clear, unambiguous evidence |
| 70-89% | Strong evidence with minor uncertainty |
| 50-69% | Mixed evidence; judgment call |
| Below 50% | Insufficient evidence; recommend further investigation |

Factors affecting confidence:
- Source code clarity
- Design doc availability
- Claim specificity
- Evidence completeness

## Anti-Patterns

### 1. Confirmation Bias
**Wrong**: Looking only for evidence that supports the finding
**Right**: Actively seeking counter-evidence first

### 2. Manufactured Doubt
**Wrong**: Challenging findings without real counter-evidence
**Right**: Only challenge when evidence genuinely contradicts

### 3. Nitpicking
**Wrong**: Challenging trivial details while ignoring core issues
**Right**: Focus on claims that affect the finding's validity

### 4. Scope Creep
**Wrong**: Expanding the challenge beyond the finding's claims
**Right**: Address only what the finding asserts

## Output Quality Criteria

A good challenge report:

1. **Specific**: References exact file paths and line numbers
2. **Verifiable**: Counter-evidence can be independently checked
3. **Fair**: Acknowledges supporting evidence when present
4. **Actionable**: Provides clear recommendation
5. **Proportional**: Confidence matches evidence strength

## Integration Points

### With Quality Pipeline
- Challenge can be triggered automatically for high-severity findings
- Results feed back into finding confidence scores
- Overturned findings are flagged for template improvement

### With Knowledge System
- Confirmed findings can be captured as knowhow
- Challenge patterns can be codified as review specs
- Common false-positive patterns become learning material

### With Team Skills
- Challenge can be delegated to specialized agents
- Results inform team scoring and convergence
- Adversarial patterns align with team-adversarial-swarm
