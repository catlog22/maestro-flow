import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const LEGACY_HEADING = /^## Legacy `session\/1\.x(?:\/2\.x)?` Compatibility Branch\s*$/m;

const COMMON_REQUIRED = [
  'maestro capabilities --json',
  'session/3.0',
  'run-response/1.2',
  'orchestration_revision',
  'session_run_minimal_v3',
  'entity_revision_cas',
  'participant_identity',
  'request_receipts_v2',
  'session_schema_writes',
  '--request-id',
  '--expected-orchestration-revision',
  '--participant',
  '--actor',
  'maestro session status',
];

const KNOWLEDGE_REQUIRED = [
  'knowledge_context',
  'knowledge-delta.json',
  'candidate',
  'reconcile',
  'promotion',
  'corpus',
];

const CANONICAL_FORBIDDEN = [
  {
    description: 'Session lifecycle mutation command',
    pattern: /maestro session (?:start|next|done|decide|resolve(?!-view)|resume(?!-view)|seal)\b/i,
  },
  {
    description: 'Session-owned orchestration authority',
    pattern: /session\.json\.orchestration|\bsession\.(?:status|scope_verdict)\b/i,
  },
  {
    description: 'permanent running/paused/sealed Session assumption',
    pattern: /(?<![nN][oO]\s)(?<![nN][oO][tT]\s)(?<![nN][eE][vV][eE][rR]\s)\b(?:running|paused|sealed) Session\b|\bSession (?:is|remains|stays) (?:running|paused|sealed)\b|Session\s*(?:为|保持)\s*(?:running|paused|sealed)/i,
  },
  {
    description: 'retired Execution-era authority (lease/paused/identity revisions)',
    pattern: /(?:core_execution_lease|execution_generation|session_statusless|identity_revision|(?<![nN][oO]\s)(?<![nN][oO][tT]\s)(?<![nN][eE][vV][eE][rR]\s)paused Execution|execution-seal-receipt\/1\.0)/i,
  },
  {
    description: 'retired Execution lifecycle command',
    pattern: /maestro execution (?:start|status|resolve|resume|seal)/i,
  },
  {
    description: 'Session-owned gate authority',
    pattern: /\bSession gates?\b/i,
  },
  {
    description: 'Session seal promotion prerequisite',
    pattern: /session-source candidates? require(?:s)? (?:the )?Session (?:itself )?sealed|sealed Session \+ fresh session receipt|promote only after the Session is sealed/i,
  },
];

const EXECUTION_MUTATIONS = {
  'maestro session open': [
    '--id', '--participant', '--actor', '--request-id', '--reason', '--json',
  ],
  'maestro session chain insert': [
    '--session', '--step-id', '--command', '--participant', '--actor', '--request-id', '--reason',
    '--expected-orchestration-revision', '--json',
  ],
  'maestro session chain replace': [
    '--session', '--step-id', '--command', '--participant', '--actor', '--request-id', '--reason',
    '--expected-orchestration-revision', '--json',
  ],
  'maestro session chain update': [
    '--session', '--step-id', '--participant', '--actor', '--request-id', '--reason',
    '--expected-orchestration-revision', '--json',
  ],
  'maestro session chain skip': [
    '--session', '--step-id', '--participant', '--actor', '--request-id', '--reason', '--evidence',
    '--expected-orchestration-revision', '--json',
  ],
  'maestro session complete': [
    '--session', '--participant', '--actor', '--request-id', '--reason',
    '--expected-orchestration-revision', '--json',
  ],
  'maestro session migrate': [
    '--session', '--to-v3', '--participant', '--actor', '--request-id', '--reason',
    '--expected-identity-revision', '--expected-activity-revision', '--json',
  ],
  'maestro run next': [
    '--session', '--participant', '--actor', '--request-id', '--reason',
    '--expected-orchestration-revision', '--json',
  ],
  'maestro run create': [
    '--session', '--run', '--step', '--participant', '--actor', '--request-id', '--reason',
    '--expected-orchestration-revision', '--json',
  ],
  'maestro run complete': [
    '--session', '--advance', '--verdict', '--expected-run-revision', '--expected-orchestration-revision',
    '--participant', '--actor', '--request-id', '--reason', '--json',
  ],
  'maestro run decide': [
    '--session', '--verdict', '--confidence', '--expected-orchestration-revision',
    '--participant', '--actor', '--request-id', '--reason', '--json',
  ],
  'maestro run cancel': [
    '--session', '--expected-run-revision', '--expected-orchestration-revision',
    '--participant', '--actor', '--request-id', '--reason', '--json',
  ],
  'maestro run transition': [
    '--session', '--expected-run-revision',
    '--participant', '--actor', '--request-id', '--reason', '--json',
  ],
  'maestro artifact republish': [
    '--session', '--assessment-hash', '--consumer', '--alias', '--expected-artifact-revision',
    '--expected-orchestration-revision', '--participant', '--actor', '--request-id', '--reason', '--json',
  ],
};

