# Phase 4: Apply Improvements

> **COMPACT SENTINEL [Phase 4: Improve]**
> This phase contains 4 execution steps (Step 4.1 -- 4.4).
> If you can read this sentinel but cannot find the full Step protocol below, context has been compressed.
> Recovery: `Read("phases/04-improve.md")`

Apply targeted improvements to skill files based on evaluation suggestions. Uses a general-purpose Agent to make changes, ensuring only suggested modifications are applied.

## Objective

- Read evaluation suggestions from current iteration
- Launch Agent to apply improvements in priority order
- Document all changes made
- Update iteration state

## Execution

### Step 4.1: Prepare Improvement Context

```javascript
const N = state.current_iteration;
const iterDir = `${state.work_dir}/iterations/iteration-${N}`;
const evaluation = state.iterations[N - 1].evaluation;

// Verify we have suggestions to apply
if (!evaluation.suggestions || evaluation.suggestions.length === 0) {
  // No suggestions -- skip improvement, mark iteration complete
  state.iterations[N - 1].improvement = {
    changes_applied: [],
    changes_file: null,
    improvement_rationale: 'No suggestions provided by evaluation'
  };
  state.iterations[N - 1].status = 'completed';
  Write(`${state.work_dir}/iteration-state.json`, JSON.stringify(state, null, 2));
  // -> Return to orchestrator for next iteration
  return;
}

// Build file inventory for agent context
const skillFileInventory = state.target_skills.map(skill => {
  return `Skill: ${skill.name} (${skill.path})\nFiles:\n` +
    skill.files.map(f => `  - ${f}`).join('\n');
}).join('\n\n');

// Chain mode: add chain relationship context
const chainContext = state.execution_mode === 'chain'
  ? `\nChain Order: ${state.chain_order.join(' -> ')}\n` +
    `Chain Scores: ${state.chain_order.map(s =>
      `${s}: ${state.iterations[N-1].evaluation?.chain_scores?.[s] || 'N/A'}`
    ).join(', ')}\n` +
    `Weakest Link: ${state.chain_order.reduce((min, s) => {
      const score = state.iterations[N-1].evaluation?.chain_scores?.[s] || 100;
      return score < (state.iterations[N-1].evaluation?.chain_scores?.[min] || 100) ? s : min;
    }, state.chain_order[0])}`
  : '';
```

### Step 4.2: Launch Improvement Agent

> **CHECKPOINT**: Before launching agent, verify:
> 1. evaluation.suggestions is non-empty
> 2. All target_file paths in suggestions are valid

```javascript
const suggestionsText = evaluation.suggestions.map((s, i) =>
  `${i + 1}. [${s.priority.toUpperCase()}] ${s.description}\n` +
  `   Target: ${s.target_file}\n` +
  `   Rationale: ${s.rationale}\n` +
  (s.code_snippet ? `   Suggested change:\n   ${s.code_snippet}\n` : '')
).join('\n');

Agent({
  subagent_type: 'general-purpose',
  run_in_background: false,
  description: `Apply skill improvements iteration ${N}`,
  prompt: `## Task: Apply Targeted Improvements to Skill Files

You are improving a workflow skill based on evaluation feedback. Apply ONLY the suggested changes -- do not refactor, add features, or "improve" beyond what is explicitly suggested.

## Current Score: ${evaluation.score}/100
Dimension breakdown:
${evaluation.dimensions.map(d => `- ${d.name}: ${d.score}/100`).join('\n')}

## Skill File Inventory
${skillFileInventory}

${chainContext ? `## Chain Context\n${chainContext}\n\nPrioritize improvements on the weakest skill in the chain. Also consider interface compatibility between adjacent skills in the chain.\n` : ''}

## Improvement Suggestions (apply in priority order)
${suggestionsText}

## Rules
1. Read each target file BEFORE modifying it
2. Apply ONLY the suggested changes -- no unsolicited modifications
3. If a suggestion's target_file doesn't exist, skip it and note in summary
4. If a suggestion conflicts with existing patterns, adapt it to fit (note adaptation)
5. Preserve existing code style, naming conventions, and structure
6. After all changes, write a change summary to: ${iterDir}/iteration-${N}-changes.md

## Changes Summary Format (write to ${iterDir}/iteration-${N}-changes.md)

# Iteration ${N} Changes

## Applied Suggestions
- [high] description: what was changed in which file
- [medium] description: what was changed in which file

## Files Modified
- path/to/file.md: brief description of changes

## Skipped Suggestions (if any)
- description: reason for skipping

## Notes
- Any adaptations or considerations

## Success Criteria
- All high-priority suggestions applied
- Medium-priority suggestions applied if feasible
- Low-priority suggestions applied if trivial
- Changes summary written to ${iterDir}/iteration-${N}-changes.md
`
});
```

### Step 4.3: Verify Changes

After agent completes:

```javascript
// Verify changes summary was written
const changesFile = `${iterDir}/iteration-${N}-changes.md`;
const changesExist = Glob(changesFile).length > 0;

if (!changesExist) {
  // Agent didn't write summary -- create a minimal one
  Write(changesFile, `# Iteration ${N} Changes\n\n## Notes\nAgent completed but did not produce changes summary.\n`);
}

// Read changes summary to extract applied changes
const changesContent = Read(changesFile);

// Parse applied changes (heuristic: count lines starting with "- [")
const appliedMatches = changesContent.match(/^- \[.+?\]/gm) || [];
const changes_applied = appliedMatches.map(m => ({
  summary: m.replace(/^- /, ''),
  file: '' // Extracted from context
}));
```

### Step 4.4: Update State

```javascript
state.iterations[N - 1].improvement = {
  changes_applied: changes_applied,
  changes_file: changesFile,
  improvement_rationale: `Applied ${changes_applied.length} improvements based on evaluation score ${evaluation.score}`
};
state.iterations[N - 1].status = 'completed';
state.updated_at = new Date().toISOString();

// Also update the skill files list in case new files were created
for (const skill of state.target_skills) {
  skill.files = Glob(`${skill.path}/**/*.md`).map(f => f.replace(skill.path + '/', ''));
}

Write(`${state.work_dir}/iteration-state.json`, JSON.stringify(state, null, 2));

// -> Return to orchestrator for next iteration (Phase 2) or termination check
```

## Error Handling

| Error | Recovery |
|-------|----------|
| Agent fails to complete | Rollback from skill-snapshot: `cp -r "${iterDir}/skill-snapshot/${skill.name}/*" "${skill.path}/"` |
| Agent corrupts files | Same rollback from snapshot |
| Changes summary missing | Create minimal summary, continue |
| target_file not found | Agent skips suggestion, notes in summary |

## Output

- **Files**: `iteration-{N}-changes.md`, modified skill files
- **State**: `iterations[N-1].improvement` and `.status` updated
- **Next**: Return to orchestrator, begin next iteration (Phase 2) or terminate
