---
name: scholar-rebuttal-pro
description: Enhanced academic paper review response workflow with Agy/CLI collaborative analysis and multi-perspective discussion. Produces structured rebuttal documents with evidence-based strategies. Triggers on "rebuttal", "respond to reviewers", "review response", "审稿回复".
allowed-tools: Task, AskUserQuestion, TodoWrite, Read, Write, Edit, Bash, Glob, Grep, Skill, mcp__ace-tool__search_context, mcp__ccw-tools__read_file, mcp__ccw-tools__edit_file
---

# Scholar Rebuttal Pro

Enhanced academic paper review response workflow combining Agy/CLI collaborative analysis with multi-perspective discussion. Produces structured, evidence-based rebuttal documents optimized for conference-specific requirements.

## Pre-load (before execution)

1. **Codebase docs**: If `.workflow/codebase/ARCHITECTURE.md` exists, read for project context
2. **Specs**: `maestro load --type spec --category coding` — load coding conventions
3. **Wiki knowledge**: `maestro search "academic writing research paper" --json` — top 5 entries as prior context
4. All optional — proceed without if unavailable

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Scholar Rebuttal Pro Orchestrator (SKILL.md)                    │
│  → Pure coordinator: Execute phases, parse outputs, pass context  │
│  → Optional: --session <session-id> for WFS session integration   │
└───────────────────────┬─────────────────────────────────────────┘
                        │
    ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
    │ Phase 1 │ │ Phase 2 │ │ Phase 3 │ │ Phase 4 │ │ Phase 5 │ │ Step 6  │
    │ Review  │ │ Multi-  │ │Strategy │ │Rebuttal │ │ Quality │ │Session  │
    │ Parsing │ │Perspect │ │Formula  │ │ Writing │ │Validat  │ │Finalize │
    └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
      reviewA    discussion   strategy    rebuttal    quality     git commit
      nalysis    Consensus    Matrix      Draft       Score      + register
```

## Key Design Principles

1. **CLI-Assisted Analysis**: Leverage Agy CLI for semantic analysis, evidence gathering, and quality validation
2. **Multi-Perspective Discussion**: Simulate author/reviewer/expert viewpoints to develop robust strategies
3. **Evidence-Based Responses**: Link every response to paper content or experimental evidence
4. **Conference-Agnostic Templates**: Support extensible template system for different venues
5. **Progressive Disclosure**: Load phase documents on-demand to manage context window

## Interactive Preference Collection

Collect workflow preferences via AskUserQuestion before dispatching to phases:

```javascript
const prefResponse = AskUserQuestion({
  questions: [
    {
      question: "是否跳过所有确认步骤（自动模式）？",
      header: "Auto Mode",
      multiSelect: false,
      options: [
        { label: "Interactive (Recommended)", description: "交互模式，每阶段后确认" },
        { label: "Auto", description: "跳过所有确认，自动执行" }
      ]
    },
    {
      question: "论文内容来源？（用于策略制定时查找支撑证据）",
      header: "Paper Source",
      multiSelect: false,
      options: [
        { label: "Provide Path", description: "指定论文 PDF/LaTeX 路径" },
        { label: "Current Directory", description: "自动搜索当前目录" },
        { label: "Review Only", description: "仅基于审稿意见回复" }
      ]
    },
    {
      question: "目标会议类型？（影响模板和策略选择）",
      header: "Conference",
      multiSelect: false,
      options: [
        { label: "ML Conferences", description: "NeurIPS/ICML/ICLR" },
        { label: "CV Conferences", description: "CVPR/ECCV/ICCV" },
        { label: "NLP Conferences", description: "ACL/EMNLP" },
        { label: "Generic", description: "通用模板" }
      ]
    }
  ]
})

// Derive workflowPreferences from user selection
workflowPreferences = {
  autoYes: prefResponse["Auto Mode"] === "Auto",
  paperSource: prefResponse["Paper Source"],
  conferenceType: prefResponse["Conference"]
}
```

**workflowPreferences** is passed to phase execution as context variable.
Phases reference as `workflowPreferences.autoYes`, `workflowPreferences.paperSource`, etc.

## Auto Mode Defaults

When `workflowPreferences.autoYes === true`:
- Skip confirmation after each phase
- Use recommended strategies from multi-perspective discussion
- Apply default conference template (Generic)
- Auto-proceed to quality validation

## Execution Flow

> **⚠️ COMPACT DIRECTIVE**: Context compression MUST check TodoWrite phase status.
> The phase currently marked `in_progress` is the active execution phase — preserve its FULL content.
> Only compress phases marked `completed` or `pending`.

```
Input Parsing:
   └─ Convert user input to structured format (reviewCommentsPath + paperPath + conferenceType)
   └─ Parse --session flag → resolve output_base (session: {sessionDir}/rebuttal/ | default: .)

