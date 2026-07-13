
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Phase 1: Requirements Analysis

Gather team skill requirements from user input and build the `teamConfig` data structure that drives all subsequent phases.

## Objective

- Parse user input (text description, reference skill, or interactive)
- Determine roles, pipelines, specs, templates
- Auto-decide commands distribution (inline vs commands/ folder)
- Build comprehensive `teamConfig` object
- Confirm with user before proceeding

## Step 1.1: Detect Input Source

```javascript
function detectInputSource(userInput) {
  // Source A: Reference to existing skill
  if (userInput.includes('based on') || userInput.includes('参考') || userInput.includes('like')) {
    return { type: 'reference', refSkill: extractSkillName(userInput) };
  }
  // Source B: Structured input with roles/pipelines
  if (userInput.includes('ROLES:') || userInput.includes('PIPELINES:')) {
    return { type: 'structured', data: parseStructuredInput(userInput) };
  }
  // Source C: Natural language description
  return { type: 'natural', description: userInput };
}
```

**For reference source**: Read the referenced skill's SKILL.md and role files to extract structure.

**For natural language**: Use AskUserQuestion to gather missing details interactively.

## Step 1.2: Gather Core Identity

```javascript
const coreIdentity = AskUserQuestion({
  questions: [
    {
      question: "团队技能名称？(kebab-case, e.g., team-code-review)",
      header: "Skill Name",
      multiSelect: false,
      options: [
        { label: suggestedName, description: "Auto-suggested from description" },
        { label: "Custom", description: "Enter custom name" }
      ]
    },
    {
      question: "会话前缀？(3-4字符用于任务ID, e.g., TCR)",
      header: "Prefix",
      multiSelect: false,
      options: [
        { label: suggestedPrefix, description: "Auto-suggested" },
        { label: "Custom", description: "Enter custom prefix" }
      ]
    }
  ]
});
```

If user provided clear name/prefix in input, skip this step.

## Step 1.3: Determine Roles

### Role Discovery from Domain

Analyze domain description to identify required roles:

```javascript
function discoverRoles(domain) {
  const rolePatterns = {
    'analyst': ['分析', 'analyze', 'research', 'explore', 'investigate', 'scan'],
    'planner': ['规划', 'plan', 'design', 'architect', 'decompose'],
    'writer': ['文档', 'write', 'document', 'draft', 'spec', 'report'],
    'executor': ['实现', 'implement', 'execute', 'build', 'code', 'develop'],
    'tester': ['测试', 'test', 'verify', 'validate', 'qa'],
    'reviewer': ['审查', 'review', 'quality', 'check', 'audit', 'inspect'],
    'security-expert': ['安全', 'security', 'vulnerability', 'penetration'],
    'performance-optimizer': ['性能', 'performance', 'optimize', 'benchmark'],
    'data-engineer': ['数据', 'data', 'pipeline', 'etl', 'migration'],
    'devops-engineer': ['部署', 'devops', 'deploy', 'ci/cd', 'infrastructure'],
  };

  const matched = [];
  for (const [role, keywords] of Object.entries(rolePatterns)) {
    if (keywords.some(kw => domain.toLowerCase().includes(kw))) {
      matched.push(role);
    }
  }
  return matched;
}
```

### Role Configuration

For each discovered role, determine:

```javascript
function configureRole(roleName) {
  return {
    name: roleName,
    prefix: determinePrefix(roleName),
    inner_loop: determineInnerLoop(roleName),
    hasCommands: false,  // determined in Step 1.5
    commands: [],
    message_types: determineMessageTypes(roleName),
    path: `roles/${roleName}/role.md`
  };
}

// Standard prefix mapping
const prefixMap = {
  'analyst': 'RESEARCH',
  'writer': 'DRAFT',
  'planner': 'PLAN',
  'executor': 'IMPL',
  'tester': 'TEST',
  'reviewer': 'REVIEW',
  // Dynamic roles use uppercase role name
};

// Inner loop: roles that process multiple tasks sequentially
const innerLoopRoles = ['executor', 'writer', 'planner'];

// Message types the role handles
const messageMap = {
  'analyst': ['state_update'],
  'writer': ['state_update', 'discuss_response'],
  'planner': ['state_update'],
  'executor': ['state_update', 'revision_request'],
  'tester': ['state_update'],
  'reviewer': ['state_update', 'discuss_request'],
};
```

