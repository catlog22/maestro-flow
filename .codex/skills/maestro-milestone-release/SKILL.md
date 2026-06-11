---
name: maestro-milestone-release
description: Bump version, generate changelog, tag milestone
argument-hint: "[<version>] [--bump patch|minor|major] [--dry-run] [--no-tag] [--no-push]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Package a completed milestone into a releasable version. Bumps project version in manifest,
generates CHANGELOG.md entry from phase/milestone summaries and git log, creates annotated
git tag, optionally pushes to remote. Runs after `$maestro-milestone-complete`.
</purpose>

<required_reading>
@~/.maestro/workflows/milestone-release.md
</required_reading>

<context>
$ARGUMENTS — optional explicit version and flags.

**Flags:**
- `<version>` — Explicit version (e.g. `1.2.0`). If omitted, derived from `--bump`.
- `--bump patch|minor|major` — Semver bump (default: `minor`)
- `--dry-run` — Compute version + changelog without writing
- `--no-tag` — Skip git tag creation
- `--no-push` — Skip `git push --follow-tags`

**Preconditions:**
- Current milestone completed (audit PASS + milestone-complete run)
- Working tree clean (no uncommitted changes) unless `--dry-run`
</context>

<execution>
Follow '~/.maestro/workflows/milestone-release.md' completely.

**Flow:** Validate preconditions → Resolve version → Collect changes → Generate CHANGELOG →
Bump manifest → Commit → Tag → Push

**Report:**
```
=== RELEASE COMPLETE ===
Version:   v{previous} → v{new}
Milestone: {name}
Tag:       v{new} {pushed|local-only}
Changelog: {N} entries
```
</execution>

<invariants>
**Prerequisite enforcement** — milestone MUST be completed (audit PASS + milestone-complete run). Working tree MUST be clean. Artifact verification: CHANGELOG.md entry, version manifest update, release commit, git tag (unless --no-tag) all MUST exist before reporting completion.
</invariants>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Milestone not completed | Run `$maestro-milestone-complete` first |
| E002 | error | Audit verdict not PASS | Re-run `$maestro-milestone-audit` |
| E003 | error | Working tree not clean | Commit or stash changes |
| E004 | error | Version manifest not found | Add manifest or pass explicit version |
| E005 | error | Version not greater than current | Choose higher version |
| W001 | warning | No changes since last tag | Confirm release is desired |
| W002 | warning | Remote push failed | Retry `git push --follow-tags` |
</error_codes>

<success_criteria>
- [ ] Preconditions validated
- [ ] Target version computed and greater than previous
- [ ] Version manifest(s) updated
- [ ] CHANGELOG.md entry with milestone summary + grouped changes
- [ ] Release commit created
- [ ] Annotated git tag created (unless --no-tag)
- [ ] Pushed to remote (unless --no-push)
- [ ] state.json updated with last_release_version
</success_criteria>