Phase 1: Review Parsing & Classification
   └─ Ref: phases/01-review-parsing.md
      ├─ Tasks attached: Parse reviewer comments structure → Classify comments using Agy CLI → Extract sentiment and key concerns → Generate review-analysis.json
      └─ Output: reviewAnalysis, commentCategories, ${output_base}/review-analysis.json, ${output_base}/comment-classification.md

Phase 2: Multi-Perspective Discussion
   └─ Ref: phases/02-multi-perspective-discussion.md
      ├─ Tasks attached: Author perspective: effective response strategies → Reviewer perspective: persuasive arguments → Expert perspective: technical accuracy and academic norms → Synthesize consensus strategies
      └─ Output: discussionConsensus, strategicRecommendations, ${output_base}/discussion-log.md, ${output_base}/consensus-strategies.json

Phase 3: Strategy Formulation
   └─ Ref: phases/03-strategy-formulation.md
      ├─ Tasks attached: Map comments to response strategies → Search paper content for evidence using CLI → Identify gaps requiring new experiments → Generate strategy matrix
      └─ Output: strategyMatrix, evidenceMap, ${output_base}/strategy-matrix.md, ${output_base}/evidence-references.json

Phase 4: Rebuttal Writing
   └─ Ref: phases/04-rebuttal-writing.md
      ├─ Tasks attached: Apply conference-specific template → Write point-by-point responses → Integrate evidence and citations → Optimize professional tone
      └─ Output: rebuttalDraft, rebuttal.md, ${output_base}/rebuttal-draft-v1.md

Phase 5: Quality Validation
   └─ Ref: phases/05-quality-validation.md
      ├─ Tasks attached: Check completeness (all comments addressed) → Assess professionalism and tone → Evaluate persuasiveness and evidence strength → Generate improvement recommendations
      └─ Output: qualityScore, improvements, ${output_base}/quality-report.md, ${output_base}/improvement-suggestions.json

Step 6: Session Finalization (only when --session provided)
   └─ Git commit artifacts → Register in context/index.json
      ├─ Tasks: git add rebuttal/ → git commit → register artifacts in index.json
      └─ Output: commit hash, updated index.json

Return:
   └─ Summary with recommended next steps
```

**Phase Reference Documents** (read on-demand when phase executes):

| Phase | Document | Purpose | Compact |
|-------|----------|---------|---------|
| 1 | [phases/01-review-parsing.md](phases/01-review-parsing.md) | Parse reviewer comments, classify by type (Major/Minor/Typo/Misunderstanding), extract key concerns using Agy CLI semantic analysis | TodoWrite 驱动 |
| 2 | [phases/02-multi-perspective-discussion.md](phases/02-multi-perspective-discussion.md) | Simulate discussion from author, reviewer, and domain expert perspectives to develop consensus strategies | TodoWrite 驱动 + 🔄 sentinel |
| 3 | [phases/03-strategy-formulation.md](phases/03-strategy-formulation.md) | Select response strategies (Accept/Defend/Clarify/Experiment) based on discussion, analyze paper content for supporting evidence using CLI | TodoWrite 驱动 + 🔄 sentinel |
| 4 | [phases/04-rebuttal-writing.md](phases/04-rebuttal-writing.md) | Generate structured rebuttal document using rebuttal-writer agent, apply conference-specific templates, optimize tone | TodoWrite 驱动 + 🔄 sentinel |
| 5 | [phases/05-quality-validation.md](phases/05-quality-validation.md) | Validate rebuttal quality using Agy CLI: completeness, professionalism, persuasiveness, generate improvement suggestions | TodoWrite 驱动 |

**Compact Rules**:
1. **TodoWrite `in_progress`** → 保留完整内容，禁止压缩
2. **TodoWrite `completed`** → 可压缩为摘要
3. **🔄 sentinel fallback** → 带此标记的 phase 包含 compact sentinel；若 compact 后仅存 sentinel 而无完整 Step 协议，必须立即 `Read()` 恢复

## Core Rules

1. **Start Immediately**: First action is TodoWrite initialization, second action is Phase 1 execution
2. **No Preliminary Analysis**: Do not read files or gather context before Phase 1
3. **Parse Every Output**: Extract required data from each phase for next phase
4. **Auto-Continue**: Check TodoList status to execute next pending phase automatically
5. **Track Progress**: Update TodoWrite dynamically with task attachment/collapse pattern
6. **Progressive Phase Loading**: Read phase docs ONLY when that phase is about to execute
7. **DO NOT STOP**: Continuous multi-phase workflow until all phases complete
8. **CLI Integration**: Use `ccw cli --tool agy --mode analysis` for semantic analysis tasks
9. **Evidence Linking**: Every response strategy must link to paper content or experimental evidence

## Input Processing

User provides review comments in one of these formats:

1. **File path**: `reviews.txt`, `reviewer-comments.md`, `reviews.pdf`
2. **Inline text**: Paste reviewer comments directly
3. **Structured JSON**: Pre-parsed review structure

**Optional flag**: `--session <session-id>` to integrate with WFS session.

### Session Resolution

```javascript
// Parse --session flag from $ARGUMENTS
const sessionMatch = $ARGUMENTS.match(/--session\s+(\S+)/);

