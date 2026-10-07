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
  '--expected-orchestration-revision',
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
    '--id', '--actor', '--json',
  ],
  'maestro session chain insert': [
    '--session', '--step-id', '--command', '--actor',
    '--expected-orchestration-revision', '--json',
  ],
  'maestro session chain replace': [
    '--session', '--step-id', '--command', '--actor',
    '--expected-orchestration-revision', '--json',
  ],
  'maestro session chain update': [
    '--session', '--step-id', '--actor',
    '--expected-orchestration-revision', '--json',
  ],
  'maestro session chain skip': [
    '--session', '--step-id', '--actor', '--evidence',
    '--expected-orchestration-revision', '--json',
  ],
  'maestro session complete': [
    '--session', '--actor',
    '--expected-orchestration-revision', '--json',
  ],
  'maestro session migrate': [
    '--session', '--to-v3', '--actor',
    '--expected-identity-revision', '--expected-activity-revision', '--json',
  ],
  'maestro run next': [
    '--session', '--actor',
    '--expected-orchestration-revision', '--json',
  ],
  'maestro run create': [
    '--session', '--run', '--step', '--actor',
    '--expected-orchestration-revision', '--json',
  ],
  'maestro run complete': [
    '--session', '--advance', '--verdict', '--expected-run-revision', '--expected-orchestration-revision',
    '--actor', '--json',
  ],
  'maestro run decide': [
    '--session', '--verdict', '--confidence', '--expected-orchestration-revision',
    '--actor', '--json',
  ],
  'maestro run cancel': [
    '--session', '--expected-run-revision', '--expected-orchestration-revision',
    '--actor', '--json',
  ],
  'maestro run transition': [
    '--session', '--expected-run-revision',
    '--actor', '--json',
  ],
  'maestro artifact republish': [
    '--session', '--assessment-hash', '--consumer', '--alias', '--expected-artifact-revision',
    '--expected-orchestration-revision', '--actor', '--json',
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
      'does not require Session completion',
      'later unrelated Session activity alone does not invalidate the snapshot',
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

export const KNOWLEDGE_CLOSEOUT_REF = '@~/.maestro/ref/knowledge-closeout.md';
export const KNOWLEDGE_CLOSEOUT_ENTRIES = [
  'workflows/run-mode.md',
  'workflows/run-mode-lite.md',
  'workflows/orchestrator-run-loop.md',
  '.claude/commands/maestro-knowledge.md',
  '.claude/commands/maestro-companion.md',
  '.claude/commands/maestro-session-manage.md',
];

// Check the shared protocol once; importers need routing and a Read fallback,
// not copies of the protocol's prose. These are prompt guards, not CLI gates.
const CLOSEOUT_STEPS = [
  ['Review', ['maestro knowledge review {session_id} --json', 'No candidates']],
  ['Refresh', ['Only when review reports **missing/stale** reconciliation receipts, and the caller permits receipt repair, run', 'missing/stale', 'caller permits receipt repair', '--refresh --json', 'read the returned view', 'report the exact blocker']],
  ['Present', ['exact ID', 'title', 'content', 'source/evidence anchors', 'freshness/eligibility', 'matches', 'relationship choices', 'recommended', 'rationale', 'untrusted evidence']],
  ['Authorize', ['ask-user-question', 'explicit human', 'exact candidate set', 'content/evidence', 'relationship/target', 'publication action', 'selection, rejection, and deferral', 'displayed fixed list of IDs', 'Importance, `-y`, machine recommendations', 'advisory decision policy', '`accepted` decision status', '**not** knowledge publication approval', 'does not authorize writes', 'defer and report', 'Do not fabricate `duplicate`']],
  ['Execute', ['Freeze the approved IDs', 'one candidate at a time', 'Do not widen selection with `--all`', '**after** explicit confirmation', 'maestro knowledge promote {session_id} --resolve <approved-candidate-id>', '--as <duplicate|related|conflict|supersede|unique>', '--target <matched-knowledge-id>', '--reason', '`unique` has **no `--target`**', 'current evidence-backed `matches`', '`duplicate`/`conflict` suppress', 'only relationship adjudication was authorized', 'deprecated `review --resolve` compatibility', 'maestro knowledge promote {session_id} --candidate <approved-candidate-id> --json', '`promote --resolve` is the preferred', '`review --resolve` remains the deprecated', 'Stop on blocked/uncertain results', 'never direct-write Spec/Knowhow']],
  ['Verify', ['Read each execution result', 're-read `maestro knowledge review {session_id} --json`', 'actual publication outcomes/knowledge IDs', 'remaining pending', 'command issuance is not success', 're-present and re-confirm', 'Never silently reuse approval', 'all source Runs sealed', 'does **not** require Session completion', 'immutable candidate version/content hash', 'exact Session identity/revision', 'non-empty evidence roots/hash', 'candidate-snapshot/corpus reconciliation', 'final commit']],
];

function validateCloseoutRouting(text, path) {
  const errors = missingTokens(text, [KNOWLEDGE_CLOSEOUT_REF, 'Read', 'not expanded', 'no longer in context'])
    .map(token => `${path}: missing knowledge closeout reference/load token: ${token}`);
  const fallback = text.split(/\r?\n\s*\r?\n/).some(paragraph => (
    paragraph.includes('not expanded') && paragraph.includes('no longer in context')
    && paragraph.includes(`Read ${KNOWLEDGE_CLOSEOUT_REF} explicitly before`)
  ));
  if (!fallback) errors.push(`${path}: missing explicit knowledge closeout Read-before-use fallback`);
  return errors;
}

function validateCloseoutSafety(text, path) {
  const errors = [];
  const canonical = canonicalBranch(text).replace(/[`*]/g, '');
  // Positive directives only: negative warnings and labeled legacy branches
  // remain legal. No change to the CLI's independent --all semantics.
  const rules = [
    ['automatic publication approval', /(?:-y|importance|machine (?:recommendations|advice)|advisory decision policy|accepted decision status)\s+(?:is|are|grants?|authorizes?)\s+(?:explicit\s+)?knowledge publication approval/i],
    ['execution before authorization', /(?:^|\n)\s*(?:Execute|Run|Publish|Resolve|Promote)[^\n.!?]*\b(?:before (?:asking|confirming|authorization)|then (?:ask|confirm))\b/i],
    ['canonical v2 main path', /(?:canonical|primary|default) (?:closeout|knowledge|promotion) (?:path|protocol)[^\n]*\b(?:session\/2\.0|run-response\/1\.1)\b/i],
    ['Session completion promotion prerequisite', /session-source (?:candidate|publication)\s+requires? (?:permanent )?Session completion/i],
    ['unrelated activity invalidates source snapshot', /unrelated Session activity (?:alone )?(?:invalidates|must invalidate) (?:the )?snapshot/i],
  ];
  for (const [description, pattern] of rules) {
    const unsafe = canonical.split(/\r?\n/).some(line => {
      const match = pattern.exec(line);
      if (!match) return false;
      const prefix = line.slice(0, match.index).split(/[.!?]/).pop();
      return !/\b(?:never|do not|must not|not)\b/i.test(prefix);
    });
    if (unsafe) errors.push(`${path}: unsafe knowledge closeout: ${description}`);
  }
  // Shell continuations belong to one command, even across physical lines.
  const logicalCommands = canonical.replace(/\\\r?\n\s*/g, ' ');
  for (const line of commandLines(logicalCommands, 'maestro knowledge promote')) {
    if (/--all\b/.test(line)) errors.push(`${path}: unsafe knowledge closeout: executable bulk promotion`);
  }
  return errors;
}

export function inspectKnowledgeCloseout(root = process.cwd()) {
  const path = 'ref/knowledge-closeout.md';
  const text = read(root, path);
  const errors = [];
  if (text === null) errors.push(`${path}: missing shared knowledge closeout source`);
  else {
    errors.push(...validateCloseoutRouting(text, path));
    const headings = [...text.matchAll(/^### (\d+)\. (Review|Refresh|Present|Authorize|Execute|Verify)\s*$/gm)];
    if (headings.map(match => `${match[1]}. ${match[2]}`).join(' → ') !== CLOSEOUT_STEPS.map(([name], i) => `${i + 1}. ${name}`).join(' → ')) {
      errors.push(`${path}: knowledge closeout must order Review → Refresh → Present → Authorize → Execute → Verify`);
    }
    for (const [name, required] of CLOSEOUT_STEPS) {
      const index = headings.findIndex(match => match[2] === name);
      const section = index < 0 ? '' : text.slice(headings[index].index, headings[index + 1]?.index ?? text.length);
      errors.push(...missingTokens(section, required).map(token => `${path}: missing knowledge closeout ${name} token: ${token}`));
    }
    errors.push(...missingTokens(text, ['completion owner', 'Workers stage/check/report and return', 'Intermediate Runs continue', 'Zero candidates, rejection, deferral', 'review-only request permits read-only', 'not implicit `--refresh`, `--resolve`, or promotion']).map(token => `${path}: missing knowledge closeout boundary: ${token}`));
    errors.push(...validateCloseoutSafety(text, path));
  }
  const results = [{ id: 'knowledge-closeout-ref', path, errors }];
  for (const entry of [...KNOWLEDGE_CLOSEOUT_ENTRIES, 'ref/finish-work.md']) {
    const source = read(root, entry);
    const entryErrors = source === null ? [`${entry}: missing knowledge closeout entry`] : [
      ...validateCloseoutRouting(canonicalBranch(source), entry),
      ...validateCloseoutSafety(source, entry),
    ];
    if (entry === 'ref/finish-work.md' && source !== null) {
      entryErrors.push(...missingTokens(source, ['staging-only', 'finish-work does not perform resolution, promotion, or canonical completion']).map(token => `${entry}: missing staging-only boundary: ${token}`));
    }
    results.push({ id: `knowledge-closeout:${entry}`, path: entry, errors: entryErrors });
  }
  return results;
}

export function validateExecutionPromptSemantics(root = process.cwd()) {
  return [
    ...inspectKnowledgeCloseout(root),
    ...inspectExecutionPromptSuite(root),
    ...inspectExecutionPromptSupport(root),
    ...inspectActiveExecutionPromptImporters(root),
  ].flatMap(result => result.errors);
}

export function inspectKnowledgeCloseoutMirrors(root = process.cwd()) {
  const results = [];
  for (const platform of ['.agy', '.agents', '.codex']) {
    for (const name of ['maestro-knowledge', 'maestro-companion', 'maestro-session-manage']) {
      const source = read(root, `.claude/commands/${name}.md`);
      if (source === null) continue;
      const path = `${platform}/skills/${name}/SKILL.md`;
      const text = read(root, path);
      const errors = text === null ? [`${path}: missing generated closeout mirror`] : [
        ...validateCloseoutRouting(text, path),
        ...validateCloseoutSafety(text, path),
      ];
      if (text !== null) {
        const mode = name === 'maestro-knowledge' ? 'none' : 'run';
        if (frontmatterSessionMode(text) !== mode) errors.push(`${path}: closeout mirror must use session-mode: ${mode}`);
        // Check only closeout semantics, allowing platform tool/frontmatter rewrites.
        const required = name === 'maestro-knowledge'
          ? [...SUPPORT_PROFILES.find(profile => profile.id === 'knowledge-skill-canon').required,
            'inline `promote --resolve`', 'deprecated compatibility fallback', 'relationship-only',
            'fixed approved candidate IDs', 'no question tool and no explicit authorization means defer']
          : ['completion owner', 'Review → Refresh → Present → Authorize → Execute → Verify',
            name === 'maestro-companion' ? 'never grants knowledge publication approval' : 'not publication approval'];
        errors.push(...missingTokens(text, required).map(token => `${path}: closeout mirror semantic drift: ${token}`));
      }
      results.push({ id: `knowledge-closeout-mirror:${path}`, path, errors });
    }
  }
  return results;
}

export function inspectExecutionPromptMirrors(root = process.cwd()) {
  const sourcePath = '.claude/commands/maestro-ralph.md';
  if (!existsSync(join(root, sourcePath))) return inspectKnowledgeCloseoutMirrors(root);
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
    ...inspectKnowledgeCloseoutMirrors(root),
    ...inspectActiveExecutionPromptImporters(root, '.codex'),
  ];
}
