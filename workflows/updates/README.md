<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Update Scripts

Version-specific smart upgrade workflows for `maestro-update`.

## Architecture

```
Schema migration (automatic)     Smart upgrade (workflow doc)
─────────────────────────        ──────────────────────────
src/migrations/v1-to-v2.ts  ──→  workflows/updates/update-v2-setup.md
src/migrations/v2-to-v3.ts  ──→  workflows/updates/update-v3-setup.md
```

- **Schema**: `src/migrations/` — code-level state.json transforms. Registry auto-chains all intermediate versions (v1→v2→v3 runs automatically, no manual steps).
- **Workflow**: `workflows/updates/update-v{VERSION}-setup.md` — what the user needs to know, configure, or verify after upgrading to that version.

## How It Works

1. `maestro-update` reads `.workflow/state.json` → `version`
2. Runs `npx tsx src/migrations/run.ts` which auto-chains all pending schema migrations
3. Loads `update-v{target}-setup.md` for the final target version
4. Setup doc guides user through environment changes (hooks, deps, knowledge system)

## Naming Convention

```
update-v{VERSION}-setup.md     — post-migration setup for version {VERSION}
```

## Adding a New Version

1. Create `src/migrations/v{FROM}-to-v{TO}.ts` (schema migration code)
2. Register in `src/migrations/index.ts`
3. Create `workflows/updates/update-v{TO}-setup.md` (smart upgrade guide)

## Current Versions

| Version | Schema | Setup |
|---------|--------|-------|
| v2.0 | `src/migrations/v1-to-v2.ts` | — |
| v3.0 | `src/migrations/v2-to-v3.ts` | `update-v3-setup.md` |