## Step 1.4: Define Pipelines

### Pipeline Types from Role Combination

```javascript
function definePipelines(roles, domain) {
  const has = name => roles.some(r => r.name === name);

  // Full lifecycle: analyst → writer → planner → executor → tester → reviewer
  if (has('analyst') && has('writer') && has('planner') && has('executor'))
    return [{ name: 'full-lifecycle', tasks: buildFullLifecycleTasks(roles) }];

  // Spec-only: analyst → writer → reviewer
  if (has('analyst') && has('writer') && !has('executor'))
    return [{ name: 'spec-only', tasks: buildSpecOnlyTasks(roles) }];

  // Impl-only: planner → executor → tester → reviewer
  if (has('planner') && has('executor') && !has('analyst'))
    return [{ name: 'impl-only', tasks: buildImplOnlyTasks(roles) }];

  // Custom: user-defined
  return [{ name: 'custom', tasks: buildCustomTasks(roles, domain) }];
}
```

### Task Schema

```javascript
const taskSchema = {
  id: 'PREFIX-NNN',       // e.g., RESEARCH-001
  role: 'analyst',        // which role executes
  name: 'Seed Analysis',  // human-readable name
  dependsOn: [],          // task IDs that must complete first
  isCheckpoint: false,    // true for quality gates
  isConditional: false,   // true for routing decisions
  description: '...'
};
```

## Step 1.5: Determine Commands Distribution

**Rule**: 1 action → inline in role.md. 2+ distinct actions → commands/ folder.

```javascript
function determineCommandsDistribution(roles) {
  // Coordinator: always has commands/
  // coordinator.commands = ['analyze', 'dispatch', 'monitor']

  // Standard multi-action roles:
  // executor → implement + fix → commands/
  // reviewer (if both code & spec review) → review-code + review-spec → commands/
  // All others → typically inline

  for (const role of roles) {
    const actions = countDistinctActions(role);
    if (actions.length >= 2) {
      role.hasCommands = true;
      role.commands = actions.map(a => a.name);
    }
  }
}
```

## Step 1.6: Determine Specs and Templates

```javascript
// Specs: always include pipelines, add domain-specific
const specs = ['pipelines'];
if (hasQualityGates) specs.push('quality-gates');
if (hasKnowledgeTransfer) specs.push('knowledge-transfer');

// Templates: only if writer role exists
const templates = [];
if (has('writer')) {
  // Detect from domain keywords
  if (domain.includes('product')) templates.push('product-brief');
  if (domain.includes('requirement')) templates.push('requirements');
  if (domain.includes('architecture')) templates.push('architecture');
  if (domain.includes('epic')) templates.push('epics');
}
```

## Step 1.7: Build teamConfig

```javascript
const teamConfig = {
  skillName: string,          // e.g., "team-code-review"
  sessionPrefix: string,      // e.g., "TCR"
  domain: string,             // domain description
  title: string,              // e.g., "Code Review Team"
  roles: Array<RoleConfig>,   // includes coordinator
  pipelines: Array<Pipeline>,
  specs: Array<string>,       // filenames without .md
  templates: Array<string>,   // filenames without .md
  conditionalRouting: boolean,
  dynamicSpecialists: Array<string>,
};
```

## Step 1.8: Confirm with User

```
╔══════════════════════════════════════════╗
║  Team Skill Configuration Summary        ║
╠══════════════════════════════════════════╣

Skill Name:     ${skillName}
Session Prefix: ${sessionPrefix}
Domain:         ${domain}

Roles (N):
  ├─ coordinator (commands: analyze, dispatch, monitor)
  ├─ role-a [PREFIX-*] (inline) 🔄
  └─ role-b [PREFIX-*] (commands: cmd1, cmd2)

Pipelines:
  └─ pipeline-name: TASK-001 → TASK-002 → TASK-003

Specs: pipelines, quality-gates
Templates: (none)

╚══════════════════════════════════════════╝
```

Use AskUserQuestion to confirm or allow modifications.

## Output

- **Variable**: `teamConfig` — complete configuration for all subsequent phases
- **Next**: Phase 2 - Scaffold Generation
