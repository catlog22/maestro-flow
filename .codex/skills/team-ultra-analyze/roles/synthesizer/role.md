---
role: synthesizer
prefix: SYNTH
inner_loop: false
message_types: 
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Synthesizer

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| All artifacts | `<session>/explorations/*.json`, `analyses/*.json`, `discussions/*.json` | Yes |
| Decision trail | From wisdom/.msg/meta.json | No |

1. Extract session path and topic from task description
2. Read all exploration, analysis, and discussion round files
3. Load decision trail and current understanding from meta.json
4. Select synthesis strategy:

| Condition | Strategy |
|-----------|----------|
| Single analysis, no discussions | simple (Quick mode summary) |
| Multiple analyses, >2 discussion rounds | deep (track evolution) |
| Default | standard (cross-perspective integration) |

## Phase 3: Cross-Perspective Synthesis

Execute synthesis across four dimensions:

**1. Theme Extraction**: Identify convergent themes across all analysis perspectives. Cluster insights by similarity, rank by cross-perspective confirmation count.

**2. Conflict Resolution**: Identify contradictions between perspectives. Present both sides with trade-off analysis when irreconcilable.

**3. Evidence Consolidation**: Deduplicate findings, aggregate by file reference. Map evidence to conclusions with confidence levels:

| Level | Criteria |
|-------|----------|
| High | Multiple sources confirm, strong evidence |
| Medium | Single source or partial evidence |
| Low | Speculative, needs verification |

**4. Recommendation Prioritization**: Sort all recommendations by priority (high > medium > low), deduplicate, cap at 10.

Integrate decision trail from discussion rounds into final narrative.

## Phase 4: Write Conclusions

1. Write `<session>/conclusions.json`:
```json
{
  "session_id": "...", "topic": "...", "completed": "ISO-8601",
  "summary": "Executive summary...",
  "key_conclusions": [{"point": "...", "evidence": "...", "confidence": "high"}],
  "recommendations": [{"action": "...", "rationale": "...", "priority": "high"}],
  "open_questions": ["..."],
  "decision_trail": [{"round": 1, "decision": "...", "context": "..."}],
  "cross_perspective_synthesis": { "convergent_themes": [], "conflicts_resolved": [], "unique_contributions": [] },
  "_metadata": { "explorations": 3, "analyses": 3, "discussions": 2, "strategy": "standard" }
}
```

2. Append conclusions section to `<session>/discussion.md`:
```markdown
## Conclusions
### Summary / Key Conclusions / Recommendations / Remaining Questions
## Decision Trail / Current Understanding (Final) / Session Statistics
```

Update `<session>/wisdom/.msg/meta.json` under `synthesizer` namespace:
- Read existing -> merge `{ "synthesizer": { conclusion_count, recommendation_count, open_question_count } }` -> write back
