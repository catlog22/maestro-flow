#!/usr/bin/env python3
"""
Sync maestro2 commands and agents to maestro-flow-one repository.

Usage:
    python scripts/sync-to-flow-one.py [--target D:\\maestro-flow-one] [--dry-run]
"""

import argparse
import shutil
import sys
from pathlib import Path

# Source project root
SOURCE_ROOT = Path(__file__).resolve().parent.parent
COMMANDS_DIR = SOURCE_ROOT / ".claude" / "commands"
CLAUDE_AGENTS_DIR = SOURCE_ROOT / ".claude" / "agents"
CODEX_AGENTS_DIR = SOURCE_ROOT / ".codex" / "agents"

# Default target
DEFAULT_TARGET = Path("D:/maestro-flow-one/maestro-flow")

# Skip orchestrator files (maestro.md, maestro-ralph*.md) — not synced
SKIP_FILES = {"maestro.md", "maestro-ralph.md", "maestro-ralph-execute.md"}

# Prefix → category (ordered longest first to avoid partial matches)
REVERSE_MAP = [
    ("maestro-milestone-", "milestone"),
    ("maestro-",           "lifecycle"),
    ("quality-",           "quality"),
    ("manage-",            "manage"),
    ("learn-",             "learn"),
    ("spec-",              "spec"),
    ("wiki-",              "wiki"),
]


def classify(filename: str) -> tuple[str, str] | None:
    """Map a command filename to (category, target_filename). Returns None for skipped files."""
    stem = filename.removesuffix(".md")

    if filename in SKIP_FILES:
        return None

    # Skip any maestro-ralph-* variants
    if stem.startswith("maestro-ralph"):
        return None

    for prefix, category in REVERSE_MAP:
        if stem.startswith(prefix):
            target_name = stem[len(prefix):] + ".md"
            if not target_name or target_name == ".md":
                target_name = filename
            return category, target_name

    # Fallback: use filename as-is in lifecycle
    return "lifecycle", filename


def sync_files(source_dir: Path, target_dir: Path, ext: str, dry_run: bool) -> dict:
    """Sync files from source to target (flat copy, no classification). Returns stats."""
    stats = {"new": 0, "updated": 0, "unchanged": 0}
    source_files = sorted(source_dir.glob(f"*{ext}"))

    for src_file in source_files:
        dest = target_dir / src_file.name
        action = "new"
        if dest.exists():
            if src_file.read_text(encoding="utf-8") == dest.read_text(encoding="utf-8"):
                stats["unchanged"] += 1
                continue
            action = "updated"

        marker = "+" if action == "new" else "~"
        print(f"  [{marker}] {src_file.name}")

        if not dry_run:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src_file, dest)
        stats[action] += 1

    # Detect deleted files
    deleted = 0
    if target_dir.exists():
        for dest_file in sorted(target_dir.glob(f"*{ext}")):
            if not (source_dir / dest_file.name).exists():
                print(f"  [-] {dest_file.name}  (source deleted)")
                if not dry_run:
                    dest_file.unlink()
                deleted += 1
    stats["deleted"] = deleted
    return stats


def sync(target_dir: Path, dry_run: bool = False) -> None:
    if not COMMANDS_DIR.exists():
        print(f"Error: Source commands directory not found: {COMMANDS_DIR}")
        sys.exit(1)

    commands_target = target_dir / "commands"

    # --- Sync commands (with prefix classification) ---
    print("Commands:")
    source_files = sorted(COMMANDS_DIR.glob("*.md"))
    if not source_files:
        print("  No .md files found in source directory.")
        return

    stats = {"new": 0, "updated": 0, "unchanged": 0, "skipped": 0}

    for src_file in source_files:
        result = classify(src_file.name)
        if result is None:
            stats["skipped"] += 1
            continue
        category, target_name = result

        dest = commands_target / category / target_name

        # Check if file needs update
        action = "new"
        if dest.exists():
            src_content = src_file.read_text(encoding="utf-8")
            dest_content = dest.read_text(encoding="utf-8")
            if src_content == dest_content:
                stats["unchanged"] += 1
                continue
            action = "updated"

        # Report
        rel_dest = dest.relative_to(target_dir)
        marker = "+" if action == "new" else "~"
        print(f"  [{marker}] {src_file.name:40s} → {rel_dest}")

        if not dry_run:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src_file, dest)

        stats[action] = stats.get(action, 0) + 1

    # Check for files in target that no longer exist in source
    deleted = 0
    if commands_target.exists():
        for dest_file in sorted(commands_target.rglob("*.md")):
            rel = dest_file.relative_to(target_dir)
            parts = list(rel.parts)  # e.g., ['commands', 'lifecycle', 'plan.md']
            if len(parts) >= 3 and parts[0] == "commands":
                cat = parts[1]
                fname = parts[2]
                prefix = ""
                for p, c in REVERSE_MAP:
                    if c == cat:
                        prefix = p
                        break
                src_name = prefix + fname
                if not (COMMANDS_DIR / src_name).exists():
                    print(f"  [-] {rel}  (source deleted: {src_name})")
                    if not dry_run:
                        dest_file.unlink()
                    deleted += 1

    # Summary
    print()
    mode_label = "[DRY RUN] " if dry_run else ""
    print(f"{mode_label}Commands sync: "
          f"{stats['new']} new, {stats['updated']} updated, "
          f"{stats['unchanged']} unchanged, {stats['skipped']} skipped, {deleted} deleted")
    print(f"Total source commands: {len(source_files)}")

    # --- Sync claude agents ---
    if CLAUDE_AGENTS_DIR.exists():
        print()
        print("Claude agents:")
        claude_agents_target = target_dir / "agents"
        agent_stats = sync_files(CLAUDE_AGENTS_DIR, claude_agents_target, ".md", dry_run)
        print(f"{mode_label}Claude agents sync: "
              f"{agent_stats['new']} new, {agent_stats['updated']} updated, "
              f"{agent_stats['unchanged']} unchanged, {agent_stats['deleted']} deleted")

    # --- Sync codex agents ---
    # Codex agents live under the sibling codex variant directory
    codex_target_dir = target_dir.parent / "codex" / "maestro-flow"
    if CODEX_AGENTS_DIR.exists():
        print()
        print("Codex agents:")
        codex_agents_target = codex_target_dir / "agents"
        codex_stats = sync_files(CODEX_AGENTS_DIR, codex_agents_target, ".toml", dry_run)
        print(f"{mode_label}Codex agents sync: "
              f"{codex_stats['new']} new, {codex_stats['updated']} updated, "
              f"{codex_stats['unchanged']} unchanged, {codex_stats['deleted']} deleted")


def main():
    parser = argparse.ArgumentParser(description="Sync maestro commands to maestro-flow-one repo")
    parser.add_argument("--target", type=Path, default=DEFAULT_TARGET,
                        help=f"Target maestro-flow directory (default: {DEFAULT_TARGET})")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview changes without applying")
    args = parser.parse_args()

    print(f"Source:  {COMMANDS_DIR}")
    print(f"Target:  {args.target}")
    print(f"Mode:    {'DRY RUN' if args.dry_run else 'LIVE'}")
    print()

    sync(args.target, args.dry_run)


if __name__ == "__main__":
    main()
