---
name: maestro-milestone-release
description: Bump version, generate changelog, tag milestone
argument-hint: "[<version>] [--bump patch|minor|major] [--dry-run] [--no-tag] [--no-push]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
session-mode: deprecated
---

<deprecated_command>
This command has been removed. Use the project release workflow after the Session DAG is sealed. Do not create artifacts from this entry point.
</deprecated_command>
