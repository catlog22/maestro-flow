# Phase 1: Parse Intent

解析用户输入，确定操作模式和查询参数。

## Objective

- 分析 `$ARGUMENTS` 确定用户意图
- 路由到正确的 Operation Mode
- 提取搜索关键词 / 命令名 / 分类过滤

## Execution

### Step 1.1: 空参数处理

若 `$ARGUMENTS` 为空或仅包含空白字符：
- 默认进入 **Mode 5: Beginner Onboarding**
- 展示核心命令列表和快速入门指引

### Step 1.2: 关键词匹配

按优先级匹配关键词到 Operation Mode：

```javascript
const text = $ARGUMENTS.toLowerCase().trim()

const modeMap = [
  // Mode 7: CLI Reference
  { patterns: ["cli", "终端", "terminal", "maestro 命令"], mode: 7 },
  // Mode 6: Skill & Agent Browsing
  { patterns: ["skill", "agent", "技能", "有哪些 skill", "团队 skill"], mode: 6 },
  // Mode 5: Beginner Onboarding
  { patterns: ["新手", "入门", "getting started", "常用命令", "入门指南"], mode: 5 },
  // Mode 4: Workflow Guide
  { patterns: ["工作流", "workflow", "怎么开始", "用什么流程", "流程", "pipeline", "管线"], mode: 4 },
  // Mode 3: Smart Recommendations
  { patterns: ["下一步", "what's next", "推荐", "继续", "next step", "然后呢"], mode: 3 },
  // Mode 1: Search (explicit)
  { patterns: ["搜索", "search", "查找", "find"], mode: 1 },
]

// Match first pattern hit
let matchedMode = null
for (const { patterns, mode } of modeMap) {
  if (patterns.some(p => text.includes(p))) {
    matchedMode = mode
    break
  }
}
```

### Step 1.3: 命令名检测

若未匹配任何模式关键词，检测是否为命令名：

```javascript
// Strip common prefixes for matching
const commandPrefixes = ["/", "maestro-", "manage-", "quality-", "spec-", "learn-", "wiki-"]

// Known command names from catalog (without prefix)
const knownCommands = [
  "maestro", "analyze", "plan", "execute", "verify", "init", "roadmap",
  "brainstorm", "blueprint", "quick", "overlay", "amend", "fork", "merge", "collab",
  "milestone-audit", "milestone-complete", "milestone-release",
  "composer", "player", "ralph", "ralph-execute", "learn",
  "impeccable", "ui-codify", "update",
  "tools-register", "tools-execute",
  "issue", "issue-discover", "knowhow", "knowhow-capture",
  "status", "wiki", "harvest", "codebase-refresh", "codebase-rebuild",
  "review", "auto-test", "test", "debug", "refactor", "sync", "retrospective",
  "setup", "load", "add", "remove",
  "retro", "follow", "decompose", "investigate", "second-opinion",
  "connect", "digest"
]

const normalizedName = text.replace(/^\//, "").replace(/-/g, "-")
if (knownCommands.some(cmd => normalizedName === cmd || normalizedName.endsWith("-" + cmd))) {
  matchedMode = 2  // Mode 2: Documentation
}
```

### Step 1.4: 兜底搜索

若以上均未匹配，进入 **Mode 1: Command Search**（模糊搜索）。

### Step 1.5: 上下文检测

对于 Mode 3 (Smart Recommendations)，额外检测项目状态：

```javascript
// Check project state
const hasWorkflow = glob.sync(".workflow/state.json").length > 0
const hasActiveSession = glob.sync(".workflow/active/*/state.json").length > 0

// Read state if exists
let projectState = null
if (hasWorkflow) {
  const state = JSON.parse(readFileSync(".workflow/state.json", "utf8"))
  projectState = {
    milestone: state.currentMilestone,
    phase: state.currentPhase,
    phaseStatus: state.phaseStatus,
    hasIssues: glob.sync(".workflow/issues.jsonl").length > 0
  }
}
```

## Output

```
{
  mode: number (1-7),
  query: string,
  category?: string,
  commandName?: string,
  projectState?: { milestone, phase, phaseStatus, hasIssues }
}
```

## Next Phase

- Mode 1/2/3/6/7 → [Phase 2: Search & Present](02-search-present.md)
- Mode 4/5 → [Phase 3: Workflow Guide](03-workflow-guide.md)
