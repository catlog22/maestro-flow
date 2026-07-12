<!-- session-mode: deprecated -->
# Workflow: milestone-release

## Deprecated Workflow Boundary

This workflow is retained only for migration documentation. Entry commands MUST route to the Session/Run replacement and stop; do not execute the legacy writes below.

## Arguments

| Flag | Description | Default |
|------|-------------|---------|
| `<milestone>` | Milestone id from `.workflow/state.json` `milestones[]` | current_milestone |
| `--bump <level>` | Semver bump: `major` \| `minor` \| `patch` | `minor` |
| `--dry-run` | Preview changes without writing | `false` |

---

## Step 1: Validation

1. Read `.workflow/state.json`:
   - Determine target milestone (from `$ARGUMENTS` or `current_milestone`).
   - If no milestone: ERROR E001.
2. Verify milestone is **completed**:
   - Read `.workflow/milestones/{milestone}/audit-report.md` — verdict must be `PASS`.
   - If missing or non-PASS: ERROR E002 with guidance to run `/maestro-milestone-complete` first.
3. Read package manifest (`package.json` / `pyproject.toml` / etc.) — locate current version. TODO: multi-manifest detection.

---

## Step 2: Version Bump

1. Compute next version from `--bump` level (semver). TODO: prerelease/build metadata handling.
2. Update manifest file in place. If `--dry-run`: print diff and exit.

---

## Step 3: Changelog Generation

1. Read milestone audit report + retrospective insights (`.workflow/milestones/{milestone}/`).
2. Render `CHANGELOG.md` entry — header `## [vX.Y.Z] - YYYY-MM-DD`, body grouped by `Added / Changed / Fixed / Removed`.
3. TODO: integrate with `quality-retrospective` output for richer narrative.

---

## Step 4: Tag and Commit

1. Stage updated manifest + `CHANGELOG.md`.
2. Commit: `chore(release): vX.Y.Z — {milestone}`.
3. Create annotated git tag `vX.Y.Z`.
4. TODO: optionally push tag (`--push` flag).

---

## Outputs

| Artifact | Status |
|----------|--------|
| Updated manifest version | written |
| `CHANGELOG.md` entry | appended |
| Git tag `vX.Y.Z` | created locally (not pushed) |

---

## Error Codes

| Code | Meaning |
|------|---------|
| E001 | No milestone resolvable |
| E002 | Milestone not completed / audit not PASS |
| E003 | Manifest file not found |
| E004 | Git working tree dirty (uncommitted changes block tagging) |

---

## TODO (placeholder gaps)

- Multi-package monorepo support.
- Push tag + GitHub release integration.
- Roll-back path on failed tag.
- Wire to `manage-knowhow-capture` for release-note capture.
