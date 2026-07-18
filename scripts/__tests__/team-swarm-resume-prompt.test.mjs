import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();
const rolePath = join(repoRoot, '.claude', 'skills', 'team-swarm', 'roles', 'coordinator', 'role.md');
const initPath = join(repoRoot, '.claude', 'skills', 'team-swarm', 'roles', 'coordinator', 'commands', 'init-swarm.md');

test('team-swarm Phase 0 uses exact Run ownership and explicit locator-less selection', () => {
  const role = readFileSync(rolePath, 'utf8');

  assert.match(role, /Exact Run locator first/);
  assert.match(role, /exact `run_dir` contains at most one team session/);
  assert.match(role, /Never select candidate index 0 implicitly/);
  assert.match(role, /canonical Run status, broker-backed live agents, non-terminal team tasks/);
  assert.doesNotMatch(role, /Single session -> resume; multiple -> AskUserQuestion/);
});

test('team-swarm prompt keeps stale health, abandonment, and cleanup separate', () => {
  const role = readFileSync(rolePath, 'utf8');
  const init = readFileSync(initPath, 'utf8');

  assert.match(role, /`stale_candidate` is derived health, never a lifecycle and never cleanup eligibility/);
  assert.match(role, /Abandonment and cleanup are separate confirmed operations/);
  assert.match(role, /never `run\.json`, `outputs\/`/);
  assert.match(init, /Do not offer a generic "clean or resume" action/);
  assert.match(init, /`abandoned` requires a separate explicit audited transition/);
  assert.match(init, /cleanup requires a second confirmation/);
  assert.doesNotMatch(init, /prompt to clean or resume/);
});

test('TeamCreate conflict recovery resumes only the verified exact matching session', () => {
  const init = readFileSync(initPath, 'utf8');

  assert.match(init, /Resolve the exact `run_id` \/ `run_dir`/);
  assert.match(init, /offer resume only if lifecycle reconciliation verifies a matching active\/paused `team-swarm` session/);
  assert.match(init, /must never choose array index 0 implicitly/);
  assert.match(init, /"updated_at": "<iso8601>"/);
  assert.match(init, /"run": \{ "run_id": "<run-id>", "run_dir": "<run-dir>" \}/);
});