if (sessionMatch) {
  const sessionId = sessionMatch[1];
  // Resolve session directory (follows paper:assemble pattern)
  const sessionDir = `.workflow/${sessionId}`;

  // Validate session exists
  if (!fs.existsSync(`${sessionDir}/session.json`)) {
    error(`Session not found: ${sessionDir}. Run /session:start first.`);
  }

  // Create rebuttal subdirectory if it doesn't exist
  // mkdir -p ${sessionDir}/rebuttal/
  const output_base = `${sessionDir}/rebuttal`;

  // Remove --session flag from arguments before further parsing
  const cleanArgs = $ARGUMENTS.replace(/--session\s+\S+/, '').trim();
} else {
  // No session: use current working directory (backward-compatible default)
  const output_base = '.';
  const sessionDir = null;
  const cleanArgs = $ARGUMENTS;
}
```

### Structured Input

Convert to structured format:

```javascript
const structuredInput = {
  reviewCommentsPath: <path or inline text>,
  paperPath: workflowPreferences.paperSource === "Provide Path" ? <user-provided> : <auto-discovered>,
  conferenceType: workflowPreferences.conferenceType,
  autoMode: workflowPreferences.autoYes,
  sessionId: sessionMatch ? sessionMatch[1] : null,
  sessionDir: sessionDir,
  output_base: output_base  // All phase outputs use this base path
}
```

## Data Flow

```
User Input (review comments + paper path + conference type [+ --session <session-id>])
    |
[Session Resolution]
    | sessionDir = --session provided ? .workflow/{session-id}/ : null
    | output_base = sessionDir ? {sessionDir}/rebuttal/ : .
    | mkdir -p ${output_base}
    |
[Convert to Structured Format]
    |
Phase 1: Review Parsing & Classification
    | Input: reviewCommentsPath + conferenceType
    | Output: reviewAnalysis + commentCategories
    | Files: ${output_base}/review-analysis.json, ${output_base}/comment-classification.md
    |
Phase 2: Multi-Perspective Discussion
    | Input: reviewAnalysis + commentCategories
    | Output: discussionConsensus + strategicRecommendations
    | Files: ${output_base}/discussion-log.md, ${output_base}/consensus-strategies.json
    |
Phase 3: Strategy Formulation
    | Input: discussionConsensus + strategicRecommendations + paperPath
    | Output: strategyMatrix + evidenceMap
    | Files: ${output_base}/strategy-matrix.md, ${output_base}/evidence-references.json
    |
Phase 4: Rebuttal Writing
    | Input: strategyMatrix + evidenceMap + conferenceType
    | Output: rebuttalDraft
    | Files: ${output_base}/rebuttal-draft-v1.md
    |
Phase 5: Quality Validation
    | Input: rebuttalDraft
    | Output: qualityScore + improvements
    | Files: ${output_base}/quality-report.md, ${output_base}/improvement-suggestions.json
    |
Step 6: Session Finalization (only when --session provided)
    | Git commit all artifacts in session repo
    | Register artifacts in {sessionDir}/context/index.json
    |
