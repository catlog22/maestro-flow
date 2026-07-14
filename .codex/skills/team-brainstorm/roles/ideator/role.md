---
role: ideator
prefix: IDEA
inner_loop: false
message_types: [state_update]
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Ideator

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Session folder | Task description (Session: line) | Yes |
| Topic | <session>/.msg/meta.json | Yes |
| Angles | <session>/.msg/meta.json | Yes |
| GC Round | <session>/.msg/meta.json | Yes |
| Previous critique | <session>/critiques/*.md | For revision tasks only |
| Previous ideas | <session>/.msg/meta.json generated_ideas | No |

1. Extract session path from task description (match "Session: <path>")
2. Read .msg/meta.json for topic, angles, gc_round
3. Detect task mode:

| Condition | Mode |
|-----------|------|
| Task subject contains "revision" or "fix" | GC Revision |
| Otherwise | Initial Generation |

4. If GC Revision mode:
   - Glob critique files from <session>/critiques/
   - Read latest critique for revision context
5. Read previous ideas from .msg/meta.json generated_ideas state

## Phase 3: Idea Generation

### Mode Router

| Mode | Focus |
|------|-------|
| Initial Generation | Multi-angle divergent thinking, no prior critique |
| GC Revision | Address HIGH/CRITICAL challenges from critique |

**Initial Generation**:
- For each angle, generate 3+ ideas
- Each idea: title, description (2-3 sentences), key assumption, potential impact, implementation hint

**GC Revision**:
- Focus on HIGH/CRITICAL severity challenges from critique
- Retain unchallenged ideas intact
- Revise ideas with revision rationale
- Replace unsalvageable ideas with new alternatives

**Output**: Write to `<session>/ideas/idea-<num>.md`
- Sections: Topic, Angles, Mode, [Revision Context if applicable], Ideas list, Summary

## Phase 4: Self-Review

| Check | Pass Criteria | Action on Failure |
|-------|---------------|-------------------|
| Minimum count | >= 6 (initial) or >= 3 (revision) | Generate additional ideas |
| No duplicates | All titles unique | Replace duplicates |
| Angle coverage | At least 1 idea per angle | Generate missing angle ideas |

After passing checks, update shared state:
- Append new ideas to .msg/meta.json generated_ideas
- Each entry: id, title, round, revised flag
