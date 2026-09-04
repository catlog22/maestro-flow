#!/usr/bin/env node

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifySessionRunProfile,
  parseFrontmatter,
  SESSION_MODES,
} from './session-run-profiles.mjs';
import { validateExecutionPromptSemantics } from './session-execution-prompt-semantics.mjs';

const root = process.cwd();
const errors = [];
const commandDir = join(root, '.claude', 'commands');
const skillDir = join(root, '.claude', 'skills');
const obsoleteRunMode = /\.workflow\/(?:scratch|\.scratchpad)|Legacy Compatibility Mapping|state\.json\.artifacts\[\]|<run_mode>|## Run Mode Contract|## Run Artifact Boundary|\{run_dir\}\/outputs\/(?:\*|\{YYYYMMDD\}|\$\{date\})/;
const legacyTeamStateFile = /team-state\.json|(?<!team-)session\.json/;
const directRunCreateTokens = [
  'maestro run create',
  '"<task text>"',
  '--session',
  '--run',
  '--step',
  '--participant {actor_id}',
  '--actor {actor_id}',
  '--request-id',
  '--reason',
  '--expected-orchestration-revision',
  '--input <ART-id>',
  'sealed same-Session Artifact ID',
];

export function validateRunCreateArgumentChannels(text, label) {
  const errors = directRunCreateTokens
    .filter(token => !text.includes(token))
    .map(token => `${label}: missing direct Run create contract token: ${token}`);
  if (/--input\s+["']<(?:task summary|intent|task text|domain text)>["']/i.test(text)) {
    errors.push(`${label}: raw domain text must not be passed through --input`);
  }
  return errors;
}

export function validateCompanionSelfStart(text, label) {
  const required = [
    'maestro session open "<intent>"',
    'maestro session chain insert',
    '--command companion',
    '--arg "<intent>"',
    'maestro run next',
    '--participant {actor_id} --actor {actor_id}',
    '{open_request_id}',
    '{insert_request_id}',
    '{next_request_id}',
    '{open_orchestration_revision}',
    '{insert_orchestration_revision}',
    'structured `continuation`',
  ];
  const errors = required
    .filter(token => !text.includes(token))
    .map(token => `${label}: missing Companion self-start token: ${token}`);
  if (/--input\s+["']<intent>["']/i.test(text)) {
    errors.push(`${label}: Companion intent must be positional, not --input`);
  }
  return errors;
}

export function validateTeamCoordinatorSelfStart(text, label, command) {
  const required = [
    `maestro session open "<task summary>"`,
    `--command ${command} --arg "<task summary>"`,
    'maestro run next',
    '--participant {actor_id} --actor {actor_id}',
    '{open_request_id}',
    '{insert_request_id}',
    '{next_request_id}',
    '{open_orchestration_revision}',
    '{insert_orchestration_revision}',
    'structured `continuation`',
  ];
  const errors = required
    .filter(token => !text.includes(token))
    .map(token => `${label}: missing team self-start token: ${token}`);
  if (/--input\s+["']<task summary>["']/i.test(text)) {
    errors.push(`${label}: team task prose must be positional, not --input`);
  }
  return errors;
}

export function validateExecutorLifecycleBoundary(text, label) {
  const required = [
    'maestro run brief',
    'maestro run check',
    'Do not call `maestro run complete`',
    'handled by the orchestrator',
  ];
  return required
    .filter(token => !text.includes(token))
    .map(token => `${label}: missing ${token}`);
}

function field(text, name) {
  return text.match(new RegExp(`^${name}:\\s*([^\\r\\n]+)`, 'm'))?.[1]?.trim() ?? null;
}

const frontmatter = parseFrontmatter;

function validatePrompt(path, kind) {
  const text = readFileSync(path, 'utf8');
  const mode = field(text, 'session-mode');
  if (!mode) errors.push(`${relative(root, path)}: missing session-mode classification`);
  if (!SESSION_MODES.includes(mode ?? '')) {
    errors.push(`${relative(root, path)}: invalid session-mode ${mode}`);
  }
  const classification = classifySessionRunProfile({
    path: relative(root, path), kind, text, metadata: frontmatter(text),
  });
  for (const error of classification.errors) errors.push(`${relative(root, path)}: ${error}`);
  if (mode === 'run') {
    if (obsoleteRunMode.test(text)) errors.push(`${relative(root, path)}: run mode contains embedded or obsolete lifecycle content`);
    if (kind === 'command') {
      const parsed = frontmatter(text);
      const contract = parsed?.contract;
      const gates = contract?.gates ?? { entry: [], exit: [] };
      if (!contract || !Array.isArray(contract.consumes) || !Array.isArray(contract.produces)
        || !Array.isArray(gates.entry) || !Array.isArray(gates.exit)) {
        errors.push(`${relative(root, path)}: run mode contract is missing or unparseable`);
      } else if (contract.produces.length === 0 && contract.discovery !== 'self-described') {
        errors.push(`${relative(root, path)}: empty produces requires discovery: self-described`);
      }
    }
  }
  if (mode === 'deprecated' && !text.includes('<deprecated_command>')) {
    errors.push(`${relative(root, path)}: deprecated command missing mandatory replacement block`);
  }
  if ((mode === 'none' || mode === 'brief') && hasActiveLegacyWrite(text)) {
    errors.push(`${relative(root, path)}: ${kind} classified ${mode} but contains legacy session writes`);
  }
  if ((mode === 'none' || mode === 'brief') && /^contract:/m.test(text)) {
    errors.push(`${relative(root, path)}: ${kind} has a Run contract but is classified ${mode}`);
  }
}

for (const file of readdirSync(commandDir).filter((name) => name.endsWith('.md'))) {
  const path = join(commandDir, file);
  validatePrompt(path, 'command');
  if (file === 'maestro.md' || file === 'maestro-ralph.md') {
    const text = readFileSync(path, 'utf8');
    for (const [pattern, message] of [
      [/maestro ralph skills\b/, 'must use the canonical maestro skills namespace'],
      [/\bralph[-_]executor\b/, 'must dispatch the canonical run-executor'],
      [/--engine\s+ralph\b|engine\s*={1,2}\s*["']ralph["']/, 'must not classify a Session by Ralph engine'],
      [/(?:session_type|chain_mode|strategy)\s*[:=]\s*["']?(?:static|adaptive|maestro|ralph|fixed|dynamic)\b/i, 'must not persist a static/dynamic or Maestro/Ralph Session type'],
    ]) {
      if (pattern.test(text)) errors.push(`${relative(root, path)}: ${message}`);
    }
  }
}

for (const dir of readdirSync(skillDir)) {
  const path = join(skillDir, dir, 'SKILL.md');
  if (existsSync(path)) validatePrompt(path, 'skill');
}

function walkMarkdown(dir) {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) out.push(...walkMarkdown(path));
    else if (name.isFile() && name.name.endsWith('.md')) out.push(path);
  }
  return out;
}

function canonicalBranchForLint(text) {
  const legacyHeading = /^## Legacy `session\/1\.x(?:\/2\.x)?` Compatibility Branch\s*$/m.exec(text);
  return legacyHeading ? text.slice(0, legacyHeading.index) : text;
}

function hasActiveLegacyWrite(text) {
  // Artifact filenames such as understanding.md and evidence.ndjson are also
  // valid inside canonical knowledge stores. Detect legacy locations and
  // runtime-owned protocol files instead of banning those names globally.
  const legacyTarget = String.raw`(?:\.workflow\/(?:scratch|\.scratchpad|\.[a-z-]+|milestones|phases|plans|research|active)[^\s\`"']*|context-package\.json|status\.json)`;
  return new RegExp(String.raw`(?:Write|Edit|write_file|edit_file|write_to_file|replace_file_content)\s*\([^\n]*${legacyTarget}`, 'i').test(text)
    || new RegExp(String.raw`(?:write|append|persist|save|create|update|output(?:s)?(?:\s+files?)?\s+(?:to|in)|session path\s*:)\s*[^\n]*${legacyTarget}`, 'i').test(text);
}

const associatedPrepare = new Map();
const associatedCommands = new Map();

for (const path of walkMarkdown(join(root, 'workflows'))) {
  // workflows/impeccable/ is the bundled upstream Impeccable skill distribution
  // (SKILL.md/reference/scripts), not a Maestro workflow definition.
  if (relative(root, path).replace(/\\/g, '/').startsWith('workflows/impeccable/')) continue;
  const text = readFileSync(path, 'utf8');
  const metadata = frontmatter(text);
  const workflowMode = metadata?.['session-mode']
    ?? text.match(/^<!-- session-mode: ([^ ]+) -->/)?.[1];
  if (!workflowMode || !['inherited', 'none', 'bootstrap', 'deprecated'].includes(workflowMode)) {
    errors.push(`${relative(root, path)}: missing or invalid workflow session-mode`);
  }
  if (workflowMode === 'inherited') {
    if (obsoleteRunMode.test(text)) errors.push(`${relative(root, path)}: inherited workflow contains embedded or obsolete lifecycle content`);
  }
  const workflowProfile = classifySessionRunProfile({
    path: relative(root, path), kind: 'workflow', text, metadata,
  });
  for (const error of workflowProfile.errors) errors.push(`${relative(root, path)}: ${error}`);
  if (workflowMode === 'bootstrap' && !text.includes('## Bootstrap Boundary')) {
    errors.push(`${relative(root, path)}: bootstrap workflow missing boundary`);
  }
  if (workflowMode === 'deprecated' && !text.includes('## Removed Workflow')) {
    errors.push(`${relative(root, path)}: removed workflow missing terminal boundary`);
  }

  if (metadata && ('prepare' in metadata || 'commands' in metadata)) {
    const workflowName = basename(path, '.md');
    if (metadata.name !== workflowName) {
      errors.push(`${relative(root, path)}: workflow name must match basename ${workflowName}`);
    }
    if (typeof metadata.prepare !== 'string' || metadata.prepare.length === 0) {
      errors.push(`${relative(root, path)}: workflow association missing prepare`);
    } else {
      const previous = associatedPrepare.get(metadata.prepare);
      if (previous) errors.push(`${relative(root, path)}: prepare ${metadata.prepare} already associated by ${previous}`);
      else associatedPrepare.set(metadata.prepare, relative(root, path));
      if (!existsSync(join(root, 'prepare', `${metadata.prepare}.md`))) {
        errors.push(`${relative(root, path)}: associated prepare/${metadata.prepare}.md does not exist`);
      }
    }
    const commands = metadata.commands ?? [];
    if (!Array.isArray(commands) || commands.some(command => typeof command !== 'string' || command.length === 0)) {
      errors.push(`${relative(root, path)}: workflow association commands must be a string sequence when declared`);
    } else {
      for (const command of commands) {
        const previous = associatedCommands.get(command);
        if (previous) errors.push(`${relative(root, path)}: command ${command} already associated by ${previous}`);
        else associatedCommands.set(command, relative(root, path));
      }
    }
  }
}

for (const file of readdirSync(join(root, 'prepare')).filter(name => name.endsWith('.md'))) {
  const step = basename(file, '.md');
  if (!associatedPrepare.has(step)) errors.push(`prepare/${file}: missing workflow YAML association`);
}


for (const dir of readdirSync(skillDir)) {
  const skillPath = join(skillDir, dir, 'SKILL.md');
  if (!existsSync(skillPath)) continue;
  const skillText = readFileSync(skillPath, 'utf8');
  if (field(skillText, 'session-mode') !== 'run') continue;
  const skillMarkdown = walkMarkdown(join(skillDir, dir));
  if (dir.startsWith('team-')) {
    for (const path of skillMarkdown) {
      if (legacyTeamStateFile.test(readFileSync(path, 'utf8'))) {
        errors.push(`${relative(root, path)}: team skill must use the single team-session.json state authority`);
      }
    }
  }
  for (const path of skillMarkdown) {
    if (path === skillPath) continue;
    const text = readFileSync(path, 'utf8');
    const rel = relative(join(skillDir, dir), path).replace(/\\/g, '/');
    const executable = rel.startsWith('roles/') || rel.startsWith('phases/') || rel === 'templates/skill-md.md';
    if (executable) {
      const classification = classifySessionRunProfile({
        path: relative(root, path), kind: 'skill-child', text,
      });
      for (const error of classification.errors) errors.push(`${relative(root, path)}: ${error}`);
    }
    if (obsoleteRunMode.test(text)) errors.push(`${relative(root, path)}: run skill child contains embedded or obsolete lifecycle content`);
  }
}

for (const semanticError of validateExecutionPromptSemantics(root)) errors.push(semanticError);

const canonicalRunMode = join(root, 'workflows', 'run-mode.md');
if (!existsSync(canonicalRunMode)) errors.push('workflows/run-mode.md: missing canonical Run workflow');
else {
  const text = readFileSync(canonicalRunMode, 'utf8');
  for (const token of [
    'maestro run create',
    'topic grouping/index',
    'same Session',
    'Historical similarity is read-only',
    '{run_dir}/outputs/',
    'complete top-level `_meta` object',
    '`kind` and `schema` are required together',
    'maestro run check',
    'maestro run complete',
    'suggest_only',
    'maestro run next',
    'resolved `task`',
    'structured executable `continuation`',
    'done_with_concerns',
    '--expected-identity-revision',
    '--expected-activity-revision',
    '--expected-revisions',
    'same authorized identity',
    'deprecated admin-only',
    'brief-result/3.0',
    'knowledge_context',
    '--signal-ids',
    'maestro knowledge stage',
    'maestro knowledge record',
    '--transcript-quote',
    'review_required',
    'knowledge-candidate-receipt/1.0',
    'maestro knowledge promote',
    'run-response/1.2',
    'orchestration_revision',
    'artifact_compatibility_v1',
    'atomic_run_complete_seal',
    'generation_scoped_seal_receipts',
    'run_already_created',
    'blocked consumer attempt -> needs-retry/cancel -> artifact inspect -> semantic republish -> explicit retry/next',
    'Migration preserves sealed source bytes',
    'MUST NOT use chain skip, Run rebind, a direct Artifact Registry edit/rewrite',
  ]) {
    if (!text.includes(token)) errors.push(`workflows/run-mode.md: missing ${token}`);
  }
  errors.push(...validateRunCreateArgumentChannels(text, 'workflows/run-mode.md'));
  if (canonicalBranchForLint(text).includes('done-with-concerns')) {
    errors.push('workflows/run-mode.md: canonical v3 verdict must be done_with_concerns');
  }
  if (text.includes('same normalized intent')) errors.push('workflows/run-mode.md: obsolete intent-only Session routing remains');
  if (/maestro ralph\s|\bralph next\b/.test(text)) errors.push('workflows/run-mode.md: normal lifecycle must use only maestro run');
}

for (const relativePath of ['prepare/execute.md', 'prepare/review.md']) {
  const path = join(root, relativePath);
  if (!existsSync(path)) {
    errors.push(`${relativePath}: missing prepare contract`);
    continue;
  }
  const text = readFileSync(path, 'utf8');
  for (const token of [
    'blocked consumer attempt -> needs-retry/cancel -> artifact inspect -> semantic republish -> explicit retry/next',
    'classification=semantic_republish_required',
    'atomic complete-and-seal',
    'Migration must preserve the sealed source bytes and raw registry role/alias semantics',
    'chain skip, Run rebind, direct Artifact Registry edits/rewrites, or source Artifact mutation',
  ]) {
    if (!text.includes(token)) errors.push(`${relativePath}: missing Artifact recovery token: ${token}`);
  }
}

const canonicalRunModeLite = join(root, 'workflows', 'run-mode-lite.md');
if (!existsSync(canonicalRunModeLite)) errors.push('workflows/run-mode-lite.md: missing canonical team Run workflow');
else {
  const text = readFileSync(canonicalRunModeLite, 'utf8');
  for (const token of [
    'Team State Authority',
    'team-session.json',
    'merge-write',
    'complete top-level `_meta` object',
    '`kind` and `schema` are required together',
    '--signal-ids',
    'maestro knowledge stage',
    'maestro knowledge review',
    'run-response/1.2',
    'maestro run complete',
  ]) {
    if (!text.includes(token)) errors.push(`workflows/run-mode-lite.md: missing ${token}`);
  }
  errors.push(...validateRunCreateArgumentChannels(text, 'workflows/run-mode-lite.md'));
  if (/maestro ralph\s|\bralph next\b/.test(text)) errors.push('workflows/run-mode-lite.md: normal lifecycle must use only maestro run');
}

const canonicalOrchestratorLoop = join(root, 'workflows', 'orchestrator-run-loop.md');
if (!existsSync(canonicalOrchestratorLoop)) {
  errors.push('workflows/orchestrator-run-loop.md: missing canonical orchestrator loop');
} else {
  const text = readFileSync(canonicalOrchestratorLoop, 'utf8');
  for (const token of [
    '## Continuation Router',
    'Turn 终止不变量',
    'authority=automatic',
    'authority=auto_mode_only',
    'authority=user_required',
    'assessment.acceptance_status=accepted',
    '`QUALITY_MEDIUM`',
    '`REJECT`',
    '`CONFLICT`',
    'handoff `next[]`',
    '### `complete` / `decide` 闭环',
    'run_already_created=true',
    'maestro run decide',
  ]) {
    if (!text.includes(token)) errors.push(`workflows/orchestrator-run-loop.md: missing ${token}`);
  }
}

const canonicalRalphCommand = join(commandDir, 'maestro-ralph.md');
if (existsSync(canonicalRalphCommand)) {
  const text = readFileSync(canonicalRalphCommand, 'utf8');
  for (const token of [
    'Decision is mandatory',
    'every Ralph-created Session chain',
    'run decide --json',
    'run complete --json',
  ]) {
    if (!text.includes(token)) errors.push(`.claude/commands/maestro-ralph.md: missing ${token}`);
  }
}

const canonicalCompanion = join(commandDir, 'maestro-companion.md');
if (!existsSync(canonicalCompanion)) errors.push('.claude/commands/maestro-companion.md: missing canonical Companion command');
else errors.push(...validateCompanionSelfStart(
  readFileSync(canonicalCompanion, 'utf8'),
  '.claude/commands/maestro-companion.md',
));

for (const command of [
  'team-arch-opt', 'team-coordinate', 'team-issue', 'team-lifecycle-v4',
  'team-perf-opt', 'team-review', 'team-swarm', 'team-testing',
]) {
  const relativePath = `.claude/skills/${command}/roles/coordinator/role.md`;
  const path = join(root, relativePath);
  if (!existsSync(path)) {
    errors.push(`${relativePath}: missing coordinator self-start source`);
    continue;
  }
  errors.push(...validateTeamCoordinatorSelfStart(readFileSync(path, 'utf8'), relativePath, command));
}

for (const relativePath of [
  'workflows/execute.md',
  'workflows/review.md',
  'workflows/roadmap.md',
  'workflows/command-authoring.md',
  'workflows/odyssey-base.md',
]) {
  const path = join(root, relativePath);
  if (!existsSync(path)) continue;
  const canonical = canonicalBranchForLint(readFileSync(path, 'utf8'));
  if (/(?:maestro\s+)?session\s+(?:done|next|decide|seal)\b/i.test(canonical)) {
    errors.push(`${relativePath}: canonical source contains a legacy Session lifecycle alias`);
  }
}

for (const relativePath of ['workflows/blueprint.md', 'workflows/spec-generate.md']) {
  const path = join(root, relativePath);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, 'utf8');
  for (const token of ['resolved `task`', 'structured `continuation`', 'session chain insert --command', '--arg "<seed text>"', 'run next']) {
    if (!text.includes(token)) errors.push(`${relativePath}: missing v3 self-start/birth token: ${token}`);
  }
  if (/Session:\s+via maestro run create/i.test(text)) {
    errors.push(`${relativePath}: abbreviated run create Session initialization remains`);
  }
}

const canonicalTeamWorker = join(root, '.claude', 'agents', 'team-worker.md');
if (!existsSync(canonicalTeamWorker)) errors.push('.claude/agents/team-worker.md: missing canonical team worker');
else {
  const text = readFileSync(canonicalTeamWorker, 'utf8');
  for (const token of ['team-session.json', 'complete top-level `_meta` object', '`kind` and `schema` are an atomic pair']) {
    if (!text.includes(token)) errors.push(`.claude/agents/team-worker.md: missing ${token}`);
  }
}

const canonicalRunExecutor = join(root, '.claude', 'agents', 'run-executor.md');
if (!existsSync(canonicalRunExecutor)) errors.push('.claude/agents/run-executor.md: missing canonical Run executor');
else errors.push(...validateExecutorLifecycleBoundary(
  readFileSync(canonicalRunExecutor, 'utf8'),
  '.claude/agents/run-executor.md',
));
const legacyRunExecutor = join(root, '.claude', 'agents', 'ralph-executor.md');
if (!existsSync(legacyRunExecutor)) errors.push('.claude/agents/ralph-executor.md: missing compatibility alias');
else if (!readFileSync(legacyRunExecutor, 'utf8').includes('run-executor')) {
  errors.push('.claude/agents/ralph-executor.md: compatibility alias must delegate to run-executor');
}

for (const path of [
  join(root, '.codex', 'skills', 'maestro-ralph', 'SKILL.md'),
  join(root, '.codex', 'skills', 'maestro-ralph', 'optimization-strategy.md'),
  join(root, '.codex', 'multi-agents-v2-schema.md'),
  join(root, 'docs-site', 'src', 'client', 'data', 'inventory-v2.json'),
  join(root, 'docs-site', 'src', 'content', 'docs', 'commands', 'reference.md'),
]) {
  if (!existsSync(path)) continue;
  if (/\bralph[-_]executor\b/i.test(readFileSync(path, 'utf8'))) {
    errors.push(`${relative(root, path)}: active Ralph surface must use the canonical run-executor`);
  }
}


for (const dir of readdirSync(skillDir)) {
  const skillPath = join(skillDir, dir, 'SKILL.md');
  if (!existsSync(skillPath)) continue;
  const skillText = readFileSync(skillPath, 'utf8');
  if (field(skillText, 'session-mode') !== 'none') continue;
  for (const path of walkMarkdown(join(skillDir, dir))) {
    if (hasActiveLegacyWrite(readFileSync(path, 'utf8'))) {
      errors.push(`${relative(root, path)}: none skill subtree contains an active legacy session write`);
    }
  }
}

// v2/v2.1 contracts must declare the artifact schema or schema_range (and role
// for 2.1) on every consumes entry: a missing constraint yields
// ARTIFACT_SCHEMA_UNKNOWN in reuse assessment and forces a manual REVIEW
// acceptance on an otherwise eligible artifact. Also cross-check consume
// aliases against declared producer aliases (a dead alias silently never binds
// upstream) and require an explicit contract_version once a contract consumes
// anything.
export function validateConsumesSchema(contract, label) {
  const errors = [];
  const consumes = Array.isArray(contract?.consumes) ? contract.consumes : [];
  if (consumes.length === 0) return errors;
  const version = contract.contract_version;
  if (version !== 2 && version !== 2.1) {
    errors.push(`${label}: consumes without contract_version 2/2.1 parse as v1 where schema/role are metadata-only; declare contract_version: 2.1`);
    return errors;
  }
  consumes.forEach((item, index) => {
    const id = `${label}: consumes[${index}] kind=${item?.kind ?? '?'}`;
    const schema = typeof item?.schema === 'string' ? item.schema : '';
    const schemaRange = typeof item?.schema_range === 'string' ? item.schema_range : '';
    if (schema.length === 0 && schemaRange.length === 0) {
      errors.push(`${id}: missing schema or schema_range (declare the producer artifact schema, or schema_range '<kind>/<major>.x' for major-compatible reuse, so reuse binds without a manual REVIEW)`);
    } else if (schema.length > 0 && schemaRange.length > 0) {
      errors.push(`${id}: declares both schema and schema_range; pick exactly one`);
    }
    if (schemaRange.length > 0) {
      const match = /^([^/]+)\/([0-9]+)\.x$/.exec(schemaRange);
      const majorNoLeadingZero = match ? match[2] === '0' || !match[2].startsWith('0') : false;
      if (!match || !majorNoLeadingZero || match[1] !== item?.kind) {
        errors.push(`${id}: schema_range must match '<kind>/<major>.x' with kind equal to consumes kind and major without leading zeros: ${schemaRange}`);
      }
    }
    if (version === 2.1 && (typeof item?.role !== 'string' || item.role.length === 0)) {
      errors.push(`${id}: missing role for contract_version 2.1`);
    }
  });
  return errors;
}

const prepareDir = join(root, 'prepare');
export function validateProducesAliases(contract, label) {
  const errors = [];
  for (const [index, produce] of (contract?.produces ?? []).entries()) {
    if (produce?.role === 'primary' && (typeof produce.alias !== 'string' || produce.alias.length === 0)) {
      errors.push(`${label}: produces[${index}] kind=${produce.kind ?? '?'} is primary but declares no alias (an explicit alias is mandatory so consumers bind deterministically; defaultAlias inference is legacy-only)`);
    }
  }
  return errors;
}

const contractSources = [];
for (const file of readdirSync(prepareDir).filter((name) => name.endsWith('.md'))) {
  const path = join(prepareDir, file);
  const contract = frontmatter(readFileSync(path, 'utf8'))?.contract;
  if (contract) contractSources.push({ path, contract });
}
for (const file of readdirSync(commandDir).filter((name) => name.endsWith('.md'))) {
  const path = join(commandDir, file);
  const contract = frontmatter(readFileSync(path, 'utf8'))?.contract;
  if (contract) contractSources.push({ path, contract });
}
const producedAliases = new Set();
for (const { contract } of contractSources) {
  for (const produce of contract.produces ?? []) {
    if (typeof produce?.alias === 'string') producedAliases.add(produce.alias);
  }
}
for (const { path, contract } of contractSources) {
  const label = relative(root, path);
  errors.push(...validateConsumesSchema(contract, label));
  errors.push(...validateProducesAliases(contract, label));
  for (const item of contract.consumes ?? []) {
    if (typeof item?.alias === 'string' && item.alias.length > 0 && !producedAliases.has(item.alias)) {
      errors.push(`${label}: consumes alias '${item.alias}' (kind=${item.kind ?? '?'}) has no declared producer alias; the upstream can never bind (dead alias)`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (errors.length > 0) {
    console.error(errors.join('\n'));
    console.error(`session-run prompt lint failed: ${errors.length} issue(s)`);
    process.exit(1);
  }

  const commandCount = readdirSync(commandDir).filter((name) => name.endsWith('.md')).length;
  const skillCount = readdirSync(skillDir).filter((dir) => existsSync(join(skillDir, dir, 'SKILL.md'))).length;
  console.log(`session-run prompt lint passed: ${commandCount} commands, ${skillCount} skills`);
}
