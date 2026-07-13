---
role: synthesizer
prefix: SYNTH
inner_loop: false
message_types: [state_update]
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Synthesizer

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Session folder | Task description (Session: line) | Yes |
| All ideas | <session>/ideas/*.md files | Yes |
| All critiques | <session>/critiques/*.md files | Yes |
| GC rounds completed | <session>/.msg/meta.json gc_round | Yes |

1. Extract session path from task description (match "Session: <path>")
2. Glob all idea files from <session>/ideas/
3. Glob all critique files from <session>/critiques/
4. Read all idea and critique files for synthesis
5. Read .msg/meta.json for context (topic, gc_round, generated_ideas, critique_insights)

## Phase 3: Synthesis Execution

| Step | Action |
|------|--------|
| 1. Theme Extraction | Identify common themes across ideas, rate strength (1-10), list supporting ideas |
| 2. Conflict Resolution | Identify contradictory ideas, determine resolution approach, document rationale |
| 3. Complementary Grouping | Group complementary ideas together |
| 4. Gap Identification | Discover uncovered perspectives |
| 5. Integrated Proposal | Generate 1-3 consolidated proposals |

**Integrated Proposal Structure**:
- Core concept description
- Source ideas combined
- Addressed challenges from critiques
- Feasibility score (1-10), Innovation score (1-10)
- Key benefits list, Remaining risks list

**Output**: Write to `<session>/synthesis/synthesis-<num>.md`
- Sections: Input summary, Extracted Themes, Conflict Resolution, Integrated Proposals, Coverage Analysis

## Phase 4: Quality Check

| Check | Pass Criteria | Action on Failure |
|-------|---------------|-------------------|
| Proposal count | >= 1 proposal | Generate at least one proposal |
| Theme count | >= 2 themes | Look for more patterns |
| Conflict resolution | All conflicts documented | Address unresolved conflicts |

After passing checks, update shared state:
- Set .msg/meta.json synthesis_themes
- Each entry: name, strength, supporting_ideas
