# Bundled Impeccable Core

Maestro vendors and adapts the Impeccable design core so `/maestro-impeccable` is self-contained and never requires a separately installed `impeccable` Skill or npm runtime.

## Provenance

- Upstream: <https://github.com/pbakaus/impeccable>
- Upstream Skill version: `4.1.3`
- Upstream commit: `4c5243fcd42d39c1fc281adcaf10be0913095f74`
- Imported surfaces: `.claude/skills/impeccable/SKILL.md`, `reference/`, and `scripts/`
- License: Apache License 2.0; see `LICENSE`
- Third-party notices: see `NOTICE.md`

## Maestro adaptations

- Runtime base is `workflows/impeccable/` in a source checkout or `~/.maestro/workflows/impeccable/` after installation.
- User entry point is `/maestro-impeccable`, not `/impeccable`.
- Upstream self-update/install prompts are disabled; bundled updates ship through Maestro.
- Script references use the resolved `<impeccable-base>` supplied by the Maestro command.
- Hook manifests invoke the bundled scripts rather than project-local external Skill files.
- The legacy `ui-search/` directory remains a Maestro compatibility utility and is not part of upstream Impeccable.

When refreshing from upstream, preserve these adaptations and update this provenance record. Do not replace the bundled tree with `SKILL.src.md`; import the built provider Skill and review all path, update, hook, and command-name assumptions.