Return summary to user
```

## TodoWrite Pattern

**Core Concept**: Dynamic task attachment and collapse for real-time visibility.

### Key Principles

1. **Task Attachment** (when phase executed):
   - Sub-tasks are **attached** to orchestrator's TodoWrite
   - **Phase 1, 2, 3, 4, 5**: Multiple sub-tasks attached

2. **Task Collapse** (after sub-tasks complete):
   - **Applies to Phase 1, 2, 3, 4, 5**: Remove sub-tasks, collapse to summary
   - Maintains clean orchestrator-level view

3. **Continuous Execution**: After completion, automatically proceed to next phase

### Phase 1 (Tasks Attached):
```json
[
  {"content": "Phase 1: Review Parsing & Classification", "status": "in_progress"},
  {"content": "  → Parse reviewer comments structure", "status": "in_progress"},
  {"content": "  → Classify comments using Agy CLI", "status": "pending"},
  {"content": "  → Extract sentiment and key concerns", "status": "pending"},
  {"content": "  → Generate review-analysis.json", "status": "pending"},
  {"content": "Phase 2: Multi-Perspective Discussion", "status": "pending"},
  {"content": "Phase 3: Strategy Formulation", "status": "pending"},
  {"content": "Phase 4: Rebuttal Writing", "status": "pending"},
  {"content": "Phase 5: Quality Validation", "status": "pending"},
  {"content": "Step 6: Session Finalization (if --session)", "status": "pending"}
]
```

### Phase 1 (Collapsed):
```json
[
  {"content": "Phase 1: Review Parsing & Classification", "status": "completed"},
  {"content": "Phase 2: Multi-Perspective Discussion", "status": "pending"},
  {"content": "Phase 3: Strategy Formulation", "status": "pending"},
  {"content": "Phase 4: Rebuttal Writing", "status": "pending"},
  {"content": "Phase 5: Quality Validation", "status": "pending"},
  {"content": "Step 6: Session Finalization (if --session)", "status": "pending"}
]
```

## Post-Phase Updates

After each phase completes:

1. **Phase 1 → Phase 2**: Pass `reviewAnalysis` and `commentCategories` to discussion phase
2. **Phase 2 → Phase 3**: Pass `discussionConsensus` and `strategicRecommendations` to strategy formulation
3. **Phase 3 → Phase 4**: Pass `strategyMatrix` and `evidenceMap` to rebuttal writing
4. **Phase 4 → Phase 5**: Pass `rebuttalDraft` to quality validation
5. **Phase 5 → Return**: Present quality report and improvement suggestions to user

## Error Handling

- **Parsing Failure**: If output parsing fails, retry once, then report error
- **Validation Failure**: Report which file/data is missing
- **Command Failure**: Keep phase `in_progress`, report error, do not proceed
- **CLI Failure**: If Agy CLI fails, fall back to direct analysis or report error
- **Paper Not Found**: If paper path invalid, proceed with review-only mode

## Coordinator Checklist

**Before Phase 1**:
- [ ] TodoWrite initialized with all 5 phases
- [ ] User preferences collected (autoMode, paperSource, conferenceType)
- [ ] Review comments path validated
- [ ] Paper path validated (if provided)

**Between Phases**:
- [ ] Previous phase marked `completed`
- [ ] Current phase marked `in_progress`
- [ ] Output variables extracted and passed to next phase
- [ ] Sub-tasks collapsed to summary

**After Phase 5**:
- [ ] All phases marked `completed`
- [ ] Quality report generated
- [ ] Improvement suggestions presented
- [ ] Final rebuttal.md file written

**Step 6 - Session Finalization** (only when `--session` was provided):
- [ ] All artifacts committed to git within session repo
- [ ] Artifacts registered in `{sessionDir}/context/index.json` with type `notes` and tag `rebuttal`
- [ ] Session `session.json` updated with rebuttal progress

## Step 6: Session Finalization

> **Condition**: Only executes when `--session <session-id>` was provided. Skip entirely otherwise.

After Phase 5 completes, finalize the session integration:

### 6.1 Git Commit Artifacts

```bash
# Commit all rebuttal artifacts within the session
cd "${sessionDir}"
git add rebuttal/
git commit -m "feat(rebuttal): add rebuttal artifacts (review analysis, strategy, draft, quality report)"
```

### 6.2 Register Artifacts in Context Index

Register key rebuttal artifacts in `{sessionDir}/context/index.json` so other session commands can discover them.

```javascript
// Read existing index
const indexPath = `${sessionDir}/context/index.json`;
const index = JSON.parse(Read(indexPath));