export const EXECUTION_PROMPT_PROFILES = [
  {
    id: 'full',
    path: 'workflows/run-mode.md',
    mutations: [
      'maestro session open', 'maestro session chain insert', 'maestro session chain replace',
      'maestro session chain update', 'maestro session chain skip', 'maestro session complete', 'maestro session migrate',
      'maestro run next', 'maestro run create', 'maestro run complete', 'maestro run decide',
      'maestro run transition', 'maestro run cancel', 'maestro artifact republish',
    ],
    required: [
      ...COMMON_REQUIRED,
      'run/3.0',
      'maestro run brief',
      'maestro session chain insert',
      'maestro run next',
      'maestro run create',
      'maestro run complete',
      'maestro run decide',
      'resolved `task`',
      'structured executable `continuation`',
      'run_already_created',
      ...KNOWLEDGE_REQUIRED,
    ],
  },
  {
    id: 'lite',
    path: 'workflows/run-mode-lite.md',
    mutations: [
      'maestro session open', 'maestro session chain insert', 'maestro session complete',
      'maestro run next', 'maestro run create', 'maestro run complete', 'maestro run decide',
      'maestro run transition', 'maestro run cancel',
    ],
    required: [
      ...COMMON_REQUIRED,
      'maestro run complete',
      'resolved `task`',
      'structured executable `continuation`',
    ],
  },
  {
    id: 'orchestrator',
    path: 'workflows/orchestrator-run-loop.md',
    mutations: [
      'maestro session chain insert', 'maestro session complete',
      'maestro run next', 'maestro run complete', 'maestro run decide',
      'maestro run transition', 'maestro run cancel',
    ],
    required: [
      ...COMMON_REQUIRED,
      'maestro run next',
      'maestro run complete',
      'maestro run decide',
      'resolved `task`',
      'structured executable `continuation`',
      'chain disposition',
    ],
  },
  {
    id: 'ralph',
    path: 'prepare/ralph.md',
    required: [
      ...COMMON_REQUIRED,
      'maestro run brief',
      'maestro run next',
      'maestro run complete',
      'maestro run decide',
      'run_already_created',
      'brief-result/3.0',
      'session complete',
    ],
  },
];

const SUPPORT_PROFILES = [
  {
    id: 'ralph-command-source',
    path: '.claude/commands/maestro-ralph.md',
    required: [
      'maestro capabilities --json', 'session/3.0', 'run/3.0', 'run-response/1.2',
      'session_run_minimal_v3', 'orchestration_revision', 'maestro session complete',
      'maestro run complete',
    ],
    forbidden: [
      { description: 'Session terminal state', pattern: /S_DONE\s+[^\n]*seal Session|Session auto-paused/i },
      { description: 'Session decision mutation', pattern: /`session decide/i },
    ],
  },
  {
    id: 'ralph-workflow-source',
    path: 'workflows/ralph.md',
    required: ['execution-seal-receipt/1.0', 'run-response/1.1', 'bounded Execution'],
    forbidden: [
      { description: 'Session status persistence', pattern: /\bsession\.status\b|\bsession resume\b|`session decide/i },
    ],
  },
  {
    id: 'ralph-amend-source',
    path: 'workflows/ralph-amend-goal.md',
    required: [
      'maestro capabilities --json', 'session/3.0', 'run/3.0', 'run-response/1.2',
      'orchestration_revision', 'maestro session status', 'maestro session chain replace',
      'maestro session chain insert', 'maestro run next', 'maestro run complete', 'maestro run check',
    ],
    forbidden: [
      { description: 'canonical Session amendment mutation', pattern: /maestro session (?:meta|next|done|resolve|resume|seal)\b/i },
    ],
    canonicalOnly: true,
  },
  {
    id: 'codex-run-adapter',
    path: 'workflows/codex-run-mode.md',
    required: ['run-response/1.1', '--execution {execution_id}', '--generation {generation}', 'maestro execution seal'],
    forbidden: [
      { description: 'Session completion command', pattern: /maestro session done/i },
    ],
  },
  {
    id: 'entry-command-generator',
    path: 'src/core/entry-command-generator.ts',
    required: [
      'maestro capabilities --json', 'session/3.0', 'run-response/1.2',
      'maestro session open', 'maestro session chain insert', '--arg "<domain text>"',
      'maestro run next', 'resolved \\`task\\`', 'structured executable \\`continuation\\`',
      '--input <ART-id>', 'sealed same-Session Artifact ID',
      'maestro run complete', '--advance', 'maestro session complete',
    ],
    forbidden: [
      { description: 'generated Session convenience start', pattern: /maestro run start/i },
      { description: 'generated legacy done alias', pattern: /maestro run done/i },
    ],
  },
  {
    id: 'runtime-finish-checklist',
    path: 'src/run/runtime.ts',
    required: [
      'do not require Session seal under `session/2.0`',
      'candidate version/content hash',
      'evidence roots/hash',
      'current corpus fingerprint',
    ],
    forbidden: [
      { description: 'runtime Session seal promotion prerequisite', pattern: /promote only after the Session is sealed with a fresh session reconciliation receipt/i },
    ],
  },
  // Knowledge promotion canon lives in the maestro-knowledge skill (L1);
  // always-on instruction files only route to it.
  {
    id: 'knowledge-skill-canon',
    path: '.claude/commands/maestro-knowledge.md',
    required: [
      'does not require Session seal',
      'immutable candidate version/content hash',
      'evidence roots/hash',
      'current corpus fingerprint',
    ],
    forbidden: [
      { description: 'instruction Session seal promotion prerequisite', pattern: /sealed Session \+ fresh session receipt/i },
    ],
  },
];

