<!-- session-mode: inherited -->
# Command Overlays — Format & Contract

## File format

Each overlay is a JSON file at `~/.maestro/overlays/<name>.json`:

```json
{
  "name": "cli-verify-after-execute",
  "description": "Run ccw cli quality review after /maestro-execute",
  "targets": ["maestro-execute"],
  "priority": 50,
  "enabled": true,
  "scope": "any",
  "docs": ["docs/verify-protocol.md"],
  "patches": [
    {
      "section": "execution",
      "mode": "append",
      "content": "## CLI Verification (overlay)\n\nAfter execution, run:\n\n```\nccw cli -p \"PURPOSE: Review just-executed changes for quality regressions\" --mode analysis --rule analysis-review-code-quality\n```\n"
    },
    {
      "section": "required_reading",
      "mode": "append",
      "content": "@~/.maestro/overlays/docs/verify-protocol.md"
    }
  ]
}
```

### Top-level fields

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Slug, matches `^[a-z0-9][a-z0-9-_]*$`. Filesystem-safe and unique across overlays. |
| `description` | no | Short human summary shown in `maestro overlay list`. |
| `targets` | yes | Array of command names without `.md` (e.g., `maestro-execute`). Missing/disabled targets are skipped with a log entry. |
| `priority` | no | Default 50. Lower runs earlier. Alphabetical tiebreak. |
| `enabled` | no | Default true. Set `false` to keep on disk but exclude from apply. |
| `scope` | no | `global` / `project` / `any`. v1 is effectively global-only. |
| `docs` | no | Relative paths under `~/.maestro/overlays/docs/` that this overlay references. Informational only. |
| `patches` | yes | Non-empty array of patch objects. |

### Patch fields

| Field | Required | Notes |
|---|---|---|
| `section` | yes | One of `purpose`, `required_reading`, `deferred_reading`, `context`, `execution`, `error_codes`, `success_criteria`. For `new-section`, any slug. |
| `mode` | yes | `append` / `prepend` / `replace` / `new-section`. |
| `content` | yes | Raw markdown. Escaped `\n` inside JSON strings. No HTML-comment markers — the patcher adds its own. |
| `afterSection` | no | For `new-section` only. Section slug after which the new block is inserted. Omit to append at end of file. |

## Apply semantics

On apply, each patch's `content` is wrapped in hashed markers:

```
<!-- maestro-overlay:<name>#<idx> hash=<short> -->
...content...
<!-- /maestro-overlay:<name>#<idx> -->
```

- **Idempotent**: Re-applying with the same content produces byte-identical output — no mtime churn.
- **Drift-aware**: If the overlay's content changes, the marker block is replaced on next apply.
- **Surgical removal**: `maestro overlay remove <name>` strips only the marker blocks for that overlay; text outside markers is preserved.

### Mode behavior

| Mode | Insertion point | Notes |
|---|---|---|
| `append` | Immediately before `</section>` | Most common. Adds a new step at the end of the section. |
| `prepend` | Immediately after `<section>` | Adds a gate/precondition. |
| `replace` | Between `<section>` and `</section>` | Destructive — overwrites the entire section body. Use sparingly. |
| `new-section` | After `afterSection`'s `</...>` (or end of file) | Creates a brand-new tagged section. |

## Install integration

`maestro install` runs the following sequence:

1. Copy pristine files (`.claude/commands/*` etc.) from the package to the target
2. Restore `.md.disabled` state from the prior install
3. **Apply overlays** — reads `~/.maestro/overlays/*.json`, applies each enabled one to the just-installed commands, writes `~/.maestro/manifests/overlays-<scope>.json`

## CLI reference

```bash
maestro overlay list                        # show overlays and applied state
maestro overlay apply                       # reapply to all known install scopes
maestro overlay add <file.json>             # validate, install, apply
maestro overlay remove <name>               # strip markers, delete overlay file
```

## Edge cases

- **Disabled targets** (`.md.disabled`) are skipped silently.
- **Missing targets** are skipped with a log entry — not an error.
- **Multiple overlays on the same section** are sorted by `priority` (asc), alphabetical tiebreak. Each gets its own marker block, stacked inside the section.
- **User edits outside markers** are preserved across reapply (inside-marker edits are overwritten — that's the contract).
- **Invalid overlay JSON** never applies — errors surface in `maestro overlay list` and `maestro overlay add`.
- **CRLF vs LF** is detected per-target and preserved on write.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `overlay load error` in `list` | Invalid JSON or schema | Fix the file at the reported path |
| Marker start found but no matching end | File was hand-edited mid-marker | Delete the stale block manually; re-run `maestro overlay apply` |
| Changes not visible in Claude Code | Claude Code caches loaded commands | Restart Claude Code after applying |
| Overlay reapplied endlessly | Hash drift because content contains a dynamic value | Make the `content` deterministic — no timestamps |