// Artifacts to register
const rebuttalArtifacts = [
  {
    id: `rebuttal_analysis_${Date.now()}`,
    type: "notes",
    description: "Review analysis and comment classification",
    path: "rebuttal/review-analysis.json",
    tags: ["rebuttal", "review-analysis"],
    added_at: new Date().toISOString()
  },
  {
    id: `rebuttal_strategy_${Date.now()}`,
    type: "notes",
    description: "Response strategy matrix with evidence mapping",
    path: "rebuttal/strategy-matrix.md",
    tags: ["rebuttal", "strategy"],
    added_at: new Date().toISOString()
  },
  {
    id: `rebuttal_draft_${Date.now()}`,
    type: "notes",
    description: "Rebuttal draft document",
    path: "rebuttal/rebuttal-draft-v1.md",
    tags: ["rebuttal", "draft"],
    added_at: new Date().toISOString()
  },
  {
    id: `rebuttal_quality_${Date.now()}`,
    type: "notes",
    description: "Rebuttal quality validation report",
    path: "rebuttal/quality-report.md",
    tags: ["rebuttal", "quality"],
    added_at: new Date().toISOString()
  }
];

// Append to materials array and update statistics
index.materials.push(...rebuttalArtifacts);
index.statistics.total_materials = index.materials.length;
index.updated_at = new Date().toISOString();

// Update tag_index
for (const artifact of rebuttalArtifacts) {
  for (const tag of artifact.tags) {
    if (!index.tag_index[tag]) index.tag_index[tag] = [];
    index.tag_index[tag].push(artifact.id);
  }
}

Write(indexPath, JSON.stringify(index, null, 2));
```

### 6.3 Update Session Status

```bash
jq --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
  .progress.rebuttal = {
    "status": "completed",
    "artifacts_path": "rebuttal/",
    "completed_at": $ts
  }
' "${sessionDir}/session.json" > temp.json
mv temp.json "${sessionDir}/session.json"

# Final commit with session metadata update
cd "${sessionDir}"
git add context/index.json session.json
git commit -m "chore(rebuttal): register artifacts in session index"
```

## Related Commands

**Prerequisites**:
- `/research-init` - Initialize research project structure
- `/zotero-review` - Import and review literature

**Follow-ups**:
- `/commit` - Commit rebuttal document to version control
- `/presentation` - Prepare conference presentation after acceptance
- `/poster` - Generate academic poster

## CLI Integration Details

This skill uses `ccw cli` for enhanced analysis:

**Phase 1 - Review Parsing**:
```bash
ccw cli -p "PURPOSE: Parse and classify reviewer comments by type (Major/Minor/Typo/Misunderstanding)
TASK: • Extract comment structure • Classify by severity • Identify sentiment
MODE: analysis
CONTEXT: @<review-file>
EXPECTED: JSON with classification results" --tool agy --mode analysis
```

**Phase 2 - Multi-Perspective Discussion**:
Uses `team-ultra-analyze` skill or custom discussion agent to simulate multiple perspectives.

**Phase 3 - Strategy Formulation**:
```bash
ccw cli -p "PURPOSE: Search paper content for evidence supporting response strategies
TASK: • Locate relevant sections • Extract supporting data • Identify evidence gaps
MODE: analysis
CONTEXT: @<paper-file>
EXPECTED: Evidence map with file:line references" --tool agy --mode analysis
```

**Phase 5 - Quality Validation**:
```bash
ccw cli -p "PURPOSE: Validate rebuttal quality (completeness, professionalism, persuasiveness)
TASK: • Check all comments addressed • Assess tone • Evaluate evidence strength
MODE: analysis
CONTEXT: @<rebuttal-file>
EXPECTED: Quality report with improvement suggestions" --tool agy --mode analysis
```

## Conference Template System

Templates are loaded from:
- **Built-in**: `G:\github_lib\claude-scholar\skills\review-response\references\`
- **Custom**: `d:\ccws\.workflow\参考文档1\` (user-provided)

Template selection based on `workflowPreferences.conferenceType`:
- **ML Conferences**: NeurIPS/ICML/ICLR strategies (novelty, theory, experiments)
- **CV Conferences**: CVPR/ECCV/ICCV strategies (visual results, one-page limit)
- **NLP Conferences**: ACL/EMNLP strategies (linguistic appropriateness, ethics)
- **Generic**: Universal template for all venues