function read(root, relativePath) {
  const path = join(root, relativePath);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function missingTokens(text, required) {
  return required.filter(token => !text.includes(token));
}

function normalizedCommandLine(line) {
  return line.trim()
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^`+/, '')
    .replace(/`+$/, '')
    .trim();
}

function commandLines(text, command) {
  return text.split(/\r?\n/)
    .map(normalizedCommandLine)
    .filter(line => line.startsWith(command));
}

function commandMentions(text, command) {
  return text.split(/\r?\n/)
    .filter(line => line.includes(command))
    .map(line => line.slice(line.indexOf(command)).replace(/`/g, '').trim());
}

function missingMutationOptions(line, command) {
  return EXECUTION_MUTATIONS[command].filter(option => !line.includes(option));
}

function validateExecutableMutations(text, profile) {
  const errors = [];
  for (const command of profile.mutations ?? []) {
    const requiredOptions = EXECUTION_MUTATIONS[command];
    const invocations = commandMentions(text, command);
    const complete = invocations.some(line => missingMutationOptions(line, command).length === 0);
    if (!complete) {
      errors.push(
        `${profile.path}: missing executable canonical command option set for ${command}: ${requiredOptions.join(' ')}`,
      );
    }
  }
  return errors;
}

function validateImportedMutationInvocations(text, path, ellipsisOnly = false) {
  const errors = [];
  for (const command of Object.keys(EXECUTION_MUTATIONS)) {
    for (const line of commandLines(text, command)) {
      if (ellipsisOnly && !/(?:\.\.\.|…)/.test(line)) continue;
      const missing = missingMutationOptions(line, command);
      if (missing.length > 0) {
        errors.push(`${path}: executable canonical ${command} is missing required options: ${missing.join(' ')}`);
      }
    }
  }
  return errors;
}

function validateRequiredAndForbidden(text, profile, canonicalOnly) {
  const errors = missingTokens(text, profile.required).map(token => (
    `${profile.path}: missing Execution semantic token: ${token}`
  ));
  const inspected = canonicalOnly ? canonicalBranch(text) : text;
  for (const rule of profile.forbidden ?? (canonicalOnly ? CANONICAL_FORBIDDEN : [])) {
    if (rule.pattern.test(inspected)) {
      errors.push(`${profile.path}: canonical new-runtime path contains ${rule.description}`);
    }
  }
  return errors;
}

export function canonicalBranch(text) {
  const match = LEGACY_HEADING.exec(text);
  return match ? text.slice(0, match.index) : text;
}

function walkMarkdown(dir) {
  if (!existsSync(dir)) return [];
  const paths = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) paths.push(...walkMarkdown(path));
    else if (entry.isFile() && entry.name.endsWith('.md')) paths.push(path);
  }
  return paths;
}

function frontmatterSessionMode(text) {
  return text.match(/^session-mode:\s*([^\r\n]+)$/m)?.[1]?.trim() ?? null;
}

function inheritedWorkflow(text) {
  return /^<!-- session-mode:\s*inherited\s*-->/m.test(text);
}

function importedRunMode(text) {
  return text.includes('@~/.maestro/workflows/run-mode.md')
    || text.includes('@~/.maestro/workflows/run-mode-lite.md');
}

function activeImportedPromptPaths(root, platformRoot = '.claude') {
  const paths = new Set();
  const commandDir = join(root, platformRoot, 'commands');
  for (const path of walkMarkdown(commandDir)) {
    const text = readFileSync(path, 'utf8');
    if (frontmatterSessionMode(text) === 'run' && importedRunMode(text)) paths.add(path);
  }

  const skillDir = join(root, platformRoot, 'skills');
  if (existsSync(skillDir)) {
    for (const entry of readdirSync(skillDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const owner = join(skillDir, entry.name, 'SKILL.md');
      if (!existsSync(owner)) continue;
      const text = readFileSync(owner, 'utf8');
      if (frontmatterSessionMode(text) !== 'run' || !importedRunMode(text)) continue;
      for (const path of walkMarkdown(join(skillDir, entry.name))) paths.add(path);
    }
  }

  if (platformRoot === '.claude') {
    for (const path of walkMarkdown(join(root, 'workflows'))) {
      const text = readFileSync(path, 'utf8');
      if (inheritedWorkflow(text) && importedRunMode(text)) paths.add(path);
    }
  }
  return [...paths].sort();
}

function relativePromptPath(root, path) {
  const normalizedRoot = root.replaceAll('\\', '/').replace(/\/$/, '');
  return path.replaceAll('\\', '/').replace(`${normalizedRoot}/`, '');
}

export function inspectActiveExecutionPromptImporters(root = process.cwd(), platformRoot = '.claude') {
  return activeImportedPromptPaths(root, platformRoot).map(path => {
    const relativePath = relativePromptPath(root, path);
    const text = canonicalBranch(readFileSync(path, 'utf8'));
    const errors = [];
    for (const rule of CANONICAL_FORBIDDEN.slice(0, 1)) {
      if (rule.pattern.test(text)) {
        errors.push(`${relativePath}: canonical new-runtime path contains ${rule.description}`);
      }
    }
    errors.push(...validateImportedMutationInvocations(text, relativePath));
    return { id: `active-importer:${relativePath}`, path: relativePath, errors };
  });
}

export function inspectExecutionPromptSuite(root = process.cwd()) {
  return EXECUTION_PROMPT_PROFILES.map(profile => {
    const text = read(root, profile.path);
    if (text === null) {
      return { id: profile.id, path: profile.path, errors: [`${profile.path}: missing prompt source`] };
    }
    const errors = [];
    if (!LEGACY_HEADING.test(text)) {
      errors.push(`${profile.path}: missing labeled Legacy \`session/1.x\` Compatibility Branch`);
    }
    errors.push(...validateRequiredAndForbidden(text, profile, true));
    errors.push(...validateExecutableMutations(canonicalBranch(text), profile));
    errors.push(...validateImportedMutationInvocations(canonicalBranch(text), profile.path, true));
    if (!/\bRun\b[^\n]*(?:immutable|不可变)/i.test(canonicalBranch(text))) {
      errors.push(`${profile.path}: canonical new-runtime path must state that each Run is immutable`);
    }
    return { id: profile.id, path: profile.path, errors };
  });
}

