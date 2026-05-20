---
name: security-audit
description: OWASP Top 10 and STRIDE security auditing with supply chain analysis
argument-hint: [quick|standard|deep] [--scope <path>]
allowed-tools:
  - ask_question
  - define_subagent
  - grep_search
  - invoke_subagent
  - manage_subagents
  - run_command
  - send_message
  - view_file
  - write_to_file
---
<purpose>
Systematic security audit covering OWASP Top 10, dependency supply chain, secrets detection,
CI/CD pipeline review, and optional STRIDE threat modeling. Three tiers control depth vs speed.
</purpose>

<context>
$ARGUMENTS — Parse tier and scope:
- Tier: `quick` (default) | `standard` | `deep`
- `--scope <path>`: Limit scan to directory (default: project root)

**Tier coverage:**

| Tier | OWASP | Dependencies | Secrets | CI/CD | STRIDE | Git History |
|------|-------|-------------|---------|-------|--------|-------------|
| quick | ✓ | ✓ | — | — | — | — |
| standard | ✓ | ✓ | ✓ | ✓ | — | — |
| deep | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
</context>

<execution>

**Phase 1: Reconnaissance**

1. Detect tech stack from package.json / go.mod / requirements.txt / Cargo.toml
2. Identify entry points: HTTP handlers, API routes, CLI parsers, WebSocket handlers
3. List authentication/authorization modules
4. Map data flow: user input → processing → storage → output

**Phase 2: OWASP Top 10 Scan** (all tiers)

For each category, scan relevant source files:

| # | Category | What to check |
|---|----------|--------------|
| A01 | Broken Access Control | Missing auth middleware, direct object references, path traversal |
| A02 | Cryptographic Failures | Weak algorithms, hardcoded keys, missing TLS, plaintext storage |
| A03 | Injection | SQL concatenation, shell exec with user input, template injection |
| A04 | Insecure Design | Missing rate limits, no CSRF tokens, predictable tokens |
| A05 | Security Misconfiguration | Debug mode, default credentials, verbose errors, open CORS |
| A06 | Vulnerable Components | Known CVEs in dependencies |
| A07 | Auth Failures | Weak password rules, missing brute-force protection, session fixation |
| A08 | Data Integrity | Deserialization of untrusted data, unsigned updates |
| A09 | Logging Failures | Missing audit logs, logging sensitive data |
| A10 | SSRF | Unvalidated URLs in server-side requests |

Use `Grep` for pattern matching (e.g., `eval(`, `exec(`, `innerHTML`, `dangerouslySetInnerHTML`,
`sql.*\+.*req\.`, `process\.env` without validation).

**Phase 3: Dependency Audit** (all tiers)

```bash
# Node.js
npm audit --json 2>/dev/null || true
# Check lockfile integrity
test -f package-lock.json && echo "lockfile present" || echo "WARNING: no lockfile"
```

Check for:
- Known vulnerabilities (CVE references)
- Lockfile presence and integrity
- Typosquatting risk on critical dependencies (manually check suspicious names)

**Phase 4: Secrets Detection** (standard + deep)

```bash
# Current codebase
grep -rn --include="*.ts" --include="*.js" --include="*.json" --include="*.env*" \
  -E "(password|secret|api.?key|token|credential).*=.*['\"][^'\"]{8,}" . || true
```

Check `.env.example` for leaked values. Check `.gitignore` for missing `.env` patterns.

**Phase 5: CI/CD Audit** (standard + deep)

Scan `.github/workflows/*.yml` for:
- Overly permissive `permissions:` (write-all, contents: write)
- Unpinned action versions (`uses: actions/checkout@main` vs `@v4.1.0`)
- Secrets in logs (missing `mask` or `add-mask`)
- Pull request trigger with `pull_request_target` (code injection risk)

**Phase 6: STRIDE Threat Modeling** (deep only)

For each critical module identified in Phase 1:

| Threat | Question |
|--------|----------|
| **S**poofing | Can identity be faked? Is auth per-request? |
| **T**ampering | Can data be modified in transit/storage? Integrity checks? |
| **R**epudiation | Are actions logged with user identity? |
| **I**nformation Disclosure | Can unauthorized data be accessed? |
| **D**enial of Service | Resource limits? Rate limiting? |
| **E**levation of Privilege | Can roles be escalated? Input validation on role fields? |

**Phase 7: Git History Archaeology** (deep only)

```bash
# Search for previously committed secrets
git log --all --diff-filter=D --name-only --pretty=format: -- "*.env" "*.key" "*.pem" 2>/dev/null | head -20
git log -p --all -S "password" --since="1 year ago" -- "*.ts" "*.js" 2>/dev/null | head -50
```

**Phase 8: Report**

Output severity matrix:

```
=== Security Audit ({tier}) ===

CRITICAL ({count}):
  - [A03] SQL injection in {file}:{line} — {description}
    Fix: {remediation}

HIGH ({count}):
  ...

MEDIUM ({count}):
  ...

LOW ({count}):
  ...

Summary: {total} findings ({critical} critical, {high} high, {medium} medium, {low} low)
```

Emit completion status:
```
--- COMPLETION STATUS ---
STATUS: DONE|DONE_WITH_CONCERNS
CONCERNS: {count} critical findings require immediate action
NEXT: /quality-review
--- END STATUS ---
```
</execution>

<success_criteria>
- [ ] Tech stack identified and entry points mapped
- [ ] OWASP Top 10 categories all checked (tier-appropriate)
- [ ] Dependency audit completed with CVE listing
- [ ] Severity matrix produced with file:line references
- [ ] Each finding includes remediation suggestion
- [ ] Completion status block emitted
</success_criteria>
