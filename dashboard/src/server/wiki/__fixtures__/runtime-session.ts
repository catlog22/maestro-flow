import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkRun, completeRun, createRun, sealSession } from '../../../../../src/run/runtime.js';
import { SessionStore } from '../../../../../src/run/store.js';

export interface RuntimeSessionFixture {
  projectRoot: string;
  workflowRoot: string;
  sessionId: string;
  runId: string;
  summary: string;
  kind: string;
  session: Record<string, unknown>;
  run: Record<string, unknown>;
}

/** Generate canonical Session/Run files through the runtime writer, not hand-authored JSON. */
export function createRuntimeSessionFixture(projectRoot: string): RuntimeSessionFixture {
  const command = 'wiki-runtime-fixture';
  const summary = 'Runtime 1.3 wiki projection sentinel';
  const kind = 'review-findings';
  const commandDir = join(projectRoot, '.claude', 'commands');
  mkdirSync(commandDir, { recursive: true });
  writeFileSync(join(commandDir, `${command}.md`), [
    '<contract>',
    'consumes: []',
    'produces:',
    `  - kind: ${kind}`,
    '    primary: true',
    '    path: outputs/review-findings.json',
    '    alias: latest-review',
    'gates:',
    '  entry: []',
    '  exit: []',
    '</contract>',
    '',
  ].join('\n'), 'utf8');

  const created = createRun({
    projectRoot,
    command,
    intent: 'Verify runtime 1.3 Wiki Search Load projection',
    platform: 'codex',
  });
  const runDir = join(projectRoot, '.workflow', 'sessions', created.session_id, 'runs', created.run_id);
  writeFileSync(join(runDir, 'outputs', 'review-findings.json'), JSON.stringify({
    _meta: { kind, schema: 'review-findings/1.0', role: 'primary', alias: 'latest-review' },
    summary,
    findings: [{ severity: 'low', title: 'Runtime writer remains searchable' }],
  }, null, 2), 'utf8');
  writeFileSync(join(runDir, 'report.md'), [
    '---',
    'verdict: ready',
    `summary: ${summary}`,
    'constraints: []',
    'decisions:',
    '  - id: D1',
    '    text: Project Session and Run 1.3 through the Wiki adapter',
    '    status: accepted',
    'concerns: []',
    'next: []',
    '---',
    '## Summary',
    summary,
    '',
  ].join('\n'), 'utf8');

  const checked = checkRun(projectRoot, created.run_id, created.session_id);
  if (checked.errors.length > 0 || checked.gates.blocking.length > 0) {
    throw new Error(`Runtime fixture did not pass check: ${[...checked.errors, ...checked.gates.blocking].join(', ')}`);
  }
  const completed = completeRun(projectRoot, created.run_id, created.session_id);
  if (!completed.sealed) throw new Error(`Runtime fixture Run was not sealed: ${created.run_id}`);
  sealSession(projectRoot, created.session_id, summary);

  const store = new SessionStore(projectRoot);
  const session = store.readBundle(created.session_id).session;
  const run = store.readRun(created.session_id, created.run_id);
  const sessionPath = join(projectRoot, '.workflow', 'sessions', created.session_id, 'session.json');
  const runPath = join(runDir, 'run.json');
  const persistedSession = JSON.parse(readFileSync(sessionPath, 'utf8')) as Record<string, unknown>;
  const persistedRun = JSON.parse(readFileSync(runPath, 'utf8')) as Record<string, unknown>;
  if (session.schema_version !== 'session/1.3' || persistedSession.schema_version !== 'session/1.3') {
    throw new Error('Runtime fixture did not persist session/1.3');
  }
  if (run.schema_version !== 'command-run/1.3' || persistedRun.schema_version !== 'command-run/1.3') {
    throw new Error('Runtime fixture did not persist command-run/1.3');
  }

  return {
    projectRoot,
    workflowRoot: join(projectRoot, '.workflow'),
    sessionId: created.session_id,
    runId: created.run_id,
    summary,
    kind,
    session: persistedSession,
    run: persistedRun,
  };
}
