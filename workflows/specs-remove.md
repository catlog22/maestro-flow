# Spec Remove Workflow

Remove a `<spec-entry>` block from a specs container file. Symmetric with `specs-add.md`.

Uses `maestro wiki remove-entry` for atomic removal — the entry is deleted from the markdown file and the unified wiki index is auto-updated by WikiIndexer.

---

## Prerequisites

- `.workflow/specs/` initialized (at least one specs file exists)
- `maestro wiki` CLI available
- Entry ID known (use `maestro wiki list --type spec` to discover)

---

## Argument Shape

```
/spec-remove spec-learnings-003                → remove entry 003 from learnings.md
/spec-remove spec-coding-conventions-001       → remove entry 001 from coding-conventions.md
/spec-remove spec-quality-rules-005 -y         → remove without confirmation
```

| Flag | Effect |
|------|--------|
| `<entry-id>` | Required. The spec sub-node ID to remove |
| `-y` / `--yes` | Skip confirmation prompt |

---

## Stage 1: Parse Input

1. Extract entry ID from arguments
2. Validate non-empty (E001 if missing)
3. Check `.workflow/specs/` exists (E002 if not)

---

## Stage 2: Lookup Entry

1. Run `maestro wiki get <entry-id> --json` to fetch entry metadata
2. Validate entry exists (E003 if not found)
3. Validate entry is a spec sub-node — must have:
   - `type` = "spec"
   - `parent` field set (sub-nodes have parent pointing to container)
   - If not a sub-node, error E004
4. Extract: title, category, keywords, container file path, body preview

---

## Stage 3: Confirm Removal

Display entry details for user confirmation:

```
== Spec Entry to Remove ==
ID:        {entry-id}
Title:     {title}
Category:  {category}
Keywords:  {keywords}
Container: .workflow/specs/{filename}
Preview:   {first 80 chars of body}

Remove this entry? [y/N]
```

If `-y` flag: skip confirmation.
If user declines: abort with "Cancelled."

---

## Stage 4: Remove Entry

Execute removal via wiki CLI:

```bash
maestro wiki remove-entry <entry-id>
```

This command:
1. Reads the container file
2. Locates the `<spec-entry>` block by index position
3. Removes the block (including opening tag, body, closing tag)
4. Writes the updated file
5. WikiIndexer auto-updates `.workflow/wiki-index.json`

---

## Stage 5: Verify & Report

1. Verify entry no longer appears: `maestro wiki get <entry-id>` should return not-found
2. Display confirmation:

```
== Entry Removed ==
ID:        {entry-id}
From:      .workflow/specs/{filename}
Remaining: {remaining entry count} entries in {filename}

To verify:  maestro wiki list --type spec --category {category}
To re-add:  /spec-add {category} {content}
```

