# Review Dimensions (4-Dimension System)

## Security (SEC)

Vulnerabilities, attack surfaces, and data protection issues.

**Categories**: injection, authentication, authorization, data-exposure, encryption, input-validation, access-control

**Tool Support**: Semgrep (`--config auto`), npm audit, tsc strict mode
**LLM Focus**: Business logic vulnerabilities, privilege escalation paths, sensitive data flows

**Severity Mapping**:
- Critical: RCE, SQL injection, auth bypass, data breach
- High: XSS, CSRF, insecure deserialization, weak crypto
- Medium: Missing input validation, overly permissive CORS
- Low: Informational headers, minor config issues

---

## Correctness (COR)

Bugs, logic errors, and type safety issues.

**Categories**: bug, error-handling, edge-case, type-safety, race-condition, null-reference

**Tool Support**: tsc `--noEmit`, ESLint error-level rules
**LLM Focus**: Logic errors, unhandled exception paths, state management bugs, race conditions

**Severity Mapping**:
- Critical: Data corruption, crash in production path
- High: Incorrect business logic, unhandled error in common path
- Medium: Edge case not handled, missing null check
- Low: Minor type inconsistency, unused variable

---

## Performance (PRF)

Inefficiencies, resource waste, and scalability issues.

**Categories**: n-plus-one, memory-leak, blocking-operation, complexity, resource-usage, caching

**Tool Support**: None (LLM-only dimension)
**LLM Focus**: Algorithm complexity, N+1 queries, unnecessary sync operations, memory leaks, missing caching

**Severity Mapping**:
- Critical: Memory leak in long-running process, O(n³) on user data
- High: N+1 query in hot path, blocking I/O in async context
- Medium: Suboptimal algorithm, missing obvious cache
- Low: Minor inefficiency, premature optimization opportunity

---

## Maintainability (MNT)

Code quality, readability, and structural health.

**Categories**: code-smell, naming, complexity, duplication, dead-code, pattern-violation, coupling

**Tool Support**: ESLint warning-level rules, complexity metrics
**LLM Focus**: Architectural coupling, abstraction leaks, project convention violations

**Severity Mapping**:
- High: God class, circular dependency, copy-paste across modules
- Medium: Long method, magic numbers, unclear naming
- Low: Minor style inconsistency, commented-out code
- Info: Pattern observation, refactoring suggestion

---

## Why 4 Dimensions (Not 7)

The original review-cycle used 7 dimensions with significant overlap:

| Original | Problem | Merged Into |
|----------|---------|-------------|
| Quality | Overlaps Maintainability + Best-Practices | **Maintainability** |
| Best-Practices | Overlaps Quality + Maintainability | **Maintainability** |
| Architecture | Overlaps Maintainability (coupling/layering) | **Maintainability** (structure) + **Security** (security architecture) |
| Action-Items | Not a dimension — it's a report format | Standard field on every finding |

4 dimensions = clear ownership, no overlap, each maps to distinct tooling.