export function inspectExecutionPromptSupport(root = process.cwd()) {
  return SUPPORT_PROFILES.map(profile => {
    const text = read(root, profile.path);
    if (text === null) {
      return { id: profile.id, path: profile.path, errors: [`${profile.path}: missing prompt/generator source`] };
    }
    const inspected = profile.canonicalOnly ? canonicalBranch(text) : text;
    return {
      id: profile.id,
      path: profile.path,
      errors: validateRequiredAndForbidden(inspected, profile, false),
    };
  });
}

export function validateExecutionPromptSemantics(root = process.cwd()) {
  return [
    ...inspectExecutionPromptSuite(root),
    ...inspectExecutionPromptSupport(root),
    ...inspectActiveExecutionPromptImporters(root),
  ].flatMap(result => result.errors);
}

export function inspectExecutionPromptMirrors(root = process.cwd()) {
  const sourcePath = '.claude/commands/maestro-ralph.md';
  if (!existsSync(join(root, sourcePath))) return [];
  const required = [
    'maestro capabilities --json', 'session/3.0', 'run/3.0', 'run-response/1.2',
    'session_run_minimal_v3', 'orchestration_revision', 'maestro session complete',
    'maestro run complete',
  ];
  const forbidden = [
    { description: 'Session terminal state', pattern: /S_DONE\s+[^\n]*seal Session|Session auto-paused/i },
    { description: 'Session decision mutation', pattern: /`session decide/i },
  ];
  const ralphResults = [
    { id: 'agy-ralph-mirror', path: '.agy/skills/maestro-ralph/SKILL.md' },
    { id: 'agents-ralph-mirror', path: '.agents/skills/maestro-ralph/SKILL.md' },
    { id: 'codex-ralph-mirror', path: '.codex/skills/maestro-ralph/SKILL.md' },
  ].map(profile => {
    const text = read(root, profile.path);
    if (text === null) {
      return { id: profile.id, path: profile.path, errors: [`${profile.path}: missing generated mirror`] };
    }
    return {
      id: profile.id,
      path: profile.path,
      errors: validateRequiredAndForbidden(text, { ...profile, required, forbidden }, false),
    };
  });
  return [
    ...ralphResults,
    ...inspectActiveExecutionPromptImporters(root, '.codex'),
  ];
}
